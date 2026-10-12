# ArcSlot

A slot along an arc around the origin, with round ends: adjustment slots, slots on a bolt
circle, curved guides.

## Signature
`ArcSlot(radius, width, angle, *, rotation=0, align=None)`
- `radius`: the radius of the slot's centerline (the arc through the middle of the slot).
- `width`: the slot width (the diameter of the round ends).
- `angle`: the angular span of the centerline in degrees, counterclockwise from the X axis.
- `rotation`: where the span starts (degrees counterclockwise from X): the slot covers
  `rotation .. rotation + angle`.
- `align=None` keeps the arc's center on the origin (so patterns and placements turn about
  it); `Align.CENTER` centers the bbox instead.

## Returns
A `Sketch` with 4 `circle` edges (outer arc, end cap, inner arc, end cap).
Area `radius * radians(angle) * width + pi * width**2 / 4`:
`ArcSlot(30, 6, 90)` has area 311.0177 and bbox (-3, -3)..(33, 33).

## Gotchas
- `angle` is measured on the centerline; the round ends reach `width/2` beyond it.
- For slots around another center: `Pos(cx, cy) * ArcSlot(...)`. On a part: `.on(face)`
  (then the center sits on the face's centroid, see `generic`).
- Three slots on a circle: `PolarLocations(0, 3) * ArcSlot(35, 6, 60, rotation=-30)`.

## Errors
- `ValueError: ArcSlot: a slot 8 wide needs a centerline radius above 4 (the inner edge would
  pass the center)`.
- `ValueError: ArcSlot: at radius 20 and width 6 the round ends meet for angles above 342.7461;
  use a smaller angle, or a ring: Circle(r + w/2) - Circle(r - w/2)`.
- `ValueError: ArcSlot: the angle is between 0 and 360 degrees (got 0)`.

## Example
```python
slot = ArcSlot(30, 6, 90)                                # area 311.0177
flange = Circle(50) - Circle(20) - PolarLocations(0, 3) * ArcSlot(35, 6, 60, rotation=-30)
plate = flange.extrude(8)                                # 1 face with 4 holes before extruding
```

## Related
`Slot`, `Stroke` (slots along any path), `PolarLocations` (geometry), `CenterArc` (curves).
