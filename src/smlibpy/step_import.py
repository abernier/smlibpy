"""STEP import: neutral B-rep data from ``step_reader`` -> kernel bodies.

Each face is rebuilt on an exact kernel surface, each edge as an exact curve spanning
exactly that edge (lines, circular arcs, ellipses and NURBS keep their types). The
faces of a shell are joined by the kernel's stitcher and the result is healed.
"""

from __future__ import annotations

import math
import os
from typing import Any

import numpy as np

from ._kernel import KernelError, ModelingError, ext, k, kernel_call
from .step_reader import BodyData, interpret, parse

__all__ = ["import_step"]


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

    # -- transforms ------------------------------------------------------------
    def P(self, p: Any) -> np.ndarray:
        return self.R @ np.asarray(p, dtype=float) + self.t

    def D(self, d: Any) -> np.ndarray:
        return self.R @ np.asarray(d, dtype=float)

    # -- edges -----------------------------------------------------------------
    def edge_spec(self, ei: int) -> dict[str, Any]:
        """The exact curve of edge ``ei`` from its start to its end vertex."""
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
        # NURBS
        poles = np.array([self.P(p) for p in c["poles"]])
        return {"kind": "bspline", "degree": c["degree"], "poles": poles, "knots": list(c["knots"]),
                "weights": c["weights"], "p0": p0, "p1": p1, "forward": e["same_sense"], "closed": closed}

    # -- surfaces ---------------------------------------------------------------
    def face_points(self, face: dict[str, Any]) -> list[np.ndarray]:
        pts = []
        for loop in face["loops"]:
            if "vertex" in loop and loop.get("edges") is None:
                pts.append(self.P(self.b.vertices[loop["vertex"]]))
                continue
            for ei, _ in loop["edges"]:
                spec = self.edge_spec(ei)
                pts.extend(_sample(spec))
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
            has_seam = any(_is_seam_loop(loop) for loop in face["loops"] if loop.get("edges"))
            if not has_seam:
                # move the parameter seam of the periodic surface into the largest gap
                # between the face's boundary points, so the face does not straddle it
                angs = sorted(_angle_in(o, z, x, p) for p in pts)
                if angs:
                    gaps = [(angs[(i + 1) % len(angs)] - angs[i]) % (2 * math.pi) for i in range(len(angs))]
                    i = int(np.argmax(gaps))
                    mid = angs[i] + gaps[i] / 2
                    y = np.cross(z, x)
                    spec["x"] = _unit(x * math.cos(mid) + y * math.sin(mid))
            if kind in ("cylinder", "cone"):
                h = [(p - o).dot(z) for p in pts]
                pad = 0.05 * max(max(h) - min(h), 1e-6) + 1e-6
                spec["height"] = (min(h) - pad, max(h) + pad)
                spec["radius"] = s["radius"]
                if kind == "cone":
                    spec["semi_angle"] = s["semi_angle"]
            elif kind == "sphere":
                spec["radius"] = s["radius"]
            else:
                spec["major"], spec["minor"] = s["major"], s["minor"]
            return spec
        if kind == "bspline":
            return {"kind": "bspline", "u_degree": s["u_degree"], "v_degree": s["v_degree"], "nu": s["nu"],
                    "nv": s["nv"], "poles": np.array([self.P(p) for p in s["poles"]]), "u_knots": s["u_knots"],
                    "v_knots": s["v_knots"], "weights": s["weights"]}
        if kind == "extrusion":
            return {"kind": "extrusion", "curve": self._free_curve(s["curve"]), "vector": self.D(s["vector"])}
        if kind == "revolution":
            return {"kind": "revolution", "curve": self._free_curve(s["curve"]), "axis_origin": self.P(s["axis_origin"]),
                    "axis": _unit(self.D(s["axis"]))}
        if kind == "offset":
            base = dict(face, surface=None)
            sub = _Builder(self.b, self.m)
            inner = sub._surface_from(s["basis"], face)
            return {"kind": "offset", "basis": inner, "distance": s["distance"]}
        raise NotImplementedError(f"surface {kind}")

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
        raise NotImplementedError(f"generator curve {kind}")


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


def _build_body(body: BodyData, m: np.ndarray, heal: bool) -> Any:
    from .shapes import Part, Shell

    bld = _Builder(body, m)
    faces = []
    for f in body.faces:
        loops = []
        for loop in f["loops"]:
            if loop.get("edges"):
                loops.append({"edges": [(bld.edge_spec(ei), bool(fwd)) for ei, fwd in loop["edges"]]})
            elif "vertex" in loop:
                loops.append({"vertex": bld.P(body.vertices[loop["vertex"]])})
        faces.append({"surface": bld.surface_spec(f), "same_sense": bool(f["same_sense"]), "loops": loops})
    det = float(np.linalg.det(m[:3, :3]))
    shells = []
    for sh in body.shells:
        shells.append({"faces": [faces[i] for i in sh["faces"]], "reversed": bool(sh["reversed"]) ^ (det < 0),
                       "closed": bool(sh.get("closed", True))})
    solid = body.kind == "solid"
    parts = []
    for i, sh in enumerate(shells):
        with kernel_call("import STEP", "the file may hold faces the kernel cannot rebuild"):
            brep = ext.build_brep(sh["faces"], solid and sh["closed"], sh["reversed"], heal)
        p = Part._wrap(brep) if solid and sh["closed"] else Shell._wrap(brep)
        parts.append(p)
    if not parts:
        raise ModelingError("empty body")
    result = parts[0]
    if solid and len(parts) > 1:
        for void in parts[1:]:  # BREP_WITH_VOIDS: subtract the cavities
            result = result - void
    elif len(parts) > 1:
        from .surfaces import stitch

        result = stitch(parts)
    if body.name:
        result.name = body.name
    if body.color is not None:
        result.color = body.color
    return result


def import_step(path: str | os.PathLike[str], *, heal: bool = True) -> Any:
    """Read the solids and surfaces of a STEP file (AP203, AP214, AP242 B-rep data).

    Returns a single :class:`~smlibpy.Part` (or :class:`~smlibpy.Shell`) when the file
    holds one body, otherwise a :class:`~smlibpy.ShapeList` of them. Lengths are converted
    to millimeters; assembly placements are applied; names and colors are kept.
    """
    from .shapes import ShapeList

    with open(os.fspath(path), "r", encoding="latin-1") as fh:
        sf = parse(fh.read())
    bodies = interpret(sf)
    if not bodies:
        raise ModelingError("the STEP file holds no B-rep solids or surfaces")
    out = ShapeList(_build_body(b, m, heal) for b, m in bodies)
    return out[0] if len(out) == 1 else out
