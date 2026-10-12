# CounterSinkHole

A drilling tool with a conical countersink at the top, for flat head screws. Subtract it from
a part.

## Signature

`CounterSinkHole(radius, counter_sink_radius, depth, angle=82.0)`

Radii (not diameters), mm and degrees:

- `radius`: the drill.
- `counter_sink_radius`: radius of the sink at the face (the head radius); larger than `radius`.
- `depth`: **total** depth of the drill from the face, sink included.
- `angle`: the **included** angle of the cone (82 is the inch standard; metric ISO flat heads use 90).

There is no sink depth parameter: it follows from the radii and the angle,
`(counter_sink_radius - radius) / tan(angle / 2)`. 82° and radii 2 / 4 → 2.3007 deep;
90° → exactly `counter_sink_radius - radius`.

## Returns

A `Part` hanging down from the origin like `Hole`: a cone from r `counter_sink_radius` at z 0
to r `radius` at z −sink depth, and the drill down to z −depth. Faces: cone, cylinder, two planes.
Place it with `.on(face)` exactly like `Hole` (same face axes, same centroid caveat).

Measured on `CounterSinkHole(2, 4, 10)`: cone face z −2.3007..0, the cone surface is 41.0° from the
axis (half of 82). Cut into `Box(60, 40, 10)`: removed volume 164.2129 = drill + frustum.

## Gotchas

- `angle` is the included angle, not the half angle. Sink depth by angle (radii 2 / 4): 60° → 3.46,
  90° → 2.0, 120° → 1.15.
- The edge between the cone and the drill is a B-spline, not a circle: `part.edges().circles()`
  finds the top circle and the drill's bottom circle, not this one. Select it by position
  (`part.edges().filter_by(lambda e: abs(e.center().z - z_sink) < 1e-3)`).
- `depth` smaller than the sink depth is ignored: `CounterSinkHole(2, 4, 1)` is the full cone,
  2.3 deep, with no drill. Keep `depth` larger than the sink.

## Errors

- `counter_sink_radius <= radius`, a negative radius or a negative angle:
  `ValueError: invalid cone dimensions`.
- `angle=180`: `KernelError: Cone failed (SM_ERR_INVALID_INPUT)`. `angle=0`: `ZeroDivisionError`.
- `radius == 0` or `depth <= 0`: `ValueError: radius and height must be positive`.

## Example

```python
# Countersink for an M4 flat head (ISO 90 degrees), 8 deep in total
block = Box(40, 40, 20)
block -= CounterSinkHole(2.2, 4.5, 8, angle=90).on(block.faces().top())
cone = block.faces().filter_by(lambda f: f.geom_type == "cone").one()
print(round(cone.bbox().min.z, 3), round(cone.bbox().max.z, 3))   # 7.7 10.0: sink depth 4.5 - 2.2 = 2.3
print(sorted((round(e.radius, 3), round(e.center().z, 3)) for e in block.edges().circles()))
```

## Related

`Hole`, `CounterBoreHole`, `Cone`, `booleans`.
