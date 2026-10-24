# drawing_views

The views of a part for a 2D drawing: front, top, side and the others, each with its visible
lines and its hidden lines, laid out next to each other in the XY plane as on a drawing sheet.
Write them with `export_dxf` (layers VISIBLE and HIDDEN, hidden lines dashed) or `export_svg`.

## Signature
`drawing_views(part, views=("front", "top", "left"), *, projection="first-angle", hidden=True,
tangent_edges=False, gap=None) -> list[DrawingView]`

- `part`: a `Part` (or a `Shell`), or a list of them (an assembly): drawn together, each body
  hiding the lines of the others behind it. Bodies that overlap are not cut where they meet (no
  line where one runs into the other).
- `views`: by where the view looks from:

| View | Looks from | Drawing x | Drawing y |
|---|---|---|---|
| `"front"` | -Y | X | Z |
| `"back"` | +Y | -X | Z |
| `"top"` | +Z | X | Y |
| `"bottom"` | -Z | X | -Y |
| `"left"` | -X | -Y | Z |
| `"right"` | +X | Y | Z |

- `projection`: `"first-angle"` (ISO, Europe: the top view below the front view, the left view
  to its right, the right view to its left, the bottom view above) or `"third-angle"` (ASME,
  America: the top view above, the left view to the left, the right view to the right, the
  bottom view below). The back view goes at the far right.
- `hidden=False` leaves the hidden lines out; `tangent_edges=True` draws the tangent lines of
  fillets (see `outline`).
- `gap`: the space between views; default a fifth of the part's largest extent.

## Returns
One `DrawingView` per view, in the order asked for. A `DrawingView` is a named tuple:

| Field | Meaning |
|---|---|
| `name` | `"front"`, `"top"`, ... |
| `direction` | where it looks from (from the part towards the viewer) |
| `visible` | `ShapeList[Edge]`: the visible lines, in the XY plane (z = 0), placed |
| `hidden` | `ShapeList[Edge]`: the hidden lines, likewise |

`view.bbox()` is the box around its lines. The front view stays at the model's X and Z (its
middle where the part's middle is); the views of its row share its height, those of its column
its x.

## Gotchas
- The lines are `bspline` edges (projections); the DXF and SVG writers find the straight and
  circular ones and write lines, arcs and circles.
- No dimensions, no title block, no section views: draw sections with `part.section(plane)`.
- Several bodies: `drawing_views([housing, cover, shaft])`; the views are laid out around the box of
  all of them.
- Each view is computed exactly (the kernel's hidden curve removal): 2 to 400 ms a view.

## Example
```python
part = Box(40, 30, 20) - Cylinder(6, 40)
views = drawing_views(part)                       # front, top (below), left (to the right)
for v in views:
    print(v.name, len(v.visible), len(v.hidden))  # front 4 2 / top 5 0 / left 4 2
export_dxf(views, "part.dxf")                     # layers VISIBLE and HIDDEN (DASHED)
export_svg(views, "part.svg")                     # prints at true size
us = drawing_views(part, ("front", "top", "right"), projection="third-angle")
```

## Related
`outline` (one view, its visible and hidden lines), `export_dxf`, `export_svg`, `section`,
`silhouette`
