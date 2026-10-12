diff --git a/src/smlibpy/skill/references/parts/booleans.md b/src/smlibpy/skill/references/parts/booleans.md
new file mode 100644
index 0000000..7b5937b
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/booleans.md
@@ -0,0 +1,104 @@
+# Booleans: fuse, cut, intersect
+
+Combine parts: union (`+`, `fuse`), difference (`-`, `cut`), intersection (`&`, `intersect`).
+
+## Signatures
+
+`part.fuse(*others)`, `part.cut(*others)`, `part.intersect(*others)`;
+`part + other`, `part - other`, `part & other`; `+=`, `-=`, `&=`.
+
+- `other` is a Part or any iterable of Parts, nested as you like: `a - [t1, t2]`,
+  `a.cut(t1, t2)`, `a.cut([[t1], (t2,)])`, a generator, a ShapeList, a pattern
+  (`GridLocations(...) * Cylinder(...)`). All give the same result.
+- `a - []` and `a.fuse()` return a copy. `[t1, t2] + a` fuses too; `[t1, t2] - a` is a TypeError.
+- `sum(parts)` fuses a list of parts.
+
+## Returns
+
+A new `Part`; the operands are unchanged. It keeps the **left** operand's name and color.
+The tools are applied **one after the other**: `a - [t1, t2]` is `(a - t1) - t2`.
+
+## What to expect
+
+Measured on 10 mm boxes unless noted:
+
+| Case | Result |
+|---|---|
+| fuse, face to face | one solid, coplanar faces merged (6 faces), valid |
+| fuse, a small box standing on a face | one solid, valid |
+| fuse, touching along an edge only | one "solid", **`is_valid()` False** |
+| fuse, touching in a point | one solid, valid (STEP export splits it into two) |
+| fuse of disjoint parts | one Part, several `solids()` |
+| cut that splits the part | one Part, several `solids()` |
+| cut with a tool that misses, or only touches from outside | the part unchanged |
+| cut that removes everything; `&` of disjoint parts | **empty Part**: 0 faces, volume 0, `is_valid()` False, no error |
+| tool flush with a face (`Hole(...).on(face)`) | fine; coplanar faces are handled |
+| tool fully inside | a closed cavity (12 faces), one solid |
+| gaps or overlaps below about 1e-6 | treated as contact |
+| face or cylinder **tangent** to a cylinder (line contact) in a fuse, or a cylinder tangent inside a hole in a cut | **`is_valid()` False, no error** |
+| sphere or cylinder tangent to a flat face, coaxial cylinders, crossed cylinders | valid |
+
+## Gotchas
+
+- **Check after every Boolean**: `is_valid()`, `volume` (> 0, changed as expected) and
+  `len(solids())`. Several bad results come back without an exception.
+- **Never keep working on an invalid part.** A fillet on the invalid result of a tangent fuse
+  crashes the Python process (segmentation fault). Go back and change the operands.
+- **Overlapping parallel through cuts fail.** Cutting a cylinder that overlaps an existing
+  parallel through hole (keyholes, slots made of holes, overlapping hole patterns) gives
+  `KernelError: cut failed (SM_ERR): the operands may only touch in a degenerate way` when the tool
+  sticks out on both sides, and **an empty Part** when it is flush on one side and sticks out on
+  the other. A list is cut one tool at a time, so `part - [c1, c2]` fails the same way.
+  **Fuse the tools first and cut once**: `part - (c1 + c2)`. Tools exactly as long as the plate
+  is thick and blind holes work. Fusing two overlapping parallel bosses that stick out of a part
+  fails the same way; fuse the bosses first.
+- **Avoid line tangency.** A rib whose face only touches a cylinder, or two cylinders side by
+  side, makes an invalid part. Let the bodies overlap by a little (0.5 to 1 mm).
+- **`&` with a list intersects with all of them**: `a & [t1, t2]` is `a ∩ t1 ∩ t2`, empty when t1
+  and t2 do not overlap. To keep the overlap with each, fuse first: `a & (t1 + t2)`.
+- **A Sketch is not a tool.** `plate - Circle(3).on(top)` (no `.extrude`) is accepted and returns
+  an invalid part. Extrude first: `plate - Circle(3).on(top).extrude(-4)`.
+- A string operand ends in `RecursionError`; a number in `TypeError`.
+- The KernelError hint ("try moving one slightly") is generic. If moving does not help: check
+  each operand's `is_valid()` and `volume`, and fuse the tools before cutting.
+- Speed is not an issue for ordinary parts: 225 holes as one list cut in under 1 s.
+
+## Errors
+
+- `KernelError` (a `ModelingError`): `cut failed (SM_ERR): the operands may only touch in a
+  degenerate way; try moving one slightly`. Its `status` is `SM_ERR`.
+- Wrong operand types give unhelpful `TypeError`s: `'Edge' object is not iterable` for an edge,
+  `'float' object is not iterable` for a vertex, `'int' object is not iterable` for a number.
+- `export_step` of an empty result: `ValueError: nothing to write`.
+
+## Example
+
+```python
+base = Box(80, 50, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
+bosses = PolarLocations(15, 3) * Cylinder(6, 15, align=(Align.CENTER, Align.CENTER, Align.MIN))
+part = base + [b.translate(0, 0, 10) for b in bosses]       # standing on the top face (z = 10)
+part -= GridLocations(60, 30, 2, 2) * Cylinder(3, 30)        # four through holes in one call
+print(part.is_valid(), len(part.solids()), round(part.volume, 2), part.bbox())
+
+# Overlapping parallel through cuts: fuse the tools first, then cut once
+keyhole = Cylinder(6, 30) + Cylinder(3, 30).translate(8, 0, 0)
+plate = Box(40, 40, 10) - keyhole
+print(plate.is_valid(), len(plate.faces()))
+try:
+    Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)   # one after the other
+except KernelError as e:
+    print(e)
+
+# & with a list intersects with ALL of them; fuse first to keep each overlap
+a = Box(20, 20, 20)
+t1, t2 = Cylinder(3, 30).translate(-5, 0, 0), Cylinder(3, 30).translate(5, 0, 0)
+print(round((a & [t1, t2]).volume, 3), round((a & (t1 + t2)).volume, 3))   # 0.0 1130.973
+
+# results to check: empty, several bodies
+print((a - Box(30, 30, 30)).volume, len((Box(40, 10, 10) - Box(4, 20, 20)).solids()))   # 0.0 2
+```
+
+## Related
+
+`generic` (Part, `solids()`, `is_valid()`), `Hole`, `Cylinder`, `sketches/Slot` (a slot as one
+tool), `geometry/GridLocations`, `geometry/PolarLocations`, `recipes/verification`.
diff --git a/src/smlibpy/skill/references/parts/Hole.md b/src/smlibpy/skill/references/parts/Hole.md
new file mode 100644
index 0000000..3b7df63
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/Hole.md
@@ -0,0 +1,89 @@
+# Hole
+
+A drilling tool: a cylinder that hangs down from the origin. Subtract it from a part.
+
+## Signature
+
+`Hole(radius, depth)`
+
+- `radius` (not diameter) and `depth` in mm; both required. No `align`.
+
+## Returns
+
+A `Part`: a cylinder from z = −depth to z = 0, axis on Z. `Hole(3, 10)` has bbox
+(−3, −3, −10)..(3, 3, 0). It does not cut anything by itself: `part -= Hole(...).on(face)`.
+
+## How it is placed
+
+`.on(face)` moves the tool's origin to the face's center and its +Z to the face's outward
+normal, so the tool points into the part. The hole starts flush with the face; the bottom is
+flat (no drill point).
+
+- Blind hole: `depth` < wall thickness. `Hole(3, 6)` on the top of a 10 mm box leaves a flat
+  bottom 6 below the top.
+- Through hole: `depth` ≥ the thickness. Exactly the thickness works (coplanar bottom is fine).
+- Several holes: put a pattern in front of the tool and the whole list `.on(face)`:
+  `(GridLocations(40, 20, 2, 2) * Hole(2, 10)).on(top)`, `(PolarLocations(22, 6) * Hole(3, 8)).on(top)`,
+  `(Pos(20, 0) * Hole(...)).on(face)`.
+- Pattern coordinates are in the face's own axes:
+
+| Face (normal) | local x | local y |
+|---|---|---|
+| top (+Z) | +X | +Y |
+| bottom (−Z) | +X | **−Y** |
+| front (−Y) | +X | +Z |
+| back (+Y) | −X | +Z |
+| right (+X) | +Y | +Z |
+| left (−X) | −Y | +Z |
+
+  Side faces keep local y up. `Pos(10, 2)` on the right face of `Box(60, 40, 10)` is world
+  (30, 10, 2); on the bottom face `Pos(10, 5)` is world (10, −5).
+
+## Gotchas
+
+- **The face center is the centroid of the face as it is now.** After one hole or pocket, the
+  top face's center moves: a hole at `Pos(-20, 0)` on the new top face of a 60×40 box with a Ø10
+  hole at x = 20 lands at x = −20.677. Select the target faces once, before the first cut, and
+  reuse them; or place on a fixed plane (`.on(Plane.XY.offset(5))`); or put all holes into one
+  pattern.
+- Without `.on()` the tool sits at the origin: in a centered `Box` it drills from the middle
+  (z 0 down), not from the top.
+- `.on()` needs exactly one planar face. Two faces: `ValueError: expected exactly one shape, got 2 -
+  narrow the selection or use [0]`. A cylinder face: `ValueError: a cylinder face has no plane`.
+- A tilted planar face works: the hole follows the face normal.
+- Overlapping holes: keep `depth` exactly the thickness for through holes, or fuse the tools
+  first. `(Locations((0, 0), (5, 0)) * Hole(4, 12)).on(top)` on a 10 mm plate (both stick out of
+  the bottom) returns an **empty part** without an error; with `Hole(4, 10)` it is fine. See
+  `booleans`.
+- Tools that miss the part cut nothing and raise nothing. Check the face count or the volume
+  after the cut: each through hole adds 1 face, a blind hole 2.
+- Measure hole positions with the cylinder face's `axis`: `axis.origin` is the bottom of the
+  hole and `axis.direction` points to the opening.
+
+## Errors
+
+- `radius <= 0` or `depth <= 0`: `ValueError: radius and height must be positive`.
+- `Hole(3)`: `TypeError: missing 1 required positional argument: 'depth'`.
+
+## Example
+
+```python
+part = Box(60, 40, 10)
+top = part.faces().top()                                    # select once, before cutting
+part -= Hole(3, 6).on(top)                                  # blind, 6 deep, at the face center
+part -= (GridLocations(40, 20, 2, 2) * Hole(2, 10)).on(top) # through (the box is 10 thick)
+part -= (Pos(20, 0) * Hole(1.5, 4)).on(part.faces().front())  # into the front face
+print(part.is_valid(), len(part.faces().cylinders()))       # True 6
+for f in part.faces().cylinders():
+    print(round(f.radius, 2), f.axis.origin, f.axis.direction)
+
+# six bolt holes on a circle of radius 22
+flange = Cylinder(30, 8)
+bolts = flange - (PolarLocations(22, 6) * Hole(3, 8)).on(flange.faces().top())
+print(sorted(round(math.hypot(f.axis.origin.x, f.axis.origin.y), 4) for f in bolts.faces().cylinders()))
+```
+
+## Related
+
+`CounterBoreHole`, `CounterSinkHole`, `Cylinder`, `booleans`, `geometry/GridLocations`,
+`geometry/PolarLocations`, `geometry/Plane` (face planes).
diff --git a/src/smlibpy/skill/references/parts/generic.md b/src/smlibpy/skill/references/parts/generic.md
new file mode 100644
index 0000000..4b54208
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/generic.md
@@ -0,0 +1,84 @@
+# Part
+
+A `Part` is a solid: one or more closed bodies held in one kernel Brep. Primitives, extrusions,
+revolves, lofts, sweeps and Booleans return Parts.
+
+## Making one
+
+You never call `Part()` (it raises `TypeError: create a Part with the constructors`). Use
+`Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge`, `sketch.extrude(...)`,
+`sketch.revolve(...)`, `loft`, `sweep`, or combine parts with `+`, `-`, `&`.
+
+Every operation returns a new Part; the input is unchanged. Reassigning is the normal style:
+`plate -= Cylinder(3, 20)`.
+
+## What a Part knows
+
+| Member | Returns | Notes |
+|---|---|---|
+| `volume`, `area` | float | exact integration, relative accuracy about 1e-7 |
+| `center()` | Vector | center of mass, not the bbox center |
+| `bbox()` | BoundBox | tight; `.min`, `.max`, `.size` |
+| `is_valid()` | bool | closed manifold solid; see the gotchas |
+| `solids()` | ShapeList[Part] | the separate bodies, each with the part's name and color |
+| `info()` | dict | `type`, `faces`, `edges`, `vertices` (kernel counts, seams included), `bbox` |
+| `faces()`, `edges()`, `vertices()` | ShapeList | see `selection/*` |
+| `name`, `color` | None by default | set with `named()` / `colored()` |
+| `repr(part)` | `Part('plate', 10 faces, volume=18295.2)` | |
+
+## Name and color
+
+`part.named("plate")` and `part.colored("steelblue")` return copies with metadata. Exporters
+(STEP, glTF) and the viewer use them. Colors: one of about 60 CSS names (`"red"`,
+`"steelblue"`, `"gold"`, ...), `"#4682b4"`, `"#48b"`, or a tuple `(r, g, b)` in 0..1 (any value
+above 1 switches to 0..255).
+
+Metadata survives `translate`, `rotate`, cuts and `solids()`. A Boolean keeps the left
+operand's name and color: `Cylinder(2, 10).colored("red") + plate` is red and unnamed. Name
+and color the finished part last.
+
+## Several bodies in one Part
+
+Fusing disjoint parts, or a cut that splits a part, gives one Part with several bodies.
+`len(part.solids())` tells you how many. `sum([...])` of parts works. Before delivering a
+part that should be one piece, check `len(part.solids()) == 1`.
+
+## Gotchas
+
+- `info()["edges"]` counts seam edges; `len(part.edges())` does not (a cylinder: 3 vs 2).
+- `repr` computes the volume with accuracy 1e-5 and prints six digits, so the last digit can
+  be off (`Torus(20, 4)`: repr 6316.8, `.volume` 6316.548). Use `.volume` for numbers.
+- `is_valid()` can be True for a broken body: a revolve whose profile crosses the axis gives
+  volume −785 and `is_valid()` True. Check `volume > 0` as well.
+- A fuse where a face only touches a curved face (tangent contact) gives `is_valid()` False
+  without an error. See `booleans`. Do not continue on an invalid part: a fillet on one can
+  crash the Python process.
+- A Boolean can return an empty Part (0 faces, volume 0, `is_valid()` False) without an error.
+- `solids()` does not separate a body that floats inside a cavity of another body: it reports
+  one solid.
+- `colored()` accepts any value; an unknown color name fails only at export
+  (`ValueError: unknown color 'lightgreen'`).
+- `part.name = "x"` mutates the part in place. Use `named()`.
+- Primitive size errors are `ValueError`, not `ModelingError`. Kernel failures are
+  `KernelError` (a `ModelingError`).
+
+## Example
+
+```python
+plate = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
+plate -= GridLocations(40, 20, 2, 2) * Cylinder(3, 20)
+plate = plate.named("plate").colored("steelblue")
+print(plate)                      # Part('plate', 10 faces, volume=18295.2)
+print(plate.is_valid(), round(plate.volume, 3), len(plate.solids()))
+print(plate.info())
+
+pair = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
+print(len(pair.solids()), [round(s.volume, 3) for s in pair.solids()])   # 2 [1000.0, 1000.0]
+pins = sum(Cylinder(2, 10).translate(i * 10, 0, 0) for i in range(4))    # one Part, 4 bodies
+print(len(pins.solids()))
+```
+
+## Related
+
+`Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge`, `booleans`, `Hole`;
+`analysis/*` for mass properties and distances; `selection/*` for faces and edges.
