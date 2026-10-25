# to_edge

A wire as one edge: its curves joined into one B-spline curve.

## Signature
`wire.to_edge() -> Edge`

## Returns
One free `bspline` edge with the wire's start, end, length and points (the curves are joined,
not approximated; an ellipse piece is approximated to 1e-7). Where edges meet tangentially the
edge is smooth there; where they meet at a corner, it keeps the corner. A wire of one edge
returns that edge.

One edge makes a single sweep or loft rail (no joints for `sweep` to handle), a single SPLINE
in DXF and a single curve for `make_compatible`.

## Errors
- `ValueError: to_edge: the edges do not meet: a gap of 0.1 at (1, 0, 0); join only edges that
  run end to end (Wire sorts them)`, for gaps above 1e-6.

## Example
```python
rail = FilletPolyline((0, 0), (30, 0), (30, 20), radius=5).to_edge()   # one bspline edge
print(rail.geom_type, rail.start, rail.end)    # bspline (0, 0, 0) (30, 20, 0)
pipe = sweep(Circle(1), FilletPolyline((0, 0, 0), (30, 0, 0), (30, 20, 10), radius=5).to_edge())
```

## Related
`Wire.md`, `split`, `extend`, `features/sweep`, `make_compatible`.
