// tests/test_lane_U.py: lane U of the kernel plan (phase 1): blends between sheet edges (U2),
// trimming sheets with curves on them and imprinting curves on parts (U3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Axis,
  Box,
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
  Z,
  blend,
  extrude,
  surface,
  surfaceFillet,
} from '../src/index.ts'
import { ext, k } from '../src/kernel.ts'
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
  const areas = Object.fromEntries(['G1', 'G2', 'G3'].map((c) => [c, blend(ea, eb, { continuity: c }).area]))
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
  for (const c of ['G2', 'G3']) {
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
  for (const c of ['G1', 'G2']) {
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
  raises(() => blend(ea, eb, { continuity: 'G4' }), RangeError, /continuity must be G1, G2 or G3/)
  raises(() => blend(ea, eb, { tension: 0 }), RangeError, /tension must be positive/)
  raises(() => blend(ea, eb, { tension: [1, 1, 1] as never }), RangeError, /one number or a pair/)
  raises(() => blend(ea, eb, { flip: true } as never), TypeError, /unexpected option/)
  const tube = Cylinder(10, 20).faces().cylinders()[0].toShell()
  raises(() => blend(tube.edges().filter((e) => e.center().z > 5).one(), eb), RangeError, /^blend: closed edges/)
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
