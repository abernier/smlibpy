"""Reading TrueType and OpenType fonts: characters, metrics, kerning and exact glyph outlines.

A compact reader without dependencies. It reads sfnt files (TTF, OTF), font collections (TTC,
the first font) and WOFF files, and from them the tables a text layout needs:

- ``cmap`` (formats 0, 4, 6, 12 and 13), ``head``, ``hhea``, ``hmtx``, ``maxp``, ``OS/2``,
  ``name``;
- outlines: ``glyf``/``loca`` (simple and composite glyphs, every transform form, point
  matching) and ``CFF `` (Type 2 charstrings with local and global subroutines, flex, hint
  masks, CID-keyed fonts);
- kerning: ``GPOS`` pair adjustment (formats 1 and 2, extension lookups) and the ``kern``
  table (format 0, Microsoft and Apple headers).

fontTools is used, when installed, for what this reader does not do: WOFF2 files and variable
CFF2 outlines.

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
from typing import Any, NamedTuple, Sequence

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


def load_font(path: str | os.PathLike[str] | bytes | None = None) -> Font:
    """The font at ``path`` (the bundled default without one), read once and kept; or the font of
    the bytes of a font file (``bytes``, such as an upload), read once per contents."""
    if isinstance(path, (bytes, bytearray, memoryview)):
        return _bytes_font(bytes(path))
    p = Path(os.fspath(path)).expanduser() if path is not None else DEFAULT_FONT
    if not p.is_file():
        raise FileNotFoundError(f"no font file {str(p)!r}")
    st = p.stat()
    return _cached_font(str(p.resolve()), st.st_mtime_ns, st.st_size)


@functools.lru_cache(maxsize=16)
def _cached_font(path: str, mtime: int, size: int) -> Font:
    return Font(path)


@functools.lru_cache(maxsize=16)
def _bytes_font(data: bytes) -> Font:
    return Font(data)


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

    def __init__(self, path: str | os.PathLike[str] | bytes):
        #: The font file's path; None for a font read from bytes.
        self.path: str | None
        if isinstance(path, (bytes, bytearray, memoryview)):
            self.path = None
            data = bytes(path)
            self._source: str | bytes = data
        else:
            self.path = os.fspath(path)
            with open(self.path, "rb") as fh:
                data = fh.read()
            self._source = self.path
        label = self.path if self.path is not None else "font data"
        self._tables, self._fonttools = _read_tables(data, label, self._source)
        for tag in ("head", "hhea", "hmtx", "maxp", "cmap"):
            if tag not in self._tables:
                raise FontError(f"{label}: not a usable font (no {tag!r} table)")
        head = self._tables["head"]
        self.units_per_em = _u16(head, 18)
        self._long_loca = _i16(head, 50) == 1
        self.num_glyphs = _u16(self._tables["maxp"], 4)
        self._num_hmetrics = _u16(self._tables["hhea"], 34)
        os2 = self._tables.get("OS/2")
        cap = _i16(os2, 88) if os2 is not None and len(os2) >= 90 and _u16(os2, 0) >= 2 else 0
        self.name = _font_name(self._tables.get("name")) or (Path(self.path).stem if self.path else "font")
        if "glyf" in self._tables and "loca" in self._tables:
            self._outlines: Any = _TrueTypeOutlines(self._tables["glyf"], self._tables["loca"], self._long_loca,
                                                    self.num_glyphs)
        elif "CFF " in self._tables:
            self._outlines = _CFFOutlines(self._tables["CFF "], self.units_per_em)
        elif self._fonttools is not None:
            self._outlines = _FontToolsOutlines(self._fonttools)
        else:
            kind = "CFF2 (variable OpenType)" if "CFF2" in self._tables else "this kind of"
            raise FontError(f"{label}: {kind} outlines need the fontTools package; "
                            "install it or use a TrueType or CFF font")
        self._cmap = _read_cmap(self._tables["cmap"])
        self._kern: _Kerning | None = None
        self._fallback: _FontToolsOutlines | None = None
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
        try:
            return self._outlines.contours(glyph)
        except FontError:
            if isinstance(self._outlines, _FontToolsOutlines):
                raise
            fallback = self._fallback_outlines()
            if fallback is None:
                raise
            return fallback.contours(glyph)

    def _fallback_outlines(self) -> _FontToolsOutlines | None:
        """fontTools for glyphs this reader cannot draw (CFF accents built with seac)."""
        if self._fallback is None:
            if self._fonttools is None:
                try:
                    self._fonttools = _fonttools_font(self._source, "these glyphs")
                except FontError:
                    return None
            self._fallback = _FontToolsOutlines(self._fonttools)
        return self._fallback

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
# Containers: sfnt, TTC, WOFF (and WOFF2 through fontTools)
# =============================================================================
def _read_tables(data: bytes, path: str, source: str | bytes | None = None) -> tuple[dict[str, bytes], Any]:
    source = path if source is None else source
    if len(data) < 12:
        raise FontError(f"{path}: not a font file")
    tag = data[:4]
    if tag == b"wOFF":
        return _woff_tables(data, path), None
    if tag == b"wOF2":
        tt = _fonttools_font(source, "WOFF2 fonts")
        return {t: tt.getTableData(t) for t in tt.keys() if t != "GlyphOrder"}, tt
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
    tt = None
    if "CFF2" in tables and "glyf" not in tables and "CFF " not in tables:
        tt = _fonttools_font(source, "CFF2 (variable OpenType) outlines")
    return tables, tt


def _woff_tables(data: bytes, path: str) -> dict[str, bytes]:
    n = _u16(data, 12)
    tables: dict[str, bytes] = {}
    for i in range(n):
        rec = 44 + 20 * i
        t = data[rec:rec + 4].decode("latin-1")
        off, comp, orig = _u32(data, rec + 4), _u32(data, rec + 8), _u32(data, rec + 12)
        raw = data[off:off + comp]
        tables[t] = zlib.decompress(raw) if comp < orig else raw
        if len(tables[t]) != orig:
            raise FontError(f"{path}: damaged WOFF table {t!r}")
    return tables


def _fonttools_font(source: str | bytes, what: str) -> Any:
    """fontTools' font of a file (its path) or of the bytes of one."""
    label = "font data" if isinstance(source, bytes) else source
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        raise FontError(f"{label}: {what} need the fontTools package; install it or convert the font "
                        "to TTF or OTF") from None
    try:
        import io

        return TTFont(io.BytesIO(source) if isinstance(source, bytes) else source, fontNumber=0, lazy=True)
    except Exception as e:  # brotli missing for WOFF2, damaged files
        raise FontError(f"{label}: fontTools cannot read it ({e})") from None


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
# CFF outlines (Type 2 charstrings)
# =============================================================================
def _cff_index(b: bytes, o: int) -> tuple[list[bytes], int]:
    """The items of a CFF INDEX at ``o`` and the offset after it."""
    count = _u16(b, o)
    if count == 0:
        return [], o + 2
    size = b[o + 2]
    offs = []
    p = o + 3
    for _ in range(count + 1):
        v = 0
        for k in range(size):
            v = (v << 8) | b[p + k]
        offs.append(v)
        p += size
    base = p - 1
    return [b[base + offs[i]:base + offs[i + 1]] for i in range(count)], base + offs[-1]


def _cff_dict(d: bytes) -> dict[int, list[float]]:
    out: dict[int, list[float]] = {}
    ops: list[float] = []
    i = 0
    while i < len(d):
        b0 = d[i]
        if b0 <= 21:
            if b0 == 12:
                key = 1200 + d[i + 1]
                i += 2
            else:
                key = b0
                i += 1
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


class _CFFOutlines:
    def __init__(self, cff: bytes, units_per_em: int):
        o = cff[2]  # header size
        _names, o = _cff_index(cff, o)
        tops, o = _cff_index(cff, o)
        _strings, o = _cff_index(cff, o)
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
        if glyph < 0 or glyph >= len(self.charstrings):
            raise FontError(f"glyph {glyph} is not in the font")
        local = self.lsubrs[self.fd_of[glyph] if self.fd_of is not None else 0] if self.lsubrs else []
        contours = _Type2(self.gsubrs, local).run(self.charstrings[glyph])
        if self.scale != 1.0:
            s = self.scale
            contours = [[tuple((x * s, y * s) for x, y in seg) for seg in c] for c in contours]
        return contours


def _fd_select(cff: bytes, o: int, n: int) -> list[int]:
    fmt = cff[o]
    if fmt == 0:
        return list(cff[o + 1:o + 1 + n])
    if fmt == 3:
        ranges = _u16(cff, o + 1)
        out = [0] * n
        for i in range(ranges):
            first, fd = _u16(cff, o + 3 + 3 * i), cff[o + 5 + 3 * i]
            last = _u16(cff, o + 3 + 3 * (i + 1))
            for g in range(first, min(last, n)):
                out[g] = fd
        return out
    raise FontError(f"unknown FDSelect format {fmt}")


class _Type2:
    """Interpreter of Type 2 charstrings: returns the contours, ignoring hints."""

    def __init__(self, gsubrs: list[bytes], lsubrs: list[bytes]):
        self.gsubrs, self.lsubrs = gsubrs, lsubrs
        self.gbias, self.lbias = _subr_bias(len(gsubrs)), _subr_bias(len(lsubrs))
        self.stack: list[float] = []
        self.contours: list[Contour] = []
        self.current: Contour = []
        self.x = self.y = 0.0
        self.start = (0.0, 0.0)
        self.stems = 0
        self.width_done = False
        self.ended = False

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
                if len(s) >= 4:
                    raise FontError("accented glyphs built with seac need the fontTools package")
                s.clear()
                self.ended = True
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
# Outlines through fontTools (CFF2, WOFF2 fonts without glyf or CFF)
# =============================================================================
class _FontToolsOutlines:
    def __init__(self, ttfont: Any):
        self.font = ttfont
        self.order = ttfont.getGlyphOrder()
        self.glyphs = ttfont.getGlyphSet()

    @functools.lru_cache(maxsize=4096)
    def contours(self, glyph: int) -> list[Contour]:
        pen = _SegmentPen(self.glyphs)
        self.glyphs[self.order[glyph]].draw(pen)
        pen.closePath()
        return pen.contours


class _SegmentPen:
    """A fontTools pen that records contours as segments."""

    def __init__(self, glyphs: Any = None) -> None:
        self.glyphs = glyphs
        self.contours: list[Contour] = []
        self.current: Contour = []
        self.start: Point = (0.0, 0.0)
        self.pos: Point = (0.0, 0.0)

    def moveTo(self, p: Point) -> None:  # noqa: N802 - the fontTools pen protocol
        self.closePath()
        self.start = self.pos = (float(p[0]), float(p[1]))

    def lineTo(self, p: Point) -> None:  # noqa: N802
        q = (float(p[0]), float(p[1]))
        if q != self.pos:
            self.current.append((self.pos, q))
        self.pos = q

    def curveTo(self, *points: Point) -> None:  # noqa: N802
        pts = [(float(x), float(y)) for x, y in points]
        while len(pts) > 3:  # several off-curve points: implied on-curve points between
            mid = _mid(pts[1], pts[2]) if len(pts) > 3 else pts[2]
            self.current.append((self.pos, pts[0], pts[1], mid))
            self.pos, pts = mid, pts[2:]
        self.current.append((self.pos, *pts))  # type: ignore[arg-type]
        self.pos = pts[-1]

    def qCurveTo(self, *points: Point | None) -> None:  # noqa: N802
        pts = [(float(p[0]), float(p[1])) for p in points if p is not None]
        if points and points[-1] is None:  # a contour of off-curve points only
            pts.append(_mid(pts[-1], pts[0]))
            self.start = self.pos = pts[-1]
        for k, c in enumerate(pts[:-1]):
            end = pts[-1] if k == len(pts) - 2 else _mid(c, pts[k + 1])
            self.current.append((self.pos, c, end))
            self.pos = end

    def closePath(self) -> None:  # noqa: N802
        if self.current:
            if self.pos != self.start:
                self.current.append((self.pos, self.start))
            self.contours.append(self.current)
        self.current = []

    endPath = closePath  # noqa: N815

    def addComponent(self, name: str, transform: Sequence[float]) -> None:  # noqa: N802
        from fontTools.pens.transformPen import TransformPen

        self.glyphs[name].draw(TransformPen(self, transform))


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
