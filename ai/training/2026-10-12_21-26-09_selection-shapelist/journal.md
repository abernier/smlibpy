# Training: selection · ShapeList

**Date:** 2026-10-12

## Goal

APIs: `ShapeList` (all selectors), `faces()`, `edges()`, `vertices()`, `wires()`, `Part.solids()`,
positional selectors, `filter_by`, `filter`, `parallel_to`, `perpendicular_to`, `of_type` and
shortcuts, `convex`/`concave`/`smooth`, `sort_by`, `group_by`, `largest`/`smallest`,
`min_by`/`max_by`, `first`/`last`/`one`/`at`, `nearest`/`within`/`facing`, list transforms.

Questions:
- Are faces/edges from two separate `part.edges()` calls equal? Do `|`, `&`, `-` work across calls?
- What does `top()` return on ties, and for edges (which center is used)?
- What do empty selections do downstream (fillet, on, one, first, largest, nearest)?
- `parallel_to` for faces vs edges; curved faces; tolerance.
- What is the order of `faces()`? Is it stable across calls / after transforms?
- `facing` on curved faces: center of a full cylinder lies on the axis.
- `copy()`, `append`, `extend`: do they return ShapeList?

## Runs

### 01-basics.py
`Box(40,30,20) - Cylinder(6,30)`: 7 faces, 14 edges (15 with seams), 10 vertices, 9 wires.
ShapeList is a `list` subclass. Faces, edges, vertices taken in two separate calls compare equal
(`e1[0] == e2[0]` True), order is the same in both calls (14/14), so `|`, `&`, `-` work across calls:
`top()` 5 edges (4 lines + hole rim), `parallel_to(Z)` 4, `a|b` 9, `a&b` 0, `a-b` 5, `a+b` 9.
Slicing returns a ShapeList; repr shortens lists over 6.
**📌 doc:** selections from separate calls can be combined with set operators.

### 02-positional.py
- Box: `top()` etc. give 1 face, 4 edges, 4 vertices for every side.
- Step body (tops at z=20 and z=30): `faces().top()` only the z=30 face; `facing(Z)` both.
- Two blocks with tops at the same height: `top()` returns both faces (tie).
- Horizontal cylinder (axis X, `Cylinder(10,40).rotate(Y,90)`): both circle edges have
  `center()` (= `point_at(0.5)`) at z=+10 although `arc_center` is at z=0, so
  `edges().top()` returns both rims and `edges().bottom()` none. Edge position = midpoint along
  the curve, for a closed circle the point opposite its start.
- Same cylinder: `faces().top()` returns all three faces (centroids all at z≈0 within 1e-6).
- Sphere: 1 face, 0 edges, 2 vertices (poles); face centroid at the origin (±1e-6).
- Tie tolerance: tops at z=5, 5.000025, 5.0005 → `top()` only the 5.0005 face. Ties are within
  1e-4 absolute.
**📌 doc:** face position = area centroid; edge position = midpoint along the edge; ties within 1e-4.

### 03-empty.py
Empty ShapeList chains silently (`top()`, `parallel_to`, `max_by` → empty; `group_by` → `[]`).
Raises: `one()` ValueError "expected exactly one shape, got 0"; `first`/`last`/`largest`/
`smallest`/`center()`/`bbox()` IndexError "empty selection"; `[0]` and `nearest()` IndexError
"list index out of range". `fillet(empty)`/`chamfer(empty)`: ValueError "the selection holds
only seam or smooth edges, nothing to fillet" (misleading for an empty selection → todo).
`Circle(2).on(empty)` ValueError got 0; `.on(two faces)` "got 2 - narrow the selection".
`shell(1, openings=<empty>)` succeeds silently and makes a closed hollow box (vol 1408 =
4000 − 18·18·8). `fillet(face)` fillets the face's edges; a one-element ShapeList and a single Edge both work.
**📌 doc:** empty selections fail late or not at all; check `len()` or use `one()`.

### 04-topology-counts.py
Counts (faces/edges/seam-incl. edges/vertices/wires), see `files/04-topology-counts-counts.json`:
Box 6/12/12/8/6; Cylinder 3/2/3/2/3; Cone 3/2/3/2/3; Cone with tip 2/1/2/2/2; Sphere 1/0/1/2/1;
Torus 1/0/2/1/1; Wedge 5/9/9/6/5; Box−through hole 7/14/15/10/9; Box−blind hole 8/14/15/10/9;
Box with all edges filleted 26/48/48/24/26 (12 cylinder, 8 sphere, 6 plane faces);
Rectangle 1/4/4/4/1; Circle 1/1/1/1/1; ring sketch 1/2/2/2/2; two separate rectangles 2/8/8/8/2.
`ruled(Line, Line)` is a Shell with 1 bspline face and 4 bspline edges (no "line" edges).
**📌 doc:** counts table; sphere and torus have no edges.

### 05-topology-down.py
Top face of Box−hole: 5 edges (4 lines + circle), 5 vertices, 2 wires, `outer_wire()` closed
4 edges length 140, `inner_wires()` one Wire of 1 circle; 5 neighbors (cylinder + 4 walls);
`owner is part` True. Cylinder face: `edges()` 2 circles, `edges(seams=True)` adds the seam line;
its outer wire is 4 edges (circle, seam, circle, seam reversed); no inner wires.
`edge.faces()` → 2 faces; seam edge `faces()` → 1 face (the cylinder). Vertex at a box corner:
3 edges, 3 faces. ShapeList `.edges()`/`.faces()`/`.vertices()` remove duplicates (faces().edges()
= 14 = part.edges()); `.wires()` does not deduplicate (wires are per face anyway).
Outer wire runs counter-clockwise seen from outside (`plane()` normal +Z on the top face,
−Z on the bottom face); inner wire runs the other way (−Z on the top face).
Edges of `top.outer_wire()` fillet fine on the part (vol 21620.945, valid).
`two.solids()` → 2 Parts (vol 1000 each, x 0 and 30); faces of a solid have the new solid as owner
(`owner is two` False). Sketch Rectangle−Circle: 1 face, 5 edges, 5 vertices, 2 wires.
Polyline: 2 edges, 3 vertices, 1 wire, 0 faces. Free Line: faces() empty. Sketch has no `solids()`.

### 06-parallel.py
- `faces().parallel_to(Z)`: planar faces with normal along ±Z (top and bottom), both senses.
- `faces().perpendicular_to(Z)`: the 4 planar walls (normal ⟂ Z). The cylinder wall is in neither.
- `edges().parallel_to(Z)`: the 4 vertical lines; `perpendicular_to(Z)`: 8 horizontal lines, circles excluded.
- `-Z`, `(0,0,-1)`, `(0,0,-5)` and an Axis through (100,100,0) all give the same result (only the direction counts).
- `filter_by(Z)`=parallel_to, `filter_by("circle")`=of_type (case-insensitive), `filter_by(callable)`=filter.
  `filter_by((0,0,1))` → TypeError "'tuple' object is not callable"; `filter_by(Plane.XY)` same. → todo.
- Tolerance: box rotated about X by 1e-4° still matches, by 2e-4° not (angle tolerance 1e-4°, fixed).
  `facing` default `max_angle` 1e-3°: 2e-4° matches, 1e-3° not (borderline, angle ≤ max_angle).
- Cylinder: `faces().parallel_to(Z)` 2 (the caps), `perpendicular_to(Z)` 0.
- Chamfer face with normal (0.707,0,0.707) found by `parallel_to((1,0,1))`.
- Sketches in a ShapeList: judged by their plane normal. Vertices: always dropped.
**📌 doc:** parallel_to on faces = normal; vertical walls are perpendicular_to(Z).

### 07-types.py
Face types seen: plane, cylinder, cone, sphere, torus, extrusion (extruded spline or ellipse
profile), revolution (revolved spline profile), bspline (loft, surface, sweep, to_nurbs),
offset (offset of an extrusion face). Edge types seen: line, circle, ellipse (inclined cut through
a cylinder; extruded Ellipse), bspline (chamfer edges, loft, surface, to_nurbs, sweep).
Fillets make cylinder and sphere faces; `cylinders()` returns fillet faces and holes alike.
`to_nurbs()` turns every face into bspline: `planar()` then finds nothing.
`of_type("plane","cylinder")` takes several names; `of_type("Cylinder")` case-insensitive;
unknown names (`"cylindrical"`, `"arc"`) silently return nothing → todo.
`circles()` includes arcs: fillet arcs (length 4.712, `is_closed` False) and the full hole rim (18.85, True).
`lines()` on faces and `planar()` on edges return empty lists, no error.
`surface()` with a 3×3 grid raised `KernelError: surface failed (SM_ERR)` (not my domain; used 4×4).

### 08-chamfer-edge-types.py
`Box(20,20,10).chamfer(vertical edges, 2)`: 24 edges, only 8 are "line"; the 16 new edges
(vertical chamfer borders and the chamfer's top/bottom edges) are "bspline" although straight
(length = chord). `edges().parallel_to(Z)` → 0, `lines()` → 8.
Chamfer of the top edges: `parallel_to(Z)` finds only the 4 original vertical edges.
Fillets keep line/circle types. Positional selectors still work (`bottom()` 4).
![chamfer](files/08-chamfer-edge-types-chamfer.png)
**📌 doc:** after chamfer/loft/sweep straight edges may be bspline; select by position or a predicate.

### 09-convexity.py
Box 12 convex. L-shape (two boxes): 17 convex, 1 concave (the inner corner line at x=10,z=10).
Pocket in a block: 8 concave (4 vertical + 4 at the pocket floor), 16 convex.
Through hole: all 14 convex (hole rims count as convex: material angle 90°).
Boss on a plate: base circle concave, top circle convex. Vertical edges filleted: 8 smooth edges
(the fillet borders, type line), 16 convex. `L.fillet(L.edges().concave(), 2)`: vol 3000 → 3008.584
(= +(1−π/4)·2²·10·... +8.584, correct), then 2 smooth edges, 0 concave. Chamfered top: all 20 convex.
Shelled box, open top: 8 concave, all inside. Sketch edges and free Lines: "convex" (single face / no face).
Crossing cylinders: 4 concave ellipse edges. Sphere on a box: 1 concave circle.
![pocket and L](files/09-convexity-pocket_L.png)
**📌 doc:** concave() = inside corners (fillet them to add material); hole rims are convex.

### 10-convexity-kink.py
Kink of 0.2° and 0.4° (either direction) → "smooth"; 0.6° and 1.0° → concave/convex. The threshold
is 0.5° between the face normals at the edge midpoint. `fillet` of a 0.4° kink: ValueError
"the selection holds only seam or smooth edges, nothing to fillet" (fillet skips smooth edges).

### 11-sort-group.py
- `sort_by()` default Z ascending; `reverse=True`; `"x"`/`"X"`, `"area"`, `"length"`, `"radius"`,
  `"size"` (= volume, area or length), callable, Axis (origin of the axis ignored for ordering).
- Errors: `sort_by((1,0,0))` TypeError "cannot sort by (1, 0, 0)"; `"distance"` ValueError "use
  .sort_by_distance(point)"; `"foo"` TypeError; `"area"` on edges AttributeError 'Edge' object has no
  attribute 'area'; `"radius"` on planar faces ValueError "a plane face has no radius"; `"length"` on faces AttributeError.
- `sort_by_distance(point)` by center distance; `reverse=True`.
- `group_by(Z)` returns a plain `list` of ShapeLists, lowest first (edges: z −10:6, 0:4, 10:6).
  `group_by("area")`, `group_by("radius")` work. `group_by(Z)[-1] == max_by(Z)`.
- Tolerance chaining: z 0, 6e-5, 1.2e-4, 1.8e-4 with tol 1e-4 → [[0, 6e-5], [1.2e-4, 1.8e-4]]: a
  group is anchored to its first (smallest) value, values within tol of it join.
- `reverse()` and `sort(key=...)` are the in-place list methods: they return None. `sorted()` returns a list,
  `[::-1]` a ShapeList.
- `F > Z` = sort_by, `F < Z` = sort descending, `F >> Z` = max_by, `F << Z` = min_by; `E >> Z` == `E.top()`.
- Ties keep the input order (stable sort).

### 12-extremes.py
`largest()`/`smallest()` return one shape (not a list); by volume, else area, else length; ties →
first in list order (top face before bottom face); vertices all measure 0 → first vertex.
`max_by("area")` returns the tie group (2 faces) as ShapeList; `min_by("length")` 4 edges;
`max_by()` default Z; `max_by(..., tol=300)` widens the group. On solids: `largest()` by volume.
Mixed list face+edge: largest compares area with length (face won). `first`, `last`, `[-1]`.
`at(point, tol=1e-4)`: corner → 1 vertex, 3 edges, 3 faces; point on the hole rim → plane + cylinder face;
1e-5 off → found, 1e-3 off → not found (tol=0.01 finds it); point in the hole opening → nothing.
`at` on solids uses the distance to the boundary (see 13).

### 13-spatial.py
- `nearest(point)` compares centers, not true distances: Box(100,10,10), point (49,0,6) 1 mm above
  the top face → `nearest` gives the right end face (center distance 6.1, true distance 1.414); the
  true nearest is the top face (distance 1). Use `sort_by(lambda f: f.distance_to(p)).first`.
- `within(BoundBox)`: shapes whose bbox lies inside; half-space box x≥0 → only the right end face
  (1 of 6), 4 edges, 4 vertices. Tuples are not accepted (AttributeError 'tuple' object has no attribute 'contains').
- `facing(Z)` 1 face, `facing(-Z)` 1; vector and Axis inputs work, length ignored.
- Full cylinder face: centroid on the axis, `normal_at()` = (−0.98, 0.19, 0) (arbitrary, depends on
  centroid noise), so `facing(±X/±Y, max_angle=1)` → 0 for all. Sphere `normal_at()` (−0.33, 0.94, 0.04): arbitrary. → todo.
- Half cylinder (`Cylinder & Box` on +Y): one cylinder face, centroid (0, 6.366, 0), normal (0,1,0),
  `facing(Y)` 1. With the box on +X instead, the cylinder face is split in two at the seam (2 cylinder faces).
- Wedge(20,20,10): slope normal (0.447, 0, 0.894); `facing(Z)` 0, `facing(Z, max_angle=60)` 1.
- Edges in `facing` are dropped.
- `solids().at((0,0,0))` → 0 (point inside, 5 from the boundary): `at` means on the boundary.

### 14-list-transforms.py
`translate(x,y,z)` and `translate(vector)`, `rotate(axis, angle)` (default angle 0 = copy), `moved(loc)`,
`on(face)` all return ShapeLists of moved copies. `Pos(5,0,0) * shapelist` returns a plain `list`
(Location.__mul__ handles lists first) → todo. `GridLocations * part` → ShapeList of 4; `plate - grid` works.
`copy()` returns a plain `list` (no selectors) → todo. `append`/`extend` keep the ShapeList.
`ShapeList + list` → ShapeList; `list + ShapeList` → list.
Moved faces become faces of a new Shell (`owner` Shell); moved edges are free edges (`faces()` empty);
`plate.fillet(moved_edges)` → ValueError "Edge(...) is not an edge of this part". No `scale`/`mirror` on ShapeList.

### 15-order.py
Box face order: bottom, top, −X, +X, −Y, +Y; the same on every call and on a translated copy.
After `- Cylinder` the 6 planes keep their order, the cylinder is appended; after a fillet the order
is reshuffled (`faces()[0]` is a cylinder). `faces().top()` is the top face in all three versions.
Faces of a translated copy are not equal to the original's faces.
A selection from an earlier version of a part passed to a feature of the new version is matched by
geometry: `part.fillet(old_top_face, 1)` worked (11 faces) after a hole was cut.
**📌 doc:** indices change with every feature; geometry does not.

### 16-realistic.py
Angle bracket: L of two boxes → `fillet(edges().concave(), 6)` → right corners
`edges().parallel_to(Z).filter(x > 25)` (2 edges) fillet 5 → two holes → wall hole via
`Circle(4).on(faces().facing(-X).one()).extrude(-20)` → chamfer hole rims. `circles()` at z=8
gave 4 edges: 2 corner fillet arcs (r 5, not closed) and 2 hole rims (r 3, closed): a chamfer on all 4
failed (KernelError "chamfer failed (SM_ERR): the length may be too large"); filtering `is_closed`
fixed it. Result valid, volume 28795.531 (hand estimate 28795.6), bbox (−30,−20,0)..(30,20,40),
2 holes r 3, 1 hole r 4 with axis −X.
![bracket](files/16-realistic-sheet.png)
Stale selections: top edges of a block, after a slot cut across the top splits two of them →
`fillet(old_edges)` ValueError "Edge(line, (-10, 10, 5) -> (10, 10, 5)) is not an edge of this part";
old top face (area changed) → `shell(openings=old)` ValueError "... is not a face of this part".
Old edges that the cut did not touch work (vol 3958.083, valid).
**📌 doc:** circles() also returns fillet arcs; filter by `is_closed` or radius.

## Coverage check (rows 1-10, 14)
- [x] every API ran; parameters tried (tol for group_by/max_by/at, max_angle for facing, reverse, seams)
- [x] every type name tried except "other"
- [x] defaults measured (tie tol 1e-4, parallel angle 1e-4°, facing 1e-3°, smooth 0.5°)
- [x] errors with messages recorded
- [x] realistic use: 16
- Gap: `within` on curved faces uses the tight bbox (not checked against a loose bbox).

### 17-plain-list.py
`fillet` takes a plain list or a tuple of edges (vol 3965.664 in all three forms).
`set(faces().top().edges()) == set(edges().top())` on a box: True.

### 20-30 (doc examples)
`20-ex-generic.py` … `30-ex-list_transforms.py` hold the examples of the docs, each run unchanged;
the printed values in the doc comments are the logged output.

### 18-claims.py
Closed circle edge of a cylinder: 1 vertex. `Box(10,20,30).edges().group_by("length")`: 3 groups of 4.
Box with filleted top edges: `faces().top()` 1 (the flat face), `edges().top()` 4 lines.
`faces().within(b.bbox())` 6 of 6. Plate+boss: `planar().facing(X)` 1. `sort_by(-Z).first` is the
highest face (z 15); `max_by(-Z)` the lowest (z −15).

### 19-predicates.py
The predicate snippets of filter_by.md: 4, 1, 4, 4. `edges().filter(lambda e: e.radius > 2)` raises
ValueError "not a circular edge but a line" on the first line; `circles().filter(...)` 4.

### 31-ex-roughly-parallel.py
Box rotated 0.5° about X: `parallel_to(Z)` 0; `lines().filter(lambda e: e.direction.is_parallel(Z.direction, 1))` 4.

### 32-cone-equal-radii.py
`Cone(5,5,10)` faces: cylinder + 2 planes. `Ellipse(6,3)` sketch: 1 ellipse edge.

### 33-list-claims.py
`Rot(z=90) * sl` and `Plane.XZ * sl` → list. `ShapeList(s.mirror() for s in sl)` → ShapeList.
`rotate(Axis((10,0,0),(0,0,1)), 180)` turns about that axis (x 0 → 20, 20 → 0).
`PolarLocations(30, 6) * Cylinder` → ShapeList. `insert`/`pop` keep the ShapeList.
