# offset (edges and wires)

A parallel curve: an edge or a wire moved sideways in its plane, for clearance lines, walls from
their centerline, guide rails, toolpaths and grooves along free-form paths. For a region (a
sketch) use `sketches/offset`; for a solid `features/offset`.

## Signature
`edge.offset(distance, *, plane=None) -> Edge`
`wire.offset(distance, *, corners="round", plane=None) -> Wire`
The function `offset(edge_or_wire, distance, ...)` takes the same keywords (and also offsets
sketches, parts and sheets).

- `distance`: an **open** edge or wire moves to its **left** for a positive distance, to its
  right for a negative one, seen from the side the plane's normal points to (a wire in XY from
  above: a path running +X moves to +Y). A **closed** one moves **outward** for a positive
  distance, inward for a negative one, whichever way it runs (as `Sketch.offset`). 0 returns it.
- `corners` (wires): the corners the offset pulls apart: `"round"` (arcs of radius |distance|
  around the corner), `"sharp"` (the sides extended until they meet) or `"chamfer"` (a straight
  line across). At corners it pushes together, the sides are cut where they cross.
- `plane`: the plane the curve lies in, whose normal tells left from right. Default: XY at the
  curve's height for a curve at one height; else the plane it lies in with its normal toward
  +Z (+Y, then +X, for vertical planes). A straight edge that is not level needs it.

## Returns
New free edges. Lines stay lines and arcs stay arcs (exact: radius ± distance). Splines and
ellipses are offset by the kernel within 1e-6 of the wire's size, with exact end points (the
kernel's own `k.offset_curve` strays 2e-4 from the distance 3 on the spline below). Pieces meet
end to end exactly.
- `Polyline((0, 0), (40, 0), (40, 30)).offset(2)`: 2 lines, 66 long (inside the left turn).
- `.offset(-2)`: line, arc r 2, line: 70 + pi. `corners="sharp"`: 74; `"chamfer"`: 72.8284.
- `Rectangle(20, 10).wires()[0].offset(2)`: 60 + 4 pi (8 edges); `.offset(-2)`: 44.
- `CenterArc((0, 0), 5, 0, 360).offset(1).radius` = 6.
- `Spline((0, 0), (20, 8), (40, 0)).offset(3)`: starts at (-1.874, 2.343), 47.978 long.
- A closed wire of two splines offset ±1 bounds the region `Sketch.offset(±1)` gives (the areas
  agree to about 1e-6).
- A closed edge with a corner where it starts and ends (`Spline(*pts, pts[0])`) comes back from
  `edge.offset` as one closed edge: rounded at the corner where the offset pulls it apart, cut
  where its sides cross where it pushes them together (for the four points (0, 0), (20, 0),
  (25, 15), (5, 20): 88.155 long at +1, 75.427 at -1). `Wire([edge]).offset(d, corners=...)`
  gives sharp and chamfered corners there.
- Offsets are planar: a curve that does not lie in a plane raises (`ValueError`), and an offset
  that would fold over itself is refused, not trimmed (see Errors).

## Errors
- `ModelingError: offset: the bspline bends more tightly than the distance 5 near (19.63, -2.8625)
  on the side it moves to (its smallest radius of curvature is 3.9975), so its offset would fold
  over itself there; use a smaller distance`. Check `edge.min_radius()` first.
- `ModelingError: offset: moved by 5, the edges at a corner no longer meet (an edge there is
  shorter than the distance); use a smaller distance` (a U 8 wide moved 5 inward; for a closed
  wire the message adds that `Sketch.offset` of its region merges and drops parts instead).
- `ModelingError: offset: moved by 3, the wire runs into itself near (...)`: parts of the wire lie
  closer together than the distance. A wire that crosses itself may give an offset that does.
- `ValueError: offset: the wire is straight and not level, so it does not say which plane it
  moves in; pass plane=`; `ValueError: offset: the wire does not lie in a plane`.
- `ModelingError: offset: the wire has a gap of 0.1 between edge 1 and edge 2`.

## Example
```python
path = Polyline((0, 0), (40, 0), (40, 30))
inner, outer = path.offset(2), path.offset(-2, corners="sharp")
wall = make_face(Wire([*inner.edges(), Line(inner.end, outer.end), *outer.reversed().edges(),
                       Line(outer.start, inner.start)])).extrude(10)          # (Stroke does this)
rail = Spline((0, 0), (20, 8), (40, 0)).offset(3)
outline_wire = Polyline((0, 0), (40, 0), (40, 25), (0, 25), close=True)
toolpath = outline_wire.offset(-3)                    # 3 inside a closed outline
side = Spline((0, 0, 0), (10, 0, 5), (20, 0, 0)).offset(1, plane=Plane.XZ)
```

## Related
`sketches/Stroke` (the band between both offsets), `sketches/offset`, `min_radius`, `to_arcs`.
