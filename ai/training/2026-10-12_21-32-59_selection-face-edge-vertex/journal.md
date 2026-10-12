# Training: selection · Face, Edge, Vertex

**Date:** 2026-10-12

## Goal

APIs: `Face` (geom_type, area, center, normal_at, plane, radius, axis, is_planar, interior_point,
to_sketch, to_shell, extrude, outer_wire, inner_wires), `Edge` (geom_type, length, start, end,
point_at, tangent_at, direction, normal, radius, arc_center, is_closed, is_seam, intersections,
reversed), `Vertex` (point, x, y, z, Vertex(x, y, z)).

Questions:
- Is `face.plane.x_dir` predictable? Where is its origin for a face with a hole?
- What does `radius` return for a cone, sphere, torus? What does `axis` give for a sphere?
- `normal_at(point)` with a point off the face.
- Edge direction for part edges: which way do they run? Is `start`/`end` predictable?
- `point_at` parameter: fraction of length? Values outside 0..1?
- `intersections` of edges of a part and free edges.
- Vertex equality: two `Vertex(1,2,3)`; a part vertex vs a free vertex at the same point.

## Runs

### 01-face-props.py
All face types of Box−hole, Cone, Sphere, Torus, filleted box:
- `radius`: cylinder 6; cone `Cone(10,5,20)` → 10 (bottom radius); sphere 8; torus `Torus(20,4)` → 4
  (minor radius); fillet faces 3. Planes: ValueError "a plane face has no radius".
- `axis`: hole Axis(origin (0,0,−15), dir +Z); cone origin z −10; sphere and torus `Axis.Z`; fillet
  face axis through the fillet center (7,7,−5) dir +Z. Planes: ValueError "a plane face has no axis".
- `plane`: origin = area centroid, z = outward normal. x_dir: top/bottom (1,0,0); −X face (0,−1,0);
  +X (0,1,0); −Y (1,0,0); +Y (−1,0,0); local Y = z × x points up (+Z) on all four side faces.
  Curved faces: ValueError "a cylinder face has no plane; use normal_at() or a planar face".
- `interior_point()` lies on the face; `normal_at()` of planes = outward normal.
- Full cylinder / sphere / torus `normal_at()` without a point: arbitrary direction (centroid on the axis).
**📌 doc:** radius/axis per type; plane origin = centroid; side-face local Y up.

### 02-face-methods.py
- Hole face `normal_at((6,0,0))` = (−1,0,0): out of the material, i.e. towards the hole axis.
  Boss face at the same point: (+1,0,0). A far point (100,0,0) projects onto the face: (−1,0,0).
  Planar `normal_at(any point)` = the plane normal.
- Top face with holes at x=0 (r 6) and x=14 (r 2): centroid (−0.1638, 0, 10), bbox center (0,0,10).
  `plane.origin` = centroid, which is 5.84 off the face (inside the r 6 hole). `interior_point()` on the face.
- `inner_wires()` returns 2 wires (r 6, r 2); `outer_wire()` 4 edges.
- Ring face (Cylinder−Cylinder): centroid at the axis, 6.0 from the face; `Circle(1).on(ring_top)` lands at the axis.
- `to_sketch()`: Sketch area 1074.336 with 2 inner wires, plane at the centroid, normal +Z.
  `to_shell()`: Shell, 1 face. `extrude(5)`: Part 5371.681 = area·5, z 10..15 (outward).
  `extrude(-5)`: z 5..10 (into the part). Side face `extrude(3)`: x 20..23.
- Cylinder face `to_sketch()`/`extrude()`: ValueError "a cylinder face has no plane"; `to_shell()` works.
- Sketch on Plane.XZ: face plane x (1,0,0), z (0,−1,0) = the sketch plane's x_dir.
- `to_nurbs()` box face: geom_type bspline, `is_planar` False, `.plane` ValueError; `planar()` 0,
  `parallel_to(Z)` 0, `facing(Z)` 1.

### 03-is-planar-bspline.py
Exactly flat bspline faces report `is_planar` False: `surface()` of a flat 4×4 grid (bbox z 0..0),
flat `ruled()` of two lines, `to_nurbs()` box top (bbox z 5..5). → todo (`.plane`, `.on(face)`,
`to_sketch()` and `extrude()` refuse such faces).

### 04-edge-props.py
- Line: direction (1,0,0); radius/arc_center/normal ValueError "not a circular edge but a line".
- CenterArc(0..90°, r 5): len 7.854, start (5,0,0), end (0,5,0), center = midpoint (3.54,3.54,0),
  arc_center origin, normal +Z; direction ValueError "direction is only defined for straight edges, this is a circle".
- Circle edge: closed, start=end (5,0,0), `center()` (−5,0,0) = midpoint, `arc_center` origin.
- EllipticalArc: no radius/arc_center/normal (ValueError). Spline: tangent (0.447,0.894,0) at the start.
- Cylinder rims (both): start (5,0,±5), normal +Z on both rims (not oriented by the face).
  Hole rims the same: normal +Z, tangent (0,1,0) at the start.
- Box vertical edges run −Z → +Z (direction (0,0,1)), but the sense of part edges is the kernel's.
- Plane cut through a cylinder: the ellipse comes as 2 edges (len 25.42 + 8.47), split at (5,0,0)
  and (0,5,2.887).

### 05-edge-methods.py
- `point_at(t)`: t is the fraction of the arc length (400 samples on a spline: segment lengths
  0.05092..0.05093); t < 0 → start, t > 1 → end (clamped).
- `reversed()`: start/end swapped, tangent reversed, `normal` NOT flipped, `== original` True;
  a reversed part edge still fillets (997.854).
- `intersections`: line×line (5,5,0); circle×line through the center → 3 points, (5,0,0) twice
  (the circle's start); line ending at the center → (5,0,0) twice; arc×arc 1 point; spline×line 2 points;
  part edges meeting at a corner → the corner; collinear overlap → one point (5,5,0).
  No intersection (lines whose extensions cross, parallel, skew, far line) → KernelError
  "edge intersections failed (SM_ERR)" instead of `[]`. → todo.
- `is_seam`: cylinder seam line True; sphere has 1 seam (half circle 15.708); torus 2 seams (both circles).
  Free edges False.
- Two free `Line`s with the same points are not equal (identity), `l1 == l1` True.
- Outer wire edges are in `face.edges()` and run CCW seen from outside.
- `Edge()` → TypeError "create edges with Line(), Arc(), Spline(), ... or take them from a shape".

### 06-vertex.py
`Vertex(1,2,3)`, `Vertex((1,2,3))`, `Vertex(Vector)`, `Vertex()` = origin, `Vertex(1,2)` and
`Vertex((1,2))` → z 0. `point` is a Vector; `x`,`y`,`z` floats; unpacks as a tuple.
Equality by position within ~1e-6 (5e-7 equal, 2e-6 not); part vertex == free vertex at the same point;
`Vertex(5,5,5) in box.vertices()` True. Corner: 3 edges, 3 faces. `distance_to` point or Part (15.0).
`translate` gives a free vertex (no edges). Vertex works as a point argument (`Line(corner, Vertex(0,0,0))`).
`Rectangle.fillet(2, sk.vertices().right())`: area 198.2832 = 200 − 2(4−π).
Sphere vertices = the poles; cylinder vertices = (5,0,±5) where the seam meets the rims.

### 07-vertex-hash.py
A part vertex and an equal free vertex have different hashes: `{corner, Vertex(5,5,5)}` has 2 members,
`ShapeList([corner, free]).vertices()` keeps both; `|` dedupes (uses ==). → todo (LOW).

## Coverage check
- [x] every Face/Edge/Vertex member in the plan ran; errors recorded
- [x] point_at range, reversed, intersections cases, seams
- [x] realistic use: session 1 script 16 (faces().facing(-X).one() → on → extrude; is_closed filter)

### 08-bspline-plane-workaround.py
`to_nurbs()` box top: `Plane(face.center(), z_dir=face.normal_at())` → origin (0,0,5), z +Z;
`Circle(2).on(pl).extrude(-3)` cut: volume 962.301 = 1000 − π·4·3.

### 09-edge-claims.py
Closed free Spline: `is_closed` True, 2 vertices (free edges dedupe vertices by exact coordinates).
A chamfer border edge: geom_type bspline, `(e.end - e.start).normalized()` = (0,0,1); `direction` raises
"direction is only defined for straight edges, this is a bspline".

### 10-12 (doc examples)
`10-ex-Face.py`: the first draft placed `Rectangle(10, 6).on(top)` on a top face with a centered hole
of r 6; the rectangle (corner 5.83 from the center) lay entirely inside the hole and the cut removed
nothing (21738.053 before and after). Shifting with `.translate(12, 0, 0)` before `.on(top)` removed
240 = 10·6·4. Kept both in the doc as the centroid trap. `11-ex-Edge.py`, `12-ex-Vertex.py` as in the docs.
