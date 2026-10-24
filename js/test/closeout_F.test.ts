// tests/test_closeout_F.py: the close-out of the kernel plan's fillets, chamfers, shells and offsets
// (radius laws along runs of edges, the fillet executive's failed step, unequal bevels of sharp wedges,
// exact circles where conical bevels meet cylinders, the fillet preview, face edits and drafts of parts
// with cavities, extended rounds that keep their cylinders and cones, sheets of separate faces offset as
// one, tangent-rim shell openings next to other openings, set-back corners).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Box, Cone, Cylinder, Edge, KernelError, ModelingError, Part, Plane, Polygon, Rectangle, Shell, X, Z, loft, stitch } from '../src/index.ts'
import { ext } from '../src/kernel.ts'
import { _take } from '../src/shapes.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: kernel results in a test
type Any = any

const K = Math.SQRT2 - 1 // a round of radius r on a right-angled edge lies r (sqrt 2 - 1) from the edge

/** The radius of the round of a right-angled edge of the part before, at the edge's point t. */
function radiusAt(part: Part, edge: Edge, t: number): number {
  return part.distanceTo(edge.pointAt(t)) / K
}

/** A 40 x 30 x 10 box with its two +x vertical edges rounded by 5, and the first line of its top run
 * (line, arc, line, arc, line: open at both ends, from x = -20). */
function cornerRun(): [Part, Edge] {
  let b = Box(40, 30, 10)
  b = b.fillet(b.edges().parallelTo(Z).filter((e) => e.center().x > 0), 5)
  const top = b.edges().filter((e) => Math.abs(e.center().z - 5) < 1e-6)
  return [b, top.filter((e) => e.geomType === 'line' && Math.abs(e.center().y + 15) < 1e-6)[0]]
}

function throws(fn: () => unknown, kind: Any, message: RegExp): void {
  assert.throws(fn, (e: Any) => e instanceof kind && message.test(e.message))
}

// -- radius laws along runs of edges (F5, F8)
test('a start-end radius runs along the whole run', () => {
  const [b, first] = cornerRun()
  const run = first.tangentChain()
  assert.deepEqual(
    run.map((e) => e.geomType),
    ['line', 'circle', 'line', 'circle', 'line'],
  )
  const r = b.fillet(first, { start: 1, end: 3 }) // (0.5.0: RangeError; propagate rounds the run)
  assert.ok(r.isValid())
  approx(r.volume, 11795.876320590976, 1e-8)
  const total = run.reduce((s, e) => s + e.length, 0)
  approx(radiusAt(r, first, 0.02), 1 + (2 * 0.02 * 35) / total, 0, 0.03)
  approx(radiusAt(r, first, 0.5), 1 + (2 * 17.5) / total, 0, 0.01)
  const last = run[run.length - 1] // (the line along y = 15, which ends the run at x = -20)
  approx(radiusAt(r, last, last.start.x < last.end.x ? 0 : 1), 3, 0, 0.06)
  approx(b.fillet(run, { start: 1, end: 3 }).volume, r.volume, 1e-12)
  approx(b.fillet(first, { start: 2, end: 2 }).volume, b.fillet(first, 2).volume, 1e-12)
})

test('a radius law through points along the run', () => {
  const [b, first] = cornerRun()
  const r = b.fillet(
    first,
    new Map([
      [0, 1],
      [0.5, 3],
      [1, 1],
    ]),
  )
  assert.ok(r.isValid())
  approx(r.volume, 11791.895790098008, 1e-8)
  approx(radiusAt(r, first, 0.02), 1, 0, 0.05)
  approx(radiusAt(r, first.tangentChain()[2], 0.5), 3, 0, 0.15)
  approx(
    radiusAt(
      b.fillet(
        first,
        new Map([
          [0.5, 3],
          [1, 1],
        ]),
      ),
      first,
      0.02,
    ),
    3,
    0,
    0.05,
  )
  const c = Cylinder(10, 20)
  const rim = c.edges().top()[0]
  const rounded = c.fillet(
    rim,
    new Map([
      [0, 1],
      [0.5, 3],
    ]),
  )
  assert.ok(rounded.isValid())
  approx(rounded.volume, 6225.985184875267, 1e-8)
  const expected = [1.0, 1.998, 3.0, 1.998, 1.0]
  ;[0, 0.25, 0.5, 0.75, 0.999].forEach((t, i) => approx(radiusAt(rounded, rim, t), expected[i], 0, 0.01))
})

test('radius laws the kernel cannot build raise', () => {
  const c = Cylinder(10, 20)
  const rim = c.edges().top()[0]
  throws(() => c.fillet(rim, { start: 1, end: 3 }), RangeError, /a \(start, end\) radius cannot run around a closed edge/)
  throws(
    () =>
      c.fillet(
        rim,
        new Map([
          [0, 1],
          [0.5, 3],
          [1, 2],
        ]),
      ),
    RangeError,
    /the radius at position 1 is the one at 0 .*\(1 and 2\)/,
  )
  const plate = Rectangle(40, 30, { fillet: 5 }).extrude(10) as Part
  const line = plate.edges().filter((e) => Math.abs(e.center().z - 10) < 1e-6 && e.geomType === 'line')[0]
  throws(() => plate.fillet(line, { start: 1, end: 2 }), RangeError, /cannot run around a closed run of edges/)
  throws(
    () =>
      plate.fillet(
        line,
        new Map([
          [0, 1],
          [0.5, 2],
        ]),
      ),
    RangeError,
    /varies around a closed run of 8 edges .* is not possible/,
  )
  approx(
    plate.fillet(
      line,
      new Map([
        [0, 2],
        [1, 2],
      ]),
    ).volume,
    plate.fillet(line, 2).volume,
    1e-12,
  )
  const [b, first] = cornerRun()
  const law = new Map([
    [0, 1],
    [1, 3],
  ])
  throws(() => b.fillet(first, law, { continuity: 'G2' }), RangeError, /continuity needs a constant radius/)
  throws(
    () =>
      b.fillet(
        first,
        new Map([
          [0, 1],
          [2, 3],
        ]),
      ),
    RangeError,
    /lies from 0 \(its start\) to 1 \(its end\), not 2/,
  )
  throws(
    () =>
      b.fillet(
        first,
        new Map([
          [0, 1],
          [1, 0],
        ]),
      ),
    RangeError,
    /the radius must be positive/,
  )
  throws(() => b.fillet(first, new Map([['start' as Any, 1]])), TypeError, /maps positions along the run/)
  const both = Box(40, 30, 10).cut(Cylinder(3, 20))
  const rims = both.edges().filter((e) => e.geomType === 'circle' && e.center().z > 4)
  const edge = both.edges().filter((e) => e.geomType === 'line' && Math.abs(e.center().z - 5) < 1e-6)[0]
  throws(
    () =>
      both.fillet(
        [...rims, edge],
        new Map([
          [0, 1],
          [0.5, 2],
        ]),
      ),
    RangeError,
    /open and closed runs of edges/,
  )
})

test('round_edges spreads a law over a chain', () => {
  const [b, first] = cornerRun()
  const run = [...first.tangentChain()]
  let [h, kedges] = b._withEdges(run)
  const record = ext.round_edges(h.brep, kedges, [1.0], [1], { law: [1.0, 3.0], chains: [[0, 1, 2, 3, 4]] })
  assert.equal(record.status, null)
  approx(b._like(_take(h)).volume, 11795.876320590976, 1e-8)
  ;[h, kedges] = b._withEdges(run)
  assert.throws(() => ext.round_edges(h.brep, kedges, [1.0], [1], { law: [1.0, 3.0], chains: [[0, 1]] }), /each edge must lie in one chain/)
  assert.throws(
    () => ext.round_edges(h.brep, kedges, [1.0], [1], { chains: [[0, 1, 2, 3, 4]], law_at: [0.2, 1.0], law_radii: [1.0, 2.0] }),
    /law_at .* and law_radii/,
  )
  h.dispose()
})

// -- the step the fillet executive failed at (F8)
test('fillet errors say which step failed', () => {
  const p = Box(30, 20, 15).fuse(Cylinder(5.558816439731906, 20).rotate(X, 90).translate(5.784497984417392, 4.295773171366248, 7.767713087022971))
  const [h, kedges] = p._withEdges(p.edges())
  const record = ext.round_edges(h.brep, kedges, [0.3], [1])
  assert.equal(record.status, 'SM_ERR')
  assert.equal(record.stage, 'rail_edge')
  assert.equal(record.error, 'edge')
  h.dispose()
  throws(
    () => p.fillet(p.edges(), 0.3),
    KernelError,
    /\(unable to process rollover: a side of the round does not reach the edge it should end on\); the radius may be too large/,
  )
  const b = Box(10, 10, 10)
  const [h2, k2] = b._withEdges(b.edges())
  assert.equal(ext.round_edges(h2.brep, k2, [2.0], [1]).stage, '')
  h2.dispose()
})

// -- unequal bevels on sharp wedges (F9)
test('unequal bevels of sharp wedges are cut as prisms', () => {
  const tri = Polygon([0, 0], [20, 0], [10, 10 * Math.sqrt(3)]).extrude(10) as Part
  const corner = tri.edges().filter((e) => e.center().x < 1e-6 && e.center().y < 1e-6 && Math.abs(e.center().z - 5) < 1e-6)
  const base = tri.faces().filter((f) => Math.abs(f.center().y) < 1e-6)
  for (const [s1, s2] of [
    [4, 1],
    [6, 1],
    [1, 4],
    [8, 0.5],
  ]) {
    const bevel = tri.chamfer(corner, s1, { length2: s2, reference: base })
    assert.ok(bevel.isValid())
    assert.equal(bevel.faces().length, 6)
    approx(tri.volume - bevel.volume, 0.5 * s1 * s2 * Math.sin(Math.PI / 3) * 10, 1e-9)
  }
  const wedge = Polygon([0, 0], [20, 0], [20, 20 * Math.tan(Math.PI / 6)]).extrude(10) as Part
  const edge = wedge.edges().filter((e) => e.center().x < 1e-6 && Math.abs(e.center().z - 5) < 1e-6)
  const bottom = wedge.faces().filter((f) => Math.abs(f.center().y) < 1e-6)
  for (const [s1, s2] of [
    [5, 1],
    [1, 5],
  ]) {
    approx(wedge.volume - wedge.chamfer(edge, s1, { length2: s2, reference: bottom }).volume, 0.5 * s1 * s2 * 0.5 * 10, 1e-9)
  }
  const top = tri.edges().filter((e) => Math.abs(e.center().z - 10) < 1e-6 && Math.abs(e.center().y) < 1e-6)
  throws(() => tri.chamfer([...corner, ...top], 4, { length2: 1, reference: base }), ModelingError, /could not bevel them with setbacks this different/)
})

// -- exact circles where conical bevels meet cylinders (F12)
test('conical bevels meet cylinders in circles', () => {
  const pin = Cylinder(2, 5).chamfer(Cylinder(2, 5).edges(), 1)
  assert.deepEqual(
    pin.edges().map((e) => e.geomType),
    ['circle', 'circle', 'circle', 'circle'],
  )
  const walls = pin.edges().filter((e) => Math.abs(e.radius - 2) < 1e-9)
  assert.equal(walls.length, 2)
  for (const e of walls) approx(e.length, 4 * Math.PI, 1e-12)
  approx(pin.volume, Math.PI * 4 * 5 - 2 * 2 * Math.PI * ((2 - 1 / 3) / 2), 1e-12)
  assert.ok(pin.faces().ofType('cone').length && pin.isValid())
  const c = Cylinder(10, 20)
  const lead = c.chamfer(c.edges().top(), 2, { length2: 1, reference: c.faces().top() })
  assert.ok(lead.edges().every((e) => e.geomType === 'circle'))
  approx(lead.volume, 6224.542244312576, 1e-9)
  assert.equal(ext.exact_circles(Box(10, 10, 10)._brep), null)
})

// -- the fillet preview (F11)
test('fillet preview shows the rounds without rounding', () => {
  const b = Box(20, 20, 20)
  const sheets = b.filletPreview(b.edges().top(), 2)
  assert.equal(sheets.length, 4)
  assert.ok(sheets.every((s) => s instanceof Shell && s.faces()[0].geomType === 'cylinder'))
  for (const s of sheets) approx(s.faces()[0].radius, 2, 1e-12)
  approx(b.volume, 8000, 1e-12)
  assert.equal(b.faces().length, 6)
  const plate = Rectangle(40, 30, { fillet: 5 }).extrude(10) as Part
  const line = plate.edges().filter((e) => Math.abs(e.center().z - 10) < 1e-6 && e.geomType === 'line')[0]
  assert.equal(plate.filletPreview(line, 2).length, 8)
  assert.equal(plate.filletPreview(line, 2, { propagate: false }).length, 1)
  throws(() => b.filletPreview(b.edges().top(), 0), RangeError, /the radius must be positive/)
})

// -- face edits and drafts of parts with cavities (O10)
const hollow = (): Part => Box(40, 30, 20).cut(Box(10, 10, 10))
const cavityTop = (p: Part) => p.faces().filter((f) => Math.abs(f.center().z - 5) < 1e-6 && Math.abs(f.center().x) < 1e-6)

test('face edits of a part with a cavity', () => {
  const p = hollow()
  assert.equal(p.info().voids, 1)
  const up = p.moveFaces(p.faces().top(), [0, 0, 2]) // (0.5.0: ModelingError, the kernel drops cavities)
  approx(up.volume, 40 * 30 * 22 - 1000, 1e-12)
  assert.equal(up.info().voids, 1)
  approx(p.offsetFaces(p.faces().top(), 2).volume, up.volume, 1e-12)
  const smaller = p.offsetFaces(cavityTop(p), 1)
  approx(smaller.volume, 24000 - 10 * 10 * 9, 1e-12)
  assert.equal(smaller.info().voids, 1)
  approx(p.moveFaces(cavityTop(p), [0, 0, 3]).volume, 24000 - 1300, 1e-12)
  const two = Box(40, 30, 20)
    .cut(Box(6, 6, 6).translate(-10, 0, 0))
    .cut(Box(6, 6, 6).translate(10, 0, 0))
  const tops = two.faces().filter((f) => Math.abs(f.center().z - 3) < 1e-6)
  assert.equal(tops.length, 2)
  approx(two.offsetFaces([...tops, ...two.faces().top()], 1).volume, 40 * 30 * 21 - 2 * 6 * 6 * 5, 1e-12)
  throws(() => p.moveFaces(cavityTop(p), [0, 0, 6]), ModelingError, /the moved faces reach a cavity of the part/)
})

test('draft of a part with a cavity', () => {
  const p = hollow()
  const plain = Box(40, 30, 20)
  const outer = (q: Part) => q.faces().filter((f) => Math.abs(f.normalAt().z) < 1e-6 && Math.max(Math.abs(f.center().x), Math.abs(f.center().y)) > 6)
  const drafted = p.draft(outer(p), 3, Plane.XY)
  approx(drafted.volume, plain.draft(outer(plain), 3, Plane.XY).volume - 1000, 1e-12)
  assert.equal(drafted.info().voids, 1)
  const inner = p.faces().filter((f) => Math.abs(f.normalAt().z) < 1e-6 && Math.max(Math.abs(f.center().x), Math.abs(f.center().y)) < 6)
  const walls = p.draft(inner, 3, Plane.XY)
  const cavity = Box(10, 10, 10)
  const alone = cavity.draft(
    cavity.faces().filter((f) => Math.abs(f.normalAt().z) < 1e-6),
    -3,
    Plane.XY,
  )
  approx(walls.volume, 24000 - alone.volume, 1e-12)
  const analysis = walls.draftAnalysis([0, 0, 1])
  assert.equal(analysis.positive.length, 6)
  assert.equal(analysis.vertical.length, 4)
})

// -- extended rounds keep their cylinders and cones (O10)
test('faces extended by a face edit keep their cylinders and cones', () => {
  let b = Box(40, 30, 10)
  b = b.fillet(b.edges().parallelTo(Z), 3)
  const taller = b.offsetFaces(b.faces().top(), 5) // (0.5.0: four surfaces of extrusion)
  assert.deepEqual(taller.faces().map((f) => f.geomType).sort(), ['cylinder', 'cylinder', 'cylinder', 'cylinder', 'plane', 'plane', 'plane', 'plane', 'plane', 'plane'])
  for (const f of taller.faces().cylinders()) approx(f.radius, 3, 1e-12)
  approx(taller.volume, 1.5 * b.volume, 1e-8)
  assert.ok(taller.isValid())
  const lower = b.moveFaces(b.faces().top(), [0, 0, -3])
  assert.equal(lower.faces().cylinders().length, 4)
  approx(lower.volume, 0.7 * b.volume, 1e-12)
  const hole = Box(40, 30, 10).cut(Cone(6, 3, 10))
  const deeper = hole.offsetFaces(hole.faces().top(), 2)
  assert.equal(deeper.faces().ofType('cone').length, 1)
  const radii = deeper
    .edges()
    .circles()
    .map((e) => e.radius)
    .sort((x, y) => x - y)
  approx(radii[0], 2.4, 1e-9)
  approx(radii[1], 6, 1e-9)
  approx(deeper.volume, 40 * 30 * 12 - ((Math.PI * 12) / 3) * (36 + 6 * 2.4 + 2.4 ** 2), 1e-12)
})

// -- sheets of separate faces offset as one (O7)
test('a sheet of separate faces is offset as one', () => {
  const cup = Box(20, 20, 20)
    .faces()
    .filter((f) => f.normalAt().z < 0.5)
  const pieces = Shell._wrap(ext.combine(cup.map((f) => f.toShell()._copyBrep())))
  assert.equal(pieces.faces().length, 5)
  assert.equal(pieces.edges().length, 20)
  const inner = pieces.offset(-1) // (0.5.0: ModelingError, "it built no faces")
  assert.equal(inner.faces().length, 5)
  approx(inner.area, 1692, 1e-12)
  approx(inner.area, (stitch(...cup.map((f) => f.toShell())) as Shell).offset(-1).area, 1e-12)
})

// -- shell openings with a tangent rim next to another opening (O3)
test('a tangent-rim opening next to another opening', () => {
  let b = Box(60, 40, 20)
  b = b.fillet([...b.edges().parallelTo(Z), ...b.edges().filter((e) => Math.abs(e.center().z + 10) < 1e-6)], 5)
  const top = b.faces().planar().top()
  const side = b.faces().planar().filter((f) => f.normalAt().x > 0.99)
  const openTop = b.shell(2, top)
  const both = b.shell(2, [...top, ...side]) // (0.5.0: ModelingError, the kernel left the side's rim open)
  assert.ok(both.isValid())
  assert.equal(both.faces().length, 36)
  approx(both.volume, openTop.volume - 30 * 15 * 2, 1e-9)
  assert.ok(Number(both._props(1e-6).gaps) < 1e-9)
})

// -- set-back corners (F10)
test('set-back corners', () => {
  const b = Box(20, 20, 20)
  const ball = b.fillet(b.edges(), 2)
  const soft = b.fillet(b.edges(), 2, { setback: 3 }) // (0.5.0: no setback; the kernel's merge left it open)
  assert.ok(soft.isValid() && Number(soft._props(1e-6).gaps) < 1e-5)
  approx(soft.volume, 7781.609270356783, 1e-6)
  assert.ok(soft.volume < ball.volume)
  // the rounds stop 3 from each corner: 12 cylinders of radius 2, 20 - 2 x 3 long; 6 patch faces a corner
  const rounds = soft.faces().filter((f) => f.geomType === 'cylinder')
  assert.equal(rounds.length, 12)
  for (const f of rounds) approx(f.area, 14 * Math.PI, 1e-9)
  assert.equal(soft.faces().filter((f) => f.geomType === 'bspline').length, 48)
  // the floor corners of a pocket (three concave edges) are set back too, its rim corners are not
  const pocket = Box(40, 40, 20).cut(Box(20, 20, 10).translate(0, 0, 5))
  const [h, kedges] = pocket._withEdges(pocket.edges())
  const record = ext.round_edges(h.brep, kedges, [2.0], [1], { setback: 5.0 })
  assert.equal(record.status, null)
  assert.equal(record.set_back, 12) // (8 outside, 4 on the floor)
  h.dispose()
  const p = pocket.fillet(pocket.edges(), 2, { setback: 5 })
  assert.ok(p.isValid())
  approx(p.volume, 27649.245759895017, 1e-6)
})

test('set-back corners the kernel cannot build throw', () => {
  const b = Box(20, 20, 20)
  throws(() => b.fillet(b.edges(), 2, { setback: 2 }), RangeError, /must exceed how far the rounds reach/) // (the rounds cross the corner's edges 2 from it)
  throws(() => b.fillet(b.edges(), 2, { setback: 10 }), RangeError, /too large for the edge/) // (the corners at both ends of each edge would meet)
  throws(() => b.fillet(b.edges(), 2, { setback: 3, corners: 'mitre' }), RangeError, /mitred .* or set back/)
  throws(() => b.fillet(b.edges(), { start: 1, end: 2 }, { setback: 3 }), RangeError, /constant radius/)
  throws(() => b.fillet(b.edges().filter((e) => e.center().z > 9), 2, { setback: 3 }), RangeError, /has none/)
  throws(() => b.fillet(b.edges(), 2, { setback: 0 }), RangeError, /positive/)
  // corners between slanted faces: the kernel's set-back corners come out broken, refused
  const frustum = loft([Rectangle(20, 20), Rectangle(10, 10).translate(0, 0, 10)], { ruled: true }) as Part
  throws(() => frustum.fillet(frustum.edges(), 1, { setback: 3 }), KernelError, /set back these corners/)
  const [h, kedges] = b._withEdges(b.edges())
  assert.throws(() => ext.round_edges(h.brep, kedges, [1.0], [1], { law: [1.0, 2.0], setback: 3.0 }), /laws/)
  h.dispose()
})
