# Lane BT: Booleans along seams and beside earlier holes (B6, B4, B10)

Everything applies to smlibpy (Python) and smlibwasm (JavaScript) alike unless marked "native" or
"wasm". The seam logic is C++ in `src/cpp/seams.cpp`, called from `ext.boolean`, so both builds run
the same code.

## Fixed

- Booleans in which the faces cross along a curve tangent to the seam of a cylinder, cone, sphere
  or torus give the right body (B6). The kernel returned a valid body of the wrong volume there,
  or failed. A groove pin tangent to a bore, `(Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2,
  60).rotate(Y, 90).translate(0, 5, 0)`, gave 24331.7029 (wasm 24364.1472) and is now 24299.2587,
  the exact value; at y = -5 it gave 24461.4800. Two cross holes, `Box(20, 20, 20) - Cylinder(3,
  40).rotate(Z, 90).translate(0, 3, 0) - Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)`, gave
  7057.1895 and are now 6931.7476. `Cylinder(2.5, 30).rotate(Y, 90) & Sphere(2).rotate(X,
  90).translate(0, -0.5, 2.5)` gave 81.7551, more than the sphere, and is now 13.6259; `pin &
  bore` of the groove pin gave 194.6656 for 32.4443. smlibpy finds such seams (along each seam the
  distance to the other body's planes, cylinders, cones, spheres and tori) and turns the operand
  whose seam it is about its own axis first, where that keeps its shape (every face a plane across
  the axis, or a cylinder, cone, sphere or torus about it: primitives, hole tools, revolved
  parts). The Boolean runs on copies, at up to three angles that clear the seam; a result whose
  volume lies outside the bounds the operands' volumes set is passed over (one fuzz case's union
  came out as one cylinder alone when turned by 45 degrees), and where the kernel fails with each
  angle the operands go in as they are, as before. Seams where the two faces themselves touch (a
  cylinder tangent to a plane along its seam, two cylinders touching at a point) are left alone:
  turning them made Booleans that worked fail.
- Merges of the same kind are right: `pin.merge(Sphere(2).rotate(X, 90).translate(0, -0.5,
  2.5))` raised "less than that of the largest part" (the kernel's 518.314) and is now 586.4432
  (OpenCASCADE 586.4432), its cells adding up.
- Crossing holes whose seams lie tangent to the other hole compute natively (B4): `Cylinder(3,
  40).translate(0, 3, 0) & Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)` raised
  `SM_ERR_BAD_INTERSECTIONS` and is now 62.7209 (integration 62.720958; OpenCASCADE 62.7209); the
  union 2199.2258, the cuts 6931.7476 and the merge's cells too, in both builds (the wasm had only
  the intersection). The kernel's own Boolean of these still fails cleanly (patch K1).
- A single tool beside an earlier parallel hole or boss works (B10): the kernel fails where the
  two cylinders cross along lines, and smlibpy now tries again with a NURBS copy of the tool,
  whose faces come back analytic, and accepts the result only if its volume lies within the
  operands' bounds. `(Box(40, 40, 10) - Cylinder(6, 30)) - Cylinder(3, 30).translate(8, 0, 0)`
  raised KernelError and is 14612.2528 (exact 14612.2526); the same in a cylinder (44714.4938),
  a boss fuse (18081.6211) and the intersection (256.7738 for 256.7741). In a sphere the cut was
  refused as empty and the intersection as "partly outside an operand"; they are 28160.6083 and
  929.1883. Several tools at once are combined first, as before, and only then tried as NURBS
  copies, so lists keep their exact analytic result.

Measured with the seeded fuzz harness of the phase-1 review (seeds 7 and 8, and eight new seeds
11 to 18 with mostly Booleans: 3,270 cases, about 19,100 checked operations per build), against the
same build with the seam turning switched off: natively, silent wrong results fell from 76 to 72,
crashes from 2 to 1 and errors from 1068 to 1057 (with B10); in the wasm (turning alone, B10 in
both) from 79 to 72, 2 to 1 and 1026 to 1021. No operation went from right to silent or to an
error, apart from two that are noise or old: `csg-8-23`'s difference flips at 1.25e-6 between
processes (the kernel's intersection of that pair differs from run to run, with the turning off
too), and `csg-11-132`'s union, 1358.54 (OpenCASCADE 1446.61) in both runs, is now caught by the
harness's invariant because its intersection and difference compute (B10). AddressSanitizer
reported nothing in the new code over the lane and guard tests and seeds 7, 8 and 11 to 14 (one
report, in the kernel's fillet executive, fillet-7-185, is older and outside this lane).

## New

- `smlibpy._core.ext.seam_contacts(a, b, tolerance=0.0)` (smlibwasm: `ext.seam_contacts`):
  where a seam of body a touches a face of body b tangentially while the faces cross, per point
  `(seam edge index in a, face index in b, (x, y, z))`. Internal, for checks and tests.
- `ext.boolean` (both builds) turns seams as described; its result can then be a Brep of its own
  (the operands it was given are deleted). smlibwasm's `BrepHandle.brep` can be set, as Python's
  `h.brep = ...`.

## Behaviour changes

- A tool whose seam would run tangent to the other operand goes in turned about its own axis: in
  the result its seam edge, and the vertices where that seam meets the rims, lie at another angle
  than (r, 0, z) of the tool as placed, and a face can be split one edge differently. Scripts that
  pick such vertices or edges by position should select by geometry instead.

  ```python
  part = (Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
  # before: the pin's seam vertices at (+-15, 5, -2), now at (+-15, 6.414, -1.414) (turned by 45
  # degrees), so this finds none:
  # v = part.vertices().filter_by(lambda v: abs(v.y - 5) < 1e-9 and abs(v.z + 2) < 1e-9)
  # after: select the hole by its geometry
  hole = part.faces().cylinders().filter_by(lambda f: abs(f.radius - 2) < 1e-9)
  ```
- Booleans that raised now return parts: crossing holes natively (B4), a tool beside an earlier
  parallel hole or boss (B10), merges along tangent seams (B6). Code that caught the error to
  fall back to another construction gets the part instead:

  ```python
  # before
  try:
      plate = Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)
  except KernelError:
      plate = Box(40, 40, 10) - [Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0)]
  # after: the first line works (14612.2528; the list form is exact, 14612.2526)
  plate = Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)
  ```
- Volumes of Booleans with such seams change from wrong to right (24331.70 to 24299.26 above).
- `ext.boolean` can return a Brep other than `brep1` (and delete `brep1`): callers must use its
  result (`h.brep = ext.boolean(h.brep, ...)`, smlibwasm likewise). smlibpy's own callers do.

## Not done

- Seams that cannot be turned away keep the old behaviour: the seam of an operand that is no body
  of revolution (a hole already cut into the part, whose seam touches the new tool; turning only
  the new tool was enough in every such case measured), a torus' outer equator (no turn about the
  axis moves it: the tilted split of `Torus(6, 4).rotate(Y, 90)` in fuzz case slice-7-390 is
  still wrong, 5.81 + 1842.70 for 1894.96), and seams touching free-form (B-spline) faces, which
  are not looked at. Merges of more than two parts turn seams only while two solids are merged.
- A union that returns one operand unchanged although the other reaches out of it is not
  detected (`csg-11-132` above: `(Cylinder(5, 5) + Box(20, 4, 16).rotate(X, 90).translate(0, -3,
  -0.5)) + Cylinder(2, 12).translate(2, -2.3693, 3.5)` gives 1358.54, the first operand; right
  1446.61). It needs a check like B3's for intersections (an operand given back unchanged), not
  in this lane.
- Pre-existing, found by the fuzz and outside this lane: `(Box(20, 16, 4) - Sphere(6).rotate(X,
  90).translate(1.4007, 0, -1.5863)) & Torus(6, 2.5).rotate(Y, 90).translate(7.5, 0, 10.5)` kills
  the process natively (exit 139) and traps in the wasm, with or without this lane's changes; the
  all-edge fillet of `Cone(3, 0, 10).rotate(Y, 90) - Cone(1.5, 0, 8).rotate(X, 90).translate(0, 1,
  0)` (fuzz fillet-7-185) writes freed memory in `SmLoopuse::CollectEdgeuses` from
  `SmMerge::BooleanPostProcess` inside `SmFilletExecutive::DoFilleting` (AddressSanitizer; the
  normal build raises SM_ERR_NULL_POINTER).
