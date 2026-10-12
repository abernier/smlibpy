# bends

The bends of a sheet metal part: angle, inside radius, thickness, length and axis of each.

## Signature
`part.bends(*, k_factor=0.44)` -> `list[Bend]`
`smlibpy.sheetmetal.bends(part, *, k_factor=0.44)`

## Returns
One `Bend` per bend: `angle` (degrees, 0..180, no sign), `radius` (inside), `thickness`,
`length` (along the axis), `axis` (the axis of the bend's cylinders, origin at one end) and
`allowance` for `k_factor`. A bend is a pair of coaxial cylinder faces one thickness apart;
holes and rounds (single cylinders) are not bends, so a filleted box returns `[]`.

## Gotchas
- The angle has no sign: the direction of a bend is in the flat pattern (`direction`).
- `k_factor` only changes `allowance`.

## Example
```python
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
z = bend(blank, Axis((-30, 0, 2), (0, 1, 0)), 90, radius=2)
z = bend(z, Axis((30, 0, 2), (0, 1, 0)), -45, radius=3)
for b in z.bends():
    print(b, b.axis)
print([round(b.allowance, 4) for b in z.bends(k_factor=0.5)])
print(Box(10, 10, 10).fillet(Box(10, 10, 10).edges().parallel_to(Z), 2).bends())   # rounds are no bends
```
Prints `Bend(angle=90, radius=2, thickness=2, length=40, allowance=4.52389)` with
`Axis(origin=(-27.7381, -20.0, 4.0), direction=(0.0, 1.0, 0.0))`, `Bend(angle=45, radius=3, ...,
allowance=3.04734)`, then `[4.7124, 3.1416]` and `[]`.

## Related
`flat_pattern`, `bend_allowance`, `unfold`.
