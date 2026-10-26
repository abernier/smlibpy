"""Brotli decompression (RFC 7932), for the compressed tables of WOFF2 fonts.

A decoder after RFC 7932 and Google's reference decoder (github.com/google/brotli, MIT license),
without dependencies. The static dictionary of RFC 7932 (appendix A) is the file
``_brotli_dictionary.bin``; smlibwasm's ``_brotli.ts`` is the same decoder.

Prefix codes decode through a table of their first 8 bits and second-level tables for longer
codes, as in the reference decoder. The whole output stays in memory, so backward distances need
no ring buffer: a distance beyond the bytes written so far, or beyond the window, refers to the
dictionary.
"""

from __future__ import annotations

import functools
import hashlib
from pathlib import Path

__all__ = ["BrotliError", "decompress"]

_DICTIONARY = Path(__file__).resolve().parent / "_brotli_dictionary.bin"
_DICTIONARY_SHA256 = "20e42eb1b511c21806d4d227d07e5dd06877d8ce7b3a817f378f313653f35c70"  # RFC 7932, appendix A

# Words of each length (4..24) in the dictionary: 2 ** bits of them, one after the other.
_WORD_BITS = (0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5)
_WORD_OFFSETS = [0] * 26
for _n in range(4, 25):
    _WORD_OFFSETS[_n + 1] = _WORD_OFFSETS[_n] + (_n << _WORD_BITS[_n])

# The prefixes and suffixes of the dictionary's transforms, and the 121 transforms as (prefix,
# type, suffix). Types: 0 the word, 1..9 without its last 1..9 bytes, 10 its first character
# uppercased, 11 all uppercased, 12..20 without its first 1..9 bytes.
_AFFIXES = (
    b" ", b", ", b" of the ", b" of ", b"s ", b".", b" and ", b" in ", b'"', b" to ", b'">', b"\n", b". ", b"]",
    b" for ", b" a ", b" that ", b"'", b" with ", b" from ", b" by ", b"(", b". The ", b" on ", b" as ", b" is ",
    b"ing ", b"\n\t", b":", b"ed ", b'="', b" at ", b"ly ", b",", b"='", b".com/", b". This ", b" not ", b"er ",
    b"al ", b"ful ", b"ive ", b"less ", b"est ", b"ize ", b"\xc2\xa0", b"ous ", b" the ", b"e ", b"",
)
_TRANSFORMS = (
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
)

# Extra bits of the block length codes, insert length codes and copy length codes; each code's
# range starts where the one before it ends.
_BLOCK_BITS = (2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 24)
_INSERT_BITS = (0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24)
_COPY_BITS = (0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24)


def _starts(bits: tuple[int, ...], first: int) -> list[int]:
    out = [first]
    for b in bits[:-1]:
        out.append(out[-1] + (1 << b))
    return out


_BLOCK_BASE = _starts(_BLOCK_BITS, 1)
_INSERT_BASE = _starts(_INSERT_BITS, 0)
_COPY_BASE = _starts(_COPY_BITS, 2)
# The insert and copy length codes that start each of the 11 cells of 64 commands (RFC 7932,
# section 5); the commands of the first two cells reuse the last distance.
_CELL_INSERT = (0, 0, 0, 0, 8, 8, 0, 16, 8, 16, 16)
_CELL_COPY = (0, 8, 0, 8, 0, 8, 16, 0, 16, 8, 16)


def _commands() -> list[tuple[int, int, int, int, int]]:
    """Per command: insert base and extra bits, copy base and extra bits, and the context of its
    distance (-1: the command reuses the last distance)."""
    out = []
    for cmd in range(704):
        cell = cmd >> 6
        ins = _CELL_INSERT[cell] + ((cmd >> 3) & 7)
        cop = _CELL_COPY[cell] + (cmd & 7)
        out.append((_INSERT_BASE[ins], _INSERT_BITS[ins], _COPY_BASE[cop], _COPY_BITS[cop],
                    -1 if cell < 2 else min(cop, 3)))
    return out


_COMMANDS = _commands()

# The context of a literal from the two bytes before it (RFC 7932, section 7.1). The UTF-8 mode's
# values for the last byte (in fours) and for the one before it, below 128:
_UTF8_LAST = ("00000000011001000000000000000000234335346733839"
              "3bbbbbbbbbb886a733cdddcdddcdddddcdddddcddddd637333efffefffefffffefffffefffff63730")
_UTF8_BEFORE = ("00000000000000000000000000000000011111111111111122222222221111111"
                "222222222222222222222222221111113333333333333333333333333311110")


def _context_tables() -> list[tuple[list[int], list[int]]]:
    """Per context mode (LSB6, MSB6, UTF8, signed): the values of the last byte and of the one
    before it; a literal's context is the two ORed."""
    last = [int(c, 16) * 4 for c in _UTF8_LAST] + [(i & 1) if i < 192 else 2 | (i & 1) for i in range(128, 256)]
    before = [int(c) for c in _UTF8_BEFORE] + [0 if i < 224 else 2 for i in range(128, 256)]
    signed = [0 if i == 0 else 1 if i < 16 else 2 if i < 64 else 3 if i < 128 else 4 if i < 192 else 5 if i < 240
              else 6 if i < 255 else 7 for i in range(256)]
    zero = [0] * 256
    return [([i & 63 for i in range(256)], zero), ([i >> 2 for i in range(256)], zero), (last, before),
            ([v << 3 for v in signed], signed)]


_CONTEXTS = _context_tables()

# The code lengths of a prefix code's code lengths come in this order, each read with a fixed
# code of 2 to 4 bits (the value and the size of each 4-bit pattern)
_CODE_LENGTH_ORDER = (1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15)
_CODE_LENGTH_BITS = (2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 4)
_CODE_LENGTH_VALUE = (0, 4, 3, 2, 0, 4, 3, 1, 0, 4, 3, 2, 0, 4, 3, 5)
_ROOT_BITS = 8

# A prefix code: its root table, the root table's bits and the second-level tables (bits, table).
_Code = tuple[list[int], int, list[tuple[int, list[int]]]]


class BrotliError(ValueError):
    """The data is no valid Brotli stream."""


@functools.cache
def _dictionary() -> bytes:
    data = _DICTIONARY.read_bytes()
    if hashlib.sha256(data).hexdigest() != _DICTIONARY_SHA256:
        raise BrotliError(f"{_DICTIONARY} is damaged")
    return data


def decompress(data: bytes) -> bytes:
    """The bytes a Brotli stream (RFC 7932) holds. Raises BrotliError for invalid data."""
    decoder = _Decoder(bytes(data))
    try:
        return decoder.run()
    except BrotliError:
        if decoder.overrun():  # (past its end, the data reads as zeros: what fails then is that it ends)
            raise BrotliError("the data ends early") from None
        raise


def _prefix_code(lengths: list[int]) -> _Code:
    """The decoding tables of the canonical prefix code with these code lengths (one per symbol,
    0: not used). An entry is ``symbol << 4 | n``: the code's length (in a second-level table, its
    length beyond the root's bits); the root entry ``-1 - i`` leads to second-level table ``i``."""
    max_len = max(lengths)
    by_len: list[list[int]] = [[] for _ in range(16)]
    for s, n in enumerate(lengths):
        if n:
            by_len[n].append(s)
    root_bits = min(_ROOT_BITS, max_len)
    root: list[int] = [0] * (1 << root_bits)
    long_codes: list[tuple[int, int, int]] = []  # (bits in the root, bits beyond, entry)
    code = 0
    for n in range(1, max_len + 1):
        for s in by_len[n]:
            rev = int(f"{code:0{n}b}"[::-1], 2)  # (codes are read from their first bit on)
            if n <= root_bits:
                root[rev::1 << n] = [s << 4 | n] * ((1 << root_bits) >> n)
            else:
                long_codes.append((rev & ((1 << root_bits) - 1), rev >> root_bits, s << 4 | (n - root_bits)))
            code += 1
        code <<= 1
    subs: list[tuple[int, list[int]]] = []
    if long_codes:
        width: dict[int, int] = {}
        for low, _high, e in long_codes:
            width[low] = max(width.get(low, 0), e & 15)
        index: dict[int, int] = {}
        for low in sorted(width):
            index[low] = len(subs)
            root[low] = -1 - len(subs)
            subs.append((width[low], [0] * (1 << width[low])))
        for low, high, e in long_codes:
            bits, table = subs[index[low]]
            n = e & 15
            table[high::1 << n] = [e] * ((1 << bits) >> n)
    return root, root_bits, subs


class _Decoder:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0  # the next byte to read (past the end, zeros are read)
        self.val = 0  # the bits read ahead, the next one lowest
        self.nbits = 0
        self.out = bytearray()

    # -- bits -------------------------------------------------------------------
    def bits(self, n: int) -> int:
        if self.nbits < n:
            self._fill()
        v = self.val & ((1 << n) - 1)
        self.val >>= n
        self.nbits -= n
        return v

    def _fill(self) -> None:
        chunk = self.data[self.pos:self.pos + 8]
        if len(chunk) < 8:
            chunk += bytes(8 - len(chunk))
        self.val |= int.from_bytes(chunk, "little") << self.nbits
        self.nbits += 64
        self.pos += 8

    def symbol(self, code: _Code) -> int:
        if self.nbits < 15:
            self._fill()
        v = self.val
        root, root_bits, subs = code
        e = root[v & ((1 << root_bits) - 1)]
        if e >= 0:
            n = e & 15
        else:
            bits, table = subs[-1 - e]
            e = table[(v >> root_bits) & ((1 << bits) - 1)]
            n = root_bits + (e & 15)
        self.val = v >> n
        self.nbits -= n
        return e >> 4

    def overrun(self) -> bool:
        """Whether more bits were read than the data has."""
        return 8 * self.pos - self.nbits > 8 * len(self.data)

    def byte_boundary(self) -> None:
        """Go on at the next whole byte; the bits skipped must be zero."""
        if self.bits(self.nbits & 7):
            raise BrotliError("padding bits that are not zero")
        self.pos -= self.nbits >> 3  # (the whole bytes read ahead go back)
        self.val = self.nbits = 0
        if self.pos > len(self.data):
            raise BrotliError("the data ends early")

    def var_uint8(self) -> int:
        if not self.bits(1):
            return 0
        n = self.bits(3)
        return 1 if n == 0 else (1 << n) + self.bits(n)

    # -- prefix codes -----------------------------------------------------------
    def prefix_code(self, alphabet: int) -> _Code:
        lengths = [0] * alphabet
        kind = self.bits(2)
        if kind == 1:  # simple: 1 to 4 symbols
            n = self.bits(2) + 1
            width = (alphabet - 1).bit_length()
            symbols = [self.bits(width) for _ in range(n)]
            if any(s >= alphabet for s in symbols) or len(set(symbols)) != n:
                raise BrotliError("a simple prefix code with invalid symbols")
            if n == 1:
                return [symbols[0] << 4], 0, []
            sizes = {2: (1, 1), 3: (1, 2, 2), 4: (2, 2, 2, 2)}[n]
            if n == 4 and self.bits(1):
                sizes = (1, 2, 3, 3)
            for s, size in zip(symbols, sizes):
                lengths[s] = size
            return _prefix_code(lengths)
        # complex: the code lengths, prefix coded themselves (`kind` of them skipped)
        cl_lengths = [0] * 18
        space, count = 32, 0
        for i in range(kind, 18):
            if self.nbits < 4:
                self._fill()
            ix = self.val & 15
            self.bits(_CODE_LENGTH_BITS[ix])
            v = _CODE_LENGTH_VALUE[ix]
            cl_lengths[_CODE_LENGTH_ORDER[i]] = v
            if v:
                space -= 32 >> v
                count += 1
                if space <= 0:
                    break
        if not (count == 1 or space == 0):
            raise BrotliError("an incomplete code of code lengths")
        if count == 1:
            cl_code: _Code = ([next(s for s, n in enumerate(cl_lengths) if n) << 4], 0, [])
        else:
            cl_code = _prefix_code(cl_lengths)
        symbol, prev, repeat, repeat_len, space = 0, 8, 0, 0, 32768
        while symbol < alphabet and space > 0:
            n = self.symbol(cl_code)
            if n < 16:
                repeat = 0
                lengths[symbol] = n
                if n:
                    prev = n
                    space -= 32768 >> n
                symbol += 1
            else:  # 16: repeat the last length, 17: repeat zero
                extra = 2 if n == 16 else 3
                new_len = prev if n == 16 else 0
                if repeat_len != new_len:
                    repeat, repeat_len = 0, new_len
                old = repeat
                if repeat > 0:
                    repeat = (repeat - 2) << extra
                repeat += self.bits(extra) + 3
                delta = repeat - old
                if symbol + delta > alphabet:
                    raise BrotliError("code lengths past the end of the alphabet")
                lengths[symbol:symbol + delta] = [repeat_len] * delta
                symbol += delta
                if repeat_len:
                    space -= delta << (15 - repeat_len)
        if space != 0:
            raise BrotliError("an incomplete prefix code")
        return _prefix_code(lengths)

    def block_length(self, code: _Code) -> int:
        c = self.symbol(code)
        return _BLOCK_BASE[c] + self.bits(_BLOCK_BITS[c])

    def context_map(self, size: int) -> tuple[list[int], int]:
        trees = self.var_uint8() + 1
        if trees < 2:
            return [0] * size, trees
        rle = self.bits(4) + 1 if self.bits(1) else 0
        code = self.prefix_code(trees + rle)
        out: list[int] = []
        while len(out) < size:
            c = self.symbol(code)
            if c == 0:
                out.append(0)
            elif c <= rle:  # a run of zeros
                reps = (1 << c) + self.bits(c)
                if len(out) + reps > size:
                    raise BrotliError("a context map that runs past its end")
                out.extend([0] * reps)
            else:
                out.append(c - rle)
        if self.bits(1):  # inverse move-to-front
            mtf = list(range(256))
            for i, v in enumerate(out):
                value = mtf[v]
                out[i] = value
                if v:
                    del mtf[v]
                    mtf.insert(0, value)
        return out, trees

    # -- the stream -------------------------------------------------------------
    def run(self) -> bytes:
        if self.bits(1) == 0:
            wbits = 16
        else:
            n = self.bits(3)
            if n:
                wbits = 17 + n
            else:
                n = self.bits(3)
                if n == 1:
                    raise BrotliError("an invalid window size")
                wbits = 8 + n if n else 17
        window = (1 << wbits) - 16
        distances = [16, 15, 11, 4]  # the last four distances, the latest last
        while True:
            last = self.bits(1)
            if last and self.bits(1):  # the empty last meta-block
                break
            nibbles = self.bits(2) + 4
            if nibbles == 7:  # metadata, skipped
                if self.bits(1):
                    raise BrotliError("a reserved bit that is set")
                nbytes = self.bits(2)
                skip = 0
                for i in range(nbytes):
                    b = self.bits(8)
                    if i + 1 == nbytes and nbytes > 1 and b == 0:
                        raise BrotliError("an invalid length of metadata")
                    skip |= b << (8 * i)
                self.byte_boundary()
                self.pos += skip + 1 if nbytes else 0
                if self.pos > len(self.data):
                    raise BrotliError("the data ends early")
                if last:
                    break
                continue
            length = 0
            for i in range(nibbles):
                b = self.bits(4)
                if i + 1 == nibbles and nibbles > 4 and b == 0:
                    raise BrotliError("an invalid length of a meta-block")
                length |= b << (4 * i)
            length += 1
            if not last and self.bits(1):  # stored
                self.byte_boundary()
                chunk = self.data[self.pos:self.pos + length]
                if len(chunk) < length:
                    raise BrotliError("the data ends early")
                self.out += chunk
                self.pos += length
                continue
            self._meta_block(length, window, distances)
            if last:
                break
        self.byte_boundary()
        return bytes(self.out)

    def _meta_block(self, length: int, window: int, distances: list[int]) -> None:
        # block types and block counts of literals (0), commands (1) and distances (2)
        ntypes: list[int] = []
        type_codes: list[_Code | None] = []
        count_codes: list[_Code | None] = []
        counts: list[int] = []
        for _ in range(3):
            n = self.var_uint8() + 1
            ntypes.append(n)
            if n >= 2:
                type_codes.append(self.prefix_code(n + 2))
                count_codes.append(self.prefix_code(26))
                counts.append(self.block_length(count_codes[-1]))  # type: ignore[arg-type]
            else:
                type_codes.append(None)
                count_codes.append(None)
                counts.append(1 << 24)
        npostfix = self.bits(2)
        ndirect = self.bits(4) << npostfix
        modes = [self.bits(2) for _ in range(ntypes[0])]
        lit_map, lit_trees = self.context_map(ntypes[0] << 6)
        dist_map, dist_trees = self.context_map(ntypes[2] << 2)
        lit_codes = [self.prefix_code(256) for _ in range(lit_trees)]
        cmd_codes = [self.prefix_code(704) for _ in range(ntypes[1])]
        dist_codes = [self.prefix_code(16 + ndirect + (48 << npostfix)) for _ in range(dist_trees)]
        rings = [[1, 0], [1, 0], [1, 0]]  # the block types before the last, and the last

        def switch(k: int) -> int:
            t = self.symbol(type_codes[k])  # type: ignore[arg-type]
            ring = rings[k]
            t = ring[0] if t == 0 else ring[1] + 1 if t == 1 else t - 2
            if t >= ntypes[k]:
                t -= ntypes[k]
            ring[0], ring[1] = ring[1], t
            counts[k] = self.block_length(count_codes[k])  # type: ignore[arg-type]
            return t

        def literal_type(t: int) -> tuple[list[int], _Code | None, list[int], list[int]]:
            trees = lit_map[t << 6:(t + 1) << 6]
            one = lit_codes[trees[0]] if trees.count(trees[0]) == 64 else None  # (no context needed)
            return (trees, one, *_CONTEXTS[modes[t]])

        out = self.out
        symbol = self.symbol
        words = None
        cmd_type = dist_type = 0
        trees, one, lut_last, lut_before = literal_type(0)
        postfix_mask = (1 << npostfix) - 1
        remaining = length
        while remaining > 0:
            if counts[1] == 0:
                cmd_type = switch(1)
            counts[1] -= 1
            ins_base, ins_bits, copy_base, copy_bits, dist_ctx = _COMMANDS[symbol(cmd_codes[cmd_type])]
            insert = ins_base + (self.bits(ins_bits) if ins_bits else 0)
            copy = copy_base + (self.bits(copy_bits) if copy_bits else 0)
            if insert > remaining:
                raise BrotliError("a meta-block longer than its length")
            remaining -= insert
            for _ in range(insert):
                if counts[0] == 0:
                    trees, one, lut_last, lut_before = literal_type(switch(0))
                counts[0] -= 1
                if one is not None:
                    out.append(symbol(one))
                else:
                    n = len(out)
                    p1 = out[-1] if n else 0
                    p2 = out[-2] if n > 1 else 0
                    out.append(symbol(lit_codes[trees[lut_last[p1] | lut_before[p2]]]))
            if remaining <= 0:
                break
            # the distance
            if dist_ctx < 0:
                code = 0
                distance = distances[-1]
            else:
                if counts[2] == 0:
                    dist_type = switch(2)
                counts[2] -= 1
                code = symbol(dist_codes[dist_map[(dist_type << 2) + dist_ctx]])
                if code < 4:
                    distance = distances[-1 - code]
                elif code < 16:
                    base = distances[-1] if code < 10 else distances[-2]
                    distance = base + (-1, 1, -2, 2, -3, 3)[(code - 4) % 6]
                    if distance <= 0:
                        raise BrotliError("an invalid distance")
                elif code < 16 + ndirect:
                    distance = code - 15
                else:
                    x = code - ndirect - 16
                    nbits = 1 + (x >> (npostfix + 1))
                    offset = ((2 + ((x >> npostfix) & 1)) << nbits) - 4
                    distance = ((offset + self.bits(nbits)) << npostfix) + (x & postfix_mask) + ndirect + 1
            max_distance = min(len(out), window)
            if distance > max_distance:  # a word of the dictionary
                if not 4 <= copy <= 24:
                    raise BrotliError("a distance past the start of the data")
                if words is None:
                    words = _dictionary()
                address = distance - max_distance - 1
                bits = _WORD_BITS[copy]
                transform = address >> bits
                if transform >= 121:
                    raise BrotliError("an invalid reference to the dictionary")
                start = _WORD_OFFSETS[copy] + (address & ((1 << bits) - 1)) * copy
                word = _transform(words[start:start + copy], transform)
                if not word and distance <= 120:
                    raise BrotliError("an empty word of the dictionary")
                out += word
                remaining -= len(word)
            else:
                if copy > remaining:
                    raise BrotliError("a meta-block longer than its length")
                if code != 0:
                    distances.pop(0)
                    distances.append(distance)
                start = len(out) - distance
                if distance >= copy:
                    out += out[start:start + copy]
                else:  # the copy overlaps what it writes: the last `distance` bytes repeat
                    out += (out[start:] * (copy // distance + 1))[:copy]
                remaining -= copy
        if remaining < 0:
            raise BrotliError("a meta-block longer than its length")
        if self.overrun():
            raise BrotliError("the data ends early")


def _transform(word: bytes, index: int) -> bytes:
    prefix, kind, suffix = _TRANSFORMS[3 * index:3 * index + 3]
    w = bytearray(word)
    if 1 <= kind <= 9:
        del w[len(w) - kind:]
    elif 12 <= kind <= 20:
        del w[:kind - 11]
    elif kind in (10, 11):  # (the reference's simplified UTF-8 uppercasing)
        n = len(w)
        w += b"\0\0"  # (a lead byte also changes the bytes after it, past the word too)
        i = 0
        while i < n:
            c = w[i]
            if c < 0xC0:
                if 97 <= c <= 122:
                    w[i] ^= 32
                i += 1
            elif c < 0xE0:
                w[i + 1] ^= 32
                i += 2
            else:
                w[i + 2] ^= 5
                i += 3
            if kind == 10:
                break
        del w[n:]
    return _AFFIXES[prefix] + bytes(w) + _AFFIXES[suffix]
