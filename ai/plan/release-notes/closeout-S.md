# Close-out S: sweeps, lofts, primitives and curves

The "Not done" entries of area S of 0.5.0 (kernel plan S1 to S3, S7, S8, S10, S12 to S14, C4, C7,
C8, C12, C15, C16), triaged and closed out. Tests: `tests/test_closeout_S.py` (21) and
`js/test/closeout_S.test.ts` (18); `tests/test_modeling.py` and `js/test/modeling.test.ts` (the
kinked loops' rectangles, see Behaviour changes) and `tests/test_lane_S.py`, `js/test/lane_S.test.ts`
(the mitered spline path, the closing warning) adjusted.

## Triage

| Entry | Triage |
|---|---|
| S1: one of 60 hard kinked loops sweeps natively but not in smlibwasm | BLOCKED |
| S2: no `anchor=` for sweeps | FINISH |
| S2: asymmetric profiles on mitered paths with splines sit by their box along the path's plane | FINISH |
| S2: the kernel's anchor uses control-polygon boxes: arcs that do not span whole quadrants sit a little off | FINISH (kernel patch) |
| S3: no option for the kernel's rolling frame | LATER |
| S3: `up="frenet"` spins where a path nearly straightens | FINISH (a clear `ValueError`; it was a confusing one) |
| S3: the helix default covers fitted helices only | LATER |
| S3: a twist along a closed path with corners is not made to meet | FINISH |
| S7: mitered planar paths take no `up`, `twist` or `scale` | LATER |
| S7: a scale law along a path not parameterized by length is exact at 65 points only | FINISH |
| S8: translational arc sweeps keep B-spline walls | LATER |
| S8: oblique translational extrusions keep B-spline walls | FINISH |
| S8: `extrude(taper=...)` ignores `direction` | FINISH |
| S10: no rails, no `sweep(rails=)` | FINISH (open sections and open profiles); closed sections and profiles along rails LATER |
| S10: no spine | LATER |
| S10: end tangency comes from a direction, not a face | FINISH |
| S12: swing faces are B-splines, about Z only | LATER |
| S13: `Torus` has no angles around the tube, no `Pyramid` | FINISH |
| S14: 16 of 1200 random extrusions near tilted planes raise | FINISH |
| C4: sweeps along helices of more than about 60 turns fail | FINISH |
| C7: no offset of curves that are not planar | LATER |
| C7: a closing corner at the seam of a closed single edge raises | FINISH (and the other side returned the rounding arc alone: a wrong result) |
| C7: offsets that would cusp are refused, not trimmed | LATER |
| C8: `fit_curve` with a direction at every point and a tolerance | FINISH |
| C12: `Face.wrap` keeps lengths along two parameter lines only | LATER |
| C12: curves across a closed face's seam come back cut | FINISH |
| C12: `nearest=True` samples 17 points a piece | FINISH (it missed thin obstacles: a wrong result) |
| C15: non-planar wires round only between lines | LATER |
| C16: `Edge.through` is local | LATER |
| C16: no `Wire.match_to` | LATER |

## Finished

- **`sweep(anchor=)` (S2)**, smlibwasm `sweep(profile, path, { anchor })`, also `Sketch.sweep`:
  the point of the profile that goes on the path, and that `scale` scales about: `"center"` (the
  default, the center of its box along the axes of its plane, as before), `"origin"` (the origin of
  the sketch's plane: (0, 0) of a `Polygon` or `Profile` drawn on XY; for a face, a wire or an edge
  the point (0, 0, 0)) or a point (a tuple or a `Vertex`) of the profile's plane (`ValueError` off
  it). On every route: single lines and arcs (extrusions, revolves), 3D paths, helices, mitered
  planar paths, open profiles (surfaces). An L-section drawn by its inner corner follows the path
  by that corner: `sweep(ell, Line((0, 0, 0), (0, 0, 50)), anchor="origin")` spans (-1, -1, 0) to
  (6, 5, 50).
- **The kernel's sweep anchor patched (S2).** `SmPrimitiveCreation.cpp` (new
  `smlibpy_SetSweepProfileReference`, set for one call by `ext.curve_sweep(reference=)` and the new
  `ext.planar_path_sweep(profile, path, reference)`): `CreateCurveSweep` and
  `CreateSweepAlongPlanarPath` put the point given on the path in place of the middle of the box of
  the profile curves' control points, which is larger than the curves where an arc does not span
  whole quadrants. An 80-degree sector of radius 10 (two lines and an arc) sat 0.0211 off its box
  center along a spline and a mitered path, 0.075 along a 3D polyline: 0 now (vertex distances
  5, 6.956691, 6.956691 on every route). The mitered planar path no longer offsets the path to make
  up for the kernel's anchor, so a profile on a mitered path with a spline among its edges sits by
  its own box too (it warned and sat by its box along the path's plane). Not a memory defect; README
  row in `third_party/patches/README.md`.
- **Loops with corners meet where they close (S3).** Round a closed path with corners that does not
  lie in a plane, the profile carried by the smallest turns comes back turned about the path (the
  rotation the loop's corners add up to); that turn is spread evenly along the length, as along a
  closed path without corners, so the profile meets itself at the closing corner. Before, it turned
  by all of it there: 8.5064, 5.7148 and 29.7502 degrees round three 3D polygons
  (`Polyline((0, 0, 0), (40, 0, 0), (40, 30, 25), (10, 40, -10), close=True)` and two more); now
  the profile turns by its share between the middles of the first and last edges and by the rest at
  the corner (the shares match the lengths to 1e-4 degrees). Loops closed with a kink
  (`Spline(*pts, pts[0])`) too; where the halves so turned do not fuse, the sweep tries them split
  at 0.4 and 0.6, then sweeps with the kernel's frame and warns ("could not be made to meet itself
  where the loop closes").
- **A clear error where the profile would spin (S3).** `up="frenet"` near a point where the path
  nearly straightens (and `up=` near a point where the path nearly runs along it) turned the profile
  by half a turn within a ten-thousandth of the path; the frame's samples were doubled without end
  and the sweep failed with `oriented_sweep: give two or more parameters and an x axis (3 numbers)
  for each`. After 8 doublings it raises `ValueError: sweep: the profile would spin about the path
  at (-9.99862, 0.00572769, 9.42305): it turns by 52 degrees within 0.00409 of it (the path nearly
  straightens there, and up='frenet' follows its principal normal round; pick up= a direction)`.
- **Scale laws along the length (S7).** The kernel reads its scale curve at the path's parameters;
  the curve was a cubic through 65 points evenly along the length, and the law was off between them
  where the parameter runs unevenly. The points are doubled (up to 257) while the cubic is more than
  1e-7 of the scale off the law half way between them. `Circle(1)` along a spline through
  unevenly spaced points with `scale=(1, 3)`: radius within 1.3e-6 of the law at every section (was
  1.2e-3), volume within 3.5e-9 of pi L 13/3 (was 5.6e-6).
- **Taper and direction (S8).** `extrude(taper=..., direction=...)` takes the direction only along
  the sketch normal, either way (`direction=(0, 0, -1)` tapers downwards); a direction across it
  raises `ValueError` ("a taper drafts the walls about the sketch normal"). It was ignored. A taper on
  an open curve raises `ValueError`; it was ignored too.
- **Plane walls of oblique extrusions (S8).** The walls that straight edges sweep along a direction
  across the normal, which the kernel makes as flat B-spline surfaces, are planes (new
  `ext.planar_faces`, both builds: flat B-spline faces whose control points lie within 1e-9 of the
  size of one plane become `SmPlane`s, their trims built again, kept where the part stays valid and of
  its volume). `Rectangle(6, 4).extrude(5, direction=(1, 0, 1))`: six planes (two were B-splines).
- **Extrusions near tilted planes (S14).** Where the turned extrusions fail too, the profile is swept
  along the line (the kernel's translational sweep, each loop capped, holes cut), checked against the
  volume. Of the review's 1200 random extrusions near tilted planes 16 raised at each angle from 0.6
  degrees down to a sine of 1.05e-5 (four planes); 1200 of 1200 are valid with the exact volume now.
- **Lofts along rails and sweeps along two rails (S10).** `loft(sections, rails=...)` (smlibwasm
  `{ rails }`) for open sections: one curve or several, each running from the first section to the
  last and crossing every section once; the surface (a `Shell`) passes through the rails exactly, as
  through the sections: a Gordon surface (new `ext.gordon`, both builds, on NLib's
  `N_CreateGordonSrf`), the network first made to cross at common parameters (each section at the
  same parameter of every rail and the other way round, smoothly between; the kernel's own
  adjustment, `CreateGordonSurface`, left a rail 0.29 off its surface). Rails may run on past the
  first and last section and either way; where no rail runs along the sections' starts or ends the
  border there runs smoothly through them; a corner in a section or a rail raises `ModelingError`
  ("must be smooth curves"). Arcs between two splines: rails and sections within 1e-7 of the
  surface. `sweep(profile, path, rails=rail)` (smlibwasm `{ rails }`) sweeps an open profile that
  runs from the path to a second rail: moved, turned and scaled the same in every direction so that
  its ends stay on both, the frame turning with the line from the path to the rail and the rails'
  mean direction, the rails matched by the fraction of their lengths; the surface through the profile
  placed at more and more points (8 to 256) until it is within 1e-6 of the size of the profile placed
  half way between, and through both rails exactly. A hood arc between two splines: rails within
  9.2e-8, the profile within 4.1e-8; parallel straight rails give area = profile length x 30 to 1e-7.
  Not with `orient`, `translational`, `sharp_corners`, `up`, `twist`, `scale` or `anchor`
  (`ValueError`).
- **Lofts tangent to faces (S10).** `start_tangent` and `end_tangent` take a face that ends at the
  section (the section lies on it): the loft continues it, tangent to it all along the section, and
  runs into it at the end (`ext.skin(start_face=, end_face=)`: the derivative strip moves each control
  point of the section along the direction that continues the face, fitted by an affine map of the
  point where the field is one, as on planes, cylinders, cones and spheres about the section: then
  exact; measured afterwards: within 1e-6 radians there, 1e-3 on others). A neck on a can's rim
  continuing its wall: 4264.351743 (the same as `start_tangent=Z`); a funnel into a plate's bore
  equals `end_tangent=Z`; a neck on a spline vase's rim: normals within 1.2e-6 degrees of the vase's
  along the rim. The side of the face is found by the distance to the trimmed face on either side; the
  first take (the surface's closest point classified) chose the wrong side at the face's seam, and an
  end tangent face ran 180 degrees off (found by the close-out tests). A section off the face raises
  `ValueError` ("must lie on it").
- **`Torus(minor_start_angle=, minor_end_angle=)` and `Pyramid` (S13)**, smlibwasm
  `Torus(R, r, { minorStartAngle, minorEndAngle })` and `Pyramid(length, width, height, { align })`.
  The part of the tube's circle between the two angles (degrees, as build123d takes them: from the
  side away from the axis towards +Z), a slice from the circle's center revolved: torus, planes,
  cylinders and cones (the upper half 4934.802201 = 2 pi R pi r^2 / 2; the outer half a bead on a
  cylinder); with `major_angle` too. `Pyramid`: the kernel's pyramid scaled to the width, five planes,
  volume l w h / 3, centered by its box.
- **Long helix sweeps with the kernel's frame (C4).** NLib places at most about 1000 sections along a
  path, so a sweep with the kernel's own frame (`orient=False`) failed along more than some 60 turns
  of a helix; an edge the kernel cannot sweep so is swept in 2, 4 or 8 pieces of equal length, the
  frame carried from one to the next, fused (where the profile fits the path's curvature). 80 turns:
  valid, volume within 8.6e-5 (the kernel's approximation); 100 and 150 turns within 4e-6. Sweeps
  with the default frame went along 400 turns already.
- **Offsets of closed edges with a corner (C7).** `Edge.offset` of a closed edge with a corner where
  it starts and ends (`Spline(*pts, pts[0])`) is one closed edge both ways: rounded at the corner where
  the offset pulls it apart (it returned the rounding arc alone, 1.18 long), cut where its sides cross
  where it pushes them together (it raised "split it there first"). The four points (0, 0), (20, 0),
  (25, 15), (5, 20): 88.155147 at +1, 75.427285 at -1, 1 from the edge everywhere within 1e-4.
- **`fit_curve` with a direction at every point (C8)**, smlibwasm `fitCurve(points, { tangents })`:
  `tangents` as many as the points (none None) gives the curve through the points along them with its
  knots removed within the tolerance (new `ext.approximate_tangents`, both builds: the interpolant of
  points and tangents, then knot removal; the end tangents kept). 400 points of a sine with headings:
  36 control points within 0.05 (0.031), 60 within 0.005 (0.0025, headings within 0.042 degrees).
- **Curves across seams (C12).** `Face.project` projects a curve across a closed face's seam in
  pieces that do not cross it and joins them (the kernel gave nothing: `[]`, now one edge of 8.85288);
  `Face.wrap` and `Part.project` join the pieces a seam cut apart (a line across a cylinder's seam:
  one edge of 40, was two of 20; a circle: one closed edge of 10 pi, was three pieces; `nearest=True`
  across the seam: one edge of 11.21102, was two halves).
- **`project(nearest=True)` finds thin obstacles (C12).** Each piece is checked between every two
  places where its projection crosses an edge or a silhouette of the body seen along the direction
  (the kernel's hidden-line curves, projected), not only at 17 samples: a bridge 1 wide over a plate
  100 long cuts the plate's piece at 2.5 and 3.5 (it came back whole, under the bridge too).

## Blocked

- **S1: the 60 hard kinked loops do not all come out the same natively and in smlibwasm.** Which of
  the fallbacks for a loop closed with a kink goes (the halves fused, split at 0.4, 0.6, 0.3, 0.7,
  the round profile's seam turned) depends on rounding inside the kernel's fuse of the halves. Tried:
  12 more tries (`_SEAM_SPLITS` with the seam turned by 45 degrees either way): 2 more of 30 loops go
  in both builds; a native build with fused multiply-adds turned off (`-ffp-contract=off`, which
  smlibwasm effectively is): it still differs from smlibwasm on 4 of 60 loops (different ones), so
  the difference is not FMA alone (smlibwasm has its own libm too). At 5c7666f 41 of the 60 built and
  1 differed. Re-measured at this commit (circles of radius 2 along the fixer's 30 + 30 loops, the same
  in both builds): 49 build in smlibwasm, 48 natively plus one that crashed (below; with lane K1's
  patch it gives smlibwasm's body, 1620.7215), and 4 differ, 2 each way (fx1 15 and fx2 10 build only
  natively, fx2 12 and fx2 23 only in smlibwasm). A loop that fails raises `ModelingError` or
  `KernelError` in that build; none gives a wrong body. Two loops (fx1 9, fx2 17) crash the native
  process now and then, at 5c7666f too (fx1 9: 4 of 6 runs): AddressSanitizer shows reads of freed
  memory in `SmProtoTopologyManager::UpdateFaces` (`SmProtoTopology.cpp:5825` and `:5724`, from
  `SmEdgeDefinition::Imprint` in the Boolean of the halves). Lane K1's patch of `SmProtoTopology.cpp`
  (its commit ffb80d9) removes both: with it compiled in, 3 of 3 runs of each are clean under
  AddressSanitizer (fx1 9 raises `ModelingError`, fx2 17 builds, 1620.7215). So the merge must bring
  K1's patch; nothing in this lane's files changes for it.

## Later

- **S3: an option for the kernel's rolling frame.** The plan's Do for S3 asked for `up=` (an axis or
  `"frenet"`) and `twist=`; the kernel's own frame stays reachable as `orient=False`/`translational`
  and as the fallback, not as a named mode.
- **S3: the helix default for curves only near a helix.** The Do: the helix axis by default along
  helix paths. Paths that are helices to within 1e-5 of their size get it (Helix edges, chains, conical
  ones, splines through 64 points a turn); a spline through 8 to 32 points a turn is 0.09 to 2.5e-4
  off a helix radially and keeps the rotation-minimizing frame. Treating near-helices as helices is a
  new heuristic.
- **S7: mitered planar paths with `up`, `twist` or `scale`.** The kernel's planar-path sweep keeps its
  frame and the profile's size; with these options a planar path goes piece by piece (the default) and
  `sharp_corners=True` raises `ValueError`. Mitered corners of a twisted or scaled profile would need a
  sweep of its own.
- **S8: translational sweeps along arcs with analytic walls.** S8's Do turned single lines into
  extrusions and single arcs into revolves (`orient=True`); a translational sweep along an arc is
  neither, and its exact B-spline walls (the kernel's translational sweep is exact) would be surfaces
  of extrusion of the arc at best.
- **S10: a spine, and closed sections or profiles along rails.** The proposal (Do) of S10 named rails
  and two-rail sweeps, which the corrected scope places with open-section skins; a Gordon surface is
  open both ways, and through closed sections it had a crease where they are joined round (22 degrees;
  11 with the network run on round past the seam), so closed sections along rails raise `ValueError`
  until a periodic construction is written.
- **S12: swing with analytic faces, about other axes.** `swing()` (S12's Do) is exact with B-spline
  faces; analytic faces and other axes are new options.
- **C7: offsets of curves that are not planar, and trimmed cusps.** The Do asked for planar
  `Edge.offset`/`Wire.offset`; a 3D curve has no side to offset to without a surface or a direction.
  Offsets that would fold over raise `ModelingError` saying where (the smallest radius of curvature);
  trimming the loops is a new mode.
- **C12: `Face.wrap` keeping all lengths.** The Do asked for wrapping by lifting from UV; on planes,
  cylinders and other faces whose parameter lines keep their lengths the whole drawing keeps its size,
  and no map keeps all lengths on a doubly curved face.
- **C15: rounding arc and spline corners of non-planar wires.** C15's Do: raise for named corners that
  cannot be rounded, round line-arc corners of planar wires; non-planar wires round between lines and
  raise a clear `ModelingError` at other corners.
- **C16: a global `Edge.through`, `Wire.match_to`.** The Do asked for the minimum-norm move of
  `Edge.through` (local by design: it moves the control points near the point) and `Edge.match`;
  a whole-curve edit and a wire version are new.

## Behaviour changes

- `extrude(..., taper=t, direction=d)`: `d` must run along the sketch normal (either way); across it
  raises `ValueError` (it was ignored: the taper went along the normal). `direction` against the normal
  now tapers that way. A taper on an open curve raises `ValueError` (it was ignored). Migration:

  ```python
  Rectangle(10, 10).extrude(10, taper=5, direction=(1, 0, 1))   # 0.4: the direction was ignored
  Rectangle(10, 10).extrude(10, taper=5)                        # 0.5: the same solid
  extrude(Line((0, 0), (10, 0)), 5, taper=3)                    # 0.4: a plain surface
  extrude(Line((0, 0), (10, 0)), 5)                             # 0.5: the same surface
  ```
- A profile whose curves' control polygons reach past the curves (arcs that do not span whole
  quadrants, some splines) sits on the path by the center of its own box: it moves by up to 0.075 for
  an 80-degree sector of radius 10. On a mitered planar path with a spline among the edges an
  asymmetric profile sits by its own box (no warning; it sat by its box along the path's plane).
  Nothing to migrate; `anchor=` places it otherwise.
- Round a non-planar closed path with corners (a 3D `Polyline(..., close=True)`, a loop closed with a
  kink), a profile that is not round turns gradually along the path instead of all at the closing
  corner: volumes change slightly (the kinked loops of the tests: 543.404104 to 543.395580 and
  477.647314 to 477.122125, `Rectangle(4, 1)`). To keep the old attitude, sweep the loop open (as two
  paths) or give `up=`.
- `up="frenet"` (and `up=` a direction) raise `ValueError` ("would spin about the path") where the
  profile would turn half a turn within a ten-thousandth of the path; that raised a confusing
  `ValueError` from the oriented sweep before. Pick `up=` a direction there.
- Scale laws along paths whose parameter runs unevenly follow the length more closely (radius within
  1.3e-6 instead of 1.2e-3): volumes change in the sixth digit.
- Extrusions along a direction across the normal have plane walls where the profile has straight edges
  (`faces().planes()` finds them; STEP writes planes), and near tilted planes some that raised now
  come back (swept along a line).
- `Edge.offset` of a closed edge with a corner where it starts and ends returns the whole closed offset
  edge (0.4 and 0.5.0 returned only the rounding arc at +d and raised at -d).
- `Face.project`, `Face.wrap` and `Part.project` return one edge where a closed face's seam cut a piece
  in two (fewer edges than before); `project(nearest=True)` returns more pieces where thin parts of the
  body hide parts of others. Code that indexed the pieces should select them by position.
- `fit_curve(points, tangents=[...])` with as many directions as points (more than two) fits along
  them; it raised `ValueError` ("for a direction at every point use Spline"). The error for a closed
  curve with tangents reads "a closed curve takes no end tangents, nor a direction at every point".
- `loft(start_tangent=, end_tangent=)` take a face (or a `ShapeList` of one face) besides a direction.
