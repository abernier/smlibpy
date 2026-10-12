# Bezier

A Bézier curve from its control points; rational when weights are given.

## Signature
`Bezier(*control_points, weights=None)`

- `control_points`: 2 to 18 points, as separate arguments. The degree is
  `len(control_points) - 1` (max 17).
- `weights`: one positive number per control point. A weight > 1 pulls the curve towards its
  control point, < 1 pushes it away.

## Returns
An `Edge` (`geom_type == "bspline"`) from the first to the last control point. The inner
control points are **not** on the curve: `Bezier((0, 0), (10, 20), (20, 0))` peaks at
(10, 10). The tangent at each end points at the neighbouring control point.

## Gotchas
- Use `Spline` when the curve must pass through points; use `Bezier` when you think in
  control polygons (fairings, cam lobes, blends).
- A rational quadratic with weights `[1, cos(θ/2), 1]` is an exact circular arc of angle θ:
  `Bezier((10, 0), (10, 10), (0, 10), weights=[1, math.sqrt(2) / 2, 1])` is a quarter circle of
  radius 10 (deviation ~1e-15). It still reports `geom_type == "bspline"`, so `radius`
  raises; use `CenterArc` when you need a real circle edge.
- Coincident control points are accepted and can give a zero-length edge
  (`Bezier((0, 0), (0, 0))`). Check `length`.
- `point_at(t)` is by arc length, not the Bézier parameter.
- Two control points give a straight `bspline`, not a `line` (`geom_type`); `direction` and
  `lines()` treat it as straight. Use `Line` for a real line edge.

## Errors
- `ValueError: a Bézier curve needs at least two control points`.
- `KernelError: Bezier failed (SM_ERR)` for 19 or more control points, or a weight <= 0.
- `KernelError: Bezier failed (SM_ERR_INVALID_INPUT)` when the number of weights differs
  from the number of control points.

## Example
```python
arch = Bezier((0, 0), (10, 20), (20, 0))                 # peak (10, 10)
s_curve = Bezier((0, 0), (0, 10), (20, 10), (20, 0))     # max y 7.5
quarter = Bezier((10, 0), (10, 10), (0, 10), weights=[1, math.sqrt(2) / 2, 1])
print(arch.point_at(0.5), round(quarter.length, 9))      # (10, 10, 0) 15.707963268
```

## Related
`Spline`, `ThreePointArc`, `CenterArc`.
