# Defects and surprises: sketches

## HIGH

### 16. 2D Booleans: wrong unions without an error when the left operand was moved
- **Fixed:** both operands are rebuilt from their curves before the kernel's `boolean_2d` (2026-10-13).
- **Session:** `2026-10-13_00-42-19_sketches-profiles`, `ai/plan/2d.md`
- **What happens:** the kernel's planar Boolean fails (`SM_ERR_INVALID_INPUT`) or returns a wrong union or
  exclusive or, without an error, when its left operand is a circle (or ellipse) that was translated or
  rotated (`ext.transform_brep`): 15 % of 150 random unions were wrong. Differences and intersections
  were right. The slab fallback only ran when the kernel raised.
- **Reproduce:** `(Circle(6).rotate(Z, 30).translate(-4, 2) + Slot(30, 8)).area` was 200.48, the union is 259.27.
- **Kernel:** the moved body itself looks consistent (curve and surface data agree); rebuilding the faces from
  copies of the same curves makes the Boolean exact. The cause inside SMLib is not known.


### 1. `Sketch.revolve()` default axis: silent zero-volume part for most sketches
- **Fixed:** revolve raises ModelingError when the (default) axis crosses the region and names the default axis.
- **Session:** `2026-10-12_21-26-11_sketches-generic`, scripts `07-plane-tracking.py`, `08-plane-origin-revolve.py`
- **What happens:** `revolve()` without an axis turns about the local Y axis through `sketch.plane.origin`.
  That origin is the center of every centered constructor, and for `make_face` / `Wire.to_sketch()` it is
  the centroid of the outline. The axis therefore crosses the region, and the result is a `Part` with
  volume 0 (or -9e-12) and `is_valid() == True`. No error, although the kernel hint says "the axis must
  not cross the region".
- **Expected:** an error when the axis crosses the region; and a predictable default axis (the Y axis of the
  sketch's plane through the world origin, as it happens for `Polygon`), not the centroid.
- **Reproduce:**
  ```python
  s = make_face(Polyline((10, 0), (20, 0), (20, 20), (10, 20), close=True))
  print(s.plane.origin, s.revolve().volume)          # (15, 10, 0) 0.0
  print(Rectangle(10, 20).revolve().volume)           # -9e-12, is_valid True
  print(Polygon((10, 0), (20, 0), (20, 20), (10, 20)).revolve().volume)  # 18849.5 (correct)
  ```
- **Workaround:** always pass the axis: `s.revolve(Axis((0, 0, 0), (0, 1, 0)))`.

## MEDIUM

### 17. The tight bounding box of a moved circle is slow
- **Session:** `2026-10-13_00-42-19_sketches-profiles`, script `08-booleans.py`
- **What happens:** `brep.bounding_box(True)` of `Pos(10, 5) * Circle(3)` takes 0.2 to 10 ms (an unmoved
  rectangle: 0.001 ms). The 2D Booleans called it several times per tool: plate minus 180 holes took 3.4 s.
- **Workaround (in place):** the Booleans use the loose box (`bounding_box(False)`, 0.0005 ms) for overlap
  tests. `Sketch.bbox()` itself is still the tight box.

### 18. Kernel planar union loses a disk that touches strips tangentially
- **Fixed:** the offset construction from pieces uses corner sectors that share edges with the strips, and
  every offset is checked against the original outline (2026-10-13).
- **Session:** `2026-10-13_00-42-19_sketches-profiles`; probe in the session's design note
- **What happens:** the union of the strips swept by a convex pentagon's sides and full disks at its corners
  (each disk tangent to two strips) lost one disk: 645.73 instead of 653.00 (Steiner's formula). No error.


### 2. `Part + Sketch` / `Part - Sketch`: silent invalid part
- **Fixed:** Part + Sketch / Part - Sketch raise TypeError "extrude it first".
- **Session:** `2026-10-12_21-26-11_sketches-generic`, scripts `03-errors.py`, `04-part-plus-sketch.py`
- **What happens:** `Box(5, 5, 5) + Rectangle(10, 10)` returns `Part(11 faces, volume=125)` with
  `is_valid() == False`. `Box(20, 20, 5) - Circle(3)` returns `Part(7 faces, volume=2000)`, invalid.
  The reverse, `Sketch + Part`, raises `TypeError: cannot fuse a Part with a Sketch`.
- **Expected:** `TypeError` ("extrude the sketch first"). Forgetting `.extrude()` is an easy mistake.
- **Reproduce:**
  ```python
  p = Box(20, 20, 5) - Circle(3)
  print(p, p.is_valid())     # Part(7 faces, volume=2000) False
  ```
- **Workaround:** extrude the sketch before combining.

### 3. `Sketch.fillet` silently does nothing after `Sketch.offset`
- **Fixed:** wire and sketch fillets treat straight B-spline edges as lines; offset(-2).fillet(3) rounds the corners.
  Offsets of line/arc outlines now return exact `line` and `circle` edges (2026-10-13).
- **Session:** `2026-10-12_21-34-48_sketches-2dops`, scripts `04-offset-details.py`, `06-fillet-negative-and-offset.py`
- **What happens:** `offset()` returns every edge as a `bspline` (straight ones and arcs too). `Sketch.fillet`
  only rounds corners between edges whose `geom_type == "line"`, so `Rectangle(40, 20).offset(-2).fillet(3)`
  returns the 36 x 16 rectangle unchanged (area 576), with no error. `edges().lines()` / `.circles()` on the
  offset sketch are empty too.
- **Expected:** `offset` keeps lines as lines and arcs as arcs (they are exact offsets), or `fillet` treats
  straight B-splines as lines, or at least raises when no corner was rounded.
- **Reproduce:**
  ```python
  s = Rectangle(40, 20).offset(-2)
  print([e.geom_type for e in s.edges()], s.fillet(3).area)    # ['bspline', ...] 576.0
  ```
- **Workaround:** fillet first, then offset (`Rectangle(40, 20).fillet(5).offset(-2)` = `Rectangle(36, 16).fillet(3)`).

### 4. `Sketch.fillet` with a negative radius makes a self-overlapping region
- **Fixed:** fillet raises ValueError for a radius <= 0 (unmatched vertex points are still ignored).
- **Session:** `2026-10-12_21-34-48_sketches-2dops`, scripts `05-fillet.py`, `06-fillet-negative-and-offset.py`
- **What happens:** `Rectangle(40, 20).fillet(-2)` returns a sketch with bbox ±24 x ±14, area 746.3, whose
  outline crosses itself (circles at the corners, slanted sides, see `files/06-fillet-negative-and-offset-neg.png`);
  it even extrudes to a "valid" part. `fillet(0)` raises `ValueError: cannot normalize a zero-length vector`.
  A vertex point that is no corner is ignored silently.
- **Expected:** `ValueError: radius must be positive`; a warning or error when a given point matches no corner.
- **Reproduce:** `print(Rectangle(40, 20).fillet(-2).bbox())`

### 5. `Sketch.mirror()` flips the sketch normal
- **Fixed:** the normal is mirrored with the sketch: an axis or plane perpendicular to the sketch leaves it
  facing the same way, and mirror commutes with extrude. `Sketch.mirror` also takes an axis in its plane.
- **Session:** `2026-10-12_21-26-11_sketches-generic`, scripts `05-placement.py`, `07-plane-tracking.py`
- **What happens:** `Rectangle(20, 10).mirror(Plane.XZ)` has `plane.z_dir == (0, 0, -1)` and its face normal
  is -Z; `extrude(5)` goes to z = -5. `a + a.mirror(P)` keeps +Z, `a.mirror(P) + a` has -Z.
- **Expected:** mirroring a sketch in a plane perpendicular to it keeps it facing the same way (the
  reflection reverses the orientation, but for a profile the user expects the same extrude direction).
  At least the docstring of `mirror` should say so.
- **Reproduce:** `print(Rectangle(20, 10).mirror(Plane.XZ).extrude(5).bbox())` → z -5..0.
- **Workaround:** put the original first in the union, or extrude with a negative amount.

### 6. `Polygon` with 3D points keeps `Plane.XY` as its plane
- **Session:** `2026-10-12_21-30-36_sketches-shapes`, scripts `04-polygon.py`, `05-polygon-orientation.py`
- **What happens:** `Polygon((0,0,0), (10,0,0), (10,10,10), (0,10,10))` makes a tilted face (normal
  (0, -0.707, 0.707)) but `plane.z_dir` is +Z, so `extrude(5)` is an oblique prism along +Z (bbox z 0..15,
  volume 500). A polygon at z = 5 has `plane.origin` (0, 0, 0): it fuses with a `Rectangle` at z = 0
  (2 faces at two heights) and is rejected with a rectangle at z = 5 ("different planes").
- **Expected:** the plane of the points (as `make_face` does with `wire.plane()`), or a `ValueError` for
  points with z != 0.
- **Reproduce:**
  ```python
  up = Polygon((0, 0, 5), (10, 0, 5), (10, 10, 5), (0, 10, 5))
  print(up + Rectangle(4, 4))                       # Sketch(2 faces, area=116)
  print(Polygon((0,0,0), (10,0,0), (10,10,10), (0,10,10)).extrude(5).bbox())   # z 0..15
  ```
- **Workaround:** 2D points, then `.on(plane)`.

## LOW

### 19. `create_offset_profile` refuses open curves
- **Session:** `2026-10-13_00-42-19_sketches-profiles`
- **What happens:** `k.create_offset_profile([line], 3, offset_type=BOTH)` raises `SM_ERR` for an open line or
  polyline (its docstring promises a two-sided band). `Stroke` builds bands of lines and arcs itself.


### 7. Empty sketches are silent and inconsistent
- **Fixed:** Booleans give an empty sketch in every case (also `&` of sketches whose boxes are apart);
  `extrude`, `revolve` and `center()` of an empty sketch raise; offsets that remove everything raise.
- **Session:** `2026-10-12_21-26-11_sketches-generic`, scripts `02-booleans.py`, `03-errors.py`;
  `2026-10-12_21-34-48_sketches-2dops`, scripts `02-make-face-edge-cases.py`, `04-offset-details.py`
- **What happens:** `Rectangle(10, 10) - Rectangle(20, 20)` gives `Sketch(0 faces, area=0)`; its `extrude(5)`
  is `Part(0 faces, volume=0)`, `center()` raises `ZeroDivisionError`, `bbox()` is (1e20 .. -1e20).
  `&` of sketches whose boxes are apart raises `ValueError: ... intersection is empty`, but `&` of an
  L-shape and a square in its notch (boxes overlap, regions do not) returns the empty sketch silently.
  `(Circle(10) - Circle(5)).offset(-2.5)` returns the empty sketch, while `Rectangle(40, 20).offset(-10)` raises
  `ValueError: the offset removes the whole sketch`. `make_face(square, bigger_circle)` is empty too.
- **Expected:** one behaviour for empty results: either always an empty sketch or always an error; `extrude`
  of an empty sketch should raise.
- **Reproduce:**
  ```python
  L = Polygon((0, 0), (20, 0), (20, 5), (5, 5), (5, 20), (0, 20))
  print(L & Rectangle(10, 10, align=Align.MIN).translate(8, 8))   # Sketch(0 faces)
  print((Rectangle(10, 10) - Rectangle(20, 20)).extrude(5))      # Part(0 faces, volume=0)
  print((Circle(10) - Circle(5)).offset(-2.5))                    # Sketch(0 faces)
  ```

### 8. `make_face` does not check its holes
- **Session:** `2026-10-12_21-34-48_sketches-2dops`, script `02-make-face-edge-cases.py`
- **What happens:** holes are subtracted with the 2D Boolean. A hole outside the outline and a hole in
  another plane (z = 5) are ignored silently; a hole crossing the outline cuts a notch; a hole larger than
  the outline gives an empty sketch.
- **Expected:** a `ValueError` for holes outside the outline or not in its plane (the docstring says
  "minus the regions inside holes", which reads as holes inside the outline).
- **Reproduce:**
  ```python
  sq = Polyline((0, 0), (20, 0), (20, 20), (0, 20), close=True)
  print(make_face(sq, CenterArc((10, 10), 3, 0, 360).translate(0, 0, 5)))   # area 400, no hole
  ```

### 9. `make_face` on an XZ wire has normal +Y, `Plane.XZ` has -Y
- **Session:** `2026-10-12_21-34-48_sketches-2dops`, script `02-make-face-edge-cases.py`
- **What happens:** `Sketch._from_wires` flips the fitted normal so that it points to +Z, or for vertical
  planes along +(1, 1, 0). A wire in the XZ plane therefore gets normal (0, 1, 0) for either winding, while
  `Rectangle(...).on(Plane.XZ)` has (0, -1, 0). Extruding the same outline goes to opposite sides depending
  on how it was made. Not documented.
- **Expected:** documented, or the same convention as the named planes.
- **Reproduce:** `print(make_face(Polyline((0,0,0), (20,0,0), (20,0,10), (0,0,10), close=True)).plane.z_dir)`

### 10. `RegularPolygon`: `align=Align.CENTER` and `align=(Align.CENTER, Align.CENTER)` differ
- **Session:** `2026-10-12_21-30-36_sketches-shapes`, script `06-regularpolygon.py`
- **What happens:** `_aligned` returns the shape untouched for the scalar `Align.CENTER`, but centers the
  bbox for the tuple. `RegularPolygon(10, 3)` bbox x -5..10; with `(Align.CENTER, Align.CENTER)` -7.5..7.5.
  The same applies to `Trapezoid` with an angle above 90 on one side only.
- **Expected:** one meaning of CENTER.
- **Reproduce:** `print(RegularPolygon(10, 3, align=(Align.CENTER, Align.CENTER)).bbox())`

### 11. `Trapezoid`: angle 0, 180 and height 0 are not validated
- **Fixed:** `ValueError` for angles outside (0, 180) and for non-positive sizes.
- **Session:** `2026-10-12_21-30-36_sketches-shapes`, script `09-trapezoid.py`
- **What happens:** angle 0 → `ZeroDivisionError`; angle 180 → a sketch of area 0 with bbox ±1.2e17, no
  error; height 0 → `KernelError: sketch failed (SM_ERR)`.
- **Expected:** `ValueError` for angles outside (0, 180) and non-positive height.
- **Reproduce:** `print(Trapezoid(40, 15, 180).bbox())`

### 12. Silent fallbacks for bad sizes
- **Session:** `2026-10-12_21-30-36_sketches-shapes`, scripts `02-roundedrect.py`, `06-regularpolygon.py`, `07-slot.py`
- **What happens:** `RoundedRectangle(40, 20, -2)` is a plain rectangle; `Slot(6, 10)` and `Slot(-30, 10)`
  are circles of diameter 10; `RegularPolygon(-10, 6)` is the hexagon turned 180 degrees. No error.
- **Expected:** `ValueError` for negative sizes; `Slot(length < width)` could raise or the docstring should
  say it becomes a circle.

### 13. Unhelpful errors for bad input
- **Fixed (partly):** `Ellipse` raises `ValueError` for non-positive radii; `sketch + edge` raises a TypeError that
  points to `make_face` and `Profile`. A self-crossing plain `Polygon` still raises the kernel's `SM_ERR`.
- **Session:** `2026-10-12_21-26-11_sketches-generic`, script `03-errors.py`;
  `2026-10-12_21-30-36_sketches-shapes`, scripts `03-circle-ellipse.py`, `04-polygon.py`
- **What happens:** `Ellipse(0, 8)` → `KernelError: Ellipse failed (SM_ERR_INVALID_INPUT)` (Circle raises
  `ValueError`). A self-intersecting or collinear `Polygon` and `RegularPolygon(0, 6)` →
  `KernelError: sketch failed (SM_ERR)` with no hint, while `make_face` has the hint "the wire must be
  planar and must not cross itself". `Rectangle(10, 10) + Line((0, 0), (20, 0))` →
  `TypeError: 'Edge' object is not iterable`.
- **Expected:** `ValueError` for non-positive radii; the same hint on `Polygon`; `TypeError: cannot fuse an
  Edge with a Sketch` with a hint to `make_face`.

### 14. `offset(round=False)` leaves extra collinear edges
- **Fixed:** sharp offsets extend the sides to their corner: a grown rectangle has 4 edges.
- **Session:** `2026-10-12_21-34-48_sketches-2dops`, script `04-offset-details.py`
- **What happens:** `Rectangle(40, 20).offset(2, round=False)` has 12 edges: 40, 40, 20, 20 and eight of length 2
  (the extensions to the sharp corners are separate edges). The L-shape gets 16 instead of 6. The region is
  right (area 1056).
- **Expected:** collinear pieces merged, 4 edges.

### 15. `docs/sketches.md` calls `area` exact
- **Session:** `2026-10-12_21-26-11_sketches-generic`, script `01-basics.py`
- **What happens:** `Circle(10).area` is 314.1593105, pi*100 = 314.1592654 (relative error 1.4e-7).
- **Expected:** the docs say "accurate to about 1e-7" instead of "exact".

### 16. `Sketch.area` of lettering is off by up to a few 1e-6 at the default accuracy
- **Session:** `2026-10-13_00-41-18_sketches-text` (checked against the exact areas of the font outlines)
- **What happens:** faces bounded by long B-spline edges integrate less accurately at `ACCURACY = 1e-7`:
  `Text("@&8", 8).area` is 2.0e-6 too small, single glyphs at size 10 up to 1.2e-5 (Inter `(`). With
  `ext.face_properties(face, 1e-11)` every glyph agrees with the exact outline area to about 1e-11, and
  `text.extrude(1).mass_properties(accuracy=1e-10).volume` to 1e-9: the geometry is exact, the
  integration is not.
- **Expected:** `area` as accurate for curved outlines as for circles (1e-7), or an `accuracy=` argument.
- **Workaround:** `mass_properties(accuracy=1e-10)` of an extrusion; documented in `sketches/Text.md`.

