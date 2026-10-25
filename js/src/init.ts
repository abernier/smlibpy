// Loading the kernel: where its WebAssembly file comes from (the package's entry
// `@classcad/smlibwasm/init`). The package loads the kernel when it is first imported, from the
// file next to its loader (`new URL('smlibwasm.wasm', import.meta.url)`); options given here
// before that, to `init`, say where else it is: a CDN, an Electron app's own URLs, bytes a service
// worker cached, or a module a page compiled once for all its workers. This module does not load
// the kernel itself.
//
//     import { init } from '@classcad/smlibwasm/init'
//     const { Box } = await init({ locateFile: (file) => `https://cdn.example.com/smlibwasm/${file}` })

import { _give } from './_loader.ts'

/**
 * Where the kernel's WebAssembly module comes from (all optional; at most one of `wasmBinary`,
 * `wasmModule` and `instantiateWasm`).
 */
export interface InitOptions {
  /** The URL of a file of the kernel (`smlibwasm.wasm`), from its name and the directory of the
   * loader (`prefix`); in Node also a path. For a kernel served from elsewhere. */
  locateFile?: (path: string, prefix: string) => string
  /** The contents of `smlibwasm.wasm`, fetched already (a cache, a service worker, a bundle that
   * inlines it). */
  wasmBinary?: ArrayBuffer | ArrayBufferView
  /** The kernel compiled already (`WebAssembly.compile`, or `compileStreaming`): workers given the
   * module by their page do not compile its 6.7 MB again. */
  wasmModule?: WebAssembly.Module
  /** Emscripten's own hook: instantiates the module with `imports` and hands the instance to
   * `receive`. */
  instantiateWasm?: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => unknown
}

const KEYS = ['locateFile', 'wasmBinary', 'wasmModule', 'instantiateWasm'] as const

/**
 * Loads the package (and with it the kernel), from where `options` say; resolves to the package's
 * exports, as `import('@classcad/smlibwasm')` does.
 *
 * The options count only before the package loads the kernel, which it does when it is first
 * imported: call `init` first and take the package from its promise, or call it in a module that
 * is imported before any module that imports the package. Options that come after the kernel was
 * loaded are an Error, and so are other options than an earlier `init` gave; `init()` without
 * options only loads the package.
 */
export function init(options: InitOptions = {}): Promise<typeof import('./index.ts')> {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(`init(): the options must be an object, not ${options === null ? 'null' : typeof options}`)
  }
  const keys = Object.keys(options)
  for (const key of keys) {
    if (!(KEYS as readonly string[]).includes(key)) throw new TypeError(`init() got an unexpected option '${key}' (its options: ${KEYS.join(', ')})`)
  }
  const o = options as Record<string, unknown>
  for (const key of ['locateFile', 'instantiateWasm']) {
    if (o[key] != null && typeof o[key] !== 'function') throw new TypeError(`init(): ${key} must be a function, not ${typeof o[key]}`)
  }
  if (o.wasmBinary != null && !(o.wasmBinary instanceof ArrayBuffer || ArrayBuffer.isView(o.wasmBinary))) {
    throw new TypeError('init(): wasmBinary must be an ArrayBuffer or a Uint8Array')
  }
  if (o.wasmModule != null && !(o.wasmModule instanceof WebAssembly.Module)) {
    throw new TypeError('init(): wasmModule must be a WebAssembly.Module (WebAssembly.compile)')
  }
  if (['wasmBinary', 'wasmModule', 'instantiateWasm'].filter((key) => o[key] != null).length > 1) {
    throw new TypeError('init(): give one of wasmBinary, wasmModule and instantiateWasm')
  }
  if (keys.length) _give(options)
  return import('./index.ts')
}
