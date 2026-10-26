# flat_pattern

The blank of a sheet metal part laid on the XY plane, with its cutting contour and bend lines.

## Signature
`flat_pattern(part, *, k_factor=None, fixed=None)` -> `FlatPattern`
`part.flat_pattern(*, k_factor=None, fixed=None)`

`k_factor` as for `unfold`: by default each bend's own (from `fold`, `flange`), else 0.44.

## Returns
A `FlatPattern`:
- `part`: the flat solid; bottom face at z = 0, top at z = thickness, the longer side of the
  smallest rectangle around it along X, its bounding box starting at the origin.
- `outline`: the cutting contour as a `Sketch` at z = 0: lines and circles (collinear pieces
  joined), holes as inner loops. 4 lines and 1 circle for a plate with one hole and two flanges.
  Pieces that crossed a bend are fitted B-splines in the flat part; in the outline those that
  are lines or arcs within 1e-6 mm become lines and arcs, and arcs of one circle in a row one
  arc: a hole across a bend is one circle again (it was 3 arcs and 2 B-splines), an oblique cut
  across a bend one line. Spline cutouts stay splines.
- `bends`: one `Bend` each: `angle`, `radius`, `thickness`, `k_factor`, `allowance`, `length`,
  `line` (the bend line at z = 0, the middle of the bend's strip) and `direction` (`"up"`: the
  sheet beyond the line folds towards +Z).
- `bend_lines`: the lines alone; `size`: (length, width, thickness); `thickness`; `k_factor`:
  the K-factor of every bend, `None` where they differ (each `Bend` has its own).

The largest face of the part lies at z = 0 facing down, so a tray's bends are all `"up"`.

## For a laser cutter
- The contour and the bend lines are ordinary sketches and edges in the XY plane, ready for a
  2D export; `export_step(pattern.part, "flat.step")` writes the blank as a solid.
- Bend lines are the middle of the bend zones; the zone is `allowance` wide.

## Gotchas
- A part without bends gives its own flat pattern (`Box(10, 20, 2)`: 20 x 10, no bends).
- Parts that do not unfold raise like `unfold`.
- Holes across a bend zone or wholly inside it come back as one circle in the outline, and
  `pattern.part` is valid (a 100 x 40 x 2 plate with a hole of r 1 to 8 on a 90 degree bend).

## Example
```python
part = Box(120, 50, 1.5, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(4, 10)
edges = part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - 1.5) < 1e-6)
part = part.flange(edges.last, 25, radius=1.5)
part = part.flange(part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - 1.5) < 1e-6).first, 25,
                   radius=1.5, angle=-90)
pattern = flat_pattern(part)
print(pattern)
print([(len(w.edges()), sorted({e.geom_type for e in w.edges()})) for w in pattern.outline.faces()[0].wires()])
for b in pattern.bends:
    print(b.direction, b.angle, b.radius, round(b.allowance, 4), b.line)
export_step(pattern.part, "flat.step")                    # the blank as a solid
```
Prints `FlatPattern(170.786 x 50, thickness=1.5, 2 bends, k_factor=0.44)`,
`[(4, ['line']), (1, ['circle'])]`, then `up 90.0 1.5 3.3929 Edge(line, (23.7, 0, 0) -> (23.7, 50, 0))`
and `down 90.0 1.5 3.3929 Edge(line, (147.1, 0, 0) -> (147.1, 50, 0))` (y 0 to within 1e-13).

## Related
`unfold`, `bends`, `export_step`, `recipes/sheet-metal`.
