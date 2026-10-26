"""OpenCASCADE ``.brep`` files.

``.brep`` is the B-rep format of OpenCASCADE and of the tools built on it (build123d, CadQuery,
FreeCAD's Part workbench): the exact topology and geometry of one shape (a solid, a shell, a face
or a compound of them), as ``BRepTools::Write`` writes it (ASCII) or ``BinTools::Write``
(binary). It holds no names, colors or units (OpenCASCADE tools model in millimeters).

smlibpy reads and writes it with NVIDIA usd-brep's bridge to OpenCASCADE's format (compiled in,
without OpenCASCADE): a shape's faces, edges and vertices with their exact planes, cylinders,
cones, spheres, tori and B-splines, and the curves of its edges in the parameters of their faces
that OpenCASCADE needs, made anew from the exact geometry.
"""

from __future__ import annotations

import os
import warnings
from typing import Any

from ._kernel import ModelingError, ext, kernel_call

__all__ = ["export_brep", "import_brep", "to_brep", "from_brep"]


def _bodies(shapes: Any, what: str) -> tuple[list[Any], list[Any]]:
    """The kernel Breps of the parts and sheets of ``shapes`` (and the bodies, kept alive while the
    C++ reads them)."""
    from .exporters import _items
    from .mesh import Mesh

    keep = []
    for it in _items(shapes, what=what):
        if isinstance(it, Mesh):
            raise TypeError(f"{what}: a .brep file holds exact bodies, not a Mesh: write meshes with export_stl, "
                            "export_obj or export_glb")
        b = it._brep
        if b.face_count() == 0:
            raise ValueError(f"{what}: the {type(it).__name__}{f' {it.name!r}' if it.name else ''} has no faces to "
                             "write (a Boolean that left nothing?)")
        keep.append(it)
    if not keep:
        raise ValueError(f"{what}: nothing to write")
    return [it._brep for it in keep], keep


def _text(shapes: Any, what: str) -> str:
    breps, keep = _bodies(shapes, what)
    try:
        with kernel_call(what):
            text = ext.occt_text(breps)
    except ValueError as e:
        raise ValueError(str(e).replace("brep: ", f"{what}: ", 1)) from None
    del keep
    return text


def to_brep(shapes: Any) -> str:
    """The text of an OpenCASCADE ``.brep`` file of parts and sheets, as :func:`export_brep`
    writes it: ``BRepTools::Read`` and ``from_brep`` read it back."""
    return _text(shapes, "to_brep")


def export_brep(shapes: Any, path: str | os.PathLike[str]) -> None:
    """Write parts, sheets and faces to an OpenCASCADE ``.brep`` file (ASCII, as OpenCASCADE's
    ``BRepTools::Write`` writes it), which build123d (``import_brep``), CadQuery
    (``importBrep``), FreeCAD and OpenCASCADE itself read.

    The file holds one shape: the solid or shell of a single body, or a compound of the bodies
    (a part with several solids gives one solid each, a sheet its shell; a sheet whose faces
    share no edge, a shell per connected set). Faces keep their exact surfaces (planes,
    cylinders, cones, spheres, tori and B-splines; surfaces of revolution and extrusions are
    written as the B-splines they are), edges their curves (lines, circles, ellipses, B-splines),
    and every edge gets its curves in the parameters of its faces, as OpenCASCADE requires.
    Names and colors are not written: the format has no place for them (``export_step`` keeps
    them).

    Raises ``ValueError`` for a body without faces, ``TypeError`` for meshes, curves and points,
    and :class:`~smlibpy.KernelError` where a body cannot be converted (an edge that lies farther
    from its face than 1e-3 of the body's size, a face whose boundary does not close).
    """
    text = _text(shapes, "export_brep")
    with open(os.fspath(path), "w", encoding="ascii", newline="\n") as fh:
        fh.write(text)


def _read(data: bytes, heal: bool, check: bool, strict: bool, what: str) -> Any:
    from .exporters import _body
    from .shapes import ShapeList

    try:
        with kernel_call(what):
            got = ext.occt_read(data, heal, check)
    except ValueError as e:
        raise ValueError(str(e).replace("brep: ", f"{what}: ", 1)) from None
    if strict and got["skipped"]:
        raise ModelingError(f"{what}: {got['skipped'][0]}")  # (the bodies read are freed with got)
    for note in got["skipped"]:
        warnings.warn(f"{what}: {note}; left out (strict=True raises)", RuntimeWarning, stacklevel=3)
    for note in got["warnings"]:
        warnings.warn(f"{what}: {note}", RuntimeWarning, stacklevel=3)
    out = ShapeList(_body(b, None, None, what, stacklevel=4) for b in got["bodies"])
    return out[0] if len(out) == 1 else out


def import_brep(path: str | os.PathLike[str], *, heal: bool = False, check: bool = True, strict: bool = False) -> Any:
    """Read an OpenCASCADE ``.brep`` file (ASCII from ``BRepTools::Write``, binary from
    ``BinTools::Write``), as build123d (``export_brep``), CadQuery (``exportBrep``), FreeCAD and
    OpenCASCADE write it.

    Returns a :class:`~smlibpy.Part` for each solid of the file's shape and a
    :class:`~smlibpy.Shell` for each shell or face that is no solid's (a single shape when there
    is one, otherwise a :class:`~smlibpy.ShapeList` in the order of the file's compound), placed
    as the file places them and in its units (millimeters for the tools above). Faces and edges
    keep their exact geometry: planes, cylinders, cones, spheres, tori and B-splines come back as
    those; surfaces of extrusion and revolution, Bezier surfaces and offset geometry as B-splines.

    Args:
        heal: Run the kernel's import healer on the bodies.
        check: Check each body with the kernel before anything measures it: one whose faces,
            edges and vertices leave gaps of more than 1e-3 of its size raises ``ValueError``,
            smaller gaps give a warning.
        strict: Raise :class:`ModelingError` where a solid, shell or face of the file cannot be read.
            ``False`` (as for :func:`~smlibpy.import_step`, :func:`~smlibpy.import_iges` and
            :func:`~smlibpy.import_usd`) leaves it out with a ``RuntimeWarning`` and returns the
            others.

    Curves and points outside faces (wires, edges and vertices of the compound) are not read: a
    ``RuntimeWarning`` names how many. A file that is not a ``.brep`` file, or whose shape holds
    no faces, raises ``ValueError``; one the kernel cannot build, :class:`~smlibpy.KernelError`.
    """
    with open(os.fspath(path), "rb") as fh:
        data = fh.read()
    return _read(data, heal, check, strict, "import_brep")


def from_brep(data: str | bytes, *, heal: bool = False, check: bool = True, strict: bool = False) -> Any:
    """The bodies of an OpenCASCADE ``.brep`` file's contents (the text of an ASCII file, or the
    bytes of either kind), as :func:`import_brep` reads a file; the keywords as there."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError(f"from_brep reads the contents of a .brep file as bytes or str, not {type(data).__name__}")
    return _read(bytes(data), heal, check, strict, "from_brep")
