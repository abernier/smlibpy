# top, bottom, left, right, front, back

Keep the shapes that lie furthest in one world direction.

## Signature
`sl.top()`, `sl.bottom()` (largest / smallest Z), `sl.right()`, `sl.left()` (X), `sl.back()`,
`sl.front()` (Y). No arguments. They are `max_by(Z)`, `min_by(Z)`, `max_by(X)`, `min_by(X)`,
`max_by(Y)`, `min_by(Y)`; use `max_by(axis)` for any other direction.

## Returns
A ShapeList with every shape that ties for the extreme position (tolerance 1e-4 mm, absolute).
Never a single shape: chain `.one()` when you need exactly one. Empty in, empty out.

## What "position" means
The selectors compare `shape.center()` along the axis:
- Face: the area centroid. `faces().top()` is the face whose centroid is highest, not every face
  pointing up. On a stepped block with tops at z=20 and z=30, `top()` gives only the z=30 face;
  `faces().planar().facing(Z)` gives both.
- Edge: the midpoint along the edge (`point_at(0.5)`). For a straight edge that is its middle; for
  a full circle it is the point opposite the circle's start (where the seam is).
- Vertex: its point. Part (in `solids()`): its center of mass.

On a `Box`, each selector gives 1 face, 4 edges and 4 vertices.

## Gotchas
- Ties return all of them: two separate blocks of equal height give 2 faces for `top()`;
  `box.edges().top()` gives the 4 top edges.
- Tie tolerance is 1e-4 mm, fixed: tops at z=5 and z=5.000025 tie, z=5.0005 wins alone.
- Circles that are not horizontal: `Cylinder(10, 40).rotate(Y, 90)` has both rim midpoints at
  z=+10 (its radius), so `edges().top()` and `edges().bottom()` both return both rims. Sort
  such circles by `arc_center` instead: `edges().circles().sort_by(lambda e: e.arc_center.x)`.
- Curved faces: the centroid of a full cylinder face lies on its axis. A horizontal cylinder's
  `faces().top()` returns all three faces (all centroids at z=0).
- A face with a large hole has its centroid shifted away from the hole; compare faces by
  `bbox()` when that matters.
- `top()` of `faces()` on a part with fillets on the top edges is still the flat top face.

## Example
```python
step = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) \
     + Box(20, 30, 10, align=(Align.MIN, Align.CENTER, Align.MIN)).translate(0, 0, 20)
print(len(step.faces().top()))                 # 1: only the face at z=30
print(len(step.faces().facing(Z)))             # 2: both upward faces (z=20 and z=30)
print(len(step.edges().top()))                 # 4: the edges of the z=30 face
right_top = step.edges().top().right()         # chain: highest, then furthest +X
print(right_top.one())                         # Edge(line, (20, -15, 30) -> (20, 15, 30))

twin = Box(10, 10, 10).translate(-20, 0, 0) + Box(10, 10, 10).translate(20, 0, 0)
print(len(twin.faces().top()))                 # 2: a tie returns both
```

## Related
`extremes` (`max_by`, `min_by`), `sort_by` (`group_by`), `spatial` (`facing`, `nearest`), `generic`.
