"""Shapes: vertices, edges, wires, faces, sketches, shells and parts.

Every shape is an immutable value. Operations never modify a shape; they return a
new one. Faces, edges and vertices taken from a body (``part.faces()``) stay valid
for as long as you hold them and can be passed back to operations on that body
(``part.fillet(part.edges().parallel_to(Z), 2)``).
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any, Callable, Iterable, Iterator, Sequence, TypeVar, Union, overload

import numpy as np

from ._kernel import BrepHandle, CurveHandle, KernelError, ModelingError, ext, k, kernel_call
from .geometry import TOLERANCE, Axis, BoundBox, Location, Plane, Rot, Vector, VectorLike, X, Y, Z, _direction, _vec

if TYPE_CHECKING:  # pragma: no cover
    from .mesh import Mesh

__all__ = [
    "Shape",
    "ShapeList",
    "Vertex",
    "Edge",
    "Wire",
    "Face",
    "Shell",
    "Sketch",
    "Part",
    "MassProperties",
]

#: Relative accuracy of areas, volumes, centers and inertia: volumes and areas to
#: ``ACCURACY`` of their value, centers to ``ACCURACY`` times the size of the body (its
#: bounding box diagonal), inertia to ``ACCURACY`` times its largest principal moment.
#: ``mass_properties(accuracy=...)`` takes another.
ACCURACY = 1e-7

# The integration (src/cpp/measure.cpp) estimates its error and refines until the estimate
# is below accuracy * _MARGIN. The estimates are pessimistic for smooth integrands; with the
# margin, the errors measured against closed forms and converged references are 100 to
# 10^6 times below the accuracy asked for.
_MARGIN = 0.1

# Faces that meet only within a tolerance leave gaps, and the volume then depends on the field
# it is integrated with (the kernel's (0, 0, z) against (x, 0, 0) and (0, y, 0)): by 1e-7 to 3e-6
# for fitted chamfers, sweeps cut by planes and shells of curved faces. Beyond _GAPS (and the
# accuracy asked for) the volume measure says so.
_GAPS = 1e-5

S = TypeVar("S", bound="Shape")


def _t(p: Sequence[float]) -> tuple[float, float, float]:
    return (float(p[0]), float(p[1]), float(p[2]))


# =============================================================================
# Shape
# =============================================================================
class Shape:
    """Base class of all shapes."""

    __slots__ = ()

    # -- topology -------------------------------------------------------------
    def vertices(self) -> ShapeList[Vertex]:
        """All vertices of this shape."""
        raise NotImplementedError

    def edges(self) -> ShapeList[Edge]:
        """All edges of this shape."""
        raise NotImplementedError

    def wires(self) -> ShapeList[Wire]:
        """All wires (closed edge loops of faces, or the shape itself if it is a wire)."""
        return ShapeList()

    def faces(self) -> ShapeList[Face]:
        """All faces of this shape."""
        return ShapeList()

    # -- placement ------------------------------------------------------------
    def _transformed(self: S, m: np.ndarray) -> S:
        raise NotImplementedError

    def moved(self: S, location: Location) -> S:
        """A copy of this shape moved by a location (``location * shape``)."""
        return self._transformed(location.matrix)

    def translate(self: S, x: float | VectorLike = 0.0, y: float = 0.0, z: float = 0.0) -> S:
        """A copy moved by ``(x, y, z)``."""
        v = _vec(x) if not isinstance(x, (int, float)) else Vector(x, y, z)
        m = np.eye(4)
        m[:3, 3] = v.to_tuple()
        return self._transformed(m)

    def rotate(self: S, axis: Axis = Z, angle: float = 0.0) -> S:
        """A copy rotated by ``angle`` degrees about ``axis``."""
        return self._transformed(Location.about(axis, angle).matrix)

    def mirror(self: S, plane: Plane | Face = Plane.XZ) -> S:
        """A mirrored copy (reflection in ``plane``, a plane or a planar face; by default the
        XZ plane, which flips Y)."""
        plane = _as_plane(plane)
        n = np.array(plane.z_dir.to_tuple())
        o = np.array(plane.origin.to_tuple())
        m = np.eye(4)
        m[:3, :3] -= 2.0 * np.outer(n, n)
        m[:3, 3] = 2.0 * n * o.dot(n)
        return self._transformed(m)

    def scale(self: S, factor: float | VectorLike, center: VectorLike = (0, 0, 0)) -> S:
        """A scaled copy. ``factor`` is a number or per-axis factors ``(sx, sy, sz)``, none of
        them zero (``ValueError``: that would flatten the shape)."""
        f = (factor, factor, factor) if isinstance(factor, (int, float)) else tuple(_vec(factor))
        if not all(math.isfinite(x) and x != 0 for x in f):
            raise ValueError(f"scale: every factor must be finite and not zero (got {factor!r})")
        c = np.array(_vec(center).to_tuple())
        m = np.eye(4)
        m[:3, :3] = np.diag(f)
        m[:3, 3] = c - np.diag(f) @ c
        return self._transformed(m)

    def on(self: S, target: Plane | Face | Location | ShapeList | Sequence[Any]) -> S:
        """Place this shape, designed around the world XY plane, onto a plane or face.

        The shape's origin goes to the plane origin (a face's center), its X axis to the
        plane's X direction and its Z axis to the plane normal. ``sketch.on(face)``
        is the usual way to draw on a face.
        """
        return self.moved(_as_plane(target).location)

    def __rmul__(self, other: Any) -> Any:
        if isinstance(other, (Location, Plane)):
            return other * self
        return NotImplemented

    # -- measurement ----------------------------------------------------------
    def bbox(self) -> BoundBox:
        """Tight axis-aligned bounding box."""
        raise NotImplementedError

    def center(self) -> Vector:
        """Center of mass (centroid) of the shape."""
        raise NotImplementedError

    # -- output ---------------------------------------------------------------
    def mesh(self, tolerance: float | None = None, angle: float = 15.0) -> "Mesh":
        """Triangulate the shape (see :func:`smlibpy.mesh.tessellate`)."""
        from .mesh import tessellate

        return tessellate(self, tolerance=tolerance, angle=angle)

    def show(self, **kwargs: Any) -> Any:
        """Show the shape in the browser viewer (see :func:`smlibpy.show`)."""
        from .viewer import show

        return show(self, **kwargs)

    def _repr_html_(self) -> str:
        from .viewer import notebook_html

        return notebook_html(self)

    def export(self, path: str, **kwargs: Any) -> None:
        """Write the shape to a file; the format follows the extension (step, stl, glb, ...)."""
        from .exporters import export

        export(self, path, **kwargs)


def _as_plane(target: Any) -> Plane:
    if isinstance(target, Plane):
        return target
    if isinstance(target, Location):
        return target.plane
    if isinstance(target, ShapeList):
        return _as_plane(target.one())
    if isinstance(target, Face):
        return target.plane
    if isinstance(target, Sketch):
        return target.plane
    raise TypeError(f"cannot use {type(target).__name__} as a plane")


# =============================================================================
# ShapeList: selection
# =============================================================================
T = TypeVar("T", bound=Shape)

SortKey = Union[Axis, str, Callable[[Any], float]]


def _key_fn(key: SortKey) -> Callable[[Any], float]:
    if isinstance(key, Axis):
        ax = key
        return lambda s: ax.position_along(s.center())
    if callable(key):
        return key  # type: ignore[return-value]
    if isinstance(key, str):
        name = key.lower()
        if name in ("length", "area", "volume", "radius"):
            return lambda s: getattr(s, name)
        if name in ("x", "y", "z"):
            ax = {"x": X, "y": Y, "z": Z}[name]
            return lambda s: ax.position_along(s.center())
        if name in ("size", "measure"):
            return _measure
        if name == "distance":
            raise ValueError("use .sort_by_distance(point)")
    raise TypeError(f"cannot sort by {key!r}")


def _measure(s: Any) -> float:
    for name in ("volume", "area", "length"):
        v = getattr(s, name, None)
        if v is not None:
            try:
                return float(v)
            except KernelError:
                continue
    return 0.0


class ShapeList(list[T]):
    """A list of shapes with selection helpers.

    Every selector returns a new :class:`ShapeList`, so selectors chain::

        part.edges().parallel_to(Z).max_by(X)
        part.faces().planar().facing(-Z)

    A one-element list can be used wherever a single shape is expected
    (``sketch.on(part.faces().top())``). Use :meth:`one` to require exactly one.
    """

    # -- picking --------------------------------------------------------------
    def one(self) -> T:
        """The only element; raises if the list does not hold exactly one shape."""
        if len(self) != 1:
            raise ValueError(f"expected exactly one shape, got {len(self)}"
                             + (" - narrow the selection or use [0]" if self else ""))
        return self[0]

    @property
    def first(self) -> T:
        if not self:
            raise IndexError("empty selection")
        return self[0]

    @property
    def last(self) -> T:
        if not self:
            raise IndexError("empty selection")
        return self[-1]

    # -- ordering -------------------------------------------------------------
    def sort_by(self, key: SortKey = Z, reverse: bool = False) -> ShapeList[T]:
        """Sort by position along an axis, by ``"length"``/``"area"``/``"volume"``/``"radius"``,
        or by any function of a shape."""
        f = _key_fn(key)
        return ShapeList(sorted(self, key=f, reverse=reverse))

    def filter_by(self, criterion: Axis | str | Callable[[T], bool]) -> ShapeList[T]:
        """``parallel_to(axis)``, ``of_type(name)`` or ``filter(predicate)``, depending on the
        argument."""
        if isinstance(criterion, Axis):
            return self.parallel_to(criterion)
        if isinstance(criterion, str):
            return self.of_type(criterion)
        return self.filter(criterion)

    # operators: > sort ascending, < sort descending, >> top group, << bottom group
    def __gt__(self, key: SortKey) -> ShapeList[T]:  # type: ignore[override]
        return self.sort_by(key)

    def __lt__(self, key: SortKey) -> ShapeList[T]:  # type: ignore[override]
        return self.sort_by(key, reverse=True)

    def __rshift__(self, key: SortKey) -> ShapeList[T]:
        return self.max_by(key)

    def __lshift__(self, key: SortKey) -> ShapeList[T]:
        return self.min_by(key)

    def sort_by_distance(self, point: VectorLike, reverse: bool = False) -> ShapeList[T]:
        p = _vec(point)
        return ShapeList(sorted(self, key=lambda s: s.center().distance_to(p), reverse=reverse))

    def group_by(self, key: SortKey = Z, tol: float = 1e-4) -> list[ShapeList[T]]:
        """Group shapes with equal key (within ``tol``), groups in ascending key order."""
        f = _key_fn(key)
        pairs = sorted(((f(s), s) for s in self), key=lambda p: p[0])
        groups: list[ShapeList[T]] = []
        last = None
        for v, s in pairs:
            if last is None or abs(v - last) > tol:
                groups.append(ShapeList())
                last = v
            groups[-1].append(s)
        return groups

    def max_by(self, key: SortKey = Z, tol: float = 1e-4) -> ShapeList[T]:
        """The shapes with the largest key (all of them, if several tie)."""
        groups = self.group_by(key, tol)
        return groups[-1] if groups else ShapeList()

    def min_by(self, key: SortKey = Z, tol: float = 1e-4) -> ShapeList[T]:
        """The shapes with the smallest key (all of them, if several tie)."""
        groups = self.group_by(key, tol)
        return groups[0] if groups else ShapeList()

    def top(self) -> ShapeList[T]:
        """Highest shapes (largest Z)."""
        return self.max_by(Z)

    def bottom(self) -> ShapeList[T]:
        """Lowest shapes (smallest Z)."""
        return self.min_by(Z)

    def right(self) -> ShapeList[T]:
        """Shapes furthest along +X."""
        return self.max_by(X)

    def left(self) -> ShapeList[T]:
        """Shapes furthest along -X."""
        return self.min_by(X)

    def back(self) -> ShapeList[T]:
        """Shapes furthest along +Y."""
        return self.max_by(Y)

    def front(self) -> ShapeList[T]:
        """Shapes furthest along -Y."""
        return self.min_by(Y)

    def largest(self) -> T:
        """The biggest shape by volume, area or length."""
        if not self:
            raise IndexError("empty selection")
        return max(self, key=_measure)

    def smallest(self) -> T:
        """The smallest shape by volume, area or length."""
        if not self:
            raise IndexError("empty selection")
        return min(self, key=_measure)

    def nearest(self, point: VectorLike) -> T:
        """The shape whose center is closest to ``point``."""
        return self.sort_by_distance(point)[0]

    # -- filtering ------------------------------------------------------------
    def filter(self, predicate: Callable[[T], bool]) -> ShapeList[T]:
        """Keep the shapes for which ``predicate(shape)`` is true."""
        return ShapeList(s for s in self if predicate(s))

    def of_type(self, *geom_types: str) -> ShapeList[T]:
        """Keep shapes of the given geometry types, e.g. ``"line"``, ``"circle"``,
        ``"plane"``, ``"cylinder"``, ``"bspline"``."""
        wanted = {g.lower() for g in geom_types}
        return ShapeList(s for s in self if getattr(s, "geom_type", None) in wanted)

    def lines(self) -> ShapeList[T]:
        """Straight edges (also straight B-spline edges, such as the edges of a chamfer)."""
        return ShapeList(s for s in self if isinstance(s, Edge) and s._is_straight())

    def circles(self) -> ShapeList[T]:
        """Circular edges (full circles and arcs)."""
        return self.of_type("circle")

    def planar(self) -> ShapeList[T]:
        """Planar faces (also flat B-spline faces)."""
        return ShapeList(s for s in self if isinstance(s, Face) and s.is_planar)

    def cylinders(self) -> ShapeList[T]:
        """Cylindrical faces."""
        return self.of_type("cylinder")

    def parallel_to(self, axis: Axis | VectorLike) -> ShapeList[T]:
        """Straight edges along ``axis``, or planar faces whose normal is along ``axis``."""
        d = _direction(axis, "parallel_to")
        return ShapeList(s for s in self if _direction_of(s) is not None and _direction_of(s).is_parallel(d))

    def perpendicular_to(self, axis: Axis | VectorLike) -> ShapeList[T]:
        """Straight edges perpendicular to ``axis``, or planar faces containing it."""
        d = _direction(axis, "perpendicular_to")
        return ShapeList(s for s in self if _direction_of(s) is not None and _direction_of(s).is_perpendicular(d))

    def facing(self, direction: Axis | VectorLike, max_angle: float = 1e-3) -> ShapeList[T]:
        """Faces whose outward normal points along ``direction`` (within ``max_angle`` degrees).

        A curved face counts only when its normal does so everywhere on the face: the wall of a
        hole or a boss faces no direction, and a fillet only with a ``max_angle`` that takes in
        all its normals.
        """
        from .draft import _range

        d = _direction(direction, "facing")
        out = ShapeList()
        for s in self:
            if isinstance(s, Face):
                try:
                    if s.geom_type == "plane":
                        ok = s.normal_at().angle_to(d) <= max_angle
                    else:
                        # One normal first: most curved faces turn away from d there already.
                        # Then the least n . d over the face.
                        ok = (s.normal_at(s.interior_point()).angle_to(d) <= max_angle
                              and math.degrees(math.acos(_range(s, d)[0])) <= max_angle)
                    if ok:
                        out.append(s)
                except (KernelError, ValueError):
                    pass
        return out

    def convex(self) -> ShapeList[T]:
        """Edges on outside corners (material angle below 180 degrees), and the outside
        corners of a sketch (vertices where the region's angle is below 180 degrees)."""
        return ShapeList(s for s in self if _convexity(s) == "convex")

    def concave(self) -> ShapeList[T]:
        """Edges on inside corners (material angle above 180 degrees), and the inside
        corners of a sketch."""
        return ShapeList(s for s in self if _convexity(s) == "concave")

    def smooth(self) -> ShapeList[T]:
        """Edges where two faces meet tangentially, such as the borders of a fillet, and the
        vertices of a sketch where two edges meet tangentially."""
        return ShapeList(s for s in self if _convexity(s) == "smooth")

    def fillets(self, max_radius: float | None = None) -> ShapeList[T]:
        """Fillet faces: rounds of convex edges and fillets of concave ones, found by geometry
        (with the corner patches where fillets meet), up to ``max_radius``. See
        :mod:`smlibpy.defeature`."""
        from .defeature import fillet_faces

        return fillet_faces(self, max_radius)  # type: ignore[return-value]

    def within(self, box: BoundBox) -> ShapeList[T]:
        """Shapes whose bounding box lies inside ``box``."""
        return ShapeList(s for s in self if box.contains(s.bbox().min) and box.contains(s.bbox().max))

    def at(self, point: VectorLike, tol: float = 1e-4) -> ShapeList[T]:
        """Shapes passing through ``point`` (vertices at, edges/faces touching it)."""
        p = _vec(point)
        return ShapeList(s for s in self if s.distance_to(p) <= tol)  # type: ignore[attr-defined]

    # -- set operations and expansion ----------------------------------------
    def __add__(self, other: Iterable[T]) -> ShapeList[T]:  # type: ignore[override]
        return ShapeList(list.__add__(self, list(other)))

    def __or__(self, other: Iterable[T]) -> ShapeList[T]:  # type: ignore[override]
        out = ShapeList(self)
        for s in other:
            if s not in out:
                out.append(s)
        return out

    def __sub__(self, other: Iterable[T]) -> ShapeList[T]:
        o = list(other)
        return ShapeList(s for s in self if s not in o)

    def __and__(self, other: Iterable[T]) -> ShapeList[T]:
        o = list(other)
        return ShapeList(s for s in self if s in o)

    def __getitem__(self, i):  # type: ignore[override]
        r = super().__getitem__(i)
        return ShapeList(r) if isinstance(i, slice) else r

    def vertices(self) -> ShapeList[Vertex]:
        return _unique(v for s in self for v in s.vertices())

    def edges(self) -> ShapeList[Edge]:
        return _unique(e for s in self for e in s.edges())

    def faces(self) -> ShapeList[Face]:
        return _unique(f for s in self for f in s.faces())

    def wires(self) -> ShapeList[Wire]:
        return ShapeList(w for s in self for w in s.wires())

    def center(self) -> Vector:
        """Average of the members' centers."""
        if not self:
            raise IndexError("empty selection")
        c = Vector()
        for s in self:
            c = c + s.center()
        return c / len(self)

    def bbox(self) -> BoundBox:
        if not self:
            raise IndexError("empty selection")
        b = self[0].bbox()
        for s in self[1:]:
            b = b.union(s.bbox())
        return b

    # -- placement of the whole list -------------------------------------------
    def moved(self, location: Location) -> ShapeList[T]:
        return ShapeList(s.moved(location) for s in self)

    def on(self, target: Any) -> ShapeList[T]:
        """Every shape placed onto a plane or face (see :meth:`Shape.on`)."""
        loc = _as_plane(target).location
        return ShapeList(s.moved(loc) for s in self)

    def translate(self, x: float | VectorLike = 0.0, y: float = 0.0, z: float = 0.0) -> ShapeList[T]:
        return ShapeList(s.translate(x, y, z) for s in self)

    def rotate(self, axis: Axis = Z, angle: float = 0.0) -> ShapeList[T]:
        return ShapeList(s.rotate(axis, angle) for s in self)

    def __rmul__(self, other: Any) -> Any:
        if isinstance(other, (Location, Plane)):
            return ShapeList(other * s for s in self)
        return NotImplemented

    def __repr__(self) -> str:
        if len(self) > 6:
            return f"ShapeList([{', '.join(map(repr, self[:3]))}, ... {len(self)} shapes])"
        return f"ShapeList({list.__repr__(self)})"


def _convexity(s: Any) -> str | None:
    if isinstance(s, Edge):
        return s.convexity
    if isinstance(s, Vertex) and isinstance(s._owner, Sketch):
        return s.convexity
    return None


def _unique(items: Iterable[T]) -> ShapeList[T]:
    out: ShapeList[T] = ShapeList()
    seen: set[Any] = set()
    for s in items:
        key = s._identity() if hasattr(s, "_identity") else id(s)
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out


def _direction_of(s: Any) -> Vector | None:
    if isinstance(s, Edge):
        return s.direction if s._is_straight() else None
    if isinstance(s, Face):
        return s.normal_at() if s.is_planar else None
    if isinstance(s, (Sketch,)):
        return s.plane.z_dir
    return None


# =============================================================================
# Vertex
# =============================================================================
class Vertex(Shape):
    """A point. Vertices of bodies come from ``.vertices()``; ``Vertex(x, y, z)`` makes one."""

    __slots__ = ("_owner", "_v", "_p")

    def __init__(self, x: float | VectorLike = 0.0, y: float = 0.0, z: float = 0.0):
        self._owner = None
        self._v = None
        self._p = _vec(x) if not isinstance(x, (int, float)) else Vector(x, y, z)

    @classmethod
    def _of(cls, owner: Any, kvertex: Any) -> Vertex:
        v = cls.__new__(cls)
        v._owner, v._v, v._p = owner, kvertex, Vector(kvertex.point())
        return v

    @property
    def point(self) -> Vector:
        return self._p

    @property
    def x(self) -> float:
        return self._p.x

    @property
    def y(self) -> float:
        return self._p.y

    @property
    def z(self) -> float:
        return self._p.z

    def center(self) -> Vector:
        return self._p

    def bbox(self) -> BoundBox:
        return BoundBox(self._p, self._p)

    def vertices(self) -> ShapeList[Vertex]:
        return ShapeList([self])

    def edges(self) -> ShapeList[Edge]:
        if self._v is None:
            return ShapeList()
        return ShapeList(Edge._of(self._owner, e) for e in self._v.edges())

    def faces(self) -> ShapeList[Face]:
        if self._v is None:
            return ShapeList()
        return ShapeList(Face(self._owner, f) for f in self._v.faces())

    def distance_to(self, other: VectorLike | Shape) -> float:
        if isinstance(other, Shape):
            return other.distance_to(self._p)  # type: ignore[attr-defined]
        return self._p.distance_to(other)

    @property
    def convexity(self) -> str:
        """For a corner of a sketch: ``"convex"`` where the region's angle is below 180
        degrees (an outside corner), ``"concave"`` above (an inside corner, also every corner
        of a square hole), ``"smooth"`` where the two edges meet tangentially."""
        if not isinstance(self._owner, Sketch):
            raise ValueError("convexity is defined for the corners of a sketch; for a part, select its edges "
                             "(part.edges().convex())")
        from ._regions import corner_kind

        return corner_kind(self._owner, self._p)

    def _transformed(self, m: np.ndarray) -> Vertex:
        return Vertex(Vector((m @ np.array((*self._p.to_tuple(), 1.0)))[:3]))

    def _identity(self) -> Any:
        return ("v", id(self._v)) if self._v is not None else ("p", self._p.to_tuple())

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Vertex):
            return NotImplemented
        if self._v is not None and other._v is not None:
            return self._v is other._v
        return self._p.is_close(other._p)

    def __hash__(self) -> int:
        return hash(self._identity())

    def __iter__(self) -> Iterator[float]:
        return iter(self._p)

    def __repr__(self) -> str:
        return f"Vertex({self._p.x:.6g}, {self._p.y:.6g}, {self._p.z:.6g})"


# =============================================================================
# Edge
# =============================================================================
class Edge(Shape):
    """A bounded curve: a line segment, an arc, a circle, an ellipse or a NURBS curve.

    Edges come from bodies (``part.edges()``) or from curve constructors such as
    :func:`~smlibpy.Line`, :func:`~smlibpy.Arc` and :func:`~smlibpy.Spline`.
    Parameters along an edge (``point_at(t)``) run from 0 at the start to 1 at the end,
    proportional to arc length.
    """

    __slots__ = ("_owner", "_e", "_c", "_rev", "_cache")

    def __init__(self) -> None:  # use the constructors
        raise TypeError("create edges with Line(), Arc(), Spline(), ... or take them from a shape")

    @classmethod
    def _of(cls, owner: Any, kedge: Any, reversed: bool = False) -> Edge:
        e = cls.__new__(cls)
        e._owner, e._e, e._c, e._rev, e._cache = owner, kedge, None, reversed, None
        return e

    @classmethod
    def _from_curve(cls, curve: Any) -> Edge:
        """Wrap a new standalone kernel curve (takes ownership)."""
        e = cls.__new__(cls)
        e._owner, e._e, e._c, e._rev, e._cache = None, None, CurveHandle(curve), False, None
        return e

    # -- kernel access --------------------------------------------------------
    def _curve(self) -> Any:
        return self._e.curve() if self._e is not None else self._c.curve  # type: ignore[union-attr]

    def _range(self) -> tuple[float, float]:
        if self._cache is None:
            if self._e is not None:
                t0, t1 = self._e.parameter_range()
            else:
                t0, t1 = self._curve().parameter_range()
            self._cache = (float(t0), float(t1))
        return self._cache

    def _copy_curve(self) -> Any:
        """A new standalone kernel curve with this edge's extent and direction."""
        c = ext.edge_curve(self._e) if self._e is not None else ext.copy_curve(self._c.curve)  # type: ignore[union-attr]
        if self._rev:
            ext.reverse_curve(c)
        return c

    def _param(self, t: float) -> float:
        """Kernel parameter at fraction ``t`` of the arc length (in edge direction)."""
        t0, t1 = self._range()
        if self._rev:
            t = 1.0 - t
        if t <= 0.0:
            return t0
        if t >= 1.0:
            return t1
        if self.geom_type == "line":
            return t0 + (t1 - t0) * t
        s = t * ext.curve_length(self._curve(), t0, t1)
        u, _ = ext.curve_parameter_at_length(self._curve(), t0, s)
        return float(min(max(u, t0), t1))

    # -- properties -----------------------------------------------------------
    @property
    def geom_type(self) -> str:
        """``"line"``, ``"circle"`` (also arcs), ``"ellipse"``, ``"bspline"`` or ``"other"``."""
        return ext.curve_kind(self._curve())

    @property
    def length(self) -> float:
        t0, t1 = self._range()
        return float(ext.curve_length(self._curve(), t0, t1))

    @property
    def start(self) -> Vector:
        t0, t1 = self._range()
        return Vector(self._curve().evaluate(t1 if self._rev else t0))

    @property
    def end(self) -> Vector:
        t0, t1 = self._range()
        return Vector(self._curve().evaluate(t0 if self._rev else t1))

    @property
    def is_closed(self) -> bool:
        return self.start.is_close(self.end, 1e-7)

    @property
    def is_seam(self) -> bool:
        """True for the seam of a closed surface (an edge used twice by one face)."""
        if self._e is None:
            return False
        fs = self._e.faces()
        if len(fs) != 1:
            return False
        return sum(1 for loop in fs[0].boundary_loops() for e, _ in loop if e is self._e) > 1

    @property
    def convexity(self) -> str:
        """``"convex"`` for an outside corner (material angle below 180 degrees), ``"concave"``
        for an inside corner, ``"smooth"`` where the faces meet tangentially. Edges with a
        single face count as convex."""
        if self._e is None:
            return "convex"
        fs = self._e.faces()
        if len(fs) != 2:
            return "convex"
        f1, f2 = Face(self._owner, fs[0]), Face(self._owner, fs[1])
        p = self.center()
        n1, n2 = f1.normal_at(p), f2.normal_at(p)
        if n1.angle_to(n2) < 0.5:
            return "smooth"
        t = self.tangent_at(0.5)
        eps = 1e-4 * max(self.length, 1e-9)
        into = n1.cross(t)
        # pick the in-face direction of face 1 that stays on the face
        if f1.distance_to(p + into * eps) > f1.distance_to(p - into * eps):
            into = -into
        return "convex" if n2.dot(into) < 0 else "concave"

    def is_convex(self) -> bool:
        """True on an outside corner (see :attr:`convexity`)."""
        return self.convexity == "convex"

    @property
    def direction(self) -> Vector:
        """Unit direction of a straight edge (start to end)."""
        if not self._is_straight():
            raise ValueError(f"direction is only defined for straight edges, this is a {self.geom_type}")
        return (self.end - self.start).normalized()

    def _is_straight(self) -> bool:
        """A line, or a B-spline whose control points lie on a line (chamfers, mirrored
        lines and the like make those)."""
        kind = self.geom_type
        if kind == "line":
            return True
        if kind != "bspline":
            return False
        poles = np.array(ext.curve_data(self._curve())["poles"], dtype=float)
        return _collinear(poles)

    def _circle(self) -> dict[str, Any]:
        if self.geom_type != "circle":
            raise ValueError(f"not a circular edge but a {self.geom_type}")
        return ext.curve_data(self._curve())

    @property
    def radius(self) -> float:
        """Radius of a circular edge."""
        return float(self._circle()["radius"])

    @property
    def arc_center(self) -> Vector:
        """Center of a circular edge."""
        return Vector(self._circle()["placement"]["origin"])

    @property
    def normal(self) -> Vector:
        """Axis direction of a circular edge."""
        return Vector(self._circle()["placement"]["z_dir"])

    def point_at(self, t: float = 0.5) -> Vector:
        """Point at fraction ``t`` of the edge length (0 = start, 1 = end)."""
        return Vector(self._curve().evaluate(self._param(t)))

    def tangent_at(self, t: float = 0.5) -> Vector:
        """Unit tangent at fraction ``t`` of the edge length, pointing along the edge."""
        d = Vector(ext.curve_eval(self._curve(), self._param(t), 1)[1])
        d = d.normalized()
        return -d if self._rev else d

    def center(self) -> Vector:
        """The point halfway along the edge (use :attr:`arc_center` for a circle's center)."""
        return self.point_at(0.5)

    def bbox(self) -> BoundBox:
        if self._e is not None:
            lo, hi = self._e.bounding_box(True)
            return BoundBox(lo, hi)
        pts = [self.point_at(i / 32) for i in range(33)]
        if self.geom_type == "line":
            pts = [self.start, self.end]
        return BoundBox.of_points(pts)

    def distance_to(self, point: VectorLike) -> float:
        p = _vec(point)
        if self._e is not None:
            _, _, d = self._e.closest_point(p.to_tuple())
            return float(d)
        _, _, d = k.curve_closest_point(self._curve(), p.to_tuple())
        return float(d)

    def intersections(self, other: Edge) -> list[Vector]:
        """Points where this edge crosses another edge."""
        with kernel_call("edge intersections"):
            pts, ta, tb = k.intersect_curves(self._curve(), other._curve())
        (a0, a1), (b0, b1) = self._range(), other._range()
        out = []
        for p, u, v in zip(pts, ta, tb):
            if a0 - 1e-9 <= u <= a1 + 1e-9 and b0 - 1e-9 <= v <= b1 + 1e-9:
                out.append(Vector(p))
        return out

    # -- topology -------------------------------------------------------------
    def vertices(self) -> ShapeList[Vertex]:
        if self._e is not None:
            a, b = self._e.vertices()
            vs = [Vertex._of(self._owner, a), Vertex._of(self._owner, b)]
            if self._rev:
                vs.reverse()
            return _unique(vs)
        return _unique([Vertex(self.start), Vertex(self.end)])

    def edges(self) -> ShapeList[Edge]:
        return ShapeList([self])

    def faces(self) -> ShapeList[Face]:
        if self._e is None:
            return ShapeList()
        return ShapeList(Face(self._owner, f) for f in self._e.faces())

    # -- derived edges --------------------------------------------------------
    def reversed(self) -> Edge:
        """The same edge traversed the other way."""
        e = Edge.__new__(Edge)
        e._owner, e._e, e._c, e._rev, e._cache = self._owner, self._e, self._c, not self._rev, self._cache
        return e

    def _transformed(self, m: np.ndarray) -> Edge:
        return Edge._from_curve(_transform_curve(self._copy_curve(), m))

    def __add__(self, other: Edge | Wire) -> Wire:
        return Wire([self, other])

    def _identity(self) -> Any:
        return ("e", id(self._e)) if self._e is not None else ("c", id(self._c))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Edge):
            return NotImplemented
        return self._identity() == other._identity()

    def __hash__(self) -> int:
        return hash(self._identity())

    def __repr__(self) -> str:
        s, e = self.start, self.end
        return (f"Edge({self.geom_type}, ({s.x:.4g}, {s.y:.4g}, {s.z:.4g}) -> "
                f"({e.x:.4g}, {e.y:.4g}, {e.z:.4g}))")


def _collinear(points: np.ndarray) -> bool:
    a = points - points.mean(axis=0)
    sv = np.linalg.svd(a, compute_uv=False)
    return bool(len(sv) > 0 and sv[0] > 0 and sv[1] <= 1e-10 * sv[0])


def _coplanar(points: np.ndarray) -> bool:
    a = points - points.mean(axis=0)
    sv = np.linalg.svd(a, compute_uv=False)
    return bool(len(sv) > 2 and sv[0] > 0 and sv[2] <= 1e-10 * sv[0])


def _is_rigid(m: np.ndarray) -> bool:
    r = m[:3, :3]
    return bool(np.allclose(r @ r.T, np.eye(3), atol=1e-12) and np.linalg.det(r) > 0)


def _similarity(m: np.ndarray) -> bool:
    """True for a rotation, reflection or uniform scale (with any translation): the maps that
    take lines to lines and circles to circles."""
    r = m[:3, :3]
    g = r @ r.T
    s2 = float(np.trace(g)) / 3.0
    return s2 > 0 and bool(np.allclose(g, s2 * np.eye(3), atol=1e-12 * max(1.0, s2)))


def _exact_image(curve: Any, m: np.ndarray) -> Any | None:
    """The image of a line or circle under a similarity as an exact line or circle (a new
    curve), or None for other curves."""
    kind = ext.curve_kind(curve)
    if kind not in ("line", "circle"):
        return None
    t0, t1 = (float(t) for t in curve.parameter_range())

    def image(t: float) -> Vector:
        p = np.array(Vector(curve.evaluate(t)).to_tuple())
        return Vector(m[:3, :3] @ p + m[:3, 3])

    a, e = image(t0), image(t1)
    if kind == "line":
        with kernel_call("transform"):
            return k.create_line_segment(a.to_tuple(), e.to_tuple())
    from .curves import ThreePointArc, _arc_curve

    if a.distance_to(e) > 1e-9 * max(1.0, a.length):
        return ThreePointArc(a, image(0.5 * (t0 + t1)), e)._copy_curve()
    b, c = image(t0 + (t1 - t0) / 3.0), image(t0 + 2.0 * (t1 - t0) / 3.0)
    ab, ac = b - a, c - a
    n = ab.cross(ac)
    center = a + (ab.cross(n) * ac.dot(ac) - ac.cross(n) * ab.dot(ab)) / (2.0 * n.dot(n)) * -1.0
    return _arc_curve(Vector(0, 0, 0), center.distance_to(a), 0.0, 360.0, Plane(center, a - center, n.normalized()))


def _transform_curve(curve: Any, m: np.ndarray) -> Any:
    """Apply a 4x4 matrix to a standalone kernel curve (consumes ``curve``)."""
    if _is_rigid(m):
        placement = k.Axis2Placement(_t(m[:3, 3]), _t(m[:3, 0]), _t(m[:3, 1]))
        k.transform(curve, placement)
        return curve
    if _similarity(m):
        # Mirrored and uniformly scaled lines and circles stay lines and circles.
        exact = _exact_image(curve, m)
        if exact is not None:
            ext.delete_curve(curve)
            return exact
    # Other maps: NURBS are invariant under affine maps of their poles.
    d = ext.curve_data(curve)
    ext.delete_curve(curve)
    poles = np.array(d["poles"]) @ m[:3, :3].T + m[:3, 3]
    return _canonical_curve(poles, d["knots"], d["degree"], d["weights"])


def _canonical_curve(poles: np.ndarray, knots: Sequence[float], degree: int, weights: Sequence[float] | None) -> Any:
    uniq: list[float] = []
    mult: list[int] = []
    for kv in knots:
        if uniq and abs(kv - uniq[-1]) <= 1e-14 * max(1.0, abs(kv)):
            mult[-1] += 1
        else:
            uniq.append(float(kv))
            mult.append(1)
    return k.create_canonical_curve([_t(p) for p in poles], uniq, mult,
                                    None if weights is None else [float(w) for w in weights], int(degree))


# =============================================================================
# Wire
# =============================================================================
class Wire(Shape):
    """A chain of edges, open or closed. ``Wire([edge, edge, ...])`` orders and orients the edges."""

    __slots__ = ("_edges",)

    def __init__(self, edges: Iterable[Edge | Wire] | Edge | Wire, *, sort: bool = True):
        flat: list[Edge] = []
        items = [edges] if isinstance(edges, (Edge, Wire)) else list(edges)
        for it in items:
            if isinstance(it, Wire):
                flat.extend(it._edges)
            elif isinstance(it, Edge):
                flat.append(it)
            elif isinstance(it, ShapeList) or isinstance(it, (list, tuple)):
                flat.extend(Wire(it, sort=False)._edges)
            else:
                raise TypeError(f"a wire is made of edges, got {type(it).__name__}")
        if not flat:
            raise ValueError("a wire needs at least one edge")
        self._edges = tuple(_chain(flat) if sort else flat)

    @classmethod
    def _raw(cls, edges: Sequence[Edge]) -> Wire:
        w = cls.__new__(cls)
        w._edges = tuple(edges)
        return w

    def edges(self) -> ShapeList[Edge]:
        return ShapeList(self._edges)

    def vertices(self) -> ShapeList[Vertex]:
        return _unique(v for e in self._edges for v in e.vertices())

    def wires(self) -> ShapeList[Wire]:
        return ShapeList([self])

    @property
    def is_closed(self) -> bool:
        return self.start.is_close(self.end, 1e-6)

    @property
    def start(self) -> Vector:
        return self._edges[0].start

    @property
    def end(self) -> Vector:
        return self._edges[-1].end

    @property
    def length(self) -> float:
        return sum(e.length for e in self._edges)

    def center(self) -> Vector:
        """Length-weighted average of the edge midpoints."""
        total = 0.0
        c = Vector()
        for e in self._edges:
            L = e.length
            c = c + e.center() * L
            total += L
        return c / total if total else self._edges[0].start

    def bbox(self) -> BoundBox:
        b = self._edges[0].bbox()
        for e in self._edges[1:]:
            b = b.union(e.bbox())
        return b

    def point_at(self, t: float = 0.5) -> Vector:
        """Point at fraction ``t`` of the total length."""
        lengths = [e.length for e in self._edges]
        s = max(0.0, min(1.0, t)) * sum(lengths)
        for e, L in zip(self._edges, lengths):
            if s <= L or e is self._edges[-1]:
                return e.point_at(s / L if L else 0.0)
            s -= L
        return self.end

    def tangent_at(self, t: float = 0.5) -> Vector:
        lengths = [e.length for e in self._edges]
        s = max(0.0, min(1.0, t)) * sum(lengths)
        for e, L in zip(self._edges, lengths):
            if s <= L or e is self._edges[-1]:
                return e.tangent_at(s / L if L else 0.0)
            s -= L
        return self._edges[-1].tangent_at(1.0)

    def distance_to(self, point: VectorLike) -> float:
        return min(e.distance_to(point) for e in self._edges)

    def close(self) -> Wire:
        """This wire closed with a straight line from its end to its start."""
        if self.is_closed:
            return self
        from .curves import Line

        return Wire._raw((*self._edges, Line(self.end, self.start)))

    def reversed(self) -> Wire:
        return Wire._raw(tuple(e.reversed() for e in reversed(self._edges)))

    def _transformed(self, m: np.ndarray) -> Wire:
        return Wire._raw(tuple(e._transformed(m) for e in self._edges))

    def _copy_curves(self) -> list[Any]:
        return [e._copy_curve() for e in self._edges]

    def __add__(self, other: Edge | Wire) -> Wire:
        return Wire([self, other])

    def plane(self) -> Plane:
        """The plane of a planar wire (normal by the right-hand rule along the wire)."""
        pts = [self.point_at(i / 64) for i in range(64)]
        return _fit_plane(pts, closed=self.is_closed)

    def fillet(self, radius: float, vertices: Iterable[VectorLike | Vertex] | None = None) -> Wire:
        """Round the corners between straight edges with tangent arcs (planar wires)."""
        from .curves import _fillet_wire

        return _fillet_wire(self, radius, vertices)

    def to_sketch(self) -> Sketch:
        """The planar region bounded by this closed wire."""
        return Sketch._from_wires([self])

    def __repr__(self) -> str:
        kind = "closed" if self.is_closed else "open"
        return f"Wire({len(self._edges)} edges, {kind}, length={self.length:.6g})"


def _merged_lines(wire: Wire) -> Wire:
    """The wire with consecutive collinear line segments joined into one."""
    edges = list(wire.edges())
    if len(edges) < 2:
        return wire
    from .curves import Line

    def collinear(a: Edge, b: Edge) -> bool:
        return (a.geom_type == "line" and b.geom_type == "line" and a.end.is_close(b.start, 1e-9)
                and a.direction.angle_to(b.direction) < 1e-7)

    out: list[Edge] = []
    for e in edges:
        if out and collinear(out[-1], e):
            out[-1] = Line(out[-1].start, e.end)
        else:
            out.append(e)
    if len(out) > 2 and wire.is_closed and collinear(out[-1], out[0]):
        out[0] = Line(out[-1].start, out[0].end)
        out.pop()
    return Wire._raw(out) if len(out) != len(edges) else wire


def _chain(edges: list[Edge], tol: float = 1e-6) -> list[Edge]:
    """Order edges head to tail, reversing where needed. Leaves them alone if they don't chain."""
    if len(edges) < 2:
        return edges
    rest = list(edges)
    chain = [rest.pop(0)]
    while rest:
        end = chain[-1].end
        start = chain[0].start
        for i, e in enumerate(rest):
            if e.start.is_close(end, tol):
                chain.append(rest.pop(i))
                break
            if e.end.is_close(end, tol):
                chain.append(rest.pop(i).reversed())
                break
            if e.end.is_close(start, tol):
                chain.insert(0, rest.pop(i))
                break
            if e.start.is_close(start, tol):
                chain.insert(0, rest.pop(i).reversed())
                break
        else:
            return edges  # not a single chain; keep the given order
    return chain


def _loop_area(wire: Wire, samples: int = 24) -> float:
    """Approximate enclosed area of a closed planar wire (sampled polygon)."""
    pts = []
    for e in wire.edges():
        n = 1 if e.geom_type == "line" else samples
        pts.extend(e.point_at(i / n) for i in range(n))
    a = np.array([p.to_tuple() for p in pts])
    c = a.mean(axis=0)
    s = np.zeros(3)
    for i in range(len(a)):
        s += np.cross(a[i] - c, a[(i + 1) % len(a)] - c)
    return 0.5 * float(np.linalg.norm(s))


def _fit_plane(points: Sequence[Vector], closed: bool = True) -> Plane:
    pts = np.array([p.to_tuple() for p in points])
    c = pts.mean(axis=0)
    # Newell normal for closed polygons: orientation follows the traversal.
    n = np.zeros(3)
    if closed:
        for i in range(len(pts)):
            a, b = pts[i] - c, pts[(i + 1) % len(pts)] - c
            n += np.cross(a, b)
    if np.linalg.norm(n) < 1e-12:
        _, _, vt = np.linalg.svd(pts - c)
        n = vt[2]
    return Plane(Vector(c), z_dir=Vector(n).normalized())


# =============================================================================
# Face
# =============================================================================
class Face(Shape):
    """A bounded piece of a surface, belonging to a body (a part, shell or sketch)."""

    __slots__ = ("_owner", "_f", "_info", "_m")

    def __init__(self, owner: Any, kface: Any):
        self._owner = owner
        self._f = kface
        self._info: dict[str, Any] | None = None
        self._m: dict[str, Any] | None = None

    @property
    def owner(self) -> _Body:
        """The body this face belongs to."""
        return self._owner

    # -- geometry -------------------------------------------------------------
    def _surface_info(self) -> dict[str, Any]:
        if self._info is None:
            self._info = ext.surface_data(self._f.surface(), False)
        return self._info

    @property
    def geom_type(self) -> str:
        """``"plane"``, ``"cylinder"``, ``"cone"``, ``"sphere"``, ``"torus"``, ``"revolution"``,
        ``"extrusion"``, ``"bspline"``, ``"offset"`` or ``"other"``."""
        info = self._surface_info()
        kind = info["kind"]
        if kind == "cone" and abs(info.get("semi_angle_deg", 1.0)) < 1e-12:
            return "cylinder"
        return kind

    def _measure(self) -> dict[str, Any]:
        """Area and first moments, integrated to ``ACCURACY`` (see :meth:`Part.mass_properties`)."""
        if self._m is None:
            with kernel_call("face area"):
                self._m = ext.face_measure(self._f, ACCURACY * _MARGIN)
        return self._m

    @property
    def area(self) -> float:
        return float(self._measure()["area"])

    def center(self) -> Vector:
        """Area centroid. For curved faces it may lie off the face; see :meth:`interior_point`."""
        p = self._measure()
        o, m, a = p["origin"], p["first_moments"], p["signed_area"]
        if abs(a) < 1e-300:
            return Vector(self._f.interior_point())
        return Vector(o) + Vector(m) / a

    def interior_point(self) -> Vector:
        """A point guaranteed to lie on the face."""
        return Vector(self._f.interior_point())

    def normal_at(self, point: VectorLike | None = None) -> Vector:
        """Outward unit normal at the face point closest to ``point`` (default: the center)."""
        if point is None and self.geom_type == "plane":
            pl = self._surface_info()["placement"]
            n = Vector(pl["z_dir"])
            return n if self._natural_is_outward() else -n
        p = _vec(point) if point is not None else self.center()
        _, uvs, _ = k.surface_closest_point(self._f.surface(), p.to_tuple())
        uv = uvs[0]
        return Vector(self._f.outward_normal_at_uv(uv.x, uv.y))

    def _natural_is_outward(self) -> bool:
        (u0, v0), (u1, v1) = self._f.uv_domain()
        u, v = 0.5 * (u0 + u1), 0.5 * (v0 + v1)
        n0 = Vector(self._f.normal_at_uv(u, v))
        n1 = Vector(self._f.outward_normal_at_uv(u, v))
        return n0.dot(n1) > 0

    @property
    def is_planar(self) -> bool:
        """True for planes and for flat B-spline faces (control points in one plane)."""
        kind = self.geom_type
        if kind == "plane":
            return True
        if kind == "bspline":
            poles = np.array(ext.surface_data(self._f.surface(), True)["poles"], dtype=float)
            if _coplanar(poles):
                return True
        return bool(self._f.surface().is_planar(1e-7))

    @property
    def plane(self) -> Plane:
        """The face's plane: origin at its centroid, normal pointing out of the body."""
        return self._plane_of_face()

    def _plane_of_face(self) -> Plane:
        if not self.is_planar:
            raise ValueError(f"a {self.geom_type} face has no plane; use normal_at() or a planar face")
        n = self.normal_at()
        if self._owner is not None and isinstance(self._owner, Sketch):
            sp = self._owner.plane
            if sp.z_dir.is_parallel(n):
                return Plane(self.center(), sp.x_dir, sp.z_dir)
        return Plane(self.center(), z_dir=n)

    @property
    def radius(self) -> float:
        """Radius of a cylinder, sphere or cone (at its base), minor radius of a torus."""
        info = self._surface_info()
        if "minor_radius" in info:
            return float(info["minor_radius"])
        if "radius" in info:
            return float(info["radius"])
        raise ValueError(f"a {self.geom_type} face has no radius")

    @property
    def axis(self) -> Axis:
        """Axis of a cylinder, cone, sphere, torus or surface of revolution."""
        info = self._surface_info()
        pl = info.get("placement")
        if pl is None or self.geom_type == "plane":
            raise ValueError(f"a {self.geom_type} face has no axis")
        return Axis(pl["origin"], pl["z_dir"])

    def bbox(self) -> BoundBox:
        lo, hi = self._f.bounding_box(True)
        return BoundBox(lo, hi)

    def distance_to(self, point: VectorLike) -> float:
        _, d = self._f.closest_point(_vec(point).to_tuple())
        return float(d)

    # -- topology -------------------------------------------------------------
    def _loops(self) -> list[Wire]:
        loops = self._f.boundary_loops()
        out = []
        for loop in loops:
            out.append(Wire._raw([Edge._of(self._owner, e, reversed=not fwd) for e, fwd in loop]))
        return out

    def outer_wire(self) -> Wire:
        return self._loops()[0]

    def inner_wires(self) -> ShapeList[Wire]:
        return ShapeList(self._loops()[1:])

    def wires(self) -> ShapeList[Wire]:
        return ShapeList(self._loops())

    def edges(self, seams: bool = False) -> ShapeList[Edge]:
        """The face's edges (seam edges only with ``seams=True``)."""
        out = ShapeList()
        counts: dict[int, int] = {}
        loops = self._f.boundary_loops()
        for loop in loops:
            for e, _ in loop:
                counts[id(e)] = counts.get(id(e), 0) + 1
        seen: set[int] = set()
        for loop in loops:
            for e, _ in loop:
                if id(e) in seen or (counts[id(e)] > 1 and not seams):
                    continue
                seen.add(id(e))
                out.append(Edge._of(self._owner, e))
        return out

    def vertices(self) -> ShapeList[Vertex]:
        return ShapeList(Vertex._of(self._owner, v) for v in self._f.vertices())

    def faces(self) -> ShapeList[Face]:
        return ShapeList([self])

    def neighbors(self) -> ShapeList[Face]:
        """Faces sharing an edge with this one."""
        out = _unique(f for e in self.edges() for f in e.faces())
        return ShapeList(f for f in out if f != self)

    # -- conversion -----------------------------------------------------------
    def to_sketch(self) -> Sketch:
        """A sketch holding a copy of this (planar) face."""
        plane = self.plane
        with kernel_call("copy face"):
            b = ext.copy_faces(self._owner._brep, [self._f])
        return Sketch._wrap(b, plane)

    def to_shell(self) -> Shell:
        """A sheet body holding a copy of this face."""
        with kernel_call("copy face"):
            b = ext.copy_faces(self._owner._brep, [self._f])
        return Shell._wrap(b)

    def extrude(self, amount: float, **kwargs: Any) -> Part:
        """Extrude a planar face along its normal (see :meth:`Sketch.extrude`)."""
        return self.to_sketch().extrude(amount, **kwargs)

    def _transformed(self, m: np.ndarray) -> Face:
        moved = self.to_shell()._transformed(m)
        return moved.faces()[0]

    def _identity(self) -> Any:
        return ("f", id(self._f))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Face):
            return NotImplemented
        return self._f is other._f

    def __hash__(self) -> int:
        return hash(self._identity())

    def __repr__(self) -> str:
        c = self.center()
        return f"Face({self.geom_type}, area={self.area:.6g}, center=({c.x:.4g}, {c.y:.4g}, {c.z:.4g}))"


# =============================================================================
# Bodies: Part, Shell, Sketch
# =============================================================================
class _Body(Shape):
    """A shape backed by one kernel Brep."""

    __slots__ = ("_h", "name", "color")

    def __init__(self) -> None:
        raise TypeError(f"create a {type(self).__name__} with the constructors (Box(), Rectangle(), ...)")

    @classmethod
    def _wrap(cls, brep: Any, *args: Any, **kwargs: Any):  # type: ignore[no-untyped-def]
        b = cls.__new__(cls)
        b._h = BrepHandle(brep)
        b.name = kwargs.pop("name", None)
        b.color = kwargs.pop("color", None)
        return b

    @property
    def _brep(self) -> Any:
        return self._h.brep

    def _copy_brep(self) -> Any:
        return self._brep.copy()

    def _like(self, brep: Any) -> Any:
        """A body of the same type and metadata around ``brep``."""
        return type(self)._wrap(brep, name=self.name, color=self.color)

    # -- metadata (returns copies; shapes are immutable) ----------------------
    def named(self, name: str) -> Any:
        """The same body with a name (used by exporters and the viewer)."""
        b = self._like(self._copy_brep())
        b.name = name
        return b

    def colored(self, color: str | Sequence[float]) -> Any:
        """The same body with a display color (``"steelblue"``, ``"#4682b4"`` or ``(r, g, b)``)."""
        b = self._like(self._copy_brep())
        b.color = color
        return b

    # -- topology -------------------------------------------------------------
    def faces(self) -> ShapeList[Face]:
        return ShapeList(Face(self, f) for f in self._brep.faces())

    def edges(self, seams: bool = False) -> ShapeList[Edge]:
        """All edges. Seam edges (where a closed surface such as a cylinder meets itself)
        are left out unless ``seams`` is true."""
        all_edges = self._brep.edges()
        if seams:
            return ShapeList(Edge._of(self, e) for e in all_edges)
        skip = set(ext.seam_edges(self._brep))
        return ShapeList(Edge._of(self, e) for i, e in enumerate(all_edges) if i not in skip)

    def vertices(self) -> ShapeList[Vertex]:
        return ShapeList(Vertex._of(self, v) for v in self._brep.vertices())

    def wires(self) -> ShapeList[Wire]:
        return ShapeList(w for f in self.faces() for w in f.wires())

    # -- geometry -------------------------------------------------------------
    def bbox(self) -> BoundBox:
        lo, hi = self._brep.bounding_box(True)
        return BoundBox(lo, hi)

    def _loose_box(self) -> BoundBox:
        """A box around the body that may be slightly too large; far cheaper than :meth:`bbox`
        (for overlap tests and size scales)."""
        lo, hi = self._brep.bounding_box(False)
        return BoundBox(lo, hi)

    def distance_to(self, other: VectorLike | Shape) -> float:
        """Minimum distance to a point or to another body.

        For a point inside a part, and for a body nested in another, it is the distance to
        the surface (the wall clearance). Bodies that touch or overlap are 0 apart.
        """
        if isinstance(other, _Body):
            return _body_distance(self, other)
        if isinstance(other, Shape) and not isinstance(other, Vertex):
            raise TypeError(f"distance_to takes a point or a body (Part, Shell, Sketch), not a {type(other).__name__}")
        _, d = k.brep_closest_point(self._brep, _vec(other).to_tuple())  # type: ignore[arg-type]
        return float(d)

    def closest_point(self, point: VectorLike) -> Vector:
        p, _ = k.brep_closest_point(self._brep, _vec(point).to_tuple())
        return Vector(p.x, p.y, p.z) if hasattr(p, "x") else Vector(p)

    # -- geometric queries ----------------------------------------------------
    def intersection_curves(self, other: _Body) -> ShapeList[Edge]:
        """The curves where this body's surface meets another body's surface, each one once."""
        with kernel_call("intersection curves"):
            curves, _ = k.intersect_breps(self._brep, other._brep)
        # Where faces of the two bodies lie in one plane, the kernel hands out curves on their
        # borders twice (also reversed).
        return _distinct_curves(curves, 1e-6 * max(1.0, self._loose_box().union(other._loose_box()).diagonal))

    def silhouette(self, direction: Axis | VectorLike = (0, 0, 1)) -> ShapeList[Edge]:
        """Silhouette curves on the body as seen along ``direction`` (an axis or a vector)."""
        d = _direction(direction, "silhouette")
        with kernel_call("silhouette"):
            curves = k.create_silhouette_curves(self._brep, (0.0, 0.0, 0.0), d.to_tuple())
        return ShapeList(Edge._from_curve(c) for c in curves)

    def project(self, curve: Edge | Wire, direction: Axis | VectorLike = (0, 0, -1)) -> ShapeList[Edge]:
        """Project a curve onto the body along ``direction`` (an axis or a vector); returns the
        curves on its faces."""
        d = _direction(direction, "project")
        out = ShapeList()
        for e in curve.edges():
            c = e._copy_curve()
            try:
                with kernel_call("project"):
                    res = k.project_curve(self._brep, c, d.to_tuple())
            finally:
                ext.delete_curve(c)
            out.extend(Edge._from_curve(r) for r in res)
        return out

    def outline(self, plane: Plane = Plane.XY) -> ShapeList[Edge]:
        """The body's edges projected onto a plane (a 2D drawing view)."""
        with kernel_call("outline"):
            curves = k.project_brep_onto_plane(self._brep, plane.origin.to_tuple(), plane.z_dir.to_tuple())
        # The kernel can hand out the same projected curve twice (on Linux on ARM a cylinder's
        # circles seen edge-on come with a copy each); a drawing view needs each line once.
        return _distinct_curves(curves, 1e-7 * max(self.bbox().diagonal, 1.0))

    def _transformed(self, m: np.ndarray) -> Any:
        b = self._copy_brep()
        with kernel_call("transform"):
            ext.transform_brep(b, list(m.T.ravel()))
        return self._like(b)

    # -- body conversions -----------------------------------------------------
    def to_nurbs(self) -> Any:
        """A copy whose faces and edges are all NURBS (analytic types converted)."""
        b = self._copy_brep()
        with kernel_call("to_nurbs"):
            k.turn_to_nurbs(b)
        return self._like(b)

    def heal(self) -> Any:
        """Repair gaps, tolerances and topology (mostly needed for imported data)."""
        b = self._copy_brep()
        with kernel_call("heal"):
            k.heal_brep(b)
        return self._like(b)

    def _identity(self) -> Any:
        return ("b", id(self._h))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, _Body):
            return NotImplemented
        return self._h is other._h

    def __hash__(self) -> int:
        return hash(self._identity())

    def info(self) -> dict[str, Any]:
        """Counts and measures in one dictionary."""
        b = self.bbox()
        return {
            "type": type(self).__name__,
            "faces": self._brep.face_count(),
            "edges": self._brep.edge_count(),
            "vertices": self._brep.vertex_count(),
            "bbox": (b.min.to_tuple(), b.max.to_tuple()),
        }


def _distinct_curves(curves: Iterable[Any], tol: float) -> ShapeList[Edge]:
    """Edges of new kernel curves, each curve once: one whose ends and midpoint lie within
    ``tol`` of those of a curve kept already (either way round) is left out."""
    kept: list[tuple[Edge, np.ndarray, np.ndarray, np.ndarray]] = []
    for c in curves:
        e = Edge._from_curve(c)
        a, b, m = (np.array(p.to_tuple()) for p in (e.start, e.end, e.point_at(0.5)))
        if any(np.linalg.norm(m - km) <= tol
               and min(np.linalg.norm(a - ka) + np.linalg.norm(b - kb), np.linalg.norm(a - kb) + np.linalg.norm(b - ka)) <= tol
               for _, ka, kb, km in kept):
            continue
        kept.append((e, a, b, m))
    return ShapeList(e for e, _, _, _ in kept)


def _disjoint(a: BoundBox, b: BoundBox, tol: float = 1e-9) -> bool:
    return any(a.max[i] < b.min[i] - tol or b.max[i] < a.min[i] - tol for i in range(3))


def _disjoint_batches(tools: Sequence[Any]) -> list[list[Any]]:
    """The tools in groups whose members' boxes do not overlap (so that each group can go
    into one Boolean); empty tools are left out."""
    items = []
    for t in tools:
        if t._brep.face_count():
            lo, hi = t._brep.bounding_box(False)
            items.append((t, np.array([*lo, *hi], dtype=float)))
    batches: list[tuple[list[Any], list[np.ndarray]]] = []
    for t, b in items:
        for members, boxes in batches:
            arr = np.array(boxes)
            apart = (arr[:, 3:] < b[:3] - 1e-9) | (b[3:] < arr[:, :3] - 1e-9)
            if apart.any(axis=1).all():
                members.append(t)
                boxes.append(b)
                break
        else:
            batches.append(([t], [b]))
    return [members for members, _ in batches]


def _closest(body: _Body, p: np.ndarray) -> np.ndarray:
    q, _ = k.brep_closest_point(body._brep, (float(p[0]), float(p[1]), float(p[2])))
    return np.array((q.x, q.y, q.z)) if hasattr(q, "x") else np.array(q, dtype=float)


def _body_distance(a: _Body, b: _Body, seeds: int = 6, sample: int = 400) -> float:
    """Distance between the surfaces of two bodies (0 where they touch or overlap).

    The kernel's own body distance is wrong where the nearest points form a line (parallel
    cylinders) and far from the origin. Here: the mesh vertices of each body nearest to the
    other give starting points; from the best ones, closest points are taken in turn on
    either body until the pair settles (alternating projections), which ends in a pair of
    exact surface points.
    """
    from .mesh import tessellate

    if a._brep.face_count() == 0 or b._brep.face_count() == 0:
        raise ValueError("distance_to: an empty body has no distance")
    starts: list[tuple[float, _Body, _Body, np.ndarray]] = []
    ab, bb = a.bbox(), b.bbox()  # each once: the tight box costs as much as the rest
    for x, xb, y, yb in ((a, ab, b, bb), (b, bb, a, ab)):
        lo, hi = np.array(yb.min.to_tuple()), np.array(yb.max.to_tuple())
        corners = np.array([v.point.to_tuple() for v in x.vertices()], dtype=float).reshape(-1, 3)
        mesh = tessellate(x, max(xb.diagonal * 1e-3, 1e-6))  # tessellate's default tolerance
        pts = np.vstack([mesh.vertices, corners])
        gap = np.linalg.norm(np.maximum(0.0, np.maximum(lo - pts, pts - hi)), axis=1)
        pts = pts[np.argsort(gap, kind="stable")[:sample]]
        found = sorted(((float(np.linalg.norm(_closest(y, p) - p)), i) for i, p in enumerate(pts)))
        taken: list[np.ndarray] = []
        spacing = 1e-3 * max(xb.diagonal, 1e-9)
        for d, i in found:
            if len(taken) >= seeds:
                break
            if all(np.linalg.norm(pts[i] - t) > spacing for t in taken):
                taken.append(pts[i])
                starts.append((d, x, y, pts[i]))
    best = math.inf
    for _, x, y, p in sorted(starts, key=lambda t: t[0])[:2 * seeds]:
        p = _closest(x, p)
        q = _closest(y, p)
        d = float(np.linalg.norm(p - q))
        for _ in range(500):
            p2 = _closest(x, q)
            q2 = _closest(y, p2)
            d2 = float(np.linalg.norm(p2 - q2))
            if d2 >= d * (1 - 1e-14) - 1e-300:
                break
            moved = float(np.linalg.norm(p2 - p) + np.linalg.norm(q2 - q))
            p, q, d = p2, q2, d2
            if moved <= 1e-13 * max(1.0, float(np.abs(p).max())):
                break
        best = min(best, d)
    scale = max(ab.diagonal, bb.diagonal, 1.0)
    return 0.0 if best <= 1e-12 * scale else best


def _relationship(a: _Body, b: _Body) -> str | None:
    """``"separate"``, ``"touching"``, ``"interpenetrating"``, ``"a_contains_b"`` or
    ``"b_contains_a"`` (None if the kernel cannot tell)."""
    try:
        return str(k.brep_relationship(a._brep, b._brep)["relationship"])
    except RuntimeError:
        return None


def _bodies(items: Any, name: str = "combine") -> list[_Body]:
    if isinstance(items, _Body):
        return [items]
    if isinstance(items, Face):
        return [items.to_shell()]
    if isinstance(items, (str, bytes, Shape)) or not isinstance(items, Iterable):
        kind = type(items).__name__
        raise TypeError(f"cannot {name} a body with a {kind} value; use parts (or a list of parts)")
    out: list[_Body] = []
    for it in items:
        out.extend(_bodies(it, name))
    return out


class MassProperties:
    """Mass properties of a part.

    ``inertia`` is the inertia tensor about the center of mass (axes parallel to the
    world axes); ``principal_moments`` and ``principal_axes`` are its eigen-decomposition.
    """

    __slots__ = ("mass", "volume", "area", "center", "inertia", "density")

    def __init__(self, mass: float, volume: float, area: float, center: Vector, inertia: np.ndarray, density: float):
        self.mass = mass
        self.volume = volume
        self.area = area
        self.center = center
        self.inertia = inertia
        self.density = density

    @property
    def principal_moments(self) -> tuple[float, float, float]:
        w, _ = np.linalg.eigh(self.inertia)
        return (float(w[0]), float(w[1]), float(w[2]))

    @property
    def principal_axes(self) -> tuple[Vector, Vector, Vector]:
        _, v = np.linalg.eigh(self.inertia)
        return (Vector(v[:, 0]), Vector(v[:, 1]), Vector(v[:, 2]))

    def __repr__(self) -> str:
        c = self.center
        return (f"MassProperties(mass={self.mass:.6g}, volume={self.volume:.6g}, area={self.area:.6g}, "
                f"center=({c.x:.6g}, {c.y:.6g}, {c.z:.6g}))")


class Part(_Body):
    """A solid: one or more closed volumes.

    Combine parts with ``+`` (union), ``-`` (difference) and ``&`` (intersection).
    The right-hand side may be a single part or any iterable of parts.
    """

    __slots__ = ()

    # -- measures -------------------------------------------------------------
    def _props(self, accuracy: float | None = None) -> dict[str, Any]:
        """Area, volume and moments (density 1) to the relative ``accuracy`` (default
        ``ACCURACY``), integrated by smlibpy with an error estimate (src/cpp/measure.cpp).
        Kept with the body, which does not change: the next query costs nothing. No warnings:
        for the checks inside operations; the public measures go through ``_measured``."""
        accuracy = ACCURACY if accuracy is None else accuracy
        cached = self._h.props
        if cached is not None and cached["accuracy"] <= accuracy:
            return cached
        with kernel_call("mass properties", "is the part a closed solid?"):
            p = ext.brep_measure(self._brep, accuracy * _MARGIN)
        p["accuracy"] = accuracy
        vx, vy, vz = p["field_volumes"]
        p["gaps"] = max(abs(vx - vz), abs(vy - vz)) / abs(vz) if vz else 0.0
        self._h.props = p
        return p

    def _measured(self, accuracy: float | None = None) -> dict[str, Any]:
        """``_props`` for the user: says when the numbers are not what was asked for (the
        integration did not reach the accuracy, or the body's faces leave gaps that make its
        volume uncertain beyond the fifth digit), each thing once per part."""
        p = self._props(accuracy)
        asked = ACCURACY if accuracy is None else accuracy
        notes = []
        if not p["converged"] and p["relative_error"] > asked:
            notes.append(f"mass properties: the integration reached a relative accuracy of "
                         f"{p['relative_error']:.1e}, not {asked:.0e}")
        if p["gaps"] > max(asked, _GAPS):
            notes.append(f"mass properties: the faces of this part do not meet exactly (there are gaps "
                         f"between them), so its volume is uncertain by about {p['gaps']:.0e} of its value: "
                         f"integrated as the faces are, {p['volume']:.10g}")
        said = p.setdefault("said", set())
        for note in notes:
            if note not in said:
                said.add(note)
                import warnings

                warnings.warn(note, RuntimeWarning, stacklevel=3)
        return p

    def _kernel_props(self, accuracy: float) -> dict[str, Any]:
        """The kernel's own integration (SmBrep::ComputePreciseProperties) at a coarse
        accuracy, for the quick checks of operations (the sign of a volume, a rough change).
        Cheap, but its error is not bounded by ``accuracy``: the volume can be 300 times worse.
        A body whose faces are misbuilt can fail it."""
        with kernel_call("mass properties", "is the part a closed solid?"):
            return ext.brep_properties(self._brep, accuracy, 1.0)

    def _quick_volume(self, accuracy: float = 1e-6) -> float:
        """The volume for a plausibility check with a margin of 1e-3 or more: the measured one
        if the part has it, else the kernel's quick integration at ``accuracy`` (see
        ``_kernel_props``)."""
        if self._h.props is not None:
            return float(self._h.props["volume"])
        return float(self._kernel_props(accuracy)["volume"])

    @property
    def volume(self) -> float:
        return float(self._measured()["volume"])

    @property
    def area(self) -> float:
        """Total surface area."""
        return float(self._measured()["area"])

    def center(self) -> Vector:
        """Center of mass (uniform density)."""
        p = self._measured()
        return Vector(p["origin"]) + Vector(p["first_moments"]) / p["volume"]

    def mass_properties(self, density: float = 1.0, accuracy: float | None = None) -> MassProperties:
        """Mass, center of mass and inertia tensor for a uniform ``density``.

        ``accuracy`` is the relative accuracy of the results (default ``ACCURACY``, 1e-7;
        from 1e-10 to 1e-2): volume, mass and area to ``accuracy`` of their value, the center
        to ``accuracy`` times the size of the part (its bounding box diagonal), the inertia
        to ``accuracy`` times its largest principal moment.
        """
        if not density > 0:
            raise ValueError("mass_properties: the density must be positive")
        if accuracy is not None and not 1e-10 <= accuracy <= 1e-2:
            raise ValueError("mass_properties: accuracy must be between 1e-10 and 1e-2")
        p = self._measured(accuracy)
        volume = float(p["volume"])
        d = Vector(p["first_moments"]) / volume  # centroid relative to the origin of integration
        xx, yy, zz, yz, zx, xy = p["second_moments"]
        i_o = np.array([[yy + zz, -xy, -zx], [-xy, xx + zz, -yz], [-zx, -yz, xx + yy]], dtype=float)
        dv = np.array(d.to_tuple())
        i_c = i_o - volume * (dv.dot(dv) * np.eye(3) - np.outer(dv, dv))
        return MassProperties(density * volume, volume, float(p["area"]), Vector(p["origin"]) + d,
                              density * i_c, density)

    def is_valid(self) -> bool:
        """True if the part is a closed, manifold solid that encloses a positive volume.

        (A body whose faces point inward, or that encloses no volume, such as a profile
        revolved about an axis through it, is not valid.)
        """
        return self._solid_problem() is None

    def _solid_problem(self, volume: float | None = None) -> str | None:
        """Why this is not a sound solid (``"empty"``, ``"inside out (negative volume)"``,
        ...), or None. The volume is integrated coarsely (or ``volume``, which the caller
        integrated anyway, is used): this catches broken bodies, not small errors. A body
        found sound is not checked again."""
        if self._h.sound:
            return None
        problem = self._shape_problem()
        if problem is None:
            if volume is None and self._h.props is not None:
                volume = float(self._h.props["volume"])  # measured already
            if volume is None:
                try:
                    volume = float(self._kernel_props(1e-3)["volume"])
                except KernelError:
                    return "a body whose volume cannot be integrated"
            tiny = 1e-9 * self._extent() ** 3
            if volume < -tiny:
                problem = "inside out (negative volume)"
            elif not volume > tiny:  # also a NaN volume
                problem = "without volume"
        self._h.sound = problem is None
        return problem

    def _shape_problem(self) -> str | None:
        """The checks of ``_solid_problem`` that need no volume integration."""
        b = self._brep
        if b.face_count() == 0:
            return "empty"
        if not b.is_manifold_solid():
            return "not a closed, manifold solid"
        size = self._extent()
        if not (math.isfinite(size) and size > 0):  # a body scaled by 0 has a NaN box
            return "degenerate (its bounding box is not finite or has zero size)"
        return None

    def _extent(self) -> float:
        """Diagonal of the kernel's loose bounding box (the tight ``bbox()`` can cost more
        than a volume integration)."""
        lo, hi = self._brep.bounding_box(False)
        return math.dist(lo, hi)

    def _require_valid(self, what: str) -> None:
        """Refuse to run a feature on a broken body (the kernel may crash on one)."""
        problem = self._solid_problem()
        if problem is not None:
            raise ModelingError(f"{what}: the part is not a valid solid ({problem}); check is_valid() "
                                f"after each step and fix the step that broke it")

    def solids(self) -> ShapeList[Part]:
        """The separate bodies of this part."""
        with kernel_call("solids"):
            parts = ext.separate_bodies(self._brep)
        return ShapeList(Part._wrap(b, name=self.name, color=self.color) for b in parts)

    # -- booleans -------------------------------------------------------------
    def _boolean(self, others: Any, op: Any, name: str) -> Part:
        tools = _bodies(others, name)
        for t in tools:
            if isinstance(t, Sketch) or not isinstance(t, (Part, Shell)):
                kind = type(t).__name__
                extra = "; extrude it first" if isinstance(t, Sketch) else ""
                raise TypeError(f"cannot {name} a {kind} with a Part{extra}")
        if not all(isinstance(t, Part) for t in tools):  # sheets: imprint or trim, unchecked
            return self._like(self._run_boolean(tools, op, name))
        try:
            result: Part | None = self._like(self._run_boolean(tools, op, name))
            failure: KernelError | None = None
            problem = self._boolean_problem(result, tools, op)
        except KernelError as e:
            result, failure, problem = None, e, None
        if result is not None and problem is None:
            return result
        if len(tools) > 1:
            # Tools that overlap each other (two holes side by side) can fail one after the
            # other where the combined tool works: combine them first.
            try:
                combine = k.BooleanOp.INTERSECTION if op == k.BooleanOp.INTERSECTION else k.BooleanOp.UNION
                combined = tools[0]._like(tools[0]._run_boolean(tools[1:], combine, name))
                if combined._brep.face_count() == 0 and op == k.BooleanOp.INTERSECTION:
                    return self._like(combined._copy_brep())  # the tools have nothing in common
                if combined._solid_problem() is None:
                    retry = self._like(self._run_boolean([combined], op, name))
                    if self._boolean_problem(retry, [combined], op) is None:
                        return retry
            except KernelError:
                pass
        broken = [x for x in (self, *tools) if x._solid_problem() is not None]
        if broken:
            which = "the part" if broken[0] is self else "a tool"
            raise ModelingError(f"{name}: {which} is not a valid solid ({broken[0]._solid_problem()}); check "
                                f"is_valid() of the operands and fix the step that broke them")
        hint = ("the operands may touch only along an edge, at a point or tangentially (move one so they "
                "overlap), or a tool overlaps an earlier cut or boss along a parallel face (combine the tools "
                "first and apply them at once: part - (tool1 + tool2))")
        if failure is not None:
            raise KernelError(failure.operation, failure.detail, failure.status, hint) from failure
        raise ModelingError(f"{name}: the kernel returned a result that is {problem}; {hint}")

    def _run_boolean(self, tools: Sequence[_Body], op: Any, name: str) -> Any:
        result = self._copy_brep()
        for t in tools:
            with kernel_call(name, "the operands may touch only in a degenerate way, or an operand is broken"):
                result = k.boolean(result, t._copy_brep(), operation=op)
        return result

    def _boolean_problem(self, result: Part, tools: Sequence[Part], op: Any) -> str | None:
        """What is wrong with a Boolean result, or None. An empty result is right where the
        operands say so (a cut by a tool that encloses the part, an intersection of bodies
        apart from each other)."""
        if result._brep.face_count() != 0:
            problem = result._shape_problem()
            if problem is None and all(x._solid_problem() is None for x in (self, *tools)):
                # Closed and manifold, from sound operands: the kernel does not turn such a
                # result inside out (touching operands give empty or non-manifold results),
                # so its volume, which costs far more than the Boolean, is not integrated.
                result._h.sound = True
                return None
            return problem or result._solid_problem()
        if op == k.BooleanOp.UNION:
            return "empty"
        if op == k.BooleanOp.INTERSECTION:
            if len(tools) > 1:
                return None  # the common volume of several tools may well be empty
            rel = _relationship(self, tools[0])
            return None if rel in ("separate", "touching") else "empty"
        try:
            whole = self._kernel_props(1e-6)["volume"]
        except KernelError:
            return "empty"
        for t in tools:
            if _relationship(t, self) == "separate":
                continue
            # right only if the tool covers the whole part
            try:
                with kernel_call("cut"):
                    common = Part._wrap(k.boolean(self._copy_brep(), t._copy_brep(),
                                                  operation=k.BooleanOp.INTERSECTION))
                if common._kernel_props(1e-6)["volume"] >= whole * (1 - 1e-5):
                    return None
            except KernelError:
                pass
        return "empty"

    def fuse(self, *others: Part | Iterable[Part]) -> Part:
        """Union with other parts."""
        return self._boolean(others, k.BooleanOp.UNION, "fuse")

    def cut(self, *others: Part | Iterable[Part]) -> Part:
        """Subtract other parts."""
        return self._boolean(others, k.BooleanOp.DIFFERENCE, "cut")

    def intersect(self, *others: Part | Iterable[Part]) -> Part:
        """Keep only the volume shared with the other parts."""
        return self._boolean(others, k.BooleanOp.INTERSECTION, "intersect")

    def __add__(self, other: Any) -> Part:
        return self.fuse(other)

    def __radd__(self, other: Any) -> Part:
        if other == 0:  # sum([...])
            return self
        return self.fuse(other)

    def __sub__(self, other: Any) -> Part:
        return self.cut(other)

    def __and__(self, other: Any) -> Part:
        return self.intersect(other)

    # -- topology selection on this part --------------------------------------
    def _own_edges(self, edges: Any) -> list[Any]:
        """Kernel edges of this part for the given edge selection."""
        sel = _flatten_edges(edges)
        out = []
        candidates: list[tuple[Any, Vector, Vector, Vector]] | None = None
        tol = 1e-6 * max(1.0, self.bbox().diagonal)
        for e in sel:
            if e._e is not None and e._owner is not None and e._owner._h is self._h:
                out.append(e._e)
                continue
            # An edge of another body (e.g. an earlier version of this part): match by geometry.
            if candidates is None:
                candidates = []
                for ke in self._brep.edges():
                    own = Edge._of(self, ke)
                    candidates.append((ke, own.start, own.end, own.center()))
            s, t, m = e.start, e.end, e.center()
            for ke, a, b, c in candidates:
                if c.is_close(m, tol) and ((a.is_close(s, tol) and b.is_close(t, tol)) or (a.is_close(t, tol) and b.is_close(s, tol))):
                    out.append(ke)
                    break
            else:
                raise ValueError(f"{e!r} is not an edge of this part")
        if not out:
            raise ValueError("no edges selected")
        return out

    def _own_faces(self, faces: Any) -> list[Any]:
        sel = _flatten_faces(faces)
        out = []
        tol = 1e-6 * max(1.0, self.bbox().diagonal)
        own_faces: list[Face] | None = None
        for f in sel:
            if f._owner is not None and f._owner._h is self._h:
                out.append(f._f)
                continue
            # A face of another body: the face of ours that contains its interior point and
            # has the same area.
            if own_faces is None:
                own_faces = list(self.faces())
            p = f.interior_point()
            area = f.area
            for g in own_faces:
                if g.distance_to(p) <= tol and abs(g.area - area) <= 1e-6 * max(1.0, area):
                    out.append(g._f)
                    break
            else:
                raise ValueError(f"{f!r} is not a face of this part")
        return out

    def _sharp_edges(self, edges: Any, operation: str) -> list[Edge]:
        """The selected edges without seams and tangent (smooth) edges, which cannot be rounded."""
        sel = _flatten_edges(edges)
        out = []
        for e in sel:
            if e.is_seam:
                continue
            fs = e.faces()
            if len(fs) == 2:
                p = e.center()
                try:
                    if fs[0].normal_at(p).angle_to(fs[1].normal_at(p)) < 0.5:
                        continue
                except (KernelError, ValueError):
                    pass
            out.append(e)
        if not out:
            raise ValueError(f"{operation}: the selection holds only seam or smooth edges, nothing to {operation}")
        return out

    def _check_round_sizes(self, edges: list[Edge], setbacks: list[float], what: str, size_name: str) -> None:
        """Reject rounds that cannot fit: on a face, two edges running alongside each other
        must be further apart than their setbacks. (The kernel does not always notice and
        may return an invalid solid.)"""
        setback_of = {e._identity(): s for e, s in zip(edges, setbacks)}
        for e, s in zip(edges, setbacks):
            ends = {v._identity() for v in e.vertices()}
            samples = [e.point_at(t) for t in (0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0)]
            for f in e.faces():
                for g in f.edges():
                    if g._identity() == e._identity() or ends & {v._identity() for v in g.vertices()}:
                        continue  # the same edge, or a neighbour meeting it at a corner
                    total = s + setback_of.get(g._identity(), 0.0)
                    dists = [_distance_to_edge(g, p) for p in samples]
                    near = min(dists)
                    if near >= total - 1e-9 or max(dists) > 1.5 * max(near, 1e-12):
                        continue  # far enough, or not running alongside
                    limit = near / 2 if g._identity() in setback_of else near
                    raise ModelingError(
                        f"{what}: the {size_name} is too large; the rounds on edges {near:.4g} apart would "
                        f"overlap (largest possible setback here: {limit:.4g})")

    @staticmethod
    def _setback(e: Edge, radius: float) -> float:
        """Distance from the edge to where a circular round of ``radius`` meets the faces."""
        fs = e.faces()
        if len(fs) != 2:
            return radius
        p = e.center()
        theta = math.radians(fs[0].normal_at(p).angle_to(fs[1].normal_at(p)))
        return radius * math.tan(theta / 2) if theta > 1e-6 else radius

    def _check_volume_change(self, result: Part, edges: list[Edge], what: str, sizes: list[float],
                             shape: str) -> None:
        """Check a fillet or chamfer result: a valid solid whose volume changed in the right
        direction and by no more than the rounds can take away or add.

        ``sizes`` are the radii (``shape`` "circular" or "blend") or the setbacks
        (``shape`` "chamfer"). Near the size limit the kernel can return a valid-looking
        body with whole regions missing.
        """
        size = sizes[0] if len(set(sizes)) == 1 else max(sizes)
        bound = _round_volume_bound(edges, sizes, shape)
        accuracy = 1e-6 if bound is not None else 1e-4  # the bound needs the change accurately
        before = after = None
        problem = result._shape_problem()
        if problem is None:
            try:
                before = self._kernel_props(accuracy)["volume"]
                after = result._kernel_props(accuracy)["volume"]
            except KernelError:
                pass
            problem = result._solid_problem(after)  # integrates once more only if that failed
        if problem is not None:
            raise KernelError(what, f"kernel result is {problem}", None,
                              f"the {'radius' if shape != 'chamfer' else 'length'} may be too large for the "
                              f"selected edges (it is {size:.4g})")
        if before is None or after is None:
            return
        convex = [e.convexity == "convex" for e in edges]
        grows = after > before * (1 + 1e-3)
        if all(convex) and grows or not any(convex) and after < before * (1 - 1e-3):
            raise KernelError(what, "kernel result failed the volume check", None,
                              "the size is too large for the selected edges")
        if bound is not None and abs(after - before) > bound + 1e-5 * abs(before):
            size_name = "length" if shape == "chamfer" else "radius"
            raise ModelingError(f"{what}: the kernel returned a wrong body (the volume changed by "
                                f"{abs(after - before):.6g}, at most {bound:.6g} is possible); the {size_name} "
                                f"{size:.4g} is too close to the largest the selected edges allow, use a smaller one")

    def _with_edges(self, edges: Any) -> tuple[BrepHandle, list[Any]]:
        own = self._own_edges(edges)
        copy, _, mapped, _ = ext.copy_with_map(self._brep, [], own, [])
        return BrepHandle(copy), list(mapped)

    def _with_faces(self, faces: Any) -> tuple[BrepHandle, list[Any]]:
        own = self._own_faces(faces)
        copy, mapped, _, _ = ext.copy_with_map(self._brep, own, [], [])
        return BrepHandle(copy), list(mapped)

    # -- features ---------------------------------------------------------------
    def fillet(
        self,
        edges: Any,
        radius: float | tuple[float, float] | Sequence[float],
        *,
        continuity: int | str | None = None,
        fullness: float = 1.0,
    ) -> Part:
        """Round edges.

        Args:
            edges: Edges of this part (a selection, a single edge, or faces whose edges
                to round).
            radius: Fillet radius. A ``(start, end)`` tuple varies the radius linearly
                along each edge. A list with one radius per edge rounds edges differently.
            continuity: ``None`` for a circular fillet. ``"G2"`` or ``"G3"`` make a
                curvature-continuous blend (``"G1"`` a tangent blend) instead of a circular
                arc: no visible highlight seam, as used for consumer and Class-A surfaces.
            fullness: Shape of a blend cross-section; above 1 fuller, below 1 flatter.
        """
        self._require_valid("fillet")
        given = [float(r) for r in (radius if isinstance(radius, (tuple, list, np.ndarray)) else [radius])]
        if any(not r > 0 for r in given):
            raise ValueError("fillet: the radius must be positive")
        sel = self._sharp_edges(edges, "fillet")
        if isinstance(radius, tuple) and len(radius) == 2:
            radii = [max(float(radius[0]), float(radius[1]))] * len(sel)
        elif isinstance(radius, (list, np.ndarray)):
            radii = [float(r) for r in radius]
        else:
            radii = [float(radius)] * len(sel)
        if len(radii) == len(sel):
            self._check_round_sizes(sel, [self._setback(e, r) for e, r in zip(sel, radii)], "fillet", "radius")
        h, kedges = self._with_edges(sel)
        cont = _continuity(continuity)
        with kernel_call("fillet", "the radius may be too large for the selected edges"):
            if isinstance(radius, tuple) and len(radius) == 2:
                k.variable_radius_fillet(h.brep, kedges, start_radius=float(radius[0]), end_radius=float(radius[1]),
                                         xsect_type=1 if cont is None else 2, continuity=cont or 1)
            elif isinstance(radius, (list, np.ndarray)):
                radii = [float(r) for r in radius]
                if len(radii) != len(kedges):
                    raise ValueError(f"{len(radii)} radii for {len(kedges)} edges")
                xs = [k.FilletXSect.BLEND if cont else k.FilletXSect.CIRCULAR] * len(kedges)
                k.fillet_edges_per_edge(h.brep, kedges, radii, xs, continuity=cont or 1, thumbweight=fullness)
            elif cont is None:
                k.fillet_edges(h.brep, kedges, radius=float(radius))
            else:
                k.fillet_edges(h.brep, kedges, radius=float(radius), xsect_type=2, continuity=cont, thumbweight=fullness)
        result = self._like(_take(h))
        if isinstance(radius, tuple) and len(radius) == 2:
            sizes = [max(float(radius[0]), float(radius[1]))] * len(sel)
        elif isinstance(radius, (list, np.ndarray)):
            sizes = [float(r) for r in radius]
        else:
            sizes = [float(radius)] * len(sel)
        self._check_volume_change(result, sel, "fillet", sizes, "circular" if cont is None else "blend")
        return result

    def chamfer(self, edges: Any, length: float) -> Part:
        """Bevel edges. ``length`` is the setback measured along both adjacent faces."""
        self._require_valid("chamfer")
        if not float(length) > 0:
            raise ValueError("chamfer: the length must be positive")
        sel = self._sharp_edges(edges, "chamfer")
        self._check_round_sizes(sel, [float(length)] * len(sel), "chamfer", "length")
        radii = []
        for e in sel:
            fs = e.faces()
            if len(fs) == 2:
                p = e.center()
                theta = math.radians(fs[0].normal_at(p).angle_to(fs[1].normal_at(p)))
                radii.append(length / math.tan(theta / 2) if theta > 1e-6 else length)
            else:
                radii.append(length)
        h, kedges = self._with_edges(sel)
        with kernel_call("chamfer", "the length may be too large for the selected edges"):
            xs = [k.FilletXSect.CIRCULAR] * len(kedges)
            if all(abs(r - radii[0]) < 1e-12 for r in radii):
                k.fillet_edges(h.brep, kedges, radius=radii[0], xsect_type=0)
            else:
                # per-edge radii with a linear cross-section
                for ke, r in zip(kedges, radii):
                    k.fillet_edges(h.brep, [ke], radius=r, xsect_type=0)
        del xs
        result = self._like(_take(h))
        self._check_volume_change(result, sel, "chamfer", [float(length)] * len(sel), "chamfer")
        return result

    def shell(self, thickness: float, openings: Any = None, *, outward: bool = False) -> Part:
        """Hollow the part out to walls of ``thickness``, removing the ``openings`` faces.

        The walls grow inward (the outside keeps its size) unless ``outward`` is true.
        """
        self._require_valid("shell")
        if not abs(float(thickness)) > 0:
            raise ValueError("shell: the thickness must not be zero")
        faces = self._own_faces(openings) if openings is not None else []
        if not outward:
            self._check_wall_fits(abs(float(thickness)), faces)
        d = abs(thickness) if outward else -abs(thickness)

        tries = iter([False, False] + [True] * 6)

        def attempt() -> Part:
            # The kernel's "extended" offset mode is not deterministic; the plain mode is,
            # and handles most parts. Fall back to the extended mode when needed.
            extended = next(tries, True)
            with kernel_call("shell", "the wall may be thicker than the part allows"):
                return self._like(k.shell_brep(self._brep, d, extended_offset=extended, faces_to_shell=faces))

        grow = abs(thickness) if outward else 0.0
        return self._checked("shell", attempt, grow=grow, smaller=True)  # a wall has less volume

    def _check_wall_fits(self, t: float, openings: list[Any]) -> None:
        """Refuse inward walls that cannot fit: along each axis the part must be thicker than
        its walls (two, or one where an opening faces that way). The kernel returns wrong
        bodies there, or crashes."""
        box = self.bbox()
        tol = 1e-6 * max(box.diagonal, 1.0)
        open_sides: set[tuple[int, int]] = set()
        for kf in openings:
            f = Face(self, kf)
            if not f.is_planar:
                continue
            n = f.normal_at()
            for i in range(3):
                if abs(abs(n[i]) - 1.0) < 1e-9:
                    side = 1 if n[i] > 0 else -1
                    level = (box.max if side > 0 else box.min)[i]
                    if abs(f.center()[i] - level) <= tol:
                        open_sides.add((i, side))
        for i, axis in enumerate("XYZ"):
            walls = 2 - ((i, 1) in open_sides) - ((i, -1) in open_sides)
            size = box.max[i] - box.min[i]
            if walls and walls * t >= size - tol:
                if walls == 2:
                    raise ModelingError(f"shell: two walls of {t:.4g} do not fit into the part, which is {size:.4g} "
                                        f"thick along {axis}; use a thinner wall")
                raise ModelingError(f"shell: a wall of {t:.4g} does not fit into the part, which is {size:.4g} deep "
                                    f"along {axis} from the opening; use a thinner wall")

    def offset(self, distance: float) -> Part:
        """Grow (positive) or shrink (negative) the part by ``distance`` everywhere."""
        self._require_valid("offset")

        def attempt() -> Part:
            with kernel_call("offset"):
                return self._like(k.offset_brep(self._brep, float(distance)))

        return self._checked("offset", attempt, grow=max(float(distance), 0.0), smaller=distance < 0)

    def _checked(self, name: str, attempt: Callable[[], Part], *, grow: float, smaller: bool,
                 attempts: int = 8) -> Part:
        """Run a kernel operation whose result the kernel does not always get right, check the
        result and retry. (SMLib's offset machinery depends on memory order and occasionally
        returns a solid with misplaced faces.)"""
        box = self.bbox()
        tol = 1e-6 * max(box.diagonal, 1.0) + grow
        try:
            before = self._kernel_props(1e-4)["volume"]
        except KernelError:
            before = None
        last: Exception | None = None
        for _ in range(attempts):
            try:
                result = attempt()
            except KernelError as e:
                last = e
                continue
            if not result.is_valid():
                continue
            rb = result.bbox()
            if any(rb.min[i] < box.min[i] - tol or rb.max[i] > box.max[i] + tol for i in range(3)):
                continue
            try:
                # a misbuilt face shows up as a failing integration at this accuracy
                after = result._kernel_props(1e-6)["volume"]
            except KernelError:
                continue
            if before is not None and after > 0 and ((after < before) == smaller or abs(after - before) < 1e-9 * before):
                return result
        if last is not None:
            raise last
        raise ModelingError(f"{name}: the kernel could not build a valid result; try a smaller value")

    def split(self, plane: Plane | Face, keep: str = "above") -> Any:
        """Cut the part with a plane.

        ``keep="above"`` keeps the side the plane normal points to, ``"below"`` the other
        side, ``"both"`` returns ``(above, below)``.
        """
        pl = _as_plane(plane)
        if keep == "both":
            return self.split(pl, "above"), self.split(pl, "below")
        if keep not in ("above", "below"):
            raise ValueError('keep must be "above", "below" or "both"')
        # Intersect with a half-space box: exact, and caps the cut (the kernel's plane cut
        # leaves the body open).
        from .parts import Box

        bb = self.bbox()
        size = 4.0 * (bb.diagonal + bb.center.distance_to(pl.origin)) + 1.0
        side = pl if keep == "above" else pl.flipped()
        halfspace = Box(size, size, size).translate(0, 0, size / 2).moved(Plane(pl.project(bb.center), side.x_dir, side.z_dir).location)
        with kernel_call("split"):
            kept = self & halfspace
        if kept._brep.face_count() == 0:
            raise ModelingError(f"split: nothing of the part lies {keep} the plane")
        return kept

    def section(self, plane: Plane | Face = Plane.XY) -> Sketch:
        """The cross-section of the part in a plane, as a sketch."""
        pl = _as_plane(plane)
        with kernel_call("section"):
            curves = k.intersect_brep_with_plane(self._brep, pl.origin.to_tuple(), pl.z_dir.to_tuple())
        if not curves:
            raise ValueError("the plane does not cut the part")
        with kernel_call("section"):
            b = k.create_planar_faces(list(curves))
        return Sketch._wrap(b, pl)

    # -- deformations (smlibpy.deform) ---------------------------------------
    def twist(self, angle: float, **kwargs: Any) -> Part:
        """Twist about an axis (default Z) by ``angle`` degrees over the part; see :func:`smlibpy.twist`."""
        from .deform import twist

        return twist(self, angle, **kwargs)

    def taper(self, scale: float, **kwargs: Any) -> Part:
        """Scale cross-sections toward an axis (default Z) from 1 to ``scale``; see :func:`smlibpy.taper`."""
        from .deform import taper

        return taper(self, scale, **kwargs)

    def bend(self, angle: float, **kwargs: Any) -> Part:
        """Bend around an axis by ``angle`` degrees (default: along X, toward +Z); see :func:`smlibpy.bend`."""
        from .deform import bend

        return bend(self, angle, **kwargs)

    def deform(self, lattice: Any, **kwargs: Any) -> Part:
        """Deform with a :class:`smlibpy.Lattice` (same as ``lattice.apply(part)``)."""
        return lattice.apply(self, **kwargs)

    def remove_fillets(self, faces: Any = None, *, max_radius: float | None = None, partial: bool = False) -> Part:
        """The part with fillets taken out and their edges sharp again: ``faces`` (fillet faces
        of this part), or all fillets up to ``max_radius``. With ``partial`` the fillets the
        kernel cannot take out stay. See :mod:`smlibpy.defeature`."""
        from .defeature import remove_fillets

        return remove_fillets(self, faces, max_radius=max_radius, partial=partial)

    def remove_faces(self, faces: Any, *, partial: bool = False) -> Part:
        """The part with ``faces`` (a hole, a boss, a pocket) cut out and the gap closed by the
        faces around it. With ``partial`` the features the kernel cannot close stay. See
        :mod:`smlibpy.defeature`."""
        from .defeature import remove_faces

        return remove_faces(self, faces, partial=partial)

    def draft_analysis(self, direction: Axis | VectorLike, *, min_angle: float = 1.0) -> Any:
        """Draft angle of every face for the pull direction, with the faces grouped by whether
        they release (see :class:`smlibpy.draft.DraftAnalysis`)."""
        from .draft import draft_analysis

        return draft_analysis(self, direction, min_angle=min_angle)

    def parting_line(self, direction: Axis | VectorLike) -> ShapeList[Wire]:
        """The closed lines where the part's surface turns from facing ``direction`` to facing
        away from it (see :func:`smlibpy.draft.parting_line`)."""
        from .draft import parting_line

        return parting_line(self, direction)

    def draft(self, faces: Any, angle: float, neutral_plane: Plane | Face) -> Part:  # pragma: no cover - planned
        raise NotImplementedError("face drafts are not available in the open-source kernel yet; "
                                  "use Sketch.extrude(taper=...) for drafted extrusions")

    # -- sheet metal (the logic is in smlibpy.sheetmetal) ------------------------
    def fold(self, line: Any, angle: float, *, radius: float, k_factor: float = 0.44, fixed: Any = None,
             partial: bool = False) -> Part:
        """Fold this sheet along a line on its top or bottom face (see :func:`smlibpy.fold`)."""
        from .sheetmetal import fold

        return fold(self, line, angle, radius=radius, k_factor=k_factor, fixed=fixed, partial=partial)

    def flange(self, edge: Any, length: float, *, angle: float = 90.0, radius: float, k_factor: float = 0.44) -> Part:
        """Add a flange along a straight outer edge of this sheet (see :func:`smlibpy.flange`)."""
        from .sheetmetal import flange

        return flange(self, edge, length, angle=angle, radius=radius, k_factor=k_factor)

    def bends(self, *, k_factor: float = 0.44) -> list[Any]:
        """The bends of this sheet metal part (see :func:`smlibpy.sheetmetal.bends`)."""
        from .sheetmetal import bends

        return bends(self, k_factor=k_factor)

    def unfold(self, *, k_factor: float = 0.44, fixed: Face | None = None) -> Part:
        """This sheet metal part unfolded flat (see :func:`smlibpy.unfold`)."""
        from .sheetmetal import unfold

        return unfold(self, k_factor=k_factor, fixed=fixed)

    def flat_pattern(self, *, k_factor: float = 0.44, fixed: Face | None = None) -> Any:
        """The flat pattern of this sheet metal part on XY (see :func:`smlibpy.flat_pattern`)."""
        from .sheetmetal import flat_pattern

        return flat_pattern(self, k_factor=k_factor, fixed=fixed)

    def __repr__(self) -> str:
        try:
            # the volume to the default accuracy: kept with the part for the next query
            vol = f"volume={self._props()['volume']:.6g}"
        except KernelError:
            vol = "not a closed solid"
        n = self._brep.face_count()
        label = f"{self.name!r}, " if self.name else ""
        return f"Part({label}{n} faces, {vol})"


def _fmt_point(p: Vector) -> str:
    return f"({p.x:.6g}, {p.y:.6g}, {p.z:.6g})"


def _revolve_axis_angle(ax: Axis, angle: float) -> tuple[Axis, float]:
    """The axis and the positive angle of a revolve (a negative angle turns the other way)."""
    angle = float(angle)
    if angle == 0 or not math.isfinite(angle):
        raise ValueError("revolve: the angle must not be zero")
    if abs(angle) > 360 + 1e-9:
        raise ValueError("revolve: the angle is at most 360 degrees")
    if angle < 0:
        ax, angle = Axis(ax.origin, -ax.direction), -angle
    return ax, min(angle, 360.0)


def _require_solid(part: Part, what: str, hint: str) -> Part:
    """Raise if a feature returned a broken solid (inside out, without volume, open)."""
    problem = part._solid_problem()
    if problem is not None:
        raise ModelingError(f"{what}: the kernel returned a body that is {problem}; {hint}")
    return part


def _round_volume_bound(edges: list[Edge], sizes: list[float], shape: str) -> float | None:
    """The most volume rounds of the given sizes can remove (convex edges) or add (concave
    edges): each edge's round cross-section swept along it, plus a little at the corners
    where rounds meet. None where an edge is neither straight nor circular, and where an
    edge runs on into one that is not rounded (see ``_runs_on``)."""
    total = 0.0
    corner: dict[Any, float] = {}
    count: dict[Any, int] = {}
    rounded = {e._identity() for e in edges}
    for e, r in zip(edges, sizes):
        kind = e.geom_type
        if kind not in ("line", "circle"):
            return None
        fs = e.faces()
        if len(fs) != 2:
            return None
        if _runs_on(e, rounded):
            return None
        p = e.center()
        try:
            theta = math.radians(fs[0].normal_at(p).angle_to(fs[1].normal_at(p)))
        except (KernelError, ValueError):
            return None
        theta = min(max(theta, 1e-6), math.pi - 1e-6)
        if shape == "chamfer":
            setback = r
            area = 0.5 * setback ** 2 * math.sin(theta)
        else:
            setback = r * math.tan(theta / 2)
            if shape == "circular":
                area = r * r * (math.tan(theta / 2) - theta / 2)
            else:  # a blend stays inside the triangle between its setback lines
                area = 0.5 * setback ** 2 * math.sin(theta)
        length = e.length
        if kind == "circle":
            length *= 1.0 + setback / e.radius  # the round's centroid runs at most this far out
        total += area * length
        for v in e.vertices():
            key = v.point.to_tuple()  # not v._identity(): a dropped vertex wrapper's id is reused
            corner[key] = max(corner.get(key, 0.0), setback)
            count[key] = count.get(key, 0) + 1
    extra = sum(0.1 * corner[key] ** 3 for key in corner if count[key] > 1)
    return 1.1 * total + extra


def _runs_on(e: Edge, rounded: set[Any]) -> bool:
    """True if ``e`` runs on past one of its ends into an edge that is not rounded: one that
    leaves the shared vertex less than 90 degrees away from the direction in which ``e``
    arrives (tangentially, as around a rounded corner, or at a kink, as around a polygon).
    The kernel extends the round there until it leaves the material, which can take away
    much more than the edge's own share."""
    for v in e.vertices():
        own = _leaving(e, v.point)
        for g in v.edges():
            if g._identity() in rounded:
                continue
            if any(a.dot(b) < -1e-6 for a in own for b in _leaving(g, v.point)):
                return True
    return False


def _leaving(e: Edge, p: Vector) -> list[Vector]:
    """The directions in which an edge leaves its end at ``p`` (both ends of a closed edge)."""
    if e.is_closed:
        return [e.tangent_at(0.0), -e.tangent_at(1.0)]
    if e.start.distance_to(p) <= e.end.distance_to(p):
        return [e.tangent_at(0.0)]
    return [-e.tangent_at(1.0)]


def _distance_to_edge(e: Edge, p: Vector) -> float:
    """Distance from a point to an edge (analytic for straight edges)."""
    if e.geom_type == "line":
        a, b = e.start, e.end
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-300)))
        return (a + ab * t).distance_to(p)
    return e.distance_to(p)


def _take(h: BrepHandle) -> Any:
    """Release a handle's Brep to a new owner."""
    b, h.brep = h.brep, None
    return b


def _continuity(c: int | str | None) -> int | None:
    if c is None:
        return None
    if isinstance(c, str):
        c = int(c.upper().lstrip("G"))
    if c not in (1, 2, 3):
        raise ValueError("continuity must be G1, G2 or G3")
    return c


def _flatten_edges(items: Any) -> list[Edge]:
    if isinstance(items, Edge):
        return [items]
    if isinstance(items, (Face, Wire)):
        return list(items.edges())
    out: list[Edge] = []
    for it in items:
        out.extend(_flatten_edges(it))
    return out


def _flatten_faces(items: Any) -> list[Face]:
    if isinstance(items, Face):
        return [items]
    out: list[Face] = []
    for it in items:
        out.extend(_flatten_faces(it))
    return out


class Shell(_Body):
    """A sheet body: one or more faces that do not enclose a volume (surfaces)."""

    __slots__ = ()

    @property
    def area(self) -> float:
        return sum(f.area for f in self.faces())

    def center(self) -> Vector:
        total = 0.0
        c = Vector()
        for f in self.faces():
            a = f.area
            c = c + f.center() * a
            total += a
        return c / total

    def thicken(self, thickness: float, *, both: bool = False) -> Part:
        """Turn the sheet into a solid of ``thickness`` (along the face normals; a negative
        thickness grows against them). With ``both`` the solid is ``thickness`` thick in
        total, half of it to each side of the sheet."""
        d = float(thickness)
        if d == 0:
            raise ValueError("thicken: the thickness must not be zero")
        hint = ("the kernel cannot offset this sheet (closed grid surfaces and surfaces with a pole fail; "
                "build closed shapes with revolve, loft or extrude, or thicken less than the smallest "
                "concave radius)")
        if both:
            # one side, then the other, fused: the two halves share the sheet
            return self.thicken(d / 2) + self.thicken(-d / 2)
        with kernel_call("thicken", hint):
            b = k.shell_brep(self._brep, d, create_solid=True)
        return _require_solid(Part._wrap(b, name=self.name, color=self.color), "thicken", hint)

    def __add__(self, other: Any) -> Shell:
        b = self._copy_brep()
        for t in _bodies(other):
            with kernel_call("fuse"):
                b = k.boolean(b, t._copy_brep(), operation=k.BooleanOp.UNION)
        return self._like(b)

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self._brep.face_count()} faces, area={self.area:.6g})"


class Sketch(Shell):
    """A planar region (with holes, possibly several pieces) on a plane.

    Sketch constructors build in the world XY plane around the origin; place a sketch
    with ``.on(plane_or_face)``, ``Plane * sketch`` or ``Pos(...) * sketch``. Combine
    sketches with ``+``, ``-``, ``&`` and ``^``, change them with :meth:`offset`,
    :meth:`fillet`, :meth:`chamfer` and :meth:`mirror`, then turn them into parts with
    :meth:`extrude`, :meth:`revolve`, :meth:`sweep` or :func:`~smlibpy.loft`. Outlines that
    are awkward as combinations of shapes are drawn with :class:`~smlibpy.Profile`.
    """

    __slots__ = ("_plane", "_loops")

    @classmethod
    def _wrap(cls, brep: Any, plane: Plane | None = None, **kwargs: Any) -> Sketch:  # type: ignore[override]
        s = super()._wrap(brep, **kwargs)
        s._plane = plane if plane is not None else Plane.XY
        s._loops = None
        return s

    def _like(self, brep: Any) -> Sketch:
        return Sketch._wrap(brep, self._plane, name=self.name, color=self.color)

    @classmethod
    def _from_wires(cls, wires: Sequence[Wire], plane: Plane | None = None) -> Sketch:
        curves = []
        for w in wires:
            if not w.is_closed:
                raise ValueError("a sketch region needs closed wires; use wire.close()")
            curves.extend(_merged_lines(w)._copy_curves())
        if plane is None:
            plane = wires[0].plane()
            if plane.z_dir.dot(Z.direction) < -1e-9 or (abs(plane.z_dir.z) < 1e-9 and plane.z_dir.dot((1, 1, 0)) < 0):
                plane = plane.flipped()
        with kernel_call("make face", "the wire must be planar and must not cross itself"):
            b = k.create_planar_faces(curves)
        return cls._wrap(b, plane)

    @property
    def plane(self) -> Plane:
        """The sketch plane; extrusions follow its normal."""
        return self._plane

    def _transformed(self, m: np.ndarray) -> Sketch:
        s = super()._transformed(m)
        loc = Location(m)
        p = self._plane
        origin = loc * p.origin
        x = Vector(m[:3, :3] @ np.array(p.x_dir.to_tuple()))
        y = Vector(m[:3, :3] @ np.array(p.y_dir.to_tuple()))
        z = x.cross(y)
        s._plane = Plane(origin, x, z)
        return s

    # -- 2D booleans ----------------------------------------------------------
    def _boolean2d(self, other: Any, op: Any, name: str) -> Sketch:
        try:
            tools = _bodies(other, name)
        except TypeError:
            raise TypeError(f"cannot {name} a {type(other).__name__} with a Sketch: both sides must be sketches (or a "
                            f"list of sketches). Make a region from curves with make_face(...) or Profile(...).close()"
                            ) from None
        for t in tools:
            if not isinstance(t, Sketch):
                raise TypeError(f"cannot {name} a {type(t).__name__} with a Sketch")
            if not self.plane.is_coplanar(t.plane, 1e-6 * max(1.0, self._loose_box().union(t._loose_box()).diagonal)):
                raise ValueError(f"cannot {name} sketches in different planes; place both on the same plane first")
        result: Sketch = self
        if op == k.BooleanOp2D.UNION or op == k.BooleanOp2D.DIFFERENCE:
            # Tools that do not overlap each other go into one kernel call.
            for batch in _disjoint_batches(tools):
                result = result._boolean2d_with(batch, op, name)
        else:
            for t in tools:
                result = result._boolean2d_with([t], op, name)
        return result

    def _boolean2d_with(self, tools: list[Sketch], op: Any, name: str) -> Sketch:
        from ._regions import rebuilt_brep

        if not tools:
            return self
        empty_self = not self._brep.face_count()
        if empty_self or not any(t._brep.face_count() for t in tools):
            if op == k.BooleanOp2D.INTERSECTION:
                return self._empty()
            if empty_self and op != k.BooleanOp2D.DIFFERENCE:
                with kernel_call(name):
                    return self._like(ext.combine([t._brep for t in tools]))
            return self
        box = tools[0]._loose_box()
        for t in tools[1:]:
            box = box.union(t._loose_box())
        if _disjoint(self._loose_box(), box):
            if op == k.BooleanOp2D.UNION or op == k.BooleanOp2D.EXCLUSIVE_OR:
                with kernel_call(name):
                    return self._like(ext.combine([self._brep, *(t._brep for t in tools)]))
            if op == k.BooleanOp2D.DIFFERENCE:
                return self
            return self._empty()
        # The kernel's planar Boolean is exact and fast on bodies built from their curves.
        # On bodies that were moved it can fail, or return a wrong union without an error,
        # so both operands are rebuilt first (see ai/plan/2d.md).
        a = rebuilt_brep(self)
        pieces = [rebuilt_brep(t) for t in tools]
        if a is not None and all(x is not None for x in pieces):
            if len(pieces) > 1:
                with kernel_call(name):
                    b = ext.combine(pieces)
                for x in pieces:
                    ext.delete_brep(x)
            else:
                b = pieces[0]
            try:
                with kernel_call(name):
                    result = self._like(k.boolean_2d(a, b, operation=op))  # consumes a and b
                if self._boolean2d_plausible(tools, result, op):
                    return result
            except KernelError:
                pass
        else:
            for x in [a, *pieces]:
                if x is not None:
                    ext.delete_brep(x)
        # The kernel refused: Booleans of thin slabs in 3D (slower, but robust).
        tool = tools[0]
        if len(tools) > 1:
            with kernel_call(name):
                tool = tool._like(ext.combine([t._brep for t in tools]))
        if op == k.BooleanOp2D.EXCLUSIVE_OR:
            return self._slab_or_empty(tool, k.BooleanOp2D.DIFFERENCE, name)._boolean2d(
                tool._slab_or_empty(self, k.BooleanOp2D.DIFFERENCE, name), k.BooleanOp2D.UNION, name)
        return self._slab_or_empty(tool, op, name)

    def _empty(self) -> Sketch:
        return self._like(ext.copy_faces(self._brep, []))

    def _slab_or_empty(self, other: Sketch, op: Any, name: str) -> Sketch:
        try:
            return self._slab_boolean(other, op, name)
        except ModelingError as e:
            if "empty" in str(e):
                return self._empty()
            raise

    def _boolean2d_plausible(self, tools: list[Sketch], result: Sketch, op: Any) -> bool:
        """A cheap check of a union or exclusive or: its area is at least the larger operand's
        (minus the overlap for xor). Skipped for large sketches, where areas are slow."""
        if op != k.BooleanOp2D.UNION:
            return True
        if self._brep.edge_count() + sum(t._brep.edge_count() for t in tools) > 64:
            return True
        a = self.area
        b = sum(t.area for t in tools)
        r = result.area
        tol = 1e-6 * max(1.0, a, b)
        return max(a, b) - tol <= r <= a + b + tol

    def _slab_boolean(self, other: Sketch, op: Any, name: str) -> Sketch:
        n = self._plane.z_dir
        thickness = max(self._loose_box().union(other._loose_box()).diagonal * 0.05, 1e-3)
        a = self.extrude(thickness, direction=n)
        b = other.extrude(thickness, direction=n)
        # The slabs' Booleans run unchecked: pieces of the result may touch along an edge,
        # which is fine for the faces taken from it.
        if op == k.BooleanOp2D.UNION:
            solid = a._like(a._run_boolean([b], k.BooleanOp.UNION, name))
        elif op == k.BooleanOp2D.DIFFERENCE:
            solid = a._like(a._run_boolean([b], k.BooleanOp.DIFFERENCE, name))
        else:
            solid = a._like(a._run_boolean([b], k.BooleanOp.INTERSECTION, name))
        base = [f for f in solid.faces()
                if f.is_planar and abs(self._plane.distance_to(f.interior_point())) <= 1e-9 * max(1.0, thickness)
                and f.normal_at().dot(n) < 0]
        if not base:
            raise ModelingError(f"{name}: the result is empty")
        with kernel_call(name):
            b2 = ext.copy_faces(solid._brep, [f._f for f in base])
        return self._like(b2)

    def __add__(self, other: Any) -> Sketch:
        return self._boolean2d(other, k.BooleanOp2D.UNION, "fuse")

    def __radd__(self, other: Any) -> Sketch:
        if other == 0:
            return self
        return self + other

    def __sub__(self, other: Any) -> Sketch:
        return self._boolean2d(other, k.BooleanOp2D.DIFFERENCE, "cut")

    def __and__(self, other: Any) -> Sketch:
        return self._boolean2d(other, k.BooleanOp2D.INTERSECTION, "intersect")

    def __xor__(self, other: Any) -> Sketch:
        return self._boolean2d(other, k.BooleanOp2D.EXCLUSIVE_OR, "xor")

    # -- measures -------------------------------------------------------------
    def center(self) -> Vector:
        """Area centroid of the region."""
        if not self.faces():
            raise ValueError("the sketch is empty; it has no center")
        return super().center()

    @property
    def perimeter(self) -> float:
        """Total length of the boundary: outlines and holes."""
        return sum(e.length for f in self.faces() for w in f.wires() for e in w.edges())

    # -- 2D operations --------------------------------------------------------
    def offset(self, distance: float, *, corners: str = "round", round: bool | None = None) -> Sketch:
        """Grow (positive ``distance``) or shrink (negative) the region; holes move the other way.

        ``corners`` shapes the corners that the offset pulls apart (convex ones when growing,
        concave ones when shrinking): ``"round"`` (arcs of radius ``|distance|``), ``"sharp"``
        (the sides extended until they meet) or ``"chamfer"`` (a straight cut across).
        Lines stay lines and arcs stay arcs. Parts that grow into each other merge, parts that
        get too thin vanish; shrinking away the whole region raises :class:`ModelingError`.
        ``round=False`` is the older spelling of ``corners="sharp"``.
        """
        from ._regions import CORNER_STYLES, offset_region

        if round is not None:
            corners = "round" if round else "sharp"
        if corners not in CORNER_STYLES:
            raise ValueError(f"offset: corners is 'round', 'sharp' or 'chamfer', not {corners!r}")
        if distance == 0:
            return self
        result = offset_region(self, distance, corners)
        if result is not None:
            return result
        if corners == "chamfer":
            raise ModelingError("offset: chamfered corners need outlines of lines and arcs; this sketch has a spline "
                                "or an ellipse edge (use corners='round' or 'sharp')")
        return self._kernel_offset(distance, corners == "round")

    def _kernel_offset(self, distance: float, round: bool) -> Sketch:
        """The kernel's offset, for outlines with splines and ellipses."""
        result: Sketch | None = None
        for f in self.faces():
            loops = f.wires()
            # The outer loop moves outward to grow; holes move inward (they shrink).
            region = self._offset_loop(loops[0], abs(distance), grow=distance > 0, round=round)
            for w in loops[1:]:
                hole = self._offset_loop(w, abs(distance), grow=distance < 0, round=round)
                if hole is not None:
                    region = region - hole if region is not None else None
            if region is not None and region.faces():
                result = region if result is None else result + region
        if result is None:
            raise ModelingError(f"offset: shrinking by {abs(distance):g} removes the whole region; use a smaller distance")
        return result

    def _offset_loop(self, wire: Wire, distance: float, *, grow: bool, round: bool) -> Sketch | None:
        """Region bounded by a loop moved ``distance`` outward (grow) or inward."""
        reference = abs(_loop_area(wire))
        for side in (k.OffsetType.LEFT, k.OffsetType.RIGHT):
            try:
                with kernel_call("offset", "the offset may collapse the region"):
                    b = k.create_offset_profile(wire._copy_curves(), distance, offset_type=side, round_corners=round)
            except KernelError:
                if not grow:
                    continue
                raise
            piece = Sketch._wrap(b, self._plane)
            if (piece.area > reference) == grow:
                return piece
        return None

    def fillet(self, radius: float, vertices: Iterable[VectorLike | Vertex] | None = None) -> Sketch:
        """Round corners of the region with tangent arcs of ``radius``.

        ``vertices``: the corners to round, as vertices of this sketch (a selection such as
        ``s.vertices().concave()``) or points; ``None`` rounds every sharp corner. Corners
        between lines and arcs are rounded exactly; a corner that does not fit, a point that
        is not a corner, or a smooth corner raises :class:`ModelingError`.
        """
        from ._regions import round_corners

        if not radius > 0:
            raise ValueError("fillet: the radius must be positive")
        return round_corners(self, float(radius), vertices, "fillet")

    def chamfer(self, length: float, vertices: Iterable[VectorLike | Vertex] | None = None) -> Sketch:
        """Bevel corners of the region: cut back ``length`` along both edges of each corner
        (measured along the edge) and join the two points with a line.

        ``vertices`` as for :meth:`fillet`; ``None`` bevels every sharp corner.
        """
        from ._regions import round_corners

        if not length > 0:
            raise ValueError("chamfer: the length must be positive")
        return round_corners(self, float(length), vertices, "chamfer")

    def mirror(self, plane: Plane | Face | Axis = Plane.XZ) -> Sketch:  # type: ignore[override]
        """A mirrored copy: about an ``Axis`` in the sketch plane (``s.mirror(Y)``), or in a
        plane or planar face (by default the XZ plane, which flips Y).

        Lines stay lines and arcs stay arcs. The sketch keeps facing the same way when the
        mirror is an axis in its own plane, so the mirrored profile extrudes to the same side.
        """
        from ._regions import mirror_sketch

        return mirror_sketch(self, plane)

    # -- to 3D ----------------------------------------------------------------
    def extrude(
        self,
        amount: float,
        *,
        both: bool = False,
        taper: float = 0.0,
        direction: Axis | VectorLike | None = None,
    ) -> Part:
        """Extrude the region into a solid.

        Args:
            amount: Distance along the sketch normal (negative goes the other way).
            both: Extrude ``amount`` to both sides of the sketch.
            taper: Draft angle in degrees; positive narrows the solid away from the sketch.
            direction: Extrude along this direction (an axis or a vector) instead of the normal.
        """
        if amount == 0:
            raise ValueError("extrude amount must not be zero")
        self._require_region("extrude")
        d = _direction(direction, "extrude") if direction is not None else self._plane.z_dir
        if taper:
            return self._extrude_taper(amount, taper, both)
        src = self
        dist = float(amount)
        if both:
            src = self.translate(-d * abs(dist))
            dist = 2 * abs(dist)
        sign = 1.0 if dist > 0 else -1.0
        b = src._copy_brep()
        h = BrepHandle(b)
        with kernel_call("extrude"):
            k.non_manifold_linear_sweep(h.brep, (d * sign).to_tuple(), abs(dist))
        return Part._wrap(_take(h), name=self.name, color=self.color)

    def _extrude_taper(self, amount: float, taper: float, both: bool) -> Part:
        if not abs(taper) < 90:
            raise ValueError("extrude: the taper must be between -90 and 90 degrees")
        hint = "the taper may close the profile before the end"
        parts = []
        for f in self.faces():
            loops = f.wires()
            curves = loops[0]._copy_curves()
            with kernel_call("extrude", hint):
                outer = k.draft_sweep(curves, float(amount), float(taper))
            part = _require_solid(Part._wrap(outer), "extrude", hint)
            n = self._plane.z_dir * (1.0 if amount > 0 else -1.0)
            o = self._plane.origin
            reach = max((v.point - o).dot(n) for v in part.vertices())
            if reach < abs(amount) - 1e-6 * max(1.0, abs(amount)):
                raise ModelingError(f"extrude: the taper of {taper:g} degrees closes the profile after "
                                    f"{reach:.6g} of {abs(amount):g}; use a smaller taper or a shorter extrusion")
            for w in loops[1:]:
                # A hole runs the other way round than the outline; the kernel sweeps a loop
                # along the side its orientation gives, so turn it like the outline. The
                # hole widens where the outline narrows.
                with kernel_call("extrude", hint):
                    hole = Part._wrap(k.draft_sweep(w.reversed()._copy_curves(), float(amount), -float(taper)))
                part = part - _require_solid(hole, "extrude", hint)
            parts.append(part)
        result = parts[0]
        for p in parts[1:]:
            result = result + p
        if both:
            result = result + self._extrude_taper(-amount, taper, False)
        return result

    def revolve(self, axis: Axis | None = None, angle: float = 360.0) -> Part:
        """Revolve the region about an axis in its plane.

        The default axis is the sketch's local Y axis through its plane origin. For the
        centered constructors (``Rectangle``, ``Circle``, ...) and for ``make_face`` that
        origin is the middle of the region, so pass ``axis`` unless the sketch was drawn
        beside its origin (``Polygon((10, 0), (20, 0), ...)``). A negative ``angle``
        turns the other way. The axis must not cross the region (``ModelingError``).
        """
        self._require_region("revolve")
        ax = axis if axis is not None else Axis(self._plane.origin, self._plane.y_dir)
        ax, angle = _revolve_axis_angle(ax, angle)
        n = self._plane.z_dir
        if not ax.direction.is_perpendicular(n):
            raise ValueError("revolve: the axis must lie in the sketch plane (it is not parallel to it)")
        self._check_axis_beside(ax, axis is None)
        o, d = ax.origin.to_tuple(), ax.direction.to_tuple()
        hint = "the axis must not cross the region" + (
            f" (the default axis is the sketch's Y axis through {_fmt_point(ax.origin)}; pass axis=...)"
            if axis is None else "")
        result: Part | None = None
        with kernel_call("revolve", hint):
            for f in self.faces():
                loops = f.wires()
                piece = Part._wrap(k.rotational_sweep(loops[0]._copy_curves(), o, d, float(angle), cap_ends=True))
                for w in loops[1:]:
                    piece = piece - Part._wrap(k.rotational_sweep(w._copy_curves(), o, d, float(angle), cap_ends=True))
                result = piece if result is None else result + piece
        if result is None:
            raise ValueError("empty sketch")
        _require_solid(result, "revolve", hint)
        result.name, result.color = self.name, self.color
        return result

    def _require_region(self, what: str) -> None:
        if not self._brep.face_count():
            raise ModelingError(f"{what}: the sketch is empty (0 faces); the Boolean or offset that made it removed "
                                f"everything")

    def _check_axis_beside(self, ax: Axis, default: bool) -> None:
        """Raise if the axis runs through the region (the kernel then returns a body without
        volume, or an inside-out one, for a full turn)."""
        n = self._plane.z_dir
        side = ax.direction.cross(n)  # in the plane, across the axis
        o = ax.origin
        lo, hi = math.inf, -math.inf
        for f in self.faces():
            for e in f.outer_wire().edges():
                count = 1 if e.geom_type == "line" else 32
                for i in range(count + 1):
                    v = (e.point_at(i / count) - o).dot(side)
                    lo, hi = min(lo, v), max(hi, v)
        tol = 1e-7 * max(1.0, self.bbox().diagonal)
        if lo < -tol and hi > tol:
            where = (f"; the default axis is the sketch's local Y axis through its plane origin "
                     f"{_fmt_point(o)}, pass axis=... (for example Axis((0, 0, 0), (0, 1, 0)))") if default else ""
            raise ModelingError(f"revolve: the axis crosses the region{where}")

    def sweep(self, path: Edge | Wire, *, sharp_corners: bool | None = None) -> Part:
        """Sweep the region along a path. The sketch should sit at the start of the path."""
        from .operations import sweep

        return sweep(self, path, sharp_corners=sharp_corners)

    def __repr__(self) -> str:
        return f"Sketch({self._brep.face_count()} faces, area={self.area:.6g})"
