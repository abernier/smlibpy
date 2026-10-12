# Training: surfaces · ruled

**Date:** 2026-10-12

## Goal

APIs: `ruled(a, b)` (Edge or single-edge Wire)

Expected: straight lines join matching points of the two curves; returns a `Shell`.

Questions:
- Which points are matched: by parameter or by arc length? What if one curve is reversed?
- Which way does the normal point?
- Lines, arcs, circles (closed), splines, helix; curves of different type and length.
- Twisted results (bow tie when one curve is reversed).
- Wires with several edges; a Polyline; a degenerate curve (point); identical curves.
- Planar result: geom_type? Use with thicken and stitch.

## Log

### 01-lines.py
`a = Line((0,0,0),(20,0,0))`:
- parallel `b` at y=10: area 200, 1 bspline face, 4 edges, normal (0,0,1).
- skew `Line((0,20,10),(20,20,-10))`: hyperbolic paraboloid, area 473.395, bbox z -10..10.
- reversed `Line((20,10,0),(0,10,0))`: bow tie, area 100 (two triangles), (10,5,0) on the
  surface; normal (0,0,-1) at the center, (0,0,1) at (2,1,0): it flips across the crossing.
![lines](files/01-lines-lines.png) ![skew](files/01-lines-skew-front.png)
**📌 doc:** both curves must run the same way; a reversed one gives a bow tie.

### 02-matching.py / 03-rulings.py
Rulings evaluated on the kernel surface: Line→Spline through (0),(2,3),(4,0),(20) joins line
x=5 to spline point (2.04,10,2.98), x=10 to (4.18,…), x=15 to (10.08,…): points are joined by
**normalized curve parameter**, not by arc length. The arc-length-midpoint segment is 0.71 off
the surface at t=0.25. For lines and true circles (CenterArc) the parameter follows the length:
arc (2.93,7.07,0) → line (5,0,10), (10,10,0) → (10,0,10). Lines of length 20 and 40: area 300
(trapezoid 300).
**📌 doc:** splines are parameterized by the chord length of their through points, so the
rulings slide where the points are uneven.

### 04-closed-and-more.py
- circle r10 → circle r5 20 above: area 971.4840 vs frustum 971.4839; 2 edges + 1 seam;
  normal at (10,0,0) (0.97,0,0.24) outward.
- circle → same circle moved up: 1256.6372 vs 1256.6371; normal outward.
- second circle started at 90°: twisted, area 1076.7. Second circle clockwise: area 1205.4 (pinched).
- `Circle(10).edges()[0]` works as a curve.
- helix (pitch 10, height 20, r 10) → axis line: helicoid, area 676.606 (exact 676.6).
  ![helicoid](files/04-closed-and-more-helicoid.png)
- 2-segment Polyline: `ValueError: expected a single curve; join the wire's edges into one spline first`.
  1-segment Polyline / Wire of one edge: fine.
- identical curves: `KernelError: surface failed (SM_ERR)` (named "surface", not "ruled").
- crossing coplanar lines: bow tie, area 50.
- an edge of a part works; a Face gives the "expected a single curve" ValueError; a tuple of
  points `AttributeError: 'tuple' object has no attribute 'edges'`.

### 05-normal-thicken.py
normal = tangent of `a` × (direction from `a` to `b`): `ruled(a,b)` (0,0,1), `ruled(b,a)` (0,0,-1),
both reversed (0,0,-1). Flat strip thicken(±2): z 0..2 / -2..0, volume 400, valid.
Twisted strip thicken(1) 473.18 (area·t 473.40), thicken(4) 1879.9, valid.
Arc→line "hood" thicken(1): 284.3, valid.
![hood](files/05-normal-thicken-hood.png)

### 06-is-planar.py
A flat ruled face and a flat grid face (z = 0 exactly): `is_planar` False, kernel
`is_planar(1e-7)` False, `is_planar(1e-3)` True; `faces().planar()` empty; `to_sketch()` raises
`ValueError: a bspline face has no plane`. → TODO LOW.

### 07-doc-example.py
Blade between two skew lines thicken(1.5): valid, 1294.39. Funnel between circles r20 and r5:
area 2634.306 (formula 2634.306); thicken(-2) puts the wall inside (bbox max x 20.0), valid,
4891.6. Closed ruled bands thicken fine, unlike closed `surface` grids. Used unchanged in `ruled.md`.
![doc](files/07-doc-example-doc.png)

Coverage: ran; both parameters and their order; closed curves, helix, splines, polylines; errors;
realistic use with thicken. Stitching ruled faces is tested in the stitch session.
