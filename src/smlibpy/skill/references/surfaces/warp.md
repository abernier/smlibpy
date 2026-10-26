# warp

Raise or sink a region of a face: a smooth bump or recess over an outline drawn on the face (an
embossed pad, a finger recess, a bead's end). `part.warp` on a part, `sheet.warp` on a sheet. For one
point use `push`; to make a region flat, `flatten`.

## Signature
`part.warp(face, region, by, *, continuity="G2")`
`sheet.warp(face, region, by, *, continuity="G2")`

- `face`: a face of the part or sheet.
- `region`: the outline on the face: a closed `Wire` (on a curved face, `project` one onto it), a
  `Sketch` or `Face` placed on the face (its outline: `Circle(8).on(top)`), or the corner points of a
  polygon on the face. Curved edges count as 32 points.
- `by`: how far the region rises at its highest point: a number along the face's outward normal at
  the region's middle (positive out of a part; negative: a recess), or a vector.
- `continuity`: how the change meets the rest of the face at the region's border: `"G2"` (default;
  curvature continuous), `"G1"` (tangent) or `"crease"` (a sharp border).

## Returns
A new `Part` (checked) or `Shell` (a Sketch's: a Shell). The highest point rises by exactly `by`; it
lies near the region's middle (at it for a region symmetric along both directions of the face's
surface, with `"G2"`). The face changes only inside the rectangle around the region along the
surface's two directions (for a rectangle drawn along them: inside the region), and is exactly what
it was elsewhere. The profile is NLib's region warp (a rational bell over the region), on a grid of
16 x 16 knot spans across the region. The face's B-spline then loses the knots it does not need
within 1e-6 of the size, its edges kept where they are (the box top below with `"G1"`: 22 x 22
control points instead of 23 x 23; `"crease"`: 23 x 23 instead of 25 x 25).

## Measured
- `Box(60, 40, 20)`, top, `warp(top, Rectangle(20, 16).on(top), 4)`: z 14 exactly at the middle,
  10 at (10.5, 0) and (25, 15); volume 48148.03 (`"G1"` and `"crease"` larger, fuller).
- `warp(top, Circle(8).on(top), -3)`: 7 exactly at the middle.
- `Cylinder(10, 40)` side, a region from 60 to 120 degrees, -6 < z < 6, `by=3`: y 13 exactly,
  smooth across the quarter turn; outside the region still the cylinder.
- About 2 ms on a plane.

## Errors
- `ValueError: warp: the change reaches an edge of the face (...): keep the rectangle around the
  region (along the surface's directions) clear of the face's edges and holes`.
- `ValueError: warp: the region does not lie on the face: a point of it is 5 off the face's surface`:
  place the outline on the face (`.on(face)`, `part.project(...)`).
- `ValueError: warp: the region's wire is not closed`, `... the region encloses no area of the face`,
  `... the region sketch has 2 regions`, `... continuity is one of "crease", "G1", "G2"`.
- `TypeError: warp: the region is a closed Wire, a Face or a Sketch on the face, or a list of points`.

## Example
A recessed label area on a curved sheet, outlined from above:

```python
sheet = surface([[(x, y, 0.02 * (x - 20) ** 2) for y in range(0, 41, 10)] for x in range(0, 41, 10)])
face = sheet.faces()[0]
outline = sheet.project(Rectangle(16, 10).translate(20, 20).on(Plane.XY.offset(30)).faces()[0].outer_wire(),
                        (0, 0, -1))
recessed = sheet.warp(face, Wire(outline), -1.5)
```

## Related
`push`, `flatten`, `project`, `surface`, `Lattice`, `generic`
