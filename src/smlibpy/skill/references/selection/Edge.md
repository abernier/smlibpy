# Edge

One bounded curve: a line segment, a circle or arc, an ellipse or a NURBS curve. Edges come from
bodies (`part.edges()`, `face.edges()`) or from curve constructors (`Line`, `CenterArc`,
`Spline`, ...). `Edge()` itself raises `TypeError`.

## Properties and methods
| Member | Gives |
|---|---|
| `geom_type` | `"line"`, `"circle"` (also arcs), `"ellipse"`, `"bspline"`, `"other"` |
| `length` | arc length in mm |
| `start`, `end` | end points (Vectors); equal for a closed edge |
| `point_at(t=0.5)` | point at fraction `t` of the arc length; t is clamped to 0..1 |
| `tangent_at(t=0.5)` | unit tangent at `t`, pointing along the edge |
| `center()` | `point_at(0.5)`: the midpoint along the curve, not the circle center |
| `direction` | unit vector start → end; straight edges only |
| `radius`, `arc_center`, `normal` | circle/arc only: radius, center point, axis direction |
| `is_closed` | start == end (full circles, closed splines) |
| `is_seam` | True for the seam of a closed surface (see `edges(seams=True)`) |
| `convexity`, `is_convex()`, `dihedral_angle` | see `convexity` |
| `intersections(other)` | list of points where the two edges cross |
| `reversed()` | the same edge run the other way |
| `faces()`, `vertices()`, `distance_to(point)`, `bbox()` | topology and measures |

## Details
- `point_at` is uniform in arc length: 400 steps along a spline were all 0.0509 long.
  `point_at(-0.5)` gives the start, `point_at(1.5)` the end.
- `arc_center` is the center of the circle; `center()` is a point on the curve. For a full circle
  starting at (5, 0, 0), `center()` is (−5, 0, 0).
- `normal` is the circle's axis as stored in the kernel. It does not follow the face or the
  direction of travel: both rims of a `Cylinder` and of a hole have normal +Z, and `reversed()`
  keeps the normal.
- `reversed()` swaps `start`/`end` and flips `tangent_at`; the reversed edge still `==` the original
  and can be passed to `part.fillet`.
- The direction of edges taken from a body is the kernel's: do not rely on `start` being the lower
  or left end. Vertical edges of a `Box` happen to run −Z → +Z.
- Edges from a face's wire (`face.outer_wire().edges()`) run around the face counter-clockwise
  seen from outside.

## Gotchas
- `direction` on a curve: `ValueError: direction is only defined for straight edges, this is a
  circle`. `radius`/`arc_center`/`normal` on a non-circle: `ValueError: not a circular edge but a
  line`. Ellipses have none of them.
- `intersections` raises `KernelError: edge intersections failed (SM_ERR)` when the edges do not
  meet (parallel, skew, too short). Wrap it in `try/except KernelError` and treat that as no
  intersection. On a closed circle the start point can appear twice in the result; a collinear
  overlap gives a single point.
- Two free edges built from the same points are not `==` (identity); compare `start`/`end`.
- A moved edge (`translate`, `rotate`) is a free edge: `faces()` is empty and features of the part
  reject it.
- Straight edges can be `"bspline"` (after `chamfer`, `loft`, `ruled`, `to_nurbs`, `mirror`):
  `direction`, `lines()` and `parallel_to` treat them as straight; `geom_type` stays
  `"bspline"`.

## Example
```python
arc = CenterArc((0, 0, 0), 10, 0, 180)
print(arc.geom_type, round(arc.length, 4))           # circle 31.4159
print(arc.start, arc.end)                            # Vector(10, 0, 0) Vector(-10, 0, 0)
print(arc.point_at(0.5), arc.center(), arc.arc_center)   # (0, 10, 0) (0, 10, 0) (0, 0, 0)
print(arc.radius, arc.normal)                        # 10.0 Vector(0, 0, 1)
print(arc.reversed().start, arc.reversed().tangent_at(0))   # (-10, 0, 0) (0, 1, 0)

a = Line((0, 0, 0), (10, 10, 0))
print(a.intersections(Line((0, 10, 0), (10, 0, 0))))   # [Vector(5, 5, 0)]
try:
    pts = a.intersections(Line((1, 0, 0), (11, 10, 0)))   # parallel: the kernel raises
except KernelError:
    pts = []
print(pts)                                            # []

cyl = Cylinder(5, 10)
print([e.is_seam for e in cyl.edges(seams=True)])    # [True, False, False]
```

## Related
`convexity`, `types`, `topology`, `Face`, `Vertex`, `Line`, `CenterArc`, `Spline`, `Wire` (curves domain).
