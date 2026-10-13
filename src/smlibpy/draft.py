"""Draft analysis and parting lines, for parts that are molded or cast.

A mold half moves away from the part along the pull direction ``d``. A face releases from it
when it turns towards ``d``. The draft angle of a face at a point is the angle between the face
and ``d``: ``asin(n . d)`` for the outward normal ``n``, in degrees. It is +90 where the face
looks along ``d``, 0 on a wall parallel to ``d``, and negative where the face turns away from
``d`` (an undercut for that mold half).

The kernel provides the silhouettes of a surface for a direction (where ``n . d = 0``) and puts
curves into faces as edges; the parting line comes from a copy of the part split along them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Iterator

from ._kernel import ModelingError, ext, k, kernel_call
from .geometry import Axis, Vector, VectorLike, _direction

if TYPE_CHECKING:  # pragma: no cover
    from .shapes import Face, Part, ShapeList, Wire

__all__ = ["DraftAnalysis", "FaceDraft", "draft_analysis", "parting_line", "ANGLE_TOLERANCE"]

#: Draft angles (degrees) within this of 0 count as none: such a face is parallel to the pull
#: direction there.
ANGLE_TOLERANCE = 1e-6

_DR = k.draft
_GRID = 12  # parameter grid per face before the extremes are refined


def _range(face: Face, d: Vector) -> tuple[float, float]:
    """Least and greatest n . d over a face."""
    with kernel_call("draft angle"):
        r = _DR.face_draft_range(face._f, list(d.to_tuple()), _GRID)
    return float(r["min"]), float(r["max"])


def _degrees(s: float) -> float:
    return math.degrees(math.asin(max(-1.0, min(1.0, s))))


@dataclass(frozen=True)
class FaceDraft:
    """The draft of one face: the least and the greatest draft angle over it (degrees) and the
    group it falls in (``"positive"``, ``"insufficient"``, ``"vertical"`` or ``"undercut"``)."""

    face: Face
    min_angle: float
    max_angle: float
    kind: str

    def __repr__(self) -> str:
        return f"FaceDraft({self.face.geom_type}, {self.min_angle:.4g} to {self.max_angle:.4g} degrees, {self.kind})"


def _kind(lo: float, hi: float, min_angle: float) -> str:
    if abs(lo) <= ANGLE_TOLERANCE and abs(hi) <= ANGLE_TOLERANCE:
        return "vertical"
    if lo < -ANGLE_TOLERANCE:
        return "undercut"
    if lo >= min_angle - ANGLE_TOLERANCE:
        return "positive"
    return "insufficient"


class DraftAnalysis:
    """The draft of every face of a part for one pull direction.

    The faces fall into four groups, each a :class:`~smlibpy.ShapeList` of faces of the part
    (usable as a selection, for example for highlighting):

    * ``positive``: at least ``min_angle`` of draft everywhere; the face releases.
    * ``insufficient``: no negative draft, but less than ``min_angle`` somewhere.
    * ``vertical``: parallel to the pull direction everywhere (0 degrees).
    * ``undercut``: turns away from the pull direction somewhere (negative draft).

    ``faces`` holds one :class:`FaceDraft` per face with its least and greatest angle.
    """

    __slots__ = ("direction", "min_angle", "faces")

    def __init__(self, direction: Vector, min_angle: float, faces: list[FaceDraft]):
        self.direction = direction
        self.min_angle = min_angle
        self.faces = tuple(faces)

    def _group(self, kind: str) -> ShapeList[Face]:
        from .shapes import ShapeList

        return ShapeList(fd.face for fd in self.faces if fd.kind == kind)

    @property
    def positive(self) -> ShapeList[Face]:
        """Faces with at least ``min_angle`` of draft everywhere."""
        return self._group("positive")

    @property
    def insufficient(self) -> ShapeList[Face]:
        """Faces with less than ``min_angle`` of draft somewhere, but nowhere negative."""
        return self._group("insufficient")

    @property
    def vertical(self) -> ShapeList[Face]:
        """Faces parallel to the pull direction (no draft)."""
        return self._group("vertical")

    @property
    def undercut(self) -> ShapeList[Face]:
        """Faces that turn away from the pull direction somewhere (negative draft)."""
        return self._group("undercut")

    @property
    def ok(self) -> bool:
        """True if every face has at least ``min_angle`` of draft."""
        return all(fd.kind == "positive" for fd in self.faces)

    def angles(self, face: Face) -> tuple[float, float]:
        """The least and the greatest draft angle of a face of the part (degrees)."""
        for fd in self.faces:
            if fd.face == face:
                return fd.min_angle, fd.max_angle
        raise ValueError(f"{face!r} is not a face of the analysed part")

    def __iter__(self) -> Iterator[FaceDraft]:
        return iter(self.faces)

    def __len__(self) -> int:
        return len(self.faces)

    def __repr__(self) -> str:
        d = self.direction
        counts = ", ".join(f"{len(self._group(kd))} {kd}" for kd in ("positive", "insufficient", "vertical", "undercut"))
        return (f"DraftAnalysis(direction=({d.x:.4g}, {d.y:.4g}, {d.z:.4g}), min_angle={self.min_angle:g}: "
                f"{counts})")


def draft_analysis(part: Part, direction: Axis | VectorLike, *, min_angle: float = 1.0) -> DraftAnalysis:
    """See :meth:`Part.draft_analysis`."""
    d = _direction(direction, "draft_analysis")
    min_angle = float(min_angle)
    if not 0.0 <= min_angle < 90.0:
        raise ValueError("draft_analysis: min_angle must be at least 0 and less than 90 degrees")
    part._require_valid("draft_analysis")
    records = []
    for f in part.faces():
        lo, hi = _range(f, d)
        a, b = _degrees(lo), _degrees(hi)
        records.append(FaceDraft(f, a, b, _kind(a, b, min_angle)))
    return DraftAnalysis(d, min_angle, records)


# =============================================================================
# Parting line
# =============================================================================
_SIGN = 1e-9  # |n . d| below this counts as 0 when the faces are sorted to a side
_STRAY = 1e-2  # the most a split face may turn the other way near a traced silhouette (n . d)


def _side(lo: float, hi: float, eps: float) -> int | None:
    """+1 facing the direction, -1 facing away, 0 parallel, None both ways."""
    if hi <= eps and lo >= -eps:
        return 0
    if lo >= -eps:
        return 1
    if hi <= eps:
        return -1
    return None


def _loops(body: Any, edges: list[Any]) -> list[list[Any]]:
    """Edges of ``body`` grouped into chains connected at their vertices."""
    parent = list(range(len(edges)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    at: dict[int, int] = {}
    for i, e in enumerate(edges):
        kv = [v._v for v in e.vertices()]
        for key in ext.vertex_indices(body._brep, kv):  # stable ids: wrappers come and go
            if key in at:
                parent[find(i)] = find(at[key])
            else:
                at[key] = i
    groups: dict[int, list[Any]] = {}
    for i, e in enumerate(edges):
        groups.setdefault(find(i), []).append(e)
    return list(groups.values())


def parting_line(part: Part, direction: Axis | VectorLike) -> ShapeList[Wire]:
    """See :meth:`Part.parting_line`."""
    from .shapes import Edge, Part as _Part, ShapeList, Wire

    d = _direction(direction, "parting_line")
    part._require_valid("parting_line")
    size = max(part.bbox().diagonal, 1e-9)
    tolerance = 1e-6 * size  # fit tolerance of traced silhouettes
    eps = _SIGN
    straddling = []
    for f in part.faces():
        lo, hi = _range(f, d)
        if _side(lo, hi, eps) is None:
            straddling.append(f)
    with kernel_call("parting_line", "the kernel could not split the faces along their silhouettes"):
        res = _DR.split_at_silhouettes(part._brep, list(d.to_tuple()), tolerance, [f._f for f in straddling])
    body = _Part._wrap(res["brep"])  # keeps the split copy alive while its edges are read
    if res["failed"]:
        kinds = sorted({straddling[i].geom_type for i in res["failed"]})
        raise ModelingError(f"parting_line: the kernel could not find where {len(res['failed'])} "
                            f"{'/'.join(kinds)} face(s) turn away from the direction; try a direction a little "
                            f"off this one, or heal() an imported part first")
    # Sides of the faces of the split copy. A face split along a traced silhouette can turn
    # past 0 by a little near the line (up to about 0.02 degrees): its side is the way it
    # mostly faces.
    faces = list(body.faces())
    side: dict[Any, int] = {}
    for g in faces:
        lo, hi = _range(g, d)
        s = _side(lo, hi, eps)
        if s is None:
            if min(-lo, hi) > _STRAY:
                raise ModelingError("parting_line: a face still faces both ways after the split; heal() the part, "
                                    "or try a direction a little off this one")
            s = 1 if hi >= -lo else -1
        side[g._identity()] = s
    # Walls parallel to the direction go with the half that moves along it, unless they touch
    # only faces of the other half.
    vertical = [g for g in faces if side[g._identity()] == 0]
    seen: set[Any] = set()
    for g in vertical:
        if g._identity() in seen:
            continue
        comp, stack = [], [g]
        seen.add(g._identity())
        while stack:
            x = stack.pop()
            comp.append(x)
            for n in x.neighbors():
                if side[n._identity()] == 0 and n._identity() not in seen:
                    seen.add(n._identity())
                    stack.append(n)
        touching = {side[n._identity()] for x in comp for n in x.neighbors()} - {0}
        s = -1 if touching == {-1} else 1
        for x in comp:
            side[x._identity()] = s
    # The line: edges between the two halves.
    line = []
    for e in body.edges(seams=True):
        fs = e.faces()
        if len(fs) == 2 and side[fs[0]._identity()] != side[fs[1]._identity()]:
            line.append(e)
    wires = []
    for chain in _loops(body, line):
        curves = [Edge._from_curve(ext.edge_curve(e._e)) for e in chain]
        wires.append(Wire(curves))
    del body
    return ShapeList(sorted(wires, key=lambda w: -w.length))
