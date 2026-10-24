"""STEP import: neutral B-rep data from ``step_reader`` -> kernel bodies.

Each face is rebuilt on an exact kernel surface, each edge as an exact curve spanning
exactly that edge (lines, circular arcs, ellipses and NURBS keep their types). The
topology of the file is kept: faces share their edges as they do in the file, so no
stitching is needed. Bodies that still come out invalid are healed, and stitched where
their faces do not share their edges. A body that cannot be read is left out with a
warning; the instances of a product in an assembly are built once and placed.
"""

from __future__ import annotations

import contextlib
import contextvars
import math
import os
import warnings
from dataclasses import dataclass, field
from typing import Any, Iterator

import numpy as np

from ._kernel import BrepHandle, KernelError, ModelingError, ext, k, kernel_call
from .curves import CenterArc, EllipticalArc, Line
from .geometry import Location, Plane, Vector
from .shapes import Edge
from .step_reader import (_BODY_ERRORS, BodyData, StepFile, _body_label, _failure, analytic_offset, interpret,
                          interpret_extras, parse)

__all__ = ["import_step", "read_step", "from_step", "from_step_model", "StepModel", "StepFrame", "StepCurve",
           "StepPoint"]


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def _angle_in(o: np.ndarray, z: np.ndarray, x: np.ndarray, p: np.ndarray) -> float:
    y = np.cross(z, x)
    d = p - o
    return math.atan2(d.dot(y), d.dot(x))


class _Builder:
    def __init__(self, body: BodyData, m: np.ndarray):
        self.b = body
        self.m = m
        self.R = m[:3, :3]
        self.t = m[:3, 3]
        # curve specs of the edges, filled while the faces are read (added seams included)
        self.specs: dict[int, dict[str, Any]] = {}
        # closed edges whose start point must stay where it is: their vertex is shared with
        # other edges, or an added seam already ends there
        uses: dict[int, int] = {}
        for e in body.edges:
            for v in {e["v0"], e["v1"]}:
                uses[v] = uses.get(v, 0) + 1
        self.pinned = {i for i, e in enumerate(body.edges) if uses[e["v0"]] > 1}

    # -- transforms ------------------------------------------------------------
    def P(self, p: Any) -> np.ndarray:
        return self.R @ np.asarray(p, dtype=float) + self.t

    def D(self, d: Any) -> np.ndarray:
        return self.R @ np.asarray(d, dtype=float)

    # -- edges -----------------------------------------------------------------
    def edge_spec(self, ei: int) -> dict[str, Any]:
        """The exact curve of edge ``ei`` from its start to its end vertex, with the ids of those
        vertices (``v0``, ``v1``: build_brep makes one kernel vertex per file vertex)."""
        e = self.b.edges[ei]
        return dict(self._edge_curve(ei), v0=int(e["v0"]), v1=int(e["v1"]))

    def _edge_curve(self, ei: int) -> dict[str, Any]:
        e = self.b.edges[ei]
        c = self.b.curves[e["curve"]]
        p0 = self.P(self.b.vertices[e["v0"]])
        p1 = self.P(self.b.vertices[e["v1"]])
        closed = e["v0"] == e["v1"]
        kind = c["kind"]
        if kind == "line":
            return {"kind": "line", "p0": p0, "p1": p1}
        if kind == "circle":
            o, z = self.P(c["origin"]), _unit(self.D(c["z"]))
            if not e["same_sense"]:
                z = -z
            x = p0 - o
            x = x - z * x.dot(z)
            x = _unit(x)
            if closed:
                sweep = 360.0
            else:
                a = math.degrees(_angle_in(o, z, x, p1)) % 360.0
                sweep = a if a > 1e-9 else 360.0
            return {"kind": "circle", "center": o, "z": z, "x": x, "radius": c["radius"], "sweep": sweep}
        if kind == "ellipse":
            o, z, xa = self.P(c["origin"]), _unit(self.D(c["z"])), _unit(self.D(c["x"]))
            return {"kind": "ellipse", "center": o, "z": z, "x": xa, "r1": c["r1"], "r2": c["r2"],
                    "p0": p0, "p1": p1, "forward": e["same_sense"], "closed": closed}
        if kind in ("hyperbola", "parabola"):
            return _conic_arc(c, self.P(c["origin"]), _unit(self.D(c["z"])), _unit(self.D(c["x"])), p0, p1)
        # NURBS
        poles = np.array([self.P(p) for p in c["poles"]])
        return {"kind": "bspline", "degree": c["degree"], "poles": poles, "knots": list(c["knots"]),
                "weights": c["weights"], "p0": p0, "p1": p1, "forward": e["same_sense"], "closed": closed}

    # -- surfaces ---------------------------------------------------------------
    def loop_points(self, loop: dict[str, Any], n: int = 16) -> list[np.ndarray]:
        """Points along a loop in its direction."""
        out: list[np.ndarray] = []
        for ei, fwd in loop["edges"]:
            p = _sample(self.specs.get(ei) or self.edge_spec(ei), n)
            out.extend(p if fwd else p[::-1])
        return out

    def face_points(self, face: dict[str, Any]) -> list[np.ndarray]:
        pts = []
        for loop in face["loops"]:
            if "vertex" in loop and loop.get("edges") is None:
                pts.append(self.P(self.b.vertices[loop["vertex"]]))
                continue
            for ei, _ in loop["edges"]:
                pts.extend(_sample(self.specs.get(ei) or self.edge_spec(ei)))
        return pts

    def surface_spec(self, face: dict[str, Any]) -> dict[str, Any]:
        s = self.b.surfaces[face["surface"]]
        kind = s["kind"]
        if kind in ("plane", "cylinder", "cone", "sphere", "torus"):
            o, z, x = self.P(s["origin"]), _unit(self.D(s["z"])), _unit(self.D(s["x"]))
            spec = {"kind": kind, "origin": o, "z": z, "x": x}
            pts = self.face_points(face)
            if kind == "plane":
                y = np.cross(z, x)
                uv = np.array([[(p - o).dot(x), (p - o).dot(y)] for p in pts])
                lo, hi = uv.min(axis=0), uv.max(axis=0)
                pad = 0.05 * max(hi[0] - lo[0], hi[1] - lo[1], 1e-6) + 1e-6
                spec["domain"] = (lo[0] - pad, hi[0] + pad, lo[1] - pad, hi[1] + pad)
                return spec
            # The surface's own seam (where its angle parameter starts) has to lie on the
            # face's seam edge, or, for a face without one, outside the face.
            if face.get("frame") is not None:  # a seam was added to the face
                spec["z"], spec["x"] = face["frame"]
            elif any(_is_seam_loop(loop) for loop in face["loops"] if loop.get("edges")):
                seam = self.seam_direction(face, o, z)
                if seam is not None:
                    spec["x"] = seam
            elif pts:
                spec["x"] = _largest_gap(o, z, x, pts)
            if kind in ("cylinder", "cone"):
                h = [(p - o).dot(z) for p in pts]
                pad = 0.05 * max(max(h) - min(h), 1e-6) + 1e-6
                lo, hi = min(h) - pad, max(h) + pad
                spec["radius"] = s["radius"]
                if kind == "cone":
                    semi = s["semi_angle"]
                    if semi < 0:  # same cone with the axis reversed
                        semi, spec["z"], lo, hi = -semi, -spec["z"], -hi, -lo
                    apex = -s["radius"] / math.tan(semi) if semi > 1e-12 else -math.inf
                    lo = max(lo, apex)  # the face cannot reach past the apex
                    spec["semi_angle"] = semi
                spec["height"] = (lo, hi)
            elif kind == "sphere":
                spec["radius"] = s["radius"]
            else:
                spec["major"], spec["minor"] = s["major"], s["minor"]
                # The seam around the tube (v = 0 on the outer equator) cannot be turned with
                # the frame: move the torus' v window so that it starts at the face's seam
                # edge along the torus, or else outside the face. A face that runs all the
                # way around the tube without such an edge gets one added later.
                o, z = spec["origin"], spec["z"]

                def tube_angle(p: np.ndarray) -> float:
                    d = p - o
                    h = float(d.dot(z))
                    return math.atan2(h, float(np.linalg.norm(d - z * h)) - s["major"])

                loops = [self.loop_points(l) for l in face["loops"] if l.get("edges")]
                seam = self.tube_seam(face, tube_angle)
                if seam is not None or (pts and not any(_winding(l, tube_angle) for l in loops)):
                    v0 = math.degrees(seam if seam is not None else _largest_gap_of(sorted(tube_angle(p) for p in pts)))
                    spec["v_start"] = _tube_window_start(v0)
            return spec
        if kind == "bspline":
            return {"kind": "bspline", "u_degree": s["u_degree"], "v_degree": s["v_degree"], "nu": s["nu"],
                    "nv": s["nv"], "poles": np.array([self.P(p) for p in s["poles"]]), "u_knots": s["u_knots"],
                    "v_knots": s["v_knots"], "weights": s["weights"]}
        if kind == "extrusion":
            curve = self._free_curve(s["curve"])
            vec = self.D(s["vector"])
            pts = self.face_points(face)
            if curve["kind"] in ("circle", "ellipse") and abs(float(vec.dot(curve["z"]))) > 1e-9 * float(np.linalg.norm(vec)):
                # a point of the surface lies v * vec above its generator's plane
                vs = [float((p - curve["center"]).dot(curve["z"]) / vec.dot(curve["z"])) for p in pts]
                curve = self._start_outside(curve, face, vec, pts)
            elif curve["kind"] == "line":  # p = p0 + t (p1 - p0) + v vec
                A = np.array([curve["p1"] - curve["p0"], vec]).T
                vs = [float(np.linalg.lstsq(A, p - curve["p0"], rcond=None)[0][1]) for p in pts]
            else:
                # p = C(u) + v vec: v is p's height along vec less that of the generator's
                # point, which lies between the heights of the generator's poles
                L2 = float(vec.dot(vec))
                gen = np.asarray(curve["poles"]) if curve["kind"] == "bspline" else np.array([curve["center"]])
                g = (gen - gen[0]) @ vec / L2
                vs = [float((p - gen[0]).dot(vec) / L2) for p in pts]
                vs = [min(vs) - float(g.max()), max(vs) - float(g.min())]
            pad = 0.05 * max(max(vs) - min(vs), 1e-6) + 1e-6
            return {"kind": "extrusion", "curve": curve, "vector": vec, "v_range": (min(vs) - pad, max(vs) + pad)}
        if kind == "revolution":
            curve = self._free_curve(s["curve"])
            ao, ad = self.P(s["axis_origin"]), _unit(self.D(s["axis"]))
            if any(_is_seam_loop(loop) for loop in face["loops"] if loop.get("edges")):
                target = self.seam_direction(face, ao, ad)
            else:
                pts = self.face_points(face)
                target = _largest_gap(ao, ad, _generator_direction(curve, ao, ad), pts) if pts else None
            if target is not None:
                curve = _rotate_generator(curve, ao, ad, target)
            return {"kind": "revolution", "curve": curve, "axis_origin": ao, "axis": ad}
        if kind == "offset":
            return {"kind": "offset", "basis": self._surface_from(s["basis"], face), "distance": s["distance"]}
        raise NotImplementedError(f"surface {kind}")

    def seam_direction(self, face: dict[str, Any], o: np.ndarray, z: np.ndarray) -> np.ndarray | None:
        """Direction from the axis to the face's seam: an edge that a loop uses twice and
        that keeps one angle about the axis (a ruling or a meridian)."""
        for loop in face["loops"]:
            if not loop.get("edges"):
                continue
            uses: dict[int, int] = {}
            for ei, _ in loop["edges"]:
                uses[ei] = uses.get(ei, 0) + 1
            for ei, n in uses.items():
                if n < 2:
                    continue
                dirs = []
                for p in _sample(self.specs.get(ei) or self.edge_spec(ei), 8):
                    r = p - o
                    r = r - z * r.dot(z)
                    if np.linalg.norm(r) > 1e-9 * max(1.0, float(np.linalg.norm(p - o))):
                        dirs.append(_unit(r))
                if dirs and all(np.linalg.norm(d - dirs[0]) < 1e-3 for d in dirs):
                    return dirs[len(dirs) // 2]
        return None

    def tube_seam(self, face: dict[str, Any], tube_angle: Any) -> float | None:
        """The angle around the tube of a torus face's seam edge that runs along the torus
        (an edge a loop uses twice and that keeps one angle around the tube), or None."""
        for loop in face["loops"]:
            if not loop.get("edges"):
                continue
            for ei in {e for e, _ in loop["edges"] if sum(1 for x, _ in loop["edges"] if x == e) > 1}:
                angles = [tube_angle(p) for p in _sample(self.specs.get(ei) or self.edge_spec(ei), 8)]
                if all(abs((a - angles[0] + math.pi) % (2 * math.pi) - math.pi) < 1e-6 for a in angles):
                    return angles[0]
        return None

    def _start_outside(self, curve: dict[str, Any], face: dict[str, Any], vec: np.ndarray,
                       pts: list[np.ndarray]) -> dict[str, Any]:
        """A whole circle or ellipse, the generator of an extrusion, turned to start on the
        face's seam edge, or where the face does not reach: the surface's seam is there."""
        o, z, x = curve["center"], curve["z"], curve["x"]
        y = np.cross(z, x)
        r1, r2 = (curve["r1"], curve["r2"]) if curve["kind"] == "ellipse" else (curve["radius"], curve["radius"])

        def param(p: np.ndarray) -> float:
            d = p - o
            d = d - vec * (d.dot(z) / vec.dot(z))  # along the extrusion into the generator's plane
            return math.atan2(d.dot(y) / r2, d.dot(x) / r1)

        seam = next((ei for loop in face["loops"] if loop.get("edges") for ei, _ in loop["edges"]
                     if sum(1 for e, _ in loop["edges"] if e == ei) > 1), None)
        if seam is not None:
            t = param(_sample(self.specs.get(seam) or self.edge_spec(seam), 2)[0])
        elif pts:
            t = _largest_gap_of(sorted(param(p) for p in pts))
        else:
            return curve
        if curve["kind"] == "circle":
            return dict(curve, x=_unit(x * math.cos(t) + y * math.sin(t)))
        start = o + x * r1 * math.cos(t) + y * r2 * math.sin(t)
        return dict(curve, p0=start, p1=start)

    def _surface_from(self, s: dict[str, Any], face: dict[str, Any]) -> dict[str, Any]:
        saved = self.b.surfaces
        try:
            self.b.surfaces = [s]
            return self.surface_spec(dict(face, surface=0))
        finally:
            self.b.surfaces = saved

    def _free_curve(self, c: dict[str, Any]) -> dict[str, Any]:
        """A whole curve (generator of an extrusion/revolution), as a bounded NURBS or line."""
        kind = c["kind"]
        if kind == "bspline":
            return {"kind": "bspline", "degree": c["degree"], "poles": np.array([self.P(p) for p in c["poles"]]),
                    "knots": list(c["knots"]), "weights": c["weights"], "whole": True}
        if kind == "line":
            o, d = self.P(c["origin"]), self.D(c["direction"])
            return {"kind": "line", "p0": o - d * 1e3, "p1": o + d * 1e3}
        if kind == "circle":
            return {"kind": "circle", "center": self.P(c["origin"]), "z": _unit(self.D(c["z"])),
                    "x": _unit(self.D(c["x"])), "radius": c["radius"], "sweep": 360.0}
        if kind == "ellipse":  # NX writes small roundings as extruded ellipses
            o, x = self.P(c["origin"]), _unit(self.D(c["x"]))
            start = o + x * c["r1"]
            return {"kind": "ellipse", "center": o, "z": _unit(self.D(c["z"])), "x": x, "r1": c["r1"], "r2": c["r2"],
                    "p0": start, "p1": start, "forward": True, "closed": True}
        raise NotImplementedError(f"generator curve {kind}")


def _rotation(axis: np.ndarray, angle: float) -> np.ndarray:
    x, y, z = axis
    c, s_, C = math.cos(angle), math.sin(angle), 1 - math.cos(angle)
    return np.array([[c + x * x * C, x * y * C - z * s_, x * z * C + y * s_],
                     [y * x * C + z * s_, c + y * y * C, y * z * C - x * s_],
                     [z * x * C - y * s_, z * y * C + x * s_, c + z * z * C]])


def _conic_arc(c: dict[str, Any], o: np.ndarray, z: np.ndarray, x: np.ndarray, p0: np.ndarray,
               p1: np.ndarray) -> dict[str, Any]:
    """The piece of a hyperbola or parabola between two of its points, as the exact
    (rational) quadratic Bezier curve."""
    y = np.cross(z, x)
    if c["kind"] == "hyperbola":  # o + a cosh(t) x + b sinh(t) y
        a, b = c["a"], c["b"]
        t0, t1 = (math.asinh(float((p - o).dot(y)) / b) for p in (p0, p1))
        d0 = x * a * math.sinh(t0) + y * b * math.cosh(t0)
        d1 = x * a * math.sinh(t1) + y * b * math.cosh(t1)
        w = math.cosh((t1 - t0) / 2)
    else:  # o + f t^2 x + 2 f t y
        f = c["focal"]
        t0, t1 = (float((p - o).dot(y)) / (2 * f) for p in (p0, p1))
        d0, d1 = x * 2 * f * t0 + y * 2 * f, x * 2 * f * t1 + y * 2 * f
        w = 1.0
    # the middle pole is where the end tangents meet
    A = np.array([d0, -d1]).T
    s_, *_ = np.linalg.lstsq(A, p1 - p0, rcond=None)
    mid = p0 + d0 * s_[0]
    return {"kind": "bspline", "degree": 2, "poles": np.array([p0, mid, p1]), "knots": [0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            "weights": [1.0, w, 1.0], "p0": p0, "p1": p1, "forward": True, "closed": False}


def _tube_window_start(v0: float) -> float:
    """Where a torus' window around the tube starts (degrees, in [-360, 0]) for a seam at
    ``v0`` (degrees, from atan2). A seam on the outer equator comes out of atan2 as a rounding
    error either side of 0 (OpenCASCADE's O-rings: +6e-15), and 6e-15 - 360 is a window the
    kernel refuses: that seam starts the window at 0."""
    if abs(v0) < 1e-9:
        return 0.0
    return v0 - 360.0 if v0 > 0 else v0


def _largest_gap(o: np.ndarray, z: np.ndarray, x: np.ndarray, pts: list[np.ndarray]) -> np.ndarray:
    """The direction about the axis in the middle of the largest angular gap between the
    points (where a face without a seam edge does not reach)."""
    mid = _largest_gap_of(sorted(_angle_in(o, z, x, p) for p in pts))
    return _unit(x * math.cos(mid) + np.cross(z, x) * math.sin(mid))


def _largest_gap_of(angs: list[float]) -> float:
    """The angle in the middle of the largest gap between sorted angles (radians)."""
    gaps = [(angs[(i + 1) % len(angs)] - angs[i]) % (2 * math.pi) for i in range(len(angs))]
    if len(angs) == 1:
        gaps = [2 * math.pi]
    i = int(np.argmax(gaps))
    return angs[i] + gaps[i] / 2


def _winding(pts: list[np.ndarray], angle: Any) -> int:
    """How many times a closed run of points goes around in the angle ``angle(p)``."""
    if len(pts) < 2:
        return 0
    a = [angle(p) for p in pts]
    turn = sum((a[(i + 1) % len(a)] - a[i] + math.pi) % (2 * math.pi) - math.pi for i in range(len(a)))
    return round(turn / (2 * math.pi))


def _generator_direction(curve: dict[str, Any], o: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Direction from the axis to a revolution's generator curve."""
    pts = np.asarray(curve["poles"]) if curve["kind"] == "bspline" else np.array(_sample(curve, 8))
    r = pts - o
    r = r - np.outer(r @ z, z)
    ref = r[int(np.argmax(np.linalg.norm(r, axis=1)))]
    if np.linalg.norm(ref) < 1e-12:
        ref = np.cross(z, [1.0, 0.0, 0.0] if abs(z[0]) < 0.9 else [0.0, 1.0, 0.0])
    return _unit(ref)


def _rotate_generator(curve: dict[str, Any], o: np.ndarray, z: np.ndarray, target: np.ndarray) -> dict[str, Any]:
    """Turn a revolution's generator about the axis to ``target``, where the surface's seam
    has to be. The surface stays the same."""
    if curve["kind"] != "bspline":
        return curve
    x = _generator_direction(curve, o, z)
    angle = math.atan2(float(np.cross(x, target).dot(z)), float(x.dot(target)))
    poles = (np.asarray(curve["poles"]) - o) @ _rotation(z, angle).T + o
    return dict(curve, poles=poles)


def _circle_point(spec: dict[str, Any]) -> np.ndarray:
    return spec["center"] + spec["radius"] * spec["x"]


def _arc_spec(center: np.ndarray, a: np.ndarray, b: np.ndarray, start_dir: np.ndarray) -> dict[str, Any]:
    """Circular arc around ``center`` from ``a`` to ``b`` that leaves ``a`` along ``start_dir``."""
    x = _unit(a - center)
    z = np.cross(x, start_dir)
    z = _unit(z)
    y = np.cross(z, x)
    d = b - center
    ang = math.degrees(math.atan2(d.dot(y), d.dot(x))) % 360.0
    return {"kind": "circle", "center": center, "z": z, "x": x, "radius": float(np.linalg.norm(a - center)),
            "sweep": ang if ang > 1e-9 else 360.0}


def _add_seams(bld: _Builder, f: dict[str, Any], srf: dict[str, Any], seam_id: int
               ) -> tuple[list[dict[str, Any]], tuple[np.ndarray, np.ndarray]] | None:
    """Faces on periodic surfaces bounded without a seam edge (NX writes a cylinder band as
    two circles, a cone tip as a circle and a vertex): SMLib wants the seam, so add one
    along the surface where the circles start. Returns the new loops and the frame
    (axis, seam direction) the surface has to use, or None if the face needs none."""
    kind = srf["kind"]
    if kind not in ("cylinder", "cone", "sphere", "torus"):
        return None
    specs = bld.specs
    circles, points, point_ids = [], [], []
    for loop in f["loops"]:
        if not loop.get("edges"):
            if "vertex" in loop:
                points.append(bld.P(bld.b.vertices[loop["vertex"]]))
                point_ids.append(int(loop["vertex"]))
            continue
        if len(loop["edges"]) != 1:
            return None
        ei, fwd = loop["edges"][0]
        if specs[ei]["kind"] != "circle" or specs[ei]["sweep"] < 360.0 - 1e-9:
            return None
        circles.append((ei, fwd))
    if not circles or len(circles) + len(points) > 2:
        return None
    o, z = bld.P(srf["origin"]), _unit(bld.D(srf["z"]))
    if kind == "sphere":
        z = specs[circles[0][0]]["z"]  # any axis through the centre will do
    for ei, _ in circles:
        c = specs[ei]
        d = c["center"] - o
        if abs(abs(float(c["z"].dot(z))) - 1.0) > 1e-6 or np.linalg.norm(d - z * d.dot(z)) > 1e-6 * max(1.0, c["radius"]):
            return None  # the circle does not run around the axis
    # the seam starts where a circle with a fixed start begins, else where the first one does
    anchor = next((ei for ei, _ in circles if ei in bld.pinned), circles[0][0])
    r0 = _circle_point(specs[anchor]) - o
    sdir = r0 - z * r0.dot(z)
    if np.linalg.norm(sdir) < 1e-12:
        return None
    sdir = _unit(sdir)
    moved = {}
    for ei, _ in circles:
        c = specs[ei]
        x = _unit(sdir - c["z"] * sdir.dot(c["z"]))
        if ei not in bld.pinned:
            moved[ei] = dict(c, x=x)
        elif np.linalg.norm(x - c["x"]) > 1e-9:
            return None  # two circles fixed at different angles: no straight seam joins them

    def spec(ei: int) -> dict[str, Any]:
        return moved.get(ei, specs[ei])

    def normal(p: np.ndarray) -> np.ndarray:
        r = p - o
        radial = _unit(r - z * r.dot(z))
        if kind == "sphere":
            n = r
        elif kind == "torus":
            n = p - (o + radial * srf["major"])
        elif kind == "cone":
            n = radial * math.cos(srf["semi_angle"]) - z * math.sin(srf["semi_angle"])
        else:
            n = radial
        n = _unit(n)
        return n if f["same_sense"] else -n

    (ea, fa) = circles[0]
    pa = _circle_point(spec(ea))
    tangent = np.cross(spec(ea)["z"], spec(ea)["x"]) * (1.0 if fa else -1.0)
    into = np.cross(normal(pa), tangent)  # the face lies left of its boundary
    if len(circles) == 2:
        pb = _circle_point(spec(circles[1][0]))
    elif points:
        pb = points[0]  # apex or pole
    elif kind == "cone" and abs(srf["semi_angle"]) > 1e-12:
        pb = o - z * (srf["radius"] / math.tan(srf["semi_angle"]))
    elif kind == "sphere":
        pb = o + z * (srf["radius"] if into.dot(z) > 0 else -srf["radius"])
    else:
        return None
    if kind in ("cylinder", "cone"):
        seam = {"kind": "line", "p0": pa, "p1": pb}
    else:
        seam = _arc_spec(o if kind == "sphere" else o + sdir * srf["major"], pa, pb, into)
    # the seam runs between the vertices of the circles (or the apex or pole) it joins
    seam["v0"] = int(bld.b.edges[ea]["v0"])
    if len(circles) == 2:
        seam["v1"] = int(bld.b.edges[circles[1][0]]["v0"])
    elif points:
        seam["v1"] = point_ids[0]
    specs.update(moved)
    specs[seam_id] = seam
    bld.pinned.update(ei for ei, _ in circles)
    edges = [(ea, fa), (seam_id, True)] + ([circles[1]] if len(circles) == 2 else []) + [(seam_id, False)]
    return [{"edges": edges, "outer": True}], (z, sdir)


def _is_seam_loop(loop: dict[str, Any]) -> bool:
    seen: dict[int, int] = {}
    for ei, _ in loop["edges"]:
        seen[ei] = seen.get(ei, 0) + 1
    return any(n > 1 for n in seen.values())


def _sample(spec: dict[str, Any], n: int = 16) -> list[np.ndarray]:
    kind = spec["kind"]
    if kind == "line":
        return [spec["p0"], spec["p1"]]
    if kind == "circle":
        o, z, x, r = spec["center"], spec["z"], spec["x"], spec["radius"]
        y = np.cross(z, x)
        out = []
        for i in range(n + 1):
            a = math.radians(spec["sweep"]) * i / n
            out.append(o + r * (x * math.cos(a) + y * math.sin(a)))
        return out
    if kind == "ellipse":
        o, z, xa, r1, r2 = spec["center"], spec["z"], spec["x"], spec["r1"], spec["r2"]
        y = np.cross(z, xa)

        def param(p: np.ndarray) -> float:
            d = p - o
            return math.atan2(d.dot(y) / r2, d.dot(xa) / r1)

        t0 = param(spec["p0"])
        if spec.get("closed"):
            span = 2 * math.pi
        else:
            span = (param(spec["p1"]) - t0) % (2 * math.pi)
        if not spec["forward"]:
            span = span - 2 * math.pi if span else -2 * math.pi
        return [o + xa * r1 * math.cos(t0 + span * i / n) + y * r2 * math.sin(t0 + span * i / n) for i in range(n + 1)]
    if kind == "bspline":
        return list(spec["poles"])  # the control polygon bounds the curve
    return []


#: What the builder's messages call the import it builds for: "STEP", or "IGES" (iges_import builds
#: its solids with it).
_SOURCE: contextvars.ContextVar[str] = contextvars.ContextVar("smlibpy_import_source", default="STEP")


@contextlib.contextmanager
def _reading(source: str) -> Iterator[None]:
    """Messages of the builder name ``source`` (a format) while it is in use."""
    token = _SOURCE.set(source)
    try:
        yield
    finally:
        _SOURCE.reset(token)


def _op(rest: str = "") -> str:
    """The operation a message of the builder names: ``import STEP``, ``import IGES: stitch``."""
    return f"import {_SOURCE.get()}{rest}"


def _label(body: BodyData) -> str:
    """How a message of the builder names a body (an IGES body by its directory entry)."""
    if _SOURCE.get() == "IGES":
        kind = "solid" if body.kind == "solid" else "shell"
        return f"{kind} {body.name!r} (DE {body.entity})" if body.name else f"{kind} DE {body.entity}"
    return _body_label(body.entity, body.name, body.product)


def _build_body(body: BodyData, m: np.ndarray, heal: bool) -> Any:
    from .shapes import Part, Shell

    bld = _Builder(body, m)
    if not _rigid(m):  # (_bodies builds such a body unplaced and moves it whole)
        raise ModelingError("a placement that mirrors or scales cannot be built into a body")
    edges = bld.specs

    def face_spec(fi: int, f: dict[str, Any], srf: dict[str, Any]) -> dict[str, Any]:
        loops = []
        for loop in _outer_first(bld, f["loops"]):
            if loop.get("edges"):
                for ei, _ in loop["edges"]:
                    if ei not in edges:
                        edges[ei] = bld.edge_spec(ei)
                loops.append({"edges": [(int(ei), bool(fwd)) for ei, fwd in loop["edges"]]})
            elif "vertex" in loop:
                loops.append({"vertex": bld.P(body.vertices[loop["vertex"]])})
        seamed = _add_seams(bld, f, srf, -1_000_000 - fi)
        if seamed is not None:
            new_loops, frame = seamed
            f = dict(f, loops=new_loops, frame=frame)
            loops = [{"edges": l["edges"]} for l in new_loops]
        elif not any("edges" in l for l in loops) and srf["kind"] == "sphere":
            # A whole sphere written with a point (or nothing) as its boundary: give it the
            # pole-to-pole seam that kernel spheres have, and drop the pole points.
            seam = -1 - fi
            o, z, x = bld.P(srf["origin"]), _unit(bld.D(srf["z"])), _unit(bld.D(srf["x"]))
            y = np.cross(z, x)
            edges[seam] = {"kind": "circle", "center": o, "z": -y, "x": -z, "radius": srf["radius"], "sweep": 180.0}
            loops = [{"edges": [(seam, False), (seam, True)]}]
            f = dict(f, loops=loops, frame=(z, x))
        # a face on a closed B-spline surface without a seam edge of its own may lie across the
        # surface's seam; build_brep moves the seam off it
        free_seam = srf["kind"] == "bspline" and not any(_is_seam_loop(l) for l in loops if l.get("edges"))
        return {"surface": bld._surface_from(srf, f), "same_sense": bool(f["same_sense"]),
                "loops": loops, "free_seam": free_seam, "color": f.get("color"), "name": f.get("name") or None}

    agreed = list(_agreeing_loops(body))
    faces = [face_spec(fi, f, body.surfaces[f["surface"]]) for fi, f in enumerate(agreed)]
    solid = body.kind == "solid"
    parts = []
    built = []  # the faces and orientation each shell was built with in the end
    broken = []  # what is wrong with the closed shells heal and stitching could not repair

    def build_shell(shell_faces: list[dict[str, Any]], closed: bool, reversed_: bool) -> tuple[Any, Any, bool]:
        with kernel_call(_op(), "the file may hold faces the kernel cannot rebuild"):
            brep = _attributed(ext.build_brep(shell_faces, edges, closed, reversed_, False), shell_faces)
            # A few writers flip a face's same_sense flag against its loops (which agree with
            # the loops of its neighbours): the loops decide.
            # (Faces that lack their seam have loops that do not close in the parameter
            # plane, and no sense to read.)
            inverted = ext.inverted_faces(brep)
            if inverted:
                unseamed = {d["face"] for d in ext.seam_problems(brep, False, inverted)}
                inverted = [i for i in inverted if i not in unseamed]
            if inverted and 2 * len(inverted) < len(shell_faces):
                for i in inverted:
                    shell_faces[i] = dict(shell_faces[i], same_sense=not shell_faces[i]["same_sense"])
                ext.delete_brep(brep)
                brep = _attributed(ext.build_brep(shell_faces, edges, closed, reversed_, False), shell_faces)
        part, volume = _with_seams(Part._wrap(brep) if closed else Shell._wrap(brep))
        if closed:
            # (the kernel's coarse volume, integrated once per shell: its sign says which way
            # round the shell was built, and the checks below take it)
            if volume is None:
                volume = _kernel_volume(part)
            if not (volume is not None and volume > 0):
                reversed_ = not reversed_
                with kernel_call(_op()):
                    part, volume = _with_seams(Part._wrap(_attributed(ext.build_brep(shell_faces, edges, closed,
                                                                                     reversed_, False), shell_faces)))
        return part, volume, reversed_

    for si, sh in enumerate(body.shells):
        closed = solid and bool(sh.get("closed", True))
        shell_faces = [faces[i] for i in sh["faces"]]
        # Cavities of a BREP_WITH_VOIDS are built as ordinary solids and subtracted later.
        given = bool(sh["reversed"]) and not (solid and si > 0)
        part, volume, reversed_ = build_shell(shell_faces, closed, given)
        # An offset of a plane, sphere, cylinder, cone or torus is a surface of that kind: where the
        # kernel cannot close a solid with such faces as offsets (an offset of a whole sphere, whose
        # face has the sphere's seam and poles: no solid, or one of another volume, 0 natively and a
        # quarter in smlibwasm), they are built on the surface they are.
        plain = {i: analytic_offset(body.surfaces[agreed[i]["surface"]]) for i in sh["faces"]} if closed else {}
        if any(s is not None for s in plain.values()):
            retry = [face_spec(i, agreed[i], s) if s is not None else dict(faces[i]) for i, s in plain.items()]
            try:
                again, v, r = build_shell(retry, closed, given)
            except (KernelError, ModelingError):
                again = None
            if again is not None and _sound(again, v):
                v = _kernel_volume(again) if v is None else v
                mine = _kernel_volume(part) if volume is None else volume
                # (the kernel's volumes to 1e-4: the same solid both ways agrees to far better than 1e-3)
                if not _sound(part, mine) or mine is None or v is None or abs(mine - v) > 1e-3 * abs(v):
                    part, volume, reversed_, shell_faces = again, v, r, retry
        built.append((shell_faces, reversed_))
        if heal and closed and not _sound(part, volume):
            # Only repair what came out broken: the kernel's healer can damage good bodies.
            part, problem = _repaired(part, body)
            if problem is not None:
                broken.append(problem)
        elif heal and not closed and _apart(body, sh["faces"]):
            part = _sewn(part, body)
        parts.append(part)
    if not parts:
        raise ModelingError("empty body")
    result = parts[0]
    if solid and len(parts) > 1:  # BREP_WITH_VOIDS
        result = _with_cavities(result, parts[1:], built, edges)
    elif len(parts) > 1:  # a surface model of several shells stays a surface
        with kernel_call(_op()):
            result = Shell._wrap(ext.combine([p._brep for p in parts]))
    if broken:
        warnings.warn(f"{_op()}: {_label(body)} is not a valid solid "
                      f"({broken[0]}); heal and stitching could not repair it", RuntimeWarning, stacklevel=4)
    if body.name:
        result.name = body.name
    if body.color is not None:
        result.color = body.color
    result._h.imported = True  # (read from a file: its fillets run in another process)
    return result


def _attributed(brep: Any, faces: list[dict[str, Any]]) -> Any:
    """The Brep ``ext.build_brep`` built from ``faces``, with their colors and names (the faces of the
    file, in its order; kernel plan T5): the kernel carries them on through healing and seams."""
    from .shapes import _put_face_attrs

    _put_face_attrs(brep, [f.get("color") for f in faces], [f.get("name") for f in faces])
    return brep


def _with_cavities(outer: Any, cavities: list[Any], built: list[tuple[list[Any], bool]], edges: dict[int, Any]) -> Any:
    """A solid with cavities (BREP_WITH_VOIDS), each built as a void region inside the
    solid, as the file has it. The Boolean difference is the fallback; it fails where a
    cavity's faces come close to the solid's (``ModelingError``: the import names the body)."""
    from .shapes import Part

    # The volumes as smlibpy integrates them, with the gaps between their faces: where faces do
    # not meet exactly (a cavity of two faces 1e-5 mm3 large, gaps of 1e-2 of a volume) the
    # void region's volume differs from the solid's less its cavities' by up to the gaps.
    pieces = [outer._props()] + [c._props() for c in cavities]
    expected = pieces[0]["volume"] - sum(p["volume"] for p in pieces[1:])
    tol = max(1e-6 * max(abs(pieces[0]["volume"]), 1.0), 2 * sum(p["gaps"] * abs(p["volume"]) for p in pieces))
    # A cavity turned the wrong way adds its volume instead: a build is the right one when it is
    # within the tolerance and closer to the right volume than to that.
    apart = sum(abs(p["volume"]) for p in pieces[1:])
    (faces, rev) = built[0]
    # The cavity's faces as when it was built as a solid of its own; the constructor's
    # comments say the other way round, so that is tried as well. The volume decides.
    for flip in (False, True):
        voids = [(f, r != flip) for f, r in built[1:]]
        try:
            with kernel_call(_op(": cavities")):
                part, _ = _with_seams(Part._wrap(_attributed(ext.build_brep(faces, edges, True, rev, False, voids),
                                                             faces + [f for v, _ in voids for f in v])))
            if part._solid_problem() is None:
                off = abs(part._props()["volume"] - expected)
                if off <= tol and off < apart:
                    return part
        except (KernelError, ModelingError):
            pass
    result = outer
    try:
        for cavity in cavities:
            result = result - cavity
    except (KernelError, ModelingError) as e:
        raise ModelingError(f"its cavities could not be built, neither as void regions nor by subtracting them "
                            f"({e})") from e
    return result


_SWEPT = ("cylinder", "cone", "sphere", "torus", "revolution", "extrusion")


def _with_seams(body: Any) -> tuple[Any, float | None]:
    """The body with the seams its faces lack, and the kernel's coarse volume where that was
    integrated to check it (else None). A face on a cylinder, cone, revolution or
    extrusion around which its loops run (NX writes the shank of a drill as the circle at
    one end and the outline of its flat at the other) needs an edge along the surface's
    seam: without it the kernel can neither mesh nor integrate the face. The kernel adds
    them; a body that would come out broken keeps its faces as they are."""
    from .shapes import Part

    faces = body.faces()
    problems = ext.seam_problems(body._brep)
    lacking = [d["face"] for d in problems if faces[d["face"]].geom_type in _SWEPT]
    # B-spline surfaces closed on themselves read right as written, unless a face runs all the
    # way around one without a seam edge (the hub of an impeller): the kernel cannot mesh it, and
    # it needs the seam as the others do. (The kernel says the same of small faces at a pole,
    # which mesh as they are and break when split.)
    spline = [d["face"] for d in problems if faces[d["face"]].geom_type == "bspline" and d["missing"]]
    if spline:
        lacking += sorted(set(spline) & _unmeshed(body))
    if not lacking:
        return body, None
    try:
        fixed = body._like(body._copy_brep())
        with kernel_call(_op(": seams")):
            ext.seam_problems(fixed._brep, True, lacking)
        # a sheet cannot be checked for closure: it keeps the kernel's seams
        if not isinstance(fixed, Part):
            return fixed, None
        volume = _kernel_volume(fixed)
        if volume is not None and volume > 0 and fixed._solid_problem(volume=volume) is None:
            return fixed, volume
    except KernelError:
        pass
    return body, None


def _unmeshed(body: Any) -> set[int]:
    """Indices of the faces the kernel's tessellation fails on (all of them if it fails as a whole)."""
    try:
        tol = max(body.bbox().diagonal * 1e-3, 1e-6)
        mesh, failures = ext.tessellate(body._brep, chord_height_tolerance=tol, allow_partial=True, return_failures=True)
        if mesh is not None:  # the binding hands the mesh over: it is ours to free
            ext.delete_polybrep(mesh)
        return {int(f["face_index"]) for f in failures}
    except Exception:
        return set(range(len(body.faces())))


def _outer_first(bld: _Builder, loops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Loops with the outer one first. Files that do not mark the outer bound get the loop
    with the largest extent as outer loop (holes lie inside it)."""
    if len(loops) < 2 or any(l.get("outer") for l in loops):
        return sorted(loops, key=lambda l: not l.get("outer", False))

    def extent(loop: dict[str, Any]) -> float:
        if not loop.get("edges"):
            return -1.0
        pts = np.array([p for ei, _ in loop["edges"] for p in _sample(bld.edge_spec(ei), 8)])
        return float(np.linalg.norm(pts.max(axis=0) - pts.min(axis=0)))

    return sorted(loops, key=extent, reverse=True)


def _agreeing_loops(body: BodyData) -> list[dict[str, Any]]:
    """The faces of a solid with every loop running the way its neighbours say: in a closed
    shell each edge between two faces is used once in each direction. A few writers flag a
    face's bound reversed (fillets on tori, around holes and bosses); its loop then runs the
    wrong way round, and on a surface closed on itself it bounds the rest of the surface
    instead. Of the two ways to make the loops of a shell agree, the one that turns
    fewer loops round wins. A shell whose loops cannot agree, or that would turn as many either
    way, stays as the file has it."""
    faces = body.faces
    if body.kind != "solid":
        return faces
    turn: set[tuple[int, int]] = set()
    for sh in body.shells:
        if not sh.get("closed", True):
            continue
        nodes = [(fi, li) for fi in sh["faces"] for li, loop in enumerate(faces[fi]["loops"]) if loop.get("edges")]
        uses: dict[int, list[tuple[int, bool]]] = {}
        for n, (fi, li) in enumerate(nodes):
            for ei, fwd in faces[fi]["loops"][li]["edges"]:
                uses.setdefault(ei, []).append((n, bool(fwd)))
        links: dict[int, list[tuple[int, bool]]] = {}  # loop -> [(neighbour, same direction)]
        for us in uses.values():
            # (seams, edges along a gap in the shell and edges of more than two faces say nothing)
            if len(us) != 2 or nodes[us[0][0]][0] == nodes[us[1][0]][0]:
                continue
            (a, fa), (b, fb) = us
            links.setdefault(a, []).append((b, fa == fb))
            links.setdefault(b, []).append((a, fa == fb))
        if any(same for near in links.values() for _, same in near):
            turned = _turned(links)
            if turned is not None:
                turn.update(nodes[n] for n in turned)
    if not turn:
        return faces
    out = []
    for fi, f in enumerate(faces):
        if any((fi, li) in turn for li in range(len(f["loops"]))):
            f = dict(f, loops=[dict(loop, edges=[(ei, not fwd) for ei, fwd in reversed(loop["edges"])])
                               if (fi, li) in turn else loop for li, loop in enumerate(f["loops"])])
        out.append(f)
    return out


def _turned(links: dict[int, list[tuple[int, bool]]]) -> list[int] | None:
    """The loops to turn round so that every link joins two loops running opposite ways, in
    each connected group the fewer of the two choices (none where both are as many); None if
    no choice makes them all agree."""
    flip: dict[int, bool] = {}
    out: list[int] = []
    for start in links:
        if start in flip:
            continue
        flip[start] = False
        group, todo = [start], [start]
        while todo:
            a = todo.pop()
            for b, same in links[a]:
                want = flip[a] != same  # used the same way: one of the two turns round
                if b not in flip:
                    flip[b] = want
                    group.append(b)
                    todo.append(b)
                elif flip[b] != want:
                    return None
        turned = [n for n in group if flip[n]]
        if 2 * len(turned) < len(group):
            out += turned
        elif 2 * len(turned) > len(group):
            out += [n for n in group if not flip[n]]
    return out


def _kernel_volume(part: Any) -> float | None:
    """The kernel's coarse volume of a built shell (1e-4), None where it cannot be integrated.
    (Integrated once per shell: on a part of 2079 faces each integration takes 0.3 s, and the
    checks of a shell asked for it three or four times.)"""
    try:
        return float(part._kernel_props(1e-4)["volume"])
    except KernelError:
        return None


def _sound(part: Any, volume: float | None = None) -> bool:
    """A closed, manifold solid of positive volume (``volume``: its kernel volume, if known)."""
    try:
        if part._shape_problem() is not None:
            return False
        if volume is None:
            volume = _kernel_volume(part)
        # (an integration over broken faces can come out a hair above 0: 1e-10 for an offset of a whole
        # sphere of radius 10 in smlibwasm)
        return volume is not None and volume > 1e-12 * part._loose_box().diagonal ** 3 and \
            part._solid_problem(volume=volume) is None
    except KernelError:
        return False


def _repaired(part: Any, body: BodyData) -> tuple[Any, str | None]:
    """A broken solid repaired: healed, else stitched (faces that do not share their edges,
    edges with gaps between them), each kept only if it gives a sound solid. Returns the part
    (the one given if nothing helped) and what is still wrong with it (None: nothing)."""
    try:
        healed = part.heal()
        if _sound(healed):
            return healed, None
    except KernelError:
        pass
    stitched = _stitched(part, body)
    if stitched is not None:
        fixed, gap = stitched
        warnings.warn(f"{_op()}: the faces of {_label(body)} did not share "
                      f"their edges; stitched them, closing gaps of up to {gap:.2g} mm", RuntimeWarning, stacklevel=5)
        return fixed, None
    try:
        return part, part._solid_problem() or "not a sound solid"
    except KernelError:
        return part, "a body whose volume cannot be integrated"


def _stitched(part: Any, body: BodyData) -> tuple[Any, float] | None:
    """A broken closed shell sewn into a valid solid, with the largest gap closed; None if no
    stitch gives one. The kernel's stitch first (it widens its own tolerance); then explicit
    tolerances, doubling from the larger of the file's declared uncertainty and the gaps the
    kernel measured, up to 1e-3 of the body's size. (The declared uncertainty alone is no
    guide: smlibpy writes 1e-7 into files whose gaps reach 1e-3.) Each stitched body is
    healed where it needs to be (a seam the stitch joined from two edges of the file lacks its
    face's seam), and kept only if it is a valid solid, its faces' gaps measured too."""
    from .shapes import Part, _take

    measured = 0.0
    h = BrepHandle(part._copy_brep())
    try:
        with kernel_call(_op(": stitch")):
            _, _, _, vgap, egap = k.stitch_into_solid(h.brep)
        measured = max(float(vgap), float(egap))
        candidate = _valid_or_healed(Part._wrap(_take(h)))
        if candidate is not None:
            return candidate, measured
    except KernelError:
        pass
    tol = max(body.uncertainty or 0.0, measured, 1e-7)
    cap = 1e-3 * part._extent()
    while tol <= cap:
        h = BrepHandle(part._copy_brep())
        try:
            with kernel_call(_op(": stitch")):
                k.stitch_advanced(h.brep, tol)
            candidate = _valid_or_healed(Part._wrap(_take(h)))
            if candidate is not None:
                return candidate, tol
        except KernelError:
            pass
        tol *= 2
    return None


def _valid_or_healed(part: Any) -> Any:
    """The part if it is a valid solid (``is_valid()``: its faces' gaps measured too), else it
    healed if that is one, else None."""
    def valid(p: Any) -> bool:
        return _sound(p) and p._solid_problem(gaps=True) is None

    if valid(part):
        return part
    if part._shape_problem() is None:  # closed: the healer may mend its seams and gaps
        try:
            healed = part.heal()
            if valid(healed):
                return healed
        except KernelError:
            pass
    return None


def _apart(body: BodyData, faces: list[int]) -> bool:
    """Whether some faces of a shell share no edge with the others (in the file): the shell
    falls apart into pieces that only stitching joins."""
    if len(faces) < 2:
        return False
    group = {fi: fi for fi in faces}

    def root(f: int) -> int:
        while group[f] != f:
            group[f] = group[group[f]]
            f = group[f]
        return f

    first: dict[int, int] = {}  # edge -> a face using it
    for fi in faces:
        for loop in body.faces[fi]["loops"]:
            for ei, _ in loop.get("edges") or ():
                if ei in first:
                    group[root(fi)] = root(first[ei])
                else:
                    first[ei] = fi
    return len({root(f) for f in faces}) > 1


def _sewn(sheet: Any, body: BodyData) -> Any:
    """A sheet whose faces share no edges with each other in the file, sewn along the edges
    that meet within 1e-3 of its size (kept if anything was sewn)."""
    from .shapes import Shell, _take

    h = BrepHandle(sheet._copy_brep())
    try:
        tol = max(body.uncertainty or 0.0, 1e-3 * sheet._loose_box().diagonal)
        with kernel_call(_op(": stitch")):
            _, _, stitched, vgap, egap = k.stitch_into_shell(h.brep, tol)
        if int(stitched) > 0:
            warnings.warn(f"{_op()}: the faces of {_label(body)} did not "
                          f"share their edges; stitched {int(stitched)} edges, closing gaps of up to "
                          f"{max(float(vgap), float(egap)):.2g} mm", RuntimeWarning, stacklevel=5)
            return Shell._wrap(_take(h))
    except KernelError:
        pass
    return sheet


@dataclass(frozen=True)
class StepFrame:
    """A coordinate system of a STEP file (a named ``AXIS2_PLACEMENT_3D``) at its place in
    the assembly. ``product`` names the part or assembly it belongs to."""

    name: str
    plane: Plane
    product: str = ""
    color: tuple[float, float, float] | None = None

    @property
    def location(self) -> Location:
        """The placement that moves the world origin onto this coordinate system."""
        return self.plane.location

    def __repr__(self) -> str:
        return f"StepFrame({self.name!r}, product={self.product!r}, {self.plane!r})"


@dataclass(frozen=True)
class StepCurve:
    """A curve of a STEP file that belongs to no body (wireframe geometry, contours), at its
    place in the assembly: an :class:`~smlibpy.Edge`, or a :class:`~smlibpy.Wire` for a
    composite curve."""

    name: str
    shape: Any
    product: str = ""
    color: tuple[float, float, float] | None = None

    def __repr__(self) -> str:
        return f"StepCurve({self.name!r}, product={self.product!r}, {self.shape!r})"


@dataclass(frozen=True)
class StepPoint:
    """A point of a STEP file that belongs to no body, at its place in the assembly."""

    name: str
    point: Vector
    product: str = ""
    color: tuple[float, float, float] | None = None

    def __repr__(self) -> str:
        return f"StepPoint({self.name!r}, product={self.product!r}, {self.point!r})"


@dataclass(frozen=True)
class StepModel:
    """Everything :func:`read_step` reads from a STEP file: the bodies (what
    :func:`import_step` returns, always as a list), and the coordinate systems, curves and
    points that belong to no body. ``skipped`` says which bodies could not be read, and why
    (``"body 'b' (#99): curve type CLOTHOID (#203), which is not supported"``)."""

    bodies: Any
    frames: list[StepFrame] = field(default_factory=list)
    curves: list[StepCurve] = field(default_factory=list)
    points: list[StepPoint] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def frame(self, name: str, product: str | None = None) -> Plane:
        """The coordinate system called ``name`` as a :class:`~smlibpy.Plane`. Where several
        have that name (each part of a tool assembly has its own ``MCS``), ``product`` picks
        the one of the product whose name is or begins with it."""
        found = [f for f in self.frames if f.name == name and (product is None or f.product.startswith(product))]
        if len(found) == 1:
            return found[0].plane
        if not found:
            names = sorted({f.name for f in self.frames})
            raise KeyError(f"no coordinate system {name!r}" + (f" in product {product!r}" if product else "")
                           + (f"; there are {', '.join(map(repr, names))}" if names else "; the file has none"))
        raise KeyError(f"{len(found)} coordinate systems are called {name!r}, in "
                       f"{', '.join(repr(f.product) for f in found)}: choose one with product=")

    def __repr__(self) -> str:
        return (f"StepModel({len(self.bodies)} bodies, {len(self.frames)} frames, {len(self.curves)} curves, "
                f"{len(self.points)} points" + (f", {len(self.skipped)} skipped" if self.skipped else "") + ")")



def _rigid(m: np.ndarray) -> bool:
    """Whether a placement only turns and moves (no mirror, no scale)."""
    r = m[:3, :3]
    return bool(np.allclose(r.T @ r, np.eye(3), atol=1e-9) and np.linalg.det(r) > 0)


def _bodies(sf: StepFile, heal: bool, strict: bool) -> tuple[list[Any], list[str]]:
    """The bodies of a parsed file in file order, and what was left out (one message per body
    that could not be read, with the number of its instances). ``strict`` raises
    ``ModelingError`` for the first body that cannot be read instead.

    An assembly lists a product once per instance, all with the same data: each is built
    once, at its first placement, and its other instances are placed copies of it (a robot
    of 1472 instances of 714 bodies built 135,856 faces for 53,293)."""
    skipped: list[dict[str, Any]] = []
    found = interpret(sf, skipped=skipped)
    if strict and skipped:
        raise ModelingError(f"import STEP: {skipped[0]['message']}")
    out: list[Any] = []
    built: dict[int, tuple[Any, np.ndarray]] = {}  # id(BodyData) -> (body, the placement it was built at)
    failed: dict[int, list[Any]] = {}  # id(BodyData) -> [message, instances]
    for body, m in found:
        key = id(body)
        if key in failed:
            failed[key][1] += 1
            continue
        try:
            if key not in built:
                # (a placement that mirrors or scales: the body is built where it is defined and
                # moved there whole, as Shape.mirror and Shape.scale move a body)
                at = m if _rigid(m) else np.eye(4)
                built[key] = (_build_body(body, at, heal), at)
                if at is m:
                    out.append(built[key][0])
                    continue
            first, at = built[key]
            out.append(first._transformed(m @ np.linalg.inv(at)))
        except _BODY_ERRORS as e:
            message = f"{_body_label(body.entity, body.name, body.product)}: {_failure(e)}"
            if strict:
                raise ModelingError(f"import STEP: {message}") from e
            failed[key] = [message, 1]
    notes = [s["message"] for s in skipped]
    notes += [message + (f" ({n} instances)" if n > 1 else "") for message, n in failed.values()]
    for note in notes:
        warnings.warn(f"import STEP: left out {note}", RuntimeWarning, stacklevel=3)
    return out, notes


def read_step(path: str | os.PathLike[str], *, heal: bool = True, strict: bool = False) -> StepModel:
    """Read everything a STEP file holds that smlibpy can use: its bodies, and the
    coordinate systems, curves and points that belong to no body.

    The bodies are those of :func:`import_step`, as a :class:`~smlibpy.ShapeList` also when
    there is one. Coordinate systems are the placements of supplemental geometry (as NX,
    CATIA and tool catalogs write ``MCS``, ``PCS`` or ``CSW``) and the named placements of
    shape representations; curves and points are the wireframe geometry (contours such as a
    tool's cutting edge line, curve sets, reference points). Each carries its name and the
    product it belongs to, at its place in the assembly, in millimeters. Items on hidden
    layers are left out. A file with no bodies gives an empty ``bodies``. A body that cannot
    be read is left out with a warning and listed in ``skipped`` (``strict=True`` raises
    instead), as :func:`import_step` does.
    """
    with open(os.fspath(path), "r", encoding="latin-1") as fh:
        sf = parse(fh.read())
    found, skipped = _bodies(sf, heal, strict)
    return _model(sf, found, skipped)


def from_step_model(data: str | bytes, *, heal: bool = True, strict: bool = False) -> StepModel:
    """Everything STEP file contents hold that smlibpy can use (the text, or the bytes of the
    file): :func:`read_step` for contents in memory, such as an upload."""
    sf = parse(_text(data, "from_step_model"))
    found, skipped = _bodies(sf, heal, strict)
    return _model(sf, found, skipped)


def _text(data: Any, what: str) -> str:
    """The text of STEP file contents (bytes as ISO 8859-1, as files are read), its lines ending in
    a line feed (as a file opened as text gives them)."""
    if isinstance(data, (bytes, bytearray, memoryview)):
        data = bytes(data).decode("latin-1")
    elif not isinstance(data, str):
        raise TypeError(f"{what} takes the file's contents: a str or bytes, not {type(data).__name__}")
    return data.replace("\r\n", "\n").replace("\r", "\n")


def _model(sf: StepFile, found: list[Any], skipped: list[str]) -> StepModel:
    from .shapes import ShapeList

    model = StepModel(ShapeList(found), skipped=skipped)
    for item in interpret_extras(sf):
        name, product, color = item["name"], item["product"], item["color"]
        if item["kind"] == "frame":
            plane = Plane(Vector(*item["origin"]), x_dir=Vector(*item["x"]), z_dir=Vector(*item["z"]))
            model.frames.append(StepFrame(name, plane, product, color))
        elif item["kind"] == "point":
            model.points.append(StepPoint(name, Vector(*item["point"]), product, color))
        else:
            try:
                shape = _curve_shape(item["curve"])
            except (KernelError, ValueError):
                shape = None
            if shape is not None:
                model.curves.append(StepCurve(name, shape, product, color))
    return model


def _curve_shape(c: dict[str, Any]) -> Any:
    """An edge (a wire for a composite curve) from a curve of ``interpret_extras``; None for
    one that cannot be drawn."""
    from .shapes import Wire

    kind = c["kind"]
    if kind == "composite":
        edges = []
        for segment, same in c["segments"]:
            s = _curve_shape(segment)
            if s is None:
                return None
            parts = list(s.edges()) if isinstance(s, Wire) else [s]
            edges.extend(parts if same else [e.reversed() for e in reversed(parts)])
        return Wire._raw(edges) if len(edges) > 1 else edges[0] if edges else None
    if kind == "trimmed":
        return _trimmed_edge(c["basis"], c["trims"], c["sense"])
    if kind == "bspline":
        return Edge._from_curve(_bspline_curve(c))
    if kind in ("circle", "ellipse"):
        return _conic_edge(c, 0.0, 2 * math.pi)
    return None


def _bspline_curve(c: dict[str, Any]) -> Any:
    from .shapes import _canonical_curve

    with kernel_call("read STEP curve"):
        return _canonical_curve(np.asarray(c["poles"]), c["knots"], c["degree"], c["weights"])


def _conic_edge(c: dict[str, Any], t0: float, t1: float) -> Any:
    """A circle or ellipse from angle ``t0`` to ``t1`` (radians, the direction they say)."""
    plane = Plane(Vector(*c["origin"]), x_dir=Vector(*c["x"]), z_dir=Vector(*c["z"]))
    a0, span = math.degrees(t0), math.degrees(t1 - t0)
    if abs(span) < 1e-12 or abs(span) >= 360.0 - 1e-9:
        span = 360.0 if span >= 0 else -360.0
    if c["kind"] == "circle":
        return CenterArc((0, 0), c["radius"], a0, span, plane)
    lo, hi = (a0, a0 + span) if span > 0 else (a0 + span, a0)
    e = EllipticalArc((0, 0), c["r1"], c["r2"], lo, hi if abs(span) < 360.0 else lo, plane)
    return e if span > 0 else e.reversed()


def _trimmed_edge(basis: dict[str, Any], trims: list[dict[str, Any]], sense: bool) -> Any:
    kind = basis["kind"]

    def param(trim: dict[str, Any]) -> float:
        if "param" in trim:
            return trim["param"]
        d = trim["point"] - basis.get("origin", 0.0)
        if kind == "line":
            v = basis["direction"]
            return float(d.dot(v) / v.dot(v))
        if kind in ("circle", "ellipse"):
            x, z = basis["x"], basis["z"]
            y = np.cross(z, x)
            r1, r2 = (basis["radius"],) * 2 if kind == "circle" else (basis["r1"], basis["r2"])
            return math.atan2(float(d.dot(y)) / r2, float(d.dot(x)) / r1)
        raise ValueError("no parameter")

    if kind == "line":
        o, v = basis["origin"], basis["direction"]
        return Line(tuple(o + v * param(trims[0])), tuple(o + v * param(trims[1])))
    if kind in ("circle", "ellipse"):
        t0, t1 = param(trims[0]), param(trims[1])
        turn = 2 * math.pi
        t1 = t0 + ((t1 - t0) % turn or turn) if sense else t0 - ((t0 - t1) % turn or turn)
        return _conic_edge(basis, t0, t1)
    if kind == "bspline":
        curve = _bspline_curve(basis)
        try:
            ts = []
            for trim in trims:
                if "param" in trim:
                    ts.append(trim["param"])
                else:
                    _, t, _ = k.curve_closest_point(curve, tuple(trim["point"]))
                    ts.append(float(t))
            lo, hi = min(ts), max(ts)
            with kernel_call("read STEP curve"):
                part = ext.trimmed_curve(curve, lo, hi) if hi - lo > 1e-12 else None
        finally:
            ext.delete_curve(curve)
        if part is None:
            return None
        e = Edge._from_curve(part)
        return e if (ts[0] <= ts[1]) == sense else e.reversed()
    return None


def import_step(path: str | os.PathLike[str], *, heal: bool = True, strict: bool = False) -> Any:
    """Read the solids and surfaces of a STEP file (AP203, AP214, AP242 B-rep data).

    Returns a single :class:`~smlibpy.Part` (or :class:`~smlibpy.Shell`) when the file
    holds one body, otherwise a :class:`~smlibpy.ShapeList` of them. Lengths are converted
    to millimeters; assembly placements are applied; names and colors are kept. ``heal``
    repairs bodies that come out invalid (valid ones are left alone): the
    kernel's healer, then stitching where faces do not share their edges, each with a warning
    when it changed the body or could not repair it.

    A body that cannot be read (an entity smlibpy does not read, one the kernel cannot build)
    is left out with a ``RuntimeWarning`` that names it, its entity and the reason; the other
    bodies are read. ``strict=True`` raises ``ModelingError`` for it instead. A file none of
    whose bodies can be read raises.
    """
    with open(os.fspath(path), "r", encoding="latin-1") as fh:
        sf = parse(fh.read())
    found, skipped = _bodies(sf, heal, strict)
    return _result(found, skipped)


def from_step(data: str | bytes, *, heal: bool = True, strict: bool = False) -> Any:
    """Read the solids and surfaces of STEP file contents (the text, or the bytes of the file):
    :func:`import_step` for contents in memory, such as an upload or the text of
    :func:`~smlibpy.to_step`.

    Returns a single :class:`~smlibpy.Part` (or :class:`~smlibpy.Shell`) when the contents hold
    one body, otherwise a :class:`~smlibpy.ShapeList` of them; ``heal`` and ``strict`` as for
    :func:`import_step`.
    """
    sf = parse(_text(data, "from_step"))
    found, skipped = _bodies(sf, heal, strict)
    return _result(found, skipped)


def _result(found: list[Any], skipped: list[str]) -> Any:
    from .shapes import ShapeList

    if not found:
        if skipped:
            raise ModelingError(f"import STEP: no body of the file could be read: {'; '.join(skipped[:3])}"
                                + ("; ..." if len(skipped) > 3 else ""))
        raise ModelingError("the STEP file holds no B-rep solids or surfaces")
    out = ShapeList(found)
    return out[0] if len(out) == 1 else out
