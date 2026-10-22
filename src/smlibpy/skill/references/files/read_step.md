# read_step

Reads everything of a STEP file that smlibpy can use: the bodies (as `import_step` does), and
the coordinate systems, curves and points that belong to no body. Tool catalogs and NX write
cutting tools so: the tool's solids, its coordinate systems (`MCS`, `PCS`, `CSW1_1`, `CIP`), its
cutting edge lines and reference points (`CRP`).

## Signature
`read_step(path, *, heal=True, strict=False)`

- `path`: `str` or `pathlib.Path`.
- `heal`, `strict`: as for `import_step`.

## Returns
A `StepModel` with four lists, each item at its place in the assembly, in mm, and the bodies
left out:
- `bodies`: a `ShapeList` of `Part`s and `Shell`s, the same as `import_step` gives, also when there
  is one body or none.
- `frames`: `StepFrame(name, plane, product, color)`. `plane` is a `Plane` (origin, `x_dir`,
  `z_dir`); `f.location` is the `Location` that moves the world origin onto it.
- `curves`: `StepCurve(name, shape, product, color)`. `shape` is an `Edge` (a `Wire` for a composite
  curve) with its exact type: B-spline, line segment, arc, ellipse.
- `points`: `StepPoint(name, point, product, color)`, `point` a `Vector`.
- `skipped`: one message (`str`) per body that could not be read, as the warning says it:
  `"body 'b' (#99): curve type OFFSET_CURVE_3D (#203), which is not supported"`. Empty when every
  body was read; `repr` then says nothing of it.

`product` is the name of the part or assembly the item belongs to (`""` without product
structure). `color` is `(r, g, b)` in 0..1 or `None`.

`model.frame(name, product=None)` returns the `Plane` of the one coordinate system of that name.

```python
tool = read_step("drill.stp")
print(tool)       # StepModel(3 bodies, 9 frames, 2 curves, 10 points)
print(tool.frames[-1])
# StepFrame('CIP', product='AC_20200513095521', Plane(origin=(0, 0, -141), x_dir=(1, 0, 0), z_dir=(0, 0, 1)))
print(tool.curves[0])
# StepCurve('CUTTING EDGE LINE', product='CUT_20200513095645', Edge(bspline, (-10.54, 0.5874, -131.3) -> ...))
mcs = tool.frame("MCS", product="NOCUT")   # Plane.XY: the tool's mounting system
```

## What is read
- Coordinate systems: every `AXIS2_PLACEMENT_3D` of supplemental geometry
  (`CONSTRUCTIVE_GEOMETRY_REPRESENTATION`, AP242), and the named ones listed by shape
  representations. The unnamed placements every representation lists for the assembly are not
  coordinate systems and are left out.
- Curves and points: the items of shape representations, also inside `GEOMETRIC_CURVE_SET` and
  `GEOMETRIC_SET`: B-splines (all forms), polylines, circles and ellipses, `TRIMMED_CURVE`s (by
  parameter or by point) and `COMPOSITE_CURVE`s. A `LINE` without trims has no ends and is left out.
- Items on a hidden layer (`INVISIBILITY`) are left out: NX hides its helper geometry so.
- ClassCAD writes a point named `Origin` into every file; it comes back as a point.

## Uses
- Placing a tool by its mounting system: `holder.moved(tool.frame("MCS", product="NOCUT").location)`.
- The cutting edge as a curve: `tool.curves[0].shape.length`, `.point_at(t)`, `sweep` along it.
- Looking at it: `render(tool)` draws the bodies and curves and marks the coordinate systems and
  named points; the live view of a session shows the bodies and curves.
- Wireframe-only files (sketches, curve sets), which `import_step` refuses: `read_step` gives
  their curves and no bodies.
- Writing it back: `export_step(tool, "out.step")` writes the bodies with the frames, curves and
  points (names and colors kept); `export_step([part, StepFrame("MCS", plane), StepCurve("path",
  wire), StepPoint("CRP", Vector(0, 0, 5))], path)` writes new ones. All three are values:
  `StepFrame(name, plane, product="", color=None)`, the same order of fields for the others.

## Gotchas
- **Names repeat across products.** Each part of a tool assembly has its own `MCS` and `PCS`;
  `tool.frame("MCS")` raises `KeyError` listing the products. Pass `product=` (the beginning of the
  product name is enough, product names often end in a time stamp).
- A frame's axes are unit vectors; the file's own x direction is kept (`x_dir` is the file's
  `ref_direction` made perpendicular to `z_dir`).
- Edges and points carry no name themselves: keep the `StepCurve` or `StepPoint` when the name
  matters.
- Not read: wireframe topology (`EDGE_BASED_WIREFRAME_MODEL`, `SHELL_BASED_WIREFRAME_MODEL`),
  surfaces of a `GEOMETRIC_SET`, PMI and annotations.

## Errors
- `ValueError: not a STEP file (no DATA section)`, `FileNotFoundError`, and the `KernelError`s of
  `import_step` for the bodies. A curve the kernel cannot build is left out.
- `model.frame(...)`: `KeyError` when no coordinate system or several have the name.

## Related
`import_step` (the bodies alone), `export_step` (writes a `StepModel` back), `Plane`, `Location`,
`render`, `show`, `import_dxf_wires`.
