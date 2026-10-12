# Measures: volume, area, center, length

The single numbers of each shape type. All are exact-geometry integrations (see `generic`).

## Which shape has what

| Shape | `volume` | `area` | `center()` | `length` | `bbox()` |
|---|---|---|---|---|---|
| `Part` | mm³ | total surface, cavities included | center of mass | - | tight |
| `Shell` | - | sum of face areas | area centroid | - | tight |
| `Sketch` | - | region area, holes removed | area centroid | - | tight |
| `Face` | - | area | area centroid (may lie off the face) | - | tight |
| `Wire` | - | - | length-weighted average of edge midpoints | sum of edges | union of edges |
| `Edge` | - | - | point halfway along the edge | arc length | tight on bodies |
| `Vertex` | - | - | the point | - | the point |
| `ShapeList` | - | - | plain average of the members' centers | - | union |

`volume`, `area` and `length` are properties; `center()` and `bbox()` are methods.

## Accuracy

- `Part.volume`, `Part.area`, `Part.center()`: integration at 1e-7; box exact, curved
  primitives 1e-8 to 3e-7, swept bodies up to 1.5e-5. For more, use
  `mass_properties(accuracy=1e-10)`; these properties take no accuracy argument.
- `Face.area`, `Sketch.area`, `Shell.area`: 1e-7, fixed. Measured: cylinder face 9e-8, sphere
  1.3e-7, torus 2.4e-7, ring sketch 1.6e-8.
- `Edge.length`: lines exact, circles and arcs 5e-12, ellipses 8e-11, splines 3e-9.

## Gotchas

- **`Edge.center()` of an arc or circle is a point on the curve**, not the circle's center.
  Use `edge.arc_center` and `edge.radius`. `part.edges().circles().center()` of a cylinder's
  two rims is `(-6, 0, 0)`, a point on the rim, not the axis.
- `Wire.center()` is not the centroid of a curved wire: a semicircle plus its diameter gives
  y = 6.11 instead of 3.89. It is right for straight segments.
- `ShapeList.center()` is not weighted: `part.faces().center()` averages the face centers
  regardless of their size. For a centroid use the body's `center()`.
- `Face.center()` of a curved face is the area centroid and may lie off the face (a
  half-cylinder face of radius 10 gives a point 2r/π = 6.366 from the axis). Use
  `face.interior_point()` for a point on the face.
- Every call of `Part.volume`, `area` or `center()` integrates again (a sphere: 28 ms each).
  Store the value or use `mass_properties()`.
- `Shell` and `Sketch` have no `volume` (`AttributeError`). A cylinder has 3 edges with seams
  (`part.edges(seams=True)`), 2 without; seams do not change `area` or `volume`.
- `Sketch.area` stays the same wherever the sketch is placed (`.on(tilted_plane)`); its
  `center()` moves with it.
- A standalone spline edge's `bbox()` (made with `Spline`, not taken from a body) is sampled
  at 33 points and can be too small (0.07 mm on a 35 mm wavy spline). A body's bbox is exact.

## Example

```python
part = Box(40, 30, 20) - Cylinder(6, 30)
print(round(part.volume, 4))                    # 21738.0534 = 24000 - pi*36*20

hole = part.faces().filter_by(lambda f: f.geom_type == "cylinder").one()
print(round(hole.area, 4), hole.radius)         # 753.9823 6.0

rim = part.edges().circles().sort_by(Z)[-1]     # top edge of the hole
print(rim.arc_center, rim.radius)               # Vector(0, 0, 10) 6.0
print(rim.center())                             # a point ON the circle, not its center
print(round(rim.length, 6))                     # 37.699112 = 2*pi*6

ring = Circle(10) - Circle(4)
print(round(ring.area, 5), ring.center())       # 263.89379 (about 0, 0, 0)
```

## Related

`mass_properties`, `generic`, `distance_to`, `selection/*` for picking faces and edges
