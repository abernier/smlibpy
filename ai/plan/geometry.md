# Plan: geometry

Geometry, placement and patterns: the generic API every script uses.

Docs go to `src/smlibpy/skill/references/geometry/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | conventions | units (mm, degrees), Z up, shapes are values (operations return new shapes), TOLERANCE, repr and info() of shapes, how to print and compare results | [x] `generic.md` |
| 2 | `Vector.md` | Vector | construction (3 numbers, tuple, 2D), arithmetic, dot, cross, length, normalized, angle, to_tuple, X/Y/Z as directions | [x] `Vector.md` |
| 3 | `Axis.md` | Axis, X, Y, Z | construction, the world axes, where an Axis is accepted (rotate, revolve, mirror, selection), moving an axis | [x] `Axis.md` |
| 4 | `Plane.md` | Plane | named planes (XY, XZ, YZ, ...), origin/x_dir/z_dir, offset, rotation, a face's plane, sketches on planes, local vs world coordinates | [x] `Plane.md` |
| 5 | `Location.md` | Location | construction, multiplication order, inverse, applying to shapes with moved(), composing placements | [x] `Location.md` |
| 6 | `Pos.md` | Pos | translations, Pos * shape, Pos * Rot | [x] `Pos.md` |
| 7 | `Rot.md` | Rot | rotation order (X, then Y, then Z), degrees, Rot * shape, around which point | [x] `Rot.md` |
| 8 | `BoundBox.md` | BoundBox, bbox() | min, max, size, center, diagonal; bbox of parts, sketches, faces, edges, lists; tight or not | [x] `BoundBox.md` |
| 9 | `Align.md` | Align | the align= parameter of primitives and sketches: MIN, CENTER, MAX per axis, how it shows in bbox | [x] `Align.md` |
| 10 | `translate.md` | translate | on every shape type and ShapeList; tuple or Vector | [x] `translate.md` |
| 11 | `rotate.md` | rotate | axis and angle, rotation about an axis through a point, direction of positive angles | [x] `rotate.md` |
| 12 | `scale.md` | scale | uniform scale, about which point, effect on volume | [x] `scale.md` |
| 13 | `mirror.md` | mirror (placement) | mirror about planes; mirroring then fusing (symmetric parts) | [x] `mirror.md` |
| 14 | `moved.md` | moved | moved(Location) vs translate/rotate, relative vs absolute | [x] `moved.md` |
| 15 | `on.md` | on | putting sketches and parts on planes and faces: orientation of the local axes on a face, offsets | [x] `on.md` |
| 16 | `Locations.md` | Locations | a list of placements, Locations * shape, iterating | [x] `Locations.md` |
| 17 | `GridLocations.md` | GridLocations | spacing, counts, centering, order of the copies, use with holes | [x] `GridLocations.md` |
| 18 | `PolarLocations.md` | PolarLocations | radius, count, start angle, full circle vs arc, rotating the copies or not | [x] `PolarLocations.md` |
| 19 | `HexLocations.md` | HexLocations | spacing, counts, layout | [x] `HexLocations.md` |
