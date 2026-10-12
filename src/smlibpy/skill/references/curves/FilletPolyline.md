# FilletPolyline

A polyline whose corners are rounded with tangent arcs of one radius, as a `Wire`.

## Signature
`FilletPolyline(*points, radius, close=False)`

- `points`: two or more points, as separate arguments; 2D or 3D.
- `radius`: keyword-only, mm, > 0.
- `close=True`: closes the polyline and rounds the corner at the first point too.

Same as `Polyline(*points, close=close).fillet(radius)`.

## Returns
A `Wire` of lines and arcs (`geom_type == "circle"`), tangent at every joint. An open wire
keeps its first and last point; every inner corner gets an arc.
`FilletPolyline((0, 0), (20, 0), (20, 10), (40, 10), radius=3)`: 5 edges, arcs centered at
(17, 3) and (23, 7).

## Radius limits
The arc at a corner of angle φ between the segments cuts `r · tan(φ / 2)` off each
neighbouring segment (r for a 90° corner).
- An inner segment carries two setbacks: a 10 mm segment between two 90° corners allows
  r ≤ 5. At r = 5 the segment vanishes and the two arcs meet.
- The first and last segments carry one: a 20 mm end segment allows r ≤ 20 at a 90° corner.
- Sharp (acute) corners need long setbacks: at 14° r = 1 already takes 8.1 mm.
- Too large: `ValueError: fillet radius 5.01 is too large for the edge Edge(line, ...)`.

## Gotchas
- In 3D each arc lies in the plane of its corner, so a 3D polyline gives a valid bent pipe
  path: `sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8))`.
  The bend radius must be larger than the profile radius: radius 2 with `Circle(3)` raises
  `KernelError: sweep failed (SM_ERR): the profile may be too large for the path's corners`.
- Collinear points and a 180° reversal are left as they are (no arc).
- `radius=0` raises `cannot normalize a zero-length vector`; a negative radius returns a
  broken wire without an error.
- Pass points as separate arguments (see `Polyline`).

## Example
```python
path = FilletPolyline((0, 0), (20, 0), (20, 10), (40, 10), radius=3)
frame = make_face(FilletPolyline((0, 0), (20, 0), (20, 10), (0, 10), radius=2, close=True))
print(frame.area)                                      # 200 - 4 * (4 - pi) = 196.566371
pipe = sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8))
```

## Related
`Polyline`, `Wire.fillet` (selected corners), `sketches/RoundedRectangle`, `features/sweep`.
