// Mounting bracket: an L-profile extruded, with a rounded inner corner and holes in both flanges.
import { CounterSinkHole, GridLocations, Hole, type Part, Plane, Polygon, Pos, X, Z } from '../src/index.ts'

export function model(): Part {
  const t = 8 // wall thickness
  const profile = Polygon([0, 0], [60, 0], [60, t], [t, t], [t, 50], [0, 50])
  let bracket = profile.on(Plane.front).extrude(-40) // front plane faces -Y; extrude backwards

  bracket = bracket.fillet(bracket.edges().concave(), 6)
  const vertical = bracket.edges().parallelTo(Z)
  bracket = bracket.fillet(vertical.minBy(X).concat(vertical.maxBy(X)), 4) // round both ends

  const base = bracket.faces().facing(Z).bottom() // the base flange's top face at z = t
  const upright = bracket.faces().facing(X.neg()).one()
  bracket = bracket.cut(GridLocations(24, 20, 1, 2).mul(Pos(8)).mul(Hole(3.2, t)).on(base))
  bracket = bracket.cut(GridLocations(20, 1, 2, 1).mul(Pos(0, 8)).mul(CounterSinkHole(3.2, 6, t)).on(upright))
  return bracket.named('bracket').colored('#7c93b5')
}
