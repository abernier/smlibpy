# Plan: analysis

Measuring and checking: the numbers that verify a model.

Docs go to `src/smlibpy/skill/references/analysis/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | accuracy and validity | how exact the numbers are (accuracy, integration), units of results, is_valid and info, what to check after each modeling step | [x] generic.md |
| 2 | `mass_properties.md` | mass_properties, MassProperties | density, accuracy, mass, volume, area, center, inertia; checks against formulas | [x] mass_properties.md |
| 3 | `measures.md` | volume, area, center, length | on parts, sketches, shells, faces, edges, wires | [x] measures.md |
| 4 | `distance_to.md` | distance_to, closest_point | between shapes and points | [x] distance_to.md |
| 5 | `intersection_curves.md` | intersection_curves | with planes and bodies, result type | [x] intersection_curves.md |
| 6 | `silhouette.md` | silhouette | view direction, result | [x] silhouette.md |
| 7 | `project.md` | project | curves onto bodies or planes | [x] project.md |
| 8 | `outline.md` | outline | 2D drawing views of a body | [x] outline.md |
| 9 | `is_valid.md` | is_valid, info | what valid means, how to get details | [x] is_valid.md |
| 10 | `draft_analysis.md` | Part.draft_analysis, DraftAnalysis, FaceDraft | pull direction, min_angle, the four groups, angles, accuracy, one direction vs. two mold halves, curved faces, what it does not see | [x] draft_analysis.md |
| 11 | `parting_line.md` | Part.parting_line | result, exact and traced curves, walls without draft, several lines, errors | [x] parting_line.md |
