# make_face

Turns a closed outline of curves into a `Sketch`, minus the regions inside further outlines
(holes). Use it for profiles with arcs, splines or any shape the constructors do not make.

## Signature
`make_face(outer, *holes)`
- `outer`: a closed `Wire` (`Polyline(..., close=True)`, `Wire([...])`, `wire1 + wire2`,
  `FilletPolyline(..., close=True)`) or a closed `Edge` (`CenterArc(c, r, 0, 360)`,
  `Spline(..., closed=True)`). A list of edges also works.
- `holes`: more closed wires or edges, each subtracted from the region.

## Returns
A `Sketch` with the curves where they are (no centering). Collinear line segments are joined
(a polyline through (0,0), (10,0), (20,0), ... gives one bottom edge).

The plane comes from the outline:
- Its origin is the **centroid of the outline**, not the world origin.
- The normal ignores the winding. On a horizontal outline it is +Z. On a vertical one it
  points to +X or +Y: a wire in the XZ plane gets normal **+Y** (Plane.XZ has -Y), a wire in
  the YZ plane +X, a wire in the plane x + y = 0 gets (0.707, 0.707, 0). A tilted outline gets
  the normal with positive Z.
- `extrude(d)` follows that normal; use a negative `d` or `direction=` for the other side.

## Gotchas
- `revolve()` without an axis turns about the local Y axis through the centroid, which
  crosses the profile and raises `ModelingError: revolve: the axis crosses the region; ...`.
  Always pass the axis: `profile.revolve(Axis((0, 0, 0), (0, 0, 1)))`.
- Holes are simply subtracted, without checks: a hole outside the outline is ignored, a hole
  crossing the outline cuts a notch, a hole larger than the outline leaves an empty sketch,
  overlapping holes merge, a hole in another plane is ignored. Check
  `len(s.faces()[0].inner_wires())`.
- A wire counts as closed when its ends are within 1e-6: a gap of 1e-7 is closed, a gap of
  1e-3 is an open wire.
- `Wire([...])` sorts and flips edges, so their order and direction do not matter.

## Errors
- `ValueError: a sketch region needs closed wires; use wire.close()`: the outer or a hole is
  open (a single line, an arc, a polyline without `close=True`, a gap). `wire.close()` adds
  the closing line.
- `KernelError: make face failed (SM_ERR): the wire must be planar and must not cross itself`:
  a bowtie or a non-planar outline.

## Example
```python
outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
bracket = make_face(outline, CenterArc((12, 12), 4, 0, 360))      # area 1200 - 16 pi
plate = bracket.extrude(5)

half = Wire([
    Line((-25, 0), (-25, -7.5)),
    ThreePointArc((-25, -7.5), (0, -15), (25, -7.5)),
    Line((25, -7.5), (25, 0)),
])
body = make_face(half + half.mirror(Plane.XZ))

profile = make_face(Polyline((5, 0, 0), (20, 0, 0), (20, 0, 3), (15, 0, 6), (15, 0, 10), (5, 0, 10), close=True))
pulley = profile.revolve(Axis((0, 0, 0), (0, 0, 1)))                # turn about Z
```

## Related
`Polygon` (straight outlines), `Wire.to_sketch()` (same as `make_face(wire)`), `Polyline`,
`CenterArc`, `Spline`, `FilletPolyline` (curves), `generic`.
