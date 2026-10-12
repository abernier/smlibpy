# of_type, planar, cylinders, lines, circles

Keep faces or edges by the kind of their underlying surface or curve (`geom_type`).

## Signature
- `sl.of_type(*names)`: one or more names, case-insensitive: `of_type("plane", "cylinder")`.
- Shortcuts: `cylinders()` = `of_type("cylinder")`, `circles()` = `of_type("circle")`.
  `planar()` keeps faces with `is_planar` (planes and flat `bspline` faces); `lines()` keeps
  straight edges (lines and straight `bspline` edges).
- `smooth()` is not a type filter; see `convexity`.

## Names
Face `geom_type`:

| Name | Made by |
|---|---|
| `plane` | flat faces of primitives, extrusions, cuts, chamfers |
| `cylinder` | `Cylinder`, holes, fillets along straight edges |
| `cone` | `Cone` |
| `sphere` | `Sphere`, fillet corners where three rounded edges meet |
| `torus` | `Torus` |
| `extrusion` | extruding a profile with a spline or ellipse edge (the side faces) |
| `revolution` | revolving a profile with a spline edge |
| `bspline` | `loft`, `surface`, `ruled`, sweeps, `to_nurbs()`, many STEP imports |
| `offset` | `offset()` of an extrusion or bspline face |
| `other` | anything the kernel cannot name |

Edge `geom_type`:

| Name | Made by |
|---|---|
| `line` | straight edges of primitives, extrusions, cuts |
| `circle` | full circles and arcs: rims, fillet arcs, `CenterArc` |
| `ellipse` | `Ellipse`, `EllipticalArc`, a plane cutting a cylinder at an angle, two equal crossing cylinders |
| `bspline` | splines, chamfer borders, `loft`, `ruled`, sweeps, `to_nurbs()` |
| `other` | anything the kernel cannot name |

## Returns
A ShapeList in the original order. Shapes without `geom_type` (vertices, parts) are dropped.

## Gotchas
- Unknown names match nothing and raise nothing: `of_type("arc")`, `of_type("cylindrical")` → `[]`.
  Arcs are `"circle"`.
- `circles()` returns arcs too. Fillet arcs and hole rims look alike: filter full circles with
  `e.is_closed`, or by `e.radius`.
- `cylinders()` returns fillet faces and holes alike; filter by `f.radius` or position.
- A straight edge is not always `"line"`: chamfer borders, mirrored or scaled lines, offset
  sketches, `ruled(Line, Line)` and edges of `to_nurbs()` bodies are `"bspline"`. `lines()`
  finds them, `of_type("line")` does not. A flat face is not always `"plane"`: `to_nurbs()` and
  `surface()` faces are `"bspline"` even when flat. `planar()` and `Face.is_planar` find them
  (all control points in one plane), `of_type("plane")` does not.
- `Cone(5, 5, 10)` (equal radii) has a `"cylinder"` face.
- `lines()` on faces and `planar()` on edges return empty lists, no error.

## Example
```python
p = Box(20, 20, 10).fillet(Box(20, 20, 10).edges().parallel_to(Z), 3) - Cylinder(3, 20)
print(len(p.faces().planar()), len(p.faces().cylinders()))   # 6 5: 4 fillets + the hole
print(len(p.faces().of_type("plane", "cylinder")))           # 11
print(len(p.edges().circles().top()))                        # 5: 4 fillet arcs + the hole rim
hole_rims = p.edges().circles().filter(lambda e: e.is_closed)
print(len(hole_rims))                                        # 2
print(p.edges().of_type("arc"))                              # ShapeList([]): unknown name, no error
```

## Related
`filter_by`, `parallel_to`, `Face` (`geom_type`, `radius`), `Edge` (`geom_type`, `radius`), `generic`.
