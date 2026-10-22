# @classcad/smlibwasm

smlibwasm is [smlibpy](https://smlibpy.classcad.ch) for JavaScript and TypeScript: the same modeling
API on the same kernel, SMLib, compiled to WebAssembly. It runs in the browser and in Node, and it
has no dependencies.

**[Documentation](https://smlibpy.classcad.ch/docs/javascript)** · **[Getting started](https://smlibpy.classcad.ch/docs/getting-started)** ·
**[API reference](https://smlibpy.classcad.ch/docs/api)** · **[GitHub](https://github.com/awv-informatik/smlibpy/tree/main/js)**

```js
import { Box, Cylinder, GridLocations, Z, toStep } from '@classcad/smlibwasm'

let plate = Box(80, 60, 10)
plate = plate.fillet(plate.edges().parallelTo(Z), 8)
plate = plate.cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, 10)))

console.log(plate.volume.toFixed(2)) // 45440.00
const step = toStep(plate) // the STEP file as text
```

## Install

```bash
npm install @classcad/smlibwasm
```

The package is an ES module with type declarations. Importing it loads the kernel, a WebAssembly
file next to the module, so the first import takes a moment and everything after it is synchronous.
The module finds the file with `new URL('smlibwasm.wasm', import.meta.url)`, which Vite and webpack 5
resolve on their own; with Vite's dev server, add `optimizeDeps: { exclude: ['@classcad/smlibwasm'] }`
to the config. esbuild and Bun leave the file out of their bundles: copy it, or say where it is with
`init` from `@classcad/smlibwasm/init`, which also takes the kernel's bytes or a compiled module.
Node needs version 22.18 or later.

A browser loads about 2.0 MB with brotli: 1.7 MB for the kernel (6.7 MB uncompressed) and 0.3 MB for
the library and its font. The [docs](https://smlibpy.classcad.ch/docs/javascript#size) have the details.

## From smlibpy to smlibwasm

The functions, classes, checks and error messages are smlibpy's, so
[smlibpy's documentation](https://smlibpy.classcad.ch/docs/) applies. The differences come from the language:

- **Names** are camelCase: `parallel_to` is `parallelTo`, `mass_properties` is `massProperties`.
  Classes keep their names (`Box`, `Part`, `ShapeList`).
- **Keyword arguments** become an options object at the end:
  `Rectangle(40, 20, { fillet: 2 })`, `sketch.extrude(10, { both: true })`. An unknown key is a
  `TypeError` that names the right one (`k_factor` copied from Python: `kFactor`).
- **Operators** become methods: `a.fuse(b)`, `a.cut(b)`, `a.intersect(b)` for Python's `+`, `-`
  and `&`; `Pos(10, 0, 0).mul(Box(1, 1, 1))` for `*`; `vector.add(other)`.
- **Lists**: Python's `faces().at(point)` is `atPoint(point)` (`at` takes an index), and
  Python's `list[-1]` is `list.at(-1)` or `list.last`.
- **Errors**: Python's `ValueError` is a `RangeError`; `ModelingError` and `KernelError` are
  exported.
- **Files**: `toStep`, `toStl`, `toGlb`, `toDxf`, `toUsd` give the file's contents and `fromStep`,
  `fromStl`, `fromDxf`, `fromUsd` read them, in the browser and in Node; `fromStepModel` reads a STEP file with its
  coordinate systems, curves and points as well. In Node, `exportStep(shapes, path)`,
  `importStep(path)` and the other path functions write and read files as smlibpy's do.

## Memory

Every body lives in the kernel's memory, which the JavaScript garbage collector does not see. A
body's kernel object is freed when the body is garbage collected; `part.dispose()` (or
`using part = ...`) frees it at once, which keeps memory flat in long loops. The faces, edges and
vertices of a disposed body go with it. A mesh is its arrays: the kernel's mesh is freed once
they are copied out. The kernel's memory can grow to 4 GB; `memoryUsage()` tells how much it holds,
and a call that finds it used up fails with a `KernelError` of status `SM_ERR_OUT_OF_MEMORY`.

## Running off the main thread

Calls are synchronous; on a page's main thread a long one freezes the page.
`@classcad/smlibwasm/worker` runs your functions in a worker with a kernel of its own
(`expose` there, `new KernelWorker(...)` here): bodies, faces, edges, meshes and vectors cross as
themselves, a call can have a timeout and an AbortSignal, and a call that runs too long ends with
its worker, which the next call replaces. `removeFillets` and `removeFaces` stop a kernel step that loops
after `GUARD_SECONDS` in Node and in workers of a cross-origin isolated page, not on a page's
main thread; there `shell`, `offset` and `thicken` run their kernel steps in a kernel of their own. See [the docs](https://smlibpy.classcad.ch/docs/javascript#running-off-the-main-thread).

## Building from source

The kernel comes from the `usd-brep` submodule of the smlibpy repository. With the
[Emscripten SDK](https://emscripten.org) (6.0.12) in `~/emsdk`:

```bash
npm run wasm
```

```bash
npm test
```

`npm run build` compiles the TypeScript to `dist/`.
[PORTING.md](https://github.com/awv-informatik/smlibpy/blob/main/js/PORTING.md) describes how the
port follows smlibpy.

## License

smlibwasm is MIT licensed. The SMLib kernel it includes is Apache-2.0 (NVIDIA), and the fonts for
`Text` are under the SIL Open Font License.
