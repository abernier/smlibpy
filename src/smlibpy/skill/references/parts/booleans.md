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
The tools are applied **one after the other**: `a - [t1, t2]` is `(a - t1) - t2`. If that fails
or gives a broken or empty result, the tools are combined first and applied in one Boolean.

The result between parts is checked: a result that is not a closed, manifold solid, or is
inside out, raises `ModelingError`; a kernel failure raises `KernelError`. Both carry the same
hint (see Errors). A broken operand raises `ModelingError: cut: a tool is not a valid solid
(...)` (or `the part is not a valid solid`).

## What to expect

Measured on 10 mm boxes unless noted:

| Case | Result |
|---|---|
| fuse, face to face | one solid, coplanar faces merged (6 faces), valid |
| fuse, a small box standing on a face | one solid, valid |
| fuse, touching along an edge only | **raises `ModelingError`** |
| fuse, touching in a point | one solid, valid (STEP export splits it into two) |
| fuse of disjoint parts | one Part, several `solids()` |
| cut that splits the part | one Part, several `solids()` |
| cut with a tool that misses, or only touches from outside | the part unchanged |
| cut by a tool that encloses the part or by an identical body; `&` of disjoint parts | **empty Part**: 0 faces, volume 0, `is_valid()` False, no error |
| fuse | never an empty Part |
| tool flush with a face (`Hole(...).on(face)`) | fine; coplanar faces are handled |
| tool fully inside | a closed cavity (12 faces), one solid |
| gaps or overlaps below about 1e-6 | treated as contact |
| face or cylinder **tangent** to a cylinder (line contact) in a fuse | **raises `ModelingError`** |
| sphere or cylinder tangent to a flat face, coaxial cylinders, crossed cylinders | valid |

## Gotchas

- **Check after every Boolean**: `volume` (changed as expected) and `len(solids())`. An empty
  result (0 faces) comes back without an exception.
- **Overlapping parallel through cuts**: a single tool that overlaps an earlier parallel hole
  (keyholes, slots made of holes) fails: `Box(40, 40, 10) - Cylinder(6, 30) -
  Cylinder(3, 30).translate(8, 0, 0)` raises `KernelError` with the hint. **Apply both tools
  at once**: `part - [c1, c2]` or `part - (c1 + c2)`. Overlapping holes from one pattern
  (`part - (Locations((0, 0), (5, 0)) * Hole(4, 12)).on(part.faces().top())`) are one call
  and work. Fusing a boss that overlaps an earlier parallel boss fails the same way; fuse
  both at once.
- **Avoid line tangency.** A rib whose face only touches a cylinder, or two cylinders side by
  side, raises. Let the bodies overlap by a little (0.5 to 1 mm).
- **`&` with a list intersects with all of them**: `a & [t1, t2]` is `a ∩ t1 ∩ t2`, empty when t1
  and t2 do not overlap. To keep the overlap with each, fuse first: `a & (t1 + t2)`.
- **A Sketch is not a tool.** `plate - Circle(3).on(top)` raises `TypeError: cannot cut a
  Sketch with a Part; extrude it first`. Extrude first: `plate - Circle(3).on(top).extrude(-4)`.
- A `Shell` (a sheet, e.g. from `surface()`) is accepted and not checked: `stitch(part & shell)`
  trims a part with a sheet. A `Face` operand is turned into a sheet.
- If moving an operand does not help: check each operand's `is_valid()` and `volume`, and
  combine the tools before applying them.
- Speed is not an issue for ordinary parts: 225 holes as one list cut in under 1 s.

## Errors

- `ModelingError: fuse: the kernel returned a result that is not a closed, manifold solid;
  the operands may touch only along an edge, at a point or tangentially (move one so they
  overlap), or a tool overlaps an earlier cut or boss along a parallel face (combine the tools
  first and apply them at once: part - (tool1 + tool2))`.
- `KernelError` (a `ModelingError`): `cut failed (SM_ERR): ` and the same hint. Its `status`
  is `SM_ERR`.
- `TypeError: cannot cut a Sketch with a Part; extrude it first` (also for `+` and `&`).
- `TypeError: cannot cut a body with a str value; use parts (or a list of parts)` for
  strings, numbers, edges and vertices.
- `export_step` of an empty result: `ValueError: nothing to write`.

## Example

```python
base = Box(80, 50, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
bosses = PolarLocations(15, 3) * Cylinder(6, 15, align=(Align.CENTER, Align.CENTER, Align.MIN))
part = base + [b.translate(0, 0, 10) for b in bosses]       # standing on the top face (z = 10)
part -= GridLocations(60, 30, 2, 2) * Cylinder(3, 30)        # four through holes in one call
print(part.is_valid(), len(part.solids()), round(part.volume, 2), part.bbox())

# Overlapping parallel through cuts: apply the tools at once
plate = Box(40, 40, 10) - [Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0)]
print(plate.is_valid(), len(plate.faces()))                  # True 9
try:
    Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)   # one after the other
except KernelError as e:
    print(e.status)                                          # SM_ERR

try:
    Cylinder(5, 10) + Cylinder(5, 10).translate(10, 0, 0)    # side by side: tangent along a line
except ModelingError as e:
    print(type(e).__name__)                                  # ModelingError

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
