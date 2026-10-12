# Training: sketches · shapes (2D constructors)

**Date:** 2026-10-12

## Goal

APIs: `Rectangle`, `RoundedRectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`, `Slot`,
`Trapezoid`.

Questions:
- Where does each one sit, what does `align` do (scalar, per axis, strings, None)?
- Which rotation parameters exist? Which way is the first corner of a regular polygon?
- Limits: zero, negative, too large radius, length < width, crossing sides.
- Polygon: list or varargs, repeated first point, winding, self-intersection, 3D points.
- Slot variants (center to center, arc slot).

## Log

### 01-rectangle.py
`Rectangle(40, 20)`: bbox -20..20 x -10..10, 4 line edges, corners at (±20, ±10). Align: MIN → 0..40 x 0..20,
MAX → -40..0 x -20..0, `(MIN, CENTER)` → x 0..40, y centered; `None` per axis = leave centered; strings
`"min"`, `("max", "min")` work; a third value is ignored. Zero or negative sides:
`ValueError: rectangle sides must be positive`. No `rotation` parameter (`TypeError: unexpected keyword
argument 'rotation'`); `rotate(Z, 30)` and `Rot(z=30) *` give bbox ±22.3205 x ±18.6603, area 800.
Tiny (1e-4) and long (1e5 x 1) rectangles work.
**📌 doc:** no rotation param; align table.

### 02-roundedrect.py
`RoundedRectangle(40, 20, 4)`: 8 edges (line, circle alternating), arc radii 4, area 786.265483 =
w h - (4 - pi) r² (786.265482). r = 0 or r = -2: a plain rectangle (4 lines), no error. r = 9.999 works.
r = 10 (= half the short side): 6 edges, 4 quarter arcs + 2 lines (stadium), area 714.159267; same as
`Slot(40, 20)` (714.159242). `RoundedRectangle(20, 20, 10)`: a circle made of 4 arcs, area 314.159.
r = 10.0000001, 10.001, 12: `ValueError: corner radius is larger than half the shorter side`. Zero width
with r = 4 gives the same radius message; negative width with r = 0: `rectangle sides must be positive`.
Extrude(5): 10 faces, valid.
![rr](files/02-roundedrect-rr.png)
**📌 doc:** limit r <= min(w, h)/2 inclusive; r <= 0 is silently a rectangle.

### 03-circle-ellipse.py
`Circle(10)`: 1 edge `circle`, radius 10, center origin, its one vertex at (10, 0, 0). Align MIN → 0..20.
r ≤ 0: `ValueError: radius must be positive`. Extrude(5): 3 faces, volume 1570.7964 (pi r² h = 1570.7963).
`Ellipse(15, 8)`: x_radius along X, bbox ±15 x ±8, 1 edge `ellipse`, vertex at (15, 0), area 376.991197
(pi a b = 376.991118). `Ellipse(8, 15)` is upright. `Ellipse(10, 10)` is still an `ellipse` edge.
No rotation parameter; `rotate(Z, 30)` bbox ±13.5923 x ±10.2103 (exact for the rotated ellipse).
Zero or negative radii: `KernelError: Ellipse failed (SM_ERR_INVALID_INPUT)` (not ValueError).
Extrude: 3 faces, valid.
**📌 doc:** Ellipse errors are KernelError.

### 04-polygon.py
Varargs, one list, tuple of tuples, Vectors: all the same (area 600, bbox 0..30 x 0..25 — points stay).
Repeating the first point: same 5 edges. Clockwise: face normal -Z but `plane.z_dir` +Z.
`align=Align.CENTER` moves the bbox center to the origin (-15..15); `align=MIN` on shifted points → 0..10.
2 points: `ValueError: a polygon needs at least three points`. 3 collinear points, bowtie, non-planar 3D
points: `KernelError: sketch failed (SM_ERR)` with no hint. A collinear midpoint is kept as a vertex
(5 edges). Duplicate consecutive points are dropped (3 edges). A polygon touching itself at a vertex gives
2 faces. 3D points in a tilted plane: a tilted face (normal (0,-0.707,0.707)) but `plane.z_dir` stays +Z.
3D points at z = 5: face at z = 5, `plane.origin` (0, 0, 0).

### 05-polygon-orientation.py
CW and CCW polygons extrude identically (bbox z 0..5, volume 1500, valid), Booleans and cuts on a face
identical. So the winding does not matter. Tilted 3D polygon: `extrude(5)` goes along +Z (the stale plane),
an oblique prism (bbox z 0..15, volume 500). z = 5 polygon + `Rectangle(4, 4)` (z = 0): accepted,
2 faces at different heights; z = 5 polygon + rectangle at z = 5: `ValueError: cannot fuse sketches in
different planes`. Defect → todo #6.
**📌 doc:** use 2D points and place with on().

### 06-regularpolygon.py
`RegularPolygon(10, 6)`: corners at distance 10, first corner at (10, 0) on +X, flats at top and bottom
(y ±8.6603). `inscribed=True`: flats at ±10 (20 across flats), corners at 11.547. `rotation=30`: corners at
(0, ±10), flats left/right. `RegularPolygon(10, 4)` is a diamond (corners on the axes, area 200);
`rotation=45` makes it an axis-aligned square of side 14.142; `inscribed=True, rotation=45` gives 20 x 20.
Triangle: corners (10, 0), (-5, ±8.66), bbox x -5..10, centroid at origin. `align=Align.CENTER` and
`"center"` leave it there; `align=(Align.CENTER, Align.CENTER)` centers the bbox (x -7.5..7.5): inconsistent
→ todo #10. 100 sides works. 2 sides: `ValueError: a polygon needs at least three sides`. Radius 0:
`KernelError: sketch failed (SM_ERR)`. Radius -10: same hexagon turned 180 degrees, no error. `sides=6.0`:
`TypeError: 'float' object cannot be interpreted as an integer`. Nut sketch
`RegularPolygon(6.5, 6, inscribed=True) - Circle(3.4)`: 13.0 across flats.
![polys](files/06-regularpolygon-polys.png)

### 07-slot.py
`Slot(30, 10)`: 30 overall along X, 10 wide, arcs centered at x ±10, radius 5, area 278.539811
((L-W) W + pi W²/4 = 278.539816). `rotation=90` → upright, `rotation=30` bbox ±13.6603 x ±10. `align=MIN` →
0..30 x 0..10; with `rotation=90` → 0..10 x 0..30 (align after rotation). `rotation` is keyword only.
length == width or length < width (6, 10): a circle of diameter `width`, no error; negative length: circle.
Width 0 or negative: `ValueError: radius must be positive`. Through slot in a plate: removed 1810.1238
(formula 1810.1239), valid.

### 08-slot-variants.py
Only `Slot` exists (overall length). Center-to-center c: `Slot(c + w, w)` (arc centers at ±10 for c = 20).
Between two points: `Pos(mid) * Slot(dist + w, w, rotation=angle)`: arc centers exactly at p and q.
Arc slot: `make_face(Wire([CenterArc(o, ro, 0, 90), CenterArc((0, R), w/2, 90, 180), CenterArc(o, ri, 90, -90),
CenterArc((R, 0), w/2, 180, 180)]))`: area 311.0177 = formula, valid extrude.
![variants](files/08-slot-variants-variants.png)

### 09-trapezoid.py
`Trapezoid(40, 15, 60)`: base 40 at y = -7.5, top 22.6795 at y = +7.5, bbox centered on the base width and
the height; area 470.096 (formula 470.0962). `right_angle` separately: (60, 90) right side vertical. 90 →
rectangle. 120 → top wider (dovetail), bbox x ±28.66. (120, 60) → parallelogram. Sides meeting exactly at
the top (40, 20, 45) and crossing: `ValueError: the sides cross below the given height`. Angle 0:
`ZeroDivisionError`. Angle 180: a degenerate sketch, area 0, bbox ±1.2e17, no error. Angle -60 = 120.
Height 0: `KernelError: sketch failed (SM_ERR)`. Negative height: upside down. `align=MIN` → 0..40 x 0..15;
`(CENTER, MIN)` stands on the X axis. → todo #11.
![traps](files/09-trapezoid-traps.png)

### 10-doc-examples.py
Every example of Rectangle.md .. Trapezoid.md, unchanged. Rectangle pocket 21600 (= 24000 - 2400);
RoundedRectangle area 3945.0619 = formula; ring 201.0619; Ellipse boss 1884.956 = pi*600; Polygon rib on XZ
bbox y -4..0, z 0..25; nut 13.0 across flats; triangle bbox shift 2.5 = r/4; Slot cut 1810.1238; dovetail top
57.3205, trapezoid top 22.6795; rail bbox y -100..0, z 0..15 (vertical side on the right in the front view).
![rail](files/10-doc-examples-rail.png)

## Coverage

- [x] every constructor ran (01-09)
- [x] every parameter tried: sizes, align (scalar, tuple, None, strings), rotation (RegularPolygon, Slot),
      inscribed, right_angle
- [x] defaults measured (bbox, first corner, plane origin)
- [x] edge and error cases with messages (01-09)
- [x] realistic use: slot through a plate (07), nut sketch (06), variants (08)
- [x] spatial claims backed by numbers
