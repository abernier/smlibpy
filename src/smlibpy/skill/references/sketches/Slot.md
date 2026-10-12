# Slot

An obround (stadium): two half circles joined by straight sides, centered on the origin and
lying along X. For the other slots see the table.

## Signature
`Slot(length, width, *, rotation=0.0, align=Align.CENTER)`
- `length`: overall length, round ends included (not center to center).
- `width`: the diameter of the ends.
- `rotation`: degrees counter-clockwise about the center; keyword only.
- `align` works on the bbox after the rotation.

## Returns
A `Sketch` with 4 edges (line, arc, line, arc). The arc centers are at x = ±(length - width)/2.
Area `(length - width)*width + pi*width**2/4` (`Slot(30, 8)`: 226.2655).

## Which slot
| slot | call |
|---|---|
| straight, overall length, centered | `Slot(length, width)` |
| center-to-center distance `c` | `Slot(c + width, width)` |
| between two centers `a` and `b` (anywhere) | `Stroke(Line(a, b), width)` |
| along an arc around the origin | `ArcSlot(radius, width, angle, rotation=start)` |
| along any path of lines and arcs | `Stroke(path, width)` |

## Gotchas
- `length <= width` (or a negative length) silently gives a `Circle` of diameter `width`.
- `Rectangle(length, width, fillet=width / 2)` is the same region with 4 edges too.

## Errors
- `ValueError: radius must be positive`: `width` is zero or negative.
- `TypeError: Slot() takes 2 positional arguments but 3 were given`: pass `rotation=` by name.

## Example
```python
plate = Box(60, 40, 8)
cut = plate - Slot(30, 8, rotation=90).on(plate.faces().top()).extrude(-8)   # vertical through slot
c2c = Slot(20 + 6, 6)                                   # arc centers at x = -10 and 10
between = Stroke(Line((10, 5), (40, 20)), 6)            # centers (10, 5) and (40, 20), area 229.5205
```

## Related
`ArcSlot`, `Stroke`, `Rectangle` (`fillet=width/2`), `Circle`, `Hull` (tapered slots between
circles of different sizes).
