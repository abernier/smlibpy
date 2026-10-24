// tests/test_closeout_S.py: the close-out of lane S (sweeps, lofts, primitives and curves) of the
// kernel plan's phase 1, what the 0.5.0 release notes listed as not done.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Align,
  Axis,
  Box,
  Circle,
  Cylinder,
  Ellipse,
  Helix,
  Line,
  Location,
  ModelingError,
  Plane,
  Polygon,
  Polyline,
  Pyramid,
  Rectangle,
  RegularPolygon,
  Shell,
  Slot,
  Spline,
  ThreePointArc,
  Torus,
  Vector,
  Vertex,
  Wire,
  Z,
  extrude,
  fitCurve,
  loft,
  makeFace,
  revolve,
  sweep,
  type Edge,
  type Face,
  type Part,
} from '../src/index.ts'
import { setWarningHandler } from '../src/kernel.ts'
import { approx } from './_approx.ts'

type V3 = [number, number, number]
const PI = Math.PI

function quiet<T>(fn: () => T): T {
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    const out = fn()
    assert.deepEqual(said, [])
    return out
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2])
const unit = (a: readonly number[]): V3 => [a[0] / norm(a), a[1] / norm(a), a[2] / norm(a)]
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const along = (p: readonly number[], d: readonly number[], s: number): V3 => [p[0] + s * d[0], p[1] + s * d[1], p[2] + s * d[2]]

/** The smallest rotation that turns direction a into b, applied to v. */
function turn(a: readonly number[], b: readonly number[], v: readonly number[]): V3 {
  const ua = unit(a)
  const ub = unit(b)
  const k = cross(ua, ub)
  const c = dot(ua, ub)
  const kv = cross(k, v)
  const kkv = cross(k, kv)
  return [0, 1, 2].map((i) => v[i] + kv[i] + kkv[i] / (1 + c)) as V3
}

/** The angle (degrees) from line a to line b about axis, from -90 to 90. */
function signed(a: readonly number[], b: readonly number[], axis: readonly number[]): number {
  const pa = sub(a, along([0, 0, 0], axis, dot(a, axis)))
  const pb = sub(b, along([0, 0, 0], axis, dot(b, axis)))
  const ang = (Math.atan2(dot(cross(pa, pb), axis), dot(pa, pb)) * 180) / PI
  return ((((ang + 90) % 180) + 180) % 180) - 90
}

/** The direction of the long side of a rectangle's section through the body near origin. */
function longAxis(body: Part, origin: V3, normal: V3): V3 {
  const s = body.section(new Plane(origin, null, normal))
  const pts = [...s.vertices()].map((v) => v.point.toArray()).filter((p) => norm(sub(p, origin)) < 4)
  let best: V3 = [0, 0, 0]
  let far = -1
  for (const p of pts) {
    for (const q of pts) {
      const d = norm(sub(p, q))
      if (d > far) {
        far = d
        best = unit(sub(q, p))
      }
    }
  }
  // the long side: of the two directions of the rectangle, the one along the longer edge
  const edges = pts.flatMap((p) => pts.map((q) => sub(q, p))).filter((d) => norm(d) > 3.9 && norm(d) < 4.1)
  return edges.length ? unit(edges[0]) : best
}

const off = (face: Face, edge: Edge, n = 40): number => Math.max(...Array.from({ length: n + 1 }, (_, i) => face.distanceTo(edge.pointAt(i / n))))

// -- S2: where the profile sits ----------------------------------------------------------------------
test('sweep anchor puts the named point on the path', () => {
  const tri = Polygon([0, 0], [4, 0], [0, 2])
  const up = Line([0, 0, 0], [0, 0, 30])
  const close = (a: number[], b: number[]) => a.forEach((v, i) => approx(v, b[i], 0, 1e-9))
  close(sweep(tri, up, { anchor: 'origin' }).bbox().min.toArray(), [0, 0, 0])
  close(sweep(tri, up, { anchor: [4, 0] }).bbox().min.toArray(), [-4, 0, 0])
  close(sweep(tri, up, { anchor: new Vertex(0, 2, 0) }).bbox().max.toArray(), [4, 0, 30])
  close(sweep(tri, up).bbox().center.toArray().slice(0, 2), [0, 0])
  const body = sweep(tri, Line([0, 0, 0], [10, 10, 10]), { anchor: 'origin' }) as Part
  assert.ok(body.isValid() && Math.min(...[...body.vertices()].map((v) => v.point.length)) < 1e-9)
  close(sweep(tri.faces()[0], up, { anchor: 'origin' }).bbox().min.toArray(), [0, 0, 0])
  const sheet = sweep(Line([0, 0], [5, 0]), up, { anchor: [5, 0] })
  assert.ok(sheet instanceof Shell)
  close(sheet.bbox().min.toArray(), [-5, 0, 0])
  close(tri.sweep(up, { anchor: 'origin' }).bbox().min.toArray(), [0, 0, 0])
  assert.throws(() => sweep(tri, up, { anchor: [0, 0, 1] }), /off the profile's plane/)
  assert.throws(() => sweep(tri, up, { anchor: 'corner' as 'center' }), /'center', 'origin' or a point/)
})

test('arcs that do not span whole quadrants sit by their own box', () => {
  const a = (40 * PI) / 180
  const p1: V3 = [10 * Math.cos(a), -10 * Math.sin(a), 0]
  const p2: V3 = [10 * Math.cos(a), 10 * Math.sin(a), 0]
  const sector = makeFace(new Wire([Line([0, 0, 0], p1), ThreePointArc(p1, [10, 0, 0], p2), Line(p2, [0, 0, 0])]))
  const side = Math.hypot(10 * Math.cos(a) - 5, 10 * Math.sin(a))
  for (const path of [Polyline([0, 0, 0], [40, 0, 0], [40, 40, 0]), Spline([0, 0, 0], [20, 5, 8], [40, 0, 20]), Polyline([0, 0, 0], [40, 0, 0], [40, 40, 30])]) {
    const body = quiet(() => sweep(sector, path) as Part)
    const st = path.pointAt(0)
    const cap = [...body.faces()].filter(
      (f) => f.geomType === 'plane' && f.distanceTo(st) < 1e-6 && Math.abs(Math.abs(f.normalAt().dot(path.tangentAt(0))) - 1) < 1e-6,
    )[0]
    const ds = [...cap.vertices()].map((v) => v.point.sub(st).length).sort((x, y) => x - y)
    ;[5, side, side].forEach((d, i) => approx(ds[i], d, 0, 1e-6))
  }
})

// -- S3, S7: the profile's attitude and size along the path -------------------------------------------
test('the profile meets itself where a loop with corners closes', () => {
  const vs: V3[] = [
    [0, 0, 0],
    [40, 0, 0],
    [40, 30, 25],
    [10, 40, -10],
  ]
  const n = vs.length
  const ts = vs.map((v, i) => unit(sub(vs[(i + 1) % n], v)))
  const lens = vs.map((v, i) => norm(sub(vs[(i + 1) % n], v)))
  const total = lens.reduce((x, y) => x + y)
  const x0 = cross(ts[0], [0, 0, 1])
  let x = x0
  for (let i = 0; i < n; i++) x = turn(ts[i], ts[(i + 1) % n], x)
  const gain = signed(x0, x, ts[0])
  approx(gain, -8.5064, 0, 1e-3)
  const body = sweep(Rectangle(4, 1), Polyline(...vs, { close: true })) as Part
  assert.ok(body.isValid())
  const first = longAxis(body, along(vs[0], ts[0], 0.5 * lens[0]), ts[0])
  const last = longAxis(body, along(vs[n - 1], ts[n - 1], 0.5 * lens[n - 1]), ts[n - 1])
  let carried = first
  for (let i = 0; i < n - 1; i++) carried = turn(ts[i], ts[i + 1], carried)
  const turned = signed(carried, last, ts[n - 1])
  const closing = signed(turn(ts[n - 1], ts[0], last), first, ts[0])
  const share = (total - 0.5 * lens[0] - 0.5 * lens[n - 1]) / total
  approx(turned + closing, -gain, 0, 1e-3)
  approx(turned, -gain * share, 0, 1e-3)
})

test('frenet raises where the profile would spin', () => {
  const pts: V3[] = []
  for (let i = 0; i < 5; i++) {
    const t = (PI * i) / 4
    pts.push([10 * Math.cos(t), 10 * Math.sin(t), 3 * t])
  }
  for (let i = 1; i < 5; i++) {
    const t = (PI * i) / 4
    pts.push([-10 - 10 * (1 - Math.cos(t)), -10 * Math.sin(t) * 0.999 + 0.001 * t, 3 * PI + 3 * t])
  }
  const path = Spline(...pts)
  assert.throws(() => sweep(Rectangle(4, 1), path, { up: 'frenet' }), /would spin about the path.*nearly straightens.*pick up a direction/)
  approx((sweep(Rectangle(4, 1), path, { up: Z }) as Part).volume, 4 * path.length, 1e-5)
})

test('scale laws hold along paths not parameterized by length', () => {
  const path = Spline([0, 0, 0], [1, 0, 0.5], [2, 0, 3], [10, 0, 20], [11, 3, 40], [30, 10, 41], [60, 0, 42])
  const body = sweep(Circle(1), path, { scale: [1, 3] }) as Part
  approx(body.volume, (PI * path.length * 13) / 3, 1e-7)
  let worst = 0
  for (let i = 1; i < 20; i++) {
    const f = i / 20
    const p = path.pointAt(f)
    const s = body.section(new Plane(p, null, path.tangentAt(f)))
    let r = 0
    for (const e of s.edges()) for (let j = 0; j <= 16; j++) {
      const d = e.pointAt(j / 16).sub(p).length
      if (d < 6) r = Math.max(r, d)
    }
    worst = Math.max(worst, Math.abs(r / (1 + 2 * f) - 1))
  }
  assert.ok(worst < 1e-5, `${worst}`)
})

// -- S8, S14: extrusions ------------------------------------------------------------------------------
test('taper takes a direction only along the normal', () => {
  assert.throws(() => Rectangle(10, 10).extrude(10, { taper: 5, direction: [1, 0, 1] }), /taper drafts the walls about the sketch normal/)
  const down = Rectangle(10, 10).extrude(10, { taper: 5, direction: [0, 0, -1] })
  approx(down.bbox().min.z, -10)
  approx(down.bbox().max.z, 0, 0, 1e-9)
  approx(down.volume, Rectangle(10, 10).extrude(10, { taper: 5 }).volume, 1e-9)
  assert.throws(() => extrude(Line([0, 0], [10, 0]), 5, { taper: 3 }), /open curve extrudes into a surface without a taper/)
})

test('oblique extrusions have plane walls', () => {
  const box = Rectangle(6, 4).extrude(5, { direction: [1, 0, 1] })
  assert.deepEqual([...box.faces()].map((f) => f.geomType), Array(6).fill('plane'))
  approx(box.volume, (24 * 5) / Math.SQRT2, 1e-9)
  const rod = Circle(3).extrude(5, { direction: [1, 0, 1] })
  assert.ok(rod.isValid())
  approx(rod.volume, (PI * 9 * 5) / Math.SQRT2, 1e-9)
})

test('extrusions close to tilted planes', () => {
  const planes: [V3, number, number][] = [
    [[-0.4092125194607695, 0.5336648914993783, 0.7400992484103236], -45.580993887045665, 3],
    [[0.6566440081552222, -0.43021580526965747, -0.6194618692462229], 0.5332129978121927, 0],
    [[0.08448912113948805, 0.5837642235746501, 0.8075152752012575], 33.769686371829195, 0],
    [[-0.46283758231099925, 0.5261490826361928, 0.7134062764243119], -38.026947581629074, 0],
  ]
  setWarningHandler(() => {}) // (the thin-body warning below a sine of 1e-3)
  try {
    for (const [nz, ox, kind] of planes) {
      const sk = [Circle(3), Rectangle(6, 4), RegularPolygon(5, 6), Ellipse(4, 2), Slot(10, 3)][kind].on(new Plane([ox, 0, 0], null, nz))
      const n = sk.plane.zDir
      const t = n.cross(new Vector(0.3, 0.5, 0.7)).normalized()
      for (const s of [1e-3, 0.01]) {
        for (const both of [false, true]) {
          const p = sk.extrude(5, { direction: t.mul(Math.sqrt(1 - s * s)).add(n.mul(s)), both })
          assert.ok(p.isValid())
          approx(p.volume, sk.area * 5 * s * (both ? 2 : 1), 1e-6)
        }
      }
    }
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
})

// -- S10: rails and tangency to faces ----------------------------------------------------------------
test('lofts along rails pass through them', () => {
  const r1 = Spline([0, 0, 0], [-2, 10, 1], [0, 20, 0])
  const r2 = Spline([20, 0, 0], [24, 10, 2], [20, 20, 0])
  const secs = [0, 0.3, 0.7, 1].map((t) =>
    ThreePointArc(r1.pointAt(t), r1.pointAt(t).add(r2.pointAt(t)).mul(0.5).add(new Vector(0, 0, 3 + 2 * t)), r2.pointAt(t)),
  )
  const sheet = loft(secs, { rails: [r1, r2] }) as Shell
  assert.ok(sheet instanceof Shell && sheet.faces().length === 1)
  let f = sheet.faces()[0]
  for (const e of [r1, r2, ...secs]) assert.ok(off(f, e) < 1e-6)
  const mid = Spline(...secs.map((s) => s.pointAt(0.5)))
  f = (loft(secs, { rails: mid }) as Shell).faces()[0]
  assert.ok(off(f, mid) < 1e-6 && secs.every((s) => off(f, s) < 1e-6))
  f = (loft(secs, { rails: [r1.extend(5, { end: 'both' }).reversed(), r2] }) as Shell).faces()[0]
  assert.ok(off(f, r1) < 1e-6)
  approx(f.area, sheet.area, 1e-6)
  assert.throws(() => loft([Circle(10), Circle(6).moved(new Location([0, 0, 20]))], { rails: Spline([10, 0, 0], [7, 0, 10], [6, 0, 20]) }), /open sections/)
  assert.throws(() => loft(secs, { rails: [r1, r2], ruled: true }), /takes no ruled/)
  assert.throws(() => loft(secs, { rails: [r1.translate(0, 0, 5), r2] }), /do not cross/)
  const kinked = [Line([0, 0, 0], [10, 0, 0]), Line([-2, 0, 10], [10, 0, 10]), Line([0, 0, 20], [10, 0, 20])]
  assert.throws(
    () => loft(kinked, { rails: [Polyline([0, 0, 0], [-2, 0, 10], [0, 0, 20]), Line([10, 0, 0], [10, 0, 20])] }),
    (e: unknown) => e instanceof ModelingError && /must be smooth curves/.test(e.message),
  )
})

test('sweeps along two rails keep the profile on both', () => {
  const left = Spline([0, 0, 0], [2, 15, 1], [0, 30, 0])
  const right = Spline([20, 0, 0], [26, 15, 3], [22, 30, 0])
  const arc = ThreePointArc([0, 0, 0], [10, 0, 4], [20, 0, 0])
  const hood = sweep(arc, left, { rails: right }) as Shell
  assert.ok(hood instanceof Shell && hood.faces().length === 1)
  const f = hood.faces()[0]
  assert.ok(off(f, left) < 1e-6 && off(f, right) < 1e-6 && off(f, arc) < 1e-6)
  approx((sweep(arc.reversed(), left, { rails: right }) as Shell).area, hood.area, 1e-9)
  approx((sweep(arc, Line([0, 0, 0], [0, 30, 0]), { rails: Line([20, 0, 0], [20, 30, 0]) }) as Shell).area, arc.length * 30, 1e-7)
  const wide = sweep(arc, Line([0, 0, 0], [0, 30, 0]), { rails: Line([20, 0, 0], [40, 30, 0]) }) as Shell
  const end = [...wide.edges()].sort((a, b) => b.center().y - a.center().y)[0]
  approx(end.length, 2 * arc.length, 1e-6)
  assert.throws(() => sweep(arc, left, { rails: right, twist: 10 }), /takes no orient/)
  assert.throws(() => sweep(Circle(3), left, { rails: right }), /open profile/)
  assert.throws(() => sweep(Line([0, 0, 5], [20, 0, 5]), left, { rails: right }), /from the path to the rail/)
  assert.throws(() => sweep(arc, left, { rails: [right, right] as unknown as Edge }), /one curve/)
})

test('lofts continue a face they start or end on', () => {
  const can = Cylinder(10, 20)
  const rim = [...can.edges()].filter((e) => e.geomType === 'circle').sort((a, b) => b.center().z - a.center().z)[0]
  const wall = can.faces().cylinders()
  const neck = loft([rim, Circle(4).moved(new Location([0, 0, 30]))], { startTangent: wall }) as Part
  assert.ok(neck.isValid())
  approx(neck.volume, 4264.351743, 1e-6)
  const side = [...neck.faces()].sort((a, b) => b.area - a.area)[0]
  for (let i = 0; i < 8; i++) {
    const a = (2 * PI * i) / 8
    const p = new Vector(10 * Math.cos(a), 10 * Math.sin(a), 10)
    assert.ok(side.normalAt(side.closestPoint(p)).angleTo([Math.cos(a), Math.sin(a), 0]) < 1e-4)
  }
  const plate = Box(40, 40, 2).translate(0, 0, 31).cut(Cylinder(4, 2).translate(0, 0, 31))
  const bore = plate.faces().cylinders()[0]
  const lip = [...bore.edges()].filter((e) => e.geomType === 'circle').sort((a, b) => a.center().z - b.center().z)[0]
  const funnel = loft([Circle(10), lip], { endTangent: bore }) as Part
  assert.ok(funnel.isValid())
  approx(funnel.volume, (loft([Circle(10), lip], { endTangent: Z }) as Part).volume, 1e-9)
  const vase = (revolve(Spline([10, 0, 0], [14, 0, 8], [9, 0, 16], [11, 0, 24]), Axis.Z, 360) as Shell).faces()[0]
  const top = [...vase.edges()].filter((e) => e.isClosed).sort((a, b) => b.bbox().center.z - a.bbox().center.z)[0]
  const spout = loft([top, Circle(5).moved(new Location([0, 0, 40]))], { startTangent: vase }) as Part
  const wallOfSpout = [...spout.faces()].sort((a, b) => b.area - a.area)[0]
  for (let i = 0; i < 8; i++) {
    const p = top.pointAt((i + 0.37) / 8)
    assert.ok(wallOfSpout.normalAt(wallOfSpout.closestPoint(p)).angleTo(vase.normalAt(vase.closestPoint(p))) < 0.06)
  }
  assert.throws(() => loft([Circle(9), Circle(4).moved(new Location([0, 0, 30]))], { startTangent: wall }), /must lie on it/)
})

// -- S13: primitives ----------------------------------------------------------------------------------
test('torus keeps part of its tube', () => {
  const half = Torus(20, 5, { minorStartAngle: 0, minorEndAngle: 180 })
  assert.ok(half.isValid())
  approx(half.volume, (2 * PI * 20 * PI * 25) / 2, 1e-9)
  assert.deepEqual([...half.faces()].map((f) => f.geomType).sort(), ['plane', 'torus'])
  const bead = Torus(20, 5, { minorStartAngle: -90, minorEndAngle: 90 })
  approx(bead.volume, (2 * PI * (20 + 20 / (3 * PI)) * PI * 25) / 2, 1e-9)
  assert.deepEqual([...bead.faces()].map((f) => f.geomType).sort(), ['cylinder', 'torus'])
  const wedge = Torus(20, 5, { minorStartAngle: 30, minorEndAngle: 120, majorAngle: 90 })
  assert.ok(wedge.isValid() && [...wedge.faces()].some((f) => f.geomType === 'cone'))
  approx(Torus(20, 5, { minorStartAngle: 10, minorEndAngle: 370 }).volume, Torus(20, 5).volume, 1e-9)
  assert.throws(() => Torus(20, 5, { minorStartAngle: 90, minorEndAngle: 90 }), /minorEndAngle/)
})

test('pyramid', () => {
  const p = Pyramid(10, 6, 8)
  assert.ok(p.isValid())
  approx(p.volume, (10 * 6 * 8) / 3, 1e-9)
  assert.deepEqual([...p.faces()].map((f) => f.geomType), Array(5).fill('plane'))
  ;[-5, -3, -4].forEach((v, i) => approx(p.bbox().min.toArray()[i], v))
  ;[5, 3, 4].forEach((v, i) => approx(p.bbox().max.toArray()[i], v))
  approx(Pyramid(10, 6, 8, { align: [Align.CENTER, Align.CENTER, Align.MIN] }).bbox().min.z, 0, 0, 1e-9)
  assert.throws(() => Pyramid(10, 0, 8), /positive/)
})

// -- C4, C7, C8, C12: curves --------------------------------------------------------------------------
test('long helix sweeps with the kernel frame', () => {
  const h = Helix(3, 240, 20) // (80 turns)
  const body = sweep(Circle(1.2).on(new Plane(h.pointAt(0), null, h.tangentAt(0))), h, { orient: false }) as Part
  assert.ok(body.isValid())
  approx(body.volume, PI * 1.44 * h.length, 2e-4) // (the kernel's frame sweep approximates the surface: 8.6e-5 of the volume here)
})

test('closed edges with a corner offset into one closed edge', () => {
  const pts: [number, number][] = [
    [0, 0],
    [20, 0],
    [25, 15],
    [5, 20],
  ]
  const e = Spline(...pts, pts[0])
  for (const [o, length] of [
    [e.offset(1), 88.155147],
    [e.offset(-1), 75.427285],
  ] as [Edge, number][]) {
    assert.ok(o.isClosed)
    approx(o.length, length, 0, 1e-5)
    approx(Math.min(...Array.from({ length: 51 }, (_, i) => o.distanceTo(e.pointAt(i / 50)))), 1, 0, 1e-4)
  }
})

test('fit curve takes a direction at every point', () => {
  const ts = Array.from({ length: 400 }, (_, i) => (4 * PI * i) / 399)
  const pts = ts.map((t) => [t * 5, 10 * Math.sin(t), 0] as V3)
  const dirs = ts.map((t) => [5, 10 * Math.cos(t), 0] as V3)
  const coarse = fitCurve(pts, { tolerance: 0.05, tangents: dirs })
  const fine = fitCurve(pts, { tolerance: 0.005, tangents: dirs })
  assert.ok(Math.max(...pts.map((p) => coarse.distanceTo(p))) <= 0.05 && Math.max(...pts.map((p) => fine.distanceTo(p))) <= 0.005)
  const nc = coarse.nurbs().points.length
  const nf = fine.nurbs().points.length
  assert.ok(nc < nf && nf < 100, `${nc} ${nf}`)
  const dev = (c: Edge): number =>
    Math.max(...pts.filter((_, i) => i % 10 === 0).map((p, i) => c.tangentAt(c.paramAtPoint(p)).angleTo(dirs[i * 10])))
  assert.ok(dev(fine) < 0.1 && dev(coarse) > 0.1)
  assert.throws(() => fitCurve(pts.slice(0, 4), { tangents: [[1, 0], null, [1, 0], [1, 0]] as unknown as V3[] }), /tangent 2 is null/)
  assert.throws(() => fitCurve(pts.slice(0, -1), { closed: true, tangents: dirs.slice(0, -1) }), /closed curve takes no end tangents/)
})

test('curves across a closed face seam come back whole', () => {
  const cyl = Cylinder(10, 40)
  const wall = cyl.faces().cylinders()[0]
  for (const at of [
    [10, 0, 0],
    [0, -10, 0],
  ] as V3[]) {
    const line = wall.wrap(Line([-20, 0], [20, 0]), at)
    const ring = wall.wrap(Circle(5), at)
    assert.equal(line.length, 1)
    approx(line[0].length, 40, 0, 1e-5)
    assert.ok(ring.length === 1 && ring[0].isClosed)
    approx(ring[0].length, 10 * PI, 1e-6)
  }
  const across = Spline([12, -5, 10], [12, 0, 12], [12, 5, 14])
  assert.deepEqual([...wall.project(across)].map((e) => Math.round(e.length * 1e5) / 1e5), [8.85288])
  assert.deepEqual([...cyl.project(across, [-1, 0, 0], { nearest: true })].map((e) => Math.round(e.length * 1e5) / 1e5), [11.21102])
})

test('nearest projections find obstacles between their samples', () => {
  const part = Box(100, 20, 2).fuse(Box(1, 1, 8).translate(3, 9.5, 5)).fuse(Box(1, 20, 1).translate(3, 0, 8.5))
  const got = part.project(Line([-50, 0, 20], [50, 0, 20]), [0, 0, -1], { nearest: true })
  const spans = [...got].map((e) => [Math.min(e.start.x, e.end.x), Math.max(e.start.x, e.end.x), e.start.z]).sort((a, b) => a[0] - b[0])
  const want = [
    [-50, 2.5, 1],
    [2.5, 3.5, 9],
    [3.5, 50, 1],
  ]
  assert.equal(spans.length, 3)
  spans.forEach((s, i) => s.forEach((v, j) => approx(v, want[i][j], 0, 1e-4)))
})
