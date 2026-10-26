# Shell

A sheet body: one or more faces that do not enclose a volume. The type of every surface result.

## Where Shells come from
- `surface`, `nurbs_surface`, `ruled`, `blend`, `fill`, `network`, `surface_fillet`
- `extrude`, `revolve`, `loft`, `sweep` of an **open** curve (closed wires and sketches give Parts)
- `face.to_shell()` (a copy of one face of any body)
- `stitch` when the pieces do not close
- `import_step` / `load` of an open body

You cannot call `Shell(...)` (`TypeError`); use the functions above.

`Sketch` is a subclass of `Shell`: `isinstance(Rectangle(1, 1), Shell)` is True. To tell a
solid from a sheet, test `isinstance(x, Part)`.

## Members
- `faces()`, `edges(seams=False)`, `vertices()`, `wires()`, `bbox()`, `info()`: as on a Part.
- `area`: sum of the face areas (z = 0.02·x·y over 40 x 30: 1381.07527, its integral).
- `center()`: area centroid.
- `thicken(thickness, *, both=False)` → `Part` (see below). The function
  `thicken(sheet_or_face, thickness, *, both=False)` is the same and also takes a `Face`.
- `offset(distance)` → Shell: the sheet moved along its normals, its faces extended or trimmed to
  meet again (the `cup` of the example offset by 1: 22 x 22 x 21, area 2332).
- `trim(curves, keep)` → Shell: cut along curves that lie on the sheet, keep the side of a point
  or (`"split"`) both sides as faces (see `trim`).
- `flipped()` → Shell: the sheet turned over, every face's normal reversed (a Sketch stays a
  Sketch, its plane turned too).
  A sheet that encloses a volume (a whole sphere's face) raises `ValueError`: its faces point out
  whichever way.
- `extend(distance, *, sides=None, continuity="natural")` → Shell: a sheet of one face grown past
  its sides (see `extend`).
- `match_edge(edge, target, *, extent=0.25)` → Shell: an edge moved onto a curve, its face bending
  to follow near the edge only (see `match_edge`): close a gap before `stitch`.
- `merge_faces(a, b)` → Shell: two faces that share a whole side made one face on one surface
  (see `merge_faces`).
- `push(face, at, ...)`, `warp(face, region, by)`, `flatten(face, region, plane)` → Shell: a dent,
  a raised region or a flat area in a face of the sheet (see `push`, `warp`, `flatten`).
- These are functions too, the sheet first: `offset(sheet, 1)`, `trim(sheet, curves, keep)`,
  `extend(sheet, 3)`, `match_edge(sheet, edge, target)`, `merge_faces(sheet, a, b)`,
  `push(sheet, face, at, by=2)`, `warp(...)`, `flatten(...)`.
- `heal()` → Shell, or a `Part` where the healed faces close around a volume (the six faces of a
  box put together with `+`): repairs tolerances and topology. It does **not** sew separate
  faces (two faces 0.001 apart keep their 8 free edges); use `stitch` for that.
- `check()`: what the kernel's validity checks find wrong (see `analysis/check`).
- `to_nurbs()`, `translate`, `rotate`, `mirror`, `scale`, `moved`, `on`, `named`, `colored`:
  return a Shell.
- `distance_to(point_or_body)`, `closest_point(p)`, `intersection_curves(body, face or plane)`,
  `project(curve, direction)`, `silhouette`, `outline`: work on sheets (the last four also as
  functions, `intersection_curves(sheet, other)` and so on).
- `show(path=..., open_browser=False)` writes the HTML viewer; `export("x.step" / ".stl" /
  ".glb")`, `mesh()`, `save`/`load` all take Shells; `import_step` of a sheet gives a Shell.
- `a + b` (Shell + Shell): Boolean union of sheets. Overlapping coplanar sheets merge into one
  face; crossing sheets are split along the crossing.

- `sheet - part` and `sheet & part`: the sheet trimmed by parts (below).

Missing on purpose: `volume`, `is_valid`, `solids`, `mass_properties`, `fillet`, `shell`.
`shell - shell` and `shell & shell` raise `TypeError`.

## thicken
`shell.thicken(t)` offsets every face by `t` along its normal and closes the sides.

- `t > 0` adds material on the normal side, `t < 0` on the other side. Check the normal first:
  `shell.faces()[0].normal_at(point)`. The normal rule of each source is in `surface`, `ruled`;
  `stitch` makes normals outward when it closes into a Part, and makes an open result's normals
  agree with its first piece's; `flipped()` turns a sheet over.
- All faces of a multi-face Shell must agree: a floor (normal +Z) and a wall whose normal points
  away from the floor, put together with `+`, raise `ModelingError: thicken: the kernel returned
  a body that is not a closed, manifold solid; ...` (`stitch` turns the wall to agree).
- Exact on smooth sheets: a revolved half tube R 10 thickened by 1, 5, 9.9, 10, 12 outward and
  by -5, -9.9 inward matches the formula to 1e-10.
- Inward thickness must stay below the smallest radius of curvature: R 10 inward by 10 raises
  `KernelError: thicken failed (SM_ERR): the kernel cannot offset this sheet ...`.
- A stitched open shell with consistent normals (an open box made from a Box's faces) thickens
  with mitred corners: 20 mm cup, `thicken(-1)` gives 1844 = 20³ − 18²·19.
- Separate faces in one Shell give separate plates in one Part.
- `thicken(0)`: `ValueError: thicken: the thickness must not be zero`.
- `both=True`: the total thickness centered on the sheet (`t/2` to each side).

**Check the result**: `p.volume` against area · t, and `p.is_valid()`. The result is checked and
inside-out or broken bodies raise `ModelingError`. Surfaces with a pole (a dome from `surface`)
raise; so do closed grid surfaces (a tube from `surface`), also those that thicken into a body of
volume about 0 (8 or 12 points per ring, thickened outward): `ModelingError: thicken: the kernel
returned a body that is without volume; ...`. Close such shapes with caps (`stitch(tube, caps)`)
or build them with `revolve`/`loft`.

## Part and Shell Booleans
By name too: `sheet.fuse(other)` is `sheet + other`, `sheet.cut(part)` is `sheet - part`,
`sheet.intersect(part)` is `sheet & part`; as functions `fuse(sheet, other)`, `cut(sheet, part)`,
`intersect(sheet, part)`.

- `sheet - part`: the sheet less the pieces inside the part (a Shell). `sheet & part` and
  `part & sheet`: the pieces inside the part (a Shell). Several parts: `sheet - [p1, p2]`. Checked:
  every face of the result lies on the sheet and the area is no more than the sheet's; the two
  add up to the sheet (857.29 + 86.43 of a wave sheet and a cylinder). A part that misses the
  sheet gives the whole sheet (`-`) or an empty Shell (`&`).
- `part + sheet` and `part - sheet` raise `TypeError` (they returned invalid "Parts"): to split
  the part along the sheet use `part.split(sheet)`, to cut the sheet's lines into the part's
  faces `part.imprint(sheet)`.
- The tools must be parts: `sheet - Rectangle(4, 4)` raises `TypeError`. To trim with curves that
  lie on the sheet (where another sheet crosses it, a projected outline), use `trim`.

## Example
```python
box = Box(20, 20, 20)
cup = stitch([f for f in box.faces() if f.normal_at().z < 0.5])   # 5 faces: an open box
print(type(cup).__name__, len(cup.faces()), cup.area)              # Shell 5 2000.0
print(cup.faces().bottom()[0].normal_at())                        # (0, 0, -1): outward
wall = cup.thicken(-1)                                            # inward: outer size stays 20
print(wall.is_valid(), round(wall.volume, 3), wall.bbox().size)   # True 1844.0 (20, 20, 20)

f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
saddle = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
disc = saddle & Cylinder(8, 30).translate(20, 15, 0)             # trim the sheet with a solid
print(type(disc).__name__, round(disc.area, 3))                  # Shell 202.344
rest = saddle - Cylinder(8, 30).translate(20, 15, 0)             # the sheet with a hole
print(round(rest.area + disc.area - saddle.area, 6))             # 0.0
```

## Related
`surface`, `nurbs_surface`, `ruled`, `stitch`, `trim`, `blend`, `fill`, `network`, `extend`, `match_edge`, `merge_faces`, `generic`, `Face.to_shell`, `extrude`/`loft`/`sweep` of open curves
