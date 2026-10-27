# smlibpy

smlibpy is Python CAD on SMLib, the open-source NURBS solid modeling kernel: exact solids, sheets
and sketches built by scripts. smlibwasm (`@classcad/smlibwasm`, under `js/`) is the same API in
TypeScript on the same kernel compiled to WebAssembly, and smlibpy-three (`@classcad/smlibpy-three`,
under `smlibpy-three/`) is smlibwasm's API for three.js. Agents use smlibpy through its MCP server
(`smlibpy[mcp]`), which serves a skill of guides, and through a Claude Code plugin
(`plugins/smlibpy`). One feature is all of these at once: the library, its port, its guide, its docs.

| Folder | What it is |
|---|---|
| `src/smlibpy/` | The library. `shapes.py` (Part, Shell, Sketch, Face, Edge, Wire, ShapeList), `operations.py` (the operations as functions), one module per domain (`surfaces`, `sheetmetal`, `deformations`, `molding`, `pictures`, ...). `mcp/` is the MCP server; `skill/` the guides it serves. |
| `src/cpp/` | smlibpy's C++: the bindings (`_core`) and the steps that need the kernel's internals. Shared with smlibwasm. |
| `third_party/` | `usd-brep` (submodule: NVIDIA's usd-brep, with SMLib's sources), `patches/` (the kernel files smlibpy patches, and why). |
| `js/` | smlibwasm: `src/*.ts` (one module per Python module, same names), `test/*.test.ts`, `PORTING.md` (the porting rules), `scripts/build-wasm.sh`. |
| `smlibpy-three/` | smlibpy-three: smlibwasm's API for three.js, its shapes three.js objects in three's coordinates. `WRAPPING.md` (how a feature is wrapped), `test/forms.test.ts` (every export and member of smlibwasm wrapped or left out for a reason), `API.md` (`npm run api`). |
| `tests/` | pytest. `test_api_forms.py`, `test_guides.py`, `test_docs.py` hold the rules below. |
| `docs/` | The user docs (MkDocs, `mkdocs.yml`); the website's docs are made from them. |
| `plugins/smlibpy/` | The Claude Code plugin: the MCP server pinned to a release, and the plugin's skill. |
| `tools/` | `gen_js_options.py` (Python's signatures and names for smlibwasm), `parity.py` (golden files both builds are compared with), `fuzz/`, `sanitize/`, `oracles/` (the kernel's own tests), `gen_examples_doc.py`. |
| `ai/` | Plans and release notes (`plan/`), open items by domain (`todo/`), the skill's training (`HOW-TO-TRAIN.md`, `run.py`, `training/`). |
| `app/` | The live view of an MCP session: Buerligons (from npm), built into `src/smlibpy/mcp/app`, which ships in the package. |
| `examples/` | Example models, each a script with a `model()` function; `tools/gen_examples_doc.py` makes `docs/examples.md` of them. |

## Working here

- **Branches.** Work goes on `next`: branch from `origin/next`, merge back with `--no-ff`, run the
  tests, push. `main` only takes releases (and the plugin's files, which install from it).
- **Build.** Python (a clone with `--recursive`): `cmake -S . -B build -G Ninja && cmake --build build`
  writes `_core` into `src/smlibpy`; put `src` on `PYTHONPATH` (docs/getting-started.md). The extras
  `test`, `mcp` and `docs` hold what the tests, the MCP server and the docs need. smlibwasm, in
  `js/`: `npm ci`, `npm run wasm` (the Emscripten SDK in `~/emsdk`), `npm run typecheck`,
  `npm run build`. smlibpy-three, in `smlibpy-three/` after that: `npm ci`, `npm run typecheck`,
  `npm test`, `npm run build`.
- **Tests.** `pytest -q` (about 6 minutes), `npm test` in `js/` (about a minute and a half) and in
  `smlibpy-three/` (seconds), `mkdocs build --strict`. CI (`ci.yml`) runs them on pull requests and
  on `main`, not on `next`: run them yourself before you push. `checks.yml` runs the fuzzer,
  AddressSanitizer and the kernel's own tests, nightly and on pull requests that touch the kernel.
  After a change to a public name or signature run `python tools/gen_js_options.py` (the tests fail
  while its files are behind).
- **Commits and PRs.** A subject that says what changed and why, in plain words
  (`Area: what changed, and why`). No attribution lines: no "Generated with Claude Code", no
  Co-Authored-By.

## The API

The rules a new function, method or parameter must follow. Tests hold each of them; when one
fails, decide the form, do not work around the test.

1. **Shapes are values.** Every operation returns a new shape and leaves its inputs unchanged.
2. **Every operation of a body is a method and a function.** An operation makes a new body, or new
   geometry, from a body (a Part, a Shell or a Sketch): features (`fillet`, `shell`, `draft`),
   Booleans (`fuse`, `cut`, `split`, `imprint`), edits (`move_faces`, `push`, `trim`),
   deformations (`twist`, `deform`), sheet metal (`fold`), the sweeps of a sketch (`extrude`),
   sections and curves from a body (`section`, `outline`, `project`), `mirror` and `scale`.
   - The method does the work. The function has the same name and parameters and takes the body
     first: `part.draft(faces, 3, Plane.XY)` is `draft(part, faces, 3, Plane.XY)`. It delegates,
     and raises `TypeError` saying what it takes. Its docstring points to the method.
   - `fillet`, `chamfer` and `fillet_preview` take the edges instead and find their part, as
     build123d's `fillet` does.
   - A function may take more kinds of shape than have the method (`twist` also takes curves and
     points; `sweep` an open profile, with `rails`). One over shapes whose methods differ (`offset`,
     `extend`, `trim`, `project`) has typed overloads and passes every method's keywords on.
3. **What stays a method:** selections and topology (`faces()`, `ShapeList.top()`), measuring and
   checking (`bbox`, `classify`, `check`), placing (`moved`, `rotate`, `on`; and
   `Pos(...) * part`), attributes (`named`, `colored`), representations (`to_nurbs`, `mesh`).
   **What stays a function:** what makes a shape from several inputs (`loft`, `blend`, `network`,
   `fit_curve`), files (`export_step`, `import_step`, `to_step`, ...), pictures (`render`).
4. **Decide the form when you add the call.** `tests/test_api_forms.py` lists every public method of
   Part, Shell and Sketch and every function of the package by what it is; a new one fails there
   until it is listed. An operation's two forms are compared there for their parameters, and run
   to give the same result.
5. **Names.** build123d's where it has one (`Box`, `GridLocations`, `ShapeList.sort_by`,
   `param_at_point`); snake_case. Capitalized functions make shapes (`Box`, `Rectangle`, `Line`
   return a Part, a Sketch, an Edge); classes are the other values and the builders (`Plane`,
   `Location`, `Profile`, `Lattice`). A module never takes the name of a public function or class
   (`deformations.py`, not `deform.py`: the package's attribute would be one of the two).
6. **Parameters.** Required ones positional, options and flags keyword-only after `*`, with their
   names in the signature: no `**kwargs` where the parameters are known (the docs, the MCP and
   smlibwasm's options table read them from the signature). Names are whole words
   (`tolerance`, `location`, not `tol`, `loc`). Choices are lowercase strings typed as their
   `Literal` (`corners: Literal["round", "sharp"] = "round"`) and checked with an error that
   lists them. Every public function, method and property has a docstring: `describe_method`
   shows it. Overloads where the result's type depends on the input's. A parameter that is
   renamed keeps its old name working for a release, with a DeprecationWarning
   (`@renamed`, `src/smlibpy/_renamed.py`), and a flag made keyword-only its positional use
   (`@keyword_only`); smlibwasm takes both old forms too (`js/src/_renamed.ts`,
   `js/test/options.test.ts` calls each). A change that breaks a call anyway (a name that now
   means something else) waits for a minor version. Millimeters and degrees, Z up; primitives centered
   unless `align=` says otherwise. `tests/test_api_forms.py` checks these.
7. **Results are checked.** A wrong result is never returned: check what the kernel gives (valid,
   closed, the volume or area it must have) and raise `ModelingError` with a hint that says what to
   change, `KernelError` (with its trace) where the kernel failed. A kernel step that can crash or
   loop runs guarded (`smlibpy._guard.isolated`). Errors say which edge, face or corner.
8. **Select by geometry**, never by index: indices change whenever the model changes.

## Every feature is a guide of the MCP

The MCP is how agents use smlibpy: `list_methods` and `describe_method` find a call, and
`describe_method` hands them the call's guide. A feature without a guide does not exist for them.

- **A guide for every call.** Every function, method, property and class the MCP lists (the package's
  exports and the classes of `discovery.CLASSES`) has a guide that names it:
  `src/smlibpy/skill/references/<domain>/<name>.md`, the domain of its class
  (`discovery.CLASS_DOMAINS`), or the guide `discovery.GUIDE_NAMES` names for it. A function form
  shares its method's guide.
- **A guide** says what the call is for and when to use it, its signature, what it returns, its
  gotchas (what the kernel cannot do, measured), and an example that runs: tests/test_guides.py
  runs every guide's Python blocks, in order, in one namespace, with `from smlibpy import *`. A
  block that needs a file of the user's starts with `# not run` and says which. A comment after a
  `print(...)` that starts with a value is what that line prints, value first and explanation
  after (`# 196.566371 = 200 - 4 * (4 - pi)`); the test compares the two. A result that differs
  between platforms says what the others print (`# 13674 (about, 13670 on Linux)`) and is
  compared to 0.1 %. Numbers in the prose are measured too. `ai/HOW-TO-TRAIN.md` is how guides are written and checked against the live
  kernel.
- **A new area** gets a line in `src/smlibpy/skill/SKILL.md` (and a recipe where it is a workflow),
  and the plugin skill's description (`plugins/smlibpy/skills/smlibpy/SKILL.md`, 1536 characters at
  most) names it: the description decides when an agent loads the skill at all.
- **The docs.** The user docs (`docs/*.md`; their code blocks run in tests/test_docs.py), the
  README's feature list, the release notes (`ai/plan/release-notes-<version>.md`), and for a
  release the website (below).

## Every feature in smlibwasm too

smlibwasm ports smlibpy faithfully: the same algorithms, checks, tolerances, messages and
fallbacks. A feature lands in both, in the same change. `js/PORTING.md` has the rules; in short:

- The same module (`shapes.py` is `shapes.ts`), the same names in camelCase (`parallel_to` is
  `parallelTo`), positional parameters as they are, keyword-only parameters as a trailing options
  object with camelCase keys (`fold(line, angle, { radius, kFactor })`), checked with
  `_opts('Part.fold', options)`. Operators become methods (`fuse`, `cut`, `intersect`, `xor`);
  `ValueError` is `RangeError`. Memory: `scope(fn)` and `dispose()`.
- The renames are few and listed (`tools/gen_js_options.py` `RENAMES`: `exportFile`, `atPoint`,
  `newSince`, `toArray`). `js/test/api_forms.test.ts` checks that smlibwasm has every name of
  smlibpy (`js/test/_python_api.json`) and that its function forms give what its methods give.
- Port the tests with the feature: `js/test/<name>.test.ts`, its first line naming the Python test
  file, with that test's numbers (`approx` of `js/test/_approx.ts` is `pytest.approx`).
  `tools/parity.py` writes golden files (what the file writers make, numbers of modeling steps)
  that `js/test/lane_WN.test.ts` compares smlibwasm with, and keeps the known divergences of the
  two builds.
- smlibpy-three wraps smlibwasm for three.js: a new export or member of smlibwasm fails
  `smlibpy-three/test/forms.test.ts` until it is wrapped or left out for a reason
  (`smlibpy-three/WRAPPING.md`).

## The kernel

- SMLib is fixed where it is wrong: a patched copy of the file in `third_party/patches/`, a row in
  its README (the change, and the defect it fixes), and a test that fails without it.
  `third_party/patches/README.md` says how a patch is checked and dropped.
- Where it cannot be fixed, smlibpy refuses or works around it, in Python and TypeScript alike, and
  the release notes list it under the kernel's known limitations, with the evidence.
- Results differ in the last bits between platforms (FMA on macOS arm64, Apple's x86_64 libm, the
  runners' CPUs): tests compare measures with a relative tolerance, never exactly, and say which
  platform a knife-edge case depends on.

## Releasing

1. `next` is green. `release/<version>` from it, the version raised in `pyproject.toml`,
   `src/smlibpy/__init__.py`, `js/package.json`, `js/src/index.ts`, `smlibpy-three/package.json`,
   `smlibpy-three/src/index.ts` and the two `package-lock.json`; the release notes written.
   A patch (0.5.1) only when code written for the last release still runs, old forms with a
   warning; otherwise a minor version (0.6.0), and the notes say what to change. Diff the public
   API against the last release's tag to know, rather than recalling the changes.
2. The Release workflow dispatched on the release branch builds and tests every wheel (5 Pythons
   on Linux x86_64 and arm64, macOS arm64 and x86_64, Windows), the sdist and the npm package. All
   green, or no release.
3. The release branch merged into `main` by PR; a GitHub release `v<version>` with the notes
   publishes to PyPI and npm (trusted publishing), smlibpy-three depending on the smlibwasm of its
   release. npm's trusted publishing only takes a package npm has: a new one is published once by
   hand (the file attached to the release), then given the workflow as its trusted publisher.
4. The plugin pinned to the release (`plugins/smlibpy/.mcp.json`: `smlibpy[mcp]==<version>`) in
   `main` and `next`; its skill's description current. `next` synced with `main`.
5. The website (`websites` repo, `packages/smlibpy.classcad.ch`): its docs made again from `docs/`
   (`tools/docs.py`), the feature sheet (`npm run features`) and the drawings (`npm run drawings`);
   deployed.

## Writing

Plain words, concrete, measured: a number says how it was measured, a claim names its evidence.
Docstrings say what a call does, what it returns and what it refuses. Error messages say what to
change. No marketing, in the docs or anywhere else.
