# Plan: selection

Querying and selecting: getting at faces, edges and vertices by geometry.

Docs go to `src/smlibpy/skill/references/selection/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | ShapeList | what a ShapeList is, chaining, empty results and what they do downstream, order, why geometry beats indices, the selection idioms agents need most | [x] `generic.md` |
| 2 | `topology.md` | faces(), edges(), vertices(), wires(), Part.solids() | on parts, sketches, shells, faces, edges; Face.edges, neighbors, owner, outer_wire, inner_wires; Edge.faces; counts on common parts | [x] `topology.md` |
| 3 | `positional.md` | top, bottom, left, right, front, back | on faces, edges and vertices; ties (several at the same height); what top() means for edges | [x] `positional.md` |
| 4 | `filter_by.md` | filter_by, filter | axis, geometry type string, callable; differences between faces and edges | [x] `filter_by.md` |
| 5 | `parallel_to.md` | parallel_to, perpendicular_to | meaning for faces (normal) and for edges (direction), tolerance | [x] `parallel_to.md` |
| 6 | `types.md` | of_type, planar, cylinders, circles, lines, smooth | all geometry type names (plane, cylinder, cone, sphere, torus, bspline, ...; line, circle, ellipse, bspline) | [x] `types.md` |
| 7 | `convexity.md` | convex, concave, Edge.convexity, Edge.is_convex | which edges count as convex or concave; smooth (tangent) edges; use for fillets | [x] `convexity.md` |
| 8 | `sort_by.md` | sort_by, sort_by_distance, sort, reverse, group_by | keys (axis, callable), group_by results | [x] `sort_by.md` |
| 9 | `extremes.md` | largest, smallest, min_by, max_by, first, last, one, at | by area/length/volume, errors on empty lists, one() with zero or several | [x] `extremes.md` |
| 10 | `spatial.md` | nearest, within, facing | distance semantics, facing a direction | [x] `spatial.md` |
| 11 | `Face.md` | Face | geom_type, area, center, normal_at, plane, radius, axis, is_planar, interior_point, to_sketch, to_shell, extrude, inner and outer wires | [x] `Face.md` |
| 12 | `Edge.md` | Edge | geom_type, length, start, end, point_at, tangent_at, direction, normal, radius, arc_center, is_closed, is_seam, intersections, reversed | [x] `Edge.md` |
| 13 | `Vertex.md` | Vertex | point, x, y, z, Vertex(x, y, z), vertices of a part | [x] `Vertex.md` |
| 14 | `list_transforms.md` | ShapeList.translate, rotate, moved, on, copy, append, extend | a ShapeList as a list; transforming many shapes at once | [x] `list_transforms.md` |
