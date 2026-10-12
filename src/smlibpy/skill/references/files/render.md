# render

Draws shapes into a PNG in software: no browser, no GPU. Use it to look at what you built.

## Signature
`render(*shapes, path=None, view="iso", size=(800, 600), edges=True, background="white", tolerance=None)`

- `shapes`: parts, shells, sketches, faces, meshes, edges, wires, or lists of them (nested
  lists are fine). Vertices are skipped.
- `path`: also write the PNG to this file (`str` or `Path`).
- `view`: the direction from the model towards the camera, Z up:
  - `"iso"` (1, -1.25, 0.75): from front-right, above.
  - `"front"` (from -Y), `"back"` (+Y), `"left"` (-X), `"right"` (+X), `"top"` (+Z), `"bottom"`
    (-Z). In `top` and `bottom`, +X points right.
  - a tuple `(x, y, z)`, for example `(1, -1, -1)` to look from below.
  - `"sheet"`: four tiles, front | top on the first row and right | iso on the second, all at
    one scale and labelled.
- `size`: (width, height) in pixels. For `"sheet"`, each tile is half of it.
- `edges`: draw the B-rep edges in dark gray. Hidden edges and seams are never drawn.
- `background`: any color `colored()` accepts (`"white"`, `"#202020"`, `(r, g, b)`).
- `tolerance`: the tessellation tolerance. The default is 0.1 % of each body's size, and a
  coarse value such as 1.0 shows facets.

## Returns
The PNG file as `bytes` (starting `b'\x89PNG'`), also when `path` is given. Display it in a
notebook with `IPython.display.Image(render(part))`.

## Colors
A shape's own color, otherwise a palette color by its position in the argument list (`#7c93b5`
blue-gray, `#d9925a` orange, `#79ad73` green, ...). Edges and wires you pass are drawn as
lines in a darker shade of their color. Meshes have no color, so they get the palette color
of their position.

## Gotchas
- **Pictures are scaled to fit.** A 10 mm box and a 20 mm box give byte-identical PNGs. Prove
  sizes with `bbox()`, not with pictures. In a `sheet`, all four tiles share one scale.
- Use `view="sheet"` for placement questions: a feature on a hidden side shows there.
- Solids are culled from behind. Open surfaces are lit on both sides.
- Speed: a sphere at 800 x 600 takes 0.26 s, at 1600 x 1200 it takes 1.1 s.

## Errors
- `ValueError: nothing to render`: no shapes, or only vertices.
- `KeyError: 'diagonal'`: an unknown view name. The valid names are listed above.
- `ZeroDivisionError` for `size=(0, 0)`.
- `view=(0, 0, 0)` raises no error: you get NumPy warnings and an empty picture.

## Example
```python
plate = (Box(40, 30, 10) - Cylinder(6, 20)).colored("steelblue")
png = render(plate, path="plate.png")                                   # iso, 800 x 600
render(plate, path="plate_views.png", view="sheet", size=(1000, 760))  # front, top, right, iso
render(plate, path="plate_under.png", view=(1, -1, -1), edges=False, background="#202020")
print(png[:4], len(png))
```

## Related
`show` (interactive 3D in the browser), `tessellate`, `export_glb`.
