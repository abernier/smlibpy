# Geometry conventions

Units, axes, value semantics, tolerances, and how to print and compare results.

## Units and axes
- Lengths in millimeters, angles in degrees, everywhere (`Rot`, `rotate`, `rotated`,
  `PolarLocations`, `revolve`).
- Z is up. `Plane.XY` is the ground; the side planes (`front`, `back`, `left`, `right`) have
  their local Y pointing to world +Z.
- Positive angles turn counterclockwise when you look down the axis from its positive end
  (right-hand rule): `Rot(z=90) * Vector(1, 0, 0)` is `Vector(0, 1, 0)`.
- Primitives and sketches are centered on the origin unless `align=` says otherwise.

## Shapes are values
- Every operation returns a new shape. `part.translate(...)`, `part.fillet(...)`,
  `part - tool` leave `part` unchanged.
- `part -= tool` rebinds the name `part` to the result; another name that pointed to the old
  part still sees the old part.
- `==` on shapes is identity, not geometry: `b == b.translate(0, 0, 0)` is False (only a free
  `Vertex` compares by position). Compare numbers (volume, bbox, center) instead.
- `X`, `Y`, `Z` are `Axis` objects, not vectors. Use `Z.direction` when you need the vector.
- `Vector`, `Axis`, `Plane`, `Location` are immutable values too; methods return new ones.

## Printing
| Object | repr |
|---|---|
| Part | `Part(6 faces, volume=48000)`; with a name `Part('plate', 6 faces, volume=6000)` |
| Sketch / Shell | `Sketch(1 faces, area=50)` |
| Face | `Face(plane, area=600, center=(-2.143e-16, -3.485e-16, 5))`: 4 digits, noise not rounded to 0 |
| Edge | `Edge(line, (15, -10, 5) -> (15, 10, 5))` |
| Wire | `Wire(4 edges, closed, length=100)` |
| Vertex | `Vertex(15, 10, 5)` |
| ShapeList | `ShapeList([...])`, more than 6 items: the first 3 and the count |
| Vector | `Vector(0.333333, 0, 0)`: 6 significant digits, values below 5e-13 print as 0 |
| Location | `Pos(1, 2, 3)` without rotation, else `Location(position=(...), rotation=(...))` |
| Plane / Axis | `Plane.XY`, `Axis.Z` for the named ones, else origin and directions |

Reprs round. Print `v.to_tuple()` or `round(x, 6)` when the digits matter.

`part.info()` (Part, Shell, Sketch) returns one dict:
`{'type': 'Part', 'faces': 7, 'edges': 15, 'vertices': 10, 'bbox': ((-40.0, -30.0, -5.0), (40.0, 30.0, 5.0)), 'solids': 1, 'voids': 0}`
(`solids` and `voids` for a Part only).

## Comparing results
- `TOLERANCE` is `1e-6` (mm). `Vector ==` and `Location ==` use it: `Vector == tuple` works
  (`bbox().size == (80, 60, 10)`).
- Volumes, areas and centers are integrated to a relative accuracy of 1e-7, and usually come out
  far better: `Box(30, 20, 10).volume` is `6000.0`, `Cylinder(30, 100).volume` is 2e-16 of its
  value off pi·30²·100, and the center of that cylinder turned 37° about (1, 1, 0) is 2.7e-10
  off the origin. Floats still differ in the last digits: compare with
  `math.isclose(a, b, rel_tol=1e-6)` and `v.is_close(w, tol)` with a tolerance that fits the
  part size (1e-5 of the size is safe), never with `==` on floats.
- Bounding boxes are exact, also of curved parts and of free curves (see `BoundBox`).

## Gotchas
- `sum(list_of_vectors)` fails (TypeError); pass a start value: `sum(vs, Vector())`.
- Vectors that are equal within the tolerance can hash differently, so a `set` of vectors
  may keep near-duplicates. Round the coordinates before you deduplicate.

## Example
```python
plate = Box(80, 60, 10)                        # mm; centered on the origin
holed = plate - Cylinder(4, 20)                # plate is unchanged
print(plate)                                   # Part(6 faces, volume=48000)
print(holed.info())                            # counts and bbox in one dict
print(holed.is_valid(), round(holed.volume, 3), holed.bbox().size)

expected = 80 * 60 * 10 - math.pi * 4**2 * 10
assert math.isclose(holed.volume, expected, rel_tol=1e-6)
assert holed.bbox().size == (80, 60, 10)       # Vector == tuple, tolerance 1e-6
assert len(holed.faces()) == len(plate.faces()) + 1
```

## Related
`Vector`, `Axis`, `Plane`, `Location`, `BoundBox`, `Align`, `recipes/verification`.
