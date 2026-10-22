// tests/test_lane_FO.py: tangent chains in fillets and chamfers (kernel plan F6).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Axis, Box, CenterArc, Cone, Cylinder, Edge, KernelError, Line, Location, ModelingError, Part, Plane, PolarLocations, Polygon, Rectangle, RegularPolygon, Shell, Slot, Sphere, Vector, X, Y, Z, chamfer, extrude, fillet, offset, setGuardSeconds, shell, stitch, surface, thicken } from '../src/index.ts'
import { ext, k } from '../src/kernel.ts'
import { _take } from '../src/shapes.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: kernel functions replaced in a test
type Any = any

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
  // (the long top edge at y = 15: the two are equally long, and the kernel's order of edges can change)
  const long = at(p, 10).filter((e) => Math.abs(e.length - 30) < 1e-9 && e.center().y > 0).one()
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

// -- batch 2: shell openings with tangent rims (O3), sheet offsets (O7), the fillet executive's record of a
// failure (F8), unequal chamfers (F9), SM_API's global merge (F7) ------------------------------------------

function roundedBox(size: [number, number, number] = [60, 40, 20], r = 5): Part {
  const b = Box(...size)
  return b.fillet(b.edges(), r)
}

test('shell cuts openings whose rim is tangent out of the closed shell', () => {
  // The kernel left the rim of such an opening open (inner rounds up to the outer edge, edges 2 mm off
  // their faces), which 0.5.0 refused; the shell guide's own example.
  const b = roundedBox()
  const closed = b.shell(2)
  const tray = b.shell(2, b.faces().planar().top())
  assert.ok(tray.isValid() && Number(tray._props(1e-6).gaps) < 1e-9)
  approx(tray.volume, 11134.3949, 0, 1e-3)
  approx(tray.volume, closed.volume - 50 * 30 * 2, 1e-8)
  approx(b.shell(2, b.faces().planar().filter((f) => f.normalAt().x > 0.99)).volume, closed.volume - 30 * 10 * 2, 1e-8)
  approx(b.shell(2, b.faces().planar().top().concat(b.faces().planar().bottom())).volume, closed.volume - 2 * 50 * 30 * 2, 1e-8)
  const outward = b.shell(2, b.faces().planar().top(), { outward: true })
  approx(outward.volume, b.shell(2, null, { outward: true }).volume - 50 * 30 * 2, 1e-8)
  assert.equal(outward.classify([0, 0, 11])[0], 'outside')
  assert.equal(tray.classify([24.9, 0, 9.9])[0], 'outside')
  assert.equal(tray.classify([25.4, 0, 9.0])[0], 'inside')
  let cup = Cylinder(20, 30)
  cup = cup.fillet(cup.edges(), 3)
  approx(cup.shell(1, cup.faces().planar().top()).volume, 4766.9544, 0, 1e-3)
  for (const [r, t, expected] of [[1, 0.5, 1238.0236], [2, 0.5, 1233.2227], [3, 1, 2333.4807]]) {
    const box = roundedBox([40, 30, 10], r)
    approx(box.shell(t, box.faces().planar().top()).volume, expected, 0, 1e-3)
  }
  let m = Box(40, 30, 10)
  m = m.fillet(m.edges().top().parallelTo(Y), 3)
  approx(m.shell(1, m.faces().planar().top()).volume, m.shell(1).volume - 34 * 28, 1e-8)
})

test('shell leaves other openings to the kernel', () => {
  const b = roundedBox()
  const top = b.faces().planar().top().one()
  assert.deepEqual(b._openingsToCut([top._f], 2, false), [top._f])
  const rim = top.edges().flatMap((e) => e.faces().filter((g) => !g.equals(top)))
  assert.equal(rim.length, 4)
  assert.deepEqual(b._openingsToCut([top._f, rim[0]._f], 2, false), [])
  assert.deepEqual(b._openingsToCut([rim[0]._f], 2, false), [])
  let v = Box(40, 30, 10)
  v = v.fillet(v.edges().parallelTo(Z), 4)
  assert.deepEqual(v._openingsToCut([v.faces().top().one()._f], 1, false), [])
  approx(v.shell(1, v.faces().top()).volume, 2356.1858, 0, 1e-3)
  let m = Box(40, 30, 10)
  m = m.fillet(m.edges().top().parallelTo(Y), 3)
  assert.deepEqual(m._openingsToCut([m.faces().planar().top().one()._f], 1, true), [])
})

test('sheets and faces offset along their normals', () => {
  const half = extrude(CenterArc([0, 0], 10, 0, 180), 20) as Shell
  const out = half.offset(2)
  assert.ok(out instanceof Shell && out.faces().length === 1)
  approx(out.area, Math.PI * 12 * 20, 1e-9)
  approx(half.offset(-2).area, Math.PI * 8 * 20, 1e-9)
  approx(half.distanceTo(out.faces()[0].interiorPoint()), 2.0, 0, 1e-9)
  approx(half.offset(0).area, half.area, 1e-12)
  const cup = stitch(...Box(20, 20, 20).faces().filter((f) => f.normalAt().z < 0.5)) as Shell
  approx(cup.offset(-1).area, 18 * 18 + 4 * 18 * 19, 1e-9)
  const grown = offset(cup, 1) as Shell
  approx(grown.area, 22 * 22 + 4 * 22 * 21, 1e-9)
  assert.equal(grown.edges().filter((e) => e.faces().length === 1).length, 4)
  const lid = Box(20, 20, 20).faces().top().one().offset(5)
  approx(lid.area, 400)
  approx(lid.bbox().min.z, 15)
  const side = Cylinder(5, 10).faces().filter((f) => f.geomType === 'cylinder').one()
  approx(side.offset(-1).area, 2 * Math.PI * 4 * 10, 1e-9)
  assert.throws(() => half.offset(-12), { name: 'ModelingError', message: /no faces/ })
  const skin = surface([0, 10, 20, 30].map((y) => [0, 10, 20, 30].map((x) => [x, y, 3 * Math.sin(x / 10)]))) as Shell
  assert.throws(() => skin.offset(50), { name: 'ModelingError', message: /lies nowhere at 50/ })
  assert.throws(() => side.offset(-6), { name: 'KernelError', message: /cannot offset this sheet/ })
  assert.throws(() => offset(Box(1, 1, 1).vertices()[0] as never, 1), { name: 'TypeError', message: /offset takes a part, a sketch, a sheet/ }) // (edges and wires offset too)
  approx(thicken(half, 2, { both: true }).volume, (Math.PI * (11 ** 2 - 9 ** 2)) / 2 * 20, 1e-6)
  assert.throws(() => thicken(half, 2, { bth: true } as never), { name: 'TypeError' })
})

test('round_edges drives the executive as SM_API does', () => {
  const p = Box(40, 30, 20).cut(Cylinder(5, 40))
  const sel = p._sharpEdges(p.edges(), 'x')
  const cases: [(b: number, e: number[]) => unknown, (b: number, e: number[]) => unknown][] = [
    [(b, e) => k.fillet_edges(b, e, { radius: 2 }), (b, e) => ext.round_edges(b, e, [2], [1])],
    [(b, e) => k.fillet_edges(b, e, { radius: 1, xsect_type: 0 }), (b, e) => ext.round_edges(b, e, [1], [0])],
    [(b, e) => k.fillet_edges(b, e, { radius: 1, xsect_type: 2, continuity: 2, thumbweight: 1.2 }), (b, e) => ext.round_edges(b, e, [1], [2], { continuity: 2, thumbweight: 1.2 })],
    [
      (b, e) => k.fillet_edges_per_edge(b, e, e.map((_, i) => 1 + 0.1 * (i % 3)), e.map(() => k.FilletXSect.CIRCULAR)),
      (b, e) => ext.round_edges(b, e, e.map((_, i) => 1 + 0.1 * (i % 3)), e.map(() => 1)),
    ],
    [(b, e) => k.variable_radius_fillet(b, e.slice(0, 1), { start_radius: 1, end_radius: 2 }), (b, e) => ext.round_edges(b, e.slice(0, 1), [1], [1], { law: [1, 2] })],
  ]
  for (const [old, now] of cases) {
    const results = [old, now].map((fn) => {
      const [h, kedges] = p._withEdges(sel)
      const out = fn(h.brep, kedges) as { status?: unknown }
      assert.ok(typeof out !== 'object' || out === null || !('status' in out) || out.status === null)
      const q = p._like(_take(h))
      return [q.faces().length, Number(q._props(1e-9).volume)]
    })
    assert.deepEqual(results[0], results[1])
  }
})

test('fillet errors name the corner the kernel could not build', () => {
  const boss = Box(30, 30, 10).fuse(Cylinder(5, 20).translate(10, 10, 0)) // the boss touches the side x = 15
  assert.throws(() => boss.fillet(boss.edges(), 2), (e: unknown) => {
    assert.ok(e instanceof KernelError && e.status === 'SM_ERR_INVALID_INPUT')
    assert.match(e.message, /cannot round the selection as given, at any size: it could not build the corner at \(15, 10, 5\) \(it has no corner for the way the rounded edges meet there\); select fewer edges there/)
    return true
  })
  const cut = Box(10, 5, 20).cut(Cone(4, 5, 20))
  const halves = cut.edges().filter((e) => Math.abs(e.center().x - 5) < 1e-6 && Math.abs(e.center().z - 10) < 1e-6)
  assert.throws(() => cut.fillet(halves, 0.1), { name: 'KernelError', message: /the corner at \(5, 0, 10\)/ })
  const pipe = Box(30, 20, 15).fuse(Cylinder(3.97, 20).rotate(X, 90).translate(0.36, 5.82, 7.05))
  assert.throws(() => pipe.fillet(pipe.edges(), 0.5), (e: unknown) => {
    assert.ok(e instanceof KernelError && e.status === 'SM_ERR')
    const m = /the kernel could not build the corner at \(([^)]*)\) \(.*\); the radius may be too large for the selected edges/.exec(e.message)
    assert.ok(m, e.message)
    const at = new Vector(...(m[1].split(',').map(Number) as [number, number, number]))
    assert.ok(Math.min(...pipe.vertices().map((v) => v.point.distanceTo(at))) < 1e-4)
    return true
  })
  const blk = Polygon([0, 0], [40, 0], [40, 10], [30, 10], [30, 11], [0, 11]).on(Plane.front).extrude(20) as Part
  const edge = blk.edges().filter((e) => Math.abs(e.center().x - 30) < 1e-6 && Math.abs(e.center().z - 11) < 1e-6)
  const [h, kedges] = blk._withEdges(edge)
  const record = ext.round_edges(h.brep, kedges, [1.5], [1])
  assert.equal(record.status, 'SM_ERR')
  assert.equal(record.error, 'corner')
  assert.equal(record.corner, 'Nx1')
  assert.equal(record.edge, -1)
  record.vertex.forEach((c: number, i: number) => approx(c, [30, 0, 11][i], 0, 1e-9))
  assert.match(record.comment, /Corner Edge Computation Failure/)
  h.dispose()
})

test('chamfers with two lengths or an angle', () => {
  const box = Box(40, 30, 20)
  const top = box.faces().top()
  // OpenCASCADE's BRepFilletAPI_MakeChamfer.Add(2, 1, edge, top) on the four edges: 23865.333333333332
  const lead = box.chamfer(top.edges(), 2, { length2: 1, reference: top })
  assert.ok(lead.isValid())
  approx(lead.volume, 23865.333333333332, 1e-12)
  approx(lead.faces().top().one().area, 36 * 26)
  const sides = box.faces().filter((f) => Math.abs(f.normalAt().z) < 0.5)
  approx(box.chamfer(top.edges(), 1, { length2: 2, reference: sides }).volume, lead.volume, 1e-12)
  approx(box.chamfer(top.edges(), 2, { angle: 30, reference: top }).volume, 23844.500327498256, 1e-12)
  const one = box.edges().top()[0]
  approx(box.volume - box.chamfer(one, 2, { angle: 60, reference: top }).volume, 0.5 * 2 * 2 * Math.sqrt(3) * one.length)
  assert.equal(box.chamfer(one, 2, { length2: 2, reference: top }).volume, box.chamfer(one, 2).volume)
  const c = Cylinder(10, 20)
  approx(c.chamfer(c.edges().top(), 2, { length2: 1, reference: c.faces().top() }).volume, 6224.542244312576, 2e-6)
  const tri = Polygon([0, 0], [20, 0], [10, 10 * Math.sqrt(3)]).extrude(10) as Part
  const corner = tri.edges().filter((e) => e.center().x < 1e-6 && e.center().y < 1e-6 && Math.abs(e.center().z - 5) < 1e-6)
  const base = tri.faces().filter((f) => Math.abs(f.center().y) < 1e-6)
  for (const s1 of [1.5, 3]) approx(tri.volume - tri.chamfer(corner, s1, { length2: 1, reference: base }).volume, 0.5 * s1 * Math.sin(Math.PI / 3) * 10)
  assert.throws(() => tri.chamfer(corner, 4, { length2: 1, reference: base }), {
    name: 'ModelingError',
    message: /meet at 60 degrees, and the kernel could not bevel them with setbacks this different \(4 and 1\); bring them closer \(each at least 0.5 times the other always works\)/,
  })
  assert.throws(() => box.chamfer(one, 2, { length2: 1 }), { name: 'RangeError', message: /length2 and angle need reference=/ })
  assert.throws(() => box.chamfer(one, 2, { length2: 1, reference: box.faces().bottom() }), { name: 'RangeError', message: /does not lie on a reference face/ })
  assert.throws(() => box.chamfer(one, 2, { length2: 1, angle: 30, reference: top }), { name: 'RangeError', message: /give length2 or angle, not both/ })
  assert.throws(() => box.chamfer(one, 2, { angle: 130, reference: top }), { name: 'RangeError', message: /use an angle below 90/ })
  approx((chamfer(one, 2, { length2: 1, reference: top }) as Part).volume, box.volume - 0.5 * 2 * 1 * one.length)
})

test('SM_API global merge stays off', () => {
  // F7: moving SM_API's global merge request after SetFilletParameters changed no near-limit cube and
  // broke these chamfers and G2 rounds of a box with a hole, so neither SM_API nor round_edges asks for it.
  const p = Box(40, 30, 20).cut(Cylinder(5, 40))
  // (the kernel bevels the box's edges; the hole's rims are exact cones since F12: 22221.0369 before)
  approx(p.chamfer(p.edges(), 1).volume, 22221.026685, 0, 1e-5)
  approx(p.fillet(p.edges(), 1, { continuity: 'G2' }).volume, 22372.0102, 0, 1e-3)
})

test('fillets that crashed the kernel raise', () => {
  // Two null reads in the kernel's fillet code (smlibpy: the process died; here the module read memory at
  // address 0 and built broken bodies): a boundary curve SmFilletGeom::MakeFaceBrep asked whether it was
  // degenerate, and the side face of a cliff rollover SmFilletSolver::ProcessRollOver had not found.
  const pipe = Box(30, 20, 15).fuse(Cylinder(5.023133573190586, 20).rotate(X, 90).translate(8.998079542446177, 6.843028407324283, 3.2764943433527796))
  assert.throws(() => pipe.chamfer(pipe.edges(), 0.25), {
    name: 'KernelError',
    message: /^chamfer failed \(SM_ERR\): the kernel could not build the round of the edge from \(11\.7172, -3\.15697, 7\.5\) to \(6\.27891, -3\.15697, 7\.5\)/,
  })
  const cone = Box(30, 20, 15).fuse(Cone(3.779342744550086, 0.8306021355423117, 12).translate(9.446745793730727, -7.9149898040942706, 6.188749624221394))
  assert.throws(() => cone.fillet(cone.edges(), 0.5), {
    name: 'KernelError',
    message: /^fillet failed \(SM_ERR\): the kernel could not build the round of the edge from \(-15, -10, 7\.5\) to \(15, -10, 7\.5\)/,
  })
})

test('rounds close to the limit are tried with a finer tolerance', () => {
  const roundedCube = (s: number, r: number): number => {
    const a = s - 2 * r
    return a ** 3 + 6 * a * a * r + 3 * Math.PI * a * r * r + (4 / 3) * Math.PI * r ** 3
  }
  for (const [s, r] of [[10, 4.98], [20, 9.97], [40, 19.96]]) {
    const b = Box(s, s, s)
    const results = [4.0, 1.0].map((factor) => {
      const [h, kedges] = b._withEdges(b.edges())
      const record = ext.round_edges(h.brep, kedges, [r], [1], { tolerance_factor: factor })
      return [record.status, b._like(_take(h))] as const
    })
    assert.ok(!results[0][1].isValid()) // SM_API's: an open body
    assert.equal(results[1][0], null)
    assert.ok(results[1][1].isValid())
    approx(results[1][1].volume, roundedCube(s, r), 1e-9)
    approx(b.fillet(b.edges(), r).volume, roundedCube(s, r), 1e-9)
  }
  // (still refused; how depends on the build: a wrong body, or one the kernel's volume check refuses)
  assert.throws(() => Box(10, 10, 10).fillet(Box(10, 10, 10).edges(), 4.99), { name: /ModelingError|KernelError/, message: /too close to the largest|too large/ })
  const b = Box(10, 10, 10)
  const [h, kedges] = b._withEdges(b.edges())
  assert.throws(() => ext.round_edges(h.brep, kedges, [1], [1], { tolerance_factor: 0 }), { name: 'RangeError', message: /tolerance factor must be positive/ })
  h.dispose()
})

// -- batch 3: offsets of acute parts (O8) and rounded offsets (O9), mitred corners (F10), exact conical
// chamfers (F12) --------------------------------------------------------------------------------------
test('sharp offsets of acute edges are kept', () => {
  // O8: an edge whose faces meet at an angle a moves out by d / sin(a / 2) > d, which offset refused as
  // reaching out of the part's box grown by d. The bound is now the first-order reach of the part's edges
  // and corners (only asked for where a result reaches beyond d).
  const cone = Cone(5, 2, 10).offset(1) // (0.5.0: ModelingError)
  const a = 3.5 + Math.sqrt(1.09) // the offset side runs at radius a - 0.3 z, from z = -6 to 6
  assert.ok(cone.isValid())
  approx(cone.volume, Math.PI * (12 * a * a + 144 * 0.09), 1e-6)
  approx(cone.bbox().max.x, 5.3 + Math.sqrt(1.09), 1e-9) // 6.344, beyond 5 + 1
  const taper = (Rectangle(20, 20).extrude(10, { taper: 10 }) as Part).offset(1)
  const t = Math.tan((10 * Math.PI) / 180)
  const w = 10 + 1 / Math.cos((10 * Math.PI) / 180)
  approx(taper.volume, (4 / (3 * t)) * ((w + t) ** 3 - (w - 11 * t) ** 3), 1e-9)
  approx(taper.bbox().max.x, w + t, 1e-9)
  approx(Box(10, 10, 10)._sharpOffsetReach(), Math.sqrt(3), 1e-12)
  // the kernel's sharp mode fails on an acute wedge: the error points to the rounded mode
  const wedge = Polygon([0, 0], [20, 0], [0, 8]).extrude(5) as Part
  assert.throws(() => wedge.offset(1), (e: unknown) => e instanceof KernelError && /corners="round"/.test(e.message))
  // a result that reaches farther than the part's edges and corners can move is still refused
  const kernel = k as Any
  const real = kernel.offset_brep
  const guard = setGuardSeconds(0) // (in this kernel)
  kernel.offset_brep = (brep: number, d: number, options: Any) => real(brep, 3 * d, options)
  try {
    assert.throws(() => Box(10, 10, 10).offset(1), (e: unknown) => e instanceof ModelingError && /reaches out of the box it must fit in/.test(e.message))
  } finally {
    kernel.offset_brep = real
    setGuardSeconds(guard)
  }
  assert.throws(() => offset(Cylinder(5, 10), 1, { corners: 'chamfer' }), { name: 'RangeError', message: /corners must be "sharp" or "round"/ })
})

test('rounded offsets roll a ball along the part', () => {
  // O9: corners: "round" (the kernel's offset without its extended mode): cylinders and spheres where
  // faces grow apart; every point at the distance from the part (Steiner's formula for convex parts).
  const cube = Box(10, 10, 10)
  const grown = cube.offset(2, { corners: 'round' })
  approx(grown.volume, 1000 + 600 * 2 + 30 * Math.PI * 4 + (4 / 3) * Math.PI * 8, 1e-9)
  assert.deepEqual([...new Set(grown.faces().map((f) => f.geomType))].sort(), ['cylinder', 'plane', 'sphere'])
  assert.equal(grown.faces().length, 26)
  approx(cube.offset(2).volume, 14 ** 3, 1e-9) // (the default stays sharp)
  approx(cube.offset(-2, { corners: 'round' }).volume, 6 ** 3, 1e-9) // convex edges stay sharp inward
  // a wedge (the sharp mode fails): 400 + area 407.7033 + edges 93.5264 + ball 4.1888
  const wedge = Polygon([0, 0], [20, 0], [0, 8]).extrude(5) as Part
  const hyp = Math.hypot(20, 8)
  const steiner = 400 + (160 + 5 * (28 + hyp)) + (5 * Math.PI + ((28 + hyp) * Math.PI) / 2) + (4 / 3) * Math.PI
  approx((offset(wedge, 1, { corners: 'round' }) as Part).volume, steiner, 1e-6)
  // a hole that closes (the sharp mode fails): the rounded box less a dimple over each end of the hole
  const holed = Box(20, 20, 10).cut(Cylinder(3, 20)).offset(4, { corners: 'round' })
  assert.ok(holed.isValid())
  approx(holed.volume, 13170.0401, 1e-8)
  // shrinking rounds the concave edges (OpenCASCADE's arc join: 2097.197642; sharp: 2092)
  const notched = Box(20, 20, 10).cut(Box(10, 10, 10).translate(5, 5, 5))
  approx(notched.offset(-1, { corners: 'round' }).volume, 2097.197642, 1e-8)
  approx(notched.offset(-1).volume, 2092, 1e-9)
})

test('mitred corners', () => {
  // F10: corners: "mitre" runs the rounds of three convex edges on until they meet (no corner patch)
  const cube = Box(20, 20, 20)
  const patchedCorners = cube.fillet(cube.edges(), 2)
  const mitred = cube.fillet(cube.edges(), 2, { corners: 'mitre' })
  approx(patchedCorners.volume, 7804.6961, 1e-8)
  assert.equal(patchedCorners.faces().length, 26)
  // the cube less the union of its edges' round prisms (integrated: 7808.676122)
  assert.ok(mitred.isValid())
  approx(mitred.volume, 7808.676122, 1e-8)
  assert.equal(mitred.faces().length, 18)
  assert.ok(cube.fillet(cube.edges(), 2, { continuity: 'G2', corners: 'mitre' }).isValid())
  // chamfers too: the three bevel planes meet in a point (8000 less 8 x 54 at the corners, 12 x 40 along)
  approx(cube.chamfer(cube.edges(), 2, { corners: 'mitre' }).volume, 7568, 1e-12)
  approx((chamfer(cube.edges(), 2) as Part).volume, 7562.666667, 1e-9)
  let [h, kedges] = cube._withEdges(cube.edges())
  assert.equal(ext.round_edges(h.brep, kedges, [2], [1], [], [], [], 1, 1, 4, true).mitred, 8)
  _take(h)
  const notched = Box(20, 20, 10).cut(Box(10, 10, 10).translate(5, 5, 5))
  ;[h, kedges] = notched._withEdges(notched.edges())
  assert.equal(ext.round_edges(h.brep, kedges, [1], [1], [], [], [], 1, 1, 4, true).mitred, 11) // (not the 3 with a concave edge)
  assert.ok(notched._like(_take(h)).isValid())
  const hexagon = RegularPolygon(10, 6).extrude(5) as Part
  assert.equal(hexagon.fillet(hexagon.edges(), 1, { corners: 'mitre' }).faces().length, 26)
  // where no corner takes a mitre, and for other styles
  assert.throws(() => cube.fillet(cube.edges().filter((e) => e.center().z > 9), 2, { corners: 'mitre' }), { name: 'RangeError', message: /the selection has none/ })
  assert.throws(() => cube.fillet(cube.edges(), 2, { corners: 'round' }), { name: 'RangeError', message: /corners must be "patch" or "mitre"/ })
})

test('chamfers of circular edges are exact cones', () => {
  // F12: the kernel fitted the bevel of a circular edge with a B-spline (volumes off by up to 1.2e-5);
  // between faces coaxial with the edge, smlibwasm cuts it with a solid of revolution: exact.
  const bevelled = (r: number, h: number, s: number) => Math.PI * r * r * h - 2 * 2 * Math.PI * (r - s / 3) * s * s / 2
  for (const [r, h, s] of [
    [2, 5, 1.94],
    [2, 5, 1.0],
    [10, 20, 1],
    [10, 20, 5],
    [1, 2, 0.3],
  ]) {
    const pin = Cylinder(r, h)
    const result = pin.chamfer(pin.edges().filter((e) => e.isClosed), s)
    approx(result.volume, bevelled(r, h, s), 1e-12) // (0.5.0: 1.1e-5 off at r 2)
    assert.ok(!result.faces().some((f) => f.geomType === 'bspline') && result.isValid())
  }
  const holed = Box(20, 20, 10).cut(Cylinder(3, 20))
  const rim = holed.edges().filter((e) => e.isClosed && e.center().z > 4)
  approx(holed.chamfer(rim, 1).volume, holed.volume - 2 * Math.PI * (3 + 1 / 3) * 0.5, 1e-12)
  // a concave rim (a boss on a plate): the bevel fills in
  const boss = Box(30, 30, 5).fuse(Cylinder(5, 10).translate(0, 0, 7.5))
  const base = boss.edges().filter((e) => e.isClosed && Math.abs(e.center().z - 2.5) < 1e-6)
  approx(boss.chamfer(base, 1).volume, boss.volume + 2 * Math.PI * (5 + 1 / 3) * 0.5, 1e-12)
  // unequal setbacks: 2 on the top face, 1 down the side (OpenCASCADE: 6224.542)
  const pin = Cylinder(10, 20)
  const top = pin.edges().filter((e) => e.isClosed && e.center().z > 0)
  approx(pin.chamfer(top, 2, { length2: 1, reference: pin.faces().top() }).volume, Math.PI * 100 * 20 - ((2 * Math.PI * 28) / 3) * 1, 1e-12)
  // faces of a revolve (surfaces of revolution with straight meridians): the flange example's neck
  const section = Polygon([25, 0], [60, 0], [60, 12], [35, 12], [35, 40], [25, 40])
  const neck = section.on(Plane.front).revolve(Z).cut(PolarLocations(47.5, 8).mul(Cylinder(5, 30)) as Any)
  const ends = neck.faces().top().edges().circles()
  approx(neck.chamfer(ends, 1).volume, neck.volume - Math.PI * 60, 1e-12)
  // a cone's rims, and a selection with other edges (the kernel bevels those)
  const frustum = Cone(5, 2, 10)
  assert.ok(frustum.chamfer(frustum.edges(), 0.5).isValid())
  approx(holed.chamfer(holed.edges(), 0.5).volume, holed.chamfer(holed.edges().lines(), 0.5).volume - 2 * 2 * Math.PI * (3 + 1 / 6) * 0.125, 1e-12)
  // where the bevel's tool would take other material (a disc just below the rim), the kernel bevels the
  // edge as before
  const disc = Cylinder(10, 10).fuse(Cylinder(12, 0.5).translate(0, 0, 4.05))
  const edge = disc.edges().filter((e) => e.isClosed && e.center().z > 4.9)
  const kernelBevel = disc.chamfer(edge, 0.6)
  assert.ok(kernelBevel.faces().some((f) => f.geomType === 'bspline'))
  approx(kernelBevel.volume, disc.volume - 2 * Math.PI * (10 - 0.2) * 0.18, 1e-6)
})

// O10: direct editing over SmBrep::LocalOperation (src/cpp/face_edit.cpp).
test('faces move and offset exactly', () => {
  const box = Box(10, 10, 10)
  approx(box.moveFaces(box.faces().top(), [0, 0, 5]).volume, 1500, 1e-12)
  approx(box.offsetFaces(box.faces().top(), -4).volume, 600, 1e-12)
  const block = Box(40, 30, 10).cut(Cylinder(3, 20))
  const taller = block.moveFaces(block.faces().top(), [0, 0, 5])
  approx(taller.volume, 18000 - Math.PI * 9 * 15, 1e-12)
  approx(taller.bbox().size.z, 15, 0, 1e-9)
  assert.equal(taller.faces().length, block.faces().length)
  // a hole moved (its circles stay circles about the new axis), and resized
  const moved = block.moveFaces(block.faces().cylinders(), new Location([8, 0, 0]))
  approx(moved.volume, block.volume, 1e-12)
  for (const e of moved.edges().circles()) approx(e.arcCenter.x, 8, 0, 1e-9)
  const wider = block.offsetFaces(block.faces().cylinders(), -2)
  approx(wider.volume, 12000 - Math.PI * 25 * 10, 1e-12)
  for (const e of wider.edges().circles()) approx(e.radius, 5, 0, 1e-12)
  approx(block.offsetFaces(block.faces().cylinders(), 2).volume, 12000 - Math.PI * 10, 1e-12)
  // a boss: its top pulled up (the extended cylinder's new edge is the exact circle), its side out
  const boss = Box(40, 30, 10).fuse(Cylinder(5, 10).translate(0, 0, 10))
  const top = boss.faces().filter((f) => f.isPlanar && f.center().z > 14)
  const pulled = boss.moveFaces(top, [0, 0, 5])
  approx(pulled.volume, 12000 + Math.PI * 25 * 15, 1e-12)
  assert.ok(pulled.edges().every((e) => e.geomType === 'line' || e.geomType === 'circle'))
  approx(boss.offsetFaces(boss.faces().cylinders(), 1).volume, 12000 + Math.PI * 36 * 10, 1e-12)
  const pin = Cylinder(5, 10)
  approx(pin.offsetFaces(pin.faces().top(), 5).volume, Math.PI * 25 * 15, 1e-12)
  // a wall leaned in by 10 degrees about its bottom edge
  const wall = Box(20, 20, 10)
  const right = wall.faces().filter((f) => f.center().x > 9)
  const leaning = wall.moveFaces(right, Location.about(new Axis([10, 0, -5], [0, -1, 0]), 10))
  approx(leaning.volume, 4000 - 0.5 * 10 * 10 * Math.tan((10 * Math.PI) / 180) * 20, 1e-12)
  // a step's floor raised
  const stepBlock = Box(10, 10, 10).cut(Box(5, 10, 5).translate(2.5, 0, 2.5))
  const step = stepBlock.faces().filter((f) => f.isPlanar && Math.abs(f.center().z) < 1e-6 && f.normalAt().z > 0.5)
  approx(stepBlock.offsetFaces(step, 3).volume, 900, 1e-12)
  approx(box.offsetFaces(box.faces().top(), 0).volume, 1000)
  approx(box.moveFaces(box.faces().top(), [0, 0, 0]).volume, 1000)
})

test('face edits take tangent chains or refuse them', () => {
  const plate = Box(40, 20, 10).cut(Slot(16, 6).extrude(20).translate(0, 0, -10) as Part)
  const end = plate.faces().cylinders()[0]
  const wider = plate.offsetFaces(end, -1)
  approx(wider.volume, 8000 - (10 * 8 + Math.PI * 16) * 10, 1e-12)
  assert.ok(wider.isValid() && wider.faces().length === plate.faces().length)
  assert.throws(() => plate.moveFaces(end, [3, 0, 0]), (e: Error) => e instanceof ModelingError && /meets the moved cylinder face at .* tangentially, so it must be moved with it .*; add it to the faces/.test(e.message))
  const slot = plate.faces().filter((f) => Math.abs(f.normalAt(f.interiorPoint()).z) < 0.5 && Math.abs(f.center().x) < 12 && Math.abs(f.center().y) < 5)
  approx(plate.moveFaces(slot, [5, 0, 0]).volume, plate.volume, 1e-12)
})

test('face edits refuse what the kernel cannot build', () => {
  const box = Box(20, 20, 10)
  const block = Box(40, 30, 10).cut(Cylinder(3, 20))
  const throws = (fn: () => unknown, cls: Any, re: RegExp) => assert.throws(fn, (e: Error) => e instanceof cls && re.test(e.message))
  throws(() => block.offsetFaces(block.faces().cylinders(), 3), ModelingError, /the cylinder face at \(0, 0, 0\) would shrink to nothing/)
  throws(() => box.offsetFaces(box.faces().top(), -12), ModelingError, /do not close the part again/)
  throws(() => box.offsetFaces(box.faces().top(), -10), ModelingError, /offsetFaces: the kernel returned a part whose edges leave its faces/)
  const hollow = Box(20, 20, 20).cut(Box(10, 10, 10))
  throws(() => hollow.offsetFaces(hollow.faces().top(), 1), ModelingError, /the part has a cavity/)
  const voided = Box(20, 20, 20).cut(Sphere(5))
  throws(() => voided.moveFaces(voided.faces().filter((f) => f.geomType === 'sphere'), [1, 0, 0]), ModelingError, /the part has a cavity/)
  throws(() => box.moveFaces([], [0, 0, 1]), RangeError, /no faces selected/)
  throws(() => box.moveFaces(box.faces().top(), 'up' as Any), TypeError, /by must be a Location or a vector/)
  throws(() => box.moveFaces(box.faces().top(), new Location([[2, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]])), RangeError, /rotation and a translation/)
  throws(() => box.offsetFaces(box.faces().top(), '1' as Any), TypeError, /the distance must be a number/)
})

test('shell walls of their own thickness', () => {
  const box = Box(40, 30, 10)
  const right = box.faces().filter((f) => f.center().x > 19)
  const tray = box.shell(2, box.faces().top(), { walls: [[box.faces().bottom(), 5], [right, 6]] })
  approx(tray.volume, 12000 - 32 * 26 * 5, 1e-12)
  assert.ok(tray.isValid())
  approx(box.shell(2, box.faces().top(), { walls: new Map([[box.faces().bottom()[0], 5]]) }).volume, 12000 - 36 * 26 * 5, 1e-12)
  approx(box.shell(2, box.faces().top(), { walls: [[box.faces().bottom(), 1]] }).volume, 12000 - 36 * 26 * 9, 1e-12)
  approx(box.shell(2, box.faces().top(), { walls: [[right, 2]] }).volume, 12000 - 36 * 26 * 8, 1e-12)
  const shut = box.shell(2, null, { walls: [[box.faces().bottom(), 4]] })
  approx(shut.volume, 12000 - 36 * 26 * 4, 1e-12)
  assert.equal(shut.faces().length, 12)
  approx(box.shell(2, null, { outward: true, corners: 'sharp', walls: [[box.faces().bottom(), 4]] }).volume, 44 * 34 * 16 - 12000, 1e-12)
  approx(box.shell(2, box.faces().top(), { outward: true, corners: 'sharp', walls: [[box.faces().bottom(), 4]] }).volume, 44 * 34 * 14 - 12000, 1e-12)
  let rb = Box(40, 30, 10)
  rb = rb.fillet(rb.edges().parallelTo(Z), 5)
  const floor = rb.shell(2, rb.faces().top(), { walls: [[rb.faces().bottom(), 4]] })
  // (the extended rounds of the floor's cavity are fitted by the kernel, and the fit depends on its
  // memory layout: 0 to 1.3e-9 off in this module, depending on what ran before)
  approx(floor.volume, rb.shell(2, rb.faces().top()).volume + (36 * 26 - (4 - Math.PI) * 9) * 2, 1e-8)
  const side = rb.faces().filter((f) => f.isPlanar && f.center().x > 19)
  assert.throws(() => rb.shell(2, rb.faces().top(), { walls: [[side, 4]] }), (e: Error) => e instanceof ModelingError && /walls that meet smoothly need one thickness/.test(e.message))
  assert.throws(() => box.shell(2, box.faces().top(), { walls: [[box.faces().top(), 4]] }), (e: Error) => e instanceof RangeError && /is an opening; it has no wall/.test(e.message))
  assert.throws(
    () => box.shell(2, box.faces().top(), { walls: [[box.faces().bottom(), 4], [box.faces().bottom(), 5]] }),
    (e: Error) => e instanceof RangeError && /given two wall thicknesses/.test(e.message),
  )
  assert.throws(() => box.shell(2, box.faces().top(), { walls: [box.faces().bottom()] as never }), (e: Error) => e instanceof TypeError && /walls takes/.test(e.message))
})

// O12: corners= picks the kernel's shell mode, info() says which a shell got.
test('shell corners pick the kernel mode', () => {
  const L = Box(20, 20, 10).cut(Box(10, 10, 10).translate(5, 5, 0))
  const top = L.faces().top()
  const plain = L.shell(2, top)
  const round = L.shell(2, top, { corners: 'round' })
  const sharp = L.shell(2, top, { corners: 'sharp' })
  approx(plain.volume, round.volume, 1e-12)
  assert.equal(plain.info().corners, 'round')
  approx(round.volume, 1745.1327, 0, 1e-4)
  assert.equal(round.faces().length, 16)
  approx(sharp.volume, 1752, 1e-12)
  assert.equal(sharp.faces().length, 15)
  assert.equal(sharp.info().corners, 'sharp')
  const box = Box(80, 50, 30)
  approx(box.shell(2.5, box.faces().top(), { outward: true, corners: 'sharp' }).volume, 85 * 55 * 32.5 - 80 * 50 * 30, 1e-12)
  assert.equal(box.shell(2.5, box.faces().top(), { outward: true }).info().corners, 'round')
  const body = Cone(3, 4, 6).rotate(Y, 90).fuse(Cone(6, 2, 16).translate(-2, 2.5147, -4))
  const opening = body.faces().filter((f) => f.isPlanar && Math.abs(f.center().x - 3) < 1e-6)
  approx(body.shell(0.5, opening).volume, 274.643, 0, 1e-3)
  approx(body.shell(0.5, opening, { corners: 'sharp' }).volume, 275.8722, 0, 1e-3)
  approx(shell(L, 2, top, { corners: 'sharp' }).volume, 1752, 1e-12)
  assert.equal(Box(10, 10, 10).offset(1).info().corners, 'sharp')
  assert.equal(Box(10, 10, 10).offset(1, { corners: 'round' }).info().corners, 'round')
  assert.ok(!('corners' in Box(10, 10, 10).info()) && !('corners' in sharp.translate(1, 0, 0).info()))
  assert.throws(() => L.shell(2, top, { corners: 'soft' }), (e: Error) => e instanceof RangeError && /corners must be "round" or "sharp"/.test(e.message))
})

// O11: split at the parting line, draft each half about it, fuse (the recipe in docs/features.md).
test('two-sided draft recipe is exact', () => {
  const box = Box(40, 30, 20)
  const [upper, lower] = box.split(Plane.XY, 'both') as [Part, Part]
  const side = (p: Part) => p.faces().filter((f) => Math.abs(f.normalAt().z) < 0.5)
  const molded = upper.draft(side(upper), 3, Plane.XY).fuse(lower.draft(side(lower), 3, Plane.XY.flipped()))
  const t = Math.tan((3 * Math.PI) / 180)
  approx(molded.volume, 2 * (1200 * 10 - 2 * t * 70 * 50 + (4 * t * t * 1000) / 3), 1e-12)
  assert.ok(molded.isValid() && molded.faces().length === 10)
  const angles = [...molded.draftAnalysis(Z)].map((fd) => Math.round(fd.minAngle * 1e6) / 1e6).sort((a, b) => a - b)
  assert.deepEqual(angles, [-90, -3, -3, -3, -3, 3, 3, 3, 3, 90])
  approx(molded.faces().top()[0].bbox().size.x, 40 - 20 * t, 0, 1e-9)
})


test('mitred corners take the American spelling', () => {
  const cube = Box(20, 20, 20)
  approx(cube.fillet(cube.edges(), 2, { corners: 'miter' }).volume, cube.fillet(cube.edges(), 2, { corners: 'mitre' }).volume, 1e-12)
})
