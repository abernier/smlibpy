# Rot

A pure rotation about the world axes through the world origin, as a `Location`. Angles in
degrees.

## Signature
`Rot(x=0, y=0, z=0)` or `Rot((x, y, z))`. The rotations are applied about the world X axis
first, then world Y, then world Z: `Rot(10, 20, 30) == Rot(z=30) * Rot(y=20) * Rot(x=10)`.

## Returns
A `Location` without translation; prints as
`Location(position=(0, 0, 0), rotation=(0, 0, 45))`.

## Direction of positive angles
Right-hand rule, counterclockwise seen from the positive end of the axis:
| Rotation | maps | to |
|---|---|---|
| `Rot(z=90)` | +X | +Y |
| `Rot(x=90)` | +Y | +Z (and +Z to -Y) |
| `Rot(y=90)` | +Z | +X |

## Gotchas
- `Rot(90)` is a rotation about **X** (the first positional argument). Write `Rot(z=90)`.
- Rot turns about the world origin. A shape away from the origin swings around it:
  `Rot(z=90) * Box(2, 2, 2).translate(10, 0, 0)` ends at (0, 10, 0). To turn in place:
  build the shape at the origin, rotate, then move (`Pos(p) * Rot(...) * shape`), or use
  `Pos(p) * Rot(...) * Pos(-p) * shape`, or `shape.rotate(Axis(p, dir), angle)`.
- Several angles in one `Rot` are not "turn about X, then about the new Y": they are fixed
  world axes. When in doubt, chain single-axis rotations: `Rot(z=30) * Rot(x=90)` applies
  x first.
- To lay a Z-axis primitive along X use `Rot(y=90)`; along Y use `Rot(x=90)` (or `Rot(x=-90)`;
  for a centered cylinder both give the same shape).
- `loc.rotation` returns normalized angles: `Rot(z=200).rotation` is `(0, 0, -160)`.

## Example
```python
bar = Box(10, 2, 2)
print((Rot(z=90) * bar).bbox().size)          # Vector(2, 10, 2)
print(Rot(10, 20, 30) == Rot(z=30) * Rot(y=20) * Rot(x=10))   # True: X, then Y, then Z
print(Rot(z=90) * Vector(1, 0, 0))            # Vector(0, 1, 0): counterclockwise seen from +Z

off = Box(2, 2, 2).translate(10, 0, 0)
print((Rot(z=90) * off).center())             # about the origin: Vector(0, 10, 0)
p = Vector(10, 0, 0)
print((Pos(p) * Rot(z=90) * Pos(-p) * off).center())   # about its own center: Vector(10, 0, 0)

lying = Rot(y=90) * Cylinder(3, 20)           # axis along X now
print(lying.bbox().size)                      # Vector(20, 6, 6)
```

## Related
`Pos`, `Location`, `rotate` (about any axis), `Plane.rotated` (about the plane's own axes).
