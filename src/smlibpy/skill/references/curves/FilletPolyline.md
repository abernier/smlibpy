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
- Too large: `ValueError: fillet: radius 5.01 at (20, 0) and radius 5.01 at (20, 10) overlap on
  the line (20, 0) -> (20, 10): they need 5.01 + 5.01 of its 10; use smaller corners` (one
  corner: `... does not fit: it needs 20.01 along the line (0, 0) -> (20, 0), which is 20 long;
  ...`). A polyline that is not planar: `ValueError: fillet radius 5 is too large for the edge
  Edge(line, ...)`.

## Gotchas
- In 3D each arc lies in the plane of its corner, so a 3D polyline gives a valid bent pipe
  path: `sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8))`.
  Keep the bend radius larger than the profile's radius (`path.min_radius()` is the smallest
  arc): with radius 2 and `Circle(3)` the sweep warns (`RuntimeWarning: sweep: the corners of
  this planar path cannot be mitered ...`) and returns a body whose inner side folds through
  itself; `is_valid()` passes it, `is_valid(strict=True)` does not.
- Collinear points are left as they are (no arc). A 180° reversal raises `ValueError: fillet:
  radius 2 at (10, 0): the outline turns back on itself there; leave the fillet out` (in 3D
  `ModelingError: fillet: the wire turns back on itself at (10, 0), ...`).
- `radius <= 0` raises `ValueError: fillet: the radius must be positive`.
- Pass points as separate arguments (see `Polyline`).

## Example
```python
path = FilletPolyline((0, 0), (20, 0), (20, 10), (40, 10), radius=3)
frame = make_face(FilletPolyline((0, 0), (20, 0), (20, 10), (0, 10), radius=2, close=True))
print(frame.area)                                      # 196.566371 = 200 - 4 * (4 - pi)
pipe = sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8))
```

## Related
`Polyline`, `Wire.fillet` (selected corners), `sketches/RoundedRectangle`, `features/sweep`.
