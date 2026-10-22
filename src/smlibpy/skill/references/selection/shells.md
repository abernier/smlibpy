# shells, voids, cells of faces, shared: the cavities and inner faces of a part

The closed sheets around a part, its cavities, and which cells a face bounds: to select the faces
of an inner cavity (wall thickness, a boundary condition), count cavities, or find the faces where
two materials of a merged part meet.

## Signature
- `part.shells() -> ShapeList[Shell]`: each closed sheet that bounds the part, as a Shell of
  copies of its faces; first the outside of each solid, then the wall of each cavity (and the
  outside of a body floating in one).
- `part.voids() -> ShapeList[Part]`: each cavity as a part (the space inside its wall, less a body
  floating in it). `part.volume + sum(v.volume for v in part.voids())` is the volume inside the
  outside.
- `face.cells -> tuple[int, ...]`: indices into `part.cells()` of the cells the face bounds: one
  for a face on the outside or on a cavity wall, two for a face between two cells of a merged part,
  `()` for a sheet's face. smlibwasm: an array.
- `shapelist.shared() -> ShapeList[Face]`: the faces between two cells (faces only: `TypeError`
  for edges).
- `part.info()` also has `"solids"` (as `len(part.solids())`) and `"voids"` (how many cavities).

## Example
```python
hollow = Box(20, 20, 20) - Box(6, 6, 6)
print(hollow.info()["solids"], hollow.info()["voids"])          # 1 1
outside, cavity = hollow.shells()
walls = hollow.faces().derived_from(cavity)                     # the cavity's 6 faces, on the part
print(len(walls), round(hollow.voids()[0].volume, 6))           # 6 216.0
print(len(cavity.faces()), len(cavity.edges()))                 # 6 12: a closed sheet

block = merge(Box(40, 40, 20), Cylinder(6, 30))
print(sorted(f.cells for f in block.faces().shared()))         # [(0, 1), (1, 2), (1, 3)]
```

## Gotchas
- The shells are copies: select on the part with `part.faces().derived_from(shell)` (the copies
  carry the marks of the part's faces, see `history`); faces and edges of a shell passed to an
  operation of the part stand for the part's own (as faces of an earlier version do).
- Faces between two cells of a merged part lie in no shell (they bound no space outside the part).
- A body floating in a cavity is a solid of its own (`solids()`), and its outside is one of the
  shells after the cavity wall.

## Related
`features/cells`, `features/merge`, `selection/history`, `analysis/distance_to`.
