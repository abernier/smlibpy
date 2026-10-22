// Functions that run in a worker (the package's entry `@classcad/smlibwasm/worker`): a Web Worker
// or a Node worker thread with a kernel of its own, so that the thread that calls them goes on
// while the kernel works, and a call that takes too long can be stopped.
//
// The worker's module exposes functions (`expose`); the calling thread calls them through a
// `KernelWorker`, which starts the worker, sends it one call at a time and waits for the answer.
// Bodies cross as the contents of binary .smb files (exact: the kernel's own format), with their
// names, colors and sketch planes; faces, edges and vertices of a body that crosses as the body
// and their place in it; meshes as their typed arrays, which move without a copy on the receiving
// thread (transferred); vectors, locations, planes, axes and boxes as their numbers; plain data as
// itself. A call that runs longer than its timeout, or whose AbortSignal fires, ends with the
// worker: the worker is terminated, which stops its kernel wherever it is, and the next call starts
// a new one. So does a call whose kernel crashed or ran out of memory, so that every call finds a
// sound kernel.
//
// This module does not load the kernel: on the calling thread the package (and its kernel) loads
// only when a body, mesh or sub-shape goes to the worker or comes back. A page that has its worker
// return meshes as plain arrays, or files (toGlb, toStep), never loads it.
//
//     // cad.worker.js
//     import { expose } from '@classcad/smlibwasm/worker'
//     expose(() => import('./models.js'))
//
//     // main.js
//     import { KernelWorker } from '@classcad/smlibwasm/worker'
//     const cad = new KernelWorker(() => new Worker(new URL('./cad.worker.js', import.meta.url), { type: 'module' }))
//     const part = await cad.call('plate', [80, 3, 6], { timeout: 10_000 })

import { Axis, BoundBox, Hit, Location, Nurbs, Plane, Vector } from './geometry.ts'
import { KernelError, ModelingError } from './_errors.ts'
import { _nodeWorker } from './_threads.ts'

// biome-ignore lint: the functions of a worker take and return anything
type Any = any
// biome-ignore lint: the functions of a worker take and return anything
type Fn = (...args: any[]) => unknown

/** The names of the functions of `M` (a worker's module). */
export type FunctionName<M> = { [K in keyof M]: M[K] extends (...args: any[]) => unknown ? K : never }[keyof M] & string

/** The functions of `M` as the calling thread calls them: each returns a promise of what the
 * function returns in the worker. */
export type Remote<M> = {
  readonly [K in FunctionName<M>]: M[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never
}

/** A worker as `KernelWorker` takes it: a Web Worker, or a Node `worker_threads` Worker. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void
  terminate(): unknown
}

/** The options of a `KernelWorker`. */
export interface KernelWorkerOptions {
  /** Milliseconds a call may run before its worker is terminated (default: no limit); a call's own
   * `timeout` takes its place. */
  timeout?: number
  /** Milliseconds a new worker may take to load its kernel and its functions (default 60000). */
  startTimeout?: number
}

/** The options of one call (`KernelWorker.call`). */
export interface CallOptions {
  /** Milliseconds the call may run in the worker before the worker is terminated (default: the
   * KernelWorker's `timeout`). The time it waits for calls before it, or for a new worker to start,
   * does not count. */
  timeout?: number
  /** Ends the call when it fires: a call that waits is dropped, one that runs ends with its worker. */
  signal?: AbortSignal
}

/** The key that marks a value that is no plain data in a message (a body, a vector, ...), and the
 * kind of a message. */
const TAG = '$smlibwasm'

// ================================================================================ the calling side
type Job = {
  id: number
  name: string
  args: unknown[]
  timeout: number
  signal: AbortSignal | null
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  settled: boolean
  sent: boolean
  timer: ReturnType<typeof setTimeout> | null
  onAbort: (() => void) | null
}

type Session = {
  worker: Any
  ready: Promise<readonly string[]>
  dead: boolean
  fail: (error: unknown) => void
  names: readonly string[] | null
  timer: ReturnType<typeof setTimeout> | null // (until it is ready)
}

/**
 * The functions a worker exposes (`expose`), called from this thread.
 *
 * `worker` makes the worker: a function that returns a new Web Worker or Node `worker_threads`
 * Worker (written as `new Worker(new URL('./cad.worker.js', import.meta.url), { type: 'module' })`
 * where it is called, bundlers find and bundle the worker's module), or the URL of the worker's
 * module, of which `KernelWorker` makes a module worker itself. The worker starts with the first
 * call (or `start()`), and again after one was terminated.
 *
 * Calls run one at a time, in the order they were made; each resolves to what the function
 * returned in the worker, or rejects with what it threw: ModelingError, KernelError (with its
 * operation, status and hint), TypeError and RangeError as such, other errors as an Error of
 * their name. A call that runs longer than its timeout rejects with a `TimeoutError`
 * (DOMException), one whose signal fires with the signal's reason; both terminate the worker
 * (nothing else stops a kernel that is at work), and the calls after them run in a new one.
 */
export class KernelWorker<M extends object = Record<string, (...args: any[]) => unknown>> {
  readonly _create: () => WorkerLike
  readonly _timeout: number
  readonly _startTimeout: number
  _session: Session | null = null
  _queue: Job[] = []
  _running: Job | null = null
  _ids = 0
  _remote: Remote<M> | null = null

  constructor(worker: URL | string | (() => WorkerLike), options: KernelWorkerOptions = {}) {
    _check('KernelWorker', options, ['timeout', 'startTimeout'])
    if (typeof worker === 'function') this._create = worker
    else if (worker instanceof URL || typeof worker === 'string') this._create = () => _spawn(worker)
    else throw new TypeError('KernelWorker: give the URL of the worker\'s module, or a function that makes the worker')
    this._timeout = _milliseconds('KernelWorker', 'timeout', options.timeout, Infinity)
    this._startTimeout = _milliseconds('KernelWorker', 'startTimeout', options.startTimeout, 60_000)
  }

  /**
   * Calls the worker's function `name` with `args`; resolves to what it returns. Bodies, meshes,
   * faces, edges and vertices of bodies, vectors, locations, planes, axes, boxes and plain data
   * cross in both directions (see the module's comment); other objects are a TypeError.
   */
  call<K extends FunctionName<M>>(
    name: K,
    args: M[K] extends (...a: infer A) => unknown ? A : never = [] as Any,
    options: CallOptions = {},
  ): Promise<M[K] extends (...a: any[]) => infer R ? Awaited<R> : never> {
    return new Promise((resolve, reject) => {
      if (typeof name !== 'string') throw new TypeError(`KernelWorker.call: the name of a function, not ${typeof name}`)
      if (!Array.isArray(args)) throw new TypeError('KernelWorker.call: the arguments must be an array')
      _check('KernelWorker.call', options, ['timeout', 'signal'])
      const signal = options.signal ?? null
      if (signal !== null && !(signal instanceof AbortSignal)) throw new TypeError('KernelWorker.call: signal must be an AbortSignal')
      const timeout = _milliseconds('KernelWorker.call', 'timeout', options.timeout, this._timeout)
      if (signal?.aborted) throw signal.reason
      const job: Job = {
        id: ++this._ids, name, args: [...args], timeout, signal, resolve: resolve as Any, reject,
        settled: false, sent: false, timer: null, onAbort: null,
      }
      if (signal !== null) {
        job.onAbort = () => this._abort(job, signal.reason)
        signal.addEventListener('abort', job.onAbort, { once: true })
      }
      this._queue.push(job)
      this._next()
    })
  }

  /** The worker's functions as functions of this thread: `functions.plate(80, 3, 6)` is
   * `call('plate', [80, 3, 6])`. */
  get functions(): Remote<M> {
    this._remote ??= new Proxy({} as Remote<M>, {
      get: (_, name) => (typeof name === 'string' && name !== 'then' ? (...args: unknown[]) => this.call(name as Any, args as Any) : undefined),
    })
    return this._remote
  }

  /** Starts the worker now (it starts with the first call otherwise); resolves once it has loaded
   * its kernel and functions, to their names. */
  async start(): Promise<string[]> {
    return [...(await this._ensure().ready)]
  }

  /** The calls that wait or run. */
  get pending(): number {
    return this._queue.length + (this._running !== null ? 1 : 0)
  }

  /** Terminates the worker, whatever it is doing; the calls that wait or run reject with an
   * `AbortError` (DOMException). The next call starts a new worker. */
  terminate(): void {
    const reason = new DOMException('the worker was terminated', 'AbortError')
    const jobs = [...(this._running !== null ? [this._running] : []), ...this._queue]
    this._queue = []
    this._running = null
    this._kill()
    for (const job of jobs) this._settle(job, reason, false)
  }

  [Symbol.dispose](): void {
    this.terminate()
  }

  // ------------------------------------------------------------------------ (internal)
  /** The worker's session: started if there is none. */
  _ensure(): Session {
    if (this._session !== null) return this._session
    let resolve: (names: readonly string[]) => void = () => {}
    let fail: (error: unknown) => void = () => {}
    const ready = new Promise<readonly string[]>((ok, no) => {
      resolve = ok
      fail = no
    })
    ready.catch(() => {}) // (whoever waits for it hears of a failure)
    const session: Session = { worker: null, ready, dead: false, fail, names: null, timer: null }
    this._session = session
    session.timer = setTimeout(() => {
      if (session.names === null) {
        this._lost(session, new Error(`the worker did not start within ${this._startTimeout} ms (does its module call expose()?)`))
      }
    }, Math.min(this._startTimeout, 2 ** 31 - 1))
    const started = (names: readonly string[]) => {
      clearTimeout(session.timer as ReturnType<typeof setTimeout>)
      session.names = names
      this._idle(session)
      resolve(names)
    }
    try {
      session.worker = this._create()
    } catch (e) {
      clearTimeout(session.timer)
      this._session = null
      session.dead = true
      fail(e)
      return session
    }
    const onMessage = (data: Any) => {
      if (session.dead || data === null || typeof data !== 'object') return
      if (data[TAG] === 'ready') {
        if (data.error) this._lost(session, _error(data.error, 'the worker failed to load its functions'))
        else started(data.names)
      } else if (data[TAG] === 'done' || data[TAG] === 'failed') {
        this._answer(session, data)
      }
    }
    const onError = (e: Any) => {
      if (session.dead) return
      const message = e instanceof Error ? e.message : (e?.message ?? String(e))
      this._lost(session, new Error(`the worker failed: ${message}`, { cause: e }))
    }
    const w = session.worker
    if (typeof w.on === 'function') {
      // (a Node worker thread)
      w.on('message', onMessage)
      w.on('error', onError)
      w.on('messageerror', onError)
      w.on('exit', (code: number) => {
        if (session.names === null) onError(new Error(`it ended before it was ready (exit code ${code}): does its module call expose()?`))
        else onError(new Error(`it ended (exit code ${code})`))
      })
    } else {
      w.addEventListener('message', (event: MessageEvent) => onMessage(event.data))
      w.addEventListener('error', (event: Any) => {
        event.preventDefault?.()
        onError(event.error ?? new Error(event.message || 'its module did not load'))
      })
      w.addEventListener('messageerror', () => onError(new Error('a message could not be read')))
    }
    w.ref?.()
    return session
  }

  /** Runs the next call, if none runs. */
  _next(): void {
    if (this._running !== null || this._queue.length === 0) return
    const job = this._queue.shift() as Job
    this._running = job
    const session = this._ensure()
    session.worker?.ref?.()
    // (a worker that ended while the call was on its way: the call goes to the next one)
    const requeue = () => {
      this._running = null
      this._queue.unshift(job)
      this._next()
    }
    session.ready.then(
      async () => {
        if (job.settled || this._running !== job) return
        if (session.dead) return requeue()
        let packet: Packet
        try {
          packet = await _encode(job.args)
        } catch (e) {
          this._done(job, e, false)
          return
        }
        if (job.settled || this._running !== job) return
        if (session.dead) return requeue()
        try {
          session.worker.postMessage({ [TAG]: 'call', id: job.id, name: job.name, ...packet.message }, packet.transfer)
        } catch (e) {
          this._done(job, e, false)
          return
        }
        job.sent = true
        if (job.timeout !== Infinity) {
          job.timer = setTimeout(() => {
            this._stop(job, new DOMException(`${job.name} did not finish within ${job.timeout} ms; its worker was terminated`, 'TimeoutError'))
          }, Math.min(job.timeout, 2 ** 31 - 1))
        }
      },
      (e) => {
        // (the worker did not start: the calls after this one would fare no better)
        if (this._running !== job) return
        const jobs = [job, ...this._queue]
        this._queue = []
        this._running = null
        for (const j of jobs) this._settle(j, e, false)
      },
    )
  }

  /** The worker's answer to the call that runs. */
  _answer(session: Session, data: Any): void {
    const job = this._running
    if (job === null || job.id !== data.id) return
    if (data.respawn) this._kill() // (a kernel that crashed or ran out of memory: the next call gets a new one)
    if (data[TAG] === 'failed') {
      this._done(job, _error(data.error), false)
      return
    }
    // (the next call may start while this answer is read)
    this._running = null
    this._clear(job)
    _decode(data).then(
      (value) => this._settle(job, value, true),
      (e) => this._settle(job, e, false),
    )
    this._idle(session)
    this._next()
  }

  /** The end of the call that runs: settles it and starts the next. */
  _done(job: Job, outcome: unknown, ok: boolean): void {
    if (this._running === job) this._running = null
    this._settle(job, outcome, ok)
    if (this._session !== null) this._idle(this._session)
    this._next()
  }

  /** Stops the call that runs: its worker ends with it. */
  _stop(job: Job, reason: unknown): void {
    if (job.settled) return
    if (this._running === job && job.sent) this._kill()
    this._done(job, reason, false)
  }

  /** A call's signal fired. */
  _abort(job: Job, reason: unknown): void {
    if (job.settled) return
    const at = this._queue.indexOf(job)
    if (at >= 0) {
      this._queue.splice(at, 1)
      this._settle(job, reason, false)
      return
    }
    this._stop(job, reason)
  }

  /** The worker failed or ended: the call that runs fails with `error`, and the next call starts a
   * new worker (a worker that did not start fails the calls that wait for it). */
  _lost(session: Session, error: unknown): void {
    if (session.dead) return
    const starting = session.names === null
    session.fail(error) // (before _kill says the worker was terminated)
    this._kill(session)
    const job = this._running
    if (!starting && job !== null && job.sent) this._done(job, error, false)
  }

  /** Terminates the worker (`session`: only that one). */
  _kill(session: Session | null = this._session): void {
    if (session === null || session.dead) return
    session.dead = true
    if (session.timer !== null) clearTimeout(session.timer)
    if (this._session === session) this._session = null
    session.fail(new DOMException('the worker was terminated', 'AbortError'))
    try {
      session.worker?.terminate()
    } catch {
      // (it may be gone)
    }
  }

  /** An idle Node worker does not keep Node running. */
  _idle(session: Session): void {
    if (this._running === null && this._queue.length === 0) session.worker?.unref?.()
  }

  _clear(job: Job): void {
    if (job.timer !== null) clearTimeout(job.timer)
    job.timer = null
    if (job.onAbort !== null) job.signal?.removeEventListener('abort', job.onAbort)
    job.onAbort = null
  }

  _settle(job: Job, outcome: unknown, ok: boolean): void {
    if (job.settled) return
    job.settled = true
    this._clear(job)
    if (ok) job.resolve(outcome)
    else job.reject(outcome)
  }
}

/** A module worker running `url`: a Node worker thread in Node, a Web Worker elsewhere. */
function _spawn(url: URL | string): WorkerLike {
  const threads = (globalThis as Any).process?.getBuiltinModule?.('node:worker_threads')
  if (threads) return _nodeWorker(threads, url)
  return new Worker(url, { type: 'module' })
}

/** Checks an options object: plain, with only the `allowed` keys. */
function _check(name: string, options: unknown, allowed: readonly string[]): void {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(`${name}: the options must be an object, not ${options === null ? 'null' : typeof options}`)
  }
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) throw new TypeError(`${name} got an unexpected option '${key}' (its options: ${allowed.join(', ')})`)
  }
}

/** Milliseconds, 0 or more (Infinity: no limit); `fallback` where none are given. */
function _milliseconds(name: string, key: string, value: unknown, fallback: number): number {
  if (value == null) return fallback
  if (typeof value !== 'number' || !(value >= 0)) throw new RangeError(`${name}: ${key} must be milliseconds, 0 or more, got ${String(value)}`)
  return value
}

// ================================================================================ the worker's side
/**
 * Answers the calls of a `KernelWorker` in this worker (a Web Worker or a Node worker thread) with
 * `functions`: an object of functions, or a function that loads them, such as
 * `() => import('./models.js')` (a module's exported functions). A function may return a promise.
 *
 * The worker listens for calls at once and answers them once the functions have loaded (the
 * package's kernel loads with them): a module worker can only be sure to see the messages that
 * come while it loads when it listens before it waits.
 */
export function expose(functions: object | (() => object | Promise<object>)): void {
  const port = _port()
  if (port === null) throw new Error('expose() answers a KernelWorker: call it in a Web Worker or a Node worker thread')
  const post = (message: Any, transfer: Transferable[] = []) => port.postMessage(message, transfer)
  let names: string[] = []
  const loading = (async () => {
    const loaded: Any = typeof functions === 'function' ? await (functions as () => unknown)() : functions
    if (loaded === null || typeof loaded !== 'object') throw new TypeError(`expose(): the functions must be an object (a module), not ${loaded === null ? 'null' : typeof loaded}`)
    const table: Record<string, Fn> = {}
    for (const key of Object.keys(loaded)) if (typeof loaded[key] === 'function') table[key] = loaded[key]
    names = Object.keys(table)
    return table
  })()
  loading.then(
    () => post({ [TAG]: 'ready', names }),
    (e) => post({ [TAG]: 'ready', error: _errorData(e) }),
  )
  const answer = async (data: Any) => {
    if (data === null || typeof data !== 'object' || data[TAG] !== 'call') return
    const id = data.id
    let table: Record<string, Fn>
    try {
      table = await loading
    } catch {
      return // (said so when the loading failed)
    }
    try {
      const fn = table[data.name]
      if (typeof fn !== 'function') {
        throw new TypeError(`the worker has no function '${data.name}' (it has: ${names.join(', ') || 'none'})`)
      }
      const args = (await _decode(data)) as unknown[]
      const result = await fn.apply(table, args)
      const packet = await _encode(result)
      post({ [TAG]: 'done', id, ...packet.message }, packet.transfer)
    } catch (e) {
      post({ [TAG]: 'failed', id, error: _errorData(e), respawn: _damaged(e) })
    }
  }
  if (typeof port.on === 'function') port.on('message', answer)
  else port.addEventListener('message', (event: MessageEvent) => answer(event.data))
}

/** Where this worker talks to its KernelWorker: its parent port in a Node worker thread, the
 * worker's global scope in a Web Worker; null elsewhere. */
function _port(): Any {
  const threads = (globalThis as Any).process?.getBuiltinModule?.('node:worker_threads')
  if (threads) return threads.parentPort ?? null
  const scope = globalThis as Any
  if (typeof scope.WorkerGlobalScope === 'function' && scope instanceof scope.WorkerGlobalScope) return scope
  return null
}

/** Whether the kernel of this worker may be damaged or full after `e`: a trap (the kernel crashed)
 * or memory that is used up (a module's memory never shrinks). The next call then runs in a new
 * worker. */
function _damaged(e: unknown): boolean {
  let x: Any = e
  for (let depth = 0; x != null && depth < 8; depth++, x = x.cause) {
    if (typeof WebAssembly !== 'undefined' && x instanceof WebAssembly.RuntimeError) return true
    if (x instanceof KernelError && x.status === 'SM_ERR_OUT_OF_MEMORY') return true
    if (x instanceof Error && /^SM_ERR_OUT_OF_MEMORY/.test(x.message)) return true
    // (defeature's _KernelFault for a trap of this kernel; not for one in its probe worker)
    if (x instanceof ModelingError && /^the kernel crashed \((?!in a probe worker)/.test(String((x as Any).reason ?? ''))) return true
  }
  return false
}

// ================================================================================ errors
type ErrorData = {
  kind: string
  name: string
  message: string
  stack: string
  [field: string]: unknown
}

/** An error as data for a message (structured cloning keeps an Error's message, but not its
 * class, name or fields). */
function _errorData(e: unknown): ErrorData {
  if (!(e instanceof Error)) return { kind: 'Error', name: 'Error', message: String(e), stack: '' }
  const kind = e instanceof KernelError ? 'KernelError'
    : e instanceof ModelingError ? 'ModelingError'
    : e instanceof TypeError ? 'TypeError'
    : e instanceof RangeError ? 'RangeError'
    : typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError ? 'RuntimeError'
    : 'Error'
  const out: ErrorData = { kind, name: e.name, message: e.message, stack: String(e.stack ?? '') }
  for (const key of ['operation', 'status', 'detail', 'hint', 'reason']) {
    const value = (e as Any)[key]
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value
  }
  return out
}

/** The error of `data` (from `_errorData`) as the class it was in the worker. */
function _error(data: ErrorData, prefix: string | null = null): Error {
  const message = prefix === null ? data.message : `${prefix}: ${data.message}`
  let e: Error
  if (data.kind === 'KernelError' && prefix === null) {
    e = new KernelError(String(data.operation), String(data.detail ?? ''), (data.status as string | null) ?? null, (data.hint as string | null) ?? null)
  } else if (data.kind === 'ModelingError') e = new ModelingError(message)
  else if (data.kind === 'TypeError') e = new TypeError(message)
  else if (data.kind === 'RangeError') e = new RangeError(message)
  else if (data.kind === 'RuntimeError' && typeof WebAssembly !== 'undefined') e = new WebAssembly.RuntimeError(message)
  else e = new Error(message)
  if (data.name && data.name !== e.name) e.name = data.name
  for (const key of ['operation', 'status', 'detail', 'hint', 'reason']) {
    if (key in data && !(key in e)) (e as Any)[key] = data[key]
  }
  if (data.stack) e.stack = `${e.stack ?? ''}\n    in the worker:\n${data.stack}`
  return e
}

// ================================================================================ values
/** Bodies, as they cross: the contents of a binary .smb file and what the file does not hold. */
type BodyData = { type: 'Part' | 'Shell' | 'Sketch'; smb: Uint8Array; name: string | null; color: unknown; plane: number[][] | null }

/** A value as a message: `value`, `bodies` (each body once, which the value refers to by its
 * place) and whether it needs the package (the kernel) to be read. */
type Packet = { message: { value: unknown; bodies: BodyData[]; package: boolean }; transfer: Transferable[] }

// biome-ignore lint: the package's modules, loaded when a value needs them
let _modules: Promise<Any> | null = null

/** The package's modules that make and read bodies, meshes and sub-shapes (loaded once, with the
 * kernel). */
function _package(): Promise<Any> {
  _modules ??= Promise.all([import('./kernel.ts'), import('./shapes.ts'), import('./exporters.ts'), import('./mesh.ts')]).then(
    ([kernel, shapes, exporters, mesh]) => ({ k: kernel.k, ...shapes, fromSmb: exporters.fromSmb, toSmb: exporters.toSmb, Mesh: mesh.Mesh }),
  )
  return _modules
}

const GEOMETRY: Function[] = [Vector, Axis, Plane, Location, BoundBox, Nurbs, Hit]

/** Whether `v` is plain data that crosses as itself (structured cloning). */
function _passes(v: object): boolean {
  return ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof Date || v instanceof RegExp || v instanceof Map || v instanceof Set ||
    (typeof Blob === 'function' && v instanceof Blob)
}

function _isPlain(v: object): boolean {
  const proto = Object.getPrototypeOf(v)
  return proto === null || Object.getPrototypeOf(proto) === null
}

/** Whether `value` holds an object of the package that only the package can write (a body, a
 * mesh, a sub-shape: no geometry value, no plain data). */
function _needsPackage(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  if (_passes(value) || GEOMETRY.some((c) => value instanceof c)) return value instanceof Hit && _needsPackage(value.face, seen)
  if (Array.isArray(value)) return Object.getPrototypeOf(value) !== Array.prototype || value.some((v) => _needsPackage(v, seen))
  if (_isPlain(value)) return Object.values(value).some((v) => _needsPackage(v, seen))
  return true
}

/** `value` as a message (see Packet). */
async function _encode(value: unknown): Promise<Packet> {
  const pkg = _needsPackage(value) ? await _package() : null
  const bodies: BodyData[] = []
  const places = new Map<object, number>()
  const transfer: Transferable[] = []
  const seen = new Set<object>()
  const typeName = (v: object) => (v.constructor?.name ? `a ${v.constructor.name}` : 'an object')

  const body = (b: Any): number => {
    let at = places.get(b)
    if (at === undefined) {
      const type = b instanceof pkg.Sketch ? 'Sketch' : b instanceof pkg.Part ? 'Part' : 'Shell'
      const smb: Uint8Array = pkg.toSmb(b, { ascii: false })
      const p = type === 'Sketch' ? b.plane : null
      const plane = p === null ? null : [p.origin.toArray(), p.xDir.toArray(), p.zDir.toArray()]
      at = bodies.push({ type, smb, name: b.name ?? null, color: b.color ?? null, plane }) - 1
      places.set(b, at)
      transfer.push(smb.buffer as ArrayBuffer)
    }
    return at
  }
  const owned = (what: string, owner: Any) => {
    if (owner == null) {
      throw new TypeError(`${what} of no body cannot go to or come from a worker: give the body it belongs to, or make it in the worker`)
    }
    return body(owner)
  }
  const copy = (a: ArrayBufferView | null) => {
    if (a === null) return null
    const c = (a as Any).slice() // (the receiving thread takes it over: the sender's stays as it was)
    transfer.push(c.buffer)
    return c
  }

  const enc = (v: Any): unknown => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function' || typeof v === 'symbol') throw new TypeError(`a ${typeof v} cannot go to or come from a worker`)
      return v
    }
    if (seen.has(v)) throw new TypeError('a value that contains itself cannot go to or come from a worker')
    seen.add(v)
    try {
      if (_passes(v)) return v
      if (v instanceof Vector) return { [TAG]: 'Vector', xyz: v.toArray() }
      if (v instanceof Axis) return { [TAG]: 'Axis', origin: v.origin.toArray(), direction: v.direction.toArray() }
      if (v instanceof Plane) return { [TAG]: 'Plane', origin: v.origin.toArray(), xDir: v.xDir.toArray(), zDir: v.zDir.toArray() }
      if (v instanceof Location) return { [TAG]: 'Location', matrix: v.matrix }
      if (v instanceof BoundBox) return { [TAG]: 'BoundBox', min: v.min.toArray(), max: v.max.toArray() }
      if (v instanceof Nurbs) return { [TAG]: 'Nurbs', degree: v.degree, knots: [...v.knots], points: v.points.map((p) => p.toArray()), weights: v.weights === null ? null : [...v.weights] }
      if (v instanceof Hit) return { [TAG]: 'Hit', point: v.point.toArray(), distance: v.distance, normal: v.normal.toArray(), face: enc(v.face), triangle: v.triangle }
      if (pkg !== null) {
        if (v instanceof pkg._Body) return { [TAG]: 'Body', body: body(v) }
        if (v instanceof pkg.Face) {
          const b = owned('a face', v.owner)
          return { [TAG]: 'Face', body: b, index: (pkg.k.brep_faces(v.owner._brep) as number[]).indexOf(v._f) }
        }
        if (v instanceof pkg.Edge) {
          const b = owned('an edge', v._owner)
          return { [TAG]: 'Edge', body: b, index: (pkg.k.brep_edges(v._owner._brep) as number[]).indexOf(v._e), reversed: v._rev }
        }
        if (v instanceof pkg.Vertex) {
          if (v._owner === null) return { [TAG]: 'Point', xyz: v.point.toArray() }
          return { [TAG]: 'Vertex', body: body(v._owner), index: (pkg.k.brep_vertices(v._owner._brep) as number[]).indexOf(v._v) }
        }
        if (v instanceof pkg.Wire) return { [TAG]: 'Wire', edges: v._edges.map(enc) }
        if (v instanceof pkg.Mesh) return { [TAG]: 'Mesh', vertices: copy(v.vertices), triangles: copy(v.triangles), normals: copy(v.normals) }
        if (v instanceof pkg.ShapeList) return { [TAG]: 'ShapeList', items: Array.from(v, enc) }
      }
      if (Array.isArray(v)) return Array.from(v, enc)
      if (_isPlain(v)) {
        const out: Record<string, unknown> = {}
        for (const key of Object.keys(v)) out[key] = enc(v[key])
        return out
      }
      throw new TypeError(
        `${typeName(v)} cannot go to or come from a worker: give bodies, meshes, faces, edges and vertices of bodies, vectors, locations, planes, axes, boxes or plain data`,
      )
    } finally {
      seen.delete(v)
    }
  }
  const out = enc(value)
  return { message: { value: out, bodies, package: pkg !== null }, transfer }
}

/** The value of a message (from `_encode`). */
async function _decode(data: { value: unknown; bodies: BodyData[]; package: boolean }): Promise<unknown> {
  const pkg = data.package || data.bodies.length ? await _package() : null
  const bodies = data.bodies.map((b) => {
    const read = pkg.fromSmb(b.smb)
    const Cls = b.type === 'Sketch' ? pkg.Sketch : b.type === 'Part' ? pkg.Part : pkg.Shell
    const plane = b.plane === null ? undefined : new Plane(b.plane[0], b.plane[1], b.plane[2])
    return Cls._wrap(read._h.release(), { name: b.name, color: b.color, plane })
  })
  const dec = (v: Any): unknown => {
    if (v === null || typeof v !== 'object' || _passes(v)) return v
    if (Array.isArray(v)) return v.map(dec)
    switch (v[TAG]) {
      case undefined:
        break
      case 'Vector':
        return new Vector(v.xyz)
      case 'Axis':
        return new Axis(v.origin, v.direction)
      case 'Plane':
        return new Plane(v.origin, v.xDir, v.zDir)
      case 'Location':
        return new Location(v.matrix)
      case 'BoundBox':
        return new BoundBox(v.min, v.max)
      case 'Nurbs':
        return new Nurbs(v.degree, v.knots, v.points.map((p: number[]) => new Vector(p)), v.weights)
      case 'Hit':
        return new Hit(new Vector(v.point), v.distance, new Vector(v.normal), dec(v.face), v.triangle)
      case 'Body':
        return bodies[v.body]
      case 'Face': {
        const b = bodies[v.body]
        return new pkg.Face(b, pkg.k.brep_faces(b._brep)[v.index])
      }
      case 'Edge': {
        const b = bodies[v.body]
        return pkg.Edge._of(b, pkg.k.brep_edges(b._brep)[v.index], v.reversed)
      }
      case 'Vertex': {
        const b = bodies[v.body]
        return pkg.Vertex._of(b, pkg.k.brep_vertices(b._brep)[v.index])
      }
      case 'Point':
        return new pkg.Vertex(v.xyz)
      case 'Wire':
        return pkg.Wire._raw(v.edges.map(dec))
      case 'Mesh': {
        // (the arrays were copied for this message: the mesh takes them as they are, where its
        // constructor would copy them again)
        const mesh = new pkg.Mesh([], [], null)
        mesh.vertices = v.vertices
        mesh.triangles = v.triangles
        mesh.normals = v.normals
        return mesh
      }
      case 'ShapeList':
        return new pkg.ShapeList(...v.items.map(dec))
      default:
        throw new TypeError(`a message holds a value of an unknown kind (${String(v[TAG])}): are the worker and this thread on the same smlibwasm?`)
    }
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(v)) out[key] = dec(v[key])
    return out
  }
  return dec(data.value)
}
