# Helix

A helical edge, cylindrical or conical. The usual path for springs, coils and threads.

## Signature
`Helix(pitch, height, radius, *, center=(0, 0, 0), direction=(0, 0, 1), end_radius=None, left_handed=False)`

- `pitch`: rise per turn, mm. `height / pitch` turns; fractions are fine. There is no
  `turns` parameter: for n turns pass `height = n * pitch`.
- `height`: total rise along `direction`, from `center`.
- `radius`: start radius. `end_radius`: radius at the top, for a conical helix (> 0).
- `center`: the point on the axis where the helix starts (the bottom).
- `direction`: the axis, a vector or an Axis (only its direction counts; `center` places the
  helix). The helix rises along it.
- `left_handed=False`: right-handed, i.e. counterclockwise seen from the tip of `direction`
  while rising.

## Returns
An `Edge` (`geom_type == "bspline"`).
- Starts at `center + radius * x`, where `x = Plane(center, z_dir=direction).x_dir`. For the
  default Z axis that is (radius, 0, 0): `Helix(5, 20, 10)` runs from (10, 0, 0) to
  (10, 0, 20); after a quarter turn it is at (0, 10, 1.25) (left-handed: (0, -10, 1.25)).
- `direction=(1, 0, 0)` starts at (0, radius, 0); `(1, 1, 0)` at (-0.707·r, 0.707·r, 0).
  Print `h.start` when it matters.
- It is a B-spline approximation: radial deviation about 4e-6 · radius, length about 2e-6
  short. Exact enough for threads and springs.

## As a sweep path
`sweep(profile, helix)` centers the profile's bounding box on `helix.start` and turns it to
face along the helix. For the default axis, the sketch's **X axis points radially out** and
its **Y axis along the helix axis**. So:
- `Rectangle(2, 1)` on `Helix(4, 12, 8)` is 2 radial (x 7..9) and 1 axial.
- A thread tooth points along sketch +X; set the helix radius a little below rod radius + the
  half width of the tooth's bounding box in X, so its base sinks into the rod (0.05 below).
  A base exactly on the rod's surface only touches the rod, and `rod + thread` raises
  `KernelError` ("the operands touch only along an edge ... or tangentially").
- The profile keeps that attitude along the whole helix (it turns with the helix about its
  axis, not about the path): a `Rectangle(2, 1)` stays 2 radial and 1 axial at every turn, also
  on a conical helix and on a chain of helices. `twist=` turns it on top of that; `up=` sets
  another direction to keep the attitude to.

```python
spring = sweep(Circle(1.2), Helix(pitch=6, height=48, radius=10))     # valid, volume pi*1.44*L
rod = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
tooth = Polygon((0, -0.8), (0, 0.8), (1.2, 0))                         # tip towards +X
thread = sweep(tooth, Helix(pitch=2, height=16, radius=5.55, center=(0, 0, 2)))  # base 0.05 in
screw = rod + thread                                                   # valid, one solid: 1809.81
```

## Long helices
Any number of turns works. Up to 120 turns the kernel fits the helix in one go; beyond that
it is fitted in pieces of 100 whole turns, joined into one edge (tangent at the joints, within
1e-6 rad): `Helix(2, 400, 20)` (200 turns) is one `bspline` edge, 25135.87 long against 25135.92
for the exact helix, radius within 1e-4. No manual chaining.

Long sweeps work too: `sweep(Circle(1.2), Helix(3, 3 * n, 20))` is valid for 60, 150 and 300
turns (300: 11 s).

## Gotchas
- Bodies swept along a helix are within about 1e-4 of their exact size:
  `sweep(Rectangle(2, 1), Helix(4, 12, 8)).bbox()` reaches x = 9.00009 where 9 is exact. Compare
  sizes with a tolerance.
- `end_radius=0` (a cone to a point) fails; use a small positive radius.
- The helix ends at the same angle it starts only for whole turns.

## Errors
- `ValueError: pitch, height and radius must be positive`.
- `KernelError: Helix failed (SM_ERR_INVALID_INPUT)` for `end_radius <= 0`.
- `ValueError: Helix: the direction must not be zero` for `direction=(0, 0, 0)`.

## Example
```python
h = Helix(pitch=5, height=20, radius=10)               # (10, 0, 0) -> (10, 0, 20), 4 turns
lh = Helix(5, 20, 10, left_handed=True)
cone = sweep(Circle(0.8), Helix(5, 20, 10, end_radius=4))
coil = Helix(pitch=2, height=400, radius=20)          # 200 turns, one edge
print(h.start, h.end, h.point_at(1 / 16))              # quarter turn: (0, 10, 1.25)
```

## Related
`features/sweep`, `CenterArc`, `Spiral` (a flat spiral), `parts/Cylinder`, `sketches/Polygon`.
