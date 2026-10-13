# make_compatible

Copies of curves as B-splines of one degree and one knot vector, with the same shapes: their
control points correspond one to one. Surfaces through curves (a skin, a morph between two
curves) need curves like that; `loft` does this itself, so use `make_compatible` when the
curves go to other code (read them with `nurbs()`).

## Signature
`make_compatible(*edges) -> list[Edge]`

- `edges`: two or more edges, or lists of them.

## Returns
A list of new edges, in the order given: every one a `"bspline"` of the highest degree among
them, with the same knots and the same number of control points; rational (with weights) when
one of them is (an arc). Each lies on its original curve (1e-9).

## Gotchas
- Lines and arcs become B-splines too (arcs exactly, as rational ones).
- The curves take each other's knots: the copies have more control points than the originals
  (a Bezier of 4 points next to a spline of 7: both get 7). `remove_knots()` takes the ones a
  single curve does not need out again.
- The knot vector is shared, not the parameterisation by length: the points at the same
  parameter on two curves are not at the same fraction of their lengths.

## Errors
- `ValueError: make_compatible needs two or more edges, got 1`.
- `TypeError: make_compatible takes edges, not a Wire (pass wire.edges())`.

## Example
```python
a = Bezier((0, 0, 0), (1, 3, 0), (4, 3, 1), (6, 0, 0))
b = Spline((0, 0, 5), (2, 1, 5), (3, -1, 5), (4, 2, 5), (6, 0, 5))
ca, cb = make_compatible(a, b)
print(len(a.nurbs().points), len(b.nurbs().points))    # 4 7
print(len(ca.nurbs().points), len(cb.nurbs().points))  # 7 7
print(ca.nurbs().knots == cb.nurbs().knots)            # True
print(max(a.distance_to(ca.point_at(t)) for t in (0.1, 0.5, 0.9)) < 1e-9)   # True: the same curve

# a curve halfway between the two: average the corresponding control points
mid = [(p + q) * 0.5 for p, q in zip(ca.nurbs().points, cb.nurbs().points)]
print(mid[0], mid[-1])                                 # Vector(0, 0, 2.5) Vector(6, 0, 2.5)
```

## Related
`nurbs`, `remove_knots`, `loft`, `ruled`, `generic`
