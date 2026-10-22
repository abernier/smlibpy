# shell

Hollows a solid to walls of a given thickness, optionally leaving faces open.

## Signature
`part.shell(thickness, openings=None, *, outward=False)`
`shell(part, thickness, openings=None, *, outward=False)`

- `thickness`: wall thickness. The sign is ignored; the direction comes from `outward`.
- `openings`: faces to remove: a selection, one `Face`, or a sum of selections
  (`faces().top() + faces().bottom()`). Faces from an earlier version of the part are matched
  by position and area. `None` makes a closed hollow body.
- `outward=False`: walls grow inward, the outside keeps its size. `outward=True`: the original
  becomes the cavity and the walls grow outside; **the outer edges and corners come out
  rounded with radius = thickness** (a 80x50x30 box with 2.5 out: 85 x 55 x 32.5, vol 31398.0,
  not the sharp 31937.5). Use `offset` minus the part if you need sharp outer edges.

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
  box rounded on all edges leaves its rim open (faces off their edges). That raises
  `KernelError: shell failed (SM_ERR): the kernel cannot open a face whose rim meets its
  neighbours tangentially; shell the part before rounding the rim, or shell it closed and cut
  the opening out`. Round only the edges that do not meet the opening, or shell first.
- Shell first and fillet the outer edges after when the walls are thin; then fillet the inner
  edges with `r_outer - t` for an even wall.

## Gotchas
- Opening a curved end face can fail where a planar one works: a rectangle-to-circle loft
  shells with the bottom open but not with the circular top open (`shell failed (SM_ERR)`).
  Subtract an inner body instead.
- smlibpy checks every result: a valid solid in the part's box, faces that meet (gaps below
  1e-3 of the volume), a volume that drops (inward), and a cavity where no wall reaches. It
  tries the kernel's plain mode, then its extended mode, and that once more only when its
  result was refused. The kernel runs in a forked copy of the process (Linux, macOS): a crash
  or a step longer than `smlibpy.defeature.GUARD_SECONDS` (20 s) raises `ModelingError` there,
  and this process goes on.
- Check: `volume` drops (inward) and `bbox()` stays the same; compare with outer minus inner.

## Errors
- `KernelError: shell failed (SM_ERR): the wall may be thicker than the part allows`
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

cup = Cylinder(20, 30).shell(2, Cylinder(20, 30).faces().top())

# rounded box: fillet first with radius > wall, then shell; the inner corners get r - t.
# Round the edges that do not meet the opening: a rim the rounds meet tangentially cannot open.
body = Box(60, 40, 20)
body = body.fillet(body.edges().parallel_to(Z) + body.edges().bottom(), 5)
shelled = body.shell(2, body.faces().top())
print(shelled.is_valid(), round(shelled.volume, 1))     # True 10769.9
```

## Related
`offset`, `thicken`, `fillet`, `loft`.
