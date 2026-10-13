// Triangle meshes: tessellation of exact shapes, mesh Booleans, mesh files.

import { ModelingError, PolyHandle, ext, k, kernelCall } from './kernel.ts'
import { BoundBox, Vector, _formatG } from './geometry.ts'
import { Face, ShapeList, _Body, _typeName, type Shape } from './shapes.ts'
import { exportFile } from './exporters.ts'

const inspect = Symbol.for('nodejs.util.inspect.custom')

/**
 * An indexed triangle mesh.
 *
 * - `vertices`: positions, x, y, z for each vertex (`Float64Array`).
 * - `triangles`: three vertex indices for each triangle, counterclockwise seen from outside
 *   (`Uint32Array`).
 * - `normals`: optional corner normals, three for each triangle (nine numbers per triangle,
 *   `Float32Array`), used for shading crisp CAD edges.
 */
export class Mesh {
  vertices: Float64Array
  triangles: Uint32Array
  normals: Float32Array | null
  _poly: PolyHandle | null

  constructor(vertices: ArrayLike<number>, triangles: ArrayLike<number>, normals: ArrayLike<number> | null = null, _poly: PolyHandle | null = null) {
    this.vertices = Float64Array.from(vertices)
    this.triangles = Uint32Array.from(triangles)
    this.normals = normals == null ? null : Float32Array.from(normals)
    this._poly = _poly
  }

  /** The number of triangles (Python's `len(mesh)`). */
  get length(): number {
    return this.triangles.length / 3
  }

  // -- measures -----------------------------------------------------------------------------
  /** One unit normal per triangle (x, y, z each). */
  get triangleNormals(): Float64Array {
    const v = this.vertices
    const t = this.triangles
    const out = new Float64Array(t.length)
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3]
      const ux = v[b] - v[a]
      const uy = v[b + 1] - v[a + 1]
      const uz = v[b + 2] - v[a + 2]
      const wx = v[c] - v[a]
      const wy = v[c + 1] - v[a + 1]
      const wz = v[c + 2] - v[a + 2]
      const nx = uy * wz - uz * wy
      const ny = uz * wx - ux * wz
      const nz = ux * wy - uy * wx
      const ln = Math.hypot(nx, ny, nz) || 1
      out[i] = nx / ln
      out[i + 1] = ny / ln
      out[i + 2] = nz / ln
    }
    return out
  }

  get area(): number {
    const v = this.vertices
    const t = this.triangles
    let s = 0
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3]
      const ux = v[b] - v[a]
      const uy = v[b + 1] - v[a + 1]
      const uz = v[b + 2] - v[a + 2]
      const wx = v[c] - v[a]
      const wy = v[c + 1] - v[a + 1]
      const wz = v[c + 2] - v[a + 2]
      s += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx)
    }
    return 0.5 * s
  }

  /** Enclosed volume (meaningful for closed meshes). */
  get volume(): number {
    const v = this.vertices
    const t = this.triangles
    let s = 0
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3]
      // a . (b x c)
      s += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) + v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])
    }
    return s / 6
  }

  bbox(): BoundBox {
    const v = this.vertices
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < v.length; i += 3) {
      for (let j = 0; j < 3; j++) {
        lo[j] = Math.min(lo[j], v[i + j])
        hi[j] = Math.max(hi[j], v[i + j])
      }
    }
    if (!v.length) throw new RangeError('an empty mesh has no bounding box')
    return new BoundBox(lo, hi)
  }

  center(): Vector {
    return this.bbox().center
  }

  // -- mesh Booleans (kernel polygon Booleans) ----------------------------------------------
  _polyBrep(): number {
    if (this._poly !== null && this._poly.poly) return this._poly.poly
    throw new TypeError('mesh Booleans need meshes produced by tessellate()')
  }

  _bool(other: Mesh, op: number, name: string): Mesh {
    const r = kernelCall(`mesh ${name}`, () => {
      const a = k.poly_copy(this._polyBrep())
      const b = k.poly_copy(other._polyBrep())
      return k.poly_boolean(a, b, op)
    })
    const result = Mesh._fromPoly(r)
    // The kernel's mesh Booleans often return open or wrong meshes (faces that should get a hole
    // stay whole). Check what can be checked: closed, and a volume the operation can give.
    const va = this.volume
    const vb = other.volume
    const v = result.volume
    let lo: number
    let hi: number
    if (op === k.PolyBooleanOp.UNION) [lo, hi] = [Math.max(va, vb), va + vb]
    else if (op === k.PolyBooleanOp.DIFFERENCE) [lo, hi] = [Math.max(0, va - vb), va]
    else [lo, hi] = [0, Math.min(va, vb)]
    const slack = 1e-6 * (Math.abs(va) + Math.abs(vb))
    let problem: string | null = null
    if (!this.isClosed() || !other.isClosed()) problem = null // open operands: nothing to compare with
    else if (!result.isClosed()) problem = `an open mesh (${result._openEdgeCount()} open edges)`
    else if (!(lo - slack <= v && v <= hi + slack)) problem = `a volume of ${_formatG(v)}, where ${_formatG(lo)} to ${_formatG(hi)} is possible`
    if (problem !== null) {
      const method = ({ union: 'fuse', difference: 'cut' } as Record<string, string>)[name] ?? 'intersect'
      throw new ModelingError(
        `mesh ${name}: the kernel's mesh Boolean returned ${problem}; do the Boolean on the exact parts and tessellate the result: partA.${method}(partB).mesh()`,
      )
    }
    return result
  }

  _openEdgeCount(): number {
    const t = this.triangles
    if (t.length === 0) return 0
    const v = this.vertices
    let size = 0
    for (let i = 0; i < v.length; i++) size = Math.max(size, Math.abs(v[i]))
    if (!v.length) size = 1
    const scale = Math.max(size, 1e-300)
    // vertices that round to the same point (9 digits of the size) are one
    const ids = new Map<string, number>()
    const id = new Int32Array(v.length / 3)
    const r9 = (x: number) => {
      const r = Math.round((x / scale) * 1e9) / 1e9
      return r === 0 ? 0 : r
    }
    for (let i = 0; i < id.length; i++) {
      const key = `${r9(v[i * 3])},${r9(v[i * 3 + 1])},${r9(v[i * 3 + 2])}`
      let n = ids.get(key)
      if (n === undefined) {
        n = ids.size
        ids.set(key, n)
      }
      id[i] = n
    }
    const counts = new Map<string, number>()
    for (let i = 0; i < t.length; i += 3) {
      const tri = [id[t[i]], id[t[i + 1]], id[t[i + 2]]]
      for (const [p, q] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
        if (p === q) continue
        const key = p < q ? `${p},${q}` : `${q},${p}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    let open = 0
    for (const c of counts.values()) if (c !== 2) open++
    return open
  }

  /** True if every edge of the mesh is shared by exactly two triangles (a watertight mesh). */
  isClosed(): boolean {
    return this._openEdgeCount() === 0
  }

  /** The kernel's mesh union (Python's `+`). */
  fuse(other: Mesh): Mesh {
    return this._bool(other, k.PolyBooleanOp.UNION, 'union')
  }

  /** The kernel's mesh difference (Python's `-`). */
  cut(other: Mesh): Mesh {
    return this._bool(other, k.PolyBooleanOp.DIFFERENCE, 'difference')
  }

  /** The kernel's mesh intersection (Python's `&`). */
  intersect(other: Mesh): Mesh {
    return this._bool(other, k.PolyBooleanOp.INTERSECTION, 'intersection')
  }

  // -- construction -------------------------------------------------------------------------
  static _fromPoly(poly: number, normals = true): Mesh {
    const handle = new PolyHandle(poly)
    const arr = k.poly_mesh(poly, normals)
    const pts = Float64Array.from(arr.points as Float32Array)
    const [tris, cornerIdx] = _triangulate(arr.faces as Int32Array)
    let n: Float32Array | null = null
    if (normals) {
      const cn = arr.normals as Float32Array
      let max = -1
      for (let i = 0; i < cornerIdx.length; i++) max = Math.max(max, cornerIdx[i])
      if (cn.length / 3 === max + 1) {
        n = new Float32Array(cornerIdx.length * 3)
        for (let i = 0; i < cornerIdx.length; i++) {
          const c = cornerIdx[i] * 3
          n[i * 3] = cn[c]
          n[i * 3 + 1] = cn[c + 1]
          n[i * 3 + 2] = cn[c + 2]
        }
      }
    }
    return new Mesh(pts, tris, n, handle)
  }

  /** Write the mesh to a file (stl, obj, glb, ...; see `exportFile`). */
  export(path: string, options: Record<string, unknown> = {}): void {
    exportFile(this, path, options)
  }

  toString(): string {
    return `Mesh(${this.vertices.length / 3} vertices, ${this.triangles.length / 3} triangles)`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** A VTK-style polygon list (n, i0, ..., n, ...) as triangles (a fan per polygon) and, per
 * triangle corner, the index of its polygon corner. */
export function _triangulate(faces: ArrayLike<number>): [Uint32Array, Uint32Array] {
  const n = faces.length
  // fast path: all triangles
  let allTriangles = n % 4 === 0
  for (let i = 0; allTriangles && i < n; i += 4) if (faces[i] !== 3) allTriangles = false
  if (allTriangles) {
    const tris = new Uint32Array((n / 4) * 3)
    const idx = new Uint32Array((n / 4) * 3)
    for (let f = 0; f < n / 4; f++) {
      tris[f * 3] = faces[f * 4 + 1]
      tris[f * 3 + 1] = faces[f * 4 + 2]
      tris[f * 3 + 2] = faces[f * 4 + 3]
      idx[f * 3] = f * 3
      idx[f * 3 + 1] = f * 3 + 1
      idx[f * 3 + 2] = f * 3 + 2
    }
    return [tris, idx]
  }
  const tris: number[] = []
  const corners: number[] = []
  let i = 0
  let c = 0
  while (i < n) {
    const cnt = faces[i]
    for (let j = 1; j < cnt - 1; j++) {
      tris.push(faces[i + 1], faces[i + 1 + j], faces[i + 2 + j])
      corners.push(c, c + j, c + j + 1)
    }
    i += cnt + 1
    c += cnt
  }
  return [Uint32Array.from(tris), Uint32Array.from(corners)]
}

/**
 * Triangulate a shape.
 *
 * @param shape A part, sketch, shell or face (or a list of them). A face's mesh faces the way the
 *   face does in its body's mesh (out of a part).
 * @param tolerance Maximum distance between mesh and exact surface. Default: 0.1 % of the bounding
 *   box diagonal.
 * @param angle Maximum angle (degrees) between neighbouring triangle normals on curved faces.
 *
 * The kernel cuts each face into a grid whose lines it places by the curves along the face's
 * borders. A face that is straight in one direction and twisted along it (the sides of a twisted
 * bar, a ruled loft between different curves, the walls of a thickened free-form sheet) gets no
 * lines across, so a body with such a face is divided by halving its faces until every part is
 * flat within the tolerance: more triangles, but within the tolerance. Other bodies get the
 * grid's triangles.
 */
export function tessellate(shape: Shape | Iterable<Shape>, tolerance: number | null = null, angle = 15): Mesh {
  if (shape instanceof ShapeList) return merge(shape.map((s) => tessellate(s as Shape, tolerance, angle)))
  let body: unknown = shape
  let turned = false
  if (body instanceof Face) {
    // A face is meshed as a copy in a sheet of its own, which faces where the face's surface
    // normal points: the mesh of a face whose surface normal points into its body is turned.
    turned = !body._naturalIsOutward()
    body = body.toShell()
  }
  if (!(body instanceof _Body)) throw new TypeError(`cannot tessellate a ${_typeName(body)}`)
  const b = body
  const tol = tolerance ?? Math.max(b.bbox().diagonal * 1e-3, 1e-6)
  if (!(tol > 0) || !(angle > 0)) throw new RangeError('tessellate: tolerance and angle must be positive')
  // (the kernel's own tessellate always uses the grid)
  const poly = kernelCall(
    'tessellate',
    () =>
      ext.tessellate(b._brep, {
        chord_height_tolerance: Number(tol),
        curve_angle_tolerance_deg: Number(angle),
        surface_angle_tolerance_deg: Number(angle),
      }),
  )
  const mesh = Mesh._fromPoly(poly)
  if (turned) {
    // the kernel's mesh behind it (for mesh Booleans) stays as it is
    const t = mesh.triangles
    for (let i = 0; i < t.length; i += 3) [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]]
    const nm = mesh.normals
    if (nm !== null) {
      for (let i = 0; i < nm.length; i += 9) {
        for (let j = 0; j < 3; j++) {
          const a = nm[i + 3 + j]
          nm[i + 3 + j] = -nm[i + 6 + j]
          nm[i + 6 + j] = -a
          nm[i + j] = -nm[i + j]
        }
      }
    }
  }
  return mesh
}

/** Concatenate meshes (no Boolean). */
export function merge(meshes: readonly Mesh[]): Mesh {
  const verts: number[] = []
  const tris: number[] = []
  const norms: number[] = []
  let off = 0
  for (const m of meshes) {
    for (const x of m.vertices) verts.push(x)
    for (const t of m.triangles) tris.push(t + off)
    if (m.normals !== null) for (const x of m.normals) norms.push(x)
    else {
      const tn = m.triangleNormals
      for (let i = 0; i < tn.length; i += 3) for (let c = 0; c < 3; c++) norms.push(tn[i], tn[i + 1], tn[i + 2])
    }
    off += m.vertices.length / 3
  }
  return new Mesh(verts, tris, norms)
}
