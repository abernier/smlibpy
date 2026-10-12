# Locations

A list of placements. Multiply it with a shape to get one copy per placement.
`GridLocations`, `PolarLocations` and `HexLocations` return `Locations` too.

## Signature
`Locations(*items)`. Each item may be a point (tuple of 2 or 3 numbers, list, `Vector`), a
`Location` (`Pos`, `Rot`, ...), a `Plane`, a `Face` or a `ShapeList` of faces (their face
planes: position **and** orientation), a `Vertex`, or another `Locations` (flattened).

## Returns / members
A `list` subclass of `Location`s: `len`, indexing, iteration all work. `points` gives the
positions as Vectors. Repr: `Locations(3 locations)`.

## Multiplication
| Expression | Result |
|---|---|
| `locs * shape` | `ShapeList` of copies (`locs[i] * shape`) |
| `locs * [a, b]` | `ShapeList` of every location × every shape |
| `locs * Pos(...)` / `locs * Rot(...)` | `Locations`: the extra move is applied in each copy's local frame |
| `locs * other_locs` | `Locations`, all combinations |
| `part - locs * tool`, `part + locs * tool` | cut or fuse all copies at once |
| `(locs * shape).on(face)`, `locs.on(face) * shape` | the copies placed onto a face |
| `Pos(...) * locs`, `plane * locs` | `Locations`, each placement moved |

## Gotchas
- A pattern goes onto a face either way: `(GridLocations(...) * Hole(2, 5)).on(face)` or
  `GridLocations(...).on(face) * Hole(2, 5)` (`locs.on(face)` returns `Locations`).
- A Location or Plane on the left keeps the chain:
  `Pos(0, 0, 10) * GridLocations(...) * Box(...)` moves every copy up by 10 (world frame),
  while `GridLocations(...) * Pos(0, 0, 10) * Box(...)` applies the Pos in each copy's frame.
  `Pos(...) * (locs * shape)` returns a `ShapeList`. Only a plain Python list stays a plain
  list.
- Faces in `Locations(face, ...)` give the face plane: a copy's +Z follows the face normal
  (studs on side faces stand out sideways).
- `part.vertices()` includes seam vertices of holes and cylinders; filter before using them
  as positions.
- `Locations()` is empty; `part - (Locations() * tool)` leaves the part unchanged.

## Example
```python
plate = Box(60, 40, 5)
spots = Locations((-20, 0), (0, 0), (20, 0))          # points, Vectors, Pos, planes, faces, vertices
plate -= spots * Cylinder(2, 10)                      # a ShapeList, cut all at once
print(len(spots), spots.points, len(plate.faces()))

corners = Box(60, 40, 5).vertices().top()           # vertices -> positions
pegs = Locations(*corners) * Sphere(1)               # one copy per top corner
print(len(pegs))                                     # 4 (plate.vertices() would add hole seams)

block = Box(30, 20, 10)
sides = Locations(block.faces().filter_by(lambda f: abs(f.normal_at().z) < 1e-9))
studs = sides * Cylinder(2, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
print([tuple(round(c) for c in s.center()) for s in studs])   # one stud standing out of each side

for loc in GridLocations(10, 10, 2, 1):               # iterate: each item is a Location
    print(loc.position)
marks = (spots * Circle(1)).on(block.faces().top())   # pattern first, then onto the face
print([m.center().z for m in marks])
```

## Related
`GridLocations`, `PolarLocations`, `HexLocations`, `Location`, `on`.
