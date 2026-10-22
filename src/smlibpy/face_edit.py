"""Direct editing: faces of a part moved or offset, and the faces around them extended or trimmed
to meet them (push-pull, moving or resizing a hole or a boss, a thicker wall).

Each edited face gets a new surface: its own moved by a rigid motion, or offset along its outward
normal (planes move, cylinders, cones, spheres and tori change their radius, other surfaces become
offset surfaces of themselves). The kernel's ``SmBrep::LocalOperation`` then rebuilds the part from
them and the faces around them (src/cpp/face_edit.cpp), as it does for drafts. It takes faces that
meet an edited face tangentially only when they are edited alike, and it can close the part with
faces that do not meet: the result is checked.
"""

from __future__ import annotations

import math
import numbers
from typing import TYPE_CHECKING, Any, Sequence

from ._kernel import ModelingError, k, kernel_call
from .geometry import Location, Vector, VectorLike, _vec

if TYPE_CHECKING:  # pragma: no cover
    from .shapes import Face, Part

__all__ = ["move_faces", "offset_faces", "TANGENCY"]

_FE = k.face_edit

#: Angle (degrees) between the normals of two faces along an edge below which the faces meet
#: tangentially. A face that meets an edited face so is edited with it (``offset_faces``) or must
#: be selected too (``move_faces``).
TANGENCY = 1.0


def _where(face: Face) -> str:
    c = face.center()
    x, y, z = (round(v, 9) + 0.0 for v in (c.x, c.y, c.z))  # no -3e-15
    return f"{face.geom_type} face at ({x:.4g}, {y:.4g}, {z:.4g})"


def _selected(part: Part, faces: Any, what: str) -> list[Face]:
    from .shapes import Face, _flatten_faces

    part._require_valid(what)
    if not _flatten_faces(faces):
        raise ValueError(f"{what}: no faces selected")
    sel: list[Face] = []
    for kf in part._own_faces(faces):
        if all(kf is not f._f for f in sel):
            sel.append(Face(part, kf))
    return sel


def _rows(m: Any) -> list[float]:
    """A 4x4 matrix (column vectors) as the 16 numbers the kernel takes (row vectors)."""
    return [float(v) for v in m.T.ravel()]


def _move_matrix(by: Any) -> list[float]:
    if isinstance(by, Location):
        m = by.matrix
        r = [[float(m[i][j]) for j in range(3)] for i in range(3)]
        det = (r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0])
               + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]))
        rigid = det > 0 and all(abs(sum(r[a][i] * r[b][i] for i in range(3)) - (a == b)) <= 1e-9
                                for a in range(3) for b in range(3))
        if not rigid or not all(math.isfinite(float(v)) for v in m.ravel()):
            raise ValueError("move_faces: the location must be a rotation and a translation (no scale, no mirror)")
        return _rows(m)
    try:
        v = _vec(by)
    except (TypeError, ValueError):
        raise TypeError(f"move_faces: by must be a Location or a vector, not {type(by).__name__}") from None
    if not all(math.isfinite(c) for c in v.to_tuple()):
        raise ValueError("move_faces: the vector must be finite")
    return [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, v.x, v.y, v.z, 1.0]


def _distance(value: Any, what: str, name: str = "distance") -> float:
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        raise TypeError(f"{what}: the {name} must be a number")
    d = float(value)
    if not math.isfinite(d):
        raise ValueError(f"{what}: the {name} must be finite (got {value!r})")
    return d


def _refusal(what: str, verb: str, res: dict[str, Any], part: Part, faces: list[Face], fix: str | None) -> str:
    """The message for a face the kernel was not asked to edit, or for a kernel failure. ``fix``
    replaces the advice for faces that meet tangentially."""
    from .shapes import Face

    code = res["error"]
    i = res["face"]
    every = faces + [Face(part, f) for f in res["added"]]
    f: Face = every[i] if 0 <= i < len(every) else None  # type: ignore[assignment]  # (none for the kernel's)
    if code == "void":
        return (f"{what}: the part has a cavity (a closed void inside it), and the kernel's face edit drops "
                f"cavities; edit the part without it and cut the cavity out afterwards")
    if code == "tangent":
        g = Face(part, res["other"])
        return (f"{what}: the {_where(g)} meets the {verb} {_where(f)} tangentially, so it must be {verb} with it "
                f"(the kernel keeps tangent faces together); {fix or 'add it to the faces'}")
    if code == "conflict":
        g = Face(part, res["other"])
        return (f"{what}: the {_where(g)} meets the {_where(f)} tangentially, but they are {verb} differently; "
                f"{fix or f'faces that meet tangentially (a round and the faces it joins) must be {verb} alike'}")
    if code == "alone":
        return (f"{what}: the {_where(f)} meets no other face (a void or a body of one face); the kernel rebuilds "
                f"the faces around an edited face, and there are none: fill it and cut the new one instead")
    if code == "collapse":
        return f"{what}: the {_where(f)} would shrink to nothing (its radius reaches 0); use a smaller distance"
    if code == "offset":
        return f"{what}: the kernel could not offset the {_where(f)}"
    if code == "kernel":
        return (f"{what}: the kernel could not rebuild the part around the {verb} faces; the faces around them "
                f"may not reach them (extend or trim), or the change is too large")
    if code == "open":
        return (f"{what}: the {verb} faces do not close the part again: a face around them vanishes, or {verb} "
                f"faces run into each other; use a smaller change")
    return f"{what}: the {_where(f)} could not be prepared ({code})"


def _edit(part: Part, what: str, verb: str, faces: list[Face], matrices: Sequence[float],
          distances: Sequence[float], grow: bool, grows: bool | None, fix: str | None = None) -> Part:
    """The kernel's edit of ``faces`` and the checks of its result. ``grows``: whether the volume
    must go up (True), down (False), or either (None); ``fix``: see ``_refusal``."""
    with kernel_call(what):
        res = _FE.edit_faces(part._brep, [f._f for f in faces], list(matrices), list(distances), grow, TANGENCY)
    if res["error"] is not None:
        raise ModelingError(_refusal(what, verb, res, part, faces, fix))
    result = part._like(res["brep"])

    # The kernel may close the part with faces that do not meet: its vertices and edges then leave
    # the faces they bound (by whole millimetres, where a correct edit has 1e-6 or less).
    gap = max(res["gaps"])
    limit = max(10.0 * res["tolerance"], 10.0 * max(res["gaps_before"]))
    if not gap <= limit:
        raise ModelingError(f"{what}: the kernel returned a part whose edges leave its faces (by up to {gap:.2g}); a "
                            f"face around the {verb} ones may not reach them, or the change is too large")
    if len(result.faces()) != len(part.faces()):
        raise ModelingError(f"{what}: the {verb} faces change which faces of the part meet (a face vanishes, or "
                            f"{verb} faces run into other faces); use a smaller change, or a Boolean")
    problem = result._solid_problem()
    if problem is not None:
        raise ModelingError(f"{what}: the kernel returned a body that is {problem}; use a smaller change")
    if grows is not None:
        before, after = part._quick_volume(), result._quick_volume()
        if (before - after if grows else after - before) > 1e-4 * abs(before):
            raise ModelingError(f"{what}: the kernel returned a body whose volume went the wrong way ({before:.6g} -> "
                                f"{after:.6g}); use a smaller change")
    return result


def move_faces(part: Part, faces: Any, by: Location | VectorLike) -> Part:
    """See :meth:`Part.move_faces`."""
    m = _move_matrix(by)
    sel = _selected(part, faces, "move_faces")
    if m[:12] == [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0] and m[12:15] == [0.0, 0.0, 0.0]:
        return part._like(part._copy_brep())
    return _edit(part, "move_faces", "moved", sel, m, [], False, None)


def offset_faces(part: Part, faces: Any, distance: float) -> Part:
    """See :meth:`Part.offset_faces`."""
    d = _distance(distance, "offset_faces")
    sel = _selected(part, faces, "offset_faces")
    if d == 0:
        return part._like(part._copy_brep())
    return _edit(part, "offset_faces", "offset", sel, [], [d], True, d > 0)


def _wall_thicknesses(part: Part, walls: Any, t: float, openings: list[Any]) -> list[tuple[Face, float]]:
    """The faces of ``part`` and their own wall thickness from ``shell``'s ``walls``: (faces,
    thickness) pairs, or a dict of them. Faces given twice must have one thickness."""
    from .shapes import Face

    pairs = list(walls.items()) if isinstance(walls, dict) else list(walls)
    out: list[tuple[Face, float]] = []
    for pair in pairs:
        if not isinstance(pair, (tuple, list)) or len(pair) != 2:
            raise TypeError("shell: walls takes (faces, thickness) pairs, or a dict of faces to thicknesses")
        faces, thickness = pair
        w = abs(_distance(thickness, "shell", "thickness of a wall"))
        if not w > 0:
            raise ValueError("shell: a wall's thickness must not be zero")
        for kf in part._own_faces(faces):
            f = Face(part, kf)
            if any(kf is o for o in openings):
                raise ValueError(f"shell: the {_where(f)} is an opening; it has no wall")
            for g, v in out:
                if g._f is kf and v != w:
                    raise ValueError(f"shell: the {_where(f)} is given two wall thicknesses ({v:g} and {w:g})")
            if all(g._f is not kf for g, _ in out):
                out.append((f, w))
    return out


def _points_and_normals(f: Face) -> list[tuple[Vector, Vector]]:
    """Points on a face with its outward normal there: the middle of its parameters and a 3 x 3
    grid of them where they lie inside it, then its interior point."""
    out: list[tuple[Vector, Vector]] = []
    try:
        (u0, v0), (u1, v1) = f._f.uv_domain()
        grid = [(a, b) for a in (0.25, 0.5, 0.75) for b in (0.25, 0.5, 0.75) if (a, b) != (0.5, 0.5)]
        for a, b in [(0.5, 0.5)] + grid:
            u, v = u0 + a * (u1 - u0), v0 + b * (v1 - v0)
            if f._f.classify_uv(u, v) == "inside":
                out.append((Vector(f._f.point_at_uv(u, v)), Vector(f._f.outward_normal_at_uv(u, v)).normalized()))
    except (RuntimeError, ValueError):  # a face the kernel cannot sample: its interior point only
        pass
    p = f.interior_point()
    out.append((p, f.normal_at(p)))
    return out


def _across(body: Part, f: Face, reach: float, facing: float) -> Face:
    """The face of ``body`` across a wall from the face ``f`` of the part: through the points of ``f``
    moved by ``reach`` along its outward normal ``n``, with the outward normal ``facing * n`` there."""
    tol = 1e-6 * max(body._extent(), 1.0)
    found: list[Face] = []
    for p, n in _points_and_normals(f):
        q = p + n * reach
        found = [g for g in body.faces() if g.distance_to(q) <= tol and g.normal_at(q).dot(n) * facing > 1 - 1e-6]
        if len(found) == 1:
            return found[0]
    raise ModelingError(f"shell: the wall of the {_where(f)} has no face of its own across it in the shelled part "
                        f"(its faces there were merged or trimmed away); give it the common thickness")


def shell_walls(part: Part, shelled: Part, walls: list[tuple[Face, float]], t: float, outward: bool,
                closed: bool) -> Part:
    """``shelled`` (``part`` shelled with walls of ``t``) with the wall of each face of ``walls`` made
    as thick as given: the shell's face across the wall from it (the cavity's for walls grown inward,
    the outside's for walls grown outward) offset by the difference. A ``closed`` shell has a cavity,
    which the kernel's face edit drops: there the part offset by ``t`` the way the shell went (the
    cavity, or for walls grown outward the outside) is edited, and the shell is the Boolean
    difference of the part and it."""
    corners = shelled.info().get("corners", "round")
    body = (part.offset(t if outward else -t, corners=corners)) if closed else shelled
    # (the face across the wall faces the other way in a shell with walls grown inward; the cavity as
    # a body of its own faces the way the part does)
    facing = 1.0 if outward or closed else -1.0
    sign = -1.0 if closed and not outward else 1.0  # (a thicker wall shrinks the cavity as a body)
    faces: list[Face] = []
    distances: list[float] = []
    for f, w in walls:
        if w == t:
            continue
        g = _across(body, f, t if outward else -t, facing)
        if any(h._f is g._f for h in faces):
            continue
        faces.append(g)
        distances.append(sign * (w - t))
    if not faces:
        return shelled
    grows = True if all(d > 0 for d in distances) else False if all(d < 0 for d in distances) else None
    fix = ("walls that meet smoothly need one thickness: give the faces of the part that run into this wall "
           "tangentially (rounds) the same thickness, or use corners=\"sharp\" where the shell rounds its corners")
    edited = _edit(body, "shell", "offset", faces, [], distances, False, grows, fix)
    if not closed:
        return edited
    with kernel_call("shell", "the cavity could not be cut out of the part"):
        result = edited - part if outward else part - edited
    whole, cut = part._props(1e-6)["volume"], edited._props(1e-6)["volume"]
    expect, got = abs(float(cut) - float(whole)), float(result._props(1e-6)["volume"])
    if not abs(got - expect) <= 1e-5 * max(float(whole), float(cut)):
        raise ModelingError(f"shell: the walls of their own thickness came out as a body of volume {got:.10g}, "
                            f"where the part and its offset differ by {expect:.10g}")
    return result
