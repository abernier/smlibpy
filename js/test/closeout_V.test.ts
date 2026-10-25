// tests/test_closeout_V.py: close-out of the kernel plan, the verification of the merged close-out (V): STEP's
// OFFSET_CURVE_3D along the reference direction x the tangent (ISO 10303-42, as OpenCASCADE reads it), profiles
// swept round loops closed with a kink that pass the strict check and whose STEP and .brep files keep no loop that
// passes a vertex twice (the readers join such loops again), and the printed numbers of docs/kernel.md and the
// trim and loft references.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Box,
  CenterArc,
  Circle,
  Cylinder,
  type Edge,
  KernelError,
  Plane,
  Rectangle,
  Spline,
  X,
  Z,
  fromBrep,
  fromStep,
  fromStepModel,
  loft,
  setWarningHandler,
  surface,
  sweep,
  toBrep,
  toStep,
  type Part,
} from '../src/index.ts'
import { approx } from './_approx.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

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

// ---------------------------------------------------------------------------------- STEP's OFFSET_CURVE_3D
function withLines(text: string, lines: string[]): string {
  return text.replace('ENDSEC;\nEND-ISO', `${lines.map((x) => `${x}\n`).join('')}ENDSEC;\nEND-ISO`)
}

/** Cylinder(5, 10) with its top circle or its seam given as an offset curve in the sense of ISO 10303-42
 * (OpenCASCADE reads each as that cylinder, 785.398163, valid). */
function offsetFiles(): Record<string, string> {
  const text = toStep(Cylinder(5, 10))
  const circles = [...text.matchAll(/#(\d+)=CIRCLE\('',#(\d+),5\.0\);/g)]
  const [, top, place] = circles[circles.length - 1]
  const z = text.match(new RegExp(`#${place}=AXIS2_PLACEMENT_3D\\('',#\\d+,#(\\d+),#\\d+\\);`))![1]
  const [, seam, vector] = text.match(/#(\d+)=LINE\('',#\d+,#(\d+)\);/)!
  const n = Math.max(...[...text.matchAll(/#(\d+)=/g)].map((m) => Number(m[1]))) + 1
  const circle = new RegExp(`#${top}=CIRCLE\\('',(#\\d+),5\\.0\\);`)
  const offset = (id: string | number, basis: number, d: string, ref: string | number) => `#${id}=OFFSET_CURVE_3D('',#${basis},${d},.F.,#${ref});`
  const w = Math.sqrt(0.5)
  const corners = [[7, 0], [7, 7], [0, 7], [-7, 7], [-7, 0], [-7, -7], [0, -7], [7, -7], [7, 0]]
  const poles = corners.map(([x, y], i) => `#${n + i}=CARTESIAN_POINT('',(${x}.,${y}.,5.));`)
  const refs = corners.map((_, i) => `#${n + i}`).join(',')
  const spline =
    `#${n + 9}=(BOUNDED_CURVE() B_SPLINE_CURVE(2,(${refs}),.UNSPECIFIED.,.F.,.F.) B_SPLINE_CURVE_WITH_KNOTS((3,2,2,2,3),` +
    `(0.,1.,2.,3.,4.),.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_CURVE((1.,${w},1.,${w},1.,` +
    `${w},1.,${w},1.)) REPRESENTATION_ITEM(''));`
  return {
    // the axis (+Z) x the tangent of a counterclockwise circle points into it: radius 7 - 2
    'circle r 7 by 2 about +Z': text.replace(circle, `#${n}=CIRCLE('',$1,7.0);\n${offset(top, n, '2.0', z)}`),
    'circle r 3 by -2 about +Z': text.replace(circle, `#${n}=CIRCLE('',$1,3.0);\n${offset(top, n, '-2.0', z)}`),
    'circle r 3 by 2 about -Z': withLines(text.replace(circle, `#${n}=CIRCLE('',$1,3.0);\n${offset(top, n, '2.0', n + 1)}`), [
      `#${n + 1}=DIRECTION('',(0.,0.,-1.));`,
    ]),
    'B-spline circle r 7 by 2 about +Z': withLines(text.replace(circle, offset(top, n + 9, '2.0', z)), [...poles, spline]),
    // the seam (x = 5, up along +Z) as the line x = 3 moved by 2 along +Y x +Z = +X
    'line x = 3 by 2 about +Y': withLines(text.replace(new RegExp(`#${seam}=LINE\\('',#\\d+,#\\d+\\);`), offset(seam, n + 2, '2.0', n + 1)), [
      `#${n}=CARTESIAN_POINT('',(3.,0.,-5.));`,
      `#${n + 1}=DIRECTION('',(0.,1.,0.));`,
      `#${n + 2}=LINE('',#${n},#${vector});`,
    ]),
  }
}

for (const [name, text] of Object.entries(offsetFiles())) {
  test(`STEP offset curves run along the reference direction x the tangent: ${name}`, () => {
    // The close-out read them along the tangent x the reference direction: the circle of radius 7 by 2 as one
    // of radius 9, an invalid body of 961.328 with a warning only about its mass properties
    const [part, said] = warnings(() => fromStep(text) as Part)
    assert.deepEqual(said, [])
    assert.ok(part.isValid())
    approx(part.volume, Math.PI * 250, 1e-8)
    const box = part.bbox()
    for (const [got, want] of [[box.min.x, -5], [box.max.x, 5], [box.min.y, -5], [box.max.y, 5]]) approx(got, want, 0, 1e-6)
  })
}

test('STEP offset curves in a model', () => {
  approx((fromStepModel(offsetFiles()['circle r 7 by 2 about +Z']).bodies[0] as Part).volume, Math.PI * 250, 1e-9)
})

// ---------------------------------------------------------------------------------- sweeps round kinked loops
function loop(ry: number, wobble = 0): Edge {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i * 2 * Math.PI) / 8
    return [20 * Math.cos(a), ry * Math.sin(a), 6 * Math.sin(2 * a) + wobble * Math.cos(a)] as [number, number, number]
  })
  return Spline(...pts, pts[0])
}

// two of 60 random kinked loops: 44, whose STEP and .brep files of a rectangle OpenCASCADE took for invalid (a
// face of 173.57 whose loop touches itself), and 59, whose .brep file of a circle it took for invalid (an edge its
// loop runs along and straight back, which the writer leaves out now)
const KINKED: [number, number, number][] = [
  [20.824, 0.066, -5.489], [14.048, 8.859, 3.492], [2.005, 11.945, 4.512], [-14.058, 8.854, 2.83],
  [-20.592, 1.786, 4.928], [-16.204, -7.538, 5.641], [2.512, -11.913, -5.902], [16.712, -7.16, -10.939],
]
const KINKED_59: [number, number, number][] = [
  [15.834, -1.146, -5.281], [11.903, 9.63, -0.405], [-1.951, 14.435, -0.369], [-12.418, 9.069, 0.423],
  [-15.811, 1.394, 4.12], [-11.684, -9.853, 6.922], [-1.214, -14.502, 1.021], [11.64, -9.896, -6.705],
]

for (const [ry, wobble, volume] of [[14, 0, 477.122125], [20, 0, 543.395624], [14, 3, 479.357865]]) {
  test(`a rectangle round a loop closed with a kink passes the strict check (${ry}, ${wobble})`, () => {
    // (14, 0): the fused halves had a vertex 1.1e-5 from the end of its edge, whose tolerance was 5e-6
    const body = sweep(Rectangle(4, 1), loop(ry, wobble)) as Part
    approx(body.volume, volume, 1e-6)
    assert.deepEqual(body.check(), [])
    assert.ok(body.isValid({ strict: true }))
  })
}

/** The vertices each EDGE_LOOP of a STEP text starts its edges at. */
function stepLoops(text: string): string[][] {
  const ent = new Map([...text.replace(/\n/g, '').matchAll(/#(\d+)=([^;]*);/g)].map((m) => [m[1], m[2]]))
  const out: string[][] = []
  for (const body of ent.values()) {
    const m = body.match(/^EDGE_LOOP\('[^']*',\(([^)]*)\)\)$/)
    if (!m) continue
    out.push(
      m[1].split(',').map((ref) => {
        const [, e, sense] = ent.get(ref.trim().slice(1))!.match(/ORIENTED_EDGE\('[^']*',\*,\*,#(\d+),\.(T|F)\.\)/)!
        const [, v0, v1] = ent.get(e)!.match(/EDGE_CURVE\('[^']*',#(\d+),#(\d+),/)!
        return sense === 'T' ? v0 : v1
      }),
    )
  }
  return out
}

test('a loop that passes a vertex twice is written as the loops between, and read as one again', () => {
  // OpenCASCADE walked such a wire the wrong way at that vertex and took the face for invalid
  // (BRepCheck_NotClosed), in the STEP file and in the .brep file
  const body = sweep(Rectangle(3, 1.2), Spline(...KINKED, KINKED[0])) as Part
  approx(body.volume, 412.245515, 1e-6)
  assert.ok(body.isValid({ strict: true }))
  const text = toStep(body)
  const loops = stepLoops(text)
  assert.ok(loops.every((s) => new Set(s).size === s.length))
  assert.ok(loops.length > body.faces().length) // (a face bounded by the loops between)
  const again = fromStep(text) as Part
  approx(again.volume, body.volume, 1e-7)
  assert.equal(again.faces().length, body.faces().length)
  assert.ok(again.isValid({ strict: true })) // (the kernel has no loops that share a vertex)
  const [back, said] = warnings(() => fromBrep(toBrep(body)) as Part)
  assert.deepEqual(said, [])
  approx(back.volume, body.volume, 1e-6)
  assert.equal(back.faces().length, body.faces().length)
  assert.ok(back.isValid({ strict: true }))
})

test('a circle round a kinked loop reads back from its .brep file', () => {
  const body = sweep(Circle(1.5), Spline(...KINKED_59, KINKED_59[0])) as Part
  const [back] = warnings(() => fromBrep(toBrep(body)) as Part)
  assert.ok(back.isValid())
  approx(back.volume, body.volume, 1e-6)
  assert.equal(back.faces().length, body.faces().length)
})

// ---------------------------------------------------------------------------------- documented numbers
/** The comment after the first line of `path` that holds `code`. */
function comment(path: string, code: string): string {
  const line = readFileSync(path, 'utf8').split('\n').find((x) => x.includes(code))!
  return line.slice(line.indexOf('#') + 1).trim()
}

test('the kernel trace example prints what docs/kernel.md says', () => {
  const said = [...comment(join(ROOT, 'docs', 'kernel.md'), 'print(e.trace[-3:])').matchAll(/'([^']*)'/g)].map((m) => m[1])
  assert.equal(said.length, 3)
  assert.throws(
    () => Box(20, 20, 20).cut(Cylinder(3, 40).rotate(Z, 45)).cut(Cylinder(2, 40).rotate(Z, 45).rotate(X, 90).translate(1, 0, 0)),
    (e: unknown) => e instanceof KernelError && e.status === 'SM_ERR' && JSON.stringify(e.trace.slice(-3)) === JSON.stringify(said),
  )
})

test('the loft reference prints its sections', () => {
  const said = comment(join(ROOT, 'src', 'smlibpy', 'skill', 'references', 'features', 'loft.md'), 'duct.section(')
  const [turned, unturned] = [...said.matchAll(/\d+\.\d/g)].map((m) => Number(m[0]))
  const duct = loft([Rectangle(30, 30), Circle(12).rotate(Z, 45).translate(0, 0, 25)]) as Part
  const plain = loft([Rectangle(30, 30), Circle(12).translate(0, 0, 25)]) as Part
  // (it said 660.2 and 565.9: the section is 660.69997)
  assert.equal(Math.round(duct.section(Plane.XY.offset(12.5)).area * 10) / 10, turned)
  assert.equal(turned, 660.7)
  assert.equal(Math.round(plain.section(Plane.XY.offset(12.5)).area * 10) / 10, unturned)
})

test('the trim reference measures what it prints', () => {
  const text = readFileSync(join(ROOT, 'src', 'smlibpy', 'skill', 'references', 'surfaces', 'trim.md'), 'utf8')
  const m = text.match(/kept ([\d.]+), the holed sheet ([\d.]+) \(they add\s+up to the sheet, ([\d.]+)\)/)!
  const [kept, holed, whole] = [m[1], m[2], m[3]].map(Number)
  const f = (x: number, y: number) => 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
  const grid: [number, number, number][][] = []
  for (let x = 0; x <= 40; x += 5) {
    const row: [number, number, number][] = []
    for (let y = 0; y <= 30; y += 5) row.push([x, y, f(x, y)])
    grid.push(row)
  }
  const saddle = surface(grid)
  const outline = saddle.project(CenterArc([20, 15, 50], 5, 0, 360), [0, 0, -1])
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  assert.equal(r3(saddle.trim(outline, [20, 15, 0]).area), kept)
  assert.equal(r3(saddle.trim(outline, [2, 2, 0]).area), holed) // (it said 1169.877)
  assert.equal(r3(saddle.area), whole)
  assert.equal(r3(kept + holed), whole)
})
