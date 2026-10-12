diff --git a/src/smlibpy/skill/references/geometry/Locations.md b/src/smlibpy/skill/references/geometry/Locations.md
new file mode 100644
index 0000000..a2213ff
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/Locations.md
@@ -0,0 +1,65 @@
+# Locations
+
+A list of placements. Multiply it with a shape to get one copy per placement.
+`GridLocations`, `PolarLocations` and `HexLocations` return `Locations` too.
+
+## Signature
+`Locations(*items)`. Each item may be a point (tuple of 2 or 3 numbers, list, `Vector`), a
+`Location` (`Pos`, `Rot`, ...), a `Plane`, a `Face` or a `ShapeList` of faces (their face
+planes: position **and** orientation), a `Vertex`, or another `Locations` (flattened).
+
+## Returns / members
+A `list` subclass of `Location`s: `len`, indexing, iteration all work. `points` gives the
+positions as Vectors. Repr: `Locations(3 locations)`.
+
+## Multiplication
+| Expression | Result |
+|---|---|
+| `locs * shape` | `ShapeList` of copies (`locs[i] * shape`) |
+| `locs * [a, b]` | `ShapeList` of every location × every shape |
+| `locs * Pos(...)` / `locs * Rot(...)` | `Locations`: the extra move is applied in each copy's local frame |
+| `locs * other_locs` | `Locations`, all combinations |
+| `part - locs * tool`, `part + locs * tool` | cut or fuse all copies at once |
+| `(locs * shape).on(face)` | the copies placed onto a face |
+
+## Gotchas
+- **Put the pattern on a face after multiplying**: `(GridLocations(...) * Hole(2, 5)).on(face)`.
+  `locs.on(face)` returns a plain `list` of Locations, and `locs.on(face) * shape` raises
+  `TypeError: can't multiply sequence by non-int of type 'Sketch'`.
+- **A Location or Plane on the left breaks the chain**: `Pos(0, 0, 10) * GridLocations(...)`
+  and `Plane.XY.offset(10) * GridLocations(...)` return plain lists, so
+  `Pos(0, 0, 10) * GridLocations(...) * Box(...)` raises `TypeError: can't multiply sequence by
+  non-int of type 'Part'`. Write `(GridLocations(...) * Box(...)).translate(0, 0, 10)` or
+  `GridLocations(...) * Pos(0, 0, 10) * Box(...)` (the Pos then acts in each copy's frame).
+- `Pos(...) * (locs * shape)` returns a plain `list`, not a ShapeList (no `.bbox()`,
+  `.on()`); use `.translate(...)` or `.moved(...)` on the ShapeList instead.
+- Faces in `Locations(face, ...)` give the face plane: a copy's +Z follows the face normal
+  (studs on side faces stand out sideways).
+- `part.vertices()` includes seam vertices of holes and cylinders; filter before using them
+  as positions.
+- `Locations()` is empty; `part - (Locations() * tool)` leaves the part unchanged.
+
+## Example
+```python
+plate = Box(60, 40, 5)
+spots = Locations((-20, 0), (0, 0), (20, 0))          # points, Vectors, Pos, planes, faces, vertices
+plate -= spots * Cylinder(2, 10)                      # a ShapeList, cut all at once
+print(len(spots), spots.points, len(plate.faces()))
+
+corners = Box(60, 40, 5).vertices().top()           # vertices -> positions
+pegs = Locations(*corners) * Sphere(1)               # one copy per top corner
+print(len(pegs))                                     # 4 (plate.vertices() would add hole seams)
+
+block = Box(30, 20, 10)
+sides = Locations(block.faces().filter_by(lambda f: abs(f.normal_at().z) < 1e-9))
+studs = sides * Cylinder(2, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
+print([tuple(round(c) for c in s.center()) for s in studs])   # one stud standing out of each side
+
+for loc in GridLocations(10, 10, 2, 1):               # iterate: each item is a Location
+    print(loc.position)
+marks = (spots * Circle(1)).on(block.faces().top())   # pattern first, then onto the face
+print([m.center().z for m in marks])
+```
+
+## Related
+`GridLocations`, `PolarLocations`, `HexLocations`, `Location`, `on`.
diff --git a/src/smlibpy/skill/references/geometry/GridLocations.md b/src/smlibpy/skill/references/geometry/GridLocations.md
new file mode 100644
index 0000000..a65d765
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/GridLocations.md
@@ -0,0 +1,55 @@
+# GridLocations
+
+A rectangular grid of positions in the XY plane, centered on the origin by default.
+
+## Signature
+`GridLocations(x_spacing, y_spacing, x_count, y_count, *, centered=True)`.
+Spacing is center-to-center distance in mm; counts are integers ≥ 1.
+
+## Returns
+`Locations` with `x_count * y_count` translations (no rotation).
+- `centered=True`: the grid's middle is at the origin; x from `-x_spacing*(x_count-1)/2`.
+  `GridLocations(60, 40, 2, 2)` gives (±30, ±20).
+- `centered=False`: the first copy is at the origin, the grid grows toward +x and +y.
+- Order: x varies fastest, then rows in +y:
+  `GridLocations(20, 10, 3, 2)` -> (-20,-5), (0,-5), (20,-5), (-20,5), (0,5), (20,5).
+- A count of 1 puts that axis at 0; the spacing is then ignored.
+
+## Usage
+- Holes through a plate: `plate - GridLocations(60, 40, 2, 2) * Cylinder(4, 20)`. Make the
+  tool longer than the plate is thick.
+- Holes from a face: `plate - (GridLocations(30, 20, 2, 2) * Hole(2, 6)).on(top)`; on a side
+  face the grid's x and y follow the face's local axes (see `on`).
+- Sketches: `Rectangle(60, 40) - GridLocations(44, 24, 2, 2) * Circle(2.5)`.
+- Offset every copy: `GridLocations(...) * Pos(8) * Hole(...)`.
+
+## Gotchas
+- Spacing is not the overall size: the outer centers are `spacing * (count - 1)` apart.
+  Copies that reach past the part edge give half holes without an error.
+- A negative spacing mirrors the order; zero spacing stacks all copies on one point.
+- `on` the grid after multiplying with the shape, not before (see `Locations`).
+
+## Errors
+- `ValueError: counts must be at least 1` for a count < 1.
+- `TypeError: 'float' object cannot be interpreted as an integer` for a float count.
+
+## Example
+```python
+plate = Box(80, 60, 10)
+plate = plate - GridLocations(60, 40, 2, 2) * Cylinder(4, 20)        # through holes, tool longer than 10
+print(len(plate.faces().cylinders()), plate.is_valid())
+
+g = GridLocations(20, 10, 3, 2)
+print([tuple(p)[:2] for p in g.points])     # x first, then rows in +y; centered on the origin
+print(GridLocations(20, 10, 3, 2, centered=False).points[-1])   # Vector(40, 10, 0)
+
+top = plate.faces().top()
+plate -= (GridLocations(30, 20, 2, 2) * Hole(2, 6)).on(top)       # blind holes from the top face
+print(len(plate.faces().cylinders()), round(plate.volume, 3))
+
+panel = Rectangle(60, 40) - GridLocations(44, 24, 2, 2) * Circle(2.5)   # works for sketches too
+print(round(panel.area, 3))
+```
+
+## Related
+`Locations`, `PolarLocations`, `HexLocations`, `on`, parts `Hole`.
diff --git a/src/smlibpy/skill/references/geometry/PolarLocations.md b/src/smlibpy/skill/references/geometry/PolarLocations.md
new file mode 100644
index 0000000..f55b881
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/PolarLocations.md
@@ -0,0 +1,55 @@
+# PolarLocations
+
+Positions on a circle around the origin in the XY plane: bolt circles, spokes, teeth.
+
+## Signature
+`PolarLocations(radius, count, *, start_angle=0.0, angular_range=360.0, rotate=True)`.
+Angles in degrees, measured from +X counterclockwise.
+
+## Returns
+`Locations` with `count` placements at distance `radius` from the origin.
+- **Full circle** (`angular_range` exactly ±360): even spacing `360 / count`, the start is
+  not repeated. `PolarLocations(30, 4)` -> 0°, 90°, 180°, 270°.
+- **Arc** (any other range): both ends included, spacing `angular_range / (count - 1)`.
+  `PolarLocations(30, 4, angular_range=90)` -> 0°, 30°, 60°, 90°.
+- `start_angle` shifts the first copy. A negative range runs clockwise.
+- `rotate=True` (default): each copy is also turned by its angle about its own origin, so
+  the shape's +X points outward (radially). `rotate=False`: copies keep their orientation.
+- `radius=0` with `rotate=True` only turns the copies; useful for teeth drawn at their place
+  (`PolarLocations(0, 12) * tooth`).
+
+## Gotchas
+- An arc range close to 360 (e.g. 359.9999) is an arc: first and last copy coincide.
+  Ranges above 360 (e.g. 720) also produce coincident copies.
+- With `rotate=True` the shape turns about its own origin, then moves out: draw the shape
+  centered on the origin (or with +X as the outward direction).
+- A round shape looks the same either way; `rotate` matters for bars, slots, teeth.
+- A negative radius puts copies on the opposite side but keeps the rotation of the
+  positive angle.
+
+## Errors
+- `ValueError: count must be at least 1`.
+
+## Example
+```python
+flange = Cylinder(60, 10) - Cylinder(20, 12) - PolarLocations(45, 8) * Cylinder(5, 12)
+print(flange.is_valid(), len(flange.faces().cylinders()))   # 10: outer, bore, 8 holes
+
+def angle(p):
+    return round(math.degrees(math.atan2(p.y, p.x)), 3)
+
+print([angle(p) for p in PolarLocations(30, 4).points])                       # 0, 90, 180, -90
+print([angle(p) for p in PolarLocations(30, 4, start_angle=45).points])       # 45, 135, -135, -45
+print([angle(p) for p in PolarLocations(30, 4, angular_range=90).points])     # 0, 30, 60, 90: ends included
+
+spokes = PolarLocations(20, 3) * Box(10, 2, 2)                  # rotate=True: bars point outward
+level = PolarLocations(20, 3, rotate=False) * Box(10, 2, 2)     # all stay parallel to X
+print([tuple(round(v, 2) for v in s.bbox().size) for s in spokes])
+print([tuple(round(v, 2) for v in s.bbox().size) for s in level])
+
+gear = Circle(20) + PolarLocations(0, 12) * Rectangle(6, 4).translate(21, 0)   # radius 0: only turns
+print(len(gear.faces()), round(gear.area, 3))
+```
+
+## Related
+`Locations`, `GridLocations`, `Rot`, `rotate`, `on` (polar pattern on a face).
diff --git a/src/smlibpy/skill/references/geometry/HexLocations.md b/src/smlibpy/skill/references/geometry/HexLocations.md
new file mode 100644
index 0000000..f08b098
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/HexLocations.md
@@ -0,0 +1,46 @@
+# HexLocations
+
+A honeycomb pattern of positions in the XY plane: rows along X, every other row shifted by
+half a spacing.
+
+## Signature
+`HexLocations(spacing, x_count, y_count, *, centered=True)`.
+- `spacing`: distance between neighbours, in a row and diagonally (all six neighbours are
+  `spacing` apart).
+- `x_count`: positions per row; `y_count`: number of rows.
+- Rows are `spacing * √3 / 2` apart in Y; odd rows (2nd, 4th, ...) are shifted `+spacing/2`
+  in X.
+
+## Returns
+`Locations` with `x_count * y_count` translations, no rotation. With `centered=True` the
+bounding box of the points is centered on the origin; with `centered=False` the first point
+is at the origin. Order: along x first, then row by row in +y.
+`HexLocations(10, 3, 2)` -> (-12.5, -4.33), (-2.5, -4.33), (7.5, -4.33), (-7.5, 4.33),
+(2.5, 4.33), (12.5, 4.33).
+
+## Honeycomb cells
+For hexagonal cells of width across flats `f` and wall `w`:
+`HexLocations(f + w, nx, ny) * RegularPolygon(f / 2, 6, inscribed=True, rotation=30)`.
+`rotation=30` puts the flats toward the neighbours (corners up), so every wall is exactly `w`.
+Without it, the corners point at the neighbours and the walls vary.
+
+## Gotchas
+- Because odd rows shift right, the pattern is wider than `spacing * (x_count - 1)` by
+  `spacing / 2` when `y_count > 1`.
+- Counts of 0 or below return an empty pattern without an error (unlike `GridLocations`).
+- A honeycomb cut makes many faces (30 cells -> 186 faces); keep the counts reasonable.
+
+## Example
+```python
+flats, wall = 8, 1.5
+cells = HexLocations(flats + wall, 6, 5) * RegularPolygon(flats / 2, 6, inscribed=True, rotation=30)
+plate = Box(70, 50, 4) - [c.extrude(10).translate(0, 0, -5) for c in cells]
+print(len(cells), plate.is_valid())
+print(round(cells[1].bbox().min.x - cells[0].bbox().max.x, 4))   # 1.5: the wall
+
+pts = HexLocations(10, 3, 2).points
+print([tuple(round(c, 3) for c in p)[:2] for p in pts])   # rows 8.66 apart, odd rows shifted 5
+```
+
+## Related
+`GridLocations`, `Locations`, sketches `RegularPolygon`.
