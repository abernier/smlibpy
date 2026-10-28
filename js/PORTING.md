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
     `deform__map_points`); mesh.cpp: `poly_mesh`, `poly_copy` (SmPyLib's), `ext__poly_arrays`,
     `ext__mesh_first_hits`, `ext__body_first_hits`; bind_drawing.cpp: `ext__hidden_lines`;
     bind_mesh_tools.cpp: `ext__mesh_nearest_points`, `ext__crease_normals`,
     `ext__decimate_triangles`, `ext__repair_triangles`, `ext__brep_from_triangles`.
   - bind_runtime.cpp: the module itself, `runtime__memory_usage` (`memoryUsage()`) and
     `runtime__exception_info`, which tells kernel.ts what a C++ exception is.
   - smpylib.cpp: SmPyLib's own binders (SmPy*.cpp but USD's and the borrowed-geometry check),
     compiled as they are against a stand-in for pybind11 (pyshim/pybind11/pybind11.h): every
     function and class method SmPyLib binds for Python is an entry of a table that
     `smpylib__call(i, args)` calls, and `smpylib__table()` lists with SmPyLib's py::arg names and
     defaults (`smpylib__enums()` its enums). kernel.ts makes them `k.<name>` and
     `k.<class>_<method>` where the hand-written bindings have none (`k.smpylib` has them all), and
     lane_WN.test.ts holds the hand-written bindings' signatures to SmPyLib's. A kernel call
     smlibwasm comes to use needs no new binding; one it uses often may get a hand-written one
     (the same name, parameters and results).
   - Kernel objects cross as numbers (their address; 0 is none). Python tuples are arrays,
     dicts objects, lists of numbers Float64Arrays. A failing call throws an Error whose
     message is the one Python's RuntimeError carries. A C++ exception becomes the error Python
     gets: `guard` (common.h) catches those of smlibpy's C++; those of the kernel's bindings
     leave the module as a WebAssembly.Exception, which kernel.ts turns into the same error
     (`_cppError`); std::bad_alloc is an Error saying SM_ERR_OUT_OF_MEMORY (Python's
     MemoryError).
2. **The kernel layer** (js/src/kernel.ts, also the package's entry `@classcad/smlibwasm/kernel`,
   no stable API, like `smlibpy._core`): `k` is Python's `smlibpy._core`: `k.create_box`,
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
- **Choices.** An option Python types as `Literal["round", "sharp"]` is a union of the same
  strings (`corners?: 'round' | 'sharp'`), checked at run time as well.
- **Old forms.** Where Python keeps an old call working for a release, with a DeprecationWarning
  (`@renamed` for a renamed keyword, `@keyword_only` for a flag that was positional), smlibwasm
  does too, with a warning (`_warn`): `_renamed` and `_keywordOnly` of `_renamed.ts`, called before
  `_opts`. The declarations show the new form only, as Python's signatures do.
  `tools/gen_js_options.py` lists Python's old forms in `js/test/_python_api.json`, and
  js/test/options.test.ts calls each one.
- **Operations** are methods and functions in both (AGENTS.md, "The API"): the function form
  checks that it got a body with that method (`_subject`) and calls it, `draft(part, faces, 3,
  Plane.XY)` being `part.draft(faces, 3, Plane.XY)`. js/test/api_forms.test.ts checks that
  smlibwasm has every name smlibpy has (`js/test/_python_api.json`, which
  `tools/gen_js_options.py` writes) and that the two forms give the same results.
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
  which throws a TypeError for anything but an index), and `ShapeList.new(since)` is
  `newSince(since)`.
  `new ShapeList(...shapes)` builds one; the internal helper is `_list(iterable)`.
- **Errors.** `ValueError` and `IndexError` -> `RangeError`; `TypeError` -> `TypeError`;
  `ModelingError` and `KernelError` are smlibwasm's classes (kernel.ts). `kernel_call` is
  `kernelCall(operation, () => ..., hint)`. `except (KernelError, ValueError)` is
  `catch (e) { if (!(e instanceof KernelError || e instanceof RangeError)) throw e }`. A
  KernelError made again with another hint keeps its cause's trace: Python's
  `_traced(KernelError(...), cause)` is `_traced(new KernelError(...), cause.trace)` (_errors.ts).
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
- **Files.** Every format has an in-memory pair that works everywhere and a path pair for Node
  (Python has the same pairs, `to_step`/`from_step` and so on, with `bytes` for `Uint8Array`):
  - `toStep(shapes, options): string`, `toStl(...)`/`toGlb(...)`: `Uint8Array`, `toGltf`,
    `toObj`, `toDxf`, `toUsd`, `toBrep`: `string`; `toSmb(shapes, { ascii })` and `toSmp(shapes, { ascii })`
    (the kernel's own formats: one body; bodies and curves with names and colors): `Uint8Array`;
    `fromStep(data)`, `fromStl(data)`, `fromDxf(data)`, `fromDxfWires(data)`, `fromSmb(data)`,
    `fromSmp(data)`, `fromUsd(data)`, `fromIges(data)`, `fromBrep(data)` take a `string` or bytes
    (`BytesLike`: a `Uint8Array`, an `ArrayBuffer` or another view of one; `_bytes.ts`'s `_asBytes`
    makes the `Uint8Array`), as `loadFont` and the `Font` constructor do. `toFile(shapes, name,
    options)` and `fromFile(data, name)` are the in-memory `exportFile` and `load`, by the extension
    of `name`. `fromUsd` (and Python's `from_usd`) takes the layers a stage names (subLayers,
    references, payloads) from its `resolve` option, where `importUsd` reads the files.
  - `exportStep(shapes, path, options)` ... and `exportFile(shapes, path, options)` (by the
    extension), `importStep(path)` ..., `save`/`load` (the kernel's own format) are Python's
    functions; they write and read through `_fs()` (node:fs via `process.getBuiltinModule`, no
    static `node:` import, so bundlers for the browser do not trip) and throw a clear error
    outside Node.
  - Python's `smlibpy.export(...)` is `exportFile` (`export` cannot name a function).
- **Names between modules.** What one module imports from another, beyond the public API:
  `exporters.ts`: `exportFile`, `_items`, `_DEFAULT_COLORS`, `_curvePoints`, `_edgePolylines`,
  `_flattenAll`, `_zUp`, `gltfDocumentMixed`, `_fs`, `_base64`, `_body` (usd.ts and occt.ts); `dxf.ts`: `exportDxf`, `importDxf`,
  `importDxfWires`, `toDxf`, `fromDxf`, `fromDxfWires`; `regions.ts`: `Plan`, `plan`, `build`,
  `polygonsCross`, `pointInPolygon`, `signedArea`, `overlappingBoxes`, `unionDisjoint` (polygons as
  arrays of `[x, y]` points, numpy's n x 2 rows); `align.ts`: `_one`; `surfaces.ts`:
  `_shellOfSurface`; `viewer.ts`: `show`; `sketches.ts`: every constructor (`Polygon`, ...);
  `step_reader.ts`: `_repr`, `interpretExtras` (occt.ts quotes names with `_repr`); `step.ts`: `_MM_PER_UNIT` (usd.ts reads `units`
  with it); `step_import.ts`: `StepModel` (pictures.ts draws it); `shapes.ts`: `_held` (deformations.ts
  holds the copies of a Boolean's operands with it), `_curvesOf` (surfaces.ts takes `fill`'s
  curves with it), `_take`, `_translation`, `_reflection`,
  `_scaling` (the matrices of a move; mesh.ts moves meshes with them), `WHOLE_TURN` (parts.ts makes
  sectors whole within it, as revolve), `_asPlane` (shaping.ts takes `flatten`'s plane with it),
  `_offsetProblem` and `_intersectionProblem` (their tests), `_putFaceAttrs` (defeature.ts and
  step_import.ts put the faces' colors and names back on a body read from a file); `shaping.ts`:
  `_push`, `_warp`, `_flatten`, `_checked` (the push, warp and flatten of Part and Shell), `_ownFace`
  (sheet_edit.ts takes a sheet's faces with it); `sheet_edit.ts`: `_matchEdge`, `_mergeFaces` (Shell's
  `matchEdge` and `mergeFaces`); `mesh.ts`: `_rayTriangles`, `faceMeshes`, `_rays`,
  `_triangleFaces`, `_tessellate` (shapes.ts casts rays with them; pictures.ts takes `_tessellate`),
  `_levels` (shapes.ts slices parts with it), `_deviation` (its test), `_coloredMesh`,
  `_triangleColors` (exporters.ts, usd.ts and pictures.ts color faces with them);
  `dxf.ts`: `_entity`, `_edgePoints`, `_samplesFor` (drawing.ts writes SVG with them);
  `drawing.ts`: `DrawingView` (dxf.ts writes views), `exportSvg` (exporters.ts); `molding.ts`:
  `_contour`, `_joinedArcs` (shapes.ts makes silhouettes with them); `defeature.ts`: `_guarded`,
  `_dropBrep`, `_underDeadline` (surfaces.ts and shapes.ts free with the one, the tests hold a step
  with the other), `_smb` (surfaces.ts blends surfaces in it), `_smbOf`, `_isolated` and
  `_isolatedValue` (shapes.ts runs shell, offset, thicken, cells, opt-in Booleans and the fillets
  of imported parts in them), `_spill`
  (its test); `shapes.ts`: `_carried` (defeature.ts sends the tags and face attributes of the bodies
  of a step with it); `kernel.ts`: `_reachable` (what `scope` keeps; the tests count with it),
  `_crashCount` and `_crashError` (`Part._checked` stops at a crash of the kernel), `_isCrash` and
  `_crashOf` (every fallback passes a crash on, see "Crashes of the kernel"); `_errors.ts`:
  `_crashes` (the crashes of this thread's kernel, which worker.ts reads without the kernel);
  `_inflate.ts`: `inflate` and `ZlibError` (font.ts reads WOFF tables, _brotli.ts its dictionary),
  `_Bits`, `_prefixCode`, `_single`, `_Output` (_brotli.ts decodes with them); `_brotli.ts`:
  `decompress` (font.ts reads WOFF2 files); `_bytes.ts`: `_asBytes`; `face_edit.ts`: `moveFaces`, `offsetFaces`, `_wallThicknesses`, `shellWalls`
  (shapes.ts: Part.moveFaces, Part.offsetFaces, shell's `walls`).
- **Fonts.** font.ts and font.py are the same reader without dependencies: sfnt, TTC, WOFF (zlib:
  Python's module, `_inflate.ts` here, also in browsers) and WOFF2 (Brotli: `_brotli.py` and
  `_brotli.ts`, the same decoder, with RFC 7932's dictionary from `src/smlibpy/_brotli_dictionary.bin`,
  which `scripts/fonts.mjs` packs into `_brotli_dictionary.ts`); glyf, CFF (seac accents) and CFF2
  (the default instance). Neither uses fontTools.
- **The kernel's guard.** Python runs a step that can crash or loop in another process
  (`smlibpy._guard.isolated(what, fn, *args)`: a forked copy, or a helper process that gets the
  bodies as `.smb`); here `_isolatedValue(what, work, job)` runs it in a probe worker
  (`_defeature_worker.ts`, a kernel of its own) on `.smb` copies, `job` saying which step
  (`op`) with which faces and edges (by index), and waits for it with `Atomics.wait` (Node, and
  workers of a cross-origin isolated page; on a browser's main thread `work()` runs directly,
  held to `GUARD_SECONDS` by the kernel's deadline: `_underDeadline(what, limit, work, drop)`,
  Python's `smlibpy._guard.here(what, fn, *args)` where no other process runs the step; `drop` frees
  what `work()` made when it returned after the deadline, which Python leaves to its garbage
  collector, so each caller of `_isolatedValue` passes the `drop` of its result's bodies).
  The worker hands the step's value back through a SharedArrayBuffer, a piece at a time: JSON in
  which each body is `{ $body: i }`, then the bodies' `.smb` files; or the step's error (its name
  and message). A trap there is the crash of the copy. Neither side ever runs the step twice.
  `_isolated(what, work, job, hint)` is the same for a step that makes one body, its kernel errors
  a KernelError of `what` with `hint`. A supervisor worker without a kernel
  (`_defeature_supervisor.ts`, started by `_guard.ts`) starts the probe workers and terminates one
  that takes too long: a browser cannot start a worker from a thread that waits, so there
  `_guard.ts` starts the supervisor when the package is imported. Python's `GUARD_PROCESS` has no
  counterpart (the probe worker is the only way here); `GUARD_BOOLEANS` is `setGuardBooleans`.
  `BrepHandle.imported` (both languages) marks bodies read from files and those made from them
  (`_like`; across a `KernelWorker` too): their fillets and chamfers run guarded.
  The bodies cross with the tags of their faces and edges and their faces' colors and names, which
  `.smb` files do not hold (kernel plan T3, T5): the job's `tags` (shapes.ts's `_carried`) and the
  `marks` of the worker's answer; Python writes them as JSON beside each `.smb` file.

- **Entries without the kernel.** `@classcad/smlibwasm/worker` (worker.ts) and
  `@classcad/smlibwasm/init` (init.ts) load no kernel of their own: statically they import only
  geometry.ts, _errors.ts (`ModelingError`, `KernelError`, which kernel.ts re-exports),
  _threads.ts and _loader.ts, and the package's other modules with `import()` once a value needs them; worker.ts
  makes and reads bodies with shapes.ts's `_Body._wrap`, `Edge._of`, `Vertex._of` and `Wire._raw`.
  kernel.ts makes the module through _loader.ts (`_createModule`), with the options `init` was
  given. Bundlers build every `new Worker(new URL('...', import.meta.url))` with what it imports:
  the kernel's modules (which defeature's probe worker imports) import neither _guard.ts nor
  index.ts, worker options are literal, and no `new URL(..., import.meta.url)` names its file by an
  expression (lane_WN.test.ts checks all three).
- **Types.** Public signatures say what they take and give, as precisely as the code checks it
  (`EdgesLike` for edges, `ShapesLike` for what the exporters take, `RenderOptions` with typed
  fields), not `unknown`; a free function whose result depends on its input's type has overloads
  (`extrude(sketch)` is a `Part`), and Python's has the same `@overload`s. Option and selection
  types are exported from index.ts (`export type`). `npm run build` leaves the internal names out of
  the published declarations (scripts/declarations.mjs, by the `_` of their names rather than
  `@internal` tags): a public signature must not name an internal type (it would stay, and the API
  reference leaves out a constructor that takes one), nor a module of Node's (`NodeFs` in
  exporters.ts is written out). lane_WN.test.ts type-checks an app against the declarations with
  `skipLibCheck: false` and no Node types.
- **Crashes of the kernel.** A trap is counted (`memoryUsage().crashes`) and warns once; its
  KernelError says "the kernel crashed". Code that retries on a KernelError stops when the count went
  up during the attempt (`_crashCount()`), and a step run here with `_isolatedValue(..., { trap:
  true })` throws a `_KernelFault` whose `here` is true, which the defeaturing loops pass on rather
  than drop. Every other `catch` that falls back on another kernel call, or takes a kernel failure
  for an answer (`null`, "no hit", the next face), passes a crash on first: `if (!(e instanceof
  KernelError) || _isCrash(e)) throw _crashOf(e)`. `_isCrash(e)` is true for a trap, an error caused
  by one, and any error in the rest of the task of the event loop a crash happened in (an error a
  check turned into another one keeps no link to the trap); `_crashOf` makes the KernelError of a
  trap that no `kernelCall` wrapped. Python has nothing to port: a crash ends its process, or the
  copy of it.
- **Python only.** The kernel lock and the GIL (src/cpp/kernel_lock.cpp, nogil.cpp): every entry
  point of `_core` takes one lock and the long ones let the GIL go, so that other Python threads
  run while the kernel works. The WebAssembly module runs on one thread (a `KernelWorker` has a
  kernel of its own), so the port has nothing to take. `ext.drop_caches` and `compact()` are in
  both.
- **JavaScript only.** What the runtime asks for and Python has no use for: `KernelWorker` and
  `expose` (Python runs a kernel step in a forked copy of itself), `init` (where the WebAssembly
  file comes from), `memoryUsage()` (a WebAssembly module's memory, of at most 4 GB, and the crashes
  of its kernel; Python's kernel shares its process's, which a crash ends) and `scope(fn)` (frees the kernel objects `fn` made and does not
  return: the garbage collector frees them only between tasks, Python's reference counting at
  their last reference). They follow the house style but have no smlibpy counterpart and no entry
  in `_options.ts`. The port's own temporaries are freed the same way: the public functions that
  make intermediate bodies or curves (Booleans, `split`, `cells`, the sketch constructors, `Text`,
  `sweep`, `loft`, `revolve`, `fromDxf`, `stitch`, `flatPattern`, `surfaceFillet`, the primitives,
  `Sketch.revolve`, `Sketch.extrude`, `swing`, `thicken`, `fill`, `fold`, `flange`, `unfold`,
  `outline`, `silhouette`, `partingLine`, `Face.wrap`, `Face.extrude`/`offset`/`flipped`/`split`,
  `Edge.through`, `drawingViews`, `sectionProperties`) run their bodies in `scope`, so a call
  leaves only what it returns, as in Python; js/test/closeout_W.test.ts counts them.

## Status

- [x] The kernel's calls, topology, meshes, smlibpy's C++: bound and tested (js/test).
- [x] Every smlibpy module, each with its tests ported from tests/*.py; skipped are the tests of
      what only Python has (OpenCASCADE through OCP, fontTools, ezdxf, the MCP server).
- [x] Packaging (npm `@classcad/smlibwasm`, prepack, the release job), docs
      (docs/javascript.md, and docs/api/wasm.md from scripts/api.mjs), CI (the js job of ci.yml).
- [ ] A demo page beyond js/demo/index.html.
