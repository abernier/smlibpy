// Involute spur gear with a bore and a keyway.
import { Circle, Line, type Part, PolarLocations, Rectangle, type Sketch, Spline, ThreePointArc, Wire, makeFace } from '../src/index.ts'

export function involuteTooth(module: number, teeth: number, pressureAngle = 20): Sketch {
  const rp = (module * teeth) / 2 // pitch radius
  const rb = rp * Math.cos((pressureAngle * Math.PI) / 180) // base radius
  const ra = rp + module // tip radius
  const rr = rp - 1.25 * module // root radius

  const involute = (r: number): [number, number] => {
    const t = Math.sqrt(Math.max((r / rb) ** 2 - 1, 0))
    return [rb * (Math.cos(t) + t * Math.sin(t)), rb * (Math.sin(t) - t * Math.cos(t))]
  }

  // half tooth thickness at the pitch circle is a quarter of the circular pitch
  const inv = (a: number) => Math.tan(a) - a
  const halfAngle = Math.PI / (2 * teeth) + inv((pressureAngle * Math.PI) / 180)
  const start = Math.max(rb, rr)
  const pts = Array.from({ length: 13 }, (_, i) => involute(start + ((ra - start) * i) / 12))
  const rot = (p: [number, number], a: number): [number, number] => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)]
  const right = pts.map((p) => rot(p, -halfAngle))
  const left = right
    .slice()
    .reverse()
    .map(([x, y]): [number, number] => [x, -y])

  const flankR = Spline(...right)
  const flankL = Spline(...left)
  const tip = ThreePointArc(right[right.length - 1], [ra, 0], left[0])
  const rootR: [number, number] = [rr * 0.98, (right[0][1] * rr) / right[0][0]]
  const rootL: [number, number] = [rr * 0.98, (left[left.length - 1][1] * rr) / left[left.length - 1][0]]
  const outline = new Wire([Line(rootR, right[0]), flankR, tip, flankL, Line(left[left.length - 1], rootL), Line(rootL, rootR)])
  return makeFace(outline)
}

export function model(module = 2, teeth = 24, width = 12, bore = 10): Part {
  const rr = (module * teeth) / 2 - 1.25 * module
  const tooth = involuteTooth(module, teeth)
  let profile = Circle(rr).fuse(PolarLocations(0, teeth).mul(tooth))
  profile = profile.cut(Circle(bore / 2)).cut(Rectangle(3, 3).translate(bore / 2, 0))
  let gear = profile.extrude(width)
  gear = gear.chamfer(
    gear
      .edges()
      .circles()
      .filter((e) => e.radius > bore),
    0.5,
  )
  return gear.named('gear').colored('#d4b45a')
}
