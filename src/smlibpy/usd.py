"""USD files of exact bodies.

NVIDIA's usd-brep stores B-reps in USD as ``BrepArray`` prims (its omniSolid schema): the
topology and the exact geometry of each body as arrays, which USD tools with that schema (usd-brep,
its usdview plugin, Omniverse) read as solids. smlibpy writes and reads them as ``.usda`` text with
usd-brep's own conversion (compiled in, without OpenUSD). Binary USD (``.usdc``, ``.usdz``) is not
written or read: ``usdcat`` converts between text and binary.
"""

from __future__ import annotations

import os
from typing import Any

from ._kernel import ext, kernel_call
from .colors import to_rgb

__all__ = ["export_usd", "import_usd"]

_BINARY = (".usdc", ".usdz")


def _usd_items(shapes: Any, mesh: bool, tolerance: float | None, angle: float) -> list[tuple[Any, ...]]:
    from .exporters import _DEFAULT_COLORS, _items
    from .mesh import Mesh, tessellate

    items = []
    keep = []  # (the bodies stay alive while the C++ reads their Breps)
    for i, it in enumerate(_items(shapes)):
        color = getattr(it, "color", None) or _DEFAULT_COLORS[i % len(_DEFAULT_COLORS)]
        rgb = tuple(float(c) for c in to_rgb(color))
        name = getattr(it, "name", None) or ("mesh" if isinstance(it, Mesh) else "body")
        if isinstance(it, Mesh):
            items.append((None, name, rgb, *_mesh_arrays(it)))
            continue
        keep.append(it)
        if mesh:
            items.append((it._brep, name, rgb, *_mesh_arrays(tessellate(it, tolerance, angle))))
        else:
            items.append((it._brep, name, rgb, None, None, None))
    return items, keep  # type: ignore[return-value]


def _mesh_arrays(m: Any) -> tuple[list[float], list[int], list[float] | None]:
    normals = None if m.normals is None else m.normals.astype(float).ravel().tolist()
    return m.vertices.ravel().tolist(), m.triangles.ravel().tolist(), normals


def export_usd(shapes: Any, path: str | os.PathLike[str], *, mesh: bool = False, tolerance: float | None = None,
               angle: float = 15.0) -> None:
    """Write parts, sheets and meshes to a USD file (``.usda``, or ``.usd`` as text).

    Each body becomes a ``BrepArray`` prim under ``/World``: its exact B-rep, with its name and
    color. The stage is in millimeters (``metersPerUnit = 0.001``) with Z up.

    Args:
        shapes: Parts, sheets, faces and meshes (or lists of them). Meshes become ``Mesh`` prims.
        mesh: Also write a ``Mesh`` prim (``<name>_mesh``) of each body, for USD tools that do not
            read B-reps (most viewers); ``tolerance`` and ``angle`` as in :func:`tessellate`.
    """
    p = os.fspath(path)
    ext_ = os.path.splitext(p)[1].lower()
    if ext_ in _BINARY:
        raise ValueError(f"export_usd writes text USD (.usda, .usd), not {ext_}; convert it with usdcat "
                         f"(usdcat out.usda -o out{ext_})")
    items, keep = _usd_items(shapes, mesh, tolerance, angle)
    if not items:
        raise ValueError("export_usd: nothing to write")
    with kernel_call("export_usd"):
        text = ext.usd_text(items, "Z", 0.001)
    del keep
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(text)


def import_usd(path: str | os.PathLike[str], *, heal: bool = False) -> Any:
    """Read the bodies of the ``BrepArray`` prims of a USD text file (``.usda``, ``.usd``).

    Returns a single :class:`~smlibpy.Part` (or :class:`~smlibpy.Shell` for a body that encloses
    no volume) when the file holds one body, otherwise a :class:`~smlibpy.ShapeList` of them,
    named and colored as their prims. Lengths are taken as they are (smlibpy writes millimeters).
    ``heal`` runs the kernel's import healer on them. A malformed BrepArray raises a
    ``ValueError`` that says what is wrong.
    """
    from .shapes import Part, Shell, ShapeList

    with open(os.fspath(path), "rb") as fh:
        data = fh.read()
    text = data.decode("utf-8", "replace")
    with kernel_call("import_usd"):
        found = ext.usd_read(text, heal)
    if not found:
        raise ValueError("the USD file holds no BrepArray prims (bodies)")
    out = ShapeList()
    for brep, name, color in found:
        # a part when it encloses a volume (one cell or more, see Part.merge), else a sheet
        regions = ext.brep_dump(brep, False)["regions"]
        solid = any(not r["infinite"] and not r["void"] for r in regions)
        out.append((Part if solid else Shell)._wrap(brep, name=name, color=tuple(color) if color else None))
    return out[0] if len(out) == 1 else out
