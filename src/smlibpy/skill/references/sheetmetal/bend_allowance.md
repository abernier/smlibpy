# bend_allowance, bend_deduction, developed_length

The formulas for designing blanks: bend allowance, bend deduction and the developed length of a
strip bent into legs.

## Signatures
- `bend_allowance(angle, *, radius, thickness, k_factor=0.44)` = `radians(angle) * (radius + k_factor * thickness)`, angle above 0 and below 360 (a rolled part's 270 degrees too)
- `bend_deduction(angle, *, radius, thickness, k_factor=0.44)` = `2 * (radius + thickness) * tan(angle / 2) - bend_allowance`, angle below 180
- `developed_length(*legs, angle=90, radius, thickness, k_factor=0.44)` = `sum(legs) - sum(bend_deduction)`

The legs are outside lengths: from a free end or a virtual sharp (where the outer faces of two
legs meet) to the next. `angle` is one angle for all bends or a list of `len(legs) - 1`.

## Values (t 2)
| R | BA (90) | BD (90) | blank for legs 50 + 30 |
|---|---|---|---|
| 1 | 2.9531 | 3.0469 | 76.9531 |
| 2 | 4.5239 | 3.4761 | 76.5239 |
| 4 | 7.6655 | 4.3345 | 75.6655 |
| 8 | 13.9487 | 6.0513 | 73.9487 |

K 0.33 / 0.4 / 0.44 / 0.5 with R 2: BA 4.1783 / 4.3982 / 4.5239 / 4.7124.

## Gotchas
- The bend line for `fold` is the middle of the zone: for an outside leg L from the free end,
  put it at `L - (radius + thickness) + bend_allowance(...) / 2` (90 degrees).
- These match what `fold` and `flat_pattern` do exactly: the extruded L with legs 30 and 25
  unfolds to `developed_length(30, 25, ...)`, a bent blank of that length measures 60 x 40.

## Example
```python
t, r = 2, 2
print(round(bend_allowance(90, radius=r, thickness=t), 6))               # pi/2 * (2 + 0.44 * 2)
print(round(bend_deduction(90, radius=r, thickness=t), 6))               # 2 * (r + t) - BA
blank_length = developed_length(60, 40, radius=r, thickness=t)           # outside legs 60 and 40
print(round(blank_length, 6))
u_length = developed_length(20, 50, 20, angle=[90, 90], radius=r, thickness=t)
print(round(u_length, 6))
blank = Box(blank_length, 30, t, align=Align.MIN)
line_x = 60 - (r + t) + bend_allowance(90, radius=r, thickness=t) / 2     # middle of the bend zone
bracket = fold(blank, Axis((line_x, 0, t), (0, 1, 0)), 90, radius=r, fixed=(0, 0, 0))
print(round(bracket.bbox().size.x, 6), round(bracket.bbox().size.z, 6))  # 60 x 40 outside
```
Prints `4.523893`, `3.476107`, `96.523893`, `83.047787` and `60.0 40.0`.

## Related
`fold`, `flat_pattern`, `sheetmetal/generic`, `recipes/sheet-metal`.
