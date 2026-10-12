# Sphere

A full sphere centered on the origin.

## Signature

`Sphere(radius, *, align=Align.CENTER)`

- No angle parameters: there are no partial spheres. Cut one (see below).
- `align`: per axis, as for `Box` (bounding-box based).

## Returns

A `Part` with one spherical face. `Sphere(8)`: bbox −8..8 on every axis, volume 4/3·π·r³
(2144.661). `face.radius` is 8.

## Gotchas

- `sphere.edges()` is empty: the only edge is a seam (`edges(seams=True)` has 1). The two
  vertices are the poles (0, 0, ±r). Do not select sphere edges for fillets.
- `align=Align.MIN` puts the sphere in the positive octant (center at (r, r, r)). To sit it on
  XY use `(Align.CENTER, Align.CENTER, Align.MIN)`: center at (0, 0, r).
- Hemisphere or dome: intersect with a box,
  `Sphere(8) & Box(16, 16, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))` → z 0..8, volume
  1072.33. Fused onto a plate whose top is at z = 0 it gives one valid solid.
- A cap of another height: intersect with a box placed at the cut height.
  `Sphere(8) & Box(16, 16, 3, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 5)`
  is the top 3 mm (z 5..8, volume 197.92 = π·h²·(3r − h)/3).

## Errors

- `radius <= 0`: `ValueError: radius must be positive`.

## Example

```python
ball = Sphere(8)                                                         # -8..8
dome = Sphere(8) & Box(16, 16, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))  # z 0..8
print(ball.bbox(), dome.bbox(), round(dome.volume, 2))
```

## Related

`Torus`, `Cylinder`, `booleans` (`&` to trim), `features/revolve`.
