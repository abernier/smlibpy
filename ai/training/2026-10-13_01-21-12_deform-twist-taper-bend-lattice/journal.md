# Training: deform · twist, taper, bend, lattice

**Date:** 2026-10-13

## Goal

APIs: `twist`, `taper`, `bend`, `Lattice` (`move`, `scale`, `rotate`, `layer`, `apply`, `map`),
`Part.twist`, `Part.taper`, `Part.bend`, `Part.deform`

Questions:
- Which way does a twist turn, about what, over which range? What happens outside the range?
- Is the result exact? Which faces stay exact, how close are the others, how many poles?
- What does a bend do with its plane, radius, start and end? Where is the neutral layer?
- How do the volume rules (twist kept, bend Pappus, taper frustum) hold up, and how well does
  the kernel measure them?
- How do lattice points act? Degrees of exact results? Folding?
- Do deformed parts work downstream (Booleans, fillets, shell, offset, STEP, meshes)?

## Scripts

### 01-twist-basic.py
- `Box(20, 10, 100).twist(90)`: valid, 6 faces, 12 edges; volume 19999.999852 (default
  accuracy), 20000.0 at 1e-10. Top corners (±5, ±10): the 20 x 10 top is turned 90°
  counterclockwise about +Z. bbox ±11.1803 = half diagonal.
- All faces `bspline`: top and bottom (1, 1) 4 poles, sides (1, 5) / (5, 1) 26 poles: the
  straight rulings stay degree 1. **📌 doc:** exact where only turned.
![twist](files/01-twist-basic-twist.png)

### 02-twist-range.py
- Baluster `Box(16, 16, 200).twist(360, start=-50, end=50)`: 6 -> 14 faces, volume
  51200.000217; the 5 faces below and the 5 above the range are `plane`.
- `start=0` only: 10 faces. A range beyond the part (-100..300 on z -100..100) turns the top
  edge by 22.5° = 45 * 200 / 400. **📌 doc.**
![baluster](files/02-twist-range-baluster.png)

### 03-twist-axis.py
- About Y: 47214.6027 (exact 47214.6018). Axis through (20, 0, 0): the box swings around it
  (bbox x -5.5..25). Tilted axis: valid, 6000.0015.
- Hexagon prism 90 / 360 / 720°: 164 / 452 / 836 poles, 2 / 6 / 11 ms.
- Tolerance 1e-3 / 1e-6 / 1e-8: deviation 2.1e-4 / 3.8e-8 / 5.8e-10, 164 / 452 / 836 poles.
  **📌 doc.**

### 04-twist-realistic.py
- Star vase twisted 90° and shelled (2.5, open top): valid, 27 faces. Blade with fillets
  twisted 40° from z 10 on, fused to a root block: valid, 23 faces, volume as expected.
![vase](files/04-twist-realistic-vase.png) ![blade](files/04-twist-realistic-blade.png)

### 05-taper-basic.py
- `Cylinder(10, 50).taper(0.5)`: 3 faces, volume 9162.978574 = frustum 9162.978573; side
  face rational (2, 1); top edge radius 5.0 at z 25. **📌 doc:** exact.
- Box frustum x2: 46666.666667 exact; `start=0`: 10 faces, 15833.333333 exact; `end=0`:
  lower half tapered, upper half scaled (8333.333333); along X: bbox unchanged (base end).

### 06-taper-realistic.py
- Filleted grip tapered 0.75: 5 faces kept, 40235.813 -> 31010.416; bored afterwards: valid.
  Filleted post flared 1.4 from z 10: 18 faces, bbox ±28.
![grip](files/06-taper-realistic-grip.png)

### 07-bend-basic.py
- `Box(100, 10, 10).bend(90)`: bbox x -50..18.662, z -5..63.662 (radius 63.661977, the
  start stays). **Volume 10003.5464 by `part.volume`, 10000.000243 at 1e-10**; face areas
  exact (921.4602, 1078.5398, 1000, 100). **📌 doc:** measure with accuracy 1e-10. TODO 2.
- U `Box(160, 10, 6).bend(180, radius=25)`: 14 faces, bbox x -80..-11.27, z -3..53, 9600.0.
- `bend(-90, radius=20, start=10)`: down, z to -28.584; `end=0`: up to z 70.
- Neutral layer at the bottom: 9214.602 = Pappus 9214.6018. `Plane.XY`: toward +Y.
![bend](files/07-bend-basic-bend.png)

### 08-bend-tube.py
- Tube elbow radius 30: 5 faces, 16964.6004 = pi * 36 * 150. Shelled with the planar ends
  open: 5183.6279 = pi * 11 * 150; a hollow tube bent: the same. Handle 180°: ends at
  (-100, 0) and (-100, 60).
![tubes](files/08-bend-tube-tubes.png)

### 09-bend-limits.py
- Radius 4 on a 10 mm bar, a 10 mm cube bent 300° (radius 1.9), 360°, radius + start + end,
  a section outside the part: the errors in bend.md.
- 270° with long legs: valid, 20000.007, but the legs cross. **📌 doc:** not detected. TODO 4.
![overlap](files/09-bend-limits-overlap.png)

### 10-lattice-basic.py
- Unmoved 3 x 3 x 3 lattice: volume 48000.0 unchanged. Middle top point +8: `map((0, 0,
  10))` = (0, 0, 12) (weight 1/4), corners unchanged; top face (2, 2); volume 50133.333333.
- Top layer +5 and scaled 1.3 with counts 2 / 3 / 4 / 5: degrees (1, 1) / up to (2, 1) /
  (3, 1) / (4, 1).
![lattice](files/10-lattice-basic-lattice.png)

### 11-lattice-curved.py
- Top layer scaled 1.4 and -X layer moved: cylinder (2, 1) / (4, 2) / (6, 3), sphere (4, 4) /
  (6, 6) / (8, 8), torus (4, 4) / (6, 6) / (8, 8) for counts 2 / 3 / 4, all exact, < 0.2 s.

### 12-lattice-realistic.py
- Mouse body (filleted box, 4 x 3 x 3 lattice): valid, 18 faces, 236923.8 -> 267917.4.
  Handle thickened in the middle: bbox ±15.3125.
- Render: edge lines look broken where the coarser face mesh (up to 0.18 mm at tolerance
  0.135) covers them; geometry is right.
![mouse](files/12-lattice-realistic-mouse.png) ![handle](files/12-lattice-realistic-handle.png)

### 13-lattice-limits.py
- Folding refused (`... folds the part onto itself near (5, 0, 0) ...`). counts 1, flat
  sketch without margin, two indices, layer out of range: errors as documented. `copy()` is
  independent; editing methods return the lattice.

### 14-downstream.py
- Twisted bar: hole, boss, fillets (top and twisted edges), shell: all valid. `offset(1)`:
  `ModelingError` (TODO 3). STEP round trip: 40000.000012.
- Mesh: default tolerance 68 triangles, 0.4779 off, volume 42182.43; 0.01: 0.1117, 40607.51;
  0.001: 0.0274, 40151.75. **📌 doc:** meshes of twisted faces are coarse. TODO 1.

### 15-19: doc examples
- Every example of twist.md, taper.md, bend.md, Lattice.md and generic.md, unchanged; the
  printed numbers are in the docs.

### 20-claims.py, 21-taper-claims.py, 22-bend-lattice-claims.py, 24-chain.py
- Twisted bar: all `bspline`, `.planar()` finds top and bottom. Baluster: 4 bspline, 10
  planes. Hole drilled after a twist: `cylinder` wall; before: `bspline`.
- Off-axis box tapered toward Z: top at x, y 0..10. Ø10 hole across a 0.5 taper: 7.51 x 10.
- U bend: 4 bspline, 10 planes. Sphere with one point of a 3^3 lattice moved: (12, 12) 1225
  poles; of a 4^3 lattice: approximated, (5, 5) 2925 poles. Corner point moves fully.
- Chains: taper then twist and twist then taper both 32533.333 (exact frustum); a tube
  twisted about its axis then bent keeps pi * 25 * 120.

### 23-recipe.py
- Vase, blade, bent handle with aligned holes, bored tapered grip, lattice cushion: all
  valid; numbers in recipes/deform.md.
![recipe](files/23-recipe-recipe.png)

## Coverage
- [x] every API ran; every parameter tried (angle sign, axis, start/end, tolerance, scale,
  radius, plane, counts, margin, move/scale/rotate/layer/map/copy/reset)
- [x] defaults measured (axis Z, full range, Plane.XZ, counts 3, tolerance 1e-6)
- [x] errors tried and quoted
- [x] realistic uses with shell, fillet, Booleans, STEP
- [x] spatial claims backed by bbox, vertices and volumes
