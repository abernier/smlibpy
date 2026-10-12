# split

Cuts a part with a plane and keeps one side or both. The cut faces are closed (the result is a
solid).

## Signature
`part.split(plane, keep="above")`
`split(part, plane, keep="above")`

- `plane`: a `Plane`, or a planar face (its plane, normal pointing **out of the part it
  belongs to**). Curved faces raise `ValueError: a cylinder face has no plane ...`.
- `keep`: `"above"` = the side the plane normal points to; `"below"` = the other side;
  `"both"` = a tuple `(above, below)`. Anything else raises
  `ValueError: keep must be "above", "below" or "both"`.

## Returns
A `Part` (or two). Exact: both halves of a symmetric part have half the volume.
Splitting by another body is not supported (`TypeError: cannot use Part as a plane`): use
`part & body` and `part - body`.

## Which side
- `Plane.XY` normal is +Z: "above" keeps z > 0. `Plane.bottom` has normal -Z: "above" keeps
  z < 0. `Plane.XZ`/`Plane.front` normal is -Y.
- A face of the part itself: its normal points outward, so "above" is outside (raises, see
  below) and "below" keeps the material. A face of another body uses that body's outward normal.
- For a tilted cut, build the plane with `Plane(origin=..., z_dir=...)` and point `z_dir` into
  the side you keep.

## Gotchas
- A side with no material raises `ModelingError: split: nothing of the part lies above the
  plane` (or `below`); `keep="both"` raises if either side is empty. A plane that misses the
  part with the whole part on the kept side returns a copy of the part.
- There is no face draft in smlibpy; a split with a tilted plane through a bottom edge makes
  one drafted wall (example).

## Example
```python
part = Box(40, 30, 20) - Cylinder(8, 30)
upper = part.split(Plane.XY)                            # keeps the side the normal points to: z 0..10
lower = part.split(Plane.XY, keep="below")              # z -10..0
right, left = part.split(Plane.YZ, keep="both")         # (above, below) = (x > 0, x < 0)
low5 = part.split(Plane.XY.offset(5), keep="below")     # everything under z = 5

try:
    part.split(Plane.XY.offset(50))                     # nothing above the plane
except ModelingError as e:
    print(e)                                            # split: nothing of the part lies above the plane

# drafted wall: cut with a plane through the bottom edge, normal tilted 5 degrees, pointing into the part
wall = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
a = math.radians(5)
drafted = wall.split(Plane(origin=(20, 0, 0), z_dir=(-math.cos(a), 0, -math.sin(a))))
print(round(drafted.volume, 3))                         # 23475.068

inside, outside = part & Sphere(15), part - Sphere(15)  # "split by a body"
```

## Related
`section` (the cut face as a sketch), `mirror`, Booleans `&` and `-`, `Plane`.
