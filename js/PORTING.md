# Porting smlibpy to JavaScript

smlibjs is smlibpy for JavaScript and TypeScript: the same kernel compiled to WebAssembly, the
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
   argument arrives as 0.
3. **smlibjs** (js/src/*.ts): smlibpy's Python modules, one TypeScript module each, same
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
  returns a plain array. Python's `ShapeList.at(point)` is `atPoint(point)` (Array has `at`).
  `new ShapeList(...shapes)` builds one; the internal helper is `_list(iterable)`.
- **Errors.** `ValueError` and `IndexError` -> `RangeError`; `TypeError` -> `TypeError`;
  `ModelingError` and `KernelError` are smlibjs's classes (kernel.ts). `kernel_call` is
  `kernelCall(operation, () => ..., hint)`. `except (KernelError, ValueError)` is
  `catch (e) { if (!(e instanceof KernelError || e instanceof RangeError)) throw e }`.
  `warnings.warn` is `_warn(message)` (kernel.ts).
- **numpy** becomes plain arrays and small helpers (_linalg.ts: `eigh3`, `spread` for
  numpy's SVD of point sets, `det3`). Matrices are geometry.ts's `Matrix`, a Float64Array of
  16 numbers row by row (`m[r * 4 + c]`); `Location.matrix` gives them as rows. Meshes hold
  flat typed arrays (vertices `Float64Array` of x, y, z; triangles `Uint32Array` of three
  indices each).
- **Kernel objects** are numbers. Python's `id(kernel_object)` identity is the number.
  Owning handles (`BrepHandle`, `CurveHandle`, ...) free on garbage collection and have
  `dispose()`; `_take(h)` releases one to a new owner.
- **Imports.** Modules import each other statically, also where Python imports inside a
  function to break a cycle. ES modules allow the cycles as long as no module uses another's
  exports while it is first evaluated: no top-level code that builds shapes.
- **Files.** Every format has an in-memory pair that works everywhere and a path pair for Node:
  - `toStep(shapes, options): string`, `toStl(...)`/`toGlb(...)`: `Uint8Array`, `toGltf`,
    `toObj`, `toDxf`: `string`; `fromStep(data)`, `fromStl(data)`, `fromDxf(data)`,
    `fromDxfWires(data)` take a `string` or `Uint8Array`.
  - `exportStep(shapes, path, options)` ... and `exportFile(shapes, path, options)` (by the
    extension), `importStep(path)` ..., `save`/`load` (the kernel's own format) are Python's
    functions; they write and read through `_fs()` (node:fs via `process.getBuiltinModule`, no
    static `node:` import, so bundlers for the browser do not trip) and throw a clear error
    outside Node.
  - Python's `smlibpy.export(...)` is `exportFile` (`export` cannot name a function).
- **Names between modules.** What one module imports from another, beyond the public API:
  `exporters.ts`: `exportFile`, `_DEFAULT_COLORS`, `_curvePoints`, `_edgePolylines`,
  `_flattenAll`, `_zUp`, `gltfDocumentMixed`; `dxf.ts`: `exportDxf`, `importDxf`,
  `importDxfWires`, `toDxf`, `fromDxf`, `fromDxfWires`; `regions.ts`: `Plan`, `plan`, `build`,
  `polygonsCross`, `pointInPolygon`, `signedArea`, `overlappingBoxes`, `unionDisjoint` (polygons as
  arrays of `[x, y]` points, numpy's n x 2 rows); `align.ts`: `_one`; `surfaces.ts`:
  `_shellOfSurface`; `viewer.ts`: `show`; `sketches.ts`: every constructor (`Polygon`, ...).

## Status

- [x] The kernel's calls, topology, meshes, smlibpy's C++: bound and tested (js/test).
- [x] kernel.ts, geometry.ts.
- [ ] shapes.ts, then the modules it uses, then the rest; each with its tests ported from
      tests/*.py.
- [ ] Packaging (npm), docs, a demo page, CI.
