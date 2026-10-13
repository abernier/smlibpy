// Reading TrueType and OpenType fonts: characters, metrics, kerning and exact glyph outlines.
//
// A compact reader without dependencies. It reads sfnt files (TTF, OTF), font collections (TTC,
// the first font) and WOFF files, and from them the tables a text layout needs:
//
// - cmap (formats 0, 4, 6, 12 and 13), head, hhea, hmtx, maxp, OS/2, name;
// - outlines: glyf/loca (simple and composite glyphs, every transform form, point matching) and
//   "CFF " (Type 2 charstrings with local and global subroutines, flex, hint masks, CID-keyed
//   fonts);
// - kerning: GPOS pair adjustment (formats 1 and 2, extension lookups) and the kern table
//   (format 0, Microsoft and Apple headers).
//
// smlibpy hands what this reader does not do to fontTools when it is installed: WOFF2 files,
// variable CFF2 outlines and CFF accents built with seac. JavaScript has no fontTools, so those
// fonts throw a FontError here. Compressed WOFF tables are inflated with node:zlib as Python's
// zlib does; outside Node (a browser) there is no synchronous inflate, and such a font throws a
// FontError: convert it to TTF or OTF.
//
// A font comes as bytes (a Uint8Array) everywhere, or as a file path in Node. The default font,
// Lato Regular, is built in (_fonts.ts), so text needs no file access.
//
// Outlines come in font units, y up, as contours: arrays of segments, each an array of 2 points
// (a line), 3 (a quadratic Bézier) or 4 (a cubic Bézier); a contour is closed, so the last
// segment ends where the first starts.

import { LATO_REGULAR } from './_fonts.ts'

// biome-ignore lint: node's modules, reached without a static import
type Any = any

/** A point of an outline in font units, `[x, y]`. */
export type Point = readonly [number, number]
/** A line (2 points), a quadratic Bézier (3) or a cubic Bézier (4). */
export type Segment = readonly Point[]
/** A closed outline: segments end to end. */
export type Contour = Segment[]

/**
 * Kerning of two neighbouring glyphs in font units: the first glyph's advance changes by
 * `advance1` and it moves by `placement1`; the second moves by `placement2` and its advance
 * changes by `advance2`.
 */
export class PairAdjustment {
  readonly advance1: number
  readonly placement1: number
  readonly advance2: number
  readonly placement2: number

  constructor(advance1 = 0, placement1 = 0, advance2 = 0, placement2 = 0) {
    this.advance1 = advance1
    this.placement1 = placement1
    this.advance2 = advance2
    this.placement2 = placement2
  }

  toString(): string {
    return `PairAdjustment(advance1=${this.advance1}, placement1=${this.placement1}, advance2=${this.advance2}, placement2=${this.placement2})`
  }
}

const _NO_PAIR = Object.freeze(new PairAdjustment())

/** The data is not a font this reader can use (Python's FontError, a ValueError). */
export class FontError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'FontError'
  }
}

/**
 * The font `Text` uses unless told otherwise: Lato Regular (SIL Open Font License 1.1, see
 * fonts/OFL.txt), built in as the bytes of its TTF file.
 */
export const DEFAULT_FONT: Uint8Array = _fromBase64(LATO_REGULAR)

const _byBytes = new WeakMap<Uint8Array, Font>()
const _byPath = new Map<string, Font>() // the last 16 font files, as Python's lru_cache(16)

/**
 * The font `source`, read once and kept: the bytes of a font file (a Uint8Array), or a font
 * file's path (Node). Without one, the built-in default (`DEFAULT_FONT`).
 *
 * A path that is no file throws an Error with `code` "ENOENT" (Python's FileNotFoundError).
 */
export function loadFont(source: string | Uint8Array | null = null): Font {
  if (source == null) source = DEFAULT_FONT
  if (source instanceof Uint8Array) {
    let f = _byBytes.get(source)
    if (f === undefined) {
      f = new Font(source)
      _byBytes.set(source, f)
    }
    return f
  }
  if (typeof source !== 'string') throw new TypeError(`a font is a file path or the file's bytes (a Uint8Array), not ${_typeName(source)}`)
  const fs = _fs('reading a font file')
  const p = _expandUser(source)
  const st = fs.statSync(p, { bigint: true, throwIfNoEntry: false })
  if (!st || !st.isFile()) throw _notFound(`no font file ${_repr(p)}`, p)
  const resolved: string = fs.realpathSync(p)
  const key = `${resolved}\0${st.mtimeNs}\0${st.size}`
  let f = _byPath.get(key)
  if (f !== undefined) {
    _byPath.delete(key)
    _byPath.set(key, f)
    return f
  }
  f = new Font(resolved)
  _byPath.set(key, f)
  if (_byPath.size > 16) _byPath.delete(_byPath.keys().next().value as string)
  return f
}

// =============================================================================
// Binary helpers (reads past the end throw, as Python's indexing does)
// =============================================================================
function _u8(b: Uint8Array, o: number): number {
  const v = b[o]
  if (v === undefined || o < 0) throw new RangeError('index out of range')
  return v
}

function _i8(b: Uint8Array, o: number): number {
  const v = _u8(b, o)
  return v >= 0x80 ? v - 0x100 : v
}

function _u16(b: Uint8Array, o: number): number {
  if (o < 0 || o + 2 > b.length) throw new RangeError('index out of range')
  return (b[o] << 8) | b[o + 1]
}

function _i16(b: Uint8Array, o: number): number {
  const v = _u16(b, o)
  return v >= 0x8000 ? v - 0x10000 : v
}

function _u32(b: Uint8Array, o: number): number {
  if (o < 0 || o + 4 > b.length) throw new RangeError('index out of range')
  return b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])
}

function _i32(b: Uint8Array, o: number): number {
  if (o < 0 || o + 4 > b.length) throw new RangeError('index out of range')
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]
}

function _f2dot14(b: Uint8Array, o: number): number {
  return _i16(b, o) / 16384.0
}

/** Four bytes as a table tag (latin-1); fewer at the end of the data. */
function _tag(b: Uint8Array, o: number): string {
  return String.fromCharCode(...b.subarray(o, o + 4))
}

/** Item `i` of a list, or a RangeError (Python's IndexError). */
function _item<T>(list: readonly T[], i: number): T {
  const v = list[i]
  if (v === undefined || i < 0) throw new RangeError('list index out of range')
  return v
}

/** The value of a Python LRU cache: the entry of `key`, made by `make` when missing; the least
 * recently used entry goes beyond `max`. Failures are not kept. */
function _cached<K, V>(cache: Map<K, V>, key: K, max: number, make: () => V): V {
  if (cache.has(key)) {
    const v = cache.get(key) as V
    cache.delete(key)
    cache.set(key, v)
    return v
  }
  const v = make()
  cache.set(key, v)
  if (cache.size > max) cache.delete(cache.keys().next().value as K)
  return v
}

// =============================================================================
// Font
// =============================================================================
/** One font: its characters, metrics, kerning and glyph outlines (font units, y up). */
export class Font {
  /** The font file (null for a font given as bytes). */
  readonly path: string | null
  /** The full name of the font ("Lato Regular"). */
  readonly name: string
  readonly unitsPerEm: number
  readonly numGlyphs: number
  /** Height of the capital letters in font units: OS/2 sCapHeight, or the top of H. */
  readonly capHeight: number
  _tables: Map<string, Uint8Array>
  _longLoca: boolean
  _numHmetrics: number
  _outlines: _TrueTypeOutlines | _CFFOutlines
  _cmap: Map<number, number>
  _kern: _Kerning | null = null

  /** A font from the bytes of its file, or from a file path (Node). */
  constructor(source: string | Uint8Array) {
    let data: Uint8Array
    if (typeof source === 'string') {
      this.path = source
      data = _fs('reading a font file').readFileSync(source)
    } else if (source instanceof Uint8Array) {
      this.path = null
      data = source
    } else {
      throw new TypeError(`a font is a file path or the file's bytes (a Uint8Array), not ${_typeName(source)}`)
    }
    const label = this.path ?? 'font data'
    this._tables = _readTables(data, label)
    for (const tag of ['head', 'hhea', 'hmtx', 'maxp', 'cmap']) {
      if (!this._tables.has(tag)) throw new FontError(`${label}: not a usable font (no ${_repr(tag)} table)`)
    }
    const head = this._tables.get('head') as Uint8Array
    this.unitsPerEm = _u16(head, 18)
    this._longLoca = _i16(head, 50) === 1
    this.numGlyphs = _u16(this._tables.get('maxp') as Uint8Array, 4)
    this._numHmetrics = _u16(this._tables.get('hhea') as Uint8Array, 34)
    const os2 = this._tables.get('OS/2')
    const cap = os2 !== undefined && os2.length >= 90 && _u16(os2, 0) >= 2 ? _i16(os2, 88) : 0
    this.name = _fontName(this._tables.get('name')) || (this.path !== null ? _stem(this.path) : 'font')
    const glyf = this._tables.get('glyf')
    const loca = this._tables.get('loca')
    const cff = this._tables.get('CFF ')
    if (glyf !== undefined && loca !== undefined) {
      this._outlines = new _TrueTypeOutlines(glyf, loca, this._longLoca, this.numGlyphs)
    } else if (cff !== undefined) {
      this._outlines = new _CFFOutlines(cff, this.unitsPerEm)
    } else {
      // (smlibpy draws these through fontTools)
      const kind = this._tables.has('CFF2') ? 'CFF2 (variable OpenType)' : 'this kind of'
      throw new FontError(`${label}: ${kind} outlines are not supported; use a TrueType or CFF font`)
    }
    this._cmap = _readCmap(this._tables.get('cmap') as Uint8Array)
    this.capHeight = cap > 0 ? cap : this._measuredCapHeight()
  }

  toString(): string {
    return `Font(${_repr(this.name)}, ${this.numGlyphs} glyphs, ${this.unitsPerEm} units per em)`
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString()
  }

  // -- characters -------------------------------------------------------------
  /** The glyph of a character, or null when the font has none for it. */
  glyphIndex(char: string): number | null {
    const code = _ord(char)
    let g = this._cmap.get(code)
    if (g === undefined && this._cmap.get(-1) === 1) g = this._cmap.get(0xf000 + code) // a symbol font: characters at U+F0xx
    return g ? g : null
  }

  /** Every character the font maps to a glyph. */
  characters(): string[] {
    const codes = [...this._cmap.keys()].sort((a, b) => a - b)
    return codes.filter((c) => c >= 0 && this._cmap.get(c)).map((c) => String.fromCodePoint(c))
  }

  // -- metrics ----------------------------------------------------------------
  /** Advance width of a glyph in font units. */
  advance(glyph: number): number {
    const hmtx = this._tables.get('hmtx') as Uint8Array
    const i = Math.min(glyph, this._numHmetrics - 1)
    return _u16(hmtx, 4 * i)
  }

  /** The kerning of two neighbouring glyphs: GPOS pair adjustment when the font has it,
   * otherwise the kern table. */
  kerning(left: number, right: number): PairAdjustment {
    if (this._kern === null) this._kern = new _Kerning(this._tables.get('GPOS'), this._tables.get('kern'))
    return this._kern.pair(left, right)
  }

  /** "GPOS", "kern" or null: where `kerning` takes its values from. */
  get kerningSource(): string | null {
    if (this._kern === null) this._kern = new _Kerning(this._tables.get('GPOS'), this._tables.get('kern'))
    return this._kern.source
  }

  // -- outlines ---------------------------------------------------------------
  /** The contours of a glyph in font units (empty for a space). */
  outline(glyph: number): Contour[] {
    // (smlibpy falls back to fontTools for glyphs this reader cannot draw, CFF accents built
    // with seac; here they throw the FontError)
    return this._outlines.contours(glyph)
  }

  _measuredCapHeight(): number {
    for (const ch of 'HIEXT') {
      const g = this.glyphIndex(ch)
      if (g === null) continue
      let top = -Infinity
      let any = false
      for (const c of this.outline(g)) {
        for (const seg of c) {
          for (const p of seg) {
            any = true
            if (p[1] > top) top = p[1]
          }
        }
      }
      if (any) return top
    }
    return 0.7 * this.unitsPerEm
  }
}

// =============================================================================
// Containers: sfnt, TTC, WOFF (WOFF2 needs fontTools, which only smlibpy has)
// =============================================================================
function _readTables(data: Uint8Array, label: string): Map<string, Uint8Array> {
  if (data.length < 12) throw new FontError(`${label}: not a font file`)
  let tag = _tag(data, 0)
  if (tag === 'wOFF') return _woffTables(data, label)
  if (tag === 'wOF2') throw new FontError(`${label}: WOFF2 fonts are not supported; convert the font to TTF or OTF`)
  let offset = 0
  if (tag === 'ttcf') {
    if (_u32(data, 8) < 1) throw new FontError(`${label}: an empty font collection`)
    offset = _u32(data, 12) // the first font of the collection
    tag = _tag(data, offset)
  }
  if (tag !== '\x00\x01\x00\x00' && tag !== 'true' && tag !== 'OTTO') throw new FontError(`${label}: not a TrueType or OpenType font`)
  const n = _u16(data, offset + 4)
  const tables = new Map<string, Uint8Array>()
  for (let i = 0; i < n; i++) {
    const rec = offset + 12 + 16 * i
    const t = _tag(data, rec)
    const off = _u32(data, rec + 8)
    const length = _u32(data, rec + 12)
    tables.set(t, data.subarray(off, off + length))
  }
  if (tables.has('CFF2') && !tables.has('glyf') && !tables.has('CFF ')) {
    throw new FontError(`${label}: CFF2 (variable OpenType) outlines are not supported; convert the font to TTF or OTF`)
  }
  return tables
}

function _woffTables(data: Uint8Array, label: string): Map<string, Uint8Array> {
  const n = _u16(data, 12)
  const tables = new Map<string, Uint8Array>()
  for (let i = 0; i < n; i++) {
    const rec = 44 + 20 * i
    const t = _tag(data, rec)
    const off = _u32(data, rec + 4)
    const comp = _u32(data, rec + 8)
    const orig = _u32(data, rec + 12)
    const raw = data.subarray(off, off + comp)
    const table = comp < orig ? _inflate(raw, label) : raw
    tables.set(t, table)
    if (table.length !== orig) throw new FontError(`${label}: damaged WOFF table ${_repr(t)}`)
  }
  return tables
}

/** zlib's decompress (node:zlib); outside Node there is no synchronous inflate. */
function _inflate(raw: Uint8Array, label: string): Uint8Array {
  const zlib = _builtin('node:zlib')
  if (!zlib) throw new FontError(`${label}: a WOFF font with compressed tables needs node:zlib, which only Node has; convert the font to TTF or OTF`)
  return new Uint8Array(zlib.inflateSync(raw))
}

function _fontName(table: Uint8Array | undefined): string | null {
  if (!table || table.length < 6) return null
  const count = _u16(table, 2)
  const strings = _u16(table, 4)
  const found = new Map<number, string>()
  for (let i = 0; i < count; i++) {
    const rec = 6 + 12 * i
    const platform = _u16(table, rec)
    const encoding = _u16(table, rec + 2)
    _u16(table, rec + 4) // (the language)
    const nameId = _u16(table, rec + 6)
    const length = _u16(table, rec + 8)
    const off = _u16(table, rec + 10)
    if (!(nameId === 1 || nameId === 2 || nameId === 4) || found.has(nameId)) continue
    const raw = table.subarray(strings + off, strings + off + length)
    if (platform === 0 || platform === 3) found.set(nameId, _utf16be(raw))
    else if (platform === 1 && encoding === 0) found.set(nameId, _macRoman(raw))
  }
  if (found.has(4)) return found.get(4) as string
  if (found.has(1)) {
    const sub = found.get(2)
    return (found.get(1) as string) + (sub && sub !== 'Regular' ? ` ${sub}` : '')
  }
  return null
}

/** UTF-16BE as Python decodes it with errors="replace". */
function _utf16be(raw: Uint8Array): string {
  let out = ''
  const n = raw.length
  let i = 0
  while (i + 1 < n) {
    const u = (raw[i] << 8) | raw[i + 1]
    i += 2
    if (u >= 0xd800 && u <= 0xdbff) {
      if (i + 1 >= n) {
        // a high surrogate at the end: one replacement for what is left
        out += '\ufffd'
        i = n
        break
      }
      const w = (raw[i] << 8) | raw[i + 1]
      if (w >= 0xdc00 && w <= 0xdfff) {
        out += String.fromCharCode(u, w)
        i += 2
      } else {
        out += '\ufffd'
      }
    } else if (u >= 0xdc00 && u <= 0xdfff) {
      out += '\ufffd'
    } else {
      out += String.fromCharCode(u)
    }
  }
  if (i < n) out += '\ufffd'
  return out
}

// Python's mac-roman codec, bytes 0x80 to 0xFF
const _MAC_ROMAN =
  '\u00c4\u00c5\u00c7\u00c9\u00d1\u00d6\u00dc\u00e1\u00e0\u00e2\u00e4\u00e3\u00e5\u00e7\u00e9\u00e8' +
  '\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f1\u00f3\u00f2\u00f4\u00f6\u00f5\u00fa\u00f9\u00fb\u00fc' +
  '\u2020\u00b0\u00a2\u00a3\u00a7\u2022\u00b6\u00df\u00ae\u00a9\u2122\u00b4\u00a8\u2260\u00c6\u00d8' +
  '\u221e\u00b1\u2264\u2265\u00a5\u00b5\u2202\u2211\u220f\u03c0\u222b\u00aa\u00ba\u03a9\u00e6\u00f8' +
  '\u00bf\u00a1\u00ac\u221a\u0192\u2248\u2206\u00ab\u00bb\u2026\u00a0\u00c0\u00c3\u00d5\u0152\u0153' +
  '\u2013\u2014\u201c\u201d\u2018\u2019\u00f7\u25ca\u00ff\u0178\u2044\u20ac\u2039\u203a\ufb01\ufb02' +
  '\u2021\u00b7\u201a\u201e\u2030\u00c2\u00ca\u00c1\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u00d3\u00d4' +
  '\uf8ff\u00d2\u00da\u00db\u00d9\u0131\u02c6\u02dc\u00af\u02d8\u02d9\u02da\u00b8\u02dd\u02db\u02c7'

function _macRoman(raw: Uint8Array): string {
  let out = ''
  for (const b of raw) out += b < 0x80 ? String.fromCharCode(b) : _MAC_ROMAN[b - 0x80]
  return out
}

// =============================================================================
// cmap
// =============================================================================
/** Character code -> glyph. A symbol font also gets the entry `-1 -> 1`. */
function _readCmap(table: Uint8Array): Map<number, number> {
  const n = _u16(table, 2)
  const subtables = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const platform = _u16(table, 4 + 8 * i)
    const encoding = _u16(table, 6 + 8 * i)
    const off = _u32(table, 8 + 8 * i)
    const key = `${platform},${encoding}`
    if (!subtables.has(key)) subtables.set(key, off)
  }
  for (const key of ['3,10', '0,6', '0,4', '3,1', '0,3', '0,2', '0,1', '0,0', '3,0']) {
    const off = subtables.get(key)
    if (off === undefined) continue
    const out = _cmapSubtable(table, off)
    if (out !== null) {
      if (key === '3,0') out.set(-1, 1)
      return out
    }
  }
  throw new FontError('the font has no Unicode character map')
}

function _cmapSubtable(t: Uint8Array, o: number): Map<number, number> | null {
  const fmt = _u16(t, o)
  const out = new Map<number, number>()
  if (fmt === 0) {
    for (let c = 0; c < 256; c++) out.set(c, _u8(t, o + 6 + c))
  } else if (fmt === 4) {
    const seg2 = _u16(t, o + 6)
    const ends = o + 14
    const starts = o + 16 + seg2
    const deltas = starts + seg2
    const ranges = starts + 2 * seg2
    for (let s = 0; s < Math.floor(seg2 / 2); s++) {
      const end = _u16(t, ends + 2 * s)
      const start = _u16(t, starts + 2 * s)
      const delta = _u16(t, deltas + 2 * s)
      const ro = _u16(t, ranges + 2 * s)
      if (start === 0xffff) continue
      for (let c = start; c <= end; c++) {
        let g: number
        if (ro === 0) {
          g = (c + delta) & 0xffff
        } else {
          const addr = ranges + 2 * s + ro + 2 * (c - start)
          g = addr + 1 < t.length ? _u16(t, addr) : 0
          if (g) g = (g + delta) & 0xffff
        }
        if (g) out.set(c, g)
      }
    }
  } else if (fmt === 6) {
    const first = _u16(t, o + 6)
    const count = _u16(t, o + 8)
    for (let i = 0; i < count; i++) out.set(first + i, _u16(t, o + 10 + 2 * i))
  } else if (fmt === 12 || fmt === 13) {
    const groups = _u32(t, o + 12)
    for (let i = 0; i < groups; i++) {
      const g0 = o + 16 + 12 * i
      const start = _u32(t, g0)
      const end = _u32(t, g0 + 4)
      const gid = _u32(t, g0 + 8)
      for (let c = start; c <= end; c++) out.set(c, fmt === 12 ? gid + (c - start) : gid)
    }
  } else {
    return null
  }
  for (const [c, g] of out) if (!g) out.delete(c)
  return out
}

// =============================================================================
// TrueType outlines
// =============================================================================
const _ON_CURVE = 0x01
const _X_SHORT = 0x02
const _Y_SHORT = 0x04
const _REPEAT = 0x08
const _X_SAME = 0x10
const _Y_SAME = 0x20
const _ARG_WORDS = 0x1
const _ARGS_XY = 0x2
const _SCALE = 0x8
const _MORE = 0x20
const _XY_SCALE = 0x40
const _TWO_BY_TWO = 0x80
const _SCALED_OFFSET = 0x800

/** The points of a glyph, whether each is on the curve, and the last point of each contour. */
type _Points = [Point[], boolean[], number[]]

class _TrueTypeOutlines {
  readonly glyf: Uint8Array
  readonly offsets: number[]
  readonly numGlyphs: number
  readonly _cache = new Map<number, Contour[]>()

  constructor(glyf: Uint8Array, loca: Uint8Array, longLoca: boolean, numGlyphs: number) {
    this.glyf = glyf
    const n = numGlyphs + 1
    const offsets: number[] = []
    if (longLoca) {
      if (loca.length >= 4 * n) for (let i = 0; i < n; i++) offsets.push(_u32(loca, 4 * i))
    } else if (loca.length >= 2 * n) {
      for (let i = 0; i < n; i++) offsets.push(2 * _u16(loca, 2 * i))
    }
    if (!offsets.length) throw new FontError("the font's loca table is too short")
    this.offsets = offsets
    this.numGlyphs = numGlyphs
  }

  contours(glyph: number): Contour[] {
    return _cached(this._cache, glyph, 4096, () => {
      const [points, on, ends] = this._points(glyph, 0)
      const out: Contour[] = []
      let start = 0
      for (const end of ends) {
        const c = _quadraticContour(points.slice(start, end + 1), on.slice(start, end + 1))
        if (c.length) out.push(c)
        start = end + 1
      }
      return out
    })
  }

  _points(glyph: number, depth: number): _Points {
    if (glyph < 0 || glyph >= this.numGlyphs) throw new FontError(`glyph ${glyph} is not in the font`)
    if (depth > 12) throw new FontError('composite glyphs nested too deep')
    const o = this.offsets[glyph]
    const end = this.offsets[glyph + 1]
    if (end <= o) return [[], [], []]
    const g = this.glyf
    const n = _i16(g, o)
    if (n >= 0) return _simpleGlyph(g, o, n)
    return this._composite(o + 10, depth)
  }

  _composite(p: number, depth: number): _Points {
    const g = this.glyf
    const points: Point[] = []
    const on: boolean[] = []
    const ends: number[] = []
    while (true) {
      const flags = _u16(g, p)
      const child = _u16(g, p + 2)
      p += 4
      let a1: number
      let a2: number
      if (flags & _ARG_WORDS) {
        if (flags & _ARGS_XY) {
          a1 = _i16(g, p)
          a2 = _i16(g, p + 2)
        } else {
          a1 = _u16(g, p)
          a2 = _u16(g, p + 2)
        }
        p += 4
      } else {
        if (flags & _ARGS_XY) {
          a1 = _i8(g, p)
          a2 = _i8(g, p + 1)
        } else {
          a1 = _u8(g, p)
          a2 = _u8(g, p + 1)
        }
        p += 2
      }
      // x' = xx*x + yx*y, y' = xy*x + yy*y
      let xx = 1.0
      let xy = 0.0
      let yx = 0.0
      let yy = 1.0
      if (flags & _SCALE) {
        xx = yy = _f2dot14(g, p)
        p += 2
      } else if (flags & _XY_SCALE) {
        xx = _f2dot14(g, p)
        yy = _f2dot14(g, p + 2)
        p += 4
      } else if (flags & _TWO_BY_TWO) {
        xx = _f2dot14(g, p)
        xy = _f2dot14(g, p + 2)
        yx = _f2dot14(g, p + 4)
        yy = _f2dot14(g, p + 6)
        p += 8
      }
      const [cpts, con, cends] = this._points(child, depth + 1)
      const moved: Point[] = cpts.map(([x, y]) => [xx * x + yx * y, xy * x + yy * y])
      let dx: number
      let dy: number
      if (flags & _ARGS_XY) {
        dx = a1
        dy = a2
        if (flags & _SCALED_OFFSET) [dx, dy] = [xx * dx + yx * dy, xy * dx + yy * dy]
      } else {
        // point matching: the child's point a2 goes onto the parent's point a1
        if (a1 >= points.length || a2 >= moved.length) throw new FontError('a composite glyph matches a point that does not exist')
        dx = points[a1][0] - moved[a2][0]
        dy = points[a1][1] - moved[a2][1]
      }
      const base = points.length
      for (const [x, y] of moved) points.push([x + dx, y + dy])
      for (const b of con) on.push(b)
      for (const e of cends) ends.push(base + e)
      if (!(flags & _MORE)) break
    }
    return [points, on, ends]
  }
}

function _simpleGlyph(g: Uint8Array, o: number, n: number): _Points {
  if (n === 0) return [[], [], []]
  const ends: number[] = []
  for (let i = 0; i < n; i++) ends.push(_u16(g, o + 10 + 2 * i))
  const count = ends[n - 1] + 1
  let p = o + 10 + 2 * n
  p += 2 + _u16(g, p) // instructions
  let flags: number[] = []
  while (flags.length < count) {
    const f = _u8(g, p)
    p += 1
    flags.push(f)
    if (f & _REPEAT) {
      const r = _u8(g, p)
      for (let k = 0; k < r; k++) flags.push(f)
      p += 1
    }
  }
  flags = flags.slice(0, count)
  const xs: number[] = []
  let v = 0
  for (const f of flags) {
    if (f & _X_SHORT) {
      const d = _u8(g, p)
      p += 1
      v += f & _X_SAME ? d : -d
    } else if (!(f & _X_SAME)) {
      v += _i16(g, p)
      p += 2
    }
    xs.push(v)
  }
  const ys: number[] = []
  v = 0
  for (const f of flags) {
    if (f & _Y_SHORT) {
      const d = _u8(g, p)
      p += 1
      v += f & _Y_SAME ? d : -d
    } else if (!(f & _Y_SAME)) {
      v += _i16(g, p)
      p += 2
    }
    ys.push(v)
  }
  return [xs.map((x, i) => [x, ys[i]] as Point), flags.map((f) => Boolean(f & _ON_CURVE)), ends]
}

function _same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

/** Lines and quadratic Béziers of a closed TrueType contour, with the implied on-curve points
 * between two off-curve points made explicit. */
function _quadraticContour(points: readonly Point[], on: readonly boolean[]): Contour {
  const n = points.length
  if (n < 2) return []
  let pts: Point[]
  let flags: boolean[]
  if (!on.some((b) => b)) {
    // only off-curve points: start at the midpoint of the last and the first
    const first = _mid(points[n - 1], points[0])
    pts = [first, ...points]
    flags = [true, ...on]
  } else {
    const k = on.indexOf(true)
    pts = [...points.slice(k), ...points.slice(0, k)]
    flags = [...on.slice(k), ...on.slice(0, k)]
  }
  pts.push(pts[0])
  flags.push(true)
  const out: Segment[] = []
  let cur = pts[0]
  let ctrl: Point | null = null
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    if (flags[i]) {
      const seg: Segment = ctrl !== null ? [cur, ctrl, p] : [cur, p]
      if (!_same(seg[0], seg[seg.length - 1]) || seg.length === 3) out.push(seg)
      cur = p
      ctrl = null
    } else if (ctrl === null) {
      ctrl = p
    } else {
      const m = _mid(ctrl, p)
      out.push([cur, ctrl, m])
      cur = m
      ctrl = p
    }
  }
  return out.filter((s) => !s.every((q) => _same(q, s[0])))
}

function _mid(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}

// =============================================================================
// CFF outlines (Type 2 charstrings)
// =============================================================================
/** The items of a CFF INDEX at `o` and the offset after it. */
function _cffIndex(b: Uint8Array, o: number): [Uint8Array[], number] {
  const count = _u16(b, o)
  if (count === 0) return [[], o + 2]
  const size = _u8(b, o + 2)
  const offs: number[] = []
  let p = o + 3
  for (let i = 0; i < count + 1; i++) {
    let v = 0
    for (let k = 0; k < size; k++) v = v * 256 + _u8(b, p + k)
    offs.push(v)
    p += size
  }
  const base = p - 1
  const items: Uint8Array[] = []
  for (let i = 0; i < count; i++) items.push(b.subarray(base + offs[i], base + offs[i + 1]))
  return [items, base + offs[count]]
}

function _cffDict(d: Uint8Array): Map<number, number[]> {
  const out = new Map<number, number[]>()
  let ops: number[] = []
  let i = 0
  while (i < d.length) {
    const b0 = d[i]
    if (b0 <= 21) {
      let key: number
      if (b0 === 12) {
        key = 1200 + _u8(d, i + 1)
        i += 2
      } else {
        key = b0
        i += 1
      }
      out.set(key, ops)
      ops = []
    } else if (b0 === 28) {
      ops.push(_i16(d, i + 1))
      i += 3
    } else if (b0 === 29) {
      ops.push(_i32(d, i + 1))
      i += 5
    } else if (b0 === 30) {
      // real number in nibbles
      let s = ''
      i += 1
      let done = false
      while (!done) {
        const byte = _u8(d, i)
        i += 1
        for (const nib of [byte >> 4, byte & 15]) {
          if (nib === 15) {
            done = true
            break
          }
          s += '0123456789.EE?-'[nib] + (nib === 12 ? '-' : '')
        }
      }
      ops.push(_float(s.replaceAll('E-', 'e-').replaceAll('E', 'e') || '0'))
    } else if (32 <= b0 && b0 <= 246) {
      ops.push(b0 - 139)
      i += 1
    } else if (247 <= b0 && b0 <= 250) {
      ops.push((b0 - 247) * 256 + _u8(d, i + 1) + 108)
      i += 2
    } else if (251 <= b0 && b0 <= 254) {
      ops.push(-(b0 - 251) * 256 - _u8(d, i + 1) - 108)
      i += 2
    } else {
      i += 1
    }
  }
  return out
}

/** The first `count` operands of a CFF dictionary entry, as Python's int(). */
function _operands(d: Map<number, number[]>, key: number, count = 1): number[] {
  const ops = d.get(key)
  if (ops === undefined) throw new RangeError(`the CFF dictionary has no entry ${key}`)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(Math.trunc(_item(ops, i)))
  return out
}

function _subrBias(n: number): number {
  return n < 1240 ? 107 : n < 33900 ? 1131 : 32768
}

class _CFFOutlines {
  readonly gsubrs: Uint8Array[]
  readonly charstrings: Uint8Array[]
  readonly scale: number
  readonly lsubrs: Uint8Array[][]
  readonly fdOf: number[] | null
  readonly _cache = new Map<number, Contour[]>()

  constructor(cff: Uint8Array, unitsPerEm: number) {
    let o = _u8(cff, 2) // header size
    ;[, o] = _cffIndex(cff, o) // names
    let tops: Uint8Array[]
    ;[tops, o] = _cffIndex(cff, o)
    ;[, o] = _cffIndex(cff, o) // strings
    ;[this.gsubrs] = _cffIndex(cff, o)
    const top = _cffDict(_item(tops, 0))
    if (!top.has(17)) throw new FontError('the CFF table has no charstrings')
    ;[this.charstrings] = _cffIndex(cff, _operands(top, 17)[0])
    // Charstrings are in font units when the font matrix is the usual 1 / units per em (often
    // written with few digits); a font matrix for another em size scales them.
    const matrix = top.get(1207) ?? [0.001, 0, 0, 0.001, 0, 0]
    const ratio = Number(matrix[0]) * unitsPerEm
    this.scale = !matrix[0] || Math.abs(ratio - 1.0) < 1e-3 ? 1.0 : ratio
    if (top.has(1236)) {
      // CID-keyed: one private dict (and local subroutines) per font dict
      const [fds] = _cffIndex(cff, _operands(top, 1236)[0])
      this.lsubrs = fds.map((fd) => _CFFOutlines._privateSubrs(cff, _cffDict(fd)))
      this.fdOf = _fdSelect(cff, _operands(top, 1237)[0], this.charstrings.length)
    } else {
      this.lsubrs = [_CFFOutlines._privateSubrs(cff, top)]
      this.fdOf = null
    }
  }

  static _privateSubrs(cff: Uint8Array, d: Map<number, number[]>): Uint8Array[] {
    if (!d.has(18)) return []
    const [size, off] = _operands(d, 18, 2)
    const priv = _cffDict(cff.subarray(off, off + size))
    if (!priv.has(19)) return []
    const [subrs] = _cffIndex(cff, off + _operands(priv, 19)[0])
    return subrs
  }

  contours(glyph: number): Contour[] {
    return _cached(this._cache, glyph, 4096, () => {
      if (glyph < 0 || glyph >= this.charstrings.length) throw new FontError(`glyph ${glyph} is not in the font`)
      const local = this.lsubrs.length ? _item(this.lsubrs, this.fdOf !== null ? _item(this.fdOf, glyph) : 0) : []
      let contours = new _Type2(this.gsubrs, local).run(this.charstrings[glyph])
      if (this.scale !== 1.0) {
        const s = this.scale
        contours = contours.map((c) => c.map((seg) => seg.map(([x, y]) => [x * s, y * s] as Point)))
      }
      return contours
    })
  }
}

function _fdSelect(cff: Uint8Array, o: number, n: number): number[] {
  const fmt = _u8(cff, o)
  if (fmt === 0) return Array.from(cff.subarray(o + 1, o + 1 + n))
  if (fmt === 3) {
    const ranges = _u16(cff, o + 1)
    const out = new Array<number>(n).fill(0)
    for (let i = 0; i < ranges; i++) {
      const first = _u16(cff, o + 3 + 3 * i)
      const fd = _u8(cff, o + 5 + 3 * i)
      const last = _u16(cff, o + 3 + 3 * (i + 1))
      for (let g = first; g < Math.min(last, n); g++) out[g] = fd
    }
    return out
  }
  throw new FontError(`unknown FDSelect format ${fmt}`)
}

/** Interpreter of Type 2 charstrings: returns the contours, ignoring hints. */
class _Type2 {
  readonly gsubrs: Uint8Array[]
  readonly lsubrs: Uint8Array[]
  readonly gbias: number
  readonly lbias: number
  readonly stack: number[] = []
  readonly contours: Contour[] = []
  current: Contour = []
  x = 0.0
  y = 0.0
  start: Point = [0.0, 0.0]
  stems = 0
  widthDone = false
  ended = false

  constructor(gsubrs: Uint8Array[], lsubrs: Uint8Array[]) {
    this.gsubrs = gsubrs
    this.lsubrs = lsubrs
    this.gbias = _subrBias(gsubrs.length)
    this.lbias = _subrBias(lsubrs.length)
  }

  run(code: Uint8Array): Contour[] {
    this._execute(code, 0)
    this._close()
    return this.contours
  }

  // -- path building --------------------------------------------------------------
  _close(): void {
    if (this.current.length) {
      const seg = this.current[this.current.length - 1]
      const last = seg[seg.length - 1]
      if (!_same(last, this.start)) this.current.push([last, this.start])
      this.contours.push(this.current)
    }
    this.current = []
  }

  _move(dx: number, dy: number): void {
    this._close()
    this.x += dx
    this.y += dy
    this.start = [this.x, this.y]
  }

  _line(dx: number, dy: number): void {
    const a: Point = [this.x, this.y]
    this.x += dx
    this.y += dy
    if (this.x !== a[0] || this.y !== a[1]) this.current.push([a, [this.x, this.y]])
  }

  _curve(dxa: number, dya: number, dxb: number, dyb: number, dxc: number, dyc: number): void {
    const a: Point = [this.x, this.y]
    const b: Point = [a[0] + dxa, a[1] + dya]
    const c: Point = [b[0] + dxb, b[1] + dyb]
    const d: Point = [c[0] + dxc, c[1] + dyc]
    this.x = d[0]
    this.y = d[1]
    if (!(_same(a, b) && _same(b, c) && _same(c, d))) this.current.push([a, b, c, d])
  }

  /** `_curve` of the six stack values from `k`. */
  _curveAt(k: number): void {
    const s = this.stack
    if (k + 6 > s.length) throw new FontError('a charstring curve has too few arguments')
    this._curve(s[k], s[k + 1], s[k + 2], s[k + 3], s[k + 4], s[k + 5])
  }

  /** Drop the advance width that may precede the first stack-clearing operator (`present`
   * says whether the stack holds one more number than the operator takes). */
  _width(present: boolean): void {
    if (!this.widthDone) {
      this.widthDone = true
      if (present) this.stack.shift()
    }
  }

  // -- interpreter ------------------------------------------------------------------
  _execute(code: Uint8Array, depth: number): void {
    if (depth > 10) throw new FontError('charstring subroutines nested too deep')
    const s = this.stack
    let i = 0
    const n = code.length
    while (i < n && !this.ended) {
      const b0 = code[i]
      i += 1
      if (b0 >= 32) {
        if (b0 <= 246) {
          s.push(b0 - 139)
        } else if (b0 <= 250) {
          s.push((b0 - 247) * 256 + _u8(code, i) + 108)
          i += 1
        } else if (b0 <= 254) {
          s.push(-(b0 - 251) * 256 - _u8(code, i) - 108)
          i += 1
        } else {
          s.push(_i32(code, i) / 65536.0)
          i += 4
        }
        continue
      }
      if (b0 === 28) {
        s.push(_i16(code, i))
        i += 2
        continue
      }
      if (b0 === 1 || b0 === 3 || b0 === 18 || b0 === 23) {
        // hstem, vstem, hstemhm, vstemhm
        this._width(s.length % 2 === 1)
        this.stems += Math.floor(s.length / 2)
        s.length = 0
      } else if (b0 === 19 || b0 === 20) {
        // hintmask, cntrmask
        this._width(s.length % 2 === 1)
        this.stems += Math.floor(s.length / 2)
        s.length = 0
        i += Math.floor((this.stems + 7) / 8)
      } else if (b0 === 21) {
        // rmoveto
        this._width(s.length > 2)
        this._move(_at(s, -2), _at(s, -1))
        s.length = 0
      } else if (b0 === 22) {
        // hmoveto
        this._width(s.length > 1)
        this._move(_at(s, -1), 0)
        s.length = 0
      } else if (b0 === 4) {
        // vmoveto
        this._width(s.length > 1)
        this._move(0, _at(s, -1))
        s.length = 0
      } else if (b0 === 5) {
        // rlineto
        for (let k = 0; k < s.length - 1; k += 2) this._line(s[k], s[k + 1])
        s.length = 0
      } else if (b0 === 6 || b0 === 7) {
        // hlineto, vlineto
        let horizontal = b0 === 6
        for (const v of s) {
          if (horizontal) this._line(v, 0)
          else this._line(0, v)
          horizontal = !horizontal
        }
        s.length = 0
      } else if (b0 === 8) {
        // rrcurveto
        for (let k = 0; k < s.length - 5; k += 6) this._curveAt(k)
        s.length = 0
      } else if (b0 === 27) {
        // hhcurveto
        let k = 0
        let dy1 = 0.0
        if (s.length % 4 === 1) {
          dy1 = s[0]
          k = 1
        }
        while (k + 3 < s.length) {
          this._curve(s[k], dy1, s[k + 1], s[k + 2], s[k + 3], 0)
          dy1 = 0.0
          k += 4
        }
        s.length = 0
      } else if (b0 === 26) {
        // vvcurveto
        let k = 0
        let dx1 = 0.0
        if (s.length % 4 === 1) {
          dx1 = s[0]
          k = 1
        }
        while (k + 3 < s.length) {
          this._curve(dx1, s[k], s[k + 1], s[k + 2], 0, s[k + 3])
          dx1 = 0.0
          k += 4
        }
        s.length = 0
      } else if (b0 === 30 || b0 === 31) {
        // vhcurveto, hvcurveto
        let horizontal = b0 === 31
        let k = 0
        while (k + 3 < s.length) {
          const last = s.length - k === 5 ? s[k + 4] : 0.0
          if (horizontal) this._curve(s[k], 0, s[k + 1], s[k + 2], last, s[k + 3])
          else this._curve(0, s[k], s[k + 1], s[k + 2], s[k + 3], last)
          horizontal = !horizontal
          k += 4
        }
        s.length = 0
      } else if (b0 === 24) {
        // rcurveline
        let k = 0
        while (s.length - k >= 8) {
          this._curveAt(k)
          k += 6
        }
        this._line(_at(s, k), _at(s, k + 1))
        s.length = 0
      } else if (b0 === 25) {
        // rlinecurve
        let k = 0
        while (s.length - k >= 8) {
          this._line(s[k], s[k + 1])
          k += 2
        }
        this._curveAt(k)
        s.length = 0
      } else if (b0 === 10) {
        // callsubr
        const idx = Math.trunc(_pop(s)) + this.lbias
        if (!(0 <= idx && idx < this.lsubrs.length)) throw new FontError('a charstring calls a subroutine that does not exist')
        this._execute(this.lsubrs[idx], depth + 1)
      } else if (b0 === 29) {
        // callgsubr
        const idx = Math.trunc(_pop(s)) + this.gbias
        if (!(0 <= idx && idx < this.gsubrs.length)) throw new FontError('a charstring calls a subroutine that does not exist')
        this._execute(this.gsubrs[idx], depth + 1)
      } else if (b0 === 11) {
        // return
        return
      } else if (b0 === 14) {
        // endchar
        this._width(s.length === 1 || s.length === 5)
        // (smlibpy draws these with fontTools)
        if (s.length >= 4) throw new FontError('accented glyphs built with seac are not supported')
        s.length = 0
        this.ended = true
      } else if (b0 === 12) {
        const b1 = _u8(code, i)
        i += 1
        this._escape(b1)
      } else {
        throw new FontError(`unknown charstring operator ${b0}`)
      }
    }
  }

  _escape(op: number): void {
    const s = this.stack
    const take = (count: number): number[] => {
      if (s.length < count) throw new FontError(`charstring operator 12 ${op} has too few arguments`)
      return s.slice(0, count)
    }
    if (op === 35) {
      // flex
      take(12)
      this._curveAt(0)
      this._curveAt(6)
    } else if (op === 34) {
      // hflex
      const [dx1, dx2, dy2, dx3, dx4, dx5, dx6] = take(7)
      this._curve(dx1, 0, dx2, dy2, dx3, 0)
      this._curve(dx4, 0, dx5, -dy2, dx6, 0)
    } else if (op === 36) {
      // hflex1
      const [dx1, dy1, dx2, dy2, dx3, dx4, dx5, dy5, dx6] = take(9)
      this._curve(dx1, dy1, dx2, dy2, dx3, 0)
      this._curve(dx4, 0, dx5, dy5, dx6, -(dy1 + dy2 + dy5))
    } else if (op === 37) {
      // flex1
      const d = take(11)
      const dx = d[0] + d[2] + d[4] + d[6] + d[8]
      const dy = d[1] + d[3] + d[5] + d[7] + d[9]
      this._curve(d[0], d[1], d[2], d[3], d[4], d[5])
      if (Math.abs(dx) > Math.abs(dy)) this._curve(d[6], d[7], d[8], d[9], d[10], -dy)
      else this._curve(d[6], d[7], d[8], d[9], -dx, d[10])
    } else if (op === 0) {
      // dotsection (obsolete)
    } else if (op === 9) {
      s.push(Math.abs(_pop(s)))
      return
    } else if (op === 10 || op === 11 || op === 12 || op === 24) {
      const b = _pop(s)
      const a = _pop(s)
      if (op === 12 && b === 0) throw new RangeError('float division by zero')
      s.push(op === 10 ? a + b : op === 11 ? a - b : op === 12 ? a / b : a * b)
      return
    } else if (op === 14) {
      s.push(-_pop(s))
      return
    } else if (op === 18) {
      _pop(s)
      return
    } else if (op === 27) {
      s.push(_at(s, -1))
      return
    } else if (op === 28) {
      const last = _at(s, -1)
      s[s.length - 1] = _at(s, -2)
      s[s.length - 2] = last
      return
    } else {
      throw new FontError(`charstring operator 12 ${op} is not supported`)
    }
    s.length = 0
  }
}

/** `s[i]` with Python's negative indices; out of range throws. */
function _at(s: readonly number[], i: number): number {
  const v = s[i < 0 ? s.length + i : i]
  if (v === undefined) throw new FontError('a charstring operator has too few arguments')
  return v
}

function _pop(s: number[]): number {
  const v = s.pop()
  if (v === undefined) throw new FontError('a charstring operator has too few arguments')
  return v
}

// =============================================================================
// Kerning: GPOS pair adjustment, kern table
// =============================================================================
type _Values = [number, number, number, number] // XPlacement, YPlacement, XAdvance, YAdvance

class _Kerning {
  readonly lookups: _PairPos[][]
  readonly table: Map<number, number>
  readonly source: string | null
  readonly cache = new Map<string, PairAdjustment>()

  constructor(gpos: Uint8Array | undefined, kern: Uint8Array | undefined) {
    this.lookups = gpos && gpos.length ? _gposKernLookups(gpos) : []
    this.table = new Map()
    if (this.lookups.length) {
      this.source = 'GPOS'
    } else if (kern && kern.length) {
      this.table = _kernTable(kern)
      this.source = this.table.size ? 'kern' : null
    } else {
      this.source = null
    }
  }

  pair(left: number, right: number): PairAdjustment {
    const key = `${left},${right}`
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    let result: PairAdjustment
    if (this.lookups.length) {
      let a1 = 0.0
      let p1 = 0.0
      let a2 = 0.0
      let p2 = 0.0
      for (const subtables of this.lookups) {
        for (const st of subtables) {
          const found = st.find(left, right)
          if (found !== null) {
            const [v1, v2] = found
            p1 += v1[0]
            a1 += v1[2]
            p2 += v2[0]
            a2 += v2[2]
            break
          }
        }
      }
      result = a1 || p1 || a2 || p2 ? new PairAdjustment(a1, p1, a2, p2) : _NO_PAIR
    } else {
      const v = _isGlyph(left) && _isGlyph(right) ? (this.table.get(_pairKey(left, right)) ?? 0) : 0
      result = v ? new PairAdjustment(v) : _NO_PAIR
    }
    this.cache.set(key, result)
    return result
  }
}

function _isGlyph(g: number): boolean {
  return Number.isInteger(g) && g >= 0 && g <= 0xffff
}

/** The key of a pair of glyphs in `_kernTable`: `left * 65536 + right`. */
export function _pairKey(left: number, right: number): number {
  return left * 0x10000 + right
}

/** The format 0 pairs of a kern table, keyed by `_pairKey(left, right)`. */
export function _kernTable(t: Uint8Array): Map<number, number> {
  const out = new Map<number, number>()
  if (t.length < 4) return out
  const apple = _u32(t, 0) === 0x00010000
  let n: number
  let p: number
  if (apple) {
    n = _u32(t, 4)
    p = 8
  } else {
    n = _u16(t, 2)
    p = 4
  }
  for (let sub = 0; sub < n; sub++) {
    let length: number
    let fmt: number
    let usable: boolean
    let head: number
    if (apple) {
      length = _u32(t, p)
      const coverage = _u16(t, p + 4)
      fmt = coverage & 0xff
      const horizontal = !(coverage & 0x8000)
      usable = horizontal && !(coverage & 0x4000) && !(coverage & 0x2000)
      head = 8
    } else {
      length = _u16(t, p + 2)
      const coverage = _u16(t, p + 4)
      fmt = coverage >> 8
      usable = Boolean(coverage & 1) && !(coverage & 0x6)
      head = 6
    }
    if (fmt === 0 && usable) {
      const pairs = _u16(t, p + head)
      const q = p + head + 8
      for (let k = 0; k < pairs; k++) {
        const r = q + 6 * k
        const key = _pairKey(_u16(t, r), _u16(t, r + 2))
        out.set(key, (out.get(key) ?? 0) + _i16(t, r + 4))
      }
      length = Math.max(length, head + 8 + 6 * pairs) // the 16-bit length of big subtables overflows
    }
    p += length
  }
  return out
}

/** The pair-adjustment subtables of the lookups of every kern feature, in lookup order. */
function _gposKernLookups(t: Uint8Array): _PairPos[][] {
  if (t.length < 10) return []
  const features = _u16(t, 6)
  const lookups = _u16(t, 8)
  const wanted = new Set<number>()
  const count = _u16(t, features)
  for (let i = 0; i < count; i++) {
    const rec = features + 2 + 6 * i
    if (_tag(t, rec) === 'kern') {
      const f = features + _u16(t, rec + 4)
      const m = _u16(t, f + 2)
      for (let k = 0; k < m; k++) wanted.add(_u16(t, f + 4 + 2 * k))
    }
  }
  const out: _PairPos[][] = []
  for (const li of [...wanted].sort((a, b) => a - b)) {
    const lk = lookups + _u16(t, lookups + 2 + 2 * li)
    const kind = _u16(t, lk)
    const nsub = _u16(t, lk + 4)
    const subtables: _PairPos[] = []
    for (let k = 0; k < nsub; k++) {
      let st = lk + _u16(t, lk + 6 + 2 * k)
      let stKind = kind
      if (kind === 9) {
        // extension
        stKind = _u16(t, st + 2)
        st = st + _u32(t, st + 4)
      }
      if (stKind === 2) subtables.push(new _PairPos(t, st))
    }
    if (subtables.length) out.push(subtables)
  }
  return out
}

const _VALUE_FIELDS = 4 // XPlacement, YPlacement, XAdvance, YAdvance

function _valueRecord(t: Uint8Array, o: number, fmt: number): [_Values, number] {
  const vals: _Values = [0, 0, 0, 0]
  for (let bit = 0; bit < 8; bit++) {
    if (fmt & (1 << bit)) {
      if (bit < _VALUE_FIELDS) vals[bit] = _i16(t, o)
      o += 2
    }
  }
  return [vals, o]
}

function _coverage(t: Uint8Array, o: number): Map<number, number> {
  const fmt = _u16(t, o)
  const out = new Map<number, number>()
  if (fmt === 1) {
    const n = _u16(t, o + 2)
    for (let i = 0; i < n; i++) out.set(_u16(t, o + 4 + 2 * i), i)
  } else if (fmt === 2) {
    const n = _u16(t, o + 2)
    for (let i = 0; i < n; i++) {
      const r = o + 4 + 6 * i
      const start = _u16(t, r)
      const end = _u16(t, r + 2)
      const index = _u16(t, r + 4)
      for (let g = start; g <= end; g++) out.set(g, index + g - start)
    }
  }
  return out
}

function _classDef(t: Uint8Array, o: number): Map<number, number> {
  const fmt = _u16(t, o)
  const out = new Map<number, number>()
  if (fmt === 1) {
    const start = _u16(t, o + 2)
    const count = _u16(t, o + 4)
    for (let i = 0; i < count; i++) out.set(start + i, _u16(t, o + 6 + 2 * i))
  } else if (fmt === 2) {
    const n = _u16(t, o + 2)
    for (let i = 0; i < n; i++) {
      const r = o + 4 + 6 * i
      const start = _u16(t, r)
      const end = _u16(t, r + 2)
      const cls = _u16(t, r + 4)
      for (let g = start; g <= end; g++) out.set(g, cls)
    }
  }
  return out
}

function _bits(v: number): number {
  let n = 0
  for (; v; v >>>= 1) n += v & 1
  return n
}

/** One PairPos subtable, parsed on first use. */
class _PairPos {
  readonly t: Uint8Array
  readonly o: number
  parsed = false
  fmt = 0
  coverage = new Map<number, number>()
  f1 = 0
  f2 = 0
  sets = new Map<number, Map<number, [_Values, _Values]>>()
  setOffsets: number[] = []
  cd1 = new Map<number, number>()
  cd2 = new Map<number, number>()
  c1 = 0
  c2 = 0
  records = 0
  size = 0

  constructor(t: Uint8Array, o: number) {
    this.t = t
    this.o = o
  }

  _parse(): void {
    const t = this.t
    const o = this.o
    this.fmt = _u16(t, o)
    this.coverage = _coverage(t, o + _u16(t, o + 2))
    this.f1 = _u16(t, o + 4)
    this.f2 = _u16(t, o + 6)
    if (this.fmt === 1) {
      this.sets = new Map()
      const n = _u16(t, o + 8)
      this.setOffsets = []
      for (let i = 0; i < n; i++) this.setOffsets.push(o + _u16(t, o + 10 + 2 * i))
    } else if (this.fmt === 2) {
      this.cd1 = _classDef(t, o + _u16(t, o + 8))
      this.cd2 = _classDef(t, o + _u16(t, o + 10))
      this.c1 = _u16(t, o + 12)
      this.c2 = _u16(t, o + 14)
      this.records = o + 16
      this.size = 2 * (_bits(this.f1) + _bits(this.f2))
    }
    this.parsed = true
  }

  _pairSet(index: number): Map<number, [_Values, _Values]> {
    let found = this.sets.get(index)
    if (found === undefined) {
      const t = this.t
      const o = _item(this.setOffsets, index)
      found = new Map()
      let p = o + 2
      const n = _u16(t, o)
      for (let k = 0; k < n; k++) {
        const second = _u16(t, p)
        let v1: _Values
        let v2: _Values
        ;[v1, p] = _valueRecord(t, p + 2, this.f1)
        ;[v2, p] = _valueRecord(t, p, this.f2)
        found.set(second, [v1, v2])
      }
      this.sets.set(index, found)
    }
    return found
  }

  find(left: number, right: number): [_Values, _Values] | null {
    if (!this.parsed) this._parse()
    const index = this.coverage.get(left)
    if (index === undefined) return null
    if (this.fmt === 1) return this._pairSet(index).get(right) ?? null
    if (this.fmt === 2) {
      const a = this.cd1.get(left) ?? 0
      const b = this.cd2.get(right) ?? 0
      if (a >= this.c1 || b >= this.c2) return null
      let r = this.records + (a * this.c2 + b) * this.size
      let v1: _Values
      ;[v1, r] = _valueRecord(this.t, r, this.f1)
      const [v2] = _valueRecord(this.t, r, this.f2)
      return [v1, v2]
    }
    return null
  }
}

// =============================================================================
// Python's semantics where they differ from JavaScript's
// =============================================================================
/** Python's ord(): the code point of a one-character string. */
function _ord(char: string): number {
  const cp = typeof char === 'string' ? char.codePointAt(0) : undefined
  if (cp === undefined || char.length !== (cp > 0xffff ? 2 : 1)) {
    const n = typeof char === 'string' ? [...char].length : 0
    throw new TypeError(`ord() expected a character, but string of length ${n} found`)
  }
  return cp
}

// Python's float() of a string: decimal literals with optional underscores between digits,
// inf, infinity and nan; anything else is a ValueError.
const _FLOAT_RE = /^[+-]?(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?$/
const _SPECIAL_RE = /^([+-]?)(inf|infinity|nan)$/i

function _float(text: string): number {
  const s = text.trim()
  if (_FLOAT_RE.test(s)) return Number(s.replaceAll('_', ''))
  const m = _SPECIAL_RE.exec(s)
  if (m) return m[2].toLowerCase() === 'nan' ? Number.NaN : m[1] === '-' ? -Infinity : Infinity
  throw new RangeError(`could not convert string to float: ${_repr(text)}`)
}

// characters str.isprintable() rejects (other than the space)
const _UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u

/** Python's repr() of a string. */
export function _repr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'"
  let out = quote
  for (const c of s) {
    const cp = c.codePointAt(0) as number
    if (c === quote || c === '\\') out += `\\${c}`
    else if (c === '\n') out += '\\n'
    else if (c === '\r') out += '\\r'
    else if (c === '\t') out += '\\t'
    else if (c !== ' ' && (cp < 0x20 || cp === 0x7f || _UNPRINTABLE.test(c))) {
      if (cp <= 0xff) out += `\\x${cp.toString(16).padStart(2, '0')}`
      else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`
      else out += `\\U${cp.toString(16).padStart(8, '0')}`
    } else out += c
  }
  return out + quote
}

function _typeName(x: unknown): string {
  if (x === null || x === undefined) return String(x)
  if (typeof x === 'object' || typeof x === 'function') return (x as { constructor?: { name?: string } }).constructor?.name ?? 'object'
  return typeof x
}

function _stem(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function _fromBase64(text: string): Uint8Array {
  const bin = atob(text) // (whitespace is ignored)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// =============================================================================
// Node's modules, without a static import (bundlers for the browser do not see them)
// =============================================================================
function _builtin(name: string): Any {
  const proc = (globalThis as Any).process
  return typeof proc?.getBuiltinModule === 'function' ? proc.getBuiltinModule(name) : undefined
}

function _fs(what: string): Any {
  const fs = _builtin('node:fs')
  if (!fs) throw new Error(`${what} needs Node.js (22.3 or later); elsewhere pass the font file's bytes (a Uint8Array)`)
  return fs
}

/** Python's Path.expanduser(): a leading ~ is the home directory. */
function _expandUser(p: string): string {
  if (p !== '~' && !p.startsWith('~/')) return p
  const home = _builtin('node:os')?.homedir()
  return home ? home + p.slice(1) : p
}

/** Python's FileNotFoundError: an Error with `code` "ENOENT", as Node's file functions throw. */
function _notFound(message: string, path: string): Error {
  const e = new Error(message) as Error & { code: string; path: string }
  e.code = 'ENOENT'
  e.path = path
  return e
}
