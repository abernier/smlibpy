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

import json
import math
import os
import shutil
import tempfile
import time
import warnings
from typing import TYPE_CHECKING, Any, Callable, Iterable, TypeVar

from ._kernel import KernelError, ModelingError, ext, k, kernel_call

if TYPE_CHECKING:  # pragma: no cover
    from .shapes import Face, Part, ShapeList

__all__ = ["fillet_faces", "remove_fillets", "remove_faces"]

#: Angle (degrees) between the normals of two faces along an edge below which the faces meet
#: tangentially: the edge is a rail of a fillet.
TANGENCY = 2.0

#: Seconds the kernel may take for one step. On Linux and macOS the kernel first does the work
#: in a forked copy of the process: if it crashes there or takes longer than this, a
#: ``ModelingError`` says so and this process is left alone (SMLib's patching and Boolean code
#: can crash or loop on some parts). The steps of defeaturing and ``surface_fillet`` then run
#: again here; those of ``shell``, ``offset`` and ``thicken`` run only there, and their result
#: comes back as an exact copy. ``0`` runs the kernel directly, as on Windows.
GUARD_SECONDS = 20.0

_D = k.defeature
R = TypeVar("R")
_VOLUMES: dict[int, tuple[Any, float]] = {}  # id of a body's handle -> (handle, volume)


class _KernelFault(ModelingError):
    """The kernel crashed or did not finish in the forked copy; ``reason`` says which."""

    def __init__(self, what: str, reason: str, hint: str):
        self.reason = reason
        super().__init__(f"{what}: {reason}; {hint}")


def _guarded(what: str, work: Callable[[], R]) -> R:
    """``work()``, after a forked copy of the process has run it to the end (see GUARD_SECONDS).
    The kernel is deterministic, and the copy starts from the same memory, so it does what
    this process will do; not always where the kernel reads memory it has freed, since the two
    processes reuse freed memory differently (ai/todo/features.md, 37)."""
    limit = float(GUARD_SECONDS)
    if not limit > 0 or not hasattr(os, "fork"):
        return work()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)  # forking a process with threads
        pid = os.fork()
    if pid == 0:  # pragma: no cover - the child
        code = 0
        try:
            work()
        except BaseException:  # the parent raises it again when it does the work
            code = 3
        os._exit(code)
    _wait(what, pid, limit)
    return work()


def _wait(what: str, pid: int, limit: float) -> int:
    """The exit code of the forked copy ``pid``; a _KernelFault if it crashed or did not finish
    within ``limit`` seconds (it is stopped then)."""
    deadline = time.monotonic() + limit
    pause = 0.001
    while True:
        try:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                break
            if time.monotonic() > deadline:
                raise _KernelFault(what, f"the kernel did not finish within {limit:g} s",
                                   "smlibpy.defeature.GUARD_SECONDS sets the limit")
            time.sleep(pause)
        except BaseException:  # (also Ctrl-C, which stops the copy)
            os.kill(pid, 9)
            os.waitpid(pid, 0)
            raise
        pause = min(pause * 2, 0.05)
    if os.WIFSIGNALED(status):
        raise _KernelFault(what, f"the kernel crashed (signal {os.WTERMSIG(status)}, in a copy of this process)",
                           "this process is fine")
    return os.WEXITSTATUS(status)


def _isolated(what: str, work: Callable[[], Any]) -> Any:
    """The body (a kernel Brep) ``work()`` makes, made in a forked copy of the process and read
    back from an exact copy (a binary .smb file); see GUARD_SECONDS. This process never runs the
    step: one that crashes the kernel or does not finish there is a _KernelFault, and the error
    ``work()`` raises there is raised here. For the kernel's offset code (its extended mode above
    all), which reads memory it has freed in ways that depend on where things lie in memory, so
    that running it again here could crash where the copy came through. Without fork (Windows),
    or with GUARD_SECONDS = 0, ``work()`` runs here."""
    limit = float(GUARD_SECONDS)
    if not limit > 0 or not hasattr(os, "fork"):
        return work()
    folder = tempfile.mkdtemp(prefix="smlibpy-")
    body, error = os.path.join(folder, "body.smb"), os.path.join(folder, "error.json")
    tags = os.path.join(folder, "tags.json")  # (the tags of its faces and edges: .smb files hold none)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)  # forking a process with threads
            pid = os.fork()
        if pid == 0:  # pragma: no cover - the child
            code = 0
            try:
                b = work()
                if b is None:
                    raise KernelError(what, "the kernel returned no body")
                with open(tags, "w") as f:
                    json.dump(ext.topology_tags(b), f)
                b.write_to_file(body, False)
            except BaseException as e:
                code = 3
                if isinstance(e, KernelError):
                    sent: dict[str, Any] = {"kernel": [e.operation, e.detail, e.status, e.hint]}
                else:
                    sent = {"type": type(e).__name__, "text": str(e), "modeling": isinstance(e, ModelingError),
                            "runtime": isinstance(e, RuntimeError)}
                try:
                    with open(error, "w") as f:
                        json.dump(sent, f)
                except BaseException:
                    pass
            os._exit(code)
        if _wait(what, pid, limit) == 0 and os.path.exists(body):
            with kernel_call(what):
                made = k.read_brep_from_file(body, None, False)
            try:
                with open(tags) as f:
                    ext.set_topology_tags(made, *json.load(f))
            except (OSError, ValueError, TypeError):
                pass  # (its faces and edges then count as new)
            return made
        try:
            with open(error) as f:
                sent = json.load(f)
        except (OSError, ValueError):
            raise ModelingError(f"{what}: the kernel step failed in a copy of this process") from None
        if "kernel" in sent:
            raise KernelError(*sent["kernel"])
        if sent["modeling"]:
            raise ModelingError(sent["text"])
        if sent["runtime"]:  # a kernel error, as the bindings raise it
            with kernel_call(what):
                raise RuntimeError(sent["text"])
        raise ModelingError(f"{what}: {sent['type']} in a copy of this process: {sent['text']}")
    finally:
        shutil.rmtree(folder, ignore_errors=True)


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
    """The volume, integrated precisely once per body (a body does not change)."""
    hit = _VOLUMES.get(id(part._h))
    if hit is not None and hit[0] is part._h:
        return hit[1]
    v = float(part._props(accuracy=1e-9)["volume"])
    if len(_VOLUMES) > 64:
        _VOLUMES.clear()
    _VOLUMES[id(part._h)] = (part._h, v)
    return v


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


def _executive(what: str, body: Part, groups: list[list[Face]], rebuild: str) -> tuple[Part | None, bool]:
    """The executive's patched copy of ``body`` without ``groups`` (None if it failed), and
    whether the kernel crashed or hung."""
    try:
        res = _guarded(what, lambda: _D.defeature(body._brep, [[f._f for f in g] for g in groups], rebuild))
    except _KernelFault:
        return None, True
    return (None if res["brep"] is None else body._like(res["brep"])), False


def _remove_pass(part: Part, faces: list[Face], origin: dict[Any, Face], b: _Blends, expect: int,
                 faulted: set[frozenset[Any]]) -> tuple[Part, list[Face]]:
    """Take a set of fillet faces of ``part`` out, as far as the kernel can; every step is
    checked. ``origin`` maps the faces to the faces of the part the user gave; sets of those on
    which the kernel crashed or hung (``faulted``) are not tried again. Returns the body and the
    original faces that stayed."""
    body = part
    pending = list(faces)  # faces of `body`
    origin = {f._identity(): origin.get(f._identity(), f) for f in faces}
    tried_a: set[frozenset[Any]] = set()  # face sets tried with the fillet removal
    tried_b: set[frozenset[Any]] = set()  # groups tried with the executive

    def key(fs: list[Face]) -> frozenset[Any]:
        return frozenset(origin[f._identity()]._identity() for f in fs if f._identity() in origin)

    def radius(g: list[Face]) -> float:
        return min((r for r in (b.radius(f) for f in g) if math.isfinite(r)), default=math.inf)

    progress = True
    while pending and progress:
        progress = False
        # 1. Fillets with sharp ends, one by one (the kernel's fillet removal).
        edge = [f for f in pending if b.is_edge_fillet(f)]
        if edge and key(edge) not in tried_a and key(edge) not in faulted:
            tried_a.add(key(edge))
            try:
                res = _guarded("remove_fillets", lambda: _D.remove_fillet_faces(body._brep, [f._f for f in edge]))
            except _KernelFault:
                faulted.add(key(edge))
                res = {"brep": None}
            if res["brep"] is not None:
                gone = [f for f, done in zip(edge, res["removed"]) if done]
                candidate = body._like(res["brep"])
                if _problem(_volume(body), candidate, expect, _fillet_bound(b, gone)) is None:
                    rest = [f for f in pending if f not in gone]
                    pending, origin, body = _carry(candidate, rest, origin)
                    progress = True
        # 2. Connected sets (with their corner patches, around bosses and holes): the
        #    executive, smallest radius first.
        for group in sorted(_groups(pending), key=radius):
            if key(group) in tried_b or key(group) in faulted:
                continue
            tried_b.add(key(group))
            candidate, fault = _executive("remove_fillets", body, [group], "extend")
            if fault:
                faulted.add(key(group))
            if candidate is None or _problem(_volume(body), candidate, expect, _fillet_bound(b, group)) is not None:
                continue
            rest = [f for f in pending if f not in group]
            pending, origin, body = _carry(candidate, rest, origin)
            progress = True
            break  # group again on the new body
    return body, [origin[f._identity()] for f in pending if f._identity() in origin]


def _carry(new: Part, faces: list[Face], origin: dict[Any, Face]) -> tuple[list[Face], dict[Any, Face], Part]:
    """``faces`` (of an earlier version of ``new``) as faces of ``new``, with their faces of the
    original part."""
    moved: list[Face] = []
    mapping: dict[Any, Face] = {}
    for f in faces:
        for g in _match(new, [f]):
            if g not in moved:
                moved.append(g)
                mapping[g._identity()] = origin.get(f._identity(), f)
    return moved, mapping, new


def remove_fillets(part: Part, faces: Any = None, *, max_radius: float | None = None, partial: bool = False) -> Part:
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
    groups = _groups(sel)
    # Concave fillets first, then convex ones, then sets that mix both; one kind can make room
    # for the other, so the round repeats while it takes fillets out.
    left = {
        -1: [f for g in groups if not any(b.convex(f) for f in g) for f in g],
        1: [f for g in groups if all(b.convex(f) for f in g) for f in g],
    }
    left[0] = [f for f in sel if f not in left[-1] and f not in left[1]]
    body = part
    faulted: set[frozenset[Any]] = set()  # sets of the user's faces the kernel crashed or hung on
    progress = True
    while progress:
        progress = False
        for expect in (-1, 1, 0):
            if not left[expect]:
                continue
            todo, origin, _ = _carry(body, left[expect], {}) if body is not part else (left[expect], {}, body)
            if not todo:
                continue
            body, stays = _remove_pass(body, todo, origin, b, expect, faulted)
            if len(stays) < len(left[expect]):
                progress = True
            left[expect] = stays
    stayed = left[-1] + left[1] + left[0]
    if stayed and not partial:
        where = ", ".join(f"({c.x:.4g}, {c.y:.4g}, {c.z:.4g})" for c in [f.center() for f in stayed][:4])
        more = f" and {len(stayed) - 4} more" if len(stayed) > 4 else ""
        raise ModelingError(f"remove_fillets: the kernel could not take out {len(stayed)} of the {len(sel)} fillet "
                            f"faces (at {where}{more}); remove_fillets(..., partial=True) keeps them and takes out "
                            f"the others, or take out the fillets around them first")
    return body


def _complete(faces: list[Face]) -> list[Face]:
    """The selection with the faces it encloses: a face all of whose neighbours are selected
    (the floor of a blind hole, the top of a boss) goes with them. Not a face that the selection
    only rounds off: one that meets all its neighbours tangentially where the selection, too,
    meets the faces around it tangentially (the top of a box whose top edges are rounded, with
    those rounds selected). Such a face is the part, not a feature's floor; a pocket's floor
    inside its rounds goes with the pocket's walls, whose rim is sharp."""
    out = list(faces)
    changed = True
    while changed:
        changed = False
        ids = {f._identity() for f in out}
        enclosed = []
        for f in list(out):
            for g in f.neighbors():
                if g._identity() in ids or any(g == x for x in enclosed):
                    continue
                if all(n._identity() in ids for n in g.neighbors()):
                    enclosed.append(g)
        inside = ids | {g._identity() for g in enclosed}
        rim_sharp = any(_sharp(e) for f in out for e in f.edges()
                        if any(x._identity() not in inside for x in e.faces()))
        for g in enclosed:
            if rim_sharp or any(_sharp(e) for e in g.edges()):
                out.append(g)
                ids.add(g._identity())
                changed = True
    return out


def _sharp(e: Any) -> bool:
    """Whether an edge between two faces is a corner (its faces do not meet tangentially)."""
    fs = e.faces()
    return len(fs) == 2 and fs[0] != fs[1] and e.convexity != "smooth"


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


def _close(body: Part, group: list[Face]) -> tuple[Part | None, str]:
    """``body`` without one connected set of faces, the gap closed and checked; or None and why.
    Where the faces' rim says nothing about the direction (tangent or mixed edges), the volume may
    change by no more than the faces span (their area times the size of their box), and the
    part's box may not shrink: closing the gap there must not take away the part around it."""
    expect = _feature_kind(group)
    before = _volume(body)
    bound = None
    if expect == 0:
        span = group[0].bbox()
        for f in group[1:]:
            span = span.union(f.bbox())
        bound = sum(f.area for f in group) * span.diagonal
    why = ""
    for rebuild in ("extend", "planar_cap"):
        try:
            res = _guarded("remove_faces", lambda: _D.defeature(body._brep, [[f._f for f in group]], rebuild))
        except _KernelFault as e:
            why = why or e.reason
            continue
        if res["brep"] is None:
            why = why or ("the kernel could not close the gap" if res["added"] else
                          "the kernel did not take the faces as a feature (it must be bounded by closed loops of edges)")
            continue
        candidate = body._like(res["brep"])
        problem = _problem(before, candidate, expect, None) or (_spill(body, candidate, before, bound)
                                                                 if bound is not None else None)
        if problem is None:
            return candidate, ""
        why = why or f"the kernel returned {problem}"
    return None, why


def _spill(body: Part, result: Part, before: float, bound: float) -> str | None:
    """What is wrong with a result whose volume may change either way: a change beyond ``bound``,
    or a box that shrank (the gap was closed by taking the part around it away)."""
    change = abs(_volume(result) - before)
    if change > bound:
        return f"a volume change of {change:.6g}, more than the faces span ({bound:.6g})"
    a, b = body.bbox(), result.bbox()
    tol = 1e-6 * max(1.0, a.diagonal)
    for i, axis in enumerate("XYZ"):
        if b.min[i] > a.min[i] + tol or b.max[i] < a.max[i] - tol:
            return (f"a part that shrank along {axis} ({a.min[i]:.6g}..{a.max[i]:.6g} -> "
                    f"{b.min[i]:.6g}..{b.max[i]:.6g})")
    return None


def remove_faces(part: Part, faces: Any, *, partial: bool = False) -> Part:
    """See :meth:`Part.remove_faces`."""
    part._require_valid("remove_faces")
    given = _faces_of(part, faces, "remove_faces")
    if len(fillet_faces(given)) == len(given):  # rounds only: taken out by what takes out rounds
        return remove_fillets(part, given, partial=partial)
    sel = _complete(given)
    if len(sel) == len(part.faces()):
        raise ModelingError("remove_faces: that is every face of the part; nothing would be left")
    body = part
    failed: list[tuple[list[Face], str]] = []
    for group in _groups(sel):
        todo = group if body is part else _carry(body, group, {})[0]
        if not todo:
            continue
        result, why = _close(body, todo)
        if result is None:
            failed.append((group, why))
        else:
            body = result
    if failed and not partial:
        group, why = failed[0]
        c = group[0].center()
        more = f" ({len(failed)} of {len(_groups(sel))} features failed)" if len(failed) > 1 else ""
        raise ModelingError(f"remove_faces: {why} at ({c.x:.4g}, {c.y:.4g}, {c.z:.4g}){more}; select every face of "
                            f"the feature (the wall and the floor of a pocket, the side and the top of a boss), take "
                            f"out its fillets first (remove_fillets), or keep it with partial=True")
    return body
