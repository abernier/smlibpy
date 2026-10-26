// Node worker threads, as the package starts them (defeature's probe worker in _guard.ts, the
// workers of worker.ts): a module without the kernel and without effects of its own.

// biome-ignore lint: a Node worker thread
type Any = any

/** The names of defeature's supervisor and probe workers in a browser (they start no supervisor of
 * their own; _guard.ts). */
export const SUPERVISOR_NAME = 'smlibwasm-guard'
export const PROBE_NAME = 'smlibwasm-probe'

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

/** A Node worker thread (`threads`: node:worker_threads) running the module at `url`, with this
 * process's options as far as a worker takes them (see `_workerArgv`). */
export function _nodeWorker(threads: Any, url: URL | string, options: Record<string, unknown> = {}): Any {
  const argv = _workerArgv((globalThis as Any).process.execArgv ?? [])
  try {
    return new threads.Worker(url, { ...options, execArgv: argv })
  } catch (e) {
    // Node refuses options that apply to a whole process, which some runners pass on (`node
    // --test` gives its test processes --stack-trace-limit, --secure-heap and others): without
    // those.
    const refused = /invalid execArgv flags: (.*)$/.exec((e as Error).message)?.[1].split(', ') ?? []
    if ((e as Any).code !== 'ERR_WORKER_INVALID_EXEC_ARGV' || !refused.length) throw e
    return new threads.Worker(url, { ...options, execArgv: argv.filter((a) => !refused.includes(a)) })
  }
}
