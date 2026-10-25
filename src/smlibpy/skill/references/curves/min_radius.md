# min_radius (curvature of edges)

How tightly an edge bends: the curvature anywhere, the smallest radius of curvature and where it
is, and the inflections. For sweep paths (a profile that reaches farther from the path than its
smallest radius folds over itself), offsets (the same on the inner side), drawings and CAM.

## Signature
`edge.curvature_at(t=0.5) -> float` · `edge.radius_at(t=0.5) -> float`
`edge.min_radius() -> float` · `edge.min_radius_at() -> float` (and the same on `wire`)
`edge.inflections() -> list[float]`

- `t`: a fraction of the length, as `point_at` (0 at `start`, 1 at `end`).
- `curvature_at`: 1 / radius of the circle that fits the edge best there; 0 where straight.
- `radius_at`: that radius; `math.inf` where straight.
- `min_radius`: the smallest radius of curvature, found by the kernel's global solver (not
  sampled): `inf` for a line, an arc's radius. A float, as `face.min_radius()` gives a face's, so
  `min(x.min_radius() for x in [*edges, *faces])` works. `min_radius_at`: where it is, a fraction
  (0 for lines and arcs). For a wire, over its edges, as a fraction of the wire; the corners
  between edges do not count.
- `inflections`: fractions where the edge changes the side it bends to (curvature through zero
  with the bend flipping), in order. Lines, arcs, ellipses and one-way bends: `[]`.

## Returns
- `Spline((0, 0), (10, 5), (20, -3), (30, 4)).min_radius()`: 3.997484, `min_radius_at()` 0.677
  at (20.78, -3.17), as OpenCASCADE; `.inflections()`: `[0.484]` at (14.95, 0.995).
- `EllipticalArc((0, 0), 20, 10, 0, 180)`: min radius 5 (b²/a) at the ends; curvature at the top
  0.025 (b/a²).
- `reversed()` gives the same radius at `1 - t`.
- A `Helix` is a fitted B-spline: its curvature ripples by a few tenths of a percent around
  the exact r/(r² + c²).

## Gotchas
- `edge.curvature_at(t)` takes a fraction of the length and gives one number (an edge bends one
  way at a point); `face.curvature_at(point)` takes a point and gives a `Curvature` with both
  principal curvatures and their directions (`analysis/curvature_at`).
- Sweep errors about the path's curvature now say where it bends most tightly:
  `... the profile may be too large for the path's curvature: the path bends with a radius of
  4.556 at (9.259, 10.77, 10.65) (Edge.min_radius), and the profile reaches 5.59 from the path`.
- `edge.bbox()` of a free curve is exact (ends, corners and where the tangent is perpendicular to
  an axis): `Spline((0, 0), (1, 1), (2, 0), (30, 0)).bbox().max.y` is 1.0069.

## Example
```python
path = Spline((0, 0, 0), (10, 0, 5), (10, 10, 10), (0, 10, 15))
r = path.min_radius()
print(f"tightest bend r {r:.3g} at {path.point_at(path.min_radius_at())}")     # 4.56 at (9.26, 10.8, 10.6)
profile = Circle(min(2, 0.8 * r))                          # fits the bend
s = Spline((0, 0), (10, 5), (20, -3), (30, 4))
print([s.point_at(f) for f in s.inflections()], s.curvature_at(0.5))
```

## Related
`offset`, `features/sweep`, `selection/Edge`.
