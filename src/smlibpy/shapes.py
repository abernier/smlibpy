"""Shapes: vertices, edges, wires, faces, sketches, shells and parts.

Every shape is an immutable value. Operations never modify a shape; they return a
new one. Faces, edges and vertices taken from a body (``part.faces()``) stay valid
for as long as you hold them and can be passed back to operations on that body
(``part.fillet(part.edges().parallel_to(Z), 2)``).
"""

from __future__ import annotations

import contextlib
import itertools
import math
import time
import weakref
from typing import TYPE_CHECKING, Any, Callable, Iterable, Iterator, NamedTuple, Sequence, TypeVar, Union, overload

import numpy as np

from ._kernel import BrepHandle, CurveHandle, KernelError, ModelingError, _traced, ext, k, kernel_call
from .geometry import (TOLERANCE, Axis, BoundBox, ClosestPoints, Continuity, Curvature, Hit, Location, Nurbs,
                       NurbsSurface, Plane, Rot, Vector, VectorLike, X, Y, Z, _direction, _vec)

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
    "SectionProperties",
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

# A sharp offset may reach this many times farther than its first-order reach (see
# Part._sharp_offset_reach) before it is refused: curved faces extended past an edge bend away from
# their tangent planes (two spherical caps offset by 1 reached 0.98 of it). The reach counts up to
# _SHARP_OFFSET_REACH (an edge of 4.6 degrees): beyond that, and at faces that meet back to back, a
# sharp offset is refused where it reaches farther (corners="round" builds such parts).
_SHARP_OFFSET_SLACK = 1.25
_SHARP_OFFSET_REACH = 25.0

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
    def mesh(self, tolerance: float | None = None, angle: float = 15.0, *, max_edge: float | None = None) -> "Mesh":
        """Triangulate the shape (see :func:`smlibpy.mesh.tessellate`; ``max_edge`` is the longest
        edge a triangle may have)."""
        from .mesh import tessellate

        return tessellate(self, tolerance=tolerance, angle=angle, max_edge=max_edge)

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

    def tangent_chain(self) -> ShapeList[T]:
        """The edges of the list and the edges that continue them tangentially (see
        :meth:`Edge.tangent_chain`): what ``fillet`` and ``chamfer`` round for this selection.
        Other shapes are left out."""
        return ShapeList(_tangent_chains([s for s in self if isinstance(s, Edge)])[0])  # type: ignore[misc]

    def g1(self) -> ShapeList[T]:
        """Edges whose two faces meet at least tangentially all along them (``"G1"`` or ``"G2"``
        by :meth:`Edge.continuity`): the borders of fillets and blends."""
        return ShapeList(s for s in self if _level_of(s) in ("G1", "G2"))

    def g2(self) -> ShapeList[T]:
        """Edges whose two faces meet with equal curvature as well (``"G2"`` by
        :meth:`Edge.continuity`): the borders of curvature-continuous blends
        (``fillet(..., continuity="G2")``), seams of smooth surfaces."""
        return ShapeList(s for s in self if _level_of(s) == "G2")

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

    # -- history ------------------------------------------------------------
    def new(self, since: Any) -> ShapeList[T]:
        """The faces or edges that are new since the given bodies: made by the operations that
        led from them to this list's body, descending from no face or edge of theirs.

        ``since`` is a body (part, shell, sketch) or a list of them, or faces and edges (then
        only those count as old). After a Boolean, the curves along which the bodies' faces cross
        (``(plate + boss).edges().new(since=[plate, boss])``: the circle where a boss reaching
        into the plate meets its top; where an edge of one body lies on the other, such as the
        bottom edge of a boss standing on the plate, that edge is not new: :meth:`joining` finds
        both); after a fillet, chamfer or shell, its new faces (``rounded.faces().new(since=part)``)
        and their edges.

        smlibpy marks every face and edge of every body it makes, and the kernel carries the
        marks along: a copy keeps them, both halves of a split face keep their parent's, a face
        merged from two keeps both. A moved, turned, mirrored or scaled copy gets new marks (it
        is a shape of its own). A body read from a file, and a section, have new marks
        everywhere, so all of them counts as new.
        """
        old = _history_tags(since, "new")
        return ShapeList(s for s, t in zip(self, _item_tags(self, "new")) if not t & old)

    def derived_from(self, *shapes: Any) -> ShapeList[T]:
        """The faces or edges that descend from the given shapes: faces from faces, edges from
        edges, both from a body (part, shell, sketch). A face that an operation split, trimmed,
        moved along with the part or merged with another descends from it; one the operation
        made anew does not.

        ``(plate - holes).faces().derived_from(holes)`` gives the walls of the holes;
        ``cut.edges().derived_from(box.edges().top())`` the pieces of the top edges of a box
        that a slot cut. A body's faces and edges are marked as described in :meth:`new`.
        """
        wanted = _history_tags(shapes, "derived_from")
        return ShapeList(s for s, t in zip(self, _item_tags(self, "derived_from")) if t & wanted)

    def joining(self, a: Any, b: Any) -> ShapeList[T]:
        """The edges that lie on the surfaces of both ``a`` and ``b``: where two bodies that a
        Boolean combined meet, the edges to round or chamfer after it.
        ``(plate + boss).edges().joining(plate, boss)`` gives the circle where the boss stands on
        the plate, also where the boss's bottom face lay on the plate's top (which ``new`` does not
        count as new: the circle is the boss's bottom edge), ``(block - hole).edges().joining(block,
        hole)`` the rims of the hole. ``a`` and ``b`` are bodies (parts, shells, sketches) or lists of
        them (an edge on any of them counts).

        Each edge is tested at a quarter, half and three quarters of the way along it: there it lies
        on a face of a body (within the edge's tolerance, at least 1e-6 of the bodies' size) where
        :meth:`Part.classify` puts it on the body's surface. Edges of a merged face (a face of each
        body lying in one plane, merged by a union) are not on both surfaces and are not taken.
        """
        firsts, seconds = _joined_bodies(a), _joined_bodies(b)
        edges = [s for s in self if isinstance(s, Edge)]
        if len(edges) != len(self):
            raise TypeError(f"joining selects edges, not a {type(next(s for s in self if not isinstance(s, Edge))).__name__}")
        boxes = [x._loose_box() for x in firsts + seconds]
        size = max(boxes[0].union(boxes[-1]).diagonal, 1.0)
        out: ShapeList[T] = ShapeList()
        for e in edges:
            tol = max(e.tolerance if e._e is not None else 0.0, 1e-6 * size)
            box = e.bbox()
            if not (any(not _disjoint(box, x._loose_box(), tol) for x in firsts)
                    and any(not _disjoint(box, x._loose_box(), tol) for x in seconds)):
                continue
            points = [e.point_at(t) for t in (0.25, 0.5, 0.75)]
            if _on_any(firsts, points, tol) and _on_any(seconds, points, tol):
                out.append(e)  # type: ignore[arg-type]
        return out

    def shared(self) -> ShapeList[T]:
        """The faces that lie between two cells of a merged part (see :meth:`Part.merge`): where two
        materials meet, the faces a simulation mesh must match across or a contact condition goes
        on. ``merge(block, insert).faces().shared()``; :attr:`Face.cells` says which two cells."""
        faces = [s for s in self if isinstance(s, Face)]
        if len(faces) != len(self):
            raise TypeError(f"shared selects faces, not a {type(next(s for s in self if not isinstance(s, Face))).__name__}")
        return ShapeList(f for f in faces if len(f.cells) > 1)  # type: ignore[misc]

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
    one kernel call for the edges of each body. An edge whose faces meet tangentially at its
    middle is smooth only if they do at 5 points along it; else it takes the kind where they turn
    most (a crease that a fillet runs out into, a blend that is tangent only in places)."""
    edges = [s for s in items if isinstance(s, Edge)]
    angles = {id(e): a for e, a in zip(edges, _outer_angles(edges))}
    tangent = [e for e in edges if angles[id(e)] is not None and _angle_kind(angles[id(e)]) == "smooth"]
    for e, along in zip(tangent, _outer_angles(tangent, 5)):
        if along:
            worst = max(along, key=lambda a: abs(a - 180.0))
            if _angle_kind(worst) != "smooth":
                angles[id(e)] = worst
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


@overload
def _outer_angles(edges: Sequence[Edge]) -> list[float | None]: ...
@overload
def _outer_angles(edges: Sequence[Edge], samples: int) -> list[list[float]]: ...
def _outer_angles(edges: Sequence[Edge], samples: int = 0) -> Any:
    """The kernel's outer angle of each edge in degrees (``ext.edge_angles``: above 180 at a
    convex edge), one call per body; None where the kernel cannot tell (an edge that does not
    lie between two faces of a solid, a standalone curve). With ``samples``, the angles at that
    many points along each edge (``ext.edge_outer_angles``; [] where the kernel cannot tell)."""
    out: list[Any] = [[] if samples else None for _ in edges]
    bodies: dict[int, tuple[Any, list[int]]] = {}
    for i, e in enumerate(edges):
        if e._e is not None and e._owner is not None:
            bodies.setdefault(id(e._owner), (e._owner, []))[1].append(i)
    for owner, idx in bodies.values():
        kedges = [edges[i]._e for i in idx]
        found = ext.edge_outer_angles(owner._brep, kedges, samples) if samples else ext.edge_angles(owner._brep, kedges)
        for i, a in zip(idx, found):
            out[i] = list(a) if samples else a
    return out


def _continuity_level(gap: float, gap_tol: float, angle: float, angle_tol: float, jump: float, curvature: float,
                      curvature_tol: float, length: float) -> str | None:
    """The continuity level from the largest gap, angle and curvature jump between two sides."""
    if not gap <= gap_tol:
        return None
    if not angle <= angle_tol:
        return "G0"
    if not jump <= curvature_tol * curvature + 1e-3 / max(length, 1e-9):  # (NaN: no curvature to compare)
        return "G1"
    return "G2"


def _angle_kind(outer: float) -> str:
    """The convexity of an edge with this outer angle (degrees): smooth within half a degree of
    180, as the faces' normals are within half a degree."""
    return "smooth" if abs(outer - 180.0) < 0.5 else "convex" if outer > 180.0 else "concave"


def _level_of(s: Any) -> str | None:
    """The continuity level of an edge between two faces, None for anything else (and where the
    faces cannot be evaluated at the edge)."""
    if not isinstance(s, Edge) or s._e is None:
        return None
    try:
        return s.continuity().level
    except (ValueError, KernelError):
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


def _joined_bodies(x: Any) -> list[_Body]:
    """The bodies of an argument of ``ShapeList.joining``: a body or a list of them."""
    if isinstance(x, _Body):
        return [x]
    if isinstance(x, Iterable) and not isinstance(x, (str, bytes, Shape)):
        out = [y for y in x]
        if out and all(isinstance(y, _Body) for y in out):
            return out
    raise TypeError(f"joining takes bodies (parts, shells, sketches) or lists of them, not a {type(x).__name__}")


def _on_any(bodies: Sequence[_Body], points: Sequence[Vector], tol: float) -> bool:
    """Whether every point lies on the surface of one of the bodies, within ``tol``."""
    left = list(points)
    for x in bodies:
        if not left:
            break
        if isinstance(x, Part):
            on = [where in ("face", "edge", "vertex") for where, _, _ in x._classify(left, tol)]
        else:
            on = [x.distance_to(p) <= tol for p in left]
        left = [p for p, o in zip(left, on) if not o]
    return not left


def _topology_tags(body: _Body) -> tuple[list[list[int]], list[list[int]]]:
    """The tags of a body's faces and edges, in its order (``ext.topology_tags``, read once)."""
    h = body._h
    if h.tags is None:
        h.tags = ext.topology_tags(h.brep)
    return h.tags


def _shells_of(body: _Body) -> tuple[list[dict[str, Any]], list[tuple[int, ...]]]:
    """A body's shells (``ext.brep_shells``) and the cells each face bounds (as ``Part.cells`` counts
    them), read once (kernel plan T7)."""
    h = body._h
    if h.shells is None:
        shells = ext.brep_shells(h.brep)
        cells: list[set[int]] = [set() for _ in range(h.brep.face_count())]
        for s in shells:
            if s["kind"] == "cell":
                for f in s["faces"]:
                    cells[f].add(s["cell"])
        h.shells = (shells, [tuple(sorted(c)) for c in cells])
    return h.shells


def _put_face_attrs(brep: Any, colors: Sequence[Any], names: Sequence[Any]) -> None:
    """Colors and names (``ext.face_attrs`` of the same body, read back from a file, or from a STEP
    file's faces) on the faces of a Brep in its order; nothing where the counts differ."""
    faces = brep.faces()
    if len(faces) != len(colors) or len(faces) != len(names):
        return
    pick = [i for i, c in enumerate(colors) if c is not None and len(c) == 3]
    if pick:
        ext.set_face_colors(brep, [faces[i] for i in pick], [[float(x) for x in colors[i]] for i in pick])
    pick = [i for i, n in enumerate(names) if n]
    if pick:
        ext.set_face_names(brep, [faces[i] for i in pick], [str(names[i]) for i in pick])


def _face_cells(body: _Body) -> list[tuple[int, ...]]:
    """Per face of a body, the cells it bounds (``Face.cells``)."""
    return _shells_of(body)[1]


def _item_tags(items: Sequence[Any], what: str) -> list[frozenset[int]]:
    """The tags of each face or edge of bodies (none for an edge of no body)."""
    out: list[frozenset[int]] = [frozenset()] * len(items)
    groups: dict[int, tuple[_Body, list[int], list[int]]] = {}
    for i, s in enumerate(items):
        if not isinstance(s, (Face, Edge)):
            raise TypeError(f"{what} selects faces and edges, not a {type(s).__name__}")
        owner = s._owner
        if not isinstance(owner, _Body) or (isinstance(s, Edge) and s._e is None):
            continue
        g = groups.setdefault(id(owner._h), (owner, [], []))
        (g[1] if isinstance(s, Face) else g[2]).append(i)
    for owner, faces, edges in groups.values():
        ft, et = _topology_tags(owner)
        if faces:
            for i, j in zip(faces, ext.face_indices(owner._brep, [items[i]._f for i in faces])):
                out[i] = frozenset(ft[j]) if j >= 0 else frozenset()
        if edges:
            for i, j in zip(edges, ext.edge_indices(owner._brep, [items[i]._e for i in edges])):
                out[i] = frozenset(et[j]) if j >= 0 else frozenset()
    return out


def _history_tags(shapes: Any, what: str) -> set[int]:
    """The tags of bodies (of all their faces and edges), faces and edges, also in lists."""
    out: set[int] = set()
    items: list[Any] = []

    def walk(x: Any) -> None:
        if isinstance(x, _Body):
            ft, et = _topology_tags(x)
            for t in ft + et:
                out.update(t)
        elif isinstance(x, (Face, Edge)):
            items.append(x)
        elif isinstance(x, Wire):
            items.extend(x.edges())
        elif isinstance(x, Iterable) and not isinstance(x, (str, bytes, Shape)):
            for y in x:
                walk(y)
        else:
            raise TypeError(f"{what} takes bodies, faces and edges (or lists of them), not a {type(x).__name__}")

    walk(shapes)
    for t in _item_tags(items, what):
        out.update(t)
    return out


def _descendants(body: _Body, items: Sequence[Any], faces: bool) -> list[list[Any]]:
    """Per face (``faces``) or edge of another body, the kernel faces or edges of ``body`` that
    descend from it (carry one of its tags); seam edges are left out."""
    tags = _item_tags(items, "select")
    ft, et = _topology_tags(body)
    own = body._brep.faces() if faces else body._brep.edges()
    seams = set() if faces else set(ext.seam_edges(body._brep))
    holders: dict[int, list[int]] = {}  # tag -> the faces or edges of the body that carry it
    for j, mine in enumerate(ft if faces else et):
        if j not in seams:
            for tag in mine:
                holders.setdefault(tag, []).append(j)
    return [[own[j] for j in sorted({j for tag in t for j in holders.get(tag, ())})] for t in tags]


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

    @property
    def tolerance(self) -> float:
        """How far the edges and faces that meet at this vertex may pass from its point: the
        kernel's tolerance of the vertex (1e-5 on most parts; larger where the surfaces of an
        imported, stitched or healed body meet less exactly). ``ValueError`` for a vertex of no
        body (``Vertex(x, y, z)``)."""
        if self._v is None:
            raise ValueError("tolerance: a vertex of no body has no tolerance")
        return float(ext.vertex_tolerance(self._v))

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
            self._cache = (float(t0), float(t1), None)
        return self._cache[0], self._cache[1]

    def _length(self) -> float:
        """The arc length, measured once (an edge does not change; a long helix takes a while)."""
        t0, t1 = self._range()
        if self._cache[2] is None:  # type: ignore[index]
            self._cache = (t0, t1, float(ext.curve_length(self._curve(), t0, t1)))
        return self._cache[2]  # type: ignore[index,return-value]

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
        s = t * self._length()
        u, _ = ext.curve_parameter_at_length(self._curve(), t0, s)
        return float(min(max(u, t0), t1))

    # -- properties -----------------------------------------------------------
    @property
    def geom_type(self) -> str:
        """``"line"``, ``"circle"`` (also arcs), ``"ellipse"``, ``"bspline"`` or ``"other"``."""
        return ext.curve_kind(self._curve())

    @property
    def tolerance(self) -> float:
        """How far this edge's curve, its ends and the faces it bounds may lie apart: the
        kernel's tolerance of the edge (1e-5 on most parts; larger where the surfaces of an
        imported, stitched or healed body meet less exactly). ``ValueError`` for an edge of no
        body (a curve made with ``Line``, ``Spline``, ...)."""
        if self._e is None:
            raise ValueError("tolerance: an edge of no body has no tolerance")
        return float(ext.edge_tolerance(self._e))

    @property
    def length(self) -> float:
        return self._length()

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
        degree) all along the edge. Taken at the middle of the edge; an edge that is tangent there
        but not at points along it takes the kind where its faces turn most. Edges with a single
        face count as convex."""
        return _convexities([self])[0]  # type: ignore[return-value]

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
        return 180.0 + turn if self._probed_convexity(0.5, 1) == "concave" else 180.0 - turn

    def _probed_convexity(self, at: float = 0.5, samples: int = 5) -> str:
        """The convexity from the faces' normals and a step into face 1, for edges the kernel's
        outer angle does not cover (an edge of a sheet, an inner edge of a merged part): at the
        middle, and where the faces meet tangentially there, at the point along the edge (of
        ``samples``) where their normals differ most. On edges that lie off their faces by more
        than the step (imported bodies) the step can read noise."""
        if self._e is None:
            return "convex"
        fs = self._e.faces()
        if len(fs) != 2:
            return "convex"
        f1, f2 = Face(self._owner, fs[0]), Face(self._owner, fs[1])
        p = self.point_at(at)
        n1, n2 = f1.normal_at(p), f2.normal_at(p)
        if n1.angle_to(n2) < 0.5:
            if samples <= 1:
                return "smooth"
            turns = [(f1.normal_at(q).angle_to(f2.normal_at(q)), t)
                     for t, q in ((t, self.point_at(t)) for t in ((i + 0.5) / samples for i in range(samples)))]
            turn, t = max(turns)
            return "smooth" if turn < 0.5 else self._probed_convexity(t, 1)
        t = self.tangent_at(at)
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
        # exact: the ends, the corners and where the tangent is perpendicular to an axis
        t0, t1 = self._range()
        with kernel_call("bbox"):
            lo, hi = ext.curve_box(self._curve(), t0, t1)
        return BoundBox(lo, hi)

    def distance_to(self, point: VectorLike | _Body) -> float:
        """Distance to a point, or to a body (see :meth:`Part.distance_to`)."""
        if isinstance(point, _Body):
            return point.distance_to(self)
        p = _vec(point)
        with kernel_call("distance", "the kernel finds no closest point on this edge"):
            if self._e is not None:
                _, _, d = self._e.closest_point(p.to_tuple())
                return float(d)
            _, _, d = k.curve_closest_point(self._curve(), p.to_tuple())
        return float(d)

    def closest_point(self, point: VectorLike | Vertex) -> Vector:
        """The point of the edge nearest to ``point``."""
        return self._closest(point)[0]

    def param_at_point(self, point: VectorLike | Vertex) -> float:
        """Where on the edge the point nearest to ``point`` lies, as a fraction of the edge's
        length from its start (0) to its end (1), as :meth:`point_at` takes it:
        ``edge.point_at(edge.param_at_point(p))`` is ``edge.closest_point(p)`` (build123d's
        name)."""
        return self._fraction(self._closest(point)[1])

    def _closest(self, point: VectorLike | Vertex) -> tuple[Vector, float, float]:
        """The nearest point of the edge, its kernel parameter and its distance."""
        p = point.point if isinstance(point, Vertex) else _vec(point)
        if self._e is not None:
            q, u, d = self._e.closest_point(p.to_tuple())
        else:
            q, u, d = k.curve_closest_point(self._curve(), p.to_tuple())
            q = (q.x, q.y, q.z)  # (a Vec3)
        t0, t1 = self._range()
        return Vector(q), float(min(max(u, t0), t1)), float(d)

    def _fraction(self, u: float) -> float:
        """The fraction of the length (in edge direction) at kernel parameter ``u``."""
        t0, t1 = self._range()
        u = min(max(float(u), t0), t1)
        if u <= t0 or t1 <= t0:
            f = 0.0
        elif u >= t1:
            f = 1.0
        elif self.geom_type == "line":
            f = (u - t0) / (t1 - t0)
        else:
            total = float(ext.curve_length(self._curve(), t0, t1))
            f = float(ext.curve_length(self._curve(), t0, u)) / total if total > 0 else 0.0
        f = min(max(f, 0.0), 1.0)
        return 1.0 - f if self._rev else f

    def _at(self, at: float | VectorLike | Vertex, what: str) -> float:
        """The kernel parameter of ``at``: a fraction of the length or a point on the edge."""
        if isinstance(at, (int, float, np.integer, np.floating)) and not isinstance(at, bool):
            t = float(at)
            if not 0.0 <= t <= 1.0:
                raise ValueError(f"{what}: a fraction of the edge runs from 0 to 1, got {t:g}")
            return self._param(t)
        p = at.point if isinstance(at, Vertex) else _vec(at)
        q, u, d = self._closest(p)
        tol = 1e-6 * max(1.0, self.length)
        if d > tol:
            raise ValueError(f"{what}: the point {_fmt_point(p)} lies {d:.6g} off the edge (the nearest point of "
                             f"the edge is {_fmt_point(q)}); pass a point on the edge or a fraction from 0 to 1")
        return u

    def _piece(self, lo: float, hi: float, what: str) -> Edge:
        """The edge between kernel parameters lo < hi, in edge direction (a new curve)."""
        with kernel_call(what):
            c = ext.trimmed_curve(self._curve(), float(lo), float(hi))
        if self._rev:
            ext.reverse_curve(c)
        return Edge._from_curve(c)

    def trim(self, start: float | VectorLike | Vertex, end: float | VectorLike | Vertex) -> Edge:
        """The part of the edge from ``start`` to ``end``, each a fraction of the length (as in
        :meth:`point_at`) or a point on the edge. The part keeps the curve: a trimmed arc is an
        arc, a trimmed spline the same spline. ``start`` must come before ``end`` along the edge.

        ::

            arc = CenterArc((0, 0), 10, 0, 180).trim(0.25, 0.75)    # the arc from 45 to 135 degrees
            tail = Spline((0, 0), (10, 10), (20, 0)).trim((10, 10, 0), 1.0)
        """
        u0, u1 = self._at(start, "trim"), self._at(end, "trim")
        lo, hi = (u1, u0) if self._rev else (u0, u1)
        t0, t1 = self._range()
        if not hi - lo > 1e-12 * max(1.0, abs(t1 - t0)):
            raise ValueError("trim: the start must come before the end along the edge (fractions from 0 at its "
                             "start to 1 at its end)")
        return self._piece(lo, hi, "trim")

    def split(self, at: float | VectorLike | Vertex) -> tuple[Edge, Edge]:
        """The edge cut in two at ``at``, a fraction of the length or a point on the edge: the part
        before and the part after, each keeping the curve. ::

            a, b = Line((0, 0), (10, 0)).split(0.3)                 # 3 and 7 long
            left, right = edge.split(edge.intersections(other)[0])
        """
        u = self._at(at, "split")
        t0, t1 = self._range()
        length = self.length
        before = float(ext.curve_length(self._curve(), t0, u)) if u > t0 else 0.0
        if min(before, length - before) <= 1e-9 * max(1.0, length):
            raise ValueError("split: the point is an end of the edge; there is nothing to split")
        a, b = self._piece(t0, u, "split"), self._piece(u, t1, "split")
        return (b, a) if self._rev else (a, b)

    def extend(self, distance: float, *, end: str = "end", continuity: str = "G1") -> Edge:
        """The edge made longer by ``distance`` at its ``end`` (``"end"``, ``"start"`` or
        ``"both"``), for cut tools and paths that must run past a body.

        Lines and arcs (circles and ellipses) go on as themselves. Other curves are continued
        as ``continuity`` says: ``"G1"`` straight along the end tangent, ``"G2"`` with the
        curvature at the end, ``"natural"`` as the curve's own polynomial goes on. The added
        length is ``distance`` in every case. ::

            groove_path = Spline((0, 0), (20, 8), (40, 0)).extend(5, end="both")
        """
        if not (isinstance(distance, (int, float)) and math.isfinite(distance) and distance > 0):
            raise ValueError(f"extend: the distance must be positive, got {distance!r} (use trim to shorten an edge)")
        if end not in ("start", "end", "both"):
            raise ValueError(f"extend: end must be 'start', 'end' or 'both', got {end!r}")
        modes = {"G1": 1, "G2": 2, "natural": 0}
        if continuity not in modes:
            raise ValueError(f"extend: continuity must be 'G1', 'G2' or 'natural', got {continuity!r}")
        if self.is_closed:
            raise ValueError("extend: a closed edge has no ends to extend")
        e = self
        if end in ("start", "both"):
            e = e._extended(float(distance), True, modes[continuity])
        if end in ("end", "both"):
            e = e._extended(float(distance), False, modes[continuity])
        return e

    def _extended(self, d: float, at_start: bool, continuity: int) -> Edge:
        from .curves import EllipticalArc, Line, ThreePointArc

        kind = self.geom_type
        a, b = self.start, self.end
        if kind == "line":
            u = (b - a).normalized()
            return Line(a - u * d, b) if at_start else Line(a, b + u * d)
        if kind in ("circle", "ellipse"):
            data = ext.curve_data(self._curve())
            pl = data["placement"]
            c, xd, zd = Vector(pl["origin"]), Vector(pl["x_dir"]), Vector(pl["z_dir"])
            yd = zd.cross(xd)
            r1, r2 = (data["radius"], data["radius"]) if kind == "circle" else (data["radius1"], data["radius2"])

            def angle(p: Vector) -> float:
                q = p - c
                return math.atan2(q.dot(yd) / r2, q.dot(xd) / r1)

            # the turn of the edge about zd: +1 counterclockwise, -1 clockwise
            sense = 1.0 if (a - c).cross(self.tangent_at(0.0)).dot(zd) > 0 else -1.0
            span = (sense * (angle(b) - angle(a))) % (2 * math.pi)
            span = span or 2 * math.pi
            add = _ellipse_angle_for_length(r1, r2, angle(a if at_start else b), d, -sense if at_start else sense)
            if span + add >= 2 * math.pi - 1e-9:
                raise ValueError(f"extend: the arc would reach around its whole {kind} (it is {self.length:.6g} long); "
                                 f"extend it less")
            a0 = angle(a) - sense * add if at_start else angle(a)
            total = span + add
            if kind == "circle":
                plane = Plane(c, xd, zd)

                def point(t: float) -> Vector:
                    return plane.from_local(Vector(r1 * math.cos(t), r1 * math.sin(t), 0.0))

                return ThreePointArc(point(a0), point(a0 + sense * total / 2), point(a0 + sense * total))
            lo = math.degrees(a0 if sense > 0 else a0 - total)
            arc = EllipticalArc((0, 0), r1, r2, lo, lo + math.degrees(total), plane=Plane(c, xd, zd))
            return arc if sense > 0 else arc.reversed()
        c = self._copy_curve()
        try:
            with kernel_call("extend", "the curve cannot be extended that far with this continuity; extend it less, "
                                       "or with continuity='G1'"):
                return Edge._from_curve(ext.extend_curve(c, d, at_start, continuity))
        finally:
            ext.delete_curve(c)

    def intersections(self, other: Shape | Iterable[Shape], *, tolerance: float | None = None) -> list[Vector]:
        """Points where this edge meets ``other``: an edge, a wire, a face, a body (its faces) or
        a list of them, in order along this edge.

        Where the two run along each other, the points where that overlap starts and ends.
        Points closer than ``tolerance`` to the other shape count as on it (default: 1e-6, or
        1e-9 of the size of the two where that is larger); points closer than that to each other
        count once. No point is an empty list.
        """
        return [p for _, p in self._hits(other, tolerance, "intersections")]

    def intersection_params(self, other: Shape | Iterable[Shape], *, tolerance: float | None = None) -> list[float]:
        """Where this edge meets ``other`` (see :meth:`intersections`), as fractions of its length
        (as :meth:`point_at` and :meth:`split` take them), in order."""
        return [t for t, _ in self._hits(other, tolerance, "intersection_params")]

    def self_intersections(self, *, tolerance: float | None = None) -> list[Vector]:
        """Points where the edge crosses itself (a figure eight, a looping spline), in order along
        it; the closing point of a closed edge does not count."""
        tol = _hit_tolerance(self, None, tolerance)
        t0, t1 = self._range()
        with kernel_call("self_intersections"):
            sols = ext.self_intersections(self._curve(), t0, t1, tol)
        span = 1e-9 * max(1.0, abs(t1 - t0))
        hits = []
        for s in sols:
            u, v = s["t"]
            if self.is_closed and min(u, v) - t0 <= span and t1 - max(u, v) <= span:
                continue
            hits.append((self._fraction(u), Vector(s["point"])))
        return [p for _, p in _merged_hits(hits, tol, self.is_closed)]

    def _hits(self, other: Any, tolerance: float | None, what: str) -> list[tuple[float, Vector]]:
        """(fraction along this edge, point) where it meets other, in order, merged within the tolerance."""
        tol = _hit_tolerance(self, other, tolerance)
        t0, t1 = self._range()
        params: list[float] = []
        if isinstance(other, Edge):
            if other._identity() == self._identity():
                raise ValueError(f"{what}: an edge lies on itself everywhere; use self_intersections() for the points "
                                 f"where it crosses itself")
            b0, b1 = other._range()
            with kernel_call(what):
                sols = ext.intersect_curves(self._curve(), t0, t1, other._curve(), b0, b1, tol)
            for s in sols:
                params.append(s["t"][0])
                if s["end"] is not None:
                    params.append(s["end"][0])
        elif isinstance(other, (Wire, list, tuple)):
            items = other.edges() if isinstance(other, Wire) else other
            hits = [h for item in items for h in self._hits(item, tol, what)]
            return _merged_hits(sorted(hits, key=lambda h: h[0]), tol, self.is_closed)
        elif isinstance(other, (Face, _Body)):
            faces = list(other.faces())
            with kernel_call(what):
                sols = ext.intersect_curve_faces(self._curve(), t0, t1, [f._f for f in faces], tol)
            params = [s["t"] for s in sols]
        else:
            raise TypeError(f"{what}: expected an Edge, Wire, Face or body (or a list of them), got "
                            f"{type(other).__name__}")
        curve = self._curve()
        hits = sorted(((self._fraction(u), Vector(curve.evaluate(u))) for u in params), key=lambda h: h[0])
        return _merged_hits(hits, tol, self.is_closed)

    # -- curvature ------------------------------------------------------------
    def curvature_at(self, t: float = 0.5) -> float:
        """The curvature at fraction ``t`` of the length (as :meth:`point_at`): one over the radius
        of the circle that fits the edge best there; 0 where it runs straight."""
        g = ext.curve_geometry(self._curve(), self._param(t))
        return float(np.linalg.norm(g["curvature"]))

    def radius_at(self, t: float = 0.5) -> float:
        """The radius of curvature at fraction ``t`` of the length (``math.inf`` where the edge runs
        straight): the radius of the circle that fits the edge best there."""
        c = self.curvature_at(t)
        return 1.0 / c if c > 0 else math.inf

    def min_radius(self) -> float:
        """The smallest radius of curvature of the edge (as :meth:`Face.min_radius` is the face's):
        ``inf`` for a line, an arc's radius. A sweep profile that reaches farther from the path than
        this folds over itself. Where it is: :meth:`min_radius_at`. ::

            r = path.min_radius()
            print(f"tightest bend: radius {r:.3g} at {path.point_at(path.min_radius_at())}")
        """
        return self._min_radius()[0]

    def min_radius_at(self) -> float:
        """Where the edge bends most tightly (:meth:`min_radius`): a fraction of its length, as
        :meth:`point_at` takes it (0 for a line or an arc)."""
        return self._min_radius()[1]

    def _min_radius(self) -> tuple[float, float]:
        """(radius, t) of :meth:`min_radius` and :meth:`min_radius_at`."""
        kind = self.geom_type
        if kind == "line" or self._is_straight():
            return math.inf, 0.0
        if kind == "circle":
            return self.radius, 0.0
        t0, t1 = self._range()
        curve = self._curve()
        with kernel_call("min_radius"):
            sols = ext.curve_properties(curve, t0, t1, "min_radius", 0.0, 1e-9 * max(1.0, self.length))
        candidates = [t0, t1] + [u for s in sols for u in (s["t"], s["end"]) if u is not None]
        best_k, best_u = -1.0, t0
        for u in candidates:
            k_u = float(np.linalg.norm(ext.curve_geometry(curve, min(max(u, t0), t1))["curvature"]))
            if k_u > best_k:
                best_k, best_u = k_u, u
        return (1.0 / best_k if best_k > 0 else math.inf), self._fraction(best_u)

    def inflections(self) -> list[float]:
        """Where the edge changes the side it bends to (an S-curve has one), as fractions of its
        length (as :meth:`point_at`), in order: points where its curvature passes through zero.
        Lines, arcs and curves that bend one way only have none; a straight stretch between two
        bends counts once, at its middle, where the bends go opposite ways."""
        kind = self.geom_type
        if kind in ("line", "circle", "ellipse"):
            return []
        t0, t1 = self._range()
        curve = self._curve()
        with kernel_call("inflections"):
            sols = ext.curve_properties(curve, t0, t1, "inflections", 0.0, 1e-9 * max(1.0, self.length))
        span = t1 - t0
        out: list[float] = []
        for s in sols:
            a = s["t"]
            b = s["end"] if s["end"] is not None else a
            a, b = min(a, b), max(a, b)
            before = _binormal(curve, a, -1, t0, t1, span)
            after = _binormal(curve, b, 1, t0, t1, span)
            if before is None or after is None or float(np.dot(before, after)) >= 0:
                continue
            f = self._fraction(0.5 * (a + b))
            if 0.0 < f < 1.0 and not any(abs(f - g) <= 1e-9 for g in out):
                out.append(f)
        return sorted(out)

    # -- offsets, lines and arcs ----------------------------------------------
    def offset(self, distance: float, *, plane: Plane | None = None) -> Edge:
        """The edge moved ``distance`` sideways in its plane: an open edge to its left for a
        positive distance (seen from the side the plane's normal points to), to its right for a
        negative one; a closed edge (a circle, a closed spline) outward for a positive distance.

        Lines stay lines and arcs stay arcs, exactly. Splines and ellipses are offset by the
        kernel within 1e-6 of their size. Where the edge bends toward that side more tightly than
        the distance (a radius of curvature below it, see :meth:`min_radius`), the offset would
        fold over itself and :class:`ModelingError` says where. A closed edge with a corner where
        it starts and ends (``Spline(*pts, pts[0])``) comes back as one closed edge: rounded at the
        corner where the offset pulls it apart, cut where its sides cross where it pushes them
        together (:meth:`Wire.offset` gives sharp and chamfered corners).

        ``plane``: the plane the edge lies in, whose normal tells left from right. Default: the
        XY plane for an edge at one height, else the plane the edge lies in, its normal toward
        +Z (+Y, then +X, for vertical planes). ::

            rail = Spline((0, 0), (20, 8), (40, 0)).offset(3)     # 3 to the left (+Y side)
        """
        from ._regions import offset_wire

        if _offset_distance(distance, "offset") == 0:
            return self
        out = offset_wire([self], float(distance), "round", plane, "offset")
        # (a closed edge with a corner where it starts and ends: the arc that rounds it, and the edge,
        # joined tangentially into one; the arc alone came back before 0.5.0)
        return out[0] if len(out) == 1 else Wire._raw(out).to_edge()

    def to_arcs(self, tolerance: float = 0.01) -> Wire:
        """The edge as lines and circular arcs within ``tolerance`` of it, end to end along it:
        for CNC, laser and plasma cutters and DXF readers that take only LINE and ARC
        (``export_dxf(..., curves="arcs")``). Lines and arcs come back as they are; splines and
        ellipses become chains of arcs that join tangentially (lines where they run straight).
        Both ways, every point of one lies within ``tolerance`` of the other. ::

            cut = Spline((0, 0), (10, 5), (20, -3), (30, 4)).to_arcs(0.01)   # 26 arcs
        """
        from .curves import Line, ThreePointArc

        if not (isinstance(tolerance, (int, float)) and math.isfinite(tolerance) and tolerance > 0):
            raise ValueError(f"to_arcs: the tolerance must be positive, got {tolerance!r}")
        kind = self.geom_type
        if kind in ("line", "circle"):
            return Wire._raw([self])
        if self._is_straight():
            return Wire._raw([Line(self.start, self.end)])
        c = self._copy_curve()
        try:
            with kernel_call("to_arcs"):
                r = ext.lines_and_arcs(c, float(tolerance))
        finally:
            ext.delete_curve(c)
        dev = float(r["deviation"])
        if not r["pieces"] or dev > tolerance:
            raise ModelingError(f"to_arcs: the lines and arcs come no closer than {dev:.3g} to the {kind}, more than "
                                f"the tolerance {tolerance:g}; use a larger tolerance")
        edges = [Line(p["start"], p["end"]) if p["kind"] == "line" else ThreePointArc(p["start"], p["mid"], p["end"])
                 for p in r["pieces"]]
        return Wire._raw(edges)

    # -- editing --------------------------------------------------------------
    def _plain_bspline(self) -> Any:
        """A new kernel B-spline of this edge (lines and arcs as the B-splines they are)."""
        n = self.nurbs()
        return _canonical_curve(np.array([p.to_tuple() for p in n.points]), n.knots, n.degree, n.weights)

    def through(self, point: VectorLike | Vertex, *, tangent: VectorLike | None = None,
                at: float | None = None) -> Edge:
        """This edge bent to pass through ``point`` (and there in the direction ``tangent``, if
        given): the smallest move of its control points that does it, with the ends of the edge and
        its directions at the ends kept. For "make this curve pass here" edits of splines, sweep
        paths and outlines; lines and arcs become cubic B-splines.

        Args:
            point: The point the edge passes through.
            tangent: The direction of the edge at that point (its length does not count; it is the
                direction the edge runs in).
            at: Where along the edge the point goes, as a fraction of its length (strictly between 0
                and 1). Default: where the edge comes closest to the point.

        The change is local: it moves the few control points near ``at`` (knots are inserted there
        when the edge has too few), so a point far from the edge makes a bump, not a new curve. ::

            path = Spline((0, 0), (20, 10), (40, 0)).through((20, 15))
        """
        from .curves import _basis_ders, _span

        p = _vec(point.point if isinstance(point, Vertex) else point)
        if not all(math.isfinite(c) for c in p):
            raise ValueError("through: the point must be finite")
        t = None
        if tangent is not None:
            t = _vec(tangent)
            if not t.length > 0 or not all(math.isfinite(c) for c in t):
                raise ValueError("through: the tangent must be a direction (not zero)")
            t = t.normalized()
        if at is not None and not (isinstance(at, (int, float, np.integer, np.floating)) and not isinstance(at, bool)
                                   and 0.0 < float(at) < 1.0):
            raise ValueError(f"through: at is a fraction of the edge strictly between 0 and 1 (its ends stay), "
                             f"got {at!r}")
        need = 1 if t is None else 2
        with kernel_call("Edge.through"):
            base = Edge._from_curve(self._plain_bspline())
            u = base._param(float(at)) if at is not None else base._closest(p)[1]
            t0, t1 = base._range()
            if not t0 < u < t1:
                raise ValueError("through: the point is nearest to an end of the edge, and the ends stay; pass at= to "
                                 "say where along the edge it goes")
            d = ext.curve_data(base._curve(), True)
            q = max(3, int(d["degree"]))
            # the knots after raising the degree (every knot once more per degree)
            knots = [float(x) for x in d["knots"]]
            raised: list[float] = []
            i = 0
            while i < len(knots):
                j = i
                while j < len(knots) and knots[j] == knots[i]:
                    j += 1
                raised += [knots[i]] * (j - i + q - int(d["degree"]))
                i = j
            # knots in the spans around u until enough control points that are free to move (not
            # the first two or the last two) act there
            inserts: list[float] = []
            for _ in range(12):
                kv = sorted(raised + inserts)
                m = len(kv) - q - 1
                s = _span(kv, q, u)
                free = [i for i in range(s - q, s + 1) if 2 <= i <= m - 3]
                if len(free) >= need + 1:
                    break
                lo, hi = max(q, s - q), min(m, s + q + 1)  # the spans s - q .. s + q
                spans = sorted({x for x in kv[lo:hi + 1]})
                inserts += [(a + b) / 2 for a, b in zip(spans, spans[1:]) if b > a]
            else:
                raise ModelingError("through: the edge cannot be refined enough to move")
            c = ext.refine_curve(base._curve(), q, inserts)
            try:
                d = ext.curve_data(c, True)
            finally:
                ext.delete_curve(c)
        kv = [float(x) for x in d["knots"]]
        P = np.array(d["poles"], dtype=float)
        w = None if d["weights"] is None else np.array(d["weights"], dtype=float)
        m = len(P)
        s = _span(kv, q, u)
        ders = _basis_ders(kv, q, s, u, 1)
        idx = list(range(s - q, s + 1))
        N, dN = np.array(ders[0]), np.array(ders[1])
        if w is not None:  # rational: R = N w / W, linear in the control points for fixed weights
            ww = w[idx]
            W, dW = float(N @ ww), float(dN @ ww)
            R = N * ww / W
            dR = (dN * ww * W - N * ww * dW) / (W * W)
        else:
            R, dR = N, dN
        here = R @ P[idx]
        rows, rhs = [R], [np.array(p.to_tuple()) - here]
        if t is not None:
            slope = dR @ P[idx]
            rows.append(dR)
            rhs.append(np.array(t.to_tuple()) * float(np.linalg.norm(slope)) - slope)
        free = [j for j, i in enumerate(idx) if 2 <= i <= m - 3]
        A = np.array(rows)[:, free]
        B = np.array(rhs)
        G = A @ A.T
        if abs(np.linalg.det(G)) <= 1e-14 * max(1.0, float(np.abs(G).max())) ** len(rows):
            raise ModelingError("through: the edge cannot be bent there (its control points do not reach the point)")
        move = A.T @ np.linalg.solve(G, B)  # the smallest move (least squares, minimum norm)
        for j, k_ in enumerate(free):
            P[idx[k_]] += move[j]
        with kernel_call("Edge.through"):
            return Edge._from_curve(_canonical_curve(P, kv, q, None if w is None else list(w)))

    def match(self, *, start: VectorLike | Vertex | None = None, end: VectorLike | Vertex | None = None,
              start_tangent: VectorLike | None = None, end_tangent: VectorLike | None = None) -> Edge:
        """This edge with its ends moved to ``start`` and ``end`` and its directions there set to
        ``start_tangent`` and ``end_tangent`` (each optional: what is not given stays), bent smoothly
        in between: the parts near the ends move as a whole, the middle blends. For closing gaps,
        snapping a curve onto a point or another curve, and making it leave or arrive tangentially.
        Lines and arcs become B-splines (cubic at least).

        The kernel's own end deformation (``SmCurve::DeformToEndPointTargets``); the ends land on
        their targets exactly. ::

            snapped = spline.match(end=other.start, end_tangent=other.tangent_at(0))   # G1 joint
        """
        def point(v: Any, what: str) -> list[float]:
            if v is None:
                return []
            q = _vec(v.point if isinstance(v, Vertex) else v)
            if not all(math.isfinite(c) for c in q):
                raise ValueError(f"match: {what} must be finite")
            return list(q)

        def direction(v: Any, what: str) -> list[float]:
            if v is None:
                return []
            q = _vec(v)
            if not q.length > 0 or not all(math.isfinite(c) for c in q):
                raise ValueError(f"match: {what} must be a direction (not zero)")
            return list(q)

        targets = (point(start, "start"), point(end, "end"), direction(start_tangent, "start_tangent"),
                   direction(end_tangent, "end_tangent"))
        if not any(targets):
            raise ValueError("match: give start, end, start_tangent or end_tangent")
        with kernel_call("Edge.match"):
            base = self._plain_bspline()
            try:
                c, dev = ext.deform_ends(base, *targets)
            finally:
                ext.delete_curve(base)
        e = Edge._from_curve(c)
        size = max(1.0, self.bbox().diagonal, *(abs(x) for x in targets[0] + targets[1]))
        if dev > 1e-9 * size:
            raise ModelingError(f"match: the ends came no closer than {dev:.3g} to their targets")
        return e

    def continuity(self, samples: int = 16, *, angle_tol: float = 0.5, curvature_tol: float = 0.01) -> Continuity:
        """How the two faces of the edge meet, checked at ``samples`` points along it
        (:class:`Continuity`): ``"G2"`` where their curvatures across the edge agree as well,
        ``"G1"`` where they meet tangentially (a circular fillet's border), ``"G0"`` at a crease,
        ``None`` where they leave a gap wider than the edge's tolerance.

        ``angle_tol`` is the largest angle (degrees) between the faces' normals for G1;
        ``curvature_tol`` the largest difference of their curvatures across the edge for G2,
        relative to the larger of them (and at least ``1e-3 / length``, so that nearly flat
        faces count as G2). ``ValueError`` for an edge that does not lie between two faces."""
        if self._e is None:
            raise ValueError("continuity: the edge does not lie between two faces (it is a free curve)")
        if not int(samples) >= 1:
            raise ValueError("continuity: samples must be at least 1")
        with kernel_call("continuity"):
            r = ext.edge_continuity(self._e, int(samples))
        gap_tol = max(float(r["tolerance"]), 1e-7)
        level = _continuity_level(r["gap"], gap_tol, r["angle"], angle_tol, r["jump"], r["curvature"], curvature_tol,
                                  r["length"])
        at = r["gap_at"] if level is None else r["angle_at"] if level == "G0" else r["jump_at"]
        return Continuity(level, float(r["gap"]), float(r["angle"]), float(r["jump"]), Vector(tuple(at)))

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

    def tangent_chain(self) -> ShapeList[Edge]:
        """This edge and the edges that continue it tangentially, through vertices where the next
        edge runs on in the same direction (within 10 degrees) between faces that meet this
        edge's faces smoothly, and so on along the run: all top edges of a plate with rounded
        corners, the outline of a slot. This edge comes first. ``fillet`` and ``chamfer`` round
        the whole run of each selected edge (their ``propagate``). An edge of no part is its own
        chain."""
        return ShapeList(_tangent_chains([self])[0])

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

    @classmethod
    def from_nurbs(cls, nurbs: Nurbs | tuple[int, Sequence[float], Sequence[VectorLike], Sequence[float] | None]
                   ) -> Edge:
        """The edge of a NURBS curve given by its data: the inverse of :meth:`nurbs`, for control
        points read from a file or another program, curves edited by moving control points and
        B-splines of many spans (a :func:`~smlibpy.Bezier` is one span).

        Args:
            nurbs: A :class:`~smlibpy.Nurbs`, or a tuple ``(degree, knots, points, weights)``:
                the degree (1 to 32), the knot vector with every knot as often as its multiplicity
                (``len(points) + degree + 1`` knots, not decreasing; the ends need not repeat), the
                control points (2D points lie at z = 0) and a positive weight per point, or
                ``None`` for a non-rational curve.

        The curve runs from ``knots[degree]`` to ``knots[-degree - 1]``; where the ends do not
        repeat ``degree + 1`` times, it starts and ends inside the control polygon. ::

            n = edge.nurbs()
            points = list(n.points)
            points[2] += Vector(0, 0, 5)  # pull one control point up
            bent = Edge.from_nurbs(n._replace(points=points))
        """
        degree, knots, points, weights = _nurbs_data(nurbs)
        with kernel_call("Edge.from_nurbs"):
            return cls._from_curve(_canonical_curve(points, knots, degree, weights))

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


def _hit_tolerance(shape: Edge | Wire, other: Any, tolerance: float | None) -> float:
    """The distance within which an edge or wire meets another shape: as given, else 1e-6, or
    1e-9 of the size of the two where that is larger."""
    if tolerance is not None:
        if not (isinstance(tolerance, (int, float)) and math.isfinite(tolerance) and tolerance > 0):
            raise ValueError(f"the tolerance must be positive, got {tolerance!r}")
        return float(tolerance)
    box = shape.bbox()
    for item in (other if isinstance(other, (list, tuple)) else [other]):
        if isinstance(item, Shape):
            box = box.union(item.bbox())
    return max(TOLERANCE, 1e-9 * box.diagonal)


def _merged_hits(hits: list[tuple[float, Vector]], tol: float, closed: bool) -> list[tuple[float, Vector]]:
    """Hits sorted along an edge or wire, those within ``tol`` of the one before dropped (on a
    closed one also the last where it is the first, the closing point)."""
    out: list[tuple[float, Vector]] = []
    for t, p in hits:
        if out and p.distance_to(out[-1][1]) <= tol:
            continue
        out.append((t, p))
    if closed and len(out) > 1 and out[-1][1].distance_to(out[0][1]) <= tol:
        out.pop()
    return out


def _binormal(curve: Any, u: float, side: int, t0: float, t1: float, span: float) -> np.ndarray | None:
    """C' x C'' a little before (side -1) or after (+1) parameter u, stepping farther while the
    curve runs straight there; None where that leaves [t0, t1]."""
    step = 1e-6 * span
    while step <= 0.25 * span:
        w = u + side * step
        if not t0 < w < t1:
            return None
        d = ext.curve_eval(curve, w, 2)
        b = np.cross(np.asarray(d[1], dtype=float), np.asarray(d[2], dtype=float))
        if float(np.linalg.norm(b)) * span > 1e-9 * float(np.dot(d[1], d[1])):  # (curvature x length > 1e-9)
            return b
        step *= 8.0
    return None


def _offset_distance(distance: Any, what: str) -> float:
    if not (isinstance(distance, (int, float, np.integer, np.floating)) and not isinstance(distance, bool)
            and math.isfinite(distance)):
        raise ValueError(f"{what}: the distance must be a finite number, got {distance!r}")
    return float(distance)


def _ellipse_angle_for_length(r1: float, r2: float, start: float, length: float, sense: float) -> float:
    """The angle (radians, >= 0) to turn from ``start`` (radians, in the sense +-1) along the
    ellipse x = r1 cos t, y = r2 sin t to cover ``length``."""

    def speed(t: float) -> float:
        return math.hypot(r1 * math.sin(t), r2 * math.cos(t))

    def arc(phi: float) -> float:  # length from start over phi (composite Simpson, 2048 panels per turn)
        n = max(64, 2 * int(math.ceil(512 * phi / math.pi)))
        h = phi / n
        s = speed(start) + speed(start + sense * phi)
        for i in range(1, n):
            s += (4 if i % 2 else 2) * speed(start + sense * i * h)
        return s * h / 3

    phi = length / max(min(r1, r2), 1e-300)
    phi = min(phi, 2 * math.pi)
    for _ in range(50):
        step = (arc(phi) - length) / speed(start + sense * phi)
        phi -= step
        if phi < 0:
            phi = 0.5 * (phi + step)
        if abs(step) <= 1e-15 * max(1.0, phi):
            break
    return phi


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


@contextlib.contextmanager
def _freed(curves: list[Any]) -> Iterator[list[Any]]:
    """Standalone kernel curves (copies made for a kernel call), deleted when the block ends. The
    kernel's sweeps, revolves and skins copy the curves they are given and leave them to the caller,
    and a kernel ``Curve`` is not freed with its Python object: a few KB a call, which add up in long
    sessions (1500 revolves kept 2 MB)."""
    try:
        yield curves
    finally:
        for c in curves:
            ext.delete_curve(c)


def _nurbs_data(nurbs: Any) -> tuple[int, list[float], np.ndarray, list[float] | None]:
    """The checked degree, knots, control points (an n x 3 array) and weights of NURBS data
    (Edge.from_nurbs): clear errors where the kernel would only say SM_ERR, or would take a knot
    vector of the wrong length."""
    what = "Edge.from_nurbs"
    try:
        degree, knots, points, weights = nurbs
    except (TypeError, ValueError):
        raise TypeError(f"{what} takes a Nurbs or a tuple (degree, knots, points, weights), "
                        f"not {type(nurbs).__name__}") from None
    if isinstance(degree, bool) or not isinstance(degree, (int, np.integer)) or not 1 <= degree <= 32:
        raise ValueError(f"{what}: the degree is a whole number from 1 to 32, got {degree!r}")
    degree = int(degree)
    pts = [_vec(p) for p in points]
    if len(pts) < degree + 1:
        raise ValueError(f"{what}: a curve of degree {degree} needs at least {degree + 1} control points, "
                         f"got {len(pts)}")
    if not all(math.isfinite(c) for p in pts for c in p):
        raise ValueError(f"{what}: the control points must be finite numbers")
    kv = [float(x) for x in knots]
    if len(kv) != len(pts) + degree + 1:
        raise ValueError(f"{what}: {len(pts)} control points of degree {degree} take {len(pts) + degree + 1} knots "
                         f"(points + degree + 1, every knot as often as its multiplicity), got {len(kv)}")
    if not all(math.isfinite(x) for x in kv):
        raise ValueError(f"{what}: the knots must be finite numbers")
    for i in range(1, len(kv)):
        if kv[i] < kv[i - 1]:
            raise ValueError(f"{what}: the knots must not decrease, but knot {i + 1} ({kv[i]:g}) is less than knot "
                             f"{i} ({kv[i - 1]:g})")
    lo, hi = kv[degree], kv[-degree - 1]
    if not hi > lo:
        raise ValueError(f"{what}: the curve's knot range, knots[{degree}] to knots[{len(kv) - degree - 1}], is empty "
                         f"({lo:g} to {hi:g})")
    i = 0
    while i < len(kv):
        j = i
        while j < len(kv) and kv[j] == kv[i]:
            j += 1
        if (lo < kv[i] < hi and j - i > degree) or j - i > degree + 1:
            raise ValueError(f"{what}: the knot {kv[i]:g} is repeated {j - i} times; at most {degree} times inside "
                             f"the curve (more would break it) and {degree + 1} times at its ends")
        i = j
    w = None
    if weights is not None:
        w = [float(x) for x in weights]
        if len(w) != len(pts):
            raise ValueError(f"{what}: one weight per control point ({len(pts)}), got {len(w)}")
        if not all(math.isfinite(x) and x > 0 for x in w):
            raise ValueError(f"{what}: the weights must be positive numbers")
    return degree, kv, np.array([p.to_tuple() for p in pts], dtype=float), w


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

    def distance_to(self, point: VectorLike | _Body) -> float:
        """Distance to a point, or to a body (see :meth:`Part.distance_to`)."""
        if isinstance(point, _Body):
            return point.distance_to(self)
        return min(e.distance_to(point) for e in self._edges)

    def _locate(self, at: float | VectorLike | Vertex, what: str) -> tuple[int, float]:
        """The edge (index) and the fraction along it of ``at``: a fraction of the wire's length
        or a point on the wire."""
        if isinstance(at, (int, float, np.integer, np.floating)) and not isinstance(at, bool):
            t = float(at)
            if not 0.0 <= t <= 1.0:
                raise ValueError(f"{what}: a fraction of the wire runs from 0 to 1, got {t:g}")
            lengths = [e.length for e in self._edges]
            s = t * sum(lengths)
            for i, L in enumerate(lengths):
                if s <= L or i == len(lengths) - 1:
                    return i, min(max(s / L if L else 0.0, 0.0), 1.0)
                s -= L
        p = at.point if isinstance(at, Vertex) else _vec(at)
        best = min(range(len(self._edges)), key=lambda i: self._edges[i].distance_to(p))
        e = self._edges[best]
        d = e.distance_to(p)
        if d > 1e-6 * max(1.0, self.length):
            raise ValueError(f"{what}: the point {_fmt_point(p)} lies {d:.6g} off the wire; pass a point on the wire or "
                             f"a fraction from 0 to 1")
        return best, e.param_at_point(p)

    def split(self, at: float | VectorLike | Vertex) -> tuple[Wire, Wire]:
        """The wire cut in two at ``at``, a fraction of its length or a point on it: the part
        before and the part after. At a vertex the edges stay as they are; elsewhere the edge
        there is split (:meth:`Edge.split`)."""
        i, f = self._locate(at, "split")
        edges = list(self._edges)
        eps = 1e-9 * max(1.0, edges[i].length)
        if f * edges[i].length <= eps:
            first, second = edges[:i], edges[i:]
        elif (1.0 - f) * edges[i].length <= eps:
            first, second = edges[:i + 1], edges[i + 1:]
        else:
            a, b = edges[i].split(f)
            first, second = [*edges[:i], a], [b, *edges[i + 1:]]
        if not first or not second:
            raise ValueError("split: the point is an end of the wire; there is nothing to split")
        return Wire._raw(first), Wire._raw(second)

    def trim(self, start: float | VectorLike | Vertex, end: float | VectorLike | Vertex) -> Wire:
        """The part of the wire from ``start`` to ``end``, each a fraction of its length or a
        point on it; ``start`` must come before ``end`` along the wire."""
        (i, f), (j, g) = self._locate(start, "trim"), self._locate(end, "trim")
        edges = self._edges
        if (j, g) <= (i, f) or (i == j and (g - f) * edges[i].length <= 1e-9 * max(1.0, edges[i].length)):
            raise ValueError("trim: the start must come before the end along the wire (fractions from 0 at its start "
                             "to 1 at its end)")
        if i == j:
            return Wire._raw([edges[i].trim(f, g)])
        out: list[Edge] = []
        if (1.0 - f) * edges[i].length > 1e-9 * max(1.0, edges[i].length):
            out.append(edges[i] if f <= 0.0 else edges[i].trim(f, 1.0))
        out.extend(edges[i + 1:j])
        if g * edges[j].length > 1e-9 * max(1.0, edges[j].length):
            out.append(edges[j] if g >= 1.0 else edges[j].trim(0.0, g))
        if not out:
            raise ValueError("trim: the start and the end are the same point of the wire; there is nothing between")
        return Wire._raw(out)

    def intersections(self, other: Shape | Iterable[Shape], *, tolerance: float | None = None) -> list[Vector]:
        """Points where this wire meets ``other`` (see :meth:`Edge.intersections`), in order along
        the wire; a point where two of its edges meet counts once."""
        tol = _hit_tolerance(self, other, tolerance)
        hits: list[tuple[float, Vector]] = []
        lengths = [e.length for e in self._edges]
        total = sum(lengths) or 1.0
        before = 0.0
        for e, L in zip(self._edges, lengths):
            for t, p in e._hits(other, tol, "intersections"):
                hits.append(((before + t * L) / total, p))
            before += L
        return [p for _, p in _merged_hits(sorted(hits, key=lambda h: h[0]), tol, self.is_closed)]

    def to_edge(self) -> Edge:
        """The wire as one edge: its curves joined into one B-spline curve (a wire of one edge gives
        that edge). The edges must meet end to end (within 1e-6); where they meet at a corner,
        the edge has a corner there too.

        One edge makes a single sweep or loft rail, a single SPLINE in DXF and a single curve for
        :func:`~smlibpy.make_compatible`. ::

            rail = FilletPolyline((0, 0), (30, 0), (30, 20), radius=5).to_edge()
        """
        edges = self._edges
        if len(edges) == 1:
            return edges[0]
        for a, b in zip(edges, edges[1:]):
            gap = a.end.distance_to(b.start)
            if gap > 1e-6:
                raise ValueError(f"to_edge: the edges do not meet: a gap of {gap:.6g} at {_fmt_point(a.end)}; join only "
                                 f"edges that run end to end (Wire sorts them)")
        curves = self._copy_curves()
        try:
            with kernel_call("to_edge"):
                return Edge._from_curve(ext.join_curves(curves))
        finally:
            for c in curves:
                ext.delete_curve(c)

    def offset(self, distance: float, *, corners: str = "round", plane: Plane | None = None) -> Wire:
        """The wire moved ``distance`` sideways in its plane, as a parallel curve: an open wire to
        its left for a positive distance (seen from the side the plane's normal points to), to
        its right for a negative one; a closed wire outward for a positive distance, inward for
        a negative one (as :meth:`Sketch.offset` grows and shrinks).

        Lines stay lines and arcs stay arcs, exactly; splines and ellipses are offset within
        1e-6 of the wire's size (:meth:`Edge.offset`). ``corners`` shapes the corners the offset
        pulls apart: ``"round"`` (arcs of radius ``|distance|``), ``"sharp"`` (the sides
        extended until they meet) or ``"chamfer"`` (a straight cut across); at the corners it
        pushes together, the sides are cut where they cross. Where the offset would fold over or
        run into itself (an edge bends more tightly than the distance, an edge vanishes, parts
        of the wire lie closer than the distance), :class:`ModelingError` says where; a region's
        offset that merges and drops parts is :meth:`Sketch.offset`.

        ``plane``: the plane the wire lies in, whose normal tells left from right (see
        :meth:`Edge.offset` for the default). ::

            path = Polyline((0, 0), (40, 0), (40, 30))
            wall = path.offset(2, corners="sharp")        # 2 to the left, a sharp outer corner
            toolpath = outline.offset(-3)                  # 3 inside a closed outline
        """
        from ._regions import CORNER_STYLES, offset_wire

        if corners not in CORNER_STYLES:
            raise ValueError(f"offset: corners is 'round', 'sharp' or 'chamfer', not {corners!r}")
        if _offset_distance(distance, "offset") == 0:
            return self
        return Wire._raw(offset_wire(list(self._edges), float(distance), corners, plane, "offset"))

    def to_arcs(self, tolerance: float = 0.01) -> Wire:
        """The wire as lines and circular arcs within ``tolerance`` (see :meth:`Edge.to_arcs`)."""
        return Wire._raw([p for e in self._edges for p in e.to_arcs(tolerance).edges()])

    def min_radius(self) -> float:
        """The smallest radius of curvature of the wire's edges. The corners where edges meet do
        not count (a corner has no radius; see :meth:`fillet`). Where it is: :meth:`min_radius_at`."""
        return self._min_radius()[0]

    def min_radius_at(self) -> float:
        """Where the wire bends most tightly (:meth:`min_radius`): a fraction of its length, as
        :meth:`point_at` takes it."""
        return self._min_radius()[1]

    def _min_radius(self) -> tuple[float, float]:
        lengths = [e.length for e in self._edges]
        total = sum(lengths) or 1.0
        best, at, before = math.inf, 0.0, 0.0
        for e, L in zip(self._edges, lengths):
            r, t = e._min_radius()
            if r < best:
                best, at = r, (before + t * L) / total
            before += L
        return best, at

    def closest_point(self, point: VectorLike) -> Vector:
        """The point of the wire nearest to ``point``."""
        p = _vec(point)
        return min((e.closest_point(p) for e in self._edges), key=lambda q: (q - p).length)

    def continuity(self, *, angle_tol: float = 0.5, curvature_tol: float = 0.01) -> Continuity:
        """How the edges of the wire meet at its joints (and where a closed wire closes)
        (:class:`Continuity`): ``"G2"`` where their curvature vectors agree as well, ``"G1"``
        where they meet tangentially (within ``angle_tol`` degrees), ``"G0"`` at a corner,
        ``None`` where an edge does not start where the one before ends (within 1e-6).
        ``curvature_tol`` is relative to the larger curvature (and at least ``1e-3 / length``).
        ``ValueError`` for a wire of one open edge, which has no joint."""
        edges = list(self._edges)
        pairs = list(zip(edges, edges[1:]))
        if self.is_closed:
            pairs.append((edges[-1], edges[0]))
        if not pairs:
            raise ValueError("continuity: the wire has no joints (one open edge)")
        worst: dict[str, tuple[float, Vector]] = {}
        jumps, curvatures = [], []
        for a, b in pairs:
            p, q = a.end, b.start
            ta, tb = a.tangent_at(1.0), b.tangent_at(0.0)
            ka, kb = _curvature_vector(a, 1.0), _curvature_vector(b, 0.0)
            values = {"gap": (p - q).length, "angle": ta.angle_to(tb), "jump": (ka - kb).length}
            for key, value in values.items():
                if key not in worst or value > worst[key][0]:
                    worst[key] = (value, p)
            curvatures.append(max(ka.length, kb.length))
        gap, angle, jump = worst["gap"][0], worst["angle"][0], worst["jump"][0]
        level = _continuity_level(gap, max(1e-6, 1e-9 * self.length), angle, angle_tol, jump, max(curvatures),
                                  curvature_tol, self.length)
        at = worst["gap" if level is None else "angle" if level == "G0" else "jump"][1]
        return Continuity(level, gap, angle, jump, at)

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
        """Round corners with tangent arcs of ``radius``: every sharp corner, or those at
        ``vertices`` (points or vertices). A planar wire's corners are rounded in its plane, as
        :meth:`Sketch.fillet` does: between lines and arcs exactly, next to splines and ellipses
        with the arc whose center lies at ``radius`` from both curves (the curves are cut where
        it touches them). A wire that is not planar has its corners between lines rounded. A
        corner a wire that is not planar has next to another curve, a smooth corner that is named
        and a point that is not a corner raise :class:`ModelingError`; a radius that does not fit
        raises ``ValueError``. Open wires keep their ends."""
        from .curves import _fillet_wire

        return _fillet_wire(self, radius, vertices)

    def to_sketch(self) -> Sketch:
        """The planar region bounded by this closed wire."""
        return Sketch._from_wires([self])

    def __repr__(self) -> str:
        kind = "closed" if self.is_closed else "open"
        return f"Wire({len(self._edges)} edges, {kind}, length={self.length:.6g})"


def _curvature_vector(e: Edge, t: float) -> Vector:
    """The curvature vector of an edge at fraction ``t`` (towards the center of curvature, of
    length 1 / radius); the same in either direction along the edge."""
    _, d1, d2 = ext.curve_eval(e._curve(), e._param(t), 2)
    a, b = Vector(tuple(d1)), Vector(tuple(d2))
    s = a.length
    if not s > 0:
        return Vector()
    return a.cross(b).cross(a) / s ** 4


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

    @property
    def color(self) -> tuple[float, float, float] | None:
        """The face's own color as ``(r, g, b)`` from 0 to 1, or None: then it shows in its body's color.

        Faces get one with ``body.colored(color, faces=...)`` and from STEP files that color single
        faces. It stays with the face through later operations (kernel plan T5): with both pieces of a
        face a Boolean splits, with the walls of a hole cut by a tool whose faces have one, with a
        face moved, mirrored or scaled, with the offsets of a face in a shell; faces an operation
        makes anew (a fillet's round, the rim around a shell's opening) have none.
        """
        color, _ = ext.face_attr(self._f)
        return None if color is None else (float(color[0]), float(color[1]), float(color[2]))

    @property
    def name(self) -> str | None:
        """The face's name (``body.named(name, faces=...)``, or from the ``ADVANCED_FACE`` of a STEP
        file), or None. It stays with the face as :attr:`color` does."""
        _, name = ext.face_attr(self._f)
        return name

    @property
    def cells(self) -> tuple[int, ...]:
        """The cells of its part that this face bounds, as indices into :meth:`Part.cells`: one for a
        face on the outside or on the wall of a cavity, two for a face between two cells of a merged
        part (see :meth:`ShapeList.shared`), ``()`` for a face of a sheet or a sketch."""
        own = ext.face_indices(self._owner._brep, [self._f])[0]
        return _face_cells(self._owner)[own] if own >= 0 else ()

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
                m = ext.face_measure(self._f, ACCURACY * _MARGIN)
            if m.get("exhausted") and self._owner is not None:
                index = ext.face_indices(self._owner._brep, [self._f])[0]
                _unmeasurable(self._owner, int(index), "face area")
            self._m = m
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
        with kernel_call("interior point", "the kernel finds no point inside this face"):
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
    def major_radius(self) -> float:
        """Major radius of a torus: from its axis to the middle of its tube (:attr:`radius` is the
        tube's)."""
        info = self._surface_info()
        if "major_radius" not in info:
            raise ValueError(f"a {self.geom_type} face has no major radius (only a torus has)")
        return float(info["major_radius"])

    @property
    def cone_angle(self) -> float:
        """Half the opening angle of a cone, in degrees: the angle between its axis and its side."""
        if self.geom_type != "cone":
            raise ValueError(f"a {self.geom_type} face has no cone angle")
        return abs(float(self._surface_info()["semi_angle_deg"]))

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

    def distance_to(self, point: VectorLike | _Body) -> float:
        """Distance to a point, or to a body (see :meth:`Part.distance_to`)."""
        if isinstance(point, _Body):
            return point.distance_to(self)
        with kernel_call("distance"):
            return float(ext.nearest_point(None, list(_vec(point).to_tuple()), self._f)["distance"])

    def closest_point(self, point: VectorLike) -> Vector:
        """The point of the face nearest to ``point`` (within its boundary)."""
        with kernel_call("closest point"):
            return Vector(*ext.nearest_point(None, list(_vec(point).to_tuple()), self._f)["point"])

    def _domain(self) -> tuple[float, float, float, float]:
        (u0, v0), (u1, v1) = self._f.uv_domain()
        return float(u0), float(u1), float(v0), float(v1)

    def _uv(self, point: VectorLike) -> tuple[float, float]:
        """The surface parameters of the face's point nearest to ``point`` (of a seam's two, the
        one on the face)."""
        q = self.closest_point(point)
        _, uvs, _ = k.surface_closest_point(self._f.surface(), q.to_tuple())
        for uv in uvs:
            if self._f.classify_uv(uv.x, uv.y) != "outside":
                return float(uv.x), float(uv.y)
        return float(uvs[0].x), float(uvs[0].y)

    def uv_at(self, point: VectorLike) -> tuple[float, float]:
        """The parameters ``(u, v)`` of the face's point nearest to ``point``, as fractions (0 to
        1) of the face's parameter box: ``face.position_at(*face.uv_at(p))`` is
        ``face.closest_point(p)``."""
        u0, u1, v0, v1 = self._domain()
        u, v = self._uv(point)
        return ((u - u0) / (u1 - u0) if u1 > u0 else 0.0, (v - v0) / (v1 - v0) if v1 > v0 else 0.0)

    def position_at(self, u: float, v: float) -> Vector:
        """The point of the face's surface at ``(u, v)``, fractions (0 to 1) of the face's
        parameter box. A trimmed face (a plate with a hole, a face cut by another) does not cover
        its whole box: points there lie on the surface beyond the face's boundary."""
        u0, u1, v0, v1 = self._domain()
        return Vector(tuple(self._f.point_at_uv(u0 + (u1 - u0) * float(u), v0 + (v1 - v0) * float(v))))

    def curvature_at(self, point: VectorLike | None = None) -> Curvature:
        """The curvature of the face at its point nearest to ``point`` (default: a point inside
        the face): both principal curvatures, their directions and the outward normal
        (:class:`Curvature`). Curvatures are positive where the face bends away from its outward
        normal (a ball, a boss), negative where it bends towards it (a bore): a cylinder of radius
        5 has ``k1 = 0.2, k2 = 0``, its bore ``k1 = 0, k2 = -0.2``."""
        p = self.interior_point() if point is None else _vec(point)
        u, v = self._uv(p)
        with kernel_call("curvature_at"):
            r = ext.face_curvature(self._f, u, v)
        return Curvature(float(r["k1"]), float(r["k2"]), Vector(r["d1"]), Vector(r["d2"]), Vector(r["normal"]),
                         Vector(r["point"]))

    def min_radius(self) -> float:
        """The smallest radius of curvature on the face, ``1 / max(|k1|, |k2|)``: ``inf`` for a
        plane, the radius of a cylinder or sphere, the smaller of a torus' tube radius and its
        inner radius, at the narrow end of a cone. Free-form faces are sampled on a 24 x 24 grid of
        their parameters and refined from the sharpest points (singular points such as a pole are
        left out). Compare it with a wall thickness or a cutter radius."""
        kind = self.geom_type
        if kind == "plane":
            return math.inf
        if kind in ("cylinder", "sphere"):
            return self.radius
        with kernel_call("min_radius"):
            return float(ext.face_min_radius(self._f, 24)["radius"])

    def nurbs(self) -> NurbsSurface:
        """The face's surface as a NURBS (:class:`NurbsSurface`): degrees, knots, control points
        and weights. Exact for every kind (planes, cylinders, cones, spheres, tori as rational
        surfaces). It is the whole surface, untrimmed: the face may cover only part of it."""
        d = ext.surface_data(self._f.surface(), True)
        if d.get("poles") is None:
            raise ValueError(f"nurbs: the {self.geom_type} surface has no NURBS form")
        du, dv = int(d["u_degree"]), int(d["v_degree"])
        ku, kv = [float(x) for x in d["u_knots"]], [float(x) for x in d["v_knots"]]
        nu, nv = len(ku) - du - 1, len(kv) - dv - 1
        poles = [Vector(tuple(p)) for p in d["poles"]]
        if len(poles) != nu * nv:
            raise ValueError("nurbs: the surface's control net does not match its knots")
        points = [poles[i * nv:(i + 1) * nv] for i in range(nu)]
        w = d.get("weights")
        weights = None if w is None else [[float(x) for x in w[i * nv:(i + 1) * nv]] for i in range(nu)]
        return NurbsSurface((du, dv), (ku, kv), points, weights)

    def raycast(self, origin: VectorLike | Axis, direction: VectorLike | Axis | None = None) -> list[Hit]:
        """Where a ray meets this face, nearest first (see :meth:`Part.raycast`)."""
        return _raycast([self], origin, direction, self.bbox())

    # -- curves on the face ---------------------------------------------------
    def project(self, curve: Edge | Wire) -> ShapeList[Edge]:
        """The curve projected onto this face along its normals: every point to the nearest point
        of the face's surface, the result trimmed to the face (pieces where it leaves the face and
        comes back). Within 1e-7 of the size of the face and the curve. For curves drawn near a
        freeform face; along one direction, see :meth:`Part.project`. ::

            on_face = part.faces().sort_by(Z)[-1].project(Spline((0, 0, 30), (10, 5, 30), (20, 0, 30)))
        """
        from ._face_curves import across_seams, seam_crossings

        size = max(1.0, self.bbox().union(curve.bbox()).diagonal)
        out = ShapeList()
        for e in curve.edges():
            # (in pieces that do not cross a seam of the face: the kernel gave nothing for a curve that
            # crosses one; the pieces it cuts apart there joined again)
            cuts = seam_crossings(self, e)
            parts = [e] if not cuts else [e.trim(a, b) for a, b in zip([0.0] + cuts, cuts + [1.0])]
            got: list[Edge] = []
            for part in parts:
                c = part._copy_curve()
                try:
                    with kernel_call("Face.project"):
                        # (the kernel's tolerance bounds the drop; along the surface the curve comes
                        # within about five times it)
                        res = ext.normal_project([self._f], c, 1e-8 * size)
                finally:
                    ext.delete_curve(c)
                got.extend(Edge._from_curve(cv) for cv, _ in res)
            out.extend(across_seams(got, 1e-6 * size) if len(got) > 1 else got)
        return out

    def iso(self, *, u: float | None = None, v: float | None = None) -> ShapeList[Edge]:
        """The curve of the face along which one of its surface parameters is constant: ``u`` or
        ``v`` as a fraction (0 to 1) of the face's range of that parameter. Trimmed to the face:
        several pieces where the face has holes or notches. For styling lines, inspection curves
        and rails on freeform faces. Which parameter runs which way depends on the surface: on a
        cylinder's side ``v`` is constant around it (``iso(v=0.5)``: the circle half way up) and
        ``u`` along it. ::

            ring = Cylinder(10, 40).faces().cylinders()[0].iso(v=0.5)

        Exact: lines, arcs or B-splines of the surface itself, ending exactly where the face's
        edges cross them. Give one of ``u`` and ``v``, by name.
        """
        return self._iso_curves(u, v, "iso")

    def _iso_curves(self, u: float | None, v: float | None, what: str) -> ShapeList[Edge]:
        """:meth:`iso`: the face's curves of constant ``u`` or ``v``, a fraction of its parameter box,
        clipped to the face (``ext.face_iso_curves``)."""
        if (u is None) == (v is None):
            raise ValueError(f"{what}: give u or v (exactly one of u and v)")
        t = float(u if u is not None else v)  # type: ignore[arg-type]
        if not 0.0 <= t <= 1.0 or not math.isfinite(t):
            raise ValueError(f"{what}: {'u' if u is not None else 'v'} is a fraction of the face's range, from 0 to 1 "
                             f"(got {t:g})")
        u0, u1, v0, v1 = self._domain()
        value = u0 + (u1 - u0) * t if u is not None else v0 + (v1 - v0) * t
        with kernel_call(what):
            curves = ext.face_iso_curves(self._f, u is not None, value)
        return ShapeList(Edge._from_curve(c) for c in curves)

    def wrap(self, shape: Edge | Wire | Sketch | Iterable[Edge], at: VectorLike | Vertex | None = None, *,
             direction: VectorLike | None = None) -> ShapeList[Edge]:
        """A drawing on XY wrapped onto this face, as a label onto a can: its origin goes to
        ``at`` (a point of the face; default its middle), its X axis along the face in
        ``direction`` (default: the face's first parameter direction there; it follows the
        parameter line nearest to it), its Y axis across, so that it reads from outside. Lengths
        stay along the two parameter lines through ``at``: on planes and cylinders the whole
        drawing keeps its size (text around a cylinder); on cones and doubly curved faces it
        stretches away from those lines. Around a closed face (a cylinder) the drawing continues
        across the seam; what leaves the face is cut off (also in its holes). Returns the curves on
        the face, fitted within 1e-7 of its size; a curve across the seam comes back as one edge.

        Args:
            shape: An edge, a wire, a sketch or edges, drawn on XY (z is ignored).
            at: Where the drawing's origin goes: a point of the face's surface. Default: the middle
                of the face's parameter range.
            direction: Where its X axis points (projected onto the face).

        ::

            label = can.faces().cylinders()[0].wrap(Text("SMLIB", 8), (0, -20, 0), direction=(1, 0, 0))
        """
        from ._face_curves import wrap

        return wrap(self, shape, at, direction)

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

    def offset(self, distance: float) -> Shell:
        """A sheet of this face moved by ``distance`` along its normal (:meth:`normal_at`: out of the part
        it bounds; a negative distance moves it in): the offset surface, trimmed as the face is
        (see :meth:`Shell.offset`)."""
        return self.to_shell().offset(distance)

    def split(self, curves: Edge | Wire | Iterable[Edge | Wire]) -> ShapeList[Face]:
        """The pieces of this face cut along curves that lie on it, as the faces of a new sheet.

        Args:
            curves: Edges or wires on the face (see :meth:`Shell.trim`): each runs from border to
                border, or closes a loop.

        The face's own body does not change: to split the faces of a part where they are, use
        :meth:`Part.imprint`; of a sheet, :meth:`Shell.trim` with ``keep="split"``.
        """
        return self.to_shell().trim(curves, "split").faces()

    def flipped(self) -> Shell:
        """A copy of this face, turned over: a sheet of one face whose normal points the other way
        (see :meth:`Shell.flipped`)."""
        return self.to_shell().flipped()

    def untrimmed(self) -> Shell:
        """The whole surface this face lies on, as a sheet of one face: its holes and cut borders
        are gone.

        A cylindrical face cut out of a box comes back as the whole cylinder the cut left it on (its
        full height and all around), a B-spline face as its whole surface. A plane has no border of
        its own: it comes back as the smallest rectangle around the face, along the plane's own
        directions. The sheet's normal follows this face's (:meth:`normal_at`).
        """
        with kernel_call("untrimmed"):
            b = ext.untrim_face(self._f)
        return Shell._wrap(b)

    def extend(self, distance: float, *, sides: Edge | Iterable[Edge] | None = None,
               continuity: str = "natural") -> Shell:
        """The face's surface grown past its sides, as a sheet of one face: to make a sheet reach
        across a part before cutting or splitting it with it, or to give a blend room.

        Args:
            distance: How far past each side, measured along the surface (across the middle of the
                side).
            sides: Edges of this face: grow past the sides they lie on only. Default: past every side
                that can grow.
            continuity: How the surface goes on: ``"natural"`` (default) as it is (a plane stays the
                plane, a cylinder or sphere the same cylinder or sphere, a B-spline surface follows
                its own polynomials), ``"G1"`` straight on along its tangents, ``"G2"`` bending on
                with the curvature it has at the side. (:meth:`Edge.extend` defaults to ``"G1"``:
                lines and arcs go on as themselves there whatever it says, and a spline's own
                polynomial can turn away past its end; a face's natural extension keeps planes,
                cylinders, cones and spheres what they are.)

        The sides are those of the face's surface rectangle, along its parameter directions: the
        four edges of a box's face or of a sheet from :func:`~smlibpy.surface`, the two ends of a
        cylinder along its axis. Trims (holes, a border cut at a slant) are dropped: the result is
        the rectangle, grown. A side where the surface closes around (a full cylinder, around it) or
        shrinks to a point (a sphere's pole, a cone's tip) cannot grow: it is left out by default,
        and naming its edge raises ``ValueError``; so does an edge that does not run along a side.

        Returns:
            A sheet of one face, its normal following this face's (:meth:`normal_at`).
        """
        return Shell._wrap(_extended_face(self, distance, sides, continuity, "extend"))

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
# How a body was made where its operation had a choice, by the body's handle (the record goes with
# the body): {"corners": "round"} for the result of shell or offset. info() reports it.
_MADE: weakref.WeakKeyDictionary[BrepHandle, dict[str, Any]] = weakref.WeakKeyDictionary()


def _made(body: _Body, **record: Any) -> Any:
    """``body``, with ``record`` noted as how it was made (see ``_MADE``)."""
    _MADE[body._h] = dict(record)
    return body


class _Body(Shape):
    """A shape backed by one kernel Brep."""

    __slots__ = ("_h", "name", "color")

    def __init__(self) -> None:
        raise TypeError(f"create a {type(self).__name__} with the constructors (Box(), Rectangle(), ...)")

    @classmethod
    def _wrap(cls, brep: Any, *args: Any, **kwargs: Any):  # type: ignore[no-untyped-def]
        b = cls.__new__(cls)
        b._h = BrepHandle(brep)
        # Faces and edges an operation made anew get tags of their own; the kernel carries tags
        # along through later operations (ShapeList.new, ShapeList.derived_from).
        ext.tag_topology(brep)
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

    def _shared(self) -> Any:
        """A body of the same type and metadata around the same Brep, which is not copied: its faces,
        edges and the measures cached of it are this body's (kernel plan T8). It is a shape of its
        own all the same: not equal to this one, and a member of sets and selections apart from it."""
        b = type(self).__new__(type(self))
        for cls in type(self).__mro__:
            slots = cls.__dict__.get("__slots__", ())
            for s in (slots,) if isinstance(slots, str) else slots:
                if s != "__weakref__" and hasattr(self, s):
                    setattr(b, s, getattr(self, s))
        return b

    def _with_face_attrs(self, what: str, faces: Any, colors: Any = None, names: Any = None) -> Any:
        """A copy whose selected faces (as :meth:`Part._own_faces` takes them) get ``colors`` and
        ``names`` (``ext.set_face_colors``, ``ext.set_face_names``: one for all, ``[]`` or ``""`` to
        take them off; None leaves them as they are)."""
        own = Part._own_faces(self, faces)  # type: ignore[arg-type]
        if not own:
            raise ValueError(f"{what}: no faces selected")
        copy, mapped, _, _ = ext.copy_with_map(self._brep, own, [], [])
        h = BrepHandle(copy)
        with kernel_call(what):
            if colors is not None:
                ext.set_face_colors(h.brep, mapped, colors)
            if names is not None:
                ext.set_face_names(h.brep, mapped, names)
        b = self._like(_take(h))
        # (the same body but for the attributes: what was found or measured of it holds)
        b._h.sound, b._h.props, b._h.tags, b._h.shells = self._h.sound, self._h.props, self._h.tags, self._h.shells
        _same_sources(self._h, b._h)
        return b

    # -- metadata (returns new shapes; shapes are immutable) ------------------
    def named(self, name: str | None, *, faces: Any = None) -> Any:
        """The same body with a name (used by exporters and the viewer).

        With ``faces`` (faces of this body, or of an earlier version of it: as :meth:`Part.fillet`
        takes edges), the body keeps its own name and those faces get this one (:attr:`Face.name`,
        ``None`` takes it off): it stays with the faces and their pieces through later operations,
        and STEP files write it on the face. ``part.faces().filter_by(lambda f: f.name == "seal")``
        finds them again.
        """
        if faces is not None:
            if name is not None and not isinstance(name, str):
                raise TypeError(f"named: a name is a string, not a {type(name).__name__}")
            return self._with_face_attrs("named", faces, names=[name or ""])
        b = self._shared()
        b.name = name
        return b

    def colored(self, color: str | Sequence[float] | None, *, faces: Any = None) -> Any:
        """The same body with a display color (``"steelblue"``, ``"#4682b4"`` or ``(r, g, b)``).

        With ``faces`` (faces of this body, or of an earlier version of it), the body keeps its own
        color and those faces get this one (:attr:`Face.color`; ``None`` takes it off): it stays with
        the faces through later operations (the walls of a hole keep the color of the tool's faces),
        and STEP, glTF and USD files and pictures show it on them::

            tool = Cylinder(5, 20)
            plate = Box(60, 40, 8) - tool.colored("red", faces=tool.faces())
            plate = plate.colored("steelblue", faces=plate.faces().top())
        """
        if faces is not None:
            from .colors import to_rgb

            rgb = [] if color is None else [float(c) for c in to_rgb(color)]
            return self._with_face_attrs("colored", faces, colors=[rgb])
        b = self._shared()
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
        """Minimum distance to a point, another body, a face, an edge or a wire.

        For a point inside a part, and for a body nested in another, it is the distance to
        the surface (the wall clearance). Bodies that touch or overlap are 0 apart, and so are a
        body and a curve that touches or crosses its surface.
        """
        if isinstance(other, _Body):
            return _body_distance(self, other)
        if isinstance(other, (Face, Edge, Wire)):
            return self.closest_points(other).distance
        if isinstance(other, Shape) and not isinstance(other, Vertex):
            raise TypeError(f"distance_to takes a point, a body, a face, an edge or a wire, not a {type(other).__name__}")
        # (the kernel's closest point, k.brep_closest_point, can stop where a B-spline face folds back
        # towards the point: ext.nearest_point searches every knot span that could hold a nearer one)
        with kernel_call("distance"):
            return float(ext.nearest_point(self._brep, list(_vec(other).to_tuple()))["distance"])  # type: ignore[arg-type]

    def closest_points(self, other: _Body | Face | Edge | Wire) -> ClosestPoints:
        """The nearest points of this body and another body, a face, an edge or a wire
        (:class:`ClosestPoints`): the point on this body, the point on the other, their distance
        and the faces they lie on. The points are exact surface points (and curve points), as for
        :meth:`distance_to`; where the shapes touch or overlap, the distance is 0 and the points
        are one place where they meet."""
        if isinstance(other, Face):
            r = _body_distance(self, other.to_shell(), points=True)
            return ClosestPoints(r.point, r.other_point, r.distance, r.face, other)
        if isinstance(other, _Body):
            return _body_distance(self, other, points=True)
        if isinstance(other, (Edge, Wire)):
            return _curve_distance(self, other)
        raise TypeError(f"closest_points takes a body, a face, an edge or a wire, not a {type(other).__name__}")

    def closest_point(self, point: VectorLike) -> Vector:
        with kernel_call("closest point"):
            return Vector(*ext.nearest_point(self._brep, list(_vec(point).to_tuple()))["point"])

    def raycast_many(self, origins: Any, directions: Any) -> list[Hit | None]:
        """The first hit of each of many rays, one per ray (``Hit`` or ``None``), not
        :meth:`raycast` many times (which gives every hit of a ray): for each origin, the ``Hit``
        that :meth:`raycast` gives first (the exact point on the face, the distance, the face, its
        outward normal), ``None`` where the ray misses.

        ``origins`` is an ``(n, 3)`` array or a sequence of points; ``directions`` one direction
        (a vector or an axis) for all of them, or one each. The rays are traced through a mesh of
        the body (made once per body, at 1e-4 of its size) by the kernel's ray tracer, and each
        hit is moved onto the exact face the mesh says the ray meets first; where that face is
        missed there, the ray is cast exactly (:meth:`raycast`), and so is a ray that passes
        within twice the mesh's tolerance (1e-4 of its size) of a triangle it does not meet (it can
        graze a curved face the mesh lies inside of). Give all the rays in one call: the tracer is
        built once per call (0.2 s for a mesh of 20 000 triangles), then a ray takes 0.02 to
        0.05 ms (a plate with 144 holes: 0.05 ms, where :meth:`raycast` takes 1 ms)."""
        from .mesh import _rays

        o, d = _rays(origins, directions, "raycast_many")
        if not len(o):
            return []
        vertices, triangles, owners, mesh_tol = _ray_mesh(self)
        box = self._loose_box()
        tol = 1e-9 * max(box.diagonal, 1e-9, float(np.linalg.norm(o, axis=1).max()))
        with kernel_call("raycast_many"):
            r = ext.body_first_hits(self._brep, vertices, triangles, owners, o, d, tol, mesh_tol)
        faces = self.faces()
        out: list[Hit | None] = []
        for i, found in enumerate(r["found"].tolist()):
            if found == 0:
                out.append(None)
            elif found == 1:
                out.append(Hit(Vector(*r["points"][i]), float(r["t"][i]), Vector(*r["normals"][i]),
                               faces[int(r["faces"][i])]))
            else:  # (the mesh's face is missed there, or met behind the start: the exact cast)
                hits = _raycast(faces, Vector(*o[i]), Vector(*d[i]), box)
                out.append(hits[0] if hits else None)
        return out

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
    def intersection_curves(self, other: _Body | Face | Plane) -> ShapeList[Edge]:
        """The curves where this body's surface meets another body's surface, each one once.

        ``other`` is a Part, Shell or Sketch, a face (the face itself, bounded by its edges), or a
        :class:`Plane` (unbounded: where it cuts this body's faces, as :meth:`Part.section` cuts a
        part). Bodies that do not meet, apart or one inside the other, give an empty list.
        """
        if isinstance(other, Plane):
            # (a planar sheet across the body: the kernel's plane section, intersect_brep_with_plane,
            # fits its curves to B-spline faces within 2e-3 only)
            from .sketches import Rectangle

            box = self._loose_box()
            middle = box.center - other.z_dir * (box.center - other.origin).dot(other.z_dir)
            if (box.center - middle).length > box.diagonal / 2 + 1e-6 * max(1.0, box.diagonal):
                return ShapeList()
            span = 2.0 * box.diagonal + 1.0
            other = Rectangle(span, span).on(Plane(middle, other.x_dir, other.z_dir))
        if isinstance(other, Face):
            other = other.to_shell()
        if not isinstance(other, _Body):
            raise TypeError(f"intersection_curves takes a body (Part, Shell, Sketch), a face or a plane, not a "
                            f"{type(other).__name__}")
        a, b = self._loose_box(), other._loose_box()
        tol = 1e-6 * max(1.0, a.union(b).diagonal)
        if _disjoint(a, b, tol):
            return ShapeList()
        try:
            with kernel_call("intersection curves"):
                curves, _ = k.intersect_breps(self._brep, other._brep)
        except KernelError:
            # (the kernel's intersection fails where the surfaces do not meet: apart, or nested)
            if _body_distance(self, other) > tol:
                return ShapeList()
            raise
        # Where faces of the two bodies lie in one plane, the kernel hands out curves on their
        # borders twice (also reversed).
        return _distinct_curves(curves, tol)

    def silhouette(self, direction: Axis | VectorLike = (0, 0, 1)) -> ShapeList[Edge]:
        """The contour of the body seen along ``direction`` (an axis or a vector, from the body
        towards the viewer): the curves on its faces where the surface turns away from the viewer
        (``n . d = 0``), and the edges between faces that face the viewer and faces that face away.
        All of them, seen or not, as standalone 3D edges; arcs of one circle come joined (a
        sphere's rim is one circle). Faces seen edge-on go with the faces behind them, so their
        near edges are the contour (a box seen from +Z: its 4 top edges). A sheet's free edges are
        not part of it. The curves are exact for spheres, cylinders and tori
        around the direction, traced (within 1e-6 of the body's size) otherwise."""
        from .draft import _contour, _joined_arcs

        d = _direction(direction, "silhouette")
        body, line = _contour(self, -d, "silhouette")
        edges = [Edge._from_curve(ext.edge_curve(e._e)) for e in line]
        del body
        return ShapeList(_joined_arcs(edges, 1e-7 * max(self._loose_box().diagonal, 1.0)))

    def project(self, curve: Edge | Wire, direction: Axis | VectorLike = (0, 0, -1), *,
                nearest: bool = False) -> ShapeList[Edge]:
        """Project a curve onto the body along ``direction`` (an axis or a vector); returns the
        curves on its faces, fitted within 1e-7 of the size of the body and the curve.

        Every face the projection meets gets its pieces: the near side and the far side of the
        body, and faces seen edge-on (pieces along the direction). ``nearest=True`` keeps what the
        projection reaches first: the parts seen from the curve along the direction, cut where
        another part of the body hides them (the default of :meth:`imprint` with a direction, which
        marks the faces an outline lands on). ::

            path = part.project(Spline((0, -20, 50), (10, 0, 50), (0, 20, 50)), (0, 0, -1), nearest=True)
        """
        d = _direction(direction, "project")
        faces = self.faces()
        size = max(1.0, self._loose_box().union(curve.bbox()).diagonal)
        out = ShapeList()
        for e in curve.edges():
            c = e._copy_curve()
            try:
                with kernel_call("project"):
                    res = ext.project_curve([f._f for f in faces], c, d.to_tuple(), 1e-7 * size)
            finally:
                ext.delete_curve(c)
            pieces = [(Edge._from_curve(cv), faces[i]) for cv, i in res]
            if len(pieces) > 1:
                # (the pieces a closed face's seam cut apart, joined again: those of one face)
                from ._face_curves import across_seams

                grouped: dict[int, tuple[Face, list[Edge]]] = {}
                for p, f in pieces:
                    grouped.setdefault(id(f), (f, []))[1].append(p)
                pieces = [(p, f) for f, ps in grouped.values() for p in across_seams(ps, 1e-6 * size)]
            if nearest:
                from ._face_curves import visible_pieces

                out.extend(visible_pieces(self, e, pieces, d, size))
            else:
                out.extend(p for p, _ in pieces)
        return out

    def outline(self, plane: Plane = Plane.XY, *, hidden: bool = False,
                tangent_edges: bool = False) -> ShapeList[Edge] | tuple[ShapeList[Edge], ShapeList[Edge]]:
        """The body's edges and contours projected onto a plane (a 2D drawing view), seen from
        the side the plane's normal points to: the visible lines.

        With ``hidden=True``, ``(visible, hidden)``: the lines behind the body too, for dashed
        hidden lines. With ``tangent_edges=True`` the edges between faces that meet tangentially
        (the tangent lines of fillets) are drawn too. Either way each line comes once: hidden
        pieces under visible lines are cut away, seams of closed faces and edges seen end-on are
        left out. See also :func:`drawing_views`."""
        tol = 1e-7 * max(self.bbox().diagonal, 1.0)
        if hidden or tangent_edges:
            with kernel_call("outline"):
                seen, behind = ext.hidden_lines(self._brep, plane.origin.to_tuple(), plane.z_dir.to_tuple(), False,
                                                bool(tangent_edges))
            visible = _drawn((Edge._from_curve(c) for c in seen), tol)
            back = _drawn((Edge._from_curve(c) for c in behind), tol)
            return (visible, back) if hidden else visible
        with kernel_call("outline"):
            curves = k.project_brep_onto_plane(self._brep, plane.origin.to_tuple(), plane.z_dir.to_tuple())
        # The kernel can hand out the same projected curve twice (on Linux on ARM a cylinder's
        # circles seen edge-on come with a copy each); a drawing view needs each line once.
        return _drawn(_distinct_curves(curves, tol, 10 * tol), tol)

    def _transformed(self, m: np.ndarray) -> Any:
        h = BrepHandle(self._copy_brep())  # freed if the kernel fails
        with kernel_call("transform"):
            ext.transform_brep(h.brep, list(m.T.ravel()))
        if not _similarity(m):
            # A scale that differs between the axes (or a shear) makes every face and edge a
            # B-spline: the kernel's recognition gives back the planes, cylinders, cones, surfaces of
            # revolution, lines and circles, before anything measures the copy (a measure stores
            # refitted trim curves in it, which kept a 6.8e-7 volume error) (kernel plan T6).
            size = self._loose_box().diagonal * float(np.linalg.norm(m[:3, :3]))
            with kernel_call("transform"):
                recognized = ext.recognize_analytics(h.brep, 1e-9 * max(1.0, size))
            if recognized is not None:
                h = BrepHandle(recognized)
        # A moved copy is a shape of its own: its faces and edges descend from none of the
        # original's (copies in a pattern can be told apart; a selection of the original is
        # not taken for the copy's).
        ext.tag_topology(h.brep, True)
        moved = self._like(_take(h))
        _same_sources(self._h, moved._h, m)
        return moved

    # -- body conversions -----------------------------------------------------
    def to_nurbs(self) -> Any:
        """A copy whose faces and edges are all NURBS (analytic types converted)."""
        h = BrepHandle(self._copy_brep())
        with kernel_call("to_nurbs"):
            k.turn_to_nurbs(h.brep)
        return self._like(_take(h))

    def heal(self) -> Any:
        """Repair gaps, tolerances and topology (mostly needed for imported data). A sheet
        whose faces close around a volume once healed comes back as a :class:`Part`."""
        h = BrepHandle(self._copy_brep())
        with kernel_call("heal"):
            k.heal_brep(h.brep)
        healed = self._like(_take(h))
        if isinstance(healed, Shell) and not isinstance(healed, Sketch) and healed._brep.is_manifold_solid():
            part = Part._wrap(healed._copy_brep(), name=self.name, color=self.color)
            if part._solid_problem() is None:
                return part
        return healed

    def check(self, level: int = 2) -> list[Problem]:
        """What the kernel's own validity checks find wrong with the body: per failed test a
        :class:`Problem` with the face, edge or vertex it is about (or the body), a message,
        and the value and tolerance it measured. An empty list: nothing found.

        ``level`` 0 checks the structure (how faces, loops, edges and vertices connect, the
        pointers between them) and the gaps between vertices, edges and faces against their
        tolerances; 1 also the geometry; 2 (the default) everything, the slow tests too. That
        takes some milliseconds on parts smlibpy makes, about 0.1 s on an imported part of
        170 faces.

        The tests look at each face, edge and vertex and its neighbours (SmBrep::AssertValid):
        they do not see a body that runs through itself. Use them where :meth:`is_valid`
        cannot tell what is wrong: after importing, stitching or healing, or where an operation
        on a part fails that ``is_valid()`` accepts.
        """
        if level not in (0, 1, 2):
            raise ValueError(f"check: the level must be 0, 1 or 2 (got {level!r})")
        with kernel_call("check"):
            reports = ext.check_brep(self._brep, level)
        faces = edges = vertices = None

        def shape(kind: str | None, index: int) -> Any:
            nonlocal faces, edges, vertices
            if kind == "face":
                faces = faces if faces is not None else self._brep.faces()
                return Face(self, faces[index])
            if kind == "edge":
                edges = edges if edges is not None else self._brep.edges()
                return Edge._of(self, edges[index])
            if kind == "vertex":
                vertices = vertices if vertices is not None else self._brep.vertices()
                return Vertex._of(self, vertices[index])
            return self if kind == "body" else None

        return [Problem(shape(r["kind"], r["index"]), r["message"], r["value"], r["tolerance"], r["category"],
                        r["test"], shape(r["other_kind"], r["other_index"])) for r in reports]

    def _identity(self) -> Any:
        # (each body: a renamed or recolored one shares its Brep, kernel plan T8)
        return ("b", id(self))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, _Body):
            return NotImplemented
        return self is other

    def __hash__(self) -> int:
        return hash(self._identity())

    def info(self) -> dict[str, Any]:
        """Counts and measures in one dictionary. A body made by ``shell`` or ``offset`` also says
        how the corners of its new walls came out: ``"corners"`` is ``"round"`` or ``"sharp"``."""
        b = self.bbox()
        out = {
            "type": type(self).__name__,
            "faces": self._brep.face_count(),
            "edges": self._brep.edge_count(),
            "vertices": self._brep.vertex_count(),
            "bbox": (b.min.to_tuple(), b.max.to_tuple()),
        }
        out.update(_MADE.get(self._h, {}))
        return out


def _drawn(edges: Iterable[Edge], tol: float) -> ShapeList[Edge]:
    """Projected edges as a drawing has them: the B-splines that are lines or circular arcs exactly
    (the kernel's projections fit every curve) as lines and arcs, and the arcs of one circle that
    meet end to end joined, so that ``circles()`` and ``radius`` find a view's holes.

    Pieces within a box ``10 * tol`` across are left out (:func:`_speck`): the kernel's
    projection gives such slivers where an edge or a seam is seen end-on (a torus from the side),
    points rather than lines of the view. So are lines that lie on a longer line of the view (a
    hole's rim seen edge-on, on the part's outline): each line comes once. A piece that cannot be
    rebuilt (a straight one that runs back on itself) stays as the kernel gave it."""
    from .curves import CenterArc, Line, ThreePointArc
    from .draft import _joined_arcs
    from .dxf import _circle_of

    out: list[Edge] = []
    for e in edges:
        if _speck(e, 10 * tol):
            continue
        if e.geom_type == "bspline":
            try:
                if e._is_straight():
                    if abs(e.start.distance_to(e.end) - e.length) <= tol:
                        e = Line(e.start, e.end)
                else:
                    circle = _circle_of(e)
                    if circle is not None:
                        center, axis = Vector(*circle[0]), Vector(*circle[2])
                        if e.is_closed:
                            plane = Plane(center, x_dir=(e.start - center).normalized(), z_dir=axis)
                            e = CenterArc((0, 0), float(circle[1]), 0.0, 360.0, plane)
                        else:
                            e = ThreePointArc(e.start, e.point_at(0.5), e.end)
            except ValueError:
                pass  # (ends or points that coincide: the piece as projected)
        out.append(e)
    return ShapeList(_joined_arcs(_uncovered_lines(out, 10 * tol), tol))


def _uncovered_lines(edges: list[Edge], tol: float) -> list[Edge]:
    """The edges without the lines that lie within ``tol`` of a longer (or equal) line among them,
    in their order."""
    def on(x: np.ndarray, p: np.ndarray, q: np.ndarray) -> bool:
        d = q - p
        t = min(max(float((x - p) @ d) / float(d @ d), 0.0), 1.0)
        return float(np.linalg.norm(p + t * d - x)) <= tol

    lines = sorted((e for e in edges if e.geom_type == "line"), key=lambda e: -e.length)
    kept: list[tuple[np.ndarray, np.ndarray]] = []
    covered: set[int] = set()
    for e in lines:
        a, b = np.array(e.start.to_tuple()), np.array(e.end.to_tuple())
        if any(on(a, p, q) and on(b, p, q) for p, q in kept):
            covered.add(id(e))
        else:
            kept.append((a, b))
    return [e for e in edges if id(e) not in covered]


def _speck(e: Edge, size: float) -> bool:
    """Whether an edge lies within a box ``size`` across: a point of a drawing view, not a line.
    For a B-spline from the box of its control points (the curve lies in their hull): measuring
    the length or the middle of the kernel's degenerate slivers takes a second each."""
    if e.geom_type == "bspline":
        p = np.array(ext.curve_data(e._curve())["poles"], dtype=float)
        if float(np.linalg.norm(p.max(axis=0) - p.min(axis=0))) <= size:
            return True
    return e.bbox().diagonal <= size


def _distinct_curves(curves: Iterable[Any], tol: float, speck: float = 0.0) -> ShapeList[Edge]:
    """Edges of new kernel curves, each curve once: one whose ends and midpoint lie within
    ``tol`` of those of a curve kept already (either way round) is left out, and with ``speck``
    so is one within a box ``speck`` across (see :func:`_speck`)."""
    kept: list[tuple[Edge, np.ndarray, np.ndarray, np.ndarray]] = []
    for c in curves:
        e = Edge._from_curve(c)
        if speck > 0.0 and _speck(e, speck):
            continue
        a, b, m = (np.array(p.to_tuple()) for p in (e.start, e.end, e.point_at(0.5)))
        if any(np.linalg.norm(m - km) <= tol
               and min(np.linalg.norm(a - ka) + np.linalg.norm(b - kb), np.linalg.norm(a - kb) + np.linalg.norm(b - ka)) <= tol
               for _, ka, kb, km in kept):
            continue
        kept.append((e, a, b, m))
    return ShapeList(e for e, _, _, _ in kept)


def _disjoint(a: BoundBox, b: BoundBox, tol: float = 1e-9) -> bool:
    return any(a.max[i] < b.min[i] - tol or b.max[i] < a.min[i] - tol for i in range(3))


def _round_faces(body: _Body) -> list[tuple[Vector, Vector, BoundBox]]:
    """The cylinders and cones of a body: a point of the axis, its direction, the face's loose box."""
    out = []
    for f in body._brep.faces():
        info = ext.surface_data(f.surface(), False)
        if info["kind"] in ("cylinder", "cone"):
            pl = info["placement"]
            lo, hi = f.bounding_box(False)
            out.append((Vector(pl["origin"]), Vector(pl["z_dir"]).normalized(), BoundBox(lo, hi)))
    return out


def _parallel_rounds(part: _Body, tool: _Body) -> bool:
    """Whether a cylinder or cone of the tool lies parallel to one of the part, off its axis, where
    the boxes of the two faces overlap: a tool beside an earlier hole or boss, whose faces cross
    that one's along lines (kernel plan B10)."""
    mine = _round_faces(part)
    if not mine:
        return False
    for o, d, box in _round_faces(tool):
        for o2, d2, box2 in mine:
            if d.cross(d2).length > 1e-9:
                continue
            off = (o2 - o) - d * (o2 - o).dot(d)  # from one axis to the other
            if off.length <= 1e-9 * (1.0 + box.diagonal + box2.diagonal):
                continue  # on one axis: they cross along circles, if at all
            if not _disjoint(box, box2, 1e-6 * (box.diagonal + box2.diagonal)):
                return True
    return False


def _surface_contacts(part: _Body, tool: _Body) -> dict[str, Any]:
    """How the planes, cylinders and spheres of a tool meet those of a part, for the hint of a
    Boolean that failed (kernel plan B19): ``beside`` (a cylinder of the tool crosses a parallel
    cylinder of the part along lines: a tool beside a hole or boss), ``tangent`` (where a cylinder
    or sphere touches a plane, cylinder or sphere tangentially) and ``coincident`` (where a face of
    the tool lies on one of the part: the same plane, cylinder or sphere, over an area), each place
    as ``"at z = 5"`` (a plane across an axis) or ``"near (x, y, z)"``; None where there is none.
    The faces must be near each other (their boxes overlap); not otherwise checked."""

    def surfaces(body: _Body) -> list[tuple[str, Vector, Vector, float, BoundBox]]:
        out = []
        for f in body._brep.faces():
            info = ext.surface_data(f.surface(), False)
            kind = info["kind"]
            if kind == "cone" and abs(info.get("semi_angle_deg", 1.0)) < 1e-12:
                kind = "cylinder"
            if kind in ("plane", "cylinder", "sphere"):
                pl = info["placement"]
                lo, hi = f.bounding_box(False)
                out.append((kind, Vector(pl["origin"]), Vector(pl["z_dir"]).normalized(),
                            float(info.get("radius", 0.0)), BoundBox(lo, hi)))
        return out

    def place(a: BoundBox, b: BoundBox, normal: Vector | None = None, level: Vector | None = None) -> str:
        if normal is not None and level is not None:
            for i, axis in enumerate("xyz"):
                if abs(abs(normal[i]) - 1.0) < 1e-9:
                    return f"at {axis} = {level[i]:.4g}"
        c = (Vector(*(max(a.min[i], b.min[i]) for i in range(3))) + Vector(*(min(a.max[i], b.max[i]) for i in range(3)))) * 0.5
        return f"near ({c.x:.4g}, {c.y:.4g}, {c.z:.4g})"

    def spread(a: BoundBox, b: BoundBox) -> float:
        """The second largest extent of the boxes' overlap (an area, not a line or a point, where it is not 0)."""
        return sorted(min(a.max[i], b.max[i]) - max(a.min[i], b.min[i]) for i in range(3))[1]

    tol = 1e-6 * max(part._loose_box().diagonal, tool._loose_box().diagonal, 1.0)
    found: dict[str, Any] = {"beside": False, "tangent": None, "coincident": None}
    mine = surfaces(part)
    for kind, o, d, r, box in surfaces(tool):
        for kind2, o2, d2, r2, box2 in mine:
            if _disjoint(box, box2, tol):
                continue
            area = spread(box, box2) > 1e-4 * max(box.diagonal, box2.diagonal)
            pair = {kind, kind2}
            if pair == {"plane"}:
                if d.cross(d2).length <= 1e-9 and abs((o2 - o).dot(d)) <= tol and area:
                    found["coincident"] = found["coincident"] or place(box, box2, d, o)
            elif pair == {"cylinder"}:
                if d.cross(d2).length > 1e-9:
                    continue
                apart = ((o2 - o) - d * (o2 - o).dot(d)).length
                if apart <= tol and abs(r - r2) <= tol and area:
                    found["coincident"] = found["coincident"] or place(box, box2)
                elif abs(apart - (r + r2)) <= tol or (abs(r - r2) > tol and abs(apart - abs(r - r2)) <= tol):
                    found["tangent"] = found["tangent"] or place(box, box2)
                elif abs(r - r2) + tol < apart < r + r2 - tol:
                    found["beside"] = True
            elif pair == {"sphere"}:
                apart = (o2 - o).length
                if apart <= tol and abs(r - r2) <= tol:
                    found["coincident"] = found["coincident"] or place(box, box2)
                elif abs(apart - (r + r2)) <= tol or (abs(r - r2) > tol and abs(apart - abs(r - r2)) <= tol):
                    found["tangent"] = found["tangent"] or place(box, box2)
            elif "plane" in pair:
                (_, po, pn, _, _), (rk, ro, rd, rr, _) = sorted(
                    [(kind, o, d, r, box), (kind2, o2, d2, r2, box2)], key=lambda x: x[0] != "plane")
                if rk == "cylinder" and abs(rd.dot(pn)) > 1e-9:
                    continue  # (a cylinder meets a plane across its axis in a circle or an ellipse)
                if abs(abs((ro - po).dot(pn)) - rr) <= tol:
                    found["tangent"] = found["tangent"] or place(box, box2)
    return found


def _crash_note(e: Exception | None, operation: str) -> str | None:
    """For a kernel failure that is a crash (a trap of smlibwasm, a crash in a copy of the process)
    or a null pointer the kernel met inside (SM_ERR_NULL_POINTER): what the error says of it instead
    of a guess about the inputs; None for other failures (kernel plan B19)."""
    if not isinstance(e, KernelError):
        return None
    detail = e.detail or ""
    if "the kernel crashed" in detail:
        inner = detail[detail.index("the kernel crashed"):]
        why = inner[inner.index("(") + 1:inner.rindex(")")] if "(" in inner and ")" in inner else ""
        return f"the kernel crashed in the {operation}" + (f" ({why})" if why else "")
    if e.status == "SM_ERR_NULL_POINTER":
        return f"the kernel failed inside the {operation} (it met a null pointer of its own)"
    return None


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


def _union_or_cut_problem(result: Part, part: Part, tools: Sequence[Part], op: Any) -> str | None:
    """What is wrong with a union or a cut where quick evidence says to look, or None. Both lie
    within their operands (a cut within the part): points of the result's surface beyond the
    operands' loose boxes are wrong. A union holds every point of its operands' surfaces, and a cut
    none of its tools' inside it: these are classified where the result may be an operand given back
    (as many faces, and its vertices among the result's), and for a union where an operand's loose
    box reaches out of the result's. The kernel can take an operand that reaches out of the other
    for inside it and return the other one, with a vertex or two imprinted: ``(Cylinder(5, 5) +
    Box(20, 4, 16).rotate(X, 90).translate(0, -3, -0.5)) + Cylinder(2, 12).translate(2, -2.3693,
    3.5)`` gave the first operand (1358.54 for 1446.61); and return a cut that reaches out of the
    part: ``Cylinder(2, 12) - Cylinder(1.5, 30).rotate(Y, 90).translate(1, -0.5, 2.4787)``, of
    volume 0, reached to x = 16 (right: 125.96)."""
    box = result._loose_box()
    tol = 1e-6 * box.diagonal + 1e-5
    near = max(1e-4 * box.diagonal, 1e-5)  # the new edges are fitted, to about 2e-5
    operands = [part, *tools]
    hull = part._loose_box()
    if op == k.BooleanOp.UNION:
        for t in tools:
            hull = hull.union(t._loose_box())
    if not (hull.contains(box.min, tol) and hull.contains(box.max, tol)):
        if not all(hull.contains(p, near) for p in _surface_points(result)):
            return "partly outside its operands" if op == k.BooleanOp.UNION else "partly outside the part"
    n = result._brep.face_count()
    given = [x._brep.face_count() == n and _same_vertices(x, result, tol, among=True) for x in operands]
    if op == k.BooleanOp.UNION:
        for i, x in enumerate(operands):
            xb = x._loose_box()
            out = not (box.contains(xb.min, tol) and box.contains(xb.max, tol))
            if (out or any(g for j, g in enumerate(given) if j != i)) and any(
                    w == "outside" for w, _, _ in result._classify(_surface_points(x), near)):
                return "an operand left out, although it reaches out of the other (the kernel took it for " \
                       "inside the other operand)"
    elif op == k.BooleanOp.DIFFERENCE and given[0]:
        for t in tools:
            if any(w == "inside" for w, _, _ in result._classify(_surface_points(t), near)):
                return "the part given back uncut, although a tool reaches into it (the kernel took the tool " \
                       "for outside the part)"
    return None


def _seam_zones(part: Part, tools: Sequence[Part]) -> list[tuple[Any, Any]]:
    """The boxes of the faces where a seam of one operand touches a face of another at a point
    (``ext.seam_touches``: the seam's own face and the face it touches), between the part and each
    tool: where the kernel's Boolean can come out wrong (kernel plan B6). Empty where no seam
    touches."""
    out: list[tuple[Any, Any]] = []
    for t in tools:
        if _disjoint(part._loose_box(), t._loose_box(), 1e-6 * part._extent()):
            continue
        for a, b in ((part, t), (t, part)):
            touches = ext.seam_touches(a._brep, b._brep)
            if not touches:
                continue
            edges, faces = a._brep.edges(), b._brep.faces()
            for edge, face, _ in touches:
                out.append(faces[face].bounding_box(False))
                out.extend(f.bounding_box(False) for f in edges[edge].faces())
    return out


def _seam_problem(result: Part, part: Part, tools: Sequence[Part], op: Any) -> str | None:
    """What is wrong with a Boolean's result where a seam of one operand touches a face of another
    at a point, or None. The seam turned or moved on its face first (``ext.boolean``) leaves the
    kernel right; a seam no turn moves (a torus' outer equator, the seam of a free-form face) can
    leave a valid body of the wrong volume (kernel plan B6). Points on the result's faces near
    those faces (16 x 16 in each face's parameter box, on the face) are classified against the
    operands: on a union's surface none lies inside an operand or outside all of them, on an
    intersection's none outside an operand, on a difference's none outside the part or inside a
    tool. A point the kernel cannot classify on its face (a face whose trim it cannot resolve)
    counts as such a point too. Three such points refuse it. ``(Box(30, 30, 30) - Cylinder(5.997,
    60).translate(2.016, 2.814, 0)) + Torus(3.546, 1.773).rotate(Y, 90).translate(8.013, 8.133,
    6.396)`` gave 23610.47, the torus inside the hole left out (right: 23635.96); the intersection
    of ``Torus(6, 4).rotate(Y, 90)`` and a half-space whose plane touches its outer equator gave
    11.61 or 52.26 for 5.81, with faces on which no point can be classified."""
    zones = _seam_zones(part, tools)
    if not zones:
        return None
    operands = [part, *tools]
    size = max(x._loose_box().diagonal for x in operands)
    reach, tol = 1e-3 * size, 1e-6 * size + 1e-7
    points = []
    wrong: list[tuple[float, float, float]] = []
    n = 16
    for f in result._brep.faces():
        lo, hi = f.bounding_box(False)
        if not any(all(lo[i] <= zh[i] + reach and zl[i] - reach <= hi[i] for i in range(3)) for zl, zh in zones):
            continue
        (u0, v0), (u1, v1) = f.uv_domain()
        for i in range(n):
            for j in range(n):
                u, v = u0 + (i + 0.5) / n * (u1 - u0), v0 + (j + 0.5) / n * (v1 - v0)
                try:
                    inside = f.classify_uv(u, v) == "inside"
                except RuntimeError:  # (a face whose trim the kernel cannot resolve)
                    try:
                        wrong.append(Vector(f.point_at_uv(u, v)).to_tuple())
                    except RuntimeError:
                        wrong.append(tuple(0.5 * (a + b) for a, b in zip(lo, hi)))
                    continue
                if inside:
                    points.append(Vector(f.point_at_uv(u, v)).to_tuple())
    where = [[w for w, _, _ in x._classify(points, tol)] for x in operands] if points else []
    for j, p in enumerate(points):
        c = [w[j] for w in where]
        if op == k.BooleanOp.UNION:
            bad = all(x == "outside" for x in c) or "inside" in c
        elif op == k.BooleanOp.INTERSECTION:
            bad = "outside" in c
        else:
            bad = c[0] == "outside" or "inside" in c[1:]
        if bad:
            wrong.append(p)
    if len(wrong) < 3:
        return None
    return (f"wrong where a seam of one operand touches a face of the other at a point (its faces there do not "
            f"bound what the operands give, near {_fmt_point(Vector(wrong[0]))})")


def _same_vertices(a: _Body, b: _Body, tol: float, among: bool = False) -> bool:
    """Whether two bodies have as many vertices and each vertex of ``a`` lies near one of ``b``
    (within ``tol``, or up to 4 ``tol``: cells of a grid; for the quick test of a body given back
    unchanged, where too many is safe). With ``among``, ``b`` may have more vertices."""
    pa = [v.point() for v in a._brep.vertices()]
    pb = [v.point() for v in b._brep.vertices()]
    if len(pa) > len(pb) if among else len(pa) != len(pb):
        return False
    def grid(points: list[Any]) -> list[list[int]]:
        return np.floor(np.asarray(points, dtype=float).reshape(-1, 3) / tol).astype(np.int64).tolist()

    cells = {tuple(c) for c in grid(pb)}
    around = [(i, j, m) for i in (0, -1, 1) for j in (0, -1, 1) for m in (0, -1, 1)]
    return all(any((c[0] + i, c[1] + j, c[2] + m) in cells for i, j, m in around) for c in grid(pa))


def _offset_problem(result: Part, box: BoundBox, tol: float, before: float, smaller: bool | None,
                    wider: Callable[[], float] | None = None) -> str | None:
    """What is wrong with the result of a shell or an offset (see ``Part._checked``), or None.
    ``wider`` gives the box's margin for a result that reaches beyond ``tol`` (computed only then)."""
    problem = result._solid_problem()
    if problem is not None:
        return f"a body that is {problem}"
    if _reaches_out(result, box, tol) and (wider is None or _reaches_out(result, box, wider())):
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


def _reaches_out(result: _Body, box: BoundBox, margin: float) -> bool:
    """Whether a body reaches more than ``margin`` out of ``box`` (``_offset_problem``), beyond the
    tolerance of the edges and vertices of the faces that do (at most 1e-4 of the box's size). The
    kernel's tight box of a face takes in the points of its surface that it classifies on the face,
    and a point within the tolerance of one of its vertices or edges classifies on it, also off the
    face: the extended offset mode's rim vertex of a shelled twisted vase has a tolerance of 1.8e-3,
    and the inner wall's box reached 1.3e-3 above the rim in about 2 of 5 runs (a point of its surface
    1.4e-3 from that vertex), where its edges and its mesh end at the rim."""
    def out(lo: Sequence[float], hi: Sequence[float], m: float) -> bool:
        return any(lo[i] < box.min[i] - m or hi[i] > box.max[i] + m for i in range(3))

    rb = result.bbox()
    if not out(rb.min, rb.max, margin):
        return False
    cap = 1e-4 * max(box.diagonal, 1.0)
    for f in result._brep.faces():
        lo, hi = f.bounding_box(True)
        if out(lo, hi, margin):
            tols = [float(ext.edge_tolerance(e)) for e in f.edges()] + [float(ext.vertex_tolerance(v)) for v in f.vertices()]
            if out(lo, hi, margin + min(max(tols, default=0.0), cap)):
                return True
    return False


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


@overload
def _body_distance(a: _Body, b: _Body, seeds: int = 6, sample: int = 400) -> float: ...
@overload
def _body_distance(a: _Body, b: _Body, seeds: int = 6, sample: int = 400, *, points: bool) -> ClosestPoints: ...
def _body_distance(a: _Body, b: _Body, seeds: int = 6, sample: int = 400, *, points: bool = False) -> Any:
    """Distance between the surfaces of two bodies (0 where they touch or overlap).

    The kernel's own body distance is wrong where the nearest points form a line (parallel
    cylinders) and far from the origin. Here: the mesh vertices of each body nearest to the
    other give starting points; from the best ones, ``ext.nearest_points`` takes closest
    points in turn on either body and finishes with Newton's method on the parameters of the
    faces they lie on, which ends in a pair of exact surface points. (Closest points in turn
    alone settle slowly between nearly parallel faces: two skew cylinders 2 apart at 5 degrees
    were still 2.4845 apart after 500 rounds.) With ``points``, the nearest points and their faces
    (:class:`ClosestPoints`).
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
    pair: tuple[Any, Any, Any, Any] = (None, None, None, None)  # on a, on b, face of a, face of b
    for _, x, y, p in sorted(starts, key=lambda t: t[0])[:2 * seeds]:
        with kernel_call("distance_to"):
            r = ext.nearest_points(x._brep, y._brep, tuple(float(c) for c in p))
        if r["distance"] < best:
            best, unsettled = r["distance"], r["gain"]
            pair = ((r["a"], r["b"], r["face_a"], r["face_b"]) if x is a else
                    (r["b"], r["a"], r["face_b"], r["face_a"]))
    scale = max(ab.diagonal, bb.diagonal, 1.0)
    if unsettled > 1e-9 * scale:
        import warnings

        warnings.warn(f"distance_to: the nearest points did not settle; the distance {best:.6g} may be too large "
                      f"(the last step still gained {unsettled:.2g})", RuntimeWarning, stacklevel=3)
    best = 0.0 if best <= 1e-12 * scale else best
    if not points:
        return best
    pa, pb, fa, fb = pair
    return ClosestPoints(Vector(tuple(pa)), Vector(tuple(pb)), best, None if fa is None else Face(a, fa),
                         None if fb is None else Face(b, fb))


def _curve_distance(body: _Body, curve: Edge | Wire, samples: int = 64, seeds: int = 4) -> ClosestPoints:
    """The nearest points of a body and an edge or a wire: for each edge, the body's distance
    from points along the curve (by its parameter) gives starting points; from the best few,
    ``ext.nearest_curve_points`` takes closest points in turn and finishes with Newton's method on
    the parameters of the curve and of the face it meets, as :func:`_body_distance` does for two
    bodies."""
    if body._brep.face_count() == 0:
        raise ValueError("distance_to: an empty body has no distance")
    best: tuple[float, Any] = (math.inf, None)
    unsettled = 0.0
    for e in curve.edges():
        c = e._curve()
        t0, t1 = e._range()
        ts = [t0 + (t1 - t0) * i / samples for i in range(samples + 1)]
        found = []
        for t in ts:
            p = np.array(Vector(c.evaluate(t)).to_tuple())
            found.append((float(np.linalg.norm(_closest(body, p) - p)), t))
        found.sort()
        taken: list[float] = []
        for _, t in found:
            if len(taken) >= seeds:
                break
            if all(abs(t - u) > (t1 - t0) / samples for u in taken):
                taken.append(t)
        for t in taken:
            with kernel_call("distance_to"):
                r = ext.nearest_curve_points(body._brep, c, t0, t1, t)
            if r["distance"] < best[0]:
                best, unsettled = (r["distance"], r), r["gain"]
    d, r = best
    scale = max(body._loose_box().diagonal, curve.bbox().diagonal, 1.0)
    if unsettled > 1e-9 * scale:
        import warnings

        warnings.warn(f"distance_to: the nearest points did not settle; the distance {d:.6g} may be too large "
                      f"(the last step still gained {unsettled:.2g})", RuntimeWarning, stacklevel=4)
    d = 0.0 if d <= 1e-12 * scale else d
    return ClosestPoints(Vector(tuple(r["a"])), Vector(tuple(r["b"])), d,
                         None if r["face_a"] is None else Face(body, r["face_a"]), None)


def _unmeasurable(body: _Body, face: int, what: str = "mass properties") -> None:
    """Called where the integration ran out of a face's evaluation budget (measure.cpp): raises
    for a face that crosses its surface's seam, which the integration cannot converge on (it ran
    for minutes); otherwise the result stands, not converged, and says so."""
    problems = ext.seam_problems(body._brep, False, [face])
    crossed = [p for p in problems if p.get("crossed")]
    if crossed:
        why = (f"face {face} of the body crosses the seam of its surface (along {crossed[0]['crossed']}), so its "
               f"area and volume cannot be integrated: the body is broken (is_valid() is False); rebuild the step "
               f"that made it, or heal() it")
        raise KernelError(what, why, None, why)


def _mesh_tolerance(body: _Body, scale: float = 1.0) -> float:
    """tessellate's default tolerance for a body (1e-3 of its box diagonal), times ``scale``."""
    return max(body.bbox().diagonal * 1e-3 * scale, 1e-6)


def _mesh_overlap(a: Part, tools: Sequence[Part], op: Any, scale: float = 1.0) -> float | None:
    """The volume the meshes of a body and a tool have in common (``op`` INTERSECTION) or of the
    body's left outside the tools (DIFFERENCE), the meshes made to ``scale`` times tessellate's
    default tolerance; None where the kernel's mesh Boolean fails (as it can where the meshes have
    faces in common). The meshes lie within their tolerance of the bodies, inside them where the
    surfaces are convex: bodies that only touch have no volume in common, or (where a concave face
    of one touches the other) a volume that shrinks with the tolerance."""
    from .mesh import tessellate

    try:
        mesh = tessellate(a, _mesh_tolerance(a, scale))
        for t in tools:
            tm = tessellate(t, _mesh_tolerance(t, scale))
            mesh = mesh & tm if op == k.BooleanOp.INTERSECTION else mesh - tm
            if not len(mesh.triangles):
                return 0.0
        return abs(mesh.volume)
    except (KernelError, ModelingError, ValueError):
        return None


def _surface_samples(body: _Body, near: BoundBox, tol: float, limit: int = 2000) -> list[tuple[float, float, float]]:
    """Points on the mesh of a body (within ``tol`` of the surface) that lie in a box, at most
    ``limit`` of them, spread over the list: its corners, the middles of its triangles, and, in a
    triangle longer than a twelfth of the box, points on a grid that far apart (the side of a long
    cylinder is a few triangles from end to end: their corners and middles can all lie outside a
    box that the cylinder crosses)."""
    from .mesh import tessellate

    mesh = tessellate(body, tol)
    lo, hi = np.array(near.min.to_tuple()) - tol, np.array(near.max.to_tuple()) + tol
    if len(mesh.triangles):
        tri = mesh.vertices[mesh.triangles]
        tri = tri[np.all((tri.max(axis=1) >= lo) & (tri.min(axis=1) <= hi), axis=1)]  # (those meeting the box)
        parts = [mesh.vertices, tri.mean(axis=1)]
        spacing = max(float(np.linalg.norm(hi - lo)) / 12, tol)
        longest = np.linalg.norm(tri - np.roll(tri, 1, axis=1), axis=2).max(axis=1) if len(tri) else np.zeros(0)
        steps = np.clip(np.ceil(longest / spacing), 1, 16).astype(int)
        for n in np.unique(steps[steps > 1]):
            sel = tri[steps == n]
            i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
            ok = (i + j) <= n
            u, w = i[ok] / n, j[ok] / n
            a = sel[:, 0][:, None, :]
            grid = a + (sel[:, 1][:, None, :] - a) * u[None, :, None] + (sel[:, 2][:, None, :] - a) * w[None, :, None]
            parts.append(grid.reshape(-1, 3))
        pts = np.vstack(parts)
    else:
        pts = mesh.vertices
    pts = pts[np.all((pts >= lo) & (pts <= hi), axis=1)]
    if len(pts) > limit:
        pts = pts[np.linspace(0, len(pts) - 1, limit).astype(int)]
    return [tuple(float(c) for c in p) for p in pts]


def _classified_empty(a: Part, tools: Sequence[Part], op: Any) -> bool:
    """:func:`_empty_is_right` by classifying points instead (where the mesh Booleans fail, or
    could crash): no point of one operand's mesh lies inside the other by more than twice the
    mesh's tolerance (INTERSECTION), or none of the part's lies outside every tool (DIFFERENCE).
    (Twice: the kernel's meshes keep to their tolerance only about; a sphere's for 0.0346 lies up
    to 0.0356 inside it.)"""
    tol = max(_mesh_tolerance(a), *(_mesh_tolerance(t) for t in tools))
    if op == k.BooleanOp.INTERSECTION:
        b = tools[0]
        for x, y in ((a, b), (b, a)):
            pts = _surface_samples(x, y._loose_box(), tol)
            if pts and any(where == "inside" for where, _, _ in y._classify(pts, 2 * tol)):
                return False
        return True
    pts = _surface_samples(a, a._loose_box(), tol)
    covered = [False] * len(pts)
    for t in tools:
        for i, (where, _, _) in enumerate(t._classify(pts, 2 * tol)):
            covered[i] = covered[i] or where != "outside"
    return all(covered)


def _empty_is_right(a: Part, tools: Sequence[Part], op: Any) -> bool:
    """Whether an empty intersection (one tool) or cut is right: the meshes of the operands have
    no volume in common (in the cut: none of the part is left outside the tools), up to 1e-6 of
    the smaller volume, or a volume that shrinks to less than half at a tenth of the tolerance
    (where a concave face touches the other body, the meshes overlap by about the tolerance).
    Where the mesh Booleans fail, points of the meshes are classified (:func:`_classified_empty`).
    (The kernel's brep_relationship is not asked: it calls overlapping bodies "touching", such as
    spheres with 18.6 in common or a pin through a plate, its answer changes with where the bodies
    are and with what was asked of them before, and it took 10 s for two plates of 168 faces.)"""
    try:
        # The kernel's mesh Boolean can crash where the meshes have faces in common or touch
        # tangentially (internally tangent cylinders, at a tenth of the tolerance): classify points
        # there.
        if any(c["tangent"] or c["coincident"] for c in (_surface_contacts(a, t) for t in tools)):
            return _classified_empty(a, tools, op)
        volumes = [a._quick_volume()] + ([t._quick_volume() for t in tools] if op == k.BooleanOp.INTERSECTION else [])
        small = 1e-6 * max(min(abs(v) for v in volumes), 1e-300)
        coarse = _mesh_overlap(a, tools, op)
        if coarse is not None and coarse <= small:
            return True
        fine = _mesh_overlap(a, tools, op, 0.1) if coarse is not None else None
        if fine is not None:
            return fine <= small or fine < 0.5 * coarse  # type: ignore[operator]
        return _classified_empty(a, tools, op)
    except (KernelError, ValueError):
        return False


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


def _ray_mesh(body: _Body) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """What ``raycast_many`` traces rays through: the mesh of the body at 1e-4 of its size (its
    vertices and triangles), the index of the face of each triangle, and that tolerance. Made
    once per body."""
    from .mesh import _tessellate, _triangle_faces

    cached = body._h.meshes.get("rays")
    if cached is None:
        tolerance = max(body._loose_box().diagonal * 1e-4, 1e-7)
        mesh = _tessellate(body, tolerance, 15.0, True)
        try:
            owners = _triangle_faces(body, mesh) if mesh._poly is not None else np.zeros(0, dtype=np.int64)
        finally:
            mesh.dispose()
        cached = body._h.meshes["rays"] = (mesh.vertices, mesh.triangles, owners, tolerance)
    return cached


def _body_face_meshes(owner: _Body) -> list[Any]:
    """The meshes of the faces of a body (``face_meshes``), made once per body."""
    from .mesh import face_meshes

    cached = owner._h.meshes.get("faces")
    if cached is None:
        cached = owner._h.meshes["faces"] = face_meshes(owner)
    return cached


def _mesh_hits(f: Face, o: Vector, d: Vector, reach: float, tol: float, meshes: dict[int, Any]) -> list[Vector]:
    """The points where the ray crosses the mesh of face ``f``, moved onto its exact surface."""
    from .mesh import _ray_triangles

    owner = f._owner
    if id(owner) not in meshes:
        # (the owner is kept: its id stays its own; its meshes are made once per body)
        meshes[id(owner)] = (owner, _body_face_meshes(owner))
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


class Problem(NamedTuple):
    """Something the kernel's validity checks find wrong with a body (see :meth:`Part.check`).

    Attributes:
        shape: The face, edge or vertex the problem is about, or the body itself.
        message: What is wrong, with the value measured and the tolerance where there are.
        value: The value measured (a gap, a distance, an angle), or ``None``.
        tolerance: The tolerance it was held against, or ``None``.
        category: The kind of test: ``"gap"``, ``"geometric"``, ``"topological"``,
            ``"values"``, ``"degenerate"``, ... (the kernel's SmAssertType).
        test: The test's short name (``"Bad Gap"``, ``"Bad Loop Connection Vertex"``).
        other: A second face, edge or vertex the test compared with, or ``None``.
    """

    shape: Any
    message: str
    value: float | None = None
    tolerance: float | None = None
    category: str = ""
    test: str = ""
    other: Any = None


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

    @property
    def radii_of_gyration(self) -> tuple[float, float, float]:
        """The radius of gyration about each principal axis, ``sqrt(moment / mass)``, in the order
        of :attr:`principal_moments`: the distance from the axis at which the whole mass would have
        the same moment of inertia."""
        return tuple(math.sqrt(max(m, 0.0) / self.mass) for m in self.principal_moments)  # type: ignore[return-value]

    def inertia_about(self, point: VectorLike) -> np.ndarray:
        """The inertia tensor about ``point`` (axes parallel to the world axes): :attr:`inertia`
        moved by the parallel-axis theorem, ``inertia + mass * (d.d * I - d d^T)`` with ``d`` from
        the center of mass to the point."""
        d = np.array(_vec(point).to_tuple()) - np.array(self.center.to_tuple())
        return self.inertia + self.mass * (d.dot(d) * np.eye(3) - np.outer(d, d))

    def moment_about(self, axis: Axis) -> float:
        """The moment of inertia about an axis (for example a shaft's axis or a pivot): ``n^T I n``
        with the inertia tensor about a point of the axis and its unit direction ``n``."""
        if not isinstance(axis, Axis):
            raise TypeError(f"moment_about takes an Axis, not a {type(axis).__name__}")
        n = np.array(axis.direction.normalized().to_tuple())
        return float(n @ self.inertia_about(axis.origin) @ n)

    def __repr__(self) -> str:
        c = self.center
        return (f"MassProperties(mass={self.mass:.6g}, volume={self.volume:.6g}, area={self.area:.6g}, "
                f"center=({c.x:.6g}, {c.y:.6g}, {c.z:.6g}))")


class SectionProperties:
    """Section properties of a planar region (see :meth:`Sketch.section_properties`): the area
    and the second moments of area of a profile, for beams, frames and extrusions.

    The moments are about the centroid, in the axes of :attr:`plane` (the sketch plane moved to
    the centroid): ``ixx = ∫ y² dA`` about its x axis, ``iyy = ∫ x² dA`` about its y axis and the
    product ``ixy = ∫ x y dA``, in mm⁴.
    """

    __slots__ = ("area", "centroid", "plane", "ixx", "iyy", "ixy", "_extent")

    def __init__(self, area: float, plane: Plane, ixx: float, iyy: float, ixy: float,
                 extent: tuple[float, float, float, float]):
        self.area = area
        self.centroid = plane.origin
        self.plane = plane
        self.ixx = ixx
        self.iyy = iyy
        self.ixy = ixy
        self._extent = extent  # min x, max x, min y, max y about the centroid, in the plane's axes

    @property
    def polar(self) -> float:
        """The polar moment about the centroid, ``ixx + iyy`` (the torsion constant only of a circle
        or a ring)."""
        return self.ixx + self.iyy

    @property
    def principal_moments(self) -> tuple[float, float]:
        """The second moments about the principal axes through the centroid, ascending."""
        m = (self.ixx + self.iyy) / 2
        r = math.hypot((self.ixx - self.iyy) / 2, self.ixy)
        return (m - r, m + r)

    @property
    def principal_axes(self) -> tuple[Vector, Vector]:
        """Unit directions (in world coordinates, in the plane) of the principal axes, in the
        order of :attr:`principal_moments`."""
        lo = self.principal_moments[0]
        # an eigenvector of [[ixx, -ixy], [-ixy, iyy]] for the smaller moment, and the one across it
        if abs(self.ixy) <= 1e-300:
            u = (1.0, 0.0) if self.ixx <= self.iyy else (0.0, 1.0)
        else:
            a = (self.ixy, self.ixx - lo)  # (ixx - lo) x - ixy y = 0
            b = (self.iyy - lo, self.ixy)  # -ixy x + (iyy - lo) y = 0
            u = a if math.hypot(*a) >= math.hypot(*b) else b
        first = (self.plane.x_dir * u[0] + self.plane.y_dir * u[1]).normalized()
        return (first, self.plane.z_dir.cross(first).normalized())

    @property
    def radii_of_gyration(self) -> tuple[float, float]:
        """``(sqrt(ixx / area), sqrt(iyy / area))``."""
        return (math.sqrt(max(self.ixx, 0.0) / self.area), math.sqrt(max(self.iyy, 0.0) / self.area))

    @property
    def section_moduli(self) -> tuple[float, float]:
        """The elastic section moduli ``(ixx / c_y, iyy / c_x)``, with ``c`` the distance from the
        centroid to the farthest fiber of the region across each axis (the smaller modulus of a
        section that is not symmetric)."""
        x0, x1, y0, y1 = self._extent
        return (self.ixx / max(-y0, y1), self.iyy / max(-x0, x1))

    def __repr__(self) -> str:
        c = self.centroid
        return (f"SectionProperties(area={self.area:.6g}, centroid=({c.x:.6g}, {c.y:.6g}, {c.z:.6g}), "
                f"ixx={self.ixx:.6g}, iyy={self.iyy:.6g}, ixy={self.ixy:.6g})")


class Part(_Body):
    """A solid: one or more closed volumes.

    Combine parts with ``+`` (union), ``-`` (difference) and ``&`` (intersection).
    The right-hand side may be a single part or any iterable of parts.
    """

    # _folds: the bends fold() and flange() made, with the K-factor each was made with, as
    # (axis origin, axis direction, inside radius, k_factor); unfold() takes them (sheetmetal.py).
    # Kept by the operations that keep the name and color (_like), moved with the part.
    __slots__ = ("_folds",)

    @classmethod
    def _wrap(cls, brep: Any, *args: Any, **kwargs: Any):  # type: ignore[no-untyped-def]
        b = super()._wrap(brep, *args, **kwargs)
        b._folds = ()
        return b

    def _like(self, brep: Any) -> Any:
        b = super()._like(brep)
        b._folds = self._folds
        return b

    def _transformed(self, m: np.ndarray) -> Any:
        b = super()._transformed(m)
        if self._folds:
            r = np.asarray(m, dtype=float)[:3, :3]
            scale = abs(float(np.linalg.det(r))) ** (1.0 / 3.0)
            moved = []
            for origin, direction, radius, kf in self._folds:
                o = np.asarray(m, dtype=float) @ np.array((*origin, 1.0))
                d = r @ np.array(direction)
                moved.append((tuple(float(x) for x in o[:3]), tuple(float(x) for x in d / np.linalg.norm(d)),
                              radius * scale, kf))
            b._folds = tuple(moved)
        return b

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
        if p.get("exhausted", -1) >= 0:
            _unmeasurable(self, int(p["exhausted"]))
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

    def is_valid(self, *, strict: bool = False) -> bool:
        """True if the part is a closed, manifold solid that encloses a positive volume and
        whose faces meet.

        (A body whose faces point inward, or that encloses no volume, such as a profile
        revolved about an axis through it, is not valid; nor is one whose faces leave gaps that
        make its volume uncertain by 1e-2 of its value or more.)

        With ``strict``, the kernel's own checks of each face, edge and vertex (:meth:`check`,
        all of them) must find nothing too: an imported, stitched or healed body can be closed
        and enclose its volume while its edges and vertices lie farther from its faces than
        their tolerances allow. (Of 1471 Boolean results of a random test campaign that
        ``is_valid()`` accepts, 34 fail the strict test.)
        """
        # (the checks first: measuring stores refitted trim curves in the body)
        if strict and self._brep.face_count() and self.check(2):
            return False
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
        """The separate bodies of this part: those that share no face, a body inside a cavity of
        another (a captive part) too. Cells of a merged part that touch stay one solid (see
        :meth:`merge`); a body keeps its cavities."""
        with kernel_call("solids"):
            parts = ext.separate_bodies(self._brep)
        out: ShapeList[Part] = ShapeList()
        for b in parts:
            out.extend(_islands(Part._wrap(b, name=self.name, color=self.color)))
        return out

    def shells(self) -> ShapeList[Shell]:
        """The closed sheets that bound the part, each a :class:`Shell` of copies of its faces
        (joined along their edges): first the outside of each solid, then the wall of each cavity
        (and the outside of a body that floats in one). For a part with a cavity, ``shells()[1]``
        is the cavity's wall: the faces to check the wall thickness on or to put a boundary
        condition on, which ``part.faces().derived_from(part.shells()[1])`` selects on the part
        itself. Faces between two cells of a merged part bound no space around it and lie in no
        shell (see :meth:`ShapeList.shared`)."""
        shells, _ = _shells_of(self)
        order = [s for s in shells if s["kind"] == "outside"] + [s for s in shells if s["kind"] == "void"]
        kfaces = self._brep.faces()
        out: ShapeList[Shell] = ShapeList()
        for s in order:
            with kernel_call("shells"):
                h = BrepHandle(ext.copy_faces(self._brep, [kfaces[i] for i in s["faces"]]))
                k.stitch_into_shell(h.brep)  # (the copies' edges joined again)
            out.append(Shell._wrap(_take(h)))
        return out

    def voids(self) -> ShapeList[Part]:
        """The cavities of the part (closed spaces inside it, kernel plan T7), each a part of its own:
        the space inside a cavity's wall, less a body that floats in it. With them the part fills
        its outside: ``part.volume + sum(v.volume for v in part.voids())``. Empty for a part without
        cavities. ``info()`` counts them."""
        with kernel_call("voids"):
            regions = ext.void_shells(self._brep)
        solids = [[Part._wrap(b) for b in shells] for shells in regions]
        out: ShapeList[Part] = ShapeList()
        for wall, *inside in solids:
            cavity = wall.cut(inside) if inside else wall
            problem = cavity._solid_problem()
            if problem is not None:
                raise ModelingError(f"voids: a cavity came out as a body that is {problem}")
            out.append(cavity)
        return out

    def info(self) -> dict[str, Any]:
        """Counts and measures in one dictionary: as for every body, and ``solids`` (how many
        :meth:`solids`) and ``voids`` (how many cavities, :meth:`voids`)."""
        out = super().info()
        shells, faces = _shells_of(self)
        cells = {s["cell"] for s in shells if s["kind"] == "cell"}
        root = {c: c for c in cells}

        def find(c: int) -> int:
            while root[c] != c:
                root[c] = root[root[c]]
                c = root[c]
            return c

        for between in faces:  # cells that share a face are one solid
            for c in between[1:]:
                root[find(c)] = find(between[0])
        out["solids"] = len({find(c) for c in cells})
        out["voids"] = len({s["region"] for s in shells if s["kind"] == "void"})
        return out

    def merge(self, *others: Part | Sequence[Part]) -> Part:
        """This part and others as one part made of cells. Where parts overlap, the overlap becomes
        a cell of its own; cells that touch share the faces between them (each such face bounds
        two cells: the body is non-manifold). For simulation meshes that must match across
        materials, and for models of several materials.

        ``cells()`` gives the cells as parts of their own, each named and colored after the parts it
        lies in (``cell.sources``); ``volume`` is the volume of the union. A merged part is not a
        manifold solid: ``is_valid()`` is False, and Booleans, fillets and shells take its cells
        rather than the part itself. ``export_step`` writes each cell as a solid of its own, with
        its name and color.

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
        merged._h.merged = {"parts": (self, *tools), "placement": np.eye(4), "cells": None}
        return merged

    @property
    def sources(self) -> tuple[Part, ...]:
        """For a cell of a merged part (see :meth:`cells`): the parts given to :meth:`merge` whose
        material it lies in, in the order they were given (a cell where two parts overlap lies in
        both; a part that was itself merged stands for the parts it was merged from). They are the
        parts as given, not moved along with the merged part. Empty for other parts."""
        return tuple(self._h.sources or ())

    def cells(self) -> ShapeList[Part]:
        """The cells of a part made by :meth:`merge`, each as a part of its own (every closed region
        of the body; a cavity is not a cell). A part that is one solid: ``[itself]``.

        Each cell is named and colored after the parts given to merge that it lies in (its
        :attr:`sources`): the names joined by ``&`` (``"steel&brass"`` where a steel and a brass
        part overlap), the color of the last of them that has one; the merged part's own name and
        color where none of them has one. The kernel keeps no record of the parts: smlibpy
        classifies a point inside each cell against them.

        The kernel's stitcher runs in another process (see ``smlibpy.defeature.GUARD_SECONDS``): it
        crashed on some merges (a null polar box, patched in 0.5.0); a crash there raises
        :class:`KernelError`."""
        d = ext.brep_dump(self._brep, False)
        if sum(1 for r in d["regions"] if not r["infinite"] and not r["void"]) <= 1:
            return ShapeList([self])
        from ._guard import isolated

        with kernel_call("cells"):
            # (in another process: the kernel's stitcher crashed on some merges)
            regions = isolated("cells", _region_shells_step, self._brep)
        solids = [[Part._wrap(b, name=self.name, color=self.color) for b in shells] for shells in regions]
        try:
            sources = _cell_sources(self, solids)
        except (ModelingError, ValueError):  # (the cells still come, named as the merged part)
            sources = None
        touching = ("an insert that touches the part around it at a point or along a line can do this: move it "
                    "off the wall or into it")
        out: ShapeList[Part] = ShapeList()
        for outer, *cavities in solids:
            try:
                part = outer.cut(cavities) if cavities else outer
            except ModelingError as e:
                # (the cut's own hint is about tools, which the user did not give)
                why = f"the kernel's cut failed ({e.status})" if isinstance(e, KernelError) and e.status else \
                    "the kernel's cut failed" if isinstance(e, KernelError) else "the kernel's cut returned no sound solid"
                gap = 1e-6 * max(outer._extent(), 1.0)
                insert = next((c for c in cavities if outer.distance_to(c) <= gap), None)
                if insert is not None:
                    c = insert._loose_box().center
                    where = (f"the insert at ({c.x:.4g}, {c.y:.4g}, {c.z:.4g}) touches the part around it at a point or "
                             f"along a line: move it off the wall or into it")
                else:
                    where = touching
                raise ModelingError(f"cells: the cells inside a cell could not be cut out of it ({why}); {where}") from e
            try:
                part._props()  # measured for the sum below, so that the check sees the gaps too
                problem = part._solid_problem()
            except KernelError:
                problem = "a body whose volume cannot be integrated"
            if problem is not None:
                raise ModelingError(f"cells: a cell is not a sound solid ({problem})")
            if sources is not None:
                part._h.sources = sources[len(out)]
                part.name, part.color = _source_label(sources[len(out)], self.name, self.color)
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
        result = self._combined(tools, op, name)
        if op != k.BooleanOp.DIFFERENCE and isinstance(result, Part):
            # A union or an intersection holds the bends of its tools too: their K-factor records
            # (fold, flange) go with the result as the part's do.
            folds = list(result._folds)
            for t in tools:
                folds += [f for f in getattr(t, "_folds", ()) if f not in folds]
            result._folds = tuple(folds)
        return result

    def _combined(self, tools: list[Any], op: Any, name: str) -> Part:
        """The Boolean of :meth:`_boolean`, checked, retried and explained."""
        for t in tools:
            if isinstance(t, Sketch) or not isinstance(t, (Part, Shell)):
                kind = type(t).__name__
                extra = "; extrude it first" if isinstance(t, Sketch) else ""
                raise TypeError(f"cannot {name} a {kind} with a Part{extra}")
        if not all(isinstance(t, Part) for t in tools):
            # A sheet encloses no volume: the kernel's Boolean of a part and a sheet imprints the
            # sheet or keeps a piece of it, in a body that is no solid.
            if op == k.BooleanOp.INTERSECTION and len(tools) == 1:
                return tools[0] & self  # the piece of the sheet inside the part
            kind = next(type(t).__name__ for t in tools if not isinstance(t, Part))
            raise TypeError(f"cannot {name} a {kind} with a Part: a sheet encloses no volume; to split the part "
                            f"along it use part.split(sheet), to cut its outline into the part's faces "
                            f"part.imprint(sheet), to trim the sheet sheet - part or sheet & part")
        try:
            result: Part | None = self._like(self._run_boolean(tools, op, name))
            failure: KernelError | None = None
            problem = self._boolean_problem(result, tools, op)
        except KernelError as e:
            result, failure, problem = None, e, None
        if result is not None and problem is None:
            return result
        if len(tools) == 1:
            retry = self._nurbs_retry(tools, op, name)
            if retry is None:
                retry = self._seam_retry(tools, op, name)
            if retry is None:
                retry = self._swapped_retry(tools[0], op, name)
            if retry is not None:
                return retry
        else:
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
            retry = self._nurbs_retry(tools, op, name)
            if retry is None:
                retry = self._seam_retry(tools, op, name)
            if retry is not None:
                return retry
        broken = [x for x in (self, *tools) if x._solid_problem() is not None]
        if broken:
            which = "the part" if broken[0] is self else "a tool"
            raise ModelingError(f"{name}: {which} is not a valid solid ({broken[0]._solid_problem()}); check "
                                f"is_valid() of the operands and fix the step that broke them")
        hint = self._boolean_hint(tools, op, name, failure)
        if failure is not None:
            raise _traced(KernelError(failure.operation, failure.detail, failure.status, hint), failure) from failure
        raise ModelingError(f"{name}: the kernel returned a result that is {problem}; {hint}")

    def _boolean_hint(self, tools: Sequence[Part], op: Any, name: str, failure: KernelError | None) -> str:
        """What a Boolean that failed says, from what the operands show (kernel plan B19): that the
        kernel crashed or failed inside (a null pointer of its own); that a tool runs beside a
        parallel hole or boss of the part (the B10 case the NURBS retry did not save), which the
        tools of both cuts combined avoid; that a face of a tool lies on a face of the part; that
        several tools were also tried combined; that the operands only touch (no point of the mesh of
        one lies inside the other), or that a round face of a tool touches a face of the part
        tangentially; that a seam of an operand touches a face of the other at a point (kernel plan
        B6). With none of these, that none of them shows."""
        clauses = []
        crash = _crash_note(failure, name)
        if crash is not None:
            clauses.append(f"{crash}, a defect of the kernel rather than of the operands; moving or turning a tool "
                           f"a little may avoid it")
        near = [t for t in tools if not _disjoint(self._loose_box(), t._loose_box(), 1e-6 * self._extent())]
        contacts = [_surface_contacts(self, t) for t in near]
        if any(c["beside"] for c in contacts):
            clauses.append("a tool runs beside a parallel hole or boss of the part and overlaps it (smlibpy tried it "
                           "again as a NURBS copy, which failed too): combine the tools first and apply them at "
                           "once, this one and the one that made that hole or boss: part - (tool1 + tool2)")
        # (points classified, not the meshes' Boolean: that crashes on meshes of tangent cylinders)
        touching = crash is None and any(_classified_empty(self, [t], k.BooleanOp.INTERSECTION) for t in near)
        if touching:
            clauses.append("the operands touch only along an edge, at a point or tangentially (no point of one lies "
                           "inside the other): move one so they overlap, or apart")
        else:
            tangent = next((c["tangent"] for c in contacts if c["tangent"]), None)
            if tangent is not None:
                clauses.append(f"a round face of a tool touches a face of the part tangentially ({tangent}): move the "
                               f"tool so that it cuts into that face, or stays clear of it")
        coincident = next((c["coincident"] for c in contacts if c["coincident"]), None)
        if coincident is not None:
            clauses.append(f"a face of a tool lies on a face of the part ({coincident}): let the tool reach past "
                           f"that face, or stop short of it")
        seam = next((p for t in near if isinstance(t, Part) for a, b in ((self, t), (t, self))
                     for _, _, p in ext.seam_touches(a._brep, b._brep)), None)
        if seam is not None:
            clauses.append(f"the seam of a closed face of an operand (where its surface meets itself) touches a face of "
                           f"the other at a point (near {_fmt_point(Vector(seam))}), where the kernel's Boolean goes "
                           f"wrong (smlibpy moves such seams where it can, not a torus' outer equator or the seam of a "
                           f"free-form face): move or turn the tool a little")
        if len(tools) > 1:
            clauses.append("smlibpy also applied the tools combined into one, which failed too: apply them one at a "
                           "time to find the one that fails")
        if not clauses:
            clauses.append("the operands neither only touch, nor have faces on or tangent to each other, nor is a "
                           "tool beside a parallel hole; move or turn a tool a little, and check "
                           "is_valid(strict=True) of the operands")
        return "; ".join(clauses)

    def _nurbs_retry(self, tools: Sequence[Part], op: Any, name: str) -> Part | None:
        """The Boolean again with a NURBS copy of each tool that has a cylinder or cone parallel
        to one of the part (or of an earlier tool), off its axis, where their faces overlap: a
        tool beside an earlier hole or boss (kernel plan B10). The kernel fails there with the
        analytic tool and gets the right body with the NURBS one, whose faces come back analytic.
        None where no tool is such a tool, or the retry fails or is wrong too."""
        nurbs = [any(_parallel_rounds(x, t) for x in (self, *tools[:i])) for i, t in enumerate(tools)]
        if not any(nurbs):
            return None
        try:
            retry = self._like(self._run_boolean([t.to_nurbs() if n else t for t, n in zip(tools, nurbs)], op, name))
            if self._boolean_problem(retry, tools, op) is not None or _volume_problem(retry, self, tools, op):
                return None
        except KernelError:
            return None
        return retry

    def _seam_retry(self, tools: Sequence[Part], op: Any, name: str) -> Part | None:
        """The Boolean again with a NURBS copy of each operand whose seam touches another at a point
        (``ext.seam_touches``): ``ext.boolean`` moves such a seam on a copy whose faces it recognizes
        as cylinders, cones, spheres or tori again, which a hole's seam that no turn moves can need
        (kernel plan B6; the result's faces come back analytic). Checked as the first try, and
        against the operands' volume bounds. None where no seam touches, or the retry fails or is
        wrong too."""
        if not self._brep.is_manifold_solid() or not all(isinstance(t, Part) and t._brep.is_manifold_solid()
                                                          for t in tools):
            return None
        mine = any(ext.seam_touches(self._brep, t._brep) for t in tools)
        theirs = [bool(ext.seam_touches(t._brep, self._brep)) for t in tools]
        if not mine and not any(theirs):
            return None
        try:
            part = self.to_nurbs() if mine else self
            retry = self._like(part._run_boolean([t.to_nurbs() if n else t for t, n in zip(tools, theirs)], op, name))
            if self._boolean_problem(retry, tools, op) is not None or _volume_problem(retry, self, tools, op):
                return None
        except KernelError:
            return None
        return retry

    def _swapped_retry(self, tool: Part, op: Any, name: str) -> Part | None:
        """A union or an intersection again with the operands the other way round, which the kernel
        can get right where it failed or took one operand for inside the other; checked as the
        first try, against the operands' volume bounds and as ``is_valid()`` checks (the gaps
        between its faces: the other way round, the kernel can also return a body that is open).
        None for a cut, or where the retry fails or is wrong too."""
        if op not in (k.BooleanOp.UNION, k.BooleanOp.INTERSECTION):
            return None
        try:
            retry = self._like(tool._run_boolean([self], op, name))
            if self._boolean_problem(retry, [tool], op) is not None or _volume_problem(retry, self, [tool], op) \
                    or (retry._brep.face_count() and retry._solid_problem() is not None):
                return None
        except KernelError:
            return None
        return retry

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
                else:
                    problem = _union_or_cut_problem(result, self, tools, op)
                if problem is None:
                    problem = _seam_problem(result, self, tools, op)
                if problem is None:
                    result._h.sound = _TRUSTED
                return problem
            return problem or result._solid_problem()
        if op == k.BooleanOp.UNION:
            return "empty"
        if op == k.BooleanOp.INTERSECTION:
            if len(tools) > 1:
                return None  # the common volume of several tools may well be empty
            if _disjoint(self._loose_box(), tools[0]._loose_box()):
                return None
            return None if _empty_is_right(self, tools, op) else "empty"
        # The tools must be able to cover the part, and the part's mesh must have nothing left
        # outside theirs. (An intersection of the part and a tool, which confirmed an empty cut
        # before, can fail the same way as the cut: a tool beside an earlier hole in a sphere
        # made the cut empty and the intersection the whole part.)
        if not _can_cover(tools, self):
            return "empty"
        tools = [t for t in tools if not _disjoint(t._loose_box(), self._loose_box())]
        return None if tools and _empty_is_right(self, tools, op) else "empty"

    def fuse(self, *others: Part | Iterable[Part]) -> Part:
        """Union with other parts."""
        return self._boolean(others, k.BooleanOp.UNION, "fuse")

    def cut(self, *others: Part | Iterable[Part]) -> Part:
        """Subtract other parts."""
        return self._boolean(others, k.BooleanOp.DIFFERENCE, "cut")

    def intersect(self, *others: Part | Iterable[Part]) -> Part:
        """Keep only the volume shared with the other parts. With one sheet (a Shell or a face)
        instead: the piece of the sheet inside the part, as a Shell (``sheet & part``)."""
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
        """Kernel edges of this part for the given edge selection. An edge of an earlier version
        of the part stands for the edges of this one that descend from it (the pieces a cut
        left of it, the edge it was merged into); one of a body this part does not descend from,
        for the edge in the same place."""
        sel = _flatten_edges(edges)
        out: list[Any] = []
        candidates: list[tuple[Any, Vector, Vector, Vector]] | None = None
        tol = 1e-6 * max(1.0, self.bbox().diagonal)
        foreign = [e for e in sel if not (e._e is not None and e._owner is not None and e._owner._h is self._h)]
        mapped = dict(zip(map(id, foreign), _descendants(self, foreign, faces=False))) if foreign else {}
        for e in sel:
            if e._e is not None and e._owner is not None and e._owner._h is self._h:
                out.append(e._e)
                continue
            if mapped.get(id(e)):
                out.extend(mapped[id(e)])
                continue
            # An edge of another body: match by geometry.
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
        return list({id(x): x for x in out}.values())

    def _own_faces(self, faces: Any) -> list[Any]:
        """Kernel faces of this part for the given face selection: as :meth:`_own_edges`."""
        sel = _flatten_faces(faces)
        out: list[Any] = []
        tol = 1e-6 * max(1.0, self.bbox().diagonal)
        own_faces: list[Face] | None = None
        foreign = [f for f in sel if not (f._owner is not None and f._owner._h is self._h)]
        mapped = dict(zip(map(id, foreign), _descendants(self, foreign, faces=True))) if foreign else {}
        for f in sel:
            if f._owner is not None and f._owner._h is self._h:
                out.append(f._f)
                continue
            if mapped.get(id(f)):
                out.extend(mapped[id(f)])
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
        return list({id(x): x for x in out}.values())

    def _resolved(self, edges: Any, sizes: list[float] | None = None) -> tuple[list[Edge], list[float] | None]:
        """A selection of edges as edges of this part: an edge of an earlier version of the part
        becomes the edges that descend from it (its pieces, the edge it was merged into), with
        its entry of ``sizes`` (one per selected edge) repeated for each; one of a body this part
        does not descend from, the edge in the same place (see :meth:`_own_edges`). The checks of
        fillets and chamfers then measure the edges that are rounded."""
        sel = _flatten_edges(edges)
        if all(e._e is not None and e._owner is not None and e._owner._h is self._h for e in sel):
            return sel, sizes
        out: list[Edge] = []
        grown: list[float] = []
        for i, e in enumerate(sel):
            mine = [Edge._of(self, ke) for ke in self._own_edges([e])]
            out.extend(mine)
            if sizes is not None and len(sizes) == len(sel):
                grown.extend([sizes[i]] * len(mine))
        return out, (grown if sizes is not None and len(sizes) == len(sel) else sizes)

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

    def _check_round_sizes(self, edges: list[Edge], setbacks: Sequence[float | dict[Any, float]], what: str,
                           size_name: str) -> float:
        """Reject rounds that cannot fit: on a face, two edges running alongside each other
        must be further apart than their setbacks. (The kernel does not always notice and
        may return an invalid solid.) A setback is one for both faces of an edge, or one per face
        (a dict by the face's identity: an asymmetric chamfer). Returns how much of the room the
        setbacks take where they come closest (0 where no edges run alongside): above
        ``_NEAR_LIMIT`` the result's gaps are measured (see :meth:`_check_volume_change`)."""
        def on(setback: float | dict[Any, float], f: Face) -> float:
            return setback.get(f._identity(), max(setback.values())) if isinstance(setback, dict) else setback

        setback_of = {e._identity(): s for e, s in zip(edges, setbacks)}
        fill = 0.0
        for e, s in zip(edges, setbacks):
            ends = {v._identity() for v in e.vertices()}
            samples = [e.point_at(t) for t in (0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0)]
            for f in e.faces():
                for g in f.edges():
                    if g._identity() == e._identity() or ends & {v._identity() for v in g.vertices()}:
                        continue  # the same edge, or a neighbour meeting it at a corner
                    total = on(s, f) + (on(setback_of[g._identity()], f) if g._identity() in setback_of else 0.0)
                    try:
                        dists = [_distance_to_edge(g, p) for p in samples]
                    except RuntimeError:
                        continue  # the kernel finds no closest point on the edge: no check here
                    near = min(dists)
                    if max(dists) > 1.5 * max(near, 1e-12):
                        continue  # not running alongside
                    fill = max(fill, total / max(near, 1e-12))
                    if near >= total - 1e-9:
                        continue  # far enough
                    limit = near / 2 if g._identity() in setback_of else near
                    raise ModelingError(
                        f"{what}: the {size_name} is too large; the rounds on edges {near:.4g} apart would "
                        f"overlap (largest possible setback here: {limit:.4g})")
        return fill

    @staticmethod
    @contextlib.contextmanager
    def _rounding(what: str, hint: str, sel: list[Edge], propagate: bool) -> Iterator[None]:
        """:func:`_round_call` for a fillet or chamfer of ``sel``. Without ``propagate``, a failure
        names a selected edge that runs on tangentially into an edge that is not selected, if there
        is one: the kernel cannot always round such an edge alone (a top edge of a plate with
        rounded corners, at any radius), and its own status says nothing about it."""
        try:
            with _round_call(what, hint):
                yield
        except KernelError as e:
            better = None if propagate else _run_on_hint(sel, what)
            if better is None:
                raise
            raise _traced(KernelError(e.operation, e.detail, e.status, better), e) from e

    @staticmethod
    def _check_radius_law(edges: list[Edge], chains: list[list[int]], varies: bool) -> None:
        """A radius law runs along each chain of edges that meet tangentially (``_law_chains``). Refuse
        what it cannot: a varying law around a closed chain of several edges (the kernel builds broken
        rounds there; around a single closed edge it is right), and selected edges of different chains
        that run into each other tangentially (the kernel gives their rounds one radius where they meet
        and bends both laws to it)."""
        at: dict[Vertex, list[tuple[int, Vector]]] = {}  # vertex (kept, so its identity stays) -> (chain,
        #                                                   direction) of the edges there
        chain_of = {i: c for c, chain in enumerate(chains) for i in chain}
        for c, chain in enumerate(chains):
            if varies and len(chain) > 1 and _closed_chain([edges[i] for i in chain]):
                e = edges[chain[0]]
                raise ValueError(
                    f"fillet: a radius that varies around a closed run of {len(chain)} edges (through "
                    f"{_fmt_point(e.start)}) is not possible: the kernel builds broken rounds there; vary it along "
                    f"an open run or around a single closed edge, or give a constant radius")
        for i, e in enumerate(edges):
            if e.is_closed:
                continue
            for v in e.vertices():
                p = v.point
                d = e.tangent_at(0.0 if (p - e.start).length <= (p - e.end).length else 1.0)
                for c2, d2 in at.get(v, []):
                    a = d.angle_to(d2)
                    if c2 != chain_of[i] and min(a, 180.0 - a) < _FILLET_TANGENT_DEG:
                        raise ValueError(
                            f"fillet: a varying radius runs along each run of edges that meet tangentially, and two "
                            f"selected edges of different runs meet tangentially at {_fmt_point(p)}, where the kernel "
                            f"would bend both laws to one radius; give a constant radius there")
                at.setdefault(v, []).append((chain_of[i], d))

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
                             shape: str, corner_volume: float = 0.0, near_limit: bool = False) -> None:
        """Check a fillet or chamfer result: a valid solid whose volume changed in the right
        direction and by no more than the rounds can take away or add.

        ``sizes`` are the radii (``shape`` "circular" or "blend") or the setbacks
        (``shape`` "chamfer"). Near the size limit the kernel can return a valid-looking
        body with whole regions missing. ``corner_volume``: what set-back corners can take away or
        add on top. With ``near_limit`` (rounds that fill most of the room between two edges, see
        :meth:`_check_round_sizes`) the gaps between the result's faces are measured too: there
        SM_API's tolerance can leave its rounds open (a 20 mm cube rounded by 9.97 came out with
        gaps of 4e-2 of its volume on Linux x86_64), which only that measure sees.
        """
        size = sizes[0] if len(set(sizes)) == 1 else max(sizes)
        bound = _round_volume_bound(edges, sizes, shape)
        if bound is not None:
            bound += corner_volume
        accuracy = 1e-6 if bound is not None else 1e-4  # the bound needs the change accurately
        before = after = None
        problem = result._shape_problem()
        if problem is None:
            try:
                before = self._kernel_props(accuracy)["volume"]
                after = result._kernel_props(accuracy)["volume"]
            except KernelError:
                pass
            problem = result._solid_problem(after, gaps=near_limit)  # integrates once more only if that failed
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
        radius: float | tuple[float, float] | Sequence[float] | dict[float, float],
        *,
        continuity: int | str | None = None,
        fullness: float = 1.0,
        propagate: bool = True,
        corners: str = "patch",
        setback: float | None = None,
    ) -> Part:
        """Round edges.

        Args:
            edges: Edges of this part (a selection, a single edge, or faces whose edges
                to round).
            radius: Fillet radius. A ``(start, end)`` tuple varies the radius linearly along
                each run of selected edges that meet tangentially (a single edge, or a chain such
                as the outline of a rounded plate, with ``propagate``: :meth:`Edge.tangent_chain`),
                in proportion to the length along it. A run goes the way of its first selected edge
                (from that edge's start to its end) and starts at the end of the run that way
                starts from; a closed run cannot take different ``start`` and ``end`` radii. A dict
                ``{position: radius}`` sets the radius at positions along each run (0 its start, 1
                its end; a missing 0 or 1 takes the nearest radius given) and joins them smoothly,
                without overshooting them (flat at the ends and at each largest and smallest
                radius); around a closed run its radius at 1 must be the one at 0, and it can vary
                around a single closed edge only (a rim), not around a closed run of several edges.
                A varying radius makes circular rounds only. A list with one radius per edge rounds
                edges differently.
            continuity: ``None`` for a circular fillet. ``"G2"`` or ``"G3"`` make a
                curvature-continuous blend (``"G1"`` a tangent blend) instead of a circular
                arc: no visible highlight seam, as used for consumer and Class-A surfaces.
            fullness: Shape of a blend cross-section; above 1 fuller, below 1 flatter.
            propagate: Round the edges that continue the selected ones tangentially too
                (:meth:`Edge.tangent_chain`): one top edge of a plate with rounded corners
                rounds the whole outline. An added edge takes the radius of the selected edge
                it continues. ``False`` rounds the selected edges only; where the kernel then
                fails, the error names a selected edge that runs on tangentially into one that is
                not selected (the kernel cannot always round such an edge alone).
            corners: Where three rounded edges meet: ``"patch"`` joins their rounds with a corner
                patch (a ball corner where the radii are equal); ``"mitre"`` runs the rounds on
                until they meet each other, along mitre lines without a patch (the look of a
                machined part). Mitred are the corners where three rounded convex edges meet and
                no other edge; a selection without such a corner raises ``ValueError``.
            setback: Set the corners back: the rounds stop ``setback`` from the corner along each of
                its edges, and one larger patch joins them there (a softer corner than the ball
                corner, as on molded and consumer parts). Set back are the corners where three or
                more rounded edges meet and no other edge (every edge at the vertex rounded), all
                convex (the outside corners of a box) or all concave (the floor corners of a
                pocket); the others get their usual patch, and a selection without such a corner
                raises ``ValueError``. ``setback`` must exceed how far the rounds reach along the
                corner's edges (the radius, at a right-angled corner) and stay below the length of
                each rounded edge at such a corner (half of it where both ends are set back).
                Constant radii only (also one per edge, and blends), not with ``corners="mitre"``.
                Corners between slanted faces (the top corners of a frustum) the kernel cannot
                always set back: :class:`KernelError`.

        Where three rounds meet, the corner patch is tangent continuous (G1) only, also with
        ``continuity="G2"`` or ``"G3"``: zebra stripes kink there (the kernel's corner patches
        are G1 whatever the continuity of the rounds).

        A round the kernel cannot build raises :class:`KernelError` naming the corner or edge its
        fillet code could not build, where it recorded one.

        The kernel step of a part read from a file (``import_step``, ``load``, ``import_usd``) or
        made from one runs in another process (see ``smlibpy.defeature.GUARD_SECONDS``): the
        kernel's fillet code crashed on some imported parts.
        """
        self._require_valid("fillet")
        mitre = _corner_style("fillet", corners)
        law_at: list[float] = []
        law_radii: list[float] = []
        if isinstance(radius, dict):
            law_at, law_radii = _radius_law(radius)  # (filled again below, around closed runs)
            given = law_radii
        else:
            given = [float(r) for r in (radius if isinstance(radius, (tuple, list, np.ndarray)) else [radius])]
        if any(not r > 0 for r in given):
            raise ValueError("fillet: the radius must be positive")
        law = isinstance(radius, dict) or isinstance(radius, tuple) and len(radius) == 2
        varies = law and max(given) != min(given)
        if varies and continuity is not None:
            # the kernel makes a ruled chamfer of it, not tangent to the faces
            raise ValueError("fillet: a varying radius ((start, end) or {position: radius}) makes circular rounds "
                             "only; continuity needs a constant radius")
        if isinstance(radius, (list, np.ndarray)):
            edges, sizes = self._resolved(edges, [float(r) for r in radius])
            radius = sizes
        else:
            edges, _ = self._resolved(edges)
        sel = self._sharp_edges(edges, "fillet")
        per_edge: list[float] | None = None
        if isinstance(radius, (list, np.ndarray)):
            per_edge = [float(r) for r in radius]
            if len(per_edge) != len(sel):
                raise ValueError(f"{len(per_edge)} radii for {len(sel)} edges")
        sel, src = _tangent_chains(sel) if propagate else (sel, list(range(len(sel))))
        if per_edge is not None:
            per_edge = [per_edge[i] for i in src]
        chains: list[list[int]] = []
        if varies:
            chains = _law_chains(sel)
            if not law_at:
                for chain in chains:
                    if _closed_chain([sel[i] for i in chain]):
                        e = sel[chain[0]]
                        raise ValueError(
                            f"fillet: a (start, end) radius cannot run around a closed "
                            f"{'edge' if e.is_closed else 'run of edges'} (through {_fmt_point(e.start)}): it "
                            f"would jump back to the start radius there; give a constant radius, or "
                            f"{{position: radius}} with one radius at 0 and 1")
            else:
                assert isinstance(radius, dict)
                kinds = {_closed_chain([sel[i] for i in chain]) for chain in chains}
                laws = {kind: _radius_law(radius, kind) for kind in kinds}
                if len({tuple(map(tuple, law)) for law in laws.values()}) > 1:
                    raise ValueError("fillet: the selection has open and closed runs of edges, which take a missing "
                                     "radius at position 0 or 1 differently; give both")
                law_at, law_radii = next(iter(laws.values()))
                if True in laws and law_radii[0] != law_radii[-1]:
                    chain = next(c for c in chains if _closed_chain([sel[i] for i in c]))
                    e = sel[chain[0]]
                    raise ValueError(
                        f"fillet: around a closed {'edge' if e.is_closed else 'run of edges'} (through "
                        f"{_fmt_point(e.start)}) the radius at position 1 is the one at 0 (where it starts and "
                        f"ends); give them alike ({law_radii[0]:g} and {law_radii[-1]:g})")
            self._check_radius_law(sel, chains, True)
        if law:
            radii = [max(given)] * len(sel)
            if not varies:
                radius = given[0]  # (a constant law: a constant radius)
        elif per_edge is not None:
            radii = per_edge
        else:
            radii = [float(radius)] * len(sel)
        near_limit = self._check_round_sizes(sel, [self._setback(e, r) for e, r in zip(sel, radii)], "fillet",
                                             "radius") > _NEAR_LIMIT
        if mitre:
            _require_mitred_corners("fillet", sel)
        set_back = 0.0
        corner_volume = 0.0
        if setback is not None:
            set_back = float(setback)
            if not (math.isfinite(set_back) and set_back > 0):
                raise ValueError(f"fillet: the setback must be positive, not {setback!r}")
            if mitre:
                raise ValueError('fillet: a corner is mitred (corners="mitre") or set back (setback=), not both')
            if varies:
                raise ValueError("fillet: set-back corners join rounds of a constant radius; give a constant radius "
                                 "(one, or one per edge) with setback")
            corner_volume = _check_set_back_corners(sel, radii, set_back)
        cont = _continuity(continuity)
        hint = "the radius may be too large for the selected edges"
        if set_back:
            hint += (f", or the kernel cannot set back these corners by {set_back:.4g} (corners between slanted faces "
                     f"it often cannot; try another setback, or none)")
        section = 1 if cont is None else 2  # circular, or a blend curve

        def attempt(factor: float) -> Part:
            h, kedges = self._with_edges(sel)
            isolate = self._h.imported
            with self._rounding("fillet", hint, sel, propagate):
                if varies and law_at:
                    out = _round_edges("fillet", hint, h.brep, kedges, sel, [law_radii[0]], [section],
                                       chains=chains, law_at=law_at, law_radii=law_radii, continuity=cont or 1,
                                       tolerance_factor=factor, mitre=mitre, isolate=isolate)
                elif varies:
                    assert isinstance(radius, tuple)
                    out = _round_edges("fillet", hint, h.brep, kedges, sel, [float(radius[0])], [section],
                                       law=(float(radius[0]), float(radius[1])), chains=chains,
                                       continuity=cont or 1, tolerance_factor=factor, mitre=mitre, isolate=isolate)
                elif per_edge is not None:
                    out = _round_edges("fillet", hint, h.brep, kedges, sel, per_edge, [section] * len(kedges),
                                       continuity=cont or 1, thumbweight=fullness, tolerance_factor=factor,
                                       mitre=mitre, isolate=isolate, setback=set_back)
                else:
                    out = _round_edges("fillet", hint, h.brep, kedges, sel, [float(radius)], [section],
                                       continuity=cont or 1, thumbweight=fullness, tolerance_factor=factor,
                                       mitre=mitre, isolate=isolate, setback=set_back)
            # (a step that ran in this process rounded the copy h holds: h gives it up; one from another
            # process is a Brep of its own, and h frees its copy)
            result = self._like(_take(h) if out is h.brep else out)
            try:
                self._check_volume_change(result, sel, "fillet", radii, "circular" if cont is None else "blend",
                                          corner_volume, near_limit)
            except KernelError as e:
                if not set_back:
                    raise
                raise _traced(KernelError(e.operation, e.detail, e.status, hint), e) from e
            if varies or set_back:
                # (a varying radius or set-back corners: the faces must meet too; the kernel's broken variable
                # rounds look closed)
                problem = result._solid_problem(gaps=True)
                if problem is not None:
                    raise KernelError("fillet", f"kernel result is {problem}", None,
                                      f"the radius may be too large for the selected edges (it is up to "
                                      f"{max(given):.4g})" if not set_back else hint)
            return result

        return _with_finer_rounds(attempt)

    def fillet_preview(self, edges: Any, radius: float, *, propagate: bool = True) -> ShapeList[Shell]:
        """The surfaces of the rounds a fillet of ``edges`` with ``radius`` would make, as sheets, without
        rounding the part: one per edge, untrimmed (each runs along its whole edge, before the corners are
        made and the rounds trimmed to meet). For a quick look at a fillet before making it (show them with
        the part), or to see where its rounds would run. Circular rounds of one radius, the kernel's
        preview (``SmApiFilletPreview``); the part does not change.

        ``edges`` and ``propagate`` select as for :meth:`fillet`. A selection the kernel cannot round at
        any size raises :class:`KernelError`, as :meth:`fillet` does; a preview that succeeds does not
        promise that the fillet will (its corners and trims are not made). The kernel step of a part read
        from a file runs in another process, as for :meth:`fillet`.
        """
        from ._guard import isolated

        self._require_valid("fillet_preview")
        r = float(radius)
        if not (math.isfinite(r) and r > 0):
            raise ValueError("fillet_preview: the radius must be positive")
        edges, _ = self._resolved(edges)
        sel = self._sharp_edges(edges, "fillet_preview")
        if propagate:
            sel = _tangent_chains(sel)[0]
        h, kedges = self._with_edges(sel)
        hint = "the radius may be too large for the selected edges"
        with _round_call("fillet_preview", hint):
            if self._h.imported:
                sheets = isolated("fillet_preview", _preview_step, hint, h.brep, kedges, r)
            else:
                sheets = _preview_step(hint, h.brep, kedges, r)
        return ShapeList(Shell._wrap(b, name=self.name, color=self.color) for b in sheets)

    def chamfer(self, edges: Any, length: float, *, length2: float | None = None, angle: float | None = None,
                reference: Any = None, propagate: bool = True, corners: str = "patch") -> Part:
        """Bevel edges. ``length`` is the setback measured along both adjacent faces.

        An asymmetric bevel: ``length2`` is the setback on the other face of each edge, ``length`` the one
        on its ``reference`` face; or ``angle`` (degrees) is the angle between the bevel and the reference
        face (``length2`` follows from it: ``length * tan(angle)`` where the faces meet at 90 degrees).
        ``reference`` is a face of this part (or several) that each edge lies on; ``length2`` and ``angle``
        need it. Where the faces meet at an acute angle and the setbacks are less alike than its cosine, the
        kernel's solver cannot reach the bevel: a straight edge between planes whose ends lie on planes at
        right angles to it is then bevelled by cutting the bevel's prism along it; other such edges raise
        :class:`ModelingError`.

        The faces of each edge must meet at the same angle all along it (within 1 degree); where they
        do not (a hole into a tilted or curved face), use ``fillet``.

        ``propagate`` bevels the edges that continue the selected ones tangentially too
        (:meth:`Edge.tangent_chain`), as :meth:`fillet` does; ``False`` bevels the selected edges
        only. The edges a run adds must lie on a reference face too.

        ``corners`` sets the corners where three bevelled edges meet, as for :meth:`fillet`:
        ``"patch"`` cuts them off with a corner face, ``"mitre"`` runs the bevels on until they meet
        (the corners of three bevelled convex edges and no other edge).
        """
        self._require_valid("chamfer")
        mitre = _corner_style("chamfer", corners)
        length = float(length)
        if not length > 0:
            raise ValueError("chamfer: the length must be positive")
        if length2 is not None and angle is not None:
            raise ValueError("chamfer: give length2 or angle, not both")
        if length2 is not None and not float(length2) > 0:
            raise ValueError("chamfer: length2 must be positive")
        if angle is not None and not 0 < float(angle) < 180:
            raise ValueError("chamfer: the angle must lie between 0 and 180 degrees")
        two = angle is not None or (length2 is not None and float(length2) != length)
        if two and reference is None:
            raise ValueError("chamfer: length2 and angle need reference=, the face (or faces) of each edge on which "
                             "length is measured")
        refs = self._own_faces(reference) if two else []
        edges, _ = self._resolved(edges)
        sel = self._sharp_edges(edges, "chamfer")
        selected = {e._identity() for e in sel}
        if propagate:
            sel = _tangent_chains(sel)[0]
        radii, radii2, firsts, setbacks = [], [], [], []
        backwards: str | None = None  # why an unequal bevel may fail
        behind: list[int] = []  # the edges whose bevel offsets a face backwards (see below)
        for e in sel:
            fs = e.faces()
            if two:
                on = [i for i, f in enumerate(fs) if any(f._f is r for r in refs)]
                if len(fs) != 2 or len(on) != 1:
                    raise ValueError(
                        f"chamfer: the edge from {_fmt_point(e.start)} to {_fmt_point(e.end)} "
                        f"{'lies on two reference faces' if len(on) > 1 else 'does not lie on a reference face'}; "
                        f"give the face of each edge on which length is measured"
                        + ("" if len(on) > 1 or e._identity() in selected else
                           " (it continues a selected edge tangentially: add its face, or propagate=False)"))
                fs = [fs[on[0]], fs[1 - on[0]]]
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
                        f"{lo:.4g} to {hi:.4g} from the edge instead of {length:.4g}; round such an edge "
                        f"with fillet(), whose radius stays the same along it")
                if two:
                    s1, s2 = self._chamfer_setbacks(e, theta, length, length2, angle)
                    # the kernel bevels between the lines where the faces, offset by r1 and r2, meet: those
                    # lines project onto the faces at the setbacks
                    r1 = (s2 + s1 * math.cos(theta)) / math.sin(theta)
                    r2 = (s1 + s2 * math.cos(theta)) / math.sin(theta)
                    if not (r1 > 0 and r2 > 0):
                        # (faces that meet at an acute angle, setbacks less alike than the cosine of the angle:
                        # one face's offset runs backwards, which the kernel's solver takes only so far)
                        behind.append(len(radii))
                        if backwards is None:
                            backwards = (f"chamfer: the faces of the edge from {_fmt_point(e.start)} to "
                                         f"{_fmt_point(e.end)} meet at {180 - math.degrees(theta):.4g} degrees, and "
                                         f"the kernel could not bevel them with setbacks this different ({s1:.4g} and "
                                         f"{s2:.4g}); bring them closer (each at least "
                                         f"{math.cos(math.pi - theta):.4g} times the other always works)")
                    radii.append(r1)
                    radii2.append(r2)
                    firsts.append(fs[0]._f)
                    setbacks.append({fs[0]._identity(): s1, fs[1]._identity(): s2})
                else:
                    radii.append(r)
                    setbacks.append(length)
            else:
                radii.append(length)
                setbacks.append(length)
        near_limit = self._check_round_sizes(sel, setbacks, "chamfer", "length") > _NEAR_LIMIT
        if mitre:
            _require_mitred_corners("chamfer", sel)
        hint = "the length may be too large for the selected edges"
        # (the volume bound of a bevel is its triangle, half the product of its setbacks)
        sizes = [math.sqrt(math.prod(b.values())) if isinstance(b, dict) else b for b in setbacks]

        def bevel(keep: list[int]) -> Part:
            # the kernel's bevels of the edges sel[i], i in keep
            edges = [sel[i] for i in keep]
            rs = [radii[i] for i in keep]

            def attempt(factor: float) -> Part:
                isolate = self._h.imported  # (read from a file: in another process, see _round_edges)
                if two:
                    copy, kfaces, kedges, _ = ext.copy_with_map(self._brep, [firsts[i] for i in keep],
                                                                self._own_edges(edges), [])
                    h = BrepHandle(copy)
                    with self._rounding("chamfer", hint, edges, propagate):
                        out = _round_edges("chamfer", hint, h.brep, kedges, edges, rs, [0],
                                           radii2=[radii2[i] for i in keep], faces=kfaces, tolerance_factor=factor,
                                           mitre=mitre, isolate=isolate)
                else:
                    h, kedges = self._with_edges(edges)
                    with self._rounding("chamfer", hint, edges, propagate):
                        if all(abs(r - rs[0]) < 1e-12 for r in rs):
                            out = _round_edges("chamfer", hint, h.brep, kedges, edges, [rs[0]], [0],
                                               tolerance_factor=factor, mitre=mitre, isolate=isolate)
                        else:
                            # per-edge radii with a linear cross-section, in one call: a call per edge
                            # replaces the edges next to it, and the next call would use freed edges
                            out = _round_edges("chamfer", hint, h.brep, kedges, edges, rs, [0] * len(kedges),
                                               tolerance_factor=factor, mitre=mitre, isolate=isolate)
                result = self._like(_take(h) if out is h.brep else out)
                self._check_volume_change(result, edges, "chamfer", [sizes[i] for i in keep], "chamfer",
                                          near_limit=near_limit)
                return result

            try:
                return _with_finer_rounds(attempt)
            except ModelingError as e:  # (a KernelError too)
                if backwards is None:
                    raise
                # The kernel's solver offsets each face by its own distance, and one runs backwards here. A
                # straight edge between planes whose ends lie on planes at right angles to it is bevelled
                # exactly by cutting the bevel's prism along it instead (checked: it takes exactly its
                # triangle times the edge's length); the kernel bevels the other edges.
                prisms = [i for i in behind if i in keep and self._prism_bevel(sel, i, setbacks[i]) is not None]
                if not prisms or len(prisms) != len([i for i in behind if i in keep]):
                    raise ModelingError(backwards) from e
                rest = [i for i in keep if i not in prisms]
                try:
                    result = bevel(rest) if rest else self._like(self._copy_brep())
                except ModelingError:
                    raise ModelingError(backwards) from e
                for i in prisms:
                    tool, volume = self._prism_bevel(sel, i, setbacks[i])  # type: ignore[misc]
                    before = float(result._props(1e-6)["volume"])
                    try:
                        after = result.cut(tool)
                    except ModelingError:
                        raise ModelingError(backwards) from e
                    took = before - float(after._props(1e-6)["volume"])
                    if after._solid_problem() is not None or not abs(took - volume) <= 1e-7 * volume + 1e-10 * before:
                        raise ModelingError(backwards) from e
                    result = after
                return result

        everything = list(range(len(sel)))
        cones = self._conical_bevels(sel, setbacks)
        if cones:
            # the kernel's bevels of the other edges, then the exact ones; where one of those does not take
            # what it should (other material in its way), the kernel bevels all
            rest = [i for i in everything if i not in cones]
            result = bevel(rest) if rest else self._like(self._copy_brep())
            applied = result._applied_bevels(list(cones.values()))
            return applied if applied is not None else bevel(everything)
        return bevel(everything)

    def _prism_bevel(self, edges: list[Edge], i: int, setback: Any) -> tuple[Part, float] | None:
        """The prism a bevel of the straight edge ``edges[i]`` between two planes cuts off, and its volume
        (its triangle times the edge's length), where the edge's ends lie on planes at right angles to it
        and no other of ``edges`` ends there (else None). ``setback`` is its setback by face. The prism runs a
        little past the edge's ends and the faces, and closes beyond the edge, so that it meets the part
        only along the bevel."""
        from .sketches import Polygon

        e = edges[i]
        fs = list(e.faces())
        if e.geom_type != "line" or len(fs) != 2 or not all(f.is_planar for f in fs) or e.convexity != "convex":
            return None
        t = (e.end - e.start).normalized()
        others = {g._identity() for j, g in enumerate(edges) if j != i}
        for v in e.vertices():
            if any(g._identity() in others for g in v.edges()):
                return None
            for f in v.faces():
                if f._f is fs[0]._f or f._f is fs[1]._f:
                    continue
                if not f.is_planar or abs(abs(f.normal_at(v.point).dot(t)) - 1.0) > 1e-9:
                    return None
        c = e.start
        s = [float(setback[f._identity()]) if isinstance(setback, dict) else float(setback) for f in fs]
        normals = [f.normal_at(c) for f in fs]
        ways = []  # into each face, at right angles to the edge
        for j in (0, 1):
            w = normals[j].cross(t).normalized()
            if w.dot(normals[1 - j]) > 0:
                w = -w
            ways.append(w)
        a, b = c + ways[0] * s[0], c + ways[1] * s[1]
        m = (a + b) * 0.5
        corner = c * 2 - m
        p1, p2 = a + (a - b) * 0.25, b + (b - a) * 0.25
        x = (a - c).normalized()
        y = t.cross(x)
        margin = 0.1 * e.length + max(s)
        plane = Plane(c - t * margin, x_dir=x, z_dir=t)

        def local(p: Vector) -> tuple[float, float]:
            return (p - c).dot(x), (p - c).dot(y)

        try:
            tool = Polygon(local(p1), local(p2), local(corner)).on(plane).extrude(e.length + 2 * margin)
        except ModelingError:
            return None
        area = 0.5 * (a - c).cross(b - c).length
        return tool, area * e.length

    def _conical_bevels(self, edges: list[Edge], setbacks: list[Any]) -> dict[int, tuple[Part, float, bool]]:
        """The exact bevels of the closed circular ``edges`` between faces coaxial with them (a plane at
        right angles to the axis, a cylinder or a cone around it, a face of a revolve whose meridian is
        straight there), by index: the solid of revolution each cuts off (a convex edge) or fills in (a
        concave edge), its volume, and whether it fills in. ``setbacks`` holds each edge's setback, or its setback by face. The kernel fits such
        bevels with B-splines (volumes off by up to 1e-5 of the part's); this one is a surface of
        revolution of the bevel's line, exact."""
        from .sketches import Polygon

        out: dict[int, tuple[Part, float, bool]] = {}
        for i, (e, setback) in enumerate(zip(edges, setbacks)):
            if not (e.is_closed and e.geom_type == "circle"):
                continue
            fs = list(e.faces())
            kind = e.convexity
            if len(fs) != 2 or kind not in ("convex", "concave"):
                continue
            center, axis = e.arc_center, e.normal.normalized()
            near = 1e-9 * max(e.radius, 1.0)
            coaxial = True
            for f in fs:
                if f.geom_type not in ("plane", "cylinder", "cone", "revolution"):
                    coaxial = False
                    break
                if f.geom_type == "revolution":
                    continue  # (no axis to read: sampled below)
                placement = f._surface_info()["placement"]
                along = abs(Vector(placement["z_dir"]).normalized().dot(axis)) > 1.0 - 1e-12
                off = Vector(placement["origin"]) - center
                coaxial = coaxial and along and (f.geom_type == "plane" or (off - axis * off.dot(axis)).length <= near)
            if not coaxial:
                continue
            s = [float(setback[f._identity()]) if isinstance(setback, dict) else float(setback) for f in fs]
            c, t = e.point_at(0.0), e.tangent_at(0.0)
            normals = [f.normal_at(c) for f in fs]
            ways = []  # into each face, at right angles to the edge
            for j in (0, 1):
                w = normals[j].cross(t).normalized()
                if (w.dot(normals[1 - j]) < 0) != (kind == "convex"):
                    w = -w
                ways.append(w)
            if not all(f.geom_type != "revolution" or _straight_around(f, center, axis, c, w * sj, n)
                       for f, w, sj, n in zip(fs, ways, s, normals)):
                continue
            q = c - center
            radial = (q - axis * q.dot(axis)).normalized()

            def rz(p: Vector) -> tuple[float, float]:
                return (p - center).dot(radial), (p - center).dot(axis)

            corner, p1, p2 = rz(c), rz(c + ways[0] * s[0]), rz(c + ways[1] * s[1])
            # the bevel's line runs on a little past both faces, and the profile closes beyond the edge,
            # so that the tool meets the faces only along the bevel (no faces on faces)
            ext_ = 0.25
            for a, b in ((p1, p2), (p2, p1)):
                if a[0] < b[0]:
                    ext_ = min(ext_, 0.5 * a[0] / (b[0] - a[0]))
            m = (0.5 * (p1[0] + p2[0]), 0.5 * (p1[1] + p2[1]))
            profile = [(p1[0] + (p1[0] - p2[0]) * ext_, p1[1] + (p1[1] - p2[1]) * ext_),
                       (p2[0] + (p2[0] - p1[0]) * ext_, p2[1] + (p2[1] - p1[1]) * ext_),
                       (2 * corner[0] - m[0], 2 * corner[1] - m[1])]
            if min(p1[0], p2[0], profile[2][0]) <= near or ext_ <= 1e-3:
                continue  # (the bevel reaches the axis)
            area = 0.5 * abs((p1[0] - corner[0]) * (p2[1] - corner[1]) - (p1[1] - corner[1]) * (p2[0] - corner[0]))
            volume = 2.0 * math.pi * (corner[0] + p1[0] + p2[0]) / 3.0 * area
            plane = Plane(center, radial, radial.cross(axis))  # (its y direction is the axis)
            try:
                tool = Polygon(*profile).on(plane).revolve(Axis(center, axis), 360)
            except ModelingError:
                continue
            out[i] = (tool, volume, kind == "concave")
        return out

    def _applied_bevels(self, tools: list[tuple[Part, float, bool]]) -> Part | None:
        """The part with the ``tools`` of ``_conical_bevels`` cut away, and those that fill fused on (each
        kind in one Boolean), or None where that does not change the volume by the tools' bevels (other
        material in their way). The edges where the bevels meet cylinders and cones are exact circles
        (the kernel's intersection fits them)."""
        result = self
        for fills in (False, True):
            group = [(tool, volume) for tool, volume, f in tools if f == fills]
            if not group:
                continue
            before = float(result._props(1e-6)["volume"])
            try:
                after = result.fuse([t for t, _ in group]) if fills else result.cut([t for t, _ in group])
            except ModelingError:
                return None
            if after._solid_problem() is not None:
                return None
            change, volume = abs(float(after._props(1e-6)["volume"]) - before), sum(v for _, v in group)
            if not abs(change - volume) <= 1e-6 * volume + 1e-10 * abs(before):
                return None
            result = after  # (a Boolean keeps the name and the color of its first operand)
        # (the kernel fits the circle where a bevel's cone meets a cylinder: the exact circle)
        with kernel_call("chamfer"):
            exact = ext.exact_circles(result._brep)
        return result if exact is None else result._like(exact)

    @staticmethod
    def _chamfer_setbacks(e: Edge, theta: float, length: float, length2: float | None,
                          angle: float | None) -> tuple[float, float]:
        """The setbacks of an asymmetric chamfer of ``e`` on its reference face and on its other face,
        whose normals are ``theta`` (radians) apart: ``length`` and ``length2``, or the setback on the other
        face that tilts the bevel by ``angle`` degrees against the reference face."""
        wedge = math.pi - theta  # the angle between the faces, on the side the bevel cuts across
        if angle is None:
            assert length2 is not None
            return length, float(length2)
        a = math.radians(float(angle))
        if wedge + a >= math.pi - 1e-9:
            raise ValueError(
                f"chamfer: a bevel at {float(angle):.4g} degrees to the reference face does not meet the other face "
                f"of the edge from {_fmt_point(e.start)} to {_fmt_point(e.end)}, which meets it at "
                f"{math.degrees(wedge):.4g} degrees; use an angle below {180 - math.degrees(wedge):.4g}")
        return length, length * math.sin(a) / math.sin(wedge + a)

    def shell(self, thickness: float, openings: Any = None, *, outward: bool = False, corners: str | None = None,
              walls: Any = None) -> Part:
        """Hollow the part out to walls of ``thickness``, removing the ``openings`` faces.

        The walls grow inward (the outside keeps its size) unless ``outward`` is true.

        ``corners`` says how the new side of the walls turns where the part's faces grow apart (the
        inside of a concave edge for walls that grow inward, the outside of a convex edge and corner
        for walls that grow outward): ``"round"`` keeps the wall's thickness all round with a round
        of radius ``thickness``; ``"sharp"`` extends the faces until they meet, so that the wall is
        thicker there (up to ``thickness / sin(a / 2)`` at an edge of angle ``a``). The default,
        None, takes ``"round"`` where the kernel builds it and ``"sharp"`` where it does not; the
        result's ``info()["corners"]`` says which. Given ``"round"`` or ``"sharp"``, a shell the
        kernel cannot build that way raises instead.

        ``walls`` gives faces walls of their own thickness: ``(faces, thickness)`` pairs, or a dict
        of faces to thicknesses (``walls=[(part.faces().bottom(), 5)]``). The face of the shell
        across such a wall is offset by the difference, and the faces around it are extended or
        trimmed to meet it (as :meth:`offset_faces`). Faces that meet smoothly (a wall and the
        round beside it) need one thickness.

        The kernel leaves the rim of an opening open where it meets its neighbours tangentially
        (the flat top of a box rounded on all edges): planar openings of that kind, whose other rim
        edges meet walls standing at right angles to them or an ordinary opening, are cut out of the
        part shelled closed instead (the inner rounds then end at the rim).

        Walls that do not fit into the part (measured across it from each face), and results
        the kernel gets wrong (faces that do not meet, no cavity, the part given back, a closed
        shell of the wrong volume), raise :class:`ModelingError`. The kernel step runs in
        another process (a forked copy on Linux and macOS, a helper process on Windows), so that a
        crash of its offset code raises ``ModelingError`` too, and it is stopped after
        ``smlibpy.defeature.GUARD_SECONDS`` (20 s): raise that for large parts.
        """
        from ._guard import isolated
        from .face_edit import _wall_thicknesses, shell_walls

        if corners not in (None, "round", "sharp"):
            raise ValueError(f'shell: corners must be "round" or "sharp" (or None for either), not {corners!r}')
        self._require_valid("shell")
        if not abs(float(thickness)) > 0:
            raise ValueError("shell: the thickness must not be zero")
        faces = self._own_faces(openings) if openings is not None else []
        t = abs(float(thickness))
        own = _wall_thicknesses(self, walls, t, faces) if walls is not None else []
        if own:
            shelled = self.shell(thickness, [Face(self, f) for f in faces], outward=outward, corners=corners)
            mode = _MADE.get(shelled._h, {})
            return _made(shell_walls(self, shelled, own, t, outward, not faces), **mode)
        rays = self._inward_rays(faces)
        if not outward:
            self._check_wall_fits(t, faces, rays)
        d = t if outward else -t
        hint = self._shell_hint(faces, t, rays, outward)
        if corners is not None:
            hint += f', or try corners="{"sharp" if corners == "round" else "round"}"'
        cut = self._openings_to_cut(faces, t, outward)
        if cut:
            # The kernel leaves the rim of such an opening open (its inner rounds run up to the outer
            # edge, and their edges lie off their faces): shell the part without them, then cut each out.
            def by_cutting() -> Part:
                rest = [f for f in faces if not any(f is c for c in cut)]
                base = self.shell(thickness, [Face(self, f) for f in rest], outward=outward, corners=corners)
                return _made(base._cut_openings([Face(self, f) for f in cut], t, outward), **_MADE.get(base._h, {}))

            return self._checked("shell", [(True, by_cutting)], grow=t if outward else 0.0,
                                 smaller=None if outward else True,
                                 problem=lambda result, _: self._shell_problem(result, d, faces, rays, True,
                                                                               lambda extended: 0.0),
                                 hint=hint)
        offsets: dict[bool, float] = {}  # volume of the part offset by d, by mode (for a closed shell)

        def offset_volume(extended: bool) -> float:
            if extended not in offsets:
                off = Part._wrap(isolated("shell", _offset_step, "shell", None, self._brep, d, extended))
                offsets[extended] = float(off._props(1e-4)["volume"]) if off._brep.face_count() else 0.0
            return offsets[extended]

        def attempt(extended: bool) -> Part:
            # In another process: the kernel's offset code can crash, mostly in its extended mode,
            # which depends on memory layout. (The plain mode rolls a ball where the faces grow
            # apart, the extended one extends them until they meet.)
            return _made(self._like(isolated("shell", _shell_step, hint, self._brep, d, extended, list(faces))),
                         corners="sharp" if extended else "round")

        def problem(result: Part, extended: bool) -> str | None:
            return self._shell_problem(result, d, faces, rays, extended, offset_volume)

        modes = [False] if corners == "round" else [True, True] if corners == "sharp" else [False, True, True]
        return self._checked("shell", [(m, lambda m=m: attempt(m)) for m in modes],
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

    def _openings_to_cut(self, openings: list[Any], t: float, outward: bool) -> list[Any]:
        """The openings ``shell`` cuts out of the part shelled without them (see ``_cut_openings``): when
        one has a rim edge that meets its neighbour tangentially (the kernel leaves such a rim open), the
        planar ones whose rim edges all do, or (walls growing inward) meet walls that stand at right
        angles to the opening for at least the wall's thickness (the cavity's face under the opening
        then ends where the inner walls do), or meet another opening that the kernel opens (the cavity's
        face then ends in that opening's plane). Two such openings that meet each other, and all of them
        when an opening with a tangent rim is not such a face, are left to the kernel: then []."""
        kinds = []  # (kernel face, has a tangent rim edge, can be cut out, the openings it meets)
        for kf in openings:
            f = Face(self, kf)
            smooth, fits = False, f.is_planar
            n = f.normal_at() if fits else None
            meets: list[Any] = []
            for e in f.edges():
                others = [g for g in e.faces() if g._f is not kf]
                if len(others) != 1:
                    fits = False  # a seam
                    continue
                if any(others[0]._f is o for o in openings):
                    meets.append(others[0]._f)  # (the edge of another opening)
                    continue
                if e.convexity == "smooth":
                    smooth = True
                elif fits and (outward or not self._straight_wall(e, others[0], n, t)):  # type: ignore[arg-type]
                    fits = False
            kinds.append((kf, smooth, fits, meets))
        if not any(smooth for _, smooth, _, _ in kinds) or any(smooth and not fits for _, smooth, fits, _ in kinds):
            return []
        cut = [kf for kf, smooth, _, _ in kinds if smooth]
        # (two openings cut out of the part shelled closed that meet would leave the wall along the edge
        # between them: each cut takes the wall over its own cavity face only)
        if any(any(m is c for c in cut) for kf, smooth, _, meets in kinds if smooth for m in meets):
            return []
        return cut

    @staticmethod
    def _straight_wall(e: Edge, wall: Face, n: Vector, t: float) -> bool:
        """True if ``wall`` stands at right angles to the opening's normal ``n`` along its edge ``e`` and
        keeps doing so for ``t`` beneath it (a plane, or a cylinder or extrusion along ``n``)."""
        try:
            for u in (0.25, 0.5, 0.75):
                p = e.point_at(u)
                m = wall.normal_at(p)
                q = p - n * t
                if abs(m.dot(n)) > 1e-6 or wall.distance_to(q) > 1e-6 * max(t, 1.0):
                    return False
                if wall.normal_at(q).angle_to(m) > 1e-3:
                    return False
        except (KernelError, ValueError):
            return False
        return True

    def _cut_openings(self, openings: list[Face], t: float, outward: bool) -> Part:
        """This shell (of a part, made without ``openings``) with each opening cut out: the cavity's face
        under it (the part's face offset by ``t``, or for walls grown outward the face itself) extruded
        through the wall. Raises ModelingError where there is no such face, or where a cut takes more
        than the wall over that face (the part reaches over the opening)."""
        out = self
        for f in openings:
            n = f.normal_at()
            depth = 0.0 if outward else t
            under = f.interior_point() - n * depth
            tol = 1e-6 * max(self._extent(), 1.0)
            caps = [g for g in out.faces() if g.is_planar and g.normal_at().dot(n) < -1 + 1e-9
                    and g.distance_to(under) <= tol]
            if len(caps) != 1:
                raise ModelingError(f"shell: the part shelled closed has no single face under the opening at "
                                    f"{_fmt_point(f.center())} to cut it out from")
            g = caps[0]
            if g.area > f.area * (1 + 1e-9) + tol or any(f.distance_to(v.point + n * depth) > tol
                                                          for v in g.vertices()):
                raise ModelingError(f"shell: the face under the opening at {_fmt_point(f.center())} reaches past "
                                    f"the opening")
            sk = g.to_sketch()
            amount = 1.5 * t
            prism = sk.extrude(amount if sk.plane.z_dir.dot(n) > 0 else -amount)
            before = float(out._props(1e-6)["volume"])
            with kernel_call("shell", "the opening could not be cut out of the part shelled closed"):
                cut = out - prism
            removed = before - float(cut._props(1e-6)["volume"])
            expect = g.area * t
            if not abs(removed - expect) <= 1e-6 * before + 1e-4 * expect:
                raise ModelingError(
                    f"shell: cutting the opening at {_fmt_point(f.center())} out of the part shelled closed took "
                    f"{removed:.10g} instead of the wall over it, {expect:.10g} (the part reaches over the opening)")
            out = cut
        return out

    def _shell_hint(self, openings: list[Any], t: float | None = None,
                    rays: Sequence[tuple[Vector, Vector, float, bool]] = (), outward: bool = False) -> str:
        """What a failed shell says: that the kernel cannot open a face whose rim meets its
        neighbours tangentially (the flat top of a rounded box); else where the walls of ``t`` fit
        worst (kernel plan B19): for walls that grow ``outward``, a hole or inside round tighter than
        the wall, which the outer wall closes (a hole of radius 1 and walls of 2 fail; inward, the
        kernel's extended mode makes the inner wall sharp where a round is tighter, and those
        succeed); inward, the place the part is thinnest across (``rays``, see ``_inward_rays``),
        where it is less than three walls thick; else that the wall may be too thick."""
        for kf in openings:
            for e in Face(self, kf).edges():
                if e.convexity == "smooth":
                    return ("the kernel cannot open a face whose rim meets its neighbours tangentially; shell the "
                            "part before rounding the rim, or shell it closed and cut the opening out")
        if t is not None:
            tight = self._tightest_round(openings, outward) if outward else None
            if tight is not None and tight[0] < t:
                r, p = tight
                return (f"the hole or inside round at ({p.x:.4g}, {p.y:.4g}, {p.z:.4g}) has a radius of {r:.4g}, less "
                        f"than the wall of {t:.4g}, and the outer wall would close it; shell the part before cutting "
                        f"or rounding it there, or use a thinner wall")
            if not outward and rays:
                p, _, depth, opening = min(rays, key=lambda r: r[2] / (1 if r[3] else 2))
                walls = 1 if opening else 2
                if depth < (walls + 1) * t:
                    return (f"the part is {depth:.4g} thick across the face at ({p.x:.4g}, {p.y:.4g}, {p.z:.4g}), "
                            f"room for {'a wall' if walls == 1 else 'two walls'} of {t:.4g} and little more; use a "
                            f"thinner wall")
        return "the wall may be thicker than the part allows"

    def _tightest_round(self, openings: list[Any], outward: bool) -> tuple[float, Vector] | None:
        """The radius and a point of the tightest cylinder, sphere or torus (its tube) of the part
        that is not an opening and that walls growing inward (``outward``: outward) shrink: a round
        of a convex edge, a boss (a hole); None where there is none."""
        best: tuple[float, Vector] | None = None
        for f in self._brep.faces():
            if any(f is o for o in openings):
                continue
            info = ext.surface_data(f.surface(), False)
            kind = info["kind"]
            if kind == "cone" and abs(info.get("semi_angle_deg", 1.0)) < 1e-12:
                r = float(info["radius"])
            elif kind == "sphere":
                r = float(info.get("radius", 0.0))
            elif kind == "torus":
                r = float(info.get("minor_radius", 0.0))
            else:
                continue
            if not r > 0 or (best is not None and r >= best[0]):
                continue
            face = Face(self, f)
            try:
                p = face.interior_point()
                n = face.normal_at(p)
            except (RuntimeError, ValueError):
                continue
            # the center of the round: on the axis (cylinder), the center (sphere), on the tube's
            # center circle (torus)
            pl = info["placement"]
            o, d = Vector(pl["origin"]), Vector(pl["z_dir"]).normalized()
            if kind == "sphere":
                center = o
            elif kind == "cone":
                center = o + d * (p - o).dot(d)
            else:
                q = p - d * (p - o).dot(d)
                center = o + (q - o).normalized() * float(info["major_radius"])
            convex = (p - center).dot(n) > 0  # the outward normal points away from the center
            if convex != outward:
                best = (r, p)
        return best

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

    def offset(self, distance: float, *, corners: str = "sharp") -> Part:
        """Grow (positive) or shrink (negative) the part by ``distance`` everywhere (0 gives an
        equal copy).

        ``corners="sharp"`` moves each face by ``distance`` and extends the faces until they meet
        again: edges and corners stay sharp, and an edge whose faces meet at an angle ``a`` moves
        out by ``distance / sin(a / 2)``. ``"round"`` rolls a ball of radius ``distance`` along the
        part: where faces grow apart (the convex edges and corners of a growing part) it fills in
        cylinders and spheres, so that every point of the result lies at ``distance`` from the part
        (a clearance body, the skin of an overmould). Shrinking with ``"round"`` rounds the
        concave edges, which grow apart inward; the convex ones stay sharp. The sharp mode fails
        where faces would vanish or cross (an acute wedge, a hole that closes, a groove narrower
        than twice the distance); the rounded mode builds those.

        Results the kernel gets wrong (faces that do not meet, a change of the wrong sign) raise
        :class:`ModelingError`. The kernel step runs in another process (a forked copy on Linux and
        macOS, a helper process on Windows) and is stopped after
        ``smlibpy.defeature.GUARD_SECONDS`` (20 s), as for :meth:`shell`."""
        from ._guard import isolated

        if corners not in ("sharp", "round"):
            raise ValueError(f'offset: corners must be "sharp" or "round" for a part, not {corners!r}')
        self._require_valid("offset")
        d = float(distance)
        if d == 0:
            return self._like(self._copy_brep())
        extended = corners == "sharp"  # (the kernel's extended mode extends the faces, the other one rolls)
        hint = ('try a smaller distance, or corners="round", which rounds the edges whose faces grow apart '
                "instead of extending the faces (it builds acute wedges and holes that close)"
                if extended else "try a smaller distance")

        def attempt() -> Part:
            # (the kernel's offset code can crash, mostly in its extended mode, which depends on
            # memory layout: it runs in another process)
            return _made(self._like(isolated("offset", _offset_step, "offset", hint, self._brep, d, extended)),
                         corners=corners)

        if not extended:
            # every point lies at |d| from the part: in its box grown by d; a repeat gives the same
            return self._checked("offset", [(False, attempt)], grow=max(d, 0.0), smaller=d < 0, hint=hint)
        # the sharp mode moves edges and corners farther than d (a cone's base edge by d / sin(a / 2))

        def wider() -> float:
            return d * _SHARP_OFFSET_SLACK * min(self._sharp_offset_reach(), _SHARP_OFFSET_REACH)

        return self._checked("offset", [(True, attempt), (True, attempt)], grow=max(d, 0.0),
                             wider=wider if d > 0 else None, smaller=d < 0, hint=hint)

    def _sharp_offset_reach(self) -> float:
        """How far a sharp offset by 1 (the kernel's extended mode) moves the points of the part, to
        first order: 1 on its faces; 1 / cos(t / 2) at an edge whose face normals are t apart
        (sampled at 5 points along it); and at a vertex, the point where the moved tangent planes of
        three of its faces meet (each three whose normals span space). Infinite at an edge whose
        faces meet back to back."""
        reach = 1.0
        for e in self.edges():
            fs = e.faces()
            if len(fs) != 2:
                continue
            for t in (0.0, 0.25, 0.5, 0.75, 1.0):
                p = e.point_at(t)
                try:
                    c = fs[0].normal_at(p).dot(fs[1].normal_at(p))
                except (KernelError, ValueError):  # (the apex of a cone)
                    continue
                if 1.0 + c < 1e-12:
                    return math.inf
                reach = max(reach, math.sqrt(2.0 / (1.0 + c)))
        for v in self.vertices():
            normals: list[Vector] = []
            for f in v.faces():
                try:
                    n = f.normal_at(v.point)
                except (KernelError, ValueError):
                    continue
                if all(n.dot(m) < 1.0 - 1e-9 for m in normals):
                    normals.append(n)
            for a, b, c in itertools.combinations(normals, 3):
                # the point x with a.x = b.x = c.x = 1
                bc, ca, ab = b.cross(c), c.cross(a), a.cross(b)
                det = a.dot(bc)
                if abs(det) > 1e-6:
                    reach = max(reach, ((bc + ca + ab) / det).length)
        return reach

    def _checked(self, name: str, attempts: Sequence[tuple[bool, Callable[[], Part]]], *, grow: float,
                 smaller: bool | None, problem: Callable[[Part, bool], str | None] | None = None,
                 hint: str = "try a smaller value", wider: Callable[[], float] | None = None) -> Part:
        """The first result of ``attempts`` that passes the checks: a valid solid within the part's
        box (grown by ``grow``, or by what ``wider`` gives, asked only for a result beyond that),
        whose faces meet (gaps below _OFFSET_GAPS), whose volume went down (``smaller``), up
        (``smaller=False``) or changed (None), and in which ``problem`` finds nothing wrong.

        Each attempt is a mode (the kernel's extended offset mode or not) and a function that makes
        the result. An attempt in the mode of the one before runs only when that one's result was
        refused, within _RETRY_SECONDS: the kernel fails the same way again, and only its extended
        mode, which depends on memory layout, ever gave a better result. A step that crashed the
        kernel or did not finish (in the copy of the process it ran in) ends the attempts."""
        box = self.bbox()
        tol = 1e-6 * max(box.diagonal, 1.0) + grow
        margin: list[float] = []  # (wider's, once asked)

        def wide() -> float:
            if not margin:
                assert wider is not None
                margin.append(1e-6 * max(box.diagonal, 1.0) + wider())
            return margin[0]

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
            why = (_offset_problem(result, box, tol, before, smaller, wide if wider is not None else None)
                   or (problem(result, mode) if problem else None))
            if why is None:
                return result
            refused = refused or why
        if error is not None:
            crash = _crash_note(error, name)
            if crash is not None:  # (not the hint's guess about the size)
                raise KernelError(error.operation, error.detail, error.status,
                                  f"{crash}, a defect of the kernel rather than of the part") from error
            raise error
        raise ModelingError(f"{name}: the kernel could not build a valid result (it built {refused}); {hint}")

    def split(self, plane: Plane | Face | Shell, keep: str = "above") -> Any:
        """Cut the part with a plane or along a sheet.

        ``keep="above"`` keeps the side the plane normal points to, ``"below"`` the other
        side, ``"both"`` returns ``(above, below)``.

        A sheet (a :class:`Shell`, or a face that is not planar: a curved split surface, a
        surface fitted to a scan) splits the part along its surface; "above" is the side its
        normals point to (``normal_at``). The sheet must cut through the part. A sheet of one
        face whose edges end inside the part is extended beyond them until it does (the face's
        trim is not kept): a free-form face tangentially, a plane, cylinder, cone or sphere as
        itself (:meth:`Face.extend`; around a closed face it cannot grow); sheets of several faces
        raise ``ModelingError`` ("the surface does not cut through the part"). The two sides together hold the part's
        volume, which is checked. A planar face (or a sketch) stands for its plane. A plane that a
        seam of the part touches at a point (a torus' outer equator, where the kernel's Boolean can
        go wrong) gives only sides that together hold the part's volume, else ``ModelingError``.
        """
        if isinstance(plane, ShapeList):
            plane = plane.one()
        if isinstance(plane, Face) and not plane.is_planar:
            return self._split_by_sheet(plane.to_shell(), keep, not plane._natural_is_outward())
        if isinstance(plane, Shell) and not isinstance(plane, Sketch):
            return self._split_by_sheet(plane, keep, False)
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

        def halfspace(side: Plane, size: float = size) -> Part:
            return Box(size, size, size).translate(0, 0, size / 2).moved(
                Plane(side.project(bb.center), side.x_dir, side.z_dir).location)

        side = pl if keep == "above" else pl.flipped()
        box = halfspace(side)
        if ext.seam_touches(self._brep, box._brep):
            # A seam of the part touches the plane at a point (a torus' outer equator, kernel plan
            # B6): the kernel's Boolean can give sides that do not add up. Both sides are made and
            # must hold the part's volume; else the kernel's slice along the plane, checked so.
            return self._split_at_seam(pl, keep, halfspace, size)
        with kernel_call("split"):
            kept = self & box
        if kept._brep.face_count() == 0:
            raise ModelingError(f"split: nothing of the part lies {keep} the plane")
        return kept

    def _split_at_seam(self, pl: Plane, keep: str, halfspace: Callable[[Plane, float], Part], size: float) -> Part:
        """:meth:`split` by a plane that a seam of the part touches at a point (kernel plan B6): the
        side a half-space box keeps where it and the other side, kept by a box of its own, hold the
        part's volume together (within 1e-6 and the gaps between their faces, which must leave their
        volumes uncertain by less than 1e-5 of the part's), with boxes of four sizes
        (the kernel's result depends on where the box's edges lie); else the kernel's slice along the
        plane where its two sides do; else ``ModelingError``. ``Torus(6, 4).rotate(Y, 90)`` split at
        z = 10 by a plane tilted by 30 degrees about Y, which touches its outer equator, gave 5.8069
        above and 1842.7020 below (the torus: 1894.9640; 1889.1572 below)."""
        side = pl if keep == "above" else pl.flipped()
        whole = float(self._props()["volume"])
        kept: list[tuple[Part, float, float]] = []
        rest: list[tuple[float, float]] = []

        def measured(box: Part) -> tuple[Part, float, float] | None:
            """The side a box keeps, its volume and how far that is uncertain (its gaps); None where
            the kernel fails or the faces do not meet (to 1e-5 of the part's volume)."""
            try:
                with kernel_call("split"):
                    piece = self & box
                if piece._brep.face_count() == 0:
                    return piece, 0.0, 0.0
                p = piece._props()
                v, gaps = float(p["volume"]), float(p["gaps"])
                return (piece, v, gaps * v) if gaps * v <= 1e-5 * whole else None
            except (KernelError, ModelingError):
                return None

        for f in (1.0, 0.73, 1.37, 1.91):
            a, b = measured(halfspace(side, f * size)), measured(halfspace(side.flipped(), f * size))
            if a is not None:
                kept.append(a)
            if b is not None:
                rest.append(b[1:])
            for piece, v, e in kept:
                if any(abs(v + w - whole) <= 1e-6 * whole + 10 * (e + ew) for w, ew in rest):
                    if piece._brep.face_count() == 0:
                        raise ModelingError(f"split: nothing of the part lies {keep} the plane")
                    return piece
        from .sketches import Rectangle

        sheet = Shell._wrap(Rectangle(size, size).on(pl)._copy_brep())
        pieces = self._sliced(sheet)
        if pieces is None:
            raise ModelingError("split: the kernel's sides of the part do not add up to the part where a seam of the "
                                "part touches the plane at a point (kernel plan B6); move or tilt the plane a little")
        return pieces[0] if keep == "above" else pieces[1]

    def imprint(self, tool: Part | Shell | Face | Sketch | Edge | Wire | Iterable[Edge | Wire],
                direction: Axis | VectorLike | None = None, *, nearest: bool = True) -> Part:
        """The part with its faces split where a tool crosses them, without changing its shape: split
        lines for drafts, patches for the loads and supports of a simulation, regions of a face of
        their own to color, draft or select (a label area, a parting line, a seal track). Nothing
        is added or taken away: the volume stays.

        Args:
            tool: A part (the faces are split where its surface crosses them), a sheet or a face
                that crosses faces of the part, or a sketch (or a planar face) lying on a face of
                the part, whose outline is cut into that face (keep its region within the face:
                where it reaches past the face's edges, the neighbouring faces can get split lines
                close to them). Or curves: edges or wires, which without a direction must lie on the
                part's faces (:meth:`intersection_curves`, :meth:`project`).
            direction: For curves, a sketch or a face: move their outline along this direction (an
                axis or a vector) onto the part first, where it crosses the part's faces as it moves
                (an outline projected onto them). Only ahead of the curves: a part behind them is
                not reached.
            nearest: With a direction, split only the faces the projection meets first: the side of
                the part facing the curves (default: an imprint marks the faces the outline lands
                on). ``False`` splits every face the projection crosses, also on the far side (a
                box's top and bottom face). :meth:`project`, which returns the projected curves,
                keeps both sides by default (``nearest=False``) and takes the same keyword.

        The pieces of the part's faces that lie inside a tool part, or inside the sketch's
        region, descend from the tool: ``part.imprint(tool).faces().derived_from(tool)``
        selects them. A fillet or chamfer across a split line removes it again. A curve across
        the seam of a closed face (a cylinder's) gives a face on each side of the seam.

        ``ModelingError`` where the tool crosses no face of the part, and where the kernel's
        result is no longer the part (another volume, or a broken body).
        """
        curves = _as_curves(tool)
        if curves is not None:
            return self._imprinted_curves(curves, direction, nearest)
        if direction is not None:
            if isinstance(tool, Sketch) or (isinstance(tool, Face) and tool.is_planar):
                # (a sketch's or a planar face's outline, as project takes it)
                return self._imprinted_curves(list(tool.edges()), direction, nearest)
            raise TypeError("imprint: direction= moves curves, a sketch or a planar face onto the part; a part or a "
                            "sheet is imprinted where it is")
        if isinstance(tool, ShapeList):
            tool = tool.one()
        if not isinstance(tool, (Part, Shell, Face)):
            raise TypeError(f"imprint takes a part, a sheet, a face, a sketch or curves (edges or wires), not a "
                            f"{type(tool).__name__}")
        self._require_valid("imprint")
        region: Part | None = tool if isinstance(tool, Part) else None
        if isinstance(tool, Part):
            tool._require_valid("imprint")
            result = self._imprinted(tool)
        elif isinstance(tool, Sketch) or (isinstance(tool, Face) and tool.is_planar):
            sketch = tool if isinstance(tool, Sketch) else tool.to_sketch()
            sheet = sketch if isinstance(tool, Sketch) else tool.to_shell()
            # (a thin slab through the plane: the pieces of faces in the plane inside it lie in
            # the sketch's region)
            region = sketch.extrude(max(1e-3 * self._extent(), 1e-6), both=True)
            result = self._imprinted(sheet)
            if result is None and self._lies_on_face(sketch.plane):
                # The kernel can imprint nothing of an outline in the plane of a face: the slab's
                # walls cut it in.
                result = self._imprinted(region)
        else:
            result = self._imprinted(tool.to_shell() if isinstance(tool, Face) else tool)
        if result is None:
            raise ModelingError("imprint: the tool crosses no face of the part")
        if region is not None:
            # the pieces inside the tool's region descend from the tool
            faces = result.faces()
            points = [f.interior_point().to_tuple() for f in faces]
            tol = 1e-6 * max(1.0, region._extent())
            inside = [f._f for f, (where, _, _) in zip(faces, region._classify(points, tol)) if where != "outside"]
            if inside:  # (the result is new: nothing has read its tags yet)
                ext.add_face_tags(result._brep, inside, sorted(_history_tags(tool, "imprint")))
                result._h.tags = None
        return result

    def _imprinted(self, tool: _Body) -> Part | None:
        """This part with its faces split where the tool's surface crosses them (the kernel's
        Boolean with imprinting), checked: a valid solid of the same volume (within 1e-6, or its
        gaps); None where no face was split."""
        h, th = BrepHandle(self._copy_brep()), BrepHandle(tool._copy_brep())  # the kernel keeps both if it fails
        with kernel_call("imprint", "the tool may only touch the part's faces, or run along one of its edges"):
            h.brep = ext.boolean(h.brep, th.brep, k.BooleanOp.UNION, imprinting=True)
        _take(th)
        result = self._like(_take(h))
        if result._brep.face_count() <= self._brep.face_count():
            return None
        problem = result._solid_problem()
        if problem is None:
            try:
                a, b = self._props(), result._props()
                slack = max(1e-6, 10 * max(float(a["gaps"]), float(b["gaps"])))
                if not abs(float(b["volume"]) - float(a["volume"])) <= slack * abs(float(a["volume"])):
                    problem = f"of another volume ({float(b['volume']):.10g}, the part has {float(a['volume']):.10g})"
            except KernelError:
                problem = "a body whose volume cannot be integrated"
        if problem is not None:
            raise ModelingError(f"imprint: the kernel returned a body {problem}; move the tool a little, so that its "
                                f"surface crosses the part's faces rather than running along them")
        return result

    def _lies_on_face(self, plane: Plane) -> bool:
        """Whether a planar face of this part lies in a plane."""
        tol = 1e-6 * max(1.0, self._extent())
        n = plane.z_dir.normalized()
        for f in self.faces():
            if f.geom_type != "plane":
                continue
            fp = f.plane
            if abs(abs(fp.z_dir.normalized().dot(n)) - 1.0) <= 1e-9 and abs((fp.origin - plane.origin).dot(n)) <= tol:
                return True
        return False

    def _split_by_sheet(self, sheet: Shell, keep: str, turned: bool) -> Any:
        """:meth:`split` along a sheet (``turned``: whose faces' normals point against those
        of the face it was taken from)."""
        if keep not in ("above", "below", "both"):
            raise ValueError('keep must be "above", "below" or "both"')
        if sheet._brep.face_count() == 0:
            raise ValueError("split: the sheet is empty")
        self._require_valid("split")
        pieces = self._sliced(sheet)
        if pieces is None and len(sheet.faces()) == 1:
            # A sheet of one face whose edges end inside the part: extended beyond them (its normals
            # point as before, the surface's): a free-form face along its surface, a plane, cylinder,
            # cone or sphere as itself (Face.extend; closed sides stay).
            reach = 2.0 * (self.bbox().diagonal + sheet.bbox().diagonal)
            face = sheet.faces()[0]
            wide: Shell | None = None
            if face.geom_type == "bspline":
                with kernel_call("split", "the sheet's surface cannot be extended"):
                    wide = Shell._wrap(ext.extended_sheet(face._f, reach))
            else:
                try:
                    wide = face.extend(reach)
                except (ValueError, ModelingError, KernelError):
                    wide = None  # (no side that can grow)
            if wide is not None:
                pieces = self._sliced(wide)
        if pieces is None:
            raise ModelingError("split: the surface does not cut through the part (its edges end inside the part, "
                                "or it misses it); make the sheet reach past the part on every side")
        above, below = pieces[::-1] if turned else pieces
        return above if keep == "above" else below if keep == "below" else (above, below)

    def _sliced(self, sheet: Shell) -> tuple[Part, Part] | None:
        """The parts of this part above and below a sheet (the kernel's SLICE, keeping the side
        its normals point to, and again with the sheet turned); None where the sheet does not
        cut through the part: a side is empty or no solid, or the two do not add up to the
        part's volume (a sheet that only dents the part or misses it, from which the kernel
        returns the part less a dent, or all of it)."""
        out: list[Part] = []
        for below in (False, True):
            h = BrepHandle(self._copy_brep())
            # (the sheet turned for the other side: its faces as B-spline faces, their U and V swapped)
            t = BrepHandle(sheet.to_nurbs()._copy_brep() if below else sheet._copy_brep())
            try:
                with kernel_call("split"):
                    h.brep = ext.slice(h.brep, t.brep, below)
                _take(t)
            except KernelError:
                return None
            piece = Part._wrap(_take(h), name=self.name, color=self.color)
            if piece._brep.face_count() == 0 or piece._solid_problem() is not None:
                return None
            out.append(piece)
        try:
            p = self._props()
            parts = [x._props() for x in out]
        except KernelError:
            return None
        whole = float(p["volume"])
        volumes = [float(x["volume"]) for x in parts]
        slack = max(1e-6, 10 * max([float(p["gaps"])] + [float(x["gaps"]) for x in parts]))
        if min(volumes) <= slack * whole or not abs(sum(volumes) - whole) <= slack * whole:
            return None
        return out[0], out[1]

    def _imprinted_curves(self, tool: Any, direction: Axis | VectorLike | None, nearest: bool) -> Part:
        """:meth:`imprint` of curves: the part with its faces split along them (moved along
        ``direction`` onto the part first, where one is given)."""
        edges = _curves_of(tool, "imprint")
        if direction is not None:
            d = _direction(direction, "imprint")
            edges = _swept_onto(self, edges, d)
            if nearest:
                edges = [e for e in edges if _seen_along(self, e, d)]
            if not edges:
                raise ModelingError("imprint: the curves, moved along the direction, miss the part")
        before = len(self.faces())
        out = self._like(_trim_with_curves(self, edges, Vector(), 2, "imprint"))
        if len(out.faces()) <= before:
            raise ModelingError("imprint: the curves split no face: each must run across a face from border to "
                                "border, or close a loop on it")
        problem = out._solid_problem()
        if problem is None and abs(out.volume - self.volume) > 1e-6 * max(abs(self.volume), 1e-12):
            problem = f"of another volume ({out.volume:.6g} instead of {self.volume:.6g})"
        if problem is not None:
            raise ModelingError(f"imprint: the kernel returned a body that is {problem}")
        return out

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
        touches = ("the plane only touches the part (along a line or a curve, or at a point), so the section has "
                   "no area; move the plane into the part")
        curves: list[Any] = []
        try:
            # (the kernel's plane section, intersect_brep_with_plane, fits its curves within a
            # thousandth of each face's size: up to 1.5e-2 off a part thickened from a B-spline sheet)
            with kernel_call("section"):
                curves = ext.plane_section(self._brep, list(pl.origin.to_tuple()), list(pl.z_dir.to_tuple()),
                                           1e-7 * max(self._extent(), 1.0))
            if not curves:
                raise ValueError("the plane does not cut the part")
            with kernel_call("section"):
                b = k.create_planar_faces(list(curves))
        except KernelError as e:
            for c in curves:  # (the kernel took them only where it made the faces)
                ext.delete_curve(c)
            # A plane tangent to a face meets the part along a line, which bounds no face.
            if self._on_one_side(pl):
                raise ValueError(touches) from e
            raise _traced(KernelError(e.operation, e.detail, e.status, "the kernel could not make faces of the curves "
                                      "where the plane meets the part; a plane through an edge, or tangent to a face, "
                                      "inside the part can do this: move the plane a little"), e) from e
        section = Sketch._wrap(b, pl)
        # A plane tangent to a part along a closed curve (the top of a torus) gives that curve, and
        # the kernel fills it with a face that lies outside the part.
        points = [f.interior_point() for f in section.faces()]
        if any(where == "outside" for where, _, _ in self._classify(points, 1e-6 * max(self._extent(), 1.0))):
            if self._on_one_side(pl):
                raise ValueError(touches)
            raise ModelingError("section: the kernel returned a region that lies outside the part; move the plane "
                                "a little")
        return section

    def _on_one_side(self, plane: Plane) -> bool:
        """Whether the part lies on one side of a plane that meets it: a plane a little beyond the
        given one, on one side or the other, misses the part (the given one only touches it)."""
        step = 1e-5 * max(self._extent(), 1.0)
        for s in (step, -step):
            p = plane.offset(s)
            with kernel_call("section"):
                curves = k.intersect_brep_with_plane(self._brep, p.origin.to_tuple(), p.z_dir.to_tuple())
            for c in curves:
                ext.delete_curve(c)
            if not curves:
                return True
        return False

    def slices(self, step: float, axis: Axis | VectorLike = Z) -> list[Sketch]:
        """Sections (:meth:`section`) across ``axis``, ``step`` apart: the part cut into layers of
        thickness ``step`` from its lowest point along the axis up, each cut in its middle (at
        ``step / 2``, ``3 * step / 2``, ... above the lowest point; the contours of a printer's
        layers). Each sketch lies in its plane (``sketch.plane``); layers whose plane misses the
        part are left out."""
        from .mesh import _levels

        d = _direction(axis, "slices")
        if not step > 0:
            raise ValueError("slices: the step must be positive")
        # the part's extent along the axis: the box of the part turned so that the axis is Z
        frame = Plane((0, 0, 0), z_dir=d)
        box = self.moved(frame.location.inverse()).bbox()
        out = []
        for level in _levels(float(box.min.z), float(box.max.z), float(step)):
            try:
                out.append(self.section(Plane(d * level, x_dir=frame.x_dir, z_dir=d)))
            except ValueError:  # the plane misses the part
                continue
        return out

    @classmethod
    def from_mesh(cls, mesh: "Mesh", max_faces: int = 5000) -> "Part":
        """A faceted part of a closed mesh (see :meth:`Mesh.to_part`)."""
        from .mesh import Mesh

        if not isinstance(mesh, Mesh):
            raise TypeError(f"from_mesh takes a Mesh, not a {type(mesh).__name__}")
        return mesh.to_part(max_faces)

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

    def unroll(self, **kwargs: Any) -> Part:
        """Unroll this part from around an axis (default Z) into a flat one, the layer at
        ``radius`` keeping its length; see :func:`smlibpy.unroll`."""
        from .deform import unroll

        return unroll(self, **kwargs)

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
        are extended or trimmed to meet them. A part with cavities is drafted as its
        outside and its cavities apart (the kernel drops cavities), which are cut out again; the walls of
        a cavity drafted by a positive angle widen along the pull direction, as a pocket's do.

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

    # -- direct editing (smlibpy.face_edit) --------------------------------------
    def move_faces(self, faces: Any, by: Location | VectorLike) -> Part:
        """Move faces of the part, and extend or trim the faces around them to meet them again:
        push or pull a face, move a hole, a boss or a pocket.

        ``by`` is a vector or a :class:`Location` (a rotation and a translation: it also turns the
        faces). A face moved along itself stays where it is (a plane moved within its plane); the
        faces around it decide what changes. Faces that meet a moved face tangentially (a round, the
        other half of a slot) must be moved with it. Exact: planes, cylinders, cones, spheres, tori
        and free-form faces keep their shape, and the edges where a plane meets a cylinder, cone
        or sphere stay circles.

        Raises :class:`ModelingError` where the kernel cannot rebuild the part, where the moved
        faces change which faces meet (a face vanishes; use a Boolean), and where the result's
        faces do not meet. A part with cavities is edited as its outside and its cavities apart (the
        kernel drops cavities), which are cut out again; a move that makes a cavity reach the outside
        or another cavity raises, and so does a part with a body inside a cavity. Faces around the
        moved ones that the kernel extends keep their cylinder or cone.

        Args:
            faces: Faces of this part (a selection or a single face).
            by: A vector, or a Location.
        """
        from .face_edit import move_faces

        return move_faces(self, faces, by)

    def offset_faces(self, faces: Any, distance: float) -> Part:
        """Offset faces of the part along their normals by ``distance``, and extend or trim the
        faces around them to meet them again: push-pull by a distance, resize a hole or a boss.

        A positive distance moves the faces out of the material: the part grows, a hole narrows
        and a boss widens; a negative one moves them in. Faces that meet an offset face tangentially
        (a round, the other half of a slot, a fillet chain) are offset with it, and so on along
        the tangent chain. Exact: a plane moves, a cylinder, cone, sphere or torus changes its
        radius, a free-form face becomes its offset surface.

        Raises :class:`ModelingError` where a radius would reach 0, where the kernel cannot
        rebuild the part, where the offset faces change which faces meet (a face vanishes; use a
        Boolean), and where the volume does not change the way the distance says. A part with
        cavities is edited as for :meth:`move_faces`: a face of a cavity's wall offset by a positive
        distance moves into the cavity.

        Args:
            faces: Faces of this part (a selection or a single face).
            distance: How far to move them, along their outward normals.
        """
        from .face_edit import offset_faces

        return offset_faces(self, faces, distance)

    # -- sheet metal (the logic is in smlibpy.sheetmetal) ------------------------
    # -- local edits of a face (smlibpy.shaping) -----------------------------
    def push(self, face: Face, at: VectorLike, *, by: float | VectorLike | None = None, to: VectorLike | None = None,
             normal: VectorLike | None = None, radius: float | None = None, continuity: str = "G1") -> Part:
        """Push or pull a face at a point: a smooth dent or bump, local to the point, its edges in place.

        Args:
            face: A face of the part.
            at: The point of the face that moves (a point off the face: the face's point nearest to it).
            by: How far it moves: a distance along the face's outward normal there (positive: out of the
                part, a bump; negative: a dent), or a vector.
            to: Where it moves to, instead of ``by``.
            normal: The face's normal at the moved point (its tangent plane turns to it). Default: as it
                was there.
            radius: How far from the point the face changes, along the face (a square around the point
                along the surface's two directions, blended in smoothly: curvature continuous). Default:
                up to the face's nearest edge, smaller where that would still move an edge.
            continuity: How the face stays joined to its neighbours where the change reaches its border:
                ``"G0"`` (its edges stay), ``"G1"`` (default; also its tangent planes along them) or
                ``"G2"`` (also its curvature).

        The point moves exactly, the face's edges not at all: an edit that would move one (a hole's edge,
        a border cut across the surface, within ``radius`` of the point) raises ``ValueError``; take a
        smaller radius or a point farther from it. The face becomes a B-spline surface; a plane, cylinder
        or sphere stays exactly what it was away from the change.

        Returns:
            A new part (this one does not change).
        """
        from . import shaping

        return shaping.checked(self, shaping.push(self, face, at, by, to, normal, radius, continuity), "push")

    def warp(self, face: Face, region: Any, by: float | VectorLike, *, continuity: str = "G2") -> Part:
        """Raise or sink a region of a face: a smooth bump over an outline drawn on the face.

        Args:
            face: A face of the part.
            region: The outline on the face: a closed Wire (on a curved face, :meth:`project` one onto
                it), a Sketch or Face placed on the face (its outline), or the corner points of a
                polygon on the face.
            by: How far the region rises at its highest point: a distance along the face's outward
                normal at the region's middle (positive: out of the part; negative: a recess), or a
                vector.
            continuity: How the change meets the rest of the face at the region's border: ``"G2"``
                (default; curvature continuous), ``"G1"`` (tangent) or ``"crease"`` (a sharp border).

        The face changes only near the region, within the rectangle around it along the surface's two
        directions (the region itself for a rectangle drawn along them); the highest point lies near the
        region's middle (at it, for a region symmetric along both directions, with ``"G2"``). Where that
        rectangle reaches an edge of the face (a hole), the edge would move: ``ValueError``. The face's
        B-spline loses the knots it does not need within 1e-6 of the size (its edges stay where they are).

        Returns:
            A new part (this one does not change).
        """
        from . import shaping

        return shaping.checked(self, shaping.warp(self, face, region, by, continuity), "warp")

    def flatten(self, face: Face, region: Any, plane: Plane | Face, *, continuity: str = "G2") -> Part:
        """Press a region of a face onto a plane: a flat area (a seat, a pad, a label area) on a curved
        face, blended into the rest of it.

        Args:
            face: A face of the part.
            region: The outline on the face, as for :meth:`warp`.
            plane: The plane (or a planar face) the region is pressed onto, along its normal.
            continuity: How the flat area meets the rest of the face: ``"G2"`` (default), ``"G1"`` or
                ``"crease"``.

        Inside the region the face lies in the plane, but for a border where it blends into the rest
        (3/16 of the region's width with ``"G2"``, 2/16 with ``"G1"``, 1/16 with ``"crease"``); outside
        the rectangle around the region (along the surface's two directions) it does not change. Where
        that rectangle reaches an edge of the face (a hole), the edge would move: ``ValueError``. The
        face's B-spline loses the knots it does not need within 1e-6 of the size (its edges stay where
        they are; a box's top flattened: 21 x 21 control points, not 39 x 39).

        Returns:
            A new part (this one does not change).
        """
        from . import shaping

        return shaping.checked(self, shaping.flatten(self, face, region, plane, continuity), "flatten")

    def fold(self, line: Any, angle: float, *, radius: float, k_factor: float = 0.44, fixed: Any = None,
             partial: bool = False) -> Part:
        """Fold this sheet along a line on its top or bottom face (see :func:`smlibpy.fold`)."""
        from .sheetmetal import fold

        return fold(self, line, angle, radius=radius, k_factor=k_factor, fixed=fixed, partial=partial)

    def flange(self, edge: Any, length: float, *, angle: float = 90.0, radius: float, k_factor: float = 0.44) -> Part:
        """Add a flange along a straight outer edge of this sheet (see :func:`smlibpy.flange`)."""
        from .sheetmetal import flange

        return flange(self, edge, length, angle=angle, radius=radius, k_factor=k_factor)

    def bends(self, *, k_factor: Any = None) -> list[Any]:
        """The bends of this sheet metal part (see :func:`smlibpy.sheetmetal.bends`)."""
        from .sheetmetal import bends

        return bends(self, k_factor=k_factor)

    def unfold(self, *, k_factor: Any = None, fixed: Face | None = None) -> Part:
        """This sheet metal part unfolded flat (see :func:`smlibpy.unfold`)."""
        from .sheetmetal import unfold

        return unfold(self, k_factor=k_factor, fixed=fixed)

    def flat_pattern(self, *, k_factor: Any = None, fixed: Face | None = None) -> Any:
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
    """The axis and the positive angle of a revolve (a negative angle turns the other way). Within
    0.01 degrees of a whole turn it is a whole turn: the kernel returns no closed solid for angles
    above 359.99 and below 359.99999, where its whole turn starts."""
    angle = float(angle)
    if angle == 0 or not math.isfinite(angle):
        raise ValueError("revolve: the angle must not be zero")
    if abs(angle) > 360 + 1e-9:
        raise ValueError("revolve: the angle is at most 360 degrees")
    if angle < 0:
        ax, angle = Axis(ax.origin, -ax.direction), -angle
    return ax, 360.0 if angle > 360.0 - _WHOLE_TURN else angle


# How close to 360 degrees a revolve is a whole turn (degrees).
_WHOLE_TURN = 0.01

# Extrusion directions: within this sine of the sketch plane the kernel refuses them (SM_ERR), below
# the other the solid is less than a thousandth of the amount thick (a warning).
_IN_PLANE = 1e-5
_NEAR_PLANE = 1e-3


def _analytic_revolve(b: Any, cls: type[_Body]) -> Any:
    """A revolve's kernel body (taken over) wrapped as ``cls``, with cylinders, cones, spheres and
    tori where its surfaces of revolution are one. The kernel revolves through a whole turn into
    surfaces of revolution where part of a turn gives cylinders, cones and spheres, and gives tori in
    neither (a revolved tube had no cylinders: no ``Face.radius``, no draft, B-splines in STEP files).
    Where the body with them is not the same (its faces, its volume or area), the body as it was."""
    before = cls._wrap(b)
    try:
        c = ext.analytic_revolutions(b)
    except RuntimeError:
        return before
    if c is None:
        return before
    after = cls._wrap(c)
    try:
        if c.face_count() != b.face_count():
            return before
        if isinstance(after, Part):
            if after._solid_problem() is not None or not math.isclose(after.volume, before.volume, rel_tol=1e-7):
                return before
        elif not math.isclose(after.area, before.area, rel_tol=1e-7):
            return before
    except KernelError:
        return before
    return after


def _face_samples(f: Face) -> list[Vector]:
    """Points on a face: an interior point and those of a 2 x 2 grid of its parameters that lie
    inside it."""
    out = [f.interior_point()]
    try:
        (u0, v0), (u1, v1) = f._f.uv_domain()
        for a in (0.25, 0.75):
            for b in (0.25, 0.75):
                u, v = u0 + a * (u1 - u0), v0 + b * (v1 - v0)
                if f._f.classify_uv(u, v) == "inside":
                    out.append(Vector(f._f.point_at_uv(u, v)))
    except (RuntimeError, ValueError):  # a face the kernel cannot sample: its interior point only
        pass
    return out


def _sheet_offset_problem(sheet: Shell, result: Shell, d: float) -> str | None:
    """What is wrong with ``result`` as ``sheet`` offset by ``d``, or None. Every point of an offset
    lies at least ``|d|`` from the sheet, on the side ``d`` points to (along the normal at its nearest
    point), and each face has points at ``|d|`` (the offset of the face it came from; corners that the
    faces' extensions close lie farther)."""
    faces = list(result.faces())
    if not faces:
        return "no faces"
    source = [(h, h.bbox()) for h in sheet.faces()]
    t = abs(d)
    tol = 1e-6 * max(sheet.bbox().diagonal, t, 1.0)

    def closest(q: Vector) -> tuple[float, Face]:
        # the nearest face, trying faces by the distance to their boxes
        best, face = math.inf, source[0][0]
        for box_distance, h in sorted(((_box_distance(b, q), h) for h, b in source), key=lambda x: x[0]):
            if box_distance > best:
                break
            dist = h.distance_to(q)
            if dist < best:
                best, face = dist, h
        return best, face

    for f in faces:
        nearest = math.inf
        for q in _face_samples(f):
            dist, g = closest(q)
            if dist < t - tol:
                return f"a face {dist:.6g} from the sheet, nearer than {t:.6g}, at {_fmt_point(q)}"
            p = Vector(g._f.closest_point(q.to_tuple())[0])
            if (q - p).dot(g.normal_at(p)) * d < 0:
                return f"a face on the other side of the sheet, at {_fmt_point(q)}"
            nearest = min(nearest, dist)
        if nearest > t + tol:
            return f"a face that lies nowhere at {t:.6g} from the sheet (it comes no nearer than {nearest:.6g})"
    return None


def _box_distance(box: BoundBox, q: Vector) -> float:
    """The distance from ``q`` to a box (0 inside it)."""
    return math.sqrt(sum(max(box.min[i] - q[i], 0.0, q[i] - box.max[i]) ** 2 for i in range(3)))


def _flat_walls(part: Part) -> Part:
    """The part with its flat B-spline faces as planes (``ext.planar_faces``), where that keeps it valid
    and of its volume: the walls of the straight edges of an extrusion along a direction across the
    sketch's normal, which the kernel makes as B-spline surfaces (selections by type missed them, STEP
    files carried B-splines)."""
    if not any(f.geom_type == "bspline" for f in part.faces()):
        return part
    size = part._extent()
    with kernel_call("extrude"):
        b = ext.planar_faces(part._brep, 1e-9 * max(1.0, size))
    if b is None:
        return part
    flat = Part._wrap(b, name=part.name, color=part.color)
    if not flat.is_valid() or abs(flat.volume - part.volume) > 1e-9 * max(abs(part.volume), 1e-300):
        return part
    return flat


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


def _continues(e: Edge, g: Edge, v: Vertex) -> bool:
    """True if ``g`` continues ``e`` tangentially through their vertex ``v``: it leaves ``v``
    within the kernel's tangency angle of the direction in which ``e`` arrives there, and its two
    faces meet those of ``e`` smoothly (their normals at ``v`` pair up within the same angle), as
    the next edge around a rounded corner does. ``g`` must be an edge a round can follow: not a
    seam and not smooth itself."""
    p = v.point
    if not any((-a).angle_to(b) < _FILLET_TANGENT_DEG for a in _leaving(e, p) for b in _leaving(g, p)):
        return False
    fe, fg = e.faces(), g.faces()
    if len(fe) != 2 or len(fg) != 2:
        return False
    try:
        ne = [f.normal_at(p) for f in fe]
        ng = [f.normal_at(p) for f in fg]
    except (KernelError, ValueError):
        return False
    t = _FILLET_TANGENT_DEG
    if not ((ne[0].angle_to(ng[0]) < t and ne[1].angle_to(ng[1]) < t)
            or (ne[0].angle_to(ng[1]) < t and ne[1].angle_to(ng[0]) < t)):
        return False
    return g.convexity != "smooth"


def _tangent_chains(edges: Sequence[Edge]) -> tuple[list[Edge], list[int]]:
    """``edges``, then the edges that continue them tangentially (:func:`_continues`), and the
    edges that continue those, as far as the chains go; with the index in ``edges`` of the edge
    each one was reached from (the nearest along its chain)."""
    out = list(edges)
    src = list(range(len(out)))
    seen = {e._identity() for e in out}
    i = 0
    while i < len(out):
        e = out[i]
        if e._e is not None and e._owner is not None:
            for v in e.vertices():
                for g in v.edges():
                    key = g._identity()
                    if key not in seen and _continues(e, g, v):
                        seen.add(key)
                        out.append(g)
                        src.append(src[i])
        i += 1
    return out, src


def _radius_law(law: dict[Any, Any], closed: bool = False) -> tuple[list[float], list[float]]:
    """The positions (0 to 1, rising, from 0 to 1) and radii of a ``{position: radius}`` law of
    :meth:`Part.fillet`: a missing 0 or 1 takes the radius given nearest to it along the run (around a
    ``closed`` one, where 0 and 1 are one place, nearest around it)."""
    if not isinstance(law, dict) or not law:
        raise ValueError("fillet: a {position: radius} law needs at least one radius")
    items = []
    for key, value in law.items():
        try:
            at, r = float(key), float(value)
        except (TypeError, ValueError):
            raise TypeError("fillet: a radius law maps positions along the run (0 to 1) to radii, both "
                            "numbers") from None
        if not (math.isfinite(at) and 0.0 <= at <= 1.0):
            raise ValueError(f"fillet: a position along the run lies from 0 (its start) to 1 (its end), not {key!r}")
        if not (math.isfinite(r) and r > 0):
            raise ValueError("fillet: the radius must be positive")
        items.append((at, r))
    items.sort()
    first, last = items[0], items[-1]
    if closed:
        # (0 and 1 are one place: the radius given there, or the one nearest it around the run)
        given = [r for a, r in items if a in (0.0, 1.0)]
        end = given[0] if given else (first[1] if first[0] <= 1.0 - last[0] else last[1])
        first, last = (0.0, end), (1.0, end)
    if items[0][0] > 0.0:
        items.insert(0, (0.0, first[1]))
    if items[-1][0] < 1.0:
        items.append((1.0, last[1]))
    return [a for a, _ in items], [r for _, r in items]


def _closed_chain(edges: Sequence[Edge]) -> bool:
    """Whether edges in a chain (``_law_chains``) close a loop: each vertex at the end of two of them."""
    count: dict[Vertex, int] = {}  # (the vertices kept, so that their identities stay)
    for e in edges:
        vs = list(e.vertices())
        for v in (vs * 2 if len(vs) == 1 else vs):  # (a closed edge: its one vertex at both ends)
            count[v] = count.get(v, 0) + 1
    return bool(count) and all(c == 2 for c in count.values())


def _law_chains(edges: Sequence[Edge]) -> list[list[int]]:
    """``edges`` in chains of edges that run into each other tangentially (:func:`_continues`), as indices,
    each chain in order along it: in the direction of its first edge in ``edges`` (from that edge's start
    to its end), from the end of the chain that direction starts at; a closed chain starts at the start of
    its first edge. Every edge lies in one chain (an edge that continues none is a chain of its own)."""
    index = {e._identity(): i for i, e in enumerate(edges)}

    def vertex_at(e: Edge, p: Vector) -> Vertex | None:
        near = 1e-9 * max(1.0, e.length)
        return next((v for v in e.vertices() if v.point.distance_to(p) <= near), None)

    def step(i: int, v: Vertex) -> tuple[int, Vertex | None] | None:
        """The edge that continues edges[i] through its vertex v, and its vertex at the other end."""
        e = edges[i]
        if e._e is None or e._owner is None:
            return None
        for g in v.edges():
            j = index.get(g._identity())
            if j is None or j == i or not _continues(e, g, v):
                continue
            g = edges[j]
            far = [w for w in g.vertices() if w._identity() != v._identity()]
            return j, (far[0] if far else None)
        return None

    def walk(i: int, v: Vertex | None, seen: set[int]) -> tuple[list[int], bool]:
        """The edges after edges[i] through v, and whether the walk came back to edges[i]."""
        first = i
        out: list[int] = []
        while v is not None:
            nxt = step(i, v)
            if nxt is None:
                break
            j, v = nxt
            if j in seen:
                return out, j == first
            seen.add(j)
            out.append(j)
            i = j
        return out, False

    chains: list[list[int]] = []
    done: set[int] = set()
    for i, e in enumerate(edges):
        if i in done:
            continue
        seen = {i}
        start, end = (None, None) if e.is_closed else (vertex_at(e, e.start), vertex_at(e, e.end))
        after, closed = walk(i, end, seen)
        before: list[int] = []
        if not closed:
            before, _ = walk(i, start, seen)
        chain = list(reversed(before)) + [i] + after
        done.update(chain)
        chains.append(chain)
    return chains


def _run_on_hint(sel: Sequence[Edge], what: str) -> str | None:
    """The hint for a round of ``sel`` (without propagation) that the kernel refused: the first
    selected edge that an edge that is not selected continues tangentially, and where."""
    keys = {e._identity() for e in sel}
    for e in sel:
        if e._e is None or e._owner is None:
            continue
        ends = [v.point for v in e.vertices()
                if any(g._identity() not in keys and _continues(e, g, v) for g in v.edges())]
        if ends:
            verb = "bevel" if what == "chamfer" else "round"
            return (f"the edge from {_fmt_point(e.start)} to {_fmt_point(e.end)} runs on tangentially into an edge "
                    f"that is not selected at {' and '.join(_fmt_point(p) for p in ends)}, which the kernel cannot "
                    f"always {verb} alone; select the whole run (propagate=True, the default, or edge.tangent_chain())")
    return None


def _distance_to_edge(e: Edge, p: Vector) -> float:
    """Distance from a point to an edge (analytic for straight edges)."""
    if e.geom_type == "line":
        a, b = e.start, e.end
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-300)))
        return (a + ab * t).distance_to(p)
    return e.distance_to(p)


def _solid_groups(brep: Any) -> list[list[int]]:
    """The closed regions of a body that are not cavities (numbered as ``ext.region_shells``
    numbers them), grouped across the faces two of them share: the touching cells of a merged part
    form one group, a body inside a cavity of another a group of its own."""
    d = ext.brep_dump(brep, False)
    regions = d["regions"]
    cell = {}  # region -> its number among the regions that are not cavities
    for i, r in enumerate(regions):
        if not r["infinite"] and not r["void"]:
            cell[i] = len(cell)
    region_of = {s: i for i, r in enumerate(regions) for s in r["shells"]}
    parent = list(range(len(cell)))

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for f in d["faces"]:
        sides = {region_of.get(u["shell"]) for u in f["uses"] if u is not None and u["shell"] is not None}
        found = [cell[r] for r in sides if r in cell]
        if len(found) == 2:
            parent[root(found[0])] = root(found[1])
    groups: dict[int, list[int]] = {}
    for i in range(len(cell)):
        groups.setdefault(root(i), []).append(i)
    return list(groups.values())


def _islands(part: Part) -> list[Part]:
    """A body of ``ext.separate_bodies`` as the bodies in it that share no face. The kernel keeps a
    body inside a cavity of another with that one (SmBrep::CreateOneBrepPerBody keeps nested shells
    together). Each group of :func:`_solid_groups` becomes a body as :meth:`Part.cells` builds a
    cell (its outer shell less its cavities), a group of several cells their merge. Where that
    fails, the body stays whole, as the kernel gave it (kernel plan B16)."""
    try:
        if k.material_census(part._brep)["solid_count"] <= 1:  # (cheap)
            return [part]
        groups = _solid_groups(part._brep)
    except RuntimeError:
        return [part]
    if len(groups) <= 1:
        return [part]
    try:
        with kernel_call("solids"):
            regions = ext.region_shells(part._brep)
        solids = [[Part._wrap(b, name=part.name, color=part.color) for b in shells] for shells in regions]
        bodies = []
        for group in groups:
            cells = [outer.cut(cavities) if cavities else outer for outer, *cavities in (solids[c] for c in group)]
            bodies.append(cells[0] if len(cells) == 1 else cells[0].merge(cells[1:]))
    except ModelingError:  # (also a KernelError)
        return [part]
    return bodies


def _same_sources(src: BrepHandle, dst: BrepHandle, m: np.ndarray | None = None) -> None:
    """Carries what a merged part was merged from, and a cell's sources, over to a copy of it moved
    by the placement ``m`` (kernel plan B15)."""
    if src.merged is not None:
        placement = src.merged["placement"] if m is None else m @ src.merged["placement"]
        dst.merged = {"parts": src.merged["parts"], "placement": placement, "cells": None}
    dst.sources = src.sources


# The tries of _cell_points, round by round: (the face of the cell, the step into it as a part of
# the merged part's size).
_CELL_TRIES = [[(0, 0.03)], [(0, 0.003), (1, 0.03)], [(1, 0.003), (2, 0.03), (2, 0.003)],
               [(0, 3e-4), (1, 3e-4), (2, 3e-4)]]


def _cell_points(part: Part, solids: Sequence[Sequence[Part]]) -> list[Vector | None]:
    """Per cell of a merged part (given as its solids from ``ext.region_shells``, the outer one
    first), a point inside it: from a point on one of the outer solid's first three faces, a step
    into the cell that the part itself classifies into that cell, round by round (_CELL_TRIES) for
    the cells not found yet (the classification costs about 0.25 ms a point on a part of 28
    cells). None where none is found."""
    size = max(part._extent(), 1.0)
    starts: list[list[tuple[Vector, Vector] | None]] = []
    for outer, *_ in solids:
        mine: list[tuple[Vector, Vector] | None] = []
        for f in list(outer.faces())[:3]:
            try:
                p = f.interior_point()
                mine.append((p, f.normal_at(p)))
            except (RuntimeError, ValueError):  # a face the kernel cannot place a point on
                mine.append(None)
        starts.append(mine)
    found: list[Vector | None] = [None] * len(solids)
    for tries in _CELL_TRIES:
        points: list[Vector] = []
        owners: list[int] = []
        for i, mine in enumerate(starts):
            if found[i] is not None:
                continue
            for face, step in tries:
                if face < len(mine) and mine[face] is not None:
                    p, n = mine[face]  # type: ignore[misc]
                    points.append(p - n * (step * size))
                    owners.append(i)
        if not points:
            break
        for q, i, (where, _, cell) in zip(points, owners, part._classify(points)):
            if where == "inside" and cell == i and found[i] is None:
                found[i] = q
    return found


def _merge_sources(part: Part, points: Sequence[Vector]) -> list[list[Part]]:
    """Per point, the parts a merged part was merged from whose material holds it (a part that was
    itself merged stands for its own parts); the part itself for a part that was not merged."""
    info = part._h.merged
    if info is None:
        return [[part] if where != "outside" else [] for where, _, _ in part._classify(points)]
    back = np.linalg.inv(info["placement"])
    local = [Vector((back @ np.array([p.x, p.y, p.z, 1.0]))[:3]) for p in points]
    out: list[list[Part]] = [[] for _ in points]
    for x in info["parts"]:
        for found, more in zip(out, _merge_sources(x, local)):
            found.extend(s for s in more if not any(s is y for y in found))
    return out


def _cell_sources(part: Part, solids: Sequence[Sequence[Part]] | None = None) -> list[tuple[Part, ...]] | None:
    """Per cell of a merged part (in the order of ``ext.region_shells``, given as ``solids`` where
    the caller has them), the parts given to merge that it lies in; None for a part that does not
    come from a merge. A point inside each cell (:func:`_cell_points`) is classified against the
    parts; a cell where none is found has no sources."""
    info = part._h.merged
    if info is None:
        return None
    if info["cells"] is None:
        if solids is None:
            with kernel_call("cells"):
                regions = ext.region_shells(part._brep)
            solids = [[Part._wrap(b) for b in shells] for shells in regions]
        points = _cell_points(part, solids)
        known = [i for i, p in enumerate(points) if p is not None]
        found = _merge_sources(part, [points[i] for i in known]) if known else []
        cells: list[tuple[Part, ...]] = [()] * len(solids)
        for i, sources in zip(known, found):
            cells[i] = tuple(sources)
        info["cells"] = cells
    return info["cells"]


def _source_label(sources: Sequence[Part], name: str | None, color: Any) -> tuple[str | None, Any]:
    """The name and color of a cell of a merged part: the names of its sources joined by ``&``
    (each once), the color of the last of them that has one; ``name`` and ``color`` (the merged
    part's) where none has one."""
    names: list[str] = []
    for s in sources:
        if s.name and s.name not in names:
            names.append(s.name)
    colors = [s.color for s in sources if s.color is not None]
    return ("&".join(names) if names else name), (colors[-1] if colors else color)


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


def _volume_problem(result: Part, part: Part, tools: Sequence[Part], op: Any) -> bool:
    """Whether the volume of a Boolean's result lies outside the bounds the operands' set (within
    1e-3): a union holds the largest body and no more than all; an intersection no more than the
    smallest; a difference no more than the part, and no less than the tools can take of it. The
    volumes are integrated as precisely as ``volume`` asks, so that they are there when it asks."""
    v = float(result._props()["volume"]) if result._brep.face_count() else 0.0
    a = float(part._props()["volume"])
    b = [float(t._props()["volume"]) for t in tools]
    if op == k.BooleanOp.UNION:
        return not max(a, *b) * (1 - 1e-3) <= v <= (a + sum(b)) * (1 + 1e-3)
    if op == k.BooleanOp.INTERSECTION:
        return not v <= min(a, *b) * (1 + 1e-3)
    return not a - sum(b) - 1e-3 * a <= v <= a * (1 + 1e-3)


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


def _round_step(operation: str, hint: str, brep: Any, kedges: list[Any], radii: list[float], sections: list[int],
                radii2: list[float], faces: list[Any], law: list[float], continuity: int, thumbweight: float,
                tolerance_factor: float, mitre: bool, chains: list[list[int]] = (),  # type: ignore[assignment]
                law_at: list[float] = (), law_radii: list[float] = (),  # type: ignore[assignment]
                setback: float = 0.0) -> tuple[Any, dict[str, Any]]:
    """The kernel's fillet executive rounding ``kedges`` of ``brep`` (changed in place): the Brep and
    the executive's record of how it failed (``ext.round_edges``). A step of its own, so that it can
    run in another process (``smlibpy._guard.isolated``)."""
    with kernel_call(operation, hint):
        record = ext.round_edges(brep, kedges, radii, sections, radii2, faces, law, continuity, thumbweight,
                                 tolerance_factor, mitre, [list(c) for c in chains], list(law_at), list(law_radii),
                                 setback)
    if record["status"] is not None:  # (where the kernel gave up, KernelError.trace: from this process)
        record = dict(record, trace=tuple(ext.kernel_trace()[0]))
    return brep, record


def _preview_step(hint: str, brep: Any, kedges: list[Any], radius: float) -> list[Any]:
    """The kernel's preview of circular rounds of ``kedges`` of ``brep`` (``k.fillet_preview``): a sheet
    Brep (the caller's) per round surface. A step of its own, so that it can run in another process."""
    with kernel_call("fillet_preview", hint):
        surfaces = k.fillet_preview(brep, kedges, radius=radius)
    out: list[Any] = []
    try:
        for srf in surfaces:
            with kernel_call("fillet_preview"):
                out.append(ext.face_from_surface(srf))
    finally:
        for srf in surfaces:
            ext.delete_surface(srf)
    return out


def _combine(h: BrepHandle, tool: _Body, op: Any, non_manifold: bool = False) -> None:
    """Combine a copy of a tool into the Brep a handle owns (``ext.boolean``). The kernel changes
    that Brep (or gives a new one in its place, where it turned a seam) and deletes the copy when
    it succeeds, and keeps both when it fails: the handles hold them until then and free them on
    a failure."""
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
    """:func:`kernel_call` for fillets and chamfers, with the hint for a selection the kernel cannot
    round (and where the kernel failed, see :func:`_round_edges`), and for a failure inside the kernel
    (a crash, a null pointer of its own), which says nothing about the size: the size passed the
    checks against the faces before (kernel plan B19)."""
    try:
        with kernel_call(operation, hint):
            yield
    except KernelError as e:
        crash = _crash_note(e, operation)
        where = getattr(e, "_where", None)
        if crash is not None:
            size = "length" if operation == "chamfer" else "radius"
            at = f" (it could not build {where})" if where else ""
            raise _traced(KernelError(e.operation, e.detail, e.status,
                                      f"{crash}{at}, which says nothing about the {size} (it fits the faces around "
                                      f"the edges): round the edges in smaller groups to find the one it fails at"),
                          e) from e
        if e.status != "SM_ERR_INVALID_INPUT":
            raise
        raise _traced(KernelError(e.operation, e.detail, e.status,
                                  f"the kernel cannot round the selection as given, at any size: it could not build "
                                  f"{where}; select fewer edges there" if where else _ROUND_SELECTION_HINT), e) from e


# The fillet executive's comments on failures it records, in words (lower case, without its prefix).
_ROUND_COMMENTS = {
    "corner case not implemented": "it has no corner for the way the rounded edges meet there",
    "corner edge computation failure": "it could not compute the edges of the corner",
    "vertex computation failure": "it could not compute the vertices of the corner",
}


#: How much of the room between two edges that run alongside rounds may fill before their result's
#: gaps are measured (see Part._check_volume_change).
_NEAR_LIMIT = 0.9


def _with_finer_rounds(attempt: Callable[[float], Part]) -> Part:
    """``attempt(4.0)``, a fillet or chamfer as SM_API makes it, and where the kernel fails or its body is
    refused, ``attempt(1.0)``: its rounds' edges four times closer to the faces (in edge tolerances). Rounds
    close to the largest radius that fits fail with SM_API's tolerance (a 10 mm cube rounded by 4.98 came
    out open) and are exact with the finer one, as SmApiCircularFillet builds them; the finer one fails
    some rounds that the coarser builds, so it comes second. Selections the kernel cannot round at any size
    (``SM_ERR_INVALID_INPUT``) are not tried again. The error is the first attempt's."""
    try:
        return attempt(4.0)
    except ModelingError as first:  # (a KernelError too)
        if isinstance(first, KernelError) and first.status == "SM_ERR_INVALID_INPUT" or getattr(first, "timed_out", False):
            raise  # (nor after GUARD_SECONDS ran out: the finer one would take as long)
        try:
            return attempt(1.0)
        except ModelingError:
            raise first from first.__cause__


# The step of the fillet executive that failed (its status, ``ext.round_edges``'s "stage"), in words.
_ROUND_STAGES = {
    "surface_intersection": "the offsets of its faces did not meet",
    "end_point": "it could not place an end of the round",
    "squeeze": "an edge of the round shrank to nothing",
    "rail_interpolation": "it could not join the sides of the round",
    "rail_edge": "a side of the round does not reach the edge it should end on",
    "solver": "its solver did not converge",
    "tracing": "it could not trace the round's surface",
    "self_intersection": "the round's surface runs into itself",
    "skinning": "it could not build the round's surface",
}


def _round_failure(record: dict[str, Any], edges: Sequence[Edge]) -> str | None:
    """What the kernel's fillet executive could not build, in words (from its record, see
    ``ext.round_edges``): the corner at a vertex, the round of a selected edge, or the round at a point,
    and why where it says (its comment, and the step that failed); None where it recorded none."""
    comment = str(record.get("comment") or "")
    for prefix in ("Fillet Corner Error:", "Fillet Edge Error:", "Fillet Solver Error:", "Fillet Error:"):
        if comment.startswith(prefix):
            comment = comment[len(prefix):]
    comment = comment.strip().rstrip(".").lower()
    why = _ROUND_COMMENTS.get(comment, comment)
    stage = _ROUND_STAGES.get(str(record.get("stage") or ""), "")
    if stage:
        why = f"{why}: {stage}" if why else stage
    if record.get("vertex") is not None:
        what = f"the corner at {_fmt_point(Vector(*record['vertex']))}"
    elif 0 <= int(record.get("edge", -1)) < len(edges):
        e = edges[int(record["edge"])]
        what = (f"the round of the closed edge through {_fmt_point(e.start)}" if e.is_closed else
                f"the round of the edge from {_fmt_point(e.start)} to {_fmt_point(e.end)}")
    elif record.get("location") is not None:
        what = f"the round at {_fmt_point(Vector(*record['location']))}"
    else:
        return None
    return what + (f" ({why})" if why else "")


def _round_edges(operation: str, hint: str, brep: Any, kedges: Sequence[Any], edges: Sequence[Edge],
                 radii: Sequence[float], sections: Sequence[int], *, radii2: Sequence[float] = (),
                 faces: Sequence[Any] = (), law: Sequence[float] = (), continuity: int = 1,
                 thumbweight: float = 1.0, tolerance_factor: float = 4.0, mitre: bool = False,
                 isolate: bool = False, chains: Sequence[Sequence[int]] = (), law_at: Sequence[float] = (),
                 law_radii: Sequence[float] = (), setback: float = 0.0) -> Any:
    """Round ``kedges`` of ``brep`` (a copy; ``edges`` are this part's edges they are) with
    ``ext.round_edges`` (the kernel's fillet executive, as ``k.fillet_edges`` and its siblings drive it),
    in place; with ``isolate`` (a part read from a file: the kernel's fillet code crashed on some), in
    another process, which gives back a new Brep (see ``smlibpy.defeature.GUARD_SECONDS``). Returns the
    Brep that holds the result: ``brep``, or the one from the other process, which is the caller's.
    A failure raises :class:`KernelError` whose hint begins with the corner or edge the executive names
    (``_where``, see :func:`_round_failure`), then ``hint``."""
    args = (list(kedges), [float(r) for r in radii], [int(x) for x in sections], [float(r) for r in radii2],
            list(faces), [float(r) for r in law], int(continuity), float(thumbweight), float(tolerance_factor),
            bool(mitre), [[int(i) for i in c] for c in chains], [float(x) for x in law_at],
            [float(r) for r in law_radii], float(setback))
    if isolate:
        from ._guard import isolated

        out, record = isolated(operation, _round_step, operation, hint, brep, *args)
    else:
        out, record = _round_step(operation, hint, brep, *args)
    status = record["status"]
    if status is None:
        return out
    if out is not brep:
        ext.delete_brep(out)  # (the other process's copy of a failed round)
    where = _round_failure(record, edges)
    detail = f"{operation} failed: {status}" + (f" ({record['comment']})" if record.get("comment") else "")
    error = KernelError(operation, detail, status, f"the kernel could not build {where}; {hint}" if where else hint)
    error._where = where  # type: ignore[attr-defined]
    error.trace = tuple(record.get("trace") or ())
    raise error


def _straight_around(face: Face, center: Vector, axis: Vector, start: Vector, step: Vector, normal: Vector) -> bool:
    """Whether ``face`` runs straight from ``start`` (on a circle about ``axis`` through ``center``) by
    ``step``, with the ``normal`` it has at ``start``, all around the axis: a surface of revolution about
    it whose meridian is straight there (sampled halfway and at the end, at four angles)."""
    near = 1e-7 * max(start.distance_to(center), step.length, 1.0)

    def turned(v: Vector, quarter: int) -> Vector:  # (by quarter turns about the axis)
        along = axis * v.dot(axis)
        across = v - along
        return along + (across if quarter == 0 else axis.cross(across) if quarter == 1 else
                        -across if quarter == 2 else -axis.cross(across))

    for quarter in range(4):
        n = turned(normal, quarter)
        for k in (0.5, 1.0):
            p = center + turned(start + step * k - center, quarter)
            try:
                if face.distance_to(p) > near or face.normal_at(p).dot(n) < 1.0 - 1e-9:
                    return False
            except (KernelError, ValueError):
                return False
    return True


def _corner_style(operation: str, corners: str) -> bool:
    """Whether ``corners`` (of :meth:`Part.fillet` or :meth:`Part.chamfer`) asks for mitred corners
    (``"mitre"``, or the American ``"miter"``)."""
    if corners not in ("patch", "mitre", "miter"):
        raise ValueError(f'{operation}: corners must be "patch" or "mitre" (or "miter"), not {corners!r}')
    return corners != "patch"


def _mitred_corners(edges: Sequence[Edge]) -> list[Vector]:
    """The corners ``corners="mitre"`` mitres: where three of ``edges`` meet, all convex, and no other
    edge (the kernel mitres those only: SmFilletConvexNxNCorner)."""
    rounded = {e._identity() for e in edges}
    seen: set[Any] = set()
    out = []
    for e in edges:
        for v in e.vertices():
            key = v.point.to_tuple()  # (not v._identity(): a dropped vertex wrapper's id is reused)
            if key in seen:
                continue
            seen.add(key)
            at = v.edges()
            if (len(at) == 3 and all(x._identity() in rounded for x in at)
                    and all(x.convexity == "convex" for x in at)):
                out.append(v.point)
    return out


def _require_mitred_corners(operation: str, edges: Sequence[Edge]) -> None:
    """Raise where ``corners="mitre"`` would mitre no corner of the rounded ``edges``."""
    if not _mitred_corners(edges):
        raise ValueError(
            f'{operation}: corners="mitre" mitres the corners where three rounded convex edges meet and no '
            f"other edge, and the selection has none (round all three edges of a corner)")


def _set_back_corners(edges: Sequence[Edge]) -> list[tuple[Vertex, list[Edge]]]:
    """The corners ``setback=`` sets back, with their edges: where three or more of ``edges`` meet and
    no other edge, all convex or all concave. (The kernel sets back the corners where no face turns
    inward at the vertex, SmFilletConvexNxNCorner's; at a vertex of three edges those are the ones
    whose edges are all convex or all concave. Where a face turns inward, SmFilletConcaveNxNCorner
    hands the setback to the same code, which builds broken bodies there: not offered.)"""
    rounded = {e._identity() for e in edges}
    kinds = dict(zip((e._identity() for e in edges), _convexities(list(edges))))
    seen: set[Any] = set()
    out = []
    for e in edges:
        for v in e.vertices():
            key = v.point.to_tuple()  # (not v._identity(): a dropped vertex wrapper's id is reused)
            if key in seen:
                continue
            seen.add(key)
            at = list(v.edges())
            if len(at) < 3 or not all(x._identity() in rounded for x in at):
                continue
            if len({kinds[x._identity()] for x in at}) == 1 and kinds[at[0]._identity()] in ("convex", "concave"):
                out.append((v, at))
    return out


def _check_set_back_corners(edges: Sequence[Edge], radii: Sequence[float], setback: float) -> float:
    """Check ``setback=`` of a fillet of ``edges`` with ``radii``: a corner to set back, a setback
    beyond where the rounds of each such corner cross its edges (a round of radius r reaches
    r tan(theta/2) across a face, theta the turn between the faces; across a face corner of angle phi
    that crosses the next edge 1/sin(phi) as far along it) and below the length of each rounded edge
    there (half of it where both ends are set back). Returns what the set-back corners can take away
    or add (for the volume check)."""
    corners = _set_back_corners(edges)
    if not corners:
        raise ValueError(
            "fillet: setback= sets back the corners where three or more rounded edges meet and no other edge, all "
            "convex or all concave, and the selection has none (round every edge of a corner)")
    radius_of = {e._identity(): r for e, r in zip(edges, radii)}
    ends: dict[Any, int] = {}
    total = 0.0
    for v, at in corners:
        p = v.point
        need = 0.0
        for e in at:
            for f in e.faces():
                for g in at:
                    if g._identity() == e._identity() or f._identity() not in {x._identity() for x in g.faces()}:
                        continue
                    width = Part._setback(g, radius_of[g._identity()])
                    phi = math.radians(max(min(a.angle_to(b) for a in _leaving(e, p) for b in _leaving(g, p)), 1e-6))
                    need = max(need, width / max(math.sin(phi), 1e-6))
        if setback <= need * (1 + 1e-9):
            raise ValueError(
                f"fillet: the setback must exceed how far the rounds reach along the edges of the corner at "
                f"{_fmt_point(p)} ({need:.4g}); give a larger setback")
        for e in at:
            ends[e._identity()] = ends.get(e._identity(), 0) + 1
        total += setback ** 3 * (len(at) - 2)
    for e in edges:
        k = ends.get(e._identity(), 0)
        if k and setback * k >= e.length * (1 - 1e-9):
            raise ValueError(
                f"fillet: the setback {setback:.4g} is too large for the edge from {_fmt_point(e.start)} to "
                f"{_fmt_point(e.end)} ({e.length:.4g} long{', set back at both ends' if k == 2 else ''}): its "
                f"corners would meet; give a setback below {e.length / k:.4g}")
    return total


def _extended_face(face: Face, distance: float, sides: Any, continuity: str, what: str) -> Any:
    """The brep of :meth:`Face.extend`."""
    d = float(distance)
    if not (d > 0 and math.isfinite(d)):
        raise ValueError(f"{what}: the distance must be positive, got {distance}")
    kinds = {"natural": 0, "g1": 1, "g2": 2}
    level = kinds.get(continuity.lower()) if isinstance(continuity, str) else None
    if level is None:
        raise ValueError(f'{what}: continuity is "natural", "G1" or "G2", got {continuity!r}')
    edges: list[Edge] = []
    if sides is not None:
        edges = [sides] if isinstance(sides, Edge) else list(sides)
        if not edges or not all(isinstance(e, Edge) for e in edges):
            raise TypeError(f"{what}: sides are edges of the face")
        own = {e._identity() for e in face.edges(seams=True)}
        if any(e._identity() not in own for e in edges):
            raise ValueError(f"{what}: an edge in sides does not bound the face")
    try:
        with kernel_call(what, "try a shorter distance, or continuity G1"):
            return ext.extend_face(face._f, d, [e._e for e in edges], level)
    except ValueError as e:
        raise ValueError(str(e).replace("extend_face:", f"{what}:", 1)) from None


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


def _as_curves(tool: Any) -> list[Edge | Wire] | Edge | Wire | None:
    """``tool`` as curves where it is curves (an edge, a wire, or a list of them, none empty), else
    None (a body, a face, a list of faces, anything else)."""
    if isinstance(tool, (Edge, Wire)):
        return tool
    if isinstance(tool, (Face, _Body, Vertex, str, bytes)) or not isinstance(tool, Iterable):
        return None
    items = list(tool)
    if items and all(isinstance(x, (Edge, Wire)) for x in items):
        return items
    return None


def _curves_of(items: Any, what: str) -> list[Edge]:
    """The edges of curves given as edges, wires or lists of them."""
    if isinstance(items, (Face, _Body, Vertex)):
        raise TypeError(f"{what} takes curves (edges or wires), not a {type(items).__name__}")
    try:
        edges = _flatten_edges(items)
    except TypeError:
        raise TypeError(f"{what} takes curves (edges or wires), not a {type(items).__name__}") from None
    if not edges:
        raise ValueError(f"{what}: no curves")
    return edges


def _trim_with_curves(body: _Body, edges: Sequence[Edge], point: Vector, trim_type: int, what: str) -> Any:
    """A copy of the body with its faces trimmed by curves that lie on them (ext.trim_with_curves):
    trim_type 0 keeps the side of ``point``, 2 splits."""
    box = body.bbox()
    for e in edges:
        box = box.union(e.bbox())
    tol = max(1e-5 * box.diagonal, 1e-7)
    curves = [e._copy_curve() for e in edges]
    try:
        with kernel_call(what, "the curves may cross each other, or run along an edge of the faces"):
            return ext.trim_with_curves(body._brep, curves, point.to_tuple(), trim_type, tol)
    except ValueError as e:
        if "does not lie" not in str(e):
            raise
        raise ValueError(f"{what}: the curves must lie on the faces (within {tol:.2g}); move them onto them with "
                         f"project()") from None
    finally:
        for c in curves:
            ext.delete_curve(c)


def _swept_onto(body: _Body, edges: Sequence[Edge], d: Vector) -> list[Edge]:
    """Where curves moved along ``d`` cross the body's faces: the curves where the surface they
    sweep meets the body (exact where the kernel's projection, project(), is within 4e-4)."""
    from .surfaces import ruled

    box = body.bbox()
    out: list[Edge] = []
    for e in edges:
        reach = 2.0 * (box.diagonal + (e.center() - box.center).length) + 1.0
        sweep = ruled(e, e.translate(d * reach))
        if _disjoint(box, sweep.bbox()):
            continue
        try:
            out.extend(body.intersection_curves(sweep))
        except KernelError:
            # (the kernel's intersection fails where there is none)
            if body.distance_to(sweep) > 1e-7 * reach:
                continue
            raise
    return out


def _seen_along(body: _Body, edge: Edge, d: Vector) -> bool:
    """True when a curve on the body is what rays along ``d`` meet first (at most of three points:
    a ray can miss a face where it passes a seam)."""
    reach = 2.0 * body.bbox().diagonal + 1.0
    seen = 0
    for t in (0.25, 0.5, 0.75):
        m = edge.point_at(t)
        hits = body.raycast(m - d * reach, d)
        seen += bool(hits) and (hits[0].point - m).length <= 1e-5 * reach
    return seen >= 2


class Shell(_Body):
    """A sheet body: one or more faces that do not enclose a volume (surfaces)."""

    __slots__ = ()

    @classmethod
    def from_nurbs(cls, nurbs: Any) -> Shell:
        """The sheet of a NURBS surface given by its data: the inverse of :meth:`Face.nurbs`, as
        :meth:`Edge.from_nurbs` is for curves (:func:`~smlibpy.nurbs_surface` with the data in
        :class:`~smlibpy.NurbsSurface`'s order)::

            n = face.nurbs()
            rows = [list(row) for row in n.points]
            rows[1][1] = Vector(rows[1][1]) + (0, 0, 2)  # pull one control point up
            bumped = Shell.from_nurbs(n._replace(points=rows))

        Args:
            nurbs: A :class:`~smlibpy.NurbsSurface` (what ``Face.nurbs()`` returns), or a tuple
                ``(degrees, knots, points, weights)``: the degrees ``(u, v)``, the knot vectors
                ``(u_knots, v_knots)``, the control points in rows (``points[i][j]`` the point
                ``i`` along u and ``j`` along v) and a weight per point in the same rows, or
                ``None`` for a non-rational surface.
        """
        from .surfaces import nurbs_surface

        if all(hasattr(nurbs, a) for a in ("degrees", "knots", "points")):
            degrees, knots, points, weights = nurbs.degrees, nurbs.knots, nurbs.points, getattr(nurbs, "weights", None)
        elif isinstance(nurbs, (tuple, list)) and len(nurbs) == 4:
            degrees, knots, points, weights = nurbs
        else:
            raise TypeError(f"Shell.from_nurbs: expected a NurbsSurface or (degrees, knots, points, weights), got "
                            f"{type(nurbs).__name__}")
        return nurbs_surface(points, knots, degrees, weights)

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

    def offset(self, distance: float) -> Shell:
        """The sheet moved by ``distance`` along its face normals (a negative distance against them):
        each face offset, and where faces meet, extended or trimmed to meet again (sharp edges, as
        :meth:`Part.offset`). 0 gives an equal copy. Faces that touch along edges they do not share
        (faces copied one by one, or put together with ``+``) are joined along them first, where their
        normals agree (:func:`~smlibpy.stitch` without turning a face); faces apart from the others, or
        whose normals disagree with their neighbours', move each on its own.

        Results the kernel gets wrong (no faces, faces closer to the sheet than ``distance``, on its
        other side, or nowhere at that distance from it) raise :class:`ModelingError`; so does an
        offset beyond the radius of a concave curvature. The kernel step runs in a forked copy of
        the process (Linux, macOS), as for :meth:`thicken`."""
        from .defeature import _isolated

        d = float(distance)
        if not math.isfinite(d):
            raise ValueError("offset: the distance must be a finite number")
        if d == 0:
            return self._like(self._copy_brep())
        hint = ("the kernel cannot offset this sheet by that much (beyond the radius of a concave curvature, "
                "or where faces vanish); use a smaller distance")

        sheet = self._joined()

        def work() -> Any:
            with kernel_call("offset", hint):
                return k.offset_brep(sheet._brep, d)  # (its defaults: the extended mode, with self-intersections)

        result = Shell._wrap(_isolated("offset", work), name=self.name, color=self.color)
        problem = _sheet_offset_problem(self, result, d)
        if problem is not None:
            raise ModelingError(f"offset: the kernel could not offset the sheet by {d:.6g} (it built {problem}); "
                                f"{hint}")
        return result

    def _joined(self) -> Shell:
        """This sheet, or where faces of it touch along edges they do not share (faces copied one by one), a
        copy with those edges sewn (within 1e-7 of its size), where that turns no face over (the kernel's
        offset moves faces that share no edges each on its own, and closes nothing between them)."""
        if len(self.faces()) < 2 or not any(len(e.faces()) == 1 for e in self.edges()):
            return self
        with kernel_call("offset"):
            h = BrepHandle(self._copy_brep())
            r = ext.stitch_faces(h.brep, max(1e-7 * self.bbox().diagonal, 1e-9))
        if not r["sewn"] or r["turned"]:
            return self
        return self._like(_take(h))

    def trim(self, curves: Edge | Wire | Iterable[Edge | Wire], keep: VectorLike | str) -> Shell:
        """Cut the sheet along curves that lie on it, and keep one side, or both as faces of their own.

        Args:
            curves: Edges or wires on the sheet: where two sheets meet (:meth:`intersection_curves`),
                the long edges of a :func:`~smlibpy.surface_fillet`, curves projected onto the sheet
                (:meth:`project`). A curve may run across several faces of the sheet. Each one runs
                from border to border, or closes a loop (a hole or an outline).
            keep: A point on the side to keep, or near it (not on a curve): the faces it reaches
                without crossing a curve are kept. ``"split"`` keeps both sides, as faces of their
                own.

        Returns:
            The trimmed sheet (a new one; this one does not change).

        To cut along a direction instead (a hole through a curved panel), project the outline
        first: ``sheet.trim(sheet.project(Circle(5).edges(), (0, 0, -1)), keep=(0, 0, 0))`` keeps
        the disk.
        """
        split = isinstance(keep, str)
        if split and keep != "split":
            raise ValueError(f'trim: keep is a point on the side to keep, or "split"; got {keep!r}')
        point = Vector() if split else _vec(keep)
        edges = _curves_of(curves, "trim")
        before = self.area
        n = len(self.faces())
        b = _trim_with_curves(self, edges, point, 2 if split else 0, "trim")
        out = self._like(b)
        after = out.area if out.faces() else 0.0
        tol = 1e-4 * max(before, 1e-12)
        if split:
            if len(out.faces()) <= n or abs(after - before) > tol:
                raise ModelingError("trim: the curves do not split the sheet: each must run across a face from "
                                    "border to border, or close a loop on it")
        elif not out.faces():
            raise ModelingError("trim: nothing is left; the point lies on no side the curves cut off")
        elif not after < before - tol:
            raise ModelingError("trim: the curves do not cut the sheet in two: each must run across a face from "
                                "border to border, or close a loop on it")
        return out

    def flipped(self) -> Shell:
        """The sheet turned over: a copy whose faces' normals all point the other way.

        :meth:`thicken` then grows to the other side, and the ``sides`` of
        :func:`~smlibpy.surface_fillet` count from the new normals. A sheet that encloses a volume
        (the face of a whole sphere) faces outward whichever way its surface runs: it cannot be
        turned over (``ValueError``).
        """
        with kernel_call("flipped"):
            b = ext.flip_faces(self._brep)
        out = self._like(b)
        for before, after in zip(self.faces(), out.faces()):
            p = before.interior_point()
            if not before.normal_at(p).dot(after.normal_at(p)) < 0:
                raise ValueError("flipped: the sheet encloses a volume; its faces point out of it whichever way "
                                 "their surfaces run")
        return out

    def extend(self, distance: float, *, sides: Edge | Iterable[Edge] | None = None,
               continuity: str = "natural") -> Shell:
        """The sheet (of one face) grown past its sides: see :meth:`Face.extend`.

        Args:
            distance: How far past each side, measured along the surface.
            sides: Edges of the sheet: grow past the sides they lie on only. Default: every side that
                can grow.
            continuity: ``"natural"`` (default), ``"G1"`` or ``"G2"``.

        Returns:
            A new sheet; this one does not change. For a sheet of several faces, extend one of its
            faces (``sheet.faces()[i].extend(...)``).
        """
        faces = self.faces()
        if len(faces) != 1:
            raise ValueError(f"extend: the sheet has {len(faces)} faces; extend one of them with "
                             f"sheet.faces()[i].extend(...)")
        return self._like(_extended_face(faces[0], distance, sides, continuity, "extend"))

    def match_edge(self, edge: Edge, target: Edge | Wire, *, extent: float = 0.25) -> Shell:
        """The sheet with an edge moved onto a curve: the edge runs along ``target`` from end to end,
        exactly, and its face bends to follow, smoothly, near the edge only. To close a gap between two
        sheets before :func:`~smlibpy.stitch`, match one sheet's edge to the other's; to give a sheet a
        styling line, match it to that curve.

        Args:
            edge: An edge of the sheet, a whole side of its face.
            target: The curve to run along (an edge, or a wire whose edges join end to end), either
                way round; its ends are where the edge's ends go.
            extent: How far into the face the change reaches: a part of the face's parameter range
                across from the edge (above 0, below 1; default 0.25). The face meets the rest of
                itself there with continuous derivatives (up to its degree less one).

        Where the curve's ends are not the edge's, the edge's vertices move to them, the edges next
        to it bend near those ends, and the faces on the other side of those edges follow them the
        same way, but meet the matched face with a crease near the matched edge (no tangent is kept
        across those side edges: 10 to 20 degrees in a sheet of two faces; merge faces first with
        :meth:`merge_faces` to keep a sheet smooth). Every face that changes must be bounded by the
        four sides of its surface (as
        :func:`~smlibpy.surface`, ``loft``, :func:`~smlibpy.ruled`, :func:`~smlibpy.fill` and
        :func:`~smlibpy.network` make them; no holes, no trimmed borders) and the edge a whole side
        of it, else ``ValueError``. The faces become B-splines (planes too).

        Returns:
            A new sheet; this one does not change. A Sketch's comes back as a Shell.
        """
        from . import sheet_edit

        b = sheet_edit.match_edge(self, edge, target, extent)
        return Shell._wrap(b, name=self.name, color=self.color) if isinstance(self, Sketch) else self._like(b)

    def merge_faces(self, a: Face, b: Face) -> Shell:
        """The sheet with two faces made one: one surface over both, where they share a whole side,
        such as the halves of a sheet split along a curve of its surface, or patches built through
        the same curves. The joint's knot goes where the faces meet smoothly enough (within the
        sheet's tolerance), so a split sheet comes back as it was.

        Args:
            a: A face of the sheet, bounded by the four sides of its surface (no holes, no trimmed
                borders).
            b: Another such face, sharing one whole side with ``a`` (and no other).

        The joined surface must reproduce both faces (within the sheet's tolerance), else
        ``ValueError``: faces whose parameters run at different speeds along the shared side, or
        whose normals point to opposite sides, are not merged. The merged face's normal is
        ``a``'s.

        Returns:
            A new sheet with one face less; this one does not change. A Sketch's comes back as a
            Shell.
        """
        from . import sheet_edit

        out = sheet_edit.merge_faces(self, a, b)
        return Shell._wrap(out._copy_brep(), name=self.name, color=self.color) if isinstance(self, Sketch) \
            else self._like(out._copy_brep())

    def push(self, face: Face, at: VectorLike, *, by: float | VectorLike | None = None, to: VectorLike | None = None,
             normal: VectorLike | None = None, radius: float | None = None, continuity: str = "G1") -> Shell:
        """Push or pull a face of the sheet at a point: see :meth:`Part.push` (``by`` as a distance moves
        along the face's normal). Returns a new sheet; a Sketch's comes back as a Shell."""
        from . import shaping

        return shaping.checked(self, shaping.push(self, face, at, by, to, normal, radius, continuity), "push")

    def warp(self, face: Face, region: Any, by: float | VectorLike, *, continuity: str = "G2") -> Shell:
        """Raise or sink a region of a face of the sheet: see :meth:`Part.warp`. Returns a new sheet; a
        Sketch's comes back as a Shell."""
        from . import shaping

        return shaping.checked(self, shaping.warp(self, face, region, by, continuity), "warp")

    def flatten(self, face: Face, region: Any, plane: Plane | Face, *, continuity: str = "G2") -> Shell:
        """Press a region of a face of the sheet onto a plane: see :meth:`Part.flatten`. Returns a new
        sheet; a Sketch's comes back as a Shell."""
        from . import shaping

        return shaping.checked(self, shaping.flatten(self, face, region, plane, continuity), "flatten")

    def __add__(self, other: Any) -> Shell:
        h = BrepHandle(self._copy_brep())
        for t in _bodies(other):
            with kernel_call("fuse"):
                _combine(h, t, k.BooleanOp.UNION)
        return self._like(_take(h))

    def __sub__(self, other: Any) -> Shell:
        """The sheet trimmed by parts: the pieces outside them (``sheet - part``)."""
        return self._trimmed(other, k.BooleanOp.DIFFERENCE, "cut")

    def __and__(self, other: Any) -> Shell:
        """The sheet trimmed by parts: the pieces inside them (``sheet & part``; also
        ``part & sheet``)."""
        return self._trimmed(other, k.BooleanOp.INTERSECTION, "intersect")

    def _trimmed(self, other: Any, op: Any, name: str) -> Shell:
        """The sheet less the pieces inside (or outside) parts. The kernel's Boolean of a sheet and a
        solid trims the sheet; checked: every face of the result lies on the sheet, and its area
        is no more than the sheet's."""
        tools = _bodies(other, name)
        if not tools:
            raise ValueError(f"{name} needs a part")
        for t in tools:
            if not isinstance(t, Part) or isinstance(t, Sketch):
                raise TypeError(f"a sheet is trimmed by parts (sheet - part, sheet & part), not by a {type(t).__name__}")
            t._require_valid(name)
        if self._brep.face_count() == 0:
            return self._like(self._copy_brep())
        h = BrepHandle(self._copy_brep())
        for t in tools:
            if h.brep.face_count() == 0:
                break
            if _disjoint(BoundBox(*h.brep.bounding_box(False)), t._loose_box()):
                if op == k.BooleanOp.INTERSECTION:
                    h = BrepHandle(ext.combine([]))
                continue
            with kernel_call(name, "the sheet may only touch the part, or lie in one of its faces"):
                _combine(h, t, op)
        result = self._like(_take(h))
        if result._brep.is_manifold_solid():
            raise ModelingError(f"{name}: the kernel returned a solid, not a piece of the sheet")
        tol = 1e-5 * max(1.0, self.bbox().diagonal)
        for f in result.faces():
            if self.distance_to(f.interior_point()) > tol:
                raise ModelingError(f"{name}: the kernel returned a face that is not on the sheet")
        if result._brep.face_count() and result.area > self.area * (1 + 1e-6) + tol:
            raise ModelingError(f"{name}: the kernel returned more of the sheet ({result.area:.6g}) than there is "
                                f"({self.area:.6g})")
        return result

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

    def flipped(self) -> Sketch:
        """The sketch turned over: its faces and its plane face the other way (an extrusion then
        grows to the other side)."""
        out = super().flipped()
        out._plane = self._plane.flipped()
        return out

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
            apart = self._boolean2d_apart(tools, op, name)
            if apart is not None:
                return apart
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

    def _boolean2d_apart(self, tools: list[Sketch], op: Any, name: str) -> Sketch | None:
        """The planar Boolean group by group where the faces of the operands lie in groups far apart
        (the whole spans ten times the largest group in which both operands have faces), or None.
        A group is the faces linked by overlapping boxes; groups of one operand's faces only are
        kept as they are (dropped where the Boolean leaves nothing of them). The kernel's planar
        Boolean takes its tolerances from the extent of its operands: a unit square fused to its
        neighbour at a corner, with a third square 1000 away, became a sliver of 0.2778 (kernel
        plan C1)."""
        own = list(self._brep.faces())
        other = [(t, f) for t in tools for f in t._brep.faces()]
        n = len(own)
        if n + len(other) < 3:
            return None
        boxes = np.array([[*lo, *hi] for lo, hi in (f.bounding_box(False) for f in [*own, *(f for _, f in other)])],
                         dtype=float)
        whole = float(np.linalg.norm(boxes[:, 3:].max(axis=0) - boxes[:, :3].min(axis=0)))
        tol = 1e-6 * max(1.0, whole)
        apart = (boxes[:, None, 3:] < boxes[None, :, :3] - tol) | (boxes[None, :, 3:] < boxes[:, None, :3] - tol)
        linked = ~apart.any(axis=2)
        root = list(range(len(boxes)))

        def find(i: int) -> int:
            while root[i] != i:
                root[i] = root[root[i]]
                i = root[i]
            return i

        for i, j in zip(*np.nonzero(np.triu(linked, 1))):
            root[find(int(i))] = find(int(j))
        groups: dict[int, list[int]] = {}
        for i in range(len(boxes)):
            groups.setdefault(find(i), []).append(i)
        if len(groups) < 2:
            return None
        both = [g for g in groups.values() if g[0] < n <= g[-1]]
        size = max((float(np.linalg.norm(boxes[g, 3:].max(axis=0) - boxes[g, :3].min(axis=0))) for g in both),
                   default=0.0)
        if not whole > 10 * size:
            return None
        pieces: list[Sketch] = []
        with kernel_call(name):
            for g in groups.values():
                mine = [own[i] for i in g if i < n]
                theirs: dict[int, list[Any]] = {}
                for i in g:
                    if i >= n:
                        theirs.setdefault(id(other[i - n][0]), []).append(other[i - n][1])
                parts = [t._like(ext.copy_faces(t._brep, theirs[id(t)])) for t in tools if id(t) in theirs]
                if mine and parts:
                    tool = parts[0] if len(parts) == 1 else parts[0]._like(ext.combine([x._brep for x in parts]))
                    pieces.append(self._like(ext.copy_faces(self._brep, mine))._boolean2d_with([tool], op, name))
                elif mine and op != k.BooleanOp2D.INTERSECTION:
                    pieces.append(self._like(ext.copy_faces(self._brep, mine)))
                elif parts and op in (k.BooleanOp2D.UNION, k.BooleanOp2D.EXCLUSIVE_OR):
                    pieces.extend(parts)
        return self._combined(pieces)

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

    def section_properties(self) -> SectionProperties:
        """Area, centroid and second moments of area of the region (a beam's or an extrusion's
        profile): ``ixx``, ``iyy`` and ``ixy`` about the centroid in the axes of the sketch plane,
        the principal moments and axes, the polar moment, the radii of gyration and the section
        moduli (see :class:`SectionProperties`).

        Integrated as the mass properties of a thin slab of the region (to ``ACCURACY`` of the
        largest moment), less the slab's own thickness term."""
        if not self.faces():
            raise ValueError("section_properties: the sketch is empty")
        pl = self._plane
        local = Plane(pl.origin, pl.x_dir, pl.z_dir)
        flat = self.moved(local.location.inverse())  # the region in the plane's axes, on z = 0
        box = flat.bbox()
        h = 0.1 * max(box.diagonal, 1e-9)  # a slab thin against the region, thick enough to integrate
        mp = flat.extrude(h).mass_properties()
        area = mp.volume / h
        c = mp.center
        i = mp.inertia
        slab = area * h ** 3 / 12  # the slab's moment about the x and y axes through its middle
        ixx = (float(i[0][0]) - slab) / h
        iyy = (float(i[1][1]) - slab) / h
        ixy = -float(i[0][1]) / h
        extent = (box.min.x - c.x, box.max.x - c.x, box.min.y - c.y, box.max.y - c.y)
        centroid = local.from_local((c.x, c.y, 0.0))
        return SectionProperties(area, Plane(centroid, local.x_dir, local.z_dir), ixx, iyy, ixy, extent)

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
                        _freed(wire._copy_curves()) as curves:
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
        between lines and arcs are rounded exactly; next to a spline or an ellipse the arc's
        center lies at ``radius`` from both curves (where their offsets meet), and the curves are
        cut where it touches them. A corner that does not fit, a point that is not a corner, or a
        smooth corner raises :class:`ModelingError`.
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
        corners: str = "sharp",
    ) -> Part:
        """Extrude the region into a solid.

        Args:
            amount: Distance along the sketch normal (negative goes the other way).
            both: Extrude ``amount`` to both sides of the sketch.
            taper: Draft angle in degrees; positive narrows the solid away from the sketch (holes
                widen). The walls are drafted planes, cones and cylinders (as ``Part.draft`` makes
                them), B-spline surfaces where the profile has other curves.
            direction: Extrude along this direction (an axis or a vector) instead of the normal;
                ``amount`` is measured along it. A direction in the sketch plane raises
                ``ValueError``; one less than 0.06 degrees (a sine of 1e-3) off the plane warns, as
                the solid is then less than ``amount / 1000`` thick. With ``taper`` only the normal
                (either way) is taken: a taper drafts the walls about the normal, so a direction
                across it raises ``ValueError``.
            corners: With a taper, the corners that the taper pulls apart (convex ones of an
                outward taper, concave ones of an inward one): ``"sharp"`` (the walls extended
                until they meet) or ``"round"`` (rounded off, as an offset rounds them).
        """
        if amount == 0:
            raise ValueError("extrude amount must not be zero")
        if corners not in ("sharp", "round"):
            raise ValueError(f"extrude: corners is 'sharp' or 'round', got {corners!r}")
        self._require_region("extrude")
        d = _direction(direction, "extrude") if direction is not None else self._plane.z_dir
        if direction is not None:
            self._check_direction(d, abs(float(amount)) * (2 if both else 1), not taper)
        if taper:
            if direction is not None:
                # (a taper drafts the walls about the normal; the direction was ignored before 0.5.0)
                along = d.dot(self._plane.z_dir)
                if abs(along) < 1 - 1e-12:
                    raise ValueError("extrude: a taper drafts the walls about the sketch normal, so direction= must "
                                     "run along the normal (either way) with taper=; extrude with the taper along "
                                     "the normal, or without a taper along the direction")
                if along < 0:
                    amount = -amount
            out = self._extrude_taper(amount, taper, both, corners == "round")
            out.name, out.color = self.name, self.color
            return out
        src = self
        dist = float(amount)
        if both:
            src = self.translate(-d * abs(dist))
            dist = 2 * abs(dist)
        sign = 1.0 if dist > 0 else -1.0
        part = src._swept_along(d * sign, abs(dist))
        if direction is not None and abs(d.dot(self._plane.z_dir)) < 1 - 1e-12:
            part = src._oblique(part, d * sign, abs(dist))
        part.name, part.color = self.name, self.color
        return part

    def _swept_along(self, d: Vector, dist: float) -> Part:
        h = BrepHandle(self._copy_brep())
        with kernel_call("extrude"):
            k.non_manifold_linear_sweep(h.brep, d.to_tuple(), dist)
        return Part._wrap(_take(h))

    def _oblique(self, part: Part, d: Vector, dist: float) -> Part:
        """An extrusion along a direction across the normal, checked (``is_valid``) and made again turned
        about the normal where the kernel made it inside out or open. In planes that are not parallel to a
        principal one the kernel breaks some such extrusions of profiles with curved edges: of 1200
        (circles, rectangles, hexagons, ellipses and slots in random planes, both directions, one side and
        both) 1 at 6 degrees off the plane, 25 at 0.6 and 0.06 degrees, 192 at 0.006 (the same before
        0.5.0). Turned about the normal through the sketch's origin, extruded and turned back, all but 16
        at each of those angles come out valid with the exact volume; those are swept along a line, each
        curve's wall a translational surface (``ModelingError`` where that fails too). The walls of
        straight edges, which the kernel makes as flat B-spline surfaces, are planes."""
        if not part.is_valid():
            axis = Axis(self._plane.origin, self._plane.z_dir)
            for angle in (113.0, 180.0, 37.0):
                again = self.rotate(axis, angle)._swept_along(d.rotate(axis.direction, angle), dist).rotate(axis, -angle)
                if again.is_valid():
                    part = again
                    break
            else:
                translated = self._translated(d, dist)
                if translated is None:
                    raise ModelingError("extrude: the kernel made this extrusion along the direction invalid (inside "
                                        "out or open); extrude along the sketch normal, or along a direction further "
                                        "from the sketch plane")
                part = translated
        return _flat_walls(part)

    def _translated(self, d: Vector, dist: float) -> Part | None:
        """The extrusion along the unit direction ``d`` by ``dist`` as the kernel's translational curve
        sweep along a line (each curve's wall a translational surface, the ends capped), checked; None
        where it is not valid or not of its volume."""
        from .curves import Line

        o = self._plane.origin
        expected = abs(self.area) * dist * abs(d.dot(self._plane.z_dir))
        out: Part | None = None
        for f in self.faces():
            loops = f.wires()
            pieces = []
            for w in loops:
                curves = w._copy_curves()
                path = Line(o, o + d * dist)._copy_curve()
                try:
                    with kernel_call("extrude"):
                        pieces.append(Part._wrap(ext.curve_sweep(curves, path, True, True, False, True, None, None,
                                                                 list(o.to_tuple()))))
                except KernelError:
                    return None
                finally:
                    ext.delete_curve(path)
                    for c in curves:
                        ext.delete_curve(c)
            if not all(p.is_valid() for p in pieces):  # (thin bodies fail _solid_problem's coarse sign test)
                return None
            piece = pieces[0]
            for hole in pieces[1:]:
                piece = piece - hole
            out = piece if out is None else out + piece
        if out is None or not out.is_valid() or abs(out.volume - expected) > 1e-6 * expected:
            return None
        return out

    def _check_direction(self, d: Vector, thickness: float, used: bool) -> None:
        """Raise where an extrusion direction lies in the sketch plane, warn where it nearly does (where
        it is ``used``: a taper extrudes along the normal). The kernel refused a direction within a sine
        of 1e-5 of the plane with a bare ``KernelError`` (SM_ERR), and made a valid sliver above that
        (5 along a direction 1e-4 off the plane: 0.0005 thick)."""
        n = self._plane.z_dir
        sine = abs(d.dot(n))
        if not sine > _IN_PLANE:
            raise ValueError(f"extrude: the direction lies in the sketch plane; it must cross the plane "
                             f"(its normal is {_fmt_point(n)})")
        if used and sine < _NEAR_PLANE:
            import warnings

            warnings.warn(f"extrude: the direction is {math.degrees(math.asin(sine)):.3g} degrees off the sketch "
                          f"plane, so the solid is only {thickness * sine:.3g} thick (amount is measured along "
                          f"the direction)", RuntimeWarning, stacklevel=3)

    def _extrude_taper(self, amount: float, taper: float, both: bool, round_corners: bool = False) -> Part:
        if not abs(taper) < 90:
            raise ValueError("extrude: the taper must be between -90 and 90 degrees")
        result = self._swept_taper(amount, taper, round_corners)
        if not round_corners and any(f.geom_type == "bspline" for f in result.faces()):
            drafted = self._drafted_extrusion(amount, taper)
            if drafted is not None and abs(drafted.volume - result.volume) <= 1e-7 * result.volume:
                result = drafted
        if both:
            result = result + self._extrude_taper(-amount, taper, False, round_corners)
        return result

    def _drafted_extrusion(self, amount: float, taper: float) -> Part | None:
        """The tapered extrusion as a straight one with its walls drafted (``Part.draft``): planes,
        cones and cylinders. The kernel's draft sweep makes the walls at sharp corners flat B-spline
        surfaces (inward tapers) or planes with B-spline slivers at the corners (outward ones), which
        selections by type miss, draft refuses and STEP files carry as B-splines. None where draft
        cannot make it (curves other than lines and arcs, walls that run into each other)."""
        n = self._plane.z_dir * (1.0 if amount > 0 else -1.0)
        straight = self.extrude(amount)
        walls = straight.faces().filter(lambda f: not (f.geom_type == "plane" and abs(f.normal_at().dot(n)) > 0.5))
        try:
            return straight.draft(walls, taper, Plane(self._plane.origin, z_dir=n))
        except ModelingError:
            return None

    def _swept_taper(self, amount: float, taper: float, round_corners: bool) -> Part:
        """The tapered extrusion by the kernel's draft sweep (``k.draft_sweep``), each loop on its own."""
        hint = "the taper may close the profile before the end"
        parts = []
        for f in self.faces():
            loops = f.wires()
            with kernel_call("extrude", hint), _freed(loops[0]._copy_curves()) as curves:
                outer = k.draft_sweep(curves, float(amount), float(taper), fillet_corners=round_corners)
            part = _require_solid(Part._wrap(outer), "extrude", hint)
            self._reaches(part, amount, taper)
            for w in loops[1:]:
                # A hole runs the other way round than the outline; the kernel sweeps a loop
                # along the side its orientation gives, so turn it like the outline. The
                # hole widens where the outline narrows.
                with kernel_call("extrude", hint), _freed(w.reversed()._copy_curves()) as curves:
                    hole = Part._wrap(k.draft_sweep(curves, float(amount), -float(taper), fillet_corners=round_corners))
                part = part - _require_solid(hole, "extrude", hint)
            if len(loops) > 1:
                # (a hole that widens across the region before the end: a ring tapered by 10 degrees
                # came out 5.67 high where 10 were asked for)
                self._reaches(part, amount, taper)
            parts.append(part)
        result = parts[0]
        for p in parts[1:]:
            result = result + p
        return result

    def _reaches(self, part: Part, amount: float, taper: float) -> None:
        """Raise if a tapered extrusion does not reach ``amount`` from the sketch plane."""
        n = self._plane.z_dir * (1.0 if amount > 0 else -1.0)
        reach = max((v.point - self._plane.origin).dot(n) for v in part.vertices())
        if reach < abs(amount) - 1e-6 * max(1.0, abs(amount)):
            raise ModelingError(f"extrude: the taper of {taper:g} degrees closes the profile after "
                                f"{reach:.6g} of {abs(amount):g}; use a smaller taper or a shorter extrusion")

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
                with _freed(loops[0]._copy_curves()) as curves:
                    outer = k.rotational_sweep(curves, o, d, float(angle), cap_ends=True)
                piece = _analytic_revolve(outer, Part)
                for w in loops[1:]:
                    with _freed(w._copy_curves()) as curves:
                        hole = k.rotational_sweep(curves, o, d, float(angle), cap_ends=True)
                    piece = piece - _analytic_revolve(hole, Part)
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

    def sweep(self, path: Edge | Wire, *, sharp_corners: bool | None = None, up: Axis | VectorLike | str | None = None,
              twist: float | Callable[[float], float] = 0.0,
              scale: tuple[float, float] | Sequence[tuple[float, float]] | Callable[[float], float] | None = None,
              anchor: str | VectorLike | Vertex = "center") -> Part:
        """Sweep the region along a path (see :func:`~smlibpy.sweep`: the center of the region's box, or
        the point ``anchor`` names, goes to the start of the path; ``up`` and ``twist`` set its attitude
        along it, ``scale`` its size)."""
        from .operations import sweep

        return sweep(self, path, sharp_corners=sharp_corners, up=up, twist=twist, scale=scale, anchor=anchor)

    def swing(self, outline: Sketch | Face | Wire | Edge) -> Part:
        """Swing the region around an outline: a revolve about Z whose circle is the outline (see
        :func:`~smlibpy.swing`: the region drawn as for a lathe in the XZ plane, the outline a closed
        curve around the Z axis parallel to XY, scaled at each height to pass through the region's
        outline on the +X side)."""
        from .operations import swing

        return swing(self, outline)

    def __repr__(self) -> str:
        return f"Sketch({self._brep.face_count()} faces, area={self.area:.6g})"
