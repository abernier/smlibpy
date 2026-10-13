# CenterArc

A circular arc or full circle around a center, given by start angle and angular size.

## Signature
`CenterArc(center, radius, start_angle, arc_size, plane=Plane.XY)`

- `center`: in **plane coordinates** (2-tuple, or 3-tuple to offset along the plane normal).
  `CenterArc((5, 2), 10, 0, 90, plane=Plane.XZ)` has its world center at (5, 0, 2).
- `radius`: mm, > 0.
- `start_angle`: degrees, counterclockwise from the plane's X axis towards its Y axis. Any
  value (720 = 0, -30 = 330).
- `arc_size`: degrees. Positive runs counterclockwise, negative clockwise. `360` or `-360`
  is a full circle starting at `start_angle`.
- `plane`: angle 0 points along `plane.x_dir`, 90 along `plane.y_dir`.

## Returns
An `Edge` with `geom_type == "circle"` (`radius`, `arc_center`, `normal` work).
`CenterArc((0, 0), 10, 0, 90)`: start (10, 0, 0), end (0, 10, 0), tangent at start (0, 1, 0).

| plane | angle 0 | angle 90 |
|---|---|---|
| `Plane.XY` | +X | +Y |
| `Plane.XZ` / `front` | +X | +Z |
| `Plane.YZ` / `right` | +Y | +Z |
| `Plane.back` | -X | +Z |
| `Plane.bottom` | +X | -Y |

## Gotchas
- **`arc_size=0` gives a full circle**, not an error. Check sizes computed at run time.
- `|arc_size| > 360` is clamped to a full circle.
- `edge.normal` follows the direction: +plane normal for a positive `arc_size`, the opposite
  for a negative one.
- A full circle is one closed edge: `make_face(CenterArc(c, r, 0, 360))` and
  `Wire([CenterArc(...)])` both work as outline or hole.
- A full circle as a sweep path is split into two halves automatically:
  `sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))` is one ring of volume 1579.14.
- `point_at(t)` on arcs is exact to rounding (1e-15 mm).
- `mirror()` or `scale()` turn the arc into a `bspline`; `radius` then raises.

## Errors
- `ValueError: radius must be positive` for radius <= 0.

## Example
```python
quarter = CenterArc((0, 0), 10, 0, 90)                  # (10, 0) -> (0, 10), ccw
cw = CenterArc((0, 0), 10, 0, -90)                      # (10, 0) -> (0, -10), cw
bend = CenterArc((0, 0), 20, 0, 90, plane=Plane.XZ)     # (20, 0, 0) -> (0, 0, 20)
tube = sweep(Circle(2), bend)                           # volume pi * 4 * 10 * pi
outline = Polyline((0, 0), (40, 0), (40, 30), (0, 30), close=True)
plate = make_face(outline, CenterArc((20, 15), 6, 0, 360)).extrude(5)
```

## Related
`ThreePointArc`, `RadiusArc`, `SagittaArc`, `TangentArc`, `sketches/Circle`, `generic.md`.
