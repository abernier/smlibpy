# Line

A straight edge between two points.

## Signature
`Line(start, end)`

- `start`, `end`: points as 2-tuples (z = 0), 3-tuples, lists, `Vector` or `Vertex`. World
  coordinates. There is no `plane=`; use `.on(plane)` to move a line drawn in XY.

## Returns
An `Edge` with `geom_type == "line"`, running from `start` to `end`.
`Line((0, 0), (30, 40))`: `length` 50, `direction` (0.6, 0.8, 0), `point_at(0.25)` (7.5, 10, 0).

## Gotchas
- `direction` is the unit vector start -> end; `reversed()` flips it.
- Lines are not limited to a plane: `Line((1, 2, 3), (4, 6, 3))` is fine.
- `Line(...).on(Plane.XZ)` keeps a line along X on world X; local Y becomes world Z.
- `mirror()`, `scale()`, `rotate`, `translate` and `.on()` keep it a `line` (the straight edges of
  a body scaled per axis are recognized as lines again). Straight `bspline` edges (a standalone
  edge scaled per axis, a kernel offset of a spline sketch) still count as lines: `direction`,
  `lines()`, `parallel_to` and fillets treat them as straight.
- Two lines with the same points are not `==`; compare `start` and `end` with `is_close`.
- A line of 1e-9 mm is accepted. Avoid such slivers; they come from rounding errors in point
  lists.
- `Line(a, b) + Line(b, c)` makes a `Wire`.

## Errors
- `ValueError: a line needs two distinct points` when start and end coincide (closer than
  1e-12).
- `ValueError: expected 2 or 3 coordinates, got 4` for a malformed point.
- `ValueError: not a circular edge but a line` when asking a line for `radius`.

## Example
```python
a = Line((0, 0), (30, 40))
b = Line((1, 2, 3), Vector(4, 6, 3))
print(a.length, a.direction, a.point_at(0.25))   # 50.0, (0.6, 0.8, 0), (7.5, 10, 0)
print(Line((0, 0), (10, 10)).intersections(Line((0, 10), (10, 0))))   # [Vector(5, 5, 0)]
```

## Related
`PolarLine` (by length and angle), `Polyline` (a chain of lines), `Wire`, `generic.md`.
