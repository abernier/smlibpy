# Parts

A `Part` is a solid. It may consist of several separate bodies (`part.solids()` lists them, a
body inside a cavity of another too).

## Primitives

```python
from smlibpy import *

Box(40, 30, 10)                  # length (X), width (Y), height (Z)
Cylinder(5, 20)                  # radius, height, along Z
Cone(10, 4, 15)                  # bottom radius, top radius, height
Cone(10, 0, 15)                  # a pointed cone
Sphere(8)
Torus(20, 4)                     # major and minor radius
Wedge(20, 10, 8)                 # a ramp
Pyramid(20, 12, 15)              # a 20 x 12 base, the apex 15 above its center
```

All are centered on the origin; `align` changes that per axis:

```python
Box(40, 30, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))   # sits on the XY plane
```

Cylinders, cones, spheres and tori also come as sectors, from the +X axis counter-clockwise
about Z, with exact faces (planes on the cut sides); `AnnularSector` is a sector of a tube. Like
every primitive a sector is centered by its bounding box; `align=None` keeps the axis on Z:

```python
Cylinder(10, 20, arc_size=90, align=None)        # the quarter from +X to +Y
Cone(10, 4, 15, arc_size=120)
Sphere(10, arc_size1=0, align=None)              # the upper half: latitudes 0 to 90
Sphere(10, arc_size1=-30, arc_size2=60, arc_size3=90)
Torus(20, 4, major_angle=90, align=None)         # an elbow
AnnularSector(40, 50, 8, 30)                     # inner and outer radius, height, angle
```

A torus also keeps part of its tube: `minor_start_angle` and `minor_end_angle` (degrees, as
build123d takes them) slice the tube's circle from its center, measured from the side away from
the axis (0) towards +Z (90); the cut sides are planes, cylinders or cones:

```python
Torus(20, 5, minor_start_angle=0, minor_end_angle=180)     # the upper half, flat underneath
Torus(20, 5, minor_start_angle=-90, minor_end_angle=90)    # the outer half: a bead on a cylinder
```

## Extrude

```python
plate = Rectangle(40, 30).extrude(5)              # along the sketch normal
both = Circle(5).extrude(10, both=True)           # 10 to each side
drafted = Rectangle(30, 30).extrude(10, taper=8)  # sides lean in by 8 degrees
flared = Rectangle(30, 30).extrude(10, taper=-8, corners="round")  # out, corners rounded off
slanted = Circle(5).extrude(20, direction=(0, 1, 2))
```

The walls of a tapered extrusion are drafted planes, cones and cylinders (as `Part.draft` makes
them: selections by type find them, they draft again, and STEP files carry them as such), B-spline
surfaces where the profile has other curves. `corners="round"` rounds off the corners the taper
pulls apart (the convex ones of an outward taper, the concave ones of an inward one), as an offset
rounds them. A taper that closes the profile before the end raises `ModelingError`.

With a `direction` the amount is measured along it. A direction in the sketch plane raises
`ValueError`, and one less than 0.06 degrees off the plane warns, since the solid is then thinner
than a thousandth of the amount. The walls of straight edges are planes. An extrusion along a
direction is checked: where the kernel makes it invalid (some curved profiles in tilted planes,
mostly within a degree of the plane) it is made again turned about the normal, or swept along a
line. A taper drafts the walls about the normal, so with a taper only a `direction` along the
normal (either way) is taken; one across it raises `ValueError`, and so does a taper on an open
curve.

A negative amount extrudes against the normal, which is how pockets are cut into faces:

```python
part = Box(50, 50, 20)
part -= Rectangle(30, 20).on(part.faces().top()).extrude(-5)
```

## Revolve

Revolve a sketch about an axis in its plane. By default the axis is the sketch's local Y
axis through its plane origin. A `Polygon` keeps its plane origin at the world origin, so on
`Plane.front` the default axis is the world Z axis, the usual lathe setup. Centered
constructors (`Rectangle`, `Circle`, ...) and `make_face` put the plane origin in the middle
of the region: for `Rectangle(10, 20).translate(15, 0).on(Plane.front)` the default axis is
the line x = 15, which crosses the region, so `revolve()` raises. Pass the axis:

```python
section = Polygon((10, 0), (30, 0), (30, 5), (15, 5), (15, 20), (10, 20))
spool = section.on(Plane.front).revolve()
quarter = section.on(Plane.front).revolve(Z, 90)
tube = Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve(Z)
```

The walls of a revolve are cylinders, cones, spheres and tori wherever its edges are lines and
arcs, also for a full turn, so `tube.faces().cylinders()` finds both walls, `Face.radius` and
drafts work on them, and STEP files carry them as such. Spline edges give surfaces of
revolution. Angles within 0.01 degrees of 360 are a full turn.

## Swing

A swing revolves a profile about Z along an outline of any shape instead of a circle: at each
height the section is the outline, scaled about the Z axis to pass through the profile on the
+X side. The profile is drawn as for a lathe (x the distance from the axis, on `Plane.front`);
the outline is a closed curve around the Z axis in XY that every ray from the axis crosses once:

```python
cup = Polygon((0, 0), (30, 0), (30, 40), (0, 40)).on(Plane.front)
oval = swing(cup, Ellipse(30, 20))                                   # pi * 30 * 20 * 40
bottle = Polygon((0, 0), (20, 0), (20, 50), (8, 60), (8, 70), (0, 70)).on(Plane.front)
flask = bottle.swing(RoundedRectangle(40, 30, 8))                    # 40 x 30, a 16 x 12 neck
```

The faces are exact products of the profile's and the outline's curves (B-splines). A circle
about the origin gives the revolve; an open curve gives a surface.

## Loft

A loft blends a series of cross sections:

```python
transition = loft([Rectangle(30, 30), Circle(12).translate(0, 0, 25)])
vase = loft([Circle(15), Circle(25).translate(0, 0, 30), Circle(10).translate(0, 0, 60)])
straight = loft([Rectangle(20, 20), RegularPolygon(10, 6).translate(0, 0, 20)], ruled=True)
```

`start_tangent` and `end_tangent` set the direction a loft leaves its first section in and
reaches its last in, so that it meets the bodies there smoothly; `closed=True` runs it on from the
last section through the first again (a ring without ends):

```python
neck = loft([Circle(10), Circle(4).translate(0, 0, 30)], start_tangent=Z, end_tangent=Z)
bottle = Circle(10).extrude(-40) + neck + Circle(4).translate(0, 0, 30).extrude(10)  # smooth joints
ring = loft([Rot(z=45 * i) * Pos(10, 0, 0) * Rot(x=90) * Circle(2 + i % 2) for i in range(8)], closed=True)
```

A tangent can also be a face that ends at the section: the loft continues it, tangent to it all
along the section. `rails` are curves a loft of open sections runs along, through every section:
the surface passes through them exactly, as through the sections:

```python
can = Cylinder(10, 20)
rim = max((e for e in can.edges() if e.geom_type == "circle"), key=lambda e: e.center().z)
spout = loft([rim, Circle(4).translate(0, 0, 30)], start_tangent=can.faces().cylinders())

r1, r2 = Spline((0, 0, 0), (-2, 10, 1), (0, 20, 0)), Spline((20, 0, 0), (24, 10, 2), (20, 20, 0))
arcs = [ThreePointArc(r1.point_at(t), (r1.point_at(t) + r2.point_at(t)) * 0.5 + Vector(0, 0, 4), r2.point_at(t))
        for t in (0, 0.5, 1)]
panel = loft(arcs, rails=[r1, r2])        # a Shell through the arcs and both rails
```

## Sweep

A sweep moves a profile along a path. smlibpy puts the center of the profile's box on the
start of the path and turns it to face along the path, so profiles are simply drawn in XY.
Along a path of several edges the profile keeps its orientation: tangent edges are swept in one
go, and at a corner of a 3D path it turns by the smallest rotation from one tangent to the next.
Where the kernel cannot sweep an open path that way, each edge is swept on its own, turned to its
own start, with a warning unless the profile is round. A loop closed with a kink
(`Spline(*pts, pts[0])`) is swept in two halves fused where its ends cross; where that fuse fails
it is swept in pieces as before 0.5.0, and a round profile with its seam turned. Faces without
area that such a fuse leaves are taken out, or the sweep raises `ModelingError`. A planar path of
several edges gets mitered corners in any plane, with the profile placed as on any other path.

```python
path = Spline((0, 0, 0), (0, 20, 30), (40, 20, 50))
tube = sweep(Circle(3) - Circle(2), path)

spring = sweep(Circle(1), Helix(pitch=5, height=30, radius=10))

frame = sweep(Rectangle(6, 4), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40)))  # mitered corner
elbow = sweep(Circle(4), Wire([Line((0, 0, 0), (0, 0, 20)),
                               CenterArc((15, 20), 15, 180, -90, plane=Plane.front)]))
```

`translational=True` keeps the profile's orientation fixed along the path instead of turning
it. `anchor` puts another point of the profile on the path: `"origin"` (the origin of the
sketch's plane, (0, 0) of a `Polygon` drawn on XY) or a point of the profile's plane:

```python
ell = Polygon((0, 0), (6, 0), (6, -1), (-1, -1), (-1, 5), (0, 5))   # an L drawn by its inner corner
trim = sweep(ell, path, anchor="origin")                             # the corner follows the path
```

An open profile that runs from the path to a second rail sweeps along both with `rails`: it is
moved, turned and scaled so that its ends stay on them, and the surface passes through both:

```python
left, right = Spline((0, 0, 0), (2, 15, 1), (0, 30, 0)), Spline((20, 0, 0), (26, 15, 3), (22, 30, 0))
hood = sweep(ThreePointArc((0, 0, 0), (10, 0, 4), (20, 0, 0)), left, rails=right)
```

A path that is a single line is swept as an extrusion, a single arc (or circle) as a revolve:
planes, cylinders, cones and tori, the same faces a path of several edges gives. A profile that
reaches across the axis of the arc raises `ModelingError` (it would sweep through itself).

`scale` grows or shrinks the profile along the path, about the point of it that sits on the
path: `(start, end)` evenly along the length, `[(t, s), ...]` through scales at fractions of the
length (a smooth curve that does not overshoot them), or a function of the fraction:

```python
horn = sweep(Circle(2), path, scale=(1, 3))
taper_spring = sweep(Circle(1), Helix(pitch=8, height=40, radius=15), scale=(1, 0.5))
bulge = sweep(Circle(2), Line((0, 0, 0), (0, 0, 40)), scale=[(0, 1), (0.5, 1.6), (1, 1)])
```

Along the path the profile turns as little as it can, which keeps its attitude to the plane of a
planar path. Along a helix it keeps its attitude to the helix's axis instead (a thread tooth or a
flat spring wire stays radial), also on conical helices and chains of helices. `up` keeps it at
its angle to a direction (or, with `up="frenet"`, to the path's curvature), and `twist` turns it
about the path on top of that, by an angle spread along the path or a function of the fraction
of its length:

```python
flat_spring = sweep(Rectangle(2, 0.5), Helix(pitch=4, height=40, radius=10))  # stays radial
rail = sweep(Rectangle(4, 2), path, up=Z)                                      # stays upright
bar = sweep(Rectangle(10, 2), Line((0, 0, 0), (0, 0, 100)), twist=180)        # a half turn
ribbon = sweep(Line((-5, 0, 0), (5, 0, 0)), Line((0, 0, 0), (0, 0, 100)), twist=lambda s: 360 * s * s)
```

Round a closed path with corners that is not planar, the profile carried by the smallest turns
comes back turned about the path; that turn is spread along it, so that the profile meets itself
where the loop closes. Where `up="frenet"` would make the profile spin about a path that nearly
straightens, the sweep raises `ValueError`: pick `up` a direction there.

A `Helix` takes any number of turns: the kernel fits up to 120 in one go, longer ones in pieces
of whole turns joined into one edge (`Helix(2, 400, 20)`, 200 turns, is 25135.87 long against
25135.92 for the exact helix). Sweeps along long helices go too (400 turns tested); with the
kernel's own frame (`orient=False`) a long helix is swept in pieces.

## Booleans and patterns

```python
block = Box(60, 40, 20)
block -= Cylinder(8, 30)                                      # through hole
block += Cylinder(6, 10).translate(0, 0, 15)                   # boss on top
block &= Sphere(40)                                            # keep what's inside a sphere

plate = Box(80, 60, 6) - GridLocations(60, 40, 2, 2) * Cylinder(3, 10)
wheel = Cylinder(40, 8) - PolarLocations(25, 6) * Cylinder(6, 10)
```

## Holes

Hole tools point down from the origin, so placed on a face they drill into it:

```python
part = Box(60, 40, 10)
top = part.faces().top()
part -= Hole(3, 10).on(top)                                             # plain, at the center
part -= (GridLocations(40, 20, 2, 2) * CounterBoreHole(2, 4, 3, 10)).on(top)
part -= (Pos(-20, 0) * CounterSinkHole(2, 4, 10)).on(top)
```

`CounterBoreHole(radius, counter_bore_radius, counter_bore_depth, depth)` and
`CounterSinkHole(radius, counter_sink_radius, depth, angle=82)`.

## Moving and copying

Parts move like every shape: `translate`, `rotate(axis, angle)`, `mirror(plane)`,
`scale(factor)`, `moved(location)` and `on(plane)`.

```python
half = Box(20, 10, 10).translate(10, 0, 0)
whole = half + half.mirror(Plane.YZ)
```

Next: [features](features.md).
