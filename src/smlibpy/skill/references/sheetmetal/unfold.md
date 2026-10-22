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
- Bends are pairs of coaxial cylinder faces one thickness apart, up to 180 degrees, made by
  `fold` and `flange` or not: an L profile extruded with inside radius 2 and outside radius 4
  unfolds to `developed_length(30, 25, radius=2, thickness=2)` = 51.523893 exactly.
- Holes and rounded corners (cylinders without a partner) stay as they are.
- Bends unfold from the fixed face outwards; any number, both directions.

## Gotchas
- A different K-factor gives a different blank: a bend made with K 0.3 unfolds 0.4398 longer
  with `k_factor=0.44`. By default it takes the 0.3 it was folded with (before 0.5.0: 0.44).
- Two bends of the same inside radius folded with different K-factors, one of which a later
  fold moved: `ModelingError` asking for `k_factor=` (the record is matched by its axis, then
  by its radius).
- The flat pattern for a cutter (on XY, with outline and bend lines) is `flat_pattern`.

## Errors
- `ModelingError: unfold: the unfolded part is 30 deep across the fixed face, the sheet is 2 thick: some of it is not a bend ...` (a sharp corner, a rib)
- `ModelingError: unfold: the inside radius 0.1 is too small; ...`
- `ValueError: unfold: fixed must be a planar face of the part`

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

## Related
`flat_pattern`, `bends`, `fold`, `developed_length`.
