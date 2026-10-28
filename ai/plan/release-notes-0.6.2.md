# smlibpy, smlibwasm and smlibpy-three 0.6.2

A patch release. Code written for 0.6.0 runs unchanged.

0.6.1 went out in part. smlibpy 0.6.1 never reached PyPI: pytest 9.2.0 came out during its upload
and refused one sheet-metal test (`pytest.approx` of a list of tuples), which failed every wheel's
tests, so nothing was uploaded. smlibpy-three 0.6.1 was not published, since it fails on three's
WebGPURenderer (fixed below). smlibwasm 0.6.1 is on npm. So on PyPI smlibpy goes from 0.6.0 to
0.6.2, which brings everything of 0.6.1 (under "From 0.6.1"), and smlibpy-three's first release is
0.6.2.

Everything applies to smlibpy (Python) and smlibwasm (JavaScript and TypeScript) alike, unless
marked *Python*, *smlibwasm* or *smlibpy-three*.

## New

- *Python*: **wheels for Python 3.15** (released on 9 October 2026), for Linux (x86_64, aarch64),
  macOS (arm64, x86_64) and Windows, as for Python 3.10 to 3.14. Until now pip built smlibpy from
  source on 3.15, which needs CMake and a C++17 compiler. CI tests 3.15 as its newest Python.

## Fixed

- *smlibpy-three*: **draws on three's WebGPURenderer.** 0.6.1 failed on the first frame with every
  body, on WebGPURenderer's WebGPU and WebGL2 backends (`object.center.clone is not a function`):
  three's node materials take any object's `center` for a sprite's, and bodies, faces, edges, wires
  and vertices had a method of that name. It is `getCenter(target)` now, three's own name for it
  (as `Box3.getCenter`). A test reads three's renderers for the names they read off an object and
  fails for a member of the package under such a name.
- *smlibpy-three*: a face, edge, wire or vertex added as a highlight draws over the body's edge
  lines; WebGPURenderer drew the lines over an edge's highlight. WebGPU draws points one pixel
  wide, so a vertex's highlight is thin there.
- *smlibpy-three*: three is a peer from 0.186 (`>=0.186`), the first version with
  `Object3D.dispose()`, which the package calls.

## Changed

- *Python*: the `test` and `docs` extras name exact versions: pytest 9.2.0 and websockets 17.3
  (16.1.1 on Python 3.10); mkdocs-material 9.8.0, mkdocstrings 1.0.8 and mkdocstrings-python
  2.0.10. CI and the release build test with them, so that a new release of a tool changes nothing
  until it is raised.

## From 0.6.1

### New

- **smlibpy-three** (`@classcad/smlibpy-three`, in `smlibpy-three/`): smlibwasm's API for three.js.
  Parts, sketches, faces, edges and curves are three.js objects (a part is a `THREE.Mesh`, an edge a
  `THREE.Line`) that take and give three's types, in three's coordinates and with three's geometry
  arguments: `new Box(80, 10, 60)` is the box `BoxGeometry(80, 10, 60)` would be, and cylinders
  stand along y. three's Raycaster picks the exact faces and edges. It wraps all of smlibwasm's
  public API; its README lists what it leaves out and why, and its `API.md` is the reference. It
  is released with smlibpy and smlibwasm from now on, at their version, and depends on the
  smlibwasm of its release: `npm install @classcad/smlibpy-three three`.
- *smlibwasm*: `faceMeshes` is exported, as smlibpy's `smlibpy.mesh.face_meshes`: one mesh per face
  of a part, shell or sketch, cut from one tessellation of the whole body. It was in `mesh.ts` but
  not exported. smlibpy-three draws a body's faces with it.

### Fixed

- **`fill` closes a round hole whose rim touches the sheet's knot lines** (#32). SMLib builds the
  tangency along each side of a four-sided patch from a field of cross tangents, which returns its
  stored corner tangents within 1e-8 of its ends. It took its derivative across that zone. Where a
  side's first knot span was shorter than 1e-4, the patch's twist at that corner came out 1.85 to
  2.7 times too large, and the patch tilted off the sheet near the corner. A rim gets such a span
  where it touches the sheet's knot lines at the patch's corners, because the rim has knots
  there. On a paraboloid sheet with knots every 5, round holes of radius 5 at x 0, 5 and 7 and of
  radius 2.5 at x 2.5 were refused, 1.65 to 20.6 degrees off. The kernel patch takes the
  derivative between two points of the field itself, past those zones. They fill within 0.009
  degrees. Holes that filled before keep their patches: the same angles, and a sphere's caps
  within 2.5e-4 of their volume.
