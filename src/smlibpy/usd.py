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
import re
import warnings
from typing import Any, Callable

import numpy as np

from ._kernel import KernelError, ModelingError, _traced, ext, kernel_call
from .colors import to_rgb

__all__ = ["export_usd", "import_usd", "to_usd", "from_usd"]

# what to do instead of writing binary USD
_BINARY = {
    ".usdc": "write a .usda and convert it with usdcat (usdcat out.usda -o out.usdc), or in Python with OpenUSD: "
             "Sdf.Layer.FindOrOpen('out.usda').Export('out.usdc')",
    ".usdz": "write a .usda and pack it with usdzip (usdzip out.usdz out.usda), or in Python with OpenUSD: "
             "UsdUtils.CreateNewUsdzPackage('out.usda', 'out.usdz')",
}


def _usd_items(shapes: Any, mesh: bool, tolerance: float | None, angle: float, what: str,
               max_edge: float | None = None) -> list[tuple[Any, ...]]:
    from .exporters import _DEFAULT_COLORS, _items
    from .mesh import Mesh, _colored_mesh

    items = []
    keep = []  # (the bodies stay alive while the C++ reads their Breps)
    for i, it in enumerate(_items(shapes, what=what)):
        color = getattr(it, "color", None) or _DEFAULT_COLORS[i % len(_DEFAULT_COLORS)]
        rgb = tuple(float(c) for c in to_rgb(color))
        name = getattr(it, "name", None) or ("mesh" if isinstance(it, Mesh) else "body")
        if isinstance(it, Mesh):
            items.append((None, name, rgb, *_mesh_arrays(it)))
            continue
        b = it._brep
        if b.face_count() == 0 and b.edge_count() == 0 and b.vertex_count() == 0:
            # (a BrepArray needs a shell, usd-brep's validator says, and a mesh of nothing fails)
            raise ValueError(f"{what}: the {type(it).__name__}{f' {it.name!r}' if it.name else ''} is empty: it has no "
                             "faces, edges or points to write (a Boolean that left nothing?)")
        keep.append(it)
        if mesh:
            # faces of their own color: a color per triangle (displayColor "uniform"), the others in the
            # body's (kernel plan T5)
            m, colors = _colored_mesh(it, tolerance, angle, max_edge)
            per = None if colors is None else np.where(np.isnan(colors), np.array(rgb), colors).ravel().tolist()
            items.append((b, name, rgb, *_mesh_arrays(m), per))
        else:
            items.append((b, name, rgb, None, None, None))
    return items, keep  # type: ignore[return-value]


def _mesh_arrays(m: Any) -> tuple[list[float], list[int], list[float] | None]:
    normals = None if m.normals is None else m.normals.astype(float).ravel().tolist()
    return m.vertices.ravel().tolist(), m.triangles.ravel().tolist(), normals


def _usd_text(shapes: Any, mesh: bool, tolerance: float | None, angle: float, materials: bool, what: str,
              max_edge: float | None = None) -> str:
    items, keep = _usd_items(shapes, mesh, tolerance, angle, what, max_edge)
    if not items:
        raise ValueError(f"{what}: nothing to write")
    with kernel_call(what):
        text = ext.usd_text(items, "Z", 0.001, materials)
    del keep
    return text


def to_usd(shapes: Any, *, mesh: bool = True, tolerance: float | None = None, angle: float = 15.0,
           materials: bool = False, max_edge: float | None = None) -> str:
    """The text of a USD file (``.usda``) of parts, sheets and meshes, as :func:`export_usd` writes
    it; the keywords as there."""
    return _usd_text(shapes, mesh, tolerance, angle, materials, "to_usd", max_edge)


def export_usd(shapes: Any, path: str | os.PathLike[str], *, mesh: bool = True, tolerance: float | None = None,
               angle: float = 15.0, materials: bool = False, max_edge: float | None = None) -> None:
    """Write parts, sheets and meshes to a USD file (``.usda``, or ``.usd`` as text).

    Each body becomes a ``BrepArray`` prim under ``/World``, its exact B-rep with its name and
    color, and a ``Mesh`` prim of it (``<name>_mesh``), which is what USD viewers draw. The stage
    is in millimeters (``metersPerUnit = 0.001``) with Z up.

    Args:
        shapes: Parts, sheets, faces and meshes (or lists of them). Meshes become ``Mesh`` prims.
            An empty body (no faces, edges or points) raises ``ValueError``; edges, wires and
            vertices raise ``TypeError`` (write curves with :func:`export_step`).
        mesh: Write the ``Mesh`` prim of each body; ``tolerance``, ``angle`` and ``max_edge`` as
            in :func:`tessellate`. ``False`` writes the exact B-reps alone, for usd-brep and Omniverse,
            which draw ``BrepArray`` prims themselves and would show each body twice.
        materials: Also give each color a ``Material`` (a ``UsdPreviewSurface`` of that color under
            ``/World/Looks``) bound to the prims of that color, which Omniverse and other renderers
            use where they leave ``displayColor`` aside. :func:`import_usd` reads such bindings back.
    """
    p = os.fspath(path)
    ext_ = os.path.splitext(p)[1].lower()
    if ext_ in _BINARY:
        raise ValueError(f"export_usd writes text USD (.usda, .usd), not {ext_}: {_BINARY[ext_]}")
    text = _usd_text(shapes, mesh, tolerance, angle, materials, "export_usd", max_edge)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(text)


def import_usd(path: str | os.PathLike[str], *, heal: bool = False, units: str | None = None, placement: bool = True,
               check: bool = True, strict: bool = False) -> Any:
    """Read the bodies of the ``BrepArray`` prims of a USD text file (``.usda``, ``.usd``).

    Returns a single :class:`~smlibpy.Part` (or :class:`~smlibpy.Shell` for a body that encloses
    no volume) when the file holds one body, otherwise a :class:`~smlibpy.ShapeList` of them,
    named and colored as their prims (a body whose prim's name another prim has too is named by
    its prim's path). A body's color is that of the material bound to it (the ``diffuseColor`` of
    the ``UsdPreviewSurface`` its material has, through a GeomSubset of bodies, the prim or a prim
    above it), or else its prim's ``displayColor``.

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
            size cannot be read; smaller gaps give a warning.
        strict: Raise for the first body that cannot be read. ``False`` (as for
            :func:`~smlibpy.import_step` and :func:`~smlibpy.import_iges`) leaves such bodies out,
            with a ``RuntimeWarning`` for each that says which and why, and returns the others (as
            usd-brep's ``allow_partial``); a file none of whose bodies can be read raises
            :class:`ModelingError` then.

    A body cannot be read where its ``BrepArray`` is malformed (with ``strict=True`` a
    ``ValueError`` that says what is wrong, in which body, face or edge, with the rule of
    usd-brep's validator it breaks), where the check refuses it (``ValueError``), or where the
    kernel cannot build it (a :class:`KernelError` that names it: ``body 0 of the BrepArray
    "/World/ball" could not be built``). A solid that also holds wire edges, points or faces
    outside it (which the schema allows) comes with a ``RuntimeWarning`` that names them: such a
    Part is not valid.

    Edges come back with the curves they had: lines, circles and ellipses that ``export_usd``
    wrote as such, and B-spline edges that are lines or circular arcs exactly (usd-brep and
    Omniverse write every edge as a B-spline) as lines and circles.
    """
    root = os.path.abspath(os.fspath(path))
    with open(root, "rb") as fh:
        data = fh.read()

    def read(asset: str, from_: str) -> tuple[str, bytes] | str:
        if "://" in asset or "[" in asset:
            return "it is not a file path"
        target = os.path.normpath(os.path.join(os.path.dirname(from_), asset))
        try:
            with open(target, "rb") as fh:
                return target, fh.read()
        except OSError:
            return f"there is no file {target}"

    return _stage(root, data.decode("utf-8", "replace"), read, heal, units, placement, check, strict, "import_usd")


def from_usd(data: str | bytes, *, heal: bool = False, units: str | None = None, placement: bool = True,
             check: bool = True, strict: bool = False,
             resolve: Callable[[str, str], str | bytes | None] | None = None) -> Any:
    """The bodies of the ``BrepArray`` prims of USD text in memory (``.usda``: the text, or the bytes
    of the file), as :func:`import_usd` reads a file; the keywords as there.

    The layers the text names (``subLayers``, ``references``, ``payload``) come from
    ``resolve(asset, from_)``, which gives the text (or bytes) of a layer, or None if it has none:
    ``asset`` as written, ``from_`` the name of the layer that names it ("" for the text given; a
    relative asset is taken from the directory of ``from_``). Without it such layers are not read,
    and a warning names them.
    """
    if isinstance(data, (bytes, bytearray, memoryview)):
        text = bytes(data).decode("utf-8", "replace")
    elif isinstance(data, str):
        text = data
    else:
        raise TypeError(f"from_usd reads USD text as a str or bytes, not {type(data).__name__}")

    def read(asset: str, from_: str) -> tuple[str, str | bytes] | str:
        if resolve is None:
            return "no resolve function was given to read it"
        got = resolve(asset, from_)
        return "resolve gave nothing for it" if got is None else (_joined(from_, asset), got)

    return _stage("", text, read, heal, units, placement, check, strict, "from_usd")


def _joined(from_: str, asset: str) -> str:
    """A path joined to the directory of another, '.' and '..' taken out (forward slashes)."""
    out: list[str] = []
    joined = asset if asset.startswith("/") else re.sub(r"[^\\/]*$", "", from_) + asset
    for part in re.split(r"[\\/]", joined):
        if part == ".." and out and out[-1] not in ("..", ""):
            out.pop()
        elif part != "." and not (part == "" and out):
            out.append(part)
    return "/".join(out)


def _stage(root: str, text: str, read: Callable[[str, str], Any], heal: bool, units: str | None, placement: bool,
           check: bool, strict: bool, what: str) -> Any:
    from .exporters import _body
    from .shapes import ShapeList

    per_unit = 0.0
    if units is not None:
        from .step import _MM_PER_UNIT

        if units not in _MM_PER_UNIT:
            raise ValueError(f"unknown unit {units!r}; use mm, cm, m, um or inch")
        per_unit = _MM_PER_UNIT[units]
    layers = _layers(root, text, read)
    try:
        with kernel_call(what):
            stage = ext.usd_stage(layers, heal, check, placement, per_unit, not strict)
    except KernelError as e:
        # (the body that could not be built, and why, in the message)
        raise _traced(KernelError(e.operation, e.detail, e.status, _built_hint(e.detail, e.status)), e) from e.__cause__
    found = stage["bodies"]
    if not found:
        if stage["skipped"]:
            raise ModelingError(f"{what}: no body of the file can be read: " + "; ".join(stage["skipped"]))
        raise ValueError("the USD file holds no BrepArray prims (bodies)"
                         + "".join(f"; {note}" for note in stage["unresolved"]))
    for note in stage["skipped"]:
        warnings.warn(f"{what}: {note}; it is left out", RuntimeWarning, stacklevel=3)
    for note in stage["warnings"] + stage["unresolved"]:
        warnings.warn(f"{what}: {note}", RuntimeWarning, stacklevel=3)
    out = ShapeList()
    for brep, name, color in found:
        # a part when it encloses a volume (one cell or more, see Part.merge), else a sheet
        out.append(_body(brep, name, tuple(color) if color else None, what, stacklevel=4))
    return out[0] if len(out) == 1 else out


def _built_hint(detail: str, status: str | None) -> str:
    """The hint of the KernelError of a body that could not be built (with strict=True): which, why
    (the status once: the message has it), and how to read the others."""
    which = detail.removeprefix("usd: ").replace(f" ({status})", "", 1) if status else detail.removeprefix("usd: ")
    return which + "; strict=False (the default) leaves such bodies out and reads the others"


def _layers(root: str, text: str,
            read: Callable[[str, str], Any]) -> list[tuple[str, str, dict[str, str], dict[str, str]]]:
    """The layers of the stage whose root layer is ``text`` (named ``root``): it and every layer
    the layers name (subLayers, references, payloads), each read once through ``read(asset,
    from_)``, which gives (the name of the layer read, its text or bytes) or why none was read. Per
    layer (id, text, {asset: id of the layer read for it}, {asset: why none was read})."""
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
            found = read(asset, id_)
            if isinstance(found, str):
                missing[asset] = found
                continue
            target, data = found
            if target in layers:
                links[asset] = target
                continue
            if isinstance(data, str):
                data = data.encode("utf-8")
            if not data.startswith(b"#usda"):
                missing[asset] = "it is binary USD, which is not read" if data[:8] == b"PXR-USDC" or data[:2] == b"PK" \
                    else "it is not a .usda text"
                continue
            links[asset] = target
            todo.append((target, data.decode("utf-8", "replace")))
    order = [root] + [k for k in layers if k != root]
    return [(k, *layers[k]) for k in order]
