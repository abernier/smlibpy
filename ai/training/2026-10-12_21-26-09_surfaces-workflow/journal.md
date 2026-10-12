# Training: surfaces · workflow

**Date:** 2026-10-12

## Goal

APIs: `surface`, `ruled`, `stitch`, `Shell` (`thicken`, `heal`, `area`, `center`, `faces`), `Face.to_shell`, `thicken`

Questions:
- What does each surface API return (type, faces, edges, area)?
- Does the docs example `stitch([f.to_shell() for f in box.faces()])` really give a Part with the box volume?
- Does `thicken` go along the face normal? Which side for positive and negative thickness? What does `both` do?
- How do I check a Shell (no `is_valid`, no `volume`)? How do I see whether a Shell is closed?
- What is the path from a few freeform faces to a closed valid solid?

## Log

### 01-basics.py
Every API runs. `surface(grid)` of the docs example: Shell, 1 bspline face, 4 edges, 4 vertices,
area 2502.07. `ruled`: Shell, 1 face. `stitch` of the six faces of `Box(10,10,10)`: `Part`, volume
1000.0, valid. `terrain.thicken(2)`: Part, volume 5007.5 (area*2 = 5004.1), valid.
The thickened panel's bbox z is -7.046..4.999: the material went *down* from the surface
(surface z range -5.042..4.999).
![all](files/01-basics-all.png)

### 03-surface-probe.py
`surface()` fails with `KernelError: surface failed (SM_ERR)` for 2x2, 3x3 and 4x3 grids, flat
or curved; `interpolate=False` fails with `SM_ERR_INVALID_INPUT`. 4x4 and up work. The
docstring says "at least 2 x 2".
**📌 doc:** surface needs at least 4 x 4 points. → TODO defect.

### 02-thicken-direction.py
Flat 4x4 grid `[[(x, y, 0) for x in xs] for y in ys]`: face normal (0,0,-1).
`thicken(2)` → z -2..0; `thicken(-2)` → z 0..2; volume 1800 = 900*2 both times.
`thicken(2, both=True)` → z -2..0, same as without: `both` is ignored.
Transposed grid (rows along x) or rows reversed: normal (0,0,+1), `thicken(2)` → z 0..2.
`thicken(face, 3)` (module function on a Face) → z -3..0.
**📌 doc:** normal = (row-to-row direction) × (along-a-row direction). The usual
`[[... for x in xs] for y in ys]` grid has its normal pointing down (-Z). `thicken(t)` adds
material along the normal for t > 0, against it for t < 0. `both` does nothing. → TODO defect.

(Detailed surface() experiments continue in `2026-10-12_21-26-58_surfaces-surface`.)

### 04-fender.py
Car-fender-like panel: skin `surface` 13 x 9 points over 120 x 50, crown over the wheel, rolling
down to the outside; rows along y stacked in x → normal (0,-0.005,1.0) up. bbox z 22.0..46.0.
`thicken(-2)`: valid, 12929.51 (area·2 = 13091.03, less because the skin curves). Wheel arch
`Cylinder(42, 200).rotate(X, 90)` (bbox y ±100, axis along Y) subtracted: valid, 9969.29, 8 faces,
1 solid. ![fender](files/04-fender-fender.png) ![iso](files/04-fender-fender-iso.png)

### 05-fender-finish.py
Arch: one cylinder face r 42.000 with 4 bspline edges. Fillet 0.5: valid 9908.49; 0.9: valid
9756.51; 1.5: `KernelError: fillet failed (SM_ERR): the radius may be too large ...` (wall 2 mm,
the panel meets the cylinder at a shallow angle). STEP round trip 9908.51 vs 9908.49, valid.
![filleted](files/05-fender-finish-filleted.png)

### 06-closed-then-shell.py
Closed block (skin + ruled walls + bottom) → `block.shell(-1.5, openings=bottom)`: valid, 6134.85,
bbox unchanged (wall inside). `shell(+1.5)` gives the same (sign ignored by `Part.shell`; features
domain). Open cover (skin + walls stitched, no bottom) `thicken(-1.5)`: volume 0.0, invalid, bbox
grows to x 61.5 / y -1.5: some faces went outward.

### 07-cover-normals.py
Normals of the open cover after stitch, dotted with the outward direction: top +, x=0 wall +0.99,
y=0 wall -0.95, x=60 wall -0.99, y=40 wall +0.98: exactly the input normals of the four ruled
walls. thicken(±1.5), (±0.5): SM_ERR or volume 0 invalid.
**📌 doc:** stitch unifies normals only when it closes; orient open pieces yourself. → TODO 12.

### 08-cover-oriented.py
Walls swapped (`ruled(floor, e)`) when `normal_at(p).dot(p - mid) < 0`: all normals outward
(+0.26 top near its edge, +0.97..+0.99 walls). `thicken(-1.5)`: valid 6134.85, bbox 0..60 x
0..40 x 0..13.0 = equal to `Part.shell` of the closed block (difference -0.001). `thicken(+1.5)`:
valid 7234.58, bbox -1.5..61.5, -1.5..41.5, top 14.5.
![cover](files/08-cover-oriented-cover.png)

### 09-repro-normals.py
L of two ruled strips: floor +Z with wall normal -Y (consistent) → thicken(1) 190, (-1) 210,
valid. Floor +Z with wall +Y → stitch keeps +Y; thicken(±1) volume 0.000, invalid, no error.

### 10-generic-example.py
The workflow example for `generic.md`: skin normal ~(0,0,1); closed block 23997.28; open cover
Shell with 4 free edges; `thicken(-1.5)` 6134.8 (rounded to 1 decimal: the 2nd decimal changes
between runs, see 12).

### 11-fender-doc.py
Fender as a short example: `True 9908.49 1`.

### 12-volume-jitter.py
Thickening the 5-face cover three times in one process: 6134.84857, 6134.84786, 6134.84998; the
same body measured three times is stable. Single-face `skin.thicken` is identical every time
(3667.92826103860). → TODO LOW (non-deterministic multi-face thicken, ~2e-7 relative).

Coverage: the workflow ran end to end three ways (thicken one sheet, close + shell, open stitch +
thicken), with checks after each step; a fender-like panel with Booleans, fillet and STEP round
trip. Open point for the features domain: `Part.shell(+1.5)` and `shell(-1.5)` gave the same
inward wall on the stitched block (06).
