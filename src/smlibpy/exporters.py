"""Reading and writing files.

========  ===================================================  ==========
Format    Extension                                            Direction
========  ===================================================  ==========
STEP      ``.step``, ``.stp``                                  read/write
IGES      ``.igs``, ``.iges`` (solids and trimmed surfaces)    read
SMLib     ``.smb`` (exact native kernel format, one body)      read/write
SMLib     ``.smp`` (part file: bodies and curves, named)       read/write
DXF       ``.dxf`` (2D drawings: sketches, sections, curves)   read/write
SVG       ``.svg`` (2D drawings: views, curves)                write
glTF      ``.glb``, ``.gltf``                                  write
STL       ``.stl``                                             read/write
OBJ       ``.obj``                                             write
USD       ``.usda``, ``.usd`` (exact: BrepArray prims, as text)  read/write
BREP      ``.brep`` (OpenCASCADE's exact format)               read/write
========  ===================================================  ==========

Every format has a pair that works in memory (``to_step`` and ``from_step``, ``to_stl`` and
``from_stl``, ``to_glb``, ``to_gltf``, ``to_obj``, ``to_smb`` and ``from_smb``, ``to_smp`` and
``from_smp``, ``to_dxf`` and ``from_dxf``, ``to_usd`` and ``from_usd``, ``from_iges``,
``to_brep`` and ``from_brep``): text as ``str``, binary formats as ``bytes``. The functions for
files read and write files around them.
"""

from __future__ import annotations

import base64
import json
import os
import struct
import tempfile
import warnings
from typing import Any, Iterable, Sequence

import numpy as np

from ._kernel import CurveHandle, ext, k, kernel_call
from .colors import to_rgb
from .mesh import Mesh, _colored_mesh, tessellate

__all__ = [
    "export",
    "export_step",
    "export_stl",
    "export_glb",
    "export_gltf",
    "export_obj",
    "save",
    "load",
    "import_stl",
    "to_step",
    "to_stl",
    "from_stl",
    "to_obj",
    "to_glb",
    "to_gltf",
    "to_smb",
    "from_smb",
    "to_smp",
    "from_smp",
]


def _items(shapes: Any, faces: bool = False, what: str = "this writer") -> list[Any]:
    """The bodies and meshes of ``shapes`` (a shape, a mesh or nested lists of them); a face
    becomes a sheet of its own, or stays a face with ``faces``. Anything else raises a
    ``TypeError`` that says what ``what`` writes instead."""
    from .shapes import Face, Shape, _Body

    if isinstance(shapes, (_Body, Mesh)):
        return [shapes]
    if isinstance(shapes, Face):
        return [shapes if faces else shapes.to_shell()]
    if isinstance(shapes, (Shape, str, bytes)) or not hasattr(shapes, "__iter__") or _is_value(shapes):
        raise TypeError(_not_writable(shapes, what))
    out: list[Any] = []
    for s in shapes:
        out.extend(_items(s, faces, what))
    return out


def _is_value(x: Any) -> bool:
    from .geometry import Axis, Location, Plane, Vector

    return isinstance(x, (Vector, Axis, Location, Plane))


def _not_writable(item: Any, what: str) -> str:
    """Why ``what`` cannot write ``item`` (an edge, a point, ...), and what can."""
    from .geometry import Vector
    from .shapes import Edge, Vertex, Wire

    name = type(item).__name__
    article = "an" if name[:1].upper() in "AEIOU" else "a"
    smb = what in ("save", "to_smb")
    text = f"an .smb file holds one body, not {article} {name}" if smb else \
        f"{what} writes parts, sheets, faces and meshes, not {article} {name}"
    if isinstance(item, (Edge, Wire)):
        return text + (": save curves to an .smp file, which holds bodies and curves (or write them with export_step "
                       "or export_dxf)" if smb else ": export_step and export_dxf write curves, and so does save to an "
                       ".smp file")
    if isinstance(item, (Vertex, Vector)):
        return text + ": export_step writes points"
    return text


def _rgb(color: Any) -> tuple[float, float, float] | None:
    return None if color is None else tuple(float(c) for c in to_rgb(color))  # type: ignore[return-value]


def _label(name: str | None) -> str:
    return repr(name) if name else "the body"


def _components(dump: dict[str, Any], solid: bool) -> tuple[list[str], bool, bool]:
    """What a body read from a file holds beside its faces: wire edges (edges no face uses), points
    (vertices no edge uses) and, in a solid, faces outside it (of shells that do not close). The
    parts of the note, whether it has wire edges or points, whether it has faces outside."""
    used_edges: set[int] = set()
    used_vertices: set[int] = set()
    shells = dump["shells"]
    loose = 0
    for f in dump["faces"]:
        uses = f["uses"]
        for use in uses:
            for loop in use["loops"]:
                used_edges.update(e for e, _ in loop["edges"])
                if loop.get("vertex") is not None:
                    used_vertices.add(loop["vertex"])
        if solid and uses and all(not shells[u["shell"]]["closed"] for u in uses):
            loose += 1
    wires = [i for i in range(len(dump["edges"])) if i not in used_edges]
    for e in dump["edges"]:
        used_vertices.update((e["v0"], e["v1"]))
    points = [i for i in range(len(dump["vertices"])) if i not in used_vertices]
    parts = []
    if wires:
        parts.append(f"{len(wires)} wire edges (edges of no face)" if len(wires) > 1
                     else "1 wire edge (an edge of no face)")
    if points:
        parts.append(f"{len(points)} points (vertices of no edge)" if len(points) > 1
                     else "1 point (a vertex of no edge)")
    if loose:
        parts.append(f"{loose} face{'s' if loose > 1 else ''} outside the solid (a sheet)")
    return parts, bool(wires or points), bool(loose)


def _body(brep: Any, name: str | None, color: Any, what: str, stacklevel: int = 3) -> Any:
    """A body read from a file: a :class:`Part` when it encloses a volume (one cell or more, see
    Part.merge), else a :class:`Shell`, with a ``RuntimeWarning`` where it also holds wire edges,
    points or faces outside its solid (a Part that is then not valid), or holds no faces at all."""
    from .shapes import Part, Shell

    dump = ext.brep_dump(brep, False)
    solid = any(not r["infinite"] and not r["void"] for r in dump["regions"])
    body = (Part if solid else Shell)._wrap(brep, name=name, color=color)
    body._h.imported = True  # (read from a file: its fillets run in another process)
    parts, extra, loose = _components(dump, solid)
    if parts and not dump["faces"]:
        warnings.warn(f"{what}: {_label(name)} has no faces, only {' and '.join(parts)}: it is read as a Shell "
                      "without faces, whose edges() are its curves", RuntimeWarning, stacklevel=stacklevel)
    elif parts and solid:
        fix = ("part.solids() takes the faces outside the solid apart" if loose else
               "stitch(part.faces()) gives the solid alone")
        warnings.warn(f"{what}: {_label(name)} is a solid that also holds {' and '.join(parts)}, so is_valid() is "
                      f"False and modeling with it may fail; {fix}", RuntimeWarning, stacklevel=stacklevel)
    elif extra:
        warnings.warn(f"{what}: {_label(name)} also holds {' and '.join(parts)}", RuntimeWarning,
                      stacklevel=stacklevel)
    return body


def export(shapes: Any, path: str | os.PathLike[str], **kwargs: Any) -> None:
    """Write shapes to ``path``; the format follows the file extension."""
    p = os.fspath(path)
    ext = os.path.splitext(p)[1].lower()
    if ext in (".step", ".stp"):
        export_step(shapes, p, **kwargs)
    elif ext == ".stl":
        export_stl(shapes, p, **kwargs)
    elif ext == ".glb":
        export_glb(shapes, p, **kwargs)
    elif ext == ".gltf":
        export_gltf(shapes, p, **kwargs)
    elif ext == ".obj":
        export_obj(shapes, p, **kwargs)
    elif ext == ".smb":
        save(shapes, p, **kwargs)
    elif ext == ".dxf":
        from .dxf import export_dxf

        export_dxf(shapes, p, **kwargs)
    elif ext == ".smp":
        save(shapes, p, **kwargs)
    elif ext in (".usda", ".usd", ".usdc", ".usdz"):
        from .usd import export_usd

        export_usd(shapes, p, **kwargs)
    elif ext == ".brep":
        from .occt import export_brep

        export_brep(shapes, p, **kwargs)
    elif ext == ".svg":
        from .drawing import export_svg

        export_svg(shapes, p, **kwargs)
    else:
        raise ValueError(f"unknown file type {ext!r}; use .step, .stl, .glb, .gltf, .obj, .smb, .smp, .dxf, .svg, "
                         ".usda or .brep")


def export_step(shapes: Any, path: str | os.PathLike[str], *, unit: str = "mm", name: str | None = None,
                assembly: bool = False) -> None:
    """Exact B-rep export to STEP AP214. Names and colors of parts are kept.

    The bodies go into one product called ``name`` (default: the file's name), or, with
    ``assembly=True``, each into a product of its own, named as the body, in an assembly
    called ``name``: other CAD systems then list the parts by name. A body listed more than
    once is written once and used at each place.

    Edges and wires are written as wireframe curves, vertices and Vectors as points, Planes as
    coordinate systems (supplemental geometry), each unnamed; :class:`~smlibpy.StepCurve`,
    :class:`~smlibpy.StepPoint` and :class:`~smlibpy.StepFrame` give them names and colors, and
    a :class:`~smlibpy.StepModel` (from :func:`~smlibpy.read_step`) is written whole.
    :func:`~smlibpy.read_step` reads them back.
    """
    from .step import _step_items, write_step

    write_step(_step_items(shapes), os.fspath(path), unit=unit, name=name, assembly=assembly)


def to_step(shapes: Any, *, unit: str = "mm", name: str | None = None, assembly: bool = False) -> str:
    """The text of a STEP AP214 file of the shapes (see :func:`export_step`). Without a file the
    product is called ``"part"`` unless ``name`` says otherwise.

    The text is ASCII (names in other characters are encoded as ISO 10303-21 says); write it with
    ``open(path, "w")`` or send it as it is: ``from_step(to_step(part))`` reads it back.
    """
    from .step import _step_items, _step_text

    return _step_text(_step_items(shapes), "", unit=unit, name=name, assembly=assembly)

def _meshes(shapes: Any, tolerance: float | None, angle: float, what: str = "this writer",
            max_edge: float | None = None) -> list[tuple[Any, Mesh]]:
    out = []
    for it in _items(shapes, faces=True, what=what):  # a face is meshed itself, facing out of its part
        out.append((it, it if isinstance(it, Mesh) else tessellate(it, tolerance, angle, max_edge=max_edge)))
    return out


def _stl(shapes: Any, tolerance: float | None, angle: float, ascii: bool, what: str,
         max_edge: float | None = None) -> bytes:
    meshes = [m for _, m in _meshes(shapes, tolerance, angle, what, max_edge)]
    if not meshes:
        raise ValueError(f"{what}: nothing to write")
    tris = np.concatenate([m.vertices[m.triangles] for m in meshes]).astype(np.float32)
    normals = np.concatenate([m.triangle_normals for m in meshes]).astype(np.float32)
    if ascii:
        lines = ["solid smlibpy\n"]
        for n, t in zip(normals, tris):
            lines.append(f"facet normal {n[0]:e} {n[1]:e} {n[2]:e}\n outer loop\n")
            for v in t:
                lines.append(f"  vertex {v[0]:e} {v[1]:e} {v[2]:e}\n")
            lines.append(" endloop\nendfacet\n")
        lines.append("endsolid smlibpy\n")
        return "".join(lines).encode("ascii")
    rec = np.zeros(len(tris), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"] = normals
    rec["v"] = tris
    return b"smlibpy binary STL".ljust(80, b" ") + struct.pack("<I", len(tris)) + rec.tobytes()


def to_stl(shapes: Any, *, tolerance: float | None = None, angle: float = 15.0, ascii: bool = False,
           max_edge: float | None = None) -> bytes:
    """The bytes of an STL file of the shapes' triangles (binary unless ``ascii``, then the
    file's ASCII text as bytes). ``tolerance`` is the maximum deviation and ``max_edge`` the
    longest edge a triangle may have, as in :func:`export_stl`."""
    return _stl(shapes, tolerance, angle, ascii, "to_stl", max_edge)


def export_stl(shapes: Any, path: str | os.PathLike[str], *, tolerance: float | None = None, angle: float = 15.0,
               ascii: bool = False, max_edge: float | None = None) -> None:
    """Triangle mesh export (binary unless ``ascii``). ``tolerance`` is the maximum deviation,
    ``max_edge`` the longest edge a triangle may have (see :func:`tessellate`)."""
    data = _stl(shapes, tolerance, angle, ascii, "export_stl", max_edge)
    with open(os.fspath(path), "wb") as fh:
        fh.write(data)


def import_stl(path: str | os.PathLike[str]) -> Mesh:
    """Read an STL file (binary or ASCII) as a mesh."""
    p = os.fspath(path)
    with open(p, "rb") as fh:
        data = fh.read()
    return _read_stl(data, p)


def from_stl(data: bytes | str) -> Mesh:
    """A mesh from the contents of an STL file (binary or ASCII): its bytes, or the text of an
    ASCII file."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError(f"from_stl reads the contents of an STL file as bytes or str, not {type(data).__name__}")
    return _read_stl(bytes(data), None)


def _read_stl(data: bytes, path: str | None) -> Mesh:
    if len(data) >= 84:
        n = struct.unpack("<I", data[80:84])[0]
        if 84 + 50 * n == len(data):
            rec = np.frombuffer(data[84:], dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
            v = rec["v"].reshape(-1, 3).astype(np.float64)
            return _weld(v)
    verts = []
    for line in data.decode("ascii", "replace").splitlines():
        parts = line.split()
        if parts and parts[0] == "vertex":
            verts.append([float(x) for x in parts[1:4]])
    if not verts or len(verts) % 3:
        raise ValueError("not an STL file, or a truncated one" + (f": {path}" if path is not None else ""))
    return _weld(np.array(verts, dtype=np.float64))


def _weld(corner_positions: np.ndarray) -> Mesh:
    uniq, inverse = np.unique(np.round(corner_positions, 9), axis=0, return_inverse=True)
    return Mesh(uniq, inverse.reshape(-1, 3))


def _obj(shapes: Any, tolerance: float | None, angle: float, what: str, max_edge: float | None = None) -> str:
    lines = ["# smlibpy"]
    offset = 1
    normal_offset = 1
    for i, (item, m) in enumerate(_meshes(shapes, tolerance, angle, what, max_edge)):
        lines.append(f"o {getattr(item, 'name', None) or f'part_{i + 1}'}")
        # (12 digits: a hundred-thousandth of a millimeter 1 km from the origin)
        lines.extend(f"v {x:.12g} {y:.12g} {z:.12g}" for x, y, z in m.vertices)
        normals, corner = _corner_normals(m)
        lines.extend(f"vn {x:.6g} {y:.6g} {z:.6g}" for x, y, z in normals)
        c = corner.reshape(-1, 3) + normal_offset
        lines.extend(f"f {a + offset}//{na} {b + offset}//{nb} {cc + offset}//{nc}"
                     for (a, b, cc), (na, nb, nc) in zip(m.triangles.tolist(), c.tolist()))
        offset += len(m.vertices)
        normal_offset += len(normals)
    return "\n".join(lines) + "\n"


def to_obj(shapes: Any, *, tolerance: float | None = None, angle: float = 15.0, max_edge: float | None = None) -> str:
    """The text of a Wavefront OBJ file of the shapes (one object per part), as
    :func:`export_obj` writes it."""
    return _obj(shapes, tolerance, angle, "to_obj", max_edge)


def export_obj(shapes: Any, path: str | os.PathLike[str], *, tolerance: float | None = None, angle: float = 15.0,
               max_edge: float | None = None) -> None:
    """Wavefront OBJ export (one object per part), with the mesh's normals: each corner names
    its normal (``f v//vn``), so edges stay sharp where the faces meet at an angle and curved
    faces shade smooth. ``max_edge`` is the longest edge a triangle may have."""
    text = _obj(shapes, tolerance, angle, "export_obj", max_edge)
    with open(os.fspath(path), "w") as fh:
        fh.write(text)


def _corner_normals(m: Mesh) -> tuple[np.ndarray, np.ndarray]:
    """The distinct unit normals of a mesh's corners ((k, 3), float32) and, per triangle corner,
    which of them it has ((m, 3)): the mesh's normals, or each triangle's own."""
    if m.normals is not None:
        n = m.normals.reshape(-1, 3).astype(np.float32)
    else:
        n = np.repeat(m.triangle_normals, 3, axis=0).astype(np.float32)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    # (to 7 decimals: normals the kernel computed a hair apart are one; -0 is 0)
    n = np.round((n / np.where(ln > 0, ln, 1)).astype(np.float32), 7) + np.float32(0.0)
    if not len(n):
        return n.reshape(0, 3), np.zeros((0, 3), dtype=np.int64)
    unique, inverse = np.unique(n, axis=0, return_inverse=True)
    return unique, inverse.reshape(-1, 3)


def _indexed_corners(m: Mesh) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A mesh as glTF takes it: one entry per distinct (point, normal) pair of its corners, the
    points ((k, 3) float64) and normals ((k, 3) float32), and three indices per triangle."""
    normals, corner = _corner_normals(m)
    key = np.stack([m.triangles.reshape(-1), corner.reshape(-1)], axis=1)
    if not len(key):
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.float32), np.zeros(0, dtype=np.int64)
    pairs, inverse = np.unique(key, axis=0, return_inverse=True)
    return m.vertices[pairs[:, 0]], normals[pairs[:, 1]], inverse.reshape(-1)


# -----------------------------------------------------------------------------
# glTF 2.0
# -----------------------------------------------------------------------------
_DEFAULT_COLORS = ["#7c93b5", "#d9925a", "#79ad73", "#c97878", "#9d87c7", "#d4b45a", "#6bb3b3", "#b08e6c"]


def _linear_rgb(color: Any) -> tuple[float, float, float]:
    """A color as glTF's ``baseColorFactor`` takes it: the sRGB values that colors are given in
    (``"#7c93b5"``, ``(124, 147, 181)``) turned linear, so viewers show the color asked for (glTF
    stores linear values and viewers encode them as sRGB for the screen)."""

    def linear(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = to_rgb(color)
    return linear(r), linear(g), linear(b)


def _edge_polylines(item: Any, angle: float = 5.0) -> list[np.ndarray]:
    """Polylines of the body's edges, without the seams of periodic faces (they are not
    edges a designer drew)."""
    from .shapes import _Body

    if not isinstance(item, _Body):
        return []
    with kernel_call("edge tessellation"):
        flat, counts, _ = k.tessellate_boundaries(item._brep, angle_tolerance_deg=angle)
        seams = set(ext.seam_edges(item._brep))
    pts = np.asarray(flat, dtype=np.float64).reshape(-1, 3)
    out, i = [], 0
    for n, c in enumerate(counts):
        if c >= 2 and n not in seams:
            out.append(pts[i:i + c])
        i += c
    return out


def _flatten_all(shapes: Any) -> list[Any]:
    from .shapes import Shape

    if isinstance(shapes, (Shape, Mesh)) and not isinstance(shapes, list):
        return [shapes]
    out: list[Any] = []
    for s in shapes:
        out.extend(_flatten_all(s))
    return out


def _curve_points(item: Any) -> list[np.ndarray]:
    from .shapes import Edge, Wire

    edges = [item] if isinstance(item, Edge) else list(item.edges())
    out = []
    for e in edges:
        n = 1 if e.geom_type == "line" else 96
        out.append(np.array([e.point_at(i / n).to_tuple() for i in range(n + 1)]))
    return out


def _centre(points: np.ndarray) -> np.ndarray:
    """The middle of the box around points ((n, 3); the origin for none)."""
    p = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    return (p.min(axis=0) + p.max(axis=0)) / 2 if len(p) else np.zeros(3)


def _fmt_num(v: float) -> str:
    return f"{v:,.6g}".replace(",", "\u2009")


def gltf_document_mixed(shapes: Any, *, tolerance: float | None = None, angle: float = 15.0, edges: bool = True,
                        edge_color: Any = "#1f2328",
                        max_edge: float | None = None) -> tuple[dict[str, Any], bytes, str]:
    """glTF JSON, binary buffer and a one-line summary for any mix of shapes."""
    from .shapes import Edge, Face, Part, Shell, Sketch, Vertex, Wire, _Body

    buf = bytearray()
    views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    meshes: list[dict[str, Any]] = []
    nodes: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []

    def add_view(arr: np.ndarray, target: int | None) -> int:
        while len(buf) % 4:
            buf.append(0)
        off = len(buf)
        b = arr.tobytes()
        buf.extend(b)
        v: dict[str, Any] = {"buffer": 0, "byteOffset": off, "byteLength": len(b)}
        if target is not None:
            v["target"] = target
        views.append(v)
        return len(views) - 1

    def add_accessor(arr: np.ndarray, kind: str, comp: int, target: int | None, minmax: bool = False) -> int:
        view = add_view(arr, target)
        a: dict[str, Any] = {"bufferView": view, "componentType": comp, "count": int(len(arr)), "type": kind}
        if minmax:
            a["min"] = [float(x) for x in arr.min(axis=0)]
            a["max"] = [float(x) for x in arr.max(axis=0)]
        accessors.append(a)
        return len(accessors) - 1

    def material(color: Any, lines: bool = False) -> int:
        r, g, b = _linear_rgb(color)
        m: dict[str, Any] = {"pbrMetallicRoughness": {"baseColorFactor": [r, g, b, 1.0],
                                                      "metallicFactor": 0.0 if lines else 0.05,
                                                      "roughnessFactor": 1.0 if lines else 0.55}}
        if not lines:
            m["doubleSided"] = True
        materials.append(m)
        return len(materials) - 1

    def line_prim(polylines: list[np.ndarray], mat: int, centre: np.ndarray) -> dict[str, Any]:
        segs = np.concatenate([np.stack([pl[:-1], pl[1:]], axis=1).reshape(-1, 3) for pl in polylines])
        segs = (segs - centre).astype(np.float32)
        return {"attributes": {"POSITION": add_accessor(segs, "VEC3", 5126, 34962, True)}, "material": mat, "mode": 1}

    items = _flatten_all(shapes)
    edge_mat = None
    color_index = 0
    for i, item in enumerate(items):
        name = getattr(item, "name", None) or f"{type(item).__name__.lower()}_{i + 1}"
        prims: list[dict[str, Any]] = []
        # Positions are float32 in glTF (7 digits): each node holds them relative to the middle of
        # its shape and moves them there by its translation (a double), so a part far from the
        # origin keeps its shape.
        centre = np.zeros(3)
        if isinstance(item, (Edge, Wire)):
            points = _curve_points(item)
            centre = _centre(np.concatenate(points))
            prims.append(line_prim(points, material(getattr(item, "color", None) or "#d9480f", True), centre))
        elif isinstance(item, Vertex):
            centre = np.array(item.point.to_tuple(), dtype=np.float64)
            pts = np.zeros((1, 3), dtype=np.float32)
            prims.append({"attributes": {"POSITION": add_accessor(pts, "VEC3", 5126, 34962, True)},
                          "material": material("#d9480f", True), "mode": 0})
        else:
            body = item.to_shell() if isinstance(item, Face) else item
            # a face is meshed itself, facing out of its part; its copy gives the edges
            m, face_colors = (body, None) if isinstance(body, Mesh) else _colored_mesh(item, tolerance, angle, max_edge)
            own = item.color if isinstance(item, Face) else None
            color = own or getattr(body, "color", None) or _DEFAULT_COLORS[color_index % len(_DEFAULT_COLORS)]
            color_index += 1
            centre = _centre(m.vertices)
            # faces of their own color: a primitive per color, the others in the body's (kernel plan T5);
            # each with every distinct (point, normal) pair of its corners once, and its triangles as indices
            for rgb, sel in _color_groups(face_colors, len(m.triangles), to_rgb(color)):
                piece = m if sel.all() else Mesh(m.vertices, m.triangles[sel], None if m.normals is None else m.normals[sel])
                points, nrm, index = _indexed_corners(piece)
                pos = (points - centre).astype(np.float32)
                wide = len(pos) > 65535
                prims.append({"attributes": {"POSITION": add_accessor(pos, "VEC3", 5126, 34962, True),
                                             "NORMAL": add_accessor(nrm, "VEC3", 5126, 34962)},
                              "indices": add_accessor(index.astype(np.uint32 if wide else np.uint16), "SCALAR",
                                                      5125 if wide else 5123, 34963),
                              "material": material(rgb), "mode": 4})
            if edges and isinstance(body, _Body):
                lines = _edge_polylines(body)
                if lines:
                    if edge_mat is None:
                        edge_mat = material(edge_color, True)
                    prims.append(line_prim(lines, edge_mat, centre))
        meshes.append({"name": name, "primitives": prims})
        node: dict[str, Any] = {"mesh": len(meshes) - 1, "name": name}
        if centre.any():
            node["translation"] = [float(x) for x in centre]
        nodes.append(node)

    doc = {
        "asset": {"version": "2.0", "generator": "smlibpy"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(buf)}],
    }
    return doc, bytes(buf), _summary(items)


def _color_groups(colors: np.ndarray | None, count: int, default: Any) -> list[tuple[Any, np.ndarray]]:
    """The triangles of a mesh by color: (color, mask of the triangles) for each color in ``colors``
    (per triangle, NaN for the ``default``; None: all ``default``), in the order they first come."""
    if colors is None:
        return [(default, np.ones(count, dtype=bool))]
    plain = np.isnan(colors).any(axis=1)
    keys = np.round(np.where(plain[:, None], -1.0, colors), 6)
    _, first, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    out = []
    for group in np.argsort(first):
        sel = inverse == group
        t = int(first[group])
        out.append((default if plain[t] else tuple(float(x) for x in colors[t]), sel))
    return out


def _summary(items: list[Any]) -> str:
    from .shapes import Part, Sketch, Shell, _Body, BoundBox

    if len(items) != 1:
        return f"<b>{len(items)} shapes</b>"
    it = items[0]
    parts = [f"<b>{type(it).__name__}</b>"]
    try:
        if isinstance(it, _Body):
            parts.append(f"{it._brep.face_count()} faces")
        if isinstance(it, Part):
            parts.append(f"volume {_fmt_num(it._props()['volume'])}")  # no measure warnings here
        elif isinstance(it, (Sketch, Shell)):
            parts.append(f"area {_fmt_num(it.area)}")
        b = it.bbox()
        s = b.size
        parts.append(" \u00d7 ".join(_fmt_num(v) for v in (s.x, s.y, s.z)))
    except Exception:
        pass
    return " \u00b7 ".join(parts)


def gltf_document(shapes: Any, **kwargs: Any) -> tuple[dict[str, Any], bytes]:
    """glTF JSON and binary buffer for the shapes."""
    doc, buf, _ = gltf_document_mixed(shapes, **kwargs)
    return doc, buf


def to_glb(shapes: Any, *, tolerance: float | None = None, angle: float = 15.0, edges: bool = True,
           edge_color: Any = "#1f2328", max_edge: float | None = None) -> bytes:
    """The bytes of a binary glTF (GLB) file of the shapes, with colors, names and (optionally)
    the B-rep edges as lines, as :func:`export_glb` writes it (Z-up in millimeters under a root
    node that turns it upright and scales it to meters)."""
    doc, buf = gltf_document(shapes, tolerance=tolerance, angle=angle, edges=edges, edge_color=edge_color,
                             max_edge=max_edge)
    _z_up(doc, meters=True)
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    bin_ = buf + b"\0" * (-len(buf) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
            + struct.pack("<I4s", len(bin_), b"BIN\0") + bin_)


def export_glb(shapes: Any, path: str | os.PathLike[str], *, tolerance: float | None = None, angle: float = 15.0,
               edges: bool = True, edge_color: Any = "#1f2328", max_edge: float | None = None) -> None:
    """Binary glTF export with colors, names and (optionally) the B-rep edges as lines.

    glTF is Y-up and measured in meters; the model is written Z-up in millimeters as
    modeled, under a root node that turns it upright and scales it by 0.001, so viewers
    show it at its real size. Triangles are indexed: each distinct corner (a point with its
    normal) is written once. ``max_edge`` is the longest edge a triangle may have.
    """
    data = to_glb(shapes, tolerance=tolerance, angle=angle, edges=edges, edge_color=edge_color, max_edge=max_edge)
    with open(os.fspath(path), "wb") as fh:
        fh.write(data)


def to_gltf(shapes: Any, *, tolerance: float | None = None, angle: float = 15.0, edges: bool = True,
            edge_color: Any = "#1f2328", max_edge: float | None = None) -> str:
    """The JSON text of a glTF file of the shapes with the buffer embedded as a data URI (in
    meters, like :func:`to_glb`); the keywords of :func:`to_glb`."""
    doc, buf = gltf_document(shapes, tolerance=tolerance, angle=angle, edges=edges, edge_color=edge_color,
                             max_edge=max_edge)
    _z_up(doc, meters=True)
    doc["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(buf).decode()
    return json.dumps(doc)


def export_gltf(shapes: Any, path: str | os.PathLike[str], *, tolerance: float | None = None, angle: float = 15.0,
                edges: bool = True, edge_color: Any = "#1f2328", max_edge: float | None = None) -> None:
    """glTF export with the buffer embedded as a data URI (in meters, like :func:`export_glb`); the
    keywords of :func:`export_glb`."""
    text = to_gltf(shapes, tolerance=tolerance, angle=angle, edges=edges, edge_color=edge_color, max_edge=max_edge)
    with open(os.fspath(path), "w") as fh:
        fh.write(text)


def _z_up(doc: dict[str, Any], meters: bool = False) -> None:
    n = len(doc["nodes"])
    # rotate -90 degrees about X: Z-up model -> Y-up glTF; glTF units are meters
    root: dict[str, Any] = {"name": "z-up", "rotation": [-0.7071067811865476, 0.0, 0.0, 0.7071067811865476],
                            "children": list(range(n))}
    if meters:
        root["name"] = "z-up, mm"
        root["scale"] = [0.001, 0.001, 0.001]
    doc["nodes"].append(root)
    doc["scenes"][0]["nodes"] = [n]


# -----------------------------------------------------------------------------
# Native SMLib files
# -----------------------------------------------------------------------------
def save(shapes: Any, path: str | os.PathLike[str], *, ascii: bool = True) -> None:
    """Write shapes to SMLib's native files (exact): one body to an ``.smb`` file, or bodies and
    curves with their names and colors to an ``.smp`` part file.

    ``.smb`` holds one body without name or color. ``.smp`` (any other extension writes ``.smb``)
    is the kernel's part container: any number of parts, sheets, sketches and faces, each with its
    name and color, and edges and wires as curves (see :func:`to_smp`). Reading either back gives
    the same geometry; B-spline faces that are exactly planes, cylinders, cones, spheres or surfaces
    of revolution come back as those (``to_nurbs()`` does not survive). ``ascii=False`` writes the
    binary form (bit-exact, about 40 % of the size).
    """
    p = os.fspath(path)
    if os.path.splitext(p)[1].lower() == ".smp":
        data = _smp(shapes, ascii, "save")
        with open(p, "wb") as fh:
            fh.write(data)
        return
    body = _one_body(shapes, "save")
    with kernel_call("save"):
        body._brep.write_to_file(p, ascii)


def _one_body(shapes: Any, what: str) -> Any:
    from .shapes import _Body

    items = _items(shapes, what=what)
    if len(items) != 1:
        raise ValueError("an .smb file holds one body; fuse the parts, save them separately, or save them to an "
                         ".smp file (which holds several, with their names and colors)")
    if not isinstance(items[0], _Body):
        raise TypeError(f"an .smb file holds an exact body, not a {type(items[0]).__name__}")
    return items[0]


def to_smb(shapes: Any, *, ascii: bool = True) -> bytes:
    """The contents of an SMLib native ``.smb`` file of one body (exact; ASCII unless ``ascii`` is
    False), as :func:`save` writes it."""
    body = _one_body(shapes, "to_smb")
    fd, name = tempfile.mkstemp(suffix=".smb")
    os.close(fd)
    try:
        with kernel_call("save"):
            body._brep.write_to_file(name, ascii)
        with open(name, "rb") as fh:
            return fh.read()
    finally:
        os.unlink(name)


def from_smb(data: bytes) -> Any:
    """The body of an SMLib native ``.smb`` file's contents: a :class:`Part` when it encloses a
    volume (a merged part with its cells too, and a broken solid, whose ``is_valid()`` is False), a
    :class:`Shell` when it does not."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError(f"from_smb reads the contents of an .smb file as bytes, not {type(data).__name__}")
    fd, name = tempfile.mkstemp(suffix=".smb")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(bytes(data))
        with kernel_call("load"):
            b = k.read_brep_from_file(name, None, False)
    finally:
        os.unlink(name)
    return _body(b, None, None, "from_smb")


def _smp(shapes: Any, ascii: bool, what: str) -> bytes:
    """The bytes of a part file of the bodies and curves of ``shapes``."""
    from .geometry import Vector
    from .shapes import Edge, Face, Shape, Vertex, Wire, _Body

    items: list[tuple[Any, ...]] = []
    keep: list[Any] = []  # (the bodies and curve copies stay alive while the C++ reads them)
    wires = 0

    def add(s: Any) -> None:
        nonlocal wires
        if isinstance(s, Face):
            s = s.to_shell()
        if isinstance(s, _Body):
            keep.append(s)
            items.append((s._brep, None, s.name or None, _rgb(s.color), -1))
        elif isinstance(s, Edge):
            c = CurveHandle(s._copy_curve())
            keep.append(c)
            items.append((None, c.curve, None, None, -1))
        elif isinstance(s, Wire):
            for curve in s._copy_curves():
                c = CurveHandle(curve)
                keep.append(c)
                items.append((None, c.curve, None, None, wires))
            wires += 1
        elif isinstance(s, Mesh):
            raise TypeError(f"{what}: an .smp file holds exact bodies and curves, not a Mesh: write meshes with "
                            "export_stl, export_obj or export_glb")
        elif isinstance(s, (Shape, str, bytes)) or not hasattr(s, "__iter__") or _is_value(s):
            name = type(s).__name__
            raise TypeError(f"{what}: an .smp file holds parts, sheets, faces, edges and wires, not "
                            f"{'an' if name[:1].upper() in 'AEIOU' else 'a'} {name}" +
                            (": export_step writes points" if isinstance(s, (Vertex, Vector)) else ""))
        else:
            for x in s:
                add(x)

    add(shapes)
    if not items:
        raise ValueError(f"{what}: nothing to write")
    with kernel_call(what):
        data = ext.part_bytes(items, ascii)
    del keep
    return data


def to_smp(shapes: Any, *, ascii: bool = True) -> bytes:
    """The contents of an SMLib part file (``.smp``) of the shapes, as :func:`save` writes it.

    A part file is the kernel's own container: any number of exact bodies (parts with their cells,
    sheets, sketches and faces as sheets), each with its name and color, and curves (an edge as one,
    a wire as its edges). :func:`from_smp` and :func:`load` give them back in the same order, with
    their names and colors, a wire as a :class:`Wire`. ASCII unless ``ascii`` is False; the binary
    form is bit-exact, the ASCII form keeps the geometry to 16 decimals.
    """
    return _smp(shapes, ascii, "to_smp")


def from_smp(data: bytes) -> Any:
    """The bodies and curves of an SMLib part file's contents (``.smp``, ASCII or binary): a single
    shape when it holds one, otherwise a :class:`ShapeList`. Bodies come back as :class:`Part`
    (one that encloses a volume) or :class:`Shell`, named and colored as written, curves as
    :class:`Edge` and :class:`Wire`; a file of another SMLib program gives its loose surfaces as
    sheets of one face each.
    """
    from .shapes import Edge, ShapeList, Wire

    if isinstance(data, str):
        data = data.encode("utf-8")
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError(f"from_smp reads the contents of an .smp file as bytes, not {type(data).__name__}")
    with kernel_call("from_smp"):
        found = ext.part_items(bytes(data))
    out: list[Any] = []
    wires: dict[int, list[Any]] = {}
    for brep, curve, name, color, wire in found:
        if brep is not None:
            out.append(_body(brep, name or None, tuple(color) if color else None, "from_smp"))
        elif wire >= 0 and wire in wires:
            wires[wire].append(Edge._from_curve(curve))
        elif wire >= 0:
            wires[wire] = [Edge._from_curve(curve)]
            out.append(wires[wire])
        else:
            out.append(Edge._from_curve(curve))
    if not out:
        raise ValueError("the .smp file holds no bodies or curves")
    shapes = ShapeList(Wire._raw(x) if isinstance(x, list) else x for x in out)
    return shapes[0] if len(shapes) == 1 else shapes


def load(path: str | os.PathLike[str]) -> Any:
    """Read a file, picking the format from the extension: STEP (``.step``, ``.stp``), IGES
    (``.igs``, ``.iges``), USD (``.usda``), OpenCASCADE (``.brep``) and SMLib (``.smb``,
    ``.smp``) give exact parts, DXF (``.dxf``) a :class:`Sketch` of the drawing's outlines, STL a
    :class:`Mesh`.

    A STEP or IGES file with one body gives that part, one with several a :class:`ShapeList`. A
    native file comes back as a :class:`Part` when its body encloses a volume (a merged part with
    its cells too, and a broken solid, whose ``is_valid()`` is False), as a :class:`Shell` when it
    does not; a part file (``.smp``) with its names, colors and curves (see :func:`from_smp`). A
    body that also holds wire edges, points or faces outside its solid comes with a warning.
    """
    ext_ = os.path.splitext(os.fspath(path))[1].lower()
    if ext_ in (".step", ".stp", ".p21"):
        from .step_import import import_step

        return import_step(path)
    if ext_ in (".igs", ".iges"):
        from .iges_import import import_iges

        return import_iges(path)
    if ext_ == ".stl":
        return import_stl(path)
    if ext_ == ".dxf":
        from .dxf import import_dxf

        return import_dxf(path)
    if ext_ in (".usda", ".usd", ".usdc", ".usdz"):
        from .usd import import_usd

        return import_usd(path)
    if ext_ == ".brep":
        from .occt import import_brep

        return import_brep(path)
    if ext_ not in (".smb", ".smp"):
        raise ValueError(f"unknown file type {ext_!r}; load reads .step, .stp, .igs, .iges, .stl, .smb, .smp, .dxf, "
                         ".usda and .brep")
    if not os.path.exists(os.fspath(path)):
        raise FileNotFoundError(os.fspath(path))
    if ext_ == ".smp":
        with open(os.fspath(path), "rb") as fh:
            return from_smp(fh.read())
    with kernel_call("load"):
        b = k.read_brep_from_file(os.fspath(path), None, False)
    return _body(b, None, None, "load")


def to_file(shapes: Any, name: str | os.PathLike[str], **kwargs: Any) -> str | bytes:
    """The contents of a file of the shapes, in memory, the format picked from the extension of
    ``name`` as :func:`export` picks it from a path (only the extension counts; nothing is
    written): text for STEP, OBJ, glTF, DXF, SVG, USD (``.usda``) and OpenCASCADE (``.brep``),
    ``bytes`` for STL, GLB, ``.smb`` and ``.smp``. The keywords are those of the format's ``to_...``
    function. ::

        data = to_file(part, requested_name)   # a web service's download in the format asked for
    """
    ext = os.path.splitext(os.fspath(name))[1].lower()
    if ext in (".step", ".stp"):
        return to_step(shapes, **kwargs)
    if ext == ".stl":
        return to_stl(shapes, **kwargs)
    if ext == ".glb":
        return to_glb(shapes, **kwargs)
    if ext == ".gltf":
        return to_gltf(shapes, **kwargs)
    if ext == ".obj":
        return to_obj(shapes, **kwargs)
    if ext == ".smb":
        return to_smb(shapes, **kwargs)
    if ext == ".smp":
        return to_smp(shapes, **kwargs)
    if ext == ".dxf":
        from .dxf import to_dxf

        return to_dxf(shapes, **kwargs)
    if ext == ".svg":
        from .drawing import to_svg

        return to_svg(shapes, **kwargs)
    if ext in (".usda", ".usd"):
        from .usd import to_usd

        return to_usd(shapes, **kwargs)
    if ext in (".usdc", ".usdz"):
        raise ValueError(f"to_file writes text USD (.usda, .usd), not {ext}")
    if ext == ".brep":
        from .occt import to_brep

        return to_brep(shapes, **kwargs)
    raise ValueError(f"unknown file type {ext!r}; use .step, .stl, .glb, .gltf, .obj, .smb, .smp, .dxf, .svg, .usda or "
                     ".brep")


def from_file(data: str | bytes, name: str | os.PathLike[str]) -> Any:
    """The shapes of a file's contents, in memory (its text or bytes), the format picked from the
    extension of ``name`` as :func:`load` picks it from a path (only the extension counts): STEP,
    IGES, USD (``.usda``), OpenCASCADE (``.brep``) and SMLib (``.smb``, ``.smp``) give exact parts,
    DXF a :class:`Sketch` of the drawing's outlines, STL a :class:`Mesh`. The layers a USD text
    names are not read (:func:`from_usd` reads them with ``resolve``). ::

        part = from_file(upload.read(), upload.filename)
    """
    ext = os.path.splitext(os.fspath(name))[1].lower()
    if ext in (".step", ".stp", ".p21"):
        from .step_import import from_step

        return from_step(data)
    if ext in (".igs", ".iges"):
        from .iges_import import from_iges

        return from_iges(data)
    if ext == ".stl":
        return from_stl(data)
    if ext == ".dxf":
        from .dxf import from_dxf

        return from_dxf(data)
    if ext in (".usda", ".usd", ".usdc", ".usdz"):
        from .usd import from_usd

        return from_usd(data)
    if ext == ".brep":
        from .occt import from_brep

        return from_brep(data)
    if ext == ".smp":
        return from_smp(data if isinstance(data, bytes) else str(data).encode())
    if ext == ".smb":
        return from_smb(data if isinstance(data, bytes) else str(data).encode())
    raise ValueError(f"unknown file type {ext!r}; from_file reads .step, .stp, .igs, .iges, .stl, .smb, .smp, .dxf, "
                     ".usda and .brep")
