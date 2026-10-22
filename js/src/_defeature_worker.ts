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
//
// A job with `data` (a SharedArrayBuffer) is a step whose body comes back (`_isolated` in
// defeature.ts; the caller never does it itself): the contents of the body's .smb file, or the
// step's error as JSON, go to the caller in pieces through `data`. For each, this worker puts the
// piece's length in the second Int32 of `state`, sets the first to PIECE and waits until the caller
// has taken it (and set it back to RUNNING); then it sets DONE, or FAILED after an error.

// biome-ignore lint: the kernel's results are what their bindings return
type Any = any

// The kernel, imported once the message handler is in place (at the end): a browser drops the
// messages that come while a module worker waits at its top level, and the kernel's module waits
// for the kernel to load.
const kernel = import('./kernel.ts')

// The states of a job, as defeature.ts has them: running; done (the step returned, or failed as
// the kernel fails); crashed (a trap of the module); a piece of the result is in `data`; failed (the
// pieces were the step's error).
const RUNNING = 1
const DONE = 2
const CRASHED = 3
const PIECE = 4
const FAILED = 5

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

/** The contents of the .smb file of the body a step whose body comes back makes. */
function make(kernelModule: Any, job: Any): Uint8Array {
  const { ext, k, module } = kernelModule
  const breps: number[] = []
  let made = 0
  try {
    for (const data of job.bodies as Uint8Array[]) breps.push(load(kernelModule, data))
    const all = k.brep_faces(breps[0]) as number[]
    if (job.op === 'shell_brep') {
      made = k.shell_brep(breps[0], job.distance, { ...job.options, faces_to_shell: (job.faces as number[]).map((i) => all[i]) })
    } else if (job.op === 'offset_brep') {
      made = k.offset_brep(breps[0], job.distance, job.options)
    } else {
      throw new TypeError(`no kernel step ${job.op}`)
    }
    const name = '/tmp/smlibwasm-probe-result.smb'
    k.brep_write_to_file(made, name, false)
    try {
      return module.FS.readFile(name)
    } finally {
      module.FS.unlink(name)
    }
  } finally {
    for (const brep of made ? [made, ...breps] : breps) ext.delete_brep(brep)
  }
}

/** Hands `bytes` to the caller through `data`, a piece at a time (see above). */
function send(state: Int32Array, data: Uint8Array, bytes: Uint8Array): void {
  for (let at = 0; at < bytes.length; at += data.length) {
    const piece = bytes.subarray(at, at + data.length)
    data.set(piece)
    Atomics.store(state, 1, piece.length)
    Atomics.store(state, 0, PIECE)
    Atomics.notify(state, 0)
    Atomics.wait(state, 0, PIECE)
  }
}

async function onJob(job: Any): Promise<void> {
  const loaded = await kernel
  const state = new Int32Array(job.state)
  Atomics.store(state, 0, RUNNING)
  Atomics.notify(state, 0)
  let outcome = DONE
  if (job.data) {
    let bytes: Uint8Array | null = null
    try {
      bytes = make(loaded, job)
    } catch (e) {
      if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) outcome = CRASHED
      else {
        outcome = FAILED
        bytes = new TextEncoder().encode(JSON.stringify({ message: e instanceof Error ? e.message : String(e) }))
      }
    }
    if (bytes !== null) send(state, new Uint8Array(job.data), bytes)
  } else {
    try {
      run(loaded, job)
    } catch (e) {
      if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) outcome = CRASHED
    }
  }
  Atomics.store(state, 0, outcome)
  Atomics.notify(state, 0)
}

const port = (globalThis as Any).process?.getBuiltinModule?.('node:worker_threads')?.parentPort
if (port) port.on('message', onJob)
else (globalThis as Any).onmessage = (event: MessageEvent) => onJob(event.data)
