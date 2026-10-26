// Triangle meshes: tessellation of exact shapes, mesh Booleans, mesh files.

import { ModelingError, PolyHandle, _crashOf, _isCrash, _opts, _warn, ext, k, kernelCall } from './kernel.ts'
import { Axis, BoundBox, Hit, Location, Plane, Vector, Z, _direction, _formatG, _vec, type Matrix, type VectorLike } from './geometry.ts'
import { Face, MassProperties, Part, ShapeList, Wire, _Body, _asPlane, _list, _reflection, _scaling, _translation, _typeName, type Shape } from './shapes.ts'
import { Polyline } from './curves.ts'
import { type FileOptions, exportFile } from './exporters.ts'
import { _repr } from './step_reader.ts'

const inspect = Symbol.for('nodejs.util.inspect.custom')

/**
 * An indexed triangle mesh.
 *
 * - `vertices`: positions, x, y, z for each vertex (`Float64Array`).
 * - `triangles`: three vertex indices for each triangle, counterclockwise seen from outside
 *   (`Uint32Array`).
 * - `normals`: optional corner normals, three for each triangle (nine numbers per triangle,
 *   `Float32Array`), used for shading crisp CAD edges.
 *
 * A mesh is its arrays: the kernel's mesh it came from is freed once they are copied out, and mesh
 * Booleans build one from the arrays when they need it. `dispose()` (or `using`) frees what a mesh
 * still holds in the kernel at once. The arrays can be changed in place; `translate`, `rotate`,
 * `mirror`, `scale` and `moved` return moved copies, as for shapes.
 *
 * Meshes of scans and STL files: `section` and `slices` cut them, `decimate` thins them out,
 * `fillHoles` and `repaired` close them, `massProperties` measures what they enclose and `toPart`
 * makes a faceted part of them.
 */
/** What `Mesh.repaired` did. */
export class RepairReport {
  /** Points that lay on each other (to 1e-9 of the largest coordinate), merged. */
  readonly mergedVertices: number
  /** Triangles without an area, and repeated ones, left out. */
  readonly removedTriangles: number
  /** Triangles turned to face the way their neighbours face (a closed piece outward). */
  readonly flippedTriangles: number
  /** Holes filled (as `Mesh.fillHoles`). */
  readonly filledHoles: number
  /** Borders that do not close on themselves, left open. */
  readonly openHoles: number
  /** Edges of the result not shared by two triangles: 0 for a closed mesh. */
  readonly openEdges: number

  constructor(mergedVertices: number, removedTriangles: number, flippedTriangles: number, filledHoles: number, openHoles: number, openEdges: number) {
    this.mergedVertices = mergedVertices
    this.removedTriangles = removedTriangles
    this.flippedTriangles = flippedTriangles
    this.filledHoles = filledHoles
    this.openHoles = openHoles
    this.openEdges = openEdges
  }
}

export class Mesh {
  /** The points, an array of [x, y, z]. */
  vertices: Float64Array
  /** The triangles, as indices into `vertices`. */
  triangles: Uint32Array
  /** A normal at each point, or null. */
  normals: Float32Array | null
  _poly: PolyHandle | null
  _key: string | null

  constructor(vertices: ArrayLike<number>, triangles: ArrayLike<number>, normals: ArrayLike<number> | null = null, _poly: PolyHandle | null = null) {
    this.vertices = Float64Array.from(vertices)
    this.triangles = Uint32Array.from(triangles)
    this.normals = normals == null ? null : Float32Array.from(normals)
    this._poly = _poly
    this._key = _poly !== null ? this._fingerprint() : null
  }

  /** What tells the arrays apart: their lengths and checksums. */
  _fingerprint(): string {
    const sum = (a: Float64Array | Uint32Array): number => {
      const words = new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4)
      let h = 0x811c9dc5
      for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x01000193)
      return h >>> 0
    }
    return `${this.vertices.length}:${this.triangles.length}:${sum(this.vertices)}:${sum(this.triangles)}`
  }

  /** The number of triangles (Python's `len(mesh)`). */
  get length(): number {
    return this.triangles.length / 3
  }

  /** Frees the kernel's copy of the mesh now, if it holds one (an internal tessellation can keep
   * it). The arrays stay, and the mesh stays usable: a mesh Boolean builds the kernel's mesh from
   * them again. */
  dispose(): void {
    const poly = this._poly
    this._poly = null
    poly?.dispose()
  }

  [Symbol.dispose](): void {
    this.dispose()
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
      const ln = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1 // as numpy's norm
      out[i] = nx / ln
      out[i + 1] = ny / ln
      out[i + 2] = nz / ln
    }
    return out
  }

  /** The total area of the triangles. */
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
      const [cx, cy, cz] = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]
      s += Math.sqrt(cx * cx + cy * cy + cz * cz) // as numpy's norm
    }
    return 0.5 * s
  }

  /** Enclosed volume (meaningful for closed meshes). */
  get volume(): number {
    const t = this.triangles
    if (!t.length) return 0
    // (the triple products about the middle of the box: about the origin, a mesh far from it lost
    // digits, 1113.1204 for 1113.121 at 1e6 mm)
    const m = this.bbox().center
    const v = Float64Array.from(this.vertices, (x, i) => x - (i % 3 === 0 ? m.x : i % 3 === 1 ? m.y : m.z))
    let s = 0
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3]
      // a . (b x c)
      s += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) + v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])
    }
    return s / 6
  }

  /** The box along the axes around the mesh's points; RangeError for an empty mesh. */
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

  /** The middle of the bounding box (`centroid` is the center of mass). */
  center(): Vector {
    return this.bbox().center
  }

  /** The center of mass of the volume a closed mesh encloses (uniform density); see
   * `massProperties`. */
  get centroid(): Vector {
    return this.massProperties().center
  }

  /**
   * Mass, center of mass and inertia tensor of the volume a closed mesh encloses, for a uniform
   * `density` (as `Part.massProperties`, a `MassProperties`).
   *
   * Exact for the triangles: each spans a tetrahedron with a point, and their integrals add up (the
   * divergence theorem). The mesh must be closed and face outward (ModelingError otherwise: close it
   * with `fillHoles` or `repaired`); an empty mesh throws a RangeError.
   */
  massProperties(density = 1.0): MassProperties {
    if (!(density > 0)) throw new RangeError('massProperties: the density must be positive')
    if (!this.triangles.length) throw new RangeError('an empty mesh has no mass properties')
    if (!this.isClosed()) {
      throw new ModelingError(`massProperties: the mesh is open (${this._openEdgeCount()} open edges), so it encloses no volume; close it first: mesh.fillHoles() or mesh.repaired()`)
    }
    const box = this.bbox()
    const ref = box.min.add(box.max).div(2).toArray() // (a point near the mesh: fewer digits lost)
    const v = this.vertices
    const t = this.triangles
    let det6 = 0
    const first = [0, 0, 0]
    const second = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    for (let i = 0; i < t.length; i += 3) {
      const a = [0, 1, 2].map((j) => v[t[i] * 3 + j] - ref[j])
      const b = [0, 1, 2].map((j) => v[t[i + 1] * 3 + j] - ref[j])
      const c = [0, 1, 2].map((j) => v[t[i + 2] * 3 + j] - ref[j])
      // six times the volume of the tetrahedron (ref, a, b, c)
      const det = a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])
      det6 += det
      const sum = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]
      for (let j = 0; j < 3; j++) first[j] += (det * sum[j]) / 24
      // the integral of x x^T over the tetrahedron: its volume / 20 * (a a^T + b b^T + c c^T + s s^T)
      for (let j = 0; j < 3; j++) {
        for (let m = 0; m < 3; m++) second[j * 3 + m] += (det / 120) * (a[j] * a[m] + b[j] * b[m] + c[j] * c[m] + sum[j] * sum[m])
      }
    }
    const volume = det6 / 6
    if (!(volume > 0)) throw new ModelingError(`massProperties: the mesh encloses a volume of ${_formatG(volume)}: its triangles face inward (mesh.repaired() turns them outward)`)
    const d = first.map((x) => x / volume) // the centroid relative to ref
    const trace = second[0] + second[4] + second[8]
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
    const inertia = [0, 1, 2].map((i) =>
      [0, 1, 2].map((j) => density * ((i === j ? trace : 0) - second[i * 3 + j] - volume * ((i === j ? dd : 0) - d[i] * d[j]))),
    )
    return new MassProperties(density * volume, volume, this.area, new Vector(ref[0] + d[0], ref[1] + d[1], ref[2] + d[2]), inertia, density)
  }

  // -- placement (copies, as for shapes) ----------------------------------------------------
  _transformed(m: Matrix): Mesh {
    const v = this.vertices
    const vertices = new Float64Array(v.length)
    for (let i = 0; i < v.length; i += 3) {
      for (let r = 0; r < 3; r++) vertices[i + r] = m[r * 4] * v[i] + m[r * 4 + 1] * v[i + 1] + m[r * 4 + 2] * v[i + 2] + m[r * 4 + 3]
    }
    const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
    const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6])
    const turned = det < 0 // a reflection: the winding turns too, to stay outward
    const triangles = Uint32Array.from(this.triangles)
    if (turned) for (let i = 0; i < triangles.length; i += 3) [triangles[i], triangles[i + 2]] = [triangles[i + 2], triangles[i]]
    let normals: Float32Array | null = null
    if (this.normals !== null) {
      // normals take the inverse transpose: the cofactors of the matrix (its scale drops out)
      const c = [
        a[4] * a[8] - a[5] * a[7], a[5] * a[6] - a[3] * a[8], a[3] * a[7] - a[4] * a[6],
        a[2] * a[7] - a[1] * a[8], a[0] * a[8] - a[2] * a[6], a[1] * a[6] - a[0] * a[7],
        a[1] * a[5] - a[2] * a[4], a[2] * a[3] - a[0] * a[5], a[0] * a[4] - a[1] * a[3],
      ]
      const n = this.normals
      normals = new Float32Array(n.length)
      for (let t = 0; t < n.length; t += 9) {
        for (let corner = 0; corner < 3; corner++) {
          const i = t + corner * 3
          const o = t + (turned ? 2 - corner : corner) * 3
          const x = c[0] * n[i] + c[1] * n[i + 1] + c[2] * n[i + 2]
          const y = c[3] * n[i] + c[4] * n[i + 1] + c[5] * n[i + 2]
          const z = c[6] * n[i] + c[7] * n[i + 1] + c[8] * n[i + 2]
          const s = (det < 0 ? -1 : 1) / (Math.hypot(x, y, z) || 1)
          normals[o] = x * s
          normals[o + 1] = y * s
          normals[o + 2] = z * s
        }
      }
    }
    return new Mesh(vertices, triangles, normals)
  }

  /** A copy placed by `location`. */
  moved(location: Location): Mesh {
    return this._transformed(location._m)
  }

  /** A copy moved by `(x, y, z)`. */
  translate(x: number | VectorLike = 0, y = 0, z = 0): Mesh {
    return this._transformed(_translation(x, y, z))
  }

  /** A copy rotated by `angle` degrees about `axis`. */
  rotate(axis: Axis = Z, angle = 0): Mesh {
    return this._transformed(Location.about(axis, angle)._m)
  }

  /** A mirrored copy (reflection in `plane`, a plane or a planar face; by default the XZ plane,
   * which flips Y). The triangles keep facing outward. */
  mirror(plane: Plane | Face | Axis | ShapeList<Face> = Plane.XZ): Mesh {
    return this._transformed(_reflection(plane))
  }

  /** A scaled copy. `factor` is a number or per-axis factors `[sx, sy, sz]`, none of them zero
   * (RangeError). */
  scale(factor: number | VectorLike, center: VectorLike = [0, 0, 0]): Mesh {
    return this._transformed(_scaling(factor, center))
  }

  // -- mesh Booleans (kernel polygon Booleans) ----------------------------------------------
  /**
   * A new kernel mesh of this one, for the caller to own: a copy of the tessellation's where the
   * mesh keeps it and its arrays are still the ones it was made from (they can be changed in
   * place), else built from the triangles, stitched along the edges they share.
   */
  _kernelMesh(): number {
    if (this._poly !== null && this._poly.poly && this._key === this._fingerprint()) return k.poly_copy(this._poly.poly)
    if (!this.triangles.length) throw new RangeError('mesh Booleans need triangles: this mesh has none')
    return kernelCall('mesh', () => ext.poly_from_triangles(this.vertices, this.triangles), 'the mesh may have no triangle with an area')
  }

  _bool(other: Mesh, op: number, name: string): Mesh {
    const r = kernelCall(`mesh ${name}`, () => {
      // (the Boolean consumes its operands)
      const a = this._kernelMesh()
      const b = other._kernelMesh()
      const r = k.poly_boolean(a, b, op)
      ext.triangulate_poly(r) // (its polygons with holes: the mesh arrays take only outer loops)
      return r
    })
    const result = Mesh._fromPoly(r, false) // (the kernel gives a Boolean's result no normals)
    result.normals = _transferredNormals(result, [this, other])
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

  /**
   * Where a ray meets the mesh's triangles, nearest first (`Hit`: point, distance from the start,
   * the triangle's normal and its index `triangle`). As `Part.raycast`, on the triangles instead
   * of the exact faces.
   */
  raycast(origin: VectorLike | Axis, direction: VectorLike | Axis | null = null): Hit<null>[] {
    let o: Vector
    let d: Vector
    if (origin instanceof Axis && direction == null) {
      o = origin.origin
      d = origin.direction.normalized()
    } else if (direction == null) {
      throw new TypeError('raycast takes an origin and a direction, or an axis')
    } else {
      o = _vec(origin as VectorLike)
      d = _direction(direction, 'raycast')
    }
    if (!this.triangles.length) return []
    const b = this.bbox()
    const size = b.max.sub(b.min).length
    const tol = 1e-9 * Math.max(size, o.length, 1e-300)
    const [ts, tris] = _rayTriangles(o, d, this.vertices, this.triangles, tol)
    const normals = this.triangleNormals
    const order = Array.from(ts.keys()).sort((i, j) => ts[i] - ts[j] || tris[i] - tris[j])
    const out: Hit<null>[] = []
    for (const i of order) {
      const t = ts[i]
      if (out.length && t - out[out.length - 1].distance <= 1e-9 * Math.max(size, 1)) continue // (through an edge or a corner: one hit)
      const n = tris[i]
      out.push(new Hit(o.add(d.mul(Math.max(t, 0))), Math.max(t, 0), new Vector(normals[3 * n], normals[3 * n + 1], normals[3 * n + 2]), null, n))
    }
    return out
  }

  /**
   * The first hit of each of many rays, one per ray (a `Hit` or `null`), not `raycast` many times
   * (which gives every hit of a ray): for each origin, the `Hit` that `raycast` gives first (the
   * point, the distance, the triangle's normal and its index `triangle`), `null` where the ray
   * misses.
   *
   * `origins` are points; `directions` one direction (a vector or an axis) for all of them, or one
   * each. The kernel's ray tracer sorts the triangles into a grid once per call (0.8 s for 250 000
   * triangles) and then takes about 0.01 ms a ray, where `raycast` tests every triangle: give all
   * the rays in one call.
   */
  raycastMany(origins: Iterable<VectorLike>, directions: VectorLike | Axis | Iterable<VectorLike | Axis>): (Hit<null> | null)[] {
    const [o, d] = _rays(origins, directions, 'raycastMany')
    const n = o.length / 3
    if (!n || !this.triangles.length) return Array.from({ length: n }, () => null)
    const b = this.bbox()
    const size = b.max.sub(b.min).length
    // (hits a hair behind the start count, as for raycast: the rays start that much earlier)
    const tol = new Float64Array(n)
    const start = new Float64Array(o.length)
    for (let i = 0; i < n; i++) {
      tol[i] = 1e-9 * Math.max(size, Math.hypot(o[3 * i], o[3 * i + 1], o[3 * i + 2]), 1e-300)
      for (let j = 0; j < 3; j++) start[3 * i + j] = o[3 * i + j] - d[3 * i + j] * tol[i]
    }
    const r = kernelCall('raycastMany', () => ext.mesh_first_hits(this.vertices, this.triangles, start, d))
    const out: (Hit<null> | null)[] = []
    for (let i = 0; i < n; i++) {
      const tri = r.triangles[i]
      if (tri < 0) {
        out.push(null)
        continue
      }
      const t = Math.max(r.t[i] - tol[i], 0)
      const point = new Vector(o[3 * i] + d[3 * i] * t, o[3 * i + 1] + d[3 * i + 1] * t, o[3 * i + 2] + d[3 * i + 2] * t)
      out.push(new Hit<null>(point, t, new Vector(r.normals[3 * i], r.normals[3 * i + 1], r.normals[3 * i + 2]), null, tri))
    }
    return out
  }

  /** True if every edge of the mesh is shared by exactly two triangles (a watertight mesh). */
  isClosed(): boolean {
    return this._openEdgeCount() === 0
  }

  // -- sections -----------------------------------------------------------------------------
  /**
   * Where the plane cuts the mesh: polylines (wires of straight edges) through the points where its
   * triangles cross the plane, chained into loops, the longest first.
   *
   * Of a closed mesh every loop is closed, outer loops counterclockwise seen from the plane's normal
   * and holes clockwise (as the faces of `Part.section`); an open mesh can give open polylines too.
   * `makeFace(loop)` makes a face of a closed loop. Points where the cut runs straight on are left
   * out. A plane through a flat part of the mesh (the top face of a box's mesh) cuts it just beside
   * that, on the side where the cut encloses more. Empty where the plane misses the mesh.
   */
  section(plane: Plane | Face = Plane.XY): ShapeList<Wire> {
    return _list(_sectionWires(this.vertices, this.triangles, _asPlane(plane)))
  }

  /**
   * Sections (`section`) across `axis`, `step` apart: the mesh cut into layers of thickness `step`
   * from its lowest point along the axis up, each cut in its middle (at `step / 2`, `3 * step / 2`,
   * ... above the lowest point; the contours of a printer's layers). Layers whose plane cuts
   * nothing are left out.
   */
  slices(step: number, axis: Axis | VectorLike = Z): ShapeList<Wire>[] {
    const d = _direction(axis, 'slices')
    if (!(step > 0)) throw new RangeError('slices: the step must be positive')
    if (!this.triangles.length) return []
    const v = this.vertices
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i] * d.x + v[i + 1] * d.y + v[i + 2] * d.z
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
    const out: ShapeList<Wire>[] = []
    for (const level of _levels(lo, hi, step)) {
      const wires = _sectionWires(this.vertices, this.triangles, new Plane(d.mul(level), null, d))
      if (wires.length) out.push(_list(wires))
    }
    return out
  }

  // -- decimation and repair ----------------------------------------------------------------
  /**
   * A mesh with fewer triangles, as near to this one as the kernel's quadric decimation
   * (SmPolyDecimate) keeps it: it collapses the edges whose removal changes the shape least first,
   * keeps a closed mesh closed and keeps the border of an open one.
   *
   * Give one of:
   *
   * - `fraction`: the share of the triangles to remove (`0.9` leaves a tenth).
   * - `triangles`: about how many triangles to leave.
   * - `tolerance`: how far the result may be from this mesh at most. The mesh is decimated step by
   *   step while the distance stays within it (measured at the points of both meshes and the
   *   middles of their triangles), so this takes a few decimations (seconds for 100 000 triangles).
   *
   * `featureAngle` (degrees, 0 to 180, default 30): edges where the triangles turn by more than it
   * are features, which the decimation keeps longest, and stay sharp in the result's normals (at each
   * corner the average of the triangles around it, except across such edges). Triangles the
   * decimation leaves folded over (slivers facing against their neighbours) are taken out.
   * ModelingError if a closed mesh comes back open, or
   * an open mesh with another border (a mesh whose points all lie on its border, such as a tube of
   * long triangles, cannot keep it), and where the kernel collapses the mesh far below the count
   * asked (it does with the long thin triangles of a coarse mesh of a cone: mesh such a part with a
   * larger tolerance instead). The kernel orders equal choices by memory, so the count can differ by
   * a few triangles from run to run.
   */
  decimate(fraction: number | null = null, options: { triangles?: number | null; tolerance?: number | null; featureAngle?: number } = {}): Mesh {
    _opts('Mesh.decimate', options, arguments.length)
    const triangles = options.triangles ?? null
    const tolerance = options.tolerance ?? null
    const angle = options.featureAngle ?? 30.0
    if ([fraction, triangles, tolerance].filter((x) => x != null).length !== 1) throw new TypeError('decimate takes one of fraction, triangles or tolerance')
    if (!(typeof angle === 'number' && angle >= 0 && angle <= 180)) throw new RangeError(`decimate: featureAngle is 0 to 180 degrees, got ${angle}`)
    const n = this.length
    if (fraction != null) {
      if (!(fraction > 0 && fraction < 1)) throw new RangeError('decimate: fraction is the share of the triangles to remove, between 0 and 1')
      return this._decimated(Number(fraction), null, angle)
    }
    if (triangles != null) {
      if (!(triangles >= 4)) throw new RangeError('decimate: a mesh needs 4 triangles or more')
      if (triangles >= n) return new Mesh(this.vertices, this.triangles, this.normals)
      return this._decimated(1 - triangles / n, null, angle)
    }
    if (!((tolerance as number) > 0)) throw new RangeError('decimate: the tolerance must be positive')
    let best = new Mesh(this.vertices, this.triangles, this.normals)
    let step = 0.5
    for (let i = 0; i < 40; i++) {
      if (step < 1 / 32 || best.length <= 8) break
      let trial: Mesh
      try {
        trial = best._decimated(step, this, angle)
      } catch (e) {
        if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
        step /= 2
        continue
      }
      if (trial.length >= best.length || _deviation(this, trial) > (tolerance as number)) {
        step /= 2
        continue
      }
      best = trial
    }
    return best
  }

  /** One run of the kernel's decimation, `fraction` of the points removed, edges sharper than `angle`
   * degrees features; checked against `original` (default: this mesh): closed where it was. */
  _decimated(fraction: number, original: Mesh | null = null, angle = 30.0): Mesh {
    if (!this.triangles.length) throw new RangeError('decimate: the mesh has no triangles')
    const r = kernelCall('decimate', () => ext.decimate_triangles(this.vertices, this.triangles, fraction, angle, true), 'is the mesh made of triangles with an area?')
    const v = r.vertices as Float64Array
    const t = r.triangles as Int32Array
    const result = new Mesh(v, t, t.length ? (ext.crease_normals(v, t, angle) as Float32Array) : null)
    const asked = this.length * (1 - fraction)
    if (result.length < 0.5 * asked) {
      throw new ModelingError(
        `decimate: the kernel's decimation collapsed the mesh to ${result.length} triangles, where about ${Math.floor(asked + 0.5)} were asked (it does so with meshes of long thin triangles, such as the flat faces of a coarse mesh of a part); mesh the part with a larger tolerance instead, or decimate a finer mesh`,
      )
    }
    const source = original ?? this
    const border = source._openEdgeCount()
    const left = result._openEdgeCount()
    if (!border && left) throw new ModelingError(`decimate: the decimation left the mesh open (${left} open edges); remove a smaller share`)
    if (border && left !== border) {
      throw new ModelingError(
        `decimate: the decimation changed the border of the open mesh (${border} open edges, then ${left}): the kernel keeps a border only where the mesh has points inside it`,
      )
    }
    return result
  }

  /**
   * A copy with every hole closed: each border of edges that only one triangle has, which closes on
   * itself, is filled with triangles (the kernel's triangulation of the polygon, also of one that is
   * not flat). The triangles of the mesh stay as they are; the new ones face as the triangles beside
   * them do. See `repaired`, which also merges points that lie on each other and turns triangles
   * that face the wrong way first.
   */
  fillHoles(): Mesh {
    const r = this._repair(false)
    const added: number[] = []
    for (let i = 0; i < r.sources.length; i++) if (r.sources[i] < 0) added.push(r.triangles[3 * i], r.triangles[3 * i + 1], r.triangles[3 * i + 2])
    const tris = new Uint32Array(this.triangles.length + added.length)
    tris.set(this.triangles)
    tris.set(added, this.triangles.length)
    return this._repairedMesh(r, tris, true)
  }

  /**
   * A repaired copy and what was done: points that lie on each other (to 1e-9 of the largest
   * coordinate) are merged, triangles left without an area and repeated ones are left out,
   * triangles are turned to face the way their neighbours face (a closed piece outward), and holes
   * are filled (as `fillHoles`).
   *
   * Returns `[mesh, report]`; the report counts `mergedVertices`, `removedTriangles`,
   * `flippedTriangles`, `filledHoles`, `openHoles` (borders that do not close on themselves, left
   * open) and `openEdges` (edges of the result not shared by two triangles: 0 for a closed mesh).
   */
  repaired(): [Mesh, RepairReport] {
    const r = this._repair(true)
    const mesh = this._repairedMesh(r, Uint32Array.from(r.triangles), false)
    const report = new RepairReport(r.merged_vertices, r.removed_triangles, r.flipped_triangles, r.filled_holes, r.open_holes, r.open_edges)
    return [mesh, report]
  }

  // biome-ignore lint: the binding's object
  _repair(clean: boolean): any {
    return kernelCall('repair', () => ext.repair_triangles(this.vertices, this.triangles, clean, true))
  }

  /** The mesh of a repair: this mesh's points and the new ones; the normals of triangles that come
   * from this mesh (turned with them), flat ones for new triangles. */
  // biome-ignore lint: the binding's object
  _repairedMesh(r: any, tris: Uint32Array, keepAll: boolean): Mesh {
    const nv = r.new_vertices as Float64Array
    const vertices = new Float64Array(this.vertices.length + nv.length)
    vertices.set(this.vertices)
    vertices.set(nv, this.vertices.length)
    let sources: number[] = Array.from(r.sources as Int32Array)
    if (keepAll) sources = [...Array.from({ length: this.length }, (_, i) => i), ...sources.filter((x) => x < 0)]
    let normals: Float32Array | null = null
    if (this.normals !== null) {
      const flat = _flatNormals(vertices, tris)
      normals = new Float32Array(tris.length * 3)
      const own = _flatNormals(this.vertices, this.triangles)
      const nm = this.normals
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i]
        if (src < 0) {
          for (let c = 0; c < 3; c++) normals.set(flat.subarray(3 * i, 3 * i + 3), 9 * i + 3 * c)
          continue
        }
        // (a triangle turned round has its last two corners swapped: its normals turn too)
        const same = flat[3 * i] * own[3 * src] + flat[3 * i + 1] * own[3 * src + 1] + flat[3 * i + 2] * own[3 * src + 2] >= 0
        for (let c = 0; c < 3; c++) {
          const from = same ? c : [0, 2, 1][c]
          for (let j = 0; j < 3; j++) normals[9 * i + 3 * c + j] = (same ? 1 : -1) * nm[9 * src + 3 * from + j]
        }
      }
    }
    if (!keepAll) {
      // (only the points the triangles use)
      const used = [...new Set(tris)].sort((a, b) => a - b)
      const local = new Map(used.map((vi, j) => [vi, j]))
      const out = new Float64Array(used.length * 3)
      used.forEach((vi, j) => out.set(vertices.subarray(vi * 3, vi * 3 + 3), j * 3))
      return new Mesh(out, tris.map((x) => local.get(x) as number), normals)
    }
    return new Mesh(vertices, tris, normals)
  }

  // -- parts --------------------------------------------------------------------------------
  /**
   * A faceted part of a closed mesh: a planar face for each triangle, where neighbouring triangles
   * that lie in one plane (the faces of a CAD part's mesh) make one face. Exact Booleans with other
   * parts, sections and STEP files work on it; its faces stay flat (no fillets of curved faces).
   *
   * Booleans get slow as faces add up (a sphere of 14 080 triangles took 40 s to cut by a box), so a
   * mesh that would give more than `maxFaces` faces throws a ModelingError: decimate it first
   * (`mesh.decimate(null, { triangles: 2000 }).toPart()`), or give a larger `maxFaces` (`0`: no
   * limit). An open mesh throws a ModelingError too (close it with `fillHoles` or `repaired`), and
   * so does one whose part is not a valid solid or does not enclose the mesh's volume.
   */
  toPart(maxFaces = 5000): Part {
    if (!Number.isInteger(maxFaces) || maxFaces < 0) throw new RangeError('toPart: maxFaces must be a whole number, 0 for no limit')
    if (!this.triangles.length) throw new RangeError('toPart: the mesh has no triangles')
    if (!this.isClosed()) {
      throw new ModelingError(`toPart: the mesh is open (${this._openEdgeCount()} open edges), and a part needs a closed one; close it first: mesh.fillHoles() or mesh.repaired()`)
    }
    const r = kernelCall('toPart', () => ext.brep_from_triangles(this.vertices, this.triangles, true, maxFaces), 'is the mesh closed, without triangles through each other?')
    if (!r.brep) {
      throw new ModelingError(
        `toPart: the part would get ${r.faces} faces, more than maxFaces=${maxFaces}, and Booleans on it would be slow; decimate the mesh first (mesh.decimate(null, { triangles: ${Math.max(Math.floor(maxFaces / 2), 4)} })) or give a larger maxFaces`,
      )
    }
    const part = Part._wrap(r.brep)
    if (!part.isValid()) {
      part.dispose()
      throw new ModelingError('toPart: the faceted part is not a valid solid (do triangles cross each other, or face inward?); mesh.repaired() turns them outward')
    }
    const v = part.volume
    const mv = this.volume
    if (Math.abs(v - mv) > 1e-6 * Math.abs(mv)) {
      part.dispose()
      throw new ModelingError(`toPart: the faceted part has a volume of ${_formatG(v, 10)}, the mesh ${_formatG(mv, 10)}`)
    }
    return part
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
  /** The mesh of a kernel PolyBrep, which it takes over: freed once the arrays are copied out, or
   * kept with the mesh (`keep`, for what needs the tessellation's own mesh: the faces of its
   * triangles, the curvature at its corners), which the caller then disposes. `brep` is the body it
   * was made from: corners where its surfaces have no normal (the apex of a cone) get the normal of
   * the surface next to them. */
  static _fromPoly(poly: number, normals = true, keep = false, brep: number | null = null): Mesh {
    const handle = new PolyHandle(poly)
    try {
      // (the points in double precision: k.poly_mesh, as Python's to_numpy_arrays, gives float32)
      const arr = ext.poly_arrays(poly, normals, brep)
      const pts = arr.points as Float64Array
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
      return new Mesh(pts, tris, n, keep ? handle : null)
    } finally {
      if (!keep) handle.dispose()
    }
  }

  /** Write the mesh to a file (stl, obj, glb, ...; see `exportFile`, whose options it takes). */
  export(path: string, options: FileOptions = {}): void {
    exportFile(this, path, options)
  }

  toString(): string {
    return `Mesh(${this.vertices.length / 3} vertices, ${this.triangles.length / 3} triangles)`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** Many rays as two flat arrays (x, y, z each): the origins and their unit directions (one
 * direction for all of them, a vector or an axis, or one each). */
export function _rays(origins: Iterable<VectorLike>, directions: VectorLike | Axis | Iterable<VectorLike | Axis>, what: string): [Float64Array, Float64Array] {
  if (origins == null || typeof (origins as Iterable<VectorLike>)[Symbol.iterator] !== 'function') throw new TypeError(`${what}: give the origins as points`)
  const points = [...origins].map((p) => _vec(p))
  const n = points.length
  const o = new Float64Array(3 * n)
  points.forEach((p, i) => o.set([p.x, p.y, p.z], 3 * i))
  if (!o.every(Number.isFinite)) throw new RangeError(`${what}: the origins must be finite`)
  const d = new Float64Array(3 * n)
  const one = directions instanceof Vector || directions instanceof Axis || typeof (directions as ArrayLike<unknown>)[0] === 'number'
  if (one) {
    const u = _direction(directions as VectorLike | Axis, what)
    for (let i = 0; i < n; i++) d.set([u.x, u.y, u.z], 3 * i)
  } else {
    const rows = [...(directions as Iterable<VectorLike | Axis>)]
    if (rows.length !== n) throw new RangeError(`${what}: give one direction for all origins, or one for each (${rows.length} for ${n})`)
    rows.forEach((x, i) => {
      const u = _direction(x, what)
      d.set([u.x, u.y, u.z], 3 * i)
    })
  }
  return [o, d]
}

/** A VTK-style polygon list (n, i0, ..., n, ...) as triangles (a fan per polygon) and, per
 * triangle corner, the index of its polygon corner. */
/**
 * Where the ray o + t d (t >= 0) crosses triangles (Moeller-Trumbore): the distances t and the
 * indices of the triangles.
 */
export function _rayTriangles(o: Vector, d: Vector, vertices: ArrayLike<number>, triangles: ArrayLike<number>, tol: number): [number[], number[]] {
  const ts: number[] = []
  const tris: number[] = []
  const v = vertices
  const eps = 1e-9
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i] * 3
    const b = triangles[i + 1] * 3
    const c = triangles[i + 2] * 3
    const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]]
    const e2 = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]]
    const p = [d.y * e2[2] - d.z * e2[1], d.z * e2[0] - d.x * e2[2], d.x * e2[1] - d.y * e2[0]]
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]
    const scale = Math.hypot(e1[0], e1[1], e1[2]) * Math.hypot(e2[0], e2[1], e2[2])
    if (!(Math.abs(det) > 1e-12 * (scale > 0 ? scale : 1))) continue
    const inv = 1 / det
    const s = [o.x - v[a], o.y - v[a + 1], o.z - v[a + 2]]
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
    const w = (q[0] * d.x + q[1] * d.y + q[2] * d.z) * inv
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv
    if (u >= -eps && w >= -eps && u + w <= 1 + eps && t >= -tol) {
      ts.push(t)
      tris.push(i / 3)
    }
  }
  return [ts, tris]
}

/** The unit normal of each triangle (x, y, z each; zero for one without an area). */
export function _flatNormals(vertices: ArrayLike<number>, triangles: ArrayLike<number>): Float64Array {
  const out = new Float64Array(triangles.length)
  const v = vertices
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i] * 3, triangles[i + 1] * 3, triangles[i + 2] * 3]
    const u = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]]
    const w = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]]
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const ln = Math.hypot(n[0], n[1], n[2]) || 1
    out.set([n[0] / ln, n[1] / ln, n[2] / ln], i)
  }
  return out
}

/**
 * Corner normals for the result of a mesh Boolean, which the kernel gives none: each of its
 * triangles lies on an operand (the one nearest to its middle, and of two as near the one whose
 * triangle there lies flattest on it), and each corner takes the normals of the operand's triangle
 * under a point just inside the result's triangle from it, where it lies on that triangle (turned
 * where that triangle faces the other way: the inside of a cut). The kernel merges the triangles of
 * a flat facet and splits the merged polygon anew, so a result triangle can span two operand
 * triangles. Null where the operands have no normals.
 */
export function _transferredNormals(result: Mesh, operands: readonly Mesh[]): Float32Array | null {
  const m = result.length
  if (!m || operands.every((o) => o.normals === null)) return null
  const v = result.vertices
  const t = result.triangles
  const rn = result.triangleNormals
  const mid = new Float64Array(3 * m)
  for (let i = 0; i < m; i++) for (let j = 0; j < 3; j++) mid[3 * i + j] = (v[t[3 * i] * 3 + j] + v[t[3 * i + 1] * 3 + j] + v[t[3 * i + 2] * 3 + j]) / 3
  const box = result.bbox()
  const size = Math.max(box.max.sub(box.min).length, 1e-300)
  const eps = 1e-9 * size
  const bestD = new Float64Array(m).fill(Infinity)
  const bestDot = new Float64Array(m)
  const bestOp = new Int32Array(m).fill(-1)
  operands.forEach((op, k) => {
    if (!op.length) return
    const near = ext.mesh_nearest_points(op.vertices, op.triangles, mid)
    const on = op.triangleNormals
    for (let i = 0; i < m; i++) {
      const tri = near.triangles[i]
      if (tri < 0) continue
      const d = near.distances[i]
      const dot = Math.abs(on[3 * tri] * rn[3 * i] + on[3 * tri + 1] * rn[3 * i + 1] + on[3 * tri + 2] * rn[3 * i + 2])
      if (d < bestD[i] - eps || (d <= bestD[i] + eps && dot > bestDot[i])) {
        bestD[i] = d
        bestDot[i] = dot
        bestOp[i] = k
      }
    }
  })
  const out = new Float32Array(9 * m)
  for (let i = 0; i < m; i++) for (let c = 0; c < 3; c++) out.set(rn.subarray(3 * i, 3 * i + 3), 9 * i + 3 * c)
  const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  operands.forEach((op, k) => {
    const sel: number[] = []
    for (let i = 0; i < m; i++) if (bestOp[i] === k && bestD[i] <= 1e-6 * size) sel.push(i)
    if (!sel.length) return
    // a point just inside the result's triangle from each corner
    const inside = new Float64Array(9 * sel.length)
    sel.forEach((i, s) => {
      for (let c = 0; c < 3; c++) for (let j = 0; j < 3; j++) {
        const x = v[t[3 * i + c] * 3 + j]
        inside[9 * s + 3 * c + j] = x + (mid[3 * i + j] - x) * 1e-3
      }
    })
    const near = ext.mesh_nearest_points(op.vertices, op.triangles, inside)
    const ov = op.vertices
    const ot = op.triangles
    const on = op.triangleNormals
    sel.forEach((i, s) => {
      for (let c = 0; c < 3; c++) {
        const src = near.triangles[3 * s + c]
        if (src < 0) continue
        const p = [0, 1, 2].map((q) => [ov[ot[3 * src + q] * 3], ov[ot[3 * src + q] * 3 + 1], ov[ot[3 * src + q] * 3 + 2]])
        const nn = [0, 1, 2].map((q) =>
          op.normals !== null ? [op.normals[9 * src + 3 * q], op.normals[9 * src + 3 * q + 1], op.normals[9 * src + 3 * q + 2]] : [on[3 * src], on[3 * src + 1], on[3 * src + 2]],
        )
        // the barycentric coordinates of the corner on its operand's triangle
        const e0 = [0, 1, 2].map((j) => p[1][j] - p[0][j])
        const e1 = [0, 1, 2].map((j) => p[2][j] - p[0][j])
        const d00 = dot3(e0, e0)
        const d01 = dot3(e0, e1)
        const d11 = dot3(e1, e1)
        const den = d00 * d11 - d01 * d01 || 1
        const w = [0, 1, 2].map((j) => v[t[3 * i + c] * 3 + j] - p[0][j])
        const d20 = dot3(w, e0)
        const d21 = dot3(w, e1)
        const bv = (d11 * d20 - d01 * d21) / den
        const bw = (d00 * d21 - d01 * d20) / den
        const b = [Math.max(1 - bv - bw, 0), Math.max(bv, 0), Math.max(bw, 0)]
        const sb = b[0] + b[1] + b[2] || 1
        const n = [0, 1, 2].map((j) => (b[0] * nn[0][j] + b[1] * nn[1][j] + b[2] * nn[2][j]) / sb)
        const turned = on[3 * src] * rn[3 * i] + on[3 * src + 1] * rn[3 * i + 1] + on[3 * src + 2] * rn[3 * i + 2] < 0
        const ln = (Math.hypot(n[0], n[1], n[2]) || 1) * (turned ? -1 : 1)
        out.set([n[0] / ln, n[1] / ln, n[2] / ln], 9 * i + 3 * c)
      }
    })
  })
  return out
}

/** The points of a mesh and the middles of its triangles (x, y, z each). */
function _samplePoints(m: Mesh): Float64Array {
  const v = m.vertices
  const t = m.triangles
  const out = new Float64Array(v.length + t.length)
  out.set(v)
  for (let i = 0; i < t.length; i += 3) for (let j = 0; j < 3; j++) out[v.length + i + j] = (v[t[i] * 3 + j] + v[t[i + 1] * 3 + j] + v[t[i + 2] * 3 + j]) / 3
  return out
}

/** How far two meshes are apart: the largest distance of the points of each, and of the middles of
 * its triangles, from the other. */
export function _deviation(a: Mesh, b: Mesh): number {
  if (!a.length || !b.length) throw new RangeError('decimate: a mesh without triangles')
  const d1 = ext.mesh_nearest_points(b.vertices, b.triangles, _samplePoints(a)).distances as Float64Array
  const d2 = ext.mesh_nearest_points(a.vertices, a.triangles, _samplePoints(b)).distances as Float64Array
  let worst = 0
  for (const d of d1) worst = Math.max(worst, d)
  for (const d of d2) worst = Math.max(worst, d)
  return worst
}

/** The middles of layers of thickness `step` from `lo` up, while below `hi`. */
export function _levels(lo: number, hi: number, step: number): number[] {
  if ((hi - lo) / step > 1e6) throw new RangeError('slices: the step gives more than a million layers')
  const out: number[] = []
  for (let i = 0; ; i++) {
    const level = lo + (i + 0.5) * step
    if (!(level < hi)) break
    out.push(level)
  }
  return out
}

type _Loop = [number[][], boolean]

/** The loops where a plane cuts a mesh (see `Mesh.section`), as wires, longest first. */
export function _sectionWires(vertices: ArrayLike<number>, triangles: ArrayLike<number>, pl: Plane): Wire[] {
  if (!triangles.length) return []
  // points that lie on each other are one (each triangle of an STL file has its own)
  let size = 0
  for (let i = 0; i < vertices.length; i++) size = Math.max(size, Math.abs(vertices[i]))
  size = Math.max(size, 1e-300)
  const r9 = (x: number) => {
    const r = Math.round((x / size) * 1e9) / 1e9
    return r === 0 ? 0 : r
  }
  const ids = new Map<string, number>()
  const id = new Int32Array(vertices.length / 3)
  const pts: number[][] = []
  for (let i = 0; i < id.length; i++) {
    const key = `${r9(vertices[3 * i])},${r9(vertices[3 * i + 1])},${r9(vertices[3 * i + 2])}`
    let n = ids.get(key)
    if (n === undefined) {
      n = pts.length
      ids.set(key, n)
      pts.push([vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2]])
    }
    id[i] = n
  }
  const tri = Int32Array.from(triangles, (x) => id[x])
  const n = pl.zDir.toArray()
  const o = pl.origin.toArray()
  const d = pts.map((p) => (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2])
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) for (let j = 0; j < 3; j++) [lo[j], hi[j]] = [Math.min(lo[j], p[j]), Math.max(hi[j], p[j])]
  const diagonal = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  const snap = 1e-10 * Math.max(diagonal, Math.abs(o[0]), Math.abs(o[1]), Math.abs(o[2]), 1e-300)
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) <= snap) d[i] = 0
  const on = d.map((x) => x === 0)
  // a point on the plane counts as above it (the plane just below), or as below it
  let best: _Loop[] = []
  let bestArea = -1
  for (const above of on.some((x) => x) ? [true, false] : [true]) {
    const loops = _crossingLoops(pts, tri, d, d.map((x, i) => x > 0 || (on[i] && above)))
    let area = 0
    for (const [p, closed] of loops) if (closed) area += Math.abs(_loopArea(p, pl))
    if (area > bestArea) [best, bestArea] = [loops, area]
  }
  const sorted = best
    .map((loop) => [loop, _loopLength(loop[0], loop[1])] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([loop]) => loop)
  const out: Wire[] = []
  for (const [p0, closed] of sorted) {
    const p = _straightened(p0, closed, 1e-12 * Math.max(diagonal, 1e-300))
    if (p.length >= (closed ? 3 : 2)) out.push(closed ? Polyline(...(p as [number, number, number][]), { close: true }) : Polyline(...(p as [number, number, number][])))
  }
  return out
}

/** The points where the triangles cross from `pos` (above the plane, by the signed distance `d`) to
 * below, chained into loops: for each, its points and whether it closes. Each triangle gives a piece
 * that runs with the cut's region on its left (seen from the plane's normal), so the loops of a
 * closed mesh run counterclockwise around its region. */
function _crossingLoops(pts: number[][], tri: Int32Array, d: number[], pos: boolean[]): _Loop[] {
  const nv = pts.length
  const startKeys: number[] = []
  const endKeys: number[] = []
  for (let i = 0; i < tri.length; i += 3) {
    const p = [pos[tri[i]], pos[tri[i + 1]], pos[tri[i + 2]]]
    const count = p.filter((x) => x).length
    if (count !== 1 && count !== 2) continue
    const odd = count === 1 ? p.indexOf(true) : p.indexOf(false) // the odd corner first
    const [a, b, c] = [0, 1, 2].map((j) => tri[i + ((odd + j) % 3)])
    const key = (x: number, y: number) => Math.min(x, y) * nv + Math.max(x, y)
    // a piece runs from the crossing of the edge a-b to that of c-a where a is above, else back
    if (count === 1) {
      startKeys.push(key(a, b))
      endKeys.push(key(c, a))
    } else {
      startKeys.push(key(c, a))
      endKeys.push(key(a, b))
    }
  }
  if (!startKeys.length) return []
  const point = new Map<number, number[]>()
  const at = (key: number): number[] => {
    let p = point.get(key)
    if (p === undefined) {
      const lo = Math.floor(key / nv)
      const hi = key - lo * nv
      const s = d[lo] / (d[lo] - d[hi]) // (the same for both triangles of an edge)
      p = [0, 1, 2].map((j) => pts[lo][j] + (pts[hi][j] - pts[lo][j]) * s)
      point.set(key, p)
    }
    return p
  }
  const outgoing = new Map<number, number[]>()
  startKeys.forEach((key, i) => {
    const list = outgoing.get(key)
    if (list) list.push(i)
    else outgoing.set(key, [i])
  })
  const ends = new Set(endKeys)
  const used = new Uint8Array(startKeys.length)
  const walk = (first: number): _Loop => {
    const chain = [startKeys[first]]
    let i = first
    for (;;) {
      used[i] = 1
      const key = endKeys[i]
      if (key === chain[0]) return [chain.map(at), true]
      chain.push(key)
      const next = (outgoing.get(key) ?? []).find((j) => !used[j])
      if (next === undefined) return [chain.map(at), false]
      i = next
    }
  }
  const loops: _Loop[] = []
  // open chains from where no piece ends, then the loops
  for (let i = 0; i < startKeys.length; i++) if (!used[i] && !ends.has(startKeys[i])) loops.push(walk(i))
  for (let i = 0; i < startKeys.length; i++) if (!used[i]) loops.push(walk(i))
  return loops
}

/** A polyline's points without those where it runs straight on, or that repeat the last. */
function _straightened(p: number[][], closed: boolean, tol: number): number[][] {
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const keep = [p[0]]
  for (const x of p.slice(1)) if (dist(x, keep[keep.length - 1]) > tol) keep.push(x)
  if (closed && keep.length > 1 && dist(keep[0], keep[keep.length - 1]) <= tol) keep.pop()
  const n = keep.length
  if (n < 3) return keep
  return keep.filter((q, i) => {
    if (!closed && (i === 0 || i === n - 1)) return true
    const a = keep[(i - 1 + n) % n]
    const b = keep[(i + 1) % n]
    const u = [q[0] - a[0], q[1] - a[1], q[2] - a[2]]
    const w = [b[0] - q[0], b[1] - q[1], b[2] - q[2]]
    const cross = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
    const straight = cross <= 1e-9 * Math.hypot(u[0], u[1], u[2]) * Math.hypot(w[0], w[1], w[2]) && u[0] * w[0] + u[1] * w[1] + u[2] * w[2] > 0
    return !straight
  })
}

function _loopArea(p: number[][], pl: Plane): number {
  const o = pl.origin.toArray()
  const xd = pl.xDir.toArray()
  const yd = pl.yDir.toArray()
  const x = p.map((q) => (q[0] - o[0]) * xd[0] + (q[1] - o[1]) * xd[1] + (q[2] - o[2]) * xd[2])
  const y = p.map((q) => (q[0] - o[0]) * yd[0] + (q[1] - o[1]) * yd[1] + (q[2] - o[2]) * yd[2])
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length
    s += x[i] * y[j] - x[j] * y[i]
  }
  return 0.5 * s
}

function _loopLength(p: number[][], closed: boolean): number {
  let s = 0
  const n = p.length
  for (let i = 0; i + 1 < (closed ? n + 1 : n); i++) {
    const a = p[i]
    const b = p[(i + 1) % n]
    s += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return s
}

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
 * @param options `maxEdge`: the longest edge a triangle may have (default: no limit): evenly sized
 *   triangles for simulation meshes, deformation or sampling, where the tolerance alone leaves a
 *   flat face two long triangles. A plate 100 long at tolerance 0.1 gets triangles 100 long;
 *   `maxEdge: 10` keeps them under 13 (the kernel splits by about that length).
 *
 * The kernel cuts each face into a grid whose lines it places by the curves along the face's
 * borders. A face that is straight in one direction and twisted along it (the sides of a twisted
 * bar, a ruled loft between different curves, the walls of a thickened free-form sheet) gets no
 * lines across, so a body with such a face is divided by halving its faces until every part is
 * flat within the tolerance: more triangles, but within the tolerance. So is a body with a
 * free-form face whose surface the grid misses (a bump between its lines). On spheres, tori, cones
 * and cylinders, edges whose middle is off the face by more than the tolerance are split onto it
 * (the grid's slivers near the poles of a sphere). Other bodies get the grid's triangles.
 *
 * With `maxEdge` every body gets the grid (the halving cannot take a longest edge): a body with a
 * twisted face whose grid triangles are then off by more than twice the tolerance gets a warning
 * saying how far (a smaller `maxEdge` brings them nearer).
 */
export function tessellate(shape: Shape | Iterable<Shape>, tolerance: number | null = null, angle = 15, options: { maxEdge?: number | null } = {}): Mesh {
  _opts('tessellate', options, arguments.length)
  return _tessellate(shape, tolerance, angle, false, options.maxEdge ?? null)
}

/** `tessellate`; with `keep`, the mesh keeps the kernel's mesh of the tessellation (for the faces
 * of its triangles and the curvature at its corners), and the caller disposes it. */
export function _tessellate(shape: Shape | Iterable<Shape>, tolerance: number | null, angle: number, keep: boolean, maxEdge: number | null = null): Mesh {
  if (maxEdge != null && !(typeof maxEdge === 'number' && maxEdge > 0)) throw new RangeError('tessellate: maxEdge must be a positive length')
  if (shape instanceof ShapeList) return merge(shape.map((s) => tessellate(s as Shape, tolerance, angle, { maxEdge })))
  let body: unknown = shape
  let turned = false
  let copy: _Body | null = null
  if (body instanceof Face) {
    // A face is meshed as a copy in a sheet of its own, which faces where the face's surface
    // normal points: the mesh of a face whose surface normal points into its body is turned.
    turned = !body._naturalIsOutward()
    body = copy = body.toShell()
  }
  try {
    if (!(body instanceof _Body)) throw new TypeError(`cannot tessellate a ${_typeName(body)}`)
    if (k.brep_face_count(body._brep) === 0) {
      // (the kernel's own message for it was "tessellate failed")
      const name = body.name ? ` ${_repr(body.name)}` : ''
      throw new RangeError(`tessellate: the ${_typeName(body)}${name} is empty: it has no faces to mesh (a Boolean that left nothing?)`)
    }
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
          max_edge_length: Number(maxEdge ?? 0),
        }),
    )
    if (maxEdge != null) _gridNote(b, Number(tol), Number(angle), Number(maxEdge))
    const mesh = Mesh._fromPoly(poly, true, keep, b._brep)
    if (turned) {
      // (a kernel's mesh kept with it stays as it is)
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
  } finally {
    // (a kept kernel's mesh refers into the Brep it was made from: the callers that keep it mesh
    // bodies, not faces, and the garbage collector frees a copy then)
    if (!keep) copy?.dispose()
  }
}

/** Warns where `maxEdge` kept the grid on a body that the tessellation would halve (a twisted
 * face, see `tessellate`) and the grid's triangles are off that face by more than twice the
 * tolerance. */
function _gridNote(body: _Body, tolerance: number, angle: number, maxEdge: number): void {
  const worst = kernelCall('tessellate', () => {
    if (ext.tessellation_algorithm(body._brep, { chord_height_tolerance: tolerance, surface_angle_tolerance_deg: angle }) !== 'halving') return 0
    let w = 0
    for (const f of body.faces()) {
      w = Math.max(w, ext.grid_deviation(f._f, { chord_height_tolerance: tolerance, surface_angle_tolerance_deg: angle, max_edge_length: maxEdge }))
    }
    return w
  })
  if (worst > 2 * tolerance) {
    _warn(
      `tessellate: with maxEdge the kernel's grid meshes every face, and a twisted face of this body (straight one way and twisted along it: the side of a twisted bar, a ruled loft) gets triangles about ${_formatG(worst, 3)} off it, for a tolerance of ${_formatG(tolerance, 3)}; give a smaller maxEdge, or leave it out`,
    )
  }
}

/**
 * One mesh per face of a part, shell or sketch (in `shape.faces()` order), cut from one
 * tessellation of the whole body. Faces of imported bodies that the kernel cannot mesh on their
 * own (copied out of the body) get theirs this way, and the faces share the points where they
 * meet.
 */
export function faceMeshes(shape: _Body | ShapeList<Shape>, tolerance: number | null = null, angle = 15): Mesh[] {
  const mesh = _tessellate(shape, tolerance, angle, true)
  try {
    return _faceMeshes(shape, mesh)
  } finally {
    mesh.dispose()
  }
}

/** `tessellate`, and where faces of a body have colors of their own (`Face.color`, kernel plan T5),
 * per triangle the color of its face (r, g, b from 0 to 1, NaN for a face without one); null where no
 * face has one. */
export function _coloredMesh(shape: Shape, tolerance: number | null = null, angle = 15, maxEdge: number | null = null): [Mesh, Float64Array | null] {
  if (!(shape instanceof _Body) || (ext.face_attrs(shape._brep)[0] as unknown[]).every((c) => c === null)) {
    return [tessellate(shape, tolerance, angle, { maxEdge }), null]
  }
  const mesh = _tessellate(shape, tolerance, angle, true, maxEdge)
  try {
    return [mesh, _triangleColors(shape, mesh)]
  } finally {
    mesh.dispose()
  }
}

/** Per triangle of a body's mesh that keeps its tessellation, the own color of its face (NaN for a
 * face without one, three numbers per triangle); null where no face has one. */
export function _triangleColors(shape: _Body, mesh: Mesh): Float64Array | null {
  const [colors] = ext.face_attrs(shape._brep) as [(number[] | null)[], unknown]
  if (colors.every((c) => c === null)) return null
  const owner = _triangleFaces(shape, mesh)
  const out = new Float64Array(owner.length * 3).fill(Number.NaN)
  owner.forEach((fi, i) => {
    const c = colors[fi]
    if (c) for (let d = 0; d < 3; d++) out[i * 3 + d] = Number(c[d])
  })
  return out
}

/** For each triangle of a mesh made with `_tessellate(shape, ..., true)`, the index of the face of
 * `shape` (in `shape.faces()` order) it lies on (none for a mesh without its tessellation). */
export function _triangleFaces(shape: _Body | ShapeList<Shape>, mesh: Mesh): number[] {
  const poly = mesh._poly !== null ? mesh._poly.poly : 0
  if (!poly) return []
  const brep = (shape as _Body)._brep
  if (brep === undefined) throw new TypeError(`faceMeshes: a ${_typeName(shape)} has no body of its own; give a part, shell or sketch`)
  const owners = ext.poly_face_indices(poly, brep) as Int32Array
  const polygons = ext.poly_arrays(poly, false).faces as Int32Array
  const sizes: number[] = []
  for (let i = 0; i < polygons.length; i += sizes[sizes.length - 1] + 1) sizes.push(polygons[i])
  // the face of each triangle (numpy's repeat: one count for all, or one per polygon)
  if (sizes.length !== owners.length && sizes.length !== 1) {
    throw new RangeError(`operands could not be broadcast together with shape (${owners.length},) (${sizes.length},)`)
  }
  const owner: number[] = []
  owners.forEach((fi, i) => {
    for (let n = Math.max((sizes.length === 1 ? sizes[0] : sizes[i]) - 2, 0); n > 0; n--) owner.push(fi)
  })
  if (owner.length !== mesh.triangles.length / 3) throw new ModelingError('tessellate: the mesh does not say which face each triangle belongs to')
  return owner
}

function _faceMeshes(shape: _Body | ShapeList<Shape>, mesh: Mesh): Mesh[] {
  const poly = mesh._poly !== null ? mesh._poly.poly : 0
  const count = shape.faces().length
  if (!poly) return Array.from({ length: count }, () => new Mesh([], []))
  const owner = _triangleFaces(shape, mesh)
  const t = mesh.triangles
  const byFace: number[][] = Array.from({ length: count }, () => [])
  owner.forEach((fi, i) => {
    if (fi >= 0 && fi < count) byFace[fi].push(i)
  })
  const v = mesh.vertices
  const nm = mesh.normals
  return byFace.map((tris) => {
    // the vertices the face's triangles use, in their order in the whole mesh (numpy's unique)
    const used = [...new Set(tris.flatMap((i) => [t[i * 3], t[i * 3 + 1], t[i * 3 + 2]]))].sort((a, b) => a - b)
    const local = new Map(used.map((vi, j) => [vi, j]))
    const vertices = new Float64Array(used.length * 3)
    used.forEach((vi, j) => vertices.set(v.subarray(vi * 3, vi * 3 + 3), j * 3))
    const triangles = new Uint32Array(tris.length * 3)
    tris.forEach((i, j) => {
      for (let c = 0; c < 3; c++) triangles[j * 3 + c] = local.get(t[i * 3 + c]) as number
    })
    let normals: Float32Array | null = null
    if (nm !== null) {
      normals = new Float32Array(tris.length * 9)
      tris.forEach((i, j) => normals?.set(nm.subarray(i * 9, i * 9 + 9), j * 9))
    }
    return new Mesh(vertices, triangles, normals)
  })
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
