# imprint

Splits the faces of a part along curves without changing its shape: a region of a face gets a
face of its own, to color, draft or select (a label area, a parting line, a seal track).

## Signature
`part.imprint(tool, direction=None, *, nearest=True)`

- `tool`: the curves: edges or wires, or a list of them.
- `direction`: an axis or a vector. The curves move along it onto the part, and split the faces
  where they cross them as they move (an outline projected onto the part). Only ahead of the
  curves: a part behind them is not reached. Without a direction the curves must lie on the
  part's faces already (`intersection_curves`, `project`; to 1e-5 of the size).
- `nearest`: with a direction, split only the faces the curves meet first: the side of the part
  facing them (default). `False` splits every face they cross, also on the far side (a box's
  top and bottom face, and the side faces they run along).

## Returns
A new `Part`, valid, of the same volume, with more faces. Each closed curve on a face gives a
face inside it; a curve from border to border splits the face in two. A curve across the seam
of a closed face (a cylinder's) gives a face on each side of the seam.

## Measured
- `Box(20, 20, 10)`, `Circle(4)` above, along -Z: 7 faces, the disk 50.26542 (16π = 50.26548;
  its edge within 5e-6 of the circle, where `project()` is 3.5e-4 off); with `nearest=False` 8
  faces (the bottom too). Volume 4000 in both.
- `Cylinder(10, 40)`, a circle r 4 at x = 50 along -X: the patch on the near side, 51.3366, in two
  faces (the seam runs through it); `nearest=False`: the far side too, 6 faces.
- A box with rounded vertical edges: 10 -> 11 faces, volume unchanged.

## Errors
- `ModelingError: imprint: the curves, moved along the direction, miss the part`: also when the
  part lies behind the curves (point the direction at the part).
- `ValueError: imprint: the curves must lie on the faces (within 0.00062); move them onto them
  with project()`: no direction, and the curves are off the part.
- `ModelingError: imprint: the curves split no face: each must run across a face from border to
  border, or close a loop on it`.
- `ValueError: imprint: the direction must not be zero`; `TypeError: imprint takes curves (edges
  or wires), not a Part`.

## Example
```python
plate = Box(60, 40, 10)
label = plate.imprint(Rectangle(30, 10).edges().translate(0, 0, 20), (0, 0, -1))
print(len(plate.faces()), len(label.faces()), label.volume == plate.volume)   # 6 7 True
area = label.faces().filter(lambda f: f.center().z > 4.9).sort_by(lambda f: f.area).first
print(round(area.area, 6))                                 # 300.0: the label area, a face of its own
through = plate.imprint(Circle(5).edges().translate(0, 0, 20), (0, 0, -1), nearest=False)
print(len(through.faces()))                                # 8: top and bottom split

pipe = Cylinder(10, 40)
ring = CenterArc((50, 0, 0), 4, 0, 360).rotate(Axis((50, 0, 0), (0, 1, 0)), 90)   # facing the pipe
marked = pipe.imprint(ring, (-1, 0, 0))
print(len(marked.faces()))                                 # 5: the patch, in two faces across the seam
```

## Related
`Shell.trim` and `Face.split` (sheets), `split` (cut a part in two), `project`,
`intersection_curves`, `draft`
