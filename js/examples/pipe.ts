// A bent pipe: a ring profile swept along a path of lines and arcs, with flanges at the ends.
import { CenterArc, Circle, Line, type Part, Plane, PolarLocations, Wire, sweep } from '../src/index.ts'

export function model(): Part {
  const r = 30 // bend radius
  const path = new Wire([Line([0, 0, 0], [0, 0, 60]), CenterArc([r, 60], r, 180, -90, Plane.front), Line([r, 0, 60 + r], [r + 80, 0, 60 + r])])
  const pipe = sweep(Circle(10).cut(Circle(8)), path) as Part

  const flange = Circle(20).cut(Circle(8)).cut(PolarLocations(15, 4).mul(Circle(2))).extrude(4)
  const start = flange.translate(0, 0, -4)
  const end = flange.on(new Plane([r + 80, 0, 60 + r], null, [1, 0, 0]))
  return pipe.fuse(start).fuse(end).named('pipe').colored('#79ad73')
}
