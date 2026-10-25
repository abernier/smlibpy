"""DXF drawings in and out (ASCII DXF, pure Python).

Reading turns the curves of a drawing into exact edges: lines, circular and elliptical arcs,
NURBS splines, polylines with bulges, and the contents of inserted blocks. The curves are
joined end to end into loops, and the loops become the regions of a sketch by the even-odd rule
(a loop inside a loop is a hole, a loop inside a hole an island).

Writing produces an AutoCAD 2000 (AC1015) DXF with exact entities: LINE, ARC, CIRCLE, ELLIPSE
and SPLINE.
"""

from __future__ import annotations

import math
import os
import warnings
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Sequence

import numpy as np

from . import regions
from ._kernel import ModelingError, ext
from .geometry import Plane
from .shapes import Edge, Face, ShapeList, Sketch, Wire, _canonical_curve, _Body

__all__ = ["import_dxf", "import_dxf_wires", "export_dxf", "to_dxf", "from_dxf", "from_dxf_wires"]

#: Millimeters per drawing unit, by the code of ``$INSUNITS`` (0 is unitless).
_INSUNITS_MM = {
    1: 25.4, 2: 304.8, 3: 1_609_344.0, 4: 1.0, 5: 10.0, 6: 1000.0, 7: 1e6, 8: 25.4e-6, 9: 0.0254,
    10: 914.4, 11: 1e-7, 12: 1e-6, 13: 1e-3, 14: 100.0, 15: 1e4, 16: 1e5, 17: 1e12,
    18: 1.495978707e14, 19: 9.4607304725808e18, 20: 3.0856775814913673e19,
    21: 1200.0 / 3937.0 * 1000.0, 22: 1000.0 / 39.37, 23: 3600.0 / 3937.0 * 1000.0, 24: 6336.0 / 3937.0 * 1e6,
}
#: Unit names for ``unit=``: millimeters per unit and the ``$INSUNITS`` code.
_UNITS = {"mm": (1.0, 4), "cm": (10.0, 5), "m": (1000.0, 6), "um": (0.001, 13), "inch": (25.4, 1),
          "in": (25.4, 1), "ft": (304.8, 2)}
_UNIT_NAMES = "mm, cm, m, um, inch or ft"

_TWO_PI = 2.0 * math.pi
_SKIPPED_SILENTLY = {"SEQEND", "VERTEX", "ATTRIB", "ATTDEF", "VIEWPORT", "ENDBLK", "BLOCK"}


# =============================================================================
# Low level: group codes, sections, entities
# =============================================================================
def _file_text(path: str | os.PathLike[str]) -> str:
    p = os.fspath(path)
    if not os.path.exists(p):
        raise FileNotFoundError(p)
    with open(p, "rb") as fh:
        return _read_text(fh.read(), p)


def _data_text(data: Any, what: str) -> str:
    """The text of a drawing in memory: its text, or the bytes of its file."""
    if isinstance(data, str):
        if data.startswith("AutoCAD Binary DXF"):
            raise ValueError(f"{what}: a binary DXF; save the drawing as ASCII DXF")
        return data
    if isinstance(data, (bytes, bytearray, memoryview)):
        return _read_text(bytes(data), what)
    raise TypeError(f"{what} reads a DXF drawing as a str or bytes, not {type(data).__name__}")


def _read_text(data: bytes, label: str) -> str:
    if data.startswith(b"AutoCAD Binary DXF"):
        raise ValueError(f"{label}: a binary DXF; save the drawing as ASCII DXF")
    for enc in ("utf-8-sig", "cp1252"):  # (utf-8-sig: a byte order mark is no part of the drawing)
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _pairs(text: str) -> list[tuple[int, str]]:
    lines = text.splitlines()
    out = []
    for i in range(0, len(lines) - 1, 2):
        code = lines[i].strip()
        if not code:
            continue
        try:
            out.append((int(code), lines[i + 1].strip()))
        except ValueError:
            raise ValueError(f"not a DXF file (line {i + 1}: {code[:40]!r} is not a group code)") from None
    return out


def _sections(pairs: list[tuple[int, str]]) -> dict[str, list[tuple[int, str]]]:
    out: dict[str, list[tuple[int, str]]] = {}
    i = 0
    n = len(pairs)
    while i < n:
        if pairs[i] == (0, "SECTION") and i + 1 < n and pairs[i + 1][0] == 2:
            name = pairs[i + 1][1].upper()
            j = i + 2
            while j < n and pairs[j] != (0, "ENDSEC"):
                j += 1
            out[name] = pairs[i + 2:j]
            i = j + 1
        else:
            i += 1
    if not out and pairs and pairs[0][0] == 0:
        out["ENTITIES"] = pairs  # a bare list of entities
    return out


@dataclass
class _Entity:
    kind: str
    tags: list[tuple[int, str]]
    children: list[_Entity] = field(default_factory=list)  # VERTEX entities of a POLYLINE

    def get(self, code: int, default: Any = None) -> Any:
        for c, v in self.tags:
            if c == code:
                return v
        return default

    def num(self, code: int, default: float = 0.0) -> float:
        v = self.get(code)
        return float(v) if v is not None else default

    def integer(self, code: int, default: int = 0) -> int:
        v = self.get(code)
        return int(float(v)) if v is not None else default

    def point(self, code: int, default: Sequence[float] = (0.0, 0.0, 0.0)) -> np.ndarray:
        return np.array([self.num(code, default[0]), self.num(code + 10, default[1]), self.num(code + 20, default[2])])

    @property
    def layer(self) -> str:
        return str(self.get(8, "0"))

    @property
    def extrusion(self) -> np.ndarray:
        return self.point(210, (0.0, 0.0, 1.0))


def _entities(pairs: list[tuple[int, str]]) -> list[_Entity]:
    out: list[_Entity] = []
    current: _Entity | None = None
    for code, value in pairs:
        if code == 0:
            current = _Entity(value.upper(), [])
            out.append(current)
        elif current is not None:
            current.tags.append((code, value))
    # VERTEX ... SEQEND belong to the POLYLINE before them
    grouped: list[_Entity] = []
    owner: _Entity | None = None
    for e in out:
        if e.kind == "POLYLINE":
            owner = e
            grouped.append(e)
        elif e.kind == "VERTEX" and owner is not None:
            owner.children.append(e)
        elif e.kind == "SEQEND":
            owner = None
        else:
            grouped.append(e)
    return grouped


def _blocks(pairs: list[tuple[int, str]]) -> dict[str, tuple[np.ndarray, list[_Entity]]]:
    out: dict[str, tuple[np.ndarray, list[_Entity]]] = {}
    name, base, body = None, np.zeros(3), []
    for e in _entities(pairs):
        if e.kind == "BLOCK":
            name, base, body = str(e.get(2, "")), e.point(10), []
        elif e.kind == "ENDBLK":
            if name is not None:
                out[name.upper()] = (base, body)
            name = None
        elif name is not None:
            body.append(e)
    return out


# =============================================================================
# Curves of the drawing (exact, before they become kernel edges)
# =============================================================================
def _ocs(normal: np.ndarray) -> np.ndarray:
    """3x3 matrix from object coordinates to world coordinates (the arbitrary axis algorithm)."""
    n = normal / np.linalg.norm(normal)
    if abs(n[0]) < 1.0 / 64.0 and abs(n[1]) < 1.0 / 64.0:
        ax = np.cross([0.0, 1.0, 0.0], n)
    else:
        ax = np.cross([0.0, 0.0, 1.0], n)
    ax /= np.linalg.norm(ax)
    ay = np.cross(n, ax)
    ay /= np.linalg.norm(ay)
    return np.column_stack([ax, ay, n])


@dataclass
class _Curve:
    """One curve of the drawing in millimeters: a line ``(a, b)``, a conic
    ``(center, u, v, t0, t1)`` with points ``center + u cos t + v sin t`` (circles, ellipses and
    their affine images), or a spline ``(degree, knots, poles, weights)``."""

    kind: str
    data: tuple
    layer: str

    def start(self) -> np.ndarray:
        if self.kind == "line":
            return self.data[0]
        if self.kind == "conic":
            c, u, v, t0, _ = self.data
            return c + u * math.cos(t0) + v * math.sin(t0)
        return self.data[2][0]

    def end(self) -> np.ndarray:
        if self.kind == "line":
            return self.data[1]
        if self.kind == "conic":
            c, u, v, _, t1 = self.data
            return c + u * math.cos(t1) + v * math.sin(t1)
        return self.data[2][-1]

    @property
    def closed(self) -> bool:
        if self.kind == "conic":
            return self.data[4] - self.data[3] >= _TWO_PI - 1e-12
        return False

    def transformed(self, m: np.ndarray) -> _Curve:
        lin, t = m[:3, :3], m[:3, 3]
        if self.kind == "line":
            return _Curve("line", (lin @ self.data[0] + t, lin @ self.data[1] + t), self.layer)
        if self.kind == "conic":
            c, u, v, t0, t1 = self.data
            return _Curve("conic", (lin @ c + t, lin @ u, lin @ v, t0, t1), self.layer)
        deg, knots, poles, weights = self.data
        return _Curve("spline", (deg, knots, poles @ lin.T + t, weights), self.layer)

    def scaled(self, f: float) -> _Curve:
        m = np.eye(4)
        m[:3, :3] *= f
        return self.transformed(m)


def _arc_curve(center_ocs: np.ndarray, radius: float, a0: float, a1: float, normal: np.ndarray,
               layer: str, full: bool = False) -> _Curve:
    """A circular arc in object coordinates (angles in radians, counterclockwise)."""
    m = _ocs(normal)
    c = m @ center_ocs
    u, v = m[:, 0] * radius, m[:, 1] * radius
    if full:
        return _Curve("conic", (c, u, v, 0.0, _TWO_PI), layer)
    while a1 <= a0:
        a1 += _TWO_PI
    return _Curve("conic", (c, u, v, a0, a1), layer)


def _bulge_arc(p0: np.ndarray, p1: np.ndarray, bulge: float, m: np.ndarray, layer: str) -> _Curve:
    """The arc between two polyline vertices (object coordinates) with a bulge (tan of a quarter
    of the included angle, positive counterclockwise)."""
    chord = p1[:2] - p0[:2]
    d = float(np.hypot(*chord))
    theta = 4.0 * math.atan(bulge)  # signed included angle
    r = d / (2.0 * math.sin(abs(theta) / 2.0))
    mid = (p0[:2] + p1[:2]) / 2.0
    # the center lies on the chord's bisector, left of the chord for a counterclockwise arc of
    # less than 180 degrees
    left = np.array([-chord[1], chord[0]]) / d
    h = r * math.cos(abs(theta) / 2.0)  # negative beyond a half circle: the center is on the other side
    center = mid + left * h * (1.0 if bulge > 0 else -1.0)
    a0 = math.atan2(p0[1] - center[1], p0[0] - center[0])
    a1 = math.atan2(p1[1] - center[1], p1[0] - center[0])
    z = p0[2]
    c = m @ np.array([center[0], center[1], z])
    u, v = m[:, 0] * r, m[:, 1] * r
    if bulge > 0:
        while a1 <= a0:
            a1 += _TWO_PI
        return _Curve("conic", (c, u, v, a0, a1), layer)
    # clockwise from p0 to p1: the angle decreases; with v mirrored the parameter -angle increases
    while a0 <= a1:
        a0 += _TWO_PI
    return _Curve("conic", (c, u, -v, -a0, -a1), layer)


def _polyline(vertices: list[tuple[np.ndarray, float]], closed: bool, m: np.ndarray, layer: str) -> list[_Curve]:
    out: list[_Curve] = []
    n = len(vertices)
    for i in range(n if closed else n - 1):
        (p0, bulge), (p1, _) = vertices[i], vertices[(i + 1) % n]
        if np.allclose(p0[:2], p1[:2], rtol=0, atol=1e-12):
            continue
        if abs(bulge) > 1e-12:
            out.append(_bulge_arc(p0, p1, bulge, m, layer))
        else:
            out.append(_Curve("line", (m @ p0, m @ p1), layer))
    return out


def _spline_curve(e: _Entity, layer: str) -> _Curve | None:
    flags = e.integer(70)
    deg = e.integer(71, 3)
    knots: list[float] = []
    weights: list[float] = []
    poles: list[list[float]] = []
    fit: list[list[float]] = []
    tangents: dict[int, list[float]] = {}
    for code, value in e.tags:
        if code == 40:
            knots.append(float(value))
        elif code == 41:
            weights.append(float(value))
        elif code == 10:
            poles.append([float(value), 0.0, 0.0])
        elif code == 20 and poles:
            poles[-1][1] = float(value)
        elif code == 30 and poles:
            poles[-1][2] = float(value)
        elif code == 11:
            fit.append([float(value), 0.0, 0.0])
        elif code == 21 and fit:
            fit[-1][1] = float(value)
        elif code == 31 and fit:
            fit[-1][2] = float(value)
        elif code in (12, 13):
            tangents[code] = [float(value), 0.0, 0.0]
        elif code in (22, 23, 32, 33) and (10 + code % 10) in tangents:
            tangents[10 + code % 10][1 if code < 30 else 2] = float(value)
    if poles:
        P = np.array(poles, dtype=float)
        if len(knots) != len(P) + deg + 1:
            raise ValueError(f"a SPLINE has {len(knots)} knots for {len(P)} control points of degree {deg}")
        W = np.array(weights, dtype=float) if weights and len(weights) == len(P) and np.ptp(weights) > 0 else None
        if flags & 2 or knots[deg] != knots[0] or knots[-deg - 1] != knots[-1]:
            P, knots, W = _clamped(P, list(knots), deg, W)
        return _Curve("spline", (deg, np.array(knots, dtype=float), P, W), layer)
    if len(fit) >= 2:  # only fit points: interpolate them (the drawing program's own fit may differ)
        from .curves import Spline

        t = (tangents.get(12), tangents.get(13)) if tangents else None
        edge = Spline(*[tuple(p) for p in fit], tangents=t, closed=bool(flags & 1) and len(fit) > 2)
        d = ext.curve_data(edge._curve())
        return _Curve("spline", (int(d["degree"]), np.array(d["knots"], dtype=float), np.array(d["poles"], dtype=float),
                                 None if d["weights"] is None else np.array(d["weights"], dtype=float)), layer)
    return None


def _clamped(P: np.ndarray, knots: list[float], deg: int, W: np.ndarray | None) -> tuple[np.ndarray, list[float], Any]:
    """The same curve with a clamped knot vector: knots are inserted at both ends of the domain
    until they have full multiplicity, and what lies outside the domain is dropped."""
    H = np.hstack([P * W[:, None], W[:, None]]) if W is not None else P.copy()
    lo, hi = knots[deg], knots[-deg - 1]

    def same(a: float, b: float) -> bool:
        return abs(a - b) <= 1e-14 * max(1.0, abs(b))

    for u in (lo, hi):
        while sum(1 for x in knots if same(x, u)) < deg:
            H, knots = _insert_knot(H, knots, deg, u)
    first = next(i for i, x in enumerate(knots) if same(x, lo))
    m = sum(1 for x in knots if same(x, lo))
    s = first + m - 1 - deg  # the point at a knot of full multiplicity is this control point
    inner = [x for x in knots if lo < x < hi and not same(x, lo) and not same(x, hi)]
    new_knots = [lo] * (deg + 1) + inner + [hi] * (deg + 1)
    H = H[s:s + len(new_knots) - deg - 1]
    if W is not None:
        w = H[:, 3]
        return H[:, :3] / w[:, None], new_knots, w
    return H, new_knots, None


def _insert_knot(H: np.ndarray, knots: list[float], deg: int, u: float) -> tuple[np.ndarray, list[float]]:
    k = max(i for i in range(len(knots) - 1) if knots[i] <= u)
    k = min(k, len(H) - 1)
    Q = np.zeros((len(H) + 1, H.shape[1]))
    for i in range(len(H) + 1):
        if i <= k - deg:
            Q[i] = H[i]
        elif i > k:
            Q[i] = H[i - 1]
        else:
            a = (u - knots[i]) / (knots[i + deg] - knots[i])
            Q[i] = (1 - a) * H[i - 1] + a * H[i]
    return Q, knots[:k + 1] + [u] + knots[k + 1:]


@dataclass
class _Drawing:
    curves: list[_Curve]  # in millimeters
    skipped: dict[str, int]  # entities that are not curves, by type
    layers: set[str]


def _read(text: str, unit: str | None) -> _Drawing:
    sections = _sections(_pairs(text))
    header = sections.get("HEADER", [])
    insunits = 0
    for i, (code, value) in enumerate(header):
        if code == 9 and value.upper() == "$INSUNITS" and i + 1 < len(header):
            insunits = int(float(header[i + 1][1]))
    if unit is not None:
        if unit not in _UNITS:
            raise ValueError(f"unknown unit {unit!r}; use {_UNIT_NAMES}")
        mm = _UNITS[unit][0]
    else:
        mm = _INSUNITS_MM.get(insunits, 1.0)  # unitless: millimeters
    layers: set[str] = set()
    for e in _entities(sections.get("TABLES", [])):
        if e.kind == "LAYER" and e.get(2) is not None:
            layers.add(str(e.get(2)))
    blocks = _blocks(sections.get("BLOCKS", []))
    skipped: dict[str, int] = {}
    curves: list[_Curve] = []
    _collect(_entities(sections.get("ENTITIES", [])), np.eye(4), None, blocks, curves, skipped, layers, 0)
    if mm != 1.0:
        curves = [c.scaled(mm) for c in curves]
    return _Drawing(curves, skipped, layers)


def _collect(entities: list[_Entity], m: np.ndarray, insert_layer: str | None,
             blocks: dict[str, tuple[np.ndarray, list[_Entity]]], out: list[_Curve], skipped: dict[str, int],
             layers: set[str], depth: int) -> None:
    for e in entities:
        if e.integer(67) == 1:  # paper space
            continue
        layer = e.layer
        if insert_layer is not None and layer == "0":
            layer = insert_layer  # entities of a block on layer 0 take the layer of the insert
        layers.add(layer)
        found = _curves_of(e, layer)
        if found is not None:
            out.extend(found if depth == 0 else [c.transformed(m) for c in found])
            continue
        if e.kind == "INSERT":
            name = str(e.get(2, "")).upper()
            if name not in blocks:
                skipped["INSERT of a missing block"] = skipped.get("INSERT of a missing block", 0) + 1
                continue
            if depth > 16:
                raise ModelingError("import_dxf: blocks nested more than 16 deep (a block that inserts itself?)")
            base, body = blocks[name]
            for im in _insert_matrices(e, base):
                _collect(body, m @ im, layer, blocks, out, skipped, layers, depth + 1)
            continue
        if e.kind not in _SKIPPED_SILENTLY:
            skipped[e.kind] = skipped.get(e.kind, 0) + 1


def _insert_matrices(e: _Entity, base: np.ndarray) -> Iterator[np.ndarray]:
    ins = e.point(10)
    sx, sy, sz = e.num(41, 1.0), e.num(42, 1.0), e.num(43, 1.0)
    rot = math.radians(e.num(50))
    cols, rows = max(1, e.integer(70, 1)), max(1, e.integer(71, 1))
    dc, dr = e.num(44), e.num(45)
    ocs = np.eye(4)
    ocs[:3, :3] = _ocs(e.extrusion)
    rz = np.eye(4)
    rz[:2, :2] = [[math.cos(rot), -math.sin(rot)], [math.sin(rot), math.cos(rot)]]
    s = np.diag([sx, sy, sz, 1.0])
    to_base = np.eye(4)
    to_base[:3, 3] = -base
    at = np.eye(4)
    at[:3, 3] = ins
    for i in range(cols):
        for j in range(rows):
            grid = np.eye(4)
            grid[:2, 3] = (i * dc, j * dr)
            yield ocs @ at @ rz @ grid @ s @ to_base


def _curves_of(e: _Entity, layer: str) -> list[_Curve] | None:
    """The curves of one entity, or None if it is not a curve entity."""
    k = e.kind
    if k == "LINE":
        a, b = e.point(10), e.point(11)
        return [] if np.allclose(a, b, rtol=0, atol=1e-12) else [_Curve("line", (a, b), layer)]
    if k in ("CIRCLE", "ARC"):
        r = e.num(40)
        if not r > 0:  # a circle without size draws nothing
            return []
        if k == "CIRCLE":
            return [_arc_curve(e.point(10), r, 0.0, _TWO_PI, e.extrusion, layer, full=True)]
        return [_arc_curve(e.point(10), r, math.radians(e.num(50)), math.radians(e.num(51)), e.extrusion, layer)]
    if k == "ELLIPSE":
        c, major, n = e.point(10), e.point(11), e.extrusion
        ratio = e.num(40, 1.0)
        t0, t1 = e.num(41, 0.0), e.num(42, _TWO_PI)
        minor = np.cross(n / np.linalg.norm(n), major) * ratio
        full = abs((t1 - t0) - _TWO_PI) < 1e-9 or abs(t1 - t0) < 1e-12
        if full:
            t0, t1 = 0.0, _TWO_PI
        while t1 <= t0:
            t1 += _TWO_PI
        return [_Curve("conic", (c, major, minor, t0, t1), layer)]
    if k == "LWPOLYLINE":
        verts: list[tuple[np.ndarray, float]] = []
        z = e.num(38)
        for code, value in e.tags:
            if code == 10:
                verts.append((np.array([float(value), 0.0, z]), 0.0))
            elif code == 20 and verts:
                verts[-1][0][1] = float(value)
            elif code == 42 and verts:
                verts[-1] = (verts[-1][0], float(value))
        return _polyline(verts, bool(e.integer(70) & 1), _ocs(e.extrusion), layer)
    if k == "POLYLINE":
        flags = e.integer(70)
        if flags & (16 | 64):  # polygon meshes and polyface meshes are surfaces
            return None
        is3d = bool(flags & 8)
        z = e.num(30)
        verts = []
        for v in e.children:
            if v.integer(70) & 16:  # spline frame control points
                continue
            p = v.point(10)
            if not is3d:
                p[2] = z
            verts.append((p, 0.0 if is3d else v.num(42)))
        m = np.eye(3) if is3d else _ocs(e.extrusion)
        return _polyline(verts, bool(flags & 1), m, layer)
    if k == "SPLINE":
        c = _spline_curve(e, layer)
        return [c] if c is not None else []
    return None


# =============================================================================
# Chains and loops
# =============================================================================
@dataclass
class _Chain:
    curves: list[tuple[int, bool]]  # curve index, reversed
    closed: bool


def _chains(curves: list[_Curve], tol: float) -> tuple[list[_Chain], list[np.ndarray], dict[int, list[tuple[int, int]]]]:
    """Join curves end to end. Returns the chains, the node points and, per node, the curve ends
    (curve, 0 = start / 1 = end) meeting there."""
    nodes: list[np.ndarray] = []
    grid: dict[tuple[int, int, int], list[int]] = {}
    cell = max(tol, 1e-12)

    def node_of(p: np.ndarray) -> int:
        key = tuple(int(math.floor(c / cell)) for c in p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for i in grid.get((key[0] + dx, key[1] + dy, key[2] + dz), []):
                        if np.linalg.norm(nodes[i] - p) <= tol:
                            return i
        nodes.append(np.array(p, dtype=float))
        grid.setdefault(key, []).append(len(nodes) - 1)  # type: ignore[arg-type]
        return len(nodes) - 1

    ends: dict[int, list[tuple[int, int]]] = {}
    at: list[tuple[int, int]] = []
    for i, c in enumerate(curves):
        if c.closed:
            at.append((-1, -1))
            continue
        a, b = node_of(c.start()), node_of(c.end())
        at.append((a, b))
        ends.setdefault(a, []).append((i, 0))
        ends.setdefault(b, []).append((i, 1))
    chains: list[_Chain] = []
    used = [False] * len(curves)
    for i, c in enumerate(curves):
        if c.closed:
            chains.append(_Chain([(i, False)], True))
            used[i] = True
    # open chains start at loose ends and at branching points
    starts = [n for n, e in ends.items() if len(e) != 2]
    for n in starts:
        for (i, which) in ends[n]:
            if used[i]:
                continue
            chains.append(_walk(i, which == 1, at, ends, used))
    for i in range(len(curves)):
        if not used[i]:
            chains.append(_walk(i, False, at, ends, used))
    return chains, nodes, ends


def _walk(i: int, rev: bool, at: list[tuple[int, int]], ends: dict[int, list[tuple[int, int]]],
          used: list[bool]) -> _Chain:
    """Follow curves from curve ``i`` (reversed or not) until the chain closes, ends or branches."""
    first_node = at[i][1] if rev else at[i][0]
    out: list[tuple[int, bool]] = []
    while True:
        used[i] = True
        out.append((i, rev))
        node = at[i][0] if rev else at[i][1]
        if node == first_node:
            return _Chain(out, True)
        here = ends[node]
        if len(here) != 2:
            return _Chain(out, False)
        nxt = [(j, w) for j, w in here if not (j == i and w == (0 if rev else 1))]
        if not nxt or used[nxt[0][0]]:
            return _Chain(out, False)
        i, which = nxt[0]
        rev = which == 1


def _snap(curves: list[_Curve], nodes: list[np.ndarray], ends: dict[int, list[tuple[int, int]]]) -> list[_Curve]:
    """Move the ends of lines and splines onto one point per node, preferring the exact end of an
    arc; arcs keep their circle and only slide their end angle to the node."""
    point = {}
    for n, items in ends.items():
        conic = [(i, w) for i, w in items if curves[i].kind == "conic"]
        if conic:
            i, w = conic[0]
            point[n] = curves[i].end() if w else curves[i].start()
        else:
            point[n] = np.mean([curves[i].end() if w else curves[i].start() for i, w in items], axis=0)
    node_at: dict[tuple[int, int], int] = {(i, w): n for n, items in ends.items() for i, w in items}
    out = []
    for i, c in enumerate(curves):
        if c.closed:
            out.append(c)
            continue
        a, b = point[node_at[(i, 0)]], point[node_at[(i, 1)]]
        if c.kind == "line":
            out.append(_Curve("line", (a, b), c.layer))
        elif c.kind == "spline":
            deg, knots, poles, weights = c.data
            poles = poles.copy()
            poles[0], poles[-1] = a, b
            out.append(_Curve("spline", (deg, knots, poles, weights), c.layer))
        else:
            cc, u, v, t0, t1 = c.data
            n0, n1 = _conic_param(c, a, t0), _conic_param(c, b, t1)
            out.append(_Curve("conic", (cc, u, v, n0, n1), c.layer))
    return out


def _conic_param(c: _Curve, p: np.ndarray, near: float) -> float:
    """The parameter of the point of a conic closest in angle to ``p``, near ``near``."""
    cc, u, v, _, _ = c.data
    A = np.column_stack([u, v])
    (cs, sn), *_ = np.linalg.lstsq(A, p - cc, rcond=None)
    t = math.atan2(sn, cs)
    return t + _TWO_PI * round((near - t) / _TWO_PI)


# =============================================================================
# Kernel edges
# =============================================================================
def _edge(c: _Curve) -> Edge:
    from .curves import CenterArc, EllipticalArc, Line

    if c.kind == "line":
        return Line(tuple(c.data[0]), tuple(c.data[1]))
    if c.kind == "spline":
        deg, knots, poles, weights = c.data
        return Edge._from_curve(_canonical_curve(poles, list(knots), int(deg), None if weights is None else list(weights)))
    center, u, v, t0, t1 = c.data
    ru, rv = float(np.linalg.norm(u)), float(np.linalg.norm(v))
    normal = np.cross(u, v)
    sweep = t1 - t0
    full = sweep >= _TWO_PI - 1e-12
    if abs(ru - rv) <= 1e-12 * max(ru, rv) and abs(float(np.dot(u, v))) <= 1e-12 * ru * rv:
        plane = Plane(tuple(center), x_dir=tuple(u), z_dir=tuple(normal))
        if full:
            return CenterArc((0, 0), ru, 0.0, 360.0, plane)
        return CenterArc((0, 0), ru, math.degrees(t0), math.degrees(sweep), plane)
    # principal axes of the ellipse from its conjugate half diameters u, v
    ts = 0.5 * math.atan2(2.0 * float(np.dot(u, v)), float(np.dot(u, u) - np.dot(v, v)))
    a = u * math.cos(ts) + v * math.sin(ts)
    b = -u * math.sin(ts) + v * math.cos(ts)
    if np.linalg.norm(a) < np.linalg.norm(b):
        a, b, ts = b, -a, ts + math.pi / 2.0
    plane = Plane(tuple(center), x_dir=tuple(a), z_dir=tuple(np.cross(a, b)))
    if full:
        return EllipticalArc((0, 0), float(np.linalg.norm(a)), float(np.linalg.norm(b)), 0.0, 360.0, plane)
    return EllipticalArc((0, 0), float(np.linalg.norm(a)), float(np.linalg.norm(b)), math.degrees(t0 - ts),
                         math.degrees(t1 - ts), plane)


def _edge_points(e: Edge, n: int) -> np.ndarray:
    """Points along an edge in its direction (uniform in the kernel parameter)."""
    t0, t1 = e._range()
    cv = e._curve()
    ts = np.linspace(t0, t1, n + 1)
    pts = np.array([cv.evaluate(float(t)) for t in ts], dtype=float)
    return pts[::-1] if e._rev else pts


def _samples_for(e: Edge) -> int:
    kind = e.geom_type
    if kind == "line":
        return 1
    if kind in ("circle", "ellipse"):
        return 64
    try:
        d = ext.curve_data(e._curve())
        return max(16, 8 * (len(d["poles"]) - d["degree"]) * max(1, d["degree"]))
    except Exception:  # pragma: no cover
        return 64


# =============================================================================
# import_dxf, import_dxf_wires
# =============================================================================
def _layered(drawing: _Drawing, layers: Iterable[str] | str | None, what: str) -> list[_Curve]:
    curves = drawing.curves
    if layers is not None:
        wanted = {layers.upper()} if isinstance(layers, str) else {str(x).upper() for x in layers}
        known = {x.upper() for x in drawing.layers}
        unknown = sorted(wanted - known)
        if unknown:
            raise ValueError(f"{what}: the drawing has no layer {', '.join(map(repr, unknown))}; its layers are "
                             + ", ".join(sorted(drawing.layers, key=str.upper)))
        curves = [c for c in curves if c.layer.upper() in wanted]
    if drawing.skipped:
        what_left = ", ".join(f"{n} {kind}" for kind, n in sorted(drawing.skipped.items()))
        warnings.warn(f"{what}: left out what is not a curve: {what_left}", stacklevel=3)
    if not curves:
        raise ModelingError(f"{what}: the drawing has no curves" + (" on these layers" if layers is not None else "")
                            + " (lines, arcs, circles, ellipses, polylines, splines or blocks of them)")
    return curves


def _default_tolerance(curves: list[_Curve]) -> float:
    pts = np.array([p for c in curves for p in (c.start(), c.end())])
    size = float(np.max(np.ptp(pts, axis=0))) if len(pts) else 1.0
    for c in curves:
        if c.kind == "conic":
            size = max(size, 2.0 * float(np.linalg.norm(c.data[1])), 2.0 * float(np.linalg.norm(c.data[2])))
    return max(1e-7 * size, 1e-9)


def _fmt(p: np.ndarray) -> str:
    return "(" + ", ".join(f"{v:.6g}" for v in (p[:2] if abs(p[2]) < 1e-9 else p)) + ")"


def _prepared(text: str, layers: Any, unit: str | None, tolerance: float | None, what: str):
    drawing = _read(text, unit)
    curves = _layered(drawing, layers, what)
    tol = float(tolerance) if tolerance is not None else _default_tolerance(curves)
    if not tol > 0:
        raise ValueError(f"{what}: tolerance must be positive")
    curves = _dedupe(curves, tol)
    chains, nodes, ends = _chains(curves, tol)
    curves = _snap(curves, nodes, ends)
    return curves, chains, nodes, ends, tol


def _dedupe(curves: list[_Curve], tol: float) -> list[_Curve]:
    """Leave out curves drawn twice (same kind, same ends, same middle)."""
    buckets: dict[tuple, list[_Curve]] = {}
    out = []
    cell = 10.0 * tol
    for c in curves:
        a, b = c.start(), c.end()
        key = tuple(sorted((tuple(np.round(a / cell).astype(int)), tuple(np.round(b / cell).astype(int)))))
        mid = _middle(c)
        twins = buckets.setdefault(key, [])
        if any(t.kind == c.kind and np.linalg.norm(_middle(t) - mid) <= tol for t in twins):
            continue
        twins.append(c)
        out.append(c)
    return out


def _middle(c: _Curve) -> np.ndarray:
    if c.kind == "line":
        return (c.data[0] + c.data[1]) / 2.0
    if c.kind == "conic":
        cc, u, v, t0, t1 = c.data
        t = (t0 + t1) / 2.0
        return cc + u * math.cos(t) + v * math.sin(t)
    deg, knots, poles, weights = c.data
    return _de_boor(poles, weights, knots, deg, (knots[0] + knots[-1]) / 2.0)


def _de_boor(poles: np.ndarray, weights: Any, knots: np.ndarray, deg: int, u: float) -> np.ndarray:
    H = np.hstack([poles * weights[:, None], weights[:, None]]) if weights is not None else poles
    n = len(H) - 1
    k = int(np.searchsorted(knots, u, side="right")) - 1
    k = min(max(k, deg), n)
    d = [H[j + k - deg].astype(float).copy() for j in range(deg + 1)]
    for r in range(1, deg + 1):
        for j in range(deg, r - 1, -1):
            den = knots[j + 1 + k - r] - knots[j + k - deg]
            a = 0.0 if den == 0 else (u - knots[j + k - deg]) / den
            d[j] = (1 - a) * d[j - 1] + a * d[j]
    out = d[deg]
    return out[:3] / out[3] if weights is not None else out


def import_dxf_wires(path: str | os.PathLike[str], *, layers: Iterable[str] | str | None = None,
                     unit: str | None = None, tolerance: float | None = None) -> ShapeList[Wire]:
    """Every chain of curves of a DXF drawing as a :class:`~smlibpy.Wire`, open or closed.

    The curves are read and joined like in :func:`import_dxf`; chains also stop where three or
    more curve ends meet. Closed chains come first, then open ones, each in drawing order.
    """
    return _wires(_file_text(path), layers, unit, tolerance, "import_dxf_wires")


def from_dxf_wires(data: str | bytes, *, layers: Iterable[str] | str | None = None, unit: str | None = None,
                   tolerance: float | None = None) -> ShapeList[Wire]:
    """:func:`import_dxf_wires` of a drawing in memory: the text of a DXF file, or its bytes."""
    return _wires(_data_text(data, "from_dxf_wires"), layers, unit, tolerance, "from_dxf_wires")


def _wires(text: str, layers: Any, unit: str | None, tolerance: float | None, what: str) -> ShapeList[Wire]:
    curves, chains, _, _, _ = _prepared(text, layers, unit, tolerance, what)
    edges = [_edge(c) for c in curves]
    wires = [Wire._raw([edges[i].reversed() if r else edges[i] for i, r in ch.curves]) for ch in chains]
    closed = [w for w, ch in zip(wires, chains) if ch.closed]
    return ShapeList(closed + [w for w, ch in zip(wires, chains) if not ch.closed])


def import_dxf(path: str | os.PathLike[str], *, layers: Iterable[str] | str | None = None,
               unit: str | None = None, tolerance: float | None = None) -> Sketch:
    """Read the outlines of a DXF drawing as a sketch.

    Lines, arcs, circles, ellipses, polylines (bulges become exact arcs), splines (exact NURBS)
    and inserted blocks are joined end to end into closed loops. Loops nest by the even-odd rule:
    a loop inside a loop is a hole, a loop inside a hole an island. The result keeps the
    drawing's coordinates, converted to millimeters.

    Args:
        path: An ASCII DXF file.
        layers: Read only these layers (names in any letter case).
        unit: The unit of the drawing (``"mm"``, ``"cm"``, ``"m"``, ``"um"``, ``"inch"``,
            ``"ft"``), instead of the file's ``$INSUNITS``. A file without a unit is read as mm.
        tolerance: Ends closer than this (mm) are joined. Default: 1e-7 of the drawing's size.

    Raises:
        ModelingError: Curves that do not close into loops (with their ends and layers), or
            outlines that branch.
    """
    return _sketch(_file_text(path), layers, unit, tolerance, "import_dxf", "import_dxf_wires")


def from_dxf(data: str | bytes, *, layers: Iterable[str] | str | None = None, unit: str | None = None,
             tolerance: float | None = None) -> Sketch:
    """:func:`import_dxf` of a drawing in memory: the text of a DXF file, or its bytes (an upload)."""
    return _sketch(_data_text(data, "from_dxf"), layers, unit, tolerance, "from_dxf", "from_dxf_wires")


def _sketch(text: str, layers: Any, unit: str | None, tolerance: float | None, what: str, wires: str) -> Sketch:
    curves, chains, nodes, ends, tol = _prepared(text, layers, unit, tolerance, what)
    branches = [n for n, items in ends.items() if len(items) > 2]
    if branches:
        where = "; ".join(f"{len(ends[n])} curve ends at {_fmt(nodes[n])}" for n in branches[:5])
        raise ModelingError(f"{what}: the outline branches ({where}); a loop needs exactly two curve ends at "
                            "each corner. Pick the layers of the outline with layers=[...], or read every curve "
                            f"with {wires}()")
    open_chains = [ch for ch in chains if not ch.closed]
    if open_chains:
        loose = [n for n, items in ends.items() if len(items) == 1]
        parts = []
        for ch in open_chains[:5]:
            a = curves[ch.curves[0][0]].end() if ch.curves[0][1] else curves[ch.curves[0][0]].start()
            b = curves[ch.curves[-1][0]].start() if ch.curves[-1][1] else curves[ch.curves[-1][0]].end()
            layer = curves[ch.curves[0][0]].layer
            gap = min((float(np.linalg.norm(nodes[m] - a)) for m in loose if np.linalg.norm(nodes[m] - a) > tol),
                      default=None)
            parts.append(f"{len(ch.curves)} curve{'s' if len(ch.curves) > 1 else ''} from {_fmt(a)} to {_fmt(b)} on "
                         f"layer {layer!r}" + (f" (the nearest other loose end is {gap:.3g} mm away)" if gap else ""))
        more = f" and {len(open_chains) - 5} more" if len(open_chains) > 5 else ""
        count = "1 chain of curves does" if len(open_chains) == 1 else f"{len(open_chains)} chains of curves do"
        raise ModelingError(f"{what}: {count} not close: {'; '.join(parts)}{more}. Pick the layers of the outline with "
                            "layers=[...], join small gaps with tolerance=..., or read every curve with "
                            f"{wires}()")
    edges = [_edge(c) for c in curves]
    loops: list[list[Edge]] = [[edges[i].reversed() if r else edges[i] for i, r in ch.curves] for ch in chains]
    polys = []
    zs = []
    for loop in loops:
        pts = np.vstack([_edge_points(e, _samples_for(e))[:-1] for e in loop])
        polys.append(pts[:, :2])
        zs.append(pts[:, 2])
    z = np.concatenate(zs)
    span = float(np.ptp(z))
    size = max(float(np.max(np.ptp(np.vstack(polys), axis=0))), 1e-9)
    if span > 1e-7 * size:
        raise ModelingError(f"{what}: the outlines are not in one plane parallel to XY (z from {z.min():.6g} to "
                            f"{z.max():.6g}); a sketch needs a flat drawing")
    plane = Plane.XY if abs(float(z.mean())) <= 1e-9 * size else Plane.XY.offset(float(z.mean()))
    p = regions.plan(polys, "evenodd")
    return regions.build(p, lambda i: [e._copy_curve() for e in loops[i]], plane, what,
                         "the loops must not cross themselves")


# =============================================================================
# export_dxf
# =============================================================================
def export_dxf(shapes: Any, path: str | os.PathLike[str], *, unit: str = "mm", plane: Plane | None = None,
               curves: str = "exact", tolerance: float = 0.01) -> None:
    """Write sketches, faces, wires and edges to a DXF drawing (AutoCAD 2000, AC1015).

    Every curve is written exactly: LINE, ARC, CIRCLE, ELLIPSE, or SPLINE with the kernel's
    control points, knots and weights. Circular B-splines (the edges of sections) are written as
    ARC and CIRCLE, straight ones as LINE. A shape's name becomes its layer. The views of
    :func:`drawing_views` go on the layers VISIBLE and HIDDEN, the hidden lines dashed (the
    linetype DASHED: 3 mm dashes, 1.5 mm gaps).

    Args:
        shapes: A ``Sketch``, ``Face``, ``Wire``, ``Edge``, ``DrawingView`` or a list of them.
        path: The file to write.
        unit: Unit of the file: ``"mm"`` (default), ``"cm"``, ``"m"``, ``"um"``, ``"inch"`` or
            ``"ft"``. The model (in mm) is converted to it and ``$INSUNITS`` says so.
        plane: The plane of the drawing; the shapes are written in its coordinates and must lie
            in planes parallel to it. Default: the world XY plane when the shapes are parallel
            to it, otherwise the plane of the first sketch (a section in ``Plane.XZ`` is drawn in
            that plane's coordinates).
        curves: ``"exact"`` (default) writes splines and ellipses as SPLINE and ELLIPSE;
            ``"arcs"`` writes them as LINE and ARC within ``tolerance`` (:meth:`Edge.to_arcs`),
            for CNC, laser and plasma software that reads only lines and arcs.
        tolerance: For ``curves="arcs"``: the largest distance between a curve and its lines and
            arcs, in millimeters (the model's unit).
    """
    text = _dxf(shapes, unit, plane, "export_dxf", curves, tolerance)
    with open(os.fspath(path), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def to_dxf(shapes: Any, *, unit: str = "mm", plane: Plane | None = None, curves: str = "exact",
           tolerance: float = 0.01) -> str:
    """The text of a DXF drawing (AutoCAD 2000, AC1015) of sketches, faces, wires and edges, as
    :func:`export_dxf` writes it; ``unit``, ``plane``, ``curves`` and ``tolerance`` as there."""
    return _dxf(shapes, unit, plane, "to_dxf", curves, tolerance)


def _dxf(shapes: Any, unit: str, plane: Plane | None, what: str, curves: str = "exact",
         tolerance: float = 0.01) -> str:
    if unit not in _UNITS:
        raise ValueError(f"unknown unit {unit!r}; use {_UNIT_NAMES}")
    if curves not in ("exact", "arcs"):
        raise ValueError(f"{what}: curves is 'exact' or 'arcs', not {curves!r}")
    if not (isinstance(tolerance, (int, float)) and math.isfinite(tolerance) and tolerance > 0):
        raise ValueError(f"{what}: the tolerance must be positive, got {tolerance!r}")
    mm_per_unit, code = _UNITS[unit]
    items = _drawable(shapes, what)
    if not items:
        raise ValueError(f"{what}: nothing to write")
    frame = _frame(items, plane)
    o = np.array(frame.origin.to_tuple())
    x_dir, y_dir, n = (np.array(v.to_tuple()) for v in (frame.x_dir, frame.y_dir, frame.z_dir))
    f = 1.0 / mm_per_unit

    def local(p: Any) -> np.ndarray:
        d = np.asarray(p, dtype=float) - o
        return np.array([d @ x_dir, d @ y_dir]) * f

    w = _Writer()
    w.dash = (3.0 * f, 1.5 * f)
    for item in items:
        for loop in item.loops:
            if curves == "arcs":
                loop = [p for e in loop for p in _as_arcs(e, float(tolerance))]
            for ent in _merge_arcs([_entity(e, local, n, f) for e in loop]):
                w.entity(item.layer, ent, item.linetype)
    return w.text(code, unit not in ("inch", "in", "ft"))


def _as_arcs(e: Edge, tolerance: float) -> list[Edge]:
    """The edge as lines and arcs: itself where it is one (circular and straight B-splines too)."""
    if e.geom_type in ("line", "circle") or _circle_of(e) is not None:
        return [e]
    return list(e.to_arcs(tolerance).edges())


@dataclass
class _Item:
    layer: str
    loops: list[list[Edge]]
    plane: Plane | None  # the plane of a sketch or face
    linetype: str = "Continuous"


def _drawable(shapes: Any, what: str = "export_dxf") -> list[_Item]:
    from .drawing import DrawingView
    from .mesh import Mesh
    from .shapes import Part, Vertex

    out: list[_Item] = []

    def add(s: Any) -> None:
        if isinstance(s, DrawingView):  # (a tuple: before the lists)
            out.append(_Item("VISIBLE", [[e] for e in s.visible], Plane.XY))
            out.append(_Item("HIDDEN", [[e] for e in s.hidden], Plane.XY, "DASHED"))
            return
        if isinstance(s, Part):
            raise TypeError(f"{what} writes 2D shapes, not a Part; write part.section(plane) for a cross-section "
                            "or the edges of part.outline(plane) for a view")
        if isinstance(s, Mesh):
            raise TypeError(f"{what} cannot write a Mesh")
        if isinstance(s, Vertex):
            raise TypeError(f"{what} writes curves; a Vertex has none")
        if isinstance(s, Sketch):
            out.append(_Item(_layer_name(s.name), [list(w.edges()) for f in s.faces() for w in f.wires()], s.plane))
        elif isinstance(s, _Body):
            faces = list(s.faces())
            if not all(f.is_planar for f in faces):
                raise TypeError(f"{what} writes planar shapes; this surface is curved")
            out.append(_Item(_layer_name(s.name), [list(w.edges()) for f in faces for w in f.wires()],
                             faces[0].plane if faces else None))
        elif isinstance(s, Face):
            if not s.is_planar:
                raise TypeError(f"{what} writes planar faces; this face is curved")
            out.append(_Item(_layer_name(getattr(s.owner, "name", None)), [list(w.edges()) for w in s.wires()], s.plane))
        elif isinstance(s, Wire):
            out.append(_Item("0", [list(s.edges())], None))
        elif isinstance(s, Edge):
            out.append(_Item("0", [[s]], None))
        elif isinstance(s, (list, tuple)):
            for t in s:
                add(t)
        else:
            raise TypeError(f"{what} cannot write a {type(s).__name__}")

    add(shapes)
    return [it for it in out if it.loops]


def _layer_name(name: str | None) -> str:
    """A layer name DXF readers of every version take: ASCII letters, digits, ``-_$`` and spaces
    (an AC1015 file is read as code page text, so other characters become ``_``)."""
    if not name:
        return "0"
    clean = "".join(c if c.isascii() and (c.isalnum() or c in "-_$ ") else "_" for c in str(name)).strip()
    return clean or "0"


def _frame(items: list[_Item], plane: Plane | None) -> Plane:
    """The drawing plane (see :func:`export_dxf`)."""
    samples = [np.vstack([_edge_points(e, min(_samples_for(e), 16)) for e in loop]) for it in items for loop in it.loops]
    allpts = np.vstack(samples)
    tol = 1e-9 * max(float(np.max(np.ptp(allpts, axis=0))), 1.0)

    def parallel(pl: Plane) -> bool:
        nrm = np.array(pl.z_dir.to_tuple())
        return all(float(np.ptp(pts @ nrm)) <= tol for pts in samples)

    if plane is not None:
        if not parallel(plane):
            raise ValueError("export_dxf: the shapes are not parallel to the drawing plane; pass the plane they lie in")
        return plane
    if parallel(Plane.XY):
        return Plane.XY
    for it in items:
        if it.plane is not None and parallel(it.plane):
            return it.plane
    raise ValueError("export_dxf: the shapes are neither in planes parallel to XY nor in one sketch's plane; "
                     "pass plane=...")


# -- entities -----------------------------------------------------------------
@dataclass
class _Ent:
    kind: str  # LINE, ARC, CIRCLE, ELLIPSE, SPLINE
    data: dict[str, Any]


def _entity(e: Edge, local: Any, n: np.ndarray, f: float) -> _Ent:
    kind = e.geom_type
    if kind == "line":
        return _Ent("LINE", {"a": local(e.start.to_tuple()), "b": local(e.end.to_tuple())})
    if kind == "circle":
        d = ext.curve_data(e._curve(), False)
        pl = d["placement"]
        return _arc(local(pl["origin"]), float(d["radius"]) * f, e, local, float(np.dot(pl["z_dir"], n)) > 0)
    if kind == "ellipse":
        d = ext.curve_data(e._curve(), False)
        return _ellipse(d, e, local, n)
    circle = _circle_of(e)
    if circle is not None:
        center, radius, axis = circle
        return _arc(local(center), radius * f, e, local, float(np.dot(axis, n)) > 0)
    curve = e._copy_curve()  # the extent and direction of the edge
    try:
        d = ext.curve_data(curve)
    finally:
        ext.delete_curve(curve)
    poles = np.array(d["poles"], dtype=float)
    if _straight(poles):
        return _Ent("LINE", {"a": local(e.start.to_tuple()), "b": local(e.end.to_tuple())})
    weights = d["weights"]
    return _Ent("SPLINE", {"degree": int(d["degree"]), "knots": [float(x) for x in d["knots"]],
                           "poles": [local(p) for p in poles],
                           "weights": None if weights is None else [float(x) for x in weights]})


def _arc(center: np.ndarray, radius: float, e: Edge, local: Any, ccw: bool) -> _Ent:
    """ARC or CIRCLE of a circular edge; ``ccw`` says whether the curve (in its own direction)
    runs counterclockwise in the drawing."""
    if e.is_closed:
        return _Ent("CIRCLE", {"c": center, "r": radius})
    t0, t1 = e._range()
    cv = e._curve()
    a, b = local(cv.evaluate(t0)), local(cv.evaluate(t1))
    if not ccw:
        a, b = b, a
    a0 = math.degrees(math.atan2(a[1] - center[1], a[0] - center[0])) % 360.0
    a1 = math.degrees(math.atan2(b[1] - center[1], b[0] - center[0])) % 360.0
    return _Ent("ARC", {"c": center, "r": radius, "a0": a0, "a1": a1})


def _ellipse(d: dict[str, Any], e: Edge, local: Any, n: np.ndarray) -> _Ent:
    pl = d["placement"]
    r1, r2 = float(d["radius1"]), float(d["radius2"])
    xd, yd = np.array(pl["x_dir"]), np.array(pl["y_dir"])
    major3, ratio = (xd * r1, r2 / r1) if r1 >= r2 else (yd * r2, r1 / r2)
    c3 = np.array(pl["origin"])
    c = local(c3)
    m = local(c3 + major3) - c  # the major half axis in the drawing
    if e.is_closed:
        return _Ent("ELLIPSE", {"c": c, "major": m, "ratio": ratio, "t0": 0.0, "t1": _TWO_PI})
    a_len = float(np.linalg.norm(m))
    mu = m / a_len
    nu = np.array([-mu[1], mu[0]])  # a DXF ellipse's minor axis is counterclockwise from its major axis

    def param(p: np.ndarray) -> float:
        q = p - c
        return math.atan2(float(q @ nu) / (a_len * ratio), float(q @ mu) / a_len) % _TWO_PI

    t0, t1 = e._range()
    cv = e._curve()
    s, t = param(local(cv.evaluate(t0))), param(local(cv.evaluate(t1)))
    if float(np.dot(np.array(pl["z_dir"]), n)) < 0:  # the curve runs clockwise in the drawing
        s, t = t, s
    if t <= s:
        t += _TWO_PI
    return _Ent("ELLIPSE", {"c": c, "major": m, "ratio": ratio, "t0": s, "t1": t})


def _straight(poles: np.ndarray) -> bool:
    """Control points on one line, in order: the curve is that segment."""
    a, b = poles[0], poles[-1]
    L = float(np.linalg.norm(b - a))
    if len(poles) < 2 or L == 0:
        return False
    u = (b - a) / L
    rel = poles - a
    if float(np.max(np.linalg.norm(rel - np.outer(rel @ u, u), axis=1))) > 1e-12 * L:
        return False
    return bool(np.all(np.diff(rel @ u) >= -1e-12 * L))


def _circle_of(e: Edge) -> tuple[np.ndarray, float, np.ndarray] | None:
    """Center, radius and axis (counterclockwise in the curve's direction) of a rational
    degree-2 B-spline edge that is a circular arc. Each span of such a curve is a conic, and a
    conic with five points on a circle is that circle; seven points per span are tested."""
    cv = e._curve()
    d = ext.curve_data(cv)
    if int(d["degree"]) != 2 or d["weights"] is None:
        return None
    t0, t1 = e._range()
    knots = sorted(set(float(x) for x in d["knots"]))
    pts: list[np.ndarray] = []
    for a, b in zip(knots, knots[1:]):
        lo, hi = max(a, t0), min(b, t1)
        if hi > lo:
            pts.extend(np.array(cv.evaluate(float(t))) for t in np.linspace(lo, hi, 7))
    if len(pts) < 5:
        return None
    P = np.array(pts)
    poles = np.array(d["poles"], dtype=float)
    q0, q1, q2 = poles[0], poles[1], poles[2]
    axis = np.cross(q1 - q0, q2 - q1)
    if float(np.linalg.norm(axis)) <= 1e-12 * float(np.linalg.norm(q1 - q0)) * float(np.linalg.norm(q2 - q1)):
        return None
    axis /= np.linalg.norm(axis)
    # The first span's end tangents point at its middle control point, so the center is where the
    # normals at both ends meet (exact from the control points, not from evaluated points).
    if len(knots) > 2 and sum(1 for x in d["knots"] if abs(float(x) - knots[1]) <= 1e-14 * max(1.0, abs(knots[1]))) < 2:
        return None  # the first three poles are not the first span's Bézier points
    n0, n2 = np.cross(axis, q1 - q0), np.cross(axis, q2 - q1)
    A = np.array([[n0 @ n0, -(n0 @ n2)], [n0 @ n2, -(n2 @ n2)]])
    rhs = np.array([(q2 - q0) @ n0, (q2 - q0) @ n2])
    try:
        s_, _ = np.linalg.solve(A, rhs)
    except np.linalg.LinAlgError:
        return None
    center = q0 + s_ * n0
    r = 0.5 * (float(np.linalg.norm(q0 - center)) + float(np.linalg.norm(q2 - center)))
    if not np.all(np.abs(np.linalg.norm(P - center, axis=1) - r) <= 1e-9 * r):
        return None
    if not np.all(np.abs((P - center) @ axis) <= 1e-9 * r):
        return None
    turn = sum(float(np.cross(P[i] - center, P[i + 1] - center) @ axis) for i in range(len(P) - 1))
    return center, r, (axis if turn >= 0 else -axis)


def _merge_arcs(ents: list[_Ent]) -> list[_Ent]:
    """Join consecutive arcs of one circle (as the pieces of a section's holes come)."""
    out: list[_Ent] = []
    for ent in ents:
        if out and _join(out[-1], ent):
            continue
        out.append(ent)
    if len(out) > 1 and _join(out[0], out[-1]):
        out.pop()
    return [_Ent("CIRCLE", {"c": x.data["c"], "r": x.data["r"]})
            if x.kind == "ARC" and abs(_angle_gap(x.data["a1"], x.data["a0"])) <= 1e-9 else x for x in out]


def _join(a: _Ent, b: _Ent) -> bool:
    """Extend arc ``a`` by arc ``b`` when they continue each other on one circle."""
    if a.kind != "ARC" or b.kind != "ARC":
        return False
    r = max(a.data["r"], b.data["r"])
    if abs(a.data["r"] - b.data["r"]) > 1e-9 * r or float(np.linalg.norm(a.data["c"] - b.data["c"])) > 1e-9 * r:
        return False
    if abs(_angle_gap(a.data["a1"], b.data["a0"])) <= 1e-9:
        a.data["a1"] = b.data["a1"]
        return True
    if abs(_angle_gap(b.data["a1"], a.data["a0"])) <= 1e-9:
        a.data["a0"] = b.data["a0"]
        return True
    return False


def _angle_gap(a: float, b: float) -> float:
    """Difference of two angles in degrees, in (-180, 180]."""
    d = (a - b) % 360.0
    return d - 360.0 if d > 180.0 else d


# -- the file ---------------------------------------------------------------------
def _num(v: float) -> str:
    v = float(v)
    return "0.0" if abs(v) < 1e-13 else repr(v)


# Fixed handles of the tables, blocks and dictionaries; entities and layers get handles from 0x100.
_H = {"BLOCK_RECORD": "1", "LAYER": "2", "STYLE": "3", "LTYPE": "5", "VIEW": "6", "UCS": "7", "VPORT": "8",
      "APPID": "9", "DIMSTYLE": "A", "ROOT": "C", "GROUPS": "D", "STYLE_STANDARD": "11", "APPID_ACAD": "12",
      "LT_BYBLOCK": "14", "LT_BYLAYER": "15", "LT_CONTINUOUS": "16", "MODEL": "1F", "PAPER": "1B",
      "MODEL_BLOCK": "20", "MODEL_END": "21", "PAPER_BLOCK": "1C", "PAPER_END": "1D", "DIMSTYLE_STANDARD": "27",
      "VPORT_ACTIVE": "29"}


class _Writer:
    """An AutoCAD 2000 DXF: header, tables, blocks, entities and objects, with handles."""

    def __init__(self) -> None:
        self.handle = 0xFF
        self.layers: dict[str, str] = {}  # name -> linetype
        self.dash = (3.0, 1.5)  # the DASHED linetype: dash and gap, in the file's unit
        self.entities: list[str] = []
        self.lo = np.full(2, np.inf)
        self.hi = np.full(2, -np.inf)

    def _next(self) -> str:
        self.handle += 1
        return f"{self.handle:X}"

    def _grow(self, lo: np.ndarray, hi: np.ndarray) -> None:
        self.lo = np.minimum(self.lo, lo)
        self.hi = np.maximum(self.hi, hi)

    def entity(self, layer: str, ent: _Ent, linetype: str = "Continuous") -> None:
        if layer not in self.layers:
            self.layers[layer] = linetype
        d = ent.data
        tags = ["0", ent.kind, "5", self._next(), "330", _H["MODEL"], "100", "AcDbEntity", "8", layer]
        if ent.kind == "LINE":
            tags += ["100", "AcDbLine", *_xy(10, d["a"]), *_xy(11, d["b"])]
            self._grow(np.minimum(d["a"], d["b"]), np.maximum(d["a"], d["b"]))
        elif ent.kind in ("CIRCLE", "ARC"):
            tags += ["100", "AcDbCircle", *_xy(10, d["c"]), "40", _num(d["r"])]
            if ent.kind == "ARC":
                tags += ["100", "AcDbArc", "50", _num(d["a0"]), "51", _num(d["a1"])]
            self._grow(d["c"] - d["r"], d["c"] + d["r"])
        elif ent.kind == "ELLIPSE":
            tags += ["100", "AcDbEllipse", *_xy(10, d["c"]), *_xy(11, d["major"]), "210", "0.0", "220", "0.0",
                     "230", "1.0", "40", _num(d["ratio"]), "41", _num(d["t0"]), "42", _num(d["t1"])]
            r = float(np.linalg.norm(d["major"]))
            self._grow(d["c"] - r, d["c"] + r)
        else:  # SPLINE: planar, rational when it has weights
            rational = d["weights"] is not None
            tags += ["100", "AcDbSpline", "210", "0.0", "220", "0.0", "230", "1.0", "70", str(8 | (4 if rational else 0)),
                     "71", str(d["degree"]), "72", str(len(d["knots"])), "73", str(len(d["poles"])), "74", "0",
                     "42", "1e-10", "43", "1e-10"]
            for kv in d["knots"]:
                tags += ["40", _num(kv)]
            for wv in d["weights"] or ():
                tags += ["41", _num(wv)]
            for q in d["poles"]:
                tags += _xy(10, q)
            P = np.array(d["poles"])
            self._grow(P.min(axis=0), P.max(axis=0))
        self.entities.append("\n".join(tags))

    def text(self, insunits: int, metric: bool) -> str:
        ok = np.all(np.isfinite(self.lo))
        lo, hi = (self.lo, self.hi) if ok else (np.zeros(2), np.zeros(2))
        if "0" not in self.layers:
            self.layers = {"0": "Continuous", **self.layers}
        layer_tags: list[str] = []
        for name, linetype in self.layers.items():
            layer_tags += ["0", "LAYER", "5", self._next(), "330", _H["LAYER"], "100", "AcDbSymbolTableRecord",
                           "100", "AcDbLayerTableRecord", "2", name, "70", "0", "62", "7", "6", linetype or "Continuous"]
        dashed = self._next() if "DASHED" in self.layers.values() else None
        seed = f"{self.handle + 1:X}"
        center = (lo + hi) / 2.0
        height = max(float(hi[1] - lo[1]), float(hi[0] - lo[0]) / 1.5, 1.0) * 1.1
        lt: list[str] = []
        for key, name, text in (("LT_BYBLOCK", "ByBlock", ""), ("LT_BYLAYER", "ByLayer", ""),
                                ("LT_CONTINUOUS", "Continuous", "Solid line")):
            lt += ["0", "LTYPE", "5", _H[key], "330", _H["LTYPE"], "100", "AcDbSymbolTableRecord",
                   "100", "AcDbLinetypeTableRecord", "2", name, "70", "0", "3", text, "72", "65", "73", "0", "40", "0.0"]
        if dashed is not None:
            dash, gap = self.dash
            lt += ["0", "LTYPE", "5", dashed, "330", _H["LTYPE"], "100", "AcDbSymbolTableRecord",
                   "100", "AcDbLinetypeTableRecord", "2", "DASHED", "70", "0", "3", "Dashed __ __ __", "72", "65",
                   "73", "2", "40", _num(dash + gap), "49", _num(dash), "74", "0", "49", _num(-gap), "74", "0"]
        parts = [
            _section("HEADER", [
                "9", "$ACADVER", "1", "AC1015",
                "9", "$HANDSEED", "5", seed,
                "9", "$INSUNITS", "70", str(insunits),
                "9", "$MEASUREMENT", "70", "1" if metric else "0",
                "9", "$EXTMIN", "10", _num(lo[0]), "20", _num(lo[1]), "30", "0.0",
                "9", "$EXTMAX", "10", _num(hi[0]), "20", _num(hi[1]), "30", "0.0",
            ]),
            _section("CLASSES", []),
            _section("TABLES", [
                *_table("VPORT", 1, [
                    "0", "VPORT", "5", _H["VPORT_ACTIVE"], "330", _H["VPORT"], "100", "AcDbSymbolTableRecord",
                    "100", "AcDbViewportTableRecord", "2", "*Active", "70", "0", "10", "0.0", "20", "0.0",
                    "11", "1.0", "21", "1.0", "12", _num(center[0]), "22", _num(center[1]), "13", "0.0", "23", "0.0",
                    "14", "10.0", "24", "10.0", "15", "10.0", "25", "10.0", "16", "0.0", "26", "0.0", "36", "1.0",
                    "17", "0.0", "27", "0.0", "37", "0.0", "40", _num(height), "41", "1.5", "42", "50.0",
                    "43", "0.0", "44", "0.0", "50", "0.0", "51", "0.0", "71", "0", "72", "100", "73", "1", "74", "3",
                    "75", "0", "76", "0", "77", "0", "78", "0"]),
                *_table("LTYPE", 3 if dashed is None else 4, lt),
                *_table("LAYER", len(self.layers), layer_tags),
                *_table("STYLE", 1, [
                    "0", "STYLE", "5", _H["STYLE_STANDARD"], "330", _H["STYLE"], "100", "AcDbSymbolTableRecord",
                    "100", "AcDbTextStyleTableRecord", "2", "Standard", "70", "0", "40", "0.0", "41", "1.0",
                    "50", "0.0", "71", "0", "42", "2.5", "3", "txt", "4", ""]),
                *_table("VIEW", 0, []),
                *_table("UCS", 0, []),
                *_table("APPID", 1, [
                    "0", "APPID", "5", _H["APPID_ACAD"], "330", _H["APPID"], "100", "AcDbSymbolTableRecord",
                    "100", "AcDbRegAppTableRecord", "2", "ACAD", "70", "0"]),
                *_table("DIMSTYLE", 1, [
                    "0", "DIMSTYLE", "105", _H["DIMSTYLE_STANDARD"], "330", _H["DIMSTYLE"], "100",
                    "AcDbSymbolTableRecord", "100", "AcDbDimStyleTableRecord", "2", "Standard", "70", "0"],
                    subclass="AcDbDimStyleTable"),
                *_table("BLOCK_RECORD", 2, [
                    "0", "BLOCK_RECORD", "5", _H["MODEL"], "330", _H["BLOCK_RECORD"], "100", "AcDbSymbolTableRecord",
                    "100", "AcDbBlockTableRecord", "2", "*Model_Space",
                    "0", "BLOCK_RECORD", "5", _H["PAPER"], "330", _H["BLOCK_RECORD"], "100", "AcDbSymbolTableRecord",
                    "100", "AcDbBlockTableRecord", "2", "*Paper_Space"]),
            ]),
            _section("BLOCKS", [
                "0", "BLOCK", "5", _H["MODEL_BLOCK"], "330", _H["MODEL"], "100", "AcDbEntity", "8", "0",
                "100", "AcDbBlockBegin", "2", "*Model_Space", "70", "0", "10", "0.0", "20", "0.0", "30", "0.0",
                "3", "*Model_Space", "1", "",
                "0", "ENDBLK", "5", _H["MODEL_END"], "330", _H["MODEL"], "100", "AcDbEntity", "8", "0",
                "100", "AcDbBlockEnd",
                "0", "BLOCK", "5", _H["PAPER_BLOCK"], "330", _H["PAPER"], "100", "AcDbEntity", "67", "1", "8", "0",
                "100", "AcDbBlockBegin", "2", "*Paper_Space", "70", "0", "10", "0.0", "20", "0.0", "30", "0.0",
                "3", "*Paper_Space", "1", "",
                "0", "ENDBLK", "5", _H["PAPER_END"], "330", _H["PAPER"], "100", "AcDbEntity", "67", "1", "8", "0",
                "100", "AcDbBlockEnd",
            ]),
            _section("ENTITIES", self.entities),
            _section("OBJECTS", [
                "0", "DICTIONARY", "5", _H["ROOT"], "330", "0", "100", "AcDbDictionary", "281", "1",
                "3", "ACAD_GROUP", "350", _H["GROUPS"],
                "0", "DICTIONARY", "5", _H["GROUPS"], "330", _H["ROOT"], "100", "AcDbDictionary", "281", "1",
            ]),
            "0\nEOF\n",
        ]
        return "\n".join(parts)


def _xy(code: int, p: np.ndarray) -> list[str]:
    return [str(code), _num(p[0]), str(code + 10), _num(p[1]), str(code + 20), "0.0"]


def _section(name: str, body: list[str]) -> str:
    return "\n".join(["0", "SECTION", "2", name, *body, "0", "ENDSEC"])


def _table(name: str, count: int, records: list[str], subclass: str | None = None) -> list[str]:
    return ["0", "TABLE", "2", name, "5", _H[name], "330", "0", "100", "AcDbSymbolTable", "70", str(count),
            *(["100", subclass] if subclass else []), *records, "0", "ENDTAB"]
