# closest_points, closest_point, uv_at, position_at, param_at_point

The nearest points of a body and another shape (with the faces they lie on), and the nearest
point and its parameters on a face, an edge or a wire.

## Signature

- `body.closest_points(other) -> ClosestPoints` where `other` is a `Part`, `Shell`, `Sketch`,
  `Face`, `Edge` or `Wire`. On `Part`, `Shell` and `Sketch`.
- `face.closest_point(point) -> Vector`, `edge.closest_point(point)`, `wire.closest_point(point)`;
  `body.closest_point(point)` (see `distance_to`).
- `face.uv_at(point) -> (u, v)`: the parameters of the face's point nearest to `point`, as
  fractions 0 to 1 of the face's parameter box. `face.position_at(u, v) -> Vector`: the point of
  the face's surface there.
- `edge.param_at_point(point) -> float`: where the nearest point lies, as the fraction of the
  edge's length that `point_at` takes.

## Returns

`ClosestPoints`, a named tuple:

| Field | Meaning |
|---|---|
| `point` | on the body `closest_points` was called on |
| `other_point` | on the other shape |
| `distance` | their distance: `distance_to(other)` |
| `face` | the face of the body `point` lies on (at an edge or a corner: one of the faces there) |
| `other_face` | the face of the other body, the face itself for a `Face`; `None` for an edge or a wire |

## Accuracy

The points are exact surface (and curve) points: starting points from a tessellation (bodies)
or from 64 points along each edge (curves), then closest points in turn and Newton's method on
the parameters of the faces and the curve, as `distance_to`. Between skew cylinders 2 apart at
5 degrees both points lie on their cylinders to 1e-15 and the distance is 2.0. Where the shapes
touch or cross, the distance is 0 and the points are one place where they meet.

## Gotchas

- `position_at` gives a point of the surface; a trimmed face (a plate with a hole, a face cut by
  another) does not cover its whole parameter box: `position_at(0.5, 0.5)` of a plate with a
  centered hole lies in the hole. `uv_at` always gives a point on the face.
- `param_at_point` of a closed edge (a circle) is 0 at its start: points just before the start
  give values just below 1.
- A body's `closest_point(p)` of a point inside it is the nearest surface point; there is no
  "inside" answer (see `classify`).

## Example

```python
a, b = Box(10, 10, 10), Sphere(3).translate(20, 0, 0)
cp = a.closest_points(b)
print(cp.point, cp.other_point, cp.distance)       # Vector(5, 0, 0) Vector(17, 0, 0) 12.0
print(cp.face.normal_at(), cp.other_face.geom_type)  # Vector(1, 0, 0) sphere

print(a.distance_to(Line((20, -50, 3), (20, 50, 3))))   # 15.0: an edge
part = Box(40, 30, 20) - Cylinder(6, 30)
top = part.faces().top().one()
print(top.closest_point((0, 0, 30)))               # Vector(6, 0, 10): on the rim of the hole
u, v = top.uv_at((5, 5, 30))
print(top.position_at(u, v))                       # Vector(5, 5, 10)
rim = part.edges().circles().first
print(rim.param_at_point((0, 10, -10)))            # 0.25: a quarter round from its start
```

## Related

`distance_to`, `curvature_at`, `Face`, `Edge` (selection domain), `classify`
