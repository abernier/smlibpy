# Concepts

These are the ideas the rest of the API builds on.

## Shapes are values

Every shape is immutable. Operations return new shapes and never change their inputs:

```python
from smlibpy import *

box = Box(20, 20, 20)
rounded = box.fillet(box.edges(), 2)   # box is unchanged
print(box.volume, rounded.volume)
```

So you can keep intermediate results, branch off variants and reuse parts without copying
them.

| Type | What it is | Made by |
|---|---|---|
| `Part` | A solid: one or more closed volumes | `Box`, `Cylinder`, `extrude`, `revolve`, ... |
| `Sketch` | A planar region on a plane, possibly with holes | `Rectangle`, `Circle`, `Polygon`, `Profile(...).close()`, `make_face`, ... |
| `Shell` | A surface: faces that do not enclose a volume | `surface`, `ruled`, extruding an open curve, ... |
| `Face` | One face of a body | `part.faces()` |
| `Wire` | A chain of edges, open or closed | `Polyline`, `Profile(...).wire()`, `Wire([...])`, `face.outer_wire()` |
| `Edge` | One curve: line, arc, circle, ellipse, spline | `Line`, `CenterArc`, `Spline`, `part.edges()` |
| `Vertex` | A point | `part.vertices()` |

## Combining shapes

Parts combine with operators, sketches too:

```python
a = Box(20, 20, 20)
b = Cylinder(8, 30)
union = a + b
difference = a - b
intersection = a & b

ring = Circle(10) - Circle(6)          # 2D works the same way
```

The right-hand side may be a list: `part - [tool1, tool2]` subtracts both.

## Planes

A `Plane` is a coordinate system: an origin, an x direction and a normal. Sketches are
drawn around the origin of the world XY plane and then placed:

```python
Plane.XY, Plane.XZ, Plane.YZ                 # the world planes
Plane.top, Plane.front, Plane.right          # the same planes by their view names
Plane.back, Plane.left, Plane.bottom         # and the opposite sides

lid_plane = Plane.XY.offset(30)              # parallel, 30 above
tilted = Plane.XY.rotated(x=30)              # rotated about its own X axis
custom = Plane(origin=(10, 0, 5), z_dir=(1, 1, 0))
```

On the side planes the local Y axis points up, so a profile drawn "upwards" stands up.

A planar face is a plane too: `face.plane` has its origin at the face's center and its
normal pointing out of the part.

## Placing shapes

There are three ways to move a shape, all equivalent:

```python
peg = Cylinder(3, 10)

moved = peg.translate(10, 0, 5)
moved = Pos(10, 0, 5) * peg
turned = Rot(z=45) * Box(10, 2, 2)           # rotate about the world axes, in degrees
on_top = Circle(5).on(Plane.XY.offset(20))   # place a shape drawn on XY onto a plane
```

`Pos` and `Rot` are `Location`s. Locations compose with `*`, applied right to left:
`Pos(10, 0, 0) * Rot(z=90) * shape` first rotates, then moves.

`shape.on(target)` places a shape onto a plane or a face. It is the usual way to draw on a
part:

```python
plate = Box(60, 40, 8)
top = plate.faces().top()
slot = Slot(20, 6).on(top).extrude(-3)
plate -= slot
```

## Patterns

Location patterns multiply shapes into lists of copies:

```python
GridLocations(20, 15, 3, 2) * Circle(2)          # 6 circles on a 3 x 2 grid
PolarLocations(30, 8) * Cylinder(3, 10)           # 8 cylinders on a circle of radius 30
HexLocations(6, 5, 4) * RegularPolygon(3, 6)     # a honeycomb
Locations((0, 0), (10, 5), (20, 0)) * Sphere(1)  # any positions
```

Patterns place onto faces as well: `(GridLocations(20, 20, 2, 2) * Hole(2, 5)).on(face)`.

## Selecting topology

`part.faces()`, `part.edges()` and `part.vertices()` return `ShapeList`s, lists with
selection methods that chain:

```python
part = Box(30, 20, 10) - Cylinder(4, 20)

part.faces().top()                        # faces with the highest center
part.faces().facing(-Z)                   # faces whose normal points down
part.edges().parallel_to(Z)               # straight edges along Z
part.edges().circles()                    # circular edges
part.faces().sort_by("area")[-1]          # the largest face
part.edges().group_by(Z)                  # edges grouped by height
part.edges().parallel_to(Z).nearest((15, 10, 0))
```

Selections always return lists. Where a single shape is needed, a list with exactly one
element is accepted (`sketch.on(part.faces().top())`); `.one()` asserts there is exactly one,
`.first` and `.last` pick one. See [selecting](selecting.md) for every selector.

## Alignment

Primitives are centered on the origin. `align` moves them, per axis:

```python
Box(20, 20, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))   # stands on XY
Cylinder(5, 10, align=Align.MIN)                                 # in the positive octant
```

## Errors

An operation that cannot be done raises `ModelingError` with an explanation. Failures the
kernel reports come as `KernelError` (a `ModelingError`) with the kernel's status and, where
possible, a hint. smlibpy checks results where the kernel does not, for example rounds that
would overlap:

```python
cube = Box(10, 10, 10)
try:
    cube.fillet(cube.edges(), 6)
except ModelingError as e:
    print(e)   # fillet: the radius is too large; the rounds on edges 10 apart would overlap ...
```
