// tests/test_closeout_M.py: close-out of the kernel plan's meshes, drawings and files (area M): rays
// that graze a curved face within the mesh's tolerance (M5), folds left by decimation and its feature
// angle (M6), drawings of several bodies (M4), empty bodies and empty lists in the writers (X10), STEP offset curves and edges given as
// PCURVEs (I6), mirrored and scaled assembly placements (I10), offsets of whole spheres (I11), colors of
// coordinate systems (I12), IGES offset curves (I14), and .brep tolerances and planes (X14).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Align,
  Box,
  Circle,
  Cylinder,
  Helix,
  ModelingError,
  Plane,
  ShapeList,
  Sphere,
  StepFrame,
  Vector,
  Z,
  drawingViews,
  exportGlb,
  exportGltf,
  exportObj,
  exportStep,
  fromBrep,
  fromStep,
  fromIges,
  fromStepModel,
  setWarningHandler,
  sweep,
  toBrep,
  toGlb,
  toGltf,
  toObj,
  toStep,
  type Hit,
  type Part,
  type Shell,
} from '../src/index.ts'
import type { Mesh } from '../src/mesh.ts'
import { approx } from './_approx.ts'

function tmpPath(): string {
  return mkdtempSync(join(tmpdir(), 'smlibwasm-closeout-m-'))
}

/** Runs fn and gives back the warnings it made (those of mass properties left out). */
function warnings<T>(fn: () => T): [T, string[]] {
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    return [fn(), said.filter((m) => !m.includes('mass properties'))]
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
}

/** A seeded random number generator (mulberry32), uniform in [0, 1). */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sameHit(a: Hit | null, b: Hit | null, tol = 1e-7): boolean {
  if (a === null || b === null) return a === null && b === null
  return Math.abs(a.distance - b.distance) <= tol && a.point.sub(b.point).length <= tol
}

/** How many of the rays raycastMany answers otherwise than raycast. */
function mismatches(part: Part, origins: number[][], directions: number[][]): number {
  const many = part.raycastMany(origins, directions)
  let bad = 0
  origins.forEach((o, i) => {
    const exact = part.raycast(o, directions[i])
    if (!sameHit(exact[0] ?? null, many[i])) bad++
  })
  return bad
}

// =============================================================================
// M5: rays that graze a curved face within the mesh's tolerance
// =============================================================================
test('raycastMany: rays that graze a sphere agree with raycast', () => {
  // The mesh lies inside the sphere by up to its tolerance (1e-4 of the size): rays that pass the mesh
  // just outside it can still touch the sphere (297 of 2000 came out misses in 0.5.0's first version).
  const sphere = Sphere(10)
  const tol = sphere.bbox().diagonal * 1e-4
  const rnd = random(1)
  const origins: number[][] = []
  for (let i = 0; i < 600; i++) {
    const a = rnd() * 2 * Math.PI
    const r = 10 + (-3 + 3.3 * rnd()) * tol
    origins.push([-50, r * Math.cos(a), r * Math.sin(a)])
  }
  assert.equal(mismatches(sphere, origins, origins.map(() => [1, 0, 0])), 0)
})

test('raycastMany: rays that graze a boss, then meet a wall', () => {
  // rays along the outline of a boss (just inside it) touch it; those just outside go on to the ring
  // wall behind (50 of 400 were answered with the wall in 0.5.0's first version)
  const up: [Align, Align, Align] = [Align.CENTER, Align.CENTER, Align.MIN]
  const tube = Cylinder(35, 20, { align: up }).cut(Cylinder(33, 30, { align: up }))
  const part = Box(80, 80, 2).fuse(Cylinder(5, 10, { align: up }).translate(0, 0, 1)).fuse(tube)
  let tol = part.bbox().diagonal * 1e-4
  const rnd = random(5)
  const origins: number[][] = []
  const tangents: number[][] = []
  for (let i = 0; i < 300; i++) {
    const a = rnd() * 2 * Math.PI
    const r = 5 + (-2.5 + 2.7 * rnd()) * tol
    const t = [-Math.sin(a), Math.cos(a), 0]
    origins.push([r * Math.cos(a) - 20 * t[0], r * Math.sin(a) - 20 * t[1], 6])
    tangents.push(t)
  }
  assert.equal(mismatches(part, origins, tangents), 0)
  // a cylinder seen side on, rays across its outline; a boss on a plate before a wall
  const cylinder = Cylinder(10, 20)
  tol = cylinder.bbox().diagonal * 1e-4
  const across = Array.from({ length: 40 }, (_, i) => [-50, 10 - 3 * tol + (3.5 * tol * i) / 39, 0])
  assert.equal(mismatches(cylinder, across, across.map(() => [1, 0, 0])), 0)
  const plate = Box(60, 40, 2).fuse(Cylinder(5, 10, { align: up }).translate(0, 0, 1)).fuse(Box(2, 40, 20).translate(20, 0, 10))
  tol = plate.bbox().diagonal * 1e-4
  const past = Array.from({ length: 40 }, (_, i) => [-25, 5 - 3 * tol + (3.5 * tol * i) / 39, 6])
  assert.equal(mismatches(plate, past, past.map(() => [1, 0, 0])), 0)
})

// =============================================================================
// M6: decimation leaves no folds; its feature angle
// =============================================================================
/** Triangles that face against the triangles across their edges (slivers folded over). */
function folds(mesh: Mesh): number {
  const v = mesh.vertices
  const t = mesh.triangles
  const n = t.length / 3
  const normal: number[][] = []
  const byEdge = new Map<string, number[]>()
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
  for (let i = 0; i < n; i++) {
    const [a, b, c] = [t[3 * i], t[3 * i + 1], t[3 * i + 2]]
    const u = [0, 1, 2].map((k) => v[3 * b + k] - v[3 * a + k])
    const w = [0, 1, 2].map((k) => v[3 * c + k] - v[3 * a + k])
    normal.push([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]])
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const list = byEdge.get(key(p, q)) ?? []
      list.push(i)
      byEdge.set(key(p, q), list)
    }
  }
  let out = 0
  for (let i = 0; i < n; i++) {
    const [a, b, c] = [t[3 * i], t[3 * i + 1], t[3 * i + 2]]
    const around = [0, 0, 0]
    for (const [p, q] of [[a, b], [b, c], [c, a]])
      for (const u of byEdge.get(key(p, q)) ?? []) if (u !== i) for (let k = 0; k < 3; k++) around[k] += normal[u][k]
    if (normal[i][0] * around[0] + normal[i][1] * around[1] + normal[i][2] * around[2] < 0) out++
  }
  return out
}

for (const [tolerance, fraction] of [[0.01, 0.8], [0.01, 0.9], [0.005, 0.9]]) {
  test(`decimated meshes keep no folded slivers [${tolerance}, ${fraction}]`, () => {
    // 0.5.0's first decimation left 3 folded slivers in the first of these (3 to 13 in finer spheres)
    const mesh = Sphere(10).mesh(tolerance)
    const d = mesh.decimate(fraction)
    assert.equal(folds(d), 0)
    assert.ok(d.isClosed())
    approx(d.length, mesh.length * (1 - fraction), 0.05)
  })
}

test('decimate featureAngle', () => {
  const mesh = Cylinder(5, 10).mesh(0.01)
  const sharp = mesh.decimate(0.5) // (30 degrees: the rims are features)
  const smooth = mesh.decimate(0.5, { featureAngle: 120 }) // (the rims' 90 degrees are not)
  for (const d of [sharp, smooth]) {
    assert.ok(d.isClosed())
    assert.equal(folds(d), 0)
  }
  // the largest angle between a corner normal of a triangle of the top cap and +Z
  const capTilt = (d: Mesh): number => {
    let worst = 0
    for (let i = 0; i < d.length; i++) {
      const top = [0, 1, 2].every((c) => Math.abs(d.vertices[3 * d.triangles[3 * i + c] + 2] - 5) < 1e-9)
      if (!top) continue
      for (let c = 0; c < 3; c++) {
        const nz = (d.normals as Float32Array)[9 * i + 3 * c + 2]
        worst = Math.max(worst, (Math.acos(Math.min(1, Math.max(-1, nz))) * 180) / Math.PI)
      }
    }
    return worst
  }
  assert.ok(capTilt(sharp) < 1e-3)
  assert.ok(capTilt(smooth) > 20)
  for (const bad of [-1, 181, Number.NaN])
    assert.throws(() => mesh.decimate(0.5, { featureAngle: bad }), (e: unknown) => e instanceof RangeError && /featureAngle is 0 to 180 degrees/.test(e.message))
})

// =============================================================================
// M4: drawings of several bodies
// =============================================================================
test('drawingViews of several bodies hide each other', () => {
  // drawingViews took one part; a list of bodies (an assembly) is drawn together: a cylinder in front
  // of a box hides 10 of each of the box's top and bottom edges in the front view
  const box = Box(20, 20, 20)
  const cylinder = Cylinder(5, 40).translate(0, -30, 0)
  const [front, top] = drawingViews([box, cylinder])
  const length = (edges: Iterable<{ length: number }>) => [...edges].reduce((s, e) => s + e.length, 0)
  approx(length(front.hidden), 20, 0, 0.01)
  approx(length(front.visible), 160, 0, 0.01)
  const [alone] = drawingViews(box)
  approx(length(alone.visible), 80, 1e-9)
  assert.equal(alone.hidden.length, 0)
  // the side views see both, side by side
  approx(top.bbox().size.x, 20, 0, 1e-6)
  approx(top.bbox().size.y, 45, 0, 1e-6)
  assert.equal(drawingViews([box]).length, 3)
  assert.equal(drawingViews(new ShapeList(box, cylinder), 'front').length, 1)
  assert.throws(() => drawingViews([]), (e: unknown) => e instanceof RangeError && e.message === 'drawingViews: nothing to draw')
  assert.throws(() => drawingViews([box, new Vector(1, 2, 3)] as unknown as Part[]), (e: unknown) => e instanceof TypeError && /drawingViews draws parts and shells, not a Vector/.test(e.message))
})

// =============================================================================
// X10: nothing to write
// =============================================================================
test('exportStep of a list with an empty body throws', () => {
  const empty = Box(2, 2, 2).intersect(Box(2, 2, 2).translate(10, 0, 0))
  const path = join(tmpPath(), 'a.step')
  for (const options of [{}, { assembly: true }]) {
    assert.throws(
      () => exportStep([Box(10, 10, 10), empty.named('gone')], path, options),
      (e: unknown) => e instanceof RangeError && /^exportStep: the Part 'gone' is empty: it has no faces to write/.test(e.message),
    )
    assert.ok(!existsSync(path))
  }
  assert.throws(() => toStep([Box(10, 10, 10), empty]), /^RangeError: toStep: the Part is empty: it has no faces to write \(a Boolean/)
  assert.throws(() => toStep([]), /toStep: nothing to write/)
})

test('mesh writers of nothing throw', () => {
  const dir = tmpPath()
  for (const [write, name] of [[exportGlb, 'exportGlb'], [exportGltf, 'exportGltf'], [exportObj, 'exportObj']] as const) {
    const path = join(dir, `a.${name.slice(6).toLowerCase()}`)
    assert.throws(() => write([], path), (e: unknown) => e instanceof RangeError && e.message === `${name}: nothing to write`)
    assert.ok(!existsSync(path)) // (0.5.0 wrote an empty file)
  }
  for (const [make, name] of [[toGlb, 'toGlb'], [toGltf, 'toGltf'], [toObj, 'toObj']] as const)
    assert.throws(() => make([]), (e: unknown) => e instanceof RangeError && e.message === `${name}: nothing to write`)
  // what there is is written as before
  assert.equal(toObj([Box(1, 1, 1)]).split('\nv ').length - 1, 8)
  assert.equal(new TextDecoder().decode(toGlb([Box(1, 1, 1)]).slice(0, 4)), 'glTF')
})

// =============================================================================
// I6: OFFSET_CURVE_3D and edges given as PCURVEs
// =============================================================================
function nextId(text: string): number {
  return Math.max(...[...text.matchAll(/#(\d+)=/g)].map((m) => Number(m[1]))) + 1
}

function withLines(text: string, lines: string[]): string {
  return text.replace('ENDSEC;\nEND-ISO', `${lines.map((x) => `${x}\n`).join('')}ENDSEC;\nEND-ISO`)
}

function group(text: string, pattern: string, i = 1): string {
  const m = text.match(new RegExp(pattern))
  assert.ok(m, pattern)
  return m[i]
}

/** A Cylinder(5, 10)'s STEP text and the ids of its parts: the top circle and its placement's axis,
 * the seam line, the cylindrical surface and the representation context. */
function cylinderStep(): { text: string; top: string; z: string; seam: string; surface: string; context: string } {
  const text = toStep(Cylinder(5, 10))
  const circles = [...text.matchAll(/#(\d+)=CIRCLE\('',#(\d+),5\.0\);/g)]
  const [, top, place] = circles[circles.length - 1]
  return {
    text,
    top,
    z: group(text, `#${place}=AXIS2_PLACEMENT_3D\\('',#\\d+,#(\\d+),#\\d+\\);`),
    seam: group(text, "#(\\d+)=LINE\\('',#\\d+,#\\d+\\);"),
    surface: group(text, '#(\\d+)=CYLINDRICAL_SURFACE\\('),
    context: group(text, '#(\\d+)=\\(GEOMETRIC_REPRESENTATION_CONTEXT'),
  }
}

function readsAsTheCylinder(text: string, kinds: string[]): void {
  const [part, said] = warnings(() => fromStep(text) as Part)
  assert.deepEqual(said, []) // (nothing left out)
  assert.ok(part.isValid())
  approx(part.volume, Math.PI * 250, 1e-9)
  assert.deepEqual(part.edges().map((e) => e.geomType).sort(), [...kinds].sort())
}

test('STEP offset curves are read', () => {
  // 0.5.0 left a body with an OFFSET_CURVE_3D out ("curve type OFFSET_CURVE_3D, which is not supported")
  const { text, top, z } = cylinderStep()
  const n = nextId(text)
  // the top circle as the offset of a circle of radius 7 about the axis by 2 (ISO 10303-42 offsets along
  // ref_direction x tangent: the axis x the tangent points into the circle, as OpenCASCADE reads it)
  const radius7 = text.replace(
    new RegExp(`#${top}=CIRCLE\\('',(#\\d+),5\\.0\\);`),
    `#${n}=CIRCLE('',$1,7.0);\n#${top}=OFFSET_CURVE_3D('',#${n},2.0,.F.,#${z});`,
  )
  readsAsTheCylinder(radius7, ['circle', 'circle'])
  // its basis a rational B-spline circle of radius 3 offset by -2 (outwards): the kernel's offset curve
  // (SmOffsetCurve)
  const w = Math.sqrt(0.5)
  const corners = [[3, 0], [3, 3], [0, 3], [-3, 3], [-3, 0], [-3, -3], [0, -3], [3, -3], [3, 0]]
  const lines = corners.map(([x, y], i) => `#${n + i}=CARTESIAN_POINT('',(${x}.,${y}.,5.));`)
  const refs = corners.map((_, i) => `#${n + i}`).join(',')
  const b = n + 9
  lines.push(
    `#${b}=(BOUNDED_CURVE() B_SPLINE_CURVE(2,(${refs}),.UNSPECIFIED.,.F.,.F.) B_SPLINE_CURVE_WITH_KNOTS((3,2,2,2,3),` +
      `(0.,1.,2.,3.,4.),.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_CURVE((1.,${w},1.,${w},1.,` +
      `${w},1.,${w},1.)) REPRESENTATION_ITEM(''));`,
  )
  const spline = withLines(text.replace(new RegExp(`#${top}=CIRCLE\\('',#\\d+,5\\.0\\);`), `#${top}=OFFSET_CURVE_3D('',#${b},-2.0,.F.,#${z});`), lines)
  readsAsTheCylinder(spline, ['circle', 'bspline'])
  approx((fromStepModel(radius7).bodies[0] as Part).volume, Math.PI * 250, 1e-9)
})

test('STEP edges given as PCURVEs are read', () => {
  // 0.5.0 left a body with an edge given only as a PCURVE out
  const { text, top, seam, surface, context } = cylinderStep()
  const pcurve = (old: string, rep: string[]): string => {
    const n = nextId(text)
    const body = rep.map((x) => x.replace(/\$(\d)/g, (_, d) => String(n + Number(d))))
    const last = n + body.length - 1
    const replaced = text.replace(new RegExp(`#${old}=[A-Z_]+\\([^;]*\\);`), `#${old}=PCURVE('',#${surface},#${last + 1});`)
    return withLines(replaced, [...body, `#${last + 1}=DEFINITIONAL_REPRESENTATION('',(#${last}),#${context});`])
  }
  // the top circle: the line v = 10 in the cylinder's parameters (its placement is at z = -5)
  readsAsTheCylinder(
    pcurve(top, ["#$0=CARTESIAN_POINT('',(0.,10.));", "#$1=DIRECTION('',(1.,0.));", "#$2=VECTOR('',#$1,1.);", "#$3=LINE('',#$0,#$2);"]),
    ['circle', 'circle'],
  )
  // the seam: the line u = 0 along v
  readsAsTheCylinder(
    pcurve(seam, ["#$0=CARTESIAN_POINT('',(0.,0.));", "#$1=DIRECTION('',(0.,1.));", "#$2=VECTOR('',#$1,1.);", "#$3=LINE('',#$0,#$2);"]),
    ['circle', 'circle'],
  )
  // the top circle as a B-spline in (u, v) from u = 0 to 2 pi at v = 10: a NURBS through its points
  readsAsTheCylinder(
    pcurve(top, [
      "#$0=CARTESIAN_POINT('',(0.,10.));",
      "#$1=CARTESIAN_POINT('',(3.14159265358979,10.));",
      "#$2=CARTESIAN_POINT('',(6.28318530717959,10.));",
      "#$3=B_SPLINE_CURVE_WITH_KNOTS('',2,(#$0,#$1,#$2),.UNSPECIFIED.,.F.,.F.,(3,3),(0.,1.),.UNSPECIFIED.);",
    ]),
    ['circle', 'bspline'],
  )
})

test('STEP PCURVEs on B-spline surfaces and planes are read', () => {
  // a box's edge as a line in the parameters of one of its faces: a B-spline surface
  let text = toStep(Box(10, 10, 10).toNurbs())
  const m = text.match(/#(\d+)=B_SPLINE_SURFACE_WITH_KNOTS\('',1,1,\(\(#(\d+),#(\d+)\),\(#(\d+),#(\d+)\)\),[^;]*\(0\.,10\.0\),\(0\.,10\.0\)/)
  assert.ok(m)
  const [, s, p00, , p10] = m
  let edge = group(text, `#(\\d+)=B_SPLINE_CURVE_WITH_KNOTS\\('',1,\\(#${p00},#${p10}\\),[^;]*\\(0\\.,10\\.0\\)`)
  let context = group(text, '#(\\d+)=\\(GEOMETRIC_REPRESENTATION_CONTEXT')
  let n = nextId(text)
  let replaced = text.replace(new RegExp(`#${edge}=B_SPLINE_CURVE_WITH_KNOTS\\([^;]*\\);`), `#${edge}=PCURVE('',#${s},#${n + 3});`)
  let [part, said] = warnings(() =>
    fromStep(
      withLines(replaced, [
        `#${n}=CARTESIAN_POINT('',(0.,0.));`,
        `#${n + 1}=CARTESIAN_POINT('',(10.,0.));`,
        `#${n + 2}=B_SPLINE_CURVE_WITH_KNOTS('',1,(#${n},#${n + 1}),.UNSPECIFIED.,.F.,.F.,(2,2),(0.,10.),.UNSPECIFIED.);`,
        `#${n + 3}=DEFINITIONAL_REPRESENTATION('',(#${n + 2}),#${context});`,
      ]),
    ) as Part,
  )
  assert.deepEqual(said, [])
  assert.ok(part.isValid())
  approx(part.volume, 1000, 1e-9)
  // a plane: the box written with planes, an edge of its first face as a line in the plane's parameters
  text = toStep(Box(10, 10, 10))
  const vec = (ref: string): number[] =>
    group(text, `#${ref}=(?:CARTESIAN_POINT|DIRECTION)\\('',\\(([^)]*)\\)\\);`).split(',').map(Number)
  const f = text.match(/#(\d+)=ADVANCED_FACE\('',\(#(\d+)\),#(\d+),/)
  assert.ok(f)
  const [, , bound, plane] = f
  const place = group(text, `#${plane}=PLANE\\('',#(\\d+)\\);`)
  const a = text.match(new RegExp(`#${place}=AXIS2_PLACEMENT_3D\\('',#(\\d+),#(\\d+),#(\\d+)\\);`))
  assert.ok(a)
  const [origin, z, x] = [vec(a[1]), vec(a[2]), vec(a[3])]
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
  const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
  const loop = group(text, `#${bound}=FACE_OUTER_BOUND\\('',#(\\d+),`)
  const first = group(text, `#${loop}=EDGE_LOOP\\('',\\(#(\\d+)`)
  edge = group(text, `#${first}=ORIENTED_EDGE\\('',\\*,\\*,#(\\d+),`)
  const e = text.match(new RegExp(`#${edge}=EDGE_CURVE\\('',#(\\d+),#(\\d+),#(\\d+),`))
  assert.ok(e)
  const [p0, p1] = [e[1], e[2]].map((v) => vec(group(text, `#${v}=VERTEX_POINT\\('',#(\\d+)\\);`)))
  const [uv0, uv1] = [p0, p1].map((p) => {
    const d = [0, 1, 2].map((k) => p[k] - origin[k])
    return [dot(d, x), dot(d, y)]
  })
  const len = Math.hypot(uv1[0] - uv0[0], uv1[1] - uv0[1])
  const d = [(uv1[0] - uv0[0]) / len, (uv1[1] - uv0[1]) / len]
  context = group(text, '#(\\d+)=\\(GEOMETRIC_REPRESENTATION_CONTEXT')
  n = nextId(text)
  replaced = text.replace(new RegExp(`#${e[3]}=LINE\\([^;]*\\);`), `#${e[3]}=PCURVE('',#${plane},#${n + 4});`)
  ;[part, said] = warnings(() =>
    fromStep(
      withLines(replaced, [
        `#${n}=CARTESIAN_POINT('',(${uv0[0]},${uv0[1]}));`,
        `#${n + 1}=DIRECTION('',(${d[0]},${d[1]}));`,
        `#${n + 2}=VECTOR('',#${n + 1},1.);`,
        `#${n + 3}=LINE('',#${n},#${n + 2});`,
        `#${n + 4}=DEFINITIONAL_REPRESENTATION('',(#${n + 3}),#${context});`,
      ]),
    ) as Part,
  )
  assert.deepEqual(said, [])
  assert.ok(part.isValid())
  approx(part.volume, 1000, 1e-9)
  assert.deepEqual(part.edges().map((x) => x.geomType), new Array(12).fill('line'))
})

// =============================================================================
// I10: placements that mirror or scale
// =============================================================================
/** Two brackets in an assembly, the second placed by a CARTESIAN_TRANSFORMATION_OPERATOR_3D (a functionally
 * defined transformation) 30 along x, mirrored in x and scaled as asked. */
function operatorPlacement(scale: number, mirror: boolean): [Part, string] {
  const bracket = Box(10, 4, 2).fuse(Box(2, 4, 6).translate(4, 0, 4)).named('bracket')
  const text = toStep([bracket, bracket], { assembly: true, name: 'asm' })
  const ids = [...text.matchAll(/#(\d+)=ITEM_DEFINED_TRANSFORMATION/g)].map((m) => m[1])
  const last = ids[ids.length - 1]
  const n = nextId(text)
  const extra = [
    `#${n}=DIRECTION('',(${mirror ? '-1.' : '1.'},0.,0.));`,
    `#${n + 1}=DIRECTION('',(0.,1.,0.));`,
    `#${n + 2}=DIRECTION('',(0.,0.,1.));`,
    `#${n + 3}=CARTESIAN_POINT('',(30.,0.,0.));`,
  ]
  const placed = text.replace(
    new RegExp(`#${last}=ITEM_DEFINED_TRANSFORMATION\\([^;]*\\);`),
    `#${last}=CARTESIAN_TRANSFORMATION_OPERATOR_3D('','',#${n},#${n + 1},#${n + 3},${scale.toFixed(1)},#${n + 2});`,
  )
  return [bracket, withLines(placed, extra)]
}

test('STEP assembly placements that mirror or scale are read', () => {
  // 0.5.0 left such instances out ("mirrored assembly placements are not supported yet")
  let [bracket, text] = operatorPlacement(1, true)
  const [[a, b], said] = warnings(() => fromStep(text) as unknown as Part[])
  assert.deepEqual(said, [])
  const expected = bracket.mirror(Plane.YZ).translate(30, 0, 0)
  assert.ok(b.isValid())
  assert.equal(b.name, 'bracket')
  approx(b.volume, bracket.volume, 1e-12)
  assert.ok(b.bbox().min.sub(expected.bbox().min).length < 1e-9 && b.bbox().max.sub(expected.bbox().max).length < 1e-9)
  approx(b.cut(expected).volume, 0, 0, 1e-6)
  approx(a.volume, bracket.volume, 1e-12)
  ;[bracket, text] = operatorPlacement(2, false)
  const [, big] = fromStep(text) as unknown as Part[]
  assert.ok(big.isValid())
  approx(big.volume, 8 * bracket.volume, 1e-9)
  const size = big.bbox().size
  approx(size.x, 20, 1e-9)
  approx(size.y, 8, 1e-9)
  approx(size.z, 16, 1e-9)
})

// =============================================================================
// I11: an offset of a whole sphere
// =============================================================================
for (const [radius, distance] of [[8, 2], [12, -2]]) {
  test(`STEP offset of a whole sphere imports [${radius}, ${distance}]`, () => {
    // a sphere written as an OFFSET_SURFACE of another sphere (0.5.0: "import STEP failed": the kernel
    // cannot close a solid of an offset face with the sphere's seam and poles); it is the sphere of
    // radius r + d
    let text = toStep(Sphere(10))
    const m = text.match(/#(\d+)=SPHERICAL_SURFACE\('',#(\d+),10\.0\);/)
    assert.ok(m)
    const n = nextId(text)
    text = text.replace(m[0], `#${n}=SPHERICAL_SURFACE('',#${m[2]},${radius.toFixed(1)});\n#${m[1]}=OFFSET_SURFACE('',#${n},${distance.toFixed(1)},.F.);`)
    const [part, said] = warnings(() => fromStep(text) as Part)
    assert.deepEqual(said, [])
    assert.ok(part.isValid())
    approx(part.volume, Sphere(10).volume, 1e-9)
    assert.deepEqual(part.faces().map((f) => f.geomType), ['sphere'])
  })
}

// =============================================================================
// X14: .brep tolerances
// =============================================================================
function tolerances(text: string): Record<string, number[]> {
  const lines = text.split('\n')
  const out: Record<string, number[]> = {}
  for (const kind of ['Ed', 'Ve', 'Fa']) {
    const values = new Set<number>()
    lines.forEach((x, i) => {
      if (x === kind) values.add(Number(lines[i + 1].split(' ')[kind === 'Fa' ? 1 : 0]))
    })
    out[kind] = [...values].sort((p, q) => p - q)
  }
  return out
}

test('.brep bodies with one tolerance longer than an edge read back', () => {
  // The bridge gave every edge, vertex and face of a body the largest tolerance of the file: an edge
  // shorter than it (a chamfer of 0.007 here, fillet edges of 0.005 in 4 of 557 corpus solids) read back
  // refused ("an edge of length -0.00293 ... its curve does not run from its start to its end").
  let part = Box(10, 10, 10)
  part = part.chamfer(part.edges().sortBy(Z).at(-1)!, 0.005)
  const lines = toBrep(part).split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    // (every tolerance 0.02, as such a file has them)
    if (lines[i] === 'Ed' || lines[i] === 'Ve' || lines[i] === 'Fa') {
      const parts = lines[i + 1].split(' ')
      parts[lines[i] === 'Fa' ? 1 : 0] = '0.02'
      lines[i + 1] = parts.join(' ')
    }
  }
  const [back, said] = warnings(() => fromBrep(lines.join('\n')) as Part)
  assert.deepEqual(said, [])
  assert.ok(back.isValid())
  approx(back.volume, part.volume, 1e-9)
})

test('.brep writer gives each edge its own tolerance', () => {
  // one corner of a box's STEP file moved 0.004 along x, off two of its edges: only those edges and the
  // vertices there get a tolerance that covers it (0.5.0 wrote the body's largest, 0.016, everywhere)
  let text = toStep(Box(10, 10, 10))
  const corner = text.match(/#(\d+)=CARTESIAN_POINT\('',\(5\.0,5\.0,5\.0\)\);/)
  assert.ok(corner)
  text = text.replace(corner[0], `#${corner[1]}=CARTESIAN_POINT('',(5.004,5.0,5.0));`)
  const part = fromStep(text) as Part
  const brep = toBrep(part)
  const tol = tolerances(brep)
  assert.equal(tol.Fa.length, 1)
  approx(tol.Fa[0], 2e-5, 1e-9)
  approx(tol.Ed[0], 2e-5, 1e-9)
  assert.ok(tol.Ed[tol.Ed.length - 1] > 0.004 && tol.Ed[tol.Ed.length - 1] < 0.016)
  const lines = brep.split('\n')
  assert.equal(lines.filter((x, i) => x === 'Ed' && Number(lines[i + 1].split(' ')[0]) > 1e-4).length, 2)
  const [back] = warnings(() => fromBrep(brep) as Part) // (the corner's gap is reported)
  assert.ok(back.isValid())
  approx(back.volume, part.volume, 1e-9)
  // a part of smlibwasm's own: every tolerance the one of its size
  for (const values of Object.values(tolerances(toBrep(Box(10, 10, 10))))) {
    assert.equal(values.length, 1)
    approx(values[0], 2e-5, 1e-9)
  }
})

test('.brep planes bounded by long curves read back', () => {
  // The reader boxed a plane's boundary by 24 points along each edge, which missed 0.8 of the cut end of
  // the spring example (a closed edge 51 long and 2.4 wide): the plane's range did not hold the face,
  // whose curves were made 0.8 off its edge, and the spring read back refused (a gap of 0.8).
  const coil = sweep(Circle(1.2), Helix(6, 48, 10)) as Part
  const spring = coil.split(Plane.XY.offset(1.2)).split(Plane.XY.offset(48 - 1.2), 'below')
  const [back, said] = warnings(() => fromBrep(toBrep(spring)) as Part)
  assert.deepEqual(said, [])
  assert.ok(back.isValid())
  approx(back.volume, spring.volume, 1e-6)
  const planes = (p: Part) => p.faces().filter((f) => f.geomType === 'plane').map((f) => f.area).sort((a, b) => a - b)
  planes(back).forEach((a, i) => approx(a, planes(spring)[i], 1e-6))
  // (the box of 256 points of a circle that starts at 30 degrees falls short by 5.6e-5: a margin)
  const cut = Sphere(5).cut(Box(20, 20, 10).translate(0, 0, 9))
  const [again, noted] = warnings(() => fromBrep(toBrep(cut)) as Part)
  assert.deepEqual(noted, [])
  approx(again.volume, cut.volume, 1e-12)
})

// =============================================================================
// I12: colors of coordinate systems
// =============================================================================
test('STEP coordinate systems keep their colors', () => {
  // readStep read the color of a coordinate system (NX writes them so); exportStep left it out
  const frame = new StepFrame('MCS', Plane.XY.offset(5), '', [1, 0.5, 0])
  const model = fromStepModel(toStep([frame, new StepFrame('PCS', Plane.XZ), Box(2, 2, 2)]))
  assert.deepEqual(model.frames.map((f) => [f.name, f.color]), [['MCS', [1, 0.5, 0]], ['PCS', null]])
  approx(model.frames[0].plane.origin.z, 5, 1e-12)
  assert.ok(toStep([frame]).includes('CURVE_STYLE') && !toStep([new StepFrame('PCS', Plane.XZ)]).includes('CURVE_STYLE'))
})

// =============================================================================
// I14: IGES offset curves (130)
// =============================================================================
const DEP = '00010000' // (the status of an entity that is part of another)
type IgesEntity = { type: number; params: (number | string | [string, number])[]; form?: number; status?: string }

/** An IGES file of entities (tests/test_lane_IX.py's); ['@', i] in params points at entity i. */
function igesText(entities: IgesEntity[]): string {
  const value = (v: number | string | [string, number]): string => {
    if (Array.isArray(v)) return String(2 * v[1] + 1)
    if (typeof v === 'string') return `${v.length}H${v}`
    return String(v)
  }
  const lines = (text: string, letter: string, width = 72): string[] => {
    const out: string[] = []
    for (let i = 0; i < Math.max(text.length, 1); i += width) out.push(text.slice(i, i + width).padEnd(width) + letter)
    return out
  }
  const g = `${['1H,', '1H;', '4Htest', '8Htest.igs', '4Htest', '4Htest', '32', '38', '6', '308', '15', '4Htest', '1.', '2', '2HMM', '1', '0.01', '15H20260101.000000', '1e-7', '100.', '4Htest', '4Htest', '11', '0', '15H20260101.000000'].join(',')};`
  const D: string[] = []
  const P: string[] = []
  entities.forEach((e, i) => {
    const text = `${[String(e.type), ...e.params.map(value)].join(',')};`
    const chunks: string[] = []
    for (let k = 0; k < text.length; k += 64) chunks.push(text.slice(k, k + 64))
    const start = P.length + 1
    for (const c of chunks) P.push(`${c.padEnd(64)} ${String(2 * i + 1).padStart(7)}P`)
    D.push([e.type, start, 0, 0, 0, 0, '0', 0].map((x) => String(x).padStart(8)).join('') + (e.status ?? '00000000').padStart(8) + 'D')
    D.push([e.type, 0, '0', chunks.length, e.form ?? 0, '', ''].map((x) => String(x).padStart(8)).join('') + ''.padStart(8) + '0'.padStart(8) + 'D')
  })
  const sections = [lines('smlibpy test', 'S'), lines(g, 'G'), D, P]
  const numbered = sections.flatMap((sec) => sec.map((line, k) => line + String(k + 1).padStart(7)))
  const counts = `S${String(sections[0].length).padStart(7)}G${String(sections[1].length).padStart(7)}D${String(D.length).padStart(7)}P${String(P.length).padStart(7)}`
  return `${[...numbered, `${counts.padEnd(72)}T${'1'.padStart(7)}`].join('\n')}\n`
}

function igesLine(a: number[], b: number[]): IgesEntity {
  return { type: 110, params: [...a, ...b], status: DEP }
}

/** A bounded plane (108) z = 0 whose boundary is a composite (102) of the curves. */
function boundedPlane(curves: IgesEntity[]): IgesEntity[] {
  return [
    { type: 108, form: 1, params: [0, 0, 1, 0, ['@', 1], 0, 0, 0, 0] },
    { type: 102, params: [curves.length, ...curves.map((_, i) => ['@', 2 + i] as [string, number])], status: DEP },
    ...curves,
  ]
}

/** An offset curve (130) of the entity at `base` by `distance` about +Z (in the plane z = 0). */
function offsetCurve(base: number, distance: number, end: number, flag = 1): IgesEntity {
  return { type: 130, params: [['@', base], flag, 0, 0, distance, 0, 0, 0, 0, 0, 1, 0, end], status: DEP }
}

test('IGES offset curves bound faces', () => {
  // 0.5.0 left a face bounded by an offset curve out ("curve entity 130 ... which is not supported"). The
  // base moves along its tangent x the normal, as OpenCASCADE reads such files (the square's side from
  // y = 3 to y = 5: area 50 in OpenCASCADE too).
  const circle: IgesEntity = { type: 100, params: [0, 0, 0, 3, 0, 3, 0], status: DEP }
  let disk = fromIges(igesText([...boundedPlane([offsetCurve(3, 2, 2 * Math.PI)]), circle])) as Shell
  approx(disk.area, 25 * Math.PI, 1e-12)
  assert.deepEqual(disk.edges().map((e) => e.geomType), ['circle'])
  const square = boundedPlane([igesLine([0, 0, 0], [10, 0, 0]), igesLine([10, 0, 0], [10, 5, 0]), offsetCurve(6, 2, 1), igesLine([0, 5, 0], [0, 0, 0])])
  approx((fromIges(igesText([...square, igesLine([10, 3, 0], [0, 3, 0])])) as Shell).area, 50, 1e-12)
  // a rational B-spline circle of radius 3 (126) as the base: the kernel's offset curve
  const s = Math.sqrt(0.5)
  const corners = [[3, 0], [3, 3], [0, 3], [-3, 3], [-3, 0], [-3, -3], [0, -3], [3, -3], [3, 0]]
  const spline: IgesEntity = {
    type: 126,
    status: DEP,
    params: [8, 2, 1, 1, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 1, s, 1, s, 1, s, 1, s, 1, ...corners.flatMap(([x, y]) => [x, y, 0]), 0, 4, 0, 0, 1],
  }
  disk = fromIges(igesText([...boundedPlane([offsetCurve(3, 2, 4)]), spline])) as Shell
  approx(disk.area, 25 * Math.PI, 1e-9)
  assert.deepEqual(disk.edges().map((e) => e.geomType), ['bspline'])
  // an offset whose distance varies is named in the message of what was left out
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    assert.throws(
      () => fromIges(igesText([...boundedPlane([offsetCurve(3, 2, 2 * Math.PI, 2)]), circle])),
      (e: unknown) => e instanceof ModelingError && /nothing in the file could be read/.test(e.message),
    )
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
  assert.ok(said.some((m) => /left out bounded plane DE 1: an offset curve whose distance varies \(DE 5\)/.test(m)), said.join('\n'))
})
