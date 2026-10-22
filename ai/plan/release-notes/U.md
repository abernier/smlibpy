# Lane U: release-note fragment (batch 1: U2, U3; batch 2: U4, U5, U6)

## Fixed

- Bridges between sheets no longer twist (U2). The kernel's edge-to-edge blend
  (`SmBrep::CreateEdgeEdgeBlend`, behind `SmApiCreateBlendPrimitive`) turns the second edge twice
  where the two edges run opposite ways, so its side edges cross: two flat sheets 20 wide, 10
  apart in height, gave twisted bridges of 215.919 and 234.062 for either choice of direction (an
  untwisted one spans at least 447). Its "G2" rescales only the first derivative across the edges
  (off a quarter cylinder r 20 its curvature there was 1.28, not 0.05), its reparameterization of
  the second edge is wrong unless the edge's interval starts at 0, and SM_API drops its status.
  smlibpy's own `blend` (below, `ext.edge_blend` in src/cpp/blend.cpp) does the steps right; no
  kernel patch.
- Trimming with curves on a face keeps what it should (U3). The kernel's `SmBrep::TrimSurfaces`
  merges with the body's own tolerance, so a circle projected onto a B-spline sheet (1e-4 off it)
  merged nothing, and with crossing curves it keeps half a sheet where a quarter is asked for.
  `ext.trim_with_curves` (src/cpp/trim.cpp) merges with a tolerance that covers the curves'
  measured gaps and bounds the sides by every edge along the curves.

- `stitch` honours its tolerance (U5; todo surfaces #9, #10, #12). It sewed with the kernel's
  `StitchIntoSolid`, which takes no tolerance and closes gaps up to 1/200 of the body's diagonal: the
  faces of a 200 mm box moved by 0.03 came back as a "valid" Part with `tolerance=1e-4`, its faces
  standing off their edges. A body sewn shut with a tolerance came back as a `Shell` (`stitch(stitch(x))`
  was the workaround), and open results kept mixed normals, so `thicken` gave volume 0 or failed. Now
  `stitch` runs `SmApiStitchAdvanced` (src/cpp/stitch.cpp, `ext.stitch_faces`) from the body's own
  tolerance, doubling, up to `tolerance` (default 1e-4 of the size), returns a Part whenever the
  result is a sound solid, and turns the faces of an open result to agree with its first piece's.
  Measured: the moved box: a Shell (26 free edges) with `tolerance=1e-4`, a valid Part with 0.2
  (largest gap 0.085); five faces of a cube and its top 0.1 too high: a valid Part of 1010 with
  `tolerance=0.2`; floor and wall of opposite normals: `thicken(1)` 190.0, valid (before 0.0,
  invalid); T-junctions sew (the bottom and sides of `Box(20, 10, 10)` and two 10 x 10 tops: a valid
  Part of 2000).
- Surfaces through curve networks run through their curves (U4). The kernel's
  `SmBSplineSurface::CreateGordonSurface` misses an incompatible network by up to 4e-2 on a 10 mm
  patch, and a compatible one still by 5.7e-4 (it intersects the curves again and reparameterizes
  them piecewise linearly to what it finds; its mapping of the crossings to [0, 1] is right only for
  curves whose parameters start at 0; it fills fixed arrays of 640 curves without a count check).
  `network` makes the curves compatible itself and calls `N_CreateGordonSrf` with their crossing
  parameters: 3e-8 on that network. No kernel patch.
- The kernel's fills are guarded (U4): `CreateCoonsPatch` checks for four curves only with
  `SM_ASSERT` (compiled out), `CreateNSidedPatch` reads a derivative curve per boundary from an array
  that may be empty, `SmBrep::CreateCornerBlend` puts a three-sided loop's point curve at a wrong
  parameter and only warns where it cannot tell which side the patch goes to: `fill`
  (src/cpp/fill.cpp) orders the loop itself, passes exactly what is read and checks every patch.
- Extending a surface reaches the distance asked (U6): `SmBSplineSurface::CreateExtendedSurface`
  halves the distance where an extension fails and stops doubling it again below half of what was
  asked, so a surface could come back extended by half or less without an error; closed directions
  and poles are skipped silently. `extend`/`extended` (src/cpp/extend.cpp) choose and check the sides
  first, measure each side across its middle and extend again or cut back.

## New

- `blend(edge_a, edge_b, *, continuity="G2", tension=(1, 1), join=False)` (smlibwasm:
  `blend(edgeA, edgeB, { continuity, tension, join })`): a sheet that bridges two border edges of
  sheets, tangent ("G1") or with the same curvature ("G2", default; "G3") across both edges.
  `tension` scales the take-off at each edge (a part of the gap); the blend joins the nearest ends
  of the edges whichever way they run, its normal follows `edge_a`'s sheet, and `join=True` sews it
  to both sheets. Measured: two flat sheets 20 apart and 10 up, G2 466.054, normals equal along both
  edges to 1e-6 degrees, sewn and thickened by 1: 1266.054; off a quarter cylinder r 20 the G2 and
  G3 blends have curvature 0.05 across the edge to 1e-6, at any tension. Closed edges are refused.
- `Shell.trim(curves, keep)` (also `Sketch.trim`): cut a sheet along curves that lie on it, and keep
  the side of a point or, with `keep="split"`, both sides as faces. A curve may run across several
  faces (it is cut where it passes from one to the next), cross other curves, or run on past the
  sheet's border on a plane. Saddle sheet with a projected circle r 5: 78.736 kept, 1169.877 with
  the hole, adding up to the sheet (the kernel's own projection trim: 78.7358 and 1169.8713).
- `Face.split(curves)`: the pieces of a face along curves on it, as the faces of a new sheet.
- `surface_fillet(..., trim=True)` (smlibwasm: `{ trim: true }`): both faces cut back to the
  blend's long edges and sewn to it into one sheet (floor and wall, r 5: 3 faces, 1514.1593, 8
  free edges; it thickens).
- `Part.imprint(tool, direction=None, *, nearest=True)` (smlibwasm: `imprint(tool, direction,
  { nearest })`): split a part's faces along curves without changing its shape. With a direction
  the curves move along it onto the part (the curves where the surface they sweep meets the part:
  a circle r 4 lands on a box's top face within 5e-6, a disk of 50.26542 for 16 pi = 50.26548) and
  split the faces they meet first; `nearest=False` splits every face they cross. One rule for every shape: the kernel's
  projection trim (`trim_project_parallel`) split both of a box's faces but only the near half of a
  patch across a cylinder's seam; here the near patch comes in two faces, one on each side of the
  seam (51.3366 together), and `nearest=False` gives the far side too.
- Docs: docs/surfaces.md (Bridges between sheets, Trimming sheets with curves, `trim=True`),
  docs/features.md (Imprints), docs/kernel.md (two rows of the robustness table), the API section
  of docs/javascript.md; skill references `surfaces/blend`, `surfaces/trim`, `features/imprint`,
  and `surface_fillet`, `Shell`, `generic`, `selection/Face`, SKILL.md updated.

- `fill(boundary, *, tangent=True)` (smlibwasm: `fill(boundary, { tangent })`): a patch that
  closes a loop of curves: a Coons patch for four sides, an N-sided fill (one face per side, sewn)
  for five and more, three sides an N-sided fill (through curves) or a Coons patch with a pole
  (tangent). Edges of sheets make it tangent to them; curves in any order and direction; one closed
  curve, or two, cut into four sides. Measured: four bulged splines, 112.2176, through every curve
  to 1e-16; a sphere r 10 with its cap above z 8 cut off, filled tangent (0.02 degrees) and sewn: a
  valid Part of 4141.52; rectangular and round holes in a paraboloid tangent to 0.001 and 0.015
  degrees; pentagon and hexagon holes to 1.35 and 1.2 degrees (the kernel's N-sided fill; checked
  at 2). Steep sheets (a cylinder's wall around its top) raise `ModelingError`.
- `network(u, v)` (smlibwasm: the same): a surface through `u` curves that each cross every `v`
  curve, the outer ones bounding it, in any order and direction; checked against the curves (1e-4
  of the size). 3 x 3 splines on 10 mm: 3e-8.
- `stitch(..., report=True)` returns `(body, StitchReport)`: `sewn_edges`, `open_edges`,
  `max_gap`, `turned_faces`, `tolerance` (smlibwasm: `stitch(..., { report: true })` gives
  `[body, report]` with `sewnEdges`, `openEdges`, `maxGap`, `turnedFaces`, `tolerance`).
- `Shell.flipped()`, `Face.flipped()`, `Sketch.flipped()` (its plane too): a sheet turned over.
  A sheet that encloses a volume (a whole sphere's face) raises `ValueError`.
- `Face.extended(distance, *, sides=None, continuity="natural")` and `Shell.extend(...)` (sheets
  of one face): the face's surface grown past its sides by a distance along the surface; `sides`
  takes edges of the face; `"natural"` continues it as it is (planes stay planes, cylinders and
  spheres the same ones, to 1e-15), `"G1"` along its tangents, `"G2"` with its curvature. Box face
  `extended(3)`: a plane 16 x 16; `Cylinder(5, 10)`'s side `extended(2)`: still a cylinder,
  2π·5·14; a 20 x 20 B-spline sheet `extend(3)`: y -3..23 exactly for all three.
- `Face.untrimmed()`: the whole surface a face lies on (a plane as the smallest rectangle around
  the face): the hole of `Box(20, 20, 20) - Cylinder(4, 40)` gives 1005.31 = 2π·4·40.
- Docs: docs/surfaces.md (stitch's tolerance and report, Filling holes and curve networks,
  Extending and untrimming), docs/kernel.md (four rows of the robustness table), the API section of
  docs/javascript.md; skill references `surfaces/fill`, `surfaces/network`, `surfaces/extend`, and
  `stitch`, `Shell`, `generic`, `selection/Face`, SKILL.md updated; ai/todo/surfaces.md #9, #10,
  #12 marked fixed.

## Behaviour changes

U2, U3 (batch 1): none that break scripts: every change adds a function, a method or a keyword.
One thing to know: `from smlibpy import *` now brings in a function named `blend`. A script that names a variable
`blend` (as the old docs did, `blend = surface_fillet(...)`) still runs; it only hides the function
for the rest of the script:

```python
# before and after: still works, the variable hides the new function
blend = surface_fillet(floor, wall, 5)
# to call the new function in such a script, rename the variable
rounding = surface_fillet(floor, wall, 5)
bridge = blend(edge_a, edge_b)
```

U4, U6 add functions and methods only. `stitch` (U5) changes what scripts get back:

- Gaps wider than `tolerance` (default 1e-4 of the size of the pieces) now stay open. Before, the
  kernel closed gaps up to 1/200 of the diagonal whatever the tolerance, and returned a Part whose
  faces stood off their edges. Pieces that do not quite meet now come back as a `Shell`; pass the
  gap you mean to close:

  ```python
  # before: a Part (gaps of 0.07 in a 200 mm box closed silently)
  body = stitch(pieces)
  # after: a Shell with free edges; say how wide a gap may be closed, and check what was closed
  body, report = stitch(pieces, tolerance=0.2, report=True)
  assert isinstance(body, Part) and report.max_gap < 0.1
  ```

- A body sewn shut with a `tolerance` comes back as a `Part` (before: a `Shell`, and
  `stitch(stitch(x))` made it a Part; that still works). Code that tested `isinstance(r, Shell)`
  to find such results gets a Part now.
- An open result's faces are turned to agree with the first piece's normal (before: each face kept
  its own). A sheet whose pieces were oriented by hand is unchanged; one whose pieces disagreed now
  thickens (before: volume 0 or an error). To get the other side, turn the result or put another
  piece first:

  ```python
  cover = stitch(skin, walls)            # walls turned to agree with the skin
  shell = cover.flipped().thicken(1.5)   # the other side
  ```

- `from smlibpy import *` brings in `fill`, `network` and `StitchReport` (as `blend` in batch 1:
  a script's own variable of that name hides the function for the rest of the script).

## Not done

- `blend` of closed edges (the round edge of a tube): refused with a `ValueError`. Bridging two
  closed edges needs the start points of the two rails lined up (a seam moved on one of them),
  which the kernel's skinning does not do; split the sheet so that the edge has two ends.
- `trim_project_parallel` is not bound in the wasm, as the plan proposed: nothing uses it. `imprint`
  intersects the swept surface instead, which gives one rule for which faces are split and exact
  curves (the kernel's projection, `project()`, is up to 3.5e-4 off a box's top face for a circle
  r 4).
- `Shell.trim` takes no direction: project the outline first (`sheet.project(curve, direction)`),
  as the docs show. A curve that runs on past the border of a B-spline sheet (off its surface)
  raises; on planes it may.
- Kernel defects met on the way, not fixed here (for their lanes): the raw binding
  `k.create_blend_primitive` segfaults on arc edges (the conic rail fails, the face/edge overload
  drops the status, and the binding returns a garbage face); `raycast` misses a hit next to a
  cylinder's seam (`Cylinder(10, 40).raycast((88.98, -1e-8, 4), (-1, 0, 0))` gives only the far
  side, also on 0.4.0; `imprint` votes over three points of a curve because of it);
  `intersection_curves` raises `KernelError (SM_ERR)` for bodies that do not meet instead of
  returning no curves (`imprint` checks the distance then).
- `fill` with mixed loops (some curves edges of sheets, some free curves) and `tangent=True`:
  refused with a `ValueError`. The kernel's tangent fills (`SmBSplineSurface::CreateCornerBlend`)
  allow a side without a sheet only where it has no length; the free sides would need cross
  tangents of their own. Pass `tangent=False`, or make sheets of the free curves first.
- `fill` tangent to sheets that stand steep to the loop (a cylinder's wall around its open top, a
  sphere cut at its equator): the Coons patch with cross tangents folds over or meets the sheet at
  90 degrees; refused with `ModelingError` (natively "folds back", in the wasm "90 degrees").
- N-sided fills (five sides and more) are tangent to about 1.4 degrees only: the kernel's
  `N_FillNSidedHole` approximates the cross tangents between a side's middle and its ends whatever
  tolerance it gets (more knots on the boundaries changed nothing). Exact tangency would need the
  patches built here (a center, curves to each side's middle, Coons patches with shared cross
  tangents).
- Three-sided tangent fills have a pole at one corner (the kernel's degenerate Coons patch);
  thickening such a patch fails.
- `Face.extended` keeps no trims: a face with a hole or a slanted border comes back as its surface
  rectangle, grown. Extending a sheet of several faces (past its free edges, faces sewn) is not
  done: extend one face.
- The guards the plan lists for `SmApiCreateOffsetSurface` (absolute 1e-3 fit) and
  `SmEdge::GetContinuity` (ignores its angle) are not wired here: nothing in this lane calls them
  (the offset belongs to the sheet-offset item, continuity is measured by smlibpy itself).

