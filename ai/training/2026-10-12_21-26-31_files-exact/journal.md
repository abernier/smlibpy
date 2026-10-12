# Training: files · exact formats (STEP, .smb, export, load)

**Date:** 2026-10-12

## Goal

APIs: `export`, `Shape.export`, `export_step`, `import_step`, `load`, `save`

Questions:
- Does a STEP round trip keep volume, face count, surface types, names, colors?
- What does `unit=` do: scale coordinates or only declare the unit? What comes back on import?
- What does `name=` do (product name vs body names)? Several parts: names `<product>_<i>`?
- Return types of import_step / load: Part, Shell, ShapeList, Sketch?
- Which shapes can be written (Sketch, Face, Shell, Edge, Mesh, empty list)?
- Foreign STEP files (OpenCASCADE output in out/occt): names, colors, heal.
- `.smb`: exact? one body only? ascii vs binary? names and colors?
- `export` by extension: unknown extensions, upper-case, keyword arguments, `.stp`.
- `load` of unknown extensions.

## Runs

### 01-step-roundtrip.py
Filleted bracket with a hole, named and colored, `export_step` then `import_step`.
Result: a `Part`, valid, 11 faces / 26 edges as before, bbox identical, volume differs by 1.9e-4
of 18626 (1e-8 relative, the kernel's volume integration). Face types kept (5 cylinders, 6 planes);
the file has `CYLINDRICAL_SURFACE` x5, no B-splines.
- 📌 doc: name comes back (`'bracket'`), color comes back as a float tuple
  `(0.2745, 0.5098, 0.7059)`, not as the string `"steelblue"`.
- 📌 doc: the STEP `PRODUCT` is named after the file stem (`01-bracket`); the part name goes to
  the `MANIFOLD_SOLID_BREP` label.
![back](files/01-step-roundtrip-back.png)

### 02-step-unit.py
Box 60 x 40 x 8 written with every unit and read back.
- 📌 doc: `unit` only declares the unit; coordinates are written unchanged (`-30.0,-20.0,-4.0` in
  every file). Read back: cm -> 600 x 400 x 80, m -> 60000 x ..., um -> 0.06 x ..., inch ->
  1524 x 1016 x 203.2. A model in mm written with `unit="inch"` comes back 25.4 times larger.
  To deliver an inch file, scale first: `box.scale(1/25.4)` + `unit="inch"` -> 60 x 40 x 8 back.
- `"in"` is an alias of `"inch"`. `"MM"`, `"mil"`, `"ft"` -> `ValueError: unknown unit 'MM'; use mm,
  cm, m, um or inch`; no file is left behind.

### 03-step-names-colors.py
Four parts in one file: two named and colored, one plain, one colored with (255, 0, 0).
- Back as `ShapeList` of 4 `Part`s in the order written, at their places.
- 📌 doc: unnamed bodies get `<product>_<i>` (`03-assembly_3`), product = file stem or `name=`.
  `name="widget"` -> product `widget`, unnamed bodies `widget_1`, `widget_2`. A single unnamed
  part gets the product name (`03-single`, or `shaft` with `name="shaft"`).
- 📌 doc: the file is one product with several solids, not an assembly tree (one `PRODUCT`).
- 📌 doc: non-ASCII characters become `?` (`Bügel 'A'` -> `B?gel 'A'`); quotes survive.
- Colors: `"red"`, `"#48b"`, floats 0..1, ints 0..255 all work; `(1, 1, 1)` is read as floats
  (white). `colored("notacolor")` is accepted; the export raises `ValueError: unknown color 'notacolor'`.
![assembly](files/03-step-names-colors-assembly.png)

### 04-step-shape-kinds.py
What `export_step` accepts and what `import_step` returns.
- Sketch, Face, `surface()` -> `SHELL_BASED_SURFACE_MODEL`, back as `Shell` (a Sketch comes back
  as a Shell, area 200 kept). The freeform surface is written as `B_SPLINE_SURFACE`; area equal
  to 6 digits.
- `ShapeList` of 5 faces -> 5 separate sheets -> `ShapeList` of 5 `Shell`s.
- Hollow `Box(20,20,20).shell(2)` -> `BREP_WITH_VOIDS`, back as one valid `Part`, volume 3904 equal.
- 📌 doc: one `Part` with two disjoint solids -> two `MANIFOLD_SOLID_BREP`s -> back as a
  `ShapeList` of two `Part`s, both with the same name.
- Nested lists are flattened; Part + Sketch mixed -> `ShapeList[Part, Shell]`.
- Loft (B-spline faces): volume equal to 10 digits, 6 faces.
- 📌 doc: Edge / Wire -> `TypeError: 'Edge' object is not iterable` (no wireframe export); `[]` ->
  `ValueError: nothing to write`; a `Mesh` -> `TypeError: cannot write a Mesh to STEP`.
- Side finding (surfaces domain): `surface()` with a 3 x 3 grid raised `KernelError: surface failed
  (SM_ERR)`; 4 x 4 works.

### 05-step-foreign-occt.py
13 OpenCASCADE files from `out/occt`, compared with OCC's volumes.
All `Part`, valid, relative volume error <= 2.2e-7, each read in <= 0.03 s. Nothing invalid
without healing either.
- 📌 doc: `name` is `None`: the files name only the `PRODUCT` ('COMPOUND'), the solid label is
  empty; smlibpy takes names from the solid label only.

### 06-step-foreign-assembly.py
`../models/as1_ac_214.stp` (CAx-IF AS1, AutoCAD), `AWVLogoCube.stp`, `Ventil.stp` (Express Tool).
- AS1: `ShapeList` of 18 valid parts, names `100`, `52D` x2, `870` x6, `79A` x8, `A52`, five
  colors (predefined colors come back as int tuples like `(1, 0, 0)`), 0.13 s.
- 📌 TODO HIGH: the AS1 parts are scattered (picture), see script 07.
- Logo cube: 29 parts (`Solid0`, `Solid1` x28), three colors; the picture is right.
- Ventil: one `Part`, valid, 42 x 41.6 x 78.2.
![as1](files/06-step-foreign-assembly-as1.png)
![logo](files/06-step-foreign-assembly-logo.png)

### 07-step-as1-placement-check.py
Same file with `step_reader._item_transform` monkeypatched to prefer the CAx-IF reading.
Stock: bolt to nearest nut 18.0 for all six, rod 500+ from brackets. Patched: 0.0 for all bolts,
rod touches both brackets; picture shows the assembled AS1. Cause: the identity placement `#61`
is in both representations, the reader's test `i1 in items[parent] or ...` swaps the items.
-> TODO HIGH #1.
![stock](files/07-step-as1-placement-check-stock.png)
![patched](files/07-step-as1-placement-check-patched.png)

### 08-smb-save-load.py
- 📌 doc: `.smb` round trip is exact: volume identical (`==`), 11 faces, 26 edges.
- 📌 doc: name and color are lost (`None`, `None`).
- ASCII file (default) 92 kB, starts `Version 42`; binary (`ascii=False`) 35 kB.
- Sketch, Face, surface -> back as `Shell`; hollow part and a two-solid part -> one `Part`
  (2 solids kept in one Part, unlike STEP).
- A list of two -> `ValueError: an .smb file holds one body; fuse the parts or save them separately`;
  a list of one works.
- A Mesh -> `AttributeError: 'Mesh' object has no attribute '_brep'` (TODO LOW).

### 09-smb-exactness.py
Loft with B-spline faces: binary `.smb` vertices bit-identical (max diff 0), area diff 0;
ASCII `.smb` vertex diff 3.7e-17, area diff 4.6e-13. 📌 doc: binary is bit-exact, ASCII is
exact to ~1e-15.

### 10-export-dispatch.py
- 📌 doc: `export`/`Shape.export` pick by extension, case-insensitive (`.STEP`, `.STL` work);
  `.stp`, `.gltf`, `.smb` too. Keyword arguments go to the format function: `unit=` for STEP,
  `tolerance=`/`ascii=` for STL, `edges=` for glb, `ascii=` for smb.
- Wrong keyword -> `TypeError: export_step() got an unexpected keyword argument 'tolerance'`.
- `.iges` or no extension -> `ValueError: unknown file type '.iges'; use .step, .stl, .glb, .gltf, .obj or .smb`.
- `export(list, pathlib.Path)` works.
- `Mesh.export`: `.stl`, `.obj`, `.glb` ok; `.step` -> TypeError; `.smb` -> AttributeError.
- 📌 doc: `load`: `.step/.STEP/.stp` -> Part, `.stl` -> Mesh, `.smb` -> Part (name None).
  `.glb`, `.obj` -> `KernelError: load failed` (they go to the native reader; TODO LOW).
  Missing `.step` -> `FileNotFoundError`; missing `.smb` -> `KernelError: load failed` (TODO LOW).
  Text file named `.step` -> `ValueError: not a STEP file (no DATA section)`.

### 11-step-heal.py
Moved one vertex point of a box-with-hole file by 1e-6 .. 0.5: always a valid Part, with and
without heal; the volume follows the moved vertex (6429.2 -> 6221.0 at 0.5). Healing not exercised.

### 12-step-open-solid.py
A `CLOSED_SHELL` with one face removed: `Part`, `is_valid()` False, 5 faces, `volume` 8000
(meaningless). Same with `heal=False`.
- 📌 doc: import does not raise for a broken body; check `is_valid()` on everything imported.

### Coverage (export_step, import_step, save, load, export)
- [x] ran successfully
- [x] every parameter: unit (all values + bad), name, heal (True/False), ascii (both), kwargs of export
- [x] defaults measured: unit mm (02), product name = stem (03), ascii .smb (08)
- [x] edge/error cases: empty, Mesh, Edge, bad unit, bad color, missing file, garbage, unknown ext
- [x] realistic: assembly of named colored parts, foreign files
- [x] spatial claims by numbers (bbox, volumes, distances)
- [x] all questions answered (01-12)

### 13-doc-examples.py
All examples of `export_step.md`, `import_step.md`, `save_load.md`, `export.md`, run in `files/`
unchanged. Output: `['bracket', 'cover'] 18797.876 18797.876`; inch file of the scaled bracket
reads back 60 x 40 x 8; `.smb` volume `==` True, name None; `load` of `.step`/`.stl` -> Part / Mesh.

### 14-import-pattern.py
The `parts = r if isinstance(r, ShapeList) else [r]` pattern: `assembly.step` -> ShapeList, 2
parts; `bracket.step` -> Part, wrapped into a list of 1.
