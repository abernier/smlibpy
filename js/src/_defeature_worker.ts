// The probe worker of the kernel's guard (`_isolated` in defeature.ts), which smlibpy does with a
// process of its own (smlibpy._guard): a kernel of its own, in a Web Worker or a Node worker
// thread, that does a kernel step on copies of the bodies. The caller waits for it with
// Atomics.wait; when the step takes too long, its supervisor (_defeature_supervisor.ts) terminates
// it, and a step that crashes the kernel here leaves the caller's kernel alone.
//
// A job is a message: the step (`op`), the bodies as the contents of .smb files, the step's
// arguments with faces and edges as their indices in their body, and `state`, a SharedArrayBuffer
// whose first Int32 this worker sets to RUNNING and then to DONE or CRASHED.
//
// A job with `data` (a SharedArrayBuffer) is a step whose result comes back (the caller never does
// it itself): the step's value with its bodies as .smb files (see `make`), or the step's error as
// JSON, go to the caller in pieces through `data`. For each, this worker puts the piece's length
// in the second Int32 of `state`, sets the first to PIECE and waits until the caller has taken it
// (and set it back to RUNNING); then it sets DONE, or FAILED after an error. A job without `data`
// (`_guarded`, which smlibwasm no longer uses) only runs: the caller does the step itself once it
// is known to finish.

import { _crashes } from './_errors.ts'

// biome-ignore lint: the kernel's results are what their bindings return
type Any = any

// (a crash here kills this worker, and the caller says so: no warning of this kernel's own)
_crashes.next = null

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

/** Colors and names of faces (`ext.face_attrs` of the same body) on the faces of a Brep in its
 * order, as shapes.ts's `_putFaceAttrs` (kernel plan T5). */
function putFaceAttrs({ ext, k }: Any, brep: number, [colors, names]: Any[][]): void {
  const faces: number[] = k.brep_faces(brep)
  if (faces.length !== colors.length || faces.length !== names.length) return
  let pick = colors.flatMap((c: Any, i: number) => (c != null && c.length === 3 ? [i] : []))
  if (pick.length) ext.set_face_colors(brep, pick.map((i: number) => faces[i]), pick.map((i: number) => Array.from(colors[i], Number)))
  pick = names.flatMap((n: Any, i: number) => (n ? [i] : []))
  if (pick.length) ext.set_face_names(brep, pick.map((i: number) => faces[i]), pick.map((i: number) => String(names[i])))
}

/**
 * What a step whose result comes back made (`_isolated` in defeature.ts), for the caller: a header
 * (its length as a 32-bit little-endian number, then JSON: the step's value, in which each body is
 * `{ $body: i }`, the sizes of the bodies, and per body the tags of its faces and edges and its faces'
 * colors and names, which .smb files do not hold: kernel plan T3, T5) followed by each body's binary
 * .smb file. The job's `tags` are those of its bodies (shapes.ts's `_carried`). The bodies the step
 * was given and those it made are freed here.
 */
function make(kernelModule: Any, job: Any): Uint8Array {
  const { ext, k, module } = kernelModule
  const breps: number[] = [] // the bodies the step was given
  const made: number[] = [] // the bodies of its value
  const owned: number[] = [] // others to free (a Boolean's result while it is made)
  const body = (brep: number | null | undefined): { $body: number } | null => {
    if (!brep) return null
    if (!made.includes(brep)) made.push(brep)
    return { $body: made.indexOf(brep) }
  }
  try {
    ;(job.bodies as Uint8Array[]).forEach((data, i) => {
      breps.push(load(kernelModule, data))
      const tags = job.tags?.[i]
      if (tags) ext.set_topology_tags(breps[i], tags[0], tags[1])
      if (tags?.[2]) putFaceAttrs(kernelModule, breps[i], tags[2])
    })
    const pick = (brep: number, kind: string, indices: readonly number[]): number[] => {
      const all = k[`brep_${kind}`](brep) as number[]
      return indices.map((i) => all[i])
    }
    let value: unknown
    if (job.op === 'shell_brep') {
      value = body(k.shell_brep(breps[0], job.distance, { ...job.options, faces_to_shell: pick(breps[0], 'faces', job.faces) }))
    } else if (job.op === 'offset_brep') {
      value = body(k.offset_brep(breps[0], job.distance, job.options))
    } else if (job.op === 'defeature') {
      const r = k.defeature.defeature(breps[0], (job.groups as number[][]).map((g) => pick(breps[0], 'faces', g)), job.rebuild)
      value = { added: r.added, applied: r.applied, brep: body(r.brep) }
    } else if (job.op === 'remove_fillet_faces') {
      const r = k.defeature.remove_fillet_faces(breps[0], pick(breps[0], 'faces', job.faces))
      value = { brep: body(r.brep), removed: Array.from(r.removed as ArrayLike<boolean>, Boolean) }
    } else if (job.op === 'surface_fillet') {
      const [a, b] = breps.map((brep) => k.face_surface(pick(brep, 'faces', [0])[0]))
      value = body(k.surface_surface_fillet(a, b, job.options))
    } else if (job.op === 'fillet_preview') {
      // the kernel's preview of rounds: a sheet per round surface
      const surfaces = k.fillet_preview(breps[0], pick(breps[0], 'edges', job.edges), { radius: job.distance }) as number[]
      try {
        value = surfaces.map((srf) => body(ext.face_from_surface(srf)))
      } finally {
        for (const srf of surfaces) ext.delete_surface(srf)
      }
    } else if (job.op === 'region_shells') {
      value = (ext.region_shells(breps[0]) as number[][]).map((shells) => shells.map((b) => body(b)))
    } else if (job.op === 'boolean') {
      // (copies combined one after the other, as Part._runBoolean does: the kernel deletes a tool's
      // copy when it succeeds and keeps it when it fails)
      let result = k.brep_copy(breps[0])
      owned.push(result)
      for (const tool of breps.slice(1)) {
        const copy = k.brep_copy(tool)
        let combined: number
        try {
          combined = ext.boolean(result, copy, job.operation, job.nonManifold)
        } catch (e) {
          ext.delete_brep(copy)
          throw e
        }
        if (combined !== result) {
          // (a seam turned: the kernel made a new Brep and deleted both operands)
          owned.splice(owned.indexOf(result), 1, combined)
          result = combined
        }
      }
      value = body(result)
    } else if (job.op === 'round_edges') {
      // a fillet or chamfer of a copy's edges by the fillet executive: the kernel changes that body,
      // and its record says how it failed
      const [radii, sections, radii2, faces, law, continuity, thumbweight, toleranceFactor, mitre, chains, lawAt, lawRadii, setback] = job.args as Any[]
      ext.clear_kernel_trace()
      const record = ext.round_edges(breps[0], pick(breps[0], 'edges', job.edges), radii, sections, radii2, pick(breps[0], 'faces', faces), law,
        continuity, thumbweight, toleranceFactor, mitre, chains ?? [], lawAt ?? [], lawRadii ?? [], setback ?? 0)
      // (where the kernel gave up, KernelError.trace)
      value = { brep: body(breps[0]), record: record.status == null ? record : { ...record, trace: ext.kernel_trace()[0] } }
    } else {
      throw new TypeError(`no kernel step ${job.op}`)
    }
    const files = made.map((brep, i) => {
      const name = `/tmp/smlibwasm-probe-result-${i}.smb`
      k.brep_write_to_file(brep, name, false)
      try {
        return module.FS.readFile(name) as Uint8Array
      } finally {
        module.FS.unlink(name)
      }
    })
    const marks = made.map((brep) => [...ext.topology_tags(brep), ext.face_attrs(brep)])
    const header = new TextEncoder().encode(JSON.stringify({ value, sizes: files.map((f) => f.length), marks }))
    const out = new Uint8Array(4 + header.length + files.reduce((n, f) => n + f.length, 0))
    new DataView(out.buffer).setUint32(0, header.length, true)
    out.set(header, 4)
    files.reduce((at, f) => (out.set(f, at), at + f.length), 4 + header.length)
    return out
  } finally {
    for (const brep of new Set([...made, ...breps, ...owned])) ext.delete_brep(brep)
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
        const error: Record<string, unknown> = e instanceof Error ? { name: e.name, message: e.message } : { name: 'Error', message: String(e) }
        // (with the kernel's trace: a KernelError's, a kernel function's failure this kernel's)
        const trace = (e as { trace?: unknown } | null)?.trace
        if (e instanceof Error && Array.isArray(trace)) error.trace = trace
        else if (e instanceof Error && e.constructor === Error) error.trace = loaded.ext.kernel_trace()[0]
        bytes = new TextEncoder().encode(JSON.stringify(error))
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
