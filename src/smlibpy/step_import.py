"""STEP import: neutral B-rep data from ``step_reader`` -> kernel bodies.

Each face is rebuilt on an exact kernel surface, each edge as an exact curve spanning
exactly that edge (lines, circular arcs, ellipses and NURBS keep their types). The
topology of the file is kept: faces share their edges as they do in the file, so no
stitching is needed. Bodies that still come out invalid are healed.
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
        if kind in ("hyperbola", "parabola"):
            return _conic_arc(c, self.P(c["origin"]), _unit(self.D(c["z"])), _unit(self.D(c["x"])), p0, p1)
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
            return spec
        if kind == "bspline":
            return {"kind": "bspline", "u_degree": s["u_degree"], "v_degree": s["v_degree"], "nu": s["nu"],
                    "nv": s["nv"], "poles": np.array([self.P(p) for p in s["poles"]]), "u_knots": s["u_knots"],
                    "v_knots": s["v_knots"], "weights": s["weights"]}
        if kind == "extrusion":
            curve = self._free_curve(s["curve"])
            vec = self.D(s["vector"])
            L2 = float(vec.dot(vec))
            base = np.asarray(curve["poles"][0] if curve["kind"] == "bspline" else curve.get("p0", curve.get("center")))
            vs = [float((p - base).dot(vec) / L2) for p in self.face_points(face)]
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


def _largest_gap(o: np.ndarray, z: np.ndarray, x: np.ndarray, pts: list[np.ndarray]) -> np.ndarray:
    """The direction about the axis in the middle of the largest angular gap between the
    points (where a face without a seam edge does not reach)."""
    angs = sorted(_angle_in(o, z, x, p) for p in pts)
    gaps = [(angs[(i + 1) % len(angs)] - angs[i]) % (2 * math.pi) for i in range(len(angs))]
    i = int(np.argmax(gaps))
    mid = angs[i] + gaps[i] / 2
    return _unit(x * math.cos(mid) + np.cross(z, x) * math.sin(mid))


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
    circles, points = [], []
    for loop in f["loops"]:
        if not loop.get("edges"):
            if "vertex" in loop:
                points.append(bld.P(bld.b.vertices[loop["vertex"]]))
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


def _build_body(body: BodyData, m: np.ndarray, heal: bool) -> Any:
    from .shapes import Part, Shell

    bld = _Builder(body, m)
    mirrored = float(np.linalg.det(m[:3, :3])) < 0
    if mirrored:
        raise ModelingError("mirrored assembly placements are not supported yet")
    edges = bld.specs
    faces = []
    for fi, f in enumerate(body.faces):
        loops = []
        for loop in _outer_first(bld, f["loops"]):
            if loop.get("edges"):
                for ei, _ in loop["edges"]:
                    if ei not in edges:
                        edges[ei] = bld.edge_spec(ei)
                loops.append({"edges": [(int(ei), bool(fwd)) for ei, fwd in loop["edges"]]})
            elif "vertex" in loop:
                loops.append({"vertex": bld.P(body.vertices[loop["vertex"]])})
        srf = body.surfaces[f["surface"]]
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
        faces.append({"surface": bld.surface_spec(f), "same_sense": bool(f["same_sense"]), "loops": loops})
    solid = body.kind == "solid"
    parts = []
    for si, sh in enumerate(body.shells):
        closed = solid and bool(sh.get("closed", True))
        shell_faces = [faces[i] for i in sh["faces"]]
        # Cavities of a BREP_WITH_VOIDS are built as ordinary solids and subtracted later.
        reversed_ = bool(sh["reversed"]) and not (solid and si > 0)
        with kernel_call("import STEP", "the file may hold faces the kernel cannot rebuild"):
            brep = ext.build_brep(shell_faces, edges, closed, reversed_, False)
        part = Part._wrap(brep) if closed else Shell._wrap(brep)
        if closed and not _positive(part):
            with kernel_call("import STEP"):
                part = Part._wrap(ext.build_brep(shell_faces, edges, closed, not reversed_, False))
        if heal and closed and not _sound(part):
            # Only heal what came out broken: the kernel's healer can damage good bodies.
            try:
                healed = part.heal()
                if _sound(healed):
                    part = healed
            except KernelError:
                pass
        parts.append(part)
    if not parts:
        raise ModelingError("empty body")
    result = parts[0]
    if solid and len(parts) > 1:
        for void in parts[1:]:  # BREP_WITH_VOIDS: subtract the cavities
            result = result - void
    elif len(parts) > 1:  # a surface model of several shells stays a surface
        with kernel_call("import STEP"):
            result = Shell._wrap(ext.combine([p._brep for p in parts]))
    if body.name:
        result.name = body.name
    if body.color is not None:
        result.color = body.color
    return result


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


def _sound(part: Any) -> bool:
    try:
        return bool(part.is_valid()) and part._props(accuracy=1e-4)["volume"] > 0
    except KernelError:
        return False


def _positive(part: Any) -> bool:
    try:
        return part._props(accuracy=1e-4)["volume"] > 0
    except KernelError:
        return False


def import_step(path: str | os.PathLike[str], *, heal: bool = True) -> Any:
    """Read the solids and surfaces of a STEP file (AP203, AP214, AP242 B-rep data).

    Returns a single :class:`~smlibpy.Part` (or :class:`~smlibpy.Shell`) when the file
    holds one body, otherwise a :class:`~smlibpy.ShapeList` of them. Lengths are converted
    to millimeters; assembly placements are applied; names and colors are kept.
    ``heal`` repairs bodies that come out invalid (valid ones are left alone).
    """
    from .shapes import ShapeList

    with open(os.fspath(path), "r", encoding="latin-1") as fh:
        sf = parse(fh.read())
    bodies = interpret(sf)
    if not bodies:
        raise ModelingError("the STEP file holds no B-rep solids or surfaces")
    out = ShapeList(_build_body(b, m, heal) for b, m in bodies)
    return out[0] if len(out) == 1 else out
