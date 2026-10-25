// Brotli decompression (RFC 7932), for the compressed tables of WOFF2 fonts.
//
// A decoder after RFC 7932 and Google's reference decoder (github.com/google/brotli, MIT license),
// without dependencies, synchronous, the same in Node and in browsers; smlibpy's _brotli.py is the
// same decoder. The static dictionary of RFC 7932 (appendix A) is _brotli_dictionary.ts.
//
// Prefix codes decode through a table of their first 8 bits and second-level tables for longer
// codes, as in the reference decoder. The whole output stays in memory, so backward distances need
// no ring buffer: a distance beyond the bytes written so far, or beyond the window, refers to the
// dictionary.

import { BROTLI_DICTIONARY } from './_brotli_dictionary.ts'
import { _Bits, type _Code, _Output, _prefixCode, _single, inflate } from './_inflate.ts'

/** The data is no valid Brotli stream (Python's BrotliError, a ValueError). */
export class BrotliError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'BrotliError'
  }
}

const _DICTIONARY_SIZE = 122784

// Words of each length (4..24) in the dictionary: 2 ** bits of them, one after the other.
const _WORD_BITS = [0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5]
const _WORD_OFFSETS: number[] = new Array(26).fill(0)
for (let n = 4; n <= 24; n++) _WORD_OFFSETS[n + 1] = _WORD_OFFSETS[n] + (n << _WORD_BITS[n])

// The prefixes and suffixes of the dictionary's transforms, and the 121 transforms as (prefix,
// type, suffix). Types: 0 the word, 1..9 without its last 1..9 bytes, 10 its first character
// uppercased, 11 all uppercased, 12..20 without its first 1..9 bytes.
const _AFFIXES: Uint8Array[] = [
  ' ', ', ', ' of the ', ' of ', 's ', '.', ' and ', ' in ', '"', ' to ', '">', '\n', '. ', ']', ' for ', ' a ',
  ' that ', "'", ' with ', ' from ', ' by ', '(', '. The ', ' on ', ' as ', ' is ', 'ing ', '\n\t', ':', 'ed ', '="',
  ' at ', 'ly ', ',', "='", '.com/', '. This ', ' not ', 'er ', 'al ', 'ful ', 'ive ', 'less ', 'est ', 'ize ',
  ' ', 'ous ', ' the ', 'e ', '',
].map((s) => new TextEncoder().encode(s))
// biome-ignore format: a table
const _TRANSFORMS = [
  49, 0, 49, 49, 0, 0, 0, 0, 0, 49, 12, 49, 49, 10, 0, 49, 0, 47, 0, 0, 49, 4, 0, 0, 49, 0, 3, 49, 10, 49, 49, 0,
  6, 49, 13, 49, 49, 1, 49, 1, 0, 0, 49, 0, 1, 0, 10, 0, 49, 0, 7, 49, 0, 9, 48, 0, 0, 49, 0, 8, 49, 0, 5, 49, 0,
  10, 49, 0, 11, 49, 3, 49, 49, 0, 13, 49, 0, 14, 49, 14, 49, 49, 2, 49, 49, 0, 15, 49, 0, 16, 0, 10, 49, 49, 0,
  12, 5, 0, 49, 0, 0, 1, 49, 15, 49, 49, 0, 18, 49, 0, 17, 49, 0, 19, 49, 0, 20, 49, 16, 49, 49, 17, 49, 47, 0,
  49, 49, 4, 49, 49, 0, 22, 49, 11, 49, 49, 0, 23, 49, 0, 24, 49, 0, 25, 49, 7, 49, 49, 1, 26, 49, 0, 27, 49, 0,
  28, 0, 0, 12, 49, 0, 29, 49, 20, 49, 49, 18, 49, 49, 6, 49, 49, 0, 21, 49, 10, 1, 49, 8, 49, 49, 0, 31, 49, 0,
  32, 47, 0, 3, 49, 5, 49, 49, 9, 49, 0, 10, 1, 49, 10, 8, 5, 0, 21, 49, 11, 0, 49, 10, 10, 49, 0, 30, 0, 0, 5,
  35, 0, 49, 47, 0, 2, 49, 10, 17, 49, 0, 36, 49, 0, 33, 5, 0, 0, 49, 10, 21, 49, 10, 5, 49, 0, 37, 0, 0, 30, 49,
  0, 38, 0, 11, 0, 49, 0, 39, 0, 11, 49, 49, 0, 34, 49, 11, 8, 49, 10, 12, 0, 0, 21, 49, 0, 40, 0, 10, 12, 49, 0,
  41, 49, 0, 42, 49, 11, 17, 49, 0, 43, 0, 10, 5, 49, 11, 10, 0, 0, 34, 49, 10, 33, 49, 0, 44, 49, 11, 5, 45, 0,
  49, 0, 0, 33, 49, 10, 30, 49, 11, 30, 49, 0, 46, 49, 11, 1, 49, 10, 34, 0, 10, 33, 0, 11, 30, 0, 11, 1, 49, 11,
  33, 49, 11, 21, 49, 11, 12, 0, 11, 5, 49, 11, 34, 0, 11, 12, 0, 10, 30, 0, 11, 34, 0, 10, 34,
]

// Extra bits of the block length codes, insert length codes and copy length codes; each code's
// range starts where the one before it ends.
const _BLOCK_BITS = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 24]
const _INSERT_BITS = [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24]
const _COPY_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24]

function _starts(bits: readonly number[], first: number): number[] {
  const out = [first]
  for (let i = 0; i < bits.length - 1; i++) out.push(out[i] + 2 ** bits[i])
  return out
}

const _BLOCK_BASE = _starts(_BLOCK_BITS, 1)
const _INSERT_BASE = _starts(_INSERT_BITS, 0)
const _COPY_BASE = _starts(_COPY_BITS, 2)
// The insert and copy length codes that start each of the 11 cells of 64 commands (RFC 7932,
// section 5); the commands of the first two cells reuse the last distance.
const _CELL_INSERT = [0, 0, 0, 0, 8, 8, 0, 16, 8, 16, 16]
const _CELL_COPY = [0, 8, 0, 8, 0, 8, 16, 0, 16, 8, 16]

/** Per command, five numbers: insert base and extra bits, copy base and extra bits, and the
 * context of its distance (-1: the command reuses the last distance). */
const _COMMANDS: Int32Array = (() => {
  const out = new Int32Array(704 * 5)
  for (let cmd = 0; cmd < 704; cmd++) {
    const cell = cmd >> 6
    const ins = _CELL_INSERT[cell] + ((cmd >> 3) & 7)
    const cop = _CELL_COPY[cell] + (cmd & 7)
    out.set([_INSERT_BASE[ins], _INSERT_BITS[ins], _COPY_BASE[cop], _COPY_BITS[cop], cell < 2 ? -1 : Math.min(cop, 3)], cmd * 5)
  }
  return out
})()

// The context of a literal from the two bytes before it (RFC 7932, section 7.1). The UTF-8 mode's
// values for the last byte (in fours) and for the one before it, below 128:
const _UTF8_LAST =
  '000000000110010000000000000000002343353467338393bbbbbbbbbb886a733cdddcdddcdddddcdddddcddddd637333efffefffefffffefffffefffff63730'
const _UTF8_BEFORE =
  '00000000000000000000000000000000011111111111111122222222221111111222222222222222222222222221111113333333333333333333333333311110'

/** Per context mode (LSB6, MSB6, UTF8, signed): the values of the last byte (the first 256) and of
 * the one before it (the next 256); a literal's context is the two ORed. */
const _CONTEXTS: Uint8Array[] = (() => {
  const signed = (i: number) => (i === 0 ? 0 : i < 16 ? 1 : i < 64 ? 2 : i < 128 ? 3 : i < 192 ? 4 : i < 240 ? 5 : i < 255 ? 6 : 7)
  const modes = [new Uint8Array(512), new Uint8Array(512), new Uint8Array(512), new Uint8Array(512)]
  for (let i = 0; i < 256; i++) {
    modes[0][i] = i & 63
    modes[1][i] = i >> 2
    modes[2][i] = i < 128 ? Number.parseInt(_UTF8_LAST[i], 16) * 4 : i < 192 ? i & 1 : 2 | (i & 1)
    modes[2][256 + i] = i < 128 ? Number(_UTF8_BEFORE[i]) : i < 224 ? 0 : 2
    modes[3][i] = signed(i) << 3
    modes[3][256 + i] = signed(i)
  }
  return modes
})()

// The code lengths of a prefix code's code lengths come in this order, each read with a fixed
// code of 2 to 4 bits (the value and the size of each 4-bit pattern)
const _CODE_LENGTH_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15]
const _CODE_LENGTH_BITS = [2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 4]
const _CODE_LENGTH_VALUE = [0, 4, 3, 2, 0, 4, 3, 1, 0, 4, 3, 2, 0, 4, 3, 5]

let _dictionary: Uint8Array | null = null

/** The dictionary (unpacked once). */
export function _words(): Uint8Array {
  if (_dictionary === null) {
    const bin = atob(BROTLI_DICTIONARY) // (whitespace is ignored)
    const z = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) z[i] = bin.charCodeAt(i)
    const d = inflate(z)
    if (d.length !== _DICTIONARY_SIZE) throw new BrotliError('the dictionary is damaged')
    _dictionary = d
  }
  return _dictionary
}

/** The bytes a Brotli stream (RFC 7932) holds. Throws a BrotliError for invalid data. */
export function decompress(data: Uint8Array): Uint8Array {
  const decoder = new _Decoder(data)
  try {
    return decoder.run()
  } catch (e) {
    // (past its end, the data reads as zeros: what fails then is that it ends)
    if (e instanceof BrotliError && decoder.br.overrun()) throw new BrotliError('the data ends early')
    throw e
  }
}

// =============================================================================
// The decoder
// =============================================================================
class _Decoder {
  br: _Bits
  out: _Output

  constructor(data: Uint8Array) {
    this.br = new _Bits(data)
    this.out = new _Output(data.length * 4)
  }

  byteBoundary(): void {
    if (this.br.byteBoundary()) throw new BrotliError('padding bits that are not zero')
    if (this.br.pos > this.br.data.length) throw new BrotliError('the data ends early')
  }

  varUint8(): number {
    const br = this.br
    if (!br.bits(1)) return 0
    const n = br.bits(3)
    return n === 0 ? 1 : (1 << n) + br.bits(n)
  }

  prefixCode(alphabet: number): _Code {
    const br = this.br
    const lengths = new Uint8Array(alphabet)
    const kind = br.bits(2)
    if (kind === 1) {
      // simple: 1 to 4 symbols
      const n = br.bits(2) + 1
      const width = 32 - Math.clz32(alphabet - 1)
      const symbols: number[] = []
      for (let i = 0; i < n; i++) symbols.push(br.bits(width))
      if (symbols.some((s) => s >= alphabet) || new Set(symbols).size !== n) {
        throw new BrotliError('a simple prefix code with invalid symbols')
      }
      if (n === 1) return _single(symbols[0])
      let sizes = n === 2 ? [1, 1] : n === 3 ? [1, 2, 2] : [2, 2, 2, 2]
      if (n === 4 && br.bits(1)) sizes = [1, 2, 3, 3]
      for (let i = 0; i < n; i++) lengths[symbols[i]] = sizes[i]
      return _prefixCode(lengths)
    }
    // complex: the code lengths, prefix coded themselves (`kind` of them skipped)
    const clLengths = new Uint8Array(18)
    let space = 32
    let count = 0
    for (let i = kind; i < 18; i++) {
      if (br.n < 4) br.fill()
      const ix = br.val & 15
      br.bits(_CODE_LENGTH_BITS[ix])
      const v = _CODE_LENGTH_VALUE[ix]
      clLengths[_CODE_LENGTH_ORDER[i]] = v
      if (v) {
        space -= 32 >> v
        count++
        if (space <= 0) break
      }
    }
    if (!(count === 1 || space === 0)) throw new BrotliError('an incomplete code of code lengths')
    const clCode = count === 1 ? _single(clLengths.findIndex((n) => n !== 0)) : _prefixCode(clLengths)
    let symbol = 0
    let prev = 8
    let repeat = 0
    let repeatLen = 0
    space = 32768
    while (symbol < alphabet && space > 0) {
      const n = br.symbol(clCode)
      if (n < 16) {
        repeat = 0
        lengths[symbol] = n
        if (n) {
          prev = n
          space -= 32768 >> n
        }
        symbol++
      } else {
        // 16: repeat the last length, 17: repeat zero
        const extra = n === 16 ? 2 : 3
        const newLen = n === 16 ? prev : 0
        if (repeatLen !== newLen) {
          repeat = 0
          repeatLen = newLen
        }
        const old = repeat
        if (repeat > 0) repeat = (repeat - 2) << extra
        repeat += br.bits(extra) + 3
        const delta = repeat - old
        if (symbol + delta > alphabet) throw new BrotliError('code lengths past the end of the alphabet')
        lengths.fill(repeatLen, symbol, symbol + delta)
        symbol += delta
        if (repeatLen) space -= delta << (15 - repeatLen)
      }
    }
    if (space !== 0) throw new BrotliError('an incomplete prefix code')
    return _prefixCode(lengths)
  }

  blockLength(code: _Code): number {
    const c = this.br.symbol(code)
    return _BLOCK_BASE[c] + this.br.bits(_BLOCK_BITS[c])
  }

  contextMap(size: number): [Uint8Array, number] {
    const br = this.br
    const trees = this.varUint8() + 1
    const out = new Uint8Array(size)
    if (trees < 2) return [out, trees]
    const rle = br.bits(1) ? br.bits(4) + 1 : 0
    const code = this.prefixCode(trees + rle)
    let i = 0
    while (i < size) {
      const c = br.symbol(code)
      if (c === 0) {
        out[i++] = 0
      } else if (c <= rle) {
        // a run of zeros
        const reps = (1 << c) + br.bits(c)
        if (i + reps > size) throw new BrotliError('a context map that runs past its end')
        i += reps
      } else {
        out[i++] = c - rle
      }
    }
    if (br.bits(1)) {
      // inverse move-to-front
      const mtf: number[] = []
      for (let k = 0; k < 256; k++) mtf.push(k)
      for (let k = 0; k < size; k++) {
        const v = out[k]
        const value = mtf[v]
        out[k] = value
        if (v) {
          mtf.splice(v, 1)
          mtf.unshift(value)
        }
      }
    }
    return [out, trees]
  }

  run(): Uint8Array {
    const br = this.br
    let wbits: number
    if (br.bits(1) === 0) {
      wbits = 16
    } else {
      let n = br.bits(3)
      if (n) {
        wbits = 17 + n
      } else {
        n = br.bits(3)
        if (n === 1) throw new BrotliError('an invalid window size')
        wbits = n ? 8 + n : 17
      }
    }
    const window = 2 ** wbits - 16
    const distances = [16, 15, 11, 4] // the last four distances, the latest last
    for (;;) {
      const last = br.bits(1)
      if (last && br.bits(1)) break // the empty last meta-block
      const nibbles = br.bits(2) + 4
      if (nibbles === 7) {
        // metadata, skipped
        if (br.bits(1)) throw new BrotliError('a reserved bit that is set')
        const nbytes = br.bits(2)
        let skip = 0
        for (let i = 0; i < nbytes; i++) {
          const b = br.bits(8)
          if (i + 1 === nbytes && nbytes > 1 && b === 0) throw new BrotliError('an invalid length of metadata')
          skip += b * 2 ** (8 * i)
        }
        this.byteBoundary()
        br.pos += nbytes ? skip + 1 : 0
        if (br.pos > br.data.length) throw new BrotliError('the data ends early')
        if (last) break
        continue
      }
      let length = 0
      for (let i = 0; i < nibbles; i++) {
        const b = br.bits(4)
        if (i + 1 === nibbles && nibbles > 4 && b === 0) throw new BrotliError('an invalid length of a meta-block')
        length += b * 2 ** (4 * i)
      }
      length += 1
      if (!last && br.bits(1)) {
        // stored
        this.byteBoundary()
        if (br.pos + length > br.data.length) throw new BrotliError('the data ends early')
        this.out.append(br.data.subarray(br.pos, br.pos + length))
        br.pos += length
        continue
      }
      this.metaBlock(length, window, distances)
      if (last) break
    }
    this.byteBoundary()
    return this.out.buf.slice(0, this.out.length)
  }

  metaBlock(length: number, window: number, distances: number[]): void {
    const br = this.br
    // block types and block counts of literals (0), commands (1) and distances (2)
    const ntypes: number[] = []
    const typeCodes: (_Code | null)[] = []
    const countCodes: (_Code | null)[] = []
    const counts: number[] = []
    for (let k = 0; k < 3; k++) {
      const n = this.varUint8() + 1
      ntypes.push(n)
      if (n >= 2) {
        typeCodes.push(this.prefixCode(n + 2))
        const cc = this.prefixCode(26)
        countCodes.push(cc)
        counts.push(this.blockLength(cc))
      } else {
        typeCodes.push(null)
        countCodes.push(null)
        counts.push(1 << 24)
      }
    }
    const npostfix = br.bits(2)
    const ndirect = br.bits(4) << npostfix
    const modes: number[] = []
    for (let i = 0; i < ntypes[0]; i++) modes.push(br.bits(2))
    const [litMap, litTrees] = this.contextMap(ntypes[0] << 6)
    const [distMap, distTrees] = this.contextMap(ntypes[2] << 2)
    const litCodes: _Code[] = []
    for (let i = 0; i < litTrees; i++) litCodes.push(this.prefixCode(256))
    const cmdCodes: _Code[] = []
    for (let i = 0; i < ntypes[1]; i++) cmdCodes.push(this.prefixCode(704))
    const distCodes: _Code[] = []
    for (let i = 0; i < distTrees; i++) distCodes.push(this.prefixCode(16 + ndirect + (48 << npostfix)))
    const rings = [
      [1, 0],
      [1, 0],
      [1, 0],
    ] // the block types before the last, and the last

    const change = (k: number): number => {
      const ring = rings[k]
      let t = br.symbol(typeCodes[k] as _Code)
      t = t === 0 ? ring[0] : t === 1 ? ring[1] + 1 : t - 2
      if (t >= ntypes[k]) t -= ntypes[k]
      ring[0] = ring[1]
      ring[1] = t
      counts[k] = this.blockLength(countCodes[k] as _Code)
      return t
    }

    const out = this.out
    let cmdType = 0
    let distType = 0
    // the literals' block type: its trees by context, its one tree when all are the same, and the
    // context values of its mode
    let trees = litMap.subarray(0, 64)
    let one: _Code | null = null
    let lut = _CONTEXTS[modes[0]]
    const literalType = (t: number) => {
      trees = litMap.subarray(t << 6, (t + 1) << 6)
      one = trees.every((v) => v === trees[0]) ? litCodes[trees[0]] : null
      lut = _CONTEXTS[modes[t]]
    }
    literalType(0)
    const postfixMask = (1 << npostfix) - 1
    let remaining = length
    while (remaining > 0) {
      if (counts[1] === 0) cmdType = change(1)
      counts[1]--
      const c = br.symbol(cmdCodes[cmdType]) * 5
      const insert = _COMMANDS[c] + (_COMMANDS[c + 1] ? br.bits(_COMMANDS[c + 1]) : 0)
      const copy = _COMMANDS[c + 2] + (_COMMANDS[c + 3] ? br.bits(_COMMANDS[c + 3]) : 0)
      const distCtx = _COMMANDS[c + 4]
      if (insert > remaining) throw new BrotliError('a meta-block longer than its length')
      remaining -= insert
      out.reserve(insert)
      for (let i = 0; i < insert; i++) {
        if (counts[0] === 0) literalType(change(0))
        counts[0]--
        const b = out.buf
        const n = out.length
        if (one !== null) {
          b[n] = br.symbol(one)
        } else {
          const p1 = n > 0 ? b[n - 1] : 0
          const p2 = n > 1 ? b[n - 2] : 0
          b[n] = br.symbol(litCodes[trees[lut[p1] | lut[256 + p2]]])
        }
        out.length = n + 1
      }
      if (remaining <= 0) break
      // the distance
      let code: number
      let distance: number
      if (distCtx < 0) {
        code = 0
        distance = distances[3]
      } else {
        if (counts[2] === 0) distType = change(2)
        counts[2]--
        code = br.symbol(distCodes[distMap[(distType << 2) + distCtx]])
        if (code < 4) {
          distance = distances[3 - code]
        } else if (code < 16) {
          const base = code < 10 ? distances[3] : distances[2]
          distance = base + [-1, 1, -2, 2, -3, 3][(code - 4) % 6]
          if (distance <= 0) throw new BrotliError('an invalid distance')
        } else if (code < 16 + ndirect) {
          distance = code - 15
        } else {
          const x = code - ndirect - 16
          const nbits = 1 + (x >> (npostfix + 1))
          const offset = ((2 + ((x >> npostfix) & 1)) << nbits) - 4
          distance = (offset + br.bits(nbits)) * 2 ** npostfix + (x & postfixMask) + ndirect + 1
        }
      }
      const maxDistance = Math.min(out.length, window)
      if (distance > maxDistance) {
        // a word of the dictionary
        if (copy < 4 || copy > 24) throw new BrotliError('a distance past the start of the data')
        const address = distance - maxDistance - 1
        const bits = _WORD_BITS[copy]
        const transform = Math.floor(address / 2 ** bits)
        if (transform >= 121) throw new BrotliError('an invalid reference to the dictionary')
        const start = _WORD_OFFSETS[copy] + (address % 2 ** bits) * copy
        const word = _transform(_words().subarray(start, start + copy), transform)
        if (word.length === 0 && distance <= 120) throw new BrotliError('an empty word of the dictionary')
        out.append(word)
        remaining -= word.length
      } else {
        if (copy > remaining) throw new BrotliError('a meta-block longer than its length')
        if (code !== 0) {
          distances.shift()
          distances.push(distance)
        }
        out.copy(distance, copy)
        remaining -= copy
      }
    }
    if (remaining < 0) throw new BrotliError('a meta-block longer than its length')
    if (br.overrun()) throw new BrotliError('the data ends early')
  }
}

function _transform(word: Uint8Array, index: number): Uint8Array {
  const prefix = _AFFIXES[_TRANSFORMS[3 * index]]
  const kind = _TRANSFORMS[3 * index + 1]
  const suffix = _AFFIXES[_TRANSFORMS[3 * index + 2]]
  let w = word.slice()
  if (kind >= 1 && kind <= 9) {
    w = w.subarray(0, Math.max(0, w.length - kind))
  } else if (kind >= 12 && kind <= 20) {
    w = w.subarray(Math.min(w.length, kind - 11))
  } else if (kind === 10 || kind === 11) {
    // (the reference's simplified UTF-8 uppercasing; a lead byte also changes the bytes after it,
    // past the word too, which are dropped)
    const n = w.length
    const p = new Uint8Array(n + 2)
    p.set(w)
    for (let i = 0; i < n; ) {
      const c = p[i]
      if (c < 0xc0) {
        if (c >= 97 && c <= 122) p[i] ^= 32
        i += 1
      } else if (c < 0xe0) {
        p[i + 1] ^= 32
        i += 2
      } else {
        p[i + 2] ^= 5
        i += 3
      }
      if (kind === 10) break
    }
    w = p.subarray(0, n)
  }
  const out = new Uint8Array(prefix.length + w.length + suffix.length)
  out.set(prefix)
  out.set(w, prefix.length)
  out.set(suffix, prefix.length + w.length)
  return out
}
