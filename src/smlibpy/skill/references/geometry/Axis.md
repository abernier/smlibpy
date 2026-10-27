# Axis

An infinite line: an origin and a unit direction. `X`, `Y`, `Z` are the world axes.

## Signature
`Axis(origin=(0, 0, 0), direction=(0, 0, 1))`. Both take tuples (2D origins get z = 0) or
Vectors; the direction is normalized. `Axis()` is `Axis.Z`. `X`, `Y`, `Z` are the same objects
as `Axis.X`, `Axis.Y`, `Axis.Z`.

## Members
- `origin`, `direction` (Vectors).
- `-axis` or `axis.reversed()`: opposite direction, same origin.
- `axis.at(point)`: same direction through another point.
- `axis.moved(loc)`, `loc * axis`: moved and turned by a Location (`Rot(y=90) * Z == X`).
- `distance_to(p)`, `project(p)` (foot point), `position_along(p)` (signed coordinate),
  `is_parallel(other)` (ignores the sense).
- `==` is True when both lie on the same line with the same sense; the origin may be anywhere
  on the line.

## Where an Axis is accepted
| API | Axis | tuple instead |
|---|---|---|
| `shape.rotate(axis, angle)` | yes, about the line through `origin` | no: AttributeError |
| `sketch.revolve(axis)` | yes, an offset axis works | no: AttributeError |
| `Location.about(axis, angle)` | yes | no: AttributeError |
| `Vector.rotate(axis, angle)` | yes | yes (through the world origin) |
| `parallel_to`, `facing` | yes | yes, a direction tuple |
| `silhouette`, `project`, `draft_analysis`, `parting_line`, `extrude(direction=)`, `Helix(direction=)` | yes, its direction | yes, a direction tuple |
| `sort_by`, `group_by` | yes | no: `TypeError: cannot sort by (0, 0, 1)` |
| `shape.mirror(...)`, `mirror(shape, ...)` | a part: no, it needs a `Plane`; a sketch: an axis in its plane | no |

## Gotchas
- `X`, `Y`, `Z` are axes, not vectors: `Vector + X` fails; use `X.direction`.
- `part.rotate((0, 0, 1), 90)` raises `AttributeError: 'tuple' object has no attribute
  'direction'`. Wrap it: `Axis((0, 0, 0), (0, 0, 1))`.
- `part.mirror(X)` raises `TypeError: cannot use Axis as a plane`; a part mirrors in a plane
  (`Plane.YZ` mirrors x to -x). A sketch also mirrors in an axis of its plane:
  `sketch.mirror(Y)` mirrors x to -x (see `sketches/mirror`).
- The world axes pass through the origin. To rotate about a part's own axis, build an Axis
  through its center: `Axis(part.center(), (0, 0, 1))`.
- `face.axis` gives the axis of a cylinder, cone, sphere, torus or revolution face. Its origin
  lies on the axis, not always on the face: at the base of a `Cylinder` or `Cone` (also of one
  used as a tool), at the center of a `Sphere` or `Torus`.

## Errors
- `ValueError: cannot normalize a zero-length vector` for a zero direction.

## Example
```python
pin = Box(2, 2, 2).translate(10, 0, 0)
hinge = Axis((5, 0, 0), (0, 0, 1))          # vertical axis through (5, 0, 0)
print(pin.rotate(hinge, 90).center())       # Vector(5, 5, 0)
print(pin.rotate(Z, 90).center())           # about the world Z axis: Vector(0, 10, 0)

ring = Rectangle(4, 10).translate(12, 0).revolve(Y)   # revolve about the world Y axis
print(round(ring.volume, 2))                          # 3015.93 = 2*pi*12*40

shifted = Pos(0, 0, 5) * Z        # an axis moved by a location
print(shifted, -Z, Z.at((3, 4, 0)))
```

## Related
`rotate`, `Location.about`, `Vector`, `Plane`, selection `sort_by` / `parallel_to`.
