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

It closes gaps up to `tolerance` (default 1e-4 of the size of the pieces), sewing edges that
meet closely first, and leaves wider ones open; `report=True` says what it did. An open result
has its normals made to agree with the first piece's, so it thickens; `flipped()` turns a sheet
over:

```python
body, report = stitch(sheets, report=True)
print(report.sewn_edges, report.open_edges, report.max_gap)   # 12 0 0.0
floor = ruled(Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 0), (10, 10, 0)))   # normal +Z
wall = ruled(Line((0, 10, 10), (10, 10, 10)), Line((0, 10, 0), (10, 10, 0)))  # normal +Y
corner = stitch(floor, wall)             # the wall turned to -Y, toward the floor's side
print(corner.thicken(1).volume)          # 190.0
print(corner.flipped().thicken(1).volume)   # 210.0: the other side
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
rounding = surface_fillet(floor, wall, 5)              # above the floor, on the -Y side of the wall
print(round(rounding.area, 4))                         # 314.1593: a quarter circle, 40 long

pipe_a = Cylinder(5, 60).faces().cylinders()[0]
pipe_b = Cylinder(4, 60).rotate(X, 90).faces().cylinders()[0]
joint = surface_fillet(pipe_a, pipe_b, 1.5)            # around both places where they cross
```

`trim=True` cuts both faces back to the blend's long edges and sews the three into one
sheet, ready to thicken:

```python
one = surface_fillet(floor, wall, 5, trim=True)
print(len(one.faces()), round(one.area, 4))            # 3 1514.1593: 600 + 600 + the blend
plate = one.thicken(1)
```

## Bridges between sheets

Two sheets that do not meet get a smooth bridge between two of their border edges with
`blend`: a sheet that leaves one across its edge and reaches the other across its edge,
tangent to both (`continuity="G1"`), with the same curvature across the edges too (`"G2"`, the
default) or also the same change of curvature (`"G3"`). `tension` sets how far it runs on in
each sheet's direction before it turns, as a part of the gap (one number, or one per edge).
The blend joins the nearest ends of the two edges, whichever way they run, and its normal
follows the first sheet; `join=True` sews it to both sheets:

```python
low = Rectangle(20, 20).translate(-20, 0).faces()[0].to_shell()
high = Rectangle(20, 20).on(Plane.XY.offset(10)).translate(20, 0, 0).faces()[0].to_shell()
edge_low = low.edges().filter(lambda e: abs(e.center().x + 10) < 1e-9).one()
edge_high = high.edges().filter(lambda e: abs(e.center().x - 10) < 1e-9).one()
bridge = blend(edge_low, edge_high)                    # G2: flat where it meets the flat sheets
print(round(bridge.area, 3))                           # 466.054
step = blend(edge_low, edge_high, tension=(0.5, 2), join=True)
print(len(step.faces()), step.thicken(1).is_valid())   # 3 True
```

## Trimming sheets with curves

`trim` cuts a sheet along curves that lie on it, and keeps the side of a point, or with
`keep="split"` both sides as faces of their own. The curves come from where sheets meet
(`intersection_curves`), from a `surface_fillet`'s long edges, or from `project`: a hole or
an outline along a direction is the outline projected onto the sheet first. A curve may run
across several faces of the sheet; each one runs from border to border, or closes a loop.
`face.split(curves)` gives the pieces of one face:

```python
f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
saddle = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
outline = saddle.project(CenterArc((20, 15, 50), 5, 0, 360), (0, 0, -1))
holed = saddle.trim(outline, keep=(2, 2, 0))          # a point outside the outline: the hole
disk = saddle.trim(outline, keep=(20, 15, 0))          # a point inside: the disk
print(round(holed.area + disk.area, 3), round(saddle.area, 3))   # 1248.607 1248.607

halves = one.trim(one.intersection_curves(Rectangle(100, 100).on(Plane.YZ).faces()[0].to_shell()), "split")
print(len(halves.faces()))                             # 6: each of the 3 faces cut in two
pieces = floor.split(Line((-20, -20), (20, 20)))       # two triangles of 800
```

To give a region of a part's face a face of its own (a label area, a parting line), imprint
the curves on the part: [features](features.md#imprints).

## Filling holes and curve networks

`fill` closes a loop of curves with a patch: four sides make a Coons patch, three or five and
more an N-sided fill. Where the curves are border edges of sheets, the patch meets the sheets
tangentially (`tangent=False` runs it through the curves only):

```python
cut = Sphere(10) - Box(30, 30, 30).translate(0, 0, 8 + 15)
dome = stitch([f for f in cut.faces() if f.geom_type == "sphere"])
cap = fill(dome.edges().filter(lambda e: len(e.faces()) == 1))   # tangent to the sphere
ball = stitch(dome, cap)
print(type(ball).__name__, round(ball.volume, 2))                 # Part 4141.52

sides = [Spline((0, 0, 0), (5, 0, 2), (10, 0, 0)), Spline((10, 0, 0), (10, 5, 1), (10, 10, 0)),
         Spline((10, 10, 0), (5, 10, 2), (0, 10, 0)), Spline((0, 10, 0), (0, 5, 1), (0, 0, 0))]
patch = fill(sides)                                               # a Coons patch, any order
print(round(patch.area, 4))                                       # 112.2176
```

Coons patches meet their sheets to 0.02 degrees; the kernel's N-sided fill (five sides and more)
only to about 1.4 degrees. `network` builds a surface through crossing curves (a Gordon surface):
`u` curves that each cross every `v` curve, the outer ones bounding it. The curves are made to
cross at common parameters first, and the surface runs through them to 1e-7 of their size:

```python
h = lambda x, y: math.sin(math.pi * x / 10) * (1 + 0.03 * y) + 0.5 * math.sin(math.pi * y / 10)
us = [Spline(*[(x, y, h(x, y)) for x in (0, 2, 5, 7.5, 10)]) for y in (0, 5, 10)]
vs = [Spline(*[(x, y, h(x, y)) for y in (0, 3, 5, 8, 10)]) for x in (0, 5, 10)]
skin = network(us, vs)
```

## Extending and untrimming

`extend` grows a sheet of one face past its sides (`face.extended` any face's surface), to make
it reach across a part before it cuts or splits it, or to give a blend room: by `distance` along
the surface, continuing it as it is (`"natural"`: planes stay planes, cylinders and spheres the
same ones) or along its tangents (`"G1"`) or curvature (`"G2"`). `face.untrimmed()` is the whole
surface a face lies on, without its holes and cut borders:

```python
top = Box(10, 10, 10).faces().filter(lambda f: f.normal_at().z > 0.5)[0]
print(top.extended(3).area)                                   # 256.0: a plane 16 x 16
wall = (Box(20, 20, 20) - Cylinder(4, 40)).faces().filter(lambda f: f.geom_type == "cylinder")[0]
print(round(wall.untrimmed().area, 2))                        # 1005.31 = 2 pi 4 40
```

## Curves as NURBS

`edge.nurbs()` gives the degree, knots, control points and weights of any edge (arcs as exact
rational curves). `make_compatible` turns curves into B-splines of one degree and one knot
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
