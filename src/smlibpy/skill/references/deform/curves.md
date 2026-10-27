# Deforming edges, wires and points

`twist`, `taper`, `bend`, `unroll` and `Lattice.apply` take edges, wires and points as well as
parts, and move them exactly as they move a part. Deform a path and sweep along it, follow a
point of a part through a deformation, or drape a curve with a lattice.

## Signature
`twist(edge_or_wire_or_points, angle, ...)`, `taper(...)`, `bend(...)`,
`unroll(..., radius=...)`, `lat.apply(...)` or `deform(..., lat)`; the options are those for parts
(`deform/twist`, `deform/taper`, `deform/bend`, `deform/unroll`, `deform/Lattice`).

- An `Edge` gives an `Edge`, a `Wire` a `Wire`, a point (a `Vector` or `(x, y, z)`) a
  `Vector`, a list of points a list of `Vector`s. `lat.map(point)` is the lattice's own point map.
- The default range (`start`, `end`) of an edge or wire is its extent along the axis, as for a
  part. A point has none: give twist and taper, and bend without a radius, the `start` and
  `end` of the part it belongs to (`ValueError: twist: give start and end for points ...`
  otherwise). Points before `start` stay; points beyond `end` move as the part's end does
  (turned by the whole angle, scaled by `scale`, carried on straight after a bend).

## Returns
Every edge is split where it crosses `start` and `end`. A `Wire` gets an edge for every piece;
an `Edge` stays one edge, its pieces joined into one B-spline (pass `Wire([edge])` to keep them
apart). Pieces whose exact image is a line or a circle are exact lines and arcs (a line across a
bend: an arc of the bend's radius; a circle about a taper's axis: a circle), pieces under
lattices and tapers exact B-splines, other pieces (a line off a twist's axis: a helix) within
`tolerance` (1e-6 mm) of the exact image.

| input | result |
|---|---|
| `bend(Wire([Line((-50, 0, 0), (50, 0, 0))]), 90, radius=10)` | 3 edges: line 42.146, arc r 10 (15.708), line 42.146 |
| `bend(Line((-50, 0, 0), (50, 0, 0)), 90, radius=10)` | 1 B-spline edge, length 100 |
| `bend(Line((-50, 0, 0), (50, 0, 0)), 90)` | 1 arc, radius 200 / pi |
| `twist(Line((10, 0, 0), (10, 0, 100)), 90)` | a quarter turn of a helix (B-spline within 1e-6) |
| `taper(CenterArc((0, 0, 50), 10, 0, 360), 0.5, start=0, end=100)` | circle r 7.5 |
| `unroll(Helix(pitch=100, height=40, radius=10), radius=10)` | a line, 47.2404 long |
| `twist((10, 0, 100), 90, start=0, end=100)` | `Vector(0, 10, 100)` |

## Gotchas
- `unroll` of a curve: the curve must not reach the axis or go all the way around it (a helix
  of more than one turn cannot unroll: `ModelingError ... goes all the way around the axis`).
- Lattices are not checked for folding on curves and points (a curve cannot turn inside out);
  the image is the exact polynomial image.
- A closed wire stays closed; a bent closed rectangle has 8 edges (4 split at the bend's ends).

## Example
```python
path = bend(Wire([Line((-50, 0, 0), (50, 0, 0))]), 90, radius=10)
print([(e.geom_type, round(e.length, 3)) for e in path.edges()])
pipe = sweep(Circle(2), path)                         # the swept path: an exact elbow
print(pipe.is_valid(), round(pipe.volume, 3))

bar = Box(100, 10, 10, align=(Align.MIN, Align.CENTER, Align.CENTER))
bent = bar.bend(90)
print(bend((100, 0, 0), 90, start=0, end=100))        # where the middle of the bar's end went

lat = Lattice(Box(60, 40, 20), 3)
lat.move((1, 1, -1), (0, 0, 8))
ridge = lat.apply(Line((-30, 0, 10), (30, 0, 10)))    # the line on the pillow's top
print(ridge.geom_type, ridge.point_at(0.5))
```
prints `[('line', 42.146), ('circle', 15.708), ('line', 42.146)]`, `True 1256.637`,
`Vector(63.662, 0, 63.662)` and `bspline Vector(0, 0, 12)`.

## Related
`deform/generic`, `deform/bend`, `deform/twist`, `deform/taper`, `deform/unroll`,
`deform/Lattice`; `sweep` along a deformed path.
