// Exact files the way three reads and writes files: loaders (THREE.Loader: load, loadAsync, parse)
// and exporters (parse), as GLTFLoader and STLExporter are, for every format smlibwasm reads or
// writes exactly:
//
//   STEP    STEPLoader, STEPExporter    bodies, curves, points, coordinate systems; names, colors
//   IGES    IGESLoader                  bodies; names, colors
//   DXF     DXFLoader, DXFExporter      2D: sketches, curves, drawing views; layers
//   SVG     SVGExporter                 2D: drawing views, curves, sketches
//   USD     USDBrepLoader, USDBrepExporter      bodies (usd-brep's BrepArray prims); names, colors
//   BREP    BREPLoader, BREPExporter    bodies (OpenCASCADE's format)
//   SMLib   SMBLoader, SMBExporter      one body (.smb)
//           SMPLoader, SMPExporter      bodies and curves (.smp); names, colors
//
// Meshes need nothing of this package: a body is a THREE.Mesh, so three's GLTFExporter, STLExporter,
// OBJExporter and USDZExporter write its tessellation as they write any mesh; the formats here keep
// the exact bodies. Loaders take URLs (load, loadAsync) and contents (parse); exporters give the
// contents (text, or bytes for the SMLib formats). smlibpy's functions of file paths (export_step,
// import_step, save, load) have no counterpart: paths are the app's (or Node's) business.
//
// Files are read and written as they are: exporters take objects where the scene shows them (their
// matrixWorld), and a file's coordinates are three's, as three's STLLoader and OBJLoader take a
// file's. CAD files are mostly Z up: turn what a loader gives as three's loaders turn assets that say
// they are Z up, `group.rotation.x = -Math.PI / 2`, to stand it in a Y-up scene. USD says which way
// is up: USDBrepLoader turns a Z-up stage so, as three's own USDLoader does, and USDBrepExporter writes a
// Z-up stage of what the scene shows, standing as it stands there. The 2D formats (DXF, SVG) draw in
// the XY plane, where sketches lie: a drawing's (x, y) is three's (x, y), so three's default camera
// shows it as it is drawn.
import * as THREE from 'three'
import { DrawingView, kernelView } from './drawing.ts'
import { KernelError, ModelingError } from './errors.ts'
import { call, degrees, describe, location, matrix4, sm, vec, type SmBody } from './kernel.ts'
import { STAGE } from './render.ts'
import { assignedMaterial, Body, curveOf, BrepEdge, BrepFace, isMatrix4, isObject3D, operand, Part, sub, BrepVertex, Wire, wrap, type Shell, type Sketch } from './shapes.ts'

// ------------------------------------------------------------------------------------------- STEP
/** How STEPLoader reads. */
export interface STEPLoaderOptions {
  /** Repair bodies that come out invalid (valid ones are left alone; default true): the kernel's
   * healer, then stitching where faces do not share their edges. */
  heal?: boolean
  /** Throw a ModelingError for the first body that cannot be read, instead of leaving it out (with a
   * warning, and the reason in the group's `userData.skipped`). Default false. */
  strict?: boolean
}

const STEP_LOADER = ['heal', 'strict'] as const

/**
 * Reads STEP files (AP203, AP214, AP242) into a THREE.Group of what they hold, in the file's
 * coordinates (see the module's notes on Z up), in millimeters, with the assembly's placements
 * applied:
 *
 * - bodies: a Part for each solid, a Shell for each sheet, named and colored as the file has them;
 * - curves that belong to no body (wireframe geometry, contours): BrepEdge and Wire objects of their own,
 *   named, and colored by their material where the file colors them;
 * - points that belong to no body: BrepVertex objects of their own, named and colored so;
 * - coordinate systems (named placements, as NX, CATIA and tool catalogs write `MCS`, `PCS` or
 *   `CSW`): empties (plain THREE.Object3Ds) named as the file names them and placed at them, their
 *   axes the coordinate system's. So `new Rectangle(20, 10).on(frame.matrixWorld)` draws in its XY
 *   plane, and STEPExporter writes it back (as it writes any named empty).
 *
 * Curves, points and coordinate systems keep the product they belong to in `userData.product`, a
 * coordinate system its color in `userData.color` (a CSS color). A body that cannot be read is left
 * out with a warning, and listed with the reason in the group's `userData.skipped` (`strict` throws
 * instead); a file of which nothing can be read throws a ModelingError.
 */
export class STEPLoader extends THREE.Loader<THREE.Group> {
  /** How files are read. */
  options: STEPLoaderOptions = {}

  /** Sets how files are read (see STEPLoaderOptions). */
  setOptions(options: STEPLoaderOptions): this {
    this.options = checked('STEPLoader', options, STEP_LOADER)
    return this
  }

  override load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
    loadFile(this, url, (data) => this.parse(data), onLoad, onProgress, onError)
  }

  /** What the contents of a STEP file (its text or bytes) hold. */
  parse(data: string | ArrayBuffer | Uint8Array): THREE.Group {
    const { heal, strict } = checked('STEPLoader', this.options, STEP_LOADER)
    return run('STEPLoader', () => {
      const model = sm.fromStepModel(data, { heal, strict })
      if (!model.bodies.length && !model.curves.length && !model.points.length && !model.frames.length) {
        const why = model.skipped.length ? `nothing in the file could be read: ${model.skipped.slice(0, 3).join('; ')}${model.skipped.length > 3 ? '; ...' : ''}` : 'the file holds no bodies, curves, points or coordinate systems'
        throw new ModelingError(`STEPLoader: ${why}`)
      }
      const group = new THREE.Group()
      for (const value of model.bodies) group.add(bodyOf(value))
      for (const c of model.curves) group.add(extra(curveOf(c.shape), c))
      for (const p of model.points) group.add(extra(sub(BrepVertex, null, -1, new sm.Vertex(p.point)), p))
      for (const f of model.frames) {
        const frame = extra(new THREE.Object3D(), f)
        matrix4(f.location).decompose(frame.position, frame.quaternion, frame.scale)
        group.add(frame)
      }
      group.userData.skipped = [...model.skipped]
      return group
    })
  }
}

/** How STEPExporter writes. */
export interface STEPExporterOptions {
  /** The product's name (default 'part'). */
  name?: string
  /** Each body a product of its own, named as its object, in an assembly called `name`. */
  assembly?: boolean
  /** The file's length unit: 'mm' (default), 'cm', 'm', 'um' or 'inch'; the model's millimeters are
   * converted to it. */
  unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch'
  /** Leave out invisible objects (default true, as GLTFExporter does). */
  onlyVisible?: boolean
  /** Write named empties (plain THREE.Object3Ds with a name) as coordinate systems (default true). */
  frames?: boolean
}

const STEP_EXPORTER = ['name', 'assembly', 'unit', 'onlyVisible', 'frames'] as const

/**
 * Writes what is under an object (or several) to STEP AP214, each where the scene shows it, in
 * millimeters unless `unit` says otherwise:
 *
 * - bodies (Part, Shell, Sketch): exact solids and sheets, named by their object's name and colored
 *   by their material's color;
 * - edges and wires of their own: curves, named and colored the same way;
 * - THREE.Points (BrepVertex objects of their own among them): each of their points, named and colored
 *   so;
 * - named empties (plain THREE.Object3Ds with a name, as STEPLoader gives a file's coordinate
 *   systems): coordinate systems, the object's axes theirs; `frames: false` leaves them out. Unnamed empties (pivots, and the containers of three's
 *   helpers) are passed over.
 *
 * `userData.product` puts a curve, point or coordinate system into the product of that name (in an
 * assembly, the body's of that name), `userData.color` (a CSS color or a hex number) colors a
 * coordinate system. A face, edge or vertex of a body is written when it is given (a face as a sheet,
 * without a color), not when it is found as a child of its body (a highlight). Other objects (meshes,
 * lines, groups, cameras, ...) are passed over, their children written.
 */
export class STEPExporter {
  /** The text of a STEP file of what is under `input`. */
  parse(input: THREE.Object3D | readonly THREE.Object3D[], options: STEPExporterOptions = {}): string {
    const o = checked('STEPExporter', options, STEP_EXPORTER)
    const kinds: Kind[] = ['part', 'sheet', 'face', 'curve', 'point']
    if (o.frames ?? true) kinds.push('frame')
    return run('STEPExporter', () => {
      const items = gather(input, 'STEPExporter', o.onlyVisible, kinds).map((f): unknown => {
        if (f.kind === 'part' || f.kind === 'sheet') return named(f.object, f.value)
        if (f.kind === 'curve') return new sm.StepCurve(f.object.name, f.value, productOf(f.object), f.own ? rgbOf(assignedMaterial(f.object)) : null)
        if (f.kind === 'point') return new sm.StepPoint(f.object.name, f.value, productOf(f.object), f.own ? rgbOf(assignedMaterial(f.object)) : null)
        if (f.kind === 'frame') return new sm.StepFrame(f.object.name, f.value.plane, productOf(f.object), userColor(f.object))
        return f.value
      })
      if (!items.length) throw new RangeError('STEPExporter: nothing to write: give parts, sheets, sketches, curves, points or named empties, or objects that hold them')
      return sm.toStep(items as sm.StepItemsLike, { name: o.name, assembly: o.assembly, unit: o.unit })
    })
  }
}

// ------------------------------------------------------------------------------------------- IGES
/** How IGESLoader reads. */
export interface IGESLoaderOptions {
  /** Repair solids that come out invalid (default true), as STEPLoader does. */
  heal?: boolean
  /** Throw a ModelingError for the first entity that cannot be read, instead of leaving it out with a
   * warning (default false). */
  strict?: boolean
}

const IGES_LOADER = ['heal', 'strict'] as const

/**
 * Reads IGES files (5.3, ASCII) into a THREE.Group of their bodies, in the file's coordinates, in
 * millimeters whatever unit the file uses, named and colored as the file has them.
 * Solids (manifold solid B-rep objects) come in as STEP's do; trimmed and bounded surfaces, the way
 * most CAD systems write IGES, are stitched where their edges meet, and each set of faces that closes
 * up becomes a Part, the others Shells. What cannot be read is left out with a warning (`strict`
 * throws instead); a file of which nothing can be read throws a ModelingError.
 */
export class IGESLoader extends THREE.Loader<THREE.Group> {
  /** How files are read. */
  options: IGESLoaderOptions = {}

  /** Sets how files are read (see IGESLoaderOptions). */
  setOptions(options: IGESLoaderOptions): this {
    this.options = checked('IGESLoader', options, IGES_LOADER)
    return this
  }

  override load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
    loadFile(this, url, (data) => this.parse(data), onLoad, onProgress, onError)
  }

  /** The bodies of the contents of an IGES file (its text or bytes). */
  parse(data: string | ArrayBuffer | Uint8Array): THREE.Group {
    const { heal, strict } = checked('IGESLoader', this.options, IGES_LOADER)
    return run('IGESLoader', () => groupOf(sm.fromIges(data, { heal, strict })))
  }
}

// -------------------------------------------------------------------------------------------- DXF
/** The length units of DXF drawings. */
export type DXFUnit = 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in' | 'ft'

/** How DXFLoader reads. */
export interface DXFLoaderOptions {
  /** Read only these layers (names in any letter case). */
  layers?: string | Iterable<string> | null
  /** The drawing's unit, instead of the one the file names ($INSUNITS); a file without one is read
   * as millimeters. */
  unit?: DXFUnit | null
  /** Curve ends closer than this (in millimeters) are joined (default: 1e-7 of the drawing's size). */
  tolerance?: number | null
  /** Give every chain of curves of the drawing as a Wire, open or closed (closed ones first, each in
   * drawing order), instead of the sketch of its closed outlines. */
  wires?: boolean
}

const DXF_LOADER = ['layers', 'unit', 'tolerance', 'wires'] as const

/**
 * Reads DXF drawings (ASCII) into a THREE.Group of one Sketch in the XY plane (the drawing's): the
 * drawing's (x, y) is three's (x, y), so three's default camera shows it as drawn, and the sketch
 * extrudes towards +z. Lines, arcs, circles, ellipses, polylines (bulges as exact arcs), splines
 * (exact NURBS) and inserted blocks are joined end to end into closed loops, nested by the even-odd
 * rule (a loop inside a loop is a hole, a loop inside a hole an island), in millimeters. Curves that
 * do not close into loops, or outlines that branch, throw a ModelingError that says where; with
 * `wires: true` the group holds every chain of curves as a Wire instead.
 */
export class DXFLoader extends THREE.Loader<THREE.Group> {
  /** How drawings are read. */
  options: DXFLoaderOptions = {}

  /** Sets how drawings are read (see DXFLoaderOptions). */
  setOptions(options: DXFLoaderOptions): this {
    this.options = checked('DXFLoader', options, DXF_LOADER)
    return this
  }

  override load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
    loadFile(this, url, (data) => this.parse(data), onLoad, onProgress, onError)
  }

  /** The sketch of the contents of a DXF file (its text or bytes), in a THREE.Group; with `wires`,
   * its chains of curves. */
  parse(data: string | ArrayBuffer | Uint8Array): THREE.Group {
    const { layers, unit, tolerance, wires } = checked('DXFLoader', this.options, DXF_LOADER)
    const options = { layers: layers == null || typeof layers === 'string' ? layers : [...layers], unit, tolerance }
    const words: [RegExp, string][] = [[/\bfromDxfWires\(\)/g, 'wires: true']]
    return run(
      'DXFLoader',
      () => {
        const group = new THREE.Group()
        if (!wires) group.add(bodyOf(sm.fromDxf(data, options)) as Sketch)
        else for (const w of sm.fromDxfWires(data, options)) group.add(curveOf(w))
        return group
      },
      words,
    )
  }
}

/** How DXFExporter writes. */
export interface DXFExporterOptions {
  /** The file's unit: 'mm' (default), 'cm', 'm', 'um', 'inch' or 'ft'; the model's millimeters are
   * converted to it, and the file says so ($INSUNITS). */
  unit?: DXFUnit
  /** 'exact' (default) writes splines and ellipses as SPLINE and ELLIPSE; 'arcs' as LINE and ARC
   * within `tolerance`, for software that reads only lines and arcs (CNC, laser and plasma cutters). */
  curves?: 'exact' | 'arcs'
  /** For `curves: 'arcs'`: the largest distance between a curve and its lines and arcs, in
   * millimeters (default 0.01). */
  tolerance?: number
  /** The drawing's frame, in world coordinates: its XY plane is the drawing, its x and y the
   * drawing's, as a sketch lies in the XY plane of its frame (so `sketch.matrixWorld` draws a sketch
   * in its own coordinates wherever it is). The shapes must lie parallel to it. Default: the XY plane
   * where the shapes lie parallel to it, otherwise the plane of the first sketch. */
  frame?: THREE.Matrix4 | null
  /** Leave out invisible objects (default true). */
  onlyVisible?: boolean
}

const DXF_EXPORTER = ['unit', 'curves', 'tolerance', 'frame', 'onlyVisible'] as const

/**
 * Writes 2D shapes to a DXF drawing (AutoCAD 2000, AC1015), each where the scene shows it, seen from
 * the front (+z), as three's default camera sees it: three's (x, y) is the drawing's (x, y), so a
 * sketch comes out as it is drawn. Sketches, planar sheets and planar faces give their
 * outlines (an object's name becomes its layer), edges and wires their curves, drawing views their
 * lines (on the layers VISIBLE and HIDDEN, the hidden lines dashed). Every curve is written exactly:
 * LINE, ARC, CIRCLE, ELLIPSE, or SPLINE with the kernel's control points, knots and weights (see
 * `curves`). Parts are passed over: drawingViews draws them, `part.section(plane)` cuts them.
 */
export class DXFExporter {
  /** The text of a DXF drawing of the 2D shapes under `input`. */
  parse(input: THREE.Object3D | DrawingView | readonly (THREE.Object3D | DrawingView)[], options: DXFExporterOptions = {}): string {
    const o = checked('DXFExporter', options, DXF_EXPORTER)
    if (o.frame != null && !isMatrix4(o.frame)) throw new TypeError(`DXFExporter: frame is the drawing's frame, a THREE.Matrix4, not ${describe(o.frame)}`)
    return run('DXFExporter', () => {
      const items = gather(input, 'DXFExporter', o.onlyVisible, ['sheet', 'face', 'curve', 'view']).map((f) => (f.kind === 'sheet' ? named(f.object, f.value, false) : f.value))
      if (!items.length) {
        throw new RangeError('DXFExporter: nothing to write: give sketches, planar sheets or faces, edges, wires or drawing views (a part is drawn with drawingViews, or cut with part.section)')
      }
      const plane = o.frame == null ? null : location(o.frame).plane
      return sm.toDxf(items as sm.DxfShapesLike, { unit: o.unit, curves: o.curves, tolerance: o.tolerance, plane })
    }, [[/\bpass the plane they lie in\b/g, 'give the frame they lie in (frame)']])
  }
}

// -------------------------------------------------------------------------------------------- SVG
/** How SVGExporter draws. */
export interface SVGExporterOptions {
  /** The space around the lines, in millimeters (default: 5 % of the drawing's size). */
  margin?: number | null
  /** The width of the visible lines, in millimeters (the hidden ones are 0.7 of it, dashed; default
   * 0.35, or 1/500 of the drawing's size where that is smaller). */
  stroke?: number | null
  /** Leave out invisible objects (default true). */
  onlyVisible?: boolean
}

const SVG_EXPORTER = ['margin', 'stroke', 'onlyVisible'] as const

/**
 * Draws 2D shapes as SVG, each where the scene shows it, seen from the front (+z), as three's default
 * camera sees them: three's x to the right and y up (a drawing's x and y; the SVG's y runs down). Drawing views
 * give their lines (the hidden ones dashed), edges and wires their curves, sketches, sheets and faces
 * their edges. Lines and circular arcs are exact, other curves polylines. Lengths are millimeters: the
 * drawing prints at its true size. Parts are passed over: drawingViews draws them.
 */
export class SVGExporter {
  /** The text of an SVG drawing of the 2D shapes under `input`. */
  parse(input: THREE.Object3D | DrawingView | readonly (THREE.Object3D | DrawingView)[], options: SVGExporterOptions = {}): string {
    const o = checked('SVGExporter', options, SVG_EXPORTER)
    return run('SVGExporter', () => {
      const items = gather(input, 'SVGExporter', o.onlyVisible, ['sheet', 'face', 'curve', 'view']).map((f) => f.value)
      if (!items.length) throw new RangeError('SVGExporter: nothing to draw: give drawing views, edges, wires, sketches, sheets or faces (a part is drawn with drawingViews)')
      return sm.toSvg(items as sm.SvgItemsLike, { margin: o.margin, stroke: o.stroke })
    })
  }
}

// -------------------------------------------------------------------------------------------- USD
/** How USDBrepLoader reads. */
export interface USDBrepLoaderOptions {
  /** Run the kernel's import healer on the bodies (default false). */
  heal?: boolean
  /** The stage's unit ('mm', 'cm', 'm', 'um' or 'inch') instead of its metersPerUnit; a stage without
   * one is read as millimeters (where USD itself takes centimeters). */
  units?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | null
  /** Place the bodies as the stage does (default true: the transforms of their prims and the prims
   * above them, and a Z-up stage's group turned to stand it up, as three's USDLoader turns it); false
   * leaves each where its prim has it. */
  placement?: boolean
  /** Check each body with the kernel first (default true): gaps of more than 1e-3 of its size make it
   * unreadable, smaller ones give a warning. */
  check?: boolean
  /** Throw for the first body that cannot be read, instead of leaving it out with a warning (default
   * false). */
  strict?: boolean
  /**
   * The text (or bytes) of a layer the stage names (a subLayer, a reference or a payload: `asset` as
   * written, `from` the name of the layer that names it, '' for the file's own), or null for none.
   * Without it, `load` and `loadAsync` load such layers relative to the file's URL; `parse` leaves
   * them out (with a warning that names them).
   */
  resolve?: ((asset: string, from: string) => string | Uint8Array | null | undefined) | null
}

const USD_LOADER = ['heal', 'units', 'placement', 'check', 'strict', 'resolve'] as const

/**
 * Reads the exact bodies of USD stages (.usda text) of NVIDIA's usd-brep schema (its BrepArray prims,
 * as smlibpy, smlibwasm, usd-brep and Omniverse write them) into a THREE.Group of Parts and Shells,
 * named and colored as their prims have them (the material bound to them, else their displayColor),
 * in millimeters and placed as the stage places them, in the stage's coordinates. A stage that says
 * it is Z up stands up in three: its group is turned (`rotation.x = -Math.PI / 2`), as three's own
 * USDLoader turns it. three's USDLoader reads USD's meshes; this one keeps the exact bodies (usd-brep's
 * B-reps, hence its name), and passes the meshes over.
 *
 * The layers a stage names (subLayers, references, payloads) are read as USD composes them: `load`
 * and `loadAsync` load them relative to the file's URL (through the loader's manager, path and
 * resourcePath; binary USD is not read), or the `resolve` option gives them. A body that cannot be
 * read is left out with a warning (`strict` throws instead).
 */
export class USDBrepLoader extends THREE.Loader<THREE.Group> {
  /** How stages are read. */
  options: USDBrepLoaderOptions = {}

  /** Sets how stages are read (see USDBrepLoaderOptions). */
  setOptions(options: USDBrepLoaderOptions): this {
    this.options = checked('USDBrepLoader', options, USD_LOADER)
    return this
  }

  override load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
    if (this.options.resolve != null) {
      loadFile(this, url, (data) => this.parse(data), onLoad, onProgress, onError)
      return
    }
    // (the stage, then the layers it names, then the bodies of all of them)
    fileLoader(this).load(
      url,
      (data) => {
        layersOf(this, data as ArrayBuffer, url).then(
          (layers) => {
            try {
              onLoad(this.read(data as ArrayBuffer, (asset, from) => layers.get(joined(from, asset)) ?? null))
            } catch (e) {
              failed(this, url, e, onError)
            }
          },
          (e) => failed(this, url, e, onError),
        )
      },
      onProgress,
      onError,
    )
  }

  /** The bodies of the contents of a USD file (its text or bytes), with the layers it names from the
   * `resolve` option. */
  parse(data: string | ArrayBuffer | Uint8Array): THREE.Group {
    return this.read(data, this.options.resolve ?? null)
  }

  private read(data: string | ArrayBuffer | Uint8Array, resolve: USDBrepLoaderOptions['resolve']): THREE.Group {
    const { heal, units, placement, check, strict } = checked('USDBrepLoader', this.options, USD_LOADER)
    const up = placement === false ? null : upAxis(data)
    return run('USDBrepLoader', () => {
      const read = sm.fromUsd(data, { heal, units, placement, check, strict, resolve })
      // (as three's USDLoader: a Z-up stage's group turned; the kernel turns a Y-up stage to Z up,
      // which is turned back here, so that the bodies keep the stage's coordinates)
      const unturn = location(UNSTAGE)
      const group = groupOf(up === 'Y' ? [...(read instanceof sm.ShapeList ? read : [read])].map((b) => b.moved(unturn)) : read)
      if (up === 'Z') group.rotation.x = -Math.PI / 2
      return group
    })
  }
}

/** How USDBrepExporter writes. */
export interface USDBrepExporterOptions {
  /** Write a Mesh prim of each body too (`<name>_mesh`, default true), which USD viewers draw; false
   * writes the exact bodies alone, for usd-brep and Omniverse, which draw them themselves. */
  mesh?: boolean
  /** The meshes' chord height in millimeters (default: 0.1 % of each body's diagonal). */
  tolerance?: number | null
  /** The largest angle between neighbouring triangle normals of the meshes, in radians (default 15
   * degrees). */
  angle?: number
  /** Give each color a Material (a UsdPreviewSurface under /World/Looks) bound to the prims of that
   * color, which renderers use where they leave displayColor aside (default false). */
  materials?: boolean
  /** The longest edge a triangle of the meshes may have, in millimeters (default: none). */
  maxEdge?: number | null
  /** Leave out invisible objects (default true). */
  onlyVisible?: boolean
}

const USD_EXPORTER = ['mesh', 'tolerance', 'angle', 'materials', 'maxEdge', 'onlyVisible'] as const

/**
 * Writes the exact bodies under an object (or several) to a USD stage (.usda text), each where the
 * scene shows it: a BrepArray prim (usd-brep's schema, which Omniverse and usd-brep's tools read as
 * solids) named by its object's name and colored by its material's color, and a Mesh prim of it,
 * which other USD tools and viewers draw (see `mesh`). The stage is Z up in millimeters
 * (metersPerUnit 0.001), turned from three's so that a part standing in three stands in USD's tools
 * (and in USDBrepLoader's group). Binary USD (.usdc, .usdz) is not written: OpenUSD's usdcat converts
 * the text, usdzip packs it. three's USDZExporter writes meshes
 * only; curves and points have no place here (STEPExporter writes them).
 */
export class USDBrepExporter {
  /** The text of a USD stage of the bodies under `input`. */
  parse(input: THREE.Object3D | readonly THREE.Object3D[], options: USDBrepExporterOptions = {}): string {
    const o = checked('USDBrepExporter', options, USD_EXPORTER)
    const angle = o.angle === undefined ? undefined : degrees(o.angle)
    return run('USDBrepExporter', () => {
      const stage = location(STAGE)
      const items = gather(input, 'USDBrepExporter', o.onlyVisible, ['part', 'sheet', 'face']).map((f) => {
        const value = (f.value as SmBody | sm.Face).moved(stage)
        return f.kind === 'part' || f.kind === 'sheet' ? named(f.object, value as SmBody) : value
      })
      if (!items.length) throw new RangeError('USDBrepExporter: nothing to write: give parts, sheets or sketches, or objects that hold them')
      return sm.toUsd(items as sm.ShapesLike, { mesh: o.mesh, tolerance: o.tolerance, angle, materials: o.materials, maxEdge: o.maxEdge })
    })
  }
}

/** three's turn of a Z-up stage (x, y, z) to (x, z, -y), STAGE's inverse. */
const UNSTAGE = STAGE.clone().transpose()

/** The upAxis a stage's text says ('Y', 'Z'; null where it says none), from its metadata, which
 * comes first. */
function upAxis(data: string | ArrayBuffer | Uint8Array): string | null {
  const head = typeof data === 'string' ? data.slice(0, 8192) : new TextDecoder().decode((data instanceof Uint8Array ? data : new Uint8Array(data)).subarray(0, 8192))
  return /\bupAxis\s*=\s*"(\w+)"/.exec(head)?.[1] ?? null
}

// ------------------------------------------------------------------------------------------- BREP
/** How BREPLoader reads. */
export interface BREPLoaderOptions {
  /** Run the kernel's import healer on the bodies (default false). */
  heal?: boolean
  /** Check each body with the kernel first (default true): one whose faces, edges and vertices leave
   * gaps of more than 1e-3 of its size throws a RangeError, smaller gaps give a warning. */
  check?: boolean
  /** Throw a ModelingError where a solid, shell or face cannot be read, instead of leaving it out with
   * a warning (default false). */
  strict?: boolean
}

const BREP_LOADER = ['heal', 'check', 'strict'] as const

/**
 * Reads OpenCASCADE .brep files (ASCII from BRepTools::Write, binary from BinTools::Write, as
 * build123d, CadQuery, FreeCAD and OpenCASCADE write them) into a THREE.Group of a Part for each solid
 * of the file's shape and a Shell for each sheet, in the file's coordinates and units (millimeters for
 * those tools), with their exact surfaces and curves. The format has no
 * names or colors; curves and points outside faces are not read (a warning says how many).
 */
export class BREPLoader extends THREE.Loader<THREE.Group> {
  /** How files are read. */
  options: BREPLoaderOptions = {}

  /** Sets how files are read (see BREPLoaderOptions). */
  setOptions(options: BREPLoaderOptions): this {
    this.options = checked('BREPLoader', options, BREP_LOADER)
    return this
  }

  override load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
    loadFile(this, url, (data) => this.parse(data), onLoad, onProgress, onError)
  }

  /** The bodies of the contents of a .brep file (its text or bytes). */
  parse(data: string | ArrayBuffer | Uint8Array): THREE.Group {
    const { heal, check, strict } = checked('BREPLoader', this.options, BREP_LOADER)
    return run('BREPLoader', () => groupOf(sm.fromBrep(data, { heal, check, strict })))
  }
}

/** How BREPExporter writes. */
export interface BREPExporterOptions {
  /** Leave out invisible objects (default true). */
  onlyVisible?: boolean
}

/**
 * Writes the exact bodies under an object (or several) to an OpenCASCADE .brep file (ASCII, as
 * BRepTools::Write writes it), each where the scene shows it, which build123d
 * (import_brep), CadQuery (importBrep), FreeCAD and OpenCASCADE read: one shape, the solid or shell
 * of a single body or a compound of them, with their exact surfaces and curves. Names and colors are
 * not written: the format has no place for them (STEPExporter keeps them).
 */
export class BREPExporter {
  /** The text of a .brep file of the bodies under `input`. */
  parse(input: THREE.Object3D | readonly THREE.Object3D[], options: BREPExporterOptions = {}): string {
    const o = checked('BREPExporter', options, ['onlyVisible'])
    return run('BREPExporter', () => {
      const items = gather(input, 'BREPExporter', o.onlyVisible, ['part', 'sheet', 'face']).map((f) => f.value)
      if (!items.length) throw new RangeError('BREPExporter: nothing to write: give parts, sheets or sketches, or objects that hold them')
      return sm.toBrep(items as sm.ShapesLike)
    })
  }
}

// ------------------------------------------------------------------------------------------ SMLib
/**
 * Reads SMLib's native .smb files (one exact body, ASCII or binary) as that body: a Part when it
 * encloses a volume, a Shell when it does not, in the file's coordinates.
 */
export class SMBLoader extends THREE.Loader<Part | Shell> {
  override load(url: string, onLoad: (body: Part | Shell) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
    loadFile(this, url, (data) => this.parse(data), onLoad, onProgress, onError)
  }

  /** The body of the contents of an .smb file (its text or bytes). */
  parse(data: string | ArrayBuffer | Uint8Array): Part | Shell {
    return run('SMBLoader', () => bodyOf(sm.fromSmb(data)) as Part | Shell)
  }
}

/** How SMBExporter and SMPExporter write. */
export interface SMLibExporterOptions {
  /** The kernel's ASCII form (default true, to 16 decimals); false its binary form, bit-exact. */
  ascii?: boolean
  /** Leave out invisible objects (default true). */
  onlyVisible?: boolean
}

const SMLIB_EXPORTER = ['ascii', 'onlyVisible'] as const

/**
 * Writes the one exact body under an object to SMLib's native .smb format, where the scene shows it;
 * reading it back gives the same geometry. Names and colors are not written
 * (SMPExporter keeps them). Throws a RangeError unless there is exactly one body.
 */
export class SMBExporter {
  /** The contents of an .smb file of the body under `input`. */
  parse(input: THREE.Object3D | readonly THREE.Object3D[], options: SMLibExporterOptions = {}): Uint8Array {
    const o = checked('SMBExporter', options, SMLIB_EXPORTER)
    return run('SMBExporter', () => {
      const items = gather(input, 'SMBExporter', o.onlyVisible, ['part', 'sheet', 'face']).map((f) => f.value)
      if (items.length !== 1) {
        throw new RangeError(`SMBExporter: an .smb file holds one body, not ${items.length}: fuse the parts, or write them all with SMPExporter (with their names and colors)`)
      }
      return sm.toSmb(items[0] as sm.ShapesLike, { ascii: o.ascii })
    })
  }
}

/**
 * Reads SMLib part files (.smp) into a THREE.Group of what they hold, in the file's order and
 * coordinates: bodies (a Part where it encloses a volume, else a Shell) named
 * and colored as written, and curves as BrepEdge and Wire objects of their own.
 */
export class SMPLoader extends THREE.Loader<THREE.Group> {
  override load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
    loadFile(this, url, (data) => this.parse(data), onLoad, onProgress, onError)
  }

  /** The bodies and curves of the contents of an .smp file (its text or bytes). */
  parse(data: string | ArrayBuffer | Uint8Array): THREE.Group {
    return run('SMPLoader', () => {
      const read = sm.fromSmp(data)
      const group = new THREE.Group()
      for (const value of read instanceof sm.ShapeList ? [...read] : [read]) {
        if (value instanceof sm.Part || value instanceof sm.Shell) group.add(bodyOf(value))
        else if (value instanceof sm.Edge || value instanceof sm.Wire) group.add(curveOf(value))
      }
      return group
    })
  }
}

/**
 * Writes the exact bodies under an object (or several) to an SMLib part file (.smp), the kernel's own
 * container, each where the scene shows it: bodies named by their object's name and
 * colored by their material's color, and edges and wires of their own as curves (the format names
 * bodies only). SMPLoader reads them back in the same order.
 */
export class SMPExporter {
  /** The contents of an .smp file of the bodies and curves under `input`. */
  parse(input: THREE.Object3D | readonly THREE.Object3D[], options: SMLibExporterOptions = {}): Uint8Array {
    const o = checked('SMPExporter', options, SMLIB_EXPORTER)
    return run('SMPExporter', () => {
      const items = gather(input, 'SMPExporter', o.onlyVisible, ['part', 'sheet', 'face', 'curve']).map((f) => (f.kind === 'part' || f.kind === 'sheet' ? named(f.object, f.value) : f.value))
      if (!items.length) throw new RangeError('SMPExporter: nothing to write: give parts, sheets, sketches, edges or wires, or objects that hold them')
      return sm.toSmp(items as sm.ShapesLike, { ascii: o.ascii })
    })
  }
}

// ---------------------------------------------------------------------------- what exporters write
/** What an exporter found under its input, each where the scene shows it. */
type Found =
  | { kind: 'part'; object: Body; value: SmBody }
  | { kind: 'sheet'; object: Body; value: SmBody }
  | { kind: 'face'; object: BrepFace; value: sm.Face }
  | { kind: 'curve'; object: BrepEdge | Wire; value: sm.Edge | sm.Wire; own: boolean }
  | { kind: 'point'; object: THREE.Points; value: sm.Vector; own: boolean }
  | { kind: 'frame'; object: THREE.Object3D; value: sm.Location }
  | { kind: 'view'; object: DrawingView; value: sm.DrawingView }

type Kind = Found['kind']

/**
 * What an exporter writes of `input` (an object, a drawing view, or a list of them; called in `run`):
 * the kinds of `kinds` found in it and below it, in order. Parts (`part`) and sheets and sketches
 * (`sheet`), curves and BrepVertex objects of their own, the points of THREE.Points, named empties
 * (`frame`: plain Object3Ds with a name) and drawing views; a face, edge or vertex of a body only where it is given (below its body it is a
 * highlight). `onlyVisible` (default true) leaves out invisible objects and what is below them.
 */
function gather(input: unknown, what: string, onlyVisible: boolean | undefined, kinds: readonly Kind[]): Found[] {
  const want = new Set<Kind>(kinds)
  const visibleOnly = onlyVisible ?? true
  const out: Found[] = []
  const visit = (o: THREE.Object3D, given: boolean): void => {
    if (visibleOnly && !o.visible) return
    if (o instanceof Body) {
      const kind = o instanceof Part ? 'part' : 'sheet'
      if (want.has(kind)) out.push({ kind, object: o, value: operand(o, null, what) as SmBody })
    } else if (o instanceof BrepFace || o instanceof BrepEdge || o instanceof Wire || o instanceof BrepVertex) {
      const own = o.owner === null
      if (!own && !given) return
      if (o instanceof BrepFace) {
        if (!own && want.has('face')) out.push({ kind: 'face', object: o, value: operand(o, null, what) as sm.Face })
      } else if (o instanceof BrepVertex) {
        if (want.has('point')) out.push({ kind: 'point', object: o, value: (operand(o, null, what) as sm.Vertex).point, own })
      } else if (want.has('curve')) out.push({ kind: 'curve', object: o, value: operand(o, null, what) as sm.Edge | sm.Wire, own })
      if (!own) return
    } else if ((o as THREE.Points).isPoints === true) {
      if (want.has('point')) for (const p of positionsOf(o as THREE.Points)) out.push({ kind: 'point', object: o as THREE.Points, value: vec(p), own: true })
    } else if (Object.getPrototypeOf(o) === THREE.Object3D.prototype && o.name !== '') {
      if (want.has('frame')) {
        o.updateWorldMatrix(true, false)
        out.push({ kind: 'frame', object: o, value: location(o.matrixWorld) })
      }
    }
    for (const child of o.children) visit(child, false)
  }
  const top = (x: unknown): void => {
    if (Array.isArray(x)) for (const y of x) top(y)
    else if (x instanceof DrawingView) {
      if (want.has('view')) out.push({ kind: 'view', object: x, value: kernelView(x) })
    } else if (isObject3D(x)) visit(x, true)
    else throw new TypeError(`${what}: give three.js objects${want.has('view') ? ' or drawing views' : ''} (or a list of them), not ${describe(x)}`)
  }
  top(input)
  return out
}

/** The points of a THREE.Points, where the scene shows them. */
function positionsOf(o: THREE.Points): THREE.Vector3[] {
  const position = o.geometry?.getAttribute('position')
  if (position === undefined) return []
  o.updateWorldMatrix(true, false)
  const out: THREE.Vector3[] = []
  for (let i = 0; i < position.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld))
  return out
}

/** A body's kernel value (where the scene shows it), named as its object and colored as its material. */
function named(o: Body, value: SmBody, color = true): SmBody {
  const out = value.named(o.name || null) as SmBody
  // (the color of a material given to the body; its own default writes none)
  const hex = color ? hexOf(assignedMaterial(o)) : null
  return hex === null ? out : (out.colored(hex) as SmBody)
}

/** The product a curve, point or coordinate system belongs to (`userData.product`), '' for none. */
function productOf(o: THREE.Object3D): string {
  const product = o.userData.product
  return typeof product === 'string' ? product : ''
}

/** A material's color as sRGB hex ('#rrggbb'), null for a material without one. */
function hexOf(material: THREE.Material | THREE.Material[] | null): string | null {
  if (material === null) return null
  const m = Array.isArray(material) ? material[0] : material
  const color = (m as { color?: THREE.Color } | undefined)?.color
  return color?.isColor ? `#${color.getHexString(THREE.SRGBColorSpace)}` : null
}

/** A material's color as sRGB [r, g, b] from 0 to 1 (as the file stores it), null for none. */
function rgbOf(material: THREE.Material | THREE.Material[] | null): [number, number, number] | null {
  const hex = hexOf(material)
  return hex === null ? null : rgb(Number.parseInt(hex.slice(1), 16))
}

/** The color in `userData.color` (a CSS color or a hex number), as sRGB [r, g, b]; null for none. */
function userColor(o: THREE.Object3D): [number, number, number] | null {
  const c = o.userData.color
  if (typeof c !== 'string' && typeof c !== 'number') return null
  return rgb(new THREE.Color(c).getHex(THREE.SRGBColorSpace))
}

const rgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]

// ------------------------------------------------------------------------------ what loaders give
/** The package's body for a body read from a file, named and colored as the file has it. */
function bodyOf(value: SmBody): Part | Shell | Sketch {
  const body = wrap(value)
  body.name = value.name ?? ''
  colored(body, value.color)
  return body
}

/** A THREE.Group of the bodies the kernel read. */
function groupOf(read: SmBody | Iterable<SmBody>): THREE.Group {
  const group = new THREE.Group()
  for (const value of read instanceof sm.ShapeList || Array.isArray(read) ? [...read] : [read as SmBody]) group.add(bodyOf(value))
  return group
}

/** A curve, point or coordinate system of a STEP file: named, in its product, colored. */
function extra<T extends THREE.Object3D>(o: T, item: { name: string; product: string; color: readonly number[] | null }): T {
  o.name = item.name
  if (item.product) o.userData.product = item.product
  if (o instanceof BrepEdge || o instanceof Wire || o instanceof BrepVertex) colored(o, item.color)
  else if (item.color !== null) o.userData.color = `#${color(new THREE.Color(), item.color).getHexString(THREE.SRGBColorSpace)}`
  return o
}

/** Gives `o` a copy of the material it shows, in a color of the file (none: as it is). */
function colored(o: Body | BrepEdge | Wire | BrepVertex, value: string | readonly number[] | null | undefined): void {
  if (value == null) return
  const material = (o.material as THREE.Material).clone() as THREE.Material & { color?: THREE.Color }
  if (material.color === undefined) return
  color(material.color, value)
  o.material = material
}

/** A file's color (sRGB: a CSS color, or [r, g, b] from 0 to 1 or to 255) in a THREE.Color (linear). */
function color(target: THREE.Color, value: string | readonly number[]): THREE.Color {
  if (typeof value === 'string') return target.setStyle(value)
  const scale = value.some((c) => c > 1) ? 1 / 255 : 1
  return target.setRGB(value[0] * scale, value[1] * scale, value[2] * scale, THREE.SRGBColorSpace)
}

// ---------------------------------------------------------------------------------------- loading
/** A FileLoader of bytes, set as `loader` is. */
function fileLoader(loader: THREE.Loader<unknown>): THREE.FileLoader {
  const files = new THREE.FileLoader(loader.manager)
  files.setPath(loader.path)
  files.setResponseType('arraybuffer')
  files.setRequestHeader(loader.requestHeader)
  files.setWithCredentials(loader.withCredentials)
  return files
}

/** Loads `url` as `loader` is set, and gives `parse` of its bytes to `onLoad` (as three's loaders do:
 * errors of either go to `onError`, or the console). */
function loadFile<T>(
  loader: THREE.Loader<T>,
  url: string,
  parse: (data: ArrayBuffer) => T,
  onLoad: (result: T) => void,
  onProgress?: (event: ProgressEvent) => void,
  onError?: (error: unknown) => void,
): void {
  fileLoader(loader).load(
    url,
    (data) => {
      try {
        onLoad(parse(data as ArrayBuffer))
      } catch (e) {
        failed(loader, url, e, onError)
      }
    },
    onProgress,
    onError,
  )
}

function failed(loader: THREE.Loader<unknown>, url: string, error: unknown, onError?: (error: unknown) => void): void {
  if (onError) onError(error)
  else console.error(error)
  loader.manager.itemError(url)
}

/**
 * The layers a USD stage (`root`, loaded from `url`) names, and those they name, loaded relative to
 * the layer that names them: by the names the kernel gives them (`joined`). A layer that cannot be
 * loaded is left out (the kernel's warning names it).
 */
async function layersOf(loader: USDBrepLoader, root: ArrayBuffer, url: string): Promise<Map<string, Uint8Array>> {
  // (as GLTFLoader finds its resources: the resource path, else the file's directory)
  const base = loader.resourcePath || THREE.LoaderUtils.resolveURL(THREE.LoaderUtils.extractUrlBase(url), loader.path)
  const files = new THREE.FileLoader(loader.manager)
  files.setResponseType('arraybuffer')
  files.setRequestHeader(loader.requestHeader)
  files.setWithCredentials(loader.withCredentials)
  const layers = new Map<string, Uint8Array>()
  const seen = new Set<string>([''])
  let todo: [string, string, Uint8Array][] = [['', base, new Uint8Array(root)]] // [the kernel's name of a layer, its directory, its bytes]
  while (todo.length) {
    const next: Promise<[string, string, Uint8Array] | null>[] = []
    for (const [from, dir, bytes] of todo) {
      for (const asset of assetsOf(bytes)) {
        const name = joined(from, asset)
        if (seen.has(name)) continue
        seen.add(name)
        const at = /^[a-z][a-z0-9+.-]*:/i.test(asset) ? asset : normalized(dir + asset)
        next.push(files.loadAsync(at).then((d) => [name, THREE.LoaderUtils.extractUrlBase(at), new Uint8Array(d as ArrayBuffer)] as [string, string, Uint8Array], () => null))
      }
    }
    todo = []
    for (const got of await Promise.all(next)) {
      if (got === null) continue
      layers.set(got[0], got[2])
      todo.push(got)
    }
  }
  return layers
}

/** The layers a .usda text names: its asset paths of USD files (`@a.usda@`, `@@@b.usd@@@`). */
function assetsOf(bytes: Uint8Array): string[] {
  const text = new TextDecoder('utf-8').decode(bytes)
  if (!text.startsWith('#usda')) return []
  const out: string[] = []
  for (const m of text.matchAll(/@@@([\s\S]*?)@@@|@([^@\n]+)@/g)) {
    const asset = m[1] ?? m[2]
    if (/\.usda?(?:$|[?#])/i.test(asset) && !out.includes(asset)) out.push(asset)
  }
  return out
}

/** A URL with the '.' and '..' of its path taken out. */
function normalized(url: string): string {
  const [, origin = '', path] = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)?([\s\S]*)$/i.exec(url)!
  return origin + joined('', path)
}

/** The kernel's name of the layer `asset` that the layer `from` names: its path from the stage's
 * directory, '.' and '..' taken out (as smlibwasm names layers). */
function joined(from: string, asset: string): string {
  const out: string[] = []
  for (const p of (asset.startsWith('/') ? asset : from.replace(/[^\\/]*$/, '') + asset).split(/[\\/]/)) {
    if (p === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop()
    else if (p !== '.' && !(p === '' && out.length)) out.push(p)
  }
  return out.join('/')
}

// --------------------------------------------------------------------------------------- checking
/** The options of `what`, checked: an object whose keys are among `keys`. */
function checked<T extends object>(what: string, options: T | null | undefined, keys: readonly string[]): T {
  if (options == null) return {} as T
  if (typeof options !== 'object') throw new TypeError(`${what}: the options are an object, not ${describe(options)}`)
  for (const key of Object.keys(options)) if (!keys.includes(key)) throw new TypeError(`${what}: unknown option '${key}' (its options: ${keys.join(', ')})`)
  return options
}

// the names of smlibwasm's functions its messages begin with (a message of the package's names the
// loader or exporter instead)
const KERNEL_NAME = /^(?:toStep|fromStepModel|fromStep|fromIges|fromDxfWires|fromDxf|toDxf|exportSvg|toSvg|toUsd|fromUsd|toBrep|fromBrep|toSmb|fromSmb|toSmp|fromSmp)(?:\(\))?(?=[: ])/

/** A kernel call of the loader or exporter `what`: its errors as the package's, named after `what`
 * (and `words` of the message replaced). */
function run<T>(what: string, fn: () => T, words: readonly [RegExp, string][] = []): T {
  try {
    return call(fn)
  } catch (e) {
    throw renamed(e, what, words)
  }
}

function renamed(e: unknown, what: string, words: readonly [RegExp, string][]): unknown {
  if (!(e instanceof Error)) return e
  let message = e.message.replace(KERNEL_NAME, what)
  for (const [word, by] of words) message = message.replace(word, by)
  if (message === e.message) return e
  if (e instanceof KernelError) return new KernelError(message, { operation: e.operation, status: e.status, hint: e.hint, trace: e.trace })
  if (e instanceof ModelingError) return new ModelingError(message)
  if (e instanceof RangeError) return new RangeError(message)
  if (e instanceof TypeError) return new TypeError(message)
  return e
}
