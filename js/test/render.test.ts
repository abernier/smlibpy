// The software renderer (src/render.ts): views, line style, drawings and the other options,
// checked on the pixels they produce; and the viewer's page (src/viewer.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { ImageDiff, Picture, _Camera, _FONT, _LABEL, _Scene, _curvatureSpec, _pngDecode, _text, _valueText, diffImages, render } from '../src/render.ts'
import { htmlPage, show } from '../src/viewer.ts'
import { Box, Cylinder, Sphere } from '../src/parts.ts'
import { Circle } from '../src/sketches.ts'
import { Align } from '../src/align.ts'
import { Plane, Y, Z } from '../src/geometry.ts'
import { ext, k } from '../src/kernel.ts'
import type { Part } from '../src/shapes.ts'

// -- pictures as numpy would slice them ---------------------------------------------------------
type RGB = [number, number, number]

/** Pixels: `width * height` RGB triples, row by row. */
class Px {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number

  constructor(data: Uint8Array, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }

  static of(pic: Picture): Px {
    return new Px(pic.pixels, pic.width, pic.height)
  }

  at(x: number, y: number): RGB {
    const i = (y * this.width + x) * 3
    return [this.data[i], this.data[i + 1], this.data[i + 2]]
  }

  /** numpy's `px[y0:y1, x0:x1]` (negative indices count from the end; null: to the end). */
  crop(y0: number | null, y1: number | null, x0: number | null = null, x1: number | null = null): Px {
    const [ya, yb] = slice(y0, y1, this.height)
    const [xa, xb] = slice(x0, x1, this.width)
    const w = Math.max(xb - xa, 0)
    const h = Math.max(yb - ya, 0)
    const out = new Uint8Array(w * h * 3)
    for (let y = 0; y < h; y++) out.set(this.data.subarray(((ya + y) * this.width + xa) * 3, ((ya + y) * this.width + xa + w) * 3), y * w * 3)
    return new Px(out, w, h)
  }

  /** Every pixel, row by row: [x, y, rgb]. */
  *pixels(): Generator<[number, number, RGB]> {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) yield [x, y, this.at(x, y)]
  }

  count(test: (rgb: RGB) => boolean): number {
    let n = 0
    for (const [, , rgb] of this.pixels()) if (test(rgb)) n++
    return n
  }

  every(test: (rgb: RGB) => boolean): boolean {
    for (const [, , rgb] of this.pixels()) if (!test(rgb)) return false
    return true
  }

  /** The [x, y] of the pixels that pass. */
  where(test: (rgb: RGB) => boolean): [number, number][] {
    const out: [number, number][] = []
    for (const [x, y, rgb] of this.pixels()) if (test(rgb)) out.push([x, y])
    return out
  }

  /** Per column, the smallest value of each channel over the rows (numpy's min(axis=0)). */
  minOverRows(): RGB[] {
    return Array.from({ length: this.width }, (_, x) => {
      const m: RGB = [255, 255, 255]
      for (let y = 0; y < this.height; y++) this.at(x, y).forEach((v, c) => (m[c] = Math.min(m[c], v)))
      return m
    })
  }

  /** Per row, the smallest value of each channel over the columns (numpy's min(axis=1)). */
  minOverColumns(): RGB[] {
    return Array.from({ length: this.height }, (_, y) => {
      const m: RGB = [255, 255, 255]
      for (let x = 0; x < this.width; x++) this.at(x, y).forEach((v, c) => (m[c] = Math.min(m[c], v)))
      return m
    })
  }

  equals(other: Px): boolean {
    return this.width === other.width && this.height === other.height && Buffer.from(this.data).equals(Buffer.from(other.data))
  }
}

/** Python's slice bounds of [a:b] on a length. */
function slice(a: number | null, b: number | null, n: number): [number, number] {
  const fix = (v: number | null, d: number) => (v === null ? d : v < 0 ? Math.max(v + n, 0) : Math.min(v, n))
  return [fix(a, 0), fix(b, n)]
}

/** numpy's [a:b] of a list. */
function part<T>(list: readonly T[], a: number | null, b: number | null): T[] {
  const [x, y] = slice(a, b, list.length)
  return list.slice(x, Math.max(x, y))
}

const sameData = (a: Picture, b: Picture) => Buffer.from(a.data).equals(Buffer.from(b.data))
const ptp = (v: number[]) => Math.max(...v) - Math.min(...v)
const sum = (v: boolean[]) => v.filter(Boolean).length
const rint = (x: number) => {
  const r = Math.round(x)
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** Where a world point lands in a single-view picture (right and up: the view's screen axes). */
function pixelOf(pic: Picture, right: number[], up: number[], point: number[]): [number, number] {
  const f = pic.frame!
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const x = pic.width / 2 + (dot(point, right) - f.midX) * f.scale
  const y = pic.height / 2 - (dot(point, up) - f.midY) * f.scale
  return [Math.trunc(x), Math.trunc(y)]
}

const gray = ([r, g, b]: RGB) => {
  const mean = (r + g + b) / 3
  return Math.max(Math.abs(r - mean), Math.abs(g - mean), Math.abs(b - mean)) <= 2
}

/** Number of runs of drawn (not white) pixels along a list of pixels. */
function runs(pixels: RGB[]): number {
  const ink = pixels.map((p) => Math.min(...p) < 235)
  let n = ink[0] ? 1 : 0
  for (let i = 1; i < ink.length; i++) if (ink[i] && !ink[i - 1]) n++
  return n
}

const drawn = (p: RGB) => Math.min(...p) < 200
const orange = ([r, g, b]: RGB) => r > 120 && g > 0.3 * r && g < 0.62 * r && b < 0.2 * r
const red = ([r, g, b]: RGB) => r > 150 && g < 90 && b < 90
/** The pixel is exactly this color (0 to 1), as numpy rounds it. */
const exact = (rgb: number[]) => {
  const want = rgb.map((c) => rint(c * 255))
  return (p: RGB) => p[0] === want[0] && p[1] === want[1] && p[2] === want[2]
}

function quadrants(pic: Picture): Record<'TL' | 'TR' | 'BL' | 'BR', Px> {
  const h = Math.floor(pic.height / 2)
  const w = Math.floor(pic.width / 2)
  const px = Px.of(pic)
  const q = (row: number, col: number) => px.crop(row * h + 2, row * h + h - 2, col * w + 2, col * w + w - 2)
  return { TL: q(0, 0), TR: q(0, 1), BL: q(1, 0), BR: q(1, 1) }
}

const approx = (a: number, b: number, rel = 1e-6, abs = 1e-12) => Math.abs(a - b) <= Math.max(rel * Math.abs(b), abs)

// A box with a vertical bore: from the front the bore is hidden.
let _bored: Part | null = null
const bored = (): Part => (_bored ??= Box(60, 40, 30).cut(Cylinder(8, 40)))

// -- line style and drawings --------------------------------------------------------------------
test('line style dashes hidden edges', () => {
  const pic = render(bored(), { view: 'front', lines: true, size: [400, 300] })
  assert.ok(pic instanceof Picture && pic.data instanceof Uint8Array)
  assert.deepEqual([...pic.data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  const px = Px.of(pic)
  assert.ok(px.every(gray)) // line style: no shading colors
  const [right, up] = [[1, 0, 0], [0, 0, 1]]
  const [xBore] = pixelOf(pic, right, up, [8, 0, 0])
  const [xMid] = pixelOf(pic, right, up, [20, 0, 0])
  const [, yTop] = pixelOf(pic, right, up, [0, 0, 15])
  const [, yBottom] = pixelOf(pic, right, up, [0, 0, -15])
  // the outline of the bore is hidden: dashed and lighter than the visible lines
  const dashes = px.crop(yTop + 4, yBottom - 3, xBore - 1, xBore + 2).minOverColumns()
  assert.ok(runs(dashes) >= 4)
  assert.ok(Math.min(...dashes.flat()) > 60)
  assert.ok(px.crop(yTop + 4, yBottom - 3, xMid, xMid + 1).every((p) => p.every((c) => c === 255))) // no line where the material is solid
  // the visible outline is solid and dark
  const outline = px.crop(yTop - 1, yTop + 2, xBore + 5, xMid + 20).minOverRows()
  assert.ok(Math.max(...outline.flat()) < 60)
})

test('line style draws the silhouettes of curved faces', () => {
  const pic = render(Cylinder(10, 30), { view: 'front', lines: true, size: [300, 300] })
  const [right, up] = [[1, 0, 0], [0, 0, 1]]
  const [xLeft, yMid] = pixelOf(pic, right, up, [-10, 0, 0])
  const [xRight] = pixelOf(pic, right, up, [10, 0, 0])
  const xMid = Math.floor((xLeft + xRight) / 2)
  const rows = Px.of(pic)
    .crop(yMid - 10, yMid + 10)
    .minOverRows()
    .map((p) => Math.min(...p))
  assert.ok(Math.min(...part(rows, xLeft - 2, xLeft + 3)) < 60 && Math.min(...part(rows, xRight - 2, xRight + 3)) < 60)
  // in between only the axis, thin and dash-dotted; no seam, no mesh edges
  assert.ok(part(rows, xLeft + 5, xMid - 3).every((v) => v === 255) && part(rows, xMid + 4, xRight - 5).every((v) => v === 255))
  const axis = Math.min(...part(rows, xMid - 2, xMid + 3))
  assert.ok(60 < axis && axis < 200)
})

test('drawings place the views by the projection method', () => {
  // an L-shaped part: the views from the left and from the right differ
  let p = Box(60, 40, 10, { align: Align.MIN }).fuse(Box(10, 40, 40, { align: Align.MIN }))
  p = p.cut(Cylinder(5, 100).rotate(Y, 90).translate(0, 20, 25))
  const size: [number, number] = [800, 600]
  const first = quadrants(render(p, { drawing: true, size }))
  const third = quadrants(render(p, { drawing: 'third-angle', size }))
  const thirdLeft = quadrants(render(p, { drawing: { projection: 'third-angle', side: 'left' }, size }))
  const firstRight = quadrants(render(p, { drawing: { projection: 'first-angle', side: 'right' }, size }))
  // first angle: front top left, the view from the left right of it, the top view below it
  // third angle: front bottom left, the top view above it, the view from the right right of it
  assert.ok(first.TL.equals(third.BL)) // front
  assert.ok(first.BL.equals(third.TL)) // top
  assert.ok(first.TR.equals(thirdLeft.BL)) // from the left: right of the front view in first angle
  assert.ok(third.BR.equals(firstRight.TL)) // from the right: right of it in third angle
  assert.ok(!first.TR.equals(third.BR)) // the two side views differ
  // the ortho views are drawn in line style, the iso view is shaded
  for (const q of ['TL', 'TR', 'BL'] as const) assert.ok(first[q].every(gray))
  assert.ok(!first.BR.every(gray) && !third.TR.every(gray))
})

test('the ortho views of a drawing share one scale and line up', () => {
  const pic = render(Box(80, 30, 20), { drawing: true, size: [800, 600] })
  const q = quadrants(pic)
  const ink = (v: Px) => v.crop(26, null).where((p) => Math.min(...p) < 100) // below the labels
  const [front, left, top] = [ink(q.TL), ink(q.TR), ink(q.BL)]
  const xs = (v: [number, number][]) => v.map(([x]) => x)
  const ys = (v: [number, number][]) => v.map(([, y]) => y)
  // front and top: same width and columns; front and the side view: same rows
  assert.ok(Math.abs(Math.min(...xs(front)) - Math.min(...xs(top))) <= 1 && Math.abs(Math.max(...xs(front)) - Math.max(...xs(top))) <= 1)
  assert.ok(Math.abs(Math.max(...ys(front)) - Math.max(...ys(left))) <= 1)
  // 80 wide, 30 deep: the top view is 30/80 as high as the front view is wide (one scale)
  const width = ptp(xs(front))
  const depth = ptp(ys(top))
  assert.ok(approx(depth / width, 30 / 80, 0.05))
})

test('line style draws center lines', () => {
  // seen along the axis: a cross over the bore, a little longer than its radius, dash-dotted
  const top = render(bored(), { view: 'top', lines: true, size: [400, 300] })
  let [cx, cy] = pixelOf(top, [1, 0, 0], [0, 1, 0], [0, 0, 0])
  const r = rint(8 * top.frame!.scale)
  const tp = Px.of(top)
  const row = tp.crop(cy, cy + 1).minOverRows().map(drawn)
  let col = tp.crop(null, null, cx, cx + 1).minOverColumns().map(drawn)
  assert.ok(part(row, cx - 2, cx + 3).every(Boolean) && part(col, cy - 2, cy + 3).every(Boolean)) // a dash crosses the center
  assert.ok(sum(part(row, cx + r + 2, cx + r + 9)) >= 2 && sum(part(row, cx - r - 8, cx - r - 1)) >= 2) // past the circle
  assert.ok(!part(row, cx + r + 11, cx + r + 30).some(Boolean)) // but not far
  assert.ok(runs(tp.crop(cy, cy + 1, cx - r + 2, cx + r - 1).minOverRows()) >= 3)
  // seen from the side: the axis, past the top and bottom outline
  const front = render(bored(), { view: 'front', lines: true, size: [400, 300] })
  let yTop: number
  ;[cx, yTop] = pixelOf(front, [1, 0, 0], [0, 0, 1], [0, 0, 15])
  const [, yBottom] = pixelOf(front, [1, 0, 0], [0, 0, 1], [0, 0, -15])
  const anyDrawn = (pic: Picture, x: number) =>
    Array.from({ length: pic.height }, (_, y) =>
      Px.of(pic)
        .crop(y, y + 1, x - 1, x + 2)
        .where(drawn).length > 0,
    )
  col = anyDrawn(front, cx)
  assert.ok(sum(part(col, yTop - 9, yTop - 1)) >= 2 && sum(part(col, yBottom + 2, yBottom + 10)) >= 2)
  assert.ok(!part(col, yTop - 30, yTop - 11).some(Boolean) && !part(col, yBottom + 12, yBottom + 30).some(Boolean))
  // a section cuts the cross like the part: the half towards -Y is gone
  const half = render(bored(), { view: 'top', lines: true, size: [400, 300], section: Plane.XZ })
  assert.deepEqual(half.frame, top.frame)
  ;[cx, cy] = pixelOf(half, [1, 0, 0], [0, 1, 0], [0, 0, 0])
  col = anyDrawn(half, cx)
  assert.ok(sum(part(col, cy - r - 9, cy - r - 1)) >= 2 && !part(col, cy + 3, cy + r + 30).some(Boolean))
  // not in shaded views, not on quarter-round fillets
  const shaded = Px.of(render(bored(), { view: 'top', size: [400, 300] }))
  assert.ok(shaded.crop(cy - 1, cy + 2, cx + r + 2, cx + r + 9).every((p) => !(gray(p) && drawn(p))))
  const rounded = Box(40, 30, 10).fillet(Box(40, 30, 10).edges().parallelTo(Z), 5)
  const corner = render(rounded, { view: 'top', lines: true, size: [400, 300] })
  const [x, y] = pixelOf(corner, [1, 0, 0], [0, 1, 0], [15, 10, 0])
  assert.ok(!Px.of(corner).crop(y - 3, y + 4, x - 3, x + 4).where(drawn).length)
})

test('the views of a drawing carry the center lines', () => {
  // a flat plate: the top view sets the drawing's scale, so it equals the line-style top view
  const plate = Box(60, 50, 10).cut(Cylinder(8, 20))
  const drawing = quadrants(render(plate, { drawing: true, size: [800, 600] }))
  const single = Px.of(render(plate, { view: 'top', lines: true, size: [400, 300] })).crop(2, 298, 2, 398)
  assert.ok(drawing.BL.crop(30, null).equals(single.crop(30, null))) // below the label
  const [cx, cy] = [198, 148] // the middle of the cropped panel
  assert.ok(drawing.BL.crop(cy, cy + 1, cx - 2, cx + 3).every(drawn))
})

test('the view "sheet" is the first-angle drawing', () => {
  const a = render(bored(), { view: 'sheet', size: [400, 300] })
  const b = render(bored(), { drawing: 'first-angle', size: [400, 300] })
  assert.ok(sameData(a, b) && a.frame === null)
})

test('the same input gives the same pixels', () => {
  assert.ok(sameData(render(bored(), { drawing: true, size: [400, 300] }), render(bored(), { drawing: true, size: [400, 300] })))
})

// -- cameras ------------------------------------------------------------------------------------
test('named views match turntable and direction cameras', () => {
  const px = (view: unknown) => Px.of(render(bored(), { view, size: [200, 150] }))
  const isoElevation = (Math.atan(1 / Math.sqrt(2)) * 180) / Math.PI
  assert.ok(px('front').equals(px({ azimuth: 0, elevation: 0 })))
  assert.ok(px('front').equals(px({ direction: [0, 1, 0] })))
  assert.ok(px('front').equals(px([0, -1, 0]))) // a point (array) points towards the camera
  assert.ok(px('right').equals(px({ azimuth: 90 })))
  assert.ok(px('left').equals(px({ azimuth: -90 })))
  assert.ok(px('top').equals(px({ elevation: 90 })))
  assert.ok(px('top').equals(px({ direction: [0, 0, -1] })))
  assert.ok(px('bottom').equals(px({ direction: [0, 0, 1] })))
  assert.ok(px('iso').equals(px({ azimuth: 45, elevation: isoElevation })))
  assert.ok(px('iso').equals(px([1, -1, 1])))
  assert.ok(!px({ azimuth: 60, elevation: 20 }).equals(px({ azimuth: 50, elevation: 20 })))
})

test('views are not mirrored', () => {
  const body = Box(20, 20, 20)
  const bump = Box(4, 4, 4).translate(0, -12, 0).colored('red') // sticks out at the front (-Y)
  const top = Box(4, 4, 4).translate(0, 0, 12).colored('red') // and on top
  const redAt = (view: string, ...shapes: Part[]): [number, number] => {
    const reds = Px.of(render(...shapes, { view, size: [200, 200] })).where(([r, g]) => r > 150 && g < 80)
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
    return [mean(reds.map(([x]) => x)), mean(reds.map(([, y]) => y))]
  }
  assert.ok(redAt('right', body, bump)[0] < 90) // seen from +X, the front is on the left
  assert.ok(redAt('left', body, bump)[0] > 110) // seen from -X, on the right
  assert.ok(redAt('iso', body, top)[1] < 90) // Z is up
})

test('zoom, lookAt and frame', () => {
  const a = render(bored(), { size: [300, 200] })
  const zoomed = render(bored(), { size: [300, 200], zoom: 2 })
  assert.ok(approx(zoomed.frame!.scale, 2 * a.frame!.scale))
  const at = render(bored(), { view: 'front', size: [300, 200], lookAt: [30, 0, 15] })
  assert.ok(approx(at.frame!.midX, 30) && approx(at.frame!.midY, 15))
  // a pinned frame gives the same picture; zoom and lookAt no longer apply
  const again = render(bored(), { size: [300, 200], frame: a.frame, zoom: 3, lookAt: [1, 2, 3] })
  assert.ok(sameData(again, a))
  assert.ok(sameData(render(bored(), { size: [300, 200], frame: a }), a))
  assert.ok(sameData(render(bored(), { size: [300, 200], frame: { scale: a.frame!.scale, mid_x: a.frame!.midX, mid_y: a.frame!.midY } }), a))
  assert.ok(sameData(render(bored(), { size: [300, 200], frame: [a.frame!.scale, a.frame!.midX, a.frame!.midY] }), a))
  // the frame does not change when the model does (that is the point of it)
  const bigger = render(bored().fuse(Box(10, 10, 10).translate(40, 0, 0)), { size: [300, 200], frame: a.frame })
  assert.deepEqual(bigger.frame, a.frame)
  assert.throws(() => render(bored(), { frame: render(bored(), { sheet: true, size: [100, 100] }) }), /no frame/)
})

test('supersampling and bad options', () => {
  const one = render(bored(), { size: [120, 90], supersample: 1 })
  const two = render(bored(), { size: [120, 90] })
  assert.deepEqual([one.width, one.height, one.pixels.length], [120, 90, 120 * 90 * 3])
  assert.deepEqual([two.width, two.height, two.pixels.length], [120, 90, 120 * 90 * 3])
  assert.ok(!Buffer.from(one.pixels).equals(Buffer.from(two.pixels)))
  const bad = [
    { supersample: 5 },
    { colors: 'rainbow' },
    { view: 'diagonal' },
    { zoom: 0 },
    { xrayAlpha: 1.5 },
    { sheet: ['top', 'front', 'iso'] },
    { drawing: 'fourth-angle' },
    { size: [0, 10] },
  ]
  for (const options of bad) assert.throws(() => render(bored(), options), RangeError, JSON.stringify(options))
  assert.throws(() => render(bored(), { highlight: 5 }), TypeError)
  assert.throws(() => render({ size: [10, 10] }), /nothing to render/)
})

// -- colors -------------------------------------------------------------------------------------
test('distinct colors tell bodies apart', () => {
  const twins = Box(10, 10, 10).colored('#888888').fuse(Box(10, 10, 10).translate(20, 0, 0)) // one part, two solids
  const native = Px.of(render(twins, { view: 'front', size: [200, 100], edges: false }))
  const distinct = Px.of(render(twins, { view: 'front', size: [200, 100], edges: false, colors: 'distinct' }))
  const row = 50
  let [left, right] = [native.at(50, row), native.at(150, row)]
  assert.ok(Math.max(...left.map((v, c) => Math.abs(v - right[c]))) <= 2 && ptp(left) <= 2) // the part's gray, on both solids
  ;[left, right] = [distinct.at(50, row), distinct.at(150, row)]
  assert.ok(Math.max(...left.map((v, c) => Math.abs(v - right[c]))) > 30) // one palette color per solid
})

// -- sheets -------------------------------------------------------------------------------------
test('sheets of four and of two views', () => {
  const p = Box(80, 30, 20)
  const pic = render(p, { sheet: true, size: [800, 600] })
  const q = quadrants(pic)
  for (const name of ['TL', 'TR', 'BL', 'BR'] as const) assert.ok(q[name].crop(30, null).count(drawn) > 500) // a body in every panel
  const xs = (v: Px) => v.crop(30, null).where(drawn).map(([x]) => x)
  // top (top left) and front (bottom left) share one scale: the same width
  assert.ok(Math.abs(ptp(xs(q.TL)) - ptp(xs(q.BL))) <= 2)
  const two = Px.of(render(p, { sheet: [{ azimuth: 30, elevation: 30 }, { azimuth: -30, elevation: 30 }], size: [600, 300] }))
  const halves = [two.crop(30, null, 2, 298), two.crop(30, null, 302, 598)]
  assert.ok(halves.every((h) => h.count(drawn) > 500))
  assert.ok(!halves[0].equals(halves[1]))
  assert.ok(sameData(render(p, { sheet: true, size: [800, 600] }), pic))
  const lined = render(p, { sheet: true, lines: true, size: [800, 600] })
  assert.ok(Px.of(lined).every(gray))
})

// -- sections -----------------------------------------------------------------------------------
const PALETTE0 = [0x7c / 255, 0x93 / 255, 0xb5 / 255]
const PALETTE1 = [0xd9 / 255, 0x92 / 255, 0x5a / 255]
const times = (s: number, v: number[]) => v.map((x) => s * x)

test('section caps are hatched, and alternate between bodies', () => {
  const a = Box(20, 20, 20).translate(-12, 0, 0)
  const b = Box(20, 20, 20).translate(12, 0, 0)
  const pic = Px.of(render(a, b, { view: 'front', section: Plane.XZ, size: [400, 200], supersample: 1 }))
  let hatch = pic.where(exact(times(0.27, PALETTE0))) // the hatch of the first body
  assert.ok(hatch.length > 100 && hatch.every(([x, y]) => (x + y) % 7 === 0))
  hatch = pic.where(exact(times(0.27, PALETTE1))) // the second body hatches the other way
  assert.ok(hatch.length > 100 && hatch.every(([x, y]) => (x - y) % 7 === 0))
  assert.ok(pic.count(exact(PALETTE0.map((c) => 0.55 * 0.9 * c + 0.45))) > 1000) // the light fill between
})

test('sections keep bores open and the framing', () => {
  const p = Box(40, 20, 30).cut(Cylinder(6, 40))
  const whole = render(p, { view: 'front', size: [400, 300], supersample: 1 })
  const cut = render(p, { view: 'front', size: [400, 300], supersample: 1, section: Plane.XZ })
  assert.deepEqual(cut.frame, whole.frame) // the framing of the whole model
  const [right, up] = [[1, 0, 0], [0, 0, 1]]
  const fill = exact(PALETTE0.map((c) => 0.55 * 0.9 * c + 0.45))
  const ink = exact(times(0.27, PALETTE0))
  let [x, y] = pixelOf(cut, right, up, [13, 0, 0])
  assert.ok(Px.of(cut).crop(y - 3, y + 4, x - 3, x + 4).every((q) => fill(q) || ink(q))) // the cap
  ;[x, y] = pixelOf(cut, right, up, [0, 0, 0])
  const bore = Px.of(cut).crop(y - 3, y + 4, x - 3, x + 4)
  assert.ok(!bore.where((q) => fill(q) || ink(q)).length) // the bore stays open: its far wall shows
  assert.ok(bore.every((q) => q.some((c) => c !== 255)))
  // without a cap, the inside of the back wall shows, darker than the front wall
  const openCut = render(p, { view: 'front', size: [400, 300], supersample: 1, section: Plane.XZ, cap: false })
  ;[x, y] = pixelOf(openCut, right, up, [13, 0, 0])
  const inside = Px.of(openCut).at(x, y)
  const front = Px.of(whole).at(x, y)
  assert.ok(inside.every((v, c) => Math.abs(v - 0.72 * front[c]) <= 2))
  assert.ok(!Px.of(openCut).where(ink).length)
  // in line style the cap is hatched in gray on white
  const lined = render(p, { view: 'front', size: [400, 300], supersample: 1, section: Plane.XZ, lines: true })
  const hatch = Px.of(lined).where(exact([70 / 255, 70 / 255, 70 / 255]))
  assert.ok(hatch.length > 100 && hatch.every(([hx, hy]) => (hx + hy) % 7 === 0))
})

test('a section takes a face, an [origin, normal] pair and an object', () => {
  const byPlane = render(bored(), { section: Plane.XZ, size: [200, 150] })
  assert.ok(sameData(render(bored(), { section: [[0, 0, 0], [0, -1, 0]], size: [200, 150] }), byPlane))
  assert.ok(sameData(render(bored(), { section: { origin: [0, 0, 0], normal: [0, -1, 0] }, size: [200, 150] }), byPlane))
  const face = bored().faces().front()[0] // the face at y = -20, normal -Y: cuts nothing away
  assert.ok(!sameData(render(bored(), { section: face, size: [200, 150] }), byPlane))
  assert.ok(sameData(render(bored(), { section: { origin: [0, 0, 0], normal: [0, -1, 0], cap: false }, size: [200, 150] }), render(bored(), { section: Plane.XZ, cap: false, size: [200, 150] })))
  assert.throws(() => render(bored(), { section: { origin: [0, 0, 0] } }), RangeError)
  assert.throws(() => render(bored(), { section: [[0, 0, 0], [0, 0, 0]] }), /no length/)
  assert.throws(() => render(bored(), { section: 'XZ' }), TypeError)
})

// -- highlights and markers ---------------------------------------------------------------------
test('highlighted faces, edges and points', () => {
  const plate = Box(40, 30, 10)
  const plain = Px.of(render(plate, { size: [300, 200] }))
  assert.ok(!plain.count(orange) && !plain.count(red))
  const top = render(plate, { size: [300, 200], highlight: plate.faces().top() })
  assert.ok(Px.of(top).count(orange) > 3000)
  const hidden = render(plate, { size: [300, 200], highlight: plate.faces().bottom() })
  assert.ok(!Px.of(hidden).count(orange)) // the bottom face is not in sight
  // the closest face to a point
  assert.ok(sameData(render(plate, { size: [300, 200], highlightAt: [[1, 2, 5.5]] }), top))
  assert.ok(sameData(render(plate, { size: [300, 200], highlightAt: [1, 2, 5.5] }), top))
  const edges = Px.of(render(plate, { size: [300, 200], highlight: plate.faces().top().edges() }))
  assert.ok(edges.count(red) > 200 && !edges.count(orange))
  const corner = Px.of(render(plate, { size: [300, 200], highlight: plate.vertices().sortBy(Z).last }))
  assert.ok(corner.count(red) > 10)
  const whole = Px.of(render(plate, { size: [300, 200], highlight: plate }))
  assert.ok(whole.count(orange) > Px.of(top).count(orange))
  const inDrawing = Px.of(render(plate, { size: [400, 300], lines: true, highlight: plate.faces().top() }))
  assert.ok(inDrawing.count(orange) > 1000) // line style fills highlighted faces
})

test('markers', () => {
  const plain = Px.of(render(bored(), { size: [300, 200] }))
  const one = Px.of(render(bored(), { size: [300, 200], markers: [[0, 0, 15]] }))
  const labelled = render(bored(), { size: [300, 200], markers: [[[0, 0, 15], 'bore']] })
  assert.ok(!plain.count(red))
  assert.ok(one.count(red) > 25)
  assert.ok(Px.of(labelled).count(red) > one.count(red) + 20)
  assert.ok(sameData(render(bored(), { size: [300, 200], markers: [{ position: [0, 0, 15], label: 'bore' }] }), labelled))
  const green = Px.of(render(bored(), { size: [300, 200], markers: [{ position: [0, 0, 15], color: 'green' }] }))
  assert.ok(!green.count(red) && green.count(([r, g]) => g > 100 && r < 60) > 25)
})

// -- annotate -----------------------------------------------------------------------------------
test('annotate writes the extents and orients the axes', () => {
  const p = Box(60, 54, 34)
  const pic = render(p, { size: [800, 600], annotate: true })
  const label = exact([..._LABEL])
  const region = Px.of(pic).crop(500, null, 520, null) // bottom right, clear of the scale bar
  const found = region.where(label)
  const [fx, fy] = [Math.min(...found.map(([x]) => x)), Math.min(...found.map(([, y]) => y))]
  const expected = { data: new Float64Array(40 * 300 * 3), width: 300, height: 40 }
  _text(expected, 0, 0, '60 X 54 X 34', [1, 1, 1], 2)
  const mask: [number, number][] = []
  for (let y = 0; y < 40; y++) for (let x = 0; x < 300; x++) if (expected.data[(y * 300 + x) * 3] > 0) mask.push([x, y])
  assert.ok(mask.length > 50)
  assert.deepEqual(
    found.map(([x, y]) => `${x - fx},${y - fy}`).sort(),
    mask.map(([x, y]) => `${x},${y}`).sort(),
  )
  // the axes: all three in the iso view; Y points into the screen in the front view
  const near = (rgb: number[]) => (q: RGB) => Math.max(...q.map((v, c) => Math.abs(v - rgb[c]))) < 30
  const corner = Px.of(pic).crop(450, null, 0, 150)
  for (const rgb of [[200, 40, 40], [40, 150, 40], [40, 70, 200]]) assert.ok(corner.count(near(rgb)) > 10)
  const front = Px.of(render(p, { view: 'front', size: [800, 600], annotate: true })).crop(450, null, 0, 150)
  assert.equal(front.count(near([40, 150, 40])), 0)
  assert.ok(front.count(near([200, 40, 40])) > 10)
})

// -- x-ray --------------------------------------------------------------------------------------
test('x-ray shows what is hidden', () => {
  const front = Box(30, 10, 30).translate(0, -10, 0).colored('red')
  const behind = Box(10, 10, 10).translate(0, 10, 0).colored('blue')
  const opaque = Px.of(render(front, behind, { view: 'front', size: [200, 200] }))
  const xray = Px.of(render(front, behind, { view: 'front', size: [200, 200], xray: true }))
  assert.ok(opaque.at(100, 100)[2] < 30) // the blue box is hidden
  assert.ok(xray.at(100, 100)[2] > opaque.at(100, 100)[2] + 40) // and shines through in x-ray
  assert.ok(xray.at(100, 100)[0] > 100) // the red one is still there
  // the edges of the hidden box are drawn, opaque
  const dark = xray
    .crop(100, 101)
    .where((q) => Math.max(...q) < 90)
    .map(([x]) => x)
  assert.ok(dark.some((x) => x > 70 && x < 130))
  assert.ok(sameData(render(front, behind, { view: 'front', size: [200, 200], xray: true }), render(front, behind, { view: 'front', size: [200, 200], xray: true })))
})

// -- sketches over solids -----------------------------------------------------------------------
test('a sketch over a part is drawn on its plane', () => {
  const plate = Box(40, 30, 10)
  const sketch = Circle(8).on(plate.faces().top())
  const blue = ([r, g, b]: RGB) => b > 170 && r < 70 && g > 50 && g < 140
  assert.ok(!Px.of(render(plate, { size: [300, 200] })).count(blue))
  const over = Px.of(render(plate, sketch, { size: [300, 200] }))
  assert.ok(over.count(blue) > 60)
  // top view: the circle is a circle of radius 8 around the middle
  const top = render(plate, sketch, { view: 'top', size: [300, 200] })
  const r = Px.of(top)
    .where(blue)
    .map(([x, y]) => Math.hypot(x - 150, y - 100) / top.frame!.scale)
    .sort((a, b) => a - b)
  const median = r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2
  assert.ok(Math.abs(median - 8) <= 0.5)
})

// -- comparing pictures -------------------------------------------------------------------------
test('diffImages with a pinned frame', () => {
  const beforePart = Box(40, 30, 10)
  const afterPart = beforePart.cut(Cylinder(3, 20).translate(12, 0, 0))
  const before = render(beforePart, { size: [300, 200] })
  const after = render(afterPart, { size: [300, 200], frame: before.frame })
  const same = diffImages(before, render(beforePart, { size: [300, 200] }))
  assert.ok(same instanceof ImageDiff && same.changed === 0 && same.bbox === null && same.fraction === 0)
  const d = diffImages(before, after)
  assert.ok(d.changed > 50 && d.fraction < 0.05)
  const [hx, hy] = pixelOf(before, [0.7071067811865476, 0.7071067811865476, 0], [-0.4082482904638631, 0.4082482904638631, 0.8164965809277261], [12, 0, 5])
  const [x0, y0, x1, y1] = d.bbox!
  assert.ok(x0 <= hx && hx <= x1 && y0 <= hy && hy <= y1 && x1 - x0 < 60)
  assert.equal(Px.of(d.picture).count(red), d.changed)
  // any form: pictures, PNG data, files, pixels
  const dir = mkdtempSync(join(tmpdir(), 'smlibjs-render-'))
  try {
    const file = join(dir, 'before.png')
    before.save(file)
    assert.ok(Buffer.from(readFileSync(file)).equals(Buffer.from(before.data)))
    render(beforePart, { size: [300, 200], path: join(dir, 'again.png') })
    assert.ok(Buffer.from(readFileSync(join(dir, 'again.png'))).equals(Buffer.from(before.data)))
    assert.equal(diffImages(file, after.data).changed, d.changed)
    assert.equal(diffImages(file, { width: after.width, height: after.height, data: after.pixels }).changed, d.changed)
    d.save(join(dir, 'diff.png'))
    assert.ok(statSync(join(dir, 'diff.png')).size > 100)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  // pixels with an alpha channel (a canvas's ImageData) and as floats
  const rgba = new Uint8ClampedArray(after.width * after.height * 4)
  const floats = new Float64Array(after.pixels.length)
  for (let p = 0; p < after.width * after.height; p++) {
    for (let c = 0; c < 3; c++) {
      rgba[p * 4 + c] = after.pixels[p * 3 + c]
      floats[p * 3 + c] = after.pixels[p * 3 + c] / 255
    }
    rgba[p * 4 + 3] = 255
  }
  assert.equal(diffImages(before, { width: after.width, height: after.height, data: rgba }).changed, d.changed)
  assert.equal(diffImages(before, { width: after.width, height: after.height, data: floats }).changed, d.changed)
  assert.equal(diffImages(before, after, 255).changed, 0)
  assert.throws(() => diffImages(before, render(beforePart, { size: [200, 200] })), /size/)
})

/** A PNG of RGB pixels whose rows use the filters 0 to 4 in turn. */
function filteredPng(img: Uint8Array, w: number, h: number, compress: (raw: Uint8Array) => Uint8Array): Uint8Array {
  const stride = w * 3
  const raw: number[] = []
  let prev: Uint8Array = new Uint8Array(stride)
  for (let r = 0; r < h; r++) {
    const line = img.subarray(r * stride, (r + 1) * stride)
    const f = r % 5
    raw.push(f)
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0
      const b = prev[i]
      const c = i >= 3 ? prev[i - 3] : 0
      const p = a + b - c
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      const pred = [0, a, b, (a + b) >> 1, paeth][f]
      raw.push((line[i] - pred + 256) % 256)
    }
    prev = line
  }
  const crc = (bytes: Uint8Array) => {
    let c = ~0 >>> 0
    for (const byte of bytes) {
      c ^= byte
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (tag: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(tag, 4, 'latin1')
    out.set(data, 8)
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', compress(Uint8Array.from(raw))), chunk('IEND', new Uint8Array(0))])
}

/** Deterministic bytes. */
function noise(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n)
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    out[i] = s >>> 24
  }
  return out
}

test('the PNG reader handles every filter', () => {
  const img = noise(5 * 4 * 3)
  const png = filteredPng(img, 4, 5, (raw) => new Uint8Array(deflateSync(raw)))
  const decoded = _pngDecode(png)
  assert.deepEqual([decoded.width, decoded.height], [4, 5])
  assert.deepEqual(decoded.pixels, img)
  assert.throws(() => _pngDecode(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9)), /not a PNG/)
})

test('PNG files are written and read without Node too', () => {
  // outside Node there is no zlib: stored blocks are written, and a small inflater reads them and
  // compressed ones
  const proc = process as unknown as { getBuiltinModule: unknown }
  const builtin = proc.getBuiltinModule
  const pic = render(bored(), { size: [240, 180] })
  const img = noise(37 * 23 * 3, 7)
  const smooth = Uint8Array.from({ length: 300 * 200 * 3 }, (_, i) => (i % 3 === 0 ? (i >> 6) & 0xff : 128))
  proc.getBuiltinModule = undefined
  try {
    const stored = render(bored(), { size: [240, 180] })
    assert.ok(Buffer.from(stored.pixels).equals(Buffer.from(pic.pixels)))
    assert.ok(stored.data.length > pic.data.length) // uncompressed
    assert.ok(Buffer.from(_pngDecode(stored.data).pixels).equals(Buffer.from(pic.pixels)))
    assert.ok(Buffer.from(new Picture(pic.data).pixels).equals(Buffer.from(pic.pixels))) // zlib's compression
    for (const level of [1, 9]) {
      const png = filteredPng(img, 37, 23, (raw) => new Uint8Array(deflateSync(raw, { level })))
      assert.deepEqual(_pngDecode(png).pixels, img)
      const flat = filteredPng(smooth, 300, 200, (raw) => new Uint8Array(deflateSync(raw, { level })))
      assert.deepEqual(_pngDecode(flat).pixels, smooth)
    }
    assert.throws(() => stored.save('x.png'), /needs Node/)
  } finally {
    proc.getBuiltinModule = builtin
  }
  // and Node's zlib reads the stored blocks
  proc.getBuiltinModule = undefined
  const stored = render(bored(), { size: [64, 48] })
  proc.getBuiltinModule = builtin
  assert.ok(Buffer.from(new Picture(stored.data).pixels).equals(Buffer.from(stored.pixels)))
})

// -- text ---------------------------------------------------------------------------------------
test('the font covers the labels', () => {
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;-+=/()[]<>_\'"!?#%*&@|°Ø×±') {
    const glyph = _FONT.get(ch)
    assert.ok(glyph !== undefined && glyph.length === 7 && glyph.every((row) => row.length === 5), ch)
  }
  const a = { data: new Float64Array(10 * 80 * 3), width: 80, height: 10 }
  const b = { data: new Float64Array(10 * 80 * 3), width: 80, height: 10 }
  _text(a, 0, 0, 'Iso view', [1, 1, 1])
  _text(b, 0, 0, 'ISO VIEW', [1, 1, 1])
  assert.deepEqual(a.data, b.data)
  assert.ok(a.data.some((v) => v > 0))
})

test('everything together is deterministic', () => {
  const go = () =>
    render(bored(), {
      drawing: 'third-angle',
      section: Plane.XZ,
      xray: true,
      annotate: true,
      highlight: bored().faces().top(),
      markers: [[[0, 0, 15], 'top']],
      size: [500, 400],
    })
  assert.ok(sameData(go(), go()))
})

// -- surface quality: zebra stripes and curvature maps -------------------------------------------
// A cylinder on a plate, its base rounded with a circular fillet (G1) and with a G2 blend.
let _bosses: [Part, Part] | null = null
function bosses(): [Part, Part] {
  if (_bosses === null) {
    const C = Align.CENTER
    const boss = Box(60, 60, 10, { align: [C, C, Align.MAX] }).fuse(Cylinder(10, 30, { align: [C, C, Align.MIN] }))
    _bosses = [boss.fillet(boss.edges().concave(), 6), boss.fillet(boss.edges().concave(), 6, { continuity: 'G2' })]
  }
  return _bosses
}

/** Sub-pixel x positions where a row of a zebra picture changes between black and white. */
function stripeEdges(row: RGB[]): number[] {
  const g = row.map(([r, gg, b]) => (r + gg + b) / 3 - 127.5)
  const out: number[] = []
  for (let i = 0; i + 1 < g.length; i++) if (Math.sign(g[i]) * Math.sign(g[i + 1]) < 0) out.push(i + 0.5 + g[i] / (g[i] - g[i + 1]))
  return out
}

/** The slope of the least-squares line through the points (numpy's polyfit of degree 1). */
function slope(xs: number[], ys: number[]): number {
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length
  const my = ys.reduce((s, y) => s + y, 0) / ys.length
  let num = 0
  let den = 0
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my)
    den += (x - mx) ** 2
  })
  return num / den
}

/** Follow stripe edges from the cylinder down across its joint with the fillet; for each, the
 * slope (dx/dy) just above and just below the joint. */
function stripeSlopes(p: Part): [number, number][] {
  const zb = p.faces().filter((f) => f.geomType === 'cylinder')[0].bbox().min.z // the joint
  const view = { azimuth: 0, elevation: 20 }
  const pic = render(p, { size: [800, 800], zebra: { stripes: 24 }, view, zoom: 2.2, lookAt: [0, -10, zb], edges: false })
  const cam = _Camera.of(view)
  const f = pic.frame!
  const px = Px.of(pic)
  const rowOf = (y: number) => Array.from({ length: pic.width }, (_, x) => px.at(x, y))
  const follow = (rows: number[], x: number): [number, number][] | null => {
    const found: [number, number][] = []
    for (const y of rows) {
      const e = stripeEdges(rowOf(y))
      if (!e.length) return null
      const j = e.reduce((best, v, i) => (Math.abs(v - x) < Math.abs(e[best] - x) ? i : best), 0)
      if (Math.abs(e[j] - x) > 3) return null // the stripe broke off
      x = e[j]
      found.push([y, x])
    }
    return found
  }
  const range = (a: number, b: number, step = 1) => Array.from({ length: Math.ceil((b - a) / step) }, (_, i) => a + i * step)
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const slopes: [number, number][] = []
  for (const xWorld of [-3.0, -2.0, 2.0, 3.0]) {
    const point = [xWorld, -Math.sqrt(100 - xWorld ** 2), zb]
    const xb = pic.width / 2 + (dot(point, cam.right) - f.midX) * f.scale
    const yb = Math.trunc(pic.height / 2 - (dot(point, cam.up) - f.midY) * f.scale)
    const start = stripeEdges(rowOf(yb - 4))
    const nearest = start.reduce((best, v) => (Math.abs(v - xb) < Math.abs(best - xb) ? v : best), start[0])
    const above = follow(range(yb - 4, yb - 16, -1), nearest)!
    const across = follow(range(yb - 4, yb + 4), above[0][1])
    assert.ok(across !== null) // the stripes run on across the joint
    const below = follow(range(yb + 3, yb + 10), across[across.length - 1][1])!
    slopes.push([slope(above.map(([y]) => y), above.map(([, x]) => x)), slope(below.map(([y]) => y), below.map(([, x]) => x))])
  }
  return slopes
}

test('zebra stripes kink at a circular fillet and run smooth across a G2 blend', () => {
  const [g1, g2] = [stripeSlopes(bosses()[0]), stripeSlopes(bosses()[1])]
  assert.ok(Math.max(...g1.map(([a]) => Math.abs(a))) < 0.05 && Math.max(...g2.map(([a]) => Math.abs(a))) < 0.05) // straight down the cylinder
  const kinkG1 = g1.map(([a, b]) => Math.abs(b - a))
  const kinkG2 = g2.map(([a, b]) => Math.abs(b - a))
  assert.ok(Math.min(...kinkG1) > 0.3) // the circular fillet: the stripes turn at once
  assert.ok(kinkG1.every((v, i) => v > 3 * kinkG2[i])) // the G2 blend: they start to turn smoothly
})

test('zebra options', () => {
  const p = bosses()[0]
  const plain = render(p, { size: [300, 200], zebra: true })
  const same = render(p, { size: [300, 200], zebra: { stripes: 16, width: 0.5, direction: 'vertical' } })
  assert.ok(sameData(plain, same))
  assert.ok(Px.of(plain).every(gray)) // black and white (and gray)
  const can = Cylinder(10, 20) // seen from the front: the stripes turn with the normal around the axis
  const count: number[] = []
  for (const n of [8, 16]) {
    const pic = render(can, { view: 'front', size: [400, 200], zebra: { stripes: n } })
    const [x0, y] = pixelOf(pic, [1, 0, 0], [0, 0, 1], [-7, 0, 0])
    const [x1] = pixelOf(pic, [1, 0, 0], [0, 0, 1], [7, 0, 0])
    count.push(stripeEdges(Array.from({ length: x1 - x0 }, (_, i) => Px.of(pic).at(x0 + i, y))).length) // the middle, where they do not crowd
  }
  assert.ok(count[0] >= 6 && Math.abs(count[1] - 2 * count[0]) <= 2)
  const darkCount = (pic: Picture) => Px.of(pic).count(([r, g, b]) => (r + g + b) / 3 < 128)
  assert.ok(darkCount(render(p, { size: [300, 200], zebra: { width: 0.8 } })) > darkCount(plain))
  for (const direction of ['horizontal', [0, 0, 1]]) assert.ok(!sameData(render(p, { size: [300, 200], zebra: { direction } }), plain))
  for (const bad of [{ stripes: 0 }, { width: 1.5 }, { direction: 'diagonal' }, { colour: 1 }, { direction: [0, 0, 0] }]) {
    assert.throws(() => render(p, { size: [100, 100], zebra: bad }), RangeError, JSON.stringify(bad))
  }
})

test('curvature of a sphere and a cylinder', () => {
  const at = (face: { _f: number }) => {
    const [[u0, v0], [u1, v1]] = k.face_uv_domain(face._f)
    const grid = [0.1, 0.3, 0.5, 0.7, 0.9] // inside the face, away from the poles of a sphere
    const uv: number[] = []
    for (const gv of grid) for (const gu of grid) uv.push(u0 + (u1 - u0) * gu, v0 + (v1 - v0) * gv)
    return ext.face_curvatures(face._f, uv) as { k1: Float64Array; k2: Float64Array }
  }
  const all = (v: Float64Array, want: number, rel: number, abs = 1e-12) => v.length > 0 && v.every((x) => approx(x, want, rel, abs))
  const sphere = at(Sphere(10).faces()[0])
  assert.ok(all(sphere.k1, 0.1, 1e-6) && all(sphere.k2, 0.1, 1e-6))
  const side = at(Cylinder(10, 30).faces().cylinders()[0])
  assert.ok(all(side.k1, 0.1, 0, 1e-9) && all(side.k2, 0, 0, 1e-9))
  const bore = at(Box(40, 40, 20).cut(Cylinder(5, 30)).faces().cylinders()[0])
  assert.ok(all(bore.k1, 0, 0, 1e-9) && all(bore.k2, -0.2, 0, 1e-9))
  // at every corner of the rendered mesh, from the exact surface
  const ball = new _Scene([Sphere(10)], null, 'native', true).bodies[0]
  assert.ok(all(ball.curvature('mean'), 0.1, 1e-3))
  assert.ok(all(ball.curvature('gaussian'), 0.01, 1e-3))
  const can = new _Scene([Cylinder(10, 30)], null, 'native', true)
  const [k1, k2] = [can.bodies[0].curvature('max'), can.bodies[0].curvature('min')]
  assert.ok(k1.every((v) => [0.0, 0.1].includes(Math.round(v * 1e9) / 1e9)) && k2.every((v) => Math.abs(v) < 1e-9))
  const [lo, hi] = can.curvatureRange('max', null)
  assert.ok(approx(lo, 0) && approx(hi, 0.1))
  assert.deepEqual(_curvatureSpec({ kind: 'max', range: 0.5 }), ['max', [-0.5, 0.5]])
  assert.deepEqual(can.curvatureRange('max', [0.02, 0.5]), [0.0, 0.5]) // a range always holds zero
  for (const bad of ['sharpness', { kind: 'mean', range: [1, 0] }, 3]) {
    assert.throws(() => render(Sphere(1), { size: [50, 50], curvature: bad }), RangeError, JSON.stringify(bad))
  }
})

test('curvature maps: colors and legend', () => {
  const ball = Px.of(render(Sphere(10), { size: [400, 300], curvature: 'mean' }))
  const lit = ball.crop(100, 200, 120, 240)
  assert.ok(lit.count(([r, g, b]) => r - g > 60 && r - b > 60) / (lit.width * lit.height) > 0.95) // convex: red
  // the legend at the right edge: from white (0) at the bottom to red (0.1) at the top
  assert.ok(ball.at(380, 45)[0] > 150 && ball.at(380, 45)[1] < 60)
  assert.ok(Math.max(...ball.at(380, 160).map((v) => Math.abs(v - 236))) < 20)
  assert.deepEqual(
    [0.1, -0.25, 0.0, 1.2e-5].map(_valueText),
    ['0.1', '-0.25', '0', '1.2e-5'],
  )
  // a bore is concave: blue, and nothing red on the flat plate around it
  const holed = Px.of(render(Box(40, 40, 10).cut(Cylinder(12, 20)), { size: [400, 300], curvature: 'min' })).crop(null, null, null, 340)
  const blue = holed.count(([r, , b]) => b > r + 60)
  const reds = holed.count(([r, , b]) => r > b + 60)
  assert.ok(blue > 500 && reds === 0)
})

test('the curvature map shows the ramp of a G2 blend', () => {
  const box = Box(40, 40, 20)
  const g1 = box.fillet(box.edges().parallelTo(Z), 8)
  const g2 = box.fillet(box.edges().parallelTo(Z), 8, { continuity: 'G2' })
  // how red the fillet is across, independent of the shading: 0 white, 1 full red
  const redness = (p: Part) => {
    const pic = render(p, { view: 'front', size: [400, 300], curvature: 'max', edges: false })
    const [x0, y] = pixelOf(pic, [1, 0, 0], [0, 0, 1], [13, 0, 0])
    const [x1] = pixelOf(pic, [1, 0, 0], [0, 0, 1], [19.5, 0, 0])
    return Array.from({ length: x1 - x0 }, (_, i) => {
      const [r, g] = Px.of(pic).at(x0 + i, y)
      return (r - g) / r
    })
  }
  const [circular, blend] = [redness(g1), redness(g2)]
  assert.ok(Math.min(...circular) > 0.9 && ptp(circular) < 0.05) // constant curvature 1/8: one color
  assert.ok(Math.min(...blend) < 0.3 && Math.max(...blend) > 0.9) // from flat at the plane to the most curved inside
})

test('zebra and curvature in sheets, with highlights and markers', () => {
  const p = bosses()[1]
  const side = p.faces().cylinders() // highlighted faces keep their stripes, in orange and black
  const options = { sheet: true, zebra: true, highlight: side, markers: [[[0, 0, 30], 'top']], size: [600, 450] }
  const zebra = render(p, options)
  assert.ok(Px.of(zebra).count(orange) > 200 && Px.of(zebra).count(red) > 20)
  assert.ok(sameData(zebra, render(p, options)))
  const curv = render(p, { sheet: true, curvature: 'min', size: [600, 450] })
  const blue = (q: Px) => q.count(([r, , b]) => b > r + 60)
  const q = quadrants(curv)
  assert.ok((['TL', 'TR', 'BL', 'BR'] as const).every((name) => blue(q[name].crop(30, null)) > 50)) // the concave blend in every panel
  const legends = (['TL', 'TR', 'BL', 'BR'] as const).map((name) => blue(q[name].crop(20, 200, -40, null)))
  assert.ok(legends[3] > 50)
  assert.deepEqual(legends.slice(0, 3), [0, 0, 0]) // one legend, in the last panel
  const drawing = render(p, { drawing: true, zebra: true, size: [600, 450] })
  assert.ok(quadrants(drawing).TL.every(gray)) // line-style views stay line style
})

// -- the viewer ---------------------------------------------------------------------------------
test('the viewer page holds the model and the camera', () => {
  const page = htmlPage(bored(), { title: 'A <b> & "c" $&', view: [2, -1, 0.5], margin: 1.3 })
  assert.ok(page.startsWith('<!doctype html>'))
  assert.ok(page.includes('<title>A &lt;b&gt; &amp; &quot;c&quot; $&amp;</title>'))
  assert.ok(page.includes('const VIEW = [2.0, 0.5, 1.0];') && page.includes('const MARGIN = 1.3;'))
  assert.ok(page.includes('three@0.170.0') && !/__[A-Z]+__/.test(page))
  const glb = Buffer.from(/base64,([A-Za-z0-9+/=]+)"/.exec(page)![1], 'base64')
  assert.equal(glb.subarray(0, 4).toString('latin1'), 'glTF')
  assert.equal(glb.readUInt32LE(8), glb.length)
  const doc = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'))
  assert.equal(doc.nodes.at(-1).name, 'z-up') // the model stands Z up in the page
  assert.ok(doc.meshes.length >= 1)
})

test('show writes the page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smlibjs-viewer-'))
  try {
    const path = join(dir, 'model.html')
    assert.equal(show(bored(), { path, openBrowser: false, title: 'bored' }), path)
    assert.ok(readFileSync(path, 'utf8').includes('<title>bored</title>'))
    const temp = show(Box(1, 2, 3), { openBrowser: false })
    try {
      assert.match(temp, /smlibjs-[a-z0-9]+\.html$/)
      assert.ok(readFileSync(temp, 'utf8').includes('GLTFLoader'))
    } finally {
      rmSync(temp, { force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
