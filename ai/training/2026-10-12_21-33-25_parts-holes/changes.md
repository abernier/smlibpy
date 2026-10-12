diff --git a/src/smlibpy/skill/references/parts/Hole.md b/src/smlibpy/skill/references/parts/Hole.md
new file mode 100644
index 0000000..47364b5
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/Hole.md
@@ -0,0 +1,85 @@
+# Hole
+
+A drilling tool: a cylinder that hangs down from the origin. Subtract it from a part.
+
+## Signature
+
+`Hole(radius, depth)`
+
+- `radius` (not diameter) and `depth` in mm; both required. No `align`.
+
+## Returns
+
+A `Part`: a cylinder from z = −depth to z = 0, axis on Z. `Hole(3, 10)` has bbox
+(−3, −3, −10)..(3, 3, 0). It does not cut anything by itself: `part -= Hole(...).on(face)`.
+
+## How it is placed
+
+`.on(face)` moves the tool's origin to the face's center and its +Z to the face's outward
+normal, so the tool points into the part. The hole starts flush with the face; the bottom is
+flat (no drill point).
+
+- Blind hole: `depth` < wall thickness. `Hole(3, 6)` on the top of a 10 mm box leaves a flat
+  bottom 6 below the top.
+- Through hole: `depth` ≥ the thickness. Exactly the thickness works (coplanar bottom is fine).
+- Several holes: put a pattern in front of the tool and the whole list `.on(face)`:
+  `(GridLocations(40, 20, 2, 2) * Hole(2, 10)).on(top)`, `(PolarLocations(22, 6) * Hole(3, 8)).on(top)`,
+  `(Pos(20, 0) * Hole(...)).on(face)`.
+- Pattern coordinates are in the face's own axes:
+
+| Face (normal) | local x | local y |
+|---|---|---|
+| top (+Z) | +X | +Y |
+| bottom (−Z) | +X | **−Y** |
+| front (−Y) | +X | +Z |
+| back (+Y) | −X | +Z |
+| right (+X) | +Y | +Z |
+| left (−X) | −Y | +Z |
+
+  Side faces keep local y up. `Pos(10, 2)` on the right face of `Box(60, 40, 10)` is world
+  (30, 10, 2); on the bottom face `Pos(10, 5)` is world (10, −5).
+
+## Gotchas
+
+- **The face center is the centroid of the face as it is now.** After one hole or pocket, the
+  top face's center moves: a hole at `Pos(-20, 0)` on the new top face of a 60×40 box with a Ø10
+  hole at x = 20 lands at x = −20.677. Select the target faces once, before the first cut, and
+  reuse them; or place on a fixed plane (`.on(Plane.XY.offset(5))`); or put all holes into one
+  pattern.
+- Without `.on()` the tool sits at the origin: in a centered `Box` it drills from the middle
+  (z 0 down), not from the top.
+- `.on()` needs exactly one planar face. Two faces: `ValueError: expected exactly one shape, got 2 -
+  narrow the selection or use [0]`. A cylinder face: `ValueError: a cylinder face has no plane`.
+- A tilted planar face works: the hole follows the face normal.
+- Tools that miss the part cut nothing and raise nothing. Check the face count or the volume
+  after the cut: each through hole adds 1 face, a blind hole 2.
+- Measure hole positions with the cylinder face's `axis`: `axis.origin` is the bottom of the
+  hole and `axis.direction` points to the opening.
+
+## Errors
+
+- `radius <= 0` or `depth <= 0`: `ValueError: radius and height must be positive`.
+- `Hole(3)`: `TypeError: missing 1 required positional argument: 'depth'`.
+
+## Example
+
+```python
+part = Box(60, 40, 10)
+top = part.faces().top()                                    # select once, before cutting
+part -= Hole(3, 6).on(top)                                  # blind, 6 deep, at the face center
+part -= (GridLocations(40, 20, 2, 2) * Hole(2, 10)).on(top) # through (the box is 10 thick)
+part -= (Pos(20, 0) * Hole(1.5, 4)).on(part.faces().front())  # into the front face
+print(part.is_valid(), len(part.faces().cylinders()))       # True 6
+for f in part.faces().cylinders():
+    print(round(f.radius, 2), f.axis.origin, f.axis.direction)
+
+# six bolt holes on a circle of radius 22
+flange = Cylinder(30, 8)
+bolts = flange - (PolarLocations(22, 6) * Hole(3, 8)).on(flange.faces().top())
+print(sorted(round(math.hypot(f.axis.origin.x, f.axis.origin.y), 4) for f in bolts.faces().cylinders()))
+```
+
+## Related
+
+`CounterBoreHole`, `CounterSinkHole`, `Cylinder`, `booleans`, `geometry/GridLocations`,
+`geometry/PolarLocations`, `geometry/Plane` (face planes).
diff --git a/src/smlibpy/skill/references/parts/CounterBoreHole.md b/src/smlibpy/skill/references/parts/CounterBoreHole.md
new file mode 100644
index 0000000..87fdd11
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/CounterBoreHole.md
@@ -0,0 +1,54 @@
+# CounterBoreHole
+
+A drilling tool with a counterbore (a wider, flat-bottomed recess) at the top, for socket head
+screws. Subtract it from a part.
+
+## Signature
+
+`CounterBoreHole(radius, counter_bore_radius, counter_bore_depth, depth)`
+
+All four are required, all radii (not diameters), mm:
+
+- `radius`: the drill.
+- `counter_bore_radius`: the recess for the head; must be larger than `radius`.
+- `counter_bore_depth`: depth of the recess, measured from the face.
+- `depth`: **total** depth from the face, recess included. Must be larger than `counter_bore_depth`.
+
+## Returns
+
+A `Part` hanging down from the origin like `Hole`: `CounterBoreHole(2, 4, 3, 10)` is a
+cylinder r 4 from z −3 to 0 on top of a cylinder r 2 from z −10 to −3. One solid, 5 faces.
+Place it with `.on(face)` exactly like `Hole` (same face axes, same centroid caveat).
+
+Cut into the top of `Box(60, 40, 10)` (top at z 5): drill r 2 from z −5 to 2, recess r 4 from
+z 2 to 5, a flat shoulder at z 2 of area π(4² − 2²). The part gains 3 faces.
+
+## Gotchas
+
+- `depth` is not the drill length below the recess. For a through hole in a plate of thickness
+  t, use `depth >= t`.
+- No parameter checks: `counter_bore_radius <= radius` gives a plain hole of the larger radius;
+  `counter_bore_depth >= depth` gives one cylinder `counter_bore_depth` deep. Check the faces of
+  the result if the numbers come from a calculation.
+
+## Errors
+
+- A zero or negative value: `ValueError: radius and height must be positive` (the message comes
+  from the cylinder inside).
+- Three arguments: `TypeError: missing 1 required positional argument: 'depth'`.
+
+## Example
+
+```python
+# Counterbore for an M6 socket head screw through a 10 mm plate
+plate = Box(80, 60, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
+top = plate.faces().top()
+plate -= (GridLocations(60, 40, 2, 2) * CounterBoreHole(3.3, 5.5, 6.5, 10)).on(top)
+print(sorted({(round(f.radius, 2), round(f.bbox().min.z, 3), round(f.bbox().max.z, 3))
+              for f in plate.faces().cylinders()}))      # [(3.3, 0.0, 3.5), (5.5, 3.5, 10.0)]
+print(plate.is_valid(), round(80 * 60 * 10 - plate.volume, 3))   # 4 * pi * (3.3² * 3.5 + 5.5² * 6.5)
+```
+
+## Related
+
+`Hole`, `CounterSinkHole`, `booleans`, `geometry/GridLocations`.
diff --git a/src/smlibpy/skill/references/parts/CounterSinkHole.md b/src/smlibpy/skill/references/parts/CounterSinkHole.md
new file mode 100644
index 0000000..856d180
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/CounterSinkHole.md
@@ -0,0 +1,60 @@
+# CounterSinkHole
+
+A drilling tool with a conical countersink at the top, for flat head screws. Subtract it from
+a part.
+
+## Signature
+
+`CounterSinkHole(radius, counter_sink_radius, depth, angle=82.0)`
+
+Radii (not diameters), mm and degrees:
+
+- `radius`: the drill.
+- `counter_sink_radius`: radius of the sink at the face (the head radius); larger than `radius`.
+- `depth`: **total** depth of the drill from the face, sink included.
+- `angle`: the **included** angle of the cone (82 is the inch standard; metric ISO flat heads use 90).
+
+There is no sink depth parameter: it follows from the radii and the angle,
+`(counter_sink_radius - radius) / tan(angle / 2)`. 82° and radii 2 / 4 → 2.3007 deep;
+90° → exactly `counter_sink_radius - radius`.
+
+## Returns
+
+A `Part` hanging down from the origin like `Hole`: a cone from r `counter_sink_radius` at z 0
+to r `radius` at z −sink depth, and the drill down to z −depth. Faces: cone, cylinder, two planes.
+Place it with `.on(face)` exactly like `Hole` (same face axes, same centroid caveat).
+
+Measured on `CounterSinkHole(2, 4, 10)`: cone face z −2.3007..0, the cone surface is 41.0° from the
+axis (half of 82). Cut into `Box(60, 40, 10)`: removed volume 164.2129 = drill + frustum.
+
+## Gotchas
+
+- `angle` is the included angle, not the half angle. Sink depth by angle (radii 2 / 4): 60° → 3.46,
+  90° → 2.0, 120° → 1.15.
+- The edge between the cone and the drill is a B-spline, not a circle: `part.edges().circles()`
+  finds the top circle and the drill's bottom circle, not this one. Select it by position
+  (`part.edges().filter_by(lambda e: abs(e.center().z - z_sink) < 1e-3)`).
+- `depth` smaller than the sink depth is ignored: `CounterSinkHole(2, 4, 1)` is the full cone,
+  2.3 deep, with no drill. Keep `depth` larger than the sink.
+
+## Errors
+
+- `counter_sink_radius <= radius`, a negative radius or a negative angle:
+  `ValueError: invalid cone dimensions`.
+- `angle=180`: `KernelError: Cone failed (SM_ERR_INVALID_INPUT)`. `angle=0`: `ZeroDivisionError`.
+- `radius == 0` or `depth <= 0`: `ValueError: radius and height must be positive`.
+
+## Example
+
+```python
+# Countersink for an M4 flat head (ISO 90 degrees), 8 deep in total
+block = Box(40, 40, 20)
+block -= CounterSinkHole(2.2, 4.5, 8, angle=90).on(block.faces().top())
+cone = block.faces().filter_by(lambda f: f.geom_type == "cone").one()
+print(round(cone.bbox().min.z, 3), round(cone.bbox().max.z, 3))   # 7.7 10.0: sink depth 4.5 - 2.2 = 2.3
+print(sorted((round(e.radius, 3), round(e.center().z, 3)) for e in block.edges().circles()))
+```
+
+## Related
+
+`Hole`, `CounterBoreHole`, `Cone`, `booleans`.
