# Lane S: sweeps, revolves, tapers and lofts (S1 regressions, S2 rest, S3, S4, S6, S7, S8, S9, S10, S11)

## Fixed

- Circles sweep along smoothly closed 3D fillet polylines again (S1-REG-A). The halves of the
  edges joined into one curve made the kernel's sweep fail (`SM_ERR`) for most of them: 49 of 60
  random closed `FilletPolyline`s that swept before (wasm: 39 -> 8 of 40). A round profile along
  a closed path of several tangent edges is now swept in one go and closed where its ends meet,
  as other profiles are: 60 of 60, volume = area x length to 2e-7 (`sweep(Circle(2),
  FilletPolyline((0, 0, 0), (30, 0, 0), (30, 30, 10), (0, 30, 0), radius=6, close=True))`:
  1410.9417, 8 faces). A single smoothly closed edge (`Spline(..., closed=True)`) still goes in two
  halves with round profiles (exact; in one go it came out up to 5e-5 short).
- Loops closed with a kink (`Spline(*pts, pts[0])`) sweep wherever they swept before 0.5.0, and
  more (S1-REG-B). Where the profile carried along the halves fails (the fuse where the ends cross,
  or a result with faces that cannot be cleaned, see below), the path is swept the way it was before
  0.5.0 (the same kernel calls: the halves each turned afresh, the kernel's anchor, fused) where
  that puts the profile on the path, and a round profile is also tried with its seam turned about
  its center (10 angles) and, on a single kinked edge, split at 0.4 and 0.6 of its length instead
  of halfway: all give the same body. Circles of radius 1.5 along the verifier's 60 random loops:
  60 build in Python and in the wasm (origin/next 37 and 35, 0.5.0 before this 39); the 9 loops
  that origin/next built and 0.5.0 refused build. The fixer's harder loops with `Circle(2)`: 41 of
  60 (origin/next 26, two of them crashing the process). Python and the wasm agree on all 60 of the
  verifier's loops (origin/next differed on 6, 0.5.0 on 5 of 40) and on 59 of the fixer's 60.
- The fuse of the halves of a kinked loop no longer crashes the process: `SmMerge::ManifoldBoolean`
  went on marking a vertex that `CloseIntersectionLoop` had deleted before it failed (a read of
  freed memory, AddressSanitizer). Patched (`third_party/patches/SMLib/src/SmMerge.cpp`, README
  row); those fuses raise `KernelError` now. 2 of 60 random loops with circles, and one with a
  rectangle, crashed origin/next.
- Fused and stitched sweeps have no faces without area and no extra shells (S1-REG-C). The fuse
  where the halves of a kinked loop meet left faces of no area where the end caps and both tubes
  meet at a point (24 of 37 circle sweeps of the verifier's loops on origin/next, 28 of 39 before
  this), sometimes one such face as a shell of its own: the plan's loop K2 ((20 cos a, 20 sin a,
  6 sin 2a), `Circle(2)`) was written to STEP as a solid with a void, which OpenCASCADE read with
  volume -1707.27. Such faces are taken out and the faces around them stitched together again
  (`ext.remove_slivers`, new C++ in `src/cpp/slivers.cpp`, both builds); the result is checked
  (valid with its gaps measured, one shell, the same volume to 1e-6, no such face left), and
  otherwise the next way is tried or the sweep raises. Every body returned for 120 random kinked
  loops and 20 closed fillet polylines (309 sweeps of circles, ellipses and rectangles) reads back
  from STEP into OpenCASCADE as one valid solid of our volume; K2 builds (4 faces, one shell,
  1707.2749; OpenCASCADE 1707.2739).
- Fused sweeps are checked as `is_valid()` checks (the gaps between faces measured): a circle along
  one of the fixer's loops came back "valid" by the coarse check but open between its faces
  (volume uncertain by 1.6e-2); it now goes the next way (and builds).
- Planar paths of several edges with mitered corners work in any plane (S2+). The kernel's
  planar-path sweep frames each edge with the world's Z axis, so in a plane that is not horizontal
  the mitered pieces did not meet: any path in the YZ plane, a triangle on an XZ path that turns
  back, and every oblique plane raised "not a closed, manifold solid" (each of 18 random 3-point
  polylines with a rectangle, also on origin/next). The path is now swept in a frame of its own
  (its plane horizontal, its start along X) with the profile turned as on any other path, and the
  body placed back: rectangles give area x length on all of them. Of 110 sweeps along 11 planar
  paths (axis-aligned and diagonal, polylines and fillet polylines, 5 profiles), the 80 that built
  before give the same bodies, the 28 that raised build, and the asymmetric triangle on the
  diagonal path moved onto its own anchor (1.06 along Z, the same volume). With
  `translational=True` (or `orient=False`), which the kernel's planar sweep never honoured, the
  profile is turned the way the kernel turned it in the world's frame: the 82 of 110 that built
  give the same bodies, 28 more build. Python and the wasm give the same 220 bodies.
- Asymmetric profiles sit on mitered planar paths by the center of their own box (S2+), as on all
  other paths. The kernel anchors the profile by its box along the axes it is turned to; for a
  profile turned off the path plane's axes (a path in the XY plane that does not start along X or
  Y) the path is moved by the difference: along its normal, and to the side by its offset curve,
  which is exact for lines and arcs (corners recomputed where the offset edges meet). The
  triangle (0, 0), (6, 0), (1, 4) along a path starting at 30 degrees sat 0.25 off; now on the path
  (open and closed polylines and fillet polylines).- Profiles keep their attitude along helices (S3, `ai/todo/features.md` 10): the kernel's sweep
  carries its frame along the path by the smallest turn, so a profile rolled about a helix by some
  30 degrees a turn. Along a helix (also a conical one, and a chain of helices) the profile now
  keeps its attitude to the helix's axis: `sweep(Rectangle(2, 1), Helix(pitch=5, height=30,
  radius=10))` measures 2.0001 x 1.0039 (radial x axial; the band cut at its slope) at every
  section in the YZ and XZ planes, where it measured 1.34 to 2.23 by 1.25 to 2.22; volume 756.3655
  (2 x length 756.3642). Along `Helix(5, 30, 10, end_radius=5)` the rectangle ends 1.6 degrees off
  radial (the path runs inwards there), where it ended 61 degrees off. Python and the wasm give the
  same sections.
- Sweeps along long helices keep their volume: NLib places the sweep's sections where a polyline
  follows the path, at most 1000 a piece with the tolerance raised tenfold until then, so the two
  30-turn pieces of `Helix.md`'s long spring got 7 sections a turn and `Rectangle(0.6, 0.3)` along
  them came out 0.74 % short (336.96 with this lane's first batch; origin/next raised, see below);
  now 339.4631, area x length. Every sweep that sets the profile's attitude (helices,
  `up=`, `twist=`) places a section for every 1/64 of a turn of the profile's x axis (at the
  fastest rate it turns anywhere along the path). Circles along helices: `Circle(0.3)` along that
  chain 533.2274 (pi 0.09 x length 533.2275; was 533.2244), `Circle(1.2)` along `Helix(pitch=6,
  height=48, radius=10)` 2284.2966 (exactly; was 2284.2930).
- Chains of helices with an even number of turns a piece are not taken for planar paths (S6): the
  planarity test sampled points along the path, which lay in a plane for pieces of 16 turns (and of
  8, 24, ...); the sweep went to the mitered planar sweep and raised a misleading "the profile may
  be too large for the path's corners". Planarity now comes from the curves' control points (a
  NURBS curve lies in a plane exactly where they do): `sweep(Rectangle(0.6, 0.3), Wire([Helix(1,
  16, 5), Helix(1, 16, 5, center=(0, 0, 16))]))` gives 181.047 = area x length (Python and wasm).
- Planar paths whose corners the kernel cannot miter (arcs that meet at a corner: `Wire([
  ThreePointArc((0, 0, 0), (5, 5, 0), (10, 0, 0)), ThreePointArc((10, 0, 0), (14, 3, 0), (20, 2,
  0))])`, also with a circle) are swept piece by piece, as with `sharp_corners=False`, with a
  `RuntimeWarning` (S6). They raised `ModelingError`. `sharp_corners=True` still raises.
- Revolves give analytic surfaces (S4). The kernel revolves through a whole turn by another routine
  than through part of one, which made every wall that is not a plane a surface of revolution, and
  neither routine makes tori. Now lines parallel to the axis give cylinders, oblique lines cones,
  arcs centred on the axis spheres and other arcs tori, for every angle (`ext.analytic_revolutions`
  after `Sketch.revolve` and the open-curve `revolve`, both builds): the revolved tube
  `Polygon((5, 0), (10, 0), (10, 20), (5, 20)).on(Plane.XZ).revolve(Z)` has 2 cylinders of radius 5
  and 10 (`faces().cylinders()` was empty and `Face.radius` raised), `Part.draft` takes them (it
  refused "the revolution face"), and STEP writes 2 `CYLINDRICAL_SURFACE` and no B-spline (7039
  bytes, B-splines that read back as B-splines). 150 random lathe profiles (plain, filleted,
  chamfered, with holes; 90 to 360 degrees) give the volumes (to 1e-7), validity and face counts of
  origin/next; their faces: cylinders 294 -> 521, cones 52 -> 96, tori 15 -> 138, surfaces of
  revolution 394 -> 0; B-spline surfaces in their STEP files 1182 -> 0, and OpenCASCADE reads all
  150 valid with our volumes. Python and the wasm agree on 40 of 40 (volumes, face types).
- Revolves through 359.99 to 359.99999 degrees (exclusive) raised "not a closed, manifold solid";
  within 0.01 degrees of a whole turn a revolve is a whole turn now (S4).
- `Face.axis` works on surfaces of revolution (a spline revolved): `ext.surface_data` gives their
  placement (both builds). The docs said it did.
- A path that is a single line or arc gives planes, cylinders, cones and tori (S8): it is swept as
  an extrusion along the line, or (with `orient`) as a revolve about the arc's axis, the profile
  placed as on any other path. The kernel's curve sweep made B-spline faces there, while the same
  profile along a path of several edges came out analytic: `sweep(Circle(2), Line(...))` had no
  cylinder (`Face.radius` raised), a rectangle along `CenterArc((0, 0), 10, 0, 90)` had four
  B-spline walls (now 2 cylinders and 2 planes, 125.6637 = Pappus exactly). 8 profiles (circle,
  rectangle, triangles, ring, rectangle with a hole, rounded rectangle, ellipse) along 7 single-edge
  paths (lines, arcs in and out of XY, a full circle), oriented and translational (112 sweeps): the
  same 89 build and 23 raise as before; 78 have the same volume to 1e-8, 10 along arcs differ by up
  to 9.4e-6 and now match Pappus to 1e-15 (the kernel's sweep approximated the frame), one moves (see
  Behaviour changes); their faces: B-spline 327 -> 90 (oblique translational extrusions and
  ellipses keep theirs), cylinders 0 -> 38, cones 0 -> 50, tori 0 -> 32, planes 146 -> 232.
- A profile that reaches across the axis of a single arc path raises `ModelingError` (S8,
  `ai/todo/features.md` 13): `sweep(Circle(12), CenterArc((0, 0), 10, 0, 90))` returned a "valid"
  body that sweeps through itself, with area x length as its volume.
- Tapered extrusions have plane walls (S9, `ai/todo/features.md` 8): the extrusion is made straight
  and its walls drafted (`Part.draft`), kept where it has the same volume as the kernel's draft
  sweep to 1e-7. The draft sweep made the walls at sharp corners flat B-spline surfaces (inward
  tapers) or planes and two B-spline slivers a corner (outward ones: `Rectangle(30,
  30).extrude(10, taper=-8)` had 14 faces), which `faces().of_type("plane")` missed, `Part.draft` refused
  ("the bspline face ... cannot be drafted", contrary to the draft guide) and STEP wrote as
  B-splines. 8 profiles (rectangles with and without a hole, an L, a triangle, a hexagon, a rounded
  rectangle, a slot, a ring) at tapers of +-3 and +-8, both ways and `both=True` (128 extrusions):
  the same volumes to 2e-15, B-spline faces 996 -> 0, faces 1888 -> 1240. Profiles with other
  curves (ellipses, splines) keep the draft sweep.
- `Part.draft` drafts flat B-spline faces as planes (S9): `face_draft` asked the kernel's
  `IsPlanar(1e-7)`, which says no for them, though `Face.is_planar` says yes; it now tests their
  control points (in one plane to 1e-10 of their spread) as `Face.is_planar` does. The walls of
  `extrude(taper=3, corners="round")` drafted by 2 more degrees give the volume of `taper=5` exactly.
- A tapered extrusion whose hole widens across the region before the end raises `ModelingError`
  (S9): `(Circle(10) - Circle(8)).extrude(10, taper=10)` came out 5.67 high (320.70) where 10 was
  asked for; the check that the body reaches the end looked at the outline only.
- Revolves, lofts, open-curve extrusions, tapers and mitered planar sweeps free the curve copies
  they give the kernel (S11): the kernel copies its inputs and the copies stayed allocated (1500
  revolves +1.98 MB, 1500 lofts +3.62 MB, 1500 open extrusions +3.42 MB; now +0.15, +0.38 and
  +1.18 MB; the WebAssembly heap never shrinks).
- A circle or ellipse twisted along a straight line (`sweep(Circle(2), Line(...), twist=90)`)
  raised `KernelError` (SM_ERR; this lane's batch 2): the caps of `ext.oriented_sweep` took the
  end curves of as many side faces as the profile had curves, and a circle is one curve whose sweep
  comes in four faces. The caps now take the end curves that lie across the path's start and end.
  Volumes area x length to 1e-6 (both builds).
- `ext.oriented_sweep` read the surface it had handed to `SmBrep::CreateFacesFromSurface` when that
  failed, which may have deleted it (found with AddressSanitizer in the new `ext.skin`, where it read
  freed memory on success too); neither reads it now.
- Checked through STEP: OpenCASCADE reads an outward taper (6 planes), a holed inward one (10
  planes), a rounded one, a rod and a bend from line and arc sweeps (cylinders), a torus from a
  circle path, a scaled cone and spring, a tangent neck and a closed loft as valid solids of our
  volumes (to 1.1e-7), with the analytic faces as such. AddressSanitizer reports nothing for
  `tests/test_lane_S.py`, `tests/test_draft.py` and the probes of this batch (scaled sweeps,
  tapers, lofts with tangents and closed, twisted circles).

## New

- `ext.remove_slivers(brep, faces, tolerance)` (Python `smlibpy._core.ext`, wasm `ext.remove_slivers`):
  a copy of a body without the given faces of no area, stitched into a solid again within
  `tolerance` at most (internal; used by `sweep`).
- `sweep` warns (`RuntimeWarning`) when an asymmetric profile on a mitered planar path with a
  spline among its edges cannot be put on the path by its own box (no offset curve): it sits by its
  box along the path's plane then.
- `sweep(..., up=None, twist=0.0)` and `Sketch.sweep(path, *, sharp_corners=None, up=None,
  twist=0.0)` (S3; wasm `{ up, twist }` options). `up`: an axis or a direction the profile keeps its
  attitude to (it stays at the angle it starts at to `up` made perpendicular to the path, also after
  corners), or `"frenet"` (to the path's principal normal). `twist`: degrees the profile turns about
  the path on top of that, spread evenly along its length, or a function of the fraction of the
  length giving the angle (`twist=lambda s: 90 * s * s`). Twisted bar `sweep(Rectangle(10, 2),
  Line((0, 0, 0), (0, 0, 100)), twist=180)`: 1999.9996, a quarter turn halfway; a twisted ribbon
  from an open line profile is a helicoid (area to 2e-6). Volumes are area x length to 2e-6 with
  `up=Z` and `up="frenet"` along a 3D spline, and with `twist=90` along a 3D fillet polyline.
  Errors: `ValueError` where the path runs along `up`, where it runs straight with `"frenet"`, with
  `translational=True` or `orient=False`, with `sharp_corners=True`, and along a closed path that a
  twist does not bring the profile round into itself on (`twist=90` with a square works, with a
  4 x 2 rectangle it raises); `TypeError` for a twist that is neither a number nor a function.
- `ext.oriented_sweep(profile, path, params, x_axes, cap_ends=True)` (new C++ in
  `src/cpp/oriented_sweep.cpp`, both builds): the curve sweep with the profile's x axis given along
  the path (NLib's `curZ`, which the kernel never passes). `ext.helix_axis(curves, tolerance=1e-5)`:
  the axis of a path that winds about one at a constant pitch, its radius constant or changing
  evenly with the angle (Gauss-Newton fit; None for other paths). `ext.analytic_revolutions(brep)`
  (`src/cpp/revolutions.cpp`): a copy of a body whose surfaces of revolution are cylinders, cones,
  spheres or tori where they are one (the kernel's own tests for cones and spheres; tori built from
  the generating arc, because `SmTorus::IsNurbSurfaceTorus`, the test the kernel leaves out, gets
  the major radius and the angles of a revolved fillet's quarter arcs wrong), or None. Internal.
- `sweep(..., scale=None)` and `Sketch.sweep(..., scale=None)` (S7; wasm `{ scale }`): the
  profile's scale along the path, about the point of it that sits on the path. `(start, end)`
  changes evenly along the length; `[(t, s), ...]` passes through scales at fractions of the length,
  from 0 to 1 (a piecewise cubic that does not overshoot them: Fritsch and Carlson, scipy's PCHIP);
  a function of the fraction gives it. A cone from `sweep(Circle(2), Line((0, 0, 0), (0, 0, 50)),
  scale=(1, 2))`: 1466.07658 (the frustum 1466.07657; radius 3.0000 halfway); a tapered spring
  `sweep(Circle(2), Helix(pitch=10, height=40, radius=15), scale=(1, 0.5))`: 2778.99553 (pi 4 L 7/12
  = 2778.99553), its attitude to the axis kept; a bulging ring along a circle 314.5936 (exactly).
  Along a path without a frame law the kernel's own scaled sweep is used (reference and scale
  curves built from 65 points by arc length; the law runs over the path's parameter in the kernel);
  with `up=`, `twist=` or along a helix `ext.oriented_sweep` takes the scale. Works on open profiles
  (surfaces), along closed paths (the same scale at both ends) and along paths of several edges
  (planar ones piece by piece). Errors: `ValueError` for a scale that is not positive along the
  whole path, points that do not run from t = 0 to t = 1, a closed path whose ends differ,
  `sharp_corners=True` on a planar path of several edges; `TypeError` for anything else.
- `extrude(..., corners="sharp")` and `Sketch.extrude(..., corners="sharp")` (S9; wasm
  `{ corners }`): `"round"` rounds off the corners a taper pulls apart (the kernel's draft sweep
  with rounded corners): `Rectangle(30, 30).extrude(10, taper=-8, corners="round")` has 10 faces,
  9863.929.
- `loft(..., start_tangent=None, end_tangent=None, closed=False)` (S10; wasm `{ startTangent,
  endTangent, closed }`): the direction the loft leaves its first section in and reaches its last
  in (an axis or a vector; only the direction counts), so that it meets an extrusion of the end
  section smoothly: `loft([Circle(10), Circle(4).translate(0, 0, 30)], start_tangent=Z,
  end_tangent=Z)` leaves and reaches its circles with radial normals (to 1e-6 degrees; without them
  the normals lean), and fused with a cylinder at each end gives a body of 5 faces. Each tangent is
  one more condition (two sections and both tangents: cubic). `closed=True` runs the loft on from
  the last section through the first again, C1 where it closes (three sections or more): 16 circles
  of radius 2 about a circle of radius 10 make a ring within 7e-5 of the torus. Holes and open
  sections (surfaces) take them too. Errors: `ValueError` for a tangent in the plane of its section,
  with `ruled=True`, tangents with `closed=True`, and a closed loft of two sections;
  `ModelingError` where the kernel does not meet a tangent (it drops them silently; the loft
  measures the direction across its ends, 1e-6 rad).
- `ext.skin(curves, counts, degree=3, start_tangent=[], end_tangent=[], closed=False,
  cap_ends=True)` (new C++ in `src/cpp/skins.cpp`, both builds): the kernel's skin
  (`CreateSkinnedSurface`) with cross-boundary derivative strips (NLib's
  `N_CreateSkinSrfBoundaryDerivs`), or NLib's C1-closed skin (`N_CreateSkinSrf`), the side faces split
  where they turn, capped from the end curves that lie on the end sections, stitched; returns the
  body and the largest angles between its direction across its ends and the tangents. Internal.
- `ext.oriented_sweep(..., scales=[])`: the profile's scale at the parameters (S7), interpolated
  cubically with 512 control points at least (NLib places a section for each, and leaves a changing
  scale by about 0.017 / (sections - 1) of the change in the first and last span: the kernel's own
  scale law with 31 points, as `ext.curve_sweep` takes it, gave the cone above 1466.0801). A path of
  degree 1 is raised to 3 there. Internal.

## Behaviour changes

- Asymmetric profiles on mitered planar paths that do not start along X, Y or Z (in the path's
  plane) move onto the path by the center of their own box, by up to a third of their size; the
  volume changes with the corners (the triangle above at 30 degrees: 845.8564, was 839.8564).
  Unchanged: symmetric profiles, and paths that start along X, Y or Z. To get the old placement,
  move the path by the old offset:

  ```python
  # before 0.5.0: the profile's box along the world axes sat on the path start
  body = sweep(tri, path)
  # now: the profile's own box sits there; to put another point of the profile there, draw the
  # profile around that point (sketches are values: tri.translate(-cx, -cy, 0))
  body = sweep(tri.translate(-cx, -cy, 0), path)
  ```
- Mitered planar paths whose plane is not horizontal now build where they raised (no migration).
- A round profile along a closed path of several tangent edges (a closed `FilletPolyline`) is one
  sweep closed where its ends meet: other faces and edges than the per-edge pieces of origin/next
  (the repro: 8 faces as before; random ones up to 20 faces for 8 to 10), the same volume to 2e-7.
- Sweeps along kinked loops that fused into faces of no area come back without them (fewer faces:
  4 for 5 to 7) or raise `ModelingError` ("... face(s) that enclose no area, and they cannot be
  taken out"). Where a round profile had to be turned to sweep, its seam edges lie elsewhere (the
  same body). Where nothing works the error is the carried route's, as before:

  ```python
  # before / now: a loop closed with a kink can still fail for some loops
  ring = sweep(Circle(2), Spline(*pts, pts[0]))
  # close it smoothly instead: no kink, no fuse
  ring = sweep(Circle(2), Spline(*pts, closed=True))
  ```
- A fused sweep that is open between its faces raises `ModelingError` ("open between its faces")
  where it was returned (after the other ways failed).
- A failing sweep along a kinked loop with a round profile takes longer before it raises (up to
  about 13 tries, typically 0.2 to 0.4 s each).

- The default attitude along helices changed (S3): non-round profiles along a helix, a conical
  helix or a chain of helices no longer roll, so their bodies differ (the volume too where the
  profile is not symmetric about its anchor: the thread tooth of `Helix.md`, `Polygon((0, -0.8),
  (0, 0.8), (1.2, 0))` along `Helix(pitch=2, height=16, radius=5.6)`, keeps its tip out and its
  centroid at radius 5.4: 261.0274, was 270.8705). The roll was the defect; no option brings it
  back. Scripts that worked around it drop the workaround:

  ```python
  # before 0.5.0: a loft through copies placed along the helix, x radial (8 per turn)
  thread = loft([Rectangle(2, 1).on(Plane(origin=h.point_at(i / n), x_dir=radial(i / n),
                                          z_dir=h.tangent_at(i / n))) for i in range(n + 1)])
  # now: the sweep keeps that attitude itself
  thread = sweep(Rectangle(2, 1), h)
  ```
  Open profiles along helices (ribbons) keep their attitude to the axis too.
- Sweeps along helices take longer (more sections, and a frame computed along the path): a circle
  along an 8-turn spring 71 -> 147 ms, the thread tooth 21 -> 64 ms, the 60-turn chain with a
  rectangle 0.5 -> 1.1 s (this lane's first batch), with a circle 0.8 -> 1.2 s.
- Planar paths of several edges with `up=` or `twist=` are swept piece by piece (the mitered planar
  sweep keeps the kernel's frame): `sharp_corners` defaults to `False` there, and `True` raises.
- Planar paths whose corners cannot be mitered warn and go piece by piece instead of raising (no
  migration; with warnings as errors, pass `sharp_corners=False`).
- Revolved faces are cylinders, cones, spheres and tori where they were surfaces of revolution (S4):
  a full turn of any profile of lines and arcs, and arcs in part of a turn. Selections by type
  change:

  ```python
  # before 0.5.0: the walls of a lathe part were "revolution" faces
  walls = part.faces().filter(lambda f: f.geom_type == "revolution")
  # now: cylinders (and cones, spheres, tori); radius and axis work
  walls = part.faces().cylinders()
  ```
  Volumes are the same to 1e-7, face counts unchanged. STEP files carry the analytic surfaces. A revolve takes longer (the copy and its
  checks): a lathe profile 4 -> 12 ms. Spline edges (and arcs whose circle reaches over the axis, a
  spindle torus) still give surfaces of revolution.
- A revolve through more than 359.99 degrees is a whole turn (it raised below 359.99999; no
  migration).

- Sweeps along a single line or arc give planes, cylinders, cones and tori (S8) where they gave
  B-spline faces; volumes the same to 1e-8, or to 9.4e-6 where the kernel's approximation along an
  arc is gone. Selections by type change:

  ```python
  # before 0.5.0: the swept rod's wall was a B-spline face
  wall = rod.faces().filter(lambda f: f.geom_type == "bspline").first
  # now: a cylinder (radius and axis work)
  wall = rod.faces().cylinders().first
  ```
- An asymmetric profile along a single full circle (`Circle(10).edges()[0]`, `CenterArc(..., 360)`)
  whose plane faced against the path's start sits as along any other path (S8): the circle went to
  the mitered planar sweep in two halves, which turned such a profile by half a turn about the
  circle's axis (`Polygon((0, 0), (3, 0), (1, 2)).on(Plane.XZ)` along a circle of radius 15:
  279.6017, was 285.8849, mirrored about the path). Symmetric profiles are unchanged. To get the
  old body, mirror the profile across the plane through its box center that faces along the
  circle's radius at its start (X for `Circle(15)`, which starts at (15, 0, 0)):

  ```python
  # before 0.5.0: 285.8849
  body = sweep(tri, Circle(15).edges()[0])
  # now the same body (285.8849)
  c = tri.bbox().center
  body = sweep(tri.mirror(Plane(c, z_dir=(1, 0, 0))), Circle(15).edges()[0])
  ```
- A profile that reaches across the axis of a single arc path raises `ModelingError` where it gave a
  body that sweeps through itself (S8). Make the bend radius larger than the profile:

  ```python
  # before: a "valid" body with too much volume; now ModelingError
  pipe = sweep(Circle(12), CenterArc((0, 0), 10, 0, 90))
  pipe = sweep(Circle(8), CenterArc((0, 0), 10, 0, 90))
  ```
- Tapered extrusions of profiles with sharp corners have plane walls and fewer faces (S9): an
  outward-tapered rectangle 6 faces (was 14), inward ones planes where they were flat B-splines; the
  same volumes. Selections by type and face counts change; a taper takes about twice as long for
  such profiles (a rectangle 4 -> 8 ms; rounded profiles unchanged). There is no way back to the
  B-spline walls (`corners="round"` is the kernel's draft sweep with rounded corners):

  ```python
  # before 0.5.0: four flat B-spline walls
  walls = part.faces().filter(lambda f: f.geom_type == "bspline")
  # now: planes
  walls = part.faces().of_type("plane").filter(lambda f: abs(f.normal_at().z) < 0.99)
  ```
- A tapered extrusion carries the sketch's name and color, as a straight one does (S9; it had
  none).
- A tapered extrusion whose hole widens across the region before the end raises `ModelingError`
  (S9) where it returned a shorter body; extrude less, or taper less:

  ```python
  # before: 5.67 high, no error; now ModelingError ("closes the profile after 5.67128 of 10")
  ring = (Circle(10) - Circle(8)).extrude(10, taper=10)
  ring = (Circle(10) - Circle(8)).extrude(5, taper=10)
  ```

## Not done

- 1 of the fixer's 60 harder loops (`Circle(2)`) builds in Python and not in the wasm (the kernel's
  fuse differs in the last digits between the builds); 19 of the 60 fail in both (`KernelError`).
- Asymmetric profiles on mitered planar paths with a spline among the edges, turned off the path
  plane's axes, sit by their box along the path's plane (warning), not their own: the offset of a
  spline is not exact.
- The kernel's anchor uses the boxes of the profile's curves' control polygons; for arcs that do
  not span whole quadrants that box is larger than the curve's, so such asymmetric profiles can
  still sit a little off (all sweeps; not measured).
- No `anchor=` option for `sweep` (optional in the plan's S2): the center of the profile's own box
  goes on the path on every path now.
- No way to ask for the kernel's own (rolling) frame along a helix (S3); `up=` sets any other.
- `up="frenet"` spins the profile quickly where the path nearly straightens (the principal normal
  turns there; the sweep follows it with more sections, area x length to 1e-6) and raises on
  straight pieces: inherent in the Frenet frame.
- The helix default is found by fitting the path (to 1e-5 of its size): helices of the kernel,
  conical ones and chains. Other spirals (variable pitch, a spline through helix points) keep the
  kernel's frame unless `up=` is given.
- Along closed paths with corners (kinked loops, closed polylines) the attitude carried with
  `twist=` alone is not made to meet at the closure; the pieces are fused there, as without a twist.
  The profile must come round into itself only for the twist (checked) on paths closed smoothly.
- Mitered planar paths cannot take `up=`, `twist=` or `scale=` (piece by piece instead).
- No rails for lofts or sweeps, no spine (S10): `loft(rails=)` and `sweep(rails=)` are not offered,
  because the kernel cannot do them properly. `CreateSkinnedSurface`'s rails are side boundaries
  that need as many sections as the rails have control points (the fillet solver, its only user,
  places a section at every rail knot): with sections placed where the user puts them it returned
  SM_ERR for all 12 combinations tried (lines, splines and arcs as sections, one or two rails, two
  or three sections). The two-rail `CreateSweepSurface` only approximates its rails: 40 mm wavy
  rails were missed by 0.31 with its default 4 points between profiles, 5.2e-3 with 64 (35 ms),
  4.5e-4 with 256 (128 ms) and 1.6e-4 with 1024 (1.5 s, 61065 control points). The guards of U4
  for it (its fixed arrays of 640 curves) are therefore not needed yet.
- End tangency comes from a direction only, not from an adjacent face (its tangent plane along the
  edge); a loft that leaves a planar section along its normal meets an extrusion of it smoothly,
  which covers the common case.
- A sweep along a single arc with `translational=True` or `orient=False` keeps the kernel's
  B-spline faces (it is no revolve). Oblique translational extrusions have flat B-spline walls
  (the kernel's linear sweep makes them; `extrude(direction=...)` too).
- `extrude(taper=...)` still ignores `direction` (`ai/todo/features.md` 7).
- A scale law along a path whose kernel curve is not parameterized by arc length runs over the
  kernel's parameter between the 65 points it is given at (the law is interpolated there, so it
  holds to the interpolation, not exactly, between them).
