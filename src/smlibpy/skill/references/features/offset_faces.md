# offset_faces

Offsets faces of a part along their normals and extends or trims the faces around them to meet
them again: push-pull by a distance, resize a hole or a boss, thicken one wall. Direct editing:
works on imported parts, which have no history.

## Signature
`part.offset_faces(faces, distance)`
`offset_faces(part, faces, distance)` (the same, the part first)

- `faces`: faces of this part: a selection, one `Face` or a list. Faces of an earlier version of
  the part are matched by position and area.
- `distance`: how far each face moves along its outward normal. Positive moves it out of the
  material: the part grows, a hole narrows, a boss widens. Negative moves it in. 0 returns an
  equal copy.

## Returns
A new `Part` with as many faces as before. Exact: a plane moves, a cylinder, cone, sphere or
torus changes its radius (same axis), a free-form face becomes its offset surface; the edges
where a plane meets a cylinder, cone or sphere stay circles. `(Box(40, 30, 10) -
Cylinder(3, 20)).offset_faces(cylinders, -2)`: the hole r3 -> r5, 11214.6018; the top by 2:
14060.708. A boss `Cylinder(5, 10)` on a box, its side by 1: 13130.9734 (r6).

## Tangent chains
A face that meets an offset face tangentially is offset with it, and so on along the chain: one
face of a slot offsets the whole slot wall (`Slot(16, 6)` by -1 becomes 18 x 8). A round between
two walls goes with them; where the chain reaches a face you did not mean to move (a hole whose
rim is rounded into the top face takes the top face along), cut and fill instead.

## Limits
- A radius that would reach 0 (a hole of r3 offset by 3) raises `ModelingError`.
- The faces around the offset ones must still reach them: the kernel extends and trims them but
  does not add or remove faces. A face pushed past another one, or so far that a face around it
  vanishes, raises `ModelingError` (use a Boolean).
- A part with cavities is edited as its outside and its cavities apart, and the cavities are cut
  out again (see `move_faces`): a face of a cavity's wall offset by a positive distance moves into
  the cavity (out of the material), so the cavity shrinks.
- The volume must change the way the distance says (up for positive), else `ModelingError`.
- Faces around the offset ones that the kernel extends keep their cylinder or cone (see
  `move_faces`): the vertical rounds of a box whose top is offset upwards stay cylinders.

## Errors
- `ModelingError: offset_faces: the cylinder face at (0, 0, 0) would shrink to nothing (its radius reaches 0); use a smaller distance`
- `ModelingError: offset_faces: the offset faces do not close the part again: a face around them vanishes, or offset faces run into each other; use a smaller change`
- `ModelingError: offset_faces: the offset faces reach a cavity of the part (or a cavity reaches the outside or another cavity); use a smaller change, or a Boolean`
- `TypeError: offset_faces: the distance must be a number`; `ValueError: offset_faces: no faces selected`

## Example
```python
block = Box(40, 30, 10) - Cylinder(3, 20)
wider = block.offset_faces(block.faces().cylinders(), -2)      # the hole r3 -> r5
print(round(wider.volume, 4), [round(e.radius, 6) for e in wider.edges().circles()])   # 11214.6018 [5.0, 5.0]
pushed = block.offset_faces(block.faces().top(), 2)            # 12 high
print(round(pushed.volume, 3))                                 # 14060.708

plate = Box(40, 20, 10) - Slot(16, 6).extrude(20).translate(0, 0, -10)
wider_slot = plate.offset_faces(plate.faces().cylinders()[0], -1)   # the whole slot wall: 18 x 8
print(round(wider_slot.volume, 4))                             # 6697.3452

# one wall of a tray thicker after shelling (same as shell(..., walls=...))
tray = Box(40, 30, 10).shell(2, Box(40, 30, 10).faces().top())
floor = tray.faces().filter(lambda f: f.is_planar and abs(f.center().z + 3) < 1e-6)
print(round(tray.offset_faces(floor, 3).volume, 4))            # 7320.0: the floor 5 thick
```

## Related
`move_faces` (rigid moves), `offset` (the whole part), `shell` (`walls=` for walls of their own
thickness), `remove_faces`.
