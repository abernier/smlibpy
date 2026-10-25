"""IGES import: neutral B-rep data from ``iges_reader`` -> kernel bodies.

Solids (manifold solid B-rep objects, 186) are built as STEP bodies are: each face on its exact
surface, each edge on its exact curve, the faces sharing the edges the file gives them. Trimmed
and bounded surfaces (144, 143) share nothing: each is built as a face of its own, and the faces
are stitched together where their edges meet; what closes up becomes a part, the rest sheets.
"""

from __future__ import annotations

import os
import warnings
from collections import Counter
from typing import Any

import numpy as np

from ._kernel import KernelError, ModelingError, ext, k, kernel_call
from .iges_reader import IgesModel, interpret, parse
from .step_import import _build_body, _kernel_volume, _label, _reading
from .step_reader import _BODY_ERRORS, BodyData, _failure

__all__ = ["import_iges", "from_iges"]


def _one_face(model: IgesModel, i: int) -> BodyData:
    """Face ``i`` of the model's trimmed and bounded surfaces as a sheet of its own."""
    src = model.faces
    f = src.faces[i]
    b = BodyData(kind="sheet", name=f.get("name", ""))
    b.uncertainty = src.uncertainty
    emap: dict[int, int] = {}
    vmap: dict[int, int] = {}

    def vertex(v: int) -> int:
        if v not in vmap:
            vmap[v] = len(b.vertices)
            b.vertices.append(src.vertices[v])
        return vmap[v]

    loops = []
    for loop in f["loops"]:
        items = []
        for ei, fwd in loop["edges"]:
            if ei not in emap:
                e = src.edges[ei]
                b.curves.append(src.curves[e["curve"]])
                emap[ei] = len(b.edges)
                b.edges.append(dict(e, curve=len(b.curves) - 1, v0=vertex(e["v0"]), v1=vertex(e["v1"])))
            items.append((emap[ei], fwd))
        loops.append(dict(loop, edges=items))
    b.surfaces.append(src.surfaces[f["surface"]])
    b.faces.append(dict(f, surface=0, loops=loops))
    b.shells.append({"faces": [0], "reversed": False, "closed": False})
    return b


def _face(body: BodyData) -> Any:
    """A face of a trimmed or bounded surface, built; None for a sliver that has no area. IGES does
    not hold writers to an orientation of a face's boundary: where its outer loop runs clockwise
    in the parameters of its surface the face is built facing the other way, and a hole whose
    loop runs the way the outer loop does is turned round."""
    sheet = _build_body(body, np.eye(4), False)
    with kernel_call("import IGES"):
        info = ext.loop_areas(sheet._brep)[0]
    areas = info["loops"]
    if not areas or any(a is None for a in areas):
        return sheet  # (a loop that does not close in the parameters has no orientation to read)
    span = max(info["domain"])
    if abs(sum(areas)) <= 1e-9 * span * span:  # (narrower than 1e-9 of its length)
        return None
    outer = max(range(len(areas)), key=lambda i: abs(areas[i]))
    flip = areas[outer] < 0
    turn = [i for i, a in enumerate(areas) if i != outer and (a > 0) == (areas[outer] > 0)]
    if not flip and not turn:
        return sheet
    f = body.faces[0]
    loops = [dict(loop, edges=[(e, not fwd) for e, fwd in reversed(loop["edges"])]) if i in turn else loop
             for i, loop in enumerate(f["loops"])]
    body.faces[0] = dict(f, same_sense=f["same_sense"] != flip, loops=loops)
    return _build_body(body, np.eye(4), False)


def _stitched(sheets: list[Any], uncertainty: float | None) -> list[Any]:
    """Faces that share no edges stitched where their edges meet, and taken apart into the
    pieces that hang together: a :class:`Part` for each piece that closes up into a solid, a
    :class:`Shell` for each other one. The kernel's stitch first (it makes the solids), then a
    looser one for what stays open, closing gaps of up to 1e-4 of the model's size (or the
    file's resolution)."""
    from .shapes import Part, Shell

    with kernel_call("import IGES"):
        whole = Shell._wrap(ext.combine([s._brep for s in sheets]))
    size = whole._loose_box().diagonal
    try:
        with kernel_call("import IGES: stitch"):
            _, solid, _, _, _ = k.stitch_into_solid(whole._brep)
            if not solid:
                k.stitch_into_shell(whole._brep, max(uncertainty or 0.0, 1e-4 * size, 1e-9))
    except KernelError:
        pass  # (the faces as they are)
    with kernel_call("import IGES"):
        pieces = ext.separate_bodies(whole._brep) if len(whole.faces()) > 1 else [whole._copy_brep()]
    out = []
    for b in pieces:
        part = Part._wrap(b)
        faces = part.faces()
        if len(faces) == 1 and _no_area(faces[0], size):  # (the stitch can squeeze a sliver face to that)
            continue
        if part._shape_problem() is not None:
            # (a piece the loose stitch closed has no solid region yet)
            try:
                with kernel_call("import IGES: stitch"):
                    k.stitch_into_solid(part._brep)
            except KernelError:
                pass
        if part._shape_problem() is None:
            volume = _kernel_volume(part)  # (its sign: the precise volume is measured when asked for)
            if volume is not None and volume > 0:
                out.append(part)
                continue
        out.append(Shell._wrap(part._copy_brep()))
    return out


def _no_area(face: Any, size: float) -> bool:
    """Whether a face lies on a line (its loose box, within 1e-9 of the model's size, in two
    directions at least): a sliver that has no area."""
    lo, hi = face._f.bounding_box(False)
    return sorted(abs(b - a) for a, b in zip(lo, hi))[1] <= 1e-9 * size


def _bodies(text: str, heal: bool, strict: bool) -> tuple[list[Any], list[str]]:
    """The bodies of an IGES file, and what was left out (a message each). ``strict`` raises
    ``ModelingError`` for the first thing that cannot be read instead."""
    from .shapes import Shell

    skipped: list[dict[str, Any]] = []
    model = interpret(parse(text), skipped=skipped)
    if strict and skipped:
        raise ModelingError(f"import IGES: {skipped[0]['message']}")
    notes = [s["message"] for s in skipped]
    out: list[Any] = []

    def leave_out(what: str, e: BaseException) -> None:
        if strict:
            raise ModelingError(f"import IGES: {what}: {_failure(e)}") from e
        notes.append(f"{what}: {_failure(e)}")

    with _reading("IGES"):
        for body in model.solids:
            try:
                out.append(_build_body(body, np.eye(4), heal))
            except _BODY_ERRORS as e:
                leave_out(_label(body), e)
        sheets: list[Any] = []
        looks: list[tuple[Any, str]] = []  # (color, name) of each face
        for i, label in enumerate(model.face_labels):
            try:
                sheet = _face(_one_face(model, i))
                if sheet is None:
                    continue  # (a sliver of no area: some writers leave them where faces meet)
                sheets.append(sheet)
                looks.append((model.face_colors[i], model.face_names[i]))
            except _BODY_ERRORS as e:
                leave_out(label, e)
        for spec, rng, color, name, label in model.untrimmed:
            try:
                with kernel_call("import IGES"):
                    sheets.append(Shell._wrap(ext.surface_face(spec, list(rng))))
                looks.append((color, name))
            except _BODY_ERRORS as e:
                leave_out(label, e)
    if sheets:
        boxes = [s._loose_box() for s in sheets]
        for body in _stitched(sheets, model.faces.uncertainty):
            # a body takes the color its faces have (most of them), and the name they all have
            box = body._loose_box()
            mine = [look for look, b in zip(looks, boxes) if box.contains(b.center)]
            colors = Counter(c for c, _ in mine if c is not None)
            names = {n for _, n in mine}
            if colors:
                body.color = colors.most_common(1)[0][0]
            if len(names) == 1 and next(iter(names)):
                body.name = next(iter(names))
            out.append(body)
    for note in notes:
        warnings.warn(f"import IGES: left out {note}", RuntimeWarning, stacklevel=3)
    return out, notes


def import_iges(path: str | os.PathLike[str], *, heal: bool = True, strict: bool = False) -> Any:
    """Read the solids and surfaces of an IGES file (``.igs``, ``.iges``; IGES 5.3, ASCII).

    Returns a single :class:`~smlibpy.Part` (or :class:`~smlibpy.Shell`) when the file holds one
    body, otherwise a :class:`~smlibpy.ShapeList` of them, in millimeters whatever unit the file
    uses, named and colored as the file has them.

    Solids (manifold solid B-rep objects, entity 186) come in as STEP bodies do: each face on
    its exact surface, each edge on its exact curve, the faces sharing their edges. Trimmed and
    bounded surfaces (144, 143), the way most CAD systems write IGES, share nothing: each becomes
    a face, the faces are stitched where their edges meet, and each set of faces that closes up
    becomes a part, the others sheets. ``heal`` repairs solids that come out invalid, as
    :func:`import_step` does.

    Something that cannot be read (an entity smlibpy does not read, one the kernel cannot build)
    is left out with a ``RuntimeWarning`` that names it and the reason; ``strict=True`` raises
    ``ModelingError`` instead. A file none of whose bodies can be read raises.
    """
    with open(os.fspath(path), "r", encoding="latin-1") as fh:
        text = fh.read()
    found, skipped = _bodies(text, heal, strict)
    return _result(found, skipped)


def from_iges(data: str | bytes, *, heal: bool = True, strict: bool = False) -> Any:
    """Read the solids and surfaces of IGES file contents (the text, or the bytes of the file):
    :func:`import_iges` for contents in memory; ``heal`` and ``strict`` as there."""
    from .step_import import _text

    found, skipped = _bodies(_text(data, "from_iges"), heal, strict)
    return _result(found, skipped)


def _result(found: list[Any], skipped: list[str]) -> Any:
    from .shapes import ShapeList

    if not found:
        if skipped:
            raise ModelingError(f"import IGES: nothing in the file could be read: {'; '.join(skipped[:3])}"
                                + ("; ..." if len(skipped) > 3 else ""))
        raise ModelingError("the IGES file holds no solids or surfaces")
    for body in found:
        body._h.imported = True  # (read from a file: its fillets run in another process)
    out = ShapeList(found)
    return out[0] if len(out) == 1 else out
