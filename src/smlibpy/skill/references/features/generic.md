# Features: what they share

Features make solids from profiles (`extrude`, `revolve`, `loft`, `sweep`, `thicken`) and change
solids (`fillet`, `chamfer`, `shell`, `offset`, `split`, `mirror`). Each returns a new shape.

## `is_valid()` is not enough
Several features return a body that reports `is_valid() == True` but is wrong. Check the
volume against a formula after every feature, and `len(part.solids())`:

| Input | Result |
|---|---|
| `revolve` of a region crossing the axis (angle 360) | zero or negative volume |
| `revolve` with the default axis on a moved sketch | revolves about the sketch's own origin |
| `revolve(axis, -90)` | 270° the positive way |
| `extrude(taper=...)` of a profile with holes | the holes are gone |
| `extrude(taper=...)` that closes the profile | shorter than `amount` |
| `loft` of a section with holes | the holes are gone |
| `loft` of sections that start in different places | twisted, pinched |
| `sweep` of a non-round profile along a helix | the profile rolls ~30° per turn |
| `sweep` along a single 360° arc | 2 solids, negative volume |
| `sweep` with a profile larger than the bend / pitch | self-overlapping, volume too large |
| `fillet` right at the size limit (cube 10, r 4.99) | volume 11 instead of 525 |
| closed `shell` thicker than half the part | wrong volume |
| `split` with nothing on the kept side | empty Part (0 faces) |

Each feature doc says how to avoid its case.

## Directions
- Sketch normal: `sketch.plane.z_dir`. `Plane.XY` +Z, `Plane.front`/`Plane.XZ` **-Y**,
  `Plane.YZ` +X. A sketch placed with `.on(face)` takes the face's outward normal.
- Faces of a part: normals point out of the material. Positive extrusions and thickenings
  from a face grow the part; negative ones go into it.
- `split(keep="above")` keeps the side the normal points to.
- Mirrored sketches have their normal flipped.

## Sizes and limits
- Rounds and chamfers: two treated edges `d` apart allow a setback of `d/2`, one of `d`.
- Shell and offset: wall below half the thinnest part of the solid; a round's radius limits
  offsets across it.
- Stay a few percent away from every exact limit: right at the limit the kernel fails, crashes
  (shell with a wall equal to the depth) or returns garbage.

## Errors
`ModelingError` means smlibpy rejected the input or the result (it names the limit where it
can). `KernelError` (a `ModelingError`) carries the kernel status (`SM_ERR`, `SM_ERR_INVALID_INPUT`,
`SM_ERR_AXIS_INSIDE_FACE`) and a hint; the hint is a guess (zero radius reports "the radius may be
too large"). `ValueError`/`TypeError` mean a wrong argument.

## Order
Main body → additions → subtractions → fillets and chamfers → shell (or shell earlier when
walls must stay thin) → final holes. Fillet different radii meeting at a corner in one call,
or larger first. Select edges and faces by geometry after each step; selections from an
earlier version still work for `fillet`, `chamfer` and `shell` when the geometry did not change.

## Example
```python
def check(tag, part, expected=None):
    ok = part.is_valid() and part.volume > 0 and len(part.solids()) == 1
    if expected is not None:
        ok = ok and abs(part.volume - expected) <= 1e-6 * expected
    print(tag, ok, round(part.volume, 3), part.bbox().size.to_tuple())
    return ok

body = Box(60, 40, 20)
check("box", body, 60 * 40 * 20)
body = body.fillet(body.edges().parallel_to(Z), 6)
check("corners", body, 48000 - 4 * (36 - 9 * math.pi) * 20)
body = body.shell(2, body.faces().planar().top())
check("shell", body)
body -= Cylinder(4, 10).translate(0, 0, -10)
check("hole", body)
```

## Related
Every doc in `features/`; `recipes/verification`, `recipes/modeling`.
