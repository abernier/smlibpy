"""Surface modeling: freeform surfaces, stitching surfaces into solids.

Most surface work goes through the regular operations: extruding, revolving,
sweeping or lofting an *open* curve gives a surface (a :class:`~smlibpy.Shell`)
instead of a solid. This module adds surfaces through point grids, ruled surfaces
and stitching.
"""

from __future__ import annotations

import math
from typing import Any, Literal, NamedTuple, Sequence, overload

import numpy as np

from ._kernel import KernelError, ModelingError, ext, k, kernel_call
from .geometry import Vector, VectorLike, _vec
from .shapes import Edge, Face, Part, Shell, Wire, _bodies, _continuity, _curves_of, _t

__all__ = ["surface", "FitReport", "nurbs_surface", "ruled", "stitch", "StitchReport", "surface_fillet", "blend",
           "fill", "network"]


def _shell_of_surface(srf: Any) -> Shell:
    try:
        with kernel_call("surface"):
            b = ext.face_from_surface(srf)
    finally:
        ext.delete_surface(srf)
    return Shell._wrap(b)


class FitReport(NamedTuple):
    """How far the points given to :func:`surface` lie from the surface (``surface(..., report=True)``).

    Attributes:
        max_distance: The largest distance of a point from the surface, to its closest point on it.
        rms_distance: The root mean square of the distances.
        distances: The distance of each point (a numpy array, in the order given; a grid's rows one
            after the other).

    The distances are true ones, to each point's closest point on the surface. (A fit's own
    residuals, at the parameters it gave the points, overstate how far a cloud that is not a height
    field lies from its surface: 18.3 where the worst point lies 7.4 from it.)
    """

    max_distance: float
    rms_distance: float
    distances: np.ndarray


@overload
def surface(points: Sequence[Sequence[VectorLike]] | Sequence[VectorLike] | np.ndarray, *, interpolate: bool = ...,
            controls: int | tuple[int, int] | None = ..., smoothing: float = ...,
            report: Literal[False] = ...) -> Shell: ...
@overload
def surface(points: Sequence[Sequence[VectorLike]] | Sequence[VectorLike] | np.ndarray, *, interpolate: bool = ...,
            controls: int | tuple[int, int] | None = ..., smoothing: float = ...,
            report: Literal[True]) -> tuple[Shell, FitReport]: ...
def surface(points: Sequence[Sequence[VectorLike]] | Sequence[VectorLike] | np.ndarray, *, interpolate: bool = True,
            controls: int | tuple[int, int] | None = None, smoothing: float = 1e-2,
            report: bool = False) -> Shell | tuple[Shell, FitReport]:
    """A freeform NURBS surface through a grid of points, or fitted to a cloud of points.

    Args:
        points: Rows of points, ``points[i][j]`` (a grid: all rows the same length, at least
            4 x 4: the surface is bicubic). Or a cloud: points in any order (a list of points, an
            ``(n, 3)`` array, at least 4), such as a scan; the surface approximates them.
        interpolate: Grids: pass through the points (default). ``False`` uses them as control
            points, which gives a smoother surface that only approaches them.
        controls: Clouds: control points of the surface per direction, a number or ``(along,
            across)`` (4 to 64), "along" the longer side of the cloud. Default: about one per 8
            points, shaped like the cloud. More follow finer detail, and noise.
        smoothing: Clouds: how much the surface resists bending, against how close it comes to
            the points: 0 to 1, default 1e-2. For noisy points raise it (0.1 to 1), or take fewer
            control points.
        report: True returns ``(sheet, report)``, a :class:`FitReport`: how far each point lies
            from the surface (to its closest point), the largest and the rms distance. About
            0.13 s for 1,500 points, 3 s for 20,000.

    A cloud must be a height field over its best-fit plane (no overhangs, nothing folded over).
    The surface spans the smallest rectangle around the points in that plane; where there are
    no points, the smoothing shapes it. Its normal points up (+Z); for a cloud that stands
    upright, to +Y, else to +X. A cloud that is not a height field gets a surface that misses it
    by millimetres, without an error: check ``report.max_distance`` against the noise you expect.
    """
    if _is_cloud(points):
        sheet = _fit(points, controls, smoothing)
        if not report:
            return sheet
        return sheet, _fit_report(sheet, np.asarray([tuple(_vec(p)) for p in points], dtype=float))
    if controls is not None:
        raise ValueError("surface: controls are for clouds of points; a grid sets its own")
    grid = np.asarray([[tuple(_vec(p)) for p in row] for row in points], dtype=float)
    if grid.ndim != 3 or grid.shape[0] < 4 or grid.shape[1] < 4:
        shape = "x".join(str(n) for n in grid.shape[:2]) if grid.ndim == 3 else "not a grid"
        raise ValueError(f"surface needs a grid of at least 4 x 4 points (bicubic), got {shape}; "
                         f"for a four-sided patch use ruled() between two lines")
    if not np.all(np.isfinite(grid)):
        raise ValueError("surface: the points must be finite numbers")
    rows, cols = grid.shape[:2]
    flat = [_t(p) for p in grid.reshape(-1, 3)]
    with kernel_call("surface"):
        if interpolate:
            srf = k.create_surface_from_ordered_points(flat, rows, cols)
        else:
            srf = k.create_surface_from_points(flat, rows, cols)
    sheet = _shell_of_surface(srf)
    if not report:
        return sheet
    return sheet, _fit_report(sheet, grid.reshape(-1, 3))


def _fit_report(sheet: Shell, points: np.ndarray) -> FitReport:
    """How far the points lie from the sheet's one surface."""
    with kernel_call("surface"):
        d = np.asarray(ext.surface_distances(sheet.faces()[0]._f.surface(), points.ravel().tolist()), dtype=float)
    return FitReport(float(d.max()), float(math.sqrt(float(np.mean(d * d)))), d)


def nurbs_surface(points: Any, knots: tuple[Sequence[float], Sequence[float]] | None = None,
                  degrees: int | tuple[int, int] | None = None,
                  weights: Sequence[Sequence[float]] | np.ndarray | None = None) -> Shell:
    """A surface from its NURBS data: control points, knots, degrees and weights, as other programs,
    files or papers give them (also rational surfaces, other degrees than 3, knots that are not
    uniform). The inverse of ``Face.nurbs()``.

    Args:
        points: The control points in rows, ``points[i][j]`` the point ``i`` along u and ``j`` along
            v (all rows the same length, at least ``degree + 1`` each way); or a ``NurbsSurface``
            (``Face.nurbs()``: its degrees, knots, points and weights), with nothing else given.
        knots: The knot vectors ``(u_knots, v_knots)``, every knot as often as its multiplicity:
            ``len(rows) + u_degree + 1`` and ``len(row) + v_degree + 1`` knots, not decreasing.
            The ends need not repeat: the surface spans ``knots[degree]`` to ``knots[-degree - 1]``
            each way (inside the control net where they do not). Default: uniform and clamped (the
            surface starts and ends at the net's corner points).
        degrees: The degrees ``(u, v)`` (1 to 32), or one for both. Default: from the knots
            (``len(knots) - len(points) - 1``), or 3 (less where there are fewer than 4 points).
        weights: A positive weight per control point, in the same rows; ``None`` for a
            non-rational surface.

    Returns:
        A sheet of one face over the whole surface, its normal along ``du x dv``.
    """
    if knots is None and degrees is None and weights is None and hasattr(points, "degrees") \
            and hasattr(points, "knots") and hasattr(points, "points"):
        degrees, knots, weights, points = points.degrees, points.knots, points.weights, points.points
    if isinstance(points, (tuple, list)) and len(points) == 2 and all(isinstance(d, int) for d in points):
        # (the degrees of a NurbsSurface given unpacked: nurbs_surface(*face.nurbs()))
        raise TypeError("nurbs_surface: the control points come first; give a NurbsSurface whole "
                        "(nurbs_surface(face.nurbs()) or Shell.from_nurbs(face.nurbs())), not unpacked")
    try:
        grid = np.asarray([[tuple(_vec(p)) for p in row] for row in points], dtype=float)
    except (TypeError, ValueError):
        raise ValueError("nurbs_surface: the control points are rows of points, all rows the same length") from None
    if grid.ndim != 3 or grid.shape[0] < 2 or grid.shape[1] < 2:
        raise ValueError("nurbs_surface: the control points are rows of points (at least 2 x 2), all rows the same "
                         "length")
    if not np.all(np.isfinite(grid)):
        raise ValueError("nurbs_surface: the control points must be finite numbers")
    nu, nv = grid.shape[:2]
    if degrees is None:
        if knots is None:
            du, dv = min(3, nu - 1), min(3, nv - 1)
        else:
            du, dv = len(knots[0]) - nu - 1, len(knots[1]) - nv - 1
    elif isinstance(degrees, (int, np.integer)):
        du = dv = int(degrees)
    else:
        du, dv = (int(x) for x in degrees)
    for name, d, n in (("u", du, nu), ("v", dv, nv)):
        if not 1 <= d <= 32:
            raise ValueError(f"nurbs_surface: the {name} degree must be 1 to 32, got {d}")
        if n < d + 1:
            raise ValueError(f"nurbs_surface: degree {d} needs at least {d + 1} control points along {name}, got {n}")
    if knots is None:
        ku = [0.0] * (du + 1) + [i / (nu - du) for i in range(1, nu - du)] + [1.0] * (du + 1)
        kv = [0.0] * (dv + 1) + [i / (nv - dv) for i in range(1, nv - dv)] + [1.0] * (dv + 1)
    else:
        if len(knots) != 2:
            raise ValueError("nurbs_surface: knots are two knot vectors, (u_knots, v_knots)")
        ku, kv = ([float(x) for x in kn] for kn in knots)
    for name, kn, d, n in (("u", ku, du, nu), ("v", kv, dv, nv)):
        if len(kn) != n + d + 1:
            raise ValueError(f"nurbs_surface: {n} control points of degree {d} along {name} need {n + d + 1} knots "
                             f"(control points + degree + 1), got {len(kn)}")
        if not all(math.isfinite(x) for x in kn) or any(b < a for a, b in zip(kn, kn[1:])):
            raise ValueError(f"nurbs_surface: the {name} knots must be finite and not decrease")
    w: list[float] = []
    if weights is not None:
        wa = np.asarray(weights, dtype=float)
        if wa.shape != (nu, nv):
            raise ValueError(f"nurbs_surface: weights are rows like the control points ({nu} x {nv}), got "
                             f"{'x'.join(str(n) for n in wa.shape)}")
        if not np.all(np.isfinite(wa)) or not np.all(wa > 0):
            raise ValueError("nurbs_surface: the weights must be positive numbers")
        w = wa.ravel().tolist()
    with kernel_call("nurbs_surface"):
        srf = ext.nurbs_surface(du, dv, nu, nv, grid.ravel().tolist(), ku, kv, w)
    return _shell_of_surface(srf)


def _is_cloud(points: Any) -> bool:
    """Points in any order (a list of points or an (n, 3) array) rather than rows of points."""
    if isinstance(points, np.ndarray):
        return points.ndim == 2
    items = list(points) if not isinstance(points, list) else points
    if not items:
        raise ValueError("surface needs points")
    first = items[0]
    if isinstance(first, Vector):
        return True
    try:
        return all(isinstance(x, (int, float, np.number)) for x in first)
    except TypeError:
        return False


def _fit(points: Any, controls: int | tuple[int, int] | None, smoothing: float) -> Shell:
    cloud = np.asarray([tuple(_vec(p)) for p in points], dtype=float)
    if cloud.ndim != 2 or len(cloud) < 4:
        raise ValueError(f"surface needs at least 4 points to fit, got {len(cloud)}")
    if not np.all(np.isfinite(cloud)):
        raise ValueError("surface: the points must be finite numbers")
    if controls is None:
        nu = nv = 0
    else:
        nu, nv = (controls, controls) if isinstance(controls, (int, np.integer)) else tuple(controls)
        if not (4 <= nu <= 64 and 4 <= nv <= 64):
            raise ValueError(f"surface: controls must be 4 to 64 per direction, got {controls}")
    if not 0 <= smoothing <= 1:
        raise ValueError(f"surface: smoothing must be 0 to 1, got {smoothing}")
    with kernel_call("surface", "the points may lie on a line, or be too few for the control points"):
        srf, _, _, _, _ = ext.fit_surface(cloud.ravel().tolist(), int(nu), int(nv), float(smoothing))
    return _shell_of_surface(srf)


def ruled(a: Edge | Wire, b: Edge | Wire) -> Shell:
    """The ruled surface between two curves (straight lines join matching points)."""
    ca = a if isinstance(a, Edge) else _single(a)
    cb = b if isinstance(b, Edge) else _single(b)
    c1, c2 = ca._copy_curve(), cb._copy_curve()
    try:
        with kernel_call("ruled"):
            srf = k.create_ruled_surface(c1, c2)
    finally:
        ext.delete_curve(c1)
        ext.delete_curve(c2)
    return _shell_of_surface(srf)


def _single(w: Wire) -> Edge:
    edges = w.edges()
    if len(edges) != 1:
        raise ValueError("expected a single curve; join the wire's edges into one spline first")
    return edges[0]


class StitchReport(NamedTuple):
    """What :func:`stitch` sewed (``stitch(..., report=True)``).

    Attributes:
        sewn_edges: Pairs of free edges sewn into one edge.
        open_edges: Free edges left: the border of a sheet, and edges whose partner lies further
            away than the tolerance.
        max_gap: The widest gap closed, between vertices or edges that were sewn (0 where the
            pieces met exactly). Every gap closed is at most ``tolerance``.
        turned_faces: Faces turned over so that their normals agree with their neighbours' (on
            open results; a closed result faces outward anyway).
        tolerance: The widest gap stitch looked for: the ``tolerance`` given, or its default, or
            less where every edge was sewn before.
    """

    sewn_edges: int
    open_edges: int
    max_gap: float
    turned_faces: int
    tolerance: float


@overload
def stitch(*pieces: Shell | Face | Part | Sequence[Any], tolerance: float | None = ...,
           report: Literal[False] = ...) -> Part | Shell: ...
@overload
def stitch(*pieces: Shell | Face | Part | Sequence[Any], tolerance: float | None = ...,
           report: Literal[True]) -> tuple[Part | Shell, StitchReport]: ...
def stitch(*pieces: Shell | Face | Part | Sequence[Any], tolerance: float | None = None,
           report: bool = False) -> Part | Shell | tuple[Part | Shell, StitchReport]:
    """Sew faces and sheets along their common edges.

    Args:
        pieces: Faces, sheets, sketches or parts, and lists of them.
        tolerance: The widest gap to close (default: 1e-4 of the size of all pieces together).
            Edges and vertices further apart stay open: a gap is never closed silently. Edges that
            meet closely are sewn first, looser ones after them, up to the tolerance.
        report: True returns ``(body, report)``, a :class:`StitchReport`: the edges sewn, the
            free edges left and the widest gap closed.

    Returns:
        A :class:`Part` when the pieces close around a volume (its faces then point outward),
        otherwise a :class:`Shell`. The faces of an open result are turned to agree with their
        neighbours; each connected piece keeps the normal of its first face (in the order given),
        so that the sheet thickens.
    """
    bodies = _bodies(pieces)
    if not bodies:
        raise ValueError("nothing to stitch")
    if tolerance is not None and not (tolerance > 0 and math.isfinite(tolerance)):
        raise ValueError(f"stitch: the tolerance must be a positive distance, got {tolerance}")
    with kernel_call("stitch"):
        b = ext.combine([x._brep for x in bodies])
    shell = Shell._wrap(b)
    size = shell.bbox().diagonal
    gap = float(tolerance) if tolerance is not None else max(size * 1e-4, 1e-7)
    with kernel_call("stitch", "the pieces may not meet within the tolerance"):
        r = ext.stitch_faces(shell._brep, gap)
    body: Part | Shell = shell
    if r["open"] == 0:
        part = Part._wrap(shell._copy_brep())
        if part._solid_problem() is None:
            body = part
    if not report:
        return body
    return body, StitchReport(int(r["sewn"]), int(r["open"]), max(float(r["vertex_gap"]), float(r["edge_gap"])),
                              int(r["turned"]), float(r["tolerance"]))


def surface_fillet(a: Face | Shell, b: Face | Shell, radius: float, *, radius2: float | None = None,
                   shape: Literal["round", "chamfer"] = "round", sides: tuple[int, int] = (1, 1),
                   trim: bool = False) -> Shell:
    """A round blend between the surfaces of two faces, as a sheet: for surfaces that are not the
    faces of one part, such as two sheets that cross (``fillet`` rounds the edges of a part). Or a
    flat one, a chamfer, between the same lines.

    Args:
        a: The first face (or a sheet of one face). Its surface is blended, as far as the
            surface reaches: the blend may run past the face.
        b: The second face (or a sheet of one face), the same way.
        radius: The radius of the blend: of the ball that rolls between the two surfaces.
        radius2: Chamfers only: a second distance, from ``b``. The chamfer then runs between the
            lines below where ``a``'s surface moved out by ``radius`` and ``b``'s moved out by
            ``radius2`` cross: for faces at right angles its edge on ``b`` lies ``radius`` from
            ``a``, its edge on ``a`` ``radius2`` from ``b``. Default: ``radius``.
        shape: ``"round"`` (default): a circular cross-section; ``"chamfer"``: a flat one,
            straight across between the lines where the round of the same radius meets the two
            surfaces (on faces at right angles, legs of ``radius``).
        sides: The side of each face the blend lies on: 1 the side its normal (``normal_at()``)
            points to, -1 the other. Two crossing surfaces leave four places for a ball to roll,
            one per combination.
        trim: True cuts both faces back to the blend's long edges and sews the three into one
            sheet. The blend's edges must run across both faces, from border to border.

    Returns:
        The blend, a sheet (:class:`Shell`) whose edges along its length lie on the two surfaces;
        with ``trim`` the two faces, cut back, and the blend between them as one sheet.
    """
    from ._guard import isolated

    fa, fb = _one_face(a, "a"), _one_face(b, "b")
    if not radius > 0 or not math.isfinite(radius):
        raise ValueError(f"surface_fillet: the radius must be positive, got {radius}")
    if shape not in ("round", "chamfer"):
        raise ValueError(f'surface_fillet: shape is "round" or "chamfer", got {shape!r}')
    if radius2 is not None:
        if shape != "chamfer":
            raise ValueError('surface_fillet: radius2 is for chamfers (shape="chamfer"); a round blend has one radius')
        if not radius2 > 0 or not math.isfinite(radius2):
            raise ValueError(f"surface_fillet: radius2 must be positive, got {radius2}")
    if len(sides) != 2 or any(x not in (1, -1) for x in sides):
        raise ValueError(f"surface_fillet: sides must be two of 1 and -1, got {sides}")
    # (the kernel's sides are those of each surface's own normal, which a face may turn around)
    r1 = radius * sides[0] * (1 if fa._natural_is_outward() else -1)
    r2 = (radius if radius2 is None else radius2) * sides[1] * (1 if fb._natural_is_outward() else -1)
    size = max(fa.bbox().union(fb.bbox()).diagonal, radius, radius2 or 0.0)
    tolerance = max(1e-7 * size, 1e-9)
    hint = "the surfaces may not meet, or not leave room for the radius on those sides"
    # (on copies: the kernel changes the surfaces it blends, and a second blend of the same
    # surfaces then fails)
    ca, cb = fa.to_shell(), fb.to_shell()
    with kernel_call("surface_fillet", hint):
        # (in another process: the kernel's blend code can crash or loop)
        brep = isolated("surface_fillet", _surface_fillet_step, ca.faces()[0]._f, cb.faces()[0]._f, r1, r2, tolerance,
                        2 if shape == "round" else 0)
    if brep is None:
        raise ModelingError(f"surface_fillet: the kernel made no blend; {hint}")
    shell = Shell._wrap(brep)
    if not shell.faces():
        raise ModelingError(f"surface_fillet: the kernel made no blend; {hint}")
    if trim:
        return _trimmed_fillet(fa, fb, shell, max(1e-5 * size, 1e-7))
    return shell


def _trimmed_fillet(fa: Face, fb: Face, blend: Shell, tol: float) -> Shell:
    """The faces of a surface fillet cut back to its long edges, sewn to it into one sheet."""
    rail_a, rail_b = _rail_on(blend, fa, tol), _rail_on(blend, fb, tol)
    if rail_a is None or rail_b is None or rail_a == rail_b:
        raise ModelingError("surface_fillet: the blend's long edges do not lie on the faces; trim them yourself")
    pieces = []
    for f, rail, other in ((fa, rail_a, rail_b), (fb, rail_b, rail_a)):
        # keep the side away from the blend: the blend leaves the face toward the other edge
        m = rail.point_at(0.5)
        n = f.normal_at(m)
        v = other.point_at(0.5) - m
        v = v - n * v.dot(n)
        if not v.length > 0:
            raise ModelingError("surface_fillet: the blend leaves a face along its normal; trim the faces yourself")
        sheet = f.to_shell()
        try:
            pieces.append(sheet.trim(rail, m - v.normalized() * max(1e-3 * sheet.bbox().diagonal, 10 * tol)))
        except (ModelingError, ValueError) as e:
            raise ModelingError(f"surface_fillet: the blend does not cut a face back (its long edges must run "
                                f"across both faces, from border to border): {e}") from e
    joined = stitch(pieces[0], blend, pieces[1])
    if _free_edges(joined) != _free_edges(pieces[0]) + _free_edges(pieces[1]):
        raise ModelingError("surface_fillet: the blend could not be sewn to the faces cut back; join them with "
                            "stitch(..., tolerance=...)")
    return joined


def _rail_on(blend: Shell, f: Face, tol: float) -> Edge | None:
    """The edge of the blend that lies on the face's surface (None if none does)."""
    srf = f._f.surface()
    gaps = [(max(k.surface_closest_point(srf, e.point_at(t).to_tuple())[2] for t in (0.0, 0.25, 0.5, 0.75, 1.0)), i)
            for i, e in enumerate(blend.edges())]
    gap, i = min(gaps)
    return blend.edges()[i] if gap <= tol else None


def _free_edges(body: Shell | Part) -> int:
    return sum(1 for e in body.edges() if len(e.faces()) == 1)


def blend(edge_a: Edge, edge_b: Edge, *, continuity: Literal["G1", "G2", "G3"] | int = "G2",
          tension: float | tuple[float, float] = (1, 1), join: bool = False) -> Shell:
    """A smooth bridge between free edges of two sheets: a sheet that leaves one sheet across one
    edge and reaches the other across the other, tangent to both (or curvature-continuous).

    Args:
        edge_a: An edge on the border of a sheet (one face uses it), such as
            ``sheet.edges().filter(lambda e: len(e.faces()) == 1)``.
        edge_b: An edge on the border of another sheet (or of the same one).
        continuity: How smoothly the blend meets the sheets: ``"G1"`` tangent, ``"G2"`` with the
            same curvature across the edges too (default), ``"G3"`` also the same change of
            curvature.
        tension: How far the blend runs on in each sheet's direction before it turns: its
            take-off at ``edge_a`` and ``edge_b`` as a part of the gap between the edges (default
            1). One number for both, or a pair. Less is tighter, more bulges.
        join: True sews the blend to both sheets (:func:`stitch`) and returns the one sheet.

    The blend joins the nearest ends of the two edges (its side edges never cross), and its
    normal follows ``edge_a``'s sheet. Two closed edges (the rims of two tubes, full circles or
    closed loops) are bridged all round: each point of ``edge_a`` is joined to the point of
    ``edge_b`` at the same fraction of its length, counted from its point nearest ``edge_a``'s
    start and running the same way round. Such a blend is two faces sewn along two seams (the
    kernel offsets no face that closes around), as smooth across them as elsewhere. A closed edge
    and an open one cannot be bridged.

    Returns:
        The blend, a sheet of one face, of two between closed edges (with ``join``, the two sheets
        and the blend sewn into one).
    """
    fa, fb = _free_face(edge_a, "edge_a"), _free_face(edge_b, "edge_b")
    try:
        level = _continuity(continuity)
    except (ValueError, TypeError):
        level = None
    if level is None:
        raise ValueError(f"blend: continuity must be G1, G2 or G3, got {continuity!r}")
    if isinstance(tension, (int, float)):
        ta = tb = float(tension)
    else:
        if len(tension) != 2:
            raise ValueError(f"blend: tension is one number or a pair, got {tension!r}")
        ta, tb = (float(t) for t in tension)
    if not (ta > 0 and tb > 0 and math.isfinite(ta) and math.isfinite(tb)):
        raise ValueError(f"blend: the tension must be positive, got {tension!r}")
    if edge_a == edge_b:
        raise ValueError("blend: edge_a and edge_b are the same edge")
    try:
        with kernel_call("blend", "the edges may touch or cross, or a sheet may not lead toward the other edge"):
            b = ext.edge_blend(fa._f, edge_a._e, fb._f, edge_b._e, level, ta, tb)
    except ValueError as e:
        raise ValueError(str(e).replace("edge_blend:", "blend:", 1)) from None
    sheet = Shell._wrap(b)
    if not join:
        return sheet
    a_body, b_body = edge_a._owner, edge_b._owner
    sheets = [a_body] if a_body is b_body else [a_body, b_body]
    joined = stitch(*sheets, sheet)
    # sewn along both edges: no free edge of the result left on either (a closed blend comes in two
    # halves, so the count of free edges says nothing)
    tol = 1e-6 * max(1.0, joined._loose_box().diagonal)
    loose = [e for e in joined.edges() if len(e.faces()) == 1]
    if any(min(edge_a.distance_to(e.center()), edge_b.distance_to(e.center())) <= tol for e in loose):
        raise ModelingError("blend: the blend could not be sewn to the sheets; join them with stitch(..., tolerance=...)")
    return joined


def _free_face(e: Any, name: str) -> Face:
    """The one face of a border edge of a sheet."""
    if not isinstance(e, Edge):
        raise TypeError(f"blend takes edges of sheets, not a {type(e).__name__}")
    faces = e.faces()
    if not faces:
        raise TypeError(f"blend: {name} is a curve, not an edge of a sheet; make a sheet with it first (extrude, ruled)")
    if len(faces) != 1 or isinstance(e._owner, Part):
        raise ValueError(f"blend: {name} lies between two faces; take an edge on a sheet's border (used by one face)")
    return faces[0]


def _surface_fillet_step(a: Any, b: Any, r1: float, r2: float, tolerance: float, xsect: int = 2) -> Any:
    """The kernel's blend of the surfaces of two faces (isolated): ``xsect`` 2 round, 0 a chamfer."""
    return k.surface_surface_fillet(a.surface(), b.surface(), radius1=r1, radius2=r2, tolerance=tolerance,
                                    xsect_type=xsect)


def _one_face(x: Any, name: str) -> Face:
    if isinstance(x, Face):
        return x
    if isinstance(x, Shell) and not isinstance(x, Part):
        faces = x.faces()
        if len(faces) == 1:
            return faces[0]
        raise ValueError(f"surface_fillet: {name} is a sheet of {len(faces)} faces; pass one of them")
    raise TypeError(f"surface_fillet takes faces (or sheets of one face), not a {type(x).__name__}")


def fill(boundary: Edge | Wire | Sequence[Edge | Wire], *, tangent: bool = True) -> Shell:
    """A surface that fills a closed loop of curves: a hole in a sheet, or the frame of a patch.

    Args:
        boundary: The curves around the hole, in any order and direction: edges on the border of
            sheets (``sheet.edges().filter(lambda e: len(e.faces()) == 1)``), curves
            (:class:`~smlibpy.Spline`, :class:`~smlibpy.ThreePointArc`, ...) or wires. One closed
            curve (the round edge of a hole), or two, is cut into four sides. Where the curves run
            into each other without corners (a rim in two or three pieces, cut where a seam
            crosses it), the four sides are as nearly equal as the curves' ends allow: a round hole
            is filled the same wherever its rim was cut.
        tangent: True (default): where the curves are edges of sheets, the patch meets each sheet
            tangentially along its edge; then every curve must be such an edge, and the sheets must
            meet each other tangentially where the edges meet (a hole in one smooth sheet, a corner
            between three rounds). False runs the patch through the curves only, and so do the
            edges around a planar face or a sketch's region (the patch would cover that face).

    Four sides make a Coons patch, of one face (through curves only, it is bilinear: straight
    across between opposite sides, in the middle the sum of both). Five sides and more make an
    N-sided fill of one face per side, sewn, meeting in the middle (tangent to the sheets only to
    about 1.4 degrees: the kernel's N-sided fill). Three sides make an N-sided fill of three faces
    through curves only; tangent to sheets, a Coons patch whose fourth side shrinks to a point at
    one corner (a pole there: thickening such a patch fails). Three curves without corners between
    them make four sides instead.

    Returns:
        The patch, a sheet. Its normal follows the sheets it is tangent to; through curves only,
        it follows the right-hand rule around the loop in the direction of the first curve given.
        Sew it to the sheets with :func:`stitch` (``stitch(sheet, patch)``).

    Raises:
        ValueError: The curves do not close into one loop (the message names the gap), or some
            curves are edges of sheets and others not while ``tangent`` is True.
        ModelingError: The patch misses its curves, meets a sheet at an angle, or folds back over
            the sheets.
    """
    edges = _curves_of(boundary, "fill")
    sides: list[tuple[Edge, Face | None]] = []
    for e in edges:
        faces = e.faces()
        if len(faces) > 1 or isinstance(e._owner, Part):
            raise ValueError("fill: an edge lies between two faces; take edges on the border of a sheet (used by one "
                             "face), or curves")
        sides.append((e, faces[0] if (faces and tangent) else None))
    if tangent and sides and all(f is not None and f == sides[0][1] for _, f in sides) and sides[0][1].is_planar:
        # The outline of a planar face (a sketch's region): the patch would cover the face it is to
        # be tangent to, and fold back over it. The curves are taken as they are.
        outline = {x._identity() for x in sides[0][1].outer_wire().edges()}
        if {e._identity() for e, _ in sides} == outline:
            sides = [(e, None) for e, _ in sides]
    box = edges[0].bbox()
    for e in edges[1:]:
        box = box.union(e.bbox())
    size = max(box.diagonal, 1e-9)
    curves = [e._copy_curve() for e in edges]
    try:
        b = ext.fill_loop(curves, [f._f if f is not None else None for _, f in sides],
                          [e._e if f is not None else None for e, f in sides], 1e-4 * size)
    except RuntimeError as e:
        text = str(e)
        if text.startswith("fill:"):  # (the checks of the patch)
            raise ModelingError(text) from None
        raise KernelError("fill", text, None, "tangent sheets must meet each other tangentially where their edges "
                          "meet; a steep sheet (a wall standing up from the loop) may not leave room for a patch") from e
    finally:
        for c in curves:
            ext.delete_curve(c)
    patch = Shell._wrap(b)
    if len(patch.faces()) > 1:
        patch = stitch(patch, tolerance=1e-5 * size)
    return patch


def network(u: Sequence[Edge | Wire], v: Sequence[Edge | Wire]) -> Shell:
    """A surface through a network of curves: ``u`` curves that each cross every ``v`` curve.

    Args:
        u: Two or more curves running one way, in any order and direction (splines, arcs, edges;
            a wire is joined into one curve).
        v: Two or more curves running across them: each crosses every ``u`` curve once. The outer
            curves of each set bound the surface: every curve ends on them.

    The curves are made to cross at common parameters first (a Gordon surface needs that: the
    kernel's own missed its curves by 4e-2 on a 10 mm patch otherwise), and the surface is measured
    against the curves as given.

    Returns:
        A sheet of one face through every curve. Its normal is the first ``u`` curve's direction
        crossed with the first ``v`` curve's, where they cross.

    Raises:
        ValueError: Curves that do not cross (within 1e-4 of the network's size), that cross out of
            order, or that run on past the outer curves of the other set.
        ModelingError: The surface misses a curve by more than 1e-4 of the network's size (a very
            uneven network: curves of more even spacing, or more of them, help).
    """
    ucs, vcs = _network_curves(u, "u"), _network_curves(v, "v")
    pts = np.array([p for c in ucs + vcs for p in c[1]])
    size = max(float(np.linalg.norm(pts.max(axis=0) - pts.min(axis=0))), 1e-9)
    curves = [c[0] for c in ucs + vcs]
    try:
        b, deviation = ext.network_surface([c[0] for c in ucs], [c[0] for c in vcs], 1e-4 * size)
    except RuntimeError as e:
        text = str(e)
        if text.startswith("network:"):
            raise ModelingError(text) from None
        raise KernelError("network", text, None, "the curves must cross, each u curve every v curve, once") from e
    finally:
        for c in curves:
            ext.delete_curve(c)
    sheet = Shell._wrap(b)
    if not deviation <= 1e-4 * size:
        raise ModelingError(f"network: the surface misses the curves by {deviation:.3g} (more than 1e-4 of the "
                            f"network's size); curves of more even spacing, or more of them, help")
    return sheet


def _network_curves(items: Any, name: str) -> list[tuple[Any, list[tuple[float, float, float]]]]:
    """Standalone kernel curves (one per item, wires joined) and a few points of each."""
    if isinstance(items, (Edge, Wire)) or not hasattr(items, "__iter__"):
        raise TypeError(f"network: {name} is a list of curves")
    out: list[tuple[Any, list[tuple[float, float, float]]]] = []
    for it in items:
        if isinstance(it, Edge):
            edges = [it]
        elif isinstance(it, Wire):
            edges = list(it.edges())
        else:
            for c, _ in out:
                ext.delete_curve(c)
            raise TypeError(f"network: {name} holds curves (edges or wires), not a {type(it).__name__}")
        pts = [e.point_at(t).to_tuple() for e in edges for t in (0.0, 0.5, 1.0)]
        if len(edges) == 1:
            c = edges[0]._copy_curve()
        else:
            parts = [e._copy_curve() for e in edges]
            try:
                with kernel_call("network", "a wire's edges must follow one another"):
                    c = ext.join_curves(parts)
            finally:
                for p in parts:
                    ext.delete_curve(p)
        out.append((c, pts))
    return out
