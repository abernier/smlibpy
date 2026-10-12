# Training: features · shell, offset, thicken

**Date:** 2026-10-12

## Goal

APIs: `Part.shell`, `shell`, `Part.offset`, `offset`, `Shell.thicken`, `thicken`

Questions:
- Shell: thickness sign, openings forms, outward, exact volumes, what fails, fillets.
- Offset: grow and shrink, sharp or round edges, limits.
- Thicken: which side, `both`, curved and multi-face sheets, faces of parts.

## Shell

### 01-shell-basic.py
- 80x50x30, t2.5: closed 35625 exact; open top 27187.5 exact; negative t same; function form,
  single Face, two openings (top+bottom 18750, top+front 22031.25) exact.
- outward closed: vol 42707.04 (sharp would be 43625), 32 faces → outer edges rounded r = t
  (formula abc+2t(ab+bc+ca)+πt²(a+b+c)+4/3πt³ − abc = 42707.04). Outward open top: bbox z max 15.
- All six faces → ModelingError "could not build a valid result". t=0 → KernelError SM_ERR_INVALID_INPUT.
- Cylinder cup exact (9198.583).
![outward](files/01-shell-basic-outward.png)

### 02-shell-limits.py (+ 04-shell-crash-repro.py)
- Box 40x30x10 closed: t2..4.99 exact; **t5 ModelingError; t6 valid=True vol 10992 (wrong);
  t10 valid vol 10000, 10 faces (wrong)**.
- Open top: up to t9.9 exact; t10 ModelingError; t11 KernelError.
- **Segmentation fault**: the first two runs of the script died with exit 139 (once at
  "box open top t10"). Minimal repro `Box(40,30,10).shell(10, top)` crashed 7 of 20 runs.
- Vertical fillets r5/r2/r1/r3 then shell: valid. All edges r5, shell t2 closed / open
  `faces().planar().top()`: valid (11134.395). t6 > r5: KernelError.
- Shell t2 then outer vertical r5 then inner r3: valid.

### 03-shell-shapes.py
Sphere closed 9081.297 (exact 9081.297), half sphere open 4540.65 exact, torus 3553.057
exact, cone open top/bottom, plate+boss, plate with holes, L-prism, revolved part, spline
prism: all valid.

## Offset

### 05-offset.py
- Box +2: 13824 = 24³ (sharp edges, 6 faces). -2: 4096. 0: same. -9.9: 0.008 exact; -10,-11 ModelingError.
- Cylinder +1: 1357.169 = π·36·12 (sharp); -1: 402.124 exact. Sphere ±3 exact.
- L-prism ±2: 12544 / 2016 exact (polygon offsets). Plate with hole ±2: exact
  (26708.16 / 6852.37). +5 closes the hole: KernelError. Filleted r3 box -4: KernelError.
![offsets](files/05-offset-offsets.png)

### 11-claims.py
- `box.offset(2.5) - box`: 43625 exact, sharp. L with r2 concave round: +1 ok, +2 KernelError.
- `Rectangle(20,10).translate(0,0,-1).thicken(2)`: z -1..1.

## Thicken

### 06-thicken.py / 07-thicken-freeform.py
- Rectangle ±2: z 0..2 / -2..0, 400 exact. `both=True`: **ignored** (400, z 0..2).
- On Plane.front: y -2..0 (normal -Y).
- Half-cylinder sheet (arc CCW extruded +Z): normal at (0,10,10) = +Y (outward). +2 → 1382.30
  exact (outside), -2 → 1130.97 exact (inside).
- Box top face ±3: z 10..13 / 7..10. Cylinder face ±2 exact.
- L sheet (2 faces): +1 310 (corner block), -1 290.
- Half-cylinder -12 (beyond radius): valid=False vol 0, no error. t=0 KernelError.
  Part → AttributeError.
- surface 4x4: normal (0.05,-0.13,-0.99) (down). thicken 1/−1/3: 903.7/915.3/2676.3 ≈ area·t.
  A 3x3 interpolated `surface` failed (`SM_ERR_INVALID_INPUT`) — surfaces domain.

### 08/09/10-doc-*.py
Doc examples, values as commented.

## Coverage
All parameters tried (both found ignored). Limits and errors recorded, including a crash.
