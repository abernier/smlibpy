# scale

A scaled copy of a shape: uniform or per axis, about a center point.

## Signature
`shape.scale(factor, center=(0, 0, 0))`. `factor` is a number or `(sx, sy, sz)`.
`center` is the fixed point; it defaults to the **world origin**, not the shape's center.

## Returns
A new shape of the same type. Volume changes by `sx * sy * sz` (`factor**3` for a uniform
factor); areas of sketches by `sx * sy`.

## Behavior
- Uniform scaling keeps the face types: a scaled cylinder is still a `cylinder` face with the
  new radius, and its edges are still circles.
- Per-axis scaling makes the kernel turn every face and edge into NURBS; smlibpy then has the
  kernel recognize the analytic ones again (as when it reads a file): planes and straight edges
  stay `plane` and `line` (`Box(10, 10, 10).scale((2, 1, 1))` has six planes), a cylinder or cone
  scaled along its axis stays a `cylinder` (`.cylinders()`, `face.radius` work) or `cone`, a
  sphere or torus stretched along its axis becomes a surface of revolution (`revolution`), an
  elliptic cylinder (`Cylinder(5, 10).scale((2, 1, 1))`) a surface of extrusion (`extrusion`).
  The circular rims of a cylinder, cone or sphere cut scaled along its axis are `circle` edges
  again (`.circles()`, `edge.radius` work; elliptic rims stay `bspline`), and a sphere stretched
  across its axis (an ellipsoid) stays `bspline`. Volumes are exact
  (`Cylinder(5, 10).scale((1, 1, 2)).volume` is pi * 25 * 20) and STEP files get the analytic
  surfaces. Booleans on the result work.
- A sketch scales together with its plane origin: a sketch at z = 10 scaled by 2 about the
  origin ends up at z = 20.
- Not available on `ShapeList`; scale each member.

## Gotchas
- `scale(2)` on a part away from the origin also moves it. Pass `center=part.center()` (or a
  corner) to keep it in place.
- `scale(0)`, a zero per-axis factor (`(1, 0, 1)`) and a NaN or infinite factor raise
  `ValueError`: they would flatten the shape.
- `scale(-1)` is a point reflection (valid, positive volume). Use `mirror` for a reflection
  in a plane.

## Example
```python
cube = Box(10, 10, 10, align=Align.MIN)          # 0..10
big = cube.scale(2)                              # about the origin: 0..20
mid = cube.scale(2, center=cube.center())        # about its center: -5..15
print(big.bbox(), mid.bbox(), big.volume / cube.volume)   # volume x8

oval = Cylinder(5, 10).scale((2, 1, 1))          # elliptic cylinder, 20 x 10 x 10
print(oval.bbox().size, round(oval.volume, 2), oval.is_valid())
print(sorted({f.geom_type for f in oval.faces()}))   # ['extrusion', 'plane']: no longer a cylinder
tall = Cylinder(5, 10).scale((1, 1, 2))          # scaled along its axis: still a cylinder
print(tall.faces().cylinders()[0].radius, round(tall.volume, 6))   # 5.0 1570.796327

inch = 25.4
part_in_mm = Box(2, 1, 0.5).scale(inch)          # a model drawn in inches
print(part_in_mm.bbox().size)                    # Vector(50.8, 25.4, 12.7)
```

## Related
`translate`, `mirror`, `BoundBox`, sketches `offset` (to grow a profile by a distance).
