# BoundBox

An axis-aligned box in world coordinates. `shape.bbox()` returns one for every shape type.

## Signature
`BoundBox(min, max)` and `BoundBox.of_points(points)`. You usually get one from `bbox()`.

## Members
| Member | Type | Meaning |
|---|---|---|
| `min`, `max` | Vector | lower and upper corner |
| `size` | Vector | `max - min` (the outer dimensions) |
| `center` | Vector | middle of the box, **a property** (on shapes `center()` is a method) |
| `diagonal` | float | length of the space diagonal |
| `contains(p, tol=1e-6)` | bool | point inside or on the box |
| `union(other)` | BoundBox | box around both |
| `lo, hi = bb` | | unpacks into min and max |

## Where bbox() comes from
| Shape | Tight? |
|---|---|
| `Part`, `Shell`, `Sketch`, `Face` | yes: exact extremes from the kernel, also for rotated cylinders and splines |
| Edges and wires taken from a body (`part.edges()`) | yes |
| Standalone curves (`Line`, `CenterArc`, `Spline`, `Polyline`, `Wire([...])`) | **no**: sampled at 33 points per edge, can be too small |
| `Vertex` | min = max = the point |
| `ShapeList` (selections, patterns) | union of the members; empty list -> `IndexError: empty selection` |

A plain Python list has no `bbox()`; wrap it: `ShapeList(items).bbox()`.

## Gotchas
- `bb.center` is a property; `part.center()` is a method and gives the centroid, which is
  not the bbox center for unsymmetric parts.
- Standalone curve boxes are sampled: `CenterArc((0, 0), 10, 10, 90).bbox().max.y` is 9.9976,
  not 10; a 30 mm `Spline` came out 0.07 mm short. Make a face or body first, or sample
  `point_at` densely, when you need an exact extent of a free curve.
- A sketch's bbox has zero size along its normal (`Circle(5).bbox().size.z == 0`).
- `min` and `max` can be reassigned (`bb.min = ...`); don't, the box is not recomputed.
- Body boxes are exact: a cylinder rotated 37° about (1, 1, 0) matched the analytic extent to
  the last digit. Compare with `==` against a tuple (tolerance 1e-6) or `math.isclose`.

## Example
```python
part = Box(60, 40, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)) + Cylinder(8, 25)
bb = part.bbox()
print(bb.min, bb.max)                 # Vector(-30, -20, -12.5) Vector(30, 20, 12.5)
print(bb.size, bb.center, round(bb.diagonal, 3))
lo, hi = bb                           # unpacks into min and max
print(bb.contains((0, 0, 12)), bb.contains((31, 0, 0)))

holes = PolarLocations(20, 6) * Cylinder(2, 5)
print(holes.bbox().size)              # bbox of a ShapeList: union of the members
print(part.faces().top()[0].bbox())   # faces and edges have one too
height = part.bbox().size.z           # 25.0: the cylinder reaches below the plate
```

## Related
`Align`, `center`, `generic` (comparing results), `recipes/verification`.
