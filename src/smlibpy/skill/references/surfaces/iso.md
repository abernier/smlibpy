# iso, Face.nurbs

The curves of a face along which one of its surface parameters is constant: styling and
inspection lines, rails and section lines on freeform faces, the circles and lines of a turned
face. And the NURBS data of a face's surface.

## Signature
`face.iso(*, u=None, v=None) -> ShapeList[Edge]`

- `u` or `v` (one of them, by name): the parameter held constant, as a fraction 0 to 1 of the
  face's range of that parameter (as `uv_at` and `position_at` take them). `iso(u=0.5)` runs along
  v through the middle of the u range. smlibwasm: `face.iso({ v: 0.5 })`.

`face.nurbs() -> NurbsSurface`: `degrees` `(u, v)`, `knots` `(u_knots, v_knots)`, `points` (rows by
u: `points[i][j]`), `weights` (the same rows, or `None`): the whole surface, untrimmed, exact for
every kind (planes bilinear; cylinders, cones, spheres and tori rational of degree 2), in the face's
parameters. `Shell.from_nurbs(n)` (or `nurbs_surface(n)`) makes a sheet of it again.

## Returns
Free edges on the face, trimmed to it: several pieces where the face has holes or notches, none
where the parameter line misses the face. Within 1e-7 of the face's size (exact for planes,
cylinders and B-spline surfaces).

An iso curve is the kernel's own curve of the surface (a line along a cylinder, a circle around
it, a B-spline of a B-spline surface), cut where the face's boundary crosses it (found in the
parameter plane, to 1e-12). The parameter box of a trimmed face is the box of its boundary, not
the surface's: on a plate cut from a larger plane, `u = 0.5` runs through the middle of the plate.

Which parameter runs which way depends on the surface:
- cylinder side: `v` constant gives the circle at that height (`iso(v=0.5)`: half way up);
  `u` constant a line along the axis.
- sphere: `v` constant a circle of latitude, `u` constant a half meridian.
- plane: lines across the face, parallel to its sides as the plane is parametrized.
Print `e.start`, `e.end` to see.

## Example
```python
side = Cylinder(10, 40).faces().cylinders()[0]
ring = side.iso(v=0.5)[0]                           # the circle at z = 0, length 62.832
line = side.iso(u=0.25)[0]                          # a line along the axis, length 40
plate = Box(40, 40, 10) - Cylinder(5, 20)
top = plate.faces().sort_by(Z)[-1]
print(len(top.iso(u=0.5)))                          # 2: cut by the hole
n = side.nurbs()
print(n.degrees, len(n.points), len(n.points[0]))   # (2, 1) 9 2
```

## Errors
- `ValueError: iso: give u or v (exactly one of u and v)`; `TypeError` for a fraction given
  without its name (`iso(0.5)`).
- `ValueError: iso: v is a fraction of the face's range, from 0 to 1 (got 1.5)`.

## Related
`curves/nurbs` (`Edge.nurbs`), `nurbs_surface`, `wrap`, `analysis/project`, `closest_points` (`uv_at`,
`position_at`), `curvature_at`, `selection/Face`.
