# RadiusArc

The shorter circular arc of a given radius between two points.

## Signature
`RadiusArc(start, end, radius, plane=Plane.XY)`

- `start`, `end`: world points.
- `radius`: mm. **Positive bulges to the left of the travel direction start -> end, negative
  to the right.** "Left" is seen from the tip of `plane.z_dir`.
- `plane`: only its normal is used, to decide what "left" is. Its origin is ignored and the
  points are not moved onto it.

## Returns
An `Edge` (`geom_type == "circle"`), always the arc of at most 180 degrees.
`RadiusArc((0, 0), (10, 0), 10)`: middle point (5, 1.34), center (5, -8.66), length 10.47.
`radius=-10`: middle (5, -1.34).

## Which side
| start -> end | radius > 0 bulges to | radius < 0 bulges to |
|---|---|---|
| (0,0) -> (10,0) in XY | +Y | -Y |
| (10,0) -> (0,0) in XY | -Y | +Y |
| (0,0) -> (0,10) in XY | -X | +X |
| (0,0,0) -> (10,0,0), `plane=Plane.XZ` | +Z | -Z |
| (0,0,0) -> (10,0,0), `plane=Plane.back` | -Z | +Z |

Swapping the points flips the side. In an outline traversed counterclockwise, left is the
inside: a positive radius bulges **inward** (concave), a negative radius bulges outward
(convex).

## Gotchas
- No major arc: `RadiusArc` cannot make more than a half circle. Use `SagittaArc` with
  `|sagitta| > chord / 2`, `ThreePointArc` or `CenterArc` for that.
- `|radius| == chord / 2` is a half circle.
- A chord parallel to `plane.z_dir` (for example a vertical chord with `Plane.XY`) raises.

## Errors
- `ValueError: radius 4.999 is too small for points 10.0 apart` when `|radius| < chord / 2`
  (also for radius 0).
- `ValueError: cannot normalize a zero-length vector` for equal points or a chord along the
  plane normal.

## Example
```python
a, b = (0, 0), (10, 0)
left = RadiusArc(a, b, 10)       # bulges to +Y: mid (5, 1.33975)
right = RadiusArc(a, b, -10)     # bulges to -Y
half = RadiusArc(a, b, 5)        # half circle through (5, 5)
# D shape traversed counterclockwise: the arc from (20, 0) back to (-20, 0) must bulge to +Y,
# which is right of its travel direction (-X): negative radius
d = Wire([Line((-20, 0), (20, 0)), RadiusArc((20, 0), (-20, 0), -20)])
plate = make_face(d).extrude(5)  # volume pi * 400 / 2 * 5
```

## Related
`SagittaArc` (by bulge height), `ThreePointArc`, `TangentArc`, `CenterArc`.
