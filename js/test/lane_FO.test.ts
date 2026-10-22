// tests/test_lane_FO.py: tangent chains in fillets and chamfers (kernel plan F6).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Box, Edge, KernelError, Line, Part, Rectangle, Slot, Z, chamfer, fillet } from '../src/index.ts'
import { approx } from './_approx.ts'

/** A 40 x 30 x 10 plate with corners rounded by 5: its top outline is one tangent run. */
function plate(): Part {
  return Rectangle(40, 30, { fillet: 5 }).extrude(10) as Part
}

function at(p: Part, z: number) {
  return p.edges().filter((e) => Math.abs(e.center().z - z) < 1e-6)
}

function longest(edges: Iterable<Edge>): Edge {
  return [...edges].reduce((a, b) => (b.length > a.length ? b : a))
}

/** A box with one vertical edge (at x = 20, y = 15) rounded by 5, and the top line of 35 that runs
 * into the round's arc. */
function cornerBox(): [Part, Edge] {
  let b = Box(40, 30, 10)
  b = b.fillet(b.edges().parallelTo(Z).filter((e) => e.center().x > 0 && e.center().y > 0), 5)
  const line = at(b, 5).filter((e) => e.geomType === 'line' && Math.abs(e.length - 35) < 1e-9).one()
  return [b, line]
}

test('tangentChain selects the run of an edge', () => {
  const p = plate()
  const top = at(p, 10)
  const long = longest(top)
  const chain = long.tangentChain()
  assert.equal(chain.length, 8)
  assert.equal(chain[0]._identity(), long._identity())
  assert.deepEqual(new Set(chain.map((e) => e._identity())), new Set(top.map((e) => e._identity())))
  assert.equal(top.filter((e) => e.geomType === 'line').tangentChain().length, 8)
  assert.equal(Box(10, 10, 10).edges().parallelTo(Z).tangentChain().length, 4) // edges that meet at corners: no run
  assert.equal(p.edges().groupBy(Z)[0].tangentChain().length, 8) // the bottom outline
  assert.equal(p.faces().top().edges().tangentChain().length, 8)
  const [, line] = cornerBox()
  assert.deepEqual(line.tangentChain().map((e) => e.geomType), ['line', 'circle', 'line'])
  assert.equal(Box(10, 10, 10).edges()[0].tangentChain().length, 1)
  assert.equal(Line([0, 0, 0], [1, 0, 0]).tangentChain().length, 1) // an edge of no part
})

test('fillet rounds the tangent run of a selected edge', () => {
  // One top edge of a plate with rounded corners failed at any radius ("the radius may be too
  // large"); the round now follows the outline. OpenCASCADE (which always propagates):
  // 11757.497249759455 for r 1 and 11674.999251067233 for r 2.
  const p = plate()
  const long = longest(at(p, 10))
  const one = p.fillet(long, 1)
  assert.ok(one.isValid())
  approx(one.volume, 11757.497249759455, 1e-9)
  assert.equal(one.faces().length, 18)
  const two = p.fillet(long, 2)
  approx(two.volume, 11674.999251067233, 1e-9)
  approx(two.volume, p.fillet(at(p, 10), 2).volume, 1e-12)
  const arc = at(p, 10).filter((e) => e.geomType === 'circle')[0]
  approx((fillet(arc, 1) as Part).volume, one.volume, 1e-12)
  // A run that ends at sharp corners: the line, the arc and the next line (OpenCASCADE: 14.4862927).
  const [b, line] = cornerBox()
  approx(b.volume - b.fillet(line, 1).volume, 14.486292690588016, 1e-9)
})

test('fillet without propagate rounds the selected edges only', () => {
  const p = plate()
  const long = longest(at(p, 10))
  assert.throws(
    () => p.fillet(long, 1, { propagate: false }),
    (e: Error) =>
      e instanceof KernelError &&
      /runs on tangentially into an edge that is not selected at \(15, 15, 10\) and \(-15, 15, 10\).*propagate=True/.test(e.message),
  )
  assert.throws(() => fillet(long, 1, { propagate: false }), (e: Error) => e instanceof KernelError && /runs on tangentially/.test(e.message))
  // Tangential at one end the kernel rounds the edge alone and runs the round on past its end.
  const [b, line] = cornerBox()
  const alone = b.fillet(line, 1, { propagate: false })
  assert.ok(alone.isValid())
  const removed = b.volume - alone.volume
  assert.ok((1 - Math.PI / 4) * 35 < removed && removed < 14.4862, String(removed))
})

test('added edges take the radius of the selected edge they continue', () => {
  const [b, line] = cornerBox()
  const bottom = at(b, -5).filter((e) => e.geomType === 'line' && Math.abs(e.length - 35) < 1e-9).one()
  const grown = b.fillet([line, bottom], [1, 0.5])
  const explicit = b.fillet([...line.tangentChain(), ...bottom.tangentChain()], [1, 1, 1, 0.5, 0.5, 0.5], { propagate: false })
  assert.ok(grown.isValid())
  approx(grown.volume, explicit.volume, 1e-12)
  assert.throws(() => b.fillet([line, bottom, b.edges().parallelTo(Z)[0]], [1, 0.5]), { name: 'RangeError', message: '2 radii for 3 edges' })
})

test('a radius law does not run along a tangent run', () => {
  const p = plate()
  const long = longest(at(p, 10))
  assert.throws(() => p.fillet(long, { start: 1, end: 2 }), { name: 'RangeError', message: /runs on tangentially into another edge at .*propagate=False/ })
  const [b, line] = cornerBox()
  assert.ok(b.fillet(line, { start: 0.5, end: 1 }, { propagate: false }).isValid())
  approx(b.fillet(line, { start: 1, end: 1 }).volume, b.fillet(line, 1).volume, 1e-12)
})

test('chamfer bevels the tangent run of a selected edge', () => {
  const s = Slot(40, 10).extrude(5) as Part
  const line = at(s, 5).filter((e) => e.geomType === 'line')[0]
  assert.equal(line.tangentChain().length, 4)
  const run = s.chamfer(line.tangentChain(), 1, { propagate: false })
  approx(s.chamfer(line, 1).volume, run.volume, 1e-12)
  approx((chamfer(line, 1) as Part).volume, run.volume, 1e-12)
  assert.ok(run.isValid())
  const alone = chamfer(line, 1, { propagate: false }) as Part // the kernel bevels this one alone, and runs it on
  assert.ok(alone.isValid() && s.volume - alone.volume < s.volume - run.volume)
  assert.throws(() => s.chamfer(line, 1, { propagte: true } as never), { name: 'TypeError', message: /'propagte'; did you mean 'propagate'\?/ })
})
