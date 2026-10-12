# Plan: sketches

Sketches: planar regions, the profiles of extrusions and revolutions.

Docs go to `src/smlibpy/skill/references/sketches/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | Sketch | what a Sketch is (regions with holes on a plane), 2D Booleans (+ - &), several pieces, area, placing with on(), plane, from faces (Face.to_sketch) | [x] generic.md |
| 2 | `Rectangle.md` | Rectangle | sizes, align, rotation if any | [x] Rectangle.md |
| 3 | `RoundedRectangle.md` | RoundedRectangle | radius limits | [x] RoundedRectangle.md |
| 4 | `Circle.md` | Circle | radius, align | [x] Circle.md |
| 5 | `Ellipse.md` | Ellipse | radii, orientation | [x] Ellipse.md |
| 6 | `Polygon.md` | Polygon | point lists, closing, orientation, self-intersection | [x] Polygon.md |
| 7 | `RegularPolygon.md` | RegularPolygon | radius (circumscribed or inscribed), sides, rotation | [x] RegularPolygon.md |
| 8 | `Slot.md` | Slot | the slot variants and their parameters | [x] Slot.md |
| 9 | `Trapezoid.md` | Trapezoid | angles, sizes | [x] Trapezoid.md |
| 10 | `make_face.md` | make_face | from closed wires and curves, holes, errors with open wires | [x] make_face.md |
| 11 | `offset.md` | Sketch.offset | inward and outward, corners (round or sharp), collapse | [x] offset.md |
| 12 | `fillet.md` | Sketch.fillet | rounding 2D corners: which vertices, radius limits | [x] fillet.md |
| 13 | `Profile.md` | Profile | moves (to a point, by an offset, forward, until x/y), headings, tangent arcs, arcs through a point, corner fillets/chamfers, mirror of a half, close/wire, errors | [x] Profile.md |
| 14 | `Triangle.md` | Triangle | base, height, apex, corner options | [x] Triangle.md |
| 15 | `ArcSlot.md` | ArcSlot | radius, width, angle, rotation, limits | [x] ArcSlot.md |
| 16 | `Stroke.md` | Stroke | paths of lines and arcs, ends, corners, closed and crossing paths | [x] Stroke.md |
| 17 | `Hull.md` | Hull | points, circles, arcs, sketches; exact arcs | [x] Hull.md |
| 18 | `chamfer.md` | Sketch.chamfer | corners chosen by geometry | [x] chamfer.md |
| 19 | `mirror.md` | Sketch.mirror | axes in the plane, planes, normals, exact edges | [x] mirror.md |
| 20 | shapes again | Rectangle, RoundedRectangle, Polygon, RegularPolygon, Trapezoid, Ellipse, Slot | fillet=/chamfer=/rotation= options, the slot variants | [x] updated |
| 21 | `fillet.md`, `offset.md`, `generic.md` | Sketch.fillet, Sketch.offset, Sketch | corner selection, line-arc corners, corner styles, exact Booleans, perimeter | [x] updated |
| 22 | `recipes/profiles.md` | all of the above | which tool for which outline | [x] recipes/profiles.md |

Session: `ai/training/2026-10-13_00-42-19_sketches-profiles` (design: `ai/plan/2d.md`).
