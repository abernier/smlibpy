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
- Closed shell: thickness below half the smallest inner dimension. **Above it the result can
  be a valid-looking wrong body**: `Box(40, 30, 10).shell(6)` returns `is_valid() == True`,
  volume 10992 (the box has 12000; a 6 mm wall cannot fit in a 10 mm height). At exactly half
  it raises.
- Open shell: thickness below the depth to the opening. At exactly the depth it raises
  `ModelingError` — and **sometimes crashes the Python process** (segmentation fault, 7 of
  20 runs for `Box(40, 30, 10).shell(10, top)`). Never call shell with a wall equal to a
  part dimension.
- Opening every face: `ModelingError: shell: the kernel could not build a valid result; try a smaller value`.
- `thickness=0`: `KernelError: shell failed (SM_ERR_INVALID_INPUT): ...`.

## With fillets
- Fillet first, then shell, when the inside should follow the rounds. The inner rounds get
  radius `r - t`; with `t > r` the shell fails (all-edge r5 box, t6: `shell failed`).
- Pick the opening face of a rounded box with `faces().planar().top()`: `faces().top()` also
  returns rounds whose center is high.
- Shell first and fillet the outer edges after when the walls are thin; then fillet the inner
  edges with `r_outer - t` for an even wall.

## Gotchas
- Opening a curved end face can fail where a planar one works: a rectangle-to-circle loft
  shells with the bottom open but not with the circular top open (`shell failed (SM_ERR)`).
  Subtract an inner body instead.
- smlibpy retries the kernel up to eight times and checks validity, bbox and volume; slow parts
  take a few tenths of a second.
- Check: `volume` drops (inward) and `bbox()` stays the same; compare with outer minus inner.

## Errors
- `KernelError: shell failed (SM_ERR): the wall may be thicker than the part allows`
- `ModelingError: shell: the kernel could not build a valid result; try a smaller value`

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

# rounded box: fillet first with radius > wall, then shell; the inner corners get r - t
body = Box(60, 40, 20)
body = body.fillet(body.edges(), 5)
shelled = body.shell(2, body.faces().planar().top())   # the flat top face, inside the rounds
print(shelled.is_valid(), round(shelled.volume, 1))     # True 11134.4
```

## Related
`offset`, `thicken`, `fillet`, `loft`.
