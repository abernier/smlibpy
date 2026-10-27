// tests/test_lane_U.py: lane U of the kernel plan (phase 1): blends between sheet edges (U2),
// trimming sheets with curves on them and imprinting curves on parts (U3); fills and curve networks
// (U4), stitch with its tolerance, report and normals (U5), extending and untrimming faces (U6);
// pushing a face at a point (U7), warping and flattening a region of a face (U8); matching a sheet's
// edge to a curve (U9), merging faces (U10), analytic faces edited as their B-splines (U11), chamfers
// and two distances in surfaceFillet (U12), surfaces from NURBS data (U13), intersection curves with
// planes and of bodies that do not meet (U14), how far a fit's points lie from its surface (U15).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Axis,
  Box,
  Location,
  RegularPolygon,
  Sphere,
  Spline,
  StitchReport,
  ThreePointArc,
  fill,
  network,
  ruled,
  stitch,
  CenterArc,
  Circle,
  Cylinder,
  Edge,
  Line,
  ModelingError,
  Part,
  Plane,
  Rectangle,
  Shell,
  Sketch,
  Vector,
  X,
  Y,
  Z,
  blend,
  extrude,
  surface,
  surfaceFillet,
  FitReport,
  Wire,
  nurbsSurface,
} from '../src/index.ts'
import { ext, k } from '../src/kernel.ts'
import { Face } from '../src/shapes.ts'
import { fromSmb, toSmb } from '../src/exporters.ts'
import { approx } from './_approx.ts'

const free = (body: Shell | Part) => body.edges().filter((e) => e.faces().length === 1)

/** The largest angle (degrees) between the blend's and the sheet's normals along an edge. */
function angleAlong(bl: Shell, sheet: Shell, edge: Edge, n = 7): number {
  let worst = 0
  for (let i = 0; i < n; i++) {
    const p = edge.pointAt((i + 0.5) / n)
    const a = bl.faces()[0].normalAt(p)
    const b = sheet.faces()[0].normalAt(p)
    worst = Math.max(worst, (Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI)
  }
  return worst
}

function gapAlong(bl: Shell, edge: Edge, n = 9): number {
  let worst = 0
  for (let i = 0; i < n; i++) worst = Math.max(worst, bl.distanceTo(edge.pointAt(i / (n - 1))))
  return worst
}

function curvatures(face: { _f: number }, p: Vector): [number, number] {
  const [, uvs] = k.surface_closest_point(k.face_surface(face._f), p.toArray())
  const c = ext.face_curvatures(face._f, [uvs[0][0], uvs[0][1]]) as { k1: Float64Array; k2: Float64Array }
  return [c.k1[0], c.k2[0]]
}

/** Two flat sheets 10 apart in height whose facing edges run opposite ways. */
function steps(): [Shell, Shell, Edge, Edge] {
  const a = Rectangle(20, 20).translate(-20, 0).faces()[0].toShell()
  const b = Rectangle(20, 20).on(Plane.XY.offset(10)).translate(20, 0, 0).faces()[0].toShell()
  const ea = a.edges().filter((e) => Math.abs(e.center().x + 10) < 1e-9).one()
  const eb = b.edges().filter((e) => Math.abs(e.center().x - 10) < 1e-9).one()
  return [a, b, ea, eb]
}

// ------------------------------------------------------------------------------------- U2: blend
test('blend joins the nearest ends of edges that run opposite ways', () => {
  const [a, b, ea, eb] = steps()
  assert.ok(ea.end.sub(ea.start).dot(eb.end.sub(eb.start)) < 0)
  const s = blend(ea, eb)
  assert.ok(s instanceof Shell && s.faces().length === 1)
  const sides = s.edges().filter((e) => Math.abs(e.start.z - e.end.z) > 5)
  assert.equal(sides.length, 2)
  for (const e of sides) assert.ok(Math.abs(e.start.y - e.end.y) < 1e-6)
  approx(s.area, 466.054, 0, 1e-3)
  for (const [sheet, edge] of [[a, ea], [b, eb]] as const) {
    assert.ok(gapAlong(s, edge) < 1e-9)
    assert.ok(angleAlong(s, sheet, edge) < 1e-6)
  }
  approx(s.faces()[0].normalAt([-10, 0, 0]).z, 1)
  const joined = blend(ea, eb, { join: true })
  assert.ok(joined instanceof Shell && joined.faces().length === 3 && free(joined).length === 8)
  approx(joined.thicken(1).volume, joined.area, 1e-6)
})

test('blend continuity and tension', () => {
  const [, , ea, eb] = steps()
  const areas = Object.fromEntries((['G1', 'G2', 'G3'] as const).map((c) => [c, blend(ea, eb, { continuity: c }).area]))
  approx(areas.G1, 456.253, 0, 1e-3)
  assert.ok(areas.G1 < areas.G2 && areas.G2 < areas.G3)
  approx(blend(ea, eb, { continuity: 2 }).area, areas.G2)
  approx(blend(ea, eb, { tension: 1 }).area, areas.G2)
  approx(blend(ea, eb, { tension: 0.5 }).area, 453.474, 0, 1e-3)
  approx(blend(ea, eb, { tension: [0.5, 2] }).area, 482.976, 0, 1e-3)
  for (const [c, flat] of [['G1', false], ['G2', true], ['G3', true]] as const) {
    const [k1, k2] = curvatures(blend(ea, eb, { continuity: c }).faces()[0], ea.pointAt(0.5))
    assert.equal(Math.max(Math.abs(k1), Math.abs(k2)) < 1e-9, flat, c)
  }
})

test('blend G2 takes the curvature of a curved sheet', () => {
  const cyl = extrude(CenterArc([0, 0], 20, 0, 90), 30) as Shell
  const flat = extrude(Line([30, -20], [50, -20]), 30) as Shell
  const ea = cyl.edges().filter((e) => Math.abs(e.center().x - 20) < 1e-6 && Math.abs(e.center().y) < 1e-6).one()
  const eb = flat.edges().filter((e) => Math.abs(e.start.x - 30) < 1e-6 && Math.abs(e.end.x - 30) < 1e-6).one()
  approx(Math.max(...curvatures(cyl.faces()[0], ea.pointAt(0.5))), 0.05)
  for (const c of ['G2', 'G3'] as const) {
    for (const tension of [1, [0.5, 1.5] as const]) {
      const f = blend(ea, eb, { continuity: c, tension }).faces()[0]
      approx(Math.max(...curvatures(f, ea.pointAt(0.5))), 0.05, 0, 1e-6)
      assert.ok(Math.max(...curvatures(f, eb.pointAt(0.5)).map(Math.abs)) < 1e-9)
    }
    assert.ok(angleAlong(blend(ea, eb, { continuity: c }), cyl, ea) < 1e-6)
  }
  const g1 = blend(ea, eb, { continuity: 'G1' }).faces()[0]
  approx(Math.max(...curvatures(g1, ea.pointAt(0.5)).map(Math.abs)), 0.0306, 0, 1e-3)
})

test('blend of arcs and curved sheets', () => {
  const small = Cylinder(10, 20).split(Plane.XZ).faces().filter((f) => f.geomType === 'cylinder').one().toShell()
  const big = Cylinder(20, 20).split(Plane.XZ).translate(0, 0, 40).faces().filter((f) => f.geomType === 'cylinder').one().toShell()
  const ea = small.edges().filter((e) => e.geomType === 'circle' && e.center().z > 5).one()
  const eb = big.edges().filter((e) => e.geomType === 'circle' && e.center().z < 40).one()
  for (const c of ['G1', 'G2'] as const) {
    const s = blend(ea, eb, { continuity: c })
    assert.ok(gapAlong(s, ea) < 1e-9 && gapAlong(s, eb) < 1e-9)
    assert.ok(angleAlong(s, small, ea) < 1e-4 && angleAlong(s, big, eb) < 1e-4)
    const joined = blend(ea, eb, { continuity: c, join: true })
    assert.ok(joined.faces().length === 3 && free(joined).length === 8)
  }
  const lin = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
  const a = surface(lin(5, 0, 10).map((x) => lin(5, 0, 10).map((y) => [x, y, 0.05 * x * x + 0.02 * y * y] as [number, number, number])))
  const b = surface(lin(5, 20, 30).map((x) => lin(5, 0, 10).map((y) => [x, y, 8 + 0.3 * (x - 20) - 0.03 * (x - 20) ** 2 + 0.01 * y * y] as [number, number, number])))
  const ea2 = a.edges().filter((e) => Math.abs(e.center().x - 10) < 1e-6).one()
  const eb2 = b.edges().filter((e) => Math.abs(e.center().x - 20) < 1e-6).one()
  const s = blend(ea2, eb2)
  approx(s.area, 106.35, 0, 1e-2)
  assert.ok(angleAlong(s, a, ea2) < 1e-3 && angleAlong(s, b, eb2) < 1e-3)
})

test('blend errors', () => {
  const [a, , ea, eb] = steps()
  const raises = (f: () => unknown, type: Function, re: RegExp) => assert.throws(f, (e: Error) => e instanceof type && re.test(e.message))
  raises(() => blend(ea, ea), RangeError, /the same edge/)
  raises(() => blend(Box(10, 10, 10).edges()[0], eb), RangeError, /lies between two faces/)
  raises(() => blend(Line([0, 0], [1, 0]), eb), TypeError, /is a curve, not an edge of a sheet/)
  raises(() => blend(a as never, eb), TypeError, /takes edges of sheets/)
  raises(() => blend(ea, eb, { continuity: 'G4' as never }), RangeError, /continuity must be G1, G2 or G3/)
  raises(() => blend(ea, eb, { tension: 0 }), RangeError, /tension must be positive/)
  raises(() => blend(ea, eb, { tension: [1, 1, 1] as never }), RangeError, /one number or a pair/)
  raises(() => blend(ea, eb, { flip: true } as never), TypeError, /unexpected option/)
  const tube = Cylinder(10, 20).faces().cylinders()[0].toShell()
  raises(() => blend(tube.edges().filter((e) => e.center().z > 5).one(), eb), RangeError, /^blend: one edge is closed/) // (two closed edges are bridged)
})

// -------------------------------------------------------------------------- U3: trim and imprint
test('trim a sheet with curves on it', () => {
  const sheet = Rectangle(40, 40).faces()[0].toShell()
  const disk = sheet.trim(Circle(5).edges(), [0, 0, 0])
  assert.ok(disk instanceof Shell && disk.faces().length === 1)
  approx(disk.area, Math.PI * 25)
  const holed = sheet.trim(Circle(5).edges(), [15, 15, 0])
  approx(holed.area, 1600 - Math.PI * 25)
  assert.equal(holed.faces()[0].wires().length, 2)
  const both = sheet.trim(Circle(5).edges(), 'split')
  assert.deepEqual(both.faces().map((f) => Math.round(f.area * 1e4) / 1e4).sort((x, y) => x - y), [78.5398, 1521.4602])
  approx(sheet.area, 1600)
  assert.ok(Rectangle(40, 40).trim(Line([-20, -20], [20, 20]), [10, -10, 0]) instanceof Sketch)
  // curves that cross each other (and run past the sheet): each side is bounded by all of them
  const cross = [Line([-30, 0], [30, 0]), Line([0, -30], [0, 30])]
  for (const p of [[5, 5, 0], [-5, 5, 0], [5, -5, 0], [-5, -5, 0]] as const) {
    const quarter = sheet.trim(cross, p)
    assert.equal(quarter.faces().length, 1)
    approx(quarter.area, 400)
    assert.ok(quarter.center().x * p[0] > 0 && quarter.center().y * p[1] > 0)
  }
  assert.equal(sheet.trim(cross, 'split').faces().length, 4)
  const grid = [Line([-30, -10], [30, -10]), Line([-30, 10], [30, 10]), Line([-10, -30], [-10, 30]), Line([10, -30], [10, 30])]
  approx(sheet.trim(grid, [0, 0, 0]).area, 400)
  approx(sheet.trim(grid, [15, 15, 0]).area, 100)
  assert.equal(sheet.trim(grid, 'split').faces().length, 9)
})

test('trim a freeform sheet with a projected outline', () => {
  const f = (x: number, y: number) => 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
  const rows: [number, number, number][][] = []
  for (let x = 0; x <= 40; x += 5) {
    const row: [number, number, number][] = []
    for (let y = 0; y <= 30; y += 5) row.push([x, y, f(x, y)])
    rows.push(row)
  }
  const sheet = surface(rows)
  const on = sheet.project(CenterArc([20, 15, 50], 5, 0, 360), [0, 0, -1])
  const kept = sheet.trim(on, [20, 15, 0])
  const holed = sheet.trim(on, [2, 2, 0])
  approx(kept.area, 78.736, 0, 1e-2)
  approx(kept.area + holed.area, sheet.area, 1e-6)
  assert.equal(holed.faces()[0].wires().length, 2)
  const plate = holed.thicken(1)
  assert.ok(plate.isValid())
  approx(plate.volume, holed.area, 2e-3)
  assert.equal(sheet.trim(on, 'split').faces().length, 2)
})

test('surfaceFillet trim sews one sheet', () => {
  const floor = Rectangle(40, 40).faces()[0]
  const wall = Rectangle(40, 40).on(Plane.XZ).faces()[0]
  const one = surfaceFillet(floor, wall, 5, { trim: true })
  assert.ok(one instanceof Shell && one.faces().length === 3 && free(one).length === 8)
  approx(one.area, 600 + 600 + ((5 * Math.PI) / 2) * 40)
  assert.ok(one.thicken(1).isValid())
  const cs = one.intersectionCurves(Rectangle(200, 200).on(Plane.YZ).faces()[0].toShell())
  assert.equal(cs.length, 3)
  const half = one.trim(cs, [10, -15, 0])
  approx(half.area, one.area / 2, 1e-6)
  assert.equal(half.faces().length, 3)
  assert.equal(one.trim(cs, 'split').faces().length, 6)
  // one curve that runs across the three faces
  const chain = [...cs].sort((p, q) => p.center().z - q.center().z)
  const near = (p: Vector, q: Vector) => p.sub(q).length < 1e-6
  const oriented = [near(chain[0].end, chain[1].start) || near(chain[0].end, chain[1].end) ? chain[0] : chain[0].reversed()]
  for (const c of chain.slice(1)) oriented.push(near(c.start, oriented[oriented.length - 1].end) ? c : c.reversed())
  const curves = oriented.map((c) => c._copyCurve())
  let joined: Edge
  try {
    joined = Edge._fromCurve(ext.join_curves(curves))
  } finally {
    for (const c of curves) ext.delete_curve(c)
  }
  approx(one.trim(joined, [10, -15, 0]).area, half.area, 1e-6)
})

test('Face.split', () => {
  const floor = Rectangle(40, 40).faces()[0]
  const pieces = floor.split(Line([-20, -20], [20, 20]))
  assert.deepEqual(pieces.map((f) => Math.round(f.area * 1e6) / 1e6), [800, 800])
  assert.ok(pieces[0].owner === pieces[1].owner)
  approx(floor.area, 1600)
})

test('imprint projects curves onto the faces seen or crossed', () => {
  const box = Box(20, 20, 10)
  const ring = Circle(4).edges().translate(0, 0, 50)
  const top = box.imprint(ring, [0, 0, -1])
  assert.ok(top instanceof Part && top.faces().length === 7 && top.isValid())
  approx(top.volume, 4000)
  const [disk, rest] = top.faces().filter((f) => f.center().z > 4.9).map((f) => f.area).sort((x, y) => x - y)
  approx(disk, 16 * Math.PI, 0, 1e-4)
  approx(disk + rest, 400)
  assert.throws(() => box.imprint(ring, [0, 0, 1]), (e: Error) => e instanceof ModelingError && /miss the part/.test(e.message))
  const through = box.imprint(ring, Z.neg(), { nearest: false })
  assert.equal(through.faces().length, 8)
  approx(through.volume, 4000)
  assert.equal(box.imprint(box.project(ring[0], [0, 0, -1])).faces().length, 8)
  const rounded = Box(20, 20, 10).fillet(Box(20, 20, 10).edges().parallelTo(Z), 3)
  const r = rounded.imprint(ring, [0, 0, -1])
  assert.equal(r.faces().length, rounded.faces().length + 1)
  approx(r.volume, rounded.volume)
})

test('imprint across the seam of a cylinder', () => {
  const cyl = Cylinder(10, 40)
  const ring = CenterArc([50, 0, 0], 4, 0, 360).rotate(new Axis([50, 0, 0], [0, 1, 0]), 90)
  const r = cyl.imprint(ring, [-1, 0, 0])
  const patch = r.faces().filter((f) => f.geomType === 'cylinder' && f.area < 100)
  assert.equal(patch.length, 2)
  approx(patch[0].area + patch[1].area, 51.3366, 0, 1e-4)
  approx(r.faces().reduce((s, f) => s + f.area, 0), cyl.faces().reduce((s, f) => s + f.area, 0), 1e-7)
  approx(r.volume, cyl.volume)
  assert.ok(r.isValid())
  assert.equal(cyl.imprint(ring, [-1, 0, 0], { nearest: false }).faces().length, 6)
})

test('trim and imprint errors', () => {
  const raises = (f: () => unknown, type: Function, re: RegExp) => assert.throws(f, (e: Error) => e instanceof type && re.test(e.message))
  const sheet = Rectangle(40, 40).faces()[0].toShell()
  raises(() => sheet.trim(Circle(5).edges(), 'both'), RangeError, /or "split"/)
  raises(() => sheet.trim(Circle(5).edges().translate(0, 0, 3), 'split'), RangeError, /must lie on the faces/)
  raises(() => sheet.trim(Line([-5, 0], [5, 0]), 'split'), ModelingError, /do not split the sheet/)
  raises(() => sheet.trim(Line([-5, 0], [5, 0]), [0, 10, 0]), ModelingError, /do not cut the sheet in two/)
  raises(() => sheet.trim(Box(1, 1, 1) as never, 'split'), TypeError, /takes curves/)
  raises(() => sheet.trim([], 'split'), RangeError, /no curves/)
  const box = Box(20, 20, 10)
  raises(() => box.imprint(Circle(4).edges().translate(0, 0, 50)), RangeError, /must lie on the faces/)
  raises(() => box.imprint(Circle(4).edges().translate(100, 0, 50), [0, 0, -1]), ModelingError, /miss the part/)
  raises(() => box.imprint(Circle(4).edges(), [0, 0, 0]), RangeError, /direction must not be zero/)
  raises(() => box.imprint(Circle(4).edges(), [0, 0, -1], { closest: true } as never), TypeError, /unexpected option/)
})

// ------------------------------------------------------------------------------------- U5: stitch
function movedFaces(box: Part, amount: number): Shell[] {
  const shifts = [[1, -1, 0.5], [-0.5, 1, 1], [1, 0.5, -1], [-1, -1, 0.5], [0.5, 1, -1], [-1, 0.5, 1]]
  return box.faces().map((f, i) => f.toShell().translate(amount * shifts[i][0], amount * shifts[i][1], amount * shifts[i][2]))
}

test('stitch honours the tolerance and reports the gaps', () => {
  const pieces = movedFaces(Box(200, 100, 100), 0.03)
  const [open, r1] = stitch(pieces, { tolerance: 1e-4, report: true })
  assert.ok(open instanceof Shell && !(open instanceof Part))
  assert.ok(r1 instanceof StitchReport && r1.sewnEdges === 0 && r1.openEdges >= 24 && r1.maxGap === 0)
  const [closed, r2] = stitch(pieces, { tolerance: 0.2, report: true })
  assert.ok(closed instanceof Part && closed.isValid())
  assert.ok(r2.sewnEdges === 12 && r2.openEdges === 0 && r2.maxGap > 0.03 && r2.maxGap <= 0.2)
  const [exact, r3] = stitch(Box(10, 10, 10).faces().map((f) => f.toShell()), { report: true })
  assert.ok(exact instanceof Part)
  approx(exact.volume, 1000, 0, 1e-9)
  assert.equal(r3.maxGap, 0)
  assert.throws(() => stitch(pieces, { tolerance: 0 }), /positive distance/)
})

test('stitch returns a Part when sewn shut, also across T-junctions', () => {
  const box = Box(10, 10, 10)
  const top = box.faces().filter((f) => f.normalAt().z > 0.5)[0]
  const pieces = [...box.faces().filter((f) => !f.equals(top)).map((f) => f.toShell()), top.toShell().translate(0, 0, 0.1)]
  const [body, report] = stitch(pieces, { tolerance: 0.2, report: true })
  assert.ok(body instanceof Part && body.isValid())
  approx(report.maxGap, 0.1, 0, 1e-9)
  const [shut, r2] = stitch(pieces, { report: true })
  assert.ok(!(shut instanceof Part) && r2.openEdges === 8)
  const long = Box(20, 10, 10).translate(10, 5, 5)
  const sides = long.faces().filter((f) => !(f.normalAt().z > 0.5)).map((f) => f.toShell())
  const tops = [0, 1].map((i) => Box(10, 10, 10).translate(5 + 10 * i, 5, 5).faces().filter((f) => f.normalAt().z > 0.5)[0].toShell())
  const tee = stitch(...sides, ...tops, { tolerance: 1e-3 })
  assert.ok(tee instanceof Part)
  approx(tee.volume, 2000, 0, 1e-6)
})

test('stitch turns open sheets to agree', () => {
  const floor = ruled(Line([0, 0, 0], [10, 0, 0]), Line([0, 10, 0], [10, 10, 0]))
  const wall = ruled(Line([0, 10, 10], [10, 10, 10]), Line([0, 10, 0], [10, 10, 0]))
  const [sheet, report] = stitch(floor, wall, { report: true })
  assert.equal(report.turnedFaces, 1)
  const plate = (sheet as Shell).thicken(1)
  assert.ok(plate.isValid())
  approx(plate.volume, 190, 0, 1e-6)
  approx((stitch(wall, floor) as Shell).thicken(1).volume, 210, 0, 1e-6)
})

test('flipped', () => {
  const sheet = Rectangle(10, 20).faces()[0].toShell()
  const turned = sheet.flipped()
  approx(turned.area, 200)
  approx(turned.faces()[0].normalAt().z, -1)
  approx(turned.flipped().faces()[0].normalAt().z, 1)
  approx(turned.thicken(2).bbox().min.z, -2)
  const face = Box(10, 10, 10).faces().filter((f) => f.normalAt().x > 0.5)[0]
  approx(face.flipped().faces()[0].normalAt().x, -1)
  const hemi = Sphere(5).intersect(Box(20, 20, 20).translate(0, 0, 10)).faces().filter((f) => f.geomType === 'sphere')[0]
  approx(hemi.flipped().faces()[0].normalAt([0, 0, 5]).z, -1)
  assert.throws(() => Sphere(5).faces()[0].toShell().flipped(), /encloses a volume/)
  const sk = Rectangle(10, 10).flipped()
  assert.ok(sk instanceof Sketch)
  approx(sk.plane.zDir.z, -1)
  approx(sk.extrude(3).bbox().min.z, -3)
})

// ------------------------------------------------------------------------------------- U6: extend
test('extended planes stay planes', () => {
  const top = Box(10, 10, 10).faces().filter((f) => f.normalAt().z > 0.5)[0]
  const grown = top.extend(3)
  assert.equal(grown.faces()[0].geomType, 'plane')
  approx(grown.area, 256)
  const side = top.edges().maxBy((e) => e.center().x)
  const one = top.extend(3, { sides: side })
  approx(one.area, 130)
  approx(one.bbox().max.x, 8)
  approx(Circle(5).faces()[0].extend(1).area, 144)
  approx(Circle(5).faces()[0].untrimmed().area, 100)
})

test('extended cylinders and spheres continue as themselves', () => {
  const cyl = Cylinder(5, 10).faces().filter((f) => f.geomType === 'cylinder')[0]
  const grown = cyl.extend(2)
  assert.equal(grown.faces()[0].geomType, 'cylinder')
  approx(grown.area, 2 * Math.PI * 5 * 14, 1e-9)
  approx(grown.bbox().max.z, 7)
  const seam = cyl.edges({ seams: true }).filter((e) => e.geomType === 'line')
  assert.throws(() => cyl.extend(2, { sides: seam }), /closes around/)
  const cap = Sphere(5).intersect(Box(4, 4, 4).translate(0, 0, 4)).faces().filter((f) => f.geomType === 'sphere')[0]
  const g2 = cap.extend(1)
  assert.equal(g2.faces()[0].geomType, 'sphere')
  assert.ok(g2.area > cap.area)
})

test('extended B-spline sheets by the distance; untrimmed', () => {
  const rows = [0, 5, 10, 15, 20].map((x) => [0, 5, 10, 15, 20].map((y) => [x, y, 0.05 * (x - 10) ** 2] as [number, number, number]))
  const sheet = surface(rows)
  for (const continuity of ['natural', 'G1', 'G2'] as const) {
    const b = sheet.extend(3, { continuity }).bbox()
    approx(b.min.y, -3, 0, 1e-6)
    approx(b.max.y, 23, 0, 1e-6)
  }
  const cut = Box(20, 20, 20).cut(Cylinder(4, 40))
  const whole = cut.faces().filter((f) => f.geomType === 'cylinder')[0].untrimmed()
  approx(whole.area, 2 * Math.PI * 4 * 40, 1e-9)
  approx(whole.bbox().max.z, 20)
  assert.throws(() => (stitch(sheet, sheet.translate(20, 0, 0)) as Shell).extend(1), /2 faces/)
  assert.throws(() => sheet.extend(0), /positive/)
  assert.throws(() => sheet.extend(1, { continuity: 'G3' as never }), /continuity/)
})

// ------------------------------------------------------------------------------------- U4: fill, network
function bulgedSquare(): Edge[] {
  return [
    Spline([0, 0, 0], [5, 0, 2], [10, 0, 0]),
    Spline([10, 0, 0], [10, 5, 1], [10, 10, 0]),
    Spline([10, 10, 0], [5, 10, 2], [0, 10, 0]),
    Spline([0, 10, 0], [0, 5, 1], [0, 0, 0]),
  ]
}

test('fill: four curves make a Coons patch, three and five an N-sided fill', () => {
  const [a, b, c, d] = bulgedSquare()
  const patch = fill([a, b, c, d])
  assert.equal(patch.faces().length, 1)
  approx(patch.area, 112.2176, 0, 1e-4)
  for (const curve of [a, b, c, d]) for (let i = 0; i <= 8; i++) assert.ok(patch.distanceTo(curve.pointAt(i / 8)) < 1e-6)
  approx(patch.bbox().max.z, 3, 0, 1e-6)
  approx(fill([c, a.reversed(), d, b]).area, patch.area, 0, 1e-6)
  const r = 10
  const s = r / Math.SQRT2
  const arcs = [ThreePointArc([r, 0, 0], [s, s, 0], [0, r, 0]), ThreePointArc([0, r, 0], [0, s, s], [0, 0, r]), ThreePointArc([0, 0, r], [s, 0, s], [r, 0, 0])]
  const three = fill(arcs)
  assert.equal(three.faces().length, 3)
  assert.equal(free(three).length, 6)
})

test('fill a hole tangent to the sheet', () => {
  const cut = Sphere(10).cut(Box(30, 30, 30).translate(0, 0, 8 + 15))
  const sheet = stitch(cut.faces().filter((f) => f.geomType === 'sphere')) as Shell
  const rim = free(sheet)
  const cap = fill(rim)
  let worst = 0
  for (const e of rim) {
    for (const t of [0.1, 0.5, 0.9]) {
      const p = e.pointAt(t)
      const dot = sheet.faces()[0].normalAt(p).dot(cap.faces()[0].normalAt(p))
      assert.ok(dot > 0)
      worst = Math.max(worst, (Math.acos(Math.min(1, dot)) * 180) / Math.PI)
    }
  }
  assert.ok(worst < 0.1)
  const ball = stitch(sheet, cap)
  assert.ok(ball instanceof Part && ball.isValid() && ball.volume > 4141 && ball.volume < 4188.8)
  const g = surface([-20, -15, -10, -5, 0, 5, 10, 15, 20].map((x) => [-20, -15, -10, -5, 0, 5, 10, 15, 20].map((y) => [x, y, 0.02 * (x * x + y * y)] as [number, number, number])))
  const hole = stitch(Box(100, 100, 100).cut(RegularPolygon(5, 5).extrude(100, { both: true })).intersect(g as any)) as Shell
  const pentagon = free(hole).filter((e) => e.center().x ** 2 + e.center().y ** 2 < 100)
  assert.equal(fill(pentagon).faces().length, 5)
})

// Turned, the sphere is the same sphere with its seam and poles elsewhere, and the rims of its holes
// come in one, two or three pieces, wherever the Boolean cut them. A rim of one edge, or of two equal
// halves, was filled 19.5 degrees off (the kernel's Coons patch left two of the four equal arcs on
// their own interval), and where the pieces ended made the patch's corners (a flatter cap, 4124.35,
// for a rim in three).
function filledHoles(turn: Location): [Part, number][] {
  const ball = Sphere(10).moved(turn)
  const holes: [number, number, number][] = [[0, 0, 23], [0, 0, -23], [23, 0, 0], [-23, 0, 0], [0, 23, 0], [0, -23, 0]]
  return holes.map((at) => {
    const sheet = stitch(ball.cut(Box(30, 30, 30).translate(...at)).faces().filter((f) => f.geomType === 'sphere')) as Shell
    const rim = free(sheet)
    const cap = fill(rim)
    assert.equal(cap.faces().length, 1)
    let worst = 0
    for (const e of rim) {
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const p = e.pointAt(t)
        const dot = sheet.faces()[0].normalAt(p).dot(cap.faces()[0].normalAt(p))
        assert.ok(dot > 0) // the cap faces out with the sphere
        worst = Math.max(worst, (Math.acos(Math.min(1, dot)) * 180) / Math.PI)
      }
    }
    return [stitch(sheet, cap) as Part, worst]
  })
}

test('fill closes the holes of a turned sphere alike', () => {
  // as smlibpy-three's Ball turns the kernel's sphere (its poles on y), and a quarter turn about z
  for (const turn of [new Location(), Location.about(Z, 90), Location.about(Y, 180).mul(Location.about(X, -90))]) {
    for (const [ball, worst] of filledHoles(turn)) {
      assert.ok(worst < 0.05)
      assert.ok(ball instanceof Part && ball.isValid())
      approx(ball.volume, 4141.5814, 0, 1e-3) // four equal quarters of the rim
    }
  }
  // by any angle the rims' pieces end elsewhere, and the patches' corners with them
  for (const [ball, worst] of filledHoles(Location.about(new Axis([0, 0, 0], [1, 2, 3]), 37))) {
    assert.ok(worst < 0.05)
    assert.ok(ball instanceof Part && ball.isValid())
    approx(ball.volume, 4141.58, 2e-3)
  }
})

test('fill errors', () => {
  const [a, b, c] = bulgedSquare()
  assert.throws(() => fill([a, b, c]), /do not close/)
  const sheet = Rectangle(10, 10).faces()[0].toShell()
  assert.throws(() => fill([...free(sheet).slice(0, 3), Line([-5, 5, 0], [-5, -5, 0])]), /mixed/)
  assert.throws(() => fill(Box(10, 10, 10).faces()[0].edges()), /between two faces/)
  const wall = Cylinder(5, 20).faces().filter((f) => f.geomType === 'cylinder')[0].toShell()
  const top = free(wall).filter((e) => e.center().z > 0)
  // (natively the patch folds back over the wall; in the wasm it comes out at 90 degrees to it)
  assert.throws(() => fill(top), (e: unknown) => e instanceof ModelingError && /folds back|not tangentially/.test((e as Error).message))
  approx(fill(top, { tangent: false }).area, Math.PI * 25, 1e-6)
})

function networkCurves(): [Edge[], Edge[], (x: number, y: number) => number] {
  const h = (x: number, y: number) => Math.sin((Math.PI * x) / 10) * (1 + (0.3 * y) / 10) + 0.5 * Math.sin((Math.PI * y) / 10)
  const us = [0, 5, 10].map((y) => Spline(...[0, 2, 5, 7.5, 10].map((x) => [x, y, h(x, y)] as [number, number, number])))
  const vs = [0, 5, 10].map((x) => Spline(...[0, 3, 5, 8, 10].map((y) => [x, y, h(x, y)] as [number, number, number])))
  return [us, vs, h]
}

test('network runs through its curves', () => {
  const [us, vs, h] = networkCurves()
  const sheet = network(us, vs)
  let deviation = 0
  for (const c of [...us, ...vs]) for (let i = 0; i <= 32; i++) deviation = Math.max(deviation, sheet.distanceTo(c.pointAt(i / 32)))
  assert.ok(deviation < 1e-6)
  assert.ok(sheet.faces()[0].normalAt().z > 0.99)
  approx(network([us[2], us[0].reversed(), us[1]], [vs[1], vs[0], vs[2].reversed()]).area, sheet.area, 0, 1e-6)
  assert.throws(() => network(us, [vs[0]]), /at least two/)
  assert.throws(() => network(us, [vs[0], vs[1], vs[2].translate(0, 0, 1)]), /do not cross/)
  assert.throws(() => network(us, [vs[0], Spline(...[-3, 0, 5, 10].map((y) => [5, y, h(5, y)] as [number, number, number])), vs[2]]), /past the outer/)
})

// ---------------------------------------------------------------------- U7: push

const topOf = (part: Part | Shell): Face => part.faces().sortBy(Axis.Z).at(-1)!

/** The height of a face over (x, y), along a vertical ray from below. */
function zAt(face: Face, x: number, y: number): number {
  const hits = face.raycast([x, y, -100], [0, 0, 1])
  assert.ok(hits.length > 0, `${x}, ${y}`)
  return hits[hits.length - 1].point.z
}

test('push moves the point exactly and nothing else', () => {
  const box = Box(60, 40, 20)
  const top = topOf(box)
  const p = box.push(top, [0, 0, 10], { by: 5, radius: 15 })
  const f = topOf(p)
  assert.ok(p.isValid())
  assert.equal(p.faces().length, 6)
  assert.equal(f.geomType, 'bspline')
  assert.ok(f.distanceTo([0, 0, 15]) < 1e-9)
  approx(p.bbox().max.z, 15, 0, 1e-9)
  approx(p.volume, 48500, 0, 1e-6)
  approx(zAt(f, 20, 0), 10, 0, 1e-12)
  approx(zAt(f, 0, 16), 10, 0, 1e-12)
  for (const e of f.edges()) {
    for (const t of [0, 0.3, 0.5, 0.8]) assert.ok(Math.abs(e.pointAt(t).z - 10) < 1e-12)
    for (const t of [0.1, 0.5, 0.9]) assert.ok(f.distanceTo(e.pointAt(t)) < 1e-9)
  }
  assert.equal(p.faces().filter((g) => g.geomType === 'plane').length, 5)
  approx(box.volume, 48000)
})

test('push to a point with a normal', () => {
  const box = Box(60, 40, 20)
  const p = box.push(topOf(box), [5, 3, 10], { to: [5, 3, 13], normal: [0.2, 0, 1], radius: 10 })
  const f = topOf(p)
  assert.ok(f.distanceTo([5, 3, 13]) < 1e-9)
  approx(f.normalAt([5, 3, 13]).dot(new Vector(0.2, 0, 1).normalized()), 1, 0, 1e-9)
  for (const face of box.faces()) {
    const n = face.normalAt()
    const tilted = n.add(new Vector(0.1, 0.1, 0.1)).normalized()
    const r = box.push(face, face.center(), { by: 3, radius: 6, normal: tilted })
    const g = r.faces().filter((h) => h.geomType === 'bspline')[0]
    assert.ok(r.volume > box.volume + 40 && r.isValid())
    approx(g.normalAt(face.center().add(n.mul(3))).dot(tilted), 1, 0, 1e-9)
  }
  const q = box.push(topOf(box), [0, 0, 10], { by: [0, 0, -4], radius: 12 })
  approx(q.bbox().max.z, 10)
  assert.ok(topOf(q).distanceTo([0, 0, 6]) < 1e-9)
  assert.ok(q.volume < 48000)
})

test('push continuity at the edges it reaches', () => {
  const box = Box(60, 40, 20)
  const g1 = box.push(topOf(box), [0, 0, 10], { by: 5, radius: 30 })
  const g2 = box.push(topOf(box), [0, 0, 10], { by: 5, radius: 30, continuity: 'G2' })
  const g0 = box.push(topOf(box), [0, 0, 10], { by: 5, radius: 30, continuity: 'G0' })
  approx(g1.volume, 49833.333333, 0, 1e-4)
  approx(g2.volume, 49500, 0, 1e-4)
  assert.ok(g0.isValid() && g1.isValid() && g2.isValid())
  for (const p of [g1, g2]) {
    const f = topOf(p)
    for (const y of [-19.999, 19.999]) assert.ok(f.normalAt([0, y, 10]).z > 0.9999)
  }
})

test('push refuses to move a hole and shrinks by default', () => {
  const part = Box(60, 40, 20).cut(Cylinder(4, 40).translate(10, 0, 0))
  const top = part.faces().filter((f) => f.geomType === 'plane').sortBy(Axis.Z).at(-1)!
  assert.throws(() => part.push(top, [0, 0, 10], { by: 3, radius: 8 }), /reaches an edge of the face/)
  for (const p of [part.push(top, [0, 0, 10], { by: 3, radius: 5 }), part.push(top, [0, 0, 10], { by: 3 })]) {
    assert.ok(p.isValid())
    const hole = p.faces().filter((f) => f.geomType === 'cylinder')[0]
    const f = p.faces().filter((g) => g.geomType === 'bspline')[0]
    assert.ok(f.distanceTo([0, 0, 13]) < 1e-9)
    const rim = hole.edges().filter((e) => e.center().z > 0)
    assert.ok(rim.length > 0)
    for (const e of rim) for (const t of [0, 0.25, 0.5, 0.75]) assert.ok(f.distanceTo(e.pointAt(t)) < 1e-9)
  }
})

test('push a cylinder across its quarter turn stays smooth', () => {
  const c = Cylinder(10, 40)
  const side = c.faces().filter((f) => f.geomType === 'cylinder')[0]
  const p = c.push(side, [0, 10, 5], { by: 2, radius: 6 })
  const f = p.faces().filter((g) => g.geomType === 'bspline')[0]
  assert.ok(p.isValid())
  assert.ok(f.distanceTo([0, 12, 5]) < 1e-9)
  approx(p.bbox().max.y, 12, 0, 1e-9)
  approx(p.volume, 12599.44, 0, 0.01)
  const steps: number[] = []
  let prev: Vector | null = null
  for (let i = -40; i <= 40; i++) {
    const a = ((90 + i * 0.05) * Math.PI) / 180
    const [q] = k.face_closest_point(f._f, [14 * Math.cos(a), 14 * Math.sin(a), 6]) as [[number, number, number], number]
    const n = f.normalAt(q)
    if (prev) steps.push((Math.acos(Math.min(1, n.dot(prev))) * 180) / Math.PI)
    prev = n
  }
  const sorted = [...steps].sort((a, b) => a - b)
  assert.ok(Math.max(...steps) < 3 * sorted[Math.floor(steps.length / 2)] + 1e-6)
  assert.ok(f.distanceTo([10, 0, -15]) < 1e-9 && f.distanceTo([0, -10, 15]) < 1e-9)
})

test('push a sphere and a sheet', () => {
  const s = Sphere(10)
  const f0 = s.faces()[0]
  const at = new Vector((k.face_closest_point(f0._f, [7.0710678, 7.0710678, 0]) as [[number, number, number], number])[0])
  const p = s.push(f0, at, { by: -1.5, radius: 4 })
  assert.ok(p.isValid() && p.faces()[0].distanceTo(at.mul(8.5 / 10)) < 1e-9)
  approx(p.volume, 4178.0, 0, 0.01)
  const rows = [0, 10, 20, 30, 40, 50, 60].map((x) => [0, 10, 20, 30, 40, 50, 60].map((y) => [x, y, 2 * Math.sin(x / 10) * Math.cos(y / 15)] as [number, number, number]))
  const sheet = surface(rows)
  const f = sheet.faces()[0]
  const a = new Vector((k.face_closest_point(f._f, [30, 30, 0]) as [[number, number, number], number])[0])
  const out = sheet.push(f, a, { by: [0, 0, 5], radius: 12, normal: [1, 0, 1] })
  assert.ok(out instanceof Shell && !(out instanceof Part))
  const g = out.faces()[0]
  assert.ok(g.distanceTo(a.add(new Vector(0, 0, 5))) < 1e-9)
  approx(g.normalAt(a.add(new Vector(0, 0, 5))).dot(new Vector(1, 0, 1).normalized()), 1, 0, 1e-9)
  for (const e of f.edges()) for (const t of [0.2, 0.5, 0.8]) assert.ok(g.distanceTo(e.pointAt(t)) < 1e-9)
})

test('push survives a copy and the native format', () => {
  const p = Box(60, 40, 20).push(topOf(Box(60, 40, 20)), [0, 0, 10], { by: 5, radius: 15 })
  const back = fromSmb(toSmb(p)) as Part
  approx(back.bbox().max.z, 15, 0, 1e-9)
  approx(back.volume, 48500, 0, 1e-6)
  approx(topOf(back).toShell().bbox().max.z, 15, 0, 1e-9)
})

test('push errors', () => {
  const box = Box(60, 40, 20)
  const top = topOf(box)
  assert.throws(() => box.push(top, [0, 0, 10], { by: 1, to: [0, 0, 12] }), /not both/)
  assert.throws(() => box.push(top, [0, 0, 10]), /give the move/)
  assert.throws(() => box.push(top, [0, 0, 10], { by: 1, continuity: 'G3' as never }), /continuity/)
  assert.throws(() => box.push(top, [0, 0, 10], { by: 1, radius: 0 }), /radius/)
  assert.throws(() => box.push(topOf(Box(5, 5, 5).translate(100, 0, 0)), [100, 0, 2.5], { by: 1 }), /not a face of this part/)
  assert.throws(() => box.push(box.edges()[0] as unknown as Face, [0, 0, 10], { by: 1 }), TypeError)
  assert.throws(() => box.push(top, [30, 0, 10], { by: 1 }), /on an edge of the face/)
  assert.throws(() => box.push(top, [0, 0, 10], { by: 1, normal: [0, 0, -1] }), /same side|tilts/)
  assert.throws(() => box.push(top, [0, 0, 10], { by: 1, nope: 1 } as never), TypeError)
  const moved = box.push(top, [0, 0, 10], { by: 1, radius: 5 })
  assert.ok(moved.push(box.faces().sortBy(Axis.X)[0], [-30, 0, 0], { by: 1, radius: 5 }).isValid())
})

// -------------------------------------------------------------- U8: warp and flatten

test('warp raises a region by the height', () => {
  const box = Box(60, 40, 20)
  const top = topOf(box)
  const vols: Record<string, number> = {}
  for (const cont of ['G2', 'G1', 'crease'] as const) {
    const w = box.warp(top, Rectangle(20, 16).on(top), 4, { continuity: cont })
    assert.ok(w.isValid())
    approx(w.bbox().max.z, 14, 0, 1e-9)
    const f = topOf(w)
    approx(zAt(f, 25, 15), 10, 0, 1e-12)
    approx(zAt(f, 10.5, 0), 10, 0, 1e-12)
    assert.ok(zAt(f, 0, 0) > 13.8)
    vols[cont] = w.volume
    if (cont === 'G2') approx(zAt(f, 0, 0), 14, 0, 1e-9)
  }
  approx(vols.G2, 48148.027, 0, 1e-3)
  assert.ok(vols.G2 < vols.G1 && vols.G1 < vols.crease)
  const w = box.warp(top, Circle(8).on(top), -3)
  approx(w.bbox().min.z, -10)
  assert.ok(topOf(w).distanceTo([0, 0, 7]) < 1e-9)
  const pts: [number, number, number][] = [[-10, -8, 10], [10, -8, 10], [10, 8, 10], [-10, 8, 10]]
  approx(box.warp(top, pts, [0, 0, 4]).volume, vols.G2, 0, 1e-6)
})

test('warp a cylinder and a sheet', () => {
  const c = Cylinder(10, 40)
  const side = c.faces().filter((f) => f.geomType === 'cylinder')[0]
  const near = ([[60, -6], [120, -6], [120, 6], [60, 6]] as [number, number][]).map(
    ([a, z]) => [10 * Math.cos((a * Math.PI) / 180), 10 * Math.sin((a * Math.PI) / 180), z] as [number, number, number])
  const w = c.warp(side, near, 3)
  assert.ok(w.isValid())
  approx(w.bbox().max.y, 13, 0, 1e-9)
  assert.ok(w.faces().filter((f) => f.geomType === 'bspline')[0].distanceTo([10, 0, -15]) < 1e-9)
  const rows = [0, 10, 20, 30, 40].map((x) => [0, 10, 20, 30, 40].map((y) => [x, y, 0.02 * (x - 20) ** 2] as [number, number, number]))
  const sheet = surface(rows)
  const g = sheet.faces()[0]
  const region = ([[12, 12], [28, 12], [28, 28], [12, 28]] as [number, number][]).map(
    ([x, y]) => new Vector((k.face_closest_point(g._f, [x, y, 0]) as [[number, number, number], number])[0]))
  const out = sheet.warp(g, region, [0, 0, 2])
  assert.ok(out instanceof Shell)
  let lift = -Infinity
  for (let x = 14; x <= 26; x++) for (let y = 14; y <= 26; y++) lift = Math.max(lift, out.faces()[0].raycast([x, y, 50], [0, 0, -1])[0].point.z - 0.02 * (x - 20) ** 2)
  approx(lift, 2, 0, 1e-3)
})

test('flatten presses a region onto a plane', () => {
  const box = Box(60, 40, 20)
  const top = topOf(box)
  const fl = box.flatten(top, Rectangle(20, 16).on(top), Plane.XY.offset(8))
  const f = topOf(fl)
  assert.ok(fl.isValid())
  approx(fl.volume, 47577.5, 0, 1e-6)
  for (const [x, y] of [[0, 0], [-6, 0], [6, 4], [0, -4]]) approx(zAt(f, x, y), 8, 0, 1e-12)
  approx(zAt(f, 25, 15), 10, 0, 1e-12)
  const rows: [number, number, number][][] = []
  for (let x = 0; x <= 60; x += 5) {
    const row: [number, number, number][] = []
    for (let y = 0; y <= 60; y += 5) row.push([x, y, 3 * Math.sin(x / 9) * Math.cos(y / 11)])
    rows.push(row)
  }
  const sheet = surface(rows)
  const g = sheet.faces()[0]
  const region = ([[20, 20], [40, 20], [40, 40], [20, 40]] as [number, number][]).map(
    ([x, y]) => new Vector((k.face_closest_point(g._f, [x, y, 0]) as [[number, number, number], number])[0]))
  const out = sheet.flatten(g, region, Plane.XY)
  const h = out.faces()[0]
  for (const [x, y] of [[30, 30], [25, 25], [34, 33]]) approx(h.raycast([x, y, 50], [0, 0, -1])[0].point.z, 0, 0, 1e-9)
  for (const e of g.edges()) for (const t of [0.1, 0.5, 0.9]) assert.ok(h.distanceTo(e.pointAt(t)) < 1e-9)
})

test('warp and flatten errors', () => {
  const box = Box(60, 40, 20)
  const top = topOf(box)
  const holed = Box(60, 40, 20).cut(Cylinder(4, 40).translate(10, 0, 0))
  const holedTop = holed.faces().filter((f) => f.geomType === 'plane').sortBy(Axis.Z).at(-1)!
  assert.throws(() => holed.warp(holedTop, Rectangle(30, 16).translate(5, 0).on(holedTop), 3), /reaches an edge of the face/)
  assert.throws(() => holed.flatten(holedTop, Rectangle(30, 16).translate(5, 0).on(holedTop), Plane.XY.offset(8)), /reaches an edge of the face/)
  assert.ok(holed.warp(holedTop, Rectangle(14, 12).translate(-5, 0).on(holedTop), 3).isValid())
  assert.throws(() => box.warp(top, Rectangle(10, 10).on(Plane.XY.offset(15)), 4), /does not lie on the face/)
  assert.throws(() => box.warp(top, Line([0, 0, 10], [5, 0, 10]), 4), /not closed/)
  assert.throws(() => box.warp(top, Rectangle(10, 10).on(top), 4, { continuity: 'G3' as never }), /continuity/)
  assert.throws(() => box.flatten(top, Rectangle(10, 10).on(top), Plane.XY.offset(10)), /nothing to flatten/)
  assert.throws(() => box.warp(top, 5 as never, 4), TypeError)
})


// ---------------------------------------------------------------------- U9: matchEdge

const wave = (x: number, y: number) => 2 * Math.sin(x / 10) + 0.005 * y * y
const lin = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
const waveSheet = () => surface(lin(0, 30, 7).map((x) => lin(0, 20, 6).map((y) => [x, y, wave(x, y)] as [number, number, number])))
const byY = (body: Shell, last = true): Edge => {
  const edges = [...body.edges()].sort((a, b) => a.center().y - b.center().y)
  return last ? edges[edges.length - 1] : edges[0]
}
const lifted = (edge: Edge, lift: (t: number) => Vector, n = 21) => Spline(...lin(0, 1, n).map((t) => edge.pointAt(t).add(lift(t))))
const offCurve = (curve: Edge, edge: Edge, n = 11) => Math.max(...lin(0, 1, n).map((t) => curve.distanceTo(edge.pointAt(t))))
const halvesOf = (whole: Shell) => whole.trim(whole.intersectionCurves(new Plane([15, 0, 0], [0, 1, 0], [1, 0, 0])), 'split')

test('matchEdge puts the edge on the curve and changes the face near it only', () => {
  const sheet = waveSheet()
  const top = byY(sheet)
  const bottom = byY(sheet, false)
  const target = lifted(top, (t) => new Vector(0, 0, 3 * Math.sin(Math.PI * t)))
  const out = sheet.matchEdge(top, target, { extent: 0.3 })
  assert.ok(out instanceof Shell && out.faces().length === 1 && out.edges().length === 4)
  assert.ok(offCurve(target, byY(out)) < 1e-9)
  const newBottom = byY(out, false)
  assert.ok(Math.max(...lin(0, 1, 11).map((t) => newBottom.pointAt(t).sub(bottom.pointAt(t)).length)) < 1e-12)
  for (const x of [3, 15, 27]) for (const y of [2, 9]) assert.ok(out.distanceTo(sheet.closestPoint([x, y, wave(x, y)])) < 1e-9)
  assert.ok(out.area > sheet.area + 5)
  assert.ok(out.thicken(1).isValid())
  approx(sheet.matchEdge(top, target.reversed(), { extent: 0.3 }).area, out.area, 1e-12)
})

test('matchEdge moves the ends and the side edges with them', () => {
  const sheet = waveSheet()
  const top = byY(sheet)
  const target = lifted(top, () => new Vector(0, 1, 2))
  const out = sheet.matchEdge(top, target)
  const newTop = byY(out)
  const ends = [newTop.start, newTop.end]
  for (const p of [target.start, target.end]) assert.ok(Math.min(...ends.map((q) => q.sub(p).length)) < 1e-9)
  for (const e of out.edges()) assert.ok(Math.max(...lin(0, 1, 9).map((t) => out.faces()[0].distanceTo(e.pointAt(t)))) < 1e-9)
  assert.ok(out.thicken(1).isValid())
})

test('matchEdge closes a gap before stitch', () => {
  const a = waveSheet()
  const b = surface(lin(0, 30, 7).map((x) => lin(20.2, 40, 5).map((y) => [x, y, wave(x, y) + 0.4] as [number, number, number])))
  const [, before] = stitch(a, b, { tolerance: 1e-6, report: true })
  assert.equal(before.sewnEdges, 0)
  const matched = a.matchEdge(byY(a), byY(b, false))
  const [body, after] = stitch(matched, b, { tolerance: 1e-6, report: true })
  assert.equal(after.sewnEdges, 1)
  assert.ok(after.maxGap < 1e-6 && free(body).length === 6)
})

test('matchEdge carries a moved corner into the next face', () => {
  const halves = halvesOf(waveSheet())
  const left = [...halves.faces()].sort((p, q) => p.center().x - q.center().x)[0]
  const top = [...left.edges()].sort((p, q) => p.center().y - q.center().y).at(-1)!
  const target = lifted(top, (t) => new Vector(0, 0, 1 + Math.sin(Math.PI * t)), 15)
  const out = halves.matchEdge(top, target)
  assert.equal(out.faces().length, 2)
  assert.equal(free(out).length, 6)
  const shared = out.edges().filter((e) => e.faces().length === 2)
  assert.equal(shared.length, 1)
  assert.ok(Math.min(shared[0].start.sub(target.end).length, shared[0].end.sub(target.end).length) < 1e-9)
  for (const f of out.faces()) for (const e of f.edges()) assert.ok(Math.max(...lin(0, 1, 9).map((t) => f.distanceTo(e.pointAt(t)))) < 1e-9)
  const right = [...out.faces()].sort((p, q) => p.center().x - q.center().x)[1]
  const whole = waveSheet()
  for (const [x, y] of [[28, 18], [25, 19], [22, 2]]) assert.ok(right.distanceTo(whole.closestPoint([x, y, wave(x, y)])) < 1e-9)
  assert.ok(right.distanceTo(whole.closestPoint([16, 19, wave(16, 19)])) > 0.1)
})

test('matchEdge of a plane face is exact', () => {
  const plate = Rectangle(20, 10)
  const top = [...plate.edges()].sort((p, q) => p.center().y - q.center().y).at(-1)!
  const out = plate.matchEdge(top, ThreePointArc([-10, 5], [0, 8], [10, 5]), { extent: 0.5 })
  assert.ok(out.constructor === Shell && out.faces()[0].geomType === 'bspline')
  const r = (100 + 9) / 6
  const theta = 2 * Math.asin(10 / r)
  approx(out.area, 200 + ((r * r) / 2) * (theta - Math.sin(theta)), 1e-9)
  approx(out.bbox().max.y, 8, 0, 1e-9)
})

test('matchEdge errors', () => {
  const sheet = waveSheet()
  const top = byY(sheet)
  const target = lifted(top, () => new Vector(0, 0, 1))
  for (const extent of [0, 1, -0.5]) assert.throws(() => sheet.matchEdge(top, target, { extent }), /extent/)
  const holed = Rectangle(20, 20).cut(Circle(3))
  const holedTop = [...holed.edges()].sort((p, q) => p.center().y - q.center().y).at(-1)!
  assert.throws(() => holed.matchEdge(holedTop, Line([-10, 11], [10, 11])), /hole/)
  assert.throws(() => sheet.matchEdge(Line([0, 0, 50], [1, 0, 50]), target), /not an edge of this sheet/)
  assert.throws(() => sheet.matchEdge(top, 5 as unknown as Edge), TypeError)
  assert.throws(() => sheet.matchEdge(top, new Wire(Rectangle(4, 4).edges())), /closed wire/)
  assert.throws(() => sheet.matchEdge(top, target, { extend: 0.2 } as never), TypeError)
  const big = nurbsSurface([[[0, 0, 0], [0, 10, 0]], [[20, 0, 0], [20, 10, 0]]], null, 1)
  const small = [0, 10].map((x0) => nurbsSurface([[[x0, 10, 0], [x0, 20, 0]], [[x0 + 10, 10, 0], [x0 + 10, 20, 0]]], null, 1))
  const tee = stitch(big, ...small) as Shell
  const partOfSide = tee.edges().filter((e) => e.faces().length === 2 && Math.abs(e.center().y - 10) < 1e-9)
  assert.equal(partOfSide.length, 2)
  assert.throws(() => tee.matchEdge(partOfSide[0], Line([0, 10, 1], [10, 10, 1])), /only a part of a side/)
})

// ---------------------------------------------------------------------- U10: mergeFaces

test('mergeFaces gives the split sheet back', () => {
  const whole = waveSheet()
  const halves = halvesOf(whole)
  assert.equal(halves.faces().length, 2)
  const merged = halves.mergeFaces(halves.faces()[0], halves.faces()[1])
  assert.equal(merged.faces().length, 1)
  assert.equal(merged.edges().length, 4)
  approx(merged.area, whole.area, 1e-9)
  const d0 = ext.surface_data(k.face_surface(whole.faces()[0]._f), true)
  const d1 = ext.surface_data(k.face_surface(merged.faces()[0]._f), true)
  assert.equal(d1.poles.length, d0.poles.length)
  for (const x of [2, 14, 16, 29]) for (const y of [1, 10, 19]) approx(merged.distanceTo([x, y, wave(x, y)]), whole.distanceTo([x, y, wave(x, y)]), 0, 1e-7)
  assert.ok(merged.thicken(1).isValid())
})

test('matchEdge and mergeFaces keep the normals of a turned sheet', () => {
  for (const sheet of [waveSheet(), waveSheet().flipped()]) {
    const p = sheet.closestPoint([10, 10, 5])
    const n0 = sheet.faces()[0].normalAt(p)
    const top = byY(sheet)
    const out = sheet.matchEdge(top, lifted(top, (t) => new Vector(0, 0, Math.sin(Math.PI * t)), 11))
    assert.ok(out.faces()[0].normalAt(out.closestPoint(p)).dot(n0) > 0.999)
    const halves = halvesOf(sheet)
    const merged = halves.mergeFaces(halves.faces()[0], halves.faces()[1])
    assert.ok(merged.faces()[0].normalAt(merged.closestPoint(p)).dot(n0) > 0.999)
  }
})

test('mergeFaces in a sheet of three, of planes and of patches', () => {
  const whole = waveSheet()
  const cuts = [10, 20].map((x) => whole.intersectionCurves(new Plane([x, 0, 0], [0, 1, 0], [1, 0, 0]))[0])
  const thirds = whole.trim(cuts, 'split')
  assert.equal(thirds.faces().length, 3)
  const [left, middle, right] = [...thirds.faces()].sort((p, q) => p.center().x - q.center().x)
  const two = thirds.mergeFaces(middle, right)
  assert.equal(two.faces().length, 2)
  approx(two.area, whole.area, 1e-9)
  assert.throws(() => thirds.mergeFaces(left, right), /share no edge/)
  const plates = stitch(Rectangle(10, 10).translate(-5, 0, 0).faces()[0], Rectangle(10, 10).translate(5, 0, 0).faces()[0]) as Shell
  const plate = plates.mergeFaces(plates.faces()[0], plates.faces()[1])
  assert.equal(plate.faces().length, 1)
  approx(plate.area, 200, 1e-12)
  const pa = [0, 5, 10].map((x) => [0, 5, 10].map((y) => [x, y, x === 5 && y === 5 ? 5 : 0] as [number, number, number]))
  const pb = [10, 15, 20].map((x) => [0, 2, 10].map((y) => [x, y, x === 15 && y === 2 ? 5 : 0] as [number, number, number]))
  const sheets = stitch(nurbsSurface(pa, null, 2), nurbsSurface(pb, null, 2)) as Shell
  assert.throws(() => sheets.mergeFaces(sheets.faces()[0], sheets.faces()[1]), /do not join/)
  const pc = [10, 15, 20].map((x) => [0, 5, 10].map((y) => [x, y, x === 15 && y === 5 ? 5 : 0] as [number, number, number]))
  const same = stitch(nurbsSurface(pa, null, 2), nurbsSurface(pc, null, 2)) as Shell
  approx(same.mergeFaces(same.faces()[0], same.faces()[1]).area, same.area, 1e-9)
  assert.throws(() => same.mergeFaces(same.faces()[0], same.faces()[0]), /same face/)
})

// ---------------------------------------------------------------------- U12: chamfers in surfaceFillet

test('surfaceFillet chamfers with one and two distances', () => {
  const floor = Rectangle(40, 40).faces()[0]
  const wall = Rectangle(40, 40).on(Plane.XZ).faces()[0]
  const rails = (s: Shell) => s.edges().filter((e) => e.length > 30).map((e) => [Math.round(e.center().y * 1e9) / 1e9, Math.round(e.center().z * 1e9) / 1e9]).sort()
  const c = surfaceFillet(floor, wall, 5, { shape: 'chamfer' })
  approx(c.area, 40 * 5 * Math.SQRT2, 1e-9)
  assert.deepEqual(rails(c), [[-5, 0], [0, 5]])
  assert.deepEqual(rails(surfaceFillet(floor, wall, 5)), [[-5, 0], [0, 5]])
  const c2 = surfaceFillet(floor, wall, 2, { radius2: 4, shape: 'chamfer' })
  approx(c2.area, 40 * Math.hypot(2, 4), 1e-9)
  assert.deepEqual(rails(c2), [[-4, 0], [0, 2]])
  const one = surfaceFillet(floor, wall, 5, { shape: 'chamfer', trim: true })
  assert.equal(one.faces().length, 3)
  approx(one.area, 1200 + 40 * 5 * Math.SQRT2, 1e-9)
  assert.ok(one.thicken(1).isValid())
  assert.throws(() => surfaceFillet(floor, wall, 5, { radius2: 3 }), /radius2 is for chamfers/)
  assert.throws(() => surfaceFillet(floor, wall, 5, { shape: 'cove' as never }), /shape/)
  assert.throws(() => surfaceFillet(floor, wall, 5, { radius2: 0, shape: 'chamfer' }), /radius2 must be positive/)
})

// ---------------------------------------------------------------------- U13: nurbsSurface

test('nurbsSurface: rational, default and unclamped knots, round trip', () => {
  const net: [number, number, number][][] = [[[0, 0, 0], [0, 10, 0], [0, 20, 0]], [[10, 0, 5], [10, 10, 8], [10, 20, 5]], [[20, 0, 0], [20, 10, 0], [20, 20, 0]]]
  const s = nurbsSurface(net, null, 2, [[1, 1, 1], [1, 0.5, 1], [1, 1, 1]])
  assert.ok(s.distanceTo([10, 10, 18 / 7]) < 1e-12)
  approx(s.bbox().max.z, 18 / 7, 1e-9)
  const corners = new Set(s.vertices().map((v) => [v.x, v.y, v.z].map((c) => Math.round(c * 1e12) / 1e12).join(',')))
  assert.deepEqual([...corners].sort(), ['0,0,0', '0,20,0', '20,0,0', '20,20,0'])
  const bez = nurbsSurface([0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => [i * 10, j * 10, i > 0 && i < 3 && j > 0 && j < 3 ? 6 : 0] as [number, number, number])))
  assert.ok(bez.distanceTo([15, 15, 6 * 0.75 * 0.75]) < 1e-12)
  const p = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => [i * 10, j * 10, (i - 1.5) * (j - 1.5)] as [number, number, number]))
  const un = nurbsSurface(p, [[0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 5, 6, 7]])
  const w = [1 / 6, 4 / 6, 1 / 6]
  const corner = [0, 1, 2].map((c) => w.reduce((a, wi, i) => a + w.reduce((b, wj, j) => b + wi * wj * p[i][j][c], 0), 0))
  assert.ok(Math.min(...un.vertices().map((v) => new Vector(v.x, v.y, v.z).sub(corner).length)) < 1e-12)
  const sheet = waveSheet()
  const d = ext.surface_data(k.face_surface(sheet.faces()[0]._f), true)
  const nv = d.v_knots.length - d.v_degree - 1
  const rows: [number, number, number][][] = []
  for (let i = 0; i < d.poles.length; i += nv) rows.push(d.poles.slice(i, i + nv))
  const again = nurbsSurface(rows, [d.u_knots, d.v_knots], [d.u_degree, d.v_degree])
  approx(again.area, sheet.area, 1e-12)
  const data = { degrees: [d.u_degree, d.v_degree] as [number, number], knots: [d.u_knots, d.v_knots] as [number[], number[]], points: rows, weights: null }
  approx(nurbsSurface(data).area, sheet.area, 1e-12)
})

test('nurbsSurface errors', () => {
  const net = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => [i, j, 0] as [number, number, number]))
  assert.throws(() => nurbsSurface(net, [[0, 0, 0, 1, 1, 1, 1], [0, 0, 0, 0, 1, 1, 1, 1]], 3), /need 8 knots/)
  assert.throws(() => nurbsSurface(net, [[0, 0, 0, 0, 1, 1, 0.5, 1], [0, 0, 0, 0, 1, 1, 1, 1]]), /not decrease/)
  assert.throws(() => nurbsSurface(net, null, null, [[1, 1, 1, 1], [1, 0, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]]), /weights must be positive/)
  assert.throws(() => nurbsSurface(net, null, null, [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]]), /weights are rows/)
  assert.throws(() => nurbsSurface(net, null, 0), /degree must be 1 to 32/)
  assert.throws(() => nurbsSurface(net, null, 4), /at least 5 control points/)
  assert.throws(() => nurbsSurface([[[0, 0, 0], [1, 0, 0]], [[0, 1, 0]]]), /rows of points/)
  assert.throws(() => nurbsSurface(net, [[0, 0, 0.5, 0.5, 1, 1], [0, 0, 0, 0, 1, 1, 1, 1]], [1, 3]), /repeats more often/)
})

// ---------------------------------------------------------------------- U14: intersectionCurves

test('intersectionCurves of bodies that do not meet are empty, with planes and faces', () => {
  assert.equal(Box(10, 10, 10).intersectionCurves(Box(10, 10, 10).translate(50, 0, 0)).length, 0)
  assert.equal(Box(20, 20, 20).intersectionCurves(Box(4, 4, 4)).length, 0)
  assert.equal(Sphere(10).intersectionCurves(Sphere(2).translate(0, 0, 3)).length, 0)
  const sheet = waveSheet()
  assert.equal(sheet.intersectionCurves(Box(5, 5, 5).translate(15, 10, 30)).length, 0)
  assert.ok(Box(10, 10, 10).intersectionCurves(Box(10, 10, 10).translate(5, 5, 5)).length > 0)
  const curves = Sphere(10).intersectionCurves(Plane.XY)
  approx(curves.reduce((a, e) => a + e.length, 0), 2 * Math.PI * 10, 1e-12)
  assert.ok(curves.every((e) => e.geomType === 'circle'))
  assert.equal(Sphere(10).intersectionCurves(Plane.XY.offset(20)).length, 0)
  const cuts = sheet.intersectionCurves(new Plane([15, 0, 0], [0, 1, 0], [1, 0, 0]))
  assert.equal(cuts.length, 1)
  assert.ok(Math.max(...lin(0, 1, 41).map((t) => sheet.distanceTo(cuts[0].pointAt(t)))) < 1e-4)
  assert.ok(Math.max(...lin(0, 1, 41).map((t) => Math.abs(cuts[0].pointAt(t).x - 15))) < 1e-12)
  const small = Rectangle(4, 4).on(new Plane([15, 10, 2.5], [0, 1, 0], [1, 0, 0])).faces()[0]
  const pieces = sheet.intersectionCurves(small)
  assert.equal(pieces.length, 1)
  approx(pieces[0].length, 4, 1e-2)
  assert.throws(() => sheet.intersectionCurves([0, 0, 0] as never), TypeError)
})

// ---------------------------------------------------------------------- U15: surface's report

test('surface report gives the true distances', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const tube = (deg: number) => Array.from({ length: 1500 }, () => {
    const a = (rnd() - 0.5) * (deg * Math.PI) / 180
    return [10 * Math.sin(a), 10 * Math.cos(a), rnd() * 40] as [number, number, number]
  })
  const pts = tube(288)
  const [s, r] = surface(pts, { report: true })
  assert.ok(s instanceof Shell && r instanceof FitReport && r.distances.length === pts.length)
  approx(r.maxDistance, Math.max(...r.distances), 1e-12)
  assert.ok(r.maxDistance > 5)
  approx(r.rmsDistance, Math.sqrt(r.distances.reduce((a, x) => a + x * x, 0) / r.distances.length), 1e-12)
  const srf = k.face_surface(s.faces()[0]._f)
  const [[u0, v0], [u1, v1]] = ext.surface_data(srf, false).uv_domain
  const uv: number[] = []
  for (const u of lin(u0, u1, 120)) for (const v of lin(v0, v1, 120)) uv.push(u, v)
  const dense = ext.surface_derivatives(srf, uv).point as Float64Array
  for (let i = 0; i < pts.length; i += 97) {
    let brute = Infinity
    for (let j = 0; j < dense.length; j += 3) brute = Math.min(brute, Math.hypot(dense[j] - pts[i][0], dense[j + 1] - pts[i][1], dense[j + 2] - pts[i][2]))
    assert.ok(r.distances[i] <= brute + 1e-9 && r.distances[i] > brute - 0.15, `${r.distances[i]} vs ${brute}`)
    assert.ok(r.distances[i] <= s.distanceTo(pts[i]) + 1e-9)
  }
  const [, half] = surface(tube(180), { report: true })
  assert.ok(half.maxDistance < 1 && half.rmsDistance < half.maxDistance)
  assert.ok(surface(tube(180)) instanceof Shell)
  const g = [0, 5, 10, 15, 20].map((x) => [0, 5, 10, 15, 20].map((y) => [x, y, Math.sin(x / 5) * Math.cos(y / 5)] as [number, number, number]))
  const [, through] = surface(g, { report: true })
  assert.ok(through.maxDistance < 1e-9 && through.distances.length === 25)
  const [, near] = surface(g, { interpolate: false, report: true })
  assert.ok(near.maxDistance > 0.05 && near.maxDistance < 1)
})


// -- review of 0.5.0 ------------------------------------------------------------------------------
import * as RV from '../src/index.ts'

test('imprints of sketches along a direction', () => {
  const dome = RV.Sphere(10).intersect(RV.Box(40, 40, 20, { align: [RV.Align.CENTER, RV.Align.CENTER, RV.Align.MIN] }))
  const circle = RV.Circle(4).on(RV.Plane.XY.offset(20))
  const marked = dome.imprint(circle, RV.Z.reversed())
  assert.equal(marked.faces().length, dome.faces().length + 1)
  approx(marked.volume, dome.volume, 1e-9)
  assert.throws(() => dome.imprint(RV.Box(2, 2, 2).translate(0, 0, 9), [0, 0, -1]), /a part or a sheet is imprinted where it is/)
})
