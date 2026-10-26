// Text and DXF: exact outlines from fonts, drawings in and out (tests/test_text_dxf.py).
import { type TestContext, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelingError, ext, setWarningHandler } from '../src/kernel.ts'
import { DEFAULT_FONT, Font, FontError, _kernTable, loadFont } from '../src/font.ts'
import { Text, _segmentArea, _sum } from '../src/text.ts'
import { exportDxf, fromDxf, fromDxfWires, importDxf, importDxfWires, toDxf } from '../src/dxf.ts'
import { Align } from '../src/align.ts'
import { Plane, Y, Z } from '../src/geometry.ts'
import { CenterArc, Line, Polyline, Spline } from '../src/curves.ts'
import { Box, Cylinder } from '../src/parts.ts'
import { Circle, Ellipse, Rectangle, RoundedRectangle, makeFace } from '../src/sketches.ts'
import { load } from '../src/exporters.ts'
import { type Edge, Sketch } from '../src/shapes.ts'

const DATA = join(import.meta.dirname, '..', '..', 'tests', 'data')
const QUAD = join(DATA, 'test-quadratic.ttf')
const CUBIC = join(DATA, 'test-cubic.otf')

/** The sketch's area (the integration is exact for the polynomial outlines of a font). */
function exactArea(sketch: Sketch): number {
  return sketch.area
}

function holes(sketch: Sketch): number[] {
  return sketch
    .faces()
    .map((f) => f.innerWires().length)
    .sort((a, b) => a - b)
}

// pytest's approx: within rel * |expected| or abs (1e-12 unless given; rel 1e-6 unless given)
function close(actual: number, expected: number, options: { rel?: number; abs?: number } = {}): boolean {
  if (actual === expected) return true
  const absTol = options.abs ?? 1e-12
  if (options.rel === undefined && options.abs !== undefined) return Math.abs(actual - expected) <= absTol
  return Math.abs(actual - expected) <= Math.max((options.rel ?? 1e-6) * Math.abs(expected), absTol)
}

function approx(actual: number | readonly number[], expected: number | readonly number[], options: { rel?: number; abs?: number } = {}): void {
  const a = typeof actual === 'number' ? [actual] : actual
  const e = typeof expected === 'number' ? [expected] : expected
  assert.equal(a.length, e.length, `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
  a.forEach((x, i) => assert.ok(close(x, e[i], options), `${JSON.stringify(actual)} != approx ${JSON.stringify(expected)}`))
}

/** A fresh directory for the files of a test (pytest's tmp_path), removed after it. */
function tmp(ctx: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-text-dxf-'))
  ctx.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// =============================================================================
// The font reader
// =============================================================================
test('the bundled font: metrics and kerning', () => {
  const f = loadFont()
  // the built-in font is smlibpy's Lato Regular, with its license
  assert.deepEqual(DEFAULT_FONT, new Uint8Array(readFileSync(join(import.meta.dirname, '..', '..', 'src', 'smlibpy', 'fonts', 'Lato-Regular.ttf'))))
  assert.equal(loadFont(DEFAULT_FONT), f)
  assert.equal(readFileSync(join(import.meta.dirname, '..', 'fonts', 'OFL.txt'), 'utf8').split('SIL OPEN FONT LICENSE Version 1.1').length - 1, 1)
  assert.equal(f.name, 'Lato Regular')
  assert.equal(f.unitsPerEm, 2000)
  assert.equal(f.numGlyphs, 277)
  assert.equal(f.capHeight, 1433) // OS/2 sCapHeight
  const g = (c: string) => f.glyphIndex(c) as number
  assert.deepEqual([...'AVH '].map((c) => f.advance(g(c))), [1360, 1360, 1512, 386])
  assert.equal(f.kerningSource, 'GPOS')
  assert.equal(f.kerning(g('A'), g('V')).advance1, -136)
  assert.equal(f.kerning(g('T'), g('o')).advance1, -210)
  assert.equal(f.kerning(g('A'), g('B')).advance1, 0)
  assert.equal(f.glyphIndex('ж'), null)
  assert.equal(loadFont(), f) // read once
})

test("the bundled font's kern table matches its GPOS kerning", () => {
  const f = loadFont()
  const pairs = _kernTable(f._tables.get('kern') as Uint8Array)
  assert.equal(pairs.size, 4643)
  for (const [key, v] of pairs) assert.equal(f.kerning(Math.floor(key / 0x10000), key % 0x10000).advance1, v)
})

test('the reader against an independent reader', { skip: 'needs fontTools, which only Python has (checked against smlibpy instead)' }, () => {})

test('containers and kerning sources', () => {
  const woff = new Font(join(DATA, 'test-quadratic.woff'))
  const ttc = new Font(join(DATA, 'test-fonts.ttc')) // the first font of the collection
  const ttf = new Font(QUAD)
  for (const f of [woff, ttc]) {
    assert.equal(f.name, ttf.name)
    assert.deepEqual(f.outline(f.glyphIndex('O') as number), ttf.outline(ttf.glyphIndex('O') as number))
  }
  const g = (c: string) => ttf.glyphIndex(c) as number
  assert.equal(ttf.kerningSource, 'kern')
  assert.equal(ttf.kerning(g('H'), g('O')).advance1, -50)
  const cff = new Font(CUBIC)
  assert.equal(cff.kerningSource, 'GPOS')
  assert.equal(cff.kerning(cff.glyphIndex('H') as number, cff.glyphIndex('O') as number).advance1, -30)
})

test('fonts as bytes: the same font as from its file, read once (smlibwasm)', () => {
  const bytes = new Uint8Array(readFileSync(QUAD))
  const f = loadFont(bytes)
  assert.equal(loadFont(bytes), f)
  assert.equal(f.path, null)
  const fromFile = loadFont(QUAD)
  assert.equal(fromFile.path?.endsWith('test-quadratic.ttf'), true)
  assert.equal(loadFont(QUAD), fromFile)
  assert.equal(f.name, fromFile.name)
  assert.deepEqual(f.outline(f.glyphIndex('R') as number), fromFile.outline(fromFile.glyphIndex('R') as number))
  approx(Text('HO', 700, { font: bytes, align: null }).bbox().max.x, 700 - 50 + 650)
  assert.throws(() => new Font(new Uint8Array(20)), (e) => e instanceof FontError && /font data: not a TrueType or OpenType font/.test(e.message))
  assert.throws(
    () => Text('A', 5, { font: new Uint8Array(8) }),
    (e) => e instanceof FontError && e instanceof RangeError && e.message === 'Text: font data: not a font file',
  )
})

// =============================================================================
// Text: outlines, holes, fill rules
// =============================================================================
for (const [char, faces, holeCounts] of [
  ['H', 1, [0]],
  ['o', 1, [1]],
  ['B', 1, [2]],
  ['8', 1, [2]],
  ['i', 2, [0, 0]],
  ['%', 3, [0, 1, 1]],
  ['®', 2, [1, 1]],
  ['Ä', 3, [0, 0, 1]],
  ['@', 1, [1]],
] as const) {
  test(`glyph pieces and holes: ${char}`, () => {
    const t = Text(char, 10)
    assert.equal(t.faces().length, faces)
    assert.deepEqual(holes(t), holeCounts)
  })
}

for (const char of 'HOoB8i%®Ä@&gÆ€') {
  test(`the glyph's area is the font's: ${char}`, () => {
    // the sketch is the font's outline: its area equals the exact area of the contours
    const f = loadFont()
    const gid = f.glyphIndex(char) as number
    const signed = _sum(f.outline(gid).flatMap((c) => c.map(_segmentArea)))
    const t = Text(char, 10)
    approx(exactArea(t), Math.abs(signed) * (10 / f.capHeight) ** 2, { rel: 1e-9 })
  })
}

test('smooth runs are single B-splines', () => {
  const o = Text('O', 10)
  assert.deepEqual(o.edges().map((e) => e.geomType), ['bspline', 'bspline'])
  const part = o.extrude(1)
  assert.equal(part.faces().length, 4)
  assert.ok(part.isValid())
  const h = Text('H', 10)
  assert.equal(h.edges().length, 12)
  assert.deepEqual(new Set(h.edges().map((e) => e.geomType)), new Set(['line']))
})

test('fill rules of the test fonts', () => {
  // Glyphs built for the nonzero rule: overlapping contours unite, a contour inside another
  // turning the same way is no hole, an island in a hole is a piece of its own, composites are
  // scaled, mirrored and placed by point matching.
  const t = (ch: string, font = QUAD) => Text(ch, 700, { font, align: null }) // cap height 700: one font unit is one mm
  approx(exactArea(t('H')), 420000, { rel: 1e-12 })
  approx(exactArea(t('O')), 420000 - 200000, { rel: 1e-12 })
  assert.deepEqual(holes(t('O')), [1])
  const x = t('X') // two rectangles overlapping by 200
  assert.equal(x.faces().length, 1)
  approx(exactArea(x), 600 * 700, { rel: 1e-12 })
  const n = t('N') // nested, same turning sense
  assert.deepEqual(holes(n), [0])
  approx(exactArea(n), 420000, { rel: 1e-12 })
  const r = t('R')
  assert.deepEqual(holes(r), [0, 1])
  approx(exactArea(r), 420000 - 200000 + 60000, { rel: 1e-12 })
  const c = t('C') // O at half size, twice
  assert.deepEqual(holes(c), [1, 1])
  approx(exactArea(c), (2 * 220000) / 4, { rel: 1e-12 })
  const d = t('D') // H mirrored
  approx(exactArea(d), 420000, { rel: 1e-12 })
  approx(d.bbox().min.x, 50)
  const p = t('P') // the second H placed against the first one's corner: they share an edge
  assert.equal(p.faces().length, 1)
  approx(exactArea(p), 840000, { rel: 1e-12 })
  approx(p.bbox().max.x, 1250)
})

test('a quadratic contour of off-curve points', () => {
  // Eight off-curve points: the outline runs through their midpoints, as one B-spline.
  const off = [[350, 650], [562, 562], [650, 350], [562, 138], [350, 50], [138, 138], [50, 350], [138, 562]]
  const next = (list: number[][], i: number) => list[(i + 1) % list.length]
  const mid = off.map((a, i) => [(a[0] + next(off, i)[0]) / 2, (a[1] + next(off, i)[1]) / 2])
  // polygon of the on-curve points plus 2/3 of each triangle between it and the curve
  const poly = 0.5 * Math.abs(_sum(mid.map((a, i) => a[0] * next(mid, i)[1] - next(mid, i)[0] * a[1])))
  const bulge = _sum(
    mid.map((p, i) => {
      const q = next(off, i)
      const r = next(mid, i)
      return ((Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2) * 2) / 3
    }),
  )
  const q = Text('Q', 700, { font: QUAD, align: null })
  assert.deepEqual(q.edges().map((e) => e.geomType), ['bspline'])
  approx(exactArea(q), poly + bulge, { rel: 1e-10 })
})

test('cubic outlines', () => {
  const k = 0.5522847498307936 // 165.7 and 82.8 for the radii 300 and 150: 166 and 83 in the font
  const circleArea = (r: number) => {
    // four cubic arcs about the center; the font holds the handles rounded
    const h = Math.round(k * r)
    return 4 * _segmentArea([[r, 0], [r, h], [h, r], [0, r]])
  }
  const o = Text('O', 700, { font: CUBIC, align: null })
  assert.deepEqual(holes(o), [1])
  assert.equal(o.edges().length, 2)
  approx(exactArea(o), circleArea(300) - circleArea(150), { rel: 1e-10 })
  // three cubics meeting smoothly at uneven ratios: one closed B-spline edge, the same area
  const s = Text('S', 700, { font: CUBIC, align: null })
  const [j0, a0, b1, j1, a1, b2, j2, a2, b0] = [[600, 300], [600, 480], [380, 640], [200, 600], [-160, 520], [60, 400], [150, 100], [180, 0], [600, 30]] as [number, number][]
  const expected = _sum([[j0, a0, b1, j1], [j1, a1, b2, j2], [j2, a2, b0, j0]].map(_segmentArea))
  assert.equal(s.edges().length, 1)
  assert.ok(s.edges()[0].isClosed)
  approx(exactArea(s), expected, { rel: 1e-10 })
  const u = Text('U', 700, { font: CUBIC, align: null }) // drawn through a local subroutine
  approx(u.bbox().min.toArray(), [50, 0, 0])
  approx(u.bbox().max.toArray(), [650, 700, 0])
})

// =============================================================================
// Text: size, layout, alignment
// =============================================================================
test('the size is the cap height', () => {
  for (const size of [2.5, 7.0, 100.0]) {
    const b = Text('H', size).bbox()
    approx(b.size.y, size, { rel: 1e-12 })
    approx(b.min.y, -size / 2)
    approx(b.max.y, size / 2)
  }
  assert.ok(Text('O', 10).bbox().size.y > 10) // round letters overshoot
  approx(Text('H', 700, { font: QUAD, align: null }).bbox().max.y, 700)
})

test('advances, kerning and spacing', () => {
  const f = loadFont()
  const s = 10 / f.capHeight
  const kerned = Text('AV', 10, { align: Align.MIN }).bbox()
  const plain = Text('AV', 10, { align: Align.MIN, kerning: false }).bbox()
  approx(plain.max.x - kerned.max.x, 136 * s, { rel: 1e-12 })
  const spaced = Text('AV', 10, { align: Align.MIN, kerning: false, spacing: 1.5 }).bbox()
  approx(spaced.max.x - plain.max.x, 1.5, { rel: 1e-12 })
  // in the test font: H O is kerned by -50 units; at size 700 a unit is a millimeter
  const ho = Text('HO', 700, { font: QUAD, align: null }).bbox()
  approx(ho.max.x, 700 - 50 + 650)
  approx(Text('HO', 700, { font: QUAD, align: null, kerning: false }).bbox().max.x, 700 + 650)
  approx(Text('H O', 700, { font: QUAD, align: null }).bbox().max.x, 700 + 300 + 650)
})

test('alignment of lines and blocks', () => {
  const size = 700 // with the test font: H spans x 50..650 of an advance of 700
  let b = Text('H', size, { align: Align.MIN, font: QUAD }).bbox()
  approx([b.min.x, b.min.y, b.max.y], [50, 0, 700])
  b = Text('H', size, { align: Align.MAX, font: QUAD }).bbox()
  approx([b.max.x, b.max.y], [-50, 0])
  b = Text('H', size, { font: QUAD }).bbox()
  approx([b.min.x, b.max.x, b.min.y, b.max.y], [-300, 300, -350, 350])
  const block = Text('HH\nH', size, { align: [Align.MIN, Align.MIN], lineSpacing: 1.5, font: QUAD })
  b = block.bbox() // the last line stands on y = 0, the first one 1.5 sizes above it
  approx([b.min.y, b.max.y], [0, 1.5 * 700 + 700])
  const centered = Text('HH\nH', size, { lineSpacing: 1.5, font: QUAD })
  const second = centered.faces().filter((f) => f.center().y < 0)
  assert.equal(second.length, 1)
  approx(second[0].center().x, 0, { abs: 1e-9 })
  const right = Text('HH\nH', size, { align: Align.MAX, font: QUAD })
  approx(Math.max(...right.faces().map((f) => f.bbox().max.x)), -50)
})

test('text along a path', () => {
  const arc = CenterArc([0, 0], 30, 180, -180) // over the top, clockwise: letters stand outside
  const on = Text('SMLIB', 4, { path: arc })
  approx(exactArea(on), exactArea(Text('SMLIB', 4)), { rel: 1e-9 }) // glyphs are placed, not bent
  const h = Text('H', 4, { path: arc, align: [Align.CENTER, Align.CENTER] }).bbox()
  const straight = Text('H', 4).bbox() // the middle of the advance goes to the middle of the arc
  approx([h.min.y, h.max.y], [28, 32]) // centered on the top of the arc, upright
  approx([h.min.x, h.max.x], [straight.min.x, straight.max.x])
  const below = Text('H', 4, { path: CenterArc([0, 0], 30, 180, 180), align: [Align.CENTER, Align.MIN] }).bbox()
  approx([below.min.y, below.max.y], [-30, -26]) // counterclockwise: letters inside
  assert.throws(() => Text('A LONG TEXT ON A SHORT ARC', 10, { path: arc }), (e) => e instanceof RangeError && /path only/.test(e.message))
  assert.throws(() => Text('A', 4, { path: Line([0, 0, 0], [10, 0, 5]) }), (e) => e instanceof RangeError && /XY plane/.test(e.message))
  assert.throws(() => Text('A\nB', 4, { path: arc }), (e) => e instanceof RangeError && /one line/.test(e.message))
})

test('overlapping letters unite', () => {
  const a = Text('A', 10)
  const tight = Text('AA', 10, { spacing: -6 })
  assert.equal(tight.faces().length, 1)
  assert.ok(tight.area < 2 * a.area - 1)
  assert.ok(tight.extrude(1).isValid())
})

test('text errors', () => {
  const valueError = (pattern: RegExp) => (e: unknown) => e instanceof RangeError && pattern.test(e.message)
  assert.throws(() => Text('ж', 5), valueError(/U\+0436/))
  assert.throws(() => Text('A', 0), valueError(/positive/))
  assert.throws(() => Text('   ', 5), valueError(/nothing to draw/))
  assert.throws(() => Text('A\tB', 5), valueError(/control characters/))
  assert.throws(() => Text('A', 5, { font: '/no/such/font.ttf' }), { code: 'ENOENT' })
  assert.throws(() => Text('A', 5, { font: import.meta.filename }), valueError(/not a TrueType or OpenType font/))
})

test('emboss and engrave', () => {
  const plate = Box(70, 24, 5)
  const label = Text('SMLIB 42', 8)
  const top = plate.faces().top()
  const embossed = plate.fuse(label.on(top).extrude(0.8))
  const engraved = plate.cut(label.on(top).extrude(-0.5))
  assert.ok(embossed.isValid() && engraved.isValid())
  approx(embossed.volume, plate.volume + 0.8 * label.area, { rel: 1e-6 })
  approx(engraved.volume, plate.volume - 0.5 * label.area, { rel: 1e-6 })
  approx(embossed.bbox().max.z, 2.5 + 0.8)
  const side = plate.faces().facing(Y.neg()).one() // on a vertical face: the text stands upright
  const sign = plate.cut(Text('A1', 3).on(side).extrude(-0.3))
  assert.ok(sign.isValid() && sign.volume < plate.volume)
})

// =============================================================================
// DXF: reading
// =============================================================================
function dxfText(entities: string, header = '', blocks = ''): string {
  let text = ''
  if (header) text += `0\nSECTION\n2\nHEADER\n${header}0\nENDSEC\n`
  if (blocks) text += `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n`
  text += `0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`
  return text
}

function dxf(dir: string, entities: string, options: { header?: string; blocks?: string; name?: string } = {}): string {
  const path = join(dir, options.name ?? 'drawing.dxf')
  writeFileSync(path, dxfText(entities, options.header, options.blocks))
  return path
}

function lw(points: readonly (readonly number[])[], closed = true, layer = '0'): string {
  let s = `0\nLWPOLYLINE\n8\n${layer}\n90\n${points.length}\n70\n${closed ? 1 : 0}\n`
  for (const p of points) s += `10\n${p[0]}\n20\n${p[1]}\n` + (p.length > 2 ? `42\n${p[2]}\n` : '')
  return s
}

function line(a: readonly number[], b: readonly number[], layer = '0'): string {
  return `0\nLINE\n8\n${layer}\n10\n${a[0]}\n20\n${a[1]}\n30\n0\n11\n${b[0]}\n21\n${b[1]}\n31\n0\n`
}

function circle(c: readonly number[], r: number, layer = '0'): string {
  return `0\nCIRCLE\n8\n${layer}\n10\n${c[0]}\n20\n${c[1]}\n30\n0\n40\n${r}\n`
}

test('DXF: polylines with bulges', (ctx) => {
  const dir = tmp(ctx)
  const slot = importDxf(dxf(dir, lw([[-15, -5], [15, -5, 1], [15, 5], [-15, 5, 1]])))
  assert.deepEqual(slot.edges().map((e) => e.geomType), ['line', 'circle', 'line', 'circle'])
  approx(slot.edges().filter((e) => e.geomType === 'circle').map((e) => e.radius), [5, 5], { rel: 1e-14 })
  approx(exactArea(slot), 300 + Math.PI * 25, { rel: 1e-9 })
  const clockwise = importDxf(dxf(dir, lw([[-15, 5], [15, 5, -1], [15, -5], [-15, -5, -1]])))
  approx(exactArea(clockwise), 300 + Math.PI * 25, { rel: 1e-9 })
  // a bulge above 1: three quarters of a circle of radius 10 / (2 sin 135) under the chord
  const big = importDxf(dxf(dir, lw([[0, 0, Math.tan((270 * (Math.PI / 180)) / 4)], [10, 0]])))
  const r = 10 / (2 * Math.sin(135 * (Math.PI / 180)))
  approx(exactArea(big), r * r * ((3 * Math.PI) / 4) + (r * r) / 2, { rel: 1e-9 })
  approx(big.bbox().max.y, 0, { abs: 1e-9 })
  approx(big.bbox().min.y, -5 - r)
  // the old POLYLINE with VERTEX entities, in inches
  let ents = '0\nPOLYLINE\n8\n0\n66\n1\n70\n1\n10\n0\n20\n0\n30\n0\n'
  for (const [x, y, b] of [[0, 0, 0], [2, 0, 0], [2, 1, 1], [0, 1, 0]]) ents += `0\nVERTEX\n8\n0\n10\n${x}\n20\n${y}\n30\n0\n42\n${b}\n`
  ents += '0\nSEQEND\n'
  const old = importDxf(dxf(dir, ents, { header: '9\n$INSUNITS\n70\n1\n' }))
  approx(exactArea(old), (2 + Math.PI / 2) * 25.4 ** 2, { rel: 1e-9 })
  approx(old.bbox().max.toArray(), [50.8, 50.8, 0])
})

test('DXF: arcs, ellipses, splines', (ctx) => {
  const dir = tmp(ctx)
  // an ARC drawn with the extrusion (0, 0, -1), as mirrored arcs are: center (5, 0) is (-5, 0)
  const half = importDxf(dxf(dir, line([-10, 0], [0, 0]) + '0\nARC\n8\n0\n10\n5\n20\n0\n30\n0\n40\n5\n50\n0\n51\n180\n210\n0\n220\n0\n230\n-1\n'))
  approx(half.bbox().min.toArray(), [-10, 0, 0])
  approx(half.bbox().max.y, 5)
  approx(exactArea(half), (Math.PI * 25) / 2, { rel: 1e-9 })
  const ellipse = importDxf(
    dxf(dir, '0\nELLIPSE\n8\n0\n10\n0\n20\n0\n30\n0\n11\n10\n21\n0\n31\n0\n40\n0.5\n41\n0\n42\n3.141592653589793\n' + line([-10, 0], [10, 0])),
  )
  assert.deepEqual(new Set(ellipse.edges().map((e) => e.geomType)), new Set(['ellipse', 'line']))
  approx(exactArea(ellipse), (Math.PI * 10 * 5) / 2, { rel: 1e-9 })
  // a rational quadratic SPLINE: a full circle of radius 10
  const w = Math.sqrt(0.5)
  const poles = [[10, 0], [10, 10], [0, 10], [-10, 10], [-10, 0], [-10, -10], [0, -10], [10, -10], [10, 0]]
  const knots = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]
  const spline =
    `0\nSPLINE\n8\n0\n70\n13\n71\n2\n72\n${knots.length}\n73\n${poles.length}\n74\n0\n` +
    knots.map((k) => `40\n${k}\n`).join('') +
    [1, w, 1, w, 1, w, 1, w, 1].map((x) => `41\n${x}\n`).join('') +
    poles.map(([a, b]) => `10\n${a}\n20\n${b}\n30\n0\n`).join('')
  approx(exactArea(importDxf(dxf(dir, spline))), Math.PI * 100, { rel: 1e-9 })
})

/** A point of the uniform cubic B-spline with control points P (closed, period P.length). */
function cyclicPoint(P: readonly (readonly number[])[], u: number): [number, number] {
  const n = P.length
  const i = ((Math.floor(u) % n) + n) % n
  const t = u - Math.floor(u)
  const b = [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6]
  const p: [number, number] = [0, 0]
  for (let j = 0; j < 4; j++) {
    p[0] += b[j] * P[(i + j) % n][0]
    p[1] += b[j] * P[(i + j) % n][1]
  }
  return p
}

test('DXF: a periodic spline is clamped exactly', (ctx) => {
  const dir = tmp(ctx)
  const P = [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3).map((a) => [10 * Math.cos(a), 6 * Math.sin(a)])
  const poles = [...P, ...P.slice(0, 3)] // the wrapped form of a periodic spline
  const knots = Array.from({ length: poles.length + 4 }, (_, i) => i)
  const ents =
    `0\nSPLINE\n8\n0\n70\n11\n71\n3\n72\n${knots.length}\n73\n${poles.length}\n74\n0\n` +
    knots.map((k) => `40\n${k}\n`).join('') +
    poles.map(([a, b]) => `10\n${a}\n20\n${b}\n30\n0\n`).join('')
  const s = importDxf(dxf(dir, ents))
  const edges = s.edges()
  assert.equal(edges.length, 1)
  assert.ok(edges[0].isClosed)
  for (let i = 0; i <= 12; i++) {
    const p = cyclicPoint(P, i / 2)
    assert.ok(edges[0].distanceTo([p[0], p[1], 0]) < 1e-12)
  }
})

test('DXF: units', (ctx) => {
  const dir = tmp(ctx)
  for (const [code, mm] of [[1, 25.4], [2, 304.8], [4, 1.0], [5, 10.0], [6, 1000.0], [13, 0.001], [0, 1.0]]) {
    const s = importDxf(dxf(dir, circle([0, 0], 1), { header: `9\n$INSUNITS\n70\n${code}\n` }))
    approx(s.bbox().size.x, 2 * mm, { rel: 1e-12 })
  }
  approx(importDxf(dxf(dir, circle([0, 0], 1))).bbox().size.x, 2) // no header: mm
  approx(importDxf(dxf(dir, circle([0, 0], 1)), { unit: 'inch' }).bbox().size.x, 50.8)
  assert.throws(() => importDxf(dxf(dir, circle([0, 0], 1)), { unit: 'MM' as never }), (e) => e instanceof RangeError && /unknown unit/.test(e.message))
})

test('DXF: blocks', (ctx) => {
  const dir = tmp(ctx)
  const blocks =
    '0\nBLOCK\n8\n0\n2\nSQ\n70\n0\n10\n5\n20\n5\n30\n0\n' +
    lw([[0, 0], [10, 0], [10, 10], [0, 10]]) +
    '0\nENDBLK\n' +
    '0\nBLOCK\n8\n0\n2\nHOLE\n70\n0\n10\n0\n20\n0\n30\n0\n' +
    circle([0, 0], 1) +
    '0\nENDBLK\n' +
    '0\nBLOCK\n8\n0\n2\nNEST\n70\n0\n10\n0\n20\n0\n30\n0\n' +
    '0\nINSERT\n8\n0\n2\nHOLE\n10\n0\n20\n0\n30\n0\n41\n2\n42\n2\n0\nENDBLK\n'
  const ents =
    '0\nINSERT\n8\nPARTS\n2\nSQ\n10\n100\n20\n0\n30\n0\n41\n2\n42\n2\n50\n45\n' + // 20 x 20, turned
    '0\nINSERT\n8\nPARTS\n2\nNEST\n10\n100\n20\n0\n30\n0\n' + // a hole of radius 2 in it
    '0\nINSERT\n8\nPARTS\n2\nSQ\n10\n0\n20\n0\n30\n0\n41\n-1\n42\n1\n' + // mirrored
    '0\nINSERT\n8\nGRID\n2\nHOLE\n10\n200\n20\n0\n30\n0\n70\n2\n71\n2\n44\n10\n45\n20\n' // 2 x 2 array
  const path = dxf(dir, ents, { blocks })
  const s = importDxf(path)
  assert.equal(s.faces().length, 6)
  assert.deepEqual(holes(s), [0, 0, 0, 0, 0, 1])
  approx(exactArea(s), 400 - 4 * Math.PI + 100 + 4 * Math.PI, { rel: 1e-9 })
  const turned = s.faces().filter((f) => f.innerWires().length === 1)[0]
  approx(turned.bbox().size.x, 20 * Math.sqrt(2))
  const grid = importDxf(path, { layers: ['grid'] }) // block contents on layer 0 take the insert's layer
  const centers = grid
    .edges()
    .map((e) => e.arcCenter)
    .map((c) => [Math.round(c.x), Math.round(c.y)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  assert.deepEqual(centers, [[200, 0], [200, 20], [210, 0], [210, 20]])
  approx(importDxf(path, { layers: 'PARTS' }).area, 500 - 4 * Math.PI, { rel: 1e-6 })
})

test('DXF: degenerate entities are skipped', (ctx) => {
  const dir = tmp(ctx)
  const ents = circle([0, 0], 5) + circle([20, 0], 0) + line([30, 0], [30, 0]) + '0\nARC\n8\n0\n10\n0\n20\n0\n30\n0\n40\n0\n50\n0\n51\n90\n'
  const s = importDxf(dxf(dir, ents))
  assert.equal(s.faces().length, 1)
  approx(s.area, Math.PI * 25, { rel: 1e-6 })
})

test('DXF: nested loops and islands', (ctx) => {
  const dir = tmp(ctx)
  const ents = lw([[-20, -20], [20, -20], [20, 20], [-20, 20]]) + circle([0, 0], 15) + lw([[-5, -5], [5, -5], [5, 5], [-5, 5]])
  const s = importDxf(dxf(dir, ents))
  assert.deepEqual(holes(s), [0, 1])
  approx(exactArea(s), 1600 - Math.PI * 225 + 100, { rel: 1e-9 })
  // loops that cross: the even-odd rule makes their overlap a hole
  const lens = importDxf(dxf(dir, circle([-5, 0], 10) + circle([5, 0], 10)))
  const [d, r] = [10, 10]
  const overlap = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d)
  approx(exactArea(lens), 2 * Math.PI * 100 - 2 * overlap, { rel: 1e-6 })
})

test('DXF: open and branching outlines', (ctx) => {
  const dir = tmp(ctx)
  const gap = line([0, 0], [10, 0], 'CUT') + line([10, 0], [10, 10], 'CUT') + line([10, 10], [0.02, 10], 'CUT') + line([0, 10], [0, 0], 'CUT')
  const path = dxf(dir, gap)
  let msg = ''
  assert.throws(
    () => importDxf(path),
    (e) => {
      msg = (e as Error).message
      return e instanceof ModelingError
    },
  )
  for (const part of ['does not close', "layer 'CUT'", '0.02 mm away', 'importDxfWires']) assert.ok(msg.includes(part), msg)
  // the two ends meet halfway: the left side leans by 0.01 and the square loses 0.05
  approx(importDxf(path, { tolerance: 0.05 }).area, 99.95, { rel: 1e-6 })
  const wires = importDxfWires(path)
  assert.equal(wires.length, 1)
  assert.ok(!wires[0].isClosed)
  assert.equal(wires[0].edges().length, 4)
  const branch = lw([[0, 0], [10, 0], [10, 10], [0, 10]]) + line([10, 10], [20, 20])
  assert.throws(() => importDxf(dxf(dir, branch)), (e) => e instanceof ModelingError && /branches/.test(e.message))
  const branched = importDxfWires(dxf(dir, branch))
  assert.equal(branched.length, 2)
  assert.deepEqual(branched.map((w) => w.edges().length).sort((a, b) => a - b), [1, 4])
})

test('DXF: layers and skipped entities', (ctx) => {
  const dir = tmp(ctx)
  const ents = circle([0, 0], 5, 'CUT') + circle([20, 0], 2, 'ENGRAVE') + '0\nTEXT\n8\n0\n10\n0\n20\n0\n30\n0\n40\n2\n1\nNOTE\n'
  const path = dxf(dir, ents)
  const caught: string[] = []
  setWarningHandler((message) => caught.push(message))
  try {
    const both = importDxf(path)
    assert.equal(both.faces().length, 2)
    assert.ok(caught.some((m) => m.includes('1 TEXT')), String(caught))
    approx(importDxf(path, { layers: ['cut'] }).bbox().size.x, 10)
    assert.throws(() => importDxf(path, { layers: ['NOPE'] }), (e) => e instanceof RangeError && /no layer 'NOPE'.*CUT, ENGRAVE/.test(e.message))
    assert.throws(() => importDxf(dxf(dir, '0\nTEXT\n8\n0\n10\n0\n20\n0\n30\n0\n40\n2\n1\nNOTE\n')), (e) => e instanceof ModelingError && /no curves/.test(e.message))
  } finally {
    setWarningHandler((message) => console.warn(message))
  }
})

// =============================================================================
// DXF: writing and round trips
// =============================================================================
function entityCounts(path: string): Record<string, number> {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  let section: string | null = null
  const counts: Record<string, number> = {}
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim()
    const value = lines[i + 1]
    if (code === '2' && section === 'SECTION') section = value
    if (code === '0') {
      if (value === 'SECTION') section = 'SECTION'
      else if (section === 'ENTITIES' && value !== 'ENDSEC') counts[value] = (counts[value] ?? 0) + 1
    }
  }
  return counts
}

function header(path: string, name: string): string {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  return lines[lines.indexOf(name) + 2]
}

test('DXF: the round trip is exact', (ctx) => {
  const dir = tmp(ctx)
  const splineHole = makeFace(Spline([-25, -10], [-15, -5], [-10, -15], { closed: true }))
  const plate = RoundedRectangle(60, 40, 5).cut(Circle(6)).cut(Ellipse(8, 4).translate(18, 0)).cut(splineHole)
  const path = join(dir, 'plate.dxf')
  exportDxf(plate.named('plate'), path)
  assert.deepEqual(entityCounts(path), { LINE: 4, ARC: 4, CIRCLE: 1, ELLIPSE: 1, SPLINE: 1 })
  const back = importDxf(path)
  assert.deepEqual(holes(back), [3])
  approx(exactArea(back), exactArea(plate), { rel: 1e-10 })
  const radii = (s: Sketch) =>
    s
      .edges()
      .filter((e) => e.geomType === 'circle')
      .map((e) => e.radius)
      .sort((a, b) => a - b)
  assert.deepEqual(radii(back), radii(plate))
  assert.deepEqual(radii(plate), [5, 5, 5, 5, 6])
  const original = plate.edges().filter((e) => e.geomType === 'bspline')[0]
  const again = back.edges().filter((e) => e.geomType === 'bspline')[0]
  const a = ext.curve_data(original._curve())
  const b = ext.curve_data(again._curve())
  // exact to the last bits on one machine; across platforms the kernel's arithmetic differs in them
  approx((a.poles as number[][]).flat(), (b.poles as number[][]).flat(), { abs: 1e-12 })
  approx(a.knots, b.knots, { abs: 1e-12 })
})

test('DXF: sections are written with arcs and circles', (ctx) => {
  const dir = tmp(ctx)
  let part = Box(40, 30, 20).cut(Cylinder(8, 30)).cut(Cylinder(3, 30).translate(14, 8, 0))
  part = part.fillet(part.edges().parallelTo(Z).filterBy((e: Edge) => Math.abs(e.center().x) > 19), 4)
  const cut = part.section(Plane.XY)
  assert.deepEqual(new Set(cut.edges().map((e) => e.geomType)), new Set(['bspline'])) // the kernel's sections are B-splines
  const path = join(dir, 'section.dxf')
  exportDxf(cut, path)
  assert.deepEqual(entityCounts(path), { LINE: 4, ARC: 4, CIRCLE: 2 })
  const back = load(path)
  assert.ok(back instanceof Sketch)
  assert.deepEqual(holes(back), [2])
  approx(exactArea(back), exactArea(cut), { rel: 1e-10 })
  const radii = back
    .edges()
    .filter((e) => e.geomType === 'circle')
    .map((e) => Math.round(e.radius * 1e12) / 1e12)
    .sort((x, y) => x - y)
  assert.deepEqual(radii, [3, 4, 4, 4, 4, 8])
  const side = part.section(Plane.XZ) // drawn in the XZ plane's coordinates: x stays x, z becomes y
  exportDxf(side, join(dir, 'side.dxf'))
  const b = importDxf(join(dir, 'side.dxf')).bbox()
  approx(b.min.toArray(), [-20, -10, 0])
  approx(b.max.toArray(), [20, 10, 0])
})

test('DXF: units and planes on export', (ctx) => {
  const dir = tmp(ctx)
  const file = (name: string) => join(dir, name)
  const plate = Rectangle(50.8, 25.4)
  exportDxf(plate, file('inch.dxf'), { unit: 'inch' })
  assert.equal(header(file('inch.dxf'), '$INSUNITS'), '1')
  approx(importDxf(file('inch.dxf'), { unit: 'mm' }).bbox().size.x, 2.0) // 2 inches in the file
  approx(importDxf(file('inch.dxf')).bbox().size.x, 50.8) // read back in mm
  assert.equal(header(file('inch.dxf'), '$MEASUREMENT'), '0')
  exportDxf(plate, file('mm.dxf'))
  assert.equal(header(file('mm.dxf'), '$INSUNITS'), '4')
  const lifted = Plane.XY.offset(7).mul(Circle(3).translate(10, 0)) // parallel to XY: X and Y kept
  exportDxf(lifted, file('lifted.dxf'))
  approx(importDxf(file('lifted.dxf')).bbox().center.toArray(), [10, 0, 0])
  const standing = Rectangle(10, 4).on(Plane.XZ)
  exportDxf(standing, file('front.dxf'), { plane: Plane.XZ })
  approx(importDxf(file('front.dxf')).bbox().size.toArray(), [10, 4, 0])
  assert.throws(() => exportDxf(standing, file('bad.dxf'), { plane: Plane.XY }), (e) => e instanceof RangeError && /not parallel/.test(e.message))
  assert.throws(() => exportDxf(Box(1, 1, 1), file('part.dxf')), (e) => e instanceof TypeError && /section/.test(e.message))
  const wire = Polyline([0, 0], [10, 0], [10, 5])
  exportDxf([wire, Line([0, 0], [0, 3])], file('curves.dxf'))
  assert.deepEqual(entityCounts(file('curves.dxf')), { LINE: 3 })
  const text = Text('Text 8', 5).named('engrave')
  text.export(file('text.dxf'))
  assert.ok(readFileSync(file('text.dxf'), 'utf8').includes('\nengrave\n'))
  exportDxf(Circle(1).named('Bügel/2'), file('ascii.dxf'))
  const bytes = readFileSync(file('ascii.dxf'))
  assert.ok(bytes.every((b) => b < 0x80))
  assert.ok(bytes.toString('ascii').includes('\nB_gel_2\n'))
  approx(exactArea(importDxf(file('text.dxf'))), exactArea(text), { rel: 1e-10 })
})

test('DXF: read by an independent reader', { skip: 'needs ezdxf, which only Python has' }, () => {})

test('DXF: written by an independent writer', { skip: 'needs ezdxf, which only Python has' }, () => {})

test('DXF in memory: toDxf, fromDxf and fromDxfWires as the file functions (smlibwasm)', (ctx) => {
  const dir = tmp(ctx)
  const plate = RoundedRectangle(60, 40, 5).cut(Circle(6)).named('plate')
  const text = toDxf(plate)
  const path = join(dir, 'plate.dxf')
  exportDxf(plate, path)
  assert.equal(readFileSync(path, 'utf8'), text)
  for (const data of [text, new TextEncoder().encode(text)]) {
    const s = fromDxf(data)
    assert.deepEqual(holes(s), [1])
    approx(s.area, importDxf(path).area, { rel: 1e-12 })
  }
  const drawing = dxfText(lw([[0, 0], [10, 0], [10, 10], [0, 10]]) + line([10, 10], [20, 20]))
  assert.throws(() => fromDxf(drawing), (e) => e instanceof ModelingError && /fromDxfWires\(\)/.test(e.message))
  assert.deepEqual(fromDxfWires(drawing).map((w) => w.edges().length).sort((a, b) => a - b), [1, 4])
  // code page 1252 and binary files
  const latin = new Uint8Array([...new TextEncoder().encode(circle([0, 0], 1, 'Läyer'))].flatMap((b, i, all) => (b === 0xc3 && all[i + 1] === 0xa4 ? [0xe4] : b === 0xa4 && all[i - 1] === 0xc3 ? [] : [b])))
  setWarningHandler(() => {})
  try {
    approx(fromDxf(latin, { layers: 'LÄYER' }).area, Math.PI, { rel: 1e-6 })
  } finally {
    setWarningHandler((message) => console.warn(message))
  }
  assert.throws(() => fromDxf(new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\0')), /fromDxf: a binary DXF; save the drawing as ASCII DXF/)
  assert.throws(() => fromDxf('0\nSECTION\n2\nENTITIES\nx\nLINE\n'), /not a DXF file \(line 5: 'x' is not a group code\)/)
})

// =============================================================================
// MCP
// =============================================================================
test('the MCP session embosses text and saves DXF', { skip: "the MCP server is smlibpy's (Python)" }, () => {})

test('fit point tangents keep all their coordinates', () => {
  // The y and z of a fit-point spline's end tangents (codes 22/32 and 23/33) were never read: a
  // vertical start tangent became zero and failed, (1, 1) became (1, 0).
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-dxf-'))
  try {
    const fit = [
      [0, 0],
      [10, 5],
      [20, 0],
    ]
    const spline =
      '0\nSPLINE\n8\n0\n70\n8\n71\n3\n72\n0\n73\n0\n74\n3\n12\n0\n22\n1\n32\n0\n13\n1\n23\n1\n33\n0\n' + fit.map(([a, b]) => `11\n${a}\n21\n${b}\n31\n0\n`).join('')
    const wires = importDxfWires(dxf(dir, spline))
    assert.equal(wires.length, 1)
    const edge = wires[0].edges().one()
    assert.ok(edge.tangentAt(0).isClose([0, 1, 0]), String(edge.tangentAt(0)))
    assert.ok(edge.tangentAt(1).isClose([Math.SQRT1_2, Math.SQRT1_2, 0]), String(edge.tangentAt(1)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a byte order mark is no part of the drawing', () => {
  // A UTF-8 DXF that starts with a byte order mark was "not a DXF file".
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-dxf-'))
  try {
    const path = dxf(dir, lw([[0, 0], [10, 0], [10, 5], [0, 5]]))
    writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(path)]))
    assert.ok(Math.abs(importDxf(path).area - 50) < 1e-9)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
