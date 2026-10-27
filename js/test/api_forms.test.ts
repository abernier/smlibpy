// tests/test_api_forms.py: every operation of a body is a method and a function of the same name,
// the function taking the body first, and smlibwasm has every name of smlibpy (_python_api.json,
// made by tools/gen_js_options.py from smlibpy's exports and the classes the MCP lists).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as smlibwasm from '../src/index.ts'
import {
  Axis,
  Box,
  Circle,
  Cylinder,
  Edge,
  Lattice,
  Line,
  Part,
  Plane,
  Rectangle,
  Shell,
  Sphere,
  Vector,
  Wire,
  X,
  Z,
  draft,
  filletPreview,
  surface,
  xor,
} from '../src/index.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: any shape
type Any = any

const API: { names: string[]; members: Record<string, string[]> } = JSON.parse(
  readFileSync(new URL('./_python_api.json', import.meta.url), 'utf8'),
)

test('smlibwasm has every name of smlibpy', () => {
  assert.deepEqual(API.names.filter((n) => !(n in smlibwasm)), [])
})

test('the classes have every method and property of smlibpy', () => {
  // (classes that keep a member as a field of each instance rather than on their prototype)
  const samples: Record<string, object> = { Vector: new Vector(1, 2, 3), Axis: Axis.Z, Plane: Plane.XY }
  const missing: string[] = []
  for (const [cls, names] of Object.entries(API.members)) {
    const C = (smlibwasm as Any)[cls]
    for (const n of names) {
      if (C && (n in C.prototype || n in C || (samples[cls] && n in samples[cls]))) continue
      missing.push(`${cls}.${n}`)
    }
  }
  assert.deepEqual(missing, [])
})

// -- the function gives what the method gives ---------------------------------------------------------
const box = () => Box(40, 30, 20)

function sheet(): Shell {
  const rows = []
  for (let x = 0; x <= 40; x += 10) {
    const row = []
    for (let y = 0; y <= 40; y += 10) row.push([x, y, 0.02 * (x - 20) ** 2])
    rows.push(row)
  }
  return surface(rows as Any) as Shell
}

function dome(): Shell {
  const rows = []
  for (let x = 0; x <= 40; x += 5) {
    const row = []
    for (let y = 0; y <= 40; y += 5) row.push([x, y, 8 - 0.01 * ((x - 20) ** 2 + (y - 20) ** 2)])
    rows.push(row)
  }
  return surface(rows as Any) as Shell
}

/** A body's volume or area, a curve's length; a list of them for a list. */
function measure(shape: unknown): number | number[] {
  if (Array.isArray(shape)) return shape.flatMap((s) => measure(s))
  if (shape instanceof Part) return shape.volume
  if (shape instanceof Shell) return shape.area
  return (shape as Edge | Wire).length
}

// name -> the body, the method's arguments
const EXAMPLES: Record<string, () => [Any, Any[]]> = {
  fuse: () => [box(), [Cylinder(5, 40)]],
  cut: () => [box(), [Cylinder(5, 40)]],
  intersect: () => [box(), [Cylinder(5, 40)]],
  xor: () => [Rectangle(20, 10), [Circle(6)]],
  imprint: () => [box(), [Cylinder(5, 40)]],
  draft: () => {
    const b = box()
    return [b, [b.faces().filter((f) => Math.abs(f.normalAt().z) < 1e-9), 3, Plane.XY]]
  },
  moveFaces: () => {
    const b = box()
    return [b, [b.faces().sortBy(X).at(-1), [5, 0, 0]]]
  },
  offsetFaces: () => {
    const b = box()
    return [b, [b.faces().sortBy(X).at(-1), 2]]
  },
  removeFaces: () => {
    const b = box().cut(Cylinder(5, 40))
    return [b, [b.faces().cylinders()]]
  },
  removeFillets: () => [box().fillet(box().edges().parallelTo(Z), 3), []],
  push: () => {
    const b = Box(60, 40, 6)
    return [b, [b.faces().sortBy(Z).at(-1), [15, 0, 3], { by: -1.5, radius: 10 }]]
  },
  warp: () => {
    const s = sheet()
    const rim = s.project(Rectangle(16, 10).translate(20, 20).on(Plane.XY.offset(30)).faces()[0].outerWire(), [0, 0, -1])
    return [s, [s.faces()[0], new Wire(rim), -1.5]]
  },
  flatten: () => {
    const d = dome()
    const face = d.faces()[0]
    const seat = [
      [15, 15],
      [25, 15],
      [25, 25],
      [15, 25],
    ].map(([x, y]) => face.raycast([x, y, 50], [0, 0, -1])[0].point)
    return [d, [face, seat, Plane.XY.offset(7.5)]]
  },
  extend: () => [sheet(), [6]],
  trim: () => [Line([0, 0], [10, 0]), [0.2, 0.7]],
  project: () => [box(), [Circle(5).edges()[0].translate(0, 0, 30)]],
  outline: () => [box(), []],
  silhouette: () => [Sphere(5), []],
  intersectionCurves: () => [box(), [Plane.XY]],
  partingLine: () => [Sphere(5), [Z]],
  slices: () => [box(), [5]],
  scale: () => [box(), [2]],
  deform: () => {
    const b = box()
    return [b, [new Lattice(b.bbox())]]
  },
}

for (const [name, example] of Object.entries(EXAMPLES)) {
  test(`${name}: the function gives what the method gives`, () => {
    const [shape, args] = example()
    const byFunction = (smlibwasm as Any)[name](shape, ...args)
    const byMethod = shape[name](...args)
    assert.equal(byFunction.constructor, byMethod.constructor)
    const [a, b] = [measure(byFunction), measure(byMethod)].map((m) => [m].flat())
    assert.equal(a.length, b.length)
    a.forEach((v, i) => approx(v, b[i], 1e-9))
  })
}

test('filletPreview takes the edges, as fillet does', () => {
  const b = box()
  const edges = b.edges().parallelTo(Z)
  const areas = (sheets: Shell[]) => sheets.map((s) => s.area)
  areas(filletPreview(edges, 3)).forEach((v, i) => approx(v, areas(b.filletPreview(edges, 3))[i]))
})

test('a function says what it takes', () => {
  assert.throws(() => draft(Rectangle(5, 5) as Any, [], 3, Plane.XY), /draft takes a part, not a Sketch/)
  assert.throws(() => smlibwasm.deform(box(), 3 as Any), /deform takes a Lattice/)
  assert.throws(() => xor(box() as Any, box() as Any), /xor takes a sketch/)
  assert.throws(() => smlibwasm.split(smlibwasm.Line([0, 0], [10, 0]) as Any, 0.3 as Any), /split takes a part, not a Edge \(an edge or a wire splits with edge.split/)
  assert.throws(() => smlibwasm.mirror('abc' as Any), /mirror takes a shape, not a string/)
  assert.throws(() => smlibwasm.section('abc' as Any), /section takes a part or a mesh, not a string/)
  assert.throws(() => smlibwasm.outline(box(), [0, 0, 1] as Any), /cannot use Array as a plane/)
})
