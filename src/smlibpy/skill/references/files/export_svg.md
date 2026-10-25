# export_svg

Writes 2D lines as an SVG drawing: the views of `drawing_views` (hidden lines dashed), edges,
wires, and the edges of sketches and faces. For web pages, documents and printing at true size.

## Signature
`export_svg(shapes, path, *, margin=None, stroke=None)`
`export(shapes, "x.svg")` does the same. `smlibpy.drawing.to_svg(shapes, ...)` gives the text.

- `shapes`: `DrawingView`s, `Edge`, `Wire`, `Face`, `Sketch`, or a list of them, seen from +Z
  (their x and y are used). A `Part` raises `TypeError` (draw its `drawing_views`).
- `margin`: space around the lines, in mm; default 5 % of the drawing's size.
- `stroke`: width of the visible lines in mm; default 0.35, or 1/500 of the drawing's size where
  that is smaller. Hidden lines are 0.7 of it, dashed (dashes 6 times the width).

## Returns
`None`. The SVG's width and height are in mm, its viewBox in model mm (y turned to run down), so
it prints at its true size. Lines and circular arcs (also the circular B-splines of projections)
are written exactly as `L` and `A` commands; other curves as polylines. All visible lines are one
`<path class="visible">`, all hidden lines one `<path class="hidden">`.

## Example
```python
views = drawing_views(Box(40, 30, 20) - Cylinder(6, 40))
export_svg(views, "part.svg")
export_svg(Rectangle(20, 10).edges(), "outline.svg", stroke=0.5)
```

## Related
`drawing_views`, `export_dxf`, `render` (a picture instead of lines)
