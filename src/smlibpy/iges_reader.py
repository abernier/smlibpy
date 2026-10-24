"""IGES (5.3, ASCII) reader: parse the file and interpret its surfaces and solids.

The result is the neutral description of bodies that ``smlibpy.step_reader`` gives for STEP
(vertices, edges with curves, faces with surfaces, shells; millimetres, world coordinates),
which ``smlibpy.iges_import`` turns into kernel topology with the STEP importer's builder.

Read: manifold solid B-rep objects (186, with their shells, faces, loops, edge and vertex
lists, 514 to 502), trimmed surfaces (144, with their curves on surfaces, 142: the model-space
curve, or the curve in the parameters of a B-spline surface where the file gives only that), bounded
surfaces (143, 141), bounded planes (108) and untrimmed B-spline surfaces (128, 114). Their
geometry: lines (110), circular arcs (100), conic arcs (104), composite curves (102), linear
paths (106), parametric splines (112) and rational B-spline curves (126); planes (108, 190),
cylinders, cones, spheres and tori (192 to 198), rational B-spline surfaces (128), parametric
spline surfaces (114), ruled surfaces (118), surfaces of revolution (120), tabulated cylinders
(122) and offset surfaces (140); each in its transformation matrix (124). Names come from the name property
(406, form 15) or the entity label, colors from the color number or definition (314).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ._kernel import ext, k, kernel_call
from .step_reader import _BODY_ERRORS, BodyData, _offset_curve

__all__ = ["parse", "IgesFile", "Entity", "IgesModel", "interpret"]


# =============================================================================
# Parsing
# =============================================================================
@dataclass
class Entity:
    """One entity: its directory entry and its parameters (pointers are DE numbers)."""

    type: int
    form: int
    de: int  # the sequence number of its first directory line: what pointers to it hold
    params: list[Any] = field(default_factory=list)
    transform: int = 0  # DE of its transformation matrix (124), 0: none
    color: int = 0  # a color number (1 to 8), or minus the DE of a color definition (314)
    status: str = "00000000"  # blank status, subordinate switch, entity use flag, hierarchy (2 digits each)
    label: str = ""

    @property
    def subordinate(self) -> int:
        """0 independent, 1 physically dependent, 2 logically dependent, 3 both."""
        return _int(self.status[2:4])

    @property
    def use(self) -> int:
        """0 geometry, 1 annotation, 2 definition, 3 other, 4 logical, 5 2D parametric, 6 construction."""
        return _int(self.status[4:6])


@dataclass
class IgesFile:
    """The sections of an IGES file: the start text, the global parameters (G1 to G26 by their
    number) and the entities by DE number."""

    start: str
    globals: dict[int, Any]
    entities: dict[int, Entity]


def _whole(x: Any) -> bool:
    """Whether a parameter is a whole number (a pointer, a count, a flag)."""
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and float(x).is_integer()


def _int(s: str, default: int = 0) -> int:
    s = s.strip()
    if not s:
        return default
    try:
        return int(s)
    except ValueError:
        try:
            return int(float(s.replace("D", "E").replace("d", "e")))
        except ValueError:
            return default


_INTEGER = re.compile(r"[+-]?\d+")


def _number(tok: str) -> Any:
    tok = tok.strip()
    if not tok:
        return None
    if _INTEGER.fullmatch(tok):
        return int(tok)
    try:
        return float(tok.replace("D", "E").replace("d", "e"))
    except ValueError:
        raise ValueError(f"IGES: {tok!r} is not a number") from None


_HOLLERITH = re.compile(r" *(\d+)[Hh]")


def _fields(text: str, delim: str, end: str) -> list[Any]:
    """The values of free-format parameter text up to its record delimiter: numbers (int or
    float), strings (Hollerith, ``nH...``) and None for empty fields."""
    out: list[Any] = []
    i, n = 0, len(text)
    while i < n:
        m = _HOLLERITH.match(text, i)
        if m:
            start = m.end()
            out.append(text[start:start + int(m.group(1))])
            i = start + int(m.group(1))
            while i < n and text[i] == " ":
                i += 1
            if i >= n or text[i] == end:
                return out
            i += 1  # the delimiter
            continue
        j = i
        while j < n and text[j] != delim and text[j] != end:
            j += 1
        out.append(_number(text[i:j]))
        if j >= n or text[j] == end:
            return out
        i = j + 1
    return out


_SECTION = re.compile(r"([SGDPTCsgdptc]) *\d+ *$")


def _lines(text: str) -> dict[str, list[str]]:
    """The lines of each section (S, G, D, P, T), 80 columns each."""
    sections: dict[str, list[str]] = {"S": [], "G": [], "D": [], "P": [], "T": []}
    for number, raw in enumerate(re.split(r"\r\n|\r|\n", text), 1):
        line = raw.rstrip("\x1a")
        if not line.strip():
            continue
        if len(line) >= 73 and line[72].upper() in "SGDPTCB":
            letter = line[72].upper()
        else:
            # (a writer that does not pad its lines: the section letter and number end the line)
            m = _SECTION.search(line)
            if not m:
                raise ValueError(f"not an IGES file (line {number} has no section letter in column 73)")
            letter = m.group(1).upper()
            line = line[:m.start()].ljust(72) + letter + line[m.start() + 1:].strip().rjust(7)
        if letter in "BC":
            raise ValueError("IGES: this is a binary or compressed IGES file, which is not read; save it as ASCII IGES")
        sections[letter].append(line.ljust(80))
    if not sections["D"] or not sections["G"]:
        raise ValueError("not an IGES file (it has no global or directory section)")
    return sections


def _globals(text: str) -> dict[int, Any]:
    """The global parameters by number (G1 the parameter, G2 the record delimiter)."""
    delim, end = ",", ";"
    vals: list[Any] = []
    i = 0
    for which in range(2):  # G1, G2: empty (the default) or 1Hc
        m = _HOLLERITH.match(text, i)
        if m and int(m.group(1)) == 1 and m.end() < len(text):
            c = text[m.end()]
            if which == 0:
                delim = c
            else:
                end = c
            vals.append(c)
            i = m.end() + 1
        else:
            vals.append(None)
        while i < len(text) and text[i] == " ":
            i += 1
        if i >= len(text) or text[i] == end:
            return {k + 1: v for k, v in enumerate(vals)}
        i += 1  # the delimiter after the field
    vals += _fields(text[i:], delim, end)
    out = {k + 1: v for k, v in enumerate(vals)}
    out[1], out[2] = delim, end
    return out


def parse(text: str) -> IgesFile:
    """Parse an IGES file (ASCII, the fixed 80-column format)."""
    s = _lines(text)
    g = _globals("".join(line[:72] for line in s["G"]))
    delim, end = g[1], g[2]
    # parameter lines by their DE pointer (columns 66 to 72), in order
    pdata: dict[int, list[str]] = {}
    for line in s["P"]:
        pdata.setdefault(_int(line[64:72]), []).append(line[:64])
    entities: dict[int, Entity] = {}
    d = s["D"]
    for k in range(0, len(d) - 1, 2):
        l1, l2 = d[k], d[k + 1]
        de = _int(l1[73:80], k + 1)
        e = Entity(type=_int(l1[0:8]), form=_int(l2[32:40]), de=de, transform=_int(l1[48:56]),
                   color=_int(l2[16:24]), status=l1[64:72].replace(" ", "0"), label=l2[56:64].strip())
        lines = pdata.get(de)
        if lines:
            e.params = _fields("".join(lines), delim, end)[1:]
        entities[de] = e
    return IgesFile("".join(line[:72] for line in s["S"]).rstrip(), g, entities)


# =============================================================================
# Interpretation
# =============================================================================
#: millimetres per unit of the global unit flag (G14), and of the unit names (G15)
_UNIT_FLAGS = {1: 25.4, 2: 1.0, 4: 304.8, 5: 1609344.0, 6: 1000.0, 7: 1e6, 8: 0.0254, 9: 0.001, 10: 10.0, 11: 2.54e-5}
_UNIT_NAMES = {"IN": 25.4, "INCH": 25.4, "MM": 1.0, "FT": 304.8, "MI": 1609344.0, "M": 1000.0, "KM": 1e6, "MIL": 0.0254,
               "UM": 0.001, "CM": 10.0, "UIN": 2.54e-5}
#: the standard color numbers (directory field 13)
_COLORS = {1: (0.0, 0.0, 0.0), 2: (1.0, 0.0, 0.0), 3: (0.0, 1.0, 0.0), 4: (0.0, 0.0, 1.0), 5: (1.0, 1.0, 0.0),
           6: (1.0, 0.0, 1.0), 7: (0.0, 1.0, 1.0), 8: (1.0, 1.0, 1.0)}
#: what a message calls the entities a body or face comes from
_KINDS = {186: "solid", 514: "shell", 144: "trimmed surface", 143: "bounded surface", 108: "bounded plane", 128: "surface",
          114: "surface", 408: "subfigure instance"}


def _tangent(curve: dict[str, Any], p: np.ndarray, t: float | None) -> np.ndarray:
    """The direction a curve of ``segments`` runs in at its point ``p`` (at parameter ``t`` of a
    B-spline)."""
    kind = curve["kind"]
    if kind == "line":
        return np.asarray(curve["direction"], dtype=float)
    if kind in ("circle", "ellipse"):
        o, z, x = (np.asarray(curve[k], dtype=float) for k in ("origin", "z", "x"))
        y = np.cross(z, x)
        r1, r2 = (curve["radius"],) * 2 if kind == "circle" else (curve["r1"], curve["r2"])
        a = math.atan2(float((p - o) @ y) / r2, float((p - o) @ x) / r1)
        return -r1 * math.sin(a) * x + r2 * math.cos(a) * y
    if kind == "bspline":
        ks, deg = curve["knots"], curve["degree"]
        lo, hi = float(ks[deg]), float(ks[len(ks) - deg - 1])
        t = lo if t is None else float(t)
        h = 1e-7 * (hi - lo)
        a, b = max(lo, t - h), min(hi, t + h)
        return bspline_point(curve, b) - bspline_point(curve, a)
    raise NotImplementedError(f"an offset of a {kind}")


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    if not n > 0:
        raise ValueError("IGES: a direction of length 0")
    return v / n


def _perpendicular(z: np.ndarray) -> np.ndarray:
    return _unit(np.cross(z, [1.0, 0.0, 0.0] if abs(z[0]) < 0.9 else [0.0, 1.0, 0.0]))


def _basis(knots: list[float], degree: int, t: float) -> tuple[int, list[float]]:
    """The knot span of ``t`` and the degree + 1 B-spline basis functions that are not 0 there."""
    n = len(knots) - degree - 2  # the last control point's index
    t = min(max(t, knots[degree]), knots[n + 1])
    span = degree
    while span < n and t >= knots[span + 1]:
        span += 1
    left, right, N = [0.0] * (degree + 1), [0.0] * (degree + 1), [1.0] + [0.0] * degree
    for j in range(1, degree + 1):
        left[j] = t - knots[span + 1 - j]
        right[j] = knots[span + j] - t
        saved = 0.0
        for r in range(j):
            d = right[r + 1] + left[j - r]
            tmp = N[r] / d if d != 0 else 0.0
            N[r] = saved + right[r + 1] * tmp
            saved = left[j - r] * tmp
        N[j] = saved
    return span, N


def bspline_point(spec: dict[str, Any], t: float) -> np.ndarray:
    """The point of a B-spline curve spec (``degree``, ``poles``, ``knots``, ``weights``) at ``t``."""
    p = int(spec["degree"])
    span, N = _basis(spec["knots"], p, t)
    poles = np.asarray(spec["poles"], dtype=float)
    w = spec["weights"]
    num, den = np.zeros(3), 0.0
    for i in range(p + 1):
        k = span - p + i
        wi = 1.0 if w is None else float(w[k])
        num = num + poles[k] * (N[i] * wi)
        den += N[i] * wi
    return num / den


class _Interp:
    def __init__(self, f: IgesFile):
        self.f = f
        flag, name = f.globals.get(14), f.globals.get(15)
        mm = _UNIT_FLAGS.get(int(flag)) if _whole(flag) else None
        if mm is None and isinstance(name, str):
            mm = _UNIT_NAMES.get(name.strip().upper())
        self.mm = mm or 1.0
        res = f.globals.get(19)
        self.resolution = float(res) * self.mm if isinstance(res, (int, float)) and res > 0 else None
        self.root = np.diag([self.mm, self.mm, self.mm, 1.0])

    # -- entities and transforms -------------------------------------------------
    def get(self, de: Any, *types: int) -> Entity:
        if not _whole(de) or de <= 0:
            raise ValueError(f"IGES: {de!r} where a pointer to an entity is expected")
        e = self.f.entities.get(int(de))
        if e is None:
            raise ValueError(f"IGES: the file has no entity at DE {de}")
        if types and e.type not in types:
            raise NotImplementedError(f"entity type {e.type} (DE {de}) where {' or '.join(map(str, types))} is expected")
        return e

    def matrix(self, de: int, depth: int = 0) -> np.ndarray:
        """A transformation matrix (124) into the space of the entity that uses it: its own, then
        the one its own directory entry names."""
        if depth > 32:
            raise ValueError("IGES: transformation matrices refer to each other in a circle")
        e = self.get(de, 124)
        p = self.nums(e, 0, 12)
        m = np.array([p[0:4], p[4:8], p[8:12], [0.0, 0.0, 0.0, 1.0]])
        return self.matrix(e.transform, depth + 1) @ m if e.transform else m

    def placed(self, e: Entity, M: np.ndarray) -> np.ndarray:
        """The transformation from an entity's definition space to model space (mm)."""
        return M @ self.matrix(e.transform) if e.transform else M

    @staticmethod
    def P(M: np.ndarray, p: Any) -> np.ndarray:
        return M[:3, :3] @ np.asarray(p, dtype=float) + M[:3, 3]

    @staticmethod
    def D(M: np.ndarray, d: Any) -> np.ndarray:
        return _unit(M[:3, :3] @ np.asarray(d, dtype=float))

    @staticmethod
    def scale(M: np.ndarray) -> float:
        """The scale of a conformal transformation (a rotation, maybe mirrored, and a scale)."""
        R = M[:3, :3]
        s = abs(float(np.linalg.det(R))) ** (1.0 / 3.0)
        if not s > 0 or not np.allclose(R.T @ R, np.eye(3) * s * s, rtol=0.0, atol=1e-6 * s * s):
            raise NotImplementedError("a transformation matrix that is not a rotation and a uniform scale")
        return s

    @staticmethod
    def handed(M: np.ndarray) -> float:
        """1 for a transformation that keeps counterclockwise, -1 for a mirroring one."""
        return 1.0 if float(np.linalg.det(M[:3, :3])) >= 0 else -1.0

    def nums(self, e: Entity, start: int, count: int) -> list[float]:
        vals = e.params[start:start + count]
        if len(vals) < count or any(isinstance(v, str) for v in vals):
            raise ValueError(f"IGES: entity {e.type} (DE {e.de}) has too few parameters")
        return [0.0 if v is None else float(v) for v in vals]

    def ints(self, e: Entity, start: int, count: int) -> list[int]:
        return [int(v) for v in self.nums(e, start, count)]

    # -- names and colors --------------------------------------------------------
    def name(self, e: Entity, own: int | None) -> str:
        """The name property (406, form 15) among the pointers after an entity's own ``own``
        parameters (and its associativities), else its label."""
        rest = e.params[own:] if own is not None else []
        if rest and _whole(rest[0]) and 0 <= rest[0] < len(rest) - 1 and _whole(rest[int(rest[0]) + 1]):
            nv = int(rest[0])
            np_ = int(rest[nv + 1])
            for de in rest[nv + 2:nv + 2 + np_]:
                p = self.f.entities.get(int(de)) if _whole(de) else None
                if p is not None and p.type == 406 and p.form == 15 and len(p.params) > 1 and isinstance(p.params[1], str):
                    return p.params[1].strip()
        return e.label

    def color(self, e: Entity) -> tuple[float, float, float] | None:
        if e.color > 0:
            return _COLORS.get(e.color)
        if e.color < 0:
            c = self.f.entities.get(-e.color)
            if c is not None and c.type == 314 and len(c.params) >= 3:
                rgb = [min(max(float(x or 0.0) / 100.0, 0.0), 1.0) for x in c.params[:3]]
                return (rgb[0], rgb[1], rgb[2])
        return None

    # -- curves ------------------------------------------------------------------
    def segments(self, de: int, M: np.ndarray, depth: int = 0) -> list[dict[str, Any]]:
        """The pieces of a model-space curve: ``{"curve": spec, "p0", "p1"}``, each running from
        p0 to p1 (the spec as step_reader's curves; circles and ellipses run counterclockwise
        about their z)."""
        if depth > 64:
            raise ValueError("IGES: composite curves refer to each other in a circle")
        e = self.get(de)
        M = self.placed(e, M)
        t = e.type
        if t == 102:
            n = self.ints(e, 0, 1)[0]
            out: list[dict[str, Any]] = []
            for child in self.ints(e, 1, n):
                out += self.segments(child, M, depth + 1)
            return out
        if t == 110:
            v = self.nums(e, 0, 6)
            p0, p1 = self.P(M, v[0:3]), self.P(M, v[3:6])
            return [{"curve": {"kind": "line", "origin": p0, "direction": p1 - p0}, "p0": p0, "p1": p1}]
        if t == 100:
            zt, x1, y1, x2, y2, x3, y3 = self.nums(e, 0, 7)
            c, s0, s1 = np.array([x1, y1, zt]), np.array([x2, y2, zt]), np.array([x3, y3, zt])
            r = float(np.linalg.norm(s0 - c))
            if not r > 0:
                raise ValueError(f"IGES: the circular arc at DE {de} has a radius of 0")
            closed = float(np.linalg.norm(s1 - s0)) <= 1e-9 * r
            end = s0 if closed else c + (s1 - c) * (r / float(np.linalg.norm(s1 - c)))  # (on the circle)
            o, p0, p1 = self.P(M, c), self.P(M, s0), self.P(M, end)
            z = self.D(M, [0.0, 0.0, 1.0]) * self.handed(M)
            spec = {"kind": "circle", "origin": o, "z": z, "x": _unit(p0 - o), "radius": r * self.scale(M)}
            return [{"curve": spec, "p0": p0, "p1": p0 if closed else p1}]
        if t == 104:
            return [self.conic(e, M)]
        if t == 126:
            spec, t0, t1 = self.bspline_curve(e, M)
            return [{"curve": spec, "p0": bspline_point(spec, t0), "p1": bspline_point(spec, t1), "t0": t0, "t1": t1}]
        if t in (106, 112):
            spec = self.polyline(e, M) if t == 106 else self.parametric_spline(e, M)
            ks = spec["knots"]
            return [{"curve": spec, "p0": spec["poles"][0], "p1": spec["poles"][-1], "t0": ks[0], "t1": ks[-1]}]
        if t == 130:
            return [self.offset_curve(e, M, depth)]
        raise NotImplementedError(f"curve entity {t} (DE {de})")

    def offset_curve(self, e: Entity, M: np.ndarray, depth: int) -> dict[str, Any]:
        """An offset curve (130) at one distance: its base curve moved by it along the base's tangent x
        the normal of the plane it lies in (as OpenCASCADE reads such files, and its own offset curves;
        STEP's OFFSET_CURVE_3D offsets the other way round; a mirroring transformation turns the normal
        round). Lines and circles about the normal stay lines and circles; other curves become the
        kernel's offset curve, a NURBS."""
        base_de, flag = self.ints(e, 0, 2)
        if flag != 1:
            raise NotImplementedError(f"an offset curve whose distance varies (DE {e.de})")
        d = self.nums(e, 4, 1)[0] * self.scale(M)
        normal = self.D(M, self.nums(e, 8, 3)) * self.handed(M)
        pieces = self.segments(base_de, M, depth + 1)
        if len(pieces) != 1:
            raise NotImplementedError(f"an offset of a composite curve (DE {e.de})")
        b = pieces[0]
        base = b["curve"]
        spec = _offset_curve(base, d, normal, f"DE {e.de}", "import IGES offset curve")
        closed = float(np.linalg.norm(b["p1"] - b["p0"])) <= 1e-12 * max(1.0, float(np.linalg.norm(b["p0"])))
        if spec["kind"] == "bspline" and base["kind"] != "bspline" and not closed:
            # (an arc's angle is not the parameter of the NURBS its offset becomes)
            raise NotImplementedError(f"an offset of a {base['kind']} arc out of its plane (DE {e.de})")
        ends = [p + d * _unit(np.cross(_tangent(base, p, b.get(key)), normal)) for p, key in ((b["p0"], "t0"), (b["p1"], "t1"))]
        out = {"curve": spec, "p0": ends[0], "p1": ends[1]}
        if spec["kind"] == "bspline" and "t0" in b:  # (the kernel's offset keeps its basis's parameters)
            out["t0"], out["t1"] = b["t0"], b["t1"]
        return out

    def curve(self, de: int, M: np.ndarray) -> dict[str, Any]:
        """One whole curve (a generatrix, a directrix) as a step_reader curve spec, with its ends
        ``p0`` and ``p1``."""
        segs = self.segments(de, M)
        if len(segs) != 1:
            raise NotImplementedError(f"a composite curve (DE {de}) as the curve of a surface")
        return dict(segs[0]["curve"], p0=segs[0]["p0"], p1=segs[0]["p1"])

    def bspline_curve(self, e: Entity, M: np.ndarray) -> tuple[dict[str, Any], float, float]:
        """A rational B-spline curve (126), and the parameters its piece starts and ends at."""
        k, m = self.ints(e, 0, 2)
        if k < 1 or m < 1 or k < m:
            raise ValueError(f"IGES: the B-spline curve at DE {e.de} has {k + 1} control points of degree {m}")
        polynomial = self.ints(e, 4, 1)[0] == 1
        nk = k + m + 2
        knots = self.nums(e, 6, nk)
        weights = self.nums(e, 6 + nk, k + 1)
        xyz = self.nums(e, 6 + nk + k + 1, 3 * (k + 1))
        v0, v1 = self.nums(e, 6 + nk + 4 * (k + 1), 2)
        if any(b < a for a, b in zip(knots, knots[1:])):
            raise ValueError(f"IGES: the knots of the B-spline curve at DE {e.de} decrease")
        if any(not w > 0 for w in weights):
            raise ValueError(f"IGES: the B-spline curve at DE {e.de} has a weight that is not positive")
        poles = np.array([self.P(M, xyz[3 * i:3 * i + 3]) for i in range(k + 1)])
        same = polynomial or all(abs(w - weights[0]) <= 1e-12 * weights[0] for w in weights)
        lo, hi = knots[m], knots[k + 1]
        if not v0 < v1:
            v0, v1 = lo, hi
        spec = {"kind": "bspline", "degree": m, "poles": poles, "knots": knots, "weights": None if same else weights}
        return spec, min(max(v0, lo), hi), min(max(v1, lo), hi)

    def polyline(self, e: Entity, M: np.ndarray) -> dict[str, Any]:
        """A linear path (106, forms 11, 12, 63) as a B-spline of degree 1."""
        if e.form not in (11, 12, 63):
            raise NotImplementedError(f"copious data of form {e.form} (DE {e.de}) as a curve")
        ip, n = self.ints(e, 0, 2)
        if n < 2:
            raise ValueError(f"IGES: the linear path at DE {e.de} has fewer than 2 points")
        if ip == 1:
            zt = self.nums(e, 2, 1)[0]
            xy = self.nums(e, 3, 2 * n)
            pts = [[xy[2 * i], xy[2 * i + 1], zt] for i in range(n)]
        else:
            step = 3 if ip == 2 else 6
            v = self.nums(e, 2, step * n)
            pts = [v[step * i:step * i + 3] for i in range(n)]
        poles = np.array([self.P(M, p) for p in pts])
        knots = [0.0] + [float(i) for i in range(n)] + [float(n - 1)]
        return {"kind": "bspline", "degree": 1, "poles": poles, "knots": knots, "weights": None}

    def parametric_spline(self, e: Entity, M: np.ndarray) -> dict[str, Any]:
        """A parametric spline curve (112) as the cubic B-spline of its pieces."""
        n = self.ints(e, 3, 1)[0]
        if n < 1:
            raise ValueError(f"IGES: the parametric spline at DE {e.de} has no segments")
        T = self.nums(e, 4, n + 1)
        poles: list[np.ndarray] = []
        for i in range(n):
            c = self.nums(e, 5 + n + 12 * i, 12)  # AX BX CX DX AY BY CY DY AZ BZ CZ DZ
            h = T[i + 1] - T[i]
            a, b, cc, d = (np.array([c[j], c[4 + j], c[8 + j]]) for j in range(4))
            poles += ([a] if i == 0 else []) + [a + b * h / 3, a + b * h * 2 / 3 + cc * h * h / 3,
                                               a + b * h + cc * h * h + d * h ** 3]
        knots = [T[0]] * 4 + [x for x in T[1:-1] for _ in range(3)] + [T[-1]] * 4
        return {"kind": "bspline", "degree": 3, "poles": np.array([self.P(M, p) for p in poles]), "knots": knots,
                "weights": None}

    def conic(self, e: Entity, M: np.ndarray) -> dict[str, Any]:
        """A conic arc (104) from its start to its end point (an ellipse counterclockwise):
        an ellipse, a hyperbola or a parabola, wherever its equation puts it."""
        A, B, C, Dd, E, F, zt, x1, y1, x2, y2 = self.nums(e, 0, 11)
        Q = np.array([[A, B / 2], [B / 2, C]])
        L = np.array([Dd, E])
        s0, s1 = np.array([x1, y1]), np.array([x2, y2])
        lam, V = np.linalg.eigh(Q)
        scale = self.scale(M)
        z = self.D(M, [0.0, 0.0, 1.0]) * self.handed(M)

        def P2(p: np.ndarray) -> np.ndarray:
            return self.P(M, [p[0], p[1], zt])

        def D2(d: np.ndarray) -> np.ndarray:
            return self.D(M, [d[0], d[1], 0.0])

        big = max(abs(lam[0]), abs(lam[1]))
        if not big > 0:
            raise ValueError(f"IGES: the conic at DE {e.de} has no quadratic terms")
        if min(abs(lam[0]), abs(lam[1])) <= 1e-12 * big:  # a parabola
            i = 0 if abs(lam[0]) > abs(lam[1]) else 1
            u, w = V[:, i], V[:, 1 - i]  # across its axis, along it
            l1, du, dw = float(lam[i]), float(L @ u), float(L @ w)
            if abs(dw) <= 1e-14 * (abs(du) + abs(F) + 1):
                raise ValueError(f"IGES: the parabola at DE {e.de} is degenerate")
            # l1 X^2 + du X + dw Y + F = 0, X along u, Y along w: Y - y0 = opening (X - x0)^2
            x0 = -du / (2 * l1)
            y0 = -(F - du * du / (4 * l1)) / dw
            opening = -l1 / dw
            xdir = w if opening > 0 else -w
            spec = {"kind": "parabola", "origin": P2(u * x0 + w * y0), "z": z, "x": D2(xdir),
                    "focal": scale / (4 * abs(opening))}
            return {"curve": spec, "p0": P2(s0), "p1": P2(s1)}
        center = np.linalg.solve(2 * Q, -L)
        f0 = float(center @ Q @ center + L @ center + F)
        a2, b2 = -f0 / float(lam[0]), -f0 / float(lam[1])
        if a2 > 0 and b2 > 0:
            i = 0 if a2 >= b2 else 1  # x along the major axis
            r1, r2 = math.sqrt(max(a2, b2)), math.sqrt(min(a2, b2))
            spec = {"kind": "ellipse", "origin": P2(center), "z": z, "x": D2(V[:, i]), "r1": r1 * scale,
                    "r2": r2 * scale}
            closed = float(np.linalg.norm(s1 - s0)) <= 1e-9 * r1
            p0 = P2(s0)
            return {"curve": spec, "p0": p0, "p1": p0 if closed else P2(s1)}
        if not a2 * b2 < 0:
            raise ValueError(f"IGES: the conic at DE {e.de} is neither an ellipse, a hyperbola nor a parabola")
        i = 0 if a2 > 0 else 1  # x across the branches, toward the one the arc lies on
        xdir = V[:, i] if float((s0 - center) @ V[:, i]) >= 0 else -V[:, i]
        a, b = math.sqrt(abs(a2 if i == 0 else b2)), math.sqrt(abs(b2 if i == 0 else a2))
        spec = {"kind": "hyperbola", "origin": P2(center), "z": z, "x": D2(xdir), "a": a * scale, "b": b * scale}
        return {"curve": spec, "p0": P2(s0), "p1": P2(s1)}

    # -- surfaces ----------------------------------------------------------------
    def surface(self, de: int, M: np.ndarray) -> dict[str, Any]:
        """A surface as a step_reader surface spec, in model space, with ``sense``: 1 where the
        spec's normal is the IGES surface's (the cross product of its derivatives in u and v,
        which a face and its boundaries are oriented by), -1 where it is the opposite one."""
        e = self.get(de)
        M = self.placed(e, M)
        t = e.type
        if t == 108:
            a, b, c, d = self.nums(e, 0, 4)
            sym = np.array(self.nums(e, 5, 3)) if len(e.params) >= 8 else np.zeros(3)
            n = np.array([a, b, c])
            nn = float(n @ n)
            if not nn > 0:
                raise ValueError(f"IGES: the plane at DE {de} has no normal")
            z = self.D(M, n)
            return {"kind": "plane", "origin": self.P(M, sym + n * ((d - float(n @ sym)) / nn)), "z": z,
                    "x": _perpendicular(z), "sense": self.handed(M)}
        if t in (190, 192, 194, 196, 198):
            return dict(self.analytic(e, M), sense=self.handed(M))
        if t == 128:
            return dict(self.bspline_surface(e, M)[0], sense=1.0)
        if t == 114:
            return dict(self.spline_surface(e, M), sense=1.0)
        if t == 118:
            return self.ruled(e, M)
        if t == 120:
            return self.revolution(e, M)
        if t == 122:
            return self.tabulated(e, M)
        if t == 140:
            d = self.nums(e, 0, 4)[3]
            basis = self.surface(self.ints(e, 4, 1)[0], M)
            return {"kind": "offset", "basis": basis, "distance": d * self.scale(M), "sense": basis["sense"]}
        raise NotImplementedError(f"surface entity {t} (DE {de})")

    def point(self, de: int, M: np.ndarray) -> np.ndarray:
        e = self.get(de, 116)
        return self.P(self.placed(e, M), self.nums(e, 0, 3))

    def direction(self, de: int, M: np.ndarray) -> np.ndarray:
        e = self.get(de, 123)
        return self.D(self.placed(e, M), self.nums(e, 0, 3))

    def analytic(self, e: Entity, M: np.ndarray) -> dict[str, Any]:
        """A plane, cylinder, cone, sphere or torus (190 to 198): form 1 gives the reference
        direction (the x axis), form 0 none."""
        t, s, p = e.type, self.scale(M), e.params

        def ref(i: int, z: np.ndarray) -> np.ndarray:
            return self.direction(p[i], M) if e.form == 1 and len(p) > i and p[i] else _perpendicular(z)

        if t == 190:
            o, z = self.point(p[0], M), self.direction(p[1], M)
            return {"kind": "plane", "origin": o, "z": z, "x": ref(2, z)}
        if t == 192:
            o, z = self.point(p[0], M), self.direction(p[1], M)
            return {"kind": "cylinder", "origin": o, "z": z, "x": ref(3, z), "radius": self.nums(e, 2, 1)[0] * s}
        if t == 194:
            o, z = self.point(p[0], M), self.direction(p[1], M)
            r, angle = self.nums(e, 2, 2)
            return {"kind": "cone", "origin": o, "z": z, "x": ref(4, z), "radius": r * s, "semi_angle": math.radians(angle)}
        if t == 196:
            o, r = self.point(p[0], M), self.nums(e, 1, 1)[0]
            if e.form == 1 and len(p) > 3 and p[2] and p[3]:
                z, x = self.direction(p[2], M), self.direction(p[3], M)
            else:
                z = self.D(M, [0.0, 0.0, 1.0])
                x = _perpendicular(z)
            return {"kind": "sphere", "origin": o, "z": z, "x": x, "radius": r * s}
        o, z = self.point(p[0], M), self.direction(p[1], M)
        major, minor = self.nums(e, 2, 2)
        return {"kind": "torus", "origin": o, "z": z, "x": ref(4, z), "major": major * s, "minor": minor * s}

    def bspline_surface(self, e: Entity, M: np.ndarray) -> tuple[dict[str, Any], tuple[float, float, float, float]]:
        """A rational B-spline surface (128), and the parameter range the file gives it."""
        k1, k2, m1, m2 = self.ints(e, 0, 4)
        polynomial = self.ints(e, 6, 1)[0] == 1
        n1, n2 = k1 + m1 + 2, k2 + m2 + 2
        nu, nv = k1 + 1, k2 + 1
        if m1 < 1 or m2 < 1 or nu < m1 + 1 or nv < m2 + 1:
            raise ValueError(f"IGES: the B-spline surface at DE {e.de} has too few control points for its degree")
        uk, vk = self.nums(e, 9, n1), self.nums(e, 9 + n1, n2)
        at = 9 + n1 + n2
        w = self.nums(e, at, nu * nv)
        xyz = self.nums(e, at + nu * nv, 3 * nu * nv)
        rng = self.nums(e, at + 4 * nu * nv, 4)
        if any(b < a for a, b in zip(uk, uk[1:])) or any(b < a for a, b in zip(vk, vk[1:])):
            raise ValueError(f"IGES: the knots of the B-spline surface at DE {e.de} decrease")
        if any(not x > 0 for x in w):
            raise ValueError(f"IGES: the B-spline surface at DE {e.de} has a weight that is not positive")
        # the file lists the control points with u running fastest, the spec u by u
        order = [j * nu + i for i in range(nu) for j in range(nv)]
        poles = np.array([self.P(M, xyz[3 * q:3 * q + 3]) for q in order])
        weights = [w[q] for q in order]
        same = polynomial or all(abs(x - weights[0]) <= 1e-12 * weights[0] for x in weights)
        spec = {"kind": "bspline", "u_degree": m1, "v_degree": m2, "nu": nu, "nv": nv, "poles": poles, "u_knots": uk,
                "v_knots": vk, "weights": None if same else weights}
        return spec, (rng[0], rng[1], rng[2], rng[3])

    def spline_surface(self, e: Entity, M: np.ndarray) -> dict[str, Any]:
        """A parametric spline surface (114) as the bicubic B-spline of its patches."""
        m, n = self.ints(e, 2, 2)
        if m < 1 or n < 1:
            raise ValueError(f"IGES: the parametric spline surface at DE {e.de} has no patches")
        tu, tv = self.nums(e, 4, m + 1), self.nums(e, 5 + m, n + 1)
        at = 6 + m + n
        nu, nv = 3 * m + 1, 3 * n + 1
        grid = np.zeros((nu, nv, 3))
        # the cubic power basis on [0, h] in Bernstein form on [0, 1]
        bern = np.array([[1, 0, 0, 0], [1, 1 / 3, 0, 0], [1, 2 / 3, 1 / 3, 0], [1, 1, 1, 1]])
        for i in range(m):
            hu = tu[i + 1] - tu[i]
            Bu = bern @ np.diag([1.0, hu, hu * hu, hu ** 3])
            for j in range(n):
                hv = tv[j + 1] - tv[j]
                Bv = bern @ np.diag([1.0, hv, hv * hv, hv ** 3])
                c = self.nums(e, at + 48 * (i * (n + 1) + j), 48)
                for axis in range(3):
                    # the coefficients of s^k t^l (AX, BX, ..., PX), k running fastest
                    a = np.array(c[16 * axis:16 * axis + 16]).reshape(4, 4).T
                    grid[3 * i:3 * i + 4, 3 * j:3 * j + 4, axis] = Bu @ a @ Bv.T
        poles = np.array([self.P(M, grid[i, j]) for i in range(nu) for j in range(nv)])
        uk = [tu[0]] * 4 + [x for x in tu[1:-1] for _ in range(3)] + [tu[-1]] * 4
        vk = [tv[0]] * 4 + [x for x in tv[1:-1] for _ in range(3)] + [tv[-1]] * 4
        return {"kind": "bspline", "u_degree": 3, "v_degree": 3, "nu": nu, "nv": nv, "poles": poles, "u_knots": uk,
                "v_knots": vk, "weights": None}

    def ruled(self, e: Entity, M: np.ndarray) -> dict[str, Any]:
        """A ruled surface (118): straight lines from the first curve (v = 0) to the second (v = 1),
        between points at equal parameters along them (form 1; form 0, equal arc lengths, is read
        so too), the second curve run backwards where the entity says so. The curves are lines
        or B-spline curves."""
        from .shapes import _canonical_curve

        de1, de2, backwards = self.ints(e, 0, 3)
        kernel_curves = []
        try:
            for de in (de1, de2):
                segs = self.segments(de, M)
                if len(segs) != 1:
                    raise NotImplementedError(f"a composite curve (DE {de}) as a curve of a ruled surface")
                s = segs[0]
                c = s["curve"]
                if c["kind"] == "line":
                    c = {"kind": "bspline", "degree": 1, "poles": np.array([s["p0"], s["p1"]]),
                         "knots": [0.0, 0.0, 1.0, 1.0], "weights": None}
                elif c["kind"] != "bspline":
                    raise NotImplementedError(f"a {c['kind']} as a curve of a ruled surface")
                ks, p = c["knots"], c["degree"]
                lo, hi = ks[p], ks[len(ks) - p - 1]
                t0, t1 = s.get("t0", lo), s.get("t1", hi)
                with kernel_call("import IGES"):
                    whole = _canonical_curve(np.asarray(c["poles"]), ks, p, c["weights"])
                    kernel_curves.append(whole)
                    if t0 > lo + 1e-12 * (hi - lo) or t1 < hi - 1e-12 * (hi - lo):  # (the piece the entity takes)
                        kernel_curves[-1] = ext.trimmed_curve(whole, t0, t1)
                        ext.delete_curve(whole)
            if backwards == 1:
                with kernel_call("import IGES"):
                    ext.reverse_curve(kernel_curves[1])
            with kernel_call("import IGES"):
                srf = k.create_ruled_surface(kernel_curves[0], kernel_curves[1])
                try:
                    d = ext.surface_data(srf, True)
                finally:
                    ext.delete_surface(srf)
        finally:
            for kc in kernel_curves:
                ext.delete_curve(kc)
        uk, vk = list(d["u_knots"]), list(d["v_knots"])
        return {"kind": "bspline", "u_degree": d["u_degree"], "v_degree": d["v_degree"],
                "nu": len(uk) - d["u_degree"] - 1, "nv": len(vk) - d["v_degree"] - 1,
                "poles": np.asarray(d["poles"], dtype=float), "u_knots": uk, "v_knots": vk, "weights": d["weights"],
                "sense": 1.0}

    def revolution(self, e: Entity, M: np.ndarray) -> dict[str, Any]:
        """A surface of revolution (120): a cylinder, cone, plane, sphere or torus where its
        generatrix is a line or a circle so placed, else the curve revolved.

        Its parameters are the generatrix's (u) and the angle (v), turning counterclockwise about
        the axis line in its definition space (clockwise in model space where its transformation
        mirrors): its normal at a point of the generatrix is the generatrix's direction across
        the direction the point turns in."""
        axis_de, gen_de = self.ints(e, 0, 2)
        ax = self.segments(axis_de, M)[0]
        a0, ad = ax["p0"], _unit(ax["p1"] - ax["p0"])
        g = self.curve(gen_de, M)
        q, tangent = _point_and_tangent(g)

        def off_axis(p: np.ndarray) -> np.ndarray:
            d = p - a0
            return d - ad * float(d @ ad)

        normal = np.cross(tangent, np.cross(ad * self.handed(M), off_axis(q)))

        def sense(outward: np.ndarray) -> float:
            return 1.0 if float(normal @ outward) >= 0 else -1.0

        size = max(1.0, float(np.linalg.norm(g["p0"] - a0)), float(np.linalg.norm(g["p1"] - a0)))
        tol = 1e-9 * size
        if g["kind"] == "line":
            q0, q1 = g["p0"], g["p1"]
            r0, r1 = off_axis(q0), off_axis(q1)
            n0, n1 = float(np.linalg.norm(r0)), float(np.linalg.norm(r1))
            ref = r0 if n0 >= n1 else r1
            if float(np.linalg.norm(np.cross(_unit(q1 - q0), ad))) <= 1e-12 and n0 > tol:  # parallel: a cylinder
                return {"kind": "cylinder", "origin": q0 - r0, "z": ad, "x": _unit(r0), "radius": n0,
                        "sense": sense(off_axis(q))}
            if abs(float(np.cross(r0, r1) @ ad)) <= tol * size and max(n0, n1) > tol:  # in a plane through the axis
                h0, h1 = float((q0 - a0) @ ad), float((q1 - a0) @ ad)
                if abs(h1 - h0) <= tol:  # across the axis: a plane
                    return {"kind": "plane", "origin": a0 + ad * h0, "z": ad, "x": _unit(ref), "sense": sense(ad)}
                slope = (n1 - n0) / (h1 - h0)  # the radius grows by slope along the axis
                return {"kind": "cone", "origin": a0 + ad * (h0 if n0 >= n1 else h1), "z": ad if slope >= 0 else -ad,
                        "x": _unit(ref), "radius": max(n0, n1), "semi_angle": math.atan(abs(slope)),
                        "sense": sense(off_axis(q))}
        if g["kind"] == "circle" and abs(float(g["z"] @ ad)) <= 1e-9:  # in a plane through the axis
            rc = off_axis(g["origin"])
            major = float(np.linalg.norm(rc))
            if major <= tol:
                return {"kind": "sphere", "origin": g["origin"], "z": ad, "x": _perpendicular(ad), "radius": g["radius"],
                        "sense": sense(q - g["origin"])}
            ring = g["origin"] - rc + _unit(off_axis(q)) * major  # (the middle of the tube at q)
            return {"kind": "torus", "origin": g["origin"] - rc, "z": ad, "x": _unit(rc), "major": major,
                    "minor": g["radius"], "sense": sense(q - ring)}
        curve = {k: v for k, v in g.items() if k not in ("p0", "p1")}
        if curve["kind"] == "line":  # (a skew line: a B-spline of degree 1)
            curve = {"kind": "bspline", "degree": 1, "poles": np.array([g["p0"], g["p1"]]), "knots": [0.0, 0.0, 1.0, 1.0],
                     "weights": None}
        # (the kernel's revolution turns the curve by its first parameter, the IGES one by its second)
        return {"kind": "revolution", "curve": curve, "axis_origin": a0, "axis": ad, "sense": -self.handed(M)}

    def tabulated(self, e: Entity, M: np.ndarray) -> dict[str, Any]:
        """A tabulated cylinder (122): the directrix (u) moved along the generatrix (v), from the
        directrix's start to the point the entity gives. Its normal is the directrix's direction
        across the generatrix's."""
        g = self.curve(self.ints(e, 0, 1)[0], M)
        vec = self.P(M, self.nums(e, 1, 3)) - g["p0"]
        q, tangent = _point_and_tangent(g)
        normal = np.cross(tangent, vec)
        if g["kind"] == "line":
            return {"kind": "plane", "origin": g["p0"], "z": _unit(normal), "x": _unit(g["p1"] - g["p0"]), "sense": 1.0}
        if g["kind"] == "circle" and float(np.linalg.norm(np.cross(_unit(vec), g["z"]))) <= 1e-12:
            radial = q - g["origin"]
            return {"kind": "cylinder", "origin": g["origin"], "z": g["z"], "x": g["x"], "radius": g["radius"],
                    "sense": 1.0 if float(normal @ radial) >= 0 else -1.0}
        return {"kind": "extrusion", "curve": {k: v for k, v in g.items() if k not in ("p0", "p1")}, "vector": vec,
                "sense": 1.0}


def _point_and_tangent(g: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    """A point halfway along a curve spec with ends (``p0``, ``p1``) and its direction there."""
    kind = g["kind"]
    if kind == "line":
        return (g["p0"] + g["p1"]) / 2, g["p1"] - g["p0"]
    if kind in ("circle", "ellipse"):
        q = _middle(g, g["p0"], g["p1"])
        o, z, x = g["origin"], g["z"], g["x"]
        y = np.cross(z, x)
        r1, r2 = (g["radius"],) * 2 if kind == "circle" else (g["r1"], g["r2"])
        d = q - o
        a = math.atan2(float(d @ y) / r2, float(d @ x) / r1)
        return q, -x * r1 * math.sin(a) + y * r2 * math.cos(a)
    if kind == "bspline":
        ks, p = g["knots"], g["degree"]
        lo, hi = ks[p], ks[len(ks) - p - 1]
        t, h = (lo + hi) / 2, 1e-6 * (hi - lo)
        return bspline_point(g, t), bspline_point(g, t + h) - bspline_point(g, t - h)
    return (g["p0"] + g["p1"]) / 2, g["p1"] - g["p0"]


# =============================================================================
# Topology
# =============================================================================
def _middle(curve: dict[str, Any], p0: np.ndarray, p1: np.ndarray) -> np.ndarray:
    """The point halfway along a circle or an ellipse from p0 to p1 (counterclockwise), or a
    B-spline (its parameters), a line."""
    return _at({"curve": curve, "p0": p0, "p1": p1}, 0.5)


def _at(piece: dict[str, Any], f: float) -> np.ndarray:
    """The point a fraction ``f`` along a piece (of its angle, its parameter): to tell the two
    pieces of a seam from other pieces."""
    curve, p0, p1 = piece["curve"], piece["p0"], piece["p1"]
    kind = curve["kind"]
    if kind in ("circle", "ellipse"):
        o, z, x = curve["origin"], curve["z"], curve["x"]
        y = np.cross(z, x)
        r1, r2 = (curve["radius"],) * 2 if kind == "circle" else (curve["r1"], curve["r2"])

        def angle(p: np.ndarray) -> float:
            d = p - o
            return math.atan2(float(d @ y) / r2, float(d @ x) / r1)

        a0 = angle(p0)
        a = a0 + f * ((angle(p1) - a0) % (2 * math.pi) or 2 * math.pi)
        return o + x * r1 * math.cos(a) + y * r2 * math.sin(a)
    if kind == "bspline":
        ks, p = curve["knots"], curve["degree"]
        t0, t1 = piece.get("t0", ks[p]), piece.get("t1", ks[len(ks) - p - 1])
        return bspline_point(curve, t0 + f * (t1 - t0))
    return p0 + (p1 - p0) * f


class _Faces:
    """Faces bounded by curves of their own (trimmed and bounded surfaces). Each loop's pieces
    become edges that share their vertices with their neighbours in the loop; a piece the loops
    run along twice, once each way (the seam of a closed surface), is one edge."""

    def __init__(self, resolution: float | None):
        self.resolution = resolution
        self.body = BodyData(kind="sheet", name="")
        self.colors: list[tuple[float, float, float] | None] = []
        self.names: list[str] = []
        self.labels: list[str] = []  # how a message names each face's entity

    def add(self, surface: dict[str, Any], loops: list[list[dict[str, Any]]], color: Any, name: str, label: str) -> bool:
        """A face of a surface spec bounded by loops of pieces (the outer loop first). False (and
        nothing added) for a face whose loops are all lines of length 0."""
        b = self.body
        pts = [p for loop in loops for s in loop for p in (s["p0"], s["p1"])]
        size = float(np.linalg.norm(np.ptp(np.array(pts), axis=0))) if pts else 1.0
        near = 1e-9 * max(size, 1.0) + (self.resolution or 0.0)
        # (lines of length 0 are no edges: writers close a degenerate side of a face with them)
        loops = [[s for s in loop if s["curve"]["kind"] != "line" or float(np.linalg.norm(s["p1"] - s["p0"])) > near]
                 for loop in loops]
        loops = [loop for loop in loops if loop]
        if not loops:
            return False
        near = 1e-6 * max(size, 1.0) + (self.resolution or 0.0)
        # vertices: the ends of the pieces, joined where one piece ends and the next starts
        parent: list[int] = []
        where: list[np.ndarray] = []

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def join(a: int, c: int) -> None:
            a, c = find(a), find(c)
            if a != c:
                parent[c] = a

        def new(p: np.ndarray) -> int:
            parent.append(len(parent))
            where.append(p)
            return len(parent) - 1

        uses = []  # [piece, start, end, loop, seam partner]
        for li, loop in enumerate(loops):
            first = len(uses)
            for s in loop:
                uses.append([s, new(s["p0"]), new(s["p1"]), li, None])
            for i in range(first, len(uses)):
                join(uses[i][2], uses[first + (i - first + 1) % len(loop)][1])
        # seams: a piece that runs back along another one of the face (a closed one, a circle
        # around a torus, back from its start)
        marks = [[_at(u[0], f) for f in (0.25, 0.5, 0.75)] for u in uses]

        def close(a: np.ndarray, c: np.ndarray) -> bool:
            return float(np.linalg.norm(a - c)) <= near

        for i, ui in enumerate(uses):
            si = ui[0]
            ring = close(si["p0"], si["p1"])
            for j in range(i + 1, len(uses)):
                if ui[4] is not None:
                    break
                uj = uses[j]
                sj = uj[0]
                if uj[4] is not None or sj["curve"]["kind"] != si["curve"]["kind"]:
                    continue
                if ring:
                    same = (close(sj["p0"], sj["p1"]) and close(si["p0"], sj["p0"])
                            and close(marks[i][0], marks[j][2]) and close(marks[i][2], marks[j][0]))
                else:
                    same = close(si["p0"], sj["p1"]) and close(si["p1"], sj["p0"]) and close(marks[i][1], marks[j][1])
                if same:
                    ui[4], uj[4] = j, i
                    join(ui[1], uj[2])
                    join(ui[2], uj[1])
        ids: dict[int, int] = {}
        groups: dict[int, list[np.ndarray]] = {}
        for k in range(len(parent)):
            groups.setdefault(find(k), []).append(where[k])

        def vertex(k: int) -> int:
            r = find(k)
            if r not in ids:
                ids[r] = len(b.vertices)
                b.vertices.append(tuple(np.mean(groups[r], axis=0)))
            return ids[r]

        edge_of: dict[int, int] = {}
        out: list[dict[str, Any]] = [{"edges": [], "outer": li == 0} for li in range(len(loops))]
        for i, (s, v0, v1, li, partner) in enumerate(uses):
            if partner is not None and partner in edge_of:
                out[li]["edges"].append((edge_of[partner], False))
                continue
            b.curves.append(s["curve"])
            b.edges.append({"curve": len(b.curves) - 1, "v0": vertex(v0), "v1": vertex(v1), "same_sense": True})
            edge_of[i] = len(b.edges) - 1
            out[li]["edges"].append((len(b.edges) - 1, True))
        b.surfaces.append(surface)
        # (a face of a trimmed surface faces the way its surface's normal does)
        b.faces.append({"surface": len(b.surfaces) - 1, "same_sense": surface.get("sense", 1.0) > 0, "loops": out,
                        "name": name})
        self.colors.append(color)
        self.names.append(name)
        self.labels.append(label)
        return True


@dataclass
class IgesModel:
    """What a file holds that becomes bodies: its solids and shells (186, 514), the faces of its
    trimmed and bounded surfaces (which share no edges: the importer stitches them) with each
    face's color, name and label (its entity, for messages), and its untrimmed B-spline surfaces
    (surface spec, parameter range, color, name, label)."""

    solids: list[BodyData]
    faces: BodyData
    face_colors: list[tuple[float, float, float] | None]
    face_names: list[str]
    face_labels: list[str]
    untrimmed: list[tuple[dict[str, Any], tuple[float, float, float, float], Any, str, str]]


def _shell(it: _Interp, de: int, M: np.ndarray, b: BodyData, vmap: dict[tuple[int, int], int],
           emap: dict[tuple[int, int], int], reversed_: bool) -> None:
    """A shell (514) of a solid into ``b``: its faces (510), their loops (508), edges (504) and
    vertices (502)."""
    sh = it.get(de, 514)
    Ms = it.placed(sh, M)
    n = it.ints(sh, 0, 1)[0]
    faces = []
    for k in range(n):
        fde, of = it.ints(sh, 1 + 2 * k, 2)
        fe = it.get(fde, 510)
        Mf = it.placed(fe, Ms)
        sde, nl, outer = it.ints(fe, 0, 3)
        loops = []
        for li, lde in enumerate(it.ints(fe, 3, nl)):
            le = it.get(lde, 508)
            Ml = it.placed(le, Mf)
            at, items, single = 1, [], None
            for _ in range(it.ints(le, 0, 1)[0]):
                typ, ede, ndx, eof, kk = it.ints(le, at, 5)
                at += 5 + 2 * kk
                if typ == 1:  # a vertex
                    single = _vertex(it, ede, ndx, Ml, b, vmap)
                else:
                    items.append((_edge(it, ede, ndx, Ml, b, vmap, emap), eof == 1))
            if items:
                # (a loop runs counterclockwise about the surface's normal; STEP's, which the builder
                # takes, about the face's)
                if of != 1:
                    items = [(ei, not fwd) for ei, fwd in reversed(items)]
                loops.append({"edges": items, "outer": bool(outer) and li == 0})
            elif single is not None:
                loops.append({"vertex": single, "outer": False})
        surface = it.surface(sde, Mf)
        b.surfaces.append(surface)
        faces.append(len(b.faces))
        b.faces.append({"surface": len(b.surfaces) - 1, "same_sense": (of == 1) == (surface.get("sense", 1.0) > 0),
                        "loops": loops, "name": it.name(fe, 3 + nl)})
    b.shells.append({"faces": faces, "reversed": reversed_, "closed": sh.form != 2})


def _vertex(it: _Interp, de: int, ndx: int, M: np.ndarray, b: BodyData, vmap: dict[tuple[int, int], int]) -> int:
    if (de, ndx) not in vmap:
        e = it.get(de, 502)
        n = it.ints(e, 0, 1)[0]
        if not 1 <= ndx <= n:
            raise ValueError(f"IGES: vertex {ndx} of the vertex list at DE {de}, which has {n}")
        vmap[(de, ndx)] = len(b.vertices)
        b.vertices.append(tuple(it.P(it.placed(e, M), it.nums(e, 1 + 3 * (ndx - 1), 3))))
    return vmap[(de, ndx)]


def _edge(it: _Interp, de: int, ndx: int, M: np.ndarray, b: BodyData, vmap: dict[tuple[int, int], int],
          emap: dict[tuple[int, int], int]) -> int:
    if (de, ndx) not in emap:
        e = it.get(de, 504)
        Me = it.placed(e, M)
        n = it.ints(e, 0, 1)[0]
        if not 1 <= ndx <= n:
            raise ValueError(f"IGES: edge {ndx} of the edge list at DE {de}, which has {n}")
        cde, svp, sv, tvp, tv = it.ints(e, 1 + 5 * (ndx - 1), 5)
        segs = it.segments(cde, Me)
        if len(segs) != 1:
            raise NotImplementedError(f"a composite curve (DE {cde}) as the curve of an edge")
        v0, v1 = _vertex(it, svp, sv, Me, b, vmap), _vertex(it, tvp, tv, Me, b, vmap)
        b.curves.append(segs[0]["curve"])
        emap[(de, ndx)] = len(b.edges)
        b.edges.append({"curve": len(b.curves) - 1, "v0": v0, "v1": v1, "same_sense": True})
    return emap[(de, ndx)]


def _on_surface(it: _Interp, de: int, M: np.ndarray, surface: dict[str, Any]) -> list[dict[str, Any]]:
    """The pieces of a curve on a surface (142): its model-space curve, or where the file gives
    only the curve in the surface's parameters (on a B-spline surface), that curve on the
    surface."""
    e = it.get(de)
    if e.type != 142:  # (some writers point at the curve itself)
        return it.segments(de, M)
    bptr, cptr = it.ints(e, 2, 2)
    if cptr:
        return it.segments(cptr, it.placed(e, M))
    if not bptr:
        raise ValueError(f"IGES: the curve on a surface at DE {de} has no curve")
    if surface["kind"] != "bspline":
        raise NotImplementedError(f"a boundary given in the parameters of a {surface['kind']} only (no model-space "
                                  "curve)")
    poles = np.asarray(surface["poles"])
    tol = max(it.resolution or 0.0, 1e-6 * float(np.linalg.norm(np.ptp(poles, axis=0))))
    out = []
    for s in it.segments(bptr, np.eye(4)):  # (in the parameters: no units)
        c = s["curve"]
        if c["kind"] == "line":
            uv = {"degree": 1, "poles": [s["p0"], s["p1"]], "knots": [0.0, 0.0, 1.0, 1.0], "weights": None}
        elif c["kind"] == "bspline":
            uv = dict(c, range=[s.get("t0", 0.0), s.get("t1", 0.0)])
        else:
            raise NotImplementedError(f"a {c['kind']} in the parameters of a surface")
        with kernel_call("import IGES"):
            d = ext.curve_on_surface(surface, uv, tol)
        spec = {"kind": "bspline", "degree": d["degree"], "poles": np.asarray(d["poles"], dtype=float),
                "knots": list(d["knots"]), "weights": d["weights"]}
        ks = spec["knots"]
        t0, t1 = ks[spec["degree"]], ks[len(ks) - spec["degree"] - 1]
        out.append({"curve": spec, "p0": bspline_point(spec, t0), "p1": bspline_point(spec, t1), "t0": t0, "t1": t1})
    return out


def _boundary(it: _Interp, de: int, M: np.ndarray) -> list[dict[str, Any]]:
    """The pieces of a boundary (141), each the way the boundary runs."""
    e = it.get(de, 141)
    Mb = it.placed(e, M)
    at = 4
    out: list[dict[str, Any]] = []
    for _ in range(it.ints(e, 3, 1)[0]):
        cde, sense, k = it.ints(e, at, 3)
        at += 3 + k
        segs = it.segments(cde, Mb)
        out += [_reversed(s) for s in reversed(segs)] if sense == 2 else segs
    return out


def _reversed(s: dict[str, Any]) -> dict[str, Any]:
    """A piece run the other way."""
    c = s["curve"]
    if c["kind"] == "line":
        c = dict(c, origin=s["p1"], direction=s["p0"] - s["p1"])
    elif c["kind"] in ("circle", "ellipse"):
        c = dict(c, z=-c["z"], x=c["x"])
    elif c["kind"] == "bspline":
        lo, hi = c["knots"][0], c["knots"][-1]
        c = dict(c, poles=np.asarray(c["poles"])[::-1], knots=[lo + hi - k for k in reversed(c["knots"])],
                 weights=None if c["weights"] is None else list(reversed(c["weights"])))
    else:
        raise NotImplementedError(f"a {c['kind']} that a boundary runs along backwards")
    return {"curve": c, "p0": s["p1"], "p1": s["p0"]}


def _own(e: Entity) -> int | None:
    """How many parameters of its own an entity has (the property pointers follow them)."""
    p = e.params
    try:
        if e.type == 144:
            return 4 + int(p[2])
        if e.type == 143:
            return 3 + int(p[2])
        if e.type == 108:
            return 9
        if e.type == 186:
            return 3 + 2 * int(p[2])
        if e.type == 128:
            k1, k2, m1, m2 = (int(x) for x in p[:4])
            return 9 + (k1 + m1 + 2) + (k2 + m2 + 2) + 4 * (k1 + 1) * (k2 + 1) + 4
    except (TypeError, ValueError, IndexError):
        return None
    return None


def _references(f: IgesFile) -> set[int]:
    """The entities the containers the reader knows point at (a solid's shells, a shell's faces,
    the surfaces of faces, the members of subfigures): they are not bodies or faces of their
    own, whatever their status says."""
    refs: set[int] = set()
    for e in f.entities.values():
        p = [x for x in e.params]
        try:
            if e.type == 186:
                refs.add(int(p[0]))
                refs.update(int(x) for x in p[3:3 + 2 * int(p[2]):2])
            elif e.type == 514:
                refs.update(int(x) for x in p[1:1 + 2 * int(p[0]):2])
            elif e.type in (510, 144, 140):
                refs.add(int(p[0] if e.type != 140 else p[4]))
            elif e.type in (143, 142, 141):
                refs.add(int(p[1] if e.type != 141 else p[2]))
            elif e.type == 308:
                refs.update(int(x) for x in p[3:3 + int(p[2])])
            elif e.type == 408:
                refs.add(int(p[0]))
        except (TypeError, ValueError, IndexError):
            continue
    return refs


def interpret(f: IgesFile, *, skipped: list[dict[str, Any]] | None = None) -> IgesModel:
    """The bodies and faces of the file: its solids, shells, trimmed and bounded surfaces and
    the B-spline surfaces no face is made of, and those of the subfigures it places (408), each
    where the instance puts it. (Entities that are parts of others are read as such.)

    An entity that cannot be read (one the reader does not know, a malformed one) raises,
    unless a list is given as ``skipped``: then it is left out and the list gets
    ``{"name", "entity", "message"}`` for it."""
    it = _Interp(f)
    model = IgesModel([], BodyData(kind="sheet", name=""), [], [], [], [])
    faces = _Faces(it.resolution)
    refs = _references(f)

    def failed(e: Entity, name: str, err: BaseException) -> None:
        if skipped is None:
            raise err
        why = f"{err}, which is not supported" if isinstance(err, NotImplementedError) else (str(err) or type(err).__name__)
        skipped.append({"name": name, "entity": e.de, "message": f"{entity_label(e, name)}: {why}"})

    def read(e: Entity, M: np.ndarray, depth: int = 0) -> None:
        name = it.name(e, _own(e))
        try:
            if e.type == 408:  # a subfigure (308) placed: moved by X, Y, Z and scaled by S
                if depth > 16:
                    raise ValueError("IGES: subfigures place each other in a circle")
                sub = it.get(it.ints(e, 0, 1)[0], 308)
                x, y, z = it.nums(e, 1, 3)
                sc = it.nums(e, 4, 1)[0] if len(e.params) > 4 and e.params[4] not in (None, 0) else 1.0
                Mi = it.placed(e, M) @ np.array([[sc, 0, 0, x], [0, sc, 0, y], [0, 0, sc, z], [0, 0, 0, 1.0]])
                Ms = it.placed(sub, Mi)
                for member in it.ints(sub, 3, it.ints(sub, 2, 1)[0]):
                    m = f.entities.get(member)
                    if m is not None and m.type in _READ:
                        read(m, Ms, depth + 1)
                return
            if e.type in (186, 514):
                b = BodyData(kind="solid" if e.type == 186 else "sheet", name=name)
                Mb = it.placed(e, M)
                vmap: dict[tuple[int, int], int] = {}
                emap: dict[tuple[int, int], int] = {}
                if e.type == 186:
                    shell_de, sof, nv = it.ints(e, 0, 3)
                    _shell(it, shell_de, Mb, b, vmap, emap, sof != 1)
                    for k in range(nv):
                        vde, vof = it.ints(e, 3 + 2 * k, 2)
                        _shell(it, vde, Mb, b, vmap, emap, vof != 1)
                else:  # a shell of no solid: a sheet
                    _shell(it, e.de, M, b, vmap, emap, False)
                    b.shells[0]["closed"] = False
                b.color, b.entity, b.uncertainty = it.color(e), e.de, it.resolution
                model.solids.append(b)
                return
            Mf = it.placed(e, M)
            if e.type == 144:
                sde, n1, n2, pto = it.ints(e, 0, 4)
                if n1 == 0 or not pto:
                    if n2:
                        raise NotImplementedError("a trimmed surface with holes in the whole of its surface")
                    model.untrimmed.append(_untrimmed(it, it.get(sde), Mf, it.color(e), name, entity_label(e, name)))
                    return
                surface = it.surface(sde, Mf)
                loops = [_on_surface(it, d, Mf, surface) for d in [pto] + it.ints(e, 4, n2)]
            elif e.type == 143:
                sde, n = it.ints(e, 1, 2)
                surface = it.surface(sde, Mf)
                loops = [_boundary(it, d, Mf) for d in it.ints(e, 3, n)]
            elif e.type == 108:
                surface = it.surface(e.de, M)
                loops = [it.segments(it.ints(e, 4, 1)[0], Mf)]
            else:  # a B-spline surface on its own: a face of all of it
                model.untrimmed.append(_untrimmed(it, e, M, it.color(e), name, entity_label(e, name)))
                return
            faces.add(surface, loops, it.color(e), name, entity_label(e, name))
        except _BODY_ERRORS as err:
            failed(e, name, err)

    for e in f.entities.values():
        if e.de in refs or e.use == 5 or e.type not in _READ:
            continue
        if e.type == 108 and e.form != 1:
            continue  # (an unbounded plane is construction geometry)
        if e.type in (128, 114) and e.subordinate not in (0, 2):
            continue  # (a surface of something the reader does not know)
        read(e, it.root)
    faces.body.uncertainty = it.resolution
    model.faces, model.face_colors, model.face_names, model.face_labels = faces.body, faces.colors, faces.names, faces.labels
    return model


#: the entities that are bodies or faces (or place them)
_READ = {186, 514, 144, 143, 108, 128, 114, 408}


def entity_label(e: Entity, name: str) -> str:
    """How a message names an entity: ``trimmed surface 'Lid' (DE 25)``."""
    kind = _KINDS.get(e.type, f"entity {e.type}")
    return f"{kind} {name!r} (DE {e.de})" if name else f"{kind} DE {e.de}"


def _untrimmed(it: _Interp, e: Entity, M: np.ndarray, color: Any, name: str, label: str
               ) -> tuple[dict[str, Any], tuple[float, float, float, float], Any, str, str]:
    """A face that is the whole of a B-spline surface: its spec and the parameter range the file
    gives (where that is less than its knots)."""
    if e.type == 128:
        spec, rng = it.bspline_surface(e, it.placed(e, M))
        return spec, rng, color, name, label
    if e.type == 114:
        spec = it.spline_surface(e, it.placed(e, M))
        return spec, (spec["u_knots"][0], spec["u_knots"][-1], spec["v_knots"][0], spec["v_knots"][-1]), color, name, label
    raise NotImplementedError(f"a face that is the whole of surface entity {e.type}")
