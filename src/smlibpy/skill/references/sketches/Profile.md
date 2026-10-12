# Profile

A pen that draws one outline in the XY plane, segment by segment, with exact lines and arcs.
Use it for outlines that are awkward as unions of shapes: revolve sections, brackets with
rounded inner corners, anything with tangent arcs, sweep paths.

## Signature
`Profile(start=(0, 0), *, heading=0)`
- `start`: a 2D point. `heading`: the direction the pen moves in, degrees counterclockwise
  from +X (90 = +Y, -90 = -Y).
- Every call returns a **new** Profile; the old one is unchanged, so variants can branch from
  a common start.

## Moves
| call | draws |
|---|---|
| `line_to(x, y)` / `line_to((x, y))` | a line to the point |
| `line_to(x=30)` / `line_to(y=5)` | a line to that x (y stays: horizontal) or that y (vertical) |
| `line_by(dx, dy)` | a line by an offset |
| `forward(length)` | a line along the heading |
| `forward(x=30)` / `forward(y=5)` | along the heading until x (or y) reaches the value |
| `turn(angle)` / `turn_to(heading)` | no drawing: the next segment starts at a corner |
| `arc(radius, angle)` | tangent arc; positive angle turns left, negative right; `arc(3, 180)` is a U-turn |
| `arc_to(x, y)` | tangent arc ending at the point |
| `arc_to(x, y, through=(px, py))` | arc through a point (not tangent: a corner at its start if the heading differs) |
| `fillet(radius)` / `chamfer(length)` | round or bevel the corner **at the pen**: between the segment just drawn and the next one |
| `mirror(axis)` | append the mirror image of everything drawn, so the whole outline is symmetric |

After a line the heading is the line's direction, after an arc its end tangent. `p.point`
(Vector) and `p.heading` (degrees, -180..180) say where the pen is; `len(p)` counts segments.

## Results
- `close(*, align=None)` -> `Sketch` on XY: a straight line goes back to the start if the pen
  is not there. The outline stays where it was drawn (`align` moves it, e.g. `Align.CENTER`).
  Drawing clockwise is fine.
- `wire()` -> open `Wire` of `line` and `circle` edges, for `sweep` paths and `Stroke`.
- A Profile is not a shape: `profile.extrude(5)` raises `AttributeError: ... Call .close()
  for the region (a Sketch) or .wire() for the open path`.

## Corners
- `fillet(r)` / `chamfer(d)` right after the move that ends at the corner. Called before the
  first move, they round the **start** corner (between the closing line and the first
  segment).
- Corners between lines and arcs work too (exact tangent arcs). A corner where the segments
  meet tangentially has nothing to round: error.
- `chamfer(d)` cuts back `d` along both segments (measured along them) and joins the points.

## mirror(axis)
- `axis`: `X`, `Y` or `Axis((x, y), direction)` in the XY plane.
- Draw half the outline from the axis back to the axis, then `.mirror(Y).close()`. An end that
  is off the axis is joined straight across to its mirror image (a half drawn from (5, 0) to
  (5, 10) closes with lines across the axis).
- Corners rounded on the half are rounded on the mirror half too. Where the half meets the
  axis at a right angle, the two lines merge into one edge.
- The result is still a Profile: close it, or draw on.

## Gotchas
- The pen draws in XY. Place the result: `section.close().on(Plane.XZ)`.
- `line_to(x=30)` keeps y; `forward(x=30)` follows the heading (same only for heading 0/180).
- `turn` changes only the heading for `forward`, `arc` and `arc_to(x, y)`; `line_to`
  ignores it.
- `close()` checks the outline: a crossing, a touching, or a doubling back raises and names
  both segments by the call that drew them.
- Errors give sizes in plain numbers: `fillet(20) at (10, 0) does not fit: it needs 20 along
  segment 1, line_to(10, 0), which is 10 long; use a smaller radius`.

## Errors
- `ModelingError: Profile: the outline crosses or touches itself at (3.3333, 0): segment 1,
  line_to(10, 0) meets segment 3, line_to(0, -5); ...`
- `ModelingError: Profile: fillet(2) at (10, 0): the segments meet tangentially there, so there
  is no corner; leave the fillet out`
- `ModelingError: forward(x=-5): x = -5 lies behind the pen (it is at x = 10, heading 0
  degrees); turn first, or use line_to`; `forward(y=5)` at heading 0: parallel, never reached.
- `ModelingError: arc_to(20, 0): the point lies straight ahead on the heading 0 degrees, so the
  tangent arc would be a straight line; use line_to, ...` (straight behind: no arc reaches it).
- `ValueError: line_to(10, 0): the segment has no length (the pen is already at (10, 0))`.
- `ModelingError: fillet(2) at (10, 0): the end of an open path is not a corner; ...` from `wire()`.
- `ModelingError: mirror: the last segment runs along the mirror axis; ...`

## Example
```python
section = (Profile((0, 0))
           .line_to(12, 0).line_to(y=4).fillet(1.5)
           .line_to(x=6).line_to(y=20).chamfer(1)
           .line_to(x=0)
           .close())
bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))     # area 143.0171, volume 3565.9232

bracket = (Profile((0, 0))
           .line_to(30, 0).line_to(y=6)
           .line_to(x=10).fillet(4)
           .line_to(y=30)
           .arc(10, 90)
           .mirror(Y)
           .close())                                      # 60 x 40, area 1003.9469, 10 edges

u_turn = Profile((0, -3)).forward(20).arc(3, 180).forward(20).arc(3, 180).close()   # a slot, 20*6 + 9*pi
path = Profile((0, 0)).line_to(20, 0).fillet(5).line_to(20, 20).wire()
pipe = sweep(Circle(1), path)                             # volume = pi * path.length = 118.9218

base = Profile((0, 0)).line_to(20, 0).line_to(20, 10)
square = base.line_to(0, 10).close()                      # 200
round_top = base.arc_to(0, 10).close()                    # 357.0796, base is unchanged
```

## Related
`recipes/profiles` (which tool for which outline), `Stroke` (a band along `wire()`),
`fillet`, `chamfer`, `mirror` (whole sketches), `make_face` (outlines from curve edges),
`Sketch.revolve` (features).
