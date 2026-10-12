"""Build the small fonts of tests/data, whose glyphs have known exact areas.

    python tools/make_test_fonts.py        (needs fontTools)

test-quadratic.ttf (TrueType, 1000 units per em, cap height 700, a kern table):
    H   rectangle 50..650 x 0..700 (clockwise, the TrueType sense of outlines)
    O   H with a hole 150..550 x 100..600
    Q   eight off-curve points only (implied on-curve points between them)
    X   two rectangles that overlap: 50..450 and 250..650
    N   a rectangle with a smaller one inside turning the same way (no hole under nonzero)
    R   a rectangle, a hole, and an island in the hole
    C   composite: O at half size, twice, side by side
    D   composite: H mirrored with a 2x2 transform
    P   composite: H, and H again placed by point matching against the first one's corner
    kern pair H O: -50

test-cubic.otf (CFF, 1000 units per em, cap height 700, GPOS kerning):
    H   rectangle 50..650 x 0..700 (counterclockwise, the CFF sense)
    O   a circle of four cubics, radius 300, with a hole of radius 150
    S   a closed loop of three cubics that meet smoothly away from the middle of their handles
    U   the rectangle of H drawn by a local subroutine
    kerning H O: -30

test-quadratic.woff is test-quadratic.ttf in a WOFF container; test-fonts.ttc holds both fonts.
"""

from __future__ import annotations

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.psCharStrings import T2CharString
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphComponent
from fontTools.ttLib.ttCollection import TTCollection

OUT = Path(__file__).resolve().parent.parent / "tests" / "data"
KAPPA = 0.5522847498307936


def rect(pen, x0, y0, x1, y1, clockwise=True):
    pts = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)] if clockwise else [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()


def quadratic_font(path: Path) -> None:
    names = [".notdef", "space", "H", "O", "Q", "X", "N", "R", "C", "D", "P"]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({ord(" "): "space", **{ord(c): c for c in "HOQXNRCDP"}})
    glyphs = {}
    for name in (".notdef", "space"):
        glyphs[name] = TTGlyphPen(None).glyph()
    pen = TTGlyphPen(None)
    rect(pen, 50, 0, 650, 700)
    glyphs["H"] = pen.glyph()
    pen = TTGlyphPen(None)
    rect(pen, 50, 0, 650, 700)
    rect(pen, 150, 100, 550, 600, clockwise=False)
    glyphs["O"] = pen.glyph()
    pen = TTGlyphPen(None)
    pen.qCurveTo((350, 650), (562, 562), (650, 350), (562, 138), (350, 50), (138, 138), (50, 350), (138, 562), None)
    pen.closePath()
    glyphs["Q"] = pen.glyph()
    pen = TTGlyphPen(None)
    rect(pen, 50, 0, 450, 700)
    rect(pen, 250, 0, 650, 700)
    glyphs["X"] = pen.glyph()
    pen = TTGlyphPen(None)
    rect(pen, 50, 0, 650, 700)
    rect(pen, 150, 100, 550, 600)
    glyphs["N"] = pen.glyph()
    pen = TTGlyphPen(None)
    rect(pen, 50, 0, 650, 700)
    rect(pen, 150, 100, 550, 600, clockwise=False)
    rect(pen, 250, 200, 450, 500)
    glyphs["R"] = pen.glyph()
    pen = TTGlyphPen(glyphs)
    pen.addComponent("O", (0.5, 0, 0, 0.5, 0, 0))
    pen.addComponent("O", (0.5, 0, 0, 0.5, 350, 0))
    glyphs["C"] = pen.glyph()
    pen = TTGlyphPen(glyphs)
    pen.addComponent("H", (-1, 0, 0, 1, 700, 0))
    glyphs["D"] = pen.glyph()
    glyphs["P"] = TTGlyphPen(None).glyph()  # replaced below
    fb.setupGlyf(glyphs)
    glyf = fb.font["glyf"]
    # P: H, then H moved so that its point 1 (50, 700) lands on the first H's point 2 (650, 700)
    first, second = GlyphComponent(), GlyphComponent()
    first.glyphName, first.x, first.y, first.flags = "H", 0, 0, 0x2
    second.glyphName, second.firstPt, second.secondPt, second.flags = "H", 2, 1, 0x0
    p = glyf["H"].__class__()
    p.numberOfContours = -1
    p.components = [first, second]
    glyf["P"] = p
    metrics = {name: (700, 0) for name in names}
    metrics["space"] = (300, 0)
    metrics["P"] = (1300, 0)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "Smlibpy Test Quadratic", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200, sCapHeight=700,
                sxHeight=500, version=4)
    fb.setupPost()
    from fontTools.ttLib.tables._k_e_r_n import KernTable_format_0, table__k_e_r_n

    kern = table__k_e_r_n()
    kern.version = 0
    sub = KernTable_format_0()
    sub.version, sub.coverage, sub.format = 0, 1, 0
    sub.kernTable = {("H", "O"): -50}
    kern.kernTables = [sub]
    fb.font["kern"] = kern
    fb.font.recalcBBoxes = True
    fb.save(str(path))


def cubic_font(path: Path) -> None:
    names = [".notdef", "space", "H", "O", "S", "U"]
    fb = FontBuilder(1000, isTTF=False)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({ord(" "): "space", **{ord(c): c for c in "HOSU"}})
    cs = {}
    for name in (".notdef", "space"):
        pen = T2CharStringPen(0, None)
        cs[name] = pen.getCharString()
    pen = T2CharStringPen(700, None)
    rect(pen, 50, 0, 650, 700, clockwise=False)
    cs["H"] = pen.getCharString()
    pen = T2CharStringPen(700, None)
    for r, ccw in ((300, True), (150, False)):
        k = KAPPA * r
        cx = cy = 350
        if ccw:
            pts = [(cx + r, cy), (cx + r, cy + k), (cx + k, cy + r), (cx, cy + r), (cx - k, cy + r), (cx - r, cy + k),
                   (cx - r, cy), (cx - r, cy - k), (cx - k, cy - r), (cx, cy - r), (cx + k, cy - r), (cx + r, cy - k)]
        else:
            pts = [(cx + r, cy), (cx + r, cy - k), (cx + k, cy - r), (cx, cy - r), (cx - k, cy - r), (cx - r, cy - k),
                   (cx - r, cy), (cx - r, cy + k), (cx - k, cy + r), (cx, cy + r), (cx + k, cy + r), (cx + r, cy + k)]
        pen.moveTo(pts[0])
        for i in range(4):
            pen.curveTo(pts[3 * i + 1], pts[3 * i + 2], pts[(3 * i + 3) % 12])
        pen.closePath()
    cs["O"] = pen.getCharString()
    cs["S"] = _smooth_loop()
    # U: the rectangle of H through a local subroutine (bias 107 for one subroutine)
    subr = T2CharString(program=[50, 0, "rmoveto", 600, "hlineto", 700, "vlineto", -600, "hlineto", "return"])
    cs["U"] = T2CharString(program=[700, -107, "callsubr", "endchar"])
    fb.setupCFF("SmlibpyTestCubic-Regular", {"FullName": "Smlibpy Test Cubic"}, cs, {})
    cff = fb.font["CFF "].cff
    top = cff.topDictIndex[0]
    from fontTools.cffLib import SubrsIndex

    subrs = SubrsIndex()
    subrs.append(subr)
    top.Private.Subrs = subrs
    for name in names:
        top.CharStrings[name].private = top.Private
    subr.private = top.Private
    metrics = {name: (700, 0) for name in names}
    metrics["space"] = (300, 0)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "Smlibpy Test Cubic", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200, sCapHeight=700,
                sxHeight=500, version=4)
    fb.setupPost()
    fb.addOpenTypeFeatures("feature kern { pos H O -30; } kern;")
    fb.save(str(path))


def _smooth_loop() -> T2CharString:
    """Three cubics joined smoothly; each joint divides the line between its two handles
    unevenly (1:2 at j1, 3:1 at j2, 3:2 at j0). Integer coordinates keep the joints exactly on
    those lines."""
    j0, j1, j2 = (600, 300), (200, 600), (150, 100)
    a0, b1 = (600, 480), (380, 640)  # handles after j0 and before j1
    a1 = (j1[0] + 2 * (j1[0] - b1[0]), j1[1] + 2 * (j1[1] - b1[1]))  # (-160, 520)
    b2 = (60, 400)
    a2 = (j2[0] + (j2[0] - b2[0]) // 3, j2[1] + (j2[1] - b2[1]) // 3)  # (180, 0)
    b0 = (600, 30)  # j0 - 1.5 (a0 - j0)
    pen = T2CharStringPen(700, None)
    pen.moveTo(j0)
    for c1, c2, end in ((a0, b1, j1), (a1, b2, j2), (a2, b0, j0)):
        pen.curveTo(c1, c2, end)
    pen.closePath()
    return pen.getCharString()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    quadratic_font(OUT / "test-quadratic.ttf")
    cubic_font(OUT / "test-cubic.otf")
    woff = TTFont(OUT / "test-quadratic.ttf")
    woff.flavor = "woff"
    woff.save(OUT / "test-quadratic.woff")
    ttc = TTCollection()
    ttc.fonts = [TTFont(OUT / "test-quadratic.ttf"), TTFont(OUT / "test-cubic.otf")]
    ttc.save(OUT / "test-fonts.ttc")
    for p in sorted(OUT.glob("test-*")):
        print(p.name, p.stat().st_size)


if __name__ == "__main__":
    main()
