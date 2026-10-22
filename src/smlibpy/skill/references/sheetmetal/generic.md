# Sheet metal: what the functions share

Sheet metal parts are solids of one thickness: flat regions joined by bends. smlibpy bends and
unfolds them exactly with the kernel's space bend: `fold`, `flange`, `unfold`, `flat_pattern`,
`Part.bends`, and the formulas `bend_allowance`, `bend_deduction`, `developed_length`.

## Building a part
1. Base flange: a plate lying on XY, `Box(L, W, t, align=(Align.CENTER, Align.CENTER, Align.MIN))`
   (z = 0..t), or `sketch.extrude(t)` for any outline. Cut holes now if they stay out of the
   bend zones (holes across a bend zone are better cut in the flat; see Limits).
2. Edge flanges with `flange` on outer edges, bends with `fold` along lines on a sheet face.
3. Check: `is_valid()`, `bbox()`, `part.bends()`; then `flat_pattern(part)` for the blank.

## Terms
- `radius`: the inside bend radius. `thickness`: found from the part (the distance from the
  face with the line or edge to the nearest face opposite it).
- `k_factor`: where the neutral fiber lies, 0 (inside face) to 1 (outside face); default 0.44
  (`smlibpy.sheetmetal.K_FACTOR`). The neutral fiber keeps its length. The part keeps the
  K-factor each bend was folded with, and `unfold`, `flat_pattern` and `bends` take it, so the
  blank comes back. Their `k_factor=` takes, for every bend: a number; `{1: 0.33, 6: 0.45}` by
  inside radius; `[(0.5, 0.33), (3, 0.45)]`, `(r / t, k)` pairs interpolated (the ends held); a
  function `(radius, thickness, angle) -> k`; `"din6935"`: DIN 6935's `k = 0.65 + 0.5 log10(r / t)`
  up to `r / t = 5`, the neutral fiber at `k t / 2`, as a K-factor `k / 2`
  (`smlibpy.sheetmetal.din6935(r, t)`).
- Bend allowance `BA = radians(angle) * (radius + k_factor * thickness)`: the strip of the flat
  that the bend takes (4.5239 for 90 degrees, R 2, t 2).
- Outside setback `(radius + thickness) * tan(angle / 2)`: from the start of the bend to the
  virtual sharp, where the outer faces of the two legs meet. Bend deduction = 2 setbacks - BA.

## Directions
- `fold(part, line, angle)`: the line lies on a sheet face. A positive angle folds towards the
  side that face faces (it ends up inside the bend), a negative one the other way. A line on
  the bottom face with a positive angle folds down.
- The side that stays: `fixed=` a point on it; by default the side that reaches farther from the line.
- `flange(part, edge, length)`: the edge lies on a sheet face; the flange folds towards that face's side.
- Flat patterns lie on XY with the largest face at z = 0 facing down; `"up"` bends fold towards +Z.

## Exact geometry
- Bend faces are exact cylinders of `radius` and `radius + thickness`, their end edges exact
  circles; flat regions stay planes. A strip cut obliquely by the outline still gets exact
  cylinders (only the oblique side faces in the zone become NURBS).
- The volume grows by `A * t**2 * (0.5 - k) / (radius + k * t)` per bend (A: area of the strip in
  the flat): the material outside the neutral fiber stretches. K = 0.5 keeps the volume.
  A 100 x 40 x 2 plate bent 90 degrees with R 2: 8015.079645 (`mass_properties(accuracy=1e-10)`);
  the default `volume` is accurate to about 1e-9 relative (8015.079653).
- Bending and unfolding with the same K-factor gives the blank back: volume 8000.0, the original
  bounding box to 1e-9.

## Limits
- `|angle|` above 0 and up to 180 for `fold` (180 makes a hem), below 180 for `flange`.
- `radius` at least 0.11: the kernel's bend region reaches 0.1 past the sheet. Radii far below
  the thickness work (0.3 on t 2, 0.11 on t 2).
- The bend zone (BA wide, centered on the line) must cross flat sheet only: keep the line at
  least BA/2 from edges parallel to it, from the flat end of other bends and from ribs.
- A bend that does not cross the whole sheet (`partial=True`) needs relief cuts reaching at
  least BA/2 past the line on both ends.
- `unfold` treats coaxial cylinder faces one thickness apart as bends. Other curved faces (holes,
  rounded corners) stay; a corner without a radius does not unfold (`ModelingError`).
- A hole across a bend zone bends into NURBS (within 1e-4) and unfolds again, but the kernel
  integrates the volume of such a part badly (7876.9 instead of 7842.9): check it with
  `part.mesh(0.001).volume` (7842.9363). Cut such holes in the flat instead.

## Errors
- `ModelingError: bend: the bend line does not lie on a face of the sheet; draw it on the top or bottom face ...`
- `ModelingError: bend: the bend zone does not cut the sheet in two: it reaches past an edge of the sheet or the sheet goes around it; keep the line at least half the bend allowance (2.262) away ...`
- `ModelingError: bend: the bend zone holds more than the sheet (2.1 deep across it, the sheet is 2 thick): a rib, flange or other bend stands in it; move the line`
- `ModelingError: bend: the sheet beside the partial bend is not cut free: cut reliefs (slots) ...`
- `ModelingError: unfold: the unfolded part is 30 deep across the fixed face, the sheet is 2 thick: some of it is not a bend ...`
- `ValueError` for angles, radii and K-factors out of range; `TypeError` for a sketch instead of a part.

## Example
```python
t, r = 2, 2                                                     # sheet thickness, inside bend radius
plate = Box(100, 60, t, align=(Align.CENTER, Align.CENTER, Align.MIN))   # base flange: a plate on XY
part = plate.flange(plate.edges().filter_by(Y).filter(lambda e: e.center().z > t / 2).last, 25, radius=r)
part = part.fold(Axis((-20, 0, t), (0, 1, 0)), 90, radius=r)          # fold the -X end up as well
print(part.is_valid(), part.bbox().size, len(part.bends()))
ba = bend_allowance(90, radius=r, thickness=t)                     # 4.5239 with the default K 0.44
pattern = part.flat_pattern()
print(pattern.size, [b.direction for b in pattern.bends], round(ba, 4))
```
Prints `True Vector(71.7381, 60, 35.7381) 2` and `Vector(125.524, 60, 2) ['up', 'up'] 4.5239`.

## Related
`sheetmetal/fold`, `sheetmetal/flange`, `sheetmetal/unfold`, `sheetmetal/flat_pattern`,
`sheetmetal/bends`, `sheetmetal/bend_allowance`, `recipes/sheet-metal`.
