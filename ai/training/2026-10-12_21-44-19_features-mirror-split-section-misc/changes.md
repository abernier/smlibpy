diff --git a/src/smlibpy/skill/references/features/mirror.md b/src/smlibpy/skill/references/features/mirror.md
new file mode 100644
index 0000000..5bfc45c
--- /dev/null
+++ b/src/smlibpy/skill/references/features/mirror.md
@@ -0,0 +1,48 @@
+# mirror (operation)
+
+Makes a mirrored copy of a shape. It does not fuse: add the copy to the original yourself.
+
+## Signature
+`shape.mirror(plane=Plane.XZ)`
+`mirror(shape, plane=Plane.XZ)`
+
+- `plane`: a `Plane`. **The default is `Plane.XZ`, which flips Y**, not X. Pass the plane
+  explicitly: `Plane.YZ` flips X, `Plane.XY` flips Z, `Plane.YZ.offset(30)` mirrors about x = 30.
+- A face is not accepted directly (`AttributeError: 'Face' object has no attribute 'z_dir'`);
+  pass `face.plane`.
+- Works on parts, sketches, faces, edges and wires.
+
+## Returns
+A shape of the same type: same volume, valid, mirrored position. Fused with the original
+(`half + half.mirror(Plane.YZ)`) the touching faces disappear and coplanar faces merge into one
+solid (14 faces for the example below, not 20).
+
+## Gotchas
+- Halves that only touch fuse into one solid; halves with a gap stay two solids in one `Part`
+  (check `len(part.solids())`); overlapping halves fuse normally.
+- **A mirrored sketch has its normal flipped**: `Rectangle(10, 6).translate(10, 0).mirror(Plane.YZ)`
+  has normal (0, 0, -1), so `.extrude(5)` goes to z -5..0. Mirror the extruded part instead, or
+  extrude the mirrored sketch with a negative amount.
+- Features on the half (fillets, holes) are mirrored with it: build the half completely, then
+  mirror and fuse.
+
+## Example
+```python
+half = Box(20, 10, 10).translate(10, 0, 0)
+half = half.fillet(half.edges().right(), 2)
+whole = half + half.mirror(Plane.YZ)                    # mirror about x = 0, then fuse
+print(len(whole.solids()), len(whole.faces()), round(whole.volume, 3))   # 1 14 3937.463
+
+right = Box(20, 10, 10)
+pair = right + right.mirror(right.faces().right()[0].plane)  # about the part's own face: x = 10
+print(pair.bbox().size.to_tuple())                      # (40.0, 10.0, 10.0)
+
+copy = mirror(half, Plane.YZ.offset(30))                # a copy about x = 30 (no fuse)
+
+sk = Rectangle(10, 6).translate(10, 0).mirror(Plane.YZ)
+print(sk.plane.z_dir.to_tuple())                        # (0, 0, -1): a mirrored sketch extrudes downwards
+```
+
+## Related
+`Plane`, `Part.fuse` (`+`), `split` (cut a part in half before mirroring), patterns
+(`PolarLocations`) for rotational copies.
diff --git a/src/smlibpy/skill/references/features/split.md b/src/smlibpy/skill/references/features/split.md
new file mode 100644
index 0000000..4aa9bc4
--- /dev/null
+++ b/src/smlibpy/skill/references/features/split.md
@@ -0,0 +1,56 @@
+# split
+
+Cuts a part with a plane and keeps one side or both. The cut faces are closed (the result is a
+solid).
+
+## Signature
+`part.split(plane, keep="above")`
+`split(part, plane, keep="above")`
+
+- `plane`: a `Plane`, or a planar face (its plane, normal pointing **out of the part it
+  belongs to**). Curved faces raise `ValueError: a cylinder face has no plane ...`.
+- `keep`: `"above"` = the side the plane normal points to; `"below"` = the other side;
+  `"both"` = a tuple `(above, below)`. Anything else raises
+  `ValueError: keep must be "above", "below" or "both"`.
+
+## Returns
+A `Part` (or two). Exact: both halves of a symmetric part have half the volume.
+Splitting by another body is not supported (`TypeError: cannot use Part as a plane`): use
+`part & body` and `part - body`.
+
+## Which side
+- `Plane.XY` normal is +Z: "above" keeps z > 0. `Plane.bottom` has normal -Z: "above" keeps
+  z < 0. `Plane.XZ`/`Plane.front` normal is -Y.
+- A face of the part itself: its normal points outward, so "above" is outside (empty) and
+  "below" keeps the material. A face of another body uses that body's outward normal.
+- For a tilted cut, build the plane with `Plane(origin=..., z_dir=...)` and point `z_dir` into
+  the side you keep.
+
+## Gotchas
+- **A plane that misses the part, or a side with no material, returns an empty `Part`
+  without an error** (`is_valid()` False, 0 faces, bbox ±1e20). Check `len(result.faces())`.
+- There is no face draft in smlibpy; a split with a tilted plane through a bottom edge makes
+  one drafted wall (example).
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(8, 30)
+upper = part.split(Plane.XY)                            # keeps the side the normal points to: z 0..10
+lower = part.split(Plane.XY, keep="below")              # z -10..0
+right, left = part.split(Plane.YZ, keep="both")         # (above, below) = (x > 0, x < 0)
+low5 = part.split(Plane.XY.offset(5), keep="below")     # everything under z = 5
+
+empty = part.split(Plane.XY.offset(50))                 # nothing above: an empty Part, no error
+print(empty.is_valid(), len(empty.faces()))             # False 0
+
+# drafted wall: cut with a plane through the bottom edge, normal tilted 5 degrees, pointing into the part
+wall = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
+a = math.radians(5)
+drafted = wall.split(Plane(origin=(20, 0, 0), z_dir=(-math.cos(a), 0, -math.sin(a))))
+print(round(drafted.volume, 3))                         # 23475.068
+
+inside, outside = part & Sphere(15), part - Sphere(15)  # "split by a body"
+```
+
+## Related
+`section` (the cut face as a sketch), `mirror`, Booleans `&` and `-`, `Plane`.
diff --git a/src/smlibpy/skill/references/features/section.md b/src/smlibpy/skill/references/features/section.md
new file mode 100644
index 0000000..46caec9
--- /dev/null
+++ b/src/smlibpy/skill/references/features/section.md
@@ -0,0 +1,47 @@
+# section
+
+The cross-section of a part in a plane, as a `Sketch`.
+
+## Signature
+`part.section(plane=Plane.XY)`
+`section(part, plane=Plane.XY)`
+
+- `plane`: a `Plane` or a planar face (its plane). Default `Plane.XY`.
+
+## Returns
+A `Sketch` lying in the plane, with `sketch.plane` equal to the plane you passed (same origin,
+normal and x direction). Holes come back as inner loops; separate pieces as separate faces
+(`len(sketch.faces())`). `area` is exact (`Box(40, 30, 20) - Cylinder(8, 30)` at z 0:
+998.938 = 40·30 − π·8²).
+
+## Uses
+- Measuring: wall thickness, material area at a height, checking a loft or sweep for twist
+  (`loft.section(Plane.XY.offset(mid)).area`).
+- Building: a section is a sketch, so it extrudes along the plane normal
+  (`part.section(Plane.XY.offset(5)).extrude(3)` spans z 5..8).
+
+## Gotchas
+- A plane that misses the part: `ValueError: the plane does not cut the part`.
+- A plane lying on a face of the part returns that face's area.
+- The section's edges are B-splines, also where the part has arcs (a rounded box gives
+  `geom_type == "bspline"` edges): `edges().circles()` finds nothing on a section.
+- The kernel can fail on a plane that passes exactly through a vertex or the end of a sweep
+  (`KernelError: section failed (SM_ERR)`); shift the plane slightly.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(8, 30)
+cut = part.section(Plane.XY)                            # a Sketch on Plane.XY
+print(round(cut.area, 3))                               # 998.938 = 40*30 - pi*8^2
+side = part.section(Plane.XZ)                           # two pieces left and right of the hole
+print(len(side.faces()), round(side.area, 1))           # 2 480.0
+slab = part.section(Plane.XY.offset(5)).extrude(3)      # sections are sketches: z 5..8
+print(slab.bbox().min.z, slab.bbox().max.z)
+try:
+    part.section(Plane.XY.offset(50))
+except ValueError as e:
+    print(e)                                            # the plane does not cut the part
+```
+
+## Related
+`split` (keep a side as a solid), `Part.outline`, `Part.silhouette`, `extrude`.
diff --git a/src/smlibpy/skill/references/features/draft.md b/src/smlibpy/skill/references/features/draft.md
new file mode 100644
index 0000000..e07cd92
--- /dev/null
+++ b/src/smlibpy/skill/references/features/draft.md
@@ -0,0 +1,45 @@
+# draft
+
+Drafting faces of an existing part is **not available**. `Part.draft(faces, angle, neutral_plane)`
+exists but always raises:
+
+`NotImplementedError: face drafts are not available in the open-source kernel yet; use Sketch.extrude(taper=...) for drafted extrusions`
+
+Build drafted walls into the shape instead.
+
+## All side walls: tapered extrusion
+`sketch.extrude(amount, taper=deg)`: positive `taper` narrows away from the sketch. Exact:
+a `RoundedRectangle(60, 40, 5)` with `taper=3` over 20 is 57.904 wide at the top
+(60 − 2·20·tan 3°). Rounded corners stay rounded. See `extrude` for the limits; **holes in the
+profile are lost with taper**, cut them as their own tapered extrusions.
+
+## Pockets and bosses with draft
+A tapered tool from a face: `Rectangle(30, 20).on(top).extrude(-10, taper=5)` is 30 x 20 at the
+face and 28.25 x 18.25 at the bottom (it narrows away from the face), which is the usual mold
+draft for a pocket. Subtract it.
+
+## One wall only: split with a tilted plane
+Put a plane through the edge where the draft starts (the neutral line), tilt its normal by the
+draft angle, point the normal into the part and keep "above". See `split`.
+
+## Other ways
+- `loft` between the bottom outline and a smaller top outline (`ruled=True` for flat walls).
+- Rotated tool bodies subtracted from the part.
+
+## Example
+```python
+# draft
+core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)  # every side wall drafted 3 degrees
+blk = Box(60, 40, 20)
+blk -= Rectangle(30, 20).on(blk.faces().top()).extrude(-10, taper=5)  # pocket 30x20 at the top, narrower at the bottom
+```
+One drafted wall:
+```python
+wall = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
+a = math.radians(5)
+drafted = wall.split(Plane(origin=(20, 0, 0), z_dir=(-math.cos(a), 0, -math.sin(a))))
+print(round(drafted.volume, 3))                         # 23475.068
+```
+
+## Related
+`extrude` (taper), `split`, `loft`.
diff --git a/src/smlibpy/skill/references/features/heal.md b/src/smlibpy/skill/references/features/heal.md
new file mode 100644
index 0000000..fcd5a83
--- /dev/null
+++ b/src/smlibpy/skill/references/features/heal.md
@@ -0,0 +1,35 @@
+# heal
+
+Runs the kernel's B-rep healer on a copy of a part or shell.
+
+## Signature
+`part.heal()` (also `Shell.heal()`, `Sketch.heal()`). No parameters.
+
+## Returns
+A new body of the same type. What the healer does: adjusts tolerances to measured gaps,
+merges coincident vertices, removes degenerate pieces, repairs periodic seams. It does not
+close real gaps, refit curves or rebuild faces.
+
+## When to call it
+- On data from outside: an imported STEP whose `is_valid()` is False, or that fails in a later
+  Boolean or fillet. Try `heal()`, then check `is_valid()` and the volume again.
+- Not as a fix for a failed feature. A healed bad result is still bad: none of these were
+  repaired —
+  - a revolve across its axis (negative volume stays negative),
+  - a sweep along a 360° arc (two solids become one, but the volume stays negative),
+  - a sweep along a disconnected wire (still invalid),
+  - the r 4.99 all-edge cube fillet (volume 11.19 stays),
+  - an extrusion with `taper=90` (still invalid).
+  Fix the input of the feature instead.
+- On clean parts it changes nothing measurable (same faces, volume to 1e-6) and costs a few
+  milliseconds; there is no need to call it after normal modeling.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(8, 30)
+fixed = part.heal()                                     # same volume, same faces on clean parts
+print(fixed.is_valid(), round(fixed.volume, 3))         # True 19978.761
+```
+
+## Related
+`import_step`, `is_valid`, `to_nurbs`, `stitch` (faces to a solid).
diff --git a/src/smlibpy/skill/references/features/to_nurbs.md b/src/smlibpy/skill/references/features/to_nurbs.md
new file mode 100644
index 0000000..02184dc
--- /dev/null
+++ b/src/smlibpy/skill/references/features/to_nurbs.md
@@ -0,0 +1,37 @@
+# to_nurbs
+
+Returns a copy whose faces and edges are all NURBS (B-spline): planes, cylinders, cones,
+spheres, tori, lines and circles are converted.
+
+## Signature
+`body.to_nurbs()` on a `Part`, `Shell` or `Sketch`. No parameters.
+
+## Returns
+A body of the same type, the same shape: volume within about 1e-7 relative
+(19978.761 → +0.0033), the same bbox size, the same face count, `is_valid()` True. All faces and
+edges report `geom_type == "bspline"`. A sketch keeps its plane.
+
+## What you lose
+- Selectors and properties that need analytic geometry find nothing: `edges().circles()`,
+  `faces().cylinders()` return empty lists; `face.radius` raises
+  `ValueError: a bspline face has no radius`. Select before converting, or by position.
+- STEP files get larger (11.8 kB → 18.1 kB for a box with a hole and four rounds); they read
+  back with the same volume.
+
+## Why you would
+- A downstream tool or format that wants only NURBS surfaces.
+- To test that a model does not depend on analytic surface types.
+Modeling continues to work afterwards: Booleans, fillets and shells on the converted part
+are valid (new faces from later features may be analytic again). For normal modeling and
+STEP export there is no reason to convert.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(8, 30)
+n = part.to_nurbs()
+print(sorted({f.geom_type for f in n.faces()}), len(n.edges().circles()))   # ['bspline'] 0
+print(abs(n.volume / part.volume - 1) < 1e-6, round(n.volume - part.volume, 4))  # True, a few thousandths
+```
+
+## Related
+`heal`, `export_step`, `Face.geom_type`, `ShapeList.circles()`.
diff --git a/src/smlibpy/skill/references/features/generic.md b/src/smlibpy/skill/references/features/generic.md
new file mode 100644
index 0000000..ec04f47
--- /dev/null
+++ b/src/smlibpy/skill/references/features/generic.md
@@ -0,0 +1,75 @@
+# Features: what they share
+
+Features make solids from profiles (`extrude`, `revolve`, `loft`, `sweep`, `thicken`) and change
+solids (`fillet`, `chamfer`, `shell`, `offset`, `split`, `mirror`). Each returns a new shape.
+
+## `is_valid()` is not enough
+Several features return a body that reports `is_valid() == True` but is wrong. Check the
+volume against a formula after every feature, and `len(part.solids())`:
+
+| Input | Result |
+|---|---|
+| `revolve` of a region crossing the axis (angle 360) | zero or negative volume |
+| `revolve` with the default axis on a moved sketch | revolves about the sketch's own origin |
+| `revolve(axis, -90)` | 270° the positive way |
+| `extrude(taper=...)` of a profile with holes | the holes are gone |
+| `extrude(taper=...)` that closes the profile | shorter than `amount` |
+| `loft` of a section with holes | the holes are gone |
+| `loft` of sections that start in different places | twisted, pinched |
+| `sweep` of a non-round profile along a helix | the profile rolls ~30° per turn |
+| `sweep` along a single 360° arc | 2 solids, negative volume |
+| `sweep` with a profile larger than the bend / pitch | self-overlapping, volume too large |
+| `fillet` right at the size limit (cube 10, r 4.99) | volume 11 instead of 525 |
+| closed `shell` thicker than half the part | wrong volume |
+| `split` with nothing on the kept side | empty Part (0 faces) |
+
+Each feature doc says how to avoid its case.
+
+## Directions
+- Sketch normal: `sketch.plane.z_dir`. `Plane.XY` +Z, `Plane.front`/`Plane.XZ` **-Y**,
+  `Plane.YZ` +X. A sketch placed with `.on(face)` takes the face's outward normal.
+- Faces of a part: normals point out of the material. Positive extrusions and thickenings
+  from a face grow the part; negative ones go into it.
+- `split(keep="above")` keeps the side the normal points to.
+- Mirrored sketches have their normal flipped.
+
+## Sizes and limits
+- Rounds and chamfers: two treated edges `d` apart allow a setback of `d/2`, one of `d`.
+- Shell and offset: wall below half the thinnest part of the solid; a round's radius limits
+  offsets across it.
+- Stay a few percent away from every exact limit: right at the limit the kernel fails, crashes
+  (shell with a wall equal to the depth) or returns garbage.
+
+## Errors
+`ModelingError` means smlibpy rejected the input or the result (it names the limit where it
+can). `KernelError` (a `ModelingError`) carries the kernel status (`SM_ERR`, `SM_ERR_INVALID_INPUT`,
+`SM_ERR_AXIS_INSIDE_FACE`) and a hint; the hint is a guess (zero radius reports "the radius may be
+too large"). `ValueError`/`TypeError` mean a wrong argument.
+
+## Order
+Main body → additions → subtractions → fillets and chamfers → shell (or shell earlier when
+walls must stay thin) → final holes. Fillet different radii meeting at a corner in one call,
+or larger first. Select edges and faces by geometry after each step; selections from an
+earlier version still work for `fillet`, `chamfer` and `shell` when the geometry did not change.
+
+## Example
+```python
+def check(tag, part, expected=None):
+    ok = part.is_valid() and part.volume > 0 and len(part.solids()) == 1
+    if expected is not None:
+        ok = ok and abs(part.volume - expected) <= 1e-6 * expected
+    print(tag, ok, round(part.volume, 3), part.bbox().size.to_tuple())
+    return ok
+
+body = Box(60, 40, 20)
+check("box", body, 60 * 40 * 20)
+body = body.fillet(body.edges().parallel_to(Z), 6)
+check("corners", body, 48000 - 4 * (36 - 9 * math.pi) * 20)
+body = body.shell(2, body.faces().planar().top())
+check("shell", body)
+body -= Cylinder(4, 10).translate(0, 0, -10)
+check("hole", body)
+```
+
+## Related
+Every doc in `features/`; `recipes/verification`, `recipes/modeling`.
