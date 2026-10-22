"""USD files of exact bodies.

NVIDIA's usd-brep stores B-reps in USD as ``BrepArray`` prims (its omniSolid schema): the
topology and the exact geometry of each body as arrays, which USD tools with that schema (usd-brep,
its usdview plugin, Omniverse) read as solids. Other USD tools and viewers do not draw them, so each
body is written as a ``Mesh`` prim too. smlibpy writes and reads them as ``.usda`` text with
usd-brep's own conversion (compiled in, without OpenUSD). Binary USD (``.usdc``, ``.usdz``) is not
written or read: OpenUSD's ``usdcat`` converts between text and ``.usdc``, ``usdzip`` packs a
``.usdz``.
"""

from __future__ import annotations

import os
import warnings
from typing import Any

from ._kernel import KernelError, ext, kernel_call
from .colors import to_rgb

__all__ = ["export_usd", "import_usd"]

# what to do instead of writing binary USD
_BINARY = {
    ".usdc": "write a .usda and convert it with usdcat (usdcat out.usda -o out.usdc), or in Python with OpenUSD: "
             "Sdf.Layer.FindOrOpen('out.usda').Export('out.usdc')",
    ".usdz": "write a .usda and pack it with usdzip (usdzip out.usdz out.usda), or in Python with OpenUSD: "
             "UsdUtils.CreateNewUsdzPackage('out.usda', 'out.usdz')",
}


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


def export_usd(shapes: Any, path: str | os.PathLike[str], *, mesh: bool = True, tolerance: float | None = None,
               angle: float = 15.0) -> None:
    """Write parts, sheets and meshes to a USD file (``.usda``, or ``.usd`` as text).

    Each body becomes a ``BrepArray`` prim under ``/World``, its exact B-rep with its name and
    color, and a ``Mesh`` prim of it (``<name>_mesh``), which is what USD viewers draw. The stage
    is in millimeters (``metersPerUnit = 0.001``) with Z up.

    Args:
        shapes: Parts, sheets, faces and meshes (or lists of them). Meshes become ``Mesh`` prims.
        mesh: Write the ``Mesh`` prim of each body; ``tolerance`` and ``angle`` as in
            :func:`tessellate`. ``False`` writes the exact B-reps alone, for usd-brep and Omniverse,
            which draw ``BrepArray`` prims themselves and would show each body twice.
    """
    p = os.fspath(path)
    ext_ = os.path.splitext(p)[1].lower()
    if ext_ in _BINARY:
        raise ValueError(f"export_usd writes text USD (.usda, .usd), not {ext_}: {_BINARY[ext_]}")
    items, keep = _usd_items(shapes, mesh, tolerance, angle)
    if not items:
        raise ValueError("export_usd: nothing to write")
    with kernel_call("export_usd"):
        text = ext.usd_text(items, "Z", 0.001)
    del keep
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(text)


def import_usd(path: str | os.PathLike[str], *, heal: bool = False, units: str | None = None, placement: bool = True,
               check: bool = True, partial: bool = False) -> Any:
    """Read the bodies of the ``BrepArray`` prims of a USD text file (``.usda``, ``.usd``).

    Returns a single :class:`~smlibpy.Part` (or :class:`~smlibpy.Shell` for a body that encloses
    no volume) when the file holds one body, otherwise a :class:`~smlibpy.ShapeList` of them,
    named and colored as their prims (a body whose prim's name another prim has too is named by
    its prim's path).

    The file is read as USD composes it: its ``subLayers`` and the files its prims reference
    (``references``, ``payload``) are read too, relative to the file that names them (text USD
    only); prims that are abstract (``class``), inactive (``active = false``) or only ``over``
    hold no bodies. A reference that cannot be read is named in a warning.

    Args:
        heal: Run the kernel's import healer on the bodies.
        units: The stage's unit, ``"mm"``, ``"cm"``, ``"m"``, ``"um"`` or ``"inch"``, in place of
            its ``metersPerUnit``. ``None`` takes the stage's ``metersPerUnit``; a stage that has
            none is taken as millimeters (USD itself takes centimeters then). Lengths come out in
            millimeters.
        placement: Place the bodies as the stage does: the transforms (``xformOp``) of their prims
            and of the prims above them, and a stage whose ``upAxis`` is ``"Y"`` turned to Z up.
            ``False`` leaves each body where its prim has it.
        check: Check each body with the kernel before anything measures it (bodies smlibpy wrote are
            not checked): a body whose faces, edges and vertices leave gaps of more than 1e-3 of its
            size raises ``ValueError``, smaller gaps give a warning.
        partial: Leave out the bodies that cannot be read, with a ``RuntimeWarning`` for each that
            says which and why, and return the others (as usd-brep's ``allow_partial``). ``False``
            raises for the first one. A file none of whose bodies can be read raises either way.

    A malformed ``BrepArray`` raises a ``ValueError`` that says what is wrong, in which body, face
    or edge, with the rule of usd-brep's validator it breaks. A body the kernel cannot build raises
    a :class:`KernelError` that names it (``body 0 of the BrepArray "/World/ball" could not be
    built``).

    Edges come back with the curves they had: lines, circles and ellipses that ``export_usd``
    wrote as such, and B-spline edges that are lines or circular arcs exactly (usd-brep and
    Omniverse write every edge as a B-spline) as lines and circles.
    """
    from .shapes import Part, Shell, ShapeList

    per_unit = 0.0
    if units is not None:
        from .step import _MM_PER_UNIT

        if units not in _MM_PER_UNIT:
            raise ValueError(f"unknown unit {units!r}; use mm, cm, m, um or inch")
        per_unit = _MM_PER_UNIT[units]
    root = os.path.abspath(os.fspath(path))
    with open(root, "rb") as fh:
        data = fh.read()
    layers = _layers(root, data.decode("utf-8", "replace"))
    try:
        with kernel_call("import_usd"):
            stage = ext.usd_stage(layers, heal, check, placement, per_unit, partial)
    except KernelError as e:
        # (the body that could not be built, and why, in the message)
        raise KernelError(e.operation, e.detail, e.status, _built_hint(e.detail, e.status)) from e.__cause__
    found = stage["bodies"]
    if not found:
        if stage["skipped"]:
            raise ValueError("import_usd: no body of the file can be read: " + "; ".join(stage["skipped"]))
        raise ValueError("the USD file holds no BrepArray prims (bodies)"
                         + "".join(f"; {note}" for note in stage["unresolved"]))
    for note in stage["skipped"]:
        warnings.warn(f"import_usd: {note}; it is left out", RuntimeWarning, stacklevel=2)
    for note in stage["warnings"] + stage["unresolved"]:
        warnings.warn(f"import_usd: {note}", RuntimeWarning, stacklevel=2)
    out = ShapeList()
    for brep, name, color in found:
        # a part when it encloses a volume (one cell or more, see Part.merge), else a sheet
        regions = ext.brep_dump(brep, False)["regions"]
        solid = any(not r["infinite"] and not r["void"] for r in regions)
        out.append((Part if solid else Shell)._wrap(brep, name=name, color=tuple(color) if color else None))
    return out[0] if len(out) == 1 else out


def _built_hint(detail: str, status: str | None) -> str:
    """The hint of the KernelError of a body that could not be built: which, why (the status once:
    the message has it), and partial."""
    which = detail.removeprefix("usd: ").replace(f" ({status})", "", 1) if status else detail.removeprefix("usd: ")
    return which + "; partial=True leaves such bodies out and reads the others"


def _layers(root: str, text: str) -> list[tuple[str, str, dict[str, str], dict[str, str]]]:
    """The layers of the stage whose root layer is ``text`` (the file ``root``): it and every layer
    the layers name (subLayers, references, payloads), each read once, a relative path taken from
    the directory of the layer that names it. Per layer (id, text, {asset: id of the layer read for
    it}, {asset: why none was read})."""
    layers: dict[str, tuple[str, dict[str, str], dict[str, str]]] = {}
    todo = [(root, text)]
    while todo:
        id_, body = todo.pop()
        if id_ in layers:
            continue
        links: dict[str, str] = {}
        missing: dict[str, str] = {}
        layers[id_] = (body, links, missing)
        with kernel_call("import_usd"):
            assets = ext.usd_assets(body)
        for asset in assets:
            if "://" in asset or "[" in asset:
                missing[asset] = "it is not a file path"
                continue
            target = os.path.normpath(os.path.join(os.path.dirname(id_), asset))
            if target in layers:
                links[asset] = target
                continue
            try:
                with open(target, "rb") as fh:
                    data = fh.read()
            except OSError:
                missing[asset] = f"there is no file {target}"
                continue
            if not data.startswith(b"#usda"):
                missing[asset] = "it is binary USD, which is not read" if data[:8] == b"PXR-USDC" or data[:2] == b"PK" \
                    else "it is not a .usda text"
                continue
            links[asset] = target
            todo.append((target, data.decode("utf-8", "replace")))
    order = [root] + [k for k in layers if k != root]
    return [(k, *layers[k]) for k in order]
