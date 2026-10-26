# twist

Turns every cross-section of a part about an axis, by an angle that grows evenly along it.

## Signature
`twist(shape, angle, *, axis=Z, start=None, end=None, tolerance=None)` or
`part.twist(angle, *, axis=Z, start=None, end=None, tolerance=None)`

- `angle`: degrees between `start` and `end`, counterclockwise seen from the tip of
  `axis` (right-hand rule, as `rotate`). Negative turns the other way; 720 is fine.
- `axis`: an `Axis` (a line, not a direction): `Z` is the world Z axis through the origin.
  Twist about the part's own center line with `Axis(part.center(), (0, 0, 1))` when the part
  is not centered on the origin; about another axis, the part swings around it.
- `start`, `end`: distances along `axis` from `axis.origin`. Default: the part's extent, so
  `twist(90)` turns the far end by exactly 90°. A range beyond the part turns the part by
  its share: `Box(16, 16, 200).twist(45, start=-100, end=300)` turns the top by 22.5°.
- `tolerance`: largest distance of the twisted faces from the exact twist, mm (default
  1e-6). Measured on a hexagonal prism twisted 360°: 1e-3 gives 8.1e-6 and 42 poles per
  side face, 1e-6 gives 1.1e-7 and 74 poles, 1e-8 gives 1.8e-9 and 138 poles; all within
  0.02 s.

## Returns
A `Part` (`Shell` for a shell or sketch), same faces, edges and vertices, same volume. An
`Edge`, `Wire` or point gives an `Edge`, `Wire` or `Vector` (a line off the axis: a helix; for
points give `start` and `end`; see `deform/curves`).
Before `start` the part is unchanged; beyond `end` it is turned rigidly by `angle`.

## Exactness
The faces are quintic B-splines within the tolerance, except what the twist only turns:
faces across the axis stay exact planes (`geom_type == "plane"`, circles on them circles),
and the straight rulings of side faces stay straight (degree 1 across: a twisted box side is
degree 1 x 5, 26 poles). Faces outside the range keep their type (`plane`, `cylinder`). A
cylinder, cone, sphere or torus about the twist axis maps onto itself and stays as it was,
exact (`twist(Cylinder(5, 40), 90)`: a cylinder and two planes, volume 3141.5927; the bore of
`Box(20, 20, 40) - Cylinder(4, 40)` twisted: a cylinder); off the axis, or where a face also
has edges the twist moves (a box fused onto a cylinder's side), it is fitted.

## Gotchas
- A range inside the part splits the faces crossing `start` and `end`: a baluster
  `Box(16, 16, 200).twist(360, start=-50, end=50)` has 14 faces (4 twisted, 10 planes).
- `Box(20, 10, 100).twist(90)` turns the top by 90°: the 20 x 10 top becomes 10 wide and 20
  deep. A square turned by 90° or 360° looks unchanged at the ends; check the middle.
- The bounding box grows to the turned corners (11.18 for a 20 x 10 bar).
- Meshes (STL, glTF, renders) of twisted parts have far more triangles than those of the
  untwisted part: a twisted face needs triangles in proportion to 1 / tolerance, and the whole
  part is divided finer. `Box(20, 20, 100).twist(90).mesh()` has 2076 triangles, 0.03 mm off
  (volume 40061); `mesh(0.001)` 131596 triangles in 0.7 s. Ask for no finer tolerance than
  needed. STEP is exact.
- `offset()` of a twisted part works with its default sharp corners; `corners="round"` can
  fail (`Box(20, 20, 100).twist(90).offset(2, corners="round")`: `ModelingError: offset: the
  kernel could not build a valid result ...`). `shell()` works.

## Errors
- `ValueError: twist: angle is 0; nothing to do`, `... must be a finite number of degrees`.
- `ValueError: twist: end (1) must lie beyond start (3)`.
- `ModelingError: twist: the range 20 to 30 does not reach the part, which spans -5 to 5`.

## Example
```python
bar = Box(20, 10, 100).twist(90)                     # a quarter turn over the whole length
print(len(bar.faces()), round(bar.volume, 3))      # 6 20000.0
print(sorted((round(v.x, 6), round(v.y, 6)) for v in bar.vertices() if v.z > 49))  # top: 10 wide, 20 deep

baluster = Box(16, 16, 200).twist(360, start=-50, end=50)   # only z -50..50 turns
print(len(baluster.faces()))                         # 14: the sides are split at z -50 and 50

vase = RegularPolygon(30, 6).extrude(120).twist(60)
vase = vase.shell(2.5, vase.faces().sort_by(Z)[-1])  # hollow, open at the top
print(vase.is_valid(), round(vase.volume, 1))

plate = Box(80, 60, 10).twist(30, axis=Axis((0, 0, 0), (0, 1, 0)))  # about Y
print(plate.is_valid(), round(plate.volume, 3))
```
prints `6 20000.0`, the top corners `(±5, ±10)`, `14`, `True 56287.4`, `True 48000.0`.

## Related
`deform/generic`, `taper`, `bend`, `Lattice`; `sweep` along a `Helix` for threads and springs.
