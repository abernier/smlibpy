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
or gives a broken or empty result, a single tool beside an earlier parallel hole or boss is tried
again as a NURBS copy (see Gotchas), and several tools are combined first and applied in one
Boolean (then as NURBS copies, if that fails too).

Where the faces cross along a curve tangent to the seam of a cylinder, cone, sphere or torus,
the kernel goes wrong; the operand whose seam that is goes in turned about its own axis, which
keeps its shape (see Gotchas). Only the seam of the result lies elsewhere.

The result between parts is checked: a result that is not a closed, manifold solid, or is
inside out, raises `ModelingError`; a kernel failure raises `KernelError`. Both carry the same
hint (see Errors). A broken operand raises `ModelingError: cut: a tool is not a valid solid
(...)` (or `the part is not a valid solid`). An empty cut is accepted only from tools that
together hold the part's volume and whose boxes span it, and an intersection that has as many
faces as an operand, or reaches out of an operand's box, has points of its surface classified
against the operands: a wrong empty cut or a whole part given back raises `ModelingError` ("a
result that is empty", "partly outside an operand").

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
| crossing holes whose seams lie tangent to the other hole (`Box(20, 20, 20) - Cylinder(3, 40).translate(0, 3, 0) - Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)`) | right: 6931.7476 (the second hole goes in turned about its axis); `&` of the two holes 62.721 |
| a groove pin tangent to a bore (`(Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)`) | right: 24299.2587 (the pin goes in turned about its axis) |
| a tool beside an earlier parallel hole (`(Box(40, 40, 10) - Cylinder(6, 30)) - Cylinder(3, 30).translate(8, 0, 0)`), also in a curved part (`(Sphere(20) - Cylinder(6, 60)) - Cylinder(3, 60).translate(8, 0, 0)`) | right: 14612.2528 and 28160.6083 (tried again with a NURBS copy of the tool); within about 1e-8, where both tools at once are exact |

## Gotchas

- **Check after every Boolean**: `volume` (changed as expected) and `len(solids())`. A right
  empty result (0 faces: a tool that encloses the part) comes back without an exception.
- **Seams tangent to the other operand.** A cylinder, cone, sphere or torus has a seam (at +X
  before it is turned). Where the faces of two operands cross along a curve tangent to it, the
  kernel returns a valid body of the wrong volume or fails (a groove pin tangent to a bore gave
  24331.7029 instead of 24299.2587). smlibpy finds such seams and turns the operand whose seam
  it is about its own axis first (as `Cylinder(2, 60).rotate(Z, 45)` before placing it would),
  where that keeps its shape: a cylinder, cone, sphere, hole tool or other body whose faces are
  all planes across one axis or round about it. The seam edge of that operand then lies
  elsewhere in the result (select by geometry, not by seam vertices). Not covered: the seam of
  an operand that is no such body (an earlier hole of the part), a torus' outer equator (no turn
  moves it), and seams touching free-form faces. Compare such volumes with a formula.
- **Overlapping parallel through cuts**: a single tool that overlaps an earlier parallel hole
  (keyholes, slots made of holes) makes the kernel fail; smlibpy then tries again with a NURBS
  copy of the tool, which works: `Box(40, 40, 10) - Cylinder(6, 30) -
  Cylinder(3, 30).translate(8, 0, 0)` gives 14612.2528 (exact: 14612.2526), with cylindrical
  faces. The same for a boss beside an earlier parallel boss and for curved parts
  (`(Sphere(20) - Cylinder(6, 60)) - Cylinder(3, 60).translate(8, 0, 0)`: 28160.6083). Where
  you have the tools at hand, **apply them at once** (`part - [c1, c2]`): exact, and the retry
  is not needed. Overlapping holes from one pattern
  (`part - (Locations((0, 0), (5, 0)) * Hole(4, 12)).on(part.faces().top())`) are one call.
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
  is `SM_ERR`, or `SM_ERR_BAD_INTERSECTIONS` where the kernel's intersection of the operands
  cannot go on (crossing holes whose seams lie tangent to the other one, where neither can be
  turned).
- `ModelingError: cut: the kernel returned a result that is empty; ...` and `intersect: the
  kernel returned a result that is partly outside an operand (the kernel took one operand for
  inside the other); ...`, with the same hint.
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
one = Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)   # one after the other
print(round(one.volume, 3), round(plate.volume, 3))         # 14612.253 14612.253 (a NURBS retry)

# A groove pin tangent to a bore: the pin goes in turned about its axis
pinned = (Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
print(round(pinned.volume, 4))                               # 24299.2587

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
