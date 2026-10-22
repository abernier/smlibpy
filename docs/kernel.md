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
       │                 point clouds, USD files (usd-brep's conversion, without OpenUSD)
       ├─ SmPyLib        NVIDIA's pybind11 bindings of SM_API (without the USD parts)
       ├─ SM_API         NVIDIA's C-style API over the kernel
       └─ SMLib          the kernel: geometry, topology, Booleans, fillets, sweeps, healing
```

The kernel sources come in as a git submodule (`third_party/usd-brep`) and are compiled
with CMake into a single, self-contained Python extension. The submodule stays as published.
Kernel defects that smlibpy cannot work around from outside (fillet removal that removed
nothing, reads and writes of freed memory in Booleans) are fixed in copies of two kernel
source files in `third_party/patches`, which the build compiles in place of the originals;
its README lists every change. Where smlibpy needs more than the published bindings offer,
its own C++ module (`src/cpp/ext.cpp`) calls the kernel directly.

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
  most parts a few milliseconds. The quick checks inside operations (is a result inside out,
  did a fillet or a deformation change the volume plausibly) still use the kernel's
  integration at a coarse accuracy.
- **Edge lengths** are integrated per knot span to 1e-12 (the kernel's `SmCurve::Length`
  counts a span whose curve starts with a zero tangent as 0).
- **A body is as exact as its faces meet.** Faces that the kernel fits (B-spline chamfers,
  shell offsets, intersections of curved faces) close up only to about 1e-6 to 2e-5 mm; the
  volume of such a body depends on that by 1e-7 to 4e-6 of its value. Beyond 1e-5 the
  measures say so in a warning (see [Measuring](analysis.md)).
- **STEP export** writes the kernel's exact curves and surfaces. The test suite reads the
  files back with OpenCASCADE and checks validity and volume.
- **STEP import** rebuilds every face on its exact surface and keeps the file's topology,
  so faces share edges instead of being stitched by tolerance.

## Robustness work in smlibpy

Some kernel behaviour is wrapped so that it is predictable:

| Kernel behaviour | What smlibpy does |
|---|---|
| Plane cuts keep the other half than documented and leave the body open | `split` intersects with a half space instead |
| 2D Booleans reject some overlaps (two circles, for one) | falls back to 3D Booleans of thin slabs |
| Fillets larger than the geometry allows can come back as a "valid" solid | checks the radius against neighbouring edges and the volume change |
| Sweeps anchor the profile at the start point of its first curve | centers the profile on the path and orients it |
| A full 360 degree non-manifold revolve returns an empty body | revolves each loop and subtracts the holes |
| Faces on cylinders, cones, spheres and tori need a seam edge, but NX and others write them without one | adds the seam along the surface when importing STEP |
| A few writers flag the bound of a face reversed (fillets on tori, around holes and bosses), so its loop runs the wrong way round; the kernel's seam check then reads the loop as the rest of the torus and cuts the face apart (2 to 30 % of the volume lost, and the body still "valid") | turns such loops round when importing STEP: in a closed shell each edge between two faces is used once each way, so the neighbouring faces decide |
| The seam has to lie where the surface's angle parameter starts | turns the surface frame to the seam edge of the file |
| The extended offset mode depends on memory layout and sometimes builds a face the kernel cannot integrate or mesh | `shell` uses the plain mode first, checks every result and falls back to the extended mode |
| Arcs from the API are plain B-splines | arcs are trimmed kernel circles, so they keep radius and center |
| Mass properties control their integration steps by the area alone: a volume can be 300 times worse than the accuracy asked for | integrates areas, volumes, centers and inertia itself, with an error estimate for each |
| A curve's length leaves out a span that starts with a zero tangent (the outline of a cylinder had 30 mm top and bottom lines instead of 60) | integrates lengths and arc-length positions itself |
| Tessellation cuts each face into a grid placed by the curves along its borders, so a face that is straight in one direction and twisted along it gets one facet across (a twisted bar: 1 mm off) | estimates for every face how far the grid would be off and halves all faces of such a body until they are flat; other bodies keep the kernel's triangles |
| Mesh Booleans leave polygons with holes, which the mesh arrays read by their outer loops (an open mesh) | triangulates every polygon of the result first |
| Fitting a surface to scattered points takes 4 s for 100 points and minutes for 300 | fits clouds itself (least squares with smoothing): 20,000 points in 50 ms |
| A curve-face intersection fails where a ray runs parallel to a plane or along a cylinder without meeting it | `raycast` intersects such faces through their mesh and moves the points onto the exact surface |
| Blending two surfaces changes them, so a second blend of the same surfaces fails | `surface_fillet` blends copies |
| Moving a body with a 4x4 matrix (`SmBrep::Transform`) resets its tolerances from the box of its vertices, and the model size of the shared context with them: a moved torus (one vertex) gets tolerance 0 and its Booleans go wrong, a part over 500 across gets 1e-4 | applies rotations, reflections and uniform scales with a placement, as SM_API does, and sets the tolerances of a scaled body from its whole box |
| Point classification (`SmBrep::Point3DClassify`) takes the region from one ray along +X; once a tight bounding box was computed, that ray can miss a face it crosses (a point inside a cylinder fused with a torus came out outside) | `classify` lets rays in two more directions off the axes vote, two more when they disagree |
| A Boolean that misclassifies the operands can return an empty cut, and the intersection of the same pair, its natural check, then returns the whole part (a tool beside an earlier hole in a sphere, a corner box on an imported pulley) | accepts an empty cut only from tools that hold the part's volume and span its box, and checks points of an intersection that reaches out of an operand's box against the operands |
| A failed Boolean keeps both operands and leaves the context marked as doing a Boolean (it then builds no surface caches) | holds the operands' copies until the kernel takes them and clears the mark (`ext.boolean`) |
| The offset code behind shell, offset and thicken reads memory it has freed (in its extended mode, depending on memory layout): it glued a Vertex it had deleted, kept a deleted ProtoEdge in the lists of other ProtoFaces, and handed out an extended surface after deleting it, and the process crashed now and then | patches the three sites (`third_party/patches`), and runs the kernel steps in a forked copy of the process, whose body comes back as an exact copy |
| shell and offset return bodies whose faces do not meet, a shell without its cavity, or the part itself, and their wall check missed turned parts | refuses results whose faces leave gaps of 1e-3 of the volume, checks a closed shell against the part less its offset and the cavity where no wall reaches, and measures walls across the faces of a part with openings |
| usd-brep's conversion writes cones the omniSolid schema does not allow (a semi-angle of 0 or below), and trusts the arrays of a file it reads (a malformed one crashes it) | writes such cones as cylinders or turned around; checks every array and reference before converting |

## Known kernel limitations

From usd-brep's own list of known issues, the ones that can matter here:

- `heal` may report success without repairing everything; check `is_valid()` afterwards.
- Healing of imported periodic faces (tori, spheres) can go wrong.
- Rounds where three fillets meet at a corner of mixed convexity can fail; round the
  edges in a different order or with different radii.
- `shell` cannot remove a face that is bordered by fillets; shell first, then round the rim.
- The offset code behind `shell`, `offset` and `thicken` depends on memory layout in its extended
  mode: the same call can fail, succeed or crash. smlibpy runs it in a forked copy of the process
  (Linux, macOS; smlibwasm: in a kernel of its own) and tries a mode again only after a result it
  refused, not after an error.

## Building the kernel

The build compiles about 250 C++ files and takes a minute or two. It is single threaded
inside the kernel unless oneTBB is available (`-DSMLIBPY_USE_TBB=ON`, used for parallel
tessellation and Boolean preprocessing).
