# Sketch

A `Sketch` is a planar region on a plane: one or more faces, each with any number of holes.
It is the profile you extrude, revolve, sweep or loft. `Sketch` is a subclass of `Shell`.
Sketches are drawn on XY around the origin, then placed with `.on(plane_or_face)`.

## Making one

| outline | tool |
|---|---|
| standard shapes | `Rectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`, `Triangle`, `Trapezoid`, `Slot`, `ArcSlot` |
| tangent arcs, rounded inner corners, revolve sections, symmetric outlines | `Profile(...)....close()` |
| convex outlines around circles and points (levers, links) | `Hull(...)` |
| a band along a path (slots between centers, ribs) | `Stroke(path, width)` |
| combinations | `+`, `-`, `&`, `^` of the above |
| closed curves you already have | `make_face(outer, *holes)`, `wire.to_sketch()` |
| a face or section of a part | `face.to_sketch()`, `part.section(plane)` |
| lettering | `Text("SMLIB 42", 8)`: the exact outlines of a font, `size` = cap height |
| a 2D drawing from elsewhere | `import_dxf(path)` (files): its closed outlines, in mm |

The shapes share their option names: `rotation=` (degrees about the shape's center),
`align=`, and where there are corners `fillet=` and `chamfer=` (all corners).
`Rectangle(80, 50, fillet=6)` is the rounded rectangle; `RoundedRectangle` is its older name.

## Measuring

`s.area`, `s.perimeter` (outlines and holes), `s.center()` (area centroid), `s.bbox()`,
`len(s.faces())` (pieces), `len(s.faces()[0].inner_wires())` (holes), `s.plane`. `area` is
integrated to about 1e-7: a circle of radius 10 gives 314.15931 instead of 314.15927.
`(Rectangle(40, 20, fillet=4) - Circle(5)).perimeter` is 144.548668, exactly the closed form.

## Corners

`s.vertices()` are the corners; select them like edges of a part: `.convex()` (outside
corners), `.concave()` (inside corners, also the corners of a square hole), `.smooth()`
(tangent joints), `.top()`, `.nearest(p)`, `.filter(...)`. `s.fillet(r, corners)` and
`s.chamfer(d, corners)` change them (without corners: every sharp one). See `fillet`, `chamfer`.

## 2D Booleans

`a + b` unites, `a - b` cuts, `a & b` intersects, `a ^ b` keeps what is in exactly one. The
right side may be a list or a pattern; `sum(list_of_sketches)` unites a list.

- Exact: lines and arcs stay lines and arcs, areas match closed forms (two circles of radius
  10, 10 apart: `&` 122.836969 against 122.83697). Shapes that were moved, turned or placed
  combine as reliably as unmoved ones.
- A list on the right goes into one kernel call where its members do not overlap:
  `plate - (GridLocations(10, 10, 18, 10) * Circle(3))` (180 holes) takes 0.4 s. One Boolean
  of small sketches takes about 1.4 ms.
- Disjoint pieces stay one `Sketch` with several faces. A bar cut through gives 2 faces.
  Squares touching at one corner stay 2 faces; squares sharing an edge fuse to 1 face of 4 edges.
- `extrude` of a sketch with several faces gives one `Part` with several solids.
- The result keeps the **left** operand's plane (origin and normal).
- Both sketches must be in the same plane. A flipped normal on the same plane is accepted.
- A result can be empty, `Sketch(0 faces, area=0)`: cutting away everything, or intersecting
  regions that do not meet (also when their boxes are apart). `extrude`, `revolve` and
  `center()` of an empty sketch raise. Check `len(s.faces())` after cuts that may remove
  everything.

## Changing a sketch

- `offset(d, corners="round" | "sharp" | "chamfer")`: grow or shrink; bands and frames.
- `fillet(r, corners)`, `chamfer(d, corners)`: round or bevel corners.
- `mirror(axis_or_plane)`: lines and arcs stay exact and the sketch keeps facing the same way
  (`s.mirror(Y)` extrudes to the same side as `s`). `s + s.mirror(Y)` completes a symmetric
  outline.

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
  constructor's center for the primitives, the world origin for `Polygon` and `Profile`, and the
  centroid of the outline for `make_face` and `wire.to_sketch()`. `revolve()` without an axis
  turns about the local Y axis through that origin, which crosses most profiles and raises
  `ModelingError: revolve: the axis crosses the region; ...`. Always pass the axis:
  `s.revolve(Axis((0, 0, 0), (0, 1, 0)))`.
- A Part combined with a Sketch raises: `part - Circle(3)` gives `TypeError: cannot cut a
  Sketch with a Part; extrude it first` (also for `+` and `&`, and `Sketch + Part`).
- `pattern * sketch` and `(pattern * sketch).on(face)` are `ShapeList`s, not one sketch:
  extrude each (`[p.extrude(4) for p in pins]`), `sum()` them, or use them on the right of a
  Boolean.

## Errors

- `ValueError: cannot fuse sketches in different planes; place both on the same plane first`
  (also for parallel planes at another height).
- `TypeError: cannot fuse a Part with a Sketch`: `sketch + part`.
- `TypeError: cannot fuse a Edge with a Sketch: both sides must be sketches (or a list of
  sketches). Make a region from curves with make_face(...) or Profile(...).close()`.
- `ModelingError: extrude: the sketch is empty (0 faces); the Boolean or offset that made it
  removed everything`.
- `ValueError: expected exactly one shape, got 2 - narrow the selection or use [0]`: `on()`
  with a selection of several faces.
- `ValueError: a cylinder face has no plane; ...`: `on()` a curved face.
- `ValueError: a sketch region needs closed wires; use wire.close()`: `to_sketch()` of an open wire.

## Example

```python
outline = Rectangle(80, 50, fillet=8)
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

`Profile`, `Rectangle`, `Circle`, `Polygon`, `Hull`, `Stroke`, `make_face`, `offset`,
`fillet`, `chamfer`, `mirror`, `Text` (this folder); `import_dxf`, `export_dxf` (files);
`recipes/profiles`; `Sketch.extrude`, `revolve`, `sweep`, `loft` (features); `Plane`,
`Location`, patterns (geometry).
