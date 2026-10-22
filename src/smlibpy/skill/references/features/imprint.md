# imprint

Splits faces of a part where a tool crosses them, and adds or removes nothing: split lines for
drafts, patches for the loads and supports of a simulation, regions to color or select. The
volume stays.

## Signature
`part.imprint(tool) -> Part`

- `tool`: a `Part` (the faces are split where its surface crosses them), a sheet (`Shell`) or a
  face that crosses faces of the part, or a `Sketch` (or a planar face) lying on a face of the
  part, whose outline is cut into that face.

## Returns
A `Part` with more faces and the same volume (checked). The pieces of the part's faces that lie
inside a tool part, or inside the sketch's region, **descend from the tool**:
`part.imprint(tool).faces().derived_from(tool)` selects them (see `selection/history`). Pieces
cut by a sheet descend from the face they were cut from only: select them by geometry.

## Gotchas
- A tool that crosses no face of the part (beside it, or wholly inside) raises
  `ModelingError: imprint: the tool crosses no face of the part`.
- Keep a sketch's region within the face: where it reaches past the face's edges, the faces
  next to it can get split lines close to the edge.
- A fillet or chamfer across a split line removes it again; imprint after rounding.
- A tool whose surface runs along a face or an edge of the part (instead of crossing it) can
  make the kernel fail: move it a little.

## Example
```python
block = Box(40, 30, 10)
pad = Rectangle(12, 8).on(Plane.XY.offset(5))          # on the top face
marked = block.imprint(pad)
print(len(marked.faces()), round(marked.volume, 3))     # 7 12000.0
patch = marked.faces().derived_from(pad)
print([round(f.area, 3) for f in patch])                # [96.0]

ring = block.imprint(Circle(6).on(Plane.XY.offset(5)))  # a single circle works too
print(sorted(round(f.area, 3) for f in ring.faces().top()))  # [113.097, 1086.903]

pin = Cylinder(4, 60).rotate(Y, 90)                     # a tool through the part
print([round(f.area, 3) for f in block.imprint(pin).faces().derived_from(pin)])  # [50.265, 50.265]
# (pass the same pin: Cylinder(4, 60).rotate(Y, 90) made again is another body, with marks of its own)
```

## Related
`split` (cut the part in two), `selection/history` (`derived_from`, `new`), `draft`.
