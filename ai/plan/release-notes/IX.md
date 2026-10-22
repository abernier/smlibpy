# Lane IX: STEP import and export, USD names (batch 1: I3, I4, I5, I6, I7, I8, I9, I10, X3)

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
