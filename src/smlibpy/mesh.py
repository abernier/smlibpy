"""Triangle meshes: tessellation of exact shapes, mesh Booleans, mesh files."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np

from ._kernel import PolyHandle, ext, k, kernel_call
from .geometry import BoundBox, Vector

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
        if self._poly is not None and self._poly.poly is not None:
            return self._poly.poly
        raise TypeError("mesh Booleans need meshes produced by tessellate()")

    def _bool(self, other: Mesh, op: Any, name: str) -> Mesh:
        with kernel_call(f"mesh {name}"):
            a = self._poly_brep().copy()
            b = other._poly_brep().copy()
            r = k.poly_boolean(a, b, op)
        return Mesh._from_poly(r)

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
        shape: A part, sketch, shell or face.
        tolerance: Maximum distance between mesh and exact surface. Default: 0.1 % of the
            bounding box diagonal.
        angle: Maximum angle (degrees) between neighbouring triangle normals on curved faces.
    """
    from .shapes import Face, ShapeList, _Body

    if isinstance(shape, ShapeList):
        meshes = [tessellate(s, tolerance, angle) for s in shape]
        return merge(meshes)
    if isinstance(shape, Face):
        shape = shape.to_shell()
    if not isinstance(shape, _Body):
        raise TypeError(f"cannot tessellate a {type(shape).__name__}")
    if tolerance is None:
        tolerance = max(shape.bbox().diagonal * 1e-3, 1e-6)
    with kernel_call("tessellate"):
        poly = k.tessellate(shape._brep, chord_height_tolerance=float(tolerance),
                            curve_angle_tolerance_deg=float(angle), surface_angle_tolerance_deg=float(angle))
    return Mesh._from_poly(poly)


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
