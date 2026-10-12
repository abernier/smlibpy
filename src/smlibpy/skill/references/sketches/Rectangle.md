# Rectangle

A `width` by `height` rectangle on the XY plane, centered on the origin, with optional
rounded or beveled corners.

## Signature
`Rectangle(width, height, *, fillet=0, chamfer=0, rotation=0, align=Align.CENTER)`
- `width` runs along X, `height` along Y.
- `fillet`: round all four corners with this radius. `chamfer`: bevel them by this length.
  One or the other, at most half the shorter side.
- `rotation`: degrees counterclockwise about the center. `align` works on the turned outline.

## Returns
A `Sketch`, normal +Z. Plain: 4 line edges, bbox `±width/2` by `±height/2`.
- `fillet=r`: 8 edges (4 lines, 4 `circle` arcs), area `w*h - (4 - pi)*r**2`
  (`Rectangle(80, 50, fillet=6)`: 3969.0973).
- `fillet` = half the shorter side: the short sides vanish, a stadium of 4 edges
  (`Rectangle(40, 20, fillet=10)`: area 714.1592, the same region as `Slot(40, 20)`).
- `chamfer=c`: 8 lines, area `w*h - 2*c**2` (`Rectangle(40, 20, chamfer=3)`: 782).
- `rotation=30`: bbox ±22.32 x ±18.66, still 4 lines.

## align
One value for both axes or one per axis (`Align`, `"min"`/`"center"`/`"max"`, or `None`):
- `Align.MIN`: lower left corner on the origin (0..w, 0..h).
- `Align.MAX`: upper right corner on the origin (-w..0, -h..0).
- `(Align.MIN, Align.CENTER)`: x 0..w, y centered. `None` for an axis leaves it centered.

## Gotchas
- `RoundedRectangle(w, h, r)` is the older name of `Rectangle(w, h, fillet=r)`.
- To round only some corners: `s.fillet(r, s.vertices().filter(...))` (see `fillet`).
- `align` also moves `sketch.plane.origin` (to the rectangle's center). `revolve()` without
  an axis turns about the local Y axis through that origin, which crosses the rectangle and
  raises; pass the axis.

## Errors
- `ValueError: rectangle sides must be positive`.
- `ValueError: Rectangle: fillet=11 is more than half the shorter side (10)` (also for chamfer).
- `ValueError: Rectangle: give fillet= or chamfer=, not both`.

## Example
```python
plate = Rectangle(80, 50, fillet=6)                      # area 3969.0973
block = Box(60, 40, 10)
pocket = Rectangle(30, 20, chamfer=2).on(block.faces().top()).extrude(-4)
corner = Rectangle(40, 20, fillet=4, align=Align.MIN)    # bbox (0, 0)..(40, 20)
turned = Rectangle(40, 20, rotation=30)                  # bbox ±22.32 x ±18.66
```

## Related
`Slot`, `Polygon`, `Triangle`, `fillet` and `chamfer` (chosen corners), `generic`, `Box`.
