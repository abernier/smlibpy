# Close-out R: regressions and documentation errors the verifiers found, and D7

The failures the final verification of 0.5.0 left in area R (an outline regression, D2's twist,
W9's `Sketch.revolve`, printed numbers of the docs, D7's pointer), and what the sweep of the code
snippets this phase changed turned up, triaged and closed out. Area R has no entries of its own in
the release notes' "Not done" (D2's torus and sphere images of bends are area U's). Everything
applies to smlibpy (Python) and smlibwasm (JavaScript) alike unless marked; the C++ is shared
(`src/cpp`). Tests: `tests/test_closeout_R.py` (32) and `js/test/closeout_R.test.ts` (31).

## Triage

| Entry | Triage |
|---|---|
| R1: `Torus(20, 5).outline(Plane.YZ)` raises "a line needs two distinct points" (smlibwasm: RangeError), also `Torus(8, 2)` and `Torus(12, 2)` from the side: a regression of 5c7666f's `_drawn` | FINISH |
| R2 (D2): `twist(Cylinder(5, 40), 90)` gives a B-spline face, against docs/deform.md | FINISH (cylinders, cones, spheres and tori about the twist axis) |
| R3 (W9, smlibwasm): the `Sketch.revolve` method keeps 3 kernel objects a call until the garbage collector runs | FINISH (and the other methods that make intermediates) |
| R4: printed numbers of `surfaces/surface.md`, docs/surfaces.md, `surfaces/trim.md`, `features/loft.md`; docs/kernel.md's trace example no longer fails | FINISH |
| R5 (D7): point local edits to `Part.push` (U7) | FINISH |
| R6: the code snippets of docs/ and the skill this phase changed: printed numbers against what the code prints, both languages | FINISH |
| R7: the shell of the deform recipe's twisted vase raises `ModelingError` in about 2 of 5 runs (0 of 12 in 0.4), found by R6 | FINISH |
| R8: `Text` raises a `ValueError` for a font it cannot read, where the release notes catch `FontError`; `FontError` is not in `smlibpy`, found by R6 | FINISH |
| R9 (smlibwasm): `section` and the fillet's crash note raise a new `KernelError` without the kernel trace, found by R6 | FINISH |
| R10: natively, the outline of the flange example seen along (1, 1, 1) misses 61.4 mm of visible lines (smlibwasm draws them), found by R1's survey | BLOCKED |

## Finished

- **Drawing views of tori (R1).** `outline` and `drawing_views` rebuilt the kernel's projected
  pieces as lines and arcs (0.5.0) and raised on the degenerate slivers the projection gives where
  an edge or a seam is seen end-on: `Torus(20, 5).outline(Plane.YZ)` "a line needs two distinct
  points", `Torus(12, 2)` from the front "the three points are collinear" (smlibwasm: RangeError).
  Now a piece within a box 10 times the outline's tolerance across is a point of the view and left
  out (judged from its control points: measuring the slivers had taken up to 27 s), a piece that
  cannot be rebuilt stays as the kernel gave it, and a line that lies on a longer line of the view
  comes once. A torus seen from the side is 8 edges, 111.416 long (4 * 20 + 2 * pi * 5: the two
  lines and the outer halves of the tube's circles); a ring (`Cylinder(10, 5) - Cylinder(8, 5)`)
  from the front 4 lines, 50 mm (0.4: 5 lines, 66 mm, the hole's rim on the outline's line); a
  cylinder lying along X from above 4 lines, 60 mm (0.4: 6, 70 mm). Survey: 27 shapes (11 tori, a
  tilted and a cut torus, cones, a sphere, cylinders, a ring, a filleted and a holed box, the
  flange, gear, bottle, bracket and pipe examples) by 6 views (the three planes, front, an
  isometric and an oblique one), with and without `hidden`: 324 calls, 0 errors in both builds
  (5c7666f: 5 natively); the builds agree on 311 exactly and on 5 more but for how a line is split;
  the rest is R10 and the gear's oblique view (one piece of 0.77 mm).
- **A twist keeps a surface of revolution about its own axis (R2, D2).** A twist turns every
  cross-section about its axis, so a cylinder, cone, sphere or torus about that axis maps onto
  itself: such faces, bounded by full circles about the axis (and their seams), stay what they
  were, with their seam and the vertices on it, and the turned ends' trim curves along a kept circle
  are built again from it (`src/cpp/deform.cpp`: the set of faces, edges and vertices a twist
  leaves in place, also before and beyond a range). `twist(Cylinder(5, 40), 90)` is a cylinder and
  two planes, volume 3141.592654 exact (0.5.0: a B-spline face whose seam was a helix, 1e-9 off),
  and STEP writes `CYLINDRICAL_SURFACE`; a twisted tube, cone (also with its apex), sphere, torus,
  turned shaft (3 cylinders, 2 cones) and a filleted cylinder keep every face; the bore of
  `Box(20, 20, 40) - Cylinder(4, 40)` twisted stays a cylinder of radius 4. Faces off the axis,
  about another axis or with an edge the twist moves (a box fused onto a cylinder's side) are fitted
  as before. Survey of 27 shapes by 6 twists (angles to 720 and -400, ranges, other and off-centre
  axes): 66 of 162 results change only in their face types (54 have no B-spline face, 0 before),
  none in validity, volume, area or box.
- **smlibwasm frees intermediates at once (R3, W9).** The `Sketch.revolve` method (the function
  was fixed in 0.5.0) and the other methods that make intermediates run in `scope`:
  `Sketch.extrude` (taper, `both`, `direction`), `Face.extrude`, `swing`, `outline`,
  `intersectionCurves`, `thicken` with `both`, `fold`, `flange`, `unfold`, `drawingViews`, `twist`,
  `taper`, `bend`, `unroll` and `Lattice.apply`. 400 synchronous revolves whose results are disposed
  leave the kernel's memory and its object count where they were (+0.0 MB, +0 objects; the process
  had grown by 267 MB); the test counts the objects of each method over 3 calls.
- **The printed numbers (R4).** `surfaces/surface.md` and docs/surfaces.md print the fit's largest
  distance rounded (0.001: it is 0.0010094, and `< 0.001` printed False where they said True; 20000
  points come within 4.4e-5); `surfaces/trim.md` 1169.871 (analytic 1169.871198, it said 1169.877);
  `features/loft.md` 3665.191 (it said 3665.192). docs/kernel.md's `KernelError.trace` example
  fails again: `Box(20, 20, 20) - Cylinder(3, 40).rotate(Z, 45) - Cylinder(2, 40).rotate(Z,
  45).rotate(X, 90).translate(1, 0, 0)` gives `SM_ERR` in `SmMerge::MakeFaceuse` in both builds
  (the crossing cylinders it showed are fixed, B4), with smlibwasm's version next to it.
- **D7's pointer (R5).** The `Lattice` docstrings (both languages) and docs/deform.md's "Deform or
  model directly?" say that a lattice is a global map and point a bump or dent on one face to
  `Part.push` and `Part.warp` (U7), as `deform/Lattice` did.
- **The snippets' numbers (R6).** All Python blocks of docs/, README and the skill (161 files, 603
  printed lines) were run against their comments, and the smlibwasm blocks of README, js/README,
  docs/javascript.md and docs/kernel.md. Corrected besides R4: docs/features.md's cells (2261.9),
  docs/sketches.md's area (707.725666), the sheet-metal recipe's bend directions (up at 23.6965,
  down at 147.0894), `sketches/Text.md` (94.961), `surfaces/generic.md`'s fender (9908.48), and
  `analysis/outline.md` and `files/drawing_views.md`, which still said the outline's edges are all
  B-splines. The rest print what they say (the comments of loops that print several lines name the
  first, and 9 examples need files of a user).
- **The twisted vase shells in every run (R7).** `vase.shell(2.5, top)` of the deform recipe's
  twisted star raised "the kernel could not build a valid result" in 5 of 12 runs at 5c7666f (0.4:
  0 of 12). The kernel's plain mode builds no closed body for it (in 0.4 too); its extended mode
  builds the right one (27 faces, 56361.5), which was refused as reaching 1.3e-3 above the rim: the
  kernel's tight box of the inner wall (`SmFace::CalculateTightBoundingBox`) takes in the surface's
  extremes that it classifies on the face, and a point 1.4e-3 from a rim vertex of tolerance 1.8e-3
  classifies on it, off the face, while the face's edges and mesh end at the rim (how far depends on
  the run: the extended mode's result does). The box check of `shell` and `offset` now grants a
  face that reaches out of the box the largest tolerance of its edges and vertices, at most 1e-4 of
  the box's size; a result reaching farther is refused as before. 12 of 12 runs in parallel and 24
  of 24 repeated in one process (before: 9 of 24 failed there); smlibwasm built it already.
- **`FontError` (R8).** `Text` raises `FontError` for a font it cannot read (a `ValueError`;
  smlibwasm: a `RangeError`), as `load_font` and `Font` do, so the release notes' `except
  FontError` catches it, and `FontError` is in `smlibpy` (`from smlibpy import *`), as in
  smlibwasm's index. `sketches/Text.md` and the docstrings say so.
- **The kernel trace of re-raised errors (R9, smlibwasm).** `section`'s "move the plane a little"
  and the fillet's crash note keep the kernel trace of the error they replace, as natively.

## Blocked

- **R10: the native outline of the flange example seen along (1, 1, 1) misses visible lines.**
  `examples/flange.py` from `Plane((0, 0, 0), z_dir=(1, 1, 1))`: 36 edges, 1034.777, natively;
  smlibwasm 40 edges, 1096.144. The view is symmetric under x <-> y, and the native one has the arc
  of the plate's top rim from (7.42, -39.08, 31.66) to (38.43, -46.43, 8) (42.133) but not its
  mirror, nor two pieces (18.417, 0.816) at the neck's top: they come out hidden (`hidden=True`:
  visible 1034.777 and hidden 1071.524, smlibwasm 1096.144 and 1010.974). The pieces come from the
  kernel's hidden curve removal (`SmApiProjectBrepOntoPlane` -> `SmHCR::ComputeGlobalVisibility`).
  Tried: the body is the same in both builds (faces, areas, volume to 3e-11, edge tolerances,
  surface and face domains); a copy of the native body gives the same 36 edges, the body written to
  `.smb` and read back gives 41 and 1096.144 in both builds. A probe against the kernel library
  (the `.smb` body, `SmBrep::SetTolerance`, then `SmApiProjectBrepOntoPlane`) shows the visibility
  following the Brep's tolerance, which sets the HCR's approximation tolerance (min(1e-6 x size,
  0.1 x tolerance)): 1e-5 gives 41 curves and 1096.144, 7e-6 the same, 5e-6 37 and 1141.730 (more
  than is visible), 3e-6 and 1e-6 39 and 1078.860, 1e-7 and 1e-8 36 and 1066.108, 1e-4 to 1e-3 40
  and 1096.109. The HCR judges a piece by a ray at one sample point and passes the verdict along to
  the edges at its vertices (`ComputeEdgeVisibility`), against untrimmed surfaces where a face is not
  rectangular in its parameters; which of these misfires here is not located. Setting a fixed
  tolerance for the projection would make the builds agree on this part but not make the result
  right in general (the table above), so it was not done. In 0.4 the flange's faces were surfaces
  of revolution and the view was complete; the front, top and side views (`drawing_views`) of the
  flange are complete and agree between the builds.

## Later

- None: area R's entries are defects and documentation errors, all finished or blocked above.

## Behaviour changes

- `outline` and `drawing_views`: the specks of a projection (edges or seams seen end-on) are left
  out, and a line that lies on a longer line of the view comes once, so some views have fewer
  edges, of the same total length where the old ones were not doubled (a ring from the front: 4
  lines, 50 mm, not 5 lines, 66 mm). Count lengths, not edges:
  ```python
  sum(e.length for e in part.outline(Plane.XZ))
  ```
- `twist` keeps cylinders, cones, spheres and tori about its axis: such faces are `cylinder`,
  `cone`, `sphere` and `torus` now, not `bspline`, and STEP writes them as such. Code that looked
  for the B-spline selects by shape instead:
  ```python
  wall = twist(Cylinder(5, 40), 90).faces().cylinders().one()   # was faces().filter_by(geom_type == "bspline")
  ```
- `Text(..., font=...)` raises `FontError` for a font it cannot read; it is a `ValueError`
  (smlibwasm: a `RangeError`), so existing handlers still catch it:
  ```python
  try:
      Text("A", 5, font="README.md")
  except FontError:           # or except ValueError, as before
      ...
  ```
- `shell` and `offset` accept a result whose faces reach out of the part's box by no more than the
  tolerance of their edges and vertices (at most 1e-4 of the box's size); before, they refused it
  and raised `ModelingError`. Nothing to change.
- smlibwasm: the methods listed under R3 free their intermediates at once (no API change).
