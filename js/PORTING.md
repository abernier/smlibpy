# Porting smlibpy to JavaScript

smlibwasm is smlibpy for JavaScript and TypeScript: the same kernel compiled to WebAssembly, the
same modeling API, for the browser and Node. Branch `feat/js`, everything under `js/`.

## Layers

1. **The kernel and smlibpy's C++** (js/cpp, built by `npm run wasm` into js/wasm): one
   WebAssembly module with embind bindings. smlibpy's own C++ (src/cpp) is shared with the
   Python extension; its Python bindings sit behind `SMLIBPY_PYTHON`.
   - bind_kernel*.cpp: SmPyLib's kernel calls under Python's names (`create_box`, `boolean`),
     the arguments in SmPyLib's order, Python's enums as numbers (`BooleanOp_UNION`).
   - bind_topology.cpp: SmPyLib's methods of Brep, Face, Edge, Vertex, Curve and Surface as
     functions, `<class>_<method>` (`brep_faces(b)` for `b.faces()`, `curve_evaluate(c, t)`).
   - bind_smlibpy.cpp: smlibpy's C++ as `<submodule>__<name>` (`ext__curve_data`,
     `deform__map_points`); mesh.cpp: `poly_mesh`, `poly_copy`.
   - Kernel objects cross as numbers (their address; 0 is none). Python tuples are arrays,
     dicts objects, lists of numbers Float64Arrays. A failing call throws an Error whose
     message is the one Python's RuntimeError carries.
2. **The kernel layer** (js/src/kernel.ts): `k` is Python's `smlibpy._core`: `k.create_box`,
   `k.ext.curve_data`, `k.BooleanOp.UNION`, `k.brep_faces`. Functions take Python's defaults
   and keywords from their signature (signatures.ts for the kernel's calls, the table in
   kernel.ts for smlibpy's own): `k.fillet_edges(b, edges, { radius: 2, xsect_type: 2 })`.
   Always go through this: the module itself does not check argument counts, a missing
   argument arrives as 0. Every function restores the module's stack pointer when it throws
   (a kernel error or a trap leaves it where the call had moved it).
3. **smlibwasm** (js/src/*.ts): smlibpy's Python modules, one TypeScript module each, same
   file names (shapes.py -> shapes.ts, _regions.py -> _regions.ts).

## Porting rules

The port is faithful: the same algorithms, checks, tolerances, messages and fallbacks. Where
the Python code works around a kernel defect, so does the TypeScript.

- **Names.** Classes keep their names (`Box`, `Part`, `ShapeList`). Functions, methods,
  properties, parameters and option keys are camelCase (`parallel_to` -> `parallelTo`,
  `k_factor` -> `kFactor`). Module-internal names keep the leading underscore
  (`_fillet_wire` -> `_filletWire`). Constants stay (`TOLERANCE`, `CORNER_STYLES`). The
  kernel's own names (`k.*`, their keywords, the keys of the dicts they return) stay as they
  are: they are the module's API.
- **Arguments.** Positional-or-keyword parameters stay positional, with the same defaults.
  Keyword-only parameters (after `*`) become a trailing options object with camelCase keys:
  `fold(self, line, angle, *, radius, k_factor=0.44)` -> `fold(line, angle, { radius, kFactor })`.
  `**kwargs` passed on become an options object passed on. `*args` stay rest parameters.
  A public function checks its options first, as Python checks keywords:
  `_opts('Part.fold', options)` (kernel.ts), against `_options.ts`, which
  `tools/gen_js_options.py` makes from Python's signatures (run it after changing one;
  tests/test_js_options.py and js/test/options.test.ts fail until then). Constructors of parts,
  sketches and patterns pass `arguments.length` too. An options object is a plain object, also
  one of another realm (an iframe, `node:vm`); an instance of a class is not.
- **Properties** stay properties (getters): `edge.length`, `face.area`, `part.volume`,
  `face.geomType`, `list.first`. Methods stay methods.
- **Operators** become methods:
  - Part: `+ - &` -> `fuse`, `cut`, `intersect` (Python has these names already).
  - Sketch: `+ - & ^` -> `fuse`, `cut`, `intersect`, `xor`. Shell `+` -> `fuse`.
  - Edge and Wire `+` -> `add` (a Wire).
  - Vector: `add`, `sub`, `mul` (number), `div`, `neg`; `abs(v)` is `v.length`.
  - Location, Plane and Locations `*` -> `mul`. `-axis` -> `axis.neg()`.
  - ShapeList: `+` is `concat`; `|` `union`, `-` `difference`, `&` `intersection`. The sort
    operators `> < >> <<` have no counterpart (use `sortBy`, `maxBy`, `minBy`).
  - `==` -> `equals(other)`; `hash` -> `_identity()` (a string key); `repr` -> `toString()`
    (and Node's inspect).
- **ShapeList** extends Array: `filter`, `slice` and `concat` return ShapeLists; `map`
  returns a plain array. Python's `ShapeList.at(point)` is `atPoint(point)` (Array has `at`,
  which throws a TypeError for anything but an index).
  `new ShapeList(...shapes)` builds one; the internal helper is `_list(iterable)`.
- **Errors.** `ValueError` and `IndexError` -> `RangeError`; `TypeError` -> `TypeError`;
  `ModelingError` and `KernelError` are smlibwasm's classes (kernel.ts). `kernel_call` is
  `kernelCall(operation, () => ..., hint)`. `except (KernelError, ValueError)` is
  `catch (e) { if (!(e instanceof KernelError || e instanceof RangeError)) throw e }`.
  `warnings.warn` is `_warn(message)` (kernel.ts).
- **numpy** becomes plain arrays and small helpers (_linalg.ts: `eigh3`, `spread` for
  numpy's SVD of point sets, `det3`). Matrices are geometry.ts's `Matrix`, a Float64Array of
  16 numbers row by row (`m[r * 4 + c]`); `Location.matrix` gives them as rows. Meshes hold
  flat typed arrays (vertices `Float64Array` of x, y, z; triangles `Uint32Array` of three
  indices each).
- **numpy slices** of arrays smlibwasm hands out (a Lattice's points) become an index per axis:
  a number (negative counts from the end), `null` for all (Python's `:`) or an array of numbers:
  `lattice.points[i][j][k]` is a point `[x, y, z]`; `layer(Z, -1)` is `[null, null, -1]`.
- **Kernel objects** are numbers. Python's `id(kernel_object)` identity is the number.
  Owning handles (`BrepHandle`, `CurveHandle`, ...) free on garbage collection and have
  `dispose()`; `_take(h)` releases one to a new owner. A face's, edge's or vertex's kernel
  object (`_f`, `_e`, `_v`) is a getter that throws a TypeError once its body was disposed.
  Meshes keep no PolyBrep (`_fromPoly` frees it once the arrays are copied), except where a
  caller keeps the tessellation's own (`_tessellate(..., keep)`) and disposes it; a mesh Boolean
  takes a kept one only while the arrays are the ones it was made from (`_fingerprint`, a
  checksum where Python takes zlib's crc32).
  Copies that go into a kernel call which keeps them when it fails (Booleans, transforms) are
  held by a handle until the kernel takes them: `_held(copy, (h) => ...)` gives the Brep back
  on success and frees it on a failure; `_combine(h, tool, op)` does a Boolean (`ext.boolean`).
- **Imports.** Modules import each other statically, also where Python imports inside a
  function to break a cycle. ES modules allow the cycles as long as no module uses another's
  exports while it is first evaluated: no top-level code that builds shapes.
- **Files.** Every format has an in-memory pair that works everywhere and a path pair for Node:
  - `toStep(shapes, options): string`, `toStl(...)`/`toGlb(...)`: `Uint8Array`, `toGltf`,
    `toObj`, `toDxf`, `toUsd`: `string`; `toSmb(shapes, { ascii })` (the kernel's own format): `Uint8Array`;
    `fromStep(data)`, `fromStl(data)`, `fromDxf(data)`, `fromDxfWires(data)`, `fromSmb(data)`,
    `fromUsd(data)` take a `string` or `Uint8Array`. `fromUsd` takes the layers a stage names
    (subLayers, references, payloads) from its `resolve` option, where Python and `importUsd` read
    the files (an option only smlibwasm has: `JS_ONLY` in tools/gen_js_options.py).
  - `exportStep(shapes, path, options)` ... and `exportFile(shapes, path, options)` (by the
    extension), `importStep(path)` ..., `save`/`load` (the kernel's own format) are Python's
    functions; they write and read through `_fs()` (node:fs via `process.getBuiltinModule`, no
    static `node:` import, so bundlers for the browser do not trip) and throw a clear error
    outside Node.
  - Python's `smlibpy.export(...)` is `exportFile` (`export` cannot name a function).
- **Names between modules.** What one module imports from another, beyond the public API:
  `exporters.ts`: `exportFile`, `_items`, `_DEFAULT_COLORS`, `_curvePoints`, `_edgePolylines`,
  `_flattenAll`, `_zUp`, `gltfDocumentMixed`, `_fs`, `_base64`; `dxf.ts`: `exportDxf`, `importDxf`,
  `importDxfWires`, `toDxf`, `fromDxf`, `fromDxfWires`; `regions.ts`: `Plan`, `plan`, `build`,
  `polygonsCross`, `pointInPolygon`, `signedArea`, `overlappingBoxes`, `unionDisjoint` (polygons as
  arrays of `[x, y]` points, numpy's n x 2 rows); `align.ts`: `_one`; `surfaces.ts`:
  `_shellOfSurface`; `viewer.ts`: `show`; `sketches.ts`: every constructor (`Polygon`, ...);
  `step_reader.ts`: `_repr`, `interpretExtras`; `step.ts`: `_MM_PER_UNIT` (usd.ts reads `units`
  with it); `step_import.ts`: `StepModel` (render.ts draws it); `shapes.ts`: `_held` (deform.ts
  holds the copies of a Boolean's operands with it), `_take`, `_translation`, `_reflection`,
  `_scaling` (the matrices of a move; mesh.ts moves meshes with them), `_offsetProblem` and
  `_intersectionProblem` (their tests); `mesh.ts`: `_rayTriangles`, `faceMeshes` (shapes.ts casts
  rays with them), `_tessellate` (render.ts); `defeature.ts`: `_guarded`, `_smb` (surfaces.ts
  blends surfaces in it), `_isolated` (shapes.ts runs shell, offset and thicken in it), `_spill`
  (its test).
- **The defeature guard.** Python forks; here `_guarded(what, work, job)` runs the step first in
  a probe worker (`_defeature_worker.ts`, a kernel of its own) on `.smb` copies, `job` saying
  which step with which faces (by index), and waits for it with `Atomics.wait` (Node, and
  workers of a cross-origin isolated page; on a browser's main thread the step runs directly).
  A supervisor worker without a kernel (`_defeature_supervisor.ts`, started by `_guard.ts`)
  starts the probe workers and terminates one that takes too long: a browser cannot start a
  worker from a thread that waits, so there `_guard.ts` starts the supervisor when the package is
  imported. Python's `_isolated` (shell, offset and thicken: the step runs only in the forked copy,
  and its body comes back as `.smb`) is `_isolated(what, work, job, hint)`: the probe worker hands
  the body's `.smb` contents, or the step's error, back through a SharedArrayBuffer, a piece at a
  time, while the caller waits with `Atomics.wait`; a trap there is the crash of the copy.

## Status

- [x] The kernel's calls, topology, meshes, smlibpy's C++: bound and tested (js/test).
- [x] Every smlibpy module, each with its tests ported from tests/*.py; skipped are the tests of
      what only Python has (OpenCASCADE through OCP, fontTools, ezdxf, the MCP server).
- [x] Packaging (npm `@classcad/smlibwasm`, prepack, the release job), docs
      (docs/javascript.md, its API section from scripts/api.mjs), CI (the js job of ci.yml).
- [ ] A demo page beyond js/demo/index.html.
