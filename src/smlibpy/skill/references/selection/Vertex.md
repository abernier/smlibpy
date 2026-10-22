# Vertex

A point of a body (`part.vertices()`, `face.vertices()`, `edge.vertices()`), or a free point
made with `Vertex(x, y, z)`.

## Signature
`Vertex(x=0, y=0, z=0)`; also `Vertex((x, y, z))`, `Vertex(Vector)`; `Vertex(1, 2)` and
`Vertex((1, 2))` have z = 0.

## Properties and methods
- `point`: the position as a `Vector`; `x`, `y`, `z`: floats. A vertex unpacks like a tuple
  (`tuple(v)`) and is accepted wherever a point is: `Line(corner, Vertex(0, 0, 0))`.
- `center()` is the point; `bbox()` is a zero-size box.
- `edges()`, `faces()`: the edges and faces meeting at a vertex of a body (3 and 3 at a box
  corner); empty for a free vertex.
- `distance_to(point_or_shape)`.

## Equality
- Two vertices are `==` when they are at the same position within about 1e-6 (5e-7 apart: equal,
  2e-6: not), also a body vertex and a free vertex: `Vertex(5, 5, 5) in box.vertices()` is True.
- Their hashes differ, though: a set or dict can hold a body vertex and an equal free vertex as two
  entries. Compare with `==` or by coordinates.

## Vertices of common bodies
`Box`: the 8 corners. `Cylinder`: 2, where the seam meets the rims, (r, 0, ±h/2). (A tool whose
seam would run tangent to the other operand of a Boolean goes in turned about its axis: in the
result its seam, and these vertices, lie elsewhere.)
`Sphere`: the 2 poles. `Rectangle`: 4 corners. A closed circle edge has one vertex.

## Gotchas
- Vertices of curved bodies are where seams end, not meaningful corners: do not use
  `cylinder.vertices()` to find a center; use `face.axis` or `edge.arc_center`.
- A translated vertex is a free vertex (no edges, no faces).
- Positional selectors work on vertices: `box.vertices().top().right().back().one()` is the
  (+X, +Y, +Z) corner.
- `Sketch.fillet(radius, vertices)` takes vertices selected this way to round only some corners.

## Example
```python
box = Box(10, 10, 10)
corner = box.vertices().top().right().back().one()
print(corner, corner.x, corner.point)            # Vertex(5, 5, 5) 5.0 Vector(5, 5, 5)
print(corner == Vertex(5, 5, 5))                 # True: equal by position
print(len(corner.edges()), len(corner.faces()))  # 3 3
print(Line(corner, Vertex(0, 0, 0)).length)      # 8.660254037844387
sk = Rectangle(20, 10)
rounded = sk.fillet(2, sk.vertices().right())    # round only the two right corners
print(round(rounded.area, 4))                    # 198.2832
```

## Related
`topology`, `positional`, `extremes` (`at`), `Edge`, `Face`, `Vector` (geometry domain).
