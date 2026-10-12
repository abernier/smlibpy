# Sketch.offset

Grows or shrinks a sketch region by a distance: every boundary moves outward (positive) or
inward (negative); holes move the other way. Lines stay lines and arcs stay arcs.

## Signature
`sketch.offset(distance, *, corners="round")` (also `offset(sketch, distance, corners=...)`)
- `distance > 0`: grow, holes shrink. `distance < 0`: shrink, holes grow. `0`: unchanged.
- `corners`: the corners the offset pulls apart (convex ones when growing, concave ones when
  shrinking): `"round"` (arcs of radius `|distance|`), `"sharp"` (the sides extended until
  they meet) or `"chamfer"` (cut straight across). Corners the offset pushes together are sharp
  in every style. `round=False` is the older spelling of `corners="sharp"`.

## Returns
A new `Sketch` on the same plane, with exact `line` and `circle` edges:
- `Rectangle(40, 20).offset(2)`: 8 edges, area 1052.5664 = 800 + 120*2 + 4*pi.
  `corners="sharp"`: 44 x 24, 4 lines. `corners="chamfer"`: 8 lines, area 1048.
- `offset(-2)`: 36 x 16 in every style (a rectangle has no concave corners).
- The L `Polygon((0, 0), (30, 0), (30, 8), (8, 8), (8, 25), (0, 25))` shrunk by 2: 172.8584
  round (its inner corner becomes an arc), 172 sharp, 174 chamfer.
- A ring `Circle(10) - Circle(5)` grown by 1: area 329.8673 = pi*(121 - 16), still 1 hole.
- Convex shapes grown with round corners follow Steiner's formula `area + perimeter*d + pi*d**2`
  exactly (pentagon, rounded rectangle, slot checked).
- Splines and ellipses go through the kernel's offset and come back as B-spline edges (round
  or sharp corners only).

## What changes shape
- Pieces that grow into each other merge: two circles 2 apart grown by 2 become 1 face.
- Shrinking splits thin necks: a dumbbell with a 2 wide bar shrunk by 1.5 becomes 2 faces.
- A hole closes when the offset reaches across it (a hole of radius 5 grown by 6 is gone; a
  10 x 10 square hole grown by 6 too).
- Shrinking keeps what is far enough from the boundary: the L shrunk by 4.5 leaves a sliver of
  0.2096 in its corner (the largest circle inside the L has radius 4.69).
- Shrinking that leaves nothing raises (below).

## Gotchas
- `outline.offset(w) - outline` is a band of width `w` outside (a gasket);
  `outline - outline.offset(-w)` one inside (a frame). For a band along an open path use
  `Stroke`.
- `corners="sharp"` at a very acute corner makes a long spike (the miter is `d / sin(angle/2)`).
- Every result is checked: each edge must lie at the offset distance from the original outline
  (closer only for chamfer cuts, farther only for sharp corners), on the right side. A result
  that fails raises instead of returning a wrong region.

## Errors
- `ModelingError: offset: shrinking by 10 removes the whole region; use a smaller distance`
  (`Rectangle(40, 20).offset(-10)`; `-9.9` still leaves a 20.2 x 0.2 sliver). Also when a wall
  vanishes exactly (the ring above shrunk by 2.5).
- `ValueError: offset: corners is 'round', 'sharp' or 'chamfer', not 'miter'`.
- `ModelingError: offset: chamfered corners need outlines of lines and arcs; ...` (ellipses,
  splines).

## Example
```python
outline = Rectangle(80, 50, fillet=6)
gasket = outline.offset(3) - outline                       # 3 wide band, area 777.3717
frame = outline - outline.offset(-4)                       # 4 wide frame inside
square = Rectangle(40, 20).offset(2, corners="sharp")      # 44 x 24
beveled = Rectangle(40, 20).offset(2, corners="chamfer")   # area 1048
```

## Related
`Stroke` (bands along paths), `fillet`, `chamfer`, `Part.offset` and `shell` (3D, features),
`generic`.
