// tests/test_modeling.py
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Align,
  Box,
  CenterArc,
  Circle,
  Cone,
  Cylinder,
  Ellipse,
  EllipticalArc,
  FilletPolyline,
  GridLocations,
  Helix,
  Line,
  ModelingError,
  Plane,
  Polygon,
  Polyline,
  Rectangle,
  RegularPolygon,
  RoundedRectangle,
  Shell,
  Slot,
  Sphere,
  Spline,
  ThreePointArc,
  Torus,
  Vector,
  Wedge,
  Wire,
  X,
  Y,
  Z,
  fillet,
  loft,
  sweep,
  type Part,
} from '../src/index.ts'
import { approx, leggauss, same } from './_approx.ts'
import { Box as _Box, Rectangle as _Rectangle, Sphere as _Sphere, merge as _merge } from '../src/index.ts'
import { ext, setWarningHandler } from '../src/kernel.ts'

const PI = Math.PI

// -- primitives ---------------------------------------------------------------------------
test('primitives are exact', () => {
  approx(Box(10, 20, 30).volume, 6000)
  approx(Cylinder(3, 10).volume, PI * 9 * 10)
  approx(Sphere(5).volume, (4 / 3) * PI * 125)
  approx(Torus(10, 2).volume, 2 * PI ** 2 * 10 * 4)
  approx(Cone(4, 2, 6).volume, ((PI * 6) / 3) * (16 + 8 + 4))
  approx(Box(10, 20, 30).area, 2 * (200 + 600 + 300))
})

test('alignment', () => {
  const b = Box(10, 10, 4, { align: [Align.CENTER, Align.CENTER, Align.MIN] })
  approx(b.bbox().min.z, 0)
  approx(b.bbox().max.z, 4)
  const c = Cylinder(2, 5, { align: Align.MIN })
  same(c.bbox().min, new Vector(0, 0, 0))
})

// -- booleans -----------------------------------------------------------------------------
test('booleans', () => {
  const a = Box(10, 10, 10)
  const b = Box(10, 10, 10).translate(5, 0, 0)
  approx(a.fuse(b).volume, 1500)
  approx(a.cut(b).volume, 500)
  approx(a.intersect(b).volume, 500)
  approx(a.cut([-2, 2].map((x) => Cylinder(1, 20).translate(x, 0, 0))).volume, 1000 - 2 * PI * 10)
})

test('boolean with a pattern', () => {
  const plate = Box(80, 60, 10).cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, 20)))
  approx(plate.volume, 48000 - 4 * PI * 16 * 10)
  assert.ok(plate.isValid())
})

test('a disjoint union has two solids', () => {
  const p = Box(1, 1, 1).fuse(Box(1, 1, 1).translate(5, 0, 0))
  assert.equal(p.solids().length, 2)
})

// -- features -----------------------------------------------------------------------------
test('fillet and chamfer', () => {
  const box = Box(30, 20, 10)
  const f = box.fillet(box.edges().parallelTo(Z), 2)
  approx(f.volume, 6000 - 4 * (4 - PI) * 10)
  const c = box.chamfer(box.faces().top().edges(), 2)
  // four prisms along the top edges minus the overlapping corner pyramids
  approx(c.volume, 6000 - 0.5 * 4 * (2 * 30 + 2 * 20) + (4 * 8) / 3)
})

test('fillet accepts edges of an equal part', () => {
  const a = Box(10, 10, 10)
  const b = Box(10, 10, 10)
  approx(a.fillet(b.edges().parallelTo(Z), 1).volume, 1000 - 4 * (1 - PI / 4) * 10)
})

test('the fillet function finds the part', () => {
  const box = Box(10, 10, 10)
  approx((fillet(box.edges().parallelTo(Z), 1) as Part).volume, 1000 - 4 * (1 - PI / 4) * 10)
})

test('blend and variable fillets', () => {
  const box = Box(30, 20, 10)
  const g2 = box.fillet(box.edges().parallelTo(Z), 3, { continuity: 'G2' })
  assert.ok(g2.isValid() && g2.volume < 6000)
  const variable = box.fillet(box.edges().parallelTo(Z).first, { start: 1, end: 4 })
  assert.ok(variable.isValid() && variable.volume < 6000)
})

test('shell', () => {
  const box = Box(30, 20, 10)
  approx(box.shell(1, box.faces().top()).volume, 6000 - 28 * 18 * 9)
})

test('split and section', () => {
  const box = Box(30, 20, 10)
  const [above, below] = box.split(Plane.YZ.offset(5), 'both')
  approx(above.volume, 2000)
  approx(below.volume, 4000)
  assert.ok(above.isValid() && below.isValid())
  approx(Cylinder(5, 20).section(Plane.XZ).area, 200)
})

test('mirror keeps the volume', () => {
  const w = Wedge(10, 10, 5)
  approx(w.mirror(Plane.XZ).volume, w.volume)
})

test('mass properties', () => {
  const mp = Box(10, 20, 30).translate(1, 2, 3).massProperties(2)
  approx(mp.mass, 12000)
  same(mp.center, new Vector(1, 2, 3))
  approx(mp.inertia[0][0], (12000 * (20 ** 2 + 30 ** 2)) / 12)
  assert.ok(Math.abs(mp.inertia[0][1]) < 1e-6)
})

// -- sketches -----------------------------------------------------------------------------
test('sketch areas', () => {
  approx(Rectangle(40, 20).cut(Circle(5)).area, 800 - PI * 25)
  approx(RoundedRectangle(40, 20, 4).area, 800 - (4 - PI) * 16)
  approx(Slot(30, 10).area, 200 + PI * 25)
  approx(RegularPolygon(10, 6).area, ((3 * Math.sqrt(3)) / 2) * 100)
  approx(Rectangle(20, 10).fillet(2).area, 200 - (4 - PI) * 4)
})

test('sketch offset', () => {
  approx(Rectangle(20, 10).offset(1).area, 22 * 12 - (4 - PI))
  approx(Rectangle(20, 10).offset(-1).area, 18 * 8)
  approx(Rectangle(20, 10).offset(1, { round: false }).area, 22 * 12)
})

test('extrude variants', () => {
  approx(Circle(5).extrude(10, { both: true }).bbox().min.z, -10)
  approx(Rectangle(10, 10).extrude(-5).bbox().max.z, 0)
  approx(Rectangle(10, 4).on(Plane.XZ).extrude(3).bbox().min.y, -3)
  const tapered = Rectangle(20, 20).extrude(10, { taper: 10 })
  assert.ok(tapered.isValid() && tapered.volume < 4000)
})

test('a pocket from a sketch on a face', () => {
  let part = Box(50, 50, 20)
  part = part.cut(Rectangle(30, 20).on(part.faces().top()).extrude(-5))
  approx(part.volume, 50 * 50 * 20 - 30 * 20 * 5)
})

test('revolve', () => {
  const profile = Polygon([10, 0], [30, 0], [30, 5], [15, 5], [15, 20], [10, 20]).on(Plane.XZ)
  const full = PI * ((30 ** 2 - 10 ** 2) * 5 + (15 ** 2 - 10 ** 2) * 15)
  approx(profile.revolve(Z).volume, full)
  approx(profile.revolve(Z, 90).volume, full / 4)
  const ring = Rectangle(10, 10).cut(Circle(2)).translate(20, 0, 0).on(Plane.XZ)
  approx(ring.revolve(Z).volume, 2 * PI * 20 * (100 - PI * 4))
})

test('loft and sweep', () => {
  assert.ok((loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)]) as Part).isValid())
  const path = Spline([0, 0, 0], [0, 10, 20], [30, 10, 40])
  // Pappus: a tube's volume is its cross-section times the path length
  approx((sweep(Circle(2), path) as Part).volume, PI * 4 * path.length, 1e-6)
  approx((sweep(Circle(3).cut(Circle(1.5)), path) as Part).volume, PI * 6.75 * path.length, 1e-6)
  const bent = sweep(Rectangle(4, 4), Polyline([0, 0, 0], [0, 0, 30], [30, 0, 30])) as Part
  approx(bent.volume, 4 * 4 * 60)
  const elbow = new Wire([Line([0, 0, 0], [0, 0, 20]), CenterArc([10, 20], 10, 180, -90, Plane.XZ)])
  approx((sweep(Circle(2), elbow) as Part).volume, PI * 4 * elbow.length, 1e-6)
  const helix = Helix(10, 40, 20)
  approx((sweep(Rectangle(4, 2), helix) as Part).volume, 8 * helix.length, 1e-5)
})

test('sweep puts the center of the profile on the path', () => {
  // The kernel anchored the profile by the box along the world axes of the profile already turned to
  // the path: a triangle along (1, 1, 1) started 1.6667 before the path (along (1, 2, 0.3): 0.8025
  // off). The center of the triangle's own box is 2.357 from its centroid, in its plane.
  const tri = Polygon([0, 0], [10, 0], [0, 10])
  for (const d0 of [[0, 0, 1], [1, 0, 0], [1, 1, 1], [1, 2, 0.3]]) {
    const l = Math.hypot(d0[0], d0[1], d0[2])
    const d = d0.map((v) => v / l)
    const along = (v: Vector) => v.x * d[0] + v.y * d[1] + v.z * d[2]
    const part = sweep(tri, Line([0, 0, 0], d.map((v) => 10 * v))) as Part
    assert.ok(part.isValid())
    approx(part.volume, 500)
    const caps = part.faces().filter((f) => f.geomType === 'plane' && Math.abs(along(f.normalAt())) > 1 - 1e-9)
    const start = caps.reduce((a, b) => (Math.abs(along(a.center())) < Math.abs(along(b.center())) ? a : b))
    approx(along(start.center()), 0, 0, 1e-9)
    approx(start.center().length, Math.sqrt(50) / 3)
  }
})

test('sweep carries the profile along a 3D path', () => {
  // Each piece of a 3D path was turned afresh from the sketch: the rectangle turned by 90 degrees at
  // the last joint of this path (its end 4 wide in x and 2 high), and a section through that joint
  // failed (SM_ERR). Tangent edges are swept in one go now.
  const path = FilletPolyline([0, 0, 0], [0, 0, 40], [40, 0, 40], [40, 40, 40], { radius: 8 })
  const bar = sweep(Rectangle(4, 2), path) as Part
  assert.ok(bar.isValid())
  approx(bar.volume, 8 * path.length, 1e-6)
  const size = (b: { min: Vector; max: Vector }) => [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
  const end = bar.faces().find((f) => f.geomType === 'plane' && f.normalAt().y > 1 - 1e-9 && f.center().y > 39)!
  size(end.bbox()).forEach((v, i) => approx(v, [2, 0, 4][i], 0, 1e-6))
  size(bar.section(new Plane([40, 8, 40], null, [0, 1, 0])).bbox()).forEach((v, i) => approx(v, [2, 0, 4][i], 0, 1e-6))
  // at a corner the profile turns by the smallest rotation from one leg to the next: the long side
  // ends along (-1 / sqrt(5), -0.4, 0.8), where it ended along X before
  const legs = Polyline([0, 0, 0], [0, 0, 20], [20, 0, 20], [20, 20, 30])
  const part = sweep(Rectangle(4, 1), legs) as Part
  const t = new Vector(0, 2, 1).normalized()
  const last = part.faces().find((f) => f.geomType === 'plane' && Math.abs(f.normalAt().dot(t)) > 1 - 1e-9 && f.center().distanceTo([20, 20, 30]) < 1)!
  const side = last.edges().reduce((a, b) => (a.length >= b.length ? a : b))
  approx(side.length, 4)
  approx(Math.abs(side.end.sub(side.start).normalized().dot(new Vector(-1 / Math.sqrt(5), -0.4, 0.8))), 1)
  // a closed path that is not planar: in one go, without a turn where the halves met
  const loop = Spline(
    ...Array.from({ length: 8 }, (_, i) => {
      const a = (i * PI) / 4
      return [20 * Math.cos(a), 14 * Math.sin(a), 6 * Math.sin(2 * a) + 3 * Math.cos(a)]
    }),
    { closed: true },
  )
  const ring = sweep(Rectangle(4, 1), loop) as Part
  assert.ok(ring.isValid() && ring.faces().length === 4)
  approx(ring.volume, 4 * loop.length, 1e-4)
  approx((sweep(Circle(2), loop) as Part).volume, 4 * PI * loop.length, 1e-7) // (in two halves, as before)
  // an open profile along a closed edge sweeps into a surface in one go (it was split into halves and
  // refused: "surface sweeps need a single-edge path")
  const band = sweep(Line([0, 0, 0], [4, 0, 0]), Circle(20).edges().at(0)!)
  assert.ok(band instanceof Shell)
  approx(band.area, 2 * PI * 20 * 4, 1e-6)
})

/** Runs fn and gives back the warnings it made. */
function warned<T>(fn: () => T): [T, string[]] {
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    return [fn(), said]
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
}

test('sweep along kinked closed 3D paths', () => {
  // Loops closed with a kink, Spline(...pts, pts[0]), through these symmetric points lie in a plane
  // at 0, 1/4, 1/2 and 3/4 of their length: taken for planar, their halves went to the planar-path
  // sweep, which gave no closed solid (ModelingError; valid before the profile was carried along).
  // Now they are swept as 3D paths, the profile carried along the halves: area x length less the
  // overlap of the ends where they cross at the kink (for the circle about tan(kink) x 2 r^3 / 3,
  // the first moment of its inner half).
  const cases = [[20, Rectangle(4, 1), 543.404104], [14, Circle(2), 1499.196379], [14, Rectangle(4, 1), 477.647314]] as const
  for (const [ry, profile, volume] of cases) {
    const pts = Array.from({ length: 8 }, (_, i) => {
      const a = (i * PI) / 4
      return [20 * Math.cos(a), ry * Math.sin(a), 6 * Math.sin(2 * a)]
    })
    const path = Spline(...pts, pts[0])
    const [body, said] = warned(() => sweep(profile, path) as Part)
    assert.deepEqual(said, [])
    assert.ok(body.isValid())
    approx(body.volume, volume, 1e-6)
    const overlap = profile.area * path.length - body.volume
    const kink = (path.tangentAt(0).angleTo(path.tangentAt(1)) * PI) / 180
    if (profile.edges().at(0)!.geomType === 'circle') approx(overlap, (Math.tan(kink) * 2 * 2 ** 3) / 3, 0.03)
    else assert.ok(overlap > 0 && overlap < (Math.tan(kink) * 1 * 4 ** 2) / 8) // at most with the long side in the bend
  }
})

test('sweep edge by edge where the joined path fails', () => {
  // The edges of this 3D fillet polyline are joined into one curve and swept in one go; the kernel
  // cannot sweep a circle or an ellipse of this size along it (SM_ERR; the rectangle goes), which
  // raised (a valid body before the profile was carried along). The edges are swept on their own
  // then, each turned to its own start: a profile that is not round turns where they meet, and a
  // warning says so.
  const path = FilletPolyline([0, 0, 0], [13.2, 22.83, -20.78], [38.33, 52.89, -20.73], [38.66, 70.52, -34.06], { radius: 5 })
  const [tube, quiet] = warned(() => sweep(Circle(2), path) as Part)
  assert.deepEqual(quiet, [])
  assert.ok(tube.isValid())
  approx(tube.volume, 4 * PI * path.length, 1e-6)
  const [oval, said] = warned(() => sweep(Ellipse(2, 1.5), path) as Part)
  assert.ok(said.length === 1 && said[0].includes('could not be carried along the path'))
  assert.ok(oval.isValid())
  approx(oval.volume, 3 * PI * path.length, 1e-6)
})

test('a disjoint sketch union', () => {
  const two = Circle(1).translate(-3, 0, 0).fuse(Circle(1).translate(3, 0, 0))
  approx(two.area, 2 * PI)
  assert.equal(two.faces().length, 2)
})

// -- curves -------------------------------------------------------------------------------
test('curves', () => {
  approx(Line([0, 0], [3, 4]).length, 5)
  const arc = CenterArc([0, 0], 10, 0, 90)
  approx(arc.length, 5 * PI)
  approx(arc.radius, 10)
  const t = ThreePointArc([0, 0], [1, 1], [2, 0])
  same(t.arcCenter, new Vector(1, 0, 0))
  const s = Spline([0, 0], [10, 5], [20, 0], { tangents: [[1, 0], [1, 0]] })
  assert.ok(s.start.equals(new Vector(0, 0, 0)) && s.end.equals(new Vector(20, 0, 0)))
  same(s.tangentAt(0), new Vector(1, 0, 0))
  const h = Helix(5, 20, 10)
  same(h.end, new Vector(10, 0, 20))
  assert.ok(Polyline([0, 0], [10, 0], [10, 10], { close: true }).isClosed)
})

for (const [start, end] of [
  [300, 60],
  [210, 390],
  [-90, 90],
  [45, 395],
]) {
  test(`an elliptical arc across angle 0 (${start} to ${end})`, () => {
    const rx = 27
    const ry = 15
    const span = (((end - start) % 360) + 360) % 360
    const arc = EllipticalArc([0, 0], rx, ry, start, end)
    assert.equal(arc.geomType, 'ellipse')
    // the length against Gauss-Legendre integration of the ellipse's speed from start to end
    const a0 = (start * PI) / 180
    const a1 = ((start + span) * PI) / 180
    const [x, w] = leggauss(64)
    let integral = 0
    for (let i = 0; i < x.length; i++) {
      const t = a0 + ((a1 - a0) * (x[i] + 1)) / 2
      integral += w[i] * Math.hypot(rx * Math.sin(t), ry * Math.cos(t))
    }
    approx(arc.length, ((a1 - a0) / 2) * integral, 1e-10)
    assert.ok(arc.start.distanceTo([rx * Math.cos(a0), ry * Math.sin(a0)]) < 1e-9)
    assert.ok(arc.end.distanceTo([rx * Math.cos(a1), ry * Math.sin(a1)]) < 1e-9)
    // counterclockwise from start to end: the middle lies within the arc's angles, not on the rest
    const mid = arc.pointAt(0.5)
    const deg = (((Math.atan2(mid.y / ry, mid.x / rx) * 180) / PI - start) % 360 + 360) % 360
    assert.ok(deg > 0 && deg < span)
  })
}

// -- selectors ----------------------------------------------------------------------------
test('selectors', () => {
  const part = Box(10, 10, 10).cut(Cylinder(2, 20))
  assert.equal(part.edges().parallelTo(Z).lines().length, 4)
  assert.equal(part.faces().cylinders().length, 1)
  same(part.faces().top().one().normalAt(), new Vector(0, 0, 1))
  assert.equal(part.faces().facing(Z.neg()).length, 1)
  assert.equal(part.edges().circles().length, 2)
  const groups = part.edges().groupBy(Z)
  assert.equal(groups.length, 3)
  approx(part.faces().sortBy('area').last.area, 2 * PI * 2 * 10)
  approx(part.faces().sortBy('area')[0].area, 100 - PI * 4)
  approx(part.faces().top().one().plane.origin.z, 5)
})

test('facing takes a curved face only when all its normals qualify', () => {
  // The wall of a hole was judged at its centroid, which lies on the axis, where any normal comes
  // back: facing(-X) took both walls here. A full wall faces no direction.
  const holed = Box(40, 30, 20).cut(Cylinder(5, 30)).cut(Cylinder(3, 30).translate(12, 0, 0))
  for (const d of [X, X.neg(), Y, Y.neg(), Z, Z.neg()]) assert.deepEqual(holed.faces().facing(d).map((f) => f.geomType), ['plane'])
  const boss = Box(40, 30, 10, { align: [Align.CENTER, Align.CENTER, Align.MAX] }).fuse(Cylinder(6, 15, { align: [Align.CENTER, Align.CENTER, Align.MIN] }))
  assert.deepEqual(
    boss
      .faces()
      .facing(Z)
      .map((f) => Math.round(f.center().z * 1e6) / 1e6)
      .sort((a, b) => a - b),
    [0, 15],
  ) // block and boss tops
  for (const d of [X, X.neg(), Y, Y.neg()]) assert.deepEqual(boss.faces().facing(d).map((f) => f.geomType), ['plane'])
  // A fillet between the top and the +X side: its normals turn from Z to X, so it faces (1, 0, 1)
  // only with an angle that takes in both ends (45 degrees off).
  const block = Box(40, 30, 20)
  const rounded = block.fillet(block.edges().parallelTo(Y).top().right(), 5)
  assert.deepEqual(rounded.faces().facing(X).map((f) => f.geomType), ['plane'])
  assert.deepEqual(rounded.faces().facing(Z).map((f) => f.geomType), ['plane'])
  const round = rounded.faces().cylinders()
  assert.equal(round.length, 1)
  assert.equal(round.facing([1, 0, 1], 40).length, 0)
  assert.ok(round.facing([1, 0, 1], 50).every((f, i) => f.equals(round[i])) && round.facing([1, 0, 1], 50).length === 1)
  // a dome whose rim normal is acos(12 / 20) = 53.13 degrees off Z
  const dome = Sphere(20).intersect(Box(60, 60, 10, { align: [Align.CENTER, Align.CENTER, Align.MIN] }).translate(0, 0, 12))
  assert.equal(dome.faces().facing(Z, 50).ofType('sphere').length, 0)
  assert.equal(dome.faces().facing(Z, 56).ofType('sphere').length, 1)
})

test('sketch Booleans of overlapping circles', () => {
  const a = Circle(10).translate(-5, 0)
  const b = Circle(10).translate(5, 0)
  const lens = 2 * 100 * Math.acos(0.5) - 5 * Math.sqrt(300)
  approx(a.intersect(b).area, lens)
  approx(a.fuse(b).area, 2 * PI * 100 - lens)
  approx(a.cut(b).area, PI * 100 - lens)
  approx(a.xor(b).area, 2 * (PI * 100 - lens))
})

test('oversized rounds are rejected', () => {
  const cube = Box(10, 10, 10)
  assert.throws(() => cube.fillet(cube.edges(), 6), ModelingError)
  assert.throws(() => cube.chamfer(cube.edges(), 6), ModelingError)
  assert.ok(cube.fillet(cube.edges(), 4).isValid())
})

// -- cells ------------------------------------------------------------------------------------
test('merge makes cells', () => {
  const a = _Box(10, 10, 10)
  const b = _Box(10, 10, 10).translate([5, 0, 0])
  const m = a.merge(b)
  approx(m.volume, 1500)
  assert.ok(!m.isValid()) // cells share faces: not a manifold solid
  const cells = m.cells()
  assert.equal(cells.length, 3)
  for (const c of cells) {
    approx(c.volume, 500)
    assert.ok(c.isValid())
  }
  approx(_merge(a, b).volume, 1500)
  // touching parts share the face between them
  const t = _Box(10, 10, 10).merge(_Box(10, 10, 10).translate([10, 0, 0]))
  assert.equal(t.faces().length, 11)
  for (const c of t.cells()) approx(c.volume, 1000)
  approx(_Box(1, 1, 1).cells()[0].volume, 1)
})

test('cells with cavities', () => {
  const [outer, inner] = _Box(10, 10, 10).merge(_Box(2, 2, 2)).cells()
  approx(outer.volume, 992)
  approx(inner.volume, 8)
  assert.equal(outer.faces().length, 12) // the outer box and the cavity
  const ball = _Sphere(4).translate([0, 0, 5])
  const cells = _Box(10, 10, 10).merge(ball).cells().map((c) => c.volume).sort((x, y) => x - y)
  const want = [_Box(10, 10, 10).cut(ball).volume, _Box(10, 10, 10).intersect(ball).volume, ball.cut(_Box(10, 10, 10)).volume].sort((x, y) => x - y)
  cells.forEach((v, i) => approx(v, want[i], 1e-6))
  assert.throws(() => _Box(1, 1, 1).merge(_Rectangle(1, 1) as any), /parts/)
  assert.throws(() => _merge(_Box(1, 1, 1)), /two or more/)
})

test('cells of inserts that touch the part around them', () => {
  // An insert that touches the box's wall at a point joins its shell to the box's: the outer cell
  // kept the insert's volume (8000 + 268.083 in a box of 8000).
  const box = _Box(20, 20, 20)
  const ball = _Sphere(4)
  for (const where of [[6, 0, 0], [6, 6, 0]] as const) {
    // touching a face, and an edge
    const cells = box.merge(ball.translate(where)).cells().map((c) => c.volume).sort((x, y) => x - y)
    assert.equal(cells.length, 2)
    approx(cells[0], ball.volume)
    approx(cells[1], 8000 - ball.volume)
  }
  const two = box.merge(ball.translate([6, 0, 0]), ball.translate([-6, 0, 0])).cells().map((c) => c.volume).sort((x, y) => x - y)
  assert.equal(two.length, 3)
  approx(two[0], ball.volume)
  approx(two[1], ball.volume)
  approx(two[2], 8000 - 2 * ball.volume)
  // Along a line the cavity cannot be cut out (the kernel's cut of a tangent cylinder fails): the
  // outer cell was 8502.655, more than the box.
  assert.throws(() => box.merge(Cylinder(4, 10).translate([6, 0, 0])).cells(), (e: Error) => e instanceof ModelingError && /cells: the cells inside a cell could not be cut out/.test(e.message))
})

test('cells must fill the part', () => {
  // The cells add up to the merged part, or cells() throws: here region_shells leaves the cavity out.
  const m = _Box(10, 10, 10).merge(_Box(2, 2, 2))
  const shells = ext.region_shells
  ext.region_shells = (b: number) => shells(b).map((s: number[]) => {
    for (const x of s.slice(1)) ext.delete_brep(x)
    return s.slice(0, 1)
  })
  try {
    assert.throws(() => m.cells(), (e: Error) => e instanceof ModelingError && /cells: the cells add up to a volume of 1008, the part has 1000/.test(e.message))
  } finally {
    ext.region_shells = shells
  }
})

test('cells of parts whose faces meet within a tolerance', () => {
  // A pin with fitted chamfers in a block: the faces leave gaps of about 2e-6 of the volume, so the
  // part and its cells integrate differently by about as much (444.61541 against 444.61629). cells()
  // threw that they did not add up, and section() and cellAt() with it.
  const pin = Cylinder(3, 10)
  const m = Box(8, 8, 5).merge(pin.chamfer(pin.edges(), 1))
  const cells = m.cells()
  assert.equal(cells.length, 4)
  approx(cells.reduce((sum, c) => sum + c.volume, 0), 444.61629, 1e-7)
  approx(m.cellAt([0, 0, 0])!.volume, 45 * PI)
  const xy = m.section(Plane.XY)
  assert.equal(xy.faces().length, 2)
  approx(xy.area, 64)
  const wide = Cylinder(10, 20)
  assert.equal(Box(30, 30, 10).merge(wide.chamfer(wide.edges(), 3)).cells().length, 4)
})

test('section of a merged part has every cell', () => {
  const m = _merge(_Box(40, 40, 20), Cylinder(6, 30))
  const xy = m.section(Plane.XY) // was 1 face, 1486.903: the insert's disc was dropped
  const areas = xy.faces().map((f) => f.area).sort((x, y) => x - y)
  assert.equal(areas.length, 2)
  approx(areas[0], 36 * PI)
  approx(areas[1], 1600 - 36 * PI)
  const xz = m.section(Plane.XZ) // was KernelError: section failed (SM_ERR)
  assert.equal(xz.faces().length, 5)
  approx(xz.area, 40 * 20 + 12 * 10)
  approx(m.section(Plane.XY.offset(12)).area, 36 * PI) // the pin end alone
  assert.throws(() => m.section(Plane.XY.offset(40)), /does not cut/)
  // a plane through the face between two cells: that face once
  const stack = _merge(_Box(40, 40, 20), _Box(40, 40, 20).translate([0, 0, 20]))
  const mid = stack.section(Plane.XY.offset(10)).faces()
  assert.equal(mid.length, 1)
  approx(mid[0].area, 1600)
  assert.throws(() => m.split(Plane.XZ), (e: Error) => e instanceof ModelingError && /split: the part is not a valid solid/.test(e.message)) // was KernelError: split failed
  // an insert that touches the part along a line has no cells (a wrong sketch of 370 for 400 before)
  const touching = _Box(20, 20, 20).merge(Cylinder(3, 10).rotate(X, 90).translate(7, 0, 0))
  assert.throws(() => touching.section(Plane.XY), (e: Error) => e instanceof ModelingError && /^section: cells: /.test(e.message))
})
