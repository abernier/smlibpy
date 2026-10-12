# SagittaArc

A circular arc between two points whose middle lies a given distance (the sagitta) from the
chord.

## Signature
`SagittaArc(start, end, sagitta, plane=Plane.XY)`

- `start`, `end`: world points.
- `sagitta`: mm, the distance from the chord midpoint to the arc midpoint. **Positive bulges
  to the left of start -> end, negative to the right** (left seen from the tip of
  `plane.z_dir`). Same side rule as `RadiusArc`.
- `plane`: only its normal is used to decide "left"; the origin is ignored.

## Returns
An `Edge` (`geom_type == "circle"`). Its midpoint is exactly `sagitta` from the chord
midpoint; radius = (sagitta² + (chord/2)²) / (2·|sagitta|).
`SagittaArc((0, 0), (10, 0), 2)`: middle (5, 2), radius 7.25, center (5, -5.25).

## Gotchas
- `|sagitta| > chord / 2` gives the major arc (more than 180 degrees):
  `SagittaArc((0, 0), (10, 0), 8)` has length 22.52. `|sagitta| == chord / 2` is a half
  circle. Unlike `RadiusArc`, there is no ambiguity: the sagitta picks exactly one arc.
- In a counterclockwise outline left is the inside: a negative sagitta bulges outward.
- `plane=Plane.XZ` with points on the X axis: positive goes to +Z; `Plane.back`: to -Z.

## Errors
- `ValueError: the three points are collinear` for `sagitta=0` (or below about 1e-12).
- `ValueError: cannot normalize a zero-length vector` for equal points.

## Example
```python
bump = SagittaArc((0, 0), (10, 0), 2)        # middle (5, 2), r 7.25
dent = SagittaArc((0, 0), (10, 0), -2)       # middle (5, -2)
big = SagittaArc((0, 0), (10, 0), 8)         # major arc, length 22.52
# a lens: both arcs bulge to the right of their own travel direction, i.e. outward
lens = Wire([SagittaArc((-10, 0), (10, 0), -3), SagittaArc((10, 0), (-10, 0), -3)])
print(make_face(lens).area)                  # 81.42202, bbox y -3..3
```

## Related
`RadiusArc`, `ThreePointArc`, `TangentArc`, `CenterArc`.
