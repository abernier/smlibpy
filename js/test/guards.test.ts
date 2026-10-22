// tests/test_guards.py: features refuse broken input and do not return broken bodies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  Align,
  Box,
  CenterArc,
  Circle,
  Cylinder,
  Hole,
  KernelError,
  Location,
  Locations,
  ModelingError,
  Part,
  Plane,
  Polyline,
  Rectangle,
  RegularPolygon,
  Sphere,
  Spline,
  Torus,
  X,
  Y,
  Z,
  extrude,
  loft,
  makeFace,
  setWarningHandler,
  surface,
  sweep,
} from '../src/index.ts'
import { k } from '../src/kernel.ts'
import { approx } from './_approx.ts'

const PI = Math.PI

/** The kernel's union without smlibwasm's checks (an invalid body for tangent operands). */
function rawUnion(a: Part, b: Part): Part {
  return Part._wrap(k.boolean(a._copyBrep(), b._copyBrep(), { operation: k.BooleanOp.UNION }))
}

/** Runs fn and gives back the warnings it made. */
function warnings<T>(fn: () => T): [T, string[]] {
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    return [fn(), said]
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
}

const throwsMatching = (fn: () => unknown, type: new (...a: never[]) => Error, pattern: RegExp) =>
  assert.throws(fn, (e: Error) => e instanceof type && pattern.test(e.message))

// -- validity -------------------------------------------------------------------------------
test('isValid needs a positive volume', () => {
  // a profile across the axis, revolved by the kernel directly: a "manifold" body of volume 0
  const curves = Rectangle(10, 10).on(Plane.front).faces()[0].outerWire()._copyCurves()
  const insideOut = Part._wrap(k.rotational_sweep(curves, [0, 0, 0], [0, 0, 1], 360, { cap_ends: true }))
  const [volume, said] = warnings(() => insideOut.volume)
  assert.ok(said.some((m) => /do not meet exactly/.test(m))) // its faces overlap: no volume to speak of
  assert.ok(k.brep_is_manifold_solid(insideOut._brep) && volume <= 1e-6)
  assert.ok(!insideOut.isValid())
  assert.ok(Box(1, 2, 3).isValid() && Box(10, 10, 10).cut(Sphere(3)).isValid())
})

test('scale by zero is refused and a flat body is not valid', () => {
  for (const factor of [0, [1, 0, 1], Number.NaN] as (number | number[])[]) throwsMatching(() => Box(10, 10, 10).scale(factor), RangeError, /not zero/)
  const m = new Float64Array(16)
  m[15] = 1
  const flat = Box(10, 10, 10)._transformed(m) as Part // what scale(0) returned
  assert.ok(!flat.isValid()) // its bounding box is NaN; it reported valid
  assert.ok(Box(10, 10, 10).scale(-1).isValid() && Box(10, 10, 10).scale([2, 1, 1]).isValid())
})

const features: [string, (p: Part) => unknown][] = [
  ['fillet', (p) => p.fillet(p.edges().circles(), 0.5)],
  ['chamfer', (p) => p.chamfer(p.edges().circles(), 0.5)],
  ['shell', (p) => p.shell(1)],
  ['offset', (p) => p.offset(1)],
]
for (const [name, feature] of features) {
  test(`${name} refuses an invalid part`, () => {
    const tangent = rawUnion(Cylinder(5, 20), Cylinder(5, 20).translate(10, 0, 0)) // crashed the fillet
    assert.ok(!tangent.isValid())
    throwsMatching(() => feature(tangent), ModelingError, /not a valid solid/)
  })
}

// -- shell ----------------------------------------------------------------------------------
test('shell walls that do not fit are refused', () => {
  const box = Box(40, 30, 10)
  throwsMatching(() => box.shell(10, box.faces().top()), ModelingError, /does not fit/) // crashed the process now and then
  for (const t of [5, 6, 10]) throwsMatching(() => box.shell(t), ModelingError, /do not fit/) // 6 returned a "valid" body of volume 10992
  approx(box.shell(6, box.faces().top()).volume, 40 * 30 * 10 - 28 * 18 * 4)
  approx(box.shell(4).volume, 40 * 30 * 10 - 32 * 22 * 2)
  approx(box.shell(10, box.faces().top().concat(box.faces().bottom())).volume, 40 * 30 * 10 - 20 * 10 * 10)
})

// -- fillet and chamfer ---------------------------------------------------------------------
function roundedCube(s: number, r: number): number {
  const a = s - 2 * r
  return a ** 3 + 6 * a * a * r + 3 * PI * a * r * r + (4 / 3) * PI * r ** 3
}

test('a fillet close to the limit is refused', () => {
  const cube = Box(10, 10, 10)
  // the kernel's result differs between builds: a valid-looking body with regions missing (caught
  // by the volume bound) or a broken one (caught by the validity check)
  throwsMatching(() => cube.fillet(cube.edges(), 4.99), ModelingError, /too close to the largest|too large/) // returned volume 11.19 instead of 525.17
  for (const r of [4, 4.97]) {
    const p = cube.fillet(cube.edges(), r)
    assert.ok(p.isValid())
    approx(p.volume, roundedCube(10, r), 1e-6)
  }
  assert.throws(() => Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 9.98), ModelingError)
})

test('round sizes must be positive', () => {
  const cube = Box(10, 10, 10)
  throwsMatching(() => cube.fillet(cube.edges(), 0), RangeError, /positive/)
  throwsMatching(() => cube.chamfer(cube.edges(), -1), RangeError, /positive/)
})

test('rounds on circular edges pass the volume check', () => {
  const plate = Box(60, 40, 10).cut(Cylinder(5, 20))
  assert.ok(plate.fillet(plate.edges().circles(), 4.9).isValid())
  const boss = Box(40, 40, 10).fuse(Cylinder(5, 20).translate(0, 0, 10))
  assert.ok(boss.fillet(boss.edges().circles().sortBy(Z).slice(0, 1), 3).volume > boss.volume)
})

test('rounds that run on past their edge pass the volume check', () => {
  // The kernel extends a round past an end where the edge runs on into one that is not rounded
  // (tangentially, or at a kink); these were refused as "wrong bodies".
  let p = Box(80, 50, 10).fuse(Box(10, 50, 60).translate(-35, 0, 35))
  p = p.cut(Cylinder(6, 100).rotate(Y, 90).translate(0, 0, 45))
  p = p.fillet(p.edges().filterBy(Y), 2)
  const groups = p.edges().groupBy(Z)
  const bracket = p.chamfer(groups[groups.length - 1], 1) // into the arcs of the rounds below
  assert.ok(bracket.isValid())
  approx(bracket.volume, 68689.3316, 1e-6)
  let b = Box(40, 20, 10)
  b = b.fillet(b.edges().filterBy(Z), 4)
  const top = b.edges().groupBy(Z)
  const block = b.fillet(top[top.length - 1].lines().sortBy(X).last, 1) // into the corner arcs
  assert.ok(block.isValid())
  approx(block.volume, 7859.5722, 1e-6)
  const prism = RegularPolygon(20, 24).extrude(10)
  const ptop = prism.edges().groupBy(Z)
  const kinked = prism.fillet(ptop[ptop.length - 1].sortBy(X).last, 1) // 15 degree kinks
  assert.ok(kinked.isValid())
  approx(kinked.volume, 12421.835947, 1e-6)
})

// -- revolve --------------------------------------------------------------------------------
const crossing: [string, () => Part][] = [
  ['full turn', () => Rectangle(10, 20).on(Plane.front).revolve(Z)],
  ['quarter turn', () => Rectangle(10, 20).on(Plane.front).revolve(Z, 90)],
  ['default axis', () => Rectangle(10, 20).revolve()],
  ['default axis of a face', () => makeFace(Polyline([10, 0], [20, 0], [20, 20], [10, 20], { close: true })).revolve()],
]
for (const [name, make] of crossing) {
  test(`revolve refuses an axis through the region (${name})`, () => {
    throwsMatching(make, ModelingError, /axis crosses the region/)
  })
}

test('the error of the default revolve axis names the axis', () => {
  throwsMatching(() => makeFace(Polyline([10, 0], [20, 0], [20, 20], [10, 20], { close: true })).revolve(), ModelingError, /plane origin \(15, 10, 0\)/)
})

test('revolve angles and axes', () => {
  const ring = Rectangle(10, 10).translate(15, 0).on(Plane.front)
  const quarter = (PI * (20 ** 2 - 10 ** 2) * 10) / 4
  const plus = ring.revolve(Z, 90)
  const minus = ring.revolve(Z, -90)
  approx(plus.volume, quarter)
  approx(minus.volume, quarter)
  approx(plus.bbox().min.y, 0, 1e-6, 1e-9)
  approx(minus.bbox().max.y, 0, 1e-6, 1e-9)
  throwsMatching(() => ring.revolve(Z, 0), RangeError, /zero/)
  throwsMatching(() => Circle(3).translate(10, 0).revolve(Z), RangeError, /in the sketch plane/) // axis along the sketch normal
  const touching = Rectangle(10, 20, { align: [Align.MIN, Align.CENTER] }).on(Plane.front).revolve(Z)
  approx(touching.volume, PI * 100 * 20)
})

// -- sweep, loft, extrude, thicken ----------------------------------------------------------
test('sweep along a closed single-edge path', () => {
  const torus = sweep(Circle(2), CenterArc([0, 0], 20, 0, 360)) as Part // was inside out, volume -1579
  assert.ok(torus.isValid() && torus.solids().length === 1)
  approx(torus.volume, 2 * PI * 20 * PI * 4, 1e-4)
  const ring = sweep(Circle(2), Spline([20, 0], [0, 20], [-20, 0], [0, -20], { closed: true })) as Part // was volume 0
  assert.ok(ring.isValid() && ring.volume > 1000)
})

test('a tapered extrusion keeps its holes', () => {
  const ring = Circle(10).cut(Circle(5)).extrude(10, { taper: 5 })
  const t = Math.tan((5 * PI) / 180) * 10
  const frustum = (r0: number, r1: number) => ((PI * 10) / 3) * (r0 * r0 + r0 * r1 + r1 * r1)
  approx(ring.volume, frustum(10, 10 - t) - frustum(5, 5 + t), 1e-4)
  throwsMatching(() => Rectangle(20, 20).extrude(10, { taper: 56 }), ModelingError, /closes the profile/)
  assert.throws(() => Rectangle(20, 20).extrude(10, { taper: 90 }), RangeError)
})

test('loft sections with holes', () => {
  const tube = loft([Circle(10).cut(Circle(5)), Circle(8).cut(Circle(3)).translate(0, 0, 20)]) as Part
  const frustum = (r0: number, r1: number) => ((PI * 20) / 3) * (r0 * r0 + r0 * r1 + r1 * r1)
  assert.ok(tube.isValid())
  approx(tube.volume, frustum(10, 8) - frustum(5, 3), 1e-4)
  throwsMatching(() => loft([Circle(10).cut(Circle(5)), Circle(10).translate(0, 0, 20)]), RangeError, /same number of holes/)
})

test('thicken refuses broken results', () => {
  const ring = (z: number) => Array.from({ length: 25 }, (_, i) => [10 * Math.cos((2 * PI * i) / 24), 10 * Math.sin((2 * PI * i) / 24), z])
  throwsMatching(() => surface([0, 10, 20, 30].map(ring)).thicken(-1), ModelingError, /thicken/) // was volume 0, "valid"
  throwsMatching(() => (extrude(CenterArc([0, 0], 10, 0, 180), 20) as never as Part & { thicken(t: number): Part }).thicken(-12), ModelingError, /thicken/)
})

test('thicken both sides', () => {
  const slab = Rectangle(20, 10).thicken(2, { both: true })
  approx(slab.volume, 400)
  approx(slab.bbox().min.z, -1)
  approx(slab.bbox().max.z, 1)
  const wall = (extrude(CenterArc([0, 0], 10, 0, 180), 20) as never as { thicken(t: number, o: object): Part }).thicken(2, { both: true })
  approx(wall.volume, ((PI * (11 ** 2 - 9 ** 2)) / 2) * 20, 1e-6)
})

// -- Booleans -------------------------------------------------------------------------------
test('overlapping parallel holes in one cut', () => {
  const part = Box(60, 40, 10)
  const holes = new Locations([0, 0], [5, 0]).mul(Hole(4, 12)).on(part.faces().top()) // was an empty part
  const lens = 2 * 16 * Math.acos(5 / 8) - 2.5 * Math.sqrt(64 - 25)
  const result = part.cut(holes)
  assert.ok(result.isValid())
  approx(result.volume, 24000 - 10 * (32 * PI - lens), 1e-6)
  const plate = Box(40, 40, 10).cut([Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0)])
  assert.ok(plate.isValid())
})

test('Boolean errors say what to do', () => {
  throwsMatching(() => Box(40, 40, 10).cut(Cylinder(6, 30)).cut(Cylinder(3, 30).translate(8, 0, 0)), KernelError, /combine the tools first/)
  throwsMatching(() => Cylinder(5, 20).fuse(Cylinder(5, 20).translate(10, 0, 0)), ModelingError, /touch only along an edge/) // returned an invalid part
  throwsMatching(() => Box(10, 10, 10).fuse(rawUnion(Cylinder(5, 20), Cylinder(5, 20).translate(10, 0, 0))), ModelingError, /a tool is not a valid solid/)
})

test('Boolean operand types', () => {
  const plate = Box(60, 40, 10)
  throwsMatching(() => plate.cut(Circle(3).on(plate.faces().top()) as never), TypeError, /extrude it first/)
  for (const bad of ['x', 5, plate.edges()[0], plate.vertices()[0]]) assert.throws(() => plate.cut(bad as never), TypeError)
})

test('empty Boolean results where they are right', () => {
  assert.equal(Box(10, 10, 10).cut(Box(20, 20, 20)).faces().length, 0)
  assert.equal(Box(10, 10, 10).cut(Box(10, 10, 10)).faces().length, 0)
  assert.equal(Box(10, 10, 10).intersect(Box(10, 10, 10).translate(30, 0, 0)).faces().length, 0)
  assert.equal(Sphere(5).cut([Box(10, 10, 5).translate(0, 0, 2.5), Box(10, 10, 5).translate(0, 0, -2.5)]).faces().length, 0)
})

test('an empty cut needs tools that can cover the part', () => {
  // A tool beside an earlier hole in a sphere: the kernel's cut is empty, and its intersection of the
  // same pair, which confirmed the empty cut, is the whole part. Both were accepted.
  const holed = Sphere(20).cut(Cylinder(6, 60))
  throwsMatching(() => holed.cut(Cylinder(3, 60).translate(8, 0, 0)), ModelingError, /empty/) // was Part(0 faces), no error
  throwsMatching(() => holed.intersect(Cylinder(3, 60).translate(8, 0, 0)), ModelingError, /partly outside an operand/) // was the whole part, 29089.8 (right: 929.188)
  approx(Sphere(20).cut([Cylinder(6, 60), Cylinder(3, 60).translate(8, 0, 0)]).volume, 28160.608174, 1e-8)
})

test('an intersection may give an operand back when the other contains it', () => {
  const box = Box(10, 10, 10)
  approx(box.intersect(Box(20, 20, 20)).volume, 1000)
  approx(box.intersect(Box(10, 10, 20)).volume, 1000) // faces shared
  approx(Sphere(5).intersect(Box(20, 20, 20)).volume, (4 / 3) * PI * 125)
  approx(Box(30, 30, 30).intersect(Sphere(20)).volume, Sphere(20).intersect(Box(30, 30, 30)).volume)
})

test('Boolean results are checked when asked', () => {
  // Closed, manifold results of sound operands were marked valid unchecked. Two cylinders whose
  // lowest lines touch: the kernel's intersection leaves a face out (volume 250.206, more than its
  // operand's 150.796; its faces leave gaps of 0.25), and the difference has no volume.
  const a = Cylinder(2, 12)
  const b = Cylinder(1.5, 30).rotate(Y, 90).translate(1, -0.5, 2.4787)
  const common = Part._wrap(k.boolean(a._copyBrep(), b._copyBrep(), { operation: k.BooleanOp.INTERSECTION }))
  assert.ok(!common.isValid() && /open between its faces/.test(common._solidProblem()!))
  throwsMatching(() => common.fillet(common.edges(), 0.1), ModelingError, /not a valid solid/)
  const rest = a.cut(b)
  assert.ok(!rest.isValid() && rest._solidProblem() === 'without volume')
  throwsMatching(() => a.intersect(b), ModelingError, /partly outside an operand/) // reaches out of the first cylinder
  assert.ok(Box(20, 20, 20).cut(Cylinder(5, 30)).isValid())
})

const seamHoles: [string, () => Part, number][] = [
  ['groove pin', () => Box(30, 30, 30).cut(Cylinder(5, 60)).cut(Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)), 24299.258668],
  ['cross holes', () => Box(20, 20, 20).cut(Cylinder(3, 40).rotate(Z, 90).translate(0, 3, 0)).cut(Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)), 6931.747603],
]
for (const [name, cut, exact] of seamHoles) {
  // kernel plan B6: a primitive's seam line in a tangent plane of the other operand (24364.1472 and
  // 7057.1895 here, both valid)
  test(`holes tangent to a seam: ${name}`, { todo: 'kernel plan B6' }, () => {
    approx(cut().volume, exact, 1e-7)
  })
}

test('failed Booleans free their operands', () => {
  // The kernel keeps both operands when a Boolean fails; their copies were never freed: 0.4 MB per
  // failed cut. In a process of its own, so that what other tests left does not count.
  const src = new URL('../src/', import.meta.url).href
  const code = `
    import { Box, Cylinder, KernelError } from '${src}index.ts'
    const fail = () => {
      try {
        Box(40, 30, 20).cut(Cylinder(3, 40).translate([-5, 0, 0])).cut(Cylinder(3, 40))
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
      }
    }
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        globalThis.gc()
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    for (let i = 0; i < 10; i++) fail()
    await settle()
    const before = process.memoryUsage().rss
    for (let i = 0; i < 100; i++) {
      fail()
      if (i % 10 === 9) await settle()
    }
    await settle()
    console.log(Math.round((process.memoryUsage().rss - before) / 1048576))
  `
  const run = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 300_000 })
  assert.equal(run.status, 0, run.stderr)
  const grown = Number(run.stdout.trim())
  assert.ok(grown < 20, `100 failed cuts took ${grown} MB`) // was 43 MB
})

// -- moved bodies ---------------------------------------------------------------------------
test('moved bodies keep their tolerances', () => {
  // Moving a body reset its tolerances from the box of its vertices: a torus (one vertex) got 0, and
  // the Booleans of the moved torus went wrong.
  const groove = Cylinder(10, 40).cut(Torus(10, 1.5).translate(0, 0, 10))
  approx(groove.volume, 12358.441682, 1e-8) // was 12566.37: the groove was ignored
  const corner = Torus(8, 1.5).intersect(Box(4, 4, 4).translate(8, 0, 0)).volume
  approx(corner, 28.586308, 1e-6)
  const moves: ((p: Part) => Part)[] = [
    (p) => p.translate(0, 0, 5), // was 355.31, the whole torus
    (p) => p.rotate(Z, 30),
    (p) => p.mirror(Plane.YZ),
    (p) => p.scale(-1),
    (p) => p.moved(new Location([5, 6, 7], [10, 20, 30])),
  ]
  for (const move of moves) approx(move(Torus(8, 1.5)).intersect(move(Box(4, 4, 4).translate(8, 0, 0))).volume, corner, 1e-6)
  approx(Torus(8, 1.5).scale(2).intersect(Box(8, 8, 8).translate(16, 0, 0)).volume, 8 * corner, 1e-6)
  approx(Torus(8, 1.5).scale([1, 1, 2]).intersect(Box(4, 4, 8).translate(8, 0, 0)).volume, 2 * corner, 1e-6)
  // a part over 500 across went from tolerance 1e-5 to 1e-4: a step of 5e-5 was absorbed
  const step = Box(1000, 1000, 100).translate(1, 0, 0).fuse(Box(10, 10, 100.00005).translate(1, 0, 2.5e-5))
  assert.equal(step.faces().length, 11) // was 6
})

// -- distance -------------------------------------------------------------------------------
const distances: [string, () => [Part, Part], number][] = [
  ['parallel cylinders', () => [Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 0)], 12.0], // was 10.33
  ['cylinder and box', () => [Cylinder(5, 20), Box(10, 10, 30).translate(20, 0, 0)], 10.0], // was 7.22
  ['far from the origin', () => [Cylinder(5, 20).translate(1e5, 0, 0), Cylinder(3, 20).translate(1e5 + 20, 0, 0)], 12.0],
  ['spheres far from the origin', () => [Sphere(7).translate(1e5, 0, 0), Sphere(2).translate(1e5 + 10, 20, -5)], Math.sqrt(525) - 9], // was 15.56
  ['spheres', () => [Sphere(7), Sphere(2).translate(10, 20, -5)], Math.sqrt(525) - 9],
  ['crossed cylinders', () => [Cylinder(2, 40), Cylinder(3, 40).rotate(X, 90).translate(15, 0, 0)], 10.0],
  ['boxes', () => [Box(10, 10, 10), Box(10, 10, 10).translate(15, 12, 0)], Math.hypot(5, 2)],
  ['a pin in a hole', () => [Box(40, 40, 10).cut(Cylinder(6, 20)), Cylinder(5, 30)], 1.0],
  ['inside a tube', () => [Cylinder(10, 20).cut(Cylinder(8, 30)), Cylinder(3, 18).translate(2, 0, 0)], 3.0],
  ['nested boxes', () => [Box(10, 10, 10), Box(2, 2, 2)], 4.0],
  ['overlapping boxes', () => [Box(10, 10, 10), Box(10, 10, 10).translate(5, 0, 0)], 0.0],
  ['touching boxes', () => [Box(10, 10, 10), Box(10, 10, 10).translate(10, 0, 0)], 0.0],
  ['overlapping spheres', () => [Sphere(10), Sphere(10).translate(15, 3, 0)], 0.0],
]
for (const [name, make, expected] of distances) {
  test(`distance between bodies: ${name}`, () => {
    const [a, b] = make()
    approx(a.distanceTo(b), expected, 1e-9, 1e-9)
    approx(b.distanceTo(a), expected, 1e-9, 1e-9)
  })
}

test('distanceTo takes points and bodies', () => {
  throwsMatching(() => Box(1, 1, 1).distanceTo(Box(1, 1, 1).edges()[0]), TypeError, /point or a body/)
  approx(Box(2, 2, 2).distanceTo([5, 0, 0]), 4)
})

// -- mesh Booleans --------------------------------------------------------------------------
test('wrong mesh Booleans throw', () => {
  const box = Box(20, 20, 20).mesh()
  const sphere = Sphere(12).mesh()
  // (was an open mesh of volume 4377, exact 1616: the polygons with holes the kernel leaves were read
  // by their outer loops; now they are triangulated first)
  const corners = box.cut(sphere)
  assert.ok(corners.isClosed())
  approx(corners.volume, box.volume - box.intersect(sphere).volume)
  throwsMatching(() => box.fuse(Cylinder(3, 60).rotate(X, 30).rotate(Z, 20).mesh()), ModelingError, /exact parts/)
  const shifted = box.cut(Box(20, 20, 20).translate(10, 10, 10).mesh()) // no face gets a hole: right
  assert.ok(shifted.isClosed())
  approx(shifted.volume, 7000)
})
