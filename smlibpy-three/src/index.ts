// smlibpy-three: smlibpy's CAD modeling API for three.js, on SMLib, the NURBS solid modeling
// kernel (smlibwasm underneath, which it does not show). Parts, sketches, faces, edges and curves
// are three.js objects, in three's coordinates (Y up), taking and giving three's types:
//
//     import * as THREE from 'three'
//     import { Box, Cylinder } from '@classcad/smlibpy-three'
//
//     const hole = new Cylinder(6, 20)
//     hole.position.x = 20 // tools cut where they are
//     let part = new Box(80, 60, 10).cut(hole) // a Part: a THREE.Mesh
//     part = part.fillet(part.edges().parallelTo(new THREE.Vector3(0, 1, 0)), 4)
//     scene.add(part)
//
//     const [hit] = raycaster.intersectObject(part) // three's Raycaster
//     hit.brep // the Face (a THREE.Mesh) the ray hit; hits on part.edgeLines give an Edge

export const version = '0.1.0'

export { KernelError, ModelingError } from './errors.ts'
export type { Align2, Align3, AlignValue } from './types.ts'
export {
  Body,
  Edge,
  EdgeLines,
  Face,
  Part,
  ShapeList,
  Shell,
  Sketch,
  Vertex,
  Wire,
  type ChamferOptions,
  type EdgesLike,
  type ExtrudeOptions,
  type FacesLike,
  type FilletOptions,
  type FilletRadius,
  type SweepOptions,
} from './shapes.ts'
export { Box, Cone, Cylinder, Sphere, Torus, Wedge, type PlacementOptions } from './primitives.ts'
export { Circle, Ellipse, Polygon, Rectangle, RegularPolygon, Slot, Text, type CornerOptions, type SketchPlacement, type TextOptions } from './sketches.ts'
export { Bezier, CenterArc, Helix, Line, Polyline, Spline, ThreePointArc } from './curves.ts'
export { GridLocations, HexLocations, PolarLocations, extrude, loft, revolve, sweep, type LoftOptions } from './operations.ts'
export { STEPExporter, STEPLoader, type STEPExporterOptions } from './files.ts'
