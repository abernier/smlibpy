# Plan: curves

Curves and wires: the 1D API, for paths, profiles and helices.

Docs go to `src/smlibpy/skill/references/curves/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | Edge, Wire | curves are Edges; joining them into Wires; open and closed; from wires to sketches (make_face, to_sketch); 2D curves on planes | [ ] |
| 2 | `Line.md` | Line | every parameter, edge cases, errors | [ ] |
| 3 | `Polyline.md` | Polyline | close= | [ ] |
| 4 | `PolarLine.md` | PolarLine | angle reference, plane | [ ] |
| 5 | `CenterArc.md` | CenterArc | start angle, arc size, direction, plane | [ ] |
| 6 | `ThreePointArc.md` | ThreePointArc | every parameter, edge cases, errors | [ ] |
| 7 | `RadiusArc.md` | RadiusArc | which of the two arcs (sign of radius) | [ ] |
| 8 | `SagittaArc.md` | SagittaArc | sign of the sagitta | [ ] |
| 9 | `TangentArc.md` | TangentArc | tangent direction, chaining | [ ] |
| 10 | `EllipticalArc.md` | EllipticalArc | every parameter, edge cases, errors | [ ] |
| 11 | `Spline.md` | Spline | through points, tangents, closed, periodic | [ ] |
| 12 | `Bezier.md` | Bezier | control points, weights if any | [ ] |
| 13 | `Helix.md` | Helix | pitch, height, radius, direction (left/right hand), cone angle if any; use as a sweep path | [ ] |
| 14 | `FilletPolyline.md` | FilletPolyline | radius limits | [ ] |
| 15 | `Wire.md` | Wire | Wire([...]) ordering, close, fillet, is_closed, length, point_at, tangent_at, start, end, reversed, to_sketch | [ ] |
