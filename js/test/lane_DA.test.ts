// tests/test_lane_DA.py: measuring and analysis, and per-bend K-factors (kernel plan items A2-A7,
// D1): nearest points and closest points, curvature, NURBS data and iso curves of faces, continuity
// of edges and wires, section properties, inertia about points and axes, the integration's budget,
// K-factors per bend. D2-D4: analytic faces of deformed parts (a bent plate is sheet metal), unroll,
// unfolding rolled parts, curls and bends over 180 degrees, volumes of deformed parts. D5: holes
// across bends in the flat pattern. D6: edges, wires and points deform. D7: a lattice moves the
// whole box.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KernelError, ext } from '../src/kernel.ts'
import {
  Align,
  Axis,
  Box,
  CenterArc,
  Circle,
  Cone,
  Cylinder,
  Ellipse,
  Helix,
  Line,
  Part,
  Plane,
  Polyline,
  Rectangle,
  Sphere,
  Spline,
  Torus,
  Vector,
  Wire,
  X,
  Y,
  Z,
  flange,
  flatPattern,
  fold,
  stitch,
  surface,
  unfold,
  type Face,
  type NurbsSurface,
  type VectorLike,
} from '../src/index.ts'
import { bends, din6935 } from '../src/sheetmetal.ts'
import { Lattice, ModelingError, bendAllowance, fromStep, toStep, unroll } from '../src/index.ts'
import { Edge, bend, makeFace, taper, twist as twistShape } from '../src/index.ts'
import { MAX_DEGREE, _planBend } from '../src/deformations.ts'
import { k } from '../src/kernel.ts'
import { approx } from './_approx.ts'

function near(actual: number, expected: number, tol: number): void {
  approx(actual, expected, 0, tol)
}

function raises(fn: () => unknown, kind: abstract new (...args: never[]) => Error, pattern: RegExp): void {
  assert.throws(fn, (e: unknown) => e instanceof kind && pattern.test((e as Error).message))
}

const cone = () => Cone(10, 4, 20).faces().filterBy((f: Face) => f.geomType === 'cone')[0]

// -- A6: inertia about a point or an axis ----------------------------------------------------------
test('inertia about a corner and an axis', () => {
  const [a, b, c] = [10, 20, 30]
  const mp = Box(a, b, c).massProperties(2.0)
  const m = 2.0 * a * b * c
  const corner: VectorLike = [a / 2, b / 2, c / 2]
  const i = mp.inertiaAbout(corner)
  approx(i[0][0], (m * (b * b + c * c)) / 3, 1e-9)
  approx(i[2][2], (m * (a * a + b * b)) / 3, 1e-9)
  approx(i[0][1], (-m * a * b) / 4, 1e-9)
  const atCenter = mp.inertiaAbout(mp.center)
  const scale = Math.max(...mp.inertia.flat().map(Math.abs))
  for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) near(atCenter[r][s], mp.inertia[r][s], 1e-6 * scale)
  approx(mp.momentAbout(new Axis(corner, [0, 0, 1])), (m * (a * a + b * b)) / 3, 1e-9)
  approx(mp.momentAbout(new Axis([a / 2, b / 2, -100], [0, 0, -1])), (m * (a * a + b * b)) / 3, 1e-9)
  approx(mp.momentAbout(new Axis([0, 0, 0], [1, 1, 0])), (mp.inertia[0][0] + mp.inertia[1][1] + 2 * mp.inertia[0][1]) / 2, 1e-9)
  raises(() => mp.momentAbout([0, 0, 1] as never), TypeError, /Axis/)
})

test('radii of gyration', () => {
  const mp = Cylinder(10, 100).massProperties(7.85e-3)
  const k = mp.radiiOfGyration
  approx(k[0], 10 / Math.sqrt(2), 1e-9)
  approx(k[1], Math.sqrt((3 * 10 ** 2 + 100 ** 2) / 12), 1e-9)
  mp.principalMoments.forEach((x, j) => approx(k[j], Math.sqrt(x / mp.mass), 1e-15))
})

// -- A5: section properties ----------------------------------------------------------------------
test('section properties of a rectangle and a plate with a hole', () => {
  let sp = Rectangle(40, 20).sectionProperties()
  approx(sp.area, 800, 1e-12)
  approx(sp.ixx, (40 * 20 ** 3) / 12, 1e-9)
  approx(sp.iyy, (20 * 40 ** 3) / 12, 1e-9)
  assert.ok(Math.abs(sp.ixy) <= 1e-9 * sp.iyy)
  approx(sp.polar, sp.ixx + sp.iyy)
  approx(sp.sectionModuli[0], (40 * 20 ** 2) / 6, 1e-9)
  approx(sp.sectionModuli[1], (20 * 40 ** 2) / 6, 1e-9)
  approx(sp.radiiOfGyration[0], 20 / Math.sqrt(12), 1e-9)
  approx(sp.principalMoments[0], sp.ixx, 1e-9)
  near(Math.abs(sp.principalAxes[0].dot(X.direction)), 1, 1e-9)
  const plane = new Plane([5, 6, 7], [0, 1, 0], [1, 0, 0])
  sp = Rectangle(40, 20).cut(Circle(5)).on(plane).sectionProperties()
  approx(sp.area, 800 - 25 * Math.PI, 1e-10)
  approx(sp.ixx, (40 * 20 ** 3) / 12 - (Math.PI * 5 ** 4) / 4, 1e-9)
  approx(sp.iyy, (20 * 40 ** 3) / 12 - (Math.PI * 5 ** 4) / 4, 1e-9)
  assert.ok(sp.centroid.sub([5, 6, 7]).length <= 1e-9)
  assert.ok(sp.plane.xDir.isClose([0, 1, 0]) && sp.plane.zDir.isClose([1, 0, 0]))
})

test('section properties of an angle', () => {
  const sp = Rectangle(30, 5, { align: [Align.MIN, Align.MIN] }).fuse(Rectangle(5, 40, { align: [Align.MIN, Align.MIN] })).sectionProperties()
  const parts = [[30 * 5, 15, 2.5, 30, 5], [5 * 35, 2.5, 22.5, 5, 35]]
  const area = parts.reduce((s, p) => s + p[0], 0)
  const cx = parts.reduce((s, p) => s + p[0] * p[1], 0) / area
  const cy = parts.reduce((s, p) => s + p[0] * p[2], 0) / area
  const ixx = parts.reduce((s, [a, , y, w, h]) => s + (w * h ** 3) / 12 + a * (y - cy) ** 2, 0)
  const iyy = parts.reduce((s, [a, x, , w, h]) => s + (h * w ** 3) / 12 + a * (x - cx) ** 2, 0)
  const ixy = parts.reduce((s, [a, x, y]) => s + a * (x - cx) * (y - cy), 0)
  approx(sp.area, area, 1e-12)
  assert.ok(sp.centroid.sub([cx, cy, 0]).length <= 1e-9)
  approx(sp.ixx, ixx, 1e-9)
  approx(sp.iyy, iyy, 1e-9)
  approx(sp.ixy, ixy, 1e-9)
  const [lo, hi] = sp.principalMoments
  approx(lo + hi, ixx + iyy, 1e-12)
  approx(lo * hi, ixx * iyy - ixy ** 2, 1e-9)
  const [u, v] = sp.principalAxes
  approx(u.x * (sp.ixx * u.x - sp.ixy * u.y) + u.y * (-sp.ixy * u.x + sp.iyy * u.y), lo, 1e-9)
  near(u.dot(v), 0, 1e-12)
  approx(sp.sectionModuli[0], ixx / (40 - cy), 1e-9)
  approx(sp.sectionModuli[1], iyy / (30 - cx), 1e-9)
  raises(() => Rectangle(10, 10).cut(Rectangle(20, 20)).sectionProperties(), RangeError, /empty/)
})

// -- A2: closest points ----------------------------------------------------------------------------
test('closest points of two bodies with their faces', () => {
  const a = Box(10, 10, 10)
  const b = Sphere(3).translate(20, 0, 0)
  const cp = a.closestPoints(b)
  near(cp.distance, 12.0, 1e-12)
  assert.equal(cp.distance, a.distanceTo(b))
  assert.ok(cp.point.sub([5, 0, 0]).length <= 1e-9 && cp.otherPoint.sub([17, 0, 0]).length <= 1e-9)
  assert.ok(cp.face!.geomType === 'plane' && cp.face!.normalAt().isClose([1, 0, 0]))
  assert.ok(cp.otherFace!.geomType === 'sphere' && cp.otherFace!.owner === b)
  const back = b.closestPoints(a)
  assert.ok(back.point.sub(cp.otherPoint).length <= 1e-9 && back.face!.owner === b)
  const c = Cylinder(5, 200)
  const d = Cylinder(5, 200).rotate(X, 5).translate(12, 0, 0)
  const cq = c.closestPoints(d)
  near(cq.distance, 2.0, 1e-9)
  assert.ok(c.distanceTo(cq.point) <= 1e-9 && d.distanceTo(cq.otherPoint) <= 1e-9)
  near(cq.point.sub(cq.otherPoint).length, cq.distance, 1e-12)
})

test('distances to edges, wires and faces', () => {
  const box = Box(10, 10, 10)
  const line = Line([20, -50, 3], [20, 50, 3])
  const cp = box.closestPoints(line)
  near(cp.distance, 15, 1e-12)
  assert.equal(cp.otherFace, null)
  approx(cp.point.x, 5)
  approx(cp.otherPoint.x, 20)
  assert.ok(cp.face!.normalAt().isClose([1, 0, 0]))
  approx(box.distanceTo(line), 15)
  approx(line.distanceTo(box), 15)
  assert.equal(box.distanceTo(Line([0, 0, -20], [0, 0, 20])), 0)
  const rod = Cylinder(5, 20)
  const cr = rod.closestPoints(Line([-50, 10, 5], [50, 10, 5]))
  near(cr.distance, 5, 1e-12)
  assert.equal(cr.face!.geomType, 'cylinder')
  assert.ok(cr.point.sub([0, 5, 5]).length <= 1e-9)
  const w = Polyline([20, 0, 20], [20, 0, -20], [-20, 0, -20])
  approx(box.distanceTo(w), 15)
  approx(w.distanceTo(box), 15)
  const helix = Helix(2, 30, 8).translate(0, 0, -15)
  const ball5 = Sphere(5)
  let brute = Infinity
  for (let i = 0; i <= 300; i++) brute = Math.min(brute, ball5.distanceTo(helix.pointAt(i / 300)))
  const d = ball5.distanceTo(helix)
  near(d, 3.0, 1e-5)
  assert.ok(d <= brute + 1e-12)
  const top = Box(40, 30, 20).cut(Cylinder(6, 30)).faces().top()[0]
  const ball = Sphere(2).translate(0, 0, 30)
  const cf = ball.closestPoints(top)
  approx(cf.distance, Math.hypot(6, 20) - 2, 1e-12)
  assert.equal(cf.otherFace, top)
  approx(top.distanceTo(ball), cf.distance)
  approx(Math.hypot(cf.otherPoint.x, cf.otherPoint.y), 6)
  approx(cf.otherPoint.z, 10)
})

test('closest points and parameters on faces, edges and wires', () => {
  const part = Box(40, 30, 20).cut(Cylinder(6, 30))
  const bore = part.faces().cylinders()[0]
  assert.ok(bore.closestPoint([0, 0, 0]).sub([6, 0, 0]).length <= 1e-12)
  const top = part.faces().top()[0]
  assert.ok(top.closestPoint([0, 0, 20]).sub([6, 0, 10]).length <= 1e-12)
  for (const p of [[3, 4, 25], [-17, 9, 30], [100, -3, 0]] as VectorLike[]) {
    const [u, v] = top.uvAt(p)
    assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1)
    assert.ok(top.positionAt(u, v).sub(top.closestPoint(p)).length <= 1e-9)
  }
  const [u, v] = bore.uvAt([0, 6, 3])
  assert.ok(bore.positionAt(u, v).sub([0, 6, 3]).length <= 1e-9)
  const circle = part.edges().circles()[0]
  assert.ok(circle.closestPoint([0, 0, 0]).sub([6, 0, circle.start.z]).length <= 1e-12)
  for (const t of [0.0, 0.3, 0.77]) near(circle.paramAtPoint(circle.pointAt(t)), t, 1e-9)
  const spline = Spline([0, 0, 0], [10, 5, 0], [20, 0, 0], [30, -5, 0])
  for (const t of [0.1, 0.5, 0.77]) {
    near(spline.paramAtPoint(spline.pointAt(t).add([0, 0, 1])), t, 1e-9)
    near(spline.reversed().paramAtPoint(spline.pointAt(t)), 1 - t, 1e-9)
  }
  const line = Line([0, 0, 0], [10, 0, 0])
  approx(line.paramAtPoint([3, 5, 0]), 0.3)
  approx(line.reversed().paramAtPoint([3, 5, 0]), 0.7)
  assert.equal(line.paramAtPoint([-5, 1, 0]), 0)
  assert.equal(line.paramAtPoint([50, 1, 0]), 1)
  const w = new Wire([Line([0, 0, 0], [10, 0, 0]), Line([10, 0, 0], [10, 10, 0])])
  assert.ok(w.closestPoint([12, 5, 3]).sub([10, 5, 0]).length <= 1e-12)
})

// -- A3: curvature and surface access ---------------------------------------------------------------
test('curvature of analytic faces', () => {
  const ball = Sphere(10).faces()[0]
  for (const p of [[20, 0, 0], [0, 0, 20], [3, -4, 5]] as [number, number, number][]) {
    const c = ball.curvatureAt(p)
    approx(c.k1, 0.1, 1e-12)
    approx(c.k2, 0.1, 1e-12)
    approx(c.mean, 0.1)
    approx(c.gaussian, 0.01)
    assert.ok(c.normal.isClose(new Vector(p).normalized(), 1e-9))
    assert.ok(Math.abs(c.dir1.dot(c.normal)) <= 1e-9 && Math.abs(c.dir2.dot(c.normal)) <= 1e-9)
  }
  const side = Cylinder(5, 20).faces().cylinders()[0]
  const c = side.curvatureAt([10, 0, 3])
  near(c.k1, 0.2, 1e-12)
  near(c.k2, 0, 1e-12)
  assert.ok(Math.abs(c.dir1.dot(Z.direction)) <= 1e-12)
  approx(Math.abs(c.dir2.dot(Z.direction)), 1)
  assert.ok(c.point.isClose([5, 0, 3]) && c.normal.isClose([1, 0, 0]))
  const bore = Box(40, 30, 20).cut(Cylinder(6, 30)).faces().cylinders()[0].curvatureAt()
  near(bore.k1, 0, 1e-12)
  near(bore.k2, -1 / 6, 1e-12)
  const torus = Torus(20, 5).faces()[0]
  const outer = torus.curvatureAt([30, 0, 0])
  const inner = torus.curvatureAt([0, 10, 0])
  approx(outer.k1, 0.2, 1e-12)
  approx(outer.k2, 1 / 25, 1e-12)
  approx(inner.k1, 0.2, 1e-12)
  approx(inner.k2, -1 / 15, 1e-12)
  assert.equal(torus.radius, 5)
  assert.equal(torus.majorRadius, 20)
  approx(cone().coneAngle, (Math.atan(6 / 20) * 180) / Math.PI, 1e-12)
  raises(() => side.majorRadius, RangeError, /major radius/)
  raises(() => side.coneAngle, RangeError, /cone angle/)
})

test('min radius', () => {
  assert.equal(Box(1, 1, 1).faces()[0].minRadius(), Infinity)
  assert.equal(Cylinder(5, 20).faces().cylinders()[0].minRadius(), 5)
  assert.equal(Sphere(10).faces()[0].minRadius(), 10)
  approx(Torus(20, 5).faces()[0].minRadius(), 5, 1e-12)
  approx(Torus(6, 5).faces()[0].minRadius(), 1, 1e-9)
  approx(cone().minRadius(), 4 / Math.cos(Math.atan(6 / 20)), 1e-9)
  const pts: [number, number, number][][] = []
  for (let i = 0; i < 12; i++) {
    const row: [number, number, number][] = []
    for (let j = 0; j < 12; j++) {
      const x = (60 * i) / 11
      const y = (60 * j) / 11
      row.push([x, y, 3 * Math.sin(x / 7) * Math.cos(y / 9)])
    }
    pts.push(row)
  }
  const face = surface(pts).faces()[0]
  const r = face.minRadius()
  let sampled = Infinity
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 40; j++) {
      const c = face.curvatureAt(face.positionAt(i / 40, j / 40))
      sampled = Math.min(sampled, 1 / Math.max(Math.abs(c.k1), Math.abs(c.k2)))
    }
  }
  assert.ok(r <= sampled * (1 + 1e-9) && r >= 0.95 * sampled, `${r} against ${sampled}`)
})

/** A point of a NURBS surface (Cox-de Boor), to check the layout of Face.nurbs(). */
function nurbsPoint(n: NurbsSurface, u: number, v: number): Vector {
  const basis = (knots: number[], p: number, t: number): number[] => {
    const last = t >= knots[knots.length - 1]
    let b: number[] = knots.slice(0, -1).map((_, i) =>
      (knots[i] <= t && t < knots[i + 1]) || (last && knots[i] < knots[i + 1] && knots[i + 1] === knots[knots.length - 1]) ? 1 : 0)
    for (let d = 1; d <= p; d++) {
      const next: number[] = []
      for (let i = 0; i < knots.length - d - 1; i++) {
        const a = knots[i + d] > knots[i] ? ((t - knots[i]) / (knots[i + d] - knots[i])) * b[i] : 0
        const c = knots[i + d + 1] > knots[i + 1] ? ((knots[i + d + 1] - t) / (knots[i + d + 1] - knots[i + 1])) * b[i + 1] : 0
        next.push(a + c)
      }
      b = next
    }
    return b
  }
  const bu = basis(n.knots[0], n.degrees[0], u)
  const bv = basis(n.knots[1], n.degrees[1], v)
  let s = new Vector()
  let w = 0
  bu.forEach((a, i) => bv.forEach((b, j) => {
    const wt = n.weights === null ? 1 : n.weights[i][j]
    s = s.add(n.points[i][j].mul(a * b * wt))
    w += a * b * wt
  }))
  return s.div(w)
}

const NURBS_FACES: [string, () => Face][] = [
  ['plane', () => Box(10, 20, 30).faces()[2]],
  ['cylinder', () => Cylinder(5, 20).faces().cylinders()[0]],
  ['torus', () => Torus(20, 5).faces()[0]],
  ['cone', cone],
  ['sphere', () => Sphere(7).faces()[0]],
]
for (const [name, make] of NURBS_FACES) {
  test(`nurbs of faces: ${name}`, () => {
    const face = make()
    const n = face.nurbs()
    const nu = n.knots[0].length - n.degrees[0] - 1
    const nv = n.knots[1].length - n.degrees[1] - 1
    assert.equal(n.points.length, nu)
    assert.ok(n.points.every((row) => row.length === nv))
    const [u0, u1, v0, v1] = face._domain()
    for (const [a, b] of [[0.3, 0.6], [0.5, 0.5], [0.9, 0.1]]) {
      const p = nurbsPoint(n, u0 + (u1 - u0) * a, v0 + (v1 - v0) * b)
      assert.ok(p.sub(face.positionAt(a, b)).length <= 1e-9, `${p} against ${face.positionAt(a, b)}`)
    }
  })
}

test('iso curves of faces', () => {
  const plate = Box(40, 30, 5).cut(Cylinder(5, 10)).faces().top()[0]
  const pieces = plate.iso({ u: 0.5 })
  const ends = pieces.flatMap((e) => [e.start, e.end]).map((p) => Math.abs(Math.round((p.x + p.y) * 1e12) / 1e12)).sort((a, b) => a - b)
  assert.deepEqual(ends, [5, 5, 15, 15])
  assert.ok(pieces.every((e) => e.geomType === 'line'))
  approx(pieces.reduce((s, e) => s + e.length, 0), 20, 1e-12)
  const across = plate.iso({ v: 0.9 })
  assert.equal(across.length, 1)
  approx(across[0].length, plate.positionAt(0, 0).x !== plate.positionAt(1, 0).x ? 40 : 30, 1e-12)
  assert.equal(plate.iso({ u: 0.0 }).length, 1)
  const side = Cylinder(5, 20).faces().cylinders()[0]
  const ring = side.iso({ v: 0.5 })
  assert.ok(ring.length === 1 && ring[0].geomType === 'circle')
  approx(ring[0].length, 10 * Math.PI, 1e-12)
  approx(side.iso({ u: 0.25 })[0].length, 20, 1e-12)
  raises(() => plate.iso(), RangeError, /one of u and v/)
  raises(() => plate.iso({ u: 0.5, v: 0.5 }), RangeError, /one of u and v/)
  raises(() => plate.iso({ u: 1.5 }), RangeError, /from 0 to 1/)
})

test('curvature of edges', () => {
  approx(CenterArc([0, 0, 0], 7, 0, 90).curvatureAt(0.3), 1 / 7, 1e-12)
  assert.equal(Line([0, 0, 0], [1, 2, 3]).curvatureAt(), 0)
  const e = Ellipse(10, 4).edges()[0]
  let most = 0
  for (let t = 0; t <= 400; t++) most = Math.max(most, e.curvatureAt(t / 400))
  approx(most, 10 / 16, 1e-4)
})

// -- A4: continuity ----------------------------------------------------------------------------------
test('continuity of fillet borders', () => {
  const box = Box(30, 30, 30)
  const edge = box.edges().filterBy(Z).sortBy(X).last
  const round = box.fillet(edge, 5)
  const blend = box.fillet(edge, 5, { continuity: 'G2' })
  const borders = round.edges().g1()
  assert.equal(borders.length, 2)
  assert.equal(round.edges().g2().length, 0)
  for (const e of borders) {
    const c = e.continuity()
    assert.equal(c.level, 'G1')
    assert.ok(c.angle <= 1e-9 && c.gap <= 1e-9)
    approx(c.curvatureJump, 0.2, 1e-9)
  }
  assert.equal(blend.edges().g2().length, 2)
  assert.equal(blend.edges().g1().length, 2)
  for (const e of blend.edges().g2()) assert.ok(e.continuity().curvatureJump <= 1e-6)
  const crease = box.edges()[0].continuity()
  assert.equal(crease.level, 'G0')
  approx(crease.angle, 90)
  const seam = Cylinder(5, 10).edges({ seams: true }).filter((e) => e.isSeam)[0].continuity()
  assert.equal(seam.level, 'G2')
  assert.ok(seam.angle <= 1e-9)
  assert.equal(borders[0].continuity(16, { angleTolerance: 1e-12 }).level, 'G1')
  assert.equal(borders[0].continuity(16, { curvatureTolerance: 10 }).level, 'G2')
  raises(() => Line([0, 0, 0], [1, 0, 0]).continuity(), RangeError, /free curve/)
  raises(() => Rectangle(10, 10).edges()[0].continuity(), RangeError, /between two faces/)
})

function twist(x: number, y: number): number {
  return x > 10 ? (y - 5) * 0.05 * (x - 10) : 0
}

/** Two faces along x = 10 whose angle runs from -14 through 0 (at y = 5) to +14 degrees: a sheet, or
 * a solid closed by planar sides and bottom. */
function creaseThroughTangency(solid: boolean): ReturnType<typeof stitch> {
  const grid = (x0: number, x1: number) => {
    const rows: [number, number, number][][] = []
    for (let i = 0; i < 5; i++) {
      const x = x0 + ((x1 - x0) * i) / 4
      const row: [number, number, number][] = []
      for (let j = 0; j < 5; j++) row.push([x, (10 * j) / 4, twist(x, (10 * j) / 4)])
      rows.push(row)
    }
    return rows
  }
  const flat = surface(grid(0, 10))
  const twisted = surface(grid(10, 20))
  if (!solid) return stitch(flat, twisted)
  const sides = [
    Polyline([0, 0, -5], [20, 0, -5], [20, 0, twist(20, 0)], [10, 0, 0], [0, 0, 0]),
    Polyline([0, 10, -5], [20, 10, -5], [20, 10, twist(20, 10)], [10, 10, 0], [0, 10, 0]),
    Polyline([20, 0, -5], [20, 10, -5], [20, 10, twist(20, 10)], [20, 0, twist(20, 0)]),
    Polyline([0, 0, -5], [0, 10, -5], [0, 10, 0], [0, 0, 0]),
    Polyline([0, 0, -5], [20, 0, -5], [20, 10, -5], [0, 10, -5]),
  ]
  return stitch(flat, twisted, ...sides.map((w) => w.close().toSketch()))
}

test('convexity looks along the whole edge', () => {
  const sheet = creaseThroughTangency(false)
  const edge = sheet.edges().filter((e) => e.faces().length === 2)[0]
  assert.equal(edge._probedConvexity(0.5, 1), 'smooth')
  assert.ok(['convex', 'concave'].includes(edge.convexity))
  const c = edge.continuity()
  assert.equal(c.level, 'G0')
  approx(c.angle, (Math.atan(0.05 * 4.6875) * 180) / Math.PI, 1e-6)
  const solid = creaseThroughTangency(true)
  assert.ok(solid instanceof Part)
  approx((solid as Part).volume, 1000, 1e-9)
  const inner = solid.edges().filter((e) => Math.abs(e.center().x - 10) < 1e-6 && Math.abs(e.center().z) < 1e-6)[0]
  approx(inner.dihedralAngle, 180)
  assert.ok(['convex', 'concave'].includes(inner.convexity))
  assert.ok(!solid.edges().smooth().some((e) => e.equals(inner)))
  assert.equal(inner.continuity().level, 'G0')
})

test('continuity of wires', () => {
  const tangent = new Wire([Line([0, 0, 0], [10, 0, 0]), CenterArc([10, 5, 0], 5, -90, 90)])
  const c = tangent.continuity()
  assert.equal(c.level, 'G1')
  approx(c.curvatureJump, 0.2, 1e-9)
  assert.ok(c.point.isClose([10, 0, 0]))
  const corner = Polyline([0, 0, 0], [10, 0, 0], [10, 10, 0]).continuity()
  assert.equal(corner.level, 'G0')
  approx(corner.angle, 90)
  assert.equal(new Wire(Circle(5).edges()).continuity().level, 'G2')
  const apart = new Wire([Line([0, 0, 0], [1, 0, 0]), Line([1, 0.1, 0], [2, 0, 0])], { sort: false }).continuity()
  assert.equal(apart.level, null)
  approx(apart.gap, 0.1)
  raises(() => new Wire(Line([0, 0, 0], [1, 0, 0])).continuity(), RangeError, /no joints/)
})

// -- A7: faces the integration cannot converge on ---------------------------------------------------
function crossedOring(vStart: number): Part {
  const faces = [{
    surface: { kind: 'torus', origin: [0, 0, 0], z: [0, -1, 0], x: [1, 0, 0], major: 4.5, minor: 0.5, v_start: vStart },
    same_sense: true,
    loops: [{ edges: [[0, false], [1, true], [0, true], [1, false]] }],
    free_seam: false,
  }]
  const edges = {
    0: { kind: 'circle', center: [4.5, 0, 0], z: [0, 0, -1], x: [1, 0, 0], radius: 0.5, sweep: 360.0, v0: 0, v1: 0 },
    1: { kind: 'circle', center: [0, 0, 0], z: [0, -1, 0], x: [1, 0, 0], radius: 5.0, sweep: 360.0, v0: 0, v1: 0 },
  }
  return Part._wrap(ext.build_brep(faces, edges, true, false, false))
}

test('a face across its seam raises instead of integrating for minutes', () => {
  const sound = crossedOring(0.0)
  approx(sound.volume, 2 * Math.PI ** 2 * 4.5 * 0.25, 1e-7)
  const broken = crossedOring(-180.0)
  assert.equal(broken.isValid(), false)
  const t = performance.now()
  raises(() => broken.volume, KernelError, /crosses the seam of its surface/)
  raises(() => broken.faces()[0].area, KernelError, /crosses the seam/)
  assert.ok(performance.now() - t < 60000)
  const m = ext.brep_measure(broken._brep, 1e-8)
  assert.equal(m.exhausted, 0)
  assert.equal(m.converged, false)
  assert.equal(ext.brep_measure(sound._brep, 1e-8).exhausted, -1)
})

// -- D1: K-factors per bend ------------------------------------------------------------------------
function twoBends(): Part {
  const blank = Box(200, 40, 2, { align: [Align.CENTER, Align.CENTER, Align.MIN] })
  const part = fold(blank, new Axis([-60, 0, 2], [0, 1, 0]), 90, { radius: 1, kFactor: 0.33 })
  return fold(part, new Axis([60, 0, 2], [0, 1, 0]), 90, { radius: 6, kFactor: 0.45 })
}

test("unfold takes each bend's own K-factor", () => {
  const part = twoBends()
  assert.deepEqual(bends(part).map((b) => b.kFactor), [0.33, 0.45])
  const pattern = flatPattern(part)
  near(pattern.size.x, 200, 1e-6)
  assert.equal(pattern.kFactor, null)
  assert.deepEqual(pattern.bends.map((b) => b.kFactor), [0.33, 0.45])
  near(unfold(part).bbox().size.x, 200, 1e-6)
  near(part.rotate(Z, 30).translate(5, 5, 5).flatPattern().size.x, 200, 1e-6)
  near(part.cut(Cylinder(3, 10).translate(-90, 0, 1)).flatPattern().size.x, 200, 1e-6)
  near(part.named('p').flatPattern().size.x, 200, 1e-6)
  near(flatPattern(part, { kFactor: 0.44 }).size.x, 200.314, 1e-3)
  assert.equal(flatPattern(part, { kFactor: 0.44 }).kFactor, 0.44)
})

test('K-factor rules', () => {
  const part = twoBends()
  const rules = [new Map([[1, 0.33], [6, 0.45]]), { 1: 0.33, 6: 0.45 }, (r: number) => (r < 3 ? 0.33 : 0.45), [[0.5, 0.33], [3, 0.45]] as [number, number][]]
  for (const rule of rules) near(flatPattern(part, { kFactor: rule }).size.x, 200, 1e-6)
  approx(din6935(1, 2), (0.65 + 0.5 * Math.log10(0.5)) / 2)
  assert.equal(din6935(20, 2), 0.5)
  const din = flatPattern(part, { kFactor: 'din6935' })
  approx(din.bends[0].kFactor, din6935(1, 2))
  approx(din.bends[1].kFactor, din6935(6, 2))
  const expected = 200 + din.bends.reduce((s, b, i) => s + (Math.PI / 2) * (b.kFactor - [0.33, 0.45][i]) * 2, 0)
  near(din.size.x, expected, 1e-6)
  approx(bends(part, { kFactor: [[0, 0.3], [1, 0.4]] })[0].kFactor, 0.35)
  raises(() => flatPattern(part, { kFactor: { 1: 0.33 } }), RangeError, /no entry for the inside radius 6/)
  raises(() => flatPattern(part, { kFactor: 'foo' }), RangeError, /din6935/)
  raises(() => flatPattern(part, { kFactor: () => 2.0 }), RangeError, /between 0 and 1/)
  raises(() => flatPattern(part, { kFactor: [[1, 2, 3]] as never }), TypeError, /kFactor must be/)
})

test('flanges keep their K-factor', () => {
  const plate = Box(100, 60, 2, { align: [Align.CENTER, Align.CENTER, Align.MIN] })
  const edge = plate.edges().filterBy(Y).top().sortBy(X).last
  const part = flange(plate, edge, 20, { radius: 2, kFactor: 0.3 })
  assert.equal(part.bends()[0].kFactor, 0.3)
  const blank = part.flatPattern().size.x
  near(part.flatPattern({ kFactor: 0.44 }).size.x, blank + (Math.PI / 2) * (0.44 - 0.3) * 2, 1e-6)
  const plain = Part._wrap(part._copyBrep())
  assert.equal(plain.bends()[0].kFactor, 0.44)
})

// -- D2: analytic images of deformations ------------------------------------------------------------
function kinds(shapes: Iterable<{ geomType: string }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of shapes) out[s.geomType] = (out[s.geomType] ?? 0) + 1
  return out
}

function round9(v: number): number {
  return Number(v.toFixed(9))
}

test('a bent plate has exact cylinders and circles', () => {
  const plate = Box(200, 40, 10)
  const bent = plate.bend(90, { radius: 25 })
  assert.ok(bent.isValid())
  assert.deepEqual(kinds(bent.faces()), { plane: 12, cylinder: 2 })
  assert.deepEqual(kinds(bent.edges()), { line: 24, circle: 4 })
  const cyl = bent.faces().cylinders()
  assert.deepEqual(cyl.map((f) => round9(f.radius)).sort((a, b) => a - b), [20, 30])
  for (const f of cyl) {
    assert.ok(f.axis.direction.isParallel([0, 1, 0]))
    near(new Axis([(-25 * Math.PI) / 4, 0, 25], [0, 1, 0]).distanceTo(f.axis.origin), 0, 1e-9)
  }
  assert.deepEqual(bent.edges().circles().map((e) => round9(e.radius)).sort((a, b) => a - b), [20, 20, 30, 30])
  approx(bent.volume, 80000, 1e-12)
  const plan = _planBend(plate, 90.0, 25, Plane.XZ, null, null, 1e-6)
  const d = k.deform.deviation(plan.shape._brep, bent._brep, { ...plan.spec, max_degree: MAX_DEGREE }, 9)
  assert.ok(Math.max(...(Object.values(d) as number[])) < 1e-9)
})

test('a bent plate is sheet metal', () => {
  const bent = Box(200, 40, 10).bend(90, { radius: 25 })
  const [b] = bent.bends()
  assert.deepEqual([b.angle, b.radius, b.thickness, b.kFactor], [90, 20, 10, 0.5]) // its neutral layer: the middle
  const flat = bent.unfold()
  near(flat.bbox().size.x, 200, 1e-9)
  near(flat.bbox().size.y, 40, 1e-9)
  near(flat.bbox().size.z, 10, 1e-9)
  approx(flat.volume, 80000, 1e-9)
  near(flatPattern(bent).size.x, 200, 1e-9)
  // neutral layer at the bottom, the outside of the bend: K 1, inside radius 25 - 10
  const low = Box(200, 40, 10).bend(90, { radius: 25, plane: new Plane([0, 0, -5], [1, 0, 0], [0, -1, 0]) })
  const [c] = low.bends()
  near(c.radius, 15, 1e-9)
  assert.equal(c.kFactor, 1.0)
  near(low.unfold().bbox().size.x, 200, 1e-9)
})

test('tapers make cones, planes and circles', () => {
  const cone = Cylinder(10, 50).taper(0.5)
  assert.deepEqual(kinds(cone.faces()), { cone: 1, plane: 2 })
  assert.deepEqual(kinds(cone.edges()), { circle: 2 })
  assert.deepEqual(cone.edges().map((e) => round9(e.radius)).sort((a, b) => a - b), [5, 10])
  const side = cone.faces().filter((f) => f.geomType === 'cone')[0]
  near(side.coneAngle, (Math.atan(5 / 50) * 180) / Math.PI, 1e-9)
  approx(cone.volume, ((Math.PI * 50) / 3) * (100 + 50 + 25), 1e-10)
  const frustum = Box(20, 20, 50).taper(2.0)
  assert.deepEqual(kinds(frustum.faces()), { plane: 6 })
  assert.deepEqual(kinds(frustum.edges()), { line: 12 })
  const half = Cylinder(10, 50).taper(0.5, { end: 0 })
  assert.deepEqual(kinds(half.faces()), { cone: 1, cylinder: 1, plane: 2 })
})

test('twists keep turned faces, lattices unmoved faces', () => {
  assert.deepEqual(kinds(Box(20, 20, 100).twist(90).faces()), { plane: 2, bspline: 4 })
  assert.deepEqual(kinds(Cylinder(10, 100).twist(90).edges()), { circle: 2 })
  const block = Box(60, 40, 20)
  const lat = new Lattice(block, 3)
  lat.move([1, 1, -1], [0, 0, 8])
  assert.deepEqual(kinds(lat.apply(block).faces()), { plane: 5, bspline: 1 })
})

test('slanted planes bend into cones; holes stay fitted', () => {
  const b = Box(200, 40, 10)
  const chamfered = b.chamfer(b.edges().filterBy(X).filter((e) => e.center().z > 0), 3)
  const bent = chamfered.bend(90, { radius: 25 })
  assert.ok(bent.isValid())
  assert.deepEqual(kinds(bent.faces()), { plane: 16, cylinder: 2, cone: 2 })
  const holed = Box(200, 40, 10).cut(Cylinder(5, 20)).bend(90, { radius: 25 })
  assert.deepEqual(kinds(holed.faces()), { plane: 12, cylinder: 2, bspline: 1 })
  approx(holed.volume, 80000 - 250 * Math.PI, 1e-9)
})

test('bent and folded parts write cylinders to STEP', () => {
  const folded = fold(Box(200, 40, 10, { align: [Align.MIN, Align.CENTER, Align.MIN] }), new Axis([100, 0, 10], [0, 1, 0]), 90, { radius: 20, kFactor: 0.5 })
  for (const part of [Box(200, 40, 10).bend(90, { radius: 25 }), folded]) {
    const text = toStep(part)
    assert.equal(text.split('CYLINDRICAL_SURFACE').length - 1, 2)
    assert.ok(!text.includes('B_SPLINE_SURFACE'))
    const back = fromStep(text) as Part
    assert.deepEqual(kinds(back.faces()), { plane: 12, cylinder: 2 })
    approx(back.volume, 80000, 1e-9)
  }
})

test('the kernel report counts analytic faces and can leave them out', () => {
  const plan = _planBend(Box(200, 40, 10), 90.0, 25, Plane.XZ, null, null, 1e-6)
  const spec = { ...plan.spec, max_degree: MAX_DEGREE }
  const [b1, r1] = k.deform.deform_brep(plan.shape._brep, spec)
  assert.deepEqual([r1.faces_analytic, r1.edges_analytic, r1.faces_approximated], [4, 12, 0])
  const [b2, r2] = k.deform.deform_brep(plan.shape._brep, { ...spec, analytic: false })
  assert.deepEqual([r2.faces_analytic, r2.faces_approximated], [0, 4])
  assert.deepEqual(kinds(Part._wrap(b2).faces()), { plane: 10, bspline: 4 })
  Part._wrap(b1)
})

// -- D3: unroll, rolled sheet metal ---------------------------------------------------------------
function ring270(): Part {
  return Cylinder(52, 40).cut(Cylinder(50, 50)).cut(Box(60, 60, 50, { align: [Align.MIN, Align.MIN, Align.CENTER] }))
}

function quarter(): Part {
  return Cylinder(52, 40).cut(Cylinder(50, 50)).intersect(Box(60, 60, 40, { align: [Align.MIN, Align.MIN, Align.CENTER] }))
}

test('unroll lays a ring segment flat', () => {
  const ring = ring270()
  const strip = unroll(ring, { radius: 51 })
  assert.ok(strip.isValid())
  assert.deepEqual(kinds(strip.faces()), { plane: 6 })
  assert.deepEqual(kinds(strip.edges()), { line: 12 })
  approx(strip.volume, ring.volume, 1e-12)
  const big = strip.faces().map((f) => f.area).sort((a, b) => a - b).slice(-2)
  for (const a of big) approx(a, ((51 * 3 * Math.PI) / 2) * 40, 1e-12)
  const seg = quarter()
  const flat = seg.unroll({ radius: 51, start: [1, 0, 0] })
  const bb = flat.bbox()
  near(bb.min.x, 50, 1e-9)
  near(bb.max.x, 52, 1e-9)
  near(bb.min.y, 0, 1e-9)
  near(bb.max.y, (51 * Math.PI) / 2, 1e-9)
  approx(seg.unroll({ radius: 52, start: [1, 0, 0] }).volume, (seg.volume * 52) / 51, 1e-9)
})

test('unroll inverts bend', () => {
  const bent = Box(100, 10, 10).bend(90)
  const [center, direction] = bent._folds[0]
  const straight = bent.unroll({ radius: 100 / (Math.PI / 2), axis: new Axis(center, direction) })
  assert.ok(straight.isValid())
  assert.deepEqual(kinds(straight.faces()), { plane: 6 })
  approx(straight.volume, 10000, 1e-12)
  assert.deepEqual(straight.faces().map((f) => Number(f.area.toFixed(6))).sort((a, b) => a - b), [100, 100, 1000, 1000, 1000, 1000])
})

test('unroll refuses what it cannot lay flat', () => {
  const tube = Cylinder(52, 40).cut(Cylinder(50, 50))
  raises(() => tube.unroll({ radius: 51 }), ModelingError, /all the way around/)
  raises(() => Box(10, 10, 10).unroll({ radius: 5 }), ModelingError, /reaches the axis/)
  const seg = quarter()
  raises(() => seg.unroll({ radius: 51, start: [-1, -1, 0] }), ModelingError, /opposite start/)
  raises(() => seg.unroll({ radius: 0 }), RangeError, /positive/)
  raises(() => seg.unroll({ radius: 51, start: [0, 0, 1] }), RangeError, /across the axis/)
  const slit = Cylinder(30, 50).cut(Cylinder(29, 60)).cut(Box(4, 40, 60, { align: [Align.CENTER, Align.MIN, Align.CENTER] }))
  approx(slit.unroll({ radius: 30 }).bbox().size.x, 30 * (2 * Math.PI - 2 * Math.asin(2 / 30)), 1e-9)
})

test('rolled parts unfold', () => {
  const seg = Cylinder(52, 40).cut(Cylinder(50, 50)).intersect(Box(200, 200, 40, { align: [Align.MIN, Align.MIN, Align.CENTER] }))
  const pattern = flatPattern(seg)
  near(pattern.size.x, ((50 + 0.44 * 2) * Math.PI) / 2, 1e-9)
  near(pattern.size.y, 40, 1e-9)
  near(pattern.size.z, 2, 1e-9)
  approx(pattern.outline.area, pattern.size.x * 40, 1e-12)
  approx(seg.unfold({ kFactor: 0.5 }).volume, seg.volume, 1e-12)
  const ring = Cylinder(52, 40).cut(Cylinder(50, 50)).cut(Box(200, 200, 40, { align: [Align.MIN, Align.MIN, Align.CENTER] }))
  const [b] = ring.bends()
  near(b.angle, 270, 1e-9)
  approx(b.allowance, ((3 * Math.PI) / 2) * 50.88, 1e-9)
  near(flatPattern(ring).size.x, ((3 * Math.PI) / 2) * 50.88, 1e-9)
  raises(() => unfold(seg, { fixed: seg.faces().planar()[0] }), RangeError, /rolled/)
})

test('a bend at a free end unfolds with its flat in place', () => {
  const seg = Cylinder(52, 40).cut(Cylinder(50, 50)).intersect(Box(200, 200, 40, { align: [Align.MIN, Align.MIN, Align.CENTER] }))
  const j = seg.fuse(Box(30, 2, 40, { align: [Align.MAX, Align.MIN, Align.CENTER] }).translate(0, 50, 0))
  const bb = j.unfold().bbox()
  near(bb.min.x, -30, 1e-9)
  near(bb.max.x, ((50 + 0.44 * 2) * Math.PI) / 2, 1e-9)
  near(bb.min.y, 50, 1e-9)
  near(bb.max.y, 52, 1e-9)
  near(flatPattern(j).size.x, 30 + ((50 + 0.44 * 2) * Math.PI) / 2, 1e-9)
})

function curl(): Part {
  const ring = Cylinder(12, 40).cut(Cylinder(10, 50)).rotate(X, 90).translate(0, 0, 12)
  const c = ring.cut(Box(20, 60, 20, { align: [Align.MAX, Align.CENTER, Align.MAX] }).translate(0, 0, 12))
  return Box(100, 40, 2, { align: [Align.MAX, Align.CENTER, Align.MIN] }).fuse(c) // 270 degrees at x = 0
}

test('curls and bends over 180 degrees unfold', () => {
  const curled = curl()
  const [b] = curled.bends()
  near(b.angle, 270, 1e-9)
  const bb = curled.unfold().bbox()
  near(bb.min.x, -100, 1e-9)
  near(bb.max.x, ((3 * Math.PI) / 2) * 10.88, 1e-9)
  near(bb.min.z, 0, 1e-9)
  near(bb.max.z, 2, 1e-9)
  const omega = curled.fuse(Box(2, 40, 5, { align: [Align.MIN, Align.CENTER, Align.MAX] }).translate(-12, 0, 12))
  near(omega.unfold().bbox().size.x, 105 + ((3 * Math.PI) / 2) * 10.88, 1e-9)
  near(omega.unfold({ kFactor: 0.5 }).bbox().size.x, 105 + ((3 * Math.PI) / 2) * 11, 1e-9)
  approx(omega.flatPattern().outline.area, (105 + ((3 * Math.PI) / 2) * 10.88) * 40, 1e-9)
})

test('a folded part with a curl unfolds', () => {
  const part = fold(curl(), new Axis([-50, 0, 2], [0, 1, 0]), 90, { radius: 2, kFactor: 0.4 })
  assert.equal(part.bends().length, 2)
  const flat = flatPattern(part)
  near(flat.size.x, 100 + ((3 * Math.PI) / 2) * 10.88, 1e-6)
  assert.deepEqual(flat.bends.map((x) => x.kFactor).sort((a, b) => a - b), [0.4, 0.44])
})

test('bendAllowance takes rolled angles', () => {
  approx(bendAllowance(270, { radius: 50, thickness: 2 }), ((3 * Math.PI) / 2) * 50.88)
  raises(() => bendAllowance(360, { radius: 50, thickness: 2 }), RangeError, /below 360/)
})

// -- D4: volumes of deformed parts -----------------------------------------------------------------
test('deformed parts measure exactly', () => {
  approx(Box(100, 10, 10).bend(90).volume, 10000, 1e-12)
  assert.equal(Number(Box(20, 20, 100).twist(90).volume.toFixed(3)), 40000)
})

// -- D5: holes across bends in the flat pattern ----------------------------------------------------
const plate = (length: number, width: number, t: number) => Box(length, width, t, { align: [Align.CENTER, Align.CENTER, Align.MIN] })

test('a hole across a bend is one circle in the flat pattern', () => {
  const blank = plate(100, 40, 2).cut(Cylinder(4, 10).translate(20, 0, 0))
  const bracket = fold(blank, new Axis([20, 0, 2], [0, 1, 0]), 90, { radius: 2 })
  const pattern = flatPattern(bracket)
  const kinds = pattern.outline.edges().map((e) => e.geomType).sort()
  assert.deepEqual(kinds, ['circle', 'line', 'line', 'line', 'line']) // was 3 arcs and 2 B-splines
  const [hole] = pattern.outline.edges().circles()
  assert.ok(hole.isClosed)
  near(hole.radius, 4, 1e-9)
  assert.ok(hole.arcCenter.sub(new Vector(70, 20, 0)).length < 1e-9)
  approx(pattern.outline.area, 4000 - 16 * Math.PI, 1e-12)
  // the hole's edges across the bend come back round: 1.85e-5 off before (fitted within 1e-4)
  let worst = 0
  for (const e of bracket.unfold().edges()) {
    if (e.geomType !== 'bspline') continue
    for (let i = 0; i <= 64; i++) {
      const q = e.pointAt(i / 64)
      worst = Math.max(worst, Math.abs(Math.hypot(q.x - 20, q.y) - 4))
    }
  }
  assert.ok(worst > 0 && worst < 1e-7, `${worst}`)
})

test('holes inside a bend zone unfold into a flat pattern', () => {
  // two holes wholly inside an R20 bend: the flat pattern threw "the unfolded part is 3.37494 deep"
  const blank = plate(200, 60, 3)
    .cut(Cylinder(6, 10).translate(10, -15, 0))
    .cut(Cylinder(6, 10).translate(25, 15, 0))
  const part = fold(blank, new Axis([20, 0, 3], [0, 1, 0]), 120, { radius: 20 })
  const pattern = flatPattern(part)
  near(pattern.size.x, 200, 1e-9)
  near(pattern.size.y, 60, 1e-9)
  near(pattern.size.z, 3, 1e-6) // (the part's box is 3.375 deep: its fitted hole walls)
  const holes = pattern.outline.edges().circles()
  assert.equal(holes.length, 2)
  assert.equal(pattern.outline.edges().length, 6)
  const centers = holes.map((h) => [h.arcCenter.x, h.arcCenter.y]).sort((a, b) => a[0] - b[0])
  near(centers[0][0], 110, 1e-6)
  near(centers[0][1], 15, 1e-6)
  near(centers[1][0], 125, 1e-6)
  near(centers[1][1], 45, 1e-6)
  for (const h of holes) near(h.radius, 6, 1e-6)
  approx(pattern.outline.area, 200 * 60 - 72 * Math.PI, 1e-9)
  near(Math.min(...pattern.part.edges().map((e) => e.bbox().min.z)), 0, 1e-12) // the bottom at z = 0
})

test('fitted lines across a bend and free shapes in the flat pattern', () => {
  // a corner cut at 45 degrees across the bend: lines in the outline (were 2 B-splines)
  const cut = fold(plate(100, 40, 2).cut(Box(30, 30, 10).rotate(Z, 45).translate(20, 20, 0)), new Axis([20, 0, 2], [0, 1, 0]), 90, {
    radius: 2,
  })
  assert.deepEqual([...new Set(flatPattern(cut).outline.edges().map((e) => e.geomType))], ['line'])
  // a spline cutout stays a spline
  const region = makeFace(new Wire([Spline([-40, -5], [-30, 5], [-20, -5]), Line([-20, -5], [-40, -5])]))
  const part = fold(plate(100, 40, 2).cut(region.extrude(10).translate(0, 0, -2)), new Axis([20, 0, 2], [0, 1, 0]), 90, { radius: 2 })
  assert.equal(flatPattern(part).outline.edges().filter((e) => e.geomType === 'bspline').length, 1)
})

// -- D6: edges, wires and points -------------------------------------------------------------------
test('a line bent in its middle is a line, an arc and a line', () => {
  const line = Line([-50, 0, 0], [50, 0, 0])
  const path = bend(new Wire([line]), 90, { radius: 10 })
  assert.deepEqual(path.edges().map((e) => e.geomType), ['line', 'circle', 'line'])
  const [a, arc, b] = path.edges()
  const s = (5 * Math.PI) / 2 // half the bend's length: it is centered on the plane origin
  approx(a.length, 50 - s, 1e-12)
  approx(b.length, 50 - s, 1e-12)
  approx(arc.radius, 10, 1e-12)
  approx(arc.length, (10 * Math.PI) / 2, 1e-12)
  assert.ok(arc.arcCenter.sub(new Vector(-s, 0, 10)).length < 1e-12)
  assert.ok(path.end.sub(new Vector(10 - s, 0, 10 + 50 - s)).length < 1e-9)
  const edge = bend(line, 90, { radius: 10 }) // an Edge stays one edge: the pieces joined
  assert.ok(edge instanceof Edge)
  approx(edge.length, 100, 1e-12)
  assert.ok(edge.end.sub(path.end).length < 1e-9 && edge.pointAt(0.5).sub(path.pointAt(0.5)).length < 1e-9)
  const whole = bend(line, 90) // the whole line: one exact arc
  assert.equal(whole.geomType, 'circle')
  approx(whole.radius, 200 / Math.PI, 1e-12)
  // a closed wire stays closed, its edges split where they cross the range ends
  const ring = bend(Polyline([-50, -5, 0], [50, -5, 0], [50, 5, 0], [-50, 5, 0], { close: true }), 90, { radius: 10 })
  assert.ok(ring.isClosed)
  assert.equal(ring.edges().length, 8)
})

test('twisted, tapered, unrolled and lattice curves', () => {
  const helix = twistShape(Line([10, 0, 0], [10, 0, 100]), 90) // a quarter turn of a helix, within 1e-6
  assert.equal(helix.geomType, 'bspline')
  for (let i = 0; i <= 10; i++) {
    const q = helix.pointAt(i / 10)
    near(Math.hypot(q.x, q.y), 10, 1e-6)
    near((Math.atan2(q.y, q.x) * 180) / Math.PI, 0.9 * q.z, 1e-5)
  }
  const rim = taper(CenterArc([0, 0, 50], 10, 0, 360), 0.5, { start: 0, end: 100 }) // the middle: 3/4 of the size
  assert.equal(rim.geomType, 'circle')
  approx(rim.radius, 7.5, 1e-12)
  const flat = unroll(Helix(100, 40, 10), { radius: 10 }) // 0.4 turn: a straight line
  assert.equal(flat.geomType, 'line')
  approx(flat.length, Math.hypot(40, 8 * Math.PI), 1e-6)
  const lat = new Lattice(Box(60, 40, 20), 3)
  lat.move([1, 1, -1], [0, 0, 8])
  const lifted = lat.apply(Line([-30, 0, 10], [30, 0, 10])) // exact: the lattice's image of the line
  assert.equal(lifted.geomType, 'bspline')
  for (let i = 0; i <= 12; i++) assert.ok(lifted.distanceTo(lat.map([-30 + 5 * i, 0, 10])) < 1e-9)
  near(lifted.pointAt(0.5).z, 12, 1e-9) // 8 * 1/2 * 1/2 at the middle
})

test('points deform as the part they belong to', () => {
  assert.ok(twistShape([10, 0, 100], 90, { start: 0, end: 100 }).sub(new Vector(0, 10, 100)).length < 1e-12)
  const moved = twistShape([[10, 0, 0], [10, 0, 50], new Vector(10, 0, 150)], 90, { start: 0, end: 100 })
  assert.ok(Array.isArray(moved) && moved.length === 3)
  assert.ok(moved[1].sub(new Vector(10 / Math.SQRT2, 10 / Math.SQRT2, 50)).length < 1e-12)
  assert.ok(moved[2].sub(new Vector(0, 10, 150)).length < 1e-12) // beyond end: turned by the whole angle
  const bar = Box(100, 10, 10, { align: [Align.MIN, Align.CENTER, Align.CENTER] })
  const bent = bar.bend(90) // the corner (100, 5, 5) where the bend moved it
  const corner = bend([100, 5, 5], 90, { start: 0, end: 100 })
  assert.ok(Math.min(...bent.vertices().map((v) => v.point.sub(corner).length)) < 1e-9)
  assert.ok(taper([10, 0, 100], 0.5, { start: 0, end: 100 }).sub(new Vector(5, 0, 100)).length < 1e-12)
  const lat = new Lattice(Box(60, 40, 20), 3)
  lat.move([1, 1, -1], [0, 0, 8])
  assert.ok(lat.apply([0, 0, 10]).equals(lat.map([0, 0, 10])))
  assert.ok(unroll([10, 0, 0], { radius: 10, start: [1, 0, 0] }).sub(new Vector(10, 0, 0)).length < 1e-12)
  raises(() => twistShape([10, 0, 100], 90), RangeError, /give start and end for points/)
  raises(() => twistShape(Z as never, 90), TypeError, /Part, a Shell, an Edge, a Wire or points/)
})

// -- D7: a lattice is a global map -----------------------------------------------------------------
test('a lattice point moves the whole box', () => {
  const lat = new Lattice(Box(60, 40, 20), 3)
  lat.move([1, 1, -1], [0, 0, 8])
  near(lat.map([0, 0, 10]).z, 12, 1e-12) // 8 * 1/2 * 1/2
  // far from the point too: the top's corner region and the middle of the block move
  assert.ok(lat.map([25, 15, 10]).z > 10.25)
  near(lat.map([0, 0, 0]).z, 0.5, 1e-12)
  assert.ok(lat.map([30, 20, 10]).equals(new Vector(30, 20, 10))) // only the box's corners stay
  const pillow = lat.apply(Box(60, 40, 20))
  assert.equal(pillow.faces().filter((f) => f.geomType === 'plane').length, 5) // faces left in place keep their type
})
