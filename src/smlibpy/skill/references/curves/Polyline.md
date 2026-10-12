# Polyline

A chain of straight segments through points, as a `Wire`.

## Signature
`Polyline(*points, close=False)`

- `points`: two or more points, as separate arguments. 2-tuples (z = 0) or 3-tuples, world
  coordinates.
- `close=True`: adds a line from the last point back to the first.

## Returns
A `Wire` of `Line` edges in the order of the points. `Polyline(a, b, c, d)` has 3 edges and
is open; with `close=True` it has 4 edges and is closed.

## Gotchas
- **Pass the points as separate arguments.** `Polyline([(0, 0), (10, 0), (10, 5)])` with a
  list of 2 or 3 points raises `TypeError: float() argument must be ... not 'tuple'`. A list
  of 4 or more points happens to work. Use `Polyline(*pts)`.
- Repeating the first point at the end also closes the wire (no zero-length edge is added).
  Combining that with `close=True` is harmless.
- Consecutive duplicate points are dropped silently.
- Collinear points stay separate edges in the wire; `make_face` merges them into one edge.
- `Polyline(a, b, close=True)` gives a "closed" wire of two coincident lines; `make_face`
  rejects it with a `KernelError`.
- `Polyline(a, a)` returns an empty wire whose `repr` raises `IndexError`. Do not build
  polylines from unchecked point lists.
- 3D points are fine for paths: `Polyline((0, 0, 0), (0, 0, 30), (30, 0, 30))`. A sweep along
  it gives mitered corners.
- To round the corners use `FilletPolyline` or `wire.fillet(r)`.
- A closed polyline becomes a region with `make_face(wire)` or `wire.to_sketch()`. The sketch
  normal is +Z for a wire in XY (see `generic.md` for wires on other planes).

## Errors
- `ValueError: a polyline needs at least two points`.
- `ValueError: a sketch region needs closed wires; use wire.close()` from `make_face` on an
  open polyline.

## Example
```python
outline = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True)
print(len(outline.edges()), outline.is_closed, make_face(outline).area)   # 4 True 200 (to 1e-12)
path = Polyline((0, 0, 0), (0, 0, 30), (30, 0, 30))
pipe = sweep(Circle(3), path)                                              # mitered corner
pts = [(0, 0), (10, 0), (10, 5)]
step = Polyline(*pts)                                                      # unpack a list
```

## Related
`FilletPolyline`, `Line`, `Wire` (`close()`, `fillet()`), `sketches/Polygon` (a closed outline
as a sketch directly), `generic.md`.
