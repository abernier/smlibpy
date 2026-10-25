# outline

A 2D drawing view of a body: its visible edges and contours, projected flat onto a plane; with
`hidden=True` also the hidden ones, for dashed lines.

## Signature

`body.outline(plane=Plane.XY, *, hidden=False, tangent_edges=False)`

- Returns `ShapeList[Edge]` (the visible lines), or with `hidden=True` a tuple
  `(visible, hidden)` of two `ShapeList[Edge]`.
- `tangent_edges=True` also draws the edges between faces that meet tangentially (the tangent
  lines of fillets and rounds).

The view looks from the side the plane's normal points to: `Plane.XY` from +Z (top view),
`Plane.bottom` from -Z, `Plane.XZ` from -Y (front view, its normal is (0, -1, 0)), `Plane.YZ`
from +X. Works on `Part`, `Shell` and `Sketch`.

## Returns

Edges lying in the plane, in world coordinates (not in the plane's 2D coordinates):
`Box(20, 10, 5).translate(100, 0, 0).outline(Plane.XZ.offset(7))` lies at y = -7 and spans
x = 90..110. Straight and circular pieces are lines, arcs and circles (the arcs of one circle
joined), so `circles()`, `radius` and `arc_center` find a view's holes; other curves (a torus'
contour, a tilted circle's ellipse) are `bspline`.

What is in it:

- **Visible lines** (always): a blind hole in the bottom face does not show in the top view; a
  small box under a big box shows only from below.
- **Hidden lines** with `hidden=True`: the parts of edges and contours behind the body. Each line
  once: a hidden line under a visible one is cut away (the back edges of a box seen from the
  front lie under its front edges), edges seen end-on are dropped, seams of round faces are not
  drawn. A box with a vertical bore seen from the front: 4 visible lines (the 40 x 20 rectangle)
  and 2 hidden ones, the bore's sides at x = +-6.
- Edges and contours of curved faces: a cylinder seen from the side is a 10 x 20 rectangle
  (its side lines come from the contour, not from edges).
- Lines may come in pieces (where an edge passes behind the body, or where the kernel splits it),
  but each line once: a line that lies on a longer one of the view is left out, and so are the
  points the kernel's projection gives where an edge or seam is seen end-on (a torus from the
  side: 8 edges, 4 lines and 4 quarters of the tube's circles, 111.416 long).
- A tilted view works: a box on a plane with normal (1, 1, 1) gives the 6 hexagon edges and
  the 3 inner edges of an isometric drawing (and 3 hidden edges with `hidden=True`).

## Accuracy

Exact: lines have their true projected lengths (20.0, 16.3299 = 20·sqrt(2/3)), a projected
circle has radius error 2e-15. `export_dxf` and `export_svg` write lines, arcs and circles as
such.

## Gotchas

- Without `hidden` and `tangent_edges` the kernel's own projection is used (seams of round faces
  can show where they face the viewer); with either, smlibpy's (no seams).
- A view of a part takes 2 to 400 ms (a 64-face valve: 0.2 to 0.4 s per view).
- A flat sketch seen edge-on becomes one line (a circle on `Plane.XZ` gives a 10 mm line).
- Tilted views: the kernel's hidden curve removal can misjudge a piece (natively, the flange
  example seen along (1, 1, 1) lacks one arc of its rim, which smlibwasm draws); the views along
  the axes were right in every case tested.
- For the 3D contour curves on the body (not flattened) use `silhouette`. For a drawing with
  several views, laid out and written as DXF or SVG, use `drawing_views`.

## Example

```python
part = Box(30, 30, 10) - Cylinder(5, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, -5)
top_view = part.outline(Plane.XY)            # seen from +Z: the blind hole underneath is hidden
bottom_view = part.outline(Plane.bottom)     # seen from -Z: the hole shows
print(len(top_view), len(bottom_view))       # 4 5
seen, hidden = part.outline(Plane.XY, hidden=True)
print(len(seen), [round(e.length, 4) for e in hidden])   # 4 [31.4159]: the hole, dashed

front = Cylinder(5, 20).outline(Plane.XZ)    # Plane.XZ looks from -Y: a 10 x 20 rectangle
print(len(front), front.bbox().size)                    # 4 Vector(10, 0, 20)

rounded = Box(40, 30, 10).fillet(Box(40, 30, 10).edges().group_by(Z)[-1], 3)
print(round(sum(e.length for e in rounded.outline(Plane.XY, tangent_edges=True)), 2))  # 272.97: with the tangent lines
```

## Related

`drawing_views`, `silhouette`, `project`, `snapshot(view="sheet")` for a picture of four views
