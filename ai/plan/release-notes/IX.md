# Lane IX: STEP import and export, USD, IGES import (batch 1: I3, I4, I5, I6, I7, I8, I9, I10, X3; batch 2: I11, I12, I13; batch 3: X5, X7, I14)

Everything applies to smlibpy and smlibwasm alike unless marked. Codes are the plan's items
(ai/plan/kernel-deep-dive.md). Corpus numbers: the 154 classcad-mcp parts and 294 other local
STEP files (448 in all), each imported, measured and written back to STEP before and after.

## Fixed

- O-rings import (I3). A torus whose seam runs along its outer equator (OpenCASCADE writes
  O-rings so) gave a seam angle of +6e-15 degrees, and the window around the tube the importer
  made of it, -359.99999999999994 to 0, the kernel refused: `KernelError import STEP failed
  (SM_ERR)`. 3 of the 154 classcad-mcp parts failed so, and one O-ring aborted the 143 MB Citrus
  Epsilon assembly. The window now starts at 0 (in both ports, and the kernel call clamps it
  too): the O-ring is valid, 22.2066 (= 2 pi^2 R r^2).
- Solids with cavities (`BREP_WITH_VOIDS`) whose faces leave gaps import (I4). The void region
  was accepted only within 1e-6 of the solid's volume; the Kraken X60 motor (2230 faces, 16
  cavities, one of them a 2-face sliver of 1e-5 mm3) came out 0.4-6.6 mm3 off of 195,950, so
  both builds were refused, 16 Boolean cuts ran, and the import failed after 18.5 s with "cut
  failed: the operands may touch", after 15 RuntimeWarnings about cavities the user never sees.
  The tolerance is now 2 x the gaps of the pieces' faces times their volumes (16.6 mm3 there),
  a build is taken only if it is closer to the right volume than to the one a wrongly turned
  cavity gives (0.4 against 154 mm3), and the volumes are integrated without warnings. The motor
  imports valid (195954.22; OpenCASCADE: 195991.4, and calls it invalid). Where the Boolean
  fallback fails too, the error says so and names the body.
- Faces that do not share their edges are stitched (I5). A writer that gives every face edges of
  its own, or vertices a little apart, gave a Part with `is_valid() == False` and no warning, and
  `heal()` could not repair it. The importer now heals, then stitches (the kernel's stitch, then
  explicit tolerances doubling from the file's declared uncertainty, or the gaps the kernel
  measured, up to 1e-3 of the body's size), heals the stitched body where a seam needs it, and
  keeps it only if it is valid, its faces' gaps measured too. A block with a hole rewritten so
  that no two faces share an edge comes back valid, 7 faces, 14 edges, its exact volume; with
  vertex gaps of 1e-4 and 1e-3 valid too. Surface models whose faces share no edges are sewn.
  (The verifier's "valid, 14 edges" for vertex gaps came from before 0.5's gap check: those
  stitched bodies had a hole face of area 0.)
- One unreadable body no longer loses the file (I6). Any failure in one body ended
  `import_step` and `read_step` with a bare `NotImplementedError: curve type OFFSET_CURVE_3D`
  naming neither the entity nor the body. Each body is now read and built on its own; one that
  fails is left out with a warning naming the body, its entity, its product and the reason, and
  the reader's messages name the entity (`curve type OFFSET_CURVE_3D (#203)`).
- Assemblies build each product once (I7). The reader hands out the same body data for every
  instance of a product, and each was built again: 251 instances of 152 bodies in the Citrus
  shooter pivot (24,298 faces built for 11,981), 1472 of 714 in Citrus Epsilon. Later instances
  are now the first one moved to their places. The shooter pivot imports in 50.5 s, all 251 parts
  valid (before: failed on its motors; 79 s with I3 and I4 alone).
- Import integrates each shell once (I8). `_positive`, `_sound` and the seam check asked the
  kernel for the volume three or four times per closed shell (part 78, 2079 faces: 1.9 of 8.2 s),
  and the check of inverted faces ran the seam check on every face. Now one coarse integration
  per shell, passed on to the checks, and the seam check only for the faces found inverted.
  With the same native build, part 78 imports in 5.0 s instead of 7.8 and part 146 in 1.5 s
  instead of 2.1; the 448 corpus files give the same bodies, except where I4 and I9 fix them.
- Imported faces get their own parameter domain (I9). The builder gave each face its surface's
  whole domain; the kernel's search for a point inside a face (20 lines across the domain) then
  missed narrow torus strips, so `Face.interior_point()` and `export_step` of valid imports raised
  a raw `RuntimeError: SmApiFaceInternalPoint failed` (117 faces of part 146, 3 of part 78; a
  small torus patch, `Torus(10, 3) & Box(1, 1, 1).translate(12.8, 0.3, 0)` written and read back,
  4 faces). After the body is built, each face's domain is narrowed to its trim curves in the
  directions it takes less than half of (where trims span most of a closed surface's period, a
  band between helices, the face can reach past their box: that direction keeps the whole
  domain). On the 448 corpus files only these faces changed, and imports got faster (part 146:
  1.05 s; the trim curves the check of inverted faces made are made once). `export_step` falls
  back to the middle of the face's domain where the kernel still finds no point, and
  `Face.interior_point()`, `Edge.distance_to()` and the STEP writer's queries raise `KernelError`.
  `Part.fillet`'s size check leaves out a pair of edges whose closest point the kernel cannot
  find, instead of raising the kernel's raw error (`fillet1019.smb`: now `KernelError fillet
  failed` from the fillet itself).
- STEP names keep their characters (I10, ai/todo/files.md #16): non-ASCII characters are written
  in ISO 10303-21's `\X2\` encoding (`\X4\` beyond 16 bits), backslashes doubled (a name with a
  backslash gave a broken string). `named("Bügel")` comes back as `Bügel`, also in OpenCASCADE.
- USD names of any characters (X3). `prim_name` replaced bytes, not characters: "Größe", "café"
  or "部品" made `export_usd` raise `UnicodeDecodeError` natively (invalid UTF-8 on macOS), and the
  wasm wrote "Gr____e" and "______" (colliding names). Every character but ASCII letters, digits
  and `_` is now one `_` (`Gr__e`, `__`, made unique as before), the name itself is written as the
  prim's `displayName`, and `import_usd` names the body by it.
- Offset surfaces are written exactly (I11). A body with one offset face (the fillets of SMLib's
  `.smb` files, offsets read from STEP) went to NURBS whole (`to_nurbs`, which fits offsets
  loosely), without a warning: `vase.smb` written and read back changed its volume by 7.7e-3, its
  planes came back as B-splines (11 B-spline faces) and its faces left gaps of 1.9e-2. Offset faces
  are now `OFFSET_SURFACE`s of their basis (the basis written as it is: a plane, cylinder, cone,
  sphere or torus as such, a B-spline with its control points), the distance turned where STEP's
  normal of the basis runs against the kernel's. `vase.smb` comes back with its 4 offset, 3 plane
  and 4 B-spline faces and 5.1e-7 of its volume; vase1, vase2, vase3 and fillet1017 with 3.2e-6,
  7.7e-9, 8.9e-7 and 3.6e-7 (before: 3.9e-5, 5.0e-4, 3.4e-4, 1.7e-3), what re-trimming fillets
  costs, as for fillet bodies without offsets (bottle.smb: 8.8e-6). Offsets of
  planes, cylinders (in and out, holes), cones, spheres and tori written and read back are exact,
  and OpenCASCADE reads them to the same volume. Of the 144 pt_TestFiles parts both versions load,
  written and read back, only the 5 with offsets changed.
- Imported cylinders are written as cylinders (found with I11). The importer builds STEP
  cylinders as the kernel's own cylinder type, which the writer wrote as rational B-splines (SMLib's
  primitives are cones of angle 0): a file read and written again lost its `CYLINDRICAL_SURFACE`s,
  `faces().cylinders()` found nothing after a second round trip, and OpenCASCADE dropped an offset
  of such a cylinder (it needs a C1 basis; the rational B-spline is C0).
- smlibpy only: a body the writer has to convert to NURBS was freed while it was written (the
  writer kept its Brep, not the body), and `export_step` of `vase.smb` crashed with a segmentation
  fault on the phase 1 branch (0.4 read the freed memory by luck).
- The STEP uncertainty is the same length in any unit (I13): `1e-7` was written in the file's
  unit, so a file in meters declared 1e-4 mm and one in inches 2.5e-6 mm. It is 1e-7 mm now,
  converted (`1.E-10` in meters, `3.93700787401575E-9` in inches); the importer's stitching starts
  from it (I5).

- USD round trips keep line, circle and ellipse edges (X5). The writer forced every edge curve to a
  B-spline ("all curve types are currently converted to BSplines"), so `Box(20, 20, 10) -
  Cylinder(4, 20)` written and read back had 14 B-spline edges instead of 12 lines and 2 circles:
  `edges().circles()` found nothing, `Edge.radius` raised (`not a circular edge but a bspline`) and
  STEP of the body read back held 45 `B_SPLINE_CURVE`s and no `CIRCLE` or `LINE`. Lines, circles
  and ellipses are now written as the schema's `BrepCurve3dLineAPI`, `CircleAPI` and `EllipseAPI`
  (a line with a unit direction and its range in length, a circle or ellipse in the frame it runs
  counterclockwise in, its range in radians); a circle or ellipse on a face written as NURBS stays
  NURBS (the UV curve the file gives on that face follows the NURBS parameters, which the schema's
  circle does not keep). The block comes back with its 12 lines and 2 circles, radius 4.0, its STEP
  with 2 `CIRCLE`s and 13 `LINE`s; fillets (24 circles), ellipses of a slanted cut, chamfers,
  cones, spheres, tori, lofts and sweeps keep their edge types, volumes within 3e-12, and usd-brep's
  validator passes the files. The files are smaller (the block 7516 -> 6557 bytes without meshes).
- B-spline edges that are lines or circles come back as such from other writers' USD files (X5).
  usd-brep and Omniverse write every edge as a B-spline; `import_usd` now gives lines back as lines
  (spanning their edge) and circular arcs on faces of planes, cylinders, cones, spheres and tori as
  circles (`SmCurve::CreateAnalyticCurve`, exact; `restore_analytic_curves` moved out of
  `face_draft.cpp` into `analytic.cpp`). Of usd-brep's 767 B-spline edges in its readable test
  files, 754 come back as lines, their bodies' volumes, areas, validity and meshes unchanged.
  Circles on B-spline faces are not restored: replacing the curve drops the face's UV curves from
  the file, and the kernel's own, made again from a circle, emptied a cap face of OpenCASCADE's
  NURBS cylinder (volume halved). smlibpy's own files are read as written.
- A USD body the kernel cannot build is named in the error (X7): `str(KernelError)` was `import_usd
  failed (SM_ERR_INVALID_INPUT)`, the prim only in `.detail`. It is now `import_usd failed
  (SM_ERR_INVALID_INPUT): body 0 of the BrepArray "/World/c" could not be built; partial=True leaves
  such bodies out and reads the others` (smlibwasm: `partial: true`). (A sphere of radius 0, the
  finding's probe, is a `ValueError` naming the prim since X1; a cylinder face whose range turns 60
  radians still fails in the conversion.)
## New

- `import_step(path, *, heal=True, strict=False)` and `read_step(..., strict=False)`
  (`fromStep`/`importStep`/`fromStepModel`/`readStep` take `{ strict }`): `strict=True` raises
  `ModelingError` naming the first body that cannot be read, instead of leaving it out.
- `StepModel.skipped`: one message per body left out (`"body 'b' (#99, product 'P'): curve type
  OFFSET_CURVE_3D (#203), which is not supported"`); `repr` adds `, 1 skipped`.
- `export_step(shapes, path, *, assembly=False)` (`toStep`/`exportStep` take `{ assembly }`):
  each body a `PRODUCT` of its own, named as the body, under a root product called `name`, placed
  by `NEXT_ASSEMBLY_USAGE_OCCURRENCE`, `CONTEXT_DEPENDENT_SHAPE_REPRESENTATION` and an
  `ITEM_DEFINED_TRANSFORMATION` (CAx-IF practice). A body listed more than once is written once
  and placed as often. OpenCASCADE reads the products by name and the repeated body as one shape
  placed twice (`IsPartner`); `import_step` gives the bodies back with names and colors.
- Warnings on import (RuntimeWarning, smlibwasm's warning handler): a body left out, a body
  stitched (with the largest gap closed), a body nothing could repair (with what is wrong).
- smlibwasm: `k.stitch_advanced` (the kernel's stitch with an explicit tolerance), as smlibpy has.
- The STEP reader's body data carry the product, the entity and the declared length uncertainty
  (`BodyData.product`, `.entity`, `.uncertainty`), and `interpret(sf, skipped=[...])` collects the
  bodies it cannot read instead of raising.
- `export_step` writes curves, points and coordinate systems (I12; `toStep`/`exportStep` too). An
  `Edge` or `Wire` is a curve of wireframe geometry (one `GEOMETRIC_CURVE_SET` in a
  `GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION`: lines, arcs and ellipses as trimmed
  analytic curves, B-splines with their control points, a wire as one composite curve), a `Vertex`
  or `Vector` a point, a `Plane` a coordinate system (a named `AXIS2_PLACEMENT_3D` of supplemental
  geometry, CAx-IF's `CONSTRUCTIVE_GEOMETRY_REPRESENTATION`). `StepCurve(name, shape, product,
  color)`, `StepPoint(name, point, ...)` and `StepFrame(name, plane, ...)` name them (curves and
  points with their colors), and a `StepModel` from `read_step` is written whole: `read_step` ->
  `export_step` -> `read_step` keeps the bodies, frames, curves and points with names, colors and
  types. With `assembly=True` an item whose `product` names a body goes into that body's product,
  the others into the root. OpenCASCADE reads such files (the solid and the curves).
- `StepFrame`, `StepCurve` and `StepPoint` are exported (`from smlibpy import StepFrame`; in
  smlibwasm as values, they were types only).
- A warning when `export_step` has to convert a body to NURBS: `export STEP: 'vase' has 4 faces
  on an offset surface that reaches past its basis, which STEP cannot hold as the kernel does:
  the body is written converted to NURBS (to_nurbs), which approximates them`.
- `ext.surface_data` and `ext.brep_dump` give an offset surface's `distance`, `basis` (a nested
  offset's distances added) and the `extended` basis where the kernel made one (both builds).

- `import_usd(path, *, partial=False)` (`fromUsd`/`importUsd` take `{ partial }`), X7: leaves out
  the bodies that cannot be read (a malformed BrepArray, a body the kernel's check refuses, one the
  conversion cannot build) with one `RuntimeWarning` each (`import_usd: body 0 of the BrepArray
  "/World/c" could not be built (SM_ERR_INVALID_INPUT); it is left out`) and returns the others,
  as usd-brep's `allow_partial`. A BrepArray of several bodies is taken apart: a body whose values
  break a rule of the validator is left out alone (`body 1 of the BrepArray "/World/brepArray" is
  malformed: face 0: its NURBS surface has a weight of 0, not positive (BA.440)`). A file none of
  whose bodies can be read raises `ValueError: import_usd: no body of the file can be read: ...`.
  The C++ (`usd_stage`, `UsdReadOptions::partial`, `UsdStage::skipped`) serves both builds.
- `import_iges(path, *, heal=True, strict=False)` (I14; smlibwasm `fromIges(data, { heal, strict })`
  and `importIges(path, ...)`), and `load` of `.igs` and `.iges`: the solids and surfaces of an
  IGES file (5.3, ASCII), in mm from any unit, named (name property 406 form 15, or the entity's
  label) and colored (color numbers, color definitions 314). A new reader (`iges_reader.py`/`.ts`:
  the fixed-format sections, the global parameters, directory entries, free-format parameters with
  Hollerith strings) turns the file into the STEP importer's neutral body data, which its builder
  builds. Solid B-rep objects (186, with 514/510/508/504/502; open shells 514 as sheets) share the
  file's edges; trimmed surfaces (144 with 142), bounded surfaces (143 with 141), bounded planes
  (108) and untrimmed B-spline surfaces (128, 114) become faces of their own, which are stitched
  (the kernel's stitch, then gaps up to 1e-4 of the model's size), each set that closes up a `Part`.
  Curves: 100, 102, 104 (ellipses, hyperbolas, parabolas wherever their equation puts them), 106
  (linear paths), 110, 112 (to cubic B-splines), 126. Surfaces: 108, 114 (to bicubic B-splines),
  118 (through the kernel's ruled surface), 120 and 122 (planes, cylinders, cones, spheres and tori
  where they are those, else revolutions and extrusions), 128, 140, 190-198. Transformation
  matrices (124, also nested), subfigure instances (408 of 308, moved and scaled). A face's
  orientation is the IGES surface's normal (`sense` per surface spec, mirroring transformations
  included); a face whose outer loop runs clockwise in its surface's parameters is turned over, a
  hole running the outer loop's way turned round (the kernel's new `ext.loop_areas`), slivers of no
  area dropped. A boundary given only in a B-spline surface's parameters is taken onto it
  (`ext.curve_on_surface`, `SmCrvOnSurf::ApproximateCurve`, within 1e-6 of its size). Untrimmed
  surfaces become faces through `ext.surface_face` (`SmBrep::CreateFaceFromSurface`). Checked
  against OpenCASCADE 8.0: 15 smlibpy parts (box, block with a hole, chamfer, fillets, cone, sphere,
  torus, slanted cylinder of ellipses, extruded ellipse, revolve, loft, sweep, plate with holes, two
  boxes, a B-spline sheet) and three OCCT models (a revolved B-spline, its mirror image, a prism of a
  B-spline) written by OCCT's IGES writer as trimmed surfaces and as B-rep objects, in mm and inches
  (66 files): all read valid within 1e-9 of the volume they were written from (OCCT's own reading
  of its files misses by up to 3e-2: the torus as faces 0, the revolve 2874.6 for 2853.6); the four
  IGES models FreeCAD ships (OpenCASCADE 6.5, inches, gaps up to 2e-3 mm) give the same closed
  bodies as OCCT's sewing (volumes 66.3136 x 2 + 586.350, 3.55282, 1.06938, 3.38245 x 2 + 0.486 +
  0.00785) and leave open what OCCT leaves open; Inventor's 186 cube reads with its name and color.
- `ext.loop_areas(brep)` (both builds): per face the signed area each loop encloses in the face's
  parameters, and the size of its domain; `ext.inverted_faces` is now computed from it (same
  result).
- smlibwasm: `IgesImportOptions`; `_reading`, `_label`, `_buildBody`, `_kernelVolume` and `_text`
  of `step_import.ts` are exported for `iges_import.ts`.
## Behaviour changes

- A STEP file with a body that cannot be read no longer raises: the other bodies come back, with a
  `RuntimeWarning` for the one left out. A file of two bodies can so give a single `Part`. Only a
  file none of whose bodies can be read raises (`ModelingError: import STEP: no body of the file
  could be read: ...`).
  ```python
  # 0.4: NotImplementedError: curve type OFFSET_CURVE_3D (and no body at all)
  parts = import_step("asm.step")               # 0.5: the readable bodies, and a warning
  parts = import_step("asm.step", strict=True)  # 0.5: ModelingError naming body and entity
  read_step("asm.step").skipped                 # 0.5: what was left out, and why
  ```
- With `heal=True` (the default), an imported solid whose faces do not share their edges is
  stitched and comes back valid, with other edges (28 -> 14) and sometimes a face split at its seam
  by the healer; a warning says so. A solid nothing repairs comes with a warning too.
  ```python
  part = import_step("per_face_edges.step")             # 0.5: stitched, valid, warning
  raw = import_step("per_face_edges.step", heal=False)  # the file's topology, as 0.4 gave it
  ```
- `import_usd` names a body by its prim's `displayName` where the prim has one, so names that are
  no prim names come back as written; the prims smlibpy writes for such names change.
  ```python
  export_usd(Box(1, 1, 1).named("Bracket #1 (left)"), "a.usda")
  import_usd("a.usda").name   # 0.4: 'Bracket__1__left_'   0.5: 'Bracket #1 (left)'
  # the prim is Bracket__1__left_ in both; "Größe" is the prim Gr__e (0.4: UnicodeDecodeError,
  # wasm "Gr____e")
  ```
- STEP names with non-ASCII characters are written encoded, not as `?`:
  ```python
  export_step(part.named("Bügel"), "b.step"); import_step("b.step").name   # 0.4: 'B?gel'  0.5: 'Bügel'
  ```
- `Face.interior_point()` and `Edge.distance_to()` raise `KernelError` (a `RuntimeError`, so
  `except RuntimeError` still catches it) where they raised the kernel's raw `RuntimeError`; in
  smlibwasm a `KernelError` where they threw a plain `Error`.
  ```python
  try:
      p = face.interior_point()
  except KernelError:          # 0.4: except RuntimeError (still works)
      ...
  ```
- The STEP reader's `NotImplementedError` messages name the entity: `curve type OFFSET_CURVE_3D
  (#203)` (0.4: `curve type OFFSET_CURVE_3D`). A pattern that matched the whole message must
  allow the suffix.
- A `BREP_WITH_VOIDS` solid within the gaps of its faces is the void region the file describes,
  where 0.4 subtracted the cavities (or failed): its volume and face count can differ from 0.4's
  Boolean result by the gaps (the motor: 2245 faces, 195954.22).
- Imported faces narrow in a direction have their own parameter domain there: internal sampling
  (point inside, mesh grid, draft and deformation checks) works on them, and their meshes can
  differ slightly from 0.4's.

- STEP files from bodies with offset faces hold `OFFSET_SURFACE`s instead of approximating
  B-splines. OpenCASCADE (FreeCAD) drops an offset face whose basis is a B-spline with C0 knots
  (it needs a C1 basis); the old output is one call away:
  ```python
  export_step(vase, "vase.step")               # 0.5: OFFSET_SURFACE, exact
  export_step(vase.to_nurbs(), "vase.step")    # what 0.4 wrote (volume off by up to 1e-2)
  ```
- Imported cylinders are written as `CYLINDRICAL_SURFACE`, and come back as cylinders, where 0.4
  wrote and gave back B-splines:
  ```python
  again = import_step("in.step"); export_step(again, "out.step")
  import_step("out.step").faces().cylinders()  # 0.4: [] (B-spline faces)  0.5: the cylinders
  ```
- `export_step` warns (`RuntimeWarning`) where it converts a body to NURBS, which 0.4 did silently:
  ```python
  warnings.filterwarnings("ignore", "export STEP")   # to silence it
  ```
- `export_step` writes edges, wires, vertices, Vectors and Planes, where 0.4 raised
  `TypeError: 'Edge' object is not iterable` (`'float' object ...` for a vertex). What it cannot
  write raises `TypeError: cannot write a Location to STEP` (0.4: `'Location' object is not
  iterable`).
  ```python
  export_step([part, part.edges()[0]], "p.step")   # 0.4: TypeError  0.5: the part and a curve
  export_step([part, *edges], "p.step")            # filter edges out first for 0.4's output
  ```
- The declared uncertainty of files in other units than mm changes (meters: `1.E-10` instead of
  `1.E-07`); files in mm write `1.E-7` for `1.E-07` (the same number). A receiver that takes the
  declared uncertainty as its tolerance works to 1e-7 mm in every unit. Nothing to migrate.
- `from smlibpy import *` brings `StepFrame`, `StepCurve` and `StepPoint` along.

- `export_usd` writes lines, circles and ellipses as `BrepCurve3dLineAPI`, `CircleAPI` and
  `EllipseAPI` edges (X5). Readers of the omniSolid schema (usd-brep, Omniverse, smlibpy 0.4's
  `import_usd`) read them; a tool of one's own that read only `edge3dNurb` arrays has to read the
  analytic ones too, or convert:
  ```python
  export_usd(part, "p.usda", mesh=False)               # 0.5: line, circle, ellipse edges as such
  export_usd(part.to_nurbs(), "p.usda", mesh=False)    # B-spline edges (and faces) only, as 0.4 wrote
  ```
- `import_usd` gives the B-spline edges of other writers' files that are lines (and circles on
  analytic faces) as lines and circles: their `geom_type` is `"line"`/`"circle"` where 0.4 said
  `"bspline"`, and `export_step` writes them as `LINE`/`CIRCLE`. Code that picked such edges by
  `geom_type == "bspline"` picks them by their geometry instead:
  ```python
  cube = import_usd("Cube.usda")          # usd-brep's test cube
  cube.edges().filter_by(lambda e: e.geom_type == "bspline")   # 0.4: 12 edges, 0.5: none
  cube.edges().lines()                                          # 12 in both
  ```
- The `KernelError` of a USD body the kernel cannot build says which body (X7): its message (not
  its type or status) changes; a pattern that matched `import_usd failed (SM_ERR...)` exactly must
  allow the text after it.
  ```python
  except KernelError as e:                 # unchanged; str(e) now names the body
      print(e.detail)                      # as before: usd: body 0 of the BrepArray ...
  ```
- `load` reads `.igs` and `.iges` (I14), where 0.4 raised `ValueError: unknown file type '.igs'`;
  the message for other extensions lists them: `load reads .step, .stp, .igs, .iges, .stl, .smb,
  .dxf and .usda` (0.4: `.step, .stp, .stl, .smb, .dxf and .usda`).
  ```python
  load("part.igs")     # 0.4: ValueError   0.5: the part (import_iges)
  ```
- The STEP builder's warnings and errors name the format they build for: unchanged for STEP
  (`import STEP: ...`); IGES solids say `import IGES: ...` and name the entity `solid 'x' (DE 57)`.
## Not done

- I6's wider coverage: reading `OFFSET_CURVE_3D` edges (the kernel's `SmOffsetCurve`) and edges
  given only as `PCURVE`s (`SmSTEPSurface`). No file in the 6781-file corpus was shown to hold
  them (the reviewer's probe renamed a `CIRCLE`), so a reader for them could not be checked
  against a real file. Such bodies are now left out with a warning instead of losing the file.
- I10's instancing of moved copies: a body moved from another (`bolt.translate(...)`) keeps no
  link to it, so only the same object listed more than once is written once. A placement-only
  Assembly type is in the plan's "Not planned".
- I4 has no black-box test: no constructed file reproduces the motor's deviation (cavities built
  alone and inside the solid integrate to the same volume). The tests inject the cavity's measured
  volume and gaps (white box); the motor itself (crescendo part 12) was checked by hand.
- Mirrored assembly placements stay unread: the reader takes placements from
  `AXIS2_PLACEMENT_3D`s only, which cannot mirror (`CARTESIAN_TRANSFORMATION_OPERATOR_3D` is not
  read).
- An offset of a whole sphere (a face bounded by its seam alone) does not import: `import_step`
  builds it without volume (OpenCASCADE reads it). The writer writes such faces exactly, but the
  round trip could not be tested; offsets of sphere patches round-trip. Found with I11, an importer
  gap (the seam handling of spheres does not look through an offset).
- A coordinate system's color (`StepFrame.color`) is not written: placements have no style other
  CAD systems show.
- I11's offsets of B-spline bases with C0 knots stay unreadable for OpenCASCADE (see Behaviour
  changes); converting such faces with a checked fit, the plan's alternative, was not done: the
  exact surface is what other systems (and `import_step`) read.
- Only `export_step` writes curves: `save`, `export_stl` and `export_obj` still raise the
  messages of ai/todo/files.md #8 for edges.
- X5: circles and ellipses on faces written as NURBS (surfaces of revolution and extrusion, offset
  surfaces) stay NURBS edges in USD, and circles on B-spline faces of other writers' files stay
  B-spline edges on import: the face's UV curves follow the NURBS parameters, which the schema's
  circle does not keep, and the kernel's own UV curves, made again from a circle, emptied a face of
  OpenCASCADE's cylinder. Ellipses of other writers' files are not restored (the kernel's
  `CreateAnalyticCurve` knows lines and circles only). smlibpy 0.4's own files keep their B-spline
  edges (only files of other writers are restored).
- I14: IGES is read only (the plan's item is a reader; write STEP). Not read: binary and compressed
  IGES, offset curves (130), ruled surfaces between circles or conics, a composite curve as the
  generatrix of a surface of revolution or a tabulated cylinder, a trimmed surface with holes whose
  outer boundary is its surface's (N1 = 0 with inner boundaries), a whole face of a surface other
  than a B-spline (an untrimmed 120 or 122), boundaries given only in the parameters of a surface
  that is not a B-spline (its parameters are not kept when it becomes a plane, cylinder, ...), and
  wireframe-only files (curves and points; `read_step`'s counterpart for IGES does not exist).
  Form 0 ruled surfaces (equal arc lengths) are read as form 1 (equal parameters). No real file of
  114 parametric spline surfaces was at hand: they are checked with a constructed patch only.
