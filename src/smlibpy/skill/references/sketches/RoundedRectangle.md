# RoundedRectangle

A rectangle with all four corners rounded to the same radius, centered on the origin.

## Signature
`RoundedRectangle(width, height, radius, *, align=Align.CENTER)`
`width` along X, `height` along Y, `radius` of the corner arcs. `align` as for `Rectangle`.

## Returns
A `Sketch`, bbox `±width/2` by `±height/2`, 8 edges (4 lines, 4 quarter arcs).
Area `width*height - (4 - pi)*radius**2`.

## Radius limits
- `0 < radius < min(width, height)/2`: the normal case.
- `radius == min(width, height)/2`: allowed. The short sides vanish: a stadium (6 edges, same
  area as `Slot(width, height)`), or a full circle of 4 arcs for a square.
- `radius > min(width, height)/2`, even by 1e-7: `ValueError`.
- `radius <= 0`: a plain `Rectangle`, no error. A negative radius is not caught.

## Gotchas
- For a stadium, prefer `Slot(length, width)`: 4 edges instead of 6.
- Only all four corners at one radius. For different radii or some corners, use
  `Rectangle(...).fillet(r, vertices=[...])` (see `fillet`).

## Errors
- `ValueError: corner radius is larger than half the shorter side`. Also raised for a zero
  width with a positive radius.
- `ValueError: rectangle sides must be positive`: zero or negative side with `radius <= 0`.

## Example
```python
outline = RoundedRectangle(80, 50, 8)                    # area 4000 - (4 - pi) * 64
plate = (outline - GridLocations(64, 34, 2, 2) * Circle(3)).extrude(6)
stadium = RoundedRectangle(40, 20, 10)                   # same region as Slot(40, 20)
```

## Related
`Rectangle`, `Slot`, `fillet` (round chosen corners), `offset`.
