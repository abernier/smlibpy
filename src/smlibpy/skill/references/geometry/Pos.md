# Pos

A pure translation, as a `Location`. `Pos(10, 0, 5) * shape` equals `shape.translate(10, 0, 5)`.

## Signature
`Pos(x=0, y=0, z=0)`, or `Pos((x, y, z))`, `Pos((x, y))`, `Pos(vector)`.
`Pos(10)` is `Pos(10, 0, 0)`; `Pos(z=5)` works with keywords.

## Returns
A `Location` with no rotation; it prints as `Pos(10, 0, 5)`.

## Usage
- `Pos(...) * shape`: moved copy of any shape (Part, Sketch, Face, Edge, Wire, Vertex).
- `Pos(...) * [a, b]`: list of moved copies; `Pos(...) * shapelist` a `ShapeList`,
  `Pos(...) * GridLocations(...)` a moved `Locations`.
- `Pos(...) * Rot(...) * shape`: turn the shape about the origin first, then move it there.
  This is the usual way to place a rotated copy.
- `Pos(...) * Vector` gives a moved point.
- On a sketch: `(Pos(10, 5) * Circle(3)).on(face)` puts the circle 10 along the face's
  x_dir and 5 along its y_dir from the face center.
- Inside a pattern: `GridLocations(...) * Pos(8) * Hole(3, 5)` offsets every copy by 8 along
  the pattern's X.

## Gotchas
- `Pos` takes coordinates, not a distance and a direction. For "5 along the normal" use
  `Pos(face.normal_at() * 5)` or `Plane.offset`.
- `Pos(0, 0, 10) * Rot(x=90) * shape` and `Rot(x=90) * Pos(0, 0, 10) * shape` differ: the
  second turns the offset too (it ends up at (0, -10, 0)).
- Centers of curved parts carry integration noise (`Vector(10, -1.1e-07, 5)`); compare
  with a tolerance.

## Errors
- `ValueError: expected 2 or 3 coordinates, got 1` for `Pos("a")` or a 1-element tuple.

## Example
```python
peg = Cylinder(3, 10)
a = Pos(10, 0, 5) * peg                  # same as peg.translate(10, 0, 5)
b = Pos((10, 0, 5)) * peg                # tuple or Vector
c = Pos(z=5) * peg                       # keywords
print(a.center(), b.center(), c.center())

dots = Pos(15, 0) * Circle(2)            # sketches too (z = 0)
arm = Pos(20, 0, 0) * Rot(z=30) * Box(10, 2, 2)   # rotated in place, then moved
print(dots.center(), arm.center())
print([p.center() for p in Pos(0, 0, 10) * [peg, Box(2, 2, 2)]])
```

## Related
`Rot`, `Location`, `translate`, `Locations`.
