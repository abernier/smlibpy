# EllipticalArc

An ellipse, or a counterclockwise arc of one.

## Signature
`EllipticalArc(center, x_radius, y_radius, start_angle=0.0, end_angle=360.0, plane=Plane.XY)`

- `center`: in plane coordinates, like `CenterArc`.
- `x_radius`, `y_radius`: semi-axes along the plane's X and Y axes, > 0. Either may be the
  larger one.
- `start_angle`, `end_angle`: degrees, **parametric**: the point at angle a is
  `(x_radius·cos a, y_radius·sin a)`. 45 degrees on a 20 x 10 ellipse is (14.14, 7.07), not
  the point on the 45 degree ray.
- The arc always runs counterclockwise from `start_angle` to `end_angle`; `end < start`
  wraps around (90 -> 0 is the 270 degree arc).

## Returns
An `Edge` with `geom_type == "ellipse"` (also when the radii are equal; `radius` raises).
Default: the full ellipse, closed, starting at (center + x_radius, 0).
`EllipticalArc((0, 0), 20, 10, 0, 90)`: (20, 0) -> (0, 10).

## Gotchas
- **Arcs that pass through angle 0 fail**: `EllipticalArc(c, 20, 10, -90, 90)`, `350, 10`,
  `270, 450` raise `KernelError: EllipticalArc failed (SM_ERR)`. Arcs that only end at 0
  work (`270, 360`). Workarounds: build two pieces,
  `Wire([EllipticalArc(c, rx, ry, 270, 360), EllipticalArc(c, rx, ry, 0, 90)])`, or draw the
  arc on the other side and turn it: `EllipticalArc(c, rx, ry, 90, 270).rotate(Z, 180)`.
- **An ellipse cannot be a sweep path**: `sweep(profile, EllipticalArc(...))` raises
  `TypeError: curve_sweep(): incompatible function arguments`. Converting it to an exact
  B-spline works: `e.mirror(Plane.XZ).mirror(Plane.XZ)` (deviation ~1e-12), then sweep.
- `start_angle == end_angle` (or a 360 span starting elsewhere) gives the full ellipse
  starting at angle 0; the start angle is ignored.
- No clockwise variant; use `.reversed()`.
- As an outline it is fine: `make_face(EllipticalArc((0, 0), 20, 10))` has area 628.3186
  (π·200), and loft sections and open-curve extrusions work.

## Errors
- `KernelError: EllipticalArc failed (SM_ERR_INVALID_INPUT)` for a zero or negative radius.
- `KernelError: EllipticalArc failed (SM_ERR)` for arcs across angle 0 (above).

## Example
```python
oval = make_face(EllipticalArc((0, 0), 20, 10))               # area 628.3186
quarter = EllipticalArc((0, 0), 20, 10, 0, 90)                # (20, 0) -> (0, 10)
upright = EllipticalArc((0, 0), 20, 10, 0, 90, plane=Plane.XZ)   # (20, 0, 0) -> (0, 0, 10)
right_half = Wire([EllipticalArc((0, 0), 20, 10, 270, 360), EllipticalArc((0, 0), 20, 10, 0, 90)])
half = Wire([EllipticalArc((0, 0), 20, 10, 0, 180), Line((-20, 0), (20, 0))])   # area 100 * pi
```

## Related
`sketches/Ellipse` (the region directly), `CenterArc`, `Spline`.
