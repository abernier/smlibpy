# Sketches

A `Sketch` is a planar region: one or more faces on a plane, possibly with holes. Most parts
begin as a sketch that is extruded or revolved. Sketches are drawn in the XY plane around the
origin and placed afterwards; every operation returns a new sketch and leaves its input as it
was. Lines stay lines and arcs stay circles through every 2D operation, so areas, radii and the
faces of the parts made from them are exact.

There are three ways to make the outline: standard shapes, the `Profile` pen for outlines drawn
segment by segment, and shapes built from other geometry (`Hull`, `Stroke`, `make_face`).

## Shapes

Every shape is centered on the origin (an `ArcSlot` by the center of its arc; a `Polygon` keeps
its points where they are). They share their options: `rotation` turns the shape about its
center (degrees, counterclockwise), `align` moves it relative to the origin, and the shapes with
corners take `fillet` (round every corner with that radius) or `chamfer` (bevel every corner by
that length).

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

`+` unites, `-` subtracts, `&` intersects and `^` keeps what is in exactly one of them; by name
they are `fuse`, `cut`, `intersect` and `xor`, as methods and functions (`a.cut(b)`,
`cut(a, b)`). The sketches must lie in the same plane. A list or a pattern on the right side is
combined in one step, which is fast even for hundreds of holes. A result can be empty (cutting
away everything, or intersecting regions that do not meet); extruding an empty sketch raises.

## Hulls and strokes

`Hull` makes the convex outline around points and shapes, as if a string were pulled tight
around them; around circles it follows the arcs exactly. `Stroke` makes the region a pen of
some width covers along a path: lines and arcs exactly, splines and ellipses within 1e-6 of
the path's size.

```python
lever = Hull(Circle(10), Pos(60, 0) * Circle(6)) - Circle(5) - Pos(60, 0) * Circle(3)
slot = Stroke(Line((10, 5), (40, 20)), 6)                 # a slot between two centers
rib = Stroke(Polyline((0, 0), (30, 0), (30, 20)), 3, ends="flat", corners="sharp")
groove = Stroke(Spline((0, 0), (20, 8), (40, 0)), 4)      # area 188.283
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

Corners next to splines and ellipses are rounded and beveled too: the arc's center lies at the
radius from both curves, and the curves are cut where it touches them.

```python
bottle = make_face(Wire([Line((0, 0), (10, 0)), Spline((10, 0), (14, 4), (12, 8), (10, 10)),
                         Line((10, 10), (0, 10)), Line((0, 10), (0, 0))]))
rounded = bottle.fillet(2)                                # all four corners, two of them at the spline
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
`Spline`, `Bezier`, ...) are described in the [API reference](api.md#curves). Among them are
conic arcs and flat spirals, exact where NURBS can be (a conic is one rational quadratic), and
edges made from NURBS data, the inverse of `edge.nurbs()`:

```python
reflector = ParabolicArc((0, 0), 25, -40, 40)       # y = x^2 / 100 from x = -40 to 40, focus (0, 25)
waist = HyperbolicArc((0, 0), 10, 20, -30, 30)      # x^2/10^2 - y^2/20^2 = 1; revolve about Y
blend = ConicArc((0, 0), (10, 0), (10, 10), 0.6)    # a rho conic: 0.5 a parabola, more is fuller
coil = Spiral(2, 20, 5)                             # flat: from radius 2 to 20 in 5 turns
n = Spline((0, 0), (10, 5), (20, 0)).nurbs()
pulled = Edge.from_nurbs(n._replace(points=[*n.points[:2], n.points[2] + Vector(0, 3), *n.points[3:]]))
```

A closed `Spline` is as smooth at its seam as everywhere else (curvature continuous), and
splines through thousands of points take milliseconds.

## Cutting, joining and extending curves

Edges and wires are cut where they meet other shapes, trimmed, extended and joined. Positions
along an edge are fractions of its length, as `point_at` takes them, or points on it; the
pieces keep their curve, so a trimmed arc is still an arc with its radius and center.

```python
s = Spline((0, 0), (10, 10), (20, 0))
x = s.intersections(Line((0, 4), (20, 4)))       # [(2.254, 4, 0), (17.746, 4, 0)]
left, rest = s.split(x[0])                        # the lengths add up to s.length
middle = s.trim(x[0], x[1])                       # the arch between the two crossings
s.param_at_point(x[0]), s.closest_point((10, 20))  # 0.1553, (10, 10, 0)

arc = CenterArc((0, 0), 10, 0, 180).trim(0.25, 0.75)    # an arc from 45 to 135 degrees
longer = Line((0, 0), (10, 0)).extend(2, end="both")   # (-2, 0) to (12, 0)
runout = s.extend(5, end="both", continuity="G1")       # straight on along the end tangents

rail = FilletPolyline((0, 0), (30, 0), (30, 20), radius=5).to_edge()   # one B-spline edge
a, b = Polyline((0, 0), (10, 0), (10, 10)).split(0.25)  # 5 and 15 long
```

- `intersections(other)` takes an edge, a wire, a face, a body or a list of them, and gives the
  points in order along the edge; `intersection_params(other)` gives their fractions, ready for
  `split` and `trim`. Where two curves run along each other, the overlap's two ends count. No
  point is an empty list. Points within `tolerance` (1e-6, or 1e-9 of the size of the two
  where that is larger) count as on the other shape and as one point.
- `extend` continues lines and arcs (circles, ellipses) as themselves, other curves straight
  along the end tangent (`continuity="G1"`), with the end curvature (`"G2"`) or as their own
  polynomial goes on (`"natural"`), by exactly the distance given.
- `Wire.to_edge()` joins edges that run end to end into one B-spline: a single rail for `sweep`
  and `loft`, a single SPLINE in DXF.

## Parallel curves, fitted curves, lines and arcs

`offset` moves an edge or a wire sideways in its plane: an open one to its left for a positive
distance (seen from the side the plane's normal points to; for a wire in XY, from above), a
closed one outward. Lines and arcs stay exact; splines and ellipses are offset within 1e-6 of
the wire's size. The corners the offset pulls apart are rounded, extended (`corners="sharp"`)
or cut (`"chamfer"`), as for sketches; where the sides cross, they are cut there.

```python
path = Polyline((0, 0), (40, 0), (40, 30))
wall = path.offset(2)                             # inside the turn: 66 long
outer = path.offset(-2, corners="sharp")          # outside: 74 long, a sharp corner
rail = Spline((0, 0), (20, 8), (40, 0)).offset(3) # a parallel spline, 3 to the left
inner = outline.offset(-1)                        # 1 inside a closed outline
```

An offset that would fold over itself raises `ModelingError` with the place: a curve that bends
more tightly than the distance on that side (its smallest radius of curvature, `min_radius()`,
is below it), an edge that vanishes between two corners, or parts of the wire that lie closer
together than the distance. The offset of the region a closed wire bounds, which merges and
drops such parts, is `Sketch.offset`.

`fit_curve` makes a smooth curve near many points, with as few control points as keep it within
a tolerance of every point: for scans, digitized outlines and sampled curves, where `Spline`
passes through every point and needs a control point for each. `Spline` also takes a direction
for every point.

```python
import math
scan_points = [(x / 10, 8 * math.sin(x / 90) + 0.01 * math.sin(37.3 * x)) for x in range(600)]
outline = fit_curve(scan_points, tolerance=0.05)  # 12 control points (Spline: 602)
s = Spline((0, 0), (10, 0), (20, 10), tangents=[(1, 0), (1, 1), (0, 1)])
```

`to_arcs` turns an edge or wire into lines and circular arcs within a tolerance (default 0.01
mm), joined tangentially, for cutters and DXF readers that take only LINE and ARC; `export_dxf(...,
curves="arcs")` writes splines and ellipses so.

```python
cut = Spline((0, 0), (10, 5), (20, -3), (30, 4)).to_arcs(0.01)   # 26 arcs (52 for 0.001)
```

## Editing curves

`through` bends an edge so that it passes through a point (and there in a direction, if
given), with the smallest move of its control points and its ends and end directions kept;
`match` moves its ends and sets its directions there, bending the rest smoothly. `Wire.fillet`
rounds the corners of a wire as `Sketch.fillet` rounds a region's: between lines and arcs
exactly, next to splines and ellipses through their offsets.

```python
path = Spline((0, 0), (20, 10), (40, 0))
higher = path.through((20, 15))                         # through (20, 15), the ends where they were
level = path.through((20, 15), tangent=(1, 0))          # and running along X there
snapped = path.match(end=(45, 5), end_tangent=(1, 0))   # the end moved, the shape kept
route = Wire([Line((0, 0), (10, 0)), ThreePointArc((10, 0), (13, 5), (10, 10)), Line((10, 10), (0, 10))])
smooth = route.fillet(2)                                # every corner, also those at the arc
```

A point given to `fillet` that is not a corner, or a corner that is smooth, raises
`ModelingError`, as for sketches.

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

## Text

`Text` turns lettering into a sketch with the exact outlines of a font. `size` is the height of
the capital letters in millimeters, the nominal height of technical lettering, so `Text("H", 10)`
is exactly 10 mm tall. Round letters reach a little above and below the capitals, and
descenders such as the tail of a g go below the baseline.

```python
label = Text("SMLIB 42", 8)
print(len(label.faces()), round(label.area, 2))     # 7 pieces, 118.7 mm²
```

Straight parts of the letters are lines; each curved run is one B-spline that passes through the
font's own points, so the outlines are the font's, not an approximation of them. Counters are
holes: an `o` is one face with one hole, a `B` has two, an `i` is two faces. Fonts fill their
outlines by the nonzero rule, and contours that overlap are united.

The text is centered on the origin. `align` places its layout box, which runs from the start to
the end of the line and from the baseline to the cap height: `Align.MIN` puts the start of the
text on x = 0 and the baseline on y = 0, `Align.MAX` the end and the cap height. Labels aligned
this way share their baseline whatever letters they contain.

```python
two_lines = Text("SMLIB\nNURBS", 5, align=Align.MIN, line_spacing=1.6)   # last baseline on y = 0
wide = Text("A B C", 5, spacing=1.0)                                      # 1 mm more between letters
```

A line break starts a new line; `line_spacing` is the distance between baselines as a multiple of
`size`. `spacing` adds millimeters between neighbouring letters, and the font's kerning pairs
(`AV`, `To`) are applied unless `kerning=False`.

Text is engraved or embossed like any sketch: place it on a face, extrude it, and subtract or add
the result. The volume changes by the text's area times the depth.

```python
plate = Box(70, 24, 5)
top = plate.faces().top()
raised = plate + Text("SMLIB 42", 8).on(top).extrude(0.8)
engraved = plate - Text("SMLIB 42", 8).on(top).extrude(-0.5)
```

`path=` sets one line of text along an edge or wire in the XY plane. Each letter is placed upright
on the curve and turned with it; the letters are not bent. The text reads in the direction of the
path and stands on its left side, so a clockwise arc carries it over the top of a circle:

```python
ring = Text("ALONG AN ARC", 4, path=CenterArc((0, 0), 30, 170, -160))
```

The default font is Lato Regular, which is bundled under the SIL Open Font License and covers
Latin-1, Polish and common symbols such as °, ±, µ and Ø. `font=` takes the path of a TrueType
or OpenType file (`.ttf`, `.otf`, `.ttc`, `.woff`, `.woff2`), or a `Font` that `load_font` read.
Fonts are read without other packages: web fonts as browsers download them (WOFF2), CFF fonts with
accents built from two glyphs (seac), and variable fonts (CFF2), of which the default instance is
drawn. A character the font does not have raises an error that names it. Each character is one
glyph: ligatures, right-to-left scripts and combining accents are not handled.

## Measuring

```python
s = Rectangle(40, 20, fillet=4) - Circle(5)
s.area                       # 707.725666
s.perimeter                  # 144.548668: outline and hole
s.center()                   # area centroid
s.bbox()
len(s.faces()), len(s.faces()[0].inner_wires())
[e.geom_type for e in s.edges()]    # 'line' and 'circle'
```

From here, sketches become parts: [parts](parts.md).
