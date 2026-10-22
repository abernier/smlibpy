# Lane S: sweeps (S1 regressions, S2 rest)

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
  (open and closed polylines and fillet polylines).

## New

- `ext.remove_slivers(brep, faces, tolerance)` (Python `smlibpy._core.ext`, wasm `ext.remove_slivers`):
  a copy of a body without the given faces of no area, stitched into a solid again within
  `tolerance` at most (internal; used by `sweep`).
- `sweep` warns (`RuntimeWarning`) when an asymmetric profile on a mitered planar path with a
  spline among its edges cannot be put on the path by its own box (no offset curve): it sits by its
  box along the path's plane then.

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
