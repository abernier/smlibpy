"""Draft analysis, parting lines and face drafts, for parts that are molded or cast.

A mold half moves away from the part along the pull direction ``d``. A face releases from it
when it turns towards ``d``. The draft angle of a face at a point is the angle between the face
and ``d``: ``asin(n . d)`` for the outward normal ``n``, in degrees. It is +90 where the face
looks along ``d``, 0 on a wall parallel to ``d``, and negative where the face turns away from
``d`` (an undercut for that mold half).

The kernel provides the silhouettes of a surface for a direction (where ``n . d = 0``) and puts
curves into faces as edges; the parting line comes from a copy of the part split along them.

A face draft turns faces by an angle about the lines where they meet a neutral plane, whose
normal is the pull direction. The kernel's ``SmBrep::LocalOperation`` rebuilds the part from
the new surfaces of the drafted faces and the extended surfaces of the faces around them
(src/cpp/face_draft.cpp); the result is checked, because the kernel can return a closed body
whose edges leave its faces.
"""

from __future__ import annotations

import math
import numbers
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Iterator

from ._kernel import ModelingError, ext, k, kernel_call
from .geometry import Axis, Plane, Vector, VectorLike, _direction

if TYPE_CHECKING:  # pragma: no cover
    from .shapes import Face, Part, ShapeList, Wire

__all__ = ["DraftAnalysis", "FaceDraft", "draft_analysis", "parting_line", "draft_faces", "ANGLE_TOLERANCE",
           "TANGENCY"]

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
    from .shapes import Edge, ShapeList, Wire

    d = _direction(direction, "parting_line")
    part._require_valid("parting_line")
    body, line = _contour(part, d, "parting_line")
    wires = []
    for chain in _loops(body, line):
        curves = [Edge._from_curve(ext.edge_curve(e._e)) for e in chain]
        wires.append(Wire(curves))
    del body
    return ShapeList(sorted(wires, key=lambda w: -w.length))


def _joined_arcs(edges: list[Any], tol: float) -> list[Any]:
    """The edges, with the arcs of one circle that meet end to end joined into one arc (a full
    circle where they go round): the pieces a contour is split into where it crosses edges or
    seams of the faces (a sphere's rim at its seam)."""
    from .curves import CenterArc

    groups: list[tuple[Vector, float, Vector, list[Any]]] = []
    out = []
    for e in edges:
        if e.geom_type != "circle":
            out.append(e)
            continue
        c, r, n = e.arc_center, e.radius, e.normal
        for gc, gr, gn, members in groups:
            if (gc - c).length <= tol and abs(gr - r) <= tol and gn.cross(n).length <= 1e-9:
                members.append(e)
                break
        else:
            groups.append((c, r, n, [e]))
    for c, r, n, members in groups:
        if len(members) == 1:
            out.append(members[0])
            continue
        x = (members[0].start - c).normalized()
        plane = Plane(c, x_dir=x, z_dir=n)

        def angle(p: Vector) -> float:
            q = plane.to_local(p)
            return math.degrees(math.atan2(q.y, q.x)) % 360.0

        spans = []  # counterclockwise about n: (start, size)
        for e in members:
            a0, am, a1 = angle(e.start), angle(e.point_at(0.5)), angle(e.end)
            if e.is_closed:
                spans.append((0.0, 360.0))
                continue
            ccw = (am - a0) % 360.0 < (a1 - a0) % 360.0 or (a1 - a0) % 360.0 == 0
            spans.append((a0, (a1 - a0) % 360.0) if ccw else (a1, (a0 - a1) % 360.0))
        eps = math.degrees(tol / r)
        merged: list[list[float]] = []
        for a, size in sorted(spans):
            if merged and a <= merged[-1][0] + merged[-1][1] + eps:
                merged[-1][1] = max(merged[-1][1], a + size - merged[-1][0])
            else:
                merged.append([a, size])
        if len(merged) > 1 and merged[-1][0] + merged[-1][1] >= merged[0][0] + 360.0 - eps:
            first = merged.pop(0)  # (across angle 0)
            merged[-1][1] = first[0] + 360.0 + first[1] - merged[-1][0]
        if len(merged) == len(members):
            out.extend(members)
            continue
        for a, size in merged:
            out.append(CenterArc((0, 0), r, 0.0 if size >= 360.0 - eps else a, min(size, 360.0), plane))
    return out


def _contour(part: Any, d: Vector, what: str) -> tuple[Any, list[Any]]:
    """A copy of the body (a part, a sheet or a sketch) split along its silhouettes for the unit
    direction ``d``, and its edges between the half that faces along ``d`` and the half that
    faces away (faces parallel to ``d`` go with the half that faces along it, unless they touch
    only faces of the other half). The copy holds the edges: keep it while they are used."""
    try:
        return _split_halves(part, d, d, what)
    except ModelingError:
        # The kernel traces the silhouettes of a face differently for -d (the same curves): a torus
        # split for -X kept a face that faces both ways, split for +X it splits cleanly.
        try:
            return _split_halves(part, d, -d, what)
        except ModelingError:
            pass
        raise


def _split_halves(part: Any, d: Vector, split: Vector, what: str) -> tuple[Any, list[Any]]:
    """:func:`_contour` with the faces split along the silhouettes traced for ``split`` (``d`` or
    ``-d``)."""
    from .shapes import Part, Shell

    size = max(part.bbox().diagonal, 1e-9)
    tolerance = 1e-6 * size  # fit tolerance of traced silhouettes
    eps = _SIGN
    straddling = []
    for f in part.faces():
        lo, hi = _range(f, d)
        if _side(lo, hi, eps) is None:
            straddling.append(f)
    with kernel_call(what, "the kernel could not split the faces along their silhouettes"):
        res = _DR.split_at_silhouettes(part._brep, list(split.to_tuple()), tolerance, [f._f for f in straddling])
    body = (Part if isinstance(part, Part) else Shell)._wrap(res["brep"])  # keeps the split copy alive
    if res["failed"]:
        kinds = sorted({straddling[i].geom_type for i in res["failed"]})
        raise ModelingError(f"{what}: the kernel could not find where {len(res['failed'])} "
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
                raise ModelingError(f"{what}: a face still faces both ways after the split; heal() the part, "
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
    return body, line


# =============================================================================
# Face drafts
# =============================================================================
_FD = k.face_draft

#: Angle (degrees) between the normals of two faces along an edge below which the faces meet
#: tangentially. A face that meets a drafted face so must be drafted with it.
TANGENCY = 1.0

_STEEPEST = 89.0  # degrees of draft a face may have after the draft (the kernel's limit is 90)


def _draft_angle(angle: float) -> float:
    if isinstance(angle, bool) or not isinstance(angle, numbers.Real):
        raise TypeError("draft: the angle must be a number of degrees")
    a = float(angle)
    if not (math.isfinite(a) and abs(a) < 90.0):
        raise ValueError(f"draft: the angle must be between -90 and 90 degrees (got {angle!r})")
    if a == 0:
        raise ValueError("draft: the angle is 0; nothing to do")
    return a


def _neutral(neutral_plane: Any) -> Plane:
    from .shapes import _as_plane

    try:
        return _as_plane(neutral_plane)
    except ValueError as e:  # a face that is not flat
        raise ValueError(f"draft: the neutral plane must be a Plane or a planar face; {e}") from None


def _where(face: Face) -> str:
    c = face.center()
    x, y, z = (round(v, 9) + 0.0 for v in (c.x, c.y, c.z))  # no -3e-15
    return f"{face.geom_type} face at ({x:.4g}, {y:.4g}, {z:.4g})"


def _draftable(face: Face, plane: Plane) -> bool:
    """Whether a face is of a kind the draft turns: a plane that is not parallel to the neutral
    plane, or a cylinder or cone whose axis runs along its normal."""
    if face.is_planar:
        return face.normal_at().cross(plane.z_dir).length > 1e-6
    if face.geom_type in ("cylinder", "cone"):
        return face.axis.direction.normalized().cross(plane.z_dir).length <= 1e-6
    return False


def _refusal(res: dict[str, Any], part: Part, faces: list[Face], angle: float, plane: Plane) -> str:
    """The message for a face the kernel was not asked to draft, or for a kernel failure."""
    from .shapes import Face

    code = res["error"]
    f = faces[res["face"]] if res["face"] >= 0 else None
    if code == "tangent":
        g = Face(part, res["other"])
        fix = ("; add it to the faces" if _draftable(g, plane) else
               f", but a {g.geom_type} face cannot be drafted about this plane; draft before rounding or blending "
               f"there, and round afterwards")
        return f"draft: the {_where(g)} meets the drafted {_where(f)} tangentially, so it must be drafted with it{fix}"
    if code == "in_plane":
        return f"draft: the {_where(f)} lies in the neutral plane; there is no line in it to turn it about"
    if code == "parallel":
        return (f"draft: the {_where(f)} is parallel to the neutral plane; only faces that cross the plane's normal "
                f"at an angle can be drafted (walls, not tops or floors)")
    if code == "axis":
        tilt = math.degrees(math.acos(min(1.0, abs(f.axis.direction.normalized().dot(plane.z_dir)))))
        return (f"draft: the axis of the {_where(f)} is {tilt:.4g} degrees off the normal of the neutral plane; a "
                f"cylinder or cone can be drafted only when its axis runs along that normal")
    if code == "unsupported":
        return (f"draft: the {_where(f)} cannot be drafted; draft turns planes, and cylinders and cones whose axis "
                f"runs along the normal of the neutral plane")
    if code == "apex":
        return f"draft: the {_where(f)} is part of a cone that ends in its tip before the neutral plane or on the face"
    if code == "tip":
        return f"draft: at {angle:g} degrees the {_where(f)} would narrow to a point; use a smaller angle"
    if code == "too_steep":
        total = math.degrees(res["before"][-1]) + angle
        return (f"draft: at {angle:g} degrees the {_where(f)} would have {total:.4g} degrees of draft and lie almost "
                f"flat; a face can have up to {_STEEPEST:g} degrees")
    if code == "kernel":
        return ("draft: the kernel could not rebuild the part around the drafted faces; the angle may be too large "
                "for the faces around them")
    if code == "open":
        return ("draft: the drafted faces do not close the part again: at this angle a face around them vanishes, or "
                "drafted faces run into each other; use a smaller angle")
    return f"draft: the {_where(f)} could not be prepared for the draft ({code})"


def draft_faces(part: Part, faces: Any, angle: float, neutral_plane: Plane | Face) -> Part:
    """See :meth:`Part.draft`."""
    from .shapes import Face, _flatten_faces

    a = _draft_angle(angle)
    plane = _neutral(neutral_plane)
    part._require_valid("draft")
    if not _flatten_faces(faces):
        raise ValueError("draft: no faces selected")
    sel: list[Face] = []
    for kf in part._own_faces(faces):
        if all(kf is not f._f for f in sel):
            sel.append(Face(part, kf))
    from .face_edit import _with_cavities

    # (a part with cavities: the solid inside its outside and those inside its cavities' walls, each drafted on
    # its own, the cavities' faces the other way round, since they face the other way; see face_edit)
    return _with_cavities(part, "draft", "drafted", sel,
                          lambda body, faces, inside: _drafted(body, faces, -a if inside else a, plane))


def _drafted(part: Part, sel: list[Face], a: float, plane: Plane) -> Part:
    """The kernel's draft of the faces ``sel`` of a part without cavities, checked (see :func:`draft_faces`)."""
    d = plane.z_dir.normalized()
    with kernel_call("draft"):
        res = _FD.draft_faces(part._brep, [f._f for f in sel], list(plane.origin.to_tuple()), list(d.to_tuple()),
                              math.radians(a), TANGENCY)
    if res["error"] is not None:
        raise ModelingError(_refusal(res, part, sel, a, plane))
    result = part._like(res["brep"])

    # The kernel may close the part with faces that do not meet: its vertices and edges then
    # leave the faces they bound (by whole millimetres, where a correct draft has 1e-6 or less).
    gap = max(res["gaps"])
    limit = max(10.0 * res["tolerance"], 10.0 * max(res["gaps_before"]))
    if not gap <= limit:
        raise ModelingError(f"draft: the kernel returned a part whose edges leave its faces (by up to {gap:.2g}); a "
                            f"face that meets a drafted face may have to be drafted too, or the angle is too large")
    if len(result.faces()) != len(part.faces()):
        raise ModelingError("draft: at this angle the drafted faces change which faces of the part meet (a face "
                            "vanishes or a drafted face runs into another one); use a smaller angle")
    problem = result._solid_problem()
    if problem is not None:
        raise ModelingError(f"draft: the kernel returned a body that is {problem}; use a smaller angle")
    # Each drafted face moves into the material on the side of the neutral plane the normal
    # points to (for a positive angle) and out of it on the other side. (A quick volume, so only
    # a change beyond its error counts.)
    sides = {_side_of(f, plane) for f in sel}
    if len(sides) == 1 and 0 not in sides:
        before, after = part._quick_volume(), result._quick_volume()
        shrinks = sides.pop() * a > 0
        if (after - before if shrinks else before - after) > 1e-4 * abs(before):
            raise ModelingError(f"draft: the kernel returned a body whose volume went the wrong way ({before:.6g} -> "
                                f"{after:.6g}); use a smaller angle")
    return result


def _side_of(face: Face, plane: Plane) -> int:
    """+1 if the face lies on the side of the plane its normal points to, -1 on the other, 0 if
    it crosses the plane (judged by the corners of its bounding box)."""
    bb = face.bbox()
    heights = [plane.z_dir.dot(Vector(x, y, z) - plane.origin) for x in (bb.min.x, bb.max.x)
               for y in (bb.min.y, bb.max.y) for z in (bb.min.z, bb.max.z)]
    tol = 1e-9 * max(1.0, bb.diagonal)
    if min(heights) >= -tol:
        return 1
    if max(heights) <= tol:
        return -1
    return 0
