// three's types in, three's types out: points, directions, boxes, planes, rays, matrices, 2D
// shapes and curves are three's; nothing of smlibwasm's comes out, not even in an error; and no
// name the package exports is one of three's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import {
  Box,
  Circle,
  Cylinder,
  BrepEdge,
  BrepFace,
  GridLocations,
  Segment,
  ModelingError,
  Part,
  PolarLocations,
  Rectangle,
  ShapeList,
  Sketch,
  Spline,
  BrepVertex,
  Wire,
} from '../src/index.ts'
import { box, close, closeBox, closeVector, Y } from './_util.ts'

// every class smlibwasm exports, to find any of them in what the package gives
const KERNEL_CLASSES = (Object.values(sm) as unknown[]).filter((v): v is new () => object => typeof v === 'function' && /^[A-Z]/.test(v.name))

/** Fails if `value`, or anything reachable through its enumerable properties, is one of smlibwasm's. */
function noKernel(value: unknown, path = 'value', seen = new Set<unknown>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const cls of KERNEL_CLASSES) assert.ok(!(value instanceof cls), `${path} is smlibwasm's ${cls.name}`)
  if (ArrayBuffer.isView(value)) return
  for (const [key, v] of Object.entries(value)) noKernel(v, `${path}.${key}`, seen)
}

test('points and directions go in as Vector3s (or { x, y, z }) and come out as new Vector3s', () => {
  const line = new Segment(new THREE.Vector3(1, 2, 3), { x: 4, y: 6, z: 3 })
  assert.ok(line.start instanceof THREE.Vector3)
  closeVector(line.start, { x: 1, y: 2, z: 3 }, 1e-12)
  closeVector(line.end, { x: 4, y: 6, z: 3 }, 1e-12)
  close(line.length, 5, 1e-12)
  closeVector(line.tangentAt(0.5), { x: 0.6, y: 0.8, z: 0 }, 1e-12)
  // a target is filled, as three's getters fill theirs
  const target = new THREE.Vector3()
  assert.equal(line.pointAt(0.5, target), target)
  closeVector(target, { x: 2.5, y: 4, z: 3 }, 1e-12)
  assert.throws(() => new Segment([0, 0, 0] as never, new THREE.Vector3()), /THREE\.Vector3/)
})

test('boxes, centers, normals and mass properties are three types', () => {
  const part = new Box(40, 10, 20)
  assert.ok(part.bbox() instanceof THREE.Box3)
  closeBox(part.bbox(), box([-20, -5, -10], [20, 5, 10]))
  assert.ok(part.getCenter() instanceof THREE.Vector3)
  const top = part.faces().top().one()
  assert.ok(top.normalAt() instanceof THREE.Vector3)
  closeVector(top.normalAt(), Y)
  assert.ok(top.plane instanceof THREE.Plane)
  closeVector(top.plane.normal, Y)
  close(top.plane.constant, -5)
  const mp = part.massProperties(2)
  close(mp.mass, 2 * 8000, 1e-6)
  assert.ok(mp.center instanceof THREE.Vector3)
  assert.ok(mp.inertia instanceof THREE.Matrix3)
  // three's axes: the box is 40 along x, 10 along y, 20 along z; Ixx = m (y² + z²) / 12
  const [ixx, , , , iyy, , , , izz] = mp.inertia.elements
  close(ixx, (16000 * (10 ** 2 + 20 ** 2)) / 12, 1e-3)
  close(iyy, (16000 * (40 ** 2 + 20 ** 2)) / 12, 1e-3)
  close(izz, (16000 * (40 ** 2 + 10 ** 2)) / 12, 1e-3)
  const cylinder = new Cylinder(5, 5, 30)
  const side = cylinder.faces().cylinders().one()
  assert.ok(side.axis instanceof THREE.Ray)
  closeVector(side.axis.direction.clone().set(0, Math.abs(side.axis.direction.y), 0), Y)
  close(side.radius, 5)
})

test('a THREE.Plane splits and sections, keeping what three clipping with it keeps', () => {
  const part = new Box(20, 20, 20)
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -4) // y = 4, normal up
  const above = part.split(plane)
  closeBox(above.bbox(), box([-10, 4, -10], [10, 10, 10]))
  const below = part.split(plane, 'below')
  closeBox(below.bbox(), box([-10, -10, -10], [10, 4, 10]))
  const [a, b] = part.split(plane, 'both')
  close(a.volume + b.volume, 8000, 1e-6)
  const section = part.section(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0))
  assert.ok(section instanceof Sketch)
  close(section.area, 400, 1e-6)
  closeVector(section.plane.normal.clone().set(Math.abs(section.plane.normal.x), 0, 0), { x: 1, y: 0, z: 0 })
  const mirrored = new Box(10, 10, 10, { align: { x: 'min' } }).mirror(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0))
  closeBox(mirrored.bbox(), box([-10, -5, -5], [0, 5, 5]))
})

test('THREE.Shapes become exact sketches: lines, arcs, Béziers, splines and holes', () => {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(40, 0)
  shape.bezierCurveTo(50, 5, 50, 15, 40, 20)
  shape.quadraticCurveTo(20, 30, 0, 20)
  shape.splineThru([new THREE.Vector2(-5, 15), new THREE.Vector2(-3, 8), new THREE.Vector2(0, 0)])
  shape.holes.push(new THREE.Path().absarc(12, 10, 4, 0, Math.PI * 2, false))
  shape.holes.push(new THREE.Path().absellipse(28, 10, 5, 2, 0, Math.PI * 2, false, Math.PI / 6))
  const sketch = new Sketch(shape)
  // the outline runs through every point three draws of it, to the kernel's tolerance (a shape's
  // (x, y) is three's (x, y): the sketch lies in the XY plane, as ShapeGeometry does)
  const edges = sketch.edges()
  const onOutline = (p: THREE.Vector2) => Math.min(...edges.map((e) => e.distanceTo(new THREE.Vector3(p.x, p.y, 0))))
  for (const p of shape.getPoints(24)) assert.ok(onOutline(p) < 1e-7, `(${p.x}, ${p.y}) is ${onOutline(p)} off the outline`)
  for (const hole of shape.holes) for (const p of hole.getPoints(24)) assert.ok(onOutline(p) < 1e-7, `(${p.x}, ${p.y}) is ${onOutline(p)} off a hole`)
  // its area is three's (ShapeUtils.area of a fine outline), less the holes
  const fine = (path: THREE.Path) => Math.abs(THREE.ShapeUtils.area(path.getPoints(400)))
  close(sketch.area, fine(shape) - fine(shape.holes[0]) - fine(shape.holes[1]), 0.05)
  close(sketch.area, fine(shape) - Math.PI * 16 - Math.PI * 10, 0.05)
  // several shapes: one sketch of all of them
  const two = new Sketch([new THREE.Shape().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).lineTo(0, 10), new THREE.Shape().moveTo(20, 0).lineTo(30, 0).lineTo(30, 10)])
  close(two.area, 100 + 50)
})

test("three's 3D curves become exact edges, with three's parameter", () => {
  const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 5, 2), new THREE.Vector3(20, -3, 8), new THREE.Vector3(25, 10, 0)]
  const curves: THREE.Curve<THREE.Vector3>[] = [
    new THREE.CatmullRomCurve3(points),
    new THREE.CatmullRomCurve3(points, false, 'chordal'),
    new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3),
    new THREE.CatmullRomCurve3(points, true),
    new THREE.CubicBezierCurve3(...(points as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3])),
    new THREE.QuadraticBezierCurve3(points[0], points[1], points[2]),
    new THREE.LineCurve3(points[0], points[3]),
  ]
  for (const curve of curves) {
    const edge = new BrepEdge(curve)
    assert.ok(edge instanceof THREE.Line)
    for (let i = 0; i <= 20; i++) {
      const p = curve.getPoint(i / 20)
      assert.ok(edge.distanceTo(p) < 1e-9, `${curve.type} at ${i / 20}: ${edge.distanceTo(p)}`)
    }
    close(edge.length, curve.getLength(), curve.getLength() * 2e-4, curve.type)
  }
  // a path of curves is a wire
  const path = new THREE.CurvePath<THREE.Vector3>()
  path.add(new THREE.LineCurve3(points[0], points[1]))
  path.add(new THREE.CubicBezierCurve3(points[1], points[2], points[3], new THREE.Vector3(30, 0, 0)))
  const wire = new Wire(path)
  assert.ok(wire instanceof THREE.Line)
  close(wire.length, path.getLength(), path.getLength() * 2e-4)
  // and an edge is one of three's curves again, for TubeGeometry and the like
  const spline = new Spline(points)
  assert.ok(spline.curve instanceof THREE.Curve)
  closeVector(spline.curve.getPoint(1), points[3], 1e-9)
  const tube = new THREE.TubeGeometry(spline.curve, 32, 0.5, 8)
  assert.ok(tube.getAttribute('position').count > 0)
})

test('rays are axes, matrices are placements and locations', () => {
  // a profile beside y (in the XY plane, where sketches lie), placed by a matrix and revolved about
  // three's y axis: a ring, as LatheGeometry turns its points about y
  const profile = new Rectangle(4, 10).on(new THREE.Matrix4().makeTranslation(12, 0, 0))
  closeBox(profile.bbox(), box([10, -5, 0], [14, 5, 0]))
  const ring = profile.revolve(new THREE.Ray(new THREE.Vector3(), Y))
  close(ring.volume, Math.PI * (14 ** 2 - 10 ** 2) * 10, 1e-6)
  closeBox(ring.bbox(), box([-14, -5, -14], [14, 5, 14]))
  const grid = GridLocations(10, 20, 2, 2)
  assert.equal(grid.length, 4)
  for (const m of grid) assert.ok(m instanceof THREE.Matrix4)
  // (in the XY plane, where sketches lie)
  const at = grid.map((m) => new THREE.Vector3().setFromMatrixPosition(m)).sort((a, b) => a.x - b.x || a.y - b.y)
  closeVector(at[0], { x: -5, y: -10, z: 0 })
  closeVector(at[3], { x: 5, y: 10, z: 0 })
  for (const m of PolarLocations(10, 6)) close(new THREE.Vector3().setFromMatrixPosition(m).length(), 10)
})

test('nothing of smlibwasm comes out of the package', () => {
  const hole = new Cylinder(5, 5, 20)
  hole.rotation.x = Math.PI / 2 // (along z, through the plate lying in XY)
  const plate = new Box(60, 40, 8).cut(hole.at(GridLocations(40, 20, 2, 2)))
  const part = plate.fillet(plate.edges().parallelTo(new THREE.Vector3(0, 0, 1)), 3)
  const face = part.faces().largest()
  const edge = part.edges().first
  const results: unknown[] = [
    part,
    part.faces(),
    part.edges(),
    part.vertices(),
    part.wires(),
    face,
    edge,
    part.vertices().first,
    part.bbox(),
    part.getCenter(),
    part.massProperties(),
    part.split(new THREE.Plane(Y, 0), 'both'),
    part.section(new THREE.Plane(Y, 0)),
    face.plane,
    face.outerWire(),
    face.neighbors(),
    edge.faces(),
    edge.vertices(),
    edge.curve,
    edge.reversed(),
    new Circle(3).extrude(2),
  ]
  for (const [i, r] of results.entries()) noKernel(r, `result ${i}`)
  assert.ok(part.faces() instanceof ShapeList)
  assert.ok(part.faces().first instanceof BrepFace)
  assert.ok(part.edges().first instanceof BrepEdge)
  assert.ok(part.vertices().first instanceof BrepVertex)
  assert.ok(part.section(new THREE.Plane(Y, 0)) instanceof Sketch)
  assert.ok(part instanceof Part)
})

test("the kernel's errors are the package's own", () => {
  const part = new Box(10, 10, 10)
  let error: unknown
  try {
    part.fillet(part.edges(), 20)
  } catch (e) {
    error = e
  }
  assert.ok(error instanceof ModelingError, String(error))
  assert.ok(!(error instanceof sm.ModelingError))
  noKernel(error, 'error')
  assert.equal((error as Error).cause, undefined)
})

test("no name the package exports is one of three's, nor of the addons it is used beside", async () => {
  // (three's core, and the addons whose names the package's would have taken: FontLoader's Font,
  // USDLoader, ConvexHull's Face; imported here only, as an app imports them)
  const theirs = new Map<string, string>()
  for (const from of ['three', 'three/addons/loaders/FontLoader.js', 'three/addons/loaders/USDLoader.js', 'three/addons/math/ConvexHull.js']) {
    const loaded = (await import(from)) as Record<string, unknown>
    for (const name of Object.keys(loaded)) if (name !== 'default') theirs.set(name, from)
  }
  for (const name of ['Line', 'Sphere', 'Triangle', 'Font', 'Face', 'USDLoader']) assert.ok(theirs.has(name), name)
  // the values of every entry point of the package ('.', './init', './worker')
  const entries: Record<string, Record<string, unknown>> = {
    '.': await import('../src/index.ts'),
    './init': await import('../src/init.ts'),
    './worker': await import('../src/worker.ts'),
  }
  let count = 0
  for (const [entry, loaded] of Object.entries(entries)) {
    for (const name of Object.keys(loaded)) {
      count++
      assert.ok(!theirs.has(name), `${entry} exports ${name}, as ${theirs.get(name)} does`)
    }
  }
  assert.ok(count > 100, `${count} exports`)
  // and its types, which have no value to look for: the names index.ts exports as types
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const types = [...source.matchAll(/\btype\s+(?:\{([^}]*)\}|(\w+))/g)].flatMap(([, list, one]) => (one ? [one] : list.split(',').map((n) => n.trim())).filter((n) => n !== ''))
  assert.ok(types.includes('BallOptions') && types.includes('USDBrepLoaderOptions'), types.join(' '))
  for (const name of types) assert.ok(!theirs.has(name), `the package exports the type ${name}, a name of ${theirs.get(name)}'s`)
})
