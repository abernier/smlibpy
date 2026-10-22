# intersections

Where an edge or a wire meets another shape: an edge, a wire, a face, a body (its faces) or a
list of them. A query: nothing changes.

## Signature
- `edge.intersections(other, *, tolerance=None) -> list[Vector]`, in order along the edge.
- `edge.intersection_params(other, *, tolerance=None) -> list[float]`: the same points as
  fractions of the edge's length, ready for `split`, `trim` and `point_at`.
- `wire.intersections(other, *, tolerance=None) -> list[Vector]`, in order along the wire.
- `edge.self_intersections(*, tolerance=None) -> list[Vector]`: where the edge crosses itself.

## Returns
- No point is an empty list (never an error).
- Crossings and touching points. Where two curves run along each other, the two ends of the
  overlap (`Line((0, 0), (10, 0))` with `Line((5, 0), (15, 0))`: (5, 0) and (10, 0)). Where an
  edge lies on a face, the points where it starts and stops lying on the face; a line across the
  top of a plate with a hole gives the plate's sides and the hole's rim.
- Points within `tolerance` of the other shape count; points closer than that to each other count
  once (the start of a circle, a vertex shared by two faces or two edges of a wire). The default
  is 1e-6, or 1e-9 of the size of the two shapes where that is larger: lines that miss each other
  by 0.0005 do not cross, also on a 0.01 mm part. Pass `tolerance=` for imported curves with
  gaps.

## Gotchas
- `e.intersections(e)` raises `ValueError`: an edge lies on itself everywhere. Use
  `e.self_intersections()`.
- For a ray against a body with the hit faces and normals, use `raycast`; for the curves where
  two bodies meet, `intersection_curves`.

## Example
```python
Line((0, 0), (10, 10)).intersections(Line((0, 10), (10, 0)))     # [(5, 5, 0)]
Line((0, 0), (10, 0)).intersections(Line((0, 5), (10, 5)))       # []
z = Line((0, 0, -20), (0, 0, 20))
z.intersections(Box(10, 10, 10))                                  # [(0, 0, -5), (0, 0, 5)]
z.intersection_params(Box(10, 10, 10))                            # [0.375, 0.625]
Polyline((0, -5), (10, 5), (20, -5)).intersections(Line((-5, 0), (25, 0)))   # (5, 0), (15, 0)
Spline((0, 0), (10, 10), (10, 0), (0, 10)).self_intersections()  # [(3.570, 5, 0)]
```

## Related
`split`, `analysis/raycast`, `analysis/intersection_curves`, `selection/Edge`.
