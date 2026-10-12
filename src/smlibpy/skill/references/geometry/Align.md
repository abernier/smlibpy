# Align

Where a new primitive or sketch sits relative to the origin, per axis: `Align.MIN`,
`Align.CENTER`, `Align.MAX`.

## Usage
`align=` on `Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge` and on the sketch
constructors (`Rectangle`, `RoundedRectangle`, `Circle`, `Ellipse`, `Polygon`,
`RegularPolygon`, `Slot`, `Trapezoid`). `Hole` and its variants have no `align`.

- One value applies to every axis: `Box(10, 10, 10, align=Align.MIN)` fills x, y, z 0..10.
- A tuple sets each axis: `(Align.CENTER, Align.CENTER, Align.MIN)` stands a part on XY.
- `MIN`: the bbox minimum goes to 0 (shape on the positive side). `MAX`: the bbox maximum
  goes to 0 (negative side). `CENTER`: the bbox center goes to 0.
- `None` in a tuple, or a missing third entry, leaves that axis as built (centered for
  primitives). Sketches use only x and y; a third entry is ignored.
- Strings work too, case-insensitive: `align="min"`, `("MIN", "center", "max")`.
- Alignment uses the shape's bounding box at creation, before any `.on()` or `translate`.
  `Rectangle(10, 20, align=(Align.CENTER, Align.MIN)).on(Plane.front)` stands on z = 0.

## Defaults
Primitives and most sketches are centered. `Polygon` defaults to `align=None`: its points
stay where you gave them.

## Gotchas
- `RegularPolygon` (odd side counts) is centered on its circumcenter, not its bbox, when
  `align` is a single `Align.CENTER` (the default): a triangle of radius 10 spans
  x -5..10. The tuple `(Align.CENTER, Align.CENTER)` centers the bbox (x -7.5..7.5).
- `Wedge` with `align=CENTER` is centered by its bbox, not its centroid
  (`Wedge(10, 20, 30).center()` is not the origin).
- An invalid string raises `ValueError: 'bottom' is not a valid Align`.

## Example
```python
base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))     # z 0..8
post = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
part = base + post
print(part.bbox())                    # z 0..28

corner = Box(10, 10, 10, align=Align.MIN)                  # x, y, z all 0..10
under = Box(10, 10, 10, align=(None, None, Align.MAX))     # centered in x, y; z -10..0
print(corner.bbox(), under.bbox())

tab = Rectangle(20, 6, align=(Align.CENTER, Align.MIN))    # sketches: x and y only
print(tab.bbox())                     # y 0..6
tri = RegularPolygon(10, 3, align=(Align.CENTER, Align.CENTER))   # bbox centered
print(tri.bbox())
```

## Related
`BoundBox`, `translate`, `on`, parts `Box`, sketches `Rectangle`.
