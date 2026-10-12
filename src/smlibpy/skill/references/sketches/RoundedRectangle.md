# RoundedRectangle

The older name of a rectangle with all four corners rounded: `RoundedRectangle(w, h, r)` is
`Rectangle(w, h, fillet=r)`. Write new code with `Rectangle(..., fillet=r)`.

## Signature
`RoundedRectangle(width, height, radius, *, align=Align.CENTER)`

## Returns
The same `Sketch` as `Rectangle(width, height, fillet=radius, align=align)`: bbox `±width/2`
by `±height/2`, 8 edges (4 lines, 4 quarter arcs), area `width*height - (4 - pi)*radius**2`.

## Radius limits
- `radius == min(width, height)/2`: the short sides vanish (a stadium of 4 edges).
- `radius > min(width, height)/2`: `ValueError: corner radius is larger than half the shorter
  side` (`Rectangle(..., fillet=...)` says which side).
- `radius <= 0`: a plain `Rectangle`, no error (`Rectangle(..., fillet=-1)` raises instead).

## Example
```python
outline = RoundedRectangle(80, 50, 6)                    # area 3969.0973
same = Rectangle(80, 50, fillet=6)                       # the new spelling
```

## Related
`Rectangle`, `Slot`, `fillet`.
