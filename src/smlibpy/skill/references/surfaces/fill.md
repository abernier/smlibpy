# fill

A surface that fills a closed loop of curves: a hole in a sheet (tangent to the sheet all round),
or a patch through a frame of curves. Rhino's Patch/NetworkSrf for one loop, a Coons patch, an
N-sided fill. (`network` builds a surface through a grid of crossing curves; `ruled` joins two
curves with straight lines; `make_face` fills a planar loop.)

## Signature
`fill(boundary, *, tangent=True)`

- `boundary`: the curves around the hole, in any order and direction: edges on the border of
  sheets (`sheet.edges().filter(lambda e: len(e.faces()) == 1)`), curves (`Spline`,
  `ThreePointArc`, `Line`, ...) or wires. One closed curve (the round edge of a hole), or two, is
  cut into four sides. Where the curves run into each other without corners (a rim in two or
  three pieces, cut where a seam crosses it), the four sides are as nearly equal as the curves'
  ends allow: a round hole is filled the same wherever its rim was cut, on a turned sphere too.
- `tangent`: `True` (default): where the curves are border edges of sheets, the patch meets each
  sheet tangentially along its edge. Then every curve must be such an edge, and the sheets must
  meet each other tangentially where the edges meet (a hole in one smooth sheet; a corner between
  three rounds). `False`: through the curves only.

## Returns
A `Shell`, the patch:
- 4 sides: a Coons patch, one face. Through curves only it is bilinear (straight across between
  opposite sides; in the middle the two sides' bulges add up).
- 5 sides and more: an N-sided fill, one face per side, sewn, meeting in the middle.
- 3 sides: through curves only an N-sided fill of three faces; tangent, a Coons patch whose fourth
  side shrinks to a point at one corner (a pole: `thicken` of it fails or hangs). Three curves
  without corners between them (a rim in three pieces) make four sides instead.

Its normal follows the sheets it is tangent to; through curves only, the right-hand rule around
the loop in the direction of the first curve. Sew it on with `stitch(sheet, patch)`. A few ms;
a closed curve cut into four, about 50 ms.

## Measured
- Four bulged splines on a 10 mm square (bulges 2 and 1): one face, area 112.2176, through every
  curve (1e-16), top at z 3.0 (= 2 + 1). Shuffled and reversed curves give the same patch.
- Sphere r 10 with the cap above z 8 cut off: the cap filled tangent (one face, 0.0004 degrees off
  the sphere's normals along the rim), stitched to the sphere a valid Part of 4141.58 (the whole
  sphere 4188.79). Holes cut at z 9, 6, 4, 2.5: 4179.60, 3929.30, 3494.81, 3030.83 (0.004 degrees
  off at most), the same at the bottom (cut below z -8: 4141.58) and on a sphere turned by any
  quarter turns, for the holes facing each axis (4141.58 within 1e-4). Turned by other angles, the
  rim comes in pieces at other places: 4139.5 to 4144.5, as tangent.
- Paraboloid sheet with a rectangular hole: tangent to 0.001 degrees; round holes (one closed
  edge, radius 2.5 to 10): 0.009 degrees at most, also where the rim touches the sheet's knot lines
  at the patch's corners (refused up to 20.6 degrees off before the kernel's tangent field was
  patched). Pentagon and hexagon holes (N-sided): 1.35 and 1.2 degrees halfway between
  a side's middle and its ends, 0 at the corners and the middles: the kernel's N-sided fill
  approximates the tangency, whatever tolerance it is given. Checked: at most 2 degrees for five
  sides and more, 0.5 for three and four, else `ModelingError`.

## Errors
- `ValueError: fill: the curves do not close: the loop ends 10 from where it starts, at (...)`,
  `... no curve starts or ends at (...)`: a gap in the loop (more than 1e-4 of its size).
- `ValueError: fill: either every curve is an edge of a sheet ... or none is; mixed loops are not
  supported`: with `tangent=True`, some curves border sheets and some do not. Pass
  `tangent=False`, or make sheets of the free curves first.
- `ValueError: fill: an edge lies between two faces`: an edge of a part, or inside a sheet.
- `ModelingError: fill: the patch folds back over the sheets` or `... meets a sheet at 90
  degrees, not tangentially`: a sheet that stands steep to the loop (a cylinder's wall around its
  open top, a sphere cut below z 2 of r 10). Fill with `tangent=False`, or close the hole lower.

## Example
A spherical shell with a hole at the top, closed with a tangent cap and thickened:

```python
cut = Sphere(10) - Box(30, 30, 30).translate(0, 0, 8 + 15)
sheet = stitch([f for f in cut.faces() if f.geom_type == "sphere"])
rim = sheet.edges().filter(lambda e: len(e.faces()) == 1)
cap = fill(rim)                                   # tangent to the sphere along the rim
ball = stitch(sheet, cap)                         # closed: a Part
print(type(ball).__name__, round(ball.volume, 2))  # Part 4141.58
```

A patch through four curves:

```python
sides = [Spline((0, 0, 0), (5, 0, 2), (10, 0, 0)), Spline((10, 0, 0), (10, 5, 1), (10, 10, 0)),
         Spline((10, 10, 0), (5, 10, 2), (0, 10, 0)), Spline((0, 10, 0), (0, 5, 1), (0, 0, 0))]
patch = fill(sides)
print(len(patch.faces()), round(patch.area, 4))   # 1 112.2176
```

## Related
`network` (a grid of curves), `blend` (between two edges), `surface_fillet`, `stitch`, `ruled`,
`make_face`, `Shell.thicken`, `generic`
