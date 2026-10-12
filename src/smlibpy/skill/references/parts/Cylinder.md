# Cylinder

A solid circular cylinder with its axis along Z.

## Signature

`Cylinder(radius, height, *, align=Align.CENTER)`

- `radius`, `height` in mm. There is no `angle` parameter (no partial cylinders) and no
  direction parameter.
- `align`: per axis, as for `Box` (bounding-box based).

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
- Partial cylinder: intersect with a box, or revolve a rectangle:
  `Cylinder(10, 20) & Box(20, 20, 20, align=(Align.CENTER, Align.MIN, Align.CENTER))` is the half
  with y ≥ 0; `Rectangle(10, 20, align=(Align.MIN, Align.CENTER)).on(Plane.front).revolve(Z, 90)`
  is the quarter from +X to +Y.
- A flat box face that only touches the side of a cylinder (tangent) makes the fuse raise
  `ModelingError`; let the bodies overlap. See `booleans`.

## Errors

- `radius <= 0` or `height <= 0`: `ValueError: radius and height must be positive`.
- `Cylinder(5, 10, angle=180)`: `TypeError: unexpected keyword argument 'angle'`.

## Example

```python
pin = Cylinder(5, 20)                                                    # axis = Z, z -10..10
post = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))    # axis stays on Z, z 0..20
rod = Cylinder(3, 50).rotate(Y, 90)                                      # along X, x -25..25
half = Cylinder(10, 20) & Box(20, 20, 20, align=(Align.CENTER, Align.MIN, Align.CENTER))  # y >= 0
print(pin.bbox(), post.bbox(), rod.bbox(), half.bbox(), round(half.volume, 2))
```

## Related

`Hole` (a cylinder pointing down from the origin, for drilling), `Cone`, `Box`, `booleans`,
`sketches/Circle` (`Circle(r).extrude(h)` for a cylinder on any plane).
