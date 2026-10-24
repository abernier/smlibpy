# project

Projects a curve onto the faces of a body along a direction. Returns 3D curves that lie on the
body, for example a path on a curved face.

## Signature

`body.project(curve, direction=(0, 0, -1), *, nearest=False) -> ShapeList[Edge]`

- `curve`: an `Edge`, a `Wire` or anything with `.edges()` (a `Sketch` works: its outline is
  projected). Each edge is projected on its own.
- `direction`: the projection direction, an Axis (`-Z`) or a vector; its length does not
  matter. `(0, 0, 0)` raises `ValueError: project: the direction must not be zero`.
- `nearest=True`: keep only what the curve sees along the direction: the parts of the pieces the
  projection reaches first, cut where another part of the body hides them. (`imprint` with a
  direction does this by default: it marks the faces an outline lands on.)

## Returns

A `ShapeList` of standalone `bspline` edges on the body's faces, in no order.

- **Without `nearest`, every face the projection lines pass through gets a piece, on both
  sides of the body.** A circle above a sphere comes back twice (z = +8.66 and -8.66); a circle
  above a box gives one piece on the top face and one on the bottom face. `nearest=True` gives
  the top one only.
- The sign of `direction` and the side the curve is on do not matter without `nearest`: a circle
  above, below, or inside a box, projected up or down, gives the same two pieces.
- Faces parallel to the direction get degenerate pieces: a line projected down onto a box
  returns 4 pieces (top, bottom, and a vertical line on each side face). `nearest=True` drops
  them (a face seen edge-on).
- A curve that misses the body gives an empty list.
- A projected closed curve stays closed (`is_closed` True). The direction of a piece may be
  reversed relative to the input.
- A piece that a closed face's seam cuts apart (around a cylinder or a sphere) comes back as one
  edge: a curve across the seam of `Cylinder(10, 40)` projected with `nearest=True` is one edge
  (two halves before the 0.5.0 close-out). `Face.project` and `Face.wrap` join them too, and
  `Face.project` of a curve across a seam gives the piece (it gave nothing).
- With `nearest=True` each piece is checked between every two places where its projection
  crosses an edge or a silhouette of the body seen along the direction, so obstacles narrower
  than the samples are found: a bridge 1 wide over a plate 100 long cuts the plate's piece (before
  the 0.5.0 close-out the piece came back whole, 17 samples missed the bridge).

## Accuracy

The pieces are fitted within 1e-7 of the size of the body and the curve: on a sphere of radius
10 a projected circle lies within 2e-6 of the surface (the kernel's call without a tolerance:
9.4e-5); a circle of radius 5 projected onto a box top keeps its radius within 4e-6. Straight
lines onto flat faces are exact (length 20.0).

## Example

```python
dome = Sphere(10)
path = CenterArc((0, 0, 30), 5, 0, 360)               # a circle above the sphere
hits = dome.project(path, (0, 0, -1))
print(len(hits), [round(e.point_at(0.5).z, 4) for e in hits])   # 2 [8.6603, -8.6603]: both sides
top = dome.project(path, (0, 0, -1), nearest=True)[0]            # what the circle sees: the top
print(top.geom_type, top.is_closed, round(top.center().z, 4))   # bspline True 8.6603

box = Box(20, 20, 20)
pieces = box.project(Line((-30, 0, 30), (30, 0, 30)), (0, 0, -1))
print(len(pieces))                                    # 4: top, bottom and the two side faces
on_top = box.project(Line((-30, 0, 30), (30, 0, 30)), (0, 0, -1), nearest=True)
print(len(on_top), on_top[0].length)                  # 1 20.0

plate = Box(40, 40, 10) - Cylinder(5, 20)             # a plate with a through hole
seen = plate.project(Line((-30, 0, 8), (30, 0, 8)), nearest=True)
print(sorted(round(e.length, 6) for e in seen))       # [15.0, 15.0]: the top, cut by the hole

print(dome.project(CenterArc((0, 0, 30), 15, 0, 360), (0, 0, -1)))   # [] (misses the sphere)
```

## Onto a single face along its normals

`face.project(curve) -> ShapeList[Edge]` drops each point of the curve to its nearest point of
the face's surface (normal projection), trimmed to the face: for curves drawn near a freeform
face. Within 1e-7 of the size of the face and the curve.

```python
side = Cylinder(10, 40).faces().cylinders()[0]
drop = side.project(Line((-30, -15, 5), (30, -15, -5)))[0]
print(drop.start, drop.point_at(0.5), drop.end)     # (-8.944, -4.472, 5) (0, -10, 0) (8.944, -4.472, -5)
```

## Onto a plane

`project` needs a body. To flatten a 3D curve onto a plane, project it onto a sketch on that
plane, larger than the curve's shadow:

```python
floor = Rectangle(100, 100)                 # a sketch larger than the curve stands in for Plane.XY
coil = Helix(5, 20, 10)                     # 4 turns, z = 0..20
flat = floor.project(coil, (0, 0, -1))
print(len(flat), round(sum(e.length for e in flat), 4))   # 1 251.3268 (4 circles: 251.3274)
print(max(abs(e.point_at(t).z) for e in flat for t in (0, 0.5, 1)) < 1e-9)   # True: in the plane
```

## Related

`outline` (all edges onto a plane), `silhouette`, `intersection_curves`, `Sketch.on` (place a
flat sketch on a planar face instead of projecting), `surfaces/wrap` (a drawing laid onto a face
keeping its lengths), `surfaces/iso`
