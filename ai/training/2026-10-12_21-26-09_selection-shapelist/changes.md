diff --git a/src/smlibpy/skill/references/selection/generic.md b/src/smlibpy/skill/references/selection/generic.md
new file mode 100644
index 0000000..fff6482
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/generic.md
@@ -0,0 +1,95 @@
+# Selection: ShapeList
+
+`part.faces()`, `part.edges()`, `part.vertices()`, `part.wires()` and `part.solids()` return a
+`ShapeList`: a Python `list` with selector methods. Every selector returns a new ShapeList, so
+selectors chain: `part.edges().parallel_to(Z).top()`.
+
+## What a ShapeList is
+- A `list` subclass. `len()`, `in`, iteration, `[i]` and slicing work; a slice is a ShapeList.
+- A one-element ShapeList is accepted wherever one shape is expected: `sketch.on(part.faces().top())`.
+  With zero or several elements this raises `ValueError: expected exactly one shape, got N`.
+- Features take a ShapeList, a single shape, a plain list or a tuple: `part.fillet(sel, 2)`.
+  A face in an edge selection stands for its edges: `part.fillet(part.faces().top(), 1)`.
+- Faces, edges and vertices from two separate calls compare equal, and the order is the same on
+  every call of the same part. So `part.edges().top() | part.edges().parallel_to(Z)` works.
+- Set operators: `a | b` union without duplicates, `a & b` common, `a - b` difference, `a + b`
+  concatenation (may hold duplicates).
+- `.faces()`, `.edges()`, `.vertices()` on a ShapeList go down one level and remove duplicates:
+  `part.faces().top().edges()` are the edges of the top face.
+
+## Positions are centers
+Every positional selector (`top`, `sort_by(Z)`, `group_by`, `nearest`) uses `shape.center()`:
+- Face: the area centroid. For a face with holes, a ring or a full cylinder it lies off the face.
+- Edge: the point halfway along the edge (`point_at(0.5)`), not the arc center. For a full circle
+  it is the point opposite the circle's start.
+- Vertex: its point. Part: the center of mass.
+Ties are decided with an absolute tolerance of 1e-4 mm and all tied shapes are returned.
+
+## Why geometry beats indices
+`faces()` order is the kernel's. It is stable for one part and its translated copies, but every
+feature changes it: after a fillet `faces()[0]` of a box with a hole was a cylinder. Select by
+geometry (`top()`, `facing(-X)`, `cylinders()`, `filter(...)`) so the script keeps working when an
+earlier step changes.
+
+A selection taken from an earlier version of a part can still be passed to a feature of the new
+version: edges are matched by start, end and midpoint, faces by an interior point and the area.
+If the later step changed the edge or face, it fails with
+`ValueError: Edge(...) is not an edge of this part`. Moved copies (`.translate()`) do not match:
+they are free shapes somewhere else.
+
+## Empty selections
+Selectors never raise on empty input: an empty ShapeList chains through `top()`,
+`parallel_to()`, `max_by()` and comes out empty. The failure shows up later:
+- `one()`: `ValueError: expected exactly one shape, got 0`.
+- `first`, `last`, `largest()`, `smallest()`, `center()`, `bbox()`: `IndexError: empty selection`.
+- `[0]`, `nearest()`: `IndexError: list index out of range`.
+- `fillet(empty)`, `chamfer(empty)`: `ValueError: ... the selection holds only seam or smooth edges,
+  nothing to fillet` (it means: nothing to fillet; check the selector).
+- `sketch.on(empty)`: `ValueError: expected exactly one shape, got 0`.
+- `shell(t, openings=empty)` does not fail: it makes a closed hollow body.
+
+Print `len(sel)` after every selection that feeds a feature, or use `.one()` where you expect one.
+
+## The idioms that matter most
+| Need | Selector |
+|---|---|
+| top / bottom face of a block | `faces().top()`, `faces().bottom()` |
+| all faces pointing up (also lower steps) | `faces().planar().facing(Z)` |
+| vertical edges of a block | `edges().parallel_to(Z)` |
+| edges around the top face | `faces().top().edges()` or `edges().top()` |
+| inside corners to round | `edges().concave()` |
+| holes | `faces().cylinders()`, by radius: `.filter(lambda f: abs(f.radius - r) < 1e-6)` |
+| hole rims only (not fillet arcs) | `edges().circles().filter(lambda e: e.is_closed)` |
+| the face at a known point | `faces().at((x, y, z))` |
+| exactly one, or fail loudly | `.one()` |
+
+## Gotchas
+- `circles()` also returns fillet arcs; `cylinders()` also returns fillet faces.
+- After `chamfer`, `loft`, `ruled` or `to_nurbs`, straight edges can be `bspline`: `lines()` and
+  `parallel_to()` miss them. Select those by position or with `filter`.
+- `facing()` on a full cylinder, sphere or torus face is arbitrary (the centroid is on the axis).
+  Use `facing` for planar faces.
+- `sort()` and `reverse()` are the in-place list methods and return `None`; use `sort_by`.
+- `sl.copy()` and `Pos(...) * sl` return a plain `list` without selectors; wrap in `ShapeList(...)`.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(6, 30)
+
+top = part.faces().top()                     # ShapeList with one face
+rim = part.edges().circles().top()           # the hole's top rim
+walls = part.edges().parallel_to(Z)          # the four vertical box edges
+print(len(top), len(rim), len(walls))        # 1 1 4
+
+part = part.fillet(walls, 3)                 # a ShapeList goes straight into a feature
+hole = part.faces().cylinders().filter(lambda f: abs(f.radius - 6) < 1e-6).one()
+print(round(hole.radius, 3), part.is_valid())   # 6.0 True
+
+sel = part.edges().circles().top()
+print(len(sel))                              # 5: the hole rim and 4 fillet arcs
+assert len(sel.filter(lambda e: e.is_closed)) == 1
+```
+
+## Related
+`topology`, `positional`, `filter_by`, `parallel_to`, `types`, `convexity`, `sort_by`,
+`extremes`, `spatial`, `list_transforms`, `Face`, `Edge`, `Vertex`.
diff --git a/src/smlibpy/skill/references/selection/topology.md b/src/smlibpy/skill/references/selection/topology.md
new file mode 100644
index 0000000..9eae214
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/topology.md
@@ -0,0 +1,80 @@
+# Topology: faces(), edges(), vertices(), wires(), solids()
+
+Going from a body down to its faces, edges and vertices, and across between them.
+
+## Signatures
+- `body.faces()`, `body.vertices()`, `body.wires()` on Part, Shell, Sketch.
+- `body.edges(seams=False)`: seam edges (where a closed surface meets itself) only with `seams=True`.
+- `part.solids()`: the separate volumes of a Part as a ShapeList of Parts. Sketch and Shell have none.
+- `face.edges(seams=False)`, `face.vertices()`, `face.wires()`, `face.outer_wire()`,
+  `face.inner_wires()`, `face.neighbors()`, `face.owner`.
+- `edge.faces()`, `edge.vertices()`; `vertex.edges()`, `vertex.faces()`.
+- `wire.edges()`, `wire.vertices()`. `shapelist.faces()/.edges()/.vertices()/.wires()`.
+
+## Returns
+ShapeLists, except `outer_wire()` (a `Wire`) and `owner` (the Part, Shell or Sketch).
+
+| Body | faces | edges | edges(seams=True) | vertices | wires |
+|---|---|---|---|---|---|
+| `Box` | 6 | 12 | 12 | 8 | 6 |
+| `Cylinder` | 3 | 2 | 3 | 2 | 3 |
+| `Cone(r1, r2, h)` | 3 | 2 | 3 | 2 | 3 |
+| `Cone(r, 0, h)` (tip) | 2 | 1 | 2 | 2 | 2 |
+| `Sphere` | 1 | 0 | 1 | 2 | 1 |
+| `Torus` | 1 | 0 | 2 | 1 | 1 |
+| `Wedge(l, w, h)` | 5 | 9 | 9 | 6 | 5 |
+| `Box - Cylinder` (through hole) | 7 | 14 | 15 | 10 | 9 |
+| `Box - Cylinder` (blind hole) | 8 | 14 | 15 | 10 | 9 |
+| `Box` with all 12 edges filleted | 26 | 48 | 48 | 24 | 26 |
+| `Rectangle` | 1 | 4 | 4 | 4 | 1 |
+| `Circle` | 1 | 1 | 1 | 1 | 1 |
+| `Circle(10) - Circle(5)` | 1 | 2 | 2 | 2 | 2 |
+| `ruled(Line, Line)` (a Shell) | 1 | 4 | 4 | 4 | 1 |
+
+A through hole adds 1 face; each filleted edge adds 1 face; a sphere and a torus have no edges.
+
+## Faces
+- `outer_wire()` is the outer boundary, closed, running counter-clockwise seen from outside the
+  body. `inner_wires()` are the holes, running the other way; empty for a face without holes.
+- A cylinder face's single wire contains the seam twice (circle, seam, circle, seam);
+  `inner_wires()` is empty.
+- `neighbors()`: faces sharing an edge (the top face of a box with a hole: 4 walls + the hole).
+- `owner` is the body the face came from. Faces of `part.solids()[i]` belong to that new Part,
+  not to `part`.
+- `wires()` of a body or a ShapeList lists every face's loops; it does not remove duplicates.
+
+## Edges
+- `edge.faces()`: 2 faces for an edge inside a solid, 1 for a seam or a sheet border, none for a
+  free edge (`Line(...)`) or a moved copy.
+- `edge.vertices()`: start and end; one vertex for a closed circle.
+
+## Gotchas
+- `edges()` leaves out seams. Seams are not real edges: do not fillet them. `is_seam` tells.
+- `part.solids()` makes new Parts: their faces are not faces of `part`. Select on the part you
+  pass to the feature.
+- Edges of `face.outer_wire()` are the part's own edges and can be passed to `part.fillet`.
+- A Boolean can split one surface into several faces: `Cylinder & Box` with the box on the +X
+  side gave 2 cylinder faces (the seam lies at +X). Count faces before using `.one()`.
+- An intersection curve can come as several edges: a plane cut through a cylinder gave the
+  ellipse as 2 edges.
+- `Vertex(x, y, z)`, free `Line`s and moved copies have no faces or edges around them.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(6, 30)
+print(len(part.faces()), len(part.edges()), len(part.vertices()))   # 7 14 10
+
+top = part.faces().top().one()
+print(top.outer_wire())                  # Wire(4 edges, closed, length=140)
+print(top.inner_wires())                 # [Wire(1 edges, closed, length=37.6991)]
+print(len(top.edges()), len(top.neighbors()))   # 5 5
+
+e = part.edges().parallel_to(Z).first
+print(len(e.faces()), e.vertices())      # 2 [Vertex(20, 15, -10), Vertex(20, 15, 10)]
+
+two = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
+print(len(two.solids()))                 # 2
+```
+
+## Related
+`generic`, `Face`, `Edge`, `Vertex`, `Wire` (curves domain).
diff --git a/src/smlibpy/skill/references/selection/positional.md b/src/smlibpy/skill/references/selection/positional.md
new file mode 100644
index 0000000..f177c86
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/positional.md
@@ -0,0 +1,53 @@
+# top, bottom, left, right, front, back
+
+Keep the shapes that lie furthest in one world direction.
+
+## Signature
+`sl.top()`, `sl.bottom()` (largest / smallest Z), `sl.right()`, `sl.left()` (X), `sl.back()`,
+`sl.front()` (Y). No arguments. They are `max_by(Z)`, `min_by(Z)`, `max_by(X)`, `min_by(X)`,
+`max_by(Y)`, `min_by(Y)`; use `max_by(axis)` for any other direction.
+
+## Returns
+A ShapeList with every shape that ties for the extreme position (tolerance 1e-4 mm, absolute).
+Never a single shape: chain `.one()` when you need exactly one. Empty in, empty out.
+
+## What "position" means
+The selectors compare `shape.center()` along the axis:
+- Face: the area centroid. `faces().top()` is the face whose centroid is highest, not every face
+  pointing up. On a stepped block with tops at z=20 and z=30, `top()` gives only the z=30 face;
+  `faces().planar().facing(Z)` gives both.
+- Edge: the midpoint along the edge (`point_at(0.5)`). For a straight edge that is its middle; for
+  a full circle it is the point opposite the circle's start (where the seam is).
+- Vertex: its point. Part (in `solids()`): its center of mass.
+
+On a `Box`, each selector gives 1 face, 4 edges and 4 vertices.
+
+## Gotchas
+- Ties return all of them: two separate blocks of equal height give 2 faces for `top()`;
+  `box.edges().top()` gives the 4 top edges.
+- Tie tolerance is 1e-4 mm, fixed: tops at z=5 and z=5.000025 tie, z=5.0005 wins alone.
+- Circles that are not horizontal: a cylinder lying along X has both rim midpoints at z=+10 (its
+  radius), so `edges().top()` returns both rims and `edges().bottom()` returns none. Sort such
+  circles by `arc_center` instead: `edges().circles().sort_by(lambda e: e.arc_center.x)`.
+- Curved faces: the centroid of a full cylinder face lies on its axis. A horizontal cylinder's
+  `faces().top()` returns all three faces (all centroids at z=0).
+- A face with a large hole has its centroid shifted away from the hole; compare faces by
+  `bbox()` when that matters.
+- `top()` of `faces()` on a part with fillets on the top edges is still the flat top face.
+
+## Example
+```python
+step = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) \
+     + Box(20, 30, 10, align=(Align.MIN, Align.CENTER, Align.MIN)).translate(0, 0, 20)
+print(len(step.faces().top()))                 # 1: only the face at z=30
+print(len(step.faces().facing(Z)))             # 2: both upward faces (z=20 and z=30)
+print(len(step.edges().top()))                 # 4: the edges of the z=30 face
+right_top = step.edges().top().right()         # chain: highest, then furthest +X
+print(right_top.one())                         # Edge(line, (20, -15, 30) -> (20, 15, 30))
+
+twin = Box(10, 10, 10).translate(-20, 0, 0) + Box(10, 10, 10).translate(20, 0, 0)
+print(len(twin.faces().top()))                 # 2: a tie returns both
+```
+
+## Related
+`extremes` (`max_by`, `min_by`), `sort_by` (`group_by`), `spatial` (`facing`, `nearest`), `generic`.
diff --git a/src/smlibpy/skill/references/selection/filter_by.md b/src/smlibpy/skill/references/selection/filter_by.md
new file mode 100644
index 0000000..9bbc537
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/filter_by.md
@@ -0,0 +1,55 @@
+# filter_by, filter
+
+Keep the shapes that pass a test.
+
+## Signature
+- `sl.filter(predicate)`: keeps `s` where `predicate(s)` is true. Works on any shapes.
+- `sl.filter_by(criterion)`: dispatches on the argument type:
+  - an `Axis` (`X`, `Y`, `Z`, `-Z`, `Axis(...)`) → `parallel_to(axis)`
+  - a `str` → `of_type(name)` (case-insensitive: `"CYLINDER"` works)
+  - anything else → `filter(criterion)`
+
+## Returns
+A new ShapeList in the original order. Empty when nothing passes; no error.
+
+## Faces versus edges
+`filter_by(Z)` is `parallel_to(Z)`, which means different things:
+- edges: straight edges running along Z (the vertical edges of a box);
+- faces: planar faces whose normal is along Z (the top and bottom faces).
+See `parallel_to`. A string selects surface types on faces (`"plane"`, `"cylinder"`, ...) and curve
+types on edges (`"line"`, `"circle"`, ...); see `types`.
+
+## Gotchas
+- `filter_by((0, 0, 1))` and `filter_by(Plane.XY)` do not work: the tuple or plane is treated as
+  a function, `TypeError: 'tuple' object is not callable`. Pass an Axis (`Z`) or call
+  `parallel_to((0, 0, 1))`, which accepts vectors.
+- Unknown type names (`"arc"`, `"cylindrical"`) silently match nothing.
+- A predicate that raises stops the whole selection: `lambda e: e.radius > 2` raises
+  `ValueError: not a circular edge but a line` on the first line. Narrow first:
+  `edges().circles().filter(lambda e: e.radius > 2)`, or test `e.geom_type` in the predicate.
+- Compare floats with a tolerance in predicates (`abs(f.radius - 6) < 1e-6`, `abs(z - 8) < 1e-6`):
+  centers carry noise of about 1e-6 from integration.
+- `filter` is the escape hatch for everything the named selectors cannot say: by length, radius,
+  area, a coordinate range, `is_closed`, distance to a point.
+
+## Useful predicates
+```python
+part = Box(40, 30, 16, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(3, 40) - Cylinder(6, 40).translate(12, 0, 0)
+print(len(part.edges().filter(lambda e: e.geom_type == "line" and e.length > 35)))   # 4
+print(len(part.faces().cylinders().filter(lambda f: abs(f.radius - 3) < 1e-6)))     # 1: holes of r 3
+print(len(part.edges().circles().filter(lambda e: e.is_closed)))                    # 4: full circles only
+print(len(part.edges().filter(lambda e: abs(e.center().z - 8) < 1e-6)))             # 4: edges at z = 8
+```
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(6, 30)
+print(len(part.edges().filter_by(Z)))                        # 4  (= parallel_to(Z))
+print(len(part.edges().filter_by("circle")))                 # 2  (= of_type("circle"))
+print(len(part.faces().filter_by(lambda f: f.area > 700)))   # 5  (= filter(...))
+long_x = part.edges().filter(lambda e: e.geom_type == "line" and e.length > 35)
+print(len(long_x))                                           # 4
+```
+
+## Related
+`parallel_to`, `types` (`of_type`), `generic`.
diff --git a/src/smlibpy/skill/references/selection/parallel_to.md b/src/smlibpy/skill/references/selection/parallel_to.md
new file mode 100644
index 0000000..ac8ca5c
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/parallel_to.md
@@ -0,0 +1,58 @@
+# parallel_to, perpendicular_to
+
+Keep straight edges or planar faces by their direction.
+
+## Signature
+`sl.parallel_to(axis)`, `sl.perpendicular_to(axis)`
+
+- `axis`: an `Axis` (`X`, `Y`, `Z`, `-Z`, `Axis(origin, dir)`) or a vector `(x, y, z)`. Only the
+  direction counts: the sense (`Z` or `-Z`), the length of a vector and the origin of an Axis
+  are ignored.
+
+## What it means
+| Shape | `parallel_to(Z)` keeps | `perpendicular_to(Z)` keeps |
+|---|---|---|
+| straight edge (`geom_type == "line"`) | edges running along Z | edges running across Z (horizontal) |
+| planar face (`geom_type == "plane"`) | faces whose **normal** is along Z: top and bottom | faces whose normal is across Z: vertical walls |
+| Sketch in the list | sketches whose plane normal is along Z | sketches standing upright |
+| circle, ellipse, bspline edge | never | never |
+| cylinder, cone, any curved face | never | never |
+| vertex | never | never |
+
+So for faces the words are about the normal: `faces().parallel_to(Z)` are the horizontal faces,
+`faces().perpendicular_to(Z)` the vertical planar walls. For edges they are about the edge itself.
+
+## Returns
+A ShapeList in the original order; shapes that do not qualify are dropped without error.
+
+## Tolerance
+The angle tolerance is 1e-4 degrees and cannot be changed. A box rotated by 1e-4° about X still
+matches, one rotated by 2e-4° does not. For "roughly vertical" use a predicate with an angle
+tolerance in degrees (`is_parallel` accepts both senses):
+```python
+tilted = Box(10, 10, 10).rotate(X, 0.5)
+print(len(tilted.edges().parallel_to(Z)))                                              # 0
+print(len(tilted.edges().lines().filter(lambda e: e.direction.is_parallel(Z.direction, 1))))   # 4
+```
+
+## Gotchas
+- Circles lying flat are not `perpendicular_to(Z)`: only straight edges count.
+- A vertical cylinder wall is in neither `parallel_to(Z)` nor `perpendicular_to(Z)`.
+- After `chamfer` (also `loft`, `ruled`, `to_nurbs`) many straight edges are `bspline` curves and
+  are dropped: `Box(20, 20, 10).chamfer(vertical edges, 2).edges().parallel_to(Z)` returns 0
+  edges although 8 vertical edges exist. Select those by position or with `filter`.
+- Faces converted to NURBS (`to_nurbs()`, many STEP imports) are `bspline`, never planar here.
+- `parallel_to` does not look at the sense of a face normal; use `facing(Z)` for faces pointing up.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(6, 30)
+print(len(part.faces().parallel_to(Z)))        # 2: top and bottom (normal along Z)
+print(len(part.faces().perpendicular_to(Z)))   # 4: the planar side walls
+print(len(part.edges().parallel_to(Z)))        # 4: the vertical edges
+print(len(part.edges().perpendicular_to(Z)))   # 8: horizontal lines (circles excluded)
+print(len(part.faces().parallel_to((0, 0, -1))))   # 2: the sense does not matter
+```
+
+## Related
+`spatial` (`facing`, with a sense and an angle), `filter_by`, `types`, `generic`.
diff --git a/src/smlibpy/skill/references/selection/types.md b/src/smlibpy/skill/references/selection/types.md
new file mode 100644
index 0000000..3c4fe16
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/types.md
@@ -0,0 +1,64 @@
+# of_type, planar, cylinders, lines, circles
+
+Keep faces or edges by the kind of their underlying surface or curve (`geom_type`).
+
+## Signature
+- `sl.of_type(*names)`: one or more names, case-insensitive: `of_type("plane", "cylinder")`.
+- Shortcuts: `planar()` = `of_type("plane")`, `cylinders()` = `of_type("cylinder")`,
+  `lines()` = `of_type("line")`, `circles()` = `of_type("circle")`.
+- `smooth()` is not a type filter; see `convexity`.
+
+## Names
+Face `geom_type`:
+
+| Name | Made by |
+|---|---|
+| `plane` | flat faces of primitives, extrusions, cuts, chamfers |
+| `cylinder` | `Cylinder`, holes, fillets along straight edges |
+| `cone` | `Cone` |
+| `sphere` | `Sphere`, fillet corners where three rounded edges meet |
+| `torus` | `Torus` |
+| `extrusion` | extruding a profile with a spline or ellipse edge (the side faces) |
+| `revolution` | revolving a profile with a spline edge |
+| `bspline` | `loft`, `surface`, `ruled`, sweeps, `to_nurbs()`, many STEP imports |
+| `offset` | `offset()` of an extrusion or bspline face |
+| `other` | anything the kernel cannot name |
+
+Edge `geom_type`:
+
+| Name | Made by |
+|---|---|
+| `line` | straight edges of primitives, extrusions, cuts |
+| `circle` | full circles and arcs: rims, fillet arcs, `CenterArc` |
+| `ellipse` | `Ellipse`, `EllipticalArc`, a plane cutting a cylinder at an angle, two equal crossing cylinders |
+| `bspline` | splines, chamfer borders, `loft`, `ruled`, sweeps, `to_nurbs()` |
+| `other` | anything the kernel cannot name |
+
+## Returns
+A ShapeList in the original order. Shapes without `geom_type` (vertices, parts) are dropped.
+
+## Gotchas
+- Unknown names match nothing and raise nothing: `of_type("arc")`, `of_type("cylindrical")` → `[]`.
+  Arcs are `"circle"`.
+- `circles()` returns arcs too. Fillet arcs and hole rims look alike: filter full circles with
+  `e.is_closed`, or by `e.radius`.
+- `cylinders()` returns fillet faces and holes alike; filter by `f.radius` or position.
+- A straight edge is not always `"line"`: chamfer borders, `ruled(Line, Line)` and edges of
+  `to_nurbs()` bodies are `"bspline"`. A flat face is not always `"plane"`: `to_nurbs()` and
+  `surface()` faces are `"bspline"` even when flat.
+- `Cone(5, 5, 10)` (equal radii) has a `"cylinder"` face.
+- `lines()` on faces and `planar()` on edges return empty lists, no error.
+
+## Example
+```python
+p = Box(20, 20, 10).fillet(Box(20, 20, 10).edges().parallel_to(Z), 3) - Cylinder(3, 20)
+print(len(p.faces().planar()), len(p.faces().cylinders()))   # 6 5: 4 fillets + the hole
+print(len(p.faces().of_type("plane", "cylinder")))           # 11
+print(len(p.edges().circles().top()))                        # 5: 4 fillet arcs + the hole rim
+hole_rims = p.edges().circles().filter(lambda e: e.is_closed)
+print(len(hole_rims))                                        # 2
+print(p.edges().of_type("arc"))                              # ShapeList([]): unknown name, no error
+```
+
+## Related
+`filter_by`, `parallel_to`, `Face` (`geom_type`, `radius`), `Edge` (`geom_type`, `radius`), `generic`.
diff --git a/src/smlibpy/skill/references/selection/convexity.md b/src/smlibpy/skill/references/selection/convexity.md
new file mode 100644
index 0000000..0d8c730
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/convexity.md
@@ -0,0 +1,57 @@
+# convex, concave, smooth, Edge.convexity, Edge.is_convex
+
+Classify edges by the corner the two faces make there.
+
+## Signature
+- `sl.convex()`, `sl.concave()`, `sl.smooth()`: keep edges of that kind; other shapes are dropped.
+- `edge.convexity`: property, `"convex"`, `"concave"` or `"smooth"`.
+- `edge.is_convex()`: a method (call it), `edge.convexity == "convex"`.
+
+## Meaning
+- `convex`: outside corner, the material angle is below 180°. Box edges, the top rim of a boss,
+  and also the rims of holes (the material corner at a hole rim is 90°).
+- `concave`: inside corner, material angle above 180°. The inner corner of an L, the floor edges
+  and vertical corners of a pocket, the base circle where a boss meets a plate, the inner edges of
+  a shelled box.
+- `smooth`: the two face normals at the edge midpoint differ by less than 0.5°. The borders of a
+  fillet; a kink of 0.4° counts as smooth, 0.6° does not.
+- Edges with fewer or more than two faces count as `convex`: sketch edges, sheet borders, free
+  edges (`Line(...)`).
+
+The test is made at the edge midpoint only.
+
+| Body | convex | concave | smooth |
+|---|---|---|---|
+| `Box` | 12 | 0 | 0 |
+| L of two boxes | 17 | 1 | 0 |
+| block with a rectangular pocket | 16 | 8 | 0 |
+| block with a through hole | 14 | 0 | 0 |
+| plate + cylindrical boss | 13 | 1 (base circle) | 0 |
+| block, 4 vertical edges filleted | 16 | 0 | 8 |
+| block shelled, top open | 16 | 8 | 0 |
+
+## Use for fillets
+- `part.fillet(part.edges().concave(), r)` rounds inside corners and adds material.
+- `part.fillet(part.edges().convex(), r)` rounds outside corners and removes material.
+- `fillet` and `chamfer` skip smooth edges; a selection of only smooth edges raises
+  `ValueError: fillet: the selection holds only seam or smooth edges, nothing to fillet`.
+- After a fillet the new borders are smooth, so a second `edges().concave()` does not pick them up.
+
+## Gotchas
+- Hole rims are convex, not concave: `edges().concave()` does not find holes.
+- Chamfer edges stay convex (a 45° chamfer makes two 135° corners).
+- Shallow kinks below 0.5° (e.g. from slightly tilted faces) count as smooth and cannot be
+  filleted.
+
+## Example
+```python
+L = Box(20, 10, 10, align=Align.MIN) + Box(10, 10, 20, align=Align.MIN)
+print(len(L.edges().convex()), len(L.edges().concave()))   # 17 1
+inner = L.edges().concave().one()
+print(inner.convexity, inner.is_convex())                  # concave False
+L2 = L.fillet(L.edges().concave(), 2)                      # adds material in the corner
+print(round(L2.volume - L.volume, 3), len(L2.edges().smooth()))   # 8.584 2
+```
+
+## Related
+`Edge`, `types`, `generic`, `fillet` and `chamfer` (features domain).
diff --git a/src/smlibpy/skill/references/selection/sort_by.md b/src/smlibpy/skill/references/selection/sort_by.md
new file mode 100644
index 0000000..9f16649
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/sort_by.md
@@ -0,0 +1,63 @@
+# sort_by, sort_by_distance, group_by, sort, reverse
+
+Order a selection, or split it into groups of equal key.
+
+## Signature
+- `sl.sort_by(key=Z, reverse=False)` → ShapeList, ascending.
+- `sl.sort_by_distance(point, reverse=False)` → ShapeList, nearest center first.
+- `sl.group_by(key=Z, tol=1e-4)` → a plain `list` of ShapeLists, lowest key first.
+- Operators: `sl > key` = `sort_by(key)`, `sl < key` = `sort_by(key, reverse=True)`,
+  `sl >> key` = `max_by(key)`, `sl << key` = `min_by(key)`.
+
+## Keys
+| Key | Sorts by |
+|---|---|
+| `X`, `Y`, `Z`, `-Z`, any `Axis` | position of `center()` along the axis direction (`-Z`: highest first) |
+| `"x"`, `"y"`, `"z"` (any case) | same as the axis |
+| `"area"` | faces (and Parts) |
+| `"length"` | edges and wires |
+| `"volume"` | Parts (`solids()`) |
+| `"radius"` | circular edges, cylinder/cone/sphere/torus faces |
+| `"size"` / `"measure"` | volume, else area, else length (mixed lists) |
+| a function `f(shape) -> number` | anything |
+
+Positions use `center()`: the centroid of a face, the midpoint of an edge (see `positional`).
+
+## Errors
+- `sort_by((1, 0, 0))`: `TypeError: cannot sort by (1, 0, 0)`; pass `Axis((0, 0, 0), (1, 0, 0))` or
+  a function. Unknown strings: `TypeError: cannot sort by 'foo'`.
+- `sort_by("distance")`: `ValueError: use .sort_by_distance(point)`.
+- A key that does not apply raises: `"area"` on edges `AttributeError: 'Edge' object has no attribute
+  'area'`; `"radius"` on a list with planar faces `ValueError: a plane face has no radius`. Narrow
+  first (`circles().sort_by("radius")`).
+
+## group_by
+- Groups hold shapes whose key is within `tol` of the group's first (smallest) key. Values
+  0, 6e-5, 1.2e-4, 1.8e-4 with tol 1e-4 make two groups, [0, 6e-5] and [1.2e-4, 1.8e-4].
+- `group_by(Z)[-1]` is `max_by(Z)`, `group_by(Z)[0]` is `min_by(Z)`.
+- Edges of `Box(10, 20, 30)` by `"length"`: three groups of 4.
+- Use it to pick "the second level from the top": `part.faces().planar().group_by(Z)[-2]`.
+
+## Gotchas
+- `sort()` and `reverse()` are Python's in-place list methods. They return `None`:
+  `faces = part.faces().reverse()` sets `faces` to None. Use `sort_by(..., reverse=True)` or `[::-1]`.
+- `sorted(sl)` returns a plain list without selectors.
+- Ties keep their input order (the sort is stable). That order is the kernel's; do not rely on it.
+- `sort_by_distance` and `nearest` measure to `center()`, not to the nearest point of the shape.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(6, 30) - Cylinder(2, 30).translate(14, 0, 0)
+faces = part.faces()
+print([round(f.area, 1) for f in faces.sort_by("area")][-2:])   # [1074.3, 1074.3]
+print(round(faces.sort_by(Z, reverse=True).first.center().z, 3))  # 10.0
+groups = part.edges().group_by(Z)
+print([(round(g[0].center().z, 3), len(g)) for g in groups])    # [(-10.0, 6), (0.0, 4), (10.0, 6)]
+radii = part.edges().circles().group_by("radius")
+print([(round(g[0].radius, 1), len(g)) for g in radii])         # [(2.0, 2), (6.0, 2)]
+corner = part.vertices().sort_by_distance((20, 15, 10)).first
+print(corner)                                                   # Vertex(20, 15, 10)
+```
+
+## Related
+`extremes` (`max_by`, `min_by`, `largest`), `positional`, `spatial` (`nearest`), `generic`.
diff --git a/src/smlibpy/skill/references/selection/extremes.md b/src/smlibpy/skill/references/selection/extremes.md
new file mode 100644
index 0000000..74413dc
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/extremes.md
@@ -0,0 +1,55 @@
+# largest, smallest, min_by, max_by, first, last, one, at
+
+Pick the extreme shapes, one shape, or the shapes at a point.
+
+## Signature
+- `sl.largest()`, `sl.smallest()` → one shape, by volume, else area, else length.
+- `sl.max_by(key=Z, tol=1e-4)`, `sl.min_by(key=Z, tol=1e-4)` → ShapeList of every shape tying for
+  the largest / smallest key. Keys as in `sort_by` (`Z`, `"area"`, `"length"`, `"radius"`, a function).
+- `sl.first`, `sl.last` → properties (no parentheses), the first / last element.
+- `sl.one()` → the only element; raises unless there is exactly one.
+- `sl.at(point, tol=1e-4)` → ShapeList of the shapes passing through `point` (distance ≤ tol).
+
+## Returns and ties
+| Call | Returns | On a tie | On an empty list |
+|---|---|---|---|
+| `largest()` / `smallest()` | one shape | the first in list order | `IndexError: empty selection` |
+| `max_by()` / `min_by()` | ShapeList | all tied shapes | empty ShapeList |
+| `first` / `last` | one shape | - | `IndexError: empty selection` |
+| `one()` | one shape | `ValueError: expected exactly one shape, got 2 - narrow the selection or use [0]` | `ValueError: ... got 0` |
+| `at(p)` | ShapeList | all shapes through p | empty ShapeList |
+
+`largest()` on a box with a hole: one of the two equal faces (top and bottom tie, list order
+decides). Use `max_by("area")` to see the tie, then narrow (`.top()`).
+
+## at(point)
+- Vertices at the point, edges and faces touching it: at a box corner 1 vertex, 3 edges, 3 faces.
+- Point on a hole rim: the planar face and the cylinder face.
+- `tol` is absolute: 1e-5 off is found, 1e-3 off is not (`tol=0.01` finds it).
+- A point in the opening of a hole touches no face.
+- On `solids()` the distance is to the boundary: a point inside a solid is not "at" it.
+
+## Gotchas
+- `largest()` compares volume, area or length, whichever the shape has: on a mixed list of faces
+  and edges it compares areas with lengths. Vertices all measure 0: the first one wins.
+- `max_by(key, tol=...)` groups like `group_by`: with a large `tol` more shapes join the top group.
+- `first` and `last` depend on list order, which is the kernel's. Sort first (`sort_by(X).last`).
+- `one()` is the right tool when a feature needs exactly one face: it fails loudly at the
+  selection instead of later.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(6, 30)
+print(part.faces().largest())                        # Face(plane, area=1086.9, ...) one face
+print(len(part.faces().max_by("area")))              # 2: top and bottom tie
+print(len(part.edges().min_by("length")))            # 4: the vertical edges (20)
+print(part.vertices().at((20, 15, 10)))              # ShapeList([Vertex(20, 15, 10)])
+print(len(part.edges().at((20, 15, 10))))            # 3
+try:
+    part.faces().parallel_to(Z).one()
+except ValueError as e:
+    print(e)   # expected exactly one shape, got 2 - narrow the selection or use [0]
+```
+
+## Related
+`positional` (`top`, ... = `max_by`/`min_by` of an axis), `sort_by`, `spatial`, `generic`.
diff --git a/src/smlibpy/skill/references/selection/spatial.md b/src/smlibpy/skill/references/selection/spatial.md
new file mode 100644
index 0000000..19c3538
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/spatial.md
@@ -0,0 +1,52 @@
+# nearest, within, facing
+
+Select by distance to a point, by a bounding region, or by the direction a face points.
+
+## Signature
+- `sl.nearest(point)` → one shape: the one whose `center()` is closest to `point`.
+- `sl.within(box)` → ShapeList of shapes whose bounding box lies inside `box` (a `BoundBox`).
+- `sl.facing(direction, max_angle=1e-3)` → ShapeList of faces whose outward normal is within
+  `max_angle` degrees of `direction` (an Axis or a vector; its length is ignored).
+
+## nearest: centers, not surfaces
+`nearest` compares centers (face centroid, edge midpoint), not the true distance. For
+`Box(100, 10, 10)` and a point 1 mm above the top face near the right end, `nearest` returns the
+end face (center 6.1 away) and not the top face (1 mm away, but its center is 49 away). For the
+truly closest shape sort by `distance_to`:
+`sl.sort_by(lambda s: s.distance_to(p)).first`. On an empty list `nearest` raises
+`IndexError: list index out of range`.
+
+## within
+- Takes a `BoundBox(min_corner, max_corner)`; a tuple of points raises
+  `AttributeError: 'tuple' object has no attribute 'contains'`.
+- The whole bounding box of the shape must be inside (tolerance 1e-6). A face that crosses the box
+  border is left out: the half-space x ≥ 0 of a centered bar contains only its right end face.
+- `faces().within(part.bbox())` returns every face.
+
+## facing
+- Faces only; edges and vertices are dropped.
+- Outward means out of the material: the wall of a hole faces towards the hole's axis.
+- The sense counts: `facing(Z)` is the faces pointing up, `facing(-Z)` the faces pointing down.
+  Compare `parallel_to(Z)`, which takes both.
+- The default `max_angle` (1e-3°) means "exactly". Pass a larger angle for inclined faces:
+  a wedge's slope (normal 26.6° from Z) is found with `facing(Z, max_angle=60)`.
+- Curved faces are judged by the normal at the projection of their centroid. For a half cylinder
+  that is the middle of the face (works). For a full cylinder, sphere or torus face the centroid
+  lies on the axis and the normal is arbitrary: do not use `facing` on them. Use
+  `faces().planar().facing(d)` when you mean flat faces.
+
+## Example
+```python
+bar = Box(100, 10, 10)
+p = (49, 0, 6)                                         # 1 mm above the top face
+print(bar.faces().nearest(p).center())                 # (50, 0, 0): the end face, center closest
+true = bar.faces().sort_by(lambda f: f.distance_to(p)).first
+print(true.center())                                   # (0, 0, 5): the top face, 1 mm away
+right_half = BoundBox((0, -100, -100), (100, 100, 100))
+print(len(bar.faces().within(right_half)))             # 1: only the end face lies fully inside
+w = Wedge(20, 20, 10)
+print(len(w.faces().facing(Z)), len(w.faces().facing(Z, max_angle=60)))   # 0 1
+```
+
+## Related
+`extremes` (`at`), `sort_by` (`sort_by_distance`), `parallel_to`, `Face.normal_at`, `generic`.
diff --git a/src/smlibpy/skill/references/selection/list_transforms.md b/src/smlibpy/skill/references/selection/list_transforms.md
new file mode 100644
index 0000000..b66a6b6
--- /dev/null
+++ b/src/smlibpy/skill/references/selection/list_transforms.md
@@ -0,0 +1,46 @@
+# ShapeList.translate, rotate, moved, on, copy, append, extend
+
+Move many shapes at once, and use a ShapeList as an ordinary list.
+
+## Signature
+- `sl.translate(x=0, y=0, z=0)` or `sl.translate((x, y, z))`
+- `sl.rotate(axis=Z, angle=0)`: degrees about an Axis through its origin. The default angle 0
+  returns unmoved copies.
+- `sl.moved(location)`: e.g. `sl.moved(Pos(0, 0, 10))`
+- `sl.on(plane_or_face)`: every shape, drawn around the world XY origin, placed onto the plane or
+  face (see `Shape.on`).
+- List methods: `append`, `extend`, `insert`, `remove`, `pop`, `index`, `count` work in place.
+
+## Returns
+Each transform returns a new ShapeList of moved copies; the input is unchanged.
+
+## Gotchas
+- `Pos(...) * sl`, `Rot(...) * sl` and `Plane * sl` return a plain `list` (no selectors). The
+  shapes are moved correctly; wrap the result in `ShapeList(...)` or use `sl.moved(Pos(...))`.
+- `sl.copy()` returns a plain `list` too. Shapes are immutable, so a copy is rarely needed:
+  `ShapeList(sl)` when you want one.
+- `sl + [x]` is a ShapeList, `[x] + sl` a plain list.
+- There is no `scale` or `mirror` on a ShapeList: `ShapeList(s.mirror() for s in sl)`.
+- A moved face becomes a face of a new Shell, a moved edge a free edge: they are no longer part
+  of the body. `part.fillet(part.edges().top().translate(0, 0, 5), 1)` raises
+  `ValueError: Edge(...) is not an edge of this part`.
+- Location patterns (`GridLocations(...) * part`, `PolarLocations(...) * part`) already return
+  a ShapeList.
+- A list of parts can be subtracted or fused directly: `plate - holes`.
+
+## Example
+```python
+plate = Box(60, 40, 10)
+pins = ShapeList([Cylinder(3, 20), Cylinder(3, 20).translate(20, 0, 0)])
+moved = pins.translate(-10, 0, 0)                      # new ShapeList of moved copies
+print([round(p.center().x, 3) for p in moved])         # [-10.0, 10.0]
+print(type(pins.rotate(Z, 90)).__name__)               # ShapeList
+plate -= moved                                         # a list on the right of - is fine
+print(len(plate.faces().cylinders()))                  # 2
+marks = ShapeList([Circle(2), Circle(2).translate(10, 0, 0)]).on(plate.faces().top())
+print([round(m.center().z, 3) for m in marks])         # [5.0, 5.0]
+print(type(Pos(1, 0, 0) * pins).__name__, type(pins.copy()).__name__)   # list list
+```
+
+## Related
+`generic`, `Location`, `Pos`, `Rot`, `GridLocations`, `PolarLocations` (geometry domain).
