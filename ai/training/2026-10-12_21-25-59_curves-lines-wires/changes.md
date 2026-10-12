diff --git a/src/smlibpy/skill/references/curves/generic.md b/src/smlibpy/skill/references/curves/generic.md
new file mode 100644
index 0000000..feec8e6
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/generic.md
@@ -0,0 +1,107 @@
+# Curves and wires
+
+Curves are 1D shapes. Every curve constructor returns an `Edge` (one curve) or a `Wire` (a
+chain of edges). They are used for outlines (`make_face`), sweep paths, loft sections, and
+open surfaces (an open wire extruded or revolved gives a `Shell`).
+
+## Edges
+
+- `Line`, `PolarLine`, `CenterArc`, `ThreePointArc`, `RadiusArc`, `SagittaArc`, `TangentArc`,
+  `EllipticalArc`, `Spline`, `Bezier`, `Helix` return an `Edge`.
+- `Polyline` and `FilletPolyline` return a `Wire`.
+- Edges taken from bodies (`part.edges()`, `face.outer_wire()`) are the same `Edge` type and
+  mix freely with constructed ones.
+- `Edge()` cannot be called directly.
+- Points are 2-tuples (z = 0), 3-tuples, lists, `Vector` or `Vertex`.
+- `edge.start`, `edge.end`, `edge.length`, `edge.point_at(t)`, `edge.tangent_at(t)`: `t` is
+  the fraction of the arc length, 0 at `start`, 1 at `end`. `tangent_at` is a unit vector
+  along the direction of travel.
+- `geom_type` is `"line"`, `"circle"` (arcs too), `"ellipse"` or `"bspline"`. `direction` works
+  only on lines, `radius`, `arc_center`, `normal` only on circles. Otherwise they raise
+  `ValueError`.
+- `edge.reversed()` swaps start and end. `edge.intersections(other)` gives crossing points.
+
+## Wires
+
+`Wire([e1, e2, ...])` chains edges head to tail and flips edges where needed. `a + b` does the
+same. The first edge you pass keeps its direction and sets the direction of the wire. A
+closed wire starts at the start of the first edge you pass. `is_closed` uses a tolerance of
+1e-6. See `Wire.md`.
+
+## From wires to sketches
+
+A closed, planar wire becomes a region with `make_face(outer, *holes)` or `wire.to_sketch()`.
+A single closed edge (a full circle) also works as an outline or hole.
+
+```python
+outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
+bolt_hole = Wire([CenterArc((12, 12), 4, 0, 360)])
+bracket = make_face(outline, bolt_hole).extrude(5)    # volume 5748.67, z 0..5
+```
+
+- The direction of travel does not matter: a clockwise outline gives the same region.
+- A hole that crosses the outline is subtracted like a Boolean; a hole outside does nothing.
+- An open wire raises `ValueError: a sketch region needs closed wires; use wire.close()`.
+- A non-planar or self-crossing wire raises `KernelError: make face failed (SM_ERR): the wire
+  must be planar and must not cross itself`.
+
+## 2D curves on planes
+
+Points are world points; a 2-tuple lies in world XY. Some constructors take `plane=`, with
+two different meanings:
+- `CenterArc`, `EllipticalArc`: the center is in plane coordinates and the curve lies in
+  the plane. `CenterArc((5, 2), 10, 0, 90, plane=Plane.XZ)` is centered at world (5, 0, 2).
+- `PolarLine`, `RadiusArc`, `SagittaArc`: the points stay world points; the plane only sets
+  the angle axes (PolarLine) or which side is "left" (the arcs). Its origin is ignored.
+
+Any edge or wire can be moved with `.on(plane_or_face)`, `translate`, `rotate`,
+`Pos(...) *`, `Rot(...) *`. On `Plane.XZ` the local X is world +X and local Y is world +Z.
+Drawing in XY and calling `.on(plane)` is the most predictable way.
+
+**Sketch normal trap.** A sketch made from a wire does not keep the plane the wire was drawn
+on. Its normal points to +Z, or, for a vertical wire, to +X or +Y. A wire on `Plane.XZ` gives
+a sketch with normal +Y, while `Rectangle(...).on(Plane.XZ)` has normal -Y: `extrude(5)` goes
+the other way. To keep the plane, make the face on XY first and place the sketch:
+
+```python
+profile = make_face(Polyline((-10, -5), (10, -5), (10, 5), (-10, 5), close=True)).on(Plane.XZ)
+wall = profile.extrude(5)    # y -5..0, like Rectangle(20, 10).on(Plane.XZ).extrude(5)
+```
+
+## Wires as paths
+
+A sweep path is an `Edge` or a `Wire` of connected edges. A `Polyline` path gives mitered
+corners; round the corners with `FilletPolyline` for a bent pipe.
+
+```python
+path = FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8)
+pipe = sweep(Circle(3), path)    # valid, volume = pi * 3**2 * path.length
+```
+
+- `sweep` centers the profile's bounding box on `path.start` and turns it to face along the
+  path; draw the profile in XY around the origin.
+- **Closed paths made of one edge are broken**: a full `CenterArc` gives an inside-out body,
+  a closed `Spline` a body of volume 0, both with `is_valid()` True. Split the loop into two
+  edges (`Wire([CenterArc(c, r, 0, 180), CenterArc(c, r, 180, 180)])`) or use `revolve`.
+- An `EllipticalArc` cannot be a path (TypeError); see `EllipticalArc.md`.
+- `Helix` is limited to about 26 to 58 turns, depending on the radius; chain helices.
+
+## Gotchas
+
+- `mirror()` and `scale()` turn lines and arcs into `bspline` edges. After that `direction`
+  and `radius` raise, and `Wire.fillet` and `Sketch.fillet` silently skip every corner next to
+  such an edge. Build symmetric outlines from points instead of mirroring them when the
+  corners must be rounded. `rotate`, `translate` and `.on()` keep lines and circles.
+- `Wire([...])` does not check that the edges connect. Edges with a gap or a branch are kept
+  in the given order, and the wire is just "open". A sweep along such a path returns an
+  invalid part without an error. Check `wire.is_closed` for outlines and compare
+  `wire.start` / `wire.end` with what you expect for paths.
+- Two separately built but identical edges are not `==` (equality is identity).
+- `bbox()` of a constructed curve (not one taken from a body) samples 33 points and can miss
+  the extremes of splines: sample `point_at(i / n)` densely when extents matter.
+- Pass points as separate arguments: `Polyline(*pts)`, `Spline(*pts)`. A single list of 2 or
+  3 points raises TypeError.
+
+## Related
+`Wire.md`, `Line.md`, `Polyline.md`, `CenterArc.md`, `Spline.md`, `Helix.md`,
+`sketches/make_face`, `features/sweep`, `features/extrude`.
diff --git a/src/smlibpy/skill/references/curves/Line.md b/src/smlibpy/skill/references/curves/Line.md
new file mode 100644
index 0000000..8bedf5e
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/Line.md
@@ -0,0 +1,41 @@
+# Line
+
+A straight edge between two points.
+
+## Signature
+`Line(start, end)`
+
+- `start`, `end`: points as 2-tuples (z = 0), 3-tuples, lists, `Vector` or `Vertex`. World
+  coordinates. There is no `plane=`; use `.on(plane)` to move a line drawn in XY.
+
+## Returns
+An `Edge` with `geom_type == "line"`, running from `start` to `end`.
+`Line((0, 0), (30, 40))`: `length` 50, `direction` (0.6, 0.8, 0), `point_at(0.25)` (7.5, 10, 0).
+
+## Gotchas
+- `direction` is the unit vector start -> end; `reversed()` flips it.
+- Lines are not limited to a plane: `Line((1, 2, 3), (4, 6, 3))` is fine.
+- `Line(...).on(Plane.XZ)` keeps a line along X on world X; local Y becomes world Z.
+- `mirror()` and `scale()` turn the line into a `bspline` edge; `direction` then raises and
+  wire fillets skip its corners. `rotate`, `translate`, `.on()` keep it a line.
+- Two lines with the same points are not `==`; compare `start` and `end` with `is_close`.
+- A line of 1e-9 mm is accepted. Avoid such slivers; they come from rounding errors in point
+  lists.
+- `Line(a, b) + Line(b, c)` makes a `Wire`.
+
+## Errors
+- `ValueError: a line needs two distinct points` when start and end coincide (closer than
+  1e-12).
+- `ValueError: expected 2 or 3 coordinates, got 4` for a malformed point.
+- `ValueError: not a circular edge but a line` when asking a line for `radius`.
+
+## Example
+```python
+a = Line((0, 0), (30, 40))
+b = Line((1, 2, 3), Vector(4, 6, 3))
+print(a.length, a.direction, a.point_at(0.25))   # 50.0, (0.6, 0.8, 0), (7.5, 10, 0)
+print(Line((0, 0), (10, 10)).intersections(Line((0, 10), (10, 0))))   # [Vector(5, 5, 0)]
+```
+
+## Related
+`PolarLine` (by length and angle), `Polyline` (a chain of lines), `Wire`, `generic.md`.
diff --git a/src/smlibpy/skill/references/curves/Polyline.md b/src/smlibpy/skill/references/curves/Polyline.md
new file mode 100644
index 0000000..e3502fd
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/Polyline.md
@@ -0,0 +1,51 @@
+# Polyline
+
+A chain of straight segments through points, as a `Wire`.
+
+## Signature
+`Polyline(*points, close=False)`
+
+- `points`: two or more points, as separate arguments. 2-tuples (z = 0) or 3-tuples, world
+  coordinates.
+- `close=True`: adds a line from the last point back to the first.
+
+## Returns
+A `Wire` of `Line` edges in the order of the points. `Polyline(a, b, c, d)` has 3 edges and
+is open; with `close=True` it has 4 edges and is closed.
+
+## Gotchas
+- **Pass the points as separate arguments.** `Polyline([(0, 0), (10, 0), (10, 5)])` with a
+  list of 2 or 3 points raises `TypeError: float() argument must be ... not 'tuple'`. A list
+  of 4 or more points happens to work. Use `Polyline(*pts)`.
+- Repeating the first point at the end also closes the wire (no zero-length edge is added).
+  Combining that with `close=True` is harmless.
+- Consecutive duplicate points are dropped silently.
+- Collinear points stay separate edges in the wire; `make_face` merges them into one edge.
+- `Polyline(a, b, close=True)` gives a "closed" wire of two coincident lines; `make_face`
+  rejects it with a `KernelError`.
+- `Polyline(a, a)` returns an empty wire whose `repr` raises `IndexError`. Do not build
+  polylines from unchecked point lists.
+- 3D points are fine for paths: `Polyline((0, 0, 0), (0, 0, 30), (30, 0, 30))`. A sweep along
+  it gives mitered corners.
+- To round the corners use `FilletPolyline` or `wire.fillet(r)`.
+- A closed polyline becomes a region with `make_face(wire)` or `wire.to_sketch()`. The sketch
+  normal is +Z for a wire in XY (see `generic.md` for wires on other planes).
+
+## Errors
+- `ValueError: a polyline needs at least two points`.
+- `ValueError: a sketch region needs closed wires; use wire.close()` from `make_face` on an
+  open polyline.
+
+## Example
+```python
+outline = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True)
+print(len(outline.edges()), outline.is_closed, make_face(outline).area)   # 4 True 200 (to 1e-12)
+path = Polyline((0, 0, 0), (0, 0, 30), (30, 0, 30))
+pipe = sweep(Circle(3), path)                                              # mitered corner
+pts = [(0, 0), (10, 0), (10, 5)]
+step = Polyline(*pts)                                                      # unpack a list
+```
+
+## Related
+`FilletPolyline`, `Line`, `Wire` (`close()`, `fillet()`), `sketches/Polygon` (a closed outline
+as a sketch directly), `generic.md`.
diff --git a/src/smlibpy/skill/references/curves/PolarLine.md b/src/smlibpy/skill/references/curves/PolarLine.md
new file mode 100644
index 0000000..a394ca4
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/PolarLine.md
@@ -0,0 +1,42 @@
+# PolarLine
+
+A straight edge given by its start point, length and angle.
+
+## Signature
+`PolarLine(start, length, angle, plane=Plane.XY)`
+
+- `start`: the start point in **world** coordinates.
+- `length`: mm. A negative length points the other way (the edge length is still positive).
+- `angle`: degrees, counterclockwise from the plane's X axis towards its Y axis. Any value
+  works (400 = 40, -45 points down-right in XY).
+- `plane`: only sets the directions of the angle's X and Y axes. Its origin is ignored.
+
+## Returns
+An `Edge` (a `Line`) from `start` to `start + length * (cos(angle) * plane.x_dir +
+sin(angle) * plane.y_dir)`.
+
+| plane | angle 0 goes to | angle 90 goes to |
+|---|---|---|
+| `Plane.XY` / `top` | +X | +Y |
+| `Plane.XZ` / `front` | +X | +Z |
+| `Plane.YZ` / `right` | +Y | +Z |
+| `Plane.back` | -X | +Z |
+
+## Gotchas
+- **`start` is not in plane coordinates**, unlike the center of `CenterArc`.
+  `PolarLine((1, 2), 10, 0, plane=Plane.XY.offset(5))` starts at (1, 2, 0), not at z = 5.
+  Give the world start point, or build on XY and move the edge with `.on(plane)`.
+- Like `Line`, the result is an `Edge`, not a `Wire`.
+
+## Errors
+- `ValueError: a line needs two distinct points` for `length=0`.
+
+## Example
+```python
+e = PolarLine((0, 0), 10, 30)                      # end (8.66025, 5, 0)
+up = PolarLine((0, 0), 10, 90, plane=Plane.XZ)     # end (0, 0, 10)
+print(e.end, up.end)
+```
+
+## Related
+`Line`, `Polyline`, `CenterArc`, `geometry/Plane`.
diff --git a/src/smlibpy/skill/references/curves/Wire.md b/src/smlibpy/skill/references/curves/Wire.md
new file mode 100644
index 0000000..b2a2dd2
--- /dev/null
+++ b/src/smlibpy/skill/references/curves/Wire.md
@@ -0,0 +1,87 @@
+# Wire
+
+A chain of edges, open or closed. Outlines, sweep paths and loft sections are wires.
+
+## Signature
+`Wire(edges, *, sort=True)`
+
+- `edges`: an `Edge`, a `Wire`, or a list of them (nested lists and `ShapeList`s are
+  flattened). Edges from bodies (`part.edges()`) work too.
+- `sort=True`: order the edges head to tail and flip edges that point the wrong way.
+  `sort=False` keeps your order and directions as given.
+
+`a + b` (Edge or Wire on either side) is `Wire([a, b])`. `Polyline`, `FilletPolyline` and
+`face.outer_wire()` also return wires.
+
+## Ordering
+- The first edge you pass keeps its direction and sets the direction of the wire.
+  `Wire([c, a, d, b])` of a square starts at the start of `c`.
+- A closed wire starts and ends at the start of the first edge you pass.
+- Chaining tolerance is 1e-6 mm.
+
+## Members
+| member | result |
+|---|---|
+| `is_closed` | end meets start within 1e-6 |
+| `start`, `end` | first point of the first edge, last point of the last edge |
+| `length` | sum of the edge lengths |
+| `point_at(t)`, `tangent_at(t)` | at fraction `t` of the total length; `t` is clamped to 0..1; unit tangent along the travel |
+| `center()` | length-weighted mean of the edge midpoints, not the area centroid |
+| `edges()`, `vertices()`, `bbox()`, `distance_to(p)` | as usual |
+| `reversed()` | same wire traversed the other way |
+| `close()` | adds a straight line from `end` to `start`; returns the same wire if already closed |
+| `plane()` | fitted plane; normal by the right-hand rule along the travel (ccw in XY: +Z, cw: -Z) |
+| `fillet(radius, vertices=None)` | rounds corners between two straight edges (below) |
+| `to_sketch()` | the region inside a closed planar wire (same as `make_face(wire)`) |
+
+## fillet
+- Rounds every corner where two `line` edges meet, with tangent arcs of `radius`. Open
+  wires keep their two end points; only inner corners are rounded.
+- `vertices=[...]`: only the corners at these points (tuples or `Vertex`). A point that is
+  not a corner is ignored without an error.
+- Corners next to an arc, a spline or a mirrored/scaled edge (those are `bspline`) are
+  skipped silently.
+- Limit: the two setbacks `r * tan(angle / 2)` on one edge may add up to its length. On a
+  20 x 10 rectangle `fillet(5)` works (the short sides vanish, 6 edges), `fillet(5.001)`
+  raises.
+- `radius=0` raises `ValueError: cannot normalize a zero-length vector`. A negative radius
+  returns a broken wire without an error. Pass a positive radius only.
+
+## Gotchas
+- **No connectivity check.** Edges with a gap or a T branch are accepted; they keep the
+  given order and the wire is "open". `make_face` then complains about an open wire, and a
+  sweep along such a path returns an invalid part (`is_valid()` False, volume 0) without an
+  error. Check `is_closed`, `start` and `end`.
+- `to_sketch()` / `make_face()` choose the sketch normal themselves: +Z, or +X / +Y for
+  vertical wires, not the plane the wire was drawn on. See `generic.md` for the workaround.
+- `mirror()` turns lines and arcs into `bspline` edges, so `fillet` stops working on them.
+  Fillet before mirroring, or build the full outline from points.
+- `extrude(list_of_edges, h)` raises TypeError; wrap the list: `extrude(Wire(edges), h)`.
+  `make_face(list_of_edges)` works.
+
+## Errors
+- `ValueError: a wire needs at least one edge` for `Wire([])`.
+- `TypeError: a wire is made of edges, got int` when a point tuple is in the list.
+- `ValueError: fillet radius 5.001 is too large for the edge Edge(line, ...)`.
+- `ValueError: a sketch region needs closed wires; use wire.close()` from `to_sketch()` on
+  an open wire.
+
+## Example
+```python
+a = Line((0, 0), (10, 0))
+b = Line((10, 0), (10, 10))
+c = Line((10, 10), (0, 10))
+d = Line((0, 10), (0, 0))
+sq = Wire([c, a, d, b])            # any order; starts at c.start = (10, 10)
+print(sq.is_closed, sq.length)     # True 40.0
+
+w = Wire([Line((0, 0), (10, 0)), CenterArc((10, 5), 5, -90, 180), Line((10, 10), (0, 10))])
+print(w.point_at(0.5), w.tangent_at(0.5))   # (15, 5, 0), (0, 1, 0)
+region = w.close().to_sketch()              # area 100 + 12.5 * pi
+
+rounded = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).fillet(2)
+corner = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).fillet(4, vertices=[(20, 0)])
+```
+
+## Related
+`Polyline`, `FilletPolyline`, `generic.md`, `sketches/make_face`, `features/sweep`.
