# iso

The curves of a face along which one of its surface parameters is constant: styling and
inspection lines, rails and section lines on freeform faces, the circles and lines of a turned
face.

## Signature
`face.iso(u=None, v=None) -> ShapeList[Edge]`

- `u` or `v` (one of them): the parameter held constant, as a fraction 0 to 1 of the face's range
  of that parameter. `iso(u=0.5)` runs along v through the middle of the u range.

## Returns
Free edges on the face, trimmed to it: several pieces where the face has holes or notches, none
where the parameter line misses the face. Within 1e-7 of the face's size (exact for planes,
cylinders and B-spline surfaces).

Which parameter runs which way depends on the surface:
- cylinder side: `v` constant gives the circle at that height (`iso(v=0.5)`: half way up);
  `u` constant a line along the axis.
- sphere: `v` constant a circle of latitude, `u` constant a half meridian.
- plane: lines across the face, parallel to its sides as the plane is parametrized.
Print `e.start`, `e.end` to see.

## Example
```python
side = Cylinder(10, 40).faces().cylinders()[0]
ring = side.iso(v=0.5)[0]                           # the circle at z = 0, length 62.832
line = side.iso(u=0.25)[0]                          # a line along the axis, length 40
plate = Box(40, 40, 10) - Cylinder(5, 20)
top = plate.faces().sort_by(Z)[-1]
print(len(top.iso(u=0.5)))                          # 2: cut by the hole
```

## Errors
- `ValueError: iso: give u or v (one of them)`.
- `ValueError: iso: v is a fraction of the face's range from 0 to 1, got 1.5`.

## Related
`wrap`, `analysis/project`, `selection/Face`.
