diff --git a/src/smlibpy/skill/references/features/fillets.md b/src/smlibpy/skill/references/features/fillets.md
new file mode 100644
index 0000000..613d725
--- /dev/null
+++ b/src/smlibpy/skill/references/features/fillets.md
@@ -0,0 +1,59 @@
+# fillets
+
+Selects the fillet faces among faces: rounds of convex edges, fillets of concave edges and the
+corner patches where they meet. Found by geometry, so it works on imported parts too.
+
+## Signature
+`faces.fillets(max_radius=None)` on a `ShapeList`, mostly `part.faces().fillets()`.
+
+- `max_radius`: keep only fillets of at most this radius. Not positive:
+  `ValueError: fillets: max_radius must be positive`.
+
+## What counts
+- **Edge fillet**: a curved face that meets two faces tangentially (normals within 2 degrees)
+  along edges that run across its curvature (its rails), where those two faces are walls, not
+  fillets. Circular rounds (cylinders), ring fillets around a boss or a hole (surfaces of
+  revolution), variable-radius fillets and G2/G3 blends (B-splines) all count.
+- **Corner patch**: a curved face with three or more edges, all tangential, that joins two or
+  more edge fillets and is curved about as tightly as they are: the 8 spheres of a box rounded
+  on every edge, the 4 saddle patches at the foot of a rounded rectangular boss.
+- **Not**: planes; hole walls and bosses (their edges are sharp); the side of a disc rounded at
+  both ends (its tangent edges run along its curvature); a whole sphere or torus (no edges).
+- **Lookalikes**: the round ends of a slot or an obround plate are geometrically fillets with
+  half the width as radius. `max_radius` below that keeps them out (`Slot(40, 12).extrude(5)`:
+  2 fillets, 0 with `max_radius=5`).
+
+## Radius
+Measured where the face is curved most, at a point inside it:
+- circular rounds: the fillet radius (3.0 for r 3);
+- variable radius: the radius in the middle of the face (2.96 for 2..4, so `max_radius=3` keeps it);
+- G2/G3 blends: their tightest curvature, smaller than the radius they were made with (1.97 for a
+  G2 blend made with 3: `max_radius=2` still selects it);
+- corner patches: the largest radius of the fillets they join.
+
+`face.radius` works only on cylinders, spheres and tori. Ring fillets are surfaces of revolution:
+`face.radius` raises `ValueError: a revolution face has no radius`; filter with `max_radius`.
+
+## Returns
+A `ShapeList` of the same `Face` objects, so other selectors chain: `.fillets().cylinders()`,
+`.fillets().top()`. A plain box gives an empty list. About 1 ms for 26 faces.
+
+## Example
+```python
+box = Box(40, 30, 20)
+rounded = box.fillet(box.edges(), 3)              # 12 rounds, 8 corner spheres
+found = rounded.faces().fillets()
+print(len(found), len(found.cylinders()))         # 20 12
+print(len(rounded.faces().fillets(max_radius=2))) # 0: all are r 3
+
+disc = Cylinder(10, 8)
+disc = disc.fillet(disc.edges(), 2)
+print([f.geom_type for f in disc.faces().fillets()])   # ['revolution', 'revolution']: the side is a wall
+
+slot = Slot(40, 12).extrude(5)                    # round ends look like r 6 fillets
+print(len(slot.faces().fillets()), len(slot.faces().fillets(max_radius=5)))  # 2 0
+```
+
+## Related
+`remove_fillets` (takes them out), `fillet`, `selection/convexity` (`smooth()` edges are the
+rails of fillets).
diff --git a/src/smlibpy/skill/references/features/remove_fillets.md b/src/smlibpy/skill/references/features/remove_fillets.md
new file mode 100644
index 0000000..7645c3c
--- /dev/null
+++ b/src/smlibpy/skill/references/features/remove_fillets.md
@@ -0,0 +1,98 @@
+# remove_fillets
+
+Takes fillets out of a part and makes their edges sharp again: the faces next to each fillet
+are extended until they meet. For simplifying parts before simulation or meshing, for imported
+parts, and for getting a base shape back.
+
+## Signature
+`part.remove_fillets(faces=None, *, max_radius=None, partial=False)`
+
+- `faces`: fillet faces of this part (a selection, one face). `None`: every fillet
+  (`part.faces().fillets(max_radius)`). Faces of an earlier version of the part are matched by
+  position. Corner patches whose fillets all go are added.
+- `max_radius`: only fillets up to this radius (see `fillets` for how the radius is measured).
+- `partial`: keep the fillets the kernel cannot take out and return the rest. Default: raise.
+
+## Returns
+A new `Part`; the input is unchanged. If there is nothing to take out, the part itself
+(`box.remove_fillets() is box`). Exact on parts made here and on their STEP round trips:
+
+| Part | Faces | Volume after |
+|---|---|---|
+| `Box(40, 30, 20)`, 4 vertical edges r 3 | 10 → 6 | 24000.000000000 |
+| all 12 edges r 3 (8 corner spheres) | 26 → 6 | 24000 − 1.1e-11 |
+| 4 top edges r 3 (mitred corners), variable 2..4, G2 r 3 | 10 → 6 | 24000.000000000 |
+| plate + rectangular boss, base fillet r 2 (4 corner patches) | 19 → 11 | 15200.000000000 |
+| plate + cylinder boss, ring fillet r 2 | 9 → 8 | exact + 2.8e-8 |
+| STEP round trips of the fully rounded box and of the boss | same | error ≤ 4e-12 |
+
+Planes come back as planes, cylinders as cylinders (the faces are extended, not refitted).
+
+## How
+1. Fillets with sharp ends (four edges: two rails, two ends at sharp edges) go one by one with
+   the kernel's fillet removal. A fillet next to another may only qualify once that one is gone;
+   it is tried again.
+2. What is left (fillets that end in corner patches, rings around bosses and holes) goes as
+   connected sets with the kernel's feature executive, which cuts them out and closes the gap by
+   extending the faces around it, smallest radius first.
+3. Concave fillets first, then convex ones, then sets that mix both; repeated while fillets go.
+   Taking out one kind can make room for the other (an L bracket only goes all the way that way).
+4. Every step is checked: a valid solid, a volume that went up for convex fillets and down for
+   concave ones, by no more than the fillets can hold. A step that fails the check is dropped.
+
+## Imported parts
+Exact on simple parts; on real parts the kernel cannot take out every fillet:
+- example bracket (5 fillets): all 5 go when it is made here (volume 31287.064 → 31376.338);
+  after a STEP round trip 2 go and 3 stay (`partial=True`).
+- example flange (ring fillet at the neck): native and STEP.
+- B-spline faces (many STEP files, `to_nurbs()`) are extended as smooth continuations: the
+  boss with B-spline faces came back within 1.3e-8 (relative), the fully rounded box within
+  1.1e-11, but the patches stay faces of their own (16 faces instead of 11, 12 instead of 6).
+Use `partial=True` on imported parts and check `result.faces().fillets()` for what stayed.
+
+## Crashes and hangs
+SMLib's patching and Boolean code crashes or loops on some parts (both seen on the example
+enclosure and bottle). On Linux and macOS each kernel step first runs in a forked copy of the
+process; a crash there, or a step longer than `smlibpy.defeature.GUARD_SECONDS` (20 s), only
+drops that step, and this process goes on. On Windows the kernel runs directly. A crash in the
+copy costs little, a hang the 20 s: on the example enclosure (20 fillet faces) 12 go and 8 stay,
+and with the stopped steps `remove_fillets(partial=True)` takes 180 s.
+
+## Errors
+- `ModelingError: remove_fillets: 1 of the faces are no fillets (plane); a fillet meets two faces tangentially along its length. Select fillets with part.faces().fillets(), or take other faces out with remove_faces`
+- `ModelingError: remove_fillets: the kernel could not take out 2 of the 4 fillet faces (at (1.454, 1.454, 25), (58.55, 38.55, 4)); remove_fillets(..., partial=True) keeps them and takes out the others, or take out the fillets around them first`
+- `ValueError: remove_fillets: no faces selected` (an empty selection);
+  `ValueError: Face(...) is not a face of this part`; `ValueError: fillets: max_radius must be positive`.
+- The part must be valid (`ModelingError: remove_fillets: the part is not a valid solid ...`).
+
+## Cost
+Box with 4 rounds 0.01 s, fully rounded box 0.27 s, example bracket 0.35 s. With the guard
+every kernel step runs twice (the copy, then here).
+
+## Example
+```python
+box = Box(40, 30, 20)
+rounded = box.fillet(box.edges(), 3)
+sharp = rounded.remove_fillets()                  # every fillet, corner patches included
+print(len(sharp.faces()), round(sharp.volume, 6)) # 6 24000.0
+
+v4 = box.fillet(box.edges().parallel_to(Z), 3)
+one = v4.remove_fillets(v4.faces().fillets().sort_by("x")[0])   # just one of them
+print(len(one.faces()))                           # 9
+
+plate = Box(60, 40, 5, align=(Align.CENTER, Align.CENTER, Align.MAX))
+part = plate + Cylinder(6, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
+part = part.fillet(part.edges().filter(lambda e: e.geom_type == "circle" and e.center().z > 9), 2)        # round top, convex
+part = part.fillet(part.edges().filter(lambda e: e.geom_type == "circle" and abs(e.center().z) < 1e-6), 1.5)  # base fillet, concave
+print(round(part.remove_fillets().volume, 3), round(12000 + math.pi * 36 * 10, 3))   # 13130.973 13130.973
+print(len(part.remove_fillets(max_radius=1.5).faces()))   # 9: only the base fillet went
+
+try:
+    v4.remove_fillets(v4.faces().top())
+except ModelingError as e:
+    print(e)   # remove_fillets: 1 of the faces are no fillets (plane); ...
+```
+
+## Related
+`fillets` (the selector), `remove_faces` (holes, bosses, pockets), `fillet`, `heal`,
+`recipes/simplify`.
diff --git a/src/smlibpy/skill/references/features/remove_faces.md b/src/smlibpy/skill/references/features/remove_faces.md
new file mode 100644
index 0000000..62899c5
--- /dev/null
+++ b/src/smlibpy/skill/references/features/remove_faces.md
@@ -0,0 +1,72 @@
+# remove_faces
+
+Cuts faces out of a part and closes the gap with the faces around it: fills holes and pockets,
+takes bosses off. For simplifying parts (suppressing small features before simulation or
+meshing) and for getting a base shape back from an imported part.
+
+## Signature
+`part.remove_faces(faces, *, partial=False)`
+
+- `faces`: faces of this part (a selection, one face), or of an earlier version of it (matched
+  by position). Faces the selection encloses go with it: the floor of a blind hole with its
+  wall, the top of a boss with its side. Each connected set of faces is one feature.
+- `partial`: keep the features the kernel cannot close and take out the others. Default: raise.
+
+## Returns
+A new `Part`; the input is unchanged. The gap is closed by extending the faces around it (the
+kernel's feature executive); where that fails, by a flat cap across the opening. The patches
+merge with the faces they extend, so a filled hole leaves no trace:
+
+| Feature on `Box(40, 30, 20)` | Faces | Volume after |
+|---|---|---|
+| through hole r 5, two holes at once | 7 → 6, 8 → 6 | 24000.000000000 |
+| blind hole (wall only selected) | 8 → 6 | 24000.000000000 |
+| cylinder boss on top (side only selected) | 8 → 6 | 24000.000000000 |
+| rectangular pocket (walls and floor), counterbore, countersink | 11/9/8 → 6 | 24000.000000000 |
+| hole with a rounded rim (all its faces) | 8 → 6 | 24000.000000000 |
+
+Each feature is checked: a valid solid, and a volume that went up for a depression (a hole or
+pocket, whose rim edges are convex) and down for a protrusion (a boss, concave rim).
+
+## Gotchas
+- Select the whole feature. Faces enclosed by the selection are added, but a wall without the
+  fillets around its rim leaves a gap the kernel cannot close: take the fillets out first
+  (`remove_fillets`) or select them with the feature.
+- Select faces with a box (`within`) rather than a height filter: `faces().filter(lambda f:
+  f.bbox().min.z > 3.9)` also picks the top face of the part.
+- On imported parts and after other defeaturing steps the kernel can crash on a feature (seen on
+  the example bracket after `remove_fillets(partial=True)`: all 4 hole features failed, while the
+  same holes went from the STEP import directly: 19 → 13 faces). The crash happens in a forked
+  copy of the process (Linux, macOS; see `remove_fillets`), this process goes on. Try the other
+  order (holes first, then fillets) and `partial=True`.
+
+## Errors
+- `ModelingError: remove_faces: that is every face of the part; nothing would be left`
+- `ModelingError: remove_faces: the kernel crashed (signal 11, in a copy of this process) at (44.92, 10, 4) (4 of 4 features failed); select every face of the feature (...), take out its fillets first (remove_fillets), or keep it with partial=True`
+- `ValueError: remove_faces: no faces selected`; `ValueError: Face(...) is not a face of this part`.
+
+## Cost
+0.02 s per feature on the box examples (with the guard, the kernel runs twice).
+
+## Example
+```python
+block = Box(40, 30, 20)
+drilled = block - Cylinder(5, 40) - Cylinder(3, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(12, 0, 0)
+plain = drilled.remove_faces(drilled.faces().cylinders())   # the floor of the blind hole goes with its wall
+print(len(plain.faces()), round(plain.volume, 6))            # 6 24000.0
+
+bossed = block + Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 10)
+print(round(bossed.remove_faces(bossed.faces().cylinders()).volume, 6))   # 24000.0: the top went with the side
+
+pocket = block - Box(10, 8, 6, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
+walls = pocket.faces().within(BoundBox((-5.1, -4.1, 3.9), (5.1, 4.1, 10.1)))   # the 4 walls and the floor
+print(len(walls), round(pocket.remove_faces(walls).volume, 6))           # 5 24000.0
+
+try:
+    drilled.remove_faces(drilled.faces())
+except ModelingError as e:
+    print(e)   # remove_faces: that is every face of the part; nothing would be left
+```
+
+## Related
+`remove_fillets`, `fillets`, `Part.cut` (the other way round), `recipes/simplify`.
diff --git a/src/smlibpy/skill/references/analysis/draft_analysis.md b/src/smlibpy/skill/references/analysis/draft_analysis.md
new file mode 100644
index 0000000..000b73e
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/draft_analysis.md
@@ -0,0 +1,68 @@
+# draft_analysis
+
+Measures the draft of every face of a part for a pull direction and sorts the faces by whether
+they release from a mold half (or a casting pattern) that moves away along that direction.
+
+## Signature
+`part.draft_analysis(direction, *, min_angle=1.0) -> DraftAnalysis`
+
+- `direction`: the pull direction, an `Axis` (`Z`) or a vector (`(0, 0, 5)`; length does not
+  matter). Zero raises `ValueError: draft_analysis: the direction must not be zero`.
+- `min_angle`: the draft a face needs, in degrees, at least 0 and below 90
+  (`ValueError: draft_analysis: min_angle must be at least 0 and less than 90 degrees`).
+
+The draft angle at a point is the angle between the face and the direction:
+`asin(n . d)` for the outward normal `n`. +90 where the face looks along the direction, 0 on a
+wall parallel to it, negative where it turns away.
+
+## Returns
+A `DraftAnalysis`:
+- `positive`: faces with at least `min_angle` everywhere (they release);
+- `insufficient`: nowhere negative, but less than `min_angle` somewhere;
+- `vertical`: 0 everywhere (within 1e-6 degrees): walls along the direction, they need draft;
+- `undercut`: negative somewhere: the face turns away from the direction and locks that mold half;
+- `faces`: one `FaceDraft(face, min_angle, max_angle, kind)` per face; iterate the analysis
+  itself (`for fd in da`), `len(da)`;
+- `angles(face)`: `(least, greatest)` draft of a face of the part, in degrees;
+- `ok`: every face positive; `direction` (unit), `min_angle`.
+
+The four groups are `ShapeList`s of the part's own faces: chain selectors on them, pass them on
+as a selection (to highlight them in a picture, or to `remove_faces`).
+
+## Accuracy
+Planes, cylinders and cones are exact: a 3 degree taper reads 3.000000000, a cone with radii 10
+and 5 over 20 reads 14.036243468 (atan(5/20)). Other faces are sampled on a grid of their
+parameters and along their edges, then the least and greatest values are refined. 1 to 4 ms per
+part for the examples here.
+
+## Gotchas
+- One pull direction: every face that turns away from it is an `undercut`, the bottom of a box
+  too (-90). For a two-part mold run it twice: faces positive for `Z` come out of the upper half,
+  faces positive for `-Z` out of the lower half, the parting line divides them. A face positive
+  in neither needs draft (see `recipes/mold-check`).
+- Curved faces that turn over (a sphere: -90 to 90, a cylinder lying across the direction) are
+  `undercut` for either direction: the parting line runs through them. Their angles go to 0 at
+  the line, so their halves are at best `insufficient` near it (a hemisphere: 0 to 90).
+- The draft is judged by each face's own normals. Whether another part of the body hides a face
+  from the mold half (the inside of a closed cover, a groove under an overhang) is not checked;
+  more than one parting line on a simple part points to such faces.
+
+## Example
+```python
+core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
+da = core.draft_analysis(Z, min_angle=1)
+print(da)        # DraftAnalysis(direction=(0, 0, 1), min_angle=1: 9 positive, 0 insufficient, 0 vertical, 1 undercut)
+wall = da.positive.filter(lambda f: f.geom_type == "plane" and f.center().z < 19).first
+print(da.angles(wall))                            # (3.0..., 3.0...): the taper
+print(core.draft_analysis(Z, min_angle=5).insufficient.__len__())   # 8 walls with less than 5 degrees
+
+box = Box(40, 30, 20)
+check = box.draft_analysis(Z)
+print(len(check.vertical), len(check.undercut), check.ok)          # 4 1 False: the walls need draft
+for fd in Sphere(10).draft_analysis(Z):
+    print(fd.kind, round(fd.min_angle, 6), round(fd.max_angle, 6))  # undercut -90.0 90.0
+```
+
+## Related
+`parting_line`, `recipes/mold-check`, `extrude` (`taper=` drafts walls), `features/draft`,
+`silhouette`.
diff --git a/src/smlibpy/skill/references/analysis/parting_line.md b/src/smlibpy/skill/references/analysis/parting_line.md
new file mode 100644
index 0000000..8cbee79
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/parting_line.md
@@ -0,0 +1,63 @@
+# parting_line
+
+The lines on a part where its surface turns from facing a pull direction to facing away from
+it: where the two halves of a mold or a casting pattern meet.
+
+## Signature
+`part.parting_line(direction) -> ShapeList[Wire]`
+
+`direction`: an `Axis` (`Z`) or a vector; its length does not matter. Zero raises
+`ValueError: parting_line: the direction must not be zero`.
+
+## Returns
+A `ShapeList` of closed `Wire`s, longest first, made of standalone exact curves:
+- edges of the part where faces facing the direction meet faces facing away (a sharp rim);
+- silhouettes through curved faces, where the normal is perpendicular to the direction. Exact
+  for spheres (a great circle: the equator for `Z`, 2 `circle` edges of radius 10.0 at z = 0),
+  for cylinders lying across the direction (two straight lines, stored as B-splines) and for tori
+  whose axis is the direction (two circles). Traced NURBS otherwise, within 1e-6 of the part's
+  size of the surface (a torus tilted 30 degrees, 73.4 across: up to 7e-5 off the surface, the
+  normal within 6.5e-6 of perpendicular to the direction).
+
+Most parts give one wire. Two for a torus seen along its axis (the outer and the inner equator,
+157.0796 and 94.2478). Several on a simple part point to faces the mold cannot reach from
+either side (see `draft_analysis`).
+
+## Walls without draft
+Faces parallel to the direction (`draft_analysis(...).vertical`) go with the half that moves
+along the direction, unless they only touch faces of the other half. The line then runs along
+their far end: the bottom edge for `Z`.
+- `Box(40, 30, 20)`: the 4 bottom edges (length 140, z = -10).
+- A cylinder along Z: its bottom circle. Lying along X: its 2 contour lines (y = ±5, z = 0) and
+  the lower halves of its end circles (71.4159 in all).
+- A box opening up (a cup) and one opening down: both the outer bottom edge, z = -10.
+Drafted walls keep the line where it is (a core tapered 3 degrees: its bottom rim, z = 0).
+
+## How
+A copy of the part is split along the silhouettes of the faces that turn over; each face of the
+copy then faces one way, and the line is where the two sides meet. Faces split along traced
+silhouettes may turn the other way by up to 0.6 degrees next to the line; they count for the way
+they mostly face. A face that still faces both ways raises `ModelingError: parting_line: a face
+still faces both ways after the split; heal() the part, or try a direction a little off this one`.
+
+## Cost
+1 to 20 ms for the examples here, 0.1 s with a traced torus.
+
+## Example
+```python
+line = Sphere(10).parting_line(Z)
+print(len(line), [e.geom_type for e in line[0].edges()], round(line[0].length, 6))   # 1 ['circle', 'circle'] 62.831853
+
+lying = Cylinder(5, 20).rotate(Y, 90).parting_line(Z)[0]
+print(round(lying.length, 6), sorted(round(e.center().y, 6) for e in lying.edges() if e._is_straight()))   # 71.415927 [-5.0, 5.0]
+
+cup = Box(40, 30, 20) - Box(30, 20, 15, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
+rim = cup.parting_line(Z)
+print(len(rim), rim[0].length, rim[0].bbox().max.z)   # 1 140.0 -10.0: walls without draft go with the top half
+
+print([round(w.length, 4) for w in Torus(20, 5).parting_line(Z)])   # [157.0796, 94.2478]
+```
+
+## Related
+`draft_analysis`, `recipes/mold-check`, `silhouette` (what is visible from a direction),
+`outline`, `split` (cut a part at a flat parting line).
diff --git a/src/smlibpy/skill/recipes/simplify.md b/src/smlibpy/skill/recipes/simplify.md
new file mode 100644
index 0000000..4e720b7
--- /dev/null
+++ b/src/smlibpy/skill/recipes/simplify.md
@@ -0,0 +1,51 @@
+# Simplifying a part
+
+Taking details out of a part (fillets, holes, bosses, pockets) before a simulation or a mesh,
+or to get the base shape of an imported part back. The kernel extends the faces around each
+detail until the gap closes; every step is checked (valid solid, volume in the right direction).
+
+## Steps
+
+1. Import and look: `part = import_step(path)`, then `part.is_valid()`, `len(part.faces())`,
+   `snapshot(view="sheet")`. Heal a part that is not valid first (`part.heal()`).
+2. Find the details: `part.faces().fillets(max_radius=...)` for rounds and fillets (corner
+   patches included); holes and bosses by type and size, for example
+   `part.faces().cylinders().filter(lambda f: f.radius < 4)`, pockets with `within(BoundBox(...))`.
+   Print the count and the centers before removing anything.
+3. Take the fillets out: `part.remove_fillets(max_radius=..., partial=True)`. On imported parts
+   use `partial=True` and check what stayed: `result.faces().fillets(max_radius=...)`.
+4. Take holes, bosses and pockets out: `result.remove_faces(faces, partial=True)`. Select whole
+   features (a hole's floor and a boss's top go with their walls on their own) and the fillets
+   on their rims too.
+5. Check: `is_valid()`, `len(solids()) == 1`, the volume went the right way (up for holes and
+   rounds of outside edges, down for bosses and fillets of inside edges), the bounding box.
+
+## Order
+The kernel does not manage every order. If something stays, start again from the import with
+the other order (holes first, then fillets). On the example bracket: fillets first takes out all
+5 fillets and then all holes (8 faces, the plain L, volume 32640.0); holes first leaves the inner
+fillet. After a STEP round trip, the holes go straight from the import, but not after the
+fillets were taken out.
+
+## What the kernel cannot do
+- Some fillets on imported parts stay (3 of 5 on the example bracket after a STEP round trip).
+- B-spline faces are extended as smooth continuations (within about 1e-8 here); their patches
+  stay faces of their own.
+- The kernel can crash or loop on some parts. On Linux and macOS that happens in a forked copy
+  of the process and only drops the step (`smlibpy.defeature.GUARD_SECONDS`, 20 s per step).
+
+## Example
+```python
+part = import_step(path)
+print(len(part.faces()), round(part.volume, 3), len(part.faces().fillets()))   # 19 31287.062 5
+
+simple = part.remove_fillets(max_radius=5, partial=True)     # small rounds; keep what cannot go
+print(len(simple.faces()), len(simple.faces().fillets(max_radius=5)))           # 17 2
+
+holes = part.faces().filter(lambda f: f.geom_type in ("cylinder", "cone") and f not in part.faces().fillets())
+plain = part.remove_faces(holes, partial=True)                # holes straight from the import
+print(len(plain.faces()), round(plain.volume, 3))            # 13 32550.724
+print(plain.is_valid(), len(plain.solids()))                 # True 1
+```
+
+Guides: `features/fillets`, `features/remove_fillets`, `features/remove_faces`, `features/heal`.
diff --git a/src/smlibpy/skill/recipes/mold-check.md b/src/smlibpy/skill/recipes/mold-check.md
new file mode 100644
index 0000000..5e6a333
--- /dev/null
+++ b/src/smlibpy/skill/recipes/mold-check.md
@@ -0,0 +1,54 @@
+# Checking a part for molding or casting
+
+A part that is molded or cast leaves a two-part mold (or sand mold, die) along a pull
+direction: one half moves up, the other down. Every face must release from the half that forms
+it: it needs draft, an angle towards the direction that half moves. Faces turned away from both
+are undercuts (side actions, cores). The two halves meet at the parting line.
+
+## Steps
+
+1. Choose the pull direction: usually the axis along which the part is lowest (Z for a part
+   designed standing on XY).
+2. Parting line: `lines = part.parting_line(Z)`. One closed wire around the part is the normal
+   case; look where it runs (`lines[0].bbox()`). Several wires on a simple part point to faces
+   neither half can reach.
+3. Draft for each half: `up = part.draft_analysis(Z, min_angle=1)` and
+   `down = part.draft_analysis(-Z, min_angle=1)`. A face is fine when it is in `up.positive` or
+   in `down.positive`.
+4. The rest: faces in `vertical` for both need draft (walls along the pull direction, ribs);
+   faces in `insufficient` need more; a face whose angles cross 0 (`up.angles(face)`: least
+   below 0, greatest above) is split by the parting line, which is fine when that is where you
+   want the line.
+5. Fix the design: taper the walls (`extrude(..., taper=deg)`, a tapered tool for pockets), and
+   check again.
+
+Typical minimum draft: 0.5 to 2 degrees for injection molding, more for textured surfaces and
+for sand casting. The analysis judges faces by their own normals; it does not check whether
+another part of the body hides a face from a half (the inside of a closed cover, a groove under
+an overhang).
+
+## Example
+```python
+cover = RoundedRectangle(80, 50, 6).extrude(25, taper=2)      # outside, 2 degrees
+cover -= RoundedRectangle(74, 44, 3).extrude(23, taper=1.5)   # inside, open at the bottom, 1.5 degrees
+
+lines = cover.parting_line(Z)
+print(len(lines), round(lines[0].length, 3), lines[0].bbox().max.z)   # 1 249.699 0.0: the bottom rim
+
+up = cover.draft_analysis(Z, min_angle=1)       # the half that moves up: outside and top
+down = cover.draft_analysis(-Z, min_angle=1)    # the half that moves down: inside and rim
+print(len(up.positive), len(down.positive))     # 9 10
+need = [f for f in cover.faces() if f not in up.positive and f not in down.positive]
+print(len(need))                                # 0: every face releases from one half
+
+ribbed = cover + Box(2, 44, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 23)
+up, down = ribbed.draft_analysis(Z), ribbed.draft_analysis(-Z)
+need = [f for f in ribbed.faces() if f not in up.positive and f not in down.positive]
+print(len(need), [round(up.angles(f)[0], 6) for f in need])   # 2 [0.0, 0.0]: the rib's sides need draft
+```
+
+The inside of the same cover tapered the wrong way (`taper=-1.5`: wider at the top) gives 3
+parting lines (z = 0, 23 and 0): the inside faces up, and the lower half could not come out.
+
+Guides: `analysis/draft_analysis`, `analysis/parting_line`, `features/extrude` (taper),
+`features/draft`.
diff --git a/src/smlibpy/skill/references/features/draft.md b/src/smlibpy/skill/references/features/draft.md
index 52506bb..c5c6787 100644
--- a/src/smlibpy/skill/references/features/draft.md
+++ b/src/smlibpy/skill/references/features/draft.md
@@ -42,4 +42,5 @@ print(round(drafted.volume, 3))                         # 23475.068
 ```
 
 ## Related
-`extrude` (taper), `split`, `loft`.
+`extrude` (taper), `split`, `loft`; `analysis/draft_analysis` measures the draft of every face,
+`analysis/parting_line` finds where the mold halves meet.
diff --git a/src/smlibpy/skill/SKILL.md b/src/smlibpy/skill/SKILL.md
index 8919067..40e1dab 100644
--- a/src/smlibpy/skill/SKILL.md
+++ b/src/smlibpy/skill/SKILL.md
@@ -66,9 +66,9 @@ classcad.ch account). A part made here opens in ClassCAD as a solid through STEP
 | parts | `parts/*` | Part, primitives (Box, Cylinder, Cone, Sphere, Torus, Wedge), holes, Booleans |
 | sketches | `sketches/*` | Sketch, 2D shapes (Rectangle, Circle, Polygon, Slot, ...), make_face, 2D offset and fillet |
 | curves | `curves/*` | Line, arcs, Spline, Bezier, Helix, Polyline, Wire |
-| features | `features/*` | extrude, revolve, loft, sweep, fillet, chamfer, shell, offset, mirror, split, section, thicken, draft, heal |
+| features | `features/*` | extrude, revolve, loft, sweep, fillet, chamfer, shell, offset, mirror, split, section, thicken, draft, heal; taking fillets and faces out again (fillets, remove_fillets, remove_faces) |
 | surfaces | `surfaces/*` | surface, ruled, stitch, Shell |
-| analysis | `analysis/*` | mass properties, measures, distances, intersections, silhouettes, projections, validity |
+| analysis | `analysis/*` | mass properties, measures, distances, intersections, silhouettes, projections, validity, draft analysis and parting lines for molding and casting |
 | files | `files/*` | STEP in and out, STL, glTF, OBJ, the native format, render, show, meshes |
 
 Each domain has a `generic.md` with the concepts; the other docs are named after the API
@@ -79,3 +79,5 @@ Each domain has a `generic.md` with the concepts; the other docs are named after
 - `recipes/verification`: what to check after each step, and how.
 - `recipes/modeling`: the patterns that work (plates, holes, bosses, revolved parts, shells,
   sweeps along helices) and the order of operations.
+- `recipes/simplify`: taking fillets, holes and bosses out of a part, an imported one too.
+- `recipes/mold-check`: draft and parting line of a part that is molded or cast.
