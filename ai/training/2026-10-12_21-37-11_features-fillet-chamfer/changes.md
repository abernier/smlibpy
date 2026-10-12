diff --git a/src/smlibpy/skill/references/features/fillet.md b/src/smlibpy/skill/references/features/fillet.md
new file mode 100644
index 0000000..3a2c1bd
--- /dev/null
+++ b/src/smlibpy/skill/references/features/fillet.md
@@ -0,0 +1,95 @@
+# fillet
+
+Rounds edges of a part.
+
+## Signature
+`part.fillet(edges, radius, *, continuity=None, fullness=1.0)`
+`fillet(edges, radius, **same keywords)` (finds the part the edges belong to)
+
+- `edges`: a selection (`ShapeList`), one `Edge`, or faces (all their edges). Edges from an
+  earlier version of the same part are matched by position, so a selection made before a cut
+  still works if the edge did not change.
+- `radius`: a number; a `(start, end)` tuple for a linearly varying radius (start = the edge's
+  `start` point; check `edge.start`); a list with one radius per edge, in selection order.
+- `continuity`: `None` circular arc. `"G1"`, `"G2"`, `"G3"` (or 1, 2, 3; case does not matter)
+  make a blend instead: it meets the faces at the same setback as the circular round but bulges
+  more (removes less: 4 vertical box edges r5 remove 429.2 circular, 400.0 G1, 270.7 G2, 212.0 G3).
+- `fullness`: blends only (ignored for circular). Below 1 flatter, above 1 fuller. 0.5 to 1.2
+  work; 1.5 and 2.0 fail on a box edge with the radius error message.
+
+## Returns
+A new `Part`. One face per rounded edge plus corner patches. Removed volume per straight
+convex 90° edge: `(r² − π r²/4) * length`.
+
+## What can be rounded
+- Seam edges and smooth (tangent) edges in the selection are skipped. A selection with only
+  those raises `ValueError: fillet: the selection holds only seam or smooth edges, nothing to fillet`.
+- Concave edges add material (a boss root): `part.edges().concave()`.
+- Circular edges (hole rims, cylinder ends) work.
+
+## Limits
+- smlibpy checks edges that run alongside each other on a face: two rounded edges `d` apart
+  allow `r <= d/2`; one rounded edge next to an unrounded one allows `r <= d`. A larger radius
+  raises a `ModelingError` that names the largest setback.
+- **Right at the limit the kernel can return garbage that passes every check.** A 10 mm cube
+  with all edges r 4.99 gives `is_valid() == True`, volume 11.19 (should be 525.17), and fails
+  to render; r 4.97 and r 4.999 are right; r 5 raises. Stay 2% or more below the limit, and
+  compare the volume with a formula.
+- A single edge can take a radius up to the full face width (one edge of a 10 cube with r 10
+  gives the exact quarter cylinder).
+- `r <= 0` raises `KernelError: fillet failed (SM_ERR): the radius may be too large ...`.
+
+## Order
+- Where rounds of different radii meet at a corner, give them in one call with a radius list,
+  or round the larger radius first. Small first, then large, leaves a dented corner
+  (picture in training; volume 25199.4 vs 25154.7).
+- Fillet after the Booleans that create the edges; select new edges by geometry (`circles()`,
+  `concave()`, radius filters).
+- Fillet before `shell` when the walls should follow the rounds (see `shell`).
+
+## Errors
+- `ModelingError: fillet: the radius is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)`
+- `KernelError: fillet failed (SM_ERR): the radius may be too large for the selected edges`
+- `KernelError: fillet failed: the size is too large for the selected edges` when the result
+  of rounding only convex edges has more volume than before (smlibpy's own check).
+- `ValueError: 2 radii for 4 edges`; `ValueError: continuity must be G1, G2 or G3`.
+- `ValueError: Edge(...) is not an edge of this part`; with the function form and edges of no
+  part: `ValueError: these edges do not belong to a part; call part.fillet(edges, ...) instead`.
+
+## Example
+```python
+box = Box(40, 30, 20)
+rounded = box.fillet(box.edges().parallel_to(Z), 5)     # 4 vertical edges
+print(round(box.volume - rounded.volume, 4))            # 429.2037 = 4 * (25 - 25*pi/4) * 20
+
+lid = box.fillet(box.faces().top(), 3)                  # a face: its edges
+ramp = box.fillet(box.edges().parallel_to(Z).first, (2, 8))  # radius 2 at the edge start, 8 at its end
+stepped = box.fillet(box.edges().parallel_to(Z), [2, 4, 6, 8])  # one radius per edge, in selection order
+soft = box.fillet(box.edges().parallel_to(Z), 5, continuity="G2")  # curvature-continuous, same setback 5
+
+# different radii that meet at corners: one call with a list, or the larger radius first
+blk = Box(30, 30, 30)
+edges = list(blk.edges().parallel_to(Z)) + list(blk.faces().top().edges())
+both = blk.fillet(edges, [8] * 4 + [3] * 4)
+print(both.is_valid(), round(both.volume, 3))           # True 25154.747
+
+# concave edges add material
+part = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
+part += Cylinder(10, 12, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
+part = part.fillet(part.edges().concave(), 2)           # root of the boss
+
+# rounding a hole's rim: select the circle by radius and height
+plate = Box(60, 40, 8) - Cylinder(5, 20)
+rim = plate.edges().circles().filter(lambda e: abs(e.radius - 5) < 1e-6 and e.center().z > 0)
+plate = plate.fillet(rim, 1)
+
+cube = Box(10, 10, 10)
+try:
+    cube.fillet(cube.edges(), 6)
+except ModelingError as e:
+    print(e)   # fillet: the radius is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)
+```
+
+## Related
+`chamfer`, `shell`, `Sketch.fillet` (2D corners), `Wire.fillet`, `FilletPolyline`,
+`ShapeList.concave()`, `ShapeList.parallel_to()`.
diff --git a/src/smlibpy/skill/references/features/chamfer.md b/src/smlibpy/skill/references/features/chamfer.md
new file mode 100644
index 0000000..5bdf273
--- /dev/null
+++ b/src/smlibpy/skill/references/features/chamfer.md
@@ -0,0 +1,56 @@
+# chamfer
+
+Bevels edges of a part with a flat face.
+
+## Signature
+`part.chamfer(edges, length)`
+`chamfer(edges, length)` (finds the part the edges belong to)
+
+- `edges`: a selection, one `Edge`, or faces (all their edges).
+- `length`: the setback, measured along **both** faces from the edge. Equal on both sides,
+  also where the faces are not perpendicular (an acute 26.6° edge with length 2: both new
+  corners 2.000 from the old edge).
+- There is no angle and no second distance: `chamfer(edge, (2, 3))` raises `TypeError`. For
+  an unequal bevel, cut with a prism (`extrude` a triangle sketch placed at the edge).
+
+## Returns
+A new `Part`. Removed volume per straight 90° edge: `length² / 2 * edge length`. Concave edges
+add material. Circular edges (hole rims, cylinder ends) work: a hole rim chamfer is a
+countersink-like bevel.
+
+## Limits
+Same rules as `fillet` with the setback = `length`: two chamfered edges `d` apart on one face
+allow `length <= d/2` (exactly `d/2` raises `KernelError`), one chamfered edge `length <= d`
+(exactly `d` removes the whole face: one edge of a 10 cube with 10 leaves a prism of 500).
+`length <= 0` raises `KernelError`.
+
+## Gotchas
+- Seam and smooth edges in the selection are skipped, like for `fillet`.
+- Give all edges that meet at a corner in one call; the corners are then cut cleanly
+  (40x30x20 box, all edges, 2: vol 23322.667 = exact polyhedron).
+
+## Errors
+- `ModelingError: chamfer: the length is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)`
+- `KernelError: chamfer failed (SM_ERR): the length may be too large for the selected edges`
+
+## Example
+```python
+box = Box(40, 30, 20)
+bevel = box.chamfer(box.edges().parallel_to(Z), 2)      # 2 along both faces
+print(round(box.volume - bevel.volume, 3))              # 160.0 = 4 * 2*2/2 * 20
+
+top = box.chamfer(box.faces().top(), 2)                 # all edges of the top face
+also = chamfer(box.faces().top().edges(), 2)            # function form: finds the part
+
+plate = Box(40, 40, 10) - Cylinder(5, 20)
+rim = plate.edges().circles().filter(lambda e: e.center().z > 0)
+plate = plate.chamfer(rim, 1.5)                         # countersink-like bevel on the hole
+print(plate.is_valid(), round(plate.volume, 3))         # True 15175.73
+
+tri = Polygon((0, 0), (40, 0), (0, 20)).extrude(10)
+sharp = tri.edges().parallel_to(Z).nearest((40, 0, 0))  # acute 26.6-degree edge
+tip = tri.chamfer(sharp, 2)                             # still 2 along each face
+```
+
+## Related
+`fillet`, `CounterSinkHole`, `ShapeList.circles()`.
