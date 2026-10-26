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
print(round(max(scan.distance_to(p) for p in cloud), 4))  # 0.001: within about 0.001 mm of every point
noisy = cloud + rng.normal(0, 0.1, cloud.shape) * [0, 0, 1]
fair = surface(noisy, controls=12)                     # follows the shape, not the noise
```

`report=True` says how far the points lie from the surface, each to its closest point on it: a
cloud that is not a height field gets a surface that misses it by millimetres without an error,
and the report shows it (1500 points of a tube r 10 around 288 degrees: `max_distance` 7.37):

```python
fair, fit = surface(noisy, controls=12, report=True)
print(round(fit.rms_distance, 2), round(fit.max_distance, 2))   # 0.09 0.36: the noise
```

`nurbs_surface` builds a surface from its NURBS data, as other programs, files or papers give it:
control points in rows, knot vectors, degrees and weights (rational surfaces, any degree, knots that
are not uniform or do not repeat at the ends). It is the inverse of a face's `nurbs()`:

```python
net = [[(0, 0, 0), (0, 10, 0), (0, 20, 0)],
       [(10, 0, 5), (10, 10, 8), (10, 20, 5)],
       [(20, 0, 0), (20, 10, 0), (20, 20, 0)]]
dome = nurbs_surface(net, degrees=2, weights=[[1, 1, 1], [1, 0.5, 1], [1, 1, 1]])
print(round(dome.bbox().max.z, 6))                     # 2.571429 = 18/7: the middle weight pulls less
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

## Splitting and trimming

A sheet splits a part along its surface, and a part trims a sheet:

```python
sheet = surface([[(x, y, 2 + 3 * math.sin(x / 6)) for y in np.linspace(-15, 15, 7)]
                 for x in np.linspace(-15, 15, 13)])
upper, lower = Box(20, 20, 20).split(sheet, keep="both")   # "above" is where the normals point
inside = sheet & Cylinder(5, 30)       # the piece of the sheet inside the cylinder: a Shell
outside = sheet - Cylinder(5, 30)      # the sheet with a hole
print(round(inside.area + outside.area - sheet.area, 9))   # 0.0
```

`sheet.intersect(part)` and `sheet.cut(part)` are `&` and `-` by name. `part & sheet` is
`sheet & part`; `part + sheet` and `part - sheet` raise `TypeError` (a sheet encloses no volume:
split the part, or `imprint` the sheet's lines into its faces).

## Offset surfaces

`offset` moves a sheet along its face normals and keeps it a sheet: the inner skin of a molded
panel, a clearance surface, a tool path surface. Where faces meet, they are extended or trimmed
to meet again, as `Part.offset` does; a face of a part gives a sheet of its offset surface.

```python
skin = extrude(CenterArc((0, 0), 10, 0, 180), 20)       # normals point away from the axis
print(round(skin.offset(2).area, 4))                    # 753.9822 = pi * 12 * 20
cup = stitch([f for f in Box(20, 20, 20).faces() if f.normal_at().z < 0.5])
print(round(cup.offset(-1).area, 1))                    # 1692.0: 18 x 18 and four 18 x 19
lid = Box(20, 20, 20).faces().top().one().offset(5)     # the top face's copy, 5 above it
```

The faces must share their edges to move together; join separate faces with `stitch` first.
smlibpy checks the result: every face at the distance from the sheet, on the side the distance
points to. An offset beyond the radius of a concave curvature raises `ModelingError`.

`thicken` and the function `thicken(surface, t, both=True)` make a solid of a sheet instead:
`both` puts half of the thickness on each side.

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

`shape="chamfer"` makes the blend flat: straight across between the lines where the round of the
same radius meets the surfaces. `radius2` gives a chamfer a second distance, from `b` (for faces at
right angles: its edge on `b` lies `radius` from `a`, its edge on `a` lies `radius2` from `b`):

```python
bevel = surface_fillet(floor, wall, 5, shape="chamfer")
print(round(bevel.area, 4))                            # 282.8427: 40 long, 5 sqrt(2) wide
steep = surface_fillet(floor, wall, 2, radius2=4, shape="chamfer")
print(round(steep.area, 4))                            # 178.8854: from y -4 on the floor to z 2 on the wall
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

Two closed edges, such as the rims of two tubes, are bridged all round: each point of the first
edge is joined to the point of the second at the same fraction of its length, counted from the
point nearest the first edge's start and running the same way round. The blend comes in two
faces sewn along two seams (the kernel offsets no face that closes around), as smooth across
them as elsewhere, so the sewn sheet thickens:

```python
wide = Cylinder(10, 20).faces().cylinders()[0].to_shell()                      # z -10..10
narrow = Cylinder(6, 20).translate(0, 0, 40).faces().cylinders()[0].to_shell()  # z 30..50
top = wide.edges().filter(lambda e: e.center().z > 5).one()
bottom = narrow.edges().filter(lambda e: e.center().z < 35).one()
neck = blend(top, bottom, join=True)                   # 4 faces, the two far rims free
print(neck.thicken(1).is_valid())                      # True
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
the curves on the part: [features](features.md#imprint).

## Filling holes and curve networks

`fill` closes a loop of curves with a patch: four sides make a Coons patch, five and more an
N-sided fill, three an N-sided fill through the curves, or, tangent to sheets, a Coons patch with
one side shrunk to a point. Where the curves are border edges of sheets, the patch meets the
sheets tangentially (`tangent=False` runs it through the curves only):

```python
cut = Sphere(10) - Box(30, 30, 30).translate(0, 0, 8 + 15)
dome = stitch([f for f in cut.faces() if f.geom_type == "sphere"])
cap = fill(dome.edges().filter(lambda e: len(e.faces()) == 1))   # tangent to the sphere
ball = stitch(dome, cap)
print(type(ball).__name__, round(ball.volume, 2))                 # Part 4141.58

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

`extend` grows a sheet of one face past its sides (`face.extend` any face's surface), to make
it reach across a part before it cuts or splits it, or to give a blend room: by `distance` along
the surface, continuing it as it is (`"natural"`: planes stay planes, cylinders and spheres the
same ones) or along its tangents (`"G1"`) or curvature (`"G2"`). `face.untrimmed()` is the whole
surface a face lies on, without its holes and cut borders:

```python
top = Box(10, 10, 10).faces().filter(lambda f: f.normal_at().z > 0.5)[0]
print(top.extend(3).area)                                     # 256.0: a plane 16 x 16
wall = (Box(20, 20, 20) - Cylinder(4, 40)).faces().filter(lambda f: f.geom_type == "cylinder")[0]
print(round(wall.untrimmed().area, 2))                        # 1005.31 = 2 pi 4 40
```

## Matching edges and merging faces

`match_edge` moves an edge of a sheet onto a curve: the edge then runs along the curve exactly, and
its face bends to follow near the edge only (within `extent`, a part of the face across from the
edge, default 0.25). Match one sheet's edge to another's to close a gap before `stitch`, or to a
curve to give a sheet a styling line. Where the curve's ends are not the edge's, the edges next to
it bend near those ends, and faces beyond them follow (with a crease along those edges: matching
keeps no tangent across them). `merge_faces` makes two faces that share a whole side one face on one
surface; the halves of a sheet split along a curve of its surface come back as the one face they
were:

```python
panel = surface([[(x, y, 2 * math.sin(x / 10)) for y in range(0, 25, 5)] for x in range(0, 35, 5)])
roof = surface([[(x, y, 2 * math.sin(x / 10) + 0.4) for y in range(21, 41, 5)] for x in range(0, 35, 5)])
edge = panel.edges().sort_by(Axis.Y)[-1]                 # y = 20; the roof starts at y = 21, 0.4 higher
closed = panel.match_edge(edge, roof.edges().sort_by(Axis.Y)[0])
body, report = stitch(closed, roof, tolerance=1e-6, report=True)
print(report.sewn_edges, report.max_gap)                 # 1 0.0

halves = panel.trim(panel.intersection_curves(Plane((15, 0, 0), (0, 1, 0), (1, 0, 0))), "split")
one = halves.merge_faces(*halves.faces())
print(len(halves.faces()), len(one.faces()), round(one.area, 6))   # 2 1 605.679201
```

Both work on faces bounded by the four sides of their surface (as `surface`, `loft`, `ruled`,
`fill`, `network` and `nurbs_surface` make them); faces with holes or trimmed borders raise
`ValueError`. `intersection_curves` takes a `Plane` too (above), and gives an empty list for bodies
that do not meet.

## Shaping faces: push, warp, flatten

Three local edits change one face of a part or a sheet and leave its edges where they are (an
edit that would move one raises `ValueError`): `push` moves a point of the face, exactly, with a
smooth dent or bump around it; `warp` raises or sinks a region drawn on the face; `flatten` presses
a region onto a plane. The face becomes a B-spline surface: its own surface plus the change,
exactly, so a plane or a cylinder stays exactly what it was away from the edit:

```python
lid = Box(60, 40, 6)
top = lid.faces().sort_by(Axis.Z)[-1]
dented = lid.push(top, (15, 0, 3), by=-1.5, radius=10)            # 1.5 deep, 10 around
print(round(dented.volume, 2), dented.is_valid())                  # 14333.33 True
pad = lid.warp(top, Rectangle(20, 16).translate(-15, 0).on(top), 2)  # a raised pad, 2 at its top
print(round(pad.bbox().max.z, 9))                                  # 5.0
dome = surface([[(x, y, 8 - 0.01 * ((x - 20) ** 2 + (y - 20) ** 2)) for y in range(0, 41, 5)] for x in range(0, 41, 5)])
face = dome.faces()[0]
seat = [face.raycast((x, y, 50), (0, 0, -1))[0].point for x, y in ((15, 15), (25, 15), (25, 25), (15, 25))]
flat = dome.flatten(face, seat, Plane.XY.offset(7.5))              # flat at z 7.5 inside the seat
print(round(flat.faces()[0].raycast((20, 20, 50), (0, 0, -1))[0].point.z, 9))  # 7.5
```

`push` takes the move as `by` (a distance along the face's normal, or a vector) or `to` (a point),
`normal` (the face's normal there afterwards), `radius` (how far along the face it changes; default:
up to the nearest edge) and `continuity` (`"G0"`, `"G1"`, `"G2"`: how the face stays joined to its
neighbours where the change reaches its border). A region for `warp` and `flatten` is a closed wire
on the face (on a curved face, `project` an outline onto it), a sketch placed on the face, or polygon
points; the change stays within the rectangle around the region along the face's two directions, and
`continuity` (`"G2"`, `"G1"`, `"crease"`) sets how it meets the rest of the face. Unlike a `Lattice`
(`deform`), which moves the whole part, these touch one face only, and the point or region exactly.

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
