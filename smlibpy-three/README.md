# smlibpy-three (draft)

smlibpy's CAD modeling API for three.js. Parts, sketches, faces, edges and curves are three.js
objects: a part is a `THREE.Mesh`, an edge a `THREE.Line`. They take and give three's types
(`Vector3`, `Matrix4`, `Plane`, `Ray`, `Box3`, `Shape`, `Curve`, `BufferGeometry`) in three's
coordinates, Y up. Underneath is smlibwasm (`@classcad/smlibwasm`, the SMLib kernel in WebAssembly);
none of it shows.

```js
import * as THREE from 'three'
import { Box, Cylinder, Rectangle, GridLocations, Y } from '@classcad/smlibpy-three'

let part = new Box(120, 80, 12, { align: { y: 'min' } }) // a THREE.Mesh, lying on the XZ plane
part = part.fillet(part.edges().parallelTo(Y), 10)

const boss = new Rectangle(50, 30, { fillet: 6 }).on(part.faces().top().one()).extrude(24)
part = part.fuse(boss).cut(new Cylinder(5, 40).at(GridLocations(90, 50, 2, 2)))

const bore = new Cylinder(8, 100)
bore.rotation.x = Math.PI / 2 // tools are placed with three's transforms
bore.position.y = 24
part = part.cut(bore)

scene.add(part)

const [hit] = raycaster.intersectObject(part) // three's Raycaster
hit.brep // the Face that was hit (a THREE.Mesh); on part.edgeLines, the Edge (a THREE.Line)
```

![The example page: hovering the top face of the boss](example/hover.jpg)

Status: a draft, not published. It wraps all of smlibwasm 0.5's public API (what is left out, and
why, is listed below), with 168 tests (`npm test`) and an example page (`npm run example`).
[API.md](API.md) is the API reference; [WRAPPING.md](WRAPPING.md) says how a feature is wrapped.

## Using it

```bash
npm install
npm test           # node's test runner, on the TypeScript sources
npm run build      # dist/ with declarations that name nothing of smlibwasm's
npm run api        # API.md, the API reference, from the declarations (after a build)
npm run example    # the example page (Vite)
```

`@classcad/smlibwasm` is a dependency (here `file:../js`; build it first: `npm run wasm` and
`npm run build` in `js/`), `three` a peer (developed on 0.186.1). Importing the package loads the
kernel (a top-level await, 2.8 MB with brotli), and after that every call is synchronous.
`@classcad/smlibpy-three/init` loads the kernel from elsewhere (`init({ locateFile })`), and
`@classcad/smlibpy-three/worker` runs modeling functions in a worker (below). Vite's dev server must
leave smlibwasm out of its prebundling (`optimizeDeps: { exclude: ['@classcad/smlibwasm'] }`, see
`example/vite.config.ts`).

## Design

### Every shape is a three object

| smlibpy | here | extends |
|---|---|---|
| `Part`, `Box`, `Cylinder`, `Cone`, `Sphere`, `Hole`, ... | `Part` and its subclasses | `THREE.Mesh` |
| `Shell`, `Sketch`, `Rectangle`, `Circle`, `Text`, ... | `Shell`, `Sketch` and its subclasses | `THREE.Mesh` (double sided) |
| the edges of a body, drawn | `body.edgeLines` (a child of the body) | `THREE.LineSegments` |
| `Face` | `Face` | `THREE.Mesh` |
| `Edge`, `Line`, `Spline`, `Helix`, `CenterArc`, ... | `Edge` and its subclasses | `THREE.Line` |
| `Wire`, `Polyline`, `FilletPolyline` | `Wire` and its subclasses | `THREE.Line` |
| `Vertex` | `Vertex` | `THREE.Points` |
| `Mesh` (triangles) | `TriangleMesh` | `THREE.Mesh` |
| `ShapeList` | `ShapeList` (an Array, with smlibpy's selectors) | `Array` |

A body's `geometry` is the tessellation of its exact B-rep: one geometry cut from one tessellation
of the whole body (faces share the points where they meet), vertices split per face, with the
kernel's normals of the exact surfaces (not averaged ones), and faces' own colors as vertex colors.
It is made when three first reads it (to render, raycast, measure with `Box3`): intermediate parts of
a modeling chain are never tessellated. `part.tolerance` (chord height) and `part.angle` set how
fine; clones share one tessellation, as three's clones share their geometry. The material is any
three material; the default is a `MeshStandardMaterial` pushed back with `polygonOffset` so the edge
lines show (an app material without it hides them). They behave as any Object3D: `scene.add`,
`position`, `rotation`, `scale`, `layers`, `visible`, `clone()`, `copy()`, `toJSON()` (plain Mesh
and LineSegments that ObjectLoader reads back), three's renderers, `Box3.setFromObject`, three's
GLTFExporter and STLExporter for the tessellation. Classes keep three's `type` ('Mesh', 'Line', ...)
and add flags (`isPart`, `isBody`, `isFace`, `isEdge`, ...).

Primitives are made as three's geometries are: `new Box(80, 60, 10)`, with their arguments in
`parameters`. Results of operations are `Part`, `Shell` or `Sketch`.

### three's types in and out

| smlibpy | here |
|---|---|
| `Vector` (points, directions) | `THREE.Vector3` (or any `{ x, y, z }`); results are new Vector3s, or fill a `target` |
| sketch coordinates | `THREE.Vector2`, and `THREE.Shape`, `THREE.Path` (with holes): `new Sketch(shapes)` |
| `Location`, `Pos`, `Rot` | the object's transform; `THREE.Matrix4` where a placement is an argument |
| `Locations`, `GridLocations`, ... | `THREE.Matrix4[]`; `shape.at(locations)` gives clones placed there |
| `Plane` | `THREE.Plane` (split, section, mirror, `face.plane`); a `Matrix4` where a frame is meant |
| `Axis` | `THREE.Ray` (revolve, fold, `face.axis`, deformation axes) |
| `BoundBox` | `THREE.Box3` |
| `X`, `Y`, `Z` | three's axes as frozen Vector3s: `Y` is up |
| curves as arguments (paths, rails, outlines) | `Edge`, `Wire`, or any `THREE.Curve<Vector3>` |
| `Mesh` (triangles) | `TriangleMesh`; from any `THREE.BufferGeometry`, and `new Part(geometry)` makes a body of a closed one |
| `NurbsSurface` data | plain data, or three's `NURBSSurface` (addons) |
| degrees | radians, as everywhere in three |
| `import_step`, `to_step`, ... | loaders (`THREE.Loader`: `load`, `loadAsync`, `parse`) and exporters (`parse`) |
| `MassProperties`, `DraftAnalysis`, `Bend`, ... | the package's records, in three's types and axes |
| `ModelingError`, `KernelError`, `FontError` | the package's own, with the same fields |

three's curves become exact kernel curves: lines, arcs and ellipses (with three's angles, direction
and rotation), quadratic and cubic Béziers as the same curves, and Catmull-Rom splines
(`SplineCurve`, `CatmullRomCurve3` of all three types) as B-splines that run exactly where three's
run: each segment of three's is a cubic Hermite curve, so a Bézier curve. Other curves (an app's own
subclass) are fitted through points. So an SVG (`SVGLoader.createShapes`) or a font
(`Font.generateShapes`) becomes an exact sketch, and a solid. The other way, `edge.curve` is a
`THREE.Curve` along the exact edge: `new THREE.TubeGeometry(edge.curve, 64, 1)`.

### Y up: where the axis change happens

smlibpy and smlibwasm are Z up, three is Y up. The change happens once, at the boundary to the
kernel (`src/kernel.ts`, the only module that imports smlibwasm): a point (x, y, z) of three's is
the point (x, -z, y) of the kernel's. Everything the API takes and gives is three's; nothing else in
the package knows about Z up. A model built with smlibpy's calls stands the same way up in three:

- What smlibpy builds along its Z axis runs along three's Y: cylinders and cones stand (as three's
  `CylinderGeometry` does), and `Box(length, width, height)` is `length` along x, `width` along z,
  `height` along y.
- Sketches lie on the ground of their frame (three's XZ plane, smlibpy's XY), face up and extrude
  up. Their own 2D y runs along -z, so a top view shows a sketch as drawn. Turn one to three's XY
  plane (as `ShapeGeometry` lies) with `sketch.rotation.x = Math.PI / 2`, or stand its geometry up
  with `.on(new THREE.Matrix4().makeRotationX(Math.PI / 2))` (smlibpy's `.on(Plane.front)`).
- Selectors keep their meaning: `top()` is the highest along +Y, `front()` the nearest along +Z
  (towards three's default camera). Holes drill down (-y), into a face placed with `Locations(face)`.
- Arcs, spirals and polar patterns turn counterclockwise seen from above (about +Y); planar curves,
  DXF drawings, drawing views and flat patterns lie on the ground.
- Files are Z up, as smlibpy's: exporters write a part standing in three standing in the file, and
  loaders read it back standing. Named views of pictures ('top', 'front', 'iso') mean the same.

The axis change is not a rotated root object or a rotation baked into geometries: the coordinates
the API speaks are three's, so `intersection.point`, `part.worldToLocal(...)`, `face.center()` and
the geometry agree with each other without a conversion function in between.

### Placement

- Coordinates are three's, in the object's own frame, as a geometry's are: what a query gives
  (`center()`, `bbox()`, `pointAt()`, `normalAt()`) and what a method takes (a point, a direction, a
  `THREE.Plane`, a `THREE.Curve`) is in the frame of the object it is called on.
- Shapes given to an operation are taken where they are in the world (their `matrixWorld`): a tool
  moved with `tool.position.x = 10`, turned with `tool.rotation.y`, scaled, or placed in a group, cuts
  there (`TransformControls` on a tool, then `part.cut(tool)`). Scales go to the kernel too (a
  scale different per axis makes B-splines of the faces).
- The result is in the frame of the object the operation is called on and has its transform, name,
  flags and material, as its clone would: it takes the original's place in the scene graph. (A sheet
  or sketch made from a part keeps its own, two-sided material.) A free function's first shape plays
  that object.
- A body's faces, edges and vertices are where the body is.

### Values and objects

Operations return new objects and leave their inputs as they were, as smlibpy's do
(`part.fillet(...)` is a new part). What is three's (transform, material, visibility, children) is
changed in place as on any object. A parametric rebuild makes a new part and puts it where the old
one was (the example does it on a click), or copies it into the old object:
`part.copy(scope(() => model(params)))`. Each face, edge and vertex is one object per body:
`part.faces()[3]` is the same object every time, and the one a raycast hit gives.

### Picking: three's Raycaster

There is no picking API of the package's own. A body's `raycast` is three's `Mesh.raycast`, and on
each intersection it sets `intersection.brep` to the face that was hit; the body's `edgeLines` are
three's `LineSegments` (hit within `raycaster.params.Line.threshold`, in world units) and set the
edge. Everything else on the intersection is three's, and three's rules hold (layers, recursion,
invisible objects are hit). `brep` is one key, which survives R3F's spreading of intersections into
its events (`e.brep`) and collides with no DOM event property. The face of a hit is found from the
hit triangle's vertex (vertices are split per face), so it stays right whatever order a BVH puts
the triangles in. The kernel's exact ray cast is `body.intersectRay(ray)`.

A face, edge or vertex of a body draws itself: add it as a child of its body and it shows in place,
in its own highlight material (`part.add(hit.brep)`; remove it again to clear the highlight). These
children are not raycast, so they do not hit twice.

### Disposal and memory

`dispose()` frees what the object made: its tessellation (once no clone draws it), its own default
materials, and its kernel body (once no clone holds it), and fires three's `'dispose'`. A material
assigned to it is the app's, as with any three object. A disposed body stays in the scene as it was
drawn (three uploads a disposed geometry again); modeling with it throws. Without `dispose()` the
garbage collector frees the kernel's bodies (smlibwasm's FinalizationRegistry), between tasks of the
event loop. In a loop that does not return to the event loop, `scope(fn)` disposes what `fn` made
and its result does not hold. R3F calls `dispose()` on the objects it creates when they unmount.

### Off the main thread

Kernel calls are synchronous. `@classcad/smlibpy-three/worker` runs modeling functions in a worker
(`expose` there, `new KernelWorker(...)` here), on smlibwasm's transport: bodies cross as their exact
kernel bodies with their transform, name and settings, faces and edges as their body and index,
curves, meshes, groups and three's math types as themselves; materials stay on their thread (their
color and name cross). A call can time out or be aborted; a crash or a timeout ends the worker, and
the next call starts a new one.

### smlibwasm, hidden

`src/kernel.ts` imports smlibwasm and converts everything that crosses: values (with the axis
change), angles, and errors (the package's own `ModelingError`, `KernelError` and `FontError`,
without the kernel's error as a cause). Kernel values live in per-object state under a symbol, not
in properties. The build strips the helpers the modules share (`@internal`) from the declarations
and checks that no declaration names smlibwasm (`scripts/declarations.mjs`); an app type-checks
against the declarations without smlibwasm installed, and a test checks that nothing reachable from
the results is one of smlibwasm's classes.

The package needs one function smlibwasm did not export: `faceMeshes` (smlibpy's
`smlibpy.mesh.face_meshes`, one mesh per face cut from one tessellation of the body), now exported
from `@classcad/smlibwasm` on this branch.

## What changed from the first draft

The first draft (`BrepMesh` and friends, on ice since 2026-10-21) showed smlibwasm's shapes in
three. This one is smlibpy's API in three terms, after the notes on that one:

- `toThree`/`fromThree` are gone: the API speaks three's types throughout, in three's coordinates,
  so there is nothing to convert.
- `fromStep` and the other `from...` functions are three's loaders and exporters: `STEPLoader`
  (`load`, `loadAsync`, `parse`), `STEPExporter` (`parse`), and the same for the other formats.
- No `BrepGroup`: a file loads as a `THREE.Group` of parts, and an assembly is a group.
- No `pick()`: three's Raycaster, with the face or edge on the intersection.
- The part is the mesh (`class Part extends THREE.Mesh`), not a view of a value: the measured
  problems of that (the `scale`, `raycast`, `dispose`, `add` and `clone` collisions, R3F disposing
  the body, transforms lost by operations) are solved by dropping smlibpy's `translate`, `rotate`
  and `scale` for three's transforms, using three's raycast protocol, a dispose that frees what the
  object made, clones that share the body, and results that keep their receiver's transform.

## Coverage

All of smlibwasm 0.5's public API, by area ([API.md](API.md) has every signature):

| area | what |
|---|---|
| Shapes | `Part`, `Shell`, `Sketch`, `Face`, `Edge`, `Wire`, `Vertex`, `ShapeList`: every member but placement (Booleans, fillets, chamfers, shells, offsets, splits, sections, cells, imprints, slices, removing fillets and faces, drafts, direct face edits, sheet trims and blends, curve edits, NURBS data, face colors and names, all the selectors) |
| Solids | `Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge`, `Pyramid`, `AnnularSector`, `Hole`, `CounterBoreHole`, `CounterSinkHole`; `new Part(bufferGeometry)` |
| Sketches and text | `Rectangle`, `RoundedRectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`, `Triangle`, `Trapezoid`, `Slot`, `ArcSlot`, `Stroke`, `Hull`, `makeFace`, `Text`, `new Sketch(threeShapes)`, `Profile`, `Font`, `loadFont`, `DEFAULT_FONT` |
| Curves | `Line`, `PolarLine`, `Polyline`, `FilletPolyline`, `CenterArc`, `ThreePointArc`, `RadiusArc`, `SagittaArc`, `TangentArc`, `EllipticalArc`, `ParabolicArc`, `HyperbolicArc`, `ConicArc`, `Spline`, `Bezier`, `Helix`, `Spiral`, `fitCurve`, `makeCompatible`, `Edge.fromNurbs`, `new Edge(threeCurve)`, `new Wire(edges or curvePath)` |
| Operations and patterns | `extrude`, `revolve`, `sweep`, `loft`, `swing` (solids of sketches, sheets of curves), `fillet`, `chamfer`, `shell`, `offset`, `mirror`, `split`, `merge`, `section`, `thicken`; `GridLocations`, `PolarLocations`, `HexLocations`, `Locations`; `TOLERANCE`, `ACCURACY`, `X`, `Y`, `Z` |
| Measurements | `MassProperties`, `SectionProperties`, `DraftAnalysis`, closest points, curvature, continuity, exact ray hits, checks, `info` |
| Deformations | `twist`, `taper`, `bend`, `unroll` (of parts, sheets, curves and points), `Lattice` |
| Surfaces | `surface`, `nurbsSurface`, `ruled`, `stitch`, `surfaceFillet`, `blend`, `fill`, `network`, `FitReport`, `StitchReport` |
| Sheet metal | `fold`, `flange`, `bends`, `unfold`, `flatPattern`, `Bend`, `FlatPattern`, `bendAllowance`, `bendDeduction`, `developedLength` |
| Triangle meshes | `TriangleMesh` (mesh Booleans, decimation, repair, sections and slices, `toPart`, exact rays), `tessellate`, `body.toMesh()` |
| Files | STEP (bodies, curves, points, coordinate systems), IGES (reading), DXF, SVG (writing), USD (exact bodies), OpenCASCADE BREP, SMLib SMB and SMP; `drawingViews` |
| Pictures | `render` (a PNG without a GPU), `diffImages`, `VIEWS` |
| Memory and settings | `scope`, `memoryUsage`, `setWarningHandler`, `setGuardSeconds`, `setGuardBooleans` |
| Entries | `@classcad/smlibpy-three/worker` (`KernelWorker`, `expose`), `@classcad/smlibpy-three/init` |

Left out, and why:

- smlibwasm's value classes (`Vector`, `Axis`, `Location`, `Plane`, `BoundBox`, `Pos`, `Rot`, `Hit`,
  `Nurbs`, ...): three's types stand in for them, and the package's records for its results.
- `translate`, `rotate`, `moved`, `scale` and `Locations.mul`: placement is three's transforms
  (`position`, `rotation`, `scale`, `applyMatrix4`) and `shape.at(locations)`.
- Members under names three's objects have: smlibpy's `raycast` is `intersectRay` (three's
  `raycast` keeps its protocol), `Edge.add`/`Wire.add` is `new Wire([a, b])`, a mesh's `length` is
  `triangleCount`, a whole body's `named`/`colored` is its object's `name` and material (faces:
  `nameFaces`, `colorFaces`).
- The viewer (`show`, `htmlPage`): three is the viewer.
- Mesh formats (STL, OBJ, glTF/GLB): three's own loaders and exporters do them; a body is a Mesh,
  and a `TriangleMesh` is made of any BufferGeometry.
- Node path functions (`exportStep`, `importStep`, `readStep`, `save`, `load`, `Shape.export`,
  `Picture.save`): loaders take URLs and bytes, exporters give text or bytes.
- The raw kernel layer (`@classcad/smlibwasm/kernel`): no stable API, and it would show smlibwasm.
- IGES export and binary USD: smlibwasm has none either. render's `annotate`: it labels the
  kernel's axes (Z up). A mesh's kernel arrays: its geometry is their three view.

## Open questions

These are decisions for whoever owns the package; the draft takes the first answer each time.

1. **The package's name.** `@classcad/smlibpy-three` here (next to `@classcad/smlibwasm`); it was
   called smlibpy-three.
2. **`Box(length, width, height)` or three's `(width, height, depth)`.** The draft keeps smlibpy's
   arguments, with the height up (y), so smlibpy code builds the same part standing the same way.
   But a three user reads `new Box(80, 60, 10)` as `BoxGeometry(80, 60, 10)`, 60 high; writing the
   tests, the author got it wrong three times. The other choice follows three and changes the part a
   ported smlibpy model builds. (The same holds for `Wedge`, `Pyramid` and the grids' axes.)
3. **The sketch plane.** Sketches lie on the ground (smlibpy's XY, three's XZ) and extrude up, so
   `Rectangle(80, 60).extrude(10)` is the same plate as `Box(80, 60, 10)`. three's `ShapeGeometry`
   and `ExtrudeGeometry` lie on XY and extrude towards +z: an SVG logo made into a sketch lies on the
   floor here, unless turned.
4. **Radians.** Angles are radians, as in three; smlibpy's are degrees (draft angles, revolve 360).
5. **Results keep their receiver's transform** (clone semantics: the result takes the original's
   place in the scene graph). three-bvh-csg instead gives results in world space with an identity
   transform. And should a result share the receiver's material and name, as a clone does?
6. **The hit's key: `intersection.brep`.** Alternatives: `subshape`, `topology`, or one key per kind.
7. **Picking edges in world units.** Edge lines are three's LineSegments, so their pick radius is
   `raycaster.params.Line.threshold`, in world units; CAD wants pixels (the example sets the
   threshold from the camera every move).
8. **The kernel's messages.** Errors and warnings keep smlibwasm's words, which sometimes name its
   API or its axes (`.on(Plane.front)`, "the Z axis", coordinates "at (x, y, z)" Z up, Profile labels
   in degrees). The package could translate the known ones in `kernel.ts`.
9. **Faces, edges and vertices as Object3Ds.** They draw themselves (highlights are children), but
   they are full Object3Ds (a few KB each, made on first `faces()`), and a face's own transform is
   ignored when it is an operand (it is where its body is).
10. **Updating in place.** `part.copy(next)` swaps an object's shape (with its transform); a
    `part.shape = next`-like setter would keep the transform. Inside `scope`, copy the scope's result.
11. **Tessellations stay on their thread.** A body coming back from the worker is tessellated on the
    main thread when first drawn, the slow step for large parts; carrying the tessellation along
    needs a hook in shapes.ts. Subclasses arrive as their base class (`Box` as `Part`).
12. **Option names kept, types changed.** `bend`'s `plane` is a `Matrix4` (a frame: a THREE.Plane
    has no x direction); `frame` might read better.
13. **Files.** `DXFLoader` gives a Sketch, or a Group of wires (`wires: true`): a union type. STEP
    coordinate systems are named empties (`THREE.Object3D`), not a class of their own, so unnamed
    ones are not written back. SMB and SMP write text by default, as smlibpy does.
14. **Triangle meshes' frames.** `new TriangleMesh(bodies)` puts the mesh in the world frame,
    `tessellate(bodies)` in the first body's. Assigning `geometry` to a body or mesh changes only
    what is drawn (`<triangleMesh><boxGeometry/></triangleMesh>` in R3F draws a box of an empty mesh).
15. **Names three also has.** `Line` and `Sphere` (three's core: `Line` even extends `THREE.Line`),
    `Face` (an @types/three type), `USDLoader` (three's addons, a mesh loader). With
    `import * as THREE from 'three'` they do not clash; named imports do.
16. **Thin lines.** WebGL draws lines one pixel wide, so a highlighted edge (a `THREE.Line`) is
    faint; the example draws a tube along `edge.curve` instead. Fat lines are an app's choice.
17. **R3F.** The classes work with `extend()` (zero-argument constructors, settable props, three's
    raycast and dispose); typings, hooks or a declarative layer are not part of this draft.

## Layout

| | |
|---|---|
| `src/kernel.ts` | the boundary: smlibwasm, the axis change, values, angles, errors |
| `src/convert.ts` | three's curves and 2D shapes as exact kernel curves |
| `src/tessellation.ts` | faces and edges as three geometries |
| `src/shapes.ts` | `Body`, `Part`, `Shell`, `Sketch`, `EdgeLines`, `Face`, `Edge`, `Wire`, `Vertex`, `ShapeList` |
| `src/properties.ts` | the records of measurements and checks |
| `src/primitives.ts`, `src/sketches.ts`, `src/curves.ts`, `src/profiles.ts`, `src/font.ts` | smlibpy's constructors as subclasses, Profile, fonts |
| `src/operations.ts` | the free functions, patterns and constants |
| `src/deform.ts`, `src/surfaces.ts`, `src/sheetmetal.ts` | deformations, surfaces, sheet metal |
| `src/mesh.ts`, `src/render.ts` | triangle meshes, pictures |
| `src/files.ts`, `src/drawing.ts` | loaders and exporters, drawing views |
| `src/memory.ts`, `src/worker.ts`, `src/init.ts` | scope and settings, the worker entry, the init entry |
| `scripts/` | the declarations check, the API reference |
| `test/` | one file per area |
| `example/` | a three.js page: a part, a raycast hover, click an edge to round it |
