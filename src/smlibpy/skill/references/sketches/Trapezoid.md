# Trapezoid

A trapezoid with its base on the bottom, centered on the origin.

## Signature
`Trapezoid(width, height, left_angle, right_angle=None, *, align=Align.CENTER)`
- `width`: length of the base (bottom side, at y = -height/2).
- `height`: distance from base to top (top side at y = +height/2).
- `left_angle`, `right_angle`: interior angles at the base corners in degrees.
  `right_angle=None` uses `left_angle` (symmetric).

## Returns
A `Sketch` with 4 line edges. The base runs from x = -width/2 to +width/2; the top is
`width - height/tan(left) - height/tan(right)` long.
- Angles below 90: the top is shorter. 90: that side is vertical. Above 90: the side leans
  outwards (dovetail); the bbox is then wider than `width`.
- `(120, 60)`: a parallelogram.

## Gotchas
- Default `align` centers the base and the height, not the bbox. `align=(Align.CENTER, Align.MIN)`
  stands it on the X axis.
- Angle 180 gives a degenerate sketch (area 0, bbox ±1e17) without an error. A negative
  angle `a` acts as `180 + a`; a negative height turns it upside down.
- A triangle (the sides meeting exactly at the top) is rejected; use `Polygon`.

## Errors
- `ValueError: the sides cross below the given height`: the top length would be zero or less.
- `ZeroDivisionError`: an angle of 0.
- `KernelError: sketch failed (SM_ERR)`: height 0.

## Example
```python
t = Trapezoid(40, 15, 60)                       # top 22.68 long, area 470.1
dovetail = Trapezoid(40, 15, 120)               # top 57.32 long
ramp = Trapezoid(40, 15, 60, 90, align=(Align.CENTER, Align.MIN))   # right side vertical, base on y = 0
rail = ramp.on(Plane.XZ).extrude(100)           # base on z = 0, 100 long toward -Y
```

## Related
`Polygon`, `Rectangle`, `generic`.
