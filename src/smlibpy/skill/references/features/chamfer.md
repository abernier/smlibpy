# chamfer

Bevels edges of a part with a flat face.

## Signature
`part.chamfer(edges, length)`
`chamfer(edges, length)` (finds the part the edges belong to)

- `edges`: a selection, one `Edge`, or faces (all their edges).
- `length`: the setback, measured along **both** faces from the edge. Equal on both sides,
  also where the faces are not perpendicular (an acute 26.6° edge with length 2: both new
  corners 2.000 from the old edge).
- There is no angle and no second distance: `chamfer(edge, (2, 3))` raises `TypeError`. For
  an unequal bevel, cut with a prism (`extrude` a triangle sketch placed at the edge).

## Returns
A new `Part`. Removed volume per straight 90° edge: `length² / 2 * edge length`. Concave edges
add material. Circular edges (hole rims, cylinder ends) work: a hole rim chamfer is a
countersink-like bevel.

## Limits
Same rules as `fillet` with the setback = `length`: two chamfered edges `d` apart on one face
allow `length <= d/2` (at exactly `d/2` the kernel may fail: all edges of a 10 cube with 5
raise `KernelError`), one chamfered edge `length <= d` (exactly `d` removes the whole face: one
edge of a 10 cube with 10 leaves a prism of 500). `length <= 0` raises `ValueError`. The
result is checked like a fillet's: a valid solid whose volume changed by no more than the
bevels can remove or add (not bounded where an edge runs on into an edge that is not
chamfered: the kernel extends the bevel past the end). An invalid input part raises
`ModelingError`.

## Gotchas
- Seam and smooth edges in the selection are skipped, like for `fillet`.
- Give all edges that meet at a corner in one call; the corners are then cut cleanly
  (40x30x20 box, all edges, 2: vol 23322.667 = exact polyhedron).

## Errors
- `ModelingError: chamfer: the length is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)`
- `KernelError: chamfer failed (SM_ERR): the length may be too large for the selected edges`
- `ValueError: chamfer: the length must be positive`
- `ModelingError: chamfer: the part is not a valid solid (...); check is_valid() after each step and fix the step that broke it`

## Example
```python
box = Box(40, 30, 20)
bevel = box.chamfer(box.edges().parallel_to(Z), 2)      # 2 along both faces
print(round(box.volume - bevel.volume, 3))              # 160.0 = 4 * 2*2/2 * 20

top = box.chamfer(box.faces().top(), 2)                 # all edges of the top face
also = chamfer(box.faces().top().edges(), 2)            # function form: finds the part

plate = Box(40, 40, 10) - Cylinder(5, 20)
rim = plate.edges().circles().filter(lambda e: e.center().z > 0)
plate = plate.chamfer(rim, 1.5)                         # countersink-like bevel on the hole
print(plate.is_valid(), round(plate.volume, 3))         # True 15175.73

tri = Polygon((0, 0), (40, 0), (0, 20)).extrude(10)
sharp = tri.edges().parallel_to(Z).nearest((40, 0, 0))  # acute 26.6-degree edge
tip = tri.chamfer(sharp, 2)                             # still 2 along each face
```

## Related
`fillet`, `CounterSinkHole`, `ShapeList.circles()`.
