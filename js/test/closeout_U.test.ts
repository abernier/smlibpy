// tests/test_closeout_U.py: the close-out of lane U's "Not done" (kernel plan phase 1): plane sections
// within a tolerance, the nearest point of a folded B-spline face, rays beside a seam (the kernel's
// seam evaluation, third_party/patches SmEllipse.cpp); a hole wholly inside a bend zone unfolded into
// a valid part, and the faces of bend zones as the exact bend (D5); K-factor records in .smp files
// (D1); blends between two closed edges (U2); trimming with curves that run past a sheet's border or
// across a hole (U3); the knots a warp or a flattening does not need removed (U8).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Align,
  Axis,
  Box,
  Cone,
  Cylinder,
  Edge,
  Ellipse,
  Location,
  Part,
  Plane,
  Rectangle,
  Shell,
  Sphere,
  Spline,
  Torus,
  Vector,
  blend,
  flatPattern,
  fold,
  loft,
  surface,
} from '../src/index.ts'
import { bends } from '../src/sheetmetal.ts'
import { fromSmp, toSmp } from '../src/exporters.ts'
import { ext, k } from '../src/kernel.ts'
import { approx } from './_approx.ts'

const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b}`)
const lin = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
const deg = (a: Vector, b: Vector) => (Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI

// ------------------------------------------------------------------------------------ measuring

function bumpyPart(): Part {
  const pts = lin(0, 20, 5).map((y) => lin(0, 30, 7).map((x) => [x, y, 3 * Math.sin(x / 6) * Math.cos(y / 5)] as [number, number, number]))
  return surface(pts).thicken(4)
}

test('the section of B-spline faces lies on them', () => {
  // the kernel's plane section fitted each curve within a thousandth of its face's size: up to 1.5e-2
  // off a part thickened from a B-spline sheet
  const part = bumpyPart()
  for (const z of [0.5, 1.0, 1.7]) {
    const sk = part.section(Plane.XY.offset(z))
    assert.ok(sk.area > 100)
    let worst = 0
    for (const e of sk.edges()) for (let i = 0; i <= 30; i++) worst = Math.max(worst, part.distanceTo(e.pointAt(i / 30)))
    assert.ok(worst < 1e-5, `${worst}`)
  }
  for (const rel of [1e-6, 1e-8]) {
    const tol = rel * part._extent()
    const edges = (ext.plane_section(part._brep, [0, 0, 1], [0, 0, 1], tol) as number[]).map((c) => Edge._fromCurve(c))
    assert.ok(edges.length > 0)
    let worst = 0
    for (const e of edges) for (let i = 0; i <= 20; i++) worst = Math.max(worst, part.distanceTo(e.pointAt(i / 20)))
    assert.ok(worst < 50 * tol, `${worst}`)
  }
  assert.throws(() => ext.plane_section(part._brep, [0, 0, 1], [0, 0, 1], 0), /positive/)
})

test('distanceTo finds the nearest point of a folded face', () => {
  // a sheet fitted around 288 degrees of a tube folds back towards points inside it: the kernel's
  // closest point stopped at a local minimum (5.83 where the nearest point is 5.71)
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const pts = Array.from({ length: 1500 }, () => {
    const a = (rnd() - 0.5) * (288 * Math.PI) / 180
    return [10 * Math.sin(a), 10 * Math.cos(a), rnd() * 40] as [number, number, number]
  })
  const s = surface(pts)
  const face = s.faces()[0]
  const srf = k.face_surface(face._f)
  const [[u0, v0], [u1, v1]] = ext.surface_data(srf, false).uv_domain
  const uv: number[] = []
  for (const u of lin(u0, u1, 200)) for (const v of lin(v0, v1, 200)) uv.push(u, v)
  const dense = ext.surface_derivatives(srf, uv).point as Float64Array
  let kernelWorse = 0
  for (let i = 0; i < pts.length; i += 23) {
    const p = pts[i]
    let brute = Infinity
    for (let j = 0; j < dense.length; j += 3) brute = Math.min(brute, Math.hypot(dense[j] - p[0], dense[j + 1] - p[1], dense[j + 2] - p[2]))
    const d = s.distanceTo(p)
    assert.ok(d <= brute + 1e-9 && d > brute - 0.2, `${d} vs ${brute}`)
    near(face.distanceTo(p), d, 1e-9)
    const q = s.closestPoint(p)
    near(q.sub(new Vector(p)).length, d, 1e-9)
    assert.ok(face.closestPoint(p).sub(q).length < 1e-6)
  }
  for (let i = 0; i < pts.length; i += 4) if (Number(k.brep_closest_point(s._brep, pts[i])[1]) > s.distanceTo(pts[i]) + 1e-6) kernelWorse++
  assert.ok(kernelWorse > 0) // (the kernel's own still misses: the case is a real one)
})

test('distanceTo analytic and trimmed faces', () => {
  const box = Box(10, 10, 10)
  near(box.distanceTo([20, 0, 0]), 15, 1e-9)
  near(box.distanceTo([0, 0, 0]), 5, 1e-9) // (inside: to the boundary, as before)
  const holed = Box(20, 20, 4).cut(Cylinder(5, 10))
  const top = holed.faces().sortBy(Axis.Z).last
  near(top.distanceTo([0, 0, 2]), 5, 1e-9) // over the hole: its rim
  near(top.closestPoint([0, 0, 2]).z, 2, 1e-9)
  near(Sphere(10).distanceTo([0, 0, 30]), 20, 1e-9)
  near(Cylinder(10, 40).distanceTo([30, 0, 0]), 20, 1e-9)
})

test('raycast beside a seam', () => {
  // a ray just beside a cylinder's seam missed the near side (also in 0.4.0)
  const hits = Cylinder(10, 40).raycast([88.98, -1e-8, 4], [-1, 0, 0])
  assert.deepEqual(hits.map((h) => Math.round(h.point.x * 1e6) / 1e6), [10, -10])
  const cases: [string, Part, number, number][] = [
    ['cylinder', Cylinder(10, 40), 2, 1],
    ['cone', Cone(10, 4, 20), 2, 1],
    ['sphere', Sphere(10), 2, 1],
    ['torus', Torus(20, 5), 4, 0.5],
  ]
  for (const [name, body, n, z] of cases) {
    for (const e of lin(-12, -3, 19)) {
      for (const sign of [-1, 1]) {
        const y = sign * 10 ** e
        assert.equal(body.raycast([50, y, z], [-1, 0, 0]).length, n, `${name} ${y}`)
      }
    }
  }
})

test('seam evaluation is not snapped', () => {
  // a cylinder's (cone's, sphere's, torus') parameters up to 1e-7 short of the end of its domain
  // evaluated to the seam itself: y = -2.4e-15 where it is -9.0e-8
  const face = Cylinder(10, 40).faces().cylinders()[0]
  for (const back of [1e-7, 1e-8, 1e-9]) {
    // (the circle's NURBS runs at 2 sqrt(2) / pi of its mean speed at the end of a quarter)
    approx(face.positionAt(1 - back, 0.5).y, -10 * 2 * Math.PI * back * 2 * Math.SQRT2 / Math.PI, 1e-3)
  }
  assert.ok(Sphere(10).faces()[0].positionAt(1 - 1e-8, 0.5).y < -1e-8)
})

// ------------------------------------------------------------------------------------- D5, D1

const plate = (length: number, width: number, t: number) => Box(length, width, t, { align: [Align.CENTER, Align.CENTER, Align.MIN] })

test('a hole inside a bend unfolds into a valid part', () => {
  // two holes of r 6 wholly inside an R20, 120 degree bend: the unfolded part was not isValid() ("open
  // between its faces"): the kernel's fits of its hole walls overlapped themselves
  const blank = plate(200, 60, 3).cut(Cylinder(6, 10).translate(10, -15, 0)).cut(Cylinder(6, 10).translate(25, 15, 0))
  const part = fold(blank, new Axis([20, 0, 3], [0, 1, 0]), 120, { radius: 20 })
  assert.ok(part.isValid())
  const flat = part.unfold()
  assert.ok(flat.isValid())
  assert.deepEqual(flat.check(), [])
  approx(flat.volume, blank.volume, 1e-10)
  const walls = flat.faces().filter((f) => f.geomType !== 'plane')
  assert.equal(walls.length, 2)
  for (const f of walls) {
    approx(f.area, 2 * Math.PI * 6 * 3, 1e-9)
    const c = f.center().y < 0 ? [10, -15] : [25, 15]
    let worst = 0
    for (const u of lin(0, 1, 25)) for (const v of lin(0, 1, 4)) {
      const p = f.positionAt(u, v)
      worst = Math.max(worst, Math.abs(Math.hypot(p.x - c[0], p.y - c[1]) - 6))
    }
    assert.ok(worst < 1e-9, `${worst}`)
  }
  const fp = flatPattern(part)
  near(fp.size.x, 200, 1e-7)
  near(fp.size.y, 60, 1e-7)
  near(fp.size.z, 3, 1e-7)
  assert.deepEqual(fp.outline.edges().map((e) => e.geomType).sort(), ['circle', 'circle', 'line', 'line', 'line', 'line'])
})

test('bend-zone faces are the exact bend', () => {
  // the faces of a bend zone were the kernel's fits within 1e-4: the slanted walls of a square hole came
  // back from a fold and an unfold 1.6e-6 off (area 23.99998 for 24), a round hole's plate 7842.9195
  // for 7842.9204
  const blank = plate(200, 60, 3).cut(Box(8, 8, 10).rotate(Axis.Z, 30).translate(30, 10, 0))
  const part = fold(blank, new Axis([20, 0, 3], [0, 1, 0]), 120, { radius: 20 })
  assert.equal(part.faces().filter((f) => f.geomType === 'bspline').length, 4)
  assert.ok(part.isValid())
  const flat = part.unfold()
  assert.ok(flat.isValid())
  approx(flat.volume, blank.volume, 1e-12)
  const back = flat.faces().filter((f) => f.geomType === 'bspline')
  assert.equal(back.length, 4)
  for (const f of back) {
    approx(f.area, 24, 1e-10)
    let worst = 0
    for (const u of lin(0, 1, 15)) for (const v of lin(0, 1, 4)) {
      const p = f.positionAt(u, v)
      if (f.distanceTo(p) < 1e-9) worst = Math.max(worst, blank.distanceTo(p))
    }
    assert.ok(worst < 1e-11, `${worst}`)
  }
  const plate2 = Box(100, 40, 2, { align: [Align.CENTER, Align.CENTER, Align.MIN] }).cut(Cylinder(5, 10))
  const bent = fold(plate2, new Axis([0, 0, 2], [0, 1, 0]), 90, { radius: 4 })
  approx(bent.unfold().volume, plate2.volume, 1e-12)
})

test('K-factors are kept in part files', () => {
  const blank = Box(200, 40, 2, { align: [Align.MIN, Align.CENTER, Align.MIN] })
  const a = fold(blank, new Axis([60, 0, 2], [0, 1, 0]), 90, { radius: 1, kFactor: 0.33 })
  const b = fold(a, new Axis([140, 0, 2], [0, 1, 0]), 90, { radius: 6, kFactor: 0.45 })
  near(flatPattern(b).size.x, 200, 1e-9)
  for (const ascii of [true, false]) {
    const back = fromSmp(toSmp(b, { ascii })) as Part
    assert.equal(back._folds.length, 2)
    back._folds.forEach(([o, d, r, kf], i) => {
      const [o2, d2, r2, k2] = b._folds[i]
      for (let j = 0; j < 3; j++) {
        near(o[j], o2[j], 1e-12)
        near(d[j], d2[j], 1e-12)
      }
      assert.equal(r, r2)
      assert.equal(kf, k2)
    })
    near(flatPattern(back).size.x, 200, 1e-9) // (0.44 everywhere: 200.314)
    assert.deepEqual(bends(back).map((x) => x.kFactor).sort(), [0.33, 0.45])
  }
  const many = fromSmp(toSmp([b, Box(5, 5, 5), Box(3, 3, 3).faces()[0]])) as unknown as Part[]
  assert.equal(many.length, 3)
  assert.equal(many[0]._folds.length, 2)
  assert.equal(many[1]._folds.length, 0)
  assert.throws(() => ext.part_bytes([[b._brep, null, null, null, -1, [1, 2, 3]]], true), /8 numbers/)
})

// ------------------------------------------------------------------------------------- U2, U3

function rim(sheet: Shell, options: { above?: number; below?: number }): Edge {
  return sheet.edges().filter((e) => e.faces().length === 1 &&
    (options.above === undefined || e.center().z > options.above) && (options.below === undefined || e.center().z < options.below))[0]
}

function tubes(): [Shell, Shell, Edge, Edge] {
  const wide = Cylinder(10, 20).faces().cylinders()[0].toShell()
  const narrow = Cylinder(6, 20).translate(0, 0, 40).faces().cylinders()[0].toShell()
  return [wide, narrow, rim(wide, { above: 5 }), rim(narrow, { below: 35 })]
}

/** The largest angle (degrees) between the normals of faces across their shared edges. */
function crease(sheet: Shell): number {
  let worst = 0
  for (const e of sheet.edges()) {
    const fs = e.faces()
    if (fs.length !== 2) continue
    for (let i = 1; i < 10; i++) {
      const p = e.pointAt(i / 10)
      worst = Math.max(worst, deg(fs[0].normalAt(p), fs[1].normalAt(p)))
    }
  }
  return worst
}

test('blend of two closed edges', () => {
  const [wide, narrow, top, bottom] = tubes()
  const b = blend(top, bottom)
  assert.ok(b instanceof Shell)
  assert.equal(b.faces().length, 2)
  assert.deepEqual(b.check(), [])
  const free = b.edges().filter((e) => e.faces().length === 1).map((e) => e.length).sort((x, y) => x - y)
  const want = [6 * Math.PI, 6 * Math.PI, 10 * Math.PI, 10 * Math.PI]
  free.forEach((x, i) => near(x, want[i], 1e-6))
  near(b.area, 1033.6314, 1e-3)
  assert.ok(crease(b) < 1e-4)
  for (const [e, sheet] of [[top, wide], [bottom, narrow]] as [Edge, Shell][]) {
    for (let i = 0; i < 12; i++) {
      const p = e.pointAt(i / 12)
      const nearest = b.faces().sort((f, g) => f.distanceTo(p) - g.distanceTo(p))[0]
      assert.ok(b.distanceTo(p) < 1e-6)
      assert.ok(deg(sheet.faces()[0].normalAt(p), nearest.normalAt(p)) < 1e-3)
    }
  }
  approx(b.thicken(1).volume, b.area, 0.1)
  assert.ok(b.thicken(-1).isValid())
  const joined = blend(top, bottom, { join: true })
  assert.equal(joined.faces().length, 4)
  assert.equal(joined.edges().filter((e) => e.faces().length === 1).length, 2)
  assert.ok(joined.thicken(1).isValid() && joined.thicken(-1).isValid())
})

test('blend of closed edges running opposite ways and off axis', () => {
  const [, , top] = tubes()
  const turned = Cylinder(6, 20).rotate(Axis.X, 180).translate(3, 0, 40).faces().cylinders()[0].toShell()
  const b = blend(top, rim(turned, { below: 35 }))
  assert.deepEqual(b.check(), [])
  assert.ok(crease(b) < 1e-4)
  near(b.area, 1040.18, 0.01)
  const lo = loft([Ellipse(9, 5).moved(new Location([2, 1, 30])), Ellipse(12, 7).moved(new Location([2, 1, 50]))])
  const sheet = lo.faces().filter((f) => f.geomType === 'bspline').one().toShell()
  const low = sheet.edges().filter((e) => e.faces().length === 1).sort((e, f) => e.center().z - f.center().z)[0]
  for (const c of ['G1', 'G2', 'G3']) {
    const s = blend(top, low, { continuity: c })
    assert.deepEqual(s.check(), [])
    assert.ok(crease(s) < 1e-4)
    assert.ok(s.thicken(0.5).isValid())
  }
  assert.ok(blend(top, low, { join: true }).thicken(0.5).isValid())
})

test('blend of a closed and an open edge is refused', () => {
  const [, , top] = tubes()
  const half = Cylinder(6, 20).split(Plane.XZ).translate(0, 0, 40).faces().filter((f) => f.geomType === 'cylinder').one()
  const arc = half.toShell().edges().filter((e) => e.geomType === 'circle' && e.center().z < 40)[0]
  assert.throws(() => blend(top, arc), /one edge is closed/)
})

test("trim with a curve past a B-spline sheet's border", () => {
  // a curve that runs on past the border of a B-spline sheet (off its surface) threw
  const a = Spline([0, 0, 0], [10, 0, 3], [20, 0, 0], [30, 0, 2])
  const b = Spline([0, 20, 1], [10, 20, -2], [20, 20, 2], [30, 20, 0])
  const sh = loft([a, b]) as Shell
  const f = sh.faces()[0]
  const keep = f.positionAt(0.25, 0.25)
  for (const which of ['u', 'v']) {
    const across = f.iso({ [which]: 0.5 })[0]
    const longer = across.extend(5, { end: 'both' }) // on past both borders, along the surface's extension
    const ref = sh.trim(across, keep)
    const cut = sh.trim(longer, keep)
    approx(cut.area, ref.area, 1e-9)
    assert.deepEqual(cut.check(), [])
    const pieces = sh.trim(longer, 'split')
    assert.equal(pieces.faces().length, 2)
    approx(pieces.faces().reduce((t, x) => t + x.area, 0), sh.area, 1e-9)
  }
  // a curve across a hole: cut where it leaves the faces and where it comes back
  const holed = Box(40, 20, 1).cut(Cylinder(4, 4)).faces().sortBy(Axis.Z).last.toShell()
  const halves = holed.trim(Spline([-25, 0, 0.5], [0, 0, 0.5], [25, 0, 0.5]), 'split')
  assert.equal(halves.faces().length, 2)
  approx(halves.faces().reduce((t, x) => t + x.area, 0), holed.area, 1e-9)
})

// ------------------------------------------------------------------------------------------- U8

const poles = (f: { _f: number }) => (ext.surface_data(k.face_surface(f._f), true).poles as unknown[]).length

test('warp and flatten drop the knots they do not need', () => {
  // the change was added on knots of its own, so the face's B-spline grew; the plan's knot removal
  // within 1e-6 of the size (not NLib's 1 %) was not done
  const box = Box(60, 40, 20)
  const top = box.faces().sortBy(Axis.Z).last
  const flat = box.flatten(top, Rectangle(20, 16).on(top), Plane.XY.offset(8))
  const f = flat.faces().sortBy(Axis.Z).last
  assert.equal(poles(f), 21 * 21) // (39 x 39 before)
  assert.ok(flat.isValid())
  near(flat.volume, 47577.5, 1e-6)
  for (const [x, y] of [[0, 0], [-6, 0], [6, 4]]) near(f.raycast([x, y, 50], [0, 0, -1])[0].point.z, 8, 1e-9)
  near(f.raycast([25, 15, 50], [0, 0, -1])[0].point.z, 10, 1e-12)
  for (const [cont, n] of [['G1', 22 * 22], ['crease', 23 * 23], ['G2', 21 * 21]] as [string, number][]) {
    const w = box.warp(top, Rectangle(20, 16).on(top), 4, { continuity: cont })
    assert.equal(poles(w.faces().sortBy(Axis.Z).last), n, cont)
    assert.ok(w.isValid())
    near(w.bbox().max.z, 14, 1e-6)
  }
  // a bumpy sheet flattened keeps its edges where they are (a removal that moved one is not taken)
  const rows = lin(0, 60, 13).map((x) => lin(0, 60, 13).map((y) => [x, y, 3 * Math.sin(x / 9) * Math.cos(y / 11)] as [number, number, number]))
  const sheet = surface(rows)
  const g = sheet.faces()[0]
  const region = ([[20, 20], [40, 20], [40, 40], [20, 40]] as [number, number][]).map(
    ([x, y]) => new Vector((k.face_closest_point(g._f, [x, y, 0]) as [[number, number, number], number])[0]))
  const h = sheet.flatten(g, region, Plane.XY).faces()[0]
  let worst = 0
  for (const e of g.edges()) for (const t of [0.1, 0.5, 0.9]) worst = Math.max(worst, h.distanceTo(e.pointAt(t)))
  assert.ok(worst < 1e-9, `${worst}`)
})
