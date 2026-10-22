# split

Cuts a part with a plane, or along a sheet (a curved split surface, a surface fitted to a scan),
and keeps one side or both. The cut faces are closed (the result is a solid).

## Signature
`part.split(plane, keep="above")`
`split(part, plane, keep="above")`

- `plane`: a `Plane`, or a planar face (its plane, normal pointing **out of the part it
  belongs to**); or a sheet: a `Shell` (from `surface`, `ruled`, `stitch`, ...) or a face that
  is not planar (a cylinder face of another part, a free-form face).
- `keep`: `"above"` = the side the plane normal (the sheet's normals) points to; `"below"` = the
  other side; `"both"` = a tuple `(above, below)`. Anything else raises
  `ValueError: keep must be "above", "below" or "both"`.

## Returns
A `Part` (or two). Exact: both halves of a symmetric part have half the volume.
Splitting by another body is not supported (`TypeError: cannot use Part as a plane`): use
`part & body` and `part - body`.

## Along a sheet
- "Above" is the side `sheet.faces()[0].normal_at()` points to. A face of a part counts with
  its outward normal: `box.split(cylinder_face, "both")` gives (outside the cylinder, inside).
- The sheet must cut through the part. A sheet of **one free-form face** whose edges end inside
  the part is extended past them (tangentially, its trim dropped) until it does. Other sheets
  (several faces, analytic faces) that end inside, and sheets that miss the part, raise
  `ModelingError: split: the surface does not cut through the part ...`: make them reach past
  the part on every side.
- Both sides are computed and checked: they hold the part's volume together.
- `part + sheet` and `part - sheet` raise `TypeError` (they returned invalid "Parts"): split, or
  `imprint` the sheet's lines into the faces.

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
- A part made by `merge` raises `ModelingError: split: the part is not a valid solid`: split its
  `cells()`.
- Faces are drafted with `draft`; a split with a tilted plane through a bottom edge also makes
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

# along a free-form sheet: z = 2 + 3 sin(x / 6), normal up
wave = surface([[(x, y, 2 + 3 * math.sin(x / 6)) for y in np.linspace(-15, 15, 7)]
                for x in np.linspace(-15, 15, 13)])
top, bottom = Box(20, 20, 20).split(wave, keep="both")
print(round(top.volume, 3), round(bottom.volume, 3))    # 3200.0 4800.0
```

## Related
`section` (the cut face as a sketch), `imprint` (split lines on faces, nothing cut off),
`mirror`, Booleans `&` and `-`, `Plane`, `surfaces/Shell` (trimming a sheet by a part).
