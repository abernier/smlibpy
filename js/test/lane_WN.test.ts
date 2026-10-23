// Lane WN of the kernel plan (phase 1): the worker entry (W2), loader options and bundlers (W7),
// out-of-memory and C++ exception errors (W8), the three.js conversion of docs/javascript.md;
// kernel steps whose result comes back from the probe worker (N1), scope() and the port's own
// temporaries (W9), memory regressions (N2) and the fuzz harness (N3); crashes of the kernel
// (W10), the package's typings (W11) and the API reference (W12); WOFF2, CFF2 and seac fonts
// (W13), files in memory (W14) and the raw kernel layer with all of SmPyLib's calls (W15);
// NVIDIA's validator on toUsd's files (N4), the parity with smlibpy's golden files and the docs'
// examples (N5, W16), the kernel's error trace (N6), and what queries keep on a body (N9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { Box, Cylinder, KernelError, Location, Mesh, ModelingError, Part, Plane, Shell, ShapeList, Sketch, Vector, memoryUsage } from '../src/index.ts'
import { _crashText, ext, k, kernelCall } from '../src/kernel.ts'
import { KernelWorker, expose } from '../src/worker.ts'
import { init } from '../src/init.ts'
import type * as Models from './lane_WN_models.ts'
import { Axis, Circle, Cone, GridLocations, Polygon, Polyline, Rectangle, Slot, Sphere, Text, X, Y, Z, extrude, fromSmb, loft, revolve, scope, setGuardBooleans, setGuardSeconds, surfaceFillet, sweep, Line, toSmb } from '../src/index.ts'
import { plate } from './lane_WN_models.ts'
import { approx } from './_approx.ts'
import { pathToFileURL } from 'node:url'
import { Ellipse, fromStep, fromUsd, importDxf, importStep, split, toDxf, toGltf, toObj, toStep, toStl, toUsd } from '../src/index.ts'

const WORKER = new URL('./lane_WN_worker.ts', import.meta.url)
const SRC = new URL('../src/', import.meta.url)
const WASM = new URL('../wasm/smlibwasm.wasm', import.meta.url)
const MB = 2 ** 20

/** Runs `code` (an ES module) in a Node process of its own; its output, which must be JSON. */
function run(code: string, timeout = 120_000): Record<string, unknown> {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout })
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`)
  return JSON.parse(out.stdout.trim().split('\n').at(-1) as string)
}

// ================================================================================ W8: memory, C++ exceptions
test('memoryUsage: what the kernel holds, how far its memory grew and how far it can grow (W8)', () => {
  const before = memoryUsage()
  assert.deepEqual(Object.keys(before).sort(), ['crashes', 'handles', 'heap', 'limit', 'used'])
  assert.equal(before.crashes, 0) // (W10: no crash in this process yet)
  assert.equal(before.limit, 4 * 1024 * MB - 65536) // (4 GB less one page: as far as wasm32 reaches)
  assert.equal(before.heap % 65536, 0)
  assert.ok(before.used > 0 && before.used <= before.heap && before.heap <= before.limit)
  const parts = Array.from({ length: 100 }, (_, i) => Box(10 + i, 10, 10).cut(Cylinder(2, 20)))
  const held = memoryUsage().used
  assert.ok(held - before.used > 100 * 4096, `100 parts take ${held - before.used} bytes`)
  for (const p of parts) p.dispose()
  assert.ok(memoryUsage().used < held - 100 * 4096)
})

test('a C++ exception of the kernel is an Error with a message, not an opaque WebAssembly.Exception (W8)', () => {
  // (2^30 - 1 pointers: 4 GB, which the module cannot have; 2^30: more than a vector holds)
  assert.throws(() => k.create_planar_faces({ length: 2 ** 30 - 1 }), (e: unknown) => {
    assert.ok(e instanceof Error && !(e instanceof RangeError))
    assert.equal(e.message, 'SM_ERR_OUT_OF_MEMORY: the kernel ran out of memory (std::bad_alloc)')
    return true
  })
  assert.throws(() => k.create_planar_faces({ length: 2 ** 30 }), (e: unknown) => e instanceof RangeError && e.message === 'vector')
  // smlibpy's own bindings (guard) say the same
  assert.throws(() => ext.combine({ length: 2 ** 30 - 1 }), { message: 'SM_ERR_OUT_OF_MEMORY: the kernel ran out of memory (std::bad_alloc)' })
  // and the module goes on (W1's check)
  assert.ok(Math.abs(Box(30, 20, 10).cut(Cylinder(4, 20)).volume - 5497.3452) < 1e-3)
})

test('memory that is used up is a KernelError SM_ERR_OUT_OF_MEMORY that says what to do (W8)', () => {
  assert.throws(() => kernelCall('make faces', () => k.create_planar_faces({ length: 2 ** 30 - 1 }), 'is the outline closed?'), (e: unknown) => {
    assert.ok(e instanceof KernelError)
    assert.equal(e.status, 'SM_ERR_OUT_OF_MEMORY')
    assert.match(e.message, /^make faces failed \(SM_ERR_OUT_OF_MEMORY\): the kernel ran out of memory \(\d+ MB in use, at most 4096 MB\): dispose\(\) parts/)
    assert.ok(!e.message.includes('outline'), 'the out-of-memory hint takes the place of the operation\'s')
    return true
  })
})

test('C++ exceptions that reach JavaScript leave no memory behind (W8)', () => {
  const f = () => {
    try {
      k.create_planar_faces({ length: 2 ** 30 - 1 })
    } catch {
      // (expected)
    }
  }
  f()
  const before = memoryUsage().used
  for (let i = 0; i < 2000; i++) f()
  // (each would keep its 108-byte exception object if nothing freed it)
  assert.ok(memoryUsage().used - before < 2000 * 16, `${memoryUsage().used - before} bytes kept`)
})

test('a trap when an allocation failed or the memory is at its limit is the kernel running out of memory (W8)', () => {
  const fine = { heap: 512 * MB, limit: 4096 * MB, failed: false }
  assert.equal(_crashText('table index is out of bounds', fine), 'the kernel crashed (table index is out of bounds)')
  assert.match(_crashText('table index is out of bounds', { ...fine, failed: true }), /^SM_ERR_OUT_OF_MEMORY: the kernel crashed when it ran out of memory/)
  assert.match(_crashText('x', { ...fine, heap: 4096 * MB - 65536 }), /^SM_ERR_OUT_OF_MEMORY/)
  assert.equal(_crashText('x', null), 'the kernel crashed (x)')
})

// ================================================================================ W7: the loader, init
test('the loader bundles for the browser: no node: module imported by a literal name (W7)', () => {
  const loader = readFileSync(new URL('../wasm/smlibwasm.mjs', import.meta.url), 'utf8')
  assert.ok(!/import\(\s*["']node:/.test(loader), 'webpack 5 and esbuild cannot read import("node:...")')
  assert.match(loader, /import\(\/\* webpackIgnore: true \*\/ \/\* @vite-ignore \*\/ \["node", "module"\]\.join\(":"\)\)/)
})

test('the package bundles: no worker module imports its way back to a worker, worker options are literal, no file is named by an expression (W7)', () => {
  // Vite and webpack build each `new Worker(new URL('...', import.meta.url))` with the modules it
  // imports (also with import()): Vite 7 refuses a worker that reaches itself again ("Circular
  // worker imports detected"), Vite 4 options it cannot read, and both bundle every file of the
  // package for a URL whose name is an expression.
  const dir = fileURLToPath(SRC)
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
  // (without comments, which show such code)
  const code = new Map(files.map((f) => [f, readFileSync(dir + f, 'utf8').replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]))
  // (the modules a module loads: imports and re-exports that are not type-only, import(...))
  const imports = (f: string) => {
    const text = code.get(f) as string
    const out: string[] = []
    for (const m of text.matchAll(/^(?:import|export)\s+(type\s+)?[^'"]*?from\s+'\.\/([\w.]+\.ts)'/gm)) if (!m[1]) out.push(m[2])
    for (const m of text.matchAll(/^import\s+'\.\/([\w.]+\.ts)'/gm)) out.push(m[1])
    for (const m of text.matchAll(/(?<!typeof\s)\bimport\(\s*'\.\/([\w.]+\.ts)'\s*\)/g)) out.push(m[1])
    return out
  }
  const reach = (start: string) => {
    const seen = new Set<string>([start])
    const todo = [start]
    while (todo.length) for (const g of imports(todo.pop() as string)) if (!seen.has(g)) (seen.add(g), todo.push(g))
    return seen
  }
  // (the workers the modules of a worker start, and theirs in turn: never the worker itself)
  const started = (f: string) => [...(code.get(f) as string).matchAll(/new Worker\(new URL\('\.\/([\w.]+)\.js'/g)].map((m) => `${m[1]}.ts`)
  const spawns = (w: string) => [...reach(w)].flatMap(started)
  const cyclic = (w: string) => {
    const seen = new Set<string>()
    const todo = spawns(w)
    while (todo.length) {
      const x = todo.pop() as string
      if (x === w) return true
      if (!seen.has(x)) (seen.add(x), todo.push(...spawns(x)))
    }
    return false
  }
  assert.deepEqual(spawns('index.ts'), ['_defeature_supervisor.ts'])
  assert.deepEqual(spawns('_defeature_supervisor.ts'), ['_defeature_worker.ts'])
  for (const worker of ['index.ts', 'worker.ts', '_defeature_supervisor.ts', '_defeature_worker.ts']) assert.ok(!cyclic(worker), `${worker} starts itself again`)
  for (const [f, text] of code) {
    for (const m of text.matchAll(/new Worker\(new URL\([^)]*\)\s*,\s*(\{[^}]*\})/g)) {
      assert.match(m[1], /^\{\s*type:\s*'module'(,\s*name:\s*'[\w-]+')?\s*\}$/, `${f}: worker options bundlers can read`)
    }
    assert.ok(!/new URL\(\s*(`|[^'")]+\+|'[^']*'\s*\+)[^)]*,\s*import\.meta\.url\s*\)/.test(text), `${f}: a file named by an expression next to import.meta.url`)
  }
})

test('init: the kernel from another place, from its bytes, from a compiled module (W7)', () => {
  const src = (name: string) => JSON.stringify(new URL(name, SRC).href)
  const wasm = JSON.stringify(fileURLToPath(WASM))
  const check = "const p = Box(30, 20, 10).cut(Cylinder(4, 20)); out.volume = Math.round(p.volume * 1e4) / 1e4"
  const located = run(`
    import { init } from ${src('init.ts')}
    const out = { asked: [] }
    const { Box, Cylinder } = await init({ locateFile: (path, prefix) => (out.asked.push(path), ${wasm}) })
    ${check}
    console.log(JSON.stringify(out))`)
  assert.deepEqual(located, { asked: ['smlibwasm.wasm'], volume: 5497.3452 })
  const bytes = run(`
    import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
    import { init } from ${src('init.ts')}
    const out = {}
    const { Box, Cylinder } = await init({ wasmBinary: readFileSync(${wasm}) })
    ${check}
    console.log(JSON.stringify(out))`)
  assert.deepEqual(bytes, { volume: 5497.3452 })
  const compiled = run(`
    import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
    import { init } from ${src('init.ts')}
    const out = {}
    const wasmModule = await WebAssembly.compile(readFileSync(${wasm}))
    const smlib = await init({ wasmModule })
    const { Box, Cylinder } = smlib
    ${check}
    out.same = smlib === await import(${src('index.ts')})
    console.log(JSON.stringify(out))`)
  assert.deepEqual(compiled, { volume: 5497.3452, same: true })
})

test('init: a kernel that does not load rejects the import, rather than waiting for good (W7)', () => {
  const src = JSON.stringify(new URL('init.ts', SRC).href)
  const failed = run(`
    import { init } from ${src}
    try { await init({ wasmBinary: new Uint8Array([1, 2, 3]) }); console.log(JSON.stringify({ loaded: true })) }
    catch (e) { console.log(JSON.stringify({ message: e.message })) }`, 60_000)
  assert.match(String(failed.message), /^the kernel could not be instantiated \(/)
})

test('init: options after the kernel was loaded are an Error, wrong options a TypeError (W7)', async () => {
  // (this process loaded the kernel already)
  assert.throws(() => init({ locateFile: (p: string) => p }), /the kernel was loaded already/)
  assert.throws(() => init({ locatefile: () => '' } as never), { name: 'TypeError', message: /unexpected option 'locatefile'/ })
  assert.throws(() => init({ wasmBinary: new Uint8Array(1), instantiateWasm: () => ({}) }), { name: 'TypeError', message: /one of wasmBinary, wasmModule and instantiateWasm/ })
  assert.throws(() => init({ wasmBinary: 'smlibwasm.wasm' as never }), TypeError)
  const smlib = await init()
  assert.equal(smlib.Box, Box)
})

// ================================================================================ W2+: the worker entry
const worker = (options = {}) => new KernelWorker<typeof Models>(WORKER, options)

test('KernelWorker: a part made in a worker comes back exact, and goes back with its faces and edges (W2)', async () => {
  const cad = worker()
  try {
    const part = await cad.call('plate', [80, 3, 6])
    assert.ok(part instanceof Part)
    const here = plate(80, 3, 6)
    // (the same body: its volume may differ in the last digit, as the integration meets the faces
    // of the copy in another order)
    assert.ok(Math.abs(part.volume - here.volume) < 1e-9 * here.volume)
    assert.equal(part.faces().length, here.faces().length)
    assert.equal(await cad.call('volume', [part]), part.volume)
    // a sub-shape crosses as its body and its place in it: the same body object over there
    assert.equal(await cad.call('sameOwner', [part, part.faces()[3]]), true)
    const hole = [...part.edges()].filter((e) => e.geomType === 'circle' && Math.abs(e.radius - 3) < 1e-9).sort((a, b) => b.center().z - a.center().z)[0]
    const filleted = await cad.call('filleted', [part, hole, 0.5])
    assert.equal(filleted.volume, part.fillet(hole, 0.5).volume)
    // names, colors and sketch planes cross with their bodies
    const named = await cad.call('named', [part, 'plate'])
    assert.equal(named.name, 'plate')
    assert.equal(named.color, 'steelblue')
    const tab = await cad.call('sketch', [])
    assert.ok(tab instanceof Sketch)
    assert.equal(tab.name, 'tab')
    assert.ok(tab.plane.isCoplanar(new Plane([0, 0, 5], [0, 1, 0], [1, 0, 0])))
    assert.ok(tab.plane.xDir.isClose([0, 1, 0]))
    // lists of faces come back as ShapeLists, a shell as a shell
    const planes = await cad.call('faces', [part])
    assert.ok(planes instanceof ShapeList && planes.length > 0 && planes.every((f) => f.owner === planes[0].owner))
    const shell = await cad.call('echo', [part.faces().first.toShell()])
    assert.ok(shell instanceof Shell && !(shell instanceof Part))
  } finally {
    cad.terminate()
  }
})

test('KernelWorker: geometry values and plain data cross as themselves (W2)', async () => {
  const cad = worker()
  try {
    const g = (await cad.call('geometry', [])) as ReturnType<typeof Models.geometry>
    assert.ok(g.vector instanceof Vector && g.vector.equals(new Vector(1, 2, 3)))
    assert.ok(g.location instanceof Location)
    assert.deepEqual(g.location.matrix, new Location([10, 20, 30], [15, 25, 35]).matrix)
    assert.ok(g.plane instanceof Plane && g.plane.zDir.isClose([1, 0, 0]))
    assert.ok(g.axis.direction.isClose([Math.SQRT1_2, Math.SQRT1_2, 0]))
    assert.deepEqual(g.box.max.toArray(), [4, 5, 6])
    assert.deepEqual(g.list, [1, 'two', { three: 3 }])
    assert.deepEqual([...g.bytes], [1, 2, 3])
    const round = await cad.call('echo', [{ at: [new Vector(1, 1, 1)], when: new Date(0), n: null }])
    assert.ok((round as Any).at[0] instanceof Vector && (round as Any).when.getTime() === 0 && (round as Any).n === null)
  } finally {
    cad.terminate()
  }
})

test('KernelWorker: meshes cross as their arrays, and the sender keeps its own (W2)', async () => {
  const cad = worker()
  try {
    const part = plate(80, 3, 6)
    const mesh = await cad.call('keptMesh', [part])
    assert.ok(mesh instanceof Mesh)
    assert.ok(mesh.length > 100 && mesh.normals !== null && mesh.normals.length === mesh.length * 9)
    assert.ok(Math.abs(mesh.volume - part.volume) / part.volume < 0.01)
    const length = mesh.vertices.length
    // (the worker sent a copy: its own mesh is whole, and it sends it again)
    assert.equal(await cad.call('keptLength', []), length)
    assert.equal((await cad.call('keptMesh', [part])).vertices.length, length)
    // a mesh goes to the worker the same way, and stays here
    assert.equal(await cad.call('triangles', [mesh]), mesh.length)
    assert.equal(mesh.vertices.length, length)
  } finally {
    cad.terminate()
  }
})

test('KernelWorker: errors keep their class and fields; values that cannot cross are a TypeError (W2)', async () => {
  const cad = worker()
  try {
    await assert.rejects(cad.call('fail', ['modeling']), (e) => e instanceof ModelingError && !(e instanceof KernelError) && e.message === 'this cannot be done: try something else')
    await assert.rejects(cad.call('fail', ['kernel']), (e) => {
      assert.ok(e instanceof KernelError)
      assert.equal(e.operation, 'test step')
      assert.equal(e.status, 'SM_ERR_INVALID_INPUT')
      assert.equal(e.hint, 'is the box size positive?')
      assert.match(e.stack ?? '', /in the worker:\n[^]*lane_WN_models/)
      return true
    })
    await assert.rejects(cad.call('fail', ['type']), (e) => e instanceof TypeError && e.message === 'not a part')
    await assert.rejects(cad.call('fail', ['range']), RangeError)
    await assert.rejects(cad.call('nothing' as never, []), { name: 'TypeError', message: /the worker has no function 'nothing' \(it has: .*plate/ })
    await assert.rejects(cad.call('standaloneEdge', []), { name: 'TypeError', message: /an edge of no body cannot go to or come from a worker/ })
    await assert.rejects(cad.call('echo', [() => 1]), { name: 'TypeError', message: /a function cannot go/ })
    // (the worker is fine after all of them)
    assert.equal(await cad.call('later', [5, 1]), 5)
  } finally {
    cad.terminate()
  }
})

test('KernelWorker: a call that runs too long ends with its worker, and the next call gets a new one (W2)', async () => {
  const cad = worker({ timeout: 60_000 })
  try {
    const first = await cad.call('thread', [])
    const started = Date.now()
    await assert.rejects(cad.call('spin', [-1], { timeout: 300 }), (e) => {
      assert.ok(e instanceof DOMException)
      assert.equal(e.name, 'TimeoutError')
      assert.equal(e.message, 'spin did not finish within 300 ms; its worker was terminated')
      return true
    })
    assert.ok(Date.now() - started < 5000)
    const second = await cad.call('thread', [])
    assert.notEqual(second, first)
    // the KernelWorker's own timeout
    const short = worker({ timeout: 200 })
    try {
      await assert.rejects(short.call('spin', [-1]), { name: 'TimeoutError' })
      assert.equal(await short.call('later', [3, 1]), 3)
    } finally {
      short.terminate()
    }
  } finally {
    cad.terminate()
  }
})

test('KernelWorker: a kernel step that loops for good is stopped by the call\'s timeout (W2)', async () => {
  // removeFillets on the enclosure example's outer bottom round never returned in the wasm (W2)
  const cad = worker()
  try {
    const first = await cad.call('thread', [])
    const started = Date.now()
    await assert.rejects(cad.call('loopingStep', [], { timeout: 4000 }), { name: 'TimeoutError', message: 'loopingStep did not finish within 4000 ms; its worker was terminated' })
    assert.ok(Date.now() - started < 8000)
    assert.notEqual(await cad.call('thread', []), first)
    assert.ok(Math.abs((await cad.call('volume', [plate(60, 2, 5)])) - plate(60, 2, 5).volume) < 1e-6)
  } finally {
    cad.terminate()
  }
})

test('KernelWorker: an AbortSignal stops the call that runs and drops one that waits (W2)', async () => {
  const cad = worker()
  try {
    const first = await cad.call('thread', [])
    const running = new AbortController()
    const spinning = cad.call('spin', [-1], { signal: running.signal })
    const waiting = new AbortController()
    const dropped = cad.call('spin', [-1], { signal: waiting.signal })
    const after = cad.call('later', [7, 1])
    waiting.abort(new Error('not needed'))
    await assert.rejects(dropped, { message: 'not needed' })
    assert.equal(cad.pending, 2)
    setTimeout(() => running.abort(), 100)
    await assert.rejects(spinning, { name: 'AbortError' })
    assert.equal(await after, 7)
    assert.notEqual(await cad.call('thread', []), first)
    // a signal that fired already: the call does not start
    await assert.rejects(cad.call('later', [1, 1], { signal: AbortSignal.abort() }), { name: 'AbortError' })
    // a call that waits behind a slow one is dropped without stopping it
    const third = await cad.call('thread', [])
    const slow = cad.call('later', [9, 300])
    const late = new AbortController()
    const queued = cad.call('thread', [], { signal: late.signal })
    late.abort()
    await assert.rejects(queued, { name: 'AbortError' })
    assert.equal(await slow, 9)
    assert.equal(await cad.call('thread', []), third)
  } finally {
    cad.terminate()
  }
})

test('KernelWorker: a kernel that crashed or ran out of memory is replaced; one that failed as usual is not (W2)', async () => {
  const cad = worker()
  try {
    const first = await cad.call('thread', [])
    await assert.rejects(cad.call('fail', ['kernel']), KernelError)
    assert.equal(await cad.call('thread', []), first)
    await assert.rejects(cad.call('crash', []), (e) => e instanceof WebAssembly.RuntimeError && /memory access out of bounds/.test(e.message))
    const second = await cad.call('thread', [])
    assert.notEqual(second, first)
    await assert.rejects(cad.call('outOfMemory', []), (e) => e instanceof KernelError && e.status === 'SM_ERR_OUT_OF_MEMORY')
    assert.notEqual(await cad.call('thread', []), second)
  } finally {
    cad.terminate()
  }
})

test('KernelWorker: terminate() rejects the calls; start(), functions and pending (W2)', async () => {
  const cad = worker()
  const names = await cad.start()
  assert.ok(names.includes('plate') && names.includes('spin'))
  const a = cad.call('spin', [-1])
  const b = cad.call('later', [1, 1])
  assert.equal(cad.pending, 2)
  await new Promise((done) => setTimeout(done, 50))
  cad.terminate()
  await assert.rejects(a, { name: 'AbortError', message: 'the worker was terminated' })
  await assert.rejects(b, { name: 'AbortError' })
  assert.equal(cad.pending, 0)
  // a new worker for the next call; the functions as functions
  assert.equal(await cad.functions.later(4, 1), 4)
  const part = await cad.functions.plate(60, 2, 5)
  assert.ok(Math.abs(part.volume - plate(60, 2, 5).volume) < 1e-9 * part.volume)
  cad.terminate()
})

test('KernelWorker: options are checked; a worker that does not start rejects its calls (W2)', async () => {
  assert.throws(() => new KernelWorker(WORKER, { timout: 1 } as never), { name: 'TypeError', message: /unexpected option 'timout'/ })
  assert.throws(() => new KernelWorker(WORKER, { timeout: -1 }), RangeError)
  assert.throws(() => new KernelWorker(42 as never), TypeError)
  const cad = worker()
  await assert.rejects(cad.call('later', [1, 1], { timeout: 'soon' as never }), RangeError)
  await assert.rejects(cad.call('later', 1 as never), TypeError)
  cad.terminate()
  // modules that never call expose(): one that ends, one that goes on; one that fails to load its
  // functions; one that is not there
  const ending = new KernelWorker(new URL('data:text/javascript,'))
  await assert.rejects(ending.call('anything', []), /the worker failed: it ended before it was ready \(exit code 0\): does its module call expose\(\)\?/)
  ending.terminate()
  const silent = new KernelWorker(new URL('data:text/javascript,setInterval(() => {}, 1000)'), { startTimeout: 300 })
  await assert.rejects(silent.call('anything', []), /the worker did not start within 300 ms \(does its module call expose\(\)\?\)/)
  silent.terminate()
  const failing = new KernelWorker(
    new URL(`data:text/javascript,import { expose } from ${JSON.stringify(new URL('worker.ts', SRC).href)}; expose(() => Promise.reject(new Error('no models')))`),
  )
  const calls = [failing.call('a', []), failing.call('b', [])]
  for (const call of calls) await assert.rejects(call, /the worker failed to load its functions: no models/)
  failing.terminate()
  const missing = new KernelWorker(new URL('./no-such-worker.ts', import.meta.url))
  await assert.rejects(missing.call('a', []), /the worker failed/)
  missing.terminate()
  // expose() outside a worker
  assert.throws(() => expose({}), /call it in a Web Worker or a Node worker thread/)
})

test('KernelWorker: the calling thread loads no kernel for plain results, and loads it for a part (W2)', () => {
  const src = (name: string) => JSON.stringify(new URL(name, SRC).href)
  const out = run(`
    import { registerHooks } from 'node:module'
    const loaded = []
    registerHooks({ load(url, context, next) { loaded.push(url); return next(url, context) } })
    const kernel = () => loaded.some((url) => /\\/kernel\\.ts$|smlibwasm\\.mjs$/.test(url))
    const { KernelWorker } = await import(${src('worker.ts')})
    const cad = new KernelWorker(new URL(${JSON.stringify(WORKER.href)}))
    const out = {}
    out.value = await cad.call('later', [6, 1])
    out.box = (await cad.call('geometry', [])).box.max.toArray()
    out.kernelBefore = kernel()
    const part = await cad.call('plate', [80, 3, 6])
    out.volume = Math.round(part.volume)
    out.kernelAfter = kernel()
    cad.terminate()
    console.log(JSON.stringify(out))`)
  assert.deepEqual(out, { value: 6, box: [4, 5, 6], kernelBefore: false, volume: Math.round(plate(80, 3, 6).volume), kernelAfter: true })
})

test('KernelWorker: an idle worker, or one terminated while it starts, does not keep Node running (W2)', () => {
  const started = Date.now()
  const out = run(`
    import { KernelWorker } from ${JSON.stringify(new URL('worker.ts', SRC).href)}
    const idle = new KernelWorker(new URL(${JSON.stringify(WORKER.href)}))
    const value = await idle.call('later', [2, 1])
    const stopped = new KernelWorker(new URL(${JSON.stringify(WORKER.href)}))
    stopped.start().catch(() => {})
    stopped.terminate()
    console.log(JSON.stringify({ value }))`, 30_000)
  assert.deepEqual(out, { value: 2 })
  assert.ok(Date.now() - started < 15_000, `Node ran ${Date.now() - started} ms`)
})

// ================================================================================ the three.js snippet of docs/javascript.md
test('docs: the three.js conversion gives each corner the exact normal; shared vertices did not (DOCS-SNIPPET)', () => {
  const part = Box(40, 30, 10).cut(Cylinder(6, 20))
  const { vertices, triangles, normals } = part.mesh(0.01)
  assert.ok(normals !== null)
  // as the docs: three corners per triangle, with the kernel's normals
  const position = new Float32Array(triangles.length * 3)
  triangles.forEach((v, i) => position.set(vertices.subarray(3 * v, 3 * v + 3), 3 * i))
  assert.equal(position.length, normals.length)
  const angle = (a: ArrayLike<number>, b: ArrayLike<number>) => {
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    return (Math.acos(Math.max(-1, Math.min(1, dot / Math.hypot(a[0], a[1], a[2]) / Math.hypot(b[0], b[1], b[2])))) * 180) / Math.PI
  }
  let flat = 0
  let round = 0
  for (let c = 0; c < triangles.length; c++) {
    const [x, y, z] = position.subarray(3 * c, 3 * c + 3)
    const n = normals.subarray(3 * c, 3 * c + 3)
    if (Math.abs(Math.hypot(x, y) - 6) < 0.02 && Math.abs(n[2]) < 1e-6) {
      round = Math.max(round, angle(n, [-x, -y, 0])) // (the hole's wall faces its axis)
    } else {
      const t = Math.floor(c / 3) * 3
      const p = (i: number) => position.subarray(3 * (t + i), 3 * (t + i) + 3)
      const u = [p(1)[0] - p(0)[0], p(1)[1] - p(0)[1], p(1)[2] - p(0)[2]]
      const w = [p(2)[0] - p(0)[0], p(2)[1] - p(0)[1], p(2)[2] - p(0)[2]]
      flat = Math.max(flat, angle(n, [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]))
    }
  }
  assert.ok(flat < 1e-3 && round < 0.01, `flat faces ${flat} deg, the hole ${round} deg`)
  // what computeVertexNormals() made of the shared vertices: the area-weighted mean of the
  // triangles around each vertex, across the sharp edges
  const mean = new Float64Array(vertices.length)
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]].map((v) => vertices.subarray(3 * v, 3 * v + 3))
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    for (const v of [triangles[t], triangles[t + 1], triangles[t + 2]]) for (let j = 0; j < 3; j++) mean[3 * v + j] += n[j]
  }
  let worst = 0
  triangles.forEach((v, c) => {
    worst = Math.max(worst, angle(mean.subarray(3 * v, 3 * v + 3), normals.subarray(3 * c, 3 * c + 3)))
  })
  assert.ok(worst > 80, `shared vertices were off by up to ${worst} degrees`)
  // the edges of the docs: the part's own, on its surface
  const points: Vector[] = []
  for (const edge of part.edges()) {
    const n = edge.geomType === 'line' ? 1 : 64
    for (let i = 0; i < n; i++) points.push(edge.pointAt(i / n), edge.pointAt((i + 1) / n))
  }
  assert.equal(points.length, 2 * (12 + 2 * 64))
  assert.ok(Math.max(...points.map((p) => part.distanceTo(p))) < 1e-6)
})

// biome-ignore lint: values of the worker, as they come
type Any = any

// ================================================================================ N1: results from the probe worker
/** `fn` with the kernel functions `names` of `space` (k, ext, k.defeature) counted; the counts. */
function counting(space: Record<string, unknown>, names: string[], fn: () => void): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]))
  const saved = names.map((n) => space[n])
  names.forEach((n, i) => {
    const real = saved[i] as (...args: unknown[]) => unknown
    space[n] = (...args: unknown[]) => {
      counts[n]++
      return real(...args)
    }
  })
  try {
    fn()
  } finally {
    names.forEach((n, i) => {
      space[n] = saved[i]
    })
  }
  return counts
}

test('defeaturing runs each kernel step once, in the probe worker, and gets its result back (N1)', () => {
  // The guard ran each step in the probe worker first and then again in this kernel: now the
  // worker's result (its body as .smb, the rest as JSON) comes back, and this kernel runs no step.
  let volumes: number[] = []
  const counts = counting(k.defeature, ['defeature', 'remove_fillet_faces'], () => {
    const box = Box(20, 20, 20)
    const rounded = box.fillet(box.edges().filter((e) => e.center().z > 9), 3)
    const plain = rounded.removeFillets(rounded.faces().fillets())
    const hole = Box(20, 20, 10).cut(Cylinder(3, 10))
    const filled = hole.removeFaces(hole.faces().cylinders())
    volumes = [plain.volume, plain.faces().length, filled.volume]
  })
  assert.deepEqual(counts, { defeature: 0, remove_fillet_faces: 0 })
  assert.ok(Math.abs(volumes[0] - 8000) < 1e-6 && volumes[1] === 6 && Math.abs(volumes[2] - 4000) < 1e-6, String(volumes))
  // without the probe, here
  const guard = setGuardSeconds(0)
  try {
    const box = Box(20, 20, 20)
    const rounded = box.fillet(box.edges().filter((e) => e.center().z > 9), 3)
    const again = counting(k.defeature, ['defeature', 'remove_fillet_faces'], () => rounded.removeFillets(rounded.faces().fillets()))
    assert.ok(again.defeature + again.remove_fillet_faces >= 1)
  } finally {
    setGuardSeconds(guard)
  }
})

test('surfaceFillet and cells() run the kernel in the probe worker (N1)', () => {
  let area = 0
  const blends = counting(k, ['surface_surface_fillet'], () => {
    area = surfaceFillet(Rectangle(40, 40).faces()[0], Rectangle(40, 40).on(Plane.XZ).faces()[0], 5).area
  })
  assert.equal(blends.surface_surface_fillet, 0)
  assert.ok(Math.abs(area - (Math.PI / 2) * 5 * 40) < 1e-6 * area)
  let cells: number[] = []
  const stitched = counting(ext, ['region_shells'], () => {
    cells = Box(10, 10, 10).merge(Box(10, 10, 10).translate(5, 0, 0)).cells().map((c) => c.volume)
  })
  assert.equal(stitched.region_shells, 0)
  assert.deepEqual(cells.map((v) => Math.round(v * 1e6) / 1e6).sort(), [500, 500, 500])
})

test('setGuardBooleans(true) runs every Boolean in the probe worker (N1)', () => {
  const here = counting(ext, ['boolean'], () => Box(10, 10, 10).cut(Cylinder(2, 20)))
  assert.ok(here.boolean >= 1) // (off by default)
  assert.throws(() => setGuardBooleans(1 as unknown as boolean), TypeError)
  const old = setGuardBooleans(true)
  assert.equal(old, false)
  try {
    let v: number[] = []
    const there = counting(ext, ['boolean'], () => {
      const cut = Box(10, 10, 10).cut(Cylinder(2, 20))
      const fused = Box(10, 10, 10).fuse(Sphere(3).translate(5, 5, 5))
      const merged = Box(10, 10, 10).merge(Box(4, 4, 4).translate(5, 5, 5))
      v = [cut.volume, Number(cut.isValid()), fused.volume, merged.volume, merged.cells().length]
    })
    assert.equal(there.boolean, 0)
    const expect = [1000 - Math.PI * 4 * 10, 1, 1000 + (7 / 8) * (4 / 3) * Math.PI * 27, 1000 + 64 - 8, 3]
    v.forEach((x, i) => assert.ok(Math.abs(x - expect[i]) < 1e-6 * Math.max(1, expect[i]), `${v} ${expect}`))
    // an error there is thrown here
    assert.throws(() => Sphere(1.5).rotate(Y, 90).cut(Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)), (e: unknown) => e instanceof KernelError && /cut failed/.test(e.message))
  } finally {
    setGuardBooleans(old)
  }
})

test('fillets and chamfers of parts read from files run in the probe worker (N1)', () => {
  const made = Box(20, 20, 20).cut(Cylinder(4, 30))
  assert.equal(made._h.imported, false)
  const part = fromSmb(toSmb(made, { ascii: false })) as Part
  assert.equal(part._h.imported, true)
  const moved = part.cut(Box(4, 4, 30).translate(10, 10, 0)).translate(1, 2, 3)
  assert.equal(moved._h.imported, true) // (made from it)
  let rounded: Part | null = null
  let beveled: Part | null = null
  // (the fillet executive, lane FO: F8)
  const there = counting(ext, ['round_edges'], () => {
    rounded = moved.fillet(moved.edges().filter((e) => e.center().z > 11 && e.geomType === 'line'), 1)
    beveled = moved.chamfer(moved.edges().circles().filter((e) => e.center().z > 11), 0.5)
  })
  assert.equal(there.round_edges, 0)
  assert.ok(rounded!.isValid() && beveled!.isValid() && rounded!.volume < moved.volume && beveled!.volume < moved.volume)
  assert.equal(rounded!._h.imported, true)
  const own = made.translate(1, 2, 3).cut(Box(4, 4, 30).translate(11, 12, 3))
  let same = 0
  const here = counting(ext, ['round_edges'], () => {
    same = own.fillet(own.edges().filter((e) => e.center().z > 11 && e.geomType === 'line'), 1).volume
  })
  assert.equal(here.round_edges, 1) // (a part made here: in this kernel)
  assert.ok(Math.abs(same - rounded!.volume) < 1e-9 * same)
})

test('KernelWorker: a part read from a file stays one over there and back (N1)', async () => {
  const worker = new KernelWorker<typeof Models>(WORKER)
  try {
    const part = fromSmb(toSmb(Box(10, 10, 10), { ascii: false })) as Part
    const back = (await worker.call('echo', [part])) as Part
    assert.equal(back._h.imported, true)
    const own = (await worker.call('echo', [Box(10, 10, 10)])) as Part
    assert.equal(own._h.imported, false)
  } finally {
    worker.terminate()
  }
})

// ================================================================================ W9: scope() and the port's temporaries
test('memoryUsage().handles counts the kernel objects JavaScript holds (W9)', () => {
  const before = memoryUsage().handles
  const a = Box(10, 10, 10)
  const b = Cylinder(2, 20)
  assert.equal(memoryUsage().handles, before + 2)
  a.dispose()
  a.dispose() // (once)
  assert.equal(memoryUsage().handles, before + 1)
  b.dispose()
  assert.equal(memoryUsage().handles, before)
})

test('scope frees what its function made and does not return, at once (W9)', () => {
  const outside = Box(50, 50, 50)
  const regen = () => {
    const c = Box(30, 20, 10).cut(Cylinder(4, 20)) // (the box and the cylinder are never named)
    void outside.cut(Sphere(3)) // (a result nobody keeps)
    return c.fillet(c.edges().filter((e) => e.center().z > 4 && e.geomType === 'line'), 2)
  }
  const expected = regen().volume
  const before = memoryUsage()
  const part = scope(regen)
  assert.equal(memoryUsage().handles, before.handles + 1) // the result, nothing else
  assert.ok(part.isValid() && Math.abs(part.volume - expected) < 1e-9 * expected)
  assert.ok(outside.isValid()) // (made before the scope)
  part.dispose()
  assert.equal(memoryUsage().handles, before.handles)
})

test('scope keeps what its result reaches: arrays, ShapeLists, Maps, Sets, objects, faces (W9)', () => {
  const before = memoryUsage().handles
  const out = scope(() => {
    const a = Box(1, 1, 1)
    const b = Box(2, 2, 2)
    const c = Box(3, 3, 3)
    const d = Box(4, 4, 4)
    const e = Sphere(5)
    void Box(6, 6, 6) // (not returned)
    const edge = Line([0, 0, 0], [10, 0, 0]) // (a standalone curve)
    return { list: [a, new ShapeList(b)], map: new Map([['c', c]]), set: new Set([d]), face: e.faces()[0], edge }
  })
  assert.equal(memoryUsage().handles, before + 6)
  assert.ok(Math.abs(out.face.area - 4 * Math.PI * 25) < 1e-6 * 314 && out.face.owner!._h.alive)
  assert.equal((out.list[0] as Part).volume, 1)
  assert.ok(Math.abs(out.edge.length - 10) < 1e-12)
})

test('scopes nest; an error frees what the scope made; a promise is a TypeError (W9)', async () => {
  const before = memoryUsage().handles
  const kept = scope(() => {
    const inner = scope(() => {
      void Box(1, 1, 1)
      return Box(2, 2, 2)
    })
    assert.equal(memoryUsage().handles, before + 1) // (the inner result, now the outer scope's)
    void inner.translate(1, 0, 0)
    return Box(3, 3, 3)
  })
  assert.equal(memoryUsage().handles, before + 1) // the inner result was not returned by the outer scope
  kept.dispose()
  assert.throws(
    () =>
      scope(() => {
        Box(1, 1, 1).cut(Cylinder(1, 3))
        throw new RangeError('stop')
      }),
    { name: 'RangeError', message: 'stop' },
  )
  assert.equal(memoryUsage().handles, before)
  assert.throws(() => scope(async () => Box(1, 1, 1)), TypeError)
  assert.throws(() => scope(null as unknown as () => void), TypeError)
  // an object kept outside its scope's result is disposed: using it is a TypeError
  let leaked: Part | null = null
  scope(() => {
    leaked = Box(5, 5, 5)
    return null
  })
  assert.throws(() => leaked!.volume, (e: unknown) => e instanceof TypeError && /was disposed/.test((e as Error).message))
  await Promise.resolve()
})

test('a synchronous loop in scope() stays flat; disposing only the result did not (W9)', () => {
  // The finding's loop: the garbage collector frees kernel objects only between tasks, so 400
  // synchronous regenerations grew the module's memory from 64 to 191 MB, and to 133 MB when each
  // result was disposed (its box, cylinder and cut stayed until the loop ended).
  const regen = () => {
    const c = Box(30, 20, 10).cut(Cylinder(4, 20))
    return c.fillet(c.edges().filter((e) => e.center().z > 4 && e.geomType === 'line'), 2)
  }
  const before = memoryUsage()
  let total = 0
  for (let i = 0; i < 100; i++) total += scope(() => regen().volume)
  const after = memoryUsage()
  assert.equal(after.handles, before.handles)
  assert.ok(after.used - before.used < 512 * 1024, `${after.used - before.used} bytes kept`)
  assert.ok(Math.abs(total / 100 - regen().volume) < 1e-9)
  const held = memoryUsage().handles
  for (let i = 0; i < 20; i++) regen().dispose()
  assert.equal(memoryUsage().handles - held, 20 * 3) // (each: the box, the cylinder and the cut, until the garbage collector runs)
})

test('the port frees its own temporaries: sketches, Booleans it refused, split, cells, sweep, text (W9)', () => {
  const part = Box(40, 30, 20).cut(Cylinder(5, 40))
  const cases: [string, () => unknown][] = [
    ['Polygon', () => Polygon([0, 0], [10, 0], [5, 8])],
    ['Slot', () => Slot(20, 5)],
    ['Text', () => Text('Hi', 10)],
    ['split', () => part.split(Plane.XY)],
    ['split both', () => part.split(Plane.XY, 'both')],
    ['cells', () => part.merge(Box(10, 10, 10).translate(60, 0, 0)).cells()],
    ['sweep', () => sweep(Circle(1), Line([0, 0, 0], [0, 0, 10]))],
    ['empty cut', () => part.cut(Box(100, 100, 100))],
    ['cut, tools combined', () => part.cut(Cylinder(3, 40).translate(2, 0, 0), Cylinder(3, 40).translate(-2, 0, 0))],
  ]
  for (const [name, make] of cases) {
    make() // (warm up)
    const before = memoryUsage().handles
    const result = make()
    const made = memoryUsage().handles - before
    // what the result holds, and the operands the case makes itself (a box, its move and the merge; a circle and a line; a box; two cylinders and their moves)
    const own = { cells: 3, sweep: 2, 'empty cut': 1, 'cut, tools combined': 4 }[name] ?? 0
    const held = Array.isArray(result) ? result.length : 1
    assert.equal(made, held + own, `${name}: ${made} kernel objects for ${held} in the result and ${own} operands`)
  }
  void GridLocations
  void Z
})

// ================================================================================ N2: memory
test('sweeps, skins and offset profiles free the curves they hand the kernel (N2)', () => {
  // The kernel's sweeps, skins and offset profiles copy the curves they are given ("Pure" in
  // SmPyLib): the copies the port made for them were never freed (a revolve of a rectangle left its
  // four lines each call). Found by the leak check (tools/sanitize/run.py).
  const cases: [string, () => unknown, number][] = [
    ['revolve', () => Rectangle(5, 5).translate(10, 0).revolve(new Axis([0, 0, 0], [0, 1, 0])), 0],
    ['taper', () => Rectangle(10, 10).extrude(5, { taper: 5 }), 0],
    ['offset', () => Rectangle(10, 10).offset(1), 0],
    ['loft', () => loft([Rectangle(10, 10), Circle(4).moved(new Location([0, 0, 10]))]), 0],
    ['open extrude', () => extrude(Line([0, 0, 0], [10, 0, 0]), 5), 0],
    ['open revolve', () => revolve(Line([5, 0, 0], [5, 0, 10])), 0],
    // (the kernel's own sweep along a mitered path keeps its copies: tools/sanitize/leaks.txt)
    ['mitered sweep', () => sweep(Circle(1).on(Plane.YZ), Polyline([0, 0, 0], [20, 0, 0], [20, 20, 0])), 16000],
  ]
  for (const [name, make, limit] of cases) {
    scope(() => {
      make()
    })
    const before = memoryUsage().used
    for (let i = 0; i < 50; i++) {
      scope(() => {
        make()
      })
    }
    const perCall = (memoryUsage().used - before) / 50
    assert.ok(perCall <= limit, `${name}: ${perCall} bytes a call`)
  }
})

// ================================================================================ N3: the fuzz runner
test('the fuzz run\'s WebAssembly runner runs cases and says what each operation gave (N3)', () => {
  // tools/fuzz/run_wasm.ts runs the cases of a fuzz run in smlibwasm, with the parameters the
  // smlibpy run resolved, one JSON line per operation; the driver (run_wasm.py) compares them.
  const dir = mkdtempSync(join(tmpdir(), 'fuzz-'))
  const cases = [
    { id: 'csg-0-1', kind: 'csg', A: ['box', 20, 20, 20], B: ['tr', ['cyl', 4, 30], 5, 0, 0] },
    { id: 'slice-0-2', kind: 'slice', base: ['cut', ['box', 10, 10, 10], ['sph', 4]], axis: 'Z', at: 1.5, tilt: 30 },
    { id: 'offset-0-3', kind: 'offset', base: ['box', 10, 10, 10], frac: 0.1 },
  ]
  writeFileSync(join(dir, 'cases.json'), JSON.stringify(cases))
  writeFileSync(join(dir, 'resolved.json'), JSON.stringify({ 'offset-0-3': { d: 0.5 } }))
  const runner = fileURLToPath(new URL('../../tools/fuzz/run_wasm.ts', import.meta.url))
  const out = spawnSync(process.execPath, [runner, join(dir, 'cases.json'), join(dir, 'resolved.json'), '0'], { encoding: 'utf8', timeout: 120_000 })
  assert.equal(out.status, 0, out.stderr)
  const lines = out.stdout.trim().split('\n').map((l) => JSON.parse(l))
  const recs: Record<string, Record<string, Record<string, unknown>>> = {}
  for (const m of lines) if (m.rec && !m.rec.start) (recs[m.id] ??= {})[m.rec.op] = m.rec
  assert.deepEqual(lines.filter((m) => m.case_done).map((m) => m.id), ['csg-0-1', 'slice-0-2', 'offset-0-3'])
  const csg = recs['csg-0-1']
  assert.ok(Math.abs((csg.D.v as number) - (8000 - Math.PI * 16 * 20)) < 1e-6 && csg.M.ncells === 4)
  assert.ok(Math.abs((csg.U.v as number) + (csg.I.v as number) - (csg.A.v as number) - (csg.B.v as number)) < 1e-6)
  const sl = recs['slice-0-2']
  assert.ok(Math.abs((sl.above.v as number) + (sl.below.v as number) - (sl.base.v as number)) < 1e-6 * 1000)
  const off = recs['offset-0-3']
  // (the offset of a box extends its faces: sharp edges; and back again the box)
  assert.ok(off.O.ok && off.O2.ok && Math.abs((off.O.v as number) - 11 ** 3) < 1e-6 && Math.abs((off.O2.v as number) - 1000) < 1e-6)
})

test('cells() of a merge that crashes the kernel\'s stitcher throw (N1)', () => {
  // Found by the fuzz run (seed 20261022, case csg-153): the stitcher behind cells() reads a null
  // polar box (SmBezierAux2d::BuildPolarBox) on this merge; smlibwasm trapped. It runs in the probe
  // worker now, and the kernel the call runs on is left alone.
  // Part.merge turns the cylinder about its axis now (lane BT: B6, its seam ran along the cone): the
  // right merge (OpenCASCADE: 150.26185), whose cells come apart. The kernel's own merge, as before,
  // still crashes the stitcher.
  const a = Cone(3, 0, 4).rotate(X, 90)
  const b = Cylinder(1.5, 16).rotate(Y, 90).translate(-5, 0, 3)
  assert.ok(Math.abs(a.merge(b).volume - 150.26185413540605) < 1e-6)
  const m = Part._wrap(k.non_manifold_boolean(a._copyBrep(), b._copyBrep(), { operation: k.BooleanOp.MERGE }))
  // (smlibpy's raw merge holds 149.19267, this one 145.98511: a divergence the fuzz run lists too)
  assert.ok(m.volume > 113.0973 && m.volume < 150.7964)
  assert.throws(() => m.cells(), (e: unknown) => e instanceof KernelError && /cells failed/.test(e.message) && /the kernel crashed/.test(e.detail))
  assert.ok(Math.abs(Box(30, 20, 10).cut(Cylinder(4, 20)).volume - 5497.3452) < 1e-3) // (this kernel goes on)
})

test('steps stopped after the time limit say so (N1)', () => {
  // Fillets and chamfers of parts read from files run in the probe worker, stopped after
  // setGuardSeconds. They threw "fillet failed: the radius may be too large for the selected edges",
  // the time limit only in .detail, and tried again with the finer tolerance.
  const holes = []
  for (const x of [-20, 0, 20]) for (const y of [-20, 0, 20]) holes.push(Cylinder(2, 20).translate(x, y, 0))
  const part = fromStep(toStep(Box(60, 60, 10).cut(holes))) as Part
  const guard = setGuardSeconds(0.01)
  try {
    const started = performance.now()
    assert.throws(() => part.fillet(part.edges().filter((e) => e.center().z > 4.9), 0.5),
      (e: unknown) => e instanceof ModelingError && !(e instanceof KernelError) && /^fillet: the kernel did not finish within 0.01 s; setGuardSeconds/.test(e.message))
    assert.ok(performance.now() - started < 5000)
  } finally {
    setGuardSeconds(guard)
  }
})

// ================================================================================ W10: crashes of the kernel
/** A real trap of the kernel: a read far beyond its memory (harmless: nothing is written). */
const TRAP = 'k.brep_face_count(0xf0000000)'

test('a crash of the kernel is counted, warns once, and its KernelError says so before the operation\'s hint (W10)', () => {
  const out = run(`
    import { k, kernelCall, memoryUsage, setWarningHandler, KernelError } from ${JSON.stringify(new URL('kernel.ts', SRC).href)}
    const warnings = []
    setWarningHandler((m) => warnings.push(m))
    const out = { before: memoryUsage().crashes }
    try { ${TRAP} } catch (e) { out.raw = [e.constructor.name, e.message] }
    out.after = memoryUsage().crashes
    try { kernelCall('measure', () => ${TRAP}, 'is the part valid?') } catch (e) {
      out.error = [e instanceof KernelError, e.status, e.detail, e.message, e.cause instanceof WebAssembly.RuntimeError]
    }
    out.crashes = memoryUsage().crashes
    out.warnings = warnings
    out.volume = k.brep_face_count(k.create_box([0, 0, 0], 1, 2, 3)) // (the module answers)
    console.log(JSON.stringify(out))`)
  assert.equal(out.before, 0)
  assert.deepEqual(out.raw, ['RuntimeError', 'memory access out of bounds'])
  assert.equal(out.after, 1)
  assert.equal(out.crashes, 2)
  assert.deepEqual(out.error, [
    true,
    null,
    'the kernel crashed (memory access out of bounds)',
    'measure failed: the kernel crashed (memory access out of bounds), and its memory may be damaged: load the module again before relying on its results (a KernelWorker does so by itself); is the part valid?',
    true,
  ])
  // one warning, at the first crash, naming the kernel call
  assert.deepEqual(out.warnings, [
    'the kernel crashed in brep_face_count (memory access out of bounds), and its memory may be damaged: load the module again (reload the page) before relying on what it computes, or run the modeling in a KernelWorker, which starts a new kernel after a crash',
  ])
  assert.equal(out.volume, 6)
})

test('shell and offset stop at a crash of the kernel, also one in a check of a result (W10)', () => {
  const out = run(`
    import { Box, setGuardSeconds, setWarningHandler, KernelError, memoryUsage } from ${JSON.stringify(new URL('index.ts', SRC).href)}
    import { k, kernelCall } from ${JSON.stringify(new URL('kernel.ts', SRC).href)}
    setWarningHandler(() => {})
    setGuardSeconds(0)
    const box = Box(20, 20, 20)
    const out = { tried: [] }
    // an attempt that crashes: the next one does not run (it would run on the memory the crash left)
    const crashing = (mode) => () => { out.tried.push(mode); return kernelCall('shell', () => ${TRAP}) }
    try { box._checked('shell', [[false, crashing('plain')], [true, crashing('extended')]], { grow: 0, smaller: true }) } catch (e) {
      out.attempt = [e instanceof KernelError, e.detail]
    }
    // a check that meets a crash (and takes it for a refusal): the result is not kept, the crash is the error
    const made = []
    const fine = () => { const p = Box(19, 19, 19); made.push(p); return p }
    const check = () => { try { ${TRAP} } catch {} ; return 'checked' }
    try { box._checked('offset', [[true, fine], [true, fine]], { grow: 0, smaller: null, problem: check, hint: 'try a smaller value' }) } catch (e) {
      out.check = [e instanceof KernelError, e.detail, /^offset failed: the kernel crashed \\(memory access out of bounds\\).*; try a smaller value$/.test(e.message)]
    }
    out.made = made.length
    out.disposed = made.every((p) => !p._h.alive)
    out.crashes = memoryUsage().crashes
    console.log(JSON.stringify(out))`)
  assert.deepEqual(out.tried, ['plain'])
  assert.deepEqual(out.attempt, [true, 'the kernel crashed (memory access out of bounds)'])
  assert.deepEqual(out.check, [true, 'the kernel crashed (memory access out of bounds)', true])
  assert.equal(out.made, 1)
  assert.equal(out.disposed, true)
  assert.equal(out.crashes, 2)
})

test('removeFillets and removeFaces end at a crash of the kernel they run on, rather than try the next step on it (W10)', () => {
  const out = run(`
    import { Box, Cylinder, Z, setGuardSeconds, setWarningHandler, ModelingError, memoryUsage } from ${JSON.stringify(new URL('index.ts', SRC).href)}
    import { k } from ${JSON.stringify(new URL('kernel.ts', SRC).href)}
    setWarningHandler(() => {})
    setGuardSeconds(0) // (as on a browser's main thread: the steps run in this kernel)
    const box = Box(30, 20, 10)
    const rounded = box.fillet(box.edges().parallelTo(Z), 2)
    const holed = box.cut(Cylinder(3, 10))
    const out = {}
    const removal = k.defeature.remove_fillet_faces
    const executive = k.defeature.defeature
    k.defeature.remove_fillet_faces = () => ${TRAP}
    k.defeature.defeature = () => ${TRAP}
    for (const [name, run] of [['removeFillets', () => rounded.removeFillets()], ['partial', () => rounded.removeFillets(null, { partial: true })], ['removeFaces', () => holed.removeFaces(holed.faces().filter((f) => f.geomType === 'cylinder'))]]) {
      const before = memoryUsage().crashes
      try { run(); out[name] = 'no error' } catch (e) {
        out[name] = [e instanceof ModelingError, e.name, e.here, e.message, memoryUsage().crashes - before]
      }
    }
    k.defeature.remove_fillet_faces = removal
    k.defeature.defeature = executive
    out.after = [Math.round(rounded.removeFillets().volume), Math.round(holed.removeFaces(holed.faces().filter((f) => f.geomType === 'cylinder')).volume)]
    console.log(JSON.stringify(out))`)
  const said = 'the kernel crashed (memory access out of bounds); its memory may be damaged: load the module again before relying on its results, or run the step in a KernelWorker, which starts a new kernel after a crash'
  // (one crash each: the operation ends there; before, the step was dropped and the next one tried)
  assert.deepEqual(out.removeFillets, [true, '_KernelFault', true, `removeFillets: ${said}`, 1])
  assert.deepEqual(out.partial, [true, '_KernelFault', true, `removeFillets: ${said}`, 1])
  assert.deepEqual(out.removeFaces, [true, '_KernelFault', true, `removeFaces: ${said}`, 1])
  assert.deepEqual(out.after, [6000, 6000])
})

test('KernelWorker: a worker whose kernel crashed is replaced, also where the function caught the error (W10)', async () => {
  const cad = worker()
  try {
    const first = await cad.call('thread', [])
    assert.equal(await cad.call('crashes', []), 0)
    // the function goes on after the crash, and its result comes back; the next call gets a new kernel
    assert.equal(await cad.call('caughtCrash', []), 1)
    const second = await cad.call('thread', [])
    assert.notEqual(second, first)
    assert.equal(await cad.call('crashes', []), 0)
    // a crash that ends the call: its KernelError says so, and the next call gets a new kernel too
    await assert.rejects(cad.call('fail', ['kernel']), KernelError)
    assert.equal(await cad.call('thread', []), second) // (an error of the kernel as usual: the same one)
  } finally {
    cad.terminate()
  }
})

// ================================================================================ W11, W12: typings, the API reference
const JS = fileURLToPath(new URL('../', import.meta.url))
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

/** The package's declarations as an app gets them (npm run build makes the same in dist): emitted
 * from src, then made public by scripts/declarations.mjs, in a directory of their own. */
let _declarations: string | null = null
function declarations(): string {
  if (_declarations !== null) return _declarations
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-dts-'))
  const emit = spawnSync(process.execPath, [TSC, '-p', join(JS, 'tsconfig.build.json'), '--outDir', join(dir, 'dts'), '--emitDeclarationOnly'], { encoding: 'utf8' })
  assert.equal(emit.status, 0, emit.stdout + emit.stderr)
  const made = spawnSync(process.execPath, [join(JS, 'scripts/declarations.mjs'), join(dir, 'dts')], { encoding: 'utf8' })
  assert.equal(made.status, 0, made.stdout + made.stderr)
  _declarations = dir
  return dir
}

test('an app type-checks against the declarations without Node\'s types or skipLibCheck, and its types catch mistakes (W11)', () => {
  const dir = declarations()
  // what an app writes: the free functions give what their input makes, options and selections
  // have types, and each @ts-expect-error must meet an error (tsc fails on one that does not)
  writeFileSync(join(dir, 'app.ts'), `
    import { Box, Circle, Cylinder, Helix, Plane, Rectangle, Z, chamfer, extrude, fillet, htmlPage, load, loft, memoryUsage, offset, render, revolve, split, sweep, toGlb, toStep, toSvg, type FoldOptions, type RenderOptions } from './dts/index.js'
    import { KernelWorker } from './dts/worker.js'
    const part = Box(30, 20, 10).cut(Cylinder(4, 20))
    const volumes: number[] = [
      extrude(Rectangle(10, 5), 3).volume,
      revolve(Rectangle(10, 5).translate(20, 0, 0), null, 90).volume,
      loft([Circle(5), Circle(3).translate(0, 0, 10)]).volume,
      sweep(Circle(1), Helix(10, 30, 5)).volume,
      fillet(part.edges().parallelTo(Z), 1).volume,
      chamfer(part.edges().parallelTo(Z), 1).volume,
      offset(part, 1).volume,
      split(part, Plane.XY).volume,
      ...split(part, Plane.XY, 'both').map((p) => p.volume),
    ]
    const area: number = fillet(Rectangle(10, 5).vertices(), 1).area + offset(Rectangle(10, 5), 1).area
    const options: RenderOptions = { view: 'top', size: [100, 100], markers: [[[0, 0, 5], 'top']], sheet: ['top', 'iso'] }
    render(part, part.edges(), options)
    render(part, { zebra: { stripes: 8 }, curvature: 'mean', section: Plane.XZ })
    htmlPage(part, { title: 'a part' })
    toStep([part, [part]])
    toGlb(new Set([part]))
    const loaded = load('part.step')
    const kind: string = part.raycast([-20, 0, 0], [1, 0, 0])[0].face.geomType
    const crashes: number = memoryUsage().crashes
    using box = Box(1, 1, 1)
    const cad = new KernelWorker(new URL('file:///worker.js'))
    // @ts-expect-error a misspelt option
    render(part, { veiw: 'top' })
    // @ts-expect-error an option of the wrong type
    render(part, { size: 'large' })
    // @ts-expect-error a number is no shape
    toStep(3)
    // @ts-expect-error a string is no list of shapes
    htmlPage('part')
    // @ts-expect-error fillet takes edges
    part.fillet(3, 1)
    // @ts-expect-error removeFaces takes faces
    part.removeFaces(part.edges())
    // @ts-expect-error what a part is made of inside is not part of its type
    part._brep
    // @ts-expect-error Python's spelling of an option
    const fold: FoldOptions = { radius: 1, k_factor: 0.3 }
    // (the APIs added in parallel for 0.5.0 say what they take too)
    // @ts-expect-error moveFaces takes faces
    part.moveFaces(42, [0, 0, 1])
    // @ts-expect-error the faces of colored are faces, not a word
    part.colored('red', { faces: 'top' })
    // @ts-expect-error toSvg draws shapes
    toSvg(123)
    // @ts-expect-error a region is a sketch, face, wire or points
    part.warp(part.faces()[0], 5, 1)
    // @ts-expect-error iso takes its parameter by name
    part.faces()[0].iso(0.5)
    const near: number = part.closestPoints(Box(1, 1, 1)).face?.area ?? 0
    export { volumes, area, loaded, kind, crashes, box, cad, fold, near }
  `)
  // (an app for the browser: no Node types, an older lib, and the package's declarations checked)
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'es2022', lib: ['es2022', 'dom'], module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: false, types: [] },
    files: ['app.ts'],
  }))
  const out = spawnSync(process.execPath, [TSC, '-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' })
  assert.equal(out.stdout + out.stderr, '')
  assert.equal(out.status, 0)
  // the declarations name no module of Node's and no internal member
  const shapes = readFileSync(join(dir, 'dts/shapes.d.ts'), 'utf8')
  for (const f of readdirSync(join(dir, 'dts'))) assert.ok(!/['"]node:/.test(readFileSync(join(dir, 'dts', f), 'utf8')), f)
  assert.ok(!/\b_brep\b|_like\(|_ownFaces/.test(shapes))
  assert.match(shapes, /^\/\/\/ <reference lib="esnext.disposable" \/>/)
})

test('the API reference shows what every body has as members of Part, Shell and Sketch (W12)', () => {
  const dir = declarations()
  const page = join(dir, 'javascript.md')
  writeFileSync(page, readFileSync(join(JS, '../docs/javascript.md'), 'utf8'))
  const api = spawnSync(process.execPath, [join(JS, 'scripts/api.mjs'), join(dir, 'dts'), page], { encoding: 'utf8' })
  assert.equal(api.status, 0, api.stdout + api.stderr)
  const section = readFileSync(page, 'utf8').split('\n## API\n')[1]
  // (the section's code is TypeScript: the members of each class it shows)
  const code = [...section.matchAll(/```ts\n([^]*?)```/g)].map((m) => m[1]).join('\n')
  const shown = new Map<string, Set<string>>()
  const file = ts.createSourceFile('api.ts', code, ts.ScriptTarget.Latest, true)
  for (const st of file.statements) {
    if (ts.isClassDeclaration(st) && st.name) shown.set(st.name.text, new Set(st.members.map((m) => (m.name ? m.name.getText(file) : 'constructor'))))
  }
  // what the declarations give each body: its own members and those of the internal _Body
  const dts = ts.createSourceFile('shapes.d.ts', readFileSync(join(dir, 'dts/shapes.d.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const body = dts.statements.find((st) => ts.isClassDeclaration(st) && st.name?.text === '_Body') as ts.ClassDeclaration
  const isPrivate = (m: ts.ClassElement) => ts.getCombinedModifierFlags(m as ts.Declaration) & ts.ModifierFlags.Private
  const inherited = body.members.filter((m) => m.name && !ts.isComputedPropertyName(m.name) && !isPrivate(m) && !ts.isConstructorDeclaration(m)).map((m) => m.name!.getText(dts))
  for (const name of ['dispose', 'named', 'colored', 'raycast', 'closestPoint', 'heal', 'bbox', 'vertices', 'info']) assert.ok(inherited.includes(name), name)
  for (const cls of ['Part', 'Shell', 'Sketch']) {
    const members = shown.get(cls)
    assert.ok(members, `${cls} is in the API section`)
    // (Sketch shows Shell's in Shell, which it extends)
    if (cls !== 'Sketch') for (const name of inherited) assert.ok(members.has(name), `${cls}.${name} is missing`)
  }
  assert.match(code, /export class Part extends Shape \{/)
  assert.match(code, /export class Sketch extends Shell \{/)
  // no internal name, and no constructor that only the package calls (new Face(owner, kface))
  assert.ok(!/\b_[A-Za-z]\w*/.test(code), code.match(/.*\b_[A-Za-z]\w*.*/)?.[0])
  for (const cls of ['Face', 'Edge']) assert.ok(!shown.get(cls)?.has('constructor'), cls)
  assert.ok(shown.get('Wire')?.has('constructor'))
})

// ================================================================================ W13: fonts in the browser too
const FONTS = new URL('../../tests/data/', import.meta.url)
const fontFile = (name: string) => new Uint8Array(readFileSync(new URL(name, FONTS)))

test('the Brotli decoder decodes the reference encoder\'s streams, and refuses damaged ones (W13)', async () => {
  const { BrotliError, decompress } = await import('../src/_brotli.ts')
  const { createHash } = await import('node:crypto')
  const { vectors } = JSON.parse(readFileSync(new URL('brotli-vectors.json', FONTS), 'utf8'))
  assert.equal(vectors.length, 13)
  for (const v of vectors) {
    const data = Uint8Array.from(Buffer.from(v.brotli, 'base64'))
    if (v.error) {
      assert.throws(() => decompress(data), BrotliError, v.name)
      continue
    }
    const out = decompress(data)
    assert.deepEqual([out.length, createHash('sha256').update(out).digest('hex')], [v.length, v.sha256], v.name)
  }
  const named = (name: string) => Uint8Array.from(Buffer.from(vectors.find((v: { name: string }) => v.name === name).brotli, 'base64'))
  assert.throws(() => decompress(named('cut short')), { name: 'BrotliError', message: 'the data ends early' })
  assert.throws(() => decompress(named('padding bits that are not zero')), { message: 'padding bits that are not zero' })
  assert.ok(new BrotliError('x') instanceof RangeError) // (Python's ValueError)
  // and the same as node's own decoder on what it encodes: text with the dictionary's words, binary data
  const zlib = await import('node:zlib')
  const words = Buffer.from('The Time of the Code: data, life and work. '.repeat(50) + 'ÜBER ÇA '.repeat(20))
  for (const quality of [1, 5, 11]) {
    const br = zlib.brotliCompressSync(words, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } })
    assert.deepEqual(Buffer.from(decompress(br)), words)
  }
})

test('damaged Brotli streams fail as BrotliErrors: every bit flipped, every length cut (W13)', async () => {
  const { BrotliError, decompress } = await import('../src/_brotli.ts')
  const { vectors } = JSON.parse(readFileSync(new URL('brotli-vectors.json', FONTS), 'utf8'))
  const data = Uint8Array.from(Buffer.from(vectors.find((v: { name: string }) => v.name.startsWith('text: dictionary')).brotli, 'base64'))
  let errors = 0
  for (let i = 0; i < data.length * 8; i++) {
    const damaged = data.slice()
    damaged[i >> 3] ^= 1 << (i & 7)
    for (const d of [damaged, data.subarray(0, i >> 3)]) {
      try {
        decompress(d)
      } catch (e) {
        assert.ok(e instanceof BrotliError, String(e))
        errors++
      }
    }
  }
  assert.ok(errors > 0)
})

test('inflate is zlib\'s, its errors too; the Brotli dictionary is RFC 7932\'s, as smlibpy has it (W13)', async () => {
  const { inflate, ZlibError } = await import('../src/_inflate.ts')
  const { _words } = await import('../src/_brotli.ts')
  const zlib = await import('node:zlib')
  const data = Buffer.concat([readFileSync(new URL('test-quadratic.ttf', FONTS)), Buffer.from('abc'.repeat(1000))])
  for (const level of [0, 1, 9]) {
    for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY]) {
      assert.deepEqual(Buffer.from(inflate(zlib.deflateSync(data, { level, strategy }))), data)
    }
  }
  const z = zlib.deflateSync(data)
  assert.throws(() => inflate(z.subarray(0, z.length - 10)), ZlibError)
  const bad = Buffer.from(z)
  bad[bad.length - 1] ^= 1 // (the checksum)
  assert.throws(() => inflate(bad), { name: 'ZlibError', message: 'incorrect data check' })
  assert.throws(() => inflate(Uint8Array.of(0x78, 0x00, 0, 0)), { message: 'incorrect header check' })
  // the dictionary: what smlibpy reads from src/smlibpy/_brotli_dictionary.bin
  const { createHash } = await import('node:crypto')
  const words = _words()
  assert.equal(words.length, 122784)
  assert.equal(createHash('sha256').update(words).digest('hex'), '20e42eb1b511c21806d4d227d07e5dd06877d8ce7b3a817f378f313653f35c70')
  assert.deepEqual(Buffer.from(words), readFileSync(new URL('../../src/smlibpy/_brotli_dictionary.bin', import.meta.url)))
})

test('WOFF2 fonts read as the fonts they hold: transformed glyf, loca and hmtx tables, CFF (W13)', async () => {
  const { Font } = await import('../src/font.ts')
  const ttf = new Font(fontFile('test-quadratic.ttf'))
  const otf = new Font(fontFile('test-cubic.otf'))
  for (const [name, ref] of [['test-quadratic.woff2', ttf], ['test-quadratic-plain.woff2', ttf], ['test-cubic.woff2', otf]] as const) {
    const f = new Font(fontFile(name))
    assert.deepEqual([f.name, f.unitsPerEm, f.numGlyphs, f.capHeight], [ref.name, ref.unitsPerEm, ref.numGlyphs, ref.capHeight])
    assert.deepEqual(f.characters(), ref.characters())
    for (let g = 0; g < ref.numGlyphs; g++) {
      assert.equal(f.advance(g), ref.advance(g))
      assert.deepEqual(f.outline(g), ref.outline(g), `${name} ${g}`)
    }
    assert.equal(f.kerningSource, ref.kerningSource)
  }
  const woff2 = new Font(fontFile('test-quadratic.woff2'))
  assert.equal(woff2.kerning(ttf.glyphIndex('H') as number, ttf.glyphIndex('O') as number).advance1, -50)
  approx(Text('HOX', 10, { font: fontFile('test-quadratic.woff2') }).area, Text('HOX', 10, { font: fontFile('test-quadratic.ttf') }).area, 1e-12)
})

test('damaged WOFF and WOFF2 files are FontErrors (W13)', async () => {
  const { Font, FontError } = await import('../src/font.ts')
  const data = fontFile('test-quadratic.woff2')
  const flipped = data.slice()
  flipped[60] ^= 0xff
  for (const damaged of [data.subarray(0, 200), flipped, data.subarray(0, 48)]) {
    assert.throws(() => new Font(damaged), (e: unknown) => e instanceof FontError && e.message.startsWith('font data: a damaged WOFF2 file ('))
  }
  // a WOFF table whose zlib data is damaged
  const woff = fontFile('test-quadratic.woff')
  const dv = new DataView(woff.buffer, woff.byteOffset, woff.byteLength)
  for (let i = 0; i < dv.getUint16(12); i++) {
    const rec = 44 + 20 * i
    if (dv.getUint32(rec + 8) < dv.getUint32(rec + 12)) {
      woff[dv.getUint32(rec + 4) + 2] ^= 0xff
      break
    }
  }
  assert.throws(() => new Font(woff), (e: unknown) => e instanceof FontError && /damaged WOFF table/.test(e.message))
})

test('seac accents are their base and accent glyphs; CFF2 fonts draw their default instance (W13)', async () => {
  const { Font } = await import('../src/font.ts')
  const f = new Font(fontFile('test-seac.otf'))
  const g = (c: string) => f.glyphIndex(c) as number
  const moved = (contours: ReturnType<typeof f.outline>, dx: number, dy: number) => contours.map((c) => c.map((seg) => seg.map(([x, y]) => [x + dx, y + dy])))
  assert.deepEqual(f.outline(g('À')), [...f.outline(g('A')), ...moved(f.outline(g('`')), 300, 750)])
  assert.deepEqual(f.outline(g('Ã')), [...f.outline(g('A')), ...moved(f.outline(g('~')), 250, 760)])
  const t = Text('ÀÃ', 700, { font: fontFile('test-seac.otf'), align: null })
  assert.equal(t.faces().length, 4)
  approx(t.area, 2 * 600 * 700 + 100 * 100 + 200 * 80, 1e-12)
  // CFF2: blends with two item variation data (vsindex); its 400 master is test-cubic.otf's glyphs
  const v = new Font(fontFile('test-variable.otf'))
  const c = new Font(fontFile('test-cubic.otf'))
  assert.ok(v._tables.has('CFF2') && v._outlines.constructor.name === '_CFF2Outlines')
  for (const ch of 'HOS') assert.deepEqual(v.outline(v.glyphIndex(ch) as number), c.outline(c.glyphIndex(ch) as number), ch)
  approx(Text('HOS', 700, { font: fontFile('test-variable.otf'), align: null }).area, Text('HOS', 700, { font: fontFile('test-cubic.otf'), align: null }).area, 1e-12)
})

// ================================================================================ W14: files in memory
test('every reader of files in memory takes an ArrayBuffer and any view of one (W14)', async () => {
  const { fromStep, toStep, fromStl, toStl, fromDxf, fromDxfWires, toDxf, fromUsd, toUsd, loadFont, Font } = await import('../src/index.ts')
  const ab = (bytes: Uint8Array | string) => {
    const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
  const part = Box(10, 20, 30)
  approx((fromStep(ab(toStep(part))) as Part).volume, 6000, 1e-9)
  approx((fromStep(new DataView(ab(toStep(part)))) as Part).volume, 6000, 1e-9)
  assert.equal(fromStl(ab(toStl(part))).triangles.length / 3, 12)
  approx((fromSmb(ab(toSmb(part))) as Part).volume, 6000, 1e-9)
  approx((fromUsd(ab(toUsd(part))) as Part).volume, 6000, 1e-9)
  const dxf = toDxf(Rectangle(10, 20))
  approx(fromDxf(ab(dxf)).area, 200, 1e-9)
  approx(fromDxf(new Uint16Array(ab(dxf.padEnd(dxf.length + (dxf.length % 2), '\n')))).area, 200, 1e-9) // (a view of other elements)
  assert.equal(fromDxfWires(ab(dxf)).length, 1)
  // fonts: the bytes as an ArrayBuffer, read once per buffer
  const buffer = ab(fontFile('test-quadratic.woff2'))
  const font = loadFont(buffer)
  assert.ok(font instanceof Font && loadFont(buffer) === font)
  assert.equal(new Font(new DataView(buffer)).name, 'Smlibpy Test Quadratic')
  // what is no bytes says so
  assert.throws(() => fromDxf(42 as never), { name: 'TypeError', message: 'fromDxf reads a DXF drawing as a string or bytes (a Uint8Array or an ArrayBuffer), not number' })
  assert.throws(() => fromStl({} as never), { name: 'TypeError', message: /fromStl takes the file's contents: a string or bytes/ })
  assert.throws(() => fromStep(null as never), { name: 'TypeError', message: /fromStep takes the file's contents/ })
  assert.throws(() => loadFont(3 as never), { name: 'TypeError', message: /^a font is a file path or the file's bytes \(a Uint8Array or an ArrayBuffer\), not / })
})

test('Text takes a Font that loadFont read (W14)', async () => {
  const { loadFont } = await import('../src/index.ts')
  const f = loadFont(fontFile('test-quadratic.woff2'))
  approx(Text('H', 700, { font: f, align: null }).area, 600 * 700, 1e-12)
  assert.throws(() => Text('Z', 10, { font: f }), { name: 'RangeError', message: /has no glyph for 'Z'/ })
})

test('fromFile and toFile: load and exportFile of files in memory, the format by the name (W14)', async () => {
  const { fromFile, toFile } = await import('../src/index.ts')
  const part = Box(10, 20, 30).cut(Cylinder(3, 40))
  const volume = part.volume
  for (const name of ['part.step', 'PART.STP', 'part.stl', 'part.smb', 'part.usda', 'dir/part.usd']) {
    const data = toFile(part, name)
    assert.equal(typeof data === 'string', !/\.(stl|smb)$/i.test(name), name)
    const back = fromFile(data, name)
    if (back instanceof Mesh) assert.ok(back.triangles.length > 0)
    else approx((back as Part).volume, volume, 1e-6)
    // and bytes of a text file read too
    if (typeof data === 'string') approx((fromFile(new TextEncoder().encode(data), name) as Part).volume, volume, 1e-6)
  }
  assert.ok(toFile(part, 'part.glb') instanceof Uint8Array)
  assert.equal(typeof toFile(part, 'part.gltf'), 'string')
  assert.match(toFile(part, 'part.obj') as string, /^v /m)
  approx((fromFile(toFile(Rectangle(10, 20), 'r.dxf'), 'R.DXF') as Sketch).area, 200, 1e-9)
  assert.equal((toFile(part, 'a.stl', { ascii: true }) as Uint8Array).subarray(0, 5).toString(), '115,111,108,105,100') // "solid"
  assert.throws(() => fromFile('x', 'a.txt'), { name: 'RangeError', message: "unknown file type '.txt'; fromFile reads .step, .stp, .igs, .iges, .stl, .smb, .smp, .dxf, .usda and .brep" })
  assert.throws(() => toFile(part, 'a.usdz'), { name: 'RangeError', message: 'toFile writes text USD (.usda, .usd), not .usdz' })
  assert.throws(() => toFile(part, 'a'), { name: 'RangeError', message: /unknown file type ''/ })
  assert.throws(() => toFile(part, 'a.stl', { asci: true }), { name: 'TypeError', message: /toStl\(\) got an unexpected option 'asci'/ })
})

// ================================================================================ W15: the raw kernel layer
// smlibpy._core's functions (Python: sorted(n for n in dir(_core) if a builtin function))
const CORE_FUNCTIONS = ['boolean', 'boolean_2d', 'boolean_difference', 'boolean_intersection', 'boolean_lists', 'boolean_merge', 'boolean_union', 'boolean_with_curves', 'boolean_with_options', 'brep_bounding_box', 'brep_closest_point', 'brep_closest_point_all', 'brep_copy', 'brep_distance', 'brep_relationship', 'chamfer_fillet', 'circular_fillet', 'compute_volume', 'convert_to_lines_and_arcs', 'create_arc', 'create_blend_primitive', 'create_box', 'create_canonical_curve', 'create_circle', 'create_cone', 'create_cone_elliptic_ends', 'create_curve', 'create_curve_approx_points', 'create_curve_interp_points', 'create_cylinder', 'create_cylindrical_box', 'create_ellipse', 'create_extrude_surface', 'create_helix', 'create_line', 'create_line_segment', 'create_offset_profile', 'create_offset_surface', 'create_partial_cone', 'create_partial_cylinder', 'create_partial_sphere', 'create_partial_torus', 'create_planar_circle', 'create_planar_faces', 'create_plane', 'create_pyramid', 'create_rectangle', 'create_regular_polygon', 'create_ruled_surface', 'create_silhouette_curves', 'create_skin_from_faces', 'create_skin_primitive', 'create_skin_surface', 'create_sphere', 'create_sphere_no_pole', 'create_surface_from_corner_points', 'create_surface_from_ordered_points', 'create_surface_from_points', 'create_surface_from_random_points', 'create_surface_revolution', 'create_sweep_surface', 'create_swung_primitive', 'create_torus', 'curve_closest_point', 'curve_closest_point_all', 'curve_sweep', 'curve_sweep_from_edges', 'curve_sweep_from_faces', 'cut', 'draft_sweep', 'drop_curve_to_surface', 'edge_bounding_box', 'edge_length', 'evaluate_continuity', 'evaluate_csg_tree', 'evaluate_curve', 'evaluate_surface_derivatives', 'evaluate_surface_normal', 'evaluate_surface_point', 'face_area', 'face_bounding_box', 'fillet_edges', 'fillet_edges_per_edge', 'fillet_preview', 'find_edge', 'find_face', 'get_closest_point', 'get_edges_via_api', 'get_faces_via_api', 'heal_brep', 'intersect_brep_with_plane', 'intersect_breps', 'intersect_curve_brep', 'intersect_curve_face', 'intersect_curve_surface', 'intersect_curves', 'intersect_faces', 'intersect_surfaces', 'is_manifold_solid', 'lift_uv_curve', 'linear_sweep', 'linear_sweep_with_repetitions', 'make_curves_compatible', 'material_census', 'merge_breps', 'non_manifold_boolean', 'non_manifold_linear_sweep', 'non_manifold_rotational_sweep', 'offset_brep', 'offset_curve', 'order_curves', 'piecewise_merge', 'pipe_sweep', 'poly_boolean', 'poly_boolean_difference', 'poly_boolean_intersection', 'poly_boolean_merge', 'poly_boolean_union', 'poly_brep_is_manifold_via_api', 'poly_brep_volume_via_api', 'project_and_trim', 'project_brep_onto_plane', 'project_curve', 'project_curve_to_surface', 'read_brep_from_file', 'read_part_from_file', 'remove_curve_knots', 'remove_fillet', 'rotate', 'rotational_sweep', 'rotational_sweep_with_repetitions', 'scale', 'scale_about_point', 'set_bevel_corners', 'shell_brep', 'simple_face_stitch', 'stitch_advanced', 'stitch_brep', 'stitch_brep_with_face', 'stitch_into_shell', 'stitch_into_solid', 'surface_closest_point', 'surface_surface_fillet', 'sweep_along_planar_path', 'taper_extrude', 'tessellate', 'tessellate_boundaries', 'tessellation_defaults', 'transform', 'translate', 'trim_project_parallel', 'trim_surface_with_3d_curves', 'turn_to_nurbs', 'unify_normals', 'variable_radius_fillet', 'vertex_point']

test('k has every function of smlibpy._core, every method of Brep and PolyBrep and the enums Python has (W15)', async () => {
  const kernel = await import('../src/kernel.ts')
  assert.equal(CORE_FUNCTIONS.length, 156)
  for (const name of CORE_FUNCTIONS) assert.equal(typeof k[name], 'function', name)
  assert.deepEqual(Object.keys(k.smpylib).filter((n) => typeof k.smpylib[n] === 'function').sort(), CORE_FUNCTIONS)
  assert.deepEqual(Object.keys(k.smpylib.Brep).sort(), ['area', 'bounding_box', 'center', 'copy', 'distance_to', 'edge_count', 'edges', 'face_count',
    'faces', 'info', 'is_manifold_solid', 'mass_properties', 'material_census', 'read_from_file', 'relationship_to', 'tessellate', 'vertex_count',
    'vertices', 'volume', 'write_to_file'])
  assert.deepEqual(Object.keys(k.smpylib.PolyBrep).sort(), ['calculate_bounding_box', 'compute_area_centroid', 'compute_properties', 'copy',
    'get_edges', 'get_faces', 'get_points', 'get_tolerance', 'get_vertices', 'is_manifold_solid', 'mass_properties', 'ray_intersection',
    'section_plane', 'to_mesh_arrays', 'to_numpy_arrays'])
  for (const name of ['brep_area', 'brep_volume', 'brep_mass_properties', 'brep_distance_to', 'face_area', 'face_centroid', 'edge_length',
    'edge_point_at', 'edge_start_vertex', 'poly_ray_intersection', 'poly_section_plane', 'poly_mass_properties', 'circle_radius']) {
    assert.equal(typeof k[name], 'function', name)
  }
  // the enums the module's own bindings did not have, with Python's numbers
  assert.deepEqual(k.ContinuityType, { UNDEFINED: 0, DISCONTINUOUS: 1, C0: 2, G1: 3, G1R: 4, G1_G2: 5, G1_G2_G3: 6, C1: 7, C1_G2: 8, C1_G2_G3: 9,
    C1_C2: 10, C1_C2_G3: 11, C1_C2_C3: 12, C_INFINITY: 13 })
  assert.deepEqual(k.CurveParameterization, { UNIFORM: 0, CHORD_LENGTH: 1, CENTRIPETAL: 2 })
  assert.deepEqual(k.TrimType, { KEEP_POINT: 0, DELETE_POINT: 1, SPLIT: 2 })
  // and those it had have SmPyLib's numbers
  const enums = JSON.parse(kernel.module.smpylib__enums())
  for (const [name, values] of Object.entries(enums)) assert.deepEqual(k[name], values, name)
})

test('the module\'s own bindings take the parameters SmPyLib gives them, and give what its own code gives (W15)', async () => {
  const { SIGNATURES } = await import('../src/signatures.ts')
  const kernel = await import('../src/kernel.ts')
  const smpylib = kernel._smpylibSignatures()
  let compared = 0
  for (const [name, sig] of [...Object.entries(SIGNATURES), ...Object.entries(kernel._OWN)]) {
    if (!(name in smpylib)) continue
    assert.deepEqual(sig, smpylib[name], name)
    compared++
  }
  // (65, and the hand-written create_partial_cylinder, _cone, _sphere (lane S: S13), stitch_advanced (lane IX: I5)
  // and fillet_preview (close-out F: F11))
  assert.equal(compared, 70)
  // the same calls through both: the results agree
  const b = k.create_box([0, 0, 0], 10, 20, 30)
  const s = k.smpylib.create_box([0, 0, 0], 10, 20, 30)
  try {
    assert.deepEqual(k.brep_bounding_box(b), k.smpylib.Brep.bounding_box(s))
    assert.equal(k.brep_faces(b).length, k.smpylib.Brep.faces(s).length)
    assert.deepEqual(k.brep_faces(s), k.smpylib.Brep.faces(s)) // (the same faces, in the same order)
    assert.deepEqual(k.brep_edges(s), k.smpylib.Brep.edges(s))
    const c = k.create_circle([0, 0, 0], 5)
    approx(k.curve_length(c), k.smpylib.Curve.length(c), 1e-12)
    assert.deepEqual(k.circle_center(c), k.smpylib.Circle.center(c))
    ext.delete_curve(c)
  } finally {
    ext.delete_brep(b)
    ext.delete_brep(s)
  }
})

test('the calls SmPyLib has that smlibwasm does not wrap work, with Python\'s defaults and keywords (W15)', () => {
  const made: number[] = []
  const brep = (p: number) => {
    made.push(p)
    return p
  }
  try {
    // partial primitives
    approx(k.brep_volume(brep(k.create_partial_cylinder([0, 0, 0], 10, 20, 0, 90)), { relative_accuracy: 1e-9 }), (Math.PI * 100 * 20) / 4, 1e-6)
    approx(k.compute_volume(brep(k.create_partial_sphere([0, 0, 0], 10, 0, 180)), 1e-9), (2 / 3) * Math.PI * 1000, 1e-6)
    approx(k.brep_volume(brep(k.create_pyramid([0, 0, 0], 10, 6)), { relative_accuracy: 1e-9 }), 200, 1e-6) // (a square base 10 x 10, 6 high)
    // a Boolean by name, the distance of two bodies, the relation of two
    const a = brep(k.create_box([0, 0, 0], 10, 10, 10))
    // (boolean_union consumes its operands, as Python's docstring says: they are not freed here)
    const u = brep(k.boolean_union(k.create_box([0, 0, 0], 10, 10, 10), k.create_box([5, 5, 5], 10, 10, 10)))
    approx(k.brep_volume(u, { relative_accuracy: 1e-9 }), 1875, 1e-6)
    const far = brep(k.create_box([20, 0, 0], 5, 5, 5))
    approx(k.brep_distance(a, far)[0] ?? k.brep_distance(a, far), 10, 1e-9)
    // Brep, Face and Edge methods
    approx(k.brep_area(a), 600, 1e-9)
    assert.deepEqual(k.brep_center(a), [5, 5, 5])
    const face = k.brep_faces(a)[0]
    approx(k.face_area(face), 100, 1e-9)
    const edge = k.brep_edges(a)[0]
    approx(k.edge_length(edge), 10, 1e-12)
    assert.equal(typeof k.edge_start_vertex(edge), 'number')
    // curves: an offset, the continuity at a parameter
    const circle = k.create_circle([0, 0, 0], 5)
    const offset = k.offset_curve(circle, 2)
    approx(k.curve_length(offset), 2 * Math.PI * 7, 1e-8)
    assert.equal(k.evaluate_continuity(circle, 0.25), k.ContinuityType.C1_G2_G3) // (as in Python)
    ext.delete_curve(circle)
    ext.delete_curve(offset)
    // a mesh: rays, sections, mass properties
    const mesh = k.brep_tessellate(a)
    try {
      const [hit] = k.poly_ray_intersection(mesh, [5, 5, -5], [0, 0, 1], 1e-6, 1e-6)
      assert.deepEqual(hit.point, [5, 5, 0])
      approx(k.poly_mass_properties(mesh).volume, 1000, 1e-9)
      assert.ok(k.poly_section_plane(mesh, [0, 0, 5], [0, 0, 1], 1e-6).length >= 4)
      assert.ok(k.poly_to_numpy_arrays(mesh, false).points instanceof Float32Array)
    } finally {
      ext.delete_polybrep(mesh)
    }
    // defaults from SmPyLib's own table
    assert.deepEqual(Object.keys(k.tessellation_defaults()).sort(), ['chord_height_tolerance', 'curve_angle_tolerance_deg', 'max_aspect_ratio',
      'max_edge_length', 'surface_angle_tolerance_deg'])
    // errors: Python's ValueError a RangeError, its TypeError a TypeError, the kernel's an Error
    // (create_pyramid: the partial primitives have hand-written bindings now, lane S: S13)
    assert.throws(() => k.create_pyramid([0, 0], 10, 6), { name: 'RangeError', message: 'Expected a 3-tuple for vector' })
    assert.throws(() => k.create_pyramid([0, 0, 0], 'ten', 6), { name: 'TypeError', message: 'a number was expected, not string' })
    assert.throws(() => k.create_pyramid([0, 0, 0], -10, 6), (e: unknown) => e instanceof Error && /^SmApiCreatePyramid failed: SM_ERR_/.test(e.message))
    assert.throws(() => k.brep_tessellate(a, { allow_partial: true }), { name: 'RangeError', message: /allow_partial=True requires/ })
    assert.throws(() => k.create_pyramid([0, 0, 0], 10), { name: 'TypeError', message: 'create_pyramid: missing argument height' })
  } finally {
    for (const p of made) ext.delete_brep(p)
  }
})

test('a TessellationError of SmPyLib\'s is an Error of that name with its report, as in Python (W15)', () => {
  assert.throws(() => k.smpylib.tessellate(0), (e: unknown) => {
    assert.ok(e instanceof Error)
    assert.equal(e.name, 'TessellationError')
    assert.match(e.message, /^SmApiTessellate failed: SM_ERR_NULL_POINTER \(1006\)/)
    const err = e as Error & { report: { failures: unknown[]; has_mesh: boolean }; failures: unknown[]; status: number; status_name: string }
    assert.ok(Array.isArray(err.failures) && err.report.failures === err.failures && err.report.has_mesh === false)
    assert.deepEqual([err.status, err.status_name], [1006, 'SM_ERR_NULL_POINTER'])
    return true
  })
  // and the module goes on
  const b = k.create_box([0, 0, 0], 10, 10, 10)
  const mesh = k.smpylib.tessellate(b)
  approx(k.poly_mass_properties(mesh).volume, 1000, 1e-9)
  ext.delete_polybrep(mesh)
  ext.delete_brep(b)
})

test('@classcad/smlibwasm/kernel is an entry of the package, with its declarations (W15)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(pkg.exports['./kernel'], { types: './dist/kernel.d.ts', default: './dist/kernel.js' })
  // what it exports, run as the package's entry would be
  const out = run(`
    const kernel = await import(${JSON.stringify(new URL('kernel.ts', SRC).href)})
    const k = kernel.k
    const b = k.create_partial_torus([0, 0, 0], 10, 2, 0, 180)
    const v = k.brep_volume(b, { relative_accuracy: 1e-9 })
    const h = new kernel.BrepHandle(b)
    h.dispose()
    console.log(JSON.stringify({ v, keys: Object.keys(kernel).filter((n) => !n.startsWith('_')).sort(), alive: h.alive }))
  `)
  approx(out.v as number, Math.PI * 4 * Math.PI * 10, 1e-6) // (half a torus: pi r^2 * pi R)
  assert.equal(out.alive, false)
  for (const name of ['BrepHandle', 'CurveHandle', 'KernelError', 'ModelingError', 'PolyHandle', 'SurfaceHandle', 'ext', 'k', 'kernelCall', 'memoryUsage', 'module', 'scope', 'setWarningHandler']) {
    assert.ok((out.keys as string[]).includes(name), name)
  }
})


// ================================================================================ N6: where the kernel gave up
const TRACE_ENTRY = /^SM_[A-Z_]+ at \w+\.cpp:\d+( \(.+\))?$/

/** A cut the kernel fails (SmMerge::MakeFaceuse) in both builds. */
const failingCut = (): Part =>
  Box(20, 20, 20)
    .cut(Cylinder(3, 40).rotate(Z, 45))
    .cut(Cylinder(2, 40).rotate(Z, 45).rotate(X, 90).translate(1, 0, 0))

function rawFillet(b: number = Box(10, 10, 10)._copyBrep()): void {
  try {
    k.fillet_edges(b, k.brep_edges(b), { radius: 50 }) // (a kernel function's own Error)
  } finally {
    ext.delete_brep(b)
  }
}

test('kernel errors say where the kernel gave up: KernelError.trace (N6)', () => {
  // Release builds compiled the kernel's error reports out: a KernelError said "SM_ERR at
  // <binding>" and no more. Kernel patch K11 (SmMessages.h) reports each failure; the trail keeps
  // the last 48, the failing chain at its end.
  // (the kernel's own Boolean: smlibwasm's turns the second cylinder about its axis and succeeds now,
  // lane BT: B4)
  const holeA = Cylinder(3, 40).translate(0, 3, 0)
  const holeB = Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)
  assert.throws(() => kernelCall('fuse', () => k.boolean(holeA._copyBrep(), holeB._copyBrep(), { operation: k.BooleanOp.UNION })), (e: unknown) => {
    assert.ok(e instanceof KernelError)
    assert.ok(Object.isFrozen(e.trace) && e.trace.length > 0 && e.trace.every((t) => TRACE_ENTRY.test(t)), String(e.trace))
    // (the WebAssembly kernel gives up in SmMerge::MakeFaceuse where the native one stops in
    // IntersectTopology: SM_ERR where Python has SM_ERR_BAD_INTERSECTIONS)
    assert.match(e.trace.at(-1) as string, /^SM_ERR(_BAD_INTERSECTIONS)? at SmApiBrep\.cpp:\d+ \(SmApiBoolean\)$/)
    assert.ok(!/Kernel trace/.test(e.detail) && !/SmApiBrep/.test(e.message))
    return true
  })
  // a selection the kernel cannot round: thrown again with its hint, with the first one's trace
  const p = Box(10, 5, 20).cut(Cone(4, 5, 20))
  assert.throws(() => p.fillet(p.edges(), 0.5), (e: unknown) => {
    assert.ok(e instanceof KernelError && /cannot round the selection/.test(e.message))
    // (the fillet executive itself, lane FO: F8; no SmApiFilletEdges around it)
    assert.deepEqual(e.trace.map((t) => t.split(' at ')[0]), ['SM_ERR_INVALID_INPUT'])
    assert.match(e.trace[0], /\(CreateFilletCorners\)$/)
    return true
  })
  assert.deepEqual(new KernelError('probe', 'detail').trace, [])
  assert.throws(() => Box(10, 10, 10).fillet(Box(10, 10, 10).edges(), 6), (e: unknown) => e instanceof ModelingError && !(e instanceof KernelError))
})

test('the kernel trace keeps the last failures (N6)', () => {
  ext.clear_kernel_trace()
  assert.deepEqual(ext.kernel_trace(), [[], 0])
  void Box(40, 30, 20).cut(Cylinder(5, 40)).volume // (no failure on the way)
  assert.deepEqual(ext.kernel_trace(), [[], 0])
  assert.throws(() => rawFillet(), /SmApiFilletEdges failed: SM_ERR/)
  const [chain, n] = ext.kernel_trace() as [string[], number]
  assert.equal(n, 4)
  assert.match(chain[3], /\(SmApiFilletEdges\)$/)
  const breps = Array.from({ length: 19 }, () => Box(10, 10, 10)._copyBrep()) // (kernelCall clears the trace)
  ext.clear_kernel_trace()
  for (const b of breps) assert.throws(() => rawFillet(b))
  const [entries, m] = ext.kernel_trace() as [string[], number]
  assert.equal(m, 76)
  assert.deepEqual(entries, Array.from({ length: 12 }, () => chain).flat().slice(-48)) // (the first 28 dropped)
  ext.clear_kernel_trace()
})

test('the kernel trace comes back from a probe worker and from a KernelWorker (N6)', async () => {
  const old = setGuardBooleans(true)
  try {
    // (a cut that still fails: the crossing holes fuse now, lane BT: B4)
    assert.throws(() => failingCut(), (e: unknown) => {
      assert.ok(e instanceof KernelError && e.trace.length > 0 && /\(SmApiBoolean\)$/.test(e.trace.at(-1) as string), String((e as KernelError).trace))
      return true
    })
    assert.deepEqual(ext.kernel_trace(), [[], 0]) // (this kernel did not run the Boolean)
  } finally {
    setGuardBooleans(old)
  }
  const cad = new KernelWorker<typeof Models>(WORKER)
  try {
    await assert.rejects(cad.call('crossingHoles', []), (e: unknown) => {
      assert.ok(e instanceof KernelError && Object.isFrozen(e.trace) && /\(SmApiBoolean\)$/.test(e.trace.at(-1) as string), String(e))
      return true
    })
  } finally {
    cad.terminate()
  }
})

// ================================================================================ W16: the vase fillets
test('the vase fillets that the native arm64 build makes fail here, and say where (W16)', () => {
  // usd-brep's vase1.smb and vase3.smb: smlibpy (macOS arm64) rounds all their edges; here the kernel
  // finds not one point where it drops a corner's guess onto the filleted edge. The cause is the native
  // build's contraction of a * b + c into one instruction: built without it (-ffp-contract=off), the
  // native kernel fails the same way and reads the vase with this build's volume to the last digit.
  const folder = new URL('../../third_party/usd-brep/TestFiles/pt_TestFiles/Fillet/', import.meta.url)
  for (const name of ['vase1', 'vase3']) {
    const vase = fromSmb(readFileSync(new URL(`${name}.smb`, folder))) as Part
    assert.throws(() => vase.fillet(vase.edges(), 0.2), (e: unknown) => {
      assert.ok(e instanceof KernelError && e.status === 'SM_ERR')
      // (the fillet executive's own record, lane FO: F8: the corner it could not build, and the trace up
      // to it; the executive returns its failure rather than raising it through DoFillet)
      assert.match(e.message, /could not build the corner at/)
      const chain = e.trace.slice(-4).map((t) => /\((\w+)\)$/.exec(t)?.[1])
      assert.deepEqual(chain, ['LoadInitialValues', 'RailEdgeuseIntersect', 'CalcRailIntEdgeuse', 'CalcCornerVertGeom'])
      return true
    })
  }
  approx((fromSmb(readFileSync(new URL('vase1.smb', folder))) as Part).volume, 1103972.4296165158, 1e-12)
})

// ================================================================================ N5: parity with smlibpy's golden files
const PARITY = new URL('../../tests/data/parity/', import.meta.url)
const NUMBER = /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?/g

/** tools/parity.py's `normalized`: no writer's name, no file name or time in a STEP header. */
function normalized(text: string): string {
  return text.replaceAll('smlibwasm', 'smlibpy').replace(/FILE_NAME\('[^']*','[^']*'/, "FILE_NAME('',''")
}

/** tools/parity.py's `same_text`: null, or where two texts differ (numbers to `tolerance`). */
function sameText(a: string, b: string, tolerance = 1e-9): string | null {
  a = normalized(a)
  b = normalized(b)
  const [ta, tb] = [a.split(NUMBER), b.split(NUMBER)]
  const [na, nb] = [a.match(NUMBER) ?? [], b.match(NUMBER) ?? []]
  if (ta.length !== tb.length || ta.some((x, i) => x !== tb[i]) || na.length !== nb.length) {
    let i = 0
    while (i < Math.min(ta.length, tb.length) && ta[i] === tb[i]) i++
    return `text ${JSON.stringify(ta[i] ?? '')} against ${JSON.stringify(tb[i] ?? '')} (piece ${i})`
  }
  for (let i = 0; i < na.length; i++) {
    const [u, v] = [Number(na[i]), Number(nb[i])]
    if (Math.abs(u - v) > tolerance * Math.max(1, Math.abs(u), Math.abs(v))) return `number ${i}: ${na[i]} against ${nb[i]}`
  }
  return null
}

/** tools/parity.py's `same_value`: numbers to `rel` of their size (at least 1e-9), integers and the rest exactly. */
function sameValue(a: unknown, b: unknown, rel = 1e-7, at = ''): string | null {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(a) && Number.isInteger(b)) return a === b ? null : `${at}: ${a} against ${b}`
    return Math.abs(a - b) <= 1e-9 + rel * Math.max(Math.abs(a), Math.abs(b)) ? null : `${at}: ${a} against ${b}`
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: ${a.length} items against ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = sameValue(a[i], b[i], rel, `${at}[${i}]`)
      if (d !== null) return d
    }
    return null
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const [ka, kb] = [Object.keys(a).sort(), Object.keys(b).sort()]
    if (ka.join() !== kb.join()) return `${at}: keys ${ka} against ${kb}`
    for (const key of ka) {
      const d = sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], rel, `${at}.${key}`)
      if (d !== null) return d
    }
    return null
  }
  return a === b ? null : `${at}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`
}

/** A file outside the repository, beside it or one of its parents (tools/parity.py's `_beside`). */
function beside(relative: string): string | null {
  let dir = fileURLToPath(new URL('../../', import.meta.url))
  for (;;) {
    const up = join(dir, '..')
    if (up === dir) return null
    dir = up
    try {
      readFileSync(join(dir, relative), { flag: 'r' })
      return join(dir, relative)
    } catch {
      // (not here)
    }
  }
}

const parityBody = (b: Part) => {
  const box = b.bbox()
  return { volume: b.volume, area: b.area, faces: b.faces().length, edges: b.edges().length, valid: b.isValid(), bbox: [...box.min.toArray(), ...box.max.toArray()] }
}
const paritySketch = (s: Sketch) => ({ area: s.area, faces: s.faces().length })
const parityPlate = () => {
  const p = Box(80, 60, 10)
  return p.fillet(p.edges().parallelTo(Z), 8).cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, 10)))
}

/** tools/parity.py's `cases()`, made with smlibwasm under the same names. */
const PARITY_CASES: Record<string, () => unknown> = {
  plate: () => {
    const p = parityPlate()
    return { ...parityBody(p), triangles: p.mesh().length, concave: p.edges().concave().length, top: p.faces().top()[0].area }
  },
  'rounded box': () => parityBody(Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)),
  'chamfered box': () => parityBody(Box(20, 20, 20).chamfer(Box(20, 20, 20).faces().top()[0].edges(), 2)),
  cup: () => parityBody(Box(30, 30, 30).shell(2, Box(30, 30, 30).faces().top())),
  offset: () => parityBody(Box(10, 10, 10).offset(2)),
  split: () => ({ volumes: split(Box(10, 10, 10).rotate(X, 30), Plane.XY, 'both').map((p) => p.volume) }),
  loft: () => parityBody(loft([Circle(5), Rectangle(6, 6).moved(new Location([0, 0, 10]))])),
  twist: () => parityBody(Box(20, 20, 100).twist(90)),
  cells: () => ({ volumes: Box(10, 10, 10).merge(Sphere(4).translate(0, 0, 5)).cells().map((c) => c.volume).sort((a, b) => a - b) }),
  void: () => ({
    volume: Box(20, 20, 20).cut(Box(10, 10, 10)).volume,
    solids: Box(20, 20, 20).cut(Box(10, 10, 10)).solids().length,
    apart: Box(5, 5, 5).fuse(Box(5, 5, 5).translate(20, 0, 0)).solids().map((s) => s.volume).sort((a, b) => a - b),
  }),
  'remove fillets': () => parityBody(Box(20, 20, 20).fillet(Box(20, 20, 20).edges().parallelTo(Z), 3).removeFillets()),
  xor: () => {
    const abc = Circle(5).xor(Circle(5).translate(4, 0)).xor(Circle(5).translate(2, 4))
    const t = Polygon([-20, -20], [20, -20], [0, 20])
    return { xor: paritySketch(abc.xor(t)), and: paritySketch(abc.intersect(t)), cut: paritySketch(abc.cut(t)), txor: paritySketch(t.xor(abc)) }
  },
  text: () => paritySketch(Text('Ab', 10)),
  'cone cylinder merge': () => {
    const { volume, faces, valid } = parityBody(Cone(3, 0, 4).rotate(X, 90).merge(Cylinder(1.5, 16).rotate(Y, 90).translate(-5, 0, 3)))
    return { volume, faces, valid }
  },
  'vase1 fillet': () => {
    const p = fromSmb(readFileSync(new URL('../../third_party/usd-brep/TestFiles/pt_TestFiles/Fillet/vase1.smb', import.meta.url))) as Part
    return parityBody(p.fillet(p.edges(), 0.2))
  },
  'vase3 fillet': () => {
    const p = fromSmb(readFileSync(new URL('../../third_party/usd-brep/TestFiles/pt_TestFiles/Fillet/vase3.smb', import.meta.url))) as Part
    return parityBody(p.fillet(p.edges(), 0.2))
  },
  'dxf 19': () => {
    const d = importDxf(beside('classcad/data/Test/Input/BugReporting/CAD-3602/yon002k7.dxf') as string)
    return { area: Math.round(d.area * 1e4) / 1e4, faces: d.faces().length, holes: d.faces().map((f) => f.innerWires().length).sort((a, b) => a - b) }
  },
  'valve convexity': () => {
    const v = importStep(beside('models/solid/Ventil.stp') as string) as Part
    return { convex: v.edges().convex().length, concave: v.edges().concave().length, smooth: v.edges().smooth().length }
  },
}
const PARITY_FILES: Record<string, string> = { 'dxf 19': 'classcad/data/Test/Input/BugReporting/CAD-3602/yon002k7.dxf', 'valve convexity': 'models/solid/Ventil.stp' }

test("smlibwasm's results are smlibpy's, but for the known divergences, which are as known (N5)", () => {
  const golden = JSON.parse(readFileSync(new URL('golden.json', PARITY), 'utf8'))
  assert.deepEqual(Object.keys(PARITY_CASES).sort(), Object.keys(golden.cases).sort())
  const ran: string[] = []
  for (const [name, make] of Object.entries(PARITY_CASES)) {
    if (name in PARITY_FILES && beside(PARITY_FILES[name]) === null) continue // (a file this checkout has not beside it)
    let got: unknown
    try {
      got = scope(make)
    } catch (e) {
      got = { error: (e as Error).name, status: (e as KernelError).status ?? null }
    }
    const known = golden.known[name]
    const want = known ? known.wasm : golden.cases[name]
    const d = sameValue(got, want, 1e-7, name)
    assert.equal(d, null, `${d}${known ? ` (a known divergence: ${known.why})` : ''}`)
    if (known) assert.notEqual(sameValue(got, golden.cases[name], 1e-7, name), null, `${name} now agrees with smlibpy: take it out of tools/parity.py's KNOWN`)
    ran.push(name)
  }
  assert.ok(ran.length >= 16, ran.join(', '))
})

test("the file writers write smlibpy's files: STEP, USD, DXF, OBJ, glTF, STL (N5)", () => {
  // The writers of the port are hand-written copies of smlibpy's; only Python's tests read the files
  // back with OpenCASCADE. The same bodies (read from the same .smb files) must give smlibpy's text,
  // but for the writer's name and the time.
  const read = (name: string) => readFileSync(new URL(name, PARITY), 'utf8')
  const plate = (fromSmb(readFileSync(new URL('plate.smb', PARITY))) as Part).named('plate').colored([0.8, 0.3, 0.2])
  const ball = (fromSmb(readFileSync(new URL('ball.smb', PARITY))) as Part).named('ball')
  const box = Box(30, 20, 10).named('box').colored('steelblue')
  const sketch = Rectangle(40, 20, { fillet: 3 }).cut(Circle(4)).cut(Polygon([10, -5], [15, -5], [12, 5]))
    .fuse(Ellipse(6, 3).translate(35, 0)).fuse(Text('S', 10).translate(-35, 0))
  const files: Record<string, string> = {
    'parts.step': toStep([plate, ball], { name: 'parts' }),
    'parts.usda': toUsd([plate, ball], { mesh: false }),
    'sketch.dxf': toDxf(sketch),
    'box.obj': toObj(box),
    'box.stl': new TextDecoder().decode(toStl(box, { ascii: true })),
    'box.usda': toUsd(box),
  }
  for (const [name, text] of Object.entries(files)) assert.equal(sameText(text, read(name)), null, name)
  assert.equal(sameValue(JSON.parse(normalized(toGltf(box))), JSON.parse(normalized(read('box.gltf'))), 1e-9), null, 'box.gltf')
  // (and the comparison sees a difference: a number, a word)
  assert.match(sameText(files['parts.step'].replace('CARTESIAN_POINT', 'CARTESIAN_POINTS'), read('parts.step')) as string, /^text/)
  assert.match(sameText(files['box.obj'].replace(/\b15\b/, '15.001'), read('box.obj')) as string, /^number/)
})

// ================================================================================ N5: the examples of the docs run
/** The ```js blocks of a page. */
function jsBlocks(page: string): string[] {
  return [...readFileSync(page, 'utf8').matchAll(/```js\n([^]*?)```/g)].map((m) => m[1])
}

test('the JavaScript examples of docs/javascript.md and js/README.md run, and print what they say (N5)', () => {
  const docs = fileURLToPath(new URL('../../docs/javascript.md', import.meta.url))
  const readme = fileURLToPath(new URL('../README.md', import.meta.url))
  const src = (name: string) => JSON.stringify(new URL(name, SRC).href)
  const pkg = (code: string) => code
    .replace(/'@classcad\/smlibwasm\/(worker|init|kernel)'/g, (_, entry) => src(`${entry}.ts`))
    .replaceAll("'@classcad/smlibwasm'", src('index.ts'))
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-docs-'))
  writeFileSync(join(dir, 'three.mjs'), 'class Thing { constructor(...a) { this.args = a; this.rotation = {} } add() {} setAttribute() {} setFromPoints() { return this } }\n' +
    'export const BufferGeometry = Thing, BufferAttribute = Thing, Group = Thing, Mesh = Thing, MeshStandardMaterial = Thing, LineSegments = Thing, LineBasicMaterial = Thing\n')
  const font = JSON.stringify(fileURLToPath(new URL('../../src/smlibpy/fonts/Lato-Regular.ttf', import.meta.url)))
  // what a block takes from the page around it (an app's values), by a line of it; null: not run here
  const context: [string, string | null][] = [
    ['// vite.config.js', null], // (a bundler's configuration)
    ["locateFile: (file) => `https://cdn.example.com", null], // (from a CDN: init's own tests load it from elsewhere)
    ["import * as THREE from 'three'", 'const scene = { add() {} }\n'],
    ['await file.arrayBuffer()', `const file = { name: 'bracket.step', arrayBuffer: async () => new TextEncoder().encode(toStep(Box(10, 10, 10))).buffer }\n`],
    ["fetch('/fonts/inter.woff2')", `const fetch = async () => ({ arrayBuffer: async () => (await import('node:fs')).readFileSync(${font}) })\n`],
    ['for (const width of widths)', 'const widths = [30, 40], params = 5, model = (h) => Box(10, 10, h)\n'],
    ['// models.js', null], // (with the worker's: below)
    ['// cad.worker.js', null],
    ['// main.js', null],
  ]
  const blocks = [...jsBlocks(docs), ...jsBlocks(readme)]
  let ran = 0
  for (const block of blocks) {
    const entry = context.find(([line]) => block.includes(line))
    if (entry && entry[1] === null) continue
    const code = `import * as __smlibwasm from ${src('index.ts')}\nObject.assign(globalThis, __smlibwasm)\n` +
      (entry?.[1] ?? '') + pkg(block).replace("'three'", JSON.stringify(pathToFileURL(join(dir, 'three.mjs')).href))
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 120_000 })
    assert.equal(out.status, 0, `${block}\n${out.stderr}`)
    // what a console.log(...) // value says it prints
    const said = [...block.matchAll(/console\.log\(.*\) \/\/ (.*)$/gm)].map((m) => m[1].replace(/\.\.\.$/, ''))
    const printed = out.stdout.trim().split('\n')
    said.forEach((s, i) => assert.ok(printed[i]?.startsWith(s), `${block}\nprinted ${printed[i]}, the page says ${s}`))
    ran++
  }
  // the worker's three files, as an app has them: models.js, cad.worker.js and main.js
  const named = (first: string) => pkg(blocks.find((b) => b.startsWith(first)) as string)
  writeFileSync(join(dir, 'models.js'), named('// models.js'))
  writeFileSync(join(dir, 'cad.worker.js'), named('// cad.worker.js'))
  writeFileSync(join(dir, 'main.mjs'), `import { _nodeWorker } from ${src('_threads.ts')}\nimport { getBuiltinModule } from 'node:process'\n` +
    `globalThis.Worker = class { constructor(url) { return _nodeWorker(getBuiltinModule('node:worker_threads'), url) } }\n` +
    named('// main.js') + '\nconsole.log(JSON.stringify({ volume: part.volume, weight }))\ncad.terminate()\n')
  const out = spawnSync(process.execPath, [join(dir, 'main.mjs')], { encoding: 'utf8', timeout: 120_000 })
  assert.equal(out.status, 0, out.stderr)
  const { volume, weight } = JSON.parse(out.stdout.trim().split('\n').at(-1) as string)
  approx(weight, volume * 7.85e-3, 1e-12)
  approx(volume, 80 * 60 * 10 - (4 - Math.PI) * 6 * 6 * 10 - 6 * Math.PI * 9 * 10, 1e-9)
  assert.ok(ran >= 7, `${ran} blocks ran`)
})

// ================================================================================ N4: NVIDIA's validator on toUsd's files
/** A Python of 3.10 or later (usd-brep's validator needs it), or null. */
function python(): string | null {
  for (const exe of [process.env.SMLIBPY_PYTHON, 'python3', 'python'].filter(Boolean) as string[]) {
    const out = spawnSync(exe, ['-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8' })
    if (out.status === 0 && out.stdout.trim() === 'True') return exe
  }
  return null
}

test("toUsd's files pass NVIDIA's BrepArray validator (N4)", (t) => {
  const exe = python()
  if (exe === null) return t.skip('no Python 3.10 or later for usd-brep validator (tools/oracles/usd_validator.py)')
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-usd-'))
  const rounded = Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)
  const bodies: Record<string, Part | Shell> = {
    box: Box(10, 20, 30), ball: Sphere(5), cone: Cone(5, 2, 10), rounded, void: Box(10, 10, 10).cut(Sphere(2)),
    cup: Box(30, 30, 30).shell(2, Box(30, 30, 30).faces().top()), cells: Box(10, 10, 10).merge(Sphere(4).translate(0, 0, 5)),
    far: Box(10, 10, 10).translate(1e6, 0, 0), tiny: Box(0.01, 0.01, 0.01), text: extrude(Text('Ab', 10), 2), nurbs: rounded.toNurbs(),
  }
  for (const [name, body] of Object.entries(bodies)) writeFileSync(join(dir, `${name}.usda`), toUsd(body.named(name), { mesh: false }))
  writeFileSync(join(dir, 'two.usda'), toUsd([Box(10, 10, 10).named('a'), Sphere(3).translate(20, 0, 0).named('b')]))
  // usd-brep's own files read and written again: the loop of the void's sphere face runs up and down
  // its seam, and its UV curves (which the check on reading leaves) do not close (BA.763): written
  // without them, and read back the same
  const samples = new URL('../../third_party/usd-brep/TestFiles/brep_validator/', import.meta.url)
  for (const name of ['cubeWithVoid', 'nonManifoldCubes']) {
    const body = fromUsd(readFileSync(new URL(`${name}.usda`, samples), 'utf8')) as Part
    const text = toUsd(body, { mesh: false })
    writeFileSync(join(dir, `re_${name}.usda`), text)
    approx((fromUsd(text) as Part).volume, body.volume, 1e-9)
  }
  const files = readdirSync(dir).map((f) => join(dir, f))
  const out = spawnSync(exe, ['-I', fileURLToPath(new URL('../../tools/oracles/usd_validator.py', import.meta.url)), '--json', ...files], { encoding: 'utf8', timeout: 600_000 })
  assert.ok(out.status === 0 || out.status === 1, out.stderr)
  const found = Object.fromEntries(Object.entries(JSON.parse(out.stdout) as Record<string, { breps: number; issues: [string, string][] }>)
    .map(([f, r]) => [f.split(/[\\/]/).at(-1), r.issues.map(([code]) => code)]))
  assert.deepEqual(found, Object.fromEntries([...Object.keys(bodies), 'two', 're_cubeWithVoid', 're_nonManifoldCubes'].map((n) => [`${n}.usda`, []])))
})

// ================================================================================ N9: what queries keep
test('compact() frees what queries left on a body (N9)', () => {
  // The kernel keeps what a query computes on the body's curves and surfaces for the body's life: on
  // this 90 KB part, bbox() left 34 KB, mesh() 541 KB and distanceTo() 573 KB.
  let part = Box(40, 30, 10).cut(Cylinder(5, 20))
  part = part.fillet(part.edges().parallelTo(Z), 2)
  const target = Box(5, 5, 5).translate(0, 0, 100)
  ext.drop_caches(part._brep) // (what the fillet left)
  assert.deepEqual([...ext.drop_caches(part._brep)], [0, 0])
  const before = [part.bbox(), part.distanceTo(target), part.mesh().triangles.length, part.volume] as const
  const [count, bytes] = ext.drop_caches(part._brep) as [number, number]
  assert.ok(count >= 5 && bytes > 500_000, `${count} caches, ${bytes} bytes`)
  assert.deepEqual([...ext.drop_caches({ brep: part._brep })], [0, 0])
  // compact() does that, gives the memory back, and the body answers as before
  part.distanceTo(target)
  part.mesh()
  const used = memoryUsage().used
  assert.equal(part.compact(), undefined)
  assert.ok(used - memoryUsage().used > 500_000, `${used - memoryUsage().used} bytes back`)
  assert.deepEqual([...ext.drop_caches(part._brep)], [0, 0])
  const after = [part.bbox(), part.distanceTo(target), part.mesh().triangles.length, part.volume] as const
  assert.deepEqual([after[0].min.toArray(), after[0].max.toArray()], [before[0].min.toArray(), before[0].max.toArray()])
  assert.deepEqual(after.slice(1), before.slice(1))
  assert.ok((ext.drop_caches(part._brep) as number[])[0] > 0) // (built again)
  // faces of a compacted body, sketches and shells
  part.compact()
  approx(part.faces().reduce((a, f) => a + f.area, 0), part.area, 1e-9)
  assert.ok(part.isValid())
  const sketch = Rectangle(10, 5).cut(Circle(1))
  const sheet = extrude(Line([0, 0], [10, 0]), 3) as Shell
  sketch.bbox()
  sheet.mesh()
  sketch.compact()
  sheet.compact()
  assert.deepEqual([...ext.drop_caches(sketch._brep)], [0, 0])
  assert.deepEqual([...ext.drop_caches(sheet._brep)], [0, 0])
  approx(sketch.area, 50 - Math.PI, 1e-9)
  approx(sheet.area, 30, 1e-9)
})

test('compact() gives back what a pattern of meshed copies kept (N9)', () => {
  let part = Box(40, 30, 10).cut(Cylinder(5, 20))
  part = part.fillet(part.edges().parallelTo(Z), 2)
  const copies = Array.from({ length: 50 }, (_, i) => part.translate(i * 50, 0, 0))
  const made = memoryUsage().used
  for (const p of copies) p.mesh()
  const meshed = memoryUsage().used
  for (const p of copies) p.compact()
  const compacted = memoryUsage().used
  const perPart = (meshed - made) / 50
  assert.ok(perPart > 400_000, `${perPart} bytes a copy`)
  assert.ok((compacted - made) / 50 < 0.02 * perPart, `${(compacted - made) / 50} of ${perPart} bytes a copy left`)
  for (const p of copies) p.dispose()
})
