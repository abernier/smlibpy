# Hull

The convex hull of points and shapes: the region a string pulled tight around them encloses.
Around circles and arcs the outline follows the arcs exactly, joined by tangent lines. The
usual way to draw levers, links, cam outlines and tapered slots.

## Signature
`Hull(*items)`
- `items`: points (tuples, `Vector`, `Vertex`), edges, wires, sketches or faces, or lists of
  them. Points need z = 0 (or the plane of the first sketch given).

## Returns
A `Sketch` with exact `line` and `circle` edges, on the plane of the first sketch given (XY
otherwise). Nothing is centered.
- `Hull(Circle(10), Pos(60, 0) * Circle(6))`: 2 arcs and 2 tangent lines, area 1175.7624 (the
  closed form, to 1e-10).
- `Hull(Rectangle(20, 10), Pos(20, 0) * Circle(5))`: 339.2699 = 300 + 12.5*pi.
- `Hull((0, 0), (10, 0), (5, 8), (5, 2))`: the triangle, area 40; inner points drop out.
- `Hull(CenterArc((0, 0), 10, 0, 180), (0, -5))`: only the arc's span counts: 207.0796.
- A sketch's holes and concave parts are ignored (the L of `Polygon`: area 848).

## Gotchas
- Holes come afterwards: `Hull(...) - Circle(5) - Pos(60, 0) * Circle(3)`.
- Splines and ellipses are not supported (error); hull points along them instead.
- All points on one line have no hull (error).

## Errors
- `ModelingError: Hull: the hull has no area: all the points lie on one line`.
- `ModelingError: Hull: the bspline (0, 0) -> (20, 0) is neither a line nor a circular arc; ...`.
- `TypeError: Hull: a Part has no outline in a plane; use part.section(plane) or a face`.
- `ValueError: Hull: the point (10, 0, 5) is not in the plane of the hull`.

## Example
```python
lever = Hull(Circle(10), Pos(60, 0) * Circle(6)) - Circle(5) - Pos(60, 0) * Circle(3)
link = Hull(Circle(8), Pos(40, 0) * Circle(8), Pos(20, 30) * Circle(5))
link = link - [Circle(4), Pos(40, 0) * Circle(4), Pos(20, 30) * Circle(2.5)]   # 1 face, 3 holes
tapered_slot = Hull(Circle(3), Pos(25, 0) * Circle(5))
```

## Related
`Stroke` (bands of constant width), `Slot`, `Profile`, `offset`.
