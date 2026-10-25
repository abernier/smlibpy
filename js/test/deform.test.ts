// tests/test_deform.py: twist, taper, bend and lattices (the deform module).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelingError, ext, k } from '../src/kernel.ts'
import { Axis, Plane, type Vector, X, Y, Z } from '../src/geometry.ts'
import { type Face, Part, Shell } from '../src/shapes.ts'
import { Box, Cylinder, Sphere } from '../src/parts.ts'
import { Rectangle } from '../src/sketches.ts'
import { surface } from '../src/surfaces.ts'
import { exportStep } from '../src/exporters.ts'
import { importStep } from '../src/step_import.ts'
import { Lattice, MAX_DEGREE, type _Plan, _planBend, _planTaper, _planTwist, bend, twist } from '../src/deform.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: kernel results
type Any = any

function volume(p: Part): number {
  return p.volume // smlibpy's own integration (measure.cpp): exact on deformed parts too
}

function surfaces(p: Part): Any[] {
  return p.faces().map((f) => ext.surface_data(k.face_surface(f._f), true))
}

/** Points of a face (a UV grid, those inside the trims). */
function facePoints(face: Face, n = 4): number[][] {
  const [[u0, v0], [u1, v1]] = k.face_uv_domain(face._f)
  const out: number[][] = []
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const u = u0 + ((a + 0.5) / n) * (u1 - u0)
      const v = v0 + ((b + 0.5) / n) * (v1 - v0)
      if (k.face_classify_uv(face._f, u, v) !== 'outside') out.push(k.face_point_at_uv(face._f, u, v))
    }
  }
  return out
}

/** Largest distance between the result and the exact map of the plan's shape, at the same
 * parameters. */
function deviation(plan: _Plan, result: Part | Shell): number {
  const spec = { ...plan.spec, max_degree: MAX_DEGREE }
  const d = k.deform.deviation(plan.shape._brep, result._brep, spec, 9)
  return Math.max(...(Object.values(d) as number[]))
}

/** Python's round(v, 9), without -0. */
function round9(v: number): number {
  return Math.round(v * 1e9) / 1e9 + 0
}

/** The points rounded to 9 decimals and sorted (Python's sorted tuples). */
function sortedPoints(points: Iterable<Vector>): number[][] {
  const out = Array.from(points, (p) => [round9(p.x), round9(p.y), round9(p.z)])
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
}

/** pytest.raises: `fn` throws an instance of `cls` whose message matches. */
function raises(fn: () => unknown, cls: abstract new (...args: Any[]) => Error, match?: RegExp): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof cls, `expected a ${cls.name}, got ${String(e)}`)
    if (match) assert.match((e as Error).message, match)
    return true
  })
}

/** numpy's allclose of two triples. */
function allclose(a: readonly number[], b: readonly number[]): boolean {
  return a.every((x, i) => Math.abs(x - b[i]) <= 1e-8 + 1e-5 * Math.abs(b[i]))
}

// -- twist -----------------------------------------------------------------------------------
test('twist keeps volume and topology', () => {
  const box = Box(20, 10, 100)
  const bar = box.twist(90)
  assert.ok(bar.isValid() && bar.faces().length === 6 && bar.edges().length === 12)
  approx(volume(bar), 20000, 1e-8)
  // the top is turned by exactly 90 degrees about Z: 20 x 10 becomes 10 x 20
  const top = sortedPoints(bar.vertices().filter((v) => v.z > 49).map((v) => v.point))
  assert.deepEqual(top, [
    [-5, -10, 50],
    [-5, 10, 50],
    [5, -10, 50],
    [5, 10, 50],
  ])
  const bottom = sortedPoints(bar.vertices().filter((v) => v.z < -49).map((v) => v.point))
  assert.deepEqual(bottom, [
    [-10, -5, -50],
    [-10, 5, -50],
    [10, -5, -50],
    [10, 5, -50],
  ])
})

test('twist is exact where it can be and within tolerance elsewhere', () => {
  const box = Box(20, 20, 100)
  const plan = _planTwist(box, 90.0, Z, null, null, 1e-6)
  const bar = box.twist(90)
  assert.ok(deviation(plan, bar) < 1e-6)
  const data = surfaces(bar)
  // top and bottom only turn: planes again; the sides are B-splines that keep their straight rulings
  assert.deepEqual(data.map((d) => d.kind).sort(), ['bspline', 'bspline', 'bspline', 'bspline', 'plane', 'plane'])
  const degrees = data.filter((d) => d.kind === 'bspline').map((d) => [d.u_degree, d.v_degree] as [number, number])
  assert.ok(degrees.every((dd) => dd.includes(1)))
})

test('twist range turns the rest rigidly', () => {
  const box = Box(20, 10, 100)
  const bar = box.twist(90, { start: -20, end: 20 })
  assert.ok(bar.isValid() && bar.faces().length === 14) // the side faces are split at the range ends
  approx(volume(bar), 20000, 1e-8)
  const top = sortedPoints(bar.vertices().filter((v) => v.z > 49).map((v) => v.point))
  assert.deepEqual(top, [
    [-5, -10, 50],
    [-5, 10, 50],
    [5, -10, 50],
    [5, 10, 50],
  ])
  // below the range nothing moved; above it the faces are planes again, only turned
  const low = bar.faces().filter((f) => f.center().z < -21)
  assert.ok(low.length === 5 && low.every((f) => f.geomType === 'plane'))
  const high = bar.faces().filter((f) => f.center().z > 21)
  assert.ok(high.length === 5 && high.every((f) => f.geomType === 'plane'))
  const plan = _planTwist(box, 90.0, Z, -20, 20, 1e-6)
  assert.ok(deviation(plan, bar) < 1e-6)
})

test('twist round trip', () => {
  const part = Box(30, 20, 60).cut(Cylinder(4, 80))
  const back = part.twist(120).twist(-120)
  assert.ok(back.isValid() && back.faces().length === part.faces().length)
  approx(volume(back), volume(part), 1e-7)
  for (const v of back.vertices()) assert.ok(part.distanceTo(v.point) < 1e-6)
  for (const f of back.faces()) assert.ok(Math.max(...facePoints(f).map((p) => part.distanceTo(p))) < 2e-6)
})

test('twist about another axis and with holes', () => {
  const plate = Box(80, 60, 10).cut(Cylinder(5, 20))
  const t = plate.twist(30, { axis: new Axis([0, 0, 0], [0, 1, 0]) })
  assert.ok(t.isValid())
  approx(volume(t), 80 * 60 * 10 - Math.PI * 25 * 10, 1e-7)
})

// -- taper -----------------------------------------------------------------------------------
test('taper turns a cylinder into an exact cone', () => {
  const cyl = Cylinder(10, 50)
  const cone = cyl.taper(0.5)
  assert.ok(cone.isValid() && cone.faces().length === 3)
  approx(volume(cone), ((Math.PI * 50) / 3) * (100 + 50 + 25), 1e-9)
  const plan = _planTaper(cyl, 0.5, Z, null, null, 1e-6)
  assert.ok(deviation(plan, cone) < 1e-9) // exact
  const side = surfaces(cone).filter((d) => d.weights != null)
  assert.deepEqual(
    side.map((d) => [d.u_degree, d.v_degree]),
    [[2, 1]],
  )
  // the top circle has half the radius
  const top = cone.edges().sortBy(Z).at(-1)!
  for (const t of [0.0, 0.3, 0.7]) {
    const p = top.pointAt(t)
    approx(Math.hypot(p.x, p.y), 5, 0, 1e-9)
    approx(p.z, 25, 0, 1e-9)
  }
})

test('taper box is a frustum and ranges work', () => {
  const f = Box(20, 20, 50).taper(2.0)
  approx(volume(f), (50 / 3) * (400 + 1600 + 800), 1e-12)
  const half = Box(20, 20, 50).taper(0.5, { start: 0 })
  assert.ok(half.isValid() && half.faces().length === 10)
  approx(volume(half), 20 * 20 * 25 + (25 / 3) * (400 + 100 + 200), 1e-12)
})

// -- bend ------------------------------------------------------------------------------------
test('bend keeps the volume of a bar bent about its middle layer', () => {
  const bar = Box(100, 10, 10)
  const b = bar.bend(90)
  assert.ok(b.isValid() && b.faces().length === 6)
  approx(volume(b), 10000, 1e-6)
  const r = 100 / (Math.PI / 2)
  const areas = b.faces().map((f) => Math.round(f.area * 1e6) / 1e6).sort((x, y) => x - y)
  const expected = [100, 100, 1000, 1000, (((r - 5) * Math.PI) / 2) * 10, (((r + 5) * Math.PI) / 2) * 10].sort((x, y) => x - y)
  areas.forEach((a, i) => approx(a, expected[i], 1e-7))
  const plan = _planBend(bar, 90.0, null, Plane.XZ, null, null, 1e-6)
  assert.ok(deviation(plan, b) < 1e-6)
})

test('bend changes the volume by Pappus rule', () => {
  // neutral layer at the bottom of the bar: every layer above it gets shorter by (r - y) / r
  const bar = Box(100, 10, 10)
  const b = bar.bend(90, { plane: new Plane([0, 0, -5], [1, 0, 0], [0, -1, 0]) })
  const r = 100 / (Math.PI / 2)
  approx(volume(b), 10000 * (1 - 5 / r), 1e-6)
})

test('bend with radius makes straight legs', () => {
  const u = Box(160, 10, 6).bend(180, { radius: 25 })
  assert.ok(u.isValid() && u.faces().length === 14)
  approx(volume(u), 160 * 10 * 6, 1e-6)
  const bb = u.bbox()
  // the left leg stays, the right one comes back above it, 2 * 25 higher
  approx(bb.min.x, -80)
  approx(bb.max.z, 53)
  const legs = u
    .faces()
    .filter((f) => f.geomType === 'plane' && Math.abs(f.normalAt().z) > 0.999)
    .sortBy((f) => f.center().z)
  assert.deepEqual(
    legs.map((f) => round9(f.center().z)),
    [-3, 3, 47, 53],
  )
})

test('bend downward from a start', () => {
  const b = Box(100, 10, 10).bend(-90, { radius: 20, start: 10 })
  const bb = b.bbox()
  approx(bb.max.x, 35)
  approx(bb.min.z, -20 - (50 - 10 - 10 * Math.PI))
  approx(volume(b), 10000, 1e-6)
})

test('bend refuses what cannot work', () => {
  raises(() => Box(100, 10, 10).bend(90, { radius: 4 }), ModelingError, /larger radius/)
  raises(() => Box(100, 10, 10).bend(360), RangeError, /less than 360/)
  raises(() => Box(100, 10, 10).bend(90, { radius: 10, start: 0, end: 5 }), RangeError, /only two of radius/)
  raises(() => Box(100, 10, 10).bend(90, { radius: 10, start: 60 }), ModelingError, /does not reach/)
})

// -- lattice ---------------------------------------------------------------------------------
test('an unchanged lattice changes nothing', () => {
  const part = Box(30, 20, 10).cut(Cylinder(3, 20))
  const lat = new Lattice(part, 3)
  const same = lat.apply(part)
  approx(volume(same), volume(part), 1e-10)
  for (const v of same.vertices()) assert.ok(part.distanceTo(v.point) < 1e-9)
})

test('a lattice result is exact', () => {
  const block = Box(60, 40, 20)
  const lat = new Lattice(block, 3)
  lat.move([1, 1, -1], [0, 0, 8])
  const plan = lat._plan(block, 1e-6)
  const pillow = lat.apply(block)
  assert.ok(pillow.isValid() && pillow.faces().length === 6)
  assert.ok(deviation(plan, pillow) < 1e-9)
  const allowed = ['1,1', '1,2', '2,1', '2,2']
  assert.ok(surfaces(pillow).every((d) => allowed.includes(`${d.u_degree},${d.v_degree}`)))
  // the Bernstein weight of the middle point at the middle of the top is 1/2 * 1/2
  const top = pillow.faces().sortBy(Z).at(-1)!
  assert.ok(top.distanceTo([0, 0, 10 + 8 * 0.25]) < 1e-9)
  const m = lat.map([0, 0, 10])
  approx(m.x, 0)
  approx(m.y, 0)
  approx(m.z, 12)
})

test('a lattice on curved parts is exact up to MAX_DEGREE', () => {
  const cyl = Cylinder(15, 20)
  const lat = new Lattice(cyl, 3)
  lat.scale(lat.layer(Z, -1), 1.5)
  const out = lat.apply(cyl)
  assert.ok(out.isValid())
  assert.ok(deviation(lat._plan(cyl, 1e-6), out) < 1e-9)
  const sph = Sphere(10)
  const lat4 = new Lattice(sph, 4)
  lat4.move([1, 1, 3], [0, 0, 6])
  const blob = lat4.apply(sph) // a sphere in a 4 x 4 x 4 lattice needs degree 18: within the tolerance
  assert.ok(blob.isValid() && deviation(lat4._plan(sph, 1e-6), blob) < 1e-6)
})

test('dense free-form faces stay within the tolerance', () => {
  // An offset of a free-form surface has thousands of knots: exact images would be huge, so the
  // lattice approximates that face; twist and lattice must stay within the tolerance. (Volumes
  // are not compared here: the kernel integrates such dense bodies only to about 1e-6, and slowly;
  // its own exact composition of the twist measures like the result.)
  const n = 10
  const lin = (i: number) => (i === n - 1 ? 100 : i * (100 / (n - 1))) // numpy's linspace(0, 100, n)
  const pts = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const x = lin(i)
      const y = lin(j)
      return [x, y, 3 * Math.sin(x / 7) * Math.cos(y / 9)]
    }),
  )
  const slab = surface(pts).thicken(5)
  const lat = new Lattice(slab, 3)
  lat.move([1, 1, -1], [0, 0, 5])
  let plan = lat._plan(slab, 1e-6)
  const out = lat.apply(slab)
  let spec = { ...plan.spec, max_degree: MAX_DEGREE }
  assert.ok(out.isValid() && Math.max(...(Object.values(k.deform.deviation(slab._brep, out._brep, spec, 40)) as number[])) < 1e-6)
  const axis = new Axis(slab.bbox().center, [0, 0, 1])
  plan = _planTwist(slab, 30.0, axis, null, null, 1e-6)
  const tw = slab.twist(30, { axis })
  spec = { ...plan.spec, max_degree: MAX_DEGREE }
  assert.ok(tw.isValid() && Math.max(...(Object.values(k.deform.deviation(plan.shape._brep, tw._brep, spec, 40)) as number[])) < 1e-6)
})

test('lattice editing helpers', () => {
  const lat = new Lattice(Box(10, 10, 10), [2, 3, 4])
  const p = lat.points
  assert.ok(p.length === 2 && p[0].length === 3 && p[0][0].length === 4 && p[0][0][0].length === 3)
  assert.deepEqual(lat.counts, [2, 3, 4])
  lat.move(lat.layer(Z, -1), [0, 0, 2])
  const offsets = lat.offsets
  for (const a of offsets) {
    for (const b of a) {
      assert.ok(allclose(b[b.length - 1], [0, 0, 2]))
      for (const d of b.slice(0, -1)) assert.ok(allclose(d, [0, 0, 0]))
    }
  }
  lat.reset().scale(lat.layer(Z, 0), 2.0)
  approx(Math.min(...lat.points.flatMap((a) => a.map((b) => b[0][0]))), -10)
  lat.reset().rotate(lat.layer(Z, -1), Z, 90)
  const q = lat.points[1][0].at(-1)!
  ;[5, 5, 5].forEach((x, i) => approx(q[i], x)) // (5, -5) turned by 90 degrees
  raises(() => lat.move([1, 1] as never, [0, 0, 1]), RangeError)
  raises(() => new Lattice(Box(10, 10, 10), 1), RangeError)
})

test('a lattice refuses folding', () => {
  const lat = new Lattice(Box(10, 10, 10), 3)
  lat.move([2, 1, 1], [-30, 0, 0])
  raises(() => lat.apply(Box(10, 10, 10)), ModelingError, /folds/)
})

// -- shells, kernel composition, downstream --------------------------------------------------
test('sketches and shells deform to shells', () => {
  const s = twist(Rectangle(100, 20), 90, { axis: X })
  assert.ok(s instanceof Shell && s.area > 2000)
  const b = bend(Rectangle(100, 20), 90)
  assert.ok(b instanceof Shell)
  approx(b.area, 2000, 1e-7)
})

test("the kernel's composition agrees", () => {
  // The kernel's own (procedural) composition of the twist and our NURBS are the same body.
  const box = Box(20, 20, 100)
  const plan = _planTwist(box, 90.0, Z, null, null, 1e-6)
  const exact = Part._wrap(k.deform.composite_brep(box._brep, plan.spec))
  assert.equal(ext.surface_data(k.face_surface(exact.faces()[0]._f), false).class, 'SmSrfInVolume')
  approx(exact.volume, 40000, 1e-9)
  const bar = box.twist(90)
  for (const f of exact.faces()) assert.ok(Math.max(...facePoints(f).map((p) => bar.distanceTo(p))) < 1e-6)
})

test('deformed parts work downstream', () => {
  const bar = Box(20, 20, 100).twist(90)
  const holed = bar.cut(Cylinder(4, 40).rotate(X, 90))
  assert.ok(holed.isValid() && volume(holed) < volume(bar))
  const rounded = bar.fillet(bar.faces().sortBy(Z).at(-1)!.edges(), 2)
  assert.ok(rounded.isValid())
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-deform-'))
  exportStep(bar, join(dir, 'bar.step'))
  const back = importStep(join(dir, 'bar.step')) as Part
  approx(volume(back), 40000, 1e-7)
})

test('errors', () => {
  raises(() => Box(1, 1, 1).twist(0), RangeError, /angle is 0/)
  raises(() => Box(10, 10, 10).twist(90, { start: 20, end: 30 }), ModelingError, /does not reach/)
  raises(() => Box(10, 10, 10).taper(0), RangeError, /positive/)
  raises(() => Box(10, 10, 10).twist(90, { tolerance: 0 }), RangeError, /tolerance/)
  raises(() => twist(Z as never, 90), TypeError)
})

// -- what Python's MCP session test models (the session and the guide search are Python's) ----
test('a twisted bar, a lattice on it and a refused bend', () => {
  const bar = Box(20, 20, 100).twist(90)
  assert.equal(Math.round(bar.massProperties(1, 1e-10).volume * 1000) / 1000, 40000.0)
  const lat = new Lattice(bar, 3)
  lat.move([1, 1, -1], [0, 0, 5])
  const pillow = lat.apply(bar)
  assert.ok(pillow.isValid())
  raises(() => bar.bend(90, { radius: 1 }), ModelingError, /larger radius/)
})

test('lattice selections are [i, j, k], with null for all layers', () => {
  const lat = new Lattice(Box(10, 20, 30), 3)
  assert.deepEqual(lat.layer(Y, 0), [null, 0, null])
  assert.deepEqual(lat.layer('x', -1), [-1, null, null])
  raises(() => lat.layer(new Axis([0, 0, 0], [1, 1, 0]), 0), RangeError, /axis must be X, Y or Z/)
  raises(() => lat.layer(Z, 3), RangeError, /out of range for 3 layers/)
})
