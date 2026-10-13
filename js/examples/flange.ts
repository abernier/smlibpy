// Pipe flange: a revolved cross-section with a bolt circle.
import { Cylinder, type Part, Plane, PolarLocations, Polygon, Z } from '../src/index.ts'

export function model(): Part {
  // half cross-section in the front plane (x = radius, y = height), revolved about Z
  const section = Polygon([25, 0], [60, 0], [60, 12], [35, 12], [35, 40], [25, 40])
  let flange = section.on(Plane.front).revolve(Z)

  flange = flange.cut(PolarLocations(47.5, 8).mul(Cylinder(5, 30)))
  flange = flange.fillet(flange.edges().concave(), 4) // neck to plate
  flange = flange.chamfer(flange.faces().top().edges().circles(), 1)
  return flange.named('flange').colored('#b08e6c')
}
