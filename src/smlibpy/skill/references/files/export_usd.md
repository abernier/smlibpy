# export_usd

Writes parts, sheets and meshes to a USD file with the exact geometry: each body becomes a
`BrepArray` prim, the B-rep format of NVIDIA's usd-brep (its omniSolid schema), which usd-brep,
its usdview plugin and Omniverse read as solids. For USD and Omniverse pipelines.

## Signature
`export_usd(shapes, path, *, mesh=False, tolerance=None, angle=15.0)`

- `shapes`: a `Part`, `Shell`, `Sketch`, `Face`, `Mesh`, or a list of them.
- `path`: a `.usda` or `.usd` file; it is written as text (`.usda`).
- `mesh=True`: also writes a `Mesh` prim (`<name>_mesh`) of each body, for USD tools that do
  not read B-reps (most viewers). `tolerance` and `angle` as in `tessellate`.

`export(shapes, "parts.usda")` and `shape.export("part.usd")` do the same.

## What is written
- A stage in millimeters (`metersPerUnit = 0.001`), Z up, all prims under `/World`.
- One `BrepArray` prim per body, named after the body (`plate`; unnamed: `body`, `body_1`, ...),
  with its color as `primvars:displayColor` (unset colors: smlibpy's default palette, as in
  STEP). Faces, edges and vertices with their exact surfaces and curves: planes, cylinders,
  cones, spheres, tori, lines, circles and ellipses as such, everything else as NURBS.
- A merged part (`merge`) is one prim with its cells and the faces between them.
- A `Mesh` (from `tessellate` or `import_stl`) becomes a `Mesh` prim, not a `BrepArray`.

## Gotchas
- **Text only.** `.usdc` and `.usdz` raise `ValueError: export_usd writes text USD (.usda,
  .usd), not .usdz; convert it with usdcat (usdcat out.usda -o out.usdz)`. `usdcat` comes with
  OpenUSD (`pip install usd-core`).
- Plain USD viewers (usdview without usd-brep's plugin, Blender, Apple's Quick Look) do not draw
  `BrepArray` prims: write `mesh=True` for them.
- Text USD is larger than STEP: a filleted plate with holes 20 kB, with `mesh=True` 114 kB.
- Edges, wires and vertices are not written.

## Example
```python
plate = Box(60, 40, 8)
plate = (plate.fillet(plate.edges().parallel_to(Z), 6) - GridLocations(44, 24, 2, 2) * Cylinder(3, 8))
plate = plate.named("plate").colored("steelblue")
pin = Cylinder(3, 20).translate(0, 0, 14).named("pin")
export_usd([plate, pin], "parts.usda")                      # two BrepArray prims under /World
back = import_usd("parts.usda")
print([p.name for p in back], round(back[0].volume, 3) == round(plate.volume, 3))   # ['plate', 'pin'] True

export_usd(plate, "plate.usda", mesh=True)                  # plus a Mesh prim for viewers
print("def Mesh \"plate_mesh\"" in open("plate.usda").read())   # True
```

## Related
`import_usd`, `export_step`, `merge`, `tessellate`, `generic`
