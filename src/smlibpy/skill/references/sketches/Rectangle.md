# Rectangle

A `width` by `height` rectangle on the XY plane, centered on the origin.

## Signature
`Rectangle(width, height, *, align=Align.CENTER)`
`width` runs along X, `height` along Y. There is no `rotation` parameter.

## Returns
A `Sketch` with 1 face and 4 line edges; bbox `-width/2..width/2` by `-height/2..height/2`, normal +Z.

## align
One value for both axes or one per axis (`Align`, `"min"`/`"center"`/`"max"`, or `None`):
- `Align.MIN`: lower left corner on the origin (0..w, 0..h).
- `Align.MAX`: upper right corner on the origin (-w..0, -h..0).
- `(Align.MIN, Align.CENTER)`: x 0..w, y centered. `None` for an axis leaves it centered.
- A third value is ignored.

## Gotchas
- To turn it, rotate the result: `Rectangle(40, 20).rotate(Z, 30)` or `Rot(z=30) * Rectangle(40, 20)`.
  `align` is applied before you rotate.
- `align` also moves `sketch.plane.origin` (to the rectangle's center). `revolve()` without
  an axis turns about the local Y axis through that origin, which crosses the rectangle and
  raises; pass the axis.

## Errors
- `ValueError: rectangle sides must be positive`: a side is zero or negative.
- `TypeError: Rectangle() got an unexpected keyword argument 'rotation'`.

## Example
```python
plate = Box(60, 40, 10)
pocket = Rectangle(30, 20).on(plate.faces().top()).extrude(-4)
plate = plate - pocket                                   # volume 24000 - 2400
corner = Rectangle(40, 20, align=Align.MIN)              # bbox (0, 0)..(40, 20)
turned = Rectangle(40, 20).rotate(Z, 30)                 # bbox ±22.32 x ±18.66
```

## Related
`RoundedRectangle`, `Polygon`, `generic` (Booleans, placing), `Box`.
