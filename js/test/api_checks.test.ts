// tests/test_api_checks.py: selections, patterns and argument checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Box,
  Circle,
  Cylinder,
  GridLocations,
  Line,
  Locations,
  ModelingError,
  Plane,
  Polyline,
  Pos,
  Rectangle,
  ShapeList,
  Sphere,
  Wedge,
  Wire,
  Z,
  importStl,
  load,
  surface,
  sweep,
  thicken,
} from '../src/index.ts'
import { approx } from './_approx.ts'

test('straight B-spline edges count as lines', () => {
  const box = Box(20, 20, 10)
  const c = box.chamfer(box.edges().parallelTo(Z), 2)
  assert.equal(c.edges().parallelTo(Z).length, 8) // the chamfer's edges are straight B-splines
  assert.equal(c.edges().lines().length, 24)
  const half = Polyline([-20, 0], [-20, 10], [20, 10], [20, 0])
  const full = half.add(half.mirror(Plane.XZ)) // mirrored lines become B-splines
  assert.equal(full.fillet(2).edges().length, 10)
  approx(Rectangle(40, 20).offset(-2).fillet(3).area, Rectangle(36, 16).fillet(3).area)
  assert.equal(Cylinder(5, 10).edges().lines().length, 0)
})

test('flat B-spline faces are planar', () => {
  const nurbs = Box(10, 10, 10).toNurbs()
  const top = nurbs.faces().top().one()
  assert.ok(top.geomType === 'bspline' && top.isPlanar)
  const z = top.plane.zDir
  approx(z.x, 0)
  approx(z.y, 0)
  approx(z.z, 1)
  assert.equal(nurbs.faces().planar().length, 6)
  assert.ok(!Sphere(5).faces()[0].isPlanar)
})

test('a location times a pattern keeps the pattern', () => {
  const r = Pos(0, 0, 10).mul(GridLocations(10, 10, 2, 2)).mul(Box(1, 1, 1))
  assert.ok(r instanceof ShapeList && r.length === 4)
  approx(r.bbox().min.z, 9.5)
  const top = Box(30, 20, 10).faces().top()
  assert.equal(GridLocations(10, 10, 2, 2).on(top).mul(Circle(1)).length, 4)
  assert.ok(Plane.XY.offset(5).mul(GridLocations(10, 10, 2, 2)) instanceof Locations)
  assert.ok(Pos(1, 0, 0).mul(GridLocations(10, 10, 2, 2).mul(Box(1, 1, 1))) instanceof ShapeList)
})

test('massProperties checks the density and the accuracy', () => {
  assert.throws(() => Box(10, 10, 10).massProperties(0), (e: Error) => e instanceof RangeError && /density/.test(e.message))
  assert.throws(() => Sphere(10).massProperties(1, 1e-12), (e: Error) => e instanceof RangeError && /accuracy/.test(e.message))
  approx(Box(10, 10, 10).massProperties(2).mass, 2000)
})

test('the size of a wedge, and its checks', () => {
  const w = Wedge(20, 10, 8)
  approx(w.volume, 800)
  const size = w.bbox().size
  approx(size.x, 20)
  approx(size.y, 10)
  approx(size.z, 8)
  approx(Wedge(20, 10, 8, 5).volume, 1000)
  for (const args of [
    [-20, 10, 8],
    [20, 10, -8],
    [0, 10, 8],
    [20, 0, 8],
    [20, 10, 8, 20],
  ] as [number, number, number, number?][]) {
    assert.throws(() => Wedge(...args), RangeError)
  }
})

test('split with nothing on the kept side', () => {
  const part = Box(20, 20, 20)
  assert.throws(() => part.split(Plane.XY.offset(50)), (e: Error) => e instanceof ModelingError && /nothing of the part/.test(e.message))
  approx(part.split(Plane.XY).volume, 4000)
})

test('mirror in a face', () => {
  const part = Box(10, 10, 10)
  const m = part.mirror(part.faces().right())
  approx(m.bbox().min.x, 5)
  approx(m.bbox().max.x, 15)
})

test('feature argument checks', () => {
  assert.throws(() => thicken(Box(1, 1, 1) as never, 1), (e: Error) => e instanceof TypeError && /face or a sheet/.test(e.message))
  assert.throws(
    () => sweep(Circle(1), new Wire([Line([0, 0, 0], [0, 0, 10]), Line([5, 0, 20], [5, 0, 30])])),
    (e: Error) => e instanceof RangeError && /not connected/.test(e.message),
  )
  assert.throws(() => Rectangle(40, 20).fillet(-2), (e: Error) => e instanceof RangeError && /positive/.test(e.message))
  assert.throws(
    () => surface([0, 1, 2].map((y) => [0, 1, 2].map((x) => [x, y, 0]))),
    (e: Error) => e instanceof RangeError && /4 x 4/.test(e.message),
  )
})

test('file argument checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smlibjs-'))
  assert.throws(() => load(join(dir, 'x.glb')), (e: Error) => e instanceof RangeError && /unknown file type/.test(e.message))
  assert.throws(() => load(join(dir, 'missing.smb')), (e: NodeJS.ErrnoException) => e.code === 'ENOENT')
  assert.throws(() => Box(1, 1, 1).mesh(0), (e: Error) => e instanceof RangeError && /positive/.test(e.message))
  const bad = join(dir, 'bad.stl')
  writeFileSync(bad, 'hello world')
  assert.throws(() => importStl(bad), (e: Error) => e instanceof RangeError && /not an STL file/.test(e.message))
})

test('surface rejects NaN', () => {
  assert.throws(
    () => surface([0, 1, 2, 3].map((y) => [0, 1, 2, 3].map((x) => [x, y, x === 1 && y === 1 ? Number.NaN : 0]))),
    (e: Error) => e instanceof RangeError && /finite/.test(e.message),
  )
})
