# through

Bend an edge so that it passes through a point, optionally in a given direction there, keeping
its ends and its directions at the ends. "Make this spline pass here" for paths, rails and
outlines.

## Signature
`edge.through(point, *, tangent=None, at=None) -> Edge`

- `point`: the point the edge must pass through (a point or a `Vertex`).
- `tangent`: the direction the edge runs in at that point (its length does not count).
- `at`: where along the edge the point goes, a fraction strictly between 0 and 1. Default:
  where the edge comes closest to the point.

## Returns
A new free `Edge` (`geom_type == "bspline"`, degree 3 at least; an arc stays rational) that
passes through the point exactly (and has the tangent's direction there), with the same start,
end and end tangents. The change is the smallest move of the control points that does it, and it
is local: only the few control points near `at` move (knots are inserted there first when the
edge has too few), so a point far from the edge makes a bump.

## Gotchas
- The ends stay: a point nearest to an end raises; pass `at=` to choose where it goes.
- Several points: call it again for each (each keeps what the others did only where their
  regions do not overlap); a curve through many points from the start is `Spline`.
- A tangent against the edge's direction makes a loop.

## Example
```python
path = Spline((0, 0), (20, 10), (40, 0))
higher = path.through((20, 15))                       # passes (20, 15); ends and end directions kept
level = path.through((20, 15), tangent=(1, 0))        # and runs along X there
bump = Line((0, 0), (10, 0)).through((5, 2))          # a cubic B-spline through (5, 2)
print(higher.distance_to((20, 15)) < 1e-12, higher.start, higher.end)   # True (0, 0, 0) (40, 0, 0)
```

## Errors
- `ValueError: through: the point is nearest to an end of the edge, and the ends stay; pass at= ...`.
- `ValueError: through: at is a fraction of the edge strictly between 0 and 1 ...`.
- `ValueError: through: the tangent must be a direction (not zero)`.

## Related
`match` (move the ends), `from_nurbs` (edit control points yourself), `Spline`.
