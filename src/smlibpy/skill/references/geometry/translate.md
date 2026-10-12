# translate

A copy of a shape moved by a vector. Works on every shape type and on `ShapeList`.

## Signature
`shape.translate(x=0, y=0, z=0)` or `shape.translate(vector)` where `vector` is a tuple
(2 or 3 numbers), list, numpy array or `Vector`.

## Returns
A new shape of the same type (Part, Sketch, Shell, Face, Wire, Edge, Vertex). Name and color
are kept; the topology is unchanged. `ShapeList.translate(...)` returns a ShapeList of moved
copies.

## Behavior
- Same as `Pos(x, y, z) * shape` and `shape.moved(Pos(x, y, z))`.
- A sketch moves together with its plane: `Rectangle(30, 20).translate(0, 0, 40)` has its
  plane at z = 40, so `extrude(3)` gives z 40..43.
- Patterns are ShapeLists: `(GridLocations(...) * Box(...)).translate(0, 0, 20)` moves all
  copies.

## Gotchas
- With a tuple as the first argument, `y` and `z` are ignored: `translate((1, 2, 3), 5)`
  moves by (1, 2, 3).
- A plain Python list of shapes has no `translate`; use `ShapeList(items)` or a list
  comprehension.
- Select faces and edges after you move a part. Parts match a selection by geometry, so
  `moved_part.fillet(old_part.edges()..., 1)` raises
  `ValueError: Edge(line, ...) is not an edge of this part`. The same holds for an edge or
  face that you translated yourself.
- Translation does not snap: compare positions with a tolerance.

## Example
```python
peg = Cylinder(3, 10)
a = peg.translate(10, 0, 5)
b = peg.translate((10, 0, 5))         # tuple, list, numpy array or Vector
c = peg.translate(z=5)                # keywords; missing ones are 0
print(a.center(), c.center())

slot = Rectangle(20, 6).translate(0, 12)          # sketches keep their plane, moved
print(slot.plane.origin)
lid = Rectangle(30, 20).translate(0, 0, 40).extrude(3)   # sketch lifted to z = 40, then extruded
print(lid.bbox().min.z, lid.bbox().max.z)         # 40.0 43.0

row = (GridLocations(10, 10, 3, 1) * Box(4, 4, 4)).translate(0, 0, 20)   # a ShapeList
print([s.center().z for s in row])
```

## Related
`Pos`, `moved`, `rotate`, `on`, `Align`.
