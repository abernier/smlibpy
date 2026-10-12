diff --git a/src/smlibpy/skill/references/geometry/generic.md b/src/smlibpy/skill/references/geometry/generic.md
new file mode 100644
index 0000000..15a97cc
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/generic.md
@@ -0,0 +1,73 @@
+# Geometry conventions
+
+Units, axes, value semantics, tolerances, and how to print and compare results.
+
+## Units and axes
+- Lengths in millimeters, angles in degrees, everywhere (`Rot`, `rotate`, `rotated`,
+  `PolarLocations`, `revolve`).
+- Z is up. `Plane.XY` is the ground; the side planes (`front`, `back`, `left`, `right`) have
+  their local Y pointing to world +Z.
+- Positive angles turn counterclockwise when you look down the axis from its positive end
+  (right-hand rule): `Rot(z=90) * Vector(1, 0, 0)` is `Vector(0, 1, 0)`.
+- Primitives and sketches are centered on the origin unless `align=` says otherwise.
+
+## Shapes are values
+- Every operation returns a new shape. `part.translate(...)`, `part.fillet(...)`,
+  `part - tool` leave `part` unchanged.
+- `part -= tool` rebinds the name `part` to the result; another name that pointed to the old
+  part still sees the old part.
+- `==` on shapes is identity, not geometry: `b == b.translate(0, 0, 0)` is False. Compare
+  numbers (volume, bbox, center) instead.
+- `X`, `Y`, `Z` are `Axis` objects, not vectors. Use `Z.direction` when you need the vector.
+- `Vector`, `Axis`, `Plane`, `Location` are immutable values too; methods return new ones.
+
+## Printing
+| Object | repr |
+|---|---|
+| Part | `Part(6 faces, volume=48000)`; with a name `Part('plate', 6 faces, volume=6000)` |
+| Sketch / Shell | `Sketch(1 faces, area=50)` |
+| Face | `Face(plane, area=600, center=(0, 0, 5))` |
+| Edge | `Edge(line, (15, -10, 5) -> (15, 10, 5))` |
+| Wire | `Wire(4 edges, closed, length=100)` |
+| Vertex | `Vertex(15, 10, 5)` |
+| ShapeList | `ShapeList([...])`, more than 6 items: the first 3 and the count |
+| Vector | `Vector(0.333333, 0, 0)`: 6 significant digits, values below 5e-13 print as 0 |
+| Location | `Pos(1, 2, 3)` without rotation, else `Location(position=(...), rotation=(...))` |
+| Plane / Axis | `Plane.XY`, `Axis.Z` for the named ones, else origin and directions |
+
+Reprs round. Print `v.to_tuple()` or `round(x, 6)` when the digits matter.
+
+`part.info()` (Part, Shell, Sketch) returns one dict:
+`{'type': 'Part', 'faces': 7, 'edges': 15, 'vertices': 10, 'bbox': ((-40.0, -30.0, -5.0), (40.0, 30.0, 5.0))}`.
+
+## Comparing results
+- `TOLERANCE` is `1e-6` (mm). `Vector ==` and `Location ==` use it: `Vector == tuple` works
+  (`bbox().size == (80, 60, 10)`).
+- Volumes, areas and centers come from numeric integration with a relative error around
+  1e-7. `Box(30, 20, 10).volume` is `5999.999999999999`; the center of `Cylinder(30, 100)` is
+  about 1.5e-6 off the origin, so `center() == (0, 0, 0)` is False there. Compare with
+  `math.isclose(a, b, rel_tol=1e-6)` and `v.is_close(w, tol)` with a tolerance that fits the
+  part size (1e-5 of the size is safe).
+- Planar boxes give exact centers and bounding boxes; curved parts do not.
+
+## Gotchas
+- `sum(list_of_vectors)` fails (TypeError); pass a start value: `sum(vs, Vector())`.
+- Vectors that are equal within the tolerance can hash differently, so a `set` of vectors
+  may keep near-duplicates. Round the coordinates before you deduplicate.
+
+## Example
+```python
+plate = Box(80, 60, 10)                        # mm; centered on the origin
+holed = plate - Cylinder(4, 20)                # plate is unchanged
+print(plate)                                   # Part(6 faces, volume=48000)
+print(holed.info())                            # counts and bbox in one dict
+print(holed.is_valid(), round(holed.volume, 3), holed.bbox().size)
+
+expected = 80 * 60 * 10 - math.pi * 4**2 * 10
+assert math.isclose(holed.volume, expected, rel_tol=1e-6)
+assert holed.bbox().size == (80, 60, 10)       # Vector == tuple, tolerance 1e-6
+assert len(holed.faces()) == len(plate.faces()) + 1
+```
+
+## Related
+`Vector`, `Axis`, `Plane`, `Location`, `BoundBox`, `Align`, `recipes/verification`.
diff --git a/src/smlibpy/skill/references/geometry/Vector.md b/src/smlibpy/skill/references/geometry/Vector.md
new file mode 100644
index 0000000..d3f14b1
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/Vector.md
@@ -0,0 +1,59 @@
+# Vector
+
+An immutable 3D point or direction.
+
+## Signature
+`Vector(x, y, z)`, `Vector(x, y)` (z = 0), `Vector((x, y, z))`, `Vector([x, y])`,
+`Vector(numpy_array)`, `Vector(other_vector)`, `Vector()` (the origin).
+Almost every API that takes a point or direction also takes a plain tuple, so you rarely need
+to build a `Vector` yourself.
+
+## Operations
+| Expression | Result |
+|---|---|
+| `a + b`, `a - b` | Vector; either side may be a tuple: `(5, 5, 5) - a` |
+| `a * 3`, `3 * a`, `a / 2`, `-a` | Vector |
+| `a * b` | TypeError: use `a.dot(b)` or `a.cross(b)` |
+| `abs(a)`, `a.length` | float |
+| `a.dot(b)` | float |
+| `a.cross(b)` | Vector, right-handed: `X × Y = Z` |
+| `a.normalized()` | unit Vector; zero vector -> ValueError |
+| `a.angle_to(b)` | degrees, 0..180, unsigned |
+| `a.distance_to(b)` | float |
+| `a.is_close(b, tol=1e-6)`, `a == b` | bool, absolute distance ≤ 1e-6 |
+| `a.is_parallel(b)`, `a.is_perpendicular(b)` | bool; parallel ignores the sense |
+| `a.rotate(axis, deg)` | Vector rotated about an `Axis` or a direction tuple through the origin |
+| `a.project_to(plane)` | point projected onto a `Plane` |
+| `a.any_perpendicular()` | some unit vector perpendicular to `a` |
+| `a.x`, `a[0]`, `x, y, z = a`, `a.to_tuple()`, `np.array(a)` | access |
+
+## Gotchas
+- `X`, `Y`, `Z` are `Axis` objects: `Vector(1, 2, 3) + X` raises TypeError. Use
+  `X.direction` (a unit Vector) for arithmetic.
+- `sum(vectors)` fails; use `sum(vectors, Vector())`.
+- The repr rounds to 6 significant digits; use `to_tuple()` for full precision.
+- Coordinates are read-only (`v.x = 5` raises AttributeError); make a new Vector.
+- Vectors equal within 1e-6 can have different hashes; do not rely on sets for deduplication.
+
+## Errors
+- `ValueError: expected 2 or 3 coordinates, got 1` for a 1- or 4-element sequence.
+- `ValueError: cannot normalize a zero-length vector` from `normalized()`, and from
+  `Axis`/`Plane` built with a zero direction.
+
+## Example
+```python
+a = Vector(10, 0, 0)
+b = Vector((0, 5))                    # 2D: z = 0
+print(a + b, a - (0, 0, 3), 2 * a, a / 4)
+print(a.dot(b), a.cross(b), a.length, a.normalized())
+print(a.angle_to(b))                  # 90.0, always 0..180
+print(Vector(1, 0, 0).rotate(Z, 90))  # Vector(0, 1, 0)
+
+d = Z.direction * 5                   # X, Y, Z are axes; .direction is the vector
+part = Box(10, 10, 10).translate(d)
+print(part.center())                  # Vector(0, 0, 5)
+total = sum([Vector(1, 0, 0), Vector(0, 2, 0)], Vector())
+```
+
+## Related
+`Axis`, `Plane.to_local`, `Location` (`loc * vector` moves a point), `generic`.
diff --git a/src/smlibpy/skill/references/geometry/Axis.md b/src/smlibpy/skill/references/geometry/Axis.md
new file mode 100644
index 0000000..187fa41
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/Axis.md
@@ -0,0 +1,59 @@
+# Axis
+
+An infinite line: an origin and a unit direction. `X`, `Y`, `Z` are the world axes.
+
+## Signature
+`Axis(origin=(0, 0, 0), direction=(0, 0, 1))`. Both take tuples (2D origins get z = 0) or
+Vectors; the direction is normalized. `Axis()` is `Axis.Z`. `X`, `Y`, `Z` are the same objects
+as `Axis.X`, `Axis.Y`, `Axis.Z`.
+
+## Members
+- `origin`, `direction` (Vectors).
+- `-axis` or `axis.reversed()`: opposite direction, same origin.
+- `axis.at(point)`: same direction through another point.
+- `axis.moved(loc)`, `loc * axis`: moved and turned by a Location (`Rot(y=90) * Z == X`).
+- `distance_to(p)`, `project(p)` (foot point), `position_along(p)` (signed coordinate),
+  `is_parallel(other)` (ignores the sense).
+- `==` is True when both lie on the same line with the same sense; the origin may be anywhere
+  on the line.
+
+## Where an Axis is accepted
+| API | Axis | tuple instead |
+|---|---|---|
+| `shape.rotate(axis, angle)` | yes, about the line through `origin` | no: AttributeError |
+| `sketch.revolve(axis)` | yes, an offset axis works | no: AttributeError |
+| `Location.about(axis, angle)` | yes | no: AttributeError |
+| `Vector.rotate(axis, angle)` | yes | yes (through the world origin) |
+| `parallel_to`, `facing` | yes | yes, a direction tuple |
+| `sort_by`, `group_by` | yes | no: `TypeError: cannot sort by (0, 0, 1)` |
+| `shape.mirror(...)` | no: needs a `Plane` | no |
+
+## Gotchas
+- `X`, `Y`, `Z` are axes, not vectors: `Vector + X` fails; use `X.direction`.
+- `part.rotate((0, 0, 1), 90)` raises `AttributeError: 'tuple' object has no attribute
+  'direction'`. Wrap it: `Axis((0, 0, 0), (0, 0, 1))`.
+- `part.mirror(X)` raises `AttributeError: 'Axis' object has no attribute 'z_dir'`; mirror
+  takes a plane (`Plane.YZ` mirrors x to -x).
+- The world axes pass through the origin. To rotate about a part's own axis, build an Axis
+  through its center: `Axis(part.center(), (0, 0, 1))`.
+- `face.axis` gives the axis of a cylinder, cone, sphere or torus face (origin at the base).
+
+## Errors
+- `ValueError: cannot normalize a zero-length vector` for a zero direction.
+
+## Example
+```python
+pin = Box(2, 2, 2).translate(10, 0, 0)
+hinge = Axis((5, 0, 0), (0, 0, 1))          # vertical axis through (5, 0, 0)
+print(pin.rotate(hinge, 90).center())       # Vector(5, 5, 0)
+print(pin.rotate(Z, 90).center())           # about the world Z axis: Vector(0, 10, 0)
+
+ring = Rectangle(4, 10).translate(12, 0).revolve(Y)   # revolve about the world Y axis
+print(round(ring.volume, 2))                          # 3015.93 = 2*pi*12*40
+
+shifted = Pos(0, 0, 5) * Z        # an axis moved by a location
+print(shifted, -Z, Z.at((3, 4, 0)))
+```
+
+## Related
+`rotate`, `Location.about`, `Vector`, `Plane`, selection `sort_by` / `parallel_to`.
diff --git a/src/smlibpy/skill/references/geometry/Plane.md b/src/smlibpy/skill/references/geometry/Plane.md
new file mode 100644
index 0000000..29bc000
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/Plane.md
@@ -0,0 +1,84 @@
+# Plane
+
+A coordinate system: origin, x direction, normal (`z_dir`); `y_dir = z_dir × x_dir`.
+Sketches are drawn on world XY and placed onto a plane with `.on(plane)` or `plane * shape`.
+
+## Signature
+`Plane(origin=(0, 0, 0), x_dir=None, z_dir=(0, 0, 1))` — positional order is origin, x_dir,
+z_dir. Also `Plane(face)` (a planar face), `Plane(location)`, `Plane(plane)`.
+`x_dir` is projected into the plane and normalized. Without `x_dir`:
+- vertical normal (`z_dir.z == 0`): x = Z × normal, so local Y is world +Z;
+- otherwise: the projection of world X (of world Y when the normal is within ~2.5° of X).
+
+## Named planes
+| Plane | x_dir | y_dir | z_dir (normal) |
+|---|---|---|---|
+| `XY` = `top` | +X | +Y | +Z |
+| `bottom` | +X | -Y | -Z |
+| `XZ` = `front` | +X | +Z | -Y |
+| `back` | -X | +Z | +Y |
+| `YZ` = `right` | +Y | +Z | +X |
+| `left` | -Y | +Z | -X |
+| `ZX` | +Z | +X | +Y |
+| `YX` | +Y | +X | -Z |
+| `ZY` | +Z | +Y | -X |
+
+All pass through the origin. On `front`, `back`, `left`, `right` a sketch drawn "up" (+y)
+stands up (world +Z). `ZX`, `YX`, `ZY` do not follow that rule.
+
+## Derived planes (all return new planes)
+- `offset(d)`: moved `d` along its normal (`Plane.XZ.offset(10)` has origin y = -10).
+- `shifted(x, y, z)`: moved in its own coordinates.
+- `flipped()`: normal reversed, x kept, y reversed.
+- `rotated(x, y, z)`: turned about its own origin, in degrees. With several angles it turns
+  about the plane's original X, then original Y, then original Z axis.
+  `Plane.XY.rotated(x=30).z_dir` is `(0, -0.5, 0.866)`.
+- `at(point)`: same orientation, new origin. `moved(loc)` or `loc * plane`.
+- `location`: the Location that maps world XY onto this plane.
+
+## Coordinates
+`to_local(p)` world -> plane coordinates (z = height above the plane), `from_local(p)`
+plane -> world (2D tuples allowed), `distance_to(p)` signed height, `contains(p)`,
+`project(p)`, `is_coplanar(other)` (ignores the sense of the normal). `==` compares origin,
+x and z exactly (within 1e-6): `Plane.XY != Plane.XY.flipped()`.
+
+## A face's plane
+`face.plane` (or `Plane(face)`): origin at the face's area centroid, z = outward normal,
+x chosen by the default rule above. For the faces of a centered `Box`:
+top (x +X, y +Y), bottom (x +X, y -Y), front (x +X, y +Z), back (x -X, y +Z),
+left (x -Y, y +Z), right (x +Y, y +Z).
+
+## Gotchas
+- The centroid of a non-convex face can lie outside it: the top face of an L-shaped plate
+  has its plane origin in the empty corner. Place features with explicit offsets, or use
+  `face.interior_point()`.
+- A curved face has no plane: `ValueError: a cylinder face has no plane`.
+- `Plane(part.faces().top())` (a ShapeList) raises `ValueError: expected 2 or 3 coordinates,
+  got 1`; take the face: `Plane(part.faces().top()[0])`. `.on(shapelist)` does accept a
+  one-element list.
+- `Plane.XZ` faces -Y. A part extruded from a sketch on `Plane.XZ` grows toward -Y.
+
+## Errors
+- `ValueError: x_dir is parallel to the plane normal`.
+- `ValueError: cannot normalize a zero-length vector` for a zero `z_dir`.
+
+## Example
+```python
+lid = Plane.XY.offset(30)                     # parallel to XY, 30 above
+tilted = Plane.XY.rotated(x=30)               # normal (0, -0.5, 0.866)
+side = Plane(origin=(10, 0, 5), z_dir=(1, 0, 0))   # x_dir picked: local Y is world +Z
+print(lid.origin, tilted.z_dir, side.x_dir, side.y_dir)
+
+rib = Rectangle(10, 20, align=(Align.CENTER, Align.MIN)).on(Plane.front)
+print(rib.bbox())                             # x -5..5, z 0..20: stands up
+
+block = Box(30, 20, 10)
+top = block.faces().top()[0].plane            # origin (0, 0, 5), normal +Z
+print(top.origin, top.x_dir, top.z_dir)
+print(top.to_local((5, 3, 5)), top.from_local((5, 3, 0)))
+boss = Circle(4).on(top).extrude(6)
+print((block + boss).bbox().max.z)            # 11.0
+```
+
+## Related
+`on`, `Location`, `Axis`, sketches `extrude`, `Locations.on`.
diff --git a/src/smlibpy/skill/references/geometry/Location.md b/src/smlibpy/skill/references/geometry/Location.md
new file mode 100644
index 0000000..65eb241
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/Location.md
@@ -0,0 +1,61 @@
+# Location
+
+A rigid placement: a rotation followed by a translation (a 4x4 matrix). `Pos` and `Rot` make
+them; `*` composes them and applies them to shapes, points, axes and planes.
+
+## Signature
+`Location(position=None, rotation=None)`: `position` is a point (tuple or Vector); `rotation`
+is `(x, y, z)` angles in degrees, applied about the world X, then Y, then Z axis. Also
+`Location(plane)` (maps world XY onto the plane), `Location(location)`, `Location(4x4 array)`.
+`Location()` is the identity. `Location.about(axis, angle)` is a rotation about any `Axis`
+(through its origin).
+
+## Members
+- `position` (Vector), `rotation` (Vector of X, Y, Z angles; angles come back normalized,
+  `Rot(z=200).rotation` is `(0, 0, -160)`), `x_dir`, `y_dir`, `z_dir`, `matrix`,
+  `plane` (world XY moved by the location).
+- `inverse()`: `loc * loc.inverse() == Location()`.
+- `rotate_vector(v)`: rotation only, no translation.
+
+## Multiplication
+| Expression | Result |
+|---|---|
+| `a * b` (two Locations) | Location: `b` is applied first, then `a` |
+| `loc * shape` | moved copy, same as `shape.moved(loc)` |
+| `loc * [s1, s2]` | list of moved copies |
+| `loc * Vector` or `loc * (x, y)` / `(x, y, z)` | moved point (translation included) |
+| `loc * axis`, `loc * plane` | moved Axis / Plane |
+
+Read a chain from right to left: `Pos(10, 0, 0) * Rot(z=90) * bar` first turns `bar` about
+the world origin, then moves it 10 along X. Swap the two and the bar swings around the
+origin to (0, 10, 0).
+
+## Gotchas
+- All rotations are about world axes through the world origin, not about the shape's
+  center. To turn a shape in place, rotate first and move after, or use
+  `Location.about(Axis(center, dir), angle)`, or `Pos(p) * Rot(...) * Pos(-p)`.
+- `loc * vector` moves a point; use `rotate_vector` for directions.
+- `Location` equality uses a tolerance of 1e-6 on the matrix entries.
+- `Location * Locations` (a pattern) returns a plain `list`, not `Locations`; see
+  `Locations` for the consequences.
+
+## Example
+```python
+place = Location((10, 0, 0), (0, 0, 90))      # position, then X/Y/Z angles in degrees
+same = Pos(10, 0, 0) * Rot(z=90)
+print(place == same, place.position, place.rotation)
+
+bar = Box(4, 2, 2)
+print((Pos(10, 0, 0) * Rot(z=90) * bar).center())   # rotate, then move: Vector(10, 0, 0)
+print((Rot(z=90) * Pos(10, 0, 0) * bar).center())   # move, then rotate: Vector(0, 10, 0)
+
+moved = bar.moved(place)
+back = moved.moved(place.inverse())
+print(back.center(), place * Vector(1, 0, 0), place.rotate_vector((1, 0, 0)))
+
+turn_in_place = Location.about(Axis((10, 0, 0), (0, 0, 1)), 45)
+print((turn_in_place * Pos(10, 0, 0) * bar).center())   # stays at Vector(10, 0, 0)
+```
+
+## Related
+`Pos`, `Rot`, `moved`, `Plane.location`, `Locations`.
diff --git a/src/smlibpy/skill/references/geometry/Pos.md b/src/smlibpy/skill/references/geometry/Pos.md
new file mode 100644
index 0000000..5d24be5
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/Pos.md
@@ -0,0 +1,49 @@
+# Pos
+
+A pure translation, as a `Location`. `Pos(10, 0, 5) * shape` equals `shape.translate(10, 0, 5)`.
+
+## Signature
+`Pos(x=0, y=0, z=0)`, or `Pos((x, y, z))`, `Pos((x, y))`, `Pos(vector)`.
+`Pos(10)` is `Pos(10, 0, 0)`; `Pos(z=5)` works with keywords.
+
+## Returns
+A `Location` with no rotation; it prints as `Pos(10, 0, 5)`.
+
+## Usage
+- `Pos(...) * shape`: moved copy of any shape (Part, Sketch, Face, Edge, Wire, Vertex).
+- `Pos(...) * [a, b]`: list of moved copies.
+- `Pos(...) * Rot(...) * shape`: turn the shape about the origin first, then move it there.
+  This is the usual way to place a rotated copy.
+- `Pos(...) * Vector` gives a moved point.
+- On a sketch: `(Pos(10, 5) * Circle(3)).on(face)` puts the circle 10 along the face's
+  x_dir and 5 along its y_dir from the face center.
+- Inside a pattern: `GridLocations(...) * Pos(8) * Hole(3, 5)` offsets every copy by 8 along
+  the pattern's X.
+
+## Gotchas
+- `Pos` takes coordinates, not a distance and a direction. For "5 along the normal" use
+  `Pos(face.normal_at() * 5)` or `Plane.offset`.
+- `Pos(0, 0, 10) * Rot(x=90) * shape` and `Rot(x=90) * Pos(0, 0, 10) * shape` differ: the
+  second turns the offset too (it ends up at (0, -10, 0)).
+- Centers of curved parts carry integration noise (`Vector(10, -1.1e-07, 5)`); compare
+  with a tolerance.
+
+## Errors
+- `ValueError: expected 2 or 3 coordinates, got 1` for `Pos("a")` or a 1-element tuple.
+
+## Example
+```python
+peg = Cylinder(3, 10)
+a = Pos(10, 0, 5) * peg                  # same as peg.translate(10, 0, 5)
+b = Pos((10, 0, 5)) * peg                # tuple or Vector
+c = Pos(z=5) * peg                       # keywords
+print(a.center(), b.center(), c.center())
+
+dots = Pos(15, 0) * Circle(2)            # sketches too (z = 0)
+arm = Pos(20, 0, 0) * Rot(z=30) * Box(10, 2, 2)   # rotated in place, then moved
+print(dots.center(), arm.center())
+print([p.center() for p in Pos(0, 0, 10) * [peg, Box(2, 2, 2)]])
+```
+
+## Related
+`Rot`, `Location`, `translate`, `Locations`.
diff --git a/src/smlibpy/skill/references/geometry/Rot.md b/src/smlibpy/skill/references/geometry/Rot.md
new file mode 100644
index 0000000..30092ce
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/Rot.md
@@ -0,0 +1,52 @@
+# Rot
+
+A pure rotation about the world axes through the world origin, as a `Location`. Angles in
+degrees.
+
+## Signature
+`Rot(x=0, y=0, z=0)` or `Rot((x, y, z))`. The rotations are applied about the world X axis
+first, then world Y, then world Z: `Rot(10, 20, 30) == Rot(z=30) * Rot(y=20) * Rot(x=10)`.
+
+## Returns
+A `Location` without translation; prints as
+`Location(position=(0, 0, 0), rotation=(0, 0, 45))`.
+
+## Direction of positive angles
+Right-hand rule, counterclockwise seen from the positive end of the axis:
+| Rotation | maps | to |
+|---|---|---|
+| `Rot(z=90)` | +X | +Y |
+| `Rot(x=90)` | +Y | +Z (and +Z to -Y) |
+| `Rot(y=90)` | +Z | +X |
+
+## Gotchas
+- `Rot(90)` is a rotation about **X** (the first positional argument). Write `Rot(z=90)`.
+- Rot turns about the world origin. A shape away from the origin swings around it:
+  `Rot(z=90) * Box(2, 2, 2).translate(10, 0, 0)` ends at (0, 10, 0). To turn in place:
+  build the shape at the origin, rotate, then move (`Pos(p) * Rot(...) * shape`), or use
+  `Pos(p) * Rot(...) * Pos(-p) * shape`, or `shape.rotate(Axis(p, dir), angle)`.
+- Several angles in one `Rot` are not "turn about X, then about the new Y": they are fixed
+  world axes. When in doubt, chain single-axis rotations: `Rot(z=30) * Rot(x=90)` applies
+  x first.
+- To lay a Z-axis primitive along X use `Rot(y=90)`; along Y use `Rot(x=90)` (or `Rot(x=-90)`;
+  for a centered cylinder both give the same shape).
+- `loc.rotation` returns normalized angles: `Rot(z=200).rotation` is `(0, 0, -160)`.
+
+## Example
+```python
+bar = Box(10, 2, 2)
+print((Rot(z=90) * bar).bbox().size)          # Vector(2, 10, 2)
+print(Rot(10, 20, 30) == Rot(z=30) * Rot(y=20) * Rot(x=10))   # True: X, then Y, then Z
+print(Rot(z=90) * Vector(1, 0, 0))            # Vector(0, 1, 0): counterclockwise seen from +Z
+
+off = Box(2, 2, 2).translate(10, 0, 0)
+print((Rot(z=90) * off).center())             # about the origin: Vector(0, 10, 0)
+p = Vector(10, 0, 0)
+print((Pos(p) * Rot(z=90) * Pos(-p) * off).center())   # about its own center: Vector(10, 0, 0)
+
+lying = Rot(y=90) * Cylinder(3, 20)           # axis along X now
+print(lying.bbox().size)                      # Vector(20, 6, 6)
+```
+
+## Related
+`Pos`, `Location`, `rotate` (about any axis), `Plane.rotated` (about the plane's own axes).
