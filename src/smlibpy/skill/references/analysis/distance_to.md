# distance_to, closest_point

The minimum distance from a body to a point or to another body, and the nearest point on a
body's surface.

## Signature

`body.distance_to(other) -> float` where `other` is a point (`(x, y, z)`, `Vector`, `Vertex`)
or another body (`Part`, `Shell`, `Sketch`).

`body.closest_point(point) -> Vector`, a point on the body's surface.

On `Part`, `Shell` and `Sketch`. `Face`, `Edge`, `Wire` and `Vertex` have `distance_to(point)`
only; they have no `closest_point`.

## What the number means

It is the distance between **surfaces**, not between volumes:

| Situation | `distance_to` |
|---|---|
| point outside | distance to the surface |
| point inside a part | distance to the surface (`Box(10,10,10).distance_to((1,2,3))` is 2.0, not 0) |
| bodies apart | the gap |
| bodies touching or crossing | 0.0 |
| one body inside the other, or in a hole | the clearance to the surface (a sphere r2 in a box 10: 3.0) |

So a non-zero distance does not mean "apart": one body may lie inside the other. Above 0 the
surfaces do not cross, so one point of the other body's surface decides:
`a.contains(b.faces()[0].interior_point())` (see `classify`). An intersection,
`len((a & b).faces()) > 0`, tells as well but takes seconds on parts of many faces.

`closest_point` of a point inside returns the nearest surface point
(`(1, 2, 3)` in a 10 mm box gives `(1, 2, 5)`). For the center of a sphere it returns one of
the equally near points.

## Accuracy

Point queries are exact to 1e-14 on planes, cylinders, spheres, fillets, also far from the
origin. Body-body distances are exact (1e-11 or better), also where the nearest points form a
line (two parallel cylinders, a cylinder beside a flat face parallel to its axis), between
nearly parallel faces (two cylinders crossing at 1 degree) and far from the origin. Should the
nearest points not settle, `distance_to` warns (`RuntimeWarning`) that the distance may be too
large.

## Gotchas

- `distance_to` on a list raises `ValueError: expected 2 or 3 coordinates, got 1`; loop over
  the list.
- `part.distance_to(edge)` raises `TypeError: distance_to takes a point or a body (Part,
  Shell, Sketch), not a Edge` (the same for a face or wire), and `edge.distance_to(part)`
  `TypeError: 'Part' object is not iterable`. For an edge, take the minimum over
  `edge.point_at(t)` samples, or `face.to_shell()` for a face.
- Body-body distance takes a few to about 100 ms (both bodies are tessellated to find
  starting points); point queries under 0.1 ms.

## Example

```python
a = Box(10, 10, 10)
b = Sphere(3).translate(20, 0, 0)
print(a.distance_to(b))                  # 12.0, gap between the surfaces
print(a.distance_to((0, 0, 30)))         # 25.0
print(a.closest_point((0, 0, 30)))       # Vector(0, 0, 5)
print(a.distance_to((1, 2, 3)))          # 2.0: inside the box, distance to its surface

# overlap check: distance_to cannot tell nested from apart, a point of the other body can
inner = Sphere(2)
print(a.distance_to(inner))              # 3.0 although the sphere is inside
print(a.contains(inner.faces()[0].interior_point()))   # True: inside, not apart

c1, c2 = Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 0)
print(c1.distance_to(c2))                # 12.0: parallel cylinders
rod = Cylinder(5, 200).rotate(X, 1).translate(12, 0, 0)
print(round(Cylinder(5, 200).distance_to(rod), 9))   # 2.0: crossing at 1 degree
```

## Related

`measures`, `intersection_curves`, `Part.intersect` (`&`), `generic`
