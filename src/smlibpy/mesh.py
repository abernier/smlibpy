"""Triangle meshes: tessellation of exact shapes, mesh Booleans, mesh files."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np

from ._kernel import ModelingError, PolyHandle, ext, k, kernel_call
from .geometry import Axis, BoundBox, Hit, Vector, VectorLike, _direction, _vec

if TYPE_CHECKING:  # pragma: no cover
    from .shapes import Shape

__all__ = ["Mesh", "tessellate"]


class Mesh:
    """An indexed triangle mesh.

    Attributes:
        vertices: ``(n, 3)`` float array of positions.
        triangles: ``(m, 3)`` int array of vertex indices (counterclockwise seen from outside).
        normals: optional ``(m, 3, 3)`` corner normals (one per triangle corner), used for
            shading crisp CAD edges.
    """

    __slots__ = ("vertices", "triangles", "normals", "_poly")

    def __init__(self, vertices: Any, triangles: Any, normals: Any = None, _poly: PolyHandle | None = None):
        self.vertices = np.asarray(vertices, dtype=np.float64).reshape(-1, 3)
        self.triangles = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
        self.normals = None if normals is None else np.asarray(normals, dtype=np.float32).reshape(-1, 3, 3)
        self._poly = _poly

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
        v = self.vertices[self.triangles]
        return float(np.einsum("ij,ij->i", v[:, 0], np.cross(v[:, 1], v[:, 2])).sum() / 6.0)

    def bbox(self) -> BoundBox:
        return BoundBox(self.vertices.min(axis=0), self.vertices.max(axis=0))

    def center(self) -> Vector:
        return self.bbox().center

    def __len__(self) -> int:
        return len(self.triangles)

    # -- mesh Booleans (kernel polygon Booleans) -------------------------------
    def _poly_brep(self) -> Any:
        """The kernel's mesh of this one: from the tessellation, or built from the triangles
        (meshes read from files or made from arrays), stitched along the edges they share."""
        if self._poly is not None and self._poly.poly is not None:
            return self._poly.poly
        if not len(self.triangles):
            raise ValueError("mesh Booleans need triangles: this mesh has none")
        with kernel_call("mesh", "the mesh may have no triangle with an area"):
            poly = ext.poly_from_triangles(self.vertices.ravel().tolist(), self.triangles.ravel().tolist())
        self._poly = PolyHandle(poly)
        return poly

    def _bool(self, other: Mesh, op: Any, name: str) -> Mesh:
        with kernel_call(f"mesh {name}"):
            a = self._poly_brep().copy()
            b = other._poly_brep().copy()
            r = k.poly_boolean(a, b, op)
            ext.triangulate_poly(r)  # (its polygons with holes: the mesh arrays take only outer loops)
        result = Mesh._from_poly(r, normals=False)  # (the kernel gives a Boolean's result no normals)
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

    def is_closed(self) -> bool:
        """True if every edge of the mesh is shared by exactly two triangles (a watertight mesh)."""
        return self._open_edge_count() == 0

    def __add__(self, other: Mesh) -> Mesh:
        return self._bool(other, k.PolyBooleanOp.UNION, "union")

    def __sub__(self, other: Mesh) -> Mesh:
        return self._bool(other, k.PolyBooleanOp.DIFFERENCE, "difference")

    def __and__(self, other: Mesh) -> Mesh:
        return self._bool(other, k.PolyBooleanOp.INTERSECTION, "intersection")

    # -- construction ---------------------------------------------------------
    @classmethod
    def _from_poly(cls, poly: Any, normals: bool = True) -> Mesh:
        handle = PolyHandle(poly)
        arr = poly.to_numpy_arrays(face_varying_normals=normals)
        pts = np.asarray(arr["points"], dtype=np.float64)
        faces = np.asarray(arr["faces"], dtype=np.int64)
        tris, corner_idx = _triangulate(faces)
        n = None
        if normals:
            cn = np.asarray(arr["normals"], dtype=np.float32)
            if len(cn) == corner_idx.max(initial=-1) + 1:
                n = cn[corner_idx]
        return cls(pts, tris, n, handle)

    def export(self, path: str, **kwargs: Any) -> None:
        from .exporters import export

        export(self, path, **kwargs)

    def __repr__(self) -> str:
        return f"Mesh({len(self.vertices)} vertices, {len(self.triangles)} triangles)"


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


def tessellate(shape: "Shape", tolerance: float | None = None, angle: float = 15.0) -> Mesh:
    """Triangulate a shape.

    Args:
        shape: A part, sketch, shell or face. A face's mesh faces the way the face does in
            its body's mesh (out of a part).
        tolerance: Maximum distance between mesh and exact surface. Default: 0.1 % of the
            bounding box diagonal.
        angle: Maximum angle (degrees) between neighbouring triangle normals on curved faces.

    The kernel cuts each face into a grid whose lines it places by the curves along the
    face's borders. A face that is straight in one direction and twisted along it (the sides
    of a twisted bar, a ruled loft between different curves, the walls of a thickened
    free-form sheet) gets no lines across, so a body with such a face is divided by halving
    its faces until every part is flat within the tolerance: more triangles, but within the
    tolerance. Other bodies get the grid's triangles.
    """
    from .shapes import Face, ShapeList, _Body

    if isinstance(shape, ShapeList):
        meshes = [tessellate(s, tolerance, angle) for s in shape]
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
    if tolerance is None:
        tolerance = max(shape.bbox().diagonal * 1e-3, 1e-6)
    if not tolerance > 0 or not angle > 0:
        raise ValueError("tessellate: tolerance and angle must be positive")
    with kernel_call("tessellate"):
        # the kernel's own tessellate (k.tessellate) always uses the grid
        poly = ext.tessellate(shape._brep, chord_height_tolerance=float(tolerance),
                              curve_angle_tolerance_deg=float(angle), surface_angle_tolerance_deg=float(angle))
    mesh = Mesh._from_poly(poly)
    if turned:  # the kernel's mesh behind it (for mesh Booleans) stays as it is
        mesh.triangles = mesh.triangles[:, [0, 2, 1]]
        if mesh.normals is not None:
            mesh.normals = -mesh.normals[:, [0, 2, 1]]
    return mesh


def face_meshes(shape: "Shape", tolerance: float | None = None, angle: float = 15.0) -> list[Mesh]:
    """One mesh per face of a part, shell or sketch (in ``shape.faces()`` order), cut from
    one tessellation of the whole body. Faces of imported bodies that the kernel cannot
    mesh on their own (copied out of the body) get theirs this way, and the faces share
    the points where they meet."""
    mesh = tessellate(shape, tolerance, angle)
    poly = mesh._poly.poly if mesh._poly is not None else None
    count = len(shape.faces())
    if poly is None:
        return [Mesh(np.zeros((0, 3)), np.zeros((0, 3))) for _ in range(count)]
    owners = np.asarray(ext.poly_face_indices(poly, shape._brep), dtype=np.int64)
    polygons = np.asarray(poly.to_numpy_arrays(face_varying_normals=False)["faces"], dtype=np.int64)
    sizes, i = [], 0
    while i < len(polygons):
        sizes.append(int(polygons[i]))
        i += sizes[-1] + 1
    owner = np.repeat(owners, np.maximum(np.array(sizes, dtype=np.int64) - 2, 0))  # per triangle
    if len(owner) != len(mesh.triangles):
        raise ModelingError("tessellate: the mesh does not say which face each triangle belongs to")
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
