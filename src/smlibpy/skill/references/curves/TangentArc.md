# TangentArc

A circular arc from `start` to `end` that leaves `start` in a given direction. Used to
continue a chain of edges without a kink.

## Signature
`TangentArc(start, end, tangent)`

- `start`, `end`: world points.
- `tangent`: the direction at `start`; its length does not matter. It need not lie in XY: the
  arc lies in the plane spanned by the tangent and the chord.

## Returns
An `Edge` (`geom_type == "circle"`) whose `tangent_at(0)` equals the normalized `tangent`.
The arc is unique: there is exactly one circle tangent to the direction at `start` that
passes through `end`.
- `TangentArc((0, 0), (10, 0), (0, 1))`: half circle r 5 over +Y.
- `TangentArc((0, 0), (10, 0), (1, 1))`: short arc, r 7.07.
- `TangentArc((0, 0), (10, 0), (-1, 1))`: the tangent points away from `end`, so the arc
  goes the long way round (length 33.3, about 270 degrees).
- A tangent along the chord returns a `Line`.

## Chaining
Pass the end tangent of the previous edge:

```python
l1 = Line((0, 0), (20, 0))
a1 = TangentArc(l1.end, (20, 10), l1.tangent_at(1))
l2 = Line(a1.end, (0, 10))
a2 = TangentArc(l2.end, (0, 0), l2.tangent_at(1))
slot = make_face(Wire([l1, a1, l2, a2]))     # area 200 + 25 * pi, all joints tangent
```

Only the start is tangent. The end direction follows from the geometry; a line after the
arc is tangent only if you put it along `arc.tangent_at(1)`.

## Gotchas
- **A tangent pointing exactly back along the chord** (`TangentArc((0, 0), (10, 0), (-1, 0))`)
  silently returns a `Line` going forward, which ignores the tangent. No arc exists in that
  case; check the input.
- A tangent nearly opposite to the chord gives a huge arc: (-1, 0.01) gives r 500 and length
  3131.

## Errors
- `ValueError: cannot normalize a zero-length vector` for `tangent=(0, 0)`.
- `ValueError: a line needs two distinct points` for start == end.

## Example
```python
up = TangentArc((0, 0), (10, 0), (0, 1))          # half circle, r 5, center (5, 0)
print(up.tangent_at(0), up.radius)                 # (0, 1, 0) 5.0
bend3d = TangentArc((0, 0, 0), (10, 0, 10), (0, 0, 1))   # in XZ, r 10, center (10, 0, 0)
```

## Related
`ThreePointArc`, `RadiusArc`, `Spline` (tangents at both ends), `FilletPolyline`.
