# move_faces

Moves faces of a part and extends or trims the faces around them to meet them again: push or pull
a face, move a hole, a boss or a pocket, tilt a wall. Direct editing: works on imported parts,
which have no history.

## Signature
`part.move_faces(faces, by)`

- `faces`: faces of this part: a selection, one `Face` or a list. Faces of an earlier version of
  the part are matched by position and area.
- `by`: a vector (`(0, 0, 5)`) or a `Location` (a rotation and a translation: it turns the faces
  too, e.g. `Location.about(Axis(origin, direction), degrees)` about any axis). A scaling or
  mirroring matrix raises `ValueError`.

## Returns
A new `Part` with as many faces as before. Exact: the moved faces keep their surfaces (moved), the
faces around them are extended or trimmed, planes stay planes, cylinders and cones stay
cylinders and cones, and the edges where a plane meets a cylinder, cone or sphere stay circles.
`Box(40, 30, 10) - Cylinder(3, 20)`: top moved up 5 gives 17575.885 (15 high, the hole goes
along); the hole moved (8, 0, 0) keeps 11717.2567 with its circles centred at x = 8. A wall leaned
in by 10 degrees about its bottom edge: `Box(20, 20, 10)`, right face,
`Location.about(Axis((10, 0, -5), (0, -1, 0)), 10)`: 3823.673 = 4000 - 10 * 10 * tan(10) / 2 * 20.
A zero move returns an equal copy.

## Rules
- A face that meets a moved face tangentially (a round, the other half of a slot, the faces of a
  fillet chain) must be moved with it; select it too. `offset_faces` takes such faces along on
  its own.
- A face moved along itself does not change (a plane within its plane, a cylinder along its
  axis): what changes is decided by the faces around it.
- The faces around the moved ones must reach them: the kernel extends and trims them but does not
  add or remove faces. Moving a face past another one, or so far that a face around it vanishes,
  raises `ModelingError`; use a Boolean there.
- A part with cavities (closed voids) is edited as its outside and its cavities apart (the
  kernel's face edit drops cavities), and the cavities are cut out again: faces of the outside and
  of a cavity's wall can be moved, also together. A move that makes a cavity reach the outside or
  another cavity raises `ModelingError`; so does a part with a body inside a cavity (edit
  `part.solids()` one by one).
- Faces around the moved ones that the kernel extends keep their cylinder or cone (a vertical
  round of a box whose top is pulled up; the kernel gives them surfaces of extrusion and
  B-splines, which smlibpy puts back where they still lie on it); other kinds can change (a
  sphere or torus extended becomes a B-spline face within about 1e-7 of the size).

## Errors
- `ModelingError: move_faces: the plane face at (0, -3, 0) meets the moved cylinder face at (-6.91, 0, 0) tangentially, so it must be moved with it (the kernel keeps tangent faces together); add it to the faces`
- `ModelingError: move_faces: the moved faces do not close the part again: a face around them vanishes, or moved faces run into each other; use a smaller change`
- `ModelingError: move_faces: the moved faces change which faces of the part meet (a face vanishes, or moved faces run into other faces); use a smaller change, or a Boolean`
- `ModelingError: move_faces: the moved faces reach a cavity of the part (or a cavity reaches the outside or another cavity); use a smaller change, or a Boolean`
- `ModelingError: move_faces: the part has a body inside a cavity (a closed void inside it), and the kernel's face edit drops cavities; edit the parts one by one (part.solids()) and combine them afterwards`
- `TypeError: move_faces: by must be a Location or a vector, not str`; `ValueError: move_faces: no faces selected`

## Example
```python
block = Box(40, 30, 10) - Cylinder(3, 20)
taller = block.move_faces(block.faces().top(), (0, 0, 5))
print(round(taller.volume, 3), round(taller.bbox().size.z, 6))   # 17575.885 15.0
moved = block.move_faces(block.faces().cylinders(), (8, 0, 0))
print([e.arc_center.x for e in moved.edges().circles()])       # [8.0, 8.0]

# a slot: its walls and ends meet tangentially, so they move together
plate = Box(40, 20, 10) - Slot(16, 6).extrude(20).translate(0, 0, -10)
slot = plate.faces().filter(lambda f: abs(f.normal_at(f.interior_point()).z) < 0.5 and abs(f.center().x) < 12 and abs(f.center().y) < 5)
shifted = plate.move_faces(slot, (5, 0, 0))

# lean a wall in by 10 degrees about its bottom edge
wall = Box(20, 20, 10)
right = wall.faces().filter(lambda f: f.center().x > 9)
leaning = wall.move_faces(right, Location.about(Axis((10, 0, -5), (0, -1, 0)), 10))
print(round(leaning.volume, 3))                                # 3823.673
```

## Related
`offset_faces` (move faces along their normals, with tangent chains), `draft` (tilt faces about
a neutral plane for molding), `remove_faces` (take a feature out), `shell` (`walls=`).
