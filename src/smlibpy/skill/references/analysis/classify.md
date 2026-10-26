# classify

Where a point lies relative to a part: in the material, outside, or on the surface (and on which
face, edge or vertex). For clash and clearance checks, sampling, deciding which side of a cut
to keep, and which cell of a merged part holds a point.

## Signature
`part.classify(point, tolerance=None) -> tuple[str, Face | Edge | Vertex | None]`
`part.contains(point, tolerance=None) -> bool`
`part.cell_at(point, tolerance=None) -> Part | None`

- `point`: a `Vector` or `(x, y, z)`.
- `tolerance`: how close to the surface counts as on it; default the part's own tolerance (1e-5 for
  most parts). Positive, else `ValueError`.

## Returns
- `classify`: `("inside", None)`, `("outside", None)` (a cavity is outside), or
  `("on", shape)`: the vertex, edge or face the point lies on, the vertex rather than its edges
  and an edge rather than its faces.
- `contains`: True inside and on the surface, False outside and in a cavity.
- `cell_at`: the cell of a merged part that holds the point, the same part as in `cells()`;
  None outside, in a cavity and on a face (also a face between two cells). A part that is one
  solid gives itself.

## Gotchas
- Use these, not the parity of `raycast` hits. A ray that grazes a cylinder or a sphere, runs
  along a face or passes through an edge counts wrongly: from outside `Cylinder(5, 20)` the ray
  from (-10, 5, 0) along X touches the side once (odd, "inside"), and a point in the material
  whose ray is tangent to a hole counts 2 hits ("outside").
- About 0.03 ms per point on a small part, 0.3 ms on a plate of 50 faces and 0.6 ms on one of
  100 (points off the surface take several rays, each tested against the faces).

## Example
```python
part = Box(40, 30, 20) - Cylinder(5, 30)
print(part.classify((10, 8, 0)))          # ('inside', None)
print(part.classify((0, 0, 0)))           # ('outside', None): in the hole
where, face = part.classify((20, 0, 0))   # on the right side
print(where, face.geom_type)              # on plane
print(part.classify((20, 15, 10))[1])     # Vertex(20, 15, 10)
print(part.contains((10, 8, 0)), part.contains((0, 0, 0)))   # True False

cyl = Cylinder(5, 20)
print(cyl.contains((-10, 5, 0)), len(cyl.raycast((-10, 5, 0), (1, 0, 0))))   # False 1 (a grazing ray)

cells = Box(20, 20, 20).merge(Cylinder(4, 30))
print(round(cells.cell_at((0, 0, 0)).volume, 3))   # 1005.31: the cylinder inside the box
print(cells.cell_at((0, 0, 30)))                   # None: outside
```

## Related
`raycast`, `distance_to`, `closest_point`, `cells`, `merge`, `is_valid`
