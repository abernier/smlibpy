# revolve

Turns a sketch about an axis into a solid of revolution. An open curve gives a surface
(`Shell`).

## Signature
`sketch.revolve(axis=None, angle=360.0)`
`revolve(profile, axis=None, angle=360.0)` (sketch, planar face, face list, wire or edge)

- `axis`: an `Axis` (`X`, `Y`, `Z`, or `Axis(origin, direction)`). It must lie in the sketch
  plane. **Always pass it.**
- `angle`: degrees, counter-clockwise about the axis direction (right-hand rule). About `Z`,
  90 sweeps from +X towards +Y; -90 sweeps from +X towards -Y. Not zero, at most 360 in size.

## Returns
A `Part`. For a full revolution the volume is `area * 2*pi * (distance of the region's centroid
from the axis)` (Pappus): compare with that.

The walls are analytic for any angle, also a full turn: lines parallel to the axis give
cylinders, oblique lines cones, arcs centred on the axis spheres, other arcs tori. So
`faces().cylinders()`, `Face.radius` and `Face.axis`, drafts and STEP files
(`CYLINDRICAL_SURFACE`, `TOROIDAL_SURFACE`, ...) work on lathe parts. Spline edges (and arcs
whose circle reaches over the axis) give `revolution` faces, which have an `axis` but no
`radius`. Before 0.5.0 a full turn gave `revolution` faces for every wall and arcs never gave
tori.

## The lathe setup
Draw the half profile in XY with x = radius and y = height, place it on `Plane.front` and
revolve about `Z`. On `Plane.front` local x is world X and local y is world Z.

## Gotchas
- **The default axis is not the world axis.** It is the sketch's local Y axis through the
  sketch's plane origin, and that origin moves with the sketch: `translate`, `Pos(...) *` and
  `align=` move it too. Centered constructors (`Rectangle`, `Circle`, ...) and `make_face` put
  it in the middle of the region, so their default axis crosses the region and raises:
  `Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve()` raises `ModelingError:
  revolve: the axis crosses the region; the default axis is the sketch's local Y axis through
  its plane origin (15, 0, 0), pass axis=...`. `Polygon` keeps its plane origin at the world
  origin: `Polygon((10, 0), (20, 0), (20, 20), (10, 20)).revolve()` is a tube (18849.56).
- **The axis must not cross the region**, for any angle: `ModelingError: revolve: the axis
  crosses the region`. An edge on the axis is fine (solid without a bore), and so is a single
  vertex touching it.
- An axis that does not lie in the sketch plane (`Circle(3).translate(10, 0).revolve(Z)` on
  XY) raises `ValueError: revolve: the axis must lie in the sketch plane (it is not parallel to
  it)`.
- A negative angle turns the other way: `revolve(Z, -90)` is the quarter from +X towards -Y,
  the same as `Axis((0, 0, 0), (0, 0, -1))` with 90. `-360` is a full revolution.
- Within 0.01 degrees of 360 the revolve is a full turn (359.995 gives the whole ring; the
  kernel returns no closed solid between 359.99 and 359.99999).
- The result is checked: an inside-out or volume-less body from the kernel raises
  `ModelingError`.
- Regions with holes and several separate regions work, with an explicit axis.

## Errors
- `ModelingError: revolve: the axis crosses the region` (with the default axis the message
  names its origin).
- `ValueError: revolve: the axis must lie in the sketch plane (it is not parallel to it)`
- `ValueError: revolve: the angle must not be zero`; `ValueError: revolve: the angle is at
  most 360 degrees`.

## Example
```python
profile = Polygon((5, 0), (30, 0), (30, 3), (26, 6), (26, 10), (30, 13), (30, 16), (5, 16))
pulley = profile.on(Plane.front).revolve(Z)             # x = radius, y = height
print(pulley.is_valid(), round(pulley.volume, 3))       # True 39006.014

quarter = profile.on(Plane.front).revolve(Z, 90)        # from +X towards +Y
other = profile.on(Plane.front).revolve(Z, -90)        # from +X towards -Y

tube = Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve(Z)
print(round(tube.volume, 3))                            # 18849.556 = pi*(20^2-10^2)*20
print(sorted(f.radius for f in tube.faces().cylinders()))   # [10.0, 20.0]

donut = (Circle(5) - Circle(2)).translate(20, 0).on(Plane.front).revolve(Z)
print(round(donut.volume, 3))                           # 8290.468

try:
    Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve()   # default axis: x = 15, through the region
except ModelingError as e:
    print(e)   # revolve: the axis crosses the region; the default axis is the sketch's local Y axis through its plane origin (15, 0, 0), pass axis=... (for example Axis((0, 0, 0), (0, 1, 0)))

dome = revolve(CenterArc((0, 0), 10, -90, 180, plane=Plane.front), Z)  # open curve -> Shell
```

## Related
`extrude`, `sweep`, `Torus`, `Cone`, `Plane.front`, `Axis`.
