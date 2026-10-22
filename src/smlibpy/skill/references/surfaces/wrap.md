# wrap

Lay a flat drawing onto a face, as a label onto a can: lettering, logos and paths around
cylinders and over curved faces, keeping their lengths.

## Signature
`face.wrap(shape, at=None, *, direction=None) -> ShapeList[Edge]`

- `shape`: an `Edge`, a `Wire`, a `Sketch` (its edges) or a list of edges, drawn on XY (z is
  ignored).
- `at`: where the drawing's origin goes: a point of the face's surface. Default: the middle of
  the face's parameter range.
- `direction`: where the drawing's X axis points at `at` (projected onto the face; it follows the
  face's parameter line nearest to it). Default: the face's first parameter direction there
  (around a cylinder). Y goes across, so that the drawing reads from outside.

## Returns
Free edges on the face (B-splines within 1e-7 of the face's size), cut where they cross the
face's seam and where they leave the face (also in its holes).

Lengths stay along the two parameter lines through `at`: x is measured along one, y along the
other. On planes and cylinders the whole drawing keeps its size; on cones and doubly curved
faces it stretches away from those lines (a circle of radius 2 on a sphere of radius 10 is 1 %
shorter around). Around a closed face the drawing continues across the seam.

## Example
```python
can = Cylinder(20, 50)
side = can.faces().cylinders()[0]
label = side.wrap(Text("SMLIB", 8), (0, -20, 0), direction=(1, 0, 0))   # lettering around the can
band = side.wrap(Rectangle(40, 10), (0, -20, 0))     # 40 around, 10 high
print(sorted(round(e.length, 4) for e in band))       # [10.0, 10.0, 40.0, 40.0]
path = side.wrap(Line((-60, -5), (60, 5)))            # a helical path almost once around, 120.416 long
```

## Gotchas
- The result is curves, not a cut or an embossed body. To engrave lettering, `bend()` an
  extruded `Text` around the cylinder (`deform/bend`); the wrapped curves serve as sweep paths,
  split lines and drawings.
- `at` must lie on the face's surface: `ValueError: wrap: at must be a point of the face's surface ...`.
- A `direction` normal to the face raises `ValueError`.

## Related
`iso`, `analysis/project`, `deform/bend`, `sketches/Text`.
