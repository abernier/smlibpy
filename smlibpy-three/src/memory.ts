// The kernel's memory, which JavaScript's garbage collector does not see. Every body and curve
// holds an object in the kernel's memory, freed when it is disposed (`dispose()`) or garbage
// collected, and the collector frees them only between tasks of the event loop: a loop that
// rebuilds parts without returning to the event loop (a parametric regeneration, an optimizer, a
// batch) keeps everything it made until it ends, the operands of each chain too. `scope(fn)` frees
// what `fn` made and does not return, at once:
//
//     for (const width of widths) {
//       const volume = scope(() => {
//         const plate = new Box(width, 10, 60) // (the box, its fillet and the cylinder go)
//         return plate.fillet(plate.edges().parallelTo(Y), 4).cut(new Cylinder(3, 3, 20)).volume
//       })
//     }
//     part = scope(() => model(params)) // the part stays, what made it goes
//
// Also what the kernel's memory holds (memoryUsage), where its warnings go (setWarningHandler), and
// how long the kernel steps that can crash or loop may take (the guards). Each thread has a kernel
// of its own, with its own memory, warnings and guards: a KernelWorker's worker too.
import { describe, sm, warnTo } from './kernel.ts'

// ------------------------------------------------------------------------------------- scope
// The package's scope runs `fn` in the kernel's own scope, which frees the kernel objects made on
// the way that the result does not reach (the moved copies of operands, the curves of a sketch),
// and disposes the package's objects made while `fn` runs that the result does not hold, the way
// their dispose() does: tessellations, own materials, and kernel bodies only once no clone holds
// them. It sees those objects through `track`, which the package's constructors call.

/** The objects the package made in each scope that runs (innermost last). */
const scopes: Set<object>[] = []

/** @internal
 * Collects `o`, a body, face, edge, wire, vertex or triangle mesh the package just constructed, for
 * the innermost scope that runs (if any), which disposes it when it ends unless its result holds it
 * (a face, edge or vertex of a body goes with its body). The package's constructors call it. */
export function track(o: object): void {
  const made = scopes.at(-1)
  if (made !== undefined) made.add(o)
}

/**
 * Runs `fn` and disposes the bodies and curves made while it runs that its result does not hold,
 * when it returns: the operands and intermediates of a chain (`new Box(...).cut(new Cylinder(...))`
 * and its fillet), named or not, and what the kernel made on the way. What the result holds stays:
 * the bodies and curves it is or contains, through arrays, plain objects, Maps, Sets, the package's
 * objects (a face or edge in the result keeps its body) and the children of three's objects (not
 * their parents). Objects made before the scope stay as they are, clones of them made in it go.
 * Where `fn` throws, what it made is disposed (what the error holds stays) and the error goes on.
 * Scopes nest: what an inner scope returns belongs to the scope around it.
 *
 * The garbage collector frees the kernel's objects only between tasks of the event loop, so a loop
 * that builds without returning to it keeps every object it made until it ends: `scope` keeps such
 * a loop's memory flat.
 *
 * `fn` must return its result, not a promise (an async function goes on after its first `await`,
 * where a scope cannot follow it): a promise is a TypeError, and nothing is disposed. And `fn` must
 * keep what it makes nowhere but in its result: a body kept in a variable outside, added to a scene
 * the result is not in, or given to an object made before with `copy()`, is disposed with the rest
 * (it still draws as it was; modeling with it throws). Copy the result instead:
 * `part.copy(scope(() => model(params)))`.
 */
export function scope<T>(fn: () => T): T {
  if (typeof fn !== 'function') throw new TypeError(`scope takes a function, not ${describe(fn)}`)
  const made = new Set<object>()
  scopes.push(made)
  let promised = false
  try {
    return sm.scope(() => {
      let result: T
      try {
        result = fn()
      } catch (e) {
        end(made)
        release(made, e)
        throw e
      }
      end(made)
      if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as { then?: unknown }).then === 'function') {
        // (an async function goes on making objects after its first await: nothing is disposed,
        // what it made belongs to the scope around; the kernel's scope does the same and throws)
        promised = true
        const outer = scopes.at(-1)
        if (outer !== undefined) for (const o of made) outer.add(o)
        return result
      }
      release(made, result)
      return result
    })
  } catch (e) {
    if (promised) {
      throw new TypeError('scope takes a function that returns its result, not a promise: an async function goes on after its first await, where the scope cannot follow it')
    }
    throw e
  } finally {
    end(made)
  }
}

/** Ends the scope of `made` (once). */
function end(made: Set<object>): void {
  if (scopes.at(-1) === made) scopes.pop()
}

/** Disposes the objects of `made` that `kept` does not reach (a body's face, edge or vertex goes
 * with its body); those it reaches go to the scope around, if any. */
function release(made: Set<object>, kept: unknown): void {
  if (made.size === 0) return
  const reached = reachable(kept)
  const outer = scopes.at(-1)
  for (const o of made) {
    if (reached.has(o)) outer?.add(o)
    else if ((o as { owner?: unknown }).owner == null) (o as { dispose(): void }).dispose()
  }
}

/**
 * The objects a value holds: through the values of its own properties (also those under symbols,
 * where the package keeps a body's kernel object, its faces and edges, and a face's body), the items
 * of arrays, Maps and Sets, and the children of three's objects but not their parents (a result in
 * a scene does not hold the scene); not through functions, whose closures cannot be seen, or typed
 * arrays.
 */
function reachable(value: unknown): Set<object> {
  const out = new Set<object>()
  const todo: unknown[] = [value]
  while (todo.length) {
    const v = todo.pop()
    if (v === null || typeof v !== 'object' || out.has(v)) continue
    out.add(v)
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof Promise || v instanceof WeakMap || v instanceof WeakSet) continue
    if (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer) continue
    if (v instanceof Map) {
      for (const [key, x] of v) todo.push(key, x)
      continue
    }
    if (v instanceof Set) {
      for (const x of v) todo.push(x)
      continue
    }
    const object3D = (v as { isObject3D?: unknown }).isObject3D === true
    for (const key of Reflect.ownKeys(v)) {
      if (object3D && key === 'parent') continue
      const d = Object.getOwnPropertyDescriptor(v, key)
      if (d !== undefined && 'value' in d && d.value !== null && typeof d.value === 'object') todo.push(d.value)
    }
  }
  return out
}

// ------------------------------------------------------------------------------------ memory
/** What the kernel's memory holds (`memoryUsage()`), in bytes, and how many objects. */
export interface MemoryUsage {
  /** What the kernel's objects take, in bytes. */
  readonly used: number
  /** How far the kernel's memory has grown, in bytes: it grows when the kernel needs more, up to
   * `limit`, and never shrinks. */
  readonly heap: number
  /** How far the kernel's memory can grow, in bytes: 4 GB (less 64 kB), as far as a 32-bit
   * WebAssembly module reaches (a browser may stop it earlier). */
  readonly limit: number
  /** The kernel objects (of bodies, curves, surfaces, meshes) that are neither disposed nor garbage
   * collected yet. A count, not bytes. */
  readonly handles: number
  /** The times the kernel crashed since it was loaded. After a crash its memory may be damaged and
   * what it computes may be wrong: the first crash warns (`setWarningHandler`), and an app that goes
   * on loads the page again, or models in a KernelWorker, which starts a new kernel after one. A
   * count. */
  readonly crashes: number
}

/**
 * What the kernel's memory holds: what its objects take (`used`), how far its memory has grown
 * (`heap`) and how far it can grow (`limit`), in bytes; how many kernel objects are not freed yet
 * (`handles`) and how often the kernel crashed (`crashes`). A kernel call that finds the memory
 * used up fails with a KernelError of status SM_ERR_OUT_OF_MEMORY: dispose of bodies no longer
 * needed, use `scope`, or let the event loop run. Each thread's kernel (a page, a worker) has a
 * memory of its own.
 */
export function memoryUsage(): MemoryUsage {
  const m = sm.memoryUsage()
  return { used: m.used, heap: m.heap, limit: m.limit, handles: m.handles, crashes: m.crashes }
}

// ---------------------------------------------------------------------------------- warnings
/**
 * Where the kernel's warnings go (what smlibpy warns of: a STEP file's bodies left out, a sweep
 * that had to turn its profile, the first crash of the kernel): `console.warn` unless set here;
 * null sets it back. Each thread has its own.
 */
export function setWarningHandler(handler: ((message: string) => void) | null): void {
  if (handler !== null && typeof handler !== 'function') throw new TypeError(`setWarningHandler takes a function or null, not ${describe(handler)}`)
  warnTo(handler)
}

// ------------------------------------------------------------------------------------ guards
/**
 * Seconds a kernel step that can crash or loop may take: the steps of `removeFillets`,
 * `removeFaces`, `surfaceFillet`, `shell`, `offset`, `thicken` and `cells()`, fillets and chamfers
 * of parts read from files and, with GUARD_BOOLEANS, every Boolean (SMLib's offset code can read
 * memory it freed, and its patching code loops for good on some parts). Where a thread can wait for
 * another (Node, and Web Workers of a cross-origin isolated page), such a step runs in a probe
 * worker, a kernel of its own, on copies of the bodies: a step that crashes there or takes longer
 * fails with a ModelingError (`removeFillets` and `removeFaces` leave it out and go on), and this
 * thread's kernel is left alone. On a page's main thread the step runs here, held to this many
 * seconds by the kernel's deadline, which its long loops (the surface and topology intersections)
 * test. 0 runs the steps here without a limit. Default 20; read here, set with `setGuardSeconds`.
 * Each thread has its own: set it in a KernelWorker's worker module for the calls there.
 */
export let GUARD_SECONDS: number = sm.GUARD_SECONDS

/** Whether every Boolean (`fuse`, `cut`, `intersect`, `merge`) runs in the probe worker too, as the
 * steps of GUARD_SECONDS do (default false: the bodies go there and back as copies): for long runs
 * over unknown inputs, where a crash of the kernel must not end the run. Read here, set with
 * `setGuardBooleans`; each thread has its own. */
export let GUARD_BOOLEANS: boolean = sm.GUARD_BOOLEANS

/** Sets GUARD_SECONDS (0 or more); returns the value it had. */
export function setGuardSeconds(seconds: number): number {
  const old = sm.setGuardSeconds(seconds)
  GUARD_SECONDS = sm.GUARD_SECONDS
  return old
}

/** Sets GUARD_BOOLEANS (true or false); returns the value it had. */
export function setGuardBooleans(on: boolean): boolean {
  const old = sm.setGuardBooleans(on)
  GUARD_BOOLEANS = sm.GUARD_BOOLEANS
  return old
}
