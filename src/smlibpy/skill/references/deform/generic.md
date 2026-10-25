# Deformations: what they share

`twist`, `taper`, `bend`, `unroll` and `Lattice` deform an existing part: every point of
space moves, and the whole body with it. All faces, edges and vertices go through the same map, so the
result is again a closed solid with the same topology (`len(part.faces())` does not change,
except where a range splits faces, see below). Holes, fillets and pockets deform with the part.
Methods on `Part`: `part.twist(...)`, `part.taper(...)`, `part.bend(...)`,
`part.unroll(radius=...)`, `part.deform(lattice)`; functions `twist(shape, ...)`, ... also
take a `Shell` or `Sketch` (result: `Shell`), an `Edge` or `Wire` (result: the same kind, a
path for a sweep) and points (result: `Vector`s; see `deform/curves`).

## Exact or within a tolerance
| Face or edge | Result |
|---|---|
| exact image a plane, cylinder or cone (a line, circle) | that analytic geometry, exact (`geom_type` `plane`, `cylinder`, `cone`; `line`, `circle`) |
| `twist`: a cylinder, cone, sphere or torus about the twist axis, bounded by circles about it | itself, exact (it maps onto itself; seam, circles and type kept) |
| moved like a rigid body or scaled evenly (also: left in place) | the original geometry, moved: type kept |
| other faces, `Lattice`, `taper` | exact NURBS: the exact image (degree up to `MAX_DEGREE` = 12) |
| other faces, `twist`, `bend`, `unroll` | NURBS within `tolerance` (1e-6 mm) of the exact image, quintic B-splines |

Analytic images: a plate bent about an axis has cylinders about the bend axis (and circles
across it), a slanted plane bent becomes a cone; a tapered cylinder is a cone, a tapered box
has planes; the ends of a twisted bar are planes; an unrolled ring is planes and lines; faces
a lattice leaves in place keep their type. So `faces().cylinders()`, `Face.radius`,
`Face.axis`, `edges().circles()`, `bends()`/`unfold` and STEP (planes, cylinders, cones) work
on deformed parts. A twist maps a surface of revolution about its own axis onto itself: a
twisted cylinder, cone, sphere or torus about the axis, the bore of a twisted bar along the
axis, are what they were. Twist, bend and unroll use sines and cosines: a twisted side face, a
hole across a bend and a bent tube (a seam) are fitted; the straight rulings of a twisted side
stay straight (degree 1 across). A face whose exact lattice image needs more than degree 12
(a sphere in a 4 x 4 x 4 lattice needs 18) or more than 40000 control points (the offset face
of a thickened free-form surface, 11025 poles, would get 514794) is fitted within the
tolerance instead. Fitted faces keep their parameterization, so their trim curves are the
original ones.

## Ranges (`start`, `end`)
twist, taper and bend act between `start` and `end` (distances along the axis, or along the
bend plane's `x_dir`, from its origin; default: the part's extent). Before `start` the part
stays; beyond `end` it is turned (twist, bend) or scaled (taper) as a whole. Faces crossing
`start` or `end` are split there first: `Box(16, 16, 200).twist(360, start=-50, end=50)` has
14 faces instead of 6; the faces outside the range keep their analytic type (`plane`).

## Checking the result
- Volumes: a twist keeps the volume; a taper changes it exactly as the scaled cross-sections
  say; a bend keeps it when the neutral layer runs through the middle of the cross-section,
  otherwise V' = V * (1 - y_c / radius) for the whole part bent (Pappus; y_c = distance of
  the centroid from the neutral layer toward the bend axis). An unroll changes each layer at
  distance r from the axis by radius / r.
- `part.volume` is exact on deformed parts as on any other (to 1e-7 relative or better; a
  bar bent 90° about its middle layer: 10000.000000000002). No need for `accuracy=`.
- Every result is checked: a broken or folded body raises `ModelingError`, a lattice that
  turns space inside out is refused before it runs.

## Gotchas
- Meshes of twisted parts are within the mesh tolerance but have many more triangles: a
  face that stays straight across while it twists along makes `tessellate` halve all faces of
  the part until they are flat (the kernel's grid put one facet across such a face, 1 mm off).
  `Box(20, 20, 100).twist(90).mesh()` (default tolerance 0.108): 2076 triangles instead of 12
  for the box, 0.03 mm off, volume 40061; at `tolerance=0.001` 131596 triangles, 0.6 s. Bent
  and tapered parts do not twist their faces and keep the usual triangle counts.
- `offset()` of twisted, tapered or bent parts usually fails outward (`ModelingError: offset:
  the kernel could not build a valid result`); `shell()` works.
- Self-intersection is not detected: a bend of more than 180° with long legs makes the legs
  cross and still passes `is_valid()`. Keep `start`/`end` and the legs apart.
- A face with a seam (a full turn: a bent tube, a cylinder twisted about another axis) is
  fitted, not analytic: its new seam would not lie where the old one was. About the twist's
  own axis the face maps onto itself and stays as it was, unless edges that the twist moves
  touch it (a box fused onto a cylinder's side).
- Booleans, fillets, chamfers and shells work on deformed parts. Order matters: features
  made before the deformation deform with the part, features added after it do not (a hole
  drilled after a twist keeps its cylinder wall; drilled before, it twists along).

## Errors
- `ValueError`: angle 0 or not finite, scale not positive or 1, tolerance not positive, end
  before start, a bend of 360° or more, an unroll radius not positive.
- `ModelingError: ... does not reach the part` when the range misses the part;
  `bend: the part reaches ... toward the bend axis` when the radius is too small;
  `lattice: the lattice folds the part onto itself near (x, y, z)`; `unroll: the part reaches
  the axis`, `... goes all the way around the axis`, `... reaches the line opposite start`.

## Example
```python
def check(tag, part, expected=None):
    v = part.volume
    ok = part.is_valid() and (expected is None or abs(v - expected) <= 1e-6 * expected)
    print(tag, ok, len(part.faces()), round(v, 3))
    return ok

check("twist", Box(20, 20, 100).twist(90), 40000)            # a twist keeps the volume
check("bend", Box(100, 10, 10).bend(90), 10000)              # neutral layer through the middle: kept
r = 100 / (math.pi / 2)
check("bend, neutral at the bottom", Box(100, 10, 10).bend(90, plane=Plane((0, 0, -5), (1, 0, 0), (0, -1, 0))),
      10000 * (1 - 5 / r))                                   # Pappus: layers above the neutral one shorten
check("taper", Cylinder(10, 50).taper(0.5), math.pi * 50 / 3 * (100 + 50 + 25))
lat = Lattice(Box(60, 40, 20), 3)
lat.move((1, 1, -1), (0, 0, 8))
check("lattice", lat.apply(Box(60, 40, 20)))
```
prints `twist True 6 40000.0`, `bend True 6 10000.0`, `bend, neutral at the bottom True 6
9214.602`, `taper True 3 9162.979`, `lattice True 6 50133.333`. The bent bar has 2 cylinders
and 4 planes, the cone 1 cone and 2 planes, the pillow 5 planes and its B-spline top.

## Related
`deform/twist`, `deform/taper`, `deform/bend`, `deform/unroll`, `deform/Lattice`, `deform/curves`,
`recipes/deform`;
`sweep` and `loft` (model the shape directly), `extrude(taper=...)`.
