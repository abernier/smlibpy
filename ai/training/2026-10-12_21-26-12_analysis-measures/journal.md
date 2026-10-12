# Training: analysis · accuracy, mass properties, measures, validity

**Date:** 2026-10-12

## Goal

APIs: `Part.volume`, `Part.area`, `Part.center`, `Part.mass_properties`, `MassProperties`,
`Face.area/center`, `Edge.length/center`, `Wire.length/center`, `Sketch.area/center`,
`Shell.area/center`, `ShapeList.center`, `bbox()`, `Part.is_valid`, `info()`.

Questions:
- How exact are volume, area and center by default? Does the error depend on placement?
- What does `accuracy=` do, what does it cost, where does it stop working?
- Is the inertia tensor about the center of mass, which sign convention, does density scale it?
- What do `center()` of an edge, wire, face and list mean?
- Which shape types have which measures?
- What does `is_valid()` detect, and what not?

## Log

### 01-primitives-formulas.py
Box, cylinder, sphere, torus, cone, frustum against formulas at the default accuracy.
Box exact (0 error). Curved: relative error of volume and area 3e-9 to 2.4e-7, centers within
1e-6 of the axis. Cone centroid z = -7.5 (h/4 above base), frustum -1.615 as formula.
**📌 doc:** default error is about 1e-7 relative, up to 2-3x that on spheres and tori; planar
bodies are exact.

### 02-accuracy-param.py
`mass_properties(accuracy=a)` for a in 1e-2 .. 1e-14 on cylinder, sphere, torus.
Error tracks a (1x to 3x): sphere 1e-4 -> 9e-5, 1e-6 -> 6e-7, 1e-8 -> 1.5e-8, 1e-10 -> 3e-10.
Time grows: sphere 3 ms (1e-4), 28 ms (1e-7), 185 ms (1e-10); torus 1e-12 takes 1 s.
Too tight fails: sphere at 1e-12 and everything at 1e-14 raise
`KernelError: mass properties failed (SM_ERR): is the part a closed solid?` (misleading hint).
`accuracy=0` silently means the default; `accuracy=-1` raises the same KernelError; `accuracy=1`
returns a volume 1.5 % off without complaint.
**📌 doc:** useful range 1e-4..1e-10; below 1e-11 it may fail with a misleading hint.

### 03-moved-rotated-far.py
Five primitives rotated about (1,2,3), moved to (1000,2000,3000), to 1e4 and to 1e6.
Relative volume/area error stays at 1e-7 everywhere; center error < 1e-5 mm (torus) even at 1e6.
Integration runs about the bounding-box center, so placement does not matter.
**📌 doc:** far from the origin is fine.

### 04-hard-bodies.py
Helix springs (1/4/10/20 turns), cylinder split at 30 degrees, box with all edges filleted.
The helix is a NURBS fit: its length is 2.07e-6 short of the formula, so the spring is
measured against `pi r^2 * helix.length`. Default error 1.5e-7..6e-6; split cylinder 8.6e-8;
rounded box 9.5e-10 against the closed formula. 40-turn `Helix(5, 200, 10)` raises
`KernelError: Helix failed (SM_ERR_NOT_WITHIN_TOLERANCE)` (curves domain).
`mesh(tolerance=0.001).volume` is 1e-5..4e-4 low (inscribed facets).
![spring](files/04-hard-bodies-spring4.png)

### 05-inertia-formulas.py
Inertia tensors with density 7.85e-3 against formulas: box exact, cylinder 1.3e-7, sphere
4e-7, torus 2.4e-7, cone 1.4e-7. Rotated box = R I R^T to 2e-16. Box at 1e5..3e5: 2.6e-13.
L-shape: tensor[0][1] = +33333 where sum (x-cx)(y-cy) dV = -33333, so the off-diagonals hold
the negated products of inertia (standard tensor). Units: density * mm^5 (g mm^2 for g/mm^3).
`density=0.0` and `density=-1.0` return mass = volume (density silently 1).
**📌 doc:** inertia about the center of mass, world-parallel axes; principal moments ascending.

### 06-mp-special.py
Principal axes of a rotated box pair with the rotated X, Y, Z (|dot| = 1) in ascending
moment order. density 0 / -1 -> mass 1000 (= volume), density 2 -> 2000, 1e-9 -> 1e-6.
Box with a spherical cavity: V rel -1.9e-8, A includes the cavity, 1 solid, 7 faces.
Two disjoint boxes: one Part, 2 solids, mass properties of both together (Iyy by Steiner exact).
Shell and Sketch have `area` and `center()` but no `volume`, `mass_properties`, `is_valid`
(AttributeError).

### 07-freeform-crosscheck.py
Spline profile: extrude V = A*h to 5.8e-8; revolve 360 vs Pappus 2 pi xbar A to 4e-7
(1.9e-7 at 1e-10, the reference itself is only 1e-7); revolve 90 deg to 1e-7.

### 08-spring-convergence.py
20-turn spring and a triangle swept along the same helix, accuracy 1e-4..1e-11.
Spring: default 3960.28846 vs converged 3960.28156: 1.7e-6. Triangle: default 1883.66225 vs
converged 1883.68857: **-1.4e-5, 140 times the nominal accuracy**; at 1e-5 the volume is 1e-3
off while the area is right to 1e-6. The area converges quickly, the volume does not: the
kernel controls its step size by the area only.
**📌 doc:** for swept and wound bodies, volume is good to ~1e-5 at the default; ask for
`accuracy=1e-9` when the volume matters beyond that.

### 09-realistic-parts.py
Plate with holes, pocket and fillets: 6e-9 vs formula. Shelled box: exact. Bent pipe (annulus
swept along a 90 degree arc): default 3.6e-6, 1e-11 matches the torus-section formula to 1e-8
but takes 27 s. Box minus tilted cylinder: 1e-8.

### 10-far-boolean.py
The Boolean body rotated converges to a value 7e-8 lower than unrotated (area 1e-7): rotating
changes B-spline geometry at that level. Translation does not.
**📌 doc:** do not compare measures of transformed bodies tighter than 1e-6 relative.

### 11-edge-wire-measures.py
Edge lengths: line exact, circle/arc 5e-12 (also tilted and far), ellipse 8e-11, spline 2.5e-9
vs a 20000-point polyline, helix 2e-6 short (the NURBS fit, not the integration).
`Edge.center()` is the point halfway along the edge: a semicircle gives (0, 10, 0), a full circle
a point on the circle; `arc_center` is the circle's center. `Wire.center()` averages edge
midpoints by length: right for straight edges, wrong centroid for arcs (6.11 instead of 3.89).
`cylinder.edges().center()` = (-6, 0, 0), a point on the rim. Cylinder has 3 edges with seams,
2 without.

### 12-face-sketch-shell.py
Face areas: cylinder 9.4e-8, sphere 1.3e-7, torus 2.4e-7, cone 1.2e-7. Half-cylinder face
center at 2r/pi from the axis (off the face) as the docstring says. Sketch ring 1.6e-8;
off-center hole centroid to 5e-8; sketch on a tilted plane keeps its area. Shell area = sum.
`faces().center()` is an unweighted average of face centers.

### 13-is-valid-info.py
Valid: box, disjoint boxes (2 solids), face-touching (merged to 6 faces), vertex-touching (15
vertices). **Not valid**: edge-touching boxes (23 edges). **Valid but wrong**: spring with
profile radius 4 on pitch 5 (self-intersecting, volume = pi 16 L counts overlaps twice);
revolve of a rectangle crossing the axis (volume -1.8e-21, looks like a cylinder).
`info()`: type, faces, edges, vertices, bbox as tuples. Shell/Sketch: no is_valid.
![selfint](files/13-is-valid-info-selfint.png)

### 14-validity-detection.py
Mirrored and negatively scaled boxes keep positive volume and outward normals. Crossing revolve:
volume ~0, mesh volume -261. Self-intersecting spring: fuse, intersect, cut keep the double
counted volume (12673) and stay valid: no Boolean repairs it.
**📌 doc:** `is_valid()` is topology only. Also check volume > 0 and against a formula.
![crossing](files/14-validity-detection-crossing.png)

### 15-bbox-accuracy.py
Part bbox is tight: rotated cylinder and torus to 1e-9 vs formulas; split cylinder exact;
extruded spline part matches sampling. A standalone spline Edge's bbox samples 33 points and is
too small (y min -2.9599 vs -3.0290).

## Coverage
- [x] every API ran; accuracy and density tried over their ranges, 0 and negative too
- [x] defaults measured (1e-7 accuracy, density 1)
- [x] errors: too tight accuracy, negative accuracy, Shell/Sketch attribute errors
- [x] realistic parts (09)
- [x] spatial claims backed by numbers

### 16..19 example scripts
The examples of generic.md, mass_properties.md, measures.md and is_valid.md, run unchanged.

### 20-parallel-axis.py
`I_p = inertia + mass*(d.d*I - outer(d, d))` with d = p - center: box about a corner edge
Ixx = m(b²+c²)/3 = 1.04e7 exact; Ixy = -m dx dy = -7.2e6 exact.
