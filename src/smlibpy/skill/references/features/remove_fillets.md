# remove_fillets

Takes fillets out of a part and makes their edges sharp again: the faces next to each fillet
are extended until they meet. For simplifying parts before simulation or meshing, for imported
parts, and for getting a base shape back.

## Signature
`part.remove_fillets(faces=None, *, max_radius=None, partial=False)`

- `faces`: fillet faces of this part (a selection, one face). `None`: every fillet
  (`part.faces().fillets(max_radius)`). Faces of an earlier version of the part are matched by
  position. Corner patches whose fillets all go are added.
- `max_radius`: only fillets up to this radius (see `fillets` for how the radius is measured).
- `partial`: keep the fillets the kernel cannot take out and return the rest. Default: raise.

## Returns
A new `Part`; the input is unchanged. If there is nothing to take out, the part itself
(`box.remove_fillets() is box`). Exact on parts made here and on their STEP round trips:

| Part | Faces | Volume after |
|---|---|---|
| `Box(40, 30, 20)`, 4 vertical edges r 3 | 10 → 6 | 24000.000000000 |
| all 12 edges r 3 (8 corner spheres) | 26 → 6 | 24000 − 1.1e-11 |
| 4 top edges r 3 (mitred corners), variable 2..4, G2 r 3 | 10 → 6 | 24000.000000000 |
| plate + rectangular boss, base fillet r 2 (4 corner patches) | 19 → 11 | 15200.000000000 |
| plate + cylinder boss, ring fillet r 2 | 9 → 8 | exact + 2.8e-8 |
| STEP round trips of the fully rounded box and of the boss | same | error ≤ 4e-12 |

Planes come back as planes, cylinders as cylinders (the faces are extended, not refitted).

## How
1. Fillets with sharp ends (four edges: two rails, two ends at sharp edges) go one by one with
   the kernel's fillet removal. A fillet next to another may only qualify once that one is gone;
   it is tried again.
2. What is left (fillets that end in corner patches, rings around bosses and holes) goes as
   connected sets with the kernel's feature executive, which cuts them out and closes the gap by
   extending the faces around it, smallest radius first.
3. Concave fillets first, then convex ones, then sets that mix both; repeated while fillets go.
   Taking out one kind can make room for the other (an L bracket only goes all the way that way).
4. Every step is checked: a valid solid, a volume that went up for convex fillets and down for
   concave ones, by no more than the fillets can hold. A step that fails the check is dropped.

## Imported parts
Exact on simple parts; on real parts the kernel cannot take out every fillet:
- example bracket (5 fillets): all 5 go when it is made here (volume 31287.064 → 31376.338);
  after a STEP round trip 2 go and 3 stay (`partial=True`).
- example flange (ring fillet at the neck): native and STEP.
- B-spline faces (many STEP files, `to_nurbs()`) are extended as smooth continuations: the
  boss with B-spline faces came back within 1.3e-8 (relative), the fully rounded box within
  1.1e-11, but the patches stay faces of their own (16 faces instead of 11, 12 instead of 6).
Use `partial=True` on imported parts and check `result.faces().fillets()` for what stayed.

## Crashes and hangs
SMLib's patching and Boolean code crashes or loops on some parts (both seen on the example
enclosure and bottle). On Linux and macOS each kernel step first runs in a forked copy of the
process; a crash there, or a step longer than `smlibpy.defeature.GUARD_SECONDS` (20 s), only
drops that step, and this process goes on. On Windows the kernel runs directly. A crash in the
copy costs little, a hang the 20 s: on the example enclosure (20 fillet faces) 12 go and 8 stay,
and with the stopped steps `remove_fillets(partial=True)` takes 180 s.

The copy catches what the kernel does every time. Some of its defects read memory it already
freed, and those can crash this process after the copy came through: seen once, on an imported
valve body with B-spline faces. In the MCP session such a crash ends the script, and the
session builds its state again; in a plain script, save your work first.

## Errors
- `ModelingError: remove_fillets: 1 of the faces are no fillets (plane); a fillet meets two faces tangentially along its length. Select fillets with part.faces().fillets(), or take other faces out with remove_faces`
- `ModelingError: remove_fillets: the kernel could not take out 2 of the 4 fillet faces (at (1.454, 1.454, 25), (58.55, 38.55, 4)); remove_fillets(..., partial=True) keeps them and takes out the others, or take out the fillets around them first`
- `ValueError: remove_fillets: no faces selected` (an empty selection);
  `ValueError: Face(...) is not a face of this part`; `ValueError: fillets: max_radius must be positive`.
- The part must be valid (`ModelingError: remove_fillets: the part is not a valid solid ...`).

## Cost
Box with 4 rounds 0.01 s, fully rounded box 0.27 s, example bracket 0.35 s. With the guard
every kernel step runs twice (the copy, then here).

## Example
```python
box = Box(40, 30, 20)
rounded = box.fillet(box.edges(), 3)
sharp = rounded.remove_fillets()                  # every fillet, corner patches included
print(len(sharp.faces()), round(sharp.volume, 6)) # 6 24000.0

v4 = box.fillet(box.edges().parallel_to(Z), 3)
one = v4.remove_fillets(v4.faces().fillets().sort_by("x")[0])   # just one of them
print(len(one.faces()))                           # 9

plate = Box(60, 40, 5, align=(Align.CENTER, Align.CENTER, Align.MAX))
part = plate + Cylinder(6, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
part = part.fillet(part.edges().filter(lambda e: e.geom_type == "circle" and e.center().z > 9), 2)        # round top, convex
part = part.fillet(part.edges().filter(lambda e: e.geom_type == "circle" and abs(e.center().z) < 1e-6), 1.5)  # base fillet, concave
print(round(part.remove_fillets().volume, 3), round(12000 + math.pi * 36 * 10, 3))   # 13130.973 13130.973
print(len(part.remove_fillets(max_radius=1.5).faces()))   # 9: only the base fillet went

try:
    v4.remove_fillets(v4.faces().top())
except ModelingError as e:
    print(e)   # remove_fillets: 1 of the faces are no fillets (plane); ...
```

## Related
`fillets` (the selector), `remove_faces` (holes, bosses, pockets), `fillet`, `heal`,
`recipes/simplify`.
