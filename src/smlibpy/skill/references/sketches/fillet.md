# Sketch.fillet

Rounds corners of a sketch region with exact tangent arcs: every sharp corner, or the ones you
select by geometry. Corners between lines, between lines and arcs, and between arcs; on the
outline and on holes.

## Signature
`sketch.fillet(radius, vertices=None)` (and `fillet(vertices, radius)` as a function)
- `radius`: the arc radius, positive.
- `vertices`: `None` rounds every sharp corner. Otherwise the corners to round: vertices of
  the sketch, usually a selection, or points in **world coordinates** (`[(20, 10)]`; a single
  point must still be inside a list).

## Choosing corners
`s.vertices()` is a `ShapeList`; its selectors pick corners:
- `.convex()`: outside corners (the region's angle below 180°). `.concave()`: inside corners,
  also every corner of a square hole. `.smooth()`: tangent joints (nothing to round).
- By position: `.top()`, `.right()`, `.max_by(X)`, `.nearest((x, y))`, `.filter(lambda v: v.x > 0)`.
- `vertex.convexity` is `"convex"`, `"concave"` or `"smooth"` for a corner of a sketch.

The L `Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))` has 5 convex corners and
1 concave one; a plate with a square hole has 4 of each.

## Returns
A new `Sketch` with `line` and `circle` edges; areas are exact.
- Convex corners lose material, concave ones gain it: the L with its inner corner rounded
  (r 4) has area 499.4336 = 496 + (4 - pi)*4.
- The new arcs meet their neighbours tangentially: those joints count as `smooth`, so a later
  `.convex()` selection does not pick them up.
- Corners between a line and an arc (a rectangle fused with a circle) and between arcs (a lens)
  are rounded too.

## Radius limits
A corner cuts back `radius·tan(turn/2)` along both of its edges (`radius` at 90°). The cut
backs on one edge must fit in it, otherwise the error says how much each corner needs:
- All four corners of a 40 x 20 rectangle: up to 10 (at 10 the short sides vanish).
- One corner only: up to 20 (the whole short edge).
- Acute corners need much more room: a 50 x 5 right triangle takes radius 1, not 3.

## Gotchas
- On a placed sketch, points are world points: on `Plane.XZ` the top corners of
  `Rectangle(20, 10)` are (±10, 0, 5). Selectors avoid the arithmetic: `placed.vertices().top()`.
- `Rectangle(..., fillet=r)`, `Polygon(..., fillet=r)` round all corners when building.
- `Part.fillet(edges, radius)` takes its arguments the other way round; the function
  `fillet(selection, radius)` works for both.

## Errors
- `ModelingError: fillet: (1, 2) is not a corner of the sketch; its corners are at (-10, -5), ...`
- `ModelingError: fillet: radius 30 at (-30, 20) and radius 30 at (-30, -20) overlap on the line
  (-30, 20) -> (-30, -20): they need 30 + 30 of its 40; use smaller corners`
- `ModelingError: fillet: the sketch has no sharp corners to round` (Slot, Circle).
- `ModelingError: fillet: the corner at (10, 5) is smooth (its edges meet tangentially), so there
  is nothing to round; ...`: a smooth corner was selected.
- `ModelingError: fillet: the corner at (20, 0) joins the bspline ...; fillet works on corners
  between lines and arcs. ...`: pass only the line/arc corners.
- `ValueError: fillet: the radius must be positive`.
- `TypeError: fillet: the corners are given as vertices or points, not as an Edge ...`.

## Example
```python
angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))
inner = angle.fillet(4, angle.vertices().concave())           # area 499.4336
plate = Rectangle(60, 40) - Rectangle(20, 10)
soft_hole = plate.fillet(2, plate.vertices().concave())       # only the hole's corners
tab = Rectangle(30, 10).fillet(5, Rectangle(30, 10).vertices().right())   # round right end
same = fillet(plate.vertices().concave(), 2)                  # the function form
```

## Related
`chamfer`, `Profile` (`.fillet(r)` while drawing), `Rectangle(fillet=)`, `offset`,
`Part.fillet` (features).
