# nearest, within, facing

Select by distance to a point, by a bounding region, or by the direction a face points.

## Signature
- `sl.nearest(point)` → one shape: the one whose `center()` is closest to `point`.
- `sl.within(box)` → ShapeList of shapes whose bounding box lies inside `box` (a `BoundBox`).
- `sl.facing(direction, max_angle=1e-3)` → ShapeList of faces whose outward normal is within
  `max_angle` degrees of `direction` (an Axis or a vector; its length is ignored), on a curved
  face everywhere.

## nearest: centers, not surfaces
`nearest` compares centers (face centroid, edge midpoint), not the true distance. For
`Box(100, 10, 10)` and a point 1 mm above the top face near the right end, `nearest` returns the
end face (center 6.1 away) and not the top face (1 mm away, but its center is 49 away). For the
truly closest shape sort by `distance_to`:
`sl.sort_by(lambda s: s.distance_to(p)).first`. On an empty list `nearest` raises
`IndexError: list index out of range`.

## within
- Takes a `BoundBox(min_corner, max_corner)`; a tuple of points raises
  `AttributeError: 'tuple' object has no attribute 'contains'`.
- The whole bounding box of the shape must be inside (tolerance 1e-6). A face that crosses the box
  border is left out: the half-space x ≥ 0 of a centered bar contains only its right end face.
- `faces().within(part.bbox())` returns every face.

## facing
- Faces only; edges and vertices are dropped.
- Outward means out of the material: the wall of a hole faces towards the hole's axis.
- The sense counts: `facing(Z)` is the faces pointing up, `facing(-Z)` the faces pointing down.
  Compare `parallel_to(Z)`, which takes both.
- The default `max_angle` (1e-3°) means "exactly". Pass a larger angle for inclined faces:
  a wedge's slope (normal 26.6° from Z) is found with `facing(Z, max_angle=60)`.
- A curved face counts only when its normal is within `max_angle` everywhere on the face (the
  least n·d over the face, as `draft_analysis` measures it). With the default angle only flat
  faces count. The wall of a hole or a boss, a sphere, a torus and a half cylinder face no
  direction. A dome whose rim normal is 53.1° from Z counts for `facing(Z, max_angle=60)`; a
  fillet only for an angle that takes in the normals of both faces it joins.

## Example
```python
bar = Box(100, 10, 10)
p = (49, 0, 6)                                         # 1 mm above the top face
print(bar.faces().nearest(p).center())                 # (50, 0, 0): the end face, center closest
true = bar.faces().sort_by(lambda f: f.distance_to(p)).first
print(true.center())                                   # (0, 0, 5): the top face, 1 mm away
right_half = BoundBox((0, -100, -100), (100, 100, 100))
print(len(bar.faces().within(right_half)))             # 1: only the end face lies fully inside
w = Wedge(20, 20, 10)
print(len(w.faces().facing(Z)), len(w.faces().facing(Z, max_angle=60)))   # 0 1
```

## Related
`extremes` (`at`), `sort_by` (`sort_by_distance`), `parallel_to`, `Face.normal_at`, `generic`.
