// tests/test_draft.py: draft analysis, parting lines and face drafts: Part.draftAnalysis,
// Part.partingLine, Part.draft.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelingError } from '../src/kernel.ts'
import { Plane, type Vector, type VectorLike, X, Y, Z } from '../src/geometry.ts'
import { Align } from '../src/align.ts'
import { type Face, type Part, ShapeList, type Wire } from '../src/shapes.ts'
import { Box, Cylinder, Sphere, Torus } from '../src/parts.ts'
import { RoundedRectangle } from '../src/sketches.ts'
import { exportStep } from '../src/exporters.ts'
import { importStep } from '../src/step_import.ts'
import { ANGLE_TOLERANCE, DraftAnalysis, _setTangency } from '../src/draft.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: test helpers
type Any = any

/** pytest.raises: `fn` throws an instance of `cls` whose message matches. */
function raises(fn: () => unknown, cls: abstract new (...args: Any[]) => Error, match?: RegExp): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof cls, `expected a ${cls.name}, got ${String(e)}`)
    if (match) assert.match((e as Error).message, match)
    return true
  })
}

/** Python's round(v, 9), without -0. */
function round9(v: number): number {
  return Math.round(v * 1e9) / 1e9 + 0
}

test('box faces by draft', () => {
  const box = Box(40, 30, 20)
  const da = box.draftAnalysis(Z) as DraftAnalysis
  assert.ok(da instanceof DraftAnalysis && da.length === 6 && !da.ok)
  assert.ok(da.positive.length === 1)
  approx(da.positive.one().center().z, 10)
  assert.ok(da.undercut.length === 1)
  approx(da.undercut.one().center().z, -10)
  assert.ok(da.vertical.length === 4 && da.insufficient.length === 0)
  const [lo, hi] = da.angles(box.faces().top().one())
  approx(lo, 90.0, 0, 1e-12)
  approx(hi, 90.0, 0, 1e-12)
  for (const f of da.vertical) {
    const [a, b] = da.angles(f)
    assert.ok(Math.abs(a) <= ANGLE_TOLERANCE && Math.abs(b) <= ANGLE_TOLERANCE)
  }
  // the groups are faces of the part, usable as selections
  assert.ok(da.vertical instanceof ShapeList && da.vertical.every((f) => f.owner === box))
  // a sideways pull
  const side = box.draftAnalysis(X) as DraftAnalysis
  assert.equal(side.positive.length, 1)
  approx(side.positive.one().center().x, 20)
})

test('tapered walls have exactly their draft', () => {
  const core = RoundedRectangle(60, 40, 5).extrude(20, { taper: 3 })
  const da = core.draftAnalysis(Z, { minAngle: 1 }) as DraftAnalysis
  const walls = [...da].filter((fd) => fd.face.geomType !== 'plane' || Math.abs(fd.face.normalAt().z) < 0.5)
  assert.equal(walls.length, 8)
  for (const fd of walls) {
    approx(fd.minAngle, 3.0, 0, 1e-9)
    approx(fd.maxAngle, 3.0, 0, 1e-9)
    assert.equal(fd.kind, 'positive')
  }
  const strict = core.draftAnalysis(Z, { minAngle: 5 }) as DraftAnalysis
  assert.equal(strict.insufficient.length, 8)
  assert.equal((core.draftAnalysis(Z.neg()) as DraftAnalysis).undercut.length, 9) // the walls and the top turn away from -Z
})

test('curved faces report their range', () => {
  const sphere = Sphere(10)
  const fd = (sphere.draftAnalysis(Z) as DraftAnalysis).faces[0]
  assert.equal(fd.kind, 'undercut')
  approx(fd.minAngle, -90, 0, 1e-6)
  approx(fd.maxAngle, 90, 0, 1e-6)
  const coneLike = Cylinder(10, 20).draftAnalysis(Y) as DraftAnalysis
  const side = [...coneLike].filter((x) => x.face.geomType === 'cylinder')[0]
  approx(side.minAngle, -90, 0, 1e-6)
  approx(side.maxAngle, 90, 0, 1e-6)
})

test('draftAnalysis errors', () => {
  const box = Box(10, 10, 10)
  raises(() => box.draftAnalysis([0, 0, 0]), RangeError)
  raises(() => box.draftAnalysis(Z, { minAngle: 90 }), RangeError)
  raises(() => box.draftAnalysis(Z, { minAngle: -1 }), RangeError)
  raises(() => (box.draftAnalysis(Z) as DraftAnalysis).angles(Box(1, 1, 1).faces()[0]), RangeError)
})

// -- parting lines ---------------------------------------------------------------------------
function points(wire: Wire, n = 64): Vector[] {
  return Array.from({ length: n + 1 }, (_, i) => wire.pointAt(i / n))
}

test('the parting line of a sphere is its equator', () => {
  const lines = Sphere(10).partingLine(Z)
  assert.equal(lines.length, 1)
  const w = lines[0]
  assert.ok(w.isClosed)
  approx(w.length, 2 * Math.PI * 10, 1e-9)
  for (const e of w.edges()) {
    assert.equal(e.geomType, 'circle')
    approx(e.radius, 10, 0, 1e-12)
  }
  assert.ok(points(w).every((p) => Math.abs(p.z) <= 1e-12 && Math.abs(p.length - 10) <= 1e-12))
  const tilted = Sphere(10).partingLine([1, 1, 1])[0]
  const n = 1 / Math.sqrt(3)
  assert.ok(points(tilted).every((p) => Math.abs(p.x * n + p.y * n + p.z * n) <= 1e-9))
})

test('the parting line of cylinders', () => {
  const upright = Cylinder(5, 20).partingLine(Z)
  assert.equal(upright.length, 1) // walls without draft: the line runs along their far end
  const w = upright[0]
  approx(w.length, 2 * Math.PI * 5, 1e-9)
  approx(w.bbox().max.z, -10)
  assert.equal(w.edges().one().geomType, 'circle')
  approx(w.edges().one().radius, 5, 0, 1e-12)
  const lying = Cylinder(5, 20).rotate(Y, 90).partingLine(Z)[0]
  assert.ok(lying.isClosed)
  approx(lying.length, 40 + 10 * Math.PI, 1e-9)
  const contour = lying.edges().filter((e) => e._isStraight())
  assert.equal(contour.length, 2)
  assert.deepEqual(
    contour.map((e) => round9(e.center().y)).sort((a, b) => a - b),
    [-5.0, 5.0],
  )
  for (const e of contour) {
    assert.ok(Math.abs(e.center().z) <= 1e-9)
    approx(e.length, 20, 1e-9)
  }
})

test('the parting line of tori', () => {
  const upright = Torus(20, 5).partingLine(Z)
  const circles = upright.map((w) => w.edges().one()).sort((a, b) => a.radius - b.radius)
  assert.deepEqual(
    circles.map((e) => e.geomType),
    ['circle', 'circle'],
  )
  approx(circles[0].radius, 15, 0, 1e-12)
  approx(circles[1].radius, 25, 0, 1e-12)
  assert.ok(circles.every((e) => Math.abs(e.arcCenter.z) <= 1e-12))
  const tilted = Torus(20, 5).rotate(X, 30)
  const line = tilted.partingLine(Z) // traced: the outer and the inner contour
  // A traced line closes within the trace's fit tolerance (1e-6 of the part's size), which can be
  // more than Wire.isClosed allows (on Linux on ARM a gap of a few 1e-5 mm).
  const traceTol = 1e-6 * tilted.bbox().diagonal
  assert.ok(line.length === 2 && line.every((w) => w.start.distanceTo(w.end) <= 10 * traceTol))
  const face = tilted.faces()[0]
  for (const w of line) {
    for (const p of points(w, 200)) {
      assert.ok(face.distanceTo(p) <= 1e-4 && Math.abs(face.normalAt(p).z) <= 1e-4)
    }
  }
})

test('the parting line of an open box and a drafted core', () => {
  const cup = Box(40, 30, 20).cut(Box(30, 20, 15, { align: [Align.CENTER, Align.CENTER, Align.MAX] }).translate(0, 0, 10))
  const lines = cup.partingLine(Z)
  assert.equal(lines.length, 1)
  approx(lines[0].length, 140)
  approx(lines[0].bbox().max.z, -10)
  const core = RoundedRectangle(60, 40, 5).extrude(20, { taper: 3 })
  const rim = core.partingLine(Z)
  assert.equal(rim.length, 1)
  approx(rim[0].bbox().max.z, 0, 0, 1e-9)
  approx(rim[0].length, 2 * (50 + 30) + 2 * Math.PI * 5, 1e-9)
})

test('partingLine errors', () => {
  raises(() => Box(10, 10, 10).partingLine([0, 0, 0]), RangeError)
})

// -- what Python's MCP session test models (the session and the guide search are Python's) ----
test('a drafted core by groups, the length of a parting line, a zero direction', () => {
  const core = RoundedRectangle(60, 40, 5).extrude(20, { taper: 3 })
  const da = core.draftAnalysis(Z, { minAngle: 1 }) as DraftAnalysis
  assert.deepEqual([da.positive.length, da.vertical.length, da.undercut.length], [9, 0, 1])
  assert.equal(Sphere(10).partingLine(Z)[0].length.toFixed(6), '62.831853')
  raises(() => core.partingLine([0, 0, 0]), RangeError)
})

// -- face drafts -----------------------------------------------------------------------------
// Kernel results differ in the last bits between platforms (and runs): measures are compared with
// a relative tolerance, never exactly.

/** The faces of a part that run along Z: walls, holes and the rounds between walls. */
function walls(part: Part): ShapeList<Face> {
  return part.faces().filter((f) => Math.abs(f.normalAt(f.interiorPoint()).z) < 1e-9)
}

/** Volume of a solid whose cross-section area is quadratic in the height. */
function prismatoid(h: number, bottom: number, middle: number, top: number): number {
  return (h / 6) * (bottom + 4 * middle + top)
}

/** The (least, greatest) draft angle of every face that is neither a top nor a bottom. */
function draftedAngles(part: Part, direction: VectorLike | typeof Z = Z): [number, number][] {
  return [...(part.draftAnalysis(direction) as DraftAnalysis)].filter((fd) => Math.abs(fd.minAngle) < 89).map((fd) => [fd.minAngle, fd.maxAngle])
}

/** Pairs sorted as Python sorts tuples. */
function sortedPairs(pairs: [number, number][]): [number, number][] {
  return pairs.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

const tan3 = Math.tan((3 * Math.PI) / 180)

test('draft: box walls keep the top and grow the bottom', () => {
  const box = Box(40, 30, 20)
  const t = tan3
  for (const neutral of [Plane.XY.offset(10), box.faces().top()]) {
    // a plane, or the top face (normal +Z)
    const drafted = box.draft(walls(box), 3, neutral as Plane)
    assert.ok(drafted.isValid() && drafted.faces().length === 6)
    approx(drafted.faces().top().one().area, 40 * 30, 1e-9)
    approx(drafted.faces().bottom().one().area, (40 + 40 * t) * (30 + 40 * t), 1e-9)
    approx(drafted.volume, prismatoid(20, (40 + 40 * t) * (30 + 40 * t), (40 + 20 * t) * (30 + 20 * t), 40 * 30), 1e-7)
    const bb = drafted.bbox()
    approx(bb.min.z, -10)
    approx(bb.max.z, 10)
    approx(bb.max.x - bb.min.x, 40 + 40 * t, 1e-9)
    // every wall now has 3 degrees of draft for a mold that moves up
    const angles = draftedAngles(drafted)
    assert.equal(angles.length, 4)
    for (const [lo, hi] of angles) {
      approx(lo, 3, 0, 1e-6)
      approx(hi, 3, 0, 1e-6)
    }
  }
  // The bottom keeps its size when it is the neutral plane, and the top shrinks.
  const drafted = box.draft(walls(box), 3, Plane.XY.offset(-10))
  approx(drafted.faces().bottom().one().area, 40 * 30, 1e-9)
  approx(drafted.faces().top().one().area, (40 - 40 * t) * (30 - 40 * t), 1e-9)
  // A face as the neutral plane pulls along its outward normal: down for the bottom face.
  const down = box.draft(walls(box), 3, box.faces().bottom() as unknown as Face)
  approx(down.faces().top().one().area, (40 + 40 * t) * (30 + 40 * t), 1e-9)
  for (const [lo] of draftedAngles(down, Z.neg())) approx(lo, 3, 0, 1e-6)
  // The original part does not change.
  approx(box.volume, 24000, 1e-12)
  assert.equal(walls(box).length, 4)
})

test('draft about a plane through the walls', () => {
  const box = Box(40, 30, 20)
  const t = tan3
  const drafted = box.draft(walls(box), 3, Plane.XY) // the upper half narrows, the lower half widens
  approx(drafted.faces().top().one().area, (40 - 20 * t) * (30 - 20 * t), 1e-9)
  approx(drafted.faces().bottom().one().area, (40 + 20 * t) * (30 + 20 * t), 1e-9)
  approx(drafted.volume, 24000 + (8000 * t * t) / 3, 1e-7)
  // Against a tilted pull direction two of the walls have draft already: 3 degrees more.
  const pull = [0, 0.2, 1]
  const tilted = box.draft(walls(box), 3, new Plane([0, 0, -10], null, pull))
  assert.ok(tilted.isValid() && tilted.faces().length === 6)
  const before = (Math.asin(0.2 / Math.hypot(0.2, 1)) * 180) / Math.PI
  const analysis = tilted.draftAnalysis(pull) as DraftAnalysis
  const angles = sortedPairs(tilted.faces().filter((f) => Math.abs(f.normalAt().z) < 0.5).map((f) => analysis.angles(f)))
  const expected = [-before + 3, 3, 3, before + 3].sort((a, b) => a - b)
  angles.forEach(([lo, hi], i) => {
    approx(lo, expected[i], 0, 1e-6)
    approx(hi, expected[i], 0, 1e-6)
  })
})

test('draft opens a pocket', () => {
  const block = Box(60, 40, 20).cut(Box(30, 20, 10, { align: [Align.CENTER, Align.CENTER, Align.MAX] }).translate(0, 0, 10))
  const pocket = walls(block).filter((f) => Math.abs(f.center().x) < 29 && Math.abs(f.center().y) < 19)
  const floor = block
    .faces()
    .filter((f) => Math.abs(f.normalAt().z) > 0.5 && Math.abs(f.center().z) < 1e-9)
    .one()
  assert.equal(pocket.length, 4)
  const t = tan3
  const full = 60 * 40 * 20
  // The rim keeps its size and the pocket narrows towards its floor: it opens upwards.
  const rim = block.draft(pocket, 3, block.faces().top() as unknown as Face)
  approx(
    rim
      .faces()
      .filter((f) => Math.abs(f.normalAt().z) > 0.5 && Math.abs(f.center().z) < 1e-9)
      .one().area,
    (30 - 20 * t) * (20 - 20 * t),
    1e-9,
  )
  approx(rim.volume, full - prismatoid(10, (30 - 20 * t) * (20 - 20 * t), (30 - 10 * t) * (20 - 10 * t), 600), 1e-7)
  // The floor keeps its size and the rim widens.
  const opened = block.draft(pocket, 3, floor)
  approx(opened.faces().top().one().area, 2400 - (30 + 20 * t) * (20 + 20 * t), 1e-9)
  approx(opened.volume, full - prismatoid(10, 600, (30 + 10 * t) * (20 + 10 * t), (30 + 20 * t) * (20 + 20 * t)), 1e-7)
  for (const part of [rim, opened]) {
    const angles = draftedAngles(part)
    assert.equal(angles.length, 8) // the outer walls stay at 0, the pocket walls get 3 degrees
    assert.deepEqual(
      angles.map(([lo]) => Math.round(lo * 1e6) / 1e6 + 0).sort((a, b) => a - b),
      [0, 0, 0, 0, 3, 3, 3, 3],
    )
  }
})

test('draft turns cylinders into cones', () => {
  const shaft = Cylinder(10, 20)
  for (const angle of [5, -5]) {
    const drafted = shaft.draft(walls(shaft), angle, Plane.XY.offset(-10))
    const side = drafted
      .faces()
      .filter((f) => f.geomType === 'cone')
      .one()
    assert.ok(side.axis.direction.normalized().cross(Z.direction).length < 1e-12)
    // a cone's draft about its axis is its half angle
    const [lo, hi] = (drafted.draftAnalysis(Z) as DraftAnalysis).angles(side)
    approx(lo, angle, 0, 1e-6)
    approx(hi, angle, 0, 1e-6)
    const r = 10 - 20 * Math.tan((angle * Math.PI) / 180)
    const top = drafted
      .edges()
      .circles()
      .filter((e) => e.arcCenter.z > 9)
      .one()
    approx(top.radius, r, 1e-9) // the kernel's B-spline edges are circles again
    approx(drafted.volume, ((Math.PI * 20) / 3) * (100 + 10 * r + r * r), 1e-6)
  }
  // A hole widens towards the pull direction, which takes material away.
  const holed = Box(40, 30, 20).cut(Cylinder(5, 40))
  const hole = walls(holed).filter((f) => f.geomType === 'cylinder')
  const opened = holed.draft(hole, 5, Plane.XY.offset(-10))
  const r = 5 + 20 * Math.tan((5 * Math.PI) / 180)
  assert.equal(opened.faces().filter((f) => f.geomType === 'cone').length, 1)
  const radii = opened
    .edges()
    .circles()
    .map((e) => e.radius)
    .sort((a, b) => a - b)
  assert.equal(radii.length, 2)
  approx(radii[0], 5, 1e-9)
  approx(radii[1], r, 1e-9)
  approx(opened.volume, 24000 - ((Math.PI * 20) / 3) * (25 + 5 * r + r * r), 1e-6)
  // A cylinder is drafted only about its own axis.
  const lying = Cylinder(10, 20).rotate(X, 90)
  raises(
    () => lying.draft(lying.faces().filter((f) => f.geomType === 'cylinder'), 3, Plane.XY),
    ModelingError,
    /axis of the cylinder face.* 90 degrees off/,
  )
  // A cone that would narrow to a point inside the face
  raises(() => shaft.draft(walls(shaft), 30, Plane.XY.offset(-10)), ModelingError, /narrow to a point/)
})

test('draft needs the fillets of its walls', () => {
  const box = Box(40, 30, 20)
  const rounded = box.fillet(box.edges().parallelTo(Z), 5)
  raises(
    () => rounded.draft(walls(rounded).planar(), 3, Plane.XY.offset(-10)),
    ModelingError,
    /cylinder face .* meets the drafted plane face .* tangentially.*add it/,
  )
  const drafted = rounded.draft(walls(rounded), 3, Plane.XY.offset(-10))
  assert.deepEqual(drafted.faces().map((f) => f.geomType).sort(), [...Array(4).fill('cone'), ...Array(6).fill('plane')])
  const t = tan3
  // The cross-section at height h: the rounded rectangle moved in by d = h tan(3 degrees)
  const area = (d: number) => (40 - 2 * d) * (30 - 2 * d) - (4 - Math.PI) * (5 - d) ** 2
  approx(drafted.volume, prismatoid(20, area(0), area(10 * t), area(20 * t)), 1e-6)
  approx(drafted.volume, RoundedRectangle(40, 30, 5).extrude(20, { taper: 3 }).volume, 1e-6)
  // Rounds along the top cannot be drafted with the walls: draft first, round afterwards.
  const roundedTop = box.fillet(box.edges().top(), 3)
  raises(
    () => roundedTop.draft(walls(roundedTop), 3, Plane.XY.offset(-10)),
    ModelingError,
    /tangentially.*cannot be drafted about this plane/,
  )
  const roundedAfter = box.draft(walls(box), 3, Plane.XY.offset(-10))
  assert.ok(roundedAfter.fillet(roundedAfter.edges().top(), 3).isValid())
})

test('draft a part with holes and rounds', () => {
  const box = Box(40, 30, 20)
  const part = box.fillet(box.edges().parallelTo(Z), 5).cut(Cylinder(4, 40))
  const drafted = part.draft(walls(part), 3, Plane.XY.offset(-10))
  const t = tan3
  // the outline moves in by h t, the hole widens by h t
  const area = (h: number) => {
    const d = h * t
    return (40 - 2 * d) * (30 - 2 * d) - (4 - Math.PI) * (5 - d) ** 2 - Math.PI * (4 + d) ** 2
  }
  assert.ok(drafted.isValid() && drafted.faces().length === part.faces().length)
  approx(drafted.volume, prismatoid(20, area(0), area(10), area(20)), 1e-6)
  // A wall with a hole through it: the hole's cylinder is trimmed by the drafted wall.
  const pierced = Box(40, 30, 20).cut(Cylinder(4, 60).rotate(Y, 90))
  const tilted = pierced.draft(walls(pierced).planar(), 5, Plane.XY.offset(-10))
  assert.ok(tilted.isValid() && tilted.faces().length === pierced.faces().length)
})

test('draft adds to the draft a face has', () => {
  const core = RoundedRectangle(60, 40, 5).extrude(20, { taper: 3 })
  const sides = core.faces().filter((f) => Math.abs(f.normalAt(f.interiorPoint()).z) < 0.5)
  assert.equal(sides.length, 8)
  const more = core.draft(sides, 2, Plane.XY)
  approx(more.volume, RoundedRectangle(60, 40, 5).extrude(20, { taper: 5 }).volume, 1e-6)
  for (const [lo] of draftedAngles(more)) approx(lo, 5, 0, 1e-6)
  const straight = core.draft(sides, -3, Plane.XY)
  approx(straight.volume, RoundedRectangle(60, 40, 5).extrude(20).volume, 1e-6)
  assert.deepEqual(straight.faces().map((f) => f.geomType).sort(), [...Array(4).fill('cylinder'), ...Array(6).fill('plane')])
  let twice = Box(40, 30, 20).draft(walls(Box(40, 30, 20)), 3, Plane.XY.offset(-10))
  twice = twice.draft(
    twice.faces().filter((f) => Math.abs(f.normalAt().z) < 0.5),
    2,
    Plane.XY.offset(-10),
  )
  const once = Box(40, 30, 20).draft(walls(Box(40, 30, 20)), 5, Plane.XY.offset(-10))
  approx(twice.volume, once.volume, 1e-9)
})

test('draft after a STEP round trip', () => {
  const box = Box(40, 30, 20)
  const part = box.fillet(box.edges().parallelTo(Z), 4).cut(Cylinder(5, 40))
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-draft-'))
  exportStep(part, join(dir, 'part.step'))
  const imported = importStep(join(dir, 'part.step')) as Part
  const here = part.draft(walls(part), 3, Plane.XY.offset(-10))
  const there = imported.draft(walls(imported), 3, Plane.XY.offset(-10))
  assert.ok(there.isValid())
  approx(there.volume, here.volume, 1e-6)
})

test('draft errors', () => {
  const box = Box(40, 30, 20)
  const sides = walls(box)
  for (const bad of [0, 90, -90, Number.NaN]) raises(() => box.draft(sides, bad, Plane.XY), RangeError, /draft: the angle/)
  for (const bad of ['3', true, null]) {
    raises(() => box.draft(sides, bad as never, Plane.XY), TypeError, /draft: the angle must be a number/)
  }
  raises(() => box.draft([], 3, Plane.XY), RangeError, /no faces selected/)
  raises(() => box.draft(Box(1, 1, 1).faces()[0], 3, Plane.XY), RangeError, /not a face of this part/)
  raises(
    () =>
      box.draft(
        sides,
        3,
        Cylinder(3, 3)
          .faces()
          .filter((f) => f.geomType === 'cylinder')
          .one(),
      ),
    RangeError,
    /neutral plane must be a Plane or a planar face/,
  )
  raises(() => box.draft(box.faces().top(), 3, Plane.XY), ModelingError, /plane face at .* is parallel to the neutral plane/)
  raises(() => box.draft(box.faces().bottom(), 3, Plane.XY.offset(-10)), ModelingError, /lies in the neutral plane/)
  raises(() => Sphere(10).draft(Sphere(10).faces(), 3, Plane.XY), ModelingError, /sphere face .* cannot be drafted/)
  raises(() => box.draft(sides, 89.5, Plane.XY.offset(-10)), ModelingError, /89.5 degrees of draft/)
  // At 40 degrees the walls 30 apart meet below the top: the top face would vanish. (How the
  // kernel fails there is up to it: an open body here.)
  raises(() => box.draft(sides, 40, Plane.XY.offset(-10)), ModelingError, /^draft: .*angle/)
})

test('draft never returns a broken part', () => {
  // Without the tangency check the kernel closes the part with faces that do not meet.
  const box = Box(40, 30, 20)
  const rounded = box.fillet(box.edges().parallelTo(Z), 5)
  const old = _setTangency(0.0)
  try {
    raises(() => rounded.draft(walls(rounded).planar(), 3, Plane.XY.offset(-10)), ModelingError, /draft: /)
  } finally {
    _setTangency(old)
  }
  // Next to a sphere the kernel can fail where the sphere's seam runs; turned about its axis the
  // same sphere gives the reference.
  let reference: number | null = null
  for (const turn of [90, 0]) {
    const dome = Box(40, 30, 20).intersect(Sphere(40).rotate(Z, turn).translate(0, 0, -25))
    let drafted: Part
    try {
      drafted = dome.draft(walls(dome).planar(), 3, Plane.XY.offset(-10))
    } catch (e) {
      if (e instanceof ModelingError) continue // with the seam at +X: the kernel's gaps were found
      throw e
    }
    assert.ok(drafted.isValid())
    reference = reference || drafted.volume
    approx(drafted.volume, reference, 1e-6)
  }
})

// -- what Python's MCP session test models (the session and the guide search are Python's) ----
test('a box drafted about its flipped bottom, a top face refused', () => {
  const box = Box(40, 30, 20)
  const sides = box.faces().filter((f) => Math.abs(f.normalAt().z) < 0.5)
  const core = box.draft(sides, 3, box.faces().bottom().one().plane.flipped())
  const t = tan3
  assert.deepEqual([core.faces().length, core.faces().top().one().area.toFixed(4)], [6, ((40 - 40 * t) * (30 - 40 * t)).toFixed(4)])
  raises(() => box.draft(box.faces().top(), 3, Plane.XY), ModelingError, /parallel to the neutral plane/)
})
