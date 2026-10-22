# offset

Grows or shrinks a solid by moving every face along its normal; moves a sheet or a face along its
normals (an offset surface).

## Signature
`part.offset(distance, *, corners="sharp")`
`sheet.offset(distance)` (a `Shell`: a sheet back), `face.offset(distance)` (a sheet of the face)
`offset(shape, distance)` (a `Part`, `Shell` or `Face`, or a `Sketch` for the 2D offset of `Sketch.offset`)

- `distance`: positive grows, negative shrinks (a sheet: along its face normals, negative against
  them; a face of a part: out of the part). 0 returns an equal copy.
- `corners` (parts only): `"sharp"` (default) extends the faces until they meet; `"round"` rolls
  a ball of radius `distance` along the part: cylinders and spheres where faces grow apart (the
  convex edges and corners of a growing part, the concave ones of a shrinking part), so every
  point of the result is at `distance` from the part. Anything else raises `ValueError`.

## Returns
A `Part`. Sharp (default): faces are extended until they meet, nothing is rounded.
`Box(20, 20, 20).offset(2)` is a 24 mm cube (13824.0), `Cylinder(5, 10).offset(1)` is a
cylinder r6 h12. Holes shrink when the part grows and grow when it shrinks. Spheres stay exact.
An edge whose faces meet at an angle `a` moves out by `distance / sin(a / 2)`, more than
`distance` (a cone's base edge, a tapered extrusion): `Cone(5, 2, 10).offset(1)` is 819.1342 and
12.688 across.
Round: the constant-distance envelope (a clearance body, an overmould skin):
`Box(20, 20, 20).offset(2, corners="round")` is 13587.4926 (Steiner: 8000 + 2400*2 + 60*pi*4 +
4/3*pi*8), 26 faces; `offset(-2, corners="round")` of the box is still the 16 mm cube (its edges
are convex). An L-block shrunk by 1: 2097.1976 round, 2092.0 sharp (the inner edges rounded).

## Limits
- Shrinking: below half the smallest thickness. `Box(20, 20, 20).offset(-9.9)` works (0.2 cube);
  -10 raises `ModelingError: offset: the kernel could not build a valid result (it built a body
  that is empty); try a smaller value`.
- Sharp, growing until a hole closes, or an acute wedge (`Polygon((0, 0), (20, 0), (0, 8)).extrude(5)`):
  `KernelError: offset failed (SM_ERR): try a smaller distance, or corners="round", which rounds
  the edges whose faces grow apart instead of extending the faces (it builds acute wedges and
  holes that close)`. `corners="round"` builds them: `(Box(40, 40, 10) - Cylinder(5, 20)).offset(5,
  corners="round")` is 47520.5034 (the hole closes, a dimple stays over it), the wedge by 1 905.4184.
- Shrinking a rounded part by more than a round's radius fails: a box with r3 vertical
  fillets, `offset(-4)` → `KernelError: offset failed (SM_ERR)`. Concave rounds limit growing
  the same way: an L-block with an r2 inner round grows by 1, fails at 2.

## Gotchas
- A skin around a part: `part.offset(t) - part` (sharp edges) or `part.offset(t, corners="round")
  - part` (rounded, as `shell(t, outward=True)` builds it, but without falling back to sharp
  corners where the rounded mode fails).
- smlibpy checks the result: a valid solid in the grown box (sharp: as far as the part's edges and
  corners can move, from the angles between their faces; round: `distance`), faces that meet
  (gaps below 1e-3 of the volume), a volume that went the right way; a refused sharp result is
  tried once more, a kernel error is not. The kernel runs in another process (a forked copy on Linux and macOS, a helper
  process on Windows; see `parts/guards`): a crash or a step longer than
  `smlibpy.defeature.GUARD_SECONDS` (20 s) raises `ModelingError` there, and this process goes on.
- The input part must be valid: otherwise `ModelingError: offset: the part is not a valid
  solid (...)`.

## Example
```python
block = Box(20, 20, 20)
print(block.offset(2).bbox().size.to_tuple(), round(block.offset(2).volume, 1))   # (24.0, 24.0, 24.0) 13824.0: sharp edges
print(round(block.offset(-2).volume, 1))                # 4096.0 = 16^3
plate = Box(40, 40, 10) - Cylinder(5, 20)
thin = plate.offset(-2)                                 # 36 x 36 x 6, the hole grows to r 7
print(round(thin.volume, 1))                            # 6852.4 = (36^2 - pi*7^2) * 6
envelope = block.offset(2, corners="round")             # rounded edges and corners
print(round(envelope.volume, 4), len(envelope.faces())) # 13587.4926 26
```

## Sheets and faces
`Shell.offset` keeps a sheet a sheet: each face moves by `distance`, and where faces meet they
are extended or trimmed to meet again (sharp, as for parts). The faces must share their edges:
separate faces (copied one by one) move each on its own; `stitch` them first.
- A half-cylinder sheet r10 (`extrude(CenterArc((0, 0), 10, 0, 180), 20)`, normals away from the
  axis): `offset(2)` is the r12 sheet (area 753.9822 = π·12·20), `offset(-2)` r8.
- An open box (`stitch` of the 5 faces of `Box(20, 20, 20)` without the top): `offset(-1)` 1692.0
  (18 x 18 and four 18 x 19), `offset(1)` 2332.0.
- `Box(20, 20, 20).faces().top().one().offset(5)`: a 20 x 20 sheet at z = 15.
- Checked: every face at `|distance|` from the sheet, on its side. Beyond the radius of a concave
  curvature, or where all faces vanish: `ModelingError: offset: the kernel could not offset the
  sheet by -12 (it built no faces); the kernel cannot offset this sheet by that much (beyond the
  radius of a concave curvature, or where faces vanish); use a smaller distance`, or the kernel's
  `KernelError: offset failed (SM_ERR): ...` with the same hint. Runs in a forked copy, as for
  parts.
- A solid of a sheet is `thicken`, not `offset`.

## Related
`shell`, `thicken`, `offset_faces` (some faces only), `Sketch.offset` (2D, see sketches; its `corners` also takes `"chamfer"`), `stitch`.
