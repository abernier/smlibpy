# shell

Hollows a solid to walls of a given thickness, optionally leaving faces open.

## Signature
`part.shell(thickness, openings=None, *, outward=False, corners=None, walls=None)`
`shell(part, thickness, openings=None, *, outward=False, corners=None, walls=None)`

- `thickness`: wall thickness. The sign is ignored; the direction comes from `outward`.
- `openings`: faces to remove: a selection, one `Face`, or a sum of selections
  (`faces().top() + faces().bottom()`). Faces from an earlier version of the part are matched
  by position and area. `None` makes a closed hollow body.
- `outward=False`: walls grow inward, the outside keeps its size. `outward=True`: the original
  becomes the cavity and the walls grow outside; **by default the outer edges and corners come
  out rounded with radius = thickness** (a 80x50x30 box with 2.5 out: 85 x 55 x 32.5, vol
  31398.0); `corners="sharp"` keeps them sharp (31937.5).
- `corners`: how the new side of the walls turns where the part's faces grow apart (inward walls:
  the inside of each concave edge; outward walls: the outside of each convex edge and corner).
  `"round"` keeps the wall's thickness all round with a round of radius `thickness` (the kernel's
  plain offset); `"sharp"` extends the faces until they meet, so the wall is thicker there (its
  extended offset). `None` (default): round where the kernel builds it, else sharp. The result's
  `info()["corners"]` says which. Given `"round"` or `"sharp"`, a shell the kernel cannot build
  that way raises instead of switching. Anything else: `ValueError`.
- `walls`: faces with walls of their own thickness: `(faces, thickness)` pairs, or a dict of
  faces to thicknesses (`walls=[(part.faces().bottom(), 5)]`). The shell's face across such a
  wall is offset by the difference (see `offset_faces`); a closed shell's cavity is offset and cut
  out. Faces that meet smoothly (a wall and the round beside it) need one thickness. An opening
  has no wall (`ValueError`).

## Returns
A `Part`. Prismatic parts are exact: `Box(80, 50, 30).shell(2.5, top)` has volume
`80*50*30 - 75*45*27.5`. Spheres, tori, cones, revolved and lofted parts, parts with holes and
bosses work too.

## Limits
- smlibpy checks inward walls on the bounding box, along each world axis: the part must be
  thicker than two walls, or than one wall where a planar opening face lies on that side of
  the bounding box. `Box(40, 30, 10).shell(6)` raises `ModelingError: shell: two walls of 6 do
  not fit into the part, which is 10 thick along Z; use a thinner wall`;
  `Box(40, 30, 10).shell(10, top)` raises `ModelingError: shell: a wall of 10 does not fit
  into the part, which is 10 deep along Z from the opening; use a thinner wall`.
- With openings it also measures the part across each face, into it (a turned or angled part):
  `ModelingError: shell: two walls of 2.94 do not fit into the part, which is 4 thick across the
  face at (-1, -5, -7.5); use a thinner wall`. Keep the wall below half the thinnest region.
- A closed shell is checked on its result: it must be the part less the part shrunk by the wall,
  and hollow where no wall reaches. A part too thin for its walls raises `ModelingError: shell:
  the kernel could not build a valid result (it built a body with a cavity where its walls meet:
  ...)`.
- Opening every face: `ModelingError: shell: the kernel could not build a valid result (it built
  a body that is empty); try a smaller value`.
- `thickness=0`: `ValueError: shell: the thickness must not be zero`.
- An invalid input part: `ModelingError: shell: the part is not a valid solid (...)`.

## With fillets
- Fillet first, then shell, when the inside should follow the rounds. The inner rounds get
  radius `r - t`; with `t > r` the shell fails (all-edge r5 box, t6: `shell failed`).
- The kernel cannot open a face whose rim meets its neighbours tangentially: the flat top of a
  box rounded on all edges keeps its rim open (faces off their edges). smlibpy shells such a
  part closed and cuts the opening out (the cavity's face under it, extruded through the wall)
  when the opening is planar and the rest of its rim meets walls that stand at right angles to
  it: `Box(60, 40, 20).fillet(all, 5).shell(2, faces().planar().top())` gives 11134.3949, the
  closed shell 14134.3949 less the 50 x 30 x 2 lid. The inner rounds end tangentially at the rim,
  so the wall runs out to an edge there. Works for side openings and outward walls too (outward:
  only where the whole rim is tangent), and for such an opening next to an ordinary one (a box
  with rounded vertical and bottom edges, top and +x side open: the side's wall goes up to the
  open top).
- Other openings with such a rim (a curved face, a drafted wall beside it, two such openings that
  meet) raise `ModelingError: shell: the kernel could not build a valid result (...); the kernel
  cannot open a face whose rim meets its neighbours tangentially; shell the part before rounding
  the rim, or shell it closed and cut the opening out`. Shell first, then round.
- Shell first and fillet the outer edges after when the walls are thin; then fillet the inner
  edges with `r_outer - t` for an even wall.

## Corners
The kernel shells in two ways. Its plain mode rolls a ball of radius `thickness` where the faces
grow apart: the wall keeps its thickness all round, and a concave edge gets an inner round
(B-spline faces where the faces are curved). Its extended mode extends the faces until they meet:
sharp inner corners, the wall thicker there. Which one a part gets by default depends on which
one the kernel builds; the volumes differ (an L-shaped block, 2 thick: 1745.1327 round, 1752.0
sharp). Pass `corners=` when the shape of the cavity matters, and read `info()["corners"]`.

## Gotchas
- Opening a curved end face can fail where a planar one works: a rectangle-to-circle loft
  shells with the bottom open but not with the circular top open (`shell failed (SM_ERR)`).
  Subtract an inner body instead.
- smlibpy checks every result: a valid solid in the part's box, faces that meet (gaps below
  1e-3 of the volume), a volume that drops (inward), and a cavity where no wall reaches. With
  `corners=None` it tries the kernel's plain mode, then its extended mode, and that once more
  only when its result was refused; `corners="round"` tries the plain mode only,
  `corners="sharp"` the extended one only. The kernel runs in another process (a forked copy on Linux and
  macOS, a helper process on Windows; see `parts/guards`): a crash or a step longer than
  `smlibpy.defeature.GUARD_SECONDS` (20 s) raises `ModelingError` there, and this process goes on.
- Check: `volume` drops (inward) and `bbox()` stays the same; compare with outer minus inner.

## Errors
- `KernelError: shell failed (SM_ERR): ...`, with a hint from what the part shows: for walls
  that grow outward, `the hole or inside round at (x, y, z) has a radius of 1, less than the wall
  of 2, and the outer wall would close it; shell the part before cutting or rounding it there, or
  use a thinner wall`; inward, `the part is 4.2 thick across the face at (x, y, z), room for two
  walls of 1.6 and little more; use a thinner wall`; or else `the wall may be thicker than the
  part allows`. With `corners=` given, the hint ends `, or try corners="sharp"` (or `"round"`)
- `KernelError: shell failed (SM_ERR_NULL_POINTER): the kernel failed inside the shell (it met a
  null pointer of its own), a defect of the kernel rather than of the part`
- `ValueError: shell: corners must be "round" or "sharp" (or None for either), not 'soft'`
- `ValueError: shell: the plane face at (0, 0, 5) is an opening; it has no wall`
- `ModelingError: shell: the cylinder face at (16.91, 11.91, 1) meets the offset plane face at (18, 0, 1) tangentially, so it must be offset with it (the kernel keeps tangent faces together); walls that meet smoothly need one thickness: give the faces of the part that run into this wall tangentially (rounds) the same thickness, or use corners="sharp" where the shell rounds its corners`
- `ModelingError: shell: the kernel could not build a valid result (it built a body whose faces do not meet, ...); try a smaller value`
- `ModelingError: shell: two walls of 6 do not fit into the part, which is 10 thick along Z; use a thinner wall`
- `ModelingError: shell: the kernel crashed (signal 11, in a copy of this process); this process is fine`

## Example
```python
box = Box(80, 50, 30)
tray = box.shell(2.5, box.faces().top())                # open top, walls grow inward
print(round(tray.volume, 1))                            # 27187.5 = 80*50*30 - 75*45*27.5
case = box.shell(2.5)                                   # closed, hollow inside
sleeve = box.shell(2.5, box.faces().top() + box.faces().bottom())  # two openings
lining = box.shell(2.5, box.faces().top(), outward=True)  # outside grows to 85 x 55, edges rounded r2.5
print(lining.bbox().size.to_tuple(), round(lining.volume, 1))  # (85.0, 55.0, 32.5) 31398.0
sharp = box.shell(2.5, box.faces().top(), outward=True, corners="sharp")
print(round(sharp.volume, 1), sharp.info()["corners"])  # 31937.5 sharp

# the inner corner of an L-shaped block: round (constant wall) or sharp
L = Box(20, 20, 10) - Box(10, 10, 10).translate(5, 5, 0)
print(round(L.shell(2, L.faces().top()).volume, 4))                   # 1745.1327 (round)
print(round(L.shell(2, L.faces().top(), corners="sharp").volume, 4))  # 1752.0

# walls of their own thickness: a 5 mm floor, a 6 mm wall on the +X side
b = Box(40, 30, 10)
tray = b.shell(2, b.faces().top(), walls=[(b.faces().bottom(), 5), (b.faces().filter(lambda f: f.center().x > 19), 6)])
print(round(tray.volume, 4))                            # 7840.0 = 12000 - 32*26*5

cup = Cylinder(20, 30).shell(2, Cylinder(20, 30).faces().top())

# rounded box: fillet first with radius > wall, then shell; the inner corners get r - t.
body = Box(60, 40, 20)
body = body.fillet(body.edges().parallel_to(Z) + body.edges().bottom(), 5)
shelled = body.shell(2, body.faces().top())
print(shelled.is_valid(), round(shelled.volume, 1))     # True 10769.9

# rounded on all edges: the flat top's rim meets the rounds tangentially; smlibpy shells it
# closed and cuts the opening out of the lid
body = Box(60, 40, 20)
body = body.fillet(body.edges(), 5)
tray = body.shell(2, body.faces().planar().top())
print(tray.is_valid(), round(tray.volume, 4))           # True 11134.3949 = 14134.3949 - 50*30*2
```

## Related
`offset`, `offset_faces` (thicken one wall afterwards), `thicken`, `fillet`, `loft`.
