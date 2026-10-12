# mirror

A copy of a shape reflected in a plane. The usual way to build symmetric parts: model one
half, mirror it, fuse.

## Signature
`shape.mirror(plane=Plane.XZ)` and the function `mirror(shape, plane=Plane.XZ)`.
`plane` must be a `Plane`. Its origin matters; the sense of its normal does not.

## Which plane mirrors what
| Plane | maps |
|---|---|
| `Plane.YZ` (also `left`, `right`) | x -> -x |
| `Plane.XZ` (the default; also `front`, `back`) | y -> -y |
| `Plane.XY` (also `top`, `bottom`) | z -> -z |
| `Plane.YZ.offset(30)` | x -> 60 - x (about x = 30) |
| `face.plane` | about that planar face |

## Returns
A new shape of the same type. Mirrored parts are valid solids with outward normals and the
same volume; analytic faces (planes, cylinders) keep their type. Fusing a half with its
mirror image merges the faces on the mirror plane: `half + half.mirror(Plane.YZ)` of a box is
a 6-face box.

## Gotchas
- The default plane is `Plane.XZ` (mirrors y), not YZ. Always pass the plane.
- `mirror(X)` or `mirror(face)` raises `AttributeError` (`'Axis' object has no attribute
  'z_dir'`); pass a Plane, `face.plane` for a face.
- **Mirrored sketches flip their normal** when the mirror plane is perpendicular to the
  sketch: `Polygon(...).mirror(Plane.YZ)` gets normal -Z and `extrude(5)` goes to z -5..0.
  `half + half.mirror(Plane.YZ)` keeps the plane of `half` (left operand) and extrudes up;
  `half.mirror(Plane.YZ) + half` extrudes down. Put the unmirrored sketch first, or mirror
  the extruded part instead.
- Standalone edges (`CenterArc`, `Line`) become `bspline` edges when mirrored.
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

right = half.faces().sort_by(X)[-1]
print(half.mirror(right.plane).bbox())           # about a face: pass face.plane, x 20..40
```

## Related
`Plane`, `scale` (negative factors), features `mirror`, `split` (cut a part in half first).
