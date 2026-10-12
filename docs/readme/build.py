#!/usr/bin/env python3
"""docs/readme/build.py — typesets the frontispiece of the project README.

The drawing is the pipe flange of examples/flange.py, measured by smlibpy
itself: the hatched section A–A comes from part.section(), the lines seen
beyond the cut and the visible lines of the view from the left from
part.outline() (the kernel's hidden-line removal), its hidden lines from the
faces of the bolt holes, from the meridian section and from the part's edges,
the circles of the plan from the part's edges, and the volume in the title
block from part.volume.

The type is EB Garamond (Georg Duffner, SIL Open Font License), shaped with
HarfBuzz (kerning, ligatures, small caps, old-style figures) and converted to
outlines with fontTools, so the SVG renders the same anywhere without a font.
The plate is transparent and inked twice — for GitHub's light themes and for
its dark ones; the README picks one with <picture>.

    python docs/readme/build.py      # writes docs/readme/frontispiece.*.svg

Needs smlibpy (pip install . — or PYTHONPATH=src next to a built extension),
fontTools, HarfBuzz's `hb-shape` (brew install harfbuzz) and Duffner's EB
Garamond OTFs (EBGaramond12-*, EBGaramond08-*) in a font folder or $FONT_DIR.
"""

import functools
import importlib.util
import json
import math
import os
import subprocess
from contextlib import contextmanager
from types import SimpleNamespace

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

from smlibpy import Plane

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

# ─── Fonts ──────────────────────────────────────────────────────────────────

FONT_FILES = {  # key: (file, face in a collection, size factor)
    'rm': ('EBGaramond12-Regular.otf', 0, 1.0),     # text & display
    'it': ('EBGaramond12-Italic.otf', 0, 1.0),
    'rm8': ('EBGaramond08-Regular.otf', 0, 1.0),    # the sturdier cut for small sizes
    'it8': ('EBGaramond08-Italic.otf', 0, 1.0),
}
# EB Garamond 08 Regular (0.016) gives three small capitals the advance of the
# narrowest of them, so each overprints the next letter (AWV, VOLUME, FOUR); their
# advances here keep the right side bearings of the 12 cut.
ADVANCES = {'rm8': {'U.sc': 612, 'V.sc': 554, 'W.sc': 760}}
FONT_DIRS = [os.environ.get('FONT_DIR'), '~/Library/Fonts', '/Library/Fonts', '/System/Library/Fonts/Supplemental',
             '~/.fonts', '~/.local/share/fonts', '/usr/share/fonts', '/usr/local/share/fonts']


def find_font(name):
    for d in FONT_DIRS:
        if not d:
            continue
        d = os.path.expanduser(d)
        for base, _, files in os.walk(d):
            if name in files:
                return os.path.join(base, name)
    raise SystemExit(f'font not found: {name} (set FONT_DIR)')


class Font:
    def __init__(self, key):
        self.key = key
        name, self.face, self.scale = FONT_FILES[key]
        self.path = find_font(name)
        self.tt = TTFont(self.path, fontNumber=self.face) if name.endswith('.ttc') else TTFont(self.path)
        self.glyphs = self.tt.getGlyphSet()
        self.upm = self.tt['head'].unitsPerEm
        self._d = {}

    def outline(self, name):
        if name not in self._d:
            pen = SVGPathPen(self.glyphs, ntos=lambda v: str(round(v)))
            self.glyphs[name].draw(pen)
            self._d[name] = pen.getCommands()
        return self._d[name]


FONTS = {}


def font(key):
    if key not in FONTS:
        FONTS[key] = Font(key)
    return FONTS[key]


@functools.lru_cache(maxsize=None)
def shape(fk, text, feats=''):
    """HarfBuzz shaping → ((glyph name, advance, dx, dy), …) in font units."""
    if not text:
        return ()
    f = font(fk)
    args = ['hb-shape', '--output-format=json', f'--face-index={f.face}', f.path, '--text=' + text]
    if feats:
        args.insert(2, '--features=' + feats)
    out = json.loads(subprocess.run(args, capture_output=True, text=True, check=True).stdout)
    fix = ADVANCES.get(fk, {})
    return tuple((g['g'], fix.get(g['g'], g['ax']), g['dx'], g['dy']) for g in out)


def measure(text, size, fk='rm', feats='', ls=0.0):
    gl = shape(fk, text, feats)
    f = font(fk)
    return (sum(g[1] for g in gl) + ls * f.upm * max(0, len(gl) - 1)) * size * f.scale / f.upm


# ─── Printings ──────────────────────────────────────────────────────────────

THEMES = {
    # GitHub's light themes: its own text colours, rubricated in vermilion.
    'light': dict(ink='#1F2328', ink2='#59636E', accent='#BC3F26', pencil='#B9BFC6'),
    # Every dark theme (dark, dimmed, high contrast): light ink, a coral accent.
    'dark': dict(ink='#D6DDE4', ink2='#8B949E', accent='#F0876C', pencil='#4B535D'),
}

# Line weights (ISO 128: wide 2 : narrow 1) and patterns, in plate units.
THICK, THIN, FINE = 2.4, 1.15, 0.8
DASHED = '7 3.5'            # hidden lines
CHAIN = '20 4 2.5 4'        # centre lines, cutting planes

# The plate is inked over a pencil underdrawing: each drawn line exists twice,
# a static pencil line and an animated ink line on top of it. Browsers start an
# image's animation when it is first painted, so the plate is inked as it
# scrolls into view. The first frame is a finished drawing in pencil with all
# its type, so anything that freezes the image (a paused tab, autoplay switched
# off, a rasteriser) still shows a complete plate.
CSS = """
.d{animation:draw 1.1s cubic-bezier(.65,.04,.35,1) both}
@keyframes draw{from{stroke-dasharray:0 1}to{stroke-dasharray:1 0}}
@media (prefers-reduced-motion:reduce){.d{animation:none}}
"""


def n(v):
    """Compact number formatting for coordinates."""
    s = f'{v:.1f}'
    return s[:-2] if s.endswith('.0') else s


class Plate:
    """One SVG plate: glyph outlines are defined once and placed with <use>."""

    def __init__(self, w, h, theme, title, desc, animate=True):
        self.w, self.h, self.t = w, h, THEMES[theme]
        self.crop = None                 # (x0, y0, x1, y1): the part of the plate an SVG shows
        self.box = [math.inf, math.inf, -math.inf, -math.inf]
        self.tracking = True
        self.theme = theme
        self.title, self.desc = title, desc
        self.animate = animate
        self.body = []
        self.glyph_ids = {}
        self.defs = []

    # ── low level ──
    def add(self, s):
        self.body.append(s)

    def grow(self, x0, y0, x1, y1):
        """Content bounds, for cropping. Rotated work is drawn untracked and
        grows the bounds by its rotated extent instead."""
        if not self.tracking:
            return
        b = self.box
        b[0], b[1], b[2], b[3] = min(b[0], x0, x1), min(b[1], y0, y1), max(b[2], x0, x1), max(b[3], y0, y1)

    def anim(self, cls, delay):
        if not self.animate or cls != 'd':
            return ''   # only lines are inked; type and fills are there from the first frame
        return f' class="{cls}" style="animation-delay:{delay:.2f}s"'

    def pencil(self, cls, fill):
        """Whether a drawn element also gets its static pencil twin."""
        return self.animate and cls == 'd' and fill == 'none'

    @contextmanager
    def group(self, cls=None, delay=0.0, attrs=''):
        self.add(f'<g{self.anim(cls, delay)}{(" " + attrs) if attrs else ""}>')
        yield
        self.add('</g>')

    def gid(self, fk, name):
        key = (fk, name)
        if key not in self.glyph_ids:
            self.glyph_ids[key] = f'g{len(self.glyph_ids)}'
        return self.glyph_ids[key]

    # ── type ──
    def text(self, x, y, s, size, fk='rm', feats='', ls=0.0, fill=None, anchor='start', cls=None, delay=0.0):
        """Set one run on the baseline y; returns its width."""
        if not s:
            return 0.0
        f = font(fk)
        gl = shape(fk, s, feats)
        sc = size * f.scale / f.upm
        width = (sum(g[1] for g in gl) + ls * f.upm * max(0, len(gl) - 1)) * sc
        x0 = x - width if anchor == 'end' else x - width / 2 if anchor == 'middle' else x
        uses, pen = [], 0.0
        for name, ax, dx, dy in gl:
            if font(fk).outline(name):
                ydy = f' y="{-dy}"' if dy else ''
                uses.append(f'<use xlink:href="#{self.gid(fk, name)}" x="{round(pen + dx)}"{ydy}/>')
            pen += ax + ls * f.upm
        fill = fill or self.t['ink']
        self.grow(x0, y - size * 0.72, x0 + width, y + size * 0.28)
        self.add(f'<g{self.anim(cls, delay)}><g transform="translate({n(x0)} {n(y)}) scale({sc:.5f} {-sc:.5f})" '
                 f'fill="{fill}">{"".join(uses)}</g></g>')
        return width

    def rich(self, x, y, pieces, size, fill=None, cls=None, delay=0.0, anchor='start'):
        """Set a line made of (text, fk, feats) pieces; returns its width."""
        w = sum(measure(pc[0], size, pc[1], pc[2]) for pc in pieces)
        x0 = x - w if anchor == 'end' else x - w / 2 if anchor == 'middle' else x
        with self.group(cls, delay):
            for pc in pieces:
                x0 += self.text(x0, y, pc[0], size, pc[1], pc[2], fill=pc[3] if len(pc) > 3 else fill)
        return w

    # ── lines ──
    def path(self, d, w=THIN, color=None, fill='none', dash=None, cls=None, delay=0.0, cap='butt', extra=''):
        color = color or self.t['ink']
        dash_a = f' stroke-dasharray="{dash}"' if dash else ''
        pl = ' pathLength="1"' if (cls == 'd' and self.animate) else ''
        stroke = f' stroke="{color}" stroke-width="{w}"' if w else ''
        if w and self.pencil(cls, fill):
            self.add(f'<path d="{d}" fill="none" stroke="{self.t["pencil"]}" stroke-width="{min(w, 1.0)}"'
                     f'{dash_a} opacity=".75"/>')
        self.add(f'<path d="{d}" fill="{fill}"{stroke}{dash_a} stroke-linecap="{cap}"'
                 f' stroke-linejoin="round"{pl}{self.anim(cls, delay)}{extra}/>')

    def line(self, x1, y1, x2, y2, w=THIN, **kw):
        self.grow(x1, y1, x2, y2)
        self.path(f'M{n(x1)} {n(y1)}L{n(x2)} {n(y2)}', w, **kw)

    def poly(self, pts, w=THIN, close=False, **kw):
        for x, y in pts:
            self.grow(x, y, x, y)
        d = 'M' + 'L'.join(f'{n(x)} {n(y)}' for x, y in pts) + ('Z' if close else '')
        self.path(d, w, **kw)

    def circle(self, cx, cy, r, w=THIN, color=None, fill='none', dash=None, cls=None, delay=0.0):
        self.grow(cx - r, cy - r, cx + r, cy + r)
        color = color or self.t['ink']
        dash_a = f' stroke-dasharray="{dash}"' if dash else ''
        pl = ' pathLength="1"' if (cls == 'd' and self.animate) else ''
        if self.pencil(cls, fill):
            self.add(f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="none" stroke="{self.t["pencil"]}" '
                     f'stroke-width="{min(w, 1.0)}"{dash_a} opacity=".75"/>')
        self.add(f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="{fill}" stroke="{color}" '
                 f'stroke-width="{w}"{dash_a}{pl}{self.anim(cls, delay)}/>')

    def arrow(self, x, y, dx, dy, length=12.0, half=2.1, color=None, cls=None, delay=0.0):
        """Filled arrowhead with its tip at (x, y), pointing along (dx, dy)."""
        L = math.hypot(dx, dy)
        ux, uy = dx / L, dy / L
        bx, by = x - ux * length, y - uy * length
        pts = [(x, y), (bx - uy * half, by + ux * half), (bx + uy * half, by - ux * half)]
        self.poly(pts, 0, close=True, fill=color or self.t['ink'], cls=cls, delay=delay)

    # ── output ──
    def svg(self):
        glyphs = ''.join(f'<path id="{i}" d="{font(fk).outline(g)}"/>' for (fk, g), i in self.glyph_ids.items())
        style = f'<style>{CSS}</style>' if self.animate else ''
        x0, y0, x1, y1 = self.crop or (0, 0, self.w, self.h)
        w, h = round(x1 - x0), round(y1 - y0)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
                f'width="{w}" height="{h}" viewBox="{n(x0)} {n(y0)} {w} {h}" role="img" aria-labelledby="t d">'
                f'<title id="t">{esc(self.title)}</title><desc id="d">{esc(self.desc)}</desc>'
                f'{style}<defs>{"".join(self.defs)}{glyphs}</defs>'
                f'{"".join(self.body)}</svg>')


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


# ─── Composition helpers ────────────────────────────────────────────────────

def oxford_rule(p, x1, x2, y, cls=None, delay=0.0, color=None):
    """The thick-thin rule of title pages."""
    p.line(x1, y, x2, y, 3.2, color=color, cls=cls, delay=delay)
    p.line(x1, y + 6, x2, y + 6, 0.9, color=color, cls=cls, delay=delay + 0.15)


def fleuron(p, x, y, size=34, ch='❦', color=None, cls='f', delay=0.0):
    p.text(x, y, ch, size, 'rm', fill=color or p.t['accent'], anchor='middle', cls=cls, delay=delay)


def diameter(p, x, y, size, color=None):
    """The drawing sign for a diameter (ISO 3098: a circle crossed at 75°)."""
    r = size * 0.27
    cx, cy = x + r + size * 0.04, y - size * 0.33
    p.circle(cx, cy, r, w=size * 0.055, color=color)
    a = math.radians(75)
    L = r * 1.35
    p.line(cx - math.cos(a) * L, cy + math.sin(a) * L, cx + math.cos(a) * L, cy - math.sin(a) * L,
           w=size * 0.055, color=color, cap='round')
    return 2 * r + size * 0.12


def label_width(s, size, fk='rm8'):
    parts = s.split('⌀')
    return sum(measure(t, size, fk, 'lnum,tnum') for t in parts) + (len(parts) - 1) * size * 0.66


def label(p, x, y, s, size=22, anchor='middle', color=None, fk='rm8', cls=None, delay=0.0):
    """A drawing label in lining figures; every ⌀ becomes the drawing sign."""
    w = label_width(s, size, fk)
    x0 = x - w if anchor == 'end' else x - w / 2 if anchor == 'middle' else x
    with p.group(cls, delay):
        for i, t in enumerate(s.split('⌀')):
            if i:
                x0 += diameter(p, x0, y, size, color)
            x0 += p.text(x0, y, t, size, fk, 'lnum,tnum', fill=color)
    return w


# ─── Technical drawing ──────────────────────────────────────────────────────

class View:
    """An orthographic view: model (a, b) → plate (x, y), y pointing down."""

    def __init__(self, ox, oy, k, mapping):
        self.ox, self.oy, self.k, self.m = ox, oy, k, mapping

    def __call__(self, a, b):
        u, v = self.m(a, b)
        return self.ox + self.k * u, self.oy - self.k * v


def _spans(rot_rings, v):
    """Even-odd spans of the rotated rings along the scan line v."""
    xs = []
    for ring in rot_rings:
        for (pu, pv), (qu, qv) in zip(ring, ring[1:] + ring[:1]):
            if (pv <= v < qv) or (qv <= v < pv):
                xs.append(pu + (v - pv) / (qv - pv) * (qu - pu))
    xs.sort()
    return list(zip(xs[::2], xs[1::2]))


def _minus(spans, cuts):
    for c0, c1 in cuts:
        out = []
        for a, b in spans:
            if c1 <= a or c0 >= b:
                out.append((a, b))
                continue
            if c0 > a:
                out.append((a, c0))
            if c1 < b:
                out.append((c1, b))
        spans = out
    return spans


def hatch(p, rings, spacing=6.5, angle=45, w=FINE, color=None, cls='d', delay=0.0, step=0.018, exclude=()):
    """Hatching: parallel lines inside the rings (even-odd), minus every
    region in `exclude`, phase-locked to the plate so every region of one part
    shares one pattern."""
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)

    def rotate(ring):
        return [(x * ca - y * sa, x * sa + y * ca) for x, y in ring]

    rot, rot_ex = [rotate(r) for r in rings], [rotate(r) for r in exclude]
    vs = [v for ring in rot for _, v in ring]
    v = math.ceil(min(vs) / spacing) * spacing
    k = 0
    while v < max(vs):
        spans = _spans(rot, v)
        for ring in rot_ex:
            spans = _minus(spans, _spans([ring], v))
        for u1, u2 in spans:
            if u2 - u1 < 0.6:
                continue
            p.line(u1 * ca + v * sa, -u1 * sa + v * ca, u2 * ca + v * sa, -u2 * sa + v * ca, w, color=color,
                   cls=cls, delay=delay + k * step)
        k += 1
        v += spacing


def dim_linear(p, a, b, offset, text, horizontal=True, size=22, delay=0.0, ext_gap=4, ext_over=6):
    """A linear dimension between plate points a and b, its line `offset` away
    (negative = above / left). Narrow lines, closed arrowheads, text on top."""
    (ax, ay), (bx, by) = a, b
    if horizontal:
        yd = min(ay, by) + offset if offset < 0 else max(ay, by) + offset
        s = 1 if offset > 0 else -1
        p.line(ax, ay + s * ext_gap, ax, yd + s * ext_over, FINE, cls='f', delay=delay)
        p.line(bx, by + s * ext_gap, bx, yd + s * ext_over, FINE, cls='f', delay=delay)
        p.line(ax, yd, bx, yd, FINE, cls='d', delay=delay + 0.1)
        p.arrow(ax, yd, ax - bx, 0, cls='f', delay=delay + 0.3)
        p.arrow(bx, yd, bx - ax, 0, cls='f', delay=delay + 0.3)
        label(p, (ax + bx) / 2, yd - 7, text, size, cls='f', delay=delay + 0.35)
    else:
        xd = min(ax, bx) + offset if offset < 0 else max(ax, bx) + offset
        s = 1 if offset > 0 else -1
        p.line(ax + s * ext_gap, ay, xd + s * ext_over, ay, FINE, cls='f', delay=delay)
        p.line(bx + s * ext_gap, by, xd + s * ext_over, by, FINE, cls='f', delay=delay)
        p.line(xd, ay, xd, by, FINE, cls='d', delay=delay + 0.1)
        p.arrow(xd, ay, 0, ay - by, cls='f', delay=delay + 0.3)
        p.arrow(xd, by, 0, by - ay, cls='f', delay=delay + 0.3)
        cx, cy = xd - 7, (ay + by) / 2
        p.add(f'<g transform="rotate(-90 {n(cx)} {n(cy)})">')
        label(p, cx, cy, text, size, cls='f', delay=delay + 0.35)
        p.add('</g>')


def leader(p, tip, knee, text, size=22, right=True, delay=0.0):
    """A leader: arrow on the feature, a knee, a shoulder carrying the text."""
    (tx, ty), (kx, ky) = tip, knee
    tw = label_width(text, size)
    ex = kx + (tw + 10) * (1 if right else -1)
    p.line(tx, ty, kx, ky, FINE, cls='d', delay=delay)
    p.line(kx, ky, ex, ky, FINE, cls='d', delay=delay + 0.2)
    p.arrow(tx, ty, tx - kx, ty - ky, cls='f', delay=delay + 0.3)
    label(p, kx + 5 if right else ex + 5, ky - 7, text, size, anchor='start', cls='f', delay=delay + 0.35)


def projection_symbol(p, cx, cy, h, method='first', w=THICK, color=None, cls='d', delay=0.0):
    """ISO 5456-2 projection symbol, h = diameter of the large circle.

    The truncated cone is drawn small end left, large end right; its view from
    the small end (two circles) sits right of it in first-angle projection and
    left of it in third-angle projection."""
    D, d, L, gap = h, h * 0.5, h * 0.95, h * 0.42
    total = L + gap + D
    x0 = cx - total / 2
    if method == 'first':
        tx, ccx = x0, x0 + L + gap + D / 2
    else:
        ccx, tx = x0 + D / 2, x0 + D + gap
    p.poly([(tx, cy - d / 2), (tx + L, cy - D / 2), (tx + L, cy + D / 2), (tx, cy + d / 2)], w,
           close=True, color=color, cls=cls, delay=delay)
    p.circle(ccx, cy, D / 2, w, color=color, cls=cls, delay=delay + 0.1)
    p.circle(ccx, cy, d / 2, w, color=color, cls=cls, delay=delay + 0.2)
    over = h * 0.16
    p.line(x0 - over, cy, x0 + total + over, cy, FINE, color=color, dash='9 2.5 1.5 2.5', cls='f', delay=delay + 0.3)
    p.line(ccx, cy - D / 2 - over, ccx, cy + D / 2 + over, FINE, color=color, dash='9 2.5 1.5 2.5', cls='f',
           delay=delay + 0.3)


# ─── Exact lines and arcs ───────────────────────────────────────────────────
# A drawing is made of segments in the 2D coordinates of a view:
# ('L', a, b) a line, ('A', a, b, centre, r, m) an arc through m.

TOL = 1e-6      # mm: what counts as the same point, line or circle


def circle3(a, b, c):
    """Centre and radius of the circle through three points; None if they are collinear."""
    (ax, ay), (bx, by), (cx, cy) = a, b, c
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return None
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    return (ux, uy), math.hypot(ax - ux, ay - uy)


def segment(edge, proj):
    """An edge, projected into a view by proj (3D point → 2D), as an exact line or arc.

    The kernel hands sections and outlines over as B-splines; their control
    points lie on a line, or they are rational arcs. Seventeen points along the
    edge must agree with the line or circle within TOL."""
    pts = [proj(edge.start)] + [proj(edge.point_at(i / 16)) for i in range(1, 16)] + [proj(edge.end)]
    a, b = pts[0], pts[-1]
    chord = math.hypot(b[0] - a[0], b[1] - a[1])
    off_line = max(abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) for q in pts)
    if chord > TOL and off_line < TOL * chord:
        return ('L', a, b)
    fit = circle3(a, pts[8], b)
    if fit and max(abs(math.dist(q, fit[0]) - fit[1]) for q in pts) < TOL * max(1.0, fit[1]):
        return ('A', a, b, fit[0], fit[1], pts[8])
    raise SystemExit(f'build.py draws lines and arcs, not this edge: {edge}')


def arc_span(s):
    """Start angle and signed sweep of an arc (counter-clockwise positive, in the model)."""
    a0, am, a1 = (math.atan2(q[1] - s[3][1], q[0] - s[3][0]) for q in (s[1], s[5], s[2]))
    ccw = (a1 - a0) % (2 * math.pi)
    return a0, (ccw if (am - a0) % (2 * math.pi) <= ccw else ccw - 2 * math.pi)


def seg_length(s):
    if s[0] == 'L':
        return math.hypot(s[2][0] - s[1][0], s[2][1] - s[1][1])
    return s[4] * abs(arc_span(s)[1])


def on_segment(q, s):
    """Whether the point q lies on the segment s."""
    if s[0] == 'A':
        (cx, cy), r = s[3], s[4]
        if abs(math.hypot(q[0] - cx, q[1] - cy) - r) > TOL * max(1.0, r):
            return False
        a0, sweep = arc_span(s)
        t = (math.atan2(q[1] - cy, q[0] - cx) - a0) % (2 * math.pi)
        t = t if sweep > 0 else (2 * math.pi - t) % (2 * math.pi)
        return t <= abs(sweep) + TOL / r
    (ax, ay), (bx, by) = s[1], s[2]
    L2 = (bx - ax) ** 2 + (by - ay) ** 2
    t = ((q[0] - ax) * (bx - ax) + (q[1] - ay) * (by - ay)) / L2
    if t < -TOL or t > 1 + TOL:
        return False
    return math.hypot(ax + t * (bx - ax) - q[0], ay + t * (by - ay) - q[1]) < TOL


def midpoint(s):
    return ((s[1][0] + s[2][0]) / 2, (s[1][1] + s[2][1]) / 2) if s[0] == 'L' else s[5]


def line_minus(s, covers):
    """The pieces of the line s that no collinear line in covers overlaps."""
    (ax, ay), (bx, by) = s[1], s[2]
    L = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / L, (by - ay) / L
    spans = [(0.0, L)]
    for c in covers:
        if c[0] != 'L' or any(abs((q[0] - ax) * uy - (q[1] - ay) * ux) > TOL for q in c[1:3]):
            continue
        c0, c1 = sorted((q[0] - ax) * ux + (q[1] - ay) * uy for q in c[1:3])
        spans = [piece for s0, s1 in spans for piece in
                 ([(s0, s1)] if c1 <= s0 + TOL or c0 >= s1 - TOL else
                  ([(s0, c0)] if c0 > s0 + TOL else []) + ([(c1, s1)] if c1 < s1 - TOL else []))]
    return [('L', (ax + ux * s0, ay + uy * s0), (ax + ux * s1, ay + uy * s1)) for s0, s1 in spans if s1 - s0 > 1e-3]


def path_data(view, segs, close=False):
    """SVG path data for a chain of segments, mapped into the plate by view."""
    d = []
    for i, s in enumerate(segs):
        a, b = view(*s[1]), view(*s[2])
        if i == 0:
            d.append(f'M{n(a[0])} {n(a[1])}')
        if s[0] == 'L':
            d.append(f'L{n(b[0])} {n(b[1])}')
            continue
        m = view(*s[5])
        r = s[4] * view.k
        clockwise = (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]) > 0    # on the plate, y down
        large = int(abs(arc_span(s)[1]) > math.pi)
        d.append(f'A{n(r)} {n(r)} 0 {large} {int(clockwise)} {n(b[0])} {n(b[1])}')
    return ''.join(d) + ('Z' if close else '')


def polygon(view, segs, step=1.5):
    """A closed chain of segments as a polygon in the plate, arcs sampled every
    `step` plate units (for hatching)."""
    pts = []
    for s in segs:
        if s[0] == 'L':
            pts.append(view(*s[1]))
            continue
        (cx, cy), r = s[3], s[4]
        a0, sweep = arc_span(s)
        k = max(4, math.ceil(seg_length(s) * view.k / step))
        pts += [view(cx + r * math.cos(a0 + sweep * i / k), cy + r * math.sin(a0 + sweep * i / k)) for i in range(k)]
    return pts


def chains(segs):
    """Join segments that meet end to end into chains (one path each)."""
    left, out = list(segs), []
    while left:
        chain = [left.pop(0)]
        grown = True
        while grown:
            grown = False
            for i, s in enumerate(left):
                flipped = (s[0], s[2], s[1], *s[3:])
                for cand, at_end in ((s, True), (flipped, True), (flipped, False), (s, False)):
                    if at_end and math.dist(chain[-1][2], cand[1]) < TOL:
                        chain.append(cand)
                    elif not at_end and math.dist(chain[0][1], cand[2]) < TOL:
                        chain.insert(0, cand)
                    else:
                        continue
                    left.pop(i)
                    grown = True
                    break
                if grown:
                    break
        out.append(chain)
    return out


# ─── The part: the pipe flange of examples/flange.py, measured by smlibpy ───

def XZ(q):
    """Section A–A and what lies beyond it, seen from −Y."""
    return q.x, q.z


def YZ(q):
    """The view from the left, seen from −X."""
    return q.y, q.z


def XY(q):
    """The plan, seen from +Z."""
    return q.x, q.y


def flange_model():
    """The part, built by the example itself."""
    spec = importlib.util.spec_from_file_location('flange', os.path.join(ROOT, 'examples', 'flange.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.model()


def segments(edges, proj):
    """Edges as lines and arcs in a view; the kernel's slivers (under 0.01 mm) are dropped."""
    return [segment(e, proj) for e in edges if max(math.dist(proj(e.start), proj(e.end)), e.length) > 0.01]


def horizontal_circle(e):
    """(cx, cy, z, r) of an edge that is a circle in a plane z = const: exact for
    the kernel's circles; the chamfer's edges are cubic B-splines, fitted here
    (they keep within 3e-5 mm of their circle)."""
    pts = [e.point_at(i / 24) for i in range(25)]
    if e.geom_type == 'circle':
        (cx, cy), r = XY(e.arc_center), e.radius
    else:
        (cx, cy), r = circle3(XY(pts[0]), XY(pts[8]), XY(pts[16]))
    if any(abs(q.z - pts[0].z) > TOL or abs(math.hypot(q.x - cx, q.y - cy) - r) > 1e-4 for q in pts):
        raise SystemExit(f'build.py expects circles in planes z = const, not this edge: {e}')
    return cx, cy, pts[0].z, r


def merge(segs):
    """Every stretch once: lines are united, an arc is kept unless another covers it."""
    out = []
    for s in sorted(segs, key=lambda s: -seg_length(s)):
        if s[0] == 'L':
            out += line_minus(s, out)
        elif not any(all(on_segment(q, o) for q in (s[1], s[5], s[2])) for o in out):
            out.append(s)
    return out


def flange():
    """Everything the drawing shows, taken from the model."""
    part = flange_model()
    g = SimpleNamespace(volume=part.volume)

    # Section A–A: the cut in the plane y = 0, seen from −Y — the hatched faces, and what
    # shows beyond the cut: the half behind it seen the same way, less the cut's own outline.
    cut = part.section(Plane.XZ)
    g.rings = [segments(w.edges(), XZ) for f in cut.faces() for w in f.wires()]
    rims = [s for ring in g.rings for s in ring]
    behind = part.split(Plane.XZ, keep='below')
    g.beyond = merge([s for s in segments(behind.outline(Plane.XZ), XZ)
                      if not any(on_segment(midpoint(s), r) for r in rims)])

    # The view from the left: what the kernel's hidden-line removal leaves visible, and
    # what it hides — every other line of the projection: the circles of the edges seen
    # edge-on (not the tangent edges, which a drawing leaves out, as the outline does),
    # the contours of the bolt holes, and those of the faces of revolution, which are the
    # edges of the meridian section x = 0.
    g.left = merge(segments(part.outline(Plane.left), YZ))
    edges = [horizontal_circle(e) for e in part.edges() if e.convexity != 'smooth']
    holes = part.faces().cylinders()
    held = [('L', (cy - r, z), (cy + r, z)) for cx, cy, z, r in edges]
    for f in holes:
        o, d, bb = f.axis.origin, f.axis.direction, f.bbox()
        if abs(abs(d.z) - 1) > TOL:
            raise SystemExit('build.py expects bolt holes along Z')
        held += [('L', (o.y + s * f.radius, bb.min.z), (o.y + s * f.radius, bb.max.z)) for s in (-1, 1)]
    held += [s for f in part.section(Plane.left).faces() for w in f.wires() for s in segments(w.edges(), YZ)]
    hidden = []
    for s in held:
        if s[0] == 'L':
            hidden += line_minus(s, g.left)
        elif not any(on_segment(s[5], v) for v in g.left):
            hidden.append(s)
    g.hidden = merge(hidden)

    # The plan: the circles of the part's edges, each once, tangent edges left out; a
    # circle is drawn as visible when the kernel's outline seen from above holds it.
    seen = [horizontal_circle(e) for e in part.outline(Plane.XY)]
    g.plan = []
    for cx, cy, _, r in edges:
        if not any(math.hypot(cx - c[0], cy - c[1]) < 1e-4 and abs(r - c[2]) < 1e-4 for c, _ in g.plan):
            g.plan.append(((cx, cy, r), any(math.hypot(cx - c[0], cy - c[1]) < 1e-4 and abs(r - c[3]) < 1e-4
                                            for c in seen)))

    # The numbers on the drawing
    g.holes = [XY(f.axis.origin) for f in holes]
    g.r_hole = holes[0].radius
    g.pcd = 2 * math.hypot(*g.holes[0])
    axial = [r for (cx, cy, r), _ in g.plan if math.hypot(cx, cy) < 1e-4]
    g.r_plate, g.r_bore = max(axial), min(axial)
    bb = part.bbox()
    g.height = bb.max.z - bb.min.z
    g.t_plate = holes[0].bbox().max.z - holes[0].bbox().min.z            # the holes go through the plate
    g.r_neck = max(min(s[1][0], s[2][0]) for s in rims if s[0] == 'L' and abs(s[1][0] - s[2][0]) < TOL
                   and min(s[1][1], s[2][1]) > g.t_plate + TOL)            # the wall standing on the plate
    return g


def mm(v):
    """A dimension as the drawing states it: 120, 47.5."""
    return f'{round(v, 3):g}'


def draw_flange(p, g, fx, fy, k, lx, tx, ty, t0=0.2):
    """Section A–A (front), view from the left and plan, in first-angle
    projection: plan below the section, view from the left to its right."""
    F = View(fx, fy, k, lambda x, z: (x, z))           # section A–A, looking +Y
    L = View(lx, fy, k, lambda y, z: (-y, z))          # from the left (camera −X)
    T = View(tx, ty, k, lambda x, y: (x, y))           # plan, looking −Z
    acc = p.t['accent']
    R, H, over = g.r_plate, g.height, 22 / k           # centre lines run 22 plate units past an outline

    # centre lines first — the draughtsman's construction
    with p.group('f', t0):
        p.line(*F(0, -8 / k), *F(0, H + over), FINE, dash=CHAIN)     # short below: the ⌀ of the plate
        for bx, by in g.holes:
            if abs(by) < TOL:                          # the bolt holes the cut runs through
                p.line(*F(bx, -over / 2), *F(bx, g.t_plate + over / 2), FINE, dash=CHAIN)
        p.line(*L(0, -over), *L(0, H + over), FINE, dash=CHAIN)
        p.line(*T(-R - over, 0), *T(R + over, 0), FINE, dash=CHAIN)
        p.line(*T(0, -R - over), *T(0, R + over), FINE, dash=CHAIN)
        p.circle(*T(0, 0), g.pcd / 2 * k, FINE, dash=CHAIN)
        for bx, by in g.holes:
            if abs(bx) > TOL and abs(by) > TOL:        # the others lie on the centre lines
                ux, uy = bx / math.hypot(bx, by), by / math.hypot(bx, by)
                e = g.r_hole + over / 2.5
                p.line(*T(bx - ux * e, by - uy * e), *T(bx + ux * e, by + uy * e), FINE, dash='6 2 1.5 2')

    # section A–A: the cut, hatched, and the bore and the cut bolt holes beyond it
    t = t0 + 0.3
    for ring in g.rings:
        p.path(path_data(F, ring, close=True), THICK, cls='d', delay=t)
        t += 0.15
    hatch(p, [polygon(F, ring) for ring in g.rings], spacing=5, cls='d', delay=t0 + 1.0, step=0.012)
    for chain in chains(g.beyond):
        p.path(path_data(F, chain), THICK, cls='d', delay=t)

    # view from the left: the outline, and the bore and the bolt holes hidden in it
    t = t0 + 0.9
    for i, chain in enumerate(chains(g.left)):
        p.path(path_data(L, chain), THICK, cls='d', delay=t + i * 0.1)
    with p.group('f', t + 0.6):
        for s in g.hidden:
            p.path(path_data(L, [s]), THIN, dash=DASHED)

    # plan: rim, neck and bore with their chamfers, the bolt holes
    t = t0 + 1.4
    for i, ((cx, cy, r), seen) in enumerate(sorted(g.plan, key=lambda c: (math.hypot(*c[0][:2]) > TOL, -c[0][2]))):
        if seen:
            p.circle(*T(cx, cy), r * k, THICK, cls='d', delay=t + i * 0.06)
        else:
            p.circle(*T(cx, cy), r * k, THIN, dash=DASHED, cls='f', delay=t + 0.7)

    # cutting plane A–A in the plan, arrows looking +Y (up on the plan)
    t = t0 + 2.0
    for s in (-1, 1):
        xa, ya = T(s * R, 0)
        xa, xb, yb = xa + s * 13, xa + s * 43, ya
        p.line(xa, ya, xb, yb, THICK, color=acc, cls='d', delay=t)
        p.line(xb, yb, xb, yb - 22, FINE, color=acc, cls='d', delay=t + 0.1)
        p.arrow(xb, yb - 24, 0, -1, color=acc, cls='f', delay=t + 0.3)
        p.text(xb, yb - 44, 'A', 24, 'rm', anchor='middle', fill=acc, cls='f', delay=t + 0.3)
    fx0, fy0 = F(0, H)
    p.rich(fx0, fy0 - 106, [('A–A', 'rm', 'lnum')], 26, fill=acc, cls='f', delay=t + 0.2, anchor='middle')

    # dimensions, to the sharp corners the chamfers take off
    t = t0 + 2.4
    dim_linear(p, F(-g.r_bore, H), F(g.r_bore, H), -22, f'⌀{mm(2 * g.r_bore)}', delay=t)
    dim_linear(p, F(-g.r_neck, H), F(g.r_neck, H), -56, f'⌀{mm(2 * g.r_neck)}', delay=t + 0.1)
    dim_linear(p, F(-R, 0), F(R, 0), 32, f'⌀{mm(2 * R)}', delay=t + 0.2)
    dim_linear(p, F(-R, g.t_plate), F(-R, 0), -20, mm(g.t_plate), horizontal=False, delay=t + 0.3)
    dim_linear(p, F(-g.r_neck, H), F(-R, 0), -48, mm(H), horizontal=False, delay=t + 0.4)
    bx, by = min(g.holes, key=lambda h: abs(math.atan2(h[1], h[0]) - math.pi / 4))
    hx, hy = T(bx + g.r_hole * 0.72, by + g.r_hole * 0.72)
    leader(p, (hx, hy), (hx + 44, hy - 58), f'{len(g.holes)}× ⌀{mm(2 * g.r_hole)} on ⌀{mm(g.pcd)}', delay=t + 0.6)
    return F, L, T


# ─── The frontispiece and the title page ────────────────────────────────────

def plate_frontispiece(theme, g):
    W, H_ = 1600, 1120
    p = Plate(W, H_, theme, 'smlibpy — The Art of Modelling in Python', animate=True, desc=
              'Frontispiece: an engineering drawing of the pipe flange of examples/flange.py — section A–A, the '
              'view from the left and the plan in first-angle projection, dimensioned, with a title block that '
              'gives the volume smlibpy measures. Title page: smlib·py, or, the Art of Modelling in Python — '
              'wherein the SMLib kernel is given to Python: to build exact parts from short scripts, to draw what '
              'it has built, and to prove the work in numbers. In four parts: the library, the renderer, the MCP '
              'server, the skill. MMXXVI.')
    t = p.t

    # ── verso: the drawing sheet ──
    X0, Y0, X1, Y1 = 58, 70, 742, 1004        # trimmed sheet
    B = 16                                    # zone strip
    p.poly([(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)], FINE, close=True, color=t['ink2'], cls='d', delay=0.0)
    p.poly([(X0 + B, Y0 + B), (X1 - B, Y0 + B), (X1 - B, Y1 - B), (X0 + B, Y1 - B)], THICK, close=True,
           cls='d', delay=0.1)
    cols, rows = 4, 5
    with p.group('f', 0.5):
        for i in range(cols):
            xa = X0 + B + (X1 - X0 - 2 * B) * i / cols
            xm = xa + (X1 - X0 - 2 * B) / cols / 2
            if i:
                p.line(xa, Y0, xa, Y0 + B, FINE)
                p.line(xa, Y1 - B, xa, Y1, FINE)
            for yy in (Y0 + B - 4, Y1 - 3.5):
                p.text(xm, yy, str(i + 1), 13, 'rm8', 'onum', anchor='middle', fill=t['ink2'])
        for i in range(rows):
            ya = Y0 + B + (Y1 - Y0 - 2 * B) * i / rows
            ym = ya + (Y1 - Y0 - 2 * B) / rows / 2
            if i:
                p.line(X0, ya, X0 + B, ya, FINE)
                p.line(X1 - B, ya, X1, ya, FINE)
            for xx in (X0 + B / 2, X1 - B / 2):
                p.text(xx, ym + 4.5, 'ABCDE'[i], 13, 'rm8', 'smcp,c2sc', anchor='middle', fill=t['ink2'])
        # centring marks
        for x, y, dx, dy in ((W / 4 - 2, Y0, 0, 1), ((X0 + X1) / 2, Y1, 0, -1), (X0, (Y0 + Y1) / 2, 1, 0),
                             (X1, (Y0 + Y1) / 2, -1, 0)):
            p.line(x, y, x + dx * (B + 8), y + dy * (B + 8), THICK)

    draw_flange(p, g, fx=283, fy=347, k=2.15, lx=585, tx=283, ty=637)

    # title block (ISO 7200 fields, trimmed to what a README can own), with the volume smlibpy measures
    bx0, by0, bx1, by1 = 372, 870, X1 - B, Y1 - B
    with p.group('f', 3.6):
        p.poly([(bx0, by0), (bx1, by0), (bx1, by1), (bx0, by1)], THIN, close=True)
        mid = by0 + 62
        p.line(bx0, mid, bx1, mid, FINE)
        vx = bx0 + 146
        for x in (vx, bx1 - 96):
            p.line(x, by0, x, mid, FINE)
        cells = [bx0, bx0 + 82, bx0 + 174, bx0 + 292, bx1]
        for c in cells[1:-1]:
            p.line(c, mid, c, by1, FINE)
        p.text(bx0 + 10, by0 + 18, 'awv informatik ag', 12, 'rm8', 'smcp,c2sc', ls=0.12, fill=t['ink2'])
        p.text(bx0 + 10, by0 + 48, 'Pipe flange', 27, 'rm')
        v = f'{g.volume:,.1f}'.replace(',', '\u2009')                # thin space between thousands
        p.text(vx + 7, by0 + 15, 'volume', 11, 'rm8', 'smcp,c2sc', ls=0.1, fill=t['ink2'])
        p.text(vx + 7, mid - 11, f'{v} mm³', 17, 'rm8', 'lnum')
        heads = ['created by', 'date', 'doc. no.', 'sheet']
        vals = [('AWV', 'rm8', 'c2sc'), ('13·10·2026', 'rm8', 'lnum'), ('SMLIBPY–001', 'rm8', 'lnum'),
                ('I of I', 'rm8', 'smcp,c2sc')]
        for c0, c1, hd, (val, fk, ft) in zip(cells, cells[1:], heads, vals):
            p.text(c0 + 7, mid + 15, hd, 11, 'rm8', 'smcp,c2sc', ls=0.1, fill=t['ink2'])
            p.text(c0 + 7, by1 - 11, val, 17, fk, ft)
    projection_symbol(p, bx1 - 48, by0 + 27, 21, 'first', w=1.5, cls='d', delay=3.7)
    p.text(bx1 - 48, by0 + 55, 'iso e', 11, 'rm8', 'smcp,c2sc', ls=0.15, anchor='middle', fill=t['ink2'],
           cls='f', delay=3.8)

    # ── recto: the title page ──
    cx = 1200
    d0 = 0.35
    p.text(cx, 146, 'smlib·py', 44, 'rm', 'smcp,c2sc', ls=0.24, anchor='middle', cls='u', delay=d0)
    oxford_rule(p, cx - 250, cx + 250, 176, cls='d', delay=d0 + 0.2)
    p.text(cx, 240, 'or,', 30, 'it', anchor='middle', cls='u', delay=d0 + 0.5, fill=t['ink2'])
    p.text(cx, 300, 'the art of', 30, 'rm', 'smcp,c2sc', ls=0.3, anchor='middle', cls='u', delay=d0 + 0.6)
    p.text(cx, 410, 'Modelling', 118, 'rm', 'onum', anchor='middle', cls='u', delay=d0 + 0.75)
    p.text(cx, 518, 'in Python', 104, 'it', 'onum', anchor='middle', cls='u', delay=d0 + 0.95)
    p.line(cx - 40, 570, cx + 40, 570, 1.2, color=t['accent'], cls='d', delay=d0 + 1.2)
    sub = ['Wherein the SMLib kernel',
           'is given to Python: to build exact parts',
           'from short scripts, to draw what it has built,',
           'and to prove the work in numbers.']
    for i, line in enumerate(sub):
        p.text(cx, 624 + i * 40, line, 29, 'it', anchor='middle', cls='u', delay=d0 + 1.3 + i * 0.1)
    fleuron(p, cx, 804, 40, delay=d0 + 1.8)
    p.text(cx, 862, 'in four parts', 19, 'rm8', 'smcp,c2sc', ls=0.3, anchor='middle', cls='u', delay=d0 + 1.9,
           fill=t['ink2'])
    dot = ('  ·  ', 'rm', '')
    p.rich(cx, 898, [('The Library', 'rm', ''), dot, ('The Renderer', 'rm', '')], 26, anchor='middle', cls='u',
           delay=d0 + 2.0)
    p.rich(cx, 932, [('The ', 'rm', ''), ('mcp', 'rm', 'smcp'), (' Server', 'rm', ''), dot, ('The Skill', 'rm', '')],
           26, anchor='middle', cls='u', delay=d0 + 2.1)
    p.line(cx - 250, 972, cx + 250, 972, FINE, cls='d', delay=d0 + 2.3)
    p.text(cx, 1001, 'mmxxvi', 20, 'rm8', 'smcp,c2sc', ls=0.3, anchor='middle')
    return p


def write(p, name):
    path = os.path.join(HERE, name)
    with open(path, 'w') as fh:
        fh.write(p.svg())
    print(f'{os.path.relpath(path, ROOT)}  {os.path.getsize(path) // 1024} KB')


def main():
    g = flange()
    for theme in THEMES:
        p = plate_frontispiece(theme, g)
        bx0, by0, bx1, by1 = p.box
        p.crop = (bx0 - 2, by0 - 2, bx1 + 2, by1 + 4)
        write(p, f'frontispiece.{theme}.svg')


if __name__ == '__main__':
    main()
