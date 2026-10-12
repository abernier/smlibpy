# Circle

A disk of `radius` on the XY plane, centered on the origin.

## Signature
`Circle(radius, *, align=Align.CENTER)`
`radius`, not diameter. `align` as for `Rectangle` (works on the bbox: `Align.MIN` puts the
disk at 0..2r in x and y).

## Returns
A `Sketch` with 1 face and 1 edge of type `circle` (one vertex at (radius, 0, 0)).
Extruded it gives a cylinder with 3 faces.

## Gotchas
- The usual way to drill holes into a sketch: `outline - Circle(r).translate(x, y)` or
  `outline - GridLocations(...) * Circle(r)`.
- On a face, the circle is centered on the face's area centroid; move it first with
  `Pos(x, y) * Circle(r)` to put it elsewhere (see `generic`).
- For a round hole in a part, `Hole` (parts) is shorter than `Circle(r).on(face).extrude(-d)`.

## Errors
- `ValueError: radius must be positive`: zero or negative radius.

## Example
```python
ring = Circle(10) - Circle(6)                            # 1 face, 1 inner wire, area pi*(100-36)
disk = Circle(10, align=Align.MIN)                       # bbox (0, 0)..(20, 20)
washer = ring.extrude(2)
```

## Related
`Ellipse`, `Slot`, `RegularPolygon`, `generic` (Booleans), `Hole` (parts).
