"""Machining setups: a part laid on the machine for a 3-axis router, its features sorted into the
layers a CNC shop reads.

A setup is one clamping of the workpiece: the part rests on one face, the tool comes from the
opposite side. What a 3-axis machine cuts in that setup lies along the tool's axis: the outline
of the part (a through cut), the holes through it, and the pockets that open on the top face,
each to its depth. What it cannot cut is reported, so that it goes to another setup, a jig or a
hand tool: pockets that open on the underside or on an edge, voids, and faces that do not run
along the tool.
"""

from __future__ import annotations

from itertools import pairwise
from typing import Any, NamedTuple

import numpy as np

from .geometry import Axis, Plane, Vector

__all__ = ["MachiningSetup", "machining_setup"]

OUTLINE, THROUGH, LABEL = "OUTLINE", "THROUGH", "LABEL"
POCKET = "POCKET_D"
BELOW, SIDE, ENCLOSED, NOT_PRISM = "opens below", "opens at the side", "enclosed", "not a prism along the tool"
Z_AXIS = Vector(0, 0, 1)


class MachiningSetup(NamedTuple):
    """One setup of a part on a 3-axis machine (see :func:`machining_setup`).

    Attributes:
        part: The part in the setup's frame: resting on z = 0, the face the tool works from at
            z = ``thickness``, its footprint in the positive quadrant.
        plane: The setup's frame in the model: its origin is the drawing's origin, its x and y
            the drawing's, its normal the direction the tool comes from.
        thickness: The part's extent along the tool, in mm: the stock's finished thickness.
        layers: Sketches in the XY plane, one per layer, named as :func:`export_dxf` writes them:
            ``OUTLINE`` (the footprint's outer contours, the through cut), ``THROUGH`` (the holes
            through the part), ``POCKET_D<depth>`` (the pockets open on the top face, by depth
            from it, in mm: ``POCKET_D15``, ``POCKET_D7_5``) and ``LABEL`` (the label and the
            grain arrow, when a label is given).
        elsewhere: What this setup cannot cut, as ``(why, direction, faces)`` triples: why, the
            direction (in the setup's frame) a tool must come from instead, and the faces (in
            that frame). ``"opens below"`` (a pocket of the other face: turn the part over,
            direction ``(0, 0, -1)``, the faces its floors), ``"opens at the side"`` (a mortise
            in an edge: an edge setup, the direction the normal of the face it opens through, the
            faces the whole feature), ``"enclosed"`` (a void; no direction) or ``"not a prism
            along the tool"`` (a face a vertical cutter cannot follow: a slope, a cove, an
            undercut; no direction).
    """

    part: Any
    plane: Plane
    thickness: float
    layers: list
    elsewhere: list

    def layer(self, name: str) -> Any:
        """The sketch of one layer, or ``None`` when the setup has none of that name."""
        for s in self.layers:
            if s.name == name:
                return s
        return None


def machining_setup(
    part: Any,
    direction: Any = (0, 0, 1),
    *,
    x_dir: Any = None,
    label: str | None = None,
    label_size: float | None = None,
) -> MachiningSetup:
    """Lay a part on a 3-axis machine and sort its features into the layers of a machining drawing.

    Args:
        part: A ``Part`` of one solid.
        direction: Where the tool comes from: a planar ``Face`` of the part (the part rests on the
            opposite side and that face is worked), an ``Axis`` or a vector (from the part towards
            the tool). Default: from above, the part as it stands.
        x_dir: The model direction that becomes the drawing's x. Default: the footprint's longest
            straight edge, laid along x at the bottom of the drawing (a board's long side, with
            its grain); a footprint without one (a curved rail) lies along its principal axis.
        label: A text for the ``LABEL`` layer, at the footprint's centroid, with a grain arrow
            along x below it; default none.
        label_size: The label's capital height in mm; default a sixth of the footprint's shorter
            extent, between 2 and 20.

    Returns:
        A :class:`MachiningSetup`: the part laid flat, the drawing plane, the thickness, the
        layers (write them with ``export_dxf(setup.layers, path, curves="arcs")``) and what the
        setup leaves for another one.

    The footprint is the union of the part's cross-sections between its horizontal faces and of
    the shadows of its sloping planar faces: exact for the parts a router cuts from flat stock.
    Every face that is neither the top, the bottom nor a wall of the footprint belongs to a
    feature; the faces of one feature are joined along their edges. A feature whose floor faces
    the tool and is open to it is a pocket, written at each of its floors (a stepped pocket on
    several layers), its contour the floor's outline with the islands that rise from it; the
    depth is measured from the top face. A pocket open to the side (a rabbet, a tenon cheek) is
    written as it is, its contour on the outline.
    """
    from .shapes import Part, ShapeList, Sketch
    from .sketches import make_face

    if isinstance(part, ShapeList):
        part = part.one() if len(part) == 1 else part
    if not isinstance(part, Part):
        raise TypeError(f"machining_setup lays out a Part, not a {type(part).__name__}")
    solids = part.solids()
    if len(solids) != 1:
        raise ValueError(f"machining_setup: one solid at a time, this part has {len(solids)}; lay out its solids()")
    up = _direction(direction)
    if x_dir is not None:
        x = x_dir.direction if isinstance(x_dir, Axis) else Vector(x_dir)
        x = x - up * x.dot(up)
        if x.length < 1e-9:
            raise ValueError("machining_setup: x_dir is along the tool; give a direction across the part")
        x = x.normalized()
    else:
        x = _long_axis(part, up)
    if label_size is not None and not label_size > 0:
        raise ValueError("machining_setup: label_size must be positive")
    frame = Plane((0, 0, 0), x_dir=x, z_dir=up)
    laid = part.moved(frame.location.inverse())
    box = laid.bbox()
    laid = laid.translate(-box.min.x, -box.min.y, -box.min.z)
    plane = Plane(frame.from_local(box.min), x, up)
    thickness = float(box.size.z)
    tol = 1e-6 * max(box.diagonal, 1.0)

    footprint = _footprint(laid, thickness, tol)
    outer: Sketch | None = None
    holes: Sketch | None = None
    for f in footprint.faces():
        outer = _fused(outer, make_face(f.outer_wire()))
        for w in f.inner_wires():
            holes = _fused(holes, make_face(w))
    assert outer is not None
    layers: list[Any] = [outer.named(OUTLINE)]
    if holes is not None:
        layers.append(holes.named(THROUGH))

    pockets: dict[float, Sketch] = {}
    elsewhere: list[tuple[str, Vector | None, ShapeList]] = []
    boundary = [e for f in footprint.faces() for w in f.wires() for e in w.edges()]
    roles = [(f, _role(f, thickness, boundary, tol)) for f in laid.faces()]
    rim = [f for f, role in roles if role == "rim"]
    if rim:
        elsewhere.append((NOT_PRISM, None, ShapeList(rim)))
    for feature in _components([f for f, role in roles if role == "feature"], tol):
        floors, left = _sorted(laid, feature, tol)
        elsewhere += [(why, direction, ShapeList(faces)) for why, direction, faces in left]
        for floor in floors:
            islands = [w for w in floor.inner_wires() if _rises(w, feature, floor, tol)]
            z = floor.center().z
            depth = round(thickness - z, 3)
            pockets[depth] = _fused(pockets.get(depth), make_face(floor.outer_wire(), *islands).translate(0, 0, -z))
    for depth in sorted(pockets):
        layers.append(pockets[depth].named(_pocket_layer(depth)))
    if label is not None:
        layers.append(_label(outer, str(label), label_size))
    return MachiningSetup(laid, plane, thickness, layers, elsewhere)


def _direction(direction: Any) -> Vector:
    """The unit vector from the part towards the tool."""
    from .shapes import Face, ShapeList

    if isinstance(direction, ShapeList):
        direction = direction.one()
    if isinstance(direction, Face):
        if not direction.is_planar:
            raise ValueError(f"machining_setup: the face is a {direction.geom_type}; the tool comes from a planar face")
        return direction.normal_at()
    if isinstance(direction, Axis):
        return direction.direction
    v = Vector(direction)
    if v.length < 1e-12:
        raise ValueError("machining_setup: the direction has no length")
    return v.normalized()


def _long_axis(part: Any, up: Vector) -> Vector:
    """The direction across the tool that becomes x: the footprint's longest straight edge where it
    has one (a board's long side, laid at the bottom of the drawing), else its principal axis, else
    a world axis."""
    provisional = Plane((0, 0, 0), z_dir=up)
    laid = part.moved(provisional.location.inverse())
    box = laid.bbox()
    laid = laid.translate(-box.min.x, -box.min.y, -box.min.z)
    footprint = _footprint(laid, float(box.size.z), 1e-6 * max(box.diagonal, 1.0))
    centroid = footprint.center()
    edges = [e for f in footprint.faces() for e in f.outer_wire().edges() if e.geom_type == "line"]
    along = None
    if edges:
        # the longest; of equal ones the lowest, then the leftmost, so that the choice is the same every time
        longest = min(
            edges, key=lambda e: (-round(e.length, 6), round(e.point_at(0.5).y, 6), round(e.point_at(0.5).x, 6))
        )
        if longest.length >= 0.5 * footprint.bbox().diagonal:
            a, b = longest.start, longest.end
            d = (b - a).normalized()
            m = (a + b) * 0.5
            if d.x * (centroid.y - m.y) - d.y * (centroid.x - m.x) < 0:
                d = -d  # (the part lies on the left of the edge: above it in the drawing)
            along = d
    if along is None:
        sp = footprint.section_properties()
        # the covariance of the area in the plane's axes: ∫x² = iyy, ∫y² = ixx, ∫xy = ixy
        c = np.array([[sp.iyy, sp.ixy], [sp.ixy, sp.ixx]], dtype=float)
        values, vectors = np.linalg.eigh(c)
        if values[1] - values[0] <= 1e-6 * max(values[1], 1e-12):
            return provisional.x_dir  # (a square, a disc: no long direction)
        major = vectors[:, 1]
        if major[0] < 0 or (abs(major[0]) < 1e-12 and major[1] < 0):
            major = -major  # (the same axis, pointing along +x when it can)
        along = sp.plane.x_dir * float(major[0]) + sp.plane.y_dir * float(major[1])
    return (provisional.x_dir * along.x + provisional.y_dir * along.y).normalized()


def _footprint(laid: Any, thickness: float, tol: float) -> Any:
    """The part's shadow along the tool, in the XY plane: the union of its sections between its
    horizontal faces, and of the shadows of its sloping planar faces."""
    from .shapes import Sketch

    levels = sorted({0.0, thickness, *(round(f.center().z, 6) for f in laid.faces() if _horizontal(f))})
    eps = min(0.01, thickness / 1000)
    zs = [eps, thickness - eps]
    for a, b in pairwise(levels):
        if b - a > 4 * eps:
            zs.append((a + b) / 2)
    footprint: Sketch | None = None
    for z in sorted(set(zs)):
        try:
            footprint = _fused(footprint, _slice(laid, z, eps))
        except ValueError:
            continue  # (the plane misses the part: a section between separate lumps)
    for f in laid.faces():
        if f.is_planar and not (_horizontal(f) or _vertical(f)):
            shadow = f.to_sketch().extrude(3 * thickness, direction=(0, 0, -1)).translate(0, 0, thickness)
            footprint = _fused(footprint, _slice(shadow, thickness / 2))
    if footprint is None:
        raise ValueError("machining_setup: the part has no section across the tool")
    return footprint


def _slice(body: Any, z: float, nudge: float = 0.0) -> Any:
    """The body's section at height z, brought down to the XY plane. A plane that meets an edge or
    touches a face inside the body can fail in the kernel: the section is then taken a little
    above or below, within ``nudge``."""
    from ._kernel import KernelError

    steps = [0.0] if not nudge else [0.0, nudge, -nudge, 2 * nudge, -2 * nudge]
    for step in steps:
        try:
            return body.section(Plane.XY.offset(z + step)).translate(0, 0, -(z + step))
        except KernelError:
            if step == steps[-1]:
                raise
    raise AssertionError("unreachable")


def _fused(a: Any, b: Any) -> Any:
    return b if a is None else a + b


def _horizontal(face: Any) -> bool:
    return face.is_planar and face.plane.z_dir.is_parallel(Z_AXIS)


def _vertical(face: Any) -> bool:
    return face.is_planar and face.plane.z_dir.is_perpendicular(Z_AXIS)


def _along(face: Any) -> bool:
    """Whether a vertical cutter can make the face: a plane along or across the tool, or a cylinder
    around it."""
    if face.is_planar:
        return _horizontal(face) or _vertical(face)
    return face.geom_type == "cylinder" and face.axis.direction.is_parallel(Z_AXIS)


def _role(face: Any, thickness: float, boundary: list, tol: float) -> str:
    """``"skin"`` for the faces the outline cut leaves (the top, the bottom, the walls standing on
    the footprint's contours), ``"rim"`` for a face that does not run along the tool and meets a
    contour (a chamfer or a slope on the outline: shaped, not pocketed), ``"feature"`` otherwise."""
    if _horizontal(face):
        z = face.center().z
        return "skin" if z > thickness - tol or z < tol else "feature"
    on_contour = []
    for e in face.edges():
        m = e.point_at(0.5)
        on_contour.append(any(b.distance_to(Vector(m.x, m.y, 0)) < 100 * tol for b in boundary))
    if _along(face):
        return "skin" if all(on_contour) else "feature"
    return "rim" if any(on_contour) else "feature"


def _edge_keys(edges: Any, tol: float) -> set[tuple[int, int, int, int]]:
    """The edges as keys: two faces that share an edge share a key."""
    scale = 1.0 / max(100 * tol, 1e-9)
    out = set()
    for e in edges:
        m = e.point_at(0.5)
        out.add((round(m.x * scale), round(m.y * scale), round(m.z * scale), round(e.length * scale)))
    return out


def _components(faces: list, tol: float) -> list[list]:
    """The faces grouped into features: faces that share an edge belong together."""
    keys = [_edge_keys(f.edges(), tol) for f in faces]
    parent = list(range(len(faces)))

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    by_edge: dict[Any, int] = {}
    for i, ks in enumerate(keys):
        for k in ks:
            if k in by_edge:
                parent[root(i)] = root(by_edge[k])
            else:
                by_edge[k] = i
    groups: dict[int, list] = {}
    for i, f in enumerate(faces):
        groups.setdefault(root(i), []).append(f)
    return list(groups.values())


def _exposed(laid: Any, face: Any, towards: Vector, tol: float) -> bool:
    """Whether a tool coming from ``towards`` reaches the whole face: rays from outside, at the
    face's centroid and between it and the corners, meet this face first."""
    reach = laid.bbox().diagonal + 1.0
    if face.is_planar:
        c = face.center()
        samples = [c, *((c + v.center()) * 0.5 for v in face.outer_wire().vertices())]
    else:
        samples = [face.position_at(u, v) for u in (0.5, 0.2, 0.8) for v in (0.5, 0.2, 0.8)]
    seen = False
    for p in samples:
        if face.distance_to(p) > 100 * tol:
            continue  # (the centroid of an L lies off the face)
        seen = True
        hits = laid.raycast(p + towards * reach, -towards)
        if not hits or face.distance_to(hits[0].point) > 100 * tol:
            return False
    return seen


def _sorted(laid: Any, feature: list, tol: float) -> tuple[list, list]:
    """The floors of a feature this setup pockets, and what it leaves: ``(why, direction, faces)``."""
    if not all(_along(f) for f in feature):
        return [], [(NOT_PRISM, None, feature)]
    ups = [f for f in feature if _horizontal(f) and f.plane.z_dir.z > 0]
    exposed = [f for f in ups if _exposed(laid, f, Z_AXIS, tol)]
    hidden = [f for f in ups if not any(f is e for e in exposed)]
    downs = [f for f in feature if _horizontal(f) and f.plane.z_dir.z < 0 and _exposed(laid, f, -Z_AXIS, tol)]
    left: list = []
    if downs:
        left.append((BELOW, -Z_AXIS, downs))
    if not exposed and not downs:
        open_sides = [f for f in feature if _vertical(f) and _exposed(laid, f, f.plane.z_dir, tol)]
        if open_sides:
            widest = max(open_sides, key=lambda f: f.area)  # (a slot open at its end too: through its long side)
            left.append((SIDE, widest.plane.z_dir, feature))
        else:
            left.append((ENCLOSED, None, feature))
    elif hidden:
        left.append((NOT_PRISM, None, hidden))  # (a floor under an overhang: an undercut)
    return exposed, left


def _rises(wire: Any, feature: list, floor: Any, tol: float) -> bool:
    """Whether the material inside an inner wire of a floor stands above the floor (an island the
    pocket goes around) rather than below it (a step the pocket goes down to)."""
    keys = _edge_keys(wire.edges(), tol)
    z = floor.center().z
    for f in feature:
        if f is floor or not (keys & _edge_keys(f.edges(), tol)):
            continue
        return f.bbox().max.z > z + tol
    return True


def _pocket_layer(depth: float) -> str:
    text = f"{depth:.3f}".rstrip("0").rstrip(".")
    return POCKET + text.replace(".", "_")


def _label(outline: Any, label: str, size: float | None) -> Any:
    """The label and a grain arrow along x, at the footprint's centroid."""
    from .align import Align
    from .sketches import Polygon, Rectangle
    from .text import Text

    box = outline.bbox()
    if size is None:
        size = min(20.0, max(2.0, min(box.size.x, box.size.y) / 6))
    c = outline.center()
    text = Text(label, size).translate(c.x, c.y + 0.7 * size, 0)
    length, stroke = 4 * size, 0.12 * size
    shaft = Rectangle(length - size, stroke, align=(Align.MIN, Align.CENTER))
    head = Polygon((length - size, -0.35 * size), (length, 0), (length - size, 0.35 * size))
    arrow = (shaft + head).translate(c.x - length / 2, c.y - 0.9 * size, 0)
    return (text + arrow).named(LABEL)
