diff --git a/src/smlibpy/skill/references/analysis/distance_to.md b/src/smlibpy/skill/references/analysis/distance_to.md
new file mode 100644
index 0000000..eaa28b6
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/distance_to.md
@@ -0,0 +1,92 @@
+# distance_to, closest_point
+
+The minimum distance from a body to a point or to another body, and the nearest point on a
+body's surface.
+
+## Signature
+
+`body.distance_to(other) -> float` where `other` is a point (`(x, y, z)`, `Vector`, `Vertex`)
+or another body (`Part`, `Shell`, `Sketch`).
+
+`body.closest_point(point) -> Vector`, a point on the body's surface.
+
+On `Part`, `Shell` and `Sketch`. `Face`, `Edge`, `Wire` and `Vertex` have `distance_to(point)`
+only; they have no `closest_point`.
+
+## What the number means
+
+It is the distance between **surfaces**, not between volumes:
+
+| Situation | `distance_to` |
+|---|---|
+| point outside | distance to the surface |
+| point inside a part | distance to the surface (`Box(10,10,10).distance_to((1,2,3))` is 2.0, not 0) |
+| bodies apart | the gap |
+| bodies touching or crossing | 0.0 |
+| one body inside the other | the wall clearance (a sphere r2 in a box 10: 3.0) |
+
+So a non-zero distance does not mean "apart". To test for overlap, intersect:
+`len((a & b).faces()) > 0` (an empty intersection has no faces, volume 0).
+
+`closest_point` of a point inside returns the nearest surface point
+(`(1, 2, 3)` in a 10 mm box gives `(1, 2, 5)`). For the center of a sphere it returns one of
+the equally near points.
+
+## Accuracy
+
+Point queries are exact to 1e-14 on planes, cylinders, spheres, fillets, also far from the
+origin. Body-body distances are exact (1e-14) for boxes, spheres, cones, tori, skew and
+perpendicular cylinders, and coaxial cylinders.
+
+**Wrong when the nearest points form a line**: two parallel cylinders, a cylinder beside a
+flat face parallel to its axis. The result is too small by 1.7 to 3.6 mm (r5 and r3 cylinders
+20 apart: 10.33 instead of 12; cylinder beside a box: 7.22 instead of 10). A shaft off-center
+in a hole is right.
+
+**Wrong far from the origin**: two spheres near (1e4, -2e4, 3e4) or (1e5, 0, 0) give 15.56
+instead of 13.91; near (7e3, -1.4e4, 2.1e4) they were still right. Move both bodies by the same
+vector to near the origin before measuring.
+
+Cross-check a body-body distance with alternating `closest_point` calls (works for convex
+regions; see the example).
+
+## Gotchas
+
+- `distance_to` on a list raises `ValueError: expected 2 or 3 coordinates, got 1`; loop over
+  the list.
+- `part.distance_to(edge)` raises `TypeError: 'Edge' object is not iterable`, and
+  `edge.distance_to(part)` `TypeError: 'Part' object is not iterable`. Only points and bodies
+  are accepted. For an edge, take the minimum over `edge.point_at(t)` samples, or
+  `face.to_shell()` for a face.
+- Body-body distance takes 1 to 6 ms on primitives; point queries under 0.1 ms.
+
+## Example
+
+```python
+a = Box(10, 10, 10)
+b = Sphere(3).translate(20, 0, 0)
+print(a.distance_to(b))                  # 12.0, gap between the surfaces
+print(a.distance_to((0, 0, 30)))         # 25.0
+print(a.closest_point((0, 0, 30)))       # Vector(0, 0, 5)
+print(a.distance_to((1, 2, 3)))          # 2.0: inside the box, distance to its surface
+
+# overlap check: distance_to cannot tell nested from apart, an intersection can
+inner = Sphere(2)
+print(a.distance_to(inner))              # 3.0 although the sphere is inside
+overlap = a & inner
+print(len(overlap.faces()) > 0, round(overlap.volume, 4))   # True 33.5103
+
+# cross-check for parallel cylinders and flat faces (distance_to is wrong there)
+def gap(p, q, steps=50):
+    x = q.center()
+    for _ in range(steps):
+        y = p.closest_point(x)
+        x = q.closest_point(y)
+    return (y - x).length
+c1, c2 = Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 0)
+print(round(c1.distance_to(c2), 4), round(gap(c1, c2), 4))   # 10.3331 12.0 (true: 12)
+```
+
+## Related
+
+`measures`, `intersection_curves`, `Part.intersect` (`&`), `generic`
diff --git a/src/smlibpy/skill/references/analysis/intersection_curves.md b/src/smlibpy/skill/references/analysis/intersection_curves.md
new file mode 100644
index 0000000..b22db70
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/intersection_curves.md
@@ -0,0 +1,72 @@
+# intersection_curves
+
+The curves where the surface of one body crosses the surface of another. A query: neither
+body changes.
+
+## Signature
+
+`body.intersection_curves(other) -> ShapeList[Edge]`
+
+`body` and `other` are `Part`, `Shell` or `Sketch`. A `Plane` is not accepted
+(`AttributeError: 'Plane' object has no attribute '_brep'`): use a sketch larger than the
+body, placed on the plane, such as `Rectangle(40, 40).on(Plane.XY.offset(6))`.
+
+## Returns
+
+A `ShapeList` of standalone `Edge`s, in no particular order, not joined. A closed curve comes
+in pieces: split where it crosses a seam of a curved surface or an edge of a face. A sphere cut
+by a plane gives 2 arcs; a tilted cylinder through a box gives 7 pieces (3 on the bottom
+face, 2 on the top, 1 on each side wall).
+
+Edge types are exact where the geometry allows: `circle` (sphere, cylinder or torus cut
+square to its axis, `radius` and `arc_center` work), `ellipse` (tilted cylinder by a plane,
+two crossing cylinders of the same radius), `line`; otherwise `bspline` (two cylinders of
+different radii).
+
+## Accuracy
+
+| Case | Total length vs exact | Points off both surfaces |
+|---|---|---|
+| circles and ellipses | 1e-11 | below 1e-13 |
+| B-spline curves (r5 and r3 cylinders crossing) | 5e-7 | 1.4e-6 |
+
+## Gotchas
+
+- **No crossing raises**: disjoint bodies, or one body nested inside the other, raise
+  `KernelError: intersection curves failed (SM_ERR)` instead of returning an empty list. Wrap
+  the call in `try` when no crossing is possible.
+- Coincident faces give odd results: two boxes sharing a face return 6 pieces of total
+  length 120 for a 20 x 20 face (perimeter 80); a body with itself returns every edge twice.
+  Do not rely on the output where faces overlap.
+- `Wire(pieces)` joins pieces of one loop (`is_closed` True). Pieces of several loops give a
+  wire with `is_closed == False` and no error: group the pieces per loop first, for example
+  by `piece.center().z`.
+- For a cross-section region (area, a sketch to extrude) use `part.section(plane)`, which
+  returns a `Sketch`.
+
+## Errors
+
+- `KernelError: intersection curves failed (SM_ERR)` when the surfaces do not cross.
+
+## Example
+
+```python
+ball = Sphere(10)
+cut_plane = Rectangle(40, 40).on(Plane.XY.offset(6))      # a plane as a body: a large sketch
+pieces = ball.intersection_curves(cut_plane)
+print(len(pieces), [e.geom_type for e in pieces])          # 2 ['circle', 'circle']: split at the seam
+print(round(sum(e.length for e in pieces), 6))             # 50.265482 = 2*pi*8
+print(pieces[0].radius, pieces[0].arc_center)              # 8.0 Vector(0, 0, 6)
+
+ring = Wire(pieces)                                        # join the pieces
+print(ring.is_closed, round(ring.length, 6))               # True 50.265482
+
+try:
+    Box(20, 20, 20).intersection_curves(Box(5, 5, 5).translate(50, 0, 0))
+except KernelError as e:
+    print(e)                                               # intersection curves failed (SM_ERR)
+```
+
+## Related
+
+`Part.section`, `silhouette`, `project`, `distance_to`, `Edge.intersections` (curve with curve)
diff --git a/src/smlibpy/skill/references/analysis/silhouette.md b/src/smlibpy/skill/references/analysis/silhouette.md
new file mode 100644
index 0000000..946a8e5
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/silhouette.md
@@ -0,0 +1,65 @@
+# silhouette
+
+The contour curves of a body as seen from a direction: where its surface turns away from the
+viewer. Use it for outlines of curved parts and to find where a surface is tangent to a view.
+
+## Signature
+
+`body.silhouette(direction=(0, 0, 1)) -> ShapeList[Edge]`
+
+`direction` points from the model towards the viewer (like `view=` of `snapshot`). Its length
+does not matter; `(0, 0, 0)` raises `KernelError: silhouette failed (SM_ERR_INVALID_INPUT)`.
+The result does not depend on where the body is: a moved sphere gives the same curve, moved.
+
+## Returns
+
+A `ShapeList` of standalone 3D `Edge`s on the body (not projected to a plane), in no order:
+
+- On curved faces: contour generators, where the surface normal is perpendicular to the
+  direction. They come as `bspline` edges, even for a sphere or a cylinder.
+- Face boundary edges on the outline: the rim of the face that looks at the viewer when
+  its neighbours are seen edge-on. A box from +Z returns the 4 top edges (z = 5), from -Z the
+  4 bottom edges.
+- Only the visible side. A torus from +X returns 157.08 mm of curve, half of the full set of
+  contour points (314.16 mm): the front halves of its top and bottom circles and the outer
+  halves of its two side circles.
+
+## Accuracy
+
+The contour curves are fits. Sphere: length 2.5e-7 short (seen along an axis) to 9e-7 (along
+(1, 1, 1)), normal perpendicular to the direction to 1e-13. Torus from the side: the normal is
+perpendicular to 3.6e-5. Planar outlines and cylinder contour lines are exact (length 20.0).
+
+## Gotchas
+
+- The result mixes contour curves and boundary edges. Filter by `geom_type`, position or
+  length. A cylinder seen from the side returns its two contour lines plus 7 quarter arcs of
+  its rims, from both the front and the back half; which rim pieces come back is not
+  consistent when faces are seen exactly edge-on.
+- Slivers: the torus from the side also returns 3 pieces of 1e-5 to 2.5e-4 mm. Drop edges
+  shorter than about 1e-3.
+- Closed contours come in one piece or several (a sphere: 1 piece; a torus from above: one
+  `circle` and one `bspline`).
+- For a full 2D drawing view (all edges projected onto a plane) use `outline`.
+
+## Example
+
+```python
+ball = Sphere(10)
+rim = ball.silhouette((0, 0, 1))                  # seen from above (camera at +Z)
+print(len(rim), rim[0].geom_type, round(rim[0].length, 5))   # 1 bspline 62.83184 (2*pi*10)
+
+ring = Torus(20, 5)
+side = ring.silhouette((1, 0, 0))                 # camera at +X: only the visible contour
+side = [e for e in side if e.length > 1e-3]       # drop slivers
+print(len(side), round(sum(e.length for e in side), 3))      # 8 157.078 (half of the full set)
+
+cyl = Cylinder(5, 20)
+cs = cyl.silhouette((1, 0, 0))
+lines = [e for e in cs if e.geom_type != "circle"]           # the two contour lines at y = +-5
+print([(round(e.point_at(0.5).y, 6), round(e.length, 6)) for e in lines])   # [(-5.0, 20.0), (5.0, 20.0)]
+```
+
+## Related
+
+`outline`, `project`, `intersection_curves`
diff --git a/src/smlibpy/skill/references/analysis/project.md b/src/smlibpy/skill/references/analysis/project.md
new file mode 100644
index 0000000..ebfc370
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/project.md
@@ -0,0 +1,79 @@
+# project
+
+Projects a curve onto the faces of a body along a direction. Returns 3D curves that lie on the
+body, for example a path on a curved face.
+
+## Signature
+
+`body.project(curve, direction=(0, 0, -1)) -> ShapeList[Edge]`
+
+- `curve`: an `Edge`, a `Wire` or anything with `.edges()` (a `Sketch` works: its outline is
+  projected). Each edge is projected on its own.
+- `direction`: the projection direction; its length does not matter. `(0, 0, 0)` raises
+  `KernelError: project failed (SM_ERR_INVALID_INPUT)`.
+
+## Returns
+
+A `ShapeList` of standalone `bspline` edges on the body's faces, in no order.
+
+- **Every face the projection lines pass through gets a piece, on both sides of the body.**
+  A circle above a sphere comes back twice (z = +8.66 and -8.66); a circle above a box gives one
+  piece on the top face and one on the bottom face.
+- The sign of `direction` and the side the curve is on do not matter: a circle above, below,
+  or inside a box, projected up or down, gives the same two pieces.
+- Faces parallel to the direction get degenerate pieces: a line projected down onto a box
+  returns 4 pieces (top, bottom, and a vertical line on each side face).
+- A curve that misses the body raises `KernelError: project failed (SM_ERR)`; so does an
+  oblique direction whose lines miss the body.
+- A projected closed curve stays closed (`is_closed` True). The direction of a piece may be
+  reversed relative to the input.
+
+Keep the piece you want by position, for example `max(hits, key=lambda e: e.center().z)`.
+
+## Accuracy
+
+The results are B-spline fits with a tolerance of about 1e-4 mm, also on flat faces: a circle
+of radius 5 projected onto a box top has radius errors up to 1.7e-4 and is 1.7e-5 too short; on
+a sphere the points lie up to 9.4e-5 off the surface. Straight lines onto flat faces are exact
+(length 20.0). Do not take `radius` or exact lengths from projected curves; measure the
+original curve.
+
+## Example
+
+```python
+dome = Sphere(10)
+path = CenterArc((0, 0, 30), 5, 0, 360)               # a circle above the sphere
+hits = dome.project(path, (0, 0, -1))
+print(len(hits), [round(e.point_at(0.5).z, 4) for e in hits])   # 2 [8.6603, -8.6603]: both sides
+top = max(hits, key=lambda e: e.center().z)           # keep the upper one
+print(top.geom_type, top.is_closed, round(dome.distance_to(top.point_at(0.3)), 4))   # bspline True 0.0001: a fit, ~1e-4 off
+
+box = Box(20, 20, 20)
+pieces = box.project(Line((-30, 0, 30), (30, 0, 30)), (0, 0, -1))
+print(len(pieces))                                    # 4: top, bottom and the two side faces
+on_top = [e for e in pieces if abs(e.start.z - 10) < 1e-9 and abs(e.end.z - 10) < 1e-9]
+print(len(on_top), on_top[0].length)                  # 1 20.0
+
+try:
+    dome.project(CenterArc((0, 0, 30), 15, 0, 360), (0, 0, -1))   # misses the sphere
+except KernelError as e:
+    print(e)                                          # project failed (SM_ERR)
+```
+
+## Onto a plane
+
+`project` needs a body. To flatten a 3D curve onto a plane, project it onto a sketch on that
+plane, larger than the curve's shadow:
+
+```python
+floor = Rectangle(100, 100)                 # a sketch larger than the curve stands in for Plane.XY
+coil = Helix(5, 20, 10)                     # 4 turns, z = 0..20
+flat = floor.project(coil, (0, 0, -1))
+print(len(flat), round(sum(e.length for e in flat), 4))   # 1 251.3194 (4 circles: 251.3274)
+print(max(abs(e.point_at(t).z) for e in flat for t in (0, 0.5, 1)) < 1e-9)   # True: in the plane
+```
+
+## Related
+
+`outline` (all edges onto a plane), `silhouette`, `intersection_curves`, `Sketch.on` (place a
+flat sketch on a planar face instead of projecting)
diff --git a/src/smlibpy/skill/references/analysis/outline.md b/src/smlibpy/skill/references/analysis/outline.md
new file mode 100644
index 0000000..db82df7
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/outline.md
@@ -0,0 +1,59 @@
+# outline
+
+A 2D drawing view of a body: its visible edges and contours, projected flat onto a plane.
+
+## Signature
+
+`body.outline(plane=Plane.XY) -> ShapeList[Edge]`
+
+The view looks from the side the plane's normal points to: `Plane.XY` from +Z (top view),
+`Plane.bottom` from -Z, `Plane.XZ` from -Y (front view, its normal is (0, -1, 0)), `Plane.YZ`
+from +X. Works on `Part`, `Shell` and `Sketch`.
+
+## Returns
+
+A `ShapeList` of `bspline` edges lying in the plane, in world coordinates (not in the plane's
+2D coordinates). `Box(20, 10, 5).translate(100, 0, 0).outline(Plane.XZ.offset(7))` lies at
+y = -7 and spans x = 90..110.
+
+What is in it:
+
+- **Only visible lines.** Hidden lines are removed: a blind hole in the bottom face does not
+  show in the top view; a small box under a big box shows only from below.
+- Edges and contours of curved faces: a cylinder seen from the side is a 10 x 20 rectangle
+  (its side lines come from the contour, not from edges).
+- Each line once: the top and bottom squares of a box coincide in the top view and come back
+  as 4 edges; edges seen end-on (points) are dropped.
+- Lines may be split: the cylinder's side view has 6 pieces (each horizontal line in two).
+- A tilted view works: a box on a plane with normal (1, 1, 1) gives the 6 hexagon edges and
+  the 3 inner edges of an isometric drawing.
+
+## Accuracy
+
+Exact: lines have their true projected lengths (20.0, 16.3299 = 20·sqrt(2/3)), a projected
+circle has radius error 2e-15. All edges are `bspline`, so `radius` and `arc_center` do not
+work; measure lengths, `point_at` and `bbox()`.
+
+## Gotchas
+
+- There are no dashed hidden lines. For a full drawing, call `outline` once per view
+  (`Plane.XY`, `Plane.XZ`, `Plane.YZ`, `Plane.bottom`, ...).
+- A flat sketch seen edge-on becomes one line (a circle on `Plane.XZ` gives a 10 mm line).
+- For the 3D contour curves on the body (not flattened) use `silhouette`.
+
+## Example
+
+```python
+part = Box(30, 30, 10) - Cylinder(5, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, -5)
+top_view = part.outline(Plane.XY)            # seen from +Z: the blind hole underneath is hidden
+bottom_view = part.outline(Plane.bottom)     # seen from -Z: the hole shows
+print(len(top_view), len(bottom_view))       # 4 5
+print(sorted(round(e.length, 4) for e in bottom_view))   # [30.0, 30.0, 30.0, 30.0, 31.4159]
+
+front = Cylinder(5, 20).outline(Plane.XZ)    # Plane.XZ looks from -Y: a 10 x 20 rectangle
+print(len(front), front.bbox().size)                    # 6 Vector(10, 0, 20)
+```
+
+## Related
+
+`silhouette`, `project`, `snapshot(view="sheet")` for a picture of four views
