# Training: sketches · generic (Sketch, 2D Booleans, placement)

**Date:** 2026-10-12

## Goal

APIs: `Sketch` (area, bbox, center, plane, faces), `+ - & ^`, `on()`, `Plane * sketch`,
`Face.to_sketch`, `Wire.to_sketch`.

Questions:
- What is a Sketch (type, topology), how exact is `area`?
- What do the 2D Booleans return for overlapping, touching, disjoint and fully removed regions?
- What errors come for different planes, parts, edges?
- Where does a sketch go with `on(plane)`, `on(face)`, `Plane *`, `Pos *`? Which way is its normal?
- What is `sketch.plane` after align, Booleans, mirror, scale? Does it matter downstream?
- `Face.to_sketch`, `Wire.to_sketch`: plane, holes, errors.

## Log

### 01-basics.py
Rectangle(40, 20) is a `Sketch` (subclass of `Shell`), 1 face, 4 edges, 4 vertices, 1 wire, plane XY,
normal +Z. Area 800 (799.9999999999999). Circle(10) area 314.15931 vs pi r^2 314.15927: relative error
1.4e-7, so `area` is numerically integrated, not exact. Circle has 1 edge (`circle`), 1 vertex.
Ring `Circle(10) - Circle(6)`: 1 face with 1 inner wire, area 201.062 (expected 201.0619).
`extrude(5)` goes +Z: bbox z 0..5.
![rect and ring](files/01-basics-rect-ring.png)
**📌 doc:** area is accurate to ~1e-7 relative, not exact.

### 02-booleans.py
Rect 40x20 and circle r12 at (20,0): union 1044.2009 = 800 + 452.39 - 208.188 (checks), difference 591.812,
intersection 208.188, xor 2 faces area 836.012 = union - intersection. Right side can be a list
(`- GridLocations(...) * Circle(2.5)`: 4 inner wires). `sum(PolarLocations(20, 6) * Circle(4))` gives one
sketch of 6 faces. Disjoint union: 2 faces; disjoint difference: unchanged; disjoint intersection:
`ValueError: the sketches do not overlap; their intersection is empty`. A bar cut through gives 2 faces
(centers x = -11, 11). Rectangles sharing an edge fuse to 1 face with 4 edges (the shared edge and the
collinear edges are merged). Rectangles touching at one corner stay 2 faces. Two overlapping circles: 1 face,
3 edges. Lens `&` area 122.837 = formula 122.83697. Subtracting everything (bigger or identical
rectangle) returns `Sketch(0 faces, area=0)` silently.
![booleans](files/02-booleans-ops.png)
**📌 doc:** operators, lists, sum(), pieces, empty results.

### 03-errors.py
- Different planes (XZ, or XY.offset(5)): `ValueError: cannot fuse sketches in different planes`.
- Same plane flipped: accepted.
- `Sketch + Part`: `TypeError: cannot fuse a Part with a Sketch`; `Sketch - Part` likewise.
- `Part + Sketch`: accepted, returns a Part (see 04).
- `Sketch + Edge`: `TypeError: 'Edge' object is not iterable` (confusing message).
- Intersection whose bboxes overlap but regions do not (L-shape and a square in its notch): empty sketch,
  no error (bbox-disjoint raises; region-disjoint does not).
- Empty sketch: bbox is (1e20..-1e20), `extrude(5)` gives `Part(0 faces, volume=0)` silently,
  `center()` raises ZeroDivisionError. `empty + rect` and `rect - empty` work.
- Two sketches both on XZ: Booleans work, plane z (0,-1,0).
**📌 doc:** errors list; check `len(s.faces())` after a cut or intersection.

### 04-part-plus-sketch.py
`Box(5,5,5) + Rectangle(10,10)`: `Part(11 faces, volume=125)`, `is_valid() == False`.
`Box - Rectangle` and `Box(20,20,5) - Circle(3)` likewise invalid, volume unchanged. Defect: a forgotten
`extrude` produces an invalid part with no error. → todo #2.
**📌 doc:** always extrude before combining with a Part.

### 05-placement.py
`Rectangle(20, 10, align=Align.MIN)` (local +X 20, +Y 10) placed on every named plane; numbers:
- XY/top: x=+X, y=+Y, z=+Z. bottom: x=+X, y=-Y, z=-Z (extrude goes down).
- XZ/front: x=+X, y=+Z, z=-Y (extrude(3) goes to y=-3). back: x=-X, y=+Z, z=+Y.
- YZ/right: x=+Y, y=+Z, z=+X. left: x=-Y, y=+Z, z=-X.
- `Plane.XY.offset(15) * r`, `r.on(Plane.XY.offset(15))`, `Pos(0,0,15) * r`, `r.translate(0,0,15)`: identical.
- `Rot(x=90) * r` = on XZ. `on(Location)` and `on(rotated plane)` work.
- `mirror(Plane.XZ)` and `mirror(Plane.YZ)`: plane normal becomes -Z; extrude(3) goes to z=-3.
**📌 doc:** table of planes; mirror flips the normal.

### 06-on-faces.py
On faces of Box(60,40,20): top x=+X,y=+Y; bottom x=+X,y=-Y,z=-Z; front x=+X,y=+Z,z=-Y; back x=-X; left
x=-Y; right x=+Y; side faces always have local y = +Z. Same frames as the named planes. Sketch origin goes
to the face center. `Rectangle(30,20).on(top).extrude(-4)` bbox z 6..10, cut volume 45600 (exact).
`(Pos(10,5) * Circle(3)).on(top)` center (10,5,10). Two faces: `ValueError: expected exactly one shape, got 2
- narrow the selection or use [0]`. Cylinder face: `ValueError: a cylinder face has no plane; use
normal_at() or a planar face`. `Face.to_sketch()` of the +X face: plane z=+X (outward), origin = face
center; `box + fs.extrude(5)` grows to x=35, one solid. Top face with a hole: to_sketch keeps the hole
(1 inner wire, area 821.46 = 900 - 25 pi). `Wire.to_sketch()`: plane z +Z for either winding, origin
(10,5,0) = centroid. Open wire: `ValueError: a sketch region needs closed wires; use wire.close()`.
![on faces](files/06-on-faces-on-faces.png)

### 07-plane-tracking.py
- `sketch.plane.origin` follows align and every move: `Rectangle(20,10,align=MIN)` origin (10,5,0).
- Booleans keep the left operand's plane: `Circle(3).translate(50,0) + r` has origin (50,0,0).
- `revolve()` default axis is the plane's local Y through `plane.origin`: rectangle x 10..20 with origin
  x 15 gives `Part(6 faces, volume=0)`, no error. With `Axis((0,0,0),(0,1,0))`: 18849.561 (formula 18849.556).
- Mirror: plane z (0,0,-1), face normal -Z; `extrude(5)` bbox z -5..0, valid. `r + mirrored` keeps +Z;
  `mirrored + r` has -Z and extrudes down.
- `Rectangle(20,10).scale(2)`: bbox -20..20 x -10..10, area 800 (= 40 x 20).
  `Circle(10).scale((2,1,1))` area 628.319 = pi*20*10, edge becomes a bspline.
- `Part.section(plane)` returns a Sketch with that plane.
![mirror](files/07-plane-tracking-mirror.png)
**📌 doc:** plane origin rules, left operand wins, mirror flips.

### 08-plane-origin-revolve.py
`plane.origin` per constructor: Rectangle (0,0,0); Polygon (0,0,0) (points stay); make_face and
Wire.to_sketch: centroid of the outline (15,10,0); `Pos(15,10) * Rectangle` (15,10,0).
`revolve()` without axis: Rectangle centered → volume -9e-12, `is_valid() == True`; make_face/to_sketch of a
profile at x 10..20 → volume 0, valid True; Polygon → 18849.5 (correct, axis through world origin).
With an explicit world Y axis all give 18849.561. Defect → todo #1 (silent zero-volume revolve,
make_face's plane origin is the centroid).
**📌 doc:** pass the axis to revolve.

### 09-realistic.py
Plate: `RoundedRectangle(80,50,8) - GridLocations(64,34,2,2) * Circle(3) - Slot(30,10) - Circle(6).translate(0,15)`:
1 face, 6 holes, extrude(6) volume 20641.964 = area * 6, valid. Pins placed with
`(Locations((-25,0),(25,0)) * Circle(2)).on(top)`: a ShapeList of 2 sketches, centers at y = -0.49311, not 0:
`on(face)` uses the face's area centroid, and the holes on the +Y side shift it. Fused with
`plate + [p.extrude(4) for p in pins]`: 1 solid, valid, top z 10. `sum(...)` into one 2-face sketch extrudes
to 2 solids at once.
![plate](files/09-realistic-plate.png)
**📌 doc:** on(face) goes to the area centroid; holes shift it. Use a plane for exact positions.

## Coverage

- [x] API ran successfully (01, 02, 09)
- [x] every operator (+ - & ^, lists, sum) (02)
- [x] defaults measured (plane, normal, origin) (01, 05, 08)
- [x] edge and error cases (03, 04)
- [x] realistic use (09)
- [x] spatial claims backed by numbers (05, 06, 07, 09)
- [x] every question answered: topology 01, Booleans 02, errors 03/04, placement 05/06, plane 07/08,
      to_sketch 06
