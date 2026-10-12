"""Exact planar geometry: lines and circular arcs in the local coordinates of a sketch plane.

Points and directions are complex numbers (``x + yj``). Everything here is plain Python and
exact up to floating point: lines stay lines and arcs stay circles. The pen (``Profile``),
corner fillets and chamfers, offsets, strokes, hulls and mirrors of sketches are built from
these pieces and hand exact lines and circles to the kernel (see ``_regions``).

Conventions: a loop is a list of segments, each starting where the previous one ends. A
closed loop that bounds a region runs counterclockwise around it (the region on the left);
holes run clockwise. Offsets are positive to the left of the direction of travel.
"""

from __future__ import annotations

import cmath
import math
from dataclasses import dataclass
from typing import Any, Callable, Sequence

TAU = 2.0 * math.pi
#: Turns smaller than this (the sine of the angle between two tangents) count as smooth.
SMOOTH = 1e-9


class GeometryError(Exception):
    """A planar construction that cannot be made. The message names what does not fit."""


class NeedBooleans(Exception):
    """A direct construction (offset, stroke) that does not resolve locally; the caller falls
    back to the construction from pieces and Booleans."""


# -----------------------------------------------------------------------------
# small helpers
# -----------------------------------------------------------------------------
def cross(a: complex, b: complex) -> float:
    return a.real * b.imag - a.imag * b.real


def dot(a: complex, b: complex) -> float:
    return a.real * b.real + a.imag * b.imag


def unit(z: complex) -> complex:
    n = abs(z)
    if n == 0.0:
        raise GeometryError("a direction of length zero")
    return z / n


def cis(angle: float) -> complex:
    return complex(math.cos(angle), math.sin(angle))


def fmt(v: float) -> str:
    """A number for messages: up to 4 decimals, no trailing zeros."""
    if abs(v) < 5e-5:
        return "0"
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def fmt_pt(p: complex) -> str:
    return f"({fmt(p.real)}, {fmt(p.imag)})"


def deg(a: float) -> str:
    return fmt(math.degrees(a))


def reflect(p: complex, o: complex, u2: complex) -> complex:
    """``p`` mirrored in the line through ``o`` whose direction squared is ``u2``."""
    return o + u2 * (p - o).conjugate()


# -----------------------------------------------------------------------------
# segments
# -----------------------------------------------------------------------------
class Seg:
    """A line or arc in the plane (or another curve, :class:`Curve2`, that is passed through)."""

    __slots__ = ()

    start: complex
    end: complex
    length: float
    t0: complex  # unit tangent at the start
    t1: complex  # unit tangent at the end

    def at(self, s: float) -> complex:
        raise NotImplementedError

    def position(self, p: complex) -> float:
        """Arc length from the start to the point of the carrier nearest ``p`` (negative
        before the start, beyond ``length`` after the end)."""
        raise NotImplementedError

    def piece(self, s0: float, s1: float) -> Seg:
        raise NotImplementedError

    def offset(self, e: float) -> Seg | None:
        raise GeometryError(f"a {self.kind} cannot be offset exactly")

    def reversed(self) -> Seg:
        raise NotImplementedError

    def reflected(self, o: complex, u2: complex) -> Seg:
        raise NotImplementedError

    def moved(self, rot: complex, shift: complex) -> Seg:
        raise NotImplementedError

    def area_term(self) -> float:
        raise NotImplementedError

    def sample(self, n: int) -> list[complex]:
        return [self.at(self.length * i / n) for i in range(n + 1)]

    kind = "curve"


@dataclass(frozen=True, slots=True)
class Line2(Seg):
    a: complex
    b: complex

    kind = "line"

    @property
    def start(self) -> complex:
        return self.a

    @property
    def end(self) -> complex:
        return self.b

    @property
    def length(self) -> float:
        return abs(self.b - self.a)

    @property
    def direction(self) -> complex:
        return unit(self.b - self.a)

    @property
    def t0(self) -> complex:
        return self.direction

    @property
    def t1(self) -> complex:
        return self.direction

    def at(self, s: float) -> complex:
        return self.a + self.direction * s

    def tangent(self, s: float) -> complex:
        return self.direction

    def position(self, p: complex) -> float:
        return dot(p - self.a, self.direction)

    def piece(self, s0: float, s1: float) -> Line2:
        return Line2(self.at(s0), self.at(s1))

    def offset(self, e: float) -> Line2:
        n = 1j * self.direction * e
        return Line2(self.a + n, self.b + n)

    def reversed(self) -> Line2:
        return Line2(self.b, self.a)

    def reflected(self, o: complex, u2: complex) -> Line2:
        return Line2(reflect(self.a, o, u2), reflect(self.b, o, u2))

    def moved(self, rot: complex, shift: complex) -> Line2:
        return Line2(self.a * rot + shift, self.b * rot + shift)

    def area_term(self) -> float:
        return 0.5 * cross(self.a, self.b)

    def sample(self, n: int) -> list[complex]:
        return [self.a, self.b]

    def __repr__(self) -> str:
        return f"Line2{fmt_pt(self.a)}->{fmt_pt(self.b)}"


@dataclass(frozen=True, slots=True)
class Arc2(Seg):
    c: complex
    r: float
    a0: float  # start angle (radians)
    sweep: float  # signed (radians): positive counterclockwise

    kind = "arc"

    @property
    def sign(self) -> float:
        return 1.0 if self.sweep > 0 else -1.0

    @property
    def start(self) -> complex:
        return self.c + self.r * cis(self.a0)

    @property
    def end(self) -> complex:
        return self.c + self.r * cis(self.a0 + self.sweep)

    @property
    def length(self) -> float:
        return self.r * abs(self.sweep)

    @property
    def closed(self) -> bool:
        return abs(abs(self.sweep) - TAU) < 1e-12

    def angle_at(self, s: float) -> float:
        return self.a0 + self.sign * s / self.r

    def at(self, s: float) -> complex:
        return self.c + self.r * cis(self.angle_at(s))

    def tangent(self, s: float) -> complex:
        return self.sign * 1j * cis(self.angle_at(s))

    @property
    def t0(self) -> complex:
        return self.sign * 1j * cis(self.a0)

    @property
    def t1(self) -> complex:
        return self.sign * 1j * cis(self.a0 + self.sweep)

    def position(self, p: complex) -> float:
        if p == self.c:
            return 0.0
        delta = (self.sign * (cmath.phase(p - self.c) - self.a0)) % TAU
        span = abs(self.sweep)
        if delta <= span + 1e-12:
            return self.r * delta
        after, before = delta - span, TAU - delta
        return self.r * delta if after <= before else -self.r * before

    def piece(self, s0: float, s1: float) -> Arc2:
        return Arc2(self.c, self.r, self.angle_at(s0), self.sign * (s1 - s0) / self.r)

    def offset(self, e: float) -> Arc2 | None:
        rr = self.r - self.sign * e
        if rr <= 1e-12 * max(1.0, self.r):
            return None
        return Arc2(self.c, rr, self.a0, self.sweep)

    def reversed(self) -> Arc2:
        return Arc2(self.c, self.r, self.a0 + self.sweep, -self.sweep)

    def reflected(self, o: complex, u2: complex) -> Arc2:
        return Arc2(reflect(self.c, o, u2), self.r, cmath.phase(u2) - self.a0, -self.sweep)

    def moved(self, rot: complex, shift: complex) -> Arc2:
        return Arc2(self.c * rot + shift, self.r, self.a0 + cmath.phase(rot), self.sweep)

    def area_term(self) -> float:
        return 0.5 * (self.r * self.r * self.sweep + cross(self.c, self.end - self.start))

    def sample(self, n: int) -> list[complex]:
        k = max(2, int(math.ceil(abs(self.sweep) / (math.pi / 8))))
        return [self.at(self.length * i / k) for i in range(k + 1)]

    def __repr__(self) -> str:
        return f"Arc2(c={fmt_pt(self.c)}, r={fmt(self.r)}, {deg(self.a0)}°{'+' if self.sweep > 0 else ''}{deg(self.sweep)}°)"


@dataclass(frozen=True, slots=True, eq=False)
class Curve2(Seg):
    """Another curve (spline, ellipse) of a sketch, passed through unchanged. ``edge`` is the
    world edge in the direction of the loop; the other fields are local to the plane."""

    edge: Any
    start_: complex
    end_: complex
    t0_: complex
    t1_: complex
    length_: float
    points: tuple[complex, ...]  # samples along the curve (for areas and crossing checks)

    kind = "curve"

    @property
    def start(self) -> complex:
        return self.start_

    @property
    def end(self) -> complex:
        return self.end_

    @property
    def length(self) -> float:
        return self.length_

    @property
    def t0(self) -> complex:
        return self.t0_

    @property
    def t1(self) -> complex:
        return self.t1_

    def at(self, s: float) -> complex:
        i = min(int(round(s / self.length_ * (len(self.points) - 1))), len(self.points) - 1) if self.length_ else 0
        return self.points[max(i, 0)]

    def reversed(self) -> Curve2:
        return Curve2(self.edge.reversed(), self.end_, self.start_, -self.t1_, -self.t0_, self.length_,
                      tuple(reversed(self.points)))

    def area_term(self) -> float:
        p = self.points
        return 0.5 * sum(cross(a, b) for a, b in zip(p, p[1:]))

    def sample(self, n: int) -> list[complex]:
        return list(self.points)

    def __repr__(self) -> str:
        return f"Curve2({fmt_pt(self.start_)}->{fmt_pt(self.end_)})"


def describe(s: Seg, fp: Callable[[complex], str] = fmt_pt) -> str:
    """The segment in words, for messages (``fp`` formats a point)."""
    if isinstance(s, Line2):
        return f"the line {fp(s.a)} -> {fp(s.b)}"
    if isinstance(s, Arc2):
        return f"the arc of radius {fmt(s.r)} from {fp(s.start)} to {fp(s.end)}"
    return f"the {getattr(s, 'edge', None) and s.edge.geom_type or 'curve'} {fp(s.start)} -> {fp(s.end)}"


# -----------------------------------------------------------------------------
# intersections
# -----------------------------------------------------------------------------
def _line_line(a1: complex, d1: complex, a2: complex, d2: complex) -> list[complex]:
    den = cross(d1, d2)
    if abs(den) < 1e-14:
        return []
    s = cross(a2 - a1, d2) / den
    return [a1 + d1 * s]


def _line_circle(a: complex, d: complex, c: complex, r: float) -> list[complex]:
    # |a + d s - c|^2 = r^2 with |d| = 1
    w = a - c
    b = dot(w, d)
    q = abs(w) ** 2 - r * r
    disc = b * b - q
    if disc < -1e-12 * max(1.0, r * r):
        return []
    if disc <= 1e-12 * max(1.0, r * r):
        return [a - d * b]
    rt = math.sqrt(disc)
    return [a + d * (-b - rt), a + d * (-b + rt)]


def _circle_circle(c1: complex, r1: float, c2: complex, r2: float) -> list[complex]:
    d = abs(c2 - c1)
    if d < 1e-14:
        return []
    if d > r1 + r2 + 1e-12 * max(1.0, r1 + r2) or d < abs(r1 - r2) - 1e-12 * max(1.0, r1 + r2):
        return []
    x = (d * d + r1 * r1 - r2 * r2) / (2.0 * d)
    h2 = r1 * r1 - x * x
    u = (c2 - c1) / d
    base = c1 + u * x
    if h2 <= 1e-12 * max(1.0, r1 * r1):
        return [base]
    h = math.sqrt(h2)
    return [base + 1j * u * h, base - 1j * u * h]


def carrier_intersections(s1: Seg, s2: Seg) -> list[complex]:
    """Points where the carriers (infinite line, full circle) of two segments meet."""
    if isinstance(s1, Line2) and isinstance(s2, Line2):
        return _line_line(s1.a, s1.direction, s2.a, s2.direction)
    if isinstance(s1, Line2) and isinstance(s2, Arc2):
        return _line_circle(s1.a, s1.direction, s2.c, s2.r)
    if isinstance(s1, Arc2) and isinstance(s2, Line2):
        return _line_circle(s2.a, s2.direction, s1.c, s1.r)
    if isinstance(s1, Arc2) and isinstance(s2, Arc2):
        return _circle_circle(s1.c, s1.r, s2.c, s2.r)
    raise GeometryError("only lines and arcs can be intersected exactly")


def foot(s: Seg, p: complex) -> complex:
    """The point of the carrier of ``s`` nearest ``p``."""
    if isinstance(s, Line2):
        return s.a + s.direction * dot(p - s.a, s.direction)
    if isinstance(s, Arc2):
        if p == s.c:
            return s.start
        return s.c + s.r * unit(p - s.c)
    raise GeometryError("only lines and arcs")


def _on(s: Seg, p: complex, tol: float) -> bool:
    pos = s.position(p)
    return -tol <= pos <= s.length + tol and abs(s.at(min(max(pos, 0.0), s.length)) - p) <= tol * 10


def overlap(s1: Seg, s2: Seg, tol: float) -> float:
    """Length of the stretch two segments share (collinear lines or arcs of one circle)."""
    if isinstance(s1, Line2) and isinstance(s2, Line2):
        d = s1.direction
        if abs(cross(d, s2.direction)) > 1e-9:
            return 0.0
        if abs(cross(d, s2.a - s1.a)) > tol:
            return 0.0
        p0, p1 = sorted((s1.position(s2.a), s1.position(s2.b)))
        return max(0.0, min(p1, s1.length) - max(p0, 0.0))
    if isinstance(s1, Arc2) and isinstance(s2, Arc2):
        if abs(s1.c - s2.c) > tol or abs(s1.r - s2.r) > tol:
            return 0.0
        pts = [s2.at(s2.length * i / 16) for i in range(17)]
        inside = sum(1 for p in pts if 0.0 < s1.position(p) < s1.length)
        return s2.length * inside / 17.0 if inside > 1 else 0.0
    return 0.0


def segment_intersections(s1: Seg, s2: Seg, tol: float) -> list[complex]:
    """Points where two segments meet (not counting an overlap; see :func:`overlap`)."""
    if isinstance(s1, Curve2) or isinstance(s2, Curve2):
        return _polyline_intersections(s1.sample(48), s2.sample(48), tol)
    out = []
    for p in carrier_intersections(s1, s2):
        if _on(s1, p, tol) and _on(s2, p, tol):
            out.append(p)
    return out


def _polyline_intersections(pa: list[complex], pb: list[complex], tol: float) -> list[complex]:
    out = []
    for a0, a1 in zip(pa, pa[1:]):
        for b0, b1 in zip(pb, pb[1:]):
            da, db = a1 - a0, b1 - b0
            den = cross(da, db)
            if abs(den) < 1e-15:
                continue
            s = cross(b0 - a0, db) / den
            t = cross(b0 - a0, da) / den
            if -1e-9 <= s <= 1 + 1e-9 and -1e-9 <= t <= 1 + 1e-9:
                out.append(a0 + da * s)
    return out


# -----------------------------------------------------------------------------
# loops: area, simplification, crossings
# -----------------------------------------------------------------------------
def signed_area(loop: Sequence[Seg]) -> float:
    return sum(s.area_term() for s in loop)


def extent(segs: Sequence[Seg]) -> float:
    pts = [p for s in segs for p in (s.start, s.end)] + [s.c for s in segs if isinstance(s, Arc2)]
    if not pts:
        return 1.0
    xs, ys = [p.real for p in pts], [p.imag for p in pts]
    return max(1.0, max(xs) - min(xs), max(ys) - min(ys), max(map(abs, xs)), max(map(abs, ys)))


def tolerance(segs: Sequence[Seg]) -> float:
    return 1e-9 * extent(segs)


def _mergeable(a: Seg, b: Seg, tol: float) -> Seg | None:
    if abs(a.end - b.start) > tol:
        return None
    if isinstance(a, Line2) and isinstance(b, Line2):
        if a.length > 0 and b.length > 0 and abs(cross(a.direction, b.direction)) < 1e-12 and dot(a.direction, b.direction) > 0:
            return Line2(a.a, b.b)
        return None
    if isinstance(a, Arc2) and isinstance(b, Arc2):
        if (abs(a.c - b.c) <= tol and abs(a.r - b.r) <= tol and a.sign == b.sign
                and abs(a.sweep + b.sweep) <= TAU + 1e-12):
            return Arc2(a.c, a.r, a.a0, a.sweep + b.sweep)
    return None


def simplify(segs: list[Seg], labels: list[str], closed: bool, tol: float) -> tuple[list[Seg], list[str]]:
    """Join consecutive collinear lines and consecutive arcs of one circle; drop pieces of
    no length."""
    out: list[Seg] = []
    labs: list[str] = []
    for s, lab in zip(segs, labels):
        if s.length <= tol:
            continue
        m = _mergeable(out[-1], s, tol) if out else None
        if m is not None:
            out[-1] = m
            if lab not in labs[-1]:
                labs[-1] = f"{labs[-1]} + {lab}"
        else:
            out.append(s)
            labs.append(lab)
    if closed and len(out) > 2:
        m = _mergeable(out[-1], out[0], tol)
        if m is not None:
            out[0] = m
            labs[0] = labs[-1] if labs[0] in labs[-1] else f"{labs[-1]} + {labs[0]}"
            out.pop()
            labs.pop()
    return out, labs


def first_crossing(segs: Sequence[Seg], closed: bool, tol: float) -> tuple[int, int, complex] | None:
    """The first pair of segments that cross, touch or double back: ``(i, j, point)``."""
    n = len(segs)
    for i in range(n):
        for j in range(i + 1, n):
            adjacent = j == i + 1 or (closed and i == 0 and j == n - 1 and n > 2)
            ov = overlap(segs[i], segs[j], tol)
            if ov > tol:
                return i, j, segs[j].start if j == i + 1 else segs[i].start
            pts = segment_intersections(segs[i], segs[j], tol)
            if adjacent:
                joint = segs[i].end if j == i + 1 else segs[i].start
                pts = [p for p in pts if abs(p - joint) > max(tol * 1e3, 1e-7 * extent(segs))]
                if n == 2:  # the two segments of a two-segment loop meet at both ends
                    other = segs[i].start
                    pts = [p for p in pts if abs(p - other) > max(tol * 1e3, 1e-7 * extent(segs))]
            if pts:
                return i, j, pts[0]
    return None


# -----------------------------------------------------------------------------
# corners
# -----------------------------------------------------------------------------
def turn(s1: Seg, s2: Seg) -> tuple[float, float]:
    """(sine, cosine) of the turn from the end of ``s1`` to the start of ``s2``."""
    return cross(s1.t1, s2.t0), dot(s1.t1, s2.t0)


def is_smooth(s1: Seg, s2: Seg) -> bool:
    sn, cs = turn(s1, s2)
    return abs(sn) < SMOOTH and cs > 0


def fillet_corner(s1: Seg, s2: Seg, r: float) -> tuple[float, float, Arc2]:
    """Round the corner where ``s1`` ends and ``s2`` starts with a tangent arc of radius ``r``.

    Returns how far the arc cuts back along ``s1`` (from its end), how far along ``s2`` (from
    its start), and the arc. The cut-backs are not checked against the lengths; see
    :func:`assemble`.
    """
    if not (isinstance(s1, (Line2, Arc2)) and isinstance(s2, (Line2, Arc2))):
        raise GeometryError("it joins a curve that is not a line or an arc")
    sn, cs = turn(s1, s2)
    if abs(sn) < SMOOTH:
        raise GeometryError("the segments meet tangentially there, so there is no corner"
                            if cs > 0 else "the outline turns back on itself there")
    side = 1.0 if sn > 0 else -1.0
    o1, o2 = s1.offset(side * r), s2.offset(side * r)
    if o1 is None or o2 is None:
        small = s1 if o1 is None else s2
        raise GeometryError(f"the radius {fmt(r)} is larger than the radius {fmt(small.r)} of {describe(small)}")  # type: ignore[attr-defined]
    v = s1.end
    cands = carrier_intersections(o1, o2)
    if not cands:
        raise GeometryError(f"no arc of radius {fmt(r)} touches both segments")
    c = min(cands, key=lambda z: abs(z - v))
    f1, f2 = foot(s1, c), foot(s2, c)
    back = s1.length - s1.position(f1)
    ahead = s2.position(f2)
    v1, v2 = f1 - c, f2 - c
    delta = cmath.phase(v2 / v1)
    if side > 0 and delta < 0:
        delta += TAU
    if side < 0 and delta > 0:
        delta -= TAU
    return back, ahead, Arc2(c, r, cmath.phase(v1), delta)


def chamfer_corner(s1: Seg, s2: Seg, length: float) -> tuple[float, float, Line2]:
    """Bevel the corner where ``s1`` ends and ``s2`` starts: cut back ``length`` along each
    (measured along the segment) and join the two points with a line."""
    if not (isinstance(s1, (Line2, Arc2)) and isinstance(s2, (Line2, Arc2))):
        raise GeometryError("it joins a curve that is not a line or an arc")
    sn, cs = turn(s1, s2)
    if abs(sn) < SMOOTH:
        raise GeometryError("the segments meet tangentially there, so there is no corner"
                            if cs > 0 else "the outline turns back on itself there")
    p1 = s1.at(s1.length - length)
    p2 = s2.at(length)
    return length, length, Line2(p1, p2)


@dataclass(frozen=True)
class Corner:
    kind: str  # "fillet" or "chamfer"
    size: float
    label: str  # how the user asked for it, for messages


def assemble(segs: Sequence[Seg], labels: Sequence[str], corners: dict[int, Corner], closed: bool,
             tol: float, what: Callable[[int], str] | None = None,
             fp: Callable[[complex], str] = fmt_pt) -> tuple[list[Seg], list[str]]:
    """Apply corner fillets and chamfers. ``corners[i]`` rounds the corner where ``segs[i - 1]``
    ends and ``segs[i]`` starts (``i = 0``: the corner between the last and the first segment
    of a closed loop). ``what(i)`` names segment ``i`` and ``fp`` formats points in messages."""
    n = len(segs)
    name = what or (lambda i: f"segment {i + 1} ({labels[i]})")
    cut_start = [0.0] * n
    cut_end = [0.0] * n
    owner_start: list[Corner | None] = [None] * n
    owner_end: list[Corner | None] = [None] * n
    inserts: dict[int, Seg] = {}
    insert_labels: dict[int, str] = {}
    for i, cn in sorted(corners.items()):
        if not closed and (i <= 0 or i >= n):
            raise GeometryError(f"{cn.label}: the {'start' if i <= 0 else 'end'} of an open path is not a corner")
        s1, s2 = segs[i - 1], segs[i % n]
        smaller = "use a smaller radius" if cn.kind == "fillet" else "use a shorter length"
        try:
            if cn.kind == "fillet":
                back, ahead, piece = fillet_corner(s1, s2, cn.size)
            else:
                back, ahead, piece = chamfer_corner(s1, s2, cn.size)
        except GeometryError as e:
            hint = f"; leave the {cn.kind} out" if "no corner" in str(e) or "turns back" in str(e) else f"; {smaller}"
            raise GeometryError(f"{cn.label} at {fp(s1.end)}: {e}{hint}") from None
        for amount, seg_i, side in ((back, i - 1, "end"), (ahead, i % n, "start")):
            seg = segs[seg_i % n]
            if amount < -tol or amount > seg.length + tol:
                raise GeometryError(f"{cn.label} at {fp(s1.end)} does not fit: it needs {fmt(max(amount, 0.0))} "
                                    f"along {name(seg_i % n)}, which is {fmt(seg.length)} long; {smaller}")
        cut_end[(i - 1) % n] = max(back, 0.0)
        owner_end[(i - 1) % n] = cn
        cut_start[i % n] = max(ahead, 0.0)
        owner_start[i % n] = cn
        inserts[i % n] = piece
        insert_labels[i % n] = f"{cn.label} at {fp(s1.end)}"
    out: list[Seg] = []
    labs: list[str] = []
    for j in range(n):
        seg = segs[j]
        if cut_start[j] + cut_end[j] > seg.length + tol:
            a, b = owner_start[j], owner_end[j]
            raise GeometryError(f"{a.label if a else ''} at {fp(seg.start)} and {b.label if b else ''} at "  # pragma: no branch
                                f"{fp(seg.end)} overlap on {name(j)}: they need {fmt(cut_start[j])} + "
                                f"{fmt(cut_end[j])} of its {fmt(seg.length)}; use smaller corners")
        if j in inserts:
            out.append(inserts[j])
            labs.append(insert_labels[j])
        if cut_start[j] or cut_end[j]:
            if seg.length - cut_start[j] - cut_end[j] > tol:
                if isinstance(seg, Curve2):
                    raise GeometryError(f"cannot shorten {name(j)}: it is not a line or an arc")
                out.append(seg.piece(cut_start[j], seg.length - cut_end[j]))
                labs.append(labels[j])
        else:
            out.append(seg)
            labs.append(labels[j])
    # pieces must chain exactly: snap tiny gaps from the trims
    return out, labs


# -----------------------------------------------------------------------------
# offsets of chains
# -----------------------------------------------------------------------------
def _extend_to(seg: Seg, p: complex, at_end: bool) -> Seg:
    """The segment with its end (or start) moved to ``p``, a point of its carrier."""
    if isinstance(seg, Line2):
        return Line2(seg.a, p) if at_end else Line2(p, seg.b)
    assert isinstance(seg, Arc2)
    pos = seg.position(p)
    return seg.piece(0.0, pos) if at_end else seg.piece(pos, seg.length)


def offset_chain(segs: Sequence[Seg], e: float, corners: str, closed: bool, tol: float) -> list[Seg]:
    """The chain moved ``e`` to the left (negative: to the right), with the gaps at corners
    that open filled (``corners``: "round", "sharp" or "chamfer") and the overlaps at corners
    that close trimmed. Raises :class:`NeedBooleans` when the result does not follow from
    the neighbouring segments alone (a segment that vanishes, an arc that collapses)."""
    n = len(segs)
    moved: list[Seg] = []
    for s in segs:
        if not isinstance(s, (Line2, Arc2)):
            raise GeometryError("only lines and arcs can be offset exactly")
        o = s.offset(e)
        if o is None:
            raise NeedBooleans("an arc collapses")
        moved.append(o)
    ends = [m.end for m in moved]
    starts = [m.start for m in moved]
    joins: dict[int, list[Seg]] = {}
    pairs = range(n) if closed else range(1, n)
    for i in pairs:
        s1, s2 = segs[i - 1], segs[i]
        m1, m2 = moved[i - 1], moved[i]
        sn, cs = turn(s1, s2)
        if abs(sn) < SMOOTH and cs > 0:
            continue  # smooth: the offsets meet
        if abs(sn) < SMOOTH:
            raise NeedBooleans("the chain turns back")
        opening = sn * e < 0  # the offset side is the outside of the turn
        if opening:
            v = s1.end
            p, q = m1.end, m2.start
            if corners == "round":
                d1, d2 = p - v, q - v
                sweep = cmath.phase(d2 / d1)
                if sn > 0 and sweep < 0:
                    sweep += TAU
                if sn < 0 and sweep > 0:
                    sweep -= TAU
                joins[i] = [Arc2(v, abs(e), cmath.phase(d1), sweep)]
            elif corners == "chamfer":
                joins[i] = [Line2(p, q)]
            else:  # sharp: extend the tangents to their intersection
                hits = _line_line(p, m1.t1, q, m2.t0)
                if not hits:
                    raise NeedBooleans("parallel tangents")
                mpt = hits[0]
                if isinstance(m1, Line2):
                    m1 = Line2(m1.a, mpt)
                    first: list[Seg] = []
                else:
                    first = [Line2(p, mpt)]
                if isinstance(m2, Line2):
                    m2 = Line2(mpt, m2.b)
                    second: list[Seg] = []
                else:
                    second = [Line2(mpt, q)]
                moved[i - 1], moved[i] = m1, m2
                joins[i] = first + second
        else:
            # the offsets overlap: trim both at their intersection nearest the corner
            cands = carrier_intersections(m1, m2)
            v = s1.end
            good = [c for c in cands if m1.position(c) > -tol and m2.position(c) < m2.length + tol
                    and m1.position(c) <= m1.length + tol and m2.position(c) >= -tol]
            if not good:
                raise NeedBooleans("the offsets do not meet near the corner")
            c = min(good, key=lambda z: abs(z - v))
            moved[i - 1] = _extend_to(m1, c, True)
            moved[i] = _extend_to(m2, c, False)
    out: list[Seg] = []
    for i in range(n):
        if i in joins:
            out.extend(joins[i])
        m = moved[i]
        # a trimmed piece must keep its direction and length
        if isinstance(m, Line2):
            orig = segs[i]
            if m.length <= tol or dot(m.b - m.a, orig.t0 if isinstance(orig, Line2) else m.b - m.a) <= 0:
                raise NeedBooleans("a segment vanishes")
        elif isinstance(m, Arc2):
            if abs(m.sweep) <= 1e-12 or (m.sweep > 0) != (segs[i].sweep > 0):  # type: ignore[attr-defined]
                raise NeedBooleans("an arc vanishes")
        out.append(m)
    del ends, starts
    return out


# -----------------------------------------------------------------------------
# pieces for the Boolean constructions
# -----------------------------------------------------------------------------
Piece = tuple[list[Seg], list[list[Seg]]]  # a region: outer loop (counterclockwise) and holes


def sweep_piece(s: Seg, e: float) -> list[Piece]:
    """The region a segment covers when it moves ``e`` to its left (negative: right). An arc
    that would pass its center stops there (a pie slice); a full circle gives a ring."""
    if isinstance(s, Line2):
        m = s.offset(e)
        return [(orient_ccw([s, Line2(s.b, m.b), m.reversed(), Line2(m.a, s.a)]), [])]
    if not isinstance(s, Arc2):
        raise GeometryError("only lines and arcs")
    m = s.offset(e)
    if s.closed:
        if m is None:
            return [(disk(s.c, s.r), [])]
        lo, hi = sorted((s.r, m.r))
        return [([Arc2(s.c, hi, 0.0, TAU)], [[Arc2(s.c, lo, 0.0, -TAU)]])]
    if m is None:
        return [(orient_ccw([s, Line2(s.end, s.c), Line2(s.c, s.start)]), [])]
    return [(orient_ccw([s, Line2(s.end, m.end), m.reversed(), Line2(m.start, s.start)]), [])]


def band_piece(s: Seg, half: float) -> list[Piece]:
    """The region within ``half`` of a segment on both sides, ends cut square."""
    if isinstance(s, Line2):
        lo, hi = s.offset(-half), s.offset(half)
        return [(orient_ccw([lo, Line2(lo.b, hi.b), hi.reversed(), Line2(hi.a, lo.a)]), [])]
    assert isinstance(s, Arc2)
    outer = Arc2(s.c, s.r + half, s.a0, s.sweep)
    if s.r - half > 1e-12 * max(1.0, s.r):
        inner = Arc2(s.c, s.r - half, s.a0, s.sweep)
        return [(orient_ccw([inner, Line2(inner.end, outer.end), outer.reversed(), Line2(outer.start, inner.start)]), [])]
    return [(orient_ccw([Line2(s.c, outer.start), outer, Line2(outer.end, s.c)]), [])]


def disk(c: complex, r: float) -> list[Seg]:
    return [Arc2(c, r, 0.0, TAU)]


def polygon(*pts: complex) -> list[Seg]:
    return orient_ccw([Line2(a, b) for a, b in zip(pts, pts[1:] + pts[:1]) if abs(b - a) > 0])


def corner_piece(s1: Seg, s2: Seg, e: float, corners: str) -> list[Piece]:
    """The gap between the offsets of two segments at a corner that the offset ``e`` (to the
    left) pulls apart; nothing where the corner does not open on that side. The piece
    shares its straight sides with the pieces of the two segments, so the Booleans meet
    edges, not tangencies."""
    sn, cs = turn(s1, s2)
    if abs(sn) < SMOOTH and cs > 0:
        return []
    if sn * e >= 0 and abs(sn) >= SMOOTH:
        return []
    v = s1.end
    p, q = s1.offset(e), s2.offset(e)
    if p is None or q is None or abs(sn) < SMOOTH:
        return [(disk(v, abs(e)), [])]
    pe, qs = p.end, q.start
    if corners == "chamfer":
        return [(polygon(v, pe, qs), [])]
    if corners == "sharp":
        hits = _line_line(pe, s1.t1, qs, s2.t0)
        if hits:
            return [(polygon(v, pe, hits[0], qs), [])]
        return [(disk(v, abs(e)), [])]
    d1, d2 = pe - v, qs - v
    sweep = cmath.phase(d2 / d1)
    if sn > 0 and sweep < 0:
        sweep += TAU
    if sn < 0 and sweep > 0:
        sweep -= TAU
    return [(orient_ccw([Line2(v, pe), Arc2(v, abs(e), cmath.phase(d1), sweep), Line2(qs, v)]), [])]


def distance(s: Seg, p: complex) -> float:
    """Distance from a point to a line or arc segment."""
    if isinstance(s, Line2):
        pos = s.position(p)
        return abs(p - s.at(min(max(pos, 0.0), s.length)))
    if isinstance(s, Arc2):
        if p != s.c and 0.0 <= s.position(p) <= s.length:
            return abs(abs(p - s.c) - s.r)
        return min(abs(p - s.start), abs(p - s.end))
    return min(abs(p - q) for q in s.sample(64))


def orient_ccw(loop: list[Seg]) -> list[Seg]:
    if signed_area(loop) < 0:
        return [s.reversed() for s in reversed(loop)]
    return loop


# -----------------------------------------------------------------------------
# convex hull of points and circular arcs
# -----------------------------------------------------------------------------
@dataclass(frozen=True)
class _Site:
    c: complex
    r: float  # 0 for a point
    lo: float = 0.0  # directions (outward normals) for which an arc site supports the hull:
    span: float = TAU  # lo .. lo + span (counterclockwise)

    def covers(self, phi: float) -> bool:
        return self.r == 0.0 or self.span >= TAU - 1e-12 or (phi - self.lo) % TAU <= self.span + 1e-12

    def support(self, phi: float) -> float:
        return dot(self.c, cis(phi)) + self.r

    def point(self, phi: float) -> complex:
        return self.c + self.r * cis(phi)


def hull_sites(segs: Sequence[Seg]) -> list[_Site]:
    sites: list[_Site] = []
    for s in segs:
        if isinstance(s, Line2):
            sites += [_Site(s.a, 0.0), _Site(s.b, 0.0)]
        elif isinstance(s, Arc2):
            ccw = s if s.sweep > 0 else s.reversed()
            if not s.closed:  # the seam point of a full circle adds nothing
                sites += [_Site(s.start, 0.0), _Site(s.end, 0.0)]
            sites.append(_Site(s.c, s.r, ccw.a0 % TAU, min(abs(s.sweep), TAU)))
        else:
            raise GeometryError("hull works on points, lines and circular arcs; a curve that is neither "
                                f"was given ({describe(s)})")
    return sites


def _transition(a: _Site, b: _Site, phi: float) -> float | None:
    """The first direction after ``phi`` (less than a turn later) at which site ``b`` takes over
    the support of the hull from site ``a``, going counterclockwise; None if it never does."""
    d = b.c - a.c
    dist = abs(d)
    if dist < 1e-14:
        return None
    ratio = (a.r - b.r) / dist
    if ratio >= 1.0 - 1e-12:
        return None  # b lies inside a (or touches it from inside): it never rises above a
    if ratio < -1.0 - 1e-9:
        return None  # b contains a: it takes over where its span starts, through its end point
    t = cmath.phase(d) - math.acos(max(-1.0, min(1.0, ratio)))
    delta = (t - phi) % TAU
    if delta < 1e-12:
        delta = TAU
    return phi + delta


#: The direction the hull walk starts from: a generic one, so that no two sites tie there.
_HULL_START = -math.pi / 2 + 0.3183098861837907


def convex_hull(sites: list[_Site], tol: float) -> list[Seg]:
    """The boundary of the convex hull of points and arcs, counterclockwise, as lines and arcs.

    The walk follows the outward normal direction once around: on an arc site the boundary
    runs along the arc, and where another site takes over the support the boundary jumps to it
    along their common tangent line.
    """
    n = len(sites)
    if n == 0:
        raise GeometryError("nothing to hull")

    def best(phi: float) -> int:
        vals = [s.support(phi) if s.covers(phi % TAU) else -math.inf for s in sites]
        top = max(vals)
        cands = [i for i in range(n) if vals[i] >= top - tol]
        return max(cands, key=lambda i: (sites[i].r, -i))

    phi = _HULL_START
    stop = phi + TAU
    cur = best(phi)
    walk: list[tuple[int, float, float]] = []  # (site, from direction, to direction)
    for _ in range(4 * n + 8):
        s = sites[cur]
        at = stop
        if s.r > 0 and s.span < TAU - 1e-12:
            at = min(at, phi + ((s.lo + s.span - phi) % TAU))
        nxt = None
        for j, other in enumerate(sites):
            if j == cur:
                continue
            t = _transition(s, other, phi)
            if t is None or t > at + 1e-12 or not other.covers(t % TAU):
                continue
            if (nxt is None or t < at - 1e-12
                    or abs(other.point(t) - s.point(t)) > abs(sites[nxt].point(t) - s.point(t))):
                nxt, at = j, min(t, stop)
        walk.append((cur, phi, at))
        if at >= stop - 1e-12:
            break
        if nxt is None:  # the arc's span ends; its end point (or another site) goes on
            nxt = best(at + 1e-9)
        cur, phi = nxt, at
    out: list[Seg] = []
    for k, (i, a, b) in enumerate(walk):
        s = sites[i]
        if s.r > 0 and b - a > 1e-12:
            out.append(Arc2(s.c, s.r, a, b - a))
        j = walk[(k + 1) % len(walk)][0]
        p, q = s.point(b), sites[j].point(b)
        if abs(q - p) > tol:
            out.append(Line2(p, q))
    out, _ = simplify(out, [""] * len(out), True, tol)
    closed_circle = len(out) == 1 and isinstance(out[0], Arc2) and out[0].closed
    if not closed_circle and (len(out) < 3 and not any(isinstance(s, Arc2) for s in out)
                              or abs(signed_area(out)) <= tol * extent(out)):
        raise GeometryError("the hull has no area: all the points lie on one line")
    return out
