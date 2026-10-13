# Deforming parts

`twist`, `taper`, `bend` and `Lattice` change a finished part as a whole: model it straight
and simple, with the features that should follow the deformation, then deform it. The
guides are `deform/generic`, `deform/twist`, `deform/taper`, `deform/bend`, `deform/Lattice`.

## Deform, or model the shape directly?

Deform when a simple part gets a smooth overall change and its features should go along:

| Shape | Deform | Instead of |
|---|---|---|
| twisted vase, column, baluster, flutes | extrude the section, `twist` (a range for a baluster) | a loft between turned sections (pinches between them) |
| twisted blade, propeller, mixer paddle | blade with its fillets, `twist(start=...)` so the root stays, fuse to the hub | sweeping a profile along a helix (rolls it) |
| bent handle, bracket, tube with holes or flats | model straight, drill and slot, then `bend` (the features bend along) | sweeping the profile along a path and cutting curved features afterwards |
| tapered grip, leg, post, tool shank | `taper` (exact; fillets taper along) | `extrude(taper=...)` (only a profile, only a draft angle) |
| pillow tops, ergonomic bodies, bulges | a rounded box and a `Lattice` | stitching free-form surfaces |

Model directly when:
- the result needs analytic faces downstream (a bent or twisted face is a B-spline; a tube
  with several bends along a drawn path is easier as `sweep`),
- the result will be offset outward (`offset()` usually fails on deformed parts),
- the change is local (a boss, a pocket): Booleans keep everything else exact,
- a feature must keep its exact shape: add it after the deformation.

## Order of operations

1. Build the straight part and the features that should deform with it (holes in a bent
   handle, fillets of a blade).
2. Deform. One deformation per step; chaining is fine (`part.taper(0.8).twist(45)`).
3. Add the features that must keep their shape (bores, flats, mounting holes) and their
   fillets.
4. Check: `is_valid()`, the face count (unchanged unless a range split faces), the volume
   with `mass_properties(accuracy=1e-10)` against the rule (twist: same; bend about the
   middle layer: same; taper: the scaled cross-sections), and a snapshot.

## Patterns

```python
# twisted vase: a star profile, twisted, then hollowed
star = Polygon(*[(r * math.cos(math.radians(a)), r * math.sin(math.radians(a)))
                 for i, a in enumerate(range(0, 360, 30)) for r in [30 if i % 2 == 0 else 24]])
vase = star.extrude(120).twist(90)
vase = vase.shell(2.5, vase.faces().sort_by(Z)[-1])
print(vase.is_valid(), len(vase.faces()))                        # True 27

# twisted blade with a straight root, fused to a hub
blade = Rectangle(60, 6).extrude(150)
blade = blade.fillet(blade.edges().parallel_to(Z), 2.9).twist(40, start=10)
fan = Box(70, 20, 20).translate(0, 0, -10) + blade
print(fan.is_valid(), len(fan.faces()))

# bent handle: holes first, then bend; the legs come back over each other
bar = Box(200, 20, 8) - Locations((-80, 0, 0), (80, 0, 0)) * Cylinder(3, 20)
handle = bar.bend(180, radius=30)
holes = [f for f in handle.faces() if f.geom_type == "cylinder"]
print(handle.is_valid(), sorted((round(f.center().x, 3), round(f.center().z, 3)) for f in holes))

# tapered grip, bored after the taper so the bore stays round
grip = Cylinder(12, 90)
grip = grip.fillet(grip.edges(), 4).taper(0.75) - Cylinder(4, 100)
print(grip.is_valid(), [f.geom_type for f in grip.faces()].count("cylinder"))

# pillow top with a lattice
block = Box(80, 50, 20)
block = block.fillet(block.edges().parallel_to(Z), 10)
lat = Lattice(block, 3)
lat.move((1, 1, -1), (0, 0, 6))
cushion = lat.apply(block)
print(cushion.is_valid(), round(cushion.bbox().max.z, 3))
```
prints `True 27`, `True 23`, `True [(-80.0, -0.0), (-80.0, 60.0)]` (the two holes line up
60 apart), `True 1`, `True 11.5`.

## Limits
- Twist and bend are within `tolerance` (1e-6 mm); lattices and tapers are exact up to
  degree 12.
- Meshes, STL and snapshots of twisted parts keep to the tolerance but take many more
  triangles (2076 for `Box(20, 20, 100).twist(90)`, the box 12; about 1 / tolerance more for a
  finer one). Do not ask for a finer mesh than needed. STEP is exact.
- `part.volume` can be 4e-4 off on bent parts; measure with `mass_properties(accuracy=1e-10)`.
- Bends stay under 360°; legs crossing after a large bend are not detected.
- A lattice point moved past its neighbours folds space and is refused.
- A range inside the part splits the faces it crosses (more faces).
