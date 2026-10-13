"""Text and DXF: exact outlines from fonts, drawings in and out."""

import math
import os
import warnings
from pathlib import Path

import numpy as np
import pytest

from smlibpy import *
from smlibpy._kernel import ext
from smlibpy.font import DEFAULT_FONT, Font, load_font
from smlibpy.text import _segment_area

DATA = Path(__file__).resolve().parent / "data"
QUAD = str(DATA / "test-quadratic.ttf")
CUBIC = str(DATA / "test-cubic.otf")


def exact_area(sketch):
    """The sketch's area (the integration is exact for the polynomial outlines of a font)."""
    return sketch.area


def holes(sketch):
    return sorted(len(f.inner_wires()) for f in sketch.faces())


# =============================================================================
# The font reader
# =============================================================================
def test_bundled_font_metrics():
    f = load_font()
    assert Path(f.path) == DEFAULT_FONT and DEFAULT_FONT.name == "Lato-Regular.ttf"
    assert (DEFAULT_FONT.parent / "OFL.txt").read_text().count("SIL OPEN FONT LICENSE Version 1.1") == 1
    assert f.name == "Lato Regular" and f.units_per_em == 2000 and f.num_glyphs == 277
    assert f.cap_height == 1433  # OS/2 sCapHeight
    g = f.glyph_index
    assert [f.advance(g(c)) for c in "AVH "] == [1360, 1360, 1512, 386]
    assert f.kerning_source == "GPOS"
    assert f.kerning(g("A"), g("V")).advance1 == -136
    assert f.kerning(g("T"), g("o")).advance1 == -210
    assert f.kerning(g("A"), g("B")).advance1 == 0
    assert g("ж") is None and load_font() is f  # read once


def test_bundled_font_kern_table_matches_gpos():
    from smlibpy.font import _kern_table

    f = load_font()
    pairs = _kern_table(f._tables["kern"])
    assert len(pairs) == 4643
    assert all(f.kerning(left, right).advance1 == v for (left, right), v in pairs.items())


def test_reader_against_an_independent_reader():
    """Every glyph of the bundled font and of the test fonts: character map, advance and the
    exact area of the outline agree with an independent font reader."""
    ttlib = pytest.importorskip("fontTools.ttLib")
    from fontTools.pens.areaPen import AreaPen

    for path in (str(DEFAULT_FONT), QUAD, CUBIC):
        f = Font(path)
        tt = ttlib.TTFont(path)
        gs = tt.getGlyphSet()
        cmap = tt.getBestCmap()
        assert {c: f.glyph_index(chr(c)) for c in cmap} == {c: tt.getGlyphID(n) for c, n in cmap.items()}
        for gid, name in enumerate(tt.getGlyphOrder()):
            assert f.advance(gid) == tt["hmtx"][name][0]
            if name == "P":  # point matching, which the other reader does not draw
                continue
            pen = AreaPen(gs)
            gs[name].draw(pen)
            mine = sum(_segment_area(s) for c in f.outline(gid) for s in c)
            assert mine == pytest.approx(pen.value, rel=1e-12, abs=1e-9), name


def test_containers_and_kerning_sources():
    woff = Font(str(DATA / "test-quadratic.woff"))
    ttc = Font(str(DATA / "test-fonts.ttc"))  # the first font of the collection
    ttf = Font(QUAD)
    for f in (woff, ttc):
        assert f.name == ttf.name and f.outline(f.glyph_index("O")) == ttf.outline(ttf.glyph_index("O"))
    g = ttf.glyph_index
    assert ttf.kerning_source == "kern" and ttf.kerning(g("H"), g("O")).advance1 == -50
    cff = Font(CUBIC)
    assert cff.kerning_source == "GPOS" and cff.kerning(cff.glyph_index("H"), cff.glyph_index("O")).advance1 == -30


# =============================================================================
# Text: outlines, holes, fill rules
# =============================================================================
@pytest.mark.parametrize("char,faces,hole_counts", [
    ("H", 1, [0]), ("o", 1, [1]), ("B", 1, [2]), ("8", 1, [2]), ("i", 2, [0, 0]),
    ("%", 3, [0, 1, 1]), ("®", 2, [1, 1]), ("Ä", 3, [0, 0, 1]), ("@", 1, [1]),
])
def test_glyph_pieces_and_holes(char, faces, hole_counts):
    t = Text(char, 10)
    assert len(t.faces()) == faces and holes(t) == hole_counts


@pytest.mark.parametrize("char", list("HOoB8i%®Ä@&gÆ€"))
def test_glyph_area_is_the_fonts(char):
    """The sketch is the font's outline: its area equals the exact area of the contours."""
    f = load_font()
    gid = f.glyph_index(char)
    signed = sum(_segment_area(s) for c in f.outline(gid) for s in c)
    t = Text(char, 10)
    assert exact_area(t) == pytest.approx(abs(signed) * (10 / f.cap_height) ** 2, rel=1e-9)


def test_smooth_runs_are_single_bsplines():
    o = Text("O", 10)
    assert [e.geom_type for e in o.edges()] == ["bspline", "bspline"]
    part = o.extrude(1)
    assert len(part.faces()) == 4 and part.is_valid()
    h = Text("H", 10)
    assert len(h.edges()) == 12 and {e.geom_type for e in h.edges()} == {"line"}


def test_fill_rules_of_the_test_fonts():
    """Glyphs built for the nonzero rule: overlapping contours unite, a contour inside another
    turning the same way is no hole, an island in a hole is a piece of its own, composites are
    scaled, mirrored and placed by point matching."""
    def t(ch, font=QUAD):
        return Text(ch, 700, font=font, align=None)  # cap height 700: one font unit is one mm

    assert exact_area(t("H")) == pytest.approx(420000, rel=1e-12)
    assert exact_area(t("O")) == pytest.approx(420000 - 200000, rel=1e-12) and holes(t("O")) == [1]
    x = t("X")  # two rectangles overlapping by 200
    assert len(x.faces()) == 1 and exact_area(x) == pytest.approx(600 * 700, rel=1e-12)
    n = t("N")  # nested, same turning sense
    assert holes(n) == [0] and exact_area(n) == pytest.approx(420000, rel=1e-12)
    r = t("R")
    assert holes(r) == [0, 1] and exact_area(r) == pytest.approx(420000 - 200000 + 60000, rel=1e-12)
    c = t("C")  # O at half size, twice
    assert holes(c) == [1, 1] and exact_area(c) == pytest.approx(2 * 220000 / 4, rel=1e-12)
    d = t("D")  # H mirrored
    assert exact_area(d) == pytest.approx(420000, rel=1e-12) and d.bbox().min.x == pytest.approx(50)
    p = t("P")  # the second H placed against the first one's corner: they share an edge
    assert len(p.faces()) == 1 and exact_area(p) == pytest.approx(840000, rel=1e-12)
    assert p.bbox().max.x == pytest.approx(1250)


def test_quadratic_contour_of_off_curve_points():
    """Eight off-curve points: the outline runs through their midpoints, as one B-spline."""
    off = [(350, 650), (562, 562), (650, 350), (562, 138), (350, 50), (138, 138), (50, 350), (138, 562)]
    mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(off, off[1:] + off[:1])]
    # polygon of the on-curve points plus 2/3 of each triangle between it and the curve
    poly = 0.5 * abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(mid, mid[1:] + mid[:1])))
    bulge = sum(abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2 * 2 / 3
                for p, q, r in zip(mid, off[1:] + off[:1], mid[1:] + mid[:1]))
    q = Text("Q", 700, font=QUAD, align=None)
    assert [e.geom_type for e in q.edges()] == ["bspline"]
    assert exact_area(q) == pytest.approx(poly + bulge, rel=1e-10)


def test_cubic_outlines():
    k = 0.5522847498307936  # 165.7 and 82.8 for the radii 300 and 150: 166 and 83 in the font

    def circle_area(r):  # four cubic arcs about the center; the font holds the handles rounded
        h = round(k * r)
        return 4 * _segment_area(((r, 0), (r, h), (h, r), (0, r)))

    o = Text("O", 700, font=CUBIC, align=None)
    assert holes(o) == [1] and len(o.edges()) == 2
    assert exact_area(o) == pytest.approx(circle_area(300) - circle_area(150), rel=1e-10)
    # three cubics meeting smoothly at uneven ratios: one closed B-spline edge, the same area
    s = Text("S", 700, font=CUBIC, align=None)
    j0, a0, b1, j1, a1, b2, j2, a2, b0 = ((600, 300), (600, 480), (380, 640), (200, 600), (-160, 520),
                                          (60, 400), (150, 100), (180, 0), (600, 30))
    expected = sum(_segment_area(seg) for seg in [(j0, a0, b1, j1), (j1, a1, b2, j2), (j2, a2, b0, j0)])
    assert len(s.edges()) == 1 and s.edges()[0].is_closed
    assert exact_area(s) == pytest.approx(expected, rel=1e-10)
    u = Text("U", 700, font=CUBIC, align=None)  # drawn through a local subroutine
    assert u.bbox().min.to_tuple() == pytest.approx((50, 0, 0)) and u.bbox().max.to_tuple() == pytest.approx((650, 700, 0))


# =============================================================================
# Text: size, layout, alignment
# =============================================================================
def test_size_is_the_cap_height():
    for size in (2.5, 7.0, 100.0):
        b = Text("H", size).bbox()
        assert b.size.y == pytest.approx(size, rel=1e-12)
        assert b.min.y == pytest.approx(-size / 2) and b.max.y == pytest.approx(size / 2)
    assert Text("O", 10).bbox().size.y > 10  # round letters overshoot
    assert Text("H", 700, font=QUAD, align=None).bbox().max.y == pytest.approx(700)


def test_advances_kerning_and_spacing():
    f = load_font()
    s = 10 / f.cap_height
    kerned = Text("AV", 10, align=Align.MIN).bbox()
    plain = Text("AV", 10, align=Align.MIN, kerning=False).bbox()
    assert plain.max.x - kerned.max.x == pytest.approx(136 * s, rel=1e-12)
    spaced = Text("AV", 10, align=Align.MIN, kerning=False, spacing=1.5).bbox()
    assert spaced.max.x - plain.max.x == pytest.approx(1.5, rel=1e-12)
    # in the test font: H O is kerned by -50 units; at size 700 a unit is a millimeter
    ho = Text("HO", 700, font=QUAD, align=None).bbox()
    assert ho.max.x == pytest.approx(700 - 50 + 650)
    assert Text("HO", 700, font=QUAD, align=None, kerning=False).bbox().max.x == pytest.approx(700 + 650)
    assert Text("H O", 700, font=QUAD, align=None).bbox().max.x == pytest.approx(700 + 300 + 650)


def test_alignment_of_lines_and_blocks():
    size = 700  # with the test font: H spans x 50..650 of an advance of 700
    one = dict(font=QUAD)
    b = Text("H", size, align=Align.MIN, **one).bbox()
    assert (b.min.x, b.min.y, b.max.y) == pytest.approx((50, 0, 700))
    b = Text("H", size, align=Align.MAX, **one).bbox()
    assert (b.max.x, b.max.y) == pytest.approx((-50, 0))
    b = Text("H", size, **one).bbox()
    assert (b.min.x, b.max.x, b.min.y, b.max.y) == pytest.approx((-300, 300, -350, 350))
    block = Text("HH\nH", size, align=(Align.MIN, Align.MIN), line_spacing=1.5, **one)
    b = block.bbox()  # the last line stands on y = 0, the first one 1.5 sizes above it
    assert (b.min.y, b.max.y) == pytest.approx((0, 1.5 * 700 + 700))
    centered = Text("HH\nH", size, line_spacing=1.5, **one)
    second = [f for f in centered.faces() if f.center().y < 0]
    assert len(second) == 1 and second[0].center().x == pytest.approx(0, abs=1e-9)
    right = Text("HH\nH", size, align=Align.MAX, **one)
    assert max(f.bbox().max.x for f in right.faces()) == pytest.approx(-50)


def test_text_along_a_path():
    arc = CenterArc((0, 0), 30, 180, -180)  # over the top, clockwise: letters stand outside
    on = Text("SMLIB", 4, path=arc)
    assert exact_area(on) == pytest.approx(exact_area(Text("SMLIB", 4)), rel=1e-9)  # glyphs are placed, not bent
    h = Text("H", 4, path=arc, align=(Align.CENTER, Align.CENTER)).bbox()
    straight = Text("H", 4).bbox()  # the middle of the advance goes to the middle of the arc
    assert (h.min.y, h.max.y) == pytest.approx((28, 32))  # centered on the top of the arc, upright
    assert (h.min.x, h.max.x) == pytest.approx((straight.min.x, straight.max.x))
    below = Text("H", 4, path=CenterArc((0, 0), 30, 180, 180), align=(Align.CENTER, Align.MIN)).bbox()
    assert (below.min.y, below.max.y) == pytest.approx((-30, -26))  # counterclockwise: letters inside
    with pytest.raises(ValueError, match="path only"):
        Text("A LONG TEXT ON A SHORT ARC", 10, path=arc)
    with pytest.raises(ValueError, match="XY plane"):
        Text("A", 4, path=Line((0, 0, 0), (10, 0, 5)))
    with pytest.raises(ValueError, match="one line"):
        Text("A\nB", 4, path=arc)


def test_overlapping_letters_unite():
    a = Text("A", 10)
    tight = Text("AA", 10, spacing=-6)
    assert len(tight.faces()) == 1 and tight.area < 2 * a.area - 1
    assert tight.extrude(1).is_valid()


def test_text_errors():
    with pytest.raises(ValueError, match="U\\+0436"):
        Text("ж", 5)
    with pytest.raises(ValueError, match="positive"):
        Text("A", 0)
    with pytest.raises(ValueError, match="nothing to draw"):
        Text("   ", 5)
    with pytest.raises(ValueError, match="control characters"):
        Text("A\tB", 5)
    with pytest.raises(FileNotFoundError):
        Text("A", 5, font="/no/such/font.ttf")
    with pytest.raises(ValueError, match="not a TrueType or OpenType font"):
        Text("A", 5, font=__file__)


def test_emboss_and_engrave():
    plate = Box(70, 24, 5)
    label = Text("SMLIB 42", 8)
    top = plate.faces().top()
    embossed = plate + label.on(top).extrude(0.8)
    engraved = plate - label.on(top).extrude(-0.5)
    assert embossed.is_valid() and engraved.is_valid()
    assert embossed.volume == pytest.approx(plate.volume + 0.8 * label.area, rel=1e-6)
    assert engraved.volume == pytest.approx(plate.volume - 0.5 * label.area, rel=1e-6)
    assert embossed.bbox().max.z == pytest.approx(2.5 + 0.8)
    side = plate.faces().facing(-Y).one()  # on a vertical face: the text stands upright
    sign = plate - Text("A1", 3).on(side).extrude(-0.3)
    assert sign.is_valid() and sign.volume < plate.volume


# =============================================================================
# DXF: reading
# =============================================================================
def _dxf(tmp_path, entities, header="", blocks="", name="drawing.dxf"):
    text = ""
    if header:
        text += "0\nSECTION\n2\nHEADER\n" + header + "0\nENDSEC\n"
    if blocks:
        text += "0\nSECTION\n2\nBLOCKS\n" + blocks + "0\nENDSEC\n"
    text += "0\nSECTION\n2\nENTITIES\n" + entities + "0\nENDSEC\n0\nEOF\n"
    path = tmp_path / name
    path.write_text(text)
    return path


def _lw(points, closed=True, layer="0"):
    s = f"0\nLWPOLYLINE\n8\n{layer}\n90\n{len(points)}\n70\n{1 if closed else 0}\n"
    for p in points:
        s += f"10\n{p[0]}\n20\n{p[1]}\n" + (f"42\n{p[2]}\n" if len(p) > 2 else "")
    return s


def _line(a, b, layer="0"):
    return f"0\nLINE\n8\n{layer}\n10\n{a[0]}\n20\n{a[1]}\n30\n0\n11\n{b[0]}\n21\n{b[1]}\n31\n0\n"


def _circle(c, r, layer="0"):
    return f"0\nCIRCLE\n8\n{layer}\n10\n{c[0]}\n20\n{c[1]}\n30\n0\n40\n{r}\n"


def test_dxf_polylines_with_bulges(tmp_path):
    slot = import_dxf(_dxf(tmp_path, _lw([(-15, -5), (15, -5, 1), (15, 5), (-15, 5, 1)])))
    assert [e.geom_type for e in slot.edges()] == ["line", "circle", "line", "circle"]
    assert [e.radius for e in slot.edges() if e.geom_type == "circle"] == pytest.approx([5, 5], rel=1e-14)
    assert exact_area(slot) == pytest.approx(300 + math.pi * 25, rel=1e-9)
    clockwise = import_dxf(_dxf(tmp_path, _lw([(-15, 5), (15, 5, -1), (15, -5), (-15, -5, -1)])))
    assert exact_area(clockwise) == pytest.approx(300 + math.pi * 25, rel=1e-9)
    # a bulge above 1: three quarters of a circle of radius 10 / (2 sin 135) under the chord
    big = import_dxf(_dxf(tmp_path, _lw([(0, 0, math.tan(math.radians(270) / 4)), (10, 0)])))
    r = 10 / (2 * math.sin(math.radians(135)))
    assert exact_area(big) == pytest.approx(r * r * (3 * math.pi / 4) + r * r / 2, rel=1e-9)
    assert big.bbox().max.y == pytest.approx(0, abs=1e-9) and big.bbox().min.y == pytest.approx(-5 - r)
    # the old POLYLINE with VERTEX entities, in inches
    ents = "0\nPOLYLINE\n8\n0\n66\n1\n70\n1\n10\n0\n20\n0\n30\n0\n"
    for x, y, b in [(0, 0, 0), (2, 0, 0), (2, 1, 1), (0, 1, 0)]:
        ents += f"0\nVERTEX\n8\n0\n10\n{x}\n20\n{y}\n30\n0\n42\n{b}\n"
    ents += "0\nSEQEND\n"
    old = import_dxf(_dxf(tmp_path, ents, header="9\n$INSUNITS\n70\n1\n"))
    assert exact_area(old) == pytest.approx((2 + math.pi / 2) * 25.4 ** 2, rel=1e-9)
    assert old.bbox().max.to_tuple() == pytest.approx((50.8, 50.8, 0))


def test_dxf_arcs_ellipses_splines(tmp_path):
    # an ARC drawn with the extrusion (0, 0, -1), as mirrored arcs are: center (5, 0) is (-5, 0)
    half = import_dxf(_dxf(tmp_path, _line((-10, 0), (0, 0))
                           + "0\nARC\n8\n0\n10\n5\n20\n0\n30\n0\n40\n5\n50\n0\n51\n180\n210\n0\n220\n0\n230\n-1\n"))
    assert half.bbox().min.to_tuple() == pytest.approx((-10, 0, 0)) and half.bbox().max.y == pytest.approx(5)
    assert exact_area(half) == pytest.approx(math.pi * 25 / 2, rel=1e-9)
    ellipse = import_dxf(_dxf(tmp_path, "0\nELLIPSE\n8\n0\n10\n0\n20\n0\n30\n0\n11\n10\n21\n0\n31\n0\n40\n0.5\n"
                                        "41\n0\n42\n3.141592653589793\n" + _line((-10, 0), (10, 0))))
    assert {e.geom_type for e in ellipse.edges()} == {"ellipse", "line"}
    assert exact_area(ellipse) == pytest.approx(math.pi * 10 * 5 / 2, rel=1e-9)
    # a rational quadratic SPLINE: a full circle of radius 10
    w = math.sqrt(0.5)
    poles = [(10, 0), (10, 10), (0, 10), (-10, 10), (-10, 0), (-10, -10), (0, -10), (10, -10), (10, 0)]
    knots = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]
    spline = (f"0\nSPLINE\n8\n0\n70\n13\n71\n2\n72\n{len(knots)}\n73\n{len(poles)}\n74\n0\n"
              + "".join(f"40\n{k}\n" for k in knots) + "".join(f"41\n{x}\n" for x in [1, w, 1, w, 1, w, 1, w, 1])
              + "".join(f"10\n{a}\n20\n{b}\n30\n0\n" for a, b in poles))
    circle = import_dxf(_dxf(tmp_path, spline))
    assert exact_area(circle) == pytest.approx(math.pi * 100, rel=1e-9)


def _cyclic_point(P, u):
    """A point of the uniform cubic B-spline with control points P (closed, period len(P))."""
    n = len(P)
    i = int(math.floor(u)) % n
    t = u - math.floor(u)
    b = [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6]
    return sum(b[j] * np.array(P[(i + j) % n]) for j in range(4))


def test_dxf_periodic_spline_is_clamped_exactly(tmp_path):
    P = [(10 * math.cos(a), 6 * math.sin(a)) for a in [i * math.pi / 3 for i in range(6)]]
    poles = P + P[:3]  # the wrapped form of a periodic spline
    knots = list(range(len(poles) + 4))
    ents = (f"0\nSPLINE\n8\n0\n70\n11\n71\n3\n72\n{len(knots)}\n73\n{len(poles)}\n74\n0\n"
            + "".join(f"40\n{k}\n" for k in knots) + "".join(f"10\n{a}\n20\n{b}\n30\n0\n" for a, b in poles))
    s = import_dxf(_dxf(tmp_path, ents))
    [edge] = s.edges()
    assert edge.is_closed
    for u in np.linspace(0, 6, 13):
        p = _cyclic_point(P, u)
        assert edge.distance_to((p[0], p[1], 0)) < 1e-12


def test_dxf_units(tmp_path):
    for code, mm in [(1, 25.4), (2, 304.8), (4, 1.0), (5, 10.0), (6, 1000.0), (13, 0.001), (0, 1.0)]:
        s = import_dxf(_dxf(tmp_path, _circle((0, 0), 1), header=f"9\n$INSUNITS\n70\n{code}\n"))
        assert s.bbox().size.x == pytest.approx(2 * mm, rel=1e-12)
    assert import_dxf(_dxf(tmp_path, _circle((0, 0), 1))).bbox().size.x == pytest.approx(2)  # no header: mm
    assert import_dxf(_dxf(tmp_path, _circle((0, 0), 1)), unit="inch").bbox().size.x == pytest.approx(50.8)
    with pytest.raises(ValueError, match="unknown unit"):
        import_dxf(_dxf(tmp_path, _circle((0, 0), 1)), unit="MM")


def test_dxf_blocks(tmp_path):
    blocks = ("0\nBLOCK\n8\n0\n2\nSQ\n70\n0\n10\n5\n20\n5\n30\n0\n" + _lw([(0, 0), (10, 0), (10, 10), (0, 10)])
              + "0\nENDBLK\n"
              "0\nBLOCK\n8\n0\n2\nHOLE\n70\n0\n10\n0\n20\n0\n30\n0\n" + _circle((0, 0), 1) + "0\nENDBLK\n"
              "0\nBLOCK\n8\n0\n2\nNEST\n70\n0\n10\n0\n20\n0\n30\n0\n"
              "0\nINSERT\n8\n0\n2\nHOLE\n10\n0\n20\n0\n30\n0\n41\n2\n42\n2\n0\nENDBLK\n")
    ents = ("0\nINSERT\n8\nPARTS\n2\nSQ\n10\n100\n20\n0\n30\n0\n41\n2\n42\n2\n50\n45\n"  # 20 x 20, turned
            "0\nINSERT\n8\nPARTS\n2\nNEST\n10\n100\n20\n0\n30\n0\n"  # a hole of radius 2 in it
            "0\nINSERT\n8\nPARTS\n2\nSQ\n10\n0\n20\n0\n30\n0\n41\n-1\n42\n1\n"  # mirrored
            "0\nINSERT\n8\nGRID\n2\nHOLE\n10\n200\n20\n0\n30\n0\n70\n2\n71\n2\n44\n10\n45\n20\n")  # 2 x 2 array
    path = _dxf(tmp_path, ents, blocks=blocks)
    s = import_dxf(path)
    assert len(s.faces()) == 6 and holes(s) == [0, 0, 0, 0, 0, 1]
    assert exact_area(s) == pytest.approx(400 - 4 * math.pi + 100 + 4 * math.pi, rel=1e-9)
    turned = [f for f in s.faces() if len(f.inner_wires()) == 1][0]
    assert turned.bbox().size.x == pytest.approx(20 * math.sqrt(2))
    grid = import_dxf(path, layers=["grid"])  # block contents on layer 0 take the insert's layer
    centers = sorted((round(c.x), round(c.y)) for c in (e.arc_center for e in grid.edges()))
    assert centers == [(200, 0), (200, 20), (210, 0), (210, 20)]
    assert import_dxf(path, layers="PARTS").area == pytest.approx(500 - 4 * math.pi, rel=1e-6)


def test_dxf_degenerate_entities_are_skipped(tmp_path):
    ents = _circle((0, 0), 5) + _circle((20, 0), 0) + _line((30, 0), (30, 0)) + "0\nARC\n8\n0\n10\n0\n20\n0\n30\n0\n40\n0\n50\n0\n51\n90\n"
    s = import_dxf(_dxf(tmp_path, ents))
    assert len(s.faces()) == 1 and s.area == pytest.approx(math.pi * 25, rel=1e-6)


def test_dxf_nested_loops_and_islands(tmp_path):
    ents = _lw([(-20, -20), (20, -20), (20, 20), (-20, 20)]) + _circle((0, 0), 15) + _lw([(-5, -5), (5, -5), (5, 5), (-5, 5)])
    s = import_dxf(_dxf(tmp_path, ents))
    assert holes(s) == [0, 1]
    assert exact_area(s) == pytest.approx(1600 - math.pi * 225 + 100, rel=1e-9)
    # loops that cross: the even-odd rule makes their overlap a hole
    lens = import_dxf(_dxf(tmp_path, _circle((-5, 0), 10) + _circle((5, 0), 10)))
    d, r = 10, 10
    overlap = 2 * r * r * math.acos(d / (2 * r)) - d / 2 * math.sqrt(4 * r * r - d * d)
    assert exact_area(lens) == pytest.approx(2 * math.pi * 100 - 2 * overlap, rel=1e-6)


def test_dxf_open_and_branching_outlines(tmp_path):
    gap = (_line((0, 0), (10, 0), "CUT") + _line((10, 0), (10, 10), "CUT") + _line((10, 10), (0.02, 10), "CUT")
           + _line((0, 10), (0, 0), "CUT"))
    path = _dxf(tmp_path, gap)
    with pytest.raises(ModelingError) as err:
        import_dxf(path)
    msg = str(err.value)
    assert "does not close" in msg and "layer 'CUT'" in msg and "0.02 mm away" in msg and "import_dxf_wires" in msg
    # the two ends meet halfway: the left side leans by 0.01 and the square loses 0.05
    assert import_dxf(path, tolerance=0.05).area == pytest.approx(99.95, rel=1e-6)
    [wire] = import_dxf_wires(path)
    assert not wire.is_closed and len(wire.edges()) == 4
    branch = _lw([(0, 0), (10, 0), (10, 10), (0, 10)]) + _line((10, 10), (20, 20))
    with pytest.raises(ModelingError, match="branches"):
        import_dxf(_dxf(tmp_path, branch))
    wires = import_dxf_wires(_dxf(tmp_path, branch))
    assert len(wires) == 2 and sorted(len(w.edges()) for w in wires) == [1, 4]


@pytest.mark.filterwarnings("ignore::UserWarning")
def test_dxf_layers_and_skipped_entities(tmp_path):
    ents = (_circle((0, 0), 5, "CUT") + _circle((20, 0), 2, "ENGRAVE")
            + "0\nTEXT\n8\n0\n10\n0\n20\n0\n30\n0\n40\n2\n1\nNOTE\n")
    path = _dxf(tmp_path, ents)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        both = import_dxf(path)
    assert len(both.faces()) == 2 and any("1 TEXT" in str(w.message) for w in caught)
    assert import_dxf(path, layers=["cut"]).bbox().size.x == pytest.approx(10)
    with pytest.raises(ValueError, match="no layer 'NOPE'.*CUT, ENGRAVE"):
        import_dxf(path, layers=["NOPE"])
    with pytest.raises(ModelingError, match="no curves"):
        import_dxf(_dxf(tmp_path, "0\nTEXT\n8\n0\n10\n0\n20\n0\n30\n0\n40\n2\n1\nNOTE\n"))


# =============================================================================
# DXF: writing and round trips
# =============================================================================
def _entity_counts(path):
    lines = Path(path).read_text().splitlines()
    section = None
    counts = {}
    for code, value in zip(lines[0::2], lines[1::2]):
        if code.strip() == "2" and section == "SECTION":
            section = value
        if code.strip() == "0":
            if value == "SECTION":
                section = "SECTION"
            elif section == "ENTITIES" and value != "ENDSEC":
                counts[value] = counts.get(value, 0) + 1
    return counts


def _header(path, name):
    lines = Path(path).read_text().splitlines()
    i = lines.index(name)
    return lines[i + 2]


def test_dxf_round_trip_is_exact(tmp_path):
    spline_hole = make_face(Spline((-25, -10), (-15, -5), (-10, -15), closed=True))
    plate = RoundedRectangle(60, 40, 5) - Circle(6) - Ellipse(8, 4).translate(18, 0) - spline_hole
    path = tmp_path / "plate.dxf"
    export_dxf(plate.named("plate"), path)
    assert _entity_counts(path) == {"ARC": 4, "LINE": 4, "CIRCLE": 1, "ELLIPSE": 1, "SPLINE": 1}
    back = import_dxf(path)
    assert holes(back) == [3]
    assert exact_area(back) == pytest.approx(exact_area(plate), rel=1e-10)
    radii = sorted(e.radius for e in back.edges() if e.geom_type == "circle")
    assert radii == sorted(e.radius for e in plate.edges() if e.geom_type == "circle") == [5, 5, 5, 5, 6]
    original = [e for e in plate.edges() if e.geom_type == "bspline"][0]
    again = [e for e in back.edges() if e.geom_type == "bspline"][0]
    a, b = ext.curve_data(original._curve()), ext.curve_data(again._curve())
    assert np.array_equal(np.array(a["poles"]), np.array(b["poles"])) and list(a["knots"]) == list(b["knots"])


def test_dxf_writes_sections_with_arcs_and_circles(tmp_path):
    part = Box(40, 30, 20) - Cylinder(8, 30) - Cylinder(3, 30).translate(14, 8, 0)
    part = part.fillet(part.edges().parallel_to(Z).filter_by(lambda e: abs(e.center().x) > 19), 4)
    cut = part.section(Plane.XY)
    assert {e.geom_type for e in cut.edges()} == {"bspline"}  # the kernel's sections are B-splines
    path = tmp_path / "section.dxf"
    export_dxf(cut, path)
    assert _entity_counts(path) == {"LINE": 4, "ARC": 4, "CIRCLE": 2}
    back = load(path)
    assert isinstance(back, Sketch) and holes(back) == [2]
    assert exact_area(back) == pytest.approx(exact_area(cut), rel=1e-10)
    assert sorted(round(e.radius, 12) for e in back.edges() if e.geom_type == "circle") == [3, 4, 4, 4, 4, 8]
    side = part.section(Plane.XZ)  # drawn in the XZ plane's coordinates: x stays x, z becomes y
    export_dxf(side, tmp_path / "side.dxf")
    b = import_dxf(tmp_path / "side.dxf").bbox()
    assert b.min.to_tuple() == pytest.approx((-20, -10, 0)) and b.max.to_tuple() == pytest.approx((20, 10, 0))


def test_dxf_units_and_planes_on_export(tmp_path):
    plate = Rectangle(50.8, 25.4)
    export_dxf(plate, tmp_path / "inch.dxf", unit="inch")
    assert _header(tmp_path / "inch.dxf", "$INSUNITS") == "1"
    assert import_dxf(tmp_path / "inch.dxf", unit="mm").bbox().size.x == pytest.approx(2.0)  # 2 inches in the file
    assert import_dxf(tmp_path / "inch.dxf").bbox().size.x == pytest.approx(50.8)  # read back in mm
    assert _header(tmp_path / "inch.dxf", "$MEASUREMENT") == "0"
    export_dxf(plate, tmp_path / "mm.dxf")
    assert _header(tmp_path / "mm.dxf", "$INSUNITS") == "4"
    lifted = Plane.XY.offset(7) * Circle(3).translate(10, 0)  # parallel to XY: X and Y kept
    export_dxf(lifted, tmp_path / "lifted.dxf")
    assert import_dxf(tmp_path / "lifted.dxf").bbox().center.to_tuple() == pytest.approx((10, 0, 0))
    standing = Rectangle(10, 4).on(Plane.XZ)
    export_dxf(standing, tmp_path / "front.dxf", plane=Plane.XZ)
    assert import_dxf(tmp_path / "front.dxf").bbox().size.to_tuple() == pytest.approx((10, 4, 0))
    with pytest.raises(ValueError, match="not parallel"):
        export_dxf(standing, tmp_path / "bad.dxf", plane=Plane.XY)
    with pytest.raises(TypeError, match="section"):
        export_dxf(Box(1, 1, 1), tmp_path / "part.dxf")
    wire = Polyline((0, 0), (10, 0), (10, 5))
    export_dxf([wire, Line((0, 0), (0, 3))], tmp_path / "curves.dxf")
    assert _entity_counts(tmp_path / "curves.dxf") == {"LINE": 3}
    text = Text("Text 8", 5).named("engrave")
    text.export(tmp_path / "text.dxf")
    assert "\nengrave\n" in (tmp_path / "text.dxf").read_text()
    export_dxf(Circle(1).named("Bügel/2"), tmp_path / "ascii.dxf")
    assert "\nB_gel_2\n" in (tmp_path / "ascii.dxf").read_bytes().decode("ascii")
    assert exact_area(import_dxf(tmp_path / "text.dxf")) == pytest.approx(exact_area(text), rel=1e-10)


def test_dxf_read_by_an_independent_reader(tmp_path):
    """An independent reader finds a valid drawing with the same geometry."""
    ezdxf = pytest.importorskip("ezdxf")
    from ezdxf import recover

    part = Box(40, 30, 20) - Cylinder(8, 30)
    shapes = [part.section(Plane.XY).named("section"),
              (Ellipse(8, 4) - Circle(1)).translate(60, 0).named("ellipse"),
              Text("Ab", 10).translate(0, 40).named("text")]
    path = tmp_path / "all.dxf"
    export_dxf(shapes, path)
    doc, auditor = recover.readfile(str(path))
    assert doc.dxfversion == "AC1015" and not auditor.errors and not auditor.fixes
    audit = doc.audit()
    assert not audit.errors and not audit.fixes
    msp = doc.modelspace()
    kinds = sorted(e.dxftype() for e in msp)
    assert kinds.count("CIRCLE") == 2 and kinds.count("ELLIPSE") == 1 and kinds.count("SPLINE") >= 3
    circles = sorted((e.dxf.radius, *e.dxf.center) for e in msp.query("CIRCLE"))
    assert circles[0] == pytest.approx((1, 60, 0, 0)) and circles[1] == pytest.approx((8, 0, 0, 0))
    [ell] = msp.query("ELLIPSE")
    assert ell.dxf.ratio == pytest.approx(0.5) and tuple(ell.dxf.major_axis) == pytest.approx((8, 0, 0))
    assert {e.dxf.layer for e in msp} == {"section", "ellipse", "text"}
    # the splines of the text are the B-splines of the sketch, control point for control point
    ours = sorted(tuple(np.round(np.array(ext.curve_data(e._curve())["poles"])[:, :2].ravel(), 9))
                  for e in shapes[2].edges() if e.geom_type == "bspline")
    theirs = sorted(tuple(np.round(np.array(s.control_points)[:, :2].ravel(), 9)) for s in msp.query("SPLINE"))
    assert ours == theirs


def test_dxf_written_by_an_independent_writer(tmp_path):
    """A full R2018 drawing written by an independent writer: inch units, a polyline with bulges,
    a periodic closed spline, an ellipse and a scaled, turned block."""
    ezdxf = pytest.importorskip("ezdxf")
    from ezdxf.math import closed_uniform_bspline

    doc = ezdxf.new("R2018", units=1)  # inches
    msp = doc.modelspace()
    msp.add_lwpolyline([(-15, -5, 0), (15, -5, 1), (15, 5, 0), (-15, 5, 1)], format="xyb", close=True)
    msp.add_circle((40, 0), 3)
    msp.add_ellipse(center=(60, 0), major_axis=(8, 0), ratio=0.5)
    ctrl = [(80, -5), (90, -6), (95, 0), (90, 6), (80, 5), (76, 0)]
    msp.add_spline(dxfattribs={"flags": 1 | 2 | 8}).apply_construction_tool(closed_uniform_bspline(ctrl, order=4))
    doc.blocks.new("HOLE", base_point=(0, 0)).add_circle((0, 0), 1)
    msp.add_blockref("HOLE", (40, 0), dxfattribs={"xscale": 2, "yscale": 1, "rotation": 30})
    doc.saveas(tmp_path / "other.dxf")
    s = import_dxf(tmp_path / "other.dxf")
    pts = np.array([_cyclic_point(ctrl, u) for u in np.linspace(0, len(ctrl), 20001)[:-1]])
    spline = 0.5 * abs(np.dot(pts[:, 0], np.roll(pts[:, 1], -1)) - np.dot(np.roll(pts[:, 0], -1), pts[:, 1]))
    expected = sorted([300 + math.pi * 25, spline, math.pi * 32, math.pi * 9 - math.pi * 2])  # in square inches
    areas = sorted(f.area / 25.4 ** 2 for f in s.faces())
    assert areas == pytest.approx(expected, rel=1e-7)
    assert holes(s) == [0, 0, 0, 1]


# =============================================================================
# MCP
# =============================================================================
def test_session_embosses_text_and_saves_dxf(tmp_path):
    from smlibpy.mcp.session import Session

    session = Session()
    try:
        res = session.run(
            "plate = Box(60, 20, 4)\n"
            "label = Text('SMLIB', 8)\n"
            "plate = plate + label.on(plate.faces().top()).extrude(1)\n"
            "print(plate.is_valid(), abs(plate.volume - 60 * 20 * 4 - label.area) < 1e-3)\n"
            "show(plate)")
        assert res["ok"], res
        assert res["output"].split() == ["True", "True"]
        assert [item["name"] for item in res["scene"]] == ["plate"]
        saved = session.call("save", format="dxf", path=str(tmp_path / "label.dxf"), names=["label"])
        assert saved["ok"] and saved["shapes"] == ["label"]
        assert "\nlabel\n" in (tmp_path / "label.dxf").read_text()  # the variable name is the layer
        refused = session.call("save", format="dxf", path=str(tmp_path / "plate.dxf"), names=["plate"])
        assert not refused["ok"] and "section" in refused["error"]
        back = session.load(str(tmp_path / "label.dxf"), "outline")
        assert back["ok"] and back["type"] == "Sketch"
    finally:
        session.close()
