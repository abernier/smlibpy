# Triangle

A triangle given by its base and height, centered on its bounding box. Right, isosceles and
oblique triangles from one signature.

## Signature
`Triangle(width, height, *, apex=None, fillet=0, chamfer=0, rotation=0, align=Align.CENTER)`
- `width`: the base, along X at the bottom. `height`: how far the top corner is above it.
- `apex`: the x position of the top corner, measured from the **left end of the base**.
  `None` (default): the middle, an isosceles triangle. `0`: a right angle at the left end.
  `width`: a right angle at the right end. Outside 0..width: an obtuse triangle.
- `fillet` / `chamfer`: round or bevel all three corners. `rotation`: degrees about the center.

## Returns
A `Sketch` with 3 line edges, area `width*height/2`, centered on its bbox.
- `Triangle(40, 20)`: bbox ±20 x ±10, area 400.
- `Triangle(30, 40, apex=0)`: corners (-15, -20), (15, -20), (-15, 20); the right angle is at
  (-15, -20). Area 600.
- `Triangle(30, 20, apex=-10)`: bbox x -20..20 (the apex overhangs the base), area 300.
- `Triangle(20, 20 * math.sqrt(3) / 2)`: equilateral, side 20, area 173.2051.
- `Triangle(30, 30, apex=0, fillet=2)`: 6 edges (3 arcs), area 439.2527.

## Gotchas
- The bbox center is on the origin, not the centroid. Use `align=(Align.MIN, Align.MIN)` to
  put the lower left of the bbox on the origin.
- A triangle from three points: `Polygon(p1, p2, p3)`.
- Acute corners need long cut-backs for a fillet: `radius / tan(angle / 2)` along each side
  (11.34 for a 2 mm fillet at a 20° corner).

## Errors
- `ValueError: Triangle: width and height must be positive (got 10, 0)`.
- `ValueError: Triangle: fillet=... at (...) does not fit: it needs ... along the line ...,
  which is ... long; use a smaller radius`.

## Example
```python
gusset = Triangle(30, 30, apex=0, fillet=2)             # area 439.2527
rib = gusset.on(Plane.XZ).extrude(3, both=True)          # a 6 thick rib in XZ
arrow = Triangle(20, 12, rotation=-90)                   # pointing along +X
```

## Related
`Polygon`, `Trapezoid`, `RegularPolygon` (equilateral by circumradius), `fillet`.
