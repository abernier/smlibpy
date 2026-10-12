diff --git a/src/smlibpy/skill/references/curves/Spline.md b/src/smlibpy/skill/references/curves/Spline.md
new file mode 100644
index 0000000..adec688
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/Spline.md
@@ -0,0 +1,58 @@
+# Spline
+
+A smooth cubic curve exactly through the given points.
+
+## Signature
+`Spline(*points, tangents=None, closed=False)`
+
+- `points`: two or more distinct points, as separate arguments (2-tuples or 3-tuples, world
+  coordinates). 3D works.
+- `tangents`: `(start_tangent, end_tangent)`, a tuple of two; either may be `None`. Only the
+  direction counts; the length of the vectors is ignored.
+- `closed=True`: closes the curve back to the first point, tangent-continuous at the join.
+  Do not repeat the first point (repeating it is harmless).
+
+## Returns
+An `Edge` with `geom_type == "bspline"` that passes through every point (deviation ~1e-14).
+Without `tangents`, each end tangent comes from the parabola through the three end points.
+`Spline(a, b)` with two points and no tangents returns a `Line`.
+
+## Gotchas
+- **No `periodic` option.** `closed=True` matches position and tangent at the join, not
+  curvature exactly. Fine for outlines and sweeps; not class-A.
+- `closed=True` with two different tangents makes a kink at the join without an error.
+- Repeating the first point without `closed=True` closes the curve with a kink.
+- **Pass points as separate arguments.** `Spline([p1, p2, p3])` (one list of 2 or 3 points)
+  raises TypeError; use `Spline(*pts)`.
+- Uneven spacing can overshoot between points. Add points where the shape matters.
+- `edge.bbox()` of a spline samples 33 points and can be too small: for
+  `Spline((0, 0), (1, 1), (2, 0), (30, 0))` it reports max y 0.80 although the curve passes
+  through (1, 1). Sample `point_at` densely when you need extents.
+- To continue another edge smoothly, pass its end tangent:
+  `tangents=(line.tangent_at(1), None)`.
+- A closed spline as a **sweep path** returns a body with volume 0 (`is_valid()` True). Split
+  it into two open splines with matching end tangents and sweep along `Wire([a, b])`:
+  `Spline((20, 0), (0, 20), (-20, 0), tangents=((0, 1), (0, -1)))` plus
+  `Spline((-20, 0), (0, -20), (20, 0), tangents=((0, -1), (0, 1)))` gives a valid ring.
+
+## Errors
+- `ValueError: a spline needs at least two points`.
+- `ValueError: spline points must be distinct` for consecutive duplicates.
+- `ValueError: cannot normalize a zero-length vector` for a zero tangent, or two points with
+  `closed=True`.
+- `IndexError` for `tangents=((1, 0),)`: always pass a pair.
+
+## Example
+```python
+s = Spline((0, 0), (10, 5), (20, -5), (30, 0))
+flat = Spline((0, 0), (10, 5), (20, -5), (30, 0), tangents=((1, 0), (1, 0)))
+blob = make_face(Spline((0, 0), (20, -5), (35, 5), (25, 20), (5, 15), closed=True)).extrude(4)
+tube = sweep(Circle(2), Spline((0, 0, 0), (0, 10, 20), (30, 10, 40)))
+# a spline top tangent to two vertical sides
+top = Spline((40, 10), (25, 20), (10, 15), (0, 10), tangents=((0, 1), (0, -1)))
+cam = make_face(Wire([Line((0, 0), (40, 0)), Line((40, 0), (40, 10)), top, Line((0, 10), (0, 0))])).extrude(6)
+```
+
+## Related
+`Bezier` (control points instead of through points), `TangentArc`, `features/sweep`,
+`features/loft`.
diff --git a/src/smlibpy/skill/references/curves/Bezier.md b/src/smlibpy/skill/references/curves/Bezier.md
new file mode 100644
index 0000000..1f19d20
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/Bezier.md
@@ -0,0 +1,45 @@
+# Bezier
+
+A Bézier curve from its control points; rational when weights are given.
+
+## Signature
+`Bezier(*control_points, weights=None)`
+
+- `control_points`: 2 to 18 points, as separate arguments. The degree is
+  `len(control_points) - 1` (max 17).
+- `weights`: one positive number per control point. A weight > 1 pulls the curve towards its
+  control point, < 1 pushes it away.
+
+## Returns
+An `Edge` (`geom_type == "bspline"`) from the first to the last control point. The inner
+control points are **not** on the curve: `Bezier((0, 0), (10, 20), (20, 0))` peaks at
+(10, 10). The tangent at each end points at the neighbouring control point.
+
+## Gotchas
+- Use `Spline` when the curve must pass through points; use `Bezier` when you think in
+  control polygons (fairings, cam lobes, blends).
+- A rational quadratic with weights `[1, cos(θ/2), 1]` is an exact circular arc of angle θ:
+  `Bezier((10, 0), (10, 10), (0, 10), weights=[1, math.sqrt(2) / 2, 1])` is a quarter circle of
+  radius 10 (deviation ~1e-15). It still reports `geom_type == "bspline"`, so `radius`
+  raises; use `CenterArc` when you need a real circle edge.
+- Coincident control points are accepted and can give a zero-length edge
+  (`Bezier((0, 0), (0, 0))`). Check `length`.
+- `point_at(t)` is by arc length, not the Bézier parameter.
+- Two control points give a straight `bspline`, not a `line`: `direction` raises. Use `Line`.
+
+## Errors
+- `ValueError: a Bézier curve needs at least two control points`.
+- `KernelError: Bezier failed (SM_ERR)` for 19 or more control points, or a weight <= 0.
+- `KernelError: Bezier failed (SM_ERR_INVALID_INPUT)` when the number of weights differs
+  from the number of control points.
+
+## Example
+```python
+arch = Bezier((0, 0), (10, 20), (20, 0))                 # peak (10, 10)
+s_curve = Bezier((0, 0), (0, 10), (20, 10), (20, 0))     # max y 7.5
+quarter = Bezier((10, 0), (10, 10), (0, 10), weights=[1, math.sqrt(2) / 2, 1])
+print(arch.point_at(0.5), round(quarter.length, 9))      # (10, 10, 0) 15.707963268
+```
+
+## Related
+`Spline`, `ThreePointArc`, `CenterArc`.
diff --git a/src/smlibpy/skill/references/curves/Helix.md b/src/smlibpy/skill/references/curves/Helix.md
new file mode 100644
index 0000000..45bd390
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/Helix.md
@@ -0,0 +1,70 @@
+# Helix
+
+A helical edge, cylindrical or conical. The usual path for springs, coils and threads.
+
+## Signature
+`Helix(pitch, height, radius, *, center=(0, 0, 0), direction=(0, 0, 1), end_radius=None, left_handed=False)`
+
+- `pitch`: rise per turn, mm. `height / pitch` turns; fractions are fine. There is no
+  `turns` parameter: for n turns pass `height = n * pitch`.
+- `height`: total rise along `direction`, from `center`.
+- `radius`: start radius. `end_radius`: radius at the top, for a conical helix (> 0).
+- `center`: the point on the axis where the helix starts (the bottom).
+- `direction`: the axis. The helix rises along it.
+- `left_handed=False`: right-handed, i.e. counterclockwise seen from the tip of `direction`
+  while rising.
+
+## Returns
+An `Edge` (`geom_type == "bspline"`).
+- Starts at `center + radius * x`, where `x = Plane(center, z_dir=direction).x_dir`. For the
+  default Z axis that is (radius, 0, 0): `Helix(5, 20, 10)` runs from (10, 0, 0) to
+  (10, 0, 20); after a quarter turn it is at (0, 10, 1.25) (left-handed: (0, -10, 1.25)).
+- `direction=(1, 0, 0)` starts at (0, radius, 0); `(1, 1, 0)` at (-0.707·r, 0.707·r, 0).
+  Print `h.start` when it matters.
+- It is a B-spline approximation: radial deviation about 4e-6 · radius, length about 2e-6
+  short. Exact enough for threads and springs.
+
+## As a sweep path
+`sweep(profile, helix)` centers the profile's bounding box on `helix.start` and turns it to
+face along the helix. For the default axis, the sketch's **X axis points radially out** and
+its **Y axis along the helix axis**. So:
+- `Rectangle(2, 1)` on `Helix(4, 12, 8)` is 2 radial (x 7..9) and 1 axial.
+- A thread tooth points along sketch +X; set the helix radius to rod radius + the half
+  width of the tooth's bounding box in X, so its base sits on the rod.
+
+```python
+spring = sweep(Circle(1.2), Helix(pitch=6, height=48, radius=10))     # valid, volume pi*1.44*L
+rod = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
+tooth = Polygon((0, -0.8), (0, 0.8), (1.2, 0))                         # tip towards +X
+thread = sweep(tooth, Helix(pitch=2, height=16, radius=5.6, center=(0, 0, 2)))
+screw = rod + thread                                                   # valid, one solid
+```
+
+## Gotchas
+- **Long helices fail.** About 26 turns at radius 50, 32 at radius 20, 46 at radius 5 and
+  58 at radius 2 are the most that work; beyond that `KernelError: Helix failed
+  (SM_ERR_NOT_WITHIN_TOLERANCE)`. Chain helices of whole turns; the joints are tangent and
+  `sweep` handles the wire:
+  `Wire([Helix(1, 30, 5), Helix(1, 30, 5, center=(0, 0, 30))])`.
+- `part.bbox()` of a body swept along a helix can be about 0.1 mm too large. Check sizes with
+  vertices or `distance_to`.
+- `end_radius=0` (a cone to a point) fails; use a small positive radius.
+- The helix ends at the same angle it starts only for whole turns.
+
+## Errors
+- `ValueError: pitch, height and radius must be positive`.
+- `KernelError: Helix failed (SM_ERR_INVALID_INPUT)` for `end_radius <= 0` or very many turns.
+- `KernelError: Helix failed (SM_ERR_NOT_WITHIN_TOLERANCE)` for too many turns (above).
+- `ValueError: cannot normalize a zero-length vector` for `direction=(0, 0, 0)`.
+
+## Example
+```python
+h = Helix(pitch=5, height=20, radius=10)               # (10, 0, 0) -> (10, 0, 20), 4 turns
+lh = Helix(5, 20, 10, left_handed=True)
+cone = sweep(Circle(0.8), Helix(5, 20, 10, end_radius=4))
+long = sweep(Circle(1), Wire([Helix(4, 12, 8), Helix(4, 12, 8, center=(0, 0, 12))]))
+print(h.start, h.end, h.point_at(1 / 16))              # quarter turn: (0, 10, 1.25)
+```
+
+## Related
+`features/sweep`, `CenterArc`, `parts/Cylinder`, `sketches/Polygon`.
diff --git a/src/smlibpy/skill/references/curves/FilletPolyline.md b/src/smlibpy/skill/references/curves/FilletPolyline.md
new file mode 100644
index 0000000..e001f52
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/FilletPolyline.md
@@ -0,0 +1,48 @@
+# FilletPolyline
+
+A polyline whose corners are rounded with tangent arcs of one radius, as a `Wire`.
+
+## Signature
+`FilletPolyline(*points, radius, close=False)`
+
+- `points`: two or more points, as separate arguments; 2D or 3D.
+- `radius`: keyword-only, mm, > 0.
+- `close=True`: closes the polyline and rounds the corner at the first point too.
+
+Same as `Polyline(*points, close=close).fillet(radius)`.
+
+## Returns
+A `Wire` of lines and arcs (`geom_type == "circle"`), tangent at every joint. An open wire
+keeps its first and last point; every inner corner gets an arc.
+`FilletPolyline((0, 0), (20, 0), (20, 10), (40, 10), radius=3)`: 5 edges, arcs centered at
+(17, 3) and (23, 7).
+
+## Radius limits
+The arc at a corner of angle φ between the segments cuts `r · tan(φ / 2)` off each
+neighbouring segment (r for a 90° corner).
+- An inner segment carries two setbacks: a 10 mm segment between two 90° corners allows
+  r ≤ 5. At r = 5 the segment vanishes and the two arcs meet.
+- The first and last segments carry one: a 20 mm end segment allows r ≤ 20 at a 90° corner.
+- Sharp (acute) corners need long setbacks: at 14° r = 1 already takes 8.1 mm.
+- Too large: `ValueError: fillet radius 5.01 is too large for the edge Edge(line, ...)`.
+
+## Gotchas
+- In 3D each arc lies in the plane of its corner, so a 3D polyline gives a valid bent pipe
+  path: `sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8))`.
+  The bend radius must be larger than the profile radius: radius 2 with `Circle(3)` raises
+  `KernelError: sweep failed (SM_ERR): the profile may be too large for the path's corners`.
+- Collinear points and a 180° reversal are left as they are (no arc).
+- `radius=0` raises `cannot normalize a zero-length vector`; a negative radius returns a
+  broken wire without an error.
+- Pass points as separate arguments (see `Polyline`).
+
+## Example
+```python
+path = FilletPolyline((0, 0), (20, 0), (20, 10), (40, 10), radius=3)
+frame = make_face(FilletPolyline((0, 0), (20, 0), (20, 10), (0, 10), radius=2, close=True))
+print(frame.area)                                      # 200 - 4 * (4 - pi) = 196.566371
+pipe = sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8))
+```
+
+## Related
+`Polyline`, `Wire.fillet` (selected corners), `sketches/RoundedRectangle`, `features/sweep`.
