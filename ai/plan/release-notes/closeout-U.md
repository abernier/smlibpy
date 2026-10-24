# Close-out U: surfaces, deformation, sheet metal and measuring

Triage of lane U's entries in the "Not done" section of `release-notes-0.5.0.md` (U2, U3, U4, U6,
U7/U8, U9/U10, U12, the measuring gaps, D1, D2, D3, D5, D6). Branch `fix/kf-U`; tests in
`tests/test_closeout_U.py` and `js/test/closeout_U.test.ts` (14 tests in each language), one existing
test adapted (`test_guards.py` / `guards.test.ts`, the empty-cut guard; see Behaviour changes).

## Finished

- **`Part.section` lies on B-spline faces** (measuring, a defect). The kernel's plane section
  (`intersect_brep_with_plane`, `SmApiIntersectBrepWithPlane`) passes no tolerance to
  `SmBrep::CreatePlanarSectionCurves`, which then fits each curve within a thousandth of its face's
  size: up to 2.1e-3 off a B-spline sheet 30 x 20 and 1.5e-2 off a part thickened from it, whose
  section areas came out up to 0.13 % too large (207.266 for 207.006). `Part.section` asks for 1e-7
  of the part's size now (`ext.plane_section`, src/cpp/measuring.cpp, both builds): 3e-6 off that
  part, in 5 to 10 ms. Asked for 1e-6 to 1e-10 of the size, the curves are 3.7e-5 to 3.6e-9 off.
- **`distance_to` and `closest_point` of a point find the nearest point of a folded B-spline face**
  (measuring, a defect). The kernel's closest point stops at a local minimum where a face folds back
  towards the point (a sheet fitted around 288 degrees of a tube: 5.83 where it is 5.71; 28 of the
  cloud's 1500 points). `Part/Shell/Sketch.distance_to(point)`, `closest_point`,
  `Face.distance_to(point)` and `Face.closest_point` start from the kernel's point and search every
  face, and every knot span of its surface, that could hold a nearer one (by the box of the span's
  control points): Newton's method from the nearest points of a grid over it, where a cheap descent
  on the surface first finds a nearer point, then the edges of those faces (`ext.nearest_point`,
  src/cpp/distance.cpp); `surface(report=True)` measures the same way. Over 215 points of that cloud
  none is farther than a 300 x 300 sampling of the surface (the kernel: 5, up to 0.245 farther).
  Planes, cylinders, cones, spheres and tori keep the kernel's closed-form answer (a box: 0.01 ms as
  before); a part thickened from a B-spline sheet takes about 2 ms (the kernel's 0.2 ms).
- **`raycast` hits beside a seam** (measuring, a defect, fixed in the kernel:
  `third_party/patches/SMLib/src/SmEllipse.cpp`, recorded in `third_party/patches/README.md`).
  `SmPolarConversion::ConvertToPolarParameter` asked `STEPInversion` for the angle with the context's
  zone tolerance, so every parameter within about 1e-7 of the end of a cylinder's, cone's, sphere's,
  torus' or surface of revolution's domain evaluated to the seam itself (y = -2.4e-15 for -9.0e-8),
  and the kernel's ray and curve intersections missed the hits beside it:
  `Cylinder(10, 40).raycast((88.98, -1e-8, 4), (-1, 0, 0))` gave only the far side (also 0.4.0).
  Rays at y = +-1e-12 to +-1e-3 beside the seams of a cylinder, cone, sphere and torus hit every face
  now (82 rays each).
- **A hole wholly inside a bend zone unfolds into a valid part** (D5, a defect). The kernel's fit of
  such a hole wall (two circles and a seam; `SmFace::ApproximateWithBSpline`) grew the domain by a
  sixteenth on every side, the face's trims fell onto the wrong end, and its area came out 2.6
  instead of 113: the unfolded part was not `is_valid()` ("open between its faces"). Such faces are
  fitted keeping the original's parameters (deform.cpp's fit, `fit_surface_keeping_parameters`, now
  wired into src/cpp/sheetmetal.cpp), their trims built once the edges have their final curves: the
  unfolded part is valid, its volume the blank's to 5e-13, the hole walls 1.7e-12 off their circles.
- **The faces of a bend zone are the exact bend** (D5, the plan's optional refit). Every face the
  kernel's bend or unbend maps (hole walls, slanted cutout walls) is fitted the same way, on its own
  knots within 1e-6 (exact where it can be: the round and straight walls measured), with the
  kernel's 1e-4 fit only as the fallback. The slanted walls of a square hole in an R20 bend come back
  from a fold and an unfold to 3e-14 (were 1.6e-6 off, area 23.99998 for 24); a 100 x 40 x 2 plate
  with a hole r 5 across a bend unfolds to the blank's volume, 7842.9204 (was 7842.9195). It is
  faster too: 0.02 s instead of 0.04 s to unfold the square hole, 0.05 s instead of 0.17 s the holes
  inside the bend.
- **K-factor records in `.smp` files** (D1). A part folded with `fold`/`flange` keeps each bend's
  axis, inside radius and K-factor in `.smp` files (an attribute of smlibpy's next to the name and
  color; `to_smp`, `save(..., "x.smp")`, `from_smp`, `load`), so a part read back unfolds as it was
  folded: 200 x 40 for a blank folded at R1 with 0.33 and at R6 with 0.45 (it was 200.314, the
  default 0.44 everywhere), `bends()` reports 0.33 and 0.45. Both languages, ASCII and binary;
  records of a length other than 8 numbers each are refused.
- **`blend` of two closed edges** (U2). The rims of two tubes (full circles, closed loops, B-spline
  rims) are bridged all round: each point of `edge_a` joins the point of `edge_b` at the same
  fraction of its length, counted from its point nearest `edge_a`'s start and running the same way
  round. Both rails become cubic interpolants of the same knots through points at equal steps of
  their lengths, run on an eighth round past their starts; the blend skinned along them is cut back
  to once round in two faces (the kernel offsets no face that closes around), sewn along two seams.
  Between tubes r 10 and r 6: area 1033.631, tangent to both tubes to 4e-6 degrees, its rims within
  2.5e-8 of the circles, smooth across its seams (1e-6 degrees); it thickens by 1 and by -1, alone and
  sewn to both tubes (`join=True`); the same to a lofted sheet's elliptic rim at G1, G2 and G3, and
  between rims that run opposite ways or lie off each other's axis. A closed and an open edge are
  refused (`ValueError: blend: one edge is closed ...`). Docs: docs/surfaces.md, the skill's
  surfaces/blend.
- **Trimming with curves that run past a sheet's border or across a hole** (U3). `Shell.trim` and
  `Face.split` raised where a curve ran on past the border of a B-spline sheet (off its surface);
  the curve is cut where it leaves the faces and where it comes back now (src/cpp/trim.cpp), so a
  curve extended past both borders trims exactly as the curve across (to 1e-9), and a line across a
  hole splits the sheet into two pieces whose areas add up to the sheet's.
- **Knot removal after a warp or a flattening** (U8, the plan's 1e-6 of the size). `warp` and
  `flatten` add the change on knots of its own; the result now loses the knots it does not need
  within 1e-6 of the size (`SmBSplineSurface::RemoveKnots`, then measured against the exact sum on a
  65 x 65 grid and at the knots, and kept only where every edge of the face stays on it): a box's top
  flattened has 21 x 21 control points instead of 39 x 39, warped with `"G1"` 22 x 22 instead of
  23 x 23, with `"crease"` 23 x 23 instead of 25 x 25 (`"G2"` and a cylinder's rational warp keep
  theirs: nothing is removable within 1e-6). On a bumpy sheet a removal would have moved an edge by
  2.2e-5: the full surface is kept there.
- **The point map of each deformation** (D6). `twist`, `taper`, `bend` and `unroll` map a point and a
  list of points with the same arguments as a body, and `Lattice.map` maps one; the images of a
  body's vertices lie on the deformed body (to 1e-9, tested for all five). No separate `map_point`
  name: the deformation functions are the point maps.
- Docs that said otherwise: `docs/kernel.md` (the plane section, the closest point, the seam
  evaluation; the open item removed), `docs/sheet-metal.md` and the skill's sheetmetal/fold and
  sheetmetal/generic (bend-zone faces), the skill's surfaces/warp and surfaces/flatten (knots), the
  docstrings of `fill` (N-sided fills tangent to about 1.4 degrees only) and `match_edge` (the crease
  across side edges) in both languages.

## Blocked

- **`fill` tangent to sheets that stand steep to the loop** (U4: a cylinder's wall around its open
  top, a sphere cut at its equator). Refused with `ModelingError` ("folds back"), not a wrong
  result. Tried: the kernel's corner blend as a Coons patch (the closed rim cut into four) and as
  its N-sided fill (the rim in five and in six arcs, each an edge of its own sheet): all fold back
  over the wall; so does the sphere cut at its equator. A four-sided patch over a smooth closed loop
  has both parameter directions along the loop at its corners, so it cannot be tangent to a wall
  standing at 90 degrees there; a cap needs a construction of its own (a dome), which neither of the
  kernel's tangent fills is.
- **N-sided fills (five sides and more) are tangent to about 1.4 degrees only** (U4). The kernel's
  N-sided corner blend (`SmBSplineSurface::CreateCornerBlend`, `N_FillNSidedHole`) approximates the
  cross tangents between a side's middle and its ends. Tried on a pentagon hole in a paraboloid
  sheet: its angle tolerance 0.25 down to 0.01 degrees and its approximation tolerance 1e-5 down to
  1e-7 of the size give 1.346 to 1.348 degrees every time (phase 1: more knots on the boundaries
  changed nothing either). `fill` checks the angle (at most 2 degrees for five sides and more, else
  `ModelingError`), and its docstrings and the docs now say so. Exact tangency needs patches built
  outside the kernel (a centre, curves to each side's middle, Coons patches with shared cross
  tangents).
- **Three-sided tangent fills have a pole** (U4). The kernel's corner blend shrinks a fourth side to
  a point; the kernel's offset of such a patch does not finish (`thicken` stops at the guard's 20 s).
  Tried: the longest side cut at its middle, so that the Coons patch has four sides of length and
  one straight corner: the offset then fails at once (`SM_ERR`), exactly as for the four-sided cap
  of a closed loop (a sphere's cap: `thicken` fails too), and the patch meets the sheet at 0.06
  degrees instead of 1e-4. Kept as it was; the sewn sheet (`stitch(sheet, patch)`) is a valid part.
- **K-factor records in `.smb` files** (D1). The kernel's body writer (`SmApiWriteBrepToFile`,
  `SmBrep::WriteToFile`) writes no attributes: the record attached to the body, to a face, an edge
  and a vertex before writing came back on none of them. `.smb` holds one body without name or
  color for the same reason; write `.smp` to keep the K-factors (or pass `k_factor=` when unfolding a
  part read from `.smb`).

## Later

- **`Shell.trim` along a direction** (U3): the plan's "Do" asks `Shell.trim(curve, keep=point|'split')`;
  projecting the outline first (`sheet.project(curve, direction)`, then `trim`) does it, as the docs
  show.
- **`fill` of mixed loops with `tangent=True`** (U4): the plan's `fill(edges, tangent=True)` takes
  edges of sheets; free sides would need cross tangents of their own (the kernel's corner blend
  allows a side without a sheet only where it has no length). Refused with `ValueError`; pass
  `tangent=False`, or make sheets of the free curves first.
- **`Face.extend` keeps no trims; sheets of several faces are not extended** (U6): the plan's
  `Face.extended(d, sides=, continuity=)`, `Shell.extend` and `Face.untrimmed()` exist and grow a
  face's surface (documented: trims are dropped); keeping holes and slanted borders, and growing a
  sewn sheet past its free edges (each face's extension trimmed against its neighbours' at the
  corners, then sewn), are new operations. B12, the plan's use, extends one-face sheets.
- **Pushes at edges and seams** (U7): the plan's `push_face` checks every edge's distance and "refines
  or raises"; a push that would move an edge, or that crosses a cylinder's or sphere's seam, raises.
  Moving edges with the face, or pushing across a seam (a periodic change), is beyond it.
- **`flatten(side=)`** (U8): not in the plan's "Do"; NLib's side test moves the control points on
  that side, not the part of the face on that side (on a bumpy sheet it pushed points below the plane
  further down), and a face's height clipped at the plane is not a spline.
- **`Shell.bead`** (U8): the plan's "later bead".
- **Tangency across `match_edge`'s side edges, `stitch(match=True)`** (U9): the plan's "Do" asks
  `Shell.match_edge(edge, target, extent=)` with the adjacent edges and vertices rebuilt, which it
  does; keeping a neighbouring face tangent across a side edge means editing that face's rows along
  it too (compatible knots across faces), and `stitch(match=True)` is not in the "Do". The crease is
  documented now (10 to 20 degrees; merge faces first to keep a sheet smooth).
- **`stitch(merge=True)`, `Part.merge_faces`** (U10): the plan's "Do" is `Shell.merge_faces(a, b)`.
- **The face-to-face fillet with base trimming** (U12): the plan's "a face-to-face fillet later".
- **Torus and sphere images of deformations** (D2): a bent tube is a torus in the bend, but its face
  has a seam, and SMLib's torus has its minor circle's seam at the outer equator (`SmTorus`'s analytic
  domain lies within 0 to 360 degrees), so a new torus would put the seam elsewhere than the face's;
  keeping such faces analytic needs the deformed face's seam moved first (`SmFace::MoveSeam`), new
  candidate surfaces and their checks. The fitted faces are within the tolerance; the plan's
  recognition (planes, cylinders, cones, unmoved faces) is done.
- **Rolled parts and end bends spanning only part of the width** (D3): the plan's "Do" asks to unroll
  bodies without a flat region and bends over 180 degrees "and document the limits", which is done;
  unrolling a bend that has sheet beside it along its axis (the bend zone ending inside the sheet) is
  a new case for the unbend piece.
- **K-factor records in STEP files** (D1): STEP has no entity for them; a property scheme of
  smlibpy's own would be read by smlibpy only.

## Behaviour changes

- `Part.section` of parts with B-spline faces: the curves lie on the faces within 1e-7 of the part's
  size, so section areas and lengths change where the kernel's were off (0.13 % on a thickened
  sheet: 207.006 instead of 207.266).
- `distance_to(point)` and `closest_point(point)` of bodies and faces with B-spline faces can be
  smaller (the right value) where the kernel's stopped at a local minimum, and take longer on such
  bodies (about 2 ms for a thickened B-spline sheet instead of 0.2 ms).
- The kernel's evaluation beside a seam is right now (`SmEllipse.cpp`): Booleans that converged on a
  point there can come out differently. The one change in either suite: the cut of a tool beside an
  earlier hole in a sphere, which the kernel returned empty (and its intersection as the whole
  part), fails in the kernel now; smlibpy's retry with a NURBS copy gives the same right results as
  before (28160.608 and 929.188). The guard test checks the guard on those former answers directly.
- `blend` of two closed edges returns a sheet of two faces instead of raising; a closed and an open
  edge raise `ValueError: blend: one edge is closed ...` (was `blend: closed edges ...`).

  ```python
  # before: split the tubes so that their rims had two ends
  neck = blend(wide_rim, narrow_rim, join=True)   # now: bridged all round, sewn to both tubes
  ```
- A part read from an `.smp` file unfolds with the K-factors it was folded with (it took the default
  0.44 before):

  ```python
  part = load("bracket.smp")
  flat_pattern(part)                    # now: the recorded K-factors per bend
  flat_pattern(part, k_factor=0.44)     # the former result
  ```
- `warp` and `flatten` return faces with fewer control points (within 1e-6 of the size of the exact
  sum; the edges where they were).
- The faces of bend zones are other B-splines (on their own knots, exact where they can be): volumes
  of folded parts with holes in a bend zone change in the tenth digit (35383.54583 instead of
  35383.54580), unfolded ones are the blank's.
