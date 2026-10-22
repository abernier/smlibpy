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

### A K-factor for each bend

A part keeps the K-factor each bend was folded with (`fold`, `flange`), and `unfold`,
`flat_pattern` and `bends` take it: a blank folded with a tight hem at K 0.33 and a large bend
at K 0.45 unfolds to the blank again. The record goes with the part through Booleans, moves and
`named()`; a part read from a file has none, and its bends take 0.44.

```python
blank = Box(200, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
part = fold(blank, Axis((-60, 0, 2), (0, 1, 0)), 90, radius=1, k_factor=0.33)
part = fold(part, Axis((60, 0, 2), (0, 1, 0)), 90, radius=6, k_factor=0.45)
print(round(flat_pattern(part).size.x, 6))                     # 200.0
print([b.k_factor for b in part.bends()])                      # [0.33, 0.45]
```

`k_factor=` on `unfold`, `flat_pattern` and `bends` gives other ones, for every bend at once:

| `k_factor=` | each bend's K-factor |
|---|---|
| `0.42` | the number |
| `{1: 0.33, 6: 0.45}` | by inside radius (a radius not in the table raises `ValueError`) |
| `[(0.5, 0.33), (3, 0.45)]` | `(r / t, k)` pairs, a shop's table: interpolated, the ends held |
| `lambda radius, thickness, angle: ...` | a function of the bend |
| `"din6935"` | DIN 6935: `k = 0.65 + 0.5 log10(r / t)` up to `r / t = 5` (the neutral fiber at `k t / 2`), as a K-factor `k / 2` |
| `None` (default) | as folded, else 0.44 |

```python
table = flat_pattern(part, k_factor=[(0.5, 0.33), (3, 0.45)])  # r/t 0.5 and 3: these two bends
print(round(table.size.x, 6), table.k_factor)                  # 200.0 None: the bends differ
din = flat_pattern(part, k_factor="din6935")
print([round(b.k_factor, 4) for b in din.bends])               # [0.2497, 0.4443]
```

`FlatPattern.k_factor` is the K-factor of every bend, or `None` where they differ; each `Bend`
has its own.

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

Bending and unfolding with the same K-factor give back the same blank exactly, and by default
each bend unfolds with the K-factor it was folded with. Parts that were not made with `fold`
unfold too (at 0.44, or the `k_factor=` given), as long as each bend is a pair of cylinder faces
one thickness apart, for example a profile with an inside radius extruded to a channel. A plate
bent with `Part.bend` (see [deformations](deform.md)) has such cylinders, and keeps the K-factor
its neutral layer gives.

### Rolled parts, curls and bends over 180 degrees

Rolled sheet unfolds too: a ring segment (a bend with no flat sheet at all), a bend at the free
end of a sheet (a J shape, a curled edge) and bends over 180 degrees. They unroll at the
neutral radius `radius + k_factor * thickness`; a rolled part about the middle of its bend, the
others with the sheet toward the fixed face in place:

```python
ring = Cylinder(52, 40) - Cylinder(50, 50) - Box(60, 60, 50, align=(Align.MIN, Align.MIN, Align.CENTER))
print(ring.bends())                          # [Bend(angle=270, radius=50, thickness=2, ...)]
print(flat_pattern(ring).size)               # 239.766 x 40 x 2: 3 pi / 2 * (50 + 0.44 * 2) long
curl = (Cylinder(12, 40) - Cylinder(10, 50)).rotate(X, 90).translate(0, 0, 12)
curl = curl - Box(20, 60, 20, align=(Align.MAX, Align.CENTER, Align.MAX)).translate(0, 0, 12)
hemmed = Box(100, 40, 2, align=(Align.MAX, Align.CENTER, Align.MIN)) + curl  # a 270 degree curl
print(round(hemmed.unfold().bbox().size.x, 4))  # 151.2708: 100 + 3 pi / 2 * (10 + 0.44 * 2)
```

The outline and the bend lines lie in the XY plane, ready for a 2D export for the cutter;
`export_step(pattern.part, "blank.step")` writes the blank as a solid. The outline is made of
lines, arcs and circles wherever the blank has them: a hole that crossed a bend comes back as
one circle, an oblique cut across a bend as one line (the pieces of the bend zone are fitted,
so they are recognized within 1e-6 mm and merged with their neighbours), while free shapes such
as spline cutouts stay splines:

```python
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(4, 10).translate(20, 0, 0)
bracket = fold(blank, Axis((20, 0, 2), (0, 1, 0)), 90, radius=2)   # the hole crosses the bend
outline = flat_pattern(bracket).outline
print(sorted(e.geom_type for e in outline.edges()))               # 4 lines and one circle
```

## Limits

- The bend zone must cross flat sheet only: keep a bend line at least half the bend allowance
  away from edges parallel to it, from other bends and from ribs; smlibpy raises
  `ModelingError` with the distance otherwise.
- `fold` bends up to 180 degrees, flange angles stay below 180; the inside radius from 0.11 mm.
  `unfold` takes bends up to below a full turn: rolled parts, curls and bends over 180 degrees.
- A bend at a free end of the sheet, a bend over 180 degrees and a rolled part must run the full
  width of the sheet next to them (no sheet beside the bend along its axis), and a part with more
  than one bend needs flat sheet on at least one side of each.
- Holes and cutouts that cross a bend zone bend into NURBS surfaces (within 0.0001 mm); their
  edges are within 0.0000001 mm, so the flat pattern's outline gets them back as the circles and
  lines they were. Better cut them into the flat pattern's blank and bend after. A hole wholly
  inside a bend zone unfolds into the right flat pattern, but the unfolded part's hole walls do
  not quite meet its faces (`is_valid()` is False; the kernel's unbend of such a wall).
- A corner without a bend radius does not unfold.
