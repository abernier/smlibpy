# Close-out U: surfaces, deformation, sheet metal and measuring

Triage of lane U's entries in the "Not done" section of `release-notes-0.5.0.md` (U2, U3, U4, U6,
U7/U8, U9/U10, U12, the measuring gaps, D1, D2, D3, D5, D6). Branch `fix/kf-U`; tests in
`tests/test_closeout_U.py` and `js/test/closeout_U.test.ts`.

## Finished

- **`Part.section` lies on B-spline faces** (measuring, a defect). The kernel's plane section
  (`intersect_brep_with_plane`, `SmApiIntersectBrepWithPlane`) passes no tolerance to
  `SmBrep::CreatePlanarSectionCurves`, which then fits each curve within a thousandth of its face's
  size: up to 2.1e-3 off a B-spline sheet 30 x 20 and 1.5e-2 off a part thickened from it.
  `Part.section` asks for 1e-7 of the part's size now (`ext.plane_section`, src/cpp/measuring.cpp):
  3e-6 off that part, in 5 to 10 ms. Asked for 1e-6 to 1e-10 of the size, the curves are 3.7e-5 to
  3.6e-9 off.
- **`distance_to` and `closest_point` of a point find the nearest point of a folded B-spline face**
  (measuring, a defect). The kernel's closest point stopped at a local minimum where a face folds
  back towards the point (a sheet fitted around 288 degrees of a tube: 5.83 where it is 5.71; 28 of
  1500 points of the cloud). `Part/Shell.distance_to(point)`, `closest_point`, `Face.distance_to`
  and `Face.closest_point` start from the kernel's point and search every face, and every knot span
  of its surface, that could hold a nearer one (by the box of the span's control points), by
  Newton's method from the nearest points of a grid over it, then the edges of those faces
  (`ext.nearest_point`, src/cpp/distance.cpp); `surface(report=True)` measures the same way. Over
  215 points of that cloud, none is farther than a 300 x 300 sampling of the surface (the kernel:
  5, up to 0.245 farther). Planes, cylinders, cones, spheres and tori keep the kernel's closed-form
  answer.
- **`raycast` hits beside a seam** (measuring, a defect, fixed in the kernel:
  `third_party/patches/SMLib/src/SmEllipse.cpp`). `SmPolarConversion::ConvertToPolarParameter`
  asked `STEPInversion` for the angle with the context's zone tolerance, so every parameter within
  about 1e-7 of the end of a cylinder's, cone's, sphere's, torus' or surface of revolution's domain
  evaluated to the seam itself (y = -2.4e-15 for -9.0e-8), and the kernel's ray and curve
  intersections missed the hits beside it: `Cylinder(10, 40).raycast((88.98, -1e-8, 4), (-1, 0,
  0))` gave only the far side (also 0.4.0). Rays at y = +-1e-12 to +-1e-3 beside the seams of a
  cylinder, cone, sphere and torus hit every face now (82 rays each).
- **A hole wholly inside a bend zone unfolds into a valid part** (D5, a defect). The kernel's fit of
  such a hole wall (two circles and a seam; `SmFace::ApproximateWithBSpline`) grew the domain by a
  sixteenth on every side, the face's trims fell onto the wrong end, and its area came out 2.6
  instead of 113: the unfolded part was not `is_valid()`. Such faces are fitted keeping the
  original's parameters now (deform.cpp's fit, `fit_surface_keeping_parameters`, wired into
  src/cpp/sheetmetal.cpp), their trims built once the edges have their final curves: the unfolded
  part is valid, its volume the blank's to 5e-13, the hole walls 1.6e-13 off their circles (they
  were the kernel's 1e-4 fits), in 0.17 s.
- **K-factor records in `.smp` files** (D1). A part folded with `fold`/`flange` keeps each bend's
  axis, inside radius and K-factor in `.smp` files (an attribute of smlibpy's, like the name and
  color; `to_smp`, `save(..., ".smp")`, `from_smp`, `load`), so a part read back unfolds as it was
  folded (200 x 40 for the 0.33 / 0.45 part; it was 200.314 at the default 0.44). Both languages;
  ASCII and binary. `.smb` (one body without name or color) and STEP do not hold them: pass
  `k_factor=` when unfolding a part read from those.
- **`blend` of two closed edges** (U2). The rims of two tubes (full circles, closed loops, B-spline
  rims) are bridged all round: each point of `edge_a` joins the point of `edge_b` at the same
  fraction of its length, counted from its point nearest `edge_a`'s start and running the same way
  round. The blend is two faces sewn along two seams (the kernel offsets no face that closes
  around), as smooth across them as elsewhere (1e-6 degrees), tangent to both sheets (4e-6 degrees
  between tubes r 10 and r 6), its rims within 2.5e-8 of the edges; it thickens alone and sewn to
  both sheets (`join=True`). A closed and an open edge are refused (`ValueError: blend: one edge is
  closed ...`).
- **Trimming with curves that run past a sheet's border or across a hole** (U3). `Shell.trim` and
  `Face.split` raised where a curve ran on past the border of a B-spline sheet (off its surface);
  the curve is cut where it leaves the faces and where it comes back now (src/cpp/trim.cpp), so a
  curve extended past both borders trims exactly as the curve across (to 1e-9), and a line across
  a hole splits the sheet into two pieces whose areas add up to the sheet's.

## Blocked

## Later

- `Shell.trim` along a direction (U3): the plan's "Do" asks `Shell.trim(curve, keep=point|'split')`;
  projecting the outline first (`sheet.project(curve, direction)`, then `trim`) does it, as the
  docs show.

## Behaviour changes

- `Part.section` of parts with B-spline faces: the section's curves are fitted within 1e-7 of the
  part's size (they were within a thousandth of each face's size), so areas and edge counts of such
  sections can differ slightly (by up to about 1e-3 relative on thickened sheets).
- `distance_to(point)` and `closest_point(point)` of bodies and faces with B-spline faces can give
  a smaller distance (the right one) where the kernel's stopped at a local minimum; they take
  longer on such bodies (a thickened B-spline sheet: about 30 ms instead of 0.2 ms).
- The kernel's Booleans that converged on a point beside a seam can come out differently: the
  cut of a tool beside an earlier hole in a sphere fails in the kernel instead of returning an empty
  body; smlibpy's retry gives the same right result as before. No other result of the suites
  changed.
- `blend` of two closed edges returns a two-face sheet instead of raising; a closed and an open
  edge raise `ValueError: blend: one edge is closed ...` (was `blend: closed edges ...`).

  ```python
  # 0.4 / before: split the tube so that its rim has two ends
  # now:
  neck = blend(wide_tube_rim, narrow_tube_rim, join=True)
  ```
