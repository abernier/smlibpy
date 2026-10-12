# Training: surfaces · Shell

**Date:** 2026-10-12

## Goal

APIs: `Shell` (`faces`, `edges`, `area`, `center`, `bbox`, `thicken`, `heal`, `to_nurbs`, `show`,
`+`, transforms, `info`, export), module `thicken`, which operations return a Shell.

Questions:
- Which members does a Shell have, which Part members are missing (volume, is_valid)?
- `center()`: area centroid? `area` exact?
- `thicken`: sign, `both`, size limits, multi-face shells, open boxes, zero.
- `heal`: what it changes on a shell.
- `+` of shells; `-`/`&`?
- Which operations return a Shell? Is a Sketch a Shell?
- `show`, STEP/STL export of a Shell.

## Log

### 01-members.py
`Shell(1 faces, area=1381.08)`; `info()` dict. Shell has no `volume`, `is_valid`, `solids`,
`fillet`, `shell`, `mass_properties`. `shell - shell`, `shell & shell`: TypeError (unsupported
operand). `isinstance(Rectangle(1, 1), Shell)` is True (Sketch subclasses Shell).
Shells come from: `extrude`/`revolve`/`loft`/`sweep` of open curves, `Face.to_shell()`,
`stitch` that does not close. `extrude` of a closed wire, `split` → Part; `section` → Sketch.
**📌 doc:** test `isinstance(x, Part)`, not `isinstance(x, Shell)` (a Sketch is a Shell).

### 02-area-center-plus.py
z = 0.02xy over 40 x 30: area 1381.0753 vs integral 1381.0754; area centroid x 20.7954 / z 6.3688
equal to the integral. `a + b` overlapping coplanar sheets: 1 face, area 1800 (merged);
disjoint: 2 faces; crossing a vertical sheet: 3 faces, area 1600 (split along the crossing).
Transforms, `named`, `colored`, `to_nurbs`, `heal` keep the Shell type and area.
`mirror` flips the normal: (-0.27,-0.36,0.89) → (-0.27,0.36,-0.89) at the mirrored point
(a pure reflection would give (0.27,-0.36,0.89)).
**📌 doc:** after `mirror`, `thicken` goes to the other side.

### 03-thicken-limits.py
- `thicken(0)`: `KernelError: thicken failed (SM_ERR_INVALID_INPUT)`. 1e-4 and 100 on a 20x10
  strip: exact (0.020, 20000).
- revolved half tube R 10 (normal outward): outward 1, 5, 9.9, 10, 12: exact to 1e-3;
  inward -5, -9.9 exact; -10, -11, -20 `KernelError SM_ERR`.
- open box (5 faces stitched, normals outward): `thicken(1)` 2164 = 22·22·21−8000, bbox
  -11..11/-11..10; `thicken(-1)` 1844 = 8000−18·18·19, inside. 14 faces, valid.
- two disjoint faces in one Shell: `thicken(1)` 800, valid, 12 faces (two plates).
**📌 doc:** inward thickness must stay below the smallest radius of curvature; zero is an
error; a stitched open shell thickens with mitred corners.

### 04-heal-show-export.py
Two faces 0.001 apart in one Shell (via `+`): 8 free edges; `heal()` leaves 8 free edges (heal
does not sew); `stitch` → 6 free edges (one sewn). `show(path=..., open_browser=False)` writes
the HTML. Export STEP 3955 B, STL, GLB fine; `import_step` gives a Shell back, area equal.
`mesh()` 512 triangles. `save`/`load` keep the Shell.
(`heal()` on the sewn-but-not-manifold shell from stitch made it manifold: stitch session 04.)

### 05-queries.py
`distance_to((20,15,20))` 15.0, `closest_point` (20,15,5). `intersection_curves(cylinder)`: one
curve, 31.494 long; `project(CenterArc r5, -Z)`: 31.493, z 5.25 at x=25 (= f(25,15)).
Part & Shell, Part - Shell, Part + Shell: return Parts → next script.

### 06-part-shell-boolean.py
`box & shell`: "Part" with 1 bspline face (the piece of the sheet inside the box), volume 0,
invalid. `box - shell` and `box + shell`: "Part", 11 faces, volume 3000, invalid (sheet imprinted).
→ TODO defect.

### 07-trim-by-part.py
`stitch(Cylinder(8, 30).translate(20, 15, 0) & s)` → Shell, the disc of the saddle inside the
cylinder: area 202.344, 1 edge; `thicken(1)` 202.317, valid.
**📌 doc:** trim a sheet with a solid: `stitch(solid & sheet)`.
![disc](files/07-trim-by-part-disc.png)

### 08-repro.py
Repro for TODO 11: `Part 0.0 False`.

### 09-doc-example.py
Open box from 5 stitched faces: Shell 5 2000.0, bottom normal (0,0,-1), `thicken(-1)` valid
1844.0 bbox 20x20x20; saddle disc `stitch(Cylinder & saddle)`: Shell 202.344. Used unchanged in
`Shell.md`.

### 10-misc.py
`Shell()` → `TypeError: create a Shell with the constructors (Box(), Rectangle(), ...)`.
`silhouette((1,0,0))` 3 edges, `outline()` 4 edges, `moved`, `on` keep the Shell, `wires()` 1.

Coverage: all members tried; thicken sign, size limits, zero, multi-face, `both`; heal; show;
export; Booleans; producers of Shells.
