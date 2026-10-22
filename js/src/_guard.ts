// The caller's side of defeature's probe worker (see `_guarded` in defeature.ts): the supervisor
// (_defeature_supervisor.ts) that starts probe workers (_defeature_worker.ts) and hands them the
// kernel steps.
//
// A browser starts a worker only while the thread that creates it runs its event loop. A step that
// waits for its probe does not, and the code that removes fillets mostly runs from the package's
// import on without a pause: so in a browser the supervisor starts here, when the package is
// imported, before the kernel loads (kernel.ts imports this module first). It holds no kernel; it
// starts a probe worker when the first step comes. In Node workers start at any time, and the
// supervisor starts with the first step.

// biome-ignore lint: a Web Worker or a Node worker thread
type Any = any

/** The names of the supervisor and the probe workers in a browser (they start no supervisor of
 * their own). */
export const SUPERVISOR_NAME = 'smlibwasm-guard'
export const PROBE_NAME = 'smlibwasm-probe'

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
      // (the TypeScript of the repository, or the package's JavaScript)
      const suffix = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
      const url = new URL(`./_defeature_supervisor${suffix}`, import.meta.url)
      // A worker whose module is missing (a bundle that left it out) fails only once it loads, while
      // the first step waits for it: so the files are looked for first.
      const fs = (globalThis as Any).process.getBuiltinModule('node:fs')
      for (const name of ['_defeature_supervisor', '_defeature_worker']) {
        const file = new URL(`./${name}${suffix}`, import.meta.url)
        if (file.protocol === 'file:' && !fs.existsSync(file)) {
          noWorker = `no probe worker (${name}${suffix} is missing next to ${new URL('.', import.meta.url).pathname})`
          missing = true
          return null
        }
      }
      const argv = _workerArgv((globalThis as Any).process.execArgv ?? [])
      let worker: Any
      try {
        worker = new threads.Worker(url, { execArgv: argv })
      } catch (e) {
        // Node refuses options that apply to a whole process, which some runners pass on (`node
        // --test` gives its test processes --stack-trace-limit, --secure-heap and others): without
        // those.
        const refused = /invalid execArgv flags: (.*)$/.exec((e as Error).message)?.[1].split(', ') ?? []
        if ((e as Any).code !== 'ERR_WORKER_INVALID_EXEC_ARGV' || !refused.length) throw e
        worker = new threads.Worker(url, { execArgv: argv.filter((a) => !refused.includes(a)) })
      }
      worker.unref() // (an idle supervisor does not keep Node running)
      worker.on('error', () => lost(worker))
      worker.on('exit', () => lost(worker))
      supervisor = worker
    } else {
      // (written as bundlers recognise a worker, which they then bundle)
      const worker = new Worker(new URL('./_defeature_supervisor.js', import.meta.url), { type: 'module', name: SUPERVISOR_NAME })
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

/** Node's options for a worker: this process's, but not those that run code given on the
 * command line (`node -e`, `--input-type`), which a worker inherits and which keep it from
 * starting. */
export function _workerArgv(argv: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (['-e', '--eval', '-p', '--print', '--input-type'].includes(a)) i++ // (and its value)
    else if (!/^--(eval|print|input-type)=/.test(a)) out.push(a)
  }
  return out
}

/** A supervisor that failed or ended on its own: the next step starts a new one. */
function lost(worker: Any): void {
  if (supervisor === worker) supervisor = null
}

// (in a browser, but not in the guard's own workers: now)
if (!(globalThis as Any).process?.getBuiltinModule && ![SUPERVISOR_NAME, PROBE_NAME].includes((globalThis as Any).name)) _probeSupervisor()
