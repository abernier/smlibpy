# import_step

Reads the solids and surfaces of a STEP file (AP203, AP214, AP242) as exact smlibpy bodies.
`load("x.step")` does the same thing.

## Signature
`import_step(path, *, heal=True)`

- `path`: `str` or `pathlib.Path`. `load()` sends `.step`, `.stp` and `.p21` here (in any
  letter case).
- `heal`: run the kernel's healer on solids that come out invalid. Valid solids are never
  touched.

## Returns
The return type depends on how many bodies the file holds:
- One body: a `Part` (a solid) or a `Shell` (a surface model or a sheet).
- Several bodies: a `ShapeList` of them, in file order, each at its place in the assembly.

Handle both cases:
```python
r = import_step(path)
parts = r if isinstance(r, ShapeList) else [r]
```

Lengths are converted to mm, whatever unit the file declares. Faces keep their exact surface
types, so a cylinder stays a cylinder and a B-spline keeps its control points. A hollow solid
(`BREP_WITH_VOIDS`) comes back as one `Part` with its cavity.

## Names and colors
- `p.name` is the label of the solid in the file. Many CAD systems leave that label empty and
  name only the product (OpenCASCADE, for example); then `p.name` is the name of the product
  the solid belongs to. Assembly instance names are not read.
- `p.color` is a tuple `(r, g, b)` in 0..1, or `None`. Predefined STEP colors come back as
  ints (`(1, 0, 0)`), RGB colors as floats.

## Gotchas
- **Always check `is_valid()` on what you import.** A broken body does not raise. A solid with
  a missing face came back as a `Part` with `is_valid() == False` and a meaningless volume (8000
  for an open 20 mm cube), with `heal=True` as well.
- **Check foreign assemblies with a picture.** Exporters disagree on which side of a placement
  belongs to the assembly; smlibpy follows the CAx-IF rules and the product structure, which
  places the CAx-IF AS1 and DM1 assemblies of AutoCAD, OpenCASCADE, Pro/E and others correctly.
  For a file from an exporter not seen before, render with `view="sheet"`, or measure
  `distance_to` between parts that should touch.
- One `Part` written with two disjoint solids comes back as a `ShapeList` of two parts.
- A `Sketch` written to STEP comes back as a `Shell`.
- A single-body file gives a bare `Part`, so `len(r)` and `for p in r` fail on it. Use the
  pattern above.
- Not read: wireframe geometry, references to external files, PMI, and assembly placements
  that mirror a part (`ModelingError: mirrored assembly placements are not supported yet`).

## Errors
- `ModelingError: the STEP file holds no B-rep solids or surfaces`: a wireframe-only or empty
  file.
- `ValueError: not a STEP file (no DATA section)`: the file is not STEP.
- `FileNotFoundError` for a missing file.
- `KernelError` for the operation `import STEP`, with the hint "the file may hold faces the
  kernel cannot rebuild".

## Example
```python
r = import_step("assembly.step")
parts = r if isinstance(r, ShapeList) else [r]
for p in parts:
    print(type(p).__name__, p.name, p.color, p.is_valid(), round(p.volume, 3))
# Part bracket (0.2745..., 0.5098..., 0.7058...) True 18797.876
# Part cover (0.8509..., 0.5725..., 0.3529...) True 4800.0
```
OpenCASCADE reference files (box, cylinder, sphere, torus, cone, fillets, holes, revolve,
loft, sweep, hollow, chamfer, shell) all read back valid, with the volume within 2.2e-7 of
OpenCASCADE's value.

## Related
`load`, `export_step`, `Part.heal`, `Part.is_valid`, `render` (to check an import), `generic.md`.
