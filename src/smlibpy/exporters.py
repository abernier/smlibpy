"""Reading and writing files.

========  ===================================================  ==========
Format    Extension                                            Direction
========  ===================================================  ==========
STEP      ``.step``, ``.stp``                                  read/write
IGES      ``.igs``, ``.iges`` (solids and trimmed surfaces)    read
SMLib     ``.smb`` (exact native kernel format)                read/write
DXF       ``.dxf`` (2D drawings: sketches, sections, curves)   read/write
glTF      ``.glb``, ``.gltf``                                  write
STL       ``.stl``                                             read/write
OBJ       ``.obj``                                             write
USD       ``.usda``, ``.usd`` (exact: BrepArray prims, as text)  read/write
========  ===================================================  ==========
"""

from __future__ import annotations

import base64
import json
import os
import struct
from typing import Any, Iterable, Sequence

import numpy as np

from ._kernel import ext, k, kernel_call
from .colors import to_rgb
from .mesh import Mesh, tessellate

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
]


def _items(shapes: Any, faces: bool = False) -> list[Any]:
    from .shapes import Face, ShapeList, _Body

    if isinstance(shapes, (_Body, Mesh)):
        return [shapes]
    if isinstance(shapes, Face):
        return [shapes if faces else shapes.to_shell()]
    out: list[Any] = []
    for s in shapes:
        out.extend(_items(s, faces))
    return out


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
    elif ext in (".usda", ".usd", ".usdc", ".usdz"):
        from .usd import export_usd

        export_usd(shapes, p, **kwargs)
    else:
        raise ValueError(f"unknown file type {ext!r}; use .step, .stl, .glb, .gltf, .obj, .smb, .dxf or .usda")


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


def _meshes(shapes: Any, tolerance: float | None, angle: float) -> list[tuple[Any, Mesh]]:
    out = []
    for it in _items(shapes, faces=True):  # a face is meshed itself, facing out of its part
        out.append((it, it if isinstance(it, Mesh) else tessellate(it, tolerance, angle)))
    return out


def export_stl(shapes: Any, path: str | os.PathLike[str], *, tolerance: float | None = None, angle: float = 15.0,
               ascii: bool = False) -> None:
    """Triangle mesh export (binary unless ``ascii``). ``tolerance`` is the maximum deviation."""
    meshes = [m for _, m in _meshes(shapes, tolerance, angle)]
    tris = np.concatenate([m.vertices[m.triangles] for m in meshes]).astype(np.float32)
    normals = np.concatenate([m.triangle_normals for m in meshes]).astype(np.float32)
    p = os.fspath(path)
    if ascii:
        with open(p, "w") as fh:
            fh.write("solid smlibpy\n")
            for n, t in zip(normals, tris):
                fh.write(f"facet normal {n[0]:e} {n[1]:e} {n[2]:e}\n outer loop\n")
                for v in t:
                    fh.write(f"  vertex {v[0]:e} {v[1]:e} {v[2]:e}\n")
                fh.write(" endloop\nendfacet\n")
            fh.write("endsolid smlibpy\n")
        return
    rec = np.zeros(len(tris), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"] = normals
    rec["v"] = tris
    with open(p, "wb") as fh:
        fh.write(b"smlibpy binary STL".ljust(80, b" "))
        fh.write(struct.pack("<I", len(tris)))
        fh.write(rec.tobytes())


def import_stl(path: str | os.PathLike[str]) -> Mesh:
    """Read an STL file (binary or ASCII) as a mesh."""
    p = os.fspath(path)
    with open(p, "rb") as fh:
        data = fh.read()
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
        raise ValueError(f"not an STL file, or a truncated one: {p}")
    return _weld(np.array(verts, dtype=np.float64))


def _weld(corner_positions: np.ndarray) -> Mesh:
    uniq, inverse = np.unique(np.round(corner_positions, 9), axis=0, return_inverse=True)
    return Mesh(uniq, inverse.reshape(-1, 3))


def export_obj(shapes: Any, path: str | os.PathLike[str], *, tolerance: float | None = None, angle: float = 15.0) -> None:
    """Wavefront OBJ export (one object per part)."""
    lines = ["# smlibpy"]
    offset = 1
    for i, (item, m) in enumerate(_meshes(shapes, tolerance, angle)):
        lines.append(f"o {getattr(item, 'name', None) or f'part_{i + 1}'}")
        lines.extend(f"v {x:.9g} {y:.9g} {z:.9g}" for x, y, z in m.vertices)
        lines.extend(f"f {a + offset} {b + offset} {c + offset}" for a, b, c in m.triangles)
        offset += len(m.vertices)
    with open(os.fspath(path), "w") as fh:
        fh.write("\n".join(lines) + "\n")


# -----------------------------------------------------------------------------
# glTF 2.0
# -----------------------------------------------------------------------------
_DEFAULT_COLORS = ["#7c93b5", "#d9925a", "#79ad73", "#c97878", "#9d87c7", "#d4b45a", "#6bb3b3", "#b08e6c"]


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


def _fmt_num(v: float) -> str:
    return f"{v:,.6g}".replace(",", "\u2009")


def gltf_document_mixed(shapes: Any, *, tolerance: float | None = None, angle: float = 15.0, edges: bool = True,
                        edge_color: Any = "#1f2328") -> tuple[dict[str, Any], bytes, str]:
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
        r, g, b = to_rgb(color)
        m: dict[str, Any] = {"pbrMetallicRoughness": {"baseColorFactor": [r, g, b, 1.0],
                                                      "metallicFactor": 0.0 if lines else 0.05,
                                                      "roughnessFactor": 1.0 if lines else 0.55}}
        if not lines:
            m["doubleSided"] = True
        materials.append(m)
        return len(materials) - 1

    def line_prim(polylines: list[np.ndarray], mat: int) -> dict[str, Any]:
        segs = np.concatenate([np.stack([pl[:-1], pl[1:]], axis=1).reshape(-1, 3) for pl in polylines]).astype(np.float32)
        return {"attributes": {"POSITION": add_accessor(segs, "VEC3", 5126, 34962, True)}, "material": mat, "mode": 1}

    items = _flatten_all(shapes)
    edge_mat = None
    color_index = 0
    for i, item in enumerate(items):
        name = getattr(item, "name", None) or f"{type(item).__name__.lower()}_{i + 1}"
        prims: list[dict[str, Any]] = []
        if isinstance(item, (Edge, Wire)):
            prims.append(line_prim(_curve_points(item), material(getattr(item, "color", None) or "#d9480f", True)))
        elif isinstance(item, Vertex):
            pts = np.array([item.point.to_tuple()], dtype=np.float32)
            prims.append({"attributes": {"POSITION": add_accessor(pts, "VEC3", 5126, 34962, True)},
                          "material": material("#d9480f", True), "mode": 0})
        else:
            body = item.to_shell() if isinstance(item, Face) else item
            # a face is meshed itself, facing out of its part; its copy gives the edges
            m = body if isinstance(body, Mesh) else tessellate(item, tolerance, angle)
            color = getattr(body, "color", None) or _DEFAULT_COLORS[color_index % len(_DEFAULT_COLORS)]
            color_index += 1
            pos = m.vertices[m.triangles].reshape(-1, 3).astype(np.float32)
            if m.normals is not None:
                nrm = m.normals.reshape(-1, 3).astype(np.float32)
            else:
                nrm = np.repeat(m.triangle_normals, 3, axis=0).astype(np.float32)
            ln = np.linalg.norm(nrm, axis=1, keepdims=True)
            nrm = nrm / np.where(ln > 0, ln, 1)
            prims.append({"attributes": {"POSITION": add_accessor(pos, "VEC3", 5126, 34962, True),
                                         "NORMAL": add_accessor(nrm, "VEC3", 5126, 34962)},
                          "material": material(color), "mode": 4})
            if edges and isinstance(body, _Body):
                lines = _edge_polylines(body)
                if lines:
                    if edge_mat is None:
                        edge_mat = material(edge_color, True)
                    prims.append(line_prim(lines, edge_mat))
        meshes.append({"name": name, "primitives": prims})
        nodes.append({"mesh": len(meshes) - 1, "name": name})

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


def export_glb(shapes: Any, path: str | os.PathLike[str], *, tolerance: float | None = None, angle: float = 15.0,
               edges: bool = True, edge_color: Any = "#1f2328") -> None:
    """Binary glTF export with colors, names and (optionally) the B-rep edges as lines.

    glTF is Y-up and measured in meters; the model is written Z-up in millimeters as
    modeled, under a root node that turns it upright and scales it by 0.001, so viewers
    show it at its real size.
    """
    doc, buf = gltf_document(shapes, tolerance=tolerance, angle=angle, edges=edges, edge_color=edge_color)
    _z_up(doc, meters=True)
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    bin_ = buf + b"\0" * (-len(buf) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(os.fspath(path), "wb") as fh:
        fh.write(struct.pack("<4sII", b"glTF", 2, total))
        fh.write(struct.pack("<I4s", len(js), b"JSON") + js)
        fh.write(struct.pack("<I4s", len(bin_), b"BIN\0") + bin_)


def export_gltf(shapes: Any, path: str | os.PathLike[str], **kwargs: Any) -> None:
    """glTF export with the buffer embedded as a data URI (in meters, like :func:`export_glb`)."""
    doc, buf = gltf_document(shapes, **kwargs)
    _z_up(doc, meters=True)
    doc["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(buf).decode()
    with open(os.fspath(path), "w") as fh:
        json.dump(doc, fh)


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
    """Write a body to SMLib's native ``.smb`` format (exact).

    Reading it back gives the same geometry; B-spline faces that are exactly planes, cylinders,
    cones, spheres or surfaces of revolution come back as those (``to_nurbs()`` does not survive).
    """
    items = _items(shapes)
    if len(items) != 1:
        raise ValueError("an .smb file holds one body; fuse the parts or save them separately")
    with kernel_call("save"):
        items[0]._brep.write_to_file(os.fspath(path), ascii)


def load(path: str | os.PathLike[str]) -> Any:
    """Read a file, picking the format from the extension: STEP (``.step``, ``.stp``), IGES
    (``.igs``, ``.iges``), USD (``.usda``) and SMLib (``.smb``) give exact parts, DXF (``.dxf``) a
    :class:`Sketch` of the drawing's outlines, STL a :class:`Mesh`.

    A STEP or IGES file with one body gives that part, one with several a :class:`ShapeList`. A
    native file comes back as a :class:`Part` when its body encloses a volume (a merged part with
    its cells too, and a broken solid, whose ``is_valid()`` is False), as a :class:`Shell` when it
    does not.
    """
    from .shapes import Part, Shell

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
    if ext_ != ".smb":
        raise ValueError(f"unknown file type {ext_!r}; load reads .step, .stp, .igs, .iges, .stl, .smb, .dxf and .usda")
    if not os.path.exists(os.fspath(path)):
        raise FileNotFoundError(os.fspath(path))
    with kernel_call("load"):
        b = k.read_brep_from_file(os.fspath(path), None, False)
    # a part when it encloses a volume (one cell or more, see Part.merge), else a sheet
    regions = ext.brep_dump(b, False)["regions"]
    solid = any(not r["infinite"] and not r["void"] for r in regions)
    return (Part if solid else Shell)._wrap(b)