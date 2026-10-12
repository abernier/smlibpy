diff --git a/src/smlibpy/skill/references/deform/generic.md b/src/smlibpy/skill/references/deform/generic.md
new file mode 100644
index 0000000..6e28806
--- /dev/null
+++ b/src/smlibpy/skill/references/deform/generic.md
@@ -0,0 +1,88 @@
+# Deformations: what they share
+
+`twist`, `taper`, `bend` and `Lattice` deform an existing part: every point of space moves,
+and the whole body with it. All faces, edges and vertices go through the same map, so the
+result is again a closed solid with the same topology (`len(part.faces())` does not change,
+except where a range splits faces, see below). Holes, fillets and pockets deform with the part.
+Methods on `Part`: `part.twist(...)`, `part.taper(...)`, `part.bend(...)`,
+`part.deform(lattice)`; functions `twist(shape, ...)`, ... also take a `Shell` or `Sketch`
+(result: `Shell`).
+
+## Exact or within a tolerance
+| Deformation | Result |
+|---|---|
+| `Lattice`, `taper` | exact NURBS: every face is the exact image (degree up to `MAX_DEGREE` = 12) |
+| `twist`, `bend` | faces within `tolerance` (1e-6 mm) of the exact image, quintic B-splines |
+
+Twist and bend use sines and cosines, which no NURBS reproduces. Where the image is still
+polynomial it stays exact: the ends of a twisted bar are only turned, the straight rulings
+of its sides stay straight (degree 1 across), a bent bar's end faces are planes. A face whose
+exact lattice image needs more than degree 12 (a sphere in a 4 x 4 x 4 lattice needs 18) or
+more than 40000 control points (the offset face of a thickened free-form surface, 11025
+poles, would get 514794) is fitted within the tolerance instead. Every face keeps its parameterization, so its trim
+curves are the original ones. All faces come back as `geom_type == "bspline"`, even the
+planes (selectors such as `.planar()` still find the flat ones).
+
+## Ranges (`start`, `end`)
+twist, taper and bend act between `start` and `end` (distances along the axis, or along the
+bend plane's `x_dir`, from its origin; default: the part's extent). Before `start` the part
+stays; beyond `end` it is turned (twist, bend) or scaled (taper) as a whole. Faces crossing
+`start` or `end` are split there first: `Box(16, 16, 200).twist(360, start=-50, end=50)` has
+14 faces instead of 6; the faces outside the range keep their analytic type (`plane`).
+
+## Checking the result
+- Volumes: a twist keeps the volume; a taper changes it exactly as the scaled cross-sections
+  say; a bend keeps it when the neutral layer runs through the middle of the cross-section,
+  otherwise V' = V * (1 - y_c / radius) for the whole part bent (Pappus; y_c = distance of
+  the centroid from the neutral layer toward the bend axis).
+- **Measure with `part.mass_properties(accuracy=1e-10).volume`.** The default `part.volume`
+  is the kernel's integration at 1e-7 and can be 4e-4 off on bent parts (bar bent 90°:
+  10003.546 instead of 10000; at 1e-10: 10000.000243). Face areas are exact at the default.
+- Every result is checked: a broken or folded body raises `ModelingError`, a lattice that
+  turns space inside out is refused before it runs.
+
+## Gotchas
+- Meshes of twisted faces are coarser than the mesh tolerance asks: the kernel's
+  tessellator does not split a twisted face across its straight rulings. `Box(20, 20,
+  100).twist(90).mesh()` (default tolerance 0.105) is up to 0.48 mm off the surface and 5 %
+  too large; at `tolerance=0.001` still 0.027 mm. STEP is exact; for STL use a small
+  tolerance and check `mesh.volume` against the part.
+- `offset()` of twisted, tapered or bent parts usually fails outward (`ModelingError: offset:
+  the kernel could not build a valid result`); `shell()` works.
+- Self-intersection is not detected: a bend of more than 180° with long legs makes the legs
+  cross and still passes `is_valid()`. Keep `start`/`end` and the legs apart.
+- Booleans, fillets, chamfers and shells work on deformed parts. Order matters: features
+  made before the deformation deform with the part, features added after it do not (a hole
+  drilled after a twist keeps its cylinder wall; drilled before, it twists along).
+
+## Errors
+- `ValueError`: angle 0 or not finite, scale not positive or 1, tolerance not positive, end
+  before start, a bend of 360° or more.
+- `ModelingError: ... does not reach the part` when the range misses the part;
+  `bend: the part reaches ... toward the bend axis` when the radius is too small;
+  `lattice: the lattice folds the part onto itself near (x, y, z)`.
+
+## Example
+```python
+def check(tag, part, expected=None):
+    v = part.mass_properties(accuracy=1e-10).volume    # Part.volume can be 4e-4 off for bent parts
+    ok = part.is_valid() and (expected is None or abs(v - expected) <= 1e-6 * expected)
+    print(tag, ok, len(part.faces()), round(v, 3))
+    return ok
+
+check("twist", Box(20, 20, 100).twist(90), 40000)            # a twist keeps the volume
+check("bend", Box(100, 10, 10).bend(90), 10000)              # neutral layer through the middle: kept
+r = 100 / (math.pi / 2)
+check("bend, neutral at the bottom", Box(100, 10, 10).bend(90, plane=Plane((0, 0, -5), (1, 0, 0), (0, -1, 0))),
+      10000 * (1 - 5 / r))                                   # Pappus: layers above the neutral one shorten
+check("taper", Cylinder(10, 50).taper(0.5), math.pi * 50 / 3 * (100 + 50 + 25))
+lat = Lattice(Box(60, 40, 20), 3)
+lat.move((1, 1, -1), (0, 0, 8))
+check("lattice", lat.apply(Box(60, 40, 20)))
+```
+prints `twist True 6 40000.0`, `bend True 6 10000.0`, `bend, neutral at the bottom True 6
+9214.602`, `taper True 3 9162.979`, `lattice True 6 50133.333`.
+
+## Related
+`deform/twist`, `deform/taper`, `deform/bend`, `deform/Lattice`, `recipes/deform`;
+`sweep` and `loft` (model the shape directly), `extrude(taper=...)`.
diff --git a/src/smlibpy/skill/references/deform/twist.md b/src/smlibpy/skill/references/deform/twist.md
new file mode 100644
index 0000000..450c985
--- /dev/null
+++ b/src/smlibpy/skill/references/deform/twist.md
@@ -0,0 +1,66 @@
+# twist
+
+Turns every cross-section of a part about an axis, by an angle that grows evenly along it.
+
+## Signature
+`twist(shape, angle, *, axis=Z, start=None, end=None, tolerance=None)` or
+`part.twist(angle, ...)`
+
+- `angle`: degrees between `start` and `end`, counterclockwise seen from the tip of
+  `axis` (right-hand rule, as `rotate`). Negative turns the other way; 720 is fine.
+- `axis`: an `Axis` (a line, not a direction): `Z` is the world Z axis through the origin.
+  Twist about the part's own center line with `Axis(part.center(), (0, 0, 1))` when the part
+  is not centered on the origin; about another axis, the part swings around it.
+- `start`, `end`: distances along `axis` from `axis.origin`. Default: the part's extent, so
+  `twist(90)` turns the far end by exactly 90°. A range beyond the part turns the part by
+  its share: `Box(16, 16, 200).twist(45, start=-100, end=300)` turns the top by 22.5°.
+- `tolerance`: largest distance of the twisted faces from the exact twist, mm (default
+  1e-6). Measured on a hexagonal prism twisted 360°: 1e-3 gives 2.1e-4 and 164 poles, 1e-6
+  gives 3.8e-8 and 452 poles, 1e-8 gives 5.8e-10 and 836 poles; all within 0.02 s.
+
+## Returns
+A `Part` (`Shell` for a shell or sketch), same faces, edges and vertices, same volume.
+Before `start` the part is unchanged; beyond `end` it is turned rigidly by `angle`.
+
+## Exactness
+The faces are quintic B-splines within the tolerance, except what the twist only turns:
+faces across the axis stay planes (degree 1 x 1), and the straight rulings of side faces
+stay straight (degree 1 across: a twisted box side is degree 1 x 5, 26 poles). Faces outside
+the range keep their type (`plane`, `cylinder`).
+
+## Gotchas
+- A range inside the part splits the faces crossing `start` and `end`: a baluster
+  `Box(16, 16, 200).twist(360, start=-50, end=50)` has 14 faces (4 twisted, 10 planes).
+- `Box(20, 10, 100).twist(90)` turns the top by 90°: the 20 x 10 top becomes 10 wide and 20
+  deep. A square turned by 90° or 360° looks unchanged at the ends; check the middle.
+- The bounding box grows to the turned corners (11.18 for a 20 x 10 bar).
+- Meshes and renders of twisted faces are coarse: one facet across each twisted face
+  (kernel tessellator). `Box(20, 20, 100).twist(90).mesh()` is up to 0.48 mm off and 5 % too
+  large; use a small mesh tolerance for STL. STEP is exact.
+- `offset()` of a twisted part fails outward; `shell()` works.
+
+## Errors
+- `ValueError: twist: angle is 0; nothing to do`, `... must be a finite number of degrees`.
+- `ValueError: twist: end (1) must lie beyond start (3)`.
+- `ModelingError: twist: the range 20 to 30 does not reach the part, which spans -5 to 5`.
+
+## Example
+```python
+bar = Box(20, 10, 100).twist(90)                     # a quarter turn over the whole length
+print(len(bar.faces()), round(bar.mass_properties(accuracy=1e-10).volume, 3))      # 6 20000.0
+print(sorted((round(v.x, 6), round(v.y, 6)) for v in bar.vertices() if v.z > 49))  # top: 10 wide, 20 deep
+
+baluster = Box(16, 16, 200).twist(360, start=-50, end=50)   # only z -50..50 turns
+print(len(baluster.faces()))                         # 14: the sides are split at z -50 and 50
+
+vase = RegularPolygon(30, 6).extrude(120).twist(60)
+vase = vase.shell(2.5, vase.faces().sort_by(Z)[-1])  # hollow, open at the top
+print(vase.is_valid(), round(vase.mass_properties(accuracy=1e-10).volume, 1))
+
+plate = Box(80, 60, 10).twist(30, axis=Axis((0, 0, 0), (0, 1, 0)))  # about Y
+print(plate.is_valid(), round(plate.mass_properties(accuracy=1e-10).volume, 3))
+```
+prints `6 20000.0`, the top corners `(±5, ±10)`, `14`, `True 56287.4`, `True 48000.001`.
+
+## Related
+`deform/generic`, `taper`, `bend`, `Lattice`; `sweep` along a `Helix` for threads and springs.
diff --git a/src/smlibpy/skill/references/deform/taper.md b/src/smlibpy/skill/references/deform/taper.md
new file mode 100644
index 0000000..af19768
--- /dev/null
+++ b/src/smlibpy/skill/references/deform/taper.md
@@ -0,0 +1,59 @@
+# taper
+
+Scales the cross-sections of a part toward an axis, by a factor that changes evenly along it.
+
+## Signature
+`taper(shape, scale, *, axis=Z, start=None, end=None, tolerance=None)` or
+`part.taper(scale, ...)`
+
+- `scale`: the size at `end` relative to `start` (> 0): 0.5 halves the cross-section, 2
+  doubles it. The factor is 1 at `start` and changes linearly; lines along the axis stay
+  straight.
+- `axis`: an `Axis` (a line): cross-sections shrink toward it, so a part off the axis also
+  moves toward it. `X`, `Y`, `Z` are the world axes through the origin.
+- `start`, `end`: distances along `axis` from `axis.origin`; default the part's extent.
+  Before `start` the part stays; beyond `end` it is scaled by `scale` across the axis.
+- `tolerance`: only for a face whose exact image would exceed degree 12 (none of the
+  primitives does).
+
+## Returns
+A `Part` (`Shell` for a shell or sketch), same faces, edges and vertices. **Exact**: a
+taper is a polynomial map, every face is its exact image. A cylinder becomes a cone (side
+degree 2 x 1, rational; top radius exactly half for 0.5), a box a frustum of a pyramid.
+
+## Gotchas
+- `taper(0.5)` scales the cross-section, not the angle: a 20 x 20 x 50 box becomes a
+  frustum with a 10 x 10 top, volume 50 / 3 * (400 + 100 + 200) exactly.
+- With a range the side faces are split at `start`/`end` (`Box(20, 20, 50).taper(0.5,
+  start=0)` has 10 faces). `end=0` tapers the lower half and scales the upper half by 0.5.
+- Holes and fillets made before the taper taper with it: a 10 mm hole across the middle of
+  `Box(40, 40, 60)` tapered by 0.5 comes out 7.5 wide and 10 tall. Add features that must
+  stay round after tapering. An off-axis part shrinks toward the axis:
+  `Box(20, 20, 50, align=(Align.MIN,) * 3).taper(0.5)` has its top at x, y 0..10.
+- `offset()` of a tapered part fails outward. Unlike `extrude(taper=...)` (a draft angle on
+  a profile), `taper` works on any finished part and scales instead of drafting.
+
+## Errors
+- `ValueError: taper: scale must be a positive number (1 keeps the size)`; `scale is 1`.
+- `ModelingError: taper: the range ... does not reach the part`.
+
+## Example
+```python
+cone = Cylinder(10, 50).taper(0.5)                   # exact frustum of a cone
+print(round(cone.mass_properties(accuracy=1e-10).volume, 3), round(math.pi * 50 / 3 * (100 + 50 + 25), 3))
+
+grip = Cylinder(12, 90)
+grip = grip.fillet(grip.edges(), 4).taper(0.75)      # the rounds taper with it
+print(grip.is_valid(), len(grip.faces()))
+
+post = Box(40, 40, 60).taper(1.4, start=10)          # flares from z = 10 up, 1.4 x at the top
+print(post.bbox())
+
+wedge = Box(100, 20, 20).taper(0.25, axis=X)         # along X: a quarter of the size at x = 50
+print(round(wedge.mass_properties(accuracy=1e-10).volume, 3))
+```
+prints `9162.979 9162.979`, `True 5`, a box of ±28 x ±28 x ±30, `17500.0`.
+
+## Related
+`deform/generic`, `twist`, `Lattice` (scale a layer for non-linear tapers);
+`extrude(taper=...)` for drafted extrusions of a profile.
diff --git a/src/smlibpy/skill/references/deform/bend.md b/src/smlibpy/skill/references/deform/bend.md
new file mode 100644
index 0000000..8642151
--- /dev/null
+++ b/src/smlibpy/skill/references/deform/bend.md
@@ -0,0 +1,88 @@
+# bend
+
+Bends a part around an axis, like a bar bent over a mandrel: the whole part into an arc, or
+a section of it with straight legs on both sides.
+
+## Signature
+`bend(shape, angle, *, radius=None, plane=Plane.XZ, start=None, end=None, tolerance=None)`
+or `part.bend(angle, ...)`
+
+- `plane` sets everything: `x_dir` runs along the part, a positive `angle` bends toward
+  `y_dir`, the bend axis is parallel to the plane normal, and the layer through
+  `plane.origin` spanned by `x_dir` and the normal is the **neutral layer** (keeps its
+  length; material on the inside is compressed, outside stretched). Default `Plane.XZ`: a
+  part along X bends up toward +Z. `Plane.XY` bends toward +Y.
+- `angle`: degrees the part turns, positive toward `y_dir`, |angle| < 360.
+- `radius`: bend radius of the neutral layer. The bend axis lies `radius` from the neutral
+  layer on the side the part bends toward.
+- `start`, `end`: the bent section, as distances along `x_dir` from `plane.origin`.
+
+| given | bent section |
+|---|---|
+| nothing | the whole part (radius = length / angle): `Box(100, 10, 10).bend(90)` -> radius 63.662 |
+| `radius` | length radius * angle, **centered on the plane origin** |
+| `radius`, `start` (or `end`) | starts (or ends) there |
+| `start`, `end` | between them; radius = (end - start) / angle |
+
+Before `start` the part stays; beyond `end` it goes on straight, turned by `angle`.
+
+## Returns
+A `Part` (`Shell` for a shell or sketch), same faces (more when the section is inside the
+part: the faces are split at its ends). Faces within the tolerance (default 1e-6 mm);
+straight lines along the axis and end faces stay exact; the legs keep their analytic types
+(the U below: 4 B-spline faces in the bend, 10 planes).
+Volume: kept when the neutral layer runs through the middle of the cross-section;
+otherwise each layer at distance y toward the axis is scaled by (radius - y) / radius
+(Pappus): neutral layer at the bottom of a 10 mm bar bent 90° over its 100 mm: 9214.602
+instead of 10000.
+
+## Gotchas
+- With only `radius`, the bend is centered on the plane origin, not at the part's end:
+  `Box(160, 10, 6).bend(180, radius=25)` bends x -39.27..39.27; the leg before it stays at
+  x -80..-39.27 and the other comes back above it (bbox x -80..-11.27, z -3..53).
+- Bending a centered part from its end: `start=` the part's minimum, or move the plane.
+  `Box(100, 10, 10).bend(-90, radius=20, start=10)` goes down from x = 10 (bbox z to -28.58).
+- The neutral layer is the plane origin's layer, not the part's middle: a part lying on
+  z 0..10 bent with the default plane has its neutral layer at its bottom.
+- Material must not reach the bend axis: `radius` larger than the part's thickness on the
+  inside (from the neutral layer).
+- Bends over 180° with long legs make the legs cross; that is not detected (`Box(200, 10,
+  10).bend(270, radius=10)` passes `is_valid()`).
+- `part.volume` can be 4e-4 off on bent parts (kernel integration); use
+  `mass_properties(accuracy=1e-10)`. `offset()` fails outward; `shell()` works: bend a solid
+  tube, then shell it with the end faces open (or bend a hollow tube: same volume).
+
+## Errors
+- `ModelingError: bend: the part reaches 5 mm from the neutral layer toward the bend axis,
+  which is only 4 mm away; bend with a larger radius ...`.
+- `ValueError: bend: angle must be less than 360 degrees ...`.
+- `ValueError: bend: start and end are 5 apart, but radius 10 and angle 90 need 15.708; give
+  only two of radius, start and end`.
+- `ModelingError: bend: the bend (60 to 75.708 along x_dir from the plane origin) does not
+  reach the part, which spans -50 to 50`.
+- `TypeError: bend: plane must be a Plane ...` (an `Axis` is not accepted).
+
+## Example
+```python
+bar = Box(100, 10, 10).bend(90)                      # the whole bar: a quarter circle, radius 100 / (pi/2)
+print(bar.bbox(), round(bar.mass_properties(accuracy=1e-10).volume, 3))   # volume kept: 10000.0
+
+hook = Box(160, 10, 6).bend(180, radius=25)          # U shape: the bend is centered on x = 0
+print(hook.bbox())
+
+elbow = Cylinder(6, 150).rotate(Y, 90).bend(90, radius=30)   # pipe elbow with straight legs
+pipe = elbow.shell(1, elbow.faces().planar())               # hollow, open ends
+print(pipe.is_valid(), round(pipe.mass_properties(accuracy=1e-10).volume, 3))
+
+down = Box(100, 10, 10).bend(-90, radius=20, start=10)     # down from x = 10
+print(down.bbox())
+
+side = Box(100, 10, 10).bend(90, plane=Plane.XY)           # toward +Y instead of +Z
+print(side.bbox())
+```
+prints bbox x -50..18.662, z -5..63.662 and `10000.0`; x -80..-11.27, z -3..53; `True
+5183.628` (= pi * (36 - 25) * 150); z down to -28.584; y up to 63.662.
+
+## Related
+`deform/generic`, `twist`, `taper`; `sweep` along a path with arcs when you draw the path
+anyway (a tube with several bends).
diff --git a/src/smlibpy/skill/references/deform/Lattice.md b/src/smlibpy/skill/references/deform/Lattice.md
new file mode 100644
index 0000000..c108e5e
--- /dev/null
+++ b/src/smlibpy/skill/references/deform/Lattice.md
@@ -0,0 +1,82 @@
+# Lattice
+
+Free-form deformation: a grid of control points around a part; move the points, apply the
+lattice, and the part follows smoothly. The result is exact NURBS.
+
+## Signature
+`Lattice(box, counts=3, *, margin=0.0)`; `lat.apply(shape, *, tolerance=None)` or
+`part.deform(lat)`
+
+- `box`: a `BoundBox` or a shape (its bounding box). `margin` grows it on every side; flat
+  shapes need one (`ValueError: ... give a margin for flat shapes`).
+- `counts`: points per direction, one int or three (X, Y, Z), 2 to 12. 2 = corners only (a
+  trilinear map), 3 = corners and midpoints (default), more = finer control.
+- `lat.points`: writable numpy array `(nx, ny, nz, 3)` of world positions, `[i, j, k]` along
+  X, Y, Z, starting evenly on the box. `lat.rest` (start positions, read-only),
+  `lat.offsets` (points - rest), `lat.counts`, `lat.box`.
+- Editing, **in place**, each returns the lattice: `move(index, offset)`,
+  `scale(index, factor, center=None)` (about the selection's centroid; factor one number or
+  (fx, fy, fz)), `rotate(index, axis, angle)`, `reset()`; `copy()` for an independent one.
+- `index`: three indices with ints and slices, `(1, 1, -1)`, `(slice(None), 0, 2)`, or
+  `lat.layer(axis, i)` = the i-th layer across `X`, `Y` or `Z` (`lat.layer(Z, -1)` = top).
+- `lat.map(point)`: where a point moves.
+
+## Returns
+A `Part` (`Shell` for a shell or sketch) with the same faces; the map is a Bezier volume
+(Bernstein polynomials of degree count - 1), so every face is its **exact** image. Degrees
+measured: box faces up to (counts - 1) per direction ((2, 2) in a 3 x 3 x 3 lattice); with
+the top layer of a 3 x 3 x 3 lattice scaled, a cylinder side (4, 2) and a sphere (6, 6);
+one point of a 3 x 3 x 3 lattice moved, a sphere (12, 12) with 1225 poles. A face needing
+more than degree 12 (`MAX_DEGREE`), such as a sphere with one point of a 4 x 4 x 4
+lattice moved, is fitted within `tolerance` instead (quintic, 2925 poles). An unmoved
+lattice changes nothing.
+
+## How points act
+A point pulls the region around it, weighted by Bernstein polynomials: moving the middle
+point of the top layer of a 3 x 3 x 3 lattice by 8 lifts the middle of the top face by
+8 * 1/2 * 1/2 = 2 (`lat.map((0, 0, 10))` -> `(0, 0, 12)`); corners move fully. Move whole
+layers for global changes (bulge, taper, twist a layer), single points for local ones; more
+points give more local control.
+
+## Gotchas
+- `scale` of a single point does nothing (it scales about its own centroid); scale a layer.
+- The editing methods change the lattice; `lat.copy()` before trying variants.
+- Moving a point past its neighbours folds space: refused with `ModelingError: lattice:
+  the lattice folds the part onto itself near (x, y, z) ...`.
+- Space outside the box follows the same polynomial (no clamping): keep the part inside.
+- Higher counts raise the degree of the exact faces; curved parts in big lattices get large
+  control nets. Use the fewest points that give the shape.
+
+## Errors
+- `ValueError: Lattice: counts must be 2 to 12 points per direction (one int or three)`.
+- `IndexError: Lattice: select points with three indices (i, j, k) ...`;
+  `IndexError: Lattice.layer: index 3 is out of range for 3 layers`.
+
+## Example
+```python
+block = Box(60, 40, 20)
+lat = Lattice(block, 3)                              # 3 x 3 x 3 points on the block's bounding box
+lat.move((1, 1, -1), (0, 0, 8))                      # lift the middle of the top layer
+pillow = lat.apply(block)
+print(pillow.is_valid(), round(pillow.mass_properties(accuracy=1e-10).volume, 3))
+print(lat.map((0, 0, 10)))                           # the middle of the top moves 8 * 1/2 * 1/2
+
+lat = Lattice(block, 4)
+lat.move(lat.layer(Z, -1), (0, 0, 5))                # the whole top layer up
+lat.scale(lat.layer(Z, -1), 1.3)                     # and wider (about its centroid)
+lat.rotate(lat.layer(Z, -1), Z, 15)                  # and turned
+lat.points[0, :, :, 0] -= 4                          # numpy works too: the -X layer out by 4
+print(lat.apply(block).bbox())
+
+grip = Cylinder(14, 100).rotate(Y, 90)
+gl = Lattice(grip, (5, 3, 3))
+gl.scale(gl.layer(X, 2), (1, 1.25, 1.25))            # thicker in the middle
+handle = grip.deform(gl)                             # same as gl.apply(grip)
+print(handle.bbox())
+```
+prints `True 50133.333`, `Vector(0, 0, 12)`, a box x -48.40..44.40, y ±35.21, z -10..15, and
+y, z ±15.31.
+
+## Related
+`deform/generic`, `taper` (a 2 x 2 x 2 lattice with a scaled end), `twist`, `bend`;
+`surface` for free-form faces drawn from points.
diff --git a/src/smlibpy/skill/recipes/deform.md b/src/smlibpy/skill/recipes/deform.md
new file mode 100644
index 0000000..96f2102
--- /dev/null
+++ b/src/smlibpy/skill/recipes/deform.md
@@ -0,0 +1,83 @@
+# Deforming parts
+
+`twist`, `taper`, `bend` and `Lattice` change a finished part as a whole: model it straight
+and simple, with the features that should follow the deformation, then deform it. The
+guides are `deform/generic`, `deform/twist`, `deform/taper`, `deform/bend`, `deform/Lattice`.
+
+## Deform, or model the shape directly?
+
+Deform when a simple part gets a smooth overall change and its features should go along:
+
+| Shape | Deform | Instead of |
+|---|---|---|
+| twisted vase, column, baluster, flutes | extrude the section, `twist` (a range for a baluster) | a loft between turned sections (pinches between them) |
+| twisted blade, propeller, mixer paddle | blade with its fillets, `twist(start=...)` so the root stays, fuse to the hub | sweeping a profile along a helix (rolls it) |
+| bent handle, bracket, tube with holes or flats | model straight, drill and slot, then `bend` (the features bend along) | sweeping the profile along a path and cutting curved features afterwards |
+| tapered grip, leg, post, tool shank | `taper` (exact; fillets taper along) | `extrude(taper=...)` (only a profile, only a draft angle) |
+| pillow tops, ergonomic bodies, bulges | a rounded box and a `Lattice` | stitching free-form surfaces |
+
+Model directly when:
+- the result needs analytic faces downstream (a bent or twisted face is a B-spline; a tube
+  with several bends along a drawn path is easier as `sweep`),
+- the result will be offset outward (`offset()` usually fails on deformed parts),
+- the change is local (a boss, a pocket): Booleans keep everything else exact,
+- a feature must keep its exact shape: add it after the deformation.
+
+## Order of operations
+
+1. Build the straight part and the features that should deform with it (holes in a bent
+   handle, fillets of a blade).
+2. Deform. One deformation per step; chaining is fine (`part.taper(0.8).twist(45)`).
+3. Add the features that must keep their shape (bores, flats, mounting holes) and their
+   fillets.
+4. Check: `is_valid()`, the face count (unchanged unless a range split faces), the volume
+   with `mass_properties(accuracy=1e-10)` against the rule (twist: same; bend about the
+   middle layer: same; taper: the scaled cross-sections), and a snapshot.
+
+## Patterns
+
+```python
+# twisted vase: a star profile, twisted, then hollowed
+star = Polygon(*[(r * math.cos(math.radians(a)), r * math.sin(math.radians(a)))
+                 for i, a in enumerate(range(0, 360, 30)) for r in [30 if i % 2 == 0 else 24]])
+vase = star.extrude(120).twist(90)
+vase = vase.shell(2.5, vase.faces().sort_by(Z)[-1])
+print(vase.is_valid(), len(vase.faces()))                        # True 27
+
+# twisted blade with a straight root, fused to a hub
+blade = Rectangle(60, 6).extrude(150)
+blade = blade.fillet(blade.edges().parallel_to(Z), 2.9).twist(40, start=10)
+fan = Box(70, 20, 20).translate(0, 0, -10) + blade
+print(fan.is_valid(), len(fan.faces()))
+
+# bent handle: holes first, then bend; the legs come back over each other
+bar = Box(200, 20, 8) - Locations((-80, 0, 0), (80, 0, 0)) * Cylinder(3, 20)
+handle = bar.bend(180, radius=30)
+holes = [f for f in handle.faces() if f.geom_type == "cylinder"]
+print(handle.is_valid(), sorted((round(f.center().x, 3), round(f.center().z, 3)) for f in holes))
+
+# tapered grip, bored after the taper so the bore stays round
+grip = Cylinder(12, 90)
+grip = grip.fillet(grip.edges(), 4).taper(0.75) - Cylinder(4, 100)
+print(grip.is_valid(), [f.geom_type for f in grip.faces()].count("cylinder"))
+
+# pillow top with a lattice
+block = Box(80, 50, 20)
+block = block.fillet(block.edges().parallel_to(Z), 10)
+lat = Lattice(block, 3)
+lat.move((1, 1, -1), (0, 0, 6))
+cushion = lat.apply(block)
+print(cushion.is_valid(), round(cushion.bbox().max.z, 3))
+```
+prints `True 27`, `True 23`, `True [(-80.0, -0.0), (-80.0, 60.0)]` (the two holes line up
+60 apart), `True 1`, `True 11.5`.
+
+## Limits
+- Twist and bend are within `tolerance` (1e-6 mm); lattices and tapers are exact up to
+  degree 12.
+- Meshes, STL and snapshots of twisted faces are coarse (one facet across each twisted face);
+  STEP is exact. Mesh with a small tolerance and compare `mesh.volume` with the part.
+- `part.volume` can be 4e-4 off on bent parts; measure with `mass_properties(accuracy=1e-10)`.
+- Bends stay under 360°; legs crossing after a large bend are not detected.
+- A lattice point moved past its neighbours folds space and is refused.
+- A range inside the part splits the faces it crosses (more faces).
diff --git a/src/smlibpy/skill/SKILL.md b/src/smlibpy/skill/SKILL.md
index 8919067..a0cc9d4 100644
--- a/src/smlibpy/skill/SKILL.md
+++ b/src/smlibpy/skill/SKILL.md
@@ -1,6 +1,6 @@
 ---
 name: smlibpy
-description: Model exact 3D CAD parts in Python with smlibpy, the Python library on SMLib (NVIDIA's open-source NURBS solid modeling kernel). Solids, sketches, holes, fillets (also G2), shells, lofts, sweeps, freeform surfaces, measurements, STEP/STL/glTF export and STEP import. Use when building, checking or exporting CAD geometry with smlibpy, directly or through the smlibpy MCP server (tools run_script, snapshot, docs).
+description: Model exact 3D CAD parts in Python with smlibpy, the Python library on SMLib (NVIDIA's open-source NURBS solid modeling kernel). Solids, sketches, holes, fillets (also G2), shells, lofts, sweeps, freeform surfaces, twist/taper/bend/lattice deformations, measurements, STEP/STL/glTF export and STEP import. Use when building, checking or exporting CAD geometry with smlibpy, directly or through the smlibpy MCP server (tools run_script, snapshot, docs).
 license: MIT
 ---
 
@@ -67,6 +67,7 @@ classcad.ch account). A part made here opens in ClassCAD as a solid through STEP
 | sketches | `sketches/*` | Sketch, 2D shapes (Rectangle, Circle, Polygon, Slot, ...), make_face, 2D offset and fillet |
 | curves | `curves/*` | Line, arcs, Spline, Bezier, Helix, Polyline, Wire |
 | features | `features/*` | extrude, revolve, loft, sweep, fillet, chamfer, shell, offset, mirror, split, section, thicken, draft, heal |
+| deform | `deform/*` | twist, taper, bend and Lattice (free-form deformation) of finished parts, exact NURBS results |
 | surfaces | `surfaces/*` | surface, ruled, stitch, Shell |
 | analysis | `analysis/*` | mass properties, measures, distances, intersections, silhouettes, projections, validity |
 | files | `files/*` | STEP in and out, STL, glTF, OBJ, the native format, render, show, meshes |
@@ -79,3 +80,5 @@ Each domain has a `generic.md` with the concepts; the other docs are named after
 - `recipes/verification`: what to check after each step, and how.
 - `recipes/modeling`: the patterns that work (plates, holes, bosses, revolved parts, shells,
   sweeps along helices) and the order of operations.
+- `recipes/deform`: when to twist, taper, bend or lattice-deform a part instead of modeling
+  the shape directly (twisted vases and blades, bent tubes and handles, tapered grips).
