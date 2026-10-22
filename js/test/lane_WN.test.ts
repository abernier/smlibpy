// Lane WN of the kernel plan (phase 1): the worker entry (W2), loader options and bundlers (W7),
// out-of-memory and C++ exception errors (W8), the three.js conversion of docs/javascript.md;
// kernel steps whose result comes back from the probe worker (N1), scope() and the port's own
// temporaries (W9), memory regressions (N2) and the fuzz harness (N3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box, Cylinder, KernelError, Location, Mesh, ModelingError, Part, Plane, Shell, ShapeList, Sketch, Vector, memoryUsage } from '../src/index.ts'
import { _crashText, ext, k, kernelCall } from '../src/kernel.ts'
import { KernelWorker, expose } from '../src/worker.ts'
import { init } from '../src/init.ts'
import type * as Models from './lane_WN_models.ts'
import { Axis, Circle, Cone, GridLocations, Polygon, Polyline, Rectangle, Slot, Sphere, Text, X, Y, Z, extrude, fromSmb, loft, revolve, scope, setGuardBooleans, setGuardSeconds, surfaceFillet, sweep, Line, toSmb } from '../src/index.ts'
import { plate } from './lane_WN_models.ts'

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
  assert.deepEqual(Object.keys(before).sort(), ['handles', 'heap', 'limit', 'used'])
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
  const there = counting(k, ['fillet_edges'], () => {
    rounded = moved.fillet(moved.edges().filter((e) => e.center().z > 11 && e.geomType === 'line'), 1)
    beveled = moved.chamfer(moved.edges().circles().filter((e) => e.center().z > 11), 0.5)
  })
  assert.equal(there.fillet_edges, 0)
  assert.ok(rounded!.isValid() && beveled!.isValid() && rounded!.volume < moved.volume && beveled!.volume < moved.volume)
  assert.equal(rounded!._h.imported, true)
  const own = made.translate(1, 2, 3).cut(Box(4, 4, 30).translate(11, 12, 3))
  let same = 0
  const here = counting(k, ['fillet_edges'], () => {
    same = own.fillet(own.edges().filter((e) => e.center().z > 11 && e.geomType === 'line'), 1).volume
  })
  assert.equal(here.fillet_edges, 1) // (a part made here: in this kernel)
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
  const m = Cone(3, 0, 4).rotate(X, 90).merge(Cylinder(1.5, 16).rotate(Y, 90).translate(-5, 0, 3))
  // (smlibpy's merge holds 149.19267, this one 145.98511: a divergence the fuzz run lists too)
  assert.ok(m.volume > 113.0973 && m.volume < 150.7964)
  assert.throws(() => m.cells(), (e: unknown) => e instanceof KernelError && /cells failed/.test(e.message) && /the kernel crashed/.test(e.detail))
  assert.ok(Math.abs(Box(30, 20, 10).cut(Cylinder(4, 20)).volume - 5497.3452) < 1e-3) // (this kernel goes on)
})
