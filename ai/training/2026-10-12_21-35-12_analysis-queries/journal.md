# Training: analysis · geometric queries

**Date:** 2026-10-12

## Goal

APIs: `distance_to`, `closest_point`, `intersection_curves`, `silhouette`, `project`, `outline`.

Questions:
- Distance between what: surfaces or volumes? Points inside? Nested bodies?
- How exact are distances, also for curved and far bodies?
- What do the query results look like (types, pieces, order), and what if nothing is hit?
- Which side does silhouette/outline look from? Hidden lines?

## Log

### 01-distance-basic.py
Box-sphere 12.0 both ways; point (0,0,30) 25.0, closest (0,0,5). Point inside (1,2,3): 2.0 and
closest (1,2,5): distance to the surface, not 0. Overlapping/touching: 0.0. Sphere r2 nested in
box: 3.0 (wall clearance); box in sphere r20: 20 - sqrt(75). Vertex, Vector, Shell, Sketch
accepted. `distance_to(Edge)`: `TypeError: 'Edge' object is not iterable`; a list:
`ValueError: expected 2 or 3 coordinates, got 1`.
**📌 doc:** surface distance; nested bodies are not 0.

### 02-distance-curved.py
Skew cylinders 21, torus-sphere 17, cylinder/sphere/fillet to point: exact to 1e-14. Face, Edge,
Wire `distance_to(point)` right; `edge.distance_to(part)` TypeError; Edge/Face have no
`closest_point`. **Far spheres (1e4,-2e4,3e4): 15.561 instead of 13.913.**

### 03-distance-far.py / 04-distance-far-threshold.py
Spheres pair right up to offset (7000,-14000,21000), wrong (+1.65) at (1e4,-2e4,3e4) and
along x at 1e5 and 1e6 (right at 1e4 along x). Boxes right at 1e6. Point distance right at 1e6.
Moving the pair back to the origin gives 13.9129 again. Parallel cylinders: 11.234 instead of
14.36, already at the origin.
(`translate(*np_array)` fails with numpy ints: `TypeError: 'numpy.int64' object is not
iterable`, geometry domain.)

### 05-distance-cylinders.py
Parallel cylinders r5/r3 at origin: 10.333 vs 12 (-1.67), 11.234 vs 14.36, 9.613 vs 13.21.
Sampled point distances give 14.3607: the body-body result is wrong.

### 06-distance-survey.py
17 pairs: right for box-box, sphere-sphere, cylinder-sphere, cylinder-box (side), coaxial
cylinders, perpendicular and skew cylinders, cone, torus, shaft in hole. **Wrong**: all parallel
cylinder pairs (-1.67).

### 07-distance-workaround.py
Alternating `closest_point` (50 steps) gives the right value for all failing cases (12,
14.3607, 13.9129) and also a cylinder beside a box (distance_to: 7.22, true 10).
**📌 doc:** wrong where the nearest points form a line; cross-check.

### 08-interference.py
`a & b`: disjoint and touching -> 0 faces; overlapping 500; nested sphere 33.51 with
distance 3. **📌 doc:** use the intersection to test overlap.

### 09-example-distance.py
Doc example, ran unchanged.

### 10-intersection-curves.py
Box & vertical cylinder: 2 circles, 5e-12. Box & tilted cylinder: 7 ellipse pieces. Sphere &
plane sketch: 2 circle arcs (split at the seam). Steinmetz: 4 ellipse pieces. r5 & r3
cylinders: 2 closed bsplines, 1.4e-6 off the surfaces. Torus & plane: 2 circles.
**Disjoint and nested: `KernelError: intersection curves failed (SM_ERR)`.** Touching boxes:
6 pieces, length 120 (face perimeter 80). Body with itself: 24 lines (each edge twice).
`Plane` argument: AttributeError. Sketch/Shell arguments work.
![tilted](files/10-intersection-curves-tilted.png)

### 11-intersection-lengths.py
r5/r3 crossing: 5.1e-7 vs numerical integration; Steinmetz 3.9e-11. Doc example pieces listed:
3 bottom, 2 top, 2 side walls.

### 12-example-intersection.py / 13-wire-from-pieces.py
Doc example ran unchanged. `Wire(7 pieces of 2 loops)`: no error, `is_closed` False;
`Wire(bottom 4 pieces)`: closed, 27.34.

### 14-silhouette.py / 15-silhouette-pieces.py / 16-silhouette-torus-side.py
Sphere: 1 bspline, -2.5e-7 (axis) / -9.1e-7 (1,1,1); same for -Z; moved sphere same.
Cylinder from +X: 2 contour lines (bspline, exactly 20) + 7 rim quarter arcs, front and back.
Box from +Z: 4 top edges; from -Z: 4 bottom edges. Torus from +Z: circle + bspline (R±r).
Torus from +X: 157.08 = half of the full contour set (314.16), the visible front; 3 slivers
(9e-6, 2.5e-4, 1.8e-5 long); normal error 3.6e-5. Zero direction: `KernelError: silhouette
failed (SM_ERR_INVALID_INPUT)`.
![torus_x](files/16-silhouette-torus-side-torus_x.png)
**📌 doc:** direction = towards the viewer; visible contour plus boundary edges.

### 17-example-silhouette.py
Doc example, ran unchanged.

### 18-project.py / 19-project-accuracy.py
Circle above box -> 2 pieces (top and bottom faces), for up/down direction, curve above, below
or inside. Sphere: z = ±8.66. Miss: `KernelError: project failed (SM_ERR)`. Zero direction:
`SM_ERR_INVALID_INPUT`. Sketch input works. Projected circle on a flat face: radius error
1.7e-4, length -1.7e-5; on a sphere 9.4e-5 off the surface. Line longer than the box: 4 pieces
(top, bottom, two vertical lines on the side faces). Oblique (1,0,-1) works when the lines hit.
**📌 doc:** both sides; fits at ~1e-4.

### 20-example-project.py
Doc example, ran unchanged.

### 21-outline.py / 22-outline-visibility.py
Box top view: 4 edges (coincident top/bottom merged, vertical edges dropped). Cylinder side
view on XZ: 6 pieces, a 10 x 20 rectangle. Sphere: one circle 62.83. Box with hole: hole
shown from +Z, hidden from XZ. Box on (1,1,1) plane: 6 x 16.33 + 3 x 8.165 (isometric).
Blind hole from below: hidden in XY, shown in `Plane.bottom`. Box under box: hidden from +Z.
Results in world coordinates on the plane (XZ.offset(7) -> y = -7). Circle radius error 2e-15.
All edges bspline.
![blind](files/22-outline-visibility-blind.png)

### 23-example-outline.py
Doc example, ran unchanged.

## Coverage
- [x] every API ran; points, Vertex, Vector, Shell, Sketch, Edge and lists tried as arguments
- [x] defaults measured (silhouette (0,0,1), project (0,0,-1), outline Plane.XY)
- [x] errors: misses, zero directions, Plane argument, wrong argument types
- [x] realistic use: clearance check, drawing views, path on a dome
- [x] numbers for every spatial claim

### 24-project-onto-plane.py
Projection onto a plane through a large sketch: a 4-turn helix flattens to one closed piece of
length 251.3194 (4 circles: 251.3274; helix fit and projection fit), all points at z = 0.
A line projected onto a tilted sketch plane lands on it (z = -50 at y = 0).
Added to project.md.

### 25-todo-repros.py
The minimal reproductions in `ai/todo/analysis.md` ran once more with the same numbers
(10.3331 / 7.2218; 15.5610 vs 13.9129; True -1.8e-21 / True 12673.0; mass 1000.0 at density 0;
spline bbox -2.9599 vs -3.0290; KernelErrors for no intersection, missed projection and
accuracy 1e-12).
