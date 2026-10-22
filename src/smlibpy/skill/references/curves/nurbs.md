# nurbs

An edge as a NURBS curve: its degree, knots, control points and weights. To see what a curve is
made of, to compare curves, and to hand them to code outside smlibpy.

## Signature
`edge.nurbs() -> Nurbs`

## Returns
A `Nurbs` named tuple, of the edge from its `start` to its `end` (a reversed edge: reversed):

| Field | Meaning |
|---|---|
| `degree` | the degree |
| `knots` | the knot vector, every knot as often as its multiplicity: `len(points) + degree + 1` numbers |
| `points` | the control points (`Vector`s) |
| `weights` | one weight per control point, `None` for a non-rational curve |

Exact for lines (degree 1, two points), arcs (rational, degree 2) and B-splines. Other curves
are approximated within 1e-7. The knots are the curve's own parameters (an arc of a full
circle may run from 0 to 0.5): only their ratios matter.

## Example
```python
n = Bezier((0, 0, 0), (1, 3, 0), (4, 3, 1), (6, 0, 0)).nurbs()
print(n.degree, n.knots, n.weights)          # 3 [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0] None
arc = CenterArc((0, 0, 0), 3, 0, 90).nurbs() # an exact rational quadratic
print(arc.degree, arc.points[0], arc.points[-1], [round(w, 4) for w in arc.weights])
# 2 Vector(3, 0, 0) Vector(0, 3, 0) [1.0, 0.7071, 1.0]
edge = Box(10, 10, 10).edges()[0]
print(edge.nurbs().points == [edge.start, edge.end])   # True
```

## Related
`from_nurbs` (the edge of such data), `make_compatible`, `remove_knots`, `Spline`, `Bezier`, `generic`
