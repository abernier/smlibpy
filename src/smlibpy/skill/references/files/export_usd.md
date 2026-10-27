# export_usd

Writes parts, sheets and meshes to a USD file with the exact geometry: each body becomes a
`BrepArray` prim, the B-rep format of NVIDIA's usd-brep (its omniSolid schema), which usd-brep,
its usdview plugin and Omniverse read as solids, and a `Mesh` prim, which is what every other USD
viewer draws. For USD and Omniverse pipelines, and for showing a part in any USD viewer.

## Signature
`export_usd(shapes, path, *, mesh=True, tolerance=None, angle=15.0, materials=False, max_edge=None)`
`to_usd(shapes, *, mesh=True, tolerance=None, angle=15.0, materials=False, max_edge=None)` gives the
text instead of writing a file.

- `shapes`: a `Part`, `Shell`, `Sketch`, `Face`, `Mesh`, or a list of them.
- `path`: a `.usda` or `.usd` file; it is written as text (`.usda`).
- `mesh`: writes a `Mesh` prim (`<name>_mesh`) of each body, with `tolerance`, `angle` and
  `max_edge` as in `tessellate`. `mesh=False` writes the exact B-reps alone: for usd-brep and
  Omniverse, which draw `BrepArray` prims themselves and would show each body twice.
- `materials`: also writes a `Material` per color (a `UsdPreviewSurface` of that color, under
  `/World/Looks`, named after the first body of that color) and binds it to the `BrepArray` and
  `Mesh` prims of that color (`rel material:binding`). Omniverse and other renderers color by
  bound materials and leave `displayColor` aside; `import_usd` reads the bindings back.

`export(shapes, "parts.usda")` and `shape.export("part.usd")` do the same.

## What is written
- A stage in millimeters (`metersPerUnit = 0.001`), Z up, all prims under `/World`.
- One `BrepArray` prim per body, named after the body (`plate`; unnamed: `body`, `body_1`, ...),
  with its color as `primvars:displayColor` (unset colors: smlibpy's default palette, as in
  STEP). A prim name holds ASCII letters, digits and `_` only: any other character becomes one
  `_` (`"Größe"` is the prim `Gr__e`, `"Bracket #1"` `Bracket__1`), and the body's name is the
  prim's `displayName`, which viewers show and `import_usd` gives back. Faces, edges and vertices with their exact surfaces and curves: planes, cylinders,
  cones, spheres, tori, lines, circles and ellipses as such (`BrepCurve3dLineAPI`, `CircleAPI`,
  `EllipseAPI`), everything else as NURBS. A circle or an ellipse on a face that is written as
  NURBS (a surface of revolution) stays NURBS: its UV curve on that face follows the NURBS
  parameters.
- A merged part (`merge`) is one prim with its cells and the faces between them.
- A `Mesh` prim per body (unless `mesh=False`): triangles, a normal per point (points on sharp
  edges are written once per face), the body's color.
- A `Mesh` (from `tessellate` or `import_stl`) becomes a `Mesh` prim, not a `BrepArray`.
- The files pass the BrepArray rules of NVIDIA's validator (the test suites run usd-brep's
  `brep_validator` on them, and NVIDIA's `validate_file` itself, `pip install
  "usd-validation-nvidia[usd]"`); of its general USD rules only `UsdAsciiPerformanceChecker`
  complains, which asks for large arrays in binary (crate) files. A body read from another
  program's file and written again keeps what that file broke of the containment rule BA.465
  (rational NURBS whose control points lie outside the body's box; usd-brep's own files do). Loops
  whose UV curves do not close (a sphere's face running up and down its seam) are written without
  UV curves; readers rebuild them.

## Gotchas
- **Text only.** `.usdc` and `.usdz` raise `ValueError: export_usd writes text USD (.usda,
  .usd), not .usdz: write a .usda and pack it with usdzip (usdzip out.usdz out.usda), or in Python
  with OpenUSD: UsdUtils.CreateNewUsdzPackage('out.usda', 'out.usdz')`; for `.usdc` it names
  `usdcat out.usda -o out.usdc`. `usdcat` writes no `.usdz`. The command line tools come with a
  full OpenUSD install (macOS has them); `pip install usd-core` brings only the Python module.
- Without the mesh (`mesh=False`) the file shows nothing in usdview without usd-brep's plugin,
  Blender, Apple's Quick Look or the online USD viewers: they do not draw `BrepArray` prims.
- The stage is in millimeters: viewers that honour `metersPerUnit` show a 60 mm part 6 cm long, a
  speck in a scene measured in meters (the three.js editor does not zoom to it: double-click it in
  the scene list).
- Text USD is larger than STEP with its mesh: the filleted plate with holes of the example 58 kB,
  12 kB with `mesh=False` (STEP: 15 kB).
- Edges, wires and vertices are not written: `TypeError: export_usd writes parts, sheets, faces
  and meshes, not an Edge: export_step and export_dxf write curves, and so does save to an .smp
  file`.
- An empty body (a Boolean that left nothing: no faces, edges or points) raises `ValueError:
  export_usd: the Part is empty: it has no faces, edges or points to write` (0.4 wrote a prim
  usd-brep's validator refuses, or failed with `tessellate failed`).

## Example
```python
plate = Box(60, 40, 8)
plate = (plate.fillet(plate.edges().parallel_to(Z), 6) - GridLocations(44, 24, 2, 2) * Cylinder(3, 8))
plate = plate.named("plate").colored("steelblue")
pin = Cylinder(3, 20).translate(0, 0, 14).named("pin")
export_usd([plate, pin], "parts.usda")                      # BrepArray and Mesh prims under /World
back = import_usd("parts.usda")                             # (the meshes are not read)
print([p.name for p in back], round(back[0].volume, 3) == round(plate.volume, 3))   # ['plate', 'pin'] True
print("def Mesh \"plate_mesh\"" in open("parts.usda").read())   # True

export_usd(plate, "plate_exact.usda", mesh=False)           # the exact B-rep alone
print("def Mesh" in open("plate_exact.usda").read())        # False

text = to_usd([plate, pin], materials=True)                 # a str; a material per color
print(text.count('def Material "'))                        # 2
```

## Related
`import_usd`, `export_step`, `merge`, `tessellate`, `generic`
