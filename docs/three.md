# three.js

smlibpy-three (`@classcad/smlibpy-three` on npm) is smlibpy's modeling API for three.js. Parts,
sketches, faces, edges and curves are three.js objects: a part is a `THREE.Mesh`, an edge a
`THREE.Line`. They take and give three's types (`Vector3`, `Matrix4`, `Plane`, `Ray`, `Box3`,
`Shape`, `Curve`, `BufferGeometry`) in three's coordinates and follow three's conventions:
`new Box(80, 10, 60)` is the box `THREE.BoxGeometry(80, 10, 60)` would be, cylinders stand along y
as `CylinderGeometry`'s do, sketches lie in the XY plane and extrude along +z as `ShapeGeometry` and
`ExtrudeGeometry` do, and angles are radians. Underneath is [smlibwasm](javascript.md), the SMLib
kernel in WebAssembly; none of it shows.

```js
import * as THREE from 'three'
import { Box, Cylinder, GridLocations, Hole, Locations, Rectangle, Y } from '@classcad/smlibpy-three'

const scene = new THREE.Scene()

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
console.log(part.volume.toFixed(1)) // 139626.5

// three's Raycaster, straight down onto the boss
const raycaster = new THREE.Raycaster(new THREE.Vector3(20, 100, 0), new THREE.Vector3(0, -1, 0))
const [hit] = raycaster.intersectObject(part)
console.log(hit.point.y, hit.brep.isBrepFace) // 36 true
// hit.brep is the face that was hit (a THREE.Mesh): the boss's top, 50 by 30 with corners of radius 6
console.log(hit.brep.area.toFixed(1)) // 1469.1
```

![The example page of the repository: hovering the top face of the boss](images/three-hover.jpg)

The package is released with smlibpy and smlibwasm, at their version, and wraps all of smlibwasm's
public API; what it leaves to three, and why, is [listed below](#what-it-leaves-to-three). The
repository's example page (`smlibpy-three/example`, `npm run example` there) shows a part, a
raycast hover, and a click on an edge that rounds it.

## Install

```bash
npm install @classcad/smlibpy-three three
```

`@classcad/smlibwasm` comes with it: the release of the same version, or a later patch (`^` that
version); `three` is a peer, 0.186 or later.
Importing the package loads the kernel (a top-level await), and after that every call is
synchronous. The package adds 0.10 MB to smlibwasm's [2.9 MB](javascript.md#size) (its JavaScript as
published, with brotli; 0.12 MB with gzip, 0.42 MB uncompressed).
`@classcad/smlibpy-three/init` loads the kernel from elsewhere, as smlibwasm's
[init](javascript.md#loading-the-kernel-from-elsewhere) does (`init({ locateFile })`), and
`@classcad/smlibpy-three/worker` runs modeling functions in a worker ([below](#off-the-main-thread)).
Vite's dev server must leave smlibwasm out of its prebundling:

```js
// vite.config.js
export default { optimizeDeps: { exclude: ['@classcad/smlibwasm'] } }
```

## Every shape is a three object

| smlibpy | here | extends |
|---|---|---|
| `Part`, `Box`, `Cylinder`, `Cone`, `Sphere`, `Hole`, ... | `Part` and its subclasses (`Box`, `Cylinder`, `Cone`, `Ball`, `Hole`, ...) | `THREE.Mesh` |
| `Shell`, `Sketch`, `Rectangle`, `Circle`, `Text`, ... | `Shell`, `Sketch` and its subclasses | `THREE.Mesh` (double sided) |
| the edges of a body, drawn | `body.edgeLines` (a child of the body) | `THREE.LineSegments` |
| `Face` | `BrepFace` | `THREE.Mesh` |
| `Edge`, `Line`, `Spline`, `Helix`, `CenterArc`, ... | `BrepEdge` and its subclasses (`Segment`, `Spline`, ...) | `THREE.Line` |
| `Wire`, `Polyline`, `FilletPolyline` | `Wire` and its subclasses | `THREE.Line` |
| `Vertex` | `BrepVertex` | `THREE.Points` |
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
and add flags (`isPart`, `isBody`, `isBrepFace`, `isBrepEdge`, ...). No export shares a name with
three's (core or addons): smlibpy's `Line`, `Sphere`, `Triangle`, `Font`, `Face`, `Edge` and `Vertex`
are `Segment`, `Ball`, `TriangleSketch`, `OpenTypeFont`, `BrepFace`, `BrepEdge` and `BrepVertex` here.

## three's coordinates, three's geometries

The kernel works in three's coordinates: a point (x, y, z) is the kernel's (x, y, z), and there is no
axis change anywhere. Where smlibpy assumes Z up, the package follows three instead:

- **Solids take three's geometries' arguments**, defaults and placement (without their segment
  counts: the solids are exact; a number where the options go is a TypeError):

  | three | here |
  |---|---|
  | `BoxGeometry(width, height, depth)` | `new Box(width, height, depth)` |
  | `CylinderGeometry(radiusTop, radiusBottom, height, …, thetaStart, thetaLength)` | `new Cylinder(radiusTop, radiusBottom, height, { thetaStart, thetaLength })` |
  | `ConeGeometry(radius, height, …, thetaStart, thetaLength)` | `new Cone(radius, height, { thetaStart, thetaLength })` |
  | `SphereGeometry(radius, …, phiStart, phiLength, thetaStart, thetaLength)` | `new Ball(radius, { phiStart, phiLength, thetaStart, thetaLength })` |
  | `TorusGeometry(radius, tube, …, arc)` | `new Torus(radius, tube, { arc })` |
  | `RingGeometry(innerRadius, outerRadius, …, thetaStart, thetaLength)` | `new AnnularSector(innerRadius, outerRadius, height, { thetaStart, thetaLength })` |

  Cylinders and cones stand along y, a ball's poles are on y, a torus and a ring lie in the XY
  plane, each centered as three centers it and turned as three turns it (a sector of a cylinder runs
  from +z towards +x, as `CylinderGeometry`'s). `Pyramid` and `Wedge` take a box's
  `(width, height, depth)` and stand along y; `Hole` drills along -z into a face (below). `align`
  moves a solid by its bounding box (`{ y: 'min' }` stands it on the XZ plane).
- **2D is the XY plane**, as three's 2D shapes and curves are: sketches lie in it and face +z
  (`ShapeGeometry`), extrude along +z (`ExtrudeGeometry`) and revolve about y (`LatheGeometry`); a
  sketch's own (x, y) is three's (x, y). Arcs, ellipses, spirals and the pen of `Profile` turn
  counterclockwise seen from +z (`EllipseCurve`), text reads along +x seen from the front, a helix
  rises along +z (three's `HelixCurve`). Patterns (`GridLocations`, `PolarLocations`), flat patterns of
  sheet metal, drawing views, DXF and SVG lie in the XY plane too.
- **A face's frame has its z along the face's normal**, as a sketch on it lies: `sketch.on(face)`
  draws on the face, `Locations(face)` gives frames there, and a `Hole` placed at one drills into the
  face. A cylinder (along y) stands on a face once turned (`cylinder.rotation.x = Math.PI / 2`).
- **Directions are three's**: `top()` is the highest along +y, `front()` the nearest along +z
  (towards three's default camera), `right()` along +x. Deformations twist, taper and unroll about y
  and bend toward +y by default. Pictures' named views look as they say in a three scene ('top' from
  +y, 'front' from +z).
- **Files are read and written as they are**, as three's STLLoader and OBJLoader take files: a file's
  coordinates are three's. CAD files are mostly Z up: stand what a loader gives in a Y-up scene with
  `group.rotation.x = -Math.PI / 2`, as three's loaders turn assets that say they are Z up. USD says
  so: `USDBrepLoader` turns a Z-up stage that way, as three's own USDLoader does, and
  `USDBrepExporter` writes a Z-up stage of what the scene shows.

## three's types in and out

| smlibpy | here |
|---|---|
| `Vector` (points, directions) | `THREE.Vector3` (or any `{ x, y, z }`); results are new Vector3s, or fill a `target` |
| sketch coordinates | `THREE.Vector2`, and `THREE.Shape`, `THREE.Path` (with holes): `new Sketch(shapes)` |
| `Location`, `Pos`, `Rot` | the object's transform; `THREE.Matrix4` where a placement is an argument |
| `Locations`, `GridLocations`, ... | `THREE.Matrix4[]`; `shape.at(locations)` gives clones placed there |
| `Plane` | `THREE.Plane` (split, section, mirror, `face.plane`); a `Matrix4` where a frame is meant (`frame`) |
| `Axis` | `THREE.Ray` (revolve, fold, `face.axis`, deformation axes) |
| `BoundBox` | `THREE.Box3` |
| `X`, `Y`, `Z` | three's axes as frozen Vector3s: `Y` is up |
| curves as arguments (paths, rails, outlines) | `BrepEdge`, `Wire`, or any `THREE.Curve<Vector3>` |
| `Mesh` (triangles) | `TriangleMesh`; from any `THREE.BufferGeometry` (also by assigning one to its `geometry`), and `new Part(geometry)` makes a body of a closed one |
| `NurbsSurface` data | plain data, or three's `NURBSSurface` (addons) |
| degrees | radians, as everywhere in three |
| `import_step`, `to_step`, ... | loaders (`THREE.Loader`: `load`, `loadAsync`, `parse`) and exporters (`parse`) |
| `MassProperties`, `DraftAnalysis`, `Bend`, ... | the package's records, in three's types |
| `ModelingError`, `KernelError`, `FontError` | the package's own, with the same fields, in the package's words |

three's curves become exact kernel curves: lines, arcs and ellipses (with three's angles, direction
and rotation), quadratic and cubic Béziers as the same curves, and Catmull-Rom splines
(`SplineCurve`, `CatmullRomCurve3` of all three types) as B-splines that run exactly where three's
run: each segment of three's is a cubic Hermite curve, so a Bézier curve. Other curves (an app's own
subclass) are fitted through points. So an SVG (`SVGLoader.createShapes`) or a font
(`Font.generateShapes`) becomes an exact sketch where three's ShapeGeometry would lie, and a solid.
The other way, `edge.curve` is a `THREE.Curve` along the exact edge:
`new THREE.TubeGeometry(edge.curve, 64, 1)`.

## Placement

- Coordinates are in the object's own frame, as a geometry's are: what a query gives (`getCenter()`,
  `bbox()`, `pointAt()`, `normalAt()`) and what a method takes (a point, a direction, a
  `THREE.Plane`, a `THREE.Curve`) is in the frame of the object it is called on.
- Shapes given to an operation are taken where they are in the world (their `matrixWorld`), as
  `object.attach()` keeps an object where it is: a tool moved with `tool.position.x = 10`, turned with
  `tool.rotation.y`, scaled, or placed in a group, cuts there (`TransformControls` on a tool, then
  `part.cut(tool)`). Scales go to the kernel too (a scale different per axis makes B-splines of the
  faces).
- The result is in the frame of the object the operation is called on and has its transform, name,
  flags and material, as its `clone()` would: it takes the original's place in the scene graph, also
  in a group. (A sheet or sketch made from a part keeps its own, two-sided material.) A free
  function's first shape plays that object.
- A body's faces, edges and vertices are where the body is.

## One API: methods and functions

The package follows smlibpy's rules for the API, as smlibwasm does:

- **Every operation of a body is a method and a function.** `part.draft(faces, angle, plane)` is
  `draft(part, faces, angle, plane)`: the function has the method's name and parameters, takes the
  body first, gives what the method gives (in the body's frame, with its transform), and is a
  TypeError, saying what it takes, for a shape it does not take. `fillet`, `chamfer` and
  `filletPreview` take the edges and find their part. Two names are three's: `scale` is a function
  only (an object's `scale` is its transform) and `outline` a method only (three's TSL has an
  `outline`).
- What stays a method: selections and topology (`faces()`, `top()`), measuring and checking
  (`bbox`, `classify`, `check`), placing (three's transforms, `at`, `on`), representations (`toMesh`,
  `toNurbs`). What stays a function: what makes a shape of several (`loft`, `blend`, `network`,
  `fitCurve`), files (loaders and exporters), pictures (`render`, `renderExploded`).
- **Parameters are named in full** (`tolerance`, `angleTolerance`), **choices are typed**
  (`corners: 'round' | 'sharp'`), and every export has a doc comment (the
  [three.js API](api/three.md) shows them).
- **smlibwasm's old forms are not the package's.** smlibwasm keeps an option it renamed
  (`angleTol`) and a flag it took by position (`edges(true)`) working for a release, with a
  warning; the package never had them, so it refuses them as an option it does not have ("did you
  mean 'angleTolerance'?").

## Values and objects

Operations return new objects and leave their inputs as they were, as smlibpy's do
(`part.fillet(...)` is a new part). What is three's (transform, material, visibility, children) is
changed in place as on any object. A parametric rebuild makes a new part and puts it where the old
one was (the example page does it on a click), or copies it into the old object as three copies
objects: `part.copy(scope(() => model(params)))`. Each face, edge and vertex is one object per body,
made when first asked for: `part.faces()[3]` is the same object every time, and the one a raycast
hit gives.

## Picking: three's Raycaster

There is no picking API of the package's own. A body's `raycast` is three's `Mesh.raycast`, and on
each intersection it sets `intersection.brep` to the face that was hit; the body's `edgeLines` are
three's `LineSegments` (hit within `raycaster.params.Line.threshold`, in world units, as three hits
lines) and set the edge. Everything else on the intersection is three's, and three's rules hold
(layers, recursion, invisible objects are hit). `brep` is one key, which survives R3F's spreading of
intersections into its events (`e.brep`) and collides with no DOM event property. The face of a hit
is found from the hit triangle's vertex (vertices are split per face), so it stays right whatever
order a BVH puts the triangles in. The kernel's exact ray cast is `body.intersectRay(ray)`.

A face, edge or vertex of a body draws itself: add it as a child of its body and it shows in place,
in its own highlight material (`part.add(hit.brep)`; remove it again to clear the highlight), after
the body's edge lines (`renderOrder` 1), in WebGLRenderer and WebGPURenderer alike. These children
are not raycast, so they do not hit twice. Lines are drawn as three draws them, one pixel wide; fat
lines or tubes for highlights are the app's choice (the example page draws a tube along
`edge.curve`). Points too: WebGPU draws them one pixel wide, so on WebGPURenderer's WebGPU backend a
vertex's highlight is a pixel (WebGLRenderer draws it 8 pixels wide).

## Disposal and memory

`dispose()` frees what the object made: its tessellation (once no clone draws it), its own default
materials, and its kernel body (once no clone holds it), and fires three's `'dispose'`. A material
assigned to it is the app's, as with any three object. A disposed body stays in the scene as it was
drawn (three uploads a disposed geometry again); modeling with it throws. Without `dispose()` the
garbage collector frees the kernel's bodies (smlibwasm's FinalizationRegistry), between tasks of the
event loop. In a loop that does not return to the event loop, `scope(fn)` disposes what `fn` made
and its result does not hold.

## Off the main thread

Kernel calls are synchronous. `@classcad/smlibpy-three/worker` runs modeling functions in a worker
(`expose` there, `new KernelWorker(...)` here), on smlibwasm's transport (see
[Running off the main thread](javascript.md#running-off-the-main-thread)): bodies cross as their
exact kernel bodies with their transform, name and settings, faces and edges as their body and index
(a seam as its place among the edges with the seams), curves, meshes, groups and three's math types
as themselves; materials stay on their thread (their color and name cross). A body coming back
brings its tessellation, made in the worker, so the page only uploads it to the GPU: tessellating is
the slow step of drawing a large part. A call can time out or be aborted; a crash or a timeout ends
the worker, and the next call starts a new one.

## What it leaves to three

All of smlibwasm's public API is wrapped, but for these, and the repository's
`smlibpy-three/test/forms.test.ts` checks it name by name:

- smlibwasm's value classes (`Vector`, `Axis`, `Location`, `Plane`, `BoundBox`, `Pos`, `Rot`, `Hit`,
  `Nurbs`, ...): three's types stand in for them, and the package's records for its results.
- `translate`, `rotate`, `moved` and `Locations.mul`: placement is three's transforms (`position`,
  `rotation`, `scale`, `applyMatrix4`) and `shape.at(locations)`; scaling a body itself is the
  function `scale(shape, factor)`. A face, edge or vertex of a body is where its body is: it is not
  placed or mirrored on its own (`face.toShell()` is a sheet of it), and has no faces, edges or
  vertices of its own kind (it is one).
- Members under names three's objects have, or that three's renderers read off every object they
  draw: smlibpy's `raycast` is `intersectRay` (three's `raycast` keeps its protocol), `center()` is
  `getCenter()` (three's name, as `Box3.getCenter`: three's WebGPURenderer reads an object's
  `center` as a Sprite's, and failed on every body with a method of that name),
  `Edge.add`/`Wire.add` is `new Wire([a, b])`, a mesh's `length` is `triangleCount`, `mesh` is
  `toMesh` (a curve's mesh: its polyline geometry), a whole body's `named`/`colored` is its
  object's `name` and material (faces: `nameFaces`, `colorFaces`), and the function `outline` is
  three's (a TSL node): call the method.
- The viewer (`show`, `htmlPage`): three is the viewer.
- Mesh formats (STL, OBJ, glTF/GLB): three's own loaders and exporters do them; a body is a Mesh,
  and a `TriangleMesh` is made of any BufferGeometry.
- Node path functions (`exportStep`, `importStep`, `readStep`, `save`, `load`, `Shape.export`,
  `Picture.save`): loaders take URLs and bytes, exporters give text or bytes.
- The raw kernel layer (`@classcad/smlibwasm/kernel`): no stable API, and it would show smlibwasm.
- IGES export and binary USD: smlibwasm has none either. render's `annotate`: it labels the
  kernel's stage, not three's axes. A mesh's kernel arrays: its geometry is their three view.

## API

The API reference has a page of its own: [three.js API](api/three.md), every export of
`@classcad/smlibpy-three` as a TypeScript declaration with its doc comment, beside the
[Python API](api/index.md) and the [WASM API](api/wasm.md).
