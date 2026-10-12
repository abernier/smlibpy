# Cone

A cone or frustum with its axis along Z.

## Signature

`Cone(bottom_radius, top_radius, height, *, align=Align.CENTER)`

- `bottom_radius` at the low end (−Z), `top_radius` at the high end (+Z). One of them may be 0
  for a pointed cone. Equal radii give a cylinder (the side face is then a `cylinder` face).
- `align`: per axis, as for `Box` (bounding-box based).

## Returns

A `Part`, centered on its bounding box, not on its center of mass. `Cone(10, 4, 15)`: bottom
circle r 10 at z −7.5, top circle r 4 at z 7.5; 3 faces (cone + 2 planes).
`Cone(10, 0, 15)`: 2 faces, apex vertex at (0, 0, 7.5).

Volume matches π·h·(R² + R·r + r²)/3 (2450.442 for 10/4/15).

## Gotchas

- The center of mass is not at the origin: `Cone(10, 4, 15).center().z` is −2.02.
- To stand it on XY use `align=(Align.CENTER, Align.CENTER, Align.MIN)`; then the apex of
  `Cone(10, 0, 15)` is at (0, 0, 15).
- Apex down: `Cone(0, 10, 15)` (or `Cone(10, 0, 15).rotate(X, 180)`, the same geometry).
- A tiny radius (1e-6) is treated as 0: the cap face disappears.

## Errors

- Both radii 0, height ≤ 0, or a negative radius: `ValueError: invalid cone dimensions`.

## Example

```python
frustum = Cone(10, 4, 15)                                                # r 10 at z -7.5, r 4 at z 7.5
tip = Cone(10, 0, 15, align=(Align.CENTER, Align.CENTER, Align.MIN))     # apex at (0, 0, 15)
apex_down = Cone(10, 0, 15).rotate(X, 180)                               # apex at (0, 0, -7.5)
print(frustum.bbox(), [v.point for v in tip.vertices()], [v.point for v in apex_down.vertices()])
```

## Related

`Cylinder`, `CounterSinkHole` (uses a cone for the sink), `booleans`,
`sketches/Rectangle` + `extrude(taper=...)` for drafted prisms.
