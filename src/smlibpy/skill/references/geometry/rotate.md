# rotate

A copy of a shape turned by an angle (degrees) about an axis. The axis can pass through any
point.

## Signature
`shape.rotate(axis=Z, angle=0.0)`. `axis` must be an `Axis` (`X`, `Y`, `Z`, `-Z`, or
`Axis(origin, direction)`). Also on `ShapeList`.

## Returns
A new shape of the same type. Same as `Location.about(axis, angle) * shape`;
`shape.rotate(Z, a)` equals `Rot(z=a) * shape`.

## Direction
Positive angles turn counterclockwise when you look from the positive end of the axis
toward its origin (right-hand rule):
- `rotate(Z, 90)`: +X goes to +Y. `rotate(Z, -90)` or `rotate(-Z, 90)`: +X goes to -Y.
- `rotate(X, 90)`: +Z goes to -Y (an upright post falls toward -Y).
- `rotate(Y, 90)`: +Z goes to +X.

## About which point
About the axis line. `X`, `Y`, `Z` pass through the world origin, so a part away from the
origin swings around it. To turn a part in place, rotate about an axis through its center:
`part.rotate(Axis(part.center(), (0, 0, 1)), 30)`.

## Gotchas
- The axis comes first. `part.rotate(45)` and `part.rotate(90, Z)` raise
  `AttributeError: 'int' object has no attribute 'direction'`.
- A direction tuple is not accepted: `part.rotate((0, 0, 1), 90)` raises
  `AttributeError: 'tuple' object has no attribute 'direction'`. Use `Axis((0, 0, 0), (0, 0, 1))`.
- `rotate(angle=45)` uses the default axis `Z`; `rotate()` alone does nothing (angle 0).
- A rotated sketch turns its plane too; `Rectangle(10, 2).rotate(X, 90)` has normal -Y and
  extrudes toward -Y.
- Angles above 360 wrap. Rotating 36 times by 10° returns to the start without visible
  drift (centers within 2e-7).

## Example
```python
bar = Box(10, 2, 2, align=(Align.MIN, Align.CENTER, Align.CENTER))   # x 0..10
print(bar.rotate(Z, 90).bbox())       # y 0..10: +X turns to +Y
print(bar.rotate(Z, -90).bbox())      # y -10..0
print(bar.rotate(Axis((10, 0, 0), (0, 0, 1)), 90).bbox())   # about x = 10: x 9..11, y -10..0

post = Box(2, 2, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))  # z 0..10
print(post.rotate(X, 90).bbox())      # lies along -Y
print(post.rotate(Y, 90).bbox())      # lies along +X

part = Box(20, 10, 5).translate(30, 0, 0)
spun = part.rotate(Axis(part.center(), (0, 0, 1)), 30)   # about its own vertical axis
print(spun.center())                  # still Vector(30, 0, 0)
```

## Related
`Rot`, `Axis`, `Location.about`, `moved`, `PolarLocations` (many rotated copies).
