# split, trim

Cut an edge or a wire at a position along it (`split`), or keep the part between two positions
(`trim`). The pieces keep their curves: a piece of an arc is an arc with the same radius and
center, a piece of a spline the same spline.

## Signature
- `edge.split(at) -> (Edge, Edge)`, `wire.split(at) -> (Wire, Wire)`: the part before `at` and
  the part after.
- `edge.trim(start, end) -> Edge`, `wire.trim(start, end) -> Wire`: from `start` to `end`; the
  function `trim(edge_or_wire, start, end)` is the same (it also trims sheets: `surfaces/trim`).
- `edge.param_at_point(point) -> float`: the fraction of the nearest point; `edge.closest_point(point)`
  gives the point itself.

The function `split(part, plane, keep)` cuts parts (`features/split`); edges and wires are split
with the method.

A position is a **fraction of the length** (0 at `start`, 1 at `end`, as `point_at` takes it) or
a **point on the edge or wire** (a tuple, `Vector` or `Vertex`, within 1e-6 of the length).
Intersection points (`intersections`) and fractions (`intersection_params`) go straight in.

## Returns
New free edges (not part of a body), in the direction of the original: `a.end == b.start`, and
`a.length + b.length` equals the length to about 1e-14. Reversed edges and edges taken from
bodies work the same way. `wire.split` at a vertex keeps the edges whole; elsewhere it splits
the edge there.

## Gotchas
- `trim` needs `start` before `end` along the edge. To keep the part of a closed edge across
  its start, trim twice and make a wire: `Wire([c.trim(0.9, 1.0), c.trim(0.0, 0.1)])`.
- A position at an end splits nothing: `ValueError: split: the point is an end of the edge`.
- `param_at_point` of a closed edge's start point can be 0 or 1.

## Errors
- `ValueError: split: the point (5, 1, 0) lies 1 off the edge (the nearest point of the edge is
  (5, 0, 0)); pass a point on the edge or a fraction from 0 to 1`.
- `ValueError: trim: the start must come before the end along the edge ...`.
- `ValueError: split: a fraction of the edge runs from 0 to 1, got 1.5`.

## Example
```python
s = Spline((0, 0), (10, 10), (20, 0))
x = s.intersections(Line((0, 4), (20, 4)))      # [(2.254, 4, 0), (17.746, 4, 0)]
left, rest = s.split(x[0])                       # left.end == rest.start == x[0]
arch = s.trim(x[0], x[1])                        # between the two crossings
print(s.param_at_point(x[0]))                    # 0.1553

arc = CenterArc((0, 0), 10, 0, 180).trim(0.25, 0.75)   # circle, radius 10, 45 -> 135 degrees
rim = [e for e in Cylinder(10, 20).edges() if e.geom_type == "circle"][0]
quarter = rim.trim(0.25, 0.5)                    # a circle arc, length 15.70796

a, b = Polyline((0, 0), (10, 0), (10, 10)).split((10, 0))   # at the corner: 10 and 10
mid = Polyline((0, 0), (10, 0), (10, 10)).trim(0.25, 0.75)  # (5, 0) -> (10, 0) -> (10, 5)
```

## Related
`intersections`, `extend`, `to_edge`, `Wire.md`, `selection/Edge`.
