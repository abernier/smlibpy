# ThreePointArc

The circular arc from a start point through a middle point to an end point.

## Signature
`ThreePointArc(start, through, end)`

- All three are world points (2-tuples or 3-tuples). The arc lies in the plane of the three
  points, so it works in any orientation in 3D.
- `through` can be any point of the arc between start and end, not only its middle.

## Returns
An `Edge` with `geom_type == "circle"` from `start` to `end`, passing exactly through
`through`. Arcs over 180 degrees work: `ThreePointArc((10, 0), (-10, 0), (0, -10))` is a
270 degree arc of radius 10.

## Gotchas
- It is the most direct way to get "this side" of a circle: put `through` on the side you
  want. No sign conventions to remember.
- `edge.normal` follows the turning direction: `ThreePointArc((-10, 0), (0, 10), (10, 0))`
  runs clockwise and has normal (0, 0, -1).
- A full circle is not possible (start == end raises); use `CenterArc(c, r, 0, 360)`.
- Nearly collinear points give huge radii: 1e-9 off the chord gives r = 1.25e10, and the end
  point misses by 2e-6 (more than the wire tolerance of 1e-6). Use `Line` when the bulge is
  negligible.

## Errors
- `ValueError: the three points are collinear`, also when two points coincide or
  start == end.

## Example
```python
top = ThreePointArc((-10, 0), (0, 10), (10, 0))         # upper half circle, r = 10
major = ThreePointArc((10, 0), (-10, 0), (0, -10))      # 270 degrees, length 47.12
tilted = ThreePointArc((0, 0, 0), (5, 5, 5), (10, 0, 10))   # 3D, r = 7.5
half = Wire([
    Line((-25, 0), (-25, -7.5)),
    ThreePointArc((-25, -7.5), (0, -15), (25, -7.5)),
    Line((25, -7.5), (25, 0)),
])
```

## Related
`CenterArc`, `RadiusArc`, `SagittaArc`, `TangentArc`, `generic.md`.
