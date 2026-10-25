// How the kernel's module is made: with the options `init` (init.ts) was given, once. kernel.ts
// makes it; this module imports nothing, so that the kernel's module graph (also that of
// defeature's probe worker, which bundlers build on its own) does not reach the package's entry.

import type { InitOptions } from './init.ts'

let given: InitOptions | null = null // the options, once init() had some
let taken = false // the kernel is loading or loaded: options come too late

/** Keeps `options` (checked by init) for the kernel's module; an Error once it is made, or when
 * they differ from options given before. */
export function _give(options: InitOptions): void {
  if (taken) {
    throw new Error(
      'init(): the kernel was loaded already, so its options come too late; call init before anything imports @classcad/smlibwasm, and take the package from its promise',
    )
  }
  const o = options as Record<string, unknown>
  const keys = Object.keys(o)
  if (given !== null && !(keys.length === Object.keys(given).length && keys.every((key) => o[key] === (given as Record<string, unknown>)[key]))) {
    throw new Error('init(): called again with other options; the kernel loads once')
  }
  given = { ...options }
}

/**
 * The kernel's module, made by Emscripten's `create` with the options `init` was given (kernel.ts
 * makes it once, when the package is imported). A failure to load or instantiate the kernel
 * rejects (Emscripten's own instantiation hook has no way to say so: without this, the import
 * would wait for good).
 */
export function _createModule(create: (options: Record<string, unknown>) => Promise<unknown>): Promise<unknown> {
  taken = true
  const o: InitOptions = given ?? {}
  const options: Record<string, unknown> = {}
  let failed: Promise<never> | null = null
  if (o.locateFile) options.locateFile = o.locateFile
  if (o.instantiateWasm) options.instantiateWasm = o.instantiateWasm
  const source = o.wasmModule ?? o.wasmBinary
  if (source != null) {
    let fail: (e: unknown) => void = () => {}
    failed = new Promise<never>((_, reject) => {
      fail = reject
    })
    options.instantiateWasm = (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => {
      const made = source instanceof WebAssembly.Module
        ? WebAssembly.instantiate(source, imports)
        : WebAssembly.instantiate(source as BufferSource, imports).then((r) => r.instance)
      made.then(receive, (e) => fail(new Error(`the kernel could not be instantiated (${e instanceof Error ? e.message : e})`, { cause: e })))
      return {}
    }
  }
  const module = create(options)
  return failed === null ? module : Promise.race([module, failed])
}
