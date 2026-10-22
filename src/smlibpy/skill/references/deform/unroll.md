# unroll

Lays a part wrapped around an axis out flat: the inverse of `bend` over the whole part. For
rolled sheet (a ring segment, a curl), a cylindrical label or a pattern on a cylinder that
must be developed flat.

## Signature
`unroll(shape, *, radius, axis=Z, start=None, tolerance=None)` or `part.unroll(radius=..., ...)`

- `radius`: the radius of the neutral layer, the one that keeps its length (mm, > 0). A
  point at distance r from the axis and at the angle a (radians) from `start` goes to distance
  r along `start` and `radius * a` across: material inside the neutral layer gets longer,
  outside it shorter. For sheet metal: inside radius + K-factor * thickness (`unfold` does
  that itself).
- `axis`: the `Axis` the part is rolled about (default the world Z axis through the origin).
- `start`: a direction across the axis (perpendicular to it): the line that stays in place;
  the flat part lies in the plane through it perpendicular to `start`. Default: the middle of
  the part's angle about the axis.
- `tolerance`: largest distance of fitted faces from the exact unroll (mm, default 1e-6).

## Returns
An `Edge`, `Wire` or point gives an `Edge`, `Wire` or `Vector` (a helix of less than one turn
about the axis unrolls at its radius into a line; see `deform/curves`). A `Part` (`Shell` for a
shell). Cylinders about the axis become exact planes, circles about it
lines, faces through the axis planes; other faces (a hole in the ring) are NURBS within the
tolerance. A ring segment of inside radius 50, thickness 2 and 270° unrolled at 51 is a plate
of 6 planes, 51 * 3 pi / 2 = 240.33 long; its volume is kept when `radius` is the middle of the
thickness, otherwise each layer at distance r changes by radius / r.

## Gotchas
- The part must not reach the axis and must cover less than a full turn about it: cut a
  closed ring open first (a slit along the axis). It must not reach the half-plane opposite
  `start` either, where the flat part would tear.
- The default `start` is the middle of the part, so the flat part extends to both sides of
  that line; give `start` to keep another line in place.
- `unroll` maps the whole part. To flatten a rolled sheet metal part, or a bend at the end of
  a sheet with the flat part kept, use `unfold` / `flat_pattern` (they pick the neutral radius
  and the side that stays).

## Errors
- `ValueError: unroll: radius must be a positive number ...`, `TypeError: unroll: axis must be
  an Axis`, `ValueError: unroll: start must be a direction across the axis ...`.
- `ModelingError: unroll: the part reaches the axis ...`; `... the part goes all the way around
  the axis; cut it open ...`; `... the part reaches the line opposite start ...`.

## Example
```python
ring = Cylinder(52, 40) - Cylinder(50, 50) - Box(60, 60, 50, align=(Align.MIN, Align.MIN, Align.CENTER))
strip = ring.unroll(radius=51)                       # 270 degrees of ring, flat
print(len(strip.faces().planar()), round(strip.volume, 3), round(ring.volume, 3))

seg = (Cylinder(52, 40) - Cylinder(50, 50)) & Box(60, 60, 40, align=(Align.MIN, Align.MIN, Align.CENTER))
flat = seg.unroll(radius=51, start=(1, 0, 0))        # the line along +X stays
print(flat.bbox())

label = Cylinder(30, 50) - Cylinder(29, 60) - Box(4, 40, 60, align=(Align.CENTER, Align.MIN, Align.CENTER))
print(label.unroll(radius=30).bbox().size)           # slit at +Y; the outside keeps its length
```
prints `6 19226.547 19226.547`; x 50..52, y 0..80.111, z -20..20; `184.493 x 1 x 50` (the
label's outside, 30 * (2 pi - 2 asin(2 / 30)), developed).

## Related
`bend` (the inverse), `deform/generic`, `sheetmetal/unfold` (rolled sheet metal parts),
`sheetmetal/flat_pattern`.
