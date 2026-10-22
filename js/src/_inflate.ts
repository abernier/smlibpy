// zlib decompression (RFC 1950 and 1951): the compressed tables of WOFF fonts and the Brotli
// dictionary. Synchronous, the same in Node and in browsers (which have no synchronous inflate);
// Python reads them with its zlib module, which this matches, errors included.
//
// Also the bits and prefix codes _brotli.ts decodes with: deflate's and Brotli's prefix codes are
// the same kind of canonical code, read from the first bit of each byte on.

/** The data is no valid zlib stream (Python's zlib.error). */
export class ZlibError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZlibError'
  }
}

/** The bytes a zlib stream holds (Python's zlib.decompress). Throws a ZlibError for invalid data. */
export function inflate(data: Uint8Array): Uint8Array {
  if (data.length < 2) throw new ZlibError('incomplete or truncated stream')
  const cmf = data[0]
  const flg = data[1]
  if ((cmf & 15) !== 8 || cmf >> 4 > 7) throw new ZlibError('incorrect header check')
  if (((cmf << 8) | flg) % 31 !== 0) throw new ZlibError('incorrect header check')
  if (flg & 32) throw new ZlibError('a stream that needs a preset dictionary')
  const br = new _Bits(data)
  br.pos = 2
  const out = new _Output(data.length * 4)
  for (;;) {
    const final = br.bits(1)
    const type = br.bits(2)
    if (type === 0) {
      // stored
      br.byteBoundary()
      if (br.pos + 4 > data.length) throw new ZlibError('incomplete or truncated stream')
      const len = data[br.pos] | (data[br.pos + 1] << 8)
      const nlen = data[br.pos + 2] | (data[br.pos + 3] << 8)
      if (len !== (~nlen & 0xffff)) throw new ZlibError('invalid stored block lengths')
      br.pos += 4
      if (br.pos + len > data.length) throw new ZlibError('incomplete or truncated stream')
      out.append(data.subarray(br.pos, br.pos + len))
      br.pos += len
    } else if (type === 1) {
      _block(br, out, _fixedCodes())
    } else if (type === 2) {
      _block(br, out, _dynamicCodes(br))
    } else {
      throw new ZlibError('invalid block type')
    }
    if (br.overrun()) throw new ZlibError('incomplete or truncated stream')
    if (final) break
  }
  br.byteBoundary()
  if (br.pos + 4 > data.length) throw new ZlibError('incomplete or truncated stream')
  const p = br.pos
  const adler = ((data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3]) >>> 0
  const result = out.buf.slice(0, out.length)
  if (_adler32(result) !== adler) throw new ZlibError('incorrect data check')
  return result
}

const _LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const _LENGTH_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const _DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577,
]
const _DIST_BITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const _CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

let _fixed: [_Code, _Code] | null = null

function _fixedCodes(): [_Code, _Code] {
  if (_fixed === null) {
    const lit = new Uint8Array(288)
    lit.fill(8, 0, 144)
    lit.fill(9, 144, 256)
    lit.fill(7, 256, 280)
    lit.fill(8, 280, 288)
    _fixed = [_deflateCode(lit, false), _deflateCode(new Uint8Array(32).fill(5), true)] // (codes 30 and 31 are invalid)
  }
  return _fixed
}

function _dynamicCodes(br: _Bits): [_Code, _Code] {
  const hlit = br.bits(5) + 257
  const hdist = br.bits(5) + 1
  const hclen = br.bits(4) + 4
  if (hlit > 286 || hdist > 30) throw new ZlibError('too many length or distance symbols')
  const cl = new Uint8Array(19)
  for (let i = 0; i < hclen; i++) cl[_CL_ORDER[i]] = br.bits(3)
  const clCode = _deflateCode(cl, false, true)
  const lengths = new Uint8Array(hlit + hdist)
  for (let i = 0; i < lengths.length; ) {
    const sym = br.symbol(clCode)
    if (sym < 16) {
      lengths[i++] = sym
      continue
    }
    let value = 0
    let reps: number
    if (sym === 16) {
      if (i === 0) throw new ZlibError('invalid bit length repeat')
      value = lengths[i - 1]
      reps = 3 + br.bits(2)
    } else if (sym === 17) {
      reps = 3 + br.bits(3)
    } else {
      reps = 11 + br.bits(7)
    }
    if (i + reps > lengths.length) throw new ZlibError('invalid bit length repeat')
    lengths.fill(value, i, i + reps)
    i += reps
  }
  if (lengths[256] === 0) throw new ZlibError('invalid code -- missing end-of-block')
  return [_deflateCode(lengths.subarray(0, hlit), false), _deflateCode(lengths.subarray(hlit), true)]
}

/** A prefix code of deflate: over-subscribed codes are invalid; incomplete ones only when they
 * have a single code of one bit (zlib's rule), or for distances none. */
function _deflateCode(lengths: Uint8Array, distances: boolean, codeLengths = false): _Code {
  const count = new Int32Array(16)
  for (const n of lengths) count[n]++
  let left = 1
  let max = 0
  for (let n = 1; n < 16; n++) {
    left = (left << 1) - count[n]
    if (left < 0) throw new ZlibError(codeLengths ? 'invalid code lengths set' : distances ? 'invalid distances set' : 'invalid literal/lengths set')
    if (count[n]) max = n
  }
  if (max === 0) return { table: Int32Array.of(-1), rootBits: 0 } // (no codes: any use is invalid)
  if (left > 0 && (codeLengths || max !== 1)) {
    throw new ZlibError(codeLengths ? 'invalid code lengths set' : distances ? 'invalid distances set' : 'invalid literal/lengths set')
  }
  return _prefixCode(lengths)
}

function _block(br: _Bits, out: _Output, [lit, dist]: [_Code, _Code]): void {
  for (;;) {
    const sym = br.symbol(lit)
    if (sym < 256) {
      out.push(sym)
    } else if (sym === 256) {
      return
    } else {
      const li = sym - 257
      if (li >= 29) throw new ZlibError('invalid literal/length code')
      const length = _LENGTH_BASE[li] + br.bits(_LENGTH_BITS[li])
      const di = br.symbol(dist)
      if (di >= 30) throw new ZlibError('invalid distance code')
      const distance = _DIST_BASE[di] + br.bits(_DIST_BITS[di])
      if (distance > out.length) throw new ZlibError('invalid distance too far back')
      out.copy(distance, length)
    }
    if (br.overrun()) throw new ZlibError('incomplete or truncated stream')
  }
}

function _adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; ) {
    const end = Math.min(i + 3800, data.length) // (no overflow before the modulo)
    for (; i < end; i++) {
      a += data[i]
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

// =============================================================================
// Bits and prefix codes (also Brotli's)
// =============================================================================
/** A prefix code's decoding table: the root table of `rootBits` bits, then the second-level
 * tables. An entry is `symbol << 5 | n`, n the code's length (in a second-level table, its length
 * beyond the root's bits); `offset << 5 | 16 | bits` leads to the second-level table of `bits` bits
 * at `offset`; -1 is no code (only incomplete codes have such entries). */
export interface _Code {
  table: Int32Array
  rootBits: number
}

const _ROOT_BITS = 8

/** The decoding table of the canonical prefix code with these code lengths (one per symbol, 0:
 * not used; at least one is not 0). */
export function _prefixCode(lengths: ArrayLike<number>): _Code {
  let maxLen = 0
  const count = new Int32Array(16)
  for (let s = 0; s < lengths.length; s++) {
    const n = lengths[s]
    count[n]++
    if (n > maxLen) maxLen = n
  }
  const rootBits = Math.min(_ROOT_BITS, maxLen)
  // the first code of each length; codes are read from their first bit on, so the tables are
  // indexed by the codes' bits reversed
  const next = new Int32Array(16)
  for (let n = 2; n <= maxLen; n++) next[n] = (next[n - 1] + count[n - 1]) << 1
  const codes = new Int32Array(lengths.length)
  const widths = new Int32Array(1 << rootBits) // per root entry, the bits of its second-level table
  for (let s = 0; s < lengths.length; s++) {
    const n = lengths[s]
    if (!n) continue
    const rev = _reverse(next[n]++, n)
    codes[s] = rev
    if (n > rootBits) {
      const low = rev & ((1 << rootBits) - 1)
      widths[low] = Math.max(widths[low], n - rootBits)
    }
  }
  let size = 1 << rootBits
  const offsets = new Int32Array(1 << rootBits)
  for (let low = 0; low < 1 << rootBits; low++) {
    if (widths[low]) {
      offsets[low] = size
      size += 1 << widths[low]
    }
  }
  const table = new Int32Array(size).fill(-1)
  for (let low = 0; low < 1 << rootBits; low++) if (widths[low]) table[low] = (offsets[low] << 5) | 16 | widths[low]
  for (let s = 0; s < lengths.length; s++) {
    const n = lengths[s]
    if (!n) continue
    const rev = codes[s]
    if (n <= rootBits) {
      for (let k = rev; k < 1 << rootBits; k += 1 << n) table[k] = (s << 5) | n
    } else {
      const low = rev & ((1 << rootBits) - 1)
      const m = n - rootBits
      const end = offsets[low] + (1 << widths[low])
      for (let k = offsets[low] + (rev >>> rootBits); k < end; k += 1 << m) table[k] = (s << 5) | m
    }
  }
  return { table, rootBits }
}

function _reverse(code: number, n: number): number {
  let r = 0
  for (let i = 0; i < n; i++) {
    r = (r << 1) | (code & 1)
    code >>>= 1
  }
  return r
}

/** A code of one symbol, which takes no bits. */
export function _single(symbol: number): _Code {
  return { table: Int32Array.of(symbol << 5), rootBits: 0 }
}

/** Bits of a byte array, from the first bit of each byte on; past its end come zeros (`overrun()`
 * says whether any were used). */
export class _Bits {
  data: Uint8Array
  pos = 0 // the next byte to read
  val = 0 // the bits read ahead, the next one lowest
  n = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  fill(): void {
    while (this.n <= 24) {
      const b = this.pos < this.data.length ? this.data[this.pos] : 0
      this.pos++
      this.val = (this.val | (b << this.n)) >>> 0
      this.n += 8
    }
  }

  /** The next `k` bits (0 to 24) as a number. */
  bits(k: number): number {
    if (this.n < k) this.fill()
    const v = this.val & ((1 << k) - 1)
    this.val >>>= k
    this.n -= k
    return v
  }

  /** The next symbol of a prefix code; an invalid code (of an incomplete prefix code) throws. */
  symbol(code: _Code): number {
    if (this.n < 15) this.fill()
    let e = code.table[this.val & ((1 << code.rootBits) - 1)]
    let used: number
    if (e & 16 && e > 0) {
      e = code.table[(e >>> 5) + ((this.val >>> code.rootBits) & ((1 << (e & 15)) - 1))]
      used = code.rootBits + (e & 15)
    } else {
      used = e & 15
    }
    if (e < 0) throw new ZlibError('invalid code')
    this.val >>>= used
    this.n -= used
    return e >>> 5
  }

  /** Go on at the next whole byte; returns the bits skipped. */
  byteBoundary(): number {
    const pad = this.bits(this.n & 7)
    this.pos -= this.n >> 3 // (the whole bytes read ahead go back)
    this.val = 0
    this.n = 0
    return pad
  }

  /** Whether more bits were read than the data has. */
  overrun(): boolean {
    return 8 * this.pos - this.n > 8 * this.data.length
  }
}

/** A growing byte array. */
export class _Output {
  buf: Uint8Array
  length = 0

  constructor(size: number) {
    this.buf = new Uint8Array(Math.max(size, 1024))
  }

  reserve(n: number): void {
    if (this.length + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.length + n) size *= 2
    const b = new Uint8Array(size)
    b.set(this.buf.subarray(0, this.length))
    this.buf = b
  }

  push(byte: number): void {
    if (this.length === this.buf.length) this.reserve(1)
    this.buf[this.length++] = byte
  }

  append(bytes: Uint8Array): void {
    this.reserve(bytes.length)
    this.buf.set(bytes, this.length)
    this.length += bytes.length
  }

  /** Copies `n` bytes from `distance` back (they may overlap what they write). */
  copy(distance: number, n: number): void {
    this.reserve(n)
    const b = this.buf
    let from = this.length - distance
    let to = this.length
    if (distance >= n) b.copyWithin(to, from, from + n)
    else for (const end = to + n; to < end; ) b[to++] = b[from++]
    this.length += n
  }
}
