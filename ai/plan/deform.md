# Plan: deform

Deformations of finished parts: twist, taper, bend and free-form deformation with a lattice.

Docs go to `src/smlibpy/skill/references/deform/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `twist.md` | twist, Part.twist | angle and direction, axis (line, not direction), start/end and what happens outside, tolerance and pole counts, exact faces, shells | [x] twist.md |
| 2 | `taper.md` | taper, Part.taper | scale meaning, exactness (cylinder to cone), ranges, other axes, off-axis parts, features before/after | [x] taper.md |
| 3 | `bend.md` | bend, Part.bend | plane frame (x_dir, y_dir, normal), neutral layer, radius/start/end combinations, legs, volume rule, limits | [x] bend.md |
| 4 | `Lattice.md` | Lattice, Lattice.apply, Part.deform | grid and indexing, move/scale/rotate/layer, in-place editing, Bernstein weights, exactness and degrees, folding | [x] Lattice.md |
| 5 | `generic.md` | (all) | exact vs toleranced, ranges split faces, volume checks and the integration accuracy, meshes of twisted faces, downstream operations, errors | [x] generic.md |
| 6 | `recipes/deform.md` | (all) | when to deform rather than model directly, order of operations, patterns, limits | [x] recipes/deform.md |
