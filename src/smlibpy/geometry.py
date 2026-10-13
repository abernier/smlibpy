"""Vectors, axes, planes and locations.

These are plain value types: they never touch the kernel, are immutable and cheap
to create. Angles are in degrees everywhere.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any, Iterable, Iterator, NamedTuple, Sequence, Union, overload

import numpy as np

if TYPE_CHECKING:  # pragma: no cover
    from .shapes import Face, Shape

__all__ = [
    "TOLERANCE",
    "Vector",
    "VectorLike",
    "Axis",
    "Plane",
    "Location",
    "Pos",
    "Rot",
    "BoundBox",
    "Hit",
    "X",
    "Y",
    "Z",
]

#: Geometric tolerance used for comparisons (model units).
TOLERANCE = 1e-6

VectorLike = Union["Vector", Sequence[float], np.ndarray]


class Vector:
    """An immutable 3D vector or point.

    ``Vector(1, 2)``, ``Vector(1, 2, 3)``, ``Vector((1, 2, 3))`` and ``Vector(other)``
    are all accepted. Vectors support ``+``, ``-``, ``*`` (by a number), ``/``,
    unary ``-``, ``abs()`` (length), iteration and indexing.
    """

    __slots__ = ("_x", "_y", "_z")

    def __init__(self, *args: float | VectorLike):
        if len(args) == 1:
            v = args[0]
            if isinstance(v, Vector):
                x, y, z = v._x, v._y, v._z
            else:
                seq = list(v)  # type: ignore[arg-type]
                if len(seq) == 2:
                    seq.append(0.0)
                if len(seq) != 3:
                    raise ValueError(f"expected 2 or 3 coordinates, got {len(seq)}")
                x, y, z = seq
        elif len(args) == 2:
            x, y, z = args[0], args[1], 0.0
        elif len(args) == 3:
            x, y, z = args
        elif not args:
            x = y = z = 0.0
        else:
            raise ValueError("Vector takes up to three coordinates")
        self._x, self._y, self._z = float(x), float(y), float(z)  # type: ignore[arg-type]

    # -- access ---------------------------------------------------------------
    @property
    def x(self) -> float:
        return self._x

    @property
    def y(self) -> float:
        return self._y

    @property
    def z(self) -> float:
        return self._z

    def to_tuple(self) -> tuple[float, float, float]:
        return (self._x, self._y, self._z)

    def __iter__(self) -> Iterator[float]:
        yield self._x
        yield self._y
        yield self._z

    def __getitem__(self, i: int) -> float:
        return (self._x, self._y, self._z)[i]

    def __len__(self) -> int:
        return 3

    def __array__(self, dtype=None, copy=None):
        return np.array(self.to_tuple(), dtype=dtype)

    # -- arithmetic -----------------------------------------------------------
    def __add__(self, other: VectorLike) -> Vector:
        o = Vector(other)
        return Vector(self._x + o._x, self._y + o._y, self._z + o._z)

    __radd__ = __add__

    def __sub__(self, other: VectorLike) -> Vector:
        o = Vector(other)
        return Vector(self._x - o._x, self._y - o._y, self._z - o._z)

    def __rsub__(self, other: VectorLike) -> Vector:
        return Vector(other) - self

    def __mul__(self, s: float) -> Vector:
        if isinstance(s, (Vector, tuple, list)):
            raise TypeError("use .dot() or .cross() to multiply two vectors")
        return Vector(self._x * s, self._y * s, self._z * s)

    __rmul__ = __mul__

    def __truediv__(self, s: float) -> Vector:
        return Vector(self._x / s, self._y / s, self._z / s)

    def __neg__(self) -> Vector:
        return Vector(-self._x, -self._y, -self._z)

    def __abs__(self) -> float:
        return self.length

    def __eq__(self, other: object) -> bool:
        try:
            o = Vector(other)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return NotImplemented
        return self.is_close(o)

    def __hash__(self) -> int:
        return hash((round(self._x, 6), round(self._y, 6), round(self._z, 6)))

    def __repr__(self) -> str:
        return f"Vector({_fmt(self._x)}, {_fmt(self._y)}, {_fmt(self._z)})"

    # -- vector algebra -------------------------------------------------------
    @property
    def length(self) -> float:
        return math.sqrt(self._x * self._x + self._y * self._y + self._z * self._z)

    def dot(self, other: VectorLike) -> float:
        o = Vector(other)
        return self._x * o._x + self._y * o._y + self._z * o._z

    def cross(self, other: VectorLike) -> Vector:
        o = Vector(other)
        return Vector(
            self._y * o._z - self._z * o._y,
            self._z * o._x - self._x * o._z,
            self._x * o._y - self._y * o._x,
        )

    def normalized(self) -> Vector:
        n = self.length
        if n < 1e-300:
            raise ValueError("cannot normalize a zero-length vector")
        return self / n

    def distance_to(self, other: VectorLike) -> float:
        return (self - Vector(other)).length

    def angle_to(self, other: VectorLike) -> float:
        """Angle to another vector in degrees (0..180)."""
        o = Vector(other)
        d = self.length * o.length
        if d < 1e-300:
            raise ValueError("angle with a zero-length vector")
        c = max(-1.0, min(1.0, self.dot(o) / d))
        return math.degrees(math.acos(c))

    def is_close(self, other: VectorLike, tol: float = TOLERANCE) -> bool:
        return (self - Vector(other)).length <= tol

    def is_parallel(self, other: VectorLike, angle_tol: float = 1e-4) -> bool:
        """True if both vectors point along the same line (either sense)."""
        a = self.angle_to(other)
        return a <= angle_tol or a >= 180.0 - angle_tol

    def is_perpendicular(self, other: VectorLike, angle_tol: float = 1e-4) -> bool:
        return abs(self.angle_to(other) - 90.0) <= angle_tol

    def rotate(self, axis: Axis | VectorLike, angle: float) -> Vector:
        """Rotate this point about an axis (through the origin for a plain vector)."""
        ax = axis if isinstance(axis, Axis) else Axis((0, 0, 0), axis)
        return Location.about(ax, angle) * self

    def project_to(self, plane: Plane) -> Vector:
        """Orthogonal projection of this point onto a plane."""
        d = (self - plane.origin).dot(plane.z_dir)
        return self - plane.z_dir * d

    def any_perpendicular(self) -> Vector:
        """A unit vector perpendicular to this one."""
        v = self.normalized()
        helper = Vector(1, 0, 0) if abs(v.x) < 0.9 else Vector(0, 1, 0)
        return v.cross(helper).normalized()


def _fmt(v: float) -> str:
    if abs(v) < 5e-13:
        v = 0.0
    s = f"{v:.6g}"
    return s


def _vec(v: VectorLike) -> Vector:
    return v if isinstance(v, Vector) else Vector(v)


class Axis:
    """An infinite line through ``origin`` along ``direction``.

    ``Axis.X``, ``Axis.Y`` and ``Axis.Z`` (also exported as ``X``, ``Y``, ``Z``) are the
    world axes. Axes are used to rotate, revolve, mirror, and to sort or filter shapes.
    """

    __slots__ = ("_origin", "_direction")

    X: Axis
    Y: Axis
    Z: Axis

    def __init__(self, origin: VectorLike = (0, 0, 0), direction: VectorLike = (0, 0, 1)):
        self._origin = _vec(origin)
        self._direction = _vec(direction).normalized()

    @property
    def origin(self) -> Vector:
        return self._origin

    @property
    def direction(self) -> Vector:
        return self._direction

    def __neg__(self) -> Axis:
        return self.reversed()

    def reversed(self) -> Axis:
        return Axis(self._origin, -self._direction)

    def moved(self, loc: Location) -> Axis:
        return Axis(loc * self._origin, loc.rotate_vector(self._direction))

    def at(self, origin: VectorLike) -> Axis:
        """The same direction through another point."""
        return Axis(origin, self._direction)

    def is_parallel(self, other: Axis | VectorLike, angle_tol: float = 1e-4) -> bool:
        d = other.direction if isinstance(other, Axis) else _vec(other)
        return self._direction.is_parallel(d, angle_tol)

    def distance_to(self, point: VectorLike) -> float:
        p = _vec(point) - self._origin
        return (p - self._direction * p.dot(self._direction)).length

    def project(self, point: VectorLike) -> Vector:
        p = _vec(point)
        return self._origin + self._direction * (p - self._origin).dot(self._direction)

    def position_along(self, point: VectorLike) -> float:
        """Signed coordinate of ``point`` along this axis."""
        return (_vec(point) - self._origin).dot(self._direction)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Axis):
            return NotImplemented
        return self._direction.is_close(other._direction) and other.distance_to(self._origin) < TOLERANCE

    def __hash__(self) -> int:
        return hash((self._origin, self._direction))

    def __repr__(self) -> str:
        names = {(1, 0, 0): "X", (0, 1, 0): "Y", (0, 0, 1): "Z"}
        if self._origin.is_close((0, 0, 0)):
            for t, n in names.items():
                if self._direction.is_close(t):
                    return f"Axis.{n}"
        return f"Axis(origin={tuple(map(_fmt_f, self._origin))}, direction={tuple(map(_fmt_f, self._direction))})"


def _fmt_f(v: float) -> float:
    return float(_fmt(v))


Axis.X = Axis((0, 0, 0), (1, 0, 0))
Axis.Y = Axis((0, 0, 0), (0, 1, 0))
Axis.Z = Axis((0, 0, 0), (0, 0, 1))
X, Y, Z = Axis.X, Axis.Y, Axis.Z


def _direction(direction: Axis | VectorLike, what: str) -> Vector:
    """The unit vector of a direction given as an axis (its direction) or as a vector."""
    d = direction.direction if isinstance(direction, Axis) else _vec(direction)
    if not d.length > 0 or not all(math.isfinite(x) for x in d):
        raise ValueError(f"{what}: the direction must not be zero")
    return d.normalized()


class Location:
    """A rigid placement (rotation + translation), stored as a 4x4 matrix.

    Build them with :func:`Pos` and :func:`Rot` and combine with ``*``. Applying a
    location to a shape moves the shape: ``Pos(10, 0, 0) * Rot(z=45) * Box(1, 1, 1)``
    first rotates the box about the world Z axis, then moves it 10 along X.
    """

    __slots__ = ("_m",)

    def __init__(
        self,
        position: VectorLike | np.ndarray | Plane | Location | None = None,
        rotation: VectorLike | None = None,
    ):
        if isinstance(position, Location):
            self._m = position._m
            return
        if isinstance(position, Plane):
            self._m = position.location._m
            return
        if isinstance(position, np.ndarray) and position.shape == (4, 4):
            m = np.array(position, dtype=float)
        else:
            m = np.eye(4)
            if rotation is not None:
                rx, ry, rz = _vec(rotation)
                m[:3, :3] = _rot_xyz(rx, ry, rz)
            if position is not None:
                m[:3, 3] = tuple(_vec(position))  # type: ignore[arg-type]
        m.setflags(write=False)
        self._m = m

    @classmethod
    def about(cls, axis: Axis, angle: float) -> Location:
        """Rotation by ``angle`` degrees about an arbitrary axis."""
        r = _rot_axis(axis.direction, angle)
        m = np.eye(4)
        m[:3, :3] = r
        o = np.array(axis.origin.to_tuple())
        m[:3, 3] = o - r @ o
        return cls(m)

    # -- properties -----------------------------------------------------------
    @property
    def matrix(self) -> np.ndarray:
        """The 4x4 homogeneous matrix (column-vector convention)."""
        return self._m

    @property
    def position(self) -> Vector:
        return Vector(self._m[:3, 3])

    @property
    def rotation(self) -> Vector:
        """Rotation as X, Y, Z angles in degrees (applied in that order about world axes)."""
        r = self._m[:3, :3]
        sy = -r[2, 0]
        sy = max(-1.0, min(1.0, sy))
        y = math.asin(sy)
        if abs(sy) < 1 - 1e-12:
            x = math.atan2(r[2, 1], r[2, 2])
            z = math.atan2(r[1, 0], r[0, 0])
        else:  # gimbal lock
            x = math.atan2(-r[1, 2], r[1, 1])
            z = 0.0
        return Vector(math.degrees(x), math.degrees(y), math.degrees(z))

    @property
    def x_dir(self) -> Vector:
        return Vector(self._m[:3, 0])

    @property
    def y_dir(self) -> Vector:
        return Vector(self._m[:3, 1])

    @property
    def z_dir(self) -> Vector:
        return Vector(self._m[:3, 2])

    @property
    def plane(self) -> Plane:
        """The XY plane moved by this location."""
        return Plane(self.position, self.x_dir, self.z_dir)

    def inverse(self) -> Location:
        r = self._m[:3, :3]
        m = np.eye(4)
        m[:3, :3] = r.T
        m[:3, 3] = -r.T @ self._m[:3, 3]
        return Location(m)

    def rotate_vector(self, v: VectorLike) -> Vector:
        return Vector(self._m[:3, :3] @ np.array(_vec(v).to_tuple()))

    # -- composition ----------------------------------------------------------
    @overload
    def __mul__(self, other: Location) -> Location: ...
    @overload
    def __mul__(self, other: Vector) -> Vector: ...
    @overload
    def __mul__(self, other: "Shape") -> "Shape": ...
    def __mul__(self, other):  # type: ignore[no-untyped-def]
        if isinstance(other, Location):
            return Location(self._m @ other._m)
        if isinstance(other, Vector) or (isinstance(other, (tuple, list)) and len(other) in (2, 3)
                                         and all(isinstance(c, (int, float)) for c in other)):
            p = np.array((*_vec(other).to_tuple(), 1.0))
            return Vector((self._m @ p)[:3])
        if isinstance(other, Axis):
            return other.moved(self)
        if isinstance(other, Plane):
            return other.moved(self)
        if isinstance(other, list):
            # keep the type of a pattern (Locations) or a selection (ShapeList)
            from .locations import Locations
            from .shapes import ShapeList

            if isinstance(other, Locations):
                return Locations(*(self * o for o in other))
            if isinstance(other, ShapeList):
                return ShapeList(self * o for o in other)
        if isinstance(other, (list, tuple)):
            return [self * o for o in other]
        moved = getattr(other, "moved", None)
        if moved is None:
            return NotImplemented
        return moved(self)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Location):
            return NotImplemented
        return bool(np.allclose(self._m, other._m, atol=TOLERANCE))

    def __hash__(self) -> int:
        return hash(tuple(np.round(self._m, 6).ravel()))

    def __repr__(self) -> str:
        p = self.position
        r = self.rotation
        if r.is_close((0, 0, 0)):
            return f"Pos({_fmt(p.x)}, {_fmt(p.y)}, {_fmt(p.z)})"
        return f"Location(position=({_fmt(p.x)}, {_fmt(p.y)}, {_fmt(p.z)}), rotation=({_fmt(r.x)}, {_fmt(r.y)}, {_fmt(r.z)}))"


def _rot_axis(axis: Vector, angle: float) -> np.ndarray:
    a = math.radians(angle)
    x, y, z = axis.normalized()
    c, s = math.cos(a), math.sin(a)
    C = 1 - c
    return np.array([
        [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
        [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
        [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
    ])


def _rot_xyz(rx: float, ry: float, rz: float) -> np.ndarray:
    return _rot_axis(Vector(0, 0, 1), rz) @ _rot_axis(Vector(0, 1, 0), ry) @ _rot_axis(Vector(1, 0, 0), rx)


def Pos(x: float | VectorLike = 0.0, y: float = 0.0, z: float = 0.0) -> Location:
    """A translation. ``Pos(10, 0, 5)`` or ``Pos((10, 0, 5))`` or ``Pos(vector)``."""
    if not isinstance(x, (int, float)):
        return Location(_vec(x))
    return Location((x, y, z))


def Rot(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> Location:
    """A rotation in degrees about the world X, then Y, then Z axis."""
    if not isinstance(x, (int, float)):
        x, y, z = _vec(x)
    return Location(None, (x, y, z))


class Plane:
    """A coordinate system: an origin, an x direction and a normal (``z_dir``).

    Planes are where sketches live and where parts are placed. Named planes:
    ``Plane.XY`` (= ``Plane.top``), ``Plane.XZ`` (= ``Plane.front``), ``Plane.YZ``
    (= ``Plane.right``), plus ``back``, ``left`` and ``bottom``. Their local Y
    axis points up (world +Z) for the side views, so a sketch drawn "upwards" stands
    up on the front plane.

    A planar :class:`~smlibpy.Face` converts to a plane at its center with its
    outward normal: ``Plane(face)`` or ``face.plane``.
    """

    __slots__ = ("_origin", "_x", "_y", "_z")

    XY: Plane
    YZ: Plane
    ZX: Plane
    XZ: Plane
    YX: Plane
    ZY: Plane
    top: Plane
    bottom: Plane
    front: Plane
    back: Plane
    left: Plane
    right: Plane

    def __init__(
        self,
        origin: VectorLike | "Face" | Location | Plane = (0, 0, 0),
        x_dir: VectorLike | None = None,
        z_dir: VectorLike = (0, 0, 1),
    ):
        if isinstance(origin, Plane):
            self._origin, self._x, self._y, self._z = origin._origin, origin._x, origin._y, origin._z
            return
        if isinstance(origin, Location):
            p = origin.plane
            self._origin, self._x, self._y, self._z = p._origin, p._x, p._y, p._z
            return
        if hasattr(origin, "_plane_of_face"):
            p = origin._plane_of_face()  # type: ignore[union-attr]
            self._origin, self._x, self._y, self._z = p._origin, p._x, p._y, p._z
            return
        z = _vec(z_dir).normalized()
        if x_dir is None:
            x = _default_x_dir(z)
        else:
            x = _vec(x_dir)
            x = (x - z * x.dot(z))
            if x.length < 1e-12:
                raise ValueError("x_dir is parallel to the plane normal")
            x = x.normalized()
        self._origin = _vec(origin)  # type: ignore[arg-type]
        self._x = x
        self._z = z
        self._y = z.cross(x)

    # -- properties -----------------------------------------------------------
    @property
    def origin(self) -> Vector:
        return self._origin

    @property
    def x_dir(self) -> Vector:
        return self._x

    @property
    def y_dir(self) -> Vector:
        return self._y

    @property
    def z_dir(self) -> Vector:
        """The plane normal."""
        return self._z

    normal = z_dir

    @property
    def location(self) -> Location:
        """The location that maps the world XY plane onto this plane."""
        m = np.eye(4)
        m[:3, 0] = self._x.to_tuple()
        m[:3, 1] = self._y.to_tuple()
        m[:3, 2] = self._z.to_tuple()
        m[:3, 3] = self._origin.to_tuple()
        return Location(m)

    # -- derived planes -------------------------------------------------------
    def offset(self, distance: float) -> Plane:
        """This plane moved ``distance`` along its normal."""
        return Plane(self._origin + self._z * distance, self._x, self._z)

    def shifted(self, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> Plane:
        """This plane moved within its own coordinates."""
        return Plane(self.from_local((x, y, z)), self._x, self._z)

    def flipped(self) -> Plane:
        """The same plane seen from the other side (normal reversed, x kept)."""
        return Plane(self._origin, self._x, -self._z)

    def rotated(self, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> Plane:
        """Rotate about the plane's own X, then Y, then Z axis (degrees)."""
        return Plane(self.location * Rot(x, y, z))

    def moved(self, loc: Location) -> Plane:
        return Plane(loc * self._origin, loc.rotate_vector(self._x), loc.rotate_vector(self._z))

    def at(self, origin: VectorLike) -> Plane:
        """The same orientation through another origin."""
        return Plane(origin, self._x, self._z)

    # -- coordinates ----------------------------------------------------------
    def to_local(self, point: VectorLike) -> Vector:
        d = _vec(point) - self._origin
        return Vector(d.dot(self._x), d.dot(self._y), d.dot(self._z))

    def from_local(self, point: VectorLike) -> Vector:
        p = _vec(point)
        return self._origin + self._x * p.x + self._y * p.y + self._z * p.z

    def contains(self, point: VectorLike, tol: float = TOLERANCE) -> bool:
        return abs(self.to_local(point).z) <= tol

    def distance_to(self, point: VectorLike) -> float:
        """Signed distance of a point above the plane."""
        return self.to_local(point).z

    def project(self, point: VectorLike) -> Vector:
        return _vec(point).project_to(self)

    def is_coplanar(self, other: Plane, tol: float = TOLERANCE) -> bool:
        return self._z.is_parallel(other._z) and abs(self.distance_to(other._origin)) <= tol

    # -- placement ------------------------------------------------------------
    def __mul__(self, other):  # type: ignore[no-untyped-def]
        """``Plane * shape`` places a shape (usually a sketch drawn on XY) onto this plane.

        ``Plane * Location`` gives the plane's location composed with ``Location``.
        """
        if isinstance(other, Location):
            return self.location * other
        if isinstance(other, (list, tuple)):
            return self.location * other
        return self.location * other

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Plane):
            return NotImplemented
        return (self._origin.is_close(other._origin) and self._x.is_close(other._x)
                and self._z.is_close(other._z))

    def __hash__(self) -> int:
        return hash((self._origin, self._x, self._z))

    def __repr__(self) -> str:
        for name in ("XY", "XZ", "YZ", "ZX", "YX", "ZY", "back", "left", "bottom"):
            if self == getattr(Plane, name):
                return f"Plane.{name}"
        o, x, z = self._origin, self._x, self._z
        return (f"Plane(origin=({_fmt(o.x)}, {_fmt(o.y)}, {_fmt(o.z)}), "
                f"x_dir=({_fmt(x.x)}, {_fmt(x.y)}, {_fmt(x.z)}), z_dir=({_fmt(z.x)}, {_fmt(z.y)}, {_fmt(z.z)}))")


def _default_x_dir(z: Vector) -> Vector:
    """The x direction a plane gets when none is given.

    Vertical planes keep their local Y pointing up (world +Z), so sketches placed on
    side faces stand upright. Other planes take the projection of world X (world Y when
    the normal is close to X).
    """
    if abs(z.z) < 1e-9:
        return Vector(0, 0, 1).cross(z).normalized()
    ref = Vector(1, 0, 0) if abs(z.x) < 0.999 else Vector(0, 1, 0)
    return (ref - z * ref.dot(z)).normalized()


Plane.XY = Plane((0, 0, 0), (1, 0, 0), (0, 0, 1))
Plane.YZ = Plane((0, 0, 0), (0, 1, 0), (1, 0, 0))
Plane.ZX = Plane((0, 0, 0), (0, 0, 1), (0, 1, 0))
Plane.XZ = Plane((0, 0, 0), (1, 0, 0), (0, -1, 0))
Plane.YX = Plane((0, 0, 0), (0, 1, 0), (0, 0, -1))
Plane.ZY = Plane((0, 0, 0), (0, 0, 1), (-1, 0, 0))
Plane.top = Plane.XY
Plane.bottom = Plane((0, 0, 0), (1, 0, 0), (0, 0, -1))
Plane.front = Plane.XZ
Plane.back = Plane((0, 0, 0), (-1, 0, 0), (0, 1, 0))
Plane.right = Plane.YZ
Plane.left = Plane((0, 0, 0), (0, -1, 0), (-1, 0, 0))


class Hit(NamedTuple):
    """Where a ray meets a shape or a mesh (see ``raycast``).

    Attributes:
        point: The point where the ray meets the surface.
        distance: How far along the ray, from its start.
        normal: The outward unit normal of the surface there (of the face, or the triangle).
        face: The face that was hit (shapes), or ``None``.
        triangle: The index of the triangle that was hit (meshes), or ``None``.
    """

    point: "Vector"
    distance: float
    normal: "Vector"
    face: Any = None
    triangle: int | None = None


class BoundBox:
    """An axis-aligned bounding box."""

    __slots__ = ("min", "max")

    def __init__(self, min: VectorLike, max: VectorLike):  # noqa: A002
        self.min = _vec(min)
        self.max = _vec(max)

    @classmethod
    def of_points(cls, points: Iterable[VectorLike]) -> BoundBox:
        arr = np.array([tuple(_vec(p)) for p in points], dtype=float)
        return cls(arr.min(axis=0), arr.max(axis=0))

    @property
    def size(self) -> Vector:
        return self.max - self.min

    @property
    def center(self) -> Vector:
        return (self.min + self.max) * 0.5

    @property
    def diagonal(self) -> float:
        return self.size.length

    def union(self, other: BoundBox) -> BoundBox:
        return BoundBox(
            (min(self.min.x, other.min.x), min(self.min.y, other.min.y), min(self.min.z, other.min.z)),
            (max(self.max.x, other.max.x), max(self.max.y, other.max.y), max(self.max.z, other.max.z)),
        )

    def contains(self, point: VectorLike, tol: float = TOLERANCE) -> bool:
        p = _vec(point)
        return all(lo - tol <= c <= hi + tol for c, lo, hi in zip(p, self.min, self.max))

    def __iter__(self) -> Iterator[Vector]:
        yield self.min
        yield self.max

    def __repr__(self) -> str:
        return f"BoundBox(min={tuple(map(_fmt_f, self.min))}, max={tuple(map(_fmt_f, self.max))})"
