# thicken

Turns a surface (a `Shell`, a `Sketch`, or one face) into a solid of constant thickness.

## Signature
`shell.thicken(thickness, *, both=False)` (also on a `Sketch`, which is a sheet)
`thicken(surface, thickness)` (a `Shell`, `Sketch` or `Face`; a part's face is copied first)

- `thickness`: along the face normal; negative goes to the other side. Not zero.
- `both=True` (method only): the total thickness centered on the sheet:
  `Rectangle(20, 10).thicken(2, both=True)` spans z -1..1 (volume 400). The `thicken()`
  function has no `both`.

## Returns
A `Part`. Planar: exact `area * t`. Curved: exact offset volume (a half-cylinder sheet r10,
+2 → 1382.30 = π(12² − 10²)/2·20).

## Which side
The side is the face normal, so check it before you thicken:
`sheet.faces()[0].normal_at(point)`.
- A sketch: its plane normal (`Plane.front` → -Y).
- A face of a part: outward, away from the material (`thicken(box.faces().top()[0], 3)` sits on top).
- A cylinder face of a part: away from the axis.
- An extruded open curve: depends on the curve's direction (an arc drawn counter-clockwise in
  XY and extruded up has normals pointing away from its center).
- A `surface(...)` from a point grid: depends on the point order (a grid with rows along Y
  and columns along X had its normal pointing down). Check it.

## Gotchas
- Multi-face sheets thicken with sharp corners: an L-shaped sheet (two faces) thickened 1 to
  the outside gains the corner block (310 for 300 of area), to the inside 290.
- The result is checked. Thickening to the concave side by more than the radius, closed grid
  tubes from `surface()` and domes with a pole raise `ModelingError: thicken: the kernel
  returned a body that is ...; the kernel cannot offset this sheet (closed grid surfaces and
  surfaces with a pole fail; build closed shapes with revolve, loft or extrude, or thicken less
  than the smallest concave radius)`.
- The kernel runs in a forked copy of the process (Linux, macOS): a crash or a step longer than
  `smlibpy.defeature.GUARD_SECONDS` (20 s) raises `ModelingError` there, and this process goes on.
- A `Part` has no `thicken`: `thicken(part, 1)` raises `TypeError: thicken takes a face or a
  sheet (Shell, Sketch), not a Part; use shell() or offset() for parts`.
- `thickness=0`: `ValueError: thicken: the thickness must not be zero`.

## Example
```python
panel = Rectangle(20, 10).thicken(2)                    # along the sketch normal: z 0..2
under = Rectangle(20, 10).thicken(-2)                   # z -2..0
mid = Rectangle(20, 10).thicken(2, both=True)           # z -1..1
print(mid.bbox().min.z, mid.bbox().max.z, round(mid.volume, 3))   # -1.0 1.0 400.0
box = Box(40, 30, 20)
skin = thicken(box.faces().top()[0], 3)                 # face normal points out: z 10..13

arc_sheet = extrude(CenterArc((0, 0), 10, 0, 180), 20)  # a half-cylinder surface (Shell)
print(arc_sheet.faces()[0].normal_at((0, 10, 10)).to_tuple())   # (0, 1, 0): points away from the axis
wall = arc_sheet.thicken(2)                             # outside: radii 10..12
print(round(wall.volume, 2))                            # 1382.3 = pi*(12^2 - 10^2)/2 * 20
```

## Related
`surface`, `ruled`, `stitch`, `extrude` (open curves make sheets), `offset`, `shell`.
