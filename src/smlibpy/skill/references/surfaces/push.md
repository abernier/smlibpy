# push

Push or pull a face at a point: a smooth dent or bump, local to the point, the face's edges in place.
`part.push` on a part (it stays a solid), `sheet.push` on a sheet. For a raised or sunk area of a
given outline use `warp`; for a flat area on a curved face, `flatten`.

## Signature
`part.push(face, at, *, by=None, to=None, normal=None, radius=None, continuity="G1")`
`sheet.push(face, at, *, by=None, to=None, normal=None, radius=None, continuity="G1")`
`push(part_or_sheet, face, at, *, by=None, ...)`: the same, as a function

- `face`: a face of the part or sheet (a face of an earlier version of it is found by its place).
- `at`: the point of the face that moves; a point off the face is taken to the face's nearest point.
- `by`: how far it moves: a number along the face's outward normal there (positive out of a part: a
  bump; negative: a dent), or a vector. `to`: the point it moves to, instead. One of the two
  (neither only with `normal`: the tangent plane turns, the point stays).
- `normal`: the face's normal at the moved point afterwards. Default: as it was there.
- `radius`: how far from the point the face changes, measured along the face, in each of the
  surface's two directions (a rounded square, not a circle). Default: up to the face's nearest edge,
  halved (up to five times) while the change would still move an edge.
- `continuity`: where the change reaches the face's border: `"G0"` (the edges stay), `"G1"` (default;
  also the tangent planes along them, so the face still meets its neighbours as before) or `"G2"` (also
  the curvature).

## Returns
A new `Part` (checked to be a sound solid) or `Shell` (a Sketch's comes back as a Shell). The face
becomes a B-spline surface: its own surface plus the change, exactly. The point moves exactly (to
1e-9), the normal is exactly the one asked; outside `radius` the face is exactly what it was (a plane
stays at its height, a cylinder at its radius). The change is a cubic B-spline: curvature continuous.

## Measured
- `Box(60, 40, 20)`, top face, `push(top, (0, 0, 10), by=5, radius=15)`: top at z 15 exactly,
  volume 48500 (a bump of 500 = 5 x 10 x 10), unchanged at (20, 0); the other five faces stay
  planes. Without a radius (up to the nearest edge, 20): 48888.89.
- The same with `radius=30` (past the long edges): `"G1"` 49833.33, `"G2"` 49500; the top stays
  level along its edges.
- `to=(5, 3, 13), normal=(0.2, 0, 1)`: the point exactly there, its normal exactly (0.2, 0, 1).
- `Cylinder(10, 40)` side at (0, 10, 5), `by=2, radius=6`: y 12 exactly, volume 12599.44; smooth
  across the cylinder's quarter turn (no crease); elsewhere still the cylinder.
- `Sphere(10)` at 45 degrees, `by=-1.5, radius=4`: volume 4178.0.
- Survives `save`/`load` and copies (`to_shell`): the bumped top is not taken for a plane.
- About 2 ms for a plane, 12 ms for a cylinder or sphere.

## Errors
- `ValueError: push: the change reaches an edge of the face that cannot move (... at (6, 0, 10))`:
  a hole's edge or a border cut across the face's surface lies within `radius`; take a smaller
  radius or a point farther from it (or leave `radius` out).
- `ValueError: push: the point lies on an edge of the face` (or `cannot move: it lies on (or next
  to) an edge`): edges stay; push a point inside the face. A cylinder's seam is an edge too.
- `ValueError: push: the point lies where the face's surface degenerates (a pole or a tip)`.
- `ValueError: push: give the move ...`, `... not both`, `... the radius must be positive`,
  `... continuity is one of "G0", "G1", "G2"`, `... the normal must point to the side ...`.
- `ValueError: push: <face> is not a face of this part`, `TypeError: push: face must be a Face`.
- `ValueError: push: only faces of planes, analytic and B-spline surfaces can be shaped` (offset
  surfaces).

## Example
A thumb dent in a lid, and a raised boss blended into a curved sheet:

```python
lid = Box(60, 40, 6)
top = lid.faces().sort_by(Axis.Z)[-1]
lid = lid.push(top, (15, 0, 3), by=-1.5, radius=10)       # a dent 1.5 deep, 10 around
sheet = surface([[(x, y, 0.02 * (x - 20) ** 2) for y in range(0, 41, 10)] for x in range(0, 41, 10)])
face = sheet.faces()[0]
at = face.raycast((20, 20, 50), (0, 0, -1))[0].point
bumped = sheet.push(face, at, by=4, radius=8, normal=(0.3, 0, 1))
```

## Related
`warp`, `flatten`, `Lattice` (a whole part, not one face), `surface`, `Face` (`normal_at`, `raycast`),
`generic`
