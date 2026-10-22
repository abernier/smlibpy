// tests/test_lane_M.py: meshes, drawings and rays (kernel plan, lane M): normals at the apex of a
// cone, colors and positions in glTF, mesh points in double precision, drawing views with hidden
// lines, contours, and many rays at once; mass properties, sections, decimation, repair and faceted
// parts of meshes, a longest edge for tessellation, normals in OBJ files, indexed glTF and normals
// of mesh Booleans.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Axis,
  Box,
  CenterArc,
  Cone,
  Cylinder,
  DrawingView,
  GridLocations,
  Plane,
  Polygon,
  Sphere,
  Torus,
  X,
  Z,
  drawingViews,
  fromDxfWires,
  surface,
  toDxf,
  toGlb,
  toObj,
  toSvg,
  type Edge,
  type Hit,
  type Part,
} from '../src/index.ts'
import { ext, k } from '../src/kernel.ts'
import { gltfDocument } from '../src/exporters.ts'
import type { Mesh } from '../src/mesh.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: glTF documents are plain JSON
type Any = any

const total = (edges: Iterable<{ length: number }>) => [...edges].reduce((s, e) => s + e.length, 0)
const lengths = (edges: Iterable<Edge>) => [...edges].map((e) => Math.round(e.length * 1e6) / 1e6).sort((a, b) => a - b)

// ============================================================================ apex of a cone
/** For each triangle corner of the part's mesh at `apex`: the angle (degrees) between its normal
 * and the exact normal of the part a little inside the triangle (oriented outward). */
function apexErrors(part: Part, apex: number[]): number[] {
  const mesh = part.mesh()
  const v = mesh.vertices
  const t = mesh.triangles
  const nm = mesh.normals as Float32Array
  const faces = [...part.faces()]
  const out: number[] = []
  for (let i = 0; i < t.length / 3; i++) {
    const corners = [0, 1, 2].map((c) => [v[t[i * 3 + c] * 3], v[t[i * 3 + c] * 3 + 1], v[t[i * 3 + c] * 3 + 2]])
    for (let c = 0; c < 3; c++) {
      const p = corners[c]
      if (Math.hypot(p[0] - apex[0], p[1] - apex[1], p[2] - apex[2]) > 1e-6) continue
      const centre = [0, 1, 2].map((j) => (corners[0][j] + corners[1][j] + corners[2][j]) / 3)
      const q = p.map((x, j) => x + 1e-4 * (centre[j] - x))
      const face = faces.reduce((a, b) => (a.distanceTo(q) <= b.distanceTo(q) ? a : b))
      let exact: number[] = face.normalAt(q).toArray()
      const a = corners[1].map((x, j) => x - corners[0][j])
      const b = corners[2].map((x, j) => x - corners[0][j])
      const facet = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
      if (exact[0] * facet[0] + exact[1] * facet[1] + exact[2] * facet[2] < 0) exact = exact.map((x) => -x)
      const n = [nm[i * 9 + c * 3], nm[i * 9 + c * 3 + 1], nm[i * 9 + c * 3 + 2]]
      const len = Math.hypot(n[0], n[1], n[2])
      out.push((Math.acos(Math.min(1, (n[0] * exact[0] + n[1] * exact[1] + n[2] * exact[2]) / len)) * 180) / Math.PI)
    }
  }
  return out
}

const cones: [string, () => Part, number[]][] = [
  ['Cone(10, 0, 20)', () => Cone(10, 0, 20), [0, 0, 10]], // the tessellator gave every corner one line's normal: 127 degrees off
  ['Cone(0, 10, 20)', () => Cone(0, 10, 20), [0, 0, -10]],
  ['Cone(30, 0, 5)', () => Cone(30, 0, 5), [0, 0, 2.5]],
  ['a revolved triangle', () => Polygon([0, 0], [10, 0], [0, 15]).on(Plane.XZ).revolve(new Axis([0, 0, 0], [0, 0, 1])), [0, 0, 15]],
  ['a cone fused to a box', () => Cone(10, 0, 20).translate(0, 0, 10).fuse(Box(30, 30, 4)), [0, 0, 20]],
]
for (const [name, make, apex] of cones) {
  test(`corners at the apex of a cone get the normal of the surface beside them [${name}]`, () => {
    const errors = apexErrors(make(), apex)
    assert.ok(errors.length >= 32)
    assert.ok(Math.max(...errors) < 2, `${Math.max(...errors)}`)
  })
}

test('the apex of a tilted cone; the poles of a sphere keep their normals', () => {
  const tilted = Cone(8, 0, 12).rotate(X, 37).translate(5, 5, 5) // 113 degrees off before
  const errors = [...tilted.vertices()].flatMap((vx) => apexErrors(tilted, vx.point.toArray()))
  assert.ok(errors.length > 32 && Math.max(...errors) < 2)
  const mesh = Sphere(10).mesh()
  const v = mesh.vertices
  const t = mesh.triangles
  const nm = mesh.normals as Float32Array
  let poles = 0
  for (let i = 0; i < t.length; i++) {
    const z = v[t[i] * 3 + 2]
    if (Math.abs(Math.abs(z) - 10) > 1e-9) continue
    poles++
    for (let j = 0; j < 3; j++) approx(nm[i * 3 + j], v[t[i] * 3 + j] / 10, 0, 1e-6)
  }
  assert.ok(poles > 0)
})

test("poly_arrays are the kernel's mesh in double precision", () => {
  const part = Cone(10, 0, 20).fuse(Box(30, 30, 4))
  const poly = ext.tessellate(part._brep, { chord_height_tolerance: 0.05, curve_angle_tolerance_deg: 15, surface_angle_tolerance_deg: 15 })
  try {
    const ours = ext.poly_arrays(poly, true, part._brep)
    const kernel = k.poly_mesh(poly, true) // (SmPyLib's extraction, float32)
    assert.ok(ours.points instanceof Float64Array && kernel.points instanceof Float32Array)
    assert.equal(ours.points.length, kernel.points.length)
    for (let i = 0; i < ours.points.length; i++) assert.ok(Math.abs(ours.points[i] - kernel.points[i]) < 1e-5)
    assert.deepEqual([...ours.faces], [...kernel.faces])
    // without the body the normals are the kernel's
    assert.deepEqual([...ext.poly_arrays(poly, true).normals], [...kernel.normals])
    assert.deepEqual([...ext.poly_arrays(poly).normals], [...k.poly_mesh(poly).normals])
  } finally {
    ext.delete_polybrep(poly)
  }
})

// ============================================================================ double precision
test('mesh points keep their precision far from the origin', () => {
  const box = Box(10.3, 10.7, 10.1).translate(1e6, 0, 0)
  const mesh = box.mesh(0.001)
  assert.ok(mesh.vertices instanceof Float64Array)
  approx(mesh.volume, box.volume, 1e-9) // 1107.72 for 1113.12 through float32
  approx(mesh.bbox().min.x, 1e6 - 5.15, 0, 1e-9)
  const ball = Sphere(5).translate(1e5, 0, 0).mesh(0.001)
  let worst = 0
  for (let i = 0; i < ball.vertices.length; i += 3) {
    worst = Math.max(worst, Math.abs(Math.hypot(ball.vertices[i] - 1e5, ball.vertices[i + 1], ball.vertices[i + 2]) - 5))
  }
  assert.ok(worst < 1e-6, `${worst}`) // 3.8e-3 through float32
})

function glbDoc(glb: Uint8Array): [Any, Uint8Array] {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  const n = dv.getUint32(12, true)
  const doc = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + n)))
  const m = dv.getUint32(20 + n, true)
  return [doc, glb.subarray(28 + n, 28 + n + m)]
}

test('glTF positions are relative to their node; OBJ writes twelve digits', () => {
  const box = Box(10.3, 10.7, 10.1).translate(1e6, 2e5, -3e5)
  const mesh = box.mesh()
  const [doc, buf] = glbDoc(toGlb(box))
  const root = doc.nodes[doc.scenes[0].nodes[0]]
  const node = doc.nodes[root.children[0]]
  ;[1e6, 2e5, -3e5].forEach((x, i) => approx(node.translation[i], x))
  const acc = doc.accessors[doc.meshes[node.mesh].primitives[0].attributes.POSITION]
  const view = doc.bufferViews[acc.bufferView]
  const pos = new Float32Array(buf.slice(view.byteOffset, view.byteOffset + acc.count * 12).buffer)
  const iacc = doc.accessors[doc.meshes[node.mesh].primitives[0].indices]
  const iview = doc.bufferViews[iacc.bufferView]
  const index = new Uint16Array(buf.slice(iview.byteOffset, iview.byteOffset + iacc.count * 2).buffer)
  let worst = 0
  for (let c = 0; c < iacc.count; c++) {
    for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(pos[index[c] * 3 + j] + node.translation[j] - mesh.vertices[mesh.triangles[c] * 3 + j]))
  }
  assert.ok(worst < 1e-5, `${worst}`)
  ;[5.15, 5.35, 5.05].forEach((x, i) => approx(acc.max[i], x, 0, 1e-5))
  const lines = doc.accessors[doc.meshes[node.mesh].primitives[1].attributes.POSITION]
  ;[5.15, 5.35, 5.05].forEach((x, i) => approx(lines.max[i], x, 0, 1e-5)) // (the edges move with it)
  assert.ok(!('translation' in gltfDocument(Box(2, 2, 2), { edges: false })[0].nodes[0]))
  const obj = toObj(Box(10.3, 10.7, 10.1).translate(1e6, 0, 0))
  const vs = obj.split('\n').filter((l) => l.startsWith('v ')).map((l) => l.split(' ').slice(1).map(Number))
  const far = Box(10.3, 10.7, 10.1).translate(1e6, 0, 0).mesh().vertices
  vs.forEach((p, i) => p.forEach((x, j) => assert.ok(Math.abs(x - far[i * 3 + j]) < 1e-5)))
})

// ============================================================================ glTF colors
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

test('glTF base colors are linear', () => {
  const [doc] = gltfDocument([Box(1, 1, 1), Box(1, 1, 1).translate(3, 0, 0).colored([255, 0, 0]), Box(1, 1, 1).translate(6, 0, 0).colored('#808080')], {
    edgeColor: '#1f2328',
  })
  const colors: number[][] = doc.materials.map((m: Any) => m.pbrMetallicRoughness.baseColorFactor)
  ;[0.2016, 0.2918, 0.4621].forEach((x, i) => approx(colors[0][i], x, 0, 5e-4)) // the default #7c93b5
  approx(colors[0][0], linear(0x7c / 255))
  assert.ok(colors.some((c) => c[0] === 1 && c[1] === 0 && c[2] === 0))
  const gray = linear(0x80 / 255)
  approx(gray, 0.2158605, 0, 1e-6)
  assert.ok(colors.some((c) => Math.abs(c[0] - gray) < 1e-12 && Math.abs(c[2] - gray) < 1e-12))
  assert.ok(colors.some((c) => Math.abs(c[0] - linear(0x1f / 255)) < 1e-12))
})

// ============================================================================ drawing views
test('outline with hidden lines', () => {
  const part = Box(40, 30, 20).cut(Cylinder(6, 40))
  let [visible, hidden] = part.outline(Plane.XZ, { hidden: true })
  assert.deepEqual(lengths(visible), [20, 20, 40, 40])
  assert.deepEqual(lengths(hidden), [20, 20]) // the bore's contour lines; its circles lie under the box's edges
  assert.deepEqual([...hidden].map((e) => Math.round(e.center().x * 1e6) / 1e6).sort((a, b) => a - b), [-6, 6])
  assert.deepEqual(lengths(part.outline(Plane.XZ)), lengths(visible))
  ;[visible, hidden] = Cylinder(10, 20).cut(Cylinder(5, 30)).outline(Plane.YZ, { hidden: true })
  approx(total(visible), 80)
  approx(total(hidden), 40)
  ;[visible, hidden] = Box(20, 20, 20).outline(Plane.XY, { hidden: true })
  approx(total(visible), 80)
  assert.equal(hidden.length, 0)
  ;[visible, hidden] = Box(20, 20, 20).outline(new Plane([0, 0, 0], null, [1, 1, 1]), { hidden: true })
  assert.equal(visible.length, 9)
  assert.equal(hidden.length, 3)
  ;[visible, hidden] = Torus(20, 5).outline(Plane.YZ, { hidden: true })
  approx(total(visible), 80 + 10 * Math.PI)
  approx(total(hidden), 10 * Math.PI)
  let box = Box(40, 30, 10)
  box = box.fillet(box.edges().groupBy(Z).at(-1), 3)
  approx(total(box.outline(Plane.XY, { tangentEdges: true })) - total(box.outline(Plane.XY)), 2 * 34 + 2 * 24)
  assert.throws(() => (box.outline as Any)(Plane.XY, { tangent_edges: true }), TypeError)
})

test('drawing views, first and third angle, as DXF and SVG', () => {
  const part = Box(40, 30, 20).cut(Cylinder(6, 40))
  const views = drawingViews(part)
  assert.deepEqual(views.map((v) => v.name), ['front', 'top', 'left'])
  const [front, top, left] = views
  assert.ok(front instanceof DrawingView)
  assert.deepEqual(front.direction.toArray(), [0, -1, 0])
  assert.deepEqual(lengths(front.hidden), [20, 20])
  assert.equal(top.hidden.length, 0)
  const [fb, tb, lb] = [front.bbox(), top.bbox(), left.bbox()]
  ;[fb.min.x, fb.min.y, fb.max.x, fb.max.y].forEach((x, i) => approx(x, [-20, -10, 20, 10][i]))
  approx(tb.max.y, fb.min.y - 8) // below, first-angle
  approx(lb.min.x, fb.max.x + 8) // to the right
  const third = new Map(drawingViews(part, ['front', 'top', 'left', 'right', 'bottom', 'back'], { projection: 'third-angle', gap: 5 }).map((v) => [v.name, v.bbox()]))
  approx(third.get('top')!.min.y, 15)
  approx(third.get('bottom')!.max.y, -15)
  approx(third.get('left')!.max.x, -25)
  approx(third.get('right')!.min.x, 25)
  approx(third.get('back')!.min.x, third.get('right')!.max.x + 5)
  assert.throws(() => drawingViews(part, ['front', 'side']), /unknown view 'side'/)
  assert.throws(() => drawingViews(part, 'front', { projection: 'second-angle' }), RangeError)
  const dxf = toDxf(views)
  assert.ok(dxf.includes('\nDASHED\n'))
  approx(total(fromDxfWires(dxf, { layers: 'HIDDEN' })), 80)
  approx(total(fromDxfWires(dxf, { layers: 'VISIBLE' })), views.reduce((s, v) => s + total(v.visible), 0))
  const svg = toSvg(views)
  assert.ok(svg.startsWith('<?xml') && svg.includes('class="hidden"') && svg.includes('stroke-dasharray'))
  assert.ok(svg.includes(' A6 6 0 1 0 ')) // the bore in the top view: a circle, exactly
  assert.ok(toSvg(CenterArc([0, 0], 5, 0, 90), { margin: 0 }).includes('M5 0 A5 5 0 0 0 0 -5'))
  assert.throws(() => toSvg(part), /not a Part/)
  assert.throws(() => toSvg([]), /nothing to draw/)
})

// ============================================================================ contours
test('silhouette is the contour; parting lines along -X', () => {
  const box = Box(20, 20, 20)
  const contour = box.silhouette([1, 1, 1])
  assert.equal(contour.length, 6)
  approx(total(contour), 120) // 9 visible edges, 180, before
  assert.deepEqual([...box.silhouette(Z)].map((e) => Math.round(e.center().z * 1e9) / 1e9), [10, 10, 10, 10]) // the near edges
  const torus = Torus(20, 5)
  approx(total(torus.silhouette(X)), 2 * Math.PI * 50) // the visible 157.08 before
  approx(total(torus.silhouette(X.neg())), 2 * Math.PI * 50)
  approx(total(torus.partingLine([-1, 0, 0])), 2 * Math.PI * 50)
  const rim = Sphere(10).silhouette(Z)
  assert.equal(rim.length, 1)
  assert.equal(rim[0].geomType, 'circle')
  approx(rim[0].length, 20 * Math.PI)
  const pts = Array.from({ length: 11 }, (_, j) => Array.from({ length: 11 }, (_, i) => [3 * i, 3 * j, 3 * Math.sin((3 * i) / 5) * Math.cos((3 * j) / 7)]))
  const sheet = surface(pts) as Any
  const face = sheet.faces()[0]
  const sc = sheet.silhouette(X)
  assert.ok(sc.length > 0)
  for (const e of sc) for (const t of [0.25, 0.5, 0.75]) assert.ok(Math.abs(face.normalAt(e.pointAt(t)).x) < 1e-4)
})

// ============================================================================ many rays
function sameHit(a: Hit | null, b: Hit | null, tol = 1e-7): boolean {
  if (a === null || b === null) return a === null && b === null
  return Math.abs(a.distance - b.distance) <= tol && a.point.sub(b.point).length <= tol
}

function randomRays(min: number[], max: number[], n: number, seed: number): [number[][], number[][]] {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const centre = min.map((x, j) => (x + max[j]) / 2)
  const diag = Math.hypot(...max.map((x, j) => x - min[j]))
  const o: number[][] = []
  const d: number[][] = []
  for (let i = 0; i < n; i++) {
    const u = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]
    const l = Math.hypot(...u)
    const dir = u.map((x) => x / l)
    d.push(dir)
    o.push(centre.map((c, j) => c - dir[j] * diag + (rnd() - 0.5) * 0.6 * diag))
  }
  return [o, d]
}

test('Mesh.raycastMany finds the first hits of raycast', () => {
  for (const mesh of [Sphere(10).mesh(0.01), Box(40, 30, 20).cut(Cylinder(5, 30)).mesh()] as Mesh[]) {
    const b = mesh.bbox()
    const [o, d] = randomRays(b.min.toArray(), b.max.toArray(), 200, 7)
    const many = mesh.raycastMany(o, d)
    assert.equal(many.length, 200)
    assert.ok(many.filter((h) => h !== null).length > 60)
    for (let i = 0; i < 200; i++) {
      const first = mesh.raycast(o[i], d[i])[0] ?? null
      assert.ok(sameHit(first, many[i], 1e-9))
      if (first) assert.equal(many[i]!.triangle, first.triangle)
    }
  }
  const mesh = Box(10, 10, 10).mesh()
  const hits = mesh.raycastMany([[0, 0, 20], [0, 0, 5], [50, 0, 20]], [0, 0, -1])
  approx(hits[0]!.distance, 15)
  approx(hits[1]!.distance, 0, 0, 1e-12)
  assert.equal(hits[2], null)
  assert.deepEqual(mesh.raycastMany([], Z), [])
  assert.throws(() => mesh.raycastMany([[0, 0, 0]], [0, 0, 0]), /the direction must not be zero/)
  assert.throws(() => mesh.raycastMany([[0, 0, 0], [0, 0, 0], [0, 0, 0]], [[0, 0, 1], [0, 1, 0]]), /one for each/)
})

const rayParts: [string, () => Part][] = [
  ['box with a hole', () => Box(40, 30, 20).cut(Cylinder(5, 30))],
  ['sphere', () => Sphere(10)],
  ['torus', () => Torus(20, 5)],
  ['plate with holes', () => Box(200, 200, 5).cut(GridLocations(14, 14, 12, 12).mul(Cylinder(3, 10)) as Any)],
]
for (const [name, make] of rayParts) {
  test(`Part.raycastMany finds the first hits of raycast [${name}]`, () => {
    const part = make()
    const b = part.bbox()
    const [o, d] = randomRays(b.min.toArray(), b.max.toArray(), 150, 11)
    const many = part.raycastMany(o, d)
    for (let i = 0; i < o.length; i++) {
      const exact = part.raycast(o[i], d[i])[0] ?? null
      assert.ok(sameHit(exact, many[i]), `${i}: ${exact} ${many[i]}`)
      if (exact) assert.ok(many[i]!.face.equals(exact.face) && many[i]!.normal.sub(exact.normal).length < 1e-7)
    }
  })
}

test('Part.raycastMany from inside, from a face and near the rims of holes; face meshes made once', () => {
  const part = Box(40, 30, 20).cut(Cylinder(5, 30))
  const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]]
  part.raycastMany(dirs.map(() => [10, 8, 0]), dirs).forEach((h, i) => assert.ok(sameHit(part.raycast([10, 8, 0], dirs[i])[0], h)))
  const on = part.raycastMany([[10, 8, 10], [10, 8, 10]], [[0, 0, -1], [0, 0, 1]])
  approx(on[0]!.distance, 0, 0, 1e-9)
  approx(on[1]!.distance, 0, 0, 1e-9)
  const plate = Box(200, 200, 5).cut(GridLocations(14, 14, 12, 12).mul(Cylinder(3, 10)) as Any) as Part
  const nearWall = Array.from({ length: 40 }, (_, i) => [7 + 2.99 * Math.cos((i * 2 * Math.PI) / 40), 7 + 2.99 * Math.sin((i * 2 * Math.PI) / 40), 20])
  plate.raycastMany(nearWall, Z.neg()).forEach((h, i) => assert.ok(sameHit(plate.raycast(nearWall[i], Z.neg())[0] ?? null, h)))
  const cylinder = Cylinder(10, 20)
  assert.ok(!cylinder._h.meshes.has('faces'))
  assert.ok(cylinder.raycast([0, 0, 50], [0, 0, -1]).length) // along the axis: the kernel's intersection fails
  const meshes = cylinder._h.meshes.get('faces')
  assert.ok(meshes)
  cylinder.raycast([0, 0, 50], [0, 0, -1])
  assert.equal(cylinder._h.meshes.get('faces'), meshes) // made once per body
  cylinder.raycastMany([[3, 0, 50], [0, 0, 50]], Z.neg()).forEach((h) => approx(h!.distance, 40))
  assert.ok(cylinder._h.meshes.has('rays'))
})

// ============================================================================ batch 2: M6-M13
import { Mesh as _Mesh, ModelingError, Part as _Part, fromStl, makeFace, setWarningHandler, tessellate, toStl } from '../src/index.ts'
import { _deviation } from '../src/mesh.ts'

const holed = () => Box(40, 30, 20).cut(Cylinder(6, 40))
const radialDots = (m: Mesh): number[] => {
  const out: number[] = []
  const n = m.normals as Float32Array
  for (let i = 0; i < m.triangles.length; i++) {
    const v = m.triangles[i] * 3
    const r = Math.hypot(m.vertices[v], m.vertices[v + 1], m.vertices[v + 2])
    out.push((n[3 * i] * m.vertices[v] + n[3 * i + 1] * m.vertices[v + 1] + n[3 * i + 2] * m.vertices[v + 2]) / r)
  }
  return out
}
const longestEdge = (m: Mesh): number => {
  let worst = 0
  const t = m.triangles
  const v = m.vertices
  for (let i = 0; i < t.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const a = t[i + c] * 3
      const b = t[i + ((c + 1) % 3)] * 3
      worst = Math.max(worst, Math.hypot(v[a] - v[b], v[a + 1] - v[b + 1], v[a + 2] - v[b + 2]))
    }
  }
  return worst
}
const without = (m: Mesh, drop: number[]): number[] => {
  const out: number[] = []
  for (let i = 0; i < m.length; i++) if (!drop.includes(i)) out.push(m.triangles[3 * i], m.triangles[3 * i + 1], m.triangles[3 * i + 2])
  return out
}

test('Mesh.massProperties and centroid; empty, open and inward meshes say why (M11)', () => {
  const m = Box(10, 20, 30).translate(5, 6, 7).mesh()
  const mp = m.massProperties(2)
  approx(mp.volume, 6000, 1e-12)
  approx(mp.mass, 12000, 1e-12)
  ;[5, 6, 7].forEach((x, i) => approx(m.centroid.toArray()[i], x, 0, 1e-12))
  const expected = [(12000 / 12) * (20 ** 2 + 30 ** 2), (12000 / 12) * (10 ** 2 + 30 ** 2), (12000 / 12) * (10 ** 2 + 20 ** 2)]
  expected.forEach((x, i) => approx(mp.inertia[i][i], x, 1e-9))
  approx(mp.inertia[0][1], 0, 0, 1e-6)
  const part = holed()
  const fine = part.mesh(0.01)
  const exact = part.massProperties()
  approx(fine.massProperties().volume, exact.volume, 2e-4)
  approx(fine.massProperties().inertia[2][2], exact.inertia[2][2], 2e-4)
  const empty = Box(5, 5, 5).mesh().cut(Box(10, 10, 10).mesh())
  assert.equal(empty.length, 0)
  assert.throws(() => empty.bbox(), { name: 'RangeError', message: 'an empty mesh has no bounding box' })
  assert.throws(() => empty.massProperties(), /no mass properties/)
  const box = Box(10, 10, 10).mesh()
  assert.throws(() => new _Mesh(box.vertices, box.triangles.slice(3)).massProperties(), (e: Any) => e instanceof ModelingError && /open \(3 open edges\).*fillHoles/.test(e.message))
  const inward = Uint32Array.from(box.triangles)
  for (let i = 0; i < inward.length; i += 3) [inward[i + 1], inward[i + 2]] = [inward[i + 2], inward[i + 1]]
  assert.throws(() => new _Mesh(box.vertices, inward).centroid, /face inward/)
})

test('Mesh.section chains loops; slices of meshes and parts (M7)', () => {
  const part = holed()
  const m = part.mesh(0.01)
  const loops = m.section(Plane.XY)
  assert.equal(loops.length, 2)
  assert.ok(loops.every((w) => w.isClosed))
  assert.equal(loops[0].edges().length, 4)
  approx(loops[0].length, 140, 0, 1e-9)
  approx(loops[1].length, 2 * Math.PI * 6, 1e-3)
  approx(makeFace(loops[0]).cut(makeFace(loops[1])).area, part.section(Plane.XY).area, 1e-3)
  for (const z of [10, -10]) {
    const on = m.section(Plane.XY.offset(z))
    assert.deepEqual(on.map((w) => w.length.toFixed(6)), loops.map((w) => w.length.toFixed(6)))
  }
  assert.equal(m.section(Plane.XY.offset(30)).length, 0)
  const layers = m.slices(5)
  assert.deepEqual(layers.map((l) => l.length), [2, 2, 2, 2])
  layers.forEach((l, i) => approx(l[0].edges()[0].start.z, [-7.5, -2.5, 2.5, 7.5][i], 0, 1e-9))
  const across = part.slices(7, X)
  across.forEach((s, i) => approx(s.plane.origin.x, [-16.5, -9.5, -2.5, 4.5, 11.5, 18.5][i], 0, 1e-9))
  approx(across[0].area, 600, 1e-9)
  part.slices(5).forEach((s) => approx(s.area, 1200 - Math.PI * 36, 1e-9))
})

test('Mesh.decimate by fraction, count and tolerance (M6)', () => {
  const s = Sphere(10).mesh(0.01)
  const tenth = s.decimate(0.9)
  approx(tenth.length, s.length / 10, 0.03)
  assert.ok(tenth.isClosed())
  approx(tenth.volume, s.volume, 5e-3)
  const dots = radialDots(tenth)
  assert.ok(dots.filter((d) => d > 0.95).length / dots.length > 0.99) // (smooth: near the radial direction)
  const few = s.decimate(null, { triangles: 1000 })
  assert.ok(few.isClosed())
  approx(few.length, 1000, 0.03)
  const close = s.decimate(null, { tolerance: 0.05 })
  assert.ok(close.isClosed() && close.length < s.length / 3)
  assert.ok(_deviation(s, close) <= 0.05)
  const cone = Cone(10, 0, 20).mesh() // (long thin triangles on the base)
  assert.throws(() => cone.decimate(0.5), (e: Any) => e instanceof ModelingError && /collapsed the mesh to \d+ triangles, where about 63 were asked/.test(e.message))
  assert.throws(() => s.decimate(), { name: 'TypeError', message: /one of fraction, triangles or tolerance/ })
  assert.throws(() => s.decimate(1.5), /between 0 and 1/)
  assert.throws(() => s.decimate(0.5, { triangle: 3 } as Any), /Mesh\.decimate\(\) got an unexpected option 'triangle'/)
})

test('Mesh.fillHoles and repaired (M9)', () => {
  const s = Sphere(10).mesh(0.01)
  const drop = [0, 70, 140, 210, 280] // (three of them meet at a pole)
  const hole = new _Mesh(s.vertices, without(s, drop))
  assert.equal(hole._openEdgeCount(), 15)
  const filled = hole.fillHoles()
  assert.ok(filled.isClosed())
  assert.equal(filled.length, s.length)
  approx(filled.volume, s.volume, 1e-12)
  const m = holed().mesh(0.01)
  // a soup of triangles, every fifth turned, one repeated and one without an area
  const soupV: number[] = []
  const soupT: number[] = []
  for (let i = 0; i < m.length; i++) {
    const order = i % 5 === 0 ? [2, 1, 0] : [0, 1, 2]
    for (const c of order) soupV.push(...m.vertices.subarray(m.triangles[3 * i + c] * 3, m.triangles[3 * i + c] * 3 + 3))
    soupT.push(3 * i, 3 * i + 1, 3 * i + 2)
  }
  soupT.push(0, 1, 2, 0, 0, 1)
  const [fixed, report] = new _Mesh(soupV, soupT).repaired()
  assert.deepEqual(report, {
    mergedVertices: 3 * m.length - m.vertices.length / 3,
    removedTriangles: 2,
    flippedTriangles: Math.ceil(m.length / 5),
    filledHoles: 0,
    openHoles: 0,
    openEdges: 0,
  })
  assert.ok(fixed.isClosed())
  approx(fixed.volume, m.volume, 1e-12)
  // with normals: each corner keeps its own, turned with its triangle
  const soupN: number[] = []
  const nm = m.normals as Float32Array
  for (let i = 0; i < m.length; i++) {
    const order = i % 5 === 0 ? [2, 1, 0] : [0, 1, 2]
    for (const c of order) for (let j = 0; j < 3; j++) soupN.push((i % 5 === 0 ? -1 : 1) * nm[9 * i + 3 * c + j])
  }
  const [withNormals] = new _Mesh(soupV, soupT.slice(0, 3 * m.length), soupN).repaired()
  const tn = withNormals.triangleNormals
  const wn = withNormals.normals as Float32Array
  for (let i = 0; i < withNormals.length; i++) {
    for (let c = 0; c < 3; c++) assert.ok(wn[9 * i + 3 * c] * tn[3 * i] + wn[9 * i + 3 * c + 1] * tn[3 * i + 1] + wn[9 * i + 3 * c + 2] * tn[3 * i + 2] > 0)
  }
  const [closed, r2] = new _Mesh(m.vertices, m.triangles.slice(3)).repaired()
  assert.ok(closed.isClosed() && r2.filledHoles === 1)
})

test('Mesh.toPart and Part.fromMesh (M8)', () => {
  const part = holed()
  const m = part.mesh(0.01)
  const faceted = m.toPart()
  assert.ok(faceted instanceof _Part && faceted.isValid())
  approx(faceted.volume, m.volume, 1e-9)
  assert.equal(faceted.faces().length, 6 + m.section(Plane.XY)[1].edges().length)
  const cut = faceted.cut(Box(10, 10, 40).translate(20, 15, 0))
  assert.ok(cut.isValid())
  approx(cut.volume, faceted.volume - 25 * 20, 1e-9)
  const stl = fromStl(toStl(part, { tolerance: 0.01 }))
  const again = _Part.fromMesh(stl)
  assert.ok(again.isValid())
  approx(again.volume, stl.volume, 1e-9)
  const ball = Sphere(10).mesh(0.3)
  assert.throws(() => ball.toPart(100), (e: Any) => e instanceof ModelingError && /faces, more than maxFaces=100.*decimate/.test(e.message))
  assert.ok(ball.toPart(0).isValid())
  const box = Box(10, 10, 10).mesh()
  assert.throws(() => new _Mesh(box.vertices, box.triangles.slice(3)).toPart(), /open \(3 open edges\)/)
  assert.throws(() => _Part.fromMesh(Box(1, 1, 1) as Any), { name: 'TypeError', message: /takes a Mesh/ })
})

test('maxEdge bounds the triangles; a twisted part warns (M10)', () => {
  const said: string[] = []
  setWarningHandler((msg) => said.push(msg))
  try {
    const plate = Box(100, 100, 2).cut(Cylinder(5, 10))
    const plain = plate.mesh(0.1)
    const fine = plate.mesh(0.1, 15, { maxEdge: 10 })
    assert.ok(longestEdge(plain) > 100 && longestEdge(fine) < 13 && fine.length > 4 * plain.length)
    assert.ok(fine.isClosed())
    approx(fine.volume, plain.volume, 1e-9)
    assert.ok(longestEdge(tessellate(plate, 0.1, 15, { maxEdge: 5 })) < 7)
    assert.equal(fromStl(toStl(plate, { tolerance: 0.1, maxEdge: 10 })).length, fine.length)
    assert.equal(said.length, 0)
    const bar = Box(10, 10, 40).twist(90)
    const coarse = bar.mesh(0.01, 15, { maxEdge: 5 })
    assert.equal(said.length, 1)
    assert.match(said[0], /twisted face.*0\.13\d* off it, for a tolerance of 0\.01/)
    const close = bar.mesh(0.01, 15, { maxEdge: 1 })
    assert.equal(said.length, 1)
    assert.ok(close.length > coarse.length)
    assert.throws(() => plate.mesh(null, 15, { maxEdge: 0 }), /maxEdge/)
  } finally {
    setWarningHandler((msg) => console.warn(msg))
  }
})

test('OBJ names the normal of each corner; glTF is indexed; Boolean results take normals (M12)', () => {
  const part = holed()
  const m = part.mesh()
  const lines = toObj(part).split('\n')
  const vn = lines.filter((l) => l.startsWith('vn ')).map((l) => l.split(' ').slice(1).map(Number))
  const faces = lines.filter((l) => l.startsWith('f ')).map((l) => l.split(' ').slice(1))
  assert.equal(faces.length, m.length)
  let worst = 0
  faces.forEach((f, i) =>
    f.forEach((c, j) => {
      const n = vn[Number(c.split('//')[1]) - 1]
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(n[k] - (m.normals as Float32Array)[9 * i + 3 * j + k]))
    }),
  )
  assert.ok(worst < 1e-6, `${worst}`)
  const [doc, buf] = gltfDocument(part, { edges: false })
  const prim = doc.meshes[0].primitives[0]
  const idx = doc.accessors[prim.indices]
  assert.equal(idx.componentType, 5123)
  assert.equal(idx.count, 3 * m.length)
  const pos = doc.accessors[prim.attributes.POSITION]
  assert.ok(pos.count < 3 * m.length)
  const view = doc.bufferViews[pos.bufferView]
  const p = new Float32Array(buf.slice(view.byteOffset, view.byteOffset + pos.count * 12).buffer)
  const iview = doc.bufferViews[idx.bufferView]
  const index = new Uint16Array(buf.slice(iview.byteOffset, iview.byteOffset + idx.count * 2).buffer)
  worst = 0
  for (let c = 0; c < idx.count; c++) for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(p[index[c] * 3 + j] - m.vertices[m.triangles[c] * 3 + j]))
  assert.ok(worst < 1e-5)
  const big = gltfDocument(Sphere(10).mesh(0.001), { edges: false })[0]
  assert.equal(big.accessors[big.meshes[0].primitives[0].indices].componentType, 5125)
  // the normals of a mesh Boolean's result: radial on the sphere's part of a union
  const union = Box(16, 16, 16).mesh().fuse(Sphere(10).mesh())
  let onSphere = 0
  worst = 0
  for (let i = 0; i < union.length; i++) {
    const corners = [0, 1, 2].map((c) => union.triangles[3 * i + c] * 3)
    if (!corners.every((v) => Math.abs(Math.hypot(union.vertices[v], union.vertices[v + 1], union.vertices[v + 2]) - 10) < 1e-9)) continue
    onSphere++
    corners.forEach((v, c) => {
      const n = (union.normals as Float32Array).subarray(9 * i + 3 * c, 9 * i + 3 * c + 3)
      worst = Math.max(worst, Math.abs((n[0] * union.vertices[v] + n[1] * union.vertices[v + 1] + n[2] * union.vertices[v + 2]) / 10 - 1))
    })
  }
  assert.ok(onSphere > 1000 && worst < 1e-6, `${onSphere} ${worst}`)
})
