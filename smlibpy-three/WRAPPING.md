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

three is Y up, the kernel Z up: three's (x, y, z) is the kernel's (x, -z, y). Never convert by hand.

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

The API is in radians, as three is; the kernel in degrees.

## Shapes (`src/shapes.ts`, exported `@internal`)

| helper | what it does |
|---|---|
| `kernelOf(body)` | a body's kernel value (throws for an empty or disposed body) |
| `kernelOfShape(x)` | a Face's, Edge's, Wire's or Vertex's kernel value |
| `setKernel(body, value)`, `setCurve(edgeOrWire, value)` | give a new object its kernel value (constructors) |
| `internal(obj)` | true for an object the package constructs (a result, a clone): subclass constructors return at once |
| `wrap(value)` | a Part, Shell or Sketch for a kernel body |
| `adopt(result, like)` | the result of an operation called on `like` gets its transform, name, material (as a clone) |
| `operand(shape, into, what)` | a shape given to an operation of `into`, where it is in the world, in `into`'s frame |
| `toKernel(value, into)` | any argument: shapes as `operand`, three's math values converted, arrays and Maps item by item |
| `toThree(value, like)` | any result of an operation of `like`: bodies wrapped and adopted, faces/edges/vertices of `like`'s body as its objects, other curves placed where `like` is, kernel math values as three's |
| `shapeFor(body, k)` | the Face, Edge or Vertex object of `body` for a kernel face, edge or vertex |
| `curveOf(value, owner?)`, `placedCurve(value, like)` | an Edge or Wire for a kernel curve: a body's, or one of its own |
| `sub(cls, owner, index, k)` | a Face, Edge or Vertex object (owner null: a vertex of its own) |
| `frameOf(obj)` | the object whose frame a shape is in (a face's body, else itself) |
| `flatten(items)` | `(T or Iterable<T>)[]` to `T[]` |
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
   `dispose`, `translate…`, `rotate…`, `lookAt`, `position`, `visible`, ...) is never reused with
   another meaning: rename it (`raycast` to `intersectRay`) or leave it to three (placement is the
   object's transform, so smlibpy's `translate`, `rotate`, `moved` and `scale` are not wrapped).
4. **Classes.** Shapes are three objects: bodies `THREE.Mesh`, curves `THREE.Line`, points
   `THREE.Points`. A subclass constructor: `super(); if (internal(this)) return; setKernel(this, ...)`.
   Primitives keep their arguments in `parameters`, as three's geometries do. Never declare class
   fields three's constructors assign (`geometry`, `material`); type flags with `declare readonly
   isX: true` and define them on the prototype.
5. **Records.** What smlibwasm returns as a record (mass properties, a draft analysis, a bend) is a
   class or interface of the package with three's types (Vector3, Plane, Ray, Box3, Matrix3) and
   radians; keep the kernel's record in a `#private` field when a method needs it.
6. **Files** read and write the way three's loaders and exporters do: an `XLoader extends
   THREE.Loader` (`load`, `loadAsync`, `parse`) and an `XExporter` (`parse`). Files are Z up as
   smlibpy's: convert at the boundary like everything else (bodies through `wrap`/`kernelOf` and
   `location(matrixWorld)`), so a part standing in three stands in the file.
7. **Docs.** Every export has a doc comment, which becomes the API reference: say what it does and
   which frame and unit its values are in.
8. **Tests.** node's runner, one file per area (`test/<area>.test.ts`), helpers from
   `test/_util.ts`. Check three's types in and out, the area's Y-up mapping, frames (a moved or
   rotated receiver and operand), and that nothing of smlibwasm's comes out (`noKernel` in
   `test/types.test.ts`). Run one file with `node --test test/<area>.test.ts`.
