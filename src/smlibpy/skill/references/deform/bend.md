# bend

Bends a part around an axis, like a bar bent over a mandrel: the whole part into an arc, or
a section of it with straight legs on both sides.

## Signature
`bend(shape, angle, *, radius=None, plane=Plane.XZ, start=None, end=None, tolerance=None)`
or `part.bend(angle, ...)`

- `plane` sets everything: `x_dir` runs along the part, a positive `angle` bends toward
  `y_dir`, the bend axis is parallel to the plane normal, and the layer through
  `plane.origin` spanned by `x_dir` and the normal is the **neutral layer** (keeps its
  length; material on the inside is compressed, outside stretched). Default `Plane.XZ`: a
  part along X bends up toward +Z. `Plane.XY` bends toward +Y.
- `angle`: degrees the part turns, positive toward `y_dir`, |angle| < 360.
- `radius`: bend radius of the neutral layer. The bend axis lies `radius` from the neutral
  layer on the side the part bends toward.
- `start`, `end`: the bent section, as distances along `x_dir` from `plane.origin`.

| given | bent section |
|---|---|
| nothing | the whole part (radius = length / angle): `Box(100, 10, 10).bend(90)` -> radius 63.662 |
| `radius` | length radius * angle, **centered on the plane origin** |
| `radius`, `start` (or `end`) | starts (or ends) there |
| `start`, `end` | between them; radius = (end - start) / angle |

Before `start` the part stays; beyond `end` it goes on straight, turned by `angle`.

## Returns
A `Part` (`Shell` for a shell or sketch), same faces (more when the section is inside the
part: the faces are split at its ends). Faces within the tolerance (default 1e-6 mm);
straight lines along the axis and end faces stay exact; the legs keep their analytic types
(the U below: 4 B-spline faces in the bend, 10 planes).
Volume: kept when the neutral layer runs through the middle of the cross-section;
otherwise each layer at distance y toward the axis is scaled by (radius - y) / radius
(Pappus): neutral layer at the bottom of a 10 mm bar bent 90° over its 100 mm: 9214.602
instead of 10000.

## Gotchas
- With only `radius`, the bend is centered on the plane origin, not at the part's end:
  `Box(160, 10, 6).bend(180, radius=25)` bends x -39.27..39.27; the leg before it stays at
  x -80..-39.27 and the other comes back above it (bbox x -80..-11.27, z -3..53).
- Bending a centered part from its end: `start=` the part's minimum, or move the plane.
  `Box(100, 10, 10).bend(-90, radius=20, start=10)` goes down from x = 10 (bbox z to -28.58).
- The neutral layer is the plane origin's layer, not the part's middle: a part lying on
  z 0..10 bent with the default plane has its neutral layer at its bottom.
- Material must not reach the bend axis: `radius` larger than the part's thickness on the
  inside (from the neutral layer).
- Bends over 180° with long legs make the legs cross; that is not detected (`Box(200, 10,
  10).bend(270, radius=10)` passes `is_valid()`).
- `part.volume` can be 4e-4 off on bent parts (kernel integration); use
  `mass_properties(accuracy=1e-10)`. `offset()` fails outward; `shell()` works: bend a solid
  tube, then shell it with the end faces open (or bend a hollow tube: same volume).

## Errors
- `ModelingError: bend: the part reaches 5 mm from the neutral layer toward the bend axis,
  which is only 4 mm away; bend with a larger radius ...`.
- `ValueError: bend: angle must be less than 360 degrees ...`.
- `ValueError: bend: start and end are 5 apart, but radius 10 and angle 90 need 15.708; give
  only two of radius, start and end`.
- `ModelingError: bend: the bend (60 to 75.708 along x_dir from the plane origin) does not
  reach the part, which spans -50 to 50`.
- `TypeError: bend: plane must be a Plane ...` (an `Axis` is not accepted).

## Example
```python
bar = Box(100, 10, 10).bend(90)                      # the whole bar: a quarter circle, radius 100 / (pi/2)
print(bar.bbox(), round(bar.mass_properties(accuracy=1e-10).volume, 3))   # volume kept: 10000.0

hook = Box(160, 10, 6).bend(180, radius=25)          # U shape: the bend is centered on x = 0
print(hook.bbox())

elbow = Cylinder(6, 150).rotate(Y, 90).bend(90, radius=30)   # pipe elbow with straight legs
pipe = elbow.shell(1, elbow.faces().planar())               # hollow, open ends
print(pipe.is_valid(), round(pipe.mass_properties(accuracy=1e-10).volume, 3))

down = Box(100, 10, 10).bend(-90, radius=20, start=10)     # down from x = 10
print(down.bbox())

side = Box(100, 10, 10).bend(90, plane=Plane.XY)           # toward +Y instead of +Z
print(side.bbox())
```
prints bbox x -50..18.662, z -5..63.662 and `10000.0`; x -80..-11.27, z -3..53; `True
5183.628` (= pi * (36 - 25) * 150); z down to -28.584; y up to 63.662.

## Related
`deform/generic`, `twist`, `taper`; `sweep` along a path with arcs when you draw the path
anyway (a tube with several bends).
