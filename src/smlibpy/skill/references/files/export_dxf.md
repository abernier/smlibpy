# export_dxf

Writes 2D shapes to a DXF drawing with exact curves: sketches, sections of parts, text, wires
and edges, for laser cutting, CNC, 2D CAD and drawings. `export(shapes, "x.dxf")` and
`shape.export("x.dxf")` do the same.

## Signature
`export_dxf(shapes, path, *, unit="mm", plane=None)`

- `shapes`: a `Sketch`, a planar `Face` or sheet, a `Wire`, an `Edge`, the views of
  `drawing_views`, or a list of them. Views go on the layers `VISIBLE` and `HIDDEN`; the hidden
  layer has the linetype `DASHED` (3 mm dashes, 1.5 mm gaps, in the file's unit).
- `unit`: `"mm"` (default), `"cm"`, `"m"`, `"um"`, `"inch"` (or `"in"`), `"ft"`. The model (mm) is
  converted and `$INSUNITS` declared: a 50.8 mm rectangle is 2 wide in an inch file and reads
  back as 50.8 mm.
- `plane`: the drawing plane; the shapes are written in its coordinates (x along `x_dir`, y
  along `y_dir`) and must lie in planes parallel to it.

## Returns
`None`. An AutoCAD 2000 (AC1015) file with one entity per curve:

| Curve | Entity |
|---|---|
| line, straight B-spline | LINE |
| circular arc, full circle | ARC, CIRCLE (exact center and radius) |
| ellipse or elliptical arc | ELLIPSE |
| any other B-spline | SPLINE (control points, knots, weights when rational) |

Sections of parts come from the kernel as rational B-splines; the writer recognizes the
circular ones (each span of a degree-2 rational spline is a conic, and seven points of a span
on one circle prove it is that circle), joins the arcs of one circle, and writes ARC and
CIRCLE: the section of a filleted block with two holes is 4 LINE, 4 ARC, 2 CIRCLE.

A shape's `name` is its layer (`Text(...).named("engrave")` goes to layer `engrave`); unnamed
shapes go to layer `0`. Layer names keep ASCII letters, digits, `-`, `_`, `$` and spaces; other
characters become `_` (`"Bügel/2"` is layer `B_gel_2`), so the file is plain ASCII.

## The drawing plane
| Shapes | Written in |
|---|---|
| in the XY plane, or in planes parallel to it | world X and Y (a sketch at z = 7 keeps its x and y) |
| a sketch in another plane, `plane` not given | that sketch's plane: origin and axes of `sketch.plane` |
| `plane=` given | that plane's coordinates |

`part.section(Plane.XZ)` is written with x = world X and y = world Z. A sketch moved within
`Plane.XZ` has its plane origin moved with it: pass `plane=Plane.XZ` to keep world coordinates
(a 10 × 4 rectangle at x 0..10 is written at 0..10, without `plane` at -5..5).

## Gotchas
- A `Part` cannot be written: write `part.section(plane)` (a cross-section) or the edges of
  `part.outline(plane)` (a 2D view; a holed box gives 4 LINE + 1 CIRCLE).
- Text is written as its outlines (LINE and degree-2 or degree-3 SPLINE), not as DXF text.
- Shapes in different, non-parallel planes need `plane=` (and then raise, as they are not parallel).
- Every number is written with full precision: the round trip of a sketch gives the same
  radii (5.0, 6.0), the same B-spline control points and knots, and the same area.

## Errors
- `TypeError: export_dxf writes 2D shapes, not a Part; write part.section(plane) for a cross-section or the edges of part.outline(plane) for a view`.
- `TypeError: export_dxf writes planar faces; this face is curved`; `TypeError: export_dxf cannot write a Mesh`; `TypeError: export_dxf writes curves; a Vertex has none`.
- `ValueError: export_dxf: the shapes are not parallel to the drawing plane; pass the plane they lie in`.
- `ValueError: export_dxf: the shapes are neither in planes parallel to XY nor in one sketch's plane; pass plane=...`.
- `ValueError: unknown unit 'MM'; use mm, cm, m, um, inch or ft`.

## Example
```python
part = Box(40, 30, 20) - Cylinder(8, 30)
export_dxf(part.section(Plane.XY), "section.dxf")                 # 4 LINE, 1 CIRCLE
export_dxf(part.section(Plane.XZ), "side.dxf")                    # x = X, y = Z
tag = [RoundedRectangle(40, 12, 2).named("cut"), Text("PART 7", 5).named("engrave")]
export_dxf(tag, "tag.dxf", unit="inch")                           # two layers, inches
print(import_dxf("tag.dxf", layers=["cut"]).bbox().size)          # Vector(40, 12, 0)
```

## Related
`import_dxf`, `import_dxf_wires`, `Part.section`, `Part.outline`, `Text` (sketches), `export`,
`generic.md`.
