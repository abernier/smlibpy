# merge_faces

Make two faces of a sheet one: one surface over both, where they share a whole side. The pieces of
a sheet split along a curve of its surface come back as the one face they were (the same control
points, in another parameter order); patches built through the same curves become one B-spline
face. Fewer faces give cleaner STEP files, meshes, fillets and `match_edge`.

## Signature
`sheet.merge_faces(a, b)`
`merge_faces(sheet, a, b)`: the same, as a function

- `a`, `b`: two faces of the sheet, each bounded by the four sides of its surface (no holes, no
  trimmed borders, no seam), sharing one whole side (and no other).

## Returns
A new `Shell` with one face less (a Sketch's comes back as a Shell). The merged face lies on one
surface: the two joined across the shared side, the knot at the joint taken out where they meet
smoothly enough (within the sheet's tolerance). Its normal is `a`'s. The sheet's other faces are
sewn to it again, its border unchanged. About 2 ms for two bicubic faces.

The joined surface is checked against both faces (81 points each): where it misses them by more
than ten times the sheet's tolerance, the faces are not merged. That happens when their
parameters run at different speeds along the shared side (the joint keeps one face's speed and
moves the other's points: 0.08 off in the test). Faces whose normals point to opposite sides are
not merged either.

The kernel's own `SmBSplineSurface::JoinSurface` makes its inputs compatible in place on a stack
it frees on return and never checks that the boundaries meet (the wrong direction flag gives a
surface 3 mm off and success): here the same NLib steps run on copies, and the result is measured.

## Errors
- `ValueError: merge_faces: the faces share no edge`, `... share edges on more than one side`,
  `... share only a part of a side; they must meet along a whole side of each`.
- `ValueError: merge_faces: the surfaces do not join into one (the joined surface misses them by
  0.0792): their parameters along the shared side differ; merge faces split from one surface or
  built through the same curves`.
- `ValueError: merge_faces: the faces' normals point to opposite sides; turn one of them over first`.
- `ValueError: merge_faces: only faces bounded by the four sides of their surface (no hole, no
  trimmed border, no seam, no pole) can be merged (a face has a hole)`.
- `ValueError: merge_faces: a and b are the same face`, `... is not a face of this shell`.

## Example
```python
panel = surface([[(x, y, 2 * math.sin(x / 10)) for y in range(0, 25, 5)] for x in range(0, 35, 5)])
halves = panel.trim(panel.intersection_curves(Plane((15, 0, 0), (0, 1, 0), (1, 0, 0))), "split")
print(len(halves.faces()))                          # 2
one = halves.merge_faces(*halves.faces())
print(len(one.faces()), round(one.area, 6))         # 1 605.679201 (the panel's area)

plates = stitch(Rectangle(10, 10).translate((-5, 0, 0)).faces()[0], Rectangle(10, 10).translate((5, 0, 0)).faces()[0])
print(round(plates.merge_faces(*plates.faces()).area, 9))   # 200.0: one face 20 x 10
```

## Related
`match_edge`, `stitch`, `Shell.trim` (split a sheet), `Face.split`, `nurbs_surface`, `generic`
