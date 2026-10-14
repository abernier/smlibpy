# hit_by

Selects what a ray meets: the faces (or bodies) of a list that a ray passes through, nearest
first. For "the face I see from here", "the faces a drill line goes through", and which part of
an assembly is in front.

## Signature
`sl.hit_by(origin, direction) -> ShapeList`
`sl.hit_by(axis)`: the ray from the axis origin along its direction.

- `origin`: where the ray starts; what lies behind it is not met.
- `direction`: a vector or an axis; its length does not matter.

## Returns
A ShapeList of the faces or bodies the ray meets, each once, ordered by where the ray first
meets it. `hit_by(...).first` is what the ray sees first. Empty when the ray misses.

## What counts
- Only the shapes in the list: `part.faces().planar().hit_by(...)` looks past the faces that
  are not planar, as if they were not there.
- A face the ray crosses twice (the wall of a hole) is in the list once, where the ray first
  meets it.
- A ray through an edge meets the faces on both sides of it (two faces at the same distance, in
  the order of the list).
- A list of bodies (parts, sheets, `import_step(...)`, `cells()`): the bodies the ray meets,
  nearest first.
- The points themselves, distances and normals: `raycast` on the part or the face.

## Errors
- `TypeError: hit_by takes faces and bodies, not a Edge` (edges and vertices: a ray does not
  meet them).
- `TypeError: raycast takes an origin and a direction, or an axis`; `ValueError: raycast: the
  direction must not be zero`.

## Example
```python
part = Box(40, 30, 20) - Cylinder(5, 30)
met = part.faces().hit_by((-50, 0, 0), (1, 0, 0))     # along x, through the hole
print([f.geom_type for f in met])                       # ['plane', 'cylinder', 'plane']
print(part.faces().planar().hit_by((-50, 0, 0), (1, 0, 0)).first.center())   # Vector(-20, 0, 0)

seen = part.faces().hit_by(Axis((10, 8, 50), (0, 0, -1))).first   # looking down: the top face
part = part.fillet(seen.edges(), 2)                     # and it chains into a feature as any selection
print(part.is_valid())                                  # True

parts = ShapeList([Box(5, 5, 5).translate(x, 0, 0).named(f"b{x}") for x in (0, 20, 40)])
print([p.name for p in parts.hit_by((100, 0, 0), (-1, 0, 0))])   # ['b40', 'b20', 'b0']
```

## Related
`raycast` (the points, distances and normals), `facing`, `nearest`, `at`, `generic`
