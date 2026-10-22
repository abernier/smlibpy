# Defects and surprises: analysis

## HIGH

### 1. `Part.distance_to(body)`: wrong when the nearest points form a line (parallel cylinders)
- **Fixed:** distance_to between bodies is computed by smlibpy: mesh vertices nearest to the other body seed alternating exact closest-point projections; parallel cylinders give 12.0.
- **Fixed again (kernel plan A1):** between nearly parallel faces the alternating projections stopped short: cylinders 2 mm apart and skew by 1, 5 and 10 degrees gave 2.1197, 2.4853 and 2.0162. `ext.nearest_points` finishes each seed with damped Newton on the faces' parameters: 2.0 for all three, and none of 101 random pairs off OpenCASCADE by more than 1e-15 of the distance; a warning comes where the points do not settle.
- **Session:** `2026-10-12_21-35-12_analysis-queries`, scripts `05-distance-cylinders.py`, `06-distance-survey.py`, `07-distance-workaround.py`
- **What happens:** two parallel cylinders give a distance that is too small by 1.7 to 3.6 mm,
  silently, at the origin. A cylinder beside a box face parallel to its axis: 7.22 instead of
  10. All other pairs tried (spheres, boxes, skew/perpendicular/coaxial cylinders, cones, tori,
  shaft in hole) are exact.
- **Expected:** 12.0 (gap between r5 and r3 cylinders whose axes are 20 apart).
- **Reproduce:**
  ```python
  from smlibpy import *
  print(Cylinder(5, 20).distance_to(Cylinder(3, 20).translate(20, 0, 0)))   # 10.3331, expected 12
  print(Cylinder(5, 20).distance_to(Box(10, 10, 30).translate(20, 0, 0)))    # 7.2218, expected 10
  ```
- **Workaround:** alternate `closest_point` between the two bodies (50 steps converge to 12.0);
  documented in `distance_to.md`.

### 2. `Part.distance_to(body)`: wrong far from the origin
- **Fixed:** same computation (closest points only), exact far from the origin.
- **Session:** `2026-10-12_21-35-12_analysis-queries`, scripts `03-distance-far.py`, `04-distance-far-threshold.py`
- **What happens:** the same sphere pair gives 13.9129 near the origin and up to
  (7e3, -1.4e4, 2.1e4), but 15.5610 at (1e4, -2e4, 3e4) and at (1e5, 0, 0) or (1e6, 0, 0). The
  error is +1.65 mm, so the reported clearance is larger than the real one. Point distances
  and box pairs stay right at 1e6.
- **Expected:** 13.9129 wherever the pair is.
- **Reproduce:**
  ```python
  from smlibpy import *
  a = Sphere(7).translate(1e5, 0, 0)
  b = Sphere(2).translate(1e5 + 10, 20, -5)
  print(a.distance_to(b), math.sqrt(525) - 9)   # 15.5610 13.9129
  ```
- **Workaround:** move both bodies by the same vector to near the origin before measuring.

## MEDIUM

### 3. `Part.is_valid()`: True for a body with zero volume and for a self-overlapping sweep
- **Fixed:** is_valid() requires a positive volume and revolve raises for an axis through the region; self-overlapping sweeps are still not detected.
- **Reopened, fixed again (kernel plan B2):** Boolean results were marked sound when they were made, so `is_valid()` never integrated them: an intersection of two cylinders larger than its operand (250.206 against 150.796) was valid. `is_valid()` now integrates every result once when asked, and is also False where the gaps between the faces make the volume uncertain by 1e-2 or more; that intersection now raises in the Boolean itself (B3).
- **Session:** `2026-10-12_21-26-12_analysis-measures`, scripts `13-is-valid-info.py`, `14-validity-detection.py`
- **What happens:** a rectangle revolved about an axis through its middle returns a Part with
  `is_valid() == True` and volume -1.8e-21 (it looks like a cylinder). A circle r4 swept along
  a helix of pitch 5 overlaps itself; `is_valid()` is True and the volume counts the overlap
  twice (12673 = pi·16·L). Fuse, cut and intersect do not repair it. `recipes/modeling.md` says
  a profile across the axis "makes an invalid body", but `is_valid()` does not report it.
- **Expected:** `revolve` raises for a profile that crosses the axis (or `is_valid()` is False);
  a check that can detect self-intersection.
- **Reproduce:**
  ```python
  from smlibpy import *
  bad = Rectangle(10, 10).revolve(Axis((0, 0, 0), (0, 1, 0)))
  print(bad.is_valid(), bad.volume)                          # True -1.8e-21
  spring = sweep(Circle(4), Helix(5, 20, 10))
  print(spring.is_valid(), spring.volume)                    # True 12673.0
  ```
- **Workaround:** check `volume > 0` and against a formula; documented in `is_valid.md`.

### 4. `mass_properties(density=...)`: density 0 or negative silently becomes 1
- **Fixed:** ValueError for density <= 0.
- **Session:** `2026-10-12_21-26-12_analysis-measures`, scripts `05-inertia-formulas.py`, `06-mp-special.py`
- **What happens:** `Box(10, 10, 10).mass_properties(density=0).mass` is 1000.0, the same for
  `density=-1`; the inertia is that of density 1. `MassProperties.density` reports the value
  passed in (0.0), which contradicts the mass.
- **Expected:** mass 0 (or a `ValueError` for density <= 0).
- **Reproduce:**
  ```python
  from smlibpy import *
  mp = Box(10, 10, 10).mass_properties(density=0.0)
  print(mp.mass, mp.density)                                 # 1000.0 0.0
  ```
- **Workaround:** pass a positive density.

### 5. `ACCURACY` docstring and docs overstate the accuracy of volumes
- **Fixed:** volume, area, center and inertia are integrated by smlibpy (src/cpp/measure.cpp) with an error estimate for each and refined to a tenth of `accuracy`; measured against closed forms 1e-10 and better, the triangle along a helix to 1e-15 of its 1e-10 integration. Docs and guides state the measured accuracy; tests/test_measure.py holds it.
- **Session:** `2026-10-12_21-26-12_analysis-measures`, scripts `02-accuracy-param.py`, `08-spring-convergence.py`, `09-realistic-parts.py`
- **What happens:** `shapes.ACCURACY` says "The error of the results is usually far below it";
  `docs/analysis.md` and `docs/kernel.md` say volumes are integrated "to a relative accuracy of
  1e-7". Measured: analytic bodies 1x to 3x the requested accuracy (sphere 2.3e-7, torus 2.4e-7
  at 1e-7); swept bodies much worse: a triangle swept along a 20-turn helix is 1.4e-5 off at
  1e-7 (140x), 1e-3 off at 1e-5; a bent pipe 3.6e-6. The area converges, the volume does not:
  the kernel controls its steps by the area only.
- **Expected:** docs that state the real error, or a volume integration with its own error
  control.
- **Reproduce:**
  ```python
  from smlibpy import *
  tri = sweep(Polygon((-1, 0), (1, 0), (0, 1.5)), Helix(5.0, 100.0, 10.0))
  print(tri.volume, tri.mass_properties(accuracy=1e-11).volume)   # 1883.66225 1883.68857
  ```
- **Workaround:** `mass_properties(accuracy=1e-10)` for swept bodies (seconds).

### 6. `intersection_curves` and `project` raise when nothing is hit
- **Session:** `2026-10-12_21-35-12_analysis-queries`, scripts `10-intersection-curves.py`, `18-project.py`
- **What happens:** disjoint or nested bodies raise `KernelError: intersection curves failed
  (SM_ERR)`; a curve that misses the body raises `KernelError: project failed (SM_ERR)`. The
  message does not say that there was simply no intersection.
- **Expected:** an empty `ShapeList`.
- **Reproduce:**
  ```python
  from smlibpy import *
  Box(20, 20, 20).intersection_curves(Box(5, 5, 5).translate(50, 0, 0))   # KernelError
  Sphere(10).project(CenterArc((0, 0, 30), 15, 0, 360), (0, 0, -1))      # KernelError
  ```
- **Workaround:** `try/except KernelError`.

## LOW

### 7. `mass_properties(accuracy=...)`: misleading error and unchecked values
- **Fixed:** ValueError for accuracy outside 1e-10..1e-2.
- **Session:** `2026-10-12_21-26-12_analysis-measures`, script `02-accuracy-param.py`
- **What happens:** `accuracy=1e-12` on a sphere, `1e-14` on anything and `-1` raise
  `KernelError: mass properties failed (SM_ERR): is the part a closed solid?`; the part is
  fine. `accuracy=0` silently means the default (`accuracy or ACCURACY`). `accuracy=1` returns a
  volume 1.5 % off without a warning.
- **Expected:** a `ValueError` naming the usable range (about 1e-10 .. 1e-2).
- **Reproduce:** `Sphere(10).mass_properties(accuracy=1e-12)`

### 8. `Edge.bbox()` of a standalone curve is sampled and too small
- **Session:** `2026-10-12_21-26-12_analysis-measures`, script `15-bbox-accuracy.py`
- **What happens:** for an edge not taken from a body, `bbox()` uses 33 points. A wavy spline
  gives y min -2.9599 instead of -3.0290. The same curve extruded into a part has the exact box.
- **Reproduce:**
  ```python
  from smlibpy import *
  sp = Spline((0, 0), (10, 5), (20, -3), (30, 8), (35, 0))
  print(sp.bbox().min.y, min(sp.point_at(i / 20000).y for i in range(20001)))   # -2.9599 -3.0290
  ```
- **Workaround:** sample `point_at` densely, or measure a body made from the curve.

### 9. `distance_to` argument types: confusing errors; no `closest_point` on Face and Edge
- **Fixed:** distance_to raises TypeError "takes a point or a body" for edges, faces and wires (no closest_point on Face/Edge yet).
- **Session:** `2026-10-12_21-35-12_analysis-queries`, scripts `01-distance-basic.py`, `02-distance-curved.py`
- **What happens:** `part.distance_to(edge)` -> `TypeError: 'Edge' object is not iterable`;
  `edge.distance_to(part)` / `face.distance_to(part)` -> `TypeError: 'Part' object is not
  iterable`; `part.distance_to([other])` -> `ValueError: expected 2 or 3 coordinates, got 1`.
  `Face` and `Edge` have no `closest_point`.
- **Expected:** a clear message ("distance_to takes a point or a Part/Shell/Sketch"), or support
  for edges and faces.

### 10. Docstrings of the queries say too little
- **Session:** `2026-10-12_21-35-12_analysis-queries`, scripts `14`..`16`, `18`, `21`, `22`
- **What happens:** `Part.closest_point` has no docstring. `outline` says "the body's edges
  projected onto a plane", but it removes hidden lines, adds contours of curved faces, merges
  coincident lines and looks from the side the normal points to. `silhouette` does not say that
  the direction points towards the viewer, that only the visible part comes back (a torus from
  the side: half), and that face boundary edges are included. `project` does not say that
  every face along the projection line gets a piece (both sides of the body) and that results
  are fits (radius error 1.7e-4 for a circle on a flat face). `distance_to` does not say that
  points inside and nested bodies give the distance to the surface.

### 11. `silhouette`: slivers and inconsistent rim pieces
- **Session:** `2026-10-12_21-35-12_analysis-queries`, scripts `15-silhouette-pieces.py`, `16-silhouette-torus-side.py`
- **What happens:** `Torus(20, 5).silhouette((1, 0, 0))` returns 3 pieces of 9e-6, 1.8e-5 and
  2.5e-4 mm besides the real ones. `Cylinder(5, 20).silhouette((1, 0, 0))` returns the two
  contour lines and 7 of the 8 quarter arcs of the rims (3 at the top, 4 at the bottom, front
  and back halves mixed).
- **Expected:** no degenerate pieces; a consistent rule for faces seen edge-on.

### 12. `intersection_curves` with coincident faces
- **Session:** `2026-10-12_21-35-12_analysis-queries`, script `10-intersection-curves.py`
- **What happens:** two 20 mm boxes sharing a face return 6 pieces of total length 120 (the
  shared face has perimeter 80), mixed `line` and `bspline`; a body with itself returns each
  of its 12 edges twice.
- **Reproduce:** `Box(20, 20, 20).intersection_curves(Box(20, 20, 20).translate(20, 0, 0))`

### 13. Other domains, seen in passing
- `Helix(5, 200, 10)` (40 turns) raises `KernelError: Helix failed (SM_ERR_NOT_WITHIN_TOLERANCE)`;
  20 turns work (curves). Session `2026-10-12_21-26-12_analysis-measures`, `04-hard-bodies.py`.
- `Sphere(7).translate(*np.array([1, 2, 3]))` raises `TypeError: 'numpy.int64' object is not
  iterable`: `translate` checks `isinstance(x, (int, float))`, which numpy integers fail
  (geometry). Session `2026-10-12_21-35-12_analysis-queries`, first run of `03-distance-far.py`.
- `Wire(pieces)` of edges forming two separate loops returns a wire with `is_closed == False`
  and no error (curves). Session `2026-10-12_21-35-12_analysis-queries`, `13-wire-from-pieces.py`.
