# extrude

Turns a sketch, a planar face or a closed wire into a solid by pushing it along a direction.
An open curve extrudes into a surface (`Shell`).

## Signature
`sketch.extrude(amount, *, both=False, taper=0.0, direction=None)`
`face.extrude(amount, **same keywords)` (planar faces only)
`extrude(profile, amount, *, both=False, taper=0.0, direction=None)` (sketch, face, one-element
face list, wire or edge)

- `amount`: mm along the sketch normal. Negative goes against the normal. 0 raises.
- `both=True`: `abs(amount)` to each side of the sketch (total `2*abs(amount)`).
- `taper`: degrees, between -90 and 90. Positive narrows the solid away from the sketch,
  negative widens it. Works with negative amounts and `both` too (each side narrows away from
  the sketch). Holes widen where the outline narrows.
- `direction`: a vector to extrude along instead of the normal. `amount` is the length along
  that vector, so the height above the sketch is `amount * cos(angle to the normal)`.

## Returns
A `Part` (an open curve gives a `Shell`). The solid starts at the sketch plane:
`Rectangle(40, 30).extrude(5)` spans z 0..5, `extrude(-5)` z -5..0, `both=True` z -5..5.

## Direction
- A sketch extrudes along `sketch.plane.z_dir`. `Plane.front` (= `Plane.XZ`) has normal **-Y**:
  a sketch on it extrudes towards -Y.
- `sketch.on(face)` takes the face's outward normal: a positive amount grows out of the part,
  a negative amount goes into it. Pockets are `part -= sketch.on(face).extrude(-depth)`.
- `face.extrude(d)` on a part's face: same rule, outward for positive `d`.
- An open curve extrudes along the normal of its plane (+Z for a curve in XY), or +Z when the
  curve is a straight line. Pass `direction=` for anything else.

## Gotchas
- `taper` keeps the holes of the profile and tapers them the other way:
  `(Circle(10) - Circle(5)).extrude(10, taper=5)` is a ring whose hole widens upwards (1943.914).
- `taper` ignores `direction` (it always follows the normal). `taper` on an open curve is
  ignored.
- A taper that closes the profile before `amount` raises: 20x20 with `taper=56` and amount 10
  gives `ModelingError: extrude: the taper of 56 degrees closes the profile after 6.74509 of 10;
  use a smaller taper or a shorter extrusion`. Keep `|taper|` below
  `atan(half the smallest width / amount)`. The tapered result is checked (`ModelingError`
  on an inside-out or volume-less body).
- A positive extrusion from a face, subtracted from the part, removes nothing (the tool is
  outside). The volume stays the same and nothing is raised: check the volume after each cut.
- A sketch moved by `translate` or `Pos(...) *` keeps its normal; only `.on(...)`, `rotate`
  and the plane change it.

## Errors
- `ValueError: extrude amount must not be zero`.
- `ValueError: extrude: the taper must be between -90 and 90 degrees`.
- `ModelingError: extrude: the taper of 56 degrees closes the profile after 6.74509 of 10; use a smaller taper or a shorter extrusion`.
- `TypeError: expected a sketch, face or closed wire, got Part` (pass a face, not the part).
- `ValueError: a cylinder face has no plane; use normal_at() or a planar face` for curved faces.
- `KernelError: make face failed (SM_ERR): the wire must be planar and must not cross itself`
  when a closed wire crosses itself.

## Example
```python
plate = Rectangle(40, 30).extrude(5)                    # z 0..5
down = Rectangle(40, 30).extrude(-5)                    # z -5..0
slab = Rectangle(40, 30).extrude(5, both=True)          # z -5..5
wall = Rectangle(20, 10).on(Plane.front).extrude(5)     # Plane.front faces -Y: y -5..0
slant = Circle(5).extrude(20, direction=(0, 1, 2))      # 20 measured along the direction

box = Box(40, 30, 20)
top = box.faces().top()
box -= Rectangle(20, 10).on(top).extrude(-5)            # pocket 5 deep
print(box.is_valid(), round(box.volume, 3))             # True 23000.0

boss = Box(40, 30, 20)
boss += boss.faces().top()[0].extrude(5)                # grow the top face by 5
print(boss.bbox().max.z)                                # 15.0

core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)  # sides lean in by 3 degrees
ring = (Circle(10) - Circle(5)).extrude(10, taper=5)    # the hole widens where the outline narrows
print(round(ring.volume, 3))                            # 1943.914

sheet = extrude(CenterArc((0, 0), 10, 0, 180), 5)       # open curve -> Shell
print(type(sheet).__name__, round(sheet.area, 3))       # Shell 157.08
```

## Related
`revolve`, `loft`, `sweep`, `thicken` (surfaces to solids), `draft` (tilts faces of a finished part).
