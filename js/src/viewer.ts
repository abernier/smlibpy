// A lightweight 3D viewer: `show(part)` opens the model in the browser (Node); `htmlPage(part)`
// gives the page itself, for an iframe in a browser app. Rendering uses three.js (loaded from a
// CDN).

import { _base64, _fs, _zUp, gltfDocumentMixed } from './exporters.ts'
import { _withOptions } from './curves.ts'

// biome-ignore lint: glTF documents are plain JSON
type Any = any

export const THREE_VERSION = '0.170.0'

const _TEMPLATE = `<!doctype html>
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
`

/** A binary glTF of the shapes (Z up, as modeled) and the one-line summary for the page. */
function _glbBytes(shapes: unknown, tolerance: number | null, angle: number, edges: boolean): [Uint8Array, string] {
  const [doc, buf, summary] = gltfDocumentMixed(shapes, { tolerance, angle, edges })
  _zUp(doc)
  const text = new TextEncoder().encode(JSON.stringify(doc))
  const js = new Uint8Array(text.length + (-text.length & 3)).fill(0x20)
  js.set(text)
  const bin = new Uint8Array(buf.length + (-buf.length & 3))
  bin.set(buf)
  const total = 12 + 8 + js.length + 8 + bin.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  out.set([0x67, 0x6c, 0x54, 0x46]) // "glTF"
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, js.length, true)
  out.set([0x4a, 0x53, 0x4f, 0x4e], 16) // "JSON"
  out.set(js, 20)
  view.setUint32(20 + js.length, bin.length, true)
  out.set([0x42, 0x49, 0x4e, 0x00], 24 + js.length) // "BIN\0"
  out.set(bin, 28 + js.length)
  return [out, summary]
}

/** Python's html.escape (quotes too). */
function _escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')
}

/** A number as Python's float prints it ("1.0", "-1.25"): the page reads it as JavaScript. */
function _float(v: number): string {
  return Number.isInteger(v) && Math.abs(v) < 1e16 ? v.toFixed(1) : String(v)
}

/** The options of `htmlPage`. */
export interface PageOptions {
  /** The page title (default "smlibjs"). */
  title?: string
  /** Tessellation tolerance; default 0.1 % of each body's size. */
  tolerance?: number | null
  /** Largest angle between neighbouring triangle normals on curved faces, degrees (default 12). */
  angle?: number
  /** Draw the B-rep edges (default true). */
  edges?: boolean
  /** The direction from the model towards the camera, Z up (default [1, -1.25, 0.75]). */
  view?: readonly [number, number, number]
  /** Room around the model when it is framed (default 1.1). */
  margin?: number
}

/**
 * A self-contained HTML page showing the shapes: `htmlPage(part)`, `htmlPage(a, b, { title })`.
 *
 * The page loads three.js from a CDN; the model is inside it (a binary glTF as a data URL). Show it
 * in an iframe (`iframe.srcdoc = htmlPage(part)`) or save it as a file.
 *
 * @param args Parts, sketches, faces, edges, wires, meshes, or lists of them, and last the options
 *   (see `PageOptions`).
 */
export function htmlPage(...args: unknown[]): string {
  const { items: shapes, options } = _withOptions<PageOptions>(args)
  const { title = 'smlibjs', tolerance = null, angle = 12.0, edges = true, view = [1.0, -1.25, 0.75], margin = 1.1 } = options
  const [glb, summary] = _glbBytes(shapes, tolerance, angle, edges)
  const [vx, vy, vz] = Array.from(view, Number)
  // (functions as replacements: the texts are taken as they are, "$" patterns and all)
  let page = _TEMPLATE.replaceAll('__V__', () => THREE_VERSION).replaceAll('__TITLE__', () => _escape(String(title)))
  page = page.replaceAll('__VIEW__', () => `[${_float(vx)}, ${_float(vz)}, ${_float(-vy)}]`).replaceAll('__MARGIN__', () => _float(Number(margin)))
  page = page.replaceAll('__HUD__', () => summary).replaceAll('__GLB__', () => _base64(glb))
  return page
}

/** The options of `show`. */
export interface ShowOptions {
  /** The page title (default "smlibjs"). */
  title?: string
  /** Where to write the page (default: a new temporary file). */
  path?: string | null
  /** Open the page in the default browser (default true). */
  openBrowser?: boolean
  /** Tessellation tolerance; default 0.1 % of each body's size. */
  tolerance?: number | null
  /** Largest angle between neighbouring triangle normals on curved faces, degrees (default 12). */
  angle?: number
  /** Draw the B-rep edges (default true). */
  edges?: boolean
}

// A module of Node's, through process.getBuiltinModule (no static node: imports: bundlers for
// the browser do not trip over them); null outside Node.
function _builtin(name: string): Any {
  const proc = (globalThis as Any).process
  return typeof proc?.getBuiltinModule === 'function' ? (proc.getBuiltinModule(name) ?? null) : null
}

/**
 * Show shapes (parts, sketches, faces, edges, wires, meshes, lists) in a 3D viewer:
 * `show(part)`, `show(a, b, { title })`.
 *
 * Writes the page (`htmlPage`) to `path` or a temporary file and opens it in the default browser.
 * Needs Node; in a browser app, show `htmlPage(...)` in an iframe instead.
 *
 * @param args The shapes, and last the options (see `ShowOptions`).
 * @returns The path of the page.
 */
export function show(...args: unknown[]): string {
  const { items: shapes, options } = _withOptions<ShowOptions>(args)
  const { title = 'smlibjs', openBrowser = true, tolerance = null, angle = 12.0, edges = true } = options
  let { path = null } = options
  if (!_builtin('node:fs')) throw new Error('show needs Node.js to write the page and open a browser; in a browser app, show htmlPage(...) in an iframe')
  const fs = _fs()
  const page = htmlPage(shapes, { title, tolerance, angle, edges })
  if (path == null) {
    const os = _builtin('node:os')
    const nodePath = _builtin('node:path')
    // a new file of our own, as Python's tempfile.mkstemp
    for (;;) {
      const name = nodePath.join(os.tmpdir(), `smlibjs-${Math.random().toString(36).slice(2, 10)}.html`)
      try {
        fs.closeSync(fs.openSync(name, 'wx', 0o600))
        path = name as string
        break
      } catch (e) {
        if ((e as Any)?.code !== 'EEXIST') throw e
      }
    }
  }
  fs.writeFileSync(path, page, 'utf8')
  if (openBrowser) _openInBrowser(_builtin('node:url').pathToFileURL(_builtin('node:path').resolve(path)).href)
  return path
}

/** Open a URL in the default browser, as Python's webbrowser.open: quietly, without waiting
 * (`open` on macOS, `start` on Windows, `xdg-open` elsewhere). */
function _openInBrowser(url: string): void {
  const childProcess = _builtin('node:child_process')
  const platform = (globalThis as Any).process.platform
  const windows = platform === 'win32'
  // (cmd takes the quoted URL as one argument, as it is)
  const [command, args] = platform === 'darwin' ? ['open', [url]] : windows ? ['cmd', ['/s', '/c', 'start', '""', '/b', `"${url}"`]] : ['xdg-open', [url]]
  try {
    const child = childProcess.spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: windows })
    child.on('error', () => {}) // (no browser to open: as webbrowser.open, not an error)
    child.unref()
  } catch {
    // (as above)
  }
}
