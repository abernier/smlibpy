# Sketch.fillet

Rounds the corners of a sketch region with tangent arcs. Works on corners between two
straight edges, on the outline and on holes.

## Signature
`sketch.fillet(radius, vertices=None)`
- `radius`: the arc radius, positive.
- `vertices`: `None` rounds every corner between two lines. Otherwise a list of corner points
  in **world coordinates**: tuples `(x, y)` or `(x, y, z)`, or `Vertex`es, e.g. a selection
  `s.vertices().filter(lambda v: v.x > 0)`. A single tuple must still be inside a list.

## Returns
A new `Sketch`. Lines are shortened and the arcs are real `circle` edges, so area and edges are
exact: `Rectangle(40, 20).fillet(3)` has area 800 - (4 - π)·9.
- Convex corners lose material; concave corners (the inside of an L, the corners of a hole)
  gain material.
- A corner whose neighbours are an arc or a curve is skipped (Slot, Circle, the joints of a
  rectangle fused with a circle).

## Radius limits
Each corner cuts back `radius·tan(turn/2)` along both of its edges (`radius` at 90°). The cut
backs on one edge must fit in it:
- All four corners of a 40 x 20 rectangle: up to 10 (at exactly 10 the short sides vanish).
- One corner only: up to 20 (the whole short edge).
- Acute corners need much more room: a 50 x 5 right triangle takes radius 1, not 3.

## Gotchas
- After `offset()` the edges are B-splines, so `fillet` finds no corners and returns the sketch
  unchanged, without an error. Fillet before offsetting.
- A point that is not a corner is ignored silently. Check the edge count or area afterwards.
- On a placed sketch the points are world points: on `Plane.XZ`, the corner of
  `Rectangle(20, 10)` is `(10, 0, 5)`, not `(10, 5)`.
- A negative radius is not rejected and produces a self-overlapping region (it even
  extrudes). `radius=0` raises an unhelpful error.
- Hole corners are rounded too. To round only the outline:
  `s.fillet(r, s.faces()[0].outer_wire().vertices())`.
- 3D parts have `Part.fillet(edges, radius)` with the arguments the other way round.

## Errors
- `ValueError: fillet radius 10.0001 is too large for the edge Edge(line, ...)`: the cut backs do
  not fit on that edge.
- `ValueError: cannot normalize a zero-length vector`: `radius=0`.
- `TypeError: 'int' object is not iterable`: `vertices=(20, 10)` instead of `[(20, 10)]`.

## Example
```python
bracket = Polygon((0, 0), (40, 0), (40, 6), (6, 6), (6, 30), (0, 30))
rounded = bracket.fillet(2)                                   # every corner
inside = bracket.fillet(4, [(6, 6)])                          # only the inner corner
tab = Rectangle(30, 10).fillet(5, Rectangle(30, 10).vertices().filter(lambda v: v.x > 0))   # round right end
```

## Related
`RoundedRectangle` (all four corners), `FilletPolyline` (curves), `offset`, `Part.fillet`
(features).
