// The supervisor of defeature's probe worker (_defeature_worker.ts), a worker without a kernel of
// its own: it starts the probe worker, hands it the kernel steps the caller sends, and on the
// caller's word terminates it, so that the next step gets a new one.
//
// The caller (`_guarded` in defeature.ts) waits for a step with Atomics.wait, and cannot start a
// worker meanwhile: a browser starts a worker only while the thread that creates it runs its event
// loop. This one does, so a probe worker that a step had to stop is replaced while the caller
// waits for the next one.
//
// Messages: a job (see _defeature_worker.ts), which goes on to the probe worker, or `{ kill: true }`.

import { PROBE_NAME } from './_guard.ts'

// biome-ignore lint: a Web Worker or a Node worker thread
type Any = any

const threads = (globalThis as Any).process?.getBuiltinModule?.('node:worker_threads')
let probe: Any = null // the probe worker, while it lives

/** A new probe worker (its kernel loads while the first job waits in its queue). */
function start(): Any {
  let worker: Any
  if (threads) {
    // (the TypeScript of the repository, or the package's JavaScript)
    worker = new threads.Worker(new URL(import.meta.url.endsWith('.ts') ? './_defeature_worker.ts' : './_defeature_worker.js', import.meta.url))
    worker.on('error', () => lost(worker))
    worker.on('exit', () => lost(worker))
  } else {
    // (written as bundlers recognise a worker, which they then bundle)
    worker = new Worker(new URL('./_defeature_worker.js', import.meta.url), { type: 'module', name: PROBE_NAME })
    worker.onerror = () => lost(worker)
  }
  return worker
}

/** A probe worker that failed or ended on its own: the next job starts a new one. */
function lost(worker: Any): void {
  if (probe === worker) probe = null
}

function onMessage(message: Any): void {
  if (message.kill) {
    const worker = probe
    probe = null
    worker?.terminate()
    return
  }
  probe ??= start()
  probe.postMessage(message, (message.bodies as Uint8Array[]).map((b) => b.buffer))
}

const port = threads?.parentPort
if (port) port.on('message', onMessage)
else (globalThis as Any).onmessage = (event: MessageEvent) => onMessage(event.data)
