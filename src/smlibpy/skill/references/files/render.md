# render

Draws shapes into a PNG in software: no browser, no GPU. Use it to look at what you built:
a shaded view, a technical drawing with hidden edges dashed, a section, highlighted
selections, markers at measured points, and pixel comparisons of two states of a model.

## Signature
`render(*shapes, path=None, view="iso", size=(800, 600), edges=True, background="white",
tolerance=None, zoom=1.0, look_at=None, frame=None, supersample=2, colors="native",
lines=False, drawing=False, sheet=False, section=None, cap=True, highlight=None,
highlight_at=None, markers=None, annotate=False, xray=False, xray_alpha=0.42)`

All options combine (a sectioned drawing with highlights and markers is fine). The same input
gives the same pixels.

- `shapes`: parts, shells, sketches, faces, meshes, edges, wires, or lists of them (nested lists
  are fine). Vertices are skipped. Edges, wires, and sketches shown together with solids, are
  drawn on top of everything at their real place: a sketch on a face shows where it sits.
- `path`: also write the PNG to this file (`str` or `Path`).
- `size`: (width, height) in pixels. Sheets and drawings split it into 2 x 2 panels.
- `edges`: draw the B-rep edges in the shaded view. Hidden edges and seams are not drawn.
- `background`: any color `colored()` accepts. `tolerance`: tessellation tolerance (default
  0.1 % of each body's size).

## Views
Orthographic, Z up, never mirrored.

| `view` | Looks from |
|---|---|
| `"iso"` (default) | front, right and above: a true isometric view, from (1, -1, 1) |
| `"front"`, `"back"` | -Y, +Y (XZ plane) |
| `"right"`, `"left"` | +X, -X (YZ plane) |
| `"top"`, `"bottom"` | +Z, -Z (XY plane; X points right in both) |
| `{"azimuth": a, "elevation": e}` | turntable angles in degrees: azimuth 0 = front, 90 = right (+X); elevation 90 = above |
| `{"direction": (x, y, z), "up": (x, y, z)}` | the direction the camera **looks in** (camera towards model); `up` defaults to Z |
| `(x, y, z)` | the direction from the model **towards the camera** |
| `"sheet"` | the same as `drawing="first-angle"` |

A name and a camera aimed the same way give identical pictures: `"right"` = `{"azimuth": 90}`,
`"iso"` = `{"azimuth": 45, "elevation": 35.264}` = `(1, -1, 1)`, `"front"` =
`{"direction": (0, 1, 0)}` = `(0, -1, 0)`. Up to smlibpy 0.1.2 `"iso"` looked from
(1, -1.25, 0.75); pass that tuple for the old view.

- `zoom`: factor on the fitted scale (2 shows half as much). `look_at`: a point that lands in
  the middle.
- `frame`: pin scale and middle of an earlier render of the same view and size (see below).
- `supersample`: render at 1 to 4 times the size and average down; 2 (default) gives smooth edges.

## Styles and layouts
- `lines=True`: line style. No fill; visible edges and the silhouettes of curved faces solid,
  hidden edges dashed; thin dash-dot center lines through round features (a cross where a
  hole is seen along its axis, a line along the axis from the side). Hidden lines show bores,
  pockets, hollow or solid.
- `drawing=True` or `"first-angle"`: a technical drawing (ISO 5456-2 method E, usual in Europe):
  front view top left, the view **from the left** to its right, the top view **below** it, a
  shaded iso view in the free corner, labelled `FIRST-ANGLE PROJECTION - ISO E`. The three views
  are in line style, aligned, at one scale. `"third-angle"` (method A, US): top view **above**
  the front view, the view **from the right** to its right. `{"projection": ..., "side":
  "left" | "right", "iso": False}` picks the other side view (its place follows the method) or
  leaves the corner empty. `drawing` wins over `sheet`.
- `sheet=True`: shaded views top, iso, front, right in 2 x 2 panels; a list of 4 views; or 2 views
  side by side, labelled A and B (a view and its mirror image: `[{"azimuth": 30, "elevation":
  30}, {"azimuth": -30, "elevation": 30}]`). Named ortho views share one scale; the others fit
  themselves. `lines=True` draws every panel in line style.
- `xray=True`: translucent bodies (`xray_alpha`, default 0.42), hidden faces shine through, all
  edges drawn opaque.
- `colors="distinct"`: a palette color per body, also per solid of a multi-solid part.
  `"native"` (default): each shape's own color, or a palette color by its position in the
  arguments (`#7c93b5` blue-gray, `#d9925a` orange, `#79ad73` green, ...).

## Checking tools
- `section`: cut at a plane and leave out the side the normal points to. A `Plane`, a planar
  `Face` (or a selection of one face), `(origin, normal)` or `{"origin", "normal", "cap"}`.
  `Plane.XZ` has the normal -Y, so `section=Plane.XZ` removes the front half and shows the cut
  to the front and iso views. Cut faces of closed bodies are filled and hatched at 45 degrees
  (neighbouring bodies alternate the direction) and outlined; bores and pockets stay open, so
  wall thicknesses read directly. `cap=False` leaves the cut open and shows the inside walls
  darker. The framing stays that of the whole model.
- `highlight`: shapes in signal colors: faces and bodies orange, edges and wires red, vertices
  as red dots. Takes selections directly: `highlight=part.edges().concave()`. A highlighted
  face behind the model stays hidden; turn the view or use `xray`.
- `highlight_at`: points (or one point); the face nearest to each is highlighted.
- `markers`: crosshairs drawn on top: points `(x, y, z)`, `(point, "label")`,
  `(point, "label", color)` or `{"position", "label", "color"}`. Default red; labels in capitals.
- `annotate=True`: the size of the bounding box (`60 X 40 X 50`, bottom right), the axes as the
  view shows them (an axis pointing into the screen is left out) and a scale bar of a round
  length.

## Returns
A `Picture`: the PNG file contents as `bytes` (starting `b'\x89PNG'`), also when `path` is given,
with
- `.pixels`: a `(height, width, 3)` `uint8` array,
- `.frame`: `{"scale": ..., "mid_x": ..., "mid_y": ...}` for a single view (pixels per mm and the
  projected middle), `None` for sheets and drawings,
- `.save(path)`, `.width`, `.height`.

## Before and after
A picture is fitted to the model, so a changed model moves every pixel. Pin the frame of the
first picture and compare with `diff_images`:
```python
part = Box(40, 30, 10)
before = render(part)
after = render(part - Cylinder(3, 20).translate(12, 0, 0), frame=before.frame)
d = diff_images(before, after)
print(d.changed, d.bbox)      # 3526 (477, 286, 563, 336): the new hole
d.save("diff.png")            # changed pixels red on a faded gray
```
`frame=before` (the picture itself) works too. Pick a view that shows the change: from the
front, a shaded picture of this hole is the same as before (`lines=True` would show it).

## Gotchas
- **Pictures are scaled to fit.** A 10 mm box and a 20 mm box give the same picture. Prove sizes
  with `bbox()` or `annotate=True`, not by eye. The views of a drawing share one scale.
- The `(x, y, z)` tuple and `{"direction": ...}` point opposite ways: the tuple points to the
  camera, the dict is where the camera looks.
- First and third angle place the same views differently. Read a reference drawing's method
  from its symbol or title block before comparing; a wrong method mirrors the part in your head.
- Solids are culled from behind. Open surfaces are lit on both sides and get no cap.
- Labels use a built-in 5 x 7 font in capitals; characters it lacks stay blank.
- Speed: a sphere at 800 x 600 takes 0.11 s, at 1600 x 1200 0.39 s. The flange example at
  1200 x 900: shaded 0.29 s, drawing 0.2 s, x-ray 0.56 s.

## Errors
- `ValueError: nothing to render`: no shapes, or only vertices.
- `ValueError: unknown view 'diagonal'; the names are ...`.
- `ValueError: view: the direction (0.0, 0.0, 0.0) has no length`.
- `ValueError: size must be positive, got (0, 0)`; `supersample must be 1 to 4`.
- `ValueError: a cylinder face has no plane ...`: `section` needs a planar face.
- `ValueError: frame: this picture has no frame (sheets and drawings have none)`.
- `TypeError: highlight takes shapes or lists of them, got int`.

## Example
```python
plate = (Box(40, 30, 10) - Cylinder(6, 20)).colored("steelblue")
png = render(plate, path="plate.png")                                      # iso, 800 x 600
render(plate, path="plate_drawing.png", drawing=True, size=(1000, 750))   # ISO E drawing
render(plate, path="plate_cut.png", section=Plane.XZ)                      # hatched cut
render(plate, path="plate_hl.png", highlight=plate.faces().top(), markers=[((0, 0, 5), "bore")])
render(plate, path="plate_under.png", view=(1, -1, -1), edges=False, background="#202020")
print(png[:4], png.frame)
```

## Related
`diff_images` (compare two pictures), `show` (interactive 3D in the browser), `tessellate`,
`export_glb`.
