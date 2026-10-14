// tests/test_io.py
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Box, Cone, Cylinder, GridLocations, Part, Sphere, Spline, Torus, Z, loft, Circle, Rectangle, render } from '../src/index.ts'
import { exportGlb, exportGltf, exportStep, exportStl, fromSmb, fromStl, importStl, load, save, toGlb, toGltf, toObj, toSmb, toStl } from '../src/exporters.ts'
import { approx } from './_approx.ts'
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { Shell, ShapeList, merge as _merge, surface as _surface } from '../src/index.ts'
import { exportFile } from '../src/exporters.ts'
import { exportUsd, fromUsd, importUsd, toUsd } from '../src/usd.ts'

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
    approx(back.volume, part.volume, 1e-12)
    assert.deepEqual(back.faces().map((f) => f.geomType), part.faces().map((f) => f.geomType))
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
  assert.equal(text.split('def BrepArray').length - 1, 3)
  assert.ok(!text.includes('def Mesh'))
  exportUsd([p, p.mesh()], join(dir, 'meshes.usda'), { mesh: true })
  const withMeshes = readFileSync(join(dir, 'meshes.usda'), 'utf8')
  assert.equal(withMeshes.split('def BrepArray').length - 1, 1)
  assert.equal(withMeshes.split('def Mesh').length - 1, 2)
  assert.ok(withMeshes.includes('normal3f[] normals'))
  approx((importUsd(join(dir, 'meshes.usda')) as Part).volume, p.volume, 1e-12) // (meshes are not read)
})

test('usd rejects what it cannot read', () => {
  const p = plate()
  const dir = tmpPath()
  assert.throws(() => exportUsd(p, join(dir, 'plate.usdc')), /usdcat/)
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
    'RevitWallHealerCrash.usda': 1, 'Cone_SmConnect_Brep.usda': 1,
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
    if (name in good) {
      const bodies = fromUsd(text)
      const list = bodies instanceof ShapeList ? Array.from(bodies) : [bodies]
      assert.equal(list.length, good[name], name)
      assert.ok(list.every((b) => (b as Part).isValid()), name)
      seen += 1
    } else {
      try {
        fromUsd(text)
      } catch (e) {
        if (!(e instanceof RangeError)) throw e
      }
    }
  }
  assert.equal(seen, Object.keys(good).length)
})

