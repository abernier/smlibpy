# raycast

Where a ray meets a body, a face or a mesh: the exact points, nearest first. For what a line of
sight sees first, wall thicknesses along a direction and clearances. Whether a point is inside a
part: `contains` and `classify`, not the parity of the hits.

## Signature
`shape.raycast(origin, direction) -> list[Hit]` on `Part`, `Shell`, `Sketch`, `Face` and `Mesh`.
`shape.raycast(axis)`: the ray from the axis origin along its direction.

- `origin`: where the ray starts. Points behind it are not hits.
- `direction`: a vector or an axis; its length does not matter.

## Returns
A list of `Hit`, nearest first, `[]` when the ray misses. A `Hit` is a named tuple:

| Field | Meaning |
|---|---|
| `point` | where the ray meets the surface: exact on bodies (1e-12) |
| `distance` | how far along the ray from its start |
| `normal` | outward unit normal there: out of the material, so on the wall of a hole it points into the hole |
| `face` | the `Face` that was hit (bodies), `None` for meshes |
| `triangle` | index of the triangle that was hit (meshes), `None` for bodies |

## What counts as a hit
- Every face the ray crosses, also behind the first one: `hits[0]` is what the ray sees.
- A ray through an edge or a vertex hits once, not once per face.
- A ray along a face (in its plane) hits it where it enters it.
- A ray that starts on a surface hits it at distance 0.
- From inside a closed part the number of hits is odd, from outside it is even (0 when it misses),
  except where the ray grazes a face or passes through an edge: a ray tangent to a cylinder hits
  it once. Test points with `part.contains(point)` (see `classify`), which is exact.

## Gotchas
- To select faces with a ray (and chain on), use `part.faces().hit_by(origin, direction)`: the
  faces the ray meets, nearest first, as a ShapeList.
- Meshes: the points lie on the triangles, so they are off the exact surface by up to the mesh
  tolerance (a `Sphere(10).mesh(0.01)`: 0.003).
- Wall thickness along a normal: start a little outside, `part.raycast(p + n, -n)`, and take the
  difference of the first two distances. Starting exactly on the face also works (a hit at 0).
- A ray costs about 0.05 ms on a part of a few faces (only faces whose box the ray crosses are
  intersected).

## Errors
- `TypeError: raycast takes an origin and a direction, or an axis`: a point without a direction.
- `ValueError: raycast: the direction must not be zero`.

## Example
```python
part = Box(40, 30, 20) - Cylinder(5, 30)
for h in part.raycast((-50, 0, 0), (1, 0, 0)):    # along x, through the hole
    print(round(h.distance, 6), h.point, h.face.geom_type, h.normal)
# 30.0 Vector(-20, 0, 0) plane Vector(-1, 0, 0)
# 45.0 Vector(-5, 0, 0) cylinder Vector(1, 0, 0)    (the wall of the hole: the normal points into the hole)
# 55.0 Vector(5, 0, 0) cylinder Vector(-1, 0, 0)
# 70.0 Vector(20, 0, 0) plane Vector(1, 0, 0)

first = part.raycast(Axis((10, 8, 50), (0, 0, -1)))[0]   # looking down: what is seen first
print(first.point, first.face.geom_type)                  # Vector(10, 8, 10) plane

# inside or outside: classify the point (the parity of the hits miscounts grazing rays)
print(part.contains((10, 8, 0)), part.contains((0, 0, 0)))  # True False: in the material, in the hole

# wall thickness along the normal of a face
cup = Box(40, 30, 20) - Box(36, 26, 20).translate(0, 0, 2)
p, n = Vector(20, 0, 5), Vector(1, 0, 0)                  # a point of the outer wall, its normal
hits = cup.raycast(p + n, -n)
print(hits[1].distance - hits[0].distance)                # 2.0

hit = Sphere(10).mesh(0.01).raycast((3, 0, 50), (0, 0, -1))[0]   # a mesh: a point on a triangle
print(round(hit.point.z, 3), hit.triangle is not None)   # 9.536 True (exact: 9.539)
```

## Related
`hit_by` (select faces with a ray), `classify` (inside or outside), `distance_to`, `closest_point`, `intersection_curves`, `Mesh`, `generic`
