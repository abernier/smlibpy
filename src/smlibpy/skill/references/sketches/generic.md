# Sketch

A `Sketch` is a planar region on a plane: one or more faces, each with any number of holes.
It is the profile you extrude, revolve, sweep or loft. `Sketch` is a subclass of `Shell`.

## Making one

- Constructors: `Rectangle`, `RoundedRectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`,
  `Slot`, `Trapezoid`. All build on the world XY plane, normal +Z.
- From curves: `make_face(outer_wire, *hole_wires)`, `wire.to_sketch()`.
- From a part: `face.to_sketch()` (copy of a planar face, holes kept, normal pointing out of the
  part), `part.section(plane)`.
- Lettering: `Text("SMLIB 42", 8)`, the exact outlines of a font, `size` = cap height. See `Text`.
- From a drawing: `import_dxf(path)` (files): the closed outlines of a DXF as a sketch in mm, at
  the drawing's coordinates.

## Measuring

`s.area`, `s.center()` (area centroid), `s.bbox()`, `len(s.faces())` (pieces),
`len(s.faces()[0].inner_wires())` (holes), `s.plane`. `area` is integrated numerically: a
circle of radius 10 gives 314.15931 instead of 314.15927.

## 2D Booleans

`a + b` unites, `a - b` cuts, `a & b` intersects, `a ^ b` keeps what is in exactly one. The
right side may be a list or a pattern; `sum(list_of_sketches)` unites a list.

- Disjoint pieces stay one `Sketch` with several faces. A bar cut through gives 2 faces.
  Squares touching at one corner stay 2 faces; squares sharing an edge fuse to 1 face.
- `extrude` of a sketch with several faces gives one `Part` with several solids.
- The result keeps the **left** operand's plane (origin and normal).
- Both sketches must be in the same plane. A flipped normal on the same plane is accepted.

## Placing

A sketch is drawn around the origin of XY and then placed. These are the same:
`s.on(Plane.XY.offset(15))`, `Plane.XY.offset(15) * s`, `Pos(0, 0, 15) * s`, `s.translate(0, 0, 15)`.
`on()` maps local X to the plane's x_dir, local Y to its y_dir and the normal to z_dir.

| Target | local X | local Y | normal (extrude +) |
|---|---|---|---|
| `Plane.XY` / `top` | +X | +Y | +Z |
| `Plane.bottom` | +X | -Y | -Z |
| `Plane.XZ` / `front` | +X | +Z | -Y |
| `Plane.back` | -X | +Z | +Y |
| `Plane.YZ` / `right` | +Y | +Z | +X |
| `Plane.left` | -Y | +Z | -X |

A planar face of a part has the same frame as the named plane on that side, with the origin at
the face's center and the normal pointing out of the part. So `sketch.on(face).extrude(-d)` goes
into the part (subtract it), `extrude(+d)` grows out of it (add it).

## Gotchas

- `on(face)` puts the sketch origin at the face's **area centroid**, not at the middle of its
  bounding box. Holes shift it: on a plate whose top has a hole at y = +15, the centroid was at
  y = -0.49. When the position matters, place on a plane: `s.on(Plane.XY.offset(top_z))`.
- `sketch.plane.origin` moves with the sketch, also with `align` and `translate`. It is the
  constructor's center for the primitives, the world origin for `Polygon`, and the centroid of
  the outline for `make_face` and `wire.to_sketch()`. `revolve()` without an axis turns about
  the local Y axis through that origin, which crosses most profiles and raises
  `ModelingError: revolve: the axis crosses the region; ...`. Always pass the axis:
  `s.revolve(Axis((0, 0, 0), (0, 1, 0)))`.
- `mirror()` flips the normal: `Rectangle(20, 10).mirror(Plane.XZ).extrude(5)` goes to z = -5.
  `a + a.mirror(...)` keeps `a`'s normal; `a.mirror(...) + a` has the flipped one.
- A Part combined with a Sketch raises: `part - Circle(3)` gives `TypeError: cannot cut a
  Sketch with a Part; extrude it first` (also for `+` and `&`, and `Sketch + Part`).
  Extrude first.
- Cutting away everything, or intersecting regions whose boxes overlap but that do not
  touch, returns an empty `Sketch(0 faces, area=0)` with no error. Its `extrude` is an empty
  Part, its `center()` raises `ZeroDivisionError`. Check `len(s.faces())` after cuts.
- `pattern * sketch` and `(pattern * sketch).on(face)` are `ShapeList`s, not one sketch:
  extrude each (`[p.extrude(4) for p in pins]`) or `sum()` them first.

## Errors

- `ValueError: cannot fuse sketches in different planes` (also for parallel planes at
  another height). Place both on the same plane first.
- `ValueError: the sketches do not overlap; their intersection is empty`: `&` of sketches whose
  bounding boxes do not touch.
- `TypeError: cannot fuse a Part with a Sketch`: `sketch + part`.
- `TypeError: cannot combine a body with a Edge value; use parts (or a list of parts)`:
  `sketch + edge`. Make a region first.
- `ValueError: expected exactly one shape, got 2 - narrow the selection or use [0]`: `on()`
  with a selection of several faces.
- `ValueError: a cylinder face has no plane; ...`: `on()` a curved face.
- `ValueError: a sketch region needs closed wires; use wire.close()`: `to_sketch()` of an open wire.

## Example

```python
outline = RoundedRectangle(80, 50, 8)
holes = GridLocations(64, 34, 2, 2) * Circle(3)
plate_sketch = outline - holes - Slot(30, 10) - Circle(6).translate(0, 15)
plate = plate_sketch.extrude(6)            # volume == plate_sketch.area * 6

pins = (Locations((-25, 0), (25, 0)) * Circle(2)).on(plate.faces().top())
pinned = plate + [p.extrude(4) for p in pins]
```

```python
box = Box(60, 40, 20)
pocket = Rectangle(30, 20).on(box.faces().top()).extrude(-4)
cut = box - pocket                          # 45600 = 48000 - 30*20*4
grown = box + box.faces().facing(X).one().to_sketch().extrude(5)   # bbox x up to 35
```

## Related

`Rectangle`, `Circle`, `Polygon`, `make_face`, `offset`, `fillet`, `Text` (this folder); `import_dxf`,
`export_dxf` (files);
`Sketch.extrude`, `revolve`, `sweep`, `loft` (features); `Plane`, `Location`, patterns (geometry).
