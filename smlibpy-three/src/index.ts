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

export { FontError, KernelError, ModelingError } from './errors.ts'
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
  type PushOptions,
  type RegionLike,
  type SortKey,
  type SweepOptions,
} from './shapes.ts'
export {
  DraftAnalysis,
  MassProperties,
  SectionProperties,
  type BodyInfo,
  type ClosestPoints,
  type Continuity,
  type Curvature,
  type FaceDraft,
  type Problem,
  type RayHit,
} from './properties.ts'
export {
  AnnularSector,
  Box,
  Cone,
  CounterBoreHole,
  CounterSinkHole,
  Cylinder,
  Hole,
  Pyramid,
  Sphere,
  Torus,
  Wedge,
  type PlacementOptions,
  type SphereOptions,
  type TorusOptions,
} from './primitives.ts'
export {
  ArcSlot,
  Circle,
  Ellipse,
  Hull,
  Polygon,
  Rectangle,
  RegularPolygon,
  RoundedRectangle,
  Slot,
  Stroke,
  Text,
  Trapezoid,
  Triangle,
  makeFace,
  type CornerOptions,
  type HullItem,
  type SketchPlacement,
  type SketchPoint,
  type StrokeOptions,
  type TextOptions,
  type TrapezoidOptions,
} from './sketches.ts'
export { Profile, type Coordinates } from './profiles.ts'
export { DEFAULT_FONT, Font, loadFont, type Contour, type FontSource, type PairAdjustment } from './font.ts'
export {
  Bezier,
  CenterArc,
  ConicArc,
  EllipticalArc,
  FilletPolyline,
  Helix,
  HyperbolicArc,
  Line,
  ParabolicArc,
  PolarLine,
  Polyline,
  RadiusArc,
  SagittaArc,
  Spiral,
  Spline,
  TangentArc,
  ThreePointArc,
  fitCurve,
  makeCompatible,
  type ArcSideOptions,
  type FitCurveOptions,
  type HelixOptions,
} from './curves.ts'
export {
  ACCURACY,
  GridLocations,
  HexLocations,
  Locations,
  PolarLocations,
  TOLERANCE,
  X,
  Y,
  Z,
  chamfer,
  extrude,
  fillet,
  loft,
  merge,
  mirror,
  offset,
  revolve,
  section,
  shell,
  split,
  sweep,
  swing,
  thicken,
  type LoftOptions,
  type ProfileLike,
} from './operations.ts'
export { STEPExporter, STEPLoader, type STEPExporterOptions } from './files.ts'
