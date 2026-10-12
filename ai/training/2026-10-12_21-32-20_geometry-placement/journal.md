# Training: geometry · placement

**Date:** 2026-10-12

## Goal

APIs: `BoundBox`/`bbox()`, `Align`, `translate`, `rotate`, `scale`, `mirror`, `moved`, `on`.

Questions:
- Is bbox tight for every shape type? What do ShapeLists and empty lists do?
- How does align work per axis, with None, strings, on sketches?
- translate: which argument forms? Sketch planes?
- rotate: direction of positive angles, axis through a point, argument order mistakes.
- scale: about which point; non-uniform; zero/negative; face types after.
- mirror: plane semantics, validity, symmetric fuse, sketches.
- moved: relative or absolute, order of composition.
- on: orientation on each face, offsets, centroid traps, errors.

## Log

### 01-bbox.py
Box bbox exact; size/center/diagonal; contains with 1e-6 tol; union; of_points; unpack.
`bb.min` can be reassigned. Tight boxes for Cylinder, Sphere, Torus, rotated cylinder
(±6.65242, ±7.00225), faces and body edges. Standalone `CenterArc((0,0),10,10,90)` bbox max y
9.99762 (true 10); standalone Spline max y 10.463 vs dense 10.533 -> too small.
ShapeList bbox = union; empty -> IndexError "empty selection"; Python list -> AttributeError.

### 02-bbox-tight.py
Same spline: standalone bbox max y 15.0836, as sketch / sketch edge 15.100447 (dense 15.100447).
-> body boxes exact, standalone curve boxes sampled (33 points). MEDIUM defect.

### 03-align.py
MIN/CENTER/MAX per axis on Box, Cylinder, Cone, Sphere, Torus, Wedge and all sketches;
strings case-insensitive; None and missing entries leave the axis; sketch third entry ignored;
'bottom' -> ValueError "'bottom' is not a valid Align". Hole has no align (TypeError).
RegularPolygon(10,3) default/CENTER: x -5..10; (CENTER, CENTER): x -7.5..7.5 -> single CENTER
and tuple CENTER differ (LOW defect).
Side finding: Wedge(10,20,30) bbox y -20..20 (width 40), volume 6000 instead of 3000.

### 04-wedge-check.py
Confirms Wedge width doubled (extrude(width, both=True)); vertices at y ±20.
![wedge](files/04-wedge-check-wedge.png)  Parts domain; recorded in todo for the maintainer.

### 05-translate.py
(x,y,z), tuple, 2D tuple, list, numpy, Vector, keywords: all work. `translate((1,2,3), 5)`
ignores 5. Sketch plane origin moves; Rectangle.translate(0,0,7).extrude(2) -> z 7..9.
Face/Edge/Wire/Vertex/Shell/ShapeList keep their type. Python list -> AttributeError.
Name and color kept.

### 06-rotate.py
rotate(Z,90): x 0..10 bar -> y 0..10. rotate(Z,-90) == rotate(-Z,90). rotate(X,90) post ->
-Y; rotate(Y,90) post -> +X. About Axis((10,0,0),Z): x 9..11, y -10..0.
`rotate(45)`, `rotate(90, Z)` -> AttributeError "'int' object has no attribute 'direction'".
`rotate(angle=45)` uses Z. Sketch rotate turns its plane. 36 x 10° returns exactly.
![rotate](files/06-rotate-rotate.png) top view: orange +Y, green about x=10 to -Y. Matches.

### 07-scale.py
scale(2) about origin: 0..20, vol x8. center= keeps (-5..15). (2,1,1): box 20x10x10.
Cylinder (2,1,1): vol 1570.7953 (exact 1570.7963), faces all bspline, valid.
Sphere (1,1,0.5) vol exact; uniform scale keeps cylinder type (radius 15). Torus x2 ok.
scale(-1): valid, vol 1000. **scale(0): bbox NaN, vol 0, is_valid True. scale((1,1,0)): flat,
valid True** -> MEDIUM defect. Sketch on z=10 scaled -> z=20. Arc scaled -> bspline.
ShapeList has no scale.
![scale](files/07-scale-scale.png)

### 08-mirror.py
Default plane XZ mirrors y. YZ.offset(30) -> x 40..60. Mirrored part valid, normals outward.
half + mirror -> 6 faces, 1 solid, vol 4000. L + mirror = T (10 faces, valid, vol 1120).
Filleted part with hole: mirror keeps cylinder/plane faces; fuse vol = 2x.
Sketch mirror about YZ: plane normal -Z, extrude goes z -3..0. mirror(face) -> AttributeError
"'Face' object has no attribute 'z_dir'"; mirror(face.plane) works. Arc mirror -> bspline.
![L](files/08-mirror-L.png) T shape as expected.

### 09-sketch-mirror-extrude.py
`half + half.mirror(YZ)` extrudes z 0..5; `half.mirror(YZ) + half` extrudes z -5..0.
Front sketch mirrored about YZ: normal -Y -> +Y. MEDIUM defect (silent direction flip).

### 10-moved.py
moved == loc * shape; relative (twice -> 12). moved(A).moved(B) == moved(B*A) (0,20,0);
moved(A*B) -> (10,10,0). Absolute via moved(Pos(-c)).moved(target). moved(Plane) and
moved(tuple) -> AttributeError "... no attribute 'matrix'". Parts have no `.location`.

### 11-on.py
Marker Pos(0,5)*Rectangle(10,2) on each box face: centers and local axes as in the table of
on.md (front: center (0,-15,5), local y +Z). Three pockets from top/front/right with
extrude(-4): vol 23280 = expected, valid. Peg on right face: x 20..30; on bottom: z -20..-10.
Hole on front: y -15..-7, removes π·9·8. on(4 faces) -> ValueError "expected exactly one
shape, got 4 - narrow the selection or use [0]"; on([face]) -> TypeError "cannot use list as
a plane"; on(Axis) -> TypeError; on(cylinder face) -> ValueError. on twice composes (z 10).
**Circle on the L-shaped top face lands at the centroid (6.44, 6.44), 2.44 away from the face;
the cut removes 0 volume, no error.** Tilted face x_dir (0.707, 0, -0.707).
![pockets](files/11-on-pockets.png)

### 12-on-centroid-shift.py
After an off-center pocket the top face centroid moves from x=0 to x=-2.857; a circle on the
new top face lands there. A fixed plane (Plane.XY.offset(max z)) keeps (0,0,5).

### 13..20 (doc examples)
13-ex-bbox, 14-ex-align, 15-ex-translate, 16-ex-rotate, 17-ex-scale, 18-ex-mirror,
19-ex-moved, 20-ex-on: all run; output matches the comments in the docs.

### 21-claims.py
Rotated cylinder bbox max equals the analytic extent (err 0.0). fillet with an edge
translated by 0 is accepted (matched by geometry); an edge moved by 1, or edges of the part
before it was moved -> ValueError "Edge(line, ...) is not an edge of this part".

### 22-scaled-selection.py
After scale((2,1,1)) of a Cylinder: cylinders() 0, circles() 0, planar() 0, radius ->
ValueError; top face is_planar False; Circle.on(top) -> ValueError "a bspline face has no
plane". Box.scale((2,1,1)) has only bspline faces. Uniform scale keeps types.
MEDIUM defect.

## Coverage
- every API ran; every parameter and mode tried (align values, None, strings; scale number,
  tuple, center; mirror planes and offset; on with plane, face, ShapeList, Location, Sketch).
- errors recorded with messages; spatial claims backed by bbox/center numbers and 3 pictures.
- realistic use: pockets on three faces (11), symmetric T (08), boss + hole + pocket (20).
- gaps: scale of Shell/Face not tried separately (same _transformed path as parts).
