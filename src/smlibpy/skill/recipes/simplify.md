# Simplifying a part

Taking details out of a part (fillets, holes, bosses, pockets) before a simulation or a mesh,
or to get the base shape of an imported part back. The kernel extends the faces around each
detail until the gap closes; every step is checked (valid solid, volume in the right direction).

## Steps

1. Import and look: `part = import_step(path)`, then `part.is_valid()`, `len(part.faces())`,
   `snapshot(view="sheet")`. Heal a part that is not valid first (`part.heal()`).
2. Find the details: `part.faces().fillets(max_radius=...)` for rounds and fillets (corner
   patches included); holes and bosses by type and size, for example
   `part.faces().cylinders().filter(lambda f: f.radius < 4)`, pockets with `within(BoundBox(...))`.
   Print the count and the centers before removing anything.
3. Take the fillets out: `part.remove_fillets(max_radius=..., partial=True)`. On imported parts
   use `partial=True` and check what stayed: `result.faces().fillets(max_radius=...)`.
4. Take holes, bosses and pockets out: `result.remove_faces(faces, partial=True)`. Select whole
   features (a hole's floor and a boss's top go with their walls on their own) and the fillets
   on their rims too.
5. Check: `is_valid()`, `len(solids()) == 1`, the volume went the right way (up for holes and
   rounds of outside edges, down for bosses and fillets of inside edges), the bounding box.

## Order
The kernel does not manage every order. If something stays, start again from the import with
the other order (holes first, then fillets). On the example bracket: fillets first takes out all
5 fillets and then all holes (8 faces, the plain L, volume 32640.0); holes first leaves the inner
fillet. After a STEP round trip, the holes go straight from the import, but not after the
fillets were taken out.

## What the kernel cannot do
- Some fillets on imported parts stay: after a STEP round trip of the example bracket,
  `remove_fillets(partial=True)` takes out 1 of its 5 fillets, and with `max_radius=5` 3 of
  the 4 small rounds stay.
- B-spline faces are extended as smooth continuations (within about 1e-8 here); their patches
  stay faces of their own.
- The kernel can crash or loop on some parts. That happens in another process (a forked copy
  on Linux and macOS, a helper process on Windows) and only drops the step
  (`smlibpy.defeature.GUARD_SECONDS`, 20 s per step; see `parts/guards`).

## Example
The example bracket (the repository's `examples/bracket.py`), written to STEP and read back:

```python
t = 8
bracket = Polygon((0, 0), (60, 0), (60, t), (t, t), (t, 50), (0, 50)).on(Plane.front).extrude(-40)
bracket = bracket.fillet(bracket.edges().concave(), 6)
vertical = bracket.edges().parallel_to(Z)
bracket = bracket.fillet(vertical.min_by(X) + vertical.max_by(X), 4)
base, upright = bracket.faces().facing(Z).bottom(), bracket.faces().facing(-X).one()
bracket -= (GridLocations(24, 20, 1, 2) * Pos(8) * Hole(3.2, t)).on(base)
bracket -= (GridLocations(20, 1, 2, 1) * Pos(0, 8) * CounterSinkHole(3.2, 6, t)).on(upright)
export_step(bracket, "bracket.step")

part = import_step("bracket.step")
print(len(part.faces()), round(part.volume, 3), len(part.faces().fillets()))   # 19 31287.064 5

simple = part.remove_fillets(max_radius=5, partial=True)     # small rounds; keep what cannot go
print(len(simple.faces()), len(simple.faces().fillets(max_radius=5)))           # 18 3

holes = part.faces().filter(lambda f: f.geom_type in ("cylinder", "cone") and f not in part.faces().fillets())
plain = part.remove_faces(holes, partial=True)                # holes straight from the import
print(len(plain.faces()), round(plain.volume, 3))            # 13 32550.726
print(plain.is_valid(), len(plain.solids()))                 # True 1
```

Guides: `features/fillets`, `features/remove_fillets`, `features/remove_faces`, `features/heal`.
