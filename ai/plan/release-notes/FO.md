# Lane FO: tangent chains in fillets and chamfers (F6), the extended offset mode's crash on filleted boxes (O1)

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
