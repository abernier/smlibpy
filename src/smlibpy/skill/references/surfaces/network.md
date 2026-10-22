# network

A surface through a network of curves: `u` curves that each cross every `v` curve (a Gordon
surface). Rhino's NetworkSrf, a curve-network surface. (`fill` closes one loop; `loft` runs
through sections in one direction; `surface` through a grid of points.)

## Signature
`network(u, v)`

- `u`: two or more curves running one way, in any order and direction: `Spline`,
  `ThreePointArc`, edges; a wire is joined into one curve.
- `v`: two or more curves running across them. Each crosses every `u` curve once (within 1e-4 of
  the network's size), all in the same order. The outer curves of each set bound the surface:
  every curve ends on them.

## Returns
A `Shell` of one B-spline face through every curve. Its normal is the first `u` curve's direction
crossed with the first `v` curve's, where they cross. With two curves in a direction the surface
is linear that way (2 x 2 curves: a Coons patch of the four).

The curves are made compatible first: each is sampled so that its crossings fall at parameters
common to its set (arc length mapped through a monotone cubic between the crossings) and
interpolated, then the surface is built at those parameters and measured against the curves as
given. The kernel's own `CreateGordonSurface` misses an uneven network by up to 4e-2 on a 10 mm
patch, and still 5.7e-4 after the curves are made compatible (it intersects them again and
reparameterizes them to what it finds). About 20 to 70 ms.

## Measured
- 3 x 3 splines over 10 x 10 mm, `u` curves of different heights: the surface runs through all
  six to 3e-8 (area 103.8296); shuffled and reversed curves give the same surface. 5 x 4: 7.5e-8.

## Errors
- `ValueError: network: at least two curves in each direction`.
- `ValueError: network: u curve 0 and v curve 2 do not cross (they come 0.942 close at (...))`.
- `ValueError: network: v curve 1 runs 3.04 past the outer u curves; each curve must end on the
  outer curves of the other set`: trim the curves to the outer ones (or extend those).
- `ValueError: network: u curve 1 crosses the v curves in another order ...`.
- `ModelingError: network: the surface misses the curves by ...`: more than 1e-4 of the size (a
  very uneven network: curves of more even spacing, or more of them, help).
- More than 640 curves in a direction: `ValueError` (the kernel's fixed arrays).

## Example
```python
import math

h = lambda x, y: math.sin(math.pi * x / 10) * (1 + 0.03 * y) + 0.5 * math.sin(math.pi * y / 10)
us = [Spline(*[(x, y, h(x, y)) for x in (0, 2, 5, 7.5, 10)]) for y in (0, 5, 10)]
vs = [Spline(*[(x, y, h(x, y)) for y in (0, 3, 5, 8, 10)]) for x in (0, 5, 10)]
skin = network(us, vs)
print(max(skin.distance_to(c.point_at(i / 32)) for c in us + vs for i in range(33)) < 1e-6)  # True
panel = skin.thicken(1)
```
The curves cross where they share points: here each spline passes through (x, y, h(x, y)) at the
crossings.

## Related
`fill`, `loft`, `surface`, `ruled`, `stitch`, `Shell.thicken`, `generic`
