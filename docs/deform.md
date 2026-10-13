# Deformations

A deformation changes a finished part as a whole. Instead of modeling a twisted column, a
bent handle or a tapered grip directly, you model the straight, simple part with its holes,
slots and rounds, and then twist, bend or taper it. The holes and rounds go along. For
free-form changes, a lattice of control points around the part lets you pull and push it
into shape.

```python
from smlibpy import *

column = RegularPolygon(20, 6).extrude(120).twist(90)
handle = Box(160, 10, 6).bend(180, radius=25)
grip = Cylinder(12, 90).taper(0.7)
```

Every deformation moves each point of space, and every face, edge and vertex of the part
moves with it. The result is again a closed solid with the same faces and edges, so
selections such as `faces().sort_by(Z)[-1]` work as before.

## Exact results

The results are NURBS, and wherever the mathematics allows it they are exact:

- **Lattices and tapers** are polynomial maps of space. Every face of the result is the
  exact image of the original face. A tapered cylinder is an exact cone; a pillow made with
  a lattice is exactly the shape the control points describe.
- **Twists and bends** turn space with sines and cosines, which no NURBS can reproduce. Their
  faces are within a tolerance of the exact shape, by default a millionth of a millimeter
  (`tolerance=1e-6`). Faces that are only turned stay exact: the ends of a twisted bar are
  planes, and the straight rulings of its twisted sides stay straight.

Each face keeps the parameterization of the original face, so the part stays as watertight
as it was. Volumes behave as they should: a twist keeps the volume, a bend keeps it when the
part bends about the middle of its cross-section, and a taper changes it exactly as the
scaled cross-sections say.

```python
bar = Box(20, 20, 100).twist(90)
print(bar.mass_properties(accuracy=1e-10).volume)    # 40000.0
cone = Cylinder(10, 50).taper(0.5)
print(cone.mass_properties(accuracy=1e-10).volume)   # 9162.98, the frustum's volume
```

Measure deformed parts with `mass_properties(accuracy=1e-10)`: the kernel's default
integration (`part.volume`) can be a few parts in ten thousand off on bent parts.

## Twist

`twist(angle)` turns every cross-section about an axis, by an angle that grows evenly along
it. The axis is a line (default: the Z axis through the origin); the angle follows the
right-hand rule, like `rotate`. By default the twist runs over the whole part; `start` and
`end` (distances along the axis) limit it. What lies before `start` stays, what lies beyond
`end` is turned as a whole:

```python
baluster = Box(16, 16, 200).twist(360, start=-50, end=50)
print(len(baluster.faces()))    # 14: the sides are split where the twist begins and ends
```

## Taper

`taper(scale)` scales the cross-sections toward an axis, from their size at `start` to
`scale` times that size at `end`. Lines along the axis stay straight, so a cylinder becomes
a cone and a box a frustum of a pyramid:

```python
post = Box(40, 40, 60).taper(1.4, start=10)    # flares from z = 10 upward
wedge = Box(100, 20, 20).taper(0.25, axis=X)   # along X
```

## Bend

`bend(angle)` bends a part around an axis, like a bar bent over a mandrel. A plane describes
the bend: its x direction runs along the part, a positive angle bends toward its y
direction, and the bend axis is parallel to its normal. The default `Plane.XZ` bends a part
lying along X upward. The layer of the part through the plane's origin keeps its length (the
neutral layer); material on the inside of the bend is compressed, material on the outside
stretched.

Without a radius the whole part bends into an arc of the given angle. With a radius, a
section of length radius times angle bends, centered on the plane origin, and the rest of
the part continues straight on both sides:

```python
arc = Box(100, 10, 10).bend(90)                                # a quarter circle
elbow = Cylinder(6, 150).rotate(Y, 90).bend(90, radius=30)     # a pipe elbow with straight legs
pipe = elbow.shell(1, elbow.faces().planar())                  # hollow, open at both ends
down = Box(100, 10, 10).bend(-90, radius=20, start=10)         # down, starting at x = 10
```

The radius must be larger than the part's thickness on the inside of the bend. Bends of
more than half a turn with long legs can make the legs cross; that is not detected.

## Lattice

A `Lattice` is a grid of control points around a part, evenly spaced over its bounding box
to start with. Move the points, then apply the lattice: space moves smoothly with them, and
the part with it. Points can be moved one at a time, as whole layers, or through the
`points` array:

```python
block = Box(60, 40, 20)
lat = Lattice(block, 3)                   # 3 x 3 x 3 points
lat.move((1, 1, -1), (0, 0, 8))           # lift the middle of the top
lat.scale(lat.layer(X, 0), (1, 0.8, 1))   # narrow the -X end
pillow = lat.apply(block)                 # or block.deform(lat)
```

A point pulls the region around it: the middle point of the top layer of a 3 x 3 x 3
lattice, moved by 8, lifts the middle of the top face by 2. Corner points move their corner
fully. More points give more local control and higher degrees in the exact result. A point
moved past its neighbours would fold the part onto itself; `apply` refuses that with an
error.

## Deform or model directly?

Deform when a simple part gets a smooth overall change and its features should follow:
twisted vases, columns and blades, bent handles and brackets with holes, tapered grips and
legs, soft free-form tops. Model directly when the shape is easier to draw (a tube with
several bends along a known path is a sweep), when a feature must keep its exact shape
(add it after the deformation, so a bore drilled into a tapered grip stays round), or when
the part will be offset outward, which the kernel cannot do for most deformed parts.

Meshes of twisted parts (STL, glTF, pictures) keep to the tolerance you ask for, but they
need many more triangles than the straight part: a face that stays straight across while it
twists along is divided until its pieces are flat, and with it the rest of the part.
`Box(20, 20, 100).twist(90).mesh()` has 2076 triangles where the box has 12. STEP files are
exact.
