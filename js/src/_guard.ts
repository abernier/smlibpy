// The caller's side of defeature's probe worker (see `_guarded` in defeature.ts): the supervisor
// (_defeature_supervisor.ts) that starts probe workers (_defeature_worker.ts) and hands them the
// kernel steps.
//
// A browser starts a worker only while the thread that creates it runs its event loop. A step that
// waits for its probe does not, and the code that removes fillets mostly runs from the package's
// import on without a pause: so in a browser the supervisor starts here, when the package is
// imported, before the kernel loads (index.ts imports this module first). It holds no kernel; it
// starts a probe worker when the first step comes. In Node workers start at any time, and the
// supervisor starts with the first step.

// Bundlers build each worker from the `new Worker(new URL(...))` they find, with the modules it
// imports, and refuse a worker that comes back to itself: so the kernel's modules, which the probe
// worker imports, do not import this one, and the names of the workers are in _threads.ts.

import { PROBE_NAME, SUPERVISOR_NAME, _nodeWorker } from './_threads.ts'

export { PROBE_NAME, SUPERVISOR_NAME, _workerArgv } from './_threads.ts'

// biome-ignore lint: a Web Worker or a Node worker thread
type Any = any

let supervisor: Any = null // the supervisor, while it lives
let noWorker: string | null = null // why there is no probe worker here, once known
let missing = false // because its files are missing

/** Why no probe worker can run here (null: it can, or it may not be known yet). */
export function _noProbe(): string | null {
  return noWorker
}

/** Whether the probe worker's files are missing (a bundle that left them out). */
export function _probeMissing(): boolean {
  return missing
}

/** The supervisor, started on first use; null where no probe worker can run. */
export function _probeSupervisor(): Any {
  if (supervisor !== null || noWorker !== null) return supervisor
  noWorker = whyNoWorker()
  if (noWorker !== null) return null
  const threads = (globalThis as Any).process?.getBuiltinModule?.('node:worker_threads')
  try {
    if (threads) {
      // (the TypeScript of the repository, or the package's JavaScript; relative to `here`, not to
      // import.meta.url itself, which bundlers for the browser take for files to bundle: all of the
      // package's files, for a name they cannot read)
      const here = import.meta.url
      const suffix = here.endsWith('.ts') ? '.ts' : '.js'
      const url = new URL('./_defeature_supervisor' + suffix, here)
      // A worker whose module is missing (a bundle that left it out) fails only once it loads, while
      // the first step waits for it: so the files are looked for first.
      const fs = (globalThis as Any).process.getBuiltinModule('node:fs')
      for (const name of ['_defeature_supervisor', '_defeature_worker']) {
        const file = new URL('./' + name + suffix, here)
        if (file.protocol === 'file:' && !fs.existsSync(file)) {
          noWorker = `no probe worker (${name}${suffix} is missing next to ${new URL('./', here).pathname})`
          missing = true
          return null
        }
      }
      const worker = _nodeWorker(threads, url)
      worker.unref() // (an idle supervisor does not keep Node running)
      worker.on('error', () => lost(worker))
      worker.on('exit', () => lost(worker))
      supervisor = worker
    } else {
      // (written as bundlers recognise a worker, which they then bundle: the options too, literally,
      // as SUPERVISOR_NAME)
      const worker = new Worker(new URL('./_defeature_supervisor.js', import.meta.url), { type: 'module', name: 'smlibwasm-guard' })
      worker.onerror = () => lost(worker)
      supervisor = worker
    }
  } catch (e) {
    noWorker = `no probe worker (${(e as Error).message})`
  }
  return supervisor
}

/** Gives the probe worker up for good (`why`: it did not start), and the steps run directly. */
export function _giveUp(why: string): void {
  const worker = supervisor
  supervisor = null
  noWorker = why
  worker?.terminate()
}

function whyNoWorker(): string | null {
  if (typeof SharedArrayBuffer === 'undefined') return 'no SharedArrayBuffer (a page that is not cross-origin isolated)'
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 1, 0)
  } catch {
    return "Atomics.wait is not allowed here (a browser's main thread)"
  }
  const threads = (globalThis as Any).process?.getBuiltinModule?.('node:worker_threads')
  if (!threads && typeof Worker === 'undefined') return 'no Worker'
  return null
}

/** A supervisor that failed or ended on its own: the next step starts a new one. */
function lost(worker: Any): void {
  if (supervisor === worker) supervisor = null
}

// (in a browser, but not in the guard's own workers: now)
if (!(globalThis as Any).process?.getBuiltinModule && ![SUPERVISOR_NAME, PROBE_NAME].includes((globalThis as Any).name)) _probeSupervisor()
