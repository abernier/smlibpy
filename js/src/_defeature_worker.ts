// The probe worker of defeature's guard (`_guarded` in defeature.ts), which smlibpy does with a
// forked copy of its process: a kernel of its own, in a Web Worker or a Node worker thread, that
// does a kernel step first on copies of the bodies. The caller waits for it with Atomics.wait;
// when the step takes too long, its supervisor (_defeature_supervisor.ts) terminates it, and a
// step that crashes the kernel here leaves the caller's kernel alone.
//
// A job is a message: the step (`op`), the bodies as the contents of .smb files, the step's
// arguments with faces as their indices in their body, and `state`, a SharedArrayBuffer whose
// first Int32 this worker sets to RUNNING and then to DONE or CRASHED. What the step returns or
// throws does not matter: the caller does the step itself once it is known to finish.

// biome-ignore lint: the kernel's results are what their bindings return
type Any = any

// The kernel, imported once the message handler is in place (at the end): a browser drops the
// messages that come while a module worker waits at its top level, and the kernel's module waits
// for the kernel to load.
const kernel = import('./kernel.ts')

// The states of a job, as defeature.ts has them: running; done (the step returned, or failed as
// the kernel fails); crashed (a trap of the module).
const RUNNING = 1
const DONE = 2
const CRASHED = 3

/** The Brep of an .smb file's contents. */
function load({ k, module }: Any, data: Uint8Array): number {
  const name = '/tmp/smlibwasm-probe.smb'
  module.FS.writeFile(name, data)
  try {
    return k.read_brep_from_file(name, null, false)
  } finally {
    module.FS.unlink(name)
  }
}

function run(kernelModule: Any, job: Any): void {
  const { ext, k } = kernelModule
  const breps: number[] = []
  let made = 0
  try {
    for (const data of job.bodies as Uint8Array[]) breps.push(load(kernelModule, data))
    const faces = (brep: number, indices: readonly number[]): number[] => {
      const all = k.brep_faces(brep) as number[]
      return indices.map((i) => all[i])
    }
    if (job.op === 'defeature') {
      made = k.defeature.defeature(breps[0], (job.groups as number[][]).map((g) => faces(breps[0], g)), job.rebuild).brep ?? 0
    } else if (job.op === 'remove_fillet_faces') {
      made = k.defeature.remove_fillet_faces(breps[0], faces(breps[0], job.faces)).brep ?? 0
    } else if (job.op === 'surface_fillet') {
      const [a, b] = breps.map((brep) => k.face_surface(faces(brep, [0])[0]))
      made = k.surface_surface_fillet(a, b, job.options) ?? 0
    } else {
      throw new TypeError(`no kernel step ${job.op}`)
    }
  } finally {
    for (const brep of made ? [made, ...breps] : breps) ext.delete_brep(brep)
  }
}

async function onJob(job: Any): Promise<void> {
  const loaded = await kernel
  const state = new Int32Array(job.state)
  Atomics.store(state, 0, RUNNING)
  Atomics.notify(state, 0)
  let outcome = DONE
  try {
    run(loaded, job)
  } catch (e) {
    if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) outcome = CRASHED
  }
  Atomics.store(state, 0, outcome)
  Atomics.notify(state, 0)
}

const port = (globalThis as Any).process?.getBuiltinModule?.('node:worker_threads')?.parentPort
if (port) port.on('message', onJob)
else (globalThis as Any).onmessage = (event: MessageEvent) => onJob(event.data)
