// The kernel's calls (js/cpp/bind_kernel*.cpp), each with a small case whose answer is known
// exactly: distances from points to boxes, cylinders and fillets, the edges of known bodies. They
// show that the right kernel call runs, with its arguments in the right order.
// SMLIBWASM_WASM=<path of smlibwasm.mjs> tests another build than js/wasm.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SIGNATURES } from '../src/signatures.ts'

// biome-ignore lint: the module's functions take and return what their binding says
type Any = any
type Vec = [number, number, number]

const where = process.env.SMLIBWASM_WASM
const url = where ? pathToFileURL(resolve(where)).href : new URL('../wasm/smlibwasm.mjs', import.meta.url).href
const { default: createSmlib } = await import(url)
const K: Any = await createSmlib()
K.init()

// Breps are freed where the module has a deleter; curves and surfaces are left to the module.
function free(...breps: number[]): void {
  const del = K.delete_brep ?? K.ext__delete_brep
  if (typeof del === 'function') for (const b of new Set(breps)) del(b)
}

function near(actual: number, expected: number, tol = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not ${expected} (within ${tol})`)
}

function nearPoint(actual: ArrayLike<number>, expected: ArrayLike<number>, tol = 1e-6): void {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < expected.length; i++) near(actual[i], expected[i], tol)
}

const dist = (brep: number, p: Vec): number => K.brep_closest_point(brep, p)[1]
const curveDist = (curve: number, p: Vec): number => K.curve_closest_point(curve, p)[2]
const surfaceDist = (surface: number, p: Vec): number => K.surface_closest_point(surface, p)[2]
const edgeCount = (brep: number): number => K.tessellate_boundaries(brep, 5, false)[2].length
const fillet = (r: number): number => r * (Math.SQRT2 - 1) // from a filleted right-angled edge to its old corner

// The edge of a body that runs straight from a to b, found among its boundary polylines.
function edgeFrom(brep: number, a: Vec, b: Vec): number {
  const [points, counts, edges] = K.tessellate_boundaries(brep, 5, false)
  const at = (i: number, p: Vec) => Math.hypot(points[3 * i] - p[0], points[3 * i + 1] - p[1], points[3 * i + 2] - p[2]) < 1e-9
  let first = 0
  for (let k = 0; k < edges.length; k++) {
    const last = first + counts[k] - 1
    if ((at(first, a) && at(last, b)) || (at(first, b) && at(last, a))) return edges[k]
    first = last + 1
  }
  throw new Error(`no edge from ${a} to ${b}`)
}

const square = (cx: number, cy: number, size: number): number =>
  K.create_planar_faces(K.create_rectangle([cx, cy, 0], size, size))

// ---------------------------------------------------------------- the table of Python's parameters
test('SIGNATURES lists each kernel call with as many parameters as its binding takes', () => {
  for (const [name, params] of Object.entries(SIGNATURES)) {
    assert.equal(typeof K[name], 'function', name)
    if (K[name].length > 0) assert.equal(K[name].length, params.length, name) // (0: a build without named parameters)
  }
})

// ---------------------------------------------------------------- primitives
test('primitives: box, sphere, cone, cylinder and torus where their arguments put them', () => {
  const box = K.create_box([0, 0, 0], 60, 44, 28)
  assert.deepEqual(K.brep_closest_point(box, [70, 22, 14]), [[60, 22, 14], 10])
  near(dist(box, [30, 50, 14]), 6) // width along y
  near(dist(box, [30, 22, 30]), 2) // height along z
  const sphere = K.create_sphere([1, 2, 3], 5)
  near(dist(sphere, [11, 2, 3]), 5)
  const cone = K.create_cone([0, 0, 0], 10, 5, 20)
  near(dist(cone, [12, 0, 0]), 2) // the base rim, radius 10
  near(dist(cone, [7, 0, 25]), Math.hypot(2, 5)) // the top rim, radius 5
  const cylinder = K.create_cylinder([0, 0, 0], 4, 10)
  near(dist(cylinder, [10, 0, 5]), 6)
  near(dist(cylinder, [0, 0, 15]), 5)
  const torus = K.create_torus([0, 0, 0], 10, 3)
  near(dist(torus, [0, 0, 0]), 7)
  near(dist(torus, [10, 0, 0]), 3) // the middle of the tube
  free(box, sphere, cone, cylinder, torus)
})

test('create_skin_primitive lofts between two squares, capped or open', () => {
  const sections = () => [...K.create_rectangle([0, 0, 0], 10, 10), ...K.create_rectangle([0, 0, 10], 6, 6)]
  const solid = K.create_skin_primitive([4, 4], sections(), 1, true)
  assert.equal(edgeCount(solid), 12)
  near(dist(solid, [0, 0, 20]), 10) // the top cap
  near(dist(solid, [10, 0, 0]), 5)
  const open = K.create_skin_primitive([4, 4], sections(), 1, false)
  near(dist(open, [0, 0, 20]), Math.hypot(3, 10)) // no cap: the rim of the top section
  free(solid, open)
})

// ---------------------------------------------------------------- curves
test('curves: line segment, circle and ellipse', () => {
  const line = K.create_line_segment([0, 0, 0], [10, 0, 0])
  assert.deepEqual(K.curve_closest_point(line, [5, 3, 0]), [[5, 0, 0], 0.5, 3])
  const circle = K.create_circle([1, 1, 0], 3)
  near(curveDist(circle, [1, 1, 0]), 3)
  nearPoint(K.curve_closest_point(circle, [10, 1, 0])[0], [4, 1, 0])
  const ellipse = K.create_ellipse([0, 0, 0], 4, 2)
  near(curveDist(ellipse, [0, 0, 0]), 2) // radius2 along y
  nearPoint(K.curve_closest_point(ellipse, [10, 0, 0])[0], [4, 0, 0]) // radius1 along x
})

test('create_helix winds right or left handed, and conical', () => {
  const right = K.create_helix([0, 0, 0], 10, 2, 2, 1, true, 1e-4)
  const left = K.create_helix([0, 0, 0], 10, 2, 2, 1, false, 1e-4)
  near(curveDist(right, [0, 2, 2.5]), 0, 1e-4) // a quarter turn up: +y for a right-handed helix
  near(curveDist(left, [0, -2, 2.5]), 0, 1e-4)
  assert.ok(curveDist(right, [0, -2, 2.5]) > 1)
  const conical = K.create_helix([0, 0, 0], 10, 2, 4, 2, true, 1e-4)
  near(curveDist(conical, [2, 0, 0]), 0, 1e-4)
  near(curveDist(conical, [4, 0, 10]), 0, 1e-4)
})

test('create_rectangle gives four segments around its center', () => {
  const sides = K.create_rectangle([0, 0, 0], 10, 4)
  assert.equal(sides.length, 4)
  const d = sides.map((c: number) => curveDist(c, [0, 0, 0])).sort((a: number, b: number) => a - b)
  nearPoint(d, [2, 2, 5, 5])
})

test('create_canonical_curve from poles, knots and multiplicities, with or without weights', () => {
  const polyline = K.create_canonical_curve([[0, 0, 0], [1, 0, 0], [1, 1, 0]], [0, 1, 2], [2, 1, 2], null, 1,
    K.BSplineCurveForm_UNSPECIFIED)
  near(curveDist(polyline, [1, 0, 0]), 0)
  near(curveDist(polyline, [2, 0, 0]), 1)
  const w = Math.SQRT1_2
  const arc = K.create_canonical_curve([[1, 0, 0], [1, 1, 0], [0, 1, 0]], [0, 1], [3, 3], [1, w, 1], 2,
    K.BSplineCurveForm_CIRCULAR_ARC)
  near(curveDist(arc, [0, 0, 0]), 1) // a quarter of the unit circle
  near(curveDist(arc, [2, 2, 0]), 2 * Math.SQRT2 - 1)
  assert.throws(() => K.create_canonical_curve([[0, 0, 0], [1, 0, 0]], [0, 1], [2, -2], null, 1,
    K.BSplineCurveForm_UNSPECIFIED), /knot_multiplicities/)
})

// ---------------------------------------------------------------- surfaces
test('surfaces from a grid of points: control points or interpolated', () => {
  const grid = (f: (i: number, j: number) => Vec): Vec[] => {
    const out: Vec[] = []
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out.push(f(i, j))
    return out
  }
  const flat = K.create_surface_from_points(grid((i, j) => [i, j, 0]), 4, 4)
  const [closest, uvs, d] = K.surface_closest_point(flat, [1.5, 1.5, 1])
  nearPoint(closest, [1.5, 1.5, 0])
  nearPoint(uvs[0], [0.5, 0.5])
  near(d, 1)
  const curved = K.create_surface_from_ordered_points(grid((i, j) => [i, j, 0.1 * i * j]), 4, 4)
  near(surfaceDist(curved, [2, 2, 0.4]), 0) // it passes through the points
})

test('create_ruled_surface between two lines, create_skin_surface through three', () => {
  const a = K.create_line_segment([0, 0, 0], [1, 0, 0])
  const b = K.create_line_segment([0, 1, 1], [1, 1, 1])
  const ruled = K.create_ruled_surface(a, b)
  near(surfaceDist(ruled, [0.5, 0.5, 0.5]), 0)
  near(surfaceDist(ruled, [0.5, 0.5, 1.5]), Math.SQRT1_2)
  const lines = [[0, 0, 0], [0, 2, 1], [0, 4, 0]].map(([x, y, z]) => K.create_line_segment([x, y, z], [x + 4, y, z]))
  const skin = K.create_skin_surface(lines)
  near(surfaceDist(skin, [2, 2, 1]), 0)
  near(surfaceDist(skin, [2, 2, 5]), 4)
  assert.throws(() => K.create_ruled_surface(0, b), /curve/)
})

test('create_planar_faces fills a closed loop', () => {
  const sheet = K.create_planar_faces(K.create_rectangle([0, 0, 0], 10, 4))
  assert.equal(edgeCount(sheet), 4)
  near(dist(sheet, [0, 0, 5]), 5)
  near(dist(sheet, [8, 0, 0]), 3)
  free(sheet)
})

// ---------------------------------------------------------------- booleans
test('boolean: a cylinder cut from a box leaves a hole of its radius; union and intersection', () => {
  const box = K.create_box([0, 0, 0], 60, 44, 28)
  const cut = K.boolean(box, K.create_cylinder([30, 22, -1], 10, 30), K.BooleanOp_DIFFERENCE)
  assert.equal(cut, box) // the result is the first operand, changed; the second is deleted
  assert.equal(edgeCount(cut), 15) // 12 + two circles + the seam
  near(dist(cut, [30, 22, 14]), 10)
  const union = K.boolean(K.create_box([0, 0, 0], 10, 10, 10), K.create_box([5, 5, 5], 10, 10, 10), K.BooleanOp_UNION)
  near(dist(union, [20, 10, 10]), 5)
  const common = K.boolean(K.create_box([0, 0, 0], 10, 10, 10), K.create_box([5, 5, 5], 10, 10, 10),
    K.BooleanOp_INTERSECTION)
  near(dist(common, [0, 0, 0]), Math.sqrt(75))
  assert.throws(() => K.boolean(0, 0, K.BooleanOp_UNION), /Brep/)
  assert.throws(() => K.boolean(cut, union, 42), /BooleanOp/)
  free(cut, union, common)
})

test('boolean_with_options: imprinting splits faces and adds nothing; keep_other_brep keeps the tool', () => {
  const part = K.create_box([0, 0, 0], 10, 10, 10)
  const below = K.create_box([-50, -50, -95], 100, 100, 100) // the half space z < 5
  const imprinted = K.boolean_with_options(part, below, K.BooleanOp_UNION, false, true, true, false, false)
  assert.equal(imprinted, part)
  assert.equal(edgeCount(imprinted), 20) // the side faces split at z = 5
  near(dist(imprinted, [15, 5, 5]), 5)
  near(dist(imprinted, [5, 5, 20]), 10)
  const tool = K.create_box([5, 0, 0], 10, 10, 10)
  const rest = K.boolean_with_options(K.create_box([0, 0, 0], 10, 10, 10), tool, K.BooleanOp_DIFFERENCE, false, false,
    true, false, true)
  near(dist(rest, [10, 5, 5]), 5)
  near(dist(tool, [20, 5, 5]), 5) // still there
  free(imprinted, rest, tool)
})

test('boolean_2d of two overlapping squares', () => {
  const op = (operation: number) => K.boolean_2d(square(0, 0, 10), square(5, 0, 10), operation)
  const union = op(K.BooleanOp2D_UNION) // x from -5 to 10
  assert.equal(edgeCount(union), 4)
  near(dist(union, [12, 0, 0]), 2)
  const difference = op(K.BooleanOp2D_DIFFERENCE) // x from -5 to 0
  near(dist(difference, [2, 0, 0]), 2)
  const xor = op(K.BooleanOp2D_EXCLUSIVE_OR) // the overlap from 0 to 5 removed
  near(dist(xor, [-2, 0, 0]), 0)
  near(dist(xor, [8, 0, 0]), 0)
  near(dist(xor, [2, 0, 1]), Math.hypot(2, 1))
  const intersection = op(K.BooleanOp2D_INTERSECTION) // x from 0 to 5
  near(dist(intersection, [-4, 0, 0]), 4)
  free(union, difference, xor, intersection)
})

// ---------------------------------------------------------------- sweeps
test('linear_sweep extrudes a rectangle, capped or open', () => {
  const solid = K.linear_sweep(K.create_rectangle([0, 0, 0], 10, 4), [0, 0, 1], 6, true)
  assert.equal(edgeCount(solid), 12)
  near(dist(solid, [0, 0, 10]), 4)
  const open = K.linear_sweep(K.create_rectangle([0, 0, 0], 10, 4), [0, 0, 1], 6, false)
  near(dist(open, [0, 0, 10]), Math.hypot(2, 4)) // no cap: the rim
  free(solid, open)
})

test('rotational_sweep turns a rectangle into a ring', () => {
  const profile = K.create_rectangle([8, 0, 0], 2, 4) // x 7..9, y -2..2
  for (const c of profile) K.rotate(c, [0, 0, 0], [1, 0, 0], 90) // into the xz plane
  const ring = K.rotational_sweep(profile, [0, 0, 0], [0, 0, 1], 360, true)
  near(dist(ring, [0, 0, 0]), 7)
  near(dist(ring, [8, 0, 5]), 3)
  free(ring)
})

test('draft_sweep tapers the walls inward', () => {
  const tapered = K.draft_sweep(K.create_rectangle([0, 0, 0], 10, 10), 10, 10, false, K.CapEnds_BOTH)
  assert.equal(edgeCount(tapered), 12)
  near(dist(tapered, [10, 0, 0]), 5)
  const a = (10 * Math.PI) / 180
  near(dist(tapered, [10, 0, 10]), 5 * Math.cos(a) + 10 * Math.sin(a)) // to the side face, leaning in by 10 degrees
  assert.throws(() => K.draft_sweep(K.create_rectangle([0, 0, 0], 10, 10), 10, 10, false, 7), /CapEnds/)
  free(tapered)
})

test('sweep_along_planar_path sweeps a circle around a corner', () => {
  const circle = K.create_circle([0, 0, 0], 2)
  K.rotate(circle, [0, 0, 0], [0, 1, 0], 90) // across the path's start
  const path = [K.create_line_segment([0, 0, 0], [20, 0, 0]), K.create_line_segment([20, 0, 0], [20, 20, 0])]
  const pipe = K.sweep_along_planar_path([circle], path, true, K.CapEnds_BOTH)
  near(dist(pipe, [10, 0, 0]), 2)
  near(dist(pipe, [20, 10, 0]), 2)
  near(dist(pipe, [10, 0, 5]), 3)
  free(pipe)
})

test('non_manifold_linear_sweep grows a sheet, or one of its edges, in place', () => {
  const sheet = K.create_planar_faces(K.create_rectangle([0, 0, 0], 10, 4))
  const solid = K.non_manifold_linear_sweep(sheet, [0, 0, 1], 6, null, true, false, null, null, null)
  assert.equal(solid, sheet)
  assert.equal(edgeCount(solid), 12)
  near(dist(solid, [0, 0, 10]), 4)
  const other = K.create_planar_faces(K.create_rectangle([0, 0, 0], 10, 4))
  const edge = edgeFrom(other, [-5, -2, 0], [5, -2, 0])
  K.non_manifold_linear_sweep(other, [0, 0, 1], 6, other, true, false, null, [edge], null)
  assert.equal(edgeCount(other), 7) // a wall stands on that edge
  near(dist(other, [0, -2, 3]), 0)
  assert.throws(() => K.non_manifold_linear_sweep(other, [0, 0, 1], 6, null, true, false, [], [], []), /empty selection/)
  assert.throws(() => K.non_manifold_linear_sweep(other, [0, 0, 1], 6, solid, true, false, null, null, null), /region_brep/)
  free(solid, other)
})

// ---------------------------------------------------------------- fillets
test('fillet_edges rounds, bevels or blends one edge of a box', () => {
  const corner: Vec = [60, 44, 14] // the middle of the edge from (60, 44, 0) to (60, 44, 28)
  const filleted = (xsect: number, continuity: number) => {
    const box = K.create_box([0, 0, 0], 60, 44, 28)
    const result = K.fillet_edges(box, [edgeFrom(box, [60, 44, 0], [60, 44, 28])], 5, xsect, continuity, 1)
    assert.equal(result, box)
    assert.equal(edgeCount(box), 15)
    return box
  }
  const round = filleted(1, 1)
  near(dist(round, corner), fillet(5))
  const bevel = filleted(0, 1)
  near(dist(bevel, corner), 5 / Math.SQRT2)
  const blend = filleted(2, 2)
  assert.ok(dist(blend, corner) > 0.5 && dist(blend, corner) < 5)
  free(round, bevel, blend)
})

test('variable_radius_fillet and fillet_edges_per_edge', () => {
  const box = K.create_box([0, 0, 0], 60, 44, 28)
  K.variable_radius_fillet(box, [edgeFrom(box, [60, 44, 0], [60, 44, 28])], 2, 6, 1, 1)
  near(dist(box, [60, 44, 0]), fillet(2), 1e-3)
  near(dist(box, [60, 44, 28]), fillet(6), 1e-2)
  const other = K.create_box([0, 0, 0], 60, 44, 28)
  const edges = [edgeFrom(other, [60, 44, 0], [60, 44, 28]), edgeFrom(other, [0, 0, 0], [0, 0, 28])]
  K.fillet_edges_per_edge(other, edges, [5, 3], [K.FilletXSect_CIRCULAR, K.FilletXSect_CIRCULAR], 1, 1)
  assert.equal(edgeCount(other), 18)
  near(dist(other, [60, 44, 14]), fillet(5))
  near(dist(other, [0, 0, 14]), fillet(3))
  free(box, other)
})

// ---------------------------------------------------------------- offsets
test('shell_brep hollows a box and thickens a sheet; offset_brep grows a box', () => {
  const box = K.create_box([0, 0, 0], 10, 10, 10)
  const hollow = K.shell_brep(box, -1, true, true, true, [])
  assert.equal(edgeCount(hollow), 24) // a closed wall: the box and the cavity
  near(dist(hollow, [5, 5, 5]), 4)
  near(dist(box, [5, 5, 5]), 5) // unchanged
  const sheet = K.create_planar_faces(K.create_rectangle([0, 0, 0], 10, 4))
  const slab = K.shell_brep(sheet, 2, true, true, true, []) // smlibpy's thicken
  near(dist(slab, [0, 0, 5]), 3)
  const grown = K.offset_brep(box, 1, true, true)
  near(dist(grown, [15, 5, 5]), 4)
  free(box, hollow, sheet, slab, grown)
})

test('create_offset_profile moves a loop to either side, or makes a band around it', () => {
  const offset = (side: number) => K.create_offset_profile(K.create_rectangle([0, 0, 0], 10, 4), 1, side, true, false)
  const inner = offset(K.OffsetType_LEFT) // the rectangle runs counterclockwise: left is inside
  near(dist(inner, [7, 0, 0]), 3)
  const outer = offset(K.OffsetType_RIGHT) // with rounded corners
  assert.equal(edgeCount(outer), 8)
  near(dist(outer, [7, 0, 0]), 1)
  const band = offset(K.OffsetType_BOTH)
  near(dist(band, [0, 0, 0]), 1)
  near(dist(band, [5, 0, 0]), 0)
  free(inner, outer, band)
})

// ---------------------------------------------------------------- io
test("read_brep_from_file reads a native .smb file from the module's file system", () => {
  K.FS.writeFile('/cube.smb', readFileSync(new URL('../../third_party/usd-brep/TestFilesSmb/cube_0.smb', import.meta.url)))
  const detected = K.read_brep_from_file('/cube.smb', null, false)
  assert.equal(edgeCount(detected), 12)
  const ascii = K.read_brep_from_file('/cube.smb', true, false)
  assert.equal(edgeCount(ascii), 12)
  assert.throws(() => K.read_brep_from_file('/cube.smb', false, false), /appears to be ASCII/)
  assert.throws(() => K.read_brep_from_file('/missing.smb', null, false), /Could not open/)
  free(detected, ascii)
})

// ---------------------------------------------------------------- NURBS, healing, stitching
test('turn_to_nurbs and heal_brep change a body in place and keep its shape', () => {
  const cylinder = K.create_cylinder([0, 0, 0], 4, 10)
  assert.equal(K.turn_to_nurbs(cylinder), cylinder)
  near(dist(cylinder, [10, 0, 5]), 6)
  const box = K.create_box([0, 0, 0], 10, 10, 10)
  assert.equal(K.heal_brep(box), box)
  near(dist(box, [15, 5, 5]), 5)
  free(cylinder, box)
})

test('stitch_into_solid and stitch_into_shell report what they did', () => {
  const box = K.create_box([0, 0, 0], 10, 10, 10)
  assert.deepEqual(K.stitch_into_solid(box), [box, true, 0, 0, 0])
  const sheet = K.create_planar_faces(K.create_rectangle([0, 0, 0], 10, 4))
  assert.deepEqual(K.stitch_into_solid(sheet), [sheet, false, 0, 0, 0]) // open: not a solid
  assert.deepEqual(K.stitch_into_shell(sheet, 0.01, false), [sheet, false, 0, 0, 0])
  free(box, sheet)
})

// ---------------------------------------------------------------- transforms
test('Axis2Placement, transform and rotate', () => {
  assert.deepEqual(K.Axis2Placement([10, 0, 0], [0, 2, 0], [-1, 0, 0]), { origin: [10, 0, 0], x: [0, 1, 0], y: [-1, 0, 0] })
  const line = K.create_line_segment([0, 0, 0], [1, 0, 0])
  assert.equal(K.transform(line, K.Axis2Placement([10, 0, 0], [0, 1, 0], [-1, 0, 0])), line)
  near(curveDist(line, [10, 0, 0]), 0) // x onto the placement's x axis, (0, 1, 0)
  near(curveDist(line, [10, 1, 0]), 0)
  assert.throws(() => K.transform(line, { origin: [0, 0, 0] }), /Axis2Placement/)
  const circle = K.create_circle([0, 0, 0], 3)
  K.rotate(circle, [0, 0, 0], [1, 0, 0], 90) // into the xz plane
  near(curveDist(circle, [0, 0, 10]), 7)
  const bar = K.create_box([0, 0, 0], 10, 2, 2)
  assert.equal(K.rotate(bar, [0, 0, 0], [0, 0, 1], 90), bar) // now along y
  near(dist(bar, [0, 5, 1]), 0, 1e-9)
  near(dist(bar, [5, 0, 1]), 5)
  free(bar)
})

// ---------------------------------------------------------------- queries
test('closest points on a Brep, a curve and a surface', () => {
  const box = K.create_box([0, 0, 0], 10, 10, 10)
  assert.deepEqual(K.brep_closest_point(box, [5, 5, 12]), [[5, 5, 10], 2])
  const circle = K.create_circle([0, 0, 0], 2)
  const [point, parameter, d] = K.curve_closest_point(circle, [0, 5, 0])
  nearPoint(point, [0, 2, 0])
  near(d, 3)
  assert.equal(typeof parameter, 'number')
  const plane = K.create_ruled_surface(K.create_line_segment([0, 0, 0], [4, 0, 0]), K.create_line_segment([0, 4, 0], [4, 4, 0]))
  const [onPlane, uvs, gap] = K.surface_closest_point(plane, [1, 3, 2])
  nearPoint(onPlane, [1, 3, 0])
  assert.ok(uvs.length >= 1 && uvs[0].length === 2)
  near(gap, 2)
  free(box)
})

test('brep_relationship tells apart separate, touching, overlapping and nested bodies', () => {
  const a = K.create_box([0, 0, 0], 10, 10, 10)
  const cases: [number, string, number][] = [
    [K.create_box([20, 0, 0], 5, 5, 5), 'separate', 10],
    [K.create_box([10, 0, 0], 5, 5, 5), 'touching', 0],
    [K.create_box([5, 5, 5], 10, 10, 10), 'interpenetrating', 0],
    [K.create_box([2, 2, 2], 2, 2, 2), 'a_contains_b', 2],
  ]
  for (const [b, relationship, distance] of cases) {
    const r = K.brep_relationship(a, b)
    assert.equal(r.relationship, relationship)
    near(r.distance, distance)
  }
  assert.equal(K.brep_relationship(cases[3][0], a).relationship, 'b_contains_a')
  free(a, ...cases.map((c) => c[0]))
})

// ---------------------------------------------------------------- intersections
test('intersect_breps gives the curves where two boxes cross, or the points where they touch', () => {
  const a = K.create_box([0, 0, 0], 10, 10, 10)
  const [curves, points] = K.intersect_breps(a, K.create_box([5, 5, 5], 10, 10, 10))
  assert.equal(curves.length, 6) // edges of the common cube [5, 10]^3 on both surfaces
  for (const c of curves) near(curveDist(c, [10, 10, 10]), 5)
  assert.deepEqual(points, [])
  const [none, touching] = K.intersect_breps(a, K.create_box([10, 10, 10], 10, 10, 10))
  assert.equal(none.length, 0)
  assert.ok(touching.length > 0)
  for (const p of touching) nearPoint(p, [10, 10, 10])
  free(a)
})

test('intersect_brep_with_plane: the section of a cylinder is a circle of its radius', () => {
  const cylinder = K.create_cylinder([0, 0, 0], 4, 10)
  const section = K.intersect_brep_with_plane(cylinder, [0, 0, 5], [0, 0, 1])
  assert.equal(section.length, 1)
  near(curveDist(section[0], [0, 0, 5]), 4)
  nearPoint(K.curve_closest_point(section[0], [10, 0, 5])[0], [4, 0, 5])
  free(cylinder)
})

test('intersect_curves: where two lines cross, where a line cuts a circle', () => {
  const [points, t1, t2] = K.intersect_curves(K.create_line_segment([0, 0, 0], [10, 0, 0]),
    K.create_line_segment([3, -5, 0], [3, 5, 0]))
  assert.equal(points.length, 1)
  nearPoint(points[0], [3, 0, 0])
  assert.ok(t1 instanceof Float64Array && t2 instanceof Float64Array)
  near(t1[0], 0.3)
  near(t2[0], 0.5)
  const [crossings] = K.intersect_curves(K.create_circle([0, 0, 0], 5), K.create_line_segment([-10, 3, 0], [10, 3, 0]))
  const xs = crossings.map((p: number[]) => p[0]).sort((a: number, b: number) => a - b)
  nearPoint(xs, [-4, 4])
})

// ---------------------------------------------------------------- projections
test('project_brep_onto_plane draws the outline of a box on the plane', () => {
  const box = K.create_box([0, 0, 0], 10, 4, 2)
  const outline = K.project_brep_onto_plane(box, [0, 0, -5], [0, 0, 1])
  assert.equal(outline.length, 4)
  for (const c of outline) near(K.curve_closest_point(c, [5, 2, -5])[0][2], -5)
  free(box)
})

test('create_silhouette_curves: a sphere seen from above shows its equator', () => {
  const sphere = K.create_sphere([0, 0, 0], 3)
  const silhouette = K.create_silhouette_curves(sphere, [0, 0, 0], [0, 0, 1])
  assert.equal(silhouette.length, 1)
  near(curveDist(silhouette[0], [0, 0, 0]), 3, 1e-3)
  nearPoint(K.curve_closest_point(silhouette[0], [10, 0, 0])[0], [3, 0, 0], 1e-3)
  free(sphere)
})

test('project_curve drops a line onto the faces of a box below it', () => {
  const box = K.create_box([0, 0, 0], 10, 10, 10)
  const line = K.create_line_segment([2, 5, 20], [8, 5, 20])
  const curves = K.project_curve(box, line, [0, 0, -1])
  assert.ok(curves.length >= 1)
  const d = curves.map((c: number) => curveDist(c, [5, 5, 20]))
  near(Math.min(...d), 10) // on the top face
  near(curveDist(line, [5, 5, 20]), 0) // the line itself unchanged
  free(box)
})

// ---------------------------------------------------------------- tessellation
test('tessellate_boundaries gives one polyline per edge', () => {
  const box = K.create_box([0, 0, 0], 60, 44, 28)
  const [points, counts, edges] = K.tessellate_boundaries(box, 5, false)
  assert.ok(points instanceof Float64Array && counts instanceof Float64Array)
  assert.equal(edges.length, 12)
  assert.deepEqual(Array.from(counts), new Array(12).fill(2)) // straight edges: their two ends
  assert.equal(points.length, 3 * 24)
  for (let i = 0; i < points.length; i += 3) {
    assert.ok([0, 60].includes(points[i]) && [0, 44].includes(points[i + 1]) && [0, 28].includes(points[i + 2]))
  }
  const cylinder = K.create_cylinder([0, 0, 0], 4, 10)
  const [p, n, e] = K.tessellate_boundaries(cylinder, 5, false)
  assert.equal(e.length, 3) // two circles and the seam
  const most = Math.max(...n)
  assert.ok(most > 10)
  for (let i = 0; i < p.length; i += 3) near(Math.hypot(p[i], p[i + 1]), 4, 1e-9)
  assert.throws(() => K.tessellate_boundaries(box, -1, false), /SmApiTessellateBoundaries failed: SM_ERR_INVALID_INPUT/)
  free(box, cylinder)
})

// ---------------------------------------------------------------- meshes
test('poly_boolean: the union of two box meshes', (t) => {
  assert.throws(() => K.poly_boolean(0, 0, K.PolyBooleanOp_UNION), /PolyBrep/)
  if (typeof K.ext__tessellate !== 'function') {
    t.skip('no PolyBrep to combine: the module has no ext__tessellate')
    return
  }
  const mesh = (b: number): number => {
    const m = K.ext__tessellate(b, 0.1, 15, 15, 0, 0, 'auto', false, false, false)
    free(b)
    return m
  }
  const a = mesh(K.create_box([0, 0, 0], 10, 10, 10))
  const union = K.poly_boolean(a, mesh(K.create_box([5, 5, 5], 10, 10, 10)), K.PolyBooleanOp_UNION)
  assert.equal(union, a) // the result is the first mesh, changed; the second is deleted
  assert.throws(() => K.poly_boolean(union, union, 99), /PolyBooleanOp/)
  if (typeof K.poly_mesh === 'function') {
    const points: Float32Array = K.poly_mesh(union, false).points
    const xs = Array.from(points.filter((_, i) => i % 3 === 0))
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [0, 15])
  }
  K.ext__delete_polybrep?.(union)
})

// ---------------------------------------------------------------- errors
test('a failing kernel call throws an Error naming the call and the status', () => {
  assert.throws(() => K.create_circle([0, 0, 0], 0), (e: Error) => {
    assert.ok(e instanceof Error)
    assert.match(e.message, /SmApiCreateCircle failed: SM_ERR_INVALID_INPUT/)
    return true
  })
  assert.throws(() => K.create_box([0, 0], 1, 1, 1), /three coordinates/)
})
