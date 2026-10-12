# Box

A rectangular block, edges parallel to the world axes.

## Signature

`Box(length, width, height, *, align=Align.CENTER)`

- `length` along X, `width` along Y, `height` along Z. mm.
- `align`: one `Align` for all axes, or a tuple per axis `(x, y, z)`. See below.

## Returns

A `Part` with 6 planar faces, 12 edges, 8 vertices. Centered on the origin by default:
`Box(40, 30, 10)` spans x −20..20, y −15..15, z −5..5.

## Align

`align` moves the box by its bounding box, per axis:

| Value | Axis range |
|---|---|
| `Align.CENTER` (default), `None` | −size/2..size/2 |
| `Align.MIN` | 0..size (the box starts at the origin) |
| `Align.MAX` | −size..0 (the box ends at the origin) |

- Strings work too, case-insensitive: `"min"`, `"center"`, `"MAX"`.
- `(Align.CENTER, Align.CENTER, Align.MIN)` stands the box on the XY plane: the usual base plate.
- A tuple with two values aligns X and Y; Z stays centered. Extra values are ignored.
- `None` in a tuple means "no move" on that axis, which for a box is the same as CENTER.
- A wrong string raises `ValueError: 'bottom' is not a valid Align`.

## Gotchas

- `Align.MIN` alone moves all three axes: the box sits in the positive octant, not only on XY.
- Faces of a fresh box: top at z = +height/2 with normal +Z, front at y = −width/2 with normal −Y.
  Select them with `box.faces().top()`, `.front()`, ... rather than by index.
- No rotation parameter. Turn it afterwards: `Box(...).rotate(Z, 30)`.
- A size below the kernel tolerance (1e-7) is not refused: you get a part of almost no
  volume that `is_valid()` rejects.

## Errors

- Zero or negative size: `ValueError: box dimensions must be positive` (a `ValueError`, not a
  `ModelingError`).
- A string size: `TypeError`.

## Example

```python
block = Box(40, 30, 10)                                                  # x -20..20, y -15..15, z -5..5
plate = Box(80, 60, 6, align=(Align.CENTER, Align.CENTER, Align.MIN))    # z 0..6, stands on XY
corner = Box(10, 10, 10, align=Align.MIN)                                # 0..10 on every axis
print(block.bbox(), plate.bbox(), corner.bbox())
```

## Related

`Cylinder`, `Wedge`, `generic` (Part), `booleans`, `features/fillet`, `geometry/Align`.
