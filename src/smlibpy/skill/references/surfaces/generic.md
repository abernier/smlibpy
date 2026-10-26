# Surface modeling

Freeform parts are built as faces first, then turned into solids. A sheet is a `Shell`; a solid
is a `Part`. The path is always: **make faces → (stitch them) → thicken or close → check**.

## 1. Make faces

| Need | Use | Gives |
|---|---|---|
| A freeform patch through measured or computed points | `surface(grid)` (at least 4 x 4) | 1 bicubic face |
| A surface fitted to a cloud of points (a scan), in any order | `surface(points)` | 1 bicubic face |
| A surface from control points, knots, degrees and weights | `nurbs_surface(points, knots, degrees, weights)` | 1 face |
| A patch in a closed loop of curves (a hole, a frame), tangent to the sheets around | `fill(curves)` | Shell |
| A surface through a network of crossing curves | `network(u_curves, v_curves)` | 1 face |
| A round blend between two sheets (or a sheet and a pipe) | `surface_fillet(a, b, r)` | Shell |
| A smooth bridge between border edges of two sheets that do not meet (G1, G2, G3) | `blend(edge_a, edge_b)` | 1 face |
| A sheet cut along curves on it (a hole, an outline, where another sheet crosses) | `sheet.trim(curves, keep)` | Shell |
| Straight lines between two curves (blades, transitions, walls) | `ruled(a, b)` | 1 face |
| A skin through three or more open curves | `loft([curve, ...])` | Shell |
| A wall from an open curve | `extrude(curve, h)`, `revolve(curve, axis)`, `sweep(curve, path)` | Shell |
| A flat cap or bottom | `make_face(closed_wire_or_edge)` | Sketch (a Shell) |
| A face of an existing part | `part.faces()...` (or `face.to_shell()`) | Face / Shell |

Two rules decide whether the later steps work:

- **Neighbours share curves.** Build each face from the edges of the face next to it
  (`for e in skin.edges(): ruled(e, ...)`, `make_face(e)` for a cap). stitch does not move
  geometry; faces that only nearly meet give gaps hidden in tolerances.
- **Know the normals.** `thicken(t)` follows each face's normal. `surface`: (row-to-row) ×
  (along a row). `ruled(a, b)`: tangent of a × (a → b). Check with
  `face.normal_at(face.interior_point())` and flip by reversing the grid rows or swapping the
  curves of `ruled`.

## 2. Turn faces into a solid

**A. Thicken one sheet** (panels, fenders, blades): `sheet.thicken(t)`. Works on open sheets
with one or more faces. Inward thickness must stay below the smallest curvature radius.

**B. Close a volume**: `stitch(skin, walls, bottom)` returns a `Part` when every edge is shared.
The Part's normals are made outward whatever the input. Hollow it afterwards with
`part.shell(t, openings=...)`. This is also the way for closed surfaces (tubes, tori from
`surface`): add caps with `make_face(edge)` and stitch; do not thicken them.

**C. Stitch an open set, then thicken** (a cover with walls, open at the bottom). An open stitch
result has its normals made to agree with its first piece's (put the piece whose normal is right
first, or turn the result with `flipped()`). B + `shell` and C give the same body (volumes within
0.001).

Trim a sheet with a solid: `sheet & solid` (or `sheet.intersect(solid)`) returns the part of the
sheet inside, `sheet - solid` the rest, as Shells. Trim it with curves on it:
`sheet.trim(curves, keep=point)` (`"split"` keeps both sides as faces).

## 3. Check after every step

| After | Check |
|---|---|
| a face | `shell.area` plausible, `len(shell.faces())`, `normal_at` points where you want |
| stitch | `isinstance(r, Part)`; if a Shell: `free = [e for e in r.edges() if len(e.faces()) == 1]`, print `e.center()` of each |
| thicken | volume ≈ area · t on gently curved sheets, `bbox()` on the side you meant |
| closed solid | volume against an estimate (an integral, a bounding shape); `bbox()` against the face positions |

## Silent failures (no exception)
- `stitch` that does not close: a Shell (`stitch(..., report=True)` says how many edges stayed
  open). With a large `tolerance`: a valid Part whose faces stand off their edges by up to the
  `max_gap` it reports (`volume` warns that the faces do not meet).
- `surface` with repeated rows overshoots wildly.

`part - sheet` and `part + sheet` raise `TypeError` (to split a part along a sheet:
`part.split(sheet)`); `part & sheet` is the sheet trimmed to the part, a Shell.

## Example: closed block and open cover from one freeform skin
```python
import math

# 1. Faces. The skin: rows along y stacked in x, so its normal points up (+Z).
h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
skin = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
print(skin.faces()[0].normal_at((30, 20, 10)))                    # ~(0, 0, 1)

# Walls from the skin's own edges (so they meet exactly), turned to point outward.
mid = Vector(30, 20, 5)
walls = []
for e in skin.edges():
    floor = Line((e.start.x, e.start.y, 0), (e.end.x, e.end.y, 0))
    w = ruled(e, floor)
    p = w.faces()[0].interior_point()
    if w.faces()[0].normal_at(p).dot(p - mid) < 0:
        w = ruled(floor, e)
    walls.append(w)

# 2a. Closed solid: add a bottom and stitch.
bottom = make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True))
block = stitch(skin, walls, bottom)
assert isinstance(block, Part) and block.is_valid()
print(round(block.volume, 2))                                     # 23997.28

# 2b. Open cover: stitch without the bottom, check the free edges, thicken inward.
cover = stitch(skin, walls)
free = [e for e in cover.edges() if len(e.faces()) == 1]
print(type(cover).__name__, len(free))                            # Shell 4 (the bottom rim)
wall = cover.thicken(-1.5)
assert wall.is_valid() and wall.volume > 0
print(round(wall.volume, 1))                                      # 6134.8, same as block.shell(-1.5, ...)
```
The block's volume equals the integral of h over the rectangle (23997.27).

## Example: a fender-like panel
```python
import math

L, W = 120.0, 50.0
def z(x, y):
    return 40 + 6 * math.cos(math.pi * x / L) ** 2 - 18 * (y / W) ** 2.2
skin = surface([[(x, y, z(x, y)) for y in np.linspace(0, W, 9)] for x in np.linspace(-L / 2, L / 2, 13)])
panel = skin.thicken(-2)                                  # normal is up; -2 goes under the skin
assert panel.is_valid() and panel.volume > 0
fender = panel - Cylinder(42, 200).rotate(X, 90)          # wheel arch, axis along Y
fender = fender.fillet(fender.faces().cylinders().edges(), 0.5)
print(fender.is_valid(), round(fender.volume, 2), len(fender.solids()))   # True 9908.48 1
```
Once thickened, the panel is an ordinary Part: Booleans, fillets and STEP export work (the STEP
file reads back with the same volume). The arch edges meet the panel at a shallow angle, so
the fillet must stay well under the 2 mm wall (1 and 1.5 fail).

## Related
`surface`, `nurbs_surface`, `ruled`, `fill`, `network`, `blend`, `trim`, `stitch`, `Shell`; `loft`,
`extrude`, `sweep`, `shell`, `fillet` in features
