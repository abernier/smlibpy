// Pictures without a GPU: smlibpy's render draws bodies, curves and triangle meshes to a PNG in
// software (Node, workers, tests), as shaded views, technical drawings and sheets, with sections,
// highlights, markers, x-ray views, zebra stripes and curvature maps. It draws objects where the
// scene shows them (their matrixWorld), in their materials' colors, and takes its options in
// three's terms: points, directions and planes in three's world coordinates, three's colors,
// radians. The named views look as they say in a three scene: 'top' looks down -Y, 'front' from
// +Z (where three's default camera is), 'right' from +X. (The kernel's renderer names its views for
// Z up: it draws the scene turned onto such a stage, STAGE, which nothing outside this module sees.)
//
// three draws the interactive view: smlibpy's viewer (htmlPage, show) is not wrapped.
import * as THREE from 'three'
import { boundBox, call, degrees, describe, location, sm, vec } from './kernel.ts'
import { Body, BrepEdge, BrepFace, Sketch, BrepVertex, Wire, frameOf, isObject3D, kernelOf, kernelOfShape } from './shapes.ts'
import { TriangleMesh, kernelMesh } from './mesh.ts'

/** @internal
 * three's world turned onto the kernel renderer's stage, which is Z up: (x, y, z) to (x, -z, y), so
 * that its 'top' (+Z) is three's +Y and its 'front' (-Y) three's +Z. */
export const STAGE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1)
const UNSTAGE = STAGE.clone().transpose()

/** @internal
 * A body, face, edge, wire, vertex or TriangleMesh where the scene shows it, on the stage. */
export function staged(o: Body | BrepFace | BrepEdge | Wire | BrepVertex | TriangleMesh): sm.Shape | sm.Mesh {
  const value = o instanceof TriangleMesh ? kernelMesh(o) : o instanceof Body ? kernelOf(o) : kernelOfShape(o)
  const frame = o instanceof TriangleMesh ? o : frameOf(o)
  frame.updateWorldMatrix(true, false)
  const m = STAGE.clone().multiply(frame.matrixWorld)
  return call(() => value.moved(location(m)))
}

/** A point or direction of three's world on the stage, as the kernel's vector (STAGE only turns). */
function stagedVec(v: THREE.Vector3Like): sm.Vector {
  return vec(new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(STAGE))
}

// --------------------------------------------------------------------------------------- types
/** The named views: from the front (+Z), back, left, right (+X), above (+Y) and below, and the
 * isometric view from front, right and above. */
export type RenderViewName = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

/**
 * The camera of `render`, orthographic and fitted to what it draws: a named view; the direction
 * from the objects towards the camera (a THREE.Vector3: the position of a camera that looks at
 * the origin); `{ direction, up }`, the direction the camera looks in and its up (a camera's
 * `getWorldDirection()` and `up`; up defaults to +Y); or `{ azimuth, elevation }` in radians
 * (azimuth 0 from the front, π/2 from the right; elevation π/2 from above). Views are never
 * mirrored.
 */
export type RenderView = RenderViewName | THREE.Vector3Like | { direction: THREE.Vector3Like; up?: THREE.Vector3Like | null } | { azimuth?: number; elevation?: number }

/** A point of `render`'s options, in the world: a point, the center of a box, or the center of an
 * object where it is (a body's center of mass, the middle of other objects' boxes). */
export type RenderPoint = THREE.Vector3Like | THREE.Box3 | THREE.Object3D

/** A crosshair `render` draws on top, with a label. */
export interface RenderMarker {
  position: RenderPoint
  label?: string
  /** Default red. */
  color?: THREE.ColorRepresentation | null
}

/** The frame of a single view: output pixels per model unit (`scale`), and the point in the middle
 * of the picture along the view's right and up directions (`midX`, `midY`, in model units). */
export interface Frame {
  readonly scale: number
  readonly midX: number
  readonly midY: number
}

/** Pixels to compare: `width * height` pixels row by row from the top left, 3 or 4 numbers each
 * (RGB or RGBA, as a canvas's ImageData); bytes (Uint8Array, Uint8ClampedArray) or numbers from 0
 * to 1 (any other array). */
export interface ImageLike {
  width: number
  height: number
  data: ArrayLike<number>
}

/** The options of `render`. */
export interface RenderOptions {
  /** The camera (default 'iso'); 'sheet' is `drawing: 'first-angle'`. */
  view?: RenderView | 'sheet'
  /** Width and height in pixels (default [800, 600]). */
  size?: readonly [number, number]
  /** Draw the edges of faces in the shaded view (default true; hidden edges stay hidden). */
  edges?: boolean
  /** Default white. */
  background?: THREE.ColorRepresentation
  /** Tessellation tolerance (null, the default: 0.1 % of each body's size). */
  tolerance?: number | null
  /** Factor on the scale that fits the objects (2 shows half as much). */
  zoom?: number
  /** A point that lands in the middle of the picture. */
  lookAt?: RenderPoint | null
  /** The frame of an earlier render of the same view and size (a Picture or its `frame`): scale and
   * middle stay, so pictures of a changed model compare pixel by pixel (`diffImages`). Overrides
   * `zoom` and `lookAt`. */
  frame?: Frame | Picture | null
  /** Render at this many times the size and average down (1 to 4, default 2: smooth edges). */
  supersample?: number
  /** 'native' (default): each object in its material's color (a material without one: a palette
   * color by its place in the list); 'distinct': a palette color per body, also per solid of a part. */
  colors?: 'native' | 'distinct'
  /** Line style: no fill, visible edges and silhouettes solid, hidden ones dashed. */
  lines?: boolean
  /** A technical drawing: front, top and side view in line style at one scale, and a shaded iso
   * view in the free corner. `true` or 'first-angle' (ISO method E: the top view below the front
   * view, the view from the left right of it), 'third-angle' (method A), or `{ projection, side,
   * iso }` to pick the side view or leave the corner empty. */
  drawing?: boolean | 'first-angle' | 'third-angle' | { projection?: 'first-angle' | 'third-angle'; side?: 'left' | 'right'; iso?: boolean } | null
  /** Several shaded views in one picture: `true` (top, iso, front, right), 4 views (2 x 2) or 2 side
   * by side. Named ortho views share one scale. `drawing` wins over `sheet`. */
  sheet?: boolean | readonly (RenderView | null)[] | null
  /** Cut at a plane (in the world) and keep what three's clipping with it keeps: the side its
   * normal points to. The picture keeps the framing of the whole model. */
  section?: THREE.Plane | null
  /** Fill the cut faces of closed bodies, hatched (default true); false leaves the cut open. */
  cap?: boolean
  /** Objects drawn in signal colors where they are: faces, bodies and meshes orange, edges and
   * wires red, vertices as dots. (Faces, edges and vertices added to their body, as three
   * highlights them, are drawn so too.) */
  highlight?: THREE.Object3D | Iterable<THREE.Object3D | Iterable<THREE.Object3D>> | null
  /** Points (in the world): the face nearest to each is highlighted. */
  highlightAt?: THREE.Vector3Like | Iterable<THREE.Vector3Like> | null
  /** Crosshairs with labels, drawn on top: points, or markers with a label and a color. */
  markers?: RenderPoint | RenderMarker | Iterable<RenderPoint | RenderMarker> | null
  /** Translucent bodies: hidden faces shine through, edges stay opaque. */
  xray?: boolean
  /** The opacity of each face in the x-ray view (0 to 1, default 0.42). */
  xrayAlpha?: number
  /** Zebra stripes from the exact surface normals (they break at G0, kink at G1, run smoothly
   * across G2 joints): `true`, or the number of black stripes, the black share of each and the
   * direction of the light lines ('vertical' or 'horizontal' on the screen, or a direction in the
   * world). */
  zebra?: boolean | { stripes?: number; width?: number; direction?: 'vertical' | 'horizontal' | THREE.Vector3Like } | null
  /** A curvature map of the exact surfaces (blue concave, white flat, red convex, in 1/mm; 1/mm² for
   * 'gaussian'): the kind, or `{ kind, range }` to fix the range (`range` or `[low, high]`). */
  curvature?: 'mean' | 'gaussian' | 'max' | 'min' | { kind?: 'mean' | 'gaussian' | 'max' | 'min'; range?: number | readonly [number, number] | null } | false | null
}

// --------------------------------------------------------------------------------------- results
/**
 * A picture `render` made: the PNG file's bytes (`data`: write them to a file, or show them,
 * `URL.createObjectURL(new Blob([picture.data], { type: 'image/png' }))`) and its pixels.
 */
export class Picture {
  /** The PNG file's bytes. */
  readonly data: Uint8Array
  /** `width * height` pixels row by row from the top left, three bytes (red, green, blue) each. */
  readonly pixels: Uint8Array
  readonly width: number
  readonly height: number
  /** The frame of a single view (give it to a later render as `frame`); null for sheets and drawings. */
  readonly frame: Frame | null

  constructor(data: Uint8Array, pixels: Uint8Array, width: number, height: number, frame: Frame | null = null) {
    this.data = data
    this.pixels = pixels
    this.width = width
    this.height = height
    this.frame = frame
  }
}

/** How two pictures differ (`diffImages`). */
export class ImageDiff {
  /** The number of pixels that differ. */
  readonly changed: number
  /** The number of pixels. */
  readonly total: number
  /** `changed / total`. */
  readonly fraction: number
  /** The pixels that changed lie in `[x0, y0, x1, y1]` (inclusive); null where none did. */
  readonly bbox: readonly [number, number, number, number] | null
  /** The difference: changed pixels red on a faded gray of the second picture. */
  readonly picture: Picture

  constructor(changed: number, total: number, fraction: number, bbox: readonly [number, number, number, number] | null, picture: Picture) {
    this.changed = changed
    this.total = total
    this.fraction = fraction
    this.bbox = bbox
    this.picture = picture
  }
}

/** The named views as directions from the objects towards the camera, in three's axes: `top` is
 * +Y, `front` +Z, `right` +X, `iso` (1, 1, 1) normalized. (Frozen: copy them,
 * `camera.position.copy(VIEWS.iso).multiplyScalar(distance)`.) */
export const VIEWS: Readonly<Record<RenderViewName, THREE.Vector3>> = Object.freeze(
  Object.fromEntries(Object.entries(sm.VIEWS).map(([name, d]) => [name, Object.freeze(new THREE.Vector3(d[0], d[1], d[2]).applyMatrix4(UNSTAGE))])) as Record<RenderViewName, THREE.Vector3>,
)

// --------------------------------------------------------------------------------------- render
const OPTIONS = [
  'view',
  'size',
  'edges',
  'background',
  'tolerance',
  'zoom',
  'lookAt',
  'frame',
  'supersample',
  'colors',
  'lines',
  'drawing',
  'sheet',
  'section',
  'cap',
  'highlight',
  'highlightAt',
  'markers',
  'xray',
  'xrayAlpha',
  'zebra',
  'curvature',
]
// (the options the kernel takes as they are)
const AS_THEY_ARE = ['size', 'edges', 'tolerance', 'zoom', 'supersample', 'colors', 'lines', 'drawing', 'cap', 'xray', 'xrayAlpha', 'curvature'] as const

/**
 * A PNG picture of objects, drawn in software (no GPU: Node, workers, tests): each object and what
 * is under it, where the scene shows it. Bodies (Part, Shell, Sketch) are drawn shaded with their
 * edges, TriangleMeshes shaded, curves of their own (BrepEdge, Wire) as lines on top, each in its
 * material's color (a sketch drawn with solids: its outline on top, in blue); faces, edges and
 * vertices added to their body (three's highlights) are drawn highlighted, and faces or edges given
 * on their own are drawn where their body is. Other objects (lights, cameras, plain meshes) are
 * left out, and so are invisible ones and what is under them, as three's renderers leave them out,
 * and empty or disposed ones.
 *
 *     const picture = render(part, { view: 'top', size: [400, 300] })
 *     writeFileSync('part.png', picture.data)
 */
export function render(objects: THREE.Object3D | Iterable<THREE.Object3D>, options: RenderOptions = {}): Picture {
  for (const key of Object.keys(options)) {
    if (!OPTIONS.includes(key)) throw new TypeError(`render() got an unexpected option '${key}' (its options: ${OPTIONS.join(', ')})`)
  }
  const { items, highlights } = drawn(objects)
  if (!items.length) throw new RangeError('render: nothing to draw (it draws bodies, curves and TriangleMeshes, and leaves out invisible ones)')
  const o: Record<string, unknown> = {}
  for (const key of AS_THEY_ARE) if (options[key] !== undefined) o[key] = options[key]
  if (options.view !== undefined) o.view = options.view === 'sheet' ? 'sheet' : view(options.view)
  if (options.background != null) o.background = hex(options.background)
  if (options.lookAt != null) o.lookAt = point(options.lookAt)
  if (options.frame != null) o.frame = kernelFrame(options.frame)
  if (options.sheet != null) o.sheet = typeof options.sheet === 'boolean' ? options.sheet : [...options.sheet].map((v) => (v == null ? null : view(v)))
  if (options.section != null) o.section = section(options.section)
  if (options.highlight != null) highlights.push(...highlighted(options.highlight))
  if (highlights.length) o.highlight = highlights
  if (options.highlightAt != null) o.highlightAt = isVector(options.highlightAt) ? [stagedVec(options.highlightAt)] : [...(options.highlightAt as Iterable<THREE.Vector3Like>)].map((p) => stagedVec(p))
  if (options.markers != null) o.markers = markers(options.markers)
  if (options.zebra != null) o.zebra = zebra(options.zebra)
  return pictureOf(call(() => sm.render(items as sm.Renderable[], o as sm.RenderOptions)))
}

/**
 * Compares two pictures of the same size pixel by pixel: pictures of `render`, PNG file bytes, or
 * pixels (`ImageLike`). `tolerance` is the largest difference per color channel (0 to 255) that
 * still counts as equal. Meaningful for two renders of one view with the same `frame`: without
 * it, a changed model is fitted anew and every pixel moves.
 */
export function diffImages(a: Picture | ImageLike | Uint8Array | ArrayBuffer, b: Picture | ImageLike | Uint8Array | ArrayBuffer, tolerance = 0): ImageDiff {
  const d = call(() => sm.diffImages(image(a), image(b), tolerance))
  return new ImageDiff(d.changed, d.total, d.fraction, d.bbox === null ? null : Object.freeze([...d.bbox] as [number, number, number, number]), pictureOf(d.picture))
}

// --------------------------------------------------------------------------------------- exploded views
/** How far each part moves out in an exploded view, in three's world: a list of vectors in the
 * order of the parts, or a mapping from part names (the objects' `name`) or from the parts
 * themselves to vectors. Parts a mapping leaves out stay where they are. */
export type ExplodedOffsets = readonly THREE.Vector3Like[] | ReadonlyMap<string | Body, THREE.Vector3Like> | Readonly<Record<string, THREE.Vector3Like>>

/** The options of `renderExploded`. */
export interface RenderExplodedOptions {
  /** The camera, as for `render`. */
  view?: RenderView
  /** Width and height of the whole picture in pixels, the parts list included. */
  size?: readonly [number, number]
  /** The names in the order they are numbered; every name of the parts once. */
  order?: readonly string[] | null
  /** Draw the assembly axes. */
  axes?: boolean
  /** Draw the balloons and the parts list. */
  balloons?: boolean
  background?: THREE.ColorRepresentation
  /** Factor on the scale that fits the moved parts into the space left by the balloons. */
  zoom?: number
  supersample?: number
  /** The gap under which two surfaces touch, in the model's units. */
  tolerance?: number
}

/**
 * Where two parts of an assembly touch, and the axis an exploded view draws there (see
 * `assemblyAxes`), in three's world: `first` and `second` (the parts' indices, `first < second`),
 * `contact` (the centroid of the contact area in the assembled model), `area`, and `start` and
 * `end` (`contact` moved by the first part's offset and by the second's).
 */
export class AssemblyAxis {
  readonly first: number
  readonly second: number
  readonly contact: THREE.Vector3
  readonly area: number
  readonly start: THREE.Vector3
  readonly end: THREE.Vector3

  constructor(first: number, second: number, contact: THREE.Vector3, area: number, start: THREE.Vector3, end: THREE.Vector3) {
    this.first = first
    this.second = second
    this.contact = contact
    this.area = area
    this.start = start
    this.end = end
  }
}

/** The parts where the scene shows them, on the stage and named as their objects, and the offsets
 * turned onto the stage too. */
function exploded(parts: Body | Iterable<Body>, offsets: ExplodedOffsets, fn: string): [unknown[], unknown] {
  const list = isObject3D(parts) ? [parts] : [...(parts as Iterable<Body>)]
  for (const p of list) if (!(p instanceof Body)) throw new TypeError(`${fn} takes parts, not ${describe(p)}`)
  const items = list.map((p) => call(() => (staged(p) as sm.Part).named(p.name || null)))
  const turned = (v: THREE.Vector3Like) => stagedVec(v)
  let offs: unknown
  if (offsets instanceof Map) {
    offs = new Map([...offsets].map(([key, v]) => [typeof key === 'string' ? key : (items[list.indexOf(key as Body)] ?? key), turned(v)]))
  } else if (Array.isArray(offsets)) offs = offsets.map(turned)
  else if (offsets !== null && typeof offsets === 'object') offs = Object.fromEntries(Object.entries(offsets).map(([k, v]) => [k, turned(v as THREE.Vector3Like)]))
  else offs = offsets
  return [items, offs]
}

/** A kernel point of the stage as three's. */
function unstaged(v: sm.Vector): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(UNSTAGE)
}

/**
 * The assembly axes of an exploded view: one for every two parts that touch in the assembled
 * scene and move by different offsets, from the centroid of where they touch moved by the one's
 * offset to the same point moved by the other's. Parts that move together get none.
 *
 * Throws a RangeError for fewer than two parts, an offset list of another length than the parts,
 * a name no part has, or a part that touches no other one (the parts are given assembled).
 */
export function assemblyAxes(parts: Body | Iterable<Body>, offsets: ExplodedOffsets, options: { tolerance?: number } = {}): AssemblyAxis[] {
  const [items, offs] = exploded(parts, offsets, 'assemblyAxes')
  const axes = call(() => sm.assemblyAxes(items as sm.Part[], offs as sm.ExplodedOffsets, options))
  return axes.map((a) => new AssemblyAxis(a.first, a.second, unstaged(a.contact), a.area, unstaged(a.start), unstaged(a.end)))
}

/**
 * An exploded view of an assembly as a PNG: each part moved by its offset (in three's world) and
 * rendered as `render` does, the assembly axes (`assemblyAxes`) dashed, a numbered balloon on
 * each part that shows and a parts list (number, the objects' name, how many) beside the
 * picture. Drawn in software, with no browser.
 */
export function renderExploded(parts: Body | Iterable<Body>, offsets: ExplodedOffsets, options: RenderExplodedOptions = {}): Picture {
  const [items, offs] = exploded(parts, offsets, 'renderExploded')
  const o: Record<string, unknown> = { ...options }
  if (options.view !== undefined) o.view = view(options.view)
  if (options.background != null) o.background = hex(options.background)
  return pictureOf(call(() => sm.renderExploded(items as sm.Part[], offs as sm.ExplodedOffsets, o as sm.RenderExplodedOptions)))
}

function image(x: Picture | ImageLike | Uint8Array | ArrayBuffer): ImageLike | Uint8Array | ArrayBuffer {
  if (x instanceof Picture) return { width: x.width, height: x.height, data: x.pixels }
  if (x instanceof Uint8Array || x instanceof ArrayBuffer) return x
  if (x === null || typeof x !== 'object' || typeof x.width !== 'number' || typeof x.height !== 'number' || x.data === undefined) {
    throw new TypeError(`diffImages takes pictures, PNG bytes or images ({ width, height, data }), not ${describe(x)}`)
  }
  return x
}

function pictureOf(p: sm.Picture): Picture {
  return new Picture(p.data, p.pixels, p.width, p.height, p.frame === null ? null : Object.freeze({ scale: p.frame.scale, midX: p.frame.midX, midY: p.frame.midY }))
}

// --------------------------------------------------------------------------------------- objects
/** What render draws of `objects`, in the world: kernel bodies, meshes and curves with their
 * materials' colors, and the faces, edges and vertices drawn highlighted. */
function drawn(objects: THREE.Object3D | Iterable<THREE.Object3D>): { items: unknown[]; highlights: unknown[] } {
  const list = isObject3D(objects) ? [objects] : [...(objects as Iterable<THREE.Object3D>)]
  // (each with its material's color, and whether it is a sketch)
  const shapes: [unknown, string | null, boolean][] = []
  const highlights: unknown[] = []
  const add = (value: unknown, color: string | null = null, sketch = false) => {
    if (value !== null) shapes.push([value, color, sketch])
  }
  // (`body`: the nearest body above `o`, whose faces, edges and vertices under it are highlights)
  const visit = (o: THREE.Object3D, body: Body | null): void => {
    if (!o.visible) return
    if (o instanceof BrepVertex || ((o instanceof BrepFace || o instanceof BrepEdge || o instanceof Wire) && o.owner !== null && o.owner === body)) {
      const value = live(() => staged(o))
      if (value !== null) highlights.push(value)
    } else if (o instanceof Body) {
      add(live(() => staged(o)), colorOf(o.material), o instanceof Sketch)
    } else if (o instanceof TriangleMesh || o instanceof BrepEdge || o instanceof Wire) {
      // (a copy, also where it is in place: its color goes on it)
      add(live(() => staged(o)), colorOf(o.material))
    } else if (o instanceof BrepFace) {
      add(live(() => staged(o)))
    }
    const below = o instanceof Body ? o : body
    for (const child of o.children) visit(child, below)
  }
  for (const o of list) {
    if (!isObject3D(o)) throw new TypeError(`render draws three objects (bodies, curves, TriangleMeshes, groups of them), not ${describe(o)}`)
    o.updateWorldMatrix(true, true)
    visit(o, null)
  }
  // (with solids, a sketch is drawn as its outline on top, in the kernel's color: its fill's would hardly show)
  const solids = shapes.some(([v]) => v instanceof sm.Mesh || v instanceof sm.Face || ((v instanceof sm.Part || v instanceof sm.Shell) && !(v instanceof sm.Sketch)))
  const items = shapes.map(([value, color, sketch]) => (color === null || (sketch && solids) ? value : withColor(value, color)))
  return { items, highlights }
}

/** `fn()`, or null for an object with nothing to draw: an empty one (made without a shape) or a
 * disposed one. */
function live<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch (e) {
    if (e instanceof TypeError && /was disposed|has no body|has no geometry/.test(e.message)) return null
    throw e
  }
}

/** Highlighted objects (lists of them too), where they are. */
function highlighted(x: unknown): unknown[] {
  if (isObject3D(x)) {
    if (x instanceof TriangleMesh || x instanceof Body || x instanceof BrepFace || x instanceof BrepEdge || x instanceof Wire || x instanceof BrepVertex) return [staged(x)]
    throw new TypeError(`highlight takes bodies, faces, edges, wires, vertices and TriangleMeshes, not ${describe(x)}`)
  }
  if (x !== null && typeof x === 'object' && Symbol.iterator in x) return [...(x as Iterable<unknown>)].flatMap(highlighted)
  throw new TypeError(`highlight takes three objects or lists of them, not ${describe(x)}`)
}

/** A kernel shape drawn in `color`: a body colored (a copy that shares its faces); a mesh or curve,
 * a copy of the package's, given a `color`, which render takes from any shape that has one. */
function withColor(value: unknown, color: string): unknown {
  if (value instanceof sm.Part || value instanceof sm.Shell) return call(() => value.colored(color))
  if (value instanceof sm.Mesh || value instanceof sm.Edge || value instanceof sm.Wire) (value as { color?: string }).color = color
  return value
}

/** A material's color as sRGB hex (the kernel's colors are sRGB), null for one without a color. */
function colorOf(material: THREE.Material | THREE.Material[]): string | null {
  const m = Array.isArray(material) ? material[0] : material
  const color = (m as { color?: THREE.Color } | undefined)?.color
  return color?.isColor === true ? `#${color.getHexString(THREE.SRGBColorSpace)}` : null
}

// --------------------------------------------------------------------------------------- options
const isVector = (x: unknown): x is THREE.Vector3Like => {
  const v = x as { x?: unknown; y?: unknown; z?: unknown } | null
  return v !== null && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number'
}

const isBox3 = (x: unknown): x is THREE.Box3 => (x as THREE.Box3 | null)?.isBox3 === true

function hex(color: THREE.ColorRepresentation): string {
  return `#${new THREE.Color(color).getHexString(THREE.SRGBColorSpace)}`
}

/** A camera of three's as the kernel's: names as they are (they mean the same on the stage),
 * directions turned onto the stage, angles in degrees (azimuth and elevation mean the same there). */
function view(v: RenderView): unknown {
  if (typeof v === 'string') return v
  if (v === null || typeof v !== 'object') throw new TypeError(`view: a name, a THREE.Vector3, { direction, up } or { azimuth, elevation }, not ${describe(v)}`)
  const o = v as { direction?: THREE.Vector3Like; up?: THREE.Vector3Like | null; azimuth?: number; elevation?: number }
  if (o.direction !== undefined) return { direction: stagedVec(o.direction), up: o.up == null ? null : stagedVec(o.up) }
  if (o.azimuth !== undefined || o.elevation !== undefined) return { azimuth: degrees(o.azimuth ?? 0), elevation: degrees(o.elevation ?? 0) }
  return stagedVec(v as THREE.Vector3Like)
}

/** A point of the options as the kernel's: a point, a box, or a shape whose center it takes. */
function point(p: RenderPoint): unknown {
  if (isObject3D(p)) {
    if (p instanceof Body || p instanceof BrepFace || p instanceof BrepEdge || p instanceof Wire || p instanceof BrepVertex) return staged(p)
    const box = new THREE.Box3().setFromObject(p)
    if (box.isEmpty()) throw new RangeError(`render: ${describe(p)} has no points to take a center of`)
    return stagedVec(box.getCenter(new THREE.Vector3()))
  }
  if (isBox3(p)) return boundBox(p.clone().applyMatrix4(STAGE))
  return stagedVec(p)
}

function markers(m: NonNullable<RenderOptions['markers']>): unknown[] {
  const one = (x: unknown): unknown => {
    if (isObject3D(x) || isBox3(x) || isVector(x)) return { position: point(x) }
    if (x !== null && typeof x === 'object' && 'position' in x) {
      const { position, label, color } = x as RenderMarker
      return { position: point(position), label: label ?? '', color: color == null ? null : hex(color) }
    }
    throw new TypeError(`markers: give points or { position, label, color }, not ${describe(x)}`)
  }
  if (isObject3D(m) || isBox3(m) || isVector(m) || 'position' in m) return [one(m)]
  return [...(m as Iterable<unknown>)].map(one)
}

/** A plane of three's as the kernel's cut: the kernel leaves out the side its normal points to,
 * three's clipping keeps it, so the normal turns. */
function section(plane: THREE.Plane): unknown {
  if ((plane as { isPlane?: boolean }).isPlane !== true) throw new TypeError(`section: a THREE.Plane, not ${describe(plane)}`)
  return { origin: stagedVec(plane.coplanarPoint(new THREE.Vector3())), normal: stagedVec(plane.normal.clone().negate()) }
}

function zebra(z: NonNullable<RenderOptions['zebra']>): unknown {
  if (typeof z !== 'object') return z
  const { direction, ...rest } = z
  return direction === undefined || typeof direction === 'string' ? { ...z } : { ...rest, direction: stagedVec(direction) }
}

function kernelFrame(f: Frame | Picture): sm.Frame {
  const frame = f instanceof Picture ? f.frame : f
  if (frame === null) throw new RangeError('frame: this picture has no frame (sheets and drawings have none)')
  return { scale: frame.scale, midX: frame.midX, midY: frame.midY }
}
