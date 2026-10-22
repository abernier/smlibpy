"""Deformations: twist, taper and bend parts, or deform them with a control lattice.

A deformation moves every point of space, and the whole body with it: all faces, edges and
vertices go through the same map, so the result is again a closed solid with the same
faces, edges and vertices::

    from smlibpy import *

    bar = Box(20, 20, 100).twist(90)                 # a quarter turn over its length
    grip = Cylinder(12, 80).taper(0.7)               # 70 % of the diameter at the top
    hook = Box(160, 10, 6).bend(180, radius=25)      # U shape with straight legs
    block = Box(60, 40, 20)
    lat = Lattice(block, 3)                          # 3 x 3 x 3 control points around it
    lat.move((1, 1, -1), (0, 0, 8))                  # lift the middle of the top
    pillow = lat.apply(block)

The results are NURBS. Lattices and tapers are polynomial maps of space, so their results
are exact: every face is the exact image of the original (up to degree ``MAX_DEGREE``).
Twists and bends turn space with sines and cosines, which no NURBS reproduces; their faces
are within ``tolerance`` (default 1e-6 mm) of the exact image, except where that image is
still polynomial (the straight rulings of a twisted face, the turned ends of a twisted bar),
which stays exact. Every face keeps the parameterization of the original, so the trim
curves are the original ones.

The maps are the kernel's volume deformations (``SmTwistVolume``, ``SmBendVolume``,
``SmTransform``) and a Bezier volume for lattices and tapers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np

from ._kernel import BrepHandle, KernelError, ModelingError, ext, k, kernel_call
from .geometry import TOLERANCE, Axis, BoundBox, Location, Plane, Vector, VectorLike, X, Y, Z, _vec

__all__ = ["twist", "taper", "bend", "Lattice", "MAX_DEGREE"]

#: Highest degree of an exact result. A face whose exact image would need a higher degree
#: (a sphere in a 4 x 4 x 4 lattice needs 18) is approximated within the tolerance instead.
MAX_DEGREE = 12


# =============================================================================
# helpers
# =============================================================================
def _bodies() -> tuple[Any, Any, Any]:
    from .shapes import Part, Shell, Sketch

    return Part, Shell, Sketch


def _check_shape(shape: Any, what: str) -> None:
    Part, Shell, _ = _bodies()
    if not isinstance(shape, (Part, Shell)):
        raise TypeError(f"{what}: expected a Part or a Shell, got {type(shape).__name__}")
    if isinstance(shape, Part):
        shape._require_valid(what)
    elif shape._brep.face_count() == 0:
        raise ModelingError(f"{what}: the shape is empty")


def _tolerance(tolerance: float | None) -> float:
    tol = TOLERANCE if tolerance is None else float(tolerance)
    if not (tol > 0 and math.isfinite(tol)):
        raise ValueError("tolerance must be a positive number of millimeters")
    return tol


def _angle(angle: float, what: str) -> float:
    if isinstance(angle, bool) or not isinstance(angle, (int, float, np.floating, np.integer)):
        raise TypeError(f"{what}: angle must be a number of degrees")
    a = float(angle)
    if not math.isfinite(a):
        raise ValueError(f"{what}: angle must be a finite number of degrees")
    if a == 0:
        raise ValueError(f"{what}: angle is 0; nothing to do")
    return a


def _unit(v: VectorLike, what: str) -> np.ndarray:
    a = np.array(_vec(v).to_tuple(), dtype=float)
    n = float(np.linalg.norm(a))
    if not n > 1e-12:
        raise ValueError(f"{what} has no direction")
    return a / n


def _perpendicular(d: np.ndarray) -> np.ndarray:
    """A unit vector perpendicular to ``d``."""
    helper = np.array([1.0, 0.0, 0.0]) if abs(d[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    p = helper - d * helper.dot(d)
    return p / np.linalg.norm(p)


def _extent(shape: Any, origin: np.ndarray, d: np.ndarray) -> tuple[float, float]:
    """The range of ``(p - origin) . d`` over the shape (tight box in a frame along ``d``)."""
    for i in range(3):  # a world axis: the tight box directly
        if abs(abs(d[i]) - 1.0) < 1e-12:
            b = shape.bbox()
            lo, hi = b.min[i] - origin[i], b.max[i] - origin[i]
            return (lo, hi) if d[i] > 0 else (-hi, -lo)
    z = np.array([0.0, 0.0, 1.0])  # otherwise turn the shape so that d becomes +Z
    axis = np.cross(d, z)
    angle = math.degrees(math.atan2(float(np.linalg.norm(axis)), float(d.dot(z))))
    m = Location.about(Axis((0, 0, 0), tuple(axis / np.linalg.norm(axis))), angle).matrix
    b = shape._transformed(m).bbox()
    oz = float((m[:3, :3] @ origin)[2])
    return b.min.z - oz, b.max.z - oz


def _matrix(r: np.ndarray, t: np.ndarray) -> list[float]:
    """A 3 x 4 matrix [r | t], row-major."""
    m = np.zeros((3, 4))
    m[:, :3] = r
    m[:, 3] = t
    return [float(x) for x in m.ravel()]


def _rotation_about(origin: np.ndarray, d: np.ndarray, angle: float) -> tuple[np.ndarray, np.ndarray]:
    """``p -> r p + t``: the turn by ``angle`` degrees about the line through ``origin`` along ``d``."""
    m = Location.about(Axis(tuple(origin), tuple(d)), angle).matrix
    return m[:3, :3], m[:3, 3]


def _imprint(shape: Any, origin: np.ndarray, normal: np.ndarray) -> Any:
    """The shape with the faces it has across a plane split there (nothing added or removed)."""
    from .parts import Box
    from .shapes import _take

    size = 4.0 * (shape.bbox().diagonal + float(np.linalg.norm(origin))) + 10.0
    plane = Plane(tuple(origin), tuple(_perpendicular(normal)), tuple(normal))
    tool = Box(size, size, size).translate(0, 0, -size / 2).moved(plane.location)
    h, th = BrepHandle(shape._copy_brep()), BrepHandle(tool._copy_brep())  # the kernel keeps both if it fails
    with kernel_call("deform: split the faces at the end of the range",
                     "move start or end away from edges and faces of the part, or deform the whole part"):
        h.brep = ext.boolean(h.brep, th.brep, k.BooleanOp.UNION, imprinting=True)  # (clears the kernel's mark)
    _take(th)
    return shape._like(_take(h))


@dataclass
class _Plan:
    """What a deformation does: the shape to send (the ends of the range split into its
    faces), the spec of the kernel map, and the bounds of the volume ratio."""

    shape: Any
    spec: dict
    volume_ratio: tuple[float, float]


def _layout(shape: Any, origin: np.ndarray, d: np.ndarray, s: float, e: float, lo: float, hi: float,
            inside: dict, after: dict, tol: float) -> tuple[Any, dict]:
    """Split the faces at range ends inside the part and lay the maps out along the axis:
    unchanged before ``s``, ``inside`` from ``s`` to ``e``, ``after`` beyond."""
    eps = 1e-7 * max(1.0, hi - lo)
    cut_start, cut_end = s > lo + eps, e < hi - eps
    if cut_start:
        shape = _imprint(shape, origin + s * d, d)
    if cut_end:
        shape = _imprint(shape, origin + e * d, d)
    if not cut_start and not cut_end:
        return shape, {"axis": None, "pieces": [inside], "tolerance": tol}
    pieces = [{"kind": "identity", "hi": s}, dict(inside, hi=e), after]
    return shape, {"axis": [*map(float, origin), *map(float, d)], "pieces": pieces, "tolerance": tol}


def _range(shape: Any, origin: np.ndarray, d: np.ndarray, start: float | None, end: float | None,
           what: str) -> tuple[float, float, float, float]:
    lo, hi = _extent(shape, origin, d)
    s = lo if start is None else float(start)
    e = hi if end is None else float(end)
    if not (math.isfinite(s) and math.isfinite(e)):
        raise ValueError(f"{what}: start and end must be finite numbers")
    if not e > s:
        raise ValueError(f"{what}: end ({e:g}) must lie beyond start ({s:g})")
    if e <= lo or s >= hi:
        raise ModelingError(f"{what}: the range {s:g} to {e:g} does not reach the part, which spans {lo:g} to {hi:g} "
                            "(distances along the axis from its origin)")
    return s, e, lo, hi


def _run(plan: _Plan, what: str, source: Any) -> Any:
    """Send the shape through the map; check and return the result."""
    Part, Shell, Sketch = _bodies()
    spec = dict(plan.spec)
    spec.setdefault("max_degree", MAX_DEGREE)
    shape = plan.shape
    with kernel_call(what, "deform less, or use a larger tolerance"):
        brep, report = k.deform.deform_brep(shape._brep, spec)
    if isinstance(shape, Sketch):  # a deformed sketch is no longer planar
        result = Shell._wrap(brep, name=shape.name, color=shape.color)
    else:
        result = shape._like(brep)
    if report["faces_approximated"] or report["edges_approximated"]:
        if report["max_error"] > 2 * spec["tolerance"]:
            raise ModelingError(f"{what}: could not follow the deformation within the tolerance (off by "
                                f"{report['max_error']:.2g} mm); use a larger tolerance or deform less")
    if isinstance(result, Part):
        problem = result._shape_problem()
        if problem is None:
            try:
                volume = result._quick_volume()  # a check with a margin of 1e-3
            except KernelError:
                volume = float("nan")
            problem = result._solid_problem(volume)
            if problem is None:
                problem = _volume_problem(source, volume, plan.volume_ratio)
        if problem is not None:
            raise ModelingError(f"{what}: the result is not a valid solid ({problem}); the deformation "
                                "probably folds the part onto itself: deform less")
    return result


def _volume_problem(source: Any, volume: float, ratio: tuple[float, float]) -> str | None:
    """The volume of a deformed part lies between the smallest and the largest local volume
    change of the map times the original volume. Catches broken bodies, not small errors."""
    try:
        v0 = source._quick_volume()
    except KernelError:
        return None
    lo, hi = ratio
    if lo * v0 * (1 - 1e-3) <= volume <= hi * v0 * (1 + 1e-3):
        return None
    return f"its volume {volume:.6g} is outside the possible {lo * v0:.6g} to {hi * v0:.6g}"


# =============================================================================
# twist
# =============================================================================
def _plan_twist(shape: Any, angle: float, axis: Axis, start: float | None, end: float | None, tol: float) -> _Plan:
    o = np.array(axis.origin.to_tuple(), dtype=float)
    d = _unit(axis.direction, "twist: axis")
    s, e, lo, hi = _range(shape, o, d, start, end, "twist")
    inside = {"kind": "twist", "origin": list(o + s * d), "axis": list(d), "mid": list(_perpendicular(d)),
              "period": 360.0 * (e - s) / angle}
    r, t = _rotation_about(o, d, angle)
    work, spec = _layout(shape, o, d, s, e, lo, hi, inside, {"kind": "rigid", "matrix": _matrix(r, t)}, tol)
    return _Plan(work, spec, (1.0, 1.0))


def twist(shape: Any, angle: float, *, axis: Axis = Z, start: float | None = None, end: float | None = None,
          tolerance: float | None = None) -> Any:
    """Twist a part about an axis by ``angle`` degrees over its length (or from ``start`` to ``end``).

    Every cross-section turns by an angle that grows evenly from 0 at ``start`` to ``angle``
    at ``end``.

    Args:
        shape: a Part (or a Shell).
        angle: the turn in degrees between ``start`` and ``end``, counterclockwise seen from
            the tip of ``axis`` (right-hand rule, like ``rotate``). May exceed 360.
        axis: the line to twist about (default the world Z axis through the origin).
        start: where the twist begins, as a distance along the axis from ``axis.origin``.
            Default: where the part begins along the axis. What lies before ``start`` stays.
        end: where the twist ends, measured the same way. Default: where the part ends along
            the axis. What lies beyond ``end`` is turned by the whole ``angle``.
        tolerance: largest distance of the twisted faces from the exact twist (mm).

    Returns a Part (a Shell for a shell). The volume does not change.
    """
    _check_shape(shape, "twist")
    a = _angle(angle, "twist")
    plan = _plan_twist(shape, a, axis, start, end, _tolerance(tolerance))
    return _run(plan, "twist", shape)


# =============================================================================
# taper
# =============================================================================
def _plan_taper(shape: Any, scale: float, axis: Axis, start: float | None, end: float | None, tol: float) -> _Plan:
    o = np.array(axis.origin.to_tuple(), dtype=float)
    d = _unit(axis.direction, "taper: axis")
    s, e, lo, hi = _range(shape, o, d, start, end, "taper")
    e1 = _perpendicular(d)
    e2 = np.cross(d, e1)
    rho = max(shape.bbox().diagonal + float(np.linalg.norm(o)), 1.0)
    # a 2 x 2 x 2 lattice (a trilinear map) around the axis is exactly the linear taper
    pts: list[float] = []
    for i in (0, 1):
        for j in (0, 1):
            for kk, f in ((0, 1.0), (1, scale)):
                pts += [rho + f * (2 * rho * i - rho), rho + f * (2 * rho * j - rho), (e - s) * kk]
    inside = {"kind": "lattice", "origin": list(o + s * d - rho * e1 - rho * e2), "x": list(e1), "y": list(e2),
              "z": list(d), "size": [2 * rho, 2 * rho, e - s], "counts": [2, 2, 2], "points": pts}
    m = np.outer(d, d) + scale * (np.eye(3) - np.outer(d, d))
    work, spec = _layout(shape, o, d, s, e, lo, hi, inside, {"kind": "affine", "matrix": _matrix(m, o - m @ o)}, tol)
    return _Plan(work, spec, (min(1.0, scale) ** 2, max(1.0, scale) ** 2))


def taper(shape: Any, scale: float, *, axis: Axis = Z, start: float | None = None, end: float | None = None,
          tolerance: float | None = None) -> Any:
    """Taper a part along an axis: its cross-sections scale from 1 to ``scale`` (exact result).

    The cross-sections are scaled toward the axis by a factor that changes evenly from 1 at
    ``start`` to ``scale`` at ``end``.

    Args:
        shape: a Part (or a Shell).
        scale: size of the cross-section at ``end`` relative to ``start`` (> 0): 0.5 halves
            it, 2 doubles it. Lines along the axis stay straight.
        axis: the line the cross-sections shrink toward (default the world Z axis).
        start: where the tapered range begins, as a distance along the axis from
            ``axis.origin``. Default: where the part begins. What lies before ``start`` stays.
        end: where the tapered range ends, measured the same way. Default: where the part
            ends. What lies beyond ``end`` is scaled by ``scale`` across the axis.
        tolerance: only for faces whose exact image would exceed ``MAX_DEGREE`` (mm).

    The result is exact: a cylinder becomes a cone, a box a frustum of a pyramid.
    """
    _check_shape(shape, "taper")
    if isinstance(scale, bool) or not isinstance(scale, (int, float, np.floating, np.integer)):
        raise TypeError("taper: scale must be a number")
    f = float(scale)
    if not (math.isfinite(f) and f > 0):
        raise ValueError("taper: scale must be a positive number (1 keeps the size)")
    if f == 1:
        raise ValueError("taper: scale is 1; nothing to do")
    plan = _plan_taper(shape, f, axis, start, end, _tolerance(tolerance))
    return _run(plan, "taper", shape)


# =============================================================================
# bend
# =============================================================================
def _plan_bend(shape: Any, angle: float, radius: float | None, plane: Plane, start: float | None,
               end: float | None, tol: float) -> _Plan:
    o = np.array(plane.origin.to_tuple(), dtype=float)
    xd = np.array(plane.x_dir.to_tuple(), dtype=float)
    yd = np.array(plane.y_dir.to_tuple(), dtype=float)
    zd = np.array(plane.z_dir.to_tuple(), dtype=float)
    phi = math.radians(abs(angle))
    lo, hi = _extent(shape, o, xd)
    if radius is None:
        s = lo if start is None else float(start)
        e = hi if end is None else float(end)
        if not e > s:
            raise ValueError(f"bend: end ({e:g}) must lie beyond start ({s:g}) along the plane's x_dir")
        r = (e - s) / phi
    else:
        r = float(radius)
        length = r * phi
        if start is None and end is None:
            s, e = -length / 2, length / 2
        elif end is None:
            s = float(start)  # type: ignore[arg-type]
            e = s + length
        elif start is None:
            e = float(end)
            s = e - length
        else:
            s, e = float(start), float(end)
            if abs((e - s) - length) > 1e-9 * max(1.0, length):
                raise ValueError(f"bend: start and end are {e - s:g} apart, but radius {r:g} and angle {angle:g} "
                                 f"need {length:g}; give only two of radius, start and end")
    if not (math.isfinite(s) and math.isfinite(e)):
        raise ValueError("bend: start and end must be finite numbers")
    if e <= lo or s >= hi:
        raise ModelingError(f"bend: the bend ({s:g} to {e:g} along x_dir from the plane origin) does not reach "
                            f"the part, which spans {lo:g} to {hi:g}")
    sigma = 1.0 if angle > 0 else -1.0
    ylo, yhi = _extent(shape, o, yd)
    inner = yhi if sigma > 0 else -ylo  # how far the part reaches from the neutral layer toward the axis
    outer = -ylo if sigma > 0 else yhi
    if inner >= r:
        raise ModelingError(f"bend: the part reaches {inner:g} mm from the neutral layer toward the bend axis, which "
                            f"is only {r:g} mm away; bend with a larger radius (or over a longer range), or move the "
                            "plane origin (the neutral layer) toward the inside of the bend")
    center = o + s * xd + sigma * r * yd
    inside = {"kind": "bend", "center": list(center), "axis": list(sigma * zd), "mid": list(-sigma * yd), "neutral": r}
    # beyond the end the part goes on straight: p -> R (p - L x_dir) + t, with R, t the turn by
    # the whole angle about the bend axis and L the length of the bend
    rot, t = _rotation_about(center, sigma * zd, math.degrees(phi))
    after = {"kind": "rigid", "matrix": _matrix(rot, t - rot @ ((e - s) * xd))}
    work, spec = _layout(shape, o, xd, s, e, lo, hi, inside, after, tol)
    # a layer at distance y (toward the axis) changes its length by (r - y) / r
    return _Plan(work, spec, (min(1.0, (r - inner) / r), max(1.0, (r + outer) / r)))


def bend(shape: Any, angle: float, *, radius: float | None = None, plane: Plane = Plane.XZ,
         start: float | None = None, end: float | None = None, tolerance: float | None = None) -> Any:
    """Bend a part around an axis by ``angle`` degrees, like a bar bent over a mandrel.

    ``plane`` sets the bend: its ``x_dir`` runs along the part, a positive ``angle`` bends
    the part toward ``y_dir``, and the bend axis is parallel to the plane normal. The layer
    of the part through ``plane.origin`` (spanned by ``x_dir`` and the normal) is the
    neutral layer: it keeps its length; material on the inside of the bend is compressed,
    material on the outside stretched. With the default ``Plane.XZ``, a part lying along X
    bends up (toward +Z) about an axis parallel to Y.

    Args:
        shape: a Part (or a Shell).
        angle: how far the part turns, in degrees (positive: toward ``plane.y_dir``),
            less than 360.
        radius: the bend radius of the neutral layer. With ``radius`` and no ``start`` or
            ``end``, the bend (length ``radius * angle``) is centered on the plane origin;
            with one of them, it starts or ends there.
        start: where the bend begins, as a distance along ``x_dir`` from ``plane.origin``.
            Default: where the part begins. What lies before ``start`` stays.
        end: where the bend ends, measured the same way. Default: where the part ends, so
            ``bend(part, 90)`` bends the whole part into a quarter circle. What lies beyond
            ``end`` goes on straight, turned by ``angle``. Without ``radius``, ``start`` and
            ``end`` set it: radius = (end - start) / angle, with the angle in radians.
        tolerance: largest distance of the bent faces from the exact bend (mm).

    The bend axis lies ``radius`` from the neutral layer on the side the part bends toward;
    the part must not reach it.
    """
    _check_shape(shape, "bend")
    a = _angle(angle, "bend")
    if abs(a) >= 360:
        raise ValueError("bend: angle must be less than 360 degrees (a full turn would make the part touch "
                         "itself; revolve a profile for rings)")
    if radius is not None:
        if isinstance(radius, bool) or not isinstance(radius, (int, float, np.floating, np.integer)):
            raise TypeError("bend: radius must be a number")
        if not (math.isfinite(radius) and radius > 0):
            raise ValueError("bend: radius must be a positive number")
    if not isinstance(plane, Plane):
        raise TypeError("bend: plane must be a Plane (x_dir along the part, y_dir toward the inside of the bend)")
    plan = _plan_bend(shape, a, radius, plane, start, end, _tolerance(tolerance))
    return _run(plan, "bend", shape)


# =============================================================================
# lattice
# =============================================================================
def _axis_index(axis: Any) -> int:
    if isinstance(axis, str) and axis.lower() in ("x", "y", "z"):
        return "xyz".index(axis.lower())
    if isinstance(axis, Axis):
        for i, w in enumerate((X, Y, Z)):
            if axis.direction.is_parallel(w.direction):
                return i
    raise ValueError("axis must be X, Y or Z (or 'x', 'y', 'z')")


class Lattice:
    """A grid of control points around a part for free-form deformation (exact results).

    The points start evenly spaced over a box (``counts`` points per direction, corners
    included). Move them, then ``apply`` the lattice to a part: space inside the box moves
    smoothly with the points (a Bezier volume; space outside the box follows the same
    polynomial). A lattice whose points were not moved changes nothing.

    ``points`` is a writable ``(nx, ny, nz, 3)`` numpy array of world positions, indexed
    ``[i, j, k]`` along X, Y and Z: ``lat.points[1, 1, -1] += (0, 0, 5)`` lifts one point.
    ``move``, ``scale`` and ``rotate`` take the same indices (``(i, j, k)`` with ints and
    slices, or ``layer(...)``); they change the lattice in place and return it.

    Args:
        box: a BoundBox, or a shape whose bounding box is used.
        counts: points per direction, one int or three, 2 to 12. 2 moves the corners only (a
            trilinear map), 3 adds the midpoints (default), more give finer control. The
            degree of the exact result grows with the counts (see ``MAX_DEGREE``).
        margin: grow the box by this much on every side (mm).
    """

    __slots__ = ("points", "_rest", "_origin", "_size", "_counts")

    def __init__(self, box: Any, counts: int | Sequence[int] = 3, *, margin: float = 0.0):
        bb = box if isinstance(box, BoundBox) else box.bbox()
        if isinstance(counts, (int, np.integer)):
            counts = (int(counts),) * 3
        counts = tuple(int(c) for c in counts)
        if len(counts) != 3 or not all(2 <= c <= 12 for c in counts):
            raise ValueError("Lattice: counts must be 2 to 12 points per direction (one int or three)")
        lo = np.array(bb.min.to_tuple(), dtype=float) - float(margin)
        hi = np.array(bb.max.to_tuple(), dtype=float) + float(margin)
        size = hi - lo
        if not np.all(size > 1e-9):
            raise ValueError("Lattice: the box must have a size in all three directions (give a margin for flat shapes)")
        self._origin = lo
        self._size = size
        self._counts = counts
        grids = [np.linspace(0.0, 1.0, c) for c in counts]
        rest = lo + np.stack(np.meshgrid(*grids, indexing="ij"), axis=-1) * size
        rest.setflags(write=False)
        self._rest = rest
        self.points = rest.copy()

    # -- properties -----------------------------------------------------------
    @property
    def counts(self) -> tuple[int, int, int]:
        """Points per direction (X, Y, Z)."""
        return self._counts  # type: ignore[return-value]

    @property
    def box(self) -> BoundBox:
        """The box the points started on."""
        return BoundBox(tuple(self._origin), tuple(self._origin + self._size))

    @property
    def rest(self) -> np.ndarray:
        """The starting positions (read-only)."""
        return self._rest

    @property
    def offsets(self) -> np.ndarray:
        """How far each point was moved (``points - rest``)."""
        return self.points - self._rest

    # -- selections -----------------------------------------------------------
    def layer(self, axis: Any, index: int) -> tuple[Any, Any, Any]:
        """The points of one layer across an axis, as an index: ``lat.layer(Z, -1)`` is the
        top layer, ``lat.layer(X, 0)`` the points at the smallest X."""
        i = _axis_index(axis)
        n = self._counts[i]
        if not -n <= index < n:
            raise IndexError(f"Lattice.layer: index {index} is out of range for {n} layers")
        sel: list[Any] = [slice(None)] * 3
        sel[i] = index
        return tuple(sel)  # type: ignore[return-value]

    @staticmethod
    def _index(index: Any) -> tuple[Any, Any, Any]:
        if not isinstance(index, tuple) or len(index) != 3:
            raise IndexError("Lattice: select points with three indices (i, j, k), e.g. (1, 1, -1), "
                             "(slice(None), 0, 2) or lat.layer(Z, 0)")
        return index  # type: ignore[return-value]

    # -- editing (in place) ---------------------------------------------------
    def move(self, index: Any, offset: VectorLike) -> Lattice:
        """Move the selected points by ``offset``. In place; returns the lattice."""
        index = self._index(index)
        self.points[index] = self.points[index] + np.array(_vec(offset).to_tuple(), dtype=float)
        return self

    def scale(self, index: Any, factor: float | VectorLike, center: VectorLike | None = None) -> Lattice:
        """Scale the selected points about ``center`` (default: their centroid) by ``factor``,
        one number or three (X, Y, Z). In place; returns the lattice."""
        index = self._index(index)
        sel = np.asarray(self.points[index], dtype=float)
        pts = sel.reshape(-1, 3)
        c = pts.mean(axis=0) if center is None else np.array(_vec(center).to_tuple(), dtype=float)
        if isinstance(factor, (int, float, np.floating, np.integer)):
            f = np.full(3, float(factor))
        else:
            f = np.array(_vec(factor).to_tuple(), dtype=float)
        self.points[index] = (c + (pts - c) * f).reshape(sel.shape)
        return self

    def rotate(self, index: Any, axis: Axis, angle: float) -> Lattice:
        """Turn the selected points by ``angle`` degrees about ``axis``. In place; returns the lattice."""
        index = self._index(index)
        sel = np.asarray(self.points[index], dtype=float)
        r, t = _rotation_about(np.array(axis.origin.to_tuple(), dtype=float),
                               _unit(axis.direction, "Lattice.rotate: axis"), angle)
        self.points[index] = (sel.reshape(-1, 3) @ r.T + t).reshape(sel.shape)
        return self

    def reset(self) -> Lattice:
        """Put every point back where it started. In place; returns the lattice."""
        self.points[...] = self._rest
        return self

    def copy(self) -> Lattice:
        """An independent copy."""
        out = Lattice.__new__(Lattice)
        out._origin, out._size, out._counts, out._rest = self._origin, self._size, self._counts, self._rest
        out.points = np.array(self.points, dtype=float)
        return out

    # -- applying -------------------------------------------------------------
    def _spec(self) -> dict:
        pts = np.asarray(self.points, dtype=float)
        if pts.shape != (*self._counts, 3) or not np.all(np.isfinite(pts)):
            raise ValueError("Lattice: points must stay a finite (nx, ny, nz, 3) array")
        return {"kind": "lattice", "origin": list(map(float, self._origin)), "x": [1.0, 0.0, 0.0],
                "y": [0.0, 1.0, 0.0], "z": [0.0, 0.0, 1.0], "size": list(map(float, self._size)),
                "counts": list(self._counts), "points": (pts - self._origin).ravel().tolist()}

    def map(self, point: VectorLike) -> Vector:
        """Where the lattice moves a point."""
        return Vector(k.deform.map_points({"pieces": [self._spec()]}, [_vec(point).to_tuple()])[0])

    def _plan(self, shape: Any, tol: float) -> _Plan:
        return _Plan(shape, {"axis": None, "pieces": [self._spec()], "tolerance": tol}, (0.0, math.inf))

    def apply(self, shape: Any, *, tolerance: float | None = None) -> Any:
        """Deform a part (or a shell) with the lattice; returns the deformed copy.

        The result is exact unless a face's image needs a degree above ``MAX_DEGREE``; such
        faces are within ``tolerance``. Raises ``ModelingError`` when the lattice folds the
        part onto itself (a point moved past its neighbours).
        """
        _check_shape(shape, "lattice")
        plan = self._plan(shape, _tolerance(tolerance))
        _check_folding(shape, plan.spec["pieces"][0])
        return _run(plan, "lattice", shape)

    def __repr__(self) -> str:
        moved = int(np.count_nonzero(np.linalg.norm(self.offsets, axis=-1) > 0))
        nx, ny, nz = self._counts
        return f"Lattice({nx} x {ny} x {nz} points, {moved} moved, box {self.box})"


def _check_folding(shape: Any, piece: dict) -> None:
    """Refuse a lattice that turns space inside out on the part: the Jacobian determinant of
    the map, sampled at the part's vertices, edges and faces, must stay positive."""
    samples = [v.point.to_tuple() for v in shape.vertices()]
    for e in shape.edges():
        samples += [e.point_at(t).to_tuple() for t in (0.25, 0.5, 0.75)]
    fractions = (0.1, 0.3, 0.5, 0.7, 0.9)
    for f in shape.faces():  # a grid of points inside every face
        (u0, v0), (u1, v1) = f._f.uv_domain()
        for a in fractions:
            for b in fractions:
                u, v = u0 + a * (u1 - u0), v0 + b * (v1 - v0)
                if f._f.classify_uv(u, v) != "outside":
                    samples.append(f._f.point_at_uv(u, v))
    if not samples:  # pragma: no cover
        return
    p = np.array(samples, dtype=float)
    h = 1e-4 * max(shape.bbox().diagonal, 1.0)
    steps = np.array([[h, 0, 0], [-h, 0, 0], [0, h, 0], [0, -h, 0], [0, 0, h], [0, 0, -h]])
    q = np.array(k.deform.map_points({"pieces": [piece]}, (p[:, None, :] + steps).reshape(-1, 3).tolist()))
    q = q.reshape(len(p), 6, 3)
    jac = np.stack([q[:, 0] - q[:, 1], q[:, 2] - q[:, 3], q[:, 4] - q[:, 5]], axis=-1) / (2 * h)
    det = np.linalg.det(jac)
    if np.any(det <= 1e-6):
        w = p[int(np.argmin(det))]
        raise ModelingError(f"lattice: the lattice folds the part onto itself near ({w[0]:.4g}, {w[1]:.4g}, {w[2]:.4g}); "
                            "a point was moved past its neighbours. Move the points less, or use more points for "
                            "local changes")
