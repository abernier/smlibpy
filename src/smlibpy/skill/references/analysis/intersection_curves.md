# intersection_curves

The curves where the surface of one body crosses the surface of another. A query: neither
body changes.

## Signature

`body.intersection_curves(other) -> ShapeList[Edge]`

`body` and `other` are `Part`, `Shell` or `Sketch`. A `Plane` is not accepted
(`AttributeError: 'Plane' object has no attribute '_brep'`): use a sketch larger than the
body, placed on the plane, such as `Rectangle(40, 40).on(Plane.XY.offset(6))`.

## Returns

A `ShapeList` of standalone `Edge`s, each curve once, in no particular order, not joined. A
closed curve comes in pieces: split where it crosses a seam of a curved surface or an edge of a
face. A sphere cut by a plane gives 2 arcs; a tilted cylinder through a box gives 7 pieces (3 on
the bottom face, 2 on the top, 1 on each side wall).

Edge types are exact where the geometry allows: `circle` (sphere, cylinder or torus cut
square to its axis, `radius` and `arc_center` work), `ellipse` (tilted cylinder by a plane,
two crossing cylinders of the same radius), `line`; otherwise `bspline` (two cylinders of
different radii).

## Accuracy

| Case | Total length vs exact | Points off both surfaces |
|---|---|---|
| circles and ellipses | 1e-11 | below 1e-13 |
| B-spline curves (r5 and r3 cylinders crossing) | 5e-7 | 1.4e-6 |

## Gotchas

- **No crossing raises**: disjoint bodies, or one body nested inside the other, raise
  `KernelError: intersection curves failed (SM_ERR)` instead of returning an empty list. Wrap
  the call in `try` when no crossing is possible.
- Where faces of the two bodies lie in one plane, the kernel finds the curves along their
  borders twice (also reversed); the repeats (within 1e-6 of the bodies' size) are dropped.
  Two boxes sharing a 20 x 20 face give its 4 sides (total 80), a body with itself each of its
  edges once.
- `Wire(pieces)` joins pieces of one loop (`is_closed` True). Pieces of several loops give a
  wire with `is_closed == False` and no error: group the pieces per loop first, for example
  by `piece.center().z`.
- For a cross-section region (area, a sketch to extrude) use `part.section(plane)`, which
  returns a `Sketch`.

## Errors

- `KernelError: intersection curves failed (SM_ERR)` when the surfaces do not cross.

## Example

```python
ball = Sphere(10)
cut_plane = Rectangle(40, 40).on(Plane.XY.offset(6))      # a plane as a body: a large sketch
pieces = ball.intersection_curves(cut_plane)
print(len(pieces), [e.geom_type for e in pieces])          # 2 ['circle', 'circle']: split at the seam
print(round(sum(e.length for e in pieces), 6))             # 50.265482 = 2*pi*8
print(pieces[0].radius, pieces[0].arc_center)              # 8.0 Vector(0, 0, 6)

ring = Wire(pieces)                                        # join the pieces
print(ring.is_closed, round(ring.length, 6))               # True 50.265482

try:
    Box(20, 20, 20).intersection_curves(Box(5, 5, 5).translate(50, 0, 0))
except KernelError as e:
    print(e)                                               # intersection curves failed (SM_ERR)
```

## Related

`Part.section`, `silhouette`, `project`, `distance_to`, `Edge.intersections` (curve with curve)
