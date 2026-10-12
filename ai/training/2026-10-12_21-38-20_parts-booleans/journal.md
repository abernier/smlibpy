# Training: parts · Booleans

**Date:** 2026-10-12

## Goal

APIs: `Part.fuse`, `Part.cut`, `Part.intersect`, `+`, `-`, `&`, `+=`, `-=`, `&=`, `sum()`.

Questions:
- Which operand forms work: several arguments, lists, nested lists, generators, ShapeList, empty?
- What does `&` with a list do?
- Touching faces, edges, points; coincident faces; identical bodies; tools that miss; tools that
  remove everything.
- Curved contacts (tangent cylinders, spheres on faces).
- When does a Boolean fail, with what message, and what helps?
- Many tools: speed; fusing tools first vs a list.

Expected from the code (`Part._boolean`): the tools are flattened (`_bodies`), each one is
applied in turn (`result = boolean(result, tool)`), the left operand's name and color are kept.
Shells (and Sketches, a Shell subclass) pass the type check.

## Runs

### 01-forms.py
`a - t1 - t2`, `a - [t1, t2]`, `a.cut(t1, t2)`, `a.cut([t1, t2])`, `a.cut([[t1], (t2,)])`, a
generator and a ShapeList all give 6869.0266. `a - []` and `a.fuse()` return a copy. `-=` rebinds;
the old object is unchanged. `a & [t1, t2]` → volume 0: intersection with every tool in turn.
`[t1, t2] + a` works (Part.__radd__ fuses); `[t1, t2] - a` → TypeError. `a - 5` → TypeError,
`a - "x"` → **RecursionError**. `a - Circle(3)` and `a - face` are accepted and return an
**invalid** part (7 faces, volume unchanged).

### 02-sketch-operand.py
`plate - Circle(3).on(top)` (forgot `.extrude`) → `Part(7 faces, volume=24000)`, `is_valid()` False,
no error. `plate + sketch` → unchanged, valid. `plate & sketch` → 1 face, volume 0, invalid.
With `.extrude(-4)` → valid, volume 23886.9. Defect MEDIUM (todo #19).

### 03-contact-cases.py
| Case | faces | volume | valid | solids |
|---|---|---|---|---|
| fuse face to face (same size) | 6 | 2000 | True | 1 (coplanar faces merged) |
| fuse face to face, offset | 10 | 2000 | True | 1 |
| fuse small box on top face | 11 | 1064 | True | 1 |
| fuse edge contact | 12 | 2000 | **False** | 1 |
| fuse point contact | 12 | 2000 | True | 1 |
| fuse identical | 6 | 1000 | True | 1 |
| cut identical / cut with bigger tool | 0 | 0 | False | 0 |
| intersect identical | 6 | 1000 | True | 1 |
| cut, tool flush with top / side | 11 / 10 | 920 / 840 | True | 1 |
| cut, tool only touching from outside | 6 | 1000 | True | 1 |
| cut, tool misses | 6 | 1000 | True | 1 |
| intersect disjoint / face contact | 0 | 0 | False | 0 |
| cut, tool fully inside (cavity) | 12 | 936 | True | 1 |
- 📌 doc: empty results are a Part with 0 faces, volume 0, no error. Edge contact is invalid.

### 04-near-coincident.py
Gaps and overlaps of 1e-3 … 1e-9 between boxes, tools almost flush: no failure, all valid. Below
about 1e-6 the kernel treats a gap as contact (6 faces, one body).

### 05-curved-contacts.py
Coaxial same-radius cylinders: fuse, cut, intersect valid. Parallel cylinders tangent outside
(fuse) and inside (cut): **invalid**, no error. Crossed cylinders of equal radius: valid
(fuse 3260.32; cut 904.13 = 1570.80 − 16/3·r³). Sphere tangent to a box (fuse, cut), cylinder
tangent to a box side (cut), cylinder axis on a box edge: valid. Torus through a 4 mm plate: 2
solids (ring and inner disk), valid.

### 06-failures.py → crash
The script ended with exit code 139 (segmentation fault) without output. Isolated in 07–10.

### 07-empty-part-crash.py, 08-empty-operand.py
Empty part: repr `Part(0 faces, volume=0)`, valid False. `a + empty`, `a - empty`, `empty + a` →
the box, valid; `a & empty` → empty. No crash here.

### 09-crash-candidate-1..3.py
Fuse with a self-intersecting revolve: `KernelError: fuse failed (SM_ERR): the operands may only
touch in a degenerate way; try moving one slightly` (the hint is wrong here: the operand is
broken). Cutting a hole into the invalid tangent fuse: returns an invalid part.
`export_step(empty)` → `ValueError: nothing to write`.

### 10-fillet-invalid-segfault.py
`(Cylinder(5, 20) + Cylinder(5, 20).translate(10, 0, 0)).fillet(edges().circles(), 0.5)` →
**segmentation fault**, twice. Defect HIGH (todo #17).

### 11-many-tools.py
225 holes as one list: 0.82 s, valid. Fusing the 225 tools first: 0.97 s, then the cut 0.65 s,
same volume. 81 pins fused onto a plate: one solid, valid. **Three overlapping parallel cylinders
cut from a box as a list → KernelError.**

### 12-overlapping-tools.py, 13-overlap-scope.py, 14-overlap-workaround.py
`Box − c0 − c4` with parallel overlapping through cylinders fails (`cut failed (SM_ERR): the
operands may only touch in a degenerate way`), also with different radii, rotated tools,
different lengths, other order, a 0.01 shift. The same for fusing two overlapping parallel bosses
onto a box. Works: crossed holes, a cylinder minus one parallel cylinder, a hole plus an
overlapping box pocket, `Slot(...).extrude`, and **fusing the tools first**: `b - (c5 + c3)` →
valid, volume 30002.2596 = expected 30002.2594.

### 15-intersect-list.py
`a & [t1, t2]` → empty; `a & (t1 + t2)` → 2 solids, volume 1130.9734 = 2·π·9·20. Chained `&` of
two spheres and a slab: valid lens.

### 16-doc-booleans.py
The doc example: base + list of 3 bosses standing on the top face + 4 through holes → valid,
1 solid, bbox (−40, −25, 0)..(40, 25, 25). Keyhole by fusing first → valid, 9 faces; one after
the other → the KernelError.
![bracket](files/16-doc-booleans-bracket.png)

### 17-overlapping-holes.py, 18-overlap-empty-repro.py, 19-overlap-variants.py
Overlapping `Hole(4, 10)` tools on a 10 mm plate (exactly the thickness): valid. **With depth
10.5, 12 or 20 (out of the bottom) the result is an empty Part (0 faces, volume 0), no error.**
Tool out of top and bottom: KernelError. Blind: valid. Fused first: valid, volume 23125.2 =
expected. Reproduced twice. Defect HIGH (todo #18).

## Coverage

- [x] fuse, cut, intersect, +, -, &, augmented forms, sum
- [x] lists, nested lists, generators, empty lists
- [x] touching faces, edges, points; coincident; identical; missing; everything removed
- [x] curved tangencies
- [x] failures and the workaround (fuse tools first)
- [x] realistic use (16)

### 20-typeerror.py
`a - edge` → `TypeError: 'Edge' object is not iterable`; `a - vertex` → `'float' object is not
iterable`; `a - Line(...)` → same as edge. The friendly message in `_boolean` is not reached.

Doc written: booleans.
