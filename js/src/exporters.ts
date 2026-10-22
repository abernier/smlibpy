// Reading and writing files.
//
//   Format   Extension                                            Direction
//   STEP     .step, .stp                                          read/write
//   SMLib    .smb (exact, lossless native kernel format)          read/write
//   DXF      .dxf (2D drawings: sketches, sections, curves)       read/write
//   glTF     .glb, .gltf                                          write
//   STL      .stl                                                 read/write
//   OBJ      .obj                                                 write
//   USD      .usda, .usd (exact: BrepArray prims, as text)        read/write
//
// Every format has a pair that works in memory, in the browser and in Node (`toStep` and
// `fromStep`, `toStl` and `fromStl`, `toGlb`, `toGltf`, `toObj`, `toSmb` and `fromSmb`, `toUsd` and
// `fromUsd`), and a
// pair that reads and writes files, which needs Node (`exportStep` and `importStep`, ..., and
// `exportFile` and `load`, which pick the format by the file's extension).

import { _opts, ext, k, kernelCall, module } from './kernel.ts'
import { toRgb } from './colors.ts'
import { Mesh, tessellate } from './mesh.ts'
import { Edge, Face, Part, Shape, Shell, Sketch, Vertex, Wire, _Body, _typeName } from './shapes.ts'
import { _stepText, writeStep } from './step.ts'
import { importStep } from './step_import.ts'
import { exportDxf, importDxf } from './dxf.ts'
import { exportUsd, importUsd } from './usd.ts'

// biome-ignore lint: glTF documents are plain JSON
type Any = any
type NodeFs = typeof import('node:fs')

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
      'reading and writing files needs Node.js (22.3 or later); elsewhere use the functions that work in memory (toStep, fromStep, toStl, fromStl, toGlb, toGltf, toObj, toDxf, fromDxf, toSmb, fromSmb)',
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
 * sheet of its own, or stays a face with `faces`. */
export function _items(shapes: unknown, faces = false): (Shape | Mesh)[] {
  if (shapes instanceof _Body || shapes instanceof Mesh) return [shapes]
  if (shapes instanceof Face) return [faces ? shapes : shapes.toShell()]
  if (!_isIterable(shapes)) throw new TypeError(`'${_typeName(shapes)}' object is not iterable`)
  const out: (Shape | Mesh)[] = []
  for (const s of shapes) out.push(..._items(s, faces))
  return out
}

/** Write shapes to `path`; the format follows the file extension (Python's `export`). */
export function exportFile(shapes: unknown, path: string, options: Record<string, Any> = {}): void {
  const p = String(path)
  const ext_ = _splitext(p)[1].toLowerCase()
  if (ext_ === '.step' || ext_ === '.stp') exportStep(shapes, p, options)
  else if (ext_ === '.stl') exportStl(shapes, p, options)
  else if (ext_ === '.glb') exportGlb(shapes, p, options)
  else if (ext_ === '.gltf') exportGltf(shapes, p, options)
  else if (ext_ === '.obj') exportObj(shapes, p, options)
  else if (ext_ === '.smb') save(shapes, p, options)
  else if (ext_ === '.dxf') exportDxf(shapes, p, options)
  else if (['.usda', '.usd', '.usdc', '.usdz'].includes(ext_)) exportUsd(shapes, p, options)
  else throw new RangeError(`unknown file type '${ext_}'; use .step, .stl, .glb, .gltf, .obj, .smb, .dxf or .usda`)
}

// ----------------------------------------------------------------------------------------- STEP
/** How a STEP file is written: `unit` its length unit ("mm", "cm", "m", "um" or "inch"; the
 * coordinates are converted to it), `name` the product's name (the file's name by default). */
export interface StepExportOptions {
  unit?: string
  name?: string | null
}

/** Exact B-rep export to STEP AP214. Names and colors of parts are kept. */
export function exportStep(shapes: unknown, path: string, options: StepExportOptions = {}): void {
  _opts('exportStep', options)
  writeStep(_items(shapes), String(path), { unit: options.unit ?? 'mm', name: options.name ?? null })
}

/** The text of a STEP AP214 file of the shapes (see `exportStep`). Without a file the product is
 * called "part" unless `name` says otherwise. */
export function toStep(shapes: unknown, options: StepExportOptions = {}): string {
  _opts('toStep', options)
  return _stepText(_items(shapes), '', { unit: options.unit ?? 'mm', name: options.name ?? null })
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
 * normals in degrees. */
export interface MeshOptions {
  tolerance?: number | null
  angle?: number
}

function _meshes(shapes: unknown, tolerance: number | null, angle: number): [Shape | Mesh, Mesh][] {
  const out: [Shape | Mesh, Mesh][] = []
  for (const it of _items(shapes, true)) {
    // a face is meshed itself, facing out of its part
    out.push([it, it instanceof Mesh ? it : tessellate(it as Shape, tolerance, angle)])
  }
  return out
}

/** A triangle mesh in STL (binary unless `ascii`). `tolerance` is the maximum deviation. */
export function toStl(shapes: unknown, options: MeshOptions & { ascii?: boolean } = {}): Uint8Array {
  _opts('toStl', options)
  const { tolerance = null, angle = 15.0, ascii = false } = options
  const meshes = _meshes(shapes, tolerance, angle).map(([, m]) => m)
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
 * deviation. */
export function exportStl(shapes: unknown, path: string, options: MeshOptions & { ascii?: boolean } = {}): void {
  _opts('exportStl', options)
  const fs = _fs()
  fs.writeFileSync(String(path), toStl(shapes, options))
}

/** Read an STL file (binary or ASCII) as a mesh. */
export function importStl(path: string): Mesh {
  const p = String(path)
  return _readStl(_fs().readFileSync(p), p)
}

/** A mesh from the contents of an STL file (binary or ASCII; a string is the text of an ASCII
 * file). */
export function fromStl(data: string | Uint8Array): Mesh {
  return _readStl(_bytes(data), null)
}

function _bytes(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (!ArrayBuffer.isView(data)) throw new TypeError(`expected a string or a Uint8Array, not ${_typeName(data)}`)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
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
/** Wavefront OBJ text of the shapes (one object per part). */
export function toObj(shapes: unknown, options: MeshOptions = {}): string {
  _opts('toObj', options)
  const { tolerance = null, angle = 15.0 } = options
  const lines = ['# smlibwasm']
  let offset = 1
  _meshes(shapes, tolerance, angle).forEach(([item, m], i) => {
    lines.push(`o ${(item as Any).name || `part_${i + 1}`}`)
    const v = m.vertices
    for (let j = 0; j < v.length; j += 3) lines.push(`v ${_pyG(v[j], 9)} ${_pyG(v[j + 1], 9)} ${_pyG(v[j + 2], 9)}`)
    const t = m.triangles
    for (let j = 0; j < t.length; j += 3) lines.push(`f ${t[j] + offset} ${t[j + 1] + offset} ${t[j + 2] + offset}`)
    offset += v.length / 3
  })
  return `${lines.join('\n')}\n`
}

/** Wavefront OBJ export (one object per part). */
export function exportObj(shapes: unknown, path: string, options: MeshOptions = {}): void {
  _opts('exportObj', options)
  const fs = _fs()
  fs.writeFileSync(String(path), toObj(shapes, options))
}

// --------------------------------------------------------------------------------------- glTF 2.0
export const _DEFAULT_COLORS: readonly string[] = ['#7c93b5', '#d9925a', '#79ad73', '#c97878', '#9d87c7', '#d4b45a', '#6bb3b3', '#b08e6c']

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
  const { tolerance = null, angle = 15.0, edges = true, edgeColor = '#1f2328' } = options
  const chunks: Uint8Array[] = []
  let size = 0
  const views: Any[] = []
  const accessors: Any[] = []
  const meshes: Any[] = []
  const nodes: Any[] = []
  const materials: Any[] = []

  const addView = (arr: Float32Array, target: number | null): number => {
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

  // `arr`: rows of three numbers
  const addAccessor = (arr: Float32Array, kind: string, comp: number, target: number | null, minmax = false): number => {
    const view = addView(arr, target)
    const count = arr.length / 3
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
    const [r, g, b] = toRgb(color)
    const m: Any = {
      pbrMetallicRoughness: { baseColorFactor: [r, g, b, 1.0], metallicFactor: lines ? 0.0 : 0.05, roughnessFactor: lines ? 1.0 : 0.55 },
    }
    if (!lines) m.doubleSided = true
    materials.push(m)
    return materials.length - 1
  }

  const linePrim = (polylines: number[][][], mat: number): Any => {
    if (!polylines.length) throw new RangeError('need at least one array to concatenate')
    const segs: number[] = []
    for (const pl of polylines) for (let i = 0; i + 1 < pl.length; i++) segs.push(...pl[i], ...pl[i + 1])
    return { attributes: { POSITION: addAccessor(Float32Array.from(segs), 'VEC3', 5126, 34962, true) }, material: mat, mode: 1 }
  }

  const items = _flattenAll(shapes)
  let edgeMat: number | null = null
  let colorIndex = 0
  items.forEach((item, i) => {
    const name = (item as Any).name || `${_typeName(item).toLowerCase()}_${i + 1}`
    const prims: Any[] = []
    if (item instanceof Edge || item instanceof Wire) {
      const points = _curvePoints(item)
      prims.push(linePrim(points, material((item as Any).color || '#d9480f', true)))
    } else if (item instanceof Vertex) {
      const pts = Float32Array.from(item.point.toArray())
      prims.push({ attributes: { POSITION: addAccessor(pts, 'VEC3', 5126, 34962, true) }, material: material('#d9480f', true), mode: 0 })
    } else {
      const body = item instanceof Face ? item.toShell() : item
      // a face is meshed itself, facing out of its part; its copy gives the edges
      const m = body instanceof Mesh ? body : tessellate(item as Shape, tolerance, angle)
      const color = (body as Any).color || _DEFAULT_COLORS[colorIndex % _DEFAULT_COLORS.length]
      colorIndex += 1
      const tri = m.triangles
      const v = m.vertices
      const pos = new Float32Array(tri.length * 3)
      for (let c = 0; c < tri.length; c++) {
        pos[c * 3] = v[tri[c] * 3]
        pos[c * 3 + 1] = v[tri[c] * 3 + 1]
        pos[c * 3 + 2] = v[tri[c] * 3 + 2]
      }
      let nrm: Float32Array
      if (m.normals !== null) nrm = Float32Array.from(m.normals)
      else {
        const tn = m.triangleNormals
        nrm = new Float32Array(tri.length * 3)
        for (let f = 0; f < tn.length / 3; f++) for (let c = 0; c < 3; c++) nrm.set(tn.subarray(f * 3, f * 3 + 3), (f * 3 + c) * 3)
      }
      // unit normals, in single precision as numpy works on the float32 array
      const f32 = Math.fround
      for (let c = 0; c < nrm.length; c += 3) {
        const [x, y, z] = [nrm[c], nrm[c + 1], nrm[c + 2]]
        const ln = f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))))
        const d = ln > 0 ? ln : 1
        nrm[c] = x / d
        nrm[c + 1] = y / d
        nrm[c + 2] = z / d
      }
      prims.push({
        attributes: { POSITION: addAccessor(pos, 'VEC3', 5126, 34962, true), NORMAL: addAccessor(nrm, 'VEC3', 5126, 34962) },
        material: material(color),
        mode: 4,
      })
      if (edges && body instanceof _Body) {
        const lines = _edgePolylines(body)
        if (lines.length) {
          if (edgeMat === null) edgeMat = material(edgeColor, true)
          prims.push(linePrim(lines, edgeMat))
        }
      }
    }
    meshes.push({ name, primitives: prims })
    nodes.push({ mesh: meshes.length - 1, name })
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
export function toGlb(shapes: unknown, options: GltfOptions = {}): Uint8Array {
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
export function exportGlb(shapes: unknown, path: string, options: GltfOptions = {}): void {
  _opts('exportGlb', options)
  const fs = _fs()
  fs.writeFileSync(String(path), toGlb(shapes, options))
}

/** glTF JSON of the shapes with the buffer embedded as a data URI (in meters, like `toGlb`). */
export function toGltf(shapes: unknown, options: GltfOptions = {}): string {
  _opts('toGltf', options)
  const [doc, buf] = gltfDocument(shapes, options)
  _zUp(doc, true)
  doc.buffers[0].uri = `data:application/octet-stream;base64,${_base64(buf)}`
  return JSON.stringify(doc)
}

/** glTF export with the buffer embedded as a data URI (in meters, like `exportGlb`). */
export function exportGltf(shapes: unknown, path: string, options: GltfOptions = {}): void {
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

/** The contents of an SMLib native `.smb` file of one body (exact and lossless; ASCII unless
 * `ascii` is false). */
export function toSmb(shapes: unknown, options: { ascii?: boolean } = {}): Uint8Array {
  _opts('toSmb', options)
  const { ascii = true } = options
  const items = _items(shapes)
  if (items.length !== 1) throw new RangeError('an .smb file holds one body; fuse the parts or save them separately')
  const body = items[0]
  if (!(body instanceof _Body)) throw new TypeError(`cannot save a ${_typeName(body)} as an .smb file`)
  const name = _tmpName()
  try {
    kernelCall('save', () => k.brep_write_to_file(body._brep, name, ascii))
    return module.FS.readFile(name) as Uint8Array
  } finally {
    _unlink(name)
  }
}

/** The body of an SMLib native `.smb` file's contents: a Part, or a Shell when it encloses no
 * volume. */
export function fromSmb(data: string | Uint8Array): Part | Shell {
  const name = _tmpName()
  let b: number
  try {
    module.FS.writeFile(name, _bytes(data))
    b = kernelCall('load', () => k.read_brep_from_file(name, null, false))
  } finally {
    _unlink(name)
  }
  const part = Part._wrap(b)
  if (!part.isValid()) {
    const shell = Shell._wrap(part._copyBrep())
    part.dispose()
    return shell
  }
  return part
}

/** Write a body to SMLib's native `.smb` format (exact and lossless). */
export function save(shapes: unknown, path: string, options: { ascii?: boolean } = {}): void {
  _opts('save', options)
  const fs = _fs()
  fs.writeFileSync(String(path), toSmb(shapes, options))
}

/**
 * Read a file, picking the format from the extension: STEP (`.step`, `.stp`), USD (`.usda`) and
 * SMLib (`.smb`) give exact parts, DXF (`.dxf`) a `Sketch` of the drawing's outlines, STL a `Mesh`.
 *
 * A STEP file with one body gives that part, one with several a `ShapeList`. A native file that
 * encloses no volume comes back as a `Shell`.
 */
export function load(path: string): Any {
  const p = String(path)
  const ext_ = _splitext(p)[1].toLowerCase()
  if (ext_ === '.step' || ext_ === '.stp' || ext_ === '.p21') return importStep(p)
  if (ext_ === '.stl') return importStl(p)
  if (ext_ === '.dxf') return importDxf(p)
  if (['.usda', '.usd', '.usdc', '.usdz'].includes(ext_)) return importUsd(p)
  if (ext_ !== '.smb') throw new RangeError(`unknown file type '${ext_}'; load reads .step, .stp, .stl, .smb, .dxf and .usda`)
  return fromSmb(_fs().readFileSync(p))
}
