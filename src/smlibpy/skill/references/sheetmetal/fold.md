# fold

Folds a sheet along a line by an angle, with an exact bend of the given inside radius.

## Signature
`fold(part, line, angle, *, radius, k_factor=0.44, fixed=None, partial=False)`
`part.fold(line, angle, *, radius, k_factor=0.44, fixed=None, partial=False)`

- `line`: an `Axis` or a straight `Edge` (`Line(a, b)`) on the top or bottom face of the sheet.
  It is the **middle of the bend zone**: the strip `bend_allowance` wide centered on it becomes
  the bend. `Axis` takes a direction vector: `Axis((20, 0, 2), (0, 1, 0))`; `Axis(p, Y)` raises
  `TypeError` (`Y` is an Axis). A line up to 1e-6 x the part size off the face is moved onto it.
- `angle`: degrees, up to 180. Positive folds towards the side the line's face faces (that face
  ends up inside), negative the other way.
- `fixed`: a point (or a face, edge, vertex) on the side that stays; default: the side that
  reaches farther from the line.
- `partial=True`: bend only along the segment `line`; the strip must be cut free (relief cuts).

## Returns
A `Part`. A 100 x 40 x 2 plate (z = 0..2) bent at x = 20 with R 2: the -X side stays, the flange
stands at x = 20 - BA/2 + R + t = 21.7381 and reaches z = t + R + (30 - BA/2) = 31.7381.
Bend faces are cylinders of exactly R and R + t; the end edges circles, all others lines.

## Placing the line
- For an outside leg L (from the free end to the outer face of the other leg, 90 degrees), put
  the line `L - (R + t) + BA/2` from the free end; `developed_length` gives the blank length.
- On a part bent before, draw the line on the flange's face: its plane is exact
  (`face.center()`), e.g. the inside face of the flange above at x = 20 - BA/2 + R.
- A second bend's line must be at least half its allowance away from the flat end of the first
  bend (where its cylinder meets the flat), else `ModelingError: ... holds more than the sheet`.

## Gotchas
- The line must cross the sheet everywhere along the bend zone: near a parallel edge (closer
  than BA/2) or across a notch the bend is refused; such a strip needs `partial=True` and reliefs.
- `fixed` decides which side moves, not the direction: the direction comes from the angle sign
  and the face of the line.
- The volume grows with the K-factor below 0.5 (8015.0797 for the plate above); that is right.
- Holes in the bend zone bend into NURBS (within 1e-4); see `sheetmetal/generic`.

## Errors
- `ModelingError: bend: the bend line does not lie on a face of the sheet; ...`
- `ModelingError: bend: the bend line does not cross the sheet (there is no material in the bend zone)`
- `ModelingError: bend: the bend zone does not cut the sheet in two: ...` (line 1 from an edge)
- `ModelingError: bend: the bend zone holds more than the sheet (...)` (overlapping bends, ribs)
- `ModelingError: bend: the inside radius 0.1 is too small; the kernel bends and unfolds radii from 0.11 ...`
- `ValueError: bend: the angle must be between -180 and 180 degrees and not zero (got 200)`
- `ValueError: bend: the bend line must be straight (an Axis or a Line), not a circle`
- `ValueError: bend: partial=True needs the bend line as an Edge (a segment), not an Axis`

## Example
```python
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))   # z = 0..2
bracket = fold(blank, Axis((20, 0, 2), (0, 1, 0)), 90, radius=2)        # line on the top face at x = 20
ba = bend_allowance(90, radius=2, thickness=2)
bb = bracket.bbox()
print(round(bb.max.x, 4), round(bb.max.z, 4))            # 20 - BA/2 + R + t, t + R + (30 - BA/2)
print(sorted(round(f.radius, 6) for f in bracket.faces() if f.geom_type == "cylinder"))   # exact R and R + t
down = fold(blank, Axis((20, 0, 2), (0, 1, 0)), -90, radius=2)          # negative: folds away from the face
print(round(down.bbox().min.z, 4))
```
Prints `21.7381 31.7381`, `[2.0, 4.0]` and `-29.7381`.

A tab cut free by two slots, bent along a 20 long segment:
```python
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
slots = Box(31, 1, 10).translate(35, 10.5, 0) + Box(31, 1, 10).translate(35, -10.5, 0)   # reliefs x 19.5..50.5
tab = fold(blank - slots, Line((25, -10, 2), (25, 10, 2)), 90, radius=2, partial=True)
print(tab.is_valid(), tab.bbox().max, tab.bends())
```
Prints `True Vector(50, 20, 26.7381) [Bend(angle=90, radius=2, thickness=2, length=20, allowance=4.52389)]`.

## Related
`flange`, `unfold`, `bend_allowance`, `sheetmetal/generic`.
