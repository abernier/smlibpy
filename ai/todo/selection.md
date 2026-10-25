# Defects and surprises: selection

## HIGH

## MEDIUM

### 1. `chamfer` (and loft, ruled, to_nurbs): straight edges come out as `bspline`, so line selectors miss them
- **Fixed:** lines(), parallel_to and perpendicular_to recognise straight B-spline edges (control points on a line).
- **Session:** `2026-10-12_21-26-09_selection-shapelist`, scripts `07-types.py`, `08-chamfer-edge-types.py`
- **What happens:** after `Box(20, 20, 10).chamfer(box.edges().parallel_to(Z), 2)` 16 of the 24 edges
  are straight (length = chord) but have `geom_type == "bspline"`. `edges().parallel_to(Z)` returns 0
  edges and `lines()` only the 8 untouched edges. The same holds for `ruled(Line, Line)`.
- **Expected:** straight edges reported as `"line"` (or `parallel_to`/`lines()` that recognise straight
  bspline edges), so that `part.edges().parallel_to(Z)` keeps working after a chamfer.
- **Reproduce:**
  ```python
  box = Box(20, 20, 10)
  c = box.chamfer(box.edges().parallel_to(Z), 2)
  print(len(c.edges().parallel_to(Z)))   # 0, expected 8
  ```
- **Workaround:** select by position or with a predicate:
  `c.edges().filter(lambda e: abs(e.length - e.start.distance_to(e.end)) < 1e-9 and (e.end - e.start).normalized().is_parallel((0, 0, 1)))`.

### 2. `Face.is_planar` is False for exactly flat bspline faces
- **Fixed:** is_planar is True when all control points lie in one plane.
- **Session:** `2026-10-12_21-32-59_selection-face-edge-vertex`, script `03-is-planar-bspline.py`
- **What happens:** a flat `surface()` (all points at z=0), a flat `ruled()` of two lines and the top
  face of `Box(10, 10, 10).to_nurbs()` (bbox z 5..5) all report `is_planar == False`. As a consequence
  `face.plane`, `sketch.on(face)`, `face.to_sketch()` and `face.extrude()` raise
  `ValueError: a bspline face has no plane`. Imported STEP faces stored as NURBS are affected the same way.
- **Expected:** `is_planar` True when the surface is flat within tolerance (the docstring of `plane` and
  `is_planar` suggests a geometric test, the code calls `surface().is_planar(1e-7)`).
- **Reproduce:**
  ```python
  f = Box(10, 10, 10).to_nurbs().faces().top().one()
  print(f.geom_type, f.is_planar)   # bspline False
  ```
- **Workaround:** none for `.plane`; build the plane by hand: `Plane(f.center(), z_dir=f.normal_at())`.

### 3. `Edge.intersections` raises when the edges do not meet
- **Fixed:** an empty list; the tolerance is 1e-6 or 1e-9 of the size (it was 0.001 absolute), overlaps give both
  ends, and faces, bodies and wires are taken too (kernel plan C5).
- **Session:** `2026-10-12_21-32-59_selection-face-edge-vertex`, script `05-edge-methods.py`
- **What happens:** parallel lines, skew lines, lines whose extensions would cross, a circle and a far
  line: `KernelError: edge intersections failed (SM_ERR)`.
- **Expected:** an empty list (the docstring says "Points where this edge crosses another edge").
- **Reproduce:**
  ```python
  Line((0, 0, 0), (10, 10, 0)).intersections(Line((1, 0, 0), (11, 10, 0)))   # KernelError
  ```
- **Workaround:** `try: pts = a.intersections(b) except KernelError: pts = []`.

### 4. `facing()` and `Face.normal_at()` are arbitrary on closed curved faces
- **Session:** `2026-10-12_21-26-09_selection-shapelist`, script `13-spatial.py`; second session `01-face-props.py`
- **What happens:** without a point, `normal_at()` evaluates at the projection of the area centroid.
  For a full cylinder, sphere or torus face the centroid lies on the axis/center, so the projection is
  ill-defined: `Cylinder(10, 20)` side face gave (−0.98, 0.19, 0), `Sphere(5)` gave (−0.33, 0.94, 0.04).
  `facing(d)` uses this normal, so a full cylinder face may or may not be picked depending on noise of
  about 1e-6 in the centroid.
- **Expected:** `facing` should skip faces whose normal varies (or judge them by the whole face), and
  `normal_at()` without a point should raise for faces without a defined center normal.
- **Reproduce:**
  ```python
  print(Cylinder(10, 20).faces().cylinders().one().normal_at())   # some direction in XY
  ```
- **Workaround:** use `facing` only for planar faces (`faces().planar().facing(d)`), and pass a point
  on the face to `normal_at(point)`.

### 5. Position selectors on edges use the midpoint along the curve; for closed circles that point depends on the seam
- **Session:** `2026-10-12_21-26-09_selection-shapelist`, script `02-positional.py`
- **What happens:** `Edge.center()` is `point_at(0.5)`. For a full circle this is the point opposite
  the circle's start, not its center. On a cylinder lying along X (`Cylinder(10, 40).rotate(Y, 90)`)
  both rims have their midpoint at z=+10, so `edges().top()` returns both rims and `edges().bottom()`
  returns none.
- **Expected:** closed edges judged by their `arc_center` (or by their bbox center), so that `top()`
  of the rims of a horizontal cylinder returns both and `bottom()` both too, and `right()` the +X rim.
- **Reproduce:**
  ```python
  c = Cylinder(10, 40).rotate(Y, 90)
  print(len(c.edges().top()), len(c.edges().bottom()))   # 2 0
  ```
- **Workaround:** sort circles by `arc_center`: `edges().circles().sort_by(lambda e: e.arc_center.x)`.

## LOW

### 6. `fillet`/`chamfer` with an empty selection: misleading message
- **Session:** `2026-10-12_21-26-09_selection-shapelist`, script `03-empty.py`
- **What happens:** `box.fillet(box.edges().circles(), 1)` → `ValueError: fillet: the selection holds
  only seam or smooth edges, nothing to fillet`.
- **Expected:** "the selection is empty" so that the agent looks at its selector, not at seams.
- **Reproduce:** `Box(20, 20, 10).fillet(ShapeList(), 1)`

### 7. `filter_by` with a vector, tuple or Plane: unhelpful TypeError
- **Session:** `2026-10-12_21-26-09_selection-shapelist`, script `06-parallel.py`
- **What happens:** `faces().filter_by((0, 0, 1))` → `TypeError: 'tuple' object is not callable`;
  `filter_by(Plane.XY)` → `'Plane' object is not callable`. `parallel_to((0, 0, 1))` accepts the tuple.
- **Expected:** accept a vector like `parallel_to` does, or say "filter_by takes an Axis, a type name
  or a function". `filter_by(Plane)` is not supported either.
- **Reproduce:** `Box(1, 1, 1).faces().filter_by((0, 0, 1))`

### 8. `of_type` accepts unknown type names silently
- **Session:** `2026-10-12_21-26-09_selection-shapelist`, script `07-types.py`
- **What happens:** `edges().of_type("arc")` and `faces().of_type("cylindrical")` return empty lists.
- **Expected:** a ValueError listing the valid names (plane, cylinder, cone, sphere, torus, revolution,
  extrusion, bspline, offset, other; line, circle, ellipse, bspline, other).
- **Reproduce:** `print(Cylinder(1, 1).edges().of_type("arc"))   # ShapeList([])`

### 9. `ShapeList.copy()` and `Location * ShapeList` return a plain list
- **Session:** `2026-10-12_21-26-09_selection-shapelist`, script `14-list-transforms.py`
- **What happens:** `sl.copy()` is a `list` without selectors; `Pos(5, 0, 0) * sl` is a `list`
  (Location.__mul__ handles lists before ShapeList.__rmul__ runs). `[x] + sl` is a list too (Python).
- **Expected:** ShapeList.
- **Reproduce:** `print(type(Box(1, 1, 1).faces().copy()), type(Pos(1, 0, 0) * Box(1, 1, 1).faces()))`
- **Workaround:** `ShapeList(...)` around the result, or `sl.moved(Pos(...))`.

### 10. `nearest()` compares centers, docs say "closest"
- **Session:** `2026-10-12_21-26-09_selection-shapelist`, script `13-spatial.py`
- **What happens:** for `Box(100, 10, 10)` and the point (49, 0, 6), 1 mm above the top face,
  `faces().nearest(p)` is the end face at x=50 (center distance 6.1, true distance 1.41), not the top
  face (true distance 1). The docstring says "whose center is closest", `docs/selecting.md` says
  "the shape closest to a point". On an empty list it raises `IndexError: list index out of range`
  (other pickers say "empty selection").
- **Expected:** docs/selecting.md to say "center closest", or a `nearest` by true distance.
- **Workaround:** `sl.sort_by(lambda s: s.distance_to(p)).first`.

### 11. `Edge.intersections` reports the start point of a closed curve twice
- **Fixed:** points within the tolerance of each other count once (kernel plan C5).
- **Session:** `2026-10-12_21-32-59_selection-face-edge-vertex`, script `05-edge-methods.py`
- **What happens:** `Circle(5).edges().one().intersections(Line((-10, 0, 0), (10, 0, 0)))` →
  `[(-5,0,0), (5,0,0), (5,0,0)]`.
- **Expected:** each point once.

### 12. `Vertex`: equal vertices with different hashes
- **Session:** `2026-10-12_21-32-59_selection-face-edge-vertex`, script `07-vertex-hash.py`
- **What happens:** a part vertex and `Vertex(5, 5, 5)` compare equal but hash differently:
  `len({corner, Vertex(5, 5, 5)}) == 2`; `ShapeList([corner, free]).vertices()` keeps both.
- **Expected:** consistent `__hash__` and `__eq__`.

### 13. `within()` takes only a BoundBox
- **Session:** `2026-10-12_21-26-09_selection-shapelist`, script `13-spatial.py`
- **What happens:** `faces().within(((0, -100, -100), (100, 100, 100)))` →
  `AttributeError: 'tuple' object has no attribute 'contains'`.
- **Expected:** accept two corner points, or a clear TypeError.
