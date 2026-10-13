// The classic OpenCASCADE bottle, built with smlibwasm.
import { Align, Cylinder, Line, type Part, Plane, ThreePointArc, Wire, makeFace } from '../src/index.ts'

export function model(): Part {
  const [width, thickness, height] = [50, 30, 70]

  // half of the base outline: a straight flank, an arc, another flank
  const half = new Wire([
    Line([-width / 2, 0], [-width / 2, -thickness / 4]),
    ThreePointArc([-width / 2, -thickness / 4], [0, -thickness / 2], [width / 2, -thickness / 4]),
    Line([width / 2, -thickness / 4], [width / 2, 0]),
  ])
  const outline = half.add(half.mirror(Plane.XZ))

  let body = makeFace(outline).extrude(height)
  body = body.fillet(body.edges(), thickness / 12)

  const neck = Cylinder(thickness / 4, height / 10, { align: [Align.CENTER, Align.CENTER, Align.MIN] }).translate(0, 0, height)
  let bottle = body.fuse(neck)
  bottle = bottle.shell(thickness / 50, bottle.faces().top())
  return bottle.named('bottle').colored('#6bb3b3')
}
