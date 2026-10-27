# extend

Grow a face's surface past its sides: `Shell.extend` for a sheet of one face, `Face.extend` for
any face (also of a part). To make a sheet reach across a part before cutting or splitting it
with the sheet, or to give a blend room. `Face.untrimmed()` gives the whole surface a face lies
on, without its holes and cut borders.

## Signature
`sheet.extend(distance, *, sides=None, continuity="natural")`
`face.extend(distance, *, sides=None, continuity="natural")`
`extend(sheet_or_face, distance, *, sides=None, continuity="natural")`: the same, as a function
`face.untrimmed()`

- `distance`: how far past each side, measured along the surface, across the middle of the side.
- `sides`: edges of the face (an edge or a list): grow past the sides they lie on only. Default:
  every side that can grow.
- `continuity`: how the surface goes on: `"natural"` (default) as it is: a plane stays the plane,
  a cylinder or sphere the same cylinder or sphere, a B-spline surface follows its own
  polynomials; `"G1"` straight on along its tangents; `"G2"` bending on with the curvature it has
  at the side.

## Returns
A new `Shell` of one face (`extend` on a Sketch keeps it a Sketch). Its normal follows the face's
`normal_at`. The sides are those of the face's surface rectangle, along its parameter directions:
the four edges of a box's face or of a sheet from `surface`, the two ends of a cylinder along its
axis. Trims are dropped: a face with a hole, or cut at a slant, comes back as its rectangle, grown.
A plane's rectangle is the smallest one around the face in the plane's own directions.

`untrimmed()`: the face's whole surface: a cylinder face cut out of a box comes back as the whole
cylinder the cut left it on (all around, full height); a plane as its rectangle around the face.

## Measured
- Box(10) top face, `extend(3)`: a plane 16 x 16 (256); past one edge: 13 x 10 (130).
  `Circle(5)` face: `extend(1)` 12 x 12 (144), `untrimmed()` 10 x 10 (100).
- `Cylinder(5, 10)` side, `extend(2)`: still a cylinder, 2π·5·14 = 439.823, z -7..7 (around it
  the cylinder is closed: it does not grow that way).
- A cap of a sphere r 5, `extend(1)`: still a sphere; every point at radius 5 (1e-14).
- A quarter round r 2: natural follows the circle; `"G1"` reaches the tangent lines (exactly 1
  past the round's ends); `"G2"` in between.
- Sheet from `surface` (20 x 20, z = 0.05 (x - 10)²), `extend(3)`: y -3..23 exactly for all
  three continuities; along the parabola x -1.79..21.79 (natural), -2.03..22.03 (G1). The kernel's
  extension is approximate (its step comes from an average of five iso-curves, and where it fails
  it halves the distance silently): each side is measured across its middle and extended again or
  cut back until it reaches the distance there within 1e-3 of it (on this sheet: 1e-6 natural and
  G1, 2e-5 G2).
- `Box(20, 20, 20) - Cylinder(4, 40)`: the hole's face `untrimmed()` 1005.31 = 2π·4·40, z -20..20.

## Errors
- `ValueError: extend: an edge lies where the surface closes around (a seam) or at a pole; ...`:
  a side that cannot grow (a full cylinder around, a sphere's pole, a cone's tip). A whole sphere:
  `ValueError: extend: the surface closes around and ends in poles: there is no side to extend
  past`.
- `ValueError: extend: an edge does not run along a side of the face's surface rectangle (it is a
  trim across the surface) ...`: a hole's edge, a slanted border.
- `ValueError: extend: an edge in sides does not bound the face`, `TypeError: extend: sides are
  edges of the face`.
- `ValueError: extend: the sheet has 2 faces; extend one of them with sheet.faces()[i].extend(...)`.
- `ValueError: extend: the distance must be positive, got 0`, `... continuity is "natural", "G1" or
  "G2", got 'G3'`.
- `KernelError: extend failed ...: try a shorter distance, or continuity G1`: the kernel could not
  extend that far.

## Example
A curved sheet that must reach across a block before it splits it:

```python
sheet = surface([[(x, y, 5 + 0.02 * (x - 10) ** 2) for y in range(0, 21, 5)] for x in range(0, 21, 5)])
wide = sheet.extend(6)                      # 6 past every side, along the surface
print(wide.bbox())                          # y -6..26; x -5.28..25.28 (the parabola rises)
top = Box(10, 10, 10).faces().filter(lambda f: f.normal_at().z > 0.5)[0]
lid = top.extend(2, sides=top.edges().sort_by(Axis.X)[-1])   # past the +X edge only
```

## Related
`Shell`, `Face` (`untrimmed`, `flipped`), `trim`, `split` (cut a part with a sheet), `surface`,
`blend`, `generic`
