# Plan: sheetmetal

Sheet metal: exact bends with radius and K-factor, flanges, unfolding and flat patterns
(`smlibpy.sheetmetal`, on the kernel's SmSpaceBend / SmSpaceUnbend).

Docs go to `src/smlibpy/skill/references/sheetmetal/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `bend.md` | bend, Part.bend | the line (middle of the zone, on a sheet face), angle sign, fixed side, partial with reliefs, radius limits, errors | [x] bend.md |
| 2 | `flange.md` | flange, Part.flange | length from the virtual sharp, angles, negative angles, edge selection after earlier flanges, trays | [x] flange.md |
| 3 | `unfold.md` | unfold, Part.unfold | fixed face, K-factor, parts not made by bend, what does not unfold | [x] unfold.md |
| 4 | `flat_pattern.md` | flat_pattern, FlatPattern, Bend | placement on XY, outline, bend lines and directions, export | [x] flat_pattern.md |
| 5 | `bends.md` | Part.bends | what counts as a bend, the fields | [x] bends.md |
| 6 | `bend_allowance.md` | bend_allowance, bend_deduction, developed_length | the formulas, outside legs, placing the bend line | [x] bend_allowance.md |
| 7 | `generic.md` | (all) | building order, terms, directions, exactness, limits, errors | [x] generic.md |
| 8 | `recipes/sheet-metal.md` | (all) | bracket from a blank, box with flanges, laser flat pattern, radius and K-factor, errors | [x] recipes/sheet-metal.md |
