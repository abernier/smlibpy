// The rest of smlibpy's API on the core classes: what every body has, the parts' cells, features,
// mold and face edits, sheets, sketches, faces, edges, wires, vertices, selections, the free
// functions, the other primitives and the constants. Three's types and axes throughout, results
// in the frame of what an operation was called on, nothing of smlibwasm's out.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  AnnularSector,
  Box,
  Circle,
  Cone,
  CounterBoreHole,
  CounterSinkHole,
  Cylinder,
  DraftAnalysis,
  Edge,
  Face,
  Hole,
  Line,
  Locations,
  MassProperties,
  Part,
  Polyline,
  Pyramid,
  Rectangle,
  SectionProperties,
  Shell,
  Sketch,
  Sphere,
  Torus,
  Vertex,
  Wire,
  X,
  Y as UP,
  Z,
  TOLERANCE,
  chamfer,
  extrude,
  fillet,
  loft,
  merge,
  mirror,
  offset,
  revolve,
  section,
  sweep,
  swing,
  thicken,
} from '../src/index.ts'
import { box, close, closeBox, closeVector, noKernel, Y } from './_util.ts'

const PLATE = () => new Box(40, 30, 10) // 40 along x, 30 along z, 10 high

test('every body: equals, info, check, compact', async () => {
  const part = PLATE()
  assert.ok(part.equals(part.clone()))
  assert.ok(!part.equals(PLATE()))
  const info = part.info()
  assert.equal(info.faces, 6)
  assert.equal(info.edges, 12)
  assert.ok(info.bbox instanceof THREE.Box3)
  closeBox(info.bbox, box([-20, -5, -15], [20, 5, 15]))
  assert.deepEqual(part.check(), [])
  part.compact()
  close(part.volume, 12000)
  await noKernel(info)
})

test('closest points and exact ray hits, in the receiver frame', async () => {
  const a = PLATE()
  const b = PLATE()
  b.position.set(100, 0, 0) // 60 between them along x
  a.position.set(0, 20, 0) // (b is 20 lower: the nearest points are its top and a's bottom corner region)
  const cp = a.closestPoints(b)
  close(cp.distance, Math.hypot(60, 10), 1e-9)
  assert.ok(cp.point instanceof THREE.Vector3)
  close(cp.point.x, 20, 1e-9) // a's +x side
  close(cp.otherPoint.x, 80, 1e-9) // b's -x side, in a's frame (100 - 20)
  assert.ok(cp.face === null || cp.face.owner === a)
  assert.ok(cp.otherFace === null || cp.otherFace.owner === b)
  // the kernel's exact ray cast, in the part's frame
  const hits = a.intersectRay(new THREE.Ray(new THREE.Vector3(3, 50, 4), new THREE.Vector3(0, -1, 0)))
  assert.equal(hits.length, 2)
  closeVector(hits[0].point, { x: 3, y: 5, z: 4 }, 1e-9)
  closeVector(hits[0].normal, Y, 1e-9)
  assert.equal(hits[0].face, a.faces().top().one())
  const many = a.intersectRays([new THREE.Ray(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0)), new THREE.Ray(new THREE.Vector3(100, 50, 0), new THREE.Vector3(0, -1, 0))])
  assert.ok(many[0] !== null && many[1] === null)
  await noKernel([cp, hits, many])
})

test('silhouette, projection and outline are curves where the body is', async () => {
  const cylinder = new Cylinder(5, 20)
  cylinder.position.set(10, 0, 0)
  const sil = cylinder.silhouette(new THREE.Vector3(1, 0, 0))
  assert.ok(sil.length >= 2)
  for (const e of sil) assert.ok(e instanceof Edge && e.owner === null)
  closeVector(sil[0].position, cylinder.position, 0)
  const top = PLATE().outline()
  // the box's top view: its outline on the ground plane (y = 0)
  const b = new THREE.Box3()
  for (const e of top) b.union(e.bbox())
  closeBox(b, box([-20, 0, -15], [20, 0, 15]), 1e-6)
  const [visible, hidden] = PLATE().outline(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), { hidden: true })
  assert.ok(visible.length > 0 && Array.isArray(hidden))
  const sphere = new Sphere(10)
  const onSphere = sphere.project(new Line(new THREE.Vector3(-5, 20, 0), new THREE.Vector3(5, 20, 0)), new THREE.Vector3(0, -1, 0), { nearest: true })
  assert.ok(onSphere.length >= 1)
  for (const p of [onSphere[0].start, onSphere[0].end]) close(p.length(), 10, 1e-6)
  await noKernel([sil, top, visible, onSphere])
})

test('parts: shells, voids, cells, merge, classify', async () => {
  const hollow = new Box(20, 20, 20).cut(new Box(10, 10, 10))
  assert.equal(hollow.shells().length, 2)
  assert.equal(hollow.voids().length, 1)
  close(hollow.voids()[0].volume, 1000, 1e-6)
  const left = new Box(10, 10, 10, { align: { x: 'max' } })
  const right = new Box(10, 10, 10, { align: { x: 'min' } })
  const merged = left.merge(right)
  assert.equal(merged.cells().length, 2)
  assert.equal(merged.faces().shared().length, 1)
  const [where, on] = merged.classify(new THREE.Vector3(0, 5, 0))
  assert.equal(where, 'on')
  assert.ok(on instanceof Face || on instanceof Edge)
  assert.equal(merged.classify(new THREE.Vector3(5, 0, 0))[0], 'inside')
  assert.equal(merged.classify(new THREE.Vector3(50, 0, 0))[0], 'outside')
  const cell = merged.cellAt(new THREE.Vector3(5, 0, 0))
  assert.ok(cell instanceof Part)
  close(cell.center().x, 5, 1e-9)
  assert.equal(merged.cellAt(new THREE.Vector3(50, 0, 0)), null)
  assert.equal(merge(left, right).cells().length, 2)
  await noKernel([hollow.voids(), merged.cells(), cell])
})

test('parts: sheet intersections, fillet previews, shells with walls, offsets, imprints, slices', async () => {
  const part = PLATE()
  const sheet = new Rectangle(100, 100).extrude(1).faces().top().one().toShell()
  sheet.position.y = -0.5 // (the sheet's top face at y = 0.5)
  const inside = part.intersect(sheet)
  assert.ok(inside instanceof Shell)
  close(inside.area, 40 * 30, 1e-6)
  const previews = part.filletPreview(part.edges().parallelTo(Y), 2)
  assert.equal(previews.length, 4)
  for (const p of previews) assert.ok(p instanceof Shell)
  const top = part.faces().top()
  const walls = new Map([[part.faces().front().one(), 3]])
  const cup = part.shell(1, top, { walls })
  close(cup.volume, 12000 - 38 * (30 - 1 - 3) * 9, 1e-6)
  close(part.offset(1).volume, 42 * 32 * 12 - (12 * 4 * 10 * (1 - Math.PI / 4) * 0) - 0, 4 * (12 + 32 + 42) + 1) // (rounded edges and corners: within their volume)
  const disk = new Circle(5)
  disk.position.y = 20 // (above the plate: its outline goes down onto the top face)
  const imprinted = part.imprint(disk, new THREE.Vector3(0, -1, 0))
  assert.equal(imprinted.faces().length, part.faces().length + 1) // (the disk: the top face around it keeps its place)
  const slices = new Sphere(10).slices(5)
  assert.ok(slices.length >= 3)
  for (const s of slices) {
    assert.ok(s instanceof Sketch)
    closeVector({ x: 0, y: Math.abs(s.plane.normal.y), z: 0 }, Y, 1e-9)
  }
  await noKernel([inside, previews, cup, imprinted, slices])
})

test('parts: removing fillets and faces gives the part back', () => {
  const part = PLATE()
  const rounded = part.fillet(part.edges().parallelTo(Y), 4)
  close(rounded.removeFillets().volume, 12000, 1e-6)
  const drilled = part.cut(new Cylinder(3, 20))
  const hole = drilled.faces().cylinders()
  close(drilled.removeFaces(hole).volume, 12000, 1e-6)
})

test('parts: drafts, parting lines and moved faces', async () => {
  const part = PLATE()
  const analysis = part.draftAnalysis(Y, { minAngle: THREE.MathUtils.degToRad(1) })
  assert.ok(analysis instanceof DraftAnalysis)
  assert.equal(analysis.length, 6)
  assert.equal(analysis.vertical.length, 4)
  assert.ok(!analysis.ok)
  closeVector(analysis.direction, Y, 1e-12)
  const sides = part.faces().perpendicularTo(Y)
  const drafted = part.draft(sides, THREE.MathUtils.degToRad(5), part.faces().bottom().one())
  const after = drafted.draftAnalysis(Y, { minAngle: THREE.MathUtils.degToRad(1) })
  assert.equal(after.vertical.length, 0)
  for (const f of drafted.faces().perpendicularTo(Y)) {
    const [lo, hi] = after.angles(f)
    close(Math.abs(lo), THREE.MathUtils.degToRad(5), 1e-6)
    close(Math.abs(hi), THREE.MathUtils.degToRad(5), 1e-6)
  }
  assert.ok(part.partingLine(Y).length >= 1)
  const taller = part.moveFaces(part.faces().top(), new THREE.Vector3(0, 5, 0))
  closeBox(taller.bbox(), box([-20, -5, -15], [20, 10, 15]))
  const shifted = part.moveFaces(part.faces().right(), new THREE.Matrix4().makeTranslation(3, 0, 0))
  close(shifted.bbox().max.x, 23, 1e-9)
  close(part.offsetFaces(part.faces().top(), 2).volume, 40 * 30 * 12, 1e-6)
  const bumped = part.push(part.faces().top().one(), new THREE.Vector3(0, 5, 0), { by: 2, radius: 8 })
  close(bumped.bbox().max.y, 7, 1e-3)
  await noKernel([analysis, drafted, taller])
})

test('parts placed, mirrored, made NURBS, healed, with colored and named faces', () => {
  const part = PLATE()
  const target = new Box(100, 100, 2, { align: { y: 'max' } }) // its top face at y = 0
  const placed = new Cylinder(2, 10, { align: { y: 'min' } }).on(target.faces().top().one())
  close(placed.bbox().min.y, 0, 1e-9)
  closeBox(part.mirror(new THREE.Plane(new THREE.Vector3(1, 0, 0), -30)).bbox(), box([40, -5, -15], [80, 5, 15]))
  assert.ok(part.toNurbs().faces().every((f) => f.geomType === 'bspline'))
  close(part.heal().volume, 12000, 1e-6)
  const colored = part.colorFaces(part.faces().top(), '#ff0000')
  assert.equal(colored.faces().top().one().color?.getHexString(), 'ff0000')
  assert.equal(colored.faces().bottom().one().color, null)
  const named = part.nameFaces(part.faces().top(), 'lid')
  assert.equal(named.faces().top().one().name, 'lid')
})

test('sheets: offset, flip, trim, extend, merge faces, Booleans with parts', async () => {
  const sheet = new Rectangle(20, 20).extrude(1).faces().top().one().toShell() // a square at y = 1
  assert.ok(sheet instanceof Shell)
  // (along the face's surface normal, whichever way that points)
  const n = sheet.faces()[0].normalAt()
  close(sheet.offset(2).bbox().min.y, 1 + 2 * n.y, 1e-9)
  closeVector(sheet.flipped().faces()[0].normalAt(), n.clone().negate(), 1e-9)
  const grown = sheet.extend(5)
  close(grown.area, 30 * 30, 1e-6)
  const cut = new Line(new THREE.Vector3(0, 1, -20), new THREE.Vector3(0, 1, 20))
  const half = sheet.trim([cut], new THREE.Vector3(5, 1, 0))
  close(half.area, 200, 1e-6)
  const both = sheet.trim(cut, 'split')
  assert.equal(both.faces().length, 2)
  const merged = both.mergeFaces(both.faces()[0], both.faces()[1])
  assert.equal(merged.faces().length, 1)
  const pierced = sheet.cut(new Cylinder(3, 10))
  close(pierced.area, 400 - Math.PI * 9, 1e-6)
  close(sheet.intersect(new Cylinder(3, 10)).area, Math.PI * 9, 1e-6)
  const other = new Rectangle(20, 20).extrude(1).faces().top().one().toShell()
  other.position.x = 20
  assert.ok(sheet.fuse(other).area > 799)
  await noKernel([grown, half, merged, pierced])
})

test('sketches: xor, flip, chamfer, section properties, swing, sweep options', async () => {
  const a = new Rectangle(20, 10)
  const b = new Rectangle(10, 20)
  close(a.xor(b).area, 200 + 200 - 2 * 100, 1e-6)
  closeVector(a.flipped().plane.normal, { x: 0, y: -1, z: 0 }, 1e-12)
  close(a.chamfer(2).area, 200 - 4 * 2, 1e-6)
  const props = a.sectionProperties()
  assert.ok(props instanceof SectionProperties)
  close(props.area, 200)
  closeVector(props.centroid, { x: 0, y: 0, z: 0 }, 1e-9)
  // ixx about the in-plane x axis: b h³ / 12 with b = 20 along x, h = 10 across
  close(props.ixx, (20 * 10 ** 3) / 12, 1e-6)
  close(props.iyy, (10 * 20 ** 3) / 12, 1e-6)
  closeVector(props.xAxis, X, 1e-12)
  const standing = new THREE.Matrix4().makeRotationX(Math.PI / 2) // (the profile upright, in the XY plane)
  const ring = new Rectangle(2, 2, { align: { x: 'min' } }).on(standing).swing(new Circle(10))
  assert.ok(ring instanceof Part && ring.volume > 0)
  const path = new Line(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 50, 0))
  const twisted = new Rectangle(10, 2).sweep(path, { twist: Math.PI / 2 })
  close(twisted.volume, 10 * 2 * 50, 1)
  const horn = new Circle(2).sweep(path, { scale: [1, 2] })
  assert.ok(horn.volume > Math.PI * 4 * 50)
  await noKernel([props, ring, twisted])
})

test('faces: colors, curvature, parameters, NURBS data, exact hits, curves on them', async () => {
  const ball = new Sphere(10)
  const s = ball.faces().first
  const k = s.curvatureAt(new THREE.Vector3(0, 10, 0))
  close(Math.abs(k.k1), 0.1, 1e-6)
  close(Math.abs(k.mean), 0.1, 1e-6)
  const p = new THREE.Vector3(6, 8, 0)
  const uv = s.uvAt(p)
  assert.ok(uv instanceof THREE.Vector2)
  closeVector(s.positionAt(uv.x, uv.y), p, 1e-6)
  closeVector(s.closestPoint(new THREE.Vector3(0, 20, 0)), { x: 0, y: 10, z: 0 }, 1e-6)
  const top = PLATE().faces().top().one()
  const n = top.nurbs()
  assert.ok(n.points.length >= 2 && n.points[0][0] instanceof THREE.Vector3)
  for (const row of n.points) for (const q of row) close(q.y, 5, 1e-9)
  const hits = top.intersectRay(new THREE.Ray(new THREE.Vector3(0, 9, 0), new THREE.Vector3(0, -1, 0)))
  assert.equal(hits.length, 1)
  close(hits[0].distance, 4, 1e-9)
  const can = new Cylinder(10, 40)
  const side = can.faces().cylinders().one()
  const label = side.wrap(new Rectangle(10, 4), new THREE.Vector3(10, 0, 0))
  assert.ok(label.length >= 4)
  for (const e of label) close(Math.hypot(e.start.x, e.start.z), 10, 1e-6)
  const iso = side.iso({ u: 0.5 })
  assert.equal(iso.length, 1)
  close(iso[0].length, 40, 1e-6)
  const projected = top.project(new Line(new THREE.Vector3(-5, 20, 0), new THREE.Vector3(5, 20, 0)))
  close(projected[0].start.y, 5, 1e-9)
  const halves = top.split(new Line(new THREE.Vector3(0, 5, -20), new THREE.Vector3(0, 5, 20)))
  assert.equal(halves.length, 2)
  assert.equal(halves[0].owner, halves[1].owner)
  close(halves[0].area + halves[1].area, 1200, 1e-6)
  close(top.toSketch().area, 1200, 1e-6)
  close(top.offset(2).bbox().min.y, 7, 1e-9)
  close(new Cone(5, 0, 10).faces().ofType('cone').one().coneAngle, Math.atan(5 / 10), 1e-9)
  close(new Torus(10, 2).faces().first.majorRadius, 10, 1e-9)
  assert.ok(top.interiorPoint() instanceof THREE.Vector3)
  assert.deepEqual(top.cells, [0])
  assert.deepEqual(top.toShell().faces()[0].cells, [])
  await noKernel([k, n, hits, label, halves])
})

test('edges: angles, trims, intersections, offsets, NURBS round trips, tangent chains', async () => {
  const part = PLATE()
  const edge = part.edges().parallelTo(Y).first
  close(edge.dihedralAngle, Math.PI / 2, 1e-9)
  assert.equal(edge.convexity, 'convex')
  assert.ok(edge.isConvex())
  assert.ok(!edge.isSeam)
  closeVector({ x: 0, y: Math.abs(edge.direction.y), z: 0 }, Y, 1e-12)
  const line = new Line(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0))
  close(line.trim(0.2, 0.7).length, 5, 1e-9)
  const [l1, l2] = line.split(0.3)
  close(l1.length + l2.length, 10, 1e-9)
  close(line.extend(5).length, 15, 1e-9)
  const crossing = new Line(new THREE.Vector3(5, 0, -5), new THREE.Vector3(5, 0, 5))
  const xs = line.intersections(crossing)
  assert.equal(xs.length, 1)
  closeVector(xs[0], { x: 5, y: 0, z: 0 }, 1e-9)
  close(line.intersectionParams(crossing)[0], 0.5, 1e-9)
  close(line.offset(2, { plane: new THREE.Plane(Y, 0) }).start.distanceTo(line.start), 2, 1e-9)
  const bent = line.through(new THREE.Vector3(5, 3, 0))
  assert.ok(bent.distanceTo(new THREE.Vector3(5, 3, 0)) < 1e-6)
  const matched = line.match({ end: new THREE.Vector3(10, 4, 0) })
  closeVector(matched.end, { x: 10, y: 4, z: 0 }, 1e-9)
  const spline = new Line(new THREE.Vector3(), new THREE.Vector3(10, 5, 2)).match({ endTangent: new THREE.Vector3(0, 1, 0) })
  const data = spline.nurbs()
  const back = Edge.fromNurbs(data)
  for (const t of [0, 0.3, 0.7, 1]) closeVector(back.pointAt(t), spline.pointAt(t), 1e-9)
  closeVector(spline.mirror(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)).end, { x: -10, y: 5, z: 2 }, 1e-9)
  const rounded = part.fillet(part.edges().parallelTo(Y), 3)
  const chain = rounded.faces().top().one().edges().first.tangentChain()
  assert.equal(chain.length, 8)
  for (const e of chain) assert.equal(e.owner, rounded)
  const blend = rounded.edges().filter((e) => e.convexity === 'smooth').first
  assert.equal(blend.continuity().level, 'G1')
  close(new Line(new THREE.Vector3(), new THREE.Vector3(1, 0, 0)).curvatureAt(0.5), 0, 1e-12)
  await noKernel([xs, data, back, chain])
})

test('wires and vertices', async () => {
  const w = new Polyline([new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 0, -10)])
  close(w.length, 20, 1e-9)
  closeVector(w.start, { x: 0, y: 0, z: 0 }, 1e-12)
  closeVector(w.end, { x: 10, y: 0, z: -10 }, 1e-12)
  assert.ok(w.close().isClosed)
  closeVector(w.reversed().start, w.end, 1e-12)
  close(w.fillet(2).length, 20 - 4 + Math.PI, 1e-6)
  const [a, b] = w.split(0.5)
  close(a.length + b.length, 20, 1e-9)
  assert.equal(w.vertices().length, 3)
  closeVector({ x: 0, y: Math.abs(w.plane().normal.y), z: 0 }, Y, 1e-12)
  assert.ok(w.toEdge() instanceof Edge)
  assert.ok(w.offset(1) instanceof Wire)
  const v = new Vertex(new THREE.Vector3(1, 2, 3))
  closeVector(v.point, { x: 1, y: 2, z: 3 }, 1e-12)
  close(v.y, 2)
  const corner = PLATE().vertices().first
  assert.equal(corner.edges().length, 3)
  assert.equal(corner.faces().length, 3)
  for (const e of corner.edges()) assert.equal(e.owner, corner.owner)
  await noKernel([w.vertices(), corner.edges()])
})

test('selections: groups, maxima, hits, points, history, sets, the faces of edges', async () => {
  const part = PLATE()
  const groups = part.faces().groupBy(Y)
  assert.deepEqual(groups.map((g) => g.length), [1, 4, 1])
  assert.equal(part.faces().maxBy(Y).one(), part.faces().top().one())
  assert.equal(part.faces().minBy(new THREE.Vector3(1, 0, 0)).one(), part.faces().left().one())
  const hit = part.faces().hitBy(new THREE.Ray(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0)))
  assert.equal(hit.length, 2)
  assert.equal(part.edges().atPoint(new THREE.Vector3(20, 0, 15)).length, 1)
  // edges of these faces, faces of these edges: the body's own objects
  const topEdges = part.faces().top().edges()
  assert.equal(topEdges.length, 4)
  for (const e of topEdges) assert.ok(part.edges().includes(e))
  assert.ok(topEdges.faces().every((f) => part.faces().includes(f)))
  assert.equal(part.faces().top().vertices().length, 4)
  const sides = part.faces().perpendicularTo(Y)
  assert.equal(part.faces().difference(sides).length, 2)
  assert.equal(sides.union(part.faces().top()).length, 5)
  assert.equal(sides.intersection(part.faces().front()).length, 1)
  closeVector(part.faces().top().center(), { x: 0, y: 5, z: 0 }, 1e-9)
  closeBox(part.faces().top().bbox(), box([-20, 5, -15], [20, 5, 15]))
  const rounded = part.fillet(part.edges().parallelTo(Y), 3)
  assert.equal(rounded.faces().fillets().length, 4)
  assert.equal(rounded.edges().smooth().length, 8)
  assert.equal(rounded.faces().newSince(part).length, 4)
  assert.ok(rounded.faces().derivedFrom(part.faces().top().one()).length >= 1)
  assert.equal(part.faces().filterBy('plane').length, 6)
  assert.equal(part.faces().sortByDistance(new THREE.Vector3(100, 0, 0)).first, part.faces().right().one())
  await noKernel([groups, hit, topEdges])
})

test('free functions: profiles of every kind, fillets of edges and corners, offsets, mirrors', async () => {
  const strip = extrude(new Line(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)), 5)
  assert.ok(strip instanceof Shell)
  close(strip.area, 50, 1e-9)
  closeBox(strip.bbox(), box([0, 0, 0], [10, 5, 0]))
  const cone = revolve(new Line(new THREE.Vector3(0, 10, 0), new THREE.Vector3(5, 0, 0)), new THREE.Ray(new THREE.Vector3(), Y))
  assert.ok(cone instanceof Shell)
  const tube = sweep(new Circle(1), new Line(new THREE.Vector3(), new THREE.Vector3(0, 0, -30)))
  close(tube.volume, Math.PI * 30, 1e-6)
  const lower = new Rectangle(20, 20)
  const upper = new Circle(5)
  upper.position.y = 20
  const lofted = loft([lower, upper])
  closeBox(lofted.bbox(), box([-10, 0, -10], [10, 20, 10]))
  const r = swing(new Rectangle(2, 2, { align: { x: 'min' } }).on(new THREE.Matrix4().makeRotationX(Math.PI / 2)), new Circle(10))
  assert.ok(r.volume > 0)
  const part = PLATE()
  close(fillet(part.edges().parallelTo(Y), 2).volume, part.fillet(part.edges().parallelTo(Y), 2).volume, 1e-9)
  close(chamfer(part.edges().parallelTo(Y), 2).volume, 12000 - 4 * 2 * 10, 1e-6)
  const square = new Rectangle(10, 10)
  close(fillet(square.vertices(), 2).area, 100 - 4 * (4 - Math.PI), 1e-6)
  close(chamfer(square.vertices(), 2).area, 100 - 4 * 2, 1e-6)
  close(offset(square, 1).area, 144 - 4 * (1 - Math.PI / 4), 1e-6)
  closeBox(mirror(part, new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)).bbox(), part.bbox())
  close(section(part, new THREE.Plane(Y, 0)).area, 1200, 1e-6)
  close(thicken(part.faces().top().one(), 2).volume, 2400, 1e-6)
  await noKernel([strip, cone, lofted])
})

test('holes drilled into a face with Locations, and the other primitives', () => {
  const block = new Box(40, 40, 20)
  const side = block.faces().right().one() // x = 20, its normal +x
  const holes = new Hole(2, 10).at(Locations(side))
  const drilled = block.cut(holes)
  close(drilled.volume, 40 * 40 * 20 - Math.PI * 4 * 10, 1e-6)
  const hole = drilled.faces().cylinders().one()
  closeVector({ x: Math.abs(hole.axis.direction.x), y: 0, z: 0 }, X, 1e-9)
  closeBox(new Hole(2, 10).bbox(), box([-2, -10, -2], [2, 0, 2]))
  close(new Pyramid(10, 10, 9).volume, 300, 1e-6)
  close(new AnnularSector(5, 10, 4, Math.PI / 2).volume, (Math.PI * (100 - 25) * 4) / 4, 1e-6)
  close(new CounterBoreHole(2, 4, 3, 10).volume, Math.PI * 4 * 10 + Math.PI * (16 - 4) * 3, 1e-6)
  assert.ok(new CounterSinkHole(2, 4, 10).volume > Math.PI * 4 * 10)
  const cap = new Sphere(10, { arcSize1: 0, align: { y: 'min' } }) // (the upper half, on the ground)
  closeBox(cap.bbox(), box([-10, 0, -10], [10, 10, 10]), 1e-6)
  close(new Torus(10, 2, { majorAngle: Math.PI }).volume, (2 * Math.PI ** 2 * 10 * 4) / 2, 1e-6)
  const mp = drilled.massProperties()
  assert.ok(mp instanceof MassProperties)
  assert.equal(mp.principalAxes.length, 3)
  close(mp.momentAbout(new THREE.Ray(mp.center, Y)), mp.inertia.elements[4], 1e-6)
})

test('constants', () => {
  closeVector(X, { x: 1, y: 0, z: 0 }, 0)
  closeVector(UP, { x: 0, y: 1, z: 0 }, 0)
  closeVector(Z, { x: 0, y: 0, z: 1 }, 0)
  assert.ok(Object.isFrozen(UP))
  assert.ok(TOLERANCE > 0 && TOLERANCE < 1e-3)
  close(new Box(10, 10, 10).fuse(new Box(10, 10, 10)).volume, 1000, TOLERANCE)
})

test("faces' own colors are drawn: vertex colors, and a material that shows them", () => {
  const part = PLATE()
  const colored = part.colorFaces(part.faces().top(), '#ff0000')
  const color = colored.geometry.getAttribute('color')
  assert.ok(color !== undefined)
  assert.ok((colored.material as THREE.MeshStandardMaterial).vertexColors)
  // the top face's vertices red (in three's working space), the others the body color
  const top = colored.faces().top().one()
  const c = new THREE.Color()
  const position = colored.geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    c.fromBufferAttribute(color, i)
    const onTop = Math.abs(position.getY(i) - 5) < 1e-6 && Math.abs(top.normalAt().y - 1) < 1e-9
    if (onTop && c.getHexString() === 'ff0000') return
  }
  assert.fail('no red vertex on the top face')
})
