# Sketches

A `Sketch` is a planar region: one or more faces on a plane, possibly with holes. Sketches
are where most parts begin.

## Shapes

Every constructor builds in the world XY plane, centered on the origin:

```python
from smlibpy import *

Rectangle(40, 20)                    # width along X, height along Y
RoundedRectangle(40, 20, 4)          # corner radius 4
Circle(10)
Ellipse(15, 8)
RegularPolygon(10, 6)                # hexagon, corners at radius 10
RegularPolygon(10, 6, inscribed=True)  # hexagon 20 across the flats
Slot(30, 10)                         # 30 long overall, 10 wide
Trapezoid(40, 15, 60)                # base 40, height 15, 60 degree sides
Polygon((0, 0), (30, 0), (30, 10), (10, 25), (0, 25))   # points stay where they are
```

`align` moves a sketch relative to the origin: `Rectangle(40, 20, align=Align.MIN)` puts
its lower left corner on the origin.

## Combining

```python
plate = RoundedRectangle(60, 40, 6) - Circle(8) - GridLocations(44, 24, 2, 2) * Circle(2.5)
cross = Rectangle(40, 8) + Rectangle(8, 40)
lens = Circle(10).translate(-5, 0) & Circle(10).translate(5, 0)
```

`+` unites, `-` subtracts, `&` intersects and `^` keeps what is in exactly one of them.
Sketches must lie in the same plane.

## From curves

A closed chain of edges becomes a region with `make_face`. Holes are further closed wires:

```python
outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
bolt_hole = Wire([CenterArc((12, 12), 4, 0, 360)])
bracket = make_face(outline, bolt_hole)
```

Curves for outlines:

| Function | Curve |
|---|---|
| `Line(a, b)` | straight segment |
| `Polyline(*points, close=False)` | chain of segments (a `Wire`) |
| `PolarLine(start, length, angle)` | segment at an angle |
| `CenterArc(center, radius, start_angle, arc_size)` | arc around a center; `arc_size=360` is a circle |
| `ThreePointArc(a, through, b)` | arc through three points |
| `RadiusArc(a, b, radius)` | arc of a radius between two points |
| `SagittaArc(a, b, sagitta)` | arc bulging by `sagitta` |
| `TangentArc(a, b, tangent)` | arc leaving `a` along `tangent` |
| `EllipticalArc(center, rx, ry, start, end)` | ellipse or part of one |
| `Spline(*points, tangents=None, closed=False)` | smooth cubic through points |
| `Bezier(*control_points, weights=None)` | Bézier curve, rational with weights |
| `FilletPolyline(*points, radius=r)` | polyline with rounded corners |

Edges chain into wires with `Wire([...])` (they are ordered and flipped as needed) or with
`+`. Mirroring half an outline is a common pattern:

```python
half = Wire([
    Line((-25, 0), (-25, -7.5)),
    ThreePointArc((-25, -7.5), (0, -15), (25, -7.5)),
    Line((25, -7.5), (25, 0)),
])
outline = half + half.mirror(Plane.XZ)
body = make_face(outline)
```

## Rounding and offsetting

```python
Rectangle(40, 20).fillet(3)                   # round every corner
Polygon((0, 0), (30, 0), (0, 20)).fillet(2)   # works on any straight-edged outline
Rectangle(40, 20).offset(2)                   # grow; corners become arcs
Rectangle(40, 20).offset(2, round=False)      # grow with sharp corners
(Circle(10) - Circle(5)).offset(-1)           # shrink: the hole grows
```

## Placing a sketch

Sketches move like any shape. Usually they go onto a plane or onto a face of a part:

```python
on_front = Rectangle(20, 10).on(Plane.front)          # stands up in XZ
up_high = Plane.XY.offset(15) * Circle(5)             # Plane * sketch is the same as .on()

part = Box(50, 30, 10)
on_face = Slot(20, 6).on(part.faces().top())          # centered on the top face
off_center = (Pos(10, 5) * Circle(3)).on(part.faces().top())
```

On a face, the sketch's X axis follows world X where it can; on vertical faces its Y axis
points up. `face.plane` shows the exact frame.

## Measuring

```python
s = RoundedRectangle(40, 20, 4) - Circle(5)
s.area                       # exact
s.center()                   # centroid
s.bbox()
len(s.faces()), len(s.faces()[0].inner_wires())
```

From here, sketches become parts: [parts](parts.md).
