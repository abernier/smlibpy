// tests/test_io.py
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Box, Cone, Cylinder, GridLocations, Part, Sphere, Spline, Torus, Z, loft, Circle, Rectangle, render } from '../src/index.ts'
import { exportGlb, exportGltf, exportStep, exportStl, fromSmb, fromStl, importStl, load, save, toGlb, toGltf, toObj, toSmb, toStl } from '../src/exporters.ts'
import { approx } from './_approx.ts'

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
