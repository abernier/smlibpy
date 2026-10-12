# Training: geometry · patterns

**Date:** 2026-10-12

## Goal

APIs: `Locations`, `GridLocations`, `PolarLocations`, `HexLocations`.

Questions:
- Which inputs does Locations take? What does multiplication with shapes, locations, lists
  return? Does `.on()` work on a pattern?
- Grid: order of copies, centering, counts, use with holes on faces.
- Polar: full circle vs arc, start angle, rotate on/off, radius 0.
- Hex: spacing, row offset, centering, honeycomb walls.

## Log

### 01-locations.py
Points (2D/3D), Pos, Plane (with rotation), Face (face plane), Vertex, Vector, list, nested
Locations all accepted. ShapeList of 4 side faces -> 4 locations at the face centers.
`L * Sphere` -> ShapeList of 3; `L * [a, b]` -> 6; `L * Rot` -> Locations; `L * L` -> 6.
**`Pos(...) * L` and `Plane * L` -> plain list; `Pos * L * Box` -> TypeError "can't multiply
sequence by non-int of type 'Part'". `L.on(top)` -> plain list; `L.on(top) * Circle` ->
TypeError.** `(L * Circle).on(top)` works. `Pos * ShapeList` -> plain list.
plate - 3 holes: vol diff 188.4956 = 3·π·4·5. `part - (Locations() * tool)` unchanged.

### 02-grid.py
Order x fastest then +y rows; centered (±20, ±5); centered=False from origin; 1x1 at origin;
negative spacing reverses; zero spacing stacks. Count 0/-1 -> ValueError "counts must be at
least 1"; float count -> TypeError. 4 corner holes in 80x60 plate: centers (±30, ±20),
vol diff 2010.62 (exact 2010.6193), valid. Blind Hole pattern on top: vol diff 678.584.
Grid on front face: grid x -> world X. Sketch minus grid area exact.
![side](files/02-grid-side.png) (my test put two holes on the plate edge -> half holes)

### 03-polar.py
6 on r30: 0, 60, ..., -60; rotation equals angle. start_angle=15 -> 15, 105, ...
Arc 90 count 4: 0, 30, 60, 90 (ends included). Range -360: clockwise. Range 720 count 4:
0, 240, 480, 720 -> coincident. **Range 359.9999: first and last coincide.** count 0 ->
ValueError. radius 0 turns only. Negative radius: opposite side.
rotate=True bars alternate (10,2,2)/(2,10,2); rotate=False all (10,2,2).
Flange with 8 holes: valid, hole angles every 45°. Gear sketch 1 face.
![bars](files/03-polar-bars.png) ![gear](files/03-polar-gear.png)

### 04-hex.py
3x2: (-12.5,-4.33), (-2.5,-4.33), (7.5,-4.33), (-7.5,4.33), ... Row dy = 8.66 = 10·√3/2,
odd rows +5. Smallest distances 6, 10.39, 12 for spacing 6 -> all neighbours at `spacing`.
Centered by bbox of points (centroid also 0 here). Counts 0/negative -> empty, no error.
Honeycomb 6x5 cells: valid, 186 faces, wall 1.5 exactly.
Docstring "rows spacing apart along X" is misleading: positions are spacing apart along X,
rows are spacing·√3/2 apart along Y.
![honeycomb](files/04-hex-honeycomb.png)

### 05..08 (doc examples)
05-ex-locations (first draft counted 7 "corners": vertices().top() of a holed plate include
hole seam vertices; example changed to a fresh Box, now 4), 06-ex-grid, 07-ex-polar,
08-ex-hex: all run, outputs match comments.

### 09-claims.py
PolarLocations(20,4) * Pos(5) -> radial offsets (25,0), (0,25), ...: local frame.
Grid * Pos(0,0,10) * Box works (z 10). Hex cells without rotation=30: x wall 0.2624
(corners face each other); with rotation=30 the diagonal wall is 1.5 too.

## Coverage
- every API ran; every parameter tried (spacing, counts, centered, start_angle,
  angular_range full/arc/negative/near-360, rotate, radius 0/negative).
- errors recorded. Realistic: plates with holes, flange, gear, honeycomb, studs on faces.
- gaps: none for these rows.
