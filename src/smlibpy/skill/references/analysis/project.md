# project

Projects a curve onto the faces of a body along a direction. Returns 3D curves that lie on the
body, for example a path on a curved face.

## Signature

`body.project(curve, direction=(0, 0, -1)) -> ShapeList[Edge]`

- `curve`: an `Edge`, a `Wire` or anything with `.edges()` (a `Sketch` works: its outline is
  projected). Each edge is projected on its own.
- `direction`: the projection direction, an Axis (`-Z`) or a vector; its length does not
  matter. `(0, 0, 0)` raises `ValueError: project: the direction must not be zero`.

## Returns

A `ShapeList` of standalone `bspline` edges on the body's faces, in no order.

- **Every face the projection lines pass through gets a piece, on both sides of the body.**
  A circle above a sphere comes back twice (z = +8.66 and -8.66); a circle above a box gives one
  piece on the top face and one on the bottom face.
- The sign of `direction` and the side the curve is on do not matter: a circle above, below,
  or inside a box, projected up or down, gives the same two pieces.
- Faces parallel to the direction get degenerate pieces: a line projected down onto a box
  returns 4 pieces (top, bottom, and a vertical line on each side face).
- A curve that misses the body raises `KernelError: project failed (SM_ERR)`; so does an
  oblique direction whose lines miss the body.
- A projected closed curve stays closed (`is_closed` True). The direction of a piece may be
  reversed relative to the input.

Keep the piece you want by position, for example `max(hits, key=lambda e: e.center().z)`.

## Accuracy

The results are B-spline fits with a tolerance of about 1e-4 mm, also on flat faces: a circle
of radius 5 projected onto a box top has radius errors up to 1.7e-4 and is 1.7e-5 too short; on
a sphere the points lie up to 9.4e-5 off the surface. Straight lines onto flat faces are exact
(length 20.0). Do not take `radius` or exact lengths from projected curves; measure the
original curve.

## Example

```python
dome = Sphere(10)
path = CenterArc((0, 0, 30), 5, 0, 360)               # a circle above the sphere
hits = dome.project(path, (0, 0, -1))
print(len(hits), [round(e.point_at(0.5).z, 4) for e in hits])   # 2 [8.6603, -8.6603]: both sides
top = max(hits, key=lambda e: e.center().z)           # keep the upper one
print(top.geom_type, top.is_closed, round(dome.distance_to(top.point_at(0.3)), 4))   # bspline True 0.0001: a fit, ~1e-4 off

box = Box(20, 20, 20)
pieces = box.project(Line((-30, 0, 30), (30, 0, 30)), (0, 0, -1))
print(len(pieces))                                    # 4: top, bottom and the two side faces
on_top = [e for e in pieces if abs(e.start.z - 10) < 1e-9 and abs(e.end.z - 10) < 1e-9]
print(len(on_top), on_top[0].length)                  # 1 20.0

try:
    dome.project(CenterArc((0, 0, 30), 15, 0, 360), (0, 0, -1))   # misses the sphere
except KernelError as e:
    print(e)                                          # project failed (SM_ERR)
```

## Onto a plane

`project` needs a body. To flatten a 3D curve onto a plane, project it onto a sketch on that
plane, larger than the curve's shadow:

```python
floor = Rectangle(100, 100)                 # a sketch larger than the curve stands in for Plane.XY
coil = Helix(5, 20, 10)                     # 4 turns, z = 0..20
flat = floor.project(coil, (0, 0, -1))
print(len(flat), round(sum(e.length for e in flat), 4))   # 1 251.3194 (4 circles: 251.3274)
print(max(abs(e.point_at(t).z) for e in flat for t in (0, 0.5, 1)) < 1e-9)   # True: in the plane
```

## Related

`outline` (all edges onto a plane), `silhouette`, `intersection_curves`, `Sketch.on` (place a
flat sketch on a planar face instead of projecting)
