// Loading the kernel from elsewhere (the package's entry `@classcad/smlibpy-three/init`). The
// package loads its WebAssembly kernel when it is first imported, from the file next to the
// kernel's loader; `init` says where else it is, before that: a CDN, bytes a service worker
// cached, a module compiled once for every worker. It resolves to the package.
//
//     import { init } from '@classcad/smlibpy-three/init'
//     const { Box } = await init({ locateFile: (file) => `https://cdn.example.com/smlib/${file}` })
import { init as kernel } from '@classcad/smlibwasm/init'

/** Where the kernel's WebAssembly file comes from (all optional; at most one of `wasmBinary`,
 * `wasmModule` and `instantiateWasm`). */
export interface InitOptions {
  /** The URL of a file of the kernel (`smlibwasm.wasm`) from its name and the loader's directory. */
  locateFile?: (path: string, prefix: string) => string
  /** The kernel's bytes, fetched already. */
  wasmBinary?: ArrayBuffer | ArrayBufferView
  /** The kernel compiled already (WebAssembly.compile). */
  wasmModule?: WebAssembly.Module
  /** Emscripten's own hook: instantiates the module with `imports` and hands the instance to `receive`. */
  instantiateWasm?: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => unknown
}

/**
 * Loads the package with its kernel from where `options` say. Call it before anything imports
 * '@classcad/smlibpy-three', and take the package from its promise.
 */
export async function init(options: InitOptions = {}): Promise<typeof import('./index.ts')> {
  await kernel(options)
  return import('./index.ts')
}
