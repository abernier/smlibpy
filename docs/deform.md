# Deformations

A deformation changes a finished part as a whole. Instead of modeling a twisted column, a
bent handle or a tapered grip directly, you model the straight, simple part with its holes,
slots and rounds, and then twist, bend or taper it. The holes and rounds go along. Unroll
does the opposite of a bend: it lays a part wrapped around an axis out flat. For free-form
changes, a lattice of control points around the part lets you pull and push it into shape.

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

Wherever the mathematics allows it, the results are exact:

- **Analytic faces stay analytic.** Where the exact image of a face is a plane, cylinder or
  cone, the result has that surface, and lines and circles stay lines and circles. A plate
  bent about an axis gets exact cylinders there (so `faces().cylinders()`, `Face.radius` and
  sheet metal's `bends()` and `unfold` see the bend), a tapered cylinder is an exact cone, the
  turned ends of a twisted bar are planes, a rolled sheet unrolls into planes, and faces a
  map leaves in place (the bottom of a block whose top a lattice lifts) keep what they were.
  STEP files write them as planes, cylinders and cones.
- **Lattices and tapers** are polynomial maps of space. Every other face of the result is a
  NURBS that is the exact image of the original face; a pillow made with a lattice is exactly
  the shape the control points describe.
- **Twists, bends and unrolls** turn space with sines and cosines. Where the image is not
  analytic (the sides of a twisted bar, a hole across a bend), a NURBS can only follow it:
  those faces are within a tolerance of the exact shape, by default a millionth of a
  millimeter (`tolerance=1e-6`), and the straight rulings of a twisted face stay straight.

The NURBS faces keep the parameterization of the original face, so the part stays as
watertight as it was. Volumes behave as they should: a twist keeps the volume, a bend keeps
it when the part bends about the middle of its cross-section, and a taper changes it exactly
as the scaled cross-sections say. `part.volume` measures deformed parts as exactly as any
other (to 1e-7 relative or better, within the tolerance of the fitted faces):

```python
bar = Box(20, 20, 100).twist(90)
print(round(bar.volume, 3))                           # 40000.0
cone = Cylinder(10, 50).taper(0.5)
print(cone.volume, cone.faces().sort_by(Z)[1].geom_type)   # 9162.98, the frustum's volume; cone
plate = Box(200, 40, 10).bend(90, radius=25)
print(plate.volume, len(plate.faces().cylinders()))   # 80000.0 (to 1e-12), 2
```

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

Planes across the bend become exact cylinders about the bend axis. A bent plate is therefore
a sheet metal part: `bends()` finds the bend, and `unfold()` lays it flat again with the
K-factor the bend's neutral layer gives (where the plane's origin lies in the thickness: 0.5
for a plate bent about its middle layer):

```python
plate = Box(200, 40, 10).bend(90, radius=25)
print(plate.bends())                  # [Bend(angle=90, radius=20, thickness=10, k_factor=0.5, ...)]
print(plate.unfold().bbox().size)     # 200 x 40 x 10 again
```

For sheet metal, `fold()` and `flange()` (see [sheet metal](sheet-metal.md)) are the better
tools: they bend at a line on the sheet with an inside radius and a K-factor, and keep flat
legs on both sides.

## Unroll

`unroll(radius=...)` lays a part wrapped around an axis out flat: the inverse of a bend over
the whole part. A point at distance r from the axis and at an angle about it goes to
distance r from the axis and the arc length `radius * angle` across, so the layer at
`radius` (the neutral layer) keeps its length; material inside it gets longer, material
outside it shorter. Cylinders about the axis become planes and circles about it lines:

```python
ring = Cylinder(52, 40) - Cylinder(50, 50) - Box(60, 60, 50, align=(Align.MIN, Align.MIN, Align.CENTER))
strip = ring.unroll(radius=51)                 # the three quarter ring, flat
print(len(strip.faces().planar()), round(strip.volume, 6) == round(ring.volume, 6))   # 6 True
label = ring.unroll(radius=52, start=(-2, -1, 0))  # the outside keeps its length
```

The axis defaults to Z through the origin. `start` is the direction from the axis to the
line that stays in place (default: the middle of the part's angle about the axis); the part
must not reach the axis, must cover less than a full turn about it, and must not reach the
half-plane opposite `start`, where the unrolled part would tear. For rolled sheet metal,
`unfold()` unrolls at the neutral radius `radius + k_factor * thickness` by itself.

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

A lattice is a global map: every point pulls the whole box, most near itself, weighted by
Bernstein polynomials. The middle point of the top layer of a 3 x 3 x 3 lattice, moved by 8,
lifts the middle of the top face by 2 (8 * 1/2 * 1/2) and the rest of the top less, down to
nothing at its corners; corner points move their corner fully. More points concentrate a
point's pull nearer to it but never confine it, and raise the degree of the exact result:
moved by 5, the middle point of the top of a 7 x 7 x 2 lattice around `Box(60, 40, 20)` lifts
the middle of the top by 0.49 and a place 25 mm from it still by 0.014. Faces the map leaves in
place (the bottom here) keep their type. A lattice is therefore the tool for overall shape, not
for a bump on one face: push or warp that face instead (`Part.push`, `Part.warp`, see
[Shaping faces](surfaces.md#shaping-faces-push-warp-flatten)), which changes it near a point or
within a region and leaves the other faces as they are. A point moved past its neighbours would fold
the part onto itself; `apply` refuses that with an error.

```python
lat = Lattice(Box(60, 40, 20), (7, 7, 2))
lat.move((3, 3, -1), (0, 0, 5))           # the middle of the top layer up by 5
print([round(lat.map((x, 0, 10)).z - 10, 4) for x in (0, 10, 20, 25)])   # [0.4883, 0.3429, 0.0837, 0.0139]
```

## Curves and points

The deformations also take edges, wires and points, and move them exactly as they move a part.
An edge comes back as an edge, a wire as a wire, a point as a `Vector` and a list of points as a
list. Deform a path, then sweep along it, to keep a part and its path consistent:

```python
path = bend(Wire([Line((-50, 0, 0), (50, 0, 0))]), 90, radius=10)
print([e.geom_type for e in path.edges()])          # ['line', 'circle', 'line']: an exact arc
pipe = sweep(Circle(2), path)
rail = twist(Line((10, 0, 0), (10, 0, 100)), 90)    # a quarter turn of a helix (within 1e-6)
rim = taper(CenterArc((0, 0, 50), 10, 0, 360), 0.5, start=0, end=100)
print(rim.geom_type, rim.radius)                    # circle 7.5: halfway, 3/4 of the size
flat = unroll(Helix(pitch=100, height=40, radius=10), radius=10)
print(flat.geom_type)                               # line: a helix unrolls straight
```

Every edge is split where it crosses `start` and `end`: a Wire gets an edge for every piece (a
straight path bent in its middle is a line, an exact arc and a line), an Edge stays one edge
(its pieces joined into one B-spline; pass `Wire([edge])` to keep them apart). Pieces whose image
is a line or circle are exact lines and arcs, pieces under lattices and tapers exact B-splines,
the others within `tolerance` of the exact image.

Points map the same way, so a point of a part can be followed through a deformation. A point
has no length along the axis: give twist and taper (and bend without a radius) the `start` and
`end` of the part it belongs to; points before `start` stay, points beyond `end` move as the
part's end does. `Lattice.map(point)` is the lattice's point map:

```python
bar = Box(100, 10, 10, align=(Align.MIN, Align.CENTER, Align.CENTER))
tip = bend((100, 0, 0), 90, start=0, end=100)       # where bar.bend(90) puts the middle of its end
print(tip)                                          # (63.662, 0, 63.662): radius 200 / pi
print(twist([(10, 0, 0), (10, 0, 100)], 90, start=0, end=100))
```

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
