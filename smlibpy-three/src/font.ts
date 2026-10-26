// Fonts: the TrueType and OpenType fonts Text draws with (TTF, OTF, TTC, WOFF, WOFF2), read without
// other packages: their characters, metrics, kerning and exact glyph outlines. A font comes as the
// bytes of its file (an ArrayBuffer or a view of one, as `await (await fetch(url)).arrayBuffer()`
// gives it), or as a file's path in Node. Outlines are in font units, y up, as THREE.Vector2s.
import * as THREE from 'three'
import { FontError } from './errors.ts'
import { call, describe, sm } from './kernel.ts'

export { FontError }

/** A font file: its bytes (an ArrayBuffer, a Uint8Array or another view of an ArrayBuffer), or its
 * path in Node. */
export type FontSource = string | ArrayBuffer | ArrayBufferView

/**
 * Kerning of two neighbouring glyphs, in font units: the first glyph's advance changes by
 * `advance1` and it moves by `placement1`; the second moves by `placement2` and its advance changes
 * by `advance2`.
 */
export interface PairAdjustment {
  readonly advance1: number
  readonly placement1: number
  readonly advance2: number
  readonly placement2: number
}

/**
 * A closed outline of a glyph: its segments end to end (the last ends where the first starts),
 * each 2 points (a line), 3 (a quadratic Bézier: its control points) or 4 (a cubic Bézier), in font
 * units with y up, as a sketch's 2D coordinates are.
 */
export type Contour = THREE.Vector2[][]

/**
 * The bytes of the font Text uses unless told otherwise: Lato Regular (SIL Open Font License 1.1),
 * a TTF file built in, so text needs no file. `loadFont()` reads it.
 */
export const DEFAULT_FONT: Uint8Array = sm.DEFAULT_FONT

// (the kernel's font for a font made by loadFont, which takes it from the kernel's cache)
let incoming: sm.Font | null = null
const fonts = new WeakMap<sm.Font, OpenTypeFont>()
let kernelOf: (font: OpenTypeFont) => sm.Font

/**
 * One font: its characters, metrics, kerning and glyph outlines (font units, y up). Read once with
 * `loadFont(bytes)`, or made with `new OpenTypeFont(bytes)`; give it to Text as `font`. (smlibpy's
 * Font; three's FontLoader gives a Font of its own, of typeface JSON.)
 */
export class OpenTypeFont {
  readonly #font: sm.Font
  /** The font file's path, for a font read from a file (Node); null for one read from bytes. */
  readonly path: string | null
  /** The full name of the font ("Lato Regular"). */
  readonly name: string
  /** The font units in an em (the size the outlines are drawn at). */
  readonly unitsPerEm: number
  readonly numGlyphs: number
  /** The height of the capital letters in font units (the font's own, or the top of its H): Text's
   * `size` is this height. */
  readonly capHeight: number

  static {
    kernelOf = (font) => font.#font
  }

  /** Reads the font of a file's bytes (or, in Node, of a file's path; default the built-in font's
   * bytes); a FontError if they are no font it can use. */
  constructor(source: FontSource = DEFAULT_FONT) {
    const font = incoming ?? call(() => new sm.Font(kernelSource(source, 'OpenTypeFont')))
    this.#font = font
    this.path = font.path
    this.name = font.name
    this.unitsPerEm = font.unitsPerEm
    this.numGlyphs = font.numGlyphs
    this.capHeight = font.capHeight
  }

  /** The glyph of a character, or null when the font has none for it. */
  glyphIndex(char: string): number | null {
    const f = this.#font
    return call(() => f.glyphIndex(char))
  }

  /** Every character the font has a glyph for. */
  characters(): string[] {
    const f = this.#font
    return call(() => f.characters())
  }

  /** The advance width of a glyph, in font units. */
  advance(glyph: number): number {
    const f = this.#font
    return call(() => f.advance(glyph))
  }

  /** The kerning of two neighbouring glyphs (the font's GPOS pair adjustments, else its kern table). */
  kerning(left: number, right: number): PairAdjustment {
    const f = this.#font
    const k = call(() => f.kerning(left, right))
    return { advance1: k.advance1, placement1: k.placement1, advance2: k.advance2, placement2: k.placement2 }
  }

  /** Where `kerning` takes its values from: "GPOS", "kern" or null (none). */
  get kerningSource(): string | null {
    const f = this.#font
    return call(() => f.kerningSource)
  }

  /** The closed outlines of a glyph (none for a space), in font units with y up. */
  outline(glyph: number): Contour[] {
    const f = this.#font
    return call(() => f.outline(glyph)).map((contour) => contour.map((segment) => segment.map(([x, y]) => new THREE.Vector2(x, y))))
  }

  toString(): string {
    return `OpenTypeFont(${JSON.stringify(this.name)}, ${this.numGlyphs} glyphs, ${this.unitsPerEm} units per em)`
  }
}

/**
 * The font of a file's bytes (or, in Node, of a file's path), read once and kept: the same bytes
 * give the same OpenTypeFont. Without a source, the built-in default (`DEFAULT_FONT`).
 */
export function loadFont(source: FontSource | null = null): OpenTypeFont {
  const k = call(() => sm.loadFont(source === null ? null : kernelSource(source, 'loadFont')))
  let font = fonts.get(k)
  if (font === undefined) {
    incoming = k
    try {
      font = new OpenTypeFont()
    } finally {
      incoming = null
    }
    fonts.set(k, font)
  }
  return font
}

/** @internal
 * The kernel's font of an OpenTypeFont. */
export function kernelFont(font: OpenTypeFont): sm.Font {
  return kernelOf(font)
}

/** A font source as the kernel takes it (the bytes themselves, not a copy: its cache knows them). */
function kernelSource(source: unknown, what: string): string | ArrayBuffer | ArrayBufferView {
  if (typeof source === 'string' || source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source
  throw new TypeError(`${what}: a font is a font file's bytes (an ArrayBuffer or a Uint8Array) or, in Node, its path; not ${describe(source)}`)
}
