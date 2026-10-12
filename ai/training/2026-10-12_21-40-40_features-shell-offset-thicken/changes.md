diff --git a/src/smlibpy/skill/references/features/shell.md b/src/smlibpy/skill/references/features/shell.md
new file mode 100644
index 0000000..ec16906
--- /dev/null
+++ b/src/smlibpy/skill/references/features/shell.md
@@ -0,0 +1,75 @@
+# shell
+
+Hollows a solid to walls of a given thickness, optionally leaving faces open.
+
+## Signature
+`part.shell(thickness, openings=None, *, outward=False)`
+`shell(part, thickness, openings=None, *, outward=False)`
+
+- `thickness`: wall thickness. The sign is ignored; the direction comes from `outward`.
+- `openings`: faces to remove: a selection, one `Face`, or a sum of selections
+  (`faces().top() + faces().bottom()`). Faces from an earlier version of the part are matched
+  by position and area. `None` makes a closed hollow body.
+- `outward=False`: walls grow inward, the outside keeps its size. `outward=True`: the original
+  becomes the cavity and the walls grow outside; **the outer edges and corners come out
+  rounded with radius = thickness** (a 80x50x30 box with 2.5 out: 85 x 55 x 32.5, vol 31398.0,
+  not the sharp 31937.5). Use `offset` minus the part if you need sharp outer edges.
+
+## Returns
+A `Part`. Prismatic parts are exact: `Box(80, 50, 30).shell(2.5, top)` has volume
+`80*50*30 - 75*45*27.5`. Spheres, tori, cones, revolved and lofted parts, parts with holes and
+bosses work too.
+
+## Limits
+- Closed shell: thickness below half the smallest inner dimension. **Above it the result can
+  be a valid-looking wrong body**: `Box(40, 30, 10).shell(6)` returns `is_valid() == True`,
+  volume 10992 (the box has 12000; a 6 mm wall cannot fit in a 10 mm height). At exactly half
+  it raises.
+- Open shell: thickness below the depth to the opening. At exactly the depth it raises
+  `ModelingError` — and **sometimes crashes the Python process** (segmentation fault, 7 of
+  20 runs for `Box(40, 30, 10).shell(10, top)`). Never call shell with a wall equal to a
+  part dimension.
+- Opening every face: `ModelingError: shell: the kernel could not build a valid result; try a smaller value`.
+- `thickness=0`: `KernelError: shell failed (SM_ERR_INVALID_INPUT): ...`.
+
+## With fillets
+- Fillet first, then shell, when the inside should follow the rounds. The inner rounds get
+  radius `r - t`; with `t > r` the shell fails (all-edge r5 box, t6: `shell failed`).
+- Pick the opening face of a rounded box with `faces().planar().top()`: `faces().top()` also
+  returns rounds whose center is high.
+- Shell first and fillet the outer edges after when the walls are thin; then fillet the inner
+  edges with `r_outer - t` for an even wall.
+
+## Gotchas
+- Opening a curved end face can fail where a planar one works: a rectangle-to-circle loft
+  shells with the bottom open but not with the circular top open (`shell failed (SM_ERR)`).
+  Subtract an inner body instead.
+- smlibpy retries the kernel up to eight times and checks validity, bbox and volume; slow parts
+  take a few tenths of a second.
+- Check: `volume` drops (inward) and `bbox()` stays the same; compare with outer minus inner.
+
+## Errors
+- `KernelError: shell failed (SM_ERR): the wall may be thicker than the part allows`
+- `ModelingError: shell: the kernel could not build a valid result; try a smaller value`
+
+## Example
+```python
+box = Box(80, 50, 30)
+tray = box.shell(2.5, box.faces().top())                # open top, walls grow inward
+print(round(tray.volume, 1))                            # 27187.5 = 80*50*30 - 75*45*27.5
+case = box.shell(2.5)                                   # closed, hollow inside
+sleeve = box.shell(2.5, box.faces().top() + box.faces().bottom())  # two openings
+lining = box.shell(2.5, box.faces().top(), outward=True)  # outside grows to 85 x 55, edges rounded r2.5
+print(lining.bbox().size.to_tuple(), round(lining.volume, 1))  # (85.0, 55.0, 32.5) 31398.0
+
+cup = Cylinder(20, 30).shell(2, Cylinder(20, 30).faces().top())
+
+# rounded box: fillet first with radius > wall, then shell; the inner corners get r - t
+body = Box(60, 40, 20)
+body = body.fillet(body.edges(), 5)
+shelled = body.shell(2, body.faces().planar().top())   # the flat top face, inside the rounds
+print(shelled.is_valid(), round(shelled.volume, 1))     # True 11134.4
+```
+
+## Related
+`offset`, `thicken`, `fillet`, `loft`.
diff --git a/src/smlibpy/skill/references/features/offset.md b/src/smlibpy/skill/references/features/offset.md
new file mode 100644
index 0000000..98e1c21
--- /dev/null
+++ b/src/smlibpy/skill/references/features/offset.md
@@ -0,0 +1,41 @@
+# offset
+
+Grows or shrinks a solid by moving every face along its normal.
+
+## Signature
+`part.offset(distance)`
+`offset(shape, distance)` (a `Part`, or a `Sketch` for the 2D offset of `Sketch.offset`)
+
+- `distance`: positive grows, negative shrinks. 0 returns an equal copy.
+
+## Returns
+A `Part` with **sharp** edges: faces are extended until they meet, nothing is rounded.
+`Box(20, 20, 20).offset(2)` is a 24 mm cube (13824.0), `Cylinder(5, 10).offset(1)` is a
+cylinder r6 h12. Holes shrink when the part grows and grow when it shrinks. Spheres stay exact.
+
+## Limits
+- Shrinking: below half the smallest thickness. `Box(20, 20, 20).offset(-9.9)` works (0.2 cube);
+  -10 raises `ModelingError: offset: the kernel could not build a valid result; try a smaller value`.
+- Growing until a hole closes: `KernelError: offset failed (SM_ERR)`
+  (`(Box(40, 40, 10) - Cylinder(5, 20)).offset(5)`). Fill the hole first.
+- Shrinking a rounded part by more than a round's radius fails: a box with r3 vertical
+  fillets, `offset(-4)` → `KernelError: offset failed (SM_ERR)`. Concave rounds limit growing
+  the same way: an L-block with an r2 inner round grows by 1, fails at 2.
+
+## Gotchas
+- `offset` is not `shell(outward=True)`: the shell's outer edges come out rounded, the offset's
+  stay sharp. A sharp-edged outer skin is `part.offset(t) - part`.
+- smlibpy retries and checks validity, bbox and volume; a failure ends in the `ModelingError` above.
+
+## Example
+```python
+block = Box(20, 20, 20)
+print(block.offset(2).bbox().size.to_tuple(), round(block.offset(2).volume, 1))   # (24.0, 24.0, 24.0) 13824.0: sharp edges
+print(round(block.offset(-2).volume, 1))                # 4096.0 = 16^3
+plate = Box(40, 40, 10) - Cylinder(5, 20)
+thin = plate.offset(-2)                                 # 36 x 36 x 6, the hole grows to r 7
+print(round(thin.volume, 1))                            # 6852.4 = (36^2 - pi*7^2) * 6
+```
+
+## Related
+`shell`, `thicken`, `Sketch.offset` (2D, see sketches).
diff --git a/src/smlibpy/skill/references/features/thicken.md b/src/smlibpy/skill/references/features/thicken.md
new file mode 100644
index 0000000..eb14571
--- /dev/null
+++ b/src/smlibpy/skill/references/features/thicken.md
@@ -0,0 +1,51 @@
+# thicken
+
+Turns a surface (a `Shell`, a `Sketch`, or one face) into a solid of constant thickness.
+
+## Signature
+`shell.thicken(thickness, *, both=False)` (also on a `Sketch`, which is a sheet)
+`thicken(surface, thickness)` (a `Shell`, `Sketch` or `Face`; a part's face is copied first)
+
+- `thickness`: along the face normal; negative goes to the other side.
+- `both`: **ignored** — `Rectangle(20, 10).thicken(2, both=True)` is 2 thick, not 4. For a
+  symmetric slab thicken a copy moved by `-t/2` along the normal, or use `extrude(..., both=True)`
+  for planar sheets.
+
+## Returns
+A `Part`. Planar: exact `area * t`. Curved: exact offset volume (a half-cylinder sheet r10,
++2 → 1382.30 = π(12² − 10²)/2·20).
+
+## Which side
+The side is the face normal, so check it before you thicken:
+`sheet.faces()[0].normal_at(point)`.
+- A sketch: its plane normal (`Plane.front` → -Y).
+- A face of a part: outward, away from the material (`thicken(box.faces().top()[0], 3)` sits on top).
+- A cylinder face of a part: away from the axis.
+- An extruded open curve: depends on the curve's direction (an arc drawn counter-clockwise in
+  XY and extruded up has normals pointing away from its center).
+- A `surface(...)` from a point grid: depends on the point order (a grid with rows along Y
+  and columns along X had its normal pointing down). Check it.
+
+## Gotchas
+- Multi-face sheets thicken with sharp corners: an L-shaped sheet (two faces) thickened 1 to
+  the outside gains the corner block (310 for 300 of area), to the inside 290.
+- Thickening to the concave side by more than the radius returns `is_valid() == False`,
+  volume 0, without an error. Check `is_valid()`.
+- A `Part` has no `thicken`: `thicken(part, 1)` raises `AttributeError`. Use `offset` or `shell`.
+- `thickness=0`: `KernelError: thicken failed (SM_ERR_INVALID_INPUT)`.
+
+## Example
+```python
+panel = Rectangle(20, 10).thicken(2)                    # along the sketch normal: z 0..2
+under = Rectangle(20, 10).thicken(-2)                   # z -2..0
+box = Box(40, 30, 20)
+skin = thicken(box.faces().top()[0], 3)                 # face normal points out: z 10..13
+
+arc_sheet = extrude(CenterArc((0, 0), 10, 0, 180), 20)  # a half-cylinder surface (Shell)
+print(arc_sheet.faces()[0].normal_at((0, 10, 10)).to_tuple())   # (0, 1, 0): points away from the axis
+wall = arc_sheet.thicken(2)                             # outside: radii 10..12
+print(round(wall.volume, 2))                            # 1382.3 = pi*(12^2 - 10^2)/2 * 20
+```
+
+## Related
+`surface`, `ruled`, `stitch`, `extrude` (open curves make sheets), `offset`, `shell`.
