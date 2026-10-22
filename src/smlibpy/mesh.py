"""Triangle meshes: tessellation of exact shapes, mesh Booleans, mesh files."""

from __future__ import annotations

import numbers
import warnings
import zlib
from typing import TYPE_CHECKING, Any, NamedTuple

import numpy as np

from ._kernel import ModelingError, PolyHandle, ext, k, kernel_call
from .geometry import Axis, BoundBox, Hit, Location, Plane, Vector, VectorLike, Z, _direction, _vec

if TYPE_CHECKING:  # pragma: no cover
    from .shapes import Face, MassProperties, Part, Shape, ShapeList, Wire

__all__ = ["Mesh", "tessellate"]


class RepairReport(NamedTuple):
    """What :meth:`Mesh.repaired` did.

    Attributes:
        merged_vertices: Points that lay on each other (to 1e-9 of the largest coordinate), merged.
        removed_triangles: Triangles without an area, and repeated ones, left out.
        flipped_triangles: Triangles turned to face the way their neighbours face (a closed piece
            outward).
        filled_holes: Holes filled (as :meth:`Mesh.fill_holes`).
        open_holes: Borders that do not close on themselves, left open.
        open_edges: Edges of the result not shared by two triangles: 0 for a closed mesh.
    """

    merged_vertices: int
    removed_triangles: int
    flipped_triangles: int
    filled_holes: int
    open_holes: int
    open_edges: int


class Mesh:
    """An indexed triangle mesh.

    Attributes:
        vertices: ``(n, 3)`` float array of positions.
        triangles: ``(m, 3)`` int array of vertex indices (counterclockwise seen from outside).
        normals: optional ``(m, 3, 3)`` corner normals (one per triangle corner), used for
            shading crisp CAD edges.

    A mesh is its arrays: the kernel's mesh it came from is freed once they are copied out, and
    mesh Booleans build one from the arrays when they need it. :meth:`dispose` frees what a mesh
    still holds in the kernel at once. The arrays can be changed in place
    (``m.vertices += (10, 0, 0)``); :meth:`translate`, :meth:`rotate`, :meth:`mirror`,
    :meth:`scale` and :meth:`moved` return moved copies, as for shapes.

    Meshes of scans and STL files: :meth:`section` and :meth:`slices` cut them, :meth:`decimate`
    thins them out, :meth:`fill_holes` and :meth:`repaired` close them, :meth:`mass_properties`
    measures what they enclose and :meth:`to_part` makes a faceted part of them.
    """

    __slots__ = ("vertices", "triangles", "normals", "_poly", "_key")

    def __init__(self, vertices: Any, triangles: Any, normals: Any = None, _poly: PolyHandle | None = None):
        self.vertices = np.asarray(vertices, dtype=np.float64).reshape(-1, 3)
        self.triangles = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
        self.normals = None if normals is None else np.asarray(normals, dtype=np.float32).reshape(-1, 3, 3)
        self._poly = _poly
        self._key = self._fingerprint() if _poly is not None else None

    def _fingerprint(self) -> tuple[Any, ...]:
        """What tells the arrays apart: their shapes and checksums."""
        v, t = np.ascontiguousarray(self.vertices), np.ascontiguousarray(self.triangles)
        return v.shape, t.shape, zlib.crc32(v), zlib.crc32(t)

    # -- measures -------------------------------------------------------------
    @property
    def triangle_normals(self) -> np.ndarray:
        v = self.vertices[self.triangles]
        n = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
        ln = np.linalg.norm(n, axis=1, keepdims=True)
        return n / np.where(ln > 0, ln, 1.0)

    @property
    def area(self) -> float:
        v = self.vertices[self.triangles]
        return float(0.5 * np.linalg.norm(np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0]), axis=1).sum())

    @property
    def volume(self) -> float:
        """Enclosed volume (meaningful for closed meshes)."""
        if not len(self.triangles):
            return 0.0
        # (the triple products about the middle of the box: about the origin, a mesh far from it lost
        # digits, 1113.1202 for 1113.121 at 1e6 mm)
        v = self.vertices[self.triangles] - 0.5 * (self.vertices.min(axis=0) + self.vertices.max(axis=0))
        return float(np.einsum("ij,ij->i", v[:, 0], np.cross(v[:, 1], v[:, 2])).sum() / 6.0)

    def bbox(self) -> BoundBox:
        if not len(self.vertices):
            raise ValueError("an empty mesh has no bounding box")
        return BoundBox(self.vertices.min(axis=0), self.vertices.max(axis=0))

    def center(self) -> Vector:
        """The middle of the bounding box (:attr:`centroid` is the center of mass)."""
        return self.bbox().center

    @property
    def centroid(self) -> Vector:
        """The center of mass of the volume a closed mesh encloses (uniform density); see
        :meth:`mass_properties`."""
        return self.mass_properties().center

    def mass_properties(self, density: float = 1.0) -> MassProperties:
        """Mass, center of mass and inertia tensor of the volume a closed mesh encloses, for a
        uniform ``density`` (as :meth:`Part.mass_properties`, a :class:`MassProperties`).

        Exact for the triangles: each spans a tetrahedron with a point, and their integrals add
        up (the divergence theorem). The mesh must be closed and face outward (``ModelingError``
        otherwise: close it with :meth:`fill_holes` or :meth:`repaired`); an empty mesh raises
        ``ValueError``.
        """
        from .shapes import MassProperties

        if not density > 0:
            raise ValueError("mass_properties: the density must be positive")
        if not len(self.triangles):
            raise ValueError("an empty mesh has no mass properties")
        if not self.is_closed():
            raise ModelingError(f"mass_properties: the mesh is open ({self._open_edge_count()} open edges), so it "
                                f"encloses no volume; close it first: mesh.fill_holes() or mesh.repaired()")
        ref = (self.vertices.min(axis=0) + self.vertices.max(axis=0)) / 2  # (a point near the mesh: fewer digits lost)
        v = self.vertices[self.triangles] - ref
        a, b, c = v[:, 0], v[:, 1], v[:, 2]
        det = np.einsum("ij,ij->i", a, np.cross(b, c))  # six times the volume of each tetrahedron
        volume = float(det.sum() / 6.0)
        if not volume > 0:
            raise ModelingError(f"mass_properties: the mesh encloses a volume of {volume:.6g}: its triangles face "
                                f"inward (mesh.repaired() turns them outward)")
        s = a + b + c
        first = (det[:, None] * s).sum(axis=0) / 24.0
        # the integral of x x^T over a tetrahedron (0, a, b, c): its volume / 20 * (a a^T + b b^T + c c^T + s s^T)
        second = np.einsum("i,ij,ik->jk", det / 120.0, a, a) + np.einsum("i,ij,ik->jk", det / 120.0, b, b) \
            + np.einsum("i,ij,ik->jk", det / 120.0, c, c) + np.einsum("i,ij,ik->jk", det / 120.0, s, s)
        d = first / volume  # the centroid relative to ref
        i_ref = np.trace(second) * np.eye(3) - second
        i_c = i_ref - volume * (d.dot(d) * np.eye(3) - np.outer(d, d))
        return MassProperties(density * volume, volume, self.area, Vector(*(ref + d)), density * i_c, density)

    def __len__(self) -> int:
        return len(self.triangles)

    def dispose(self) -> None:
        """Free the kernel's copy of the mesh now, if it holds one (an internal tessellation can
        keep it). The arrays stay, and the mesh stays usable: a mesh Boolean builds the kernel's
        mesh from them again."""
        poly, self._poly = self._poly, None
        if poly is not None:
            poly.dispose()

    # -- placement (copies, as for shapes) --------------------------------------
    def _transformed(self, m: np.ndarray) -> Mesh:
        a = np.asarray(m, dtype=np.float64)[:3, :3]
        vertices = self.vertices @ a.T + np.asarray(m, dtype=np.float64)[:3, 3]
        turned = np.linalg.det(a) < 0  # a reflection: the winding turns too, to stay outward
        triangles = self.triangles[:, ::-1] if turned else self.triangles
        normals = None
        if self.normals is not None:
            n = self.normals.astype(np.float64) @ np.linalg.inv(a)  # (rows: n @ inv(a) = inv(a).T @ n)
            n /= np.where((ln := np.linalg.norm(n, axis=2, keepdims=True)) > 0, ln, 1.0)
            normals = (n[:, ::-1] if turned else n).astype(np.float32)
        return Mesh(vertices, triangles.copy(), normals)

    def moved(self, location: Location) -> Mesh:
        """A copy placed by ``location``."""
        return self._transformed(location.matrix)

    def translate(self, x: float | VectorLike = 0.0, y: float = 0.0, z: float = 0.0) -> Mesh:
        """A copy moved by ``(x, y, z)``."""
        from .shapes import _translation

        return self._transformed(_translation(x, y, z))

    def rotate(self, axis: Axis = Z, angle: float = 0.0) -> Mesh:
        """A copy rotated by ``angle`` degrees about ``axis``."""
        return self._transformed(Location.about(axis, angle).matrix)

    def mirror(self, plane: Plane | Face = Plane.XZ) -> Mesh:
        """A mirrored copy (reflection in ``plane``, a plane or a planar face; by default the XZ
        plane, which flips Y). The triangles keep facing outward."""
        from .shapes import _reflection

        return self._transformed(_reflection(plane))

    def scale(self, factor: float | VectorLike, center: VectorLike = (0, 0, 0)) -> Mesh:
        """A scaled copy. ``factor`` is a number or per-axis factors ``(sx, sy, sz)``, none of
        them zero (``ValueError``)."""
        from .shapes import _scaling

        return self._transformed(_scaling(factor, center))

    # -- mesh Booleans (kernel polygon Booleans) -------------------------------
    def _kernel_mesh(self) -> Any:
        """A new kernel mesh of this one, for the caller to own: a copy of the tessellation's
        where the mesh keeps it and its arrays are still the ones it was made from (they can be
        changed in place, ``m.vertices += ...``), else built from the triangles, stitched along
        the edges they share."""
        if self._poly is not None and self._poly.poly is not None and self._key == self._fingerprint():
            return self._poly.poly.copy()
        if not len(self.triangles):
            raise ValueError("mesh Booleans need triangles: this mesh has none")
        with kernel_call("mesh", "the mesh may have no triangle with an area"):
            return ext.poly_from_triangles(self.vertices.ravel().tolist(), self.triangles.ravel().tolist())

    def _bool(self, other: Mesh, op: Any, name: str) -> Mesh:
        with kernel_call(f"mesh {name}"):
            # (the Boolean consumes its operands)
            a = self._kernel_mesh()
            b = other._kernel_mesh()
            r = k.poly_boolean(a, b, op)
            ext.triangulate_poly(r)  # (its polygons with holes: the mesh arrays take only outer loops)
        result = Mesh._from_poly(r, normals=False)  # (the kernel gives a Boolean's result no normals)
        result.normals = _transferred_normals(result, (self, other))
        # The kernel's mesh Booleans often return open or wrong meshes (faces that should get
        # a hole stay whole). Check what can be checked: closed, and a volume the operation
        # can give.
        va, vb, v = self.volume, other.volume, result.volume
        if op == k.PolyBooleanOp.UNION:
            lo, hi = max(va, vb), va + vb
        elif op == k.PolyBooleanOp.DIFFERENCE:
            lo, hi = max(0.0, va - vb), va
        else:
            lo, hi = 0.0, min(va, vb)
        slack = 1e-6 * (abs(va) + abs(vb))
        problem = None
        if not self.is_closed() or not other.is_closed():
            problem = None  # open operands: nothing to compare with
        elif not result.is_closed():
            problem = f"an open mesh ({result._open_edge_count()} open edges)"
        elif not lo - slack <= v <= hi + slack:
            problem = f"a volume of {v:.6g}, where {lo:.6g} to {hi:.6g} is possible"
        if problem is not None:
            sym = {"union": "+", "difference": "-"}.get(name, "&")
            raise ModelingError(f"mesh {name}: the kernel's mesh Boolean returned {problem}; do the Boolean "
                                f"on the exact parts and tessellate the result: (part_a {sym} part_b).mesh()")
        return result

    def _open_edge_count(self) -> int:
        if len(self.triangles) == 0:
            return 0
        size = float(np.abs(self.vertices).max()) if len(self.vertices) else 1.0
        _, ids = np.unique(np.round(self.vertices / max(size, 1e-300), 9), axis=0, return_inverse=True)
        t = ids.reshape(-1)[self.triangles]
        e = np.sort(np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]), axis=1)
        e = e[e[:, 0] != e[:, 1]]
        _, counts = np.unique(e, axis=0, return_counts=True)
        return int((counts != 2).sum())

    def raycast(self, origin: VectorLike | Axis, direction: VectorLike | Axis | None = None) -> list[Hit]:
        """Where a ray meets the mesh's triangles, nearest first (``Hit``: point, distance from
        the start, the triangle's normal and its index ``triangle``). As :meth:`Part.raycast`,
        on the triangles instead of the exact faces."""
        if isinstance(origin, Axis) and direction is None:
            o, d = origin.origin, origin.direction.normalized()
        elif direction is None:
            raise TypeError("raycast takes an origin and a direction, or an axis")
        else:
            o, d = _vec(origin), _direction(direction, "raycast")
        if not len(self.triangles):
            return []
        size = float(np.linalg.norm(self.vertices.max(axis=0) - self.vertices.min(axis=0)))
        tol = 1e-9 * max(size, o.length, 1e-300)
        ts, tris = _ray_triangles(o, d, self.vertices, self.triangles, tol)
        normals = self.triangle_normals
        out: list[Hit] = []
        for t, i in sorted(zip(ts.tolist(), tris.tolist())):
            if out and t - out[-1].distance <= 1e-9 * max(size, 1.0):
                continue  # (through an edge or a corner: one hit)
            out.append(Hit(o + d * max(t, 0.0), max(t, 0.0), Vector(*normals[i]), None, int(i)))
        return out

    def raycast_many(self, origins: Any, directions: Any) -> list[Hit | None]:
        """The first hit of each of many rays, one per ray (``Hit`` or ``None``), not
        :meth:`raycast` many times (which gives every hit of a ray): for each origin, the ``Hit``
        that :meth:`raycast` gives first (the point, the distance, the triangle's normal and its
        index ``triangle``), ``None`` where the ray misses.

        ``origins`` is an ``(n, 3)`` array or a sequence of points; ``directions`` one direction
        (a vector or an axis) for all of them, or one each. The kernel's ray tracer sorts the
        triangles into a grid once per call (0.8 s for 250 000 triangles) and then takes about
        0.01 ms a ray, where :meth:`raycast` tests every triangle (36 ms a ray there): give all
        the rays in one call."""
        o, d = _rays(origins, directions, "raycast_many")
        if not len(o) or not len(self.triangles):
            return [None] * len(o)
        size = float(np.linalg.norm(self.vertices.max(axis=0) - self.vertices.min(axis=0)))
        # (hits a hair behind the start count, as for raycast: the rays start that much earlier)
        tol = 1e-9 * np.maximum(np.maximum(size, np.linalg.norm(o, axis=1)), 1e-300)
        with kernel_call("raycast_many"):
            r = ext.mesh_first_hits(self.vertices, self.triangles, o - d * tol[:, None], d)
        out: list[Hit | None] = []
        for i, tri in enumerate(r["triangles"].tolist()):
            if tri < 0:
                out.append(None)
                continue
            t = max(float(r["t"][i]) - float(tol[i]), 0.0)
            out.append(Hit(Vector(*(o[i] + d[i] * t)), t, Vector(*r["normals"][i]), None, int(tri)))
        return out

    def is_closed(self) -> bool:
        """True if every edge of the mesh is shared by exactly two triangles (a watertight mesh)."""
        return self._open_edge_count() == 0

    # -- sections ---------------------------------------------------------------
    def section(self, plane: Plane | Face = Plane.XY) -> ShapeList[Wire]:
        """Where the plane cuts the mesh: polylines (wires of straight edges) through the points
        where its triangles cross the plane, chained into loops, the longest first.

        Of a closed mesh every loop is closed, outer loops counterclockwise seen from the plane's
        normal and holes clockwise (as the faces of :meth:`Part.section`); an open mesh can give
        open polylines too. ``make_face(loop)`` makes a face of a closed loop. Points where the
        cut runs straight on are left out. A plane through a flat part of the mesh (the top face
        of a box's mesh) cuts it just beside that, on the side where the cut encloses more. Empty
        where the plane misses the mesh.
        """
        from .shapes import ShapeList

        pl = _as_section_plane(plane)
        return ShapeList(_section_wires(self.vertices, self.triangles, pl))

    def slices(self, step: float, axis: Axis | VectorLike = Z) -> list[ShapeList[Wire]]:
        """Sections (:meth:`section`) across ``axis``, ``step`` apart: the mesh cut into layers of
        thickness ``step`` from its lowest point along the axis up, each cut in its middle (at
        ``step / 2``, ``3 * step / 2``, ... above the lowest point; the contours of a printer's
        layers). Layers whose plane cuts nothing are left out."""
        from .shapes import ShapeList

        d = _direction(axis, "slices")
        if not step > 0:
            raise ValueError("slices: the step must be positive")
        if not len(self.triangles):
            return []
        along = self.vertices @ np.array(d.to_tuple())
        out = []
        for level in _levels(float(along.min()), float(along.max()), float(step)):
            wires = _section_wires(self.vertices, self.triangles, Plane(d * level, z_dir=d))
            if wires:
                out.append(ShapeList(wires))
        return out

    # -- decimation and repair --------------------------------------------------
    def decimate(self, fraction: float | None = None, *, triangles: int | None = None,
                 tolerance: float | None = None) -> Mesh:
        """A mesh with fewer triangles, as near to this one as the kernel's quadric decimation
        (SmPolyDecimate) keeps it: it collapses the edges whose removal changes the shape least
        first, keeps a closed mesh closed and keeps the border of an open one.

        Give one of:

        - ``fraction``: the share of the triangles to remove (``0.9`` leaves a tenth).
        - ``triangles``: about how many triangles to leave.
        - ``tolerance``: how far the result may be from this mesh at most. The mesh is decimated
          step by step while the distance stays within it (measured at the points of both
          meshes and the middles of their triangles), so this takes a few decimations (seconds
          for 100 000 triangles).

        The result has normals of its own: at each corner the average of the triangles around
        it, except across edges sharper than 30 degrees. ``ModelingError`` if a closed mesh
        comes back open, or an open mesh with another border (a mesh whose points all lie on its
        border, such as a tube of long triangles, cannot keep it), and where the kernel collapses
        the mesh far below the count asked (it does with the long thin triangles of a coarse
        mesh of a cone: mesh such a part with a larger tolerance instead). The kernel orders equal
        choices by memory, so the count can differ by a few triangles from run to run.
        """
        given = [x is not None for x in (fraction, triangles, tolerance)]
        if sum(given) != 1:
            raise TypeError("decimate takes one of fraction, triangles or tolerance")
        n = len(self.triangles)
        if fraction is not None:
            if not 0 < fraction < 1:
                raise ValueError("decimate: fraction is the share of the triangles to remove, between 0 and 1")
            return self._decimated(float(fraction))
        if triangles is not None:
            if not triangles >= 4:
                raise ValueError("decimate: a mesh needs 4 triangles or more")
            if triangles >= n:
                return Mesh(self.vertices.copy(), self.triangles.copy(),
                            None if self.normals is None else self.normals.copy())
            return self._decimated(1.0 - triangles / n)
        if not tolerance > 0:  # type: ignore[operator]
            raise ValueError("decimate: the tolerance must be positive")
        best = Mesh(self.vertices.copy(), self.triangles.copy(), None if self.normals is None else self.normals.copy())
        step = 0.5
        for _ in range(40):
            if step < 1 / 32 or len(best.triangles) <= 8:
                break
            try:
                trial = best._decimated(step, original=self)
            except ModelingError:
                step /= 2
                continue
            if len(trial.triangles) >= len(best.triangles) or _deviation(self, trial) > tolerance:
                step /= 2
                continue
            best = trial
        return best

    def _decimated(self, fraction: float, original: Mesh | None = None) -> Mesh:
        """One run of the kernel's decimation, ``fraction`` of the points removed; checked
        against ``original`` (default: this mesh): closed where it was."""
        if not len(self.triangles):
            raise ValueError("decimate: the mesh has no triangles")
        with kernel_call("decimate", "is the mesh made of triangles with an area?"):
            r = ext.decimate_triangles(self.vertices, self.triangles, fraction, 30.0, True)
        v, t = np.asarray(r["vertices"], dtype=np.float64), np.asarray(r["triangles"], dtype=np.int64)
        result = Mesh(v, t, ext.crease_normals(v, t, 30.0).reshape(-1, 3, 3) if len(t) else None)
        asked = len(self) * (1.0 - fraction)
        if len(result) < 0.5 * asked:
            raise ModelingError(f"decimate: the kernel's decimation collapsed the mesh to {len(result)} triangles, "
                                f"where about {int(asked + 0.5)} were asked (it does so with meshes of long thin "
                                f"triangles, such as the flat faces of a coarse mesh of a part); mesh the part with a "
                                f"larger tolerance instead, or decimate a finer mesh")
        source = self if original is None else original
        border, left = source._open_edge_count(), result._open_edge_count()
        if not border and left:
            raise ModelingError(f"decimate: the decimation left the mesh open ({left} open edges); remove a smaller "
                                f"share")
        if border and left != border:
            raise ModelingError(f"decimate: the decimation changed the border of the open mesh ({border} open edges, "
                                f"then {left}): the kernel keeps a border only where the mesh has points inside it")
        return result

    def fill_holes(self) -> Mesh:
        """A copy with every hole closed: each border of edges that only one triangle has, which
        closes on itself, is filled with triangles (the kernel's triangulation of the polygon, also
        of one that is not flat). The triangles of the mesh stay as they are; the new ones face as
        the triangles beside them do. See :meth:`repaired`, which also merges points that lie on
        each other and turns triangles that face the wrong way first."""
        r = self._repair(clean=False)
        tris = np.vstack([self.triangles, r["triangles"][r["sources"] < 0]])
        return self._repaired_mesh(r, tris, keep_all=True)

    def repaired(self) -> tuple[Mesh, RepairReport]:
        """A repaired copy and what was done: points that lie on each other (to 1e-9 of the
        largest coordinate) are merged, triangles left without an area and repeated ones are
        left out, triangles are turned to face the way their neighbours face (a closed piece
        outward), and holes are filled (as :meth:`fill_holes`).

        Returns ``(mesh, report)``, a :class:`RepairReport` that counts ``merged_vertices``,
        ``removed_triangles``, ``flipped_triangles``, ``filled_holes``, ``open_holes`` (borders
        that do not close on themselves, left open) and ``open_edges`` (edges of the result not
        shared by two triangles: 0 for a closed mesh).
        """
        r = self._repair(clean=True)
        mesh = self._repaired_mesh(r, r["triangles"], keep_all=False)
        return mesh, RepairReport(*(int(r[key]) for key in RepairReport._fields))

    def _repair(self, clean: bool) -> dict[str, Any]:
        with kernel_call("repair"):
            r = ext.repair_triangles(self.vertices, self.triangles, clean, True)
        r["triangles"] = np.asarray(r["triangles"], dtype=np.int64).reshape(-1, 3)
        r["sources"] = np.asarray(r["sources"], dtype=np.int64)
        return r

    def _repaired_mesh(self, r: dict[str, Any], tris: np.ndarray, keep_all: bool) -> Mesh:
        """The mesh of a repair: this mesh's points and the new ones; the normals of triangles
        that come from this mesh (turned with them), flat ones for new triangles."""
        vertices = np.vstack([self.vertices, np.asarray(r["new_vertices"], dtype=np.float64).reshape(-1, 3)])
        sources = r["sources"]
        if keep_all:
            sources = np.concatenate([np.arange(len(self.triangles)), sources[sources < 0]])
        normals = None
        if self.normals is not None:
            flat = _flat_normals(vertices, tris)
            normals = np.repeat(flat[:, None, :], 3, axis=1).astype(np.float32)
            old = sources >= 0
            if old.any():
                src = sources[old]
                # (a triangle turned round has its last two corners swapped: its normals turn too)
                same = np.einsum("ij,ij->i", flat[old], _flat_normals(self.vertices, self.triangles[src])) >= 0
                n = self.normals[src].copy()
                n[~same] = -n[~same][:, [0, 2, 1]]
                normals[old] = n
        if not keep_all:  # (only the points the triangles use)
            used, local = np.unique(tris, return_inverse=True)
            return Mesh(vertices[used], local.reshape(-1, 3), normals)
        return Mesh(vertices, tris, normals)

    # -- parts ------------------------------------------------------------------
    def to_part(self, max_faces: int = 5000) -> Part:
        """A faceted part of a closed mesh: a planar face for each triangle, where neighbouring
        triangles that lie in one plane (the faces of a CAD part's mesh) make one face. Exact
        Booleans with other parts, sections and STEP files work on it; its faces stay flat (no
        fillets of curved faces).

        Booleans get slow as faces add up (a sphere of 14 080 triangles took 40 s to cut by a
        box), so a mesh that would give more than ``max_faces`` faces raises ``ModelingError``:
        decimate it first (``mesh.decimate(triangles=2000).to_part()``), or give a larger
        ``max_faces`` (``0``: no limit). An open mesh raises ``ModelingError`` too (close it with
        :meth:`fill_holes` or :meth:`repaired`), and so does one whose part is not a valid solid
        or does not enclose the mesh's volume.
        """
        from .shapes import Part

        if not isinstance(max_faces, numbers.Integral) or max_faces < 0:
            raise ValueError("to_part: max_faces must be a whole number, 0 for no limit")
        if not len(self.triangles):
            raise ValueError("to_part: the mesh has no triangles")
        if not self.is_closed():
            raise ModelingError(f"to_part: the mesh is open ({self._open_edge_count()} open edges), and a part "
                                f"needs a closed one; close it first: mesh.fill_holes() or mesh.repaired()")
        with kernel_call("to_part", "is the mesh closed, without triangles through each other?"):
            r = ext.brep_from_triangles(self.vertices, self.triangles, True, int(max_faces))
        if r["brep"] is None:
            raise ModelingError(f"to_part: the part would get {r['faces']} faces, more than max_faces={max_faces}, "
                                f"and Booleans on it would be slow; decimate the mesh first "
                                f"(mesh.decimate(triangles={max(max_faces // 2, 4)})) or give a larger max_faces")
        part = Part._wrap(r["brep"])
        if not part.is_valid():
            raise ModelingError("to_part: the faceted part is not a valid solid (do triangles cross each other, or "
                                "face inward?); mesh.repaired() turns them outward")
        v, mv = part.volume, self.volume
        if abs(v - mv) > 1e-6 * abs(mv):
            raise ModelingError(f"to_part: the faceted part has a volume of {v:.10g}, the mesh {mv:.10g}")
        return part

    def __add__(self, other: Mesh) -> Mesh:
        return self._bool(other, k.PolyBooleanOp.UNION, "union")

    def __sub__(self, other: Mesh) -> Mesh:
        return self._bool(other, k.PolyBooleanOp.DIFFERENCE, "difference")

    def __and__(self, other: Mesh) -> Mesh:
        return self._bool(other, k.PolyBooleanOp.INTERSECTION, "intersection")

    # -- construction ---------------------------------------------------------
    @classmethod
    def _from_poly(cls, poly: Any, normals: bool = True, keep: bool = False, brep: Any = None) -> Mesh:
        """The mesh of a kernel PolyBrep, which it takes over: freed once the arrays are copied
        out, or kept with the mesh (``keep``, for what needs the tessellation's own mesh: the
        faces of its triangles, the curvature at its corners), which the caller then disposes.
        ``brep`` is the body it was made from: corners where its surfaces have no normal (the
        apex of a cone) get the normal of the surface next to them."""
        handle = PolyHandle(poly)
        try:
            # (the points in double precision: SmPyLib's to_numpy_arrays gives float32)
            arr = ext.poly_arrays(poly, normals, brep)
            pts = np.asarray(arr["points"], dtype=np.float64)
            faces = np.asarray(arr["faces"], dtype=np.int64)
            tris, corner_idx = _triangulate(faces)
            n = None
            if normals:
                cn = np.asarray(arr["normals"], dtype=np.float32)
                if len(cn) == corner_idx.max(initial=-1) + 1:
                    n = cn[corner_idx]
            return cls(pts, tris, n, handle if keep else None)
        finally:
            if not keep:
                handle.dispose()

    def export(self, path: str, **kwargs: Any) -> None:
        from .exporters import export

        export(self, path, **kwargs)

    def __repr__(self) -> str:
        return f"Mesh({len(self.vertices)} vertices, {len(self.triangles)} triangles)"


def _rays(origins: Any, directions: Any, what: str) -> tuple[np.ndarray, np.ndarray]:
    """Many rays as two ``(n, 3)`` arrays: the origins (an array or a sequence of points) and
    their unit directions (one direction for all of them, a vector or an axis, or one each)."""
    if isinstance(origins, np.ndarray):
        o = np.asarray(origins, dtype=np.float64)
        o = o.reshape(0, 3) if o.size == 0 else o
    else:
        o = np.array([_vec(p).to_tuple() for p in origins], dtype=np.float64).reshape(-1, 3)
    if o.ndim != 2 or o.shape[1] != 3:
        raise ValueError(f"{what}: give the origins as (x, y, z) points, an (n, 3) array")
    if not np.isfinite(o).all():
        raise ValueError(f"{what}: the origins must be finite")
    one = isinstance(directions, (Vector, Axis)) or (
        np.ndim(directions) == 1 if isinstance(directions, np.ndarray)
        else len(directions) > 0 and isinstance(next(iter(directions)), numbers.Real))
    if one:
        d = np.tile(np.array(_direction(directions, what).to_tuple()), (len(o), 1))
    else:
        rows = [x.direction if isinstance(x, Axis) else x for x in directions]
        d = np.array([_vec(x).to_tuple() for x in rows], dtype=np.float64).reshape(-1, 3)
        if len(d) != len(o):
            raise ValueError(f"{what}: give one direction for all origins, or one for each ({len(d)} for {len(o)})")
        n = np.linalg.norm(d, axis=1)
        if not (np.isfinite(d).all() and (n > 0).all()):
            raise ValueError(f"{what}: the direction must not be zero")
        d = d / n[:, None]
    return o, d


def _ray_triangles(o: Vector, d: Vector, vertices: np.ndarray, triangles: np.ndarray,
                   tol: float) -> tuple[np.ndarray, np.ndarray]:
    """Where the ray o + t d (t >= 0) crosses triangles (Moeller-Trumbore): the distances t and
    the indices of the triangles."""
    v = np.asarray(vertices, dtype=np.float64).reshape(-1, 3)
    tri = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
    if not len(tri):
        return np.zeros(0), np.zeros(0, dtype=np.int64)
    dv = np.array(d.to_tuple())
    v0 = v[tri[:, 0]]
    e1, e2 = v[tri[:, 1]] - v0, v[tri[:, 2]] - v0
    p = np.cross(dv, e2)
    det = np.einsum("ij,ij->i", e1, p)
    scale = np.linalg.norm(e1, axis=1) * np.linalg.norm(e2, axis=1)
    ok = np.abs(det) > 1e-12 * np.where(scale > 0, scale, 1.0)
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = np.array(o.to_tuple()) - v0
    u = np.einsum("ij,ij->i", s, p) * inv
    q = np.cross(s, e1)
    w = (q @ dv) * inv
    t = np.einsum("ij,ij->i", e2, q) * inv
    eps = 1e-9
    hit = ok & (u >= -eps) & (w >= -eps) & (u + w <= 1 + eps) & (t >= -tol)
    return t[hit], np.nonzero(hit)[0]


def _flat_normals(vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    """The unit normal of each triangle ((m, 3); zero for one without an area)."""
    v = np.asarray(vertices, dtype=np.float64)[np.asarray(triangles, dtype=np.int64).reshape(-1, 3)]
    n = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.where(ln > 0, ln, 1.0)


def _transferred_normals(result: Mesh, operands: tuple[Mesh, ...]) -> np.ndarray | None:
    """Corner normals for the result of a mesh Boolean, which the kernel gives none: each of its
    triangles lies on an operand (the one nearest to its middle, and of two as near the one whose
    triangle there lies flattest on it), and each corner takes the normals of the operand's
    triangle under a point just inside the result's triangle from it, where it lies on that
    triangle (turned where that triangle faces the other way: the inside of a cut). The kernel
    merges the triangles of a flat facet and splits the merged polygon anew, so a result triangle
    can span two operand triangles. None where the operands have no normals."""
    if not len(result.triangles) or all(m.normals is None for m in operands):
        return None
    tri = result.vertices[result.triangles]
    mid = tri.mean(axis=1)
    rn = result.triangle_normals
    size = max(float(np.linalg.norm(result.vertices.max(axis=0) - result.vertices.min(axis=0))), 1e-300)
    eps = 1e-9 * size
    best_d = np.full(len(mid), np.inf)
    best_dot = np.zeros(len(mid))
    best_op = np.full(len(mid), -1)
    for k, m in enumerate(operands):
        if not len(m.triangles):
            continue
        near = ext.mesh_nearest_points(m.vertices, m.triangles, mid)
        t, d = np.asarray(near["triangles"], dtype=np.int64), np.asarray(near["distances"], dtype=np.float64)
        ok = t >= 0
        dot = np.zeros(len(mid))
        dot[ok] = np.abs(np.einsum("ij,ij->i", m.triangle_normals[t[ok]], rn[ok]))
        better = ok & ((d < best_d - eps) | ((d <= best_d + eps) & (dot > best_dot)))
        best_d[better], best_dot[better], best_op[better] = d[better], dot[better], k
    out = np.repeat(rn[:, None, :], 3, axis=1)
    for k, m in enumerate(operands):
        sel = np.flatnonzero((best_op == k) & (best_d <= 1e-6 * size))
        if not len(sel):
            continue
        corners = tri[sel]  # (s, 3, 3)
        inside = corners + (mid[sel][:, None] - corners) * 1e-3
        near = ext.mesh_nearest_points(m.vertices, m.triangles, inside.reshape(-1, 3))
        src = np.asarray(near["triangles"], dtype=np.int64)
        good = src >= 0
        src = np.where(good, src, 0)
        p = m.vertices[m.triangles[src]]  # (3s, 3, 3)
        if m.normals is not None:
            nn = m.normals[src].astype(np.float64)
        else:
            nn = np.repeat(m.triangle_normals[src][:, None, :], 3, axis=1)
        # the barycentric coordinates of each corner on its operand's triangle
        x = corners.reshape(-1, 3)
        e0, e1 = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]
        d00, d01, d11 = (e0 * e0).sum(-1), (e0 * e1).sum(-1), (e1 * e1).sum(-1)
        den = d00 * d11 - d01 * d01
        den = np.where(den != 0, den, 1.0)
        w = x - p[:, 0]
        d20, d21 = (w * e0).sum(-1), (w * e1).sum(-1)
        bv = (d11 * d20 - d01 * d21) / den
        bw = (d00 * d21 - d01 * d20) / den
        b = np.clip(np.stack([1.0 - bv - bw, bv, bw], axis=-1), 0.0, None)
        b /= np.where((sb := b.sum(-1, keepdims=True)) > 0, sb, 1.0)
        n = np.einsum("cj,cjk->ck", b, nn)
        n /= np.where((ln := np.linalg.norm(n, axis=-1, keepdims=True)) > 0, ln, 1.0)
        turned = np.einsum("ij,ij->i", m.triangle_normals[src], np.repeat(rn[sel], 3, axis=0)) < 0
        n[turned] = -n[turned]
        n[~good] = np.repeat(rn[sel], 3, axis=0)[~good]
        out[sel] = n.reshape(-1, 3, 3)
    return out.astype(np.float32)


def _deviation(a: Mesh, b: Mesh) -> float:
    """How far two meshes are apart: the largest distance of the points of each, and of the
    middles of its triangles, from the other."""
    if not len(a.triangles) or not len(b.triangles):
        raise ValueError("decimate: a mesh without triangles")
    pa = np.vstack([a.vertices, a.vertices[a.triangles].mean(axis=1)])
    pb = np.vstack([b.vertices, b.vertices[b.triangles].mean(axis=1)])
    d1 = np.asarray(ext.mesh_nearest_points(b.vertices, b.triangles, pa)["distances"])
    d2 = np.asarray(ext.mesh_nearest_points(a.vertices, a.triangles, pb)["distances"])
    return float(max(d1.max(), d2.max()))


def _as_section_plane(plane: Any) -> Plane:
    from .shapes import _as_plane

    return _as_plane(plane)


def _levels(lo: float, hi: float, step: float) -> list[float]:
    """The middles of layers of thickness ``step`` from ``lo`` up, while below ``hi``."""
    if (hi - lo) / step > 1e6:
        raise ValueError("slices: the step gives more than a million layers")
    out = []
    i = 0
    while (level := lo + (i + 0.5) * step) < hi:
        out.append(level)
        i += 1
    return out


def _section_wires(vertices: np.ndarray, triangles: np.ndarray, pl: Plane) -> list[Wire]:
    """The loops where a plane cuts a mesh (see :meth:`Mesh.section`), as wires, longest first."""
    from .curves import Polyline

    v = np.asarray(vertices, dtype=np.float64).reshape(-1, 3)
    t = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
    if not len(t):
        return []
    # points that lie on each other are one (each triangle of an STL file has its own)
    size = max(float(np.abs(v).max()), 1e-300)
    _, first, inverse = np.unique(np.round(v / size, 9), axis=0, return_index=True, return_inverse=True)
    pts = v[first]
    tri = inverse.reshape(-1)[t]
    n, o = np.array(pl.z_dir.to_tuple()), np.array(pl.origin.to_tuple())
    d = (pts - o) @ n
    diagonal = float(np.linalg.norm(pts.max(axis=0) - pts.min(axis=0)))
    d[np.abs(d) <= 1e-10 * max(diagonal, float(np.abs(o).max()), 1e-300)] = 0.0
    on = d == 0
    # a point on the plane counts as above it (the plane just below), or as below it
    best: list[np.ndarray] = []
    best_area = -1.0
    for above in (True, False) if on.any() else (True,):
        loops = _crossing_loops(pts, tri, d, (d > 0) | (on & above))
        area = sum(abs(_loop_area(p, pl)) for p, closed in loops if closed)
        if area > best_area:
            best, best_area = loops, area
    loops = sorted(best, key=lambda item: -_loop_length(*item))
    out = []
    for p, closed in loops:
        p = _straightened(p, closed, 1e-12 * max(diagonal, 1e-300))
        if len(p) >= (3 if closed else 2):
            out.append(Polyline(*[tuple(x) for x in p], close=closed))
    return out


def _crossing_loops(pts: np.ndarray, tri: np.ndarray, d: np.ndarray, pos: np.ndarray) -> list[tuple[np.ndarray, bool]]:
    """The points where the triangles cross from ``pos`` (above the plane, by the signed
    distance ``d``) to below, chained into loops: for each, its points and whether it closes.
    Each triangle gives a piece that runs with the cut's region on its left (seen from the
    plane's normal), so the loops of a closed mesh run counterclockwise around its region."""
    p = pos[tri]
    count = p.sum(axis=1)
    sel = np.flatnonzero((count == 1) | (count == 2))
    if not len(sel):
        return []
    odd = np.where(count[sel] == 1, np.argmax(p[sel], axis=1), np.argmax(~p[sel], axis=1))
    abc = np.take_along_axis(tri[sel], (odd[:, None] + np.arange(3)) % 3, axis=1)  # the odd corner first
    up = (count[sel] == 1)[:, None]
    # a piece runs from the crossing of the edge a-b to that of c-a where a is above, else back
    start = np.where(up, abc[:, [0, 1]], abc[:, [2, 0]])
    end = np.where(up, abc[:, [2, 0]], abc[:, [0, 1]])
    nv = np.int64(len(pts))
    start_key = start.min(axis=1) * nv + start.max(axis=1)
    end_key = end.min(axis=1) * nv + end.max(axis=1)
    keys, where = np.unique(np.concatenate([start_key, end_key]), return_inverse=True)
    lo, hi = keys // nv, keys % nv
    s = (d[lo] / (d[lo] - d[hi]))[:, None]
    points = pts[lo] + (pts[hi] - pts[lo]) * s  # (the same for both triangles of an edge)
    a, b = where[:len(sel)], where[len(sel):]
    outgoing: dict[int, list[int]] = {}
    for i, k in enumerate(a.tolist()):
        outgoing.setdefault(k, []).append(i)
    ends = set(b.tolist())
    used = np.zeros(len(sel), dtype=bool)
    loops: list[tuple[np.ndarray, bool]] = []
    b_list = b.tolist()

    def walk(first: int) -> tuple[list[int], bool]:
        chain = [int(a[first])]
        i = first
        while True:
            used[i] = True
            k = b_list[i]
            if k == chain[0]:
                return chain, True
            chain.append(k)
            nxt = [j for j in outgoing.get(k, ()) if not used[j]]
            if not nxt:
                return chain, False
            i = nxt[0]

    # open chains from where no piece ends, then the loops
    for i in range(len(sel)):
        if not used[i] and int(a[i]) not in ends:
            chain, closed = walk(i)
            loops.append((points[chain], closed))
    for i in range(len(sel)):
        if not used[i]:
            chain, closed = walk(i)
            loops.append((points[chain], closed))
    return loops


def _straightened(p: np.ndarray, closed: bool, tol: float) -> np.ndarray:
    """A polyline's points without those where it runs straight on, or that repeat the last."""
    keep = [p[0]]
    for x in p[1:]:
        if np.linalg.norm(x - keep[-1]) > tol:
            keep.append(x)
    if closed and len(keep) > 1 and np.linalg.norm(keep[0] - keep[-1]) <= tol:
        keep.pop()
    q = np.array(keep)
    if len(q) < 3:
        return q
    u, w = q - np.roll(q, 1, axis=0), np.roll(q, -1, axis=0) - q
    turn = np.linalg.norm(np.cross(u, w), axis=1)
    on = np.einsum("ij,ij->i", u, w) > 0
    straight = (turn <= 1e-9 * np.linalg.norm(u, axis=1) * np.linalg.norm(w, axis=1)) & on
    if not closed:
        straight[0] = straight[-1] = False
    return q[~straight]


def _loop_area(p: np.ndarray, pl: Plane) -> float:
    x, y = (p - np.array(pl.origin.to_tuple())) @ np.array(pl.x_dir.to_tuple()), \
        (p - np.array(pl.origin.to_tuple())) @ np.array(pl.y_dir.to_tuple())
    return float(0.5 * (x * np.roll(y, -1) - np.roll(x, -1) * y).sum())


def _loop_length(p: np.ndarray, closed: bool) -> float:
    q = np.vstack([p, p[:1]]) if closed else p
    return float(np.linalg.norm(np.diff(q, axis=0), axis=1).sum())


def _triangulate(faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """VTK-style polygon list -> triangles (fan) and, per triangle corner, the corner index."""
    tris: list[tuple[int, int, int]] = []
    corners: list[tuple[int, int, int]] = []
    i = 0
    c = 0
    n = len(faces)
    # fast path: all triangles
    if n % 4 == 0 and np.all(faces[::4] == 3):
        f = faces.reshape(-1, 4)[:, 1:]
        idx = np.arange(len(f) * 3).reshape(-1, 3)
        return f, idx
    while i < n:
        cnt = int(faces[i])
        poly = faces[i + 1:i + 1 + cnt]
        for j in range(1, cnt - 1):
            tris.append((int(poly[0]), int(poly[j]), int(poly[j + 1])))
            corners.append((c, c + j, c + j + 1))
        i += cnt + 1
        c += cnt
    return np.array(tris, dtype=np.int64).reshape(-1, 3), np.array(corners, dtype=np.int64).reshape(-1, 3)


def tessellate(shape: "Shape", tolerance: float | None = None, angle: float = 15.0, *,
               max_edge: float | None = None) -> Mesh:
    """Triangulate a shape.

    Args:
        shape: A part, sketch, shell or face. A face's mesh faces the way the face does in
            its body's mesh (out of a part).
        tolerance: Maximum distance between mesh and exact surface. Default: 0.1 % of the
            bounding box diagonal.
        angle: Maximum angle (degrees) between neighbouring triangle normals on curved faces.
        max_edge: The longest edge a triangle may have (default: no limit): evenly sized
            triangles for simulation meshes, deformation or sampling, where the tolerance alone
            leaves a flat face two long triangles. A plate 100 long at tolerance 0.1 gets
            triangles 100 long; ``max_edge=10`` keeps them under 13 (the kernel splits by
            about that length).

    The kernel cuts each face into a grid whose lines it places by the curves along the
    face's borders. A face that is straight in one direction and twisted along it (the sides
    of a twisted bar, a ruled loft between different curves, the walls of a thickened
    free-form sheet) gets no lines across, so a body with such a face is divided by halving
    its faces until every part is flat within the tolerance: more triangles, but within the
    tolerance. So is a body with a free-form face whose surface the grid misses (a bump
    between its lines). On spheres, tori, cones and cylinders, edges whose middle is off the
    face by more than the tolerance are split onto it (the grid's slivers near the poles of a
    sphere). Other bodies get the grid's triangles.

    With ``max_edge`` every body gets the grid (the halving cannot take a longest edge): a body
    with a twisted face whose grid triangles are then off by more than twice the tolerance gets a
    ``RuntimeWarning`` saying how far (a smaller ``max_edge`` brings them nearer).
    """
    return _tessellate(shape, tolerance, angle, False, max_edge)


def _tessellate(shape: "Shape", tolerance: float | None, angle: float, keep: bool,
                max_edge: float | None = None) -> Mesh:
    """:func:`tessellate`; with ``keep``, the mesh keeps the kernel's mesh of the tessellation
    (for the faces of its triangles and the curvature at its corners), and the caller disposes
    it."""
    from .shapes import Face, ShapeList, _Body

    if max_edge is not None and not (isinstance(max_edge, numbers.Real) and max_edge > 0):
        raise ValueError("tessellate: max_edge must be a positive length")
    if isinstance(shape, ShapeList):
        meshes = [tessellate(s, tolerance, angle, max_edge=max_edge) for s in shape]
        return merge(meshes)
    turned = False
    if isinstance(shape, Face):
        # A face is meshed as a copy in a sheet of its own, which faces where the face's
        # surface normal points: the mesh of a face whose surface normal points into its body
        # is turned.
        turned = not shape._natural_is_outward()
        shape = shape.to_shell()
    if not isinstance(shape, _Body):
        raise TypeError(f"cannot tessellate a {type(shape).__name__}")
    if shape._brep.face_count() == 0:
        # (the kernel's own message for it was "tessellate failed")
        name = f" {shape.name!r}" if shape.name else ""
        raise ValueError(f"tessellate: the {type(shape).__name__}{name} is empty: it has no faces to mesh (a Boolean "
                         "that left nothing?)")
    if tolerance is None:
        tolerance = max(shape.bbox().diagonal * 1e-3, 1e-6)
    if not tolerance > 0 or not angle > 0:
        raise ValueError("tessellate: tolerance and angle must be positive")
    with kernel_call("tessellate"):
        # the kernel's own tessellate (k.tessellate) always uses the grid
        poly = ext.tessellate(shape._brep, chord_height_tolerance=float(tolerance),
                              curve_angle_tolerance_deg=float(angle), surface_angle_tolerance_deg=float(angle),
                              max_edge_length=float(max_edge or 0.0))
    if max_edge is not None:
        _grid_note(shape, float(tolerance), float(angle), float(max_edge))
    mesh = Mesh._from_poly(poly, keep=keep, brep=shape._brep)
    if turned:  # (a kernel's mesh kept with it stays as it is)
        mesh.triangles = mesh.triangles[:, [0, 2, 1]]
        if mesh.normals is not None:
            mesh.normals = -mesh.normals[:, [0, 2, 1]]
    return mesh


def _grid_note(body: Any, tolerance: float, angle: float, max_edge: float) -> None:
    """Warns where ``max_edge`` kept the grid on a body that the tessellation would halve (a
    twisted face, see :func:`tessellate`) and the grid's triangles are off that face by more than
    twice the tolerance."""
    with kernel_call("tessellate"):
        if ext.tessellation_algorithm(body._brep, chord_height_tolerance=tolerance,
                                      surface_angle_tolerance_deg=angle) != "halving":
            return
        worst = max((ext.grid_deviation(f._f, chord_height_tolerance=tolerance, surface_angle_tolerance_deg=angle,
                                        max_edge_length=max_edge) for f in body.faces()), default=0.0)
    if worst > 2 * tolerance:
        warnings.warn(f"tessellate: with max_edge the kernel's grid meshes every face, and a twisted face of this "
                      f"body (straight one way and twisted along it: the side of a twisted bar, a ruled loft) gets "
                      f"triangles about {worst:.3g} off it, for a tolerance of {tolerance:.3g}; give a smaller "
                      f"max_edge, or leave it out", RuntimeWarning, stacklevel=4)


def face_meshes(shape: "Shape", tolerance: float | None = None, angle: float = 15.0) -> list[Mesh]:
    """One mesh per face of a part, shell or sketch (in ``shape.faces()`` order), cut from
    one tessellation of the whole body. Faces of imported bodies that the kernel cannot
    mesh on their own (copied out of the body) get theirs this way, and the faces share
    the points where they meet."""
    mesh = _tessellate(shape, tolerance, angle, True)
    try:
        return _face_meshes(shape, mesh)
    finally:
        mesh.dispose()


def _colored_mesh(shape: "Shape", tolerance: float | None = None, angle: float = 15.0,
                  max_edge: float | None = None) -> tuple[Mesh, np.ndarray | None]:
    """:func:`tessellate`, and where faces of a body have colors of their own (``Face.color``,
    kernel plan T5), per triangle the color of its face, (n, 3) from 0 to 1 with NaN for a face
    without one; None where no face has one."""
    from .shapes import _Body

    if not isinstance(shape, _Body) or all(c is None for c in ext.face_attrs(shape._brep)[0]):
        return tessellate(shape, tolerance, angle, max_edge=max_edge), None
    mesh = _tessellate(shape, tolerance, angle, True, max_edge)
    try:
        return mesh, _triangle_colors(shape, mesh)
    finally:
        mesh.dispose()


def _triangle_colors(shape: "Shape", mesh: Mesh) -> np.ndarray | None:
    """Per triangle of a body's mesh that keeps its tessellation, the own color of its face (NaN
    for a face without one); None where no face has one."""
    colors, _ = ext.face_attrs(shape._brep)  # type: ignore[attr-defined]
    if all(c is None for c in colors):
        return None
    table = np.array([c if c is not None else (np.nan, np.nan, np.nan) for c in colors], dtype=np.float64)
    return table[_triangle_faces(shape, mesh)]


def _triangle_faces(shape: "Shape", mesh: Mesh) -> np.ndarray:
    """For each triangle of a mesh made with ``_tessellate(shape, ..., keep=True)``, the index
    of the face of ``shape`` (in ``shape.faces()`` order) it lies on (none for a mesh without
    its tessellation)."""
    poly = mesh._poly.poly if mesh._poly is not None else None
    if poly is None:
        return np.zeros(0, dtype=np.int64)
    owners = np.asarray(ext.poly_face_indices(poly, shape._brep), dtype=np.int64)
    polygons = np.asarray(ext.poly_arrays(poly, False)["faces"], dtype=np.int64)
    sizes, i = [], 0
    while i < len(polygons):
        sizes.append(int(polygons[i]))
        i += sizes[-1] + 1
    owner = np.repeat(owners, np.maximum(np.array(sizes, dtype=np.int64) - 2, 0))  # per triangle
    if len(owner) != len(mesh.triangles):
        raise ModelingError("tessellate: the mesh does not say which face each triangle belongs to")
    return owner


def _face_meshes(shape: "Shape", mesh: Mesh) -> list[Mesh]:
    poly = mesh._poly.poly if mesh._poly is not None else None
    count = len(shape.faces())
    if poly is None:
        return [Mesh(np.zeros((0, 3)), np.zeros((0, 3))) for _ in range(count)]
    owner = _triangle_faces(shape, mesh)
    out = []
    for fi in range(count):
        sel = owner == fi
        tris = mesh.triangles[sel]
        used, local = np.unique(tris, return_inverse=True)
        out.append(Mesh(mesh.vertices[used], local.reshape(-1, 3),
                        None if mesh.normals is None else mesh.normals[sel]))
    return out


def merge(meshes: list[Mesh]) -> Mesh:
    """Concatenate meshes (no Boolean)."""
    verts, tris, norms = [], [], []
    off = 0
    for m in meshes:
        verts.append(m.vertices)
        tris.append(m.triangles + off)
        norms.append(m.normals if m.normals is not None else np.repeat(m.triangle_normals[:, None, :], 3, axis=1))
        off += len(m.vertices)
    return Mesh(np.vstack(verts), np.vstack(tris), np.vstack(norms))
