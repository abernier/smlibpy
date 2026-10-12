# Surfaces

Not every shape starts as a solid. Car bodies, consumer products and turbine blades are
designed as surfaces first, then closed or thickened into solids. smlibpy models surfaces
as `Shell`s: one or more faces that do not enclose a volume.

## Open curves make surfaces

The operations that turn sketches into solids turn open curves into surfaces:

```python
from smlibpy import *

arc = ThreePointArc((0, 0, 0), (10, 5, 0), (20, 0, 0))
wall = extrude(arc, 10)                                         # a curved wall

profile = Spline((5, 0, 0), (8, 0, 10), (4, 0, 20), (6, 0, 30))
vase = revolve(profile, Z)                                       # surface of revolution

hull = loft([Spline((0, 0, 0), (10, 2, 0), (20, 0, 0)),
             Spline((0, 0, 10), (10, 6, 10), (20, 0, 10)),
             Spline((0, 0, 20), (10, 2, 20), (20, 0, 20))])       # through three curves

ribbon = sweep(Line((-2, 0, 0), (2, 0, 0)), Helix(pitch=20, height=40, radius=10))
```

## Freeform surfaces

`surface` makes a NURBS surface from a grid of points, passing through them, or, with
`interpolate=False`, using them as control points for a smoother result:

```python
import math

grid = [[(x, y, 5 * math.sin(x / 12) * math.cos(y / 12)) for x in range(0, 61, 10)]
        for y in range(0, 41, 10)]
terrain = surface(grid)
smooth = surface(grid, interpolate=False)
```

`ruled(a, b)` joins two curves with straight lines:

```python
twist = ruled(Line((0, 0, 0), (20, 0, 0)), Line((0, 20, 10), (20, 20, -10)))
```

## From surfaces to solids

`thicken` gives a surface a wall thickness:

```python
panel = terrain.thicken(2)
print(panel.volume)
```

`stitch` sews faces and sheets along common edges into a closed solid, or into a larger
sheet if they don't close:

```python
box = Box(10, 10, 10)
sheets = [f.to_shell() for f in box.faces()]
solid = stitch(sheets)          # a Part again
```

Any face of a part becomes a separate surface with `face.to_shell()`, or a sketch with
`face.to_sketch()` when it is planar.

## Quality

SMLib's fillets come in curvature-continuous variants, which matter most on surfaces that
reflect light:

```python
body = Box(60, 40, 20)
body = body.fillet(body.edges(), 6, continuity="G2")
```

See [features](features.md#smooth-blends-g2-and-g3).
