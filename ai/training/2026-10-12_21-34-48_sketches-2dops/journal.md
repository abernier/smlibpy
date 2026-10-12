# Training: sketches · 2D operations (make_face, offset, fillet)

**Date:** 2026-10-12

## Goal

APIs: `make_face`, `Sketch.offset`, `Sketch.fillet`.

Questions:
- make_face: which inputs (Wire, Edge, list), holes, plane and normal, open wires, crossing wires,
  holes outside or crossing the outline.
- offset: grow/shrink, `round`, holes, collapse, merging and splitting, placed sketches, curves, edge types.
- fillet: all corners or chosen ones, how vertices are given, radius limits, concave corners, holes, arcs,
  placed sketches, interplay with offset.

## Log

### 01-make-face-basic.py
Docs bracket `make_face(Polyline(...close=True), Wire([CenterArc((12,12),4,0,360)]))`: 1 face, 1 hole, area
1149.7345 = 1200 - 16 pi. Hole as a bare Edge: same. Outer as a closed circle edge: works. Two holes: 2 inner
wires. Clockwise outline: same face, +Z. `Wire` of 4 unordered, mixed-direction lines: 1 face, 4 edges.
Docs pattern `half + half.mirror(Plane.XZ)`: area 1258.8876, bbox ±25 x ±15. Collinear points merged
(4 edges for a rectangle with an extra point). Closed spline: 1 edge. FilletPolyline r 5: area 778.5398 =
800 - (4 - pi) 25. Plane origin = outline centroid, e.g. (21.9887, 12.4654, 0) for the bracket.
![faces](files/01-make-face-basic-faces.png)

### 02-make-face-edge-cases.py
Open polyline, single line, half arc, gap 1e-3, open hole: `ValueError: a sketch region needs closed wires;
use wire.close()`. `.close()` fixes the polyline. Gap 1e-7: accepted (Wire.is_closed tolerance 1e-6).
Bowtie and non-planar: `KernelError: make face failed (SM_ERR): the wire must be planar and must not cross
itself`. A list of edges works. Holes: outside → ignored (area 400); crossing the outline → a notch, 0
holes; touching the outline from inside → a notch; bigger than the outline → `Sketch(0 faces)`; two
overlapping → 1 merged hole; in another plane (z = 5) → ignored silently.
Normals: XZ wire either winding → plane z (0, 1, 0), extrude(2) to y = 0..2; YZ wire → (1, 0, 0); XY wire at
z = 5 clockwise → +Z; tilted 45 either winding → (0, -0.707, 0.707); plane x + y = 0 → (0.707, 0.707, 0).
**📌 doc:** normal rule (→ todo #9); holes not checked (→ todo #8).

### 03-offset-basic.py
Rectangle 40x20: `offset(2)` area 1052.56637 = 800 + 120·2 + 4π, bbox ±22 x ±12; `round=False` area 1056 =
44·24; `offset(-2)` area 576 with either `round`. `offset(0)`: unchanged, line edges. Circle(10) ±3: radius 13 /
7, area 530.9292 = π·169. L-shape: +2 round 751.708, +2 sharp 756 (= exact polygon), -2 round 276.858 (concave
corner rounded), -2 sharp 276 (= exact polygon). All result edges are `bspline`.
![offsets](files/03-offset-basic-offsets.png)
**📌 doc:** round affects the corners that open up; all edges B-spline.

### 04-offset-details.py
Sharp grown rectangle: 12 edges (40, 40, 20, 20 + eight of length 2). Round: 8 edges (4 of length π).
Extruded: 4 cylinder + 6 plane faces, valid. `edges().lines()` and `.circles()` → 0. `offset(-2).fillet(3)`
→ area 576, i.e. no fillet, no error (→ todo #3). Ring 10/5: +1 → area 329.8672 = π(121 - 16), hole kept; -1 →
141.3717 = π(81 - 36); +5 and +6 → hole gone; -2.5 and -3 → `Sketch(0 faces)` silently. Rectangle -9.9 →
sliver 20.2 x 0.2; -10 and -11 → `ValueError: the offset removes the whole sketch`. Dumbbell with a 2 wide bar,
-1.5 → 2 faces. Two circles 2 apart: +2 → 1 face, +0.5 → 2 faces. Sketch on `Plane.XZ.offset(5)`: offsets stay
at y = -5, plane z (0, -1, 0), bbox ±12 x ±7 (+2). Ellipse 15x8 ±2: bbox ±17 x ±10 / ±13 x ±6. Slot +1: ±16 x ±6.
Spline ±2 works.

### 05-fillet.py
`Rectangle(40, 20).fillet(3)`: 8 edges (line/circle), area 792.27433 = 800 - (4 - π)·9, arc radii 3.
`[(20, 10)]` and `[(20, 10, 0)]`: one corner. Vertex selections (`filter`, `sort_by(X)[-2:]`) work. A point
that is no corner or an empty list: unchanged, no error. `vertices=(20, 10)`: `TypeError: 'int' object is not
iterable`. Radius 10 (= half the short side): 6 edges, area 714.159. 10.0001 and 15: `ValueError: fillet radius
10.0001 is too large for the edge Edge(line, (-20, 10, 0) -> (-20, -10, 0))`. Radius 15 on one corner: works
(area 751.715 = 800 - (4 - π)·225/4). Radius 0: `ValueError: cannot normalize a zero-length vector`. Radius -2:
a region larger than the rectangle (see 06). L fillet 3: 12 edges, area 492.27433 (5 convex corners lose,
1 concave gains). Frame 40/20 fillet 2: hole corners rounded too, area stays 1200; only the outer corners
with `outer_wire().vertices()`: 1196.57. Slot, circle: unchanged. Rectangle + circle: only the line-line
corners. Acute triangle 50 x 5: r 1 works, r 3 too large. Two pieces: both filleted. On `Plane.XZ`: plane z
stays (0, -1, 0), extrude to y -3..0; corner as world point `(10, 0, 5)` works, local `(10, 5)` is ignored.
![fillets](files/05-fillet-fillets.png)

### 06-fillet-negative-and-offset.py
`fillet(-2)`: area 746.301, bbox ±24 x ±14, a self-overlapping outline with circles at the corners;
`extrude(1).is_valid()` is True (→ todo #4). Offset edges are `bspline`; `offset(-2).fillet(3)` unchanged.
`Rectangle(40, 20).fillet(5).offset(-2)` area 568.2743 = 36·16 - (4 - π)·9, equal to `Rectangle(36, 16).fillet(3)`.
![negative fillet](files/06-fillet-negative-and-offset-neg.png)

### 07-doc-examples.py
Examples of make_face.md, offset.md, fillet.md, unchanged. Bracket 1149.7345 = formula, valid. Pulley profile
in XZ (normal +Y), revolved about Z: volume 8717.919, Pappus 8717.92, valid, bbox ±20 x ±20 x 0..10. Gasket
`outline - outline.offset(-4)`: 1 hole, inner bbox ±26 x ±16, area 708.531 = formula. Clearance bbox ±30.5 x
±20.5. Sharp square 44 x 24, area 1056. Bracket fillet: rounded 380.5664, inside 387.4336 (formulas). Tab: two
arcs at the right end, area 289.2699. Extruded bracket valid.
![examples](files/07-doc-examples-examples.png)

## Coverage

- [x] every API ran (01, 03, 05)
- [x] every parameter: make_face outer/holes (Wire, Edge, list), offset distance sign and round, fillet
      radius and vertices (tuples, 3D tuples, Vertex selections)
- [x] defaults measured: offset round=True (03), fillet all corners (05), make_face normal/origin (01, 02)
- [x] edge and error cases (02, 04, 05, 06)
- [x] realistic use (07)
- [x] spatial claims backed by numbers
