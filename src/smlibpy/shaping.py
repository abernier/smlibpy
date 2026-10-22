"""Local edits of a face: push a point of it, warp or flatten a region of it.

``Part.push``, ``Part.warp``, ``Part.flatten`` and the same methods of ``Shell`` call these. The face's
surface gets a change added to it, exactly: a B-spline that is zero away from the edit, so the face's
edges stay where they are (the edit is refused where it would move one). The change comes from NLib's
shaping routines; see ``src/cpp/shape_edit.cpp``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ._kernel import ModelingError, ext, kernel_call
from .geometry import Vector, VectorLike, _vec

if TYPE_CHECKING:
    from .geometry import Plane
    from .shapes import Face, _Body

_PUSH_CONTINUITY = {"g0": 0, "g1": 1, "g2": 2}
_REGION_CONTINUITY = {"crease": 0, "g1": 1, "g2": 2}


def _level(continuity: Any, table: dict[str, int], what: str) -> int:
    level = table.get(continuity.lower()) if isinstance(continuity, str) else None
    if level is None:
        names = ", ".join(f'"{n.upper() if n != "crease" else n}"' for n in table)
        raise ValueError(f"{what}: continuity is one of {names}, got {continuity!r}")
    return level


def _own_face(body: _Body, face: Any, what: str) -> Face:
    """The body's face for ``face``: itself, or the face of the body in its place (a face of an earlier
    version of the body, matched by an interior point and the area)."""
    from .shapes import Face

    if not isinstance(face, Face):
        raise TypeError(f"{what}: face must be a Face, got {type(face).__name__}")
    if face._owner is not None and getattr(face._owner, "_h", None) is body._h:
        return face
    tol = 1e-6 * max(1.0, body.bbox().diagonal)
    p = face.interior_point()
    area = face.area
    for g in body.faces():
        if g.distance_to(p) <= tol and abs(g.area - area) <= 1e-6 * max(1.0, area):
            return g
    kind = "part" if type(body).__name__ == "Part" else "shell"
    raise ValueError(f"{what}: {face!r} is not a face of this {kind}")


def _on_face(face: Face, point: VectorLike) -> Vector:
    """The point of the face nearest to ``point``."""
    q, _ = face._f.closest_point(_vec(point).to_tuple())
    return Vector(q)


def push(body: _Body, face: Any, at: VectorLike, by: float | VectorLike | None, to: VectorLike | None,
         normal: VectorLike | None, radius: float | None, continuity: str) -> Any:
    """The Brep of ``body.push(...)`` (see :meth:`Part.push`)."""
    what = "push"
    f = _own_face(body, face, what)
    level = _level(continuity, _PUSH_CONTINUITY, what)
    q = _on_face(f, at)
    if by is not None and to is not None:
        raise ValueError("push: give the move as by= or as to=, not both")
    if to is not None:
        move = _vec(to) - q
    elif by is None:
        if normal is None:
            raise ValueError("push: give the move: by= (a distance along the face's normal, or a vector) or to= (a "
                             "point)")
        move = Vector(0, 0, 0)
    elif isinstance(by, (int, float)):
        move = f.normal_at(q) * float(by)
    else:
        move = _vec(by)
    n: tuple[float, ...] = ()
    if normal is not None:
        nv = _vec(normal)
        if nv.length == 0:
            raise ValueError("push: the normal must not be zero")
        if not nv.dot(f.normal_at(q)) > 1e-9 * nv.length:
            raise ValueError("push: the normal must point to the side the face's normal points to (it tilts by less "
                             "than 90 degrees)")
        n = nv.to_tuple()
    size = max(1.0, f.bbox().diagonal)
    if radius is None:
        # as far as the nearest edge of the face; smaller where the change would still move one
        r = min(e.distance_to(q) for e in f.edges(seams=True))
        if not r > 1e-9 * size:
            raise ValueError("push: the point lies on an edge of the face, which stays where it is: push a point "
                             "inside the face")
        shrink = True
    else:
        r = float(radius)
        if not r > 0:
            raise ValueError(f"push: the radius must be positive, got {radius}")
        shrink = False
    with kernel_call(what):
        return ext.push_face(body._brep, f._f, q.to_tuple(), move.to_tuple(), list(n), r, level, shrink)


def _region_points(region: Any, what: str) -> list[float]:
    """The region as points of a closed polygon, x, y, z, x, y, z, ...: a closed wire, a face's or a
    sketch's outline, or points."""
    from .shapes import Edge, Face, Sketch, Wire

    if isinstance(region, Sketch):
        faces = region.faces()
        if len(faces) != 1:
            raise ValueError(f"{what}: the region sketch has {len(faces)} regions; give one")
        region = faces[0].outer_wire()
    elif isinstance(region, Face):
        region = region.outer_wire()
    elif isinstance(region, Edge):
        region = Wire([region])
    if isinstance(region, Wire):
        if not region.is_closed:
            raise ValueError(f"{what}: the region's wire is not closed")
        pts: list[Vector] = []
        for e in region.edges():
            n = 1 if e.geom_type == "line" else 32
            pts.extend(e.point_at(i / n) for i in range(n))
    else:
        try:
            pts = [_vec(p) for p in region]
        except TypeError:
            raise TypeError(f"{what}: the region is a closed Wire, a Face or a Sketch on the face, or a list of "
                            f"points, got {type(region).__name__}") from None
    if len(pts) < 3:
        raise ValueError(f"{what}: the region needs three points or more")
    return [c for p in pts for c in p.to_tuple()]


def warp(body: _Body, face: Any, region: Any, by: float | VectorLike, continuity: str) -> Any:
    """The Brep of ``body.warp(...)`` (see :meth:`Part.warp`)."""
    what = "warp"
    f = _own_face(body, face, what)
    level = _level(continuity, _REGION_CONTINUITY, what)
    pts = _region_points(region, what)
    if isinstance(by, (int, float)):
        c = Vector(sum(pts[0::3]), sum(pts[1::3]), sum(pts[2::3])) / (len(pts) // 3)
        move = f.normal_at(_on_face(f, c)) * float(by)
    else:
        move = _vec(by)
    with kernel_call(what):
        return ext.warp_face(body._brep, f._f, pts, move.to_tuple(), level)


def flatten(body: _Body, face: Any, region: Any, plane: Plane | Face, continuity: str) -> Any:
    """The Brep of ``body.flatten(...)`` (see :meth:`Part.flatten`)."""
    from .shapes import _as_plane

    what = "flatten"
    f = _own_face(body, face, what)
    level = _level(continuity, _REGION_CONTINUITY, what)
    pts = _region_points(region, what)
    pl = _as_plane(plane)
    with kernel_call(what):
        return ext.flatten_face(body._brep, f._f, pts, pl.origin.to_tuple(), pl.z_dir.to_tuple(), level)


def checked(body: _Body, brep: Any, what: str) -> Any:
    """The result of an edit as a body like ``body``: a Part must still be a sound solid; a sketch
    becomes a shell (an edited face no longer lies in its plane)."""
    from .shapes import Part, Shell, Sketch

    if isinstance(body, Part):
        out = body._like(brep)
        problem = out._solid_problem()
        if problem is not None:
            raise ModelingError(f"{what}: the kernel returned a body that is {problem}")
        return out
    if isinstance(body, Sketch):
        return Shell._wrap(brep, name=body.name, color=body.color)
    return body._like(brep)


__all__: list[str] = []
