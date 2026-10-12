# Plane

A coordinate system: origin, x direction, normal (`z_dir`); `y_dir = z_dir × x_dir`.
Sketches are drawn on world XY and placed onto a plane with `.on(plane)` or `plane * shape`.

## Signature
`Plane(origin=(0, 0, 0), x_dir=None, z_dir=(0, 0, 1))` — positional order is origin, x_dir,
z_dir. Also `Plane(face)` (a planar face), `Plane(location)`, `Plane(plane)`.
`x_dir` is projected into the plane and normalized. Without `x_dir`:
- vertical normal (`z_dir.z == 0`): x = Z × normal, so local Y is world +Z;
- otherwise: the projection of world X (of world Y when the normal is within ~2.5° of X).

## Named planes
| Plane | x_dir | y_dir | z_dir (normal) |
|---|---|---|---|
| `XY` = `top` | +X | +Y | +Z |
| `bottom` | +X | -Y | -Z |
| `XZ` = `front` | +X | +Z | -Y |
| `back` | -X | +Z | +Y |
| `YZ` = `right` | +Y | +Z | +X |
| `left` | -Y | +Z | -X |
| `ZX` | +Z | +X | +Y |
| `YX` | +Y | +X | -Z |
| `ZY` | +Z | +Y | -X |

All pass through the origin. On `front`, `back`, `left`, `right` a sketch drawn "up" (+y)
stands up (world +Z). `ZX`, `YX`, `ZY` do not follow that rule.

## Derived planes (all return new planes)
- `offset(d)`: moved `d` along its normal (`Plane.XZ.offset(10)` has origin y = -10).
- `shifted(x, y, z)`: moved in its own coordinates.
- `flipped()`: normal reversed, x kept, y reversed.
- `rotated(x, y, z)`: turned about its own origin, in degrees. With several angles it turns
  about the plane's original X, then original Y, then original Z axis.
  `Plane.XY.rotated(x=30).z_dir` is `(0, -0.5, 0.866)`.
- `at(point)`: same orientation, new origin. `moved(loc)` or `loc * plane`.
- `location`: the Location that maps world XY onto this plane.

## Coordinates
`to_local(p)` world -> plane coordinates (z = height above the plane), `from_local(p)`
plane -> world (2D tuples allowed), `distance_to(p)` signed height, `contains(p)`,
`project(p)`, `is_coplanar(other)` (ignores the sense of the normal). `==` compares origin,
x and z exactly (within 1e-6): `Plane.XY != Plane.XY.flipped()`.

## A face's plane
`face.plane` (or `Plane(face)`): origin at the face's area centroid, z = outward normal,
x chosen by the default rule above. For the faces of a centered `Box`:
top (x +X, y +Y), bottom (x +X, y -Y), front (x +X, y +Z), back (x -X, y +Z),
left (x -Y, y +Z), right (x +Y, y +Z).

## Gotchas
- The centroid of a non-convex face can lie outside it: the top face of an L-shaped plate
  has its plane origin in the empty corner. Place features with explicit offsets, or use
  `face.interior_point()`.
- A curved face has no plane: `ValueError: a cylinder face has no plane`.
- `Plane(part.faces().top())` (a ShapeList) raises `ValueError: expected 2 or 3 coordinates,
  got 1`; take the face: `Plane(part.faces().top()[0])`. `.on(shapelist)` does accept a
  one-element list.
- `Plane.XZ` faces -Y. A part extruded from a sketch on `Plane.XZ` grows toward -Y.

## Errors
- `ValueError: x_dir is parallel to the plane normal`.
- `ValueError: cannot normalize a zero-length vector` for a zero `z_dir`.

## Example
```python
lid = Plane.XY.offset(30)                     # parallel to XY, 30 above
tilted = Plane.XY.rotated(x=30)               # normal (0, -0.5, 0.866)
side = Plane(origin=(10, 0, 5), z_dir=(1, 0, 0))   # x_dir picked: local Y is world +Z
print(lid.origin, tilted.z_dir, side.x_dir, side.y_dir)

rib = Rectangle(10, 20, align=(Align.CENTER, Align.MIN)).on(Plane.front)
print(rib.bbox())                             # x -5..5, z 0..20: stands up

block = Box(30, 20, 10)
top = block.faces().top()[0].plane            # origin (0, 0, 5), normal +Z
print(top.origin, top.x_dir, top.z_dir)
print(top.to_local((5, 3, 5)), top.from_local((5, 3, 0)))
boss = Circle(4).on(top).extrude(6)
print((block + boss).bbox().max.z)            # 11.0
```

## Related
`on`, `Location`, `Axis`, sketches `extrude`, `Locations.on`.
