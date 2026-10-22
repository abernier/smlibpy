# smlibpy and smlibwasm 0.5.0: release notes

This release fixes the silent wrong results, crashes, hangs and leaks that a review of smlibpy
and smlibwasm against the SMLib kernel found ([kernel-deep-dive.md](kernel-deep-dive.md), its P0
items). Everything applies to smlibpy (Python) and smlibwasm (JavaScript) alike unless marked
"wasm". The codes in brackets name the plan's items; each has a status line there.

Where a wrong result now raises an error, the error says what to change. Several of these
changes can break scripts that relied on the old results: see
[Behaviour changes](#behaviour-changes) before upgrading.

## Fixed

### Silent wrong results

Booleans and cells:

- Moved, rotated, mirrored and scaled bodies keep their tolerances (B1). Every transform reset
  them from the box of the body's vertices: a torus (one vertex) got tolerance 0, parts over
  500 mm 1e-4. An O-ring groove `Cylinder(10, 40) - Torus(10, 1.5).translate(0, 0, 10)` was
  ignored (12566.37, valid), and a moved `Torus(8, 1.5) & Box(4, 4, 4)` gave the whole torus.
  Now the groove gives 12358.4417 and the moved torus 28.5863, as OpenCASCADE does. Over two
  seeded fuzz runs (2,338 operations) silent wrong Booleans fell from 2.6 % to 0.9 %.
- `is_valid()` checks Boolean results (B2). They were marked sound when made, so a result of
  volume -776.5, or an intersection of two cylinders larger than its operand, was valid.
  `is_valid()` now integrates a result once when asked, and is also False for a body whose faces
  leave gaps that make its volume uncertain by 1e-2 or more. Features refuse such bodies.
- A cut that the kernel wrongly returns empty, and an intersection that returns a whole operand,
  raise `ModelingError` (B3). `(Sphere(20) - Cylinder(6, 60)) - Cylinder(3, 60).translate(8, 0,
  0)` returned `Part(0 faces)` and its `&` the whole holed sphere (29089.8; right: 929.188). The
  list form `Sphere(20) - [Cylinder(6, 60), Cylinder(3, 60).translate(8, 0, 0)]` gives the right
  28160.6083.
- `merge` checks its result (B5): a merge whose volume is below that of its largest part, or above
  that of all parts together, raises `ModelingError` (a seam of one part lying tangent to another
  can do this). One such merge gave 518.314 for 586.443.
- `cells()` of an insert that touches the part around it at a point is right (B8):
  `Box(20, 20, 20).merge(Sphere(4).translate(6, 0, 0)).cells()` is [7731.917, 268.083], not
  [8000.0, 268.083]. An insert touching along a line raises, and `cells()` checks that the cells
  add up to the part.
- `section()` of a merged part has a region for every cell the plane cuts (B9): the insert's disc
  was dropped (1486.903 instead of 1600), and some planes raised `KernelError`.

Fillets and chamfers:

- A chamfer of an edge whose faces change their angle along it raises `ModelingError` (F4): the
  setback followed the angle (from 1 to 3 along the edge where a tilted cylinder meets a plate).
  Round such edges with `fillet`.
- A `(start, end)` radius with `continuity` raises `ValueError` (F3): the kernel made a ruled
  chamfer, not a blend, for G1, G2 and G3 alike.
- A `(start, end)` radius on a closed edge, or on selected edges that run into each other
  tangentially, raises `ValueError` (F5): the kernel bent the radii (on a cylinder's rim it rose
  to 2.90 and fell back to 1 within the last 3 % of the edge).

Shell, offset and defeaturing:

- `shell` and `offset` refuse results whose faces do not meet (gaps of 1e-3 of the volume or
  more), shells without a cavity, the part given back, and closed shells of the wrong volume
  (O2). `(Box(20, 20, 10) - Cylinder(3, 20)).shell(4)` returned the plate itself. Closed shells
  of two imported parts came out near the part's own volume; they now have their cavity.
- `shell` measures walls across the part, not along the world axes (O4): `Box(40, 30, 10)`
  turned by 10 or 45 degrees and shelled by 6 gave a valid 10992.0, with no room for two walls. With openings,
  walls that do not fit raise before the kernel runs; closed shells are checked on their result.
- `remove_faces` keeps the face its rounds enclose (O5): removing the rounds around a box's top
  gave the box 2 lower (3200.0 instead of 4000.0), and a boss whose rim round alone was selected
  came back 1 lower.

Sweeps, lofts and sketches:

- Sweeps along 3D paths keep the profile's orientation (S1). Each edge turned the profile afresh,
  so a rectangle turned by 90 degrees at an arc-line joint and by 44 degrees at the closure of a
  closed loop. Tangent edges are now swept in one go, and at a corner the profile turns by the
  smallest rotation from one tangent to the next.
- Asymmetric profiles sit on the path (S2): a triangle swept along `Line((0, 0, 0), (10, 10,
  10))` started 1.67 before the path. The center of the profile's box, in its own plane, now
  lies at the start of every single-edge and 3D path.
- `loft` of single open curves takes `ruled` and `smooth` (S5); both were ignored.
- 2D Booleans of sketches whose faces touch each other at a point (the faces of `^`) are right or
  raise `ModelingError` (C1). The kernel's planar Boolean misclassified whole faces: against
  OpenCASCADE, 230 of 560 random results were wrong, now none.

Surfaces, meshes and measuring:

- B-spline faces with a bump are no longer taken for planes (U1): `to_shell()`, `.smb` files,
  `thicken()` and meshes flattened a face parameterized like a plane with a bump between the
  kernel's sample points (10 of 40 random bumps).
- Mesh Booleans use the mesh's arrays as they are (M1): after `m.vertices += ...` they used the
  old geometry.
- Meshes keep their tolerance (M2): a sphere's mesh was 0.68 off at a tolerance of 0.01 (long
  slivers near the poles), and a grid could miss a free-form bump between its lines.
- `distance_to` between nearly parallel faces is exact (A1): cylinders 2 apart and skewed by 5
  degrees gave 2.485. On 101 random pairs it now matches OpenCASCADE to 1e-15 of the distance.

Topology and files:

- `convex()`, `concave()`, `smooth()` and `Edge.convexity` are right on imported parts (T1). On
  bodies whose edges lie a little off their faces the answer was noise, and differed between
  Python and smlibwasm (the valve body's four symmetric edges: concave, concave, convex, convex).
  They now take the kernel's angle between the faces.
- STEP import makes one vertex per vertex of the file (I1): a rounded box written and read back
  had 48 vertices for 24, and loops whose edges did not link.
- `import_usd` places bodies as the stage has them (X2): `xformOp` transforms, `metersPerUnit`
  (converted to millimeters), `upAxis` (turned to Z up), `subLayers`, references and payloads were
  ignored. Inactive, abstract and over-only prims no longer give bodies.
- Line edges written to USD are as long as the edges (X4): each was a B-spline 2.5 km long, and
  such a file read back with a bounding box reaching 1234560. Files written the old way read back
  right too.
- Bodies from other software in a USD file are checked by the kernel before they are measured
  (X6), and bad values are refused (X1): broken bodies imported as valid Parts of the wrong volume.
- A merged part saved as `.smb` loads with its cells (X8); it came back as a Shell.

smlibwasm (wasm):

- Misspelt or Python-spelt options and extra arguments raise `TypeError` (W5): `p.bends({
  k_factor: 0.3 })` used the default K-factor, `Rectangle(20, 10, { filet: 3 })` and
  `Rectangle(20, 10, 3)` dropped the 3. The error names the right key ("did you mean 'kFactor'?").
- `ShapeList.at(point)` raises `TypeError` (W6); it returned the first shape. Use
  `atPoint(point)`.
- Faces, edges and vertices of a disposed body raise `TypeError` (W4); they answered with another
  body's geometry.

### Crashes and hangs

- Booleans of crossing holes whose seams lie tangent to the other hole, such as `Box(20, 20, 20)
  - Cylinder(3, 40).translate(0, 3, 0) - Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)`, raise
  `KernelError` (`SM_ERR_BAD_INTERSECTIONS`) instead of killing the process (B4).
- A cut by a flat end cap tangent to a sphere raises `KernelError` instead of killing the process,
  `Box(40, 30, 10).rotate(X, 45).shell(10, opening)` no longer crashes about one run in four, and
  `cells()` no longer crashes on a merge the kernel got wrong (B5).
- Chamfers of edges at different angles (all edges of a hexagonal prism) work (F1); they killed
  the process, and the wasm trapped.
- Fillets where the kernel has no corner for how the selected edges meet at a vertex raise
  `KernelError` (`SM_ERR_INVALID_INPUT`) with a hint that no size works (F2). They killed the
  process at any radius, as did all-edge fillets of 10 of 479 imported STEP files.
- `shell`, `offset` and `thicken` no longer kill the process (O1). Three sites where the kernel's
  offset code read memory it had freed are patched, and the kernel steps run in a forked copy of
  the process (Linux, macOS; smlibwasm: a worker with a kernel of its own), whose body comes back
  as an exact copy. A crash there raises `ModelingError` ("the kernel crashed (signal 11, in a
  copy of this process); this process is fine"); a step longer than `GUARD_SECONDS` (20 s) is
  stopped; Ctrl-C stops the copy.
- Copying a face out of an imported body whose faces share no edges (`to_shell`, `translate`,
  `to_sketch`, `extrude` of such a face) raises `KernelError` instead of killing the process (T2).
- A bad value in a USD file (a sphere whose reference direction is its axis, a weight of 0, a torus
  axis of length 0) raises `ValueError` instead of crashing the process, crashing a later `mesh()`
  or hanging `volume` (X1).
- wasm: failed kernel calls no longer use up the stack (W1). After about 240,000 failures (11,000
  raycasts that missed, a viewer that picks on hover) every call failed for good, and before that
  the stack overwrote static data.
- wasm: `removeFillets`, `removeFaces` and `surfaceFillet` stop a kernel step that loops (W2), in
  Node and in Web Workers of cross-origin isolated pages: the step runs first in a probe worker
  and is dropped after `GUARD_SECONDS`, as in Python. On the enclosure example they busy-looped
  for good, and froze a browser tab.

### Leaks

- A failed Boolean no longer keeps both operands (B7): about 0.6 MB each time; 100 failing cuts
  now take 7.6 MB instead of 52.9 MB (Node: 3 MB instead of 42 MB).
- STEP import, the seam check and `heal` no longer leak 3 to 13 KB per round face (I2): 1000
  seam checks and 100 imports grew a process by 16.7 MB, now by less than 0.5 MB.
- Meshes no longer keep the kernel's mesh (W3). In smlibwasm every mesh held it until the garbage
  collector ran, which in a loop it did not: 60 meshes of a fine sphere failed with
  `std::bad_alloc` at the 51st, and now take 543 MB.

## Behaviour changes

What can break existing scripts. Most of these scripts were getting wrong results.

### New errors where a result came back

| Where | Now | Before |
|---|---|---|
| a cut the kernel returns empty, an intersection that gives an operand back (B3) | `ModelingError` ("a result that is empty", "partly outside an operand") | an empty Part, or the whole part |
| `merge` (B5) | `ModelingError` when the result holds less than its largest part or more than all parts | a part of the wrong volume |
| `cells()` (B8) | `ModelingError` for an insert touching along a line, or cells that do not add up to the part | a cell bigger than the part |
| `is_valid()` and every feature's input check (B2) | False / `ModelingError` for bodies whose faces leave gaps of 1e-2 of the volume | True |
| `fillet(edges, (s, e), continuity=...)` (F3) | `ValueError` (wasm: `RangeError`) | a ruled chamfer |
| `fillet` with a `(s, e)` radius, `s != e`, on a closed edge or on selected edges that meet tangentially (F5) | `ValueError` (`RangeError`) | bent radii |
| `chamfer` of an edge whose angle changes along it (F4) | `ModelingError` | a bevel of the wrong size |
| `shell`, `offset`, `thicken` (O2, O4) | `ModelingError` for results with gaps, without a cavity, of the wrong volume, and for walls that do not fit across the part; messages add "(it built ...)" | such bodies |
| `shell`, `offset`, `thicken` steps longer than 20 s (O1) | `ModelingError` ("did not finish within 20 s"); raise `smlibpy.defeature.GUARD_SECONDS` for big parts | ran as long as they took |
| 2D Booleans of faces touching at a point (C1) | `ModelingError` where no way gives a region that holds | a wrong region |
| `import_usd` of malformed values or of broken bodies from other software (X1, X6) | `ValueError` naming the prim, body, entity and rule; `check=False` reads broken bodies as they are | a crash, or a wrong valid body |
| wasm: unknown options, extra arguments, `at(point)`, sub-shapes of disposed bodies (W4, W5, W6) | `TypeError` | ignored, or another shape |

Examples that now raise: usd-brep's `RevitWallHealerCrash.usda` (a gap of 377 between its edges), the shell
guide's old rounded box (an opening whose rim meets its neighbours tangentially; the guide was
changed), open shells of parts with a region thinner than two walls (also where the kernel
managed), and an imported part whose closed shell took 30 s and had no cavity.

### Changed geometry

- Booleans with moved tori and large parts give other, right, volumes and face counts (B1).
- Sweeps (S1, S2): along 3D paths and with `sharp_corners=False` the profile keeps the orientation
  it was carried in (a rectangle along `Polyline((0, 0, 0), (0, 0, 20), (20, 0, 20), (20, 20,
  30))` ends with its long side along (-0.447, -0.4, 0.8), not X), and tangent edges become one
  sweep (other face counts). Asymmetric profiles on single oblique edges and on 3D paths move to
  their own box center on the path, by up to a third of the profile's size. Unchanged: round and
  centered symmetric profiles, single edges and paths that start along X, Y or Z, and planar paths
  with mitered corners.
- Meshes of spheres with whole poles get a few more triangles (`Sphere(10).mesh()`: 3596 for
  3584), and bodies whose free-form faces the grid missed are halved (M2).
- STEP imports have the file's vertices (I1): vertex counts of imported parts change; no volume,
  face count or validity changed over 449 files.
- `import_usd` (X2): files with `metersPerUnit` other than 0.001 come out in millimeters, Y-up
  stages turned to Z up, bodies under prims with transforms where USD puts them. Files smlibpy
  wrote, and files with none of these, read as before. A stage that says nothing about its units
  is read in millimeters and Z up, unlike USD's fallback (centimeters, Y up); `units=` overrides.
  Bodies of prims that share a leaf name are named by their prim path.
- `remove_faces` of rounds around a face keeps the face (O5).
- Selections by convexity on imported parts change (T1); generated parts give the same answers.
- `section()` of a merged part has a region per cell (B9).
- `shell` tries the kernel's plain mode once, then its extended mode, and that once more only
  after a refused result; `offset` the extended mode once and once more after a refused result
  (O6). Failing shells return up to 8 times sooner; a part that only a late repeat could shell
  fails (on the imported parts tried, every such late result was the part given back).
- wasm: `shell`, `offset` and `thicken` run in the probe worker's kernel, whose history differs,
  so the extended mode can give another result than before (one fuzz offset now fails).

### Changed types and error classes

- `.smb` (X8): a merged part loads as a `Part` with its cells (it was a `Shell`); so does a broken
  solid, as a `Part` whose `is_valid()` is False.
- `split()` of a merged part raises `ModelingError` ("the part is not a valid solid"), not
  `KernelError`; `except KernelError` alone no longer catches it.
- `ValueError` (wasm: `RangeError`), not `ModelingError`: F3, F5, the USD checks (X1, X6),
  `classify` with a tolerance of 0 or less, `Edge.dihedral_angle` of an edge that does not lie
  between two faces.
- wasm: errors about disposed bodies are `TypeError`s (they were plain `Error`s, or `KernelError`s).
- New kernel statuses in `KernelError`: `SM_ERR_BAD_INTERSECTIONS` (Booleans, and shells and
  offsets of the patched offset code), and `SM_ERR_INVALID_INPUT` from fillets and chamfers with a
  new hint that no size works.

### Speed and size

- `merge` integrates the volumes of its parts and result to check them (a plate with nine pins: 8
  to 24 ms); `volume` of the result is then free. `cells()` checks its sum (29 to 39 ms).
- `is_valid()` on a fresh Boolean result integrates once (0.3 ms on a small part, 55 ms on a plate
  of 206 faces).
- 2D Booleans of sketches whose faces touch at a point take 2 to 18 ms (1.5 to 3 ms before).
- `shell`, `offset` and `thicken` fork and pass the body as `.smb`: about 1 ms per step on small
  parts. Over 154 imported parts, shells and offsets took 591 s instead of 1687 s (fewer repeats).
- wasm: each guarded step runs twice (probe, then for real), as in Python, and the probe worker
  holds a second kernel. Bundles must include `_defeature_supervisor.js` and
  `_defeature_worker.js`. The `.wasm` is 6.73 MB (gzip 2.35 MB, brotli 1.67 MB).

## New

- `Part.classify(point, tol=None)` gives `("inside", None)`, `("outside", None)` (a cavity is
  outside) or `("on", the vertex, edge or face)`; `Part.contains(point)` and
  `Part.cell_at(point)` (wasm: `classify`, `contains`, `cellAt`) (B11). Use them instead of the
  parity of `raycast` hits, which miscounts grazing rays; the guide `analysis/classify` covers
  them.
- `Edge.dihedral_angle` (wasm: `dihedralAngle`): the angle between the faces through the
  material, 90 at a box edge, 270 at an inside corner (T1).
- `Mesh.translate`, `rotate`, `mirror`, `scale` and `moved` return moved copies; normals turn
  along, and a mirrored mesh still faces outward (M1).
- `Mesh.dispose()` (wasm: also `[Symbol.dispose]`) frees what a mesh holds in the kernel; the mesh
  stays usable (W3). wasm: standalone edges and wires (`Line`, `Polyline`, ...) have `dispose()`
  (W4).
- `import_usd(path, *, heal=False, units=None, placement=True, check=True)`; wasm:
  `fromUsd(data, { heal, units, placement, check, resolve })` and `importUsd(path, { ... })`
  (X2, X6).
- `distance_to` warns (`RuntimeWarning`) when its closest points do not settle (A1).
- wasm: `GUARD_SECONDS` and `setGuardSeconds(seconds)` (W2), and a section "Running off the main
  thread" in the JavaScript docs.
- Kernel-level functions for those who call the kernel directly: `ext.classify_points`,
  `ext.boolean` (frees its operands on failure), `ext.edge_angles`, `ext.join_curves`,
  `ext.nearest_points`, `ext.usd_stage` and `ext.usd_assets`.
- Kernel patches: smlibpy now builds ten kernel source files from patched copies
  (`third_party/patches`; seven are new in this release, and two of the older three have new
  changes), each change confirmed with AddressSanitizer: Boolean topology (`SmProtoTopology.cpp`, `SmTopologyIntersector.cpp`,
  `SmMerge.cpp`), fillets (`SmFilletExecutive.cpp`), the offset code (`SmOffsetExecutive.cpp`),
  plane recognition (`SmPlane.cpp`), the seam check and inner-shell test (`SmFace.cpp`,
  `SmShell.cpp`) and tight bounding boxes (`SmCurve.cpp`). The README there lists every change and
  what it was measured to change.

For contributors: smlibwasm's option table (`js/src/_options.ts`) is generated from Python's
signatures. After adding or renaming a keyword in Python, run `python tools/gen_js_options.py`;
`tests/test_js_options.py` and `js/test/options.test.ts` fail until it is current.

## Not done yet

- Booleans in which the seam of a cylinder, cone or sphere lies in a tangent plane of the other
  operand can still return a valid body of the wrong volume (B6): `(Box(30, 30, 30) - Cylinder(5,
  60)) - Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)` gives 24331.70 instead of 24299.26.
  Turning seams at creation fixed some cases and broke others, so it did not land. Turning the
  tangent tool about its own axis (`Cylinder(2, 60).rotate(Z, 45)` before it is placed) gave the
  right body in the cases measured. Tests record these cases as expected failures.
- The kernel's extended offset mode still crashes now and then on filleted boxes (O1, issue #2),
  at a site not yet located; the forked copy contains it. `cells()` and fillets do not run in a
  copy.
- Planar paths of several edges with mitered corners keep the kernel's anchor, which is right
  only for paths that start along X, Y or Z (S2). There is no `anchor=` option.
- wasm: on a page's main thread, and in pages that are not cross-origin isolated, kernel steps
  still run directly, so a step that loops does not return there. A general worker entry
  (`@classcad/smlibwasm/worker`) is not part of this release. The probe worker was checked in Node
  and headless Chromium, not in Firefox or Safari.
- A cut beside an earlier parallel hole in a curved part raises instead of giving a result; apply
  the tools at once until the planned NURBS retry (B10).
- Openings whose rim meets its neighbours tangentially (a face bordered by fillets) cannot be
  opened by `shell` (O3).
- USD: inherits, specializes and variant sets are not composed; names with non-ASCII characters
  (X3) and analytic line, circle and ellipse edges (X5) are not done.
- A face copy that the kernel fails on stays in memory for the life of the process (T2).
- Fillet sizes are still checked at the middle of each edge, and radius laws along whole chains
  of edges need more work (F8).
- Small leaks remain on failure paths in the kernel (about 4.7 KB per failed extended shell).
