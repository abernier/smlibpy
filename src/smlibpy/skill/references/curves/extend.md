# extend

Make an edge longer at one end or both, for cut tools and sweep paths that must run past a body
(a groove that runs out cleanly) and for curves that must reach another curve.

## Signature
`edge.extend(distance, *, end="end", continuity="G1") -> Edge`, or the function
`extend(edge, distance, *, end="end", continuity="G1")` (which also extends sheets and faces:
`surfaces/extend`).

- `distance`: the length added at each end asked for, > 0 (shorten with `trim`).
- `end`: `"end"`, `"start"` or `"both"`.
- `continuity` (curves other than lines and arcs): `"G1"` straight on along the end tangent,
  `"G2"` keeping the curvature at the end, `"natural"` the curve's own polynomial continued.

## Returns
A new free edge. Lines stay lines, arcs stay arcs of the same circle (`geom_type == "circle"`,
same radius and center), elliptical arcs stay arcs of the same ellipse. Other curves become a
B-spline that is the original curve up to its end and the extension after it. The added length
is `distance` exactly (to about 1e-9) for every kind and continuity.

## Gotchas
- `"G2"` with a large distance curls: the extension keeps turning with the end curvature
  (a three-point spline extended by 30 bends back towards its start). Use `"G1"` for run-outs.
- A closed edge has no ends: `ValueError: extend: a closed edge has no ends to extend`.
- An arc that would reach around its whole circle or ellipse raises `ValueError`.

## Example
```python
Line((0, 0), (10, 0)).extend(2, end="both")           # (-2, 0) -> (12, 0)
arc = CenterArc((0, 0), 10, 0, 90).extend(7.853982)   # to 135 degrees, radius 10
s = Spline((0, 0), (20, 8), (40, 0))
runout = s.extend(5, end="both")                      # straight on, s.length + 10
groove = Box(60, 20, 10) - sweep(Circle(2), runout.translate(-20, 0, 5))
```

## Related
`split`, `to_edge`, `features/sweep`.
