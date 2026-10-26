# match

Move the ends of an edge to new points and set its directions there, bending the rest smoothly:
closing gaps, snapping a curve onto a point of another curve, making it leave or arrive
tangentially (G1).

## Signature
`edge.match(*, start=None, end=None, start_tangent=None, end_tangent=None) -> Edge`

- `start`, `end`: the new start and end points (points or `Vertex`es).
- `start_tangent`, `end_tangent`: the directions the edge leaves its start and arrives at its
  end (lengths do not count).
- Each is optional; what is not given stays as it was. At least one is needed.

## Returns
A new free `Edge` (`geom_type == "bspline"`, cubic at least; lines and arcs become B-splines)
whose ends lie on their targets exactly and point in the directions given. The kernel's end
deformation (`SmCurve::DeformToEndPointTargets`): the parts near the ends (15 % of the curve each)
move as a whole, the middle blends, so the shape is kept.

## Example
```python
s = Spline((0, 0, 0), (10, 8, 0), (25, 5, 0), (40, 12, 0), (52, 10, 0), (60, 0, 0))
other = Spline((52, 10, 4), (60, 20, 4), (70, 20, 0))
joined = s.match(end=other.start, end_tangent=other.tangent_at(0))   # meets `other` tangentially
path = Wire([joined, other])                                         # one smooth sweep path
moved = Line((0, 0), (10, 0)).match(start=(0, 1), start_tangent=(1, 1))
```

## Gotchas
- Large moves bend the ends' 15 % strongly; for a new curve between two points use `Spline` with
  `tangents=`.

## Errors
- `ValueError: match: give start, end, start_tangent or end_tangent`.
- `ValueError: match: start_tangent must be a direction (not zero)`.

## Related
`through`, `extend`, `to_edge`, `Spline`.
