# Training: files · DXF

**Date:** 2026-10-13

## Goal

APIs: `import_dxf`, `import_dxf_wires`, `export_dxf` (new); `load` and `export` with `.dxf`.

Questions:
- Which entities does a section of a part become? Do radii, splines and areas survive a round trip?
- Units: what is written, what is read, and the `unit=` override.
- The drawing plane of `export_dxf` for sketches outside XY.
- Every entity the reader knows (bulges, old polylines, OCS arcs, ellipses, rational, periodic and
  fit-point splines), blocks and layers.
- Open and branching outlines: how clear are the errors? Nesting and crossing loops.

The scripts write hand-made DXF files with the helpers in `scripts/_dxf.py` into a temporary folder.

## Log

### 01-export-section.py
Section of a filleted block with two holes: 10 bspline edges. The file: 4 LINE, 4 ARC, 2 CIRCLE (4037
bytes, AC1015). Read back: 1 face with 2 holes, edges `circle` and `line`, radii [3, 4, 4, 4, 4, 8], same
area 956.929209.
**📌 doc:** sections become ARC/CIRCLE although the kernel gives B-splines.

### 02-roundtrip.py
Rounded plate minus circle, ellipse and closed spline: 4 ARC, 4 LINE, 1 CIRCLE, 1 ELLIPSE, 1 SPLINE. Back:
3 holes, radii [5, 5, 5, 5, 6], spline control points and knots identical, ellipse 8 x 4, area
2029.804172 vs 2029.804178 (the kernel's area integration).

### 03-units.py
`unit=` mm/inch/cm/m/ft → `$INSUNITS` 4/1/5/6/2; every file reads back as 50.8 mm; read with
`unit="mm"` the inch file is 2 wide. Reading `$INSUNITS` 0 → mm, 1 → 25.4, 2 → 304.8, 5 → 10, 6 → 1000,
13 → 0.001, 21 (US survey foot) → 304.8006096; no header → mm. `unit="MM"`: `ValueError: unknown unit
'MM'; use mm, cm, m, um, inch or ft`.

### 04-plane.py
XZ section: written in its plane (x -20..20, y -10..10), 8 LINE. A circle at z = 7 keeps x 7..13. A
rectangle moved in Plane.XZ: with `plane=Plane.XZ` at 0..10, without at -5..5 (the sketch's plane origin
moved with it). A sketch in XZ with one in XY: with `plane=Plane.XY` "not parallel", without "neither in
planes parallel to XY nor in one sketch's plane". `part.outline(Plane.XY)` edges: 4 LINE + 1 CIRCLE.
**📌 doc:** the plane table; pass `plane=` for world coordinates.

### 05-entities.py
Slot of LWPOLYLINE bulges 1: line/circle edges, area 378.539863 (exact 378.539816). Bulge of 270°: bbox
-2.07..12.07 x -12.07..0. POLYLINE/VERTEX in inches with a bulge: 0..50.8 both ways, area 2303.735.
ARC with extrusion (0, 0, -1) and center (5, 0): lands at x -10..0. ELLIPSE arc + LINE: 78.539817.
Rational SPLINE circle: 314.15931 (bspline edge). Fit-point SPLINE: a wire through (10, 5) (distance 0).
TEXT and POINT: `UserWarning: import_dxf: left out what is not a curve: 1 POINT, 1 TEXT`.

### 06-blocks-layers.py
Blocks: a square block with base point (5, 5) inserted scaled 2 and turned 45° at (100, 0) (bbox
85.86..114.14), a nested block adding a scaled hole, the square mirrored (x scale -1), a 2 x 2 MINSERT of a
circle block on layer GRID: 6 faces, area 500. The block contents on layer 0 take the insert's layer
(GRID centers (200, 0), (200, 20), (210, 0), (210, 20)). Unknown layer: `ValueError: import_dxf: the
drawing has no layer 'CUT'; its layers are GRID, PARTS`.

### 07-open-branch.py
Square with a 0.02 gap on layer CUT: `ModelingError: import_dxf: 1 chain of curves does not close: 4 curves
from (0.02, 10) to (0, 10) on layer 'CUT' (the nearest other loose end is 0.02 mm away). Pick the layers of
the outline with layers=[...], join small gaps with tolerance=..., or read every curve with
import_dxf_wires()`. With `tolerance=0.05`: area 99.95 (the ends meet halfway). `import_dxf_wires`:
`[Wire(4 edges, open, length=39.98)]`. A line leaving a corner: `the outline branches (3 curve ends at
(10, 10))`; its wires: a closed square and the open line. A line drawn twice is read once.

### 08-nesting.py
Square / circle / square: 2 faces, holes [0, 1], 993.1417 = 1600 - 225π + 100. Two crossing circles: the
two crescents, 2 faces, 382.6446.
![nesting](files/08-nesting-nesting.png)

### 09-load-export.py
`shape.export(".dxf")` and `load(".dxf")` → a Sketch; the name is the layer. `export([...])` of a polyline,
a line and an arc: 3 LINE, 1 ARC. Part, Mesh, Vertex, a sphere face: `TypeError` with the messages in the
guide.

### 10-text.py
Tag: RoundedRectangle named cut + Text named engrave: 4 ARC, 49 LINE, 15 SPLINE on layers cut and engrave.
Read together: 4 faces — the letters lie in the outline and become its holes, their counters islands.
`layers=["engrave"]` alone: 5 faces with the text's area.
**📌 doc:** read outline and lettering layers separately.

### 11-doc-examples.py
The examples of the three guides, unchanged: `Sketch(1 faces, area=970.664) [2]`, `[3.0, 8.0]`,
`5823.982`; `Wire(2 edges, open, length=70) False`, `True`; `Vector(40, 12, 0)`; section.dxf 4 LINE +
1 CIRCLE; side.dxf -20..20 x -10..10.

## Coverage
- [x] every parameter (layers, unit, tolerance; unit, plane) and every entity type
- [x] defaults measured (mm without a header, the tolerance, the plane rules)
- [x] errors with their messages; [x] realistic use (sections, tags, paths)
