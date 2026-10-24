// Reading and writing files.
//
//   Format   Extension                                            Direction
//   STEP     .step, .stp                                          read/write
//   SMLib    .smb (exact native kernel format, one body)          read/write
//   SMLib    .smp (part file: bodies and curves, named)           read/write
//   DXF      .dxf (2D drawings: sketches, sections, curves)       read/write
//   SVG      .svg (2D drawings: views, curves)                    write
//   glTF     .glb, .gltf                                          write
//   STL      .stl                                                 read/write
//   OBJ      .obj                                                 write
//   USD      .usda, .usd (exact: BrepArray prims, as text)        read/write
//   BREP     .brep (OpenCASCADE's exact format)                   read/write
//
// Every format has a pair that works in memory, in the browser and in Node (`toStep` and
// `fromStep`, `toStl` and `fromStl`, `toGlb`, `toGltf`, `toObj`, `toSmb` and `fromSmb`, `toSmp` and
// `fromSmp`, `toUsd` and `fromUsd`, `toBrep` and `fromBrep`), and a
// pair that reads and writes files, which needs Node (`exportStep` and `importStep`, ..., and
// `exportFile` and `load`, which pick the format by the file's extension).

import { _opts, _warn, ext, k, kernelCall, module } from './kernel.ts'
import { toRgb } from './colors.ts'
import { Axis, Location, Plane, Vector } from './geometry.ts'
import { Mesh, _coloredMesh, tessellate } from './mesh.ts'
import { Edge, Face, Part, Shape, ShapeList, Shell, Sketch, Vertex, Wire, _Body, _typeName } from './shapes.ts'
import { _stepItems, _stepText, writeStep } from './step.ts'
import { type BytesLike, _asBytes } from './_bytes.ts'
import { type StepCurve, type StepFrame, type StepModel, type StepPoint, fromStep, importStep } from './step_import.ts'
import { fromIges, importIges } from './iges_import.ts'
import { type DxfShapesLike, exportDxf, fromDxf, importDxf, toDxf } from './dxf.ts'
import { exportSvg, toSvg } from './drawing.ts'
import { exportUsd, fromUsd, importUsd, toUsd } from './usd.ts'
import { exportBrep, fromBrep, importBrep, toBrep } from './occt.ts'

// biome-ignore lint: glTF documents are plain JSON
type Any = any

/** The functions of Node's file system (node:fs) the package uses, as it uses them: written out
 * here rather than taken from Node's types, so that the package's declarations type-check in a
 * project without them (a browser app). */
interface NodeFs {
  readFileSync(path: string): Uint8Array
  writeFileSync(path: string, data: string | Uint8Array, encoding?: 'utf8'): void
  openSync(path: string, flags: string, mode?: number): number
  closeSync(fd: number): void
}

/** Shapes as the exporters, `htmlPage` and `show` take them: parts, sheets, sketches, faces, edges,
 * wires, meshes, or lists of them (an array, a ShapeList, a Set; also nested). */
export type ShapesLike = Shape | Mesh | (Iterable<ShapesLike> & object)

/** What a STEP file can hold, as `exportStep` and `toStep` take it: shapes (also edges, wires and
 * vertices: curves and points), points as Vectors, coordinate systems as Planes, named and colored
 * `StepCurve`s, `StepPoint`s and `StepFrame`s, a whole `StepModel`, or lists of them. */
export type StepItemsLike =
  | Shape
  | Mesh
  | Vector
  | Plane
  | StepCurve
  | StepPoint
  | StepFrame
  | StepModel
  | (Iterable<StepItemsLike> & object)

/** What `exportFile` and `toFile` take: shapes, and what only some formats hold (the views of
 * `drawingViews` for .dxf and .svg; points, coordinate systems and the items of `StepItemsLike`
 * for .step). A format that cannot hold an item says so. */
export type FileItemsLike = StepItemsLike | DxfShapesLike

/**
 * Node's file system (node:fs), for the functions that read and write files. It is looked up
 * when needed (`process.getBuiltinModule`), so bundles for the browser carry no `node:` import;
 * outside Node it throws.
 */
export function _fs(): NodeFs {
  const proc = (globalThis as Any).process
  const fs = typeof proc?.getBuiltinModule === 'function' ? proc.getBuiltinModule('node:fs') : undefined
  if (!fs) {
    throw new Error(
      'reading and writing files needs Node.js (22.3 or later); elsewhere use the functions that work in memory (toStep, fromStep, toStl, fromStl, toGlb, toGltf, toObj, toDxf, fromDxf, toSmb, fromSmb, toSmp, fromSmp, toUsd, fromUsd)',
    )
  }
  return fs as NodeFs
}

/** Python's os.path.splitext: [root, extension], the extension from the last dot of the file's
 * name (leading dots do not count). */
function _splitext(p: string): [string, string] {
  const sep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  const dot = p.lastIndexOf('.')
  if (dot > sep) {
    for (let i = sep + 1; i < dot; i++) if (p[i] !== '.') return [p.slice(0, dot), p.slice(dot)]
  }
  return [p, '']
}

function _isIterable(x: unknown): x is Iterable<unknown> {
  return x != null && typeof x !== 'string' && typeof (x as Any)[Symbol.iterator] === 'function'
}

/** The bodies and meshes of `shapes` (a shape, a mesh or nested lists of them); a face becomes a
 * sheet of its own, or stays a face with `faces`. Anything else throws a TypeError that says what
 * `what` writes instead. */
export function _items(shapes: unknown, faces = false, what = 'this writer'): (Shape | Mesh)[] {
  if (shapes instanceof _Body || shapes instanceof Mesh) return [shapes]
  if (shapes instanceof Face) return [faces ? shapes : shapes.toShell()]
  if (shapes instanceof Shape || !_isIterable(shapes) || _isValue(shapes)) throw new TypeError(_notWritable(shapes, what))
  const out: (Shape | Mesh)[] = []
  for (const s of shapes) out.push(..._items(s, faces, what))
  return out
}

function _isValue(x: unknown): boolean {
  return x instanceof Vector || x instanceof Axis || x instanceof Location || x instanceof Plane
}

/** Why `what` cannot write `item` (an edge, a point, ...), and what can. */
function _notWritable(item: unknown, what: string): string {
  const name = _typeName(item)
  const article = 'AEIOU'.includes(name.slice(0, 1).toUpperCase()) && name ? 'an' : 'a'
  const smb = what === 'save' || what === 'toSmb'
  const text = smb ? `an .smb file holds one body, not ${article} ${name}` : `${what} writes parts, sheets, faces and meshes, not ${article} ${name}`
  if (item instanceof Edge || item instanceof Wire) {
    return (
      text +
      (smb
        ? ': save curves to an .smp file, which holds bodies and curves (or write them with exportStep or exportDxf)'
        : ': exportStep and exportDxf write curves, and so does save to an .smp file')
    )
  }
  if (item instanceof Vertex || item instanceof Vector) return `${text}: exportStep writes points`
  return text
}

function _label(name: string | null | undefined): string {
  return name ? `'${name}'` : 'the body'
}

type _Dump = {
  regions: { infinite: boolean; void: boolean }[]
  shells: { closed: boolean }[]
  faces: { uses: { shell: number; loops: { edges: [number, boolean][]; vertex: number | null }[] }[] }[]
  edges: { v0: number; v1: number }[]
  vertices: unknown[]
}

/** What a body read from a file holds beside its faces: wire edges (edges no face uses), points
 * (vertices no edge uses) and, in a solid, faces outside it (of shells that do not close): the
 * parts of the note, whether it has wire edges or points, whether it has faces outside. */
function _components(dump: _Dump, solid: boolean): [string[], boolean, boolean] {
  const usedEdges = new Set<number>()
  const usedVertices = new Set<number>()
  let loose = 0
  for (const f of dump.faces) {
    for (const use of f.uses) {
      for (const loop of use.loops) {
        for (const [e] of loop.edges) usedEdges.add(e)
        if (loop.vertex !== null && loop.vertex !== undefined) usedVertices.add(loop.vertex)
      }
    }
    if (solid && f.uses.length && f.uses.every((u) => !dump.shells[u.shell].closed)) loose += 1
  }
  let wires = 0
  for (let i = 0; i < dump.edges.length; i++) if (!usedEdges.has(i)) wires += 1
  for (const e of dump.edges) usedVertices.add(e.v0).add(e.v1)
  let points = 0
  for (let i = 0; i < dump.vertices.length; i++) if (!usedVertices.has(i)) points += 1
  const parts: string[] = []
  if (wires) parts.push(wires > 1 ? `${wires} wire edges (edges of no face)` : '1 wire edge (an edge of no face)')
  if (points) parts.push(points > 1 ? `${points} points (vertices of no edge)` : '1 point (a vertex of no edge)')
  if (loose) parts.push(`${loose} face${loose > 1 ? 's' : ''} outside the solid (a sheet)`)
  return [parts, wires > 0 || points > 0, loose > 0]
}

/** A body read from a file: a Part when it encloses a volume (one cell or more, see Part.merge),
 * else a Shell, with a warning where it also holds wire edges, points or faces outside its solid (a
 * Part that is then not valid), or holds no faces at all. */
export function _body(brep: number, name: string | null, color: [number, number, number] | null, what: string): Part | Shell {
  const dump: _Dump = ext.brep_dump(brep, false)
  const solid = dump.regions.some((r) => !r.infinite && !r.void)
  const body = solid ? Part._wrap(brep, { name, color }) : Shell._wrap(brep, { name, color })
  body._h.imported = true // (read from a file: its fillets run in the probe worker)
  const [parts, extra, loose] = _components(dump, solid)
  if (parts.length && !dump.faces.length) {
    _warn(`${what}: ${_label(name)} has no faces, only ${parts.join(' and ')}: it is read as a Shell without faces, whose edges() are its curves`)
  } else if (parts.length && solid) {
    const fix = loose ? 'part.solids() takes the faces outside the solid apart' : 'stitch(part.faces()) gives the solid alone'
    _warn(`${what}: ${_label(name)} is a solid that also holds ${parts.join(' and ')}, so isValid() is false and modeling with it may fail; ${fix}`)
  } else if (extra) {
    _warn(`${what}: ${_label(name)} also holds ${parts.join(' and ')}`)
  }
  return body
}

/** Write shapes to `path`; the format follows the file extension (Python's `export`). */
export function exportFile(shapes: FileItemsLike, path: string, options: Record<string, Any> = {}): void {
  const items = shapes as Any // (each format checks what it gets)
  const p = String(path)
  const ext_ = _splitext(p)[1].toLowerCase()
  if (ext_ === '.step' || ext_ === '.stp') exportStep(items, p, options)
  else if (ext_ === '.stl') exportStl(items, p, options)
  else if (ext_ === '.glb') exportGlb(items, p, options)
  else if (ext_ === '.gltf') exportGltf(items, p, options)
  else if (ext_ === '.obj') exportObj(items, p, options)
  else if (ext_ === '.smb' || ext_ === '.smp') save(items, p, options)
  else if (ext_ === '.dxf') exportDxf(items, p, options)
  else if (['.usda', '.usd', '.usdc', '.usdz'].includes(ext_)) exportUsd(items, p, options)
  else if (ext_ === '.brep') {
    _opts('exportBrep', options)
    exportBrep(items, p)
  } else if (ext_ === '.svg') exportSvg(items, p, options)
  else throw new RangeError(`unknown file type '${ext_}'; use .step, .stl, .glb, .gltf, .obj, .smb, .smp, .dxf, .svg, .usda or .brep`)
}

/**
 * The contents of a file of the shapes, in memory, the format picked from the file's name as
 * `exportFile` picks it from a path: the text of a STEP (`.step`, `.stp`), glTF (`.gltf`), OBJ
 * (`.obj`), DXF (`.dxf`), SVG (`.svg`), USD (`.usda`, `.usd`) or OpenCASCADE (`.brep`) file, the
 * bytes (a Uint8Array) of an STL, GLB or SMLib (`.smb`, `.smp`) file. The options are those of the
 * format's function (`toStep`, `toStl`, ...).
 *
 * In a browser, `new Blob([toFile(part, 'part.step')])` is the file to download.
 */
export function toFile(shapes: FileItemsLike, name: string, options: Record<string, Any> = {}): string | Uint8Array {
  const items = shapes as Any // (each format checks what it gets)
  const ext_ = _splitext(String(name))[1].toLowerCase()
  if (ext_ === '.step' || ext_ === '.stp') return toStep(items, options)
  if (ext_ === '.stl') return toStl(items, options)
  if (ext_ === '.glb') return toGlb(items, options)
  if (ext_ === '.gltf') return toGltf(items, options)
  if (ext_ === '.obj') return toObj(items, options)
  if (ext_ === '.smb') return toSmb(items, options)
  if (ext_ === '.smp') return toSmp(items, options)
  if (ext_ === '.dxf') return toDxf(items, options)
  if (ext_ === '.svg') return toSvg(items, options)
  if (ext_ === '.usda' || ext_ === '.usd') return toUsd(items, options)
  if (ext_ === '.usdc' || ext_ === '.usdz') throw new RangeError(`toFile writes text USD (.usda, .usd), not ${ext_}`)
  if (ext_ === '.brep') {
    _opts('toBrep', options)
    return toBrep(items)
  }
  throw new RangeError(`unknown file type '${ext_}'; use .step, .stl, .glb, .gltf, .obj, .smb, .smp, .dxf, .svg, .usda or .brep`)
}

/**
 * Read a file's contents in memory, picking the format from the file's name, as `load` does from a
 * path: STEP (`.step`, `.stp`), IGES (`.igs`, `.iges`), USD (`.usda`), OpenCASCADE (`.brep`) and
 * SMLib (`.smb`, `.smp`) give exact parts, DXF (`.dxf`) a
 * `Sketch` of the drawing's outlines, STL a `Mesh`. `data` is the file's text or its bytes (a
 * Uint8Array or an ArrayBuffer, as `await file.arrayBuffer()` gives them for an
 * `<input type="file">`); of `name`, the file's name or path, only the extension counts.
 *
 * A STEP file with one body gives that part, one with several a `ShapeList`. A native file comes
 * back as a `Part` when its body encloses a volume, as a `Shell` when it does not. The layers a USD
 * file names (subLayers, references, payloads) are not read: `fromUsd` reads them with its
 * `resolve` option.
 */
export function fromFile(data: string | BytesLike, name: string): Part | Shell | Sketch | Mesh | ShapeList<Part | Shell> | Shape | ShapeList<Shape> {
  const ext_ = _splitext(String(name))[1].toLowerCase()
  if (ext_ === '.step' || ext_ === '.stp' || ext_ === '.p21') return fromStep(data)
  if (ext_ === '.stl') return fromStl(data)
  if (ext_ === '.dxf') return fromDxf(data)
  if (['.usda', '.usd', '.usdc', '.usdz'].includes(ext_)) return fromUsd(data)
  const given = typeof data === 'string' ? data : _asBytes(data)
  if (given === null) throw new TypeError(`fromFile reads a string or bytes (a Uint8Array or an ArrayBuffer), not ${_typeName(data)}`)
  const bytes: string | Uint8Array = given
  if (ext_ === '.igs' || ext_ === '.iges') return fromIges(bytes)
  if (ext_ === '.brep') return fromBrep(bytes)
  if (ext_ === '.smp') return fromSmp(bytes)
  if (ext_ !== '.smb') {
    throw new RangeError(`unknown file type '${ext_}'; fromFile reads .step, .stp, .igs, .iges, .stl, .smb, .smp, .dxf, .usda and .brep`)
  }
  return fromSmb(data)
}

// ----------------------------------------------------------------------------------------- STEP
/** How a STEP file is written: `unit` its length unit ("mm", "cm", "m", "um" or "inch"; the
 * coordinates are converted to it), `name` the product's name (the file's name by default),
 * `assembly` each body in a product of its own (default false). */
export interface StepExportOptions {
  unit?: string
  name?: string | null
  assembly?: boolean
}

/**
 * Exact B-rep export to STEP AP214. Names and colors of parts are kept.
 *
 * The bodies go into one product called `name` (default: the file's name), or, with
 * `assembly: true`, each into a product of its own, named as the body, in an assembly called
 * `name`: other CAD systems then list the parts by name. A body listed more than once is written
 * once and used at each place.
 *
 * Edges and wires are written as wireframe curves, vertices and Vectors as points, Planes as
 * coordinate systems (supplemental geometry), each unnamed; `StepCurve`, `StepPoint` and
 * `StepFrame` give them names and colors, and a `StepModel` (from `readStep`) is written whole.
 * `readStep` reads them back.
 */
export function exportStep(shapes: StepItemsLike, path: string, options: StepExportOptions = {}): void {
  _opts('exportStep', options)
  writeStep(_stepItems(shapes), String(path), { unit: options.unit ?? 'mm', name: options.name ?? null, assembly: options.assembly ?? false })
}

/** The text of a STEP AP214 file of the shapes (see `exportStep`). Without a file the product is
 * called "part" unless `name` says otherwise. */
export function toStep(shapes: StepItemsLike, options: StepExportOptions = {}): string {
  _opts('toStep', options)
  return _stepText(_stepItems(shapes), '', { unit: options.unit ?? 'mm', name: options.name ?? null, assembly: options.assembly ?? false })
}

// ------------------------------------------------------------------- numbers as Python writes them
// JavaScript rounds an exact half up (toExponential, toPrecision), Python to even: 1.0078125 is
// "1.007812e+00" in Python, "1.007813e+00" from toExponential. Only exact halves differ, so the
// digits come from toExponential unless the number can be one.

/** The exact decimal digits of a positive finite number (no trailing zeros) and the decimal
 * exponent of the first. */
function _exactDigits(a: number): [string, number] {
  const dv = new DataView(new ArrayBuffer(8))
  dv.setFloat64(0, a)
  const hi = dv.getUint32(0)
  const bits = (hi >>> 20) & 0x7ff
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(dv.getUint32(4))
  let e = -1074
  if (bits) {
    m |= 1n << 52n
    e = bits - 1075
  }
  // a = m 2^e = m 5^-e / 10^-e
  const d = e >= 0 ? (m << BigInt(e)).toString() : (m * 5n ** BigInt(-e)).toString()
  return [d.replace(/0+$/, ''), d.length - 1 - Math.max(0, -e)]
}

/** The number of binary digits after the point of a positive finite number. */
function _fractionBits(a: number): number {
  const dv = new DataView(new ArrayBuffer(8))
  dv.setFloat64(0, a)
  const hi = dv.getUint32(0)
  const lo = dv.getUint32(4)
  const bits = (hi >>> 20) & 0x7ff
  const e = bits ? bits - 1075 : -1074
  const ctz = (x: number) => 31 - Math.clz32(x & -x)
  const zeros = lo !== 0 ? ctz(lo) : (hi & 0xfffff) !== 0 ? 32 + ctz(hi & 0xfffff) : bits ? 52 : 0
  return Math.max(0, -(e + zeros))
}

/** `p` significant digits of a positive finite number, rounded half to even, and the decimal
 * exponent of the first. */
function _pyDigits(a: number, p: number): [string, number] {
  const [m, x] = a.toExponential(p - 1).split('e')
  const digits = m.replace('.', '')
  const exp = Number(x)
  // An exact half has p + 1 significant digits (the last a 5): an integer of more than p digits,
  // or a fraction of k binary digits whose decimal exponent is p - k.
  const k = _fractionBits(a)
  const half = k === 0 ? a >= 10 ** p : p - k === exp || p - k === exp - 1
  if (!half) return [digits, exp]
  const [d, e] = _exactDigits(a)
  if (d.length <= p) return [d.padEnd(p, '0'), e]
  let head = d.slice(0, p)
  const next = d.charCodeAt(p) - 48
  const rest = d.length > p + 1
  if (next > 5 || (next === 5 && (rest || (head.charCodeAt(p - 1) - 48) % 2 === 1))) {
    const up = (BigInt(head) + 1n).toString()
    if (up.length > p) return [up.slice(0, p), e + 1]
    head = up
  }
  return [head, e]
}

function _special(v: number): string | null {
  if (Number.isNaN(v)) return 'nan'
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf'
  return null
}

function _exponent(e: number): string {
  return `e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
}

/** Python's "{:.<decimals>e}". */
function _pyE(v: number, decimals = 6): string {
  const special = _special(v)
  if (special !== null) return special
  const sign = v < 0 || Object.is(v, -0) ? '-' : ''
  if (v === 0) return `${sign}${decimals ? `0.${'0'.repeat(decimals)}` : '0'}e+00`
  const [d, e] = _pyDigits(Math.abs(v), decimals + 1)
  return `${sign}${d[0]}${decimals ? `.${d.slice(1)}` : ''}${_exponent(e)}`
}

/** Python's "{:.<p>g}". */
function _pyG(v: number, p = 6): string {
  const special = _special(v)
  if (special !== null) return special
  const sign = v < 0 || Object.is(v, -0) ? '-' : ''
  if (v === 0) return `${sign}0`
  const [d, e] = _pyDigits(Math.abs(v), Math.max(p, 1))
  if (e < -4 || e >= Math.max(p, 1)) {
    const frac = d.slice(1).replace(/0+$/, '')
    return `${sign}${d[0]}${frac ? `.${frac}` : ''}${_exponent(e)}`
  }
  if (e < 0) return `${sign}0.${'0'.repeat(-e - 1)}${d.replace(/0+$/, '')}`
  const frac = d.slice(e + 1).replace(/0+$/, '')
  return `${sign}${d.slice(0, e + 1)}${frac ? `.${frac}` : ''}`
}

// ------------------------------------------------------------------------------------------ STL
/** How shapes are meshed: `tolerance` the maximum deviation from the exact surface (by default
 * 0.1 % of the bounding box diagonal), `angle` the maximum angle between neighbouring triangle
 * normals in degrees, `maxEdge` the longest edge a triangle may have (see `tessellate`). */
export interface MeshOptions {
  tolerance?: number | null
  angle?: number
  maxEdge?: number | null
}

function _meshes(shapes: unknown, tolerance: number | null, angle: number, what = 'this writer', maxEdge: number | null = null): [Shape | Mesh, Mesh][] {
  const out: [Shape | Mesh, Mesh][] = []
  for (const it of _items(shapes, true, what)) {
    // a face is meshed itself, facing out of its part
    out.push([it, it instanceof Mesh ? it : tessellate(it as Shape, tolerance, angle, { maxEdge })])
  }
  return out
}

/** A triangle mesh in STL (binary unless `ascii`). `tolerance` is the maximum deviation. */
export function toStl(shapes: ShapesLike, options: MeshOptions & { ascii?: boolean } = {}): Uint8Array {
  _opts('toStl', options)
  return _stl(shapes, options, 'toStl')
}

function _stl(shapes: unknown, options: MeshOptions & { ascii?: boolean }, what: string): Uint8Array {
  const { tolerance = null, angle = 15.0, ascii = false, maxEdge = null } = options
  const meshes = _meshes(shapes, tolerance, angle, what, maxEdge).map(([, m]) => m)
  if (!meshes.length) throw new RangeError(`${what}: nothing to write`)
  let count = 0
  for (const m of meshes) count += m.triangles.length / 3
  // corners and normals in single precision, as STL has them
  const tris = new Float32Array(count * 9)
  const normals = new Float32Array(count * 3)
  let corner = 0 // (corners written so far: three a triangle)
  for (const m of meshes) {
    const v = m.vertices
    const tri = m.triangles
    for (let i = 0; i < tri.length; i++, corner++) {
      tris[corner * 3] = v[tri[i] * 3]
      tris[corner * 3 + 1] = v[tri[i] * 3 + 1]
      tris[corner * 3 + 2] = v[tri[i] * 3 + 2]
    }
    normals.set(m.triangleNormals, corner - tri.length)
  }
  if (ascii) {
    const parts: string[] = ['solid smlibwasm\n']
    for (let i = 0; i < count; i++) {
      parts.push(`facet normal ${_pyE(normals[i * 3])} ${_pyE(normals[i * 3 + 1])} ${_pyE(normals[i * 3 + 2])}\n outer loop\n`)
      for (let c = 0; c < 3; c++) {
        const o = i * 9 + c * 3
        parts.push(`  vertex ${_pyE(tris[o])} ${_pyE(tris[o + 1])} ${_pyE(tris[o + 2])}\n`)
      }
      parts.push(' endloop\nendfacet\n')
    }
    parts.push('endsolid smlibwasm\n')
    return new TextEncoder().encode(parts.join(''))
  }
  const out = new Uint8Array(84 + 50 * count)
  out.set(new TextEncoder().encode('smlibwasm binary STL'.padEnd(80, ' ')))
  const dv = new DataView(out.buffer)
  dv.setUint32(80, count, true)
  for (let i = 0; i < count; i++) {
    const o = 84 + 50 * i
    for (let j = 0; j < 3; j++) dv.setFloat32(o + 4 * j, normals[i * 3 + j], true)
    for (let j = 0; j < 9; j++) dv.setFloat32(o + 12 + 4 * j, tris[i * 9 + j], true)
    // (attribute byte count: 0)
  }
  return out
}

/** Triangle mesh export to an STL file (binary unless `ascii`). `tolerance` is the maximum
 * deviation, `maxEdge` the longest edge a triangle may have (see `tessellate`). */
export function exportStl(shapes: ShapesLike, path: string, options: MeshOptions & { ascii?: boolean } = {}): void {
  _opts('exportStl', options)
  const fs = _fs()
  fs.writeFileSync(String(path), _stl(shapes, options, 'exportStl'))
}

/** Read an STL file (binary or ASCII) as a mesh. */
export function importStl(path: string): Mesh {
  const p = String(path)
  return _readStl(_fs().readFileSync(p), p)
}

/** A mesh from the contents of an STL file (binary or ASCII; a string is the text of an ASCII
 * file; bytes are a Uint8Array or an ArrayBuffer, see `BytesLike`). */
export function fromStl(data: string | BytesLike): Mesh {
  return _readStl(_bytes(data, 'fromStl'), null)
}

/** The bytes of a file's contents in memory (a string: its UTF-8 bytes). */
function _bytes(data: string | BytesLike, what: string): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  const bytes = _asBytes(data)
  if (bytes === null) throw new TypeError(`${what} takes the file's contents: a string or bytes (a Uint8Array or an ArrayBuffer), not ${_typeName(data)}`)
  return bytes
}

// Python's str.splitlines and str.split (ASCII text)
const LINES = /\r\n|[\n\r\v\f\x1c-\x1e]/
const BLANKS = /[ \t\n\r\v\f\x1c-\x1f]+/

function _readStl(data: Uint8Array, path: string | null): Mesh {
  if (data.length >= 84) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const n = dv.getUint32(80, true)
    if (84 + 50 * n === data.length) {
      const v = new Float64Array(n * 9)
      for (let i = 0; i < n; i++) for (let j = 0; j < 9; j++) v[i * 9 + j] = dv.getFloat32(84 + 50 * i + 12 + 4 * j, true)
      return _weld(v)
    }
  }
  const truncated = `not an STL file, or a truncated one${path === null ? '' : `: ${path}`}`
  // ASCII; other bytes read as U+FFFD (Python's errors="replace")
  const codes = new Uint16Array(data.length)
  for (let i = 0; i < data.length; i++) codes[i] = data[i] < 128 ? data[i] : 0xfffd
  let text = ''
  for (let i = 0; i < codes.length; i += 0x8000) text += String.fromCharCode(...codes.subarray(i, i + 0x8000))
  const verts: number[] = []
  let rows = 0
  for (const line of text.split(LINES)) {
    const parts = line.split(BLANKS).filter((s) => s !== '')
    if (parts.length && parts[0] === 'vertex') {
      const xyz = parts.slice(1, 4)
      if (xyz.length !== 3) throw new RangeError(truncated)
      for (const x of xyz) verts.push(_float(x))
      rows += 1
    }
  }
  if (!rows || rows % 3) throw new RangeError(truncated)
  return _weld(Float64Array.from(verts))
}

const FLOAT = /^[+-]?(?:(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?|inf(?:inity)?|nan)$/i

/** Python's float() of a word. */
function _float(s: string): number {
  if (!FLOAT.test(s)) throw new RangeError(`could not convert string to float: '${s}'`)
  const t = s.toLowerCase().replace(/^\+/, '')
  if (t.endsWith('inf') || t.endsWith('infinity')) return t.startsWith('-') ? -Infinity : Infinity
  if (t.endsWith('nan')) return Number.NaN
  return Number(s.replaceAll('_', ''))
}

/** numpy's rint: halves to even. */
function _rint(x: number): number {
  const r = Math.round(x)
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** A mesh of triangle corners (x, y, z each, three corners a triangle): corners that agree to 9
 * decimals are one vertex. The vertices come sorted by x, y and z, as numpy's unique gives them
 * (with its sort, so that of equal corners such as 0 and -0 the same one is kept). */
function _weld(corners: Float64Array): Mesh {
  const n = corners.length / 3
  const r = new Float64Array(corners.length)
  for (let i = 0; i < corners.length; i++) r[i] = _rint(corners[i] * 1e9) / 1e9
  const cmp = (i: number, j: number): number => {
    for (let k = 0; k < 3; k++) {
      const c = _compareDouble(r[i * 3 + k], r[j * 3 + k])
      if (c) return c
    }
    return 0
  }
  const perm = _argsortQuick(n, cmp)
  const verts: number[] = []
  const inverse = new Uint32Array(n)
  let last = -1
  for (const i of perm) {
    if (last < 0 || r[i * 3] !== r[last * 3] || r[i * 3 + 1] !== r[last * 3 + 1] || r[i * 3 + 2] !== r[last * 3 + 2]) {
      verts.push(r[i * 3], r[i * 3 + 1], r[i * 3 + 2])
    }
    inverse[i] = verts.length / 3 - 1
    last = i
  }
  return new Mesh(verts, inverse)
}

/** numpy's comparison of two numbers in a sort (NaN after everything). */
function _compareDouble(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  if (a === b) return 0
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1
  return -1
}

/** numpy's argsort(kind="quicksort") for rows compared by `cmp` (its introsort: median-of-three
 * quicksort, insertion sort below 16 items, heapsort past the depth limit). Not stable: which of
 * equal items comes first is numpy's. */
function _argsortQuick(n: number, cmp: (i: number, j: number) => number): Int32Array {
  const t = new Int32Array(n)
  for (let i = 0; i < n; i++) t[i] = i
  const swap = (i: number, j: number) => {
    const x = t[i]
    t[i] = t[j]
    t[j] = x
  }
  const stack: number[] = []
  const depths: number[] = []
  let pl = 0
  let pr = n - 1
  let depth = 0
  for (let u = n >>> 1; u; u >>>= 1) depth++
  depth *= 2
  for (;;) {
    if (depth < 0) _aheapsort(t, pl, pr - pl + 1, cmp)
    else {
      while (pr - pl > 15) {
        const pm = pl + ((pr - pl) >> 1)
        if (cmp(t[pm], t[pl]) < 0) swap(pm, pl)
        if (cmp(t[pr], t[pm]) < 0) swap(pr, pm)
        if (cmp(t[pm], t[pl]) < 0) swap(pm, pl)
        const vp = t[pm]
        let pi = pl
        let pj = pr - 1
        swap(pm, pj)
        for (;;) {
          do ++pi
          while (cmp(t[pi], vp) < 0)
          do --pj
          while (cmp(vp, t[pj]) < 0)
          if (pi >= pj) break
          swap(pi, pj)
        }
        swap(pi, pr - 1)
        // the larger partition waits on the stack
        if (pi - pl < pr - pi) {
          stack.push(pi + 1, pr)
          pr = pi - 1
        } else {
          stack.push(pl, pi - 1)
          pl = pi + 1
        }
        depths.push(--depth)
      }
      for (let pi = pl + 1; pi <= pr; ++pi) {
        const vi = t[pi]
        let pj = pi
        while (pj > pl && cmp(vi, t[pj - 1]) < 0) {
          t[pj] = t[pj - 1]
          pj--
        }
        t[pj] = vi
      }
    }
    if (!stack.length) break
    pr = stack.pop() as number
    pl = stack.pop() as number
    depth = depths.pop() as number
  }
  return t
}

/** numpy's heapsort of the `n` indices from `start` (the fallback of its quicksort). */
function _aheapsort(t: Int32Array, start: number, n: number, cmp: (i: number, j: number) => number): void {
  const at = (i: number) => start + i - 1 // (one-based, as numpy indexes the heap)
  let i: number
  let j: number
  let tmp: number
  for (let l = n >> 1; l > 0; --l) {
    tmp = t[at(l)]
    for (i = l, j = l << 1; j <= n; ) {
      if (j < n && cmp(t[at(j)], t[at(j + 1)]) < 0) j += 1
      if (cmp(tmp, t[at(j)]) < 0) {
        t[at(i)] = t[at(j)]
        i = j
        j += j
      } else break
    }
    t[at(i)] = tmp
  }
  while (n > 1) {
    tmp = t[at(n)]
    t[at(n)] = t[at(1)]
    n -= 1
    for (i = 1, j = 2; j <= n; ) {
      if (j < n && cmp(t[at(j)], t[at(j + 1)]) < 0) j++
      if (cmp(tmp, t[at(j)]) < 0) {
        t[at(i)] = t[at(j)]
        i = j
        j += j
      } else break
    }
    t[at(i)] = tmp
  }
}

// ------------------------------------------------------------------------------------------ OBJ
/** Wavefront OBJ text of the shapes (one object per part), with the mesh's normals: each corner
 * names its normal (`f v//vn`), so edges stay sharp where the faces meet at an angle and curved
 * faces shade smooth. `maxEdge` is the longest edge a triangle may have. */
export function toObj(shapes: ShapesLike, options: MeshOptions = {}): string {
  _opts('toObj', options)
  return _obj(shapes, options, 'toObj')
}

function _obj(shapes: unknown, options: MeshOptions, what: string): string {
  const { tolerance = null, angle = 15.0, maxEdge = null } = options
  const lines = ['# smlibwasm']
  let offset = 1
  let normalOffset = 1
  _meshes(shapes, tolerance, angle, what, maxEdge).forEach(([item, m], i) => {
    lines.push(`o ${(item as Any).name || `part_${i + 1}`}`)
    const v = m.vertices
    // (12 digits: a hundred-thousandth of a millimeter 1 km from the origin)
    for (let j = 0; j < v.length; j += 3) lines.push(`v ${_pyG(v[j], 12)} ${_pyG(v[j + 1], 12)} ${_pyG(v[j + 2], 12)}`)
    const [normals, corner] = _cornerNormals(m)
    for (let j = 0; j < normals.length; j += 3) lines.push(`vn ${_pyG(normals[j], 6)} ${_pyG(normals[j + 1], 6)} ${_pyG(normals[j + 2], 6)}`)
    const t = m.triangles
    for (let j = 0; j < t.length; j += 3) {
      const [na, nb, nc] = [corner[j] + normalOffset, corner[j + 1] + normalOffset, corner[j + 2] + normalOffset]
      lines.push(`f ${t[j] + offset}//${na} ${t[j + 1] + offset}//${nb} ${t[j + 2] + offset}//${nc}`)
    }
    offset += v.length / 3
    normalOffset += normals.length / 3
  })
  return `${lines.join('\n')}\n`
}

/** The unit normals of a mesh's corners in single precision (as numpy works on a float32 array):
 * the mesh's normals, or each triangle's own, to 7 decimals (normals the kernel computed a hair
 * apart are one); -0 is 0. */
function _unitCornerNormals(m: Mesh): Float32Array {
  const tri = m.triangles
  let nrm: Float32Array
  if (m.normals !== null) nrm = Float32Array.from(m.normals)
  else {
    const tn = m.triangleNormals
    nrm = new Float32Array(tri.length * 3)
    for (let f = 0; f < tn.length / 3; f++) for (let c = 0; c < 3; c++) nrm.set(tn.subarray(f * 3, f * 3 + 3), (f * 3 + c) * 3)
  }
  const f32 = Math.fround
  for (let c = 0; c < nrm.length; c += 3) {
    const [x, y, z] = [nrm[c], nrm[c + 1], nrm[c + 2]]
    const ln = f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))))
    const d = ln > 0 ? ln : 1
    nrm[c] = f32(x / d)
    nrm[c + 1] = f32(y / d)
    nrm[c + 2] = f32(z / d)
  }
  for (let c = 0; c < nrm.length; c++) nrm[c] = _round7(nrm[c]) + 0
  return nrm
}

/** numpy's round(x, 7) of a float32: rounded half to even, in single precision. */
function _round7(x: number): number {
  const f32 = Math.fround
  const y = f32(x * f32(1e7))
  let r = Math.round(y)
  if (Math.abs(y - Math.trunc(y)) === 0.5 && r % 2 !== 0) r -= 1 // (half to even)
  return f32(r / f32(1e7))
}

/** numpy's unique over rows: the distinct rows, sorted, and for each row the index of its own. */
function _uniqueRows(rows: ArrayLike<number>, width: number): [number[][], Int32Array] {
  const n = rows.length / width
  const seen = new Map<string, number[]>()
  const keys: string[] = []
  for (let i = 0; i < n; i++) {
    const row = Array.from({ length: width }, (_, j) => rows[i * width + j])
    const key = row.join(',')
    if (!seen.has(key)) seen.set(key, row)
    keys.push(key)
  }
  const unique = [...seen.values()].sort((a, b) => {
    for (let j = 0; j < width; j++) if (a[j] !== b[j]) return a[j] - b[j]
    return 0
  })
  const index = new Map(unique.map((row, i) => [row.join(','), i]))
  return [unique, Int32Array.from(keys, (key) => index.get(key) as number)]
}

/** The distinct unit normals of a mesh's corners (x, y, z each, single precision) and, per triangle
 * corner, which of them it has. */
function _cornerNormals(m: Mesh): [Float32Array, Int32Array] {
  const [unique, corner] = _uniqueRows(_unitCornerNormals(m), 3)
  return [Float32Array.from(unique.flat()), corner]
}

/** A mesh as glTF takes it: one entry per distinct (point, normal) pair of its corners, the points
 * (x, y, z each) and normals (single precision), and three indices per triangle. */
function _indexedCorners(m: Mesh): [Float64Array, Float32Array, Uint32Array] {
  const [normals, corner] = _cornerNormals(m)
  const key = new Float64Array(m.triangles.length * 2)
  for (let i = 0; i < m.triangles.length; i++) {
    key[2 * i] = m.triangles[i]
    key[2 * i + 1] = corner[i]
  }
  const [pairs, index] = _uniqueRows(key, 2)
  const points = new Float64Array(pairs.length * 3)
  const nrm = new Float32Array(pairs.length * 3)
  pairs.forEach(([vi, ni], i) => {
    points.set(m.vertices.subarray(vi * 3, vi * 3 + 3), i * 3)
    nrm.set(normals.subarray(ni * 3, ni * 3 + 3), i * 3)
  })
  return [points, nrm, Uint32Array.from(index)]
}

/** Wavefront OBJ export (one object per part; see `toObj`). */
export function exportObj(shapes: ShapesLike, path: string, options: MeshOptions = {}): void {
  _opts('exportObj', options)
  const fs = _fs()
  fs.writeFileSync(String(path), _obj(shapes, options, 'exportObj'))
}

// --------------------------------------------------------------------------------------- glTF 2.0
export const _DEFAULT_COLORS: readonly string[] = ['#7c93b5', '#d9925a', '#79ad73', '#c97878', '#9d87c7', '#d4b45a', '#6bb3b3', '#b08e6c']

/** A color as glTF's `baseColorFactor` takes it: the sRGB values that colors are given in
 * (`'#7c93b5'`, `[124, 147, 181]`) turned linear, so viewers show the color asked for (glTF stores
 * linear values and viewers encode them as sRGB for the screen). */
function _linearRgb(color: Any): [number, number, number] {
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = toRgb(color)
  return [linear(r), linear(g), linear(b)]
}

/** Polylines of the body's edges (each an array of [x, y, z] points), without the seams of
 * periodic faces (they are not edges a designer drew). */
export function _edgePolylines(item: unknown, angle = 5.0): number[][][] {
  if (!(item instanceof _Body)) return []
  const [flat, counts, seams] = kernelCall('edge tessellation', () => {
    const [f, c] = k.tessellate_boundaries(item._brep, { angle_tolerance_deg: angle })
    return [f as Float64Array, c as Float64Array, new Set<number>(ext.seam_edges(item._brep))] as const
  })
  const out: number[][][] = []
  let i = 0
  counts.forEach((c, n) => {
    if (c >= 2 && !seams.has(n)) {
      const pl: number[][] = []
      for (let j = i; j < i + c; j++) pl.push([flat[j * 3], flat[j * 3 + 1], flat[j * 3 + 2]])
      out.push(pl)
    }
    i += c
  })
  return out
}

/** The shapes and meshes in `shapes` (a shape, a mesh or nested lists of them). */
export function _flattenAll(shapes: unknown): (Shape | Mesh)[] {
  if ((shapes instanceof Shape || shapes instanceof Mesh) && !Array.isArray(shapes)) return [shapes]
  if (!_isIterable(shapes)) throw new TypeError(`'${_typeName(shapes)}' object is not iterable`)
  const out: (Shape | Mesh)[] = []
  for (const s of shapes) out.push(..._flattenAll(s))
  return out
}

/** Points along each edge of an edge or wire (arrays of [x, y, z]): the two ends of a line, 97
 * points along other curves. */
export function _curvePoints(item: Edge | Wire | Shape): number[][][] {
  const edges = item instanceof Edge ? [item] : [...item.edges()]
  return edges.map((e) => {
    const n = e.geomType === 'line' ? 1 : 96
    return Array.from({ length: n + 1 }, (_, i) => e.pointAt(i / n).toArray())
  })
}

/** The middle of the box around points (each [x, y, z]; the origin for none). */
function _centre(points: number[][]): number[] {
  if (!points.length) return [0, 0, 0]
  const lo = [...points[0]]
  const hi = [...points[0]]
  for (const p of points) {
    for (let j = 0; j < 3; j++) {
      lo[j] = Math.min(lo[j], p[j])
      hi[j] = Math.max(hi[j], p[j])
    }
  }
  return [0, 1, 2].map((j) => (lo[j] + hi[j]) / 2)
}

/** Python's "{:,.6g}" with thin spaces between the thousands. */
function _fmtNum(v: number): string {
  const s = _pyG(v, 6)
  const m = /^(-?)(\d+)(.*)$/.exec(s)
  if (!m || m[3].includes('e')) return s
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') + m[3]
}

/** How glTF is written: the mesh options, and `edges` (the B-rep edges as lines, default true)
 * in `edgeColor`. */
export interface GltfOptions extends MeshOptions {
  edges?: boolean
  edgeColor?: Any
}

/** glTF JSON, binary buffer and a one-line summary for any mix of shapes. */
export function gltfDocumentMixed(shapes: unknown, options: GltfOptions = {}): [Any, Uint8Array, string] {
  const { tolerance = null, angle = 15.0, edges = true, edgeColor = '#1f2328', maxEdge = null } = options
  const chunks: Uint8Array[] = []
  let size = 0
  const views: Any[] = []
  const accessors: Any[] = []
  const meshes: Any[] = []
  const nodes: Any[] = []
  const materials: Any[] = []

  const addView = (arr: Float32Array | Uint16Array | Uint32Array, target: number | null): number => {
    if (size % 4) {
      chunks.push(new Uint8Array(4 - (size % 4)))
      size += 4 - (size % 4)
    }
    const off = size
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
    chunks.push(b)
    size += b.length
    const v: Any = { buffer: 0, byteOffset: off, byteLength: b.length }
    if (target !== null) v.target = target
    views.push(v)
    return views.length - 1
  }

  // `arr`: rows of three numbers (one number each for a SCALAR)
  const addAccessor = (arr: Float32Array | Uint16Array | Uint32Array, kind: string, comp: number, target: number | null, minmax = false): number => {
    const view = addView(arr, target)
    const count = kind === 'SCALAR' ? arr.length : arr.length / 3
    const a: Any = { bufferView: view, componentType: comp, count, type: kind }
    if (minmax) {
      if (!count) throw new RangeError('zero-size array to reduction operation minimum which has no identity')
      const lo = [arr[0], arr[1], arr[2]]
      const hi = [arr[0], arr[1], arr[2]]
      for (let i = 0; i < arr.length; i += 3) {
        for (let j = 0; j < 3; j++) {
          if (arr[i + j] < lo[j]) lo[j] = arr[i + j]
          if (arr[i + j] > hi[j]) hi[j] = arr[i + j]
        }
      }
      a.min = lo
      a.max = hi
    }
    accessors.push(a)
    return accessors.length - 1
  }

  const material = (color: Any, lines = false): number => {
    const [r, g, b] = _linearRgb(color)
    const m: Any = {
      pbrMetallicRoughness: { baseColorFactor: [r, g, b, 1.0], metallicFactor: lines ? 0.0 : 0.05, roughnessFactor: lines ? 1.0 : 0.55 },
    }
    if (!lines) m.doubleSided = true
    materials.push(m)
    return materials.length - 1
  }

  const linePrim = (polylines: number[][][], mat: number, centre: number[]): Any => {
    if (!polylines.length) throw new RangeError('need at least one array to concatenate')
    const segs: number[] = []
    for (const pl of polylines) {
      for (let i = 0; i + 1 < pl.length; i++) for (const p of [pl[i], pl[i + 1]]) segs.push(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])
    }
    return { attributes: { POSITION: addAccessor(Float32Array.from(segs), 'VEC3', 5126, 34962, true) }, material: mat, mode: 1 }
  }

  const items = _flattenAll(shapes)
  let edgeMat: number | null = null
  let colorIndex = 0
  items.forEach((item, i) => {
    const name = (item as Any).name || `${_typeName(item).toLowerCase()}_${i + 1}`
    const prims: Any[] = []
    // Positions are float32 in glTF (7 digits): each node holds them relative to the middle of its
    // shape and moves them there by its translation (a double), so a part far from the origin
    // keeps its shape.
    let centre = [0, 0, 0]
    if (item instanceof Edge || item instanceof Wire) {
      const points = _curvePoints(item)
      centre = _centre(points.flat())
      prims.push(linePrim(points, material((item as Any).color || '#d9480f', true), centre))
    } else if (item instanceof Vertex) {
      centre = item.point.toArray()
      const pts = new Float32Array(3)
      prims.push({ attributes: { POSITION: addAccessor(pts, 'VEC3', 5126, 34962, true) }, material: material('#d9480f', true), mode: 0 })
    } else {
      const body = item instanceof Face ? item.toShell() : item
      // a face is meshed itself, facing out of its part; its copy gives the edges
      const [m, faceColors] = body instanceof Mesh ? [body, null] : _coloredMesh(item as Shape, tolerance, angle, maxEdge)
      const own = item instanceof Face ? item.color : null
      const color = own || (body as Any).color || _DEFAULT_COLORS[colorIndex % _DEFAULT_COLORS.length]
      colorIndex += 1
      const v = m.vertices
      const rows: number[][] = []
      for (let j = 0; j < v.length; j += 3) rows.push([v[j], v[j + 1], v[j + 2]])
      centre = _centre(rows)
      // faces of their own color: a primitive per color, the others in the body's (kernel plan T5);
      // each with every distinct (point, normal) pair of its corners once, and its triangles as indices
      const count = m.triangles.length / 3
      for (const [rgb, sel] of _colorGroups(faceColors, count, toRgb(color))) {
        let piece = m
        if (sel.length !== count) {
          const tris = new Uint32Array(sel.length * 3)
          const nrms = m.normals === null ? null : new Float32Array(sel.length * 9)
          sel.forEach((t, i) => {
            tris.set(m.triangles.subarray(t * 3, t * 3 + 3), i * 3)
            if (nrms !== null) nrms.set(m.normals!.subarray(t * 9, t * 9 + 9), i * 9)
          })
          piece = new Mesh(m.vertices, tris, nrms)
        }
        const [points, nrm, index] = _indexedCorners(piece)
        const pos = new Float32Array(points.length)
        for (let c = 0; c < points.length; c += 3) for (let j = 0; j < 3; j++) pos[c + j] = points[c + j] - centre[j]
        const wide = pos.length / 3 > 65535
        prims.push({
          attributes: { POSITION: addAccessor(pos, 'VEC3', 5126, 34962, true), NORMAL: addAccessor(nrm, 'VEC3', 5126, 34962) },
          indices: addAccessor(wide ? index : Uint16Array.from(index), 'SCALAR', wide ? 5125 : 5123, 34963),
          material: material(rgb),
          mode: 4,
        })
      }
      if (edges && body instanceof _Body) {
        const lines = _edgePolylines(body)
        if (lines.length) {
          if (edgeMat === null) edgeMat = material(edgeColor, true)
          prims.push(linePrim(lines, edgeMat, centre))
        }
      }
    }
    meshes.push({ name, primitives: prims })
    const node: Any = { mesh: meshes.length - 1, name }
    if (centre.some((x) => x !== 0)) node.translation = centre
    nodes.push(node)
  })

  const doc = {
    asset: { version: '2.0', generator: 'smlibwasm' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: size }],
  }
  const buf = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    buf.set(c, at)
    at += c.length
  }
  return [doc, buf, _summary(items)]
}

/** The triangles of a mesh by color: [color, the triangles] for each color in `colors` (three numbers
 * per triangle, NaN for `fallback`; null: all `fallback`), in the order they first come. */
function _colorGroups(colors: Float64Array | null, count: number, fallback: number[]): [number[], number[]][] {
  if (colors === null) return [[fallback, Array.from({ length: count }, (_, i) => i)]]
  const groups = new Map<string, [number[], number[]]>()
  for (let t = 0; t < count; t++) {
    const c = [colors[t * 3], colors[t * 3 + 1], colors[t * 3 + 2]]
    const plain = c.some(Number.isNaN)
    const key = plain ? '-' : c.map((x) => x.toFixed(6)).join(',')
    let g = groups.get(key)
    if (g === undefined) groups.set(key, (g = [plain ? fallback : c, []]))
    g[1].push(t)
  }
  return [...groups.values()]
}

function _summary(items: (Shape | Mesh)[]): string {
  if (items.length !== 1) return `<b>${items.length} shapes</b>`
  const it = items[0]
  const parts = [`<b>${_typeName(it)}</b>`]
  try {
    if (it instanceof _Body) parts.push(`${k.brep_face_count(it._brep)} faces`)
    if (it instanceof Part) parts.push(`volume ${_fmtNum(Number(it._props().volume))}`) // no measure warnings here
    else if (it instanceof Sketch || it instanceof Shell) parts.push(`area ${_fmtNum(it.area)}`)
    const s = it.bbox().size
    parts.push([s.x, s.y, s.z].map(_fmtNum).join(' \u00d7 '))
  } catch {
    // (a summary without the measures)
  }
  return parts.join(' \u00b7 ')
}

/** glTF JSON and binary buffer for the shapes. */
export function gltfDocument(shapes: unknown, options: GltfOptions = {}): [Any, Uint8Array] {
  const [doc, buf] = gltfDocumentMixed(shapes, options)
  return [doc, buf]
}

/**
 * Binary glTF (GLB) of the shapes, with colors, names and (optionally) the B-rep edges as lines.
 *
 * glTF is Y-up and measured in meters; the model is written Z-up in millimeters as modeled, under
 * a root node that turns it upright and scales it by 0.001, so viewers show it at its real size.
 */
export function toGlb(shapes: ShapesLike, options: GltfOptions = {}): Uint8Array {
  _opts('toGlb', options)
  const [doc, buf] = gltfDocument(shapes, options)
  _zUp(doc, true)
  const text = new TextEncoder().encode(JSON.stringify(doc))
  const js = new Uint8Array(text.length + ((4 - (text.length % 4)) % 4)).fill(0x20)
  js.set(text)
  const bin = new Uint8Array(buf.length + ((4 - (buf.length % 4)) % 4))
  bin.set(buf)
  const total = 12 + 8 + js.length + 8 + bin.length
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i)
  }
  ascii(0, 'glTF')
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, js.length, true)
  ascii(16, 'JSON')
  out.set(js, 20)
  dv.setUint32(20 + js.length, bin.length, true)
  ascii(24 + js.length, 'BIN\0')
  out.set(bin, 28 + js.length)
  return out
}

/**
 * Binary glTF export with colors, names and (optionally) the B-rep edges as lines.
 *
 * glTF is Y-up and measured in meters; the model is written Z-up in millimeters as modeled, under
 * a root node that turns it upright and scales it by 0.001, so viewers show it at its real size.
 */
export function exportGlb(shapes: ShapesLike, path: string, options: GltfOptions = {}): void {
  _opts('exportGlb', options)
  const fs = _fs()
  fs.writeFileSync(String(path), toGlb(shapes, options))
}

/** glTF JSON of the shapes with the buffer embedded as a data URI (in meters, like `toGlb`). */
export function toGltf(shapes: ShapesLike, options: GltfOptions = {}): string {
  _opts('toGltf', options)
  const [doc, buf] = gltfDocument(shapes, options)
  _zUp(doc, true)
  doc.buffers[0].uri = `data:application/octet-stream;base64,${_base64(buf)}`
  return JSON.stringify(doc)
}

/** glTF export with the buffer embedded as a data URI (in meters, like `exportGlb`). */
export function exportGltf(shapes: ShapesLike, path: string, options: GltfOptions = {}): void {
  _opts('exportGltf', options)
  const fs = _fs()
  fs.writeFileSync(String(path), toGltf(shapes, options))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 of bytes (no Buffer, no btoa: works everywhere). */
export function _base64(bytes: Uint8Array): string {
  const n = bytes.length
  const out = new Uint8Array(Math.ceil(n / 3) * 4)
  let o = 0
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i]
    const b = i + 1 < n ? bytes[i + 1] : 0
    const c = i + 2 < n ? bytes[i + 2] : 0
    const t = (a << 16) | (b << 8) | c
    out[o++] = B64.charCodeAt((t >> 18) & 63)
    out[o++] = B64.charCodeAt((t >> 12) & 63)
    out[o++] = i + 1 < n ? B64.charCodeAt((t >> 6) & 63) : 61 // '='
    out[o++] = i + 2 < n ? B64.charCodeAt(t & 63) : 61
  }
  let s = ''
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000))
  return s
}

/** Put the scene under a root node that turns the Z-up model Y-up (glTF's), in meters with
 * `meters`. */
export function _zUp(doc: Any, meters = false): void {
  const n = doc.nodes.length
  // rotate -90 degrees about X: Z-up model -> Y-up glTF; glTF units are meters
  const root: Any = { name: 'z-up', rotation: [-0.7071067811865476, 0.0, 0.0, 0.7071067811865476], children: Array.from({ length: n }, (_, i) => i) }
  if (meters) {
    root.name = 'z-up, mm'
    root.scale = [0.001, 0.001, 0.001]
  }
  doc.nodes.push(root)
  doc.scenes[0].nodes = [n]
}

// ----------------------------------------------------------------------------- native SMLib files
let _tmp = 0

/** A free name for a file in the module's own (in-memory) file system. */
function _tmpName(): string {
  _tmp += 1
  return `/tmp/smlibwasm-${_tmp}.smb`
}

function _unlink(name: string): void {
  try {
    module.FS.unlink(name)
  } catch {
    // (not written)
  }
}

/** The one body of `shapes`, for an .smb file. */
function _oneBody(shapes: unknown, what: string): _Body {
  const items = _items(shapes, false, what)
  if (items.length !== 1)
    throw new RangeError(
      'an .smb file holds one body; fuse the parts, save them separately, or save them to an .smp file (which holds several, with their names and colors)',
    )
  const body = items[0]
  if (!(body instanceof _Body)) throw new TypeError(`an .smb file holds an exact body, not a ${_typeName(body)}`)
  return body
}

/** The contents of an SMLib native `.smb` file of one body (exact; ASCII unless `ascii` is false).
 * Reading it back gives the same geometry; B-spline faces that are exactly planes, cylinders, cones,
 * spheres or surfaces of revolution come back as those (`toNurbs()` does not survive). */
export function toSmb(shapes: ShapesLike, options: { ascii?: boolean } = {}): Uint8Array {
  _opts('toSmb', options)
  const { ascii = true } = options
  const body = _oneBody(shapes, 'toSmb')
  const name = _tmpName()
  try {
    kernelCall('save', () => k.brep_write_to_file(body._brep, name, ascii))
    return module.FS.readFile(name) as Uint8Array
  } finally {
    _unlink(name)
  }
}

/** The body of an SMLib native `.smb` file's contents (its text, or its bytes: a Uint8Array or an
 * ArrayBuffer): a Part when it encloses a volume (a merged part with its cells too, and a broken
 * solid, whose `isValid()` is false), a Shell when it does not. */
export function fromSmb(data: string | BytesLike): Part | Shell {
  const bytes = _bytes(data, 'fromSmb')
  const name = _tmpName()
  let b: number
  try {
    module.FS.writeFile(name, bytes)
    b = kernelCall('load', () => k.read_brep_from_file(name, null, false))
  } finally {
    _unlink(name)
  }
  return _body(b, null, null, 'fromSmb')
}

/** The bytes of a part file of the bodies and curves of `shapes`. */
function _smp(shapes: unknown, ascii: boolean, what: string): Uint8Array {
  const items: [number | null, number | null, string | null, number[] | null, number, number[] | null][] = []
  const curves: number[] = [] // (copies, freed once written)
  let wires = 0
  const add = (s: unknown): void => {
    if (s instanceof Face) s = s.toShell()
    if (s instanceof _Body) {
      const c = (s as Any).color
      // a part's sheet metal bends with their K-factors (fold, flange), so that it unfolds as folded
      const folds = s instanceof Part ? s._folds.flatMap(([o, d, r, kf]) => [...o, ...d, r, kf].map(Number)) : []
      items.push([s._brep, null, (s as Any).name || null, c ? Array.from(toRgb(c), Number) : null, -1, folds.length ? folds : null])
    } else if (s instanceof Edge) {
      const c = s._copyCurve()
      curves.push(c)
      items.push([null, c, null, null, -1, null])
    } else if (s instanceof Wire) {
      for (const c of s._copyCurves()) {
        curves.push(c)
        items.push([null, c, null, null, wires, null])
      }
      wires += 1
    } else if (s instanceof Mesh) {
      throw new TypeError(`${what}: an .smp file holds exact bodies and curves, not a Mesh: write meshes with exportStl, exportObj or exportGlb`)
    } else if (s instanceof Shape || !_isIterable(s) || _isValue(s)) {
      const name = _typeName(s)
      const article = name && 'AEIOU'.includes(name.slice(0, 1).toUpperCase()) ? 'an' : 'a'
      const point = s instanceof Vertex || s instanceof Vector ? ': exportStep writes points' : ''
      throw new TypeError(`${what}: an .smp file holds parts, sheets, faces, edges and wires, not ${article} ${name}${point}`)
    } else {
      for (const x of s) add(x)
    }
  }
  try {
    add(shapes)
    if (!items.length) throw new RangeError(`${what}: nothing to write`)
    return kernelCall(what, () => ext.part_bytes(items, ascii))
  } finally {
    for (const c of curves) ext.delete_curve(c)
  }
}

/**
 * The contents of an SMLib part file (`.smp`) of the shapes, as `save` writes it.
 *
 * A part file is the kernel's own container: any number of exact bodies (parts with their cells,
 * sheets, sketches and faces as sheets), each with its name and color, and curves (an edge as one, a
 * wire as its edges). `fromSmp` and `load` give them back in the same order, with their names and
 * colors, a wire as a `Wire`. A sheet metal part keeps the K-factor each bend was folded with
 * (`fold`, `flange`), so that it unfolds as it was folded; `.smb` and STEP files do not hold them
 * (pass `kFactor` to `unfold` for a part read from those). ASCII unless `ascii` is false; the
 * binary form is bit-exact, the ASCII form keeps the geometry to 16 decimals.
 */
export function toSmp(shapes: ShapesLike, options: { ascii?: boolean } = {}): Uint8Array {
  _opts('toSmp', options)
  return _smp(shapes, options.ascii ?? true, 'toSmp')
}

/**
 * The bodies and curves of an SMLib part file's contents (`.smp`, ASCII or binary): a single shape
 * when it holds one, otherwise a `ShapeList`. Bodies come back as `Part` (one that encloses a
 * volume) or `Shell`, named and colored as written, curves as `Edge` and `Wire`; a file of another
 * SMLib program gives its loose surfaces as sheets of one face each.
 */
export function fromSmp(data: string | BytesLike): Shape | ShapeList<Shape> {
  const bytes = _bytes(data, 'fromSmp')
  const found: [number | null, number | null, string, Float64Array | null, number, Float64Array | null][] = kernelCall('fromSmp', () => ext.part_items(bytes))
  const out: (Shape | Edge[])[] = []
  const wires = new Map<number, Edge[]>()
  for (const [brep, curve, name, color, wire, folds] of found) {
    if (brep !== null) {
      const body = _body(brep, name || null, color ? (Array.from(color) as [number, number, number]) : null, 'fromSmp')
      if (folds && folds.length && body instanceof Part) {
        const f = Array.from(folds)
        const records: (readonly [number[], number[], number, number])[] = []
        for (let i = 0; i + 7 < f.length; i += 8) records.push([f.slice(i, i + 3), f.slice(i + 3, i + 6), f[i + 6], f[i + 7]] as const)
        body._folds = records
      }
      out.push(body)
    }
    else if (wire >= 0 && wires.has(wire)) (wires.get(wire) as Edge[]).push(Edge._fromCurve(curve as number))
    else if (wire >= 0) {
      const edges = [Edge._fromCurve(curve as number)]
      wires.set(wire, edges)
      out.push(edges)
    } else out.push(Edge._fromCurve(curve as number))
  }
  if (!out.length) throw new RangeError('the .smp file holds no bodies or curves')
  const shapes = new ShapeList<Shape>(...out.map((x) => (Array.isArray(x) ? Wire._raw(x) : x)))
  return shapes.length === 1 ? shapes[0] : shapes
}

/**
 * Write shapes to SMLib's native files (exact): one body to an `.smb` file (see `toSmb`), or bodies
 * and curves with their names and colors to an `.smp` part file (see `toSmp`); any other extension
 * writes `.smb`.
 */
export function save(shapes: ShapesLike, path: string, options: { ascii?: boolean } = {}): void {
  _opts('save', options)
  const fs = _fs()
  const p = String(path)
  if (_splitext(p)[1].toLowerCase() === '.smp') {
    fs.writeFileSync(p, _smp(shapes, options.ascii ?? true, 'save'))
    return
  }
  const body = _oneBody(shapes, 'save')
  const name = _tmpName()
  try {
    kernelCall('save', () => k.brep_write_to_file(body._brep, name, options.ascii ?? true))
    fs.writeFileSync(p, module.FS.readFile(name) as Uint8Array)
  } finally {
    _unlink(name)
  }
}

/**
 * Read a file, picking the format from the extension: STEP (`.step`, `.stp`), IGES (`.igs`, `.iges`),
 * USD (`.usda`), OpenCASCADE (`.brep`) and SMLib (`.smb`, `.smp`) give exact parts, DXF (`.dxf`) a
 * `Sketch` of the drawing's outlines, STL a `Mesh`.
 *
 * A STEP or IGES file with one body gives that part, one with several a `ShapeList`. A native file comes
 * back as a `Part` when its body encloses a volume (a merged part with its cells too, and a broken
 * solid, whose `isValid()` is false), as a `Shell` when it does not; a part file (`.smp`) with its
 * names, colors and curves (see `fromSmp`). A body that also holds wire edges, points or faces outside
 * its solid comes with a warning.
 */
export function load(path: string): Part | Shell | Sketch | Mesh | ShapeList<Part | Shell> | Shape | ShapeList<Shape> {
  const p = String(path)
  const ext_ = _splitext(p)[1].toLowerCase()
  if (ext_ === '.step' || ext_ === '.stp' || ext_ === '.p21') return importStep(p)
  if (ext_ === '.igs' || ext_ === '.iges') return importIges(p)
  if (ext_ === '.stl') return importStl(p)
  if (ext_ === '.dxf') return importDxf(p)
  if (['.usda', '.usd', '.usdc', '.usdz'].includes(ext_)) return importUsd(p)
  if (ext_ === '.brep') return importBrep(p)
  if (ext_ !== '.smb' && ext_ !== '.smp')
    throw new RangeError(`unknown file type '${ext_}'; load reads .step, .stp, .igs, .iges, .stl, .smb, .smp, .dxf, .usda and .brep`)
  const data = _fs().readFileSync(p)
  if (ext_ === '.smp') return fromSmp(data)
  const name = _tmpName()
  let b: number
  try {
    module.FS.writeFile(name, data)
    b = kernelCall('load', () => k.read_brep_from_file(name, null, false))
  } finally {
    _unlink(name)
  }
  return _body(b, null, null, 'load')
}
