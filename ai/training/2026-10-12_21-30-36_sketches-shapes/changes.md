diff --git a/src/smlibpy/skill/references/sketches/Rectangle.md b/src/smlibpy/skill/references/sketches/Rectangle.md
new file mode 100644
index 0000000..c6c24c0
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Rectangle.md
@@ -0,0 +1,39 @@
+# Rectangle
+
+A `width` by `height` rectangle on the XY plane, centered on the origin.
+
+## Signature
+`Rectangle(width, height, *, align=Align.CENTER)`
+`width` runs along X, `height` along Y. There is no `rotation` parameter.
+
+## Returns
+A `Sketch` with 1 face and 4 line edges; bbox `-width/2..width/2` by `-height/2..height/2`, normal +Z.
+
+## align
+One value for both axes or one per axis (`Align`, `"min"`/`"center"`/`"max"`, or `None`):
+- `Align.MIN`: lower left corner on the origin (0..w, 0..h).
+- `Align.MAX`: upper right corner on the origin (-w..0, -h..0).
+- `(Align.MIN, Align.CENTER)`: x 0..w, y centered. `None` for an axis leaves it centered.
+- A third value is ignored.
+
+## Gotchas
+- To turn it, rotate the result: `Rectangle(40, 20).rotate(Z, 30)` or `Rot(z=30) * Rectangle(40, 20)`.
+  `align` is applied before you rotate.
+- `align` also moves `sketch.plane.origin` (to the rectangle's center). It matters for
+  `revolve()` without an axis; pass the axis.
+
+## Errors
+- `ValueError: rectangle sides must be positive`: a side is zero or negative.
+- `TypeError: Rectangle() got an unexpected keyword argument 'rotation'`.
+
+## Example
+```python
+plate = Box(60, 40, 10)
+pocket = Rectangle(30, 20).on(plate.faces().top()).extrude(-4)
+plate = plate - pocket                                   # volume 24000 - 2400
+corner = Rectangle(40, 20, align=Align.MIN)              # bbox (0, 0)..(40, 20)
+turned = Rectangle(40, 20).rotate(Z, 30)                 # bbox ±22.32 x ±18.66
+```
+
+## Related
+`RoundedRectangle`, `Polygon`, `generic` (Booleans, placing), `Box`.
diff --git a/src/smlibpy/skill/references/sketches/RoundedRectangle.md b/src/smlibpy/skill/references/sketches/RoundedRectangle.md
new file mode 100644
index 0000000..66f685a
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/RoundedRectangle.md
@@ -0,0 +1,38 @@
+# RoundedRectangle
+
+A rectangle with all four corners rounded to the same radius, centered on the origin.
+
+## Signature
+`RoundedRectangle(width, height, radius, *, align=Align.CENTER)`
+`width` along X, `height` along Y, `radius` of the corner arcs. `align` as for `Rectangle`.
+
+## Returns
+A `Sketch`, bbox `±width/2` by `±height/2`, 8 edges (4 lines, 4 quarter arcs).
+Area `width*height - (4 - pi)*radius**2`.
+
+## Radius limits
+- `0 < radius < min(width, height)/2`: the normal case.
+- `radius == min(width, height)/2`: allowed. The short sides vanish: a stadium (6 edges, same
+  area as `Slot(width, height)`), or a full circle of 4 arcs for a square.
+- `radius > min(width, height)/2`, even by 1e-7: `ValueError`.
+- `radius <= 0`: a plain `Rectangle`, no error. A negative radius is not caught.
+
+## Gotchas
+- For a stadium, prefer `Slot(length, width)`: 4 edges instead of 6.
+- Only all four corners at one radius. For different radii or some corners, use
+  `Rectangle(...).fillet(r, vertices=[...])` (see `fillet`).
+
+## Errors
+- `ValueError: corner radius is larger than half the shorter side`. Also raised for a zero
+  width with a positive radius.
+- `ValueError: rectangle sides must be positive`: zero or negative side with `radius <= 0`.
+
+## Example
+```python
+outline = RoundedRectangle(80, 50, 8)                    # area 4000 - (4 - pi) * 64
+plate = (outline - GridLocations(64, 34, 2, 2) * Circle(3)).extrude(6)
+stadium = RoundedRectangle(40, 20, 10)                   # same region as Slot(40, 20)
+```
+
+## Related
+`Rectangle`, `Slot`, `fillet` (round chosen corners), `offset`.
diff --git a/src/smlibpy/skill/references/sketches/Circle.md b/src/smlibpy/skill/references/sketches/Circle.md
new file mode 100644
index 0000000..3f8e0a4
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Circle.md
@@ -0,0 +1,32 @@
+# Circle
+
+A disk of `radius` on the XY plane, centered on the origin.
+
+## Signature
+`Circle(radius, *, align=Align.CENTER)`
+`radius`, not diameter. `align` as for `Rectangle` (works on the bbox: `Align.MIN` puts the
+disk at 0..2r in x and y).
+
+## Returns
+A `Sketch` with 1 face and 1 edge of type `circle` (one vertex at (radius, 0, 0)).
+Extruded it gives a cylinder with 3 faces.
+
+## Gotchas
+- The usual way to drill holes into a sketch: `outline - Circle(r).translate(x, y)` or
+  `outline - GridLocations(...) * Circle(r)`.
+- On a face, the circle is centered on the face's area centroid; move it first with
+  `Pos(x, y) * Circle(r)` to put it elsewhere (see `generic`).
+- For a round hole in a part, `Hole` (parts) is shorter than `Circle(r).on(face).extrude(-d)`.
+
+## Errors
+- `ValueError: radius must be positive`: zero or negative radius.
+
+## Example
+```python
+ring = Circle(10) - Circle(6)                            # 1 face, 1 inner wire, area pi*(100-36)
+disk = Circle(10, align=Align.MIN)                       # bbox (0, 0)..(20, 20)
+washer = ring.extrude(2)
+```
+
+## Related
+`Ellipse`, `Slot`, `RegularPolygon`, `generic` (Booleans), `Hole` (parts).
diff --git a/src/smlibpy/skill/references/sketches/Ellipse.md b/src/smlibpy/skill/references/sketches/Ellipse.md
new file mode 100644
index 0000000..2005335
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Ellipse.md
@@ -0,0 +1,32 @@
+# Ellipse
+
+A full ellipse on the XY plane, centered on the origin, axes along X and Y.
+
+## Signature
+`Ellipse(x_radius, y_radius, *, align=Align.CENTER)`
+Semi-axes (half widths): `x_radius` along X, `y_radius` along Y. Either may be the larger one.
+There is no rotation parameter.
+
+## Returns
+A `Sketch` with 1 face and 1 edge of type `ellipse` (its vertex at (x_radius, 0, 0)); bbox
+`±x_radius` by `±y_radius`; area `pi * x_radius * y_radius`. `Ellipse(10, 10)` still has an
+`ellipse` edge, not a `circle`.
+
+## Gotchas
+- Turn it with `Ellipse(15, 8).rotate(Z, 30)`; the bbox of the result is exact (±13.59 x ±10.21).
+- A circle stretched with `Circle(10).scale((2, 1, 1))` has the same area but a B-spline edge.
+  Use `Ellipse` when the edge type matters.
+
+## Errors
+- `KernelError: Ellipse failed (SM_ERR_INVALID_INPUT)`: a radius is zero or negative (a
+  `KernelError`, not a `ValueError`).
+
+## Example
+```python
+e = Ellipse(15, 8)                    # 30 wide, 16 high
+tilted = Ellipse(15, 8).rotate(Z, 30)
+boss = e.extrude(5)                   # 3 faces, volume pi*15*8*5
+```
+
+## Related
+`Circle`, `EllipticalArc` (curves, for partial ellipses), `generic`.
diff --git a/src/smlibpy/skill/references/sketches/Polygon.md b/src/smlibpy/skill/references/sketches/Polygon.md
new file mode 100644
index 0000000..fad566b
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Polygon.md
@@ -0,0 +1,42 @@
+# Polygon
+
+The straight-edged region through a list of points. Unlike the other constructors, the
+points stay where you give them.
+
+## Signature
+`Polygon(*points, align=None)`
+Points as varargs `Polygon((0, 0), (30, 0), (0, 20))` or one list `Polygon(pts)`; tuples or
+`Vector`s. The outline is closed automatically; repeating the first point at the end changes
+nothing. `align=None` (default) leaves the points in place; `Align.CENTER` moves the bbox center
+to the origin, `Align.MIN` the lower left of the bbox.
+
+## Returns
+A `Sketch` with one line edge per side, normal +Z.
+
+## Gotchas
+- The winding does not matter: clockwise and counter-clockwise lists extrude, cut and combine
+  the same.
+- Give 2D points and place the sketch with `.on(...)`. 3D points are accepted but the sketch
+  keeps `Plane.XY` as its plane: points in a tilted plane extrude along +Z (an oblique prism),
+  and points at z = 5 combine with sketches at z = 0 instead of those at z = 5.
+- Duplicate consecutive points are dropped. A point in the middle of a straight side is kept
+  as an extra vertex.
+- An outline that touches itself at one corner becomes 2 faces.
+- `sketch.plane.origin` is the world origin, so `revolve()` without an axis turns about the
+  world Y axis. Still pass the axis explicitly.
+- For rounded corners use `Polygon(...).fillet(r)` or `FilletPolyline` + `make_face`.
+
+## Errors
+- `ValueError: a polygon needs at least three points`.
+- `KernelError: sketch failed (SM_ERR)`: the outline crosses itself (bowtie), all points are
+  collinear, or 3D points are not coplanar. There is no hint; check the point order.
+
+## Example
+```python
+profile = Polygon((0, 0), (30, 0), (30, 10), (10, 25), (0, 25))   # area 600, bbox 0..30 x 0..25
+rib = profile.on(Plane.XZ).extrude(4)                             # stands up in XZ, 4 thick toward -Y
+centered = Polygon((10, 10), (20, 10), (15, 20), align=Align.CENTER)
+```
+
+## Related
+`RegularPolygon`, `Trapezoid`, `make_face` (outlines with arcs), `fillet`, `Polyline` (curves).
diff --git a/src/smlibpy/skill/references/sketches/RegularPolygon.md b/src/smlibpy/skill/references/sketches/RegularPolygon.md
new file mode 100644
index 0000000..a25a244
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/RegularPolygon.md
@@ -0,0 +1,41 @@
+# RegularPolygon
+
+A regular polygon with `sides` corners, centered on the origin.
+
+## Signature
+`RegularPolygon(radius, sides, *, inscribed=False, rotation=0.0, align=Align.CENTER)`
+- `radius`: distance from the center to the corners (circumscribed circle).
+- `inscribed=True`: `radius` is the distance to the middle of the sides instead. For a hexagon
+  measured across flats: `RegularPolygon(flats / 2, 6, inscribed=True)`.
+- `sides`: an `int` (3 or more).
+- `rotation`: degrees counter-clockwise about the center.
+
+## Returns
+A `Sketch`. The first corner is on +X at `rotation=0`.
+- Hexagon: corners at (±r, 0), flats at the top and bottom (y = ±r·cos 30°). With
+  `inscribed=True` the flats are at y = ±radius. `rotation=30` puts corners at top and bottom.
+- Square (`sides=4`): a **diamond** with corners on the axes. `rotation=45` gives an axis-aligned
+  square; `RegularPolygon(10, 4, inscribed=True, rotation=45)` is 20 x 20.
+- Triangle: corners (r, 0), (-r/2, ±0.866r); its centroid is on the origin, its bbox is not
+  centered (x -r/2..r).
+
+## Gotchas
+- `align=Align.CENTER` (the default) keeps the polygon's center on the origin, but
+  `align=(Align.CENTER, Align.CENTER)` centers the bounding box instead. For odd `sides` they
+  differ: a triangle moves by r/4 in x.
+- A negative radius turns the polygon by 180 degrees, no error.
+
+## Errors
+- `ValueError: a polygon needs at least three sides`.
+- `TypeError: 'float' object cannot be interpreted as an integer`: `sides=6.0`.
+- `KernelError: sketch failed (SM_ERR)`: `radius=0`.
+
+## Example
+```python
+nut = RegularPolygon(6.5, 6, inscribed=True) - Circle(3.4)   # M6 nut: 13 across flats
+hex_up = RegularPolygon(10, 6, rotation=30)                  # corners at (0, ±10)
+square = RegularPolygon(10, 4, inscribed=True, rotation=45)  # 20 x 20, axis aligned
+```
+
+## Related
+`Polygon`, `Circle`, `HexLocations` (geometry), `generic`.
diff --git a/src/smlibpy/skill/references/sketches/Slot.md b/src/smlibpy/skill/references/sketches/Slot.md
new file mode 100644
index 0000000..8f9ec15
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Slot.md
@@ -0,0 +1,51 @@
+# Slot
+
+An obround (stadium): two half circles joined by straight sides, centered on the origin and
+lying along X.
+
+## Signature
+`Slot(length, width, *, rotation=0.0, align=Align.CENTER)`
+- `length`: overall length, round ends included (not center to center).
+- `width`: the diameter of the ends.
+- `rotation`: degrees counter-clockwise about the center; keyword only.
+- `align` works on the bbox after the rotation.
+
+## Returns
+A `Sketch` with 4 edges (line, arc, line, arc). The arc centers are at x = ±(length - width)/2.
+Area `(length - width)*width + pi*width**2/4`.
+
+## Variants
+smlibpy has only this one slot. Build the others from it:
+- Center-to-center distance `c`: `Slot(c + w, w)`.
+- From point `p` to point `q`: `Pos((p + q) / 2) * Slot((q - p).length + w, w, rotation=angle)`,
+  `angle = math.degrees(math.atan2(dy, dx))`.
+- Arc slot: `make_face` of a wire of four `CenterArc`s (example below).
+
+## Gotchas
+- `length <= width` (or a negative length) silently gives a `Circle` of diameter `width`.
+
+## Errors
+- `ValueError: radius must be positive`: `width` is zero or negative.
+- `TypeError: Slot() takes 2 positional arguments but 3 were given`: pass `rotation=` by name.
+
+## Example
+```python
+plate = Box(60, 40, 8)
+cut = plate - Slot(30, 8, rotation=90).on(plate.faces().top()).extrude(-8)   # vertical through slot
+
+c2c = Slot(20 + 6, 6)                       # arc centers at x = -10 and 10
+
+R, w = 30, 6                                # arc slot: centerline radius 30, 0..90 degrees
+ri, ro = R - w / 2, R + w / 2
+outline = Wire([
+    CenterArc((0, 0), ro, 0, 90),
+    CenterArc((0, R), w / 2, 90, 180),
+    CenterArc((0, 0), ri, 90, -90),
+    CenterArc((R, 0), w / 2, 180, 180),
+])
+arc_slot = make_face(outline)
+```
+
+## Related
+`RoundedRectangle` (`radius = width/2` is the same region, 6 edges), `Circle`, `make_face`,
+`CenterArc` (curves).
diff --git a/src/smlibpy/skill/references/sketches/Trapezoid.md b/src/smlibpy/skill/references/sketches/Trapezoid.md
new file mode 100644
index 0000000..df5ed58
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Trapezoid.md
@@ -0,0 +1,40 @@
+# Trapezoid
+
+A trapezoid with its base on the bottom, centered on the origin.
+
+## Signature
+`Trapezoid(width, height, left_angle, right_angle=None, *, align=Align.CENTER)`
+- `width`: length of the base (bottom side, at y = -height/2).
+- `height`: distance from base to top (top side at y = +height/2).
+- `left_angle`, `right_angle`: interior angles at the base corners in degrees.
+  `right_angle=None` uses `left_angle` (symmetric).
+
+## Returns
+A `Sketch` with 4 line edges. The base runs from x = -width/2 to +width/2; the top is
+`width - height/tan(left) - height/tan(right)` long.
+- Angles below 90: the top is shorter. 90: that side is vertical. Above 90: the side leans
+  outwards (dovetail); the bbox is then wider than `width`.
+- `(120, 60)`: a parallelogram.
+
+## Gotchas
+- Default `align` centers the base and the height, not the bbox. `align=(Align.CENTER, Align.MIN)`
+  stands it on the X axis.
+- Angle 180 gives a degenerate sketch (area 0, bbox ±1e17) without an error. A negative
+  angle `a` acts as `180 + a`; a negative height turns it upside down.
+- A triangle (the sides meeting exactly at the top) is rejected; use `Polygon`.
+
+## Errors
+- `ValueError: the sides cross below the given height`: the top length would be zero or less.
+- `ZeroDivisionError`: an angle of 0.
+- `KernelError: sketch failed (SM_ERR)`: height 0.
+
+## Example
+```python
+t = Trapezoid(40, 15, 60)                       # top 22.68 long, area 470.1
+dovetail = Trapezoid(40, 15, 120)               # top 57.32 long
+ramp = Trapezoid(40, 15, 60, 90, align=(Align.CENTER, Align.MIN))   # right side vertical, base on y = 0
+rail = ramp.on(Plane.XZ).extrude(100)           # base on z = 0, 100 long toward -Y
+```
+
+## Related
+`Polygon`, `Rectangle`, `generic`.
