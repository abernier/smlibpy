# ConicArc

A conic arc set by its ends, the point where its end tangents meet, and one number: the rho
conic of styling, for corner blends and transitions whose fullness you tune.

## Signature
`ConicArc(start, apex, end, rho=0.5)`

- `start`, `end`: the ends of the arc (2D or 3D points).
- `apex`: where the tangents at the ends meet; the arc leaves `start` toward it and arrives at
  `end` from it. Must not lie on the line through `start` and `end`.
- `rho`: 0 < rho < 1, how far the arc reaches toward the apex: it passes `rho` of the way from
  the middle of the chord to the apex. 0.5 is a parabola, less an ellipse (flatter), more a
  hyperbola (fuller). `sqrt(2) - 1` (0.4142) with a right angle at the apex and equal legs is a
  circular arc.

## Returns
An `Edge` (`geom_type == "bspline"`): one rational quadratic Bezier (weights `1, rho/(1-rho), 1`),
exact. In the plane of the three points.

## Example
```python
corner = ConicArc((10, 0), (10, 10), (0, 10), math.sqrt(2) - 1)   # the quarter circle of radius 10
print(corner.point_at(0.5).length)                               # 10.0
soft = ConicArc((0, 0), (10, 0), (10, 10), 0.3)                  # flatter than a parabola
full = ConicArc((0, 0), (10, 0), (10, 10), 0.8)                  # close to the apex
```

## Errors
- `ValueError: ConicArc: rho is between 0 and 1 (0.5: a parabola), got 1`.
- `ValueError: ConicArc: start, apex and end must not lie on one line`.

## Related
`Bezier` (any weights), `ParabolicArc`, `HyperbolicArc`, `TangentArc`.
