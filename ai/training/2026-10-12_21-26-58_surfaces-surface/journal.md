# Training: surfaces · surface

**Date:** 2026-10-12

## Goal

APIs: `surface(points, *, interpolate=True)`

Expected from the docstring: rows of points, all rows the same length, at least 2 x 2;
`interpolate=True` passes through the points, `False` uses them as control points. Returns a
`Shell` with one face.

Questions:
- Smallest grid? Degree of the result?
- Does the surface pass through every point (interpolate) and through the corners (control)?
- How far is the surface from the true shape between the points (accuracy)?
- Which way does the face normal point?
- Closed grids (first row == last row): a tube? Poles (a row of identical points): a dome?
- Bad input: ragged rows, 2D points, numpy arrays, NaN, duplicate rows.
- Big grids: time.
- Realistic use: thicken, stitch to other faces.

## Log

### 01-pass-through.py
Docs grid (5 rows x 7 columns). Both modes: bicubic (degree 3x3), 35 poles, uv domain 0..1.
`interpolate=True`: max distance of the 35 grid points to the surface 3.1e-11, area 2502.074.
`interpolate=False`: corners on the surface (0.0), the point in the middle of the first row
0.313 away, max 0.997; area 2464.5, bbox z -4.79..4.71 (smaller than the points' -5.04..5.0).
Vertices are the four corner points in both modes.
**📌 doc:** always bicubic; interpolate passes through every point to 1e-10; control mode
touches only the four corners.

### 02-accuracy.py
f(x, y) = 8 sin(x/15) cos(y/15) on 60 x 40, n x n grids, max distance at 425 test points:
4x4 0.93 / 4.15 (interp / control), 6x6 0.061 / 1.26, 10x10 0.0022 / 0.39, 20x20 0.0002 / 0.088.
**📌 doc:** the error between points falls fast with density (about h⁴); control mode stays
far off (it is a smoothing, not a fit).

### 03-closed.py
Rows that are closed rings (first point == last point) give a closed tube: 1 face, 2 edges,
1 seam, 2 vertices. Area 1885.09 vs 2πRH 1884.96, distance to the true cylinder 0.0196 (12
segments). Torus grid closed in both directions: 0 edges, 2 seams, area 3953.7 vs 3947.8.
Normal at (10,0,15) is (-1,0,0): inward (rows go up, rings counter-clockwise).
![tube](files/03-closed-tube.png) ![torus](files/03-closed-torus.png)

### 04-seam-kink.py
The closed direction is not periodic: the normals on both sides of the seam differ by 6.6°
(8 segments), 2.5° (12), 0.34° (24), 0.034° (48). Control mode (12 segments): 30°.
**📌 doc:** a closed grid has a crease at the seam; use many points or revolve/loft for exact
closed shapes.

### 05-pole.py
Rings shrinking to a point (dome): works, 1 face, 1 edge, 2 vertices, area 628.39 vs 2πR²
628.32. A boundary row collapsed to a point (triangle-like patch) also works (4 edges).
Normal of the dome is inward ((0,0,-1) at the top, (+1,0,0) at x=-10).
![dome](files/05-pole-dome.png)

### 06-dome-thicken.py
Dome with a pole: `thicken(1)` (inward) `KernelError SM_ERR`; `thicken(-1)` returns a Part with
volume 0.000 and `is_valid() == False`, no exception. Same for 0.5/-0.5; ±3 fail.
Band without pole (0..80°): `thicken(1)` vol 259.9 valid; `thicken(-1)` vol 0 invalid.
→ TODO defect (silent zero-volume result).

### 07-thicken-check.py
Closed grid tube (24 segments): `thicken(1)` and `thicken(-1)` give volume 0.000, `is_valid()`
True, 4 faces. Revolved tube `revolve(Line(...), Z)`: 1979.204 vs 1979.203 exact (outward, its
normal points out), 1790.708 exact inward. Open half tube from a grid: 895.27 vs 895.35, 989.70
vs 989.60, valid. So open grid surfaces thicken right; closed ones do not.

### 08-closed-thicken.py
Same closed tube, thicken three times in a row: try 0 thicken(1) gives volume 0 (faces: three of
area 0.0 and the original 1884.95), tries 1 and 2 raise `KernelError SM_ERR`. thicken(-1): volume
-1.2e-12, `is_valid()` True every time. Non-deterministic and silently wrong.
**📌 doc:** never thicken a closed grid surface; check `volume > 0` after every thicken.
→ TODO defect HIGH.

### 09-bad-input.py
- ragged rows: numpy `ValueError: setting an array element with a sequence...` (no hint).
- 2D points `(x, y)`: accepted, z = 0. numpy array and `Vector`s: accepted.
- flat list of points: `TypeError: 'int' object is not iterable`.
- a NaN coordinate: accepted, Shell with area 0. → TODO LOW.
- two equal rows: accepted, area 11289 instead of ~1621 (wild overshoot), no warning.
- two equal points in a row: accepted, area 1636.7 (small bulge).
- folded rows (y 0,10,20,5,40): accepted, self-overlapping, area 4540.
- very uneven spacing (x 0,1,2,30,60): fine, passes through the points (1.5e-11).
- 100x100 grid: 0.02 s; `thicken(0.5)` of it 0.51 s.
**📌 doc:** no input checks beyond the grid shape; repeated rows overshoot.

Coverage: ran, every parameter (interpolate both ways), defaults measured (bicubic, normal
rule), edge and error cases, realistic use (thicken) done; stitch use in the stitch session.

### 10-repro.py
Minimal reproductions for TODO 1–5; all reproduce (tube.thicken(-1) volume -0.000248 valid True;
dome.thicken(-1) 0.0 False; 3x3 SM_ERR; both ignored; NaN area 0).

### 11-doc-example.py
Grid with rows along x stacked... (rows = x values, points along y): normal (0,0,1), thicken(2)
→ z 0.0..6.0, valid, volume > 0. Used unchanged in `surface.md`.
![panel](files/11-doc-example-panel.png)

### 12-one-row.py
One row → `ValueError: expected a grid of at least 2 x 2 points`. 2D points → z 0.
