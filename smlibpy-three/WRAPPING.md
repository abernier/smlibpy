# Wrapping smlibwasm

How smlibpy-three wraps a feature of smlibwasm (`@classcad/smlibwasm`, the `js/` folder), so that
every part of the package speaks three.js the same way. The README has the design; this is the
practice.

## The boundary

- Only `src/kernel.ts` imports smlibwasm. Other modules take it from there:
  `import { sm, call, vec, vector3, ... } from './kernel.ts'`. The one exception is
  `src/worker.ts`, which imports `@classcad/smlibwasm/worker` (the transport between threads, which
  does not load the kernel; going through `kernel.ts` would).
- No smlibwasm value goes into an app's hands, and no three value into smlibwasm's. Public
  signatures name three's types and the package's only; `npm run build` fails otherwise
  (`scripts/declarations.mjs`).
- Every kernel call runs in `call(() => ...)`, which gives the kernel's errors as the package's
  `ModelingError` and `KernelError`.

## Conversions (`src/kernel.ts`)

The kernel works in three's coordinates: three's (x, y, z) is the kernel's (x, y, z), and nothing
converts axes. The helpers convert types (and angles); use them rather than building kernel values by
hand.

| | in (three to kernel) | out (kernel to three) |
|---|---|---|
| point, direction | `vec(v)` (any `{ x, y, z }`) | `vector3(v, target?)` |
| sketch point (2D, the sketch's own x and y) | `vec2(v)` (any `{ x, y }`) | `new THREE.Vector2(v.x, v.y)` |
| transform | `location(matrix4)` (any affine matrix) | `matrix4(location, target?)` |
| plane | `plane(threePlane)` | `threePlane(plane, target?)` |
| axis | `axis(ray)` | `ray(axis, target?)` |
| box | `boundBox(box3)` | `box3(boundBox, target?)` |
| angle | `degrees(radians)` | `radians(degrees)` |
| alignment | `align3({ x, y, z } or one)`, `align2({ x, y } or one)` | |

The API is in radians, as three is; the kernel in degrees. The kernel's messages pass through
`words()` (in `call`, and for warnings), which names the package's classes and gives angles in
radians: a message a wrapper writes itself is in the package's words already (it never says "degrees"
or names smlibwasm's API).

## Shapes (`src/shapes.ts`, exported `@internal`)

| helper | what it does |
|---|---|
| `kernelOf(body)` | a body's kernel value (throws for an empty or disposed body) |
| `kernelOfShape(x)` | a BrepFace's, BrepEdge's, Wire's or BrepVertex's kernel value |
| `setKernel(body, value)`, `setCurve(edgeOrWire, value)` | give a new object its kernel value (constructors) |
| `internal(obj)` | true for an object the package constructs (a result, a clone): subclass constructors return at once |
| `wrap(value)` | a Part, Shell or Sketch for a kernel body |
| `adopt(result, like)` | the result of an operation called on `like` gets its transform, name, material (as a clone) |
| `operand(shape, into, what)` | a shape given to an operation of `into`, where it is in the world, in `into`'s frame |
| `toKernel(value, into)` | any argument: shapes as `operand`, three's math values converted, arrays and Maps item by item |
| `toThree(value, like)` | any result of an operation of `like`: bodies wrapped and adopted, faces/edges/vertices of `like`'s body as its objects, other curves placed where `like` is, kernel math values as three's |
| `shapeFor(body, k)` | the BrepFace, BrepEdge or BrepVertex object of `body` for a kernel face, edge or vertex |
| `curveOf(value, owner?)`, `placedCurve(value, like)` | a BrepEdge or Wire for a kernel curve: a body's, or one of its own |
| `sub(cls, owner, index, k)` | a BrepFace, BrepEdge or BrepVertex object (owner null: a vertex of its own; index -1 with an owner: a seam, in `edges({ seams: true })` only) |
| `drawnData(body)`, `takeDrawn(body, data)` | a body's tessellation as plain arrays, for another thread, and back |
| `frameOf(obj)` | the object whose frame a shape is in (a face's body, else itself) |
| `itemsOf(items)` | `(T or Iterable<T>)[]` to `T[]` |
| `isObject3D`, `isMatrix4`, `isRay` | three's types by their flags (two copies of three fail instanceof) |

## Rules

1. **Frames.** Points, directions, planes, rays, matrices and curves given to a method, and what it
   gives back, are in the frame of the object it is called on (as a geometry's coordinates are).
   Shapes given to an operation are taken where they are in the world (`operand`, `toKernel`).
   The result of an operation on `x` is `adopt(wrap(value), x)` (or `toThree(value, x)`): in `x`'s
   frame, with its transform. A free function's first shape plays `x`.
2. **Values.** Operations return new objects and leave their inputs as they were.
3. **Names.** smlibpy's names (camelCase as smlibwasm's), with three's types. A name that three's
   Object3D, Mesh, Line or Points already has (`add`, `scale`, `raycast`, `clone`, `copy`, `name`,
   `dispose`, `translate…`, `rotate…`, `lookAt`, `position`, `visible`, ...), or that three's
   renderers read off every object they draw (a Sprite's `center`, an InstancedMesh's `count`), is
   never reused with another meaning: rename it (`raycast` to `intersectRay`, `center` to
   `getCenter`) or leave it to three (placement is the object's transform, so smlibpy's `translate`,
   `rotate` and `moved` are not wrapped, and `scale` is a function only), and `test/forms.test.ts`
   reads three's renderers for those names. Parameters are whole words (`tolerance`, not `tol`),
   choices are typed as their literals (`corners?: 'round' | 'sharp'`), and modules are named as
   smlibwasm's, never after a function they hold (`deformations.ts`, `pictures.ts`). smlibwasm's old
   forms, which it takes for a release with a warning that names it (an option it renamed, a flag it
   took by position), are refused before the call, as an option the package does not have
   (`refuseRenamed`, `refusePositional` in `kernel.ts`); `test/forms.test.ts` calls each one
   smlibwasm's `js/test/_python_api.json` lists.
4. **Methods and functions.** Every operation of a body (it makes a new body, or new geometry, from
   one) is a method and a function, as the repository's AGENTS.md has it for smlibpy and smlibwasm:
   the method does the work; the function in `operations.ts` (or its domain's module) has the same
   name and parameters, takes the body first, delegates, and is a TypeError that says what it takes
   for another shape (`shapeOf`). Selections, measures, placing and representations stay methods;
   what makes a shape of several, files and pictures stay functions. `test/forms.test.ts` holds this
   and lists, for each of smlibwasm's exports and members, the package's name for it or the reason it
   is left out: a new one of smlibwasm's fails there until it is wrapped or listed.
5. **Classes.** Shapes are three objects: bodies `THREE.Mesh`, curves `THREE.Line`, points
   `THREE.Points`. A subclass constructor: `super(); if (internal(this)) return; setKernel(this, ...)`.
   Primitives keep their arguments in `parameters`, as three's geometries do. Never declare class
   fields three's constructors assign (`geometry`, `material`); type flags with `declare readonly
   isX: true` and define them on the prototype. No export may share a name with one of three's (core
   or addons): name it after smlibpy, else after what it is (`Segment`, `Ball`, `BrepFace`), and say
   smlibpy's name in its doc comment.
6. **three's conventions.** Where three has a geometry or a convention, follow it, not smlibpy's Z up:
   a solid three has a geometry of takes its arguments, defaults and placement (cylinders along y,
   theta from +z), 2D lies in the XY plane and turns counterclockwise seen from +z, a face's frame has
   its z along the face's normal, `top()` is +y and `front()` +z, files are read and written as they
   are (USD, which declares its up axis, as three's USDLoader takes it). Where the kernel assumes Z up
   (its `top()`, its default axes, its renderer's named views), the wrapper says what three means: a
   direction of its own (`maxBy(+y)`, the y axis), or the stage of `src/render.ts`.
7. **Records.** What smlibwasm returns as a record (mass properties, a draft analysis, a bend) is a
   class or interface of the package with three's types (Vector3, Plane, Ray, Box3, Matrix3) and
   radians; keep the kernel's record in a `#private` field when a method needs it.
8. **Files** read and write the way three's loaders and exporters do: an `XLoader extends
   THREE.Loader` (`load`, `loadAsync`, `parse`) and an `XExporter` (`parse`). A loader gives one type
   (a THREE.Group where a file holds several things). Coordinates go as they are (bodies through
   `wrap`/`kernelOf` and `location(matrixWorld)`).
9. **Docs.** Every export has a doc comment, which becomes the API reference: say what it does and
   which frame and unit its values are in.
10. **Tests.** node's runner, one file per area (`test/<area>.test.ts`), helpers from
   `test/_util.ts`. Check three's types in and out, the area's three conventions (against three's own
   geometry or curve where there is one), frames (a moved or rotated receiver and operand), and that
   nothing of smlibwasm's comes out (`noKernel` in `test/types.test.ts`). Run one file with
   `node --test test/<area>.test.ts`.
