"""Buerligons as the viewer of an MCP session: the app (app.py), served on 127.0.0.1 together with
a session it connects to, answered the way a ClassCAD server answers (the twin of classcad-ai's
``packages/mcp/src/share/hub.ts`` and buerli's ``session/host.ts``, without a ClassCAD engine).

    GET /?invite=<token>               the app
    GET /assets/..., /favicon.svg ...  its files
    WS  /session/?invite=<token>       the session: the model tree and its graphic, live

The app joins in the view role (no modeling tools; Save writes STEP or STL). What a script
shows reaches every open app after each change; what the user selects there is kept for
``get_selection``; ``select`` highlights faces, edges or vertices for the user.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import secrets
import tempfile
import threading
import urllib.parse
import uuid
from pathlib import Path
from typing import Any

from .app import app_dir
from .session import Session

PREFERRED_PORT = 9310
HOST_PEER = "smlibpy"  # the session's own peer id on presence frames
ERROR = 51  # the message level at which the app rejects a request
PRESENCE_MAX_BYTES = 8 * 1024
RESERVED_CHANNELS = {"config", "leave"}
# what the app may save in, offered in this order (an app that knows only ClassCAD's formats offers
# STP and STL of them), as smlibpy's save calls them
SAVE_FORMATS = {"STP": "step", "STL": "stl", "GLB": "glb", "OBJ": "obj", "SMB": "smb"}
# what a ClassCAD server starts every connection with (buerli's session/host.ts)
DEFAULT_EMISSION: dict[str, bool | int] = {
    "sendStructure": True, "sendStructure_Patch": False, "sendStructure_Compressed": False,
    "sendStructure_Immediately": False, "sendStructure_ImmediatelyBinary": False, "sendGraphic_Kernel": True,
    "sendGraphic_StructureObj": True, "sendGraphic_Sketch": True, "sendGraphic_Invisible": True,
    "sendGraphic_Compressed": False, "sendGraphic_Immediately": False, "sendGraphic_ImmediatelyBinary": False,
    "sendGraphic_Multipackage": False, "sendGraphic_UseDraco": False, "sendGraphic_UseDracoHybrid": False,
    "sendGraphic_AdvancedNotifications": False, "sendMessages": True, "sendMessages_Immediately": False,
    "sendMessages_MinLevel": 31, "storeState": False, "safeApi": False,
}


class _Guest:
    def __init__(self, ws: Any) -> None:
        self.ws = ws
        self.peer = uuid.uuid4().hex
        self.config = dict(DEFAULT_EMISSION)
        self.presence: dict[str, Any] = {}
        self._send = threading.Lock()

    def send(self, frame: dict[str, Any] | str) -> None:
        text = frame if isinstance(frame, str) else json.dumps(frame, separators=(",", ":"))
        try:
            with self._send:
                self.ws.send(text)
        except Exception:  # a closed connection: its handler cleans up
            pass


class BuerliHost:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.token = secrets.token_urlsafe(18)
        self.guests: set[_Guest] = set()
        self.selection: list[dict[str, Any]] = []  # the last selection a guest published
        self.opened = False  # the link was handed out or opened
        self.closed = False
        self._lock = threading.Lock()
        self._scene: tuple[int, dict[str, Any]] = (-1, {})
        self._scene_lock = threading.Lock()
        self._files: dict[str, tuple[bytes, str]] = {}
        self._server: Any = None
        self._port = 0

    # -- the server ---------------------------------------------------------------
    @property
    def url(self) -> str:
        """The app's link. Raises app.AppUnavailable when the app cannot be had."""
        self.start()
        return f"http://127.0.0.1:{self._port}/?invite={self.token}"

    def start(self) -> None:
        if self._server is not None:
            return
        folder = app_dir()
        self._files = _read_files(folder)
        from websockets.sync.server import serve

        for port in (PREFERRED_PORT, 0):
            try:
                self._server = serve(self._serve, "127.0.0.1", port, process_request=self._http, server_header=None,
                                     max_size=8 * 1024 * 1024, ping_interval=20, ping_timeout=60)
                break
            except OSError:
                continue
        assert self._server is not None
        self._port = self._server.socket.getsockname()[1]
        threading.Thread(target=self._server.serve_forever, name="smlibpy-app", daemon=True).start()
        threading.Thread(target=self._follow, name="smlibpy-app-push", daemon=True).start()

    def close(self) -> None:
        self.closed = True
        self.session._bump()  # wakes the pusher
        if self._server is not None:
            self._server.shutdown()
            self._server = None

    def _http(self, connection: Any, request: Any) -> Any:
        """Plain requests get the app's files; the socket only with the invite of this session."""
        from websockets.datastructures import Headers
        from websockets.http11 import Response

        def reply(code: int, body: bytes, ctype: str = "text/plain; charset=utf-8", extra: dict[str, str] | None = None) -> Any:
            headers = Headers({"Content-Type": ctype, "Content-Length": str(len(body)), "X-Content-Type-Options": "nosniff",
                               "Referrer-Policy": "no-referrer", **(extra or {})})
            return Response(code, {200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found"}[code], headers, body)

        if request.headers.get("Host") not in (f"127.0.0.1:{self._port}", f"localhost:{self._port}"):
            return reply(403, b"forbidden")
        parts = urllib.parse.urlsplit(request.path)
        invite = urllib.parse.parse_qs(parts.query).get("invite", [""])[0] or request.headers.get("classcad-invite", "")
        path = urllib.parse.unquote(parts.path)
        if path in ("/session", "/session/"):
            if not secrets.compare_digest(invite, self.token) or self.closed:
                return reply(403, b"not a link of this session")
            if request.headers.get("Upgrade", "").lower() != "websocket":
                return reply(400, b"the session is a websocket")
            return None  # the handshake goes on
        if path in ("", "/", "/index.html"):
            if not secrets.compare_digest(invite, self.token):
                return reply(403, b"This link is not for this session (or the session is over).")
            body, ctype = self._files["index.html"]
            return reply(200, body, ctype, {"Cache-Control": "no-store"})
        found = self._files.get(path.lstrip("/"))
        if found is None or path.lstrip("/") == "index.html":
            return reply(404, b"not found")
        return reply(200, found[0], found[1], {"Cache-Control": "public, max-age=31536000, immutable"
                                                if path.startswith("/assets/") else "no-cache"})

    # -- one app ------------------------------------------------------------------
    def _serve(self, ws: Any) -> None:
        guest = _Guest(ws)
        with self._lock:
            others = list(self.guests)
            self.guests.add(guest)
        guest.send({"command": "SessionJoined", "role": "view", "inviteName": "smlibpy"})
        # what the session offers: Save in the formats smlibpy writes
        guest.send({"command": "Presence", "channel": "config", "peerId": HOST_PEER,
                    "data": {"saveFormats": list(SAVE_FORMATS)}})
        for other in others:  # what everyone already here last said
            for channel, data in other.presence.items():
                guest.send({"command": "Presence", "channel": channel, "peerId": other.peer, "data": data})
        try:
            for message in ws:
                if isinstance(message, bytes):
                    continue
                try:
                    frames = json.loads(message)
                except ValueError:
                    continue
                for frame in frames if isinstance(frames, list) else [frames]:
                    if isinstance(frame, dict):
                        self._frame(guest, frame, len(message))
        except Exception:  # the connection went away
            pass
        finally:
            with self._lock:
                self.guests.discard(guest)
                others = list(self.guests)
            for other in others:
                other.send({"command": "Presence", "channel": "leave", "peerId": guest.peer, "data": {}})

    def _frame(self, guest: _Guest, frame: dict[str, Any], size: int) -> None:
        name = str(frame.get("command"))
        if name == "Presence":
            return self._presence(guest, frame, size)
        tx = frame.get("transactionID")

        def answer(result: Any, **extra: Any) -> None:
            guest.send({"command": "Result", "_from_": name, "_transactionID_": tx, "result": result, **extra})

        if name == "GetEmissionConfig":
            return answer(dict(guest.config))
        if name == "SetEmissionConfig":
            wanted = frame.get("config") if isinstance(frame.get("config"), dict) else {}
            for key, value in wanted.items():
                if key in DEFAULT_EMISSION and type(value) is type(DEFAULT_EMISSION[key]):
                    guest.config[key] = value
            return answer(dict(guest.config))
        if name in ("GetTree", "Sync"):
            scene = self.scene()
            extra = {"structure": scene["structure"]}
            if guest.config.get("sendGraphic_Kernel") is not False:
                extra["graphic"] = scene["graphic"]
            return answer(scene["structure"], **extra)
        if name == "Execute":
            try:
                return answer(self._execute(frame))
            except Exception as e:
                return guest.send(_error(name, tx, str(e)))
        guest.send(_error(name, tx, f"{name} is not available in an smlibpy session: it shows what the agent's "
                                    "scripts build."))

    def _execute(self, frame: dict[str, Any]) -> Any:
        """The API calls an app makes on its own: database settings (accepted) and Save."""
        result = None
        for call in frame.get("task") or []:
            for api, args in (call.items() if isinstance(call, dict) else []):
                arg = args[0] if isinstance(args, list) and args and isinstance(args[0], dict) else {}
                if api == "v1.common.setDatabaseSettings":
                    result = None
                elif api == "v1.common.save":
                    result = self._save(str(arg.get("format", "STP")).upper())
                else:
                    raise ValueError(f"{api} is not available in an smlibpy session: the agent builds the model "
                                     "with scripts.")
        return result

    def _save(self, fmt: str) -> dict[str, str]:
        fmt = "STP" if fmt == "STEP" else fmt
        if fmt not in SAVE_FORMATS:
            raise ValueError(f"smlibpy does not save {fmt}; it saves {', '.join(SAVE_FORMATS)}")
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "model." + SAVE_FORMATS[fmt])
            res = self.session.call("save", 600.0, format=SAVE_FORMATS[fmt], path=path)
            if not res.get("ok"):
                raise ValueError(res.get("error", "nothing to save"))
            return {"content": base64.b64encode(Path(path).read_bytes()).decode()}

    def _presence(self, guest: _Guest, frame: dict[str, Any], size: int) -> None:
        channel, data = frame.get("channel"), frame.get("data")
        if not isinstance(channel, str) or channel in RESERVED_CHANNELS or not isinstance(data, dict):
            return
        if size > PRESENCE_MAX_BYTES:
            return
        guest.presence[channel] = data
        if channel == "selection":
            self.selection = [i for i in data.get("items") or [] if isinstance(i, dict)]
        text = json.dumps({"command": "Presence", "channel": channel, "peerId": guest.peer, "data": data})
        with self._lock:
            others = [g for g in self.guests if g is not guest]
        for other in others:
            other.send(text)

    # -- what the apps show -----------------------------------------------------------
    def scene(self) -> dict[str, Any]:
        """The model tree and graphic of what the session shows, rebuilt when it changed."""
        with self._scene_lock:
            version = self.session.version
            if self._scene[0] != version:
                answer = self.session.call("buerli_scene", 300.0)
                if not answer.get("ok"):
                    from .graphic import scene as empty

                    answer = empty([])
                self._scene = (version, {k: answer[k] for k in ("structure", "graphic")})
            return self._scene[1]

    def _follow(self) -> None:
        """Pushes the new model to every app after each change, as a tree nobody asked for."""
        seen = self.session.version
        while not self.closed:
            version = self.session.wait_for_change(seen, 15.0)
            if self.closed or version == seen:
                continue
            seen = version
            with self._lock:
                guests = list(self.guests)
            if not guests:
                continue
            scene = self.scene()
            frame = json.dumps({"command": "Result", "_from_": "GetTree", "_transactionID_": f"smlibpy-{version}",
                                "structure": scene["structure"], "graphic": scene["graphic"]}, separators=(",", ":"))
            for guest in guests:
                guest.send(frame)

    def select(self, targets: list[dict[str, Any]], replace: bool = True) -> int:
        """Asks every app to select ``targets`` (container and element ids, or tree objects)."""
        request = uuid.uuid4().hex
        with self._lock:
            guests = list(self.guests)
        for data in ({"id": request, "items": targets[:500], "replace": replace}, {"id": request, "done": True}):
            text = json.dumps({"command": "Presence", "channel": "select", "peerId": HOST_PEER, "data": data})
            for guest in guests:
                guest.send(text)
        return len(guests)


def _error(name: str, tx: Any, message: str) -> dict[str, Any]:
    import time

    return {"command": "Result", "_from_": name, "_transactionID_": tx, "maxLevel": ERROR,
            "messages": [{"message": message, "level": ERROR, "levelStr": "ERROR", "code": 0,
                          "timestamp": int(time.time() * 1000)}]}


def _read_files(folder: Path) -> dict[str, tuple[bytes, str]]:
    files = {}
    for f in folder.rglob("*"):
        if f.is_file() and not f.name.startswith("."):
            ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "image/svg+xml"):
                ctype += "; charset=utf-8"
            files[f.relative_to(folder).as_posix()] = (f.read_bytes(), ctype)
    return files
