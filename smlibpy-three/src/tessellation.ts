// What three draws of an exact body: its faces as one BufferGeometry, cut from one tessellation of
// the whole body (the faces share the points where they meet), and its edges as line segments.
// Vertices are split per face, so a face owns a range of vertices and a range of triangles; a
// vertex's face is found from its index, whatever order a BVH puts the triangles in. Normals are
// the kernel's normals of the exact surfaces, not normals averaged over triangles. Everything is
// in three's coordinates, in the body's own frame.
import * as THREE from 'three'
import { sm, type SmBody } from './kernel.ts'

/** The tessellation of a body: faces, edges, and which face and edge each part of them belongs to. */
export interface Tessellation {
  /** The faces: position, normal, index. Face f owns the vertices [faceVertexStart[f], faceVertexStart[f + 1]). */
  readonly faces: THREE.BufferGeometry
  readonly faceVertexStart: Uint32Array
  /** Face f owns the triangles [faceTriangleStart[f], faceTriangleStart[f + 1]) of `faces.index`. */
  readonly faceTriangleStart: Uint32Array
  /** The edges as line segments (two points each). Edge e owns the segments [edgeSegmentStart[e], edgeSegmentStart[e + 1]). */
  readonly edges: THREE.BufferGeometry
  readonly edgeSegmentStart: Uint32Array
  /** Each edge's points in order (x, y, z each): what a BrepEdge of the body draws. */
  readonly edgePoints: readonly Float32Array[]
  /** How many objects draw it: disposed when the last one is. */
  refs: number
}

/** How many bodies this thread tessellated (for tests: a worker's results come tessellated). */
export const counts = { tessellated: 0 }

// (corner normals that differ by more than this split a vertex: the apex of a cone)
const COS_SPLIT = Math.cos(Math.PI / 180)

/**
 * Tessellates `body`. `faces` and `edges` are its faces and edges (seams left out) in the kernel's
 * order, the order the package numbers them in. `tolerance` is the chord height (null: 0.1 % of
 * the body's diagonal, smlibpy's default), `angle` the largest angle between neighbouring normals
 * and `edgeAngle` the largest turn along an edge, in radians.
 */
export function tessellate(body: SmBody, edges: readonly sm.Edge[], tolerance: number | null, angle: number, edgeAngle: number): Tessellation {
  counts.tessellated++
  const diagonal = body.bbox().diagonal
  const tol = tolerance ?? Math.max(diagonal * 1e-3, 1e-6)
  const meshes = sm.faceMeshes(body, tol, (angle * 180) / Math.PI)
  const { geometry, faceVertexStart, faceTriangleStart } = faceGeometry(meshes)
  const colors = faceColors(body)
  if (colors !== null) geometry.setAttribute('color', vertexColors(colors, faceVertexStart))
  const edgePoints = edges.map((e) => polyline(e, tol, edgeAngle))
  const { geometry: lines, edgeSegmentStart } = segments(edgePoints)
  return { faces: geometry, faceVertexStart, faceTriangleStart, edges: lines, edgeSegmentStart, edgePoints, refs: 0 }
}

/** The faces' meshes (kernel coordinates) as one geometry in three's, with vertices split per face. */
function faceGeometry(meshes: readonly sm.Mesh[]): { geometry: THREE.BufferGeometry; faceVertexStart: Uint32Array; faceTriangleStart: Uint32Array } {
  let triangleCount = 0
  for (const m of meshes) triangleCount += m.triangles.length / 3
  const positions = new Float32Array(triangleCount * 9)
  const normals = new Float32Array(triangleCount * 9)
  const index = new Uint32Array(triangleCount * 3)
  const faceVertexStart = new Uint32Array(meshes.length + 1)
  const faceTriangleStart = new Uint32Array(meshes.length + 1)
  let v = 0
  let t = 0
  const n = new THREE.Vector3()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  meshes.forEach((m, f) => {
    faceVertexStart[f] = v
    faceTriangleStart[f] = t
    const tri = m.triangles
    const pts = m.vertices
    const nm = m.normals
    // the vertices made for each of the face's own vertices (more than one where normals differ)
    const made = new Map<number, number[]>()
    for (let i = 0; i < tri.length; i += 3) {
      if (nm === null) {
        // (no corner normals: the triangle's own)
        a.set(pts[tri[i] * 3], pts[tri[i] * 3 + 1], pts[tri[i] * 3 + 2])
        b.set(pts[tri[i + 1] * 3], pts[tri[i + 1] * 3 + 1], pts[tri[i + 1] * 3 + 2])
        c.set(pts[tri[i + 2] * 3], pts[tri[i + 2] * 3 + 1], pts[tri[i + 2] * 3 + 2])
        n.subVectors(c, b).cross(a.sub(b)).normalize()
      }
      for (let corner = 0; corner < 3; corner++) {
        const p = tri[i + corner]
        if (nm !== null) n.set(nm[i * 3 + corner * 3], nm[i * 3 + corner * 3 + 1], nm[i * 3 + corner * 3 + 2])
        const nx = n.x
        const ny = n.y
        const nz = n.z
        let at = -1
        const copies = made.get(p)
        if (copies !== undefined) {
          for (const q of copies) {
            if (normals[q * 3] * nx + normals[q * 3 + 1] * ny + normals[q * 3 + 2] * nz >= COS_SPLIT) {
              at = q
              break
            }
          }
        }
        if (at < 0) {
          at = v++
          positions[at * 3] = pts[p * 3]
          positions[at * 3 + 1] = pts[p * 3 + 1]
          positions[at * 3 + 2] = pts[p * 3 + 2]
          normals[at * 3] = nx
          normals[at * 3 + 1] = ny
          normals[at * 3 + 2] = nz
          if (copies === undefined) made.set(p, [at])
          else copies.push(at)
        }
        index[t * 3 + corner] = at
      }
      t++
    }
  })
  faceVertexStart[meshes.length] = v
  faceTriangleStart[meshes.length] = t
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, v * 3), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals.slice(0, v * 3), 3))
  geometry.setIndex(new THREE.BufferAttribute(v < 65536 ? Uint16Array.from(index) : index, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, faceVertexStart, faceTriangleStart }
}

/** The color the default material gives faces without one of their own. */
export const BODY_COLOR = 0xc7ccd4

/** The faces' own colors (sRGB, 0 to 1), null where no face has one. */
export function faceColors(body: SmBody): ([number, number, number] | null)[] | null {
  const colors = [...body.faces()].map((f) => f.color)
  return colors.some((c) => c !== null) ? colors : null
}

/** A color per vertex, each face's own (three's working space) or the body color. */
function vertexColors(colors: readonly ([number, number, number] | null)[], faceVertexStart: Uint32Array): THREE.BufferAttribute {
  const out = new Float32Array(faceVertexStart[colors.length] * 3)
  const c = new THREE.Color()
  colors.forEach((rgb, f) => {
    if (rgb === null) c.set(BODY_COLOR)
    else c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace)
    for (let v = faceVertexStart[f]; v < faceVertexStart[f + 1]; v++) c.toArray(out, v * 3)
  })
  return new THREE.BufferAttribute(out, 3)
}

/** A tessellation as plain arrays, to cross to another thread (a worker's results come drawn). */
export interface TessellationData {
  readonly position: Float32Array
  readonly normal: Float32Array
  readonly color: Float32Array | null
  readonly index: Uint16Array | Uint32Array
  readonly faceVertexStart: Uint32Array
  readonly faceTriangleStart: Uint32Array
  readonly edgePoints: readonly Float32Array[]
}

/** The arrays of a tessellation (its own: sending copies them). */
export function tessellationData(t: Tessellation): TessellationData {
  const color = t.faces.getAttribute('color')
  return {
    position: t.faces.getAttribute('position').array as Float32Array,
    normal: t.faces.getAttribute('normal').array as Float32Array,
    color: color === undefined ? null : (color.array as Float32Array),
    index: t.faces.getIndex()!.array as Uint16Array | Uint32Array,
    faceVertexStart: t.faceVertexStart,
    faceTriangleStart: t.faceTriangleStart,
    edgePoints: t.edgePoints,
  }
}

/** A tessellation of arrays another thread made (`tessellationData`). */
export function fromTessellationData(d: TessellationData): Tessellation {
  const faces = new THREE.BufferGeometry()
  faces.setAttribute('position', new THREE.BufferAttribute(d.position, 3))
  faces.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3))
  if (d.color !== null) faces.setAttribute('color', new THREE.BufferAttribute(d.color, 3))
  faces.setIndex(new THREE.BufferAttribute(d.index, 1))
  faces.computeBoundingBox()
  faces.computeBoundingSphere()
  const { geometry: edges, edgeSegmentStart } = segments(d.edgePoints)
  return { faces, faceVertexStart: d.faceVertexStart, faceTriangleStart: d.faceTriangleStart, edges, edgeSegmentStart, edgePoints: d.edgePoints, refs: 0 }
}

/** Polylines as one geometry of line segments, and where each polyline's segments start. */
function segments(lines: readonly Float32Array[]): { geometry: THREE.BufferGeometry; edgeSegmentStart: Uint32Array } {
  const edgeSegmentStart = new Uint32Array(lines.length + 1)
  let count = 0
  lines.forEach((pts, e) => {
    edgeSegmentStart[e] = count
    count += Math.max(pts.length / 3 - 1, 0)
  })
  edgeSegmentStart[lines.length] = count
  const positions = new Float32Array(count * 6)
  let s = 0
  for (const pts of lines) {
    for (let i = 0; i + 5 < pts.length; i += 3) positions.set(pts.subarray(i, i + 6), s++ * 6)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, edgeSegmentStart }
}

/** A geometry of one polyline (a BrepEdge's or a Wire's, for THREE.Line). */
export function lineGeometry(points: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** The triangles of face `f` of a tessellation, as a geometry of their own (a BrepFace's). */
export function faceOf(tess: Tessellation, f: number): THREE.BufferGeometry {
  const v0 = tess.faceVertexStart[f]
  const v1 = tess.faceVertexStart[f + 1]
  const t0 = tess.faceTriangleStart[f]
  const t1 = tess.faceTriangleStart[f + 1]
  const position = tess.faces.getAttribute('position').array as Float32Array
  const normal = tess.faces.getAttribute('normal').array as Float32Array
  const index = tess.faces.getIndex()!.array
  const own = new Uint32Array((t1 - t0) * 3)
  for (let i = 0; i < own.length; i++) own[i] = index[t0 * 3 + i] - v0
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position.slice(v0 * 3, v1 * 3), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal.slice(v0 * 3, v1 * 3), 3))
  geometry.setIndex(new THREE.BufferAttribute(own, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** The face that owns vertex `vertex` of a tessellation's faces. */
export function faceAt(tess: Tessellation, vertex: number): number {
  const starts = tess.faceVertexStart
  let lo = 0
  let hi = starts.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= vertex) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** The edge that owns segment `segment` of a tessellation's edges. */
export function edgeAt(tess: Tessellation, segment: number): number {
  const starts = tess.edgeSegmentStart
  let lo = 0
  let hi = starts.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= segment) lo = mid
    else hi = mid - 1
  }
  // (an edge without segments, a degenerate one, owns none: step past it)
  while (lo + 1 < starts.length - 1 && starts[lo + 1] <= segment) lo++
  return lo
}

/**
 * The points of an edge (or a wire) in three's coordinates: a line's two ends, a circle's points
 * at most `angle` apart, any other curve sampled until it lies within `tolerance` of its chords.
 */
export function polyline(curve: sm.Edge | sm.Wire, tolerance: number, angle: number): Float32Array {
  const out: number[] = []
  const edges = curve instanceof sm.Wire ? [...curve.edges()] : [curve]
  for (const e of edges) {
    const pts = edgePoints(e, tolerance, angle)
    // (a wire's edges meet: each one after the first starts where the one before ended)
    for (let i = out.length ? 1 : 0; i < pts.length; i++) out.push(pts[i].x, pts[i].y, pts[i].z)
  }
  return Float32Array.from(out)
}

function edgePoints(e: sm.Edge, tolerance: number, angle: number): sm.Vector[] {
  const kind = e.geomType
  if (kind === 'line') return [e.start, e.end]
  const length = e.length
  if (!(length > 0)) return []
  if (kind === 'circle') {
    const r = e.radius
    const center = e.arcCenter
    const start = e.start
    const radial = start.sub(center)
    // the circle runs from its start about this axis (the right-hand rule), as far as its length reaches
    const turn = radial.cross(e.tangentAt(0)).normalized()
    const sweep = Math.min(length / r, 2 * Math.PI)
    const step = Math.min(angle, tolerance < r ? 2 * Math.acos(1 - tolerance / r) : angle)
    const n = Math.min(Math.max(Math.ceil(sweep / step), 2), 720)
    const pts: sm.Vector[] = []
    for (let i = 0; i <= n; i++) pts.push(center.add(radial.rotate(turn, ((sweep * i) / n) * (180 / Math.PI))))
    return pts
  }
  // any other curve: chords that stay within the tolerance (each halved where its middle is off)
  const params = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]
  const at = params.map((t) => e.pointAt(t))
  const ts = params.slice()
  for (let pass = 0; pass < 6; pass++) {
    let split = false
    for (let i = ts.length - 2; i >= 0; i--) {
      const tm = (ts[i] + ts[i + 1]) / 2
      const pm = e.pointAt(tm)
      const chordMid = at[i].add(at[i + 1]).mul(0.5)
      if (pm.distanceTo(chordMid) > tolerance) {
        ts.splice(i + 1, 0, tm)
        at.splice(i + 1, 0, pm)
        split = true
      }
    }
    if (!split || ts.length > 512) break
  }
  return at
}
