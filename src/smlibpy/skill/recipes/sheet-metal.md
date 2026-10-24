# Sheet metal

Parts bent from one sheet: brackets, channels, trays, covers. Build them the way a shop does:
a flat blank or a plate, then bends and flanges with an inside radius and a K-factor; the
flat pattern gives the blank to cut. All functions are in `sheetmetal/*`.

## A bracket from a flat blank

Design by outside dimensions: `developed_length` turns the legs into the blank length, the bend
line goes to the middle of the bend zone. Cut the holes in the blank, then bend.

```python
t, r = 2, 2                                                    # 2 mm sheet, inside radius 2
length = developed_length(60, 40, radius=r, thickness=t)       # outside legs 60 and 40 -> 96.5239
blank = Box(length, 30, t, align=Align.MIN)                    # x = 0..length, z = 0..t
blank -= [Cylinder(3, 10).translate(x, 15, 0) for x in (15, 45)]             # holes in the 60 leg
blank -= [Cylinder(3, 10).translate(length - x, 15, 0) for x in (12, 28)]    # holes in the 40 leg
line_x = 60 - (r + t) + bend_allowance(90, radius=r, thickness=t) / 2        # middle of the bend zone
bracket = fold(blank, Axis((line_x, 0, t), (0, 1, 0)), 90, radius=r, fixed=(0, 0, 0))
print(bracket.is_valid(), round(bracket.bbox().size.x, 6), round(bracket.bbox().size.z, 6))   # True 60.0 40.0
```

- The bend line is the middle of the zone: `L - (R + t) + BA/2` from the free end of an
  outside leg L (90 degrees).
- `fixed=(0, 0, 0)` keeps the side with the origin; without it the side that reaches farther stays.
- Holes keep their places: in this bracket the leg holes sit at heights 12 and 28.

## A box with flanges

From a plate, flange each edge. The bend starts at the edge, so the outside grows by R + t per
side and the corners stay open (R + t wide):

```python
t, r = 2, 2
tray = Box(100, 60, t, align=(Align.CENTER, Align.CENTER, Align.MIN))
def base_edge(part, axis, last):
    """A top edge of the base plate (z = t) along axis, on the far (last) or near side."""
    edges = part.edges().filter_by(axis).filter(lambda e: abs(e.center().z - t) < 1e-6)
    ordered = edges.sort_by(Y if axis is X else X)
    return ordered.last if last else ordered.first
for axis, last in ((Y, True), (Y, False), (X, True), (X, False)):
    tray = tray.flange(base_edge(tray, axis, last), 20, radius=r)
print(tray.bbox().size, len(tray.bends()))                     # Vector(108, 68, 20) 4
```

From a cross-shaped blank, bend each arm along a segment. The corners need reliefs larger than
half the bend allowance, and every bend is `partial=True` (it bends only the arm):

```python
t, r, relief = 2, 2, 3                       # corner reliefs above half the allowance (2.26)
cross = Rectangle(100, 80)
for sx in (1, -1):
    for sy in (1, -1):
        cross -= Rectangle(20 + relief, 20 + relief).translate(sx * (50 - (20 + relief) / 2),
                                                               sy * (40 - (20 + relief) / 2))
box = cross.extrude(t)
for line in (Line((-27, 20, t), (27, 20, t)), Line((-27, -20, t), (27, -20, t)),
             Line((30, -17, t), (30, 17, t)), Line((-30, -17, t), (-30, 17, t))):
    box = fold(box, line, 90, radius=r, fixed=(0, 0, 0), partial=True)
print(box.is_valid(), box.bbox().size)                         # True Vector(63.4761, 43.4761, 21.7381)
```

- Select the base's edges by position (z = t): after a flange, `edges().top()` finds the
  flange's top edges.
- Here the bend lines lie on the base's edges, so the base loses BA/2 per side to the bends:
  63.4761 outside (60 - BA + 2 (R + t)), not 64.

## The flat pattern for a laser cutter

```python
t, r = 1.5, 1.5
part = Box(120, 50, t, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(4, 10)
top_edges = part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - t) < 1e-6)
part = part.flange(top_edges.last, 25, radius=r)                       # up at +X
top_edges = part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - t) < 1e-6)
part = part.flange(top_edges.first, 25, radius=r, angle=-90)          # down at -X
pattern = flat_pattern(part)
print(pattern)                                                  # FlatPattern(170.786 x 50, ..., 2 bends, ...)
for b in pattern.bends:
    print(b.direction, round(b.line.start.x, 4), round(b.allowance, 4))    # up 23.6965 3.3929, down 147.0894 3.3929
print([e.geom_type for e in pattern.outline.edges()])          # ['line', 'line', 'line', 'line', 'circle']
export_step(pattern.part, "blank.step")
```

- `pattern.outline` is the cutting contour at z = 0 (lines and circles, holes included),
  `pattern.bend_lines` the bend lines at z = 0, each `Bend` with `direction` "up" or "down".
- `pattern.part` is the blank as a solid (`export_step`); it lies on XY, z = 0..t, its longer
  side along X.
- Unfold with the K-factor of the shop's press brake; the blank length changes with it.

## Choosing radius and K-factor

- Inside radius: about the thickness is a common default (R = t); tighter bends crack hard
  materials. smlibpy takes radii from 0.11 up.
- K-factor: 0.44 is the default (`smlibpy.sheetmetal.K_FACTOR`). Shops quote lower values
  (about 0.33) for radii below the thickness and up to 0.5 for large radii. With R 2 and t 2,
  K 0.33 / 0.44 / 0.5 give a blank of 76.1783 / 76.5239 / 76.7124 for legs 50 + 30.
- Measure it: bend a test strip, measure the outside legs and solve for K:

```python
# A test strip of 76.5 bent 90 degrees (R 2, t 2) measures 50 and 30 outside: solve for K.
strip, legs, r, t = 76.5, (50.0, 30.0), 2.0, 2.0
allowance = strip - sum(legs) + 2 * (r + t)          # what the bend took: BA = blank - legs + 2 setbacks
k = (allowance / (math.pi / 2) - r) / t
print(round(k, 4), round(developed_length(*legs, radius=r, thickness=t, k_factor=k), 6))   # 0.4324 76.5
```

## Errors and limits

- The bend line must lie on the top or bottom face of the sheet, and its bend zone (BA wide)
  must cross only flat sheet: not within BA/2 of a parallel edge, another bend or a rib.
- A bend that stops inside the sheet needs relief cuts and `partial=True`.
- Angles up to 180 (hems) for `fold`, below 180 for `flange`; radius from 0.11.
- `unfold` and `flat_pattern` need bends as coaxial cylinders one thickness apart; a sharp
  corner (no radius) raises `ModelingError: unfold: the unfolded part is ... deep across the fixed face`.
  Rolled parts, curls at a free end and bends over 180 degrees unfold too (unrolled at r + k t).
- Holes across a bend zone become NURBS and make the part's volume unreliable; cut them in the flat.
- Check every step: `is_valid()`, `bbox().size` against the outside dimensions, `len(part.bends())`,
  and that `flat_pattern(part).part.volume` equals the blank's volume.
