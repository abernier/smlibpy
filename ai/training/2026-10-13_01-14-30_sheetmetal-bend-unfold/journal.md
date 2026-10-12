# Training: sheetmetal · bend, flange, unfold, flat pattern

**Date:** 2026-10-13

## Goal

APIs: `bend`, `flange`, `unfold`, `flat_pattern`, `Part.bends`, `bend_allowance`,
`bend_deduction`, `developed_length`, `FlatPattern`, `Bend` (new: `smlibpy.sheetmetal`, on the
kernel's SmSpaceBend / SmSpaceUnbend).

Questions:
- Are bends exact (cylinders R and R + t), and does unfolding give the blank back?
- Do the developed lengths match `BA = angle_rad * (R + K t)`?
- Which way does a bend go, which side stays, what does the K-factor change?
- What do flanges measure, how do partial bends and holes behave, what are the limits and errors?

## Bend

### 01-bend-basic.py
- 100 x 40 x 2 plate, line on top at x = 20, 90°, R 2: valid, bbox (-50, -20, 0)..(21.7381, 20,
  31.7381), cylinders R 2.0 and 4.0, edges only lines and circles. Volume 8015.079653 (default
  accuracy), 8015.079645 at 1e-10 = formula 8015.079645 (BA 4.523893).
  **📌 doc:** exact cylinders, volume grows by A t² (0.5 - K)/(R + K t), fine integration to compare.
![bracket](files/01-bend-basic-bracket.png)

### 02-bend-direction-fixed.py
- Positive angle on the top face folds up (z max 31.7381), negative down (z min -29.7381), a line
  on the bottom face with +90 folds down (same as -90 on top). `fixed=(40, 0, 0)` keeps +X:
  bbox (18.2619, ..)..(50, .., 71.7381). **📌 doc:** direction from angle sign and face, fixed side.
![four](files/02-bend-direction-fixed-four.png)

### 03-angles-kfactor.py
- 30 / 90 / 135 / 180°: volumes 8005.026546 / 8015.079653 / 8022.619491 / 8030.159309, all flat
  patterns 100 x 40 (180 = hem, z max 8 = 2 + 2R + t).
- K 0 / 0.3 / 0.5 / 1: BA 3.141593 / 4.084070 / 4.712389 / 6.283185; unfolded with the same K
  100.000000; with 0.44: 101.382301 / 100.439823 / 99.811504 / 98.240708 (= 100 + (0.44 - K) t π/2).
  K 0.5 keeps the volume (8000.000009). **📌 doc:** unfold with the bending K.
- Radius 20, 0.3, 0.11 unfold to 8000.0; 0.1: `ModelingError ... too small; ... from 0.11`.

### 04-partial-relief.py
- Partial bend of a 20 wide strip without reliefs: `ModelingError: bend: the sheet beside the
  partial bend is not cut free ...`. With two 1 mm slots from x 19.5 to 50.5: valid, z max
  26.7381, bend length 20, unfold volume 7878.0 = slotted plate. `partial=True` with an Axis:
  `ValueError`. ![tab](files/04-partial-relief-tab.png)

### 10-errors.py
- Line 5 above the plate: "does not lie on a face"; outside the plate: "does not cross the sheet";
  1 from an edge: "does not cut the sheet in two ... (2.262)"; radius 0.1: "too small"; angle 200,
  an arc as line, a Sketch: ValueError / ValueError / TypeError; a sharp corner: unfold "30 deep
  across the fixed face"; a second bend whose zone overlaps the first: "holds more than the sheet
  (2.1 deep ...)". **📌 doc:** the error list.
- Found while writing this script: the overlapping bend and radii below 0.16 t crashed the
  process (segfault) before the fixes in `sheetmetal.cpp` (see todo/sheetmetal.md 4).

## Flange

### 05-flange.py
- 100 x 60 x 2 plate, top edge at x = 50, length 20, R 2: 90° bbox max x 54.0, z 0..20.0;
  45°: max x 65.799, z max 15.5563 (virtual sharp at 50 + 4 tan 22.5° = 51.657, + 20 cos 45°);
  120°: max x 54.0, z max 17.3205; -90°: z -18.0..2.0. **📌 doc:** the length from the virtual sharp.
- Errors: length 3 < setback 4; angle 180; four edges at once.
![flanges](files/05-flange-flanges.png)

### 06-box-flanges.py
- Four flanges: tray 108 x 68 x 20 (100 + 2(R + t)), 4 bends; flat pattern 141.048 x 101.048,
  volume 25135.29179, all bends "up", lines at 18.2619 / 122.7858 and 18.2619 / 82.7858.
- Selecting `edges().top()` after a flange picks the flange's top edge (first try made a return
  flange): **📌 doc:** select base edges by height.
![tray](files/06-box-flanges-tray.png) ![pattern](files/06-box-flanges-pattern.png)

## Unfold and flat pattern

### 07-flat-pattern.py
- Plate with a hole, bends up at x = -15 and down at x = 30: pattern 100 x 40, volume
  7899.468988 = blank; lines at x 35 (up) and 80 (down); outline 1 face, loops [4, 1] after the
  contour fix (the first version had 12 collinear B-spline pieces: section curves).
  **📌 doc:** outline = lines and circles. In place: bbox (-50, -20, 0)..(50, 20, 2).
![pattern](files/07-flat-pattern-pattern.png)

### 08-unfold-extruded.py
- L profile extruded (not made by bend), legs 30 / 25, R 2: one bend found; flat 51.084070 /
  51.523893 / 51.712389 for K 0.3 / 0.44 / 0.5 = `developed_length` exactly. In place: bbox
  (-21.5239, -40, 0)..(30, 0, 2); `fixed=` the face at x = 0: the flat stands in that plane.
![angle](files/08-unfold-extruded-angle.png)

### 09-holes.py
- Hole in the flange: faces cylinder + plane only; contour 4 lines + 1 circle.
- Hole across the bend: bspline faces, valid; unfolded kernel volume 7876.888935 (unstable: 7842
  to 28600 with the accuracy), mesh 7842.9363, exact 7842.9204. **📌 doc:** cut such holes flat.
![hole](files/09-holes-hole.png)

### 11-bends.py
- Z part (90° R 2, -45° R 3): `Bend(angle=90, radius=2, ..., allowance=4.52389)` axis origin
  (-27.7381, -20, 4); `Bend(angle=45, radius=3, ..., allowance=3.04734)`; K 0.5: [4.712389,
  3.141593]; a box and a cylinder: [].

## Recipes (12-15, 24-28) and doc examples (16-23)

- 12 / 24: bracket from `developed_length(60, 40)` = 96.523893, line at 58.261947: outside 60.0 x
  40.0, holes at x 15 / 45 and z 12 / 28. ![bracket](files/12-recipe-bracket-bracket.png)
- 13 / 25 / 26: tray 108 x 68 x 20; cross blank with corner reliefs 3 (> BA/2 2.2619) and four
  partial bends: 63.4761 x 43.4761 x 21.7381. ![boxes](files/13-recipe-box-boxes.png)
- 14 / 27: laser part, flanges up and down, t 1.5: pattern 170.786 x 50, contour 4 lines + circle,
  down at 23.6965, up at 147.0894, BA 3.3929. ![part](files/14-recipe-laser-part.png)
- 15 / 28: BA / BD / blank for R 1, 2, 4, 8 and K 0.33 .. 0.5 (table in bend_allowance.md); K from
  a test strip 76.5 with legs 50 / 30: 0.4324, check 76.5.
- 16-23: every example in the guides, output as quoted in the guides.

## Coverage
- [x] every API ran; every parameter tried (angle sign, fixed, partial, k_factor, radius, fixed face)
- [x] defaults measured (K 0.44, fixed side = farther reach, base face = largest, up/down)
- [x] errors tried and quoted
- [x] realistic use: bracket, tray, cross box, laser blank
- [x] spatial claims backed by bbox numbers and pictures
