# mirror (operation)

Makes a mirrored copy of a shape. It does not fuse: add the copy to the original yourself.

## Signature
`shape.mirror(plane=Plane.XZ)`
`mirror(shape, plane=Plane.XZ)`

- `plane`: a `Plane`, or a planar face (or a one-face selection) whose plane is used.
  **The default is `Plane.XZ`, which flips Y**, not X. Pass the plane explicitly: `Plane.YZ`
  flips X, `Plane.XY` flips Z, `Plane.YZ.offset(30)` mirrors about x = 30,
  `part.mirror(part.faces().right())` about the part's right face.
- Works on parts, sketches, faces, edges and wires.

## Returns
A shape of the same type: same volume, valid, mirrored position. Fused with the original
(`half + half.mirror(Plane.YZ)`) the touching faces disappear and coplanar faces merge into one
solid (14 faces for the example below, not 20).

## Gotchas
- Halves that only touch fuse into one solid; halves with a gap stay two solids in one `Part`
  (check `len(part.solids())`); overlapping halves fuse normally.
- A mirrored sketch keeps facing the same way when the mirror plane is perpendicular to it:
  `Rectangle(10, 6).translate(10, 0).mirror(Plane.YZ)` has normal (0, 0, 1) and extrudes up, like
  the original. Mirroring a sketch and extruding it gives the same part as extruding and
  mirroring. A sketch takes an axis in its plane too: `sketch.mirror(Y)`.
- Features on the half (fillets, holes) are mirrored with it: build the half completely, then
  mirror and fuse.

## Example
```python
half = Box(20, 10, 10).translate(10, 0, 0)
half = half.fillet(half.edges().right(), 2)
whole = half + half.mirror(Plane.YZ)                    # mirror about x = 0, then fuse
print(len(whole.solids()), len(whole.faces()), round(whole.volume, 3))   # 1 14 3937.463

right = Box(20, 10, 10)
pair = right + right.mirror(right.faces().right())     # about the part's own face: x = 10
print(pair.bbox().size.to_tuple())                      # (40.0, 10.0, 10.0)

copy = mirror(half, Plane.YZ.offset(30))                # a copy about x = 30 (no fuse)

sk = Rectangle(10, 6).translate(10, 0).mirror(Plane.YZ)
print(sk.plane.z_dir.to_tuple())                        # (0.0, 0.0, 1.0): extrudes up like the original
```

## Related
`Plane`, `Part.fuse` (`+`), `split` (cut a part in half before mirroring), patterns
(`PolarLocations`) for rotational copies.
