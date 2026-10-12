# Sheet metal

Brackets, channels, covers and trays are cut flat from a sheet and bent on a press brake.
smlibpy models them the same way: a flat plate, bends and flanges with an inside radius, and
the flat pattern that a laser cutter needs. The bends are exact: the bend zone becomes true
cylinders, and unfolding a part gives back the blank it was bent from.

## Bending a plate

Start with a plate lying on the XY plane and bend it along a line drawn on its top face:

```python
from smlibpy import *

blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))   # 2 mm sheet, z = 0..2
bracket = fold(blank, Axis((20, 0, 2), (0, 1, 0)), 90, radius=2)
print(bracket.bbox().size)                    # 71.7381 x 40 x 31.7381
print(bracket.bends())                        # one bend: 90 degrees, radius 2, length 40
```

The line is the middle of the bend. A bend takes a strip of the flat, the *bend allowance*,
and wraps it around the inside radius: the faces of the bend are cylinders of radius 2 and 4
(inside and outside).

A positive angle folds the sheet towards the side the face with the line faces, so a line on
the top face folds upwards; a negative angle folds downwards. The side of the line that
reaches farther stays in place; `fixed=` takes a point on the side that should stay:

```python
down = fold(blank, Axis((20, 0, 2), (0, 1, 0)), -90, radius=2)
other_side = fold(blank, Axis((20, 0, 2), (0, 1, 0)), 90, radius=2, fixed=(40, 0, 0))
hem = fold(blank, Axis((40, 0, 2), (0, 1, 0)), 180, radius=1)            # folded flat onto itself
```

## The K-factor

While a sheet bends, its inside is compressed and its outside stretched. One layer in
between, the neutral fiber, keeps its length. The K-factor says where it lies: 0 on the inside
face, 1 on the outside face. smlibpy uses 0.44 unless you pass `k_factor=`; use the value your
shop's press brake gives (lower for tight radii, up to 0.5 for large ones).

The K-factor decides how much flat material a bend takes:

```python
print(bend_allowance(90, radius=2, thickness=2))               # 4.5239 = pi/2 * (2 + 0.44 * 2)
print(bend_allowance(90, radius=2, thickness=2, k_factor=0.5)) # 4.7124
```

Drawings give outside dimensions. `developed_length` turns them into the length of the blank,
so a bracket with outside legs of 60 and 40 is bent from a blank 96.52 long:

```python
length = developed_length(60, 40, radius=2, thickness=2)       # 96.5239
blank = Box(length, 30, 2, align=Align.MIN)
line_x = 60 - (2 + 2) + bend_allowance(90, radius=2, thickness=2) / 2
bracket = fold(blank, Axis((line_x, 0, 2), (0, 1, 0)), 90, radius=2, fixed=(0, 0, 0))
print(bracket.bbox().size)                                     # 60 x 30 x 40
```

## Flanges

A flange extends an edge of the sheet and bends it, which is how most sheet metal parts are
built: a base plate, then a flange on each edge that needs one. The length is the outside
length of the flange; the bend starts at the edge, so the plate keeps its size:

```python
plate = Box(100, 60, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
right_edge = plate.edges().filter_by(Y).filter(lambda e: e.center().z > 1).sort_by(X).last
part = plate.flange(right_edge, 20, radius=2)                  # 20 high, at x = 50 .. 54
tilted = plate.flange(right_edge, 20, radius=2, angle=45)
```

Four flanges make a tray with open corners:

```python
tray = plate
for axis, last in ((Y, True), (Y, False), (X, True), (X, False)):
    edges = tray.edges().filter_by(axis).filter(lambda e: abs(e.center().z - 2) < 1e-6)
    edges = edges.sort_by(Y if axis is X else X)
    tray = tray.flange(edges.last if last else edges.first, 20, radius=2)
print(tray.bbox().size)                                        # 108 x 68 x 20
```

Pick the edges of the base plate by their height: after the first flange, `edges().top()`
finds the top of that flange.

## Bending only part of a sheet

`partial=True` bends only along a segment, such as a tab between two relief cuts. The cuts
must reach past the bend zone, so that only the tab joins the rest of the sheet to the bent
part:

```python
slots = Box(31, 1, 10).translate(35, 10.5, 0) + Box(31, 1, 10).translate(35, -10.5, 0)
sheet = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN)) - slots
tab = fold(sheet, Line((25, -10, 2), (25, 10, 2)), 90, radius=2, partial=True)
```

## Unfolding and flat patterns

`unfold` makes every bend flat again; the largest face stays where it is. `flat_pattern` lays
the unfolded part on the XY plane and adds what a cutter needs: the cutting contour as a
sketch and the bend lines, each with its angle, radius and direction.

```python
pattern = flat_pattern(tray)
print(pattern.size)                          # 141.048 x 101.048 x 2
print(pattern.outline)                       # the cutting contour at z = 0
for b in pattern.bends:
    print(b.direction, b.angle, b.radius, b.line)
flat = tray.unfold()                         # the same, in place
```

Bending and unfolding with the same K-factor give back the same blank exactly. Parts that were
not made with `fold` unfold too, as long as each bend is a pair of cylinder faces one
thickness apart, for example a profile with an inside radius extruded to a channel.

The outline and the bend lines lie in the XY plane, ready for a 2D export for the cutter;
`export_step(pattern.part, "blank.step")` writes the blank as a solid.

## Limits

- The bend zone must cross flat sheet only: keep a bend line at least half the bend allowance
  away from edges parallel to it, from other bends and from ribs; smlibpy raises
  `ModelingError` with the distance otherwise.
- Bend angles go up to 180 degrees, flange angles below 180; the inside radius from 0.11 mm.
- Holes and cutouts that cross a bend zone bend into NURBS surfaces (within 0.0001 mm).
  Better cut them into the flat pattern's blank and bend after.
- A corner without a bend radius does not unfold.
