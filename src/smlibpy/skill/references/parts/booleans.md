# Booleans: fuse, cut, intersect

Combine parts: union (`+`, `fuse`), difference (`-`, `cut`), intersection (`&`, `intersect`).

## Signatures

`part.fuse(*others)`, `part.cut(*others)`, `part.intersect(*others)`;
`part + other`, `part - other`, `part & other`; `+=`, `-=`, `&=`.

- `other` is a Part or any iterable of Parts, nested as you like: `a - [t1, t2]`,
  `a.cut(t1, t2)`, `a.cut([[t1], (t2,)])`, a generator, a ShapeList, a pattern
  (`GridLocations(...) * Cylinder(...)`). All give the same result.
- `a - []` and `a.fuse()` return a copy. `[t1, t2] + a` fuses too; `[t1, t2] - a` is a TypeError.
- `sum(parts)` fuses a list of parts.

## Returns

A new `Part`; the operands are unchanged. It keeps the **left** operand's name and color.
The tools are applied **one after the other**: `a - [t1, t2]` is `(a - t1) - t2`.

## What to expect

Measured on 10 mm boxes unless noted:

| Case | Result |
|---|---|
| fuse, face to face | one solid, coplanar faces merged (6 faces), valid |
| fuse, a small box standing on a face | one solid, valid |
| fuse, touching along an edge only | one "solid", **`is_valid()` False** |
| fuse, touching in a point | one solid, valid (STEP export splits it into two) |
| fuse of disjoint parts | one Part, several `solids()` |
| cut that splits the part | one Part, several `solids()` |
| cut with a tool that misses, or only touches from outside | the part unchanged |
| cut that removes everything; `&` of disjoint parts | **empty Part**: 0 faces, volume 0, `is_valid()` False, no error |
| tool flush with a face (`Hole(...).on(face)`) | fine; coplanar faces are handled |
| tool fully inside | a closed cavity (12 faces), one solid |
| gaps or overlaps below about 1e-6 | treated as contact |
| face or cylinder **tangent** to a cylinder (line contact) in a fuse, or a cylinder tangent inside a hole in a cut | **`is_valid()` False, no error** |
| sphere or cylinder tangent to a flat face, coaxial cylinders, crossed cylinders | valid |

## Gotchas

- **Check after every Boolean**: `is_valid()`, `volume` (> 0, changed as expected) and
  `len(solids())`. Several bad results come back without an exception.
- **Never keep working on an invalid part.** A fillet on the invalid result of a tangent fuse
  crashes the Python process (segmentation fault). Go back and change the operands.
- **Overlapping parallel through cuts fail.** Cutting a cylinder that overlaps an existing
  parallel through hole (keyholes, slots made of holes, overlapping hole patterns) gives
  `KernelError: cut failed (SM_ERR): the operands may only touch in a degenerate way` when the tool
  sticks out on both sides, and **an empty Part** when it is flush on one side and sticks out on
  the other. A list is cut one tool at a time, so `part - [c1, c2]` fails the same way.
  **Fuse the tools first and cut once**: `part - (c1 + c2)`. Tools exactly as long as the plate
  is thick and blind holes work. Fusing two overlapping parallel bosses that stick out of a part
  fails the same way; fuse the bosses first.
- **Avoid line tangency.** A rib whose face only touches a cylinder, or two cylinders side by
  side, makes an invalid part. Let the bodies overlap by a little (0.5 to 1 mm).
- **`&` with a list intersects with all of them**: `a & [t1, t2]` is `a ∩ t1 ∩ t2`, empty when t1
  and t2 do not overlap. To keep the overlap with each, fuse first: `a & (t1 + t2)`.
- **A Sketch is not a tool.** `plate - Circle(3).on(top)` (no `.extrude`) is accepted and returns
  an invalid part. Extrude first: `plate - Circle(3).on(top).extrude(-4)`.
- A string operand ends in `RecursionError`; a number in `TypeError`.
- The KernelError hint ("try moving one slightly") is generic. If moving does not help: check
  each operand's `is_valid()` and `volume`, and fuse the tools before cutting.
- Speed is not an issue for ordinary parts: 225 holes as one list cut in under 1 s.

## Errors

- `KernelError` (a `ModelingError`): `cut failed (SM_ERR): the operands may only touch in a
  degenerate way; try moving one slightly`. Its `status` is `SM_ERR`.
- Wrong operand types give unhelpful `TypeError`s: `'Edge' object is not iterable` for an edge,
  `'float' object is not iterable` for a vertex, `'int' object is not iterable` for a number.
- `export_step` of an empty result: `ValueError: nothing to write`.

## Example

```python
base = Box(80, 50, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
bosses = PolarLocations(15, 3) * Cylinder(6, 15, align=(Align.CENTER, Align.CENTER, Align.MIN))
part = base + [b.translate(0, 0, 10) for b in bosses]       # standing on the top face (z = 10)
part -= GridLocations(60, 30, 2, 2) * Cylinder(3, 30)        # four through holes in one call
print(part.is_valid(), len(part.solids()), round(part.volume, 2), part.bbox())

# Overlapping parallel through cuts: fuse the tools first, then cut once
keyhole = Cylinder(6, 30) + Cylinder(3, 30).translate(8, 0, 0)
plate = Box(40, 40, 10) - keyhole
print(plate.is_valid(), len(plate.faces()))
try:
    Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)   # one after the other
except KernelError as e:
    print(e)

# & with a list intersects with ALL of them; fuse first to keep each overlap
a = Box(20, 20, 20)
t1, t2 = Cylinder(3, 30).translate(-5, 0, 0), Cylinder(3, 30).translate(5, 0, 0)
print(round((a & [t1, t2]).volume, 3), round((a & (t1 + t2)).volume, 3))   # 0.0 1130.973

# results to check: empty, several bodies
print((a - Box(30, 30, 30)).volume, len((Box(40, 10, 10) - Box(4, 20, 20)).solids()))   # 0.0 2
```

## Related

`generic` (Part, `solids()`, `is_valid()`), `Hole`, `Cylinder`, `sketches/Slot` (a slot as one
tool), `geometry/GridLocations`, `geometry/PolarLocations`, `recipes/verification`.
