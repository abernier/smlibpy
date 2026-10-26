# Cylinder

A solid circular cylinder with its axis along Z.

## Signature

`Cylinder(radius, height, *, arc_size=360.0, align=Align.CENTER)`

- `radius`, `height` in mm. There is no direction parameter (rotate it).
- `arc_size`: degrees, more than 0 and at most 360. Less than 360 makes a sector: the part from
  the +X axis counter-clockwise about +Z, closed by two planes through the axis (exact: one
  `cylinder` face, four planes). Within 0.01 degrees of 360 it is the whole cylinder.
- `align`: per axis, as for `Box` (bounding-box based). A sector is centered by its own box, so
  its axis moves off Z; `align=None` keeps the axis on Z (the sector of the centered cylinder).

## Returns

A `Part` with 3 faces (one cylindrical, two planar), 2 circular edges (`edges()`; plus one seam
with `edges(seams=True)`), 2 vertices. Default: axis on the Z axis, z −height/2..height/2.
`Cylinder(5, 20)`: bbox (−5, −5, −10)..(5, 5, 10).

The cylindrical face reports `face.radius` (5.0) and `face.axis` (origin at the bottom,
direction +Z).

## Gotchas

- To stand it on XY keep the axis on Z: `align=(Align.CENTER, Align.CENTER, Align.MIN)` → z 0..20.
  `align=Align.MIN` also shifts X and Y, so the axis ends up at (radius, radius).
- A centered cylinder reaches height/2 above and below its center. As a through-hole tool make it
  longer than the part is thick: `plate - Cylinder(3, 20)` for an 8 mm plate on z 0..8 cuts
  from z −10 to 10.
- Along another axis: rotate it. `Cylinder(3, 50).rotate(Y, 90)` lies along X (x −25..25).
- Sector: `Cylinder(10, 20, arc_size=90, align=None)` is the quarter from +X to +Y with its axis
  on Z (x, y 0..10); with the default align it is moved so its box is centered (x, y −5..5). A
  sector starting elsewhere: rotate it, `Cylinder(10, 20, arc_size=90, align=None).rotate(Z, 45)`.
  A tube sector is `AnnularSector`.
- A flat box face that only touches the side of a cylinder (tangent) makes the fuse raise
  `ModelingError`; let the bodies overlap. See `booleans`.

## Errors

- `radius <= 0` or `height <= 0`: `ValueError: radius and height must be positive`.
- `Cylinder(5, 10, angle=180)`: `TypeError: unexpected keyword argument 'angle'` (it is
  `arc_size`).
- `arc_size` 0, negative or above 360: `ValueError: Cylinder: arc_size must be more than 0 and at
  most 360 degrees, got 0`.

## Example

```python
pin = Cylinder(5, 20)                                                    # axis = Z, z -10..10
post = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))    # axis stays on Z, z 0..20
rod = Cylinder(3, 50).rotate(Y, 90)                                      # along X, x -25..25
half = Cylinder(10, 20, arc_size=180, align=None)                        # y >= 0, axis on Z
quarter = Cylinder(10, 20, arc_size=90)                                  # box centered: x, y -5..5
print(pin.bbox(), post.bbox(), rod.bbox(), half.bbox(), round(half.volume, 2))   # ... 3141.59
print(quarter.bbox(), sorted(f.geom_type for f in quarter.faces()))
```

## Related

`Hole` (a cylinder pointing down from the origin, for drilling), `Cone`, `AnnularSector`, `Box`, `booleans`,
`sketches/Circle` (`Circle(r).extrude(h)` for a cylinder on any plane).
