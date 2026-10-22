# Lane FO: fillets, chamfers, shells, offsets and face edits (F6, F7, F8, F9, F10, F11, F12, O1, O3, O7, O8, O9, O10, O11, O12)

## Fixed

- The extended offset mode no longer reads curves it has deleted (O1, issue #2). When
  `SmBrep::MakeEdgeInFace` failed after it had given an intersection curve to a new Edge,
  `SmEdgeDefinition::Imprint` deleted the curve anyway and the next Boolean of the offset
  executive's `PiecewiseMerge` read it (`SmEdge::CalculateBoundingBox`). Raw extended shells of a
  filleted 20 mm cube and of issue #2's boxes (40 x 30 x 10, rounds 1 and 2) crashed 27, 8 and 7 of
  300 processes of 8 calls; now none. The site was found with malloc stack logging in the
  crashing processes (every crash read a curve freed there) and confirmed with AddressSanitizer
  (6 of 200 processes before, 0 of 200 after). Kernel patch in
  `third_party/patches/SMLib/src/SmProtoTopology.cpp`.
- A failed `SmSurface::CreateNaturalUVTrimCurves` no longer leaves deleted curves in its results
  (O1). `SmSurface::CoincidenceCheck` read and deleted them again: the extended shell of an
  imported part (crescendo part 65) crashed 17 of 40 processes; now none (AddressSanitizer: 97 of
  100 perturbed processes before, 0 after). New kernel patch
  `third_party/patches/SMLib/src/SmSurface.cpp`.
- `shell`, `offset` and `thicken` ran these steps in a forked copy already (0.5.0, O1), so in
  smlibpy and smlibwasm the crashes above showed as `ModelingError: ... the kernel crashed`; they
  now give the kernel's answer instead. smlibwasm's memory never took these paths in the runs
  measured (no trap before or after), but it compiles the same patches.
- Rounding one edge of a tangent run works (F6): one top edge of a plate with rounded corners, one
  straight edge of a slot, one arc of a rounded corner, or an edge that runs tangentially into the
  arc of a rounded vertical edge failed at any radius with "the radius may be too large". Now the
  round follows the run: `Rectangle(40, 30, fillet=5).extrude(10)` with one long top edge and r 1
  gives 11757.4972 (OpenCASCADE: 11757.497249759455), with r 2 11674.9993 (11674.999251067233).
  `chamfer` likewise.
- Shells whose opening meets its neighbours tangentially work (O3): the flat top of a box rounded
  on all edges, a side opening of it, a rounded cup. The kernel leaves such a rim open (inner
  rounds up to the outer edge, edges 2 mm off their faces), which 0.5.0 refused with
  `ModelingError`; `shell` now shells the part closed and cuts the opening out: the cavity's face
  under it extruded through the wall. The shell guide's own example gives 11134.3949 (the closed
  shell 14134.3949 less the 50 x 30 x 2 lid), issue #2's boxes 1238.0236 (R1, t 0.5), 1233.2227 and
  2333.4807, the cup `Cylinder(20, 30).fillet(all, 3).shell(1, top)` 4766.9544 (the kernel raised).
  Taken only for planar openings whose other rim edges meet walls standing at right angles to
  them for at least the wall (then exact), and checked: the cut must take exactly the wall over the
  opening. OpenCASCADE's `MakeThickSolidByJoin` agrees below the rim and builds an invalid body at
  it.
- Two fillet crashes (found measuring F7 on 514 random fillets and chamfers; both also on the clean
  `next` tree): `SmFilletGeom::MakeFaceBrep` asked a missing boundary curve whether it was
  degenerate (all-edge chamfer 0.25 of a box with a horizontal cylinder fused in), and
  `SmFilletSolver::CreateCliffRollOverSideFG` read the surface of a side face the rollover had not
  found (all-edge fillet 0.5 of a box with a cone fused on). Both raise `KernelError` now, naming
  the edge; AddressSanitizer reports nothing for them or for the other 512 cases. smlibwasm read
  its memory at address 0 there and built broken bodies. New kernel patches
  `third_party/patches/SMLib/src/SmFilletGeom.cpp` and `SmFilletSolver.cpp`.
- Fillets close to the largest radius that fits work (F7): all edges of a 10 mm cube with r 4.98,
  of a 20 mm cube with 9.97 and 9.98, of a 40 mm cube with 19.96 came out open (refused); now exact
  (to 3e-9). The cause is the solvers' approximation tolerance: SM_API's `SetFilletParameters`
  builds the rounds' edges within 4 times the edge tolerance, the kernel's own all-edge fillet
  within the Brep's tolerance. `fillet` and `chamfer` try once more within 1 times the edge
  tolerance where the first attempt fails or is refused (not after `SM_ERR_INVALID_INPUT`). Over
  514 fillets and chamfers of random Boolean parts: 291 results bit for bit the same, 4 more
  succeed, none fewer; failures take twice as long (the whole set 17.7 s, now 21.1 s).

- Sharp offsets of parts with acute convex edges are kept (O8): an edge whose faces meet at an
  angle `a` moves out by `d / sin(a / 2)`, more than `d`, and `offset` refused every result reaching
  beyond the part's box grown by `d`. `Cone(5, 2, 10).offset(1)` raised `ModelingError`; now 819.1342
  (analytic 819.1344), 12.688 across. `Rectangle(20, 20).extrude(10, taper=10).offset(1)`: 4947.2078
  (analytic to 4e-10). A sharp result that reaches beyond `d` is now bounded by the first-order reach
  of the part's edges (`1 / cos(t / 2)`, `t` the angle between the face normals, at 5 points of each
  edge) and corners (where the moved tangent planes of three faces meet), times 1.25 for curved faces,
  counted up to 25 (`Part._sharp_offset_reach`; asked only for such results). Over the 140 imported
  parts of the corpus (offset by +-0.5 or a tenth of their size): 3 more grow (parts 42, 50, 163, the
  same volumes as OpenCASCADE's `BRepOffsetAPI_MakeOffsetShape` with `GeomAbs_Intersection` to 1e-9),
  none fewer; the reach took 1.1 s over all 140.
- Chamfers of circular edges are exact (F12): the kernel fits the bevel of a circle with a B-spline,
  and the volume of a chamfered pin of radius 2 was 1.1e-5 off (docs/kernel.md said 1e-7 to 4e-6). A
  full circle between faces around one axis (a plane at right angles to it, a cylinder or a cone, or
  the straight faces of a revolve, sampled at four angles) is now bevelled with a cut (a fuse at a
  concave rim) of the solid of revolution of the bevel's line: an exact cone. `Cylinder(2, 5)` with
  both rims 1.94: 30.8290435179 (exact, 1e-15; 0.5.0: 30.8287005); the flange example 157979.6668
  (exact; 0.5.0: 157979.6230); unequal setbacks on a cylinder rim, 2 and 1: 6224.5422 (OpenCASCADE
  6224.542; 0.5.0: 6224.536). Checked: the volume taken must be the bevel's (Pappus) to 1e-6, or the
  kernel bevels the edge as before (a disc just below the rim). The kernel bevels the other edges of a
  selection first. Faster on many holes: 162 hole rims of a plate 1.5 s (the kernel 3.1 s), one
  Boolean for all. docs/kernel.md, docs/analysis.md and the skill's analysis references give the
  accuracy of fitted faces as up to 1e-5 of the volume on small parts.

- `shell` says which cavity it built (O12): the kernel's plain mode rolls a ball where the faces grow
  apart (constant wall, an inner round of radius `thickness` at each concave edge), its extended mode
  extends the faces (sharp inner corners, the wall thicker there), and `shell` returned whichever
  succeeded first without saying so: the fuzz body `Cone(3, 4, 6).rotate(Y, 90) + Cone(6, 2, 16)...`
  gives 274.643 (16 faces) one way and 275.8722 (11) the other, an L-shaped block 1745.1327 and 1752.0.
  The result's `info()["corners"]` now says `"round"` or `"sharp"`, and `corners=` picks one (below).

## New

- `Part.fillet(..., propagate=True)` and `Part.chamfer(edges, length, *, propagate=True)` (also
  `fillet(...)`/`chamfer(...)`; smlibwasm: `{ propagate }` in the options, a new `ChamferOptions`
  for `chamfer`): round the edges that continue the selected ones tangentially too. An added edge
  takes the radius of the selected edge it continues (a radius list still has one radius per
  selected edge). With `propagate=False`, a round the kernel refuses names the selected edge that
  runs on tangentially into an edge that is not selected, and where ("... runs on tangentially into
  an edge that is not selected at (15, 15, 10) and (-15, 15, 10), which the kernel cannot always
  round alone; select the whole run ...") instead of "the radius may be too large".
- `Edge.tangent_chain()` and `ShapeList.tangent_chain()` (smlibwasm: `tangentChain()`): the edge
  (first) and the edges that continue it tangentially (leaving a vertex within 10 degrees of the
  direction the previous one arrives in, between faces that meet smoothly there, not smooth or
  seam edges themselves), as far as the run goes. Docs: `docs/features.md` (Tangent runs),
  `docs/selecting.md`, skill references `selection/tangent_chain`, `features/fillet`,
  `features/chamfer`, `selection/Edge`.
- The fillet and chamfer errors name what the kernel could not build (F8): the corner (a vertex)
  or the edge, and why where its fillet code says so: "fillet failed (SM_ERR): the kernel could not
  build the corner at (-3.58441, -4.18, 7.5) (corner geometry computation failure); the radius may
  be too large for the selected edges", "... the round of the edge from (-15, -10, 7.5) to (15, -10,
  7.5) (fillet solver error: unable to process rollover); ...". 37 of the 38 kernel failures of the
  514 random cases named a place. smlibpy's own C++ drives the fillet executive now
  (`ext.round_edges`, `src/cpp/fillet.cpp`, bound in smlibwasm as `ext__round_edges`), as SM_API
  does (the same bodies, checked bit for bit), and returns the executive's record (SM_API keeps it
  to itself). The kernel patch for missing corners records the vertex too ("it could not build the
  corner at (5, 0, 10) (it has no corner for the way the rounded edges meet there)").
- Unequal chamfers (F9, ai/todo/features.md #23): `Part.chamfer(edges, length, *, length2=None,
  angle=None, reference=None, propagate=True)` (smlibwasm: `{ length2, angle, reference }`; also the
  function `chamfer`). `length` is the setback on the `reference` face of each edge, `length2` on its
  other face; `angle` (degrees) tilts the bevel against the reference face instead. Exact for planar
  faces and corners: the top edges of `Box(40, 30, 20)` with 2 and 1 give 23865.3333, with 2 at 30
  degrees 23844.5003 (OpenCASCADE's `BRepFilletAPI_MakeChamfer.Add(d1, d2, edge, face)`: the same to
  1e-12); a cylinder's rim 2 and 1 6224.536 (OpenCASCADE 6224.542; the bevel is a fitted B-spline,
  as equal ones are). The kernel's solver offsets each face by its own distance (`SmConstantRadiusFS`
  with its second radius), which SM_API does not offer.
- Offset sheets and faces (O7): `Shell.offset(distance)` and `Face.offset(distance)` (a sheet), also
  through `offset(shape, distance)`: each face moves along its normal, extended or trimmed where
  faces meet. A half-cylinder sheet r10 by 2: 753.9822 (pi 12 20), the open box of 5 faces by -1:
  1692.0. Checked: every face at the distance from the sheet, on its side; beyond a concave radius
  `ModelingError`. In a forked copy, as `thicken`.
- `thicken(surface, thickness, *, both=False)`: the function takes `both` too (smlibwasm:
  `thicken(surface, t, { both })`).
- Docs: `docs/features.md` (fillet errors, unequal chamfers, shells with tangent rims, offset
  sheets), `docs/surfaces.md` (Offset surfaces), `docs/kernel.md` (three rows, two limitations);
  skill references `features/chamfer`, `features/fillet`, `features/shell`, `features/offset`,
  `features/thicken`.

- `Part.offset(distance, *, corners="sharp")` (O9; smlibwasm `offset(d, { corners })`, and the function
  `offset(part, d, corners=...)`): `"round"` rolls a ball along the part (the kernel's offset without
  its extended mode): cylinders and spheres where faces grow apart, every point at `distance` from the
  part. Exact: `Box(10, 10, 10)` by 2 gives 2610.50144 (Steiner's formula), the acute wedge
  `Polygon((0, 0), (20, 0), (0, 8)).extrude(5)` by 1 905.4184 (sharp: `KernelError`), a box with a
  hole that closes, `(Box(20, 20, 10) - Cylinder(3, 20)).offset(4, corners="round")`, 13170.040141
  (the rounded box less a dimple over each end of the hole, integrated: 13170.040141; sharp:
  `KernelError`), an L-block shrunk by 1: 2097.197642 (its concave edges rounded; OpenCASCADE's arc
  join the same). Checked like the sharp mode, within the part's box grown by `distance`, tried once.
  Over the corpus: 111 of 140 parts grow (sharp 89; 24 of those the sharp mode fails on), 82 shrink
  (sharp 84). The sharp mode's `KernelError` suggests it: "offset failed (SM_ERR): try a smaller
  distance, or corners="round", which rounds the edges whose faces grow apart instead of extending the
  faces (it builds acute wedges and holes that close)".
- `corners="patch" | "mitre"` for `Part.fillet` and `Part.chamfer` (F10; smlibwasm `{ corners }`):
  `"mitre"` runs the rounds (or bevels) of three convex edges on until they meet, without a corner
  patch, through the executive's bevel corners (`SmFilletCorner::SetBevel` in `ext.round_edges`, for
  every cross-section and radius; SM_API's `SmApiSetBevelCorners` takes circular rounds of one radius).
  All edges of a 20 mm cube r 2: 7808.676141, 18 faces (the cube less the union of its edges' round
  prisms, integrated: 7808.676122; with patches 7804.6961, 26 faces); chamfered by 2: 7568.0, exact.
  Only corners of three convex edges and no other edge are mitred (`SmFilletConvexNxNCorner` bevels
  three and fails on more; other corners skip their patch and would leave a hole); a selection without
  one raises `ValueError`. `ext.round_edges(..., mitre=True)` returns how many corners it mitred
  (`"mitred"`).
- Docs (F11): the corner patch where three rounds meet is G1 only, also for G2 and G3 blends
  (`docs/features.md` Smooth blends, the skill's `features/fillet`, the `Part.fillet` docstring in both
  languages, `docs/kernel.md` limitations). New sections: `docs/features.md` Corners, exact circular
  chamfers, rounded offsets; `docs/kernel.md` rows for the offset bound, mitred corners and conical
  chamfers; skill references `features/offset`, `features/fillet`, `features/chamfer`; the
  JavaScript API section.

- Direct editing (O10): `Part.move_faces(faces, by)` and `Part.offset_faces(faces, distance)`
  (smlibwasm `moveFaces`, `offsetFaces`; the module `smlibpy.face_edit`, `js/src/face_edit.ts`). The
  faces get new surfaces, copies of their own moved by a rigid motion (`by`: a vector or a
  `Location`, which turns them too) or offset along their outward normals (the kernel's
  `CreateOffsetSurface`, which keeps the parameters: planes move, cylinders, cones, spheres and tori
  change their radius, other surfaces become offset surfaces), and `SmBrep::LocalOperation` rebuilds
  the part around them, extending or trimming the faces around them (new C++ `src/cpp/face_edit.cpp`,
  `_core.face_edit.edit_faces`, bound in smlibwasm as `face_edit__edit_faces`). Exact: `Box(10, 10,
  10)` top +5 1500.0, -4 600.0; `Box(40, 30, 10) - Cylinder(3, 20)`: the hole r3 -> r5 11214.6018,
  moved by (8, 0, 0) with its circles centred at x = 8, the top up 5 17575.885; a boss's top pulled
  up 5 13178.0972 and its side out 1 13130.9734; a wall leaned in by 10 degrees with a Location about
  its bottom edge 3823.673 (to 1e-12); the step of an L-block raised 3 900.0. `offset_faces` takes a
  face's tangent chain along (one end of a `Slot(16, 6)` by -1 widens the whole slot to 18 x 8:
  6697.3452); `move_faces` refuses a tangent neighbour that is not selected and names it. The edges
  where a moved plane meets an extended cylinder, cone or sphere, which the kernel fits with a
  B-spline (a pin's top pulled up 5: 1178.0971 instead of 1178.0972), are put back as the exact
  circles. Checked: the gaps between vertices, edges and faces (as `draft`), the face count, a sound
  solid, and the sign of the volume change for `offset_faces`; a radius that would reach 0, a face
  that vanishes or is pushed past another, and a part with a cavity (the kernel drops cavities, edited
  or not, and reports success) raise `ModelingError` saying so.
- `shell(thickness, openings=None, *, outward=False, corners=None, walls=None)` (O10, O12; also the
  function `shell`; smlibwasm `{ outward, corners, walls }`):
  - `walls`: faces with walls of their own thickness, `(faces, thickness)` pairs or a dict of faces
    (smlibwasm: `[faces, thickness]` pairs or a `Map`). The shell's face across each such wall is
    offset by the difference (`offset_faces`); a closed shell's cavity is edited as a body of its own
    (the part offset by `-thickness` in the shell's mode) and cut out, since the kernel's face edit
    drops cavities. `Box(40, 30, 10)` open at the top, 2 thick, floor 5 and +X wall 6: 7840.0
    (= 12000 - 32 * 26 * 5, the plan's probe); closed with a 4 mm floor 8256.0; outward and sharp
    with a 4 mm floor 11936.0. Faces that meet smoothly need one thickness (`ModelingError` naming
    them, with the advice).
  - `corners`: `"round"` (the plain mode only), `"sharp"` (the extended mode only, retried once after
    a refused result as before), or `None` (default: as before, round where the kernel builds it, else
    sharp). A shell the kernel cannot build the way asked raises, with `or try corners="..."` in the
    hint. `outward=True, corners="sharp"` gives sharp outer edges: `Box(80, 50, 30)` with the top
    open, 2.5 out: 31937.5 (round: 31398.0); the guide's "use offset minus the part" is gone.
  - `info()` of a body made by `shell` or `offset` has `"corners"` (`"round"` or `"sharp"`); the
    record goes with the body (a moved copy is a new body and has none).
- Two-sided drafts (O11): `docs/features.md` (Draft) and the skill's `features/draft` give the recipe
  for a planar parting line: split there, draft each half about the plane (the lower one with
  `Plane.XY.flipped()`), fuse. `Box(40, 30, 20)` at 3 degrees: 23273.6153, exact, 10 faces;
  `draft_analysis(Z)` finds 3 on the upper walls and -3 on the lower ones.
- Docs: `docs/features.md` (shell corners and walls, two-sided draft, Moving and offsetting faces),
  `docs/kernel.md` (a row for `LocalOperation`, the shell-mode row, a limitation), skill references
  `features/move_faces` and `features/offset_faces` (new), `features/shell`, `features/draft`,
  `features/offset`, `parts/generic` (`info()`), `SKILL.md`; MCP search synonyms (resize, enlarge,
  widen, thicker, push, relocate, direct editing); the JavaScript API section.

## Behaviour changes

- `fillet` and `chamfer` round the whole tangent run of each selected edge (as OpenCASCADE,
  build123d and most CAD systems do). Selections whose edges ran on tangentially into edges that
  were not selected now round more: an edge that ran tangentially into the arc of a rounded
  vertical edge at one end (which worked, the round running on past its end) now rounds the line,
  the arc and the next line (removed 14.4863 instead of 7.7959 on `Box(40, 30, 10)` with one
  vertical edge rounded by 5, r 1); one straight top edge of a slot is chamfered all around.
  Before/after:
  ```python
  b = Box(40, 30, 10)
  b = b.fillet(b.edges().parallel_to(Z).filter(lambda e: e.center().x > 0 and e.center().y > 0), 5)
  line = b.edges().filter(lambda e: abs(e.center().z - 5) < 1e-6 and abs(e.length - 35) < 1e-9).one()
  b.fillet(line, 1)                    # before: the line only; now: line, arc and line
  b.fillet(line, 1, propagate=False)   # the old result
  ```
- A `(start, end)` radius on an edge with a tangential run-on raises `ValueError` ("a selected edge
  runs on tangentially into another edge at ..., which propagate=True rounds with it; give a
  constant radius, or propagate=False to round the selected edges only"): the law runs along each
  edge on its own and cannot follow a run. Migration: `part.fillet(edge, (1, 2), propagate=False)`.
- A radius list whose length does not match the selection raises its `ValueError` ("2 radii for 3
  edges") before any check of the sizes (the message is the same).
- smlibwasm: `chamfer`'s options are checked like Python's keywords (`Part.chamfer` in
  `_options.ts`): an unknown key throws `TypeError`.
- `tests/test_guards.py::test_rounds_that_run_on_past_their_edge_pass_the_volume_check` (and its
  TS twin) pass `propagate=False`, which keeps the run-ons that test is about.
- Fillet and chamfer messages: a kernel failure now begins with the place ("the kernel could not
  build the corner at (...) (...); the radius may be too large ..."), and a selection the kernel
  cannot round says where ("the kernel cannot round the selection as given, at any size: it could
  not build the corner at (5, 0, 10) (...); select fewer edges there"). The statuses are the same.
  Scripts that match the text should match the status:
  ```python
  try:
      part.fillet(edges, r)
  except KernelError as e:
      if "an edge whose faces meet" in str(e): ...       # before
      if e.status == "SM_ERR_INVALID_INPUT": ...         # now (and before)
  ```
- Fillets and chamfers close to the largest radius that fits succeed where they raised; a failing
  one takes up to twice as long (the second attempt). `Box(20, 20, 20).fillet(all, 9.98)` raised
  `ModelingError`; now 4201.352. `tests/test_guards.py::test_fillet_close_to_the_limit_is_refused`
  (and its TS twin) checks 4.98 and 9.98 instead of expecting the error.
- `shell` with a planar opening whose rim meets its neighbours tangentially returns the shell
  instead of raising `ModelingError` (0.5.0) or returning a body with an open rim (0.4.0):
  ```python
  b = Box(60, 40, 20); b = b.fillet(b.edges(), 5)
  b.shell(2, b.faces().planar().top())   # 0.4.0: an open rim, gaps 0.27; 0.5.0: ModelingError; now 11134.3949
  ```
  Its walls run out to an edge at the rim (the inner rounds end tangentially there); for a rim of
  full wall thickness, round only the edges that do not meet the opening, or shell first.
- `offset(x, d)` raises `TypeError` ("offset takes a part, a sketch, a sheet (Shell) or a face, not a
  ...") for objects without an offset, where it raised `AttributeError` (smlibwasm: `TypeError` with
  that text); sheets and faces are offset instead of raising.

- `offset` of a part with acute convex edges returns the sharp offset where it raised
  `ModelingError` ("it built a body that reaches out of the box it must fit in"); a sharp result is
  refused only beyond the reach of the part's edges and corners.
- The sharp offset's kernel error has a hint ("offset failed (SM_ERR)" became "offset failed
  (SM_ERR): try a smaller distance, or corners="round", ..."); scripts that match the text should
  match the status (`e.status == "SM_ERR"`).
- `offset(part, d, corners=...)` passes `corners` to the part (it raised `TypeError: ... unexpected
  keyword argument 'corners'`; smlibwasm: `TypeError: Part.offset() got an unexpected option
  'corners' (it takes no options)`). For a sheet or a face smlibwasm's error now names
  `Shell.offset()`.
- Chamfers of full circles between coaxial faces are exact cones: their faces are `"revolution"`
  (were `"bspline"`), their volumes move by up to 1.2e-5 (to the exact value), and their edges are
  circles (were B-splines), so `edges().circles()` now finds them. Scripts that found chamfer faces
  or edges by their type:
  ```python
  pin = Cylinder(2, 5).chamfer(Cylinder(2, 5).edges(), 1)
  pin.faces().filter(lambda f: f.geom_type == "bspline")      # before: the two bevels; now: none
  pin.faces().filter(lambda f: f.geom_type == "revolution")   # now: the two bevels
  pin.edges().circles()                                       # before: none; now: all 4 bevel edges
  pin.edges().circles().filter(lambda e: e.radius < 2)        # now: the bevels' inner circles (r 1)
  ```
  Volumes pinned to the fitted value change (the flange example 157979.6230 -> 157979.6668; the
  chamfer of all edges of `Box(40, 30, 20) - Cylinder(5, 40)` 22221.0369 -> 22221.0267). Tests
  adjusted: `tests/test_measure.py` and `js/test/measure.test.ts` (flange),
  `tests/test_lane_FO.py::test_sm_api_global_merge_stays_off` and its twin (the kernel now bevels
  only the box's edges there), `tests/test_modeling.py::test_cells_of_parts_whose_faces_meet_within_a_tolerance`
  and its twin (a pin with G2 rounds keeps the faces that meet within a tolerance it is about),
  `tests/test_js_options.py` and `js/test/options.test.ts` (`Part.offset` takes `corners`).

- `info()` of a body made by `shell` or `offset` has one more key, `"corners"`. Scripts that compare
  the whole dictionary:
  ```python
  shelled = Box(40, 30, 10).shell(2)
  assert shelled.info() == {"type": "Part", "faces": 12, ...}       # before; now fails on "corners"
  assert {k: v for k, v in shelled.info().items() if k != "corners"} == {"type": "Part", "faces": 12, ...}
  ```
  The default `shell` (no `corners`) builds what it built before.
- `operations.shell` (the function) passes `corners` and `walls` on; smlibwasm's `_options.ts` lists
  them for `Part.shell` and `shell` (an unknown option still throws `TypeError`).

## Not done

- The extended offset mode still crashes on some imported parts, contained by the forked copy
  (smlibwasm: the probe worker), all located: crescendo part 52 (24 of 40 processes of raw calls):
  `ImprintIntersections` goes on after `SmBrep::MakeEdgeInFaceWithVU` has connected only the start
  of a closed Edge, and the sectoring of its end Vertex reads the missing Vertex in
  `SmEdgeuse::CreateUVTrimCurve` (address 0x98; AddressSanitizer reproduces it in 14 of 20
  perturbed runs). Guarding that read moved the crash on (6 of 40, in
  `SmTopologyTraverser::CollectFaces` on the half-made Edge), so it was not kept: the fix belongs
  in the imprint, which should fail the Boolean when an Edge is left half-made (a change of the
  kernel's "keep pushing on" in `ImprintIntersections` and `IntersectInsertRelate`, whose effect
  on the Booleans that recover today needs its own measurement). Crescendo parts 81 and 19 read a
  null pointer in `SmBezierAux2d::BuildPolarBox` (about half of the runs of part 81), not
  investigated further here.
- The `SmSurface.cpp` patch has no repository test: its only known input is an imported part that
  is not in the repository, and no synthetic part tried (pins with cone tips and chamfers, a hex
  bar, a knurled pin) reached the path.
- The Brep 2 branch of the `Imprint` patch (the copy of the curve and the UV curve of Brep 2) is
  the same ownership rule from code reading; its owned-curve case was not seen in the runs
  measured.
- F7's kernel patch K5 (SM_API asks for global merge before `SetFilletParameters`, which turns it
  off) is not landed: measured with the request moved after it, the near-limit cubes and the
  stepped block's rollover came out as before, and the chamfer and G2 round (1 mm) of all edges of
  `Box(40, 30, 20) - Cylinder(5, 40)` became open bodies. The near-limit cause was the approximation
  tolerance (above). `tests/test_lane_FO.py::test_sm_api_global_merge_stays_off` pins those two.
  The stepped block's rollover (r 1.5 and 3 on a 1 mm step) still fails ("unable to process
  rollover" or a corner), with either tolerance, as does r 4.99 on a 10 mm cube.
- F8: the executive's fillet status (`SmFilStatus`) is private in `SmFilletErrorInfo` (no getter), so
  the record has the kind of problem, the corner type, the place and the comment, but not the
  status. Laws along chains (F4, F5) and the constant-distance solver can go through the same
  wrapper (mitred corners do since F10; setbacks, below, cannot yet).
- F9: unequal bevels of edges whose face angle changes along them are refused like equal ones (F4);
  on faces meeting at an acute angle the kernel's solver offsets one face backwards where the
  setbacks are less alike than the cosine of the angle, and it takes that only so far (60 degrees: 3
  and 1 work, 4 and 1 raise `ModelingError` saying so).
- O3: openings with a tangent rim that are curved, lie next to another opening or to a wall that is
  not at right angles to them (a drafted wall would leave a sliver) still go to the kernel and raise
  `ModelingError` with the hint; outward walls take the route only where the whole rim is tangent (a
  straight wall would keep a lip over the rim). The optional kernel change in the tangent-sector
  branch of `SmOffsetExecutive` (a cap face) was not attempted.
- O7: a sheet whose faces do not share their edges offsets face by face (documented: `stitch` first).
  The plan's bbox bound `d / sin(alpha/2)` is replaced by the distance checks, which also catch faces
  left unmoved and offsets to the wrong side.
- F10 setbacks (`setback=`): the kernel's set-back corners read freed memory in every case tried
  (`SmCurveClassification::MergeInterval`, from `SmFilletCorner::InsertIntersectionTopology`, which
  merges a fillet edge's own curve while `sm_SetDoFilletingGeometry` replaces and deletes it; the
  kernel's own test case 303 too). A patched copy of `SmFilletCorner.cpp` that merges a copy of the
  curve stopped the crash (AddressSanitizer clean) but every body came out open (a 20 mm cube, all
  edges r 1, setback 1.25: 84 open edges, 4 of 6 planes gone; an L-block and a hexagonal prism the
  same; r 2 with setback 3 `SM_ERR`). Not landed; recorded in `third_party/patches/README.md`
  (defects that remain). The patched copy is in the lane's scratch (`b3/SmFilletCorner.setback-uaf.cpp`).
- F11 `Part.fillet_preview` (optional in the plan): not added. SM_API's preview is documented as
  crashing for some inputs, so it would need the forked copy (smlibwasm: the probe worker) and a way
  to bring surfaces back from it, and it gives the untrimmed round surfaces only; the fillet errors
  already name the corner or edge that fails.
- F12 for edges that are not full circles between coaxial faces (arcs of a rounded outline, circles
  on spheres or tori, straight edges between curved faces): those bevels are still the kernel's
  fitted B-splines.
- O9: `Shell.offset` has no `corners` (the kernel's plain mode on sheets returned a multi-face sheet's
  faces unmoved, O7). `shell` still picks its mode by what succeeds unless `corners=` is given (O12:
  the default stays as it was; it now says which).
- O10: `move_faces` and `offset_faces` refuse parts with a cavity: `SmBrep::LocalOperation` drops a
  solid's inner shells (edited or not) and reports success. Only `shell(walls=)` of a closed shell
  works around it (it edits the cavity as a body and cuts it out). `draft` has the same defect: a part
  with a cavity raises "the drafted faces change which faces of the part meet ...; use a smaller angle",
  which names the wrong cause (not changed here; `draft.py` belongs to the molding code).
- O10: faces around the edited ones that the kernel extends can change their kind: the vertical rounds
  of a box whose top is pulled up come back as surfaces of extrusion (exact, but `faces().cylinders()`
  no longer finds them), a cone extended past its end as a B-spline face (its volume within 6e-8).
  `SmCylinder::IsNurbSurfaceCylinder`, `MakeExactBSplineIfPossible` and `CopyAndAddAnalytics` all leave
  such an extended round as it is (rational, degree 2 by 1, 7 by 2 control points); turning it back
  would need a new cylinder with the face's trims rebuilt. Not done.
- O10: edits that change which faces meet (a face pushed past another, a face that vanishes) are
  refused, as the kernel cannot add or remove faces there; use a Boolean. `move_faces` does not take
  tangent neighbours along on its own (a rigid move of a chain can reach far, e.g. through a rounded
  rim into the top face and every hole rounded into it); it names them. The plan's per-face neutral
  planes for drafts (stepped parting lines, O11) are not added: the recipe covers planar parting lines,
  as the plan asks.

