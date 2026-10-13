# remove_knots

The same curve with the knots it does not need taken out: a B-spline with fewer control points.
For curves from imports or from `make_compatible` that carry more knots than their shape needs.

## Signature
`edge.remove_knots() -> Edge`

## Returns
A new edge. The kernel's knot removal keeps the curve within about 1e-6 of where it was (a
fixed tolerance). Lines, arcs and other analytic curves come back as they are.

## Gotchas
- Only knots that the shape does not need go: a spline through points on a cubic keeps all its
  knots, a spline through points on a straight line drops to 4 control points (still degree 3).
- The degree stays.

## Example
```python
straight = Spline(*[(x, 2 * x, 0) for x in range(12)])   # a straight spline through 12 points
print(len(straight.nurbs().points), len(straight.remove_knots().nurbs().points))   # 14 4

a = Bezier((0, 0, 0), (1, 3, 0), (4, 3, 1), (6, 0, 0))
b = Spline((0, 0, 5), (2, 1, 5), (3, -1, 5), (4, 2, 5), (6, 0, 5))
ca, _ = make_compatible(a, b)                            # a's copy took b's knots: 7 points
print(len(ca.remove_knots().nurbs().points))             # 4: the Bezier again
print(CenterArc((0, 0, 0), 5, 0, 180).remove_knots().geom_type)   # circle
```

## Related
`nurbs`, `make_compatible`, `Spline`, `generic`
