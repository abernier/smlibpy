# Lane U: release-note fragment (batch 1: U2, U3)

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

## Behaviour changes

None that break scripts: every change adds a function, a method or a keyword. One thing to know:
`from smlibpy import *` now brings in a function named `blend`. A script that names a variable
`blend` (as the old docs did, `blend = surface_fillet(...)`) still runs; it only hides the function
for the rest of the script:

```python
# before and after: still works, the variable hides the new function
blend = surface_fillet(floor, wall, 5)
# to call the new function in such a script, rename the variable
rounding = surface_fillet(floor, wall, 5)
bridge = blend(edge_a, edge_b)
```

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
