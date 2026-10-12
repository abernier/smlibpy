# twist

Turns every cross-section of a part about an axis, by an angle that grows evenly along it.

## Signature
`twist(shape, angle, *, axis=Z, start=None, end=None, tolerance=None)` or
`part.twist(angle, ...)`

- `angle`: degrees between `start` and `end`, counterclockwise seen from the tip of
  `axis` (right-hand rule, as `rotate`). Negative turns the other way; 720 is fine.
- `axis`: an `Axis` (a line, not a direction): `Z` is the world Z axis through the origin.
  Twist about the part's own center line with `Axis(part.center(), (0, 0, 1))` when the part
  is not centered on the origin; about another axis, the part swings around it.
- `start`, `end`: distances along `axis` from `axis.origin`. Default: the part's extent, so
  `twist(90)` turns the far end by exactly 90°. A range beyond the part turns the part by
  its share: `Box(16, 16, 200).twist(45, start=-100, end=300)` turns the top by 22.5°.
- `tolerance`: largest distance of the twisted faces from the exact twist, mm (default
  1e-6). Measured on a hexagonal prism twisted 360°: 1e-3 gives 2.1e-4 and 164 poles, 1e-6
  gives 3.8e-8 and 452 poles, 1e-8 gives 5.8e-10 and 836 poles; all within 0.02 s.

## Returns
A `Part` (`Shell` for a shell or sketch), same faces, edges and vertices, same volume.
Before `start` the part is unchanged; beyond `end` it is turned rigidly by `angle`.

## Exactness
The faces are quintic B-splines within the tolerance, except what the twist only turns:
faces across the axis stay planes (degree 1 x 1), and the straight rulings of side faces
stay straight (degree 1 across: a twisted box side is degree 1 x 5, 26 poles). Faces outside
the range keep their type (`plane`, `cylinder`).

## Gotchas
- A range inside the part splits the faces crossing `start` and `end`: a baluster
  `Box(16, 16, 200).twist(360, start=-50, end=50)` has 14 faces (4 twisted, 10 planes).
- `Box(20, 10, 100).twist(90)` turns the top by 90°: the 20 x 10 top becomes 10 wide and 20
  deep. A square turned by 90° or 360° looks unchanged at the ends; check the middle.
- The bounding box grows to the turned corners (11.18 for a 20 x 10 bar).
- Meshes and renders of twisted faces are coarse: one facet across each twisted face
  (kernel tessellator). `Box(20, 20, 100).twist(90).mesh()` is up to 0.48 mm off and 5 % too
  large; use a small mesh tolerance for STL. STEP is exact.
- `offset()` of a twisted part fails outward; `shell()` works.

## Errors
- `ValueError: twist: angle is 0; nothing to do`, `... must be a finite number of degrees`.
- `ValueError: twist: end (1) must lie beyond start (3)`.
- `ModelingError: twist: the range 20 to 30 does not reach the part, which spans -5 to 5`.

## Example
```python
bar = Box(20, 10, 100).twist(90)                     # a quarter turn over the whole length
print(len(bar.faces()), round(bar.mass_properties(accuracy=1e-10).volume, 3))      # 6 20000.0
print(sorted((round(v.x, 6), round(v.y, 6)) for v in bar.vertices() if v.z > 49))  # top: 10 wide, 20 deep

baluster = Box(16, 16, 200).twist(360, start=-50, end=50)   # only z -50..50 turns
print(len(baluster.faces()))                         # 14: the sides are split at z -50 and 50

vase = RegularPolygon(30, 6).extrude(120).twist(60)
vase = vase.shell(2.5, vase.faces().sort_by(Z)[-1])  # hollow, open at the top
print(vase.is_valid(), round(vase.mass_properties(accuracy=1e-10).volume, 1))

plate = Box(80, 60, 10).twist(30, axis=Axis((0, 0, 0), (0, 1, 0)))  # about Y
print(plate.is_valid(), round(plate.mass_properties(accuracy=1e-10).volume, 3))
```
prints `6 20000.0`, the top corners `(±5, ±10)`, `14`, `True 56287.4`, `True 48000.001`.

## Related
`deform/generic`, `taper`, `bend`, `Lattice`; `sweep` along a `Helix` for threads and springs.
