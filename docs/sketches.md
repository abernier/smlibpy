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
or OpenType file (`.ttf`, `.otf`, `.ttc`, `.woff`). A character the font does not have raises an
error that names it. Each character is one glyph: ligatures, right-to-left scripts and combining
accents are not handled.

## Measuring

```python
s = RoundedRectangle(40, 20, 4) - Circle(5)
s.area                       # exact
s.center()                   # centroid
s.bbox()
len(s.faces()), len(s.faces()[0].inner_wires())
```

From here, sketches become parts: [parts](parts.md).
