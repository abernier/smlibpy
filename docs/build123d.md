# Coming from build123d

smlibpy borrows build123d's vocabulary (`Box`, `Rectangle`, `Pos`, `Rot`, `Plane`, `Axis`,
`GridLocations`, `extrude`, `fillet`, `export_step`, ...), so most algebra-mode code reads
the same. Two things are different by design:

1. **There are no builders.** smlibpy has one style, comparable to build123d's algebra
   mode. Shapes are values and every operation returns a new one.
2. **Features are methods as well as functions.** `part.fillet(edges, r)` and
   `fillet(edges, r)` do the same; methods show up in autocompletion.

## Builder mode to smlibpy

=== "build123d"

    ```py
    with BuildPart() as p:
        Box(80, 60, 10)
        fillet(p.edges().filter_by(Axis.Z), radius=8)
        with Locations(p.faces().sort_by(Axis.Z)[-1]):
            with GridLocations(60, 40, 2, 2):
                Hole(4)
        with BuildSketch(p.faces().sort_by(Axis.Z)[-1]):
            Rectangle(30, 20)
        extrude(amount=-4, mode=Mode.SUBTRACT)
    part = p.part
    ```

=== "smlibpy"

    ```py
    part = Box(80, 60, 10)
    part = part.fillet(part.edges().parallel_to(Z), 8)
    top = part.faces().top()
    part -= (GridLocations(60, 40, 2, 2) * Hole(4, 10)).on(top)
    part -= Rectangle(30, 20).on(top).extrude(-4)
    ```

What was implicit in the builder is explicit here: the face a sketch sits on (`.on(top)`)
and whether a feature adds or removes material (`+`, `-`).

## Names that map directly

| build123d | smlibpy | Notes |
|---|---|---|
| `Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge` | same | |
| `Hole(radius, depth)` | same | depth is required |
| `CounterBoreHole`, `CounterSinkHole` | same | same parameter order |
| `Rectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`, `Trapezoid` | same | |
| `RectangleRounded` | `RoundedRectangle` | |
| `SlotOverall` | `Slot` | |
| `Line`, `Polyline`, `CenterArc`, `ThreePointArc`, `RadiusArc`, `SagittaArc`, `TangentArc`, `Spline`, `Bezier`, `Helix`, `PolarLine`, `FilletPolyline` | same | `CenterArc(center, radius, start_angle, arc_size)` |
| `EllipticalCenterArc` | `EllipticalArc` | |
| `make_face(...)` | `make_face(outer, *holes)` | |
| `extrude`, `revolve`, `loft`, `sweep` | same | `sweep` centers and orients the profile for you |
| `fillet`, `chamfer`, `mirror`, `split`, `section` | same | `mirror` defaults to `Plane.XZ` |
| `offset(part, -t, openings=faces)` | `part.shell(t, openings)` | |
| `offset(part, d)` | `part.offset(d)` | |
| `Pos`, `Rot`, `Location`, `Plane`, `Axis`, `Vector` | same | `Rot` angles apply about X, then Y, then Z (world axes) |
| `Locations`, `GridLocations`, `PolarLocations`, `HexLocations` | same | |
| `Align.MIN/CENTER/MAX` | same | |
| `export_step`, `export_stl`, `export_gltf` | same | plus `export_glb`, `save` |
| `show(...)` (ocp_vscode) | `show(...)` | browser or Jupyter, no extension needed |

## Selectors

| build123d | smlibpy |
|---|---|
| `.filter_by(Axis.Z)` | `.parallel_to(Z)` (`filter_by` works too) |
| `.filter_by(GeomType.CIRCLE)` | `.circles()` or `.of_type("circle")` |
| `.sort_by(Axis.Z)[-1]` | `.top()` (all faces at the top) or `.sort_by(Z).last` |
| `.group_by(Axis.Z)[-1]` | `.max_by(Z)` or `>> Z` |
| `.sort_by(SortBy.AREA)` | `.sort_by("area")` |
| `.filter_by(lambda f: ...)` | `.filter(lambda f: ...)` |

## Measures

| build123d | smlibpy |
|---|---|
| `part.volume`, `part.area` | same |
| `part.center()` | same (center of mass) |
| `part.bounding_box()` | `part.bbox()` |
| `face.normal_at()`, `edge.position_at(t)`, `edge % t` | `face.normal_at()`, `edge.point_at(t)`, `edge.tangent_at(t)` |

## What smlibpy adds

- Curvature-continuous fillets: `part.fillet(edges, r, continuity="G2")`.
- Variable-radius fillets: `part.fillet(edge, (r_start, r_end))`.
- Edge classification: `.convex()`, `.concave()`, `.smooth()`.
- Freeform surfaces through point grids, ruled surfaces, stitching, thickening.
- Exact mass properties with an accuracy setting, silhouettes, curve projection, mesh
  Booleans.
- An exact native format (`save`/`load`).

## What is missing (for now)

Text, assemblies with joints, 2D drawings.
