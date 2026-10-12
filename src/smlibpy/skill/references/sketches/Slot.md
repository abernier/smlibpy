# Slot

An obround (stadium): two half circles joined by straight sides, centered on the origin and
lying along X.

## Signature
`Slot(length, width, *, rotation=0.0, align=Align.CENTER)`
- `length`: overall length, round ends included (not center to center).
- `width`: the diameter of the ends.
- `rotation`: degrees counter-clockwise about the center; keyword only.
- `align` works on the bbox after the rotation.

## Returns
A `Sketch` with 4 edges (line, arc, line, arc). The arc centers are at x = ±(length - width)/2.
Area `(length - width)*width + pi*width**2/4`.

## Variants
smlibpy has only this one slot. Build the others from it:
- Center-to-center distance `c`: `Slot(c + w, w)`.
- From point `p` to point `q`: `Pos((p + q) / 2) * Slot((q - p).length + w, w, rotation=angle)`,
  `angle = math.degrees(math.atan2(dy, dx))`.
- Arc slot: `make_face` of a wire of four `CenterArc`s (example below).

## Gotchas
- `length <= width` (or a negative length) silently gives a `Circle` of diameter `width`.

## Errors
- `ValueError: radius must be positive`: `width` is zero or negative.
- `TypeError: Slot() takes 2 positional arguments but 3 were given`: pass `rotation=` by name.

## Example
```python
plate = Box(60, 40, 8)
cut = plate - Slot(30, 8, rotation=90).on(plate.faces().top()).extrude(-8)   # vertical through slot

c2c = Slot(20 + 6, 6)                       # arc centers at x = -10 and 10

R, w = 30, 6                                # arc slot: centerline radius 30, 0..90 degrees
ri, ro = R - w / 2, R + w / 2
outline = Wire([
    CenterArc((0, 0), ro, 0, 90),
    CenterArc((0, R), w / 2, 90, 180),
    CenterArc((0, 0), ri, 90, -90),
    CenterArc((R, 0), w / 2, 180, 180),
])
arc_slot = make_face(outline)
```

## Related
`RoundedRectangle` (`radius = width/2` is the same region, 6 edges), `Circle`, `make_face`,
`CenterArc` (curves).
