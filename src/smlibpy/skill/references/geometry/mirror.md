# mirror

A copy of a shape reflected in a plane. The usual way to build symmetric parts: model one
half, mirror it, fuse.

## Signature
`shape.mirror(plane=Plane.XZ)` and the function `mirror(shape, plane=Plane.XZ)`.
`plane` is a `Plane`, or a planar face (or a one-face selection). Its origin matters; the sense
of its normal does not.

## Which plane mirrors what
| Plane | maps |
|---|---|
| `Plane.YZ` (also `left`, `right`) | x -> -x |
| `Plane.XZ` (the default; also `front`, `back`) | y -> -y |
| `Plane.XY` (also `top`, `bottom`) | z -> -z |
| `Plane.YZ.offset(30)` | x -> 60 - x (about x = 30) |
| a planar face, `face.plane` | about that face's plane |

## Returns
A new shape of the same type. Mirrored parts are valid solids with outward normals and the
same volume; analytic faces (planes, cylinders) keep their type. Fusing a half with its
mirror image merges the faces on the mirror plane: `half + half.mirror(Plane.YZ)` of a box is
a 6-face box.

## Gotchas
- The default plane is `Plane.XZ` (mirrors y), not YZ. Always pass the plane.
- On a part, `mirror(X)` raises `TypeError: cannot use Axis as a plane`; a sketch takes an
  axis in its own plane (`sketch.mirror(Y)`, see `sketches/mirror`). A curved face raises
  `ValueError: a cylinder face has no plane ...`; a selection of several faces raises
  `ValueError: expected exactly one shape, got 2 ...`.
- Sketches keep facing the same way when mirrored in a plane perpendicular to them:
  `Polygon(...).mirror(Plane.YZ)` keeps normal +Z, so mirror and extrude commute
  (`half.extrude(5).mirror(Plane.YZ)` equals `half.mirror(Plane.YZ).extrude(5)`).
- Lines and circles stay lines and circles: mirrored edges, wires and sketches keep `line`
  and `circle` types (and so `radius`, `arc_center`, fillets of their corners).
- Not available on `ShapeList`; mirror each member.

## Example
```python
half = Box(20, 10, 10, align=Align.MIN)          # x 0..20
print(half.mirror(Plane.YZ).bbox())              # x -20..0
print(half.mirror().bbox())                      # default Plane.XZ: y -10..0
print(half.mirror(Plane.YZ.offset(30)).bbox())   # about x = 30: x 40..60

bracket = Polygon((0, 0), (20, 0), (20, 4), (4, 4), (4, 12), (0, 12)).extrude(5)
tee = bracket + bracket.mirror(Plane.YZ)         # symmetric part from one half
print(tee.is_valid(), tee.volume, len(tee.solids()), tee.bbox().size)

print(half.mirror(half.faces().right()).bbox())  # about a planar face: x 20..40
```

## Related
`Plane`, `scale` (negative factors), features `mirror`, `split` (cut a part in half first).
