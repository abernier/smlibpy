# Sketch.chamfer

Bevels corners of a sketch region: each corner is cut back by a length along both of its
edges and the two points are joined by a straight line. Every sharp corner, or the ones you
select by geometry.

## Signature
`sketch.chamfer(length, vertices=None)` (and `chamfer(vertices, length)` as a function)
- `length`: the cut-back along each edge, measured along the edge (along the arc for an arc).
- `vertices`: as for `fillet`: `None` for every sharp corner, or vertices of the sketch
  (`s.vertices().convex()`, `.top()`, ...) or world points in a list.

## Returns
A new `Sketch`; the cut is a `line` edge.
- `Rectangle(40, 20).chamfer(3)`: 8 lines, area 800 - 4 * 3*3/2 = 782.
- A 90° corner loses `length**2 / 2`: the L with the five outer corners chamfered by 1 loses 2.5.
- Corners between lines and arcs work too: `Rectangle(40, 20) + Circle(15).translate(20, 0)` has
  two concave line-arc corners at (8.8197, ±10); chamfered by 1 its area grows from 1230.8662 to
  1231.5777. So do corners next to splines and ellipses (the length measured along the curve; the
  curve is cut there).

## Gotchas
- Symmetric only (the same length on both edges). An asymmetric bevel: draw it with `Profile`
  or cut a `Triangle`/`Polygon` away.
- Smooth corners have nothing to bevel; a selection that contains one raises.
- `Rectangle(..., chamfer=c)`, `Polygon(..., chamfer=c)` bevel all corners when building.

## Errors
- `ModelingError: chamfer: length 6 at (-5, 5) and length 6 at (-5, -5) overlap on the line
  (-5, 5) -> (-5, -5): they need 6 + 6 of its 10; use smaller corners`
- `ValueError: chamfer: the length must be positive`.
- Points that are no corner, smooth corners: as for `fillet`.

## Example
```python
plate = Rectangle(60, 40) - Rectangle(20, 10)
beveled = plate.chamfer(1, plate.vertices().convex())         # outline only, area 2198
angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))
part = angle.fillet(4, angle.vertices().concave())
part = part.chamfer(1, part.vertices().convex())              # area 496.9336
```

## Related
`fillet`, `Profile` (`.chamfer(d)` while drawing), `Rectangle(chamfer=)`, `Part.chamfer` (features).
