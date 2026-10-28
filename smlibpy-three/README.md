# smlibpy-three

smlibpy's CAD modeling API for three.js. Parts, sketches, faces, edges and curves are three.js
objects: a part is a `THREE.Mesh`, an edge a `THREE.Line`. They take and give three's types
(`Vector3`, `Matrix4`, `Plane`, `Ray`, `Box3`, `Shape`, `Curve`, `BufferGeometry`) in three's
coordinates and follow three's conventions: `new Box(80, 10, 60)` is the box
`THREE.BoxGeometry(80, 10, 60)` would be, cylinders stand along y as `CylinderGeometry`'s do, sketches
lie in the XY plane and extrude along +z as `ShapeGeometry` and `ExtrudeGeometry` do, angles are
radians. Underneath is smlibwasm (`@classcad/smlibwasm`, the SMLib kernel in WebAssembly); none of it
shows.

**[Documentation](https://smlibpy.classcad.ch/docs/three)** · **[API reference](https://smlibpy.classcad.ch/docs/three#api)** ·
**[GitHub](https://github.com/awv-informatik/smlibpy/tree/main/smlibpy-three)**

```js
import * as THREE from 'three'
import { Box, Cylinder, GridLocations, Hole, Locations, Rectangle, Y } from '@classcad/smlibpy-three'

let part = new Box(120, 12, 80, { align: { y: 'min' } }) // a THREE.Mesh, lying on the ground
part = part.fillet(part.edges().parallelTo(Y), 10)

const top = part.faces().top().one()
part = part.fuse(new Rectangle(50, 30, { fillet: 6 }).on(top).extrude(24)) // a sketch on the top face, extruded up

const [frame] = Locations(top) // the face's frame: its z is the face's normal
part = part.cut(new Hole(5, 20).at(GridLocations(90, 50, 2, 2).map((m) => frame.clone().multiply(m))))

const bore = new Cylinder(8, 8, 100) // along y, as THREE.CylinderGeometry(8, 8, 100)
bore.rotation.x = Math.PI / 2 // tools are placed with three's transforms
bore.position.y = 24
part = part.cut(bore)

scene.add(part)

const [hit] = raycaster.intersectObject(part) // three's Raycaster
hit.brep // the BrepFace that was hit (a THREE.Mesh); on part.edgeLines, the BrepEdge (a THREE.Line)
```

![The example page: hovering the top face of the boss](example/hover.jpg)

It is released with smlibpy and smlibwasm, at their version, and wraps all of smlibwasm's public API
(what it leaves to three, and why, is in the documentation, and `test/forms.test.ts` checks it name
by name), with 197 tests (`npm test`) and an example page (`npm run example`). The
[documentation](https://smlibpy.classcad.ch/docs/three) has the design (three's objects, coordinates
and types, placement, picking, memory, workers) and the API reference; in this repository it is
[docs/three.md](../docs/three.md), whose examples `test/docs.test.ts` runs.
[WRAPPING.md](WRAPPING.md) says how a feature is wrapped.

## Using it

```bash
npm install @classcad/smlibpy-three three
```

In this repository:

```bash
npm install
npm test           # node's test runner, on the TypeScript sources
npm run build      # dist/ with declarations that name nothing of smlibwasm's
npm run api        # the API section of docs/three.md, from the declarations (after a build)
npm run example    # the example page (Vite)
```

`@classcad/smlibwasm` is a dependency, at the same version (in this repository `file:../js`: build it
first, `npm run wasm` and `npm run build` in `js/`), `three` a peer, 0.186 or later (developed on
0.186.1). Importing the package loads the kernel (a top-level await, 2.9 MB with brotli), and after
that every call is synchronous.
`@classcad/smlibpy-three/init` loads the kernel from elsewhere (`init({ locateFile })`), and
`@classcad/smlibpy-three/worker` runs modeling functions in a worker
([Off the main thread](https://smlibpy.classcad.ch/docs/three#off-the-main-thread)). Vite's dev server must
leave smlibwasm out of its prebundling (`optimizeDeps: { exclude: ['@classcad/smlibwasm'] }`, see
`example/vite.config.ts`).

## smlibwasm, hidden

`src/kernel.ts` imports smlibwasm and converts everything that crosses: values, angles, and errors
(the package's own `ModelingError`, `KernelError` and `FontError`, without the kernel's error as a
cause). The kernel's messages and warnings come in the package's words: its classes by the package's
names, `on()` where it says `.on(Plane.front)`, angles in radians ("between -π and π radians").
Kernel values live in per-object state under a symbol, not in properties. The build strips the
helpers the modules share (`@internal`) from the declarations and checks that no declaration names
smlibwasm (`scripts/declarations.mjs`); an app type-checks against the declarations without
smlibwasm installed, and a test checks that nothing reachable from the results is one of smlibwasm's
classes.

The package needs one function smlibwasm did not export: `faceMeshes` (smlibpy's
`smlibpy.mesh.face_meshes`, one mesh per face cut from one tessellation of the body), now exported
from `@classcad/smlibwasm` on this branch.

## Decisions

The design's open questions, as they were decided:

1. **The name**: `@classcad/smlibpy-three`.
2. **three's coordinates and arguments**: no axis change (it was three's (x, y, z) = the kernel's
   (x, -z, y)), and the solids take three's geometries' arguments (`Box(width, height, depth)`, not
   smlibpy's `Box(length, width, height)` with its height up).
3. **The sketch plane**: XY, extruding along +z, as `ShapeGeometry` and `ExtrudeGeometry`.
4. **Radians**, as three.
5. **Results as three's methods make objects**: an operation's result is what `clone()` gives (the
   receiver's transform, name and material), with the operands taken where they are in the world, as
   `attach()` takes an object. (three-bvh-csg's `evaluate()`, a function of brushes, gives results in
   world space with an identity transform instead; a method of the receiver keeps its frame, so a
   part in a group, as STEPLoader gives assemblies, stays where it was.)
6. **`intersection.brep`** stays the key of the hit face or edge.
7. **Edges are picked as three picks lines**: within `raycaster.params.Line.threshold`, in world
   units (an app that wants pixels sets it from the camera, as the example does).
8. **The kernel's messages are translated** (see above).
9. **Faces, edges and vertices stay Object3Ds**: made when first asked for, one per sub-shape, they
   draw themselves as highlights and are what a raycast gives.
10. **Updating in place is `copy()`**, three's own: `part.copy(next)` takes `next`'s body and
    transform.
11. **Workers bring tessellations**: a body that comes back from a worker is drawn without being
    tessellated again. Subclasses arrive as their base class (a `Box` as a `Part`), as results of
    operations are.
12. **Option names follow their types**: bend's frame and DXFExporter's drawing frame are `frame`
    (a `THREE.Matrix4`; smlibpy calls them `plane`, which is a `THREE.Plane` here).
13. **Files**: `DXFLoader` gives a `THREE.Group` (of one sketch, or of wires with `wires: true`), as
    every loader gives one type; STEP coordinate systems are named empties (`THREE.Object3D`); SMB and
    SMP write the kernel's text form by default.
14. **Triangle meshes**: `new TriangleMesh(bodies)` takes the bodies where they are in the world (a
    constructor has no receiver), `tessellate(bodies)` in the first body's frame (a free function's
    first shape is its receiver); a geometry assigned to a mesh is its mesh, as a `THREE.Mesh`'s
    geometry is its shape.
15. **No name clashes with three** (see the renames above).
16. **Thin lines** are the app's choice.
17. **three only for now**: R3F typings, hooks or components come later.

## Coverage

All of smlibwasm's public API as `next` has it, by area (the [API reference](../docs/three.md#api)
has every signature):

| area | what |
|---|---|
| Shapes | `Part`, `Shell`, `Sketch`, `BrepFace`, `BrepEdge`, `Wire`, `BrepVertex`, `ShapeList`: every member but placement (Booleans, fillets, chamfers, shells, offsets, splits, sections, cells, imprints, slices, removing fillets and faces, drafts, direct face edits, sheet trims and blends, curve edits, NURBS data, face colors and names, all the selectors) |
| Solids | `Box`, `Cylinder`, `Cone`, `Ball`, `Torus`, `Wedge`, `Pyramid`, `AnnularSector`, `Hole`, `CounterBoreHole`, `CounterSinkHole`; `new Part(bufferGeometry)` |
| Sketches and text | `Rectangle`, `RoundedRectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`, `TriangleSketch`, `Trapezoid`, `Slot`, `ArcSlot`, `Stroke`, `Hull`, `makeFace`, `Text`, `new Sketch(threeShapes)`, `Profile`, `OpenTypeFont`, `loadFont`, `DEFAULT_FONT` |
| Curves | `Segment`, `PolarLine`, `Polyline`, `FilletPolyline`, `CenterArc`, `ThreePointArc`, `RadiusArc`, `SagittaArc`, `TangentArc`, `EllipticalArc`, `ParabolicArc`, `HyperbolicArc`, `ConicArc`, `Spline`, `Bezier`, `Helix`, `Spiral`, `fitCurve`, `makeCompatible`, `BrepEdge.fromNurbs`, `new BrepEdge(threeCurve)`, `new Wire(edges or curvePath)` |
| Operations and patterns | every operation of a body as a function too: `fuse`, `cut`, `intersect`, `xor`, `fillet`, `chamfer`, `filletPreview`, `shell`, `offset`, `mirror`, `scale`, `split`, `merge`, `section`, `thicken`, `imprint`, `draft`, `moveFaces`, `offsetFaces`, `removeFaces`, `removeFillets`, `push`, `warp`, `flatten`, `extend`, `trim`, `matchEdge`, `mergeFaces`, `project`, `silhouette`, `intersectionCurves`, `partingLine`, `slices`; the sweeps `extrude`, `revolve`, `sweep`, `loft`, `swing` (solids of sketches, sheets of curves); `GridLocations`, `PolarLocations`, `HexLocations`, `Locations`; `TOLERANCE`, `ACCURACY`, `X`, `Y`, `Z` |
| Measurements | `MassProperties`, `SectionProperties`, `DraftAnalysis`, closest points, curvature, continuity, exact ray hits, checks, `info` |
| Deformations | `twist`, `taper`, `bend`, `unroll`, `deform` (of parts, sheets, curves and points), `Lattice` |
| Surfaces | `surface`, `nurbsSurface`, `ruled`, `stitch`, `surfaceFillet`, `blend`, `fill`, `network`, `FitReport`, `StitchReport` |
| Sheet metal | `fold`, `flange`, `bends`, `unfold`, `flatPattern`, `Bend`, `FlatPattern`, `bendAllowance`, `bendDeduction`, `developedLength` |
| Triangle meshes | `TriangleMesh` (mesh Booleans, decimation, repair, sections and slices, `toPart`, exact rays), `tessellate`, `body.toMesh()` |
| Files | STEP (bodies, curves, points, coordinate systems), IGES (reading), DXF, SVG (writing), USD (`USDBrepLoader`, `USDBrepExporter`: usd-brep's exact bodies), OpenCASCADE BREP, SMLib SMB and SMP; `drawingViews` |
| Pictures | `render` (a PNG without a GPU), `diffImages`, `VIEWS` |
| Memory and settings | `scope`, `memoryUsage`, `setWarningHandler`, `setGuardSeconds`, `setGuardBooleans` |
| Entries | `@classcad/smlibpy-three/worker` (`KernelWorker`, `expose`), `@classcad/smlibpy-three/init` |

What it leaves to three, and why, is in the documentation:
[What it leaves to three](../docs/three.md#what-it-leaves-to-three).

## Layout

| | |
|---|---|
| `src/kernel.ts` | the boundary: smlibwasm, values, angles, errors and their words |
| `src/convert.ts` | three's curves and 2D shapes as exact kernel curves |
| `src/tessellation.ts` | faces and edges as three geometries |
| `src/shapes.ts` | `Body`, `Part`, `Shell`, `Sketch`, `EdgeLines`, `BrepFace`, `BrepEdge`, `Wire`, `BrepVertex`, `ShapeList` |
| `src/properties.ts` | the records of measurements and checks |
| `src/primitives.ts` | the solids, as three's geometries |
| `src/sketches.ts`, `src/curves.ts`, `src/profiles.ts`, `src/font.ts` | sketches and text, curves, Profile, fonts |
| `src/operations.ts` | every operation of a body as a function, the sweeps, patterns and constants |
| `src/deformations.ts`, `src/surfaces.ts`, `src/sheetmetal.ts` | deformations, surfaces, sheet metal |
| `src/mesh.ts`, `src/pictures.ts` | triangle meshes, pictures (and the stage render and drawings draw on) |
| `src/files.ts`, `src/drawing.ts` | loaders and exporters, drawing views |
| `src/memory.ts`, `src/worker.ts`, `src/init.ts` | scope and settings, the worker entry, the init entry |
| `scripts/` | the declarations check, the API section of `docs/three.md` |
| `test/` | one file per area; `forms.test.ts` holds the API to smlibwasm's, name by name; `docs.test.ts` runs the examples of `docs/three.md` |
| `example/` | a three.js page: a part, a raycast hover, click an edge to round it |
