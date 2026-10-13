// tests/test_surfaces.py
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Align,
  Axis,
  Box,
  CenterArc,
  Circle,
  Cylinder,
  Helix,
  Line,
  Part,
  Plane,
  Shell,
  Sphere,
  ThreePointArc,
  Torus,
  Vector,
  X,
  Y,
  Z,
  extrude,
  loft,
  revolve,
  stitch,
  surface,
} from '../src/index.ts'
import { approx } from './_approx.ts'

const PI = Math.PI

test('open curves make surfaces', () => {
  const arc = ThreePointArc([0, 0, 0], [10, 5, 0], [20, 0, 0])
  const wall = extrude(arc, 10)
  assert.ok(wall instanceof Shell)
  approx(wall.area, arc.length * 10, 1e-6)

  const vase = revolve(Line([5, 0, 0], [5, 0, 10]), Z) as Shell
  approx(vase.area, 2 * PI * 5 * 10, 1e-6)

  const patch = loft([Line([0, 0, 0], [10, 0, 0]), Line([0, 10, 5], [10, 10, 5])]) as Shell
  approx(patch.area, 10 * Math.hypot(10, 5), 1e-6)
})

test('a surface through points, thickened', () => {
  const pts: number[][][] = []
  for (let y = 0; y < 5; y++) {
    const row: number[][] = []
    for (let x = 0; x < 6; x++) row.push([x * 10, y * 10, 3 * Math.sin(x / 2) * Math.cos(y / 2)])
    pts.push(row)
  }
  const s = surface(pts)
  assert.equal(s.faces()[0].geomType, 'bspline')
  for (const row of pts) for (const p of row) assert.ok(s.distanceTo(p) < 1e-6)
  const solid = s.thicken(1)
  assert.ok(solid.isValid())
  approx(solid.volume, s.area, 2e-2)
})

test('stitch faces into a solid', () => {
  const box = Box(10, 10, 10)
  const part = stitch(box.faces().map((f) => f.toShell()))
  assert.ok(part instanceof Part)
  approx(part.volume, 1000)
})

test('queries', () => {
  approx(Sphere(5).silhouette([0, 0, 1])[0].length, 2 * PI * 5, 1e-6)
  const pts = Line([0, 0], [10, 10]).intersections(Line([0, 10], [10, 0]))
  assert.ok(pts.length === 1 && pts[0].equals(new Vector(5, 5, 0)))
  const curves = Box(10, 10, 10).intersectionCurves(Cylinder(3, 20))
  assert.ok(curves.length === 2 && curves.every((c) => c.geomType === 'circle' || c.geomType === 'bspline'))
  approx(Box(10, 10, 10).distanceTo(Box(10, 10, 10).translate(15, 0, 0)), 5)
})

const sortedLengths = (edges: Iterable<{ length: number }>) => [...edges].map((e) => e.length).sort((a, b) => a - b)

test('directions take an axis', () => {
  // An Axis such as Z gives its direction wherever a direction is asked for, as in the selectors;
  // silhouette, project, extrude and Helix took only vectors.
  const torus = Torus(28, 9)
  const a = sortedLengths(torus.silhouette(Z))
  const b = sortedLengths(torus.silhouette([0, 0, 1]))
  a.forEach((x, i) => approx(x, b[i]))
  const box = Box(40, 30, 10)
  const circle = Circle(5).on(Plane.XY.offset(30)).edges()[0]
  const c = sortedLengths(box.project(circle, Z.neg()))
  const d = sortedLengths(box.project(circle, [0, 0, -1]))
  c.forEach((x, i) => approx(x, d[i]))
  const slant = new Axis([5, 5, 5], [0, 1, 2]) // only the direction counts
  approx(Circle(5).extrude(20, { direction: slant }).volume, (PI * 25 * 20 * 2) / Math.sqrt(5))
  approx(extrude(Line([0, 0], [10, 0]), 5, { direction: Y }).area, 50)
  assert.ok(Helix(5, 20, 10, { direction: X }).end.equals(Helix(5, 20, 10, { direction: [1, 0, 0] }).end))
  for (const call of [() => Sphere(5).silhouette([0, 0, 0]), () => box.project(circle, [0, 0, 0])]) {
    assert.throws(call, (e: Error) => e instanceof RangeError && /the direction must not be zero/.test(e.message))
  }
})

test('intersection curves come once where faces lie in one plane', () => {
  // Both bottoms lie in z = 0: the kernel finds the arc there twice (the other way round also the
  // two lines on it). The total length shows any repeat, however the curves are cut.
  const a = Box(60, 44, 28, { align: Align.MIN })
  const b = Cylinder(19, 44, { align: [Align.CENTER, Align.CENTER, Align.MIN] }).translate(56.2, 3.8, 0)
  const line = 3.8 + Math.sqrt(19 ** 2 - 3.8 ** 2) // along x = 60 and y = 0 at z = 0
  const arc = 19 * (PI / 2 + 2 * Math.asin(3.8 / 19)) // the circle inside the box, at z = 0 and 28
  for (const curves of [a.intersectionCurves(b), b.intersectionCurves(a)]) {
    approx(
      curves.reduce((s, e) => s + e.length, 0),
      2 * arc + 2 * 28 + 2 * line,
      1e-6,
    )
  }
  const box = Box(20, 20, 20)
  const shared = box.intersectionCurves(box.translate(20, 0, 0)) // the face x = 10: its 4 sides
  approx(
    shared.reduce((s, e) => s + e.length, 0),
    80,
  )
})

// (CenterArc is used by the guards' thicken tests; keep the import list as Python's)
void CenterArc
