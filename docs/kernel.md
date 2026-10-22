# The kernel

smlibpy is a Python layer over **SMLib**, a NURBS boundary-representation solid modeling
kernel with a long industrial history. NVIDIA released it, together with a C-style API and
Python bindings, as open source under the Apache License 2.0 in the
[usd-brep](https://github.com/NVIDIA-Omniverse/usd-brep) repository.

## How it fits together

```text
smlibpy (Python)         shapes, selections, sketches, features, STEP/glTF/STL/USD, viewer
  └─ smlibpy._core       one compiled extension module
       ├─ ext            smlibpy's own C++: exact geometry and topology access, transforms,
       │                 sweeps with all options, error-controlled integration of mass
       │                 properties and curve lengths, body splitting, surfaces fitted to
       │                 point clouds, point classification and distances, USD files
       │                 (usd-brep's conversion and stage composition, without OpenUSD)
       ├─ SmPyLib        NVIDIA's pybind11 bindings of SM_API (without the USD parts)
       ├─ SM_API         NVIDIA's C-style API over the kernel
       └─ SMLib          the kernel: geometry, topology, Booleans, fillets, sweeps, healing
```

The kernel sources come in as a git submodule (`third_party/usd-brep`) and are compiled
with CMake into a single, self-contained Python extension. The submodule stays as published.
Kernel defects that smlibpy cannot work around from outside are fixed in copies of ten kernel
source files in `third_party/patches`, which the build compiles in place of the originals:
fillet removal that removed nothing, reads and writes of freed memory in Booleans, fillets and
the offset code behind `shell`, `offset` and `thicken`, a plane test that flattened B-spline
faces with a bump, a seam check that leaked on every STEP import, and bounding boxes that
reached past the ends of an edge. Its README lists every change and what it was measured to
change. Where smlibpy needs more than the published bindings offer, its own C++ module
(`src/cpp/ext.cpp`) calls the kernel directly.

## Accuracy

- **Geometry** is exact: planes, cylinders, cones, spheres and tori are analytic; free-form
  geometry is NURBS. Booleans and fillets work on the exact surfaces.
- **Areas, volumes, centers and inertia** are integrated over the exact geometry to seven
  significant digits by default (`ACCURACY = 1e-7`; see [Measuring](analysis.md)), with an
  error estimate for each of them. The integration is smlibpy's own
  (`src/cpp/measure.cpp`): the kernel's (`SmBrep::ComputePreciseProperties`) controls its
  steps by the area alone and measures them against the running sum along each trim curve,
  so its volumes and moments can be far worse than asked for (the swept spring of
  `examples/spring.py`: 2.9e-5 at 1e-7, still 2.8e-7 at 1e-9 after 12 s). smlibpy integrates
  the same surface integrals over the faces' trim curves (Green's theorem in the parameter
  plane) with adaptive Gauss–Kronrod quadrature, split at the knots, until every estimate is
  ten times below the accuracy asked for. It evaluates B-spline surfaces itself, along each
  line of integration from the poles, and integrates the knot spans of dense faces with 7
  points instead of 15. It is also faster: the spring takes 55 ms instead of 1.1 s, a
  thickened surface with 46,000 knot spans on a face 0.6 s (the kernel: 0.4 s, 2e-8 off),
  most parts a few milliseconds. The validity check (`is_valid()`, and the check of each
  feature's input) integrates the same way at 1e-4, with the gaps between the faces; the
  quick checks inside operations (did a fillet or a deformation change the volume plausibly,
  can the tools of an empty cut hold the part) still use the kernel's integration at a coarse
  accuracy.
- **Edge lengths** are integrated per knot span to 1e-12 (the kernel's `SmCurve::Length`
  counts a span whose curve starts with a zero tangent as 0).
- **A body is as exact as its faces meet.** Faces that the kernel fits (B-spline chamfers,
  shell offsets, intersections of curved faces) close up only to about 1e-6 to 2e-5 mm; the
  volume of such a body depends on that by 1e-7 to 4e-6 of its value. Beyond 1e-5 the
  measures say so in a warning (see [Measuring](analysis.md)).
- **STEP export** writes the kernel's exact curves and surfaces. The test suite reads the
  files back with OpenCASCADE and checks validity and volume.
- **STEP import** rebuilds every face on its exact surface and keeps the file's topology,
  so faces share edges and vertices instead of being stitched by tolerance.
- **The builds differ in the last bits.** The native build for arm64 (macOS, Linux on ARM) lets
  the compiler contract `a * b + c` into one instruction (FMA), which rounds once instead of
  twice; x86_64 builds and smlibwasm's WebAssembly do not. Volumes then differ by about 1e-9 of
  their value, and now and then a step that is close to a tolerance in the kernel succeeds in one
  build and fails in the other: all-edge fillets of usd-brep's `vase1.smb` and `vase3.smb` succeed
  on arm64 and fail in smlibwasm, and in a native build without the contraction
  (`-ffp-contract=off`), where the kernel's drop of a corner's guess point onto the filleted edge
  finds not one point. `tools/parity.py` lists the known cases.

## Robustness work in smlibpy

Some kernel behaviour is wrapped so that it is predictable:

| Kernel behaviour | What smlibpy does |
|---|---|
| Plane cuts keep the other half than documented and leave the body open | `split` intersects with a half space instead |
| 2D Booleans reject some overlaps (two circles, for one) | falls back to 3D Booleans of thin slabs |
| The planar Boolean misclassifies whole faces where faces of a sketch touch each other at a point, as the faces of an exclusive or do (230 of 560 random results wrong) | combines such sketches face by face, checks the result against the overlaps of the faces by area and first moments, and raises where no way holds |
| Fillets larger than the geometry allows can come back as a "valid" solid | checks the radius against neighbouring edges and the volume change |
| The fillet code has no corner for some ways the selected edges meet at a vertex, went on without one, and killed the process (and shrank fillet surfaces it had deleted) | patched (`third_party/patches`): such fillets raise `KernelError` (`SM_ERR_INVALID_INPUT`), with a hint that no size works |
| A (start, end) radius with `continuity` gives a ruled chamfer; on a closed edge or across edges that run into each other tangentially it bends the radii | refuses those combinations (`ValueError`) |
| A chamfer is a round of straight section with one radius per edge, so its setback follows the angle between the faces at the edge | sets each edge's radius from its angle, all edges in one call, and refuses edges whose angle changes by more than 1 degree along them |
| Sweeps anchor the profile at the start point of its first curve, and the frame of each edge of a path is its own | sweeps the profile in its own frame with the center of its box (in its plane) on the start of the path, and along 3D paths joins tangent edges and carries the profile's orientation from edge to edge (the planar sweep of mitered paths keeps the kernel's anchor) |
| The skin of single open curves has no degree | lofts open curves through the skin primitive, with the degree `ruled` and `smooth` give |
| A full 360 degree non-manifold revolve returns an empty body | revolves each loop and subtracts the holes |
| Faces on cylinders, cones, spheres and tori need a seam edge, but NX and others write them without one | adds the seam along the surface when importing STEP |
| A few writers flag the bound of a face reversed (fillets on tori, around holes and bosses), so its loop runs the wrong way round; the kernel's seam check then reads the loop as the rest of the torus and cuts the face apart (2 to 30 % of the volume lost, and the body still "valid") | turns such loops round when importing STEP: in a closed shell each edge between two faces is used once each way, so the neighbouring faces decide |
| The seam has to lie where the surface's angle parameter starts | turns the surface frame to the seam edge of the file |
| The extended offset mode depends on memory layout and sometimes builds a face the kernel cannot integrate or mesh | `shell` uses the plain mode first, checks every result and falls back to the extended mode, which it repeats once, only after a result it refused |
| The STEP builder (`SmBrepConstructor`) makes a vertex for every edge end it is not given one for: a body read edge by edge had coincident vertices (a rounded box 48 for its 24) and loops whose edges did not link | starts each edge at the vertices made for the file's vertex ids and glues the few the builder still makes twice |
| The seam check (`SmFace::HasSeamProblem`) lost a curve on every periodic face, 3 to 13 KB per call and per STEP import | patched |
| A body that `CopyFaces` or `RemoveFaces` failed on crashes when it is deleted (a face of an import whose faces share no edges) | never deletes such a body; the copy raises `KernelError` |
| Arcs from the API are plain B-splines | arcs are trimmed kernel circles, so they keep radius and center |
| Mass properties control their integration steps by the area alone: a volume can be 300 times worse than the accuracy asked for | integrates areas, volumes, centers and inertia itself, with an error estimate for each |
| A curve's length leaves out a span that starts with a zero tangent (the outline of a cylinder had 30 mm top and bottom lines instead of 60) | integrates lengths and arc-length positions itself |
| Tessellation cuts each face into a grid placed by the curves along its borders, so a face that is straight in one direction and twisted along it gets one facet across (a twisted bar: 1 mm off) | estimates for every face how far the grid would be off and halves all faces of such a body until they are flat; other bodies keep the kernel's triangles |
| On a sphere the grid leaves long slivers along the seam near the poles (0.68 off at a tolerance of 0.01), and on a free-form face it can miss a bump between its lines | splits every edge whose middle lies off a sphere, torus, cone or cylinder by more than the tolerance, and halves a body whose free-form faces the grid misses at a control point |
| Plane recognition (`SmPlane::IsNurbSurfacePlane`) compared a B-spline face with the plane at 13 fixed parameters, so copies of a face with a bump between them (`to_shell`, `.smb`, `thicken`, meshes) came out flat | patched: every control point must lie on the plane |
| The tight bounding box of an edge took in the knots of its curve beyond the edge (a box whose edges a USD file had written over SMLib's unbounded lines measured 1234560) | patched |
| Mesh Booleans leave polygons with holes, which the mesh arrays read by their outer loops (an open mesh) | triangulates every polygon of the result first |
| Fitting a surface to scattered points takes 4 s for 100 points and minutes for 300 | fits clouds itself (least squares with smoothing): 20,000 points in 50 ms |
| A curve-face intersection fails where a ray runs parallel to a plane or along a cylinder without meeting it | `raycast` intersects such faces through their mesh and moves the points onto the exact surface |
| Blending two surfaces changes them, so a second blend of the same surfaces fails | `surface_fillet` blends copies |
| Moving a body with a 4x4 matrix (`SmBrep::Transform`) resets its tolerances from the box of its vertices, and the model size of the shared context with them: a moved torus (one vertex) gets tolerance 0 and its Booleans go wrong, a part over 500 across gets 1e-4 | applies rotations, reflections and uniform scales with a placement, as SM_API does, and sets the tolerances of a scaled body from its whole box |
| Point classification (`SmBrep::Point3DClassify`) takes the region from one ray along +X; once a tight bounding box was computed, that ray can miss a face it crosses (a point inside a cylinder fused with a torus came out outside) | `classify` lets rays in two more directions off the axes vote, two more when they disagree |
| A Boolean that misclassifies the operands can return an empty cut, and the intersection of the same pair, its natural check, then returns the whole part (a tool beside an earlier hole in a sphere, a corner box on an imported pulley) | accepts an empty cut only from tools that hold the part's volume and span its box, and checks points of an intersection that reaches out of an operand's box against the operands |
| A Boolean can return a closed, manifold body whose faces do not meet (an intersection of two cylinders of 250.2, more than its operand's 150.8) | `is_valid()` integrates a Boolean result once when asked and is False where the gaps between its faces make its volume uncertain by 1e-2 or more; features refuse such bodies |
| Booleans of crossing holes whose seams lie tangent to the other hole, and a flat end cap tangent to a sphere, read freed memory and killed the process | patched: they raise `KernelError` (`SM_ERR_BAD_INTERSECTIONS`) |
| A merge in which a part's seam lies tangent to another part can lose volume, and the stitcher behind `cells()` then crashed on it | `merge` raises when its result holds less than its largest part or more than all parts together, and `cells()` checks that the cells add up to the part |
| A section of a merged part drops cells, or fails | `section` cuts each cell and puts their regions side by side |
| A failed Boolean keeps both operands and leaves the context marked as doing a Boolean (it then builds no surface caches) | holds the operands' copies until the kernel takes them and clears the mark (`ext.boolean`) |
| The offset code behind shell, offset and thicken reads memory it has freed (in its extended mode, depending on memory layout): it glued a Vertex it had deleted, kept a deleted ProtoEdge in the lists of other ProtoFaces, and handed out an extended surface after deleting it, and the process crashed now and then | patches the three sites (`third_party/patches`), and runs the kernel steps in another process, whose body comes back as an exact copy (see "Steps in another process" below) |
| shell and offset return bodies whose faces do not meet, a shell without its cavity, or the part itself, and their wall check missed turned parts | refuses results whose faces leave gaps of 1e-3 of the volume, checks a closed shell against the part less its offset and the cavity where no wall reaches, and measures walls across the faces of a part with openings |
| Release builds compile the kernel's error reports out (`SER` and the other failure macros of `SmMessages.h` only return), so every failure said only `SM_ERR at <binding>` | patched (`SmMessages.h`): each failure is reported to the error callback, which keeps the last 48; `KernelError.trace` (see "Where the kernel gave up" below) |
| usd-brep's conversion writes the UV curves of a loop that runs up and down a sphere's seam (no edges at its poles), which do not close (usd-brep's validator: BA.763) | writes such loops without UV curves, which a reader rebuilds from the 3D curves |
| usd-brep's conversion writes cones the omniSolid schema does not allow (a semi-angle of 0 or below) and writes a line edge as a B-spline over SMLib's unbounded line (2.5 km long), and trusts the arrays and values of a file it reads (a malformed array, a sphere whose refDirection is its axis or a weight of 0 crashes it; a cylinder axis of length 0 gives a wrong body) | writes such cones as cylinders or turned around and line edges as long as the edges; checks every array, reference and value (the rules of usd-brep's validator) before converting, and checks each body from other software with the kernel (`SmBrep::AssertValid`) before anything measures it |

## Known kernel limitations

From usd-brep's own list of known issues and from smlibpy's own testing, the ones that can
matter here:

- `heal` may report success without repairing everything; check `is_valid()` afterwards.
- Healing of imported periodic faces (tori, spheres) can go wrong.
- A Boolean in which the seam of a cylinder, cone or sphere lies in a tangent plane of the other
  operand can return a valid body of the wrong volume (a groove pin tangent to a bore: 24331.70
  instead of 24299.26). Its faces meet, so no check catches it. Turning that operand about its
  own axis before placing it (`Cylinder(2, 60).rotate(Z, 45)`) gave the right body in the cases
  measured; compare such volumes with a formula.
- Rounds where three fillets meet at a corner of mixed convexity can fail; round the
  edges in a different order or with different radii.
- Where the kernel has no corner for how the selected edges meet at a vertex (the two halves of
  an edge that another face touches tangentially), the fillet fails at any size
  (`SM_ERR_INVALID_INPUT`); select fewer edges there.
- `shell` cannot open a face whose rim meets its neighbours tangentially, such as a face
  bordered by fillets; shell first, then round the rim.
- The offset code behind `shell`, `offset` and `thicken` depends on memory layout in its extended
  mode: the same call can fail, succeed or crash (filleted boxes still crash it now and then).
  smlibpy runs it in another process (a forked copy on Linux and macOS, a helper process on Windows; smlibwasm: in a kernel of its
  own), so a crash raises `ModelingError` and this process goes on, and it tries a mode again only
  after a result it refused, not after an error. A step longer than
  `smlibpy.defeature.GUARD_SECONDS` (20 s) is stopped.

## Where the kernel gave up

A `KernelError` names the smlibpy call, the kernel's status and a hint. Its `trace` says where in
the kernel the call failed: the failures the kernel reported during the call, oldest first, the
last 48 of them, as `"SM_ERR at SmFilletExecutive.cpp:1603 (DoFillet)"` (the status, the kernel's
file and line, its function). It ends with the chain from the deepest function that failed to
the kernel's API function; what comes before are errors the kernel recovered from (a step it
tried another way). Steps in another process bring theirs back.

```python
try:
    Cylinder(3, 40).translate(0, 3, 0) + Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)
except KernelError as e:
    print(e.status)       # SM_ERR_BAD_INTERSECTIONS
    print(e.trace[-3:])   # (... (IntersectTopology)', '... SmMerge.cpp:2698 (ManifoldBoolean)', '... (SmApiBoolean)')
```

The trace is for bug reports and for maintainers: it changes with the kernel, and the builds can
give up in different places (smlibwasm gives up on the holes above in `SmMerge::MakeFaceuse`,
with `SM_ERR`). The raw layer reads it with `ext.kernel_trace()` (the entries and how many there
were since `ext.clear_kernel_trace()`). Reporting a failure costs a function call on the kernel's
error paths only; the test suites take as long as before.

## Steps in another process

The kernel can crash (read or write memory it has freed) or loop on some inputs, and nothing stops
a kernel call from outside: Python handles Ctrl-C only once the call has returned. smlibpy runs the
kernel steps known to crash or loop in another process and waits for them there, at most
`smlibpy.defeature.GUARD_SECONDS` (20 s):

- the steps of `remove_fillets` and `remove_faces` (SMLib's patching code loops or crashes on some
  parts), `surface_fillet`, `shell`, `offset` and `thicken` (the offset code), and `Part.cells()`
  (the stitcher);
- fillets and chamfers of parts read from files (`import_step`, `load`, `import_usd`) and of the
  parts made from them: the fillet code crashed on 10 of 479 imported parts before it was patched;
- every Boolean (`+`, `-`, `&`, `merge`) once `smlibpy.defeature.GUARD_BOOLEANS = True` (off by
  default), for long batch runs over unknown inputs.

The step's result comes back as an exact copy (the kernel's binary `.smb` for bodies, anything else
pickled), and this process never runs the step itself. A step that crashes the kernel there raises
`ModelingError: <step>: the kernel crashed (signal 11, in a copy of this process); this process is
fine`, one that takes longer than `GUARD_SECONDS` `ModelingError: <step>: the kernel did not finish
within 20 s`, and Ctrl-C stops the step at once (`KeyboardInterrupt`); errors and warnings of the
step are raised here as they were raised there. Ctrl-C does not stop a kernel call that runs in
this process (any other step): it waits until the call returns.

`smlibpy.defeature.GUARD_PROCESS` says where the steps run: `"fork"`, a forked copy of the process
per step (Linux, macOS; about 1.5 ms); `"helper"`, one helper process for the session, started with
the first step and again after one crashed it or ran too long, which gets the bodies as `.smb`
files (Windows, and processes that must not fork); `"auto"` (the default), a fork where the system
can fork and the helper elsewhere. A frozen application, or a helper that does not start, runs the
steps in its own process, as `GUARD_SECONDS = 0` does (with a warning, once). smlibwasm runs the
same steps in a probe worker, a kernel of its own (`setGuardSeconds`, `setGuardBooleans`).

```python
# not run
import smlibpy.defeature

smlibpy.defeature.GUARD_SECONDS = 120      # large imported parts
smlibpy.defeature.GUARD_BOOLEANS = True    # a batch over STEP files that must not end on a crash
smlibpy.defeature.GUARD_PROCESS = "helper" # an application that must not fork
```

## Threads

The kernel is not thread-safe: its one context keeps shared state without locks (the marks of its
traversals, the caches of curves, surfaces and bodies). Every function of smlibpy's kernel module
(`smlibpy._core`: also the methods of its objects, and the deletions that run when a body is
garbage collected) takes one lock, so the kernel runs one call at a time, whichever thread makes
it. The long calls let Python's GIL go while the kernel works: Booleans, fillets and chamfers,
shells and offsets, sweeps and lofts, tessellation (`mesh()` and the exporters), mass properties,
distances, deformations, removing fillets and faces, drafts, sheet-metal bends, surface fits, the
cells of a body, STEP and USD import, healing, stitching and mesh Booleans. Other Python threads
run on meanwhile, and those that call the kernel wait for it. A cut of a plate by a tool of 144
pins, 0.3 s in one kernel call, paused a thread that ticks every 5 ms for 7 ms (the whole 0.3 s
before); meshing the result at 0.01 mm, about 6 s, paused it for 18 ms. The short calls keep the GIL:
letting it go costs a thread switch, and a query takes microseconds.

So a GUI, a web server or a progress bar stays responsive while a model builds in another thread.
Threads that model at once get what one thread gets, but no sooner: there is one kernel, and they
take turns. To model in parallel, use processes (the MCP server runs each session's kernel in a
worker process of its own; `concurrent.futures.ProcessPoolExecutor` for a batch). A fork waits for a
kernel call of another thread to end, so that the forked copy starts with the kernel at rest (the
guarded steps above fork, and so does `multiprocessing` on Linux; Python warns that a process
with threads forks; a program that must not fork sets
`smlibpy.defeature.GUARD_PROCESS = "helper"`). smlibwasm runs on one thread; each `KernelWorker`
has a kernel of its own.

## What queries keep

A query keeps what the kernel computed for it on the body's curves and surfaces (evaluation grids,
trimmed-surface data, the spatial trees of its boxes) for as long as the body lives, and that can
outweigh the body: on a holed, filleted box of 129 KB, `bbox()` added 41 KB, `mesh()` 754 KB and
`distance_to()` 799 KB (smlibwasm: 90 KB, and 34, 541 and 573 KB). A query that finds them is
about 1.2 times as fast (twice for `closest_point()` after `distance_to()`); Booleans gained
nothing from them. `compact()` frees them: the body does not change, and the next query builds
what it needs again. Compact what is kept but no longer queried, such as the copies of a large
pattern after they were measured or exported:

```python
part = Box(40, 30, 10) - Cylinder(5, 20)
copies = [part.translate(i * 50, 0, 0) for i in range(20)]
boxes = [p.bbox() for p in copies]
for p in copies:
    p.compact()
```

## Checks of the kernel

Besides the test suites, the "Checks" workflow (`.github/workflows/checks.yml`) runs slower checks
of the kernel every night, on demand, and the fuzz run also on pull requests that change the
kernel, its patches or the modelling code. Each one runs locally the same way:

| Check | Command | What fails it |
|---|---|---|
| Fuzz: seeded random models (Booleans, fillets, chamfers, shells, offsets, slices) of primitives placed flush, touching, centred or on a face, each in a forked process, through smlibpy and, with `--wasm`, smlibwasm on the same parameters | `python tools/fuzz/fuzz.py [--seed N] [--wasm]` | a crash of the kernel whose signature (the kernel functions at the top of its stack, from gdb or lldb) `tools/fuzz/baseline.json` does not know; any hang; for the seeds 7 and 8 (the regression corpus) a result that breaks an invariant, crashes or diverges between smlibpy and smlibwasm where the baseline's runs did not; a share of such results more than 0.3 points above the baseline's |
| AddressSanitizer and LeakSanitizer over the tests of the guarded and patched kernel code, every kernel step in the test process | `python tools/sanitize/run.py --build build-asan` (third_party/patches/README.md says how to build it) | a memory error not in `tools/sanitize/known.txt`; a leak of the kernel or smlibpy's C++ not in `tools/sanitize/leaks.txt` |
| Upstream's kernel tests (usd-brep `prog_test`, 17 suites) against the patched kernel | configure with `-DSMLIBPY_PROG_TEST=ON`, then `python tools/oracles/prog_test.py` | a suite that does not pass |
| Upstream's tests of its Python bindings, against `smlibpy._core` | `python tools/oracles/smpylib_tests.py` | a test that fails, but for those of the `usd` submodule, which smlibpy builds without |
| Upstream's 200 `.smb` test files | `python tools/oracles/smb_files.py` | a file whose kind, face count, volume, validity or mesh differs from `tools/oracles/smb_files.json` |
| Crash loops: the calls that crashed the kernel (O1, O4 of the kernel plan), again and again in fresh processes with the guard off | `python tools/oracles/crash_loops.py --runs 20` | a crash of a case not marked known (two still crash now and then, contained by the guard: their rates are printed) |
| NVIDIA's BrepArray validator (usd-brep's `brep_validator`, 191 rules) on USD files, without OpenUSD: upstream's rule checker on a shim of the `pxr` calls it makes (`tools/oracles/usd_shim`). The test suites run it on what `export_usd` and `toUsd` write | `python tools/oracles/usd_validator.py FILE.usda ...` | a rule a file fails (the tests leave out BA.465, control points in the body's box, for bodies read from other software: upstream's own files fail it) |
| smlibwasm against smlibpy: the text of the writers smlibwasm has its own copy of (STEP, USD, DXF, OBJ, glTF, STL) for the same bodies, and the numbers of some modelling steps, with the known differences of the builds (`KNOWN`) | `python tools/parity.py [--update]` writes or checks `tests/data/parity`; `js/test/lane_WN.test.ts` compares smlibwasm with it | text that differs but for numbers to 1e-9, a number off by more than 1e-7 of it, a count or an error that differs, a known difference that went away |

The fuzz run's invariants: every result is a valid body within its box's volume;
|A u B| + |A n B| = |A| + |B|, |A - B| = |A| - |A n B| and the cells of `A.merge(B)` add up to
|A u B| (1e-6); fillets, chamfers, shells and offsets of a single primitive have the exact volume
(2e-6), a shell removes volume, `offset(d).offset(-d)` of a primitive is the primitive; the parts
of a slice add up to the body. A new failure is made smaller (the edges a fillet rounds, the
openings of a shell) and written as a pytest file (`repro/` in the output directory, an artifact
of the workflow). Seeds 7 and 8 take about 55 s each language on an M-series Mac. A few Booleans
of seed 8 come out differently from run to run, so the baseline (per platform:
`--update-baseline --repeat 3` writes this platform's) unites three runs, and a new failure of a
known seed counts only if two more runs repeat it. Two crash sites are known and not fixed
(`KNOWN_CRASHES` in `tools/fuzz/fuzz.py`): the stitcher's ray behind `cells()`
(`SmBezierAux2d::BuildPolarBox`) and the extended offset mode's merge on filleted boxes
(`SmEdge::CalculateBoundingBox`); smlibpy runs both steps in another process.

## Building the kernel

The build compiles about 250 C++ files and takes a minute or two. It is single threaded
inside the kernel unless oneTBB is available (`-DSMLIBPY_USE_TBB=ON`, used for parallel
tessellation and Boolean preprocessing).
