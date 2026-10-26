# PolarLocations

Positions on a circle around the origin in the XY plane: bolt circles, spokes, teeth.

## Signature
`PolarLocations(radius, count, *, start_angle=0.0, angular_range=360.0, rotate=True)`.
Angles in degrees, measured from +X counterclockwise.

## Returns
`Locations` with `count` placements at distance `radius` from the origin.
- **Full circle** (`angular_range` exactly ±360): even spacing `360 / count`, the start is
  not repeated. `PolarLocations(30, 4)` -> 0°, 90°, 180°, 270°.
- **Arc** (any other range): both ends included, spacing `angular_range / (count - 1)`.
  `PolarLocations(30, 4, angular_range=90)` -> 0°, 30°, 60°, 90°.
- `start_angle` shifts the first copy. A negative range runs clockwise.
- `rotate=True` (default): each copy is also turned by its angle about its own origin, so
  the shape's +X points outward (radially). `rotate=False`: copies keep their orientation.
- `radius=0` with `rotate=True` only turns the copies; useful for teeth drawn at their place
  (`PolarLocations(0, 12) * tooth`).

## Gotchas
- An arc range close to 360 (e.g. 359.9999) is an arc: first and last copy coincide.
  Ranges above 360 (e.g. 720) also produce coincident copies.
- With `rotate=True` the shape turns about its own origin, then moves out: draw the shape
  centered on the origin (or with +X as the outward direction).
- A round shape looks the same either way; `rotate` matters for bars, slots, teeth.
- A negative radius puts copies on the opposite side but keeps the rotation of the
  positive angle.

## Errors
- `ValueError: count must be at least 1`.

## Example
```python
flange = Cylinder(60, 10) - Cylinder(20, 12) - PolarLocations(45, 8) * Cylinder(5, 12)
print(flange.is_valid(), len(flange.faces().cylinders()))   # True 10: outer, bore, 8 holes

def angle(p):
    return round(math.degrees(math.atan2(p.y, p.x)), 3)

print([angle(p) for p in PolarLocations(30, 4).points])                       # 0, 90, 180, -90
print([angle(p) for p in PolarLocations(30, 4, start_angle=45).points])       # 45, 135, -135, -45
print([angle(p) for p in PolarLocations(30, 4, angular_range=90).points])     # 0, 30, 60, 90: ends included

spokes = PolarLocations(20, 3) * Box(10, 2, 2)                  # rotate=True: bars point outward
level = PolarLocations(20, 3, rotate=False) * Box(10, 2, 2)     # all stay parallel to X
print([tuple(round(v, 2) for v in s.bbox().size) for s in spokes])
print([tuple(round(v, 2) for v in s.bbox().size) for s in level])

gear = Circle(20) + PolarLocations(0, 12) * Rectangle(6, 4).translate(21, 0)   # radius 0: only turns
print(len(gear.faces()), round(gear.area, 3))
```

## Related
`Locations`, `GridLocations`, `Rot`, `rotate`, `on` (polar pattern on a face).
