// The errors of the package: what smlibpy raises, as classes of this package's own.

/** An operation the kernel could not carry out (smlibpy's ModelingError), with a hint where there is one. */
export class ModelingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ModelingError'
  }
}

/** The kernel itself failed (smlibpy's KernelError): its operation, status and hint, and where it gave up. */
export class KernelError extends ModelingError {
  readonly operation: string
  readonly status: string | null
  readonly hint: string | null
  readonly trace: readonly string[]
  constructor(message: string, details: { operation: string; status: string | null; hint: string | null; trace: readonly string[] }, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'KernelError'
    this.operation = details.operation
    this.status = details.status
    this.hint = details.hint
    this.trace = details.trace
  }
}
