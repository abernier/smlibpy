# revolve

Turns a sketch about an axis into a solid of revolution. An open curve gives a surface
(`Shell`).

## Signature
`sketch.revolve(axis=None, angle=360.0)`
`revolve(profile, axis=None, angle=360.0)` (sketch, planar face, face list, wire or edge)

- `axis`: an `Axis` (`X`, `Y`, `Z`, or `Axis(origin, direction)`). It must lie in the sketch
  plane. **Always pass it.**
- `angle`: degrees, counter-clockwise about the axis direction (right-hand rule). About `Z`,
  90 sweeps from +X towards +Y.

## Returns
A `Part`. For a full revolution the volume is `area * 2*pi * (distance of the region's centroid
from the axis)` (Pappus): compare with that.

## The lathe setup
Draw the half profile in XY with x = radius and y = height, place it on `Plane.front` and
revolve about `Z`. On `Plane.front` local x is world X and local y is world Z.

## Gotchas
- **The default axis is not the world axis.** It is the sketch's local Y axis through the
  sketch's plane origin, and that origin moves with the sketch: `translate`, `Pos(...) *` and
  `align=` move it too. `Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve()` revolves
  about x = 15, through the middle of the region. Only a sketch built without `align`,
  `translate` or `Pos` keeps its plane origin at the world origin.
- **A region that crosses the axis gives no error with angle 360.** The result reports
  `is_valid() == True` with a zero or negative volume. Partial angles raise
  `SM_ERR_AXIS_INSIDE_FACE`. Check `volume > 0` and compare with Pappus.
- An edge on the axis is fine (solid without a bore), and so is a single vertex touching it.
- **Negative angles do not reverse the direction**: `-90` revolves 270 degrees the positive
  way. To go the other way, flip the axis: `Axis((0, 0, 0), (0, 0, -1))` with a positive angle.
  `angle=0` and `-360` return invalid bodies. Angles above 360 are a full revolution.
- An axis perpendicular to the sketch plane (`Circle(3).translate(10, 0).revolve(Z)` on XY)
  returns a flat, zero-volume body without an error.
- Regions with holes and several separate regions work, with an explicit axis.

## Errors
- `KernelError: revolve failed (SM_ERR_AXIS_INSIDE_FACE): the axis must not cross the region`
  for a partial revolution of a region that crosses the axis.

## Example
```python
profile = Polygon((5, 0), (30, 0), (30, 3), (26, 6), (26, 10), (30, 13), (30, 16), (5, 16))
pulley = profile.on(Plane.front).revolve(Z)             # x = radius, y = height
print(pulley.is_valid(), round(pulley.volume, 3))       # True 39006.014

quarter = profile.on(Plane.front).revolve(Z, 90)        # from +X towards +Y
other = profile.on(Plane.front).revolve(Axis((0, 0, 0), (0, 0, -1)), 90)  # from +X towards -Y

tube = Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve(Z)
print(round(tube.volume, 3))                            # 18849.557 = pi*(20^2-10^2)*20

donut = (Circle(5) - Circle(2)).translate(20, 0).on(Plane.front).revolve(Z)
print(round(donut.volume, 3))                           # 8290.468

wrong = Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve()   # default axis: through the sketch origin (15, 0)!
print(wrong.is_valid(), round(wrong.volume, 3))         # True, but the volume is nonsense

dome = revolve(CenterArc((0, 0), 10, -90, 180, plane=Plane.front), Z)  # open curve -> Shell
```

## Related
`extrude`, `sweep`, `Torus`, `Cone`, `Plane.front`, `Axis`.
