# Sketch.mirror

A mirrored copy of a sketch, about an axis in its own plane or in any plane. Lines stay
lines, arcs stay arcs, and the sketch keeps facing the same way.

## Signature
`sketch.mirror(plane=Plane.XZ)` (also `mirror(sketch, plane)` as a function)
- an `Axis` in the sketch plane: `s.mirror(Y)` (x -> -x for a sketch on XY), `s.mirror(X)`
  (y -> -y), `s.mirror(Axis((30, 0, 0), (0, 1, 0)))` (about x = 30).
- a `Plane` or a planar face, as for parts. The default `Plane.XZ` flips y.

## Returns
A new `Sketch` with exact edges (`line`, `circle`; splines stay B-splines).
- The normal is mirrored with the sketch. A mirror in a plane perpendicular to the sketch (any
  axis in its plane) leaves the normal as it was: `half.mirror(Y)` extrudes up like `half`.
- Mirror and extrude commute: `half.extrude(5).mirror(Plane.YZ)` and
  `half.mirror(Y).extrude(5)` are the same part (their difference has volume 0). A sketch at
  z = 10 mirrored in `Plane.XY` lies at z = -10 with normal -Z and extrudes to z -15..-10.
- `half + half.mirror(Y)` fuses the halves: the edges on the axis vanish and collinear edges
  join (the half-polygon below: 1 face, 6 edges, area 575).

## Gotchas
- For a symmetric outline drawn as one line, `Profile(...).mirror(axis)` is shorter: it mirrors
  while drawing and closes the outline.
- The sketch's plane origin is mirrored too (it is the reference of `on()`-style placements).
- A sketch on another plane takes axes in that plane: a sketch on `Plane.XZ` mirrors about
  `Axis((0, 0, 0), (0, 0, 1))` (world Z) to the other side of x = 0.

## Errors
- `ValueError: mirror: the axis must lie in the sketch plane (its direction is not parallel to
  the plane); pass a Plane to mirror in 3D`
- `ValueError: mirror: the axis does not lie in the sketch plane (its origin is 5 away from it)`

## Example
```python
half = Polygon((0, 0), (20, 0), (20, 5), (5, 20), (0, 20))
whole = half + half.mirror(Y)                       # area 575, 1 face
left = half.mirror(Y).extrude(5)                    # bbox x -20..0, z 0..5
ring = (Pos(10, 0) * (Circle(5) - Circle(2))).mirror(Y)   # centered at (-10, 0), circle edges
```

## Related
`Profile` (`mirror(axis)` while drawing), `mirror` (geometry, parts), `generic`.
