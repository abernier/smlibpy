# Lane FO: fillets, chamfers, shells and offsets (F6, F7, F8, F9, O1, O3, O7)

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
  status. Laws along chains (F4, F5), setbacks and mitred corners (F10) and the constant-distance
  solver go through the same wrapper later; not part of this batch.
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
