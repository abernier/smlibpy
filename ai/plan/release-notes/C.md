# Lane C: curves (kernel plan C1+, C2 to C16)

## Fixed

- **2D unions of exclusive-or sketches no longer crash (C1 follow-up).** The union of two
  exclusive-or sketches whose faces touch at points (one of 40 random cases checked against
  OpenCASCADE) killed the process in 7 of 13 runs. The crash was not in the 3D slab Booleans, as
  the 0.5.0 notes said, but in the kernel's planar Boolean (`SmPrimitiveCreation::Boolean2D`):
  the intersection can leave a coincident edge as a wire edge, whose edgeuses lie on no face, and
  the classification read the mark of that missing face through a null pointer. Which edge it
  leaves depends on memory layout, hence the random crashes. Kernel patch
  (`third_party/patches/SMLib/src/SmPrimitiveCreation.cpp`): the Boolean fails with
  `SM_ERR_BAD_INTERSECTIONS` there, and the checked route of C1 takes its next way. The union is
  right (area 219.190364, as OpenCASCADE) in 24 of 24 fresh processes; the 1134 results of the C1
  oracle families are as before. Both builds (smlibwasm's WebAssembly memory does not trap on such a
  read; the patch is in its kernel too).
- **Ellipse curves reach Python typed (C3).** SmPyLib registered B-spline curves, lines and circles
  but no ellipses, so pybind11 handed ellipse curves to Python as plain `Curve`s and every binding
  that takes a B-spline curve raised `TypeError`. Now `sweep(Circle(2), EllipticalArc((0, 0), 30,
  20, 0, 90))` is a valid body of 498.4275 (as smlibwasm already gave), `Part.project` of an
  ellipse gives its 2 pieces of 39.6632, `ruled()` between ellipse arcs works (396.636), and so do
  open-profile surface sweeps, `sweep(sharp_corners=False)` along paths with ellipses,
  `k.offset_curve` and `k.convert_to_lines_and_arcs`, also for ellipse edges of bodies (an oblique
  cut through a cylinder). Parabola and hyperbola curves are registered too. Python only (the wasm
  checked the kernel type already).
- **Helices of any number of turns (C4).** NLib caps its spiral fit at 1000 control points
  (`NL_CCPLIM`), so helices of more than 26 to 79 turns (by radius) failed with
  `SM_ERR_NOT_WITHIN_TOLERANCE`, and the API refuses more than 124.25 turns. The cap is raised at
  start (both modules; the kernel's own 3D tolerance check still applies), and `Helix` fits more
  than 120 turns in pieces of 100 whole turns joined into one B-spline edge. `Helix(2, 400, 20)`
  (200 turns) is 25135.87 long (exact 25135.92), its radius within 1e-4, its joints tangent within
  1e-6 rad; 1000 turns take 30 ms. Helices that worked before are unchanged (the cap was not hit).
- **`Edge.intersections` (C5)** no longer has a fixed tolerance of 0.001 and no longer raises where
  nothing is found (`ai/todo/selection.md` 3 and 11): see Behaviour changes.
- **`Stroke` takes splines and ellipses (C7).** `Stroke(Spline((0, 0), (10, 5), (20, 0)), 2)` raised
  `ModelingError: ... Stroke works on paths of lines and arcs`; it is now the band between the path's
  offsets (area 2 x length + pi to 1e-6 of the size), mixed paths with corners too (a quarter circle
  fitted as a cubic spline gives the area of the exact arc's stroke to 1e-6), a spline that crosses
  itself keeps the hole it encloses, closed spline paths give rings (area length x width).
- **The box of a free curve is exact (C9, `ai/todo/curves.md` 16).** `Edge.bbox()` of a constructed
  curve sampled 33 points: `Spline((0, 0), (1, 1), (2, 0), (30, 0)).bbox().max.y` was 0.7998 for a
  curve that reaches 1.0069. It is now the ends, the corners and the points where the tangent is
  perpendicular to an axis (`ext.curve_box`): 1.0069069109354, as OpenCASCADE's optimal box.
  (`SmCurve::CalculateTightBoundingBox` takes the corners of the whole curve, not of the interval, so
  smlibpy computes it itself.)
- **Sweep errors about the path's curvature give the numbers (C9).** `the profile may be too large for
  the path's curvature` now goes on `: the path bends with a radius of 4.556 at (9.259, 10.77, 10.65)
  (Edge.min_radius), and the profile reaches 5.59 from the path`.
- **`Part.project` fits within 1e-7 of the size (C12).** It went through `SmApiProjectCurve`, which
  passes no tolerance: a circle projected onto a sphere of radius 10 was 9.4e-5 off it, a circle of
  radius 5 on a box top 1.7e-4 off its radius and 5.3e-4 short. Now
  `SmBrep::CreateParallelProjectionCurves` with 1e-7 of the size of the body and the curve: 1.8e-6,
  3.5e-6 and 1.1e-5 (the helix flattened in `analysis/project`: 251.3268 against 251.3274 for its
  circles, was 251.3194).
- **`Wire.fillet` no longer skips corners silently (C15).** It rounded only corners between two
  lines and passed over corners at arcs and splines, and points that were no corner, without an
  error (`Wire([Line, ThreePointArc, Line]).fillet(2)` came back unchanged). Planar wires are now
  rounded as `Sketch.fillet` rounds regions: between lines and arcs exactly, next to splines and
  ellipses too (below); what cannot be rounded raises (see Behaviour changes).
- **Closed splines are curvature continuous at the seam (C13).** `Spline(..., closed=True)` set the
  seam tangent from the neighbouring points, so the curvature jumped there (0.0135 against 0.0574
  for the finding's six points, a kink in zebra and reflection pictures of extruded or lofted
  outlines); it is now the periodic cubic spline: 0.032472 on both sides.
- **`Spline` of many points is fast (C13).** The Python port built a dense matrix and every basis
  function in Python loops: 1600 points took 4.2 s. It now evaluates the four basis functions that
  are not zero at each point and solves the tridiagonal system: 5 ms (smlibwasm: 73 ms to 45 ms).
  Open splines are the same curves (control points within 1e-13).

## New

Python and TypeScript (`camelCase` in smlibwasm):

- `Edge.closest_point(p)` / `closestPoint`, `Edge.param_at(p)` / `paramAt`: the nearest point of an
  edge and its fraction along it (as `point_at` takes it). Shared with the A lane's A2 if it adds
  the same names.
- `Edge.trim(start, end)`, `Edge.split(at)`, `Wire.trim(start, end)`, `Wire.split(at)`: positions are
  fractions of the length or points on the edge or wire; the pieces keep their curves (a trimmed
  arc is a `circle` of the same radius; a spline split at an intersection adds up to its length to
  1e-14).
- `Edge.extend(distance, *, end="end", continuity="G1")` / `extend(d, { end, continuity })`: lines
  and arcs (circles, ellipses) go on as themselves; other curves straight along the end tangent
  (`"G1"`), with the end curvature (`"G2"`) or as their own polynomial (`"natural"`), by exactly
  the distance (the kernel's `CreateExtendedCurve` only estimates the length of G2 and natural
  extensions; smlibpy corrects it to 1e-10).
- `Wire.to_edge()` / `toEdge()`: a wire whose edges meet end to end (within 1e-6) as one B-spline
  edge (`SmBSplineCurve::CreateByJoining`), for single sweep and loft rails.
- `Edge.intersections(other, *, tolerance=None)` takes edges, wires, faces, bodies and lists of
  them; `Edge.intersection_params(other)` / `intersectionParams` gives the fractions;
  `Wire.intersections(other)`; `Edge.self_intersections()` / `selfIntersections`.
- Kernel layer (`k.ext`, both builds; src/cpp/curve_tools.cpp, js/cpp/bind_curve_tools.cpp):
  `intersect_curves(a, a0, a1, b, b0, b1, tolerance)` (`SmCurve::GlobalCurveIntersect` with
  overlaps as ranges), `self_intersections`, `intersect_curve_faces(curve, t0, t1, faces,
  tolerance)` (with the curve parameter of every point), `extend_curve(curve, distance, at_start,
  continuity)`. Python: `k.Ellipse`, `k.Parabola`, `k.Hyperbola`.
- Docs: docs/sketches.md ("Cutting, joining and extending curves"), docs/analysis.md
  (intersections), docs/parts.md (long helices), docs/kernel.md (four rows); skill references
  `curves/split`, `curves/extend`, `curves/to_edge`, `curves/intersections`, and updates to
  `curves/Helix`, `curves/EllipticalArc`, `curves/Wire`, `curves/generic`, `selection/Edge`.
- **Offsets of edges and wires (C7).** `Edge.offset(distance, *, plane=None)` / `offset(d, { plane })`
  and `Wire.offset(distance, *, corners="round", plane=None)` / `offset(d, { corners, plane })`: a
  parallel curve in the curve's plane, open ones to the left for a positive distance (seen from the
  plane's normal: +Z for a curve at one height, else the fitted plane's normal toward +Z, +Y, +X),
  closed ones outward. Lines and arcs exactly (`_planar.offset_chain`); splines and ellipses by
  `SmBSplineCurve::CreateSimpleOffset` within 1e-6 of the size (measured at 129 points; the kernel's
  own `k.offset_curve` is 7e-4 off), with exact end points. Corners that open: `"round"`, `"sharp"`,
  `"chamfer"`; corners that close: cut where the offsets cross. Refused with the place: a curve that
  bends more tightly than the distance on that side (found by the kernel's global solver, so before
  any cusp is built), an edge that vanishes, an offset that runs into itself. A closed wire of two
  splines offset by +-1 and +2 bounds the region `Sketch.offset` gives to 1e-5. `operations.offset`
  takes wires and edges (in smlibwasm too).
- **`fit_curve(points, *, tolerance=None, degree=3, tangents=None, closed=False)` / `fitCurve(points,
  { ... })` (C8):** a B-spline within the tolerance (default 1e-3 of the points' size) of every
  point with few control points (`SmBSplineCurve::ApproximatePoints` with a tolerance; the SM_API
  approximation has none): 600 noisy points, tolerance 0.05: 32 control points (Spline: 602). The
  deviation is measured and the fit made again with less where the kernel's is off; a fit that
  stays off raises `ModelingError` naming the distance. Closed curves pass through the first point
  again, tangent there. Few points fall back to `Spline`.
- **`Spline(..., tangents=[...])` with one direction per point (C8):** through each point in its
  direction (`SmBSplineCurve::CreateInterpolatingCurve`), exact at the points.
- **Curvature of edges (C9):** `Edge.curvature_at(t)` / `curvatureAt`, `Edge.radius_at(t)` /
  `radiusAt`, `Edge.min_radius()` / `minRadius()` -> `(radius, t)` (the kernel's global solver;
  3.997484385833467 for the spline of the finding, as OpenCASCADE), `Edge.inflections()` (fractions
  where the bend flips; 14.951, 0.995 as OpenCASCADE), `Wire.min_radius()`.
- **Lines and arcs (C10):** `Edge.to_arcs(tolerance=0.01)` / `toArcs`, `Wire.to_arcs`: lines and
  circular arcs within the tolerance both ways, joined tangentially (`SubdivideToLinesAndArcs` asked
  for a tenth, as NLib fits arcs within ten times what it is given, less while the result is off;
  the spans come back as separate exact lines and arcs): 26 arcs at 0.01, 52 at 0.001 for the
  finding's spline (the kernel's call: one rational B-spline 0.0037 off for 0.001).
  `export_dxf(..., curves="arcs", tolerance=0.01)` / `{ curves: 'arcs', tolerance }` writes splines
  and ellipses as LINE and ARC.
- Kernel layer (`k.ext`, both builds; src/cpp/curve_ops.cpp, js/cpp/bind_curve_ops.cpp):
  `offset_curve(curve, normal, distance, tolerance)` -> `(curve, deviation, tight)`,
  `approximate_points(points, degree, tolerance, start_tangent, end_tangent, closed)`,
  `interpolate_tangents(points, tangents, degree)`, `curve_geometry(curve, t)` (EvaluateGeometric),
  `curve_properties(curve, t0, t1, kind, value, tolerance)` (GlobalPropertyAnalysis: inflections,
  min_radius, max_radius, radius), `curve_box(curve, t0, t1)`, `lines_and_arcs(curve, tolerance)`.
- Docs: docs/sketches.md ("Parallel curves, fitted curves, lines and arcs", strokes along splines),
  docs/analysis.md ("Curvature of edges"), docs/files.md (DXF with lines and arcs), docs/kernel.md
  (four rows), docs/javascript.md API section; skill references `curves/offset`, `curves/fit_curve`,
  `curves/min_radius`, `curves/to_arcs` (new) and updates to `sketches/Stroke`, `curves/Spline`,
  `curves/Wire`, `curves/generic`, `selection/Edge`, `files/export_dxf`, SKILL.md; todo curves 16
  fixed, sketches 19 worked around.

- **Edges from NURBS data (C11):** `Edge.from_nurbs(nurbs)` / `Edge.fromNurbs(nurbs)` takes a `Nurbs`
  (as `edge.nurbs()` gives) or `(degree, knots, points, weights)` (smlibwasm: `{ degree, knots,
  points, weights }`): any degree from 1 to 32, many spans, unclamped knots (a uniform B-spline starts
  at (P0 + 4 P1 + P2) / 6), rational. The data are checked with clear errors where the kernel said
  only `SM_ERR` (the knot count, knots that decrease or repeat too often, weights) or took a knot
  vector of the wrong length without a word.
- **Curves on faces (C12):** `Part.project(curve, direction, *, nearest=False)` / `project(curve,
  direction, { nearest })`: `nearest=True` keeps what the curve sees along the direction (the near
  side of a sphere; the top of a plate cut by its hole, not the bottom and the walls; on a step seen
  obliquely, the part of the low step the high one does not hide), cut where that changes.
  `Face.project(curve)`: the normal projection onto a face (each point to its nearest point of the
  surface, `SmBrep::CreateNormalProjectionCurves` within 1e-8 of the size, trimmed to the face).
  `Face.iso(u=None, v=None)`: the curves of constant parameter (a fraction of the face's range),
  trimmed to the face. `Face.wrap(shape, at=None, *, direction=None)`: a drawing on XY laid onto the
  face as a label, lengths kept along the face's two parameter lines through `at` (exact on planes
  and cylinders: a line 40 long around a cylinder of radius 10 is 40 long, its ends 4 rad apart),
  across a closed face's seam, cut to the face and its holes, within 1e-7 of its size.
- **Conic arcs and flat spirals (C14):** `ParabolicArc(vertex, focal_length, start, end, plane)`,
  `HyperbolicArc(center, x_radius, y_radius, start, end, plane)`, `ConicArc(start, apex, end,
  rho=0.5)`: exact (rational) quadratics; `Spiral(start_radius, end_radius, turns, plane, *,
  clockwise=False)`: a flat Archimedean spiral (the kernel's helix fit flattened onto the plane,
  within 1e-4 as `Helix`), from or to the center, of any number of turns, sweepable.
- **Fillets and chamfers at splines and ellipses (C15):** `Sketch.fillet`, `Sketch.chamfer` and
  `Wire.fillet` round (bevel) corners next to splines and ellipses: the arc's center where the two
  curves' offsets meet (`Edge.offset`, of the part next to the corner where the curve bends too
  tightly farther away), refined by Newton until it lies at the radius from both curves; the curves
  are cut where the arc touches them and stay what they were. Against OpenCASCADE's
  `ChFi2d_FilletAPI`: the same centers (1.2e-13; 5e-8 where OpenCASCADE's own center is 4.4e-8 off
  its line), and no arc where OpenCASCADE finds none. (SMLib's `SmCurveFilletExecutive` is not used:
  unused and untested in the kernel, with side-selection bugs.)
- **Editing edges (C16):** `Edge.through(point, *, tangent=None, at=None)`: the smallest move of the
  control points that passes the point (and has the direction there), ends and end tangents kept,
  knots inserted near the point when too few control points act there; exact (1e-14). Lines and
  arcs become cubic (rational) B-splines. `Edge.match(*, start=None, end=None, start_tangent=None,
  end_tangent=None)`: `SmCurve::DeformToEndPointTargets`, the ends exactly on their targets (to snap
  a curve onto another with G1).
- Kernel layer (`k.ext`, both builds; src/cpp/curve_edit.cpp, src/cpp/curve_project.cpp,
  js/cpp/bind_curve_edit.cpp): `refine_curve(curve, degree, knots)`, `deform_ends(curve, start, end,
  start_tangent, end_tangent)` -> `(curve, deviation)`, `project_curve(faces, curve, direction,
  tolerance, distance=0)` and `normal_project(faces, curve, tolerance)` -> `[(curve, face index)]`,
  `iso_curves(face, along_v, value, tolerance)`, `trim_to_face(face, curves, tolerance)`.
- Docs: docs/sketches.md (conic arcs, spirals, NURBS data, "Editing curves", fillets at splines),
  docs/analysis.md (projections, curves on faces), docs/surfaces.md, docs/kernel.md (five rows, the
  SM_API projection defects under the limitations), docs/javascript.md API section; skill references
  `curves/ParabolicArc`, `curves/HyperbolicArc`, `curves/ConicArc`, `curves/Spiral`,
  `curves/from_nurbs`, `curves/through`, `curves/match`, `surfaces/iso`, `surfaces/wrap` (new) and
  updates to `analysis/project`, `curves/Wire`, `curves/Spline`, `curves/generic`, `curves/nurbs`,
  `curves/Helix`, `sketches/fillet`, `sketches/chamfer`, SKILL.md.

## Behaviour changes

- **`Edge.intersections` returns `[]` where the edges do not meet** instead of raising
  `KernelError: edge intersections failed (SM_ERR)`.

  ```python
  # before
  try:
      pts = a.intersections(b)
  except KernelError:
      pts = []
  # after
  pts = a.intersections(b)
  ```

- **Its tolerance is 1e-6, or 1e-9 of the size of the two shapes where that is larger** (it was
  0.001 absolute). Lines that miss each other by 0.0005 no longer cross, nor do parallel lines of a
  0.01 mm part. Scripts that relied on near misses counting pass the old tolerance:

  ```python
  # before: crossed at (5, 0, 0)
  Line((0, 0, 0), (10, 0, 0)).intersections(Line((5, -5, 0.0005), (5, 5, 0.0005)))
  # after: [] by default; the old behaviour
  Line((0, 0, 0), (10, 0, 0)).intersections(Line((5, -5, 0.0005), (5, 5, 0.0005)), tolerance=1e-3)
  ```

- **Each point once, overlaps by both ends, in order along the edge.** The start of a closed curve
  came twice (`Circle(5)`'s edge and a line through it: `[(-5, 0, 0), (5, 0, 0), (5, 0, 0)]`, now
  two points); overlapping collinear segments gave one point, now the two ends of the overlap.
  Code that took `pts[0]` of an overlap gets the same first point; code that counted the seam twice
  gets one less.
- **`e.intersections(e)` raises `ValueError`** (it returned the self-crossings of the curve).

  ```python
  # before
  crossings = e.intersections(e)
  # after
  crossings = e.self_intersections()
  ```

- smlibwasm: the same, as `intersections(other, { tolerance })`.
- `type()` of an ellipse curve from `smlibpy._core` is `Ellipse` (was `Curve`); it is an instance
  of `k.BSplineCurve` now. Only code that works with `_core` directly can see it.
- `k.boolean_2d` (and so the sketch Booleans' first way) fails with `SM_ERR_BAD_INTERSECTIONS` in the
  cases where it crashed; no other result changed.
- **`Edge.bbox()` of a free curve is the exact box** (it sampled 33 points and could be too small).
  Boxes of splines grow where the sampling missed an extreme; lines, arcs and edges of bodies are as
  before. Code that sampled `point_at` for a safe box can use `bbox()`:

  ```python
  # before: bbox() of a constructed spline could miss its extremes
  pts = [s.point_at(i / 1000) for i in range(1001)]
  top = max(p.y for p in pts)
  # after
  top = s.bbox().max.y
  ```

- **`Stroke` along splines and ellipses makes the band** instead of raising `ModelingError`. A spline
  that bends more tightly than half the width still raises (`... bends more tightly than the
  distance ...`).

  ```python
  # before
  try:
      band = Stroke(path, 3)
  except ModelingError:
      band = None          # (or the path approximated with arcs)
  # after
  band = Stroke(path, 3)
  ```

- **`Spline(..., tangents=...)` reads a list as long as the points as one direction per point.**
  Before, only the first two entries counted (start and end) and the rest was ignored; a single entry
  raised `IndexError`. Now two entries are start and end as before, as many as the points (three or
  more) are per point, and any other number raises `ValueError`.

  ```python
  # before: the third tangent was ignored
  Spline(a, b, c, tangents=(t0, t1, t2))
  # after: the same curve as before
  Spline(a, b, c, tangents=(t0, t1))
  ```

- **Sweep errors about the path's curvature are longer**: the hint goes on with the path's smallest
  radius, where it is and how far the profile reaches. Code that matched the whole message should
  match its start (`"the profile may be too large for the path's curvature"`).
- smlibwasm: `offset(shape, d, options)` is generic (`offset<S extends Part | Sketch | Wire | Edge>`,
  returning the type it is given; it returned `Part | Sketch`), `Spline`'s `tangents` option is
  `readonly (VectorLike | null)[]` (it was a pair), and `exportDxf` / `toDxf` take `curves` and
  `tolerance`.

- **`Part.project` returns `[]` for a curve that misses the body** (it raised `KernelError: project
  failed (SM_ERR)`), and its pieces have more control points (fitted within 1e-7 of the size, not
  about 1e-4).

  ```python
  # before
  try:
      pieces = part.project(curve)
  except KernelError:
      pieces = []
  # after
  pieces = part.project(curve)
  ```

- **`Wire.fillet` rounds corners at arcs, splines and ellipses** (planar wires), which it skipped:
  wires with such corners come back with more edges. Scripts that relied on the skip name the
  corners to round:

  ```python
  # before: only the line-line corner was rounded, the arc's corners stayed sharp
  w.fillet(2)
  # after: the same result
  w.fillet(2, [corner])     # the line-line corner's point
  ```

- **`Wire.fillet` raises where it ignored:** a point that is not a corner (`ModelingError: fillet:
  (55, 55) is not a corner of the wire; its corners are at ...`, an end of an open wire `... is an
  end of the open wire, not a corner`), a named smooth corner (`... is smooth ...`), an empty list of
  corners (`ValueError: ... the selection is empty`), and in a wire that is not planar a sharp corner
  next to an arc or a spline (`ModelingError: ... not planar ...`). Pass only corners
  (`[v for v in points if ...]`). A radius that does not fit still raises `ValueError`, worded as
  `Sketch.fillet` words it (`fillet: radius 5.001 at (20, 0) and radius 5.001 at (20, 10) overlap on
  the line ...`; it was `fillet radius 5.001 is too large for the edge ...`); match `ValueError`, not
  the text.
- **`Sketch.fillet` and `Sketch.chamfer` round corners next to splines and ellipses** instead of
  raising `ModelingError: ... works on corners between lines and arcs`; with no corners named, every
  sharp corner, those at splines too.

  ```python
  # before: the spline corners had to be left out
  rounded = s.fillet(2, s.vertices().filter(lambda v: v.x < 5))
  # after: the same call works, and so does
  rounded = s.fillet(2)
  ```

- **`Spline(..., closed=True)` without tangents is periodic** (curvature continuous at the seam): the
  curve changes (0.64 mm at most for the six uneven points of the finding; little for even ones).
  The old curve, with the old tangent at the seam:

  ```python
  # before
  s = Spline(*pts, closed=True)
  # after: the same curve as before
  d = Vector(pts[1]) - Vector(pts[-1])
  s = Spline(*pts, tangents=(d, d), closed=True)
  ```

  A closed spline of two points raises `ValueError: a closed spline needs at least three points`
  (it raised `ValueError: cannot normalize a zero-length vector`).
- smlibwasm: `project(curve, direction, options)` and `Spiral(..., plane, options)` take options;
  `Face.iso(u, v)` takes `null` for the parameter not given (`iso(null, 0.5)`).

## Not done

- C1 follow-up: why the planar intersection leaves a coincident edge as a wire edge (and why only
  in some memory layouts) is not located; the kernel patch turns the crash into an error, and the
  checked route then gives the right region. AddressSanitizer never takes that path (its allocator
  lays memory out the same way every run), so the null read was found with lldb in the normal build;
  ASan reports nothing for the patched kernel on the lane's tests and the C1 oracle families.
- Sweeps along helices still have a limit of their own: `sweep(Circle(1.2), Helix(3, 3 * n, 20))`
  works for 60 turns and fails for 100 (`the profile may be too large for the path's curvature`).
  Documented in `curves/Helix`.
- `Wire.trim` and `Edge.trim` keep the part from start to end only; the part of a closed edge across
  its start is two trims (documented).
- C7: offsets of curves that are not planar (an `offset_3d` sideways from a direction, which
  `CreateSimpleOffset` could do) are not added: `offset` takes planar curves (with `plane=` for
  straight ones). A closed single edge with a corner at its start that the offset closes raises
  (split it there). Where a spline bends more tightly than the distance, the offset is refused rather
  than trimmed (a region offset, `Sketch.offset`, handles that for closed outlines); `Stroke` along
  such a spline raises where a line and arc path would fill the center.
- C8: `fit_curve` with a tangent at every point and a tolerance (the kernel has no such fit): a
  direction at every point is interpolation, `Spline(..., tangents=[...])`. Closed fits are tangent
  but not curvature continuous at the seam with a tolerance (the closed fit without one is).
- C9: `Wire.continuity()` (the joints' G0/G1/G2) belongs to A4 and is not here; of
  `GlobalPropertyAnalysis` only inflections and radius extrema are public (`ext.curve_properties`
  has `radius`, `min_radius`, `max_radius` too).
- C12: the optional kernel patch K9 (`SmApiProjectCurve` and `SmApiDropCurveToSrf` with model
  tolerances) is not made: smlibpy calls neither (`Face.project` calls
  `SmBrep::CreateNormalProjectionCurves`), and the defect of the raw `k.project_curve_to_surface` is
  recorded in docs/kernel.md. `Face.wrap` keeps lengths along the two parameter lines through `at`
  only: on cones and doubly curved faces the drawing stretches away from them (no developed or
  geodesic mapping), and curves wrapped or projected across a closed face's seam come back cut there
  (join them with `Wire.to_edge()`). `nearest=True` classifies 17 points of each piece (and bisects
  between those that differ), so a visible part shorter than 1/17 of a piece between two hidden
  points is missed.
- C15: a wire that is not planar is rounded only between lines (its corners next to other curves
  raise).
- C16: `through` moves the control points near the point only (a point far from the edge makes a
  bump; it does not fair the whole curve), and a `Wire.match_to(edge, continuity=...)` that snaps a
  whole wire is not added.
