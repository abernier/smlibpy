# trim

Cuts a sheet along curves that lie on it, and keeps one side, or both as faces of their own:
a hole or an outline in a freeform panel, a sheet cut back to where another one crosses it,
two sheets cut back to a blend. `Face.split` gives the pieces of one face.

## Signature
`sheet.trim(curves, keep)`
`face.split(curves)`

- `curves`: edges or wires (or a list of them) that lie on the sheet, to 1e-5 of the size:
  where two sheets meet (`intersection_curves`), the long edges of a `surface_fillet`, curves
  projected onto the sheet (`project`). A curve may run across several faces (it is cut where
  it passes from one to the next), run on past the sheet's border on a plane, and cross other
  curves. Together they cut the sheet: each one runs from border to border, or closes a loop.
- `keep`: a point on the side to keep, or near it (not on a curve): the faces it reaches
  without crossing a curve stay. `"split"`: both sides stay, as faces of their own.

## Returns
`trim`: a new sheet of the same type (a `Sketch` stays a `Sketch`); the sheet itself does not
change. `split`: a `ShapeList` of the face's pieces, the faces of a new sheet (the face's own
body does not change; for a part's faces, see `imprint`).

## Along a direction
A hole or an outline along a direction: project the outline onto the sheet first,
`sheet.trim(sheet.project(outline, (0, 0, -1)), keep=...)`. The projected curve is within about
1e-4 of the sheet; that is close enough. (`stitch(Box(...) - prism & sheet)` gives the same
result through Booleans.)

## Measured
- Rectangle(40, 40) sheet, `Circle(5)`: keep the center 78.5398, keep a corner 1521.4602 (one
  face, two loops), split 2 faces.
- Saddle `surface` and a projected circle r 5: kept 78.736, the holed sheet 1169.877 (they add
  up to the sheet, 1248.607); the holed sheet thickens.
- Two crossing lines keep a quarter (400); four lines in a hash keep the middle (400) or a
  corner (100); split gives 4 and 9 faces.
- `surface_fillet(floor, wall, 5, trim=True)` then a plane's intersection curves across all 3
  faces: half the sheet, 757.0796.

## Errors
- `ModelingError: trim: the curves do not split the sheet: each must run across a face from
  border to border, or close a loop on it` (`"split"`), `... do not cut the sheet in two ...`
  (a point): a curve that ends inside a face (a slit), or one along an existing edge.
- `ValueError: trim: the curves must lie on the faces (within 0.00057); move them onto them
  with project()`: a curve off the sheet.
- `ModelingError: trim: nothing is left; ...`: the point lies on no side.
- `ValueError: trim: keep is a point on the side to keep, or "split"; got 'both'`.
- `TypeError: trim takes curves (edges or wires), not a Part`; `ValueError: trim: no curves`.

## Example
```python
sheet = Rectangle(40, 40).faces()[0].to_shell()
disk = sheet.trim(Circle(5).edges(), (0, 0, 0))         # the side of the point: the disk
holed = sheet.trim(Circle(5).edges(), (15, 15, 0))      # the other side: a sheet with a hole
print(round(disk.area, 4), round(holed.area, 4), len(holed.faces()[0].wires()))   # 78.5398 1521.4602 2
both = sheet.trim(Circle(5).edges(), "split")           # 2 faces
quarter = sheet.trim([Line((-30, 0), (30, 0)), Line((0, -30), (0, 30))], (5, 5, 0))
print(round(quarter.area, 6))                            # 400.0

f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
saddle = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
outline = saddle.project(CenterArc((20, 15, 50), 5, 0, 360), (0, 0, -1))
panel = saddle.trim(outline, keep=(2, 2, 0))             # a hole through the curved panel
print(round(panel.area, 3), panel.thicken(1).is_valid())  # 1169.871 True

halves = Rectangle(40, 40).faces()[0].split(Line((-20, -20), (20, 20)))
print([round(h.area, 6) for h in halves])                # [800.0, 800.0]
```

## Related
`surface_fillet` (`trim=True` cuts both faces back to the blend), `intersection_curves`,
`project`, `imprint` (split a part's faces), `stitch`, `Shell`, `generic`
