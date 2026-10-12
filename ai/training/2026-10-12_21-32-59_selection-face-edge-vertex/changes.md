diff --git a/src/smlibpy/skill/references/selection/Face.md b/src/smlibpy/skill/references/selection/Face.md
new file mode 100644
index 0000000..46e9acb
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/Face.md
@@ -0,0 +1,75 @@
+# Face
+
+One bounded piece of a surface of a Part, Shell or Sketch. You get faces from `body.faces()`;
+there is no public constructor.
+
+## Properties and methods
+| Member | Gives |
+|---|---|
+| `geom_type` | `"plane"`, `"cylinder"`, `"cone"`, `"sphere"`, `"torus"`, `"revolution"`, `"extrusion"`, `"bspline"`, `"offset"`, `"other"` |
+| `area` | area in mm² |
+| `center()` | area centroid (may lie off the face) |
+| `interior_point()` | a point that lies on the face |
+| `normal_at(point=None)` | outward unit normal at the face point closest to `point` |
+| `plane` | `Plane` at the centroid, normal outward (planar faces only) |
+| `is_planar` | True for `"plane"` faces |
+| `radius` | cylinder, sphere radius; cone: bottom radius; torus: minor radius |
+| `axis` | `Axis` of a cylinder, cone, sphere, torus, revolution face |
+| `outer_wire()`, `inner_wires()`, `wires()`, `edges(seams=False)`, `vertices()`, `neighbors()`, `owner` | topology, see `topology` |
+| `to_sketch()` | a Sketch with a copy of a planar face, holes included |
+| `to_shell()` | a Shell with a copy of any face |
+| `extrude(amount)` | a Part from a planar face, `amount` along the outward normal |
+| `distance_to(point)`, `bbox()` | true distance, tight bounding box |
+
+## Details
+- `normal_at()` points out of the material. On a hole wall it points towards the hole's axis:
+  `normal_at((6, 0, 0))` on a hole of radius 6 gives (−1, 0, 0); on a boss (+1, 0, 0).
+  A point off the face is projected onto the face first. Planar faces return the plane normal.
+- `plane` of a planar face: origin at the centroid, z = outward normal. The x direction for faces of
+  a Box: top and bottom (1, 0, 0); +X face (0, 1, 0); −X (0, −1, 0); −Y (1, 0, 0); +Y (−1, 0, 0). On all
+  four side faces local Y points up (+Z). Faces of a Sketch keep the sketch's x direction.
+- `extrude(5)` grows outward (top face: z 10..15), `extrude(-5)` goes into the part.
+- `axis` of a cylinder or cone: the origin is on the axis but not necessarily on the face (a hole
+  cut by `Cylinder(6, 30)` in a 20 mm block has its axis origin at z=−15). Sphere and torus: `Axis.Z`
+  for the primitives.
+
+## Gotchas
+- The centroid is not on the face for faces with holes, rings and full cylinders. `sketch.on(face)`
+  places the sketch at the centroid: on the top face of a block with a centered hole, `on(top)`
+  puts the sketch in the hole and a pocket cut there removes nothing. Shift in face coordinates
+  before placing (`Rectangle(10, 6).translate(12, 0, 0).on(top)`), or build the plane yourself.
+- `normal_at()` without a point on a full cylinder, sphere or torus is arbitrary (the centroid
+  lies on the axis). Pass a point on the face.
+- `plane`, `to_sketch()` and `extrude()` raise `ValueError: a cylinder face has no plane; use
+  normal_at() or a planar face` on curved faces.
+- Flat faces of type `"bspline"` (`to_nurbs()`, `surface()`, many STEP imports) have
+  `is_planar == False` and no `plane`. Workaround: `Plane(face.center(), z_dir=face.normal_at())`.
+- `radius` and `axis` raise `ValueError: a plane face has no radius` / `... no axis` on planes.
+  Narrow with `cylinders()` first.
+- `center()` and `area` are computed by integration: expect noise of about 1e-6 in coordinates.
+- A face moved with `translate`/`rotate` is a face of a new Shell, not of the part.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(6, 30)
+top = part.faces().top().one()
+print(top.geom_type, round(top.area, 1))         # plane 1086.9
+print(top.normal_at(), top.plane.x_dir)          # Vector(0, 0, 1) Vector(1, 0, 0)
+print(len(top.inner_wires()))                    # 1: the hole
+
+hole = part.faces().cylinders().one()
+print(hole.radius, hole.axis.direction)          # 6.0 Vector(0, 0, 1)
+print(hole.normal_at((6, 0, 0)))                 # Vector(-1, 0, 0): out of the material, into the hole
+
+boss = top.to_sketch().extrude(5)                # same as top.extrude(5): outward, z 10..15
+print(round(boss.volume, 3), boss.bbox().min.z)  # 5434.513 10.0
+print(round(part.volume, 3))                     # 21738.053
+lost = Rectangle(10, 6).on(top).extrude(-4)      # placed at the centroid (0, 0, 10): inside the hole
+print(round((part - lost).volume, 3))            # 21738.053: nothing removed
+pocket = Rectangle(10, 6).translate(12, 0, 0).on(top).extrude(-4)   # move in face coordinates first
+print(round((part - pocket).volume, 3))          # 21498.053: 10 * 6 * 4 removed
+```
+
+## Related
+`topology`, `types`, `spatial` (`facing`), `Edge`, `Vertex`, `Plane` (geometry domain),
+`Sketch.extrude` (features domain).
diff --git a/src/smlibpy/skill/references/selection/Edge.md b/src/smlibpy/skill/references/selection/Edge.md
new file mode 100644
index 0000000..2417d74
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/Edge.md
@@ -0,0 +1,76 @@
+# Edge
+
+One bounded curve: a line segment, a circle or arc, an ellipse or a NURBS curve. Edges come from
+bodies (`part.edges()`, `face.edges()`) or from curve constructors (`Line`, `CenterArc`,
+`Spline`, ...). `Edge()` itself raises `TypeError`.
+
+## Properties and methods
+| Member | Gives |
+|---|---|
+| `geom_type` | `"line"`, `"circle"` (also arcs), `"ellipse"`, `"bspline"`, `"other"` |
+| `length` | arc length in mm |
+| `start`, `end` | end points (Vectors); equal for a closed edge |
+| `point_at(t=0.5)` | point at fraction `t` of the arc length; t is clamped to 0..1 |
+| `tangent_at(t=0.5)` | unit tangent at `t`, pointing along the edge |
+| `center()` | `point_at(0.5)`: the midpoint along the curve, not the circle center |
+| `direction` | unit vector start → end; straight edges only |
+| `radius`, `arc_center`, `normal` | circle/arc only: radius, center point, axis direction |
+| `is_closed` | start == end (full circles, closed splines) |
+| `is_seam` | True for the seam of a closed surface (see `edges(seams=True)`) |
+| `convexity`, `is_convex()` | see `convexity` |
+| `intersections(other)` | list of points where the two edges cross |
+| `reversed()` | the same edge run the other way |
+| `faces()`, `vertices()`, `distance_to(point)`, `bbox()` | topology and measures |
+
+## Details
+- `point_at` is uniform in arc length: 400 steps along a spline were all 0.0509 long.
+  `point_at(-0.5)` gives the start, `point_at(1.5)` the end.
+- `arc_center` is the center of the circle; `center()` is a point on the curve. For a full circle
+  starting at (5, 0, 0), `center()` is (−5, 0, 0).
+- `normal` is the circle's axis as stored in the kernel. It does not follow the face or the
+  direction of travel: both rims of a `Cylinder` and of a hole have normal +Z, and `reversed()`
+  keeps the normal.
+- `reversed()` swaps `start`/`end` and flips `tangent_at`; the reversed edge still `==` the original
+  and can be passed to `part.fillet`.
+- The direction of edges taken from a body is the kernel's: do not rely on `start` being the lower
+  or left end. Vertical edges of a `Box` happen to run −Z → +Z.
+- Edges from a face's wire (`face.outer_wire().edges()`) run around the face counter-clockwise
+  seen from outside.
+
+## Gotchas
+- `direction` on a curve: `ValueError: direction is only defined for straight edges, this is a
+  circle`. `radius`/`arc_center`/`normal` on a non-circle: `ValueError: not a circular edge but a
+  line`. Ellipses have none of them.
+- `intersections` raises `KernelError: edge intersections failed (SM_ERR)` when the edges do not
+  meet (parallel, skew, too short). Wrap it in `try/except KernelError` and treat that as no
+  intersection. On a closed circle the start point can appear twice in the result; a collinear
+  overlap gives a single point.
+- Two free edges built from the same points are not `==` (identity); compare `start`/`end`.
+- A moved edge (`translate`, `rotate`) is a free edge: `faces()` is empty and features of the part
+  reject it.
+- Straight edges can be `"bspline"` (after `chamfer`, `loft`, `ruled`, `to_nurbs`): `direction`
+  then raises. `e.end - e.start` still gives the direction.
+
+## Example
+```python
+arc = CenterArc((0, 0, 0), 10, 0, 180)
+print(arc.geom_type, round(arc.length, 4))           # circle 31.4159
+print(arc.start, arc.end)                            # Vector(10, 0, 0) Vector(-10, 0, 0)
+print(arc.point_at(0.5), arc.center(), arc.arc_center)   # (0, 10, 0) (0, 10, 0) (0, 0, 0)
+print(arc.radius, arc.normal)                        # 10.0 Vector(0, 0, 1)
+print(arc.reversed().start, arc.reversed().tangent_at(0))   # (-10, 0, 0) (0, 1, 0)
+
+a = Line((0, 0, 0), (10, 10, 0))
+print(a.intersections(Line((0, 10, 0), (10, 0, 0))))   # [Vector(5, 5, 0)]
+try:
+    pts = a.intersections(Line((1, 0, 0), (11, 10, 0)))   # parallel: the kernel raises
+except KernelError:
+    pts = []
+print(pts)                                            # []
+
+cyl = Cylinder(5, 10)
+print([e.is_seam for e in cyl.edges(seams=True)])    # [True, False, False]
+```
+
+## Related
+`convexity`, `types`, `topology`, `Face`, `Vertex`, `Line`, `CenterArc`, `Spline`, `Wire` (curves domain).
diff --git a/src/smlibpy/skill/references/selection/Vertex.md b/src/smlibpy/skill/references/selection/Vertex.md
new file mode 100644
index 0000000..de05ef3
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/Vertex.md
@@ -0,0 +1,50 @@
+# Vertex
+
+A point of a body (`part.vertices()`, `face.vertices()`, `edge.vertices()`), or a free point
+made with `Vertex(x, y, z)`.
+
+## Signature
+`Vertex(x=0, y=0, z=0)`; also `Vertex((x, y, z))`, `Vertex(Vector)`; `Vertex(1, 2)` and
+`Vertex((1, 2))` have z = 0.
+
+## Properties and methods
+- `point`: the position as a `Vector`; `x`, `y`, `z`: floats. A vertex unpacks like a tuple
+  (`tuple(v)`) and is accepted wherever a point is: `Line(corner, Vertex(0, 0, 0))`.
+- `center()` is the point; `bbox()` is a zero-size box.
+- `edges()`, `faces()`: the edges and faces meeting at a vertex of a body (3 and 3 at a box
+  corner); empty for a free vertex.
+- `distance_to(point_or_shape)`.
+
+## Equality
+- Two vertices are `==` when they are at the same position within about 1e-6 (5e-7 apart: equal,
+  2e-6: not), also a body vertex and a free vertex: `Vertex(5, 5, 5) in box.vertices()` is True.
+- Their hashes differ, though: a set or dict can hold a body vertex and an equal free vertex as two
+  entries. Compare with `==` or by coordinates.
+
+## Vertices of common bodies
+`Box`: the 8 corners. `Cylinder`: 2, where the seam meets the rims, (r, 0, ±h/2).
+`Sphere`: the 2 poles. `Rectangle`: 4 corners. A closed circle edge has one vertex.
+
+## Gotchas
+- Vertices of curved bodies are where seams end, not meaningful corners: do not use
+  `cylinder.vertices()` to find a center; use `face.axis` or `edge.arc_center`.
+- A translated vertex is a free vertex (no edges, no faces).
+- Positional selectors work on vertices: `box.vertices().top().right().back().one()` is the
+  (+X, +Y, +Z) corner.
+- `Sketch.fillet(radius, vertices)` takes vertices selected this way to round only some corners.
+
+## Example
+```python
+box = Box(10, 10, 10)
+corner = box.vertices().top().right().back().one()
+print(corner, corner.x, corner.point)            # Vertex(5, 5, 5) 5.0 Vector(5, 5, 5)
+print(corner == Vertex(5, 5, 5))                 # True: equal by position
+print(len(corner.edges()), len(corner.faces()))  # 3 3
+print(Line(corner, Vertex(0, 0, 0)).length)      # 8.660254037844387
+sk = Rectangle(20, 10)
+rounded = sk.fillet(2, sk.vertices().right())    # round only the two right corners
+print(round(rounded.area, 4))                    # 198.2832
+```
+
+## Related
+`topology`, `positional`, `extremes` (`at`), `Edge`, `Face`, `Vector` (geometry domain).
