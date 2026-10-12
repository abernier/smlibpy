# PolarLine

A straight edge given by its start point, length and angle.

## Signature
`PolarLine(start, length, angle, plane=Plane.XY)`

- `start`: the start point in **world** coordinates.
- `length`: mm. A negative length points the other way (the edge length is still positive).
- `angle`: degrees, counterclockwise from the plane's X axis towards its Y axis. Any value
  works (400 = 40, -45 points down-right in XY).
- `plane`: only sets the directions of the angle's X and Y axes. Its origin is ignored.

## Returns
An `Edge` (a `Line`) from `start` to `start + length * (cos(angle) * plane.x_dir +
sin(angle) * plane.y_dir)`.

| plane | angle 0 goes to | angle 90 goes to |
|---|---|---|
| `Plane.XY` / `top` | +X | +Y |
| `Plane.XZ` / `front` | +X | +Z |
| `Plane.YZ` / `right` | +Y | +Z |
| `Plane.back` | -X | +Z |

## Gotchas
- **`start` is not in plane coordinates**, unlike the center of `CenterArc`.
  `PolarLine((1, 2), 10, 0, plane=Plane.XY.offset(5))` starts at (1, 2, 0), not at z = 5.
  Give the world start point, or build on XY and move the edge with `.on(plane)`.
- Like `Line`, the result is an `Edge`, not a `Wire`.

## Errors
- `ValueError: a line needs two distinct points` for `length=0`.

## Example
```python
e = PolarLine((0, 0), 10, 30)                      # end (8.66025, 5, 0)
up = PolarLine((0, 0), 10, 90, plane=Plane.XZ)     # end (0, 0, 10)
print(e.end, up.end)
```

## Related
`Line`, `Polyline`, `CenterArc`, `geometry/Plane`.
