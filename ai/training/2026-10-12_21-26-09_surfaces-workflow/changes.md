diff --git a/src/smlibpy/skill/references/surfaces/generic.md b/src/smlibpy/skill/references/surfaces/generic.md
new file mode 100644
index 0000000..e3ad180
--- /dev/null
+++ b/src/smlibpy/skill/references/surfaces/generic.md
@@ -0,0 +1,117 @@
+# Surface modeling
+
+Freeform parts are built as faces first, then turned into solids. A sheet is a `Shell`; a solid
+is a `Part`. The path is always: **make faces → (stitch them) → thicken or close → check**.
+
+## 1. Make faces
+
+| Need | Use | Gives |
+|---|---|---|
+| A freeform patch through measured or computed points | `surface(grid)` (at least 4 x 4) | 1 bicubic face |
+| Straight lines between two curves (blades, transitions, walls) | `ruled(a, b)` | 1 face |
+| A skin through three or more open curves | `loft([curve, ...])` | Shell |
+| A wall from an open curve | `extrude(curve, h)`, `revolve(curve, axis)`, `sweep(curve, path)` | Shell |
+| A flat cap or bottom | `make_face(closed_wire_or_edge)` | Sketch (a Shell) |
+| A face of an existing part | `part.faces()...` (or `face.to_shell()`) | Face / Shell |
+
+Two rules decide whether the later steps work:
+
+- **Neighbours share curves.** Build each face from the edges of the face next to it
+  (`for e in skin.edges(): ruled(e, ...)`, `make_face(e)` for a cap). stitch does not move
+  geometry; faces that only nearly meet give gaps hidden in tolerances.
+- **Know the normals.** `thicken(t)` follows each face's normal. `surface`: (row-to-row) ×
+  (along a row). `ruled(a, b)`: tangent of a × (a → b). Check with
+  `face.normal_at(face.interior_point())` and flip by reversing the grid rows or swapping the
+  curves of `ruled`.
+
+## 2. Turn faces into a solid
+
+**A. Thicken one sheet** (panels, fenders, blades): `sheet.thicken(t)`. Works on open sheets
+with one or more faces. Inward thickness must stay below the smallest curvature radius.
+
+**B. Close a volume**: `stitch(skin, walls, bottom)` returns a `Part` when every edge is shared.
+The Part's normals are made outward whatever the input. Hollow it afterwards with
+`part.shell(t, openings=...)`. This is also the way for closed surfaces (tubes, tori from
+`surface`): add caps with `make_face(edge)` and stitch; do not thicken them.
+
+**C. Stitch an open set, then thicken** (a cover with walls, open at the bottom). An open stitch
+result keeps each face's input normal: orient every piece the same way first, or the thicken
+returns volume 0. With oriented pieces, B + `shell` and C give the same body (volumes within 0.001).
+
+Trim a sheet with a solid: `stitch(solid & sheet)` returns the part of the sheet inside.
+
+## 3. Check after every step
+
+| After | Check |
+|---|---|
+| a face | `shell.area` plausible, `len(shell.faces())`, `normal_at` points where you want |
+| stitch | `isinstance(r, Part)`; if a Shell: `free = [e for e in r.edges() if len(e.faces()) == 1]`, print `e.center()` of each |
+| thicken | `p.is_valid() and p.volume > 0`, volume ≈ area · t on gently curved sheets, `bbox()` on the side you meant |
+| closed solid | volume against an estimate (an integral, a bounding shape); `bbox()` against the face positions |
+
+## Silent failures (no exception)
+- `thicken` of a closed `surface` grid, a `surface` dome with a pole, or a Shell with mixed
+  normals: a Part of volume 0, sometimes with `is_valid()` True.
+- `stitch` that does not close: a Shell. With a large `tolerance`: a "valid" Part whose faces
+  stand off their edges (volume and bbox disagree).
+- `part & sheet`, `part - sheet`, `part + sheet`: invalid "Parts". Only `stitch(part & sheet)` is
+  useful.
+- `surface` with repeated rows overshoots wildly; with a NaN gives an empty face.
+- `thicken(..., both=True)`: `both` is ignored.
+
+## Example: closed block and open cover from one freeform skin
+```python
+import math
+
+# 1. Faces. The skin: rows along y stacked in x, so its normal points up (+Z).
+h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
+skin = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
+print(skin.faces()[0].normal_at((30, 20, 10)))                    # ~(0, 0, 1)
+
+# Walls from the skin's own edges (so they meet exactly), turned to point outward.
+mid = Vector(30, 20, 5)
+walls = []
+for e in skin.edges():
+    floor = Line((e.start.x, e.start.y, 0), (e.end.x, e.end.y, 0))
+    w = ruled(e, floor)
+    p = w.faces()[0].interior_point()
+    if w.faces()[0].normal_at(p).dot(p - mid) < 0:
+        w = ruled(floor, e)
+    walls.append(w)
+
+# 2a. Closed solid: add a bottom and stitch.
+bottom = make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True))
+block = stitch(skin, walls, bottom)
+assert isinstance(block, Part) and block.is_valid()
+print(round(block.volume, 2))                                     # 23997.28
+
+# 2b. Open cover: stitch without the bottom, check the free edges, thicken inward.
+cover = stitch(skin, walls)
+free = [e for e in cover.edges() if len(e.faces()) == 1]
+print(type(cover).__name__, len(free))                            # Shell 4 (the bottom rim)
+wall = cover.thicken(-1.5)
+assert wall.is_valid() and wall.volume > 0
+print(round(wall.volume, 1))                                      # 6134.8, same as block.shell(-1.5, ...)
+```
+The block's volume equals the integral of h over the rectangle (23997.27).
+
+## Example: a fender-like panel
+```python
+import math
+
+L, W = 120.0, 50.0
+def z(x, y):
+    return 40 + 6 * math.cos(math.pi * x / L) ** 2 - 18 * (y / W) ** 2.2
+skin = surface([[(x, y, z(x, y)) for y in np.linspace(0, W, 9)] for x in np.linspace(-L / 2, L / 2, 13)])
+panel = skin.thicken(-2)                                  # normal is up; -2 goes under the skin
+assert panel.is_valid() and panel.volume > 0
+fender = panel - Cylinder(42, 200).rotate(X, 90)          # wheel arch, axis along Y
+fender = fender.fillet(fender.faces().cylinders().edges(), 0.5)
+print(fender.is_valid(), round(fender.volume, 2), len(fender.solids()))   # True 9908.49 1
+```
+Once thickened, the panel is an ordinary Part: Booleans, fillets and STEP export work (the STEP
+file reads back with the same volume). The arch edges meet the panel at a shallow angle, so
+the fillet must stay well under the 2 mm wall (1.5 fails).
+
+## Related
+`surface`, `ruled`, `stitch`, `Shell`; `loft`, `extrude`, `sweep`, `shell`, `fillet` in features

# stitch.md and Shell.md after the open-stitch normals finding (scripts 07-09)
diff --git a/src/smlibpy/skill/references/surfaces/stitch.md b/src/smlibpy/skill/references/surfaces/stitch.md
new file mode 100644
index 0000000..fcf87fb
--- /dev/null
+++ b/src/smlibpy/skill/references/surfaces/stitch.md
@@ -0,0 +1,87 @@
+# stitch
+
+Sews faces and sheets along their common edges. Returns a `Part` when the result is a closed,
+valid solid, otherwise a `Shell`.
+
+## Signature
+`stitch(*pieces, tolerance=None)`
+
+- `pieces`: any mix of `Shell`s (from `surface`, `ruled`, `loft`, `extrude` of curves, ...),
+  `Sketch`es (`make_face`), `Face`s (`part.faces()` works directly, no `to_shell()` needed),
+  `Part`s, and lists or nested lists of them. `stitch(a, b, c)`, `stitch([a, b, c])` and
+  `stitch(a, [b, c])` are the same.
+- `tolerance`: see Gaps. Leave it at `None`.
+
+## Returns
+- `Part` when every edge is shared by two faces and the body is a valid solid. Face normals are
+  made consistent and outward, whatever their direction in the input (`normal_at()` of every
+  face points out, volume positive).
+- `Shell` otherwise. **A failed close is not an error.** Always check
+  `isinstance(result, Part)`.
+- An open `Shell` result keeps **each face's input normal**; nothing is unified. A Shell with
+  mixed normals thickens to a volume-0 Part (or `KernelError`). Orient the pieces before
+  stitching when the result stays open and will be thickened (see `generic`).
+
+## Finding what did not close
+Free edges are edges with one face:
+
+```python
+free = [e for e in block.edges() if len(e.faces()) == 1]
+```
+
+0 free edges and a `Shell` means sewn shut but not a valid solid (see Gaps). Print
+`e.center()` of the free edges to see where the hole is. Duplicate faces or three faces on one
+edge also give a `Shell` with free edges, without an error.
+
+## Gaps
+stitch joins the topology; it **never moves geometry**. Gaps end up inside the tolerances.
+
+- Without `tolerance`, gaps up to about 0.35 % of the bbox diagonal close (10 mm cube: a top
+  face 0.06 off closes, 0.07 does not). `tolerance` cannot make this stricter.
+- For larger gaps, `tolerance` ≥ gap sews the edges but returns a `Shell` (0 free edges, not
+  manifold). `stitch(that_shell)` then gives a `Part`.
+- Such a Part is "valid" and keeps the gap: a cube with its top face 0.5 mm too high stitched
+  with `tolerance=1` has volume 1050 (face at z 5.5) but `bbox()` and vertices at z 5.0. STEP
+  export keeps the broken body.
+
+Do not fix gaps with tolerance. Build the pieces so they meet exactly: make neighbouring faces
+from the **same curves** (an edge of one face is the curve of the next, as in the example).
+
+## Gotchas
+- Closed surfaces close with caps: a closed `surface` tube + `make_face(e)` for each of its two
+  boundary edges gives a valid Part (9424.761 vs 9424.778 exact). A torus grid (closed both ways)
+  alone: `stitch(torus)` is a Part.
+- `make_face(edge)` makes a cap from a closed planar edge, also a bspline one.
+- Pieces of a polyline: `ruled` per edge, then stitch, gives one Shell (shared edges merged).
+- `stitch` of an existing valid Part returns it as a Part.
+
+## Errors
+- `ValueError: nothing to stitch`: empty input.
+- Everything else comes back as a `Shell` instead of an error (see Returns).
+
+## Example
+Freeform top, four ruled walls down to z = 0 and a flat bottom, closed into a solid. The walls
+are ruled from the top's own boundary edges, so they meet it exactly.
+
+```python
+import math
+
+h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
+top = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
+walls = []
+for e in top.edges():                                  # the top's own boundary curves
+    a, b = e.start, e.end
+    walls.append(ruled(e, Line((a.x, a.y, 0), (b.x, b.y, 0))))   # same direction as e
+bottom = make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True))
+
+block = stitch(top, walls, bottom)
+if not isinstance(block, Part):                        # a Shell: something did not close
+    free = [e for e in block.edges() if len(e.faces()) == 1]
+    raise ValueError(f"{len(free)} free edges, e.g. at {free[0].center()}")
+print(block.is_valid(), round(block.volume, 2), len(block.faces()))   # True 23997.28 6
+```
+
+The volume matches the integral of h over the rectangle (23997.27).
+
+## Related
+`surface`, `ruled`, `make_face`, `Face.to_shell`, `Shell`, `Shell.heal`, `generic`
diff --git a/src/smlibpy/skill/references/surfaces/Shell.md b/src/smlibpy/skill/references/surfaces/Shell.md
new file mode 100644
index 0000000..a8cc064
--- /dev/null
+++ b/src/smlibpy/skill/references/surfaces/Shell.md
@@ -0,0 +1,83 @@
+# Shell
+
+A sheet body: one or more faces that do not enclose a volume. The type of every surface result.
+
+## Where Shells come from
+- `surface`, `ruled`
+- `extrude`, `revolve`, `loft`, `sweep` of an **open** curve (closed wires and sketches give Parts)
+- `face.to_shell()` (a copy of one face of any body)
+- `stitch` when the pieces do not close
+- `import_step` / `load` of an open body
+
+You cannot call `Shell(...)`; use the functions above.
+
+`Sketch` is a subclass of `Shell`: `isinstance(Rectangle(1, 1), Shell)` is True. To tell a
+solid from a sheet, test `isinstance(x, Part)`.
+
+## Members
+- `faces()`, `edges(seams=False)`, `vertices()`, `wires()`, `bbox()`, `info()`: as on a Part.
+- `area`: sum of the face areas (exact: 1381.0753 vs integral 1381.0754).
+- `center()`: area centroid.
+- `thicken(thickness)` → `Part` (see below). The module function `thicken(shell_or_face, t)` is
+  the same and also takes a `Face`.
+- `heal()` → Shell: repairs tolerances and topology of a sewn shell (it turned a sewn but
+  non-manifold stitch result into a manifold one). It does **not** sew separate faces; use
+  `stitch` for that.
+- `to_nurbs()`, `translate`, `rotate`, `mirror`, `scale`, `moved`, `on`, `named`, `colored`:
+  return a Shell.
+- `distance_to(point_or_body)`, `closest_point(p)`, `intersection_curves(body)`,
+  `project(curve, direction)`, `silhouette`, `outline`: work on sheets.
+- `show(path=..., open_browser=False)` writes the HTML viewer; `export("x.step" / ".stl" /
+  ".glb")`, `mesh()`, `save`/`load` all take Shells; `import_step` of a sheet gives a Shell.
+- `a + b` (Shell + Shell): Boolean union of sheets. Overlapping coplanar sheets merge into one
+  face; crossing sheets are split along the crossing.
+
+Missing on purpose: `volume`, `is_valid`, `solids`, `mass_properties`, `fillet`, `shell`.
+`shell - shell` and `shell & shell` raise `TypeError`.
+
+## thicken
+`shell.thicken(t)` offsets every face by `t` along its normal and closes the sides.
+
+- `t > 0` adds material on the normal side, `t < 0` on the other side. Check the normal first:
+  `shell.faces()[0].normal_at(point)`. The normal rule of each source is in `surface`, `ruled`;
+  `stitch` makes normals outward only when it closes into a Part (an open stitched Shell keeps
+  the input normals); `mirror` flips them.
+- All faces of a multi-face Shell must agree: a floor (normal +Z) and a wall whose normal points
+  away from the floor thicken to volume 0 with `is_valid()` False, without an error.
+- Exact on smooth sheets: a revolved half tube R 10 thickened by 1, 5, 9.9, 10, 12 outward and
+  by -5, -9.9 inward matches the formula to 1e-3.
+- Inward thickness must stay below the smallest radius of curvature: R 10 inward by 10 raises
+  `KernelError: thicken failed (SM_ERR)`.
+- A stitched open shell with consistent normals (an open box made from a Box's faces) thickens
+  with mitred corners: 20 mm cup, `thicken(-1)` gives 1844 = 20³ − 18²·19.
+- Separate faces in one Shell give separate plates in one Part.
+- `thicken(0)`: `KernelError ... (SM_ERR_INVALID_INPUT)`.
+- `both=True` is accepted but **ignored**: the result is the same as without it.
+
+**Always check the result**: `p.is_valid() and p.volume > 0`. Closed grid surfaces (a tube from
+`surface`) and surfaces with a pole (a dome from `surface`) thicken into Parts of volume 0,
+sometimes with `is_valid()` True, sometimes not; repeated calls may instead raise. Close such
+shapes with caps (`stitch(tube, caps)`) or build them with `revolve`/`loft`.
+
+## Part and Shell Booleans
+`part & shell`, `part - shell` and `part + shell` do not raise; they return invalid "Parts"
+(volume 0, or the box with the sheet imprinted). The one useful case: `stitch(part & shell)`
+returns the piece of the sheet inside the solid as a `Shell` (trimming a sheet with a solid).
+
+## Example
+```python
+box = Box(20, 20, 20)
+cup = stitch([f for f in box.faces() if f.normal_at().z < 0.5])   # 5 faces: an open box
+print(type(cup).__name__, len(cup.faces()), cup.area)              # Shell 5 2000.0
+print(cup.faces().bottom()[0].normal_at())                        # (0, 0, -1): outward
+wall = cup.thicken(-1)                                            # inward: outer size stays 20
+print(wall.is_valid(), round(wall.volume, 3), wall.bbox().size)   # True 1844.0 (20, 20, 20)
+
+f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
+saddle = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
+disc = stitch(Cylinder(8, 30).translate(20, 15, 0) & saddle)     # trim the sheet with a solid
+print(type(disc).__name__, round(disc.area, 3))                  # Shell 202.344
+```
+
+## Related
+`surface`, `ruled`, `stitch`, `generic`, `Face.to_shell`, `extrude`/`loft`/`sweep` of open curves
