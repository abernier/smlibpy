# Features: what they share

Features make solids from profiles (`extrude`, `revolve`, `swing`, `loft`, `sweep`, `thicken`) and change
solids (`fillet`, `chamfer`, `shell`, `offset`, `split`, `mirror`). `merge` combines parts into
one part made of cells (`cells()`). Each returns a new shape. An operation on a part is a method
and a function of the same name and parameters, the function taking the part first:
`part.shell(2, faces)` is `shell(part, 2, faces)`; `fillet(edges, r)` and `chamfer(edges, d)`
take the edges and find their part.

## `is_valid()` is not enough
Features check their result: revolve, swing, sweep, loft, extrude with taper or a direction and thicken raise
`ModelingError` instead of returning an inside-out or volume-less body; fillet and chamfer
check the volume change; shell checks that the walls fit. A few wrong results still pass
`is_valid()`. Check the volume against a formula after every feature, and
`len(part.solids())`:

| Input | Result |
|---|---|
| `loft` of sections that start in different places | twisted, pinched |
| `sweep` with a profile larger than the bend / pitch | self-overlapping, volume too large |

Each feature doc says how to avoid its case. Fillet, chamfer, shell and offset refuse an
input part that is not valid (`ModelingError: fillet: the part is not a valid solid ...`):
check `is_valid()` after each step and fix the step that broke it.

## Directions
- Sketch normal: `sketch.plane.z_dir`. `Plane.XY` +Z, `Plane.front`/`Plane.XZ` **-Y**,
  `Plane.YZ` +X. A sketch placed with `.on(face)` takes the face's outward normal.
- Faces of a part: normals point out of the material. Positive extrusions and thickenings
  from a face grow the part; negative ones go into it.
- `split(keep="above")` keeps the side the normal points to.
- A mirrored sketch's normal is mirrored with it: across a plane parallel to the sketch it
  turns over (`Rectangle(10, 10).translate(0, 0, 5).mirror(Plane.XY)` faces -Z), across a plane
  through the normal it stays.

## Sizes and limits
- Rounds and chamfers: two treated edges `d` apart allow a setback of `d/2`, one of `d`.
- Shell and offset: wall below half the thinnest part of the solid; a round's radius limits
  offsets across it.
- Stay a few percent away from every exact limit: right at the limit the kernel fails or
  returns a wrong body, which smlibpy refuses with a `ModelingError`.

## Errors
`ModelingError` means smlibpy rejected the input or the result (it names the limit where it
can). `KernelError` (a `ModelingError`) carries the kernel status (`SM_ERR`, `SM_ERR_INVALID_INPUT`,
`SM_ERR_AXIS_INSIDE_FACE`, `SM_ERR_BAD_INTERSECTIONS`) and a hint; the hint is a guess, except
that `SM_ERR_INVALID_INPUT` from a fillet or chamfer means no size works for that selection.
Its `trace` says where the kernel gave up, for a bug report: the kernel's failures during the call,
the last ones last (`'SM_ERR_INVALID_INPUT at SmFilletExecutive.cpp:1909 (CreateFilletCorners)'`, ...,
`'... (SmApiFilletEdges)'`); do not branch on it, it changes with the kernel.
`ValueError`/`TypeError` mean a wrong argument (a radius or length that is not positive, a zero
thickness or angle, a `(start, end)` radius where it cannot hold). Shell, offset, thicken,
`cells()`, `remove_fillets` and `remove_faces` run the kernel in another process (a forked copy
on Linux and macOS, a helper process on Windows; see `parts/guards`): a crash there, or a step
longer than `smlibpy.defeature.GUARD_SECONDS`, is a `ModelingError` ("the kernel crashed ... in a
copy of this process"), and this process goes on.

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
