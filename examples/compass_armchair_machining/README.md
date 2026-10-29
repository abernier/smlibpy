# Compass armchair — machining files

Everything a joinery or CNC shop needs to machine the teak armchair of `examples/compass_armchair.py`:
480 × 550.2 × 794 mm over all, 18 parts, 16 of them
machined (the cane panels are woven, not cut).

Every file here is **derived from the model by code**: `examples/compass_armchair_machining.py`, with smlibpy's
`machining_setup`. Every number in the tables below is read off the model. To make the files again:

```sh
python examples/compass_armchair_machining.py <output folder>
```

## How to read the DXF files

- Units: millimetres. Format: DXF AC1015 (AutoCAD 2000), lines and arcs only (`curves="arcs"`), closed
  contours. Every CAM program reads it (Fusion 360, VCarve/Aspire, Alphacam, woodWOP via DXF import, Inkscape).
- One file is one **setup**: the part lying on the machine table on one face, the tool coming from above. The
  drawing's x and y are the table's; z runs from the table (z = 0) up to the top face (z = T, the finished
  thickness). The origin is the lower-left corner of the part's footprint.
- Layers:
  - `OUTLINE` — the part's contour, cut through. In the main setups it is the finished shape; in an edge
    setup (`*_edge1.dxf`) it is the part's shadow seen along the tool, for placing the part only.
  - `THROUGH` — holes through the part.
  - `POCKET_D<depth>` — a pocket open on the top face, to be cleared `<depth>` mm below the top face
    (`POCKET_D7_5` is 7.5 deep). A contour with an inner loop keeps the inner loop as an island (the side
    rails' stub tenons). A pocket whose contour touches the outline is open to the side: a tenon cheek, a
    rabbet, the half laps.
  - `LABEL` — the part's name and thickness as outlines, and an arrow along the grain. Do not cut it.
- The grain runs along x in every file.
- **Inside corners.** The model's mortises, half laps and slots have square corners; a router leaves inside
  corners rounded at the tool's radius. These files assume the corners are squared with a chisel after
  routing. The alternative, rounding the tenons' edges to the tool radius, suits the loose splines and the
  stub tenons; either way, mortise and tenon were modelled to the same size, so leave the usual few tenths of a
  millimetre for glue on the tenons.
- Depths are from the **top face of the finished part**. If the shop machines from oversize stock, the
  outline is cut through at T and the pockets measured from the finished surface.

## Stock

Finished thicknesses: 16, 30, 35, 40, 45 mm. The cut list gives each part a sawn
thickness by this table, the usual French trade series for sawn hardwood — **check it against the supplier's
actual stock**, teak is often sold already planed:

| Finished thickness | Sawn ("avivé") |
|---|---|
| up to 22 | 27 |
| up to 30 | 34 |
| up to 36 | 41 |
| up to 48 | 54 |

Blanks are the finished footprint plus 30 mm in length and 10 mm in width. The nests
assume planks of 2400 × 200 mm with the grain along the plank. Teak at 0.65 g/cm³: the finished parts
weigh 7.6 kg; the sawn blanks are 2.0 × the finished volume.

## Setups that need a word

- **Legs (four boards).** Main setup: the board flat, inner face up — the outline and the mortise for the
  side rail's stub tenon. Edge setup (`*_edge1.dxf`): the board standing on its seam edge (the edge that
  meets the other board of the pair), tool from the seam — half of the spline's slot, a pocket open at the
  board's top end. A slot on an edge is also a job for a slot cutter or a router jig; the DXF gives its
  position from the board's corners.
- **Armrests.** Main setup, inner face up: the half-lap recess for the post, open at the arm's rear end.
  The spline's mortise enters the sloping underside and runs vertically (along the chair's height), so it is
  not perpendicular to the underside: its edge setup (`armrest_*_edge1.dxf`) has the arm **upside down on its
  flat top**, the tool coming from below the chair. Its layer name gives the depth from the highest point of
  the underside; the table says where the floor is above the table and where the sloping surface is at the
  mortise (entry): the mortise is 40 deep from the surface at the spline. A hollow-chisel
  mortiser with the arm clamped top-down does the same job.
- **Side rails.** As modelled, the stub tenons into the legs are integral: 20 mm proud of the
  outer face, which puts the rail in 45 mm stock and makes the second setup
  (`side_rail_*_back.dxf`) a facing of the whole outer face around two islands. A shop will prefer **loose
  tenons** (Domino or shop-made): mortise the rail's outer face at the islands' positions, as deep as they are
  proud, and the rail drops to 25 mm finished (34 sawn); the legs' mortises do not change.
- **Cross rails and back rails.** Tenons at both ends, cheeks on both faces: two setups each (`*.dxf`,
  `*_back.dxf`), or a tenoning jig on the table saw; the shoulders across the height are in the outline.
  The back rails are curved (R 2222 on the middle line, bow 10, hidden within the posts' depth): bandsaw the blank from a
  44 mm wide board, then rout the arcs; grain along the chord.
- **Back posts.** Inner face up: the mortises for the back rails; turned over: the half-lap recess for the
  armrest, whose walls follow the arm's top and sloping underside.
- **Cane.** The model holds each cane panel as a plate flush with its rails, to give the openings (in the cut
  list). Real caning wants a groove or holes along the opening, which are **not** in these files: a groove near
  the inside edge of each frame member for prewoven webbing, or a row of holes for hand caning.

## Suggested order of assembly

1. Dry-fit everything; the DXF pockets are the model's exact sizes.
2. Back frame: the two posts and the two curved rails (tenons), glued square and left to cure.
3. Each side: the two leg boards meet on the seam with the spline glued across it; the side rail's stub
   tenons into the boards; then the armrest down onto the boards' tops, the spline entering its mortise.
4. The two sides joined by the front and rear rails into the side rails; the back frame offered into the
   two half laps from behind at the same time (dry-fit step 1 tells whether the laps go on before the
   armrests are glued).
5. Cane last; oil (teak oil or a hardwax oil) after sanding, or leave the teak raw to silver.

## What was checked, and what was not

- The model passes its own `check()`: every part's volume against a hand calculation, the parts fusing into
  one solid without gap or overlap, the back touching only the armrests, the feet on the floor.
- The DXF layers read back into smlibpy with the areas they were made from; the STEP files are the model's
  exact bodies.
- Not done: no CAM program has run these files, no part has been cut. Check the first part on scrap.
- The chair's proportions are a reading of photographs of the 1955 Chandigarh office chair, not a
  manufacturer's drawing (see the example's own notes).
- The sawn thickness series and the blank allowances are the usual trade sizes for sawn hardwood in France,
  not a supplier's: ask for the actual stock before cutting the list. The optimizer CSV's columns (`Length,
  Width, Qty, Label, Material, Grain`, blank sizes) are mapped in the import dialog of CutList Optimizer and
  similar tools; no tool's exact header set was verified.

## Files

| File | What it is |
|---|---|
| `cutlist.md`, `cutlist.csv` | the cut list: finished sizes, blanks, grain, which DXF covers the part |
| `cutlist_optimizer.csv` | the blanks for a panel optimizer |
| `step/compass_armchair.step` | the assembly, one named product per part |
| `step/<part>.step` | each part alone, in the model's position |
| `dxf/<part>.dxf` | the part laid on its main face: layers OUTLINE, THROUGH, POCKET_D<depth>, LABEL |
| `dxf/<part>_back.dxf` | the same part turned over about the drawing's x axis: the pockets of the other face |
| `dxf/<part>_edge<n>.dxf` | the part held on an edge: the mortise that opens there, as a pocket |
| `drawings/<part>.svg` | front, top and left views of the part in its main setup, hidden lines dashed, true size |
| `drawings/assembly.svg`, `assembly_iso.png` | the chair: three views, and a shaded view |
| `nests/nest_T<sawn>.dxf`, `.svg` | the blanks of one sawn thickness on planks, grain along the plank |

## Setups

Every machined part, its setups and what each setup cuts. x, y are the DXF's axes (mm), z the tool's axis from
the table (z = 0) to the top face (z = T). A pocket's layer names its depth from the top face; "floor" is its
height above the table and "entry" where the stock's surface is above the pocket's edge, which is lower than T
where the top is not flat there.

### front_leg_right

**`front_leg_right.dxf`** — main face; the tool comes from model -X; T = 30, footprint 595.4 × 108; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 41.2 × 18.9 | 149.7, 45.7 … 190.9, 64.6 | 20 | 10 | 30 | 0 |

**`front_leg_right_edge1.dxf`** — an edge; the tool comes from model +Y; T = 181, footprint 573.8 × 30; layers: `OUTLINE`, `POCKET_D8`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D8` | 112.6 × 20 | 4.2, 5 … 116.8, 25 | 8 | 173 | 165.8 … 181 | 0 |

In an edge setup the OUTLINE is the part's shadow seen along the tool, for placing the part on the machine; the part's own faces are cut in the main setup.

### front_leg_left

**`front_leg_left.dxf`** — main face; the tool comes from model +X; T = 30, footprint 595.4 × 108; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 41.2 × 18.9 | 404.4, 45.7 … 445.7, 64.6 | 20 | 10 | 30 | 0 |

**`front_leg_left_edge1.dxf`** — an edge; the tool comes from model +Y; T = 181, footprint 573.8 × 30; layers: `OUTLINE`, `POCKET_D8`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D8` | 112.6 × 20 | 457, 5 … 569.6, 25 | 8 | 173 | 165.8 … 181 | 0 |

In an edge setup the OUTLINE is the part's shadow seen along the tool, for placing the part on the machine; the part's own faces are cut in the main setup.

### rear_leg_right

**`rear_leg_right.dxf`** — main face; the tool comes from model -X; T = 30, footprint 595.6 × 106.4; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 41.2 × 19.1 | 404.6, 45.6 … 445.8, 64.6 | 20 | 10 | 30 | 0 |

**`rear_leg_right_edge1.dxf`** — an edge; the tool comes from model -Y; T = 181, footprint 569 × 30; layers: `OUTLINE`, `POCKET_D8`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D8` | 111.5 × 20 | 457, 5 … 568.5, 25 | 8 | 173 | 181 | 0 |

In an edge setup the OUTLINE is the part's shadow seen along the tool, for placing the part on the machine; the part's own faces are cut in the main setup.

### rear_leg_left

**`rear_leg_left.dxf`** — main face; the tool comes from model +X; T = 30, footprint 595.6 × 106.4; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 41.2 × 19.1 | 149.8, 45.6 … 191, 64.6 | 20 | 10 | 30 | 0 |

**`rear_leg_left_edge1.dxf`** — an edge; the tool comes from model -Y; T = 181, footprint 569 × 30; layers: `OUTLINE`, `POCKET_D8`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D8` | 111.5 × 20 | 0.5, 5 … 112, 25 | 8 | 173 | 181 | 0 |

In an edge setup the OUTLINE is the part's shadow seen along the tool, for placing the part on the machine; the part's own faces are cut in the main setup.

### spline_right

**`spline_right.dxf`** — main face; the tool comes from model +Y; T = 16, footprint 152 × 20; layers: `OUTLINE`, `LABEL`.

### spline_left

**`spline_left.dxf`** — main face; the tool comes from model -Y; T = 16, footprint 152 × 20; layers: `OUTLINE`, `LABEL`.

### side_rail_right

**`side_rail_right.dxf`** — main face; the tool comes from model -X; T = 45, footprint 469 × 60; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 10 × 40 | 15, 10 … 25, 50 | 20 | 25 | 45 | 0 |
| `POCKET_D20` | 10 × 40 | 449, 10 … 459, 50 | 20 | 25 | 45 | 0 |

**`side_rail_right_back.dxf`** — the other face, turned over about x; the tool comes from model +X; T = 45, footprint 469 × 60; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 469 × 60 | 0, 0 … 469, 60 | 20 | 25 | 45 | 2 |

### side_rail_left

**`side_rail_left.dxf`** — main face; the tool comes from model +X; T = 45, footprint 469 × 60; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 10 × 40 | 10, 10 … 20, 50 | 20 | 25 | 45 | 0 |
| `POCKET_D20` | 10 × 40 | 444, 10 … 454, 50 | 20 | 25 | 45 | 0 |

**`side_rail_left_back.dxf`** — the other face, turned over about x; the tool comes from model -X; T = 45, footprint 469 × 60; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 469 × 60 | 0, 0 … 469, 60 | 20 | 25 | 45 | 2 |

### armrest_right

**`armrest_right.dxf`** — main face; the tool comes from model -X; T = 30, footprint 512.6 × 93.1; layers: `OUTLINE`, `POCKET_D15`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D15` | 59.5 × 93.1 | 453.1, 0 … 512.6, 93.1 | 15 | 15 | 30 | 0 |

**`armrest_right_edge1.dxf`** — an edge; the tool comes from model -Z; T = 93.1, footprint 512.6 × 30; layers: `OUTLINE`, `POCKET_D57_17`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D57_17` | 16 × 20 | 227, 5 … 243, 25 | 57.2 | 36 | 75.4 … 76.5 | 0 |

In an edge setup the OUTLINE is the part's shadow seen along the tool, for placing the part on the machine; the part's own faces are cut in the main setup.

### armrest_left

**`armrest_left.dxf`** — main face; the tool comes from model +X; T = 30, footprint 512.6 × 93.1; layers: `OUTLINE`, `POCKET_D15`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D15` | 59.5 × 93.1 | 0, 0 … 59.5, 93.1 | 15 | 15 | 30 | 0 |

**`armrest_left_edge1.dxf`** — an edge; the tool comes from model -Z; T = 93.1, footprint 512.6 × 30; layers: `OUTLINE`, `POCKET_D57_17`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D57_17` | 16 × 20 | 269.6, 5 … 285.6, 25 | 57.2 | 36 | 75.4 … 76.5 | 0 |

In an edge setup the OUTLINE is the part's shadow seen along the tool, for placing the part on the machine; the part's own faces are cut in the main setup.

### back_post_right

**`back_post_right.dxf`** — main face; the tool comes from model -X; T = 30, footprint 300 × 34; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 20 × 10 | 7.5, 16.9 … 27.5, 26.9 | 20 | 10 | 30 | 0 |
| `POCKET_D20` | 20 × 10 | 272.5, 16.9 … 292.5, 26.9 | 20 | 10 | 30 | 0 |

**`back_post_right_back.dxf`** — the other face, turned over about x; the tool comes from model +X; T = 30, footprint 300 × 34; layers: `OUTLINE`, `POCKET_D15`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D15` | 103.1 × 34 | 145.1, 0 … 248.2, 34 | 15 | 15 | 30 | 0 |

### back_post_left

**`back_post_left.dxf`** — main face; the tool comes from model +X; T = 30, footprint 300 × 34; layers: `OUTLINE`, `POCKET_D20`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D20` | 20 × 10 | 7.5, 16.9 … 27.5, 26.9 | 20 | 10 | 30 | 0 |
| `POCKET_D20` | 20 × 10 | 272.5, 16.9 … 292.5, 26.9 | 20 | 10 | 30 | 0 |

**`back_post_left_back.dxf`** — the other face, turned over about x; the tool comes from model -X; T = 30, footprint 300 × 34; layers: `OUTLINE`, `POCKET_D15`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D15` | 103.1 × 34 | 51.8, 0 … 154.9, 34 | 15 | 15 | 30 | 0 |

### front_rail

**`front_rail.dxf`** — main face; the tool comes from model -Y; T = 30, footprint 410 × 60; layers: `OUTLINE`, `POCKET_D10`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D10` | 20 × 40 | 0, 10 … 20, 50 | 10 | 20 | 30 | 0 |
| `POCKET_D10` | 20 × 40 | 390, 10 … 410, 50 | 10 | 20 | 30 | 0 |

**`front_rail_back.dxf`** — the other face, turned over about x; the tool comes from model +Y; T = 30, footprint 410 × 60; layers: `OUTLINE`, `POCKET_D10`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D10` | 20 × 40 | 0, 10 … 20, 50 | 10 | 20 | 30 | 0 |
| `POCKET_D10` | 20 × 40 | 390, 10 … 410, 50 | 10 | 20 | 30 | 0 |

### rear_rail

**`rear_rail.dxf`** — main face; the tool comes from model -Y; T = 40, footprint 410 × 60; layers: `OUTLINE`, `POCKET_D15`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D15` | 20 × 40 | 0, 10 … 20, 50 | 15 | 25 | 40 | 0 |
| `POCKET_D15` | 20 × 40 | 390, 10 … 410, 50 | 15 | 25 | 40 | 0 |

**`rear_rail_back.dxf`** — the other face, turned over about x; the tool comes from model +Y; T = 40, footprint 410 × 60; layers: `OUTLINE`, `POCKET_D15`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D15` | 20 × 40 | 0, 10 … 20, 50 | 15 | 25 | 40 | 0 |
| `POCKET_D15` | 20 × 40 | 390, 10 … 410, 50 | 15 | 25 | 40 | 0 |

### back_rail_lower

**`back_rail_lower.dxf`** — main face; the tool comes from model (-0.000, -0.259, -0.966); T = 35, footprint 460 × 34; layers: `OUTLINE`, `POCKET_D7_5`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D7_5` | 20 × 10 | 0, 16.9 … 20, 26.9 | 7.5 | 27.5 | 35 | 0 |
| `POCKET_D7_5` | 20 × 10 | 440, 16.9 … 460, 26.9 | 7.5 | 27.5 | 35 | 0 |

**`back_rail_lower_back.dxf`** — the other face, turned over about x; the tool comes from model (0.000, 0.259, 0.966); T = 35, footprint 460 × 34; layers: `OUTLINE`, `POCKET_D7_5`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D7_5` | 20 × 10 | 0, 7.1 … 20, 17.1 | 7.5 | 27.5 | 35 | 0 |
| `POCKET_D7_5` | 20 × 10 | 440, 7.1 … 460, 17.1 | 7.5 | 27.5 | 35 | 0 |

### back_rail_upper

**`back_rail_upper.dxf`** — main face; the tool comes from model (-0.000, -0.259, -0.966); T = 35, footprint 460 × 34; layers: `OUTLINE`, `POCKET_D7_5`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D7_5` | 20 × 10 | 0, 16.9 … 20, 26.9 | 7.5 | 27.5 | 35 | 0 |
| `POCKET_D7_5` | 20 × 10 | 440, 16.9 … 460, 26.9 | 7.5 | 27.5 | 35 | 0 |

**`back_rail_upper_back.dxf`** — the other face, turned over about x; the tool comes from model (0.000, 0.259, 0.966); T = 35, footprint 460 × 34; layers: `OUTLINE`, `POCKET_D7_5`, `LABEL`.

| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | Entry z | Islands |
|---|---|---|---|---|---|---|
| `POCKET_D7_5` | 20 × 10 | 0, 7.1 … 20, 17.1 | 7.5 | 27.5 | 35 | 0 |
| `POCKET_D7_5` | 20 × 10 | 440, 7.1 … 460, 17.1 | 7.5 | 27.5 | 35 | 0 |

## Not for a vertical cutter

Nothing: every feature is a pocket of one of the setups above.

## Nests

Planks of 2400 × 200 mm, blanks with their grain along the plank, 4 mm apart.

| Sawn thickness | Planks | Area used | Blanks |
|---|---|---|---|
| 27 mm | 1 | 2% | spline_right, spline_left |
| 34 mm | 2 | 48% | front_leg_right, front_leg_left, rear_leg_right, rear_leg_left, armrest_right, armrest_left, back_post_right, back_post_left, front_rail |
| 41 mm | 1 | 9% | back_rail_lower, back_rail_upper |
| 54 mm | 1 | 21% | side_rail_right, side_rail_left, rear_rail |
