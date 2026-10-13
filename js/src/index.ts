// smlibjs: CAD modeling in JavaScript on SMLib, the open-source NURBS solid modeling kernel,
// compiled to WebAssembly. smlibpy's API, for the browser and Node:
//
//     import { Box, Cylinder, GridLocations, Z } from 'smlibjs'
//
//     let plate = Box(80, 60, 10)
//     plate = plate.fillet(plate.edges().parallelTo(Z), 8)
//     plate = plate.cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, 10)))
//     const step = toStep(plate)

export const version = '0.0.0'

// geometry
export { TOLERANCE, Axis, BoundBox, Location, Plane, Pos, Rot, Vector, X, Y, Z, type VectorLike } from './geometry.ts'
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
// parts
export { Box, Cone, CounterBoreHole, CounterSinkHole, Cylinder, Hole, Sphere, Torus, Wedge } from './parts.ts'
// patterns
export { GridLocations, HexLocations, Locations, PolarLocations } from './locations.ts'
// operations
export { chamfer, extrude, fillet, loft, mirror, offset, revolve, section, shell, split, sweep, thicken } from './operations.ts'
// deformations
export { Lattice, bend, taper, twist } from './deform.ts'
// surfaces
export { ruled, stitch, surface } from './surfaces.ts'
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
  fromStl,
  toGlb,
  toGltf,
  toObj,
  toStep,
  toStl,
} from './exporters.ts'
export { fromStep, importStep } from './step_import.ts'
export { exportDxf, fromDxf, fromDxfWires, importDxf, importDxfWires, toDxf } from './dxf.ts'
export { diffImages, render } from './render.ts'
export { htmlPage, show } from './viewer.ts'
// errors and warnings
export { KernelError, ModelingError, setWarningHandler } from './kernel.ts'
