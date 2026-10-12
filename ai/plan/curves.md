# Plan: curves

Curves and wires: the 1D API, for paths, profiles and helices.

Docs go to `src/smlibpy/skill/references/curves/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | Edge, Wire | curves are Edges; joining them into Wires; open and closed; from wires to sketches (make_face, to_sketch); 2D curves on planes | [x] `generic.md` |
| 2 | `Line.md` | Line | every parameter, edge cases, errors | [x] `Line.md` |
| 3 | `Polyline.md` | Polyline | close= | [x] `Polyline.md` |
| 4 | `PolarLine.md` | PolarLine | angle reference, plane | [x] `PolarLine.md` |
| 5 | `CenterArc.md` | CenterArc | start angle, arc size, direction, plane | [x] `CenterArc.md` |
| 6 | `ThreePointArc.md` | ThreePointArc | every parameter, edge cases, errors | [x] `ThreePointArc.md` |
| 7 | `RadiusArc.md` | RadiusArc | which of the two arcs (sign of radius) | [x] `RadiusArc.md` |
| 8 | `SagittaArc.md` | SagittaArc | sign of the sagitta | [x] `SagittaArc.md` |
| 9 | `TangentArc.md` | TangentArc | tangent direction, chaining | [x] `TangentArc.md` |
| 10 | `EllipticalArc.md` | EllipticalArc | every parameter, edge cases, errors | [x] `EllipticalArc.md` |
| 11 | `Spline.md` | Spline | through points, tangents, closed, periodic | [x] `Spline.md` |
| 12 | `Bezier.md` | Bezier | control points, weights if any | [x] `Bezier.md` |
| 13 | `Helix.md` | Helix | pitch, height, radius, direction (left/right hand), cone angle if any; use as a sweep path | [x] `Helix.md` |
| 14 | `FilletPolyline.md` | FilletPolyline | radius limits | [x] `FilletPolyline.md` |
| 15 | `Wire.md` | Wire | Wire([...]) ordering, close, fillet, is_closed, length, point_at, tangent_at, start, end, reversed, to_sketch | [x] `Wire.md` |
