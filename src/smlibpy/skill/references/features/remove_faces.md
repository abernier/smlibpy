# remove_faces

Cuts faces out of a part and closes the gap with the faces around it: fills holes and pockets,
takes bosses off. For simplifying parts (suppressing small features before simulation or
meshing) and for getting a base shape back from an imported part.

## Signature
`part.remove_faces(faces, *, partial=False)`
`remove_faces(part, faces, *, partial=False)` (the same, the part first)

- `faces`: faces of this part (a selection, one face), or of an earlier version of it (matched
  by position). Faces the selection encloses go with it: the floor of a blind hole with its
  wall, the top of a boss with its side. Not a face that the selection only rounds off: the top
  of a box with its rounded top edges selected stays (`remove_faces(faces().fillets())` gives the
  sharp box back, 4000.0 for `Box(20, 20, 10)` with r2 top rounds). Each connected set of faces
  is one feature. A selection of rounds only goes to `remove_fillets`.
- `partial`: keep the features the kernel cannot close and take out the others. Default: raise.

## Returns
A new `Part`; the input is unchanged. The gap is closed by extending the faces around it (the
kernel's feature executive); where that fails, by a flat cap across the opening. The patches
merge with the faces they extend, so a filled hole leaves no trace:

| Feature on `Box(40, 30, 20)` | Faces | Volume after |
|---|---|---|
| through hole r 5, two holes at once | 7 → 6, 8 → 6 | 24000.000000000 |
| blind hole (wall only selected) | 8 → 6 | 24000.000000000 |
| cylinder boss on top (side only selected) | 8 → 6 | 24000.000000000 |
| rectangular pocket (walls and floor), counterbore, countersink | 11/9/8 → 6 | 24000.000000000 |
| hole with a rounded rim (all its faces) | 8 → 6 | 24000.000000000 |

Each feature is checked: a valid solid, and a volume that went up for a depression (a hole or
pocket, whose rim edges are convex) and down for a protrusion (a boss, concave rim). Where the
rim says neither (tangent or mixed edges), the volume may change by no more than the faces span,
and the part's box may not shrink.

## Gotchas
- Select the whole feature. Faces enclosed by the selection are added, but a wall without the
  fillets around its rim leaves a gap the kernel cannot close: take the fillets out first
  (`remove_fillets`) or select them with the feature.
- Select faces with a box (`within`) rather than a height filter: `faces().filter(lambda f:
  f.bbox().min.z > 3.9)` also picks the top face of the part.
- On imported parts and after other defeaturing steps the kernel can fail on a feature (the
  example bracket read from STEP, after `remove_fillets(partial=True)`: 2 of its 4 hole features
  fail, while the same holes go from the STEP import directly: 19 → 13 faces). Where it crashes,
  it crashes in another process (see `remove_fillets`), and this process goes on. Try the other
  order (holes first, then fillets) and `partial=True`.

## Errors
- `ModelingError: remove_faces: that is every face of the part; nothing would be left`
- `ModelingError: remove_faces: the kernel could not close the gap at (44.92, 10, 4) (2 of 4 features failed); select every face of the feature (...), take out its fillets first (remove_fillets), or keep it with partial=True`
  (`the kernel crashed (signal 11, in a copy of this process)` in place of the reason where it crashed)
- `ValueError: remove_faces: no faces selected`; `ValueError: Face(...) is not a face of this part`.

## Cost
About 0.015 s per feature on the box examples (each kernel step runs once, in the other
process).

## Example
```python
block = Box(40, 30, 20)
drilled = block - Cylinder(5, 40) - Cylinder(3, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(12, 0, 0)
plain = drilled.remove_faces(drilled.faces().cylinders())   # the floor of the blind hole goes with its wall
print(len(plain.faces()), round(plain.volume, 6))            # 6 24000.0

bossed = block + Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 10)
print(round(bossed.remove_faces(bossed.faces().cylinders()).volume, 6))   # 24000.0: the top went with the side

pocket = block - Box(10, 8, 6, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
walls = pocket.faces().within(BoundBox((-5.1, -4.1, 3.9), (5.1, 4.1, 10.1)))   # the 4 walls and the floor
print(len(walls), round(pocket.remove_faces(walls).volume, 6))           # 5 24000.0

try:
    drilled.remove_faces(drilled.faces())
except ModelingError as e:
    print(e)   # remove_faces: that is every face of the part; nothing would be left
```

## Related
`remove_fillets`, `fillets`, `Part.cut` (the other way round), `recipes/simplify`.
