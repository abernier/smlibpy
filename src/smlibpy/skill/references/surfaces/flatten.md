# flatten

Press a region of a face onto a plane: a flat area on a curved face (a seat for a part, a pad, a
label area), blended smoothly into the rest of it. `part.flatten` on a part, `sheet.flatten` on a
sheet. For a bump use `warp` or `push`.

## Signature
`part.flatten(face, region, plane, *, continuity="G2")`
`sheet.flatten(face, region, plane, *, continuity="G2")`

- `face`: a face of the part or sheet.
- `region`: the outline on the face, as for `warp` (a closed Wire, a Sketch or Face on the face, or
  polygon points).
- `plane`: the plane (or a planar face) the region is pressed onto; the face moves along its normal,
  up or down.
- `continuity`: how the flat area meets the rest of the face: `"G2"` (default), `"G1"` or `"crease"`.

## Returns
A new `Part` (checked) or `Shell`. Inside the region the face lies exactly in the plane, but for a
border where it blends into the rest: 3/16 of the region's width with `"G2"`, 2/16 with `"G1"`, 1/16
with `"crease"`. Outside the rectangle around the region (along the surface's two directions) the face
is exactly what it was. The face is its own surface minus its height over the plane times a profile
that is 1 inside the region (NLib's flattening of a plane onto a plane), exactly, less the knots it
does not need within 1e-6 of the size (its edges kept where they are): a box's top flattened has
21 x 21 control points, not 39 x 39.

## Measured
- `Box(60, 40, 20)`, top, `flatten(top, Rectangle(20, 16).on(top), Plane.XY.offset(8))`: z 8 exactly
  for |x| <= 6.25 and |y| <= 5, 10 from |x| = 10 or |y| = 8 on; volume 47577.5.
- A sheet `3 sin(x/9) cos(y/11)` over 60 x 60, the region 20..40 x 20..40, onto `Plane.XY`: z 0 to
  1e-9 at (30, 30), (25, 25), (34, 33); its edges stay.
- About 12 ms on a 13 x 13 sheet.

## Errors
- `ValueError: flatten: nothing to flatten: the face already lies in the plane there`.
- `ValueError: flatten: the change reaches an edge of the face (...)`: keep the rectangle around the
  region clear of the face's edges and holes.
- The region errors of `warp` (`does not lie on the face`, `not closed`, ...).

## Example
A flat seat for a sensor on a domed cover:

```python
dome = surface([[(x, y, 8 - 0.01 * ((x - 20) ** 2 + (y - 20) ** 2)) for y in range(0, 41, 5)] for x in range(0, 41, 5)])
face = dome.faces()[0]
seat = [face.raycast((x, y, 50), (0, 0, -1))[0].point for x, y in ((15, 15), (25, 15), (25, 25), (15, 25))]
flat = dome.flatten(face, seat, Plane.XY.offset(7.5))
```

## Related
`warp`, `push`, `surface`, `Plane`, `generic`
