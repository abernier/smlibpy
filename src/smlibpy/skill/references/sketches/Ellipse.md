# Ellipse

A full ellipse on the XY plane, centered on the origin, axes along X and Y (or turned).

## Signature
`Ellipse(x_radius, y_radius, *, rotation=0, align=Align.CENTER)`
Semi-axes (half widths): `x_radius` along X, `y_radius` along Y. Either may be the larger one.
`rotation` turns it about its center (degrees counterclockwise).

## Returns
A `Sketch` with 1 face and 1 edge of type `ellipse` (its vertex at (x_radius, 0, 0)); bbox
`±x_radius` by `±y_radius`; area `pi * x_radius * y_radius`. `Ellipse(10, 10)` still has an
`ellipse` edge, not a `circle`.

## Gotchas
- `Ellipse(15, 8, rotation=30)`: bbox ±13.59 x ±10.21, area 376.9911 (= pi*15*8).
- `offset` of an ellipse goes through the kernel and returns B-spline edges; `fillet` and
  `chamfer` cannot use its corners (there are none on a full ellipse anyway).
- A circle stretched with `Circle(10).scale((2, 1, 1))` has the same area but a B-spline edge.
  Use `Ellipse` when the edge type matters.

## Errors
- `ValueError: Ellipse: the radii must be positive (got 0, 5)`.

## Example
```python
e = Ellipse(15, 8)                    # 30 wide, 16 high
tilted = Ellipse(15, 8, rotation=30)
boss = e.extrude(5)                   # 3 faces, volume pi*15*8*5
```

## Related
`Circle`, `EllipticalArc` (curves, for partial ellipses), `generic`.
