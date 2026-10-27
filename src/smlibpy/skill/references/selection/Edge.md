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
| `tangent_chain()` | this edge and the edges that continue it tangentially (see `tangent_chain`) |
| `tolerance` | how far its curve, its ends and its faces may lie apart in the kernel (1e-5 on most parts; more on imported, stitched or healed bodies); `ValueError` for a free edge |
| `intersections(other, tolerance=None)` | points where it meets an edge, wire, face, body or a list of them, in order along the edge; `[]` for none |
| `intersection_params(other)` | the same as fractions of the length (for `split`, `trim`, `point_at`) |
| `self_intersections()` | points where the edge crosses itself |
| `closest_point(p)`, `param_at_point(p)` | the nearest point of the edge, and its fraction along it |
| `split(at)` | `(before, after)`: cut at a fraction or a point on the edge |
| `trim(start, end)` | the part between two fractions or points (start before end) |
| `extend(d, end="end", continuity="G1")` | longer by `d` at `"end"`, `"start"` or `"both"` |
| `offset(d, plane=None)` | a parallel edge: an open one to the left, a closed one outward (`curves/offset`) |
| `curvature_at(t)`, `radius_at(t)` | curvature (1/radius; 0 where straight) and radius of curvature at `t` |
| `min_radius()`, `min_radius_at()`, `inflections()` | the radius of the tightest bend and where it is; fractions where the bend flips (`curves/min_radius`) |
| `to_arcs(tolerance=0.01)` | a wire of lines and circular arcs within the tolerance (`curves/to_arcs`) |
| `reversed()` | the same edge run the other way |
| `faces()`, `vertices()`, `distance_to(point)`, `bbox()` | topology and measures (`distance_to` also to a body); `bbox()` is exact (also of free curves) |
| `continuity(samples=16)` | how the two faces meet: G0, G1, G2 with gap, angle, curvature jump; see `continuity` |

## Details
- `point_at` is uniform in arc length: 400 steps along `Spline((0, 0), (10, 10), (20, 0))`
  (29.5789 long) were all 0.07395 long.
  `point_at(-0.5)` gives the start, `point_at(1.5)` the end.
- `arc_center` is the center of the circle; `center()` is a point on the curve. For a full circle
  starting at (5, 0, 0), `center()` is (−5, 0, 0).
- `normal` is the circle's axis as stored in the kernel. It does not follow the face or the
  direction of travel: both rims of a `Cylinder` and of a hole have normal +Z, and `reversed()`
  keeps the normal.
- `reversed()` swaps `start`/`end` and flips `tangent_at`; the reversed edge still `==` the original
  and can be passed to `part.fillet`.
- `split`, `trim` and `extend` give new free edges that keep the curve: a trimmed or extended arc
  is a `circle` with the same radius and center, a trimmed spline the same spline. Positions are
  fractions of the length (0 at `start`, 1 at `end`, as `point_at`) or points on the edge (within
  1e-6 of its length; a point off it raises `ValueError` naming the distance).
- `extend` continues lines and arcs (circles, ellipses) as themselves. Other curves:
  `continuity="G1"` straight along the end tangent, `"G2"` keeping the end curvature (a large `d`
  curls), `"natural"` the curve's own polynomial. The added length is exactly `d`. Closed edges
  and arcs that would close on themselves raise `ValueError`.
- `intersections`: points within `tolerance` of the other shape count (default 1e-6, or 1e-9 of
  the size of the two where larger); points closer than that count once (the seam of a circle
  too). An overlap of two curves gives its two ends; an edge lying on a face gives the points
  where it starts and stops lying on the face. `e.intersections(e)` raises `ValueError`: use
  `self_intersections()`.
- The direction of edges taken from a body is the kernel's: do not rely on `start` being the lower
  or left end. Vertical edges of a `Box` happen to run −Z → +Z.
- Edges from a face's wire (`face.outer_wire().edges()`) run around the face counter-clockwise
  seen from outside.

## Gotchas
- `direction` on a curve: `ValueError: direction is only defined for straight edges, this is a
  circle`. `radius`/`arc_center`/`normal` on a non-circle: `ValueError: not a circular edge but a
  line`. Ellipses have none of them.
- Two free edges built from the same points are not `==` (identity); compare `start`/`end`.
- A moved edge (`translate`, `rotate`) is a free edge: `faces()` is empty and features of the part
  reject it.
- Straight edges can be `"bspline"` (after `chamfer`, `loft`, `ruled`, `to_nurbs`):
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
print(a.intersections(Line((1, 0, 0), (11, 10, 0))))   # parallel: []
print(Line((0, 0, -20), (0, 0, 20)).intersection_params(Box(10, 10, 10)))   # [0.375, 0.625]

s = Spline((0, 0), (10, 10), (20, 0))
left, right = s.split(s.intersections(Line((0, 4), (20, 4)))[0])   # at (2.254, 4, 0)
quarter = CenterArc((0, 0), 10, 0, 360).trim(0, 0.25)               # a 90 degree arc
longer = s.extend(5, end="both")                                     # s.length + 10

cyl = Cylinder(5, 10)
print([e.is_seam for e in cyl.edges(seams=True)])    # [True, False, False]
```

## Related
`convexity`, `types`, `topology`, `Face`, `Vertex`, `Line`, `CenterArc`, `Spline`, `Wire` (curves domain).
