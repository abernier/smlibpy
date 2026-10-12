"""A lightweight 3D viewer: ``show(part)`` opens the model in the browser; in Jupyter,
shapes display inline. Rendering uses three.js (loaded from a CDN)."""

from __future__ import annotations

import base64
import html
import json
import os
import struct
import tempfile
import webbrowser
from typing import Any

import numpy as np

__all__ = ["show", "html_page"]

THREE_VERSION = "0.170.0"

_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #f3f4f6;
    font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  @media (prefers-color-scheme: dark) { html, body { background: #17191c; } }
  #hud { position: absolute; left: 14px; bottom: 12px; color: #6b7280; pointer-events: none; }
  #hud b { color: #374151; font-weight: 600; }
  @media (prefers-color-scheme: dark) { #hud { color: #9ca3af; } #hud b { color: #e5e7eb; } }
  #hint { position: absolute; right: 14px; bottom: 12px; color: #9ca3af; pointer-events: none; }
</style>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@__V__/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@__V__/examples/jsm/" } }
</script>
</head>
<body>
<div id="hud">__HUD__</div>
<div id="hint">drag to orbit &middot; right-drag to pan &middot; scroll to zoom &middot; F to frame</div>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const VIEW = __VIEW__;
const MARGIN = __MARGIN__;
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

let root = null;
function frame() {
  if (!root) return;
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1e-6);
  const dir = new THREE.Vector3(...VIEW).normalize();
  // camera basis: back = dir, right = up x back, up' = back x right
  const back = dir.clone();
  let right = new THREE.Vector3(0, 1, 0).cross(back);
  if (right.lengthSq() < 1e-12) right = new THREE.Vector3(1, 0, 0);
  right.normalize();
  const up = back.clone().cross(right).normalize();
  const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const tx = ty * camera.aspect;
  let d = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const c = new THREE.Vector3(x, y, z).sub(center);
    const along = c.dot(back);
    d = Math.max(d, Math.abs(c.dot(right)) / tx + along, Math.abs(c.dot(up)) / ty + along);
  }
  d *= MARGIN;
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, d);
  camera.near = Math.max(d - size, size * 1e-4) / 4; camera.far = d + size * 10;
  camera.updateProjectionMatrix();
  key.position.copy(center).add(new THREE.Vector3(1, 2, 1.5).multiplyScalar(size));
  key.target.position.copy(center);
}

new GLTFLoader().load("data:model/gltf-binary;base64,__GLB__", (gltf) => {
  root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) {
      o.material.polygonOffset = true;
      o.material.polygonOffsetFactor = 1;
      o.material.polygonOffsetUnits = 1;
    }
    if (o.isLineSegments || o.isLine) {
      if (dark && o.material.color.getHex() === 0x1f2328) o.material.color.setHex(0xd0d7de);
    }
    if (o.isPoints) o.material.size = 6, o.material.sizeAttenuation = false;
  });
  scene.add(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.z, size.y) * 2.5;
  const grid = new THREE.GridHelper(extent, 24, dark ? 0x30363d : 0xd5d9de, dark ? 0x23272d : 0xe4e7eb);
  grid.position.set(box.getCenter(new THREE.Vector3()).x, box.min.y - size.y * 0.001, box.getCenter(new THREE.Vector3()).z);
  scene.add(grid);
  frame();
  let frames = 0;
  renderer.setAnimationLoop(() => {
    controls.update(); renderer.render(scene, camera);
    if (++frames === 3) window.__ready = true;
  });
});
if (location.hash === "#clean") {
  document.getElementById("hud").style.display = "none";
  document.getElementById("hint").style.display = "none";
}

addEventListener("keydown", (e) => { if (e.key === "f" || e.key === "F") frame(); });
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
</script>
</body>
</html>
"""


def _glb_bytes(shapes: Any, tolerance: float | None, angle: float, edges: bool) -> tuple[bytes, str]:
    from .exporters import _z_up, gltf_document_mixed

    doc, buf, summary = gltf_document_mixed(shapes, tolerance=tolerance, angle=angle, edges=edges)
    _z_up(doc)
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    bin_ = buf + b"\0" * (-len(buf) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    out = struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
    out += struct.pack("<I4s", len(bin_), b"BIN\0") + bin_
    return out, summary


def html_page(*shapes: Any, title: str = "smlibpy", tolerance: float | None = None, angle: float = 12.0,
              edges: bool = True, view: Any = (1.0, -1.25, 0.75), margin: float = 1.1) -> str:
    """A self-contained HTML page showing the shapes.

    ``view`` is the direction from the model towards the camera (Z up).
    """
    glb, summary = _glb_bytes(list(shapes), tolerance, angle, edges)
    vx, vy, vz = (float(c) for c in view)
    page = _TEMPLATE.replace("__V__", THREE_VERSION).replace("__TITLE__", html.escape(title))
    page = page.replace("__VIEW__", f"[{vx}, {vz}, {-vy}]").replace("__MARGIN__", str(float(margin)))
    page = page.replace("__HUD__", summary).replace("__GLB__", base64.b64encode(glb).decode())
    return page


def _in_notebook() -> bool:
    try:
        from IPython import get_ipython  # type: ignore

        ip = get_ipython()
        return ip is not None and ip.__class__.__name__ == "ZMQInteractiveShell"
    except Exception:
        return False


def notebook_html(*shapes: Any, height: int = 480, **kwargs: Any) -> str:
    page = html_page(*shapes, **kwargs)
    return (f'<iframe srcdoc="{html.escape(page, quote=True)}" style="width:100%;height:{height}px;'
            f'border:0;border-radius:8px" loading="lazy"></iframe>')


def show(*shapes: Any, title: str = "smlibpy", path: str | None = None, open_browser: bool = True,
         tolerance: float | None = None, angle: float = 12.0, edges: bool = True) -> Any:
    """Show shapes (parts, sketches, faces, edges, wires, meshes, lists) in a 3D viewer.

    In Jupyter the viewer is displayed inline; elsewhere an HTML file is written (to
    ``path`` or a temporary file) and opened in the default browser. Returns the path,
    or the IPython display object in a notebook.
    """
    if _in_notebook() and path is None:
        from IPython.display import HTML, display  # type: ignore

        h = HTML(notebook_html(*shapes, title=title, tolerance=tolerance, angle=angle, edges=edges))
        display(h)
        return h
    page = html_page(*shapes, title=title, tolerance=tolerance, angle=angle, edges=edges)
    if path is None:
        fd, path = tempfile.mkstemp(prefix="smlibpy-", suffix=".html")
        os.close(fd)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(page)
    if open_browser:
        webbrowser.open("file://" + os.path.abspath(path))
    return path
