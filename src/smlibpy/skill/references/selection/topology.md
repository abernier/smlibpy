# Topology: faces(), edges(), vertices(), wires(), solids()

Going from a body down to its faces, edges and vertices, and across between them.

## Signatures
- `body.faces()`, `body.vertices()`, `body.wires()` on Part, Shell, Sketch.
- `body.edges(seams=False)`: seam edges (where a closed surface meets itself) only with `seams=True`.
- `part.solids()`: the separate volumes of a Part as a ShapeList of Parts. Sketch and Shell have none.
- `face.edges(seams=False)`, `face.vertices()`, `face.wires()`, `face.outer_wire()`,
  `face.inner_wires()`, `face.neighbors()`, `face.owner`.
- `edge.faces()`, `edge.vertices()`; `vertex.edges()`, `vertex.faces()`.
- `wire.edges()`, `wire.vertices()`. `shapelist.faces()/.edges()/.vertices()/.wires()`.

## Returns
ShapeLists, except `outer_wire()` (a `Wire`) and `owner` (the Part, Shell or Sketch).

| Body | faces | edges | edges(seams=True) | vertices | wires |
|---|---|---|---|---|---|
| `Box` | 6 | 12 | 12 | 8 | 6 |
| `Cylinder` | 3 | 2 | 3 | 2 | 3 |
| `Cone(r1, r2, h)` | 3 | 2 | 3 | 2 | 3 |
| `Cone(r, 0, h)` (tip) | 2 | 1 | 2 | 2 | 2 |
| `Sphere` | 1 | 0 | 1 | 2 | 1 |
| `Torus` | 1 | 0 | 2 | 1 | 1 |
| `Wedge(l, w, h)` | 5 | 9 | 9 | 6 | 5 |
| `Box - Cylinder` (through hole) | 7 | 14 | 15 | 10 | 9 |
| `Box - Cylinder` (blind hole) | 8 | 14 | 15 | 10 | 9 |
| `Box` with all 12 edges filleted | 26 | 48 | 48 | 24 | 26 |
| `Rectangle` | 1 | 4 | 4 | 4 | 1 |
| `Circle` | 1 | 1 | 1 | 1 | 1 |
| `Circle(10) - Circle(5)` | 1 | 2 | 2 | 2 | 2 |
| `ruled(Line, Line)` (a Shell) | 1 | 4 | 4 | 4 | 1 |

A through hole adds 1 face; each filleted edge adds 1 face; a sphere and a torus have no edges.

## Faces
- `outer_wire()` is the outer boundary, closed, running counter-clockwise seen from outside the
  body. `inner_wires()` are the holes, running the other way; empty for a face without holes.
- A cylinder face's single wire contains the seam twice (circle, seam, circle, seam);
  `inner_wires()` is empty.
- `neighbors()`: faces sharing an edge (the top face of a box with a hole: 4 walls + the hole).
- `owner` is the body the face came from. Faces of `part.solids()[i]` belong to that new Part,
  not to `part`.
- `wires()` of a body or a ShapeList lists every face's loops; it does not remove duplicates.

## Edges
- `edge.faces()`: 2 faces for an edge inside a solid, 1 for a seam or a sheet border, none for a
  free edge (`Line(...)`) or a moved copy.
- `edge.vertices()`: start and end; one vertex for a closed circle.

## Gotchas
- `edges()` leaves out seams. Seams are not real edges: do not fillet them. `is_seam` tells.
- `part.solids()` makes new Parts: their faces are not faces of `part`. Select on the part you
  pass to the feature.
- Edges of `face.outer_wire()` are the part's own edges and can be passed to `part.fillet`.
- A Boolean can split one surface into several faces: `Cylinder & Box` with the box on the +X
  side gave 2 cylinder faces (the seam lies at +X). Count faces before using `.one()`.
- An intersection curve can come as several edges: a plane cut through a cylinder gave the
  ellipse as 2 edges.
- `Vertex(x, y, z)`, free `Line`s and moved copies have no faces or edges around them.

## Example
```python
part = Box(40, 30, 20) - Cylinder(6, 30)
print(len(part.faces()), len(part.edges()), len(part.vertices()))   # 7 14 10

top = part.faces().top().one()
print(top.outer_wire())                  # Wire(4 edges, closed, length=140)
print(top.inner_wires())                 # [Wire(1 edges, closed, length=37.6991)]
print(len(top.edges()), len(top.neighbors()))   # 5 5

e = part.edges().parallel_to(Z).first
print(len(e.faces()), e.vertices())      # 2 [Vertex(20, 15, -10), Vertex(20, 15, 10)]

two = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
print(len(two.solids()))                 # 2
```

## Related
`generic`, `Face`, `Edge`, `Vertex`, `Wire` (curves domain).
