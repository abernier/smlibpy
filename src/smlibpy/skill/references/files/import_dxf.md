# import_dxf

Reads the outlines of a DXF drawing as a `Sketch` with exact curves, ready to extrude or
revolve. `load("x.dxf")` does the same.

## Signature
`import_dxf(path, *, layers=None, unit=None, tolerance=None)`

- `path`: an ASCII DXF file (R12 to current versions). Binary DXF raises.
- `layers`: a layer name or a list of them, in any letter case; only their curves are read.
- `unit`: the drawing's unit (`"mm"`, `"cm"`, `"m"`, `"um"`, `"inch"`, `"in"`, `"ft"`), used
  instead of the file's `$INSUNITS`. Without it, `$INSUNITS` decides; a file without a unit
  (no header, or 0) is read as mm.
- `tolerance`: curve ends closer than this (mm) are joined. Default: 1e-7 of the drawing's size.

## Returns
A `Sketch` on `Plane.XY` with the drawing's coordinates in mm (not centered). Faces have their
holes; separate outlines are separate faces.

| Entity | Becomes |
|---|---|
| LINE | `line` edge |
| CIRCLE, ARC | `circle` edge with the exact radius (in its object coordinates; mirrored arcs with extrusion (0, 0, -1) come out right) |
| ELLIPSE | `ellipse` edge (full or an arc) |
| LWPOLYLINE, POLYLINE (2D) | lines, and exact arcs where a vertex has a bulge (any angle, also above 180°) |
| SPLINE | the NURBS of its control points, knots and weights; periodic ones are clamped exactly; one with fit points only is interpolated through them |
| INSERT | the block's curves, moved, scaled (also unevenly), mirrored, rotated; nested blocks; arrays (MINSERT) |

Everything else (TEXT, MTEXT, HATCH, DIMENSION, POINT, meshes) is left out with one warning:
`UserWarning: import_dxf: left out what is not a curve: 1 POINT, 1 TEXT`. Paper space is ignored.

## Loops and holes
- The curves are joined end to end into loops; line and spline ends are moved onto the exact
  ends of the arcs they meet, so arcs keep their radius.
- Loops nest by the even-odd rule: a loop inside a loop is a hole, a loop inside a hole an
  island. Square 40 / circle r 15 / square 10 inside each other: 2 faces (the frame with a hole,
  the island), area 993.1417 = 1600 - π·225 + 100.
- Loops that cross follow the same rule: two circles of radius 10, 10 apart, give the two
  crescents (2 faces, area 382.6446); their overlap is empty.
- A curve drawn twice is read once.

## Gotchas
- **Text inside an outline becomes holes.** A tag drawn as an outline (layer `cut`) with
  lettering (layer `engrave`) read together gives the outline with letter-shaped holes and the
  counters of the letters as islands (4 faces for `PART 7`). Read the layers one at a time:
  `outline = import_dxf(p, layers=["cut"])`, `letters = import_dxf(p, layers=["engrave"])`.
- Construction lines, center lines and dimensions of a drawing are curves too and make the
  import fail (open or branching). Pick the layers of the outline.
- A gap larger than the tolerance is an open chain. `tolerance=` closes it by moving both ends
  halfway: a square with a 0.02 gap read with `tolerance=0.05` has area 99.95, not 100.
- `$INSUNITS` 21 (US survey feet) is 304.8006096 mm, not 304.8.
- Splines given only by fit points are interpolated by smlibpy; the drawing program's own curve
  through those points may differ slightly.
- Many holes in one outline take time: the kernel's face building grows with the square of the
  holes (a plate with 100 holes 0.04 s, 900 holes 2.5 s, 1911 holes 11 s).

## Errors
- `ModelingError: import_dxf: 1 chain of curves does not close: 4 curves from (0.02, 10) to (0, 10) on layer 'CUT' (the nearest other loose end is 0.02 mm away). Pick the layers of the outline with layers=[...], join small gaps with tolerance=..., or read every curve with import_dxf_wires()`.
- `ModelingError: import_dxf: the outline branches (3 curve ends at (10, 10)); a loop needs exactly two curve ends at each corner. ...`.
- `ValueError: import_dxf: the drawing has no layer 'CUT'; its layers are GRID, PARTS`.
- `ModelingError: import_dxf: the drawing has no curves (lines, arcs, circles, ellipses, polylines, splines or blocks of them)`.
- `ValueError: unknown unit 'MM'; use mm, cm, m, um, inch or ft`.
- `ModelingError: import_dxf: the outlines are not in one plane parallel to XY ...`: a 3D drawing.
- `FileNotFoundError` for a missing file; `ValueError: ...: a binary DXF; save the drawing as ASCII DXF`.

## Example
```python
part = Box(40, 30, 20) - Cylinder(8, 30) - Cylinder(3, 30).translate(14, 8, 0)
export_dxf(part.section(Plane.XY), "section.dxf")      # a drawing to read back
outline = import_dxf("section.dxf")
print(outline, [len(f.inner_wires()) for f in outline.faces()])   # Sketch(1 faces, area=970.664) [2]
print(sorted(round(e.radius, 9) for e in outline.edges() if e.geom_type == "circle"))   # [3.0, 8.0]
plate = outline.extrude(6)                             # z 0..6
print(round(plate.volume, 3))                          # 5823.982
```

## Related
`import_dxf_wires` (every chain, open ones too), `export_dxf`, `load`, `make_face`,
`Sketch.extrude` (features), `generic.md`.
