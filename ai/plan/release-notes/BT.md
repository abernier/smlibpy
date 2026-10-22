# Lane BT: Booleans along seams and beside earlier holes (B6, B4, B10); empty results, sheets, imprints, history and checks (B13, B12, B14, T3, T4); cells, solids, joints, sections and error hints (B15, B16, B17, B18, B19)

Everything applies to smlibpy (Python) and smlibwasm (JavaScript) alike unless marked "native" or
"wasm". The seam logic is C++ in `src/cpp/seams.cpp`, called from `ext.boolean`, so both builds run
the same code.

## Fixed

- Booleans in which the faces cross along a curve tangent to the seam of a cylinder, cone, sphere
  or torus give the right body (B6). The kernel returned a valid body of the wrong volume there,
  or failed. A groove pin tangent to a bore, `(Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2,
  60).rotate(Y, 90).translate(0, 5, 0)`, gave 24331.7029 (wasm 24364.1472) and is now 24299.2587,
  the exact value; at y = -5 it gave 24461.4800. Two cross holes, `Box(20, 20, 20) - Cylinder(3,
  40).rotate(Z, 90).translate(0, 3, 0) - Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)`, gave
  7057.1895 and are now 6931.7476. `Cylinder(2.5, 30).rotate(Y, 90) & Sphere(2).rotate(X,
  90).translate(0, -0.5, 2.5)` gave 81.7551, more than the sphere, and is now 13.6259; `pin &
  bore` of the groove pin gave 194.6656 for 32.4443. smlibpy finds such seams (along each seam the
  distance to the other body's planes, cylinders, cones, spheres and tori) and turns the operand
  whose seam it is about its own axis first, where that keeps its shape (every face a plane across
  the axis, or a cylinder, cone, sphere or torus about it: primitives, hole tools, revolved
  parts). The Boolean runs on copies, at up to three angles that clear the seam; a result whose
  volume lies outside the bounds the operands' volumes set is passed over (one fuzz case's union
  came out as one cylinder alone when turned by 45 degrees), and where the kernel fails with each
  angle the operands go in as they are, as before. Seams where the two faces themselves touch (a
  cylinder tangent to a plane along its seam, two cylinders touching at a point) are left alone:
  turning them made Booleans that worked fail.
- Merges of the same kind are right: `pin.merge(Sphere(2).rotate(X, 90).translate(0, -0.5,
  2.5))` raised "less than that of the largest part" (the kernel's 518.314) and is now 586.4432
  (OpenCASCADE 586.4432), its cells adding up.
- Crossing holes whose seams lie tangent to the other hole compute natively (B4): `Cylinder(3,
  40).translate(0, 3, 0) & Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)` raised
  `SM_ERR_BAD_INTERSECTIONS` and is now 62.7209 (integration 62.720958; OpenCASCADE 62.7209); the
  union 2199.2258, the cuts 6931.7476 and the merge's cells too, in both builds (the wasm had only
  the intersection). The kernel's own Boolean of these still fails cleanly (patch K1).
- A single tool beside an earlier parallel hole or boss works (B10): the kernel fails where the
  two cylinders cross along lines, and smlibpy now tries again with a NURBS copy of the tool,
  whose faces come back analytic, and accepts the result only if its volume lies within the
  operands' bounds. `(Box(40, 40, 10) - Cylinder(6, 30)) - Cylinder(3, 30).translate(8, 0, 0)`
  raised KernelError and is 14612.2528 (exact 14612.2526); the same in a cylinder (44714.4938),
  a boss fuse (18081.6211) and the intersection (256.7738 for 256.7741). In a sphere the cut was
  refused as empty and the intersection as "partly outside an operand"; they are 28160.6083 and
  929.1883. Several tools at once are combined first, as before, and only then tried as NURBS
  copies, so lists keep their exact analytic result.

Measured with the seeded fuzz harness of the phase-1 review (seeds 7 and 8, and eight new seeds
11 to 18 with mostly Booleans: 3,270 cases, about 19,100 checked operations per build), against the
same build with the seam turning switched off: natively, silent wrong results fell from 76 to 72,
crashes from 2 to 1 and errors from 1068 to 1057 (with B10); in the wasm (turning alone, B10 in
both) from 79 to 72, 2 to 1 and 1026 to 1021. No operation went from right to silent or to an
error, apart from two that are noise or old: `csg-8-23`'s difference flips at 1.25e-6 between
processes (the kernel's intersection of that pair differs from run to run, with the turning off
too), and `csg-11-132`'s union, 1358.54 (OpenCASCADE 1446.61) in both runs, is now caught by the
harness's invariant because its intersection and difference compute (B10). AddressSanitizer
reported nothing in the new code over the lane and guard tests and seeds 7, 8 and 11 to 14 (one
report, in the kernel's fillet executive, fillet-7-185, is older and outside this lane).

- Empty Boolean results are checked without the kernel's `brep_relationship` (B13), which calls
  overlapping bodies "touching" (spheres with 18.6 in common, a pin through a plate), changes its
  answer with where the bodies are and with what was asked before, and is slow. An empty
  intersection is right where the operands' loose boxes are apart, or where their meshes (at
  tessellate's tolerance) share no volume, up to 1e-6 of the smaller one or a volume that shrinks
  to less than half at a tenth of the tolerance (a concave face touching the other body); an empty
  cut where the tools can cover the part and nothing of its mesh is left outside theirs. Where the
  kernel's mesh Booleans fail (meshes with faces in common), points of the meshes are classified
  exactly instead (`Part.classify`, within the mesh tolerance). Before, the same right empty
  intersection of face-touching boxes, `Box(10, 12, 12) & Box(4, 20, 12).rotate(X,
  90).translate(7, 0, 4)`, was accepted at the origin and raised "the kernel returned a result
  that is empty" with both moved by (101.3, -57.9, 33.1) (Python; the wasm accepted both); it is
  empty in both places now. The empty intersection of two perforated plates of 168 faces 3 apart
  took 11.4 s (wasm 10.9 s), the Boolean 0.13 s of it; now 0.12 to 0.18 s. A kernel that returned
  nothing for overlapping spheres was accepted (relationship "touching"); now it raises. Over the
  fuzz seeds 7, 8 and 11 to 14 (2,110 cases, natively), 61 intersections that raised "the kernel
  returned a result that is empty" are accepted empties now, and the harness's invariants hold for
  them (A - B is A, B - A is B); no operation went from right to wrong, apart from noise: two
  offsets and a shell whose kernel steps flip between runs with the tags or without them
  (offset-8-350, offset-8-360, shell-14-300), and csg-8-98, whose B - A (150.79602 for B's
  150.79645, 2.9e-6) the harness compares with B now that A & B is accepted as empty. In the wasm
  (seeds 7 and 8, which refused fewer right empties) 4 intersections went from the error to the
  right empty result, and csg-8-98 the same way.
- A part split along a sheet, and sheets trimmed by parts (B12). `part + sheet` and `part - sheet`
  returned invalid "Parts" (`Box(20, 20, 20) - wave`: 11 faces, volume 8000, `is_valid()` False,
  no error), and `part & sheet` a "Part" of volume 0 (ai/todo/surfaces.md #11); `sheet - part`
  and `sheet & part` raised `TypeError`. Now `part.split(sheet)` splits along the sheet (3200 and
  4800 of a box of 20 split by z = 2 + 3 sin(x / 6), exact), `sheet & part` (also `part & sheet`)
  gives the piece of the sheet inside the part and `sheet - part` the rest, as Shells (86.43 and
  857.29, adding up to the sheet's 943.72), and `part + sheet`, `part - sheet` raise `TypeError`.
- A selection taken before an edit that split its faces or edges stands for their pieces (T3):
  `cut = box - slot; cut.fillet(box.edges().top(), 1)` raised "Edge(line, (-20, 15, 10) -> (20,
  15, 10)) is not an edge of this part" and rounds all six pieces now (16 faces, valid);
  `cut.shell(-2, box.faces().top())` raised "is not a face of this part" and opens both halves.
- `Shell.heal()` gives a `Part` where the healed faces close around a volume (T4): the faces of a
  box moved apart by up to 0.1 and stitched within 0.5 stayed a Shell after `heal()`, although
  they bound a valid solid.

- The cells of a merged part are named and colored after the parts they lie in (B15): every cell
  got the first part's name and color, in `cells()` and in STEP. `merge(Box(40, 40, 20).named("steel")
  .colored("gray"), Cylinder(6, 30).named("brass").colored("gold")).cells()` gave four cells, all
  "steel"/"gray"; now "steel" (29738.1, gray), "steel&brass" (2261.9, gold) and two "brass" ends
  (565.5, gold). `export_step` of the merged part writes each solid with its cell's name and color,
  and `import_step` reads them back so. The kernel keeps no record (SmMergeRegionAttribute is a
  helper of its manifold Boolean): smlibpy classifies a point inside each cell (one the merged
  part itself classifies into that cell) against the parts given to `merge`.
- `solids()` separates a body that floats in a cavity of another (B16, ai/todo/parts.md LOW #2):
  `((Box(20, 20, 20) - Box(10, 10, 10)) + Box(4, 4, 4)).solids()` gave one solid of 7064 (the
  kernel's CreateOneBrepPerBody keeps nested shells together), now 7000 and 64; three nested
  spheres give three. Only regions that share no face are split: the touching cells of a merged
  part stay one solid, as documented (two boxes merged side by side: one solid of 2000; two
  touching boxes merged inside a cage: 19000 and 432).
- A plane that only touches a part has no section (B18): `Cylinder(5, 20).section(Plane.XZ.offset(5))`
  raised a bare `KernelError: section failed (SM_ERR)`, and the plane tangent to the top of a
  torus, `Torus(10, 2).section(Plane.XY.offset(2))`, returned a disc of 314.159 (π·10²) that does
  not lie in the torus (fuzz case slice-11-272: 78.54 for `Torus(5, 1.5)` at z = -1.5); both raise
  `ValueError: the plane only touches the part`, as a plane through the edge of a turned box does.
  Every section's regions are checked to lie in the part. A plane tangent to a face inside the
  part (the wall of a hole) still makes the kernel fail: `KernelError` with the hint to move it.
- Error hints say what the operands show (B19). In the fuzz seeds 7, 8, 11 and 12 (natively),
  all 221 failed Booleans had the one fixed hint ("the operands may touch ..., or a tool overlaps
  an earlier cut ... combine the tools first"), 219 of them with a single tool. Now each clause is
  given where its evidence is: a round face of a tool tangent to a face of the part (104, with the
  place), operands that only touch (89: no point of one's mesh lies inside the other), a face of a
  tool lying on a face of the part (24, `at z = 2`), a tool beside a parallel hole or boss that the
  NURBS retry did not save, with the advice to combine the tools (3), several tools (also tried
  combined), and, with none of these (25), that none shows. A null pointer of the kernel's own
  (`SM_ERR_NULL_POINTER`) or a trap of the wasm reads "the kernel failed inside the cut" / "the
  kernel crashed in the cut (...)" instead of a guess about the operands; for fillets and chamfers
  "..., which says nothing about the radius" (fuzz fillet-7-161 read "the radius may be too large"
  for 0.4956); for shells and offsets "a defect of the kernel rather than of the part". A shell
  names the place: for walls that grow outward a hole or inside round tighter than the wall
  (`Box(30, 30, 10) - Cylinder(1, 20)` shelled outward by 2), inward the place the part is
  thinnest across where it is less than three walls thick. `cells()` no longer reports the cut's
  hint about tools: it names the insert that touches the part around it.
- Two defects of the empty-result checks of B13 (batch 2), found while testing B19: the classified
  fallback sampled only the corners and middles of mesh triangles, which on the side of a long
  cylinder can all lie outside the box where it crosses another body, so an overlap was taken for
  none (`Box(6, 16, 4)` and `Cylinder(1.5, 30).translate(-1.5, 0, -13)`); triangles longer than a
  twelfth of the box are now sampled on a grid. And the kernel's Boolean of the meshes of
  internally tangent cylinders kills the process at a tenth of tessellate's tolerance (also on
  origin/next, see Not done): operands with tangent or coincident planes, cylinders or spheres are
  classified by points instead (within twice the mesh tolerance, which the kernel's sphere mesh
  exceeds a little: 0.0356 for 0.0346). The ball in its own cavity, `Sphere(5) & (Box(20, 20, 20)
  - Sphere(5))`, raised "the kernel returned a result that is empty" and is the empty part now.

## New

- `smlibpy._core.ext.seam_contacts(a, b, tolerance=0.0)` (smlibwasm: `ext.seam_contacts`):
  where a seam of body a touches a face of body b tangentially while the faces cross, per point
  `(seam edge index in a, face index in b, (x, y, z))`. Internal, for checks and tests.
- `ext.boolean` (both builds) turns seams as described; its result can then be a Brep of its own
  (the operands it was given are deleted). smlibwasm's `BrepHandle.brep` can be set, as Python's
  `h.brep = ...`.

- `Part.split(sheet, keep)` takes a sheet (a `Shell`, or a face that is not planar; also the
  function `split`): "above" is the side its normals point to (a face of a part: its outward
  normal), "both" gives (above, below). Both sides come from the kernel's `SM_BO_SLICE` (the second
  with the sheet's U and V swapped) and must add up to the part's volume; a sheet of one free-form
  face whose edges end inside the part is extended tangentially past them first (its trim not
  kept); otherwise `ModelingError` "the surface does not cut through the part". smlibwasm: the
  same, `part.split(sheet, 'both')`.
- `Shell.__sub__` and `Shell.__and__` (smlibwasm: `shell.cut(...parts)`, `shell.intersect(...parts)`):
  the sheet trimmed by parts, checked (every face on the sheet, no more area than the sheet).
  `Part.intersect` (`part & sheet`) gives the same Shell for one sheet.
- `Part.imprint(tool)` (B14): the part with its faces split where a tool crosses them, nothing added
  or taken away (checked: same volume, valid). The tool is a part, a sheet or face that crosses
  faces, or a sketch (or planar face) on a face of the part (a thin slab cuts outlines in where the
  kernel's coplanar imprint takes none, as for a single circle). A rectangle of 8 x 6 on the top of
  `Box(20, 20, 10)` splits it into 48 + 352, a circle of radius 4 into 50.27 + 349.73, a pin
  `Cylinder(3, 30).rotate(Y, 90)` marks two discs of 28.27 on the ends. The pieces inside a tool
  part or sketch region descend from the tool: `part.imprint(tool).faces().derived_from(tool)`.
  `ModelingError` "the tool crosses no face of the part" for a tool beside or wholly inside it.
- Where faces and edges came from (T3): `ShapeList.new(since)` (smlibwasm `newSince`) selects the
  faces or edges that descend from none of the given bodies, faces or edges: the circle where a
  boss meets a plate, `(plate + boss).edges().new(since=[plate, boss])`, the rounds of a fillet,
  `rounded.faces().new(since=part)`. `ShapeList.derived_from(*shapes)` (`derivedFrom`) selects
  their descendants: `(plate - holes).faces().derived_from(holes)` gives the hole walls,
  `cut.edges().derived_from(box.edges().top())` the pieces of the top edges. Every body smlibpy
  wraps tags its untagged faces and edges with numbers of their own (an `SmGenericAttribute`
  subclass the kernel carries through copies, splits, merges and Booleans; merges and coincident
  faces take the union of both sides' tags), a moved, turned, mirrored or scaled copy gets new tags,
  and the tags come back from the forked shell, offset and thicken steps (smlibwasm: the probe
  worker) alongside the `.smb` copy, which holds none. A face or edge of an earlier version of a
  part given to `fillet`, `chamfer`, `shell`, `draft`, `remove_faces` or `flange` stands for its
  descendants before it is matched by geometry.
- `body.check(level=2)` (Part, Shell, Sketch) and `Problem` (T4): the failed tests of the kernel's
  `SmBrep::AssertValid` (pointers, the gaps between vertices, edges and faces against their
  tolerances, and per face, loop, edge and vertex; level 0, 1 or 2), each with the face, edge or
  vertex it is about (or the body), the message, the value and tolerance measured, the kernel's
  category and the test's name. `Part.is_valid(strict=True)` (smlibwasm `isValid({ strict: true
  })`) also requires an empty `check()`. `Edge.tolerance` and `Vertex.tolerance`. A box whose top
  face was sewn on 0.002 above its walls is valid for `is_valid()`; `check()` names its four top
  corners ("Bad Vertex Gap", 0.002 against 2e-05). Generated parts pass in milliseconds; of 1471
  Boolean results of the fuzz seeds 7 and 8 that `is_valid()` accepts, 34 fail at level 2 (22 at
  level 0: gaps above the tolerance, repeated control points, seams).
- `Part.sources` (B15): for a cell of a merged part, the parts given to `merge` that it lies in, in
  the order given (a part that was itself merged stands for its own parts; the parts as given, not
  moved along with a moved merged part); `()` for other parts. Cells are named after them, the
  names joined by `&`, colored in the last one's color, and the merged part's own name and color
  where none has one. A moved, scaled, renamed or recolored copy of a merged part keeps what it was
  merged from.
- `ShapeList.joining(a, b)` (B17): the edges that lie on the surfaces of both bodies (or of a body
  of each of two lists), tested exactly at three points along each edge: where two bodies a
  Boolean joined meet, the edges to round next. It also finds the circle where a boss *stands* on a
  plate, which `new(since=[plate, boss])` does not count as new (the circle is the boss's own
  bottom edge): `(plate + boss).edges().joining(plate, boss)`; `(block - hole).edges().joining(block,
  hole)` gives the four rim pieces of an oblique hole. Merged coplanar faces' edges are not taken.
  smlibwasm: the same names. The kernel's `SmApiBooleanWithCurves` was not used (see Not done).
- `smlibpy._core.ext` (smlibwasm `ext`): `tag_topology(brep, fresh)`, `topology_tags(brep)`,
  `set_topology_tags(brep, faces, edges)`, `add_face_tags(brep, faces, tags)`,
  `untag_topology(brep)` (src/cpp/history.cpp); `check_brep(brep, level)`, `tolerance_gaps(brep)`,
  `edge_tolerance(edge)`, `vertex_tolerance(vertex)` (check.cpp); `slice(brep, sheet, below)`,
  `extended_sheet(face, distance)` (slice.cpp). Internal, for smlibpy and its tests.

The new C++ (the tag attributes above all, which the kernel copies, splits, merges and deletes
with the faces and edges) was run under AddressSanitizer over the whole Python suite (in-process
for the lane, surface and modeling tests, `GUARD_SECONDS = 0`): no report from it; one older
kernel defect, listed under Not done, showed up in a guard test.

## Behaviour changes

- A tool whose seam would run tangent to the other operand goes in turned about its own axis: in
  the result its seam edge, and the vertices where that seam meets the rims, lie at another angle
  than (r, 0, z) of the tool as placed, and a face can be split one edge differently. Scripts that
  pick such vertices or edges by position should select by geometry instead.

  ```python
  part = (Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
  # before: the pin's seam vertices at (+-15, 5, -2), now at (+-15, 6.414, -1.414) (turned by 45
  # degrees), so this finds none:
  # v = part.vertices().filter_by(lambda v: abs(v.y - 5) < 1e-9 and abs(v.z + 2) < 1e-9)
  # after: select the hole by its geometry
  hole = part.faces().cylinders().filter_by(lambda f: abs(f.radius - 2) < 1e-9)
  ```
- Booleans that raised now return parts: crossing holes natively (B4), a tool beside an earlier
  parallel hole or boss (B10), merges along tangent seams (B6). Code that caught the error to
  fall back to another construction gets the part instead:

  ```python
  # before
  try:
      plate = Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)
  except KernelError:
      plate = Box(40, 40, 10) - [Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0)]
  # after: the first line works (14612.2528; the list form is exact, 14612.2526)
  plate = Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)
  ```
- Volumes of Booleans with such seams change from wrong to right (24331.70 to 24299.26 above).
- `ext.boolean` can return a Brep other than `brep1` (and delete `brep1`): callers must use its
  result (`h.brep = ext.boolean(h.brep, ...)`, smlibwasm likewise). smlibpy's own callers do.

- `part + sheet` and `part - sheet` (a `Shell` or a face as a tool, also in a list) raise
  `TypeError` instead of returning an invalid "Part"; `part & sheet` returns a `Shell` instead of
  a "Part" of volume 0. Scripts that imprinted a sheet with `+` or `-`, or trimmed one with
  `stitch(part & sheet)`:

  ```python
  # before
  marked = box + sheet                 # an invalid "Part" with the sheet's lines on its faces
  disc = stitch(part & sheet)          # the piece of the sheet inside the part
  # after
  marked = box.imprint(sheet)          # a valid Part, same volume
  disc = part & sheet                  # a Shell already (stitch(part & sheet) still works)
  halves = box.split(sheet, "both")    # or split the part along the sheet
  ```
- A face or edge of an earlier version of a part passed to `fillet`, `chamfer`, `shell`,
  `draft`, `remove_faces` or `flange` stands for all its descendants in the part: where a later
  cut split it, every piece is rounded (it raised "is not an edge of this part"), and where a
  union merged it with a coplanar edge or face of the other body, the merged one is taken (it was
  matched by geometry only where it was unchanged); a list of radii, one per selected edge, gives
  each piece its edge's radius. `flange` raises "give one edge of the part (got 2)" for an edge a
  cut split (it raised "is not an edge of this part"). To keep the old geometric match, select on
  the new part:

  ```python
  box = Box(40, 30, 10)
  joined = box + Box(40, 30, 10).translate(40, 0, 0)    # the long top edges merge, 80 long
  # before: joined.fillet(box.edges().top().parallel_to(X), 1) raised "is not an edge of this part"
  # after: rounds the two merged edges along both boxes (23965.6637 = 24000 - 160 (1 - pi / 4));
  # to round less, select on the new part:
  joined.fillet(joined.edges().top().filter_by(lambda e: e.center().x < 20), 1)
  ```
- An empty intersection or cut is accepted or refused by meshes of the operands, not by
  `brep_relationship`: a right empty intersection that raised because of where the bodies were
  is accepted, a wrong one the relationship called "touching" raises, and an empty intersection
  of curved bodies that touch costs about 0.1 s more (two spheres touching at a point: 0.006 s
  before, 0.1 s; the ball in its own cavity 0.09 s, 0.22 s). Code that caught the error for
  touching bodies moved far from the origin gets the empty part:

  ```python
  # before (Python): raised "intersect: the kernel returned a result that is empty"
  common = a.translate(101.3, -57.9, 33.1) & b.translate(101.3, -57.9, 33.1)
  # after: the empty Part (0 faces), as at the origin
  if len(common.faces()) == 0: ...
  ```
- `Shell.heal()` can return a `Part` (where the healed faces close around a volume); smlibwasm's
  `heal()` is typed `this | Part`. Code that expects a Shell checks the type:

  ```python
  healed = sheet.heal()
  if isinstance(healed, Part): ...     # closed: a solid now
  ```
- Every body's faces and edges carry a kernel attribute (the tags). `.smb` files do not hold
  attributes (SmBrep::WriteToFile), so files are unchanged byte for byte; the attribute takes the
  kernel's own context, so `check()` and AssertValid see nothing of it. Code that walks a Brep's
  attributes through `_core` sees one with id `SM_AI_USER_1 + 50`.

- The cells of a merged part (`cells()`, `cell_at()`) are named and colored after the parts they
  lie in, and a STEP file of a merged part names and colors each solid so: scripts that took a
  cell's name for the merged part's, or read the solids of such a STEP file by the merged part's
  name, get the parts' names (where the parts have names):

  ```python
  m = merge(Box(40, 40, 20).named("block"), Cylinder(6, 30).named("insert"))
  # before: every cell "block"; after: "block", "block&insert", "insert", "insert"
  cells = [c.named(m.name) for c in m.cells()]          # the merged part's name for all, as before
  steel = [c for c in m.cells() if c.sources[0].name == "block"]   # or select by source
  ```
- `solids()` gives a body inside a cavity of another as a solid of its own: a check
  `len(part.solids()) == 1` fails for a part with a loose body in a cavity (which is two bodies).
  To count only bodies that are not inside others, as before:

  ```python
  caged = (Box(20, 20, 20) - Box(10, 10, 10)) + Box(4, 4, 4)
  solids = caged.solids()                  # before: [7064.0]; after: [7000.0, 64.0]
  outer = [s for s in solids if not any(o is not s and o.bbox().contains(s.bbox().min)
                                        and o.bbox().contains(s.bbox().max) for o in solids)]   # [7000.0]
  ```
- `section()` with a plane that only touches the part raises `ValueError` (it raised `KernelError`,
  or, tangent along a closed curve, returned a region that is not in the part):

  ```python
  try:
      s = Torus(10, 2).section(Plane.XY.offset(2))   # before: a disc of 314.159; after: ValueError
  except ValueError:
      s = None                                       # the plane only touches the part
  ```
- Error messages of failed Booleans, fillets, chamfers, shells, offsets and `cells()` changed (B19):
  the hint is built from what the operands show. Scripts that matched the old hint text ("combine
  the tools first", "may touch only along an edge", "the wall may be thicker", "the radius may be
  too large") should test the exception type and `status` instead:

  ```python
  try:
      part = part - tool
  except KernelError as e:          # before: matched "combine the tools first" in str(e)
      if e.status == "SM_ERR_NULL_POINTER": ...   # the kernel failed inside
  except ModelingError as e:        # a wrong result refused; str(e) says why
      ...
  ```
- An empty intersection or cut of operands with tangent or coincident planes, cylinders or spheres
  is checked by classifying points of their meshes instead of the meshes' Boolean: the ball in
  its own cavity is accepted as empty (it raised), and such checks cost the classification of up
  to 4000 points (0.03 to 0.2 s) rather than two mesh Booleans.

## Not done

- Seams that cannot be turned away keep the old behaviour: the seam of an operand that is no body
  of revolution (a hole already cut into the part, whose seam touches the new tool; turning only
  the new tool was enough in every such case measured), a torus' outer equator (no turn about the
  axis moves it: the tilted split of `Torus(6, 4).rotate(Y, 90)` in fuzz case slice-7-390 is
  still wrong, 5.81 + 1842.70 for 1894.96), and seams touching free-form (B-spline) faces, which
  are not looked at. Merges of more than two parts turn seams only while two solids are merged.
- A union that returns one operand unchanged although the other reaches out of it is not
  detected (`csg-11-132` above: `(Cylinder(5, 5) + Box(20, 4, 16).rotate(X, 90).translate(0, -3,
  -0.5)) + Cylinder(2, 12).translate(2, -2.3693, 3.5)` gives 1358.54, the first operand; right
  1446.61). It needs a check like B3's for intersections (an operand given back unchanged), not
  in this lane.
- Pre-existing, found by the fuzz and outside this lane: `(Box(20, 16, 4) - Sphere(6).rotate(X,
  90).translate(1.4007, 0, -1.5863)) & Torus(6, 2.5).rotate(Y, 90).translate(7.5, 0, 10.5)` kills
  the process natively (exit 139) and traps in the wasm, with or without this lane's changes; the
  all-edge fillet of `Cone(3, 0, 10).rotate(Y, 90) - Cone(1.5, 0, 8).rotate(X, 90).translate(0, 1,
  0)` (fuzz fillet-7-185) writes freed memory in `SmLoopuse::CollectEdgeuses` from
  `SmMerge::BooleanPostProcess` inside `SmFilletExecutive::DoFilleting` (AddressSanitizer; the
  normal build raises SM_ERR_NULL_POINTER).
- B12: a sheet that ends inside the part is extended only when it is one B-spline face; sheets
  of several faces, and analytic faces (a plane sheet, a cylinder face) that end inside, raise
  "does not cut through the part". U6's `Face.extended` (another lane) is the general tool;
  `ext.extended_sheet` here is the smallest helper split needs. `Part.merge(sheet)` to partition a
  part into conformal cells along a sheet is not added (split's two parts are separate bodies,
  whose cut faces the kernel computed twice).
- B14: imprinting by curves (U3) is not here: a sketch's region is imprinted, an open curve is
  not. Pieces split off by a sheet descend only from the face they were split from (no "inside"
  of a sheet); select them by geometry.
- T3: bodies read from files (STEP, USD, .smb) and sections carry new tags everywhere, so
  `new(since=...)` gives all their faces; vertices carry no tags.
- T4: the healer's own problem report (`SmHealData`, `heal(report=True)`) is not exposed: it
  needs C++ that walks its problem arrays through the copy map (the plan's "later").
- Found with AddressSanitizer while checking this batch, outside it: the kernel's offset in its
  extended mode can read a ProtoEdge that `SmProtoTopologyManager::SplitIntersectingProtoEdges`
  deleted (`SmProtoEdge::GetOverlappingPEGroup` from `ResolveOverlappingProtoEdges`, in
  `SmOffsetExecutive::PiecewiseMerge`). Whether it happens depends on where things lie in memory:
  `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail` reports it under
  AddressSanitizer with this branch's build (also with the tagging switched off) and not with 10,
  30 or 100 boxes allocated first, nor with the build of batch 1. The normal builds pass the test;
  smlibpy runs these steps in a forked copy (smlibwasm: a probe worker). For the lane that owns
  the offset patches.
- B17: the kernel's `SmApiBooleanWithCurves` (`_core.boolean_with_curves`) is not used and not
  bound in the wasm, as the plan proposed: it hands out the merge's common edges after
  `SmMerge::BooleanPostProcess` deleted some of them. AddressSanitizer: heap-use-after-free in
  pybind11's cast of the returned edges, freed in `SmBrep::DeleteEdge` from `BooleanPostProcess`
  (SmMerge.cpp:1169); `_core.boolean_with_curves(Box(10, 10, 10), Box(10, 10, 10).translate(10, 0,
  0), UNION)` (copies) kills Python, and so does a step `Box(10, 10, 10)` + `Box(10, 10, 5)
  .translate(5, 0, -2.5)`. Filtering the list by the result's edges would compare freed addresses
  that a new edge may reuse. `ShapeList.joining` gives the selection by geometry instead. The raw
  binding stays in `_core` (usd-brep's SmPyLib), unused by smlibpy.
- B19: the fillet hint does not name a degenerate vertex: in the two `SM_ERR_NULL_POINTER` fillets
  of the fuzz seeds (fillet-7-161, a torus less a sphere; fillet-7-185, two cones) there is none to
  name, so the hint only says that the failure is the kernel's, not the radius's. The executive's
  `SmFilletErrorInfo` (F8, another lane) is the way to name the culprit. Offsets and thickenings
  get only the crash note; a shell whose walls grow inward is not told about rounds tighter than
  the wall, since the kernel's extended mode builds those (a box with rounds of 1 shelled by -3).
- Pre-existing, found while testing B19, in the kernel's mesh Booleans (public `Mesh & Mesh`): the
  meshes of two internally tangent cylinders kill the process at a fine tolerance, on origin/next
  too: `tessellate(Cylinder(4, 8).rotate(X, 90), 0.00894) & tessellate(Cylinder(1.5, 4).rotate(X,
  90).translate(-2.5, 2, 0), 0.00447)` exits 139 (at 0.0894 and 0.0447 it works). smlibpy's own
  checks no longer ask it for such operands; a user's mesh Booleans still can.
- Pre-existing: merging a part with an already merged part inside a cavity of it,
  `(Box(30, 30, 30) - Box(20, 20, 20)).merge(Box(6, 6, 6).merge(Box(6, 6, 6).translate(6, 0, 0)))`,
  gets the kernel's 27000 (the cavity filled); origin/next returned it silently, the P0 volume
  check refuses it. `merge(cage, box1, box2)` in one call is right (19000 + 432).
- B15: glTF, OBJ, STL and USD export of a merged part are unchanged (one mesh, or the merged body,
  in the part's color); export `part.cells()` for a mesh per cell with its name and color.
- Noise in the fuzz comparison of this batch (seeds 7, 8, 11, 12 against batch 2): csg-8-23 and
  offset-8-360 flip as before; csg-8-157's intersection is 226.47692 in a fresh process with this
  batch and with batch 2 alike, and was 226.47710 in batch 2's fuzz process.
- `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail` failed once in four full
  runs of the suite with this batch (it passed alone 6 of 6): the layout-dependent read of freed
  memory in the extended offset listed above, in its raw kernel steps, which this batch does not
  touch.
