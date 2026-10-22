// Removing fillets and other faces from parts (defeaturing).
//
// The kernel does the work, on a copy of the part:
//
// - SMLib's fillet removal (SmFilletRemoval) takes out a fillet that runs between two faces and
//   ends at sharp edges, and extends those two faces to their sharp edge again.
// - SMLib's feature executive (SmFeatureExecutive) cuts a connected set of faces out and closes
//   the hole by extending the faces around it, or with a flat cap. It takes out fillets that meet
//   at corner patches, fillets around bosses and holes, and holes, bosses and pockets.
//
// Every result is checked: a valid solid, and a volume that went the right way (up where convex
// fillets or holes were taken out, down for concave fillets and bosses).
//
// SMLib's patching and Boolean code can crash or loop on some parts. smlibpy runs each kernel
// step first in a forked copy of the process (on Linux and macOS). JavaScript cannot fork; where
// it can wait for another thread (Node, and Web Workers of a cross-origin isolated page), each
// step runs first in a probe worker, a kernel of its own, on copies of the bodies (see
// GUARD_SECONDS). On a browser's main thread the kernel runs directly, as smlibpy's does with
// GUARD_SECONDS = 0: a crash of the kernel there (a trap of the WebAssembly module) ends the
// operation with a ModelingError, as it would end smlibpy's process, and a step that loops does not
// come back.

import { BrepHandle, ModelingError, _warn, ext, k, kernelCall, module } from './kernel.ts'
import { _formatG } from './geometry.ts'
import { type Edge, Face, type Part, ShapeList, type _Body, _flattenFaces } from './shapes.ts'
import { toSmb } from './exporters.ts'
import { _giveUp, _noProbe, _probeMissing, _probeSupervisor } from './_guard.ts'

// biome-ignore lint: the kernel's results are what their bindings return
type Any = any

/** Angle (degrees) between the normals of two faces along an edge below which the faces meet
 * tangentially: the edge is a rail of a fillet. */
export const TANGENCY = 2.0

/**
 * Seconds the kernel may take for one step that can crash or loop. Where JavaScript can wait for
 * another thread (Node, and Web Workers of a cross-origin isolated page), such steps run in a probe
 * worker, a kernel of its own, on copies of the bodies: if the kernel crashes there or takes longer
 * than this, a ModelingError says so and this kernel is left alone (SMLib's patching, offset and
 * Boolean code can crash or loop on some parts). This kernel never runs the step itself: what the
 * step made comes back as an exact copy (binary `.smb`). The steps are those of `removeFillets`,
 * `removeFaces`, `surfaceFillet`, `shell`, `offset`, `thicken` and `Part.cells()`, fillets and
 * chamfers of parts read from files (STEP, `.smb`, USD) and, with GUARD_BOOLEANS, Booleans. `0`
 * runs the kernel directly, as on a browser's main thread, where a step that loops does not come
 * back. Python's `GUARD_SECONDS`; `setGuardSeconds` sets it.
 */
export let GUARD_SECONDS = 20.0

/**
 * Whether every Boolean (`fuse`, `cut`, `intersect`, `merge`) runs in the probe worker too, as the
 * steps of GUARD_SECONDS (off by default: the bodies go there and back as `.smb`). For long batch
 * runs over unknown inputs, where a crash of the kernel must not end the run. Python's
 * `GUARD_BOOLEANS`; `setGuardBooleans` sets it.
 */
export let GUARD_BOOLEANS = false

/** Sets GUARD_BOOLEANS (Python's `smlibpy.defeature.GUARD_BOOLEANS = on`); returns the value it
 * had. */
export function setGuardBooleans(on: boolean): boolean {
  if (typeof on !== 'boolean') throw new TypeError(`setGuardBooleans: on must be true or false, got ${typeof on}`)
  const old = GUARD_BOOLEANS
  GUARD_BOOLEANS = on
  return old
}

/** Sets GUARD_SECONDS (Python's `smlibpy.defeature.GUARD_SECONDS = seconds`); returns the value it
 * had. */
export function setGuardSeconds(seconds: number): number {
  if (!(Number(seconds) >= 0)) throw new RangeError(`setGuardSeconds: the seconds must be 0 or more, got ${seconds}`)
  const old = GUARD_SECONDS
  GUARD_SECONDS = Number(seconds)
  return old
}

const _D = k.defeature
const _VOLUMES = new WeakMap<BrepHandle, number>() // a body's handle -> its volume

/** The kernel crashed in a step, or did not finish; `reason` says how. `here`: it crashed in this
 * kernel (no probe worker), whose memory may be damaged now: the operation ends there, where a crash
 * in the probe worker only drops the step. */
class _KernelFault extends ModelingError {
  readonly reason: string
  readonly here: boolean

  constructor(what: string, reason: string, hint: string, here = false) {
    super(`${what}: ${reason}; ${hint}`)
    this.name = '_KernelFault'
    this.reason = reason
    this.here = here
  }
}

/** The _KernelFault of a trap of this kernel in the step `what`. */
function _crashHere(what: string, e: Error): _KernelFault {
  const hint = 'its memory may be damaged: load the module again before relying on its results, or run the step in a KernelWorker, which starts a new kernel after a crash'
  return new _KernelFault(what, `the kernel crashed (${e.message})`, hint, true)
}

/** A kernel step for the probe worker (see _defeature_worker.ts): the step, the bodies it works on
 * as the contents of .smb files, and its arguments, faces as their indices in their body. */
export type _Job = { op: string; bodies: Uint8Array[]; [argument: string]: unknown }

/**
 * `work()`, after a probe worker has done the same kernel step (`job`) to the end (see
 * GUARD_SECONDS). The kernel is deterministic and the worker works on exact copies, so it does what
 * this kernel will do; a step that takes too long or crashes there becomes a _KernelFault, and the
 * step is dropped as smlibpy drops one in its forked copy. Without a probe worker (a browser's
 * main thread) a trap of the WebAssembly module here (the kernel crashed) becomes a _KernelFault
 * whose `here` is true: this kernel's memory may be damaged.
 * Superseded by `_isolatedValue`, which brings the worker's result back instead of doing the step
 * again here.
 */
export function _guarded<R>(what: string, work: () => R, job: (() => _Job) | null = null): R {
  const limit = Number(GUARD_SECONDS)
  if (limit > 0 && job !== null) _probe(what, job, limit)
  try {
    return work()
  } catch (e) {
    if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) throw _crashHere(what, e)
    throw e
  }
}

/** The contents of an .smb file of a body, for the probe worker (binary: exact). */
export function _smb(body: _Body): Uint8Array {
  return toSmb(body, { ascii: false })
}

/** The contents of an .smb file of a kernel Brep (binary: exact). */
export function _smbOf(brep: number): Uint8Array {
  const name = `/tmp/smlibwasm-job-${++_results}.smb`
  try {
    kernelCall('save', () => k.brep_write_to_file(brep, name, false))
    return module.FS.readFile(name) as Uint8Array
  } finally {
    try {
      module.FS.unlink(name)
    } catch {
      // (not written)
    }
  }
}

/** The indices of faces in their body, for the probe worker. */
export function _indices(body: _Body, faces: readonly Face[]): number[] {
  return Array.from(ext.face_indices(body._brep, faces.map((f) => f._f)) as ArrayLike<number>, Number)
}

// The states of a job, as _defeature_worker.ts sets them (see there).
const _QUEUED = 0
const _RUNNING = 1
const _CRASHED = 3
const _PIECE = 4
const _FAILED = 5
/** Bytes of a result that the probe worker hands over at a time. */
const _PIECE_BYTES = 1 << 20
/** Seconds a new probe worker may take to load its kernel and start the first step. */
const _START_SECONDS = 30.0

let _toldMissing = false

/** The probe worker's supervisor (see `_probeSupervisor`); says once when its files are missing. */
function _supervisor(what: string): Any {
  const supervisor = _probeSupervisor()
  if (supervisor === null && _probeMissing() && !_toldMissing) {
    _toldMissing = true
    _warn(`${what}: ${_noProbe()}; the kernel steps that can crash (of removeFillets, removeFaces, surfaceFillet, shell, offset, thicken and cells) run in this kernel, without a time limit`)
  }
  return supervisor
}

/** Runs the job in the probe worker; throws a _KernelFault if it takes longer than `limit` seconds
 * or crashes the kernel there. Returns at once where there is no probe worker. */
function _probe(what: string, job: () => _Job, limit: number): void {
  const supervisor = _supervisor(what)
  if (supervisor === null) return
  const j = job()
  const state = new Int32Array(new SharedArrayBuffer(4))
  supervisor.postMessage({ ...j, state: state.buffer }, j.bodies.map((b) => b.buffer))
  // (a new probe worker loads its kernel first)
  Atomics.wait(state, 0, _QUEUED, _START_SECONDS * 1000)
  if (Atomics.load(state, 0) === _QUEUED) {
    _giveUp(`the probe worker did not start within ${_formatG(_START_SECONDS)} s`)
    _warn(`${what}: ${_noProbe()}; the kernel steps of removeFillets, removeFaces and surfaceFillet run without a time limit from now on`)
    return
  }
  Atomics.wait(state, 0, _RUNNING, limit * 1000)
  const outcome = Atomics.load(state, 0)
  if (outcome === _RUNNING) {
    supervisor.postMessage({ kill: true })
    throw new _KernelFault(what, `the kernel did not finish within ${_formatG(limit)} s`, 'setGuardSeconds(seconds) sets the limit')
  }
  if (outcome === _CRASHED) {
    supervisor.postMessage({ kill: true }) // (its kernel may be damaged)
    throw new _KernelFault(what, 'the kernel crashed (in a probe worker, a kernel of its own)', 'this kernel is fine')
  }
}

/**
 * The body (a kernel Brep) `work()` makes, made by the probe worker from `job` (see `_isolatedValue`);
 * the kernel error it fails with there is thrown here as a KernelError of `what` with `hint`.
 */
export function _isolated(what: string, work: () => number, job: () => _Job, hint: string | null = null): number {
  try {
    return _isolatedValue(what, work, job)
  } catch (e) {
    if (e instanceof _KernelFault) throw e // (a crash, or a step that did not finish)
    return kernelCall(
      what,
      () => {
        throw e
      },
      hint,
    )
  }
}

/**
 * What `work()` returns, made by the probe worker (a kernel of its own, see GUARD_SECONDS) from
 * exact copies of the bodies (`job`): its value, whose bodies (kernel Breps, also in arrays and
 * objects) come back as exact copies (binary .smb files), owned by the caller. This kernel never
 * runs the step: one that crashes the kernel there or does not finish is a _KernelFault, and the
 * error it fails with there is thrown here (a TypeError or RangeError as itself, a failure of the
 * kernel as an Error with its message, as the kernel's bindings throw it). Python's
 * `smlibpy._guard.isolated`. Without a probe worker (a browser's main thread), or with
 * GUARD_SECONDS = 0, `work()` runs here; with `trap`, a trap there (the kernel crashed) is a
 * _KernelFault whose `here` is true (this kernel's memory may be damaged).
 */
export function _isolatedValue<R>(what: string, work: () => R, job: () => _Job, options: { trap?: boolean } = {}): R {
  const limit = Number(GUARD_SECONDS)
  const supervisor = limit > 0 ? _supervisor(what) : null
  const here = (): R => {
    try {
      return work()
    } catch (e) {
      if (options.trap && typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) throw _crashHere(what, e)
      throw e
    }
  }
  if (supervisor === null) return here()
  const j = job()
  const state = new Int32Array(new SharedArrayBuffer(8))
  const data = new Uint8Array(new SharedArrayBuffer(_PIECE_BYTES))
  supervisor.postMessage({ ...j, state: state.buffer, data: data.buffer }, j.bodies.map((b) => b.buffer))
  // (a new probe worker loads its kernel first)
  Atomics.wait(state, 0, _QUEUED, _START_SECONDS * 1000)
  if (Atomics.load(state, 0) === _QUEUED) {
    _giveUp(`the probe worker did not start within ${_formatG(_START_SECONDS)} s`)
    _warn(`${what}: ${_noProbe()}; the kernel steps that can crash run in this kernel from now on`)
    return here()
  }
  const deadline = Date.now() + limit * 1000
  const pieces: Uint8Array[] = []
  for (;;) {
    // (once the first piece came, the step is done, and the rest comes at once)
    Atomics.wait(state, 0, _RUNNING, pieces.length ? _START_SECONDS * 1000 : Math.max(deadline - Date.now(), 0))
    const outcome = Atomics.load(state, 0)
    if (outcome === _PIECE) {
      pieces.push(data.slice(0, Atomics.load(state, 1)))
      Atomics.store(state, 0, _RUNNING)
      Atomics.notify(state, 0)
      continue
    }
    if (outcome === _RUNNING) {
      supervisor.postMessage({ kill: true })
      throw new _KernelFault(what, `the kernel did not finish within ${_formatG(limit)} s`, 'setGuardSeconds(seconds) sets the limit')
    }
    if (outcome === _CRASHED) {
      supervisor.postMessage({ kill: true }) // (its kernel may be damaged)
      throw new _KernelFault(what, 'the kernel crashed (in a probe worker, a kernel of its own)', 'this kernel is fine')
    }
    const bytes = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0))
    pieces.reduce((at, p) => (bytes.set(p, at), at + p.length), 0)
    if (outcome === _FAILED) {
      const { name, message, trace } = JSON.parse(new TextDecoder().decode(bytes))
      if (name === 'TypeError') throw new TypeError(message)
      if (name === 'RangeError') throw new RangeError(message)
      const error = new Error(String(message))
      if (Array.isArray(trace)) (error as Any)._kernelTrace = trace // (kernelCall makes it the KernelError's trace)
      throw error
    }
    return _decoded(bytes) as R
  }
}

/** The value of a step's result (see `make` in _defeature_worker.ts), its bodies read back (and
 * freed again if that fails). */
function _decoded(bytes: Uint8Array): unknown {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
  const { value, sizes } = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) as { value: unknown; sizes: number[] }
  const starts: number[] = []
  sizes.reduce((at, n) => (starts.push(at), at + n), 4 + length)
  const loaded = new Map<number, number>()
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === 'object') {
      const i = (v as { $body?: number }).$body
      if (typeof i === 'number') {
        if (!loaded.has(i)) loaded.set(i, _loaded(bytes.subarray(starts[i], starts[i] + sizes[i])))
        return loaded.get(i)
      }
      return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, walk(x)]))
    }
    return v
  }
  try {
    return walk(value)
  } catch (e) {
    for (const brep of loaded.values()) ext.delete_brep(brep)
    throw e
  }
}

/** The Brep of an .smb file's contents. */
function _loaded(bytes: Uint8Array): number {
  const name = `/tmp/smlibwasm-result-${++_results}.smb`
  module.FS.writeFile(name, bytes)
  try {
    return kernelCall('load', () => k.read_brep_from_file(name, null, false))
  } finally {
    module.FS.unlink(name)
  }
}
let _results = 0

// ============================================================================= recognising fillets
/** Cached blend data of faces (kernel face -> object or null). */
export class _Blends {
  _info = new Map<number, Any>() // kernel face -> its blend info

  info(f: Face): Any {
    const key = f._f
    if (!this._info.has(key)) this._info.set(key, _D.blend_info(f._f, TANGENCY))
    return this._info.get(key)
  }

  _railed(f: Face): boolean {
    const i = this.info(f)
    return i !== null && i.rails.length >= 2
  }

  /** A curved face that meets two other faces tangentially along edges that run across its
   * curvature (its rails), where those faces are walls, not fillets themselves. */
  isEdgeFillet(f: Face): boolean {
    if (!this._railed(f)) return false
    let walls = 0
    for (const e of this.info(f).rails as number[]) {
      for (const kf of k.edge_faces(e) as number[]) {
        if (kf !== f._f && !this._railed(new Face(f._owner, kf))) walls += 1
      }
    }
    return walls >= 2
  }

  /** The edge fillets a corner patch joins, or [] if `f` is no corner patch: a curved face with
   * three or more edges that is no edge fillet, meets all its neighbours tangentially, joins at
   * least two edge fillets and is curved about as tightly as they are. (A wall between two
   * fillets, such as the side of a disc rounded at both ends, is no corner.) */
  cornerFillets(f: Face): Face[] {
    const i = this.info(f)
    if (i === null || i.sharp.length || i.edges < 3 || this.isEdgeFillet(f)) return []
    const out = f.neighbors().filter((g) => this.isEdgeFillet(g))
    if (out.length < 2 || i.radius > 2.0 * Math.max(...out.map((g) => Number(this.info(g).radius)))) return []
    return [...out]
  }

  /** The fillet radius of an edge fillet, or of the fillets a corner patch joins. */
  radius(f: Face): number {
    if (this.isEdgeFillet(f)) return Number(this.info(f).radius)
    const radii = this.cornerFillets(f).map((g) => Number(this.info(g).radius))
    return radii.length ? Math.max(...radii) : Number.NaN
  }

  convex(f: Face): boolean {
    if (this.isEdgeFillet(f)) return Boolean(this.info(f).convex)
    return this.cornerFillets(f).every((g) => Boolean(this.info(g).convex))
  }
}

function _radiusOk(r: number, maxRadius: number | null): boolean {
  return maxRadius === null || r <= maxRadius * (1 + 1e-9) + 1e-12
}

function _has(faces: readonly Face[], f: Face): boolean {
  return faces.some((g) => g.equals(f))
}

/** The fillets among `faces` (see `ShapeList.fillets`). */
export function filletFaces(faces: Iterable<unknown>, maxRadius: number | null = null, options: { _blends?: _Blends | null } = {}): ShapeList<Face> {
  if (maxRadius != null && !(maxRadius > 0)) throw new RangeError('fillets: maxRadius must be positive')
  const max = maxRadius ?? null
  const b = options._blends ?? new _Blends()
  const out = new ShapeList<Face>()
  for (const f of faces) {
    if (!(f instanceof Face)) continue
    if (b.isEdgeFillet(f)) {
      if (_radiusOk(b.radius(f), max)) out.push(f)
      continue
    }
    const corner = b.cornerFillets(f)
    if (corner.length && corner.every((g) => _radiusOk(b.radius(g), max))) out.push(f)
  }
  return out
}

// ============================================================================= removing faces
/** The faces split into sets connected through shared edges. */
function _groups(faces: readonly Face[]): Face[][] {
  const index = new Map<string, number>()
  faces.forEach((f, i) => index.set(f._identity(), i))
  const parent = faces.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  faces.forEach((f, i) => {
    for (const g of f.neighbors()) {
      const j = index.get(g._identity())
      if (j !== undefined) parent[find(i)] = find(j)
    }
  })
  const groups = new Map<number, Face[]>()
  faces.forEach((f, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(f)
  })
  return [...groups.values()]
}

function _isIterable(x: unknown): boolean {
  return x != null && typeof (x as Any)[Symbol.iterator] === 'function'
}

function _facesOf(part: Part, faces: unknown, what: string): Face[] {
  if (faces instanceof Face || _isIterable(faces)) {
    if (!_flattenFaces(faces).length) throw new RangeError(`${what}: no faces selected`)
  }
  const own = part._ownFaces(faces)
  const seen = new Set<number>()
  const out: Face[] = []
  for (const kf of own) {
    if (!seen.has(kf)) {
      seen.add(kf)
      out.push(new Face(part, kf))
    }
  }
  return out
}

/** The faces of `body` that hold the interior points of `faces` (faces of an earlier version of
 * the body). */
function _match(body: Part, faces: readonly Face[]): Face[] {
  const tol = 1e-7 * Math.max(1.0, body.bbox().diagonal)
  const own = [...body.faces()]
  const out: Face[] = []
  for (const f of faces) {
    const p = f.interiorPoint()
    const hits = own.filter((g) => g.distanceTo(p) <= tol)
    for (const g of hits) if (!_has(out, g)) out.push(g)
  }
  return out
}

/** The volume, integrated precisely once per body (a body does not change). */
function _volume(part: Part): number {
  const hit = _VOLUMES.get(part._h)
  if (hit !== undefined) return hit
  const v = Number(part._props(1e-9).volume)
  _VOLUMES.set(part._h, v)
  return v
}

/** What is wrong with a result, or null. `expect`: +1 volume must grow, -1 shrink, 0 any. */
function _problem(before: number, result: Part, expect: number, bound: number | null): string | null {
  const problem = result._solidProblem()
  if (problem !== null) return `a body that is ${problem}`
  const after = _volume(result)
  const slack = 1e-9 * Math.max(Math.abs(before), 1.0)
  if (expect > 0 && !(after > before + slack)) return `a volume that did not grow (${_formatG(before)} -> ${_formatG(after)})`
  if (expect < 0 && !(after < before - slack)) return `a volume that did not shrink (${_formatG(before)} -> ${_formatG(after)})`
  if (bound !== null && Math.abs(after - before) > bound) {
    return `a volume change of ${_formatG(Math.abs(after - before))}, more than the fillets can make (${_formatG(bound)})`
  }
  return null
}

/** The most volume taking out the fillets can add or remove. A fillet of radius r on an edge
 * whose faces meet at an inside angle of 8 degrees or more fills at most 4 r times its area (90
 * degrees: 0.14 r). */
function _filletBound(b: _Blends, faces: readonly Face[]): number {
  let total = 0.0
  for (const f of faces) {
    const r = b.radius(f)
    total += 4.0 * f.area * (Number.isFinite(r) ? r : f.bbox().diagonal)
  }
  return total
}

/** The executive's patched copy of `body` without `groups` (null if it failed), and whether the
 * kernel crashed in the probe worker (a crash in this kernel ends the operation). */
function _executive(what: string, body: Part, groups: readonly (readonly Face[])[], rebuild: string): [Part | null, boolean] {
  let res: Any
  try {
    res = _isolatedValue(
      what,
      () => _D.defeature(body._brep, groups.map((g) => g.map((f) => f._f)), rebuild),
      () => ({ op: 'defeature', bodies: [_smb(body)], groups: groups.map((g) => _indices(body, g)), rebuild }),
      { trap: true },
    )
  } catch (e) {
    if (e instanceof _KernelFault && !e.here) return [null, true]
    throw e
  }
  return [res.brep === null ? null : body._like(res.brep), false]
}

/** A set of faces as a key (Python's frozenset of their identities). */
function _setKey(identities: Iterable<string>): string {
  return [...new Set(identities)].sort().join('|')
}

/** Take a set of fillet faces of `part` out, as far as the kernel can; every step is checked.
 * `origin` maps the faces to the faces of the part the user gave; sets of those on which the
 * kernel crashed (`faulted`) are not tried again. Returns the body and the original faces that
 * stayed. */
function _removePass(
  part: Part,
  faces: readonly Face[],
  origin0: Map<string, Face>,
  b: _Blends,
  expect: number,
  faulted: Set<string>,
): [Part, Face[]] {
  let body = part
  let pending = [...faces] // faces of `body`
  let origin = new Map<string, Face>()
  for (const f of faces) origin.set(f._identity(), origin0.get(f._identity()) ?? f)
  const triedA = new Set<string>() // face sets tried with the fillet removal
  const triedB = new Set<string>() // groups tried with the executive

  const key = (fs: readonly Face[]): string =>
    _setKey(fs.filter((f) => origin.has(f._identity())).map((f) => origin.get(f._identity())!._identity()))

  const radius = (g: readonly Face[]): number => {
    const radii = g.map((f) => b.radius(f)).filter((r) => Number.isFinite(r))
    return radii.length ? Math.min(...radii) : Infinity
  }

  let progress = true
  while (pending.length && progress) {
    progress = false
    // 1. Fillets with sharp ends, one by one (the kernel's fillet removal).
    const edge = pending.filter((f) => b.isEdgeFillet(f))
    if (edge.length && !triedA.has(key(edge)) && !faulted.has(key(edge))) {
      triedA.add(key(edge))
      let res: Any
      try {
        res = _isolatedValue(
          'removeFillets',
          () => _D.remove_fillet_faces(body._brep, edge.map((f) => f._f)),
          () => ({ op: 'remove_fillet_faces', bodies: [_smb(body)], faces: _indices(body, edge) }),
          { trap: true },
        )
      } catch (e) {
        if (!(e instanceof _KernelFault) || e.here) throw e // (a crash here: this kernel may be damaged)
        faulted.add(key(edge))
        res = { brep: null }
      }
      if (res.brep !== null) {
        const gone = edge.filter((_, i) => res.removed[i])
        const candidate = body._like(res.brep)
        if (_problem(_volume(body), candidate, expect, _filletBound(b, gone)) === null) {
          const rest = pending.filter((f) => !_has(gone, f))
          ;[pending, origin, body] = _carry(candidate, rest, origin)
          progress = true
        }
      }
    }
    // 2. Connected sets (with their corner patches, around bosses and holes): the executive,
    //    smallest radius first.
    const groups = _groups(pending)
      .map((g) => [radius(g), g] as [number, Face[]])
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
      .map(([, g]) => g)
    for (const group of groups) {
      if (triedB.has(key(group)) || faulted.has(key(group))) continue
      triedB.add(key(group))
      const [candidate, fault] = _executive('removeFillets', body, [group], 'extend')
      if (fault) faulted.add(key(group))
      if (candidate === null || _problem(_volume(body), candidate, expect, _filletBound(b, group)) !== null) continue
      const rest = pending.filter((f) => !_has(group, f))
      ;[pending, origin, body] = _carry(candidate, rest, origin)
      progress = true
      break // group again on the new body
    }
  }
  return [body, pending.filter((f) => origin.has(f._identity())).map((f) => origin.get(f._identity())!)]
}

/** `faces` (of an earlier version of `next`) as faces of `next`, with their faces of the original
 * part. */
function _carry(next: Part, faces: readonly Face[], origin: Map<string, Face>): [Face[], Map<string, Face>, Part] {
  const moved: Face[] = []
  const mapping = new Map<string, Face>()
  for (const f of faces) {
    for (const g of _match(next, [f])) {
      if (!_has(moved, g)) {
        moved.push(g)
        mapping.set(g._identity(), origin.get(f._identity()) ?? f)
      }
    }
  }
  return [moved, mapping, next]
}

/** See `Part.removeFillets`. */
export function removeFillets(part: Part, faces: unknown = null, options: { maxRadius?: number | null; partial?: boolean } = {}): Part {
  const maxRadius = options.maxRadius ?? null
  const partial = options.partial ?? false
  part._requireValid('removeFillets')
  const b = new _Blends()
  let sel: Face[]
  if (faces == null) {
    sel = [...filletFaces(part.faces(), maxRadius, { _blends: b })]
    if (!sel.length) return part
  } else {
    const given = _facesOf(part, faces, 'removeFillets')
    sel = [...filletFaces(given, maxRadius, { _blends: b })]
    if (maxRadius === null && sel.length !== given.length) {
      const others = given.filter((f) => !_has(sel, f))
      const kinds = [...new Set(others.map((f) => f.geomType))].sort()
      throw new ModelingError(
        `removeFillets: ${others.length} of the faces are no fillets (${kinds.join(', ')}); a fillet meets two faces tangentially along its length. Select fillets with part.faces().fillets(), or take other faces out with removeFaces`,
      )
    }
    if (!sel.length) return part
  }
  // Corner patches go with their fillets: a fillet whose corner patch stays cannot go.
  for (const f of [...sel]) {
    for (const g of f.neighbors()) {
      if (!_has(sel, g) && b.cornerFillets(g).length && b.cornerFillets(g).every((c) => _has(sel, c))) sel.push(g)
    }
  }
  const groups = _groups(sel)
  // Concave fillets first, then convex ones, then sets that mix both; one kind can make room for
  // the other, so the round repeats while it takes fillets out.
  const left = new Map<number, Face[]>()
  left.set(-1, groups.filter((g) => !g.some((f) => b.convex(f))).flat())
  left.set(1, groups.filter((g) => g.every((f) => b.convex(f))).flat())
  left.set(0, sel.filter((f) => !_has(left.get(-1)!, f) && !_has(left.get(1)!, f)))
  let body = part
  const faulted = new Set<string>() // sets of the user's faces the kernel crashed on
  let progress = true
  while (progress) {
    progress = false
    for (const expect of [-1, 1, 0]) {
      const these = left.get(expect)!
      if (!these.length) continue
      const [todo, origin] = body !== part ? _carry(body, these, new Map()) : [these, new Map<string, Face>()]
      if (!todo.length) continue
      let stays: Face[]
      ;[body, stays] = _removePass(body, todo, origin, b, expect, faulted)
      if (stays.length < these.length) progress = true
      left.set(expect, stays)
    }
  }
  const stayed = [...left.get(-1)!, ...left.get(1)!, ...left.get(0)!]
  if (stayed.length && !partial) {
    const g4 = (v: number) => _formatG(v, 4)
    const where = stayed
      .map((f) => f.center())
      .slice(0, 4)
      .map((c) => `(${g4(c.x)}, ${g4(c.y)}, ${g4(c.z)})`)
      .join(', ')
    const more = stayed.length > 4 ? ` and ${stayed.length - 4} more` : ''
    throw new ModelingError(
      `removeFillets: the kernel could not take out ${stayed.length} of the ${sel.length} fillet faces (at ${where}${more}); removeFillets(..., { partial: true }) keeps them and takes out the others, or take out the fillets around them first`,
    )
  }
  return body
}

/** The selection with the faces it encloses: a face all of whose neighbours are selected (the
 * floor of a blind hole, the top of a boss) goes with them. Not a face that the selection only
 * rounds off: one that meets all its neighbours tangentially where the selection, too, meets the
 * faces around it tangentially (the top of a box whose top edges are rounded, with those rounds
 * selected). Such a face is the part, not a feature's floor; a pocket's floor inside its rounds
 * goes with the pocket's walls, whose rim is sharp. */
function _complete(faces: readonly Face[]): Face[] {
  const out = [...faces]
  let changed = true
  while (changed) {
    changed = false
    const ids = new Set(out.map((f) => f._identity()))
    const enclosed: Face[] = []
    for (const f of [...out]) {
      for (const g of f.neighbors()) {
        if (ids.has(g._identity()) || _has(enclosed, g)) continue
        if (g.neighbors().every((n) => ids.has(n._identity()))) enclosed.push(g)
      }
    }
    const inside = new Set([...ids, ...enclosed.map((g) => g._identity())])
    const rimSharp = out.some((f) => f.edges().some((e) => e.faces().some((x) => !inside.has(x._identity())) && _sharp(e)))
    for (const g of enclosed) {
      if (rimSharp || g.edges().some((e) => _sharp(e))) {
        out.push(g)
        ids.add(g._identity())
        changed = true
      }
    }
  }
  return out
}

/** Whether an edge between two faces is a corner (its faces do not meet tangentially). */
function _sharp(e: Edge): boolean {
  const fs = e.faces()
  return fs.length === 2 && !fs[0].equals(fs[1]) && e.convexity !== 'smooth'
}

/** +1 for a depression (hole, pocket: its rim edges are convex), -1 for a protrusion (boss:
 * concave rim), 0 if mixed. */
function _featureKind(group: readonly Face[]): number {
  const ids = new Set(group.map((f) => f._identity()))
  const kinds = new Set<string>()
  for (const f of group) {
    for (const e of f.edges()) {
      const fs = e.faces()
      if (fs.length === 2 && fs.filter((x) => ids.has(x._identity())).length === 1) kinds.add(e.convexity)
    }
  }
  kinds.delete('smooth')
  if (kinds.size === 1 && kinds.has('convex')) return 1
  if (kinds.size === 1 && kinds.has('concave')) return -1
  return 0
}

/** `body` without one connected set of faces, the gap closed and checked; or null and why. Where
 * the faces' rim says nothing about the direction (tangent or mixed edges), the volume may change
 * by no more than the faces span (their area times the size of their box), and the part's box may
 * not shrink: closing the gap there must not take away the part around it. */
function _close(body: Part, group: readonly Face[]): [Part | null, string] {
  const expect = _featureKind(group)
  const before = _volume(body)
  let bound: number | null = null
  if (expect === 0) {
    let span = group[0].bbox()
    for (const f of group.slice(1)) span = span.union(f.bbox())
    bound = group.reduce((a, f) => a + f.area, 0) * span.diagonal
  }
  let why = ''
  for (const rebuild of ['extend', 'planar_cap']) {
    let res: Any
    try {
      res = _isolatedValue(
        'removeFaces',
        () => _D.defeature(body._brep, [group.map((f) => f._f)], rebuild),
        () => ({ op: 'defeature', bodies: [_smb(body)], groups: [_indices(body, group)], rebuild }),
        { trap: true },
      )
    } catch (e) {
      if (!(e instanceof _KernelFault) || e.here) throw e // (a crash here: this kernel may be damaged)
      why = why || e.reason
      continue
    }
    if (res.brep === null) {
      why =
        why ||
        (res.added
          ? 'the kernel could not close the gap'
          : 'the kernel did not take the faces as a feature (it must be bounded by closed loops of edges)')
      continue
    }
    const candidate = body._like(res.brep)
    const problem = _problem(before, candidate, expect, null) ?? (bound !== null ? _spill(body, candidate, before, bound) : null)
    if (problem === null) return [candidate, '']
    why = why || `the kernel returned ${problem}`
  }
  return [null, why]
}

/** What is wrong with a result whose volume may change either way: a change beyond `bound`, or a
 * box that shrank (the gap was closed by taking the part around it away). */
export function _spill(body: Part, result: Part, before: number, bound: number): string | null {
  const change = Math.abs(_volume(result) - before)
  if (change > bound) return `a volume change of ${_formatG(change)}, more than the faces span (${_formatG(bound)})`
  const a = body.bbox()
  const b = result.bbox()
  const tol = 1e-6 * Math.max(1, a.diagonal)
  const [alo, ahi, blo, bhi] = [a.min.toArray(), a.max.toArray(), b.min.toArray(), b.max.toArray()]
  for (let i = 0; i < 3; i++) {
    if (blo[i] > alo[i] + tol || bhi[i] < ahi[i] - tol) {
      return `a part that shrank along ${'XYZ'[i]} (${_formatG(alo[i])}..${_formatG(ahi[i])} -> ${_formatG(blo[i])}..${_formatG(bhi[i])})`
    }
  }
  return null
}

/** See `Part.removeFaces`. */
export function removeFaces(part: Part, faces: unknown, options: { partial?: boolean } = {}): Part {
  const partial = options.partial ?? false
  part._requireValid('removeFaces')
  const given = _facesOf(part, faces, 'removeFaces')
  if (filletFaces(given).length === given.length) return removeFillets(part, given, { partial }) // rounds only: taken out by what takes out rounds
  const sel = _complete(given)
  if (sel.length === part.faces().length) throw new ModelingError('removeFaces: that is every face of the part; nothing would be left')
  let body = part
  const failed: [Face[], string][] = []
  for (const group of _groups(sel)) {
    const todo = body === part ? group : _carry(body, group, new Map())[0]
    if (!todo.length) continue
    const [result, why] = _close(body, todo)
    if (result === null) failed.push([group, why])
    else body = result
  }
  if (failed.length && !partial) {
    const [group, why] = failed[0]
    const c = group[0].center()
    const g4 = (v: number) => _formatG(v, 4)
    const more = failed.length > 1 ? ` (${failed.length} of ${_groups(sel).length} features failed)` : ''
    throw new ModelingError(
      `removeFaces: ${why} at (${g4(c.x)}, ${g4(c.y)}, ${g4(c.z)})${more}; select every face of the feature (the wall and the floor of a pocket, the side and the top of a boss), take out its fillets first (removeFillets), or keep it with partial: true`,
    )
  }
  return body
}
