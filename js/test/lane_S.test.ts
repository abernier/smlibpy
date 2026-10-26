// tests/test_lane_S.py: sweeps along closed 3D paths (S1 regressions), faces without area in fused
// sweeps, and planar paths with mitered corners (S2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Align, Axis, CenterArc, Circle, Edge, Ellipse, FilletPolyline, Helix, Line, Location, ModelingError, Plane, Polygon, Polyline, Rectangle, Spline, ThreePointArc, Vector, Wire, X, Z, exportStep, extrude, importStep, loft, revolve, sweep, type Part, type Shell } from '../src/index.ts'
import { ext, setWarningHandler } from '../src/kernel.ts'
import { AnnularSector, Cone, Cylinder, RoundedRectangle, Shell as ShellBody, Slot, Sphere, Torus, swing } from '../src/index.ts'
import { approx } from './_approx.ts'

type P3 = [number, number, number]
const PI = Math.PI

/** fn's result and the warnings it gave. */
function warned<T>(fn: () => T): [T, string[]] {
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    return [fn(), said]
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
}

function quiet(fn: () => Part): Part {
  const [out, said] = warned(fn)
  assert.deepEqual(said, [])
  return out
}

const shells = (part: Part): number[] =>
  (ext.brep_dump(part._brep, false).regions as { infinite: boolean; shells: number[] }[]).filter((r) => !r.infinite).map((r) => r.shells.length)

/** One solid of one shell, no face without area. */
function sound(part: Part): boolean {
  const size = part.bbox().diagonal
  return part.isValid() && shells(part).length === 1 && shells(part)[0] === 1 && [...part.faces()].every((f) => f.area > 1e-9 * size ** 2)
}

// Loops closed with a kink, Spline(...pts, pts[0]), with circles of radius 1.5 (random loops of the
// review's verifier)
const KINKED: Record<number, P3[]> = {
  7: [[17.944, 2.054, -4.26], [11.378, 11.536, -3.851], [0.783, 14.81, -2.957], [-13.078, 10.26, 0.004],
    [-18.112, 0.403, 4.051], [-14.403, -8.994, 6.065], [1.942, -14.738, 2.183], [12.841, -10.458, -1.977]],
  18: [[18.449, 1.62, 4.647], [13.143, 9.57, 5.996], [1.728, 13.479, 4.695], [-13.279, 9.47, 0.061],
    [-18.58, 0.21, -4.092], [-13.895, -8.989, -5.991], [0.142, -13.538, -4.296], [12.938, -9.717, -0.204]],
  27: [[18.562, -0.491, -5.32], [11.818, 14.456, -6.492], [-1.047, 18.712, 3.067], [-12.406, 13.944, 10.092],
    [-18.568, 0.163, 5.617], [-14.198, -12.079, -1.929], [2.395, -18.585, -1.69], [12.304, -14.036, -0.57]],
  4: [[14.698, 0.379, -6.006], [11.217, 7.223, -5.207], [-1.646, 11.098, -2.206], [-11.42, 7.037, 1.914],
    [-14.701, -0.297, 6.12], [-10.685, -7.674, 7.267], [-1.834, -11.081, 3.648], [9.45, -8.558, -2.897]],
}

test('circles sweep along smoothly closed 3D fillet polylines', () => {
  // The halves of the edges joined into one curve: the kernel could not sweep a circle along most
  // of them (SM_ERR, 39 of 40 random loops that swept before in the wasm). Swept in one go and
  // closed where the ends meet, as other profiles are.
  const cases: [P3[], number, number][] = [
    [[[0, 0, 0], [30, 0, 0], [30, 30, 10], [0, 30, 0]], 6, 2],
    [[[24.226, 5.277, 4.539], [-3.137, 18.162, 4.837], [-17.105, -0.267, -4.161], [6.641, -22.637, 3.545]], 4, 1.5],
    [[[23.518, 2.391, 4.238], [-5.46, 24.013, 0.691], [-24.229, -2.084, 6.298], [1.397, -19.966, 6.382]], 4, 1.5],
  ]
  for (const [pts, radius, r] of cases) {
    const path = FilletPolyline(...pts, { radius, close: true })
    const tube = quiet(() => sweep(Circle(r), path) as Part)
    assert.ok(sound(tube))
    approx(tube.volume, PI * r * r * path.length, 1e-6)
  }
  const path = FilletPolyline([0, 0, 0], [30, 0, 0], [30, 30, 10], [0, 30, 0], { radius: 6, close: true })
  approx((sweep(Circle(2), path) as Part).volume, 1410.9417, 1e-7)
})

test('loops closed with a kink sweep as before where carried they fail', () => {
  // Carried along the halves, the fuse where the ends cross failed for these loops, which swept
  // before: they go the way they went before then. Each comes out area x length less the overlap
  // of the ends at the kink, a few tenths of a percent.
  for (const i of [7, 18, 27]) {
    const path = Spline(...KINKED[i], KINKED[i][0])
    const tube = quiet(() => sweep(Circle(1.5), path) as Part)
    const full = PI * 1.5 ** 2 * path.length
    assert.ok(sound(tube) && tube.volume > 0.995 * full && tube.volume < full, `loop ${i}: ${tube.volume} of ${full}`)
  }
})

test('the former sweep of kinked loops does not crash the kernel', () => {
  // Fused, the halves of these loops read freed memory in the kernel (SmMerge::ManifoldBoolean
  // marked a Vertex that CloseIntersectionLoop had deleted before it failed; natively the process
  // died). They throw now. In a process of its own, so that a trap does not leave this one's
  // kernel damaged.
  const src = new URL('../src/', import.meta.url).href
  const code = `
    import { Circle, Spline, ModelingError, sweep } from '${src}index.ts'
    const loops = [[[18.547, 0.0, -0.158], [11.564, 23.04, 1.635], [-4.127, 28.73, -3.088], [-16.71, 12.786, 4.037],
      [-16.71, -12.786, -3.752], [-4.127, -28.73, 3.159], [11.564, -23.04, -1.832]],
      [[21.58, 0.0, -2.951], [15.26, 7.405, 0.925], [0.0, 10.473, 2.951], [-15.26, 7.405, -0.925], [-21.58, 0.0, -2.951],
      [-15.26, -7.405, 0.925], [0.0, -10.473, 2.951], [15.26, -7.405, -0.925]]]
    const out = []
    for (const pts of loops) {
      try {
        out.push(sweep(Circle(2), Spline(...pts, pts[0])).isValid() ? 'valid' : 'invalid')
      } catch (e) {
        out.push(e instanceof WebAssembly.RuntimeError ? 'crashed' : e instanceof ModelingError ? 'ModelingError' : String(e))
      }
    }
    console.log(out.join(' '))
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 300_000 })
  assert.equal(run.status, 0, run.stderr)
  const out = run.stdout.trim().split(' ')
  assert.equal(out.length, 2)
  assert.ok(out.every((s) => s === 'valid' || s === 'ModelingError'), run.stdout)
})

test('fused sweeps have no faces without area', () => {
  // The fuse of the halves of a loop closed with a kink left faces of no area where the end caps and
  // both tubes meet at a point (25 of about 100 random loops before), some of them a shell of their
  // own inside the solid, which STEP writes as a void: OpenCASCADE read the plan's loop inside out
  // (-1707.27). They are taken out, or the sweep throws.
  const tube = quiet(() => sweep(Circle(1.5), Spline(...KINKED[4], KINKED[4][0])) as Part) // (2 such faces before)
  assert.ok(sound(tube))
  assert.equal(tube.faces().length, 4)
  approx(tube.volume, 611.1968, 1e-6)
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i * PI) / 4
    return [20 * Math.cos(a), 20 * Math.sin(a), 6 * Math.sin(2 * a)] as P3
  })
  try {
    assert.ok(sound(sweep(Circle(2), Spline(...pts, pts[0])) as Part))
  } catch (e) {
    assert.ok(e instanceof ModelingError && /enclose no area|fuse failed/.test(e.message), String(e))
  }
  for (const pts of Object.values(KINKED)) {
    for (const profile of [Circle(1.5), Rectangle(3, 1.2), Ellipse(1.5, 1)]) {
      // (where the halves turned to meet where the loop closes do not fuse, the kernel's frame sweeps
      // them, with a warning: the ellipse along loop 18)
      const [body, said] = warned(() => sweep(profile, Spline(...pts, pts[0])) as Part)
      assert.deepEqual(said.filter((w) => !w.includes('meet itself where the loop closes')), [])
      assert.ok(sound(body))
    }
  }
})

const unit = (v: readonly number[]): P3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}
const cross = (a: readonly number[], b: readonly number[]): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const comb = (...terms: [number, readonly number[]][]): P3 =>
  [0, 1, 2].map((i) => terms.reduce((s, [k, v]) => s + k * v[i], 0)) as P3

function planarPath(normal: readonly number[], turn: number): P3[] {
  const n = unit(normal)
  let u = unit(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]))
  const a = (turn * PI) / 180
  u = comb([Math.cos(a), u], [Math.sin(a), cross(n, u)])
  const v = cross(n, u)
  const p1 = comb([40, u])
  const p2 = comb([1, p1], [30, v])
  return [[0, 0, 0], p1, p2, comb([1, p2], [-25, u], [10, v])]
}

/** How far the center of the triangle's own box lies from the path, halfway along its first edge:
 * the section there is the triangle, matched to it by its sides. */
function boxCenterOffPath(part: Part, path: Wire, corners: [number, number][]): number {
  const e = path.edges().at(0)!
  const t = unit(e.tangentAt(0.5).toArray())
  const at = e.pointAt(0.5).toArray()
  const cut = [...part.section(new Plane(at, null, t)).vertices()]
    .map((v) => v.point.toArray())
    .filter((c) => Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]) < 8) // (not where the plane cuts other legs)
  assert.equal(cut.length, 3)
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const center = [0.5 * (Math.min(...xs) + Math.max(...xs)), 0.5 * (Math.min(...ys) + Math.max(...ys))]
  // barycentric weights of the center in the triangle
  const [[x0, y0], [x1, y1], [x2, y2]] = corners
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  const w1 = ((center[0] - x0) * (y2 - y0) - (x2 - x0) * (center[1] - y0)) / det
  const w2 = ((x1 - x0) * (center[1] - y0) - (center[0] - x0) * (y1 - y0)) / det
  const w = [1 - w1 - w2, w1, w2]
  const len = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0))
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const q = order.map((i) => cut[i])
    if ([[0, 1], [1, 2], [0, 2]].every(([i, j]) => Math.abs(len(q[i], q[j]) - len(corners[i], corners[j])) < 1e-6)) {
      const p = comb([w[0], q[0]], [w[1], q[1]], [w[2], q[2]])
      return len(p, at)
    }
  }
  throw new Error('the section is not the triangle')
}

const RIGHT: [number, number][] = [[0, 0], [6, 0], [0, 3]]
const ODD: [number, number][] = [[0, 0], [6, 0], [1, 4]]

test('planar paths with mitered corners in any plane', () => {
  // The kernel's planar-path sweep frames each edge with the world's Z axis: in a plane that is not
  // horizontal its frames did not meet at the corners, and it returned no closed solid (a path in the
  // YZ plane, a triangle on a path in the XZ plane that turns back, any oblique plane). The path is
  // swept in a frame of its own now.
  for (const normal of [[1, 0, 0], [0, 1, 0], [1, 1, 1], [1, 2, 0.3], [0.2, 0.1, 1]]) {
    for (const turn of [0, 30]) {
      const pts = planarPath(normal, turn)
      for (const path of [Polyline(...pts), FilletPolyline(...pts, { radius: 5 })]) {
        const bar = quiet(() => sweep(Rectangle(6, 2), path) as Part)
        assert.ok(bar.isValid())
        approx(bar.volume, 12 * path.length, 1e-7)
        const tri = quiet(() => sweep(Polygon(...ODD), path) as Part)
        assert.ok(tri.isValid() && boxCenterOffPath(tri, path, ODD) < 1e-6)
      }
    }
  }
  const frame = sweep(Rectangle(6, 4), Polyline([0, 0, 0], [0, 40, 0], [0, 40, 40])) as Part
  assert.ok(frame.isValid())
  approx(frame.volume, 24 * 80)
})

test('planar paths place asymmetric profiles by their own box', () => {
  // The kernel moved the profile by the center of its box along the world axes: a triangle turned off
  // them (a path in the XY plane that does not start along X or Y) went beside the path, 0.25 for
  // this one at 30 degrees. The path is moved by the difference now: its offset curve (lines and
  // arcs) and along its normal.
  for (const turn of [30, 45]) {
    const a = (turn * PI) / 180
    const u = [Math.cos(a), Math.sin(a), 0]
    const v = [-Math.sin(a), Math.cos(a), 0]
    const pts: P3[] = [[0, 0, 0], comb([40, u]), comb([40, u], [30, v]), comb([15, u], [40, v])]
    for (const path of [Polyline(...pts), FilletPolyline(...pts, { radius: 4 }), Polyline(...pts, { close: true }),
      FilletPolyline(...pts, { radius: 4, close: true })]) {
      const body = quiet(() => sweep(Polygon(...ODD), path) as Part)
      assert.ok(body.isValid() && boxCenterOffPath(body, path, ODD) < 1e-6)
    }
  }
  // paths that start along X, Y or Z: as before
  const tri = Polygon(...RIGHT)
  let body = sweep(tri, Polyline([0, 0, 0], [40, 0, 0], [40, 40, 0])) as Part
  approx(body.volume, 729.0)
  assert.deepEqual(body.bbox().min.toArray().map((x) => Math.round(x * 1e9) / 1e9 + 0), [0, -1.5, -3])
  assert.deepEqual(body.bbox().max.toArray().map((x) => Math.round(x * 1e9) / 1e9 + 0), [41.5, 40, 3])
  body = sweep(tri, Polyline([0, 0, 0], [0, 0, 40], [40, 0, 40])) as Part
  approx(body.volume, 738.0)
  assert.deepEqual(body.bbox().max.toArray().map((x) => Math.round(x * 1e9) / 1e9 + 0), [40, 1.5, 43])
  // a spline among the edges, the profile turned off the axes: on its own box too (the kernel is given
  // the anchor; before, the path's spline could not be offset and the profile sat by its box along the
  // path's plane, with a warning)
  const [c, s] = [Math.cos(PI / 6), Math.sin(PI / 6)]
  const wavy = new Wire([Line([0, 0, 0], [20 * c, 20 * s, 0]),
    Spline([20 * c, 20 * s, 0], [30, 25, 0], [50, 30, 0], { tangents: [[c, s, 0], [1, 0, 0]] })])
  const [wavyBody, said] = warned(() => sweep(Polygon(...ODD), wavy) as Part)
  assert.deepEqual(said, [])
  assert.ok(wavyBody.isValid() && boxCenterOffPath(wavyBody, wavy, ODD) < 1e-6)
})


// -- batch 2: the profile's attitude along the path (S3), analytic revolves (S4), planar paths (S6) --

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The direction of the longest edge of the planar face nearest to point (an end cap). */
function capLongSide(part: Part, point: P3): P3 {
  const caps = [...part.faces()].filter((f) => f.geomType === 'plane')
  const cap = caps.reduce((a, b) => (a.center().distanceTo(point) <= b.center().distanceTo(point) ? a : b))
  const e = [...cap.edges()].reduce((a, b) => (a.length >= b.length ? a : b))
  return unit(e.end.sub(e.start).toArray())
}

/** The angle (degrees, modulo 180) from u to v about t. */
const angleTo = (v: P3, u: P3, t: P3) => ((((Math.atan2(dot(cross(u, v), t), dot(u, v)) * 180) / PI) % 180) + 180) % 180

test('a rectangle keeps its attitude along a helix', () => {
  // ai/todo/features.md 10: the profile rolled about the path by some 30 degrees a turn
  const helix = Helix(5, 30, 10)
  const rect = quiet(() => sweep(Rectangle(2, 1), helix) as Part)
  assert.ok(rect.isValid())
  approx(rect.volume, 2 * helix.length, 1e-5)
  for (const plane of [Plane.YZ, Plane.XZ]) {
    const whole = [...rect.section(plane).faces()].map((f) => f.bbox().size).filter((s) => s.z > 0.75)
    assert.ok(whole.length >= 6)
    for (const s of whole) {
      const radial = plane === Plane.YZ ? s.y : s.x
      approx(radial, 2, 0, 2e-3)
      approx(s.z, 1, 0, 5e-3)
    }
  }
})

test('the default along a conical helix and a chain of helices is their axis', () => {
  const cone = Helix(5, 30, 10, { endRadius: 5 })
  const found = ext.helix_axis([cone._copyCurve()], 1e-5) as number[][]
  assert.ok(found !== null && Math.abs(found[1][2] - 1) < 1e-7)
  const tilted = Helix(5, 30, 10, { endRadius: 5, direction: [1, 2, 3], center: [4, 5, 6] })
  const axis = ext.helix_axis([tilted._copyCurve()], 1e-5) as number[][]
  for (let i = 0; i < 3; i++) approx(axis[1][i], (i + 1) / Math.sqrt(14), 0, 1e-7)
  assert.equal(ext.helix_axis([Spline([0, 0, 0], [10, 5, 3], [20, -5, 7], [30, 0, 9])._copyCurve()], 1e-5), null)
  const body = quiet(() => sweep(Rectangle(2, 1), cone) as Part)
  approx(body.volume, 2 * cone.length, 1e-5)
  const end = cone.pointAt(1).toArray() as P3
  const side = capLongSide(body, end)
  const radial = unit([end[0], end[1], 0])
  assert.ok(Math.abs(dot(side, radial)) > Math.cos((2 * PI) / 180))
})

test('up keeps the profile’s angle to a direction', () => {
  const path = Spline([0, 0, 0], [10, 20, 10], [30, 10, 25], [40, 30, 30])
  const body = quiet(() => sweep(Rectangle(4, 2), path, { up: Z }) as Part)
  assert.ok(body.isValid())
  approx(body.volume, 8 * path.length, 1e-5)
  const upAt = (t: number): [P3, P3] => {
    const tangent = path.tangentAt(t).toArray() as P3
    return [unit([-tangent[2] * tangent[0], -tangent[2] * tangent[1], 1 - tangent[2] * tangent[2]]), tangent]
  }
  const angles = [0, 1].map((t) => {
    const [up, tangent] = upAt(t)
    return angleTo(capLongSide(body, path.pointAt(t).toArray() as P3), up, tangent)
  })
  const d = Math.abs(angles[1] - angles[0])
  assert.ok(d < 1e-3 || Math.abs(d - 180) < 1e-3)
  const free = sweep(Rectangle(4, 2), path) as Part
  const [up, tangent] = upAt(1)
  assert.ok(Math.abs(angleTo(capLongSide(free, path.pointAt(1).toArray() as P3), up, tangent) - angles[0]) > 1)
  approx(Rectangle(4, 2).sweep(path, { up: new Axis([5, 5, 5], [0, 0, 1]) }).volume, body.volume, 1e-9)
  const frenet = quiet(() => sweep(Rectangle(4, 2), path, { up: 'frenet' }) as Part)
  assert.ok(frenet.isValid())
  approx(frenet.volume, 8 * path.length, 1e-5)
})

test('twist turns the profile along the path', () => {
  const line = Line([0, 0, 0], [0, 0, 100])
  const bar = quiet(() => sweep(Rectangle(10, 2), line, { twist: 180 }) as Part)
  assert.ok(bar.isValid())
  approx(bar.volume, 2000, 1e-6)
  const middle = bar.section(Plane.XY.offset(50)).bbox().size
  approx(middle.x, 2, 0, 1e-4)
  approx(middle.y, 10, 0, 1e-4)
  const top = bar.section(Plane.XY.offset(100 - 1e-6)).bbox().size
  approx(top.x, 10, 0, 1e-4)
  approx(top.y, 2, 0, 1e-4)
  const law = quiet(() => sweep(Rectangle(10, 2), line, { twist: (s: number) => 90 * s * s }) as Part)
  const a = (22.5 * PI) / 180
  const half = law.section(Plane.XY.offset(50)).bbox().size
  approx(half.x, 10 * Math.cos(a) + 2 * Math.sin(a), 0, 1e-3)
  approx(half.y, 10 * Math.sin(a) + 2 * Math.cos(a), 0, 1e-3)
  const ribbon = sweep(Line([-5, 0, 0], [5, 0, 0]), line, { twist: 180 }) as Shell
  const k = PI / 100
  const strip = 2 * (2.5 * Math.sqrt(1 + (5 * k) ** 2) + Math.asinh(5 * k) / (2 * k))
  approx(ribbon.area, 100 * strip, 1e-5)
  const fp = FilletPolyline([0, 0, 0], [0, 0, 40], [40, 0, 40], [40, 40, 40], { radius: 8 })
  approx(quiet(() => sweep(Rectangle(4, 2), fp, { twist: 90 }) as Part).volume, 8 * fp.length, 1e-5)
  const helix = Helix(5, 30, 10)
  approx(quiet(() => sweep(Rectangle(2, 1), helix, { twist: 360 }) as Part).volume, 2 * helix.length, 1e-5)
})

test('up and twist errors', () => {
  const line = Line([0, 0, 0], [0, 0, 50])
  assert.throws(() => sweep(Rectangle(4, 2), line, { up: Z }), { name: 'RangeError', message: /runs along up/ })
  assert.throws(() => sweep(Rectangle(4, 2), line, { up: 'frenet' }), { name: 'RangeError', message: /runs straight/ })
  assert.throws(() => sweep(Rectangle(4, 2), line, { twist: 10, translational: true }), { name: 'RangeError', message: /orient true and translational false/ })
  assert.throws(() => sweep(Rectangle(4, 2), line, { up: 'binormal' }), { name: 'RangeError', message: /'frenet'/ })
  assert.throws(() => sweep(Rectangle(4, 2), line, { twist: 'a lot' as unknown as number }), TypeError)
  assert.throws(() => sweep(Rectangle(4, 2), Polyline([0, 0, 0], [0, 0, 40], [40, 0, 40]), { twist: 10, sharpCorners: true }), /sharpCorners false/)
  const loop = Spline([20, 0, 0], [0, 20, 6], [-20, 0, 0], [0, -20, -6], { closed: true })
  assert.throws(() => sweep(Rectangle(4, 2), loop, { twist: 90 }), { name: 'RangeError', message: /come round into itself/ })
  const square = quiet(() => sweep(Rectangle(3, 3), loop, { twist: 90 }) as Part)
  assert.ok(square.isValid())
  approx(square.volume, 9 * loop.length, 1e-5)
})

test('a chain of helices with even turns is not planar', () => {
  for (const turns of [30, 16]) {
    const chain = new Wire([Helix(1, turns, 5), Helix(1, turns, 5, { center: [0, 0, turns] })])
    const spring = quiet(() => sweep(Rectangle(0.6, 0.3), chain) as Part)
    assert.ok(spring.isValid())
    approx(spring.volume, 0.18 * chain.length, 1e-5)
  }
})

test('planar paths whose corners cannot be mitered go piece by piece', () => {
  const kinked = new Wire([ThreePointArc([0, 0, 0], [5, 5, 0], [10, 0, 0]), ThreePointArc([10, 0, 0], [14, 3, 0], [20, 2, 0])])
  const [body, said] = warned(() => sweep(Rectangle(2, 1), kinked) as Part)
  assert.ok(said.some((m) => /cannot be mitered/.test(m)))
  assert.ok(body.isValid())
  approx(body.volume, (sweep(Rectangle(2, 1), kinked, { sharpCorners: false }) as Part).volume, 1e-12)
  assert.throws(() => sweep(Rectangle(2, 1), kinked, { sharpCorners: true }), ModelingError)
})

test('full revolves give cylinders, cones, spheres and tori', () => {
  const types = (p: Part | Shell) => [...p.faces()].map((f) => f.geomType).sort()
  const tube = Polygon([5, 0], [10, 0], [10, 20], [5, 20]).on(Plane.XZ).revolve(Z)
  assert.deepEqual(types(tube), ['cylinder', 'cylinder', 'plane', 'plane'])
  const radii = [...tube.faces().cylinders()].map((f) => f.radius).sort((a, b) => a - b)
  approx(radii[0], 5, 1e-12)
  approx(radii[1], 10, 1e-12)
  approx(tube.volume, PI * 75 * 20, 1e-12)
  const outer = [...tube.faces().cylinders()].reduce((a, b) => (a.radius >= b.radius ? a : b))
  const drafted = tube.draft(outer, 3, Plane.XY)
  assert.ok(drafted.isValid() && drafted.volume < tube.volume)
  const lathe = Rectangle(5, 20, { align: [Align.MIN, Align.MIN] }).translate(5, 0).fillet(1).on(Plane.XZ)
  const whole = lathe.revolve(Z)
  assert.deepEqual(types(whole), ['cylinder', 'cylinder', 'plane', 'plane', 'torus', 'torus', 'torus', 'torus'])
  for (const f of whole.faces()) if (f.geomType === 'torus') approx(f.radius, 1, 1e-9)
  approx(whole.volume, 4 * lathe.revolve(Z, 90).volume, 1e-9)
  const ball = Circle(10).intersect(Rectangle(10, 20, { align: [Align.MIN, Align.CENTER] })).on(Plane.XZ).revolve(Z)
  assert.deepEqual(types(ball), ['sphere', 'sphere'])
  approx(ball.volume, (4 / 3) * PI * 1000, 1e-12)
  assert.deepEqual(types(Polygon([0, 0], [10, 0], [0, 20]).on(Plane.XZ).revolve(Z)), ['cone', 'plane'])
  assert.deepEqual(types(Circle(2).translate(10, 0).on(Plane.XZ).revolve(Z, 90)), ['plane', 'plane', 'torus'])
  const holed = Rectangle(10, 20, { align: [Align.MIN, Align.MIN] }).cut(Circle(1).translate(5, 10)).on(Plane.XZ).revolve(Z, 90)
  assert.ok(!types(holed).includes('revolution'))
  const vase = revolve(Spline([5, 0, 0], [8, 0, 5], [6, 0, 10], [9, 0, 20]), Z) as Shell
  assert.equal(vase.faces()[0].geomType, 'revolution')
  assert.ok(vase.faces()[0].axis.direction.isParallel([0, 0, 1]))
  const sheet = revolve(Line([5, 0, 0], [5, 0, 20]), Z) as Shell
  assert.deepEqual(types(sheet), ['cylinder'])
  approx(sheet.area, 2 * PI * 5 * 20, 1e-9)
})

test('revolves within a hundredth of a degree of a turn are whole', () => {
  const section = Polygon([5, 0], [10, 0], [10, 20], [5, 20]).on(Plane.XZ)
  for (const angle of [359.995, 359.999, 359.9999]) approx(section.revolve(Z, angle).volume, PI * 75 * 20, 1e-12)
  assert.ok(section.revolve(Z, 359.99).volume < PI * 75 * 20)
  const path = join(mkdtempSync(join(tmpdir(), 'smlibwasm-lane-s-')), 'tube.step')
  exportStep(section.revolve(Z), path)
  const text = readFileSync(path, 'utf8')
  assert.equal(text.split('CYLINDRICAL_SURFACE').length - 1, 2)
  assert.ok(!text.includes('B_SPLINE_SURFACE'))
  const back = importStep(path) as Part
  assert.deepEqual([...back.faces()].map((f) => f.geomType).sort(), ['cylinder', 'cylinder', 'plane', 'plane'])
})

// -- batch 3: scale laws (S7), lines and arcs (S8), tapers (S9), loft ends (S10), curve copies (S11) ---
const kinds = (p: Part | Shell) => [...p.faces()].map((f) => f.geomType).sort()
const radiusAt = (p: Part, z: number) => Math.sqrt(p.section(new Plane([0, 0, z])).area / PI)

test('sweeps scale the profile along the path', () => {
  const cone = sweep(Circle(2), Line([0, 0, 0], [0, 0, 50]), { scale: [1, 2] }) as Part
  assert.ok(cone.isValid())
  approx(cone.volume, (PI * 50 * (4 + 8 + 16)) / 3, 1e-7)
  approx(radiusAt(cone, 25), 3, 1e-4)
  approx(radiusAt(cone, 49), 3.96, 1e-4)
  const bar = Rectangle(4, 2).sweep(Line([0, 0, 0], [0, 0, 30]), { scale: (t: number) => 1 + t })
  approx(bar.volume, (8 * 30 * 7) / 3, 1e-9)
  approx(bar.bbox().max.x, 4, 1e-6)
  const bulge = sweep(Circle(2), Line([0, 0, 0], [0, 0, 40]), { scale: [[0, 1], [0.5, 1.6], [1, 1]] }) as Part
  approx(radiusAt(bulge, 20), 3.2, 1e-4)
  approx(radiusAt(bulge, 10), 2 * 1.45, 1e-4)
  approx(radiusAt(bulge, 1), 2 * (0.99275 + 0.045125 * 0.5 * 2.4 + 0.00725 * 1.6), 1e-4)
  const path = Spline([0, 0, 0], [0, 10, 20], [30, 10, 40])
  const horn = sweep(Circle(1), path, { scale: [1, 3] }) as Part
  assert.ok(horn.isValid())
  approx(horn.volume, (PI * path.length * (1 + 3 + 9)) / 3, 1e-7)
  const h = Helix(10, 40, 15)
  approx((sweep(Circle(2), h, { scale: [1, 0.5] }) as Part).volume, (PI * 4 * h.length * 1.75) / 3, 1e-6)
  approx((sweep(Rectangle(4, 2), Line([0, 0, 0], [0, 0, 30]), { twist: 90, scale: [1, 2] }) as Part).volume, (8 * 30 * 7) / 3, 1e-5)
  const ring = sweep(Circle(1), Circle(10).edges()[0], { scale: (t: number) => 1 + 0.5 * Math.sin(PI * t) ** 2 }) as Part
  assert.ok(ring.isValid())
  approx(ring.volume, PI * 2 * PI * 10 * (1 + 0.5 + (0.25 * 3) / 8), 1e-5)
  approx((sweep(Line([-1, 0, 0], [1, 0, 0]), Line([0, 0, 0], [0, 10, 10]), { scale: [1, 2] }) as Shell).area, 2 * Math.sqrt(200) * 1.5, 1e-9)
  const corner = quiet(() => sweep(Rectangle(2, 1), Polyline([0, 0, 0], [20, 0, 0], [20, 20, 0]), { scale: [1, 2] }) as Part)
  assert.ok(corner.isValid() && corner.volume > ((2 * 40 * 7) / 3) * 0.95 && corner.volume < (2 * 40 * 7) / 3)
})

test('scale errors', () => {
  const line = Line([0, 0, 0], [0, 0, 10])
  assert.throws(() => sweep(Circle(1), line, { scale: [1, -1] }), { name: 'RangeError', message: /positive/ })
  assert.throws(() => sweep(Circle(1), line, { scale: (t: number) => 1 - t }), { name: 'RangeError', message: /positive/ })
  assert.throws(() => sweep(Circle(1), line, { scale: [[0, 1], [0.5, 2]] }), { name: 'RangeError', message: /t = 0 to t = 1/ })
  for (const bad of ['x', 3]) assert.throws(() => sweep(Circle(1), line, { scale: bad as never }), { name: 'TypeError', message: /scale is/ })
  assert.throws(() => sweep(Circle(1), Circle(10).edges()[0], { scale: [1, 2] }), { name: 'RangeError', message: /come round into itself/ })
  assert.throws(() => sweep(Rectangle(2, 1), Polyline([0, 0, 0], [20, 0, 0], [20, 20, 0]), { scale: [1, 2], sharpCorners: true }), {
    name: 'RangeError',
    message: /sharpCorners false/,
  })
})

test('single lines and arcs sweep into planes, cylinders and tori', () => {
  const rod = sweep(Circle(2), Line([0, 0, 0], [0, 0, 50])) as Part
  assert.deepEqual(kinds(rod), ['cylinder', 'plane', 'plane'])
  approx(rod.faces().cylinders()[0].radius, 2, 1e-12)
  approx(rod.volume, PI * 4 * 50, 1e-12)
  const beam = sweep(Rectangle(4, 3).cut(Circle(1)), Line([1, 2, 3], [11, 22, 13])) as Part
  assert.deepEqual(kinds(beam), ['cylinder', 'plane', 'plane', 'plane', 'plane', 'plane', 'plane'])
  approx(beam.volume, (12 - PI) * Math.sqrt(600), 1e-12)
  const bend = sweep(Rectangle(4, 2), CenterArc([0, 0], 10, 0, 90)) as Part
  assert.deepEqual(kinds(bend), ['cylinder', 'cylinder', 'plane', 'plane', 'plane', 'plane'])
  approx(bend.volume, ((8 * PI) / 2) * 10, 1e-12)
  const torus = sweep(Circle(2), Circle(10).edges()[0]) as Part
  assert.deepEqual(kinds(torus), ['torus'])
  approx(torus.volume, PI * 4 * 2 * PI * 10, 1e-12)
  const prism = sweep(Rectangle(4, 2), Line([0, 0, 0], [10, 20, 10]), { translational: true }) as Part
  approx(prism.volume, 80, 1e-12)
  assert.throws(() => sweep(Circle(12), CenterArc([0, 0], 10, 0, 90)), (e: unknown) => e instanceof ModelingError && /across the axis of the arc/.test(e.message))
})

test('tapered extrusions have plane walls', () => {
  const inward = Rectangle(30, 30).extrude(10, { taper: 8 })
  assert.deepEqual(kinds(inward), Array(6).fill('plane'))
  approx(inward.volume, 8183.09063, 1e-9)
  const outward = Rectangle(30, 30).extrude(10, { taper: -8 })
  assert.deepEqual(kinds(outward), Array(6).fill('plane'))
  approx(outward.volume, 9869.58064, 1e-9)
  const holed = Rectangle(30, 30).cut(Rectangle(10, 10)).extrude(10, { taper: -5 })
  assert.deepEqual(kinds(holed), Array(10).fill('plane'))
  approx(holed.volume, 8699.9093, 1e-8)
  const ell = Polygon([0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]).extrude(10, { taper: -8, both: true })
  assert.deepEqual([...new Set(kinds(ell))], ['plane'])
  approx(ell.volume, 2 * 3148.498974, 1e-8)
  const box = Rectangle(20, 20).extrude(10, { taper: 3 })
  const again = box.draft(box.faces().filter((f) => Math.abs(f.normalAt().z) < 0.5), 2, Plane.XY)
  approx(again.volume, Rectangle(20, 20).extrude(10, { taper: 5 }).volume, 1e-9)
  const rounded = Rectangle(30, 30).extrude(10, { taper: -8, corners: 'round' })
  assert.equal(rounded.faces().length, 10)
  approx(rounded.volume, 9863.92897, 1e-8)
  const soft = Rectangle(20, 20).extrude(10, { taper: 3, corners: 'round' })
  const flat = soft.faces().filter((f) => f.geomType === 'bspline')
  assert.equal(flat.length, 4)
  approx(soft.draft(flat, 2, Plane.XY).volume, Rectangle(20, 20).extrude(10, { taper: 5 }).volume, 1e-9)
  assert.throws(() => Rectangle(30, 30).extrude(10, { taper: 5, corners: 'chamfer' as never }), { name: 'RangeError', message: /corners is 'sharp' or 'round'/ })
  assert.throws(() => Circle(10).cut(Circle(8)).extrude(10, { taper: 10 }), (e: unknown) => e instanceof ModelingError && /closes the profile after 5.67128 of 10/.test(e.message))
})

test('lofts leave and reach their ends along tangents', () => {
  const a = Circle(10)
  const b = Circle(4).moved(new Location([0, 0, 30]))
  const radialError = (p: Part) => {
    const side = p.faces().filter((f) => f.geomType === 'bspline')[0]
    let worst = 0
    for (let i = 0; i < 12; i++) {
      const t = (2 * PI * i) / 12
      for (const [r, z] of [[10, 0], [4, 30]]) {
        const n = side.normalAt(new Vector(r * Math.cos(t), r * Math.sin(t), z))
        worst = Math.max(worst, n.angleTo([Math.cos(t), Math.sin(t), 0]))
      }
    }
    return worst
  }
  const neck = loft([a, b], { startTangent: Z, endTangent: Z }) as Part
  assert.ok(neck.isValid() && radialError(neck) < 1e-6)
  assert.ok(radialError(loft([a, b]) as Part) > 1)
  const bottle = Circle(10).extrude(-20).fuse(neck).fuse(Circle(4).moved(new Location([0, 0, 30])).extrude(10))
  assert.ok(bottle.isValid())
  assert.equal(bottle.faces().length, 5)
  approx((loft([a, b], { startTangent: Z }) as Part).volume, 6361.8212, 1e-6)
  const holed = loft([Rectangle(20, 20).cut(Circle(4)), Rectangle(10, 10).cut(Circle(2)).moved(new Location([0, 0, 20]))], { startTangent: Z, endTangent: Z }) as Part
  assert.ok(holed.isValid())
  assert.equal(holed.faces().length, 7)
  const rings = Array.from({ length: 16 }, (_, i) => {
    const t = (2 * PI * i) / 16
    return Circle(2).moved(new Plane([10 * Math.cos(t), 10 * Math.sin(t), 0], [Math.cos(t), Math.sin(t), 0], [-Math.sin(t), Math.cos(t), 0]).location)
  })
  const torus = loft(rings, { closed: true }) as Part
  assert.ok(torus.isValid())
  assert.equal(torus.faces().length, 1)
  approx(torus.volume, 2 * PI ** 2 * 10 * 4, 2e-4)
  assert.throws(() => loft([a, b], { startTangent: X }), { name: 'RangeError', message: /lies in the plane/ })
  assert.throws(() => loft([a, b], { ruled: true, endTangent: Z }), { name: 'RangeError', message: /ruled false/ })
  assert.throws(() => loft(rings, { closed: true, startTangent: Z }), { name: 'RangeError', message: /closed false/ })
  assert.throws(() => loft([a, b], { closed: true }), { name: 'RangeError', message: /three sections/ })
})

test('revolves, lofts, extrusions and tapers free their curve copies', () => {
  const counts = { copies: 0, deletes: 0 }
  const copy = Edge.prototype._copyCurve
  const del = ext.delete_curve
  Edge.prototype._copyCurve = function (this: Edge) {
    counts.copies++
    return copy.call(this)
  }
  ext.delete_curve = (c: number) => {
    counts.deletes++
    return del(c)
  }
  try {
    const lathe = Rectangle(10, 10, { align: [Align.MIN, Align.MIN] }).translate(5, 0).cut(Circle(2).translate(10, 5)).on(Plane.XZ)
    const sections = [Rectangle(10, 10).cut(Circle(2)), Rectangle(8, 8).cut(Circle(1)).moved(new Location([0, 0, 10]))]
    const region = Rectangle(30, 30).cut(Circle(4))
    const curve = Spline([0, 0, 0], [5, 3, 0], [10, 0, 0])
    for (const op of [
      () => lathe.revolve(Z, 90),
      () => revolve(Line([5, 0, 0], [5, 0, 20]), Z),
      () => extrude(curve, 5), // (both: the moved copy of the curve is a handle's, freed by the collector)
      () => loft(sections),
      () => region.extrude(10, { taper: 5 }),
      // (not the mitered sweep: it moves the path, and the moved curves are handles', freed by the collector)
    ]) {
      counts.copies = 0
      counts.deletes = 0
      op()
      assert.ok(counts.copies > 0 && counts.deletes >= counts.copies, JSON.stringify(counts))
    }
  } finally {
    Edge.prototype._copyCurve = copy
    ext.delete_curve = del
  }
})

// S12: swing, a revolve about Z whose circle is an outline of any shape

test('swing carries the profile around the outline', () => {
  const cup = Polygon([0, 0], [30, 0], [30, 40], [0, 40]).on(Plane.front)
  const box = swing(cup, Ellipse(30, 20)) as Part
  assert.ok(box.isValid())
  approx(box.volume, PI * 30 * 20 * 40, 1e-9)
  approx(cup.swing(Ellipse(30, 20)).volume, box.volume, 1e-12)
  // sections scale with the profile's distance from the axis: a frustum's 1 + 1/2 + 1/4 over 3
  const cone = swing(Polygon([0, 0], [30, 0], [15, 40], [0, 40]).on(Plane.front), Ellipse(30, 20)) as Part
  approx(cone.volume, (PI * 30 * 20 * 40 * 1.75) / 3, 1e-9)
  // a circle about the origin is the revolve
  const lathe = Polygon([0, 0], [30, 0], [15, 40], [0, 40]).on(Plane.front)
  approx((swing(lathe, Circle(30)) as Part).volume, lathe.revolve(Z).volume, 1e-9)
  // the cut by the XZ plane at +X is the profile, also for an outline crossing it off a vertex: a rounded
  // rectangle turned by 30 degrees (the kernel's own swung primitive raised SM_ERR for it), an off-centre
  // circle (crossing +X at 5 + sqrt(391))
  const p = swing(cup, RoundedRectangle(60, 40, 10).rotate(Z, 30)) as Part
  for (const z of [5, 20, 35]) assert.ok(p.distanceTo([30, 0, z]) < 1e-9 && p.distanceTo([30.01, 0, z]) > 0.005)
  const r0 = 5 + Math.sqrt(391)
  approx((swing(cup, Circle(20).translate(5, 3)) as Part).volume, PI * 400 * (30 / r0) ** 2 * 40, 1e-9)
  // beside the axis (a ring), with holes, an open curve (a surface)
  const ring = swing(Polygon([20, 0], [30, 0], [30, 10], [20, 10]).on(Plane.front), Ellipse(30, 20)) as Part
  approx(ring.volume, PI * 600 * 10 * (1 - (20 / 30) ** 2), 1e-9)
  const holed = Rectangle(20, 30, { align: [Align.MIN, Align.MIN] }).cut(Circle(4).translate(12, 15)).on(Plane.front)
  approx((swing(holed, Circle(20)) as Part).volume, holed.revolve(Z).volume, 1e-9)
  const sheet = swing(Spline([0, 0, 0], [25, 0, 10], [15, 0, 30], [20, 0, 45], [0, 0, 50]), Ellipse(30, 20))
  assert.ok(sheet instanceof ShellBody && sheet.area > 0)
  const bottle = swing(Polygon([0, 0], [20, 0], [20, 50], [8, 60], [8, 70], [0, 70]).on(Plane.front), RoundedRectangle(40, 30, 8)) as Part
  assert.ok(bottle.isValid() && bottle.solids().length === 1)
  approx(bottle.bbox().min.x, -20)
  approx(bottle.bbox().max.z, 70)
})

test('swing refuses outlines and profiles it cannot carry', () => {
  const cup = Polygon([0, 0], [30, 0], [30, 40], [0, 40]).on(Plane.front)
  assert.throws(() => swing(cup, Rectangle(10, 10).translate(30, 0)), /once around the Z axis/)
  assert.throws(() => swing(cup, Polygon([10, 0], [0, 10], [-10, 0], [0, -10], [5, 0.5])), /every ray from the Z axis/)
  assert.throws(() => swing(Polygon([0, 0], [30, 0], [30, 40], [0, 40]), Ellipse(30, 20)), /XZ plane/)
  assert.throws(() => swing(Rectangle(10, 10).on(Plane.front), Ellipse(30, 20)), /beside the Z axis/)
  assert.throws(() => swing(cup, Ellipse(30, 20).on(Plane.front)), /parallel to XY/)
  assert.throws(() => swing(cup, Ellipse(30, 20).cut(Circle(5))), /holes/)
  assert.throws(() => swing(cup, Line([0, 0], [1, 1])), /closed curve/)
})

// S13: sectors of the primitives

function faceKinds(p: Part): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of p.faces()) out[f.geomType] = (out[f.geomType] ?? 0) + 1
  return out
}

test('primitives take sectors', () => {
  const q = Cylinder(10, 20, { arcSize: 90 })
  assert.ok(q.isValid())
  approx(q.volume, (PI * 100 * 20) / 4, 1e-9)
  assert.deepEqual(faceKinds(q), { plane: 4, cylinder: 1 })
  // centered by its box like every primitive; align: null keeps the axis on Z
  assert.deepEqual([q.bbox().min.toArray(), q.bbox().max.toArray()].flat().map((x) => +x.toFixed(9) + 0), [-5, -5, -10, 5, 5, 10])
  const onZ = Cylinder(10, 20, { arcSize: 90, align: null })
  assert.deepEqual([onZ.bbox().min.toArray(), onZ.bbox().max.toArray()].flat().map((x) => +x.toFixed(9) + 0), [0, 0, -10, 10, 10, 10])
  const standing = Cylinder(10, 20, { arcSize: 270, align: [Align.CENTER, Align.CENTER, Align.MIN] })
  approx(standing.bbox().min.z, 0)
  approx(standing.volume, PI * 100 * 20 * 0.75, 1e-9)
  // within 0.01 degrees of 360 a whole one (the kernel's sectors there are not closed solids)
  assert.deepEqual(faceKinds(Cylinder(10, 20, { arcSize: 359.995 })), { cylinder: 1, plane: 2 })
  const cone = Cone(10, 5, 20, { arcSize: 90 })
  approx(cone.volume, ((PI * 20) / 3) * (175 / 4), 1e-9)
  assert.deepEqual(faceKinds(cone), { plane: 4, cone: 1 })
  approx(Cone(10, 0, 20, { arcSize: 120 }).volume, ((PI * 20) / 3) * (100 / 3), 1e-6)
  const lune = Sphere(10, { arcSize3: 90, align: null })
  approx(lune.volume, ((4 / 3) * PI * 1000) / 4, 1e-9)
  assert.deepEqual(faceKinds(lune), { plane: 2, sphere: 1 })
  // latitudes: planes parallel to XY
  const z1 = -5
  const z2 = 10 * Math.sin(PI / 3)
  const zone = PI * (100 * z2 - z2 ** 3 / 3 - (100 * z1 - z1 ** 3 / 3))
  const part = Sphere(10, { arcSize1: -30, arcSize2: 60, arcSize3: 90, align: null })
  approx(part.volume, zone / 4, 1e-9)
  assert.deepEqual(faceKinds(part), { plane: 4, sphere: 1 })
  approx(part.bbox().min.z, -5)
  approx(part.bbox().max.z, z2)
  approx(Sphere(10, { arcSize1: 0 }).volume, (2 / 3) * PI * 1000, 1e-9)
  // a torus sector is a torus (the kernel's own is a surface of revolution)
  const ring = Torus(20, 5, { majorAngle: 90, align: null })
  approx(ring.volume, (2 * PI ** 2 * 20 * 25) / 4, 1e-9)
  assert.deepEqual(faceKinds(ring), { plane: 2, torus: 1 })
  const sector = AnnularSector(5, 10, 20, 120, { align: null })
  approx(sector.volume, (PI * 75 * 20) / 3, 1e-6)
  assert.deepEqual(faceKinds(sector), { plane: 4, cylinder: 2 })
  assert.deepEqual([sector.bbox().min.toArray(), sector.bbox().max.toArray()].flat().map((x) => +x.toFixed(9) + 0), [-5, 0, -10, 10, 10, 10])
  const tube = AnnularSector(5, 10, 20, 360)
  approx(tube.volume, PI * 75 * 20, 1e-9)
  assert.deepEqual(faceKinds(tube), { cylinder: 2, plane: 2 })
  approx(AnnularSector(0, 10, 20, 90).volume, q.volume, 1e-12)
  for (const bad of [
    () => Cylinder(10, 20, { arcSize: 0 }),
    () => Cone(5, 2, 3, { arcSize: 400 }),
    () => Sphere(10, { arcSize1: 30, arcSize2: 30 }),
    () => Sphere(10, { arcSize1: -100 }),
    () => Torus(20, 5, { majorAngle: -5 }),
    () => AnnularSector(10, 5, 20, 90),
    () => AnnularSector(5, 10, 20, 0),
  ]) {
    assert.throws(bad, RangeError)
  }
})

// S14: extrusion directions in or near the sketch plane

test('extrude: a direction in the sketch plane throws, near it warns', () => {
  assert.throws(() => Rectangle(10, 10).extrude(5, { direction: [1, 0, 0] }), /lies in the sketch plane/) // (was a bare KernelError, SM_ERR)
  assert.throws(() => Rectangle(10, 10).extrude(5, { direction: [1, 0, 1e-6] }), /lies in the sketch plane/)
  assert.throws(() => Circle(3).on(new Plane([1, 2, 3], null, [1, 1, 1])).extrude(5, { direction: [1, -1, 0], taper: 5 }), /lies in the sketch plane/)
  const [thin, said] = warned(() => Rectangle(10, 10).extrude(5, { direction: [1, 0, 1e-4] }))
  assert.ok(said.length === 1 && /only 0.0005 thick/.test(said[0]), said.join('; '))
  assert.ok(thin.isValid())
  approx(thin.volume, 0.05, 1e-6)
  approx(quiet(() => Rectangle(10, 10).extrude(5, { direction: [1, 0, 1] })).volume, 500 / Math.SQRT2, 1e-9)
})

test('extrusions along a direction are valid or throw', () => {
  // In tilted planes the kernel made some extrusions of curved profiles along a direction inside out or
  // open; they are made again turned about the normal, or throw.
  const fixed = Circle(3).on(new Plane([2.00729845925639, 0, 0], null, [0.9513514554730566, -0.29311120370412086, -0.09495383316337645]))
  const d: P3 = [-0.18315301020251898, -0.7616861581242306, 0.6215216580101659]
  const part = quiet(() => fixed.extrude(5, { direction: d })) // (was inside out: volume -1.41372)
  const sine = Math.abs(new Vector(d).normalized().dot(fixed.plane.zDir))
  assert.ok(part.isValid())
  approx(part.volume, fixed.area * 5 * sine, 1e-9)
  let seed = 7
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648 - 0.5
  }
  for (let i = 0; i < 24; i++) {
    const n: P3 = [random(), random(), random()]
    const sk = [Circle(3), Ellipse(4, 2), Slot(10, 3), Rectangle(6, 4)][i % 4].on(new Plane([i, 0, 0], null, n))
    const t = sk.plane.zDir.cross(new Vector(0.3, 0.5, 0.7)).normalized()
    for (const s of [0.01, 0.1]) {
      const dir = t.mul(Math.sqrt(1 - s * s)).add(sk.plane.zDir.mul(s))
      let p: Part
      try {
        p = sk.extrude(5, { direction: dir })
      } catch (e) {
        if (e instanceof ModelingError) continue
        throw e
      }
      assert.ok(p.isValid())
      approx(p.volume, sk.area * 5 * s, 1e-6)
    }
  }
})
