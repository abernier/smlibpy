# Close-out F: fillets, chamfers, shell and offset

The "Not done" entries of area F of 0.5.0 (kernel plan F7 to F12, O3, O7, O9 to O11), triaged and
closed out. Tests: `tests/test_closeout_F.py` and `js/test/closeout_F.test.ts` (15 each).

## Triage

| Entry | Triage |
|---|---|
| F7: SM_API's global merge (K5) not landed; all edges of a 10 mm cube with r 4.99 and the stepped block's rollover fail | BLOCKED |
| F8: the fillet executive's status is private | FINISH |
| F9: unequal bevels on sharp wedges beyond what the solver takes | FINISH (straight edges between planes, as the plan's Do proposed); the rest BLOCKED |
| F10: setbacks (set-back corners read freed memory; a patched SmFilletCorner gave open bodies) | FINISH (`fillet(setback=)`; the read of freed memory and a leak of N-sided corner patches patched); corners where a face turns inward, and between slanted faces, BLOCKED |
| F11: `fillet_preview` (optional in the plan) | FINISH |
| F12: exact bevels of edges that are not full circles | LATER |
| F12: the edge where a conical chamfer meets a cylinder is fitted | FINISH |
| F5/F8: radius laws along whole chains of edges | FINISH (open runs, single closed edges); closed runs of several edges BLOCKED |
| O3: tangent-rim openings next to another opening | FINISH (next to an ordinary opening); two such openings that meet LATER |
| O3: tangent-rim openings that are curved, or next to a drafted wall | LATER |
| O7: sheets whose faces do not share edges offset face by face | FINISH |
| O9: `Shell.offset` has no `corners` | LATER |
| O10: `move_faces` and `offset_faces` refuse parts with a cavity | FINISH |
| O10: `draft` of a part with a cavity raises a misleading message | FINISH (such drafts work) |
| O10: extended rounds come back as surfaces of extrusion | FINISH |
| O10: `move_faces` and `offset_faces` cannot change which faces meet | LATER |
| O11: per-face neutral planes for stepped parting lines | LATER |

## Finished

- **Set-back corners (F10): `Part.fillet(edges, radius, *, setback=None)`**, smlibwasm `fillet(edges,
  radius, { setback })`. The rounds stop `setback` from the corner along each of its edges and one
  larger patch joins them (a softer corner than the ball, as on molded and consumer parts): all edges
  of a 20 mm cube r 2 with `setback=3`: 7781.609270, valid, its 12 rounds 14 long, 6 patch faces a
  corner (ball corners: 7804.696111). Set back are the corners where three or more rounded edges
  meet and no other edge, all convex (a box's outside corners) or all concave (a pocket's floor
  corners); the other corners keep their patch. Checked before the kernel: a corner to set back, a
  setback beyond where the rounds cross the corner's edges (the radius at a right-angled corner; r
  tan(theta/2) / sin(phi) in general) and below each such edge's length (half of it with both ends
  set back), constant radii (also lists and blends), not with `corners="mitre"` (`ValueError`); after
  it, the gaps between faces and the volume (with a set-back corner's share). The kernel's set-back
  corners failed on `SmApiCreateBox`'s boxes and every body tried, also with 0.5.0's patch for their
  read of freed memory, while its own test box worked: the merge needs each edge's first edgeuse to
  be the one that runs along it, and `ext.round_edges(setback=)` reorders the edgeuses first
  (`SmEdge::ResetPrimaryEdgeuse`; nothing else changes); `ext.round_edges` returns `set_back`, the
  number of corners set back. 240 random parts (boxes with pockets and bosses, prisms of 3 to 8 sides,
  a box with a cylinder) rounded with random radii and setbacks: no crash, 126 valid results, the
  rest refused (`ValueError` before the kernel, `KernelError`/`ModelingError` after). The N-sided
  corner patches lost the copies of their boundaries' UV curves
  (`SmBSplineSurface::CreateCornerBlend`, patched: `SmBSplineSurfaceNLib.cpp`; LeakSanitizer 20.7 kB
  in the set-back tests before, 0 after); that also concerns corners of five or more rounded edges.
  `corners="mitre"` found its corners by vertex wrappers whose identity Python can hand to the next
  vertex once one is dropped, and could skip a corner (a wrong "the selection has none"); both
  corner styles now go by the vertex's point.
- **Radius laws along runs of edges (F5, F8).** A `(start, end)` radius runs linearly along each
  run of selected edges that meet tangentially, a single edge or a chain such as the top run of a
  plate rounded at two corners (which `propagate` adds), in proportion to the length along it: the
  way of the run's first selected edge, from the end of the run that way begins. A dict
  `{position: radius}` sets the radius at positions along each run (0 its start, 1 its end; a
  missing end takes the radius given nearest it, around a closed edge nearest around it) and joins
  them smoothly without overshooting (flat at the ends and at each largest and smallest radius),
  also around a single closed edge such as a rim. smlibwasm: `{ start, end }` as before, and a
  `Map` of positions to radii. `ext.round_edges` spreads one law over each chain
  (`SmFilletExecutive::CreateSequenceOfLaws`, `SmBSplineFilletLaw` through the points; `chains`,
  `law_at`, `law_radii`). A box with two vertical edges rounded by 5, its 5-edge top run with
  `(1, 3)`: 11795.8763, the radius 1.02 near its start, 3.0 at its end, linear in between (0.5.0:
  `ValueError`; in 0.4 the radius ran 1.07 -> 2.93, 2.46 -> 1.04, 1.65 -> 1.99 -> 1.07 along its
  pieces). A rim of `Cylinder(10, 20)` with `{0: 1, 0.5: 3}`: 1, 2.0, 3, 2.0, 1 around it.
- **The step a fillet failed at (F8).** `ext.round_edges` returns the executive's status as
  `"stage"` (`"rail_edge"`, `"surface_intersection"`, `"solver"`, `"tracing"`, ...: it is private to
  `SmFilletErrorInfo`, and read through a pointer to the member), and fillet and chamfer errors say
  it in words: `(unable to process rollover: a side of the round does not reach the edge it should
  end on)`.
- **Unequal bevels on sharp wedges (F9).** Where the faces of an edge meet at an acute angle and the
  setbacks are less alike than its cosine, one face's offset runs backwards farther than the
  kernel's solver takes; a straight edge between planes whose ends lie on planes at right angles to
  it is then bevelled by cutting the bevel's prism along it, checked to take exactly its triangle
  times the edge's length (the 60 degree edge of a triangular prism with 4 and 1, 6 and 1, 8 and
  0.5: exact; 0.5.0 raised `ModelingError`). The kernel bevels the other edges of the selection.
- **Exact circles where conical bevels meet cylinders (F12).** The bevels of full circles between
  coaxial faces are cones (0.5.0); their edges on a cylinder or cone, which the kernel's
  intersection fitted (8e-6 short on a pin of radius 2), are exact circles now (`ext.exact_circles`,
  also for two coaxial cones or cylinders and for a plane across a cone, cylinder or sphere).
- **`Part.fillet_preview(edges, radius, *, propagate=True)` (F11)**, smlibwasm `filletPreview`: the
  surfaces of a circular fillet's rounds as sheets, one per edge, untrimmed, without changing the
  part (the kernel's `SmApiFilletPreview`, bound by hand in smlibwasm; in another process for parts
  read from files, as fillets). 100 random Boolean parts previewed without a crash.
- **Face edits and drafts of parts with cavities (O10).** `SmBrep::LocalOperation` drops cavities:
  `move_faces`, `offset_faces` and `draft` now edit the solid inside the part's
  outside and the solids inside its cavities' walls apart, each with the selected faces it has (a
  cavity's faces face the other way: a positive offset moves them into the cavity, a positive draft
  of its walls widens them along the pull direction), and cut the cavities out again, checked to
  take what they should. A box 40 x 30 x 20 with a 10 mm cavity: top +2 gives 25400 (0.5.0:
  `ModelingError`), the cavity's top offset by 1 gives 23100, its walls drafted by 3 degrees
  24000 less the drafted cavity. A part with a body inside a cavity is refused with its own message.
- **Extended faces keep their cylinders and cones (O10).** The faces around edited ones that
  `LocalOperation` extends came back as surfaces of extrusion (cylinders) or B-splines (cones); they
  get their cylinder or cone back, its parameters widened over the face, where they still lie on it
  (within 1e-6 of the size), in a copy that replaces the result unless its edges then leave the
  faces. A box with rounded vertical edges, top offset by 5: four cylinders of radius 3 (0.5.0: four
  surfaces of extrusion); a cone hole offset past its end: one cone, its rims circles, the volume
  exact (13694.272626297588; 0.5.0 13694.2727253527, 7e-9 off).
- **Sheets of separate faces offset as one (O7).** `Shell.offset` sews faces that touch along edges
  they do not share (within 1e-7 of the size) before the offset, where that turns no face: an open
  box of five separate faces offset by -1 gives 1692.0 (0.5.0: `ModelingError`, "it built no
  faces"). Faces apart from the others, or whose normals disagree with their neighbours', still move
  each on its own.
- **A tangent-rim shell opening next to an ordinary opening (O3).** A planar opening whose rim
  meets its neighbours tangentially is cut out of the part shelled with the other openings also
  where it meets another opening that the kernel opens (its cavity face then reaches that opening's
  plane): a box with rounded vertical and bottom edges, top and +x side open: 9869.8523 (0.5.0:
  `ModelingError`).

## Blocked

- **F7: all edges of a 10 mm cube with r 4.99; the stepped block's rollover.** The kernel's corner
  patch fails there in every way tried: `ext.round_edges` with the approximation tolerance at 4, 2,
  1, 0.5, 0.25 and 0.1 times the edge tolerance gives a 14-face body with gaps of 3.6 (r 4.99) and
  a 16-face one (r 4.992), while r 4.985 and 4.995 are exact; mitred corners fail ("could not compute
  the vertices of the corner"); rounding the vertical edges first and the top and bottom runs after
  would need a torus of major radius 0 (refused before the kernel). SM_API's global merge (K5) was
  measured in 0.5.0 and changed nothing near the limit; nor did the edgeuse order that fixed the
  set-back corners (r 4.98, 4.99, 4.992 and 4.995: the same bodies, with both solver settings). The
  rollover (r 1.5 on a 1 mm step) fails in the corner computation ("Corner Edge Computation
  Failure", `Nx1`). smlibpy refuses both with `ModelingError`/`KernelError`; nothing wrong comes back.
- **F10: set-back corners where a face turns inward at the vertex, and between slanted faces.**
  `SmFilletConcaveNxNCorner` (a face with a corner over 180 degrees at the vertex: a pocket's rim, an
  L-block's inner corner) hands set-back corners to the convex corner's code, which builds broken
  bodies there (a box with a cube pocket, all edges r 1 setback 1.5: `is_valid()` false, a volume of
  754292 for 3458); smlibpy sets back only the corners of all convex or all concave edges, which the
  kernel classifies as convex. Corners between slanted faces (a ruled frustum 20 to 10 over 10, r 1,
  setbacks 2 to 5; a wedge with a ridge, setback 5) come out with gaps up to 5.9 or fail in the corner
  computation: the result check refuses them (`KernelError` with the setback hint). Radius laws with
  set-back corners crashed (SIGSEGV in the executive): refused (`ValueError`, and
  `std::invalid_argument` in `ext.round_edges`). How the first set-back failure was found and fixed,
  for the record: AddressSanitizer confirms the read of freed memory: `sm_SetDoFilletingGeometry`
  deletes the curve `SmCurveClassification::MergeInterval` is classifying (the corner merges a fillet
  edge's own curve into its faces). Patched (`third_party/patches/SMLib/src/SmCurveClass.cpp`: the
  classification takes the old curve over and frees it when done): AddressSanitizer reports nothing
  after, for all edges of a 20 mm cube with r 1 and setback 1.25 (the kernel's own test case,
  `smFilletTest.cpp` 303), r 2 and setback 3, and a 10 mm cube with r 1 and setback 1.5, with the
  test's solver settings and SM_API's (a program of its own against the ASan kernel; one report
  each before). The merge then fails in `SmTopologyIntersector::Relate` (a vertex or edge already
  mated to another; `SM_ERR` from `MergeCurveOnSurfaces` in `InsertIntersectionTopology`, the fillet
  half merged: 7 faces, 25 open edges). 0.5.0's attempt, merging a copy of the curve, gave open
  bodies (84 open edges). The kernel's own test box (`box.smb`) merged with the same settings (168
  edges, 66 faces, closed); the difference was the order of each edge's edgeuses (above). Ruled out
  on the way: plane or B-spline surfaces, line or B-spline UV curves, the lines' parameter range,
  rounding, tolerances, the naturally-trimmed flag, the edges' directions, placement and the order
  the edges are loaded in.
- **Radius laws around closed runs of several edges.** Around the top outline of a rounded plate
  (8 edges) any varying law gives a body with an extra face that is open (19 faces, `is_valid()`
  false, the executive reporting success), also `{0: 2, 0.5: 2.01}`, also with the law repeating a
  turn before and after so that both ends read the same radii and slopes, and whatever edge the
  sequence starts at (begun at a line, the closing corner fails outright, "Corner Edge Computation
  Failure"; begun at an arc, with the law's parts moved along, it builds the broken body), also with
  the edgeuses reordered as for set-back corners (all 8 starting edges: the same). Constant laws are
  right. smlibpy refuses varying laws there (`ValueError`); around a single closed edge and
  along open runs they are right.
- **F9 beyond straight edges between planes.** The kernel's solver offsets each face by its own
  distance and the backwards one only so far; a bevel of a curved edge, or of a straight edge whose
  end lies on a slanted face or where another bevelled edge ends, cannot be composed as a prism cut
  (the prism would leave or take material at the ends). These raise `ModelingError` as in 0.5.0.

## Later

- **Exact bevels of edges that are not full circles (F12).** The plan's Do was to correct the
  accuracy statement (exact cones were "more than small work"); full circles went beyond it in
  0.5.0. Arcs, ellipses and B-spline edges keep the kernel's fitted bevels (within about 1e-6 mm).
- **Tangent-rim openings that are curved, next to a drafted wall, or two that meet (O3).** The Do
  restricted the cut-out route to planar openings with smooth rims (drafted walls leave a sliver);
  two cut-out openings that meet would leave the wall along their common edge, and need a cut of
  their own. These raise `ModelingError` with the shell-first advice.
- **`Shell.offset(corners=...)` (O9).** O9's Do was `Part.offset(corners=)`, which 0.5.0 has; the
  kernel's rounded mode returns inward offsets of sheets unchanged (an open cup at -1: 33 faces,
  area 1200, the input's), so a sheet option needs checks of its own.
- **Face edits that change which faces meet (O10).** The Do was push-pull, hole and boss resizes over
  `SmBrep::LocalOperation`, which moves faces within the part's topology; an edit that makes a face
  vanish or run into another needs the faces intersected again (a Boolean). Such edits raise
  `ModelingError` ("the offset faces do not close the part again ...", or "... edges leave its
  faces ..."): a step's top offset by 7 past the part's top, and by exactly 5 to lie flush with it,
  are refused; 4.999 gives 5999.8, exact.
- **Per-face neutral planes for stepped parting lines (O11).** The Do was the recipe for planar
  parting lines (in 0.5.0); stepped ones need a draft call with a neutral plane per face group.

## Behaviour changes

- `Part.fillet` takes `setback=` (keyword, default `None`: no change), smlibwasm `fillet`'s options
  `setback`; `ext.round_edges` takes `setback` (trailing, default 0) and returns `"set_back"`.

- `fillet(edges, (start, end))` where the selected edges run into each other tangentially, or where
  `propagate` adds edges, runs the radius along the whole run (it raised `ValueError`). For the law
  on the selected edge alone:

  ```python
  part.fillet(edge, (1, 3), propagate=False)     # 0.5.0's per-edge law (a run-on may then fail)
  ```

  ```js
  part.fillet(edge, { start: 1, end: 3 }, { propagate: false })
  ```

  On closed runs and closed edges a `(start, end)` radius still raises `ValueError`, with a new
  message (`... cannot run around a closed edge (through ...)` / `... a closed run of edges ...`).
- `move_faces`, `offset_faces` and `draft` of parts with cavities return the edited
  part (they raised `ModelingError` "the part has a cavity"; a draft "the drafted faces change which
  faces of the part meet"). A part with a body inside a cavity raises `ModelingError: ... the part
  has a body inside a cavity ...; edit the parts one by one (part.solids())`. For 0.5.0's refusal:

  ```python
  if part.info()["voids"]:
      raise ModelingError("edit the part without its cavities")
  ```

- Faces that face edits extend are cylinders and cones (`geom_type` `"cylinder"`/`"cone"`, they
  were `"extrusion"`/`"bspline"`), so `faces().cylinders()` finds them; volumes move to the exact
  value (by up to 7e-9 of it).
- The edges where a conical bevel meets a cylinder or cone are circles (`geom_type` `"circle"`, they
  were `"bspline"`); select by shape where both can occur:

  ```python
  rims = pin.edges().filter_by(lambda e: e.is_closed)     # 0.5.0 and now
  ```

- Unequal chamfers of straight sharp-wedge edges between planes with square ends succeed (they
  raised `ModelingError`).
- `Shell.offset` of a sheet whose faces touch along edges they do not share joins them first: the
  result's faces meet (they moved each on its own, or the kernel built no faces). For 0.5.0's face
  by face offset, offset the faces one by one:

  ```python
  pieces = [f.offset(d) for f in sheet.faces()]
  ```

- A tangent-rim shell opening next to an ordinary opening succeeds (it raised `ModelingError`).
- Fillet and chamfer errors can carry the failed step after the executive's comment:
  `(unable to process rollover: a side of the round does not reach the edge it should end on)`;
  match on the start of the message rather than the whole of it.
- `ext.round_edges` takes `chains`, `law_at` and `law_radii` (trailing, with defaults) and returns
  `"stage"`; smlibwasm's `ext.round_edges` takes them the same way (calls without them keep working:
  `ext` fills in the defaults; only the module's own `ext__round_edges` has three more parameters).
