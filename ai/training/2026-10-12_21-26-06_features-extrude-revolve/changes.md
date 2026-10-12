diff --git a/src/smlibpy/skill/references/features/extrude.md b/src/smlibpy/skill/references/features/extrude.md
new file mode 100644
index 0000000..7f49011
--- /dev/null
+++ b/src/smlibpy/skill/references/features/extrude.md
@@ -0,0 +1,80 @@
+# extrude
+
+Turns a sketch, a planar face or a closed wire into a solid by pushing it along a direction.
+An open curve extrudes into a surface (`Shell`).
+
+## Signature
+`sketch.extrude(amount, *, both=False, taper=0.0, direction=None)`
+`face.extrude(amount, **same keywords)` (planar faces only)
+`extrude(profile, amount, *, both=False, taper=0.0, direction=None)` (sketch, face, one-element
+face list, wire or edge)
+
+- `amount`: mm along the sketch normal. Negative goes against the normal. 0 raises.
+- `both=True`: `abs(amount)` to each side of the sketch (total `2*abs(amount)`).
+- `taper`: degrees. Positive narrows the solid away from the sketch, negative widens it. Works
+  with negative amounts and `both` too (each side narrows away from the sketch).
+- `direction`: a vector to extrude along instead of the normal. `amount` is the length along
+  that vector, so the height above the sketch is `amount * cos(angle to the normal)`.
+
+## Returns
+A `Part` (an open curve gives a `Shell`). The solid starts at the sketch plane:
+`Rectangle(40, 30).extrude(5)` spans z 0..5, `extrude(-5)` z -5..0, `both=True` z -5..5.
+
+## Direction
+- A sketch extrudes along `sketch.plane.z_dir`. `Plane.front` (= `Plane.XZ`) has normal **-Y**:
+  a sketch on it extrudes towards -Y.
+- `sketch.on(face)` takes the face's outward normal: a positive amount grows out of the part,
+  a negative amount goes into it. Pockets are `part -= sketch.on(face).extrude(-depth)`.
+- `face.extrude(d)` on a part's face: same rule, outward for positive `d`.
+- An open curve extrudes along the normal of its plane (+Z for a curve in XY), or +Z when the
+  curve is a straight line. Pass `direction=` for anything else.
+
+## Gotchas
+- **`taper` loses the holes of the profile.** `(Circle(10) - Circle(5)).extrude(10, taper=5)`
+  returns the full cone with no hole and no error. Taper the outer region and cut each hole as
+  its own tapered extrusion with the opposite sign (see the example).
+- `taper` ignores `direction` (it always follows the normal). `taper` on an open curve is
+  ignored.
+- A taper that closes the profile before `amount` silently stops there: 20x20 with
+  `taper=56` and amount 10 ends at height 6.745 (a pyramid). Check `bbox()` after large tapers.
+  `taper=90` returns an invalid, empty body without an error. Keep `|taper|` well below
+  `atan(amount / half the smallest width)`.
+- A positive extrusion from a face, subtracted from the part, removes nothing (the tool is
+  outside). The volume stays the same and nothing is raised: check the volume after each cut.
+- A sketch moved by `translate` or `Pos(...) *` keeps its normal; only `.on(...)`, `rotate`
+  and the plane change it.
+
+## Errors
+- `ValueError: extrude amount must not be zero`.
+- `TypeError: expected a sketch, face or closed wire, got Part` (pass a face, not the part).
+- `ValueError: a cylinder face has no plane; use normal_at() or a planar face` for curved faces.
+- `KernelError: make face failed (SM_ERR): the wire must be planar and must not cross itself`
+  when a closed wire crosses itself.
+
+## Example
+```python
+plate = Rectangle(40, 30).extrude(5)                    # z 0..5
+down = Rectangle(40, 30).extrude(-5)                    # z -5..0
+slab = Rectangle(40, 30).extrude(5, both=True)          # z -5..5
+wall = Rectangle(20, 10).on(Plane.front).extrude(5)     # Plane.front faces -Y: y -5..0
+slant = Circle(5).extrude(20, direction=(0, 1, 2))      # 20 measured along the direction
+
+box = Box(40, 30, 20)
+top = box.faces().top()
+box -= Rectangle(20, 10).on(top).extrude(-5)            # pocket 5 deep
+print(box.is_valid(), round(box.volume, 3))             # True 23000.0
+
+boss = Box(40, 30, 20)
+boss += boss.faces().top()[0].extrude(5)                # grow the top face by 5
+print(boss.bbox().max.z)                                # 15.0
+
+core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)  # sides lean in by 3 degrees
+ring = Circle(10).extrude(10, taper=5) - Circle(5).extrude(10, taper=-5)  # tapered ring with a hole
+print(round(ring.volume, 3))                            # 1943.914
+
+sheet = extrude(CenterArc((0, 0), 10, 0, 180), 5)       # open curve -> Shell
+print(type(sheet).__name__, round(sheet.area, 3))       # Shell 157.08
+```
+
+## Related
+`revolve`, `loft`, `sweep`, `thicken` (surfaces to solids), `draft` (tapered walls).
diff --git a/src/smlibpy/skill/references/features/revolve.md b/src/smlibpy/skill/references/features/revolve.md
new file mode 100644
index 0000000..04c1db0
--- /dev/null
+++ b/src/smlibpy/skill/references/features/revolve.md
@@ -0,0 +1,66 @@
+# revolve
+
+Turns a sketch about an axis into a solid of revolution. An open curve gives a surface
+(`Shell`).
+
+## Signature
+`sketch.revolve(axis=None, angle=360.0)`
+`revolve(profile, axis=None, angle=360.0)` (sketch, planar face, face list, wire or edge)
+
+- `axis`: an `Axis` (`X`, `Y`, `Z`, or `Axis(origin, direction)`). It must lie in the sketch
+  plane. **Always pass it.**
+- `angle`: degrees, counter-clockwise about the axis direction (right-hand rule). About `Z`,
+  90 sweeps from +X towards +Y.
+
+## Returns
+A `Part`. For a full revolution the volume is `area * 2*pi * (distance of the region's centroid
+from the axis)` (Pappus): compare with that.
+
+## The lathe setup
+Draw the half profile in XY with x = radius and y = height, place it on `Plane.front` and
+revolve about `Z`. On `Plane.front` local x is world X and local y is world Z.
+
+## Gotchas
+- **The default axis is not the world axis.** It is the sketch's local Y axis through the
+  sketch's plane origin, and that origin moves with the sketch: `translate`, `Pos(...) *` and
+  `align=` move it too. `Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve()` revolves
+  about x = 15, through the middle of the region. Only a sketch built without `align`,
+  `translate` or `Pos` keeps its plane origin at the world origin.
+- **A region that crosses the axis gives no error with angle 360.** The result reports
+  `is_valid() == True` with a zero or negative volume. Partial angles raise
+  `SM_ERR_AXIS_INSIDE_FACE`. Check `volume > 0` and compare with Pappus.
+- An edge on the axis is fine (solid without a bore), and so is a single vertex touching it.
+- **Negative angles do not reverse the direction**: `-90` revolves 270 degrees the positive
+  way. To go the other way, flip the axis: `Axis((0, 0, 0), (0, 0, -1))` with a positive angle.
+  `angle=0` and `-360` return invalid bodies. Angles above 360 are a full revolution.
+- An axis perpendicular to the sketch plane (`Circle(3).translate(10, 0).revolve(Z)` on XY)
+  returns a flat, zero-volume body without an error.
+- Regions with holes and several separate regions work, with an explicit axis.
+
+## Errors
+- `KernelError: revolve failed (SM_ERR_AXIS_INSIDE_FACE): the axis must not cross the region`
+  for a partial revolution of a region that crosses the axis.
+
+## Example
+```python
+profile = Polygon((5, 0), (30, 0), (30, 3), (26, 6), (26, 10), (30, 13), (30, 16), (5, 16))
+pulley = profile.on(Plane.front).revolve(Z)             # x = radius, y = height
+print(pulley.is_valid(), round(pulley.volume, 3))       # True 39006.014
+
+quarter = profile.on(Plane.front).revolve(Z, 90)        # from +X towards +Y
+other = profile.on(Plane.front).revolve(Axis((0, 0, 0), (0, 0, -1)), 90)  # from +X towards -Y
+
+tube = Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve(Z)
+print(round(tube.volume, 3))                            # 18849.557 = pi*(20^2-10^2)*20
+
+donut = (Circle(5) - Circle(2)).translate(20, 0).on(Plane.front).revolve(Z)
+print(round(donut.volume, 3))                           # 8290.468
+
+wrong = Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve()   # default axis: through the sketch origin (15, 0)!
+print(wrong.is_valid(), round(wrong.volume, 3))         # True, but the volume is nonsense
+
+dome = revolve(CenterArc((0, 0), 10, -90, 180, plane=Plane.front), Z)  # open curve -> Shell
+```
+
+## Related
+`extrude`, `sweep`, `Torus`, `Cone`, `Plane.front`, `Axis`.
