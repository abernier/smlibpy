# Location

A rigid placement: a rotation followed by a translation (a 4x4 matrix). `Pos` and `Rot` make
them; `*` composes them and applies them to shapes, points, axes and planes.

## Signature
`Location(position=None, rotation=None)`: `position` is a point (tuple or Vector); `rotation`
is `(x, y, z)` angles in degrees, applied about the world X, then Y, then Z axis. Also
`Location(plane)` (maps world XY onto the plane), `Location(location)`, `Location(4x4 array)`.
`Location()` is the identity. `Location.about(axis, angle)` is a rotation about any `Axis`
(through its origin).

## Members
- `position` (Vector), `rotation` (Vector of X, Y, Z angles; angles come back normalized,
  `Rot(z=200).rotation` is `(0, 0, -160)`), `x_dir`, `y_dir`, `z_dir`, `matrix`,
  `plane` (world XY moved by the location).
- `inverse()`: `loc * loc.inverse() == Location()`.
- `rotate_vector(v)`: rotation only, no translation.

## Multiplication
| Expression | Result |
|---|---|
| `a * b` (two Locations) | Location: `b` is applied first, then `a` |
| `loc * shape` | moved copy, same as `shape.moved(loc)` |
| `loc * [s1, s2]` | list of moved copies |
| `loc * Vector` or `loc * (x, y)` / `(x, y, z)` | moved point (translation included) |
| `loc * axis`, `loc * plane` | moved Axis / Plane |

Read a chain from right to left: `Pos(10, 0, 0) * Rot(z=90) * bar` first turns `bar` about
the world origin, then moves it 10 along X. Swap the two and the bar swings around the
origin to (0, 10, 0).

## Gotchas
- All rotations are about world axes through the world origin, not about the shape's
  center. To turn a shape in place, rotate first and move after, or use
  `Location.about(Axis(center, dir), angle)`, or `Pos(p) * Rot(...) * Pos(-p)`.
- `loc * vector` moves a point; use `rotate_vector` for directions.
- `Location` equality uses a tolerance of 1e-6 on the matrix entries.
- `Location * Locations` (a pattern) returns a plain `list`, not `Locations`; see
  `Locations` for the consequences.

## Example
```python
place = Location((10, 0, 0), (0, 0, 90))      # position, then X/Y/Z angles in degrees
same = Pos(10, 0, 0) * Rot(z=90)
print(place == same, place.position, place.rotation)

bar = Box(4, 2, 2)
print((Pos(10, 0, 0) * Rot(z=90) * bar).center())   # rotate, then move: Vector(10, 0, 0)
print((Rot(z=90) * Pos(10, 0, 0) * bar).center())   # move, then rotate: Vector(0, 10, 0)

moved = bar.moved(place)
back = moved.moved(place.inverse())
print(back.center(), place * Vector(1, 0, 0), place.rotate_vector((1, 0, 0)))

turn_in_place = Location.about(Axis((10, 0, 0), (0, 0, 1)), 45)
print((turn_in_place * Pos(10, 0, 0) * bar).center())   # stays at Vector(10, 0, 0)
```

## Related
`Pos`, `Rot`, `moved`, `Plane.location`, `Locations`.
