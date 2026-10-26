# smlibpy and smlibwasm 0.5.1

This release cleans up the API that 0.5.0 left uneven. Every operation of a body is now a method
and a function of the same name. Parameters are named in full and their choices typed. Every
public call has a docstring, and every guide of the MCP skill was checked against the code it
describes. It also fixes `fill` on turned spheres.

Nothing that worked in Python stops working: renamed parameters and modules keep their old names,
with a `DeprecationWarning`. In smlibwasm the renamed options have only their new names. The
TypeScript compiler points at each use of an old name. At run time the options check lists the
options the call takes:
`TypeError: Edge.continuity() got an unexpected option 'angleTol' (its options: angleTolerance, curvatureTolerance)`.

Everything applies to smlibpy (Python) and smlibwasm (JavaScript and TypeScript: camelCase names,
an options object for keywords, methods for operators) alike, unless marked *Python* or
*smlibwasm*.

## Changed

**Every operation is a method and a function.** In 0.5.0, some operations had both forms
(`extrude`, `fillet`, `shell`, `split`, ...). Others, mostly the newer ones, were methods only.
Now each operation is also a function of the same name and parameters, taking the body first:
`part.draft(faces, 3, Plane.XY)` is `draft(part, faces, 3, Plane.XY)`. These are new as functions:

`fuse`, `cut`, `intersect`, `xor`, `imprint`, `fillet_preview`, `draft`, `move_faces`,
`offset_faces`, `remove_faces`, `remove_fillets`, `push`, `warp`, `flatten`, `extend`, `trim`,
`match_edge`, `merge_faces`, `project`, `outline`, `silhouette`, `intersection_curves`,
`parting_line`, `slices`, `scale`, `deform`.

`fillet_preview(edges, radius)` takes the edges, as `fillet` and `chamfer` do. A function raises
`TypeError` for a shape that has no such method ("draft takes a part, not a Shell").

Sketches and sheets have their Booleans by name, as parts had: `a.fuse(b)`, `a.cut(b)`,
`a.intersect(b)`, and `a.xor(b)` for sketches, beside `+ - & ^`. In smlibwasm these are the
methods the operators always were.

**Parameters named in full.** *Python*: the old keyword still works, with a
`DeprecationWarning`.

| Old | New | Where |
|---|---|---|
| `tol` | `tolerance` | `Vector.is_close`, `Plane.contains`, `Plane.is_coplanar`, `BoundBox.contains`, `ShapeList.group_by`, `max_by`, `min_by`, `at`, `Part.classify`, `contains`, `cell_at` |
| `angle_tol` | `angle_tolerance` | `Vector.is_parallel`, `Vector.is_perpendicular`, `Axis.is_parallel`, `Edge.continuity`, `Wire.continuity` |
| `curvature_tol` | `curvature_tolerance` | `Edge.continuity`, `Wire.continuity` |
| `loc` | `location` | `Axis.moved`, `Plane.moved` |
| `round=False` | `corners="sharp"` | `Sketch.offset` |

*smlibwasm*: positional parameters only change their names in the declarations. The options
`angleTol` and `curvatureTol` of `continuity` are `angleTolerance` and `curvatureTolerance`.
`Sketch.offset` and `offset` no longer take `round`.

**Choices typed.** Every option that takes one of a set of strings is typed as a `Literal` of
them in Python and a string union in TypeScript. This covers `corners`, `continuity`, `keep`,
`end`, `ends`, `shape`, `unit`, `curves`, `projection`, `colors`, `view` and `anchor`. Editors
and type checkers show the choices, and `describe_method` lists them. A wrong value is still
the `ValueError` (`RangeError`) that names the choices.

**Keywords in the signature.** `Face.extrude`, `Shape.show` and Part's `twist`, `taper`,
`bend`, `unroll` and `deform` name their keywords where they took `**kwargs`. `Sketch.sweep`
takes `orient` and `translational`, as the `sweep` function does. `edges(seams=True)` of faces
and bodies is keyword-only (smlibwasm: `edges({ seams: true })`).

**Modules renamed.** No module has the name of a function any more:

- `smlibpy.deform` is `smlibpy.deformations`;
- `smlibpy.draft` is `smlibpy.molding`;
- `smlibpy.render` is `smlibpy.pictures`.

`smlibpy.draft` was the function or the module, depending on what had imported what. The old
module paths still import (`from smlibpy.draft import DraftAnalysis`). smlibwasm's source files
follow the new names.

**Docstrings everywhere.** The 92 public methods and properties that had none now have one
(`Vector.dot`, `Edge.length`, `Face.outer_wire`, `Location.inverse`, ...): `describe_method`
showed nothing for them. smlibwasm's declarations carry the same docs.

## The MCP skill and the docs

Every guide was read against the code and run, every claim checked or measured: 150 of the 222
guides changed. Most changes are stale error messages, numbers and timings. Function forms that
were missing are added. Some behaviour was described wrongly:

- `fit_curve`'s guide still described the kernel's approximation (32 control points, a degree
  raised as needed) after `fit_curve` became smlibpy's own least-squares fit (12 control points,
  a fixed degree).
- `part.mirror(X)` was said to mirror in an axis; it raises `TypeError` (sketches do).
- `selection/Face` named a method `extended()`, which does not exist.
- A shell with walls thicker than its fillets was said to fail; it works.

The user docs (`docs/`) and the README were checked the same way: 17 pages changed (swapped
names in an example of `split`, stale sizes and timings, the build steps of a clone).

`tests/test_guides.py` runs every guide's examples. It now also checks the printed numbers: a
comment after a `print(...)` that starts with a value is what that line prints, to the comment's
precision. It also checks that every property has a guide that names it, not only functions,
methods and classes.

## Fixed

- **`fill` closes every hole of a turned sphere** (#31). SMLib's four-sided corner blend put
  only two of its sides on [0, 1]. Where the other two were arcs of one length, the patch met the
  sphere up to 64 degrees off, and `fill` failed. This depended on where the Boolean cut the
  rim: on `Sphere(10)`, 5 of its 6 axis holes failed. The kernel patch puts all four sides on
  [0, 1]. A rim cut where a seam crosses it is now split into four nearly equal sides, so a hole
  gets the same cap however the sphere is turned: 4141.58 for every axis hole, where it was
  4141.52, 4141.58 or 4124.35.
- **Tests no longer open a browser.** The fillet guide's `show()` opened Edge on the Windows
  runners, and its WebGL page, drawn without a GPU, kept the cores busy: 0.5.0's release builds
  ran their second test run eleven times slower. *Tests only.*
- **What the review of the guides and docs found in the code:**
  - `thicken` of a closed grid surface (a tube from `surface`, 8 or 12 points per ring) that the
    kernel turns into a body of no volume (-1e-12) raises `ModelingError`. It returned that body,
    which `is_valid()` refused: the check took the kernel's coarse volume. The result of
    `thicken` is now measured as `is_valid()` measures it.
  - A wire offset that collapses (the inside of a strip as wide as the distance) raises
    `ModelingError: offset: moved by 2, a side of it shrinks to nothing; ...`. It raised an
    internal `GeometryError`.
  - `outline` takes a face or a sketch for its plane, and says what it takes: a tuple raised an
    `AttributeError`.
  - `Wire.fillet` takes one corner alone (a point or a vertex), as `Sketch.fillet` does. It
    raised `TypeError: 'int' object is not iterable`.
  - A `Spiral` beyond the kernel's approximation raises a `KernelError` whose hint says what
    makes the curve: `fit_curve` through points of the spiral. That is less than a turn with a
    large change of radius (`Spiral(2, 20, 0.5)`), or some numbers of turns
    (`Spiral(20, 0, 130)`). The docstring promised any number of turns.
  - *Python*: an unknown color name of three or six letters (`"maroon"`) is
    `ValueError: unknown color 'maroon'` at once. It was read as hex digits and failed when the
    part was written to a file.
  - The functions `split`, `mirror` and `section` say what they take: `split(edge, 0.3)` raised
    `TypeError: Edge.split() takes 2 positional arguments but 3 were given`, and
    `section("abc")` an `AttributeError`.
  - `describe_method` hands out the right guide for the `split` function, `Sketch.extend`,
    `Sketch.from_nurbs`, `Edge.trim`, `Wire.trim`, the `Shell` class (it got the guide of
    hollowing parts), the `Bend` class (it got the guide of bending parts) and `deform`. A
    property gets the guide of its class where it has none of its own (`Part.volume`,
    `MassProperties.principal_axes`, ...).
  - A face's repr shows 0 where its center lies on an axis, not the integration's noise
    (`center=(-3.765e-15, ...)`).
  - Messages: `part - sheet` says "cannot cut a Part with a Shell" (it had the operands the other
    way round). `to_brep`, `export_brep` and `to_smp` no longer say they write meshes; they
    refuse them.
  - Types: the `fillet` function takes a radius per edge (a `dict`), as `Part.fillet` does.
    `Sketch.fillet` and `Sketch.chamfer` say that they take one corner alone, as they do.
  - Docstrings corrected:
    - `fit_curve`: a tolerance below the points' noise does not always make the curve pass
      through them.
    - `Edge`: there is no `Arc()`.
    - `loft` and `sweep` along rails: the surface passes through the rails within about 2e-7,
      not "exactly".
    - `bend`: at which angles its cylinders are exact (see the known issues).
    - Also `check` (a gap between a vertex and its faces shows at level 2 only), `compact` (a
      repeated `closest_point` is 11 times as fast, not twice), `surface(report=True)` (0.13 s
      for 1,500 points, not "a few milliseconds") and `match_edge` (the crease is 20 to 34
      degrees).

## Known issues

These were found during this release's review and are not fixed in it:

- A sweep whose profile reaches past the path's tightest bend returns a body that passes through
  itself. Its volume is that of the profile times the path's length, and `is_valid()` accepts
  it. An example: `sweep(Circle(6), Spline((0, 0), (10, 5), (20, -3), (30, 4)))`, whose path
  bends with a radius of 4.0. Compare `path.min_radius()` with the profile's size first. Only a
  path of one arc is refused today.
- `move_faces` that moves a hole or a boss partly through a face around it returns a body that
  passes through itself, with the volume unchanged. An example: `blk = Box(40, 30, 10) -
  Cylinder(3, 20)`, then `blk.move_faces(blk.faces().cylinders(), (20, 0, 0))`. `is_valid()`
  accepts it; `is_valid(strict=True)` does not ("Intersecting Face Loops").
- `export_brep` of a part of several cells (`merge`) writes a file that `import_brep` cannot read
  back (an `IndexError` from the reader). The part's `cells()`, each written on its own, read
  back.
- `save` and `to_smp` keep the colors of single faces but not their names. STEP keeps both.
- `bend` makes exact cylinders of a plate's bend only for bends of up to 90 degrees, and of 120,
  135, 180, 240 and 270. At other angles (100, 150, 200, 290, ... measured with
  `Box(400, 20, 2).bend(a, radius=20)`) the bend's faces are NURBS within the tolerance. Then
  `bends()` finds no bend, and `unfold` fails with a misleading error. `unfold` also fails on
  bends of more than 180 degrees made by `bend`, where the same shape built from primitives
  unfolds. The docstrings now say so.

## For contributors

- `AGENTS.md` (and `CLAUDE.md`, which points to it) states the project's rules: the API's forms,
  every feature as a guide of the MCP skill and a port in smlibwasm, kernel patches, the release
  steps, the writing style.
- `tests/test_api_forms.py` lists every public method of Part, Shell and Sketch and every
  function by what it is. A new one fails there until it is listed. It also checks:
  - that an operation's two forms take the same parameters and give the same results;
  - that every public call has a docstring;
  - that no call takes `**kwargs` where its keywords are known;
  - that choices are typed and flags are keyword-only;
  - that no module has the name of a function.
- `js/test/api_forms.test.ts` checks that smlibwasm has every name of smlibpy
  (`js/test/_python_api.json`, which `tools/gen_js_options.py` writes) and that its two forms
  agree.
