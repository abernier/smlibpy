# AnnularSector

A sector of a tube along Z: the solid between two radii from the Z axis, over an angle.

## Signature

`AnnularSector(inner_radius, outer_radius, height, arc_size, *, align=Align.CENTER)`

- `inner_radius`, `outer_radius`: from the Z axis, `0 <= inner_radius < outer_radius`. An inner
  radius of 0 gives a sector of a cylinder (`Cylinder(outer_radius, height, arc_size=...)`).
- `height`: along Z, positive.
- `arc_size`: degrees, more than 0 and at most 360, from the +X axis counter-clockwise about +Z.
  Within 0.01 degrees of 360 it is the whole tube.
- `align`: per axis, as for `Box` (bounding-box based): centered by its own box. `align=None`
  keeps the axis on Z (z −height/2..height/2).

## Returns

A `Part` with exact faces (the section revolved): two `cylinder` faces (inside and outside) and
four planes (two ends, two sides); a whole tube has two planes. STEP files carry the cylinders as
`CYLINDRICAL_SURFACE`. `AnnularSector(5, 10, 20, 120, align=None)`: volume
π·(10² − 5²)·20/3 = 1570.796, bbox x −5..10, y 0..10, z −10..10.

## Gotchas

- The default align centers the box, not the axis: `AnnularSector(5, 10, 20, 90)` has its axis
  at (−5, −5). Pass `align=None` (or `(None, None, Align.MIN)` to stand it on XY with the axis on
  Z) to place it by its axis.
- A sector starting at another angle: rotate it about Z, with `align=None` so the axis stays on Z.

## Errors

- `ValueError: AnnularSector: need 0 <= inner_radius < outer_radius and a positive height`.
- `ValueError: AnnularSector: arc_size must be more than 0 and at most 360 degrees, got 0`.

## Example

```python
arc = AnnularSector(5, 10, 20, 120, align=None)                          # axis on Z
print(round(arc.volume, 3), sorted(f.geom_type for f in arc.faces()))    # 1570.796 ['cylinder', 'cylinder', 'plane', ...]
segment = AnnularSector(40, 50, 8, 30, align=(None, None, Align.MIN)).rotate(Z, -15)  # centred on +X, on XY
ring = AnnularSector(5, 10, 20, 360)                                     # a whole tube
print(segment.bbox(), round(ring.volume, 3))
```

## Related

`Cylinder` (`arc_size`), `Torus` (`major_angle`), `features/revolve` (a rectangle revolved by an
angle is the same body), `PolarLocations` (to repeat sectors around the axis).
