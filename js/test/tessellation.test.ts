// tests/test_tessellation.py: meshes of faces that are straight in one direction and twisted
// along it, and of single faces.
//
// The kernel cuts a face into a grid whose lines it places by the curves along the face's borders,
// so such a face got one facet across it. A body with such a face is now divided by halving its
// faces until they are flat within the tolerance (tessellate, through k.ext.tessellate); other
// bodies keep the kernel's facets.
//
// A single face is meshed as a copy in a sheet of its own, which faces where the face's surface
// normal points; where that is into the face's part, the mesh is turned.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Axis,
  Box,
  Circle,
  Cylinder,
  type Face,
  Helix,
  Line,
  Mesh,
  type Part,
  Plane,
  Rectangle,
  type Shape,
  type Shell,
  Sphere,
  Z,
  exportStl,
  importStl,
  loft,
  ruled,
  surface,
  sweep,
  tessellate,
} from '../src/index.ts'
import { ext, k } from '../src/kernel.ts'
import { gltfDocument } from '../src/exporters.ts'
import { faceMeshes } from '../src/mesh.ts'
import * as render from '../src/render.ts'
import { approx } from './_approx.ts'
import { Box as _Box, Cylinder as _Cylinder, Mesh as _Mesh } from '../src/index.ts'
import { fromStl as _fromStl, toStl as _toStl } from '../src/exporters.ts'

type Body = Part | Shell

function defaultTolerance(shape: Body): number {
  return shape.bbox().diagonal * 1e-3 // what tessellate() and shape.mesh() take
}

/** Largest distance of the triangle centroids and edge midpoints from the exact shape. */
function offSurface(shape: Body, mesh: Mesh): number {
  const v = mesh.vertices
  const t = mesh.triangles
  let worst = 0
  const at = (i: number) => [v[t[i] * 3], v[t[i] * 3 + 1], v[t[i] * 3 + 2]]
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [at(i), at(i + 1), at(i + 2)]
    const pts = [
      [0, 1, 2].map((j) => (a[j] + b[j] + c[j]) / 3),
      [0, 1, 2].map((j) => (a[j] + b[j]) / 2),
      [0, 1, 2].map((j) => (b[j] + c[j]) / 2),
      [0, 1, 2].map((j) => (c[j] + a[j]) / 2),
    ]
    for (const p of pts) worst = Math.max(worst, k.brep_closest_point(shape._brep, p)[1])
  }
  return worst
}

/** The kernel's own tessellation, which always cuts the faces into grids (smlibpy's before). */
function kernelGrid(shape: Body, tolerance: number, curveAngle = 15, surfaceAngle = 15): Mesh {
  return Mesh._fromPoly(
    k.tessellate(shape._brep, { chord_height_tolerance: tolerance, curve_angle_tolerance_deg: curveAngle, surface_angle_tolerance_deg: surfaceAngle }),
  )
}

function algorithm(shape: Body, tolerance: number, angle = 15): string {
  return ext.tessellation_algorithm(shape._brep, { chord_height_tolerance: tolerance, surface_angle_tolerance_deg: angle })
}

/** The mesh of a twisted body is within the tolerance; the kernel's grid was not. */
function checkTwisted(shape: Body, volume: number): Mesh {
  const tol = defaultTolerance(shape)
  assert.equal(algorithm(shape, tol), 'halving')
  const mesh = shape.mesh()
  assert.ok(mesh.isClosed())
  assert.ok(offSurface(shape, mesh) <= tol)
  // the facets enclose the volume up to the layer between them and the faces
  assert.ok(Math.abs(mesh.volume - volume) <= shape.area * tol)
  assert.ok(offSurface(shape, kernelGrid(shape, tol)) > 2 * tol) // the defect the test is about
  return mesh
}

test('a twisted box', () => {
  const bar = Box(20, 20, 100).twist(90)
  const mesh = checkTwisted(bar, 40000)
  // one facet across each side was 1 mm off and enclosed 5 % too much
  const grid = kernelGrid(bar, defaultTolerance(bar))
  assert.ok(grid.length === 68 && grid.volume > 42000)
  assert.ok(Math.abs(mesh.volume - 40000) < 100 && mesh.length > 1500 && mesh.length < 3000)
})

test('a twisted sweep', () => {
  const band = (sweep(Rectangle(8, 3), Line([0, 0, 0], [0, 0, 60])) as Part).twist(90)
  checkTwisted(band, 8 * 3 * 60) // a twist keeps the volume
})

test('a ruled loft between a square and a circle', () => {
  const transition = loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)], { ruled: true }) as Part
  checkTwisted(transition, transition.massProperties(1, 1e-9).volume)
})

test('the walls of a thickened free-form sheet', () => {
  const grid: number[][][] = []
  for (let y = 0; y < 50; y += 10) {
    const row: number[][] = []
    for (let x = 0; x < 60; x += 10) row.push([x, y, 4 * Math.sin(x / 15) * Math.cos(y / 15)])
    grid.push(row)
  }
  const panel = surface(grid).thicken(2)
  checkTwisted(panel, panel.massProperties(1, 1e-9).volume)
})

test('edges at the end of a twist are divided too', () => {
  // The trim curves of a box lie 1e-14 outside the domains of their faces; unless they are moved
  // onto the border, the kernel leaves the straight edge at the untwisted end whole and fans long
  // triangles from its ends (2.9 times the tolerance off here).
  const plate = Box(80, 60, 10).twist(30, { axis: new Axis([0, 0, 0], [0, 1, 0]) })
  checkTwisted(plate, 48000)
})

const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (x: number, i: number) => x === b[i])

test('plain parts keep their facets', () => {
  assert.equal(Box(20, 20, 20).mesh().length, 12)
  assert.equal(Cylinder(10, 20).mesh().length, 252)
  assert.equal(Sphere(10).mesh().length, 3584)
  let rounded = Box(40, 30, 20).cut(Cylinder(5, 30))
  rounded = rounded.fillet(rounded.edges().parallelTo([0, 0, 1]), 3)
  const plain: Part[] = [
    rounded,
    sweep(Circle(1), Helix(5, 30, 10)) as Part,
    loft([Circle(15), Circle(25).translate(0, 0, 30), Circle(10).translate(0, 0, 60)]) as Part,
    Cylinder(10, 50).twist(90), // a cylinder twisted about its axis is the same cylinder
  ]
  for (const part of plain) {
    const tol = defaultTolerance(part)
    assert.equal(algorithm(part, tol), 'grid')
    const mesh = part.mesh()
    const grid = kernelGrid(part, tol)
    assert.ok(sameArray(mesh.vertices, grid.vertices) && sameArray(mesh.triangles, grid.triangles))
  }
})

test('a surface straight both ways keeps the grid', () => {
  // the kernel places the grid of such a surface by its diagonals, which bend with the twist
  const saddle = ruled(Line([0, 0, 0], [20, 0, 0]), Line([0, 20, 10], [20, 20, -10]))
  const tol = defaultTolerance(saddle)
  assert.equal(algorithm(saddle, tol), 'grid')
  assert.ok(offSurface(saddle, saddle.mesh()) <= tol)
})

test('the angle tolerance of the faces decides', () => {
  // Points on the edges (curve angle 1 degree) do not help where the two borders of a face are
  // divided differently (a side of the square against a quarter of the circle): the grid is 7
  // times the tolerance off, so the faces' own angle tolerance (25 degrees) decides.
  const transition = loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)], { ruled: true }) as Part
  const tol = defaultTolerance(transition)
  assert.ok(offSurface(transition, kernelGrid(transition, tol, 1, 25)) > 5 * tol)
  let [poly, report] = ext.tessellate(transition._brep, {
    chord_height_tolerance: tol,
    curve_angle_tolerance_deg: 1,
    surface_angle_tolerance_deg: 25,
    return_report: true,
  })
  assert.equal(report.algorithm, 'halving')
  assert.ok(offSurface(transition, Mesh._fromPoly(poly)) <= tol)
  // a fine angle tolerance for the faces divides them along, so the grid is good enough
  ;[poly, report] = ext.tessellate(transition._brep, {
    chord_height_tolerance: tol,
    curve_angle_tolerance_deg: 25,
    surface_angle_tolerance_deg: 1,
    return_report: true,
  })
  assert.equal(report.algorithm, 'grid')
  assert.ok(offSurface(transition, Mesh._fromPoly(poly)) <= 2 * tol)
})

/** The triangles of a glTF document's first primitive, as x, y, z of each corner. */
function gltfTriangles(doc: Any, buf: Uint8Array): Float64Array {
  const acc = doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION]
  const view = doc.bufferViews[acc.bufferView]
  const floats = new Float32Array(buf.buffer, buf.byteOffset + view.byteOffset, acc.count * 3)
  return Float64Array.from(floats)
}

// biome-ignore lint: glTF documents are plain JSON
type Any = any

function signedVolume(tris: Float64Array): number {
  let s = 0
  for (let i = 0; i < tris.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(i, i + 9)
    s += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  }
  return s / 6
}

test('exports and the renderer take the halved mesh', () => {
  const bar = Box(20, 20, 100).twist(90)
  const mesh = bar.mesh()
  const path = join(mkdtempSync(join(tmpdir(), 'smlibwasm-')), 'bar.stl')
  exportStl(bar, path)
  approx(importStl(path).volume, mesh.volume, 1e-6)
  const [doc, buf] = gltfDocument(bar, { edges: false })
  const tris = gltfTriangles(doc, buf)
  assert.equal(tris.length / 9, mesh.length)
  approx(signedVolume(tris), mesh.volume)
  const scene = new (render as Any)._Scene([bar], null, 'native')
  approx(scene.bodies[0].mesh.volume, mesh.volume)
})

test('tessellate options', () => {
  const bar = Box(20, 20, 100).twist(90)
  const tol = defaultTolerance(bar)
  const kw = { chord_height_tolerance: tol, curve_angle_tolerance_deg: 15, surface_angle_tolerance_deg: 15 }
  const grid = Mesh._fromPoly(ext.tessellate(bar._brep, { algorithm: 'grid', ...kw }))
  assert.ok(sameArray(grid.vertices, kernelGrid(bar, tol).vertices))
  let [poly, report] = ext.tessellate(bar._brep, { return_report: true, ...kw })
  assert.ok(report.algorithm === 'halving' && report.output_manifold && !report.failures.length)
  ext.delete_polybrep(poly)
  // the kernel's halving divides the faces down to a thousandth with a max edge length or aspect
  // ratio, so they keep the grid
  for (const extra of [{ max_edge_length: 5 }, { max_aspect_ratio: 4 }]) {
    ;[poly, report] = ext.tessellate(bar._brep, { return_report: true, ...kw, ...extra })
    assert.equal(report.algorithm, 'grid')
    ext.delete_polybrep(poly)
    assert.throws(() => ext.tessellate(bar._brep, { algorithm: 'halving', ...kw, ...extra }), (e: Error) => e instanceof RangeError && /no max_edge_length or max_aspect_ratio/.test(e.message))
  }
  assert.throws(() => ext.tessellate(bar._brep, { algorithm: 'fine', ...kw }), (e: Error) => e instanceof RangeError && /algorithm must be/.test(e.message))
  // without a chord height a face is divided by its angles only, which do not show a twist
  assert.equal(ext.tessellation_algorithm(bar._brep, { chord_height_tolerance: 0 }), 'grid')
  const side = bar.faces().sortBy('area').last
  assert.ok(ext.grid_deviation(side._f, { chord_height_tolerance: tol, surface_angle_tolerance_deg: 15 }) > 5 * tol)
  assert.equal(ext.grid_deviation(Box(20, 20, 100).faces()[0]._f, { chord_height_tolerance: tol }), 0)
})

/** The mean corner normal of the triangle nearest to a point. */
function normalNear(mesh: Mesh, point: number[]): number[] {
  const v = mesh.vertices
  const t = mesh.triangles
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < t.length; i += 3) {
    let d = 0
    for (let j = 0; j < 3; j++) {
      const c = (v[t[i] * 3 + j] + v[t[i + 1] * 3 + j] + v[t[i + 2] * 3 + j]) / 3 - point[j]
      d += c * c
    }
    if (d < bestD) {
      bestD = d
      best = i / 3
    }
  }
  const n = mesh.normals!
  return [0, 1, 2].map((j) => (n[best * 9 + j] + n[best * 9 + 3 + j] + n[best * 9 + 6 + j]) / 3)
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const cases: [string, () => Part, string[]][] = [
  ['loft', () => loft([Rectangle(50, 50), Circle(13).on(Plane.XY.offset(54))]) as Part, ['bspline', 'bspline', 'bspline', 'bspline', 'plane']],
  ['revolve', () => Rectangle(10, 10).cut(Circle(2)).translate(20, 0, 0).on(Plane.XZ).revolve(Z), ['torus']],
  ['box', () => Box(10, 20, 30), []],
]

for (const [name, make, inward] of cases) {
  test(`the mesh of a face faces out of its part (${name})`, () => {
    // inward: the faces whose surface normal points into the part (the sides and the bottom of the
    // loft, the wall of the hole running round the ring), whose meshes faced into the part
    const part = make()
    const found: string[] = []
    for (const face of part.faces()) {
      const p = face.interiorPoint().toArray()
      const outward = face.normalAt(p).toArray()
      const mesh = tessellate(face)
      assert.ok(dot(normalNear(mesh, p), outward) > 0.9)
      // counterclockwise around the normals
      const v = mesh.vertices
      const t = mesh.triangles
      const n = mesh.normals!
      for (let i = 0; i < t.length; i += 3) {
        const a = [v[t[i] * 3], v[t[i] * 3 + 1], v[t[i] * 3 + 2]]
        const b = [v[t[i + 1] * 3], v[t[i + 1] * 3 + 1], v[t[i + 1] * 3 + 2]]
        const c = [v[t[i + 2] * 3], v[t[i + 2] * 3 + 1], v[t[i + 2] * 3 + 2]]
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const turn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
        const ns = [0, 1, 2].map((j) => n[i * 3 + j] + n[i * 3 + 3 + j] + n[i * 3 + 6 + j])
        assert.ok(dot(turn, ns) > 0)
      }
      if (dot(normalNear(face.toShell().mesh(), p), outward) < 0) found.push(face.geomType) // the sheet faces like the surface
    }
    assert.deepEqual(found.sort(), inward) // the defect the test is about
  })
}

test('exports take the turned mesh of a face', () => {
  const side: Face = (loft([Rectangle(50, 50), Circle(13).on(Plane.XY.offset(54))]) as Part).faces()[0] // surface normal points in
  const mesh = side.mesh()
  const [doc, buf] = gltfDocument(side, { edges: false })
  const tris = gltfTriangles(doc, buf)
  const v = mesh.vertices
  const t = mesh.triangles
  for (let i = 0; i < t.length; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(tris[i * 3 + j] - v[t[i] * 3 + j]) <= 1e-4 + 1e-5 * Math.abs(v[t[i] * 3 + j]))
  const path = join(mkdtempSync(join(tmpdir(), 'smlibwasm-')), 'side.stl')
  exportStl(side as unknown as Shape, path)
  const a = importStl(path).triangleNormals
  const b = mesh.triangleNormals
  assert.equal(a.length, b.length)
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= 1e-4 + 1e-5 * Math.abs(b[i]))
})

test('face meshes cut one tessellation by face', () => {
  let part = Box(20, 10, 5)
  part = part.fillet(part.edges().parallelTo(Z), 2).cut(Cylinder(2, 10))
  const meshes = faceMeshes(part, 0.005)
  assert.equal(meshes.length, part.faces().length)
  part.faces().forEach((face, i) => approx(meshes[i].area, face.area, 1e-2))
  assert.equal(
    meshes.reduce((n, m) => n + m.length, 0),
    tessellate(part, 0.005).length,
  )
})

test('mesh Booleans on any mesh', () => {
  const a = _Box(20, 20, 20)
  const b = _Cylinder(6, 40)
  const pairs: [_Mesh, _Mesh][] = [
    [a.mesh(), b.mesh()],
    [new _Mesh(a.mesh().vertices, a.mesh().triangles), new _Mesh(b.mesh().vertices, b.mesh().triangles)],
  ]
  for (const [ma, mb] of pairs) {
    const both = ma.intersect(mb).volume
    assert.ok(ma.intersect(mb).isClosed())
    approx(both, mb.volume / 2, 1e-9)
    assert.ok(ma.cut(mb).isClosed())
    approx(ma.cut(mb).volume, ma.volume - both, 1e-9)
    assert.ok(ma.fuse(mb).isClosed())
    approx(ma.fuse(mb).volume, ma.volume + mb.volume - both, 1e-9)
  }
  const sa = _fromStl(_toStl(a)) // meshes of their own
  const sb = _fromStl(_toStl(b))
  const diff = sa.cut(sb)
  assert.ok(diff.isClosed())
  // (the kernel gives the result no normals: they come from the triangles, not all (0, 0, 1))
  assert.equal(diff.normals, null)
  approx(diff.volume, sa.volume - sa.intersect(sb).volume, 1e-6)
  approx(diff.volume, a.cut(b).volume, 1e-2) // (the cylinder's facets cut its corners)
  const tet = new _Mesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])
  approx(tet.intersect(tet).volume, 1 / 6)
  assert.throws(() => new _Mesh([0, 0, 0], []).fuse(tet), /triangles/)
})

