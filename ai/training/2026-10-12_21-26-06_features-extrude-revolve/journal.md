# Training: features · extrude and revolve

**Date:** 2026-10-12

## Goal

APIs: `extrude`, `Sketch.extrude`, `Face.extrude`, `revolve`, `Sketch.revolve`

Questions:
- Where does an extrusion go: sketch normal, negative amount, `both`, `direction`?
- What does `taper` do, which sign narrows, what if the taper closes the profile, holes?
- Extruding faces of a part: direction, fuse, pockets.
- Open curves: what comes out?
- Revolve: default axis, angle sign, profiles touching or crossing the axis, holes.

## Scripts

### 01-basic.py
Plain, negative, `both`, function form, sketch on `Plane.front`, `direction`.
- `Rectangle(40,30).extrude(5)`: z 0..5, vol 6000. `extrude(-5)`: z -5..0. `both=True`: z -5..5,
  vol 12000 (amount to each side; the sign of amount does not matter with both).
- `Plane.front` normal is (0,-1,0): `Rectangle(20,10).on(Plane.front).extrude(5)` goes y -5..0.
- `direction=(0,1,2)`, amount 20: vol 1404.963 = area·20·cos(angle to normal) → **📌 doc:** the
  amount is the length along `direction`, not the height.
![sheet](files/01-basic-sheet.png)

### 02-taper.py
- taper 8 on 30x30x10: vol 8183.0906 = frustum with top side 27.189 (exact). Positive narrows.
- taper -8 widens (bbox ±16.405 = 15+10·tan8) but has 14 faces instead of 6 (valid, vol exact).
- Negative amount + taper 8: z -10..0, same volume: narrows away from the sketch on either side.
- **Ring `(Circle(10)-Circle(5)).extrude(10, taper=5)`: vol 2874.7546 = the full cone; the
  hole is gone (expected 1943.914).** Defect, see 06.
- `on(Plane.front)` + taper: goes along -Y (y -10..0); follows the sketch normal.
- `direction=(1,0,1)` + taper: bbox z 0..10, x ±10 — direction silently ignored.
![sheet](files/02-taper-sheet.png)

### 03-taper-limits.py
20x20, height 10. Closing angle 45°.
- 30°: vol 2135.04, 6 faces. 45°: pyramid, vol 1333.333 = 400·10/3, 5 faces.
- 56°: top at z 6.745 = 10/tan 56: **the height is cut short silently** (no error).
- 90°: valid=False, vol 0, no error. 100° behaves like 80°. -60° widens.
- `(Rectangle(40,40)-Circle(3)).extrude(10, taper=-30)`: vol 21063.25 = full frustum, hole lost.

### 04-face-extrude.py
- `box.faces().top()[0].extrude(5)`: z 10..15 (outward normal). `extrude(-5)`: z 5..10 (into part).
- `extrude(box.faces().top(), 5)` with a one-element ShapeList works.
- `box + top.extrude(5)` fuses into 6 faces, vol 30000. Pocket `box - Rectangle(20,10).on(top).extrude(-5)`:
  vol 23000 exact. With +5 the tool sits above the part: vol unchanged (24000), no error.
- Face with a hole extrudes with the hole (vol 4564.38 exact).
- Curved face: `ValueError: a cylinder face has no plane; use normal_at() or a planar face`.

### 05-open-and-errors.py
- `extrude(Line(...), 5)` → `Shell`, area 50, default direction +Z (a line has no plane).
- Arc in XY → Shell along +Z, area π·10·5 exact. `both=True` doubles.
- Closed wire / full circle edge → `Part`.
- Errors: amount 0 → `ValueError: extrude amount must not be zero`; a Part →
  `TypeError: expected a sketch, face or closed wire, got Part`; self-crossing closed polyline →
  `KernelError: make face failed (SM_ERR): the wire must be planar and must not cross itself`.
- taper on an open curve: silently ignored.

### 06-taper-holes.py
Kernel `draft_sweep` on the inner loop (clockwise) sweeps to z -10..0, the wrong side, so the
cut misses. Workaround verified: `Circle(10).extrude(10, taper=5) - Circle(5).extrude(10, taper=-5)`
vol 1943.9139 = expected. Square ring: vol = frustum without hole (15310.296).
![ring](files/06-taper-holes-ring.png)

### 07-revolve-basic.py
- Spool (`Polygon` on `Plane.front`, `revolve()`): vol 18456.853 = Pappus 18456.857. Axis Z.
- `revolve(Z, 90)`: bbox x 0..30, y 0..30 → from +X towards +Y (right hand about the axis).
- `revolve(Z, -90)`: vol 13842.64 = 3/4 of full, bbox full. **Negative angle = 360+angle in the
  positive sense.** 400 → full revolution.
- `Rectangle(10,20).translate(15,0).revolve()`: vol 0, valid True. See 10.

### 08-revolve-axis.py
- Rectangle with one edge on the axis (align MIN) with default axis: vol -1570.8 (!), valid True.
- Centered rectangle crossing the axis: vol -1570.8, valid True. With angle 90: `KernelError:
  revolve failed (SM_ERR_AXIS_INSIDE_FACE): the axis must not cross the region`.
- Triangle touching the axis in one point: vol 2094.395 = 2 cones (exact), valid.
- Offset axis `Axis((40,0,0),(0,0,1))`: vol 50265.49 exact.
- XY circle about X: torus vol exact. Axis perpendicular to the sketch plane: vol 0, valid True,
  flat bbox — garbage, no error. Tilted axis in plane: exact torus.

### 09-revolve-open.py
- Open half-circle arc in XZ about Z → Shell, area 1256.640 (sphere 1256.637).
- Open line crossing the axis → Shell, no error.
- `revolve(face_list, Z, 90)` of a planar face works.

### 10-revolve-plane-origin.py
The default axis is the sketch's local Y through the **sketch plane origin**, and the plane
origin moves with `translate`, `Pos(...)*` and `align`:
- `Rectangle(10,20, align=(MIN,MIN))` plane origin (5,10,0); `Rectangle.translate(15,0)` (15,0,0);
  `(Circle(5)-Circle(2)).translate(20,0)` (20,0,0).
- With the explicit axis `Z` all are exact: tube 18849.557, cylinder 6283.186, ring torus
  8290.468, two regions 3015.929.
- Angles about Z on a ring profile: 90 → 2356.19 (+X→+Y quadrant); -90 and 270 → 7068.58;
  -270 → 2356.19; 360 → 9424.78 valid; -360 and 0 → valid=False.
**📌 doc:** always pass the axis explicitly.

### 11-revolve-realistic.py
- `revolve(Axis((0,0,0),(0,0,-1)), 90)`: bbox y -20..0 → the other way round, correct quarter.
- Pulley profile on `Plane.front` about Z: vol = Pappus exactly (39006.014), 8 faces; fillet on
  the r=30 circles after: valid.
![pulley](files/11-revolve-realistic-pulley.png)

## Coverage

extrude: all parameters (amount ±, both, taper ±, direction), function and method forms, faces,
open curves, errors. revolve: axis default/explicit/offset/tilted/perpendicular, angle ±, 0,
>360, touching/crossing, holes, open curves, faces. All questions answered.
