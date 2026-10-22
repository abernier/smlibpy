# isocurve, Face.nurbs

The curves of constant parameter of a face (clipped to the face) and the NURBS data of its
surface.

## Signature

- `face.isocurve(u=None, v=None) -> ShapeList[Edge]`: give one; it is a fraction 0 to 1 of the
  face's parameter box (as `uv_at` and `position_at` take them).
- `face.nurbs() -> NurbsSurface`: `degrees` `(u, v)`, `knots` `(u_knots, v_knots)`, `points`
  (rows by u: `points[i][j]`), `weights` (the same rows, or `None`).

## Details

- An iso curve is the kernel's own curve of the surface (exact: a line along a cylinder, a
  circle around it, a B-spline of a B-spline surface), cut where the face's boundary crosses it
  (found in the parameter plane, to 1e-12): a plate with a hole in the way gives two edges.
- `nurbs()` is the whole surface, untrimmed, exact for every kind: planes bilinear, cylinders,
  cones, spheres and tori rational of degree 2. Its parameters are the face's (`face.uv_at`
  scaled to the face's box).

## Gotchas

- `ValueError` with both or neither of `u` and `v`, or outside 0 to 1.
- The parameter box of a trimmed face is the box of its boundary, not the surface's: on a plate
  cut from a larger plane, `u = 0.5` runs through the middle of the plate.

## Example

```python
plate = (Box(40, 30, 5) - Cylinder(5, 10)).faces().top()[0]
print(plate.isocurve(u=0.5))           # two lines, from the plate's edge to the hole
side = Cylinder(5, 20).faces().cylinders()[0]
print(side.isocurve(v=0.5)[0].geom_type, round(side.isocurve(v=0.5)[0].length, 6))   # circle 31.415927
n = side.nurbs()
print(n.degrees, len(n.points), len(n.points[0]))   # (2, 1) 9 2
```

## Related

`curves/nurbs` (`Edge.nurbs`), `closest_points` (`uv_at`, `position_at`), `curvature_at`
