# Plan: surfaces

Surfaces: freeform faces and sheet bodies.

Docs go to `src/smlibpy/skill/references/surfaces/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | surface modeling | the workflow: build faces, stitch them into a shell, thicken or close into a solid; checks along the way | [x] `generic.md` |
| 2 | `surface.md` | surface | point grids, degrees, closed directions, accuracy | [x] `surface.md` |
| 3 | `ruled.md` | ruled | between two curves, orientation, twisted results | [x] `ruled.md` |
| 4 | `stitch.md` | stitch | tolerance, open vs closed results, gaps | [x] `stitch.md` |
| 5 | `Shell.md` | Shell | sheet bodies: faces, area, thicken, heal, show; when operations give a Shell instead of a Part | [x] `Shell.md` |
