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

A cloud of points in any order, as a scanner gives them, gets a surface fitted to it: it comes
close to the points instead of passing through each one. `controls` sets the number of control
points (default: about one per 8 points) and `smoothing` how much the surface resists bending;
for noisy points, take fewer control points or more smoothing. The cloud must not fold over
itself (no overhangs, seen from its best-fit plane), and the surface's normal points up:

```python
import numpy as np

rng = np.random.default_rng(1)
xy = rng.uniform(-30, 30, (2000, 2))
cloud = np.column_stack([xy, 6 * np.exp(-(xy ** 2).sum(axis=1) / 300)])
scan = surface(cloud)                                  # 3 ms
print(max(scan.distance_to(p) for p in cloud) < 0.001)  # True: within 0.001 mm of every point
noisy = cloud + rng.normal(0, 0.1, cloud.shape) * [0, 0, 1]
fair = surface(noisy, controls=12)                     # follows the shape, not the noise
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

## Blends between surfaces

`fillet` rounds the edges of a part. Two sheets that are no part of one body, two crossing
pipes or a panel and a post, get a round blend with `surface_fillet`: a ball of the radius
rolls between the two surfaces, on the side of each that `sides` says (1: where its normal
points, -1: the other side). The blend is a sheet of its own:

```python
floor = Rectangle(40, 40).faces()[0]                   # normal +Z
wall = Rectangle(40, 40).on(Plane.XZ).faces()[0]       # normal -Y
blend = surface_fillet(floor, wall, 5)                 # above the floor, on the -Y side of the wall
print(round(blend.area, 4))                            # 314.1593: a quarter circle, 40 long

pipe_a = Cylinder(5, 60).faces().cylinders()[0]
pipe_b = Cylinder(4, 60).rotate(X, 90).faces().cylinders()[0]
joint = surface_fillet(pipe_a, pipe_b, 1.5)            # around both places where they cross
```

## Curves as NURBS

`edge.nurbs()` gives the degree, knots, control points and weights of any edge (arcs as exact
rational curves), and `Edge.from_nurbs` makes an edge of such data (control points read from
elsewhere, or moved; many spans). `make_compatible` turns curves into B-splines of one degree and one knot
vector, whose control points correspond one to one, as code that builds surfaces between
curves needs them; `remove_knots` takes the knots out again that a curve does not need:

```python
a = Bezier((0, 0, 0), (1, 3, 0), (4, 3, 1), (6, 0, 0))
b = Spline((0, 0, 5), (2, 1, 5), (3, -1, 5), (4, 2, 5), (6, 0, 5))
ca, cb = make_compatible(a, b)
print(len(ca.nurbs().points), len(cb.nurbs().points))  # 7 7, the same knots
print(len(ca.remove_knots().nurbs().points))           # 4: the Bezier again
```

## Quality

SMLib's fillets come in curvature-continuous variants, which matter most on surfaces that
reflect light:

```python
body = Box(60, 40, 20)
body = body.fillet(body.edges(), 6, continuity="G2")
```

See [features](features.md#smooth-blends-g2-and-g3).
