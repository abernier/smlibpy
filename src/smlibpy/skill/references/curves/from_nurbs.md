# from_nurbs

An edge from NURBS data: the inverse of `edge.nurbs()`. For control points read from a file or
another program, curves edited by moving control points, and B-splines of many spans (`Bezier`
is one span).

## Signature
`Edge.from_nurbs(nurbs) -> Edge`

- `nurbs`: a `Nurbs` (as `edge.nurbs()` returns), or a tuple `(degree, knots, points, weights)`:
  - `degree`: 1 to 32.
  - `knots`: every knot as often as its multiplicity, `len(points) + degree + 1` numbers, not
    decreasing. Inside the curve a knot may repeat up to `degree` times (a corner there), at the
    ends up to `degree + 1`. The ends need not repeat (an unclamped, uniform B-spline works).
  - `points`: the control points (2D points lie at z = 0).
  - `weights`: one positive weight per point, or `None` for a non-rational curve.

## Returns
A free `Edge` (`geom_type == "bspline"`, also for data of a line or an arc). The curve runs from
`knots[degree]` to `knots[-degree - 1]`: with clamped ends (repeated `degree + 1` times) from the
first to the last control point; otherwise inside the control polygon.

## Example
```python
n = Spline((0, 0), (10, 5), (20, 0), (30, 8)).nurbs()
points = list(n.points)
points[2] = points[2] + Vector(0, 0, 4)               # pull one control point up
bent = Edge.from_nurbs(n._replace(points=points))     # the same ends, bent up in the middle
uniform = Edge.from_nurbs((3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                           [(0, 0), (10, 10), (20, 0), (30, 10), (40, 0), (50, 10)], None))
print(uniform.start)                                  # (10, 6.6667, 0): (P0 + 4 P1 + P2) / 6
quarter = Edge.from_nurbs(Nurbs(2, [0, 0, 0, 1, 1, 1], [Vector(10, 0), Vector(10, 10), Vector(0, 10)],
                                [1, math.sqrt(2) / 2, 1]))   # a quarter circle of radius 10
```

## Errors
`ValueError` with what is wrong: the number of knots (`6 control points of degree 3 take 10
knots ...`), knots that decrease, a knot repeated too often, an empty knot range, the number or
sign of the weights, a degree outside 1 to 32. `TypeError` for something that is not a `Nurbs` or
a 4-tuple.

## Related
`nurbs`, `make_compatible`, `Bezier`, `through` (bend a curve through a point).
