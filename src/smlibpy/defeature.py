"""Removing fillets and other faces from parts (defeaturing).

The kernel does the work, on a copy of the part:

* SMLib's fillet removal (``SmFilletRemoval``) takes out a fillet that runs between two faces
  and ends at sharp edges, and extends those two faces to their sharp edge again.
* SMLib's feature executive (``SmFeatureExecutive``) cuts a connected set of faces out and
  closes the hole by extending the faces around it, or with a flat cap. It takes out fillets
  that meet at corner patches, fillets around bosses and holes, and holes, bosses and pockets.

Every result is checked: a valid solid, and a volume that went the right way (up where convex
fillets or holes were taken out, down for concave fillets and bosses).
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any, Iterable

from ._kernel import ModelingError, k

if TYPE_CHECKING:  # pragma: no cover
    from .shapes import Face, Part, ShapeList

__all__ = ["fillet_faces", "remove_fillets", "remove_faces"]

#: Angle (degrees) between the normals of two faces along an edge below which the faces meet
#: tangentially: the edge is a rail of a fillet.
TANGENCY = 2.0

_D = k.defeature


# =============================================================================
# Recognising fillets
# =============================================================================
class _Blends:
    """Cached blend data of faces (kernel face -> dict or None)."""

    def __init__(self) -> None:
        self._info: dict[int, tuple[Any, Any]] = {}  # id -> (kernel face, info); the face keeps the id unique

    def info(self, f: Face) -> dict[str, Any] | None:
        key = id(f._f)
        if key not in self._info:
            self._info[key] = (f._f, _D.blend_info(f._f, TANGENCY))
        return self._info[key][1]

    def _railed(self, f: Face) -> bool:
        i = self.info(f)
        return i is not None and len(i["rails"]) >= 2

    def is_edge_fillet(self, f: Face) -> bool:
        """A curved face that meets two other faces tangentially along edges that run across its
        curvature (its rails), where those faces are walls, not fillets themselves."""
        if not self._railed(f):
            return False
        from .shapes import Face

        walls = 0
        for e in self.info(f)["rails"]:  # type: ignore[index]
            for kf in e.faces():
                if kf is not f._f and not self._railed(Face(f._owner, kf)):
                    walls += 1
        return walls >= 2

    def corner_fillets(self, f: Face) -> list[Face]:
        """The edge fillets a corner patch joins, or [] if ``f`` is no corner patch: a curved face
        with three or more edges that is no edge fillet, meets all its neighbours tangentially,
        joins at least two edge fillets and is curved about as tightly as they are. (A wall
        between two fillets, such as the side of a disc rounded at both ends, is no corner.)"""
        i = self.info(f)
        if i is None or i["sharp"] or i["edges"] < 3 or self.is_edge_fillet(f):
            return []
        out = [g for g in f.neighbors() if self.is_edge_fillet(g)]
        if len(out) < 2 or i["radius"] > 2.0 * max(float(self.info(g)["radius"]) for g in out):  # type: ignore[index]
            return []
        return out

    def radius(self, f: Face) -> float:
        """The fillet radius of an edge fillet, or of the fillets a corner patch joins."""
        if self.is_edge_fillet(f):
            return float(self.info(f)["radius"])  # type: ignore[index]
        return max((float(self.info(g)["radius"]) for g in self.corner_fillets(f)), default=math.nan)  # type: ignore[index]

    def convex(self, f: Face) -> bool:
        if self.is_edge_fillet(f):
            return bool(self.info(f)["convex"])  # type: ignore[index]
        return all(bool(self.info(g)["convex"]) for g in self.corner_fillets(f))  # type: ignore[index]


def _radius_ok(r: float, max_radius: float | None) -> bool:
    return max_radius is None or r <= max_radius * (1 + 1e-9) + 1e-12


def fillet_faces(faces: Iterable[Face], max_radius: float | None = None, *, _blends: _Blends | None = None) -> ShapeList[Face]:
    """The fillets among ``faces`` (see :meth:`ShapeList.fillets`)."""
    from .shapes import Face, ShapeList

    if max_radius is not None and not max_radius > 0:
        raise ValueError("fillets: max_radius must be positive")
    b = _blends or _Blends()
    out: ShapeList[Face] = ShapeList()
    for f in faces:
        if not isinstance(f, Face):
            continue
        if b.is_edge_fillet(f):
            if _radius_ok(b.radius(f), max_radius):
                out.append(f)
            continue
        corner = b.corner_fillets(f)
        if corner and all(_radius_ok(b.radius(g), max_radius) for g in corner):
            out.append(f)
    return out


# =============================================================================
# Removing faces
# =============================================================================
def _groups(faces: list[Face]) -> list[list[Face]]:
    """The faces split into sets connected through shared edges."""
    index = {f._identity(): i for i, f in enumerate(faces)}
    parent = list(range(len(faces)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, f in enumerate(faces):
        for g in f.neighbors():
            j = index.get(g._identity())
            if j is not None:
                parent[find(i)] = find(j)
    groups: dict[int, list[Face]] = {}
    for i, f in enumerate(faces):
        groups.setdefault(find(i), []).append(f)
    return list(groups.values())


def _faces_of(part: Part, faces: Any, what: str) -> list[Face]:
    from .shapes import Face, ShapeList, _flatten_faces

    if isinstance(faces, (Face, ShapeList, list, tuple)) or hasattr(faces, "__iter__"):
        if not _flatten_faces(faces):
            raise ValueError(f"{what}: no faces selected")
    own = part._own_faces(faces)
    seen: set[int] = set()
    out = []
    for kf in own:
        if id(kf) not in seen:
            seen.add(id(kf))
            out.append(Face(part, kf))
    return out


def _match(body: Part, faces: list[Face]) -> list[Face]:
    """The faces of ``body`` that hold the interior points of ``faces`` (faces of an earlier
    version of the body)."""
    tol = 1e-7 * max(1.0, body.bbox().diagonal)
    own = list(body.faces())
    out: list[Face] = []
    for f in faces:
        p = f.interior_point()
        hits = [g for g in own if g.distance_to(p) <= tol]
        for g in hits:
            if g not in out:
                out.append(g)
    return out


def _volume(part: Part) -> float:
    return float(part._props(accuracy=1e-9)["volume"])


def _problem(before: float, result: Part, expect: int, bound: float | None) -> str | None:
    """What is wrong with a result, or None. ``expect``: +1 volume must grow, -1 shrink, 0 any."""
    problem = result._solid_problem()
    if problem is not None:
        return f"a body that is {problem}"
    after = _volume(result)
    slack = 1e-9 * max(abs(before), 1.0)
    if expect > 0 and not after > before + slack:
        return f"a volume that did not grow ({before:.6g} -> {after:.6g})"
    if expect < 0 and not after < before - slack:
        return f"a volume that did not shrink ({before:.6g} -> {after:.6g})"
    if bound is not None and abs(after - before) > bound:
        return f"a volume change of {abs(after - before):.6g}, more than the fillets can make ({bound:.6g})"
    return None


def _fillet_bound(b: _Blends, faces: list[Face]) -> float:
    """The most volume taking out the fillets can add or remove. A fillet of radius r on an
    edge whose faces meet at an inside angle of 8 degrees or more fills at most 4 r times its
    area (90 degrees: 0.14 r)."""
    total = 0.0
    for f in faces:
        r = b.radius(f)
        total += 4.0 * f.area * (r if math.isfinite(r) else f.bbox().diagonal)
    return total


def _remove_pass(part: Part, faces: list[Face], b: _Blends, expect: int) -> Part:
    """Take one set of fillet faces of ``part`` out and check the result."""
    before = _volume(part)
    bound = _fillet_bound(b, faces)
    edge = [f for f in faces if b.is_edge_fillet(f)]
    corners = [f for f in faces if not b.is_edge_fillet(f)]
    failures: list[str] = []

    def executive(body: Part, rest: list[Face]) -> Part | None:
        res = _D.defeature(body._brep, [[f._f for f in g] for g in _groups(rest)], "extend")
        if res["brep"] is None:
            failures.append("the kernel could not close the gap the fillets leave")
            return None
        return part._like(res["brep"])

    # 1. Fillets with sharp ends one by one, then whatever is left (corner patches, rings).
    body: Part | None = part
    rest = list(faces)
    if edge:
        res = _D.remove_fillet_faces(part._brep, [f._f for f in edge])
        if res["brep"] is not None:
            body = part._like(res["brep"])
            rest = [f for f, done in zip(edge, res["removed"]) if not done] + corners
            if rest:
                rest = _match(body, rest)
    if body is not None and rest:
        body = executive(body, rest)
    if body is not None and body is not part:
        problem = _problem(before, body, expect, bound)
        if problem is None:
            return body
        failures.append(f"the kernel returned {problem}")
    # 2. All at once by the executive.
    if edge and body is not part:
        body = executive(part, faces)
        if body is not None:
            problem = _problem(before, body, expect, bound)
            if problem is None:
                return body
            failures.append(f"the kernel returned {problem}")
    reason = failures[-1] if failures else "the kernel could not take them out"
    raise ModelingError(f"remove_fillets: {reason}; take out fewer fillets at a time, or the fillets around "
                        f"them first (corner patches go with the fillets they join)")


def remove_fillets(part: Part, faces: Any = None, *, max_radius: float | None = None) -> Part:
    """See :meth:`Part.remove_fillets`."""
    part._require_valid("remove_fillets")
    b = _Blends()
    if faces is None:
        sel = list(fillet_faces(part.faces(), max_radius, _blends=b))
        if not sel:
            return part
    else:
        given = _faces_of(part, faces, "remove_fillets")
        sel = list(fillet_faces(given, max_radius, _blends=b))
        if max_radius is None and len(sel) != len(given):
            others = [f for f in given if f not in sel]
            kinds = sorted({f.geom_type for f in others})
            raise ModelingError(f"remove_fillets: {len(others)} of the faces are no fillets ({', '.join(kinds)}); "
                                f"a fillet meets two faces tangentially along its length. Select fillets with "
                                f"part.faces().fillets(), or take other faces out with remove_faces")
        if not sel:
            return part
    # Corner patches go with their fillets: a fillet whose corner patch stays cannot go.
    for f in list(sel):
        for g in f.neighbors():
            if g not in sel and b.corner_fillets(g) and all(c in sel for c in b.corner_fillets(g)):
                sel.append(g)
    convex = [g for g in _groups(sel) if all(b.convex(f) for f in g)]
    concave = [g for g in _groups(sel) if not any(b.convex(f) for f in g)]
    mixed = [g for g in _groups(sel) if g not in convex and g not in concave]
    body = part
    for groups, expect in ((convex, 1), (concave, -1), (mixed, 0)):
        if not groups:
            continue
        faces_now = [f for g in groups for f in g]
        if body is not part:
            faces_now = _match(body, faces_now)
            if not faces_now:
                continue
        body = _remove_pass(body, faces_now, b, expect)
    return body


def _complete(faces: list[Face]) -> list[Face]:
    """The selection with the faces it encloses: a face all of whose neighbours are selected
    (the floor of a blind hole, the top of a boss) goes with them."""
    out = list(faces)
    changed = True
    while changed:
        changed = False
        ids = {f._identity() for f in out}
        for f in list(out):
            for g in f.neighbors():
                if g._identity() in ids:
                    continue
                if all(n._identity() in ids for n in g.neighbors()):
                    out.append(g)
                    ids.add(g._identity())
                    changed = True
    return out


def _feature_kind(group: list[Face]) -> int:
    """+1 for a depression (hole, pocket: its rim edges are convex), -1 for a protrusion (boss:
    concave rim), 0 if mixed."""
    ids = {f._identity() for f in group}
    kinds = set()
    for f in group:
        for e in f.edges():
            fs = e.faces()
            if len(fs) == 2 and sum(1 for x in fs if x._identity() in ids) == 1:
                kinds.add(e.convexity)
    kinds.discard("smooth")
    if kinds == {"convex"}:
        return 1
    if kinds == {"concave"}:
        return -1
    return 0


def remove_faces(part: Part, faces: Any) -> Part:
    """See :meth:`Part.remove_faces`."""
    part._require_valid("remove_faces")
    sel = _complete(_faces_of(part, faces, "remove_faces"))
    if len(sel) == len(part.faces()):
        raise ModelingError("remove_faces: that is every face of the part; nothing would be left")
    groups = _groups(sel)
    kinds = {_feature_kind(g) for g in groups}
    expect = kinds.pop() if len(kinds) == 1 else 0
    before = _volume(part)
    failures = []
    for rebuild in ("extend", "planar_cap"):
        res = _D.defeature(part._brep, [[f._f for f in g] for g in groups], rebuild)
        if res["brep"] is None:
            failures.append("could not close the hole the faces leave" if res["added"] else
                            "did not accept the faces as features (each set of connected faces must be bounded "
                            "by closed loops of edges)")
            continue
        body = part._like(res["brep"])
        problem = _problem(before, body, expect, None)
        if problem is None:
            return body
        failures.append(f"returned {problem}")
    raise ModelingError(f"remove_faces: the kernel {failures[0]}; select every face of the feature (the wall and "
                        f"the floor of a pocket, the side and the top of a boss) and take out its fillets first "
                        f"(remove_fillets)")
