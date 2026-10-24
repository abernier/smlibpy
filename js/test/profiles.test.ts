// tests/test_profiles.py: 2D modeling: the Profile pen, the shapes and their corner options, Hull
// and Stroke, and the exact 2D operations (Booleans, offset, fillet and chamfer of corners, mirror).
//
// Python's random disks and shapes (random.seed) come from a seeded generator of its own here; the
// tests check properties, not the particular shapes. The last four Python tests (the MCP server's
// search and guides, the skill's guides run as scripts, a script in an MCP session) test smlibpy's
// MCP server and skill, which smlibwasm does not have.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Profile } from '../src/profiles.ts'
import {
  ArcSlot,
  Circle,
  Ellipse,
  Hull,
  Polygon,
  Rectangle,
  RegularPolygon,
  RoundedRectangle,
  Slot,
  Stroke,
  Trapezoid,
  Triangle,
  makeFace,
} from '../src/sketches.ts'
import { CenterArc, FilletPolyline, Line, Polyline, Spline } from '../src/curves.ts'
import { Axis, Plane, Pos, Vector, X, Y, Z } from '../src/geometry.ts'
import { Align } from '../src/align.ts'
import { ModelingError } from '../src/kernel.ts'
import { Wire, type Part, type Shape, type Sketch, type Vertex } from '../src/shapes.ts'
import { GridLocations } from '../src/locations.ts'
import { Box } from '../src/parts.ts'
import { chamfer, fillet, sweep } from '../src/operations.ts'
import { approx, same } from './_approx.ts'

const PI = Math.PI
const rad = (d: number) => (d * PI) / 180

function types(s: Shape): string[] {
  return [...new Set(s.edges().map((e) => e.geomType))].sort()
}

function holes(s: Sketch): number {
  let n = 0
  for (const f of s.faces()) n += f.innerWires().length
  return n
}

/** Every arc of `radius` meets its neighbours tangentially. */
function assertTangentJoints(s: Sketch, radius: number): void {
  for (const f of s.faces()) {
    for (const w of f.wires()) {
      const edges = [...w.edges()]
      edges.forEach((a, i) => {
        const b = edges[(i + 1) % edges.length]
        if ([a, b].some((e) => e.geomType === 'circle' && Math.abs(e.radius - radius) < 1e-9)) {
          assert.ok(a.tangentAt(1).angleTo(b.tangentAt(0)) < 1e-6, `${a} and ${b} do not meet tangentially`)
        }
      })
    }
  }
}

/** `fn` throws an error of class `cls` whose message matches. */
function raises(fn: () => unknown, cls: abstract new (...args: never[]) => Error, message: RegExp): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof cls, `expected a ${cls.name}, got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    assert.match((e as Error).message, message)
    return true
  })
}

/** A seeded generator (Python's random has its own; the tests only need repeatable numbers). */
function seeded(seed: number) {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    uniform: (a: number, b: number) => a + (b - a) * next(),
    randint: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
    choice: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  }
}

// -- Profile ------------------------------------------------------------------------------
test('profile: a revolve section is exact', () => {
  const section = new Profile([0, 0])
    .lineTo(12, 0)
    .lineTo({ y: 4 })
    .fillet(1.5)
    .lineTo({ x: 6 })
    .lineTo({ y: 20 })
    .chamfer(1)
    .lineTo({ x: 0 })
    .close()
  approx(section.area, 12 * 4 + 6 * 16 - ((4 - PI) * 1.5 ** 2) / 4 - 0.5)
  assert.deepEqual(types(section), ['circle', 'line'])
  assertTangentJoints(section, 1.5)
  const bushing = section.revolve(new Axis([0, 0, 0], [0, 1, 0]))
  assert.ok(bushing.isValid())
  approx(bushing.volume, 2 * PI * section.center().x * section.area)
})

test('profile: a half and mirror make a symmetric outline', () => {
  const bracket = new Profile([0, 0])
    .lineTo(30, 0)
    .lineTo({ y: 6 })
    .lineTo({ x: 10 })
    .fillet(4)
    .lineTo({ y: 30 })
    .arc(10, 90)
    .mirror(Y)
    .close()
  const b = bracket.bbox()
  approx(b.min.x, -30)
  approx(b.max.x, 30)
  approx(b.min.y, 0)
  approx(b.max.y, 40)
  approx(bracket.area, 60 * 6 + 20 * 24 + 50 * PI + 2 * (4 - PI) * 4)
  assert.equal(bracket.edges().length, 10) // the bottom and the top arc each join across the axis
  approx(bracket.center().x, 0, 1e-6, 1e-6)
  approx(bracket.cut(bracket.mirror(Y)).area, 0, 1e-6, 1e-6)
  assertTangentJoints(bracket, 4)
  assertTangentJoints(bracket, 10)
  // ends off the axis are joined straight across it
  const m = new Profile([5, 0]).lineTo(20, 0).lineTo(20, 10).lineTo(5, 10).mirror(Y).close()
  approx(m.area, 400)
  assert.equal(m.edges().length, 4)
})

test('profile: moves and where the pen is', () => {
  const p = new Profile([0, 0]).lineTo(20, 0).arc(10, 90)
  same(p.point, new Vector(30, 10, 0))
  approx(p.heading, 90)
  assert.equal(p.length, 2)
  same(new Profile([0, 0], { heading: 30 }).forward({ y: 5 }).point, new Vector(5 / Math.tan(rad(30)), 5, 0))
  same(new Profile([3, 4]).lineTo({ x: 10 }).point, new Vector(10, 4, 0))
  same(new Profile([3, 4]).lineBy(1, -1).point, new Vector(4, 3, 0))
  approx(new Profile().turn(270).heading, -90)
  approx(new Profile().arc(5, -90).heading, -90)
  approx(new Profile().turn(45).lineTo(10, 0).heading, 0) // lineTo sets its own direction
  const t = new Profile([0, 0]).lineTo(10, 0).arcTo(20, 10)
  same(t.point, new Vector(20, 10, 0))
  approx(t.heading, 90)
  const slot = new Profile([0, -3]).forward(20).arc(3, 180).forward(20).arc(3, 180).close()
  approx(slot.area, 20 * 6 + 9 * PI)
  const base = new Profile([-25, 0]).lineTo(-25, -7.5).arcTo(25, -7.5, { through: [0, -15] }).lineTo(25, 0)
  approx(base.mirror(X).close().area, 1258.8876)
})

test('profile: immutable, so a drawing branches', () => {
  const base = new Profile([0, 0]).lineTo(20, 0).lineTo(20, 10)
  const square = base.lineTo(0, 10).close()
  const roundTop = base.arcTo(0, 10).close()
  approx(square.area, 200)
  approx(roundTop.area, 357.0796)
  assert.equal(base.length, 2)
  same(base.point, new Vector(20, 10, 0))
})

test('profile: corners at the start and the end', () => {
  const r = new Profile([0, 0]).fillet(2).lineTo(20, 0).lineTo(20, 10).lineTo(0, 10).close()
  approx(r.area, 200 - (4 - PI))
  const closed = new Profile([0, 0]).fillet(2).lineTo(20, 0).lineTo(20, 10).lineTo(0, 10).lineTo(0, 0).close()
  approx(closed.area, r.area, 1e-9)
  const end = new Profile([0, 0]).lineTo(20, 0).lineTo(20, 10).lineTo(0, 10).fillet(3).close()
  approx(end.area, 200 - ((4 - PI) * 9) / 4)
  const cw = new Profile([0, 0]).lineTo(0, 10).lineTo(20, 10).lineTo(20, 0).close()
  approx(cw.area, 200)
  same(cw.plane.zDir, new Vector(0, 0, 1))
})

test('profile: wire() is an exact sweep path', () => {
  const path = new Profile([0, 0]).lineTo(20, 0).fillet(5).lineTo(20, 20).wire()
  assert.deepEqual(
    path.edges().map((e) => e.geomType),
    ['line', 'circle', 'line'],
  )
  approx(path.length, 15 + 15 + 2.5 * PI)
  approx((sweep(Circle(1), path) as Part).volume, PI * path.length)
})

test('profile: close() aligns', () => {
  const b = new Profile([10, 10]).lineTo(30, 10).lineTo(30, 20).close({ align: Align.CENTER }).bbox()
  approx(b.min.x, -10)
  approx(b.max.x, 10)
  approx(b.min.y, -5)
  approx(b.max.y, 5)
})

const profileErrors: [string, () => unknown, abstract new (...args: never[]) => Error, RegExp][] = [
  [
    'a crossing',
    () => new Profile().lineTo(10, 0).lineTo(10, 10).lineTo(0, -5).lineTo(5, 5).close(),
    ModelingError,
    /crosses or touches itself at \(3\.3333, 0\): segment 1, lineTo\(10, 0\) meets segment 3, lineTo\(0, -5\)/,
  ],
  [
    'a fillet too large',
    () => new Profile().lineTo(10, 0).fillet(20).lineTo(10, 10).lineTo(0, 10).close(),
    ModelingError,
    /fillet\(20\) at \(10, 0\) does not fit: it needs 20 along segment 1, lineTo\(10, 0\), which is 10 long/,
  ],
  ['a fillet at no corner', () => new Profile().forward(10).fillet(2).arc(5, 90).close(), ModelingError, /no corner; leave the fillet out/],
  ['forward behind the pen', () => new Profile().lineTo(10, 0).forward({ x: -5 }), ModelingError, /lies behind the pen/],
  ['forward parallel', () => new Profile().forward({ y: 5 }), ModelingError, /runs parallel to the X axis/],
  ['arcTo straight ahead', () => new Profile().lineTo(10, 0).arcTo(20, 0), ModelingError, /straight ahead/],
  ['arcTo straight behind', () => new Profile().lineTo(10, 0).arcTo(0, 0), ModelingError, /straight behind/],
  ['arcTo through a point on the line', () => new Profile().arcTo(10, 0, { through: [5, 0] }), ModelingError, /lie on one line/],
  ['no length', () => new Profile().lineTo(10, 0).lineTo(10, 0), RangeError, /has no length/],
  ['lineTo one number', () => new Profile().lineTo(30), TypeError, /lineTo\(\{ x: \.\.\. \}\)/],
  ['a negative radius', () => new Profile().arc(-5, 90), RangeError, /radius must be positive/],
  ['a corner at the end of a wire', () => new Profile().lineTo(10, 0).fillet(2).wire(), ModelingError, /end of an open path is not a corner/],
  [
    'mirror along the axis',
    () => new Profile().lineTo(10, 0).lineTo(10, 10).lineTo(0, 10).lineTo(0, 5).mirror(Y),
    ModelingError,
    /runs along the mirror axis/,
  ],
  ['mirror a closed outline', () => new Profile().lineTo(10, 0).lineTo(0, 10).lineTo(0, 0).mirror(Y), ModelingError, /already closed/],
  ['one line', () => new Profile().lineTo(10, 0).close(), ModelingError, /encloses no area/],
  ['a 3D start', () => new Profile([0, 0, 5]), RangeError, /z = 0/],
  [
    'two corners at the start',
    () => new Profile().fillet(2).lineTo(20, 0).lineTo(0, 10).lineTo(0, 0).fillet(1).close(),
    RangeError,
    /both at the start corner/,
  ],
]

for (const [name, make, error, message] of profileErrors) {
  test(`profile errors name the segment and the numbers: ${name}`, () => {
    raises(make, error, message)
  })
}

test('a profile is not a shape', () => {
  const p = new Profile().lineTo(10, 0).lineTo(0, 10) as unknown as { extrude(amount: number): unknown }
  raises(() => p.extrude(5), TypeError, /Call \.close\(\) for the region/)
})

// -- shapes -------------------------------------------------------------------------------
test('shapes: corner options and rotation', () => {
  approx(Rectangle(80, 50, { fillet: 6 }).area, 4000 - (4 - PI) * 36)
  assert.deepEqual(types(Rectangle(80, 50, { fillet: 6 })), ['circle', 'line'])
  approx(Rectangle(40, 20, { chamfer: 3 }).area, 782)
  approx(Rectangle(40, 20, { fillet: 10 }).area, Slot(40, 20).area)
  assert.equal(Rectangle(40, 20, { fillet: 10 }).edges().length, 4)
  const t = Rectangle(40, 20, { rotation: 30 }).bbox()
  approx(t.max.x, 20 * Math.cos(rad(30)) + 10 * Math.sin(rad(30)))
  const b = Rectangle(40, 20, { fillet: 4, align: Align.MIN }).bbox()
  approx(b.min.x, 0)
  approx(b.min.y, 0)
  approx(b.max.x, 40)
  approx(b.max.y, 20)
  approx(Polygon([0, 0], [40, 0], [40, 8], [8, 8], [8, 30], [0, 30], { fillet: 2 }).area, 496 - 5 * (4 - PI) + (4 - PI))
  assert.equal(RegularPolygon(10, 6, { fillet: 1 }).edges().length, 12)
  approx(Ellipse(15, 8, { rotation: 30 }).area, PI * 120)
  approx(Trapezoid(40, 15, 60, { rotation: 90 }).bbox().size.y, 40)
})

test('old names keep working', () => {
  approx(RoundedRectangle(80, 50, 6).area, Rectangle(80, 50, { fillet: 6 }).area, 1e-12)
  approx(RoundedRectangle(40, 20, 0).area, 800)
  raises(() => RoundedRectangle(40, 20, 10.0001), RangeError, /corner radius is larger than half the shorter side/)
  approx(Rectangle(40, 20).offset(2, { round: false }).area, 44 * 24)
  assert.ok(FilletPolyline([0, 0], [20, 0], [20, 10], [0, 10], { radius: 2, close: true }).length > 0)
  approx(makeFace(Polyline([0, 0], [10, 0], [0, 10], { close: true })).area, 50)
  approx(Slot(30, 8).area, 22 * 8 + 16 * PI)
})

test('triangle', () => {
  approx(Triangle(40, 20).area, 400)
  const r9 = (v: number) => Math.round(v * 1e9) / 1e9 + 0
  const corners = Triangle(30, 40, { apex: 0 })
    .vertices()
    .map((v) => [r9(v.x), r9(v.y)])
    .sort((p, q) => p[0] - q[0] || p[1] - q[1])
  assert.deepEqual(corners, [
    [-15, -20],
    [-15, 20],
    [15, -20],
  ])
  approx(Triangle(30, 20, { apex: -10 }).bbox().size.x, 40)
  approx(Triangle(20, (20 * Math.sqrt(3)) / 2).area, (Math.sqrt(3) / 4) * 400)
  const g = Triangle(30, 30, { apex: 0, fillet: 2 })
  assert.equal(g.edges().length, 6)
  assert.deepEqual(types(g), ['circle', 'line'])
})

const shapeErrors: [string, () => unknown, RegExp][] = [
  ['fillet and chamfer', () => Rectangle(40, 20, { fillet: 2, chamfer: 1 }), /not both/],
  ['a fillet too large', () => Rectangle(40, 20, { fillet: 11 }), /fillet: 11 is more than half the shorter side \(10\)/],
  ['a polygon fillet that does not fit', () => Polygon([0, 0], [50, 0], [0, 5], { fillet: 3 }), /does not fit: it needs 60\.1496 along the line \(0, 0\) -> \(50, 0\)/],
  ['a flat triangle', () => Triangle(10, 0), /must be positive/],
  ['a trapezoid angle', () => Trapezoid(40, 15, 180), /between 0 and 180/],
  ['an ellipse radius', () => Ellipse(0, 5), /radii must be positive/],
  ['an arc slot too wide', () => ArcSlot(3, 8, 90), /needs a centerline radius above 4/],
  ['an arc slot too long', () => ArcSlot(20, 6, 350), /the round ends meet for angles above 342\.7461/],
]

for (const [name, make, message] of shapeErrors) {
  test(`shape errors: ${name}`, () => {
    raises(make, RangeError, message)
  })
}

// -- slots, strokes, hulls ----------------------------------------------------------------
test('slots and strokes', () => {
  approx(ArcSlot(30, 6, 90).area, ((30 * PI) / 2) * 6 + 9 * PI)
  assert.deepEqual(types(ArcSlot(30, 6, 90)), ['circle'])
  const between = Stroke(Line([10, 5], [40, 20]), 6)
  approx(between.area, Math.hypot(30, 15) * 6 + 9 * PI)
  const path = new Profile([0, 0]).lineTo(20, 0).arc(10, 90).lineTo({ y: 25 }).wire()
  approx(Stroke(path, 4).area, path.length * 4 + 4 * PI)
  approx(Stroke(path, 4, { ends: 'flat' }).area, path.length * 4)
  const corner = Polyline([0, 0], [20, 0], [20, 20])
  approx(Stroke(corner, 4, { ends: 'flat' }).area, 156 + PI)
  approx(Stroke(corner, 4, { ends: 'flat', corners: 'sharp' }).area, 160)
  approx(Stroke(corner, 4, { ends: 'flat', corners: 'chamfer' }).area, 158)
  const ring = Stroke(CenterArc([0, 0], 10, 0, 360), 2)
  approx(ring.area, PI * 40)
  assert.equal(holes(ring), 1)
  const crossing = Stroke(Polyline([0, 0], [20, 20], [20, 0], [0, 20]), 2)
  assert.equal(crossing.faces().length, 1)
  assert.equal(holes(crossing), 1)
  raises(() => Stroke(new Wire([Line([0, 0], [10, 0]), Line([11, 0], [20, 0])]), 2), ModelingError, /gap of 1 between edge 1 and edge 2/)
  raises(() => Stroke(new Profile().lineTo(10, 0) as unknown as Wire, 2), TypeError, /call \.wire\(\) on a Profile/)
})

test('hull is exact', () => {
  const [r1, r2, d] = [10, 6, 60]
  const beta = Math.asin((r1 - r2) / d)
  const lever = Hull(Circle(10), Pos(60, 0).mul(Circle(6)))
  approx(lever.area, Math.sqrt(d * d - (r1 - r2) ** 2) * (r1 + r2) + r1 * r1 * (PI / 2 + beta) + r2 * r2 * (PI / 2 - beta))
  assert.deepEqual(types(lever), ['circle', 'line'])
  assert.equal(lever.edges().length, 4)
  approx(Hull(Rectangle(20, 10), Pos(20, 0).mul(Circle(5))).area, 300 + 12.5 * PI)
  approx(Hull([0, 0], [10, 0], [5, 8], [5, 2]).area, 40)
  approx(Hull(CenterArc([0, 0], 10, 0, 180), [0, -5]).area, 50 * PI + 50)
  const random = seeded(3)
  for (let n = 0; n < 10; n++) {
    const count = random.randint(1, 4)
    const disks: Sketch[] = []
    for (let i = 0; i < count; i++) disks.push(Pos(random.uniform(-20, 20), random.uniform(-20, 20)).mul(Circle(random.uniform(1, 6))))
    const h = Hull(...disks)
    assert.ok(disks.every((s) => s.cut(h).area < 1e-6))
    assert.equal(h.vertices().concave().length, 0)
  }
  raises(() => Hull([0, 0], [5, 0], [10, 0]), ModelingError, /all the points lie on one line/)
  raises(() => Hull(Spline([0, 0], [10, 5], [20, 0]), [0, 10]), ModelingError, /neither a line nor a circular arc/)
})

// -- Booleans -----------------------------------------------------------------------------
test('a union with a moved circle on the left is right', () => {
  // The kernel's planar Boolean returned 200.48 here (a wrong union, no error).
  const c = Circle(6).rotate(Z, 30).translate(-4, 2)
  const s = Slot(30, 8)
  approx(c.fuse(s).area, c.area + s.area - c.intersect(s).area)
  const a = Circle(10).translate(-5, 0)
  const b = Circle(10).translate(5, 0)
  const lens = 2 * 100 * Math.acos(0.5) - 5 * Math.sqrt(300)
  approx(a.xor(b).area, 2 * (100 * PI - lens))
})

test('Booleans of moved shapes are consistent', () => {
  const random = seeded(11)
  const shape = (): Sketch => {
    const kind = random.choice(['circle', 'rect', 'slot', 'ring'])
    const make: Record<string, () => Sketch> = {
      circle: () => Circle(random.uniform(2, 10)),
      rect: () => Rectangle(random.uniform(3, 20), random.uniform(3, 20), { fillet: 1 }),
      slot: () => Slot(random.uniform(12, 30), random.uniform(3, 10)),
      ring: () => Circle(8).cut(Circle(random.uniform(2, 6))),
    }
    const s = make[kind]()
    return s.rotate(Z, random.uniform(0, 360)).translate(random.uniform(-8, 8), random.uniform(-8, 8))
  }
  for (let n = 0; n < 12; n++) {
    const x = shape()
    const y = shape()
    const [a, b, i] = [x.area, y.area, x.intersect(y).area]
    const tol = 2e-6 * Math.max(1, a, b)
    assert.ok(Math.abs(x.fuse(y).area - (a + b - i)) < tol)
    assert.ok(Math.abs(x.cut(y).area - (a - i)) < tol)
    assert.ok(Math.abs(x.xor(y).area - (a + b - 2 * i)) < tol)
  }
})

test('many tools in one Boolean', () => {
  const plate = Rectangle(200, 120, { fillet: 10 })
  const t0 = performance.now()
  const r = plate.cut(GridLocations(10, 10, 18, 10).mul(Circle(3)))
  assert.ok((performance.now() - t0) / 1000 < 5) // 0.4 s in Python; 6.6 s before tools were combined
  assert.equal(holes(r), 180)
  approx(r.area, 200 * 120 - (4 - PI) * 100 - 180 * 9 * PI)
})

test('Booleans of faces that touch at a point', () => {
  // The faces of an exclusive or of circles touch each other at points. There the kernel's planar
  // Boolean misclassified whole faces without an error, in either operand: abc & t was 54.9061 and
  // abc - t 55.6337 (Python 86.6355 and 23.9044), abc ^ t 67.09 (Python 702.18). The values below
  // are OpenCASCADE's.
  const abc = Circle(5).xor(Circle(5).translate(4, 0)).xor(Circle(5).translate(2, 4))
  const t = Polygon([-20, -20], [20, -20], [0, 20])
  const a = 110.5398163
  approx(abc.area, a)
  for (const r of [abc.intersect(t), t.intersect(abc)]) {
    assert.equal(r.faces().length, 4)
    approx(r.area, a)
    assert.ok(r.center().distanceTo(new Vector(2, 1.5261489, 0)) < 1e-6)
  }
  assert.equal(abc.cut(t).faces().length, 0)
  for (const r of [t.cut(abc), abc.xor(t), t.xor(abc)]) {
    approx(r.area, 800 - a)
    assert.ok(r.center().distanceTo(new Vector(-0.3206561, -7.9802049, 0)) < 1e-6)
  }
  approx(abc.fuse(t).area, 800)
  assert.equal(abc.fuse(t).faces().length, 1)
  // The result is built as the kernel builds such regions: its faces share their vertices.
  approx(abc.intersect(t).extrude(5).volume, 5 * a)

  // two such sketches; OpenCASCADE: & 35.067874, - 103.018076, + 213.322849, ^ 178.254975
  const xor3 = (...centers: [number, number][]) => {
    const c = centers.map(([x, y]) => Circle(5).translate(x, y))
    return c[0].xor(c[1]).xor(c[2])
  }
  const p = xor3([-0.285723, 0.358634], [6.545264, -0.2061], [2.047048, 4.524309])
  const q = xor3([-1.892038, 0.071452], [4.779296, 1.757861], [-0.435259, 2.820408]).translate(-4.911954, 3.715734)
  const i = p.intersect(q).area
  approx(i, 35.067874, 0, 1e-5)
  approx(p.cut(q).area, p.area - i)
  approx(q.cut(p).area, q.area - i)
  approx(p.fuse(q).area, p.area + q.area - i)
  approx(p.xor(q).area, p.area + q.area - 2 * i)
  approx(p.xor(q).area, 178.254975, 0, 1e-5)
})

test('touching faces far from the rest are checked to their own size', () => {
  // Unit squares that touch at corners, and one 1000 away: the check of the face-by-face route took
  // its tolerance from the loose box of the faces' planes (an area of 4.8), and passed a union whose
  // square had become a sliver of 0.2778 by the far one (4.2778 for 5). A face that could not be
  // measured escaped as a plain Error.
  let squares = Rectangle(1, 1).translate(1000.5, 0.5)
  for (const [i, j] of [[0, 0], [0, 3], [1, 0], [1, 1], [4, 1]]) squares = squares.fuse(Rectangle(1, 1).translate(i + 0.5, j + 0.5))
  approx(squares.area, 6)
  // Faces apart from the other operand's go around the kernel (closeout K1): the squares that touch at
  // corners, which raised, and the far one keep their area.
  let more = Rectangle(1, 1).translate(1000.5, 0.5)
  for (const [i, j] of [[0, 2], [3, 2], [3, 3], [4, 1], [4, 3]]) more = more.fuse(Rectangle(1, 1).translate(i + 0.5, j + 0.5))
  approx(more.area, 6)
  approx(Math.min(...more.faces().map((f) => f.area)), 1)
})

test('empty results and operand errors', () => {
  const empty = Rectangle(10, 10).cut(Rectangle(20, 20))
  assert.equal(empty.faces().length, 0)
  assert.equal(Rectangle(10, 10).intersect(Pos(30, 0).mul(Rectangle(10, 10))).faces().length, 0)
  raises(() => empty.extrude(5), ModelingError, /the sketch is empty/)
  raises(() => empty.center(), RangeError, /the sketch is empty/)
  raises(() => Rectangle(10, 10).fuse(Line([0, 0], [20, 0]) as never), TypeError, /makeFace\(\.\.\.\) or new Profile\(\.\.\.\)\.close\(\)/)
})

// -- offset -------------------------------------------------------------------------------
test('offset: the corner styles are exact', () => {
  const r = Rectangle(40, 20)
  const grown = r.offset(2)
  approx(grown.area, 800 + 120 * 2 + 4 * PI)
  assert.deepEqual(types(grown), ['circle', 'line'])
  approx(r.offset(2, { corners: 'sharp' }).area, 44 * 24)
  assert.equal(r.offset(2, { corners: 'sharp' }).edges().length, 4)
  approx(r.offset(2, { corners: 'chamfer' }).area, 44 * 24 - 8)
  approx(r.offset(-2).area, 36 * 16)
  const angle = Polygon([0, 0], [30, 0], [30, 8], [8, 8], [8, 25], [0, 25])
  approx(angle.offset(-2, { corners: 'sharp' }).area, 172)
  approx(angle.offset(-2, { corners: 'chamfer' }).area, 174)
  approx(angle.offset(-2).area, 172 + (4 - PI))
  for (const s of [RegularPolygon(10, 5), Rectangle(30, 10, { fillet: 3 }), Slot(30, 8)]) {
    // Steiner's formula
    approx(s.offset(2.5).area, s.area + s.perimeter * 2.5 + PI * 6.25)
  }
})

test('offset changes the topology where it must', () => {
  const ring = Circle(10).cut(Circle(5))
  approx(ring.offset(1).area, PI * (121 - 16))
  assert.equal(holes(ring.offset(1)), 1)
  assert.equal(holes(ring.offset(6)), 0)
  const two = Circle(5).fuse(Pos(12, 0).mul(Circle(5)))
  assert.equal(two.offset(0.5).faces().length, 2)
  assert.equal(two.offset(2).faces().length, 1)
  const dumbbell = Circle(8).fuse(Pos(30, 0).mul(Circle(8))).fuse(Pos(15, 0).mul(Rectangle(20, 2)))
  assert.equal(dumbbell.offset(-1.5).faces().length, 2)
  assert.equal(holes(Rectangle(40, 40).cut(Rectangle(10, 10)).offset(6)), 0)
  const outline = Rectangle(80, 50, { fillet: 6 })
  const gasket = outline.offset(3).cut(outline)
  approx(gasket.area, outline.perimeter * 3 + 9 * PI)
  assert.equal(holes(gasket), 1)
  for (const shrink of [() => Rectangle(40, 20).offset(-10), () => ring.offset(-2.5), () => Slot(40, 10).offset(-6)]) {
    raises(shrink, ModelingError, /removes the whole region/)
  }
  raises(() => Rectangle(10, 10).offset(1, { corners: 'miter' }), RangeError, /corners is 'round', 'sharp' or 'chamfer'/)
  assert.deepEqual(types(Ellipse(15, 8).offset(2)), ['bspline']) // splines and ellipses: the kernel's offset
})

// -- corners ------------------------------------------------------------------------------
test('corners selected by geometry', () => {
  const angle = Polygon([0, 0], [40, 0], [40, 8], [8, 8], [8, 30], [0, 30])
  assert.equal(angle.vertices().convex().length, 5)
  assert.equal(angle.vertices().concave().length, 1)
  const inner = angle.fillet(4, angle.vertices().concave())
  approx(inner.area, 496 + (4 - PI) * 4)
  assert.equal(inner.vertices().smooth().length, 2)
  const outer = inner.chamfer(1, inner.vertices().convex())
  approx(outer.area, 496 + (4 - PI) * 4 - 2.5)
  const plate = Rectangle(60, 40).cut(Rectangle(20, 10))
  assert.equal(plate.vertices().concave().length, 4) // the corners of the hole
  approx(fillet(plate.vertices().concave(), 2).area, 2200 + (4 - PI) * 4)
  approx(chamfer(plate.vertices().convex(), 1).area, 2200 - 2)
  const rc = Rectangle(30, 20).fuse(Pos(15, 0).mul(Circle(6))) // two corners between a line and an arc
  const rounded = rc.fillet(2, rc.vertices().concave())
  assert.ok(rounded.area > rc.area)
  assertTangentJoints(rounded, 2)
  const lens = Circle(10).intersect(Pos(10, 0).mul(Circle(10))).fillet(2) // corners between two arcs
  assert.deepEqual(types(lens), ['circle'])
  assertTangentJoints(lens, 2)
  const placed = Rectangle(20, 10).on(Plane.XZ)
  approx(placed.fillet(2, placed.vertices().top()).area, 200 - 2 * (4 - PI))
})

const cornerErrors: [string, () => unknown, abstract new (...args: never[]) => Error, RegExp][] = [
  [
    'not a corner',
    () => Rectangle(60, 40).cut(Rectangle(20, 10)).fillet(2, [[1, 2]]),
    ModelingError,
    /\(1, 2\) is not a corner of the sketch; its corners are at/,
  ],
  ['corners that overlap', () => Rectangle(40, 20).fillet(10.5), ModelingError, /they need 10\.5 \+ 10\.5 of its 20/],
  ['no sharp corners', () => Slot(30, 10).fillet(1), ModelingError, /no sharp corners/],
  ['a smooth corner', () => Slot(30, 10).fillet(1, [[10, 5]]), ModelingError, /is smooth/],
  [
    'a corner of a spline',
    () => makeFace(Spline([0, 0], [10, 5], [20, 0], { tangents: [[0, 1], [0, -1]] }).add(Line([20, 0], [0, 0]))).fillet(3),
    ModelingError,
    /no arc of radius 3 touches both segments/, // (OpenCASCADE finds none either; 2.5 fits)
  ],
  ['a zero radius', () => Rectangle(10, 10).fillet(0), RangeError, /must be positive/],
  ['edges for corners', () => Rectangle(10, 10).fillet(1, Rectangle(10, 10).edges() as unknown as Vertex[]), TypeError, /not as an Edge/],
  ['a corner of a part', () => Box(1, 1, 1).vertices()[0].convexity, RangeError, /corners of a sketch/],
]

for (const [name, make, error, message] of cornerErrors) {
  test(`corner errors: ${name}`, () => {
    raises(make, error, message)
  })
}

// -- mirror -------------------------------------------------------------------------------
test('mirror keeps lines, arcs and the side', () => {
  const half = Polygon([0, 0], [20, 0], [20, 5], [5, 20], [0, 20])
  const m = half.mirror(Y)
  same(m.plane.zDir, new Vector(0, 0, 1))
  assert.deepEqual(types(m), ['line'])
  approx(half.extrude(5).mirror(Plane.YZ).cut(m.extrude(5)).volume, 0, 1e-6, 1e-6)
  const lifted = half.translate(0, 0, 10)
  approx(lifted.extrude(5).mirror(Plane.XY).cut(lifted.mirror(Plane.XY).extrude(5)).volume, 0, 1e-6, 1e-6)
  approx(half.fuse(m).area, 575)
  const ring = Pos(10, 0).mul(Circle(5).cut(Circle(2))).mirror(Y)
  assert.deepEqual(types(ring), ['circle'])
  approx(ring.center().x, -10)
  assert.deepEqual(
    Line([0, 0], [10, 5])
      .add(CenterArc([10, 0], 5, 90, -90))
      .mirror(Plane.YZ)
      .edges()
      .map((e) => e.geomType),
    ['line', 'circle'],
  )
  const c = CenterArc([3, 4], 5, 0, 360).mirror(Plane.YZ)
  assert.equal(c.geomType, 'circle')
  same(c.arcCenter, new Vector(-3, 4, 0))
  approx(CenterArc([0, 0], 5, 0, 90).scale(2).radius, 10)
  const outline = Polyline([-20, 0], [-20, 10], [20, 10], [20, 0])
  assert.equal(outline.add(outline.mirror(Plane.XZ)).fillet(2).edges().length, 10)
  raises(() => half.mirror(new Axis([0, 0, 0], [0, 0, 1])), RangeError, /the axis must lie in the sketch plane/)
})
