# parallel_to, perpendicular_to

Keep straight edges or planar faces by their direction.

## Signature
`sl.parallel_to(axis)`, `sl.perpendicular_to(axis)`

- `axis`: an `Axis` (`X`, `Y`, `Z`, `-Z`, `Axis(origin, dir)`) or a vector `(x, y, z)`. Only the
  direction counts: the sense (`Z` or `-Z`), the length of a vector and the origin of an Axis
  are ignored.

## What it means
| Shape | `parallel_to(Z)` keeps | `perpendicular_to(Z)` keeps |
|---|---|---|
| straight edge (`line`, or a straight `bspline`) | edges running along Z | edges running across Z (horizontal) |
| planar face (`is_planar`: a plane or a flat `bspline`) | faces whose **normal** is along Z: top and bottom | faces whose normal is across Z: vertical walls |
| Sketch in the list | sketches whose plane normal is along Z | sketches standing upright |
| circle, ellipse, curved bspline edge | never | never |
| cylinder, cone, any curved face | never | never |
| vertex | never | never |

So for faces the words are about the normal: `faces().parallel_to(Z)` are the horizontal faces,
`faces().perpendicular_to(Z)` the vertical planar walls. For edges they are about the edge itself.

## Returns
A ShapeList in the original order; shapes that do not qualify are dropped without error.

## Tolerance
The angle tolerance is 1e-4 degrees and cannot be changed. A box rotated by 1e-4° about X still
matches, one rotated by 2e-4° does not. For "roughly vertical" use a predicate with an angle
tolerance in degrees (`is_parallel` accepts both senses):
```python
tilted = Box(10, 10, 10).rotate(X, 0.5)
print(len(tilted.edges().parallel_to(Z)))                                              # 0
print(len(tilted.edges().lines().filter(lambda e: e.direction.is_parallel(Z.direction, 1))))   # 4
```

## Gotchas
- Circles lying flat are not `perpendicular_to(Z)`: only straight edges count.
- A vertical cylinder wall is in neither `parallel_to(Z)` nor `perpendicular_to(Z)`.
- After `chamfer` (also `loft`, `ruled`, `to_nurbs`) many straight edges are `bspline`
  curves; they still count: `Box(20, 20, 10).chamfer(vertical edges, 2).edges().parallel_to(Z)`
  returns all 8 vertical edges.
- Flat faces converted to NURBS (`to_nurbs()`, many STEP imports) count as planar here.
- `parallel_to` does not look at the sense of a face normal; use `facing(Z)` for faces pointing up.

## Example
```python
part = Box(40, 30, 20) - Cylinder(6, 30)
print(len(part.faces().parallel_to(Z)))        # 2: top and bottom (normal along Z)
print(len(part.faces().perpendicular_to(Z)))   # 4: the planar side walls
print(len(part.edges().parallel_to(Z)))        # 4: the vertical edges
print(len(part.edges().perpendicular_to(Z)))   # 8: horizontal lines (circles excluded)
print(len(part.faces().parallel_to((0, 0, -1))))   # 2: the sense does not matter
```

## Related
`spatial` (`facing`, with a sense and an angle), `filter_by`, `types`, `generic`.
