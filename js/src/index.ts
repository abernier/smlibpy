// smlibwasm: CAD modeling in JavaScript on SMLib, the open-source NURBS solid modeling kernel,
// compiled to WebAssembly. smlibpy's API, for the browser and Node:
//
//     import { Box, Cylinder, GridLocations, Z } from '@classcad/smlibwasm'
//
//     let plate = Box(80, 60, 10)
//     plate = plate.fillet(plate.edges().parallelTo(Z), 8)
//     plate = plate.cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, 10)))
//     const step = toStep(plate)

export const version = '0.4.0'

// geometry
export { TOLERANCE, Axis, BoundBox, Hit, Location, Nurbs, Plane, Pos, Rot, Vector, X, Y, Z, type VectorLike } from './geometry.ts'
export { Align, type AlignLike } from './align.ts'
// shapes
export { ACCURACY, Edge, Face, MassProperties, Part, Shape, ShapeList, Shell, Sketch, Vertex, Wire } from './shapes.ts'
export { Mesh, tessellate } from './mesh.ts'
// curves
export {
  Bezier,
  CenterArc,
  EllipticalArc,
  FilletPolyline,
  Helix,
  Line,
  PolarLine,
  Polyline,
  RadiusArc,
  SagittaArc,
  Spline,
  TangentArc,
  ThreePointArc,
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
export { Box, Cone, CounterBoreHole, CounterSinkHole, Cylinder, Hole, Sphere, Torus, Wedge } from './parts.ts'
// patterns
export { GridLocations, HexLocations, Locations, PolarLocations } from './locations.ts'
// operations
export { chamfer, extrude, fillet, loft, merge, mirror, offset, revolve, section, shell, split, sweep, thicken } from './operations.ts'
// removing fillets and faces: the time limit of a kernel step
export { GUARD_SECONDS, setGuardSeconds } from './defeature.ts'
// deformations
export { Lattice, bend, taper, twist } from './deform.ts'
// surfaces
export { ruled, stitch, surface, surfaceFillet } from './surfaces.ts'
// sheet metal
export { Bend, FlatPattern, bendAllowance, bendDeduction, developedLength, flange, flatPattern, fold, unfold } from './sheetmetal.ts'
// files, viewer, pictures
export {
  exportFile,
  exportGlb,
  exportGltf,
  exportObj,
  exportStep,
  exportStl,
  importStl,
  load,
  save,
  fromSmb,
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
export { exportUsd, fromUsd, importUsd, toUsd, type UsdExportOptions, type UsdImportOptions, type UsdReadOptions } from './usd.ts'
export { exportBrep, fromBrep, importBrep, toBrep, type BrepImportOptions } from './occt.ts'
export { ImageDiff, Picture, VIEWS, diffImages, render, type Frame, type ImageLike, type RenderOptions } from './render.ts'
export { htmlPage, show, type PageOptions, type ShowOptions } from './viewer.ts'
// errors and warnings
export { KernelError, ModelingError, setWarningHandler } from './kernel.ts'
