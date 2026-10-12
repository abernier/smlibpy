"""STEP (ISO 10303-21) reader: parse the file and interpret the B-rep data.

The result is a neutral description of bodies (vertices, edges with curves, faces with
surfaces, shells) in millimetres and world coordinates, which ``smlibpy.step_import``
turns into kernel topology.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np

__all__ = ["parse", "Ref", "StepFile", "interpret", "BodyData"]


class Ref(int):
    """A reference to another entity (``#123``)."""

    def __repr__(self) -> str:
        return f"#{int(self)}"


class Enum(str):
    """An enumeration value (``.T.``, ``.UNSPECIFIED.``)."""


class Typed:
    """A typed parameter such as ``LENGTH_MEASURE(1.E-07)``."""

    __slots__ = ("name", "args")

    def __init__(self, name: str, args: list[Any]):
        self.name = name
        self.args = args

    def __repr__(self) -> str:
        return f"{self.name}{self.args!r}"


_TOKEN = re.compile(r"""
    \s*(?:
      (?P<ref>\#\d+)
    | (?P<str>'(?:[^']|'')*')
    | (?P<enum>\.[A-Z_0-9]+\.)
    | (?P<num>[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?))
    | (?P<kw>[A-Za-z_][A-Za-z_0-9]*)
    | (?P<punct>[(),$*])
    )""", re.VERBOSE)


def _decode_string(s: str) -> str:
    s = s[1:-1].replace("''", "'")
    if "\\" not in s:
        return s

    def x2(m: re.Match[str]) -> str:
        hexs = m.group(1)
        return "".join(chr(int(hexs[i:i + 4], 16)) for i in range(0, len(hexs), 4))

    s = re.sub(r"\\X2\\([0-9A-Fa-f]+)\\X0\\", x2, s)
    s = re.sub(r"\\X\\([0-9A-Fa-f]{2})", lambda m: chr(int(m.group(1), 16)), s)
    return s.replace("\\\\", "\\")


def _parse_args(text: str, pos: int) -> tuple[list[Any], int]:
    """Parse a parenthesised parameter list starting at ``text[pos] == '('``."""
    out: list[Any] = []
    stack: list[list[Any]] = [out]
    pending_kw: list[str | None] = [None]
    i = pos + 1
    n = len(text)
    while i < n:
        m = _TOKEN.match(text, i)
        if not m:
            raise ValueError(f"STEP syntax error near: {text[i:i + 40]!r}")
        i = m.end()
        kind = m.lastgroup
        tok = m.group(kind)
        cur = stack[-1]
        if kind == "ref":
            cur.append(Ref(int(tok[1:])))
        elif kind == "num":
            cur.append(float(tok) if any(c in tok for c in ".eE") else int(tok))
        elif kind == "str":
            cur.append(_decode_string(tok))
        elif kind == "enum":
            cur.append(Enum(tok[1:-1]))
        elif kind == "kw":
            pending_kw.append(tok)
            stack.append([])
            # the '(' that follows opens the typed parameter
            m2 = _TOKEN.match(text, i)
            if m2 and m2.group("punct") == "(":
                i = m2.end()
            continue
        else:  # punctuation
            if tok == "(":
                stack.append([])
                pending_kw.append(None)
            elif tok == ")":
                done = stack.pop()
                kw = pending_kw.pop()
                if not stack:
                    return done, i
                stack[-1].append(Typed(kw, done) if kw else done)
            elif tok == "$":
                cur.append(None)
            elif tok == "*":
                cur.append("*")
            # ',' separates
    raise ValueError("unterminated parameter list")


@dataclass
class StepFile:
    entities: dict[int, tuple[str, list[Any]]]
    complex: dict[int, dict[str, list[Any]]]
    schema: str = ""

    def get(self, ref: Any) -> tuple[str, list[Any]]:
        return self.entities[int(ref)]

    def type_of(self, ref: Any) -> str:
        return self.entities[int(ref)][0]

    def of_type(self, *names: str) -> list[int]:
        wanted = set(names)
        return [i for i, (t, _) in self.entities.items() if t in wanted]


_RECORD = re.compile(r"#(\d+)\s*=\s*", re.S)


def parse(text: str) -> StepFile:
    """Parse the DATA section of a STEP file."""
    # remove comments
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    schema = ""
    m = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'", text)
    if m:
        schema = m.group(1)
    start = text.find("DATA;")
    if start < 0:
        raise ValueError("not a STEP file (no DATA section)")
    entities: dict[int, tuple[str, list[Any]]] = {}
    complex_: dict[int, dict[str, list[Any]]] = {}
    pos = start + 5
    n = len(text)
    while True:
        m = _RECORD.search(text, pos)
        if not m:
            break
        eid = int(m.group(1))
        i = m.end()
        if text.startswith("(", i):
            # complex entity: ( NAME(args) NAME(args) ... )
            parts: dict[str, list[Any]] = {}
            i += 1
            while True:
                while i < n and text[i] in " \t\r\n":
                    i += 1
                if text[i] == ")":
                    i += 1
                    break
                km = re.compile(r"[A-Za-z_][A-Za-z_0-9]*").match(text, i)
                if not km:
                    raise ValueError(f"bad complex entity #{eid}")
                name = km.group(0).upper()
                i = km.end()
                while text[i] in " \t\r\n":
                    i += 1
                args, i = _parse_args(text, i)
                parts[name] = args
            complex_[eid] = parts
            entities[eid] = (_complex_kind(parts), [])
        else:
            km = re.compile(r"[A-Za-z_][A-Za-z_0-9]*").match(text, i)
            if not km:
                pos = i
                continue
            name = km.group(0).upper()
            i = km.end()
            while text[i] in " \t\r\n":
                i += 1
            args, i = _parse_args(text, i)
            entities[eid] = (name, args)
        semi = text.find(";", i)
        pos = semi + 1 if semi >= 0 else n
    return StepFile(entities, complex_, schema)


def _complex_kind(parts: dict[str, list[Any]]) -> str:
    for k in ("B_SPLINE_SURFACE_WITH_KNOTS", "B_SPLINE_CURVE_WITH_KNOTS", "BEZIER_CURVE", "BEZIER_SURFACE",
              "UNIFORM_CURVE", "UNIFORM_SURFACE", "QUASI_UNIFORM_CURVE", "QUASI_UNIFORM_SURFACE",
              "GEOMETRIC_REPRESENTATION_CONTEXT", "LENGTH_UNIT", "PLANE_ANGLE_UNIT", "SOLID_ANGLE_UNIT",
              "REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION"):
        if k in parts:
            return "COMPLEX:" + k
    return "COMPLEX:" + "+".join(sorted(parts))


# =============================================================================
# Interpretation
# =============================================================================
@dataclass
class BodyData:
    """One body in neutral form (lengths in mm, world coordinates)."""

    kind: str  # "solid" or "sheet"
    name: str
    vertices: list[tuple[float, float, float]] = field(default_factory=list)
    curves: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)
    surfaces: list[dict[str, Any]] = field(default_factory=list)
    faces: list[dict[str, Any]] = field(default_factory=list)
    shells: list[dict[str, Any]] = field(default_factory=list)  # [{"faces": [...], "reversed": bool}]
    color: tuple[float, float, float] | None = None


_MM_PER_METRE_PREFIXED: dict[Any, float] = {
    None: 1000.0, "EXA": 1e21, "PETA": 1e18, "TERA": 1e15, "GIGA": 1e12, "MEGA": 1e9, "KILO": 1e6,
    "HECTO": 1e5, "DECA": 1e4, "DECI": 100.0, "CENTI": 10.0, "MILLI": 1.0, "MICRO": 1e-3, "NANO": 1e-6,
    "PICO": 1e-9, "FEMTO": 1e-12, "ATTO": 1e-15,
}


class _Interp:
    def __init__(self, sf: StepFile):
        self.sf = sf
        self.scale = 1.0          # model length unit -> mm
        self.angle_scale = 1.0    # model plane angle unit -> radians
        self._find_units()
        self.colors = self._find_colors()

    # -- units ------------------------------------------------------------------
    def _find_units(self) -> None:
        """Length and angle unit of every representation context. A file can define more
        units than it uses for geometry (density units in metres, for example), so only
        the units a context assigns count."""
        sf = self.sf
        self.context_units: dict[int, tuple[float, float]] = {}
        for eid, parts in sf.complex.items():
            assigned = parts.get("GLOBAL_UNIT_ASSIGNED_CONTEXT")
            if not assigned:
                continue
            length, angle = 1.0, 1.0
            for u in assigned[0]:
                kinds = sf.complex.get(int(u), {})
                if "LENGTH_UNIT" in kinds:
                    length = self._unit_value(int(u), _MM_PER_METRE_PREFIXED)
                elif "PLANE_ANGLE_UNIT" in kinds:
                    angle = self._unit_value(int(u), {None: 1.0})
            self.context_units[eid] = (length, angle)
        units = list(self.context_units.values())
        if units:  # where a representation has no context of its own, the most common one counts
            self.scale, self.angle_scale = max(set(units), key=units.count)
        self.default_units = (self.scale, self.angle_scale)
        self.rep_context: dict[int, int] = {}
        for eid, (t, a) in sf.entities.items():
            if t.endswith("REPRESENTATION") and len(a) >= 3 and isinstance(a[2], Ref):
                self.rep_context[eid] = int(a[2])
        for eid, parts in sf.complex.items():
            for k, a in parts.items():
                if k.endswith("REPRESENTATION") and len(a) >= 3 and isinstance(a[2], Ref):
                    self.rep_context[eid] = int(a[2])

    def _unit_value(self, ref: int, si: dict[Any, float], depth: int = 0) -> float:
        """Size of a unit: an SI unit with its prefix, or a conversion-based unit (inch,
        degree) followed to the unit it is defined in."""
        kinds = self.sf.complex.get(ref, {})
        if "SI_UNIT" in kinds:
            prefix = kinds["SI_UNIT"][0]
            if si.keys() == {None}:  # angles: radians, no prefixes in practice
                return 1.0
            return si.get(None if prefix is None else str(prefix).upper(), 1.0)
        if "CONVERSION_BASED_UNIT" in kinds and depth < 8:
            name, measure = kinds["CONVERSION_BASED_UNIT"]
            try:
                _, a = self.sf.get(measure)
                value = a[0].args[0] if isinstance(a[0], Typed) else a[0]
                return float(value) * self._unit_value(int(a[1]), si, depth + 1)
            except Exception:
                n = str(name).upper()
                return math.pi / 180.0 if n.startswith("DEG") else 25.4 if n.startswith("INCH") else 1.0
        return 1.0

    def units_of(self, rep: int | None) -> tuple[float, float]:
        """(mm per length unit, radians per angle unit) of a representation."""
        return self.context_units.get(self.rep_context.get(rep, -1), self.default_units) if rep is not None \
            else self.default_units

    def use_units(self, rep: int | None) -> None:
        self.scale, self.angle_scale = self.units_of(rep)

    # -- colors -----------------------------------------------------------------
    def _find_colors(self) -> dict[int, tuple[float, float, float]]:
        sf = self.sf
        out: dict[int, tuple[float, float, float]] = {}
        for eid in sf.of_type("STYLED_ITEM", "OVER_RIDING_STYLED_ITEM"):
            _, a = sf.get(eid)
            try:
                rgb = self._style_color(a[1])
                if rgb is not None and isinstance(a[2], Ref):
                    out[int(a[2])] = rgb
            except Exception:
                continue
        return out

    def _style_color(self, styles: list[Any]) -> tuple[float, float, float] | None:
        sf = self.sf
        todo = list(styles)
        seen = 0
        while todo and seen < 64:
            seen += 1
            r = todo.pop(0)
            if isinstance(r, list):
                todo.extend(r)
                continue
            if not isinstance(r, Ref) or int(r) not in sf.entities:
                continue
            t, a = sf.get(r)
            if t == "COLOUR_RGB":
                return (float(a[1]), float(a[2]), float(a[3]))
            if t == "DRAUGHTING_PRE_DEFINED_COLOUR":
                named = {"red": (1, 0, 0), "green": (0, 1, 0), "blue": (0, 0, 1), "yellow": (1, 1, 0),
                         "magenta": (1, 0, 1), "cyan": (0, 1, 1), "black": (0, 0, 0), "white": (1, 1, 1)}
                return named.get(str(a[0]).lower())
            for x in a:
                if isinstance(x, (Ref, list)):
                    todo.append(x)
        return None

    # -- placements --------------------------------------------------------------
    def point(self, ref: Any) -> np.ndarray:
        t, a = self.sf.get(ref)
        if t != "CARTESIAN_POINT":
            raise ValueError(f"expected a point, got {t}")
        c = list(a[1]) + [0.0] * (3 - len(a[1]))
        return np.array(c, dtype=float) * self.scale

    def direction(self, ref: Any) -> np.ndarray:
        t, a = self.sf.get(ref)
        if t == "VECTOR":
            return self.direction(a[1])
        c = list(a[1]) + [0.0] * (3 - len(a[1]))
        v = np.array(c, dtype=float)
        return v / np.linalg.norm(v)

    def vector(self, ref: Any) -> np.ndarray:
        t, a = self.sf.get(ref)
        if t == "VECTOR":
            return self.direction(a[1]) * float(a[2]) * self.scale
        return self.direction(ref)

    def axis2(self, ref: Any) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(origin, z, x) of an AXIS2_PLACEMENT_3D."""
        t, a = self.sf.get(ref)
        o = self.point(a[1])
        z = self.direction(a[2]) if len(a) > 2 and a[2] is not None else np.array([0.0, 0.0, 1.0])
        if len(a) > 3 and a[3] is not None:
            x = self.direction(a[3])
        else:
            x = np.array([1.0, 0.0, 0.0]) if abs(z[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        x = x - z * x.dot(z)
        x /= np.linalg.norm(x)
        return o, z, x

    def placement_matrix(self, ref: Any) -> np.ndarray:
        o, z, x = self.axis2(ref)
        y = np.cross(z, x)
        m = np.eye(4)
        m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, o
        return m

    # -- curves ------------------------------------------------------------------
    def curve(self, ref: Any) -> dict[str, Any]:
        sf = self.sf
        t, a = sf.get(ref)
        if t in ("SURFACE_CURVE", "SEAM_CURVE", "INTERSECTION_CURVE"):
            return self.curve(a[1])
        if t == "LINE":
            return {"kind": "line", "origin": self.point(a[1]), "direction": self.vector(a[2])}
        if t == "CIRCLE":
            o, z, x = self.axis2(a[1])
            return {"kind": "circle", "origin": o, "z": z, "x": x, "radius": float(a[2]) * self.scale}
        if t == "ELLIPSE":
            o, z, x = self.axis2(a[1])
            return {"kind": "ellipse", "origin": o, "z": z, "x": x, "r1": float(a[2]) * self.scale,
                    "r2": float(a[3]) * self.scale}
        if t == "B_SPLINE_CURVE_WITH_KNOTS":
            degree, pts = int(a[1]), [self.point(p) for p in a[2]]
            knots = _expand(a[7], a[6])
            return {"kind": "bspline", "degree": degree, "poles": np.array(pts), "knots": knots, "weights": None}
        if t in _KNOT_FORMS:  # BEZIER_CURVE, UNIFORM_CURVE, QUASI_UNIFORM_CURVE: knots implied
            degree, pts = int(a[1]), [self.point(p) for p in a[2]]
            return {"kind": "bspline", "degree": degree, "poles": np.array(pts),
                    "knots": _default_knots(len(pts), degree, _KNOT_FORMS[t]), "weights": None}
        if t == "HYPERBOLA":
            o, z, x = self.axis2(a[1])
            return {"kind": "hyperbola", "origin": o, "z": z, "x": x, "a": float(a[2]) * self.scale,
                    "b": float(a[3]) * self.scale}
        if t == "PARABOLA":
            o, z, x = self.axis2(a[1])
            return {"kind": "parabola", "origin": o, "z": z, "x": x, "focal": float(a[2]) * self.scale}
        if t.startswith("COMPLEX:"):
            parts = sf.complex[int(ref)]
            if "B_SPLINE_CURVE" in parts:
                bs = parts["B_SPLINE_CURVE"]
                degree, pts = int(bs[0]), [self.point(p) for p in bs[1]]
                if "B_SPLINE_CURVE_WITH_KNOTS" in parts:
                    kk = parts["B_SPLINE_CURVE_WITH_KNOTS"]
                    knots = _expand(kk[1], kk[0])
                else:  # Bezier / uniform / quasi-uniform
                    form = next((f for k, f in _KNOT_FORMS.items() if k in parts), "quasi")
                    knots = _default_knots(len(pts), degree, form)
                w = parts.get("RATIONAL_B_SPLINE_CURVE")
                return {"kind": "bspline", "degree": degree, "poles": np.array(pts), "knots": knots,
                        "weights": [float(x) for x in w[0]] if w else None}
        if t == "POLYLINE":
            pts = [self.point(p) for p in a[1]]
            n = len(pts)
            knots = [0.0] + list(np.arange(n, dtype=float)) + [float(n - 1)]
            return {"kind": "bspline", "degree": 1, "poles": np.array(pts), "knots": knots, "weights": None}
        if t == "TRIMMED_CURVE":
            return self.curve(a[1])
        raise NotImplementedError(f"curve type {t}")

    # -- surfaces ----------------------------------------------------------------
    def surface(self, ref: Any) -> dict[str, Any]:
        sf = self.sf
        t, a = sf.get(ref)
        if t == "PLANE":
            o, z, x = self.axis2(a[1])
            return {"kind": "plane", "origin": o, "z": z, "x": x}
        if t == "CYLINDRICAL_SURFACE":
            o, z, x = self.axis2(a[1])
            return {"kind": "cylinder", "origin": o, "z": z, "x": x, "radius": float(a[2]) * self.scale}
        if t == "CONICAL_SURFACE":
            o, z, x = self.axis2(a[1])
            return {"kind": "cone", "origin": o, "z": z, "x": x, "radius": float(a[2]) * self.scale,
                    "semi_angle": float(a[3]) * self.angle_scale}
        if t == "SPHERICAL_SURFACE":
            o, z, x = self.axis2(a[1])
            return {"kind": "sphere", "origin": o, "z": z, "x": x, "radius": float(a[2]) * self.scale}
        if t in ("TOROIDAL_SURFACE", "DEGENERATE_TOROIDAL_SURFACE"):
            o, z, x = self.axis2(a[1])
            return {"kind": "torus", "origin": o, "z": z, "x": x, "major": float(a[2]) * self.scale,
                    "minor": float(a[3]) * self.scale}
        if t == "B_SPLINE_SURFACE_WITH_KNOTS":
            return self._bspline_surface(int(a[1]), int(a[2]), a[3], _expand(a[10], a[8]), _expand(a[11], a[9]), None)
        if t in _KNOT_FORMS:  # BEZIER_SURFACE, UNIFORM_SURFACE, QUASI_UNIFORM_SURFACE: knots implied
            ud, vd, grid = int(a[1]), int(a[2]), a[3]
            return self._bspline_surface(ud, vd, grid, _default_knots(len(grid), ud, _KNOT_FORMS[t]),
                                         _default_knots(len(grid[0]), vd, _KNOT_FORMS[t]), None)
        if t == "SURFACE_OF_LINEAR_EXTRUSION":
            return {"kind": "extrusion", "curve": self.curve(a[1]), "vector": self.vector(a[2])}
        if t == "SURFACE_OF_REVOLUTION":
            _, ax = sf.get(a[2])
            return {"kind": "revolution", "curve": self.curve(a[1]), "axis_origin": self.point(ax[1]),
                    "axis": self.direction(ax[2])}
        if t == "OFFSET_SURFACE":
            return {"kind": "offset", "basis": self.surface(a[1]), "distance": float(a[2]) * self.scale}
        if t == "RECTANGULAR_TRIMMED_SURFACE":
            return self.surface(a[1])
        if t.startswith("COMPLEX:"):
            parts = sf.complex[int(ref)]
            if "B_SPLINE_SURFACE" in parts:
                bs = parts["B_SPLINE_SURFACE"]
                ud, vd, grid = int(bs[0]), int(bs[1]), bs[2]
                if "B_SPLINE_SURFACE_WITH_KNOTS" in parts:
                    kk = parts["B_SPLINE_SURFACE_WITH_KNOTS"]
                    uk, vk = _expand(kk[2], kk[0]), _expand(kk[3], kk[1])
                else:
                    form = next((f for k, f in _KNOT_FORMS.items() if k in parts), "quasi")
                    uk = _default_knots(len(grid), ud, form)
                    vk = _default_knots(len(grid[0]), vd, form)
                w = parts.get("RATIONAL_B_SPLINE_SURFACE")
                return self._bspline_surface(ud, vd, grid, uk, vk, w[0] if w else None)
        raise NotImplementedError(f"surface type {t}")

    def _bspline_surface(self, ud: int, vd: int, grid: list[list[Any]], uk: list[float], vk: list[float],
                         weights: list[list[float]] | None) -> dict[str, Any]:
        nu, nv = len(grid), len(grid[0])
        poles = np.array([self.point(p) for row in grid for p in row])
        w = None if weights is None else [float(x) for row in weights for x in row]
        return {"kind": "bspline", "u_degree": ud, "v_degree": vd, "nu": nu, "nv": nv, "poles": poles,
                "u_knots": uk, "v_knots": vk, "weights": w}

    # -- topology ----------------------------------------------------------------
    def body(self, shell_refs: list[tuple[Any, bool]], kind: str, name: str) -> BodyData:
        sf = self.sf
        b = BodyData(kind=kind, name=name)
        vmap: dict[int, int] = {}
        emap: dict[int, int] = {}
        smap: dict[int, int] = {}

        def vertex(ref: Any) -> int:
            r = int(ref)
            if r not in vmap:
                t, a = sf.get(r)
                vmap[r] = len(b.vertices)
                b.vertices.append(tuple(self.point(a[1])))
            return vmap[r]

        def edge(ref: Any) -> int:
            r = int(ref)
            if r not in emap:
                t, a = sf.get(r)
                if t != "EDGE_CURVE":
                    raise NotImplementedError(f"edge type {t}")
                emap[r] = len(b.edges)
                b.curves.append(self.curve(a[3]))
                b.edges.append({"curve": len(b.curves) - 1, "v0": vertex(a[1]), "v1": vertex(a[2]),
                                "same_sense": str(a[4]) == "T"})
            return emap[r]

        for shell_ref, reversed_ in shell_refs:
            t, a = sf.get(shell_ref)
            if t == "ORIENTED_CLOSED_SHELL":
                reversed_ = reversed_ ^ (str(a[3]) == "F")
                shell_ref = a[2]
                t, a = sf.get(shell_ref)
            faces = []
            for fref in a[1]:
                ft, fa = sf.get(fref)
                if ft not in ("ADVANCED_FACE", "FACE_SURFACE"):
                    raise NotImplementedError(f"face type {ft}")
                sref = int(fa[2])
                if sref not in smap:
                    smap[sref] = len(b.surfaces)
                    b.surfaces.append(self.surface(sref))
                loops = []
                for bref in fa[1]:
                    bt, ba = sf.get(bref)
                    lt, la = sf.get(ba[1])
                    bound_sense = str(ba[2]) == "T"
                    if lt == "VERTEX_LOOP":
                        loops.append({"vertex": vertex(la[1]), "outer": bt == "FACE_OUTER_BOUND"})
                        continue
                    if lt != "EDGE_LOOP":
                        raise NotImplementedError(f"loop type {lt}")
                    items = []
                    for oref in la[1]:
                        ot, oa = sf.get(oref)
                        items.append((edge(oa[3]), str(oa[4]) == "T"))
                    if not bound_sense:
                        items = [(e, not fwd) for e, fwd in reversed(items)]
                    loops.append({"edges": items, "outer": bt == "FACE_OUTER_BOUND"})
                # outer loop first (if marked); otherwise keep the order
                loops.sort(key=lambda l: not l.get("outer", False))
                faces.append(len(b.faces))
                b.faces.append({"surface": smap[sref], "same_sense": str(fa[3]) == "T", "loops": loops,
                                "name": fa[0] if isinstance(fa[0], str) else ""})
            b.shells.append({"faces": faces, "reversed": reversed_, "closed": t != "OPEN_SHELL"})
        return b


def _expand(knots: list[float], mults: list[int]) -> list[float]:
    out: list[float] = []
    for kv, m in zip(knots, mults):
        out.extend([float(kv)] * int(m))
    return out


_KNOT_FORMS = {
    "BEZIER_CURVE": "bezier", "UNIFORM_CURVE": "uniform", "QUASI_UNIFORM_CURVE": "quasi",
    "BEZIER_SURFACE": "bezier", "UNIFORM_SURFACE": "uniform", "QUASI_UNIFORM_SURFACE": "quasi",
}


def _default_knots(n: int, degree: int, form: str) -> list[float]:
    """Knot vector of a B-spline whose knots the file leaves implicit (ISO 10303-42)."""
    if form == "uniform":
        return [float(i) for i in range(-degree, n + 1)]
    if form == "bezier":  # piecewise Bezier: segments meet with multiplicity ``degree``
        segments = max(1, (n - 1) // degree)
        inner = [float(i) for i in range(1, segments) for _ in range(degree)]
        return [0.0] * (degree + 1) + inner + [float(segments)] * (degree + 1)
    inner_n = n - degree - 1
    return [0.0] * (degree + 1) + [float(i) for i in range(1, inner_n + 1)] + [float(inner_n + 1)] * (degree + 1)


def interpret(sf: StepFile) -> list[tuple[BodyData, np.ndarray]]:
    """All bodies of the file with their world placement (4x4, mm)."""
    it = _Interp(sf)
    transforms, in_product = _representation_transforms(it)
    bodies: list[tuple[BodyData, np.ndarray]] = []
    owner = _owning_representations(sf)
    for eid, (t, a) in sf.entities.items():
        if t not in ("MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS", "SHELL_BASED_SURFACE_MODEL"):
            continue
        # Representations outside the product structure (the shape for validation
        # properties, for example) list bodies too; they do not place another copy.
        reps = [r for r in owner.get(eid, []) if r in in_product] or owner.get(eid, [])
        it.use_units(reps[0] if reps else None)
        if t == "MANIFOLD_SOLID_BREP":
            body = it.body([(a[1], False)], "solid", a[0] or "")
        elif t == "BREP_WITH_VOIDS":
            body = it.body([(a[1], False)] + [(v, False) for v in a[2]], "solid", a[0] or "")
        else:
            body = it.body([(s, False) for s in a[1]], "sheet", a[0] or "")
        body.color = it.colors.get(eid)
        # A body listed by several representations (some exporters put it in two that
        # are related to each other) is the same body where both put it at the same
        # place. Instances of one representation stay, even where they coincide.
        mats: list[np.ndarray] = []
        for r in reps:
            seen = list(mats)
            for m in transforms.get(r, [np.eye(4)]):
                if not any(np.allclose(m, q, rtol=0.0, atol=1e-9 * max(1.0, float(np.abs(m).max()))) for q in seen):
                    mats.append(m)
        for m in mats or [np.eye(4)]:
            bodies.append((body, m))
    return bodies


def _owning_representations(sf: StepFile) -> dict[int, list[int]]:
    owner: dict[int, list[int]] = {}
    for eid, (t, a) in sf.entities.items():
        if t.endswith("REPRESENTATION") and len(a) >= 2 and isinstance(a[1], list):
            for item in a[1]:
                if isinstance(item, Ref):
                    owner.setdefault(int(item), []).append(eid)
    return owner


def _rep_items(sf: StepFile) -> dict[int, set[int]]:
    items: dict[int, set[int]] = {}
    for eid, (t, a) in sf.entities.items():
        if t.endswith("REPRESENTATION") and len(a) >= 2 and isinstance(a[1], list):
            items[eid] = {int(x) for x in a[1] if isinstance(x, Ref)}
    for eid, parts in sf.complex.items():
        for k, a in parts.items():
            if k.endswith("REPRESENTATION") and len(a) >= 2 and isinstance(a[1], list):
                items[eid] = {int(x) for x in a[1] if isinstance(x, Ref)}
    return items


def _representation_transforms(it: _Interp) -> tuple[dict[int, list[np.ndarray]], set[int]]:
    """World transforms of each representation, following the assembly structure, and the
    representations that belong to the product structure (a product's shape, or linked to
    one).

    Exporters disagree on which side of a representation relationship is the parent, so
    the product structure (NEXT_ASSEMBLY_USAGE_OCCURRENCE) decides where it can.
    """
    sf = it.sf
    items = _rep_items(sf)
    # product definition -> its shape representation
    pd_rep: dict[int, int] = {}
    for eid, (t, a) in sf.entities.items():
        if t == "SHAPE_DEFINITION_REPRESENTATION":
            try:
                dt, da = sf.get(a[0])
                if dt == "PRODUCT_DEFINITION_SHAPE" and "PRODUCT_DEFINITION" in sf.type_of(da[2]):
                    pd_rep[int(da[2])] = int(a[1])
            except Exception:
                continue
    # relationship -> (parent product definition, child product definition)
    rel_products: dict[int, tuple[int, int]] = {}
    for eid, (t, a) in sf.entities.items():
        if t == "CONTEXT_DEPENDENT_SHAPE_REPRESENTATION":
            try:
                pt, pa = sf.get(a[1])
                nt, na = sf.get(pa[2])
                if "ASSEMBLY_USAGE_OCCURRENCE" in nt or nt == "PRODUCT_DEFINITION_USAGE":
                    rel_products[int(a[0])] = (int(na[3]), int(na[4]))
            except Exception:
                continue

    parent_of: dict[int, list[tuple[int, np.ndarray]]] = {}

    def link(child: int, parent: int, m: np.ndarray) -> None:
        parent_of.setdefault(child, []).append((parent, m))

    for eid, parts in sf.complex.items():
        if "REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION" in parts and "REPRESENTATION_RELATIONSHIP" in parts:
            rr = parts["REPRESENTATION_RELATIONSHIP"]
            r1, r2 = int(rr[2]), int(rr[3])
            tr = parts["REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION"][0]
            child, parent = r1, r2  # CAx-IF convention
            if eid in rel_products:
                ppd, cpd = rel_products[eid]
                if pd_rep.get(ppd) == r1 or pd_rep.get(cpd) == r2:
                    child, parent = r2, r1
            m = _item_transform(it, tr, child, parent, items)
            if m is not None:
                link(child, parent, m)
    for eid, (t, a) in sf.entities.items():
        if t in ("SHAPE_REPRESENTATION_RELATIONSHIP", "REPRESENTATION_RELATIONSHIP") and len(a) >= 4:
            r1, r2 = int(a[2]), int(a[3])
            # the representation that is a product's main shape is the parent
            prod_reps = set(pd_rep.values())
            if r1 in prod_reps and r2 not in prod_reps:
                link(r2, r1, np.eye(4))
            elif r2 in prod_reps and r1 not in prod_reps:
                link(r1, r2, np.eye(4))
            else:
                link(r2, r1, np.eye(4))
        elif t == "MAPPED_ITEM":
            try:
                mt, ma = sf.get(a[1])  # REPRESENTATION_MAP(origin, mapped representation)
                it.use_units(int(ma[1]))
                origin = it.placement_matrix(ma[0])
                for rep, its in items.items():
                    if eid in its:
                        it.use_units(rep)
                        link(int(ma[1]), rep, it.placement_matrix(a[2]) @ np.linalg.inv(origin))
            except Exception:
                continue

    cache: dict[int, list[np.ndarray]] = {}

    def world(rep: int, depth: int = 0) -> list[np.ndarray]:
        if rep in cache:
            return cache[rep]
        if depth > 32 or rep not in parent_of:
            return [np.eye(4)]
        out: list[np.ndarray] = []
        for parent, m in parent_of[rep]:
            for pm in world(parent, depth + 1):
                out.append(pm @ m)
        cache[rep] = out or [np.eye(4)]
        return cache[rep]

    product_reps = set(pd_rep.values())
    linked: dict[int, bool] = {}

    def in_product(rep: int, depth: int = 0) -> bool:
        if rep not in linked:
            linked[rep] = False  # guards against cycles
            linked[rep] = rep in product_reps or (depth < 32 and any(
                in_product(parent, depth + 1) for parent, _ in parent_of.get(rep, [])))
        return linked[rep]

    return {r: world(r) for r in items}, {r for r in items if in_product(r)}


def _item_transform(it: _Interp, ref: Any, child: int, parent: int, items: dict[int, set[int]]) -> np.ndarray | None:
    """Placement of the child representation in the parent's coordinates."""
    sf = it.sf
    t, a = sf.get(ref)
    if t != "ITEM_DEFINED_TRANSFORMATION":
        return None
    try:
        i1, i2 = int(a[2]), int(a[3])
        # item 2 lies in the parent's representation and item 1 in the child's (CAx-IF),
        # unless the representations' item lists say otherwise
        if i1 in items.get(parent, set()) or i2 in items.get(child, set()):
            parent_item, child_item = i1, i2
        else:
            parent_item, child_item = i2, i1
        it.use_units(parent)
        m1 = it.placement_matrix(parent_item)
        it.use_units(child)
        m2 = it.placement_matrix(child_item)
        return m1 @ np.linalg.inv(m2)
    except Exception:
        return None
    finally:
        it.use_units(None)
