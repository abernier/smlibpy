# Modeling patterns

## Order of operations

1. The main body: a primitive, or a sketch extruded or revolved.
2. Additions (bosses, ribs): fuse them.
3. Subtractions (pockets, holes, slots): cut them.
4. Fillets and chamfers last, on edges selected by geometry. Fillet before shelling when the
   walls should be rounded too.

Features that depend on faces (`.on(face)`) come after the face exists in its final form.

## Plates and blocks

```python
plate = Box(80, 60, 10)
plate = plate.fillet(plate.edges().parallel_to(Z), 8)          # rounded corners
plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)         # four through holes
pocket = Rectangle(30, 20).on(plate.faces().top()).extrude(-4)  # into the part
plate -= pocket
```

A tool for a through hole should be longer than the part is thick, so that no thin skin
remains: `Cylinder(4, 10)` is centered and reaches 5 mm above and below the center plane.

## Bosses and ribs

Build them as separate parts, place them, fuse:

```python
base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
boss = Cylinder(10, 12, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
part = base + boss
```

## Revolved parts

Draw the half section beside the axis with `Profile` (on XY, then place it on `Plane.XZ` if
the part should stand along Z), starting and ending on the axis, and revolve about that axis.
Rounded corners go into the profile (`.fillet(r)` while drawing). A profile that crosses the
axis raises. See `recipes/profiles` for the patterns:

```python
section = Profile((0, 0)).line_to(12, 0).line_to(y=4).fillet(1.5).line_to(x=6).line_to(y=20).line_to(x=0).close()
bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))
```

## Outlines

Standard outlines are shapes (`Rectangle(80, 50, fillet=6)`, `Slot`, `Triangle`), cutouts are
Booleans, outlines with tangent arcs are drawn with `Profile`, symmetric ones as a half plus
`.mirror(axis)`, walls and gaskets with `offset`. `recipes/profiles` has the table.

## Shells

`part.shell(thickness, openings=[faces])` hollows a part; select the opening faces by
geometry (`part.faces().top()`). Very thin walls next to large fillets fail: shell first and
fillet after, or use smaller radii.

## Sweeps

Profiles are swept along a path; the profile is placed at the start of the path and turned to
face along it. For springs and threads use `Helix` as the path.

## Patterns

`GridLocations`, `PolarLocations` and `Locations` multiply with a shape to make copies:
`PolarLocations(30, 6) * Cylinder(3, 20)` makes six cylinders on a circle of radius 30. Cut or
fuse the resulting list.

## Text: engraving and embossing

`Text` is a sketch: place it on a face, extrude it, subtract (engrave) or add (emboss). Do it
last, after fillets and shells: the letters add many faces.

```python
plate = Box(80, 30, 6)
plate = plate.fillet(plate.edges().parallel_to(Z), 4)
top = plate.faces().top()
engraved = plate - Text("SN 0042", 8).on(top).extrude(-0.6)       # 8 mm capitals, 0.6 deep
base = Box(40, 16, 3)
badge = base + Text("OK", 10).on(base.faces().top()).extrude(1)    # raised 1 mm
```

- `size` is the height of the capitals; the volume changes by `text.area * depth` exactly.
- `.on(face)` centers the text on the face's centroid, which holes move. To place it exactly,
  use a plane: `Text(...).on(Plane.XY.offset(top_z))` with `Pos(x, y)` or `align=`.
- On a vertical face the letters stand upright. A curved face has no plane: cut the text prism
  together with a skin of the wall for an even depth,
  `can - (Text(...).on(tangent_plane).extrude(-r) & (can - Cylinder(r - depth, h + 2)))`.
- Around a round part, set the text along an arc: `Text(..., path=CenterArc(c, r, 170, -160))`
  stands outside the arc (clockwise path: letters on its left side).

## DXF outlines

A profile drawn elsewhere comes in with `import_dxf` and becomes a part like any sketch:

```python
export_dxf(Slot(40, 12) - Circle(3), "outline.dxf")    # stands for a drawing from elsewhere
outline = import_dxf("outline.dxf")                     # closed loops, holes nested, in mm
link = outline.extrude(5)
```

- Drawings carry construction lines, center lines and text. Read only the outline's layers
  (`layers=["CUT"]`), and lettering inside an outline separately, or it becomes holes.
- The way out: `export_dxf(part.section(Plane.XY), "profile.dxf")` for laser cutting, with exact
  LINE, ARC and CIRCLE entities.
