# Defects and surprises: curves

## HIGH

### 10. `sweep` along a closed single-edge path: inside-out or empty body reported as valid
- **Fixed:** a closed single-edge path is split into two halves before sweeping; arc and spline paths give valid rings.
- **Session:** `2026-10-12_21-31-43_curves-arcs`, scripts `10-arc-path.py`, `11-closed-path.py`
- **What happens:** `sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))` returns a Part with
  `is_valid() == True`, volume -1579.13 (inside out, 3 faces, the picture shows a flat disk).
  `sweep(Circle(2), Spline((20,0),(0,20),(-20,0),(0,-20), closed=True))`: `is_valid() True`,
  volume 0.0. No error.
- **Expected:** a torus-like ring with volume +1579.137 (what `revolve` and a path of two half
  circles give), or an error.
- **Reproduce:**
  ```python
  r = sweep(Circle(2), CenterArc((0, 0), 20, 0, 360)); print(r.is_valid(), r.volume)
  ```
- **Workaround:** `Wire([CenterArc(c, r, 0, 180), CenterArc(c, r, 180, 180)])` as path, or
  `revolve`; for splines two open splines with matching tangents.

## MEDIUM

### 1. `Shape.mirror` / `Shape.scale`: lines and arcs become B-splines, wire and sketch fillets then skip corners silently
- **Fixed:** lines()/parallel_to/direction and wire fillets treat straight B-spline edges as straight, so mirrored outlines fillet all corners (geom_type still reports bspline).
- **Fixed (2026-10-13):** mirrors and uniform scales rebuild lines and circles exactly (`geom_type` `line` / `circle`,
  `radius` works); sketches are mirrored segment by segment.
- **Session:** `2026-10-12_21-25-59_curves-lines-wires`, script `03-mirror-geomtype.py`
- **What happens:** `Line(...).mirror(Plane.XZ).geom_type` and `.scale(2).geom_type` are
  `"bspline"` (same for `CenterArc`). `direction` and `radius` then raise. The pattern from
  `docs/sketches.md` (`outline = half + half.mirror(Plane.XZ)`) gives a wire whose
  `fillet(2)` rounds only the 2 corners between unmirrored lines; `make_face(...).fillet(2)`
  likewise (area 798.283 instead of 796.566). No error, no warning.
- **Expected:** a mirrored line is a line, a mirrored arc is an arc (both are rigid motions
  with a reflection; the kernel can rebuild lines and circles exactly).
- **Reproduce:**
  ```python
  half = Polyline((-20, 0), (-20, 10), (20, 10), (20, 0))
  full = half + half.mirror(Plane.XZ)
  print([e.geom_type for e in full.edges()])          # 3 x bspline, 3 x line
  print(len(full.fillet(2).edges()))                   # 8, expected 10 (4 corners rounded)
  ```
- **Workaround:** build the full outline from points; fillet before mirroring.

### 2. `make_face` / `Wire.to_sketch`: sketch normal ignores the plane the wire was drawn on
- **Session:** `2026-10-12_21-25-59_curves-lines-wires`, script `10-sketch-normal.py`
- **What happens:** `Sketch._from_wires` flips the fitted normal to +Z, or for vertical
  planes to +X/+Y. A wire placed with `.on(Plane.XZ)` gives a sketch with normal +Y, while
  `Rectangle(...).on(Plane.XZ)` has -Y; the same for `Plane.left` (+X instead of -X) and
  `Plane.bottom` (+Z instead of -Z). `extrude(5)` therefore goes to the opposite side.
- **Expected:** a consistent rule, e.g. the normal from the wire's travel direction or the
  plane the wire was placed on; at least documented in the docstrings of `make_face` and
  `to_sketch`.
- **Reproduce:**
  ```python
  w = Polyline((-10, -5), (10, -5), (10, 5), (-10, 5), close=True).on(Plane.XZ)
  print(w.to_sketch().plane.z_dir, Rectangle(20, 10).on(Plane.XZ).plane.z_dir)   # (0,1,0) (0,-1,0)
  ```
- **Workaround:** `make_face(wire_drawn_on_xy).on(plane)`.

### 3. `Wire`: edges that do not connect are accepted silently; sweep along them returns an invalid part
- **Fixed:** sweep raises ValueError for a path whose edges do not connect (Wire itself still accepts them).
- **Session:** `2026-10-12_21-25-59_curves-lines-wires`, scripts `06-wire-ordering.py`, `11-wire-paths.py`
- **What happens:** `Wire([Line((0,0),(10,0)), Line((20,0),(30,0))])` and a T branch are
  accepted ("open" wire, edges in the given order). `sweep(Circle(1), gap_path)` returns a
  Part with `is_valid() == False`, volume 0, 2 solids, no error.
- **Expected:** `Wire` raises (or at least `sweep` raises) when the edges do not form one
  chain.
- **Reproduce:**
  ```python
  p = Wire([Line((0, 0, 0), (0, 0, 10)), Line((0, 0, 20), (0, 0, 30))])
  s = sweep(Circle(1), p); print(s.is_valid(), s.volume)    # False 0.0
  ```
- **Workaround:** check `wire.start`, `wire.end`, `is_closed` before using a wire.

### 4. `Wire.fillet`: negative radius gives a broken wire silently
- **Fixed:** ValueError "the radius must be positive".
- **Session:** `2026-10-12_21-25-59_curves-lines-wires`, script `08-wire-fillet.py`
- **What happens:** `Polyline(...20x10 rectangle..., close=True).fillet(-1)` returns an 8-edge
  wire of length 86.85 (the original is 60). `fillet(0)` raises
  `ValueError: cannot normalize a zero-length vector`.
- **Expected:** `ValueError: radius must be positive` for both.
- **Reproduce:** `Polyline((0,0),(20,0),(20,10),(0,10), close=True).fillet(-1).length`
- **Workaround:** pass positive radii only.

### 5. `PolarLine`: `start` is a world point, the plane's origin is ignored
- **Session:** `2026-10-12_21-25-59_curves-lines-wires`, script `05-polarline.py`
- **What happens:** `PolarLine((1, 2), 10, 0, plane=Plane.XY.offset(5))` starts at (1, 2, 0).
  `CenterArc` takes its center in plane coordinates, so the two disagree.
- **Expected:** one convention for all curve constructors with `plane=` (plane coordinates
  as in CenterArc), or a docstring that says "start in world coordinates".
- **Reproduce:** `print(PolarLine((1, 2), 10, 0, plane=Plane.XY.offset(5)).start)`
- **Workaround:** give the world start point.

### 11. `CenterArc`: `arc_size=0` returns a full circle
- **Fixed:** `ValueError: CenterArc: arc_size must not be zero (360 is a full circle)`.
- **Session:** `2026-10-12_21-31-43_curves-arcs`, script `01-centerarc.py`
- **What happens:** `CenterArc((0, 0), 10, 0, 0)` is a closed circle of length 62.83 (the trim
  parameter falls on the range start and is replaced by the range end).
- **Expected:** `ValueError: arc_size must not be zero`.
- **Reproduce:** `print(CenterArc((0, 0), 10, 0, 0).length)`

### 12. `EllipticalArc`: arcs that pass through angle 0 raise KernelError
- **Fixed (checked 2026-10-22):** `EllipticalArc((0, 0), 20, 10, -90, 90)` is the arc through angle
  0 (48.442 long); 0.4.0 gives the same.
- **Session:** `2026-10-12_21-31-43_curves-arcs`, scripts `07-ellipticalarc.py`, `08-ellipse-across-zero.py`
- **What happens:** `EllipticalArc((0,0), 20, 10, -90, 90)`, `(350, 10)`, `(270, 450)`,
  `(359, 1)` raise `KernelError: EllipticalArc failed (SM_ERR)`. The code adds a full
  parameter range to `t1` and trims beyond the curve's range.
- **Expected:** the counterclockwise arc from start to end, like `(270, 360)` which works.
- **Reproduce:** `EllipticalArc((0, 0), 20, 10, -90, 90)`
- **Workaround:** two pieces (`270..360` and `0..90`) in a Wire, or
  `EllipticalArc(c, rx, ry, 90, 270).rotate(Z, 180)`.

### 13. `EllipticalArc` cannot be a sweep path (TypeError from the binding)
- **Fixed:** the bindings register the kernel's ellipse (and parabola, hyperbola) curves as B-spline curves, so
  sweep, `project`, `ruled` and the open-profile surface sweeps take ellipse edges, also those of bodies (kernel plan C3).
- **Session:** `2026-10-12_21-31-43_curves-arcs`, scripts `11-closed-path.py`, `13-ellipse-path-workaround.py`
- **What happens:** `sweep(Circle(2), EllipticalArc((0, 0), 30, 20, 0, 90))` raises
  `TypeError: curve_sweep(): incompatible function arguments` (the path must be a
  `BSplineCurve`; ellipse curves are not).
- **Expected:** works like any other edge (convert the ellipse to NURBS before the call).
- **Reproduce:** `sweep(Circle(2), EllipticalArc((0, 0), 30, 20, 0, 90))`
- **Workaround:** `e.mirror(Plane.XZ).mirror(Plane.XZ)` gives an exact B-spline copy that sweeps.

### 14. `TangentArc`: a tangent pointing back along the chord silently gives a forward line
- **Session:** `2026-10-12_21-31-43_curves-arcs`, script `06-tangentarc.py`
- **What happens:** `TangentArc((0, 0), (10, 0), (-1, 0))` returns `Line((0,0),(10,0))`, whose
  tangent is opposite to the requested one. No error.
- **Expected:** `ValueError` (no arc leaves along -chord and reaches end).
- **Reproduce:** `print(TangentArc((0, 0), (10, 0), (-1, 0)).tangent_at(0))   # (1, 0, 0)`

### 15. `Helix` fails beyond roughly 26 to 79 turns
- **Fixed:** NLib's cap on the spiral fit (NL_CCPLIM) is raised at start, and helices over 120 turns are fitted in
  pieces of whole turns joined into one edge: any number of turns (kernel plan C4).
- **Session:** `2026-10-12_21-36-18_curves-freeform`, scripts `10-helix-limits.py`, `13-helix-turn-limit-sizes.py`
- **What happens:** `KernelError: Helix failed (SM_ERR_NOT_WITHIN_TOLERANCE)` (around 200 turns
  `SM_ERR_INVALID_INPUT`). Max whole turns: r 50: 26, r 20: 32, r 5: 46, r 2: 58, r 0.5: 79,
  independent of pitch. Springs and long threads need more (a coil spring of radius 20 with 40 turns fails).
- **Expected:** the wrapper splits long helices into pieces (the kernel's fit tolerance is
  absolute) or returns a Wire of several helix edges.
- **Reproduce:** `Helix(2, 100, 20)`
- **Workaround:** `Wire([Helix(p, n*p, r), Helix(p, n*p, r, center=(0, 0, n*p)), ...])` with
  whole turns per piece; sweep handles it (one valid solid).

### 16. `Edge.bbox()` of a constructed curve samples 33 points and misses extremes
- **Fixed:** the box of a free curve is exact: its ends, its corners and the points where its tangent is
  perpendicular to an axis (`ext.curve_box`); max y 1.0069069109, as OpenCASCADE (kernel plan C9).
- **Session:** `2026-10-12_21-36-18_curves-freeform`, script `02-spline-bbox.py`
- **What happens:** `Spline((0,0),(1,1),(2,0),(30,0)).bbox().max.y` is 0.7998; the curve passes
  through (1,1) and reaches 1.0069. Silent.
- **Expected:** an exact or conservative box (control-point hull, or the kernel's curve box).
- **Reproduce:** `print(Spline((0, 0), (1, 1), (2, 0), (30, 0)).bbox().max.y)`

## LOW

### 6. `Polyline` with one list of 2 or 3 points raises TypeError
- **Session:** `2026-10-12_21-25-59_curves-lines-wires`, script `04-polyline.py`
- **What happens:** `_pts` unpacks a single sequence only if it has more than 3 items, so
  `Polyline([(0, 0), (10, 0), (10, 5)])` raises `TypeError: float() argument must be a string
  or a real number, not 'tuple'`; a list of 4 points works. Same helper in `Spline` and
  `Bezier`.
- **Expected:** a single list of points works for any length (or never, with a clear error).
- **Reproduce:** `Polyline([(0, 0), (10, 0), (10, 5)])`
- **Workaround:** `Polyline(*pts)`.

### 7. `Polyline(a, a)` returns an empty Wire whose repr crashes
- **Session:** `2026-10-12_21-25-59_curves-lines-wires`, script `04-polyline.py`
- **What happens:** all edges are dropped as zero length; `Wire._raw([])` is returned;
  `repr` raises `IndexError: tuple index out of range`. Same for `close=True`.
- **Expected:** `ValueError: a polyline needs at least two distinct points`.
- **Reproduce:** `print(Polyline((0, 0), (0, 0)))`

### 8. `Edge()` error and Edge docstring name `Arc()`, which does not exist
- **Session:** `2026-10-12_21-25-59_curves-lines-wires`, script `13-misc-errors.py`
- **What happens:** `TypeError: create edges with Line(), Arc(), Spline(), ...`; the class
  docstring also links `smlibpy.Arc`.
- **Expected:** name `CenterArc()` / `ThreePointArc()`.

### 9. `Wire([edge, (0, 0)])` error message says "got int"
- **Session:** `2026-10-12_21-25-59_curves-lines-wires`, script `06-wire-ordering.py`
- **What happens:** tuples are flattened as lists of edges, so the message is
  `TypeError: a wire is made of edges, got int`.
- **Expected:** "got tuple" or "points are not edges".

### 17. Confusing "cannot normalize a zero-length vector" errors
- **Partly fixed (kernel plan C13):** `Spline(a, b, closed=True)` raises `a closed spline needs at least three
  points`.
- **Sessions:** arcs `04-radiusarc.py`, `05-sagittaarc.py`, `06-tangentarc.py`; lines-wires
  `08-wire-fillet.py`; freeform `03-spline-tangents.py`, `04-spline-closed.py`, `08-helix.py`
- **What happens:** `RadiusArc(a, a, 5)`, `SagittaArc(a, a, 2)`, `RadiusArc` with a chord along
  the plane normal, `TangentArc(a, b, (0, 0))`, `Wire.fillet(0)`, `Spline(..., tangents=((0,0),
  ...))`, `Spline(a, b, closed=True)`, `Helix(..., direction=(0,0,0))` all raise
  `ValueError: cannot normalize a zero-length vector`.
- **Expected:** messages that name the input ("start and end coincide", "tangent is zero",
  "radius must be positive").

### 18. `ThreePointArc` with nearly collinear points misses the end point by more than the wire tolerance
- **Session:** `2026-10-12_21-31-43_curves-arcs`, script `03-threepointarc.py`
- **What happens:** `ThreePointArc((0, 0), (5, 1e-9), (10, 0))`: r 1.25e10, end (10, -1.9e-6).
  The gap exceeds the 1e-6 chaining tolerance of `Wire`.
- **Expected:** raise "points are nearly collinear" below a relative threshold, or snap the
  end point.

### 19. `EllipticalArc`: full ellipse ignores `start_angle`; invalid radii raise KernelError
- **Session:** `2026-10-12_21-31-43_curves-arcs`, script `07-ellipticalarc.py`
- **What happens:** `EllipticalArc(c, 20, 10, 90, 450)` and `(30, 30)` return the full ellipse
  starting at angle 0. `x_radius=0` or negative: `KernelError ... (SM_ERR_INVALID_INPUT)`
  instead of a `ValueError` like CenterArc. The docstring does not say that angles are
  parametric and always counterclockwise.

### 20. `Bezier`: coincident control points give a zero-length edge
- **Session:** `2026-10-12_21-36-18_curves-freeform`, script `05-bezier.py`
- **What happens:** `Bezier((0, 0), (0, 0))` returns an edge of length 0 without error.
  19+ control points raise a bare `KernelError: Bezier failed (SM_ERR)` (the limit is
  degree 17, not stated anywhere).
- **Expected:** `ValueError` for both, naming the cause.

### 21. `Spline(tangents=...)`: malformed input gives IndexError / TypeError
- **Partly fixed (kernel plan C8):** a list whose length is neither 2 nor the number of points
  raises `ValueError` ("tangents are (start, end) or one per point"); `tangents=(1, 0)` still raises
  `TypeError`.
- **Session:** `2026-10-12_21-36-18_curves-freeform`, script `03-spline-tangents.py`
- **What happens:** `tangents=((1, 0),)` -> `IndexError: tuple index out of range`;
  `tangents=(1, 0)` -> `TypeError: 'int' object is not iterable`.
- **Expected:** `ValueError: tangents must be a pair (start, end)`.

### 22. `Part.bbox()` of a body swept along a helix is about 0.1 mm too large (analysis domain)
- **Fixed (0.5.0, checked 2026-10-22):** `max.x` is 8.5004 (0.4.0: 9.116).
- **Session:** `2026-10-12_21-36-18_curves-freeform`, scripts `14-helix-profile-orientation.py`, `15-helix-start-cap.py`
- **What happens:** `sweep(Rectangle(1, 2), Helix(4, 12, 8)).bbox().max.x` is 9.116; the
  radial extent is 8.5 (start cap vertices at x 7.5 and 8.5). Probably the kernel's loose
  box of the swept B-spline surfaces.
- **Expected:** a tight box, or documented as conservative.

