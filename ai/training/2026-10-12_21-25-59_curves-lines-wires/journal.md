# Training: curves · lines and wires

**Date:** 2026-10-12

## Goal

APIs: `Edge` (as made by curve constructors), `Wire`, `Line`, `Polyline`, `PolarLine`,
`make_face`, `Wire.to_sketch`, wires as sweep paths.

Questions:
- What do the constructors accept (2D/3D tuples, lists, Vector, Vertex)? What do they return?
- How does `Wire([...])` order and flip edges? What happens with gaps and branches?
- Which way does a sketch made from a wire face? Same as a sketch placed on the plane?
- PolarLine: is the angle measured from the plane's X axis? Is `start` in plane coordinates?
- Wire.fillet: limits, open wires, selected corners, bad radii.
- Do transformations keep lines as lines?

## Log

### 01-line-basic.py
Line from 2-tuples, 3-tuples, lists, Vector and Vertex all work. Returns an `Edge`
(`geom_type` "line"); `start`, `end`, `length`, `direction`, `point_at`, `tangent_at` exact:
`Line((0,0),(30,40))` length 50.0, direction (0.6, 0.8, 0), `point_at(0.25)` (7.5, 10, 0).
Equal points (and < 1e-12 apart) raise `ValueError: a line needs two distinct points`; a
1e-9 long line is accepted. 1 or 4 coordinates: `ValueError: expected 2 or 3 coordinates`.
`radius` on a line: `ValueError: not a circular edge but a line`.
📌 doc: Line returns Edge; points 2D or 3D; ValueError on equal points.
![line](files/01-line-basic-line.png)

### 02-line-place.py
`.on(Plane.XZ)`: Line (0,0)->(10,0) stays on X (Plane.XZ x_dir is +X); on `Plane.right`
it runs along +Y. `.on(Plane.XY.offset(5))` lifts it to z=5. `rotate` keeps geom_type "line",
`mirror` and `scale` give "bspline". Two copies of the same line are not `==` (identity).
`Line + Line` gives a Wire. A 1e-7 gap still counts as closed (`is_closed` tol 1e-6), and
make_face of it works (area 99.9999987).

### 03-mirror-geomtype.py
**Defect.** `mirror()` and `scale()` turn lines and arcs into `bspline` edges. Consequences:
`.direction` and `.radius` raise, and `Wire.fillet` / `Sketch.fillet` silently skip every
corner that touches a mirrored edge: `half + half.mirror(Plane.XZ)` of a 40x20 rectangle,
`fillet(2)` rounded only 2 of 4 corners (sketch area 798.283 instead of 796.566).
📌 doc: build symmetric outlines with points, not by mirroring, if you want to fillet them.

### 04-polyline.py
`Polyline(a, b, c, d)` = 3 edges, open. `close=True` adds the closing line (4 edges). Repeating
the first point at the end also closes (4 edges, not 5); both together still 4. Duplicate
consecutive points are dropped. Collinear points stay separate edges in the wire but are
merged in make_face (3 face edges). **Defect:** one list of 2 or 3 points
(`Polyline([(0,0),(10,0),(10,5)])`) raises `TypeError: float() argument must be ... not
'tuple'`; a list of 4+ points works. **Defect:** `Polyline((0,0),(0,0))` returns a Wire with 0
edges; its repr raises IndexError. `Polyline((0,0),(10,0), close=True)` is a "closed" 2-edge
wire; make_face of it fails with KernelError. make_face of an open polyline:
`ValueError: a sketch region needs closed wires; use wire.close()`.
📌 doc: pass points as separate arguments, or unpack with `*`.

### 05-polarline.py
Angle in degrees counterclockwise from the plane's X axis towards its Y axis; 400 = 40;
negative length reverses (length stays positive). On XZ: 0 -> +X, 90 -> +Z. On YZ/right:
0 -> +Y, 90 -> +Z. On back: 0 -> -X. **Surprise:** `start` is a world point; `plane` only sets
the direction: `PolarLine((1,2), 10, 0, plane=Plane.XY.offset(5))` starts at (1,2,0), not z=5
(CenterArc takes its center in plane coordinates). Length 0: ValueError.

### 06-wire-ordering.py
`Wire([...])` chains edges head to tail and flips where needed. The first edge given keeps
its direction and fixes the wire direction; a closed wire starts at the start of the first
edge given. `sort=False` keeps the given order (wire then not traversable). Gaps and T
branches are accepted **silently**: the edges keep the given order and the wire is just
"open". Chain tolerance 1e-6. Accepts a single Edge, Wires, nested lists; `a + b + c` same.
`Wire([])`: ValueError; a tuple inside: `TypeError: a wire is made of edges, got int`.

### 07-wire-props.py
Line + half circle + line wire: length 35.70796 (exact 20 + 5π). `point_at`/`tangent_at`
by fraction of total length, clamped to 0..1. `center()` length weighted (9.399, 5, 0), not
the centroid. `reversed()` flips. `plane()` normal by the right-hand rule of travel
(ccw +Z, cw -Z). `close()` adds a straight line, returns self if closed. `to_sketch` area
139.26991 (exact 139.26991).

### 08-wire-fillet.py
`fillet(2)` on a 20x10 closed rectangle: 4 arcs r=2, centers (18,2) etc.; area 196.56637
(exact 196.56637). Open wire: end corners untouched, inner corners rounded. `vertices=[...]`
takes points or Vertex; a point that is not a corner is ignored silently. Limit: setbacks on
an edge may sum to its length: r=5.0 on the 10 side works (lines vanish, 6 edges), 5.001
raises `ValueError: fillet radius 5.001 is too large for the edge Edge(line, ...)`.
**Defects:** r=0 raises `cannot normalize a zero-length vector`; r=-1 silently returns a
broken wire (length 86.85 instead of < 60). Only corners between two lines are rounded.
![fillet](files/08-wire-fillet-fillet.png)

### 09-wire-to-sketch.py
`make_face(outline, hole)` area 1149.7345 (exact 1200 - 16π). Holes may be Edges. A single
closed edge (full CenterArc) is a valid outline. Clockwise outline: same region, normal +Z.
Non-planar and self-crossing wires: `KernelError: make face failed (SM_ERR): the wire must be
planar and must not cross itself`. A hole that crosses the outline is subtracted like a
Boolean (1200 - 25π/4); a hole outside does nothing.

### 10-sketch-normal.py
**Defect/surprise.** A sketch made from a wire (`make_face`, `to_sketch`) gets a normal that
points to +Z, or for vertical planes to +X/+Y, whatever plane the wire was drawn on and
whatever its direction: wire on Plane.XZ -> normal +Y (Rectangle.on(Plane.XZ) has -Y);
Plane.left -> +X; Plane.bottom -> +Z. `extrude(5)` therefore goes the other way than for a
Rectangle on the same plane. Workaround: `make_face(wire_on_xy).on(plane)` keeps the plane.

### 11-wire-paths.py
Sweep of Circle(3) along Polyline((0,0,0),(0,0,30),(30,0,30)): valid, mitered corner. Along
FilletPolyline radius 8: volume 1599.377 = π·9·L (1599.376). Open wire extrude -> Shell
(area 150); closed wire -> Part. **Defect:** a path with a gap is accepted by Wire and sweep
returns a Part with `is_valid() False`, volume 0, 2 solids, no error.
![pipes](files/11-wire-paths-pipes.png)

### 12-edges-from-parts.py
Edges of a body work like curve edges: `Wire(box.edges().top())` closed, `to_sketch` area 800
at z=5. `face.outer_wire()`. `Line(...).on(face)`: on the front face (-Y) the face plane x is
+X; on the +X face, x is +Y and local y is +Z.

### 13-misc-errors.py
`Edge()` -> TypeError naming `Arc()`, which does not exist (LOW). `make_face([edges])` works
(the list goes through Wire). `extrude([edges], 3)` -> TypeError; `extrude(Wire(edges), 3)` works.

## Coverage

Line, Polyline, PolarLine, Wire: all parameters tried, defaults measured, errors recorded,
realistic use (bracket, pipes). Gaps: none relevant.

### 14-doc-examples.py
The code blocks of generic.md, Line.md, Polyline.md, PolarLine.md and Wire.md, copied
verbatim, plus checks of the numbers in their comments: all ran and match (bracket volume
5748.67 z 0..5; wall y -5..0 with normal -Y; pipe valid; Wire example region 139.26991).

### 15-fillet-line-arc-corner.py
A 36.87° corner between a line and an arc is not rounded by `Wire.fillet`; only the two
line-line corners get arcs. 📌 doc: fillet works on line-line corners only.
