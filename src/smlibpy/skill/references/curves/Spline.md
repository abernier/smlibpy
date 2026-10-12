# Spline

A smooth cubic curve exactly through the given points.

## Signature
`Spline(*points, tangents=None, closed=False)`

- `points`: two or more distinct points, as separate arguments (2-tuples or 3-tuples, world
  coordinates). 3D works.
- `tangents`: `(start_tangent, end_tangent)`, a tuple of two; either may be `None`. Only the
  direction counts; the length of the vectors is ignored.
- `closed=True`: closes the curve back to the first point, tangent-continuous at the join.
  Do not repeat the first point (repeating it is harmless).

## Returns
An `Edge` with `geom_type == "bspline"` that passes through every point (deviation ~1e-14).
Without `tangents`, each end tangent comes from the parabola through the three end points.
`Spline(a, b)` with two points and no tangents returns a `Line`.

## Gotchas
- **No `periodic` option.** `closed=True` matches position and tangent at the join, not
  curvature exactly. Fine for outlines and sweeps; not class-A.
- `closed=True` with two different tangents makes a kink at the join without an error.
- Repeating the first point without `closed=True` closes the curve with a kink.
- **Pass points as separate arguments.** `Spline([p1, p2, p3])` (one list of 2 or 3 points)
  raises TypeError; use `Spline(*pts)`.
- Uneven spacing can overshoot between points. Add points where the shape matters.
- `edge.bbox()` of a spline samples 33 points and can be too small: for
  `Spline((0, 0), (1, 1), (2, 0), (30, 0))` it reports max y 0.80 although the curve passes
  through (1, 1). Sample `point_at` densely when you need extents.
- To continue another edge smoothly, pass its end tangent:
  `tangents=(line.tangent_at(1), None)`.
- A closed spline as a **sweep path** returns a body with volume 0 (`is_valid()` True). Split
  it into two open splines with matching end tangents and sweep along `Wire([a, b])`:
  `Spline((20, 0), (0, 20), (-20, 0), tangents=((0, 1), (0, -1)))` plus
  `Spline((-20, 0), (0, -20), (20, 0), tangents=((0, -1), (0, 1)))` gives a valid ring.

## Errors
- `ValueError: a spline needs at least two points`.
- `ValueError: spline points must be distinct` for consecutive duplicates.
- `ValueError: cannot normalize a zero-length vector` for a zero tangent, or two points with
  `closed=True`.
- `IndexError` for `tangents=((1, 0),)`: always pass a pair.

## Example
```python
s = Spline((0, 0), (10, 5), (20, -5), (30, 0))
flat = Spline((0, 0), (10, 5), (20, -5), (30, 0), tangents=((1, 0), (1, 0)))
blob = make_face(Spline((0, 0), (20, -5), (35, 5), (25, 20), (5, 15), closed=True)).extrude(4)
tube = sweep(Circle(2), Spline((0, 0, 0), (0, 10, 20), (30, 10, 40)))
# a spline top tangent to two vertical sides
top = Spline((40, 10), (25, 20), (10, 15), (0, 10), tangents=((0, 1), (0, -1)))
cam = make_face(Wire([Line((0, 0), (40, 0)), Line((40, 0), (40, 10)), top, Line((0, 10), (0, 0))])).extrude(6)
```

## Related
`Bezier` (control points instead of through points), `TangentArc`, `features/sweep`,
`features/loft`.
