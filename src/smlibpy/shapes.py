"""Shapes: vertices, edges, wires, faces, sketches, shells and parts.

Every shape is an immutable value. Operations never modify a shape; they return a
new one. Faces, edges and vertices taken from a body (``part.faces()``) stay valid
for as long as you hold them and can be passed back to operations on that body
(``part.fillet(part.edges().parallel_to(Z), 2)``).
"""

from __future__ import annotations

import contextlib
import math
import time
from typing import TYPE_CHECKING, Any, Callable, Iterable, Iterator, Sequence, TypeVar, Union, overload

import numpy as np

from ._kernel import BrepHandle, CurveHandle, KernelError, ModelingError, _traced, ext, k, kernel_call
from .geometry import (TOLERANCE, Axis, BoundBox, Hit, Location, Nurbs, Plane, Rot, Vector, VectorLike, X, Y, Z, _direction,
                       _vec)

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

# Faces whose gaps reach 1e-2 of the volume do not bound one solid: a Boolean that left a face out
# (0.25), a wrong shell from the fuzz campaign (0.066), a torus split along its seam (4.0). Sound
# bodies stay below 2e-3: imported parts up to 6e-4, a sheet unfolded at a radius far below its
# thickness 1.1e-3.
_BROKEN_GAPS = 1e-2

# How far a body was found a sound solid (BrepHandle.sound, see Part._solid_problem): the
# closed, manifold result of a Boolean of sound operands, which the next Boolean takes as sound
# and nothing else does; closed, manifold and of positive volume by the kernel's coarse
# integration (the checks of operations); and that with the gaps between its faces measured
# (is_valid()).
_TRUSTED, _CHECKED, _SOUND = 1, 2, 3

# Fillet corners take two edges whose directions differ by less than this (degrees) for edges
# that run into each other tangentially: the kernel's default tangency tolerance.
_FILLET_TANGENT_DEG = 10.0

# A chamfer bevels each edge with one cross-section, so its setback equals the length only where
# the faces meet at the angle measured; along an edge whose angle changes by more than this
# (degrees) the setback would change with it.
_CHAMFER_ANGLE_SPREAD = 1.0

# A shell or offset whose faces leave gaps of this much of its volume or more is refused. Over
# 1018 shells and offsets of imported parts, the sound ones stayed below 6.5e-4 and those with
# 1e-3 or more were wrong (faces off their edges, rims left open, meshes that do not close).
_OFFSET_GAPS = 1e-3

# A shell or offset attempt whose result was refused is tried once more (the kernel's extended
# mode depends on memory layout), but not after this many seconds; an attempt that failed is
# not repeated, since the kernel fails the same way again.
_RETRY_SECONDS = 10.0

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
        return self._transformed(_translation(x, y, z))

    def rotate(self: S, axis: Axis = Z, angle: float = 0.0) -> S:
        """A copy rotated by ``angle`` degrees about ``axis``."""
        return self._transformed(Location.about(axis, angle).matrix)

    def mirror(self: S, plane: Plane | Face = Plane.XZ) -> S:
        """A mirrored copy (reflection in ``plane``, a plane or a planar face; by default the
        XZ plane, which flips Y)."""
        return self._transformed(_reflection(plane))

    def scale(self: S, factor: float | VectorLike, center: VectorLike = (0, 0, 0)) -> S:
        """A scaled copy. ``factor`` is a number or per-axis factors ``(sx, sy, sz)``, none of
        them zero (``ValueError``: that would flatten the shape)."""
        return self._transformed(_scaling(factor, center))

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
        return ShapeList(s for s, kind in zip(self, _convexities(self)) if kind == "convex")

    def concave(self) -> ShapeList[T]:
        """Edges on inside corners (material angle above 180 degrees), and the inside
        corners of a sketch."""
        return ShapeList(s for s, kind in zip(self, _convexities(self)) if kind == "concave")

    def smooth(self) -> ShapeList[T]:
        """Edges where two faces meet tangentially, such as the borders of a fillet, and the
        vertices of a sketch where two edges meet tangentially."""
        return ShapeList(s for s, kind in zip(self, _convexities(self)) if kind == "smooth")

    def fillets(self, max_radius: float | None = None) -> ShapeList[T]:
        """Fillet faces: rounds of convex edges and fillets of concave ones, found by geometry
        (with the corner patches where fillets meet), up to ``max_radius``. See
        :mod:`smlibpy.defeature`."""
        from .defeature import fillet_faces

        return fillet_faces(self, max_radius)  # type: ignore[return-value]

    def hit_by(self, origin: VectorLike | Axis, direction: VectorLike | Axis | None = None) -> ShapeList[T]:
        """The faces (or bodies) of the list that a ray meets, nearest first: each once, in the
        order the ray meets them (see :meth:`Part.raycast`). Only the shapes in the list count, so
        ``part.faces().planar().hit_by(...)`` looks past the faces that are not planar.

        The ray starts at ``origin`` and runs along ``direction`` (an axis or a vector); an axis
        alone is a ray from its origin along its direction. A ray through an edge meets the faces
        on both sides of it.
        """
        for s in self:
            if not isinstance(s, (Face, _Body)):
                raise TypeError(f"hit_by takes faces and bodies, not a {type(s).__name__}")
        first: dict[int, float] = {}
        faces = [s for s in self if isinstance(s, Face)]
        if faces:
            box = faces[0].bbox()
            for f in faces[1:]:
                box = box.union(f.bbox())
            for h in _raycast(faces, origin, direction, box, one_per_point=False):
                first.setdefault(id(h.face), h.distance)  # (nearest first)
        for s in self:
            if isinstance(s, _Body) and id(s) not in first:
                hits = s.raycast(origin, direction)
                if hits:
                    first[id(s)] = hits[0].distance
        seen: set[int] = set()
        met = []
        for i, s in enumerate(self):
            if id(s) in first and id(s) not in seen:
                seen.add(id(s))
                met.append((first[id(s)], i, s))
        return ShapeList(s for _, _, s in sorted(met, key=lambda m: (m[0], m[1])))

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


def _convexities(items: Sequence[Any]) -> list[str | None]:
    """The convexity of each edge, and of each corner of a sketch (None for other shapes), with
    one kernel call for the edges of each body."""
    edges = [s for s in items if isinstance(s, Edge)]
    angles = {id(e): a for e, a in zip(edges, _outer_angles(edges))}
    out: list[str | None] = []
    for s in items:
        if isinstance(s, Edge):
            a = angles[id(s)]
            out.append(_angle_kind(a) if a is not None else s._probed_convexity())
        elif isinstance(s, Vertex) and isinstance(s._owner, Sketch):
            out.append(s.convexity)
        else:
            out.append(None)
    return out


def _outer_angles(edges: Sequence[Edge]) -> list[float | None]:
    """The kernel's outer angle of each edge in degrees (``ext.edge_angles``: above 180 at a
    convex edge), one call per body; None where the kernel cannot tell (an edge that does not
    lie between two faces of a solid, a standalone curve)."""
    out: list[float | None] = [None] * len(edges)
    bodies: dict[int, tuple[Any, list[int]]] = {}
    for i, e in enumerate(edges):
        if e._e is not None and e._owner is not None:
            bodies.setdefault(id(e._owner), (e._owner, []))[1].append(i)
    for owner, idx in bodies.values():
        for i, a in zip(idx, ext.edge_angles(owner._brep, [edges[i]._e for i in idx])):
            out[i] = a
    return out


def _angle_kind(outer: float) -> str:
    """The convexity of an edge with this outer angle (degrees): smooth within half a degree of
    180, as the faces' normals are within half a degree."""
    return "smooth" if abs(outer - 180.0) < 0.5 else "convex" if outer > 180.0 else "concave"


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
        for an inside corner, ``"smooth"`` where the faces meet tangentially (within half a
        degree). Taken at the middle of the edge. Edges with a single face count as convex."""
        a = _outer_angles([self])[0]
        return _angle_kind(a) if a is not None else self._probed_convexity()

    @property
    def dihedral_angle(self) -> float:
        """The angle between the two faces of the edge through the material, in degrees, at the
        middle of the edge: 90 at the edges of a box, 270 at the inside corner of an L, 180
        where the faces meet tangentially. ``ValueError`` for an edge that does not lie between
        two faces."""
        a = _outer_angles([self])[0]
        if a is not None:
            return 360.0 - a
        if self._e is None or len(self._e.faces()) != 2:
            raise ValueError("dihedral_angle: the edge does not lie between two faces")
        f1, f2 = (Face(self._owner, f) for f in self._e.faces())
        p = self.center()
        turn = f1.normal_at(p).angle_to(f2.normal_at(p))
        return 180.0 + turn if self._probed_convexity() == "concave" else 180.0 - turn

    def _probed_convexity(self) -> str:
        """The convexity from the faces' normals and a step into face 1, for edges the kernel's
        outer angle does not cover (an edge of a sheet, an inner edge of a merged part). On edges
        that lie off their faces by more than the step (imported bodies) the step can read noise."""
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

    def nurbs(self) -> Nurbs:
        """This edge as a NURBS curve, from its start to its end: degree, knots, control points and
        weights. Exact for lines, arcs (rational) and B-splines; other curves are approximated
        within 1e-7."""
        c = self._copy_curve()
        try:
            d = ext.curve_data(c, True)
        finally:
            ext.delete_curve(c)
        return Nurbs(int(d["degree"]), [float(x) for x in d["knots"]], [Vector(*p) for p in d["poles"]],
                     None if d["weights"] is None else [float(w) for w in d["weights"]])

    def remove_knots(self) -> Edge:
        """The same curve with the knots it does not need taken out: a B-spline with fewer control
        points (the kernel's knot removal, which keeps the curve within about 1e-6 of where it was).
        Lines, arcs and other analytic curves come back as they are."""
        c = self._copy_curve()
        with kernel_call("remove_knots"):
            k.remove_curve_knots(c)
        return Edge._from_curve(c)

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

    def raycast(self, origin: VectorLike | Axis, direction: VectorLike | Axis | None = None) -> list[Hit]:
        """Where a ray meets this face, nearest first (see :meth:`Part.raycast`)."""
        return _raycast([self], origin, direction, self.bbox())

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
        """A body of the same type and metadata around ``brep`` (made from this one: read from a
        file if this one was)."""
        b = type(self)._wrap(brep, name=self.name, color=self.color)
        b._h.imported = self._h.imported
        return b

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

    def raycast(self, origin: VectorLike | Axis, direction: VectorLike | Axis | None = None) -> list[Hit]:
        """Where a ray meets this body's faces, nearest first: the exact points (``Hit``: point,
        distance from the start, the face, its outward normal there).

        The ray starts at ``origin`` and runs along ``direction`` (an axis or a vector); an axis
        alone is a ray from its origin along its direction. Points behind the start are not
        hits. A ray through an edge or a vertex hits once, a ray along a face where it enters
        the face. ``hits[0]`` is what the ray sees first; ``len(hits)`` is odd from inside a
        closed part, except where the ray grazes a face (to test a point, use
        :meth:`Part.contains`).
        """
        return _raycast(self.faces(), origin, direction, self._loose_box())

    def compact(self) -> None:
        """Free what the kernel keeps from earlier queries of this body: the caches that
        :meth:`bbox`, :meth:`distance_to`, :meth:`closest_point`, :meth:`raycast` and ``mesh()``
        leave on its curves, its surfaces and the body itself (evaluation grids, trimmed-surface
        data, spatial trees). The body does not change, nor do its faces and edges; a later
        query builds what it needs again.

        The kernel keeps these caches as long as the body lives, and they can outweigh the body:
        on a holed, filleted box of 129 KB, ``bbox()`` left 41 KB, ``mesh()`` 754 KB and
        ``distance_to()`` 799 KB. A query that finds them is about 1.2 times as fast (twice for
        ``closest_point()`` after ``distance_to()``); Booleans gain nothing from them. Compact
        bodies that are kept but no longer queried, such as the copies of a large pattern after
        they were measured or exported.
        """
        ext.drop_caches(self._brep)

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
        h = BrepHandle(self._copy_brep())  # freed if the kernel fails
        with kernel_call("transform"):
            ext.transform_brep(h.brep, list(m.T.ravel()))
        return self._like(_take(h))

    # -- body conversions -----------------------------------------------------
    def to_nurbs(self) -> Any:
        """A copy whose faces and edges are all NURBS (analytic types converted)."""
        h = BrepHandle(self._copy_brep())
        with kernel_call("to_nurbs"):
            k.turn_to_nurbs(h.brep)
        return self._like(_take(h))

    def heal(self) -> Any:
        """Repair gaps, tolerances and topology (mostly needed for imported data)."""
        h = BrepHandle(self._copy_brep())
        with kernel_call("heal"):
            k.heal_brep(h.brep)
        return self._like(_take(h))

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


def _can_cover(tools: Sequence[Part], part: Part) -> bool:
    """Whether tools can cover a part, so that a cut by them can leave nothing: together they
    hold at least its volume, and their boxes span its box. Necessary, not sufficient; the
    volumes are the quick ones, with a margin of 1e-3."""
    try:
        if sum(t._quick_volume() for t in tools) < part._quick_volume() * (1 - 1e-3):
            return False
    except KernelError:
        return False
    hull = tools[0]._loose_box()
    for t in tools[1:]:
        hull = hull.union(t._loose_box())
    box = part._loose_box()
    tol = 1e-6 * box.diagonal + 1e-5
    if hull.contains(box.min, tol) and hull.contains(box.max, tol):
        return True
    box = part.bbox()  # the loose box can stick out of the tools' boxes where the part does not
    return hull.contains(box.min, tol) and hull.contains(box.max, tol)


def _intersection_problem(result: Part, operands: Sequence[Part]) -> str | None:
    """Whether points of an intersection's surface lie outside one of its operands. The kernel
    can take a tool beside an earlier hole in a curved part, or a corner box of an imported
    pulley, as containing the part, and return all of it. Points beyond an operand's loose box
    are outside it; the points are classified where the result may be an operand given back
    unchanged (as many faces and the same vertices). (Loose boxes ignore trimming: the result of
    a split, the part and a half-space box, often reaches out of the half-space box's.)"""
    box = result._loose_box()
    tol = 1e-6 * box.diagonal + 1e-5
    near = max(1e-4 * box.diagonal, 1e-5)  # the new edges are fitted, to about 2e-5
    problem = "partly outside an operand (the kernel took one operand for inside the other)"
    points: list[tuple[float, float, float]] | None = None
    for x in operands:
        xb = x._loose_box()
        if not (xb.contains(box.min, tol) and xb.contains(box.max, tol)):
            points = points or _surface_points(result)
            if not all(xb.contains(p, near) for p in points):
                return problem
    n = result._brep.face_count()
    if not any(x._brep.face_count() == n and _same_vertices(result, x, tol) for x in operands):
        return None
    points = points or _surface_points(result)
    for x in operands:
        if any(where == "outside" for where, _, _ in x._classify(points, near)):
            return problem
    return None


def _same_vertices(a: _Body, b: _Body, tol: float) -> bool:
    """Whether two bodies have as many vertices and each vertex of ``a`` lies near one of ``b``
    (within ``tol``, or up to 4 ``tol``: cells of a grid; for the quick test of a body given back
    unchanged, where too many is safe)."""
    pa = [v.point() for v in a._brep.vertices()]
    pb = [v.point() for v in b._brep.vertices()]
    if len(pa) != len(pb):
        return False
    def grid(points: list[Any]) -> list[list[int]]:
        return np.floor(np.asarray(points, dtype=float).reshape(-1, 3) / tol).astype(np.int64).tolist()

    cells = {tuple(c) for c in grid(pb)}
    around = [(i, j, m) for i in (0, -1, 1) for j in (0, -1, 1) for m in (0, -1, 1)]
    return all(any((c[0] + i, c[1] + j, c[2] + m) in cells for i, j, m in around) for c in grid(pa))


def _offset_problem(result: Part, box: BoundBox, tol: float, before: float, smaller: bool | None) -> str | None:
    """What is wrong with the result of a shell or an offset (see ``Part._checked``), or None."""
    problem = result._solid_problem()
    if problem is not None:
        return f"a body that is {problem}"
    rb = result.bbox()
    if any(rb.min[i] < box.min[i] - tol or rb.max[i] > box.max[i] + tol for i in range(3)):
        return "a body that reaches out of the box it must fit in"
    p = result._props(1e-4)
    if not p["gaps"] < _OFFSET_GAPS:
        return f"a body whose faces do not meet, so that its volume is uncertain by {p['gaps']:.1e} of its value"
    after = float(p["volume"])
    slack = 1e-9 * abs(before)
    if smaller is True and not after < before - slack:
        return f"a body whose volume did not go down ({before:.10g} -> {after:.10g})"
    if smaller is False and not after > before + slack:
        return f"a body whose volume did not go up ({before:.10g} -> {after:.10g})"
    if smaller is None and not abs(after - before) > slack:
        return f"a body of the part's own volume ({after:.10g})"
    return None


def _surface_points(body: _Body) -> list[tuple[float, float, float]]:
    """Points on a body's surface: its vertices, the middle of each edge, and a point of each face
    (the middle of its parameter domain where that lies on the face, else one the kernel finds)."""
    points = [v.point() for v in body._brep.vertices()]
    for e in body._brep.edges():
        a, b = e.parameter_range()
        points.append(e.curve().evaluate(0.5 * (a + b)))
    for f in body._brep.faces():
        (u0, v0), (u1, v1) = f.uv_domain()
        u, v = 0.5 * (u0 + u1), 0.5 * (v0 + v1)
        try:
            inside = f.classify_uv(u, v) == "inside"
        except RuntimeError:  # (on a face whose seam the kernel cannot resolve)
            inside = False
        try:
            points.append(f.point_at_uv(u, v) if inside else f.interior_point())
        except RuntimeError:  # the kernel cannot place a point on this face: its edges stand in
            pass
    return [Vector(p).to_tuple() for p in points]


def _translation(x: float | VectorLike = 0.0, y: float = 0.0, z: float = 0.0) -> np.ndarray:
    """The matrix of a move by ``(x, y, z)`` (Shape.translate, Mesh.translate)."""
    v = _vec(x) if not isinstance(x, (int, float)) else Vector(x, y, z)
    m = np.eye(4)
    m[:3, 3] = v.to_tuple()
    return m


def _reflection(plane: Plane | Face) -> np.ndarray:
    """The matrix of a reflection in a plane or a planar face (Shape.mirror, Mesh.mirror)."""
    plane = _as_plane(plane)
    n = np.array(plane.z_dir.to_tuple())
    o = np.array(plane.origin.to_tuple())
    m = np.eye(4)
    m[:3, :3] -= 2.0 * np.outer(n, n)
    m[:3, 3] = 2.0 * n * o.dot(n)
    return m


def _scaling(factor: float | VectorLike, center: VectorLike = (0, 0, 0)) -> np.ndarray:
    """The matrix of a scale about ``center`` (Shape.scale, Mesh.scale)."""
    f = (factor, factor, factor) if isinstance(factor, (int, float)) else tuple(_vec(factor))
    if not all(math.isfinite(x) and x != 0 for x in f):
        raise ValueError(f"scale: every factor must be finite and not zero (got {factor!r})")
    c = np.array(_vec(center).to_tuple())
    m = np.eye(4)
    m[:3, :3] = np.diag(f)
    m[:3, 3] = c - np.diag(f) @ c
    return m


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
    other give starting points; from the best ones, ``ext.nearest_points`` takes closest
    points in turn on either body and finishes with Newton's method on the parameters of the
    faces they lie on, which ends in a pair of exact surface points. (Closest points in turn
    alone settle slowly between nearly parallel faces: two skew cylinders 2 apart at 5 degrees
    were still 2.4845 apart after 500 rounds.)
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
    best, unsettled = math.inf, 0.0
    for _, x, y, p in sorted(starts, key=lambda t: t[0])[:2 * seeds]:
        with kernel_call("distance_to"):
            r = ext.nearest_points(x._brep, y._brep, tuple(float(c) for c in p))
        if r["distance"] < best:
            best, unsettled = r["distance"], r["gain"]
    scale = max(ab.diagonal, bb.diagonal, 1.0)
    if unsettled > 1e-9 * scale:
        import warnings

        warnings.warn(f"distance_to: the nearest points did not settle; the distance {best:.6g} may be too large "
                      f"(the last step still gained {unsettled:.2g})", RuntimeWarning, stacklevel=3)
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


def _raycast(faces: Sequence[Face], origin: VectorLike | Axis, direction: VectorLike | Axis | None,
             box: BoundBox, one_per_point: bool = True, meshes: dict[int, Any] | None = None) -> list[Hit]:
    if isinstance(origin, Axis) and direction is None:
        o, d = origin.origin, origin.direction.normalized()
    elif direction is None:
        raise TypeError("raycast takes an origin and a direction, or an axis")
    else:
        o, d = _vec(origin), _direction(direction, "raycast")
    if not all(math.isfinite(x) for x in o):
        raise ValueError("raycast: the origin must be finite")
    size = max(box.diagonal, 1e-9)
    corners = [Vector(x, y, z) for x in (box.min.x, box.max.x) for y in (box.min.y, box.max.y)
               for z in (box.min.z, box.max.z)]
    reach = max((c - o).dot(d) for c in corners) + 1e-3 * size
    if reach <= 0:  # the body is behind the start
        return []
    tol = 1e-9 * max(size, o.length)
    hits: list[Hit] = []
    if meshes is None:  # (rays of one body can share them)
        meshes = {}  # id of a body -> its faces' meshes (for faces the kernel cannot intersect)
    with kernel_call("raycast"):
        ray = k.create_line_segment(o.to_tuple(), (o + d * reach).to_tuple())
        try:
            for f in faces:
                if not _ray_meets_box(o, d, reach, f._f.bounding_box(False), tol):
                    continue
                try:
                    curves, points = k.intersect_curve_face(ray, f._f)
                except RuntimeError:
                    # The kernel fails where a ray runs parallel to a plane or along a cylinder
                    # without meeting it (and on some other faces): there the face's mesh finds
                    # the hits, and they are moved onto the exact surface.
                    found = _mesh_hits(f, o, d, reach, tol, meshes)
                else:
                    found = [Vector(p) for p in points]
                    for c in curves:  # the ray runs along the face: it meets it where it enters it
                        ends = [Vector(c.start_point()), Vector(c.end_point())]
                        found.append(min(ends, key=lambda q: (q - o).dot(d)))
                        ext.delete_curve(c)
                for q in found:
                    t = (q - o).dot(d)
                    if t >= -tol:
                        hits.append(Hit(q, max(t, 0.0), f.normal_at(q), f))
        finally:
            ext.delete_curve(ray)
    hits.sort(key=lambda h: h.distance)
    if not one_per_point:
        return hits
    out: list[Hit] = []
    for h in hits:  # through an edge or a vertex: one hit
        if not out or h.distance - out[-1].distance > 10 * tol or (h.point - out[-1].point).length > 10 * tol:
            out.append(h)
    return out


def _mesh_hits(f: Face, o: Vector, d: Vector, reach: float, tol: float, meshes: dict[int, Any]) -> list[Vector]:
    """The points where the ray crosses the mesh of face ``f``, moved onto its exact surface."""
    from .mesh import _ray_triangles, face_meshes

    owner = f._owner
    if id(owner) not in meshes:
        meshes[id(owner)] = (owner, face_meshes(owner))  # (the owner is kept: its id stays its own)
    (index,) = ext.face_indices(owner._brep, [f._f])
    m = meshes[id(owner)][1][index]
    out: list[Vector] = []
    ts, _ = _ray_triangles(o, d, m.vertices, m.triangles, tol)
    srf = f._f.surface()
    for t0 in sorted(float(t) for t in ts if t <= reach):
        if out and abs(t0 - (out[-1] - o).dot(d)) < 1e-6 * max(reach, 1.0):
            continue  # (an edge between two triangles)
        t = t0
        for _ in range(30):  # Newton along the ray, against the tangent plane at the closest point
            p = o + d * t
            q, uvs, _ = k.surface_closest_point(srf, p.to_tuple())
            n = Vector(f._f.normal_at_uv(uvs[0].x, uvs[0].y))
            dn = d.dot(n)
            if abs(dn) < 1e-12:
                break
            step = (Vector(q.x, q.y, q.z) - p).dot(n) / dn
            t += step
            if abs(step) <= tol:
                break
        q = o + d * t
        if f.distance_to(q) <= 100 * tol:
            out.append(q)
    return out


def _ray_meets_box(o: Vector, d: Vector, reach: float, box: Any, tol: float) -> bool:
    lo, hi = box
    t0, t1 = 0.0, reach
    for a, oa, da in ((0, o.x, d.x), (1, o.y, d.y), (2, o.z, d.z)):
        low, high = lo[a] - tol, hi[a] + tol
        if abs(da) < 1e-300:
            if oa < low or oa > high:
                return False
            continue
        ta, tb = (low - oa) / da, (high - oa) / da
        if ta > tb:
            ta, tb = tb, ta
        t0, t1 = max(t0, ta), min(t1, tb)
        if t0 > t1:
            return False
    return True


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
        """True if the part is a closed, manifold solid that encloses a positive volume and
        whose faces meet.

        (A body whose faces point inward, or that encloses no volume, such as a profile
        revolved about an axis through it, is not valid; nor is one whose faces leave gaps that
        make its volume uncertain by 1e-2 of its value or more.)
        """
        return self._solid_problem(gaps=True) is None

    def _solid_problem(self, volume: float | None = None, gaps: bool = False) -> str | None:
        """Why this is not a sound solid (``"empty"``, ``"inside out (negative volume)"``,
        ``"open between its faces, ..."``, ...), or None: this catches broken bodies, not small
        errors. The checks of operations take the sign of the kernel's coarse volume (or of
        ``volume``, which the caller integrated anyway), and the gaps between the faces only if
        the part was measured: the gap measure costs 3 to 6 times as much on curved bodies.
        With ``gaps`` (``is_valid()``) the part is measured. A body found sound is not checked
        again."""
        if self._h.sound >= (_SOUND if gaps else _CHECKED):
            return None
        problem = self._shape_problem()
        measured = None
        if problem is None:
            try:
                measured = self._props(1e-4) if gaps else self._h.props  # measured now, or already
                if measured is not None:
                    volume = float(measured["volume"])
                elif volume is None:
                    volume = float(self._kernel_props(1e-3)["volume"])
            except KernelError:
                return "a body whose volume cannot be integrated"
            tiny = 1e-9 * self._extent() ** 3
            if volume < -tiny:
                problem = "inside out (negative volume)"
            elif not volume > tiny:  # also a NaN volume
                problem = "without volume"
            elif measured is not None and not measured["gaps"] < _BROKEN_GAPS:
                problem = (f"open between its faces, so that its volume is uncertain by {measured['gaps']:.1e} "
                           f"of its value")
        self._h.sound = 0 if problem is not None else _SOUND if measured is not None else _CHECKED
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

    def merge(self, *others: Part | Sequence[Part]) -> Part:
        """This part and others as one part made of cells. Where parts overlap, the overlap becomes
        a cell of its own; cells that touch share the faces between them (each such face bounds
        two cells: the body is non-manifold). For simulation meshes that must match across
        materials, and for models of several materials.

        ``cells()`` gives the cells as parts of their own; ``volume`` is the volume of the union.
        A merged part is not a manifold solid: ``is_valid()`` is False, and Booleans, fillets and
        shells take its cells rather than the part itself.

        A result whose volume is less than that of the largest part, or more than that of all
        parts together, is wrong: ``ModelingError``.
        """
        tools = _bodies(others, "merge")
        if not tools:
            raise ValueError("merge needs another part")
        for t in tools:
            if not isinstance(t, Part) or isinstance(t, Sketch):
                raise TypeError(f"merge takes parts, not a {type(t).__name__}")
        from . import defeature

        if defeature.GUARD_BOOLEANS:
            from ._guard import isolated

            brep = isolated("merge", _boolean_step, "merge", self._brep, [t._brep for t in tools], k.BooleanOp.MERGE,
                            True)
        else:
            h = BrepHandle(self._copy_brep())
            for t in tools:
                with kernel_call("merge", "the parts may only touch along an edge or at a point"):
                    _combine(h, t, k.BooleanOp.MERGE, non_manifold=True)
            brep = _take(h)
        merged = Part._wrap(brep, name=self.name, color=self.color)
        problem = _merge_problem(merged, [self, *tools])
        if problem is not None:
            raise ModelingError(f"merge: the kernel returned a result {problem}; a seam of one part that lies "
                                f"tangent to another can do this: turn that part about its axis or move it a little")
        return merged

    def cells(self) -> ShapeList[Part]:
        """The cells of a part made by :meth:`merge`, each as a part of its own (every closed region
        of the body; a cavity is not a cell). A part that is one solid: ``[itself]``.

        The kernel's stitcher runs in another process (see ``smlibpy.defeature.GUARD_SECONDS``): it
        crashed on some merges, which raise :class:`KernelError` now."""
        d = ext.brep_dump(self._brep, False)
        if sum(1 for r in d["regions"] if not r["infinite"] and not r["void"]) <= 1:
            return ShapeList([self])
        from ._guard import isolated

        with kernel_call("cells"):
            # (in another process: the kernel's stitcher crashed on some merges)
            regions = isolated("cells", _region_shells_step, self._brep)
        solids = [[Part._wrap(b, name=self.name, color=self.color) for b in shells] for shells in regions]
        touching = ("an insert that touches the part around it at a point or along a line can do this: move it "
                    "off the wall or into it")
        out: ShapeList[Part] = ShapeList()
        for outer, *cavities in solids:
            try:
                part = outer.cut(cavities) if cavities else outer
            except ModelingError as e:
                raise ModelingError(f"cells: the cells inside a cell could not be cut out of it ({e}); {touching}") from e
            try:
                part._props()  # measured for the sum below, so that the check sees the gaps too
                problem = part._solid_problem()
            except KernelError:
                problem = "a body whose volume cannot be integrated"
            if problem is not None:
                raise ModelingError(f"cells: a cell is not a sound solid ({problem})")
            out.append(part)
        # The cells fill the part: a cell that kept another inside it counts that one twice (an
        # insert of 268 in 8000). Faces that meet only within a tolerance (fitted chamfers,
        # imported parts) integrate a little differently in the part and in its cells: by up
        # to about their gaps.
        p = self._props()
        whole = float(p["volume"])
        total = sum(float(c._props()["volume"]) for c in out)
        slack = max(1e-6, 10 * max([float(p["gaps"])] + [float(c._props()["gaps"]) for c in out]))
        if not abs(total - whole) <= slack * abs(whole):
            raise ModelingError(f"cells: the cells add up to a volume of {total:.10g}, the part has {whole:.10g}; "
                                f"{touching}")
        return out

    # -- points ---------------------------------------------------------------
    def classify(self, point: VectorLike, tol: float | None = None) -> tuple[str, Face | Edge | Vertex | None]:
        """Where a point lies: ``("inside", None)`` in the material, ``("outside", None)``
        (also in a cavity), or ``("on", shape)`` on the surface within ``tol`` (default: the
        part's own tolerance, 1e-5 for most parts), with the vertex, edge or face it lies on
        (the vertex rather than its edges, an edge rather than its faces).

        The kernel classifies the point exactly (SmBrep::Point3DClassify), also where a ray
        from it would graze a face or pass through an edge, which the parity of
        :meth:`raycast` hits gets wrong.
        """
        where, index, _ = self._classify([point], tol)[0]
        if where == "face":
            return "on", Face(self, self._brep.faces()[index])
        if where == "edge":
            return "on", Edge._of(self, self._brep.edges()[index])
        if where == "vertex":
            return "on", Vertex._of(self, self._brep.vertices()[index])
        return where, None

    def contains(self, point: VectorLike, tol: float | None = None) -> bool:
        """True if the point lies in the material of this part or on its surface (within
        ``tol``, see :meth:`classify`); False outside and in a cavity."""
        return self._classify([point], tol)[0][0] != "outside"

    def cell_at(self, point: VectorLike, tol: float | None = None) -> Part | None:
        """The cell of a merged part (see :meth:`merge`) that holds the point, as in
        :meth:`cells`; None outside, in a cavity and on a face (also one between two cells).
        For a part that is one solid: the part itself or None."""
        _, _, cell = self._classify([point], tol)[0]
        return None if cell < 0 else self.cells()[cell]

    def _classify(self, points: Iterable[VectorLike], tol: float | None = None) -> list[tuple[str, int, int]]:
        """``ext.classify_points`` for these points: per point (where, index, cell), where one of
        "inside", "outside", "face", "edge", "vertex"."""
        if tol is not None and not (math.isfinite(tol) and tol > 0):
            raise ValueError(f"classify: the tolerance must be positive (got {tol!r})")
        pts = [_vec(p).to_tuple() for p in points]
        with kernel_call("classify"):
            return [tuple(r) for r in ext.classify_points(self._brep, pts, tol or 0.0)]  # type: ignore[misc]

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
            raise _traced(KernelError(failure.operation, failure.detail, failure.status, hint), failure) from failure
        raise ModelingError(f"{name}: the kernel returned a result that is {problem}; {hint}")

    def _run_boolean(self, tools: Sequence[_Body], op: Any, name: str) -> Any:
        from . import defeature

        if defeature.GUARD_BOOLEANS:
            from ._guard import isolated

            return isolated(name, _boolean_step, name, self._brep, [t._brep for t in tools], op, False)
        h = BrepHandle(self._copy_brep())
        for t in tools:
            with kernel_call(name, "the operands may touch only in a degenerate way, or an operand is broken"):
                _combine(h, t, op)
        return _take(h)

    def _boolean_problem(self, result: Part, tools: Sequence[Part], op: Any) -> str | None:
        """What is wrong with a Boolean result, or None. An empty result is right where the
        operands say so (a cut by a tool that encloses the part, an intersection of bodies
        apart from each other)."""
        if result._brep.face_count() != 0:
            problem = result._shape_problem()
            if problem is None and all(x._h.sound >= _TRUSTED or x._solid_problem() is None for x in (self, *tools)):
                # Closed and manifold, from sound operands. Its volume, which costs up to twice
                # the Boolean, is not integrated here, so that a chain of Booleans integrates
                # nothing: the next Boolean trusts it. is_valid() and the next feature check it
                # (it can be inside out or leave a face out).
                if op == k.BooleanOp.INTERSECTION:
                    problem = _intersection_problem(result, [self, *tools])
                if problem is None:
                    result._h.sound = _TRUSTED
                return problem
            return problem or result._solid_problem()
        if op == k.BooleanOp.UNION:
            return "empty"
        if op == k.BooleanOp.INTERSECTION:
            if len(tools) > 1:
                return None  # the common volume of several tools may well be empty
            rel = _relationship(self, tools[0])
            return None if rel in ("separate", "touching") else "empty"
        # The intersection of the part and a tool that confirms an empty cut below can fail the
        # same way as the cut (a tool beside an earlier hole in a sphere: the cut is empty, the
        # intersection the whole part). So first the tools must be able to cover the part.
        if not _can_cover(tools, self):
            return "empty"
        try:
            whole = self._kernel_props(1e-6)["volume"]
        except KernelError:
            return "empty"
        for t in tools:
            if _relationship(t, self) == "separate":
                continue
            # right only if the tool covers the whole part
            try:
                common = Part._wrap(self._run_boolean([t], k.BooleanOp.INTERSECTION, "cut"))
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
        sel = [e for e in _flatten_edges(edges) if not e.is_seam]
        out = []
        for e, a in zip(sel, _outer_angles(sel)):
            if a is not None:
                if _angle_kind(a) == "smooth":
                    continue
            elif len(fs := e.faces()) == 2:
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
    def _check_radius_law(edges: list[Edge]) -> None:
        """A ``(start, end)`` radius runs along each edge on its own. Refuse the edges where it
        cannot: a closed edge (the radius would jump back at its seam) and edges that run into
        each other tangentially (the kernel gives the rounds one radius where they meet and bends
        both radii to it)."""
        at: dict[Vertex, list[Vector]] = {}  # vertex (kept, so its identity stays) -> edge directions
        for e in edges:
            if e.is_closed:
                raise ValueError("fillet: a (start, end) radius cannot run around a closed edge (it would jump "
                                 "back to the start radius at the seam); give a constant radius")
            for v in e.vertices():
                p = v.center()
                d = e.tangent_at(0.0 if (p - e.start).length <= (p - e.end).length else 1.0)
                for d2 in at.get(v, []):
                    a = d.angle_to(d2)
                    if min(a, 180.0 - a) < _FILLET_TANGENT_DEG:
                        raise ValueError(
                            f"fillet: a (start, end) radius runs along each edge on its own, and two of the edges "
                            f"run into each other tangentially at {_fmt_point(p)}, where the kernel would bend both "
                            f"radii to one; give a constant radius")
                at.setdefault(v, []).append(d)

    @staticmethod
    def _face_angles(e: Edge) -> list[float]:
        """Angles (degrees) between the normals of an edge's two faces at 9 points along it,
        leaving out points where a normal cannot be evaluated (the apex of a cone)."""
        fs = e.faces()
        out = []
        for t in (0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0):
            p = e.point_at(t)
            try:
                out.append(fs[0].normal_at(p).angle_to(fs[1].normal_at(p)))
            except (KernelError, ValueError):
                pass
        return out

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
        convex = [kind == "convex" for kind in _convexities(edges)]
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
                along each edge (where they differ: circular rounds only, not on closed edges
                or on edges that run into each other tangentially). A list with one radius
                per edge rounds edges differently.
            continuity: ``None`` for a circular fillet. ``"G2"`` or ``"G3"`` make a
                curvature-continuous blend (``"G1"`` a tangent blend) instead of a circular
                arc: no visible highlight seam, as used for consumer and Class-A surfaces.
            fullness: Shape of a blend cross-section; above 1 fuller, below 1 flatter.

        The kernel step of a part read from a file (``import_step``, ``load``, ``import_usd``) or
        made from one runs in another process (see ``smlibpy.defeature.GUARD_SECONDS``): the
        kernel's fillet code crashed on some imported parts.
        """
        self._require_valid("fillet")
        given = [float(r) for r in (radius if isinstance(radius, (tuple, list, np.ndarray)) else [radius])]
        if any(not r > 0 for r in given):
            raise ValueError("fillet: the radius must be positive")
        if isinstance(radius, tuple) and len(radius) == 2 and continuity is not None and given[0] != given[1]:
            # the kernel makes a ruled chamfer of it, not tangent to the faces
            raise ValueError("fillet: a (start, end) radius makes circular rounds only; continuity needs a "
                             "constant radius")
        sel = self._sharp_edges(edges, "fillet")
        if isinstance(radius, tuple) and len(radius) == 2:
            if float(radius[0]) != float(radius[1]):
                self._check_radius_law(sel)
            radii = [max(float(radius[0]), float(radius[1]))] * len(sel)
        elif isinstance(radius, (list, np.ndarray)):
            radii = [float(r) for r in radius]
        else:
            radii = [float(radius)] * len(sel)
        if len(radii) == len(sel):
            self._check_round_sizes(sel, [self._setback(e, r) for e, r in zip(sel, radii)], "fillet", "radius")
        h, kedges = self._with_edges(sel)
        cont = _continuity(continuity)
        if isinstance(radius, tuple) and len(radius) == 2:
            call: tuple[str, tuple[Any, ...], dict[str, Any]] = (
                "variable_radius_fillet", (), {"start_radius": float(radius[0]), "end_radius": float(radius[1]),
                                               "xsect_type": 1 if cont is None else 2, "continuity": cont or 1})
        elif isinstance(radius, (list, np.ndarray)):
            radii = [float(r) for r in radius]
            if len(radii) != len(kedges):
                raise ValueError(f"{len(radii)} radii for {len(kedges)} edges")
            xs = [int(k.FilletXSect.BLEND if cont else k.FilletXSect.CIRCULAR)] * len(kedges)
            call = ("fillet_edges_per_edge", (radii, xs), {"continuity": cont or 1, "thumbweight": fullness})
        elif cont is None:
            call = ("fillet_edges", (), {"radius": float(radius)})
        else:
            call = ("fillet_edges", (), {"radius": float(radius), "xsect_type": 2, "continuity": cont,
                                         "thumbweight": fullness})
        result = self._like(self._rounded(h, kedges, "fillet", "the radius may be too large for the selected edges",
                                          call))
        if isinstance(radius, tuple) and len(radius) == 2:
            sizes = [max(float(radius[0]), float(radius[1]))] * len(sel)
        elif isinstance(radius, (list, np.ndarray)):
            sizes = [float(r) for r in radius]
        else:
            sizes = [float(radius)] * len(sel)
        self._check_volume_change(result, sel, "fillet", sizes, "circular" if cont is None else "blend")
        return result

    def _rounded(self, h: BrepHandle, kedges: list[Any], what: str, hint: str,
                 call: tuple[str, tuple[Any, ...], dict[str, Any]]) -> Any:
        """The Brep of a fillet or chamfer: the kernel's ``call`` (its name, arguments after the
        edges, keywords) on the copy ``h`` holds, whose edges ``kedges`` are. The step of a part
        read from a file runs in another process (see ``smlibpy.defeature.GUARD_SECONDS``): the
        kernel's fillet code crashed on some imported parts."""
        if self._h.imported:
            from ._guard import isolated

            result = isolated(what, _round_step, what, hint, h.brep, kedges, call)
            # (a step that ran in this process, with GUARD_SECONDS = 0 or without a helper process,
            # rounded the copy h holds: h must give it up, or it frees the result with itself)
            return _take(h) if result is h.brep else result
        _round_step(what, hint, h.brep, kedges, call)
        return _take(h)

    def chamfer(self, edges: Any, length: float) -> Part:
        """Bevel edges. ``length`` is the setback measured along both adjacent faces.

        The faces of each edge must meet at the same angle all along it (within 1 degree);
        where they do not (a hole into a tilted or curved face), use ``fillet``.
        """
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
                r = length / math.tan(theta / 2) if theta > 1e-6 else length
                angles = self._face_angles(e)
                if angles and max(angles) - min(angles) > _CHAMFER_ANGLE_SPREAD:
                    lo, hi = (r * math.tan(math.radians(a) / 2) for a in (min(angles), max(angles)))
                    raise ModelingError(
                        f"chamfer: the faces of an edge meet at an angle that changes along it (their normals are "
                        f"{min(angles):.4g} to {max(angles):.4g} degrees apart), and the bevel would reach "
                        f"{lo:.4g} to {hi:.4g} from the edge instead of {float(length):.4g}; round such an edge "
                        f"with fillet(), whose radius stays the same along it")
                radii.append(r)
            else:
                radii.append(length)
        h, kedges = self._with_edges(sel)
        if all(abs(r - radii[0]) < 1e-12 for r in radii):
            call: tuple[str, tuple[Any, ...], dict[str, Any]] = ("fillet_edges", (), {"radius": radii[0], "xsect_type": 0})
        else:
            # per-edge radii with a linear cross-section, in one call: a call per edge replaces the
            # edges next to it, and the next call would use freed edges
            call = ("fillet_edges_per_edge", (radii, [int(k.FilletXSect.LINEAR)] * len(kedges)), {})
        result = self._like(self._rounded(h, kedges, "chamfer", "the length may be too large for the selected edges",
                                          call))
        self._check_volume_change(result, sel, "chamfer", [float(length)] * len(sel), "chamfer")
        return result

    def shell(self, thickness: float, openings: Any = None, *, outward: bool = False) -> Part:
        """Hollow the part out to walls of ``thickness``, removing the ``openings`` faces.

        The walls grow inward (the outside keeps its size) unless ``outward`` is true.

        Walls that do not fit into the part (measured across it from each face), and results
        the kernel gets wrong (faces that do not meet, no cavity, the part given back, a closed
        shell of the wrong volume), raise :class:`ModelingError`. The kernel step runs in
        another process (a forked copy on Linux and macOS, a helper process on Windows), so that a
        crash of its offset code raises ``ModelingError`` too, and it is stopped after
        ``smlibpy.defeature.GUARD_SECONDS`` (20 s): raise that for large parts.
        """
        from ._guard import isolated

        self._require_valid("shell")
        if not abs(float(thickness)) > 0:
            raise ValueError("shell: the thickness must not be zero")
        faces = self._own_faces(openings) if openings is not None else []
        t = abs(float(thickness))
        rays = self._inward_rays(faces)
        if not outward:
            self._check_wall_fits(t, faces, rays)
        d = t if outward else -t
        hint = self._shell_hint(faces)
        offsets: dict[bool, float] = {}  # volume of the part offset by d, by mode (for a closed shell)

        def offset_volume(extended: bool) -> float:
            if extended not in offsets:
                off = Part._wrap(isolated("shell", _offset_step, "shell", None, self._brep, d, extended))
                offsets[extended] = float(off._props(1e-4)["volume"]) if off._brep.face_count() else 0.0
            return offsets[extended]

        def attempt(extended: bool) -> Part:
            # In another process: the kernel's offset code can crash, mostly in its extended mode,
            # which depends on memory layout.
            return self._like(isolated("shell", _shell_step, hint, self._brep, d, extended, list(faces)))

        def problem(result: Part, extended: bool) -> str | None:
            return self._shell_problem(result, d, faces, rays, extended, offset_volume)

        return self._checked("shell", [(False, lambda: attempt(False)), (True, lambda: attempt(True)),
                                       (True, lambda: attempt(True))],
                             grow=t if outward else 0.0, smaller=None if outward else True, problem=problem,
                             hint=hint)

    def _inward_rays(self, openings: list[Any]) -> list[tuple[Vector, Vector, float, bool]]:
        """For each face that is not an opening: a point on it, the direction into the part there,
        how deep the part is along it (to the face it meets first), and whether that face is an
        opening. The checks of ``shell`` measure the part along these."""
        faces = self.faces()
        box = self._loose_box()
        # (a face is met again at the start within its tolerance, and so is a face that meets it
        # there at a sharp angle, or lies on it in an imported part)
        near = 1e-4 * max(box.diagonal, 1.0)
        meshes: dict[int, Any] = {}
        out = []
        for f in faces:
            if any(f._f is o for o in openings):
                continue
            try:
                (u0, v0), (u1, v1) = f._f.uv_domain()
                u, v = 0.5 * (u0 + u1), 0.5 * (v0 + v1)
                if f._f.classify_uv(u, v) != "inside":
                    _, uvs, _ = k.surface_closest_point(f._f.surface(), f.interior_point().to_tuple())
                    u, v = uvs[0].x, uvs[0].y
                p = Vector(f._f.point_at_uv(u, v))
                n = -Vector(f._f.outward_normal_at_uv(u, v)).normalized()
                hits = [h for h in _raycast(faces, p, n, box, meshes=meshes) if h.distance >= near]
            except (RuntimeError, ValueError):  # a face the kernel cannot place a point on
                continue
            if hits:
                out.append((p, n, hits[0].distance, any(hits[0].face._f is o for o in openings)))
        return out

    def _check_wall_fits(self, t: float, openings: list[Any], rays: list[tuple[Vector, Vector, float, bool]]) -> None:
        """Refuse inward walls that cannot fit: along each axis the part must be thicker than its
        walls (two, or one where an opening faces that way). With openings, so must it be across
        each face, into the part (``rays``, see ``_inward_rays``), since a rotated or angled part
        bypasses the axes. The kernel returns wrong bodies there, or crashes. (A closed shell is
        checked on its result: see ``_shell_problem``.)"""
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
        for p, _, depth, opening in rays if openings else []:
            walls = 1 if opening else 2
            if walls * t >= depth - tol:
                at = f"({p.x:.4g}, {p.y:.4g}, {p.z:.4g})"
                if walls == 2:
                    raise ModelingError(f"shell: two walls of {t:.4g} do not fit into the part, which is {depth:.4g} "
                                        f"thick across the face at {at}; use a thinner wall")
                raise ModelingError(f"shell: a wall of {t:.4g} does not fit into the part, which is {depth:.4g} deep "
                                    f"from the face at {at} to the opening; use a thinner wall")

    def _shell_hint(self, openings: list[Any]) -> str:
        """What a failed shell says: that the kernel cannot open a face whose rim meets its
        neighbours tangentially (the flat top of a rounded box), or else that the wall may be too
        thick."""
        for kf in openings:
            for e in Face(self, kf).edges():
                if e.convexity == "smooth":
                    return ("the kernel cannot open a face whose rim meets its neighbours tangentially; shell the "
                            "part before rounding the rim, or shell it closed and cut the opening out")
        return "the wall may be thicker than the part allows"

    def _shell_problem(self, result: Part, d: float, openings: list[Any],
                       rays: list[tuple[Vector, Vector, float, bool]], extended: bool,
                       offset_volume: Callable[[bool], float]) -> str | None:
        """What is wrong with ``result`` as this part shelled by ``d`` (inward when negative), or
        None. Checked at the middle of each ray (``rays``) into the part: where walls grow inward
        and the part is too thin for two (a closed shell; with openings ``shell`` refuses such a
        part), the walls meet, and the point lies in the material. Where the point is farther
        from the faces than the walls reach (any point of the part, for walls that grow outward),
        it lies in the cavity; the extended mode's walls reach farther at inside corners, which it
        makes sharp. A closed shell is the part less its offset by ``d`` (``offset_volume`` of the
        mode), or that offset less the part."""
        t = abs(d)
        tol = 1e-6 * max(self._extent(), 1.0)
        reach = 0.0 if d > 0 else 4 * t if extended else t
        solid, hollow = [], []
        for p, n, depth, opening in rays:
            if d < 0 and not opening and depth <= 2 * t:
                solid.append(p + n * (depth / 2))
                continue
            q = p + n * ((depth + t) / 2 if opening and d < 0 else depth / 2)
            if self.distance_to(q) > reach + tol:
                hollow.append(q)
        where = result._classify(solid + hollow) if solid or hollow else []
        for i, (q, (w, _, _)) in enumerate(zip(solid + hollow, where)):
            at = f"({q.x:.4g}, {q.y:.4g}, {q.z:.4g})"
            if i < len(solid) and w == "outside":
                return (f"a body with a cavity where its walls meet: {at}, within {t:.4g} of the faces on both "
                        f"sides, is not in its material")
            if i >= len(solid) and w == "inside":
                return f"a body without its cavity: {at}, which no wall reaches, lies in its material"
        if openings:
            return None
        try:
            moved = offset_volume(extended)
        except ModelingError as e:  # (also a KernelError, or a crash in the copy of the process)
            return f"a hollow body that cannot be checked: the kernel cannot offset the part by {d:.4g} ({e})"
        if d < 0 and not moved > 0:
            return (f"a hollow body, but two walls of {t:.4g} do not fit into the part: the kernel finds nothing of "
                    f"it left when it shrinks it by {t:.4g}")
        whole = float(self._props(1e-4)["volume"])
        expect, got = abs(whole - moved), float(result._props(1e-4)["volume"])
        if not abs(got - expect) <= 1e-4 * whole:
            return (f"a hollow body of volume {got:.10g}, where the part less its offset by {d:.4g} has "
                    f"{expect:.10g}")
        return None

    def offset(self, distance: float) -> Part:
        """Grow (positive) or shrink (negative) the part by ``distance`` everywhere (0 gives an
        equal copy).

        Results the kernel gets wrong (faces that do not meet, a change of the wrong sign) raise
        :class:`ModelingError`. The kernel step runs in another process (a forked copy on Linux and
        macOS, a helper process on Windows) and is stopped after
        ``smlibpy.defeature.GUARD_SECONDS`` (20 s), as for :meth:`shell`."""
        from ._guard import isolated

        self._require_valid("offset")
        d = float(distance)
        if d == 0:
            return self._like(self._copy_brep())

        def attempt() -> Part:
            # (always the extended mode, which depends on memory layout and can crash: it runs in
            # another process)
            return self._like(isolated("offset", _offset_step, "offset", None, self._brep, d, True))

        return self._checked("offset", [(True, attempt), (True, attempt)], grow=max(d, 0.0), smaller=d < 0)

    def _checked(self, name: str, attempts: Sequence[tuple[bool, Callable[[], Part]]], *, grow: float,
                 smaller: bool | None, problem: Callable[[Part, bool], str | None] | None = None,
                 hint: str = "try a smaller value") -> Part:
        """The first result of ``attempts`` that passes the checks: a valid solid within the part's
        box (grown by ``grow``), whose faces meet (gaps below _OFFSET_GAPS), whose volume went down
        (``smaller``), up (``smaller=False``) or changed (None), and in which ``problem`` finds
        nothing wrong.

        Each attempt is a mode (the kernel's extended offset mode or not) and a function that makes
        the result. An attempt in the mode of the one before runs only when that one's result was
        refused, within _RETRY_SECONDS: the kernel fails the same way again, and only its extended
        mode, which depends on memory layout, ever gave a better result. A step that crashed the
        kernel or did not finish (in the copy of the process it ran in) ends the attempts."""
        box = self.bbox()
        tol = 1e-6 * max(box.diagonal, 1.0) + grow
        before = float(self._props(1e-4)["volume"])
        start = time.monotonic()
        error: KernelError | None = None
        refused: str | None = None
        last: tuple[bool, bool] | None = None  # the mode of the attempt before, and whether it failed
        for mode, attempt in attempts:
            if last is not None and last[0] == mode and (last[1] or time.monotonic() - start > _RETRY_SECONDS):
                continue
            try:
                result = attempt()
            except KernelError as e:
                error, last = e, (mode, True)
                continue
            last = (mode, False)
            why = _offset_problem(result, box, tol, before, smaller) or (problem(result, mode) if problem else None)
            if why is None:
                return result
            refused = refused or why
        if error is not None:
            raise error
        raise ModelingError(f"{name}: the kernel could not build a valid result (it built {refused}); {hint}")

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
        self._require_valid("split")
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
        """The cross-section of the part in a plane, as a sketch. Of a part made by :meth:`merge`,
        the sections of the cells the plane cuts, side by side (a region per cell)."""
        pl = _as_plane(plane)
        if not self._brep.is_manifold_solid():
            # The kernel sections the whole body, where a face between two cells bounds both: the
            # region of a cell inside another was dropped, or the section failed.
            try:
                cells = self.cells()
            except KernelError:
                raise
            except ModelingError as e:
                raise ModelingError(f"section: {e}") from e
            if len(cells) > 1:
                regions: list[Face] = []
                for cell in cells:
                    try:
                        piece = cell.section(pl)
                    except ValueError:  # the plane misses this cell
                        continue
                    # a face between two cells that lies in the plane comes from both
                    regions += [f for f in piece.faces() if not any(_same_region(f, g) for g in regions)]
                if not regions:
                    raise ValueError("the plane does not cut the part")
                sheets = [f.to_shell() for f in regions]
                with kernel_call("section"):
                    return Sketch._wrap(ext.combine([sh._brep for sh in sheets]), pl)
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

    def draft(self, faces: Any, angle: float, neutral_plane: Plane | Face) -> Part:
        """Tilt faces by a draft angle, so that a molded or cast part comes out of its mold.

        Each face turns about the line where it meets the neutral plane and keeps its size
        there. The normal of the neutral plane is the pull direction, the way the mold moves off
        the part: a positive angle turns each face to look more along it, so the part narrows
        and pockets and holes widen along the normal, on either side of the plane. Afterwards
        ``draft_analysis`` of that direction finds ``angle`` more draft on each of the faces.

        Planes can be drafted, and cylinders and cones whose axis runs along the normal (a
        cylinder becomes a cone). A face that meets a drafted face tangentially, such as a
        fillet between two walls, must be drafted with it; the faces around the drafted ones
        are extended or trimmed to meet them.

        Args:
            faces: Faces of this part (a selection or a single face).
            angle: Draft angle in degrees, between -90 and 90 and not 0. A face's draft may be
                89 degrees at most.
            neutral_plane: Where the faces keep their size, a :class:`Plane` or a planar face.
                A face's normal points out of the part: the top face drafts for a mold that
                moves up, the bottom face for one that moves down (use ``Plane.XY`` there).
        """
        from .draft import draft_faces

        return draft_faces(self, faces, angle, neutral_plane)

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


@contextlib.contextmanager
def _curve_copies(curves: list[Any]) -> Iterator[list[Any]]:
    """Kernel curves (copies) for a kernel call that copies what it is given (SmPyLib's "Pure"
    calls: the sweeps, offset profiles, skins), freed once the call is done."""
    try:
        yield curves
    finally:
        for c in curves:
            ext.delete_curve(c)


def _take(h: BrepHandle) -> Any:
    """Release a handle's Brep to a new owner."""
    b, h.brep = h.brep, None
    return b


def _same_region(a: Face, b: Face) -> bool:
    """Two faces of sections in one plane that are the same region (within 1e-6 of their size)."""
    ba, bb = a.bbox(), b.bbox()
    tol = 1e-6 * max(ba.diagonal, bb.diagonal)
    return (ba.min.distance_to(bb.min) <= tol and ba.max.distance_to(bb.max) <= tol
            and abs(a.area - b.area) <= 1e-6 * max(a.area, b.area) and a.center().distance_to(b.center()) <= tol)


def _merge_problem(merged: Part, parts: Sequence[Part]) -> str | None:
    """What is wrong with the result of a merge, or None. Its volume, that of the union, lies
    between that of the largest part and that of all parts together (within 1e-3); a result
    outside that is wrong. The volumes are integrated as precisely as ``volume`` asks (it costs
    about as much as a coarse integration), so that they are there when ``volume`` and
    ``cells()`` ask."""
    try:
        volumes = [float(p._props()["volume"]) for p in parts]
    except KernelError:
        return None  # a part whose volume cannot be integrated (not refused before either)
    try:
        whole = float(merged._props()["volume"])
    except KernelError:
        return "whose volume cannot be integrated"
    if whole < max(volumes) * (1 - 1e-3):
        return f"of volume {whole:.6g}, less than that of the largest part ({max(volumes):.6g})"
    if whole > sum(volumes) * (1 + 1e-3):
        return f"of volume {whole:.6g}, more than that of all parts together ({sum(volumes):.6g})"
    return None


# -- kernel steps that run in another process (smlibpy._guard.isolated) -------------------
def _offset_step(what: str, hint: str | None, brep: Any, d: float, extended: bool) -> Any:
    with kernel_call(what, hint):
        return k.offset_brep(brep, d, extended_offset=extended)


def _shell_step(hint: str, brep: Any, d: float, extended: bool, faces: list[Any]) -> Any:
    with kernel_call("shell", hint):
        return k.shell_brep(brep, d, extended_offset=extended, faces_to_shell=faces)


def _thicken_step(hint: str, brep: Any, d: float) -> Any:
    with kernel_call("thicken", hint):
        return k.shell_brep(brep, d, create_solid=True)


def _region_shells_step(brep: Any) -> Any:
    return ext.region_shells(brep)


def _boolean_step(name: str, brep: Any, tools: list[Any], op: Any, non_manifold: bool) -> Any:
    """A copy of ``brep`` combined with copies of ``tools`` one after the other."""
    h = BrepHandle(brep.copy())
    hint = ("the parts may only touch along an edge or at a point" if non_manifold else
            "the operands may touch only in a degenerate way, or an operand is broken")
    for t in tools:
        with kernel_call(name, hint):
            th = BrepHandle(t.copy())
            h.brep = ext.boolean(h.brep, th.brep, op, non_manifold)
            _take(th)
    return _take(h)


def _round_step(what: str, hint: str, brep: Any, kedges: list[Any], call: tuple[str, tuple[Any, ...], dict[str, Any]]) -> Any:
    """Rounds ``kedges`` of ``brep`` (changed in place, and returned)."""
    name, args, keywords = call
    if name == "fillet_edges_per_edge":  # (the cross-sections cross as numbers)
        args = (args[0], [k.FilletXSect(x) for x in args[1]], *args[2:])
    with _round_call(what, hint):
        getattr(k, name)(brep, kedges, *args, **keywords)
    return brep


def _combine(h: BrepHandle, tool: _Body, op: Any, non_manifold: bool = False) -> None:
    """Combine a copy of a tool into the Brep a handle owns (``ext.boolean``). The kernel changes
    that Brep and deletes the copy when it succeeds, and keeps both when it fails: the handles
    hold them until then and free them on a failure."""
    th = BrepHandle(tool._copy_brep())
    h.brep = ext.boolean(h.brep, th.brep, op, non_manifold)
    _take(th)


# A fillet or chamfer that fails with SM_ERR_INVALID_INPUT fails at any size: the kernel takes an
# edge for one it cannot round, or has no corner for the way the selected edges meet at a vertex.
_ROUND_SELECTION_HINT = ("the kernel cannot round the selection as given, at any size: an edge whose faces meet "
                         "almost tangentially, or a vertex where the selected edges meet in a way it has no corner "
                         "for (such as the two halves of an edge that another face touches tangentially); select "
                         "fewer edges there")


@contextlib.contextmanager
def _round_call(operation: str, hint: str) -> Iterator[None]:
    """:func:`kernel_call` for fillets and chamfers, with the hint for a selection the kernel cannot round."""
    try:
        with kernel_call(operation, hint):
            yield
    except KernelError as e:
        if e.status != "SM_ERR_INVALID_INPUT":
            raise
        raise _traced(KernelError(e.operation, e.detail, e.status, _ROUND_SELECTION_HINT), e) from e


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
        total, half of it to each side of the sheet.

        The kernel step runs in another process (a forked copy on Linux and macOS, a helper
        process on Windows), so that a crash of its offset code raises :class:`ModelingError`, and
        is stopped after ``smlibpy.defeature.GUARD_SECONDS`` (20 s), as for :meth:`Part.shell`."""
        d = float(thickness)
        if d == 0:
            raise ValueError("thicken: the thickness must not be zero")
        hint = ("the kernel cannot offset this sheet (closed grid surfaces and surfaces with a pole fail; "
                "build closed shapes with revolve, loft or extrude, or thicken less than the smallest "
                "concave radius)")
        if both:
            # one side, then the other, fused: the two halves share the sheet
            return self.thicken(d / 2) + self.thicken(-d / 2)
        from ._guard import isolated

        # (the kernel's extended offset mode, which depends on memory layout and can crash: it runs
        # in another process)
        b = isolated("thicken", _thicken_step, hint, self._brep, d)
        part = _require_solid(Part._wrap(b, name=self.name, color=self.color), "thicken", hint)
        part._h.imported = self._h.imported
        return part

    def __add__(self, other: Any) -> Shell:
        h = BrepHandle(self._copy_brep())
        for t in _bodies(other):
            with kernel_call("fuse"):
                _combine(h, t, k.BooleanOp.UNION)
        return self._like(_take(h))

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
        s = Sketch._wrap(brep, self._plane, name=self.name, color=self.color)
        s._h.imported = self._h.imported
        return s

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

    def _boolean2d_with(self, tools: list[Sketch], op: Any, name: str, *, split: bool = True) -> Sketch:
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
        if split:
            contact = self._contact()
            for t in tools:
                if contact is None:
                    contact = t._contact()
            if contact is not None:
                return self._boolean2d_by_faces(tools, op, name, contact)
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
            # The kernel changes a and deletes b when it succeeds with a region, and keeps both when
            # it fails or the region is empty: the handles hold them until then.
            ha, hb = BrepHandle(a), BrepHandle(b)
            try:
                with kernel_call(name):
                    made = k.boolean_2d(ha.brep, hb.brep, operation=op)
                if made is not None:
                    _take(ha), _take(hb)
                    result = self._like(made)  # (a, changed)
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

    def _contact(self) -> Vector | None:
        """A point where two faces of the sketch, or two loops of one face, touch (a vertex of
        one at a vertex of the other, as in an exclusive or of circles); None if none do."""
        points: list[tuple[float, float, float]] = []
        loops: list[int] = []
        n = 0
        for f in self.faces():
            for w in f.wires():
                for v in w.vertices():
                    points.append(v.point.to_tuple())
                    loops.append(n)
                n += 1
        if n < 2:
            return None
        p = np.array(points)
        tol = 1e-6 * max(1.0, self._loose_box().diagonal)
        order = np.argsort(p[:, 0])
        for rank, i in enumerate(order):
            for j in order[rank + 1:]:
                if p[j, 0] - p[i, 0] > tol:
                    break
                if loops[i] != loops[j] and np.linalg.norm(p[i] - p[j]) <= tol:
                    return Vector(*p[i])
        return None

    def _face_sketches(self) -> list[Sketch]:
        """Each face as a sketch of its own."""
        with kernel_call("copy face"):
            return [self._like(ext.copy_faces(self._brep, [f._f])) for f in self.faces()]

    def _combined(self, pieces: list[Sketch]) -> Sketch:
        """The faces of sketches whose regions do not overlap, in one sketch (no Boolean)."""
        pieces = [p for p in pieces if p._brep.face_count()]
        if not pieces:
            return self._empty()
        with kernel_call("combine"):
            return self._like(ext.combine([p._brep for p in pieces]))

    def _boolean2d_by_faces(self, tools: list[Sketch], op: Any, name: str, contact: Vector) -> Sketch:
        """A planar Boolean of sketches with faces that touch each other at a point.

        There the kernel's planar Boolean misclassifies whole faces without an error, in either
        operand: of ``abc = Circle(5) ^ Circle(5).translate(4, 0) ^ Circle(5).translate(2, 4)``
        and a triangle around it, ``&`` kept 86.6355 of 110.5398 and ``-`` left 23.9044 behind.
        The intersection of two single faces is reliable, so ``&`` is taken face by face. The
        other operations are computed in the ways below, each checked against those overlaps
        (area and first moments); the first that holds is the result.
        """
        own = self._face_sketches()
        other: list[Sketch] = []
        owner: list[int] = []
        for n, t in enumerate(tools):
            for g in t._face_sketches():
                other.append(g)
                owner.append(n)

        def wrong() -> ModelingError:
            return ModelingError(f"{name}: the sketches have faces that touch each other at a point, as at "
                                 f"{_fmt_point(contact)}, and the kernel's planar Boolean gives a wrong region there "
                                 f"(checked against the overlaps of the faces); move one of the shapes that make "
                                 f"those faces a little, so that no two faces meet at a single point")

        box = self.bbox()  # (the loose boxes of planar faces can be far larger than the faces)
        for t in tools:
            box = box.union(t.bbox())
        ref = box.center

        def measure(sketches: Iterable[Sketch]) -> np.ndarray:
            total = np.zeros(4)
            with kernel_call(name):
                for s in sketches:
                    for f in s.faces():
                        a = f.area
                        total += (a, *((f.center() - ref) * a).to_tuple())
            return total

        try:
            areas = [float(measure([f])[0]) for f in own] + [float(measure([g])[0]) for g in other]
        except KernelError:
            raise wrong() from None
        # The areas to 1e-7 of the operands' (the kernel's own are exact to about 1e-12 on lines and
        # 1e-10 on arcs), the first moments to that times the size.
        tol = 1e-7 * sum(areas) + 1e-12
        common: dict[tuple[int, int], Sketch] = {}
        for i, f in enumerate(own):
            for j, g in enumerate(other):
                if not _disjoint(f._loose_box(), g._loose_box()):
                    piece = f._boolean2d_with([g], k.BooleanOp2D.INTERSECTION, name, split=False)
                    if piece._brep.face_count():
                        common[i, j] = piece
        try:
            # (an overlap larger than one of its two faces is wrong)
            if any(measure([piece])[0] > min(areas[i], areas[len(own) + j]) + tol for (i, j), piece in common.items()):
                raise wrong()
        except KernelError:
            raise wrong() from None

        def holds(result: Sketch, want: np.ndarray) -> bool:
            try:
                got = measure([result])
            except KernelError:  # a face of the result is broken: it does not hold
                return False
            return abs(got[0] - want[0]) <= tol and float(np.linalg.norm(got[1:] - want[1:])) <= tol * box.diagonal

        def first(ways: list[Callable[[], Sketch]], want: np.ndarray) -> Sketch:
            for way in ways:
                try:
                    result = way()
                except RuntimeError:  # a KernelError, ModelingError or a kernel call that failed
                    continue
                if holds(result, want):
                    return result
            raise wrong()

        def assembled(pieces: list[Sketch]) -> Sketch:
            # Pieces that do not overlap, joined by unions so that they share their vertices as
            # the kernel's own regions do (pieces that merely lie side by side do not extrude).
            pieces = [p for p in pieces if p._brep.face_count()]
            if not pieces:
                return self._empty()

            def joined() -> Sketch:
                result = pieces[0]
                for p in pieces[1:]:
                    result = p._boolean2d_with([result], k.BooleanOp2D.UNION, name, split=False)
                return self._like(result._copy_brep())

            try:
                return first([joined], measure(pieces))
            except ModelingError:
                return self._combined(pieces)

        def cut(f: Sketch, whole: list[Sketch], faces: list[Sketch], overlaps: list[Sketch]) -> Sketch:
            # f less the sketches ``whole``, whose faces ``faces`` overlap it by ``overlaps``
            if not faces:
                return f

            def one_by_one() -> Sketch:
                parts = [f]
                for g in faces:
                    parts = [q for p in parts for q in (
                        [p] if _disjoint(p._loose_box(), g._loose_box())
                        else p._boolean2d_with([g], k.BooleanOp2D.DIFFERENCE, name, split=False)._face_sketches())]
                return f._combined(parts)

            tool = whole[0] if len(whole) == 1 else f._combined(whole)
            return first([lambda: f._boolean2d_with(whole, k.BooleanOp2D.DIFFERENCE, name, split=False), one_by_one,
                          lambda: f._slab_or_empty(tool, k.BooleanOp2D.DIFFERENCE, name)],
                         measure([f]) - measure(overlaps))

        def mine() -> list[Sketch]:
            out = []
            for i, f in enumerate(own):
                js = [j for (a, j) in common if a == i]
                out.append(cut(f, [tools[n] for n in sorted({owner[j] for j in js})], [other[j] for j in js],
                               [common[i, j] for j in js]))
            return out

        def run() -> Sketch:
            if op == k.BooleanOp2D.INTERSECTION:
                return assembled(list(common.values()))
            if op == k.BooleanOp2D.DIFFERENCE:
                return assembled(mine())
            whole = measure([self]) + measure(tools) - measure(common.values())
            if op == k.BooleanOp2D.UNION:
                tool = tools[0] if len(tools) == 1 else self._combined(list(tools))
                return first([lambda: self._boolean2d_with(tools, op, name, split=False),
                              lambda: assembled(mine() + other),
                              lambda: self._slab_or_empty(tool, op, name)], whole)
            # exclusive or: what is in one sketch only, from either side
            theirs = []
            for j, g in enumerate(other):
                iis = [i for (i, b) in common if b == j]
                theirs.append(cut(g, [self], [own[i] for i in iis], [common[i, j] for i in iis]))
            return first([lambda: assembled(mine() + theirs)], whole - measure(common.values()))

        try:
            return run()
        except KernelError:  # a face that cannot be measured, or a kernel call outside the ways
            raise wrong() from None

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
                with kernel_call("offset", "the offset may collapse the region"), \
                        _curve_copies(wire._copy_curves()) as curves:
                    b = k.create_offset_profile(curves, distance, offset_type=side, round_corners=round)
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
            with kernel_call("extrude", hint), _curve_copies(loops[0]._copy_curves()) as curves:
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
                with kernel_call("extrude", hint), _curve_copies(w.reversed()._copy_curves()) as curves:
                    hole = Part._wrap(k.draft_sweep(curves, float(amount), -float(taper)))
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
                with _curve_copies(loops[0]._copy_curves()) as curves:
                    piece = Part._wrap(k.rotational_sweep(curves, o, d, float(angle), cap_ends=True))
                for w in loops[1:]:
                    with _curve_copies(w._copy_curves()) as curves:
                        piece = piece - Part._wrap(k.rotational_sweep(curves, o, d, float(angle), cap_ends=True))
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
