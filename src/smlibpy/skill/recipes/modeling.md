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
