// tests/test_guards.py: features refuse broken input and do not return broken bodies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  Align,
  Axis,
  Box,
  CenterArc,
  Circle,
  Cone,
  Cylinder,
  GridLocations,
  Helix,
  Hole,
  KernelError,
  Line,
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
import { ext, k } from '../src/kernel.ts'
import { setGuardSeconds } from '../src/defeature.ts'
import { _intersectionProblem, _offsetProblem } from '../src/shapes.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: test helpers
type Any = any

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

test('shell walls are measured across the part', () => {
  // The check measured the walls along the world axes only: the plate turned by 10 or 45 degrees got
  // two 6 mm walls in its 10 mm (valid, 10992.0), and 10 mm walls gave the plate back (10 faces). A
  // closed shell is checked on its result: where the walls meet, there is no cavity.
  for (const angle of [10, 45]) {
    const plate = Box(40, 30, 10).rotate(X, angle)
    for (const t of [6, 10]) throwsMatching(() => plate.shell(t), ModelingError, /do not fit|it built a body with a cavity where its walls meet/)
    approx(plate.shell(4.9).volume, 40 * 30 * 10 - 30.2 * 20.2 * 0.2)
  }
  const plate = Box(40, 30, 10).rotate(X, 45)
  throwsMatching(
    () => plate.shell(10, plate.faces().sortBy(new Axis([0, 0, 0], [0, -1, 1])).at(-1)),
    ModelingError,
    /a wall of 10 does not fit into the part, which is 10 deep from the face/,
  )
  // an L-shaped body whose leg is thinner than two walls (the kernel crashed in 1 run of 4)
  const body = Box(6, 20, 12).fuse(Box(4, 10, 6).translate(1, -5, -6))
  throwsMatching(
    () => body.shell(2.94, body.faces().filter((f) => Math.abs(f.center().z + 9) < 1e-6)),
    ModelingError,
    /two walls of 2.94 do not fit into the part, which is 4 thick across/,
  )
  // a plate with a hole: shell(4) gave the plate back (3717.2567, 7 faces, valid)
  const holed = Box(20, 20, 10).cut(Cylinder(3, 20))
  throwsMatching(() => holed.shell(4), ModelingError, /shell: the kernel could not build a valid result/)
  approx(holed.shell(3).volume, 3385.646, 1e-6)
})

/** Runs fn with kernel functions replaced (and the probe worker off, so that they run here). */
function patched(replace: Record<string, unknown>, fn: () => void): void {
  const kernel = k as Any
  const saved = Object.fromEntries(Object.keys(replace).map((name) => [name, kernel[name]]))
  const guard = setGuardSeconds(0)
  Object.assign(kernel, replace)
  try {
    fn()
  } finally {
    Object.assign(kernel, saved)
    setGuardSeconds(guard)
  }
}

test('shell and offset results are checked', () => {
  const box = Box(40, 30, 20)
  const shellBrep = k.shell_brep
  // the kernel giving the part back unchanged (it did, for walls that left no cavity)
  patched({ shell_brep: (brep: number) => k.brep_copy(brep) }, () => {
    throwsMatching(() => box.shell(2, box.faces().top()), ModelingError, /it built a body whose volume did not go down/)
  })
  // ... or with a corner cut off: less volume, but no cavity
  const notch = Box(2, 2, 2).translate(19, 14, 9)
  patched({ shell_brep: (brep: number) => Part._wrap(k.brep_copy(brep)).cut(notch)._copyBrep() }, () => {
    throwsMatching(() => box.shell(2, box.faces().top()), ModelingError, /it built a body without its cavity: \(.*\), which no wall reaches/)
  })
  // ... or walls of another thickness, closed: not the part less its offset
  patched({ shell_brep: (brep: number, d: number, options: Any) => shellBrep(brep, d / 2, options) }, () => {
    throwsMatching(() => box.shell(2), ModelingError, /of volume 4848, where the part less its offset by -2 has 9024/)
  })
  // faces that do not meet: refused from 1e-3 of the volume (isValid() from 1e-2)
  const result = Box(40, 30, 19)
  result._props(1e-4).gaps = 2e-3
  assert.ok(_offsetProblem(result, box.bbox(), 1e-6, 24000, true)!.startsWith('a body whose faces do not meet, so that its volume is uncertain by 2.0e-03'))
  // offset(0) is an equal copy, without the kernel
  patched({ offset_brep: null }, () => {
    const copy = box.offset(0)
    approx(copy.volume, 24000)
    assert.notEqual(copy._brep, box._brep)
  })
})

test('shell and offset do not repeat what fails', () => {
  // Shell tried the kernel eight times (twice in its plain mode, six times in its extended mode) and
  // offset eight times; over 420 runs on imported parts no repeat helped, and a failure cost up to
  // 176 s. Now: the plain mode once, the extended mode once, and once more only after a result that
  // was refused; offset once, and once more after a refused result.
  const calls: boolean[] = []
  const failing = (_brep: number, _d: number, options: Any = {}) => {
    calls.push(options.extended_offset ?? true)
    throw new Error('SmApiShellBrepFull failed: SM_ERR (1001)')
  }
  const unchanged = (brep: number, _d: number, options: Any = {}) => {
    calls.push(options.extended_offset ?? true)
    return k.brep_copy(brep)
  }
  const box = Box(40, 30, 20)
  for (const [kernel, expect] of [
    [failing, [false, true]],
    [unchanged, [false, true, true]],
  ] as const) {
    calls.length = 0
    patched({ shell_brep: kernel }, () => assert.throws(() => box.shell(2, box.faces().top()), ModelingError))
    assert.deepEqual(calls, expect)
  }
  for (const [kernel, expect] of [
    [failing, [true]],
    [unchanged, [true, true]],
  ] as const) {
    calls.length = 0
    patched({ offset_brep: kernel }, () => assert.throws(() => box.offset(1), ModelingError))
    assert.deepEqual(calls, expect)
  }
})

test('offsets that read freed kernel memory fail', () => {
  // The kernel's offset code read memory it had freed (natively the process died now and then; the
  // module trapped for the fused cone offset by 6 and the shell of two cones): GlueCoincidentBrepVertices
  // glued a Vertex it had deleted, a ProtoEdge it deleted stayed in the lists of other ProtoFaces, and an
  // extended surface was handed out after it was deleted. The kernel steps themselves, in their extended
  // mode, in a process of their own, so that a trap does not leave this one's kernel damaged.
  const src = new URL('../src/', import.meta.url).href
  const code = `
    import { Box, Cone, Cylinder, Y } from '${src}index.ts'
    import { k } from '${src}kernel.ts'
    const lbox = Box(6, 20, 12).fuse(Box(4, 10, 6).translate(1, -5, -6))
    const foot = lbox.faces().filter((f) => Math.abs(f.center().z + 9) < 1e-6).map((f) => f._f)
    const cone = Cone(6, 0, 8).rotate(Y, 90).fuse(Cylinder(4, 12).translate(-6.7843, 0, 0))
    const cones = Cone(3, 4, 6).rotate(Y, 90).fuse(Cone(6, 2, 16).translate(-2, 2.5147, -4))
    const end = [[...cones.faces()].sort((a, b) => Math.abs(a.center().x - 3) - Math.abs(b.center().x - 3))[0]._f]
    const steps = [() => k.shell_brep(lbox._brep, -2.94, { extended_offset: true, faces_to_shell: foot }),
      () => k.offset_brep(cone._brep, 6), () => k.shell_brep(cones._brep, -2.4, { extended_offset: true, faces_to_shell: end })]
    const out = []
    for (let i = 0; i < 8; i++) {
      for (const step of steps) {
        try {
          step()
          out.push('ok')
        } catch (e) {
          out.push(e instanceof WebAssembly.RuntimeError ? 'crashed' : 'failed')
        }
      }
    }
    console.log(out.join(' '))
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 300_000 })
  assert.equal(run.status, 0, run.stderr)
  const out = run.stdout.trim().split(' ')
  assert.equal(out.length, 24)
  assert.ok(!out.includes('crashed'), out.join(' '))
})

test('shell, offset and thicken run the kernel in the probe worker', () => {
  // They ran the kernel's offset code in this kernel, where its traps could leave the memory damaged:
  // now in the probe worker (a kernel of its own; smlibpy: a forked copy of its process), whose body
  // comes back as an exact (.smb) copy.
  const box = Box(20, 20, 20)
  const kernel = k as Any
  const saved = [kernel.offset_brep, kernel.shell_brep]
  kernel.offset_brep = kernel.shell_brep = () => {
    throw new Error('not in this kernel')
  }
  try {
    const shelled = box.shell(2, box.faces().top())
    assert.ok(shelled.isValid())
    approx(shelled.volume, 8000 - 16 * 16 * 18)
    approx(box.offset(2).volume, 24 ** 3)
    approx(Rectangle(10, 10).thicken(1).volume, 100)
    // an error there is thrown here
    throwsMatching(() => Box(40, 40, 10).cut(Cylinder(5, 20)).offset(5), KernelError, /offset failed \(SM_ERR/)
  } finally {
    ;[kernel.offset_brep, kernel.shell_brep] = saved
  }
  // a step that does not finish is dropped after GUARD_SECONDS
  const plate = Box(200, 200, 5).cut(GridLocations(8, 8, 20, 20).mul(Cylinder(2, 20)))
  const guard = setGuardSeconds(1)
  try {
    const start = Date.now()
    throwsMatching(() => plate.offset(-0.5), ModelingError, /offset: the kernel did not finish within 1 s/)
    assert.ok(Date.now() - start < 10_000)
  } finally {
    setGuardSeconds(guard)
  }
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

test('rounds that crashed the kernel throw', () => {
  // In a process of its own, so that a trap does not leave this one's kernel damaged.
  // A chamfer of edges at different angles (a hexagonal prism: 90 and 120 degrees) bevelled one
  // edge per kernel call, with edges taken before the first call replaced it (natively the process
  // died). The two halves of a box edge that a cone touches tangentially: the kernel has no corner
  // for where they meet, went on, and called corner methods on what it held in the corner's place
  // (the module trapped at any radius). The same for all edges of upstream's revolution_mold.smb,
  // where the submodule's test files are checked out.
  const src = new URL('../src/', import.meta.url).href
  const mold = new URL('../../third_party/usd-brep/TestFiles/pt_TestFiles/Solids/revolution_mold.smb', import.meta.url).pathname
  const withMold = existsSync(mold)
  const code = `
    import { Box, Cone, RegularPolygon, load } from '${src}index.ts'
    let p = RegularPolygon(10, 6).extrude(10)
    const out = [String(p.chamfer(p.edges(), 1).faces().length)]
    p = Box(10, 5, 20).cut(Cone(4, 5, 20))
    const halves = p.edges().filter((e) => Math.abs(e.center().x - 5) < 1e-6 && Math.abs(e.center().z - 10) < 1e-6)
    const makes = [() => p.fillet(halves, 0.1), () => p.fillet(halves, 0.02)]
    if (${withMold}) {
      const mold = load(${JSON.stringify(mold)})
      makes.push(() => mold.fillet(mold.edges(), 0.2))
    }
    for (const make of makes) {
      try {
        make()
        out.push('ok')
      } catch (e) {
        out.push(/crashed/.test(e.message + (e.detail ?? '')) ? 'crashed' : e.status)
      }
    }
    console.log(out.join(' '))
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 300_000 })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.stdout.trim().split(' '), ['38', ...Array(withMold ? 3 : 2).fill('SM_ERR_INVALID_INPUT')])
  const p = RegularPolygon(10, 6).extrude(10)
  const hexagon = p.chamfer(p.edges(), 1)
  assert.ok(hexagon.isValid())
  approx(hexagon.volume, 2516.827500047, 1e-9) // OpenCASCADE
  // the setbacks: 1 along both faces, 0.5 and 0.7071 from the old edges at 120 and 90 degrees
  assert.deepEqual([...new Set(p.edges().map((e) => Math.round(hexagon.distanceTo(e.center()) * 1e9) / 1e9))].sort(), [0.5, 0.707106781])
  const cut = Box(10, 5, 20).cut(Cone(4, 5, 20))
  const halves = cut.edges().filter((e) => Math.abs(e.center().x - 5) < 1e-6 && Math.abs(e.center().z - 10) < 1e-6)
  throwsMatching(() => cut.fillet(halves, 0.1), KernelError, /cannot round the selection as given, at any size/)
})

test('a variable radius runs along each edge on its own', () => {
  const box = Box(40, 30, 20)
  const edge = box.edges().parallelTo(Z).at(0)!
  approx(box.volume - box.fillet(edge, { start: 2, end: 6 }).volume, 74.399926, 1e-6)
  for (const continuity of ['G1', 'G2', 'G3']) {
    // gave the ruled chamfer (173.3333 removed), not a blend
    throwsMatching(() => box.fillet(edge, { start: 2, end: 6 }, { continuity }), RangeError, /circular rounds only/)
  }
  // a constant one makes the blend, as the plain radius does
  const vertical = box.edges().parallelTo(Z)
  approx(box.fillet(vertical, { start: 2, end: 2 }, { continuity: 'G2' }).volume, box.fillet(vertical, 2, { continuity: 'G2' }).volume, 1e-9)
  // A closed edge: the radius rose to 2.9 and fell back to 1 at the seam.
  const cylinder = Cylinder(10, 20)
  const rim = cylinder.edges().circles().sortBy(Z).last
  throwsMatching(() => cylinder.fillet(rim, { start: 1, end: 3 }), RangeError, /closed edge/)
  approx(cylinder.fillet(rim, { start: 2, end: 2 }).volume, cylinder.fillet(rim, 2).volume, 1e-9)
  // Edges that run into each other tangentially: the kernel gave the rounds one radius where they
  // meet, so (1, 3) ran 2.46 -> 1.04 along one edge and 1.65 -> 1.99 -> 1.07 along the arcs.
  let plate = Box(40, 30, 10)
  plate = plate.fillet(plate.edges().parallelTo(Z).filter((e) => e.center().x > 0), 5)
  const chain = plate.edges().filter((e) => e.center().z > 4.9 && e.center().x > -19.9)
  throwsMatching(() => plate.fillet(chain, { start: 1, end: 3 }), RangeError, /run into each other tangentially at \(15, 15, 5\)/)
  assert.ok(plate.fillet(chain, 2).isValid())
})

test('a chamfer needs one angle along its edge', () => {
  // A cylinder tilted by 30 degrees on a plate: the faces meet at 60 to 120 degrees along the
  // ellipse, and the bevel of length 1 reached 1 to 3 into the plate.
  const plate = Box(60, 60, 10, { align: [Align.CENTER, Align.CENTER, Align.MAX] })
  const above = Box(60, 60, 30, { align: [Align.CENTER, Align.CENTER, Align.MIN] })
  const tilted = plate.fuse(Cylinder(5, 60).rotate(Y, 30).intersect(above))
  const foot = tilted.edges().filter((e) => Math.abs(e.center().z) < 1e-6 && e.geomType === 'ellipse')
  throwsMatching(() => tilted.chamfer(foot, 1), ModelingError, /60 to 120 degrees apart.*reach 1 to 3 from the edge instead of 1/)
  const upright = plate.fuse(Cylinder(5, 60).intersect(above))
  const ring = upright.edges().filter((e) => Math.abs(e.center().z) < 1e-6 && e.geomType === 'circle')
  const bevel = upright.chamfer(ring, 1) // a concave ring: adds the triangle 1 x 1 / 2 around radius 5 1/3
  assert.ok(bevel.isValid())
  approx(bevel.volume - upright.volume, PI * 2 * (5 + 1 / 3) * 0.5, 1e-3)
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
  // A body given back unchanged is classified against the other operand: a box whose corners lie
  // outside a sphere, though inside its box.
  const sphere = Sphere(10)
  const cube = Box(14, 14, 14)
  assert.notEqual(_intersectionProblem(Part._wrap(cube._copyBrep()), [cube, sphere]), null)
  // A split keeps the part's face count and loose box, but not its vertices: not classified.
  let classified = 0
  const classify = Part.prototype._classify
  Part.prototype._classify = function (this: Part, ...args: Any[]) {
    classified++
    return classify.apply(this, args as Any)
  }
  try {
    const coil = sweep(Circle(1.2), Helix(6, 48, 10)) as Part
    const kept = coil.split(Plane.XY.offset(1.2))
    approx(kept.volume, coil.volume - coil.cut(kept).volume)
    assert.equal(classified, 0)
  } finally {
    Part.prototype._classify = classify
  }
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

test('chains of Booleans integrate nothing', () => {
  // A Boolean of sound operands is trusted by the next Boolean; isValid() integrates when asked. When
  // each result was integrated (with its gaps) as the next operand, 100 cuts took 5 times as long.
  let measured = 0
  const measure = ext.brep_measure
  ext.brep_measure = (...args: Any[]) => {
    measured++
    return measure(...args)
  }
  try {
    let p = Box(200, 200, 10)
    for (let i = 0; i < 60; i++) p = p.cut(Cylinder(2, 20).translate(-90 + 20 * (i % 10), -90 + 20 * Math.floor(i / 10), 0))
    p = p.fuse(Box(10, 10, 10).translate(0, 0, 10))
    assert.equal(measured, 0)
    assert.ok(p.isValid())
    assert.equal(measured, 1)
    approx(p.volume, 200 * 200 * 10 - 60 * PI * 4 * 10 + 1000, 1e-9)
    assert.equal(measured, 2)
  } finally {
    ext.brep_measure = measure
  }
})

const seamHoles: [string, () => Part, number][] = [
  ['groove pin', () => Box(30, 30, 30).cut(Cylinder(5, 60)).cut(Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)), 24299.258668],
  ['cross holes', () => Box(20, 20, 20).cut(Cylinder(3, 40).rotate(Z, 90).translate(0, 3, 0)).cut(Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)), 6931.747603],
]
for (const [name, cut, exact] of seamHoles) {
  // kernel plan B6: a primitive's seam line in a tangent plane of the other operand (24364.1472 and
  // 6994.4685 here, both valid). Expected to be wrong, as Python's strict xfail: once it is right,
  // this fails, to be turned into a test of the right volume.
  test(`holes tangent to a seam: ${name} (still wrong)`, () => {
    const volume = cut().volume
    assert.ok(Math.abs(volume - exact) > 1e-7 * exact, `${volume}: kernel plan B6 is fixed; test for ${exact} here`)
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

test('Booleans that read freed kernel memory throw', () => {
  // Each of these read freed memory in the kernel (natively the process died). Crossing holes whose
  // seams lie tangent to the other hole: SplitIntersectingProtoEdges split a ProtoEdge it had just
  // deleted. A flat end cap tangent to a sphere: the Boolean deleted a Shell that Faces still used,
  // and the module trapped. The extended shell of a rotated box: BooleanPostProcess read a deleted
  // Vertex, natively in about one call of a hundred; the kernel's shell itself, 100 times (shell()
  // measures the walls first and runs the kernel in the probe worker, so it would not reach or show
  // this). In a process of its own, so that a trap does not leave this one's kernel damaged.
  const src = new URL('../src/', import.meta.url).href
  const code = `
    import { Axis, Box, Cylinder, Part, Sphere, X, Y } from '${src}index.ts'
    import { k } from '${src}kernel.ts'
    const h1 = Cylinder(3, 40).translate(0, 3, 0)
    const cases = []
    for (const z of [3, 3.1]) {
      const h2 = Cylinder(3, 40).rotate(Y, 90).translate(0, 0, z)
      cases.push(() => Box(20, 20, 20).cut(h1).cut(h2), () => Box(20, 20, 20).cut([h1, h2]), () => h1.fuse(h2),
        () => h1.intersect(h2), () => h1.merge(h2))
    }
    cases.push(() => Sphere(1.5).rotate(Y, 90).cut(Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)))
    const box = Box(40, 30, 10).rotate(X, 45)
    const opening = box.faces().sortBy(new Axis([0, 0, 0], [0, -1, 1])).at(-1)
    for (let i = 0; i < 100; i++) {
      cases.push(() => Part._wrap(k.shell_brep(box._brep, -10, { extended_offset: true, faces_to_shell: [opening._f] })))
    }
    const out = cases.map((c) => {
      try {
        const r = c()
        return r.isValid() ? 'ok:' + r.volume.toFixed(3) : 'ok'
      } catch (e) {
        return /crashed/.test(e.message + (e.detail ?? '')) || e instanceof WebAssembly.RuntimeError ? 'crashed' : e.constructor.name
      }
    })
    console.log(out.join(' '))
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 300_000 })
  assert.equal(run.status, 0, run.stderr)
  const out = run.stdout.trim().split(' ')
  // The intersection of the crossing holes is right here (OpenCASCADE: 62.7209), where smlibpy's
  // native kernel raises KernelError (SM_ERR_BAD_INTERSECTIONS): the two builds take different paths
  // through the curve intersector there. The others raise plain SM_ERR here.
  const holes = ['KernelError', 'KernelError', 'KernelError', 'ok:62.721', 'KernelError']
  assert.deepEqual(out.slice(0, 11), [...holes, ...holes, 'KernelError']) // the end cap, the last, trapped
  assert.equal(out.length, 111)
  assert.ok(!out.includes('crashed'), out.join(' '))
  approx(Sphere(1.5).rotate(Y, 90).intersect(Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)).volume, 14.137072, 1e-6)
})

test('a merge that loses volume throws', () => {
  // A sphere whose seam lies tangent to the cylinder: the kernel's merge came out smaller than the
  // cut cylinder (518.314 against 566.559; right: 586.443), and cells() of it crashed the process.
  const pin = Cylinder(2.5, 30).rotate(Y, 90).cut(Cone(2.5, 6, 6).rotate(Y, 90).translate(15, 0.6687, -3.5))
  throwsMatching(() => pin.merge(Sphere(2).rotate(X, 90).translate(0, -0.5, 2.5)), ModelingError, /less than that of the largest part/)
  const right = pin.merge(Sphere(2).translate(0, -0.5, 2.5)) // the sphere not turned
  approx(right.volume, 586.443229, 1e-6) // OpenCASCADE
  approx(right.cells().reduce((sum, c) => sum + c.volume, 0), 586.443229, 1e-6)
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
  // nearly parallel faces: closest points in turn settled slowly and stopped too far apart
  ['cylinders crossing at 1 degree', () => [Cylinder(5, 200), Cylinder(5, 200).rotate(X, 1).translate(12, 0, 0)], 2.0], // was 2.1197
  ['cylinders crossing at 5 degrees', () => [Cylinder(5, 200), Cylinder(5, 200).rotate(X, 5).translate(12, 0, 0)], 2.0], // was 2.4853
  ['cylinders crossing at 10 degrees', () => [Cylinder(5, 200), Cylinder(5, 200).rotate(X, 10).translate(12, 0, 0)], 2.0], // was 2.0162
]
for (const [name, make, expected] of distances) {
  test(`distance between bodies: ${name}`, () => {
    const [a, b] = make()
    approx(a.distanceTo(b), expected, 1e-9, 1e-9)
    approx(b.distanceTo(a), expected, 1e-9, 1e-9)
  })
}

test('distanceTo takes points, bodies and curves', () => {
  // (edges, wires and faces threw a TypeError before 0.5.0)
  const box = Box(1, 1, 1)
  assert.equal(box.distanceTo(box.edges()[0]), 0)
  approx(box.distanceTo(Line([3, -5, 0], [3, 5, 0])), 2.5)
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
