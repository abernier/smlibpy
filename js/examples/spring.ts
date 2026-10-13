// Compression spring: a circle swept along a helix, with ground ends.
import { Circle, Helix, type Part, Plane, sweep } from '../src/index.ts'

export function model(): Part {
  let coil = sweep(Circle(1.2), Helix(6, 48, 10)) as Part
  coil = coil.split(Plane.XY.offset(1.2)).split(Plane.XY.offset(48 - 1.2), 'below')
  return coil.named('spring').colored('#9d87c7')
}
