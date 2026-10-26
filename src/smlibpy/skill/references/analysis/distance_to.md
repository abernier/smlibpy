# distance_to, closest_point

The minimum distance from a body to a point or to another body, and the nearest point on a
body's surface.

## Signature

`body.distance_to(other) -> float` where `other` is a point (`(x, y, z)`, `Vector`, `Vertex`),
another body (`Part`, `Shell`, `Sketch`), a `Face`, an `Edge` or a `Wire`.

`body.closest_point(point) -> Vector`, a point on the body's surface. The nearest points of two
shapes and their faces: `closest_points` (also `Face/Edge/Wire.closest_point`).

On `Part`, `Shell` and `Sketch`. `Face`, `Edge` and `Wire` have `distance_to(point)` and
`distance_to(body)` (the body's distance to them); `Vertex` has `distance_to(point)` and
`distance_to(shape)`.

## What the number means

It is the distance between **surfaces**, not between volumes:

| Situation | `distance_to` |
|---|---|
| point outside | distance to the surface |
| point inside a part | distance to the surface (`Box(10,10,10).distance_to((1,2,3))` is 2.0, not 0) |
| bodies apart | the gap |
| bodies touching or crossing | 0.0 |
| one body inside the other, or in a hole | the clearance to the surface (a sphere r2 in a box 10: 3.0) |

So a non-zero distance does not mean "apart": one body may lie inside the other, either one.
Above 0 the surfaces do not cross, so a point of each body's surface decides, in both directions:
`a.contains(b.faces()[0].interior_point()) or b.contains(a.faces()[0].interior_point())` (see
`classify`; a sphere r2 in a box 10 is inside the box, the box not inside the sphere). An
intersection, `len((a & b).faces()) > 0`, tells as well (0.2 s for two plates of 87 faces).

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
- A face counts as the sheet it is (its own boundary, not the whole surface); an edge or a wire
  as the curve between its ends (before 0.5.0 they raised `TypeError`).
- Body-body distance takes 10 to 25 ms for the bodies of the example, 0.9 s for two plates of 87
  faces (both bodies are tessellated to find starting points); point queries under 0.01 ms.

## Example

```python
a = Box(10, 10, 10)
b = Sphere(3).translate(20, 0, 0)
print(a.distance_to(b))                  # 12.0, gap between the surfaces
print(a.distance_to((0, 0, 30)))         # 25.0
print(a.closest_point((0, 0, 30)))       # Vector(0, 0, 5)
print(a.distance_to((1, 2, 3)))          # 2.0: inside the box, distance to its surface

# overlap check: distance_to cannot tell nested from apart, a point of each body can
inner = Sphere(2)
print(a.distance_to(inner))              # 3.0 although the sphere is inside
nested = lambda p, q: p.contains(q.faces()[0].interior_point()) or q.contains(p.faces()[0].interior_point())
print(nested(a, inner), nested(inner, a))   # True True: one inside the other, either way round

c1, c2 = Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 0)
print(c1.distance_to(c2))                # 12.0: parallel cylinders
rod = Cylinder(5, 200).rotate(X, 1).translate(12, 0, 0)
print(round(Cylinder(5, 200).distance_to(rod), 9))   # 2.0: crossing at 1 degree
print(a.distance_to(Line((20, -50, 3), (20, 50, 3))))  # 15.0: an edge
print(a.closest_points(b).point)         # Vector(5, 0, 0): and the point on b, the faces
```

## Related

`closest_points`, `measures`, `intersection_curves`, `Part.intersect` (`&`), `generic`
