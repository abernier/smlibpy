"""Reading TrueType and OpenType fonts: characters, metrics, kerning and exact glyph outlines.

A compact reader without dependencies. It reads sfnt files (TTF, OTF), font collections (TTC,
the first font), WOFF and WOFF2 files (the font of a collection, the first), and from them the
tables a text layout needs:

- ``cmap`` (formats 0, 4, 6, 12 and 13), ``head``, ``hhea``, ``hmtx``, ``maxp``, ``OS/2``,
  ``name``;
- outlines: ``glyf``/``loca`` (simple and composite glyphs, every transform form, point
  matching), ``CFF `` (Type 2 charstrings with local and global subroutines, flex, hint
  masks, accents built with seac, CID-keyed fonts) and ``CFF2`` (variable fonts: the default
  instance);
- kerning: ``GPOS`` pair adjustment (formats 1 and 2, extension lookups) and the ``kern``
  table (format 0, Microsoft and Apple headers).

WOFF2 files are Brotli-compressed (``_brotli``) and their ``glyf``, ``loca`` and ``hmtx`` tables
may be transformed; they are read back to the tables of the font. smlibwasm's ``font.ts`` is
the same reader.

Outlines come in font units, y up, as contours: lists of segments, each a tuple of 2 points
(a line), 3 (a quadratic Bézier) or 4 (a cubic Bézier); a contour is closed, so the last
segment ends where the first starts.
"""

from __future__ import annotations

import functools
import os
import struct
import zlib
from pathlib import Path
from typing import Any, Callable, NamedTuple, Sequence

from . import _brotli

__all__ = ["Font", "DEFAULT_FONT", "load_font"]

#: The font ``Text`` uses unless told otherwise (Lato Regular, SIL Open Font License 1.1).
DEFAULT_FONT = Path(__file__).resolve().parent / "fonts" / "Lato-Regular.ttf"

Point = tuple[float, float]
Segment = tuple[Point, ...]
Contour = list[Segment]


class PairAdjustment(NamedTuple):
    """Kerning of two neighbouring glyphs in font units: the first glyph's advance changes by
    ``advance1`` and it moves by ``placement1``; the second moves by ``placement2`` and its
    advance changes by ``advance2``."""

    advance1: float = 0.0
    placement1: float = 0.0
    advance2: float = 0.0
    placement2: float = 0.0


_NO_PAIR = PairAdjustment()


class FontError(ValueError):
    """The file is not a font this reader can use."""


def load_font(path: str | os.PathLike[str] | None = None) -> Font:
    """The font at ``path`` (the bundled default without one), read once and kept."""
    p = Path(os.fspath(path)).expanduser() if path is not None else DEFAULT_FONT
    if not p.is_file():
        raise FileNotFoundError(f"no font file {str(p)!r}")
    st = p.stat()
    return _cached_font(str(p.resolve()), st.st_mtime_ns, st.st_size)


@functools.lru_cache(maxsize=16)
def _cached_font(path: str, mtime: int, size: int) -> Font:
    return Font(path)


# =============================================================================
# Binary helpers
# =============================================================================
def _u16(b: bytes, o: int) -> int:
    return (b[o] << 8) | b[o + 1]


def _i16(b: bytes, o: int) -> int:
    v = (b[o] << 8) | b[o + 1]
    return v - 0x10000 if v >= 0x8000 else v


def _u32(b: bytes, o: int) -> int:
    return struct.unpack_from(">I", b, o)[0]


def _f2dot14(b: bytes, o: int) -> float:
    return _i16(b, o) / 16384.0


# =============================================================================
# Font
# =============================================================================
class Font:
    """One font: its characters, metrics, kerning and glyph outlines (font units, y up)."""

    def __init__(self, path: str | os.PathLike[str]):
        self.path = os.fspath(path)
        with open(self.path, "rb") as fh:
            data = fh.read()
        self._tables = _read_tables(data, self.path)
        for tag in ("head", "hhea", "hmtx", "maxp", "cmap"):
            if tag not in self._tables:
                raise FontError(f"{self.path}: not a usable font (no {tag!r} table)")
        head = self._tables["head"]
        self.units_per_em = _u16(head, 18)
        self._long_loca = _i16(head, 50) == 1
        self.num_glyphs = _u16(self._tables["maxp"], 4)
        self._num_hmetrics = _u16(self._tables["hhea"], 34)
        os2 = self._tables.get("OS/2")
        cap = _i16(os2, 88) if os2 is not None and len(os2) >= 90 and _u16(os2, 0) >= 2 else 0
        self.name = _font_name(self._tables.get("name")) or Path(self.path).stem
        if "glyf" in self._tables and "loca" in self._tables:
            self._outlines: Any = _TrueTypeOutlines(self._tables["glyf"], self._tables["loca"], self._long_loca,
                                                    self.num_glyphs)
        elif "CFF " in self._tables:
            self._outlines = _CFFOutlines(self._tables["CFF "], self.units_per_em)
        elif "CFF2" in self._tables:
            self._outlines = _CFF2Outlines(self._tables["CFF2"], self.units_per_em)
        else:
            raise FontError(f"{self.path}: a font without outlines (no glyf, CFF or CFF2 table)")
        self._cmap = _read_cmap(self._tables["cmap"])
        self._kern: _Kerning | None = None
        #: Height of the capital letters in font units: ``OS/2`` sCapHeight, or the top of ``H``.
        self.cap_height = float(cap) if cap > 0 else self._measured_cap_height()

    def __repr__(self) -> str:
        return f"Font({self.name!r}, {self.num_glyphs} glyphs, {self.units_per_em} units per em)"

    # -- characters -------------------------------------------------------------
    def glyph_index(self, char: str) -> int | None:
        """The glyph of a character, or None when the font has none for it."""
        g = self._cmap.get(ord(char))
        if g is None and self._cmap.get(-1) == 1:  # a symbol font: characters at U+F0xx
            g = self._cmap.get(0xF000 + ord(char))
        return g if g else None

    def characters(self) -> list[str]:
        """Every character the font maps to a glyph."""
        return [chr(c) for c in sorted(self._cmap) if c >= 0 and self._cmap[c]]

    # -- metrics ----------------------------------------------------------------
    def advance(self, glyph: int) -> float:
        """Advance width of a glyph in font units."""
        hmtx = self._tables["hmtx"]
        i = min(glyph, self._num_hmetrics - 1)
        return float(_u16(hmtx, 4 * i))

    def kerning(self, left: int, right: int) -> PairAdjustment:
        """The kerning of two neighbouring glyphs: ``GPOS`` pair adjustment when the font has
        it, otherwise the ``kern`` table."""
        if self._kern is None:
            self._kern = _Kerning(self._tables.get("GPOS"), self._tables.get("kern"))
        return self._kern.pair(left, right)

    @property
    def kerning_source(self) -> str | None:
        """``"GPOS"``, ``"kern"`` or None: where :meth:`kerning` takes its values from."""
        if self._kern is None:
            self._kern = _Kerning(self._tables.get("GPOS"), self._tables.get("kern"))
        return self._kern.source

    # -- outlines ---------------------------------------------------------------
    def outline(self, glyph: int) -> list[Contour]:
        """The contours of a glyph in font units (empty for a space)."""
        return self._outlines.contours(glyph)

    def _measured_cap_height(self) -> float:
        for ch in "HIEXT":
            g = self.glyph_index(ch)
            if g is None:
                continue
            ys = [p[1] for c in self.outline(g) for seg in c for p in seg]
            if ys:
                return float(max(ys))
        return 0.7 * self.units_per_em


# =============================================================================
# Containers: sfnt, TTC, WOFF, WOFF2
# =============================================================================
def _read_tables(data: bytes, path: str) -> dict[str, bytes]:
    if len(data) < 12:
        raise FontError(f"{path}: not a font file")
    tag = data[:4]
    if tag == b"wOFF":
        return _woff_tables(data, path)
    if tag == b"wOF2":
        try:
            return _woff2_tables(data)
        except (IndexError, struct.error, ValueError) as e:  # (also _brotli.BrotliError)
            raise FontError(f"{path}: a damaged WOFF2 file ({e})") from None
    offset = 0
    if tag == b"ttcf":
        if _u32(data, 8) < 1:
            raise FontError(f"{path}: an empty font collection")
        offset = _u32(data, 12)  # the first font of the collection
        tag = data[offset:offset + 4]
    if tag not in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
        raise FontError(f"{path}: not a TrueType or OpenType font")
    n = _u16(data, offset + 4)
    tables: dict[str, bytes] = {}
    for i in range(n):
        rec = offset + 12 + 16 * i
        t = data[rec:rec + 4].decode("latin-1")
        off, length = _u32(data, rec + 8), _u32(data, rec + 12)
        tables[t] = data[off:off + length]
    return tables


def _woff_tables(data: bytes, path: str) -> dict[str, bytes]:
    n = _u16(data, 12)
    tables: dict[str, bytes] = {}
    for i in range(n):
        rec = 44 + 20 * i
        t = data[rec:rec + 4].decode("latin-1")
        off, comp, orig = _u32(data, rec + 4), _u32(data, rec + 8), _u32(data, rec + 12)
        raw = data[off:off + comp]
        try:
            tables[t] = zlib.decompress(raw) if comp < orig else raw
        except zlib.error as e:
            raise FontError(f"{path}: damaged WOFF table {t!r} ({e})") from None
        if len(tables[t]) != orig:
            raise FontError(f"{path}: damaged WOFF table {t!r}")
    return tables


# The tables WOFF2 names by number
_WOFF2_TAGS = [
    "cmapheadhheahmtxmaxpnameOS/2postcvt fpgmglyflocaprepCFF VORGEBDTEBLCgasphdmxkernLTSHPCLTVDMXvheavmtxBASEGDEF"
    "GPOSGSUBEBSCJSTFMATHCBDTCBLCCOLRCPALSVG sbixacntavarbdatblocbslncvarfdscfeatfmtxfvargvarhstyjustlcarmortmorx"
    "opbdproptrakZapfSilfGlatGlocFeatSill"[i:i + 4] for i in range(0, 252, 4)
]


def _woff2_tables(data: bytes) -> dict[str, bytes]:
    """The tables of a WOFF2 file (of a collection, the first font's), with the transformed
    ``glyf``, ``loca`` and ``hmtx`` tables made back into the font's. Damaged files raise
    ValueError, IndexError or struct.error."""
    if len(data) < 48:
        raise ValueError("no WOFF2 header")
    num_tables, compressed = _u16(data, 12), _u32(data, 20)
    pos = 48
    entries: list[tuple[str, int, int, int]] = []  # tag, length in the font, transform version, length stored
    for _ in range(num_tables):
        flags = data[pos]
        pos += 1
        if flags & 63 == 63:
            tag = data[pos:pos + 4].decode("latin-1")
            pos += 4
        else:
            tag = _WOFF2_TAGS[flags & 63]
        version = flags >> 6
        orig, pos = _base128(data, pos)
        stored = orig
        if (version != 3) if tag in ("glyf", "loca") else (version != 0):  # transformed
            stored, pos = _base128(data, pos)
            if tag == "loca" and stored != 0:
                raise ValueError("a transformed loca table with data")
        entries.append((tag, orig, version, stored))
    chosen: Sequence[int] = range(num_tables)
    if data[4:8] == b"ttcf":  # a collection: the tables of each font
        pos += 4
        num_fonts, pos = _uint255(data, pos)
        if num_fonts < 1:
            raise ValueError("an empty font collection")
        for k in range(num_fonts):
            n, pos = _uint255(data, pos)
            pos += 4  # (the font's flavor)
            indices = []
            for _ in range(n):
                i, pos = _uint255(data, pos)
                if i >= num_tables:
                    raise ValueError("a font of the collection names a table it does not have")
                indices.append(i)
            if k == 0:
                chosen = indices
    if pos + compressed > len(data):
        raise ValueError("the compressed data runs past the end of the file")
    stream = _brotli.decompress(data[pos:pos + compressed])
    if len(stream) != sum(e[3] for e in entries):
        raise ValueError("the compressed data does not hold the tables")
    starts = [0]
    for e in entries:
        starts.append(starts[-1] + e[3])
    tables: dict[str, bytes] = {}
    transformed: dict[str, tuple[bytes, int, int]] = {}
    for i in chosen:
        tag, orig, version, stored = entries[i]
        blob = stream[starts[i]:starts[i] + stored]
        if (version != 3) if tag in ("glyf", "loca") else (version != 0):
            transformed[tag] = (blob, orig, version)
        else:
            tables[tag] = blob
    x_mins: list[int] | None = None
    if "glyf" in transformed or "loca" in transformed:
        if "glyf" not in transformed or "loca" not in transformed or transformed["glyf"][2] != 0:
            raise ValueError("a glyf or loca table transformed in an unknown way")
        num_glyphs, index_format = _u16(transformed["glyf"][0], 4), _u16(transformed["glyf"][0], 6)
        if transformed.pop("loca")[1] != (num_glyphs + 1) * (4 if index_format else 2):
            raise ValueError("the loca table does not have its length")
        glyf, loca, x_mins, long_loca = _woff2_glyf(transformed.pop("glyf")[0])
        tables["glyf"], tables["loca"] = glyf, loca
        if "head" in tables and len(tables["head"]) >= 54:  # (the index format the loca table has)
            head = tables["head"]
            tables["head"] = head[:50] + struct.pack(">h", int(long_loca)) + head[52:]
    for tag, (blob, _orig, version) in transformed.items():
        if tag != "hmtx" or version != 1:
            raise ValueError(f"the {tag!r} table is transformed in an unknown way")
        if x_mins is None:
            x_mins = _glyph_x_mins(tables)
        tables["hmtx"] = _woff2_hmtx(blob, x_mins, _u16(tables["hhea"], 34))
    return tables


def _base128(b: bytes, o: int) -> tuple[int, int]:
    """WOFF2's UIntBase128: up to five bytes of 7 bits, the first not 0x80."""
    v = 0
    for i in range(5):
        c = b[o + i]
        if i == 0 and c == 0x80:
            raise ValueError("a number with leading zeros")
        if v & 0xFE000000:
            raise ValueError("a number that overflows")
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, o + i + 1
    raise ValueError("a number longer than five bytes")


def _uint255(b: bytes, o: int) -> tuple[int, int]:
    """WOFF2's 255UInt16."""
    c = b[o]
    if c == 253:
        return _u16(b, o + 1), o + 3
    if c == 254:
        return 506 + b[o + 1], o + 2
    if c == 255:
        return 253 + b[o + 1], o + 2
    return c, o + 1


def _woff2_glyf(t: bytes) -> tuple[bytes, bytes, list[int], bool]:
    """The glyf and loca tables of a transformed glyf table, each glyph's xMin, and whether the
    loca table is in the long format."""
    option_flags, num_glyphs, index_format = _u16(t, 2), _u16(t, 4), _u16(t, 6)
    starts = [36]
    for size in struct.unpack_from(">7I", t, 8):
        starts.append(starts[-1] + size)
    overlap = starts[7] if option_flags & 1 else -1
    if starts[7] + ((num_glyphs + 7) >> 3 if option_flags & 1 else 0) != len(t):
        raise ValueError("the streams of the glyf table do not fill it")
    n_contours, n_points, flag_s, glyph_s, comp_s, bbox_s, instr_s = starts[:7]
    bbox_bitmap = bbox_s
    bbox_s += 4 * ((num_glyphs + 31) >> 5)
    out = bytearray()
    offsets: list[int] = []
    x_mins: list[int] = []
    for g in range(num_glyphs):
        offsets.append(len(out))
        nc = _i16(t, n_contours + 2 * g)
        explicit = t[bbox_bitmap + (g >> 3)] & (0x80 >> (g & 7))
        if nc == 0:
            if explicit:
                raise ValueError(f"glyph {g} is empty and has a bounding box")
            x_mins.append(0)
            continue
        if nc > 0:  # simple
            ends = []
            total = 0
            for _ in range(nc):
                k, n_points = _uint255(t, n_points)
                total += k
                ends.append(total - 1)
            flags = t[flag_s:flag_s + total]
            flag_s += total
            dxs, dys, glyph_s = _woff2_triplets(t, glyph_s, flags)
            ilen, glyph_s = _uint255(t, glyph_s)
            instructions = t[instr_s:instr_s + ilen]
            instr_s += ilen
            if explicit:
                box = struct.unpack_from(">4h", t, bbox_s)
                bbox_s += 8
            else:
                xs = list(_accumulate(dxs))
                ys = list(_accumulate(dys))
                box = (min(xs), min(ys), max(xs), max(ys))
            out += struct.pack(f">5h{nc}HH", nc, *box, *ends, ilen) + instructions
            overlaps = overlap >= 0 and t[overlap + (g >> 3)] & (0x80 >> (g & 7))
            out += _simple_points(flags, dxs, dys, bool(overlaps))
            x_mins.append(box[0])
        elif nc == -1:  # composite: its components as they are, then its instructions
            if not explicit:
                raise ValueError(f"composite glyph {g} has no bounding box")
            start = comp_s
            instructed = False
            while True:
                flags = _u16(t, comp_s)
                comp_s += 4 + (4 if flags & _ARG_WORDS else 2)
                comp_s += 2 if flags & _SCALE else 4 if flags & _XY_SCALE else 8 if flags & _TWO_BY_TWO else 0
                instructed = instructed or bool(flags & 0x100)
                if not flags & _MORE:
                    break
            box = struct.unpack_from(">4h", t, bbox_s)
            bbox_s += 8
            out += struct.pack(">5h", -1, *box) + t[start:comp_s]
            if instructed:
                ilen, glyph_s = _uint255(t, glyph_s)
                out += struct.pack(">H", ilen) + t[instr_s:instr_s + ilen]
                instr_s += ilen
            x_mins.append(box[0])
        else:
            raise ValueError(f"glyph {g} has {nc} contours")
        out += bytes(-len(out) % 4)
    offsets.append(len(out))
    if any(a > b for a, b in zip((n_points, flag_s, glyph_s, comp_s, bbox_s, instr_s), starts[2:8])):
        raise ValueError("a stream of the glyf table runs into the next one")
    long_loca = bool(index_format) or offsets[-1] > 0x1FFFE  # (the glyphs as written here may need it)
    loca = struct.pack(f">{num_glyphs + 1}I", *offsets) if long_loca else \
        struct.pack(f">{num_glyphs + 1}H", *(o // 2 for o in offsets))
    return bytes(out), loca, x_mins, long_loca


def _simple_points(flags: bytes, dxs: list[int], dys: list[int], overlap: bool) -> bytes:
    """The flags and coordinates of a simple TrueType glyph: steps of up to 255 in a byte, of 0 in
    none."""
    out = bytearray()
    xs = bytearray()
    ys = bytearray()
    for i, (f, dx, dy) in enumerate(zip(flags, dxs, dys)):
        flag = 0 if f & 0x80 else _ON_CURVE
        if i == 0 and overlap:
            flag |= 0x40  # (OVERLAP_SIMPLE)
        for d, short, same, buf in ((dx, _X_SHORT, _X_SAME, xs), (dy, _Y_SHORT, _Y_SAME, ys)):
            if d == 0:
                flag |= same
            elif -255 <= d <= 255:
                flag |= short | (same if d > 0 else 0)
                buf.append(abs(d))
            else:
                buf += struct.pack(">h", d)
        out.append(flag)
    return bytes(out + xs + ys)


def _accumulate(deltas: list[int]) -> list[int]:
    out, v = [], 0
    for d in deltas:
        v += d
        out.append(v)
    return out


def _woff2_triplets(t: bytes, p: int, flags: bytes) -> tuple[list[int], list[int], int]:
    """The x and y steps of a glyph's points, each from a flag and 1 to 4 bytes. The flag's bit 0
    is the sign of the step (of x, when both move), bit 1 the sign of the y step."""
    dxs: list[int] = []
    dys: list[int] = []
    for f in flags:
        f &= 0x7F
        if f < 10:
            dy = ((f & 14) << 7) + t[p]
            dxs.append(0)
            dys.append(dy if f & 1 else -dy)
            p += 1
            continue
        if f < 20:
            dx = (((f - 10) & 14) << 7) + t[p]
            dxs.append(dx if f & 1 else -dx)
            dys.append(0)
            p += 1
            continue
        if f < 84:
            b0, b1 = f - 20, t[p]
            dx, dy = 1 + (b0 & 0x30) + (b1 >> 4), 1 + ((b0 & 0x0C) << 2) + (b1 & 0x0F)
            p += 1
        elif f < 120:
            b0 = f - 84
            dx, dy = 1 + ((b0 // 12) << 8) + t[p], 1 + (((b0 % 12) >> 2) << 8) + t[p + 1]
            p += 2
        elif f < 124:
            b2 = t[p + 1]
            dx, dy = (t[p] << 4) + (b2 >> 4), ((b2 & 0x0F) << 8) + t[p + 2]
            p += 3
        else:
            dx, dy = (t[p] << 8) + t[p + 1], (t[p + 2] << 8) + t[p + 3]
            p += 4
        if p > len(t):
            raise IndexError("the points of a glyph run past the end of the table")
        dxs.append(dx if f & 1 else -dx)
        dys.append(dy if f & 2 else -dy)
    return dxs, dys, p


def _glyph_x_mins(tables: dict[str, bytes]) -> list[int]:
    """Each glyph's xMin from an untransformed glyf table (0 for an empty glyph)."""
    glyf, loca, head = tables["glyf"], tables["loca"], tables["head"]
    n = _u16(tables["maxp"], 4)
    if _i16(head, 50) == 1:
        offsets = struct.unpack_from(f">{n + 1}I", loca)
    else:
        offsets = tuple(2 * v for v in struct.unpack_from(f">{n + 1}H", loca))
    return [_i16(glyf, offsets[g] + 2) if offsets[g + 1] > offsets[g] else 0 for g in range(n)]


def _woff2_hmtx(t: bytes, x_mins: list[int], num_hmetrics: int) -> bytes:
    """The hmtx table of a transformed one: the left side bearings left out are the glyphs'
    xMin."""
    flags = t[0]
    if flags & 0xFC or not flags & 3:
        raise ValueError("a transformed hmtx table with invalid flags")
    num_glyphs = len(x_mins)
    nh = min(num_hmetrics, num_glyphs)
    advances = struct.unpack_from(f">{nh}H", t, 1)
    p = 1 + 2 * nh
    if flags & 1:
        lsbs = x_mins[:nh]
    else:
        lsbs = list(struct.unpack_from(f">{nh}h", t, p))
        p += 2 * nh
    if flags & 2:
        rest = x_mins[nh:]
    else:
        rest = list(struct.unpack_from(f">{num_glyphs - nh}h", t, p))
        p += 2 * (num_glyphs - nh)
    if p != len(t):
        raise ValueError("a transformed hmtx table of the wrong length")
    return b"".join(struct.pack(">Hh", a, s) for a, s in zip(advances, lsbs)) + struct.pack(f">{len(rest)}h", *rest)


def _font_name(table: bytes | None) -> str | None:
    if not table or len(table) < 6:
        return None
    count, strings = _u16(table, 2), _u16(table, 4)
    found: dict[int, str] = {}
    for i in range(count):
        rec = 6 + 12 * i
        platform, encoding, _lang, name_id = (_u16(table, rec + k) for k in (0, 2, 4, 6))
        length, off = _u16(table, rec + 8), _u16(table, rec + 10)
        if name_id not in (1, 2, 4) or name_id in found:
            continue
        raw = table[strings + off:strings + off + length]
        if platform in (0, 3):
            found[name_id] = raw.decode("utf-16-be", "replace")
        elif platform == 1 and encoding == 0:
            found[name_id] = raw.decode("mac-roman", "replace")
    if 4 in found:
        return found[4]
    if 1 in found:
        return found[1] + (f" {found[2]}" if found.get(2) and found[2] != "Regular" else "")
    return None


# =============================================================================
# cmap
# =============================================================================
def _read_cmap(table: bytes) -> dict[int, int]:
    """Character code -> glyph. A symbol font also gets the entry ``-1: 1``."""
    n = _u16(table, 2)
    subtables: dict[tuple[int, int], int] = {}
    for i in range(n):
        platform, encoding, off = _u16(table, 4 + 8 * i), _u16(table, 6 + 8 * i), _u32(table, 8 + 8 * i)
        subtables.setdefault((platform, encoding), off)
    for key in ((3, 10), (0, 6), (0, 4), (3, 1), (0, 3), (0, 2), (0, 1), (0, 0), (3, 0)):
        if key in subtables:
            out = _cmap_subtable(table, subtables[key])
            if out is not None:
                if key == (3, 0):
                    out[-1] = 1
                return out
    raise FontError("the font has no Unicode character map")


def _cmap_subtable(t: bytes, o: int) -> dict[int, int] | None:
    fmt = _u16(t, o)
    out: dict[int, int] = {}
    if fmt == 0:
        for c in range(256):
            out[c] = t[o + 6 + c]
    elif fmt == 4:
        seg2 = _u16(t, o + 6)
        ends, starts = o + 14, o + 16 + seg2
        deltas, ranges = starts + seg2, starts + 2 * seg2
        for s in range(seg2 // 2):
            end, start = _u16(t, ends + 2 * s), _u16(t, starts + 2 * s)
            delta, ro = _u16(t, deltas + 2 * s), _u16(t, ranges + 2 * s)
            if start == 0xFFFF:
                continue
            for c in range(start, end + 1):
                if ro == 0:
                    g = (c + delta) & 0xFFFF
                else:
                    addr = ranges + 2 * s + ro + 2 * (c - start)
                    g = _u16(t, addr) if addr + 1 < len(t) else 0
                    if g:
                        g = (g + delta) & 0xFFFF
                if g:
                    out[c] = g
    elif fmt == 6:
        first, count = _u16(t, o + 6), _u16(t, o + 8)
        for i in range(count):
            out[first + i] = _u16(t, o + 10 + 2 * i)
    elif fmt in (12, 13):
        groups = _u32(t, o + 12)
        for i in range(groups):
            g0 = o + 16 + 12 * i
            start, end, gid = _u32(t, g0), _u32(t, g0 + 4), _u32(t, g0 + 8)
            for c in range(start, end + 1):
                out[c] = gid + (c - start) if fmt == 12 else gid
    else:
        return None
    return {c: g for c, g in out.items() if g}


# =============================================================================
# TrueType outlines
# =============================================================================
_ON_CURVE, _X_SHORT, _Y_SHORT, _REPEAT, _X_SAME, _Y_SAME = 0x01, 0x02, 0x04, 0x08, 0x10, 0x20
_ARG_WORDS, _ARGS_XY, _ROUND, _SCALE, _MORE, _XY_SCALE, _TWO_BY_TWO = 0x1, 0x2, 0x4, 0x8, 0x20, 0x40, 0x80
_SCALED_OFFSET = 0x800


class _TrueTypeOutlines:
    def __init__(self, glyf: bytes, loca: bytes, long_loca: bool, num_glyphs: int):
        self.glyf = glyf
        n = num_glyphs + 1
        if long_loca:
            self.offsets = list(struct.unpack_from(f">{n}I", loca, 0)) if len(loca) >= 4 * n else []
        else:
            self.offsets = [2 * v for v in struct.unpack_from(f">{n}H", loca, 0)] if len(loca) >= 2 * n else []
        if not self.offsets:
            raise FontError("the font's loca table is too short")
        self.num_glyphs = num_glyphs

    @functools.lru_cache(maxsize=4096)
    def contours(self, glyph: int) -> list[Contour]:
        points, on, ends = self._points(glyph, 0)
        out: list[Contour] = []
        start = 0
        for end in ends:
            c = _quadratic_contour(points[start:end + 1], on[start:end + 1])
            if c:
                out.append(c)
            start = end + 1
        return out

    def _points(self, glyph: int, depth: int) -> tuple[list[Point], list[bool], list[int]]:
        if glyph < 0 or glyph >= self.num_glyphs:
            raise FontError(f"glyph {glyph} is not in the font")
        if depth > 12:
            raise FontError("composite glyphs nested too deep")
        o, end = self.offsets[glyph], self.offsets[glyph + 1]
        if end <= o:
            return [], [], []
        g = self.glyf
        n = _i16(g, o)
        if n >= 0:
            return _simple_glyph(g, o, n)
        return self._composite(o + 10, depth)

    def _composite(self, p: int, depth: int) -> tuple[list[Point], list[bool], list[int]]:
        g = self.glyf
        points: list[Point] = []
        on: list[bool] = []
        ends: list[int] = []
        while True:
            flags, child = _u16(g, p), _u16(g, p + 2)
            p += 4
            if flags & _ARG_WORDS:
                a1, a2 = (_i16(g, p), _i16(g, p + 2)) if flags & _ARGS_XY else (_u16(g, p), _u16(g, p + 2))
                p += 4
            else:
                a1, a2 = (struct.unpack_from(">bb", g, p) if flags & _ARGS_XY else (g[p], g[p + 1]))
                p += 2
            xx, xy, yx, yy = 1.0, 0.0, 0.0, 1.0  # x' = xx*x + yx*y, y' = xy*x + yy*y
            if flags & _SCALE:
                xx = yy = _f2dot14(g, p)
                p += 2
            elif flags & _XY_SCALE:
                xx, yy = _f2dot14(g, p), _f2dot14(g, p + 2)
                p += 4
            elif flags & _TWO_BY_TWO:
                xx, xy, yx, yy = _f2dot14(g, p), _f2dot14(g, p + 2), _f2dot14(g, p + 4), _f2dot14(g, p + 6)
                p += 8
            cpts, con, cends = self._points(child, depth + 1)
            moved = [(xx * x + yx * y, xy * x + yy * y) for x, y in cpts]
            if flags & _ARGS_XY:
                dx, dy = float(a1), float(a2)
                if flags & _SCALED_OFFSET:
                    dx, dy = xx * dx + yx * dy, xy * dx + yy * dy
            else:  # point matching: the child's point a2 goes onto the parent's point a1
                if a1 >= len(points) or a2 >= len(moved):
                    raise FontError("a composite glyph matches a point that does not exist")
                dx, dy = points[a1][0] - moved[a2][0], points[a1][1] - moved[a2][1]
            base = len(points)
            points.extend((x + dx, y + dy) for x, y in moved)
            on.extend(con)
            ends.extend(base + e for e in cends)
            if not flags & _MORE:
                break
        return points, on, ends


def _simple_glyph(g: bytes, o: int, n: int) -> tuple[list[Point], list[bool], list[int]]:
    if n == 0:
        return [], [], []
    ends = list(struct.unpack_from(f">{n}H", g, o + 10))
    count = ends[-1] + 1
    p = o + 10 + 2 * n
    p += 2 + _u16(g, p)  # instructions
    flags: list[int] = []
    while len(flags) < count:
        f = g[p]
        p += 1
        flags.append(f)
        if f & _REPEAT:
            flags.extend([f] * g[p])
            p += 1
    flags = flags[:count]
    xs: list[float] = []
    v = 0
    for f in flags:
        if f & _X_SHORT:
            d = g[p]
            p += 1
            v += d if f & _X_SAME else -d
        elif not f & _X_SAME:
            v += _i16(g, p)
            p += 2
        xs.append(float(v))
    ys: list[float] = []
    v = 0
    for f in flags:
        if f & _Y_SHORT:
            d = g[p]
            p += 1
            v += d if f & _Y_SAME else -d
        elif not f & _Y_SAME:
            v += _i16(g, p)
            p += 2
        ys.append(float(v))
    return list(zip(xs, ys)), [bool(f & _ON_CURVE) for f in flags], ends


def _quadratic_contour(points: Sequence[Point], on: Sequence[bool]) -> Contour:
    """Lines and quadratic Béziers of a closed TrueType contour, with the implied on-curve
    points between two off-curve points made explicit."""
    n = len(points)
    if n < 2:
        return []
    if not any(on):  # only off-curve points: start at the midpoint of the last and the first
        first = _mid(points[-1], points[0])
        pts, flags = [first, *points], [True, *on]
    else:
        k = list(on).index(True)
        pts, flags = list(points[k:]) + list(points[:k]), list(on[k:]) + list(on[:k])
    pts.append(pts[0])
    flags.append(True)
    out: Contour = []
    cur = pts[0]
    ctrl: Point | None = None
    for p, is_on in zip(pts[1:], flags[1:]):
        if is_on:
            seg: Segment = (cur, ctrl, p) if ctrl is not None else (cur, p)
            if seg[0] != seg[-1] or len(seg) == 3:
                out.append(seg)
            cur, ctrl = p, None
        elif ctrl is None:
            ctrl = p
        else:
            m = _mid(ctrl, p)
            out.append((cur, ctrl, m))
            cur, ctrl = m, p
    return [s for s in out if not all(q == s[0] for q in s)]


def _mid(a: Point, b: Point) -> Point:
    return ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)


# =============================================================================
# CFF and CFF2 outlines (Type 2 charstrings)
# =============================================================================
def _cff_index(b: bytes, o: int, cff2: bool = False) -> tuple[list[bytes], int]:
    """The items of a CFF INDEX at ``o`` and the offset after it (CFF2 counts them in 4 bytes)."""
    count, o = (_u32(b, o), o + 4) if cff2 else (_u16(b, o), o + 2)
    if count == 0:
        return [], o
    size = b[o]
    offs = []
    p = o + 1
    for _ in range(count + 1):
        v = 0
        for k in range(size):
            v = (v << 8) | b[p + k]
        offs.append(v)
        p += size
    base = p - 1
    return [b[base + offs[i]:base + offs[i + 1]] for i in range(count)], base + offs[-1]


def _cff_dict(d: bytes, regions: Callable[[int], int] | None = None) -> dict[int, list[float]]:
    """A CFF DICT: its operators' operands. A CFF2 one (``regions``: the number of regions of an
    item variation data) can have ``vsindex`` (22), which picks the data, and ``blend``, whose
    values here are the default ones."""
    out: dict[int, list[float]] = {}
    ops: list[float] = []
    vsindex = 0
    i = 0
    while i < len(d):
        b0 = d[i]
        if regions is not None and b0 == 23:  # blend: n defaults, n x regions deltas, n
            n = int(ops.pop()) if ops else -1
            base = len(ops) - n * (regions(vsindex) + 1)
            if n < 0 or base < 0:
                raise FontError("a blend without its operands")
            del ops[base + n:]
            i += 1
        elif b0 <= 24:  # (22, 23 and 24 are CFF2's vsindex, blend and vstore)
            if b0 == 12:
                key = 1200 + d[i + 1]
                i += 2
            else:
                key = b0
                i += 1
            if key == 22:
                vsindex = int(ops[-1]) if ops else 0
            out[key] = ops
            ops = []
        elif b0 == 28:
            ops.append(_i16(d, i + 1))
            i += 3
        elif b0 == 29:
            ops.append(struct.unpack_from(">i", d, i + 1)[0])
            i += 5
        elif b0 == 30:  # real number in nibbles
            s = ""
            i += 1
            done = False
            while not done:
                byte = d[i]
                i += 1
                for nib in (byte >> 4, byte & 15):
                    if nib == 15:
                        done = True
                        break
                    s += "0123456789.EE?-"[nib] + ("-" if nib == 12 else "")
            ops.append(float(s.replace("E-", "e-").replace("E", "e") or 0))
        elif 32 <= b0 <= 246:
            ops.append(b0 - 139)
            i += 1
        elif 247 <= b0 <= 250:
            ops.append((b0 - 247) * 256 + d[i + 1] + 108)
            i += 2
        elif 251 <= b0 <= 254:
            ops.append(-(b0 - 251) * 256 - d[i + 1] - 108)
            i += 2
        else:
            i += 1
    return out


def _subr_bias(n: int) -> int:
    return 107 if n < 1240 else 1131 if n < 33900 else 32768


# CFF's standard strings 1 to 149: the names of the characters of StandardEncoding, which an
# accent built with seac names by code (the codes of the strings in order).
_STANDARD_NAMES = (
    "space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma "
    "hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater "
    "question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright "
    "asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar "
    "braceright asciitilde exclamdown cent sterling fraction yen florin section currency quotesingle "
    "quotedblleft guillemotleft guilsinglleft guilsinglright fi fl endash dagger daggerdbl periodcentered "
    "paragraph bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand "
    "questiondown grave acute circumflex tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek "
    "caron emdash AE ordfeminine Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls"
).split()
_STANDARD_CODES = [c for lo, hi in ((32, 126), (161, 175), (177, 180), (182, 189), (191, 191), (193, 200),
                                    (202, 203), (205, 208), (225, 225), (227, 227), (232, 235), (241, 241),
                                    (245, 245), (248, 251)) for c in range(lo, hi + 1)]
_STANDARD_ENCODING = {c: sid for sid, c in enumerate(_STANDARD_CODES, 1)}  # code -> string id


class _CFFOutlines:
    def __init__(self, cff: bytes, units_per_em: int):
        o = cff[2]  # header size
        _names, o = _cff_index(cff, o)
        tops, o = _cff_index(cff, o)
        self.strings, o = _cff_index(cff, o)
        self.gsubrs, _ = _cff_index(cff, o)
        top = _cff_dict(tops[0])
        if 17 not in top:
            raise FontError("the CFF table has no charstrings")
        self.charstrings, _ = _cff_index(cff, int(top[17][0]))
        # Charstrings are in font units when the font matrix is the usual 1 / units per em (often
        # written with few digits); a font matrix for another em size scales them.
        matrix = top.get(1207, [0.001, 0, 0, 0.001, 0, 0])
        ratio = float(matrix[0]) * units_per_em
        self.scale = 1.0 if not matrix[0] or abs(ratio - 1.0) < 1e-3 else ratio
        self.lsubrs: list[list[bytes]] = []
        self.fd_of: list[int] | None = None
        self.cff = cff
        self.charset = int(top.get(15, [0])[0])
        self._by_sid: dict[int, int] | None = None
        if 1236 in top:  # CID-keyed: one private dict (and local subroutines) per font dict
            fds, _ = _cff_index(cff, int(top[1236][0]))
            self.lsubrs = [self._private_subrs(cff, _cff_dict(fd)) for fd in fds]
            self.fd_of = _fd_select(cff, int(top[1237][0]), len(self.charstrings))
        else:
            self.lsubrs = [self._private_subrs(cff, top)]

    @staticmethod
    def _private_subrs(cff: bytes, d: dict[int, list[float]]) -> list[bytes]:
        if 18 not in d:
            return []
        size, off = int(d[18][0]), int(d[18][1])
        priv = _cff_dict(cff[off:off + size])
        if 19 not in priv:
            return []
        subrs, _ = _cff_index(cff, off + int(priv[19][0]))
        return subrs

    @functools.lru_cache(maxsize=4096)
    def contours(self, glyph: int) -> list[Contour]:
        contours = self._contours(glyph, 0)
        if self.scale != 1.0:
            s = self.scale
            contours = [[tuple((x * s, y * s) for x, y in seg) for seg in c] for c in contours]
        return contours

    def _contours(self, glyph: int, depth: int) -> list[Contour]:
        if glyph < 0 or glyph >= len(self.charstrings):
            raise FontError(f"glyph {glyph} is not in the font")
        local = self.lsubrs[self.fd_of[glyph] if self.fd_of is not None else 0] if self.lsubrs else []
        t = _Type2(self.gsubrs, local)
        contours = t.run(self.charstrings[glyph])
        if t.seac is not None:  # an accented character: its base and accent glyphs, the accent moved
            if self.fd_of is not None or depth > 2:
                raise FontError("an accent built with seac where seac is not allowed")
            adx, ady, base, accent = t.seac
            moved = [[tuple((x + adx, y + ady) for x, y in seg) for seg in c]
                     for c in self._contours(self._standard_glyph(accent), depth + 1)]
            contours = contours + self._contours(self._standard_glyph(base), depth + 1) + moved
        return contours

    def _standard_glyph(self, code: int) -> int:
        """The glyph of a character code of StandardEncoding (seac's base and accent): the glyph
        whose name, by the font's charset, is the character's."""
        sid = _STANDARD_ENCODING.get(code)
        if sid is None:
            raise FontError(f"an accent built with seac names code {code}, which StandardEncoding does not have")
        if self._by_sid is None:
            self._by_sid = {}
            for g, s in enumerate(self._charset()):
                if s >= 391 and 0 <= s - 391 < len(self.strings):  # a name of the font's own
                    name = self.strings[s - 391].decode("latin-1")
                    s = _STANDARD_NAMES.index(name) + 1 if name in _STANDARD_NAMES else s
                self._by_sid.setdefault(s, g)
        g = self._by_sid.get(sid)
        if g is None:
            raise FontError(f"an accent built with seac needs glyph {_STANDARD_NAMES[sid - 1]!r}, which the font "
                            "does not have")
        return g

    def _charset(self) -> list[int]:
        """The string id of each glyph's name."""
        n = len(self.charstrings)
        if self.charset == 0:  # ISOAdobe: the standard strings in order
            return list(range(n))
        if self.charset in (1, 2):  # the expert charsets: none of their names is StandardEncoding's
            return []
        cff, o = self.cff, self.charset
        fmt = cff[o]
        out = [0]
        if fmt == 0:
            out += struct.unpack_from(f">{n - 1}H", cff, o + 1)
        elif fmt in (1, 2):
            p = o + 1
            while len(out) < n:
                first = _u16(cff, p)
                left = cff[p + 2] if fmt == 1 else _u16(cff, p + 2)
                p += 3 if fmt == 1 else 4
                out += range(first, first + left + 1)
        else:
            raise FontError(f"unknown charset format {fmt}")
        return out[:n]


class _CFF2Outlines:
    """Outlines of a CFF2 table: those of a variable font's default instance."""

    def __init__(self, cff: bytes, units_per_em: int):
        o = cff[2]  # header size
        size = _u16(cff, 3)
        top = _cff_dict(cff[o:o + size])
        self.gsubrs, _ = _cff_index(cff, o + size, cff2=True)
        if 17 not in top:
            raise FontError("the CFF2 table has no charstrings")
        self.charstrings, _ = _cff_index(cff, int(top[17][0]), cff2=True)
        matrix = top.get(1207, [0.001, 0, 0, 0.001, 0, 0])
        ratio = float(matrix[0]) * units_per_em
        self.scale = 1.0 if not matrix[0] or abs(ratio - 1.0) < 1e-3 else ratio
        self.region_counts = _variation_regions(cff, int(top[24][0])) if 24 in top else []
        self.lsubrs: list[list[bytes]] = []
        self.vsindex: list[int] = []
        fds, _ = _cff_index(cff, int(top[1236][0]), cff2=True) if 1236 in top else ([], 0)
        for fd in fds:
            d = _cff_dict(fd, self.regions)
            subrs, vsindex = [], 0
            if 18 in d:
                psize, off = int(d[18][0]), int(d[18][1])
                priv = _cff_dict(cff[off:off + psize], self.regions)
                vsindex = int(priv.get(22, [0])[0])
                if 19 in priv:
                    subrs, _ = _cff_index(cff, off + int(priv[19][0]), cff2=True)
            self.lsubrs.append(subrs)
            self.vsindex.append(vsindex)
        self.fd_of = _fd_select(cff, int(top[1237][0]), len(self.charstrings)) if 1237 in top else None

    def regions(self, vsindex: int) -> int:
        """The number of regions of item variation data ``vsindex``: the deltas of each blended value."""
        if not 0 <= vsindex < len(self.region_counts):
            raise FontError(f"a charstring blends with item variation data {vsindex}, which the font does not have")
        return self.region_counts[vsindex]

    @functools.lru_cache(maxsize=4096)
    def contours(self, glyph: int) -> list[Contour]:
        if glyph < 0 or glyph >= len(self.charstrings):
            raise FontError(f"glyph {glyph} is not in the font")
        fd = self.fd_of[glyph] if self.fd_of is not None else 0
        if fd >= len(self.lsubrs) and self.lsubrs:
            raise FontError(f"glyph {glyph} has a font dict the font does not have")
        local, vsindex = (self.lsubrs[fd], self.vsindex[fd]) if self.lsubrs else ([], 0)
        contours = _Type2(self.gsubrs, local, self.regions, vsindex).run(self.charstrings[glyph])
        if self.scale != 1.0:
            s = self.scale
            contours = [[tuple((x * s, y * s) for x, y in seg) for seg in c] for c in contours]
        return contours


def _variation_regions(cff: bytes, o: int) -> list[int]:
    """The number of regions of each item variation data of a CFF2 VariationStore at ``o``."""
    o += 2  # (the length of the store)
    if _u16(cff, o) != 1:
        raise FontError(f"unknown item variation store format {_u16(cff, o)}")
    return [_u16(cff, o + _u32(cff, o + 8 + 4 * i) + 4) for i in range(_u16(cff, o + 6))]


def _fd_select(cff: bytes, o: int, n: int) -> list[int]:
    fmt = cff[o]
    if fmt == 0:
        return list(cff[o + 1:o + 1 + n])
    if fmt in (3, 4):  # ranges: the first glyph and the font dict (format 4: 32-bit glyphs, 16-bit dicts)
        g_size, fd_size = (2, 1) if fmt == 3 else (4, 2)
        count = _u16(cff, o + 1) if fmt == 3 else _u32(cff, o + 1)
        p = o + 1 + g_size
        rec = g_size + fd_size

        def number(at: int, size: int) -> int:
            return cff[at] if size == 1 else _u16(cff, at) if size == 2 else _u32(cff, at)

        out = [0] * n
        for i in range(count):
            first, fd = number(p + rec * i, g_size), number(p + rec * i + g_size, fd_size)
            last = number(p + rec * (i + 1), g_size)
            for g in range(first, min(last, n)):
                out[g] = fd
        return out
    raise FontError(f"unknown FDSelect format {fmt}")


class _Type2:
    """Interpreter of Type 2 charstrings: returns the contours, ignoring hints. With ``regions``
    (the number of regions of an item variation data) the charstrings are CFF2's: no widths, and
    ``blend`` keeps the default values (``vsindex`` picks the data). An accent built with seac
    leaves its offset and character codes in ``seac``."""

    def __init__(self, gsubrs: list[bytes], lsubrs: list[bytes], regions: Callable[[int], int] | None = None,
                 vsindex: int = 0):
        self.gsubrs, self.lsubrs = gsubrs, lsubrs
        self.gbias, self.lbias = _subr_bias(len(gsubrs)), _subr_bias(len(lsubrs))
        self.regions, self.vsindex = regions, vsindex
        self.stack: list[float] = []
        self.contours: list[Contour] = []
        self.current: Contour = []
        self.x = self.y = 0.0
        self.start = (0.0, 0.0)
        self.stems = 0
        self.width_done = regions is not None  # (CFF2 charstrings have no widths)
        self.ended = False
        self.seac: tuple[float, float, int, int] | None = None

    def run(self, code: bytes) -> list[Contour]:
        self._execute(code, 0)
        self._close()
        return self.contours

    # -- path building --------------------------------------------------------------
    def _close(self) -> None:
        if self.current:
            last = self.current[-1][-1]
            if last != self.start:
                self.current.append((last, self.start))
            self.contours.append(self.current)
        self.current = []

    def _move(self, dx: float, dy: float) -> None:
        self._close()
        self.x += dx
        self.y += dy
        self.start = (self.x, self.y)

    def _line(self, dx: float, dy: float) -> None:
        a = (self.x, self.y)
        self.x += dx
        self.y += dy
        if (self.x, self.y) != a:
            self.current.append((a, (self.x, self.y)))

    def _curve(self, dxa: float, dya: float, dxb: float, dyb: float, dxc: float, dyc: float) -> None:
        a = (self.x, self.y)
        b = (a[0] + dxa, a[1] + dya)
        c = (b[0] + dxb, b[1] + dyb)
        d = (c[0] + dxc, c[1] + dyc)
        self.x, self.y = d
        if not (a == b == c == d):
            self.current.append((a, b, c, d))

    def _width(self, present: bool) -> None:
        """Drop the advance width that may precede the first stack-clearing operator
        (``present`` says whether the stack holds one more number than the operator takes)."""
        if not self.width_done:
            self.width_done = True
            if present:
                self.stack.pop(0)

    # -- interpreter ------------------------------------------------------------------
    def _execute(self, code: bytes, depth: int) -> None:
        if depth > 10:
            raise FontError("charstring subroutines nested too deep")
        s = self.stack
        i = 0
        n = len(code)
        while i < n and not self.ended:
            b0 = code[i]
            i += 1
            if b0 >= 32:
                if b0 <= 246:
                    s.append(b0 - 139)
                elif b0 <= 250:
                    s.append((b0 - 247) * 256 + code[i] + 108)
                    i += 1
                elif b0 <= 254:
                    s.append(-(b0 - 251) * 256 - code[i] - 108)
                    i += 1
                else:
                    s.append(struct.unpack_from(">i", code, i)[0] / 65536.0)
                    i += 4
                continue
            if b0 == 28:
                s.append(_i16(code, i))
                i += 2
                continue
            if b0 in (1, 3, 18, 23):  # hstem, vstem, hstemhm, vstemhm
                self._width(len(s) % 2 == 1)
                self.stems += len(s) // 2
                s.clear()
            elif b0 in (19, 20):  # hintmask, cntrmask
                self._width(len(s) % 2 == 1)
                self.stems += len(s) // 2
                s.clear()
                i += (self.stems + 7) // 8
            elif b0 == 21:  # rmoveto
                self._width(len(s) > 2)
                self._move(s[-2], s[-1])
                s.clear()
            elif b0 == 22:  # hmoveto
                self._width(len(s) > 1)
                self._move(s[-1], 0)
                s.clear()
            elif b0 == 4:  # vmoveto
                self._width(len(s) > 1)
                self._move(0, s[-1])
                s.clear()
            elif b0 == 5:  # rlineto
                for k in range(0, len(s) - 1, 2):
                    self._line(s[k], s[k + 1])
                s.clear()
            elif b0 in (6, 7):  # hlineto, vlineto
                horizontal = b0 == 6
                for v in s:
                    self._line(v, 0) if horizontal else self._line(0, v)
                    horizontal = not horizontal
                s.clear()
            elif b0 == 8:  # rrcurveto
                for k in range(0, len(s) - 5, 6):
                    self._curve(*s[k:k + 6])
                s.clear()
            elif b0 == 27:  # hhcurveto
                k = 0
                dy1 = 0.0
                if len(s) % 4 == 1:
                    dy1, k = s[0], 1
                while k + 3 < len(s):
                    self._curve(s[k], dy1, s[k + 1], s[k + 2], s[k + 3], 0)
                    dy1 = 0.0
                    k += 4
                s.clear()
            elif b0 == 26:  # vvcurveto
                k = 0
                dx1 = 0.0
                if len(s) % 4 == 1:
                    dx1, k = s[0], 1
                while k + 3 < len(s):
                    self._curve(dx1, s[k], s[k + 1], s[k + 2], 0, s[k + 3])
                    dx1 = 0.0
                    k += 4
                s.clear()
            elif b0 in (30, 31):  # vhcurveto, hvcurveto
                horizontal = b0 == 31
                k = 0
                while k + 3 < len(s):
                    last = s[k + 4] if len(s) - k == 5 else 0.0
                    if horizontal:
                        self._curve(s[k], 0, s[k + 1], s[k + 2], last, s[k + 3])
                    else:
                        self._curve(0, s[k], s[k + 1], s[k + 2], s[k + 3], last)
                    horizontal = not horizontal
                    k += 4
                s.clear()
            elif b0 == 24:  # rcurveline
                k = 0
                while len(s) - k >= 8:
                    self._curve(*s[k:k + 6])
                    k += 6
                self._line(s[k], s[k + 1])
                s.clear()
            elif b0 == 25:  # rlinecurve
                k = 0
                while len(s) - k >= 8:
                    self._line(s[k], s[k + 1])
                    k += 2
                self._curve(*s[k:k + 6])
                s.clear()
            elif b0 == 10:  # callsubr
                idx = int(s.pop()) + self.lbias
                if not 0 <= idx < len(self.lsubrs):
                    raise FontError("a charstring calls a subroutine that does not exist")
                self._execute(self.lsubrs[idx], depth + 1)
            elif b0 == 29:  # callgsubr
                idx = int(s.pop()) + self.gbias
                if not 0 <= idx < len(self.gsubrs):
                    raise FontError("a charstring calls a subroutine that does not exist")
                self._execute(self.gsubrs[idx], depth + 1)
            elif b0 == 11:  # return
                return
            elif b0 == 14:  # endchar
                self._width(len(s) in (1, 5))
                if len(s) >= 4:  # seac: the accent's offset, the base's and the accent's codes
                    self.seac = (s[-4], s[-3], int(s[-2]), int(s[-1]))
                s.clear()
                self.ended = True
            elif b0 == 16 and self.regions is not None:  # blend: k defaults, k x regions deltas, k
                k = int(s.pop()) if s else -1
                base = len(s) - k * (self.regions(self.vsindex) + 1)
                if k < 0 or base < 0:
                    raise FontError("a blend without its operands")
                del s[base + k:]
            elif b0 == 15 and self.regions is not None:  # vsindex
                self.vsindex = int(s.pop()) if s else 0
                s.clear()
            elif b0 == 12:
                b1 = code[i]
                i += 1
                self._escape(b1)
            else:
                raise FontError(f"unknown charstring operator {b0}")

    def _escape(self, op: int) -> None:
        s = self.stack
        if op == 35:  # flex
            self._curve(*s[0:6])
            self._curve(*s[6:12])
        elif op == 34:  # hflex
            dx1, dx2, dy2, dx3, dx4, dx5, dx6 = s[:7]
            self._curve(dx1, 0, dx2, dy2, dx3, 0)
            self._curve(dx4, 0, dx5, -dy2, dx6, 0)
        elif op == 36:  # hflex1
            dx1, dy1, dx2, dy2, dx3, dx4, dx5, dy5, dx6 = s[:9]
            self._curve(dx1, dy1, dx2, dy2, dx3, 0)
            self._curve(dx4, 0, dx5, dy5, dx6, -(dy1 + dy2 + dy5))
        elif op == 37:  # flex1
            d = s[:11]
            dx = d[0] + d[2] + d[4] + d[6] + d[8]
            dy = d[1] + d[3] + d[5] + d[7] + d[9]
            self._curve(*d[0:6])
            if abs(dx) > abs(dy):
                self._curve(d[6], d[7], d[8], d[9], d[10], -dy)
            else:
                self._curve(d[6], d[7], d[8], d[9], -dx, d[10])
        elif op == 0:  # dotsection (obsolete)
            pass
        elif op == 9:
            s.append(abs(s.pop()))
            return
        elif op in (10, 11, 12, 24):
            b, a = s.pop(), s.pop()
            s.append(a + b if op == 10 else a - b if op == 11 else a / b if op == 12 else a * b)
            return
        elif op == 14:
            s.append(-s.pop())
            return
        elif op == 18:
            s.pop()
            return
        elif op == 27:
            s.append(s[-1])
            return
        elif op == 28:
            s[-1], s[-2] = s[-2], s[-1]
            return
        else:
            raise FontError(f"charstring operator 12 {op} is not supported")
        s.clear()


# =============================================================================
# Kerning: GPOS pair adjustment, kern table
# =============================================================================
class _Kerning:
    def __init__(self, gpos: bytes | None, kern: bytes | None):
        self.lookups: list[list[Any]] = _gpos_kern_lookups(gpos) if gpos else []
        self.table: dict[tuple[int, int], int] = {}
        if self.lookups:
            self.source: str | None = "GPOS"
        elif kern:
            self.table = _kern_table(kern)
            self.source = "kern" if self.table else None
        else:
            self.source = None
        self.cache: dict[tuple[int, int], PairAdjustment] = {}

    def pair(self, left: int, right: int) -> PairAdjustment:
        key = (left, right)
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        if self.lookups:
            a1 = p1 = a2 = p2 = 0.0
            for subtables in self.lookups:
                for st in subtables:
                    found = st.find(left, right)
                    if found is not None:
                        v1, v2 = found
                        p1 += v1[0]
                        a1 += v1[2]
                        p2 += v2[0]
                        a2 += v2[2]
                        break
            result = PairAdjustment(a1, p1, a2, p2) if (a1 or p1 or a2 or p2) else _NO_PAIR
        else:
            v = self.table.get(key, 0)
            result = PairAdjustment(float(v)) if v else _NO_PAIR
        self.cache[key] = result
        return result


def _kern_table(t: bytes) -> dict[tuple[int, int], int]:
    out: dict[tuple[int, int], int] = {}
    if len(t) < 4:
        return out
    apple = _u32(t, 0) == 0x00010000
    if apple:
        n, p = _u32(t, 4), 8
    else:
        n, p = _u16(t, 2), 4
    for _ in range(n):
        if apple:
            length, coverage = _u32(t, p), _u16(t, p + 4)
            fmt, horizontal = coverage & 0xFF, not coverage & 0x8000
            usable = horizontal and not coverage & 0x4000 and not coverage & 0x2000
            head = 8
        else:
            length, coverage = _u16(t, p + 2), _u16(t, p + 4)
            fmt, usable = coverage >> 8, bool(coverage & 1) and not coverage & 0x6
            head = 6
        if fmt == 0 and usable:
            pairs = _u16(t, p + head)
            q = p + head + 8
            for k in range(pairs):
                r = q + 6 * k
                key = (_u16(t, r), _u16(t, r + 2))
                out[key] = out.get(key, 0) + _i16(t, r + 4)
            length = max(length, head + 8 + 6 * pairs)  # the 16-bit length of big subtables overflows
        p += length
    return out


def _gpos_kern_lookups(t: bytes) -> list[list[Any]]:
    """The pair-adjustment subtables of the lookups of every ``kern`` feature, in lookup order."""
    if len(t) < 10:
        return []
    features, lookups = _u16(t, 6), _u16(t, 8)
    wanted: set[int] = set()
    count = _u16(t, features)
    for i in range(count):
        rec = features + 2 + 6 * i
        if t[rec:rec + 4] == b"kern":
            f = features + _u16(t, rec + 4)
            wanted.update(_u16(t, f + 4 + 2 * k) for k in range(_u16(t, f + 2)))
    out: list[list[Any]] = []
    for li in sorted(wanted):
        lk = lookups + _u16(t, lookups + 2 + 2 * li)
        kind, nsub = _u16(t, lk), _u16(t, lk + 4)
        subtables = []
        for k in range(nsub):
            st = lk + _u16(t, lk + 6 + 2 * k)
            st_kind = kind
            if kind == 9:  # extension
                st_kind, st = _u16(t, st + 2), st + _u32(t, st + 4)
            if st_kind == 2:
                subtables.append(_PairPos(t, st))
        if subtables:
            out.append(subtables)
    return out


_VALUE_FIELDS = 4  # XPlacement, YPlacement, XAdvance, YAdvance


def _value_record(t: bytes, o: int, fmt: int) -> tuple[tuple[int, int, int, int], int]:
    vals = [0, 0, 0, 0]
    for bit in range(8):
        if fmt & (1 << bit):
            if bit < _VALUE_FIELDS:
                vals[bit] = _i16(t, o)
            o += 2
    return (vals[0], vals[1], vals[2], vals[3]), o


def _coverage(t: bytes, o: int) -> dict[int, int]:
    fmt = _u16(t, o)
    out: dict[int, int] = {}
    if fmt == 1:
        for i in range(_u16(t, o + 2)):
            out[_u16(t, o + 4 + 2 * i)] = i
    elif fmt == 2:
        for i in range(_u16(t, o + 2)):
            r = o + 4 + 6 * i
            start, end, index = _u16(t, r), _u16(t, r + 2), _u16(t, r + 4)
            for g in range(start, end + 1):
                out[g] = index + g - start
    return out


def _class_def(t: bytes, o: int) -> dict[int, int]:
    fmt = _u16(t, o)
    out: dict[int, int] = {}
    if fmt == 1:
        start, count = _u16(t, o + 2), _u16(t, o + 4)
        for i in range(count):
            out[start + i] = _u16(t, o + 6 + 2 * i)
    elif fmt == 2:
        for i in range(_u16(t, o + 2)):
            r = o + 4 + 6 * i
            start, end, cls = _u16(t, r), _u16(t, r + 2), _u16(t, r + 4)
            for g in range(start, end + 1):
                out[g] = cls
    return out


class _PairPos:
    """One PairPos subtable, parsed on first use."""

    def __init__(self, t: bytes, o: int):
        self.t, self.o = t, o
        self.parsed = False

    def _parse(self) -> None:
        t, o = self.t, self.o
        self.fmt = _u16(t, o)
        self.coverage = _coverage(t, o + _u16(t, o + 2))
        self.f1, self.f2 = _u16(t, o + 4), _u16(t, o + 6)
        if self.fmt == 1:
            self.sets: dict[int, dict[int, Any]] = {}
            self.set_offsets = [o + _u16(t, o + 10 + 2 * i) for i in range(_u16(t, o + 8))]
        elif self.fmt == 2:
            self.cd1 = _class_def(t, o + _u16(t, o + 8))
            self.cd2 = _class_def(t, o + _u16(t, o + 10))
            self.c1, self.c2 = _u16(t, o + 12), _u16(t, o + 14)
            self.records = o + 16
            self.size = 2 * (bin(self.f1).count("1") + bin(self.f2).count("1"))
        self.parsed = True

    def _pair_set(self, index: int) -> dict[int, Any]:
        found = self.sets.get(index)
        if found is None:
            t, o = self.t, self.set_offsets[index]
            found = {}
            p = o + 2
            for _ in range(_u16(t, o)):
                second = _u16(t, p)
                v1, p = _value_record(t, p + 2, self.f1)
                v2, p = _value_record(t, p, self.f2)
                found[second] = (v1, v2)
            self.sets[index] = found
        return found

    def find(self, left: int, right: int) -> Any:
        if not self.parsed:
            self._parse()
        index = self.coverage.get(left)
        if index is None:
            return None
        if self.fmt == 1:
            return self._pair_set(index).get(right)
        if self.fmt == 2:
            a, b = self.cd1.get(left, 0), self.cd2.get(right, 0)
            if a >= self.c1 or b >= self.c2:
                return None
            r = self.records + (a * self.c2 + b) * self.size
            v1, r = _value_record(self.t, r, self.f1)
            v2, _ = _value_record(self.t, r, self.f2)
            return v1, v2
        return None
