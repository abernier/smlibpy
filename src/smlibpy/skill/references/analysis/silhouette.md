# silhouette

The contour curves of a body as seen from a direction: where its surface turns away from the
viewer. Use it for outlines of curved parts and to find where a surface is tangent to a view.

## Signature

`body.silhouette(direction=(0, 0, 1)) -> ShapeList[Edge]`

`direction` points from the model towards the viewer (like `view=` of `snapshot`): an Axis
(`Z`) or a vector. Its length does not matter; `(0, 0, 0)` raises
`ValueError: silhouette: the direction must not be zero`.
The result does not depend on where the body is: a moved sphere gives the same curve, moved.

## Returns

A `ShapeList` of standalone 3D `Edge`s on the body (not projected to a plane), in no order:

- On curved faces: contour generators, where the surface normal is perpendicular to the
  direction. They come as `bspline` edges, even for a sphere or a cylinder.
- Face boundary edges on the outline: the rim of the face that looks at the viewer when
  its neighbours are seen edge-on. A box from +Z returns the 4 top edges (z = 5), from -Z the
  4 bottom edges.
- Only the visible side. A torus from +X returns 157.08 mm of curve, half of the full set of
  contour points (314.16 mm): the front halves of its top and bottom circles and the outer
  halves of its two side circles.

## Accuracy

The contour curves are fits. Sphere: length 2.5e-7 short (seen along an axis) to 9e-7 (along
(1, 1, 1)), normal perpendicular to the direction to 1e-13. Torus from the side: the normal is
perpendicular to 3.6e-5. Planar outlines and cylinder contour lines are exact (length 20.0).

## Gotchas

- The result mixes contour curves and boundary edges. Filter by `geom_type`, position or
  length. A cylinder seen from the side returns its two contour lines plus 7 quarter arcs of
  its rims, from both the front and the back half; which rim pieces come back is not
  consistent when faces are seen exactly edge-on.
- Slivers: the torus from the side also returns 3 pieces of 1e-5 to 2.5e-4 mm. Drop edges
  shorter than about 1e-3.
- Closed contours come in one piece or several (a sphere: 1 piece; a torus from above: one
  `circle` and one `bspline`).
- For a full 2D drawing view (all edges projected onto a plane) use `outline`.

## Example

```python
ball = Sphere(10)
rim = ball.silhouette((0, 0, 1))                  # seen from above (camera at +Z)
print(len(rim), rim[0].geom_type, round(rim[0].length, 5))   # 1 bspline 62.83184 (2*pi*10)

ring = Torus(20, 5)
side = ring.silhouette((1, 0, 0))                 # camera at +X: only the visible contour
side = [e for e in side if e.length > 1e-3]       # drop slivers
print(len(side), round(sum(e.length for e in side), 3))      # 8 157.078 (half of the full set)

cyl = Cylinder(5, 20)
cs = cyl.silhouette((1, 0, 0))
lines = [e for e in cs if e.geom_type != "circle"]           # the two contour lines at y = +-5
print([(round(e.point_at(0.5).y, 6), round(e.length, 6)) for e in lines])   # [(-5.0, 20.0), (5.0, 20.0)]
```

## Related

`outline`, `project`, `intersection_curves`
