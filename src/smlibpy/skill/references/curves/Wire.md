# Wire

A chain of edges, open or closed. Outlines, sweep paths and loft sections are wires.

## Signature
`Wire(edges, *, sort=True)`

- `edges`: an `Edge`, a `Wire`, or a list of them (nested lists and `ShapeList`s are
  flattened). Edges from bodies (`part.edges()`) work too.
- `sort=True`: order the edges head to tail and flip edges that point the wrong way.
  `sort=False` keeps your order and directions as given.

`a + b` (Edge or Wire on either side) is `Wire([a, b])`. `Polyline`, `FilletPolyline` and
`face.outer_wire()` also return wires.

## Ordering
- The first edge you pass keeps its direction and sets the direction of the wire.
  `Wire([c, a, d, b])` of a square starts at the start of `c`.
- A closed wire starts and ends at the start of the first edge you pass.
- Chaining tolerance is 1e-6 mm.

## Members
| member | result |
|---|---|
| `is_closed` | end meets start within 1e-6 |
| `start`, `end` | first point of the first edge, last point of the last edge |
| `length` | sum of the edge lengths |
| `point_at(t)`, `tangent_at(t)` | at fraction `t` of the total length; `t` is clamped to 0..1; unit tangent along the travel |
| `center()` | length-weighted mean of the edge midpoints, not the area centroid |
| `edges()`, `vertices()`, `bbox()`, `distance_to(p)` | as usual (`distance_to` also to a body) |
| `closest_point(p)` | the wire's point nearest to `p` |
| `continuity()` | how the edges meet at the joints: G0, G1, G2 with gap, angle, curvature jump (analysis/continuity) |
| `reversed()` | same wire traversed the other way |
| `close()` | adds a straight line from `end` to `start`; returns the same wire if already closed |
| `plane()` | fitted plane; normal by the right-hand rule along the travel (ccw in XY: +Z, cw: -Z) |
| `fillet(radius, vertices=None)` | rounds corners with tangent arcs (below) |
| `to_sketch()` | the region inside a closed planar wire (same as `make_face(wire)`) |
| `split(at)` | `(before, after)` at a fraction of the length or a point; at a vertex the edges stay whole |
| `trim(start, end)` | the part between two fractions or points |
| `intersections(other, tolerance=None)` | points where it meets an edge, wire, face or body, in order; a point at a joint once |
| `to_edge()` | one B-spline edge through all edges (they must meet within 1e-6) |
| `offset(d, corners="round", plane=None)` | a parallel wire: open ones to the left, closed ones outward (`offset`) |
| `to_arcs(tolerance=0.01)` | lines and circular arcs within the tolerance (`to_arcs`) |
| `min_radius()` | `(radius, t)`: the smallest radius of curvature of its edges (`min_radius`) |

## fillet
- Rounds every sharp corner with tangent arcs of `radius`, as `Sketch.fillet` rounds a region's:
  in the wire's plane, between lines and arcs exactly, next to splines and ellipses with the arc
  whose center lies at `radius` from both curves (they are cut where it touches them). Open wires
  keep their two end points; only inner corners are rounded. Smooth (tangent) corners stay.
- A wire that is not planar: corners between lines, each in the plane of its two lines; a corner
  there next to another curve raises `ModelingError`.
- `vertices=[...]`: only the corners at these points (tuples or `Vertex`). A point that is not a
  corner raises `ModelingError: fillet: (55, 55) is not a corner of the wire; its corners are at
  ...` (an end of an open wire: `... is an end of the open wire, not a corner`); a named smooth
  corner raises `... is smooth ...`; an empty list raises `ValueError`.
- Straight and circular `bspline` edges count as lines and arcs.
- Limit: the two setbacks `r * tan(angle / 2)` on one edge may add up to its length. On a
  20 x 10 rectangle `fillet(5)` works (the short sides vanish, 6 edges), `fillet(5.001)`
  raises `ValueError` (`... overlap on the line ...`).
- `radius <= 0` raises `ValueError: fillet: the radius must be positive`.

```python
route = Wire([Line((0, 0), (10, 0)), ThreePointArc((10, 0), (13, 5), (10, 10)), Line((10, 10), (0, 10))])
print([e.geom_type for e in route.fillet(2).edges()])   # ['line', 'circle', 'circle', 'circle', 'line']
rail = Wire([Line((0, 0), (10, 0)), Spline((10, 0), (14, 4), (12, 8), (10, 10))]).fillet(2)
```

## Gotchas
- **No connectivity check.** Edges with a gap or a T branch are accepted; they keep the
  given order and the wire is "open". `make_face` then complains about an open wire, and a
  sweep along such a path raises `ValueError: the sweep path is not connected: a gap of ...`.
  Check `is_closed`, `start` and `end`.
- `to_sketch()` / `make_face()` choose the sketch normal themselves: +Z, or +X / +Y for
  vertical wires, not the plane the wire was drawn on. See `generic.md` for the workaround.
- `mirror()` keeps lines and arcs exact, so `half + half.mirror(Plane.XZ)` fillets every corner
  of the whole outline.
- `extrude(list_of_edges, h)` raises TypeError; wrap the list: `extrude(Wire(edges), h)`.
  `make_face(list_of_edges)` works.

## to_edge
- Joins the curves into one B-spline (`SmBSplineCurve::CreateByJoining`): the same length and
  points, one edge. At tangent joints the edge is smooth; at a corner it keeps the corner.
- One edge is a single sweep or loft rail and a single SPLINE in DXF:
  `sweep(Circle(1), FilletPolyline((0, 0, 0), (30, 0, 0), (30, 20, 10), radius=5).to_edge())`.
- A gap above 1e-6 raises `ValueError: to_edge: the edges do not meet: a gap of ...`. A wire of
  one edge returns that edge.

## Errors
- `ValueError: a wire needs at least one edge` for `Wire([])`.
- `TypeError: a wire is made of edges, got int` when a point tuple is in the list.
- `ValueError: fillet: radius 5.001 at (10, -5) and radius 5.001 at (10, 5) overlap on the line ...`
  (planar wires; `fillet radius ... is too large for the edge ...` for the corners of a wire that is
  not planar).
- `ValueError: fillet: the radius must be positive`.
- `ValueError: a sketch region needs closed wires; use wire.close()` from `to_sketch()` on
  an open wire.

## Example
```python
a = Line((0, 0), (10, 0))
b = Line((10, 0), (10, 10))
c = Line((10, 10), (0, 10))
d = Line((0, 10), (0, 0))
sq = Wire([c, a, d, b])            # any order; starts at c.start = (10, 10)
print(sq.is_closed, sq.length)     # True 40.0

w = Wire([Line((0, 0), (10, 0)), CenterArc((10, 5), 5, -90, 180), Line((10, 10), (0, 10))])
print(w.point_at(0.5), w.tangent_at(0.5))   # (15, 5, 0), (0, 1, 0)
region = w.close().to_sketch()              # area 100 + 12.5 * pi

rounded = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).fillet(2)
corner = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).fillet(4, vertices=[(20, 0)])
```

## Related
`Polyline`, `FilletPolyline`, `generic.md`, `sketches/make_face`, `features/sweep`.
