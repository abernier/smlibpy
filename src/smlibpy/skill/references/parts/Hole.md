# Hole

A drilling tool: a cylinder that hangs down from the origin. Subtract it from a part.

## Signature

`Hole(radius, depth)`

- `radius` (not diameter) and `depth` in mm; both required. No `align`.

## Returns

A `Part`: a cylinder from z = −depth to z = 0, axis on Z. `Hole(3, 10)` has bbox
(−3, −3, −10)..(3, 3, 0). It does not cut anything by itself: `part -= Hole(...).on(face)`.

## How it is placed

`.on(face)` moves the tool's origin to the face's center and its +Z to the face's outward
normal, so the tool points into the part. The hole starts flush with the face; the bottom is
flat (no drill point).

- Blind hole: `depth` < wall thickness. `Hole(3, 6)` on the top of a 10 mm box leaves a flat
  bottom 6 below the top.
- Through hole: `depth` ≥ the thickness. Exactly the thickness works (coplanar bottom is fine).
- Several holes: put a pattern in front of the tool and the whole list `.on(face)`:
  `(GridLocations(40, 20, 2, 2) * Hole(2, 10)).on(top)`, `(PolarLocations(22, 6) * Hole(3, 8)).on(top)`,
  `(Pos(20, 0) * Hole(...)).on(face)`.
- Pattern coordinates are in the face's own axes:

| Face (normal) | local x | local y |
|---|---|---|
| top (+Z) | +X | +Y |
| bottom (−Z) | +X | **−Y** |
| front (−Y) | +X | +Z |
| back (+Y) | −X | +Z |
| right (+X) | +Y | +Z |
| left (−X) | −Y | +Z |

  Side faces keep local y up. `Pos(10, 2)` on the right face of `Box(60, 40, 10)` is world
  (30, 10, 2); on the bottom face `Pos(10, 5)` is world (10, −5).

## Gotchas

- **The face center is the centroid of the face as it is now.** After one hole or pocket, the
  top face's center moves: a hole at `Pos(-20, 0)` on the new top face of a 60×40 box with a Ø10
  hole at x = 20 lands at x = −20.677. Select the target faces once, before the first cut, and
  reuse them; or place on a fixed plane (`.on(Plane.XY.offset(5))`); or put all holes into one
  pattern.
- Without `.on()` the tool sits at the origin: in a centered `Box` it drills from the middle
  (z 0 down), not from the top.
- `.on()` needs exactly one planar face. Two faces: `ValueError: expected exactly one shape, got 2 -
  narrow the selection or use [0]`. A cylinder face: `ValueError: a cylinder face has no plane;
  use normal_at() or a planar face`.
- A tilted planar face works: the hole follows the face normal.
- Overlapping holes: cut them in one call. `part - (Locations((0, 0), (5, 0)) *
  Hole(4, 12)).on(top)` on a 60×40×10 plate gives the right part (volume 23125.2). A single
  hole that overlaps an earlier parallel hole, cut on its own, makes the kernel fail; smlibpy
  then cuts a NURBS copy of it, which works (within about 1e-8; both at once, `part - [h1, h2]`,
  is exact). See `booleans`.
- Tools that miss the part cut nothing and raise nothing. Check the face count or the volume
  after the cut: each through hole adds 1 face, a blind hole 2.
- Measure hole positions with the cylinder face's `axis`: `axis.origin` is the bottom of the
  hole and `axis.direction` points to the opening.

## Errors

- `radius <= 0` or `depth <= 0`: `ValueError: radius and height must be positive`.
- `Hole(3)`: `TypeError: Hole() missing 1 required positional argument: 'depth'`.

## Example

```python
part = Box(60, 40, 10)
top = part.faces().top()                                    # select once, before cutting
part -= Hole(3, 6).on(top)                                  # blind, 6 deep, at the face center
part -= (GridLocations(40, 20, 2, 2) * Hole(2, 10)).on(top) # through (the box is 10 thick)
part -= (Pos(20, 0) * Hole(1.5, 4)).on(part.faces().front())  # into the front face
print(part.is_valid(), len(part.faces().cylinders()))       # True 6
for f in part.faces().cylinders():
    print(round(f.radius, 2), f.axis.origin, f.axis.direction)

# six bolt holes on a circle of radius 22
flange = Cylinder(30, 8)
bolts = flange - (PolarLocations(22, 6) * Hole(3, 8)).on(flange.faces().top())
print(sorted(round(math.hypot(f.axis.origin.x, f.axis.origin.y), 4) for f in bolts.faces().cylinders()))
```

## Related

`CounterBoreHole`, `CounterSinkHole`, `Cylinder`, `booleans`, `geometry/GridLocations`,
`geometry/PolarLocations`, `geometry/Plane` (face planes).
