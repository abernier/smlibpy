// The kernel layer (src/kernel.ts): the module's functions in Python's namespaces, Python's
// defaults and keywords, kernel failures as KernelError, handles that free their objects.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrepHandle, KernelError, ext, k, kernelCall, module } from '../src/kernel.ts'
import { Box, Cylinder } from '../src/parts.ts'
import { approx } from './_approx.ts'

test('kernel calls, smlibpy submodules and enums sit where Python has them', () => {
  assert.equal(typeof k.create_box, 'function')
  assert.equal(typeof k.ext.curve_data, 'function')
  assert.equal(typeof k.deform.map_points, 'function')
  assert.equal(typeof k.sheetmetal.bend, 'function')
  assert.equal(typeof k.defeature.blend_info, 'function')
  assert.equal(typeof k.draft.face_draft_range, 'function')
  assert.equal(typeof k.face_draft.draft_faces, 'function')
  assert.equal(k.BooleanOp.DIFFERENCE, 3)
  assert.equal(k.BooleanOp2D.EXCLUSIVE_OR, 3)
  assert.equal(k.SM_EFF_ZERO, 1e-12)
})

test('a box has 6 faces, 12 edges and 8 vertices', () => {
  const box = k.create_box([0, 0, 0], 60, 44, 28)
  assert.equal(k.brep_face_count(box), 6)
  assert.equal(k.brep_edge_count(box), 12)
  assert.equal(k.brep_vertex_count(box), 8)
  assert.deepEqual(k.brep_bounding_box(box, true), [[0, 0, 0], [60, 44, 28]])
  ext.delete_brep(box)
})

test('Python defaults and keywords: the trailing object names parameters', () => {
  const box = k.create_box([0, 0, 0], 10, 10, 10)
  const edges = k.brep_edges(box)
  // radius is required, xsect_type 1 (circular) by default
  k.fillet_edges(box, [edges[0]], { radius: 1 })
  assert.equal(k.brep_face_count(box), 7)
  // left-out defaults: brep_bounding_box(b) is the loose box (tight=False)
  assert.equal(k.brep_bounding_box(box).length, 2)
  // an object that is an argument itself is passed as it is
  assert.throws(() => k.fillet_edges(box, [edges[1]]), /missing argument radius/)
  ext.delete_brep(box)
})

test('a cylinder cut from a block leaves its wall as new faces', () => {
  const block = k.create_box([0, 0, 0], 60, 44, 28)
  const cylinder = k.create_cylinder([56.2, 3.8, 0], 19, 44)
  const result = k.boolean(block, cylinder, { operation: k.BooleanOp.DIFFERENCE })
  assert.ok(k.brep_face_count(result) > 6)
  const p = ext.brep_measure(result)
  assert.ok(p.volume < 60 * 44 * 28)
  ext.delete_brep(result)
})

test('a failing kernel call becomes a KernelError naming the operation and the status', () => {
  const sphere = k.create_sphere([0, 0, 0], 5)
  const error = (() => {
    try {
      kernelCall('fillet', () => k.fillet_edges(sphere, [], { radius: 1 }), 'a hint')
    } catch (e) {
      return e
    }
  })()
  assert.ok(error instanceof KernelError, String(error))
  assert.equal(error.operation, 'fillet')
  assert.equal(error.hint, 'a hint')
  assert.match(error.message, /^fillet failed/)
  ext.delete_brep(sphere)
})

test('errors of JavaScript itself pass through kernelCall unchanged', () => {
  assert.throws(() => kernelCall('x', () => { throw new TypeError('wrong') }), TypeError)
})

test('a handle frees its Brep on dispose, once', () => {
  const h = new BrepHandle(k.create_box([0, 0, 0], 1, 1, 1))
  assert.equal(k.brep_face_count(h.brep), 6)
  h.dispose()
  h.dispose()
  assert.throws(() => h.brep, /disposed/)
  assert.throws(() => new BrepHandle(0), KernelError)
})

test('a mesh comes out as arrays', () => {
  const box = k.create_box([0, 0, 0], 2, 3, 4)
  const mesh = ext.tessellate(box, { chord_height_tolerance: 0.01 })
  const m = k.poly_mesh(mesh, true)
  assert.ok(m.points instanceof Float32Array)
  assert.ok(m.faces instanceof Int32Array)
  assert.equal(m.face_normals.length / 3, 12)
  ext.delete_polybrep(mesh)
  ext.delete_brep(box)
})

test('failed kernel calls leave the stack where they found it (smlibwasm)', () => {
  // A kernel error leaves the module as a JavaScript exception, which did not release the stack
  // the call had taken: 144 bytes for each of these, and 40,000 of them used the 4 MB stack up.
  const sp = module.stackSave()
  let failed = 0
  for (let i = 0; i < 40000; i++) {
    try {
      ext.curve_data(0)
    } catch {
      failed++
    }
  }
  assert.equal(failed, 40000)
  assert.equal(module.stackSave(), sp)
  // a raycast that misses the side of a cylinder fails on that face and finds it on its mesh
  const c = Cylinder(5, 20)
  for (let i = 0; i < 50; i++) assert.equal(c.raycast([4.9, 4.9, -30], [0, 0, 1]).length, 0)
  assert.equal(module.stackSave(), sp)
  approx(Box(30, 20, 10).cut(Cylinder(4, 20)).volume, 5497.3452, 1e-7)
  // the stack lies below the static data (--stack-first), so that an overflow traps instead of
  // overwriting that data
  assert.ok(sp <= 4 * 1024 * 1024, `the stack ends at ${sp}`)
})
