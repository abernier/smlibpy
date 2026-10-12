"""The live viewer of an MCP session: a page on 127.0.0.1 that shows what the session shows
and updates itself after every script.

GET /v/<token>/            the page (three.js, loaded from a CDN)
GET /v/<token>/scene.glb   the current model as binary glTF (summary in X-Summary)
GET /v/<token>/events      server-sent events: "scene" with the version, on every change
"""

from __future__ import annotations

import secrets
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from ..viewer import THREE_VERSION
from .session import Session

PREFERRED_PORT = 9310


class LiveViewer:
    def __init__(self, session: Session):
        self.session = session
        self.token = secrets.token_urlsafe(12)
        self._server: ThreadingHTTPServer | None = None
        self._glb: tuple[int, bytes | None, str] = (-1, None, "")
        self._glb_lock = threading.Lock()
        self.opened = False  # the link was handed out or opened

    @property
    def url(self) -> str:
        self.start()
        assert self._server is not None
        return f"http://127.0.0.1:{self._server.server_address[1]}/v/{self.token}/"

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

    def scene_glb(self) -> tuple[int, bytes | None, str]:
        with self._glb_lock:
            version = self.session.version
            if self._glb[0] != version:
                answer = self.session.call("glb")
                if answer.get("ok"):
                    self._glb = (version, answer.get("glb"), answer.get("summary", ""))
                else:
                    self._glb = (version, None, answer.get("error", ""))
            return self._glb

    def close(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server = None


def _handler(viewer: LiveViewer) -> type[BaseHTTPRequestHandler]:
    base = f"/v/{viewer.token}/"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:  # quiet: stderr belongs to the MCP host
            pass

        def _local(self) -> bool:
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            return host in ("127.0.0.1", "localhost", "[::1]")

        def do_GET(self) -> None:  # noqa: N802
            path = urllib.parse.urlsplit(self.path).path
            if not self._local() or not path.startswith(base):
                self.send_error(404)
                return
            rest = path[len(base):]
            if rest == "":
                body = _PAGE.replace("__V__", THREE_VERSION).encode()
                self._send(200, "text/html; charset=utf-8", body)
            elif rest == "scene.glb":
                version, glb, summary = viewer.scene_glb()
                if glb is None:
                    self._send(204, "text/plain", b"", {"X-Version": str(version), "X-Summary": urllib.parse.quote(summary)})
                else:
                    self._send(200, "model/gltf-binary", glb,
                               {"X-Version": str(version), "X-Summary": urllib.parse.quote(summary)})
            elif rest == "events":
                self._events()
            else:
                self.send_error(404)

        def _send(self, code: int, ctype: str, body: bytes, headers: dict[str, str] | None = None) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def _events(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            seen = -1
            try:
                while True:
                    version = viewer.session.wait_for_change(seen, 15.0)
                    if version != seen:
                        self.wfile.write(f"event: scene\ndata: {version}\n\n".encode())
                        seen = version
                    else:
                        self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return

    return Handler


_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>smlibpy</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #f3f4f6;
    font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  @media (prefers-color-scheme: dark) { html, body { background: #17191c; } }
  #hud { position: absolute; left: 14px; bottom: 12px; color: #6b7280; pointer-events: none; }
  #hud b { color: #374151; font-weight: 600; }
  #state { position: absolute; left: 14px; top: 12px; color: #6b7280; pointer-events: none; }
  #state i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #2fbf71;
    margin-right: 6px; vertical-align: 1px; }
  @media (prefers-color-scheme: dark) { #hud, #state { color: #9ca3af; } #hud b { color: #e5e7eb; } }
  #hint { position: absolute; right: 14px; bottom: 12px; color: #9ca3af; pointer-events: none; }
</style>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@__V__/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@__V__/examples/jsm/" } }
</script>
</head>
<body>
<div id="state"><i></i><span>smlibpy · waiting for a model</span></div>
<div id="hud"></div>
<div id="hint">drag to orbit · right-drag to pan · scroll to zoom · F to frame</div>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const VIEW = [1.0, 0.75, 1.25];
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(dark ? 0x17191c : 0xf3f4f6);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
const key = new THREE.DirectionalLight(0xffffff, 0.6);
scene.add(key);
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.01, 1e7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;

let root = null, grid = null, framed = false;
const loader = new GLTFLoader();
const state = document.querySelector("#state span");
const hud = document.getElementById("hud");

function frame() {
  if (!root) return;
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1e-6);
  const back = new THREE.Vector3(...VIEW).normalize();
  let right = new THREE.Vector3(0, 1, 0).cross(back);
  if (right.lengthSq() < 1e-12) right = new THREE.Vector3(1, 0, 0);
  right.normalize();
  const up = back.clone().cross(right).normalize();
  const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), tx = ty * camera.aspect;
  let d = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const c = new THREE.Vector3(x, y, z).sub(center), along = c.dot(back);
    d = Math.max(d, Math.abs(c.dot(right)) / tx + along, Math.abs(c.dot(up)) / ty + along);
  }
  d *= 1.12;
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(back, d);
  camera.near = Math.max(d - size, size * 1e-4) / 4; camera.far = d + size * 10;
  camera.updateProjectionMatrix();
  key.position.copy(center).add(new THREE.Vector3(1, 2, 1.5).multiplyScalar(size));
}

function dispose(o) {
  o.traverse((c) => { c.geometry?.dispose(); if (c.material) [].concat(c.material).forEach((m) => m.dispose()); });
}

async function load(version) {
  const res = await fetch("scene.glb?v=" + version, { cache: "no-store" });
  const summary = decodeURIComponent(res.headers.get("X-Summary") || "");
  if (root) { scene.remove(root); dispose(root); root = null; }
  if (grid) { scene.remove(grid); dispose(grid); grid = null; }
  if (res.status === 204) { state.textContent = "smlibpy · waiting for a model"; hud.innerHTML = summary; return; }
  const gltf = await loader.parseAsync(await res.arrayBuffer(), "");
  root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) { o.material.polygonOffset = true; o.material.polygonOffsetFactor = 1; o.material.polygonOffsetUnits = 1; }
    if ((o.isLineSegments || o.isLine) && dark && o.material.color.getHex() === 0x1f2328) o.material.color.setHex(0xd0d7de);
    if (o.isPoints) { o.material.size = 6; o.material.sizeAttenuation = false; }
  });
  scene.add(root);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  grid = new THREE.GridHelper(Math.max(size.x, size.y, size.z) * 2.5, 24, dark ? 0x30363d : 0xd5d9de, dark ? 0x23272d : 0xe4e7eb);
  grid.position.set(box.getCenter(new THREE.Vector3()).x, box.min.y - size.y * 0.001, box.getCenter(new THREE.Vector3()).z);
  scene.add(grid);
  if (!framed) { frame(); framed = true; }
  hud.innerHTML = summary;
  state.textContent = "smlibpy · live · update " + version;
}

const events = new EventSource("events");
events.addEventListener("scene", (e) => load(e.data).catch((err) => { state.textContent = "smlibpy · " + err; }));
events.onerror = () => { state.textContent = "smlibpy · reconnecting"; };
addEventListener("keydown", (e) => { if (e.key === "f" || e.key === "F") frame(); });
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
window.smlibpyViewer = { scene, camera, controls, renderer, frame, get root() { return root; } };
</script>
</body>
</html>
"""
