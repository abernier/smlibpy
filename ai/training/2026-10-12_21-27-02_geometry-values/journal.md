# Training: geometry · value types

**Date:** 2026-10-12

## Goal

APIs: conventions (generic), `Vector`, `Axis`, `X`/`Y`/`Z`, `Plane`, `Location`, `Pos`, `Rot`.

Questions:
- What do repr and info() print? How do I compare results (tolerances)?
- Which inputs does Vector take? What fails?
- Is X a vector or an axis? Where is an Axis accepted and where not?
- Where does each named plane put its local X and Y? What does Plane(z_dir=...) pick as x?
- What does Plane.rotated(x, y, z) do with several angles?
- What is face.plane for each box face?
- Rot order with several angles; Pos * Rot vs Rot * Pos; rotation about which point?
- Location.inverse, Location * Vector, rotation property.

## Log

### 01-generic.py
Box repr `Part(6 faces, volume=6000)`; info() is a dict with type, faces, edges, vertices,
bbox as two tuples. `b.volume` = 5999.999999999999 (not exactly 6000) -> compare with
`math.isclose`. `bbox().size == (30, 20, 10)` is True (Vector equality has tolerance 1e-6).
translate leaves the original unchanged; `b2 = b; b2 -= Cylinder` rebinds b2 only (b keeps 6
faces). Shape `==` is identity: `b == b.translate(0,0,0)` is False.
Repr of Vector rounds to 6 significant digits (`Vector(0.333333, 0, 0)`), tiny values print as 0.
`Rot(z=45)` prints as `Location(position=..., rotation=...)`; `Location()` prints as `Pos(0, 0, 0)`.
**📌 doc:** volumes are not exact integers; repr rounds; shape == is identity; `-=` rebinds.

### 02-vector.py
Vector(), (1,2) -> z=0, tuple, list, numpy all work. 1 or 4 coordinates -> ValueError.
`a * b` -> TypeError "use .dot() or .cross()". Tuples work on both sides of + and -.
`angle_to` is unsigned (0..180). Immutable: setting `.x` -> AttributeError.
`Vector + X` -> TypeError "'Axis' object is not iterable": X is an Axis, use `X.direction`.
`sum(vectors)` without a start value fails (TypeError); `sum(vs, Vector())` works.
Equality `==` uses TOLERANCE 1e-6 (absolute distance). `Vector.rotate(axis_or_tuple, deg)`.
**📌 doc:** all of the above.

### 03-axis.py
`Axis()` is Axis.Z; direction normalised; zero direction -> ValueError. `-Z` reverses. `Pos*Z`
moves an axis, `Rot(y=90)*Z == X`. Axis equality ignores where the origin sits on the line.
`part.rotate(Axis((5,0,0),(0,0,1)), 90)` moved a box from (10,0,0) to (5,5,0): rotation about
the offset axis. Revolve about Y: volume 3015.93 = 2π·12·40.
**Defect:** `part.rotate((0,0,1), 90)` -> AttributeError "'tuple' object has no attribute
'direction'"; `part.mirror(X)` -> AttributeError "'Axis' object has no attribute 'z_dir'".
**📌 doc:** rotate needs an Axis; mirror needs a Plane; selection takes Axis or tuple.

### 04-plane-named.py
Named planes (x, y, z): XY (X,Y,Z); YZ=right (Y,Z,X); ZX (Z,X,Y); XZ=front (X,Z,-Y);
YX (Y,X,-Z); ZY (Z,Y,-X); bottom (X,-Y,-Z); back (-X,Z,Y); left (-Y,Z,-X).
Default x when only z_dir is given: vertical planes get local Y = world +Z; others the
projection of world X. Rectangle(10,20, align MIN in y).on(front/back/left/right) all reach
z 0..20 -> "upwards" stands up. On ZX the same rectangle lies along +X.
**📌 doc:** table of named planes; ZX/YX/ZY are not "up" planes.

### 05-plane-derived.py
offset moves along the normal (XZ.offset(10) -> origin y=-10). shifted moves in local
coordinates. flipped keeps x, flips y and z. rotated(x=30): z -> (0,-0.5,0.866).
rotated(x=90, z=90): z -> (1,0,0), same as rotating about the original X, then the original Z.
Box face planes: top (X,Y,+Z), bottom (X,-Y,-Z), front (X,Z,-Y), back (-X,Z,+Y),
left (-Y,Z,-X), right (Y,Z,+X); origin at the face center.
Plane(ShapeList) -> ValueError "expected 2 or 3 coordinates, got 1" (`.on()` takes a ShapeList).
Cylinder face `.plane` -> ValueError "a cylinder face has no plane".
L-shaped top face: plane origin (6.44, 6.44, 5) lies OUTSIDE the face (centroid);
interior_point() (11, 0.37, 5) is on it.
Sketch on tilted plane: local (0,10) -> world (0, 8.66, 5); extrude follows the plane normal.
Sketch centers carry ~1e-7 noise (area integration).
**📌 doc:** face plane orientations, centroid outside the face, rotated semantics.

### 06-location.py
`Rot(10,20,30) == Rot(z=30)*Rot(y=20)*Rot(x=10)`: X first, then Y, then Z, about world axes.
`Rot(90)` is a rotation about X (first positional argument is x).
Positive angles are right-handed: Rot(z=90)*(1,0,0) = (0,1,0).
`Pos(10,0,0)*Rot(z=90)*box` -> center (10,0,0); `Rot(z=90)*Pos(10,0,0)*box` -> (0,10,0).
Rot rotates about the world origin: box at (10,0,0) -> (0,10,0). About a point:
`Location.about(Axis(p, dir), deg)` or `Pos(p)*Rot(..)*Pos(-p)` both keep it at (10,0,0).
`L * L.inverse() == Location()`. `Location * Vector` includes the translation;
`rotate_vector` does not. Location * 2-tuple -> Vector (z=0). rotation property round trips,
Rot(z=200).rotation = (0,0,-160).
**📌 doc:** order, point of rotation, inverse.

### 07-hash-eq.py
`Vector(1.0000004,0,0) == Vector(1.0000006,0,0)` True but hashes differ: a set keeps both.
Same for Axis (equal axes with different origins on the line). LOW defect.

### 08..14 (doc examples)
08-ex-generic, 09-ex-vector, 10-ex-axis, 11-ex-plane, 12-ex-location, 13-ex-pos, 14-ex-rot:
the examples of the docs, run unchanged. All passed (asserts in 08 hold). Outputs match the
comments in the docs: e.g. rib on Plane.front bbox x -5..5, z 0..20; block + boss max z 11.0;
Rot(y=90) * Cylinder(3, 20) size (20, 6, 6).

### 15-center-noise.py
Cylinder(30,100).center() = (1.3e-6, -1.6e-6, 1.4e-6): `== (0,0,0)` False. Cylinder(300,1000)
off by 1.8e-5. Volume relative error ~8e-8. Box centers exact. Cylinder bbox exact (-3..3).
**📌 doc:** compare centers with a tolerance scaled to the size.

### 16-axis-accepted.py
facing((0,0,1)) works; sort_by((0,0,1)) and group_by((0,0,1)) -> TypeError "cannot sort by
(0, 0, 1)"; revolve((0,1,0)) -> AttributeError 'tuple' has no attribute 'origin';
Location.about(tuple) -> AttributeError. revolve about an offset axis Axis((10,0,0),(0,1,0)):
502.65 = 2π·2·40 as expected.

### 17-extrude-on-planes.py
Rectangle(10,10).on(plane).extrude(5) grows along the plane normal: XZ/front -> y -5..0,
back -> y 0..5, left -> x -5..0, right -> x 0..5, bottom -> z -5..0.

### 18-pos-claims.py
`Rot(x=90)*Pos(0,0,10)` -> (0,-10,0); `Pos(0,0,10)*Rot(x=90)` -> (0,0,10).
`(Pos(10,5)*Circle(3)).on(face)` lands at `face.plane.from_local((10,5))` on top, front and
right faces. `GridLocations(20,10,2,1)*Pos(8)*Box` -> centers x -2 and 18. Pos works on
Vertex, Edge, Wire, Face and keeps the type.

## Coverage
- Vector, Axis, Plane, Location, Pos, Rot: every constructor form and member tried; errors
  recorded; defaults measured (Plane default x_dir, named planes, face planes).
- Realistic use: boss on a face plane (11), rotated arm (13), hinge (10).
- Gaps: none known for these rows.
