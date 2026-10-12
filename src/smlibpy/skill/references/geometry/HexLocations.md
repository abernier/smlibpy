# HexLocations

A honeycomb pattern of positions in the XY plane: rows along X, every other row shifted by
half a spacing.

## Signature
`HexLocations(spacing, x_count, y_count, *, centered=True)`.
- `spacing`: distance between neighbours, in a row and diagonally (all six neighbours are
  `spacing` apart).
- `x_count`: positions per row; `y_count`: number of rows.
- Rows are `spacing * √3 / 2` apart in Y; odd rows (2nd, 4th, ...) are shifted `+spacing/2`
  in X.

## Returns
`Locations` with `x_count * y_count` translations, no rotation. With `centered=True` the
bounding box of the points is centered on the origin; with `centered=False` the first point
is at the origin. Order: along x first, then row by row in +y.
`HexLocations(10, 3, 2)` -> (-12.5, -4.33), (-2.5, -4.33), (7.5, -4.33), (-7.5, 4.33),
(2.5, 4.33), (12.5, 4.33).

## Honeycomb cells
For hexagonal cells of width across flats `f` and wall `w`:
`HexLocations(f + w, nx, ny) * RegularPolygon(f / 2, 6, inscribed=True, rotation=30)`.
`rotation=30` puts the flats toward the neighbours (corners up), so every wall is exactly `w`.
Without it, the corners point at the neighbours and the walls vary.

## Gotchas
- Because odd rows shift right, the pattern is wider than `spacing * (x_count - 1)` by
  `spacing / 2` when `y_count > 1`.
- Counts of 0 or below return an empty pattern without an error (unlike `GridLocations`).
- A honeycomb cut makes many faces (30 cells -> 186 faces); keep the counts reasonable.

## Example
```python
flats, wall = 8, 1.5
cells = HexLocations(flats + wall, 6, 5) * RegularPolygon(flats / 2, 6, inscribed=True, rotation=30)
plate = Box(70, 50, 4) - [c.extrude(10).translate(0, 0, -5) for c in cells]
print(len(cells), plate.is_valid())
print(round(cells[1].bbox().min.x - cells[0].bbox().max.x, 4))   # 1.5: the wall

pts = HexLocations(10, 3, 2).points
print([tuple(round(c, 3) for c in p)[:2] for p in pts])   # rows 8.66 apart, odd rows shifted 5
```

## Related
`GridLocations`, `Locations`, sketches `RegularPolygon`.
