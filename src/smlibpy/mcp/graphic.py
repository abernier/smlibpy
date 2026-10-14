"""The shapes of an MCP session as Buerligons draws them: ClassCAD's model tree and its graphic
containers (one per body: a mesh per face, a polyline per edge), as a ClassCAD server sends them.

Element ids say where an element comes from, so that what the user picks in Buerligons leads
back to the session: the k-th shown body has the ids from ``(k + 1) * STRIDE``; its face j is
that base + j (``part.faces()[j]``), its edge n the base + EDGES + n (``part.edges()[n]``, seams
left out as ``edges()`` leaves them out) and its vertex v the base + POINTS + v.
"""

from __future__ import annotations

from typing import Any

import numpy as np

STRIDE = 10_000_000
EDGES = 5_000_000
POINTS = 8_000_000
ALL, PART = 1, 2
SOLID0 = 1_000  # the tree object of body k
CONTAINER0 = 500_000  # its graphic container


def scene(items: list[tuple[str, str | None, Any, Any]], name: str = "smlibpy") -> dict[str, Any]:
    """``items``: (label, expression, shape, color) of what is shown. Returns the ``structure``,
    the ``graphic`` and the ``index`` of the containers (container id -> label, expression, base)."""
    tree: dict[str, Any] = {
        str(ALL): {"id": ALL, "class": "AllObjects", "name": "AllObjects", "parent": None, "flags": 0,
                   "children": [PART]},
        str(PART): {"id": PART, "class": "CC_Part", "name": name, "parent": ALL, "flags": 0, "children": [],
                    "solids": []},
    }
    containers: list[dict[str, Any]] = []
    index: dict[int, dict[str, Any]] = {}
    for k, (label, expr, shape, color) in enumerate(items):
        solid, cid, base = SOLID0 + k, CONTAINER0 + k, (k + 1) * STRIDE
        try:
            c = container(shape, color, cid, solid, base)
        except Exception:  # a shape that cannot be drawn leaves the others alone
            continue
        if not c["meshes"] and not c["edges"]:
            continue
        tree[str(solid)] = {"id": solid, "class": "CC_Solid", "name": label, "parent": PART, "flags": 0,
                            "geometryIdList": [cid]}
        tree[str(PART)]["children"].append(solid)
        tree[str(PART)]["solids"].append(cid)
        containers.append(c)
        index[cid] = {"label": label, "expr": expr, "base": base, "solid": solid}
    structure = {"tree": tree, "root": PART, "currentProduct": PART, "currentInstance": PART}
    return {"structure": structure, "graphic": {"containers": containers, "properties": {"version": 11}},
            "index": index}


def container(shape: Any, color: Any, cid: int, owner: int, base: int) -> dict[str, Any]:
    """One body (part, shell, sketch, face), curve (edge, wire) or mesh as a graphic container."""
    from smlibpy import Edge, Face, Mesh, Wire

    meshes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    tol = None
    if isinstance(shape, Face):
        shape = shape.to_shell()
    if isinstance(shape, Mesh):
        meshes.append(_mesh(base, shape, [], {"type": "nurbsSurface"}))
    elif isinstance(shape, (Edge, Wire)):
        from smlibpy.exporters import _curve_points

        verts, curves = list(shape.vertices()), list(shape.edges())
        vidx = {v._identity(): i for i, v in enumerate(verts)}
        for n, (e, pts) in enumerate(zip(curves, _curve_points(shape))):
            edges.append(_edge(base + EDGES + n, pts, _ends(e, vidx, base)))
    else:
        tol = max(shape.bbox().diagonal, 1e-6) * 1e-3
        meshes, edges = _body(shape, tol, base)
    points = [np.asarray(m["vertices"]).reshape(-1, 3) for m in meshes] + \
             [np.asarray(e["points"]).reshape(-1, 3) for e in edges]
    points = [p for p in points if len(p)]
    lo = np.min([p.min(axis=0) for p in points], axis=0) if points else np.zeros(3)
    hi = np.max([p.max(axis=0) for p in points], axis=0) if points else np.zeros(3)
    material: dict[str, Any] = {"opacity": 1}
    if color is not None:
        from smlibpy.colors import to_rgb

        material["color"] = [round(c * 255) for c in to_rgb(color)]
    props = {"min": [float(v) for v in lo], "max": [float(v) for v in hi], "layer": "0", "material": material}
    if tol is not None:
        props.update(chordHeightTol=tol, angleTol=12.0)
    return {"id": cid, "owner": owner, "type": 1, "properties": props, "meshes": meshes, "edges": edges,
            "lines": [], "arcs": [], "vertices": []}


def _body(shape: Any, tol: float, base: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    from smlibpy._kernel import ext, k
    from smlibpy.mesh import face_meshes, tessellate

    # (identities hold while their wrappers live: the lists stay referenced to the end)
    faces = list(shape.faces())
    every = list(shape.edges(seams=True))  # the kernel's order, which tessellate_boundaries follows
    seams = set(ext.seam_edges(shape._brep))
    named = list(shape.edges())  # the numbering of part.edges()
    shown = {e._identity(): n for n, e in enumerate(named)}
    verts = list(shape.vertices())
    vidx = {v._identity(): i for i, v in enumerate(verts)}
    flat, counts, _ = k.tessellate_boundaries(shape._brep, angle_tolerance_deg=5.0)
    pts = np.asarray(flat, dtype=np.float64).reshape(-1, 3)
    edges, at = [], 0
    for n, (e, c) in enumerate(zip(every, counts)):
        line = pts[at:at + c]
        at += c
        if n in seams or c < 2 or e._identity() not in shown:
            continue
        edges.append(_edge(base + EDGES + shown[e._identity()], line, _ends(e, vidx, base)))
    try:  # the body meshed in one piece and cut by face: faces the kernel cannot mesh alone show too
        cut = face_meshes(shape, tol, 12.0)
    except Exception:
        cut = None
    meshes = []
    for j, f in enumerate(faces):
        try:
            m = cut[j] if cut is not None else tessellate(f, tol, 12.0)
        except Exception:  # one face the kernel cannot mesh: the others still show
            continue
        if not len(m.triangles):
            continue
        loops = [[base + EDGES + shown[e._identity()] for e in w.edges() if e._identity() in shown]
                 for w in f.wires()]
        meshes.append(_mesh(base + j, m, [loop for loop in loops if loop], _surface(f, np.asarray(m.vertices))))
    del named, verts  # (kept alive until here)
    return meshes, edges


def _mesh(gid: int, m: Any, loops: list[list[int]], surface: dict[str, Any]) -> dict[str, Any]:
    v = np.asarray(m.vertices, dtype=float)
    tri = np.asarray(m.triangles).ravel()
    if m.normals is not None and len(tri):
        n = np.zeros_like(v)
        n[tri] = np.asarray(m.normals, dtype=float).reshape(-1, 3)
    else:
        n = _vertex_normals(v, tri)
    return {"id": gid, "vertices": _flat(v), "normals": _flat(n, 4), "indices": [int(i) for i in tri],
            "loops": loops, "properties": {"surface": surface}}


def _edge(gid: int, points: Any, ends: list[int]) -> dict[str, Any]:
    return {"id": gid, "points": _flat(points), "pointIds": ends, "properties": {}}


def _ends(e: Any, vidx: dict[Any, int], base: int) -> list[int]:
    vs = list(e.vertices())
    ids = [base + POINTS + vidx.get(v._identity(), 0) for v in vs] or [base + POINTS]
    return [ids[0], ids[-1]]


def _surface(f: Any, vertices: np.ndarray) -> dict[str, Any]:
    """The face's surface as Buerligons measures it: planes, cylinders and spheres with their
    parameters, every other surface as a free-form one."""
    try:
        kind = f.geom_type
        if kind == "plane":
            return {"type": "plane", "pointOnPlane": list(f.center().to_tuple()), "normal": list(f.normal_at().to_tuple())}
        if kind == "cylinder" and len(vertices):
            o, d = np.array(f.axis.origin.to_tuple()), np.array(f.axis.direction.to_tuple())
            s = (vertices - o) @ d
            return {"type": "cylinder", "origin": [float(c) for c in o + d * s.min()], "axis": [float(c) for c in d],
                    "radius": float(f.radius), "height": float(s.max() - s.min())}
        if kind == "sphere":
            return {"type": "sphere", "radius": float(f.radius)}
    except Exception:
        pass
    return {"type": "nurbsSurface"}


def _vertex_normals(v: np.ndarray, tri: np.ndarray) -> np.ndarray:
    n = np.zeros_like(v)
    t = tri.reshape(-1, 3)
    if len(t):
        fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
        for i in range(3):
            np.add.at(n, t[:, i], fn)
    norm = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.where(norm > 0, norm, 1)


def _flat(a: Any, digits: int = 5) -> list[float]:
    return [round(float(x), digits) for x in np.asarray(a, dtype=float).ravel()]
