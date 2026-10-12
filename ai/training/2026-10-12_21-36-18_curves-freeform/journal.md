# Training: curves · splines, Bézier, helix, fillet polyline

**Date:** 2026-10-12

## Goal

APIs: `Spline`, `Bezier`, `Helix`, `FilletPolyline`.

Questions:
- Spline: exactly through the points? default end tangents? tangent magnitude? closed: smooth?
  periodic?
- Bezier: degree limit, weights, exact circles?
- Helix: start point, handedness, direction, cone, accuracy, limits; as sweep path: how is the
  profile placed and turned?
- FilletPolyline: radius limits, 3D, closed.

## Log

### 01-spline-basic.py
Cubic B-spline (`geom_type` "bspline") exactly through all points (distance 0.0). Default
end tangents from a parabola through the first / last three points: for (0,0),(10,5),(20,-5),
(30,0) t0 = t1 = (0.674, 0.739). Two points without tangents return a `Line`. One list of 4
points works, of 3 points: TypeError (same `_pts` defect as Polyline). Duplicate points:
`ValueError: spline points must be distinct`; two equal points: `a line needs two distinct
points`.

### 02-spline-bbox.py
**Defect.** `Edge.bbox()` of a constructed (standalone) curve samples 33 points: for
`Spline((0,0),(1,1),(2,0),(30,0))` bbox max y is 0.7998 although the curve passes through
(1,1) and reaches y 1.0069. Arcs happen to be right here.

### 03-spline-tangents.py
`tangents=(t0, t1)`: directions are matched exactly, magnitudes ignored ((10,0) same as
(1,0)). Either may be None (that end keeps the default). Two points with tangents give a
bspline (mid (5,2.5) for (0,1),(0,-1)). (0,0): `cannot normalize a zero-length vector`;
`tangents=((1,0),)`: IndexError; `tangents=(1,0)`: TypeError. Spline continuing a line with
`tangents=(line.tangent_at(1), ...)`: joint angle 0.0.
![tangents](files/03-spline-tangents-tangents.png)

### 04-spline-closed.py
`closed=True`: closed edge back to the first point, tangent continuous at the join (angle
0.0), the first point need not be repeated (repeating it gives the same curve). It is not a
periodic spline: the curvature differs slightly at the join (second difference 1.16e-5 vs
8.1e-6 elsewhere). There is no `periodic` parameter. Without `closed`, repeating the first
point closes the curve with a kink (53°). `closed=True` with two different tangents gives a
kink, no error. Two points closed: `cannot normalize a zero-length vector`. Three points
closed works. A closed spline outline extruded: valid.
A closed spline as sweep path: valid True, volume 0 (see arcs session, script 11).

### 05-bezier.py
Control points are not interpolated: `Bezier((0,0),(10,20),(20,0))` peaks at (10,10), end
tangents point at the neighbour control points. Weights make it rational: `[1, √2/2, 1]`
with (10,0),(10,10),(0,10) is an exact quarter circle (radius deviation 1.8e-15), but
`geom_type` stays "bspline". Weights 5 / 0.2 pull to / push from the control point. Wrong
weight count: `KernelError: Bezier failed (SM_ERR_INVALID_INPUT)`; weight 0 or negative:
`KernelError ... (SM_ERR)`. Coincident points give a zero-length edge without error.

### 06-bezier-degree.py
Up to 18 control points (degree 17) work; 19 and more: `KernelError: Bezier failed (SM_ERR)`.

### 07-spline-use.py
101 points: fine (deviation 3e-14). Sweep along a 3D spline: valid, volume = π·4·L
(756.4372 vs 756.4376). Outline with a spline top tangent to vertical sides
(`tangents=((0,1),(0,-1))`): tangent joints, extrude valid.

### 08-helix.py
Default `Helix(5, 20, 10)`: starts at (10,0,0) (center + radius along the plane X axis),
ends at (10,0,20), right-handed (after 1/4 turn at (0,10,1.25): counterclockwise seen from
+Z while rising). `left_handed=True`: (0,-10,1.25). Length 252.1214 (exact 252.1219).
Fractional turns fine (2.5 turns end at (-10,0,10)). `center` shifts it. `direction` tilts
the axis; the start point is `center + radius * Plane(z_dir=direction).x_dir`: X -> (0,10,0),
(1,1,0) -> (-7.07,7.07,0), -Z -> (10,0,0) going down (still right-handed about its own axis).
`end_radius` makes a conical helix (end (5,0,20)). `end_radius=0` or negative:
`KernelError: Helix failed (SM_ERR_INVALID_INPUT)`. pitch/height/radius <= 0:
`ValueError: pitch, height and radius must be positive`. pitch > height: part of a turn.
`geom_type` "bspline".
![helix](files/08-helix-helix.png)

### 09-helix-accuracy.py
It is a B-spline approximation: max radial deviation 3.9e-5 (r 10), 1.2e-5 (r 3); along the
circle 4e-6. Length 2e-6 relative short.

### 10/11/13-helix-limits
**Defect.** Long helices fail: `KernelError: Helix failed (SM_ERR_NOT_WITHIN_TOLERANCE)`, or
`SM_ERR_INVALID_INPUT` around 200 turns. Max whole turns: r 50: 26; r 20: 32; r 5: 46;
r 2: 58; r 0.5: 79 (pitch does not matter). Workaround: chain helices of whole turns,
`Wire([Helix(1,30,5), Helix(1,30,5, center=(0,0,30))])`, tangent at the joint (0.0°).

### 12-helix-sweep.py
Spring `sweep(Circle(1.2), Helix(6, 48, 10))`: valid, volume 2284.2924 (π·1.44·L 2284.2966),
0.2 s. Rectangle coil, conical spring, two chained helices (one solid, volume matches): all
valid.
![springs](files/12-helix-sweep-springs.png)

### 14/15-helix-profile-orientation, start cap
The profile's sketch X axis ends up radial (pointing out at the start (r,0,0)), sketch Y
along the helix axis (+Z), and the profile's bbox center sits on the helix start:
Rectangle(2,1) start cap corners x 7..9, z ±0.5. `Part.bbox()` of the coil is loose
(9.116 instead of 9.0): measure with vertices, not bbox.

### 16-thread.py
Thread: `Polygon((0,-0.8),(0,0.8),(1.2,0))` (tip towards sketch +X) swept along a helix of
radius 5.6 (= rod radius + bbox half-width 0.6): start cap corners at x 5.0 and 6.2. Fused
with the rod: valid, one solid.
![screw](files/16-thread-screw.png)

### 17-filletpolyline.py
Same as `Polyline(...).fillet(radius)`. Tangent joints (0.0°), arcs r 3 at (17,3),(23,7).
Closed: 4 corners, area exact. Limits: middle segment 10 with two 90° corners: r 5.0 works
(segment vanishes), 5.01 raises `ValueError: fillet radius 5.01 is too large for the edge
...`. End segments carry one setback: r 19 on a 20 segment works, 21 raises. Acute corner
(14°) at r 1 needs a setback of 8.1. 3D polylines: arcs in the plane of each corner (normals
(0,1,0) and (0,0,1)). Collinear points: no arc. `radius` is keyword-only. A 180° reversal is
not rounded.

## Coverage

All parameters tried; errors recorded; realistic use (outline, springs, thread, pipe).
Gaps: no periodic spline exists; Bezier degree > 17 impossible.

### 18..21 doc examples
Code blocks of Spline, Bezier, Helix and FilletPolyline docs, verbatim: all ran. Extra
checks: a loop of two open splines with matching tangents sweeps into a valid ring (volume
387.8079 = π·L); a FilletPolyline bend of radius 2 with Circle(3) raises `KernelError: sweep
failed (SM_ERR): the profile may be too large for the path's corners`.
