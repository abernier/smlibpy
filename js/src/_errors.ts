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
