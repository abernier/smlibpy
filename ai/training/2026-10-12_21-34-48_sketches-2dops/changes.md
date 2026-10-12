diff --git a/src/smlibpy/skill/references/sketches/make_face.md b/src/smlibpy/skill/references/sketches/make_face.md
new file mode 100644
index 0000000..dd97591
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/make_face.md
@@ -0,0 +1,63 @@
+# make_face
+
+Turns a closed outline of curves into a `Sketch`, minus the regions inside further outlines
+(holes). Use it for profiles with arcs, splines or any shape the constructors do not make.
+
+## Signature
+`make_face(outer, *holes)`
+- `outer`: a closed `Wire` (`Polyline(..., close=True)`, `Wire([...])`, `wire1 + wire2`,
+  `FilletPolyline(..., close=True)`) or a closed `Edge` (`CenterArc(c, r, 0, 360)`,
+  `Spline(..., closed=True)`). A list of edges also works.
+- `holes`: more closed wires or edges, each subtracted from the region.
+
+## Returns
+A `Sketch` with the curves where they are (no centering). Collinear line segments are joined
+(a polyline through (0,0), (10,0), (20,0), ... gives one bottom edge).
+
+The plane comes from the outline:
+- Its origin is the **centroid of the outline**, not the world origin.
+- The normal ignores the winding. On a horizontal outline it is +Z. On a vertical one it
+  points to +X or +Y: a wire in the XZ plane gets normal **+Y** (Plane.XZ has -Y), a wire in
+  the YZ plane +X, a wire in the plane x + y = 0 gets (0.707, 0.707, 0). A tilted outline gets
+  the normal with positive Z.
+- `extrude(d)` follows that normal; use a negative `d` or `direction=` for the other side.
+
+## Gotchas
+- `revolve()` without an axis turns about the local Y axis through the centroid, which
+  crosses the profile: volume 0, no error. Always pass the axis:
+  `profile.revolve(Axis((0, 0, 0), (0, 0, 1)))`.
+- Holes are simply subtracted, without checks: a hole outside the outline is ignored, a hole
+  crossing the outline cuts a notch, a hole larger than the outline leaves an empty sketch,
+  overlapping holes merge, a hole in another plane is ignored. Check
+  `len(s.faces()[0].inner_wires())`.
+- A wire counts as closed when its ends are within 1e-6: a gap of 1e-7 is closed, a gap of
+  1e-3 is an open wire.
+- `Wire([...])` sorts and flips edges, so their order and direction do not matter.
+
+## Errors
+- `ValueError: a sketch region needs closed wires; use wire.close()`: the outer or a hole is
+  open (a single line, an arc, a polyline without `close=True`, a gap). `wire.close()` adds
+  the closing line.
+- `KernelError: make face failed (SM_ERR): the wire must be planar and must not cross itself`:
+  a bowtie or a non-planar outline.
+
+## Example
+```python
+outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
+bracket = make_face(outline, CenterArc((12, 12), 4, 0, 360))      # area 1200 - 16 pi
+plate = bracket.extrude(5)
+
+half = Wire([
+    Line((-25, 0), (-25, -7.5)),
+    ThreePointArc((-25, -7.5), (0, -15), (25, -7.5)),
+    Line((25, -7.5), (25, 0)),
+])
+body = make_face(half + half.mirror(Plane.XZ))
+
+profile = make_face(Polyline((5, 0, 0), (20, 0, 0), (20, 0, 3), (15, 0, 6), (15, 0, 10), (5, 0, 10), close=True))
+pulley = profile.revolve(Axis((0, 0, 0), (0, 0, 1)))                # turn about Z
+```
+
+## Related
+`Polygon` (straight outlines), `Wire.to_sketch()` (same as `make_face(wire)`), `Polyline`,
+`CenterArc`, `Spline`, `FilletPolyline` (curves), `generic`.
diff --git a/src/smlibpy/skill/references/sketches/offset.md b/src/smlibpy/skill/references/sketches/offset.md
new file mode 100644
index 0000000..68b2f8d
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/offset.md
@@ -0,0 +1,47 @@
+# Sketch.offset
+
+Grows or shrinks a sketch region by a distance: every boundary moves outward (positive) or
+inward (negative). Holes move the opposite way.
+
+## Signature
+`sketch.offset(distance, *, round=True)`
+- `distance > 0`: grow; holes shrink. `distance < 0`: shrink; holes grow. `0` returns the
+  sketch unchanged.
+- `round=True`: corners that the offset pulls apart get arcs of radius `|distance|` (convex
+  corners when growing, concave corners when shrinking). `round=False`: the sides are extended
+  to sharp corners. Corners that the offset pushes together are sharp either way.
+
+## Returns
+A new `Sketch` on the same plane. Areas match the formulas: `Rectangle(40, 20).offset(2)` is
+800 + 120·2 + 4π; `offset(2, round=False)` is 44 x 24; `offset(-2)` is 36 x 16.
+Circles, ellipses, slots and splines offset as expected (an ellipse 15 x 8 grown by 2 has a
+bbox of ±17 x ±10).
+
+## Gotchas
+- **Every edge of the result is a B-spline**, also the straight ones and the arcs.
+  `s.edges().lines()` and `.circles()` find nothing, and `s.fillet(r)` afterwards silently does
+  nothing. Fillet first and offset after (arcs grow or shrink with the offset), or build the
+  smaller shape from a constructor. Extruded, the faces are still planes and cylinders.
+- With `round=False` each grown corner keeps two short extra edges (12 edges for a grown
+  rectangle instead of 4); the shape is right.
+- Several pieces grow into each other and fuse (two circles 2 apart grown by 2 become one
+  face). Shrinking can split a region (a dumbbell with a thin bar becomes 2 faces).
+- A hole closes when the offset reaches it (a hole of radius 5 grown by 5 is gone).
+- Shrinking a region with a hole until the wall vanishes returns an empty sketch with no
+  error; shrinking a region without holes until it vanishes raises (below).
+- `outline - outline.offset(-w)` is the usual way to make a frame or gasket of width `w`.
+
+## Errors
+- `ValueError: the offset removes the whole sketch`: the inward offset is at least half the
+  smallest width (`Rectangle(40, 20).offset(-10)`). `offset(-9.9)` still works (a 20.2 x 0.2 sliver).
+
+## Example
+```python
+outline = RoundedRectangle(60, 40, 6)
+gasket = outline - outline.offset(-4)                # a 4 wide frame, inner corners radius 2
+clearance = outline.offset(0.5)                      # 0.5 larger all round
+square = Rectangle(40, 20).offset(2, round=False)    # 44 x 24, sharp corners
+```
+
+## Related
+`fillet` (round chosen corners), `Part.offset` and `shell` (3D, features), `generic`.
diff --git a/src/smlibpy/skill/references/sketches/fillet.md b/src/smlibpy/skill/references/sketches/fillet.md
new file mode 100644
index 0000000..86ecd5c
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/fillet.md
@@ -0,0 +1,56 @@
+# Sketch.fillet
+
+Rounds the corners of a sketch region with tangent arcs. Works on corners between two
+straight edges, on the outline and on holes.
+
+## Signature
+`sketch.fillet(radius, vertices=None)`
+- `radius`: the arc radius, positive.
+- `vertices`: `None` rounds every corner between two lines. Otherwise a list of corner points
+  in **world coordinates**: tuples `(x, y)` or `(x, y, z)`, or `Vertex`es, e.g. a selection
+  `s.vertices().filter(lambda v: v.x > 0)`. A single tuple must still be inside a list.
+
+## Returns
+A new `Sketch`. Lines are shortened and the arcs are real `circle` edges, so area and edges are
+exact: `Rectangle(40, 20).fillet(3)` has area 800 - (4 - π)·9.
+- Convex corners lose material; concave corners (the inside of an L, the corners of a hole)
+  gain material.
+- A corner whose neighbours are an arc or a curve is skipped (Slot, Circle, the joints of a
+  rectangle fused with a circle).
+
+## Radius limits
+Each corner cuts back `radius·tan(turn/2)` along both of its edges (`radius` at 90°). The cut
+backs on one edge must fit in it:
+- All four corners of a 40 x 20 rectangle: up to 10 (at exactly 10 the short sides vanish).
+- One corner only: up to 20 (the whole short edge).
+- Acute corners need much more room: a 50 x 5 right triangle takes radius 1, not 3.
+
+## Gotchas
+- After `offset()` the edges are B-splines, so `fillet` finds no corners and returns the sketch
+  unchanged, without an error. Fillet before offsetting.
+- A point that is not a corner is ignored silently. Check the edge count or area afterwards.
+- On a placed sketch the points are world points: on `Plane.XZ`, the corner of
+  `Rectangle(20, 10)` is `(10, 0, 5)`, not `(10, 5)`.
+- A negative radius is not rejected and produces a self-overlapping region (it even
+  extrudes). `radius=0` raises an unhelpful error.
+- Hole corners are rounded too. To round only the outline:
+  `s.fillet(r, s.faces()[0].outer_wire().vertices())`.
+- 3D parts have `Part.fillet(edges, radius)` with the arguments the other way round.
+
+## Errors
+- `ValueError: fillet radius 10.0001 is too large for the edge Edge(line, ...)`: the cut backs do
+  not fit on that edge.
+- `ValueError: cannot normalize a zero-length vector`: `radius=0`.
+- `TypeError: 'int' object is not iterable`: `vertices=(20, 10)` instead of `[(20, 10)]`.
+
+## Example
+```python
+bracket = Polygon((0, 0), (40, 0), (40, 6), (6, 6), (6, 30), (0, 30))
+rounded = bracket.fillet(2)                                   # every corner
+inside = bracket.fillet(4, [(6, 6)])                          # only the inner corner
+tab = Rectangle(30, 10).fillet(5, Rectangle(30, 10).vertices().filter(lambda v: v.x > 0))   # round right end
+```
+
+## Related
+`RoundedRectangle` (all four corners), `FilletPolyline` (curves), `offset`, `Part.fillet`
+(features).
