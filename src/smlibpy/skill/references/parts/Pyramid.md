# Pyramid

A pyramid on a rectangle: five planes.

## Signature

`Pyramid(length, width, height, *, align=Align.CENTER)`

- `length` (X) by `width` (Y): the rectangle at the bottom; `height` (Z): the apex above the
  rectangle's center. All positive.
- `align`: per axis, as for `Box` (bounding-box based).

## Returns

A `Part` of five plane faces, volume `length * width * height / 3`. `Pyramid(10, 6, 8)`: bbox
x −5..5, y −3..3, z −4..4 (the apex at z 4).

## Gotchas

- Centered by its box, so the base is at `-height / 2`: `align=(Align.CENTER, Align.CENTER,
  Align.MIN)` sets it on XY.
- For a frustum (a cut-off pyramid) extrude the rectangle with a taper:
  `Rectangle(10, 6).extrude(4, taper=20)`.

## Errors

- `ValueError: pyramid length, width and height must be positive`

## Example

```python
p = Pyramid(10, 6, 8)
print(round(p.volume, 6), len(p.faces()), p.bbox())        # 160.0 5 ...
standing = Pyramid(10, 10, 12, align=(Align.CENTER, Align.CENTER, Align.MIN))
print(standing.bbox().min.z, standing.bbox().max.z)         # 0.0 12.0
```

## Related

`Box`, `Wedge`, `Cone`, `features/extrude` (`taper=`).
