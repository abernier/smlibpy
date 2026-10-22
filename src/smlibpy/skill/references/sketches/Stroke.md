# Stroke

The region a pen of a given width covers along a path: a slot between two centers, a slot along
an arc, a rib or web from its centerline, a track, a groove along a spline.

## Signature
`Stroke(path, width, *, ends="round", corners="round")`
- `path`: an `Edge` or a `Wire`: `Line(a, b)`, `CenterArc(...)`, `Polyline(...)`,
  `Profile(...).wire()`, `Spline(...)`, `EllipticalArc(...)`, mixes of them. It must be
  connected and lie in one plane.
- `width`: the full width; the region reaches `width/2` to each side of the path.
- `ends`: `"round"` (half circles around the end points) or `"flat"` (cut square at the end
  points, no extension).
- `corners`: the outside of each bend of the path: `"round"`, `"sharp"` (sides extended until
  they meet) or `"chamfer"` (cut straight across). The inside of a bend is always sharp.

## Returns
A `Sketch` on the path's plane (a path in XY gives a sketch on XY): exact lines and arcs along
lines and arcs; along splines and ellipses their offsets (`curves/offset`), within 1e-6 of the
path's size.
- `Stroke(Line((10, 5), (40, 20)), 6)`: area 229.5205 = length*6 + 9*pi.
- Path `line 20, arc r 10 over 90°, line up 15` (length 50.708), width 4: area 215.3982 with
  round ends, 202.8319 with flat ends (= length*width).
- An L of two 20 mm legs, width 4, flat ends: 159.1416 round, 160 sharp, 158 chamfered corner.
- A closed path gives a ring: `Stroke(CenterArc((0, 0), 10, 0, 360), 2)` = 1 face, 1 hole,
  area 125.6637.
- A path that crosses itself gives one region; enclosed areas become holes (splines too).
- `Stroke(Spline((0, 0), (20, 8), (40, 0)), 4)`: area 188.283 = length*4 + 4*pi.

## Gotchas
- `Profile` paths: pass `profile.wire()`, not the Profile.
- An arc tighter than half the width fills its center (no inner edge). A spline or ellipse that
  bends more tightly than half the width raises (`ModelingError: Stroke: the bspline bends more
  tightly than the distance 1 near (...)`; check `path.min_radius()`), and so does a closed path
  with splines and `corners="chamfer"`.

## Errors
- `ModelingError: Stroke: the path has a gap of 1 between edge 1 and edge 2`.
- `TypeError: Stroke: the path is an Edge or a Wire, not a Profile (call .wire() on a Profile)`.
- `ValueError: Stroke: the width must be positive (got 0.0)`.

## Example
```python
between = Stroke(Line((10, 5), (40, 20)), 6)            # a slot between two centers
path = Profile((0, 0)).line_to(20, 0).arc(10, 90).line_to(y=25).wire()
band = Stroke(path, 4)                                   # area 215.3982
rib = Stroke(Polyline((0, 0), (30, 0), (30, 20)), 3, ends="flat", corners="sharp").extrude(10)   # volume 1500
```

## Related
`Slot`, `ArcSlot`, `Profile` (`wire()`), `offset` (bands around regions), `curves/offset`
(one side of the band), `Hull`.
