// tests/test_geometry.py
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Axis, Location, Plane, Pos, Rot, Vector, X, Y, Z } from '../src/index.ts'
import { approx, same } from './_approx.ts'
import { Bezier, CenterArc, Line, Spline, makeCompatible } from '../src/index.ts'
import { ext } from '../src/kernel.ts'

test('vector algebra', () => {
  const a = new Vector(1, 2, 3)
  const b = new Vector(4, 5, 6)
  same(a.add(b), new Vector(5, 7, 9))
  same(b.sub(a), new Vector(3, 3, 3))
  same(a.mul(2), new Vector(2, 4, 6))
  assert.equal(a.dot(b), 32)
  same(new Vector(1, 0, 0).cross(new Vector(0, 1, 0)), new Vector(0, 0, 1))
  assert.equal(new Vector(3, 4).length, 5)
  same(new Vector(0, 2, 0).normalized(), new Vector(0, 1, 0))
  approx(new Vector(1, 0, 0).angleTo([0, 1, 0]), 90)
  same(new Vector([1, 2]), new Vector(1, 2, 0))
})

test('locations compose right to left', () => {
  const loc = Pos(10, 0, 0).mul(Rot({ z: 90 }))
  same(loc.mul(new Vector(1, 0, 0)), new Vector(10, 1, 0))
  same(loc.inverse().mul(loc), new Location())
  same(Rot({ z: 90 }).rotation, new Vector(0, 0, 90))
})

test('rotation about an axis', () => {
  const p = new Vector(2, 0, 0).rotate(new Axis([1, 0, 0], [0, 0, 1]), 180)
  same(p, new Vector(0, 0, 0))
})

test('named planes keep Y up on side views', () => {
  for (const plane of [Plane.front, Plane.back, Plane.left, Plane.right]) same(plane.yDir, new Vector(0, 0, 1))
  same(Plane.top.zDir, new Vector(0, 0, 1))
  same(Plane.bottom.zDir, new Vector(0, 0, -1))
  same(Plane.XY.xDir, new Vector(1, 0, 0))
})

test('the default x direction of a plane is stable', () => {
  same(new Plane([0, 0, 0], null, [0, -1, 0]), Plane.front)
  same(new Plane([0, 0, 0], null, [1, 0, 0]), Plane.right)
})

test('plane coordinates', () => {
  const p = Plane.XZ.offset(5)
  same(p.origin, new Vector(0, -5, 0))
  const q = p.fromLocal([1, 2, 0])
  same(p.toLocal(q), new Vector(1, 2, 0))
  same(p.location.mul(new Vector(1, 2, 0)), q)
})

test('axis helpers', () => {
  assert.ok(X.isParallel([-1, 0, 0]))
  approx(Z.distanceTo([3, 4, 10]), 5)
  approx(Y.positionAlong([0, 7, 0]), 7)
})

test('curve tools', () => {
  const poles = (e: any): number => ext.curve_data(e._curve(), true).poles.length
  const a = Bezier([0, 0, 0], [1, 3, 0], [4, 3, 1], [6, 0, 0])
  const b = Spline([0, 0, 5], [2, 1, 5], [3, -1, 5], [4, 2, 5], [6, 0, 5])
  const arc = CenterArc([3, 0, 10], 3, 180, 180)
  const out = makeCompatible(a, [b, arc], Line([0, 0, 15], [6, 0, 15]))
  const data = out.map((e: any) => ext.curve_data(e._curve(), true))
  assert.equal(new Set(data.map((d: any) => d.knots.length)).size, 1)
  assert.equal(new Set(data.map((d: any) => d.degree)).size, 1)
  for (const d of data) d.knots.forEach((x: number, i: number) => approx(x, data[0].knots[i], 0, 1e-12))
  assert.ok(out.every((e) => e.geomType === 'bspline'))
  ;[a, b, arc].forEach((src, i) => {
    for (let t = 0; t <= 1; t += 0.05) assert.ok(src.distanceTo(out[i].pointAt(t)) < 1e-9)
  })
  // the Bezier's copy carries the knots of the others; it needs none of them
  assert.ok(poles(out[0]) > 4)
  const simple = out[0].removeKnots()
  assert.equal(poles(simple), 4)
  for (let t = 0; t <= 1; t += 0.05) assert.ok(a.distanceTo(simple.pointAt(t)) < 1e-6)
  assert.equal(Line([0, 0, 0], [1, 0, 0]).removeKnots().geomType, 'line')
  assert.throws(() => makeCompatible(a), /two or more/)
})

