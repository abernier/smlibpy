# Ellipse

A full ellipse on the XY plane, centered on the origin, axes along X and Y.

## Signature
`Ellipse(x_radius, y_radius, *, align=Align.CENTER)`
Semi-axes (half widths): `x_radius` along X, `y_radius` along Y. Either may be the larger one.
There is no rotation parameter.

## Returns
A `Sketch` with 1 face and 1 edge of type `ellipse` (its vertex at (x_radius, 0, 0)); bbox
`±x_radius` by `±y_radius`; area `pi * x_radius * y_radius`. `Ellipse(10, 10)` still has an
`ellipse` edge, not a `circle`.

## Gotchas
- Turn it with `Ellipse(15, 8).rotate(Z, 30)`; the bbox of the result is exact (±13.59 x ±10.21).
- A circle stretched with `Circle(10).scale((2, 1, 1))` has the same area but a B-spline edge.
  Use `Ellipse` when the edge type matters.

## Errors
- `KernelError: Ellipse failed (SM_ERR_INVALID_INPUT)`: a radius is zero or negative (a
  `KernelError`, not a `ValueError`).

## Example
```python
e = Ellipse(15, 8)                    # 30 wide, 16 high
tilted = Ellipse(15, 8).rotate(Z, 30)
boss = e.extrude(5)                   # 3 faces, volume pi*15*8*5
```

## Related
`Circle`, `EllipticalArc` (curves, for partial ellipses), `generic`.
