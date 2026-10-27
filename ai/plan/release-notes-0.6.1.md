# smlibpy, smlibwasm and smlibpy-three 0.6.1

A patch release: the fixes merged into `next` after 0.6.0, and the first release of smlibpy-three,
smlibwasm's API for three.js. Code written for 0.6.0 runs unchanged.

Everything applies to smlibpy (Python) and smlibwasm (JavaScript and TypeScript) alike, unless
marked *Python* or *smlibwasm*.

## New

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

## Fixed

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
