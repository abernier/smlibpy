# Sketch.offset

Grows or shrinks a sketch region by a distance: every boundary moves outward (positive) or
inward (negative). Holes move the opposite way.

## Signature
`sketch.offset(distance, *, round=True)`
- `distance > 0`: grow; holes shrink. `distance < 0`: shrink; holes grow. `0` returns the
  sketch unchanged.
- `round=True`: corners that the offset pulls apart get arcs of radius `|distance|` (convex
  corners when growing, concave corners when shrinking). `round=False`: the sides are extended
  to sharp corners. Corners that the offset pushes together are sharp either way.

## Returns
A new `Sketch` on the same plane. Areas match the formulas: `Rectangle(40, 20).offset(2)` is
800 + 120·2 + 4π; `offset(2, round=False)` is 44 x 24; `offset(-2)` is 36 x 16.
Circles, ellipses, slots and splines offset as expected (an ellipse 15 x 8 grown by 2 has a
bbox of ±17 x ±10).

## Gotchas
- **Every edge of the result is a B-spline**, also the straight ones and the arcs.
  `s.edges().lines()` and `.circles()` find nothing, and `s.fillet(r)` afterwards silently does
  nothing. Fillet first and offset after (arcs grow or shrink with the offset), or build the
  smaller shape from a constructor. Extruded, the faces are still planes and cylinders.
- With `round=False` each grown corner keeps two short extra edges (12 edges for a grown
  rectangle instead of 4); the shape is right.
- Several pieces grow into each other and fuse (two circles 2 apart grown by 2 become one
  face). Shrinking can split a region (a dumbbell with a thin bar becomes 2 faces).
- A hole closes when the offset reaches it (a hole of radius 5 grown by 5 is gone).
- Shrinking a region with a hole until the wall vanishes returns an empty sketch with no
  error; shrinking a region without holes until it vanishes raises (below).
- `outline - outline.offset(-w)` is the usual way to make a frame or gasket of width `w`.

## Errors
- `ValueError: the offset removes the whole sketch`: the inward offset is at least half the
  smallest width (`Rectangle(40, 20).offset(-10)`). `offset(-9.9)` still works (a 20.2 x 0.2 sliver).

## Example
```python
outline = RoundedRectangle(60, 40, 6)
gasket = outline - outline.offset(-4)                # a 4 wide frame, inner corners radius 2
clearance = outline.offset(0.5)                      # 0.5 larger all round
square = Rectangle(40, 20).offset(2, round=False)    # 44 x 24, sharp corners
```

## Related
`fillet` (round chosen corners), `Part.offset` and `shell` (3D, features), `generic`.
