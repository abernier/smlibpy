# ParabolicArc

A piece of a parabola, exact: reflectors, horns, nozzle and spillway contours.

## Signature
`ParabolicArc(vertex, focal_length, start, end, plane=Plane.XY)`

- `vertex`: the parabola's vertex, in plane coordinates (as `CenterArc`'s center).
- `focal_length`: the distance from the vertex to the focus. The parabola is
  `y = x² / (4 · focal_length)` and opens along the plane's +Y; a negative focal length opens it
  along -Y.
- `start`, `end`: where the piece starts and ends, as x (along the plane's X axis, measured from
  the vertex). `start > end` runs the other way.

## Returns
An `Edge` (`geom_type == "bspline"`): a quadratic Bezier, the parabola exactly (deviation from
`y = x²/(4f)` about 1e-15). It runs from `(start, start²/4f)` to `(end, end²/4f)`.

## Example
```python
dish = ParabolicArc((0, 0), 25, 0, 40)                # y = x^2/100, x 0..40; the focus at (0, 25)
reflector = revolve(make_face(dish + Line(dish.end, (0, 16)) + Line((0, 16), (0, 0))), Axis.Y)
print(dish.start, dish.end)                           # (0, 0, 0) (40, 16, 0)
side = ParabolicArc((0, 0), 10, -20, 20, Plane.XZ)    # in the XZ plane, opening along Z
```

## Errors
- `ValueError: ParabolicArc: the focal length must not be zero`.
- `ValueError: ParabolicArc: start and end must differ`.

## Related
`HyperbolicArc`, `ConicArc`, `EllipticalArc`, `Bezier`.
