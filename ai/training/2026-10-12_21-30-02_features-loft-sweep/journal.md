# Training: features · loft and sweep

**Date:** 2026-10-12

## Goal

APIs: `loft`, `sweep`, `Sketch.sweep`

Questions:
- Loft: ruled vs smooth, how many sections change what, sections with different edge counts,
  holes, order, tilted sections, open curves. Is there a `closed` option? (No.)
- Sweep: where does the profile go, how is it turned, helix sweeps, multi-edge paths, closed
  paths, twist (none), errors.

## Loft

### 01-loft-basic.py
- Square 20→10 over 30: vol 7000.000 = frustum exact. Circle 10→5: 3665.192 exact.
- Vase 15/25/10: smooth vol 84808.04, bbox ±25.047 (overshoot); ruled 69115.05 = two frustums
  exact; `smooth=False` identical to smooth (degree = min(2|3, n-1) = 2 for three sections).
![vases](files/01-loft-basic-vases.png)

### 02-loft-edgecounts.py
All valid, but most visibly twisted/pinched (picture). rect→hex ruled vol 2284.7.
![counts](files/02-loft-edgecounts-counts.png)

### 03-loft-odd.py
- Ring section `Circle(10)-Circle(5)` → vol 6283.186 = full cylinder: **hole dropped silently**.
- Two regions → `ValueError: a loft section must be a single region`.
- Descending z works. Same plane → `KernelError ... SM_ERR_INVALID_INPUT: sections should be
  closed, ordered and not intersect each other`. Order 0,20,10 → valid, z max 20.368.
- 1 section / mixed open+closed → ValueErrors (messages in the doc).
- Face → closed Polyline works (vol 4166.667). Tilted top section works.

### 04-loft-startpoints.py
Start points: Rectangle (-10,10) CCW, Circle (10,0), RegularPolygon(10,6) (5,-8.66), ...
All loops CCW. rect→hex mid-section area 6.4 (estimate ~320): pinched.

### 05-loft-align-starts.py / 06-loft-seam-scan.py
- hexagon as closed Polyline starting at 120°: vol 6512.7 (frustum estimate 6547.9), area@mid 323.5.
- Circle seam scan (mid-section area vs `Circle.rotate(Z, a)`): Rectangle(30,30) best 45°
  (660.4 vs 566.1 at 0, 15.4 at 225); RegularPolygon(10,3) best 120°; square Polyline from
  (15,-15) best 225°. Rule found: best seam = start angle − 360/n, not start-to-start →
  **📌 doc:** measure, don't predict. ![aligned](files/05-loft-align-starts-aligned.png)

### 07-loft-open-bent.py
- Open lines → Shell area 111.803 exact; reversed second line → 55.902 (bow-tie).
- `ruled=True` ignored for single-edge open curves (229.56 vs ruled 223.61).
- Two sections are always straight (degree 1).

### 08/09-loft-realistic / duct shell
- 4-section vase: smooth 105125.91 vs quadratic 100054.98; shell(2, top) valid.
- Duct rect→circle: shell opening the circular top fails (`shell failed (SM_ERR): the wall
  may be thicker than the part allows`), bottom only works, closed works. Box with both
  ends open works (10560 exact). Workaround: subtract an inner loft (valid).

## Sweep

### 10-sweep-basic.py
- Straight sweeps exact (π·9·40). Path starting at (50,20,10): profile moved there.
  Profile drawn at (30,30): moved to the path start anyway.
- Spline tube vol 1314.9598 = area × length 1314.9594. Quarter arc 888.2644 exact.

### 11-sweep-orientation.py
- Rectangle(10,2): along X → y ±1, z ±5; along Y → x ±5, z ±1; along Z and -Z unchanged.
- `orient=False` along X → `KernelError: sweep failed (SM_ERR): the profile may be too large
  for the path's curvature` (misleading).
- translational along an arc: vol 565.49 = area × rise (π·9·20).

### 12-sweep-helix.py
- Spring vol 1188.0927 vs π·1·L 1188.0966. Helix length 378.182 exact.
- Circle(3) on pitch 5 (coils overlap): valid=True, vol 10692.8 = 9× spring: not checked.
- Triangle profile: visible rolling ribbon. ![helix](files/12-sweep-helix-helix.png)

### 14-sweep-helix-roll.py
Rectangle(2,1) along the helix, sections at 90° each turn (radial, axial):
(2.111,1.249) (2.185,2.039) (1.589,2.222) (1.345,2.154) (1.982,2.214) (2.232,1.868);
expected (2, 1.003). **The profile rolls ~30°/turn.** translational=True → vol 60 (nonsense).

### 15-thread-loft-workaround.py
Loft through 17 placed rectangles (x_dir radial, z_dir tangent): sections (2.0, 1.004) each
turn, vol 252.122 = 2·1·L. ![loftthread](files/15-thread-loft-workaround-loftthread.png)

### 13-sweep-multiedge.py
- Polyline mitered 1920.000 exact; `sharp_corners=False` 1884 (notch, picture).
- U-shape exact; elbow line+arc exact; FilletPolyline exact; closed square loop 2010.62 exact.
- 3D polyline: pieces, 3320.9 vs 3392.9, notched corners (picture); `sharp_corners=True` →
  `ValueError: sharp-cornered sweeps need a planar path`.
- **360° CenterArc path: vol -1579.13, 2 solids, valid=True.**
![multi](files/13-sweep-multiedge-multi.png) ![nonplanar](files/13-sweep-multiedge-nonplanar.png)

### 16-sweep-edge-cases.py
- Profile r ≥ bend radius: valid=True, no error (r10 on R10: 137 faces).
- Two half arcs: 1579.1369 exact, 1 solid; revolve 1579.137.
- Tube (with hole) mitered: exact. Open arc profile → Shell area exact (bbox center on path).
- Open profile on polyline → ValueError. Disconnected Wire → valid=False, no error.

### 17/18-doc-*.py
Doc examples, all printed values as commented.

## Coverage
loft: ruled, smooth (3 and 4 sections), counts, holes, order, tilt, open curves, errors.
sweep: orient, translational, sharp_corners (both), helix (normal/conical/left/fine),
closed paths, open profile, errors, placement. Gaps: Sketch.sweep orientation options are not
exposed (none to test); twist does not exist.
