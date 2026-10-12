# Plan: features

Features: turning profiles into solids and changing solids.

Docs go to `src/smlibpy/skill/references/features/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `extrude.md` | extrude, Sketch.extrude, Face.extrude | distance, both directions, negative distance (cuts with -), taper/draft angle if any, extruding faces of a part | [x] extrude.md |
| 2 | `revolve.md` | revolve, Sketch.revolve | axis, angle, profiles touching or crossing the axis | [x] revolve.md |
| 3 | `loft.md` | loft | sections, ruled vs smooth, closed, sections with different edge counts | [x] loft.md |
| 4 | `sweep.md` | sweep, Sketch.sweep | path types, profile placement and orientation along the path, helix sweeps, twist if any | [x] sweep.md |
| 5 | `fillet.md` | fillet, Part.fillet | radius, edge selection, variable radius, continuity G2/G3, fullness, errors on too large radii, order with Booleans | [x] fillet.md |
| 6 | `chamfer.md` | chamfer, Part.chamfer | distance(s), angle, which side | [x] chamfer.md |
| 7 | `shell.md` | shell, Part.shell | thickness, openings, outward, what fails | [x] shell.md |
| 8 | `offset.md` | offset, Part.offset | grow and shrink a solid, limits | [x] offset.md |
| 9 | `mirror.md` | mirror (operation) | the operation form, fuse with the original | [x] mirror.md |
| 10 | `split.md` | split, Part.split | by plane, keep which side, by other bodies | [x] split.md |
| 11 | `section.md` | section, Part.section | cross-sections: result type, plane placement | [x] section.md |
| 12 | `thicken.md` | thicken | faces and shells to solids, direction, both sides | [x] thicken.md |
| 13 | `draft.md` | Part.draft | faces, angle, neutral plane, direction | [x] draft.md |
| 14 | `heal.md` | Part.heal | what it repairs, when to call it | [x] heal.md |
| 15 | `to_nurbs.md` | to_nurbs | what changes, why you would | [x] to_nurbs.md |
| 16 | `generic.md` | (all) | added: results that pass is_valid() but are wrong, directions, limits, errors, order | [x] generic.md |
