# Training: parts · holes

**Date:** 2026-10-12

## Goal

APIs: `Hole`, `CounterBoreHole`, `CounterSinkHole`, with `.on(face)`, `GridLocations`,
`PolarLocations`, `Pos`.

Questions:
- Where does a hole tool sit? Is it cut automatically or is it a tool for `-`?
- How deep is a through hole; what happens at exactly the plate thickness?
- How does `.on(face)` orient a pattern on top, front, right and bottom faces?
- What do the counterbore and countersink parameters mean, measured?
- What do bad parameters do?

Expected from the code: `Hole` = `Cylinder(r, depth, align=(C, C, MAX))`, so z −depth..0; no
align. `CounterBoreHole` fuses two such cylinders. `CounterSinkHole` fuses a hole with a cone of
height (csr − r)/tan(angle/2). `.on(face)` uses `face.plane`, whose origin is the face centroid.

## Runs

### 01-hole-tool.py
`Hole(3, 10)`: bbox (−3, −3, −10)..(3, 3, 0), 3 faces. A tool, not a cut: subtract it.
`Hole(3)` → TypeError (depth required). 0 or negative values → `ValueError: radius and height
must be positive`. No `align`. Top face plane of Box(60, 40, 10): origin (0, 0, 5), x_dir +X.
Blind hole 6 deep from the top: removed 169.6459 = π·9·6; cylinder face z −1..5; flat bottom
face at z −1 (no drill point). Faces 6 → 8, valid.
![blind](files/01-hole-tool-blind.png)

### 02-through-and-grid.py
Depth 10 (exactly the thickness), 10.0001, 12, 100: all valid, 7 faces, removed 282.7432 =
π·9·10. The flush top and the coplanar bottom are fine. `GridLocations(40, 20, 2, 2)` on top →
holes at (±20, ±10). Holes outside the part (x = ±40 on a 60 long box) cut nothing, silently.
Without `.on()` the tool hangs down from z = 0, the middle of a centered box.

### 03-faces-orientation.py
Local axes of face planes, measured: top: x = +X, y = +Y. Front (−Y): x = +X, y = +Z, holes go
in +Y (axis direction (0, −1, 0)). Right (+X): x = +Y, y = +Z; `Pos(10, 2)` → world (30, 10, 2).
**Bottom (−Z): x = +X, y = −Y**: `Pos(10, 5)` on the bottom → world (10, −5); the hole goes up
(z −5..−1).
- 📌 doc: table of face axes; bottom face mirrors Y.

### 04-face-center-shift.py
After one Ø10 hole at x = 20, the top face centroid is (−0.677, 0, 5). A second hole at
`Pos(-20, 0)` on the new top face lands at x = −20.677. **Silent misplacement.** Placing on
`Plane.XY.offset(5)` or on one `Locations` pattern on the original face gives (−20, 0).
`on()` with two faces → `ValueError: expected exactly one shape, got 2 - narrow the selection or use [0]`.
Defect MEDIUM (todo #13).

### 05-hole-other-targets.py
`PolarLocations(22, 6) * Hole(3, 8)` on a flange top: 6 holes at radius 22. On a cylindrical face:
`ValueError: a cylinder face has no plane; use normal_at() or a planar face`. On a 45° chamfer
face: hole axis along the face normal (0.707, 0, 0.707), valid.
Hole on the part edge: half removed (141.371). Hole that misses: volume unchanged.
![tilted](files/05-hole-other-targets-tilted.png)

### 06-counterbore.py
`CounterBoreHole(2, 4, 3, 10)`: bbox z −10..0. Cylinder r 2 from −10 to −3, r 4 from −3 to 0.
`depth` is the total depth from the face; the counterbore is part of it. Cut into Box(60, 40, 10):
r 2 z −5..2, r 4 z 2..5, shoulder face at z 2 with area π(16−4). Faces 6 → 9, valid.
![section](files/06-counterbore-cbsec.png)

### 07-counterbore-edge-cases.py
`counter_bore_radius <= radius` → a plain cylinder of the larger radius, no error.
`counter_bore_depth >= depth` → a plain counterbore cylinder, deeper than `depth` when larger.
0 or negative values → `ValueError: radius and height must be positive` (Cylinder's message).
Defect LOW (todo #14).

### 08-countersink.py
`CounterSinkHole(2, 4, 10)` (angle 82): cone face z −2.3007..0, = (4 − 2)/tan(41°). Half angle
from the normal of the cone face: 41.0°, so `angle` is the included angle. Cut into Box(60, 40,
10): removed 164.2129 = formula. angle 60 → sink 3.4641, 90 → 2.0, 120 → 1.1547, 179 → 0.0175.
angle 180 → `KernelError: Cone failed (SM_ERR_INVALID_INPUT)`; 0 → `ZeroDivisionError`;
−82 → `ValueError: invalid cone dimensions`. Defect LOW (todo #15).

### 09-countersink-edges.py
The edge between the cone and the drill is a `bspline`, not a circle: `edges().circles()` finds
only the bottom and the top circles. Tool faces: plane, cylinder, plane, cone. LOW (todo #16).

### 10-realistic-plate.py
Plate 80×60×10 on XY: 4 counterbores (M6) on top, 2 countersinks on the front face, a 20 mm
blind pocket. Valid, one solid, bbox as planned. Cylinder axes at (±30, ±20), front holes at
x ±15, axis −Y. The faces `top` and `front` were selected before any cut and reused after:
their planes keep the original centers, so the pocket is at (0, 0).
![plate](files/10-realistic-plate-plate.png)
- 📌 doc: select the target faces once, before cutting.

### 11-doc-hole.py, 12-doc-cb-cs.py
The doc examples. A hole's cylinder face: `axis.origin` is the bottom of the hole, the direction
points to the opening ((0, 0, 1) for top holes, (0, −1, 0) for a hole in the front face).
Polar holes at radius 22.0 measured from `axis.origin`. Counterbore M6 (3.3, 5.5, 6.5, 10):
r 3.3 z 0..3.5, r 5.5 z 3.5..10, removed 2949.83 = 4π(3.3²·3.5 + 5.5²·6.5). Countersink
(2.2, 4.5, 8, angle=90): cone z 7.7..10, circles (2.2 at z 2), (4.5 at z 10).

## Coverage

- [x] every API ran; every parameter tried (angle values, depths)
- [x] defaults measured (hole tool position, angle 82 = included angle)
- [x] edge and error cases
- [x] realistic use (10)
- [x] spatial claims backed by axes and bboxes
- [x] questions answered: placement (01–05), through (02), faces (03, 04), counterbore (06, 07),
  countersink (08, 09)

### 13-back-left-and-repro.py
Back face: x = −X, y = +Z (`Pos(10, 2)` → (−10, 20, 2)); left face: x = −Y, y = +Z
(`Pos(10, 2)` → (−30, −10, 2)). The todo #13 reproduction prints [−20.677, 20.0].

### 14-countersink-checks.py
`CounterSinkHole(2, 4, 1)` (depth below the 2.3 sink): the tool is the full cone, z −2.3..0, no
drill face; `depth` is ignored. The B-spline sink edge of the M4 example is found with
`edges().filter_by(lambda e: abs(e.center().z - z_sink) < 1e-3)`: 1 edge, length 13.823 = 2π·2.2.

### 15-countersink-errors.py
radius 0 or depth 0 → `ValueError: radius and height must be positive`; radius −1,
counter_sink_radius equal to or below radius → `ValueError: invalid cone dimensions`.

Docs written: Hole, CounterBoreHole, CounterSinkHole.
