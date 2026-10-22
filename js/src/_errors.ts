// smlibwasm's errors (kernel.ts exports them): a module of their own that does not load the
// kernel, so that the entries that run without one (worker.ts on the calling thread, init.ts)
// can make them too.

/** A modeling operation cannot be done (for example a fillet radius that does not fit). */
export class ModelingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelingError'
  }
}

/**
 * An SMLib operation failed.
 *
 * `operation` names the smlibwasm call, `status` the kernel status code (e.g.
 * `SM_ERR_INVALID_INPUT`) and `hint` a suggestion when one is known.
 */
export class KernelError extends ModelingError {
  readonly operation: string
  readonly status: string | null
  readonly detail: string
  readonly hint: string | null

  constructor(operation: string, detail: string, status: string | null = null, hint: string | null = null) {
    let msg = `${operation} failed`
    if (status) msg += ` (${status})`
    if (hint) msg += `: ${hint}`
    super(msg)
    this.name = 'KernelError'
    this.operation = operation
    this.status = status
    this.detail = detail
    this.hint = hint
  }
}

/**
 * The crashes of the kernel in this thread (traps of its WebAssembly module): kernel.ts counts them
 * (`memoryUsage().crashes`) and warns at the first, with `next`, what to do now (null: no warning,
 * in a thread whose kernel is replaced after a crash). Here, in a module without the kernel, so
 * that the worker entry (worker.ts) reads them without loading it: a KernelWorker's worker whose
 * kernel crashed is replaced, also where the function caught the error.
 */
export const _crashes: { count: number; last: string | null; next: string | null } = {
  count: 0,
  last: null, // (what the last one said: "function signature mismatch")
  next: 'load the module again (reload the page) before relying on what it computes, or run the modeling in a KernelWorker, which starts a new kernel after a crash',
}
