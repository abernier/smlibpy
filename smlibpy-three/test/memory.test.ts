// Memory: scope() disposes what its function made and does not return (the package's bodies and
// curves, and the kernel's objects made on the way), keeps what the result holds, nests, and frees
// what a throwing function made; memoryUsage, setWarningHandler and the guards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Body, Box, Cylinder, BrepEdge, BrepFace, GridLocations, Segment, Part, Ball, TriangleMesh, BrepVertex, Wire } from '../src/index.ts'
import { sm } from '../src/kernel.ts'
import { GUARD_BOOLEANS, GUARD_SECONDS, memoryUsage, scope, setGuardBooleans, setGuardSeconds, setWarningHandler } from '../src/memory.ts'
import { close } from './_util.ts'

const Z = new THREE.Vector3(0, 0, 1)

/** Counts 'dispose' events of an object. */
function disposals(target: THREE.Object3D): { count: number } {
  const seen = { count: 0 }
  target.addEventListener('dispose', () => seen.count++)
  return seen
}

/** A plate in the XY plane, 10 thick along z, with rounded corners and four holes through it:
 * operands placed with transforms, intermediates. */
function rebuild(width: number): Part {
  const plate = new Box(width, 60, 10)
  const rounded = plate.fillet(plate.edges().parallelTo(Z), 5)
  const pin = new Cylinder(3, 3, 20)
  pin.rotation.x = Math.PI / 2 // (along z, through the plate)
  return rounded.cut(pin.at(GridLocations(width - 20, 40, 2, 2)))
}

test('scope disposes what its function made and does not return, at once; the result stays', () => {
  const outside = new Box(50, 50, 50)
  const expected = rebuild(80).volume
  let box: Box | null = null
  let edge: Segment | null = null
  let seen = { count: 0 }
  const before = memoryUsage().handles
  const part = scope(() => {
    box = new Box(10, 10, 10)
    seen = disposals(box)
    edge = new Segment(new THREE.Vector3(), new THREE.Vector3(1, 0, 0))
    void outside.cut(new Ball(3)) // (a result nobody keeps)
    return rebuild(80)
  })
  assert.equal(memoryUsage().handles, before + 1) // the result, nothing else
  close(part.volume, expected, 1e-9 * expected)
  assert.ok(part.isValid())
  assert.ok(outside.volume > 0) // (made before the scope)
  // the package's objects made in it were disposed as their dispose() does
  assert.equal(seen.count, 1)
  assert.throws(() => (box as unknown as Box).volume, /^TypeError: this Box was disposed/)
  assert.throws(() => (edge as unknown as Segment).length, /disposed|no geometry/)
  part.dispose()
  assert.equal(memoryUsage().handles, before)
})

test('a loop of 50 rebuilds in scope() stays flat', () => {
  const expected = rebuild(80).volume
  scope(() => rebuild(80).volume) // (warm up)
  const before = memoryUsage()
  let total = 0
  for (let i = 0; i < 50; i++) total += scope(() => rebuild(80).volume)
  const after = memoryUsage()
  assert.equal(after.handles, before.handles)
  assert.ok(after.used - before.used < 512 * 1024, `${after.used - before.used} bytes kept`)
  close(total / 50, expected, 1e-9 * expected)
  // (without it, each rebuild keeps its box, fillet, cylinder, moved copies and cut until the garbage collector runs)
  const held = memoryUsage().handles
  for (let i = 0; i < 5; i++) rebuild(80).dispose()
  assert.ok(memoryUsage().handles - held >= 5 * 6, `${memoryUsage().handles - held} kernel objects kept by 5 rebuilds`)
})

test('scope keeps what its result holds: arrays, plain objects, Maps, Sets, children, faces and edges of parts', () => {
  const before = memoryUsage().handles
  let dropped: Box | null = null
  let droppedMesh: TriangleMesh | null = null
  const out = scope(() => {
    const a = new Box(1, 1, 1)
    const b = new Box(2, 2, 2)
    const c = new Box(3, 3, 3)
    const d = new Box(4, 4, 4)
    const group = new THREE.Group()
    group.add(new Box(5, 5, 5))
    const sphere = new Ball(6)
    const cut = new Box(7, 7, 7).cut(new Cylinder(1, 1, 10))
    dropped = new Box(8, 8, 8)
    const line = new Segment(new THREE.Vector3(), new THREE.Vector3(10, 0, 0))
    const mesh = new TriangleMesh(new Box(9, 9, 9).fuse(new Ball(5)))
    droppedMesh = new TriangleMesh(new Box(2, 2, 2))
    return { list: [a], nested: { deeper: [b] }, map: new Map([['c', c]]), set: new Set([d]), group, face: sphere.faces()[0], edges: cut.edges().circles(), line, mesh }
  })
  // (the kept parts, their bodies, and the line)
  assert.equal(memoryUsage().handles, before + 8)
  close(out.list[0].volume, 1, 1e-9)
  close((out.nested.deeper[0] as Part).volume, 8, 1e-9)
  close(out.map.get('c')!.volume, 27, 1e-9)
  close([...out.set][0].volume, 64, 1e-9)
  close((out.group.children[0] as Part).volume, 125, 1e-9)
  // a face of a returned part keeps its part, edges theirs
  close(out.face.area, 4 * Math.PI * 36, 1e-6 * 452)
  assert.ok((out.face.owner as Part).volume > 0)
  assert.ok(out.edges.length > 0 && (out.edges[0].owner as Part).volume > 0)
  close(out.line.length, 10, 1e-12)
  assert.ok(out.mesh.triangleCount > 0 && out.mesh.volume > 729)
  assert.throws(() => (dropped as unknown as Box).volume, /disposed/)
  assert.throws(() => (droppedMesh as unknown as TriangleMesh).volume, /disposed/)
})

test('scopes nest; a throw disposes what the scope made; a promise is a TypeError and disposes nothing', async () => {
  const before = memoryUsage().handles
  let inner: Box | null = null
  const kept = scope(() => {
    inner = scope(() => {
      void new Box(1, 1, 1)
      return new Box(2, 2, 2)
    })
    assert.equal(memoryUsage().handles, before + 1) // (the inner result, now the outer scope's)
    close((inner as unknown as Box).volume, 8, 1e-9)
    return new Box(3, 3, 3)
  })
  // the inner result was not returned by the outer scope
  assert.equal(memoryUsage().handles, before + 1)
  assert.throws(() => (inner as unknown as Box).volume, /disposed/)
  close(kept.volume, 27, 1e-9)
  kept.dispose()
  // an error: what the scope made goes, what the error holds stays, the error goes on
  let made: Part | null = null
  assert.throws(
    () =>
      scope(() => {
        made = new Box(1, 1, 1).cut(new Cylinder(0.2, 3))
        throw new RangeError('stop')
      }),
    { name: 'RangeError', message: 'stop' },
  )
  assert.equal(memoryUsage().handles, before)
  assert.throws(() => (made as unknown as Part).volume, /disposed/)
  const error = (() => {
    try {
      return scope(() => {
        const part = new Box(2, 2, 2)
        throw Object.assign(new Error('with a part'), { part })
      })
    } catch (e) {
      return e as Error & { part: Part }
    }
  })()
  close(error.part.volume, 8, 1e-9)
  // a promise: a TypeError, and nothing made before its first await is disposed
  let early: Box | null = null
  assert.throws(
    () =>
      scope(async () => {
        early = new Box(3, 3, 3)
        await null
        return early
      }),
    { name: 'TypeError', message: /not a promise/ },
  )
  close((early as unknown as Box).volume, 27, 1e-9)
  assert.throws(() => scope(null as unknown as () => void), { name: 'TypeError', message: /scope takes a function, not null/ })
  await Promise.resolve()
})

test('objects made before a scope stay; their clones made in it go, and a body shared with a result stays', () => {
  const outer = new Box(10, 10, 10)
  const before = memoryUsage().handles
  let clone: Box | null = null
  const result = scope(() => {
    clone = outer.clone()
    const copies = new Cylinder(1, 1, 20).at(GridLocations(4, 4, 2, 2))
    const kept = copies[0]
    return kept // (shares its body with the cylinder and the other copies, which go)
  })
  close(outer.volume, 1000, 1e-9)
  const seen = disposals(clone as unknown as Box)
  ;(clone as unknown as Box).dispose()
  assert.equal(seen.count, 0) // (disposed by the scope already)
  close(result.volume, Math.PI * 20, 1e-9 * Math.PI * 20) // (the kernel's volume of a cylinder along y: to 1e-11 of it)
  assert.equal(memoryUsage().handles, before + 1)
  // kept anywhere but in the result: disposed (it draws as it was, modeling with it throws)
  let leaked: Box | null = null
  scope(() => {
    leaked = new Box(5, 5, 5)
    leaked.geometry // (drawn)
    return null
  })
  assert.throws(() => (leaked as unknown as Box).volume, /disposed/)
  assert.ok((leaked as unknown as Box).geometry.getAttribute('position').count > 0)
})

test('memoryUsage says what the kernel holds', () => {
  const m = memoryUsage()
  assert.deepEqual(Object.keys(m).sort(), ['crashes', 'handles', 'heap', 'limit', 'used'])
  assert.equal(m.limit, 4 * 1024 * 2 ** 20 - 65536)
  assert.ok(m.used > 0 && m.used <= m.heap && m.heap <= m.limit)
  assert.equal(m.crashes, 0)
  const parts = Array.from({ length: 10 }, (_, i) => new Box(10 + i, 10, 10))
  assert.equal(memoryUsage().handles, m.handles + 10)
  for (const p of parts) p.dispose()
  assert.equal(memoryUsage().handles, m.handles)
})

test("setWarningHandler takes the kernel's warnings; null gives them back to console.warn", () => {
  // (a drawing with a point, which is no curve: reading it warns)
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '30', '0', '11', '10', '21', '0', '31', '0', '0', 'POINT', '8', '0', '10', '1', '20', '1', '30', '0', '0', 'ENDSEC', '0', 'EOF', ''].join('\n')
  const said: string[] = []
  setWarningHandler((message) => said.push(message))
  try {
    sm.fromDxfWires(dxf)
  } finally {
    setWarningHandler(null)
  }
  assert.equal(said.length, 1)
  assert.match(said[0], /left out what is not a curve: 1 POINT/)
  const warned: unknown[] = []
  const warn = console.warn
  console.warn = (...args: unknown[]) => void warned.push(args)
  try {
    sm.fromDxfWires(dxf)
  } finally {
    console.warn = warn
  }
  assert.equal(warned.length, 1)
  assert.throws(() => setWarningHandler('loud' as never), TypeError)
})

test('the guards: GUARD_SECONDS and GUARD_BOOLEANS are read, set with setGuardSeconds and setGuardBooleans', () => {
  assert.equal(GUARD_SECONDS, 20)
  assert.equal(GUARD_BOOLEANS, false)
  assert.equal(setGuardSeconds(5), 20)
  assert.equal(GUARD_SECONDS, 5)
  assert.equal(sm.GUARD_SECONDS, 5)
  assert.equal(setGuardSeconds(20), 5)
  assert.equal(GUARD_SECONDS, 20)
  assert.throws(() => setGuardSeconds(-1), RangeError)
  assert.equal(GUARD_SECONDS, 20)
  assert.equal(setGuardBooleans(true), false)
  assert.equal(GUARD_BOOLEANS, true)
  // (a Boolean in the probe worker gives what it gives here)
  close(new Box(10, 10, 10).cut(new Cylinder(2, 2, 20)).volume, 1000 - Math.PI * 4 * 10, 1e-6)
  assert.equal(setGuardBooleans(false), true)
  assert.equal(GUARD_BOOLEANS, false)
  assert.throws(() => setGuardBooleans('yes' as never), TypeError)
})
