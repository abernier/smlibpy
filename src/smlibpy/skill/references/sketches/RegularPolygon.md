# RegularPolygon

A regular polygon with `sides` corners, centered on the origin.

## Signature
`RegularPolygon(radius, sides, *, inscribed=False, rotation=0.0, align=Align.CENTER)`
- `radius`: distance from the center to the corners (circumscribed circle).
- `inscribed=True`: `radius` is the distance to the middle of the sides instead. For a hexagon
  measured across flats: `RegularPolygon(flats / 2, 6, inscribed=True)`.
- `sides`: an `int` (3 or more).
- `rotation`: degrees counter-clockwise about the center.

## Returns
A `Sketch`. The first corner is on +X at `rotation=0`.
- Hexagon: corners at (±r, 0), flats at the top and bottom (y = ±r·cos 30°). With
  `inscribed=True` the flats are at y = ±radius. `rotation=30` puts corners at top and bottom.
- Square (`sides=4`): a **diamond** with corners on the axes. `rotation=45` gives an axis-aligned
  square; `RegularPolygon(10, 4, inscribed=True, rotation=45)` is 20 x 20.
- Triangle: corners (r, 0), (-r/2, ±0.866r); its centroid is on the origin, its bbox is not
  centered (x -r/2..r).

## Gotchas
- `align=Align.CENTER` (the default) keeps the polygon's center on the origin, but
  `align=(Align.CENTER, Align.CENTER)` centers the bounding box instead. For odd `sides` they
  differ: a triangle moves by r/4 in x.
- A negative radius turns the polygon by 180 degrees, no error.

## Errors
- `ValueError: a polygon needs at least three sides`.
- `TypeError: 'float' object cannot be interpreted as an integer`: `sides=6.0`.
- `KernelError: sketch failed (SM_ERR)`: `radius=0`.

## Example
```python
nut = RegularPolygon(6.5, 6, inscribed=True) - Circle(3.4)   # M6 nut: 13 across flats
hex_up = RegularPolygon(10, 6, rotation=30)                  # corners at (0, ±10)
square = RegularPolygon(10, 4, inscribed=True, rotation=45)  # 20 x 20, axis aligned
```

## Related
`Polygon`, `Circle`, `HexLocations` (geometry), `generic`.
