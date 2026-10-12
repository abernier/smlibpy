# Wedge

A ramp: a prism whose cross section (in XZ) is a right triangle, or a right trapezoid with a
flat top.

## Signature

`Wedge(length, width, height, top_length=0.0, *, align=Align.CENTER)`

- `length` along X (the base), `width` along Y, `height` along Z. All positive.
- `top_length`: length of a flat top, measured from the −X end. 0 gives a sharp top edge;
  `0 <= top_length < length`.
- `align`: per axis, as for `Box` (bounding-box based).

## Returns

A `Part`. The high side is the vertical face at x = −length/2; the slope runs down towards +X,
to the edge at x = +length/2, z = −height/2. `Wedge(20, 10, 8)`: bbox (−10, −5, −4)..(10, 5, 4),
5 faces, volume 800. With `top_length` the top is flat from x = −length/2 to
−length/2 + top_length (6 faces).

## Gotchas

- The high side is at −X. Turn it to face another way: `.mirror(Plane.YZ)` puts the high side
  at +X, `.rotate(Z, -90)` puts it at +Y (the back).
- For `top_length == length` use a `Box`.
- Against a curved face: a face that only touches a cylinder makes the fuse raise. Let the
  wedge reach into the other body.

## Errors

- `ValueError: wedge length, width and height must be positive`
- `ValueError: wedge top_length must be at least 0 and less than the length`

## Example

```python
# A ramp 20 long (X), 10 wide (Y), 8 high (Z)
ramp = Wedge(20, 10, 8)
print(ramp.bbox(), round(ramp.volume, 3))           # x -10..10, y -5..5, z -4..4, volume 800.0
print(sorted({(round(v.x, 3), round(v.z, 3)) for v in ramp.vertices()}))  # [(-10.0, -4.0), (-10.0, 4.0), (10.0, -4.0)]: top edge at x = -10

# Flat top 5 long, standing on XY
step = Wedge(20, 10, 8, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
print(step.bbox(), round(step.volume, 3))           # z 0..8, (20 + 5) / 2 * 8 * 10 = 1000.0

# Top edge at +X instead: mirror it
ramp_right = Wedge(20, 10, 8).mirror(Plane.YZ)
print(sorted({(round(v.x, 3), round(v.z, 3)) for v in ramp_right.vertices()}))  # [(-10.0, -4.0), (10.0, -4.0), (10.0, 4.0)]
# Rising towards +Y (the back): turn it about Z
ramp_back = Wedge(20, 10, 8).rotate(Z, -90)
print(sorted({(round(v.y, 3), round(v.z, 3)) for v in ramp_back.vertices()}))   # [(-10.0, -4.0), (10.0, -4.0), (10.0, 4.0)]
```

A gusset next to a boss (high side against the boss, 1 mm into it):

```python
rib = Wedge(16, 4, 14, align=(Align.MIN, Align.CENTER, Align.MIN)).mirror(Plane.YZ).translate(-9, 0, 8)
```

(4 wide, x −25..−9, z 8..22, high side at x = −9.)

## Related

`Box`, `sketches/Polygon` + `extrude` (any prism profile), `features/extrude`.
