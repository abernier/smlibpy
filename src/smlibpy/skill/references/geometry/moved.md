# moved

A copy of a shape moved by a `Location` (rotation and translation in one step).

## Signature
`shape.moved(location)`; also on `ShapeList`. `location` must be a `Location`
(`Pos(...)`, `Rot(...)`, `Location(...)`, `plane.location`).

## Returns
A new shape of the same type. `shape.moved(loc)` is the same as `loc * shape`.

## Relative, not absolute
Shapes have no stored placement (`part.location` does not exist). `moved` always applies the
location on top of where the shape is now:
- `moved(Pos(1, 0, 0)).moved(Pos(1, 0, 0))` moves by 2.
- `moved(A).moved(B)` equals `moved(B * A)`, not `moved(A * B)`.
- `moved(Rot(z=90))` turns about the world origin, like `rotate(Z, 90)`.

For an absolute placement, first bring the shape's reference point to the origin:
`part.moved(Pos(-part.center())).moved(target)`. Or build parts at the origin and place them
once.

## moved vs translate / rotate / on
| Want | Use |
|---|---|
| shift by a vector | `translate(x, y, z)` or `Pos(...) * shape` |
| turn about any axis | `rotate(axis, angle)` |
| rotate and shift, one object | `moved(Pos(...) * Rot(...))` |
| put a shape drawn on XY onto a plane or face | `on(target)` (same as `moved(plane.location)`) |

## Gotchas
- `moved(Plane.XZ)` or `moved((1, 2, 3))` raise `AttributeError: ... has no attribute
  'matrix'`; pass `plane.location` / `Pos(...)`, or use `on(plane)`.
- The order of a chain matters: read `Pos(...) * Rot(...)` from right to left (rotate, then
  move).

## Example
```python
arm = Box(4, 2, 2).translate(10, 0, 0)
place = Pos(0, 0, 5) * Rot(z=90)
print(arm.moved(place).center(), (place * arm).center())   # same: Vector(0, 10, 5)
print(arm.moved(Pos(1, 0, 0)).moved(Pos(1, 0, 0)).center())   # relative: Vector(12, 0, 0)

c = arm.center()
at_target = arm.moved(Pos(-c)).moved(Pos(0, 50, 0))   # "absolute": center to (0, 50, 0)
print(at_target.center())

A, B = Pos(10, 0, 0), Rot(z=90)
print(arm.moved(A).moved(B).center(), arm.moved(B * A).center())   # equal
```

## Related
`Location`, `Pos`, `Rot`, `translate`, `rotate`, `on`.
