# HyperbolicArc

A piece of a hyperbola, exact: cooling towers and waisted shafts (revolved about Y), hyperbolic
mirrors (about X).

## Signature
`HyperbolicArc(center, x_radius, y_radius, start, end, plane=Plane.XY)`

- `center`: the center of the hyperbola, in plane coordinates.
- `x_radius`, `y_radius`: the hyperbola `x²/x_radius² - y²/y_radius² = 1`; its vertex lies at
  `(x_radius, 0)` from the center, its asymptotes have the slopes `±y_radius / x_radius`. Both > 0.
- `start`, `end`: where the piece starts and ends, as y (along the plane's Y axis, from the
  center). The branch on the +X side.

## Returns
An `Edge` (`geom_type == "bspline"`): one rational quadratic (weight `cosh` of half the
hyperbolic angle it spans), the hyperbola exactly (about 1e-15).

## Example
```python
waist = HyperbolicArc((0, 0), 10, 20, -30, 30)       # radius 10 at y = 0, 18.03 at y = +-30
print(waist.start, waist.point_at(0.5), waist.end)    # (18.03, -30, 0) (10, 0, 0) (18.03, 30, 0)
tower = revolve(make_face(waist + Line(waist.end, (0, 30)) + Line((0, 30), (0, -30))
                          + Line((0, -30), waist.start)), Axis.Y)
```

## Errors
- `ValueError: HyperbolicArc: x_radius and y_radius must be positive`.
- `ValueError: HyperbolicArc: start and end must differ`.

## Related
`ParabolicArc`, `ConicArc`, `EllipticalArc`.
