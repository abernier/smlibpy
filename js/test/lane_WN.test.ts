// Lane WN of the kernel plan (phase 1): the worker entry (W2), loader options and bundlers (W7),
// out-of-memory and C++ exception errors (W8), the three.js conversion of docs/javascript.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Box, Cylinder, KernelError, Location, Mesh, ModelingError, Part, Plane, Shell, ShapeList, Sketch, Vector, memoryUsage } from '../src/index.ts'
import { _crashText, ext, k, kernelCall } from '../src/kernel.ts'
import { KernelWorker, expose } from '../src/worker.ts'
import { init } from '../src/init.ts'
import type * as Models from './lane_WN_models.ts'
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
  assert.deepEqual(Object.keys(before).sort(), ['heap', 'limit', 'used'])
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
    import { readFileSync, readdirSync } from 'node:fs'
    import { init } from ${src('init.ts')}
    const out = {}
    const { Box, Cylinder } = await init({ wasmBinary: readFileSync(${wasm}) })
    ${check}
    console.log(JSON.stringify(out))`)
  assert.deepEqual(bytes, { volume: 5497.3452 })
  const compiled = run(`
    import { readFileSync, readdirSync } from 'node:fs'
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
