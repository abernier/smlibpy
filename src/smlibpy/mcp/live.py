"""The live viewer of an MCP session: the family's viewer page (after classcad-ai's), on
127.0.0.1, showing what the session shows and following every script.

    GET /v/<token>                          the page (viewer_page/index.html)
    GET /v/<token>/scene                    what to draw, as JSON
    GET /v/<token>/events                   server-sent events: "hello", then "scene" on every change
    GET /v/<token>/export/<name>.<ext>      the model as a file: step, stl or glb
    GET /assets/...                         the page's own files (three.js, the font, the styles)

The page and three.js are served from the package, nothing from the internet.
"""

from __future__ import annotations

import base64
import gzip
import json
import os
import secrets
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .session import Session

PREFERRED_PORT = 9310
PAGE_DIR = Path(__file__).resolve().parent / "viewer_page"
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8"}
EXPORTS = {"step": ("step", "application/step"), "stp": ("step", "application/step"), "stl": ("stl", "model/stl"),
           "glb": ("glb", "model/gltf-binary")}
SAFE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}


def _host() -> str | None:
    if os.environ.get("CLAUDE_CODE_ENTRYPOINT") == "claude-desktop":
        return "Claude desktop"
    if os.environ.get("CLAUDECODE") or os.environ.get("CLAUDE_CODE_ENTRYPOINT"):
        return "Claude Code"
    return None


class LiveViewer:
    def __init__(self, session: Session):
        self.session = session
        self.token = secrets.token_urlsafe(18)
        self._server: ThreadingHTTPServer | None = None
        self._cache: tuple[int, bytes] = (-1, b"")
        self._lock = threading.Lock()
        self.opened = False  # the link was handed out or opened
        self.closed = False

    @property
    def url(self) -> str:
        self.start()
        assert self._server is not None
        return f"http://127.0.0.1:{self._server.server_address[1]}/v/{self.token}"

    def start(self) -> None:
        if self._server is not None:
            return
        handler = _handler(self)
        for port in (PREFERRED_PORT, 0):
            try:
                self._server = ThreadingHTTPServer(("127.0.0.1", port), handler)
                break
            except OSError:
                continue
        assert self._server is not None
        self._server.daemon_threads = True
        threading.Thread(target=self._server.serve_forever, name="smlibpy-viewer", daemon=True).start()

    def scene_body(self) -> bytes:
        """The scene as gzipped JSON, rebuilt when the session changed."""
        with self._lock:
            version = self.session.version
            if self._cache[0] != version:
                answer = self.session.call("scene_json")
                scene = answer.get("scene") if answer.get("ok") else None
                if scene is None:
                    scene = {"kind": "EMPTY", "name": "", "bodies": [], "placements": [], "features": [],
                             "stats": {"bodies": 0, "faces": 0, "triangles": 0, "edges": 0}, "bounds": None}
                scene["features"] = [{"no": i + 1, "name": _step_name(code, label), "kind": "run_script"}
                                     for i, (code, label) in enumerate(self.session.history)]
                from .. import __version__

                payload = {"version": version, "host": _host(), "engine": f"{__version__} · SMLib", "scene": scene}
                self._cache = (version, gzip.compress(json.dumps(payload, separators=(",", ":")).encode()))
            return self._cache[1]

    def export(self, ext: str) -> tuple[bytes, str] | None:
        fmt, ctype = EXPORTS[ext]
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, f"model.{fmt}")
            answer = self.session.call("save", 600.0, format=fmt, path=path)
            if not answer.get("ok"):
                return None
            return Path(path).read_bytes(), ctype

    def close(self) -> None:
        self.closed = True
        self.session._bump()  # wakes the event streams, which say "closed"
        if self._server is not None:
            self._server.shutdown()
            self._server = None


def _step_name(code: str, label: str | None) -> str:
    if label:
        return label
    for line in code.splitlines():
        line = line.strip()
        if line and not line.startswith(("#", "from ", "import ")):
            return line if len(line) <= 60 else line[:57] + "…"
    return "script"


def _handler(viewer: LiveViewer) -> type[BaseHTTPRequestHandler]:
    assets: dict[str, tuple[bytes, str]] = {}
    for f in PAGE_DIR.rglob("*"):
        if f.is_file():
            assets[f.relative_to(PAGE_DIR).as_posix()] = (f.read_bytes(), MIME.get(f.suffix, "application/octet-stream"))
    base = f"/v/{viewer.token}"

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args: Any) -> None:  # quiet: stderr belongs to the MCP host
            pass

        def _local(self) -> bool:
            port = self.server.server_address[1]
            return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

        def _send(self, code: int, ctype: str, body: bytes, extra: dict[str, str] | None = None) -> None:
            self.send_response(code)
            for k, v in {**SAFE, "Content-Type": ctype, "Content-Length": str(len(body)), **(extra or {})}.items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_HEAD(self) -> None:  # noqa: N802
            self.do_GET()

        def do_GET(self) -> None:  # noqa: N802
            if not self._local():
                return self._send(403, "text/plain", b"forbidden")
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
            if path.startswith("/assets/"):
                asset = assets.get(path[len("/assets/"):])
                if asset is None or path.endswith("index.html"):
                    return self._send(404, "text/plain", b"not found")
                return self._send(200, asset[1], asset[0], {"Cache-Control": "no-cache"})
            if not (path == base or path.startswith(base + "/")):
                return self._send(404, "text/plain", b"not found")
            rest = path[len(base):]
            if rest in ("", "/"):
                nonce = base64.b64encode(secrets.token_bytes(12)).decode()
                page = assets["index.html"][0].decode().replace("__NONCE__", nonce).encode()
                csp = (f"default-src 'self'; script-src 'self' 'nonce-{nonce}'; style-src 'self'; img-src 'self' data: blob:; "
                       "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'")
                return self._send(200, "text/html; charset=utf-8", page, {"Content-Security-Policy": csp})
            if viewer.closed:
                return self._send(404, "application/json", b'{"error": "This view has ended: its session is over."}')
            if rest == "/scene":
                return self._send(200, "application/json; charset=utf-8", viewer.scene_body(), {"Content-Encoding": "gzip"})
            if rest == "/events":
                return self._events()
            if rest.startswith("/export/"):
                name, _, ext = rest[len("/export/"):].rpartition(".")
                if ext.lower() not in EXPORTS:
                    return self._send(404, "text/plain", b"unknown format")
                got = viewer.export(ext.lower())
                if got is None:
                    return self._send(409, "text/plain", b"nothing to export")
                filename = (name or "model").replace('"', "") + "." + EXPORTS[ext.lower()][0]
                return self._send(200, got[1], got[0], {"Content-Disposition": f'attachment; filename="{filename}"'})
            return self._send(404, "text/plain", b"not found")

        def _events(self) -> None:
            self.send_response(200)
            for k, v in {**SAFE, "Content-Type": "text/event-stream", "Connection": "keep-alive"}.items():
                self.send_header(k, v)
            self.end_headers()
            self.close_connection = True
            seen = viewer.session.version
            try:
                self.wfile.write(b"event: hello\ndata: {}\n\n")
                self.wfile.flush()
                while not viewer.closed:
                    version = viewer.session.wait_for_change(seen, 15.0)
                    if viewer.closed:
                        break
                    if version != seen:
                        seen = version
                        self.wfile.write(f"event: scene\ndata: {json.dumps({'version': version})}\n\n".encode())
                    else:
                        self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                self.wfile.write(b"event: closed\ndata: {}\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return

    return Handler
