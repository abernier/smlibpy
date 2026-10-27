# flange

Adds a flange along a straight outer edge of a sheet: the sheet is extended beyond the edge and
bent there.

## Signature
`flange(part, edge, length, *, angle=90, radius, k_factor=0.44)`
`part.flange(edge, length, *, angle=90, radius, k_factor=0.44)`

- `edge`: one straight edge (an `Edge` or a selection of one) where a top or bottom face of the
  sheet meets a side face. The flange folds towards the side that face faces.
- `length`: outside length from the virtual sharp (where the outer faces of sheet and flange
  meet) to the flange's end. For 90 degrees: the height over the outer face of the sheet.
- `angle`: below 180; negative folds the other way.

## Returns
A `Part`. The bend starts at the edge, so the sheet keeps its size and the outside grows by
R + t for 90 degrees. On a 100 x 60 x 2 plate (z = 0..2), flanging the top edge at x = 50 with
length 20 and R 2:

| angle | bbox max x | z range |
|---|---|---|
| 90 | 54.0 | 0 .. 20.0 |
| 45 | 65.799 (sharp at 51.657 + 20 cos 45) | 0 .. 15.5563 |
| 120 | 54.0 | 0 .. 17.3205 |
| -90 | 54.0 | -18.0 .. 2.0 |

## Gotchas
- Select edges of the base by position: after a flange, `edges().top()` returns the new flange's
  top edges. Filter on the face height: `edges().filter_by(Y).filter(lambda e: abs(e.center().z - t) < 1e-6)`.
- Four flanges on a plate make a tray with open corners, R + t wide (108 x 68 x 20 from 100 x 60).
- For outside dimensions of the finished part, make the plate smaller by R + t per flanged side.

## Errors
- `ModelingError: flange: the length must be more than the bend's outside setback (radius + thickness) * tan(angle / 2) = 4; got 3`
- `ValueError: flange: give one edge of the part (got 4); flange edges one at a time`
- `ValueError: flange: the angle must be between -180 and 180 degrees (exclusive) and not zero (got 180)`
- `ValueError: flange: the edge must be straight, not a circle`

## Example
```python
t, r = 2, 2
tray = Box(100, 60, t, align=(Align.CENTER, Align.CENTER, Align.MIN))
for axis, last in ((Y, True), (Y, False), (X, True), (X, False)):
    top_edges = tray.edges().filter_by(axis).filter(lambda e: abs(e.center().z - t) < 1e-6)  # base plate's top edges
    ordered = top_edges.sort_by(Y if axis is X else X)
    tray = tray.flange(ordered.last if last else ordered.first, 20, radius=r)
print(tray.bbox().size, tray.is_valid())                 # Vector(108, 68, 20) True: 100 + 2 * (r + t) by 60 + 2 * (r + t) by 20
```
Prints `Vector(108, 68, 20) True`.

## Related
`fold`, `flat_pattern`, `sheetmetal/generic`, `recipes/sheet-metal`.
