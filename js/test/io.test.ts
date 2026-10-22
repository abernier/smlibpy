// tests/test_io.py
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Box, Cone, Cylinder, GridLocations, Part, Sphere, Spline, Torus, Z, loft, Circle, Rectangle, render } from '../src/index.ts'
import { exportGlb, exportGltf, exportStep, exportStl, fromSmb, fromStl, importStl, load, save, toGlb, toGltf, toObj, toSmb, toStl } from '../src/exporters.ts'
import { approx } from './_approx.ts'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { Shell, ShapeList, merge as _merge, surface as _surface } from '../src/index.ts'
import { exportFile } from '../src/exporters.ts'
import { exportUsd, fromUsd, importUsd, toUsd } from '../src/usd.ts'
import { setWarningHandler } from '../src/kernel.ts'
import { _pyRepr as f } from '../src/step.ts'
import { Align } from '../src/index.ts'

function tmpPath(): string {
  return mkdtempSync(join(tmpdir(), 'smlibwasm-io-'))
}

function plate(): Part {
  let p = Box(80, 60, 10)
  p = p.fillet(p.edges().parallelTo(Z), 8)
  p = p.cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, 20)))
  return p.named('plate').colored('steelblue')
}

test('native roundtrip', () => {
  const p = plate()
  const path = join(tmpPath(), 'plate.smb')
  save(p, path)
  const back = load(path)
  approx(back.volume, p.volume, 1e-12)
})

test('native files keep merged parts', () => {
  // A merged part is no valid solid by design (Part.merge); load took that for a sheet and gave a
  // Shell without cells or volume. It decides by what the body encloses, as importUsd does.
  const merged = Box(10, 10, 10).merge(Box(10, 10, 10).translate([10, 0, 0]))
  const back = fromSmb(toSmb(merged)) as Part
  assert.ok(back instanceof Part)
  assert.equal(back.cells().length, 2)
  approx(back.volume, 2000, 1e-9)
  const sheet = fromSmb(toSmb(Box(10, 10, 10).faces().top()[0].toShell()))
  assert.ok(sheet instanceof Shell && !(sheet instanceof Part))
})

test('stl roundtrip', () => {
  const p = plate()
  const path = join(tmpPath(), 'plate.stl')
  exportStl(p, path)
  const mesh = importStl(path)
  approx(mesh.volume, p.volume, 1e-3)
})

test('glb header', () => {
  const path = join(tmpPath(), 'plate.glb')
  exportGlb(plate(), path)
  const data = readFileSync(path)
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  assert.equal(new TextDecoder().decode(data.subarray(0, 4)), 'glTF')
  assert.equal(dv.getUint32(4, true), 2)
  assert.equal(dv.getUint32(8, true), data.length)
})

for (const fmt of ['glb', 'gltf']) {
  test(`gltf is in meters [${fmt}]`, () => {
    const path = join(tmpPath(), `box.${fmt}`)
    ;(fmt === 'glb' ? exportGlb : exportGltf)(Box(60, 40, 8), path, { edgeColor: 'red' })
    let doc
    if (fmt === 'glb') {
      const data = readFileSync(path)
      const n = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(12, true)
      doc = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + n)))
    } else doc = JSON.parse(readFileSync(path, 'utf8'))
    const root = doc.nodes[doc.scenes[0].nodes[0]]
    assert.deepEqual(root.scale, [0.001, 0.001, 0.001])
    const meshNode = doc.nodes[root.children[0]]
    const pos = doc.accessors[doc.meshes[meshNode.mesh].primitives[0].attributes.POSITION]
    // millimeters below the root: 60 mm = 0.06 m
    ;[30, 20, 4].forEach((v, i) => approx(pos.max[i], v))
  })
}

const cones: [string, () => Part][] = [
  ['Cone(0, 10, 15)', () => Cone(0, 10, 15)],
  ['Cone(0, 10, 15).translate(5, -3, 2)', () => Cone(0, 10, 15).translate(5, -3, 2)],
  ['Cone(10, 0, 15)', () => Cone(10, 0, 15)],
]
for (const [name, make] of cones) {
  test(`step cone with apex keeps its volume [${name}]`, () => {
    const cone = make()
    const path = join(tmpPath(), 'cone.step')
    exportStep(cone, path)
    approx(load(path).volume, cone.volume, 1e-6)
  })
}

test('step structure', () => {
  const path = join(tmpPath(), 'plate.step')
  exportStep(plate(), path)
  const text = readFileSync(path, 'utf8')
  assert.ok(text.startsWith('ISO-10303-21;'))
  assert.ok(text.includes("MANIFOLD_SOLID_BREP('plate'"))
  assert.equal(text.split('CYLINDRICAL_SURFACE').length - 1, 8) // four holes, four rounded corners
  assert.ok(text.includes('COLOUR_RGB'))
})

// An optional cross-check with an independent kernel (OpenCASCADE through Python's OCP), which
// JavaScript does not have.
const occShapes: [string, (() => Part) | null][] = [
  ['plate', null],
  ['sphere', () => Sphere(10)],
  ['torus', () => Torus(20, 5)],
  ['cone', () => Cone(10, 0, 15)],
  ['hollow', () => Box(20, 20, 20).cut(Sphere(5))],
  ['g2', () => Box(30, 20, 10).fillet(Box(30, 20, 10).edges(), 2, { continuity: 'G2' })],
  ['loft', () => loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)]) as Part],
]
for (const [name] of occShapes) {
  test(`step reads back in opencascade [${name}]`, { skip: 'needs OpenCASCADE (OCP), which smlibwasm has no binding for' }, () => {})
}

test('render png', () => {
  const p = plate()
  const path = join(tmpPath(), 'plate.png')
  const data = render(p, { path, size: [320, 240] }).data
  assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  assert.deepEqual([dv.getUint32(16), dv.getUint32(20)], [320, 240])
  assert.deepEqual(readFileSync(path), Buffer.from(data))
  const sheet = render(p, Spline([0, 0, 20], [30, 20, 30]), { view: 'sheet', size: [400, 300] }).data
  const ds = new DataView(sheet.buffer, sheet.byteOffset, sheet.byteLength)
  assert.deepEqual([ds.getUint32(16), ds.getUint32(20)], [400, 300])
})

// smlibwasm's in-memory pairs (no Python counterpart): the same formats without files
test('formats in memory', () => {
  const p = plate()
  approx(fromStl(toStl(p)).volume, p.volume, 1e-3)
  const ascii = toStl(p, { ascii: true })
  assert.ok(new TextDecoder().decode(ascii.subarray(0, 6)) === 'solid ')
  approx(fromStl(new TextDecoder().decode(ascii)).volume, p.volume, 1e-3) // the text of an ASCII file
  assert.ok(toObj(p).includes('\no plate\n'))
  const glb = toGlb(p)
  assert.equal(new TextDecoder().decode(glb.subarray(0, 4)), 'glTF')
  const doc = JSON.parse(toGltf(p))
  assert.ok(doc.buffers[0].uri.startsWith('data:application/octet-stream;base64,'))
  assert.equal(doc.meshes[0].name, 'plate')
  for (const ascii of [true, false]) {
    const back = fromSmb(toSmb(p, { ascii }))
    assert.ok(back instanceof Part)
    approx(back.volume, p.volume, 1e-12)
  }
  assert.throws(() => fromStl(new Uint8Array(10)), /not an STL file, or a truncated one/)
})

test('files need Node: a clear error elsewhere', () => {
  const proc = globalThis.process as unknown as { getBuiltinModule: unknown }
  const saved = proc.getBuiltinModule
  proc.getBuiltinModule = undefined
  try {
    assert.throws(() => exportStl(Box(1, 1, 1), join(tmpPath(), 'x.stl')), /needs Node.js.*toStl/)
    assert.throws(() => load('x.step'), /needs Node.js/)
  } finally {
    proc.getBuiltinModule = saved
  }
})

// -- USD --------------------------------------------------------------------------------------
const USD_SAMPLES = new URL('../../third_party/usd-brep/TestFiles/', import.meta.url).pathname

const USD_PARTS: [string, () => Part][] = [
  ['box', () => Box(10, 20, 30)],
  ['ball', () => Sphere(5)],
  ['ring', () => Torus(10, 3)],
  ['narrowing', () => Cone(5, 2, 10)], // (a negative semi-angle in SMLib)
  ['rounded', () => Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)], // (cylinders as cones of angle 0)
  ['countersunk', () => Box(30, 30, 10).cut(Cone(6, 3, 3).translate([0, 0, 3.5])).cut(Cylinder(3, 10))],
  ['cup', () => Box(30, 30, 30).shell(2, Box(30, 30, 30).faces().top())],
]

for (const [name, make] of USD_PARTS) {
  test(`usd roundtrip is exact: ${name}`, () => {
    const part = make()
    const back = fromUsd(toUsd(part.named(name))) as Part
    assert.ok(back instanceof Part && back.name === name && back.isValid())
    assert.equal(back.faces().length, part.faces().length)
    // (the kernel makes the trim curves of the cone from its circle edges, written as circles: 3e-12)
    approx(back.volume, part.volume, 1e-11 * part.volume)
    assert.deepEqual(back.faces().map((f) => f.geomType), part.faces().map((f) => f.geomType))
    assert.deepEqual(back.edges().map((e) => e.geomType), part.edges().map((e) => e.geomType))
  })
}

test('usd names, colors, sheets, cells and meshes', () => {
  const p = plate()
  const grid = Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => [x * 10, y * 10, (3 * ((x - 2) ** 2 - (y - 2) ** 2)) / 4]))
  const sheet = _surface(grid)
  const cells = Box(10, 10, 10).merge(Sphere(4).translate([0, 0, 5]))
  const dir = tmpPath()
  exportFile([p, sheet.named('sheet'), cells.named('cells')], join(dir, 'all.usda'))
  const back = load(join(dir, 'all.usda')) as ShapeList<any>
  assert.deepEqual(Array.from(back, (b: any) => b.name), ['plate', 'sheet', 'cells'])
  ;[70 / 255, 130 / 255, 180 / 255].forEach((c, i) => approx(back[0].color[i], c, 1e-9)) // steelblue
  assert.ok(back[1] instanceof Shell && !(back[1] instanceof Part))
  approx(back[1].area, sheet.area, 1e-12)
  const want = cells.cells().map((c) => c.volume).sort((x, y) => x - y)
  back[2].cells().map((c: Part) => c.volume).sort((x: number, y: number) => x - y).forEach((v: number, i: number) => approx(v, want[i], 1e-9))
  const text = readFileSync(join(dir, 'all.usda'), 'utf8')
  assert.ok(text.startsWith('#usda 1.0') && text.includes('upAxis = "Z"') && text.includes('metersPerUnit = 0.001'))
  // each body with a mesh of it, which is what USD viewers draw
  assert.equal(text.split('def BrepArray').length - 1, 3)
  assert.equal(text.split('def Mesh').length - 1, 3)
  assert.ok(text.includes('def Mesh "plate_mesh"') && text.includes('normal3f[] normals'))
  exportUsd([p, p.mesh()], join(dir, 'exact.usda'), { mesh: false })
  const exact = readFileSync(join(dir, 'exact.usda'), 'utf8')
  assert.equal(exact.split('def BrepArray').length - 1, 1)
  assert.equal(exact.split('def Mesh').length - 1, 1) // (the mesh given)
  approx((importUsd(join(dir, 'all.usda')) as ShapeList<any>)[0].volume, p.volume, 1e-12) // (meshes are not read)
})

test('usd rejects what it cannot read', () => {
  const p = plate()
  const dir = tmpPath()
  assert.throws(() => exportUsd(p, join(dir, 'plate.usdc')), /usdcat/)
  assert.throws(() => exportUsd(p, join(dir, 'plate.usdz')), /usdzip/) // (usdcat writes no packages)
  assert.throws(() => fromUsd(new Uint8Array([...new TextEncoder().encode('PXR-USDC'), ...new Uint8Array(100)])), /binary/)
  assert.throws(() => fromUsd('#usda 1.0\ndef Xform "World"\n{\n}\n'), /no BrepArray/)
  const broken = toUsd(p).replace('uniform uint[] faceuse:faceIndex = [', 'uniform uint[] faceuse:faceIndex = [99, ')
  assert.throws(() => fromUsd(broken), /malformed/)
})

test('usd reads usd-brep files', { skip: !existsSync(USD_SAMPLES) && "usd-brep's test files are not checked out" }, () => {
  // their files of good bodies, and their validator's files of broken ones: each gives bodies or a
  // RangeError that names what is wrong, none crashes
  const good: Record<string, number> = {
    'Cube.usda': 1, 'CubeBrepArray.usda': 2, 'sphere_nurbs.usda': 1, 'cubeWithVoid.usda': 1, 'mouse.usda': 1,
    'Cone_SmConnect_Brep.usda': 1,
  }
  const files: string[] = []
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const f = join(d, n)
      if (statSync(f).isDirectory()) walk(f)
      else if (n.endsWith('.usda')) files.push(f)
    }
  }
  walk(USD_SAMPLES)
  let seen = 0
  for (const f of files.sort()) {
    const text = readFileSync(f, 'utf8')
    if (!text.includes('def BrepArray') || text.startsWith('version https://git-lfs')) continue
    const name = f.slice(f.lastIndexOf('/') + 1)
    const said: string[] = []
    setWarningHandler((m) => said.push(m))
    try {
      if (name in good) {
        const bodies = fromUsd(text)
        const list = bodies instanceof ShapeList ? Array.from(bodies) : [bodies]
        assert.equal(list.length, good[name], name)
        assert.ok(list.every((b) => (b as Part).isValid()), name)
        // (the mouse's faces leave gaps of 2e-3: noted)
        assert.equal(said.some((m) => m.includes('gap of 0.00199')), name === 'mouse.usda', name)
        seen += 1
      } else {
        try {
          fromUsd(text)
        } catch (e) {
          if (!(e instanceof RangeError)) throw e
        }
      }
    } finally {
      setWarningHandler((m) => console.warn(m))
    }
  }
  assert.equal(seen, Object.keys(good).length)
  // its wall whose faces leave gaps of 377 (the healer crashed on it) is refused, and read with the
  // check off
  const revit = readFileSync(join(USD_SAMPLES, 'usd_TestFiles', 'RevitWallHealerCrash.usda'), 'utf8')
  assert.throws(() => fromUsd(revit), /is broken: the kernel finds a gap of 377 .0.033 of its size/)
  assert.ok(!(fromUsd(revit, { check: false }) as Part).isValid())
})

test("usd refuses the validator's broken bodies", { skip: !existsSync(USD_SAMPLES) && "usd-brep's test files are not checked out" }, () => {
  // usd-brep's validator files whose bodies are geometrically broken imported as Parts that said
  // they were valid: a unit cube of volume 0.5 (a surface weight of 0), one whose box reached 100
  // away, one that did not mesh. The value rules and the kernel's check (SmBrep::AssertValid, before
  // anything measures the body) refuse them, naming the body, the entity and the rule.
  const refused: Record<string, RegExp> = {
    'Test_BA_440_Non_positive_NURBS_surface_weights.usda': /body 0, face 0: its NURBS surface has a weight of 0, not positive .BA.440/,
    'Test_BA_582_Orphan_edge_not_referenced_by_any_edgeuse.usda': /1 of the edges are used by no edgeuse .BA.582/,
    'Test_BA_465_Surface_NURBS_control_point_containment.usda': /body 0 of the BrepArray "\/World\/brepArray" is broken: the kernel finds/,
    'Test_BA_310_Vertex_position_containment.usda': /is broken: the kernel finds a gap of 171 .* at vertex 0/,
    'Test_BA_365_Edge_NURBS_control_point_containment.usda': /is broken: the kernel finds an edge of length/,
    'Test_BA_763_UV_trim_curves_do_not_close_loop.usda': /is broken: the kernel finds a gap of 0.1 /,
    'Test_BA_764_Zero_length_UV_trim_curve.usda': /is broken: the kernel finds a gap of 1 /,
    'empty.usda': /body 0 is empty/,
    'Test_BA_155_Invalid_U_range_order.usda': /body 0, face 0: its range in u is empty or the wrong way round .BA.155/,
    'Test_BA_235_Invalid_edge_range_order.usda': /body 0, edge 0: its range is the wrong way round .BA.235/,
  }
  for (const [name, message] of Object.entries(refused)) assert.throws(() => importUsd(join(USD_SAMPLES, 'brep_validator', name)), message, name)
  // bodies that are only types the validator dislikes read as they are
  const typed = importUsd(join(USD_SAMPLES, 'brep_validator', 'Test_BA_076_Invalid_region_attribute_data_types.usda')) as ShapeList<Part>
  assert.deepEqual(typed.map((b) => Math.round(b.volume * 1e9) / 1e9), [1, 1])
})

/** The text with the first value of an array attribute replaced. */
function mutated(text: string, attribute: string, value: string): string {
  const m = new RegExp(`(\\] |\\[\\] )${attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} = \\[`).exec(text)!
  const start = m.index + m[0].length
  const item = /^(\([^)]*\)|[^,\]]+)/.exec(text.slice(start))!
  return text.slice(0, start) + value + text.slice(start + item[0].length)
}

test('usd values the conversion cannot take throw', () => {
  // One bad number of a BrepArray trapped usd-brep's conversion here (natively it crashed: a sphere
  // whose refDirection is its axis), broke the meshing later (a weight of 0), hung the volume (a torus
  // axis of length 0) or gave a wrong body that said it was valid (a cylinder axis of 0, an edge
  // weight of 0, a control point that is not a number). Now each throws a RangeError naming the body,
  // the face or edge and the validator's rule; a cone axis of length 2 is made unit (it gave 496.58).
  // In a process of its own, so that a trap or a hang fails the test rather than the run.
  const exported: Record<string, string> = {}
  const shapes: [string, () => Part][] = [
    ['ball', () => Sphere(5)], ['ring', () => Torus(10, 2)], ['tube', () => Cylinder(5, 10)], ['cube', () => Box(10, 10, 10)],
    ['cone', () => Cone(5, 2, 10)], ['loft', () => loft([Rectangle(20, 20), Circle(8).translate([0, 0, 20])]) as Part],
  ]
  for (const [name, make] of shapes) exported[name] = toUsd(make().named(name), { mesh: false })
  const cases: [string, string, string, string][] = [
    ['ball', 'brep:surface:sphere:refDirection', '(0, 0, 1)', 'face 0: the axis and the refDirection are parallel (BA.482-484)'],
    ['ball', 'brep:surface:sphere:refDirection', '(0, 0, 0)', 'face 0: the refDirection has no length'],
    ['loft', 'brep:surface:nurb:weights', '0', 'its NURBS surface has a weight of 0, not positive (BA.440)'],
    ['ring', 'brep:surface:torus:axis', '(0, 0, 0)', 'face 0: the axis has no length (BA.523-525)'],
    ['tube', 'brep:surface:cylinder:axis', '(0, 0, 0)', 'the axis has no length (BA.502-504)'],
    ['tube', 'brep:surface:cylinder:radius', '0', "the cylinder's radius is 0, not positive (BA.501)"],
    ['loft', 'brep:edge3dNurb:curve3d:nurb:weights', '0', 'body 0, edge 0: its NURBS curve has a weight of 0, not positive (BA.350)'],
    ['loft', 'brep:edge3dNurb:curve3d:nurb:controlVertices', '(nan, 0, 0)', 'brep:edge3dNurb:curve3d:nurb:controlVertices[0] is not a finite number (BA.660)'],
    ['cube', 'brep:edge3dLine:curve3d:line:direction', '(0, 0, 0)', "body 0, edge 0: the line's direction has no length (BA.541)"],
    ['cube', 'brep:intersectTol3d', '0', 'body 0: brep:intersectTol3d is 0, not positive (BA.010)'],
    ['cube', 'edge:range', 'inf', 'edge:range[0] is not a finite number (BA.660)'],
  ]
  const dir = tmpPath()
  cases.forEach(([name, attribute, value], i) => writeFileSync(join(dir, `case${i}.usda`), mutated(exported[name], attribute, value)))
  writeFileSync(join(dir, 'long.usda'), mutated(exported.cone, 'brep:surface:cone:axis', '(0, 0, -2)'))
  const src = new URL('../src/', import.meta.url).href
  const code = `
    import { importUsd } from '${src}index.ts'
    for (let i = 0; i < ${cases.length}; i++) {
      try {
        importUsd(${JSON.stringify(dir)} + '/case' + i + '.usda').volume
        console.log('read')
      } catch (e) {
        console.log(e.message)
      }
    }
    const cone = importUsd(${JSON.stringify(join(dir, 'long.usda'))})
    console.log(cone.isValid(), cone.volume.toFixed(3))
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 120_000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const lines = run.stdout.split('\n')
  cases.forEach(([name, , , message], i) => {
    assert.ok(lines[i].startsWith(`usd: the BrepArray "/World/${name}" is malformed: `) && lines[i].includes(message), lines[i])
  })
  assert.equal(lines[cases.length], `true ${Cone(5, 2, 10).volume.toFixed(3)}`)
})

function placed(text: string, options = {}): number[] {
  const box = (fromUsd(text, options) as Part).bbox()
  return [...box.min.toArray(), ...box.max.toArray()].map((c) => Math.round(c * 1e6) / 1e6 + 0)
}

/** The text with xformOps on /World. */
function ops(text: string, op: string, order: string): string {
  return text.replace('def Xform "World"\n{\n', `def Xform "World"\n{\n${op}    uniform token[] xformOpOrder = [${order}]\n`)
}

test('usd bodies are placed as the stage has them', () => {
  // fromUsd read the bodies' arrays alone: the transforms of their prims and of the prims above
  // them, the stage's metersPerUnit and upAxis were left out, so assemblies fell onto their origins
  // and sizes were off by 10 or 1000, without a word.
  const text = toUsd(Box(10, 10, 10), { mesh: false })
  const moved = ops(text, '    double3 xformOp:translate = (100, 0, 0)\n', '"xformOp:translate"').replace('metersPerUnit = 0.001', 'metersPerUnit = 0.01')
  assert.deepEqual(placed(moved), [950, -50, -50, 1050, 50, 50]) // was [-5, -5, -5, 5, 5, 5]
  assert.deepEqual(placed(moved, { placement: false }), [-50, -50, -50, 50, 50, 50])
  assert.deepEqual(placed(moved, { units: 'mm' }), [95, -5, -5, 105, 5, 5])
  // the kinds of xformOps, applied the last first; a Y-up stage turned to Z up
  const corner = toUsd(Box(10, 20, 30, { align: Align.MIN }), { mesh: false })
  assert.deepEqual(placed(corner.replace('upAxis = "Z"', 'upAxis = "Y"')), [0, -30, 0, 10, 0, 20])
  const cases: [string, string, number[]][] = [
    ['    float xformOp:rotateX = 90\n', '"xformOp:rotateX"', [0, -30, 0, 10, 0, 20]],
    ['    float3 xformOp:rotateXYZ = (90, 0, 90)\n', '"xformOp:rotateXYZ"', [0, 0, 0, 30, 10, 20]],
    ['    float3 xformOp:rotateZYX = (90, 0, 90)\n', '"xformOp:rotateZYX"', [-20, -30, 0, 0, 0, 10]],
    ['    quatf xformOp:orient = (0.70710678, 0, 0, 0.70710678)\n', '"xformOp:orient"', [-20, 0, 0, 0, 10, 30]],
    ['    double3 xformOp:translate = (100, 0, 0)\n    float xformOp:rotateZ = 90\n', '"xformOp:translate", "xformOp:rotateZ"', [80, 0, 0, 100, 10, 30]],
    ['    float3 xformOp:scale = (2, 1, 3)\n', '"xformOp:scale"', [0, 0, 0, 20, 20, 90]],
    ['    matrix4d xformOp:transform = ( (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 1, 0), (5, 6, 7, 1) )\n', '"xformOp:transform"', [-15, 6, 7, 5, 16, 37]],
    ['    double3 xformOp:translate:pivot = (5, 0, 0)\n    float xformOp:rotateZ = 180\n',
      '"xformOp:translate:pivot", "xformOp:rotateZ", "!invert!xformOp:translate:pivot"', [0, -20, 0, 10, 0, 30]],
  ]
  for (const [op, order, box] of cases) assert.deepEqual(placed(ops(corner, op, order)), box, order)
  // a transform under another; !resetXformStack! drops those above
  const nested = corner.replace('    def BrepArray "body"', '    double3 xformOp:translate = (0, 0, 100)\n    uniform token[] xformOpOrder = ["xformOp:translate"]\n    def BrepArray "body"')
  assert.deepEqual(placed(nested), [0, 0, 100, 10, 20, 130])
  const reset = nested.replace('        uniform token[] face:surfaceType', '        uniform token[] xformOpOrder = ["!resetXformStack!"]\n        uniform token[] face:surfaceType')
  assert.deepEqual(placed(reset), [0, 0, 0, 10, 20, 30])
})

test('usd stages compose references and layers', () => {
  // References, payloads and subLayers were not read ("holds no BrepArray prims"), and abstract,
  // inactive and over-only prims came in as bodies. importUsd reads the files the stage names;
  // fromUsd takes them from resolve.
  const box = toUsd(Box(10, 10, 10), { mesh: false })
  const head = '#usda 1.0\n(\n    metersPerUnit = 0.001\n    upAxis = "Z"\n)\n'
  const scene = `${head}def Xform "Scene"
{
    def Xform "A" (
        prepend references = @./parts/box.usda@</World>
    )
    {
        double3 xformOp:translate = (0, 50, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
    def Xform "B" (
        prepend payload = @parts/box.usda@
    )
    {
        double3 xformOp:translate = (0, -50, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
    def Xform "C" (
        active = false
        references = @./parts/box.usda@</World>
    )
    {
    }
    class Xform "D" (
        references = @./parts/box.usda@</World>
    )
    {
    }
    def Xform "E" (
        references = </Scene/A>
    )
    {
        double3 xformOp:translate = (0, 0, 50)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
}
over "Nothing"
{
    def BrepArray "body"
    {
    }
}
`
  const dir = tmpPath()
  mkdirSync(join(dir, 'parts'))
  writeFileSync(join(dir, 'parts', 'box.usda'), box)
  writeFileSync(join(dir, 'scene.usda'), scene)
  const check = (bodies: ShapeList<Part>) => {
    // (two prims named "body": named by their paths)
    assert.deepEqual(bodies.map((b) => b.name), ['/Scene/A/body', '/Scene/B/body', '/Scene/E/body'])
    assert.deepEqual(bodies.map((b) => b.bbox().center.toArray()), [[0, 50, 0], [0, -50, 0], [0, 0, 50]])
  }
  check(importUsd(join(dir, 'scene.usda')) as ShapeList<Part>)
  const asked: string[] = []
  check(fromUsd(scene, { resolve: (asset, from) => (asked.push(`${from}|${asset}`), asset.endsWith('box.usda') ? box : null) }) as ShapeList<Part>)
  assert.deepEqual(asked, ['|./parts/box.usda', '|parts/box.usda'])
  // a stage of sublayers: the stronger one's opinion wins
  writeFileSync(join(dir, 'box.usda'), box)
  writeFileSync(join(dir, 'moved.usda'), `${head}over "World"\n{\n    double3 xformOp:translate = (7, 0, 0)\n    uniform token[] xformOpOrder = ["xformOp:translate"]\n}\n`)
  writeFileSync(join(dir, 'stack.usda'), '#usda 1.0\n(\n    subLayers = [\n        @./moved.usda@,\n        @./box.usda@\n    ]\n)\n')
  assert.deepEqual((importUsd(join(dir, 'stack.usda')) as Part).bbox().center.toArray(), [7, 0, 0])
  // what cannot be read is named: in a warning, or in the error when no bodies are left
  assert.throws(() => fromUsd(scene), /no BrepArray prims .bodies.; the reference .\/parts\/box.usda was not read .no resolve option was given/)
  writeFileSync(join(dir, 'missing.usda'), `${head}def Xform "S" (\n    references = @./gone.usda@</World>\n)\n{\n}\n`)
  assert.throws(() => importUsd(join(dir, 'missing.usda')), /no BrepArray prims .bodies.; the reference .\/gone.usda was not read .there is no file/)
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    const half = scene.replace('parts/box.usda@</World>\n    )\n    {\n        double3 xformOp:translate = (0, 50', 'gone.usda@</World>\n    )\n    {\n        double3 xformOp:translate = (0, 50')
    writeFileSync(join(dir, 'half.usda'), half)
    assert.equal((importUsd(join(dir, 'half.usda')) as Part).name, 'body') // (B's; A, and E through A, have none)
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
  assert.ok(said.some((m) => /the reference .\/gone.usda was not read/.test(m)), said.join())
  assert.throws(() => fromUsd(`${head}def Xform "L" (\n    references = </L>\n)\n{\n}\n`), /references go round in a circle/)
})

test('usd line edges are written as long as the edges', () => {
  // SMLib's lines have an unbounded interval: they were written as B-splines 2.5 km long (control
  // points at 1234572; usd-brep's validator: BA.365). Read back, the kernel's tight box of such an edge
  // took in the knots past its end (SmCurve::CalculateTightBoundingBox, patched; natively bbox reached
  // 1234560). Lines are written as lines now (X5).
  const text = toUsd(Box(10, 10, 10), { mesh: false })
  assert.ok(text.includes('BrepCurve3dLineAPI:edge3dLine') && !text.includes('edge3dNurb'))
  const box = fromUsd(text) as Part
  assert.deepEqual(box.edges().map((e) => e.geomType), Array(12).fill('line'))
  approx(box.volume, 1000, 1e-9)
  box.bbox().max.toArray().forEach((c) => approx(c, 5, 1e-9))
  // such a file as smlibpy 0.4 wrote the lines of a body it had read: B-splines reaching 1234567
  // along their parameter both ways (smlibwasm's own file: read as it is). The box of the body read
  // back is its own.
  const data = new URL('../../tests/data/usd_bspline_edges.usda', import.meta.url).pathname
  const old = longLines(readFileSync(data, 'utf8').replace('string source = "another tool"', 'string source = "smlibpy"'))
  const back = fromUsd(old) as Part
  assert.equal(back.edges().filter((e) => e.geomType === 'bspline').length, 14)
  const max = back.bbox().max.toArray()
  ;[10, 10, 5].forEach((c, i) => approx(max[i], c, 1e-9)) // was 1234560
})

/** The text with each two-point NURBS edge (a line) reaching 1234567 along its parameter both ways,
 * its edge as it was. */
function longLines(text: string): string {
  const values = (name: string): RegExpExecArray => new RegExp(`(edge3dNurb:curve3d:nurb:${name} = \\[)([^\\]]*)\\]`).exec(text) as RegExpExecArray
  const counts = values('vertexCount')[2].split(', ').map(Number)
  const orders = values('order')[2].split(', ').map(Number)
  const knots = values('knots')[2].split(', ').map(Number)
  const cvs = Array.from(values('controlVertices')[2].matchAll(/\(([^)]*)\)/g), (m) => m[1].split(',').map(Number))
  const newKnots: number[] = []
  const newCvs: number[][] = []
  let ki = 0
  let ci = 0
  counts.forEach((n, i) => {
    const o = orders[i]
    let ks = knots.slice(ki, ki + n + o)
    let pts = cvs.slice(ci, ci + n)
    if (n === 2 && o === 2) {
      const [a, b] = pts
      const [t0, t1] = [ks[1], ks[2]]
      const d = a.map((x, k) => (b[k] - x) / (t1 - t0))
      pts = [-1234567, 1234567].map((t) => a.map((x, k) => x + d[k] * (t - t0)))
      ks = [-1234567, -1234567, 1234567, 1234567]
    }
    newKnots.push(...ks)
    newCvs.push(...pts)
    ki += n + o
    ci += n
  })
  for (const [name, joined] of [
    ['knots', newKnots.map(f).join(', ')],
    ['controlVertices', newCvs.map((p) => `(${p.map(f).join(', ')})`).join(', ')],
  ]) {
    const m = values(name)
    const start = m.index + m[1].length
    text = text.slice(0, start) + joined + text.slice(start + m[2].length)
  }
  return text
}

test('usd bodies that other writers left gaps in', () => {
  // The kernel's check runs on bodies smlibwasm did not write: a vertex moved off its edges by more
  // than 1e-3 of the body's size is refused, a smaller gap noted; check: false reads it.
  const theirs = toUsd(Box(10, 10, 10), { mesh: false }).replace('string source = "smlibpy"', 'string source = "theirs"')
  const [x, y, z] = /brep:vertexPoint:point:position = \[\(([^)]*)\)/.exec(theirs)![1].split(',').map(Number)
  const far = mutated(theirs, 'brep:vertexPoint:point:position', `(${f(x)}, ${f(y)}, ${f(z + 0.5)})`)
  assert.throws(() => fromUsd(far), /is broken: the kernel finds a gap of 0.5 \(0.0\d+ of its size\) at vertex 0/)
  approx((fromUsd(far, { check: false }) as Part).volume, 1000, 1e-6)
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    fromUsd(mutated(theirs, 'brep:vertexPoint:point:position', `(${f(x)}, ${f(y)}, ${f(z + 0.004)})`))
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
  assert.ok(said.some((m) => m.includes('the kernel finds a gap of 0.004 ')), said.join())
})

