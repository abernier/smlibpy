// tests/test_sheet_metal.py: sheet metal, exact bends with radius and K-factor, flanges, unfolding
// and flat patterns.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModelingError, ext, setWarningHandler } from '../src/kernel.ts'
import { Axis, Plane, X, Y, type VectorLike } from '../src/geometry.ts'
import { Align } from '../src/align.ts'
import { type Edge, type Face, type Part, type ShapeList, type Sketch, Wire } from '../src/shapes.ts'
import { Box, Cylinder } from '../src/parts.ts'
import { CenterArc, Line } from '../src/curves.ts'
import { Rectangle, makeFace } from '../src/sketches.ts'
import * as sheetmetal from '../src/sheetmetal.ts'
import { bendAllowance, bendDeduction, developedLength, flange, flatPattern, fold, unfold } from '../src/sheetmetal.ts'
import { approx } from './_approx.ts'

const T = 2.0
const R = 2.0
const K = 0.44
const ALONG_Y: VectorLike = [0, 1, 0]

const radians = (deg: number) => (deg * Math.PI) / 180

/** pytest.approx(expected, abs=tol): within `tol`, no relative tolerance. */
function near(actual: number, expected: number, tol: number): void {
  approx(actual, expected, 0, tol)
}

/** pytest.approx on a sequence: element by element, the lengths equal. */
function approxAll(actual: readonly number[], expected: readonly number[], rel = 1e-6, abs = 1e-12): void {
  assert.equal(actual.length, expected.length, `${actual.length} values, expected ${expected.length}`)
  actual.forEach((a, i) => approx(a, expected[i], rel, abs))
}

function nearAll(actual: readonly number[], expected: readonly number[], tol: number): void {
  approxAll(actual, expected, 0, tol)
}

/** pytest.raises(kind, match=pattern). */
function raises(fn: () => unknown, kind: abstract new (...args: never[]) => Error, pattern: RegExp): Error {
  let error: unknown = null
  try {
    fn()
  } catch (e) {
    error = e
  }
  assert.ok(error !== null, `nothing was thrown, expected a ${kind.name}`)
  assert.ok(error instanceof kind, `expected a ${kind.name}, got ${String(error)}`)
  assert.match(error.message, pattern)
  return error
}

/** pytest.warns(match=pattern): `fn` gives a warning that matches. */
function warns<T>(fn: () => T, pattern: RegExp): T {
  const said: string[] = []
  setWarningHandler((message) => said.push(message))
  try {
    const out = fn()
    assert.ok(
      said.some((m) => pattern.test(m)),
      `no warning matches ${pattern}: ${JSON.stringify(said)}`,
    )
    return out
  } finally {
    setWarningHandler((message) => console.warn(message))
  }
}

/** A sheet on XY, from z = 0 to t. */
function plate(length = 100.0, width = 40.0, t = T): Part {
  return Box(length, width, t, { align: [Align.CENTER, Align.CENTER, Align.MIN] })
}

function allowance(angle: number, r = R, t = T, k = K): number {
  return radians(angle) * (r + k * t)
}

/** A bend stretches the material outside the neutral fiber: the strip of area A (in the flat)
 * gains A * t^2 * (0.5 - k) / (r + k * t). */
function bentVolume(flatVolume: number, stripArea: number, r = R, t = T, k = K): number {
  return flatVolume + (stripArea * t * t * (0.5 - k)) / (r + k * t)
}

/** Volume integrated finely enough to compare with the formulas (the default accuracy, 1e-7,
 * gives about 1e-9 relative error on the bend cylinders). */
function volume(part: Part): number {
  return part.massProperties(1.0, 1e-10).volume
}

function area(face: Face): number {
  return ext.face_properties(face._f, 1e-10).area
}

function cylinders(part: Part, radius: number): Face[] {
  return part.faces().filter((f) => f.geomType === 'cylinder' && Math.abs(f.radius - radius) < 1e-9)
}

// -- formulas ---------------------------------------------------------------------------------
test('bend allowance, bend deduction and developed length', () => {
  approx(bendAllowance(90, { radius: R, thickness: T }), (Math.PI / 2) * (2 + 0.44 * 2), 1e-15)
  approx(bendAllowance(90, { radius: R, thickness: T, kFactor: 0.5 }), (Math.PI / 2) * 3, 1e-15)
  const bd = bendDeduction(90, { radius: R, thickness: T })
  approx(bd, 2 * (R + T) - allowance(90), 1e-15)
  approx(bendDeduction(60, { radius: R, thickness: T }), 2 * (R + T) * Math.tan(radians(30)) - allowance(60), 1e-15)
  approx(developedLength(30, 25, { radius: R, thickness: T }), 55 - bd, 1e-15)
  const u = developedLength(20, 50, 20, { angle: [90, 90], radius: R, thickness: T })
  approx(u, 90 - 2 * bd, 1e-15)
  raises(() => bendAllowance(0, { radius: R, thickness: T }), RangeError, /angle/)
  raises(() => bendDeduction(180, { radius: R, thickness: T }), RangeError, /below 180/)
  raises(() => bendAllowance(90, { radius: R, thickness: T, kFactor: 1.5 }), RangeError, /K-factor/)
  raises(() => developedLength(20, 50, 20, { angle: [90], radius: R, thickness: T }), RangeError, /angles/)
})

// -- bending ----------------------------------------------------------------------------------
for (const angle of [30, 45, 90, 120, 180]) {
  test(`a bend is exact (${angle} degrees)`, () => {
    // The bend zone becomes cylinders of R and R + t on the bend axis; the volume grows by the
    // stretched material only; unfolding gives the blank back.
    const blank = plate()
    const part = fold(blank, new Axis([20, 0, T], ALONG_Y), angle, { radius: R })
    assert.ok(part.isValid())
    const ba = allowance(angle)
    approx(volume(part), bentVolume(8000, ba * 40), 1e-10)
    const inner = cylinders(part, R)
    const outer = cylinders(part, R + T)
    assert.ok(inner.length === 1 && outer.length === 1)
    // the -X side (it reaches farther) stays: the axis is over the end of the bend zone, at z = t + R
    const axis = inner[0].axis
    assert.ok(axis.direction.isParallel([0, 1, 0], 1e-12))
    near(axis.distanceTo([20 - ba / 2, 0, T + R]), 0, 1e-9)
    near(outer[0].axis.distanceTo([20 - ba / 2, 0, T + R]), 0, 1e-9)
    approx(area(inner[0]), radians(angle) * R * 40, 1e-10)
    approx(area(outer[0]), radians(angle) * (R + T) * 40, 1e-10)
    const flat = unfold(part)
    approx(flat.volume, 8000, 1e-12)
    const bb = flat.bbox()
    nearAll(bb.min.toArray(), [-50, -20, 0], 1e-9)
    nearAll(bb.max.toArray(), [50, 20, T], 1e-9)
    assert.ok(flat.faces().every((f) => f.geomType === 'plane'))
  })
}

test('bend position and developed length', () => {
  const part = fold(plate(), new Axis([20, 0, T], ALONG_Y), 90, { radius: R })
  const ba = allowance(90)
  const bb = part.bbox()
  // the flange stands on the outer face of the bend: its outside at 20 - BA/2 + R + t
  near(bb.max.x, 20 - ba / 2 + R + T, 1e-9)
  // its top: axis height t + R plus the flat rest of the moving side, 30 - BA/2
  near(bb.max.z, T + R + 30 - ba / 2, 1e-9)
  // outside lengths of the two legs give back the blank length
  const legs = [bb.max.x - bb.min.x, bb.max.z - bb.min.z]
  near(developedLength(...legs, { radius: R, thickness: T }), 100, 1e-9)
})

test('bend directions and the fixed side', () => {
  const blank = plate()
  const up = fold(blank, new Axis([20, 0, T], ALONG_Y), 90, { radius: R })
  const down = fold(blank, new Axis([20, 0, T], ALONG_Y), -90, { radius: R })
  near(up.bbox().min.z, 0, 1e-9)
  assert.ok(up.bbox().max.z > 30)
  near(down.bbox().max.z, T, 1e-9)
  assert.ok(down.bbox().min.z < -27)
  // a line on the bottom face folds the other way for the same angle
  const under = fold(blank, new Axis([20, 0, 0], ALONG_Y), 90, { radius: R })
  assert.ok(under.bbox().min.z < -27)
  // the side with the point stays
  const other = fold(blank, new Axis([20, 0, T], ALONG_Y), 90, { radius: R, fixed: [40, 0, 0] })
  near(other.bbox().max.x, 50, 1e-9)
  assert.ok(other.bbox().min.x > 15)
  approx(volume(other), volume(up), 1e-10)
})

for (const [kBend, kUnfold] of [
  [0.3, 0.3],
  [0.5, 0.5],
  [0.0, 0.0],
  [1.0, 1.0],
  [0.3, 0.5],
]) {
  test(`K-factor (bent with ${kBend}, unfolded with ${kUnfold})`, () => {
    const part = fold(plate(), new Axis([0, 0, T], ALONG_Y), 90, { radius: R, kFactor: kBend })
    approx(volume(part), bentVolume(8000, allowance(90, R, T, kBend) * 40, R, T, kBend), 1e-10)
    const pattern = flatPattern(part, { kFactor: kUnfold })
    // the strip the bend took grows or shrinks with the K-factor it is unfolded with
    near(pattern.size.x, 100 + ((kUnfold - kBend) * T * Math.PI) / 2, 1e-9)
    near(pattern.size.y, 40, 1e-9)
  })
}

test('the radius range', () => {
  const blank = plate()
  const big = fold(blank, new Axis([0, 0, T], ALONG_Y), 90, { radius: 20 })
  assert.ok(cylinders(big, 20).length === 1 && cylinders(big, 22).length === 1)
  approx(unfold(big).volume, 8000, 1e-12)
  for (const r of [0.3, 0.11]) {
    // far below the thickness
    const tight = fold(blank, new Axis([0, 0, T], ALONG_Y), 90, { radius: r })
    assert.equal(cylinders(tight, r).length, 1)
    // The side faces of the unfolded bend zone are trimmed by curves that miss their straight
    // edges (0.5 % of the face at r = 0.3), so the faces do not close up and the volume says so.
    warns(() => approx(unfold(tight).volume, 8000, 1e-12), /do not meet exactly/)
  }
  raises(() => fold(blank, new Axis([0, 0, T], ALONG_Y), 90, { radius: 0.1 }), ModelingError, /too small/)
})

test('an oblique bend line is exact', () => {
  // A bend line at 45 degrees: the bend faces are still exact cylinders (only the side faces cut
  // obliquely through the bend zone become NURBS).
  const blank = plate()
  const part = fold(blank, new Axis([0, 0, T], [1, 1, 0]), 90, { radius: R })
  assert.ok(cylinders(part, R).length === 1 && cylinders(part, R + T).length === 1)
  const strip = allowance(90) * 40 * Math.sqrt(2)
  approx(part.volume, bentVolume(8000, strip), 1e-6)
  approx(unfold(part).volume, 8000, 1e-6)
})

test('a partial bend needs relief cuts', () => {
  const blank = plate()
  raises(() => fold(blank, Line([25, -10, T], [25, 10, T]), 90, { radius: R, partial: true }), ModelingError, /not cut free/)
  const slotted = blank.cut(Box(31, 1, 10).translate(35, 10.5, 0)).cut(Box(31, 1, 10).translate(35, -10.5, 0))
  const tab = fold(slotted, Line([25, -10, T], [25, 10, T]), 90, { radius: R, partial: true })
  approx(volume(tab), bentVolume(volume(slotted), allowance(90) * 20), 1e-10)
  const found = tab.bends()
  assert.equal(found.length, 1)
  const only = found[0]
  near(only.length, 20, 1e-9)
  near(only.angle, 90, 1e-9)
  near(tab.bbox().max.z, T + R + 25 - allowance(90) / 2, 1e-9)
  approx(unfold(tab).volume, slotted.volume, 1e-9)
})

test('bending a flange again', () => {
  const part = fold(plate(), new Axis([20, 0, T], ALONG_Y), 90, { radius: R })
  // the inside face of the flange is at x = 20 - BA/2 + R; bend it 15 above the plate
  const x = 20 - allowance(90) / 2 + R
  const hook = fold(part, new Axis([x, 0, 15], ALONG_Y), 90, { radius: R, fixed: [0, 0, 0] })
  nearAll(
    hook.bends().map((b) => b.radius),
    [R, R],
    1e-9,
  )
  const pattern = flatPattern(hook)
  approx(pattern.part.volume, 8000, 1e-12)
  const xs = pattern.bends.map((b) => (b.line as Edge).start.x).sort((p, q) => p - q)
  // in the flat: the first bend line at 70; the second is where the line was drawn, 15 - (t + R)
  // above the end of the first bend zone (the flange's inside face starts at height t + R)
  nearAll(xs, [70, 70 + allowance(90) / 2 + 15 - (T + R)], 1e-9)
})

test('a hole in a flange and across a bend', () => {
  const holed = plate().cut(Cylinder(5, 10).translate(35, 0, 0))
  let part = fold(holed, new Axis([20, 0, T], ALONG_Y), 90, { radius: R })
  let flat = unfold(part)
  nearAll(flat.bbox().max.toArray(), [50, 20, T], 1e-9)
  assert.equal(flat.faces().filter((f) => f.geomType === 'cylinder').length, 1)
  approx(flat.volume, holed.volume, 1e-7)
  const contour = flatPattern(part).outline // exact lines and the circle, collinear pieces joined
  assert.deepEqual(
    contour
      .edges()
      .map((e) => e.geomType)
      .sort(),
    ['circle', 'line', 'line', 'line', 'line'],
  )
  const circles = contour.edges().circles()
  assert.equal(circles.length, 1)
  const hole = circles[0]
  near(hole.radius, 5, 1e-9)
  approxAll(hole.arcCenter.toArray(), [85, 20, 0])
  // a hole across the bend zone: its walls in the zone become NURBS (within 1e-4)
  const across = plate().cut(Cylinder(5, 10).translate(20, 0, 0))
  part = fold(across, new Axis([20, 0, T], ALONG_Y), 90, { radius: R })
  assert.ok(part.isValid() && part.faces().some((f) => f.geomType === 'bspline'))
  flat = unfold(part)
  approx(flat.mesh(0.001).volume, 8000 - Math.PI * 25 * T, 1e-5)
})

test('bend errors', () => {
  const blank = plate()
  raises(() => fold(blank, new Axis([20, 0, 5], ALONG_Y), 90, { radius: R }), ModelingError, /does not lie on a face/)
  raises(() => fold(blank, new Axis([60, 0, T], ALONG_Y), 90, { radius: R }), ModelingError, /does not cross the sheet/)
  raises(() => fold(blank, new Axis([49, 0, T], ALONG_Y), 90, { radius: R }), ModelingError, /does not cut the sheet in two/)
  raises(() => fold(blank, new Axis([20, 0, T], ALONG_Y), 0, { radius: R }), RangeError, /angle/)
  raises(() => fold(blank, new Axis([20, 0, T], ALONG_Y), 200, { radius: R }), RangeError, /angle/)
  raises(() => fold(blank, new Axis([20, 0, T], ALONG_Y), 90, { radius: R, kFactor: -0.1 }), RangeError, /K-factor/)
  raises(() => fold(blank, CenterArc([0, 0, T], 10, 0, 90), 90, { radius: R }), RangeError, /straight/)
  raises(() => fold(blank, new Axis([20, 0, T], ALONG_Y), 90, { radius: R, partial: true }), RangeError, /partial/)
  // (a sketch is no Part: Python's TypeError, which TypeScript would already refuse)
  const sketch: unknown = Rectangle(10, 10)
  raises(() => fold(sketch as Part, new Axis([0, 0, 0], ALONG_Y), 90, { radius: R }), TypeError, /Part/)
})

// -- flanges ----------------------------------------------------------------------------------
/** The edge of the base plate's top face (z = t) at x (along Y) or at y (along X). */
function topEdge(part: Part, at: { x?: number; y?: number }): ShapeList<Edge> {
  const edges = part.edges().filter((e) => Math.abs(e.start.z - T) < 1e-9 && Math.abs(e.end.z - T) < 1e-9)
  const { x, y } = at
  if (x !== undefined) return edges.filterBy(Y).filter((e) => Math.abs(e.start.x - x) < 1e-9)
  return edges.filterBy(X).filter((e) => Math.abs(e.start.y - (y as number)) < 1e-9)
}

test('flange dimensions', () => {
  const base = plate(100, 60)
  const part = flange(base, topEdge(base, { x: 50 }), 20, { radius: R })
  const bb = part.bbox()
  // the bend starts at the edge: the outside of the flange is R + t beyond it, its top 20 high
  near(bb.max.x, 50 + R + T, 1e-9)
  near(bb.max.z, 20, 1e-9)
  const leg = 20 - (R + T)
  approx(volume(part), bentVolume(12000 + (allowance(90) + leg) * 60 * T, allowance(90) * 60), 1e-10)
  const found = part.bends()
  assert.equal(found.length, 1)
  const b = found[0]
  near(b.angle, 90, 1e-9)
  near(b.radius, R, 1e-12)
  // 45 degrees: the length runs from the virtual sharp on the outer face along the flange
  const tilted = flange(base, topEdge(base, { x: 50 }), 20, { angle: 45, radius: R })
  const sharp = 50 + (R + T) * Math.tan(radians(22.5))
  near(tilted.bbox().max.x, sharp + 20 * Math.cos(radians(45)), 1e-9)
  const down = flange(base, topEdge(base, { x: 50 }), 20, { angle: -90, radius: R })
  near(down.bbox().min.z, T - 20, 1e-9)
})

test('a box from four flanges', () => {
  const base = plate(100, 60)
  let box = flange(base, topEdge(base, { x: 50 }), 20, { radius: R })
  box = flange(box, topEdge(box, { x: -50 }), 20, { radius: R })
  box = flange(box, topEdge(box, { y: 30 }), 20, { radius: R })
  box = flange(box, topEdge(box, { y: -30 }), 20, { radius: R })
  assert.ok(box.isValid() && box.bends().length === 4)
  const bb = box.bbox()
  nearAll(bb.size.toArray(), [100 + 2 * (R + T), 60 + 2 * (R + T), 20], 1e-9)
  const pattern = flatPattern(box)
  const reach = allowance(90) + 20 - (R + T)
  nearAll([pattern.size.x, pattern.size.y], [100 + 2 * reach, 60 + 2 * reach], 1e-9)
  assert.deepEqual(
    pattern.bends.map((b) => b.direction),
    ['up', 'up', 'up', 'up'],
  )
  approx(pattern.part.volume, T * (100 * 60 + 2 * reach * (100 + 60)), 1e-9)
})

test('flange errors', () => {
  const base = plate(100, 60)
  raises(() => flange(base, topEdge(base, { x: 50 }), 3, { radius: R }), ModelingError, /setback/)
  raises(() => flange(base, base.edges().filterBy(Y), 20, { radius: R }), RangeError, /one edge/)
  raises(() => flange(base, topEdge(base, { x: 50 }), 20, { angle: 180, radius: R }), RangeError, /angle/)
  const roundPlate = Cylinder(30, T, { align: [Align.CENTER, Align.CENTER, Align.MIN] })
  raises(() => flange(roundPlate, roundPlate.edges().top(), 20, { radius: R }), RangeError, /straight/)
})

// -- unfolding and flat patterns --------------------------------------------------------------
test('U and Z channels unfold', () => {
  const blank = plate()
  const u = fold(fold(blank, new Axis([-30, 0, T], ALONG_Y), 90, { radius: R }), new Axis([30, 0, T], ALONG_Y), 90, { radius: R })
  const z = fold(fold(blank, new Axis([-30, 0, T], ALONG_Y), 90, { radius: R }), new Axis([30, 0, T], ALONG_Y), -90, { radius: R })
  const cases: [Part, string[]][] = [
    [u, ['up', 'up']],
    [z, ['down', 'up']],
  ]
  for (const [part, directions] of cases) {
    const pattern = flatPattern(part)
    approx(pattern.part.volume, 8000, 1e-12)
    nearAll(pattern.size.toArray(), [100, 40, T], 1e-9)
    assert.deepEqual(pattern.bends.map((b) => b.direction).sort(), [...directions].sort())
    nearAll(
      pattern.bends.map((b) => (b.line as Edge).start.x).sort((p, q) => p - q),
      [20, 80],
      1e-9,
    )
    for (const b of pattern.bends) near((b.line as Edge).length, 40, 1e-9)
    approx(pattern.outline.area, 4000, 1e-12)
  }
})

test('a box from a relieved cross blank', () => {
  const relief = 3
  let cross: Sketch = Rectangle(100, 80)
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      cross = cross.cut(Rectangle(20 + relief, 20 + relief).translate(sx * (50 - (20 + relief) / 2), sy * (40 - (20 + relief) / 2)))
    }
  }
  const blank = cross.extrude(T)
  let box = blank
  for (const line of [
    Line([-27, 20, T], [27, 20, T]),
    Line([-27, -20, T], [27, -20, T]),
    Line([30, -17, T], [30, 17, T]),
    Line([-30, -17, T], [-30, 17, T]),
  ]) {
    box = fold(box, line, 90, { radius: R, fixed: [0, 0, 0], partial: true })
  }
  assert.ok(box.isValid() && box.bends().length === 4)
  const pattern = flatPattern(box)
  approx(pattern.part.volume, blank.volume, 1e-12)
  nearAll(pattern.size.toArray(), [100, 80, T], 1e-9)
  approx(pattern.outline.area, blank.volume / T, 1e-9)
  // the cross with notched corners
  assert.deepEqual(
    pattern.outline.edges().map((e) => e.geomType),
    new Array(12).fill('line'),
  )
  // (rounded to 9 decimals, as Python does, and compared exactly; + 0 makes -0 a 0)
  const round9 = (v: number) => Number(v.toFixed(9)) + 0
  const lines = pattern.bends
    .map((b) => {
      const c = (b.line as Edge).center()
      return [round9(c.x), round9(c.y)]
    })
    .sort((p, q) => p[0] - q[0] || p[1] - q[1])
  assert.deepEqual(lines, [
    [20, 40],
    [50, 20],
    [50, 60],
    [80, 40],
  ])
})

test('unfold an extruded L profile', () => {
  // A sheet metal part that was not made by fold(): an L profile with an inside radius.
  const t = T
  const r = R
  // (Python passes the edges as a list; makeFace makes a Wire of them)
  const profile: Sketch = makeFace(
    new Wire([
      Line([0, r + t], [0, 25]),
      Line([0, 25], [t, 25]),
      Line([t, 25], [t, r + t]),
      CenterArc([r + t, r + t], r, 180, 90),
      Line([r + t, t], [30, t]),
      Line([30, t], [30, 0]),
      Line([30, 0], [r + t, 0]),
      CenterArc([r + t, r + t], r + t, 270, -90),
    ]),
  )
  const part = Plane.XZ.mul(profile).extrude(40)
  const found = part.bends()
  assert.equal(found.length, 1)
  const b = found[0]
  nearAll([b.angle, b.radius, b.thickness, b.length], [90, r, t, 40], 1e-9)
  for (const k of [0.3, 0.44, 0.5]) {
    const pattern = flatPattern(part, { kFactor: k })
    near(pattern.size.x, developedLength(30, 25, { radius: r, thickness: t, kFactor: k }), 1e-9)
    near(pattern.size.y, 40, 1e-9)
  }
})

test('the flat pattern of a flat part, and a part that is not sheet metal', () => {
  const pattern = flatPattern(Box(10, 20, 2))
  nearAll(pattern.size.toArray(), [20, 10, 2], 1e-12)
  assert.deepEqual(pattern.bends, [])
  const sharpL = plate().fuse(Box(T, 40, 30, { align: [Align.MAX, Align.CENTER, Align.MIN] }).translate(50, 0, 0))
  raises(() => unfold(sharpL), ModelingError, /deep across the fixed face/) // a corner without a bend radius does not unfold
})

test('unfold keeps the fixed face', () => {
  const part = fold(plate(), new Axis([20, 0, T], ALONG_Y), 90, { radius: R })
  const flangeFace = part
    .faces()
    .filter((f) => f.geomType === 'plane' && f.normalAt().x > 0.99)
    .largest()
  const flat = unfold(part, { fixed: flangeFace })
  // the flange stays standing: the flat now lies in its plane
  near(flat.bbox().size.x, T, 1e-9)
  near(flat.bbox().size.z, 100, 1e-9)
  raises(() => unfold(part, { fixed: cylinders(part, R)[0] }), RangeError, /planar face/)
})

test('the Part methods', () => {
  const blank = plate()
  const part = blank.fold(new Axis([20, 0, T], ALONG_Y), 90, { radius: R })
  approx(part.bends()[0].allowance, allowance(90), 1e-15)
  approx(part.unfold().volume, 8000, 1e-12)
  nearAll(part.flatPattern().size.toArray(), [100, 40, T], 1e-9)
  const base = plate(100, 60)
  near(base.flange(topEdge(base, { x: 50 }), 20, { radius: R }).bbox().max.z, 20, 1e-9)
  assert.equal(sheetmetal.K_FACTOR, K)
})

// -- the module's example ---------------------------------------------------------------------
// Python runs it in an MCP session (and checks that the docs index finds the sheet metal pages);
// smlibjs has no MCP server, so the script runs here as it is.
test('bend and unfold as the example does', () => {
  const blank = Box(100, 40, 2, { align: [Align.CENTER, Align.CENTER, Align.MIN] })
  const bracket = fold(blank, new Axis([20, 0, 2], [0, 1, 0]), 90, { radius: 2 })
  const pattern = flatPattern(bracket)
  assert.equal(bracket.bends().length, 1)
  assert.equal(Number(pattern.part.volume.toFixed(9)), 8000)
  assert.deepEqual(
    pattern.bends.map((b) => b.direction),
    ['up'],
  )
  near(unfold(bracket).bbox().size.x, 100, 1e-9)
  const bad = raises(() => fold(blank, new Axis([49, 0, 2], [0, 1, 0]), 90, { radius: 2 }), ModelingError, /./)
  assert.equal(bad.name, 'ModelingError')
})
