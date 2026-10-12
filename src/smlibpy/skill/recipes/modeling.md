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

Draw the half profile in the XZ plane (or draw on XY and place it on `Plane.XZ`), with the
axis on one edge of the profile, and revolve about that axis. A profile that crosses the axis
makes an invalid body.

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
