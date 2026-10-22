// tests/test_lane_S.py: sweeps along closed 3D paths (S1 regressions), faces without area in fused
// sweeps, and planar paths with mitered corners (S2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Circle, Ellipse, FilletPolyline, Line, ModelingError, Plane, Polygon, Polyline, Rectangle, Spline, Wire, sweep, type Part } from '../src/index.ts'
import { ext, setWarningHandler } from '../src/kernel.ts'
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
      assert.ok(sound(quiet(() => sweep(profile, Spline(...pts, pts[0])) as Part)))
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
  // a spline among the edges, the profile turned off the axes: by its box along the path's plane
  const [c, s] = [Math.cos(PI / 6), Math.sin(PI / 6)]
  const wavy = new Wire([Line([0, 0, 0], [20 * c, 20 * s, 0]),
    Spline([20 * c, 20 * s, 0], [30, 25, 0], [50, 30, 0], { tangents: [[c, s, 0], [1, 0, 0]] })])
  const [wavyBody, said] = warned(() => sweep(Polygon(...ODD), wavy) as Part)
  assert.ok(wavyBody.isValid())
  assert.ok(said.length === 1 && said[0].includes('cannot be offset'), said.join('; '))
})
