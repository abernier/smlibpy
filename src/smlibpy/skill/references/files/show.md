# show

Opens shapes in an interactive 3D viewer (three.js): orbit, pan, zoom, `F` to frame.

## Signature
`show(*shapes, title="smlibpy", path=None, open_browser=True, tolerance=None, angle=12.0, edges=True)`
`shape.show(**kwargs)` does the same for one shape.

- `shapes`: parts, shells, sketches, faces, meshes, edges, wires, vertices, or lists of them.
- `path`: where to write the HTML page. Without a path, a temp file `smlibpy-*.html` is used.
- `open_browser`: open the page in the default browser. **In scripts, agents and CI, pass
  `open_browser=False`.**
- `title`: the page title (HTML-escaped).
- `tolerance`, `angle`, `edges`: as in `export_glb`. The default `angle` is 12, not 15.

## Returns
- Outside a notebook: the path, exactly as you passed it (`str` or `Path`), or the temp file
  path.
- In Jupyter, when `path` is None: the page is shown inline in an iframe, and the IPython
  `HTML` object is returned. With a `path`, a notebook writes the file like a script (and opens
  the browser unless `open_browser=False`).

## The page
- One self-contained HTML file (22 kB for the plate below). The model is embedded as GLB.
- three.js 0.170.0 is loaded from `cdn.jsdelivr.net`, so viewing needs internet access.
- An info line at the bottom: `Part · 7 faces · volume 18 797.9 · 60 × 40 × 8` for one shape,
  `4 shapes` for several.
- The colors and default palette are the same as in `export_glb`, and dark mode is followed.

## Gotchas
- An agent cannot see the browser. To check a model, use `render(..., view="sheet")` and read
  the PNG. Use `show` to hand a model to a person.
- `show()` with no shapes writes an empty viewer page, without an error.
- A shape at the end of a notebook cell shows itself (`_repr_html_`).

## Example
```python
plate = Box(60, 40, 8) - Cylinder(4, 10)
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover")
page = show(plate, cover, title="plate", path="plate.html", open_browser=False)
print(page)   # plate.html
```

## Related
`render` (PNG, no browser), `export_glb`.
