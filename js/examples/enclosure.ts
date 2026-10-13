// Electronics enclosure: rounded box, shelled, with screw bosses and a matching lid.
import { Align, Cylinder, GridLocations, type Part, RoundedRectangle, ShapeList } from '../src/index.ts'

const C = Align.CENTER
const MIN = Align.MIN

export function model(): ShapeList<Part> {
  const [w, d, h, wall] = [100, 64, 32, 2]
  let box = RoundedRectangle(w, d, 8).extrude(h)
  box = box.fillet(box.faces().bottom().edges(), 4)
  box = box.shell(wall, box.faces().top())

  const boss = Cylinder(4, h - wall, { align: [C, C, MIN] }).cut(Cylinder(1.4, h, { align: [C, C, MIN] }))
  box = box.fuse(GridLocations(w - 16, d - 16, 2, 2).mul(boss).translate(0, 0, wall))

  let lid = RoundedRectangle(w, d, 8).extrude(wall)
  const lip = RoundedRectangle(w - 2 * wall - 0.4, d - 2 * wall - 0.4, 6).extrude(-3)
  lid = lid.fuse(lip).cut(GridLocations(w - 16, d - 16, 2, 2).mul(Cylinder(1.7, 20)))
  lid = lid.translate(0, 0, h + 15)
  return new ShapeList(box.named('box').colored('#5b6b7f'), lid.named('lid').colored('#d9925a'))
}
