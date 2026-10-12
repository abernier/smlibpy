# Defects and surprises: geometry

## HIGH

## MEDIUM

### 1. `Locations.on(face)` returns a plain list; multiplying it with a shape fails
- **Session:** `2026-10-12_21-38-45_geometry-patterns`, script `01-locations.py`
- **What happens:** `GridLocations(10, 10, 2, 2).on(face)` returns a `list` (via
  `Location.__mul__`, which turns any list into a plain list), so
  `GridLocations(...).on(face) * Circle(1)` raises
  `TypeError: can't multiply sequence by non-int of type 'Sketch'`.
- **Expected:** the docstring says "The pattern placed onto a plane or face" with return type
  `Locations`; the result should multiply with shapes.
- **Reproduce:**
  ```python
  top = Box(30, 20, 10).faces().top()
  GridLocations(10, 10, 2, 2).on(top) * Circle(1)
  ```
- **Workaround:** `(GridLocations(...) * Circle(1)).on(top)`.

### 2. `Location * Locations`, `Plane * Locations`, `Location * ShapeList` lose their type
- **Session:** `2026-10-12_21-38-45_geometry-patterns`, script `01-locations.py`
- **What happens:** `Location.__mul__` and `Plane.__mul__` check `isinstance(other, list)`
  before `Locations.__rmul__`/`ShapeList` can act, and return a plain `list`. So
  `Pos(0, 0, 10) * GridLocations(10, 10, 2, 2) * Box(1, 1, 1)` raises
  `TypeError: can't multiply sequence by non-int of type 'Part'`, and
  `Pos(...) * (locs * shape)` returns a list without `.bbox()`, `.on()`, `.translate()`.
- **Expected:** `Location * Locations -> Locations`, `Location * ShapeList -> ShapeList`
  (Locations has an `__rmul__` for exactly this, it is never reached).
- **Reproduce:** `Pos(0, 0, 10) * GridLocations(10, 10, 2, 2) * Box(1, 1, 1)`
- **Workaround:** `GridLocations(...) * Pos(0, 0, 10) * Box(...)` or
  `(GridLocations(...) * Box(...)).translate(0, 0, 10)`.

### 3. Non-uniform `scale` turns every face into a bspline, flat faces included
- **Session:** `2026-10-12_21-32-20_geometry-placement`, scripts `07-scale.py`, `22-scaled-selection.py`
- **What happens:** `Box(10, 10, 10).scale((2, 1, 1))` has only `bspline` faces;
  `.faces().planar()` is empty, `face.is_planar` is False, `Circle(1).on(face)` raises
  `ValueError: a bspline face has no plane`. A scaled cylinder loses `cylinders()`,
  `circles()`, `radius`.
- **Expected:** planes stay planes under any affine map; cylinders scaled across their axis
  become elliptic (bspline is fine there), but flat faces and straight edges should keep
  their type, or at least `is_planar` should detect flat bspline faces.
- **Reproduce:** `print({f.geom_type for f in Box(10, 10, 10).scale((2, 1, 1)).faces()})`
- **Workaround:** build the final size directly instead of scaling per axis.

### 4. `scale(0)` / a zero per-axis factor gives a degenerate body that reports valid
- **Session:** `2026-10-12_21-32-20_geometry-placement`, script `07-scale.py`
- **What happens:** `Box(10, 10, 10).scale(0)`: bbox NaN, volume 0, `is_valid()` True.
  `scale((1, 1, 0))`: flat body, `is_valid()` True. No error.
- **Expected:** `ValueError` for a zero factor (the matrix is singular).
- **Reproduce:** `b = Box(10, 10, 10).scale(0); print(b.bbox(), b.volume, b.is_valid())`

### 5. A mirrored sketch flips its normal; extrude then goes the other way
- **Session:** `2026-10-12_21-32-20_geometry-placement`, scripts `08-mirror.py`, `09-sketch-mirror-extrude.py`
- **What happens:** `Sketch._transformed` sets `z = x' × y'`; under a reflection in a plane
  perpendicular to the sketch this is the opposite of the reflected normal. 
  `Polygon((0,0),(10,0),(10,4),(0,8)).mirror(Plane.YZ).extrude(5)` spans z -5..0.
  `half.mirror(Plane.YZ) + half` extrudes down, `half + half.mirror(Plane.YZ)` up.
- **Expected:** a sketch in XY mirrored about YZ still lies in XY and should extrude +Z
  (the user mirrored the outline, not the side). Keep the reflected normal and flip x
  instead, or keep the normal when the mirror plane contains it.
- **Reproduce:** see above.
- **Workaround:** put the unmirrored sketch first in the union, or mirror the extruded part.

### 6. `bbox()` of standalone curves is sampled and can be too small
- **Session:** `2026-10-12_21-32-20_geometry-placement`, scripts `01-bbox.py`, `02-bbox-tight.py`
- **What happens:** `Edge.bbox()` without a kernel edge samples 33 points.
  `CenterArc((0, 0), 10, 10, 90).bbox().max.y` = 9.99762 (true 10);
  `Spline((0, 0), (10, 10), (20, -10), (30, 0)).bbox().max.y` = 10.463 (true 10.533).
  The `Shape.bbox` docstring says "Tight axis-aligned bounding box".
- **Expected:** tight (the kernel has curve extents; arcs have closed-form extremes), or a
  conservative box that is never smaller than the curve.
- **Reproduce:** `print(CenterArc((0, 0), 10, 10, 90).bbox().max.y)`
- **Workaround:** make a face/body first, or sample `point_at` densely.

### 7. `Shape.rotate`, `Sketch.revolve`, `Location.about`: tuples and swapped arguments give AttributeErrors
- **Session:** `2026-10-12_21-27-02_geometry-values`, scripts `03-axis.py`, `16-axis-accepted.py`; `2026-10-12_21-32-20_geometry-placement`, script `06-rotate.py`
- **What happens:** `part.rotate((0, 0, 1), 90)` -> `AttributeError: 'tuple' object has no
  attribute 'direction'`; `part.rotate(45)` and `part.rotate(90, Z)` ->
  `AttributeError: 'int' object has no attribute 'direction'`; `sketch.revolve((0, 1, 0))` ->
  `AttributeError: 'tuple' object has no attribute 'origin'`; `Location.about((0, 0, 1), 90)`
  the same. `Vector.rotate`, `parallel_to` and `facing` accept tuples, so users expect it.
- **Expected:** accept a direction tuple (axis through the origin), and raise
  `TypeError("rotate(axis, angle): axis must be an Axis such as Z or Axis(origin, dir)")` for
  a number.
- **Reproduce:** `Box(1, 1, 1).rotate(45)`
- **Workaround:** `part.rotate(Z, 45)`, `Axis((0, 0, 0), (0, 0, 1))`.

## LOW

### 8. `RegularPolygon`: `align=Align.CENTER` and `align=(Align.CENTER, Align.CENTER)` differ
- **Session:** `2026-10-12_21-32-20_geometry-placement`, script `03-align.py`
- **What happens:** `_aligned` skips a single `Align.CENTER` for default-centered shapes, but a
  tuple goes through `alignment_offset` and centers the bbox. `RegularPolygon(10, 3)` spans
  x -5..10; with `(Align.CENTER, Align.CENTER)` x -7.5..7.5.
- **Expected:** both forms mean the same thing.
- **Reproduce:** `print(RegularPolygon(10, 3, align=Align.CENTER).bbox(), RegularPolygon(10, 3, align=(Align.CENTER, Align.CENTER)).bbox())`

### 9. `Shape.mirror(axis)` / `mirror(face)`: AttributeError instead of a clear message
- **Session:** `2026-10-12_21-27-02_geometry-values`, script `03-axis.py`; placement `08-mirror.py`
- **What happens:** `part.mirror(X)` -> `AttributeError: 'Axis' object has no attribute
  'z_dir'`; `part.mirror(face)` -> `AttributeError: 'Face' object has no attribute 'z_dir'`.
- **Expected:** accept a planar face (`Plane(face)`), and a `TypeError` naming Plane for others.
- **Workaround:** `part.mirror(face.plane)`.

### 10. `moved(plane)` / `moved(tuple)`: AttributeError 'no attribute matrix'
- **Session:** `2026-10-12_21-32-20_geometry-placement`, script `10-moved.py`
- **What happens:** `part.moved(Plane.XZ)` -> `AttributeError: 'Plane' object has no attribute
  'matrix'`; same for a tuple.
- **Expected:** accept a Plane (as `on` does) or raise a TypeError that points to `on`/`Pos`.

### 11. `Plane(ShapeList)`: misleading error
- **Session:** `2026-10-12_21-27-02_geometry-values`, script `05-plane-derived.py`
- **What happens:** `Plane(part.faces().top())` -> `ValueError: expected 2 or 3 coordinates,
  got 1`, while `shape.on(part.faces().top())` accepts the same one-element list.
- **Expected:** accept a one-element ShapeList of a planar face, as `on()` does.
- **Workaround:** `part.faces().top()[0].plane`.

### 12. `Shape.on` signature says `Sequence[Any]` but a Python list raises
- **Session:** `2026-10-12_21-32-20_geometry-placement`, script `11-on.py`
- **What happens:** `Circle(1).on([face])` -> `TypeError: cannot use list as a plane`.
- **Expected:** accept a one-element sequence like a ShapeList, or drop `Sequence` from the
  type hint.

### 13. `Vector` and `Axis`: equal objects with different hashes
- **Session:** `2026-10-12_21-27-02_geometry-values`, script `07-hash-eq.py`
- **What happens:** `Vector(1.0000004, 0, 0) == Vector(1.0000006, 0, 0)` is True, the hashes
  differ, `len({a, b}) == 2`. Axes on the same line with different origins compare equal and
  hash differently.
- **Expected:** `a == b` implies `hash(a) == hash(b)` (Python data model).
- **Workaround:** round coordinates before using vectors as keys.

### 14. `PolarLocations`: a range near 360 or above 360 gives coincident copies
- **Session:** `2026-10-12_21-38-45_geometry-patterns`, script `03-polar.py`
- **What happens:** `angular_range=359.9999` is treated as an arc (ends included): first and
  last copy coincide. `angular_range=720, count=4` -> 0°, 240°, 480°, 720° (first and last
  coincide).
- **Expected:** a warning or a wider tolerance for "full circle"; or document it (done in the
  doc).

### 15. `HexLocations` docstring and count checks
- **Session:** `2026-10-12_21-38-45_geometry-patterns`, script `04-hex.py`
- **What happens:** the docstring says "rows ``spacing`` apart along X"; the points are
  `spacing` apart along X within a row, and rows are `spacing·√3/2` apart along Y. Counts of 0
  or below return an empty pattern, while `GridLocations` raises `ValueError`.
- **Expected:** clearer docstring; the same count check as GridLocations.

### 16. `BoundBox.min` / `max` are assignable
- **Session:** `2026-10-12_21-32-20_geometry-placement`, script `01-bbox.py`
- **What happens:** `bb.min = Vector(1, 1, 1)` works; every other geometry value type is
  immutable.
- **Expected:** read-only like Vector, Plane, Location.

## Outside this domain (seen in passing)

### 17. `Wedge(length, width, height)` is twice as wide as asked (parts)
- **Session:** `2026-10-12_21-32-20_geometry-placement`, scripts `03-align.py`, `04-wedge-check.py`
- **What happens:** `Wedge(10, 20, 30)` has bbox size (10, 40, 30) and volume 6000 (expected
  3000): `profile.extrude(width, both=True)` extrudes `width` to each side. The docstring
  also says the top edge is "at the back (+Y)"; it is at -X (vertices at x = -5, z = 15).
- **Reproduce:** `print(Wedge(10, 20, 30).bbox().size, Wedge(10, 20, 30).volume)`
