// PNG pictures of shapes, rendered in software: no browser, no GPU, no extra packages.
//
// The renderer tessellates the shapes, fills a depth buffer with their triangles, shades every
// pixel and draws the B-rep edges on top where they are not hidden. Besides the shaded view it
// draws technical drawings (visible lines solid, hidden lines dashed), sheets of several views,
// sections with hatched cut faces, x-ray views, highlighted faces and edges, markers and a
// measurement overlay, and it compares two pictures pixel by pixel. It is meant for quick looks,
// documentation and agents that need to see what they built; `show` gives the interactive 3D
// view.
//
// The same input gives the same pixels: views are fixed, orthographic and fitted to the shapes,
// and nothing depends on an earlier call.
//
// Images are flat typed arrays, row by row from the top left, three numbers (red, green, blue)
// per pixel; points and segments are flat arrays of x, y, z.

import { _opts, ext, k as kernel } from './kernel.ts'
import { BoundBox, Plane, Vector, type VectorLike, _formatG } from './geometry.ts'
import { toRgb } from './colors.ts'
import { Mesh, _coloredMesh, _tessellate, _triangleColors, _triangulate, tessellate } from './mesh.ts'
import { type ColorLike, Edge, Face, Part, Shape, Sketch, Vertex, Wire, _Body as Solidish, _typeName } from './shapes.ts'
import { _withOptions } from './curves.ts'
import { _DEFAULT_COLORS, _curvePoints, _edgePolylines, _flattenAll, _fs } from './exporters.ts'
import { StepModel } from './step_import.ts'

// biome-ignore lint: shapes and options of any kind
type Any = any

type Vec3 = [number, number, number]
type RGB = readonly [number, number, number]

/** The frame of a single view: output pixels per model unit, and the projected point in the
 * middle of the picture. */
export interface Frame {
  scale: number
  midX: number
  midY: number
}

const inspect = Symbol.for('nodejs.util.inspect.custom')

// Python's math.radians and math.degrees (one multiplication by a rounded constant).
const _rad = (deg: number): number => deg * (Math.PI / 180)
const _deg = (rad: number): number => rad * (180 / Math.PI)

// Named views as turntable angles (azimuth, elevation) in degrees, Z up: azimuth 0 looks from
// the front (camera at -Y), 90 from the right (camera at +X); elevation 90 from above.
const _TURNTABLE: Record<string, [number, number]> = {
  iso: [45.0, _deg(Math.atan(1 / Math.sqrt(2)))], // 35.264: a true isometric view
  front: [0.0, 0.0],
  back: [180.0, 0.0],
  right: [90.0, 0.0],
  left: [-90.0, 0.0],
  top: [0.0, 90.0],
  bottom: [0.0, -90.0],
}

function _towardsCamera(az: number, el: number): Vec3 {
  const a = _rad(az)
  const e = _rad(el)
  const v: Vec3 = [Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)]
  return v.map((c) => (Math.abs(c) < 1e-12 ? 0.0 : c)) as Vec3
}

/** Named views: the direction from the model towards the camera (Z up). */
export const VIEWS: Readonly<Record<string, readonly [number, number, number]>> = Object.freeze(
  Object.fromEntries(Object.entries(_TURNTABLE).map(([name, [az, el]]) => [name, Object.freeze(_towardsCamera(az, el))])),
)

const _ORTHO = ['front', 'back', 'left', 'right', 'top', 'bottom']
const _gray255 = (v: number): RGB => [v / 255, v / 255, v / 255]
export const _EDGE: RGB = [0.12, 0.14, 0.16]
const _INK: RGB = _gray255(20)
const _HIDDEN_INK: RGB = _gray255(95)
const _HATCH_INK: RGB = _gray255(70)
/** The color of labels and of the measurement overlay. */
export const _LABEL: RGB = _gray255(70)
const _ORANGE: RGB = [1.0, 0.45, 0.05] // highlighted faces and bodies
const _RED: RGB = [230 / 255, 40 / 255, 30 / 255] // highlighted edges
const _MARKER: RGB = [220 / 255, 30 / 255, 30 / 255]
const _OVERLAY: RGB = [0 / 255, 90 / 255, 220 / 255] // sketches drawn over solids
const _DIVIDER: RGB = _gray255(190)
export const _WHITE: RGB = [1, 1, 1]
const _FIT = 0.88 // share of the picture the shapes fill
export const _MAX_CANVAS = 1 << 24 // subpixels of a supersampled picture; larger pictures get a lower factor
const _CAPTION = 34 // pixels kept free under the iso view of a drawing, for the projection method
const _CURVATURES = ['gaussian', 'mean', 'max', 'min']
// blue (concave) - white (flat) - red (convex), positions 0 to 1 with 0.5 = zero curvature
const _CURVATURE_STOPS = [0.0, 0.25, 0.5, 0.75, 1.0]
const _CURVATURE_COLORS: readonly RGB[] = [
  [59, 76, 192],
  [141, 176, 254],
  [236, 236, 236],
  [244, 154, 123],
  [180, 4, 38],
].map(([r, g, b]) => [r / 255, g / 255, b / 255] as RGB)
const _ZEBRA_DARK: RGB = [0.08, 0.08, 0.09]
const _ZEBRA_LIGHT: RGB = [0.97, 0.97, 0.97]
const _ZEBRA_EDGE: RGB = [0.5, 0.5, 0.5]

// -------------------------------------------------------------------------------- small helpers
/** numpy's rint: to the nearest integer, halves to the even one. */
export function _rint(x: number): number {
  const r = Math.round(x)
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** Python's round() of a number: an integer, halves to the even one. */
const _pyRound = _rint

/** numpy's round(x, 6). */
function _round6(x: number): number {
  return _rint(x * 1e6) / 1e6
}

/** Python's % of numbers: the result has the sign of the divisor. */
function _mod(a: number, b: number): number {
  const m = a % b
  return m !== 0 && m < 0 !== b < 0 ? m + b : m
}

function _clip01(x: number): number {
  return Math.min(Math.max(x, 0), 1)
}

function _norm3(v: ArrayLike<number>): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

function _dot3(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function _cross3(a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function _unit(v: ArrayLike<number>): Vec3 {
  const n = _norm3(v)
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** The dot products of flat points (x, y, z each) with a direction. */
function _dots(points: Float64Array, d: ArrayLike<number>): Float64Array {
  const n = points.length / 3
  const out = new Float64Array(n)
  const [d0, d1, d2] = [d[0], d[1], d[2]]
  for (let i = 0; i < n; i++) out[i] = points[i * 3] * d0 + points[i * 3 + 1] * d1 + points[i * 3 + 2] * d2
  return out
}

function _min(a: ArrayLike<number>): number {
  let m = Infinity
  for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]
  return m
}

function _max(a: ArrayLike<number>): number {
  let m = -Infinity
  for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]
  return m
}

function _ptp(a: ArrayLike<number>): number {
  return _max(a) - _min(a)
}

function _concat(arrays: readonly Float64Array[]): Float64Array {
  let n = 0
  for (const a of arrays) n += a.length
  const out = new Float64Array(n)
  let at = 0
  for (const a of arrays) {
    out.set(a, at)
    at += a.length
  }
  return out
}

function _isPlainObject(v: unknown): v is Record<string, Any> {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function _isNumber(v: unknown): v is number {
  return typeof v === 'number'
}

/** The value as it reads in a message. */
function _repr(x: unknown): string {
  if (typeof x === 'string') return `'${x}'`
  if (Array.isArray(x) || ArrayBuffer.isView(x)) return `[${Array.from(x as ArrayLike<unknown>, _repr).join(', ')}]`
  if (_isPlainObject(x)) return `{${Object.entries(x).map(([key, v]) => `${key}: ${_repr(v)}`).join(', ')}}`
  return String(x)
}

// A module of Node's, through process.getBuiltinModule (no static node: imports: bundlers for
// the browser do not trip over them); null outside Node.
function _builtin(name: string): Any {
  const proc = (globalThis as Any).process
  return typeof proc?.getBuiltinModule === 'function' ? (proc.getBuiltinModule(name) ?? null) : null
}

// -------------------------------------------------------------------------------- results
/** Pixels to compare: `width * height` pixels row by row, 3 or 4 numbers each (RGB or RGBA; a
 * canvas's ImageData is one). `data` holds bytes (a Uint8Array or Uint8ClampedArray) or numbers
 * from 0 to 1 (any other array). */
export interface ImageLike {
  width: number
  height: number
  data: ArrayLike<number>
}

interface _RGBImage {
  pixels: Uint8Array
  width: number
  height: number
}

/**
 * A render: the PNG file contents and what the render knows about itself.
 *
 * - `data`: the PNG file contents.
 * - `pixels`: the picture, `width * height` pixels row by row from the top left, three bytes
 *   (red, green, blue) each.
 * - `frame`: the frame of a single view, `{ scale, midX, midY }`: output pixels per model unit,
 *   and the projected point in the middle of the picture. Pass it as the `frame` option to a
 *   later render of the same view and size to get pictures that compare pixel by pixel. `null`
 *   for sheets and drawings.
 */
export class Picture {
  readonly data: Uint8Array
  readonly pixels: Uint8Array
  readonly width: number
  readonly height: number
  readonly frame: Frame | null

  /** A picture of PNG file contents; `image` gives its pixels when they are at hand (otherwise
   * the PNG is decoded). */
  constructor(data: Uint8Array, image: _RGBImage | null = null, frame: Frame | null = null) {
    const img = image ?? _pngDecode(data)
    this.data = data
    this.pixels = img.pixels
    this.width = img.width
    this.height = img.height
    this.frame = frame
  }

  /** Write the PNG file (Node). */
  save(path: string): void {
    _fs().writeFileSync(path, this.data)
  }

  toString(): string {
    const f = this.frame
    return `Picture(${this.width} x ${this.height}, frame=${f ? `{scale: ${f.scale}, midX: ${f.midX}, midY: ${f.midY}}` : 'null'})`
  }

  [inspect](): string {
    return this.toString()
  }
}

/**
 * The result of `diffImages`.
 *
 * - `changed`: number of pixels that differ.
 * - `total`: number of pixels.
 * - `fraction`: `changed / total`.
 * - `bbox`: `[x0, y0, x1, y1]` of the changed pixels (inclusive), or `null`.
 * - `picture`: a `Picture` of the difference: changed pixels red on a faded gray of the second
 *   picture.
 */
export class ImageDiff {
  readonly changed: number
  readonly total: number
  readonly fraction: number
  readonly bbox: [number, number, number, number] | null
  readonly picture: Picture

  constructor(changed: number, total: number, fraction: number, bbox: [number, number, number, number] | null, picture: Picture) {
    this.changed = changed
    this.total = total
    this.fraction = fraction
    this.bbox = bbox
    this.picture = picture
  }

  /** Write the picture of the difference as a PNG file (Node). */
  save(path: string): void {
    this.picture.save(path)
  }

  toString(): string {
    return `ImageDiff(changed=${this.changed}, fraction=${_formatG(this.fraction, 4)}, bbox=${this.bbox ? `[${this.bbox.join(', ')}]` : 'null'})`
  }

  [inspect](): string {
    return this.toString()
  }
}

// -------------------------------------------------------------------------------- public functions
/** What `render` draws: parts, sketches, sheets, faces, edges, wires and vertices, meshes, a read
 * STEP file (`readStep`), or lists of them (an array, a ShapeList, a Set; also nested). */
export type Renderable = Shape | Mesh | StepModel | (Iterable<Renderable> & object)

/** A camera of `render` (see `RenderOptions.view`): a view's name, `{ azimuth, elevation }` in
 * degrees, `{ direction, up }`, or the direction from the model towards the camera. (Any string
 * type-checks, as names come from variables too; the names are checked when it renders.) */
export type RenderView =
  | 'iso'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | (string & {})
  | VectorLike
  | { azimuth?: number; elevation?: number }
  | { direction: VectorLike; up?: VectorLike | null }

/** A point of `render`'s options: a Vector, `[x, y, z]`, or the center of a shape or box. */
export type RenderPoint = VectorLike | Shape | BoundBox

/** A marker of `render` (see `RenderOptions.markers`): a point, `[point, label]`,
 * `[point, label, color]` or `{ position, label, color }`. */
export type RenderMarker =
  | RenderPoint
  | readonly [RenderPoint, string]
  | readonly [RenderPoint, string, ColorLike | null]
  | { position: RenderPoint; label?: string; color?: ColorLike | null }

/** The kinds of curvature `render` maps (see `RenderOptions.curvature`). */
export type CurvatureKind = 'mean' | 'gaussian' | 'max' | 'min' | (string & {})

/** The options of `render`. */
export interface RenderOptions {
  /** Also write the PNG to this file (Node). */
  path?: string | null
  /**
   * The camera, orthographic, Z up:
   *
   * - a name: `"iso"` (default; a true isometric view from front, right and above), `"front"`,
   *   `"back"`, `"left"`, `"right"`, `"top"`, `"bottom"`;
   * - `{ azimuth: a, elevation: e }` in degrees: azimuth 0 looks from the front, 90 from the
   *   right (+X); elevation 90 from above. `"iso"` is azimuth 45, elevation 35.264; `"right"` is
   *   azimuth 90;
   * - `{ direction: [x, y, z], up: [x, y, z] }`: the direction the camera looks in (from the
   *   camera towards the model); `up` defaults to Z;
   * - `[x, y, z]` (or a Vector): the direction from the model towards the camera;
   * - `"sheet"`: the same as `drawing: "first-angle"`.
   *
   * Views are never mirrored.
   */
  view?: RenderView | 'sheet'
  /** Width and height in pixels (default [800, 600]). */
  size?: readonly [number, number]
  /** Draw the edges of faces in the shaded view (hidden edges stay hidden). */
  edges?: boolean
  /** Background color (default "white"). */
  background?: string | readonly number[]
  /** Tessellation tolerance; default 0.1 % of each body's size. */
  tolerance?: number | null
  /** Factor on the scale that fits the shapes (2 shows half as much). */
  zoom?: number
  /** A point that lands in the middle of the picture. */
  lookAt?: RenderPoint | null
  /** The frame of an earlier render of the same view and size (its `Picture.frame`, or the
   * picture itself): scale and middle stay the same, so pictures of a changed model compare
   * pixel by pixel (`diffImages`). Overrides `zoom` and `lookAt`. */
  frame?: Frame | Picture | Record<string, number> | readonly number[] | null
  /** Render at this many times the size and average down (1 to 4); 2 (default) gives smooth
   * edges. Very large pictures get a lower factor (16 million subpixels at most). */
  supersample?: number
  /** `"native"`: each shape's own color, or a palette color by its position; `"distinct"`: a
   * palette color per body, also per solid of a part. */
  colors?: 'native' | 'distinct'
  /** Line style instead of shading: no fill, visible edges and silhouettes solid, hidden ones
   * dashed. Applies to the single view and every panel of a sheet. */
  lines?: boolean
  /** A technical drawing: front, top and side view in line style, aligned at one scale, and a
   * shaded iso view in the free corner. `true` or `"first-angle"` (ISO 5456-2 method E): the top
   * view below the front view, the view from the left to its right. `"third-angle"` (method A):
   * the top view above the front view, the view from the right to its right.
   * `{ projection, side: "left" | "right", iso: boolean }` picks the side view or leaves the
   * corner empty. */
  drawing?: boolean | 'first-angle' | 'third-angle' | (string & {}) | { projection?: string; side?: string; iso?: boolean } | null
  /** Several shaded views in one picture: `true` (top, iso, front, right), a list of 4 views
   * (2 x 2) or of 2 views side by side. Named ortho views share one scale; the others fit
   * themselves. `drawing` wins over `sheet`. */
  sheet?: boolean | readonly (RenderView | null)[] | null
  /** Cut at a plane and leave out what is on the positive side of its normal: a `Plane`, a
   * planar face, `[origin, normal]` or `{ origin, normal, cap }`. The picture keeps the framing
   * of the whole model. */
  section?:
    | Plane
    | Face
    | readonly [Face]
    | readonly [RenderPoint, VectorLike]
    | { origin: RenderPoint; normal: VectorLike; cap?: boolean }
    | false
    | null
  /** Fill the cut faces of closed bodies, hatched at 45 degrees (neighbouring bodies alternate
   * the direction); bores and pockets stay open. `false` leaves the cut open and shows the
   * inside walls shaded darker. */
  cap?: boolean
  /** Shapes drawn in signal colors: faces and bodies orange, edges red. Faces, edges, wires,
   * parts, vertices or selections (`part.edges().concave()`). */
  highlight?: Shape | Mesh | readonly (Shape | Mesh | readonly (Shape | Mesh)[])[] | null
  /** Points; the face closest to each point is highlighted. */
  highlightAt?: VectorLike | Iterable<RenderPoint> | null
  /** Crosshairs with labels, drawn on top: points `[x, y, z]`, `[point, label]` (or
   * `[point, label, color]`), or `{ position, label, color }`. */
  markers?: VectorLike | { position: RenderPoint; label?: string; color?: ColorLike | null } | Iterable<RenderMarker> | null
  /** Measurement overlay: the size of the bounding box (`"60 X 54 X 34"`), the axes as seen in
   * the view (an axis pointing into the screen is left out) and a scale bar of a round length. */
  annotate?: boolean
  /** Translucent bodies: hidden faces shine through, edges stay opaque. */
  xray?: boolean
  /** Opacity of each face in the x-ray view (0 to 1, default 0.42). */
  xrayAlpha?: number
  /** Zebra stripes: the reflection of parallel light lines on the shaded surfaces, from the exact
   * surface normals. Stripes break where surfaces meet with a gap or an edge (G0), kink where they
   * meet tangentially (G1, a circular fillet) and run smoothly across curvature-continuous joints
   * (G2). `true`, or `{ stripes: 16, width: 0.5, direction: "vertical" }`: the number of black
   * stripes around the light, the black share of each, and the direction of the light lines
   * (`"vertical"` or `"horizontal"` on the screen, or a world direction). Surfaces that curve
   * along the light lines show none; turn the direction for them. */
  zebra?: boolean | { stripes?: number; width?: number; direction?: 'vertical' | 'horizontal' | (string & {}) | VectorLike } | null
  /** A curvature map of the exact surfaces: `"mean"`, `"gaussian"`, `"max"` or `"min"` (the
   * principal curvatures). Blue is concave, white flat, red convex (a sphere of radius R has 1/R
   * everywhere); a legend gives the range in 1/mm (1/mm^2 for Gaussian).
   * `{ kind: "mean", range: 0.2 }` (or `[lo, hi]`) fixes the range; by default it spans the
   * values on the shapes. */
  curvature?: CurvatureKind | { kind?: CurvatureKind; range?: number | readonly [number, number] | null } | false | null
}

/**
 * Render shapes to a PNG image: `render(part)`, `render(a, b, { view: 'front' })`.
 *
 * The options combine: a sectioned drawing with highlights and markers is fine.
 *
 * @param args Parts, sketches, shells, faces, edges, wires, meshes, or lists of them, and last the
 *   options (see `RenderOptions`). Edges, wires, and sketches shown together with solids, are
 *   drawn on top of everything at their place in space. A read STEP file (`readStep`) draws its
 *   bodies and curves, and marks its coordinate systems and named points.
 * @returns A `Picture`: the PNG file contents (`data`), with `pixels` and `frame`.
 */
export function render(...shapes: Renderable[]): Picture
export function render(...args: [...shapes: Renderable[], options: RenderOptions]): Picture
export function render(...args: unknown[]): Picture {
  const { items, options } = _withOptions<RenderOptions>(args)
  _opts('render', options)
  const {
    path = null,
    view = 'iso',
    size = [800, 600],
    edges = true,
    background = 'white',
    tolerance = null,
    zoom = 1.0,
    lookAt = null,
    frame = null,
    supersample = 2,
    colors = 'native',
    lines = false,
    cap = true,
    highlight = null,
    highlightAt = null,
    markers = null,
    annotate = false,
    xray = false,
    xrayAlpha = 0.42,
    zebra = false,
    curvature = null,
  } = options
  let { drawing = false } = options
  const { sheet = false, section = null } = options

  const w = Math.trunc(Number(size[0]))
  const h = Math.trunc(Number(size[1]))
  if (!(w >= 1 && h >= 1)) throw new RangeError(`size must be positive, got ${_repr(size)}`)
  let k = Math.trunc(Number(supersample))
  if (!(1 <= k && k <= 4)) throw new RangeError(`supersample must be 1 to 4, got ${_repr(supersample)}`)
  k = Math.max(1, Math.min(k, Math.trunc(Math.sqrt(_MAX_CANVAS / (w * h)))))
  if (colors !== 'native' && colors !== 'distinct') throw new RangeError(`colors must be 'native' or 'distinct', got ${_repr(colors)}`)
  if (!(0 < Number(xrayAlpha) && Number(xrayAlpha) < 1)) throw new RangeError(`xrayAlpha must be between 0 and 1, got ${_repr(xrayAlpha)}`)
  if (typeof view === 'string' && view.trim().toLowerCase() === 'sheet') drawing = drawing || true
  const stripes = _zebraSpec(zebra)
  const curv = _curvatureSpec(curvature)
  const [shapes, stepMarkers] = _stepModelsDrawn(items)
  const opts: _Options = {
    k,
    bg: toRgb(background as string),
    edges: Boolean(edges),
    lines: Boolean(lines),
    xray: Boolean(xray) && !lines,
    alpha: Number(xrayAlpha),
    section: _section(section, Boolean(cap)),
    markers: [..._markers(markers), ..._markers(stepMarkers)],
    annotate: Boolean(annotate),
    zebra: stripes,
    curvature: null,
    legend: true,
  }
  const scene = new _Scene(shapes, tolerance, colors, Boolean(stripes || curv))
  let used: Frame | null = null
  let img: _Img
  try {
    scene.addHighlights(highlight, highlightAt)
    if (curv !== null) opts.curvature = [curv[0], ...scene.curvatureRange(curv[0], curv[1])]
    if (drawing != null && drawing !== false) img = _drawing(scene, w, h, opts, drawing)
    else if (sheet != null && sheet !== false) img = _sheet(scene, _sheetViews(sheet), w, h, opts)
    else {
      const cam = _Camera.of(view)
      used = _frame(frame) ?? _fit(scene, cam, w, h, zoom, lookAt)
      img = _view(scene, cam, w, h, opts, used)
    }
  } finally {
    scene.dispose()
  }
  const pixels = _toBytes(img)
  const pic = new Picture(_png(pixels, w, h), { pixels, width: w, height: h }, used ? { ...used } : null)
  if (path != null) pic.save(path)
  return pic
}

/**
 * Compare two pictures of the same size pixel by pixel.
 *
 * Meaningful for two renders of the same view with a pinned frame (the `frame` of the first):
 * without it, a changed model is fitted anew and every pixel moves.
 *
 * @param a A picture from `render`, PNG file contents (`Uint8Array`), a PNG file path (Node), or
 *   pixels (`{ width, height, data }`, see `ImageLike`).
 * @param b The picture to compare with, in any of the same forms.
 * @param tolerance Largest difference per color channel (0 to 255) that still counts as equal.
 * @returns An `ImageDiff`: the number, share and bounding box of the changed pixels, and a picture
 *   of the difference (changed pixels red on a faded gray of `b`).
 */
export function diffImages(a: Picture | ImageLike | Uint8Array | ArrayBuffer | string, b: Picture | ImageLike | Uint8Array | ArrayBuffer | string, tolerance = 0): ImageDiff {
  const pa = _pixelsOf(a)
  const pb = _pixelsOf(b)
  if (pa.width !== pb.width || pa.height !== pb.height) {
    throw new RangeError(`diffImages: the pictures differ in size (${pa.width} x ${pa.height} and ${pb.width} x ${pb.height})`)
  }
  const { width: w, height: h } = pb
  const tol = Math.trunc(Number(tolerance))
  const out = new Uint8Array(w * h * 3)
  let n = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const A = pa.pixels
  const B = pb.pixels
  for (let p = 0; p < w * h; p++) {
    const i = p * 3
    const changed = Math.abs(A[i] - B[i]) > tol || Math.abs(A[i + 1] - B[i + 1]) > tol || Math.abs(A[i + 2] - B[i + 2]) > tol
    if (changed) {
      out[i] = 220
      out[i + 1] = 30
      out[i + 2] = 30
      n++
      const x = p % w
      const y = (p - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    } else {
      const lum = B[i] * 0.299 + B[i + 1] * 0.587 + B[i + 2] * 0.114
      const gray = _rint(255 - (255 - lum) * 0.25)
      out[i] = out[i + 1] = out[i + 2] = gray
    }
  }
  const total = w * h
  const bbox: [number, number, number, number] | null = n ? [x0, y0, x1, y1] : null
  return new ImageDiff(n, total, n / total, bbox, new Picture(_png(out, w, h), { pixels: out, width: w, height: h }))
}

function _pixelsOf(img: unknown): _RGBImage {
  if (img instanceof Picture) return { pixels: img.pixels, width: img.width, height: img.height }
  if (img instanceof Uint8Array || img instanceof ArrayBuffer) return _pngDecode(img instanceof ArrayBuffer ? new Uint8Array(img) : img)
  if (typeof img === 'string') return _pngDecode(new Uint8Array(_fs().readFileSync(img)))
  if (img !== null && typeof img === 'object' && 'width' in img && 'height' in img && 'data' in img) {
    const { width, height, data } = img as ImageLike
    const w = Math.trunc(width)
    const h = Math.trunc(height)
    const channels = w * h > 0 ? data.length / (w * h) : 3
    if (!(channels === 3 || channels === 4)) throw new RangeError(`diffImages: ${data.length} numbers for ${w} x ${h} pixels (3 or 4 per pixel)`)
    const bytes = data instanceof Uint8Array || data instanceof Uint8ClampedArray
    const f = data instanceof Float32Array ? Math.fround : (x: number) => x
    const pixels = new Uint8Array(w * h * 3)
    for (let p = 0; p < w * h; p++) {
      for (let c = 0; c < 3; c++) {
        const v = data[p * channels + c]
        pixels[p * 3 + c] = bytes ? v : Math.min(Math.max(f(f(v * 255) + 0.5), 0), 255)
      }
    }
    return { pixels, width: w, height: h }
  }
  throw new TypeError(`diffImages takes pictures, PNG data, PNG file paths or images ({width, height, data}), got ${_typeName(img)}`)
}

// -------------------------------------------------------------------------------- options
class _Cut {
  readonly origin: Vec3
  readonly normal: Vec3
  readonly cap: boolean

  constructor(origin: Vec3, normal: Vec3, cap: boolean) {
    this.origin = origin
    this.normal = normal
    this.cap = cap
  }

  /** The signed distance of a point from the plane. */
  distance(p: ArrayLike<number>, at = 0): number {
    const o = this.origin
    const n = this.normal
    return (p[at] - o[0]) * n[0] + (p[at + 1] - o[1]) * n[1] + (p[at + 2] - o[2]) * n[2]
  }
}

interface _ZebraSpec {
  stripes: number
  width: number
  direction: string | Vec3
}

export interface _Options {
  k: number
  bg: RGB
  edges: boolean
  lines: boolean
  xray: boolean
  alpha: number
  section: _Cut | null
  markers: [Vec3, string, RGB][]
  annotate: boolean
  zebra: _ZebraSpec | null
  /** The kind and the range of the color map. */
  curvature: [string, number, number] | null
  /** Draw the legend of the curvature map. */
  legend: boolean
}

function _panel(o: _Options, lines: boolean, legend = true): _Options {
  return { ...o, lines, xray: o.xray && !lines, legend }
}

function _zebraSpec(zebra: unknown): _ZebraSpec | null {
  if (zebra == null || zebra === false) return null
  const spec: Record<string, Any> = _isPlainObject(zebra) ? { ...zebra } : {}
  const unknown = Object.keys(spec).filter((key) => !['stripes', 'width', 'direction'].includes(key))
  if (unknown.length || !(zebra === true || _isPlainObject(zebra))) {
    throw new RangeError(`zebra takes true or an object of stripes, width and direction, got ${_repr(zebra)}`)
  }
  const stripes = Math.trunc(Number(spec.stripes ?? 16))
  const width = Number(spec.width ?? 0.5)
  let direction: string | Vec3 = spec.direction ?? 'vertical'
  if (!(stripes >= 1)) throw new RangeError(`zebra: stripes must be at least 1, got ${stripes}`)
  if (!(0 < width && width < 1)) throw new RangeError(`zebra: width is the black share of a stripe, between 0 and 1, got ${width}`)
  if (typeof direction === 'string') {
    if (direction !== 'vertical' && direction !== 'horizontal') {
      throw new RangeError(`zebra: direction is 'vertical', 'horizontal' or a vector, got ${_repr(direction)}`)
    }
  } else {
    direction = _vec3(direction)
    if (_norm3(direction) < 1e-12) throw new RangeError('zebra: the direction has no length')
  }
  return { stripes, width, direction }
}

/** The kind of a curvature map and its range (`null`: from the values on the shapes). */
export function _curvatureSpec(curvature: unknown): [string, [number, number] | null] | null {
  if (curvature == null || curvature === false) return null
  let kind: unknown
  let span: unknown
  if (typeof curvature === 'string') [kind, span] = [curvature, null]
  else if (_isPlainObject(curvature)) [kind, span] = [curvature.kind ?? 'mean', curvature.range ?? null]
  else throw new RangeError(`curvature takes 'mean', 'gaussian', 'max', 'min' or an object, got ${_repr(curvature)}`)
  const name = String(kind).toLowerCase()
  if (!_CURVATURES.includes(name)) throw new RangeError(`curvature: the kinds are ${_CURVATURES.join(', ')}, got ${_repr(name)}`)
  let range: [number, number] | null = null
  if (span != null) {
    const [lo, hi] = _isNumber(span) ? [-Math.abs(span), Math.abs(span)] : [Number((span as Any)[0]), Number((span as Any)[1])]
    if (!(hi > lo)) throw new RangeError(`curvature: the range must be [low, high], got ${_repr(span)}`)
    range = [lo, hi]
  }
  return [name, range]
}

export function _vec3(p: unknown): Vec3 {
  let v: unknown = p
  if (p instanceof Vector) v = p.toArray()
  else if (p instanceof BoundBox) v = p.center.toArray()
  else if (p instanceof Shape) v = p.center().toArray()
  const ok = (Array.isArray(v) || ArrayBuffer.isView(v)) && (v as ArrayLike<unknown>).length === 3
  const out = ok ? (Array.from(v as ArrayLike<unknown>, Number) as Vec3) : null
  if (out === null || !out.every(Number.isFinite)) throw new RangeError(`expected a point [x, y, z], got ${_repr(p)}`)
  return out
}

function _section(section: unknown, cap: boolean): _Cut | null {
  if (section == null || section === false) return null
  if (Array.isArray(section) && section.length && section.every((f) => f instanceof Shape)) {
    if (section.length !== 1) throw new TypeError(`section takes one planar face, got ${section.length} shapes`)
    section = section[0]
  }
  let origin: unknown
  let normal: unknown
  if (_isPlainObject(section)) {
    if (!('origin' in section) || !('normal' in section)) throw new RangeError(`section: an object needs origin and normal, got ${_repr(section)}`)
    ;[origin, normal] = [section.origin, section.normal]
    cap = Boolean(section.cap ?? cap)
  } else if (section instanceof Plane) {
    ;[origin, normal] = [section.origin, section.zDir]
  } else if (section instanceof Face) {
    const plane = new Plane(section)
    ;[origin, normal] = [plane.origin, plane.zDir]
  } else if (Array.isArray(section) && section.length === 2) {
    ;[origin, normal] = section
  } else {
    throw new TypeError(`section takes a Plane, a planar Face, [origin, normal] or {origin, normal}, got ${_repr(section)}`)
  }
  const n = _vec3(normal)
  const length = _norm3(n)
  if (length < 1e-12) throw new RangeError('section: the normal has no length')
  return new _Cut(_vec3(origin), [n[0] / length, n[1] / length, n[2] / length], Boolean(cap))
}

/** The shapes with each `StepModel` (from `readStep`) replaced by its bodies and curves, and
 * markers for its coordinate systems and named points. */
function _stepModelsDrawn(shapes: unknown[]): [unknown[], { position: Vector; label: string }[]] {
  if (!shapes.some((s) => s instanceof StepModel)) return [shapes, []]
  const out: unknown[] = []
  const markers: { position: Vector; label: string }[] = []
  for (const s of shapes) {
    if (!(s instanceof StepModel)) {
      out.push(s)
      continue
    }
    out.push(...s.bodies)
    out.push(...s.curves.map((c) => c.shape))
    markers.push(...s.frames.map((f) => ({ position: f.plane.origin, label: f.name })))
    markers.push(...s.points.filter((p) => p.name).map((p) => ({ position: p.point, label: p.name })))
  }
  return [out, markers]
}

function _markers(markers: unknown): [Vec3, string, RGB][] {
  if (markers == null) return []
  let list: unknown[]
  if (_isPlainObject(markers) || _isPoint(markers)) list = [markers]
  else list = Array.from(markers as Iterable<unknown>)
  const out: [Vec3, string, RGB][] = []
  for (const m of list) {
    let label = ''
    let color: RGB = _MARKER
    let pos: unknown
    if (_isPlainObject(m)) {
      pos = m.position
      label = String(m.label || '')
      if (m.color != null) color = toRgb(m.color)
    } else if (Array.isArray(m) && (m.length === 2 || m.length === 3) && !_isNumber(m[0])) {
      ;[pos, label] = [m[0], String(m[1] || '')]
      if (m.length === 3 && m[2] != null) color = toRgb(m[2])
    } else {
      pos = m
    }
    out.push([_vec3(pos), label, color])
  }
  return out
}

function _isPoint(p: unknown): boolean {
  if (p instanceof Vector) return true
  if (!(Array.isArray(p) || ArrayBuffer.isView(p)) || (p as ArrayLike<unknown>).length !== 3) return false
  return Array.from(p as ArrayLike<unknown>).every(_isNumber)
}

function _frame(frame: unknown): Frame | null {
  if (frame == null) return null
  if (frame instanceof Picture) {
    if (frame.frame === null) throw new RangeError('frame: this picture has no frame (sheets and drawings have none)')
    frame = frame.frame
  }
  let out: Frame
  if (_isPlainObject(frame)) {
    const mx = frame.midX ?? frame.mid_x
    const my = frame.midY ?? frame.mid_y
    if (frame.scale == null || mx == null || my == null) throw new RangeError(`frame needs scale, midX and midY, got ${_repr(frame)}`)
    out = { scale: Number(frame.scale), midX: Number(mx), midY: Number(my) }
  } else if (Array.isArray(frame) && frame.length === 3) {
    const [s, mx, my] = frame
    out = { scale: Number(s), midX: Number(mx), midY: Number(my) }
  } else {
    throw new RangeError(`frame needs scale, midX and midY, got ${_repr(frame)}`)
  }
  if (!(out.scale > 0)) throw new RangeError(`frame: the scale must be positive, got ${out.scale}`)
  return out
}

// -------------------------------------------------------------------------------- cameras
/** An orthographic camera: screen right, screen up, and `back` towards the camera. */
export class _Camera {
  readonly back: Vec3
  readonly right: Vec3
  readonly up: Vec3
  label: string | null

  constructor(back: ArrayLike<number>, right: ArrayLike<number> | null = null, label: string | null = null) {
    let b: Vec3 = [Number(back[0]), Number(back[1]), Number(back[2])]
    if (!b.every(Number.isFinite) || _norm3(b) < 1e-12) throw new RangeError(`view: the direction (${b.join(', ')}) has no length`)
    const bn = _norm3(b)
    b = [b[0] / bn, b[1] / bn, b[2] / bn]
    let r: Vec3
    if (right === null) {
      r = _cross3([0.0, 0.0, 1.0], b)
      if (_norm3(r) < 1e-9) r = [1.0, 0.0, 0.0] // straight down or up: X stays to the right
    } else {
      r = [Number(right[0]), Number(right[1]), Number(right[2])]
      const rb = _dot3(r, b)
      r = [r[0] - b[0] * rb, r[1] - b[1] * rb, r[2] - b[2] * rb]
    }
    const rn = _norm3(r)
    r = [r[0] / rn, r[1] / rn, r[2] / rn]
    const u = _cross3(b, r)
    const un = _norm3(u)
    this.back = b
    this.right = r
    this.up = [u[0] / un, u[1] / un, u[2] / un]
    this.label = label
  }

  static of(view: unknown): _Camera {
    if (typeof view === 'string') {
      const name = view.trim().toLowerCase()
      if (!(name in _TURNTABLE)) throw new RangeError(`unknown view ${_repr(view)}; the names are ${Object.keys(_TURNTABLE).join(', ')} and 'sheet'`)
      const cam = _Camera.turntable(..._TURNTABLE[name])
      cam.label = name.toUpperCase()
      return cam
    }
    if (_isPlainObject(view)) {
      if (view.direction != null) {
        let f = _vec3(view.direction)
        const up = view.up != null ? _vec3(view.up) : ([0.0, 0.0, 1.0] as Vec3)
        if (_norm3(f) < 1e-12) throw new RangeError('view: the direction has no length')
        const fn = _norm3(f)
        f = [f[0] / fn, f[1] / fn, f[2] / fn]
        const r = _cross3(f, up)
        return new _Camera([-f[0], -f[1], -f[2]], _norm3(r) > 1e-3 * _norm3(up) ? r : null)
      }
      if ('azimuth' in view || 'elevation' in view) return _Camera.turntable(Number(view.azimuth || 0.0), Number(view.elevation || 0.0))
      throw new RangeError(`view: an object needs azimuth and elevation, or a direction; got ${_repr(view)}`)
    }
    return new _Camera(_vec3(view))
  }

  static turntable(azimuth: number, elevation: number): _Camera {
    const a = _rad(azimuth)
    return new _Camera(_towardsCamera(azimuth, elevation), [Math.cos(a), Math.sin(a), 0.0])
  }

  /** Screen x, screen y and depth (towards the camera) of flat points. */
  project(points: Float64Array): [Float64Array, Float64Array, Float64Array] {
    return [_dots(points, this.right), _dots(points, this.up), _dots(points, this.back)]
  }
}

/** The frame that fits the scene into w x h pixels. */
export function _fit(scene: _Scene, cam: _Camera, w: number, h: number, zoom = 1.0, lookAt: unknown = null): Frame {
  if (!(zoom > 0)) throw new RangeError(`zoom must be positive, got ${_repr(zoom)}`)
  const x = _dots(scene.points, cam.right)
  const y = _dots(scene.points, cam.up)
  const spanX = Math.max(_ptp(x), 1e-9)
  const spanY = Math.max(_ptp(y), 1e-9)
  const scale = Math.min((w * _FIT) / spanX, (h * _FIT) / spanY) * Number(zoom)
  let mx: number
  let my: number
  if (lookAt != null) {
    const p = _vec3(lookAt)
    mx = _dot3(p, cam.right)
    my = _dot3(p, cam.up)
  } else {
    mx = (_max(x) + _min(x)) / 2
    my = (_max(y) + _min(y)) / 2
  }
  return { scale, midX: mx, midY: my }
}

// -------------------------------------------------------------------------------- scene
/** The triangles of one body (corner normals, one color) and its edges, in world space. Flat
 * arrays: nine numbers per triangle (three corners), six per segment. */
class _Body {
  readonly tris: Float64Array
  readonly norms: Float64Array
  readonly rgb: RGB
  readonly closed: boolean
  readonly segs: Float64Array
  readonly mesh: Mesh | null
  readonly source: unknown // keeps the Brep alive that the mesh points into
  readonly faceRgb: Float64Array | null // per triangle, where faces have colors of their own (kernel plan T5)
  _adjacent: [Int32Array, Int32Array, Float64Array] | null = null
  _principal: [Float64Array, Float64Array] | null = null

  constructor(
    tris: Float64Array,
    norms: Float64Array,
    rgb: RGB,
    closed: boolean,
    segs: Float64Array,
    mesh: Mesh | null = null,
    source: unknown = null,
    faceRgb: Float64Array | null = null,
  ) {
    this.tris = tris
    this.norms = norms
    this.rgb = rgb
    this.closed = closed
    this.segs = segs
    this.mesh = mesh
    this.source = source
    this.faceRgb = faceRgb
  }

  get count(): number {
    return this.tris.length / 9
  }

  /** Curvature of the exact surface at every triangle corner (three numbers per triangle); NaN
   * where there is no exact surface (a mesh). */
  curvature(kind: string): Float64Array {
    if (this._principal === null) this._principal = _cornerCurvatures(this.mesh, this.source, this.count)
    const [k1, k2] = this._principal
    const out = new Float64Array(k1.length)
    for (let i = 0; i < out.length; i++) {
      if (kind === 'gaussian') out[i] = k1[i] * k2[i]
      else if (kind === 'mean') out[i] = (k1[i] + k2[i]) / 2
      else if (kind === 'max') out[i] = k1[i]
      else out[i] = k2[i]
    }
    return out
  }

  /** Mesh edges shared by exactly two triangles: the two triangles and the end points (six
   * numbers per edge). Corners that round to the same point (9 digits of the size) are one. */
  adjacency(): [Int32Array, Int32Array, Float64Array] {
    if (this._adjacent === null) this._adjacent = _adjacency(this.tris)
    return this._adjacent
  }
}

// An open-addressing hash table of integer triples (or pairs): the index of each distinct key.
class _KeyIndex {
  readonly keys: Int32Array
  readonly width: number
  size = 0
  private readonly table: Int32Array
  private readonly mask: number

  constructor(capacity: number, width: number) {
    let cap = 16
    while (cap < capacity * 2) cap *= 2
    this.table = new Int32Array(cap).fill(-1)
    this.mask = cap - 1
    this.keys = new Int32Array(capacity * width)
    this.width = width
  }

  /** The index of the key (a new one if it is new). */
  index(a: number, b: number, c = 0): number {
    const w = this.width
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & this.mask
    const keys = this.keys
    for (;;) {
      const id = this.table[h]
      if (id < 0) break
      const at = id * w
      if (keys[at] === a && keys[at + 1] === b && (w < 3 || keys[at + 2] === c)) return id
      h = (h + 1) & this.mask
    }
    const id = this.size++
    keys[id * w] = a
    keys[id * w + 1] = b
    if (w > 2) keys[id * w + 2] = c
    this.table[h] = id
    return id
  }
}

function _adjacency(tris: Float64Array): [Int32Array, Int32Array, Float64Array] {
  const nv = tris.length / 3
  const nt = nv / 3
  let size = 0
  for (let i = 0; i < tris.length; i++) size = Math.max(size, Math.abs(tris[i]))
  if (!nv) size = 1.0
  const q = Math.max(size * 1e-9, 1e-300)
  // corners that round to the same point are one vertex; its first corner gives its coordinates
  const vertices = new _KeyIndex(nv, 3)
  const ids = new Int32Array(nv)
  const first = new Int32Array(nv)
  for (let i = 0; i < nv; i++) {
    const known = vertices.size
    const id = vertices.index(_rint(tris[i * 3] / q) | 0, _rint(tris[i * 3 + 1] / q) | 0, _rint(tris[i * 3 + 2] / q) | 0)
    if (vertices.size > known) first[id] = i
    ids[i] = id
  }
  // the mesh edges, in Python's order (all first edges of the triangles, then all second, then
  // all third): per edge the first two triangles and the number of triangles
  const edges = new _KeyIndex(3 * nt, 2)
  const firstTri = new Int32Array(3 * nt)
  const secondTri = new Int32Array(3 * nt)
  const count = new Int32Array(3 * nt)
  const ends = new Int32Array(3 * nt * 2)
  for (let j = 0; j < 3; j++) {
    for (let t = 0; t < nt; t++) {
      let a = ids[t * 3 + j]
      let b = ids[t * 3 + ((j + 1) % 3)]
      if (a === b) continue
      if (a > b) [a, b] = [b, a]
      const e = edges.index(a, b)
      if (count[e] === 0) {
        firstTri[e] = t
        ends[e * 2] = a
        ends[e * 2 + 1] = b
      } else if (count[e] === 1) secondTri[e] = t
      count[e]++
    }
  }
  // Python sorts the vertices by their rounded coordinates; a segment runs from the smaller to
  // the larger (the order of the edges themselves does not change the picture)
  const vk = vertices.keys
  const less = (a: number, b: number): boolean => {
    for (let c = 0; c < 3; c++) if (vk[a * 3 + c] !== vk[b * 3 + c]) return vk[a * 3 + c] < vk[b * 3 + c]
    return false
  }
  let m = 0
  for (let e = 0; e < edges.size; e++) if (count[e] === 2) m++
  const t0 = new Int32Array(m)
  const t1 = new Int32Array(m)
  const pts = new Float64Array(m * 6)
  let i = 0
  for (let e = 0; e < edges.size; e++) {
    if (count[e] !== 2) continue
    t0[i] = firstTri[e]
    t1[i] = secondTri[e]
    let [a, b] = [ends[e * 2], ends[e * 2 + 1]]
    if (less(b, a)) [a, b] = [b, a]
    for (let c = 0; c < 3; c++) {
      pts[i * 6 + c] = tris[first[a] * 3 + c]
      pts[i * 6 + 3 + c] = tris[first[b] * 3 + c]
    }
    i++
  }
  return [t0, t1, pts]
}

interface _AxisLine {
  foot: Vec3
  direction: Vec3
  t0: number
  t1: number
  radius: number
}

/** Bodies, curves drawn on top, highlights, and the points that count for the fit. */
export class _Scene {
  readonly bodies: _Body[] = []
  /** Segments and their color, drawn on top. */
  readonly overlays: [Float64Array, RGB][] = []
  /** The shapes whose faces highlightAt searches. */
  readonly items: Any[] = []
  readonly hlTris: [Float64Array, Float64Array][] = []
  readonly hlSegs: Float64Array[] = []
  readonly hlPoints: Vec3[] = []
  /** Per body: the index in items of the shape it comes from. */
  readonly owners: number[] = []
  readonly tolerance: number | null
  _axes: _AxisLine[] | null = null
  /** What the scene made in the kernel: kept meshes, copies of faces (see `dispose`). */
  readonly _made: { dispose(): void }[] = []
  readonly points: Float64Array
  readonly lo: Vec3
  readonly hi: Vec3
  readonly diagonal: number

  constructor(shapes: unknown, tolerance: number | null, colors: string, fine = false) {
    this.tolerance = tolerance
    const items: Any[] = _flattenAll(shapes)
    const solids = items.some((it) => it instanceof Mesh || it instanceof Face || (it instanceof Solidish && !(it instanceof Sketch)))
    const palette = (_DEFAULT_COLORS as readonly string[]).map((c) => toRgb(c))
    items.forEach((item, i) => {
      const own = item.color ?? null
      const native: RGB = own != null ? toRgb(own) : palette[i % palette.length]
      if (item instanceof Edge || item instanceof Wire) {
        this.overlays.push([_segments(_curvePoints(item)), [native[0] * 0.75, native[1] * 0.75, native[2] * 0.75]])
        return
      }
      if (item instanceof Sketch && solids) {
        // a sketch over solids: its curves on top
        const color = own != null ? toRgb(own) : _OVERLAY
        this.overlays.push([_segments(_edgePolylines(item)), color])
        return
      }
      let pieces: Any[]
      let closed: boolean
      if (item instanceof Mesh) [pieces, closed] = [[item], item.isClosed()]
      else if (item instanceof Part) {
        pieces = [...item.solids()]
        if (!pieces.length) pieces = [item]
        closed = item._solidProblem() === null
      } else if (item instanceof Solidish || item instanceof Face) [pieces, closed] = [[item], false]
      else return
      this.items.push(item)
      for (const piece of pieces) {
        const rgb = colors === 'distinct' ? palette[this.bodies.length % palette.length] : native
        // zebra stripes and curvature maps follow the normals closely: finer triangles
        const source = piece instanceof Face && fine ? piece.toShell() : piece
        if (source !== piece) this._made.push(source)
        // (curvature maps need the tessellation's own mesh)
        let mesh: Mesh
        let faceRgb: Float64Array | null = null
        if (piece instanceof Mesh) mesh = piece
        else if (fine) {
          mesh = _tessellate(source, tolerance, 5.0, true)
          if (source instanceof Solidish && colors !== 'distinct') faceRgb = _triangleColors(source, mesh)
        } else {
          ;[mesh, faceRgb] = _coloredMesh(source as Shape, tolerance, 15.0)
          if (colors === 'distinct') faceRgb = null
        }
        if (faceRgb !== null) for (let i = 0; i < faceRgb.length; i++) if (Number.isNaN(faceRgb[i])) faceRgb[i] = rgb[i % 3] // faces without a color of their own: the body's
        if (mesh !== piece) this._made.push(mesh)
        let segs: Float64Array
        if (piece instanceof Mesh) segs = new Float64Array(0)
        else if (piece instanceof Face) segs = _segments(_curvePoints(piece))
        else segs = _segments(_edgePolylines(piece))
        if (mesh.triangles.length === 0) {
          if (segs.length) this.overlays.push([segs, _EDGE])
          continue
        }
        const [v, n] = _meshArrays(mesh)
        this.bodies.push(new _Body(v, n, rgb, closed, segs, mesh, piece instanceof Mesh ? null : source, faceRgb))
        this.owners.push(this.items.length - 1)
      }
    })
    const pts = [...this.bodies.map((b) => b.tris), ...this.bodies.map((b) => b.segs), ...this.overlays.map(([s]) => s)]
    const allp = _concat(pts)
    if (allp.length === 0) throw new RangeError('nothing to render')
    this.points = allp
    const triPts = this.bodies.length ? _concat(this.bodies.map((b) => b.tris)) : allp
    this.lo = _boxOf(triPts, Math.min)
    this.hi = _boxOf(triPts, Math.max)
    const plo = _boxOf(allp, Math.min)
    const phi = _boxOf(allp, Math.max)
    this.diagonal = _norm3([phi[0] - plo[0], phi[1] - plo[1], phi[2] - plo[2]]) || 1.0
  }

  /** Frees what the scene made in the kernel (the garbage collector would, much later). */
  dispose(): void {
    for (const m of this._made.splice(0).reverse()) m.dispose()
  }

  /** The range of a curvature map: the given one, or the values on the bodies; it always holds
   * zero, the white of the map. */
  curvatureRange(kind: string, span: readonly [number, number] | null): [number, number] {
    if (span === null) {
      let lo = Infinity
      let hi = -Infinity
      for (const b of this.bodies) {
        const values = b.curvature(kind)
        for (let i = 0; i < values.length; i++) {
          const v = values[i]
          if (!Number.isFinite(v)) continue
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      if (lo > hi) [lo, hi] = [0.0, 0.0]
      // a side under a thousandth of the other is noise (a plane, the end of a blend): zero
      const noise = 1e-3 * Math.max(Math.abs(lo), Math.abs(hi))
      span = [lo < -noise ? lo : 0.0, hi > noise ? hi : 0.0]
    }
    return [Math.min(span[0], 0.0), Math.max(span[1], 0.0)]
  }

  /** The axes of round features, for center lines: from the circles and arcs of at least half a
   * turn among the edges, one entry per axis line with a point on it, its direction, the range
   * of the circles along it and their largest radius. */
  axes(): _AxisLine[] {
    if (this._axes === null) {
      const found = new Map<string, _AxisLine>()
      const q = this.diagonal * 1e-6
      for (const item of this.items) {
        if (typeof item.edges !== 'function') continue
        for (const e of item.edges()) {
          const circle = _circleOf(e)
          if (circle === null) continue
          const [c, d0, r] = circle
          let d = _unit(d0)
          // (numpy's argmax: the first of equal largest components)
          let big = 0
          for (let i = 1; i < 3; i++) if (Math.abs(d[i]) > Math.abs(d[big])) big = i
          if (!(d[big] > 0)) d = [-d[0], -d[1], -d[2]]
          const cd = _dot3(c, d)
          const foot: Vec3 = [c[0] - cd * d[0], c[1] - cd * d[1], c[2] - cd * d[2]] // the point of the axis line nearest the origin
          const key = [...d.map((x) => _rint(x * 1e6) / 1e6), ...foot.map((x) => _rint(x / q))].map((x) => (x === 0 ? 0 : x)).join(',')
          let entry = found.get(key)
          if (entry === undefined) {
            entry = { foot, direction: d, t0: Infinity, t1: -Infinity, radius: 0.0 }
            found.set(key, entry)
          }
          const t = _dot3(c, d)
          entry.t0 = Math.min(entry.t0, t)
          entry.t1 = Math.max(entry.t1, t)
          entry.radius = Math.max(entry.radius, r)
        }
      }
      this._axes = [...found.values()]
    }
    return this._axes
  }

  addHighlights(highlight: unknown, highlightAt: unknown): void {
    const tol = this.tolerance ?? this.diagonal * 1e-3
    const faces: Face[] = []
    if (highlight != null) {
      const items: unknown[] = Array.isArray(highlight) ? highlight : [highlight]
      const bad = items.filter((s) => !(s instanceof Shape || s instanceof Mesh || Array.isArray(s))).map(_typeName)
      if (bad.length) throw new TypeError(`highlight takes shapes or lists of them, got ${bad[0]}`)
      for (const s of _flattenAll(items) as unknown[]) {
        if (s instanceof Vertex) this.hlPoints.push(_vec3(s))
        else if (s instanceof Edge || s instanceof Wire) this.hlSegs.push(_segments(_curvePoints(s)))
        else if (s instanceof Face) faces.push(s)
        else if (s instanceof Mesh) this._addMesh(s)
        else if (s instanceof Solidish) this._addMesh(tessellate(s, tol))
        else if (!(s instanceof Shape)) throw new TypeError(`highlight takes shapes, got ${_typeName(s)}`)
      }
    }
    if (highlightAt != null) {
      const candidates: Face[] = this.items.filter((item) => typeof item.faces === 'function').flatMap((item) => [...item.faces()])
      const points = _isPoint(highlightAt) ? [highlightAt] : Array.from(highlightAt as Iterable<unknown>)
      for (const p of points) {
        const q = _vec3(p)
        if (!candidates.length) continue
        let best = candidates[0]
        let bestDistance = best.distanceTo(q)
        for (const f of candidates.slice(1)) {
          const d = f.distanceTo(q)
          if (d < bestDistance) [best, bestDistance] = [f, d]
        }
        faces.push(best)
      }
    }
    for (const f of faces) this._addMesh(tessellate(f, tol))
  }

  _addMesh(mesh: Mesh): void {
    if (mesh.triangles.length) this.hlTris.push(_meshArrays(mesh))
  }
}

function _boxOf(points: Float64Array, pick: (a: number, b: number) => number): Vec3 {
  const out: Vec3 = [points[0], points[1], points[2]]
  for (let i = 3; i < points.length; i += 3) for (let c = 0; c < 3; c++) out[c] = pick(out[c], points[i + c])
  return out
}

/** The corners of a mesh's triangles and their normals (nine numbers per triangle each). */
function _meshArrays(mesh: Mesh): [Float64Array, Float64Array] {
  const t = mesh.triangles
  const v = mesh.vertices
  const tris = new Float64Array(t.length * 3)
  for (let i = 0; i < t.length; i++) {
    const at = t[i] * 3
    tris[i * 3] = v[at]
    tris[i * 3 + 1] = v[at + 1]
    tris[i * 3 + 2] = v[at + 2]
  }
  let norms: Float64Array
  if (mesh.normals !== null) norms = Float64Array.from(mesh.normals)
  else {
    const tn = mesh.triangleNormals
    norms = new Float64Array(t.length * 3)
    for (let i = 0; i < t.length / 3; i++) for (let c = 0; c < 3; c++) norms.set(tn.subarray(i * 3, i * 3 + 3), i * 9 + c * 3)
  }
  return [tris, norms]
}

/** Center, axis and radius of an edge that is a circle or an arc of at least half a turn, also
 * when the kernel made it a B-spline (chamfers, revolved profiles); else null. */
function _circleOf(edge: Edge): [Vec3, Vec3, number] | null {
  let pts: Vec3[]
  try {
    const kind = edge.geomType
    if (kind === 'circle') {
      const r = edge.radius
      if (edge.length < Math.PI * r * (1 - 1e-6)) return null
      return [edge.arcCenter.toArray(), edge.normal.toArray(), Number(r)]
    }
    if (kind !== 'bspline') return null
    pts = []
    for (let i = 0; i < 9; i++) pts.push(edge.pointAt(i * 0.125).toArray())
  } catch {
    return null // an edge the kernel cannot describe
  }
  const a = pts[0]
  const ab: Vec3 = [pts[3][0] - a[0], pts[3][1] - a[1], pts[3][2] - a[2]]
  const ac: Vec3 = [pts[6][0] - a[0], pts[6][1] - a[1], pts[6][2] - a[2]]
  const n = _cross3(ab, ac)
  const nn = _dot3(n, n)
  if (nn < 1e-24) return null
  const x1 = _cross3(n, ab)
  const x2 = _cross3(ac, n)
  const acac = _dot3(ac, ac)
  const abab = _dot3(ab, ab)
  const c: Vec3 = [0, 0, 0]
  for (let i = 0; i < 3; i++) c[i] = a[i] + (x1[i] * acac + x2[i] * abab) / (2 * nn)
  const r = _norm3([a[0] - c[0], a[1] - c[1], a[2] - c[2]])
  const sn = Math.sqrt(nn)
  const d: Vec3 = [n[0] / sn, n[1] / sn, n[2] / sn]
  let offCircle = 0
  let offPlane = 0
  for (const p of pts) {
    const pc: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
    offCircle = Math.max(offCircle, Math.abs(_norm3(pc) - r))
    offPlane = Math.max(offPlane, Math.abs(_dot3(pc, d)))
  }
  if (Math.max(offCircle, offPlane) > 1e-4 * r || edge.length < Math.PI * r * (1 - 1e-4)) return null
  return [c, d, r]
}

/** Principal curvatures (k1 >= k2) at the triangle corners of a tessellation, from the exact
 * surfaces (the kernel evaluates their fundamental forms). NaN where there is none. */
function _cornerCurvatures(mesh: Mesh | null, source: unknown, count: number): [Float64Array, Float64Array] {
  const missing = new Float64Array(count * 3).fill(Number.NaN)
  const poly = mesh?._poly?.poly ?? 0
  if (!poly || source == null) return [missing, missing]
  const r = ext.poly_curvatures(poly)
  const faces = ext.poly_arrays(poly, false).faces as Int32Array
  const [tris, corner] = _triangulate(faces)
  const k1 = r.k1 as Float64Array
  const k2 = r.k2 as Float64Array
  let last = -1
  for (let i = 0; i < corner.length; i++) last = Math.max(last, corner[i])
  if (tris.length / 3 !== count || k1.length !== last + 1) return [missing, missing] // not the corner order of the mesh: leave it out rather than guess
  const c1 = new Float64Array(corner.length)
  const c2 = new Float64Array(corner.length)
  for (let i = 0; i < corner.length; i++) {
    c1[i] = k1[corner[i]]
    c2[i] = k2[corner[i]]
  }
  return [c1, c2]
}

/** Segments (six numbers each) between the consecutive points of polylines: each polyline flat
 * (x, y, z per point) or a list of points. */
function _segments(polylines: Iterable<Any>): Float64Array {
  const out: number[] = []
  for (const pl of polylines) {
    const flat: ArrayLike<number> =
      pl.length && typeof pl[0] !== 'number' ? (Array.from(pl as Iterable<Any>).flatMap((p) => (p instanceof Vector ? p.toArray() : Array.from(p as ArrayLike<number>))) as number[]) : pl
    const n = flat.length / 3
    for (let i = 0; i + 1 < n; i++) for (let c = 0; c < 6; c++) out.push(flat[i * 3 + c])
  }
  return Float64Array.from(out)
}

// -------------------------------------------------------------------------------- one view
/** An image of floats (0 to 1), row by row, three numbers per pixel. */
export interface _Img {
  data: Float32Array | Float64Array
  width: number
  height: number
}

type _Text = [number, number, string, RGB, number, string, RGB | null]

/** The supersampled picture of one view: colors, depth buffer, the texts to draw. */
export class _Canvas {
  readonly w: number
  readonly h: number
  readonly k: number
  readonly W: number
  readonly H: number
  readonly cam: _Camera
  readonly s: number
  readonly mx: number
  readonly my: number
  readonly img: Float32Array
  readonly zbuf: Float64Array
  /** Overlays grow with large pictures. */
  readonly u: number
  readonly texts: _Text[] = []

  constructor(w: number, h: number, k: number, cam: _Camera, frame: Frame, bg: RGB) {
    this.w = w
    this.h = h
    this.k = k
    this.W = w * k
    this.H = h * k
    this.cam = cam
    this.s = frame.scale * k
    this.mx = frame.midX
    this.my = frame.midY
    this.img = _filled(new Float32Array(this.W * this.H * 3), bg)
    this.zbuf = new Float64Array(this.W * this.H).fill(-Infinity)
    this.u = Math.max(1, _pyRound(Math.min(w, h) / 600))
  }

  /** Canvas x, y (pixels) and depth of flat points. */
  screen(points: Float64Array): [Float64Array, Float64Array, Float64Array] {
    const [x, y, z] = this.cam.project(points)
    const [W2, H2, s, mx, my] = [this.W / 2.0, this.H / 2.0, this.s, this.mx, this.my]
    for (let i = 0; i < x.length; i++) {
      x[i] = W2 + (x[i] - mx) * s
      y[i] = H2 - (y[i] - my) * s
    }
    return [x, y, z]
  }

  /** Canvas x, y and depth of a point. */
  screenPoint(p: ArrayLike<number>): Vec3 {
    const [x, y, z] = this.screen(Float64Array.of(p[0], p[1], p[2]))
    return [x[0], y[0], z[0]]
  }

  /** Text in output pixels; drawn after averaging down, so the glyphs stay crisp. */
  text(x: number, y: number, text: string, color: RGB, scale = 2, anchor = 'start', halo: RGB | null = null): void {
    this.texts.push([x, y, text, color, scale, anchor, halo])
  }

  finish(): _Img {
    const { k, w, h, W } = this
    let img: _Img = { data: this.img, width: W, height: this.H }
    if (k > 1) {
      // average k x k blocks (summed in numpy's order: row by row of the block, from zero)
      const big = this.img
      const out = new Float64Array(w * h * 3)
      const kk = k * k
      for (let y = 0; y < h; y++) {
        const o = y * w * 3
        for (let dy = 0; dy < k; dy++) {
          let at = (y * k + dy) * W * 3
          for (let x = 0; x < w; x++) {
            for (let dx = 0; dx < k; dx++, at += 3) {
              out[o + x * 3] += big[at]
              out[o + x * 3 + 1] += big[at + 1]
              out[o + x * 3 + 2] += big[at + 2]
            }
          }
        }
        for (let i = o; i < o + w * 3; i++) out[i] /= kk
      }
      img = { data: out, width: w, height: h }
    }
    for (const [x, y, text, color, scale, anchor, halo] of this.texts) _text(img, x, y, text, color, scale, anchor, halo)
    return img
  }
}

export function _view(scene: _Scene, cam: _Camera, w: number, h: number, o: _Options, frame: Frame): _Img {
  const cv = new _Canvas(w, h, o.k, cam, frame, o.bg)
  const k = o.k
  const cut = o.section
  const depth = _ptp(_dots(scene.points, cam.back)) || 1.0
  const eps = Math.max(depth * 2e-3, 2.5 / cv.s) // depth that still counts as "on the surface"

  // the triangles of all bodies (clipped by the section), then the highlighted faces
  const parts: _Part[] = []
  const caps: [Float64Array, RGB, number][] = [] // cut outline, body color, body index
  const outlines: Float64Array[] = []
  scene.bodies.forEach((body, bi) => {
    let piece: _Part = {
      tris: body.tris,
      norms: body.norms,
      values: o.curvature !== null ? body.curvature(o.curvature[0]) : null,
      rgb: body.rgb,
      factor: null,
      colors: body.faceRgb,
    }
    if (cut !== null) {
      if (body.closed) {
        const outline = _crossings(body.tris, cut)
        outlines.push(outline)
        if (cut.cap && !o.xray && outline.length) caps.push([outline, body.rgb, bi])
      }
      piece = _clip(piece, cut)
    }
    const n = piece.tris.length / 9
    if (!n) return
    const facing = _facing(piece.tris, cam.back)
    const factor = new Float64Array(n).fill(1)
    piece = { ...piece, factor }
    if (body.closed) {
      if (cut === null) {
        piece = _select(piece, facing, (f) => f >= 0) // the back of a solid is never seen
      } else {
        for (let i = 0; i < n; i++) if (facing[i] < 0) factor[i] = 0.72 // inside walls the cut lays open
      }
    }
    parts.push(piece)
  })
  let nBody = 0
  for (const p of parts) nBody += p.tris.length / 9
  for (const [tris, norms] of scene.hlTris) {
    let piece: _Part = { tris, norms, values: o.curvature !== null ? new Float64Array(tris.length / 3).fill(Number.NaN) : null, rgb: _ORANGE, factor: null }
    if (cut !== null) piece = _clip(piece, cut)
    if (piece.tris.length && cut === null) piece = _select(piece, _facing(piece.tris, cam.back), (f) => f >= 0)
    if (piece.tris.length) parts.push({ ...piece, factor: new Float64Array(piece.tris.length / 9).fill(1) })
  }
  const tris = _concat(parts.map((p) => p.tris))
  const norms = _concat(parts.map((p) => p.norms))
  const values = o.curvature !== null ? _concat(parts.map((p) => p.values!)) : null
  const factor = _concat(parts.map((p) => p.factor!))
  const rgb = new Float64Array(factor.length * 3)
  let at = 0
  for (const p of parts) {
    if (p.colors) {
      rgb.set(p.colors, at)
      at += p.colors.length
      continue
    }
    const [r, g, b] = p.rgb
    for (let i = 0; i < p.tris.length / 9; i++, at += 3) {
      rgb[at] = r
      rgb[at + 1] = g
      rgb[at + 2] = b
    }
  }
  const [sx, sy, sz] = cv.screen(tris)
  const lift = 3 * eps
  for (let i = nBody * 3; i < sz.length; i++) sz[i] += lift // highlighted faces win over the body they lie on
  const tri = new _Triangles(sx, sy, sz, norms, values, rgb, factor, cam, nBody)

  if (o.xray) _xray(cv, tri, o)
  else {
    const tbuf = _depthFill(cv, tri)
    caps.forEach(([outline], ci) => _capFill(cv, tbuf, outline, cut!, tri.n + ci))
    _shade(
      cv,
      tbuf,
      tri,
      o,
      nBody,
      caps.map(([, color, bi]): [RGB, number] => [color, bi]),
    )
  }

  // lines: B-rep edges, silhouettes (line style), the outlines of the cut
  const ink = o.lines ? _INK : o.zebra ? _ZEBRA_EDGE : _EDGE
  const segs: Float64Array[] = []
  if (o.edges || o.lines) {
    for (const b of scene.bodies) segs.push(cut === null ? b.segs : _clipSegments(b.segs, cut))
    segs.push(...outlines)
  }
  if (o.lines) for (const b of scene.bodies) segs.push(cut === null ? _silhouettes(b, cam) : _clipSegments(_silhouettes(b, cam), cut))
  const edgeSegs = _concat(segs)
  const hl = _concat(scene.hlSegs.map((s) => (cut === null ? s : _clipSegments(s, cut))))
  const edgeCols = _repeat(ink, edgeSegs.length / 6)
  const hlCols = _repeat(_RED, hl.length / 6)
  if (o.lines) {
    const near = _minFilter(cv.zbuf, cv.W, cv.H, k)
    const both = _concat([edgeSegs, hl])
    const hidden = _concat([_repeat(_HIDDEN_INK, edgeSegs.length / 6), hlCols])
    _lines(cv, both, hidden, 0.5 * k, 'hidden', near, eps) // hidden first, thin and dashed
    _centerLines(cv, scene, cut)
    _lines(cv, both, _concat([edgeCols, hlCols]), 1.0 * k, 'visible', near, eps)
  } else if (o.xray) {
    _lines(cv, edgeSegs, edgeCols, 0.5 * k, 'all')
    _lines(cv, hl, hlCols, 0.9 * k, 'all')
  } else {
    _lines(cv, edgeSegs, edgeCols, 0.5 * k, 'depth', cv.zbuf, eps)
    _lines(cv, hl, hlCols, 0.9 * k, 'depth', cv.zbuf, 4 * eps)
  }

  for (const [s, color] of scene.overlays) _lines(cv, s, _repeat(color, s.length / 6), 0.6 * k, 'all')
  for (const p of scene.hlPoints) _dot(cv, p, _RED, 3.5)
  for (const [pos, label, color] of o.markers) _marker(cv, pos, label, color)
  if (o.annotate) _annotate(cv, scene)
  if (o.curvature !== null && o.legend && !o.lines) _legend(cv, ...o.curvature)
  return cv.finish()
}

/** Triangles with their corner normals, corner values (the curvature, or null), one color and a
 * shade factor each. */
interface _Part {
  tris: Float64Array
  norms: Float64Array
  values: Float64Array | null
  rgb: RGB
  factor: Float64Array | null
  /** a color per triangle (three numbers), where faces have colors of their own */
  colors?: Float64Array | null
}

function _repeat(color: RGB, n: number): Float64Array {
  return _filled(new Float64Array(n * 3), color)
}

/** The array with a color in every pixel. */
function _filled<T extends Float32Array | Float64Array>(data: T, color: RGB): T {
  const [r, g, b] = color
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
  return data
}

/** The normal of each triangle (by its corners) along `back`: positive facing the camera. */
export function _facing(tris: Float64Array, back: Vec3): Float64Array {
  const n = tris.length / 9
  const out = new Float64Array(n)
  for (let t = 0; t < n; t++) {
    const i = t * 9
    const u0 = tris[i + 3] - tris[i]
    const u1 = tris[i + 4] - tris[i + 1]
    const u2 = tris[i + 5] - tris[i + 2]
    const v0 = tris[i + 6] - tris[i]
    const v1 = tris[i + 7] - tris[i + 1]
    const v2 = tris[i + 8] - tris[i + 2]
    out[t] = (u1 * v2 - u2 * v1) * back[0] + (u2 * v0 - u0 * v2) * back[1] + (u0 * v1 - u1 * v0) * back[2]
  }
  return out
}

/** The triangles of a part whose value passes the test. */
function _select(p: _Part, value: Float64Array, test: (v: number) => boolean): _Part {
  const keep: number[] = []
  for (let t = 0; t < value.length; t++) if (test(value[t])) keep.push(t)
  const tris = new Float64Array(keep.length * 9)
  const norms = new Float64Array(keep.length * 9)
  const values = p.values ? new Float64Array(keep.length * 3) : null
  const factor = p.factor ? new Float64Array(keep.length) : null
  const colors = p.colors ? new Float64Array(keep.length * 3) : null
  keep.forEach((t, i) => {
    tris.set(p.tris.subarray(t * 9, t * 9 + 9), i * 9)
    norms.set(p.norms.subarray(t * 9, t * 9 + 9), i * 9)
    if (values) values.set(p.values!.subarray(t * 3, t * 3 + 3), i * 3)
    if (factor) factor[i] = p.factor![t]
    if (colors) colors.set(p.colors!.subarray(t * 3, t * 3 + 3), i * 3)
  })
  return { tris, norms, values, rgb: p.rgb, factor, colors }
}

/** Triangles on the screen with what the fill and the shading need: the maps from a pixel to
 * barycentric coordinates and depth, normals in camera coordinates, colors. */
export class _Triangles {
  readonly n: number
  readonly sx: Float64Array
  readonly sy: Float64Array
  readonly ok: Uint8Array
  // barycentric coordinate i at pixel (x, y): bx[t * 3 + i] * x + by[t * 3 + i] * y + b0[t * 3 + i]
  readonly bx: Float64Array
  readonly by: Float64Array
  readonly b0: Float64Array
  readonly zx: Float64Array
  readonly zy: Float64Array
  readonly z0: Float64Array
  // the normal (camera coordinates) at a pixel: nx * x + ny * y + n0 (three numbers per triangle)
  readonly nx: Float64Array
  readonly ny: Float64Array
  readonly n0: Float64Array
  // a value per corner (the curvature), the same way: vx * x + vy * y + v0
  readonly hasValue: boolean
  readonly vx: Float64Array
  readonly vy: Float64Array
  readonly v0: Float64Array
  readonly rgb: Float64Array
  readonly factor: Float64Array
  /** Triangles from here on are highlights. */
  readonly nBody: number
  readonly cam: _Camera

  constructor(sx: Float64Array, sy: Float64Array, sz: Float64Array, norms: Float64Array, values: Float64Array | null, rgb: Float64Array, factor: Float64Array, cam: _Camera, nBody = -1) {
    const n = factor.length
    this.n = n
    this.sx = sx
    this.sy = sy
    this.ok = new Uint8Array(n)
    this.bx = new Float64Array(n * 3)
    this.by = new Float64Array(n * 3)
    this.b0 = new Float64Array(n * 3)
    this.zx = new Float64Array(n)
    this.zy = new Float64Array(n)
    this.z0 = new Float64Array(n)
    this.nx = new Float64Array(n * 3)
    this.ny = new Float64Array(n * 3)
    this.n0 = new Float64Array(n * 3)
    this.hasValue = values !== null
    this.vx = new Float64Array(values ? n : 0)
    this.vy = new Float64Array(values ? n : 0)
    this.v0 = new Float64Array(values ? n : 0)
    const basis = [cam.right, cam.up, cam.back]
    const ncam = new Float64Array(9)
    for (let t = 0; t < n; t++) {
      const i = t * 3
      const [x0, x1, x2] = [sx[i], sx[i + 1], sx[i + 2]]
      const [y0, y1, y2] = [sy[i], sy[i + 1], sy[i + 2]]
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
      const ok = Math.abs(area) > 1e-9
      this.ok[t] = ok ? 1 : 0
      const a = ok ? area : 1.0
      const bx = [(y1 - y2) / a, (y2 - y0) / a, (y0 - y1) / a]
      const by = [(x2 - x1) / a, (x0 - x2) / a, (x1 - x0) / a]
      const b0 = [(x1 * y2 - x2 * y1) / a, (x2 * y0 - x0 * y2) / a, (x0 * y1 - x1 * y0) / a]
      for (let c = 0; c < 3; c++) {
        this.bx[i + c] = bx[c]
        this.by[i + c] = by[c]
        this.b0[i + c] = b0[c]
      }
      this.zx[t] = bx[0] * sz[i] + bx[1] * sz[i + 1] + bx[2] * sz[i + 2]
      this.zy[t] = by[0] * sz[i] + by[1] * sz[i + 1] + by[2] * sz[i + 2]
      this.z0[t] = b0[0] * sz[i] + b0[1] * sz[i + 1] + b0[2] * sz[i + 2]
      for (let c = 0; c < 3; c++) {
        const at = t * 9 + c * 3
        for (let j = 0; j < 3; j++) ncam[c * 3 + j] = norms[at] * basis[j][0] + norms[at + 1] * basis[j][1] + norms[at + 2] * basis[j][2]
      }
      for (let j = 0; j < 3; j++) {
        this.nx[i + j] = bx[0] * ncam[j] + bx[1] * ncam[3 + j] + bx[2] * ncam[6 + j]
        this.ny[i + j] = by[0] * ncam[j] + by[1] * ncam[3 + j] + by[2] * ncam[6 + j]
        this.n0[i + j] = b0[0] * ncam[j] + b0[1] * ncam[3 + j] + b0[2] * ncam[6 + j]
      }
      if (values) {
        this.vx[t] = bx[0] * values[i] + bx[1] * values[i + 1] + bx[2] * values[i + 2]
        this.vy[t] = by[0] * values[i] + by[1] * values[i + 1] + by[2] * values[i + 2]
        this.v0[t] = b0[0] * values[i] + b0[1] * values[i + 1] + b0[2] * values[i + 2]
      }
    }
    this.rgb = rgb
    this.factor = factor
    this.nBody = nBody < 0 ? n : nBody
    this.cam = cam
  }

  depth(t: number, xc: number, yc: number): number {
    return this.zx[t] * xc + this.zy[t] * yc + this.z0[t]
  }
}

/** The pixels whose centers lie in the triangles: per triangle (in order) and row, the first and
 * the last column. */
function _forEachSpan(tri: _Triangles, W: number, H: number, visit: (t: number, row: number, c0: number, c1: number) => void): void {
  const { sx, sy, bx, by, b0 } = tri
  for (let t = 0; t < tri.n; t++) {
    if (!tri.ok[t]) continue
    const i = t * 3
    const xmin = Math.min(sx[i], sx[i + 1], sx[i + 2])
    const xmax = Math.max(sx[i], sx[i + 1], sx[i + 2])
    const ymin = Math.min(sy[i], sy[i + 1], sy[i + 2])
    const ymax = Math.max(sy[i], sy[i + 1], sy[i + 2])
    if (!(xmax >= 0 && xmin <= W && ymax >= 0 && ymin <= H)) continue
    const r0 = Math.max(Math.ceil(ymin - 0.5), 0)
    const r1 = Math.min(Math.floor(ymax - 0.5), H - 1)
    for (let row = r0; row <= r1; row++) {
      const yc = row + 0.5
      // the span of the row: where every barycentric coordinate is >= 0 (a little less, so that
      // no pixel falls between two triangles)
      let lo = -Infinity
      let hi = Infinity
      for (let j = 0; j < 3; j++) {
        const ax = bx[i + j]
        const v = by[i + j] * yc + b0[i + j] + 1e-7
        const bound = -v / ax
        if (ax > 0) lo = Math.max(lo, bound)
        if (ax < 0) hi = Math.min(hi, bound)
        if (ax === 0 && v < 0) hi = -Infinity
      }
      const c0 = Math.max(Math.ceil(lo - 0.5), 0)
      const c1 = Math.min(Math.floor(hi - 0.5), W - 1)
      if (c1 >= c0) visit(t, row, c0, c1)
    }
  }
}

/** The depth test: per pixel the nearest triangle (-1: none). */
export function _depthFill(cv: _Canvas, tri: _Triangles): Int32Array {
  const W = cv.W
  const tbuf = new Int32Array(cv.W * cv.H).fill(-1)
  const zbuf = cv.zbuf
  const { zx, zy, z0 } = tri
  _forEachSpan(tri, cv.W, cv.H, (t, row, c0, c1) => {
    const yc = row + 0.5
    const a = zx[t]
    const b = zy[t] * yc
    const c = z0[t]
    for (let col = c0, p = row * W + c0; col <= c1; col++, p++) {
      const z = a * (col + 0.5) + b + c
      if (z >= zbuf[p]) {
        zbuf[p] = z
        tbuf[p] = t
      }
    }
  })
  return tbuf
}

// Lighting: a key light from the upper left, a fill light, ambient and a little specular.
const _KEY = _unit([-0.45, 0.65, 0.9])
const _FILL = _unit([0.6, -0.2, 0.8])
const _HALF = _unit([_KEY[0] + 0.0, _KEY[1] + 0.0, _KEY[2] + 1.0])

/** The colors at a pixel: the normal interpolated over the triangle (from the exact normals at
 * its corners), then lit, striped (zebra) or colored by curvature; into `out` at `at`. */
function _shadePixel(tri: _Triangles, t: number, xc: number, yc: number, o: _Options, zebra: _ZebraFrame | null, out: Float32Array | Float64Array, at: number): void {
  const i = t * 3
  const { nx, ny, n0 } = tri
  let x = nx[i] * xc + ny[i] * yc + n0[i]
  let y = nx[i + 1] * xc + ny[i + 1] * yc + n0[i + 1]
  let z = nx[i + 2] * xc + ny[i + 2] * yc + n0[i + 2]
  // unit length, turned towards the camera: both sides of a surface are lit
  const d = Math.max(Math.sqrt(x * x + y * y + z * z), 1e-12)
  x /= d
  y /= d
  z /= d
  if (z < 0) {
    x *= -1.0
    y *= -1.0
    z *= -1.0
  }
  const f = tri.factor[t]
  if (zebra !== null) {
    _zebraPixel(x, y, z, t >= tri.nBody ? _ORANGE : _ZEBRA_LIGHT, f, zebra, out, at)
    return
  }
  if (o.curvature !== null && !o.lines && t < tri.nBody) {
    const value = tri.vx[t] * xc + tri.vy[t] * yc + tri.v0[t]
    _curvatureColor(x, y, z, value, o.curvature[1], o.curvature[2], f, out, at)
    return
  }
  // (highlighted faces stay orange)
  const diff = _clip01(x * _KEY[0] + y * _KEY[1] + z * _KEY[2])
  const spec = _clip01(x * _HALF[0] + y * _HALF[1] + z * _HALF[2]) ** 40
  const light = 0.3 + 0.62 * diff + 0.16 * _clip01(x * _FILL[0] + y * _FILL[1] + z * _FILL[2])
  const rgb = tri.rgb
  out[at] = (rgb[i] * light + 0.1 * spec) * f
  out[at + 1] = (rgb[i + 1] * light + 0.1 * spec) * f
  out[at + 2] = (rgb[i + 2] * light + 0.1 * spec) * f
}

/** The frame of zebra stripes in camera coordinates: the light lines run along `d`. */
interface _ZebraFrame {
  d: Vec3
  e1: Vec3
  e2: Vec3
  stripes: number
  width: number
}

function _zebraFrame(spec: _ZebraSpec, cam: _Camera): _ZebraFrame {
  const direction = spec.direction
  let d: Vec3
  if (typeof direction === 'string') d = direction === 'vertical' ? [0.0, 1.0, 0.0] : [1.0, 0.0, 0.0]
  else d = [_dot3(direction, cam.right), _dot3(direction, cam.up), _dot3(direction, cam.back)]
  d = _unit(d)
  let e2: Vec3 = [0.0 - d[0] * d[2], 0.0 - d[1] * d[2], 1.0 - d[2] * d[2]] // the view direction, square to the light lines
  if (_norm3(e2) < 1e-6) e2 = Math.abs(d[0]) < 0.9 ? _cross3(d, [1.0, 0.0, 0.0]) : _cross3(d, [0.0, 1.0, 0.0])
  e2 = _unit(e2)
  const e1 = _cross3(d, e2)
  return { d, e1, e2, stripes: spec.stripes, width: spec.width }
}

/** Stripes: the reflection of parallel light lines at infinity. The view ray, reflected at the
 * surface, points to one of the lines or between two; which, depends on its angle around the
 * direction of the lines. */
function _zebraPixel(x: number, y: number, z: number, light: RGB, factor: number, zf: _ZebraFrame, out: Float32Array | Float64Array, at: number): void {
  // the view ray (towards -z), reflected
  const z2 = 2 * z
  const rx = z2 * x - 0.0
  const ry = z2 * y - 0.0
  const rz = z2 * z - 1.0
  const { d, e1, e2 } = zf
  const angle = Math.atan2(rx * e1[0] + ry * e1[1] + rz * e1[2], rx * e2[0] + ry * e2[1] + rz * e2[2])
  // a black stripe is centred on the angle 0 (and on 180 degrees): the reflection straight back,
  // common on surfaces that curve along the lines only, stays clear of stripe borders
  const dark = _mod((angle / (2 * Math.PI)) * zf.stripes + zf.width / 2, 1.0) < zf.width
  const color = dark ? _ZEBRA_DARK : light // highlighted faces: orange and black
  // towards the direction of the lines the stripes crowd together and have no angle: gray
  const pole = _clip01((Math.abs(rx * d[0] + ry * d[1] + rz * d[2]) - 0.95) / 0.04)
  for (let c = 0; c < 3; c++) out[at + c] = (color[c] * (1 - pole) + 0.5 * pole) * factor
}

/** The color map at a value, lightly shaded so that the shape still reads; gray where the value
 * is missing. */
function _curvatureColor(x: number, y: number, z: number, value: number, lo: number, hi: number, factor: number, out: Float32Array | Float64Array, at: number): void {
  const rgb: number[] = Number.isFinite(value) ? _curvatureMap(_curvaturePosition(value, lo, hi)) : [0.6, 0.6, 0.6]
  const diff = _clip01(x * _KEY[0] + y * _KEY[1] + z * _KEY[2])
  const shade = 0.62 + 0.38 * diff
  for (let c = 0; c < 3; c++) out[at + c] = rgb[c] * shade * factor
}

/** Where a value lies on the map: 0.5 is zero, 1 the top of the range, 0 the bottom. */
function _curvaturePosition(value: number, lo: number, hi: number): number {
  // (numpy's nan_to_num)
  const v = Number.isNaN(value) ? 0.0 : value === Infinity ? Number.MAX_VALUE : value === -Infinity ? -Number.MAX_VALUE : value
  const up = hi > 0 ? _clip01(v / hi) : 0
  const down = lo < 0 ? _clip01(v / lo) : 0
  return 0.5 + 0.5 * (v >= 0 ? up : -down)
}

const _CURVATURE_CHANNELS = [0, 1, 2].map((c) => _CURVATURE_COLORS.map((rgb) => rgb[c]))

/** The color at a position of the map (numpy's interp between the stops). */
function _curvatureMap(position: number): number[] {
  const xp = _CURVATURE_STOPS
  const last = xp.length - 1
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const fp = _CURVATURE_CHANNELS[c]
    if (Number.isNaN(position)) out[c] = position
    else if (position <= xp[0]) out[c] = fp[0]
    else if (position >= xp[last]) out[c] = fp[last]
    else {
      let j = 0
      while (xp[j + 1] <= position) j++
      if (xp[j] === position) out[c] = fp[j]
      else out[c] = ((fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j])) * (position - xp[j]) + fp[j]
    }
  }
  return out
}

/** The scale of a curvature map at the right edge: a color bar from the lowest to the highest
 * value, with zero, the unit and the kind. */
function _legend(cv: _Canvas, kind: string, lo: number, hi: number): void {
  const { k, u, w, h, W } = cv
  const x1 = w - 14 * u
  const x0 = x1 - 12 * u
  const y0 = 40 * u
  const y1 = y0 + Math.min(Math.trunc(0.42 * h), 220 * u)
  const top = hi > 0 ? 1.0 : 0.5 // the part of the map in use
  const bottom = lo < 0 ? 0.0 : 0.5
  for (let row = y0 * k; row < y1 * k; row++) {
    if (row < 0 || row >= cv.H) continue
    const color = _curvatureMap(top - ((top - bottom) * (row - y0 * k + 0.5)) / ((y1 - y0) * k))
    for (let col = Math.max(x0 * k, 0); col < Math.min(x1 * k, W); col++) cv.img.set(color, (row * W + col) * 3)
  }
  const frame: [number, number, number, number][] = [
    [x0 * k, y0 * k, x1 * k, y0 * k],
    [x1 * k, y0 * k, x1 * k, y1 * k],
    [x1 * k, y1 * k, x0 * k, y1 * k],
    [x0 * k, y1 * k, x0 * k, y0 * k],
  ]
  _screenLines(cv, frame, _LABEL, 0.5 * k)
  const unit = kind === 'gaussian' ? '1/MM²' : '1/MM'
  cv.text(x1, y0 - 12 * u - 7 * u, `${kind.toUpperCase()} ${unit}`, _LABEL, u, 'end', _WHITE)
  const ticks: [number, number][] = hi > lo ? [[hi, y0], [lo, y1]] : [[0.0, (y0 + y1) / 2]]
  if (lo < 0 && 0 < hi) ticks.push([0.0, (y0 + y1) / 2])
  for (const [value, y] of ticks) {
    cv.text(x0 - 5 * u, y - 3.5 * u, _valueText(value), _LABEL, u, 'end', _WHITE)
    _screenLines(cv, [[(x0 - 3 * u) * k, y * k, x0 * k, y * k]], _LABEL, 0.5 * k)
  }
}

/** A value of a legend: three significant digits, a short exponent. */
export function _valueText(v: number): string {
  if (v === 0) return '0'
  return _formatG(v, 3).replace('e-0', 'e-').replace('e+0', 'e')
}

function _shade(cv: _Canvas, tbuf: Int32Array, tri: _Triangles, o: _Options, nBody: number, caps: [RGB, number][]): void {
  const nTri = tri.n
  const W = cv.W
  const img = cv.img
  const zebra = o.zebra !== null && !o.lines ? _zebraFrame(o.zebra, tri.cam) : null
  for (let p = 0; p < tbuf.length; p++) {
    const t = tbuf[p]
    if (t < 0 || t >= nTri) continue
    if (o.lines && t < nBody) continue // a drawing fills only highlighted faces
    const col = p % W
    _shadePixel(tri, t, col + 0.5, (p - col) / W + 0.5, o, zebra, img, p * 3)
  }
  // cut faces: a light fill, hatched at 45 degrees in a dark tone of the body
  const period = 7 * cv.k
  caps.forEach(([base, bi], ci) => {
    const fill: RGB = o.lines ? o.bg : [0.55 * 0.9 * base[0] + 0.45, 0.55 * 0.9 * base[1] + 0.45, 0.55 * 0.9 * base[2] + 0.45]
    const ink: RGB = o.lines ? _HATCH_INK : [0.27 * base[0], 0.27 * base[1], 0.27 * base[2]]
    for (let p = 0; p < tbuf.length; p++) {
      if (tbuf[p] !== nTri + ci) continue
      const x = p % W
      const y = (p - x) / W
      const on = _mod(bi % 2 ? x - y : x + y, period) < cv.k
      img.set(on ? ink : fill, p * 3)
    }
  })
}

/** Every pixel of every triangle, blended over those behind it with a fixed opacity. */
function _xray(cv: _Canvas, tri: _Triangles, o: _Options): void {
  const W = cv.W
  // all fragments: triangle, pixel, depth
  let cap = 1 << 16
  let ts = new Int32Array(cap)
  let ps = new Int32Array(cap)
  let zs = new Float64Array(cap)
  let n = 0
  _forEachSpan(tri, cv.W, cv.H, (t, row, c0, c1) => {
    if (n + (c1 - c0 + 1) > cap) {
      while (n + (c1 - c0 + 1) > cap) cap *= 2
      const [t2, p2, z2] = [new Int32Array(cap), new Int32Array(cap), new Float64Array(cap)]
      t2.set(ts.subarray(0, n))
      p2.set(ps.subarray(0, n))
      z2.set(zs.subarray(0, n))
      ;[ts, ps, zs] = [t2, p2, z2]
    }
    const yc = row + 0.5
    for (let col = c0; col <= c1; col++, n++) {
      ts[n] = t
      ps[n] = row * W + col
      zs[n] = tri.depth(t, col + 0.5, yc)
    }
  })
  if (!n) return
  const zbuf = cv.zbuf
  let zmin = Infinity
  let zmax = -Infinity
  for (let i = 0; i < n; i++) {
    zbuf[ps[i]] = Math.max(zbuf[ps[i]], zs[i])
    zmin = Math.min(zmin, zs[i])
    zmax = Math.max(zmax, zs[i])
  }
  // sorted by pixel, then from near to far (0 = nearest), then as they came
  const zq = new Int32Array(n)
  const den = Math.max(zmax - zmin, 1e-300)
  for (let i = 0; i < n; i++) zq[i] = Math.trunc(((zmax - zs[i]) / den) * ((1 << 30) - 1))
  const size = cv.W * cv.H
  const start = new Int32Array(size + 1)
  for (let i = 0; i < n; i++) start[ps[i] + 1]++
  for (let p = 0; p < size; p++) start[p + 1] += start[p]
  const order = new Int32Array(n)
  const next = start.slice(0, size)
  for (let i = 0; i < n; i++) order[next[ps[i]]++] = i
  for (let p = 0; p < size; p++) {
    // (few fragments per pixel: an insertion sort, which keeps equal ones in order)
    for (let a = start[p] + 1; a < start[p + 1]; a++) {
      const v = order[a]
      let b = a - 1
      while (b >= start[p] && zq[order[b]] > zq[v]) {
        order[b + 1] = order[b]
        b--
      }
      order[b + 1] = v
    }
  }
  // a pixel on the edge between two triangles is covered by both: one surface, blended once
  const same = (zmax - zmin) * 1e-7 + 1e-12
  const a = o.alpha
  const zebra = o.zebra !== null && !o.lines ? _zebraFrame(o.zebra, tri.cam) : null
  const color = new Float64Array(3)
  const img = cv.img
  for (let p = 0; p < size; p++) {
    if (start[p] === start[p + 1]) continue
    let count = 0
    let r = 0
    let g = 0
    let b = 0
    for (let j = start[p]; j < start[p + 1]; j++) {
      const i = order[j]
      if (j > start[p] && Math.abs(zs[i] - zs[order[j - 1]]) <= same) continue
      const weight = a * (1 - a) ** count // nearer ones in front
      const col = p % W
      _shadePixel(tri, ts[i], col + 0.5, (p - col) / W + 0.5, o, zebra, color, 0)
      r += weight * color[0]
      g += weight * color[1]
      b += weight * color[2]
      count++
    }
    const behind = (1 - a) ** count
    img[p * 3] = img[p * 3] * behind + r
    img[p * 3 + 1] = img[p * 3 + 1] * behind + g
    img[p * 3 + 2] = img[p * 3 + 2] * behind + b
  }
}

// -------------------------------------------------------------------------------- sections
/** Clip triangles to the side of the plane that stays (distance <= 0). */
function _clip(p: _Part, cut: _Cut): _Part {
  const { tris, norms, values } = p
  const n = tris.length / 9
  const d = new Float64Array(n * 3)
  const npos = new Uint8Array(n)
  for (let t = 0; t < n; t++) {
    for (let c = 0; c < 3; c++) {
      d[t * 3 + c] = cut.distance(tris, t * 9 + c * 3)
      if (d[t * 3 + c] > 0) npos[t]++
    }
  }
  const outT: number[] = []
  const outN: number[] = []
  const outV: number[] = []
  const outC: number[] = [] // (the colors of the triangles' faces, where they have their own)
  const colorOf = (t: number) => {
    if (p.colors) for (let c = 0; c < 3; c++) outC.push(p.colors[t * 3 + c])
  }
  const pushCorner = (src: Float64Array, srcN: Float64Array, srcV: Float64Array | null, at: number, vat: number) => {
    for (let c = 0; c < 3; c++) outT.push(src[at + c])
    for (let c = 0; c < 3; c++) outN.push(srcN[at + c])
    if (srcV) outV.push(srcV[vat])
  }
  for (let t = 0; t < n; t++) {
    if (npos[t] !== 0) continue
    for (let c = 0; c < 3; c++) pushCorner(tris, norms, values, t * 9 + c * 3, t * 3 + c)
    colorOf(t)
  }
  for (const count of [1, 2]) {
    const sel: number[] = []
    for (let t = 0; t < n; t++) if (npos[t] === count) sel.push(t)
    if (!sel.length) continue
    // turn the corners so that the odd one (cut away for count 1, kept for count 2) comes
    // first; the corners stay counterclockwise
    const pieces = sel.map((t) => {
      let odd = 0
      while (odd < 2 && (d[t * 3 + odd] > 0) !== (count === 1)) odd++
      const idx = [odd, (odd + 1) % 3, (odd + 2) % 3]
      const v = idx.map((c) => tris.subarray(t * 9 + c * 3, t * 9 + c * 3 + 3))
      const nn = idx.map((c) => norms.subarray(t * 9 + c * 3, t * 9 + c * 3 + 3))
      const vv = values ? idx.map((c) => values[t * 3 + c]) : null
      const dd = idx.map((c) => d[t * 3 + c])
      const p01 = _crossPoint(v[0], v[1], nn[0], nn[1], vv ? vv[0] : 0, vv ? vv[1] : 0, dd[0], dd[1])
      const p02 = _crossPoint(v[0], v[2], nn[0], nn[2], vv ? vv[0] : 0, vv ? vv[2] : 0, dd[0], dd[2])
      return { t, v, nn, vv, p01, p02 }
    })
    const corner = (point: ArrayLike<number>, normal: ArrayLike<number>, value: number) => {
      for (let c = 0; c < 3; c++) outT.push(point[c])
      for (let c = 0; c < 3; c++) outN.push(normal[c])
      if (values) outV.push(value)
    }
    if (count === 1) {
      // the first corner is cut away: the quad p01, v1, v2, p02 stays
      for (const { t, v, nn, vv, p01 } of pieces) {
        corner(p01[0], p01[1], p01[2])
        corner(v[1], nn[1], vv ? vv[1] : 0)
        corner(v[2], nn[2], vv ? vv[2] : 0)
        colorOf(t)
      }
      for (const { t, v, nn, vv, p01, p02 } of pieces) {
        corner(p01[0], p01[1], p01[2])
        corner(v[2], nn[2], vv ? vv[2] : 0)
        corner(p02[0], p02[1], p02[2])
        colorOf(t)
      }
    } else {
      // only the first corner stays
      for (const { t, v, nn, vv, p01, p02 } of pieces) {
        corner(v[0], nn[0], vv ? vv[0] : 0)
        corner(p01[0], p01[1], p01[2])
        corner(p02[0], p02[1], p02[2])
        colorOf(t)
      }
    }
  }
  return {
    tris: Float64Array.from(outT),
    norms: Float64Array.from(outN),
    values: values ? Float64Array.from(outV) : null,
    rgb: p.rgb,
    factor: null,
    colors: p.colors ? Float64Array.from(outC) : null,
  }
}

/** Where the segment a-b crosses the plane, and the normal and the value there. Interpolated
 * from the end that stays, so that the triangles on both sides of a mesh edge get the same
 * point. */
function _crossPoint(a: ArrayLike<number>, b: ArrayLike<number>, na: ArrayLike<number>, nb: ArrayLike<number>, va: number, vb: number, da: number, db: number): [Vec3, Vec3, number] {
  const swap = da > 0
  const [p, q] = swap ? [b, a] : [a, b]
  const [m, mq] = swap ? [nb, na] : [na, nb]
  const [w, wq] = swap ? [vb, va] : [va, vb]
  const [dp, dq] = swap ? [db, da] : [da, db]
  const t = dp / (dp - dq)
  const point: Vec3 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]
  const normal: Vec3 = [m[0] + (mq[0] - m[0]) * t, m[1] + (mq[1] - m[1]) * t, m[2] + (mq[2] - m[2]) * t]
  return [point, normal, w + (wq - w) * t]
}

/** The segments where the triangles cross the plane: the outline of the cut face. */
function _crossings(tris: Float64Array, cut: _Cut): Float64Array {
  const n = tris.length / 9
  const out: number[] = []
  const zero = [0, 0, 0]
  for (let t = 0; t < n; t++) {
    const d = [0, 1, 2].map((c) => cut.distance(tris, t * 9 + c * 3))
    const npos = d.filter((x) => x > 0).length
    if (npos !== 1 && npos !== 2) continue
    let odd = 0
    while (odd < 2 && (d[odd] > 0) !== (npos === 1)) odd++
    const idx = [odd, (odd + 1) % 3, (odd + 2) % 3]
    const v = idx.map((c) => tris.subarray(t * 9 + c * 3, t * 9 + c * 3 + 3))
    const dd = idx.map((c) => d[c])
    const [p01] = _crossPoint(v[0], v[1], zero, zero, 0, 0, dd[0], dd[1])
    const [p02] = _crossPoint(v[0], v[2], zero, zero, 0, 0, dd[0], dd[2])
    out.push(...p01, ...p02)
  }
  return Float64Array.from(out)
}

function _clipSegments(segs: Float64Array, cut: _Cut): Float64Array {
  if (!segs.length) return segs
  const out: number[] = []
  for (let s = 0; s < segs.length / 6; s++) {
    const da = cut.distance(segs, s * 6)
    const db = cut.distance(segs, s * 6 + 3)
    if (!(da <= 0 || db <= 0)) continue
    const seg = Array.from(segs.subarray(s * 6, s * 6 + 6))
    for (const [end, dself, dother] of [
      [0, da, db],
      [1, db, da],
    ]) {
      if (!(dself > 0)) continue
      const t = dother / (dother - dself)
      const o = (1 - end) * 3
      for (let c = 0; c < 3; c++) seg[end * 3 + c] = seg[o + c] + (seg[end * 3 + c] - seg[o + c]) * t
    }
    out.push(...seg)
  }
  return Float64Array.from(out)
}

/** Fill the cut face inside its outline (even-odd, so holes stay open) at the depth of the
 * plane. */
function _capFill(cv: _Canvas, tbuf: Int32Array, outline: Float64Array, cut: _Cut, capId: number): void {
  const cam = cv.cam
  const nb = _dot3(cut.normal, cam.back)
  if (Math.abs(nb) < 1e-6) return // the plane is seen edge-on: the cut is only its outline
  const m = outline.length / 6
  const a = new Float64Array(m * 3)
  const b = new Float64Array(m * 3)
  for (let i = 0; i < m; i++) {
    a.set(outline.subarray(i * 6, i * 6 + 3), i * 3)
    b.set(outline.subarray(i * 6 + 3, i * 6 + 6), i * 3)
  }
  const [ax, ay] = cv.screen(a)
  const [bx, by] = cv.screen(b)
  // the crossings of the outline with the rows of pixel centers
  const rows: number[] = []
  const xs: number[] = []
  for (let s = 0; s < m; s++) {
    const lo = Math.min(ay[s], by[s])
    const hi = Math.max(ay[s], by[s])
    const r0 = Math.max(Math.ceil(lo - 0.5), 0)
    const r1 = Math.min(Math.ceil(hi - 0.5) - 1, cv.H - 1)
    for (let row = r0; row <= r1; row++) {
      rows.push(row)
      xs.push(ax[s] + ((row + 0.5 - ay[s]) * (bx[s] - ax[s])) / (by[s] - ay[s]))
    }
  }
  if (!rows.length) return
  const order = rows.map((_, i) => i).sort((i, j) => rows[i] - rows[j] || xs[i] - xs[j] || i - j)
  const d0 = _dot3(cut.normal, cut.origin)
  const nr = _dot3(cut.normal, cam.right)
  const nu = _dot3(cut.normal, cam.up)
  // pairs of crossings on a row: inside between them
  let rank = 0
  for (let j = 0; j < order.length; j++) {
    rank = j > 0 && rows[order[j]] === rows[order[j - 1]] ? rank + 1 : 0
    if (rank % 2 !== 0 || j + 1 >= order.length || rows[order[j + 1]] !== rows[order[j]]) continue
    const row = rows[order[j]]
    const c0 = Math.max(Math.ceil(xs[order[j]] - 0.5), 0)
    const c1 = Math.min(Math.ceil(xs[order[j + 1]] - 0.5) - 1, cv.W - 1)
    for (let col = c0; col <= c1; col++) {
      // the depth of the plane at the pixel
      const xp = cv.mx + (col + 0.5 - cv.W / 2) / cv.s
      const yp = cv.my - (row + 0.5 - cv.H / 2) / cv.s
      const z = (d0 - xp * nr - yp * nu) / nb
      const p = row * cv.W + col
      if (z >= cv.zbuf[p]) {
        cv.zbuf[p] = z
        tbuf[p] = capId
      }
    }
  }
}

// -------------------------------------------------------------------------------- lines
/** Mesh edges between a triangle that faces the camera and one that does not: the outline of
 * curved faces, where they have no B-rep edge. */
function _silhouettes(body: _Body, cam: _Camera): Float64Array {
  const [t0, t1, ends] = body.adjacency()
  if (!t0.length) return new Float64Array(0)
  const n = body.norms
  const front = new Uint8Array(body.count)
  for (let t = 0; t < body.count; t++) {
    const i = t * 9
    const s0 = n[i] + n[i + 3] + n[i + 6]
    const s1 = n[i + 1] + n[i + 4] + n[i + 7]
    const s2 = n[i + 2] + n[i + 5] + n[i + 8]
    front[t] = s0 * cam.back[0] + s1 * cam.back[1] + s2 * cam.back[2] > 1e-9 ? 1 : 0
  }
  const out: number[] = []
  for (let e = 0; e < t0.length; e++) if (front[t0[e]] !== front[t1[e]]) for (let c = 0; c < 6; c++) out.push(ends[e * 6 + c])
  return Float64Array.from(out)
}

/** The farthest depth within r pixels (a square); beyond the border there is nothing. */
function _minFilter(z: Float64Array, W: number, H: number, r: number): Float64Array {
  // along the columns, then along the rows (pixels within r of the border get nothing)
  const a = new Float64Array(z.length).fill(-Infinity)
  for (let y = r; y < H - r; y++) {
    const row = y * W
    a.set(z.subarray(row, row + W), row)
    for (let d = 1; d <= r; d++) {
      const up = row - d * W
      const down = row + d * W
      for (let x = 0; x < W; x++) a[row + x] = Math.min(a[row + x], z[up + x], z[down + x])
    }
  }
  const out = new Float64Array(z.length).fill(-Infinity)
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = r; x < W - r; x++) {
      let m = a[row + x]
      for (let d = 1; d <= r; d++) m = Math.min(m, a[row + x - d], a[row + x + d])
      out[row + x] = m
    }
  }
  return out
}

/** The pixels of a round pen of the radius: [dx, dy] pairs, row by row. */
function _disc(r: number): [number, number][] {
  const m = Math.floor(r)
  const out: [number, number][] = []
  for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) if (dx * dx + dy * dy <= r * r + 1e-9) out.push([dx, dy])
  return out
}

/**
 * Draw segments with a round pen of the radius (in canvas pixels).
 *
 * Modes: `"depth"` where nothing is nearer than `zref` (by more than `eps`); `"all"` everywhere;
 * `"visible"` and `"hidden"` for the line style, where `zref` is the farthest depth around each
 * pixel and the hidden parts are dashed.
 */
function _lines(cv: _Canvas, segs: Float64Array, cols: Float64Array, radius: number, mode: string, zref: Float64Array | null = null, eps = 0.0): void {
  const m = segs.length / 6
  if (!m) return
  const { W, H, k } = cv
  const a = new Float64Array(m * 3)
  const b = new Float64Array(m * 3)
  for (let i = 0; i < m; i++) {
    a.set(segs.subarray(i * 6, i * 6 + 3), i * 3)
    b.set(segs.subarray(i * 6 + 3, i * 6 + 6), i * 3)
  }
  const [ax, ay, az] = cv.screen(a)
  const [bx, by, bz] = cv.screen(b)
  // the pixels of every segment, sampled every 0.7 pixels; a pixel once per segment in a row
  let cap = 1 << 12
  let px = new Int32Array(cap)
  let py = new Int32Array(cap)
  const first = new Int32Array(m + 1)
  let n = 0
  for (let s = 0; s < m; s++) {
    first[s] = n
    const length = Math.hypot(bx[s] - ax[s], by[s] - ay[s])
    const count = Math.min(Math.ceil(length / 0.7), 100_000) + 1
    const steep = Math.abs(by[s] - ay[s]) > Math.abs(bx[s] - ax[s])
    let lastX = -1
    let lastY = -1
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(count - 1, 1)
      // rounded first: an edge exactly on a pixel border must not wander into the next row
      const ix = Math.floor(_round6(ax[s] + (bx[s] - ax[s]) * t))
      const iy = Math.floor(_round6(ay[s] + (by[s] - ay[s]) * t))
      if (!(ix >= 0 && ix < W && iy >= 0 && iy < H)) continue
      if (mode !== 'all') {
        const pz = az[s] + (bz[s] - az[s]) * t
        const visible = pz >= zref![iy * W + ix] - eps
        // the dashes hang on the screen, so lines that coincide dash alike
        const keep = mode === 'hidden' ? !visible && (steep ? iy : ix) % (11 * k) < 7 * k : visible
        if (!keep) continue
      }
      if (ix === lastX && iy === lastY) continue
      lastX = ix
      lastY = iy
      if (n === cap) {
        cap *= 2
        const [x2, y2] = [new Int32Array(cap), new Int32Array(cap)]
        x2.set(px)
        y2.set(py)
        ;[px, py] = [x2, y2]
      }
      px[n] = ix
      py[n] = iy
      n++
    }
  }
  first[m] = n
  if (!n) return
  // pen point by pen point, every segment in order: where pens overlap, the later one wins
  const img = cv.img
  for (const [dx, dy] of _disc(radius)) {
    for (let s = 0; s < m; s++) {
      const [r, g, bb] = [cols[s * 3], cols[s * 3 + 1], cols[s * 3 + 2]]
      for (let i = first[s]; i < first[s + 1]; i++) {
        const jx = px[i] + dx
        const jy = py[i] + dy
        if (jx < 0 || jx >= W || jy < 0 || jy >= H) continue
        const at = (jy * W + jx) * 3
        img[at] = r
        img[at + 1] = g
        img[at + 2] = bb
      }
    }
  }
}

/** Center lines as in a technical drawing, thin and dash-dotted: a cross where a round feature
 * is seen along its axis, a line along the axis where it is seen from the side; both a little
 * past the outline. Oblique axes get none. */
function _centerLines(cv: _Canvas, scene: _Scene, cut: _Cut | null): void {
  const { k, u } = cv
  const over = 8 * u * k // overhang past the outline, canvas pixels
  const lines: [number, number, number, number, number, number][] = []
  const right = cv.cam.right
  const up = cv.cam.up
  for (const { foot, direction: d, t0, t1, radius: r } of scene.axes()) {
    let a: Vec3 = [foot[0] + d[0] * t0, foot[1] + d[1] * t0, foot[2] + d[2] * t0]
    let b: Vec3 = [foot[0] + d[0] * t1, foot[1] + d[1] * t1, foot[2] + d[2] * t1]
    if (cut !== null) {
      const da = cut.distance(a)
      const db = cut.distance(b)
      if (da > 0 && db > 0) continue // cut away
      if (da > 0 || db > 0) {
        const f = da / (da - db)
        const m: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
        if (da > 0) a = m
        else b = m
      }
    }
    const along = _dot3(d, cv.cam.back)
    if (Math.abs(along) > 1 - 1e-6) {
      // seen along the axis: a cross, its arms cut like the part
      const reach = r + over / cv.s
      let ends: Vec3[] = [right, right.map((x) => -x), up, up.map((x) => -x)].map((v) => [a[0] + v[0] * reach, a[1] + v[1] * reach, a[2] + v[2] * reach])
      if (cut !== null) {
        ends = ends
          .map((e) => _clipSegments(Float64Array.of(...a, ...e), cut))
          .filter((s) => s.length)
          .map((s) => [s[3], s[4], s[5]] as Vec3)
      }
      const [x, y] = cv.screen(Float64Array.from([...a, ...ends.flat()]))
      for (let i = 1; i < x.length; i++) lines.push([x[0], y[0], x[i], y[i], x[0], y[0]])
    } else if (Math.abs(along) < 1e-6 && t1 > t0) {
      // seen from the side: the axis
      const [x, y] = cv.screen(Float64Array.of(...a, ...b))
      const length = Math.hypot(x[1] - x[0], y[1] - y[0])
      if (length < 1e-9) continue
      const ux = (x[1] - x[0]) / length
      const uy = (y[1] - y[0]) / length
      lines.push([x[0] - ux * over, y[0] - uy * over, x[1] + ux * over, y[1] + uy * over, (x[0] + x[1]) / 2, (y[0] + y[1]) / 2])
    }
  }
  if (!lines.length) return
  const pen = _disc(0.5 * k)
  for (const s of lines) {
    const length = Math.hypot(s[2] - s[0], s[3] - s[1])
    const count = Math.ceil(length / 0.5) + 1
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(count - 1, 1)
      const px = s[0] + (s[2] - s[0]) * t
      const py = s[1] + (s[3] - s[1]) * t
      // a long dash, a gap, a dot, a gap; a dash sits on the middle of every line
      const dist = Math.hypot(px - s[4], py - s[5]) / (u * k)
      const phase = _mod(dist + 6, 20)
      if (!(phase < 12 || (phase >= 15 && phase < 17))) continue
      _stamp(cv, Math.floor(_round6(px)), Math.floor(_round6(py)), pen, _HIDDEN_INK)
    }
  }
}

function _stamp(cv: _Canvas, x: number, y: number, pen: [number, number][], color: RGB): void {
  for (const [dx, dy] of pen) {
    const jx = x + dx
    const jy = y + dy
    if (jx >= 0 && jx < cv.W && jy >= 0 && jy < cv.H) cv.img.set(color, (jy * cv.W + jx) * 3)
  }
}

/** Segments in canvas pixels, drawn on top. */
export function _screenLines(cv: _Canvas, segs: readonly (readonly [number, number, number, number])[], color: RGB, radius: number): void {
  if (!segs.length) return
  const pen = _disc(radius)
  for (const s of segs) {
    const length = Math.hypot(s[2] - s[0], s[3] - s[1])
    const count = Math.ceil(length / 0.5) + 1
    let lastX = Number.NaN
    let lastY = Number.NaN
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(count - 1, 1)
      const x = Math.floor(_round6(s[0] + (s[2] - s[0]) * t))
      const y = Math.floor(_round6(s[1] + (s[3] - s[1]) * t))
      if (x === lastX && y === lastY) continue
      lastX = x
      lastY = y
      _stamp(cv, x, y, pen, color)
    }
  }
}

function _dot(cv: _Canvas, p: Vec3, color: RGB, radiusPx: number): void {
  const [x, y] = cv.screenPoint(p)
  _screenLines(cv, [[x, y, x, y]], color, radiusPx * cv.k)
}

/** A crosshair in a circle and the label to its right, with a white halo. */
function _marker(cv: _Canvas, pos: Vec3, label: string, color: RGB): void {
  const { k, u } = cv
  const [cx, cy] = cv.screenPoint(pos)
  const r = (8 * u + 1) * k
  const ring = (5.5 * u + 0.5) * k
  const segs: [number, number, number, number][] = [
    [cx - r, cy, cx + r, cy],
    [cx, cy - r, cx, cy + r],
  ]
  // (numpy's linspace(0, 2 pi, 41))
  const step = (2 * Math.PI) / 40
  const angle = (i: number) => (i === 40 ? 2 * Math.PI : i * step)
  for (let i = 0; i < 40; i++) {
    const [a0, a1] = [angle(i), angle(i + 1)]
    segs.push([cx + ring * Math.cos(a0), cy + ring * Math.sin(a0), cx + ring * Math.cos(a1), cy + ring * Math.sin(a1)])
  }
  _screenLines(cv, segs, _WHITE, (0.5 * u + 1) * k)
  _screenLines(cv, segs, color, 0.5 * u * k)
  if (label) cv.text(cx / k + 8 * u + 5, cy / k - 3.5 * (u + 1), label, color, u + 1, 'start', _WHITE)
}

/** The size of the bounding box (bottom right), the axes as the view shows them (bottom left)
 * and a scale bar (bottom middle). */
function _annotate(cv: _Canvas, scene: _Scene): void {
  const { k, w, h, u } = cv
  const extents = [0, 1, 2].map((c) => _roundText(scene.hi[c] - scene.lo[c]))
  cv.text(w - 10 * u, h - 10 * u - 7 * (u + 1), extents.join(' X '), _LABEL, u + 1, 'end')
  const ox = 34 * u * k
  const oy = (h - 34 * u) * k
  const axes: [Vec3, RGB, string][] = [
    [[1.0, 0, 0], [200 / 255, 40 / 255, 40 / 255], 'X'],
    [[0, 1.0, 0], [40 / 255, 150 / 255, 40 / 255], 'Y'],
    [[0, 0, 1.0], [40 / 255, 70 / 255, 200 / 255], 'Z'],
  ]
  for (const [d, color, name] of axes) {
    const dx = _dot3(d, cv.cam.right)
    const dy = -_dot3(d, cv.cam.up)
    const length = Math.hypot(dx, dy)
    if (length < 1e-6) continue // the axis points into the screen
    const ux = dx / length
    const uy = dy / length
    const tx = ox + ux * 26 * u * k
    const ty = oy + uy * 26 * u * k
    _screenLines(cv, [[ox, oy, tx, ty]], color, 0.6 * u * k)
    cv.text(tx / k + (ux * 6 - 2.5) * u, ty / k + (uy * 6 - 3.5) * u, name, color, u)
  }
  const scale = cv.s / k / u // model units per overlay pixel
  let bar = 10.0 ** Math.floor(Math.log10(100 / scale))
  for (const m of [1, 2, 5, 10]) {
    if (bar * m * scale >= 60) {
      bar *= m
      break
    }
  }
  const half = (bar * scale * u) / 2
  const x0 = (w / 2 - half) * k
  const x1 = (w / 2 + half) * k
  const y0 = (h - 16 * u) * k
  _screenLines(
    cv,
    [
      [x0, y0, x1, y0],
      [x0, y0, x0, y0 - 4 * u * k],
      [x1, y0, x1, y0 - 4 * u * k],
    ],
    _LABEL,
    0.5 * u * k,
  )
  cv.text(w / 2, h - 30 * u, _roundText(bar), _LABEL, u, 'middle')
}

function _roundText(v: number): string {
  if (Math.abs(v - _pyRound(v)) < 0.05) return String(_pyRound(v))
  return Math.abs(v) >= 1 ? v.toFixed(1) : _formatG(v, 3)
}

// -------------------------------------------------------------------------------- sheets and drawings
function _sheetViews(sheet: unknown): unknown[] {
  if (sheet === true) return ['top', 'iso', 'front', 'right']
  if (sheet == null || typeof (sheet as Any)[Symbol.iterator] !== 'function' || typeof sheet === 'string') {
    throw new TypeError(`sheet takes true or a list of views, got ${_repr(sheet)}`)
  }
  const views = Array.from(sheet as Iterable<unknown>)
  if (views.length !== 2 && views.length !== 4) throw new RangeError(`sheet takes true, 4 views or 2 views, got ${views.length} views`)
  return views
}

/** Views in one picture: 2 x 2 panels, or 2 side by side. Named ortho views share one scale (the
 * smallest of their fits) and keep their own middles, so they line up like the views of a
 * drawing; the others fit themselves (panel `band` above a strip at its bottom kept free for a
 * caption). */
function _sheet(scene: _Scene, views: unknown[], w: number, h: number, o: _Options, lines: boolean[] | null = null, labels: string[] | null = null, band = -1): _Img {
  const rows = views.length === 2 ? 1 : 2
  const qw = Math.floor(w / 2)
  const qh = Math.floor(h / rows)
  const cams = views.map((v) => (v == null ? null : _Camera.of(v)))
  const fits = cams.map((c) => (c === null ? null : _fit(scene, c, qw, qh)))
  if (band >= 0 && fits[band] !== null) {
    const strip = Math.min(_CAPTION, Math.floor(qh / 3))
    const fit = _fit(scene, cams[band]!, qw, qh - strip)
    fits[band] = { ...fit, midY: fit.midY - strip / 2 / fit.scale }
  }
  const ortho = views.flatMap((v, i) => (typeof v === 'string' && _ORTHO.includes(v.toLowerCase()) ? [i] : []))
  if (ortho.length) {
    const common = Math.min(...ortho.map((i) => fits[i]!.scale))
    for (const i of ortho) fits[i] = { ...fits[i]!, scale: common }
  }
  const img: _Img = { data: _filled(new Float64Array(w * h * 3), o.bg), width: w, height: h }
  const isLines = (i: number) => (lines === null ? o.lines : lines[i])
  const shaded = cams.flatMap((c, i) => (c !== null && !isLines(i) ? [i] : []))
  cams.forEach((cam, i) => {
    const fr = fits[i]
    if (cam === null || fr === null) return
    const legend = shaded.length > 0 && i === shaded[shaded.length - 1] // one legend for the sheet, in the last shaded panel
    const tile = _view(scene, cam, qw, qh, _panel(o, isLines(i), legend), fr)
    const y0 = Math.floor(i / 2) * qh
    const x0 = (i % 2) * qw
    for (let y = 0; y < qh; y++) for (let x = 0; x < qw * 3; x++) img.data[((y0 + y) * w + x0) * 3 + x] = tile.data[y * qw * 3 + x]
    _text(img, x0 + 8, y0 + 8, labels ? labels[i] : cam.label || String.fromCharCode(65 + i), _LABEL, 2)
  })
  if (rows === 2) for (let x = 0; x < w; x++) img.data.set(_DIVIDER, (qh * w + x) * 3)
  for (let y = 0; y < h; y++) img.data.set(_DIVIDER, (y * w + qw) * 3)
  return img
}

/** Front, top and side view in line style, placed by the projection method, and a shaded iso
 * view in the free corner, labelled with the method. */
function _drawing(scene: _Scene, w: number, h: number, o: _Options, drawing: unknown): _Img {
  const spec: Record<string, Any> = typeof drawing === 'string' ? { projection: drawing } : _isPlainObject(drawing) ? { ...drawing } : {}
  const projection = spec.projection || 'first-angle'
  if (projection !== 'first-angle' && projection !== 'third-angle') {
    throw new RangeError(`drawing: the projection is 'first-angle' or 'third-angle', got ${_repr(projection)}`)
  }
  const third = projection === 'third-angle'
  const side = spec.side || (third ? 'right' : 'left')
  if (side !== 'left' && side !== 'right') throw new RangeError(`drawing: the side is 'left' or 'right', got ${_repr(side)}`)
  // first angle: the view from the left stands right of the front view, the top view below it;
  // third angle: the view from the right stands right of it, the top view above it
  const sideRight = third ? side === 'right' : side === 'left'
  const frontCol = sideRight ? 0 : 1
  const frontRow = third ? 1 : 0
  const views: (string | null)[] = [null, null, null, null]
  views[frontRow * 2 + frontCol] = 'front'
  views[(1 - frontRow) * 2 + frontCol] = 'top'
  views[frontRow * 2 + 1 - frontCol] = side
  const free = (1 - frontRow) * 2 + 1 - frontCol
  if ('iso' in spec ? spec.iso : true) views[free] = 'iso'
  const names: Record<string, string> = { front: 'FRONT', top: 'TOP', left: 'FROM LEFT', right: 'FROM RIGHT', iso: 'ISO' }
  const plain = { ...o, xray: false }
  const img = _sheet(
    scene,
    views,
    w,
    h,
    plain,
    views.map((v) => v !== 'iso'),
    views.map((v) => (v === null ? '' : (names[v] ?? ''))),
    free,
  )
  const text = third ? 'THIRD-ANGLE PROJECTION - ISO A' : 'FIRST-ANGLE PROJECTION - ISO E'
  const qw = Math.floor(w / 2)
  const qh = Math.floor(h / 2)
  const scale = _textWidth(text, 2) <= qw - 20 ? 2 : 1
  _text(img, (free % 2) * qw + qw - 10, Math.floor(free / 2) * qh + qh - 12 - 7 * scale, text, _LABEL, scale, 'end')
  return img
}

// -------------------------------------------------------------------------------- text: a 5 x 7 bitmap font
const _GLYPHS: Record<string, readonly string[]> = {
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  C: [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  G: [' ### ', '#   #', '#    ', '# ###', '#   #', '#   #', ' ####'],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  I: [' ### ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  J: ['  ###', '   # ', '   # ', '   # ', '   # ', '#  # ', ' ##  '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'],
  N: ['#   #', '#   #', '##  #', '# # #', '#  ##', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  Q: [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '# # #', ' # # '],
  X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  '0': [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  '1': ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  '2': [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  '3': ['#####', '   # ', '  #  ', '   # ', '    #', '#   #', ' ### '],
  '4': ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  '5': ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  '6': ['  ## ', ' #   ', '#    ', '#### ', '#   #', '#   #', ' ### '],
  '7': ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  '8': [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '],
  '9': [' ### ', '#   #', '#   #', ' ####', '    #', '   # ', ' ##  '],
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
  '.': ['     ', '     ', '     ', '     ', '     ', ' ##  ', ' ##  '],
  ',': ['     ', '     ', '     ', '     ', ' ##  ', '  #  ', ' #   '],
  ':': ['     ', ' ##  ', ' ##  ', '     ', ' ##  ', ' ##  ', '     '],
  ';': ['     ', ' ##  ', ' ##  ', '     ', ' ##  ', '  #  ', ' #   '],
  '-': ['     ', '     ', '     ', '#####', '     ', '     ', '     '],
  '+': ['     ', '  #  ', '  #  ', '#####', '  #  ', '  #  ', '     '],
  '=': ['     ', '     ', '#####', '     ', '#####', '     ', '     '],
  '/': ['     ', '    #', '   # ', '  #  ', ' #   ', '#    ', '     '],
  '\\': ['     ', '#    ', ' #   ', '  #  ', '   # ', '    #', '     '],
  '(': ['   # ', '  #  ', ' #   ', ' #   ', ' #   ', '  #  ', '   # '],
  ')': [' #   ', '  #  ', '   # ', '   # ', '   # ', '  #  ', ' #   '],
  '[': [' ### ', ' #   ', ' #   ', ' #   ', ' #   ', ' #   ', ' ### '],
  ']': [' ### ', '   # ', '   # ', '   # ', '   # ', '   # ', ' ### '],
  '<': ['   # ', '  #  ', ' #   ', '#    ', ' #   ', '  #  ', '   # '],
  '>': [' #   ', '  #  ', '   # ', '    #', '   # ', '  #  ', ' #   '],
  _: ['     ', '     ', '     ', '     ', '     ', '     ', '#####'],
  "'": ['  #  ', '  #  ', ' #   ', '     ', '     ', '     ', '     '],
  '"': [' # # ', ' # # ', '     ', '     ', '     ', '     ', '     '],
  '!': ['  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '     ', '  #  '],
  '?': [' ### ', '#   #', '    #', '   # ', '  #  ', '     ', '  #  '],
  '#': [' # # ', ' # # ', '#####', ' # # ', '#####', ' # # ', ' # # '],
  '%': ['##   ', '##  #', '   # ', '  #  ', ' #   ', '#  ##', '   ##'],
  '*': ['     ', '  #  ', '# # #', ' ### ', '# # #', '  #  ', '     '],
  '&': [' ##  ', '#  # ', '# #  ', ' #   ', '# # #', '#  # ', ' ## #'],
  '@': [' ### ', '#   #', '# ###', '# # #', '# ###', '#    ', ' ####'],
  '|': ['  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  '~': ['     ', '     ', ' #   ', '# # #', '   # ', '     ', '     '],
  '°': [' ##  ', '#  # ', '#  # ', ' ##  ', '     ', '     ', '     '],
  '²': [' ##  ', '   # ', '  #  ', ' ### ', '     ', '     ', '     '],
  Ø: [' ####', '#  ##', '# # #', '# # #', '# # #', '##  #', '#### '],
  '×': ['     ', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '     '],
  '±': ['  #  ', '  #  ', '#####', '  #  ', '  #  ', '     ', '#####'],
}

/** The glyphs of the font: 7 rows of 5 pixels each (true: ink). */
export const _FONT: ReadonlyMap<string, readonly (readonly boolean[])[]> = new Map(
  Object.entries(_GLYPHS).map(([ch, rows]) => [ch, rows.map((row) => [...row].map((c) => c === '#'))]),
)

export function _textWidth(text: string, scale = 1): number {
  const n = [...text].length
  return n ? n * 6 * scale - scale : 0
}

/** Text in the 5 x 7 font, in capitals. (x, y) is the top left of the text, or its top middle or
 * top right for anchor "middle" or "end". Characters without a glyph stay blank. `halo`: a one
 * pixel outline in this color, so the text reads on any background. */
export function _text(img: _Img, x: number, y: number, text: string, color: RGB, scale = 1, anchor = 'start', halo: RGB | null = null): void {
  const chars = [...String(text).toUpperCase()]
  if (!chars.length) return
  const mh = 7 * scale + 2
  const mw = chars.length * 6 * scale + 2
  const mask = new Uint8Array(mh * mw)
  chars.forEach((ch, i) => {
    const glyph = _FONT.get(ch)
    if (glyph === undefined) return
    for (let r = 0; r < 7 * scale; r++) {
      for (let c = 0; c < 5 * scale; c++) if (glyph[Math.floor(r / scale)][Math.floor(c / scale)]) mask[(1 + r) * mw + 1 + i * 6 * scale + c] = 1
    }
  })
  const width = _textWidth(chars.join(''), scale)
  const x0 = _pyRound(x - (anchor === 'end' ? width : anchor === 'middle' ? width / 2 : 0)) - 1
  const y0 = _pyRound(y) - 1
  const { width: w, height: h, data } = img
  const sx0 = Math.max(x0, 0)
  const sy0 = Math.max(y0, 0)
  const sx1 = Math.min(x0 + mw, w)
  const sy1 = Math.min(y0 + mh, h)
  if (sx1 <= sx0 || sy1 <= sy0) return
  const paint = (m: Uint8Array, rgb: RGB) => {
    for (let py = sy0; py < sy1; py++) for (let px = sx0; px < sx1; px++) if (m[(py - y0) * mw + px - x0]) data.set(rgb, (py * w + px) * 3)
  }
  if (halo !== null) {
    // the mask grown by one pixel in every direction (diagonals too)
    const tall = new Uint8Array(mask.length)
    for (let r = 0; r < mh; r++) {
      for (let c = 0; c < mw; c++) {
        tall[r * mw + c] = mask[r * mw + c] | (r > 0 ? mask[(r - 1) * mw + c] : 0) | (r + 1 < mh ? mask[(r + 1) * mw + c] : 0)
      }
    }
    const grown = new Uint8Array(mask.length)
    for (let r = 0; r < mh; r++) {
      for (let c = 0; c < mw; c++) {
        grown[r * mw + c] = tall[r * mw + c] | (c > 0 ? tall[r * mw + c - 1] : 0) | (c + 1 < mw ? tall[r * mw + c + 1] : 0)
      }
    }
    paint(grown, halo)
  }
  paint(mask, color)
}

// -------------------------------------------------------------------------------- PNG
/** The bytes of a float image (0 to 1): numpy's clip(img * 255 + 0.5, 0, 255) as uint8, in the
 * image's own precision. */
export function _toBytes(img: _Img): Uint8Array {
  const { data } = img
  const out = new Uint8Array(data.length)
  if (data instanceof Float32Array) {
    const f = Math.fround
    for (let i = 0; i < data.length; i++) out[i] = Math.min(Math.max(f(f(data[i] * 255) + 0.5), 0), 255)
  } else {
    for (let i = 0; i < data.length; i++) out[i] = Math.min(Math.max(data[i] * 255 + 0.5, 0), 255)
  }
  return out
}

let _crcTable: Uint32Array | null = null

function _crc32(bytes: Uint8Array, crc = 0): number {
  if (_crcTable === null) {
    _crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      _crcTable[n] = c >>> 0
    }
  }
  let c = ~crc >>> 0
  for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function _adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(i + 5552, bytes.length)
    for (; i < end; i++) {
      a += bytes[i]
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

/** A zlib stream of the bytes: compressed (level 6) by Node's zlib, elsewhere stored in
 * uncompressed blocks (which still make a valid PNG). */
function _zlib(raw: Uint8Array): Uint8Array {
  const zlib = _builtin('node:zlib')
  if (zlib) return new Uint8Array(zlib.deflateSync(raw, { level: 6 }))
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  out[0] = 0x78
  out[1] = 0x01
  let at = 2
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min((i + 1) * 65535, raw.length))
    out[at] = i === blocks - 1 ? 1 : 0
    out[at + 1] = part.length & 0xff
    out[at + 2] = part.length >>> 8
    out[at + 3] = ~part.length & 0xff
    out[at + 4] = (~part.length >>> 8) & 0xff
    out.set(part, at + 5)
    at += 5 + part.length
  }
  new DataView(out.buffer).setUint32(at, _adler32(raw))
  return out
}

/** PNG file contents of RGB pixels. */
export function _png(pixels: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 3))
  for (let r = 0; r < h; r++) raw.set(pixels.subarray(r * w * 3, (r + 1) * w * 3), r * (1 + w * 3) + 1)
  const chunk = (tag: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = tag.charCodeAt(i)
    out.set(data, 8)
    view.setUint32(8 + data.length, _crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, w)
  hv.setUint32(4, h)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', ihdr), chunk('IDAT', _zlib(raw)), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** An 8-bit, non-interlaced PNG (gray, RGB, gray and alpha, RGBA) as RGB pixels. */
export function _pngDecode(data: Uint8Array): _RGBImage {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (data.length < 8 || signature.some((b, i) => data[i] !== b)) throw new RangeError('not a PNG file')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let pos = 8
  const idat: Uint8Array[] = []
  let [w, h, depth, ctype, interlace] = [0, 0, 0, 0, 0]
  while (pos + 8 <= data.length) {
    const n = view.getUint32(pos)
    const tag = String.fromCharCode(...data.subarray(pos + 4, pos + 8))
    const body = data.subarray(pos + 8, pos + 8 + n)
    if (tag === 'IHDR') {
      const bv = new DataView(body.buffer, body.byteOffset, body.byteLength)
      ;[w, h, depth, ctype, interlace] = [bv.getUint32(0), bv.getUint32(4), body[8], body[9], body[12]]
    } else if (tag === 'IDAT') idat.push(body)
    else if (tag === 'IEND') break
    pos += 12 + n
  }
  const bpp = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[ctype]
  if (depth !== 8 || bpp === undefined || interlace) throw new RangeError('only 8-bit, non-interlaced gray, RGB and RGBA PNG files can be read')
  const stream = new Uint8Array(idat.reduce((s, b) => s + b.length, 0))
  let at = 0
  for (const b of idat) {
    stream.set(b, at)
    at += b.length
  }
  const raw = _inflate(stream)
  const stride = w * bpp
  if (raw.length < h * (1 + stride)) throw new RangeError('not a PNG file: the image data is too short')
  const out = new Uint8Array(h * stride)
  for (let r = 0; r < h; r++) {
    const f = raw[r * (1 + stride)]
    const line = raw.subarray(r * (1 + stride) + 1, (r + 1) * (1 + stride))
    const cur = out.subarray(r * stride, (r + 1) * stride)
    const prev = r ? out.subarray((r - 1) * stride, r * stride) : new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      let pred: number
      if (f === 0) pred = 0
      else if (f === 1) pred = a
      else if (f === 2) pred = b
      else if (f === 3) pred = (a + b) >> 1
      else {
        // Paeth
        const c = i >= bpp ? prev[i - bpp] : 0
        const p = a + b - c
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = (line[i] + pred) & 0xff
    }
  }
  const pixels = new Uint8Array(w * h * 3)
  for (let p = 0; p < w * h; p++) {
    for (let c = 0; c < 3; c++) pixels[p * 3 + c] = bpp < 3 ? out[p * bpp] : out[p * bpp + c]
  }
  return { pixels, width: w, height: h }
}

/** The bytes of a zlib stream: by Node's zlib, elsewhere by the small inflater below. */
function _inflate(stream: Uint8Array): Uint8Array {
  const zlib = _builtin('node:zlib')
  if (zlib) return new Uint8Array(zlib.inflateSync(stream))
  return _inflateRaw(stream.subarray(2))
}

// A plain inflater (RFC 1951; as zlib's puff): stored, fixed and dynamic Huffman blocks.
function _inflateRaw(src: Uint8Array): Uint8Array {
  let out = new Uint8Array(Math.max(1024, src.length * 4))
  let n = 0
  let pos = 0
  let bit = 0
  let bits = 0
  const need = (count: number): number => {
    while (bits < count) {
      if (pos >= src.length) throw new RangeError('not a PNG file: the image data ends early')
      bit |= src[pos++] << bits
      bits += 8
    }
    const v = bit & ((1 << count) - 1)
    bit >>>= count
    bits -= count
    return v
  }
  const put = (b: number) => {
    if (n === out.length) {
      const bigger = new Uint8Array(out.length * 2)
      bigger.set(out)
      out = bigger
    }
    out[n++] = b
  }
  // a canonical Huffman code: the number of codes of each length and the symbols in order
  const code = (lengths: ArrayLike<number>): [Int32Array, Int32Array] => {
    const count = new Int32Array(16)
    for (let i = 0; i < lengths.length; i++) count[lengths[i]]++
    count[0] = 0
    const offs = new Int32Array(16)
    for (let l = 1; l < 16; l++) offs[l] = offs[l - 1] + count[l - 1]
    const symbols = new Int32Array(lengths.length)
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i
    return [count, symbols]
  }
  const decode = ([count, symbols]: [Int32Array, Int32Array]): number => {
    let c = 0
    let first = 0
    let index = 0
    for (let l = 1; l < 16; l++) {
      c |= need(1)
      const cnt = count[l]
      if (c - cnt < first) return symbols[index + (c - first)]
      index += cnt
      first += cnt
      first <<= 1
      c <<= 1
    }
    throw new RangeError('not a PNG file: a bad Huffman code')
  }
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
  let last = 0
  while (!last) {
    last = need(1)
    const type = need(2)
    if (type === 0) {
      bit = 0
      bits = 0
      const len = src[pos] | (src[pos + 1] << 8)
      pos += 4
      for (let i = 0; i < len; i++) put(src[pos++])
      continue
    }
    let lit: [Int32Array, Int32Array]
    let dist: [Int32Array, Int32Array]
    if (type === 1) {
      const l = new Uint8Array(288)
      l.fill(8, 0, 144)
      l.fill(9, 144, 256)
      l.fill(7, 256, 280)
      l.fill(8, 280, 288)
      lit = code(l)
      dist = code(new Uint8Array(30).fill(5))
    } else if (type === 2) {
      const nlen = need(5) + 257
      const ndist = need(5) + 1
      const ncode = need(4) + 4
      const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
      const cl = new Uint8Array(19)
      for (let i = 0; i < ncode; i++) cl[order[i]] = need(3)
      const lencode = code(cl)
      const lengths = new Uint8Array(nlen + ndist)
      for (let i = 0; i < nlen + ndist; ) {
        const sym = decode(lencode)
        if (sym < 16) lengths[i++] = sym
        else {
          let rep = 0
          let value = 0
          if (sym === 16) {
            value = lengths[i - 1]
            rep = 3 + need(2)
          } else if (sym === 17) rep = 3 + need(3)
          else rep = 11 + need(7)
          while (rep--) lengths[i++] = value
        }
      }
      lit = code(lengths.subarray(0, nlen))
      dist = code(lengths.subarray(nlen))
    } else throw new RangeError('not a PNG file: a bad block type')
    for (;;) {
      const sym = decode(lit)
      if (sym < 256) put(sym)
      else if (sym === 256) break
      else {
        const s = sym - 257
        const len = LBASE[s] + need(LEXT[s])
        const d = decode(dist)
        const back = DBASE[d] + need(DEXT[d])
        for (let i = 0; i < len; i++) put(out[n - back])
      }
    }
  }
  return out.slice(0, n)
}
