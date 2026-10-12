diff --git a/src/smlibpy/skill/references/geometry/BoundBox.md b/src/smlibpy/skill/references/geometry/BoundBox.md
new file mode 100644
index 0000000..5c85306
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/BoundBox.md
@@ -0,0 +1,57 @@
+# BoundBox
+
+An axis-aligned box in world coordinates. `shape.bbox()` returns one for every shape type.
+
+## Signature
+`BoundBox(min, max)` and `BoundBox.of_points(points)`. You usually get one from `bbox()`.
+
+## Members
+| Member | Type | Meaning |
+|---|---|---|
+| `min`, `max` | Vector | lower and upper corner |
+| `size` | Vector | `max - min` (the outer dimensions) |
+| `center` | Vector | middle of the box, **a property** (on shapes `center()` is a method) |
+| `diagonal` | float | length of the space diagonal |
+| `contains(p, tol=1e-6)` | bool | point inside or on the box |
+| `union(other)` | BoundBox | box around both |
+| `lo, hi = bb` | | unpacks into min and max |
+
+## Where bbox() comes from
+| Shape | Tight? |
+|---|---|
+| `Part`, `Shell`, `Sketch`, `Face` | yes: exact extremes from the kernel, also for rotated cylinders and splines |
+| Edges and wires taken from a body (`part.edges()`) | yes |
+| Standalone curves (`Line`, `CenterArc`, `Spline`, `Polyline`, `Wire([...])`) | **no**: sampled at 33 points per edge, can be too small |
+| `Vertex` | min = max = the point |
+| `ShapeList` (selections, patterns) | union of the members; empty list -> `IndexError: empty selection` |
+
+A plain Python list has no `bbox()`; wrap it: `ShapeList(items).bbox()`.
+
+## Gotchas
+- `bb.center` is a property; `part.center()` is a method and gives the centroid, which is
+  not the bbox center for unsymmetric parts.
+- Standalone curve boxes are sampled: `CenterArc((0, 0), 10, 10, 90).bbox().max.y` is 9.9976,
+  not 10; a 30 mm `Spline` came out 0.07 mm short. Make a face or body first, or sample
+  `point_at` densely, when you need an exact extent of a free curve.
+- A sketch's bbox has zero size along its normal (`Circle(5).bbox().size.z == 0`).
+- `min` and `max` can be reassigned (`bb.min = ...`); don't, the box is not recomputed.
+- Body boxes are exact: a cylinder rotated 37° about (1, 1, 0) matched the analytic extent to
+  the last digit. Compare with `==` against a tuple (tolerance 1e-6) or `math.isclose`.
+
+## Example
+```python
+part = Box(60, 40, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)) + Cylinder(8, 25)
+bb = part.bbox()
+print(bb.min, bb.max)                 # Vector(-30, -20, -12.5) Vector(30, 20, 12.5)
+print(bb.size, bb.center, round(bb.diagonal, 3))
+lo, hi = bb                           # unpacks into min and max
+print(bb.contains((0, 0, 12)), bb.contains((31, 0, 0)))
+
+holes = PolarLocations(20, 6) * Cylinder(2, 5)
+print(holes.bbox().size)              # bbox of a ShapeList: union of the members
+print(part.faces().top()[0].bbox())   # faces and edges have one too
+height = part.bbox().size.z           # 25.0: the cylinder reaches below the plate
+```
+
+## Related
+`Align`, `center`, `generic` (comparing results), `recipes/verification`.
diff --git a/src/smlibpy/skill/references/geometry/Align.md b/src/smlibpy/skill/references/geometry/Align.md
new file mode 100644
index 0000000..3d0f86b
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/Align.md
@@ -0,0 +1,51 @@
+# Align
+
+Where a new primitive or sketch sits relative to the origin, per axis: `Align.MIN`,
+`Align.CENTER`, `Align.MAX`.
+
+## Usage
+`align=` on `Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge` and on the sketch
+constructors (`Rectangle`, `RoundedRectangle`, `Circle`, `Ellipse`, `Polygon`,
+`RegularPolygon`, `Slot`, `Trapezoid`). `Hole` and its variants have no `align`.
+
+- One value applies to every axis: `Box(10, 10, 10, align=Align.MIN)` fills x, y, z 0..10.
+- A tuple sets each axis: `(Align.CENTER, Align.CENTER, Align.MIN)` stands a part on XY.
+- `MIN`: the bbox minimum goes to 0 (shape on the positive side). `MAX`: the bbox maximum
+  goes to 0 (negative side). `CENTER`: the bbox center goes to 0.
+- `None` in a tuple, or a missing third entry, leaves that axis as built (centered for
+  primitives). Sketches use only x and y; a third entry is ignored.
+- Strings work too, case-insensitive: `align="min"`, `("MIN", "center", "max")`.
+- Alignment uses the shape's bounding box at creation, before any `.on()` or `translate`.
+  `Rectangle(10, 20, align=(Align.CENTER, Align.MIN)).on(Plane.front)` stands on z = 0.
+
+## Defaults
+Primitives and most sketches are centered. `Polygon` defaults to `align=None`: its points
+stay where you gave them.
+
+## Gotchas
+- `RegularPolygon` (odd side counts) is centered on its circumcenter, not its bbox, when
+  `align` is a single `Align.CENTER` (the default): a triangle of radius 10 spans
+  x -5..10. The tuple `(Align.CENTER, Align.CENTER)` centers the bbox (x -7.5..7.5).
+- `Wedge` with `align=CENTER` is centered by its bbox, not its centroid
+  (`Wedge(10, 20, 30).center()` is not the origin).
+- An invalid string raises `ValueError: 'bottom' is not a valid Align`.
+
+## Example
+```python
+base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))     # z 0..8
+post = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
+part = base + post
+print(part.bbox())                    # z 0..28
+
+corner = Box(10, 10, 10, align=Align.MIN)                  # x, y, z all 0..10
+under = Box(10, 10, 10, align=(None, None, Align.MAX))     # centered in x, y; z -10..0
+print(corner.bbox(), under.bbox())
+
+tab = Rectangle(20, 6, align=(Align.CENTER, Align.MIN))    # sketches: x and y only
+print(tab.bbox())                     # y 0..6
+tri = RegularPolygon(10, 3, align=(Align.CENTER, Align.CENTER))   # bbox centered
+print(tri.bbox())
+```
+
+## Related
+`BoundBox`, `translate`, `on`, parts `Box`, sketches `Rectangle`.
diff --git a/src/smlibpy/skill/references/geometry/translate.md b/src/smlibpy/skill/references/geometry/translate.md
new file mode 100644
index 0000000..ecd33e2
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/translate.md
@@ -0,0 +1,50 @@
+# translate
+
+A copy of a shape moved by a vector. Works on every shape type and on `ShapeList`.
+
+## Signature
+`shape.translate(x=0, y=0, z=0)` or `shape.translate(vector)` where `vector` is a tuple
+(2 or 3 numbers), list, numpy array or `Vector`.
+
+## Returns
+A new shape of the same type (Part, Sketch, Shell, Face, Wire, Edge, Vertex). Name and color
+are kept; the topology is unchanged. `ShapeList.translate(...)` returns a ShapeList of moved
+copies.
+
+## Behavior
+- Same as `Pos(x, y, z) * shape` and `shape.moved(Pos(x, y, z))`.
+- A sketch moves together with its plane: `Rectangle(30, 20).translate(0, 0, 40)` has its
+  plane at z = 40, so `extrude(3)` gives z 40..43.
+- Patterns are ShapeLists: `(GridLocations(...) * Box(...)).translate(0, 0, 20)` moves all
+  copies.
+
+## Gotchas
+- With a tuple as the first argument, `y` and `z` are ignored: `translate((1, 2, 3), 5)`
+  moves by (1, 2, 3).
+- A plain Python list of shapes has no `translate`; use `ShapeList(items)` or a list
+  comprehension.
+- Select faces and edges after you move a part. Parts match a selection by geometry, so
+  `moved_part.fillet(old_part.edges()..., 1)` raises
+  `ValueError: Edge(line, ...) is not an edge of this part`. The same holds for an edge or
+  face that you translated yourself.
+- Translation does not snap: compare positions with a tolerance.
+
+## Example
+```python
+peg = Cylinder(3, 10)
+a = peg.translate(10, 0, 5)
+b = peg.translate((10, 0, 5))         # tuple, list, numpy array or Vector
+c = peg.translate(z=5)                # keywords; missing ones are 0
+print(a.center(), c.center())
+
+slot = Rectangle(20, 6).translate(0, 12)          # sketches keep their plane, moved
+print(slot.plane.origin)
+lid = Rectangle(30, 20).translate(0, 0, 40).extrude(3)   # sketch lifted to z = 40, then extruded
+print(lid.bbox().min.z, lid.bbox().max.z)         # 40.0 43.0
+
+row = (GridLocations(10, 10, 3, 1) * Box(4, 4, 4)).translate(0, 0, 20)   # a ShapeList
+print([s.center().z for s in row])
+```
+
+## Related
+`Pos`, `moved`, `rotate`, `on`, `Align`.
diff --git a/src/smlibpy/skill/references/geometry/rotate.md b/src/smlibpy/skill/references/geometry/rotate.md
new file mode 100644
index 0000000..0be684e
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/rotate.md
@@ -0,0 +1,54 @@
+# rotate
+
+A copy of a shape turned by an angle (degrees) about an axis. The axis can pass through any
+point.
+
+## Signature
+`shape.rotate(axis=Z, angle=0.0)`. `axis` must be an `Axis` (`X`, `Y`, `Z`, `-Z`, or
+`Axis(origin, direction)`). Also on `ShapeList`.
+
+## Returns
+A new shape of the same type. Same as `Location.about(axis, angle) * shape`;
+`shape.rotate(Z, a)` equals `Rot(z=a) * shape`.
+
+## Direction
+Positive angles turn counterclockwise when you look from the positive end of the axis
+toward its origin (right-hand rule):
+- `rotate(Z, 90)`: +X goes to +Y. `rotate(Z, -90)` or `rotate(-Z, 90)`: +X goes to -Y.
+- `rotate(X, 90)`: +Z goes to -Y (an upright post falls toward -Y).
+- `rotate(Y, 90)`: +Z goes to +X.
+
+## About which point
+About the axis line. `X`, `Y`, `Z` pass through the world origin, so a part away from the
+origin swings around it. To turn a part in place, rotate about an axis through its center:
+`part.rotate(Axis(part.center(), (0, 0, 1)), 30)`.
+
+## Gotchas
+- The axis comes first. `part.rotate(45)` and `part.rotate(90, Z)` raise
+  `AttributeError: 'int' object has no attribute 'direction'`.
+- A direction tuple is not accepted: `part.rotate((0, 0, 1), 90)` raises
+  `AttributeError: 'tuple' object has no attribute 'direction'`. Use `Axis((0, 0, 0), (0, 0, 1))`.
+- `rotate(angle=45)` uses the default axis `Z`; `rotate()` alone does nothing (angle 0).
+- A rotated sketch turns its plane too; `Rectangle(10, 2).rotate(X, 90)` has normal -Y and
+  extrudes toward -Y.
+- Angles above 360 wrap. Rotating 36 times by 10° returns to the start without visible
+  drift (centers within 2e-7).
+
+## Example
+```python
+bar = Box(10, 2, 2, align=(Align.MIN, Align.CENTER, Align.CENTER))   # x 0..10
+print(bar.rotate(Z, 90).bbox())       # y 0..10: +X turns to +Y
+print(bar.rotate(Z, -90).bbox())      # y -10..0
+print(bar.rotate(Axis((10, 0, 0), (0, 0, 1)), 90).bbox())   # about x = 10: x 9..11, y -10..0
+
+post = Box(2, 2, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))  # z 0..10
+print(post.rotate(X, 90).bbox())      # lies along -Y
+print(post.rotate(Y, 90).bbox())      # lies along +X
+
+part = Box(20, 10, 5).translate(30, 0, 0)
+spun = part.rotate(Axis(part.center(), (0, 0, 1)), 30)   # about its own vertical axis
+print(spun.center())                  # still Vector(30, 0, 0)
+```
+
+## Related
+`Rot`, `Axis`, `Location.about`, `moved`, `PolarLocations` (many rotated copies).
diff --git a/src/smlibpy/skill/references/geometry/scale.md b/src/smlibpy/skill/references/geometry/scale.md
new file mode 100644
index 0000000..e9d11c1
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/scale.md
@@ -0,0 +1,52 @@
+# scale
+
+A scaled copy of a shape: uniform or per axis, about a center point.
+
+## Signature
+`shape.scale(factor, center=(0, 0, 0))`. `factor` is a number or `(sx, sy, sz)`.
+`center` is the fixed point; it defaults to the **world origin**, not the shape's center.
+
+## Returns
+A new shape of the same type. Volume changes by `sx * sy * sz` (`factor**3` for a uniform
+factor); areas of sketches by `sx * sy`.
+
+## Behavior
+- Uniform scaling keeps the face types: a scaled cylinder is still a `cylinder` face with the
+  new radius, and its edges are still circles.
+- Per-axis scaling converts **every** face and edge to NURBS (`bspline`), flat ones too: a
+  `Cylinder(5, 10).scale((2, 1, 1))` is a valid elliptic cylinder, and even
+  `Box(10, 10, 10).scale((2, 1, 1))` has only bspline faces. Afterwards `.planar()`,
+  `.cylinders()`, `.circles()` find nothing, `face.radius` raises, and `.on(face)` raises
+  `ValueError: a bspline face has no plane`. Booleans on the result work. Build the final
+  size directly (a `Box(20, 10, 10)`, an `Ellipse` extruded) when you need to keep working on
+  the faces.
+- A sketch scales together with its plane origin: a sketch at z = 10 scaled by 2 about the
+  origin ends up at z = 20.
+- Not available on `ShapeList`; scale each member.
+
+## Gotchas
+- `scale(2)` on a part away from the origin also moves it. Pass `center=part.center()` (or a
+  corner) to keep it in place.
+- `scale(0)` or a zero per-axis factor raises nothing: the result has volume 0 or a NaN
+  bbox and still reports `is_valid() == True`. Never scale by 0.
+- `scale(-1)` is a point reflection (valid, positive volume). Use `mirror` for a reflection
+  in a plane.
+
+## Example
+```python
+cube = Box(10, 10, 10, align=Align.MIN)          # 0..10
+big = cube.scale(2)                              # about the origin: 0..20
+mid = cube.scale(2, center=cube.center())        # about its center: -5..15
+print(big.bbox(), mid.bbox(), big.volume / cube.volume)   # volume x8
+
+oval = Cylinder(5, 10).scale((2, 1, 1))          # elliptic cylinder, 20 x 10 x 10
+print(oval.bbox().size, round(oval.volume, 2), oval.is_valid())
+print(sorted({f.geom_type for f in oval.faces()}))   # ['bspline']: no longer a cylinder
+
+inch = 25.4
+part_in_mm = Box(2, 1, 0.5).scale(inch)          # a model drawn in inches
+print(part_in_mm.bbox().size)                    # Vector(50.8, 25.4, 12.7)
+```
+
+## Related
+`translate`, `mirror`, `BoundBox`, sketches `offset` (to grow a profile by a distance).
diff --git a/src/smlibpy/skill/references/geometry/mirror.md b/src/smlibpy/skill/references/geometry/mirror.md
new file mode 100644
index 0000000..841110c
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/mirror.md
@@ -0,0 +1,53 @@
+# mirror
+
+A copy of a shape reflected in a plane. The usual way to build symmetric parts: model one
+half, mirror it, fuse.
+
+## Signature
+`shape.mirror(plane=Plane.XZ)` and the function `mirror(shape, plane=Plane.XZ)`.
+`plane` must be a `Plane`. Its origin matters; the sense of its normal does not.
+
+## Which plane mirrors what
+| Plane | maps |
+|---|---|
+| `Plane.YZ` (also `left`, `right`) | x -> -x |
+| `Plane.XZ` (the default; also `front`, `back`) | y -> -y |
+| `Plane.XY` (also `top`, `bottom`) | z -> -z |
+| `Plane.YZ.offset(30)` | x -> 60 - x (about x = 30) |
+| `face.plane` | about that planar face |
+
+## Returns
+A new shape of the same type. Mirrored parts are valid solids with outward normals and the
+same volume; analytic faces (planes, cylinders) keep their type. Fusing a half with its
+mirror image merges the faces on the mirror plane: `half + half.mirror(Plane.YZ)` of a box is
+a 6-face box.
+
+## Gotchas
+- The default plane is `Plane.XZ` (mirrors y), not YZ. Always pass the plane.
+- `mirror(X)` or `mirror(face)` raises `AttributeError` (`'Axis' object has no attribute
+  'z_dir'`); pass a Plane, `face.plane` for a face.
+- **Mirrored sketches flip their normal** when the mirror plane is perpendicular to the
+  sketch: `Polygon(...).mirror(Plane.YZ)` gets normal -Z and `extrude(5)` goes to z -5..0.
+  `half + half.mirror(Plane.YZ)` keeps the plane of `half` (left operand) and extrudes up;
+  `half.mirror(Plane.YZ) + half` extrudes down. Put the unmirrored sketch first, or mirror
+  the extruded part instead.
+- Standalone edges (`CenterArc`, `Line`) become `bspline` edges when mirrored.
+- Not available on `ShapeList`; mirror each member.
+
+## Example
+```python
+half = Box(20, 10, 10, align=Align.MIN)          # x 0..20
+print(half.mirror(Plane.YZ).bbox())              # x -20..0
+print(half.mirror().bbox())                      # default Plane.XZ: y -10..0
+print(half.mirror(Plane.YZ.offset(30)).bbox())   # about x = 30: x 40..60
+
+bracket = Polygon((0, 0), (20, 0), (20, 4), (4, 4), (4, 12), (0, 12)).extrude(5)
+tee = bracket + bracket.mirror(Plane.YZ)         # symmetric part from one half
+print(tee.is_valid(), tee.volume, len(tee.solids()), tee.bbox().size)
+
+right = half.faces().sort_by(X)[-1]
+print(half.mirror(right.plane).bbox())           # about a face: pass face.plane, x 20..40
+```
+
+## Related
+`Plane`, `scale` (negative factors), features `mirror`, `split` (cut a part in half first).
diff --git a/src/smlibpy/skill/references/geometry/moved.md b/src/smlibpy/skill/references/geometry/moved.md
new file mode 100644
index 0000000..d88938c
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/moved.md
@@ -0,0 +1,53 @@
+# moved
+
+A copy of a shape moved by a `Location` (rotation and translation in one step).
+
+## Signature
+`shape.moved(location)`; also on `ShapeList`. `location` must be a `Location`
+(`Pos(...)`, `Rot(...)`, `Location(...)`, `plane.location`).
+
+## Returns
+A new shape of the same type. `shape.moved(loc)` is the same as `loc * shape`.
+
+## Relative, not absolute
+Shapes have no stored placement (`part.location` does not exist). `moved` always applies the
+location on top of where the shape is now:
+- `moved(Pos(1, 0, 0)).moved(Pos(1, 0, 0))` moves by 2.
+- `moved(A).moved(B)` equals `moved(B * A)`, not `moved(A * B)`.
+- `moved(Rot(z=90))` turns about the world origin, like `rotate(Z, 90)`.
+
+For an absolute placement, first bring the shape's reference point to the origin:
+`part.moved(Pos(-part.center())).moved(target)`. Or build parts at the origin and place them
+once.
+
+## moved vs translate / rotate / on
+| Want | Use |
+|---|---|
+| shift by a vector | `translate(x, y, z)` or `Pos(...) * shape` |
+| turn about any axis | `rotate(axis, angle)` |
+| rotate and shift, one object | `moved(Pos(...) * Rot(...))` |
+| put a shape drawn on XY onto a plane or face | `on(target)` (same as `moved(plane.location)`) |
+
+## Gotchas
+- `moved(Plane.XZ)` or `moved((1, 2, 3))` raise `AttributeError: ... has no attribute
+  'matrix'`; pass `plane.location` / `Pos(...)`, or use `on(plane)`.
+- The order of a chain matters: read `Pos(...) * Rot(...)` from right to left (rotate, then
+  move).
+
+## Example
+```python
+arm = Box(4, 2, 2).translate(10, 0, 0)
+place = Pos(0, 0, 5) * Rot(z=90)
+print(arm.moved(place).center(), (place * arm).center())   # same: Vector(0, 10, 5)
+print(arm.moved(Pos(1, 0, 0)).moved(Pos(1, 0, 0)).center())   # relative: Vector(12, 0, 0)
+
+c = arm.center()
+at_target = arm.moved(Pos(-c)).moved(Pos(0, 50, 0))   # "absolute": center to (0, 50, 0)
+print(at_target.center())
+
+A, B = Pos(10, 0, 0), Rot(z=90)
+print(arm.moved(A).moved(B).center(), arm.moved(B * A).center())   # equal
+```
+
+## Related
+`Location`, `Pos`, `Rot`, `translate`, `rotate`, `on`.
diff --git a/src/smlibpy/skill/references/geometry/on.md b/src/smlibpy/skill/references/geometry/on.md
new file mode 100644
index 0000000..92c8c12
--- /dev/null
+++ b/src/smlibpy/skill/references/geometry/on.md
@@ -0,0 +1,68 @@
+# on
+
+Places a shape that was built around the world XY plane onto a plane or a planar face. The
+usual way to draw on a part.
+
+## Signature
+`shape.on(target)`; also `ShapeList.on(target)` and `Locations.on(target)`.
+`target` is a `Plane`, a planar `Face`, a `ShapeList` with exactly one planar face (what
+`part.faces().top()` returns), a `Location`, or a `Sketch` (its plane).
+
+## What happens
+`shape.on(target)` is `shape.moved(Plane(target).location)`: the world origin goes to the
+plane origin, world X to the plane's `x_dir`, world Y to its `y_dir`, world Z to its normal.
+- A sketch's plane goes along, so `extrude(+d)` grows out of the face and `extrude(-d)` goes
+  into the part: `part - Rectangle(10, 6).on(face).extrude(-4)` is a pocket.
+- A part's +Z goes along the face normal: a `Cylinder(..., align=(C, C, MIN))` on the right
+  face sticks out along +X. Hole tools point along -Z, so `Hole(r, d).on(face)` points into
+  the part.
+- An offset drawn before `on` is in face coordinates: `(Pos(12, 8) * Circle(2)).on(top)`
+  sits 12 along the face's x_dir and 8 along its y_dir from the face center.
+- `on` is relative like `moved`: calling it twice applies both planes.
+
+## Orientation on the faces of a box
+The face plane has its origin at the face centroid, z = outward normal, and the default
+x_dir (see `Plane`):
+| Face | local x | local y | normal |
+|---|---|---|---|
+| top | +X | +Y | +Z |
+| bottom | +X | -Y | -Z |
+| front | +X | +Z | -Y |
+| back | -X | +Z | +Y |
+| left | -Y | +Z | -X |
+| right | +Y | +Z | +X |
+
+On side faces local y is up. On the bottom face local y is world -Y. A face tilted toward
++X (normal (0.707, 0, 0.707)) has x_dir (0.707, 0, -0.707): local x runs downhill.
+
+## Gotchas
+- The origin is the face **centroid**. It moves when a feature changes the face: after an
+  off-center pocket the top face centroid of a 60 x 40 plate moved to x = -2.86. On an
+  L-shaped face it lies outside the face, and a cut placed there removes nothing (volume
+  unchanged, no error). For stable positions use a fixed plane:
+  `Plane.XY.offset(part.bbox().max.z)`, or offsets from a known point.
+- A selection with more or fewer than one face raises `ValueError: expected exactly one
+  shape, got 4 - narrow the selection or use [0]`.
+- A Python list (`on([face])`) or an `Axis` raises `TypeError: cannot use list as a plane`.
+- A curved face raises `ValueError: a cylinder face has no plane`.
+
+## Example
+```python
+block = Box(40, 30, 20)
+top = block.faces().top()
+pocket = Rectangle(10, 6).on(top).extrude(-4)              # into the part
+side_hole = Hole(3, 8).on(block.faces().front())           # Hole points along -normal: inward
+boss = Cylinder(4, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)).on(block.faces().right())
+part = block - pocket - side_hole + boss
+print(part.is_valid(), part.bbox().max.x)                  # True 26.0
+
+off = (Pos(12, 8) * Circle(2)).on(top)                     # 12 along the face x, 8 along its y
+print(off.center())                                        # about Vector(12, 8, 10)
+studs = (GridLocations(20, 10, 2, 2) * Circle(1)).on(top)  # a pattern on a face
+print(len(studs), studs.bbox().size)
+lid = Plane.XY.offset(block.bbox().max.z)                  # a fixed plane survives later edits
+print(Circle(2).on(lid).center().z)
+```
+
+## Related
+`Plane`, `moved`, `Pos`, `Locations.on`, sketches `extrude`, parts `Hole`.
