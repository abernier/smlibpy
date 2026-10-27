// The API's forms, as AGENTS.md sets them for smlibpy and smlibwasm: every operation of a body is a
// method and a function, the function taking the body first and giving what the method gives; and
// smlibwasm's API is here entire: each of its exports and each member of its classes is the
// package's, by the same name or a name listed here, or left out for a reason listed here (the
// README's "Left out"). A new export or member of smlibwasm fails here until it is wrapped or listed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import * as three from '../src/index.ts'
import {
  Ball,
  Box,
  BrepFace,
  Circle,
  Cylinder,
  Lattice,
  Part,
  Rectangle,
  Segment,
  Shell,
  Sketch,
  TriangleMesh,
  Wire,
  Y,
} from '../src/index.ts'
import { close, closeBox } from './_util.ts'

/** smlibwasm's names that are the package's under another name (they clashed with three's). */
const RENAMED: Record<string, string> = {
  Line: 'Segment',
  Sphere: 'Ball',
  Triangle: 'TriangleSketch',
  Font: 'OpenTypeFont',
  Face: 'BrepFace',
  Edge: 'BrepEdge',
  Vertex: 'BrepVertex',
  Mesh: 'TriangleMesh',
}

/** Members under another name (three's objects have the name: `raycast` is intersectRay and `add`
 * is `new Wire([a, b])` too, under names three's objects have, so not checked here). */
const MEMBER_RENAMED: Record<string, string> = { mesh: 'toMesh', raycastMany: 'intersectRays', length: 'triangleCount' }

/** smlibwasm's exports the package leaves out, and why. */
const LEFT_OUT: [RegExp, string][] = [
  [/^(Align|Axis|BoundBox|Location|Plane|Pos|Rot|Vector)$/, "three's types stand in for smlibwasm's values"],
  [/^(Hit|Nurbs|NurbsSurface|ClosestPoints|Continuity|Curvature|Problem|RepairReport)$/, "the package's records, in three's types"],
  [/^Shape$/, "the shapes' base class is three's Object3D"],
  [/^Step(Curve|Frame|Model|Point)$/, 'STEPLoader gives objects, and STEPExporter takes them'],
  [/^(export|import|from|to)[A-Z]|^(load|save|readStep)$/, "files are three's loaders and exporters"],
  [/^(htmlPage|show)$/, 'three is the viewer'],
  [/^faceMeshes$/, "a body's geometry is its tessellation"],
  [/^outline$/, "the function's name is three's (a node of its TSL, in its addons): `body.outline()`, the method"],
]

/** Members of smlibwasm's classes the package leaves out, and why. */
const MEMBERS_LEFT_OUT: [RegExp, string][] = [
  [/^(moved|translate|rotate|scale)$/, "placement is three's transforms (and `scale(shape, factor)` the function)"],
  [/^(colored|named)$/, "a body's color and name are its material and its object's name (faces: colorFaces, nameFaces)"],
  [/^(export|show|toString)$/, "files are three's exporters, three is the viewer"],
]

/** Members of the sub-shapes of a body left out, and why. */
const SUB_LEFT_OUT: [RegExp, string][] = [
  [/^(on|mirror)$/, 'a face, edge or vertex of a body is where its body is: place or mirror the body (or `face.toShell()`)'],
  [/^(faces|edges|wires|vertices)$/, "the topology of a sub-shape's own kind (a face's faces, an edge's edges): the object itself"],
  [/^mesh$/, "a curve or a point has no triangles: its geometry is its polyline (a face's are toMesh())"],
]

const reasonOf = (name: string, rules: [RegExp, string][]) => rules.find(([r]) => r.test(name))?.[1]

function members(cls: unknown): Set<string> {
  const out = new Set<string>()
  for (let p = (cls as { prototype: object }).prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of Object.getOwnPropertyNames(p)) if (!k.startsWith('_') && k !== 'constructor') out.add(k)
  }
  return out
}

test("every export of smlibwasm is the package's, renamed, or left out for a reason", () => {
  const ours = three as Record<string, unknown>
  const missing = Object.keys(sm).filter((name) => !(name in ours) && !(RENAMED[name] in ours) && reasonOf(name, LEFT_OUT) === undefined)
  assert.deepEqual(missing, [], `smlibwasm's ${missing.join(', ')}: wrap them, or say here why not`)
  // (and the renames name what is there)
  for (const [theirs, name] of Object.entries(RENAMED)) {
    assert.ok(theirs in sm, `${theirs} is not smlibwasm's`)
    assert.ok(name in ours, `${name} is not the package's`)
  }
})

test("every member of smlibwasm's classes is the package's, renamed, or left out for a reason", () => {
  const pairs: [string, unknown, boolean][] = [
    ['Part', three.Part, false],
    ['Shell', three.Shell, false],
    ['Sketch', three.Sketch, false],
    ['Face', three.BrepFace, true],
    ['Edge', three.BrepEdge, true],
    ['Wire', three.Wire, true],
    ['Vertex', three.BrepVertex, true],
    ['ShapeList', three.ShapeList, true],
    ['Mesh', three.TriangleMesh, false],
    ['Profile', three.Profile, false],
    ['Lattice', three.Lattice, false],
    ['Font', three.OpenTypeFont, false],
  ]
  for (const [name, cls, sub] of pairs) {
    const ours = members(cls)
    // (a face's name is its object's name, three's field, which the package sets to it)
    ours.add('name')
    const missing = [...members((sm as Record<string, unknown>)[name])].filter(
      (m) => !ours.has(m) && !ours.has(MEMBER_RENAMED[m] ?? '') && reasonOf(m, MEMBERS_LEFT_OUT) === undefined && !(sub && reasonOf(m, SUB_LEFT_OUT) !== undefined),
    )
    assert.deepEqual(missing, [], `${name}'s ${missing.join(', ')}: wrap them, or say here why not`)
  }
})

test("every operation of a body is a method and a function, as smlibwasm's are", () => {
  // (smlibwasm's functions that are methods of its bodies, faces or curves: the package has both)
  const bodies = ['Part', 'Shell', 'Sketch', 'Face', 'Edge', 'Wire'].map((c) => members((sm as Record<string, unknown>)[c]))
  const ours = three as Record<string, unknown>
  const classes = [three.Part, three.Shell, three.Sketch, three.BrepFace, three.BrepEdge, three.Wire].map(members)
  const checked: string[] = []
  for (const [name, value] of Object.entries(sm)) {
    if (typeof value !== 'function' || /^[A-Z]/.test(name) || !bodies.some((m) => m.has(name)) || reasonOf(name, LEFT_OUT) !== undefined) continue
    // (outline's function name is three's: a node of its TSL, in its addons)
    assert.equal(typeof ours[name], name === 'outline' ? 'undefined' : 'function', `the function ${name}`)
    // (scale's method name is three's: the object's transform)
    if (name !== 'scale') assert.ok(classes.some((m) => m.has(name)), `the method ${name}`)
    checked.push(name)
  }
  assert.ok(checked.length >= 40, `${checked.length} operations: ${checked.join(', ')}`)
})

/** The measures two results are compared by. */
function measures(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(measures)
  if (x instanceof Part) return ['Part', x.volume, x.faces().length]
  if (x instanceof Shell) return [x.constructor.name === 'Sketch' || x instanceof Sketch ? 'Sketch' : 'Shell', x.area, x.faces().length]
  if (x instanceof TriangleMesh) return ['TriangleMesh', x.volume, x.triangleCount]
  if ((x as { isBrepEdge?: boolean }).isBrepEdge || (x as { isWire?: boolean }).isWire) return ['curve', (x as { length: number }).length]
  if (x instanceof THREE.Vector3) return x.toArray()
  throw new TypeError(`no measures for ${String(x)}`)
}

function same(a: unknown, b: unknown, what: string): void {
  const [ma, mb] = [measures(a), measures(b)]
  const flat = (v: unknown): unknown[] => (Array.isArray(v) ? v.flatMap(flat) : [v])
  const [fa, fb] = [flat(ma), flat(mb)]
  assert.equal(fa.length, fb.length, what)
  fa.forEach((v, i) => (typeof v === 'number' ? close(v, fb[i] as number, 1e-9 * Math.max(1, Math.abs(v)), `${what}: ${i}`) : assert.equal(v, fb[i], what)))
  if ((a as { isObject3D?: boolean }).isObject3D && (b as { isObject3D?: boolean }).isObject3D) {
    assert.ok((a as THREE.Object3D).matrix.equals((b as THREE.Object3D).matrix), `${what}: the result's transform`)
  }
}

test('each function gives what its method gives, in the body frame, with its transform', () => {
  const plate = (): Part => {
    const p = new Box(40, 10, 30)
    p.position.set(5, -2, 3)
    p.rotation.y = 0.4
    return p
  }
  const part = plate()
  const pin = new Cylinder(3, 3, 20)
  pin.position.x = 8
  const sheet = new Rectangle(20, 20).extrude(1).faces().front().one().toShell()
  const sketch = new Rectangle(20, 10)
  const other = new Circle(6)
  other.position.x = 8
  const line = new Segment(new THREE.Vector3(), new THREE.Vector3(10, 0, 0))
  const wire = new Wire([line, new Segment(new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 10, 0))])
  const top = part.faces().top().one()
  const disk = new Circle(3)
  disk.position.z = 40 // (in front of the plate: its outline goes back onto the front face)
  const rounded = part.fillet(part.edges().parallelTo(Y), 4)
  const drilled = part.cut(new Cylinder(3, 3, 20))
  const cut = new Segment(new THREE.Vector3(0, -20, 1), new THREE.Vector3(0, 20, 1))
  const halves = sheet.trim(cut, 'split')
  const lattice = new Lattice(new Box(10, 10, 10), 3)
  lattice.move([1, -1, 1], new THREE.Vector3(0, 3, 0))
  const block = new Box(10, 10, 10)
  const f = three as unknown as Record<string, (...args: unknown[]) => unknown>
  const cases: [string, () => unknown, () => unknown][] = [
    ['fuse', () => f.fuse(part, pin), () => part.fuse(pin)],
    ['cut', () => f.cut(part, pin), () => part.cut(pin)],
    ['intersect', () => f.intersect(part, pin), () => part.intersect(pin)],
    ['fuse of sketches', () => f.fuse(sketch, other), () => sketch.fuse(other)],
    ['cut of sketches', () => f.cut(sketch, other), () => sketch.cut(other)],
    ['xor', () => f.xor(sketch, other), () => sketch.xor(other)],
    ['cut of a sheet', () => f.cut(sheet, pin), () => sheet.cut(pin)],
    ['imprint', () => f.imprint(part, disk, new THREE.Vector3(0, 0, -1)), () => part.imprint(disk, new THREE.Vector3(0, 0, -1))],
    ['filletPreview', () => f.filletPreview(part.edges().parallelTo(Y), 2), () => part.filletPreview(part.edges().parallelTo(Y), 2)],
    ['fillet', () => f.fillet(part.edges().parallelTo(Y), 4), () => part.fillet(part.edges().parallelTo(Y), 4)],
    ['chamfer', () => f.chamfer(part.edges().parallelTo(Y), 2), () => part.chamfer(part.edges().parallelTo(Y), 2)],
    ['draft', () => f.draft(part, part.faces().perpendicularTo(Y), 0.08, part.faces().bottom().one()), () => part.draft(part.faces().perpendicularTo(Y), 0.08, part.faces().bottom().one())],
    ['moveFaces', () => f.moveFaces(part, part.faces().top(), new THREE.Vector3(0, 5, 0)), () => part.moveFaces(part.faces().top(), new THREE.Vector3(0, 5, 0))],
    ['offsetFaces', () => f.offsetFaces(part, part.faces().top(), 2), () => part.offsetFaces(part.faces().top(), 2)],
    ['removeFaces', () => f.removeFaces(drilled, drilled.faces().cylinders()), () => drilled.removeFaces(drilled.faces().cylinders())],
    ['removeFillets', () => f.removeFillets(rounded), () => rounded.removeFillets()],
    ['push', () => f.push(part, top, top.center(), { by: 2, radius: 8 }), () => part.push(top, top.center(), { by: 2, radius: 8 })],
    ['shell', () => f.shell(part, 1, part.faces().top()), () => part.shell(1, part.faces().top())],
    ['offset', () => f.offset(part, 1), () => part.offset(1)],
    ['mirror', () => f.mirror(part, new THREE.Plane(new THREE.Vector3(1, 0, 0), -30)), () => part.mirror(new THREE.Plane(new THREE.Vector3(1, 0, 0), -30))],
    ['split', () => f.split(part, new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)), () => part.split(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0))],
    ['merge', () => f.merge(part, pin), () => part.merge(pin)],
    ['section', () => f.section(part, new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)), () => part.section(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))],
    ['slices', () => f.slices(new Ball(10), 5), () => new Ball(10).slices(5)],
    ['extend of a sheet', () => f.extend(sheet, 5), () => sheet.extend(5)],
    ['extend of a curve', () => f.extend(line, 5), () => line.extend(5)],
    ['trim of a sheet', () => f.trim(sheet, [cut], new THREE.Vector3(5, 0, 1)), () => sheet.trim([cut], new THREE.Vector3(5, 0, 1))],
    ['trim of a curve', () => f.trim(line, 0.2, 0.7), () => line.trim(0.2, 0.7)],
    ['mergeFaces', () => f.mergeFaces(halves, halves.faces()[0], halves.faces()[1]), () => halves.mergeFaces(halves.faces()[0], halves.faces()[1])],
    ['thicken', () => f.thicken(sheet, 2), () => sheet.thicken(2)],
    ['offset of a curve', () => f.offset(wire, 1), () => wire.offset(1)],
    ['deform', () => f.deform(block, lattice), () => block.deform(lattice)],
    ['twist', () => f.twist(block, 0.5), () => block.twist(0.5)],
  ]
  for (const [what, fn, method] of cases) same(fn(), method(), what)
  // curves from a body: the same curves, in number and length
  const lengths = (list: unknown) => [...(list as Iterable<{ length: number }>)].map((e) => e.length).sort((a, b) => a - b)
  assert.deepEqual(lengths(f.silhouette(part)), lengths(part.silhouette()))
  assert.deepEqual(lengths(f.intersectionCurves(part, new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))), lengths(part.intersectionCurves(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))))
  assert.deepEqual(lengths(f.partingLine(part, Y)), lengths(part.partingLine(Y)))
  const onTop = new Segment(new THREE.Vector3(-5, 20, 0), new THREE.Vector3(5, 20, 0))
  assert.deepEqual(lengths(f.project(part, onTop, new THREE.Vector3(0, -1, 0))), lengths(part.project(onTop, new THREE.Vector3(0, -1, 0))))
  assert.deepEqual(lengths(f.project(top, onTop)), lengths(top.project(onTop)))
  // a shape the function does not take: a TypeError that says what it takes
  assert.throws(() => f.draft(sheet, [], 0.1, top), { name: 'TypeError', message: /draft takes a Part first, not a Shell/ })
  assert.throws(() => f.fuse(line, line), { name: 'TypeError', message: /fuse takes a Part, Shell or Sketch first/ })
  assert.throws(() => f.deform(block, null), { name: 'TypeError', message: /deform: give the shape, then a Lattice/ })
})

test('scale is a function: the shape scaled in its frame, with its transform, where three scales the object', () => {
  const box = new Box(10, 20, 30)
  box.position.set(1, 2, 3)
  const twice = three.scale(box, 2)
  assert.ok(twice instanceof Part)
  close(twice.volume, 8 * 6000, 1e-6)
  assert.ok(twice.position.equals(box.position))
  closeBox(twice.bbox(), new THREE.Box3(new THREE.Vector3(-10, -20, -30), new THREE.Vector3(10, 20, 30)), 1e-9)
  // per axis, about a point
  const flat = three.scale(box, new THREE.Vector3(1, 0.5, 1), new THREE.Vector3(0, -10, 0))
  closeBox(flat.bbox(), new THREE.Box3(new THREE.Vector3(-5, -10, -15), new THREE.Vector3(5, 0, 15)), 1e-9)
  // curves and triangle meshes
  close(three.scale(new Segment(new THREE.Vector3(), new THREE.Vector3(3, 4, 0)), 2).length, 10, 1e-12)
  close(three.scale(new TriangleMesh(box), 2).volume, 8 * 6000, 1e-6)
  assert.throws(() => three.scale(new THREE.Mesh() as never, 2), { name: 'TypeError', message: /scale takes a Part, Shell, Sketch, BrepEdge, Wire or TriangleMesh first/ })
  void BrepFace
})
