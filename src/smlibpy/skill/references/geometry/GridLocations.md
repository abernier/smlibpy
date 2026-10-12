# GridLocations

A rectangular grid of positions in the XY plane, centered on the origin by default.

## Signature
`GridLocations(x_spacing, y_spacing, x_count, y_count, *, centered=True)`.
Spacing is center-to-center distance in mm; counts are integers ≥ 1.

## Returns
`Locations` with `x_count * y_count` translations (no rotation).
- `centered=True`: the grid's middle is at the origin; x from `-x_spacing*(x_count-1)/2`.
  `GridLocations(60, 40, 2, 2)` gives (±30, ±20).
- `centered=False`: the first copy is at the origin, the grid grows toward +x and +y.
- Order: x varies fastest, then rows in +y:
  `GridLocations(20, 10, 3, 2)` -> (-20,-5), (0,-5), (20,-5), (-20,5), (0,5), (20,5).
- A count of 1 puts that axis at 0; the spacing is then ignored.

## Usage
- Holes through a plate: `plate - GridLocations(60, 40, 2, 2) * Cylinder(4, 20)`. Make the
  tool longer than the plate is thick.
- Holes from a face: `plate - (GridLocations(30, 20, 2, 2) * Hole(2, 6)).on(top)`; on a side
  face the grid's x and y follow the face's local axes (see `on`).
- Sketches: `Rectangle(60, 40) - GridLocations(44, 24, 2, 2) * Circle(2.5)`.
- Offset every copy: `GridLocations(...) * Pos(8) * Hole(...)`.

## Gotchas
- Spacing is not the overall size: the outer centers are `spacing * (count - 1)` apart.
  Copies that reach past the part edge give half holes without an error.
- A negative spacing mirrors the order; zero spacing stacks all copies on one point.
- `on` the grid after multiplying with the shape, not before (see `Locations`).

## Errors
- `ValueError: counts must be at least 1` for a count < 1.
- `TypeError: 'float' object cannot be interpreted as an integer` for a float count.

## Example
```python
plate = Box(80, 60, 10)
plate = plate - GridLocations(60, 40, 2, 2) * Cylinder(4, 20)        # through holes, tool longer than 10
print(len(plate.faces().cylinders()), plate.is_valid())

g = GridLocations(20, 10, 3, 2)
print([tuple(p)[:2] for p in g.points])     # x first, then rows in +y; centered on the origin
print(GridLocations(20, 10, 3, 2, centered=False).points[-1])   # Vector(40, 10, 0)

top = plate.faces().top()
plate -= (GridLocations(30, 20, 2, 2) * Hole(2, 6)).on(top)       # blind holes from the top face
print(len(plate.faces().cylinders()), round(plate.volume, 3))

panel = Rectangle(60, 40) - GridLocations(44, 24, 2, 2) * Circle(2.5)   # works for sketches too
print(round(panel.area, 3))
```

## Related
`Locations`, `PolarLocations`, `HexLocations`, `on`, parts `Hole`.
