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
| one body inside the other | the wall clearance (a sphere r2 in a box 10: 3.0) |

So a non-zero distance does not mean "apart". To test for overlap, intersect:
`len((a & b).faces()) > 0` (an empty intersection has no faces, volume 0).

`closest_point` of a point inside returns the nearest surface point
(`(1, 2, 3)` in a 10 mm box gives `(1, 2, 5)`). For the center of a sphere it returns one of
the equally near points.

## Accuracy

Point queries are exact to 1e-14 on planes, cylinders, spheres, fillets, also far from the
origin. Body-body distances are exact (1e-14) for boxes, spheres, cones, tori, skew and
perpendicular cylinders, and coaxial cylinders.

**Wrong when the nearest points form a line**: two parallel cylinders, a cylinder beside a
flat face parallel to its axis. The result is too small by 1.7 to 3.6 mm (r5 and r3 cylinders
20 apart: 10.33 instead of 12; cylinder beside a box: 7.22 instead of 10). A shaft off-center
in a hole is right.

**Wrong far from the origin**: two spheres near (1e4, -2e4, 3e4) or (1e5, 0, 0) give 15.56
instead of 13.91; near (7e3, -1.4e4, 2.1e4) they were still right. Move both bodies by the same
vector to near the origin before measuring.

Cross-check a body-body distance with alternating `closest_point` calls (works for convex
regions; see the example).

## Gotchas

- `distance_to` on a list raises `ValueError: expected 2 or 3 coordinates, got 1`; loop over
  the list.
- `part.distance_to(edge)` raises `TypeError: 'Edge' object is not iterable`, and
  `edge.distance_to(part)` `TypeError: 'Part' object is not iterable`. Only points and bodies
  are accepted. For an edge, take the minimum over `edge.point_at(t)` samples, or
  `face.to_shell()` for a face.
- Body-body distance takes 1 to 6 ms on primitives; point queries under 0.1 ms.

## Example

```python
a = Box(10, 10, 10)
b = Sphere(3).translate(20, 0, 0)
print(a.distance_to(b))                  # 12.0, gap between the surfaces
print(a.distance_to((0, 0, 30)))         # 25.0
print(a.closest_point((0, 0, 30)))       # Vector(0, 0, 5)
print(a.distance_to((1, 2, 3)))          # 2.0: inside the box, distance to its surface

# overlap check: distance_to cannot tell nested from apart, an intersection can
inner = Sphere(2)
print(a.distance_to(inner))              # 3.0 although the sphere is inside
overlap = a & inner
print(len(overlap.faces()) > 0, round(overlap.volume, 4))   # True 33.5103

# cross-check for parallel cylinders and flat faces (distance_to is wrong there)
def gap(p, q, steps=50):
    x = q.center()
    for _ in range(steps):
        y = p.closest_point(x)
        x = q.closest_point(y)
    return (y - x).length
c1, c2 = Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 0)
print(round(c1.distance_to(c2), 4), round(gap(c1, c2), 4))   # 10.3331 12.0 (true: 12)
```

## Related

`measures`, `intersection_curves`, `Part.intersect` (`&`), `generic`
