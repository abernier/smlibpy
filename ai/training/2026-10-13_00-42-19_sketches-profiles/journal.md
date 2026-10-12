# Training: sketches · profiles and exact 2D operations

**Date:** 2026-10-13

## Goal

APIs: `Profile` (new), `Triangle`, `ArcSlot`, `Stroke`, `Hull` (new), `Sketch.chamfer`,
`Sketch.mirror`, `Sketch.perimeter`, `Vertex.convexity` (new); `Rectangle`, `Polygon`,
`RegularPolygon`, `Trapezoid`, `Ellipse` (new options), `Sketch.offset` (`corners=`),
`Sketch.fillet` (corner selection, line-arc corners), 2D Booleans (rebuilt operands).

Questions:
- Does every example of the guides run unchanged, and do the numbers match closed forms?
- Are fillet arcs tangent, mirrored outlines symmetric, offsets at the right distance?
- What do the errors say, and do they name the segment, corner or number to change?
- How fast are the 2D Booleans now, with moved operands and many tools?

Design and measurements of the kernel's 2D Boolean: `ai/plan/2d.md`.

## Log

### 01-pictures.py
Section (area 143.0171), bracket (1003.9469, bbox ±30 x 0..40), lever (1068.9482, 2 holes),
arc slot (279.6017), rib (114.1925), gasket (777.3717, 1 hole); all edges `line` and `circle`.
The bushing revolved from the section: volume 3565.9232, valid. Pictures show the outlines as
intended: rounded inner corners of the bracket, the round stem top, tangent lever sides.
![profiles](files/01-pictures-profiles.png)
![shapes](files/01-pictures-shapes.png)

### 02-profile.py
Section area 143.0171; bushing volume 3565.9232 against Pappus 3565.9225 (centroid integrated to
1e-7). Bracket 1003.9469 = closed form, 10 edges. `point`/`heading` after `line_to(20, 0).arc(10, 90)`:
(30, 10), 90. `forward(y=5)` at 30°: (8.66025, 5). `turn(270)`: -90. Turtle slot 148.2744 (closed
form 148.2743). Bottle base by `arc_to(..., through=)` + `mirror(X)`: 1258.8876, ±25 x ±15. Fillet at
the start corner 199.141593 = 200 - (4 - pi). Branches from one base: 200 and 357.0796. Wire with a
fillet as sweep path: volume 118.9218 = pi*length. Clockwise outline: area 200, normal +Z.
`turn` then `line_to`: heading follows the line. Every error message checked (see the guide).
**doc:** `Profile.md`.

### 03-shapes.py
`Rectangle(80, 50, fillet=6)` 3969.0973 = closed form; `chamfer=3` 782; `rotation=30` bbox ±22.32 x
±18.66; `fillet=10` stadium of 4 edges 714.1592; `align=MIN` 0..40 x 0..20. `RoundedRectangle` same
area. Triangles: 400, 600 (right angle at (-15, -20)), apex outside the base widens the bbox to 40,
equilateral 173.2051, `fillet=2` 6 edges 439.2527. L polygon `fillet=2` 492.5664, `chamfer=1` 494.
`RegularPolygon(10, 6, fillet=1)` 259.4851. `Trapezoid(40, 15, 60, fillet=2)` 464.1874. Ellipse turned
30°: 376.9911, bbox ±13.59 x ±10.21. Errors: both options, too large (names the side), acute polygon
corner (names the line and the 60.1496 it needs), zero height, angles 0/180, radius 0, negative
options, 3D points with options.
**doc:** `Rectangle.md`, `RoundedRectangle.md`, `Triangle.md`, `Polygon.md`, `RegularPolygon.md`,
`Trapezoid.md`, `Ellipse.md`.

### 04-slots-stroke-hull.py
Slot between centers (10, 5)-(40, 20) width 6: 229.5205 = closed form. `ArcSlot(30, 6, 90)` 311.0177 =
closed form. Flange with three arc slots: 5852.7883 against 5852.7871 (1 face, 4 holes). Stroke along
line + arc + line: 215.3982 round ends, 202.8319 flat (both closed forms). Bent strip: 159.1416 round,
160 sharp, 158 chamfer (= 156 + pi, 160, 158). Closed path: ring 125.6637. Crossing path: 1 face,
1 hole. Arc tighter than half the width: filled center, 3 edges. Rib volume 1500. Hulls: two circles
1175.7623 (closed form 1175.7624), rectangle + circle 339.2699, points 40, arc + point 207.0796, L 848,
three-hole link 1 face 3 holes. Errors for every refusal (too wide, ends meet at 342.7461, gap 1,
spline paths, a Profile passed as path, collinear points, splines in a hull, parts, points off the
plane). First run: the Hull of a spline let an internal error type escape; fixed to `ModelingError`.
**doc:** `Slot.md`, `ArcSlot.md`, `Stroke.md`, `Hull.md`.

### 05-corners.py
L: 5 convex, 1 concave. Inner corner r 4: 499.4336 = 496 + (4 - pi)*4; then 5 outer chamfers: 496.9336,
2 smooth vertices. Plate with a square hole: 4 convex, 4 concave; hole corners r 2: 2203.4336.
Rectangle + circle: two concave line-arc corners, filleted 657.6717, chamfered 657.5163. Lens (arc-arc
corners): fillet 122.0841, chamfer 118.7911. Free functions with vertex selections work. Placed on XZ:
`.top()` picks (±10, 0, 5). Errors: point that is no corner (lists the corners), overlap on one edge
(names both corners and the 30 + 30 of 40), no sharp corners, a smooth corner given, a spline corner,
radius 0, edges instead of vertices, convexity of a part's vertex.
**doc:** `fillet.md`, `chamfer.md`, `selection/convexity.md`.

### 06-offset.py
Rectangle 40 x 20: +2 round 1052.5664 (closed form), sharp 1056 with 4 edges, chamfer 1048; -2: 576.
`round=False` still works. L -2: 172.8584 / 172 / 174; L -4.5 leaves a 0.2096 sliver in its corner.
Ring +1: 329.8673 (closed form 329.8672), hole kept; +6: hole closed. Square hole +6 closes, chamfer +4
keeps a 2 x 2 hole (2268). Circles 2 apart: +0.5 two faces, +2 one face. Dumbbell -1.5: two faces.
Gasket 777.3717 = perimeter*3 + 9 pi. Ellipse: kernel offset, B-spline edge. Steiner's formula holds
for a pentagon, a rounded rectangle and a slot. Gear-like outline (72 edges): 27 ms. Errors: shrinking
away a rectangle, a ring's wall, a slot; corners='miter'; chamfer on an ellipse.
**doc:** `offset.md`.

### 07-mirror.py
`half.mirror(Y)`: lines stay lines, normal +Z; mirror then extrude equals extrude then mirror (volume
of the difference 0), also for a sketch at z = 10 mirrored in XY (normal -Z, z -15..-10). Ring mirrored:
circle edges. Default plane flips y; offset axis x = 30. A sketch on XZ mirrors about world Z. Splines
stay B-splines, same area. Edge/Wire mirrors and uniform scales keep `line`/`circle`. Sharp offset
spike of an acute corner: 4.123106 = d / sin(angle/2). Slot vertices: all smooth.
**doc:** `sketches/mirror.md`; `geometry/mirror.md` and `features/mirror.md` corrected (the normal is
no longer flipped); curve guides (`generic`, `Wire`, `Line`, `CenterArc`) corrected (mirrored lines and
arcs stay exact).

### 08-booleans.py
Two circles 10 apart: all four operations match closed forms to 1e-7. Moved circle + slot: 259.2663
(the released code gave 200.48). 60 random moved pairs, four operations each: 0 inconsistent, 1.4 ms
per operation (9.8 ms before the overlap tests used loose boxes: the tight box of a moved circle costs
up to 10 ms). Plate minus 180 holes in one call: 372 ms (closed form agrees to 7e-8); first 30 holes one
by one 107 ms. Sharing an edge: 1 face of 4 edges; touching at a corner: 2 faces. Empty results for a
full cut, apart boxes, and overlapping boxes without overlap. Perimeter of a rounded rectangle minus a
circle: 144.548668 = closed form. Errors: extruding or centering an empty sketch, sketch + edge (hint
to make_face / Profile), sketch + part, different planes.
**doc:** `sketches/generic.md`.

### 09-guide-examples.py
Every python block of the 19 sketches guides, `recipes/profiles` and the corrected guides of other
domains ran unchanged. Quoted numbers: gusset 439.2527, rib 6 thick, arrow pointing +X, pocket volume
2368, link 1 face 3 holes, tapered slot 254.0474, flange plate 46822.2999, recipe hook 399.7832 = closed
form, the profiles recipe part 21778.4095. Revolving an empty sketch raises.
**doc:** `recipes/profiles.md`; the same blocks run in `tests/test_profiles.py::test_sketch_guides_run`.

## Coverage

- Every new API ran, every parameter and option value was tried (corner styles, ends, apex, align,
  rotation, through, x=/y=), defaults measured, errors triggered and quoted from the runs.
- Spatial claims backed by bbox, vertices and centers; areas against closed forms throughout.
