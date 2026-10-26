# Sphere

A sphere centered on the origin, or a part of one.

## Signature

`Sphere(radius, *, arc_size1=-90.0, arc_size2=90.0, arc_size3=360.0, align=Align.CENTER)`

- `arc_size1`, `arc_size2`: the latitudes (degrees, −90 the bottom pole, 90 the top) it reaches
  from and to; planes parallel to XY cut it there. `-90 <= arc_size1 < arc_size2 <= 90`.
- `arc_size3`: the longitude it spans (degrees, at most 360), from the +X axis counter-clockwise
  about +Z, closed by planes through the Z axis.
- `align`: per axis, as for `Box` (bounding-box based). A part of a sphere is centered by its own
  box; `align=None` keeps the sphere's center at the origin.

## Returns

A `Part` with one spherical face. `Sphere(8)`: bbox −8..8 on every axis, volume 4/3·π·r³
(2144.661). `face.radius` is 8.

## Gotchas

- `sphere.edges()` is empty: the only edge is a seam (`edges(seams=True)` has 1). The two
  vertices are the poles (0, 0, ±r). Do not select sphere edges for fillets.
- `align=Align.MIN` puts the sphere in the positive octant (center at (r, r, r)). To sit it on
  XY use `(Align.CENTER, Align.CENTER, Align.MIN)`: center at (0, 0, r).
- Hemisphere or dome: `Sphere(8, arc_size1=0, align=None)` → z 0..8, volume 1072.33 (a sphere
  face and a plane). The default align centers its box (z −4..4). Fused onto a plate whose top is
  at z = 0 it gives one valid solid.
- A cap of another height: the latitude where it starts, `asin(5 / 8)` for the top 3 mm:
  `Sphere(8, arc_size1=math.degrees(math.asin(5 / 8)), align=None)` is z 5..8, volume 197.92
  (π·h²·(3r − h)/3). Intersecting with a box gives the same.
- A part of a sphere is exact (a `sphere` face and planes), also with all three angles.

## Errors

- `radius <= 0`: `ValueError: radius must be positive`.
- `ValueError: Sphere: need -90 <= arc_size1 < arc_size2 <= 90 (latitudes in degrees), got 30 and 30`.
- `ValueError: Sphere: arc_size3 must be more than 0 and at most 360 degrees, got 0`.

## Example

```python
ball = Sphere(8)                                                         # -8..8
dome = Sphere(8, arc_size1=0, align=None)                                # z 0..8
cap = Sphere(8, arc_size1=math.degrees(math.asin(5 / 8)), align=None)     # z 5..8
lune = Sphere(8, arc_size3=90, align=None)                               # x, y >= 0
print(ball.bbox(), dome.bbox(), round(dome.volume, 2), round(cap.volume, 2), round(lune.volume, 2))
```

## Related

`Torus`, `Cylinder`, `booleans` (`&` to trim), `features/revolve`.
