# Plan: features

Features: turning profiles into solids and changing solids.

Docs go to `src/smlibpy/skill/references/features/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `extrude.md` | extrude, Sketch.extrude, Face.extrude | distance, both directions, negative distance (cuts with -), taper/draft angle if any, extruding faces of a part | [ ] |
| 2 | `revolve.md` | revolve, Sketch.revolve | axis, angle, profiles touching or crossing the axis | [ ] |
| 3 | `loft.md` | loft | sections, ruled vs smooth, closed, sections with different edge counts | [ ] |
| 4 | `sweep.md` | sweep, Sketch.sweep | path types, profile placement and orientation along the path, helix sweeps, twist if any | [ ] |
| 5 | `fillet.md` | fillet, Part.fillet | radius, edge selection, variable radius, continuity G2/G3, fullness, errors on too large radii, order with Booleans | [ ] |
| 6 | `chamfer.md` | chamfer, Part.chamfer | distance(s), angle, which side | [ ] |
| 7 | `shell.md` | shell, Part.shell | thickness, openings, outward, what fails | [ ] |
| 8 | `offset.md` | offset, Part.offset | grow and shrink a solid, limits | [ ] |
| 9 | `mirror.md` | mirror (operation) | the operation form, fuse with the original | [ ] |
| 10 | `split.md` | split, Part.split | by plane, keep which side, by other bodies | [ ] |
| 11 | `section.md` | section, Part.section | cross-sections: result type, plane placement | [ ] |
| 12 | `thicken.md` | thicken | faces and shells to solids, direction, both sides | [ ] |
| 13 | `draft.md` | Part.draft | faces, angle, neutral plane, direction | [ ] |
| 14 | `heal.md` | Part.heal | what it repairs, when to call it | [ ] |
| 15 | `to_nurbs.md` | to_nurbs | what changes, why you would | [ ] |
