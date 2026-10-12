"""The pen: draw an outline segment by segment.

A :class:`Profile` draws one outline in the XY plane with lines and arcs, moving like a pen:
to a point, by an offset, forward along its heading, with tangent arcs, and with the corners
it passes rounded or beveled. ``close()`` turns the outline into a :class:`~smlibpy.Sketch`,
``wire()`` gives the open path as a :class:`~smlibpy.Wire`. Every call returns a new
Profile, so one drawing can branch into variants.
"""

from __future__ import annotations

import cmath
import math
from typing import Any

from ._kernel import ModelingError
from ._planar import (TAU, Arc2, Corner, GeometryError, Line2, Seg, assemble, cis, cross, dot, extent, first_crossing,
                      fmt, fmt_pt, reflect, signed_area, simplify, unit)
from .align import AlignLike, alignment_offset
from .geometry import Axis, Plane, Vector, VectorLike, _vec
from .shapes import Sketch, Wire

__all__ = ["Profile"]


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _pt2(v: Any, what: str) -> complex:
    p = _vec(v)
    if abs(p.z) > 1e-9 * max(1.0, abs(p.x), abs(p.y)):
        raise ValueError(f"{what}: the pen draws in the XY plane, so the point needs z = 0 (got z = {fmt(p.z)}); "
                         f"place the finished sketch with .on(plane)")
    return complex(p.x, p.y)


def _norm_deg(a: float) -> float:
    d = math.degrees(a) % 360.0
    if d > 180.0 + 1e-12:
        d -= 360.0
    return 0.0 if abs(d) < 1e-12 else d


class Profile:
    """A pen that draws an outline in the XY plane, segment by segment.

    Start it at a point with a heading (degrees counterclockwise from +X), then move::

        section = (Profile((0, 0))
                   .line_to(12, 0).line_to(y=4).fillet(1.5)
                   .line_to(x=6).line_to(y=20).chamfer(1)
                   .line_to(x=0)
                   .close())                  # a Sketch: extrude or revolve it

    Moves: ``line_to`` (to a point, or to an x or y), ``line_by`` (by an offset),
    ``forward`` (along the heading, or until x or y reaches a value), ``arc`` (tangent, by
    radius and angle; a positive angle turns left), ``arc_to`` (tangent to an end point, or
    through a point). ``turn``/``turn_to`` change the heading without drawing. ``fillet``
    and ``chamfer`` round or bevel the corner at the pen, between the segment before and
    the segment after. ``mirror(axis)`` adds the mirror image of the path drawn so far.
    ``close()`` makes the region, ``wire()`` the open path.

    Each call returns a new Profile; ``point`` and ``heading`` tell where the pen is.
    Errors name the segment (the call that drew it) and the numbers that do not fit.
    """

    __slots__ = ("_start", "_segs", "_labels", "_corners", "_heading")

    def __init__(self, start: VectorLike = (0, 0), *, heading: float = 0.0):
        self._start = _pt2(start, "Profile")
        self._segs: tuple[Seg, ...] = ()
        self._labels: tuple[str, ...] = ()
        self._corners: tuple[tuple[int, Corner], ...] = ()
        self._heading = math.radians(float(heading))

    # -- state ----------------------------------------------------------------
    def _new(self, segs: tuple[Seg, ...] | None = None, labels: tuple[str, ...] | None = None,
             corners: tuple[tuple[int, Corner], ...] | None = None, heading: float | None = None) -> Profile:
        p = Profile.__new__(Profile)
        p._start = self._start
        p._segs = self._segs if segs is None else segs
        p._labels = self._labels if labels is None else labels
        p._corners = self._corners if corners is None else corners
        p._heading = self._heading if heading is None else heading
        return p

    @property
    def _cur(self) -> complex:
        return self._segs[-1].end if self._segs else self._start

    @property
    def point(self) -> Vector:
        """Where the pen is."""
        c = self._cur
        return Vector(c.real, c.imag, 0.0)

    @property
    def start(self) -> Vector:
        """Where the drawing started."""
        return Vector(self._start.real, self._start.imag, 0.0)

    @property
    def heading(self) -> float:
        """The direction the pen moves in, degrees counterclockwise from +X (-180 to 180)."""
        return _norm_deg(self._heading)

    def __len__(self) -> int:
        return len(self._segs)

    def _scale(self, *pts: complex) -> float:
        return max(1.0, abs(self._start), abs(self._cur), *(abs(p) for p in pts))

    def _add(self, seg: Seg, call: str) -> Profile:
        if seg.length <= 1e-12 * self._scale(seg.start, seg.end):
            raise ValueError(f"{call}: the segment has no length (the pen is already at {fmt_pt(self._cur)})")
        label = f"segment {len(self._segs) + 1}, {call}"
        return self._new(segs=self._segs + (seg,), labels=self._labels + (label,), heading=cmath.phase(seg.t1))

    # -- lines ------------------------------------------------------------------
    def line_to(self, x: float | VectorLike | None = None, y: float | None = None) -> Profile:
        """A straight line to a point: ``line_to(30, 5)`` or ``line_to((30, 5))``; or to a
        coordinate, keeping the other one: ``line_to(x=30)`` (horizontal), ``line_to(y=5)``
        (vertical)."""
        cur = self._cur
        if x is not None and y is None and not _num(x):
            target = _pt2(x, "line_to")
            call = f"line_to({fmt(target.real)}, {fmt(target.imag)})"
        else:
            if x is None and y is None:
                raise TypeError("line_to: give a point, line_to(x, y), or one coordinate, line_to(x=...) or line_to(y=...)")
            target = complex(cur.real if x is None else float(x), cur.imag if y is None else float(y))  # type: ignore[arg-type]
            call = ("line_to(" + ", ".join(f"{n}={fmt(v)}" for n, v in (("x", x), ("y", y)) if v is not None) + ")"
                    if x is None or y is None else f"line_to({fmt(float(x))}, {fmt(float(y))})")  # type: ignore[arg-type]
        return self._add(Line2(cur, target), call)

    def line_by(self, dx: float | VectorLike = 0.0, dy: float = 0.0) -> Profile:
        """A straight line by an offset from the pen: ``line_by(10, -5)`` or ``line_by((10, -5))``."""
        d = _pt2(dx, "line_by") if not _num(dx) else complex(float(dx), float(dy))  # type: ignore[arg-type]
        return self._add(Line2(self._cur, self._cur + d), f"line_by({fmt(d.real)}, {fmt(d.imag)})")

    def forward(self, length: float | None = None, *, x: float | None = None, y: float | None = None) -> Profile:
        """A straight line along the heading: ``length`` long, or until x reaches ``x`` (or y
        reaches ``y``)."""
        given = [v is not None for v in (length, x, y)]
        if sum(given) != 1:
            raise TypeError("forward: give exactly one of length, x= or y=")
        cur, t = self._cur, cis(self._heading)
        h = fmt(self.heading)
        if length is not None:
            if not length > 0:
                raise ValueError(f"forward: the length must be positive (got {fmt(length)}); turn(180) to go back")
            return self._add(Line2(cur, cur + t * float(length)), f"forward({fmt(length)})")
        name, value, comp, now = ("x", x, t.real, cur.real) if x is not None else ("y", y, t.imag, cur.imag)
        call = f"forward({name}={fmt(value)})"  # type: ignore[arg-type]
        if abs(comp) < 1e-12:
            raise ModelingError(f"{call}: the heading {h} degrees runs parallel to the {'Y' if name == 'x' else 'X'} "
                                f"axis, so {name} never changes; turn first, or use line_to({name}=...)")
        s = (float(value) - now) / comp  # type: ignore[arg-type]
        if s <= 1e-12 * self._scale():
            raise ModelingError(f"{call}: {name} = {fmt(value)} lies behind the pen (it is at {name} = {fmt(now)}, "  # type: ignore[arg-type]
                                f"heading {h} degrees); turn first, or use line_to")
        return self._add(Line2(cur, cur + t * s), call)

    def turn(self, angle: float) -> Profile:
        """Turn the heading by ``angle`` degrees (positive: left) without drawing; the next
        segment starts at a corner."""
        return self._new(heading=self._heading + math.radians(float(angle)))

    def turn_to(self, heading: float) -> Profile:
        """Set the heading (degrees counterclockwise from +X) without drawing."""
        return self._new(heading=math.radians(float(heading)))

    # -- arcs -------------------------------------------------------------------
    def arc(self, radius: float, angle: float) -> Profile:
        """A tangent arc of ``radius`` that turns the heading by ``angle`` degrees: positive
        turns left (counterclockwise), negative right. ``arc(5, 180)`` is a U-turn."""
        call = f"arc({fmt(radius)}, {fmt(angle)})"
        if not radius > 0:
            raise ValueError(f"{call}: the radius must be positive; the sign of the angle sets the direction")
        if angle == 0 or abs(angle) > 360:
            raise ValueError(f"{call}: the angle must be between -360 and 360 and not 0")
        cur, t = self._cur, cis(self._heading)
        side = 1.0 if angle > 0 else -1.0
        c = cur + 1j * t * side * float(radius)
        return self._add(Arc2(c, float(radius), cmath.phase(cur - c), math.radians(float(angle))), call)

    def arc_to(self, x: float | VectorLike, y: float | None = None, *, through: VectorLike | None = None) -> Profile:
        """An arc to an end point: tangent to the heading (``arc_to(20, 10)``), or through a
        point (``arc_to(20, 10, through=(15, 12))``, which need not be tangent)."""
        end = _pt2(x, "arc_to") if y is None and not _num(x) else complex(float(x), float(y))  # type: ignore[arg-type]
        cur = self._cur
        if through is None:
            call = f"arc_to({fmt(end.real)}, {fmt(end.imag)})"
            d = end - cur
            if abs(d) <= 1e-12 * self._scale(end):
                raise ValueError(f"{call}: the end point is where the pen is")
            t = cis(self._heading)
            cr = cross(t, d)
            h = fmt(self.heading)
            if abs(cr) <= 1e-12 * abs(d):
                if dot(t, d) > 0:
                    raise ModelingError(f"{call}: the point lies straight ahead on the heading {h} degrees, so the "
                                        f"tangent arc would be a straight line; use line_to, or arc_to(..., through=...)")
                raise ModelingError(f"{call}: the point lies straight behind the pen (heading {h} degrees); no arc that "
                                    f"leaves along the heading reaches it. turn first, or give through=")
            s = abs(d) ** 2 / (2.0 * cr)  # signed distance from the pen to the center, to the left
            c = cur + 1j * t * s
            side = 1.0 if s > 0 else -1.0
        else:
            m = _pt2(through, "arc_to")
            call = f"arc_to({fmt(end.real)}, {fmt(end.imag)}, through=({fmt(m.real)}, {fmt(m.imag)}))"
            den = 2.0 * cross(m - cur, end - cur)
            if abs(den) <= 1e-12 * max(1.0, abs(m - cur) * abs(end - cur)):
                raise ModelingError(f"{call}: the pen, the through point and the end lie on one line (or two of them "
                                    f"coincide), so there is no arc; use line_to")
            ab, ac = abs(m - cur) ** 2, abs(end - cur) ** 2
            c = cur + complex((end - cur).imag * ab - (m - cur).imag * ac,
                              (m - cur).real * ac - (end - cur).real * ab) / den
            side = 1.0 if cross(m - cur, end - m) > 0 else -1.0
        a0 = cmath.phase(cur - c)
        delta = cmath.phase((end - c) / (cur - c))
        if side > 0 and delta <= 0:
            delta += TAU
        if side < 0 and delta >= 0:
            delta -= TAU
        return self._add(Arc2(c, abs(cur - c), a0, delta), call)

    # -- corners ----------------------------------------------------------------
    def _corner(self, c: Corner) -> Profile:
        k = len(self._segs)
        for i, other in self._corners:
            if i == k:
                raise ValueError(f"{c.label}: the corner at {fmt_pt(self._cur)} already has {other.label}")
        return self._new(corners=self._corners + ((k, c),))

    def fillet(self, radius: float) -> Profile:
        """Round the corner at the pen with a tangent arc of ``radius``: the corner between the
        segment just drawn and the next one (at the start point: between the closing segment
        and the first one)."""
        if not radius > 0:
            raise ValueError(f"fillet({fmt(radius)}): the radius must be positive")
        return self._corner(Corner("fillet", float(radius), f"fillet({fmt(radius)})"))

    def chamfer(self, length: float) -> Profile:
        """Bevel the corner at the pen: cut back ``length`` along the segment before and the
        segment after (measured along them) and join the two points with a line."""
        if not length > 0:
            raise ValueError(f"chamfer({fmt(length)}): the length must be positive")
        return self._corner(Corner("chamfer", float(length), f"chamfer({fmt(length)})"))

    # -- symmetry -----------------------------------------------------------------
    def mirror(self, axis: Axis) -> Profile:
        """Continue with the mirror image of the path drawn so far, so that the whole outline
        is symmetric about ``axis`` (an axis in the XY plane: ``X``, ``Y`` or
        ``Axis((x, y), direction)``). Draw half the outline from the axis back to the axis;
        an end that is off the axis is joined straight across to its mirror image. Corners
        rounded on the half are rounded on the mirrored half too."""
        if not isinstance(axis, Axis):
            raise TypeError(f"mirror: give the mirror axis as an Axis, e.g. mirror(Y) or mirror(Axis((0, 5), (1, 0))), "
                            f"not a {type(axis).__name__}")
        d, o = axis.direction, axis.origin
        if abs(d.z) > 1e-9 or abs(o.z) > 1e-9:
            raise ValueError("mirror: the axis must lie in the XY plane")
        if not self._segs:
            raise ValueError("mirror: nothing is drawn yet; draw half of the outline first")
        u = unit(complex(d.x, d.y))
        oc = complex(o.x, o.y)
        u2 = u * u
        cur = self._cur
        scale = 1e-9 * extent(self._segs)
        if abs(cur - self._start) <= scale:
            raise ModelingError("mirror: the outline is already closed; mirror draws the other half of an open half "
                                "outline")

        def on_axis(p: complex) -> bool:
            return abs(cross(u, p - oc)) <= max(scale, 1e-9)

        for seg, which in ((self._segs[-1], "last"), (self._segs[0], "first")):
            if isinstance(seg, Line2) and on_axis(seg.a) and on_axis(seg.b):
                raise ModelingError(f"mirror: the {which} segment runs along the mirror axis; draw the half outline "
                                    f"from where it meets the axis to where it meets it again")
        segs, labels = list(self._segs), list(self._labels)
        n = len(segs)
        new_segs: list[Seg] = []
        new_labels: list[str] = []
        joined = not on_axis(cur)
        if joined:
            new_segs.append(Line2(cur, reflect(cur, oc, u2)))
            new_labels.append(f"segment {n + 1}, the line across the mirror axis from {fmt_pt(cur)}")
        for seg, lab in zip(reversed(segs), reversed(labels)):
            new_segs.append(seg.reflected(oc, u2).reversed())
            new_labels.append(f"segment {n + len(new_segs)}, the mirror image of {lab.split(', ', 1)[-1]}")
        j = 1 if joined else 0
        corners = list(self._corners)
        for k, c in self._corners:
            mk = 2 * n + j - k
            if mk == k or (k == 0 and on_axis(self._start)):
                continue
            corners.append((mk, c))
        return self._new(segs=tuple(segs + new_segs), labels=tuple(labels + new_labels), corners=tuple(corners),
                         heading=cmath.phase(new_segs[-1].t1))

    # -- results ------------------------------------------------------------------
    def _resolve(self, closed: bool) -> list[Seg]:
        segs, labels = list(self._segs), list(self._labels)
        if not segs:
            raise ValueError(f"{'close' if closed else 'wire'}: nothing is drawn yet")
        tol = 1e-9 * extent(segs + [Line2(self._start, self._start)])
        corner_map: dict[int, Corner] = {}
        n = len(segs)
        if closed:
            if abs(self._cur - self._start) > max(tol * 1e3, 1e-9):
                segs.append(Line2(self._cur, self._start))
                labels.append(f"segment {n + 1}, the closing line to {fmt_pt(self._start)}")
            elif isinstance(segs[-1], Line2):
                segs[-1] = Line2(segs[-1].a, self._start)  # snap the last point onto the start
            total = len(segs)
            for k, c in self._corners:
                idx = k % total
                if idx in corner_map:
                    raise ValueError(f"{c.label} and {corner_map[idx].label} are both at the start corner "
                                     f"{fmt_pt(self._start)}; keep one")
                corner_map[idx] = c
            if total == 1 and not (isinstance(segs[0], Arc2) and segs[0].closed):
                raise ModelingError("close: a single segment encloses no area")
        else:
            for k, c in self._corners:
                if k == 0 or k == n:
                    raise ModelingError(f"{c.label} at {fmt_pt(self._start if k == 0 else self._cur)}: the "
                                        f"{'start' if k == 0 else 'end'} of an open path is not a corner; "
                                        f"close() the outline, or leave it out")
                corner_map[k] = c
        try:
            out, labs = assemble(segs, labels, corner_map, closed, tol, what=lambda i: labels[i])
        except GeometryError as e:
            raise ModelingError(f"Profile: {e}") from None
        out, labs = simplify(out, labs, closed, tol)
        if closed:
            hit = first_crossing(out, True, tol)
            if hit is not None:
                i, j, p = hit
                raise ModelingError(f"Profile: the outline crosses or touches itself at {fmt_pt(p)}: {labs[i]} meets "
                                    f"{labs[j]}; change the moves so that the outline does not cross itself")
            area = signed_area(out)
            if abs(area) <= tol * extent(out):
                raise ModelingError("Profile: the outline encloses no area")
            if area < 0:
                out = [s.reversed() for s in reversed(out)]
        return out

    def close(self, *, align: AlignLike = None) -> Sketch:
        """The region inside the outline, as a Sketch on XY: a straight line goes back to the
        start if the pen is not there. ``align`` moves the result (``None`` leaves the
        outline where it was drawn)."""
        from ._regions import Frame, build

        loop = self._resolve(True)
        s = build([(loop, [])], Frame(Plane.XY), name="Profile")
        if align is not None:
            off = alignment_offset(s.bbox(), align, dims=2)
            if off.length:
                s = s.translate(off)
        return s

    def wire(self) -> Wire:
        """The path as drawn, as an open Wire of exact lines and arcs (a sweep path, or a
        centerline for Stroke)."""
        from ._regions import Frame, edges_of

        return Wire._raw(edges_of(self._resolve(False), Frame(Plane.XY)))

    def __repr__(self) -> str:
        c = self._cur
        return f"Profile({len(self._segs)} segments, at ({fmt(c.real)}, {fmt(c.imag)}), heading {fmt(self.heading)})"

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)
        raise AttributeError(f"'Profile' object has no attribute {name!r}: a Profile is a drawing in progress. Call "
                             f".close() for the region (a Sketch) or .wire() for the open path, and use .{name} on that")
