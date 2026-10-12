diff --git a/src/smlibpy/skill/references/curves/CenterArc.md b/src/smlibpy/skill/references/curves/CenterArc.md
new file mode 100644
index 0000000..d732fae
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/CenterArc.md
@@ -0,0 +1,56 @@
+# CenterArc
+
+A circular arc or full circle around a center, given by start angle and angular size.
+
+## Signature
+`CenterArc(center, radius, start_angle, arc_size, plane=Plane.XY)`
+
+- `center`: in **plane coordinates** (2-tuple, or 3-tuple to offset along the plane normal).
+  `CenterArc((5, 2), 10, 0, 90, plane=Plane.XZ)` has its world center at (5, 0, 2).
+- `radius`: mm, > 0.
+- `start_angle`: degrees, counterclockwise from the plane's X axis towards its Y axis. Any
+  value (720 = 0, -30 = 330).
+- `arc_size`: degrees. Positive runs counterclockwise, negative clockwise. `360` or `-360`
+  is a full circle starting at `start_angle`.
+- `plane`: angle 0 points along `plane.x_dir`, 90 along `plane.y_dir`.
+
+## Returns
+An `Edge` with `geom_type == "circle"` (`radius`, `arc_center`, `normal` work).
+`CenterArc((0, 0), 10, 0, 90)`: start (10, 0, 0), end (0, 10, 0), tangent at start (0, 1, 0).
+
+| plane | angle 0 | angle 90 |
+|---|---|---|
+| `Plane.XY` | +X | +Y |
+| `Plane.XZ` / `front` | +X | +Z |
+| `Plane.YZ` / `right` | +Y | +Z |
+| `Plane.back` | -X | +Z |
+| `Plane.bottom` | +X | -Y |
+
+## Gotchas
+- **`arc_size=0` gives a full circle**, not an error. Check sizes computed at run time.
+- `|arc_size| > 360` is clamped to a full circle.
+- `edge.normal` follows the direction: +plane normal for a positive `arc_size`, the opposite
+  for a negative one.
+- A full circle is one closed edge: `make_face(CenterArc(c, r, 0, 360))` and
+  `Wire([CenterArc(...)])` both work as outline or hole.
+- **A full circle as a sweep path gives an inside-out solid** (`is_valid()` True, negative
+  volume). Use `revolve` for rings, or a path of two half circles:
+  `Wire([CenterArc(c, r, 0, 180), CenterArc(c, r, 180, 180)])`.
+- `point_at(t)` on arcs is accurate to about 1e-8 mm.
+- `mirror()` or `scale()` turn the arc into a `bspline`; `radius` then raises.
+
+## Errors
+- `ValueError: radius must be positive` for radius <= 0.
+
+## Example
+```python
+quarter = CenterArc((0, 0), 10, 0, 90)                  # (10, 0) -> (0, 10), ccw
+cw = CenterArc((0, 0), 10, 0, -90)                      # (10, 0) -> (0, -10), cw
+bend = CenterArc((0, 0), 20, 0, 90, plane=Plane.XZ)     # (20, 0, 0) -> (0, 0, 20)
+tube = sweep(Circle(2), bend)                           # volume pi * 4 * 10 * pi
+outline = Polyline((0, 0), (40, 0), (40, 30), (0, 30), close=True)
+plate = make_face(outline, CenterArc((20, 15), 6, 0, 360)).extrude(5)
+```
+
+## Related
+`ThreePointArc`, `RadiusArc`, `SagittaArc`, `TangentArc`, `sketches/Circle`, `generic.md`.
diff --git a/src/smlibpy/skill/references/curves/ThreePointArc.md b/src/smlibpy/skill/references/curves/ThreePointArc.md
new file mode 100644
index 0000000..05a9ba9
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/ThreePointArc.md
@@ -0,0 +1,44 @@
+# ThreePointArc
+
+The circular arc from a start point through a middle point to an end point.
+
+## Signature
+`ThreePointArc(start, through, end)`
+
+- All three are world points (2-tuples or 3-tuples). The arc lies in the plane of the three
+  points, so it works in any orientation in 3D.
+- `through` can be any point of the arc between start and end, not only its middle.
+
+## Returns
+An `Edge` with `geom_type == "circle"` from `start` to `end`, passing exactly through
+`through`. Arcs over 180 degrees work: `ThreePointArc((10, 0), (-10, 0), (0, -10))` is a
+270 degree arc of radius 10.
+
+## Gotchas
+- It is the most direct way to get "this side" of a circle: put `through` on the side you
+  want. No sign conventions to remember.
+- `edge.normal` follows the turning direction: `ThreePointArc((-10, 0), (0, 10), (10, 0))`
+  runs clockwise and has normal (0, 0, -1).
+- A full circle is not possible (start == end raises); use `CenterArc(c, r, 0, 360)`.
+- Nearly collinear points give huge radii: 1e-9 off the chord gives r = 1.25e10, and the end
+  point misses by 2e-6 (more than the wire tolerance of 1e-6). Use `Line` when the bulge is
+  negligible.
+
+## Errors
+- `ValueError: the three points are collinear`, also when two points coincide or
+  start == end.
+
+## Example
+```python
+top = ThreePointArc((-10, 0), (0, 10), (10, 0))         # upper half circle, r = 10
+major = ThreePointArc((10, 0), (-10, 0), (0, -10))      # 270 degrees, length 47.12
+tilted = ThreePointArc((0, 0, 0), (5, 5, 5), (10, 0, 10))   # 3D, r = 7.5
+half = Wire([
+    Line((-25, 0), (-25, -7.5)),
+    ThreePointArc((-25, -7.5), (0, -15), (25, -7.5)),
+    Line((25, -7.5), (25, 0)),
+])
+```
+
+## Related
+`CenterArc`, `RadiusArc`, `SagittaArc`, `TangentArc`, `generic.md`.
diff --git a/src/smlibpy/skill/references/curves/RadiusArc.md b/src/smlibpy/skill/references/curves/RadiusArc.md
new file mode 100644
index 0000000..a42bd28
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/RadiusArc.md
@@ -0,0 +1,57 @@
+# RadiusArc
+
+The shorter circular arc of a given radius between two points.
+
+## Signature
+`RadiusArc(start, end, radius, plane=Plane.XY)`
+
+- `start`, `end`: world points.
+- `radius`: mm. **Positive bulges to the left of the travel direction start -> end, negative
+  to the right.** "Left" is seen from the tip of `plane.z_dir`.
+- `plane`: only its normal is used, to decide what "left" is. Its origin is ignored and the
+  points are not moved onto it.
+
+## Returns
+An `Edge` (`geom_type == "circle"`), always the arc of at most 180 degrees.
+`RadiusArc((0, 0), (10, 0), 10)`: middle point (5, 1.34), center (5, -8.66), length 10.47.
+`radius=-10`: middle (5, -1.34).
+
+## Which side
+| start -> end | radius > 0 bulges to | radius < 0 bulges to |
+|---|---|---|
+| (0,0) -> (10,0) in XY | +Y | -Y |
+| (10,0) -> (0,0) in XY | -Y | +Y |
+| (0,0) -> (0,10) in XY | -X | +X |
+| (0,0,0) -> (10,0,0), `plane=Plane.XZ` | +Z | -Z |
+| (0,0,0) -> (10,0,0), `plane=Plane.back` | -Z | +Z |
+
+Swapping the points flips the side. In an outline traversed counterclockwise, left is the
+inside: a positive radius bulges **inward** (concave), a negative radius bulges outward
+(convex).
+
+## Gotchas
+- No major arc: `RadiusArc` cannot make more than a half circle. Use `SagittaArc` with
+  `|sagitta| > chord / 2`, `ThreePointArc` or `CenterArc` for that.
+- `|radius| == chord / 2` is a half circle.
+- A chord parallel to `plane.z_dir` (for example a vertical chord with `Plane.XY`) raises.
+
+## Errors
+- `ValueError: radius 4.999 is too small for points 10.0 apart` when `|radius| < chord / 2`
+  (also for radius 0).
+- `ValueError: cannot normalize a zero-length vector` for equal points or a chord along the
+  plane normal.
+
+## Example
+```python
+a, b = (0, 0), (10, 0)
+left = RadiusArc(a, b, 10)       # bulges to +Y: mid (5, 1.33975)
+right = RadiusArc(a, b, -10)     # bulges to -Y
+half = RadiusArc(a, b, 5)        # half circle through (5, 5)
+# D shape traversed counterclockwise: the arc from (20, 0) back to (-20, 0) must bulge to +Y,
+# which is right of its travel direction (-X): negative radius
+d = Wire([Line((-20, 0), (20, 0)), RadiusArc((20, 0), (-20, 0), -20)])
+plate = make_face(d).extrude(5)  # volume pi * 400 / 2 * 5
+```
+
+## Related
+`SagittaArc` (by bulge height), `ThreePointArc`, `TangentArc`, `CenterArc`.
diff --git a/src/smlibpy/skill/references/curves/SagittaArc.md b/src/smlibpy/skill/references/curves/SagittaArc.md
new file mode 100644
index 0000000..27ffe1f
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/SagittaArc.md
@@ -0,0 +1,42 @@
+# SagittaArc
+
+A circular arc between two points whose middle lies a given distance (the sagitta) from the
+chord.
+
+## Signature
+`SagittaArc(start, end, sagitta, plane=Plane.XY)`
+
+- `start`, `end`: world points.
+- `sagitta`: mm, the distance from the chord midpoint to the arc midpoint. **Positive bulges
+  to the left of start -> end, negative to the right** (left seen from the tip of
+  `plane.z_dir`). Same side rule as `RadiusArc`.
+- `plane`: only its normal is used to decide "left"; the origin is ignored.
+
+## Returns
+An `Edge` (`geom_type == "circle"`). Its midpoint is exactly `sagitta` from the chord
+midpoint; radius = (sagitta² + (chord/2)²) / (2·|sagitta|).
+`SagittaArc((0, 0), (10, 0), 2)`: middle (5, 2), radius 7.25, center (5, -5.25).
+
+## Gotchas
+- `|sagitta| > chord / 2` gives the major arc (more than 180 degrees):
+  `SagittaArc((0, 0), (10, 0), 8)` has length 22.52. `|sagitta| == chord / 2` is a half
+  circle. Unlike `RadiusArc`, there is no ambiguity: the sagitta picks exactly one arc.
+- In a counterclockwise outline left is the inside: a negative sagitta bulges outward.
+- `plane=Plane.XZ` with points on the X axis: positive goes to +Z; `Plane.back`: to -Z.
+
+## Errors
+- `ValueError: the three points are collinear` for `sagitta=0` (or below about 1e-12).
+- `ValueError: cannot normalize a zero-length vector` for equal points.
+
+## Example
+```python
+bump = SagittaArc((0, 0), (10, 0), 2)        # middle (5, 2), r 7.25
+dent = SagittaArc((0, 0), (10, 0), -2)       # middle (5, -2)
+big = SagittaArc((0, 0), (10, 0), 8)         # major arc, length 22.52
+# a lens: both arcs bulge to the right of their own travel direction, i.e. outward
+lens = Wire([SagittaArc((-10, 0), (10, 0), -3), SagittaArc((10, 0), (-10, 0), -3)])
+print(make_face(lens).area)                  # 81.42202, bbox y -3..3
+```
+
+## Related
+`RadiusArc`, `ThreePointArc`, `TangentArc`, `CenterArc`.
diff --git a/src/smlibpy/skill/references/curves/TangentArc.md b/src/smlibpy/skill/references/curves/TangentArc.md
new file mode 100644
index 0000000..94def30
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/TangentArc.md
@@ -0,0 +1,56 @@
+# TangentArc
+
+A circular arc from `start` to `end` that leaves `start` in a given direction. Used to
+continue a chain of edges without a kink.
+
+## Signature
+`TangentArc(start, end, tangent)`
+
+- `start`, `end`: world points.
+- `tangent`: the direction at `start`; its length does not matter. It need not lie in XY: the
+  arc lies in the plane spanned by the tangent and the chord.
+
+## Returns
+An `Edge` (`geom_type == "circle"`) whose `tangent_at(0)` equals the normalized `tangent`.
+The arc is unique: there is exactly one circle tangent to the direction at `start` that
+passes through `end`.
+- `TangentArc((0, 0), (10, 0), (0, 1))`: half circle r 5 over +Y.
+- `TangentArc((0, 0), (10, 0), (1, 1))`: short arc, r 7.07.
+- `TangentArc((0, 0), (10, 0), (-1, 1))`: the tangent points away from `end`, so the arc
+  goes the long way round (length 33.3, about 270 degrees).
+- A tangent along the chord returns a `Line`.
+
+## Chaining
+Pass the end tangent of the previous edge:
+
+```python
+l1 = Line((0, 0), (20, 0))
+a1 = TangentArc(l1.end, (20, 10), l1.tangent_at(1))
+l2 = Line(a1.end, (0, 10))
+a2 = TangentArc(l2.end, (0, 0), l2.tangent_at(1))
+slot = make_face(Wire([l1, a1, l2, a2]))     # area 200 + 25 * pi, all joints tangent
+```
+
+Only the start is tangent. The end direction follows from the geometry; a line after the
+arc is tangent only if you put it along `arc.tangent_at(1)`.
+
+## Gotchas
+- **A tangent pointing exactly back along the chord** (`TangentArc((0, 0), (10, 0), (-1, 0))`)
+  silently returns a `Line` going forward, which ignores the tangent. No arc exists in that
+  case; check the input.
+- A tangent nearly opposite to the chord gives a huge arc: (-1, 0.01) gives r 500 and length
+  3131.
+
+## Errors
+- `ValueError: cannot normalize a zero-length vector` for `tangent=(0, 0)`.
+- `ValueError: a line needs two distinct points` for start == end.
+
+## Example
+```python
+up = TangentArc((0, 0), (10, 0), (0, 1))          # half circle, r 5, center (5, 0)
+print(up.tangent_at(0), up.radius)                 # (0, 1, 0) 5.0
+bend3d = TangentArc((0, 0, 0), (10, 0, 10), (0, 0, 1))   # in XZ, r 10, center (10, 0, 0)
+```
+
+## Related
+`ThreePointArc`, `RadiusArc`, `Spline` (tangents at both ends), `FilletPolyline`.
diff --git a/src/smlibpy/skill/references/curves/EllipticalArc.md b/src/smlibpy/skill/references/curves/EllipticalArc.md
new file mode 100644
index 0000000..2d4e592
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/EllipticalArc.md
@@ -0,0 +1,51 @@
+# EllipticalArc
+
+An ellipse, or a counterclockwise arc of one.
+
+## Signature
+`EllipticalArc(center, x_radius, y_radius, start_angle=0.0, end_angle=360.0, plane=Plane.XY)`
+
+- `center`: in plane coordinates, like `CenterArc`.
+- `x_radius`, `y_radius`: semi-axes along the plane's X and Y axes, > 0. Either may be the
+  larger one.
+- `start_angle`, `end_angle`: degrees, **parametric**: the point at angle a is
+  `(x_radius·cos a, y_radius·sin a)`. 45 degrees on a 20 x 10 ellipse is (14.14, 7.07), not
+  the point on the 45 degree ray.
+- The arc always runs counterclockwise from `start_angle` to `end_angle`; `end < start`
+  wraps around (90 -> 0 is the 270 degree arc).
+
+## Returns
+An `Edge` with `geom_type == "ellipse"` (also when the radii are equal; `radius` raises).
+Default: the full ellipse, closed, starting at (center + x_radius, 0).
+`EllipticalArc((0, 0), 20, 10, 0, 90)`: (20, 0) -> (0, 10).
+
+## Gotchas
+- **Arcs that pass through angle 0 fail**: `EllipticalArc(c, 20, 10, -90, 90)`, `350, 10`,
+  `270, 450` raise `KernelError: EllipticalArc failed (SM_ERR)`. Arcs that only end at 0
+  work (`270, 360`). Workarounds: build two pieces,
+  `Wire([EllipticalArc(c, rx, ry, 270, 360), EllipticalArc(c, rx, ry, 0, 90)])`, or draw the
+  arc on the other side and turn it: `EllipticalArc(c, rx, ry, 90, 270).rotate(Z, 180)`.
+- **An ellipse cannot be a sweep path**: `sweep(profile, EllipticalArc(...))` raises
+  `TypeError: curve_sweep(): incompatible function arguments`. Converting it to an exact
+  B-spline works: `e.mirror(Plane.XZ).mirror(Plane.XZ)` (deviation ~1e-12), then sweep.
+- `start_angle == end_angle` (or a 360 span starting elsewhere) gives the full ellipse
+  starting at angle 0; the start angle is ignored.
+- No clockwise variant; use `.reversed()`.
+- As an outline it is fine: `make_face(EllipticalArc((0, 0), 20, 10))` has area 628.3186
+  (π·200), and loft sections and open-curve extrusions work.
+
+## Errors
+- `KernelError: EllipticalArc failed (SM_ERR_INVALID_INPUT)` for a zero or negative radius.
+- `KernelError: EllipticalArc failed (SM_ERR)` for arcs across angle 0 (above).
+
+## Example
+```python
+oval = make_face(EllipticalArc((0, 0), 20, 10))               # area 628.3186
+quarter = EllipticalArc((0, 0), 20, 10, 0, 90)                # (20, 0) -> (0, 10)
+upright = EllipticalArc((0, 0), 20, 10, 0, 90, plane=Plane.XZ)   # (20, 0, 0) -> (0, 0, 10)
+right_half = Wire([EllipticalArc((0, 0), 20, 10, 270, 360), EllipticalArc((0, 0), 20, 10, 0, 90)])
+half = Wire([EllipticalArc((0, 0), 20, 10, 0, 180), Line((-20, 0), (20, 0))])   # area 100 * pi
+```
+
+## Related
+`sketches/Ellipse` (the region directly), `CenterArc`, `Spline`.
