# Profiles: which 2D tool for which outline

Most parts start as a 2D outline that is extruded or revolved. Pick the tool by the shape of
the outline, not by habit; the right one makes the script short and the geometry exact.

| the outline is | use |
|---|---|
| a rectangle, circle, slot, polygon, triangle, trapezoid, ellipse | the shape: `Rectangle(80, 50, fillet=6)`, `Slot(30, 8)`, `Triangle(30, 30, apex=0)` |
| a standard shape with holes, cutouts, bosses | shapes combined: `outline - holes + tabs` |
| made of lines and arcs drawn one after the other, with tangent arcs or rounded inner corners | `Profile(...)` |
| a revolve section (shaft, bushing, pulley, nozzle) | `Profile` of the half section beside the axis |
| symmetric (brackets, hooks, levers drawn by hand) | `Profile` of one half, then `.mirror(axis)` |
| convex around circles and points (levers, links, cams) | `Hull(...)` |
| a band of constant width along a path (slots between centers, arc slots, ribs) | `Stroke(path, width)`, `ArcSlot` |
| a wall, gasket, clearance or frame around an outline | `offset` |
| curves you already have (splines, edges of a part) | `make_face` |

## Shapes first

Every shape is centered on the origin and takes `rotation=`, `align=` and, with corners,
`fillet=`/`chamfer=`. Cutouts are Booleans; patterns go on the right side in one call:

```python
plate = Rectangle(80, 50, fillet=6) - GridLocations(60, 30, 2, 2) * Circle(3) - Slot(30, 8)
part = plate.extrude(6)
```

## The pen for everything with tangent arcs

`Profile` draws from a start point: `line_to` (a point, or `x=`/`y=` alone for horizontal
and vertical lines), `forward`, `arc(radius, angle)` (tangent; positive turns left),
`arc_to(point)` (tangent) or `arc_to(point, through=...)`, and `fillet(r)`/`chamfer(d)` right
after the move that ends at a corner. `close()` gives the Sketch.

```python
hook = (Profile((0, 0))
        .line_to(6, 0).line_to(y=30)
        .arc(12, 180)                 # the bend, tangent to the shank
        .line_to(y=24)
        .arc(3, 180)                  # round tip
        .line_to(y=30)
        .arc(6, -180)                 # inside of the bend
        .line_to(0, 0)
        .close())
```

## Revolved parts: the half section beside the axis

Draw the section on one side of the axis (x >= 0 for the Y axis), starting and ending on the
axis, and revolve about that axis. Corners that should be rounded on the part get their
fillet in the profile; the revolve turns them into exact tori.

```python
section = (Profile((0, 0))
           .line_to(12, 0).line_to(y=4).fillet(1.5)
           .line_to(x=6).line_to(y=20).chamfer(1)
           .line_to(x=0)
           .close())
bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))
```

When the section is itself symmetric (a pulley, a spool), draw a quarter and mirror it about
the mid line: `.mirror(X)` before `close()`.

## Symmetric outlines: half, then mirror

Draw from the mirror axis around to the axis again, then `.mirror(axis).close()`. Rounded
corners on the half are rounded on the mirror half too; where the half meets the axis at a
right angle the two halves join without a seam.

```python
bracket = (Profile((0, 0))
           .line_to(30, 0).line_to(y=6)
           .line_to(x=10).fillet(4)
           .line_to(y=30)
           .arc(10, 90)
           .mirror(Y)
           .close())
```

## Levers, links, slots

```python
lever = Hull(Circle(10), Pos(60, 0) * Circle(6)) - Circle(5) - Pos(60, 0) * Circle(3)
slot = Stroke(Line((10, 5), (40, 20)), 6)              # between two centers
adjust = ArcSlot(40, 6, 60, rotation=15)               # along an arc around the origin
```

## Walls, gaskets, clearances

```python
outline = Rectangle(80, 50, fillet=6)
gasket = outline.offset(3) - outline                   # 3 wide outside
frame = outline - outline.offset(-4)                   # 4 wide inside
clearance = outline.offset(0.2)                        # for a cutout that fits the part
```

`corners="sharp"` keeps corners square when growing; `"chamfer"` cuts them.

## Corners chosen by geometry

```python
angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))
angle = angle.fillet(4, angle.vertices().concave())     # the inside corner
angle = angle.chamfer(1, angle.vertices().convex())     # the outside corners
```

## Check

- `s.area` against a formula, `s.bbox()` against the planned size, `len(s.faces())` (pieces)
  and `len(s.faces()[0].inner_wires())` (holes) before extruding.
- `sorted({e.geom_type for e in s.edges()})` shows `line` and `circle` for exact outlines.
- A `Profile` that crosses itself, a fillet that does not fit, an offset that removes
  everything raise with the segment, corner or distance named: read the message, change that
  number.
