# ShapeList.translate, rotate, moved, on, copy, append, extend

Move many shapes at once, and use a ShapeList as an ordinary list.

## Signature
- `sl.translate(x=0, y=0, z=0)` or `sl.translate((x, y, z))`
- `sl.rotate(axis=Z, angle=0)`: degrees about an Axis through its origin. The default angle 0
  returns unmoved copies.
- `sl.moved(location)`: e.g. `sl.moved(Pos(0, 0, 10))`
- `sl.on(plane_or_face)`: every shape, drawn around the world XY origin, placed onto the plane or
  face (see `Shape.on`).
- List methods: `append`, `extend`, `insert`, `remove`, `pop`, `index`, `count` work in place.

## Returns
Each transform returns a new ShapeList of moved copies; the input is unchanged.

## Gotchas
- `Pos(...) * sl`, `Rot(...) * sl` and `Plane * sl` return a ShapeList of moved copies, as
  `sl.moved(...)` does. A plain Python list stays a plain list: `Pos(...) * [a, b]`.
- `sl.copy()` returns a plain `list`. Shapes are immutable, so a copy is rarely needed:
  `ShapeList(sl)` when you want one.
- `sl + [x]` is a ShapeList, `[x] + sl` a plain list.
- There is no `scale` or `mirror` on a ShapeList: `ShapeList(s.mirror() for s in sl)`.
- A moved face becomes a face of a new Shell, a moved edge a free edge: they are no longer part
  of the body. `part.fillet(part.edges().top().translate(0, 0, 5), 1)` raises
  `ValueError: Edge(...) is not an edge of this part`.
- Location patterns (`GridLocations(...) * part`, `PolarLocations(...) * part`) already return
  a ShapeList.
- A list of parts can be subtracted or fused directly: `plate - holes`.

## Example
```python
plate = Box(60, 40, 10)
pins = ShapeList([Cylinder(3, 20), Cylinder(3, 20).translate(20, 0, 0)])
moved = pins.translate(-10, 0, 0)                      # new ShapeList of moved copies
print([round(p.center().x, 3) for p in moved])         # [-10.0, 10.0]
print(type(pins.rotate(Z, 90)).__name__)               # ShapeList
plate -= moved                                         # a list on the right of - is fine
print(len(plate.faces().cylinders()))                  # 2
marks = ShapeList([Circle(2), Circle(2).translate(10, 0, 0)]).on(plate.faces().top())
print([round(m.center().z, 3) for m in marks])         # [5.0, 5.0]
print(type(Pos(1, 0, 0) * pins).__name__, type(pins.copy()).__name__)   # ShapeList list
```

## Related
`generic`, `Location`, `Pos`, `Rot`, `GridLocations`, `PolarLocations` (geometry domain).
