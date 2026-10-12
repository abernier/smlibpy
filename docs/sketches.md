# Sketches

A `Sketch` is a planar region: one or more faces on a plane, possibly with holes. Most parts
begin as a sketch that is extruded or revolved. Sketches are drawn in the XY plane around the
origin and placed afterwards; every operation returns a new sketch and leaves its input as it
was. Lines stay lines and arcs stay circles through every 2D operation, so areas, radii and the
faces of the parts made from them are exact.

There are three ways to make the outline: standard shapes, the `Profile` pen for outlines drawn
segment by segment, and shapes built from other geometry (`Hull`, `Stroke`, `make_face`).

## Shapes

Every shape is centered on the origin. They share their options: `rotation` turns the shape
about its center (degrees, counterclockwise), `align` moves it relative to the origin, and the
shapes with corners take `fillet` (round every corner with that radius) or `chamfer` (bevel
every corner by that length).

```python
from smlibpy import *

Rectangle(40, 20)                         # width along X, height along Y
Rectangle(80, 50, fillet=6)               # rounded corners
Rectangle(40, 20, chamfer=3, rotation=30)
Circle(10)
Ellipse(15, 8, rotation=30)
Slot(30, 10)                              # 30 long overall, 10 wide
ArcSlot(40, 6, 60, rotation=15)           # along an arc of radius 40 around the origin
RegularPolygon(10, 6)                     # hexagon, corners at radius 10
RegularPolygon(10, 6, inscribed=True)     # hexagon 20 across the flats
Triangle(40, 20)                          # base 40, height 20, apex above the middle
Triangle(30, 40, apex=0)                  # right angle at the left end of the base
Trapezoid(40, 15, 60, fillet=2)           # base 40, height 15, 60 degree sides
Polygon((0, 0), (30, 0), (30, 10), (10, 25), (0, 25))   # points stay where they are
```

`align` puts a corner or a side on the origin instead of the center:
`Rectangle(40, 20, align=Align.MIN)` has its lower left corner there. `RoundedRectangle(w, h, r)`
is the older name of `Rectangle(w, h, fillet=r)`.

## Drawing an outline with Profile

`Profile` is a pen. It starts at a point with a heading (degrees counterclockwise from +X) and
draws lines and arcs one after the other, each from where the previous one ended. That suits
outlines with tangent arcs, rounded inner corners, revolve sections and symmetric parts, which
would be awkward to build from shapes.

```python
section = (Profile((0, 0))
           .line_to(12, 0)           # to a point
           .line_to(y=4)             # straight up to y = 4
           .fillet(1.5)              # round the corner the pen is at
           .line_to(x=6)
           .line_to(y=20)
           .chamfer(1)
           .line_to(x=0)
           .close())                 # back to the start: a Sketch
bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))
```

The moves:

| call | draws |
|---|---|
| `line_to(x, y)`, `line_to(x=...)`, `line_to(y=...)` | a line to a point, or to an x or y value with the other coordinate kept |
| `line_by(dx, dy)` | a line by an offset |
| `forward(length)`, `forward(x=...)`, `forward(y=...)` | a line along the heading, for a length or until x or y reaches a value |
| `turn(angle)`, `turn_to(heading)` | no line: the next one starts at a corner |
| `arc(radius, angle)` | an arc tangent to the heading; a positive angle turns left |
| `arc_to(x, y)` | a tangent arc that ends at the point |
| `arc_to(x, y, through=(px, py))` | an arc through a point |
| `fillet(radius)`, `chamfer(length)` | round or bevel the corner at the pen, between the segment before and the one after |
| `mirror(axis)` | add the mirror image of everything drawn so far |

`close()` returns the sketch and `wire()` the open path, for example as a sweep path. Every call
returns a new Profile, so a drawing can branch into variants, and `point` and `heading` tell
where the pen is:

```python
base = Profile((0, 0)).line_to(20, 0).line_to(20, 10)
square = base.line_to(0, 10).close()
round_top = base.arc_to(0, 10).close()
print(base.point, base.heading)          # Vector(20, 10, 0) 90.0

path = Profile((0, 0)).line_to(20, 0).fillet(5).line_to(20, 20).wire()
pipe = sweep(Circle(1), path)
```

Symmetric outlines are drawn as one half, from the mirror axis around to the axis again, and
completed with `mirror`. The corners rounded on the half are rounded on the other half too:

```python
bracket = (Profile((0, 0))
           .line_to(30, 0).line_to(y=6)
           .line_to(x=10).fillet(4)
           .line_to(y=30)
           .arc(10, 90)              # a quarter circle over the top
           .mirror(Y)
           .close())
```

`close()` checks the outline. A crossing, a fillet that does not fit or an arc that cannot be
drawn raises a `ModelingError` that names the segment by the call that drew it and gives the
numbers, for example `fillet(20) at (10, 0) does not fit: it needs 20 along segment 1,
line_to(10, 0), which is 10 long; use a smaller radius`.

## Combining

```python
plate = Rectangle(60, 40, fillet=6) - Circle(8) - GridLocations(44, 24, 2, 2) * Circle(2.5)
cross = Rectangle(40, 8) + Rectangle(8, 40)
lens = Circle(10).translate(-5, 0) & Circle(10).translate(5, 0)
```

`+` unites, `-` subtracts, `&` intersects and `^` keeps what is in exactly one of them. The
sketches must lie in the same plane. A list or a pattern on the right side is combined in one
step, which is fast even for hundreds of holes. A result can be empty (cutting away everything,
or intersecting regions that do not meet); extruding an empty sketch raises.

## Hulls and strokes

`Hull` makes the convex outline around points and shapes, as if a string were pulled tight
around them; around circles it follows the arcs exactly. `Stroke` makes the region a pen of
some width covers along a path of lines and arcs.

```python
lever = Hull(Circle(10), Pos(60, 0) * Circle(6)) - Circle(5) - Pos(60, 0) * Circle(3)
slot = Stroke(Line((10, 5), (40, 20)), 6)                 # a slot between two centers
rib = Stroke(Polyline((0, 0), (30, 0), (30, 20)), 3, ends="flat", corners="sharp")
```

## Changing a sketch

`offset` grows or shrinks a region; holes move the other way. The corners that the offset pulls
apart become arcs (`corners="round"`), stay sharp (`"sharp"`) or are cut (`"chamfer"`). Parts
that grow into each other merge, thin parts vanish when shrinking, and shrinking away the
whole region raises.

```python
outline = Rectangle(80, 50, fillet=6)
gasket = outline.offset(3) - outline                      # a 3 wide band around the outline
frame = outline - outline.offset(-4, corners="sharp")
```

`fillet` and `chamfer` change corners. Without a selection they change every sharp corner;
otherwise they take vertices of the sketch, selected by geometry like the edges of a part:
`convex()` for outside corners, `concave()` for inside corners (also the corners of a hole),
or by position.

```python
angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))
angle = angle.fillet(4, angle.vertices().concave())      # the inside corner
angle = angle.chamfer(1, angle.vertices().convex())      # the five outside corners
tab = Rectangle(30, 10).fillet(5, Rectangle(30, 10).vertices().right())
```

`mirror` reflects a sketch about an axis in its plane (or in a plane). The mirrored sketch
keeps facing the same way, so it extrudes to the same side:

```python
half = Polygon((0, 0), (20, 0), (20, 5), (5, 20), (0, 20))
whole = half + half.mirror(Y)
```

## From curves

Closed curves you already have, splines or edges taken from a part, become a region with
`make_face`; further closed wires are holes:

```python
outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
bolt_hole = Wire([CenterArc((12, 12), 4, 0, 360)])
bracket = make_face(outline, bolt_hole)
blob = make_face(Spline((0, 0), (10, 5), (0, 10), (-10, 5), closed=True))
```

The curve constructors (`Line`, `CenterArc`, `ThreePointArc`, `RadiusArc`, `TangentArc`,
`Spline`, `Bezier`, ...) are described in the curves guide.

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
s = Rectangle(40, 20, fillet=4) - Circle(5)
s.area                       # 707.725652
s.perimeter                  # 144.548668: outline and hole
s.center()                   # area centroid
s.bbox()
len(s.faces()), len(s.faces()[0].inner_wires())
[e.geom_type for e in s.edges()]    # 'line' and 'circle'
```

From here, sketches become parts: [parts](parts.md).
