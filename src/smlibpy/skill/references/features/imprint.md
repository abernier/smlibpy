# imprint

Splits faces of a part where a tool crosses them, and adds or removes nothing: split lines for
drafts, patches for the loads and supports of a simulation, regions of a face of their own to
color, draft or select (a label area, a parting line, a seal track). The volume stays.

## Signature
`part.imprint(tool, direction=None, *, nearest=True) -> Part`

- `tool`: a `Part` (the faces are split where its surface crosses them), a sheet (`Shell`) or a
  face that crosses faces of the part, or a `Sketch` (or a planar face) lying on a face of the
  part, whose outline is cut into that face. Or curves: edges or wires, or a list of them.
- `direction` (curves only): an axis or a vector. The curves move along it onto the part, and
  split the faces where they cross them as they move (an outline projected onto the part). Only
  ahead of the curves: a part behind them is not reached. Without a direction the curves must lie
  on the part's faces already (`intersection_curves`, `project`; to 1e-5 of the size).
- `nearest`: with a direction, split only the faces the curves meet first: the side of the part
  facing them (default). `False` splits every face they cross, also on the far side (a box's
  top and bottom face, and the side faces they run along).

## Returns
A `Part` with more faces and the same volume (checked). The pieces of the part's faces that lie
inside a tool part, or inside the sketch's region, **descend from the tool**:
`part.imprint(tool).faces().derived_from(tool)` selects them (see `selection/history`). Pieces
cut by a sheet or by curves descend from the face they were cut from only: select them by
geometry. Each closed curve on a face gives a face inside it; a curve from border to border
splits the face in two. A curve across the seam of a closed face (a cylinder's) gives a face on
each side of the seam.

## Measured
- `Box(20, 20, 10)`, `Circle(4)` above, along -Z: 7 faces, the disk 50.26542 (16π = 50.26548;
  its edge within 5e-6 of the circle, where `project()` is 3.5e-4 off); with `nearest=False` 8
  faces (the bottom too). Volume 4000 in both.
- `Cylinder(10, 40)`, a circle r 4 at x = 50 along -X: the patch on the near side, 51.3366, in two
  faces (the seam runs through it); `nearest=False`: the far side too, 6 faces.
- A box with rounded vertical edges: 10 -> 11 faces, volume unchanged.

## Gotchas
- A tool that crosses no face of the part (beside it, or wholly inside) raises
  `ModelingError: imprint: the tool crosses no face of the part`.
- Keep a sketch's region within the face: where it reaches past the face's edges, the faces
  next to it can get split lines close to the edge.
- A fillet or chamfer across a split line removes it again; imprint after rounding.
- A tool whose surface runs along a face or an edge of the part (instead of crossing it) can
  make the kernel fail: move it a little.

## Errors
- `ModelingError: imprint: the curves, moved along the direction, miss the part`: also when the
  part lies behind the curves (point the direction at the part).
- `ValueError: imprint: the curves must lie on the faces (within 0.00062); move them onto them
  with project()`: no direction, and the curves are off the part.
- `ModelingError: imprint: the curves split no face: each must run across a face from border to
  border, or close a loop on it`.
- `ValueError: imprint: the direction must not be zero`; `TypeError: imprint: direction= moves
  curves onto the part; ...` for a direction with a part, sheet, face or sketch.

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

plate = Box(60, 40, 10)                                 # curves, moved onto the part along -Z
label = plate.imprint(Rectangle(30, 10).edges().translate(0, 0, 20), (0, 0, -1))
print(len(plate.faces()), len(label.faces()), label.volume == plate.volume)   # 6 7 True
area = label.faces().filter(lambda f: f.center().z > 4.9).sort_by(lambda f: f.area).first
print(round(area.area, 6))                              # 300.0: the label area, a face of its own
through = plate.imprint(Circle(5).edges().translate(0, 0, 20), (0, 0, -1), nearest=False)
print(len(through.faces()))                             # 8: top and bottom split

pipe = Cylinder(10, 40)
loop = CenterArc((50, 0, 0), 4, 0, 360).rotate(Axis((50, 0, 0), (0, 1, 0)), 90)   # facing the pipe
print(len(pipe.imprint(loop, (-1, 0, 0)).faces()))      # 5: the patch, in two faces across the seam
```

## Related
`split` (cut the part in two), `Shell.trim` and `Face.split` (sheets), `project`,
`intersection_curves`, `selection/history` (`derived_from`, `new`), `draft`.
