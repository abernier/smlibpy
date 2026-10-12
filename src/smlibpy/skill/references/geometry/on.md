# on

Places a shape that was built around the world XY plane onto a plane or a planar face. The
usual way to draw on a part.

## Signature
`shape.on(target)`; also `ShapeList.on(target)` and `Locations.on(target)`.
`target` is a `Plane`, a planar `Face`, a `ShapeList` with exactly one planar face (what
`part.faces().top()` returns), a `Location`, or a `Sketch` (its plane).

## What happens
`shape.on(target)` is `shape.moved(Plane(target).location)`: the world origin goes to the
plane origin, world X to the plane's `x_dir`, world Y to its `y_dir`, world Z to its normal.
- A sketch's plane goes along, so `extrude(+d)` grows out of the face and `extrude(-d)` goes
  into the part: `part - Rectangle(10, 6).on(face).extrude(-4)` is a pocket.
- A part's +Z goes along the face normal: a `Cylinder(..., align=(C, C, MIN))` on the right
  face sticks out along +X. Hole tools point along -Z, so `Hole(r, d).on(face)` points into
  the part.
- An offset drawn before `on` is in face coordinates: `(Pos(12, 8) * Circle(2)).on(top)`
  sits 12 along the face's x_dir and 8 along its y_dir from the face center.
- `on` is relative like `moved`: calling it twice applies both planes.

## Orientation on the faces of a box
The face plane has its origin at the face centroid, z = outward normal, and the default
x_dir (see `Plane`):
| Face | local x | local y | normal |
|---|---|---|---|
| top | +X | +Y | +Z |
| bottom | +X | -Y | -Z |
| front | +X | +Z | -Y |
| back | -X | +Z | +Y |
| left | -Y | +Z | -X |
| right | +Y | +Z | +X |

On side faces local y is up. On the bottom face local y is world -Y. A face tilted toward
+X (normal (0.707, 0, 0.707)) has x_dir (0.707, 0, -0.707): local x runs downhill.

## Gotchas
- The origin is the face **centroid**. It moves when a feature changes the face: after an
  off-center pocket the top face centroid of a 60 x 40 plate moved to x = -2.86. On an
  L-shaped face it lies outside the face, and a cut placed there removes nothing (volume
  unchanged, no error). For stable positions use a fixed plane:
  `Plane.XY.offset(part.bbox().max.z)`, or offsets from a known point.
- A selection with more or fewer than one face raises `ValueError: expected exactly one
  shape, got 4 - narrow the selection or use [0]`.
- A Python list (`on([face])`) or an `Axis` raises `TypeError: cannot use list as a plane`.
- A curved face raises `ValueError: a cylinder face has no plane`.

## Example
```python
block = Box(40, 30, 20)
top = block.faces().top()
pocket = Rectangle(10, 6).on(top).extrude(-4)              # into the part
side_hole = Hole(3, 8).on(block.faces().front())           # Hole points along -normal: inward
boss = Cylinder(4, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)).on(block.faces().right())
part = block - pocket - side_hole + boss
print(part.is_valid(), part.bbox().max.x)                  # True 26.0

off = (Pos(12, 8) * Circle(2)).on(top)                     # 12 along the face x, 8 along its y
print(off.center())                                        # about Vector(12, 8, 10)
studs = (GridLocations(20, 10, 2, 2) * Circle(1)).on(top)  # a pattern on a face
print(len(studs), studs.bbox().size)
lid = Plane.XY.offset(block.bbox().max.z)                  # a fixed plane survives later edits
print(Circle(2).on(lid).center().z)
```

## Related
`Plane`, `moved`, `Pos`, `Locations.on`, sketches `extrude`, parts `Hole`.
