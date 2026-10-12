# Polygon

The straight-edged region through a list of points. Unlike the other constructors, the
points stay where you give them.

## Signature
`Polygon(*points, fillet=0, chamfer=0, align=None)`
Points as varargs `Polygon((0, 0), (30, 0), (0, 20))` or one list `Polygon(pts)`; tuples or
`Vector`s. The outline is closed automatically; repeating the first point at the end changes
nothing. `align=None` (default) leaves the points in place; `Align.CENTER` (or `"center"`)
moves the bbox center to the origin, `Align.MIN` the lower left of the bbox.
`fillet` / `chamfer` round or bevel every corner (2D points only).

## Returns
A `Sketch` with one line edge per side, normal +Z.

## Gotchas
- The winding does not matter: clockwise and counter-clockwise lists extrude, cut and combine
  the same.
- Give 2D points and place the sketch with `.on(...)`. 3D points are accepted but the sketch
  keeps `Plane.XY` as its plane: points in a tilted plane extrude along +Z (an oblique prism),
  and points at z = 5 combine with sketches at z = 0 instead of those at z = 5.
- Duplicate consecutive points are dropped. A point in the middle of a straight side is kept
  as an extra vertex.
- An outline that touches itself at one corner becomes 2 faces.
- `sketch.plane.origin` is the world origin, so `revolve()` without an axis turns about the
  world Y axis. Still pass the axis explicitly.
- Rounded corners: `Polygon(..., fillet=r)` for all of them (the L below: 12 edges, area
  492.5664), `Polygon(...).fillet(r, corners)` for some. Outlines with arcs: `Profile`.
- Points in the middle of a straight side are merged before the corners are rounded, so they
  get no fillet.

## Errors
- `ValueError: a polygon needs at least three points`.
- `ValueError: Polygon: fillet=3 at (50, 0) does not fit: it needs 60.1496 along the line
  (0, 0) -> (50, 0), which is 50 long; use a smaller radius`: an acute corner.
- `ValueError: Polygon: corner options need 2D points (z = 0); ...`.
- `KernelError: sketch failed (SM_ERR)`: the outline crosses itself (bowtie), all points are
  collinear, or 3D points are not coplanar. There is no hint; check the point order.

## Example
```python
profile = Polygon((0, 0), (30, 0), (30, 10), (10, 25), (0, 25))   # area 600, bbox 0..30 x 0..25
rib = profile.on(Plane.XZ).extrude(4)                             # stands up in XZ, 4 thick toward -Y
centered = Polygon((10, 10), (20, 10), (15, 20), align=Align.CENTER)
angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30), fillet=2)   # area 492.5664
```

## Related
`Profile` (outlines with arcs), `RegularPolygon`, `Triangle`, `Trapezoid`, `make_face`, `fillet`,
`Polyline` (curves).
