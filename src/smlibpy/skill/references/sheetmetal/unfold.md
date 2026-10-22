# unfold

Unfolds a sheet metal part: every bend becomes flat again, in place.

## Signature
`unfold(part, *, k_factor=None, fixed=None)`
`part.unfold(*, k_factor=None, fixed=None)`

- `fixed`: a planar face of the part that stays where it is; default: the largest planar face
  (of faces that large, the one the part stands on: the rest of the part lies behind it).
- `k_factor`: default `None`: each bend unfolds with the K-factor `fold` or `flange` made it with
  (the part keeps it, through Booleans, moves and `named()`), else 0.44 (a part read from a
  file). Or one for all bends, per bend: a number; `{inside radius: k}`; `[(r / t, k), ...]`
  interpolated; a function `(radius, thickness, angle) -> k`; `"din6935"` (see `generic`).

## Returns
A flat `Part`, the fixed face in its place. A U channel bent from a 100 x 40 x 2 blank unfolds
to the blank: bbox (-50, -20, 0)..(50, 20, 2), volume 8000.0. With `fixed=` the outside face of a
flange, the flat stands in that face's plane.

## What unfolds
- Bends are pairs of coaxial cylinder faces one thickness apart, made by `fold`, `flange` and
  `Part.bend` or not: an L profile extruded with inside radius 2 and outside radius 4 unfolds
  to `developed_length(30, 25, radius=2, thickness=2)` = 51.523893 exactly.
- Up to 180 degrees with flat sheet on both sides (the kernel's unbend); and with the unbend
  deformation (see `deform/unroll`): **rolled parts** (one bend, no flat: a ring segment, any
  angle below 360; it unrolls about the middle of the bend, `fixed` not allowed), a bend at a
  **free end** of the sheet (a J, a curl), and bends **over 180 degrees** (the sheet toward the
  fixed face stays, the sheet beyond moves along). Each at the neutral radius r + k * t.
- Holes and rounded corners (cylinders without a partner) stay as they are.
- Bends unfold from the fixed face outwards; any number, both directions.

## Gotchas
- A different K-factor gives a different blank: a bend made with K 0.3 unfolds 0.4398 longer
  with `k_factor=0.44`. By default it takes the 0.3 it was folded with (before 0.5.0: 0.44).
- Two bends of the same inside radius folded with different K-factors, one of which a later
  fold moved: `ModelingError` asking for `k_factor=` (the record is matched by its axis, then
  by its radius).
- The flat pattern for a cutter (on XY, with outline and bend lines) is `flat_pattern`.
- A free-end bend, a bend over 180 degrees and a rolled part must run the full width of the
  sheet beside them (no sheet next to the bend along its axis); with more than one bend, each
  needs flat sheet on at least one side.

## Errors
- `ModelingError: unfold: the unfolded part is 30 deep across the fixed face, the sheet is 2 thick: some of it is not a bend ...` (a sharp corner, a rib)
- `ModelingError: unfold: the inside radius 0.1 is too small; ...`
- `ValueError: unfold: fixed must be a planar face of the part`
- `ValueError: unfold: the part is rolled (one bend, no flat sheet to keep in place) ...` (with `fixed=`)
- `ModelingError: unfold: unrolling a bend failed (...)`

## Example
```python
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
u = fold(blank, Axis((-30, 0, 2), (0, 1, 0)), 90, radius=2)
u = fold(u, Axis((30, 0, 2), (0, 1, 0)), 90, radius=2)
flat = unfold(u)                                          # the base stays where it is
print(flat.bbox(), round(flat.volume, 9))
side = u.faces().filter(lambda f: f.geom_type == "plane").sort_by(X).first   # outside of the -X flange
print(unfold(u, fixed=side).bbox())                       # the flat now stands in that face's plane
```
Prints `BoundBox(min=(-50.0, -20.0, 0.0), max=(50.0, 20.0, 2.0)) 8000.0` and
`BoundBox(min=(-31.7381, -20.0, -78.2619), max=(-29.7381, 20.0, 21.7381))`.

```python
ring = Cylinder(52, 40) - Cylinder(50, 50) - Box(60, 60, 50, align=(Align.MIN, Align.MIN, Align.CENTER))
print(ring.bends()[0].angle, round(flat_pattern(ring).size.x, 4))    # 270.0 239.7664 (3 pi / 2 * 50.88)
curl = (Cylinder(12, 40) - Cylinder(10, 50)).rotate(X, 90).translate(0, 0, 12)
curl = curl - Box(20, 60, 20, align=(Align.MAX, Align.CENTER, Align.MAX)).translate(0, 0, 12)
hemmed = Box(100, 40, 2, align=(Align.MAX, Align.CENTER, Align.MIN)) + curl   # a 270 degree curl at x = 0
print(hemmed.unfold().bbox())                  # the plate stays; x -100..51.2708
```

## Related
`flat_pattern`, `bends`, `fold`, `developed_length`.
