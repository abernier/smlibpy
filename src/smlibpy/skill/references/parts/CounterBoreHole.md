# CounterBoreHole

A drilling tool with a counterbore (a wider, flat-bottomed recess) at the top, for socket head
screws. Subtract it from a part.

## Signature

`CounterBoreHole(radius, counter_bore_radius, counter_bore_depth, depth)`

All four are required, all radii (not diameters), mm:

- `radius`: the drill.
- `counter_bore_radius`: the recess for the head; must be larger than `radius`.
- `counter_bore_depth`: depth of the recess, measured from the face.
- `depth`: **total** depth from the face, recess included. Must be larger than `counter_bore_depth`.

## Returns

A `Part` hanging down from the origin like `Hole`: `CounterBoreHole(2, 4, 3, 10)` is a
cylinder r 4 from z −3 to 0 on top of a cylinder r 2 from z −10 to −3. One solid, 5 faces.
Place it with `.on(face)` exactly like `Hole` (same face axes, same centroid caveat).

Cut into the top of `Box(60, 40, 10)` (top at z 5): drill r 2 from z −5 to 2, recess r 4 from
z 2 to 5, a flat shoulder at z 2 of area π(4² − 2²). The part gains 3 faces.

## Gotchas

- `depth` is not the drill length below the recess. For a through hole in a plate of thickness
  t, use `depth >= t`.
- No parameter checks: `counter_bore_radius <= radius` gives a plain hole of the larger radius;
  `counter_bore_depth >= depth` gives one cylinder `counter_bore_depth` deep. Check the faces of
  the result if the numbers come from a calculation.

## Errors

- A zero or negative value: `ValueError: radius and height must be positive` (the message comes
  from the cylinder inside).
- Three arguments: `TypeError: CounterBoreHole() missing 1 required positional argument: 'depth'`.

## Example

```python
# Counterbore for an M6 socket head screw through a 10 mm plate
plate = Box(80, 60, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
top = plate.faces().top()
plate -= (GridLocations(60, 40, 2, 2) * CounterBoreHole(3.3, 5.5, 6.5, 10)).on(top)
print(sorted({(round(f.radius, 2), round(f.bbox().min.z, 3), round(f.bbox().max.z, 3))
              for f in plate.faces().cylinders()}))      # [(3.3, 0.0, 3.5), (5.5, 3.5, 10.0)]
print(plate.is_valid(), round(80 * 60 * 10 - plate.volume, 3))   # True 2949.83 = 4 * pi * (3.3² * 3.5 + 5.5² * 6.5)
```

## Related

`Hole`, `CounterSinkHole`, `booleans`, `geometry/GridLocations`.
