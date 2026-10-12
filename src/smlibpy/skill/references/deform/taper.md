# taper

Scales the cross-sections of a part toward an axis, by a factor that changes evenly along it.

## Signature
`taper(shape, scale, *, axis=Z, start=None, end=None, tolerance=None)` or
`part.taper(scale, ...)`

- `scale`: the size at `end` relative to `start` (> 0): 0.5 halves the cross-section, 2
  doubles it. The factor is 1 at `start` and changes linearly; lines along the axis stay
  straight.
- `axis`: an `Axis` (a line): cross-sections shrink toward it, so a part off the axis also
  moves toward it. `X`, `Y`, `Z` are the world axes through the origin.
- `start`, `end`: distances along `axis` from `axis.origin`; default the part's extent.
  Before `start` the part stays; beyond `end` it is scaled by `scale` across the axis.
- `tolerance`: only for a face whose exact image would exceed degree 12 (none of the
  primitives does).

## Returns
A `Part` (`Shell` for a shell or sketch), same faces, edges and vertices. **Exact**: a
taper is a polynomial map, every face is its exact image. A cylinder becomes a cone (side
degree 2 x 1, rational; top radius exactly half for 0.5), a box a frustum of a pyramid.

## Gotchas
- `taper(0.5)` scales the cross-section, not the angle: a 20 x 20 x 50 box becomes a
  frustum with a 10 x 10 top, volume 50 / 3 * (400 + 100 + 200) exactly.
- With a range the side faces are split at `start`/`end` (`Box(20, 20, 50).taper(0.5,
  start=0)` has 10 faces). `end=0` tapers the lower half and scales the upper half by 0.5.
- Holes and fillets made before the taper taper with it: a 10 mm hole across the middle of
  `Box(40, 40, 60)` tapered by 0.5 comes out 7.5 wide and 10 tall. Add features that must
  stay round after tapering. An off-axis part shrinks toward the axis:
  `Box(20, 20, 50, align=(Align.MIN,) * 3).taper(0.5)` has its top at x, y 0..10.
- `offset()` of a tapered part fails outward. Unlike `extrude(taper=...)` (a draft angle on
  a profile), `taper` works on any finished part and scales instead of drafting.

## Errors
- `ValueError: taper: scale must be a positive number (1 keeps the size)`; `scale is 1`.
- `ModelingError: taper: the range ... does not reach the part`.

## Example
```python
cone = Cylinder(10, 50).taper(0.5)                   # exact frustum of a cone
print(round(cone.mass_properties(accuracy=1e-10).volume, 3), round(math.pi * 50 / 3 * (100 + 50 + 25), 3))

grip = Cylinder(12, 90)
grip = grip.fillet(grip.edges(), 4).taper(0.75)      # the rounds taper with it
print(grip.is_valid(), len(grip.faces()))

post = Box(40, 40, 60).taper(1.4, start=10)          # flares from z = 10 up, 1.4 x at the top
print(post.bbox())

wedge = Box(100, 20, 20).taper(0.25, axis=X)         # along X: a quarter of the size at x = 50
print(round(wedge.mass_properties(accuracy=1e-10).volume, 3))
```
prints `9162.979 9162.979`, `True 5`, a box of ±28 x ±28 x ±30, `17500.0`.

## Related
`deform/generic`, `twist`, `Lattice` (scale a layer for non-linear tapers);
`extrude(taper=...)` for drafted extrusions of a profile.
