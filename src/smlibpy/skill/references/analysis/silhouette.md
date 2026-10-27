# silhouette

The contour of a body seen from a direction: where its surface turns away from the viewer, and
the edges between faces that face the viewer and faces that face away. Use it for the outline of
a curved part, to find where a surface is tangent to a view, and for the contour of a sheet.

## Signature

`body.silhouette(direction=(0, 0, 1)) -> ShapeList[Edge]` on `Part`, `Shell` and `Sketch`.
`silhouette(body, direction=(0, 0, 1))`: the same, as a function.

`direction` points from the model towards the viewer (like `view=` of `snapshot`): an Axis
(`Z`) or a vector. Its length does not matter; `(0, 0, 0)` raises
`ValueError: silhouette: the direction must not be zero`.
The result does not depend on where the body is: a moved sphere gives the same curve, moved.

## Returns

A `ShapeList` of standalone 3D `Edge`s on the body (not projected to a plane), in no order. All
of the contour, the side the viewer sees and the side behind:

- On curved faces: the contour generators, where the surface normal is perpendicular to the
  direction. Exact for spheres, cylinders and tori around the direction (`circle`s; a cylinder's
  contour lines come as straight `bspline`s), traced as `bspline` otherwise. Arcs of one circle
  come joined: a sphere seen from above gives one `circle`.
- Edges where faces that face the viewer meet faces that face away: a box seen along (1, 1, 1)
  gives its 6 outline edges (120 mm), the same edges as `parting_line`.
- Faces seen edge-on go with the faces behind them, so their near edges are the contour: a box
  from +Z gives its 4 top edges (z = 5), from -Z its 4 bottom edges; a cylinder from the side
  its two contour lines and the near halves of its rims.
- A torus from +X: 314.16 mm (its two circles of radius 20 and the two tube circles of radius
  5), seen and hidden, traced: 13 `bspline` pieces, one of them a sliver 1.5e-4 long (count
  length, not pieces).
- A sheet (`Shell`): the curves where it turns away from the viewer, and its creases; its free
  edges are not part of the contour.

## Accuracy

Traced contours are fitted within 1e-6 of the body's size; the surface normal along them is
perpendicular to the direction to about 1e-5. Planar outlines, cylinder lines and the circles of
spheres and tori are exact.

## Errors

`ModelingError: silhouette: the kernel could not find where ... face(s) turn away from the
direction; try a direction a little off this one, or heal() an imported part first`.

## Gotchas

- Changed in 0.5.0: it returned the *visible* curves of the kernel's hidden-line pass, a mix of
  contour pieces and boundary edges (a box along (1, 1, 1): its 9 visible edges; a torus from
  the side: half its contour). For the visible lines of a view use `outline`; for visible and
  hidden lines `outline(plane, hidden=True)`.
- For a 2D drawing (all edges projected onto a plane) use `outline` or `drawing_views`.

## Example

```python
ball = Sphere(10)
rim = ball.silhouette((0, 0, 1))                  # seen from above (camera at +Z)
print(len(rim), rim[0].geom_type, round(rim[0].length, 5))   # 1 circle 62.83185 (2*pi*10)

ring = Torus(20, 5)
side = ring.silhouette((1, 0, 0))                 # camera at +X: the whole contour
print(round(sum(e.length for e in side), 3))      # 314.159

box = Box(20, 20, 20)
print(len(box.silhouette((1, 1, 1))), round(sum(e.length for e in box.silhouette((1, 1, 1))), 3))  # 6 120.0

cyl = Cylinder(5, 20)
cs = cyl.silhouette((1, 0, 0))
print(sorted((e.geom_type, round(e.length, 4)) for e in cs))
# [('bspline', 20.0), ('bspline', 20.0), ('circle', 15.708), ('circle', 15.708)]: lines and near rims
```

## Related

`outline`, `drawing_views`, `parting_line`, `project`, `intersection_curves`
