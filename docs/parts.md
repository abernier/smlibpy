# Parts

A `Part` is a solid. It may consist of several separate bodies (`part.solids()` lists them).

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
```

All are centered on the origin; `align` changes that per axis:

```python
Box(40, 30, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))   # sits on the XY plane
```

## Extrude

```python
plate = Rectangle(40, 30).extrude(5)              # along the sketch normal
both = Circle(5).extrude(10, both=True)           # 10 to each side
drafted = Rectangle(30, 30).extrude(10, taper=8)  # sides lean in by 8 degrees
slanted = Circle(5).extrude(20, direction=(0, 1, 2))
```

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

## Loft

A loft blends a series of cross sections:

```python
transition = loft([Rectangle(30, 30), Circle(12).translate(0, 0, 25)])
vase = loft([Circle(15), Circle(25).translate(0, 0, 30), Circle(10).translate(0, 0, 60)])
straight = loft([Rectangle(20, 20), RegularPolygon(10, 6).translate(0, 0, 20)], ruled=True)
```

## Sweep

A sweep moves a profile along a path. smlibpy puts the center of the profile's box on the
start of the path and turns it to face along the path, so profiles are simply drawn in XY.
Along a path of several edges the profile keeps its orientation: tangent edges are swept in one
go, and at a corner of a 3D path it turns by the smallest rotation from one tangent to the next.

```python
path = Spline((0, 0, 0), (0, 20, 30), (40, 20, 50))
tube = sweep(Circle(3) - Circle(2), path)

spring = sweep(Circle(1), Helix(pitch=5, height=30, radius=10))

frame = sweep(Rectangle(6, 4), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40)))  # mitered corner
elbow = sweep(Circle(4), Wire([Line((0, 0, 0), (0, 0, 20)),
                               CenterArc((15, 20), 15, 180, -90, plane=Plane.front)]))
```

`translational=True` keeps the profile's orientation fixed along the path instead of turning
it.

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
