# Training: features and analysis · defeaturing, draft analysis, parting lines

**Date:** 2026-10-13

## Goal

APIs: `ShapeList.fillets`, `Part.remove_fillets`, `Part.remove_faces`, `Part.draft_analysis`
(`DraftAnalysis`, `FaceDraft`), `Part.parting_line`.

Questions:
- Which faces does `fillets()` take, which lookalikes, how is the radius measured?
- Is the box back exactly after `remove_fillets`? With corner patches? Around a boss? After STEP?
- What does the kernel not manage, and what happens then (errors, crashes, hangs)?
- Which holes, bosses and pockets does `remove_faces` close, and how exactly?
- How exact are the draft angles; what do the four groups mean for a one- and a two-part mold?
- Where does the parting line run, exact or traced, and what about walls without draft?

## Log

### 01-fillets-selector.py
Box all edges r3: 20 fillets (12 cylinders, 8 spheres); max_radius 3 → 20, 2.9 → 0. Plain box
and hole walls: 0. Disc rounded at both ends: the 2 rings, not the side. Slot ends: 2, with
max_radius=5: 0. Boss base: 4 cylinders + 4 revolution corner patches. G2 blends: radius 1.97
(max_radius=2 still takes them); variable 2..4: 2.96 (max_radius=3 takes them). 1 ms for 26 faces.
**📌 doc:** what counts, the lookalikes, how the radius is measured.

### 02-remove-box.py
4 vertical, 4 top (mitred), all 12 (corner spheres), variable, G2: 6 planar faces, volume
24000.000000000 (error ≤ 1.1e-11), bbox exact. One of four: +38.628328 (formula 38.628331,
the default volume accuracy). 0.01 s (4 rounds), 0.27 s (full round).
![after](files/02-remove-box-after.png)

### 03-remove-boss-ring.py
Boss base r2 with corner patches: 19 → 11 faces, 15200.0. Ring fillet around a cylinder boss:
error 2.8e-8. Round top + base fillet (convex and concave): error −1.3e-8; max_radius=1.5 takes
only the base fillet (volume down 19.22). Disc rounded at both ends −8.9e-8, hole rims 5.1e-8.

### 04-remove-step.py
STEP round trips: full round box error 3.6e-12; boss (corner patches come in as B-splines)
−1.8e-12.

### 05-remove-real.py
Example bracket native: all 5 (31287.064 → 31376.338). Through STEP: ModelingError naming 3
fillets; partial: 2 of 5 go. Flange ring fillet: native and STEP.
**📌 doc:** partial=True for imported parts.

### 06-remove-errors.py
Messages for a planar face, an empty selection, faces of another part, max_radius=0. No fillets
or none small enough: the part itself is returned.

### 07-remove-faces.py
Through hole, blind hole (wall only), boss (side only), pocket, counterbore, countersink, two
holes, hole with rounded rim: 6 faces, 24000.000000000, 0.02 to 0.05 s. Errors for an empty
selection, every face, faces of another part.

### 08-draft-analysis.py, 09-draft-curved.py
Box: 1 positive, 4 vertical, 1 undercut (the bottom). Taper 3: walls 3.000000000 exactly;
min_angle=5 → 8 insufficient. Cone 14.036243468 = atan(5/20). Sphere and lying cylinder
−90..90 (undercut). Dome: 0..90 insufficient. Box tilted 2° about X: ±2 on two walls.
1 to 4 ms per part.

### 10-parting-line.py
Sphere: 2 circle edges r 10, z 0. Cylinder along Z: the bottom circle. Lying: 2 straight
contour lines y ±5, z 0, + lower half circles, 71.4159. Torus: circles 157.0796 and 94.2478.
Torus tilted 30° (73.4 across): traced, up to 7e-5 off the surface, |n·z| ≤ 6.5e-6. Box, cup
and upside-down cup: the bottom outer edge, 140 long, z −10. Tapered core: bottom rim z 0.

### 11-mold-check.py, 20-recipe-mold.py
Cover drafted 2° outside, 1.5° inside: one parting line at the bottom rim (249.699); 9 faces
release upwards, 10 downwards, none in neither. With a rib: its 2 sides (0°) need draft.
Inside tapered the wrong way: 3 parting lines (z 0, 23, 0) — the analysis does not see that the
top hides the inside.

### 12-simplify.py, 19-recipe-simplify.py
STEP bracket: 2 of 4 small fillets go; holes after that crash the kernel in the forked copy
(4 of 4 features), straight from the import they go (19 → 13). Native bracket: fillets, then
holes → 8 faces, 32640.0 (the plain L); holes first leaves the inner fillet (9 faces).
**📌 doc:** order matters; try the other one.

### 13 to 17: guide examples (run unchanged)

### 18-hard-parts.py
B-spline boss and box (`to_nurbs`), an invalid input, the example enclosure with the guard.
