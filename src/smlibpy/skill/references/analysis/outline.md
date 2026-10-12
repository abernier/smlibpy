# outline

A 2D drawing view of a body: its visible edges and contours, projected flat onto a plane.

## Signature

`body.outline(plane=Plane.XY) -> ShapeList[Edge]`

The view looks from the side the plane's normal points to: `Plane.XY` from +Z (top view),
`Plane.bottom` from -Z, `Plane.XZ` from -Y (front view, its normal is (0, -1, 0)), `Plane.YZ`
from +X. Works on `Part`, `Shell` and `Sketch`.

## Returns

A `ShapeList` of `bspline` edges lying in the plane, in world coordinates (not in the plane's
2D coordinates). `Box(20, 10, 5).translate(100, 0, 0).outline(Plane.XZ.offset(7))` lies at
y = -7 and spans x = 90..110.

What is in it:

- **Only visible lines.** Hidden lines are removed: a blind hole in the bottom face does not
  show in the top view; a small box under a big box shows only from below.
- Edges and contours of curved faces: a cylinder seen from the side is a 10 x 20 rectangle
  (its side lines come from the contour, not from edges).
- Each line once: the top and bottom squares of a box coincide in the top view and come back
  as 4 edges; edges seen end-on (points) are dropped.
- Lines may be split: the cylinder's side view has 6 pieces (each horizontal line in two).
- A tilted view works: a box on a plane with normal (1, 1, 1) gives the 6 hexagon edges and
  the 3 inner edges of an isometric drawing.

## Accuracy

Exact: lines have their true projected lengths (20.0, 16.3299 = 20·sqrt(2/3)), a projected
circle has radius error 2e-15. All edges are `bspline`, so `radius` and `arc_center` do not
work; measure lengths, `point_at` and `bbox()`.

## Gotchas

- There are no dashed hidden lines. For a full drawing, call `outline` once per view
  (`Plane.XY`, `Plane.XZ`, `Plane.YZ`, `Plane.bottom`, ...).
- A flat sketch seen edge-on becomes one line (a circle on `Plane.XZ` gives a 10 mm line).
- For the 3D contour curves on the body (not flattened) use `silhouette`.

## Example

```python
part = Box(30, 30, 10) - Cylinder(5, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, -5)
top_view = part.outline(Plane.XY)            # seen from +Z: the blind hole underneath is hidden
bottom_view = part.outline(Plane.bottom)     # seen from -Z: the hole shows
print(len(top_view), len(bottom_view))       # 4 5
print(sorted(round(e.length, 4) for e in bottom_view))   # [30.0, 30.0, 30.0, 30.0, 31.4159]

front = Cylinder(5, 20).outline(Plane.XZ)    # Plane.XZ looks from -Y: a 10 x 20 rectangle
print(len(front), front.bbox().size)                    # 6 Vector(10, 0, 20)
```

## Related

`silhouette`, `project`, `snapshot(view="sheet")` for a picture of four views
