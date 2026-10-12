diff --git a/src/smlibpy/skill/SKILL.md b/src/smlibpy/skill/SKILL.md
index 8919067..0cc45dd 100644
--- a/src/smlibpy/skill/SKILL.md
+++ b/src/smlibpy/skill/SKILL.md
@@ -38,7 +38,8 @@ export_step(plate, "plate.step")
 - Select by geometry (`part.faces().top()`, `part.edges().parallel_to(Z).concave()`), never by
   index: indices change whenever the model changes.
 - Sketches are drawn on the XY plane around the origin, then placed with `.on(plane_or_face)`.
-  A negative extrusion from a face cuts into the part when subtracted.
+  A negative extrusion from a face cuts into the part when subtracted. Outlines with tangent
+  arcs or rounded inner corners are drawn with `Profile` (see `recipes/profiles`).
 - Errors are `ModelingError` (the input cannot work, with a hint) or `KernelError` (the kernel
   failed). Read the hint before changing the code.
 
@@ -64,7 +65,7 @@ classcad.ch account). A part made here opens in ClassCAD as a solid through STEP
 | geometry | `geometry/*` | Vector, Axis, Plane, Location, Pos, Rot, BoundBox, Align, placement methods, patterns |
 | selection | `selection/*` | ShapeList and its selectors, topology (faces, edges, vertices), Face, Edge, Vertex |
 | parts | `parts/*` | Part, primitives (Box, Cylinder, Cone, Sphere, Torus, Wedge), holes, Booleans |
-| sketches | `sketches/*` | Sketch, 2D shapes (Rectangle, Circle, Polygon, Slot, ...), make_face, 2D offset and fillet |
+| sketches | `sketches/*` | Sketch, Profile (draw outlines with tangent arcs), 2D shapes (Rectangle, Circle, Slot, Triangle, ...), Hull, Stroke, Booleans, offset, fillet and chamfer of corners, mirror |
 | curves | `curves/*` | Line, arcs, Spline, Bezier, Helix, Polyline, Wire |
 | features | `features/*` | extrude, revolve, loft, sweep, fillet, chamfer, shell, offset, mirror, split, section, thicken, draft, heal |
 | surfaces | `surfaces/*` | surface, ruled, stitch, Shell |
@@ -79,3 +80,5 @@ Each domain has a `generic.md` with the concepts; the other docs are named after
 - `recipes/verification`: what to check after each step, and how.
 - `recipes/modeling`: the patterns that work (plates, holes, bosses, revolved parts, shells,
   sweeps along helices) and the order of operations.
+- `recipes/profiles`: which 2D tool for which outline: shapes, `Profile` for tangent arcs and
+  revolve sections, half outline plus `mirror`, `Hull`, `Stroke`, `offset` for walls.
diff --git a/src/smlibpy/skill/recipes/modeling.md b/src/smlibpy/skill/recipes/modeling.md
index a9822a8..6831334 100644
--- a/src/smlibpy/skill/recipes/modeling.md
+++ b/src/smlibpy/skill/recipes/modeling.md
@@ -35,9 +35,21 @@ part = base + boss
 
 ## Revolved parts
 
-Draw the half profile in the XZ plane (or draw on XY and place it on `Plane.XZ`), with the
-axis on one edge of the profile, and revolve about that axis. A profile that crosses the axis
-makes an invalid body.
+Draw the half section beside the axis with `Profile` (on XY, then place it on `Plane.XZ` if
+the part should stand along Z), starting and ending on the axis, and revolve about that axis.
+Rounded corners go into the profile (`.fillet(r)` while drawing). A profile that crosses the
+axis raises. See `recipes/profiles` for the patterns:
+
+```python
+section = Profile((0, 0)).line_to(12, 0).line_to(y=4).fillet(1.5).line_to(x=6).line_to(y=20).line_to(x=0).close()
+bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))
+```
+
+## Outlines
+
+Standard outlines are shapes (`Rectangle(80, 50, fillet=6)`, `Slot`, `Triangle`), cutouts are
+Booleans, outlines with tangent arcs are drawn with `Profile`, symmetric ones as a half plus
+`.mirror(axis)`, walls and gaskets with `offset`. `recipes/profiles` has the table.
 
 ## Shells
 
diff --git a/src/smlibpy/skill/recipes/profiles.md b/src/smlibpy/skill/recipes/profiles.md
new file mode 100644
index 0000000..80c6f7d
--- /dev/null
+++ b/src/smlibpy/skill/recipes/profiles.md
@@ -0,0 +1,115 @@
+# Profiles: which 2D tool for which outline
+
+Most parts start as a 2D outline that is extruded or revolved. Pick the tool by the shape of
+the outline, not by habit; the right one makes the script short and the geometry exact.
+
+| the outline is | use |
+|---|---|
+| a rectangle, circle, slot, polygon, triangle, trapezoid, ellipse | the shape: `Rectangle(80, 50, fillet=6)`, `Slot(30, 8)`, `Triangle(30, 30, apex=0)` |
+| a standard shape with holes, cutouts, bosses | shapes combined: `outline - holes + tabs` |
+| made of lines and arcs drawn one after the other, with tangent arcs or rounded inner corners | `Profile(...)` |
+| a revolve section (shaft, bushing, pulley, nozzle) | `Profile` of the half section beside the axis |
+| symmetric (brackets, hooks, levers drawn by hand) | `Profile` of one half, then `.mirror(axis)` |
+| convex around circles and points (levers, links, cams) | `Hull(...)` |
+| a band of constant width along a path (slots between centers, arc slots, ribs) | `Stroke(path, width)`, `ArcSlot` |
+| a wall, gasket, clearance or frame around an outline | `offset` |
+| curves you already have (splines, edges of a part) | `make_face` |
+
+## Shapes first
+
+Every shape is centered on the origin and takes `rotation=`, `align=` and, with corners,
+`fillet=`/`chamfer=`. Cutouts are Booleans; patterns go on the right side in one call:
+
+```python
+plate = Rectangle(80, 50, fillet=6) - GridLocations(60, 30, 2, 2) * Circle(3) - Slot(30, 8)
+part = plate.extrude(6)
+```
+
+## The pen for everything with tangent arcs
+
+`Profile` draws from a start point: `line_to` (a point, or `x=`/`y=` alone for horizontal
+and vertical lines), `forward`, `arc(radius, angle)` (tangent; positive turns left),
+`arc_to(point)` (tangent) or `arc_to(point, through=...)`, and `fillet(r)`/`chamfer(d)` right
+after the move that ends at a corner. `close()` gives the Sketch.
+
+```python
+hook = (Profile((0, 0))
+        .line_to(6, 0).line_to(y=30)
+        .arc(12, 180)                 # the bend, tangent to the shank
+        .line_to(y=24)
+        .arc(3, 180)                  # round tip
+        .line_to(y=30)
+        .arc(6, -180)                 # inside of the bend
+        .line_to(0, 0)
+        .close())
+```
+
+## Revolved parts: the half section beside the axis
+
+Draw the section on one side of the axis (x >= 0 for the Y axis), starting and ending on the
+axis, and revolve about that axis. Corners that should be rounded on the part get their
+fillet in the profile; the revolve turns them into exact tori.
+
+```python
+section = (Profile((0, 0))
+           .line_to(12, 0).line_to(y=4).fillet(1.5)
+           .line_to(x=6).line_to(y=20).chamfer(1)
+           .line_to(x=0)
+           .close())
+bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))
+```
+
+When the section is itself symmetric (a pulley, a spool), draw a quarter and mirror it about
+the mid line: `.mirror(X)` before `close()`.
+
+## Symmetric outlines: half, then mirror
+
+Draw from the mirror axis around to the axis again, then `.mirror(axis).close()`. Rounded
+corners on the half are rounded on the mirror half too; where the half meets the axis at a
+right angle the two halves join without a seam.
+
+```python
+bracket = (Profile((0, 0))
+           .line_to(30, 0).line_to(y=6)
+           .line_to(x=10).fillet(4)
+           .line_to(y=30)
+           .arc(10, 90)
+           .mirror(Y)
+           .close())
+```
+
+## Levers, links, slots
+
+```python
+lever = Hull(Circle(10), Pos(60, 0) * Circle(6)) - Circle(5) - Pos(60, 0) * Circle(3)
+slot = Stroke(Line((10, 5), (40, 20)), 6)              # between two centers
+adjust = ArcSlot(40, 6, 60, rotation=15)               # along an arc around the origin
+```
+
+## Walls, gaskets, clearances
+
+```python
+outline = Rectangle(80, 50, fillet=6)
+gasket = outline.offset(3) - outline                   # 3 wide outside
+frame = outline - outline.offset(-4)                   # 4 wide inside
+clearance = outline.offset(0.2)                        # for a cutout that fits the part
+```
+
+`corners="sharp"` keeps corners square when growing; `"chamfer"` cuts them.
+
+## Corners chosen by geometry
+
+```python
+angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))
+angle = angle.fillet(4, angle.vertices().concave())     # the inside corner
+angle = angle.chamfer(1, angle.vertices().convex())     # the outside corners
+```
+
+## Check
+
+- `s.area` against a formula, `s.bbox()` against the planned size, `len(s.faces())` (pieces)
+  and `len(s.faces()[0].inner_wires())` (holes) before extruding.
+- `sorted({e.geom_type for e in s.edges()})` shows `line` and `circle` for exact outlines.
+- A `Profile` that crosses itself, a fillet that does not fit, an offset that removes
+  everything raise with the segment, corner or distance named: read the message, change that
+  number.
diff --git a/src/smlibpy/skill/references/curves/CenterArc.md b/src/smlibpy/skill/references/curves/CenterArc.md
index 314f268..88c37b4 100644
--- a/src/smlibpy/skill/references/curves/CenterArc.md
+++ b/src/smlibpy/skill/references/curves/CenterArc.md
@@ -36,7 +36,8 @@ An `Edge` with `geom_type == "circle"` (`radius`, `arc_center`, `normal` work).
 - A full circle as a sweep path is split into two halves automatically:
   `sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))` is one ring of volume 1579.14.
 - `point_at(t)` on arcs is accurate to about 1e-8 mm.
-- `mirror()` or `scale()` turn the arc into a `bspline`; `radius` then raises.
+- `mirror()` and a uniform `scale()` keep the arc a `circle` (radius and center follow); a
+  per-axis `scale((2, 1, 1))` turns it into a `bspline` (an ellipse), and `radius` then raises.
 
 ## Errors
 - `ValueError: radius must be positive` for radius <= 0.
diff --git a/src/smlibpy/skill/references/curves/Line.md b/src/smlibpy/skill/references/curves/Line.md
index 3e1753b..136c4f7 100644
--- a/src/smlibpy/skill/references/curves/Line.md
+++ b/src/smlibpy/skill/references/curves/Line.md
@@ -16,9 +16,9 @@ An `Edge` with `geom_type == "line"`, running from `start` to `end`.
 - `direction` is the unit vector start -> end; `reversed()` flips it.
 - Lines are not limited to a plane: `Line((1, 2, 3), (4, 6, 3))` is fine.
 - `Line(...).on(Plane.XZ)` keeps a line along X on world X; local Y becomes world Z.
-- `mirror()` and `scale()` turn the line into a straight `bspline` edge. It still counts as a
-  line: `direction`, `lines()`, `parallel_to` and wire fillets work; only `geom_type` and
-  `of_type("line")` see the `bspline`. `rotate`, `translate`, `.on()` keep it a line.
+- `mirror()`, `scale()`, `rotate`, `translate` and `.on()` keep it a `line`. Straight `bspline`
+  edges (from a per-axis scale of a body, or a kernel offset of a spline sketch) still count as
+  lines: `direction`, `lines()`, `parallel_to` and fillets treat them as straight.
 - Two lines with the same points are not `==`; compare `start` and `end` with `is_close`.
 - A line of 1e-9 mm is accepted. Avoid such slivers; they come from rounding errors in point
   lists.
diff --git a/src/smlibpy/skill/references/curves/Wire.md b/src/smlibpy/skill/references/curves/Wire.md
index 19534b5..25756dc 100644
--- a/src/smlibpy/skill/references/curves/Wire.md
+++ b/src/smlibpy/skill/references/curves/Wire.md
@@ -39,8 +39,9 @@ A chain of edges, open or closed. Outlines, sweep paths and loft sections are wi
   wires keep their two end points; only inner corners are rounded.
 - `vertices=[...]`: only the corners at these points (tuples or `Vertex`). A point that is
   not a corner is ignored without an error.
-- Corners next to an arc, a spline or a mirrored/scaled arc are skipped silently. Straight
-  `bspline` edges (mirrored or scaled lines) count as lines and their corners are rounded.
+- Corners next to an arc or a spline are skipped silently (`Sketch.fillet` and `Profile.fillet`
+  round line-arc corners too). Straight `bspline` edges count as lines and their corners are
+  rounded.
 - Limit: the two setbacks `r * tan(angle / 2)` on one edge may add up to its length. On a
   20 x 10 rectangle `fillet(5)` works (the short sides vanish, 6 edges), `fillet(5.001)`
   raises.
@@ -53,8 +54,8 @@ A chain of edges, open or closed. Outlines, sweep paths and loft sections are wi
   Check `is_closed`, `start` and `end`.
 - `to_sketch()` / `make_face()` choose the sketch normal themselves: +Z, or +X / +Y for
   vertical wires, not the plane the wire was drawn on. See `generic.md` for the workaround.
-- `mirror()` turns lines and arcs into `bspline` edges. Straight ones still fillet; former
-  arcs do not count as arcs.
+- `mirror()` keeps lines and arcs exact, so `half + half.mirror(Plane.XZ)` fillets every corner
+  of the whole outline.
 - `extrude(list_of_edges, h)` raises TypeError; wrap the list: `extrude(Wire(edges), h)`.
   `make_face(list_of_edges)` works.
 
diff --git a/src/smlibpy/skill/references/curves/generic.md b/src/smlibpy/skill/references/curves/generic.md
index 82b3b4b..6c73925 100644
--- a/src/smlibpy/skill/references/curves/generic.md
+++ b/src/smlibpy/skill/references/curves/generic.md
@@ -87,10 +87,10 @@ pipe = sweep(Circle(3), path)    # valid, volume = pi * 3**2 * path.length
 
 ## Gotchas
 
-- `mirror()` and `scale()` turn lines and arcs into `bspline` edges. Straight ones still count
-  as lines: `direction`, `lines()`, `Wire.fillet` and `Sketch.fillet` treat them as straight.
-  Former arcs do not count as circles: `radius` raises and fillets skip corners next to them.
-  `rotate`, `translate` and `.on()` keep lines and circles.
+- `mirror()`, a uniform `scale()`, `rotate`, `translate` and `.on()` keep lines and circles.
+  A per-axis scale turns them into `bspline` edges (straight ones still count as lines).
+- For an outline of lines and arcs drawn one after the other, `Profile` (sketches) does the
+  bookkeeping of end points and tangents: `Profile((0, 0)).line_to(20, 0).arc(5, 90).wire()`.
 - `Wire([...])` does not check that the edges connect. Edges with a gap or a branch are kept
   in the given order, and the wire is just "open". A sweep along such a path raises
   `ValueError: the sweep path is not connected: a gap of ...`. Check `wire.is_closed` for
diff --git a/src/smlibpy/skill/references/features/mirror.md b/src/smlibpy/skill/references/features/mirror.md
index 23a490c..5a50575 100644
--- a/src/smlibpy/skill/references/features/mirror.md
+++ b/src/smlibpy/skill/references/features/mirror.md
@@ -20,9 +20,10 @@ solid (14 faces for the example below, not 20).
 ## Gotchas
 - Halves that only touch fuse into one solid; halves with a gap stay two solids in one `Part`
   (check `len(part.solids())`); overlapping halves fuse normally.
-- **A mirrored sketch has its normal flipped**: `Rectangle(10, 6).translate(10, 0).mirror(Plane.YZ)`
-  has normal (0, 0, -1), so `.extrude(5)` goes to z -5..0. Mirror the extruded part instead, or
-  extrude the mirrored sketch with a negative amount.
+- A mirrored sketch keeps facing the same way when the mirror plane is perpendicular to it:
+  `Rectangle(10, 6).translate(10, 0).mirror(Plane.YZ)` has normal (0, 0, 1) and extrudes up, like
+  the original. Mirroring a sketch and extruding it gives the same part as extruding and
+  mirroring. A sketch takes an axis in its plane too: `sketch.mirror(Y)`.
 - Features on the half (fillets, holes) are mirrored with it: build the half completely, then
   mirror and fuse.
 
@@ -40,7 +41,7 @@ print(pair.bbox().size.to_tuple())                      # (40.0, 10.0, 10.0)
 copy = mirror(half, Plane.YZ.offset(30))                # a copy about x = 30 (no fuse)
 
 sk = Rectangle(10, 6).translate(10, 0).mirror(Plane.YZ)
-print(sk.plane.z_dir.to_tuple())                        # (0, 0, -1): a mirrored sketch extrudes downwards
+print(sk.plane.z_dir.to_tuple())                        # (0.0, 0.0, 1.0): extrudes up like the original
 ```
 
 ## Related
diff --git a/src/smlibpy/skill/references/geometry/mirror.md b/src/smlibpy/skill/references/geometry/mirror.md
index 3763e80..ba93a62 100644
--- a/src/smlibpy/skill/references/geometry/mirror.md
+++ b/src/smlibpy/skill/references/geometry/mirror.md
@@ -25,15 +25,15 @@ a 6-face box.
 
 ## Gotchas
 - The default plane is `Plane.XZ` (mirrors y), not YZ. Always pass the plane.
-- `mirror(X)` raises `TypeError: cannot use Axis as a plane`; a curved face raises
+- On a part, `mirror(X)` raises `TypeError: cannot use Axis as a plane`; a sketch takes an
+  axis in its own plane (`sketch.mirror(Y)`, see `sketches/mirror`). A curved face raises
   `ValueError: a cylinder face has no plane ...`; a selection of several faces raises
   `ValueError: expected exactly one shape, got 2 ...`.
-- **Mirrored sketches flip their normal** when the mirror plane is perpendicular to the
-  sketch: `Polygon(...).mirror(Plane.YZ)` gets normal -Z and `extrude(5)` goes to z -5..0.
-  `half + half.mirror(Plane.YZ)` keeps the plane of `half` (left operand) and extrudes up;
-  `half.mirror(Plane.YZ) + half` extrudes down. Put the unmirrored sketch first, or mirror
-  the extruded part instead.
-- Standalone edges (`CenterArc`, `Line`) become `bspline` edges when mirrored.
+- Sketches keep facing the same way when mirrored in a plane perpendicular to them:
+  `Polygon(...).mirror(Plane.YZ)` keeps normal +Z, so mirror and extrude commute
+  (`half.extrude(5).mirror(Plane.YZ)` equals `half.mirror(Plane.YZ).extrude(5)`).
+- Lines and circles stay lines and circles: mirrored edges, wires and sketches keep `line`
+  and `circle` types (and so `radius`, `arc_center`, fillets of their corners).
 - Not available on `ShapeList`; mirror each member.
 
 ## Example
diff --git a/src/smlibpy/skill/references/selection/convexity.md b/src/smlibpy/skill/references/selection/convexity.md
index 0d8c730..2bdf237 100644
--- a/src/smlibpy/skill/references/selection/convexity.md
+++ b/src/smlibpy/skill/references/selection/convexity.md
@@ -1,10 +1,13 @@
-# convex, concave, smooth, Edge.convexity, Edge.is_convex
+# convex, concave, smooth, Edge.convexity, Vertex.convexity, Edge.is_convex
 
-Classify edges by the corner the two faces make there.
+Classify edges of a part by the corner the two faces make there, and corners (vertices) of a
+sketch by the angle of the region there.
 
 ## Signature
-- `sl.convex()`, `sl.concave()`, `sl.smooth()`: keep edges of that kind; other shapes are dropped.
+- `sl.convex()`, `sl.concave()`, `sl.smooth()`: keep edges (and sketch vertices) of that kind;
+  other shapes are dropped.
 - `edge.convexity`: property, `"convex"`, `"concave"` or `"smooth"`.
+- `vertex.convexity`: the same for a vertex of a sketch (`ValueError` for a vertex of a part).
 - `edge.is_convex()`: a method (call it), `edge.convexity == "convex"`.
 
 ## Meaning
@@ -30,6 +33,14 @@ The test is made at the edge midpoint only.
 | block, 4 vertical edges filleted | 16 | 0 | 8 |
 | block shelled, top open | 16 | 8 | 0 |
 
+## Corners of sketches
+For a vertex of a `Sketch`: `convex` where the region's angle is below 180° (an outside
+corner), `concave` above (an inside corner, and every corner of a square hole), `smooth` where
+two edges meet tangentially (the joints of a slot, the borders of a 2D fillet).
+`Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))` (an L) has 5 convex vertices and 1
+concave one; `Rectangle(60, 40) - Rectangle(20, 10)` has 4 of each. This is how
+`sketch.fillet(r, sketch.vertices().concave())` picks corners (see `sketches/fillet`).
+
 ## Use for fillets
 - `part.fillet(part.edges().concave(), r)` rounds inside corners and adds material.
 - `part.fillet(part.edges().convex(), r)` rounds outside corners and removes material.
diff --git a/src/smlibpy/skill/references/sketches/ArcSlot.md b/src/smlibpy/skill/references/sketches/ArcSlot.md
new file mode 100644
index 0000000..63bbf9c
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/ArcSlot.md
@@ -0,0 +1,42 @@
+# ArcSlot
+
+A slot along an arc around the origin, with round ends: adjustment slots, slots on a bolt
+circle, curved guides.
+
+## Signature
+`ArcSlot(radius, width, angle, *, rotation=0, align=None)`
+- `radius`: the radius of the slot's centerline (the arc through the middle of the slot).
+- `width`: the slot width (the diameter of the round ends).
+- `angle`: the angular span of the centerline in degrees, counterclockwise from the X axis.
+- `rotation`: where the span starts (degrees counterclockwise from X): the slot covers
+  `rotation .. rotation + angle`.
+- `align=None` keeps the arc's center on the origin (so patterns and placements turn about
+  it); `Align.CENTER` centers the bbox instead.
+
+## Returns
+A `Sketch` with 4 `circle` edges (outer arc, end cap, inner arc, end cap).
+Area `radius * radians(angle) * width + pi * width**2 / 4`:
+`ArcSlot(30, 6, 90)` has area 311.0177 and bbox (-3, -3)..(33, 33).
+
+## Gotchas
+- `angle` is measured on the centerline; the round ends reach `width/2` beyond it.
+- For slots around another center: `Pos(cx, cy) * ArcSlot(...)`. On a part: `.on(face)`
+  (then the center sits on the face's centroid, see `generic`).
+- Three slots on a circle: `PolarLocations(0, 3) * ArcSlot(35, 6, 60, rotation=-30)`.
+
+## Errors
+- `ValueError: ArcSlot: a slot 8 wide needs a centerline radius above 4 (the inner edge would
+  pass the center)`.
+- `ValueError: ArcSlot: at radius 20 and width 6 the round ends meet for angles above 342.7461;
+  use a smaller angle, or a ring: Circle(r + w/2) - Circle(r - w/2)`.
+- `ValueError: ArcSlot: the angle is between 0 and 360 degrees (got 0)`.
+
+## Example
+```python
+slot = ArcSlot(30, 6, 90)                                # area 311.0177
+flange = Circle(50) - Circle(20) - PolarLocations(0, 3) * ArcSlot(35, 6, 60, rotation=-30)
+plate = flange.extrude(8)                                # 1 face with 4 holes before extruding
+```
+
+## Related
+`Slot`, `Stroke` (slots along any path), `PolarLocations` (geometry), `CenterArc` (curves).
diff --git a/src/smlibpy/skill/references/sketches/Ellipse.md b/src/smlibpy/skill/references/sketches/Ellipse.md
index 2005335..ceb61a7 100644
--- a/src/smlibpy/skill/references/sketches/Ellipse.md
+++ b/src/smlibpy/skill/references/sketches/Ellipse.md
@@ -1,11 +1,11 @@
 # Ellipse
 
-A full ellipse on the XY plane, centered on the origin, axes along X and Y.
+A full ellipse on the XY plane, centered on the origin, axes along X and Y (or turned).
 
 ## Signature
-`Ellipse(x_radius, y_radius, *, align=Align.CENTER)`
+`Ellipse(x_radius, y_radius, *, rotation=0, align=Align.CENTER)`
 Semi-axes (half widths): `x_radius` along X, `y_radius` along Y. Either may be the larger one.
-There is no rotation parameter.
+`rotation` turns it about its center (degrees counterclockwise).
 
 ## Returns
 A `Sketch` with 1 face and 1 edge of type `ellipse` (its vertex at (x_radius, 0, 0)); bbox
@@ -13,18 +13,19 @@ A `Sketch` with 1 face and 1 edge of type `ellipse` (its vertex at (x_radius, 0,
 `ellipse` edge, not a `circle`.
 
 ## Gotchas
-- Turn it with `Ellipse(15, 8).rotate(Z, 30)`; the bbox of the result is exact (±13.59 x ±10.21).
+- `Ellipse(15, 8, rotation=30)`: bbox ±13.59 x ±10.21, area 376.9911 (= pi*15*8).
+- `offset` of an ellipse goes through the kernel and returns B-spline edges; `fillet` and
+  `chamfer` cannot use its corners (there are none on a full ellipse anyway).
 - A circle stretched with `Circle(10).scale((2, 1, 1))` has the same area but a B-spline edge.
   Use `Ellipse` when the edge type matters.
 
 ## Errors
-- `KernelError: Ellipse failed (SM_ERR_INVALID_INPUT)`: a radius is zero or negative (a
-  `KernelError`, not a `ValueError`).
+- `ValueError: Ellipse: the radii must be positive (got 0, 5)`.
 
 ## Example
 ```python
 e = Ellipse(15, 8)                    # 30 wide, 16 high
-tilted = Ellipse(15, 8).rotate(Z, 30)
+tilted = Ellipse(15, 8, rotation=30)
 boss = e.extrude(5)                   # 3 faces, volume pi*15*8*5
 ```
 
diff --git a/src/smlibpy/skill/references/sketches/Hull.md b/src/smlibpy/skill/references/sketches/Hull.md
new file mode 100644
index 0000000..7436071
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Hull.md
@@ -0,0 +1,42 @@
+# Hull
+
+The convex hull of points and shapes: the region a string pulled tight around them encloses.
+Around circles and arcs the outline follows the arcs exactly, joined by tangent lines. The
+usual way to draw levers, links, cam outlines and tapered slots.
+
+## Signature
+`Hull(*items)`
+- `items`: points (tuples, `Vector`, `Vertex`), edges, wires, sketches or faces, or lists of
+  them. Points need z = 0 (or the plane of the first sketch given).
+
+## Returns
+A `Sketch` with exact `line` and `circle` edges, on the plane of the first sketch given (XY
+otherwise). Nothing is centered.
+- `Hull(Circle(10), Pos(60, 0) * Circle(6))`: 2 arcs and 2 tangent lines, area 1175.7623
+  (closed form 1175.7624).
+- `Hull(Rectangle(20, 10), Pos(20, 0) * Circle(5))`: 339.2699 = 300 + 12.5*pi.
+- `Hull((0, 0), (10, 0), (5, 8), (5, 2))`: the triangle, area 40; inner points drop out.
+- `Hull(CenterArc((0, 0), 10, 0, 180), (0, -5))`: only the arc's span counts: 207.0796.
+- A sketch's holes and concave parts are ignored (the L of `Polygon`: area 848).
+
+## Gotchas
+- Holes come afterwards: `Hull(...) - Circle(5) - Pos(60, 0) * Circle(3)`.
+- Splines and ellipses are not supported (error); hull points along them instead.
+- All points on one line have no hull (error).
+
+## Errors
+- `ModelingError: Hull: the hull has no area: all the points lie on one line`.
+- `ModelingError: Hull: the bspline (0, 0) -> (20, 0) is neither a line nor a circular arc; ...`.
+- `TypeError: Hull: a Part has no outline in a plane; use part.section(plane) or a face`.
+- `ValueError: Hull: the point (10, 0, 5) is not in the plane of the hull`.
+
+## Example
+```python
+lever = Hull(Circle(10), Pos(60, 0) * Circle(6)) - Circle(5) - Pos(60, 0) * Circle(3)
+link = Hull(Circle(8), Pos(40, 0) * Circle(8), Pos(20, 30) * Circle(5))
+link = link - [Circle(4), Pos(40, 0) * Circle(4), Pos(20, 30) * Circle(2.5)]   # 1 face, 3 holes
+tapered_slot = Hull(Circle(3), Pos(25, 0) * Circle(5))
+```
+
+## Related
+`Stroke` (bands of constant width), `Slot`, `Profile`, `offset`.
diff --git a/src/smlibpy/skill/references/sketches/Polygon.md b/src/smlibpy/skill/references/sketches/Polygon.md
index fad566b..bbf63ba 100644
--- a/src/smlibpy/skill/references/sketches/Polygon.md
+++ b/src/smlibpy/skill/references/sketches/Polygon.md
@@ -4,11 +4,12 @@ The straight-edged region through a list of points. Unlike the other constructor
 points stay where you give them.
 
 ## Signature
-`Polygon(*points, align=None)`
+`Polygon(*points, fillet=0, chamfer=0, align=None)`
 Points as varargs `Polygon((0, 0), (30, 0), (0, 20))` or one list `Polygon(pts)`; tuples or
 `Vector`s. The outline is closed automatically; repeating the first point at the end changes
-nothing. `align=None` (default) leaves the points in place; `Align.CENTER` moves the bbox center
-to the origin, `Align.MIN` the lower left of the bbox.
+nothing. `align=None` (default) leaves the points in place; `Align.CENTER` (or `"center"`)
+moves the bbox center to the origin, `Align.MIN` the lower left of the bbox.
+`fillet` / `chamfer` round or bevel every corner (2D points only).
 
 ## Returns
 A `Sketch` with one line edge per side, normal +Z.
@@ -24,10 +25,16 @@ A `Sketch` with one line edge per side, normal +Z.
 - An outline that touches itself at one corner becomes 2 faces.
 - `sketch.plane.origin` is the world origin, so `revolve()` without an axis turns about the
   world Y axis. Still pass the axis explicitly.
-- For rounded corners use `Polygon(...).fillet(r)` or `FilletPolyline` + `make_face`.
+- Rounded corners: `Polygon(..., fillet=r)` for all of them (the L below: 12 edges, area
+  492.5664), `Polygon(...).fillet(r, corners)` for some. Outlines with arcs: `Profile`.
+- Points in the middle of a straight side are merged before the corners are rounded, so they
+  get no fillet.
 
 ## Errors
 - `ValueError: a polygon needs at least three points`.
+- `ValueError: Polygon: fillet=3 at (50, 0) does not fit: it needs 60.1496 along the line
+  (0, 0) -> (50, 0), which is 50 long; use a smaller radius`: an acute corner.
+- `ValueError: Polygon: corner options need 2D points (z = 0); ...`.
 - `KernelError: sketch failed (SM_ERR)`: the outline crosses itself (bowtie), all points are
   collinear, or 3D points are not coplanar. There is no hint; check the point order.
 
@@ -36,7 +43,9 @@ A `Sketch` with one line edge per side, normal +Z.
 profile = Polygon((0, 0), (30, 0), (30, 10), (10, 25), (0, 25))   # area 600, bbox 0..30 x 0..25
 rib = profile.on(Plane.XZ).extrude(4)                             # stands up in XZ, 4 thick toward -Y
 centered = Polygon((10, 10), (20, 10), (15, 20), align=Align.CENTER)
+angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30), fillet=2)   # area 492.5664
 ```
 
 ## Related
-`RegularPolygon`, `Trapezoid`, `make_face` (outlines with arcs), `fillet`, `Polyline` (curves).
+`Profile` (outlines with arcs), `RegularPolygon`, `Triangle`, `Trapezoid`, `make_face`, `fillet`,
+`Polyline` (curves).
diff --git a/src/smlibpy/skill/references/sketches/Profile.md b/src/smlibpy/skill/references/sketches/Profile.md
new file mode 100644
index 0000000..86cbe0e
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Profile.md
@@ -0,0 +1,109 @@
+# Profile
+
+A pen that draws one outline in the XY plane, segment by segment, with exact lines and arcs.
+Use it for outlines that are awkward as unions of shapes: revolve sections, brackets with
+rounded inner corners, anything with tangent arcs, sweep paths.
+
+## Signature
+`Profile(start=(0, 0), *, heading=0)`
+- `start`: a 2D point. `heading`: the direction the pen moves in, degrees counterclockwise
+  from +X (90 = +Y, -90 = -Y).
+- Every call returns a **new** Profile; the old one is unchanged, so variants can branch from
+  a common start.
+
+## Moves
+| call | draws |
+|---|---|
+| `line_to(x, y)` / `line_to((x, y))` | a line to the point |
+| `line_to(x=30)` / `line_to(y=5)` | a line to that x (y stays: horizontal) or that y (vertical) |
+| `line_by(dx, dy)` | a line by an offset |
+| `forward(length)` | a line along the heading |
+| `forward(x=30)` / `forward(y=5)` | along the heading until x (or y) reaches the value |
+| `turn(angle)` / `turn_to(heading)` | no drawing: the next segment starts at a corner |
+| `arc(radius, angle)` | tangent arc; positive angle turns left, negative right; `arc(3, 180)` is a U-turn |
+| `arc_to(x, y)` | tangent arc ending at the point |
+| `arc_to(x, y, through=(px, py))` | arc through a point (not tangent: a corner at its start if the heading differs) |
+| `fillet(radius)` / `chamfer(length)` | round or bevel the corner **at the pen**: between the segment just drawn and the next one |
+| `mirror(axis)` | append the mirror image of everything drawn, so the whole outline is symmetric |
+
+After a line the heading is the line's direction, after an arc its end tangent. `p.point`
+(Vector) and `p.heading` (degrees, -180..180) say where the pen is; `len(p)` counts segments.
+
+## Results
+- `close(*, align=None)` -> `Sketch` on XY: a straight line goes back to the start if the pen
+  is not there. The outline stays where it was drawn (`align` moves it, e.g. `Align.CENTER`).
+  Drawing clockwise is fine.
+- `wire()` -> open `Wire` of `line` and `circle` edges, for `sweep` paths and `Stroke`.
+- A Profile is not a shape: `profile.extrude(5)` raises `AttributeError: ... Call .close()
+  for the region (a Sketch) or .wire() for the open path`.
+
+## Corners
+- `fillet(r)` / `chamfer(d)` right after the move that ends at the corner. Called before the
+  first move, they round the **start** corner (between the closing line and the first
+  segment).
+- Corners between lines and arcs work too (exact tangent arcs). A corner where the segments
+  meet tangentially has nothing to round: error.
+- `chamfer(d)` cuts back `d` along both segments (measured along them) and joins the points.
+
+## mirror(axis)
+- `axis`: `X`, `Y` or `Axis((x, y), direction)` in the XY plane.
+- Draw half the outline from the axis back to the axis, then `.mirror(Y).close()`. An end that
+  is off the axis is joined straight across to its mirror image (a half drawn from (5, 0) to
+  (5, 10) closes with lines across the axis).
+- Corners rounded on the half are rounded on the mirror half too. Where the half meets the
+  axis at a right angle, the two lines merge into one edge.
+- The result is still a Profile: close it, or draw on.
+
+## Gotchas
+- The pen draws in XY. Place the result: `section.close().on(Plane.XZ)`.
+- `line_to(x=30)` keeps y; `forward(x=30)` follows the heading (same only for heading 0/180).
+- `turn` changes only the heading for `forward`, `arc` and `arc_to(x, y)`; `line_to`
+  ignores it.
+- `close()` checks the outline: a crossing, a touching, or a doubling back raises and names
+  both segments by the call that drew them.
+- Errors give sizes in plain numbers: `fillet(20) at (10, 0) does not fit: it needs 20 along
+  segment 1, line_to(10, 0), which is 10 long; use a smaller radius`.
+
+## Errors
+- `ModelingError: Profile: the outline crosses or touches itself at (3.3333, 0): segment 1,
+  line_to(10, 0) meets segment 3, line_to(0, -5); ...`
+- `ModelingError: Profile: fillet(2) at (10, 0): the segments meet tangentially there, so there
+  is no corner; leave the fillet out`
+- `ModelingError: forward(x=-5): x = -5 lies behind the pen (it is at x = 10, heading 0
+  degrees); turn first, or use line_to`; `forward(y=5)` at heading 0: parallel, never reached.
+- `ModelingError: arc_to(20, 0): the point lies straight ahead on the heading 0 degrees, so the
+  tangent arc would be a straight line; use line_to, ...` (straight behind: no arc reaches it).
+- `ValueError: line_to(10, 0): the segment has no length (the pen is already at (10, 0))`.
+- `ModelingError: fillet(2) at (10, 0): the end of an open path is not a corner; ...` from `wire()`.
+- `ModelingError: mirror: the last segment runs along the mirror axis; ...`
+
+## Example
+```python
+section = (Profile((0, 0))
+           .line_to(12, 0).line_to(y=4).fillet(1.5)
+           .line_to(x=6).line_to(y=20).chamfer(1)
+           .line_to(x=0)
+           .close())
+bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))     # area 143.0171, volume 3565.9232
+
+bracket = (Profile((0, 0))
+           .line_to(30, 0).line_to(y=6)
+           .line_to(x=10).fillet(4)
+           .line_to(y=30)
+           .arc(10, 90)
+           .mirror(Y)
+           .close())                                      # 60 x 40, area 1003.9469, 10 edges
+
+u_turn = Profile((0, -3)).forward(20).arc(3, 180).forward(20).arc(3, 180).close()   # a slot, 20*6 + 9*pi
+path = Profile((0, 0)).line_to(20, 0).fillet(5).line_to(20, 20).wire()
+pipe = sweep(Circle(1), path)                             # volume = pi * path.length = 118.9218
+
+base = Profile((0, 0)).line_to(20, 0).line_to(20, 10)
+square = base.line_to(0, 10).close()                      # 200
+round_top = base.arc_to(0, 10).close()                    # 357.0796, base is unchanged
+```
+
+## Related
+`recipes/profiles` (which tool for which outline), `Stroke` (a band along `wire()`),
+`fillet`, `chamfer`, `mirror` (whole sketches), `make_face` (outlines from curve edges),
+`Sketch.revolve` (features).
diff --git a/src/smlibpy/skill/references/sketches/Rectangle.md b/src/smlibpy/skill/references/sketches/Rectangle.md
index 744dfe0..bab643b 100644
--- a/src/smlibpy/skill/references/sketches/Rectangle.md
+++ b/src/smlibpy/skill/references/sketches/Rectangle.md
@@ -1,40 +1,50 @@
 # Rectangle
 
-A `width` by `height` rectangle on the XY plane, centered on the origin.
+A `width` by `height` rectangle on the XY plane, centered on the origin, with optional
+rounded or beveled corners.
 
 ## Signature
-`Rectangle(width, height, *, align=Align.CENTER)`
-`width` runs along X, `height` along Y. There is no `rotation` parameter.
+`Rectangle(width, height, *, fillet=0, chamfer=0, rotation=0, align=Align.CENTER)`
+- `width` runs along X, `height` along Y.
+- `fillet`: round all four corners with this radius. `chamfer`: bevel them by this length.
+  One or the other, at most half the shorter side.
+- `rotation`: degrees counterclockwise about the center. `align` works on the turned outline.
 
 ## Returns
-A `Sketch` with 1 face and 4 line edges; bbox `-width/2..width/2` by `-height/2..height/2`, normal +Z.
+A `Sketch`, normal +Z. Plain: 4 line edges, bbox `±width/2` by `±height/2`.
+- `fillet=r`: 8 edges (4 lines, 4 `circle` arcs), area `w*h - (4 - pi)*r**2`
+  (`Rectangle(80, 50, fillet=6)`: 3969.0973).
+- `fillet` = half the shorter side: the short sides vanish, a stadium of 4 edges
+  (`Rectangle(40, 20, fillet=10)`: area 714.1592, the same region as `Slot(40, 20)`).
+- `chamfer=c`: 8 lines, area `w*h - 2*c**2` (`Rectangle(40, 20, chamfer=3)`: 782).
+- `rotation=30`: bbox ±22.32 x ±18.66, still 4 lines.
 
 ## align
 One value for both axes or one per axis (`Align`, `"min"`/`"center"`/`"max"`, or `None`):
 - `Align.MIN`: lower left corner on the origin (0..w, 0..h).
 - `Align.MAX`: upper right corner on the origin (-w..0, -h..0).
 - `(Align.MIN, Align.CENTER)`: x 0..w, y centered. `None` for an axis leaves it centered.
-- A third value is ignored.
 
 ## Gotchas
-- To turn it, rotate the result: `Rectangle(40, 20).rotate(Z, 30)` or `Rot(z=30) * Rectangle(40, 20)`.
-  `align` is applied before you rotate.
+- `RoundedRectangle(w, h, r)` is the older name of `Rectangle(w, h, fillet=r)`.
+- To round only some corners: `s.fillet(r, s.vertices().filter(...))` (see `fillet`).
 - `align` also moves `sketch.plane.origin` (to the rectangle's center). `revolve()` without
   an axis turns about the local Y axis through that origin, which crosses the rectangle and
   raises; pass the axis.
 
 ## Errors
-- `ValueError: rectangle sides must be positive`: a side is zero or negative.
-- `TypeError: Rectangle() got an unexpected keyword argument 'rotation'`.
+- `ValueError: rectangle sides must be positive`.
+- `ValueError: Rectangle: fillet=11 is more than half the shorter side (10)` (also for chamfer).
+- `ValueError: Rectangle: give fillet= or chamfer=, not both`.
 
 ## Example
 ```python
-plate = Box(60, 40, 10)
-pocket = Rectangle(30, 20).on(plate.faces().top()).extrude(-4)
-plate = plate - pocket                                   # volume 24000 - 2400
-corner = Rectangle(40, 20, align=Align.MIN)              # bbox (0, 0)..(40, 20)
-turned = Rectangle(40, 20).rotate(Z, 30)                 # bbox ±22.32 x ±18.66
+plate = Rectangle(80, 50, fillet=6)                      # area 3969.0973
+block = Box(60, 40, 10)
+pocket = Rectangle(30, 20, chamfer=2).on(block.faces().top()).extrude(-4)
+corner = Rectangle(40, 20, fillet=4, align=Align.MIN)    # bbox (0, 0)..(40, 20)
+turned = Rectangle(40, 20, rotation=30)                  # bbox ±22.32 x ±18.66
 ```
 
 ## Related
-`RoundedRectangle`, `Polygon`, `generic` (Booleans, placing), `Box`.
+`Slot`, `Polygon`, `Triangle`, `fillet` and `chamfer` (chosen corners), `generic`, `Box`.
diff --git a/src/smlibpy/skill/references/sketches/RegularPolygon.md b/src/smlibpy/skill/references/sketches/RegularPolygon.md
index a25a244..28ce874 100644
--- a/src/smlibpy/skill/references/sketches/RegularPolygon.md
+++ b/src/smlibpy/skill/references/sketches/RegularPolygon.md
@@ -3,12 +3,14 @@
 A regular polygon with `sides` corners, centered on the origin.
 
 ## Signature
-`RegularPolygon(radius, sides, *, inscribed=False, rotation=0.0, align=Align.CENTER)`
+`RegularPolygon(radius, sides, *, inscribed=False, fillet=0, chamfer=0, rotation=0.0, align=Align.CENTER)`
 - `radius`: distance from the center to the corners (circumscribed circle).
 - `inscribed=True`: `radius` is the distance to the middle of the sides instead. For a hexagon
   measured across flats: `RegularPolygon(flats / 2, 6, inscribed=True)`.
 - `sides`: an `int` (3 or more).
 - `rotation`: degrees counter-clockwise about the center.
+- `fillet` / `chamfer`: round or bevel every corner (`RegularPolygon(10, 6, fillet=1)`: 12 edges,
+  area 259.4851).
 
 ## Returns
 A `Sketch`. The first corner is on +X at `rotation=0`.
@@ -35,6 +37,7 @@ A `Sketch`. The first corner is on +X at `rotation=0`.
 nut = RegularPolygon(6.5, 6, inscribed=True) - Circle(3.4)   # M6 nut: 13 across flats
 hex_up = RegularPolygon(10, 6, rotation=30)                  # corners at (0, ±10)
 square = RegularPolygon(10, 4, inscribed=True, rotation=45)  # 20 x 20, axis aligned
+soft_nut = RegularPolygon(6.5, 6, inscribed=True, chamfer=0.5)  # area 145.7088
 ```
 
 ## Related
diff --git a/src/smlibpy/skill/references/sketches/RoundedRectangle.md b/src/smlibpy/skill/references/sketches/RoundedRectangle.md
index 66f685a..b9b903d 100644
--- a/src/smlibpy/skill/references/sketches/RoundedRectangle.md
+++ b/src/smlibpy/skill/references/sketches/RoundedRectangle.md
@@ -1,38 +1,26 @@
 # RoundedRectangle
 
-A rectangle with all four corners rounded to the same radius, centered on the origin.
+The older name of a rectangle with all four corners rounded: `RoundedRectangle(w, h, r)` is
+`Rectangle(w, h, fillet=r)`. Write new code with `Rectangle(..., fillet=r)`.
 
 ## Signature
 `RoundedRectangle(width, height, radius, *, align=Align.CENTER)`
-`width` along X, `height` along Y, `radius` of the corner arcs. `align` as for `Rectangle`.
 
 ## Returns
-A `Sketch`, bbox `±width/2` by `±height/2`, 8 edges (4 lines, 4 quarter arcs).
-Area `width*height - (4 - pi)*radius**2`.
+The same `Sketch` as `Rectangle(width, height, fillet=radius, align=align)`: bbox `±width/2`
+by `±height/2`, 8 edges (4 lines, 4 quarter arcs), area `width*height - (4 - pi)*radius**2`.
 
 ## Radius limits
-- `0 < radius < min(width, height)/2`: the normal case.
-- `radius == min(width, height)/2`: allowed. The short sides vanish: a stadium (6 edges, same
-  area as `Slot(width, height)`), or a full circle of 4 arcs for a square.
-- `radius > min(width, height)/2`, even by 1e-7: `ValueError`.
-- `radius <= 0`: a plain `Rectangle`, no error. A negative radius is not caught.
-
-## Gotchas
-- For a stadium, prefer `Slot(length, width)`: 4 edges instead of 6.
-- Only all four corners at one radius. For different radii or some corners, use
-  `Rectangle(...).fillet(r, vertices=[...])` (see `fillet`).
-
-## Errors
-- `ValueError: corner radius is larger than half the shorter side`. Also raised for a zero
-  width with a positive radius.
-- `ValueError: rectangle sides must be positive`: zero or negative side with `radius <= 0`.
+- `radius == min(width, height)/2`: the short sides vanish (a stadium of 4 edges).
+- `radius > min(width, height)/2`: `ValueError: corner radius is larger than half the shorter
+  side` (`Rectangle(..., fillet=...)` says which side).
+- `radius <= 0`: a plain `Rectangle`, no error (`Rectangle(..., fillet=-1)` raises instead).
 
 ## Example
 ```python
-outline = RoundedRectangle(80, 50, 8)                    # area 4000 - (4 - pi) * 64
-plate = (outline - GridLocations(64, 34, 2, 2) * Circle(3)).extrude(6)
-stadium = RoundedRectangle(40, 20, 10)                   # same region as Slot(40, 20)
+outline = RoundedRectangle(80, 50, 6)                    # area 3969.0973
+same = Rectangle(80, 50, fillet=6)                       # the new spelling
 ```
 
 ## Related
-`Rectangle`, `Slot`, `fillet` (round chosen corners), `offset`.
+`Rectangle`, `Slot`, `fillet`.
diff --git a/src/smlibpy/skill/references/sketches/Slot.md b/src/smlibpy/skill/references/sketches/Slot.md
index 8f9ec15..f6e5b42 100644
--- a/src/smlibpy/skill/references/sketches/Slot.md
+++ b/src/smlibpy/skill/references/sketches/Slot.md
@@ -1,7 +1,7 @@
 # Slot
 
 An obround (stadium): two half circles joined by straight sides, centered on the origin and
-lying along X.
+lying along X. For the other slots see the table.
 
 ## Signature
 `Slot(length, width, *, rotation=0.0, align=Align.CENTER)`
@@ -12,17 +12,20 @@ lying along X.
 
 ## Returns
 A `Sketch` with 4 edges (line, arc, line, arc). The arc centers are at x = ±(length - width)/2.
-Area `(length - width)*width + pi*width**2/4`.
+Area `(length - width)*width + pi*width**2/4` (`Slot(30, 8)`: 226.2655).
 
-## Variants
-smlibpy has only this one slot. Build the others from it:
-- Center-to-center distance `c`: `Slot(c + w, w)`.
-- From point `p` to point `q`: `Pos((p + q) / 2) * Slot((q - p).length + w, w, rotation=angle)`,
-  `angle = math.degrees(math.atan2(dy, dx))`.
-- Arc slot: `make_face` of a wire of four `CenterArc`s (example below).
+## Which slot
+| slot | call |
+|---|---|
+| straight, overall length, centered | `Slot(length, width)` |
+| center-to-center distance `c` | `Slot(c + width, width)` |
+| between two centers `a` and `b` (anywhere) | `Stroke(Line(a, b), width)` |
+| along an arc around the origin | `ArcSlot(radius, width, angle, rotation=start)` |
+| along any path of lines and arcs | `Stroke(path, width)` |
 
 ## Gotchas
 - `length <= width` (or a negative length) silently gives a `Circle` of diameter `width`.
+- `Rectangle(length, width, fillet=width / 2)` is the same region with 4 edges too.
 
 ## Errors
 - `ValueError: radius must be positive`: `width` is zero or negative.
@@ -32,20 +35,10 @@ smlibpy has only this one slot. Build the others from it:
 ```python
 plate = Box(60, 40, 8)
 cut = plate - Slot(30, 8, rotation=90).on(plate.faces().top()).extrude(-8)   # vertical through slot
-
-c2c = Slot(20 + 6, 6)                       # arc centers at x = -10 and 10
-
-R, w = 30, 6                                # arc slot: centerline radius 30, 0..90 degrees
-ri, ro = R - w / 2, R + w / 2
-outline = Wire([
-    CenterArc((0, 0), ro, 0, 90),
-    CenterArc((0, R), w / 2, 90, 180),
-    CenterArc((0, 0), ri, 90, -90),
-    CenterArc((R, 0), w / 2, 180, 180),
-])
-arc_slot = make_face(outline)
+c2c = Slot(20 + 6, 6)                                   # arc centers at x = -10 and 10
+between = Stroke(Line((10, 5), (40, 20)), 6)            # centers (10, 5) and (40, 20), area 229.5205
 ```
 
 ## Related
-`RoundedRectangle` (`radius = width/2` is the same region, 6 edges), `Circle`, `make_face`,
-`CenterArc` (curves).
+`ArcSlot`, `Stroke`, `Rectangle` (`fillet=width/2`), `Circle`, `Hull` (tapered slots between
+circles of different sizes).
diff --git a/src/smlibpy/skill/references/sketches/Stroke.md b/src/smlibpy/skill/references/sketches/Stroke.md
new file mode 100644
index 0000000..922bb60
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Stroke.md
@@ -0,0 +1,47 @@
+# Stroke
+
+The region a pen of a given width covers along a path of lines and arcs: a slot between two
+centers, a slot along an arc, a rib or web from its centerline, a track.
+
+## Signature
+`Stroke(path, width, *, ends="round", corners="round")`
+- `path`: an `Edge` or a `Wire` of lines and arcs: `Line(a, b)`, `CenterArc(...)`,
+  `Polyline(...)`, `Profile(...).wire()`. It must be connected and lie in one plane.
+- `width`: the full width; the region reaches `width/2` to each side of the path.
+- `ends`: `"round"` (half circles around the end points) or `"flat"` (cut square at the end
+  points, no extension).
+- `corners`: the outside of each bend of the path: `"round"`, `"sharp"` (sides extended until
+  they meet) or `"chamfer"` (cut straight across). The inside of a bend is always sharp.
+
+## Returns
+A `Sketch` on the path's plane (a path in XY gives a sketch on XY), with exact lines and arcs.
+- `Stroke(Line((10, 5), (40, 20)), 6)`: area 229.5205 = length*6 + 9*pi.
+- Path `line 20, arc r 10 over 90°, line up 15` (length 50.708), width 4: area 215.3982 with
+  round ends, 202.8319 with flat ends (= length*width).
+- An L of two 20 mm legs, width 4, flat ends: 159.1416 round, 160 sharp, 158 chamfered corner.
+- A closed path gives a ring: `Stroke(CenterArc((0, 0), 10, 0, 360), 2)` = 1 face, 1 hole,
+  area 125.6637.
+- A path that crosses itself gives one region; enclosed areas become holes.
+
+## Gotchas
+- `Profile` paths: pass `profile.wire()`, not the Profile.
+- An arc tighter than half the width fills its center (no inner edge).
+- Splines and ellipses are not supported: build such bands with `offset` of a region, or
+  approximate the path with arcs.
+
+## Errors
+- `ModelingError: Stroke: the path has a gap of 1 between edge 1 and edge 2`.
+- `ModelingError: Stroke: edge 1 of the path is a bspline; Stroke works on paths of lines and arcs`.
+- `TypeError: Stroke: the path is an Edge or a Wire, not a Profile (call .wire() on a Profile)`.
+- `ValueError: Stroke: the width must be positive (got 0.0)`.
+
+## Example
+```python
+between = Stroke(Line((10, 5), (40, 20)), 6)            # a slot between two centers
+path = Profile((0, 0)).line_to(20, 0).arc(10, 90).line_to(y=25).wire()
+band = Stroke(path, 4)                                   # area 215.3982
+rib = Stroke(Polyline((0, 0), (30, 0), (30, 20)), 3, ends="flat", corners="sharp").extrude(10)   # volume 1500
+```
+
+## Related
+`Slot`, `ArcSlot`, `Profile` (`wire()`), `offset` (bands around regions), `Hull`.
diff --git a/src/smlibpy/skill/references/sketches/Trapezoid.md b/src/smlibpy/skill/references/sketches/Trapezoid.md
index df5ed58..e546c3f 100644
--- a/src/smlibpy/skill/references/sketches/Trapezoid.md
+++ b/src/smlibpy/skill/references/sketches/Trapezoid.md
@@ -3,11 +3,12 @@
 A trapezoid with its base on the bottom, centered on the origin.
 
 ## Signature
-`Trapezoid(width, height, left_angle, right_angle=None, *, align=Align.CENTER)`
+`Trapezoid(width, height, left_angle, right_angle=None, *, fillet=0, chamfer=0, rotation=0, align=Align.CENTER)`
 - `width`: length of the base (bottom side, at y = -height/2).
 - `height`: distance from base to top (top side at y = +height/2).
 - `left_angle`, `right_angle`: interior angles at the base corners in degrees.
-  `right_angle=None` uses `left_angle` (symmetric).
+  `right_angle=None` uses `left_angle` (symmetric). Both between 0 and 180.
+- `fillet` / `chamfer`: round or bevel the four corners; `rotation`: degrees about the center.
 
 ## Returns
 A `Sketch` with 4 line edges. The base runs from x = -width/2 to +width/2; the top is
@@ -19,14 +20,12 @@ A `Sketch` with 4 line edges. The base runs from x = -width/2 to +width/2; the t
 ## Gotchas
 - Default `align` centers the base and the height, not the bbox. `align=(Align.CENTER, Align.MIN)`
   stands it on the X axis.
-- Angle 180 gives a degenerate sketch (area 0, bbox ±1e17) without an error. A negative
-  angle `a` acts as `180 + a`; a negative height turns it upside down.
 - A triangle (the sides meeting exactly at the top) is rejected; use `Polygon`.
 
 ## Errors
 - `ValueError: the sides cross below the given height`: the top length would be zero or less.
-- `ZeroDivisionError`: an angle of 0.
-- `KernelError: sketch failed (SM_ERR)`: height 0.
+- `ValueError: Trapezoid: left_angle must be between 0 and 180 degrees (got 0)` (also 180).
+- `ValueError: Trapezoid: width and height must be positive (got 40, 0)`.
 
 ## Example
 ```python
@@ -34,6 +33,7 @@ t = Trapezoid(40, 15, 60)                       # top 22.68 long, area 470.1
 dovetail = Trapezoid(40, 15, 120)               # top 57.32 long
 ramp = Trapezoid(40, 15, 60, 90, align=(Align.CENTER, Align.MIN))   # right side vertical, base on y = 0
 rail = ramp.on(Plane.XZ).extrude(100)           # base on z = 0, 100 long toward -Y
+soft = Trapezoid(40, 15, 60, fillet=2)          # area 464.1874
 ```
 
 ## Related
diff --git a/src/smlibpy/skill/references/sketches/Triangle.md b/src/smlibpy/skill/references/sketches/Triangle.md
new file mode 100644
index 0000000..8da987f
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Triangle.md
@@ -0,0 +1,43 @@
+# Triangle
+
+A triangle given by its base and height, centered on its bounding box. Right, isosceles and
+oblique triangles from one signature.
+
+## Signature
+`Triangle(width, height, *, apex=None, fillet=0, chamfer=0, rotation=0, align=Align.CENTER)`
+- `width`: the base, along X at the bottom. `height`: how far the top corner is above it.
+- `apex`: the x position of the top corner, measured from the **left end of the base**.
+  `None` (default): the middle, an isosceles triangle. `0`: a right angle at the left end.
+  `width`: a right angle at the right end. Outside 0..width: an obtuse triangle.
+- `fillet` / `chamfer`: round or bevel all three corners. `rotation`: degrees about the center.
+
+## Returns
+A `Sketch` with 3 line edges, area `width*height/2`, centered on its bbox.
+- `Triangle(40, 20)`: bbox ±20 x ±10, area 400.
+- `Triangle(30, 40, apex=0)`: corners (-15, -20), (15, -20), (-15, 20); the right angle is at
+  (-15, -20). Area 600.
+- `Triangle(30, 20, apex=-10)`: bbox x -20..20 (the apex overhangs the base), area 300.
+- `Triangle(20, 20 * math.sqrt(3) / 2)`: equilateral, side 20, area 173.2051.
+- `Triangle(30, 30, apex=0, fillet=2)`: 6 edges (3 arcs), area 439.2527.
+
+## Gotchas
+- The bbox center is on the origin, not the centroid. Use `align=(Align.MIN, Align.MIN)` to
+  put the lower left of the bbox on the origin.
+- A triangle from three points: `Polygon(p1, p2, p3)`.
+- Acute corners need long cut-backs for a fillet: `radius / tan(angle / 2)` along each side
+  (11.34 for a 2 mm fillet at a 20° corner).
+
+## Errors
+- `ValueError: Triangle: width and height must be positive (got 10, 0)`.
+- `ValueError: Triangle: fillet=... at (...) does not fit: it needs ... along the line ...,
+  which is ... long; use a smaller radius`.
+
+## Example
+```python
+gusset = Triangle(30, 30, apex=0, fillet=2)             # area 439.2527
+rib = gusset.on(Plane.XZ).extrude(3, both=True)          # a 6 thick rib in XZ
+arrow = Triangle(20, 12, rotation=-90)                   # pointing along +X
+```
+
+## Related
+`Polygon`, `Trapezoid`, `RegularPolygon` (equilateral by circumradius), `fillet`.
diff --git a/src/smlibpy/skill/references/sketches/chamfer.md b/src/smlibpy/skill/references/sketches/chamfer.md
new file mode 100644
index 0000000..eb62229
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/chamfer.md
@@ -0,0 +1,42 @@
+# Sketch.chamfer
+
+Bevels corners of a sketch region: each corner is cut back by a length along both of its
+edges and the two points are joined by a straight line. Every sharp corner, or the ones you
+select by geometry.
+
+## Signature
+`sketch.chamfer(length, vertices=None)` (and `chamfer(vertices, length)` as a function)
+- `length`: the cut-back along each edge, measured along the edge (along the arc for an arc).
+- `vertices`: as for `fillet`: `None` for every sharp corner, or vertices of the sketch
+  (`s.vertices().convex()`, `.top()`, ...) or world points in a list.
+
+## Returns
+A new `Sketch`; the cut is a `line` edge.
+- `Rectangle(40, 20).chamfer(3)`: 8 lines, area 800 - 4 * 3*3/2 = 782.
+- A 90° corner loses `length**2 / 2`: the L with the five outer corners chamfered by 1 loses 2.5.
+- Corners between lines and arcs work too: a rectangle fused with a circle, its two line-arc
+  corners chamfered by 1, has area 657.5163.
+
+## Gotchas
+- Symmetric only (the same length on both edges). An asymmetric bevel: draw it with `Profile`
+  or cut a `Triangle`/`Polygon` away.
+- Smooth corners have nothing to bevel; a selection that contains one raises.
+- `Rectangle(..., chamfer=c)`, `Polygon(..., chamfer=c)` bevel all corners when building.
+
+## Errors
+- `ModelingError: chamfer: length 6 at (-5, 5) and length 6 at (-5, -5) overlap on the line
+  (-5, 5) -> (-5, -5): they need 6 + 6 of its 10; use smaller corners`
+- `ValueError: chamfer: the length must be positive`.
+- Points that are no corner, smooth corners, spline corners: as for `fillet`.
+
+## Example
+```python
+plate = Rectangle(60, 40) - Rectangle(20, 10)
+beveled = plate.chamfer(1, plate.vertices().convex())         # outline only, area 2198
+angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))
+part = angle.fillet(4, angle.vertices().concave())
+part = part.chamfer(1, part.vertices().convex())              # area 496.9336
+```
+
+## Related
+`fillet`, `Profile` (`.chamfer(d)` while drawing), `Rectangle(chamfer=)`, `Part.chamfer` (features).
diff --git a/src/smlibpy/skill/references/sketches/fillet.md b/src/smlibpy/skill/references/sketches/fillet.md
index afc42df..afbf85d 100644
--- a/src/smlibpy/skill/references/sketches/fillet.md
+++ b/src/smlibpy/skill/references/sketches/fillet.md
@@ -1,54 +1,71 @@
 # Sketch.fillet
 
-Rounds the corners of a sketch region with tangent arcs. Works on corners between two
-straight edges, on the outline and on holes.
+Rounds corners of a sketch region with exact tangent arcs: every sharp corner, or the ones you
+select by geometry. Corners between lines, between lines and arcs, and between arcs; on the
+outline and on holes.
 
 ## Signature
-`sketch.fillet(radius, vertices=None)`
+`sketch.fillet(radius, vertices=None)` (and `fillet(vertices, radius)` as a function)
 - `radius`: the arc radius, positive.
-- `vertices`: `None` rounds every corner between two lines. Otherwise a list of corner points
-  in **world coordinates**: tuples `(x, y)` or `(x, y, z)`, or `Vertex`es, e.g. a selection
-  `s.vertices().filter(lambda v: v.x > 0)`. A single tuple must still be inside a list.
+- `vertices`: `None` rounds every sharp corner. Otherwise the corners to round: vertices of
+  the sketch, usually a selection, or points in **world coordinates** (`[(20, 10)]`; a single
+  point must still be inside a list).
+
+## Choosing corners
+`s.vertices()` is a `ShapeList`; its selectors pick corners:
+- `.convex()`: outside corners (the region's angle below 180°). `.concave()`: inside corners,
+  also every corner of a square hole. `.smooth()`: tangent joints (nothing to round).
+- By position: `.top()`, `.right()`, `.max_by(X)`, `.nearest((x, y))`, `.filter(lambda v: v.x > 0)`.
+- `vertex.convexity` is `"convex"`, `"concave"` or `"smooth"` for a corner of a sketch.
+
+The L `Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))` has 5 convex corners and
+1 concave one; a plate with a square hole has 4 of each.
 
 ## Returns
-A new `Sketch`. Lines are shortened and the arcs are real `circle` edges, so area and edges are
-exact: `Rectangle(40, 20).fillet(3)` has area 800 - (4 - π)·9.
-- Convex corners lose material; concave corners (the inside of an L, the corners of a hole)
-  gain material.
-- A corner whose neighbours are an arc or a curve is skipped (Slot, Circle, the joints of a
-  rectangle fused with a circle).
+A new `Sketch` with `line` and `circle` edges; areas are exact.
+- Convex corners lose material, concave ones gain it: the L with its inner corner rounded
+  (r 4) has area 499.4336 = 496 + (4 - pi)*4.
+- The new arcs meet their neighbours tangentially: those joints count as `smooth`, so a later
+  `.convex()` selection does not pick them up.
+- Corners between a line and an arc (a rectangle fused with a circle) and between arcs (a lens)
+  are rounded too.
 
 ## Radius limits
-Each corner cuts back `radius·tan(turn/2)` along both of its edges (`radius` at 90°). The cut
-backs on one edge must fit in it:
-- All four corners of a 40 x 20 rectangle: up to 10 (at exactly 10 the short sides vanish).
+A corner cuts back `radius·tan(turn/2)` along both of its edges (`radius` at 90°). The cut
+backs on one edge must fit in it, otherwise the error says how much each corner needs:
+- All four corners of a 40 x 20 rectangle: up to 10 (at 10 the short sides vanish).
 - One corner only: up to 20 (the whole short edge).
 - Acute corners need much more room: a 50 x 5 right triangle takes radius 1, not 3.
 
 ## Gotchas
-- After `offset()` the edges are B-splines; straight ones still count as lines, so
-  `Rectangle(40, 20).offset(-2).fillet(3)` rounds the corners.
-- A point that is not a corner is ignored silently. Check the edge count or area afterwards.
-- On a placed sketch the points are world points: on `Plane.XZ`, the corner of
-  `Rectangle(20, 10)` is `(10, 0, 5)`, not `(10, 5)`.
-- Hole corners are rounded too. To round only the outline:
-  `s.fillet(r, s.faces()[0].outer_wire().vertices())`.
-- 3D parts have `Part.fillet(edges, radius)` with the arguments the other way round.
+- On a placed sketch, points are world points: on `Plane.XZ` the top corners of
+  `Rectangle(20, 10)` are (±10, 0, 5). Selectors avoid the arithmetic: `placed.vertices().top()`.
+- `Rectangle(..., fillet=r)`, `Polygon(..., fillet=r)` round all corners when building.
+- `Part.fillet(edges, radius)` takes its arguments the other way round; the function
+  `fillet(selection, radius)` works for both.
 
 ## Errors
-- `ValueError: fillet radius 10.0001 is too large for the edge Edge(line, ...)`: the cut backs do
-  not fit on that edge.
-- `ValueError: fillet: the radius must be positive`: `radius <= 0`.
-- `TypeError: 'int' object is not iterable`: `vertices=(20, 10)` instead of `[(20, 10)]`.
+- `ModelingError: fillet: (1, 2) is not a corner of the sketch; its corners are at (-10, -5), ...`
+- `ModelingError: fillet: radius 30 at (-30, 20) and radius 30 at (-30, -20) overlap on the line
+  (-30, 20) -> (-30, -20): they need 30 + 30 of its 40; use smaller corners`
+- `ModelingError: fillet: the sketch has no sharp corners to round` (Slot, Circle).
+- `ModelingError: fillet: the corner at (10, 5) is smooth (its edges meet tangentially), so there
+  is nothing to round; ...`: a smooth corner was selected.
+- `ModelingError: fillet: the corner at (20, 0) joins the bspline ...; fillet works on corners
+  between lines and arcs. ...`: pass only the line/arc corners.
+- `ValueError: fillet: the radius must be positive`.
+- `TypeError: fillet: the corners are given as vertices or points, not as an Edge ...`.
 
 ## Example
 ```python
-bracket = Polygon((0, 0), (40, 0), (40, 6), (6, 6), (6, 30), (0, 30))
-rounded = bracket.fillet(2)                                   # every corner
-inside = bracket.fillet(4, [(6, 6)])                          # only the inner corner
-tab = Rectangle(30, 10).fillet(5, Rectangle(30, 10).vertices().filter(lambda v: v.x > 0))   # round right end
+angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))
+inner = angle.fillet(4, angle.vertices().concave())           # area 499.4336
+plate = Rectangle(60, 40) - Rectangle(20, 10)
+soft_hole = plate.fillet(2, plate.vertices().concave())       # only the hole's corners
+tab = Rectangle(30, 10).fillet(5, Rectangle(30, 10).vertices().right())   # round right end
+same = fillet(plate.vertices().concave(), 2)                  # the function form
 ```
 
 ## Related
-`RoundedRectangle` (all four corners), `FilletPolyline` (curves), `offset`, `Part.fillet`
-(features).
+`chamfer`, `Profile` (`.fillet(r)` while drawing), `Rectangle(fillet=)`, `offset`,
+`Part.fillet` (features).
diff --git a/src/smlibpy/skill/references/sketches/generic.md b/src/smlibpy/skill/references/sketches/generic.md
index b2691a3..8892340 100644
--- a/src/smlibpy/skill/references/sketches/generic.md
+++ b/src/smlibpy/skill/references/sketches/generic.md
@@ -2,31 +2,66 @@
 
 A `Sketch` is a planar region on a plane: one or more faces, each with any number of holes.
 It is the profile you extrude, revolve, sweep or loft. `Sketch` is a subclass of `Shell`.
+Sketches are drawn on XY around the origin, then placed with `.on(plane_or_face)`.
 
 ## Making one
 
-- Constructors: `Rectangle`, `RoundedRectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`,
-  `Slot`, `Trapezoid`. All build on the world XY plane, normal +Z.
-- From curves: `make_face(outer_wire, *hole_wires)`, `wire.to_sketch()`.
-- From a part: `face.to_sketch()` (copy of a planar face, holes kept, normal pointing out of the
-  part), `part.section(plane)`.
+| outline | tool |
+|---|---|
+| standard shapes | `Rectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`, `Triangle`, `Trapezoid`, `Slot`, `ArcSlot` |
+| tangent arcs, rounded inner corners, revolve sections, symmetric outlines | `Profile(...)....close()` |
+| convex outlines around circles and points (levers, links) | `Hull(...)` |
+| a band along a path (slots between centers, ribs) | `Stroke(path, width)` |
+| combinations | `+`, `-`, `&`, `^` of the above |
+| closed curves you already have | `make_face(outer, *holes)`, `wire.to_sketch()` |
+| a face or section of a part | `face.to_sketch()`, `part.section(plane)` |
+
+The shapes share their option names: `rotation=` (degrees about the shape's center),
+`align=`, and where there are corners `fillet=` and `chamfer=` (all corners).
+`Rectangle(80, 50, fillet=6)` is the rounded rectangle; `RoundedRectangle` is its older name.
 
 ## Measuring
 
-`s.area`, `s.center()` (area centroid), `s.bbox()`, `len(s.faces())` (pieces),
-`len(s.faces()[0].inner_wires())` (holes), `s.plane`. `area` is integrated numerically: a
-circle of radius 10 gives 314.15931 instead of 314.15927.
+`s.area`, `s.perimeter` (outlines and holes), `s.center()` (area centroid), `s.bbox()`,
+`len(s.faces())` (pieces), `len(s.faces()[0].inner_wires())` (holes), `s.plane`. `area` is
+integrated to about 1e-7: a circle of radius 10 gives 314.15931 instead of 314.15927.
+`(Rectangle(40, 20, fillet=4) - Circle(5)).perimeter` is 144.548668, exactly the closed form.
+
+## Corners
+
+`s.vertices()` are the corners; select them like edges of a part: `.convex()` (outside
+corners), `.concave()` (inside corners, also the corners of a square hole), `.smooth()`
+(tangent joints), `.top()`, `.nearest(p)`, `.filter(...)`. `s.fillet(r, corners)` and
+`s.chamfer(d, corners)` change them (without corners: every sharp one). See `fillet`, `chamfer`.
 
 ## 2D Booleans
 
 `a + b` unites, `a - b` cuts, `a & b` intersects, `a ^ b` keeps what is in exactly one. The
 right side may be a list or a pattern; `sum(list_of_sketches)` unites a list.
 
+- Exact: lines and arcs stay lines and arcs, areas match closed forms (two circles of radius
+  10, 10 apart: `&` 122.836969 against 122.83697). Shapes that were moved, turned or placed
+  combine as reliably as unmoved ones.
+- A list on the right goes into one kernel call where its members do not overlap:
+  `plate - (GridLocations(10, 10, 18, 10) * Circle(3))` (180 holes) takes 0.4 s. One Boolean
+  of small sketches takes about 1.4 ms.
 - Disjoint pieces stay one `Sketch` with several faces. A bar cut through gives 2 faces.
-  Squares touching at one corner stay 2 faces; squares sharing an edge fuse to 1 face.
+  Squares touching at one corner stay 2 faces; squares sharing an edge fuse to 1 face of 4 edges.
 - `extrude` of a sketch with several faces gives one `Part` with several solids.
 - The result keeps the **left** operand's plane (origin and normal).
 - Both sketches must be in the same plane. A flipped normal on the same plane is accepted.
+- A result can be empty, `Sketch(0 faces, area=0)`: cutting away everything, or intersecting
+  regions that do not meet (also when their boxes are apart). `extrude`, `revolve` and
+  `center()` of an empty sketch raise. Check `len(s.faces())` after cuts that may remove
+  everything.
+
+## Changing a sketch
+
+- `offset(d, corners="round" | "sharp" | "chamfer")`: grow or shrink; bands and frames.
+- `fillet(r, corners)`, `chamfer(d, corners)`: round or bevel corners.
+- `mirror(axis_or_plane)`: lines and arcs stay exact and the sketch keeps facing the same way
+  (`s.mirror(Y)` extrudes to the same side as `s`). `s + s.mirror(Y)` completes a symmetric
+  outline.
 
 ## Placing
 
@@ -53,31 +88,26 @@ into the part (subtract it), `extrude(+d)` grows out of it (add it).
   bounding box. Holes shift it: on a plate whose top has a hole at y = +15, the centroid was at
   y = -0.49. When the position matters, place on a plane: `s.on(Plane.XY.offset(top_z))`.
 - `sketch.plane.origin` moves with the sketch, also with `align` and `translate`. It is the
-  constructor's center for the primitives, the world origin for `Polygon`, and the centroid of
-  the outline for `make_face` and `wire.to_sketch()`. `revolve()` without an axis turns about
-  the local Y axis through that origin, which crosses most profiles and raises
+  constructor's center for the primitives, the world origin for `Polygon` and `Profile`, and the
+  centroid of the outline for `make_face` and `wire.to_sketch()`. `revolve()` without an axis
+  turns about the local Y axis through that origin, which crosses most profiles and raises
   `ModelingError: revolve: the axis crosses the region; ...`. Always pass the axis:
   `s.revolve(Axis((0, 0, 0), (0, 1, 0)))`.
-- `mirror()` flips the normal: `Rectangle(20, 10).mirror(Plane.XZ).extrude(5)` goes to z = -5.
-  `a + a.mirror(...)` keeps `a`'s normal; `a.mirror(...) + a` has the flipped one.
 - A Part combined with a Sketch raises: `part - Circle(3)` gives `TypeError: cannot cut a
   Sketch with a Part; extrude it first` (also for `+` and `&`, and `Sketch + Part`).
-  Extrude first.
-- Cutting away everything, or intersecting regions whose boxes overlap but that do not
-  touch, returns an empty `Sketch(0 faces, area=0)` with no error. Its `extrude` is an empty
-  Part, its `center()` raises `ZeroDivisionError`. Check `len(s.faces())` after cuts.
 - `pattern * sketch` and `(pattern * sketch).on(face)` are `ShapeList`s, not one sketch:
-  extrude each (`[p.extrude(4) for p in pins]`) or `sum()` them first.
+  extrude each (`[p.extrude(4) for p in pins]`), `sum()` them, or use them on the right of a
+  Boolean.
 
 ## Errors
 
-- `ValueError: cannot fuse sketches in different planes` (also for parallel planes at
-  another height). Place both on the same plane first.
-- `ValueError: the sketches do not overlap; their intersection is empty`: `&` of sketches whose
-  bounding boxes do not touch.
+- `ValueError: cannot fuse sketches in different planes; place both on the same plane first`
+  (also for parallel planes at another height).
 - `TypeError: cannot fuse a Part with a Sketch`: `sketch + part`.
-- `TypeError: cannot combine a body with a Edge value; use parts (or a list of parts)`:
-  `sketch + edge`. Make a region first.
+- `TypeError: cannot fuse a Edge with a Sketch: both sides must be sketches (or a list of
+  sketches). Make a region from curves with make_face(...) or Profile(...).close()`.
+- `ModelingError: extrude: the sketch is empty (0 faces); the Boolean or offset that made it
+  removed everything`.
 - `ValueError: expected exactly one shape, got 2 - narrow the selection or use [0]`: `on()`
   with a selection of several faces.
 - `ValueError: a cylinder face has no plane; ...`: `on()` a curved face.
@@ -86,7 +116,7 @@ into the part (subtract it), `extrude(+d)` grows out of it (add it).
 ## Example
 
 ```python
-outline = RoundedRectangle(80, 50, 8)
+outline = Rectangle(80, 50, fillet=8)
 holes = GridLocations(64, 34, 2, 2) * Circle(3)
 plate_sketch = outline - holes - Slot(30, 10) - Circle(6).translate(0, 15)
 plate = plate_sketch.extrude(6)            # volume == plate_sketch.area * 6
@@ -104,5 +134,6 @@ grown = box + box.faces().facing(X).one().to_sketch().extrude(5)   # bbox x up t
 
 ## Related
 
-`Rectangle`, `Circle`, `Polygon`, `make_face`, `offset`, `fillet` (this folder);
-`Sketch.extrude`, `revolve`, `sweep`, `loft` (features); `Plane`, `Location`, patterns (geometry).
+`Profile`, `Rectangle`, `Circle`, `Polygon`, `Hull`, `Stroke`, `make_face`, `offset`,
+`fillet`, `chamfer`, `mirror` (this folder); `recipes/profiles`; `Sketch.extrude`, `revolve`,
+`sweep`, `loft` (features); `Plane`, `Location`, patterns (geometry).
diff --git a/src/smlibpy/skill/references/sketches/make_face.md b/src/smlibpy/skill/references/sketches/make_face.md
index 492e8bb..8967eb3 100644
--- a/src/smlibpy/skill/references/sketches/make_face.md
+++ b/src/smlibpy/skill/references/sketches/make_face.md
@@ -1,7 +1,8 @@
 # make_face
 
 Turns a closed outline of curves into a `Sketch`, minus the regions inside further outlines
-(holes). Use it for profiles with arcs, splines or any shape the constructors do not make.
+(holes). Use it for curves you already have (splines, edges taken from a part). To draw an
+outline of lines and arcs segment by segment, `Profile` is shorter and checks the outline.
 
 ## Signature
 `make_face(outer, *holes)`
@@ -59,5 +60,5 @@ pulley = profile.revolve(Axis((0, 0, 0), (0, 0, 1)))                # turn about
 ```
 
 ## Related
-`Polygon` (straight outlines), `Wire.to_sketch()` (same as `make_face(wire)`), `Polyline`,
+`Profile` (draw an outline), `Polygon` (straight outlines), `Wire.to_sketch()` (same as `make_face(wire)`), `Polyline`,
 `CenterArc`, `Spline`, `FilletPolyline` (curves), `generic`.
diff --git a/src/smlibpy/skill/references/sketches/mirror.md b/src/smlibpy/skill/references/sketches/mirror.md
new file mode 100644
index 0000000..42a86c2
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/mirror.md
@@ -0,0 +1,43 @@
+# Sketch.mirror
+
+A mirrored copy of a sketch, about an axis in its own plane or in any plane. Lines stay
+lines, arcs stay arcs, and the sketch keeps facing the same way.
+
+## Signature
+`sketch.mirror(plane=Plane.XZ)`
+- an `Axis` in the sketch plane: `s.mirror(Y)` (x -> -x for a sketch on XY), `s.mirror(X)`
+  (y -> -y), `s.mirror(Axis((30, 0, 0), (0, 1, 0)))` (about x = 30).
+- a `Plane` or a planar face, as for parts. The default `Plane.XZ` flips y.
+
+## Returns
+A new `Sketch` with exact edges (`line`, `circle`; splines stay B-splines).
+- The normal is mirrored with the sketch. A mirror in a plane perpendicular to the sketch (any
+  axis in its plane) leaves the normal as it was: `half.mirror(Y)` extrudes up like `half`.
+- Mirror and extrude commute: `half.extrude(5).mirror(Plane.YZ)` and
+  `half.mirror(Y).extrude(5)` are the same part (their difference has volume 0). A sketch at
+  z = 10 mirrored in `Plane.XY` lies at z = -10 with normal -Z and extrudes to z -15..-10.
+- `half + half.mirror(Y)` fuses the halves: the edges on the axis vanish and collinear edges
+  join (the half-polygon below: 1 face, 6 edges, area 575).
+
+## Gotchas
+- For a symmetric outline drawn as one line, `Profile(...).mirror(axis)` is shorter: it mirrors
+  while drawing and closes the outline.
+- The sketch's plane origin is mirrored too (it is the reference of `on()`-style placements).
+- A sketch on another plane takes axes in that plane: a sketch on `Plane.XZ` mirrors about
+  `Axis((0, 0, 0), (0, 0, 1))` (world Z) to the other side of x = 0.
+
+## Errors
+- `ValueError: mirror: the axis must lie in the sketch plane (its direction is not parallel to
+  the plane); pass a Plane to mirror in 3D`
+- `ValueError: mirror: the axis does not lie in the sketch plane (its origin is 5 away from it)`
+
+## Example
+```python
+half = Polygon((0, 0), (20, 0), (20, 5), (5, 20), (0, 20))
+whole = half + half.mirror(Y)                       # area 575, 1 face
+left = half.mirror(Y).extrude(5)                    # bbox x -20..0, z 0..5
+ring = (Pos(10, 0) * (Circle(5) - Circle(2))).mirror(Y)   # centered at (-10, 0), circle edges
+```
+
+## Related
+`Profile` (`mirror(axis)` while drawing), `mirror` (geometry, parts), `generic`.
diff --git a/src/smlibpy/skill/references/sketches/offset.md b/src/smlibpy/skill/references/sketches/offset.md
index e61a497..659160b 100644
--- a/src/smlibpy/skill/references/sketches/offset.md
+++ b/src/smlibpy/skill/references/sketches/offset.md
@@ -1,48 +1,65 @@
 # Sketch.offset
 
-Grows or shrinks a sketch region by a distance: every boundary moves outward (positive) or
-inward (negative). Holes move the opposite way.
+Grows or shrinks a sketch region by a distance (an offset outline: walls, gaskets, frames,
+clearances): every boundary moves outward (positive) or inward (negative); holes move the
+other way. Lines stay lines and arcs stay arcs.
 
 ## Signature
-`sketch.offset(distance, *, round=True)`
-- `distance > 0`: grow; holes shrink. `distance < 0`: shrink; holes grow. `0` returns the
-  sketch unchanged.
-- `round=True`: corners that the offset pulls apart get arcs of radius `|distance|` (convex
-  corners when growing, concave corners when shrinking). `round=False`: the sides are extended
-  to sharp corners. Corners that the offset pushes together are sharp either way.
+`sketch.offset(distance, *, corners="round")` (also `offset(sketch, distance, corners=...)`)
+- `distance > 0`: grow, holes shrink. `distance < 0`: shrink, holes grow. `0`: unchanged.
+- `corners`: the corners the offset pulls apart (convex ones when growing, concave ones when
+  shrinking): `"round"` (arcs of radius `|distance|`), `"sharp"` (the sides extended until
+  they meet) or `"chamfer"` (cut straight across). Corners the offset pushes together are sharp
+  in every style. `round=False` is the older spelling of `corners="sharp"`.
 
 ## Returns
-A new `Sketch` on the same plane. Areas match the formulas: `Rectangle(40, 20).offset(2)` is
-800 + 120·2 + 4π; `offset(2, round=False)` is 44 x 24; `offset(-2)` is 36 x 16.
-Circles, ellipses, slots and splines offset as expected (an ellipse 15 x 8 grown by 2 has a
-bbox of ±17 x ±10).
+A new `Sketch` on the same plane, with exact `line` and `circle` edges:
+- `Rectangle(40, 20).offset(2)`: 8 edges, area 1052.5664 = 800 + 120*2 + 4*pi.
+  `corners="sharp"`: 44 x 24, 4 lines. `corners="chamfer"`: 8 lines, area 1048.
+- `offset(-2)`: 36 x 16 in every style (a rectangle has no concave corners).
+- The L `Polygon((0, 0), (30, 0), (30, 8), (8, 8), (8, 25), (0, 25))` shrunk by 2: 172.8584
+  round (its inner corner becomes an arc), 172 sharp, 174 chamfer.
+- A ring `Circle(10) - Circle(5)` grown by 1: area 329.8673 = pi*(121 - 16), still 1 hole.
+- Convex shapes grown with round corners follow Steiner's formula `area + perimeter*d + pi*d**2`
+  exactly (pentagon, rounded rectangle, slot checked).
+- Splines and ellipses go through the kernel's offset and come back as B-spline edges (round
+  or sharp corners only).
+
+## What changes shape
+- Pieces that grow into each other merge: two circles 2 apart grown by 2 become 1 face.
+- Shrinking splits thin necks: a dumbbell with a 2 wide bar shrunk by 1.5 becomes 2 faces.
+- A hole closes when the offset reaches across it (a hole of radius 5 grown by 6 is gone; a
+  10 x 10 square hole grown by 6 too).
+- Shrinking keeps what is far enough from the boundary: the L shrunk by 4.5 leaves a sliver of
+  0.2096 in its corner (the largest circle inside the L has radius 4.69).
+- Shrinking that leaves nothing raises (below).
 
 ## Gotchas
-- **Every edge of the result is a B-spline** (`geom_type == "bspline"`), also the straight ones
-  and the arcs. Straight ones still count as lines: `s.edges().lines()` finds them and
-  `s.fillet(r)` rounds their corners (`Rectangle(40, 20).offset(-2).fillet(3)` works).
-  `.circles()` and `of_type("line")` find nothing. Extruded, the faces are still planes and
-  cylinders.
-- With `round=False` each grown corner keeps two short extra edges (12 edges for a grown
-  rectangle instead of 4); the shape is right.
-- Several pieces grow into each other and fuse (two circles 2 apart grown by 2 become one
-  face). Shrinking can split a region (a dumbbell with a thin bar becomes 2 faces).
-- A hole closes when the offset reaches it (a hole of radius 5 grown by 5 is gone).
-- Shrinking a region with a hole until the wall vanishes returns an empty sketch with no
-  error; shrinking a region without holes until it vanishes raises (below).
-- `outline - outline.offset(-w)` is the usual way to make a frame or gasket of width `w`.
+- `outline.offset(w) - outline` is a band of width `w` outside (a gasket);
+  `outline - outline.offset(-w)` one inside (a frame). For a band along an open path use
+  `Stroke`.
+- `corners="sharp"` at a very acute corner makes a long spike (the miter is `d / sin(angle/2)`).
+- Every result is checked: each edge must lie at the offset distance from the original outline
+  (closer only for chamfer cuts, farther only for sharp corners), on the right side. A result
+  that fails raises instead of returning a wrong region.
 
 ## Errors
-- `ValueError: the offset removes the whole sketch`: the inward offset is at least half the
-  smallest width (`Rectangle(40, 20).offset(-10)`). `offset(-9.9)` still works (a 20.2 x 0.2 sliver).
+- `ModelingError: offset: shrinking by 10 removes the whole region; use a smaller distance`
+  (`Rectangle(40, 20).offset(-10)`; `-9.9` still leaves a 20.2 x 0.2 sliver). Also when a wall
+  vanishes exactly (the ring above shrunk by 2.5).
+- `ValueError: offset: corners is 'round', 'sharp' or 'chamfer', not 'miter'`.
+- `ModelingError: offset: chamfered corners need outlines of lines and arcs; ...` (ellipses,
+  splines).
 
 ## Example
 ```python
-outline = RoundedRectangle(60, 40, 6)
-gasket = outline - outline.offset(-4)                # a 4 wide frame, inner corners radius 2
-clearance = outline.offset(0.5)                      # 0.5 larger all round
-square = Rectangle(40, 20).offset(2, round=False)    # 44 x 24, sharp corners
+outline = Rectangle(80, 50, fillet=6)
+gasket = outline.offset(3) - outline                       # 3 wide band, area 777.3717
+frame = outline - outline.offset(-4)                       # 4 wide frame inside
+square = Rectangle(40, 20).offset(2, corners="sharp")      # 44 x 24
+beveled = Rectangle(40, 20).offset(2, corners="chamfer")   # area 1048
 ```
 
 ## Related
-`fillet` (round chosen corners), `Part.offset` and `shell` (3D, features), `generic`.
+`Stroke` (bands along paths), `fillet`, `chamfer`, `Part.offset` and `shell` (3D, features),
+`generic`.
