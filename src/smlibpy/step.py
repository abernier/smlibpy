"""STEP (ISO 10303-21, AP214) writer for exact B-rep geometry.

Planes, cylinders, cones, spheres, tori, lines, circles and ellipses are written as
their analytic STEP entities, offset surfaces as OFFSET_SURFACEs of their basis, everything
else as (rational) B-spline curves and surfaces with the kernel's exact control points and
knots. Solids become MANIFOLD_SOLID_BREPs (BREP_WITH_VOIDS for hollow ones), sheets become
open shells, curves and points a GEOMETRIC_CURVE_SET of wireframe geometry, coordinate systems
named placements of supplemental geometry (CONSTRUCTIVE_GEOMETRY_REPRESENTATION). All of it
goes into one product, or, as an assembly, each body into a product of its own under a root
product.
"""

from __future__ import annotations

import datetime as _dt
import math
import re
import warnings
from typing import Any, Iterable, Sequence

import numpy as np

from ._kernel import ext, k, kernel_call
from .geometry import Vector

__all__ = ["write_step"]

_UNITS = {
    "mm": "(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))",
    "m": "(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.))",
    "cm": "(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.CENTI.,.METRE.))",
    "um": "(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MICRO.,.METRE.))",
}
_INCH = 25.4
#: millimeters per declared unit
_MM_PER_UNIT = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "um": 0.001, "inch": _INCH, "in": _INCH}
#: the length uncertainty a file declares, in millimeters (written in the file's unit)
_UNCERTAINTY_MM = 1e-7


def _r(v: float) -> str:
    """A STEP REAL literal."""
    v = float(v)
    if not math.isfinite(v):
        raise ValueError("non-finite number in STEP output")
    if v == 0.0:
        return "0."
    s = repr(v)
    if "e" in s or "E" in s:
        mant, exp = re.split("[eE]", s)
        if "." not in mant:
            mant += "."
        return f"{mant}E{int(exp)}"
    if "." not in s:
        s += "."
    return s


def _s(text: str | None) -> str:
    """A STEP STRING literal: quotes doubled, backslashes too, and characters outside printable
    ASCII in ISO 10303-21's ``\\X2\\...\\X0\\`` (``\\X4\\`` beyond the 16-bit range)."""
    out = []
    run, kind = "", ""  # hex digits of the characters encoded so far, and their encoding
    for ch in (text or "") + "'":  # (the closing quote ends the last run)
        c = ord(ch)
        enc = "" if 0x20 <= c <= 0x7E else "X2" if c <= 0xFFFF else "X4"
        if run and enc != kind:
            out.append(f"\\{kind}\\{run}\\X0\\")
            run = ""
        if enc:
            run, kind = run + (f"{c:04X}" if enc == "X2" else f"{c:08X}"), enc
        else:
            out.append("''" if ch == "'" else "\\\\" if ch == "\\" else ch)
    return "'" + "".join(out)[:-2] + "'"


def _color(c: Any) -> tuple[float, float, float] | None:
    if c is None:
        return None
    if isinstance(c, str):
        from .colors import to_rgb

        return to_rgb(c)
    r, g, b = (float(x) for x in list(c)[:3])
    if max(r, g, b) > 1.0:
        r, g, b = r / 255, g / 255, b / 255
    return (r, g, b)


class _Writer:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self._points: dict[tuple[float, float, float], int] = {}
        self._dirs: dict[tuple[float, float, float], int] = {}

    def add(self, text: str) -> int:
        self.lines.append(text)
        return len(self.lines)

    def point(self, p: Sequence[float]) -> int:
        key = (float(p[0]), float(p[1]), float(p[2]))
        if key not in self._points:
            self._points[key] = self.add(f"CARTESIAN_POINT('',({_r(key[0])},{_r(key[1])},{_r(key[2])}))")
        return self._points[key]

    def direction(self, d: Sequence[float]) -> int:
        v = np.asarray(d, dtype=float)
        v = v / np.linalg.norm(v)
        key = (float(v[0]), float(v[1]), float(v[2]))
        if key not in self._dirs:
            self._dirs[key] = self.add(f"DIRECTION('',({_r(key[0])},{_r(key[1])},{_r(key[2])}))")
        return self._dirs[key]

    def axis2(self, origin: Sequence[float], z: Sequence[float], x: Sequence[float]) -> int:
        return self.add(f"AXIS2_PLACEMENT_3D('',#{self.point(origin)},#{self.direction(z)},#{self.direction(x)})")

    def text(self, header: list[str]) -> str:
        out = ["ISO-10303-21;", "HEADER;", *header, "ENDSEC;", "DATA;"]
        out.extend(f"#{i}={line};" for i, line in enumerate(self.lines, 1))
        out += ["ENDSEC;", "END-ISO-10303-21;", ""]
        return "\n".join(out)


def _mults(knots: Sequence[float]) -> tuple[list[float], list[int]]:
    uniq: list[float] = []
    mult: list[int] = []
    for kv in knots:
        if uniq and abs(kv - uniq[-1]) <= 1e-14 * max(1.0, abs(kv)):
            mult[-1] += 1
        else:
            uniq.append(float(kv))
            mult.append(1)
    return uniq, mult


def _ints(v: Iterable[int]) -> str:
    return "(" + ",".join(str(int(x)) for x in v) + ")"


def _reals(v: Iterable[float]) -> str:
    return "(" + ",".join(_r(x) for x in v) + ")"


def _orthonormal(z: Sequence[float], x: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
    zz = np.asarray(z, dtype=float)
    zz /= np.linalg.norm(zz)
    xx = np.asarray(x, dtype=float)
    xx = xx - zz * xx.dot(zz)
    xx /= np.linalg.norm(xx)
    return zz, xx


def _writable(s: dict[str, Any]) -> bool:
    """A surface of the dump the writer writes exactly: an analytic one, or one with control points."""
    return s["kind"] in ("plane", "cylinder", "cone", "sphere", "torus") or "poles" in s


def _offset_basis(f: dict[str, Any]) -> dict[str, Any] | None:
    """The basis an offset face is written on: the kernel's, or the extension of it the kernel
    evaluates where the face reaches past the basis; None where neither holds the face or can be
    written."""
    s = f["surface"]
    (fu0, fv0), (fu1, fv1) = f["uv_domain"]
    for basis in (s.get("basis"), s.get("extended")):
        if basis is None or not _writable(basis):
            continue
        (u0, v0), (u1, v1) = basis["uv_domain"]
        tol = 1e-9 * max(1.0, u1 - u0, v1 - v0)
        if u0 - tol <= fu0 and fu1 <= u1 + tol and v0 - tol <= fv0 and fv1 <= v1 + tol:
            return basis
    return None


def _inexact(f: dict[str, Any]) -> str | None:
    """Why the writer cannot write a face of the dump exactly, or None."""
    s = f["surface"]
    if s["kind"] == "offset":
        if _offset_basis(f) is not None:
            return None
        basis = s.get("basis")
        if basis is None or not _writable(basis):
            return f"an offset of a surface of kind {basis['kind'] if basis else 'unknown'!r}"
        return "an offset surface that reaches past its basis"
    return None if _writable(s) else f"a surface of kind {s['kind']!r}"


class _BodyWriter:
    """Writes the topology of one kernel Brep."""

    def __init__(self, w: _Writer, brep: Any):
        self.w = w
        self.brep = brep
        self.dump = ext.brep_dump(brep, True)
        inexact = [why for why in map(_inexact, self.dump["faces"]) if why]
        if inexact:
            raise _NeedsNurbs(f"{len(inexact)} {'face' if len(inexact) == 1 else 'faces'} on "
                              f"{'; '.join(sorted(set(inexact)))}")
        self.kfaces = brep.faces()
        self.kedges = brep.edges()
        self.vertex_ids: dict[int, int] = {}
        self.edge_ids: dict[int, int] = {}
        # the faces' own colors and names, and the ADVANCED_FACE items written for each face (a face
        # between two cells of a merged part is written in each) (kernel plan T5)
        self.face_colors, self.face_names = ext.face_attrs(brep)
        self.face_items: dict[int, list[int]] = {}

    # -- geometry -------------------------------------------------------------
    def bspline_curve(self, c: dict[str, Any]) -> int:
        return _bspline_curve(self.w, c)

    def curve(self, idx: int) -> tuple[int, bool]:
        """STEP curve for edge ``idx`` and whether the edge runs along its parameterisation."""
        e = self.dump["edges"][idx]
        c = e["curve"]
        w = self.w
        kind = c["kind"]
        t0, t1 = e["interval"]
        if kind == "line":
            ke = self.kedges[idx]
            a = np.array(ke.curve().evaluate(t0))
            b = np.array(ke.curve().evaluate(t1))
            d = b - a
            L = float(np.linalg.norm(d))
            vec = w.add(f"VECTOR('',#{w.direction(d / L)},{_r(L)})")
            return w.add(f"LINE('',#{w.point(a)},#{vec})"), True
        if kind in ("circle", "ellipse"):
            pl = c["placement"]
            z, x = _orthonormal(pl["z_dir"], pl["x_dir"])
            ax = w.axis2(pl["origin"], z, x)
            if kind == "circle":
                ent = w.add(f"CIRCLE('',#{ax},{_r(c['radius'])})")
            else:
                r1, r2 = c["radius1"], c["radius2"]
                if r1 >= r2:
                    ent = w.add(f"ELLIPSE('',#{ax},{_r(r1)},{_r(r2)})")
                else:  # STEP wants semi_axis_1 >= semi_axis_2: rotate the frame by 90 degrees
                    y = np.cross(z, x)
                    ax = w.axis2(pl["origin"], z, y)
                    ent = w.add(f"ELLIPSE('',#{ax},{_r(r2)},{_r(r1)})")
            # sense: STEP conics run counterclockwise about their axis
            ke = self.kedges[idx]
            tm = 0.5 * (t0 + t1)
            p, dp = (np.array(v) for v in ext.curve_eval(ke.curve(), tm, 1))
            ccw = np.cross(z, p - np.array(pl["origin"]))
            return ent, bool(np.dot(dp, ccw) > 0)
        return self.bspline_curve(c), True

    def surface(self, idx: int) -> tuple[int, bool]:
        """STEP surface for face ``idx`` and whether its STEP normal runs along the kernel's natural
        normal of the face's surface."""
        f = self.dump["faces"][idx]
        s = f["surface"]
        if s["kind"] == "offset":
            # OFFSET_SURFACE moves its basis along the basis's STEP normal, the kernel along the
            # basis's natural normal; an offset surface's normal is its basis's in both.
            basis = _offset_basis(f)
            assert basis is not None  # (checked in __init__)
            ent, normal_fn = self._surface(basis)
            agrees = self._agrees(idx, normal_fn)
            distance = float(s["distance"]) if agrees else -float(s["distance"])
            return self.w.add(f"OFFSET_SURFACE('',#{ent},{_r(distance)},.F.)"), agrees
        ent, normal_fn = self._surface(s)
        return ent, self._agrees(idx, normal_fn)

    def _surface(self, s: dict[str, Any]) -> tuple[int, Any]:
        """STEP surface for a surface of the dump and, for analytic surfaces, how its STEP normal
        runs."""
        w = self.w
        kind = s["kind"]
        pl = s.get("placement")
        if kind == "plane":
            z, x = _orthonormal(pl["z_dir"], pl["x_dir"])
            return w.add(f"PLANE('',#{w.axis2(pl['origin'], z, x)})"), ("plane", z)
        if kind == "cylinder":  # (SMLib's own cylinders are cones of angle 0; imported ones are these)
            z, x = _orthonormal(pl["z_dir"], pl["x_dir"])
            o = np.array(pl["origin"], dtype=float)
            return w.add(f"CYLINDRICAL_SURFACE('',#{w.axis2(o, z, x)},{_r(s['radius'])})"), ("cylinder", o, z)
        if kind == "cone":
            z, x = _orthonormal(pl["z_dir"], pl["x_dir"])
            semi = float(s.get("semi_angle_deg", 0.0))
            o = np.array(pl["origin"], dtype=float)
            r = float(s["radius"])
            if abs(semi) < 1e-12:
                return w.add(f"CYLINDRICAL_SURFACE('',#{w.axis2(o, z, x)},{_r(r)})"), ("cylinder", o, z)
            if semi < 0:
                z, semi = -z, -semi
            ang = math.radians(semi)
            return (w.add(f"CONICAL_SURFACE('',#{w.axis2(o, z, x)},{_r(r)},{_r(ang)})"),
                    ("cone", o, z, r, ang))
        if kind == "sphere":
            z, x = _orthonormal(pl["z_dir"], pl["x_dir"])
            o = np.array(pl["origin"], dtype=float)
            return w.add(f"SPHERICAL_SURFACE('',#{w.axis2(o, z, x)},{_r(s['radius'])})"), ("sphere", o)
        if kind == "torus":
            z, x = _orthonormal(pl["z_dir"], pl["x_dir"])
            o = np.array(pl["origin"], dtype=float)
            R, r = float(s["major_radius"]), float(s["minor_radius"])
            return (w.add(f"TOROIDAL_SURFACE('',#{w.axis2(o, z, x)},{_r(R)},{_r(r)})"), ("torus", o, z, R))
        return self.bspline_surface(s), None

    def bspline_surface(self, s: dict[str, Any]) -> int:
        w = self.w
        uu, um = _mults(s["u_knots"])
        vu, vm = _mults(s["v_knots"])
        nu = len(s["u_knots"]) - s["u_degree"] - 1
        nv = len(s["v_knots"]) - s["v_degree"] - 1
        poles = s["poles"]
        rows = []
        for i in range(nu):
            rows.append("(" + ",".join(f"#{w.point(poles[i * nv + j])}" for j in range(nv)) + ")")
        net = "(" + ",".join(rows) + ")"
        if s["weights"] is None:
            return w.add(f"B_SPLINE_SURFACE_WITH_KNOTS('',{s['u_degree']},{s['v_degree']},{net},.UNSPECIFIED.,"
                         f".F.,.F.,.F.,{_ints(um)},{_ints(vm)},{_reals(uu)},{_reals(vu)},.UNSPECIFIED.)")
        wts = s["weights"]
        wrows = "(" + ",".join("(" + ",".join(_r(wts[i * nv + j]) for j in range(nv)) + ")" for i in range(nu)) + ")"
        return w.add(
            f"(BOUNDED_SURFACE() B_SPLINE_SURFACE({s['u_degree']},{s['v_degree']},{net},.UNSPECIFIED.,.F.,.F.,.F.) "
            f"B_SPLINE_SURFACE_WITH_KNOTS({_ints(um)},{_ints(vm)},{_reals(uu)},{_reals(vu)},.UNSPECIFIED.) "
            f"GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_SURFACE({wrows}) REPRESENTATION_ITEM('') SURFACE())")

    # -- topology -------------------------------------------------------------
    def vertex(self, idx: int) -> int:
        if idx not in self.vertex_ids:
            self.vertex_ids[idx] = self.w.add(f"VERTEX_POINT('',#{self.w.point(self.dump['vertices'][idx])})")
        return self.vertex_ids[idx]

    def edge(self, idx: int) -> int:
        if idx not in self.edge_ids:
            e = self.dump["edges"][idx]
            crv, sense = self.curve(idx)
            v0, v1 = self.vertex(e["v0"]), self.vertex(e["v1"])
            if sense:
                self.edge_ids[idx] = self.w.add(f"EDGE_CURVE('',#{v0},#{v1},#{crv},.T.)")
            else:
                self.edge_ids[idx] = self.w.add(f"EDGE_CURVE('',#{v0},#{v1},#{crv},.F.)")
        return self.edge_ids[idx]

    def face(self, idx: int, use: dict[str, Any]) -> int:
        """ADVANCED_FACE for face ``idx`` seen from faceuse ``use`` (its normal is the face normal)."""
        w = self.w
        srf, agrees = self.surface(idx)
        bounds = []
        for loop in use["loops"]:
            if loop["vertex"] is not None and not loop["edges"]:
                lp = w.add(f"VERTEX_LOOP('',#{self.vertex(loop['vertex'])})")
            else:
                oes = []
                for eidx, forward in loop["edges"]:
                    flag = ".T." if forward else ".F."
                    oe = w.add(f"ORIENTED_EDGE('',*,*,#{self.edge(eidx)},{flag})")
                    oes.append(f"#{oe}")
                lp = w.add(f"EDGE_LOOP('',({','.join(oes)}))")
            kind = "FACE_OUTER_BOUND" if loop["outer"] else "FACE_BOUND"
            bound = w.add(f"{kind}('',#{lp},.T.)")
            bounds.append(f"#{bound}")
        # The faceuse normal is the kernel's natural normal when the faceuse is SAME.
        same = bool(use["same"]) == agrees
        name = self.face_names[idx]
        item = w.add(f"ADVANCED_FACE({_s(name)},({','.join(bounds)}),#{srf},{'.T.' if same else '.F.'})")
        self.face_items.setdefault(idx, []).append(item)
        return item

    def _agrees(self, idx: int, normal_fn: Any) -> bool:
        """Whether the STEP normal of an analytic surface (``normal_fn``) runs along the kernel's
        natural normal of face ``idx``'s surface. (B-splines are written with the kernel's own
        parameterisation, so their normals agree.) The analytic normals are those of the whole
        family of parallel surfaces, so they hold on an offset of the surface too."""
        if normal_fn is None:
            return True
        kf = self.kfaces[idx]
        kind = normal_fn[0]
        with kernel_call("export STEP"):
            try:
                p = np.array(kf.interior_point())
                _, uvs, _ = k.surface_closest_point(kf.surface(), tuple(p))
                u, v = uvs[0].x, uvs[0].y
            except RuntimeError:
                # The kernel finds no point inside the face (it searches the face's parameter
                # domain along 20 lines, and a narrow strip can lie between them). The sense is a
                # property of the whole surface: the middle of the domain will do.
                (u0, v0), (u1, v1) = kf.uv_domain()
                u, v = 0.5 * (u0 + u1), 0.5 * (v0 + v1)
                p = np.array(kf.point_at_uv(u, v))
            if kind in ("cone", "torus"):
                o, z = normal_fn[1], normal_fn[2]
                d = p - o
                if np.linalg.norm(d - z * d.dot(z)) < 1e-9 * max(1.0, np.linalg.norm(d)):
                    # The point is on the axis (the apex of a cone): no radial direction there.
                    # The sense is a property of the whole surface, so any other point will do.
                    (u0, v0), (u1, v1) = kf.uv_domain()
                    u, v = 0.5 * (u0 + u1), 0.5 * (v0 + v1)
                    p = np.array(kf.point_at_uv(u, v))
            n_kernel = np.array(kf.normal_at_uv(u, v))
        if kind == "plane":
            n_step = normal_fn[1]
        elif kind == "cylinder":
            o, z = normal_fn[1], normal_fn[2]
            d = p - o
            n_step = d - z * d.dot(z)
        elif kind == "cone":
            o, z, r, ang = normal_fn[1:]
            d = p - o
            radial = d - z * d.dot(z)
            radial /= np.linalg.norm(radial)
            n_step = radial * math.cos(ang) - z * math.sin(ang)
        elif kind == "sphere":
            n_step = p - normal_fn[1]
        else:  # torus
            o, z, R = normal_fn[1:]
            d = p - o
            radial = d - z * d.dot(z)
            radial /= np.linalg.norm(radial)
            n_step = p - (o + radial * R)
        return bool(np.dot(n_kernel, n_step) > 0)

    def solids(self, name: str, names: Sequence[str | None] | None = None) -> list[int]:
        """MANIFOLD_SOLID_BREP / BREP_WITH_VOIDS items, one per material region, named ``name`` or,
        per region, ``names`` (the cells of a merged part); ``self.cells`` holds the region each
        item is of (counting the regions that are not cavities)."""
        d = self.dump
        items = []
        self.cells: list[int] = []
        cell = -1
        shell_faces: dict[int, list[tuple[int, dict[str, Any]]]] = {}
        for fi, f in enumerate(d["faces"]):
            for ui, use in enumerate(f["uses"]):
                if use is None or use["shell"] is None:
                    continue
                # The faceuse in a region's shell faces into that region; its mate faces out.
                mate = f["uses"][1 - ui]
                shell_faces.setdefault(use["shell"], []).append((fi, mate))
        for region in d["regions"]:
            if region["infinite"] or region["void"]:
                continue
            cell += 1
            label = names[cell] if names is not None and cell < len(names) and names[cell] else name
            shells = []
            for si in region["shells"]:
                faces = [self.face(fi, mate) for fi, mate in shell_faces.get(si, [])]
                shells.append(self.w.add(f"CLOSED_SHELL('',({','.join(f'#{x}' for x in faces)}))"))
            if not shells:
                continue
            if len(shells) == 1:
                items.append(self.w.add(f"MANIFOLD_SOLID_BREP({_s(label)},#{shells[0]})"))
            else:
                voids = [self.w.add(f"ORIENTED_CLOSED_SHELL('',*,#{s},.F.)") for s in shells[1:]]
                items.append(self.w.add(f"BREP_WITH_VOIDS({_s(label)},#{shells[0]},({','.join(f'#{v}' for v in voids)}))"))
            self.cells.append(cell)
        return items

    def sheets(self, name: str) -> list[int]:
        """An OPEN_SHELL of all faces (seen from their natural side)."""
        faces = []
        for fi, f in enumerate(self.dump["faces"]):
            faces.append(self.face(fi, f["uses"][0]))
        if not faces:
            return []
        shell = self.w.add(f"OPEN_SHELL('',({','.join(f'#{x}' for x in faces)}))")
        return [self.w.add(f"SHELL_BASED_SURFACE_MODEL({_s(name)},(#{shell}))")]


class _NeedsNurbs(Exception):
    """A body has faces the writer cannot write exactly (the message says which)."""


def _bspline_curve(w: _Writer, c: dict[str, Any], name: str = "") -> int:
    """A (rational) B-spline curve of the kernel's control points and knots."""
    pts = ",".join(f"#{w.point(p)}" for p in c["poles"])
    uniq, mult = _mults(c["knots"])
    deg = c["degree"]
    if c["weights"] is None:
        return w.add(f"B_SPLINE_CURVE_WITH_KNOTS({_s(name)},{deg},({pts}),.UNSPECIFIED.,.F.,.F.,{_ints(mult)},"
                     f"{_reals(uniq)},.UNSPECIFIED.)")
    return w.add(
        "(BOUNDED_CURVE() B_SPLINE_CURVE({deg},({pts}),.UNSPECIFIED.,.F.,.F.) "
        "B_SPLINE_CURVE_WITH_KNOTS({m},{kn},.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() "
        "RATIONAL_B_SPLINE_CURVE({ws}) REPRESENTATION_ITEM({nm}))".format(
            deg=deg, pts=pts, m=_ints(mult), kn=_reals(uniq), ws=_reals(c["weights"]), nm=_s(name)))


def _step_items(shapes: Any) -> list[Any]:
    """What ``export_step`` writes, in order: bodies (a face as a sheet), and curves, points and
    coordinate systems as :class:`~smlibpy.StepCurve`, :class:`~smlibpy.StepPoint` and
    :class:`~smlibpy.StepFrame` (an edge or wire is an unnamed curve, a vertex or Vector an
    unnamed point, a Plane an unnamed coordinate system, a StepModel its bodies, coordinate
    systems, curves and points). Anything else is left for ``write_step`` to refuse."""
    from .geometry import Plane
    from .shapes import Edge, Face, Vertex, Wire, _Body
    from .step_import import StepCurve, StepFrame, StepModel, StepPoint

    if isinstance(shapes, (_Body, StepCurve, StepPoint, StepFrame)):
        return [shapes]
    if isinstance(shapes, Face):
        return [shapes.to_shell()]
    if isinstance(shapes, (Edge, Wire)):
        return [StepCurve("", shapes)]
    if isinstance(shapes, Vertex):
        return [StepPoint("", shapes.point)]
    if isinstance(shapes, Vector):
        return [StepPoint("", shapes)]
    if isinstance(shapes, Plane):
        return [StepFrame("", shapes)]
    if isinstance(shapes, StepModel):
        return [*shapes.bodies, *shapes.frames, *shapes.curves, *shapes.points]
    if isinstance(shapes, (str, bytes)) or not isinstance(shapes, Iterable):
        return [shapes]
    out: list[Any] = []
    for s in shapes:
        out.extend(_step_items(s))
    return out


def _edge_curve(w: _Writer, edge: Any, name: str = "", scale: float = 1.0) -> int:
    """A bounded STEP curve along an edge, from its start to its end: a TRIMMED_CURVE of a line,
    circle or ellipse (its trims in length units and radians), or a B-spline (other curves
    approximated within 1e-7, as :meth:`~smlibpy.Edge.nurbs` does). ``scale``: file units per mm."""
    kind = edge.geom_type
    a, b = np.array(edge.start, dtype=float) * scale, np.array(edge.end, dtype=float) * scale

    def trimmed(basis: int, t0: float, t1: float, ends: bool = True) -> int:
        lo = f"(#{w.point(a)},PARAMETER_VALUE({_r(t0)}))" if ends else f"(PARAMETER_VALUE({_r(t0)}))"
        hi = f"(#{w.point(b)},PARAMETER_VALUE({_r(t1)}))" if ends else f"(PARAMETER_VALUE({_r(t1)}))"
        return w.add(f"TRIMMED_CURVE({_s(name)},#{basis},{lo},{hi},.T.,.PARAMETER.)")

    if kind == "line":
        d = b - a
        L = float(np.linalg.norm(d))
        if L <= 0.0:
            raise ValueError("cannot write a line of length 0 to STEP")
        vec = w.add(f"VECTOR('',#{w.direction(d / L)},1.)")  # (parameters are lengths along it)
        return trimmed(w.add(f"LINE('',#{w.point(a)},#{vec})"), 0.0, L)
    if kind in ("circle", "ellipse"):
        c = ext.curve_data(edge._curve(), False)
        pl = c["placement"]
        o = np.array(pl["origin"], dtype=float) * scale
        z, x = _orthonormal(pl["z_dir"], pl["x_dir"])
        if np.dot(np.array(edge.tangent_at(0.5)), np.cross(z, np.array(edge.point_at(0.5)) * scale - o)) < 0:
            z = -z  # STEP's conics run counterclockwise about their axis: this one along the edge
        r1, r2 = (float(c["radius"]),) * 2 if kind == "circle" else (float(c["radius1"]), float(c["radius2"]))
        r1, r2 = r1 * scale, r2 * scale
        if r1 < r2:  # STEP wants semi_axis_1 >= semi_axis_2: turn the frame by 90 degrees
            x, r1, r2 = np.cross(z, x), r2, r1
        y = np.cross(z, x)

        def angle(p: np.ndarray) -> float:
            d = p - o
            return math.atan2(float(d.dot(y)) / r2, float(d.dot(x)) / r1)

        t0 = angle(a)
        span = (angle(b) - t0) % (2 * math.pi)
        if edge.is_closed or span < 1e-12:
            span = 2 * math.pi
        ax = w.axis2(o, z, x)
        basis = w.add(f"CIRCLE('',#{ax},{_r(r1)})" if kind == "circle" else f"ELLIPSE('',#{ax},{_r(r1)},{_r(r2)})")
        return trimmed(basis, t0, t0 + span)
    crv = edge._copy_curve()
    try:
        with kernel_call("export STEP"):
            c = ext.curve_data(crv, True)
    finally:
        ext.delete_curve(crv)
    c = dict(c, poles=[tuple(float(x) * scale for x in p) for p in c["poles"]])
    lo, hi = (float(t) for t in c["interval"])
    knots, deg = c["knots"], int(c["degree"])
    tol = 1e-12 * max(1.0, abs(lo), abs(hi))
    if abs(knots[deg] - lo) <= tol and abs(knots[-deg - 1] - hi) <= tol:
        return _bspline_curve(w, c, name)
    return trimmed(_bspline_curve(w, c), lo, hi, ends=False)  # (the edge uses part of the curve)


def _wireframe(w: _Writer, ctx: int, label: str, extras: Sequence[Any],
               scale: float = 1.0) -> tuple[list[tuple[int, bool]], list[tuple[int, Any, str]]]:
    """The representations of curves, points and coordinate systems: a GEOMETRICALLY_BOUNDED_
    WIREFRAME_SHAPE_REPRESENTATION of one GEOMETRIC_CURVE_SET (curves, a wire as a composite
    curve, named points) and a CONSTRUCTIVE_GEOMETRY_REPRESENTATION of the coordinate systems
    (CAx-IF's supplemental geometry), as ``(representation, is_constructive)``. The second list
    holds what is colored (curves, points and coordinate systems, the latter with a curve style), as
    ``(item, rgb, style)``. ``scale``: file units per mm."""
    from .shapes import Wire
    from .step_import import StepCurve, StepFrame, StepPoint

    elements: list[int] = []
    frames: list[int] = []
    styled: list[tuple[int, Any, str]] = []
    for item in extras:
        if isinstance(item, StepCurve):
            if isinstance(item.shape, Wire):
                edges = list(item.shape.edges())
                closed = item.shape.is_closed
                segments = []
                for i, e in enumerate(edges):
                    last = i == len(edges) - 1
                    code = ".DISCONTINUOUS." if last and not closed else ".CONTINUOUS."
                    segments.append(w.add(f"COMPOSITE_CURVE_SEGMENT({code},.T.,#{_edge_curve(w, e, '', scale)})"))
                ent = w.add(f"COMPOSITE_CURVE({_s(item.name)},({','.join(f'#{x}' for x in segments)}),.U.)")
            else:
                ent = _edge_curve(w, item.shape, item.name, scale)
            elements.append(ent)
            styled.append((ent, item.color, "curve"))
        elif isinstance(item, StepPoint):
            p = item.point * scale
            ent = w.add(f"CARTESIAN_POINT({_s(item.name)},({_r(p.x)},{_r(p.y)},{_r(p.z)}))")
            elements.append(ent)
            styled.append((ent, item.color, "point"))
        elif isinstance(item, StepFrame):
            pl = item.plane
            o, z, x = w.point(pl.origin * scale), w.direction(pl.z_dir), w.direction(pl.x_dir)
            ent = w.add(f"AXIS2_PLACEMENT_3D({_s(item.name)},#{o},#{z},#{x})")
            frames.append(ent)
            styled.append((ent, item.color, "curve"))  # (as NX colors its coordinate systems)
    reps = []
    if elements:
        gcs = w.add(f"GEOMETRIC_CURVE_SET('',({','.join(f'#{x}' for x in elements)}))")
        rep = w.add(f"GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION({_s(label)},(#{gcs}),#{ctx})")
        reps.append((rep, False))
    if frames:
        reps.append((w.add(f"CONSTRUCTIVE_GEOMETRY_REPRESENTATION('supplemental geometry',"
                           f"({','.join(f'#{x}' for x in frames)}),#{ctx})"), True))
    return reps, [x for x in styled if x[1] is not None]


def write_step(bodies: Sequence[Any], path: str, *, unit: str = "mm", name: str | None = None,
               author: str = "", organization: str = "", assembly: bool = False) -> None:
    """Write bodies (parts and sheets), curves, points and coordinate systems
    (:class:`~smlibpy.StepCurve`, :class:`~smlibpy.StepPoint`, :class:`~smlibpy.StepFrame`) to a
    STEP file (see :func:`_step_text`)."""
    text = _step_text(bodies, path, unit=unit, name=name, author=author, organization=organization,
                      assembly=assembly)
    with open(path, "w", encoding="ascii") as fh:
        fh.write(text)


def _step_text(bodies: Sequence[Any], path: str, *, unit: str = "mm", name: str | None = None,
               author: str = "", organization: str = "", assembly: bool = False) -> str:
    """The text of a STEP file of bodies (parts and sheets), curves, points and coordinate systems
    (:class:`~smlibpy.StepCurve`, :class:`~smlibpy.StepPoint`, :class:`~smlibpy.StepFrame`), for
    the file ``path`` ("" for none: the product is called "part" unless ``name`` says otherwise).

    The model is in millimeters; with another ``unit`` the coordinates are converted to
    it, so the file holds the same part measured in that unit. With ``assembly`` each body
    is a product of its own (named as the body) in a root product called ``name``; a body
    listed more than once is written once and placed as often. Curves, points and coordinate
    systems belong to the product: in an assembly to the body's whose name is their
    ``product``, the others to the root.
    """
    from .shapes import Part, _Body
    from .step_import import StepCurve, StepFrame, StepPoint

    if unit not in _MM_PER_UNIT:
        raise ValueError(f"unknown unit {unit!r}; use mm, cm, m, um or inch")
    for item in bodies:
        if not isinstance(item, (_Body, StepCurve, StepPoint, StepFrame)):
            raise TypeError(f"cannot write a {type(item).__name__} to STEP")
    extras = [x for x in bodies if not isinstance(x, _Body)]
    bodies = [x for x in bodies if isinstance(x, _Body)]
    for b in bodies:  # (a body without faces would be left out)
        if b._brep.face_count() == 0:
            what = "export_step" if path else "to_step"
            label = f" {b.name!r}" if b.name else ""
            hint = ("; its edges() are curves, which it writes as such" if b._brep.edge_count() else
                    " (a Boolean that left nothing?)")
            raise ValueError(f"{what}: the {type(b).__name__}{label} is empty: it has no faces to write{hint}")
    if _MM_PER_UNIT[unit] != 1.0:
        f = 1.0 / _MM_PER_UNIT[unit]
        scaled: dict[int, Any] = {}  # (a body listed twice stays one body)
        for b in bodies:
            if id(b._h) not in scaled:
                scaled[id(b._h)] = b.scale(f)
        bodies = [scaled[id(b._h)] for b in bodies]
    w = _Writer()
    product = name or _product_name(path)
    app = w.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')")
    w.add(f"APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#{app})")
    pctx = w.add(f"PRODUCT_CONTEXT('',#{app},'mechanical')")
    dctx_holder: list[int] = []

    def new_product(label: str) -> tuple[int, int]:
        """A PRODUCT with its definition: (PRODUCT_DEFINITION, PRODUCT_DEFINITION_SHAPE)."""
        prod = w.add(f"PRODUCT({_s(label)},{_s(label)},'',(#{pctx}))")
        w.add(f"PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#{prod}))")
        form = w.add(f"PRODUCT_DEFINITION_FORMATION('','',#{prod})")
        if not dctx_holder:
            dctx_holder.append(w.add(f"PRODUCT_DEFINITION_CONTEXT('part definition',#{app},'design')"))
        pdef = w.add(f"PRODUCT_DEFINITION('design','',#{form},#{dctx_holder[0]})")
        return pdef, w.add(f"PRODUCT_DEFINITION_SHAPE('','',#{pdef})")

    pdef, pshape = new_product(product)

    if unit == "inch" or unit == "in":
        mm = w.add("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))")
        lm = w.add(f"LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE({_r(_INCH)}),#{mm})")
        dim = w.add("DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)")
        length = w.add(f"(CONVERSION_BASED_UNIT('INCH',#{lm}) LENGTH_UNIT() NAMED_UNIT(#{dim}))")
    else:
        length = w.add(_UNITS[unit])
    angle = w.add("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))")
    solid_angle = w.add("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())")
    # (the same uncertainty in any unit: 1e-7 mm, to 15 digits in the file's unit)
    uncertainty = float(f"{_UNCERTAINTY_MM / _MM_PER_UNIT[unit]:.15g}")
    unc = w.add(f"UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE({_r(uncertainty)}),#{length},"
                f"'distance_accuracy_value','confusion accuracy')")
    ctx = w.add(f"(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#{unc})) "
                f"GLOBAL_UNIT_ASSIGNED_CONTEXT((#{length},#{angle},#{solid_angle})) "
                f"REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))")

    origin = w.axis2((0, 0, 0), (0, 0, 1), (1, 0, 0))
    styled: list[tuple[int, Any, str]] = []  # (item, color, "surface" | "curve" | "point")

    def items_of(body: Any, label: str) -> list[int]:
        """The solids (or the sheet) of one body, colored as the body: a merged part's cells named
        and colored after the parts they lie in (kernel plan B15), faces of a color of their own
        styled each (T5)."""
        color = body.color
        cells = _cell_labels(body, label) if isinstance(body, Part) else None
        names = [n for n, _ in cells] if cells else None
        try:
            bw = _BodyWriter(w, body._brep)
        except _NeedsNurbs as e:
            warnings.warn(f"export STEP: {label!r} has {e}, which STEP cannot hold as the kernel does: the "
                          f"body is written converted to NURBS (to_nurbs), which approximates them",
                          RuntimeWarning, stacklevel=4)
            body = body.to_nurbs()  # (held while it is written: the writer reads its Brep)
            bw = _BodyWriter(w, body._brep)
        items = bw.solids(label, names) if isinstance(body, Part) else bw.sheets(label)
        if cells:  # a merged part: each cell in the color of the parts it lies in
            colors = [cells[c][1] if c < len(cells) else color for c in bw.cells]
            styled.extend((it, c, "surface") for it, c in zip(items, colors) if _color(c) is not None)
        elif color is not None:
            styled.extend((it, color, "surface") for it in items)
        # faces of their own color: a STYLED_ITEM of the face, over the body's
        for fi, faces in sorted(bw.face_items.items()):
            own = bw.face_colors[fi]
            if own is not None:
                styled.extend((it, (float(own[0]), float(own[1]), float(own[2])), "surface") for it in faces)
        return items

    def representation(kind: str, label: str, axis: int, items: list[int]) -> int:
        return w.add(f"{kind}({_s(label)},(#{axis},{','.join(f'#{x}' for x in items)}),#{ctx})")

    def relate(main: int, others: list[tuple[int, bool]]) -> None:
        """Representations that belong to the same product as ``main`` (its wireframe geometry, its
        coordinate systems)."""
        for rep, constructive in others:
            if constructive:
                w.add(f"CONSTRUCTIVE_GEOMETRY_REPRESENTATION_RELATIONSHIP('supplemental geometry','',#{main},#{rep})")
            else:
                w.add(f"SHAPE_REPRESENTATION_RELATIONSHIP('','',#{main},#{rep})")

    def wireframe(label: str, items: Sequence[Any]) -> list[tuple[int, bool]]:
        reps, colored = _wireframe(w, ctx, label, items, 1.0 / _MM_PER_UNIT[unit])
        styled.extend(colored)
        return reps

    if not assembly:
        solid_items: list[int] = []
        sheet_items: list[int] = []
        for i, body in enumerate(bodies):
            label = body.name or (product if len(bodies) == 1 else f"{product}_{i + 1}")
            (solid_items if isinstance(body, Part) else sheet_items).extend(items_of(body, label))
        reps = []
        if solid_items:
            reps.append((representation("ADVANCED_BREP_SHAPE_REPRESENTATION", product, origin, solid_items), False))
        if sheet_items:
            reps.append((representation("MANIFOLD_SURFACE_SHAPE_REPRESENTATION", product, origin, sheet_items), False))
        reps += wireframe(product, extras)
        if not reps:
            raise ValueError(f"{'export_step' if path else 'to_step'}: nothing to write")
        if reps[0][1]:  # (coordinate systems alone: supplemental geometry of a shape that has no items)
            reps.insert(0, (w.add(f"SHAPE_REPRESENTATION({_s(product)},(#{origin}),#{ctx})"), False))
        w.add(f"SHAPE_DEFINITION_REPRESENTATION(#{pshape},#{reps[0][0]})")
        relate(reps[0][0], reps[1:])
    else:
        # One product per body, its shape in its own representation around its own origin, and
        # one NEXT_ASSEMBLY_USAGE_OCCURRENCE per place it has in the root product (CAx-IF's
        # recommended practices for assemblies): the placement, an ITEM_DEFINED_TRANSFORMATION
        # from the part's origin to an axis in the root's representation, and the shape
        # relationship that carries it. Bodies keep their coordinates: they are placed at the
        # root's origin.
        parts: dict[int, tuple[int, int, int, str]] = {}  # id(handle) -> (definition, rep, origin, name)
        places: list[tuple[int, int]] = []  # (id(handle), the axis it is placed at in the root)
        for i, body in enumerate(bodies):
            key = id(body._h)
            if key not in parts:
                label = body.name or f"{product}_{i + 1}"
                items = items_of(body, label)
                if not items:
                    continue
                part_def, part_shape = new_product(label)
                at = w.axis2((0, 0, 0), (0, 0, 1), (1, 0, 0))
                kind = "ADVANCED_BREP_SHAPE_REPRESENTATION" if isinstance(body, Part) else \
                    "MANIFOLD_SURFACE_SHAPE_REPRESENTATION"
                rep = representation(kind, label, at, items)
                w.add(f"SHAPE_DEFINITION_REPRESENTATION(#{part_shape},#{rep})")
                parts[key] = (part_def, rep, at, label)
            places.append((key, w.axis2((0, 0, 0), (0, 0, 1), (1, 0, 0))))
        if not parts and not extras:
            raise ValueError(f"{'export_step' if path else 'to_step'}: nothing to write")
        axes = ",".join(f"#{x}" for x in [origin] + [a for _, a in places])
        root = w.add(f"SHAPE_REPRESENTATION({_s(product)},({axes}),#{ctx})")
        w.add(f"SHAPE_DEFINITION_REPRESENTATION(#{pshape},#{root})")
        for n, (key, place) in enumerate(places, 1):
            part_def, rep, at, label = parts[key]
            idt = w.add(f"ITEM_DEFINED_TRANSFORMATION('','',#{at},#{place})")
            rel = w.add(f"(REPRESENTATION_RELATIONSHIP('','',#{rep},#{root}) "
                        f"REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#{idt}) SHAPE_REPRESENTATION_RELATIONSHIP())")
            nauo = w.add(f"NEXT_ASSEMBLY_USAGE_OCCURRENCE('{n}',{_s(label)},'',#{pdef},#{part_def},$)")
            occurrence = w.add(f"PRODUCT_DEFINITION_SHAPE({_s(label)},'',#{nauo})")
            w.add(f"CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#{rel},#{occurrence})")
        # curves, points and coordinate systems: with the part their product names, or the root's
        by_label = {label: rep for _, rep, _, label in parts.values()}
        groups: dict[int, list[Any]] = {}
        for item in extras:
            groups.setdefault(by_label.get(item.product, root), []).append(item)
        for rep, items in groups.items():
            label = next((lb for lb, r in by_label.items() if r == rep), product)
            relate(rep, wireframe(label, items))

    if styled:
        style_ids = []
        font: list[int] = []
        for item, color, kind in styled:
            r, g, b = _color(color)  # type: ignore[misc]
            col = w.add(f"COLOUR_RGB('',{_r(r)},{_r(g)},{_r(b)})")
            if kind == "curve":
                if not font:
                    font.append(w.add("DRAUGHTING_PRE_DEFINED_CURVE_FONT('continuous')"))
                style = w.add(f"CURVE_STYLE('',#{font[0]},POSITIVE_LENGTH_MEASURE(0.1),#{col})")
            elif kind == "point":
                style = w.add(f"POINT_STYLE('',MARKER_TYPE(.DOT.),POSITIVE_LENGTH_MEASURE(1.),#{col})")
            else:
                fill = w.add(f"FILL_AREA_STYLE_COLOUR('',#{col})")
                fas = w.add(f"FILL_AREA_STYLE('',(#{fill}))")
                ssfa = w.add(f"SURFACE_STYLE_FILL_AREA(#{fas})")
                sss = w.add(f"SURFACE_SIDE_STYLE('',(#{ssfa}))")
                style = w.add(f"SURFACE_STYLE_USAGE(.BOTH.,#{sss})")
            psa = w.add(f"PRESENTATION_STYLE_ASSIGNMENT((#{style}))")
            style_ids.append(w.add(f"STYLED_ITEM('color',(#{psa}),#{item})"))
        w.add(f"MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',({','.join(f'#{s}' for s in style_ids)}),#{ctx})")

    stamp = _dt.datetime.now().replace(microsecond=0).isoformat()
    header = [
        "FILE_DESCRIPTION(('smlibpy model'),'2;1');",
        f"FILE_NAME({_s(path.split('/')[-1])},{_s(stamp)},({_s(author)}),({_s(organization)}),"
        f"'smlibpy','smlibpy (SMLib kernel)','');",
        "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    ]
    return w.text(header)


def _cell_labels(body: Any, label: str) -> list[tuple[str, Any]] | None:
    """Per cell of a merged part (as ``Part.cells`` names them, without building them): the name and
    color of the parts it lies in, else ``label`` and the part's color; None for a part that does
    not come from a merge, or where the cells' parts cannot be found (kernel plan B15)."""
    from .shapes import _cell_sources, _source_label
    from ._kernel import ModelingError

    try:
        sources = _cell_sources(body)
    except (ModelingError, ValueError):
        return None
    if not sources:
        return None
    return [_source_label(s, label, body.color) for s in sources]


def _product_name(path: str) -> str:
    base = path.replace("\\", "/").split("/")[-1]
    return base.rsplit(".", 1)[0] or "part"
