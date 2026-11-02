// smlibwasm: CAD modeling in JavaScript on SMLib, the open-source NURBS solid modeling kernel,
// compiled to WebAssembly. smlibpy's API, for the browser and Node:
//
//     import { Box, Cylinder, GridLocations, Z } from '@classcad/smlibwasm'
//
//     let plate = Box(80, 60, 10)
//     plate = plate.fillet(plate.edges().parallelTo(Z), 8)
//     plate = plate.cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, 10)))
//     const step = toStep(plate)

// (first: in a browser it starts defeature's probe worker while the kernel loads, see there)
import './_guard.ts'

export const version = '0.6.2'

// geometry
export {
  TOLERANCE,
  Axis,
  BoundBox,
  ClosestPoints,
  Continuity,
  Curvature,
  Hit,
  Location,
  Nurbs,
  NurbsSurface,
  Plane,
  Pos,
  Rot,
  Vector,
  X,
  Y,
  Z,
  type VectorLike,
} from './geometry.ts'
export { Align, type AlignLike } from './align.ts'
// shapes
export { ACCURACY, Edge, Face, MassProperties, Part, Problem, SectionProperties, Shape, ShapeList, Shell, Sketch, Vertex, Wire } from './shapes.ts'
export { Mesh, RepairReport, faceMeshes, tessellate } from './mesh.ts'
// curves
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
} from './curves.ts'
// sketches
export { Profile } from './profiles.ts'
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
  Trapezoid,
  Triangle,
  makeFace,
} from './sketches.ts'
export { Text } from './text.ts'
export { DEFAULT_FONT, Font, FontError, loadFont } from './font.ts'
// parts
export { AnnularSector, Box, Cone, CounterBoreHole, CounterSinkHole, Cylinder, Hole, Pyramid, Sphere, Torus, Wedge } from './parts.ts'
// patterns
export { GridLocations, HexLocations, Locations, PolarLocations, type LocationLike } from './locations.ts'
// operations
export {
  chamfer,
  cut,
  draft,
  extend,
  extrude,
  fillet,
  filletPreview,
  flatten,
  fuse,
  imprint,
  intersect,
  intersectionCurves,
  loft,
  matchEdge,
  merge,
  mergeFaces,
  mirror,
  moveFaces,
  offset,
  offsetFaces,
  outline,
  partingLine,
  project,
  push,
  removeFaces,
  removeFillets,
  revolve,
  scale,
  section,
  shell,
  silhouette,
  slices,
  split,
  sweep,
  swing,
  thicken,
  trim,
  warp,
  xor,
} from './operations.ts'
// removing fillets and faces: the time limit of a kernel step
export { GUARD_BOOLEANS, GUARD_SECONDS, setGuardBooleans, setGuardSeconds } from './defeature.ts'
// deformations
export { Lattice, bend, deform, taper, twist, unroll } from './deformations.ts'
// surfaces
export { FitReport, StitchReport, blend, fill, network, nurbsSurface, ruled, stitch, surface, surfaceFillet } from './surfaces.ts'
// sheet metal
export { Bend, FlatPattern, type KFactor, bendAllowance, bendDeduction, developedLength, flange, flatPattern, fold, unfold } from './sheetmetal.ts'
// files, viewer, pictures
export {
  exportFile,
  exportGlb,
  exportGltf,
  exportObj,
  exportStep,
  exportStl,
  fromFile,
  importStl,
  load,
  save,
  fromSmb,
  toFile,
  toSmb,
  fromSmp,
  toSmp,
  fromStl,
  toGlb,
  toGltf,
  toObj,
  toStep,
  toStl,
} from './exporters.ts'
export {
  StepModel,
  fromStep,
  fromStepModel,
  importStep,
  readStep,
  StepCurve,
  StepFrame,
  StepPoint,
} from './step_import.ts'
export { fromIges, importIges, type IgesImportOptions } from './iges_import.ts'
export { exportDxf, fromDxf, fromDxfWires, importDxf, importDxfWires, toDxf } from './dxf.ts'
export { DrawingView, drawingViews, exportSvg, toSvg, type DrawingViewsOptions, type SvgItemsLike, type SvgOptions } from './drawing.ts'
export { MachiningSetup, machiningSetup, type MachiningLeft, type MachiningReason, type MachiningSetupOptions } from './machining.ts'
export { exportUsd, fromUsd, importUsd, toUsd, type UsdExportOptions, type UsdImportOptions, type UsdReadOptions } from './usd.ts'
export { exportBrep, fromBrep, importBrep, toBrep, type BrepImportOptions } from './occt.ts'
export { ImageDiff, Picture, VIEWS, diffImages, render, type Frame, type ImageLike, type RenderOptions } from './pictures.ts'
export { AssemblyAxis, assemblyAxes, renderExploded, type AssemblyAxesOptions, type ExplodedOffsets, type RenderExplodedOptions } from './exploded.ts'
export { htmlPage, show, type PageOptions, type ShowOptions } from './viewer.ts'
// errors, warnings and memory
export { KernelError, ModelingError } from './_errors.ts'
export { memoryUsage, scope, setWarningHandler, type MemoryUsage } from './kernel.ts'
// the types of options, selections and results, to name them in an app's own code
export type { Matrix, Movable, XYZ } from './geometry.ts'
export type { BodyOptions, ColorLike, EdgesLike, ExtrudeOptions, FacesLike, FilletOptions, FilletRadius, IsoOptions, PushOptions, RegionLike, SortKey, SourcesLike, WallsLike } from './shapes.ts'
export type { Coordinates } from './profiles.ts'
export type { CornerOptions, HullItem, PlacementOptions, PolygonOptions, TrapezoidOptions } from './sketches.ts'
export type { TextOptions } from './text.ts'
export type { Contour, PairAdjustment, Point, Segment } from './font.ts'
export type { ExtrudeFunctionOptions, SweepOptions } from './operations.ts'
export type { BendOptions, LatticeIndex, LatticeLayers, RangeOptions, TaperOptions, TwistOptions } from './deformations.ts'
export type { DraftAnalysis, FaceDraft } from './molding.ts'
export type { BendAllowanceOptions, DevelopedLengthOptions, FlangeOptions, FoldOptions, UnfoldOptions } from './sheetmetal.ts'
export type { FileItemsLike, FileOptions, GltfOptions, MeshOptions, ShapesLike, StepExportOptions, StepItemsLike } from './exporters.ts'
export type { BytesLike } from './_bytes.ts'
export type { DxfReadOptions, DxfShapesLike, DxfWriteOptions } from './dxf.ts'
export type { CurvatureKind, RenderMarker, RenderPoint, RenderView, Renderable } from './pictures.ts'
