# curvature_at, min_radius, major_radius, cone_angle

The curvature of a face at a point (both principal curvatures and their directions), the
smallest radius of curvature of a face, the curvature of an edge, and the radii and angles of
analytic faces that `radius` does not give.

## Signature

- `face.curvature_at(point=None) -> Curvature`: at the face's point nearest to `point`; without
  one at a point inside the face (`interior_point()`).
- `face.min_radius() -> float`: `1 / max(|k1|, |k2|)` over the face; `inf` for a plane.
- `edge.curvature_at(t=0.5) -> float`: 1 / the radius of curvature at fraction `t` of the length.
- `face.major_radius`: a torus' radius from its axis to the middle of its tube (`radius` is the
  tube's). `face.cone_angle`: half a cone's opening angle in degrees.

## Returns

`Curvature`, a named tuple: `k1 >= k2` (1/mm), `dir1`, `dir2` (their unit directions, tangent
to the face, square to each other), `normal` (outward), `point`; properties `mean` and
`gaussian`.

## Signs

Curvatures follow the outward normal: positive where the face bends away from it (a ball, a
boss: convex), negative where it bends towards it (a bore, a fillet in an inside corner):

| Face | `k1` | `k2` |
|---|---|---|
| sphere r | 1/r | 1/r |
| cylinder r (boss) | 1/r (around) | 0 (along) |
| hole r | 0 | -1/r |
| torus R, r at the outer equator | 1/r | 1/(R + r) |
| torus at the inner equator | 1/r | -1/(R - r) |
| plane | 0 | 0 |

## Accuracy

From the exact surface's first and second fundamental forms, to 1e-12 on analytic faces, also at
a sphere's pole. `min_radius()` is exact for planes, cylinders and spheres; for other faces it
samples a 24 x 24 grid of the face's parameters (points on the face only) and refines the four
sharpest by a pattern search that stays on the face: a torus R6 r5 gives 1 (its inner equator,
R - r) to 1e-9, a cone its small end to 1e-9. Points within 1e-2 of a pole (by the ratio of
the surface's tangents) are left out there.

## Gotchas
- `edge.curvature_at(t)` is another thing: a fraction of the edge's length in, one number out
  (`curves/min_radius`). Both `min_radius()` give a float.

- `min_radius()` of a cone whose face reaches the apex is small but not 0 (the apex is a pole).
- `radius` of a torus is the tube's (minor) radius; `major_radius` raises `ValueError` on
  anything but a torus, `cone_angle` on anything but a cone.
- For an inward `thicken` or `offset` of a sheet, the wall must stay below `min_radius()` of
  the concave faces (`k2 < 0` towards the side the material grows to).

## Example

```python
ball = Sphere(10).faces()[0]
c = ball.curvature_at((0, 0, 20))
print(round(c.k1, 12), round(c.k2, 12), c.normal)   # 0.1 0.1 Vector(0, 0, 1)
bore = (Box(40, 30, 20) - Cylinder(6, 30)).faces().cylinders()[0].curvature_at()
print(round(bore.k1, 12), round(bore.k2, 6))        # 0.0 -0.166667
torus = Torus(6, 5).faces()[0]
print(torus.radius, torus.major_radius, round(torus.min_radius(), 9))   # 5.0 6.0 1.0
side = Cone(10, 4, 20).faces().filter_by(lambda f: f.geom_type == "cone").one()
print(round(side.cone_angle, 4), round(side.min_radius(), 4))   # 16.6992 4.1761: at the small end
print(round(CenterArc((0, 0, 0), 7, 0, 90).curvature_at(), 12))   # 0.142857142857
```

## Related

`closest_points` (`uv_at`, `position_at`), `continuity`, `Face` (selection domain),
`surfaces/iso`
