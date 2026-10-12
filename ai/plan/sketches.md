# Plan: sketches

Sketches: planar regions, the profiles of extrusions and revolutions.

Docs go to `src/smlibpy/skill/references/sketches/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | Sketch | what a Sketch is (regions with holes on a plane), 2D Booleans (+ - &), several pieces, area, placing with on(), plane, from faces (Face.to_sketch) | [ ] |
| 2 | `Rectangle.md` | Rectangle | sizes, align, rotation if any | [ ] |
| 3 | `RoundedRectangle.md` | RoundedRectangle | radius limits | [ ] |
| 4 | `Circle.md` | Circle | radius, align | [ ] |
| 5 | `Ellipse.md` | Ellipse | radii, orientation | [ ] |
| 6 | `Polygon.md` | Polygon | point lists, closing, orientation, self-intersection | [ ] |
| 7 | `RegularPolygon.md` | RegularPolygon | radius (circumscribed or inscribed), sides, rotation | [ ] |
| 8 | `Slot.md` | Slot | the slot variants and their parameters | [ ] |
| 9 | `Trapezoid.md` | Trapezoid | angles, sizes | [ ] |
| 10 | `make_face.md` | make_face | from closed wires and curves, holes, errors with open wires | [ ] |
| 11 | `offset.md` | Sketch.offset | inward and outward, corners (round or sharp), collapse | [ ] |
| 12 | `fillet.md` | Sketch.fillet | rounding 2D corners: which vertices, radius limits | [ ] |
