# Wedge

A ramp: a prism whose cross section (in XZ) is a right triangle, or a right trapezoid with a
flat top.

## Signature

`Wedge(length, width, height, top_length=0.0, *, align=Align.CENTER)`

- `length` along X (the base), `height` along Z, `width` along Y (**see the first gotcha**).
- `top_length`: length of a flat top, measured from the −X end. 0 gives a sharp top edge.
- `align`: per axis, as for `Box` (bounding-box based).

## Returns

A `Part`. The high side is the vertical face at x = −length/2; the slope runs down to the edge
at x = +length/2, z = −height/2. `Wedge(20, 5, 8)`: bbox (−10, −5, −4)..(10, 5, 4), 5 faces,
volume 800. With `top_length` the top is flat from x = −length/2 to −length/2 + top_length
(6 faces).

## Gotchas

- **The width comes out doubled: Y spans −width..width.** `Wedge(20, 10, 8)` is 20 wide, volume
  1600. Pass half the width you want: `Wedge(20, 5, 8)` is 10 wide.
- The docstring says the ramp rises "at the back (+Y)". It does not: it rises towards −X. Turn
  it to face another way: `.mirror(Plane.YZ)` puts the high side at +X, `.rotate(Z, -90)` puts
  it at +Y (the back).
- No input checks: a negative length mirrors the ramp, a negative height turns it upside down,
  a negative width or top_length is ignored; `top_length == length` gives a box and
  `top_length > length` an overhang.
- Against a curved face: a face that only touches a cylinder makes an invalid fuse. Let the
  wedge reach into the other body.

## Errors

- `length == 0` or `height == 0`: `KernelError: sketch failed (SM_ERR)`.
- `width == 0`: `ValueError: extrude amount must not be zero`.

## Example

```python
# A ramp 20 long (X), 10 wide (Y), 8 high (Z): pass HALF the width
ramp = Wedge(20, 5, 8)
print(ramp.bbox(), round(ramp.volume, 3))           # x -10..10, y -5..5, z -4..4, volume 800
print(sorted({(round(v.x, 3), round(v.z, 3)) for v in ramp.vertices()}))  # top edge at x = -10

# Flat top 5 long, standing on XY
step = Wedge(20, 5, 8, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
print(step.bbox(), round(step.volume, 3))           # (20 + 5) / 2 * 8 * 10 = 1000

# Top edge at +X instead: mirror it
ramp_right = Wedge(20, 5, 8).mirror(Plane.YZ)
print(sorted({(round(v.x, 3), round(v.z, 3)) for v in ramp_right.vertices()}))
# Rising towards +Y (the back): turn it about Z
ramp_back = Wedge(20, 5, 8).rotate(Z, -90)
print(ramp_back.bbox(), sorted({(round(v.y, 3), round(v.z, 3)) for v in ramp_back.vertices()}))
```

A gusset next to a boss (high side against the boss, 1 mm into it):

```python
rib = Wedge(16, 2, 14, align=(Align.MIN, Align.CENTER, Align.MIN)).mirror(Plane.YZ).translate(-9, 0, 8)
```

(4 wide, x −25..−9, z 8..22; from scripts/17-realistic-block.py.)

## Related

`Box`, `sketches/Polygon` + `extrude` (any prism profile, exact width), `features/extrude`.
