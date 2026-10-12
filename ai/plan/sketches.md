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
| 13 | `Text.md` | Text | size (cap height), alignment of the layout box, lines, spacing, kerning, fonts, holes and fill rules, text along a path, emboss and engrave (flat and curved faces), errors | [x] Text.md |
