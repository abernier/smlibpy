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
| `edges()`, `vertices()`, `bbox()`, `distance_to(p)` | as usual |
| `reversed()` | same wire traversed the other way |
| `close()` | adds a straight line from `end` to `start`; returns the same wire if already closed |
| `plane()` | fitted plane; normal by the right-hand rule along the travel (ccw in XY: +Z, cw: -Z) |
| `fillet(radius, vertices=None)` | rounds corners between two straight edges (below) |
| `to_sketch()` | the region inside a closed planar wire (same as `make_face(wire)`) |
| `split(at)` | `(before, after)` at a fraction of the length or a point; at a vertex the edges stay whole |
| `trim(start, end)` | the part between two fractions or points |
| `intersections(other, tolerance=None)` | points where it meets an edge, wire, face or body, in order; a point at a joint once |
| `to_edge()` | one B-spline edge through all edges (they must meet within 1e-6) |

## fillet
- Rounds every corner where two `line` edges meet, with tangent arcs of `radius`. Open
  wires keep their two end points; only inner corners are rounded.
- `vertices=[...]`: only the corners at these points (tuples or `Vertex`). A point that is
  not a corner is ignored without an error.
- Corners next to an arc or a spline are skipped silently (`Sketch.fillet` and `Profile.fillet`
  round line-arc corners too). Straight `bspline` edges count as lines and their corners are
  rounded.
- Limit: the two setbacks `r * tan(angle / 2)` on one edge may add up to its length. On a
  20 x 10 rectangle `fillet(5)` works (the short sides vanish, 6 edges), `fillet(5.001)`
  raises.
- `radius <= 0` raises `ValueError: fillet: the radius must be positive`.

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
- `ValueError: fillet radius 5.001 is too large for the edge Edge(line, ...)`.
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
