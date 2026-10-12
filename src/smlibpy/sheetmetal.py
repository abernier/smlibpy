"""Sheet metal: exact bends with bend radius and K-factor, flanges, and unfolding to a flat pattern.

A sheet metal part is a solid of constant thickness: flat regions joined by bends. A bend has an
inside radius ``radius`` and an angle; its neutral fiber, at ``k_factor * thickness`` from the
inside surface, keeps its length. In the flat, a bend takes the strip of the bend allowance

    BA = angle_rad * (radius + k_factor * thickness)

and folding turns that strip into exact cylinders (``radius`` inside, ``radius + thickness``
outside). Unfolding does the inverse, so a part folded and unfolded with the same K-factor is the
blank again.

    blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
    bracket = bend(blank, Axis((20, 0, 2), Y), 90, radius=2)   # fold the +X end up
    pattern = flat_pattern(bracket)                            # the blank, laid on XY
    pattern.outline, pattern.bend_lines

The kernel does the geometry (SMLib's space bend and unbend); see ``src/cpp/sheetmetal.cpp``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np

from ._kernel import BrepHandle, KernelError, ModelingError, ext, k, kernel_call
from .geometry import Axis, Location, Plane, Vector, VectorLike, _vec
from .shapes import Edge, Face, Part, Shape, ShapeList, Sketch, Vertex

__all__ = [
    "K_FACTOR",
    "Bend",
    "FlatPattern",
    "bend",
    "flange",
    "base_flange",
    "unfold",
    "flat_pattern",
    "bends",
    "bend_allowance",
    "bend_deduction",
    "developed_length",
]

#: Default K-factor: the neutral fiber at 0.44 of the thickness from the inside surface.
K_FACTOR = 0.44


# =============================================================================
# Formulas
# =============================================================================
def _check_values(what: str, angle: float, radius: float, thickness: float, k_factor: float,
                  max_angle: float = 180.0) -> None:
    if not 0.0 < float(angle) <= max_angle:
        raise ValueError(f"{what}: the angle must be above 0 and at most {max_angle:g} degrees (got {angle!r})")
    if not float(radius) > 0.0:
        raise ValueError(f"{what}: the radius must be positive (got {radius!r})")
    if not float(thickness) > 0.0:
        raise ValueError(f"{what}: the thickness must be positive (got {thickness!r})")
    if not 0.0 <= float(k_factor) <= 1.0:
        raise ValueError(f"{what}: the K-factor must be between 0 and 1 (got {k_factor!r})")


def bend_allowance(angle: float, *, radius: float, thickness: float, k_factor: float = K_FACTOR) -> float:
    """Length of the flat strip that a bend takes: ``radians(angle) * (radius + k_factor * thickness)``.

    ``angle`` is the bend angle in degrees (90 for an L), ``radius`` the inside radius.
    """
    _check_values("bend_allowance", angle, radius, thickness, k_factor)
    return math.radians(angle) * (radius + k_factor * thickness)


def bend_deduction(angle: float, *, radius: float, thickness: float, k_factor: float = K_FACTOR) -> float:
    """What a bend takes off the sum of the outside leg lengths: ``2 * (radius + thickness) *
    tan(angle / 2) - bend_allowance``. The outside lengths run to the virtual sharp, where the
    outer faces of the two legs meet (below 180 degrees)."""
    _check_values("bend_deduction", angle, radius, thickness, k_factor, max_angle=179.999999)
    setback = (radius + thickness) * math.tan(math.radians(angle) / 2.0)
    return 2.0 * setback - bend_allowance(angle, radius=radius, thickness=thickness, k_factor=k_factor)


def developed_length(*legs: float, angle: float | Sequence[float] = 90.0, radius: float, thickness: float,
                     k_factor: float = K_FACTOR) -> float:
    """Length of the flat blank for a strip bent into ``legs``.

    The legs are outside lengths: from the free end, or from the virtual sharp where the outer
    faces of two legs meet, to the next virtual sharp (the dimensions on a drawing of the part).
    ``angle`` is the angle of every bend, or one angle per bend (``len(legs) - 1`` of them).
    The result is ``sum(legs) - sum(bend deductions)``.
    """
    if len(legs) < 2:
        raise ValueError("developed_length: give at least two legs")
    angles = [float(angle)] * (len(legs) - 1) if isinstance(angle, (int, float)) else [float(a) for a in angle]
    if len(angles) != len(legs) - 1:
        raise ValueError(f"developed_length: {len(legs)} legs need {len(legs) - 1} angles, got {len(angles)}")
    total = 0.0
    for leg in legs:
        if not float(leg) > 0:
            raise ValueError(f"developed_length: the legs must be positive (got {leg!r})")
        total += float(leg)
    for a in angles:
        total -= bend_deduction(a, radius=radius, thickness=thickness, k_factor=k_factor)
    return total


# =============================================================================
# Records
# =============================================================================
@dataclass(frozen=True)
class Bend:
    """One bend of a sheet metal part.

    ``angle`` in degrees, ``radius`` the inside radius, ``length`` the bend's extent along its
    axis. From :func:`bends`, ``axis`` is the axis of the bend's cylinders. In a
    :class:`FlatPattern`, ``line`` is the bend line (the middle of the bend's strip, at z = 0)
    and ``direction`` ``"up"`` or ``"down"``: where the sheet beyond the line folds to, seen from
    above (+Z).
    """

    angle: float
    radius: float
    thickness: float
    k_factor: float
    length: float
    axis: Axis | None = None
    line: Edge | None = None
    direction: str | None = None

    @property
    def allowance(self) -> float:
        """The bend allowance (the width of the bend's strip in the flat)."""
        return bend_allowance(self.angle, radius=self.radius, thickness=self.thickness, k_factor=self.k_factor)

    def __repr__(self) -> str:
        extra = f", {self.direction}" if self.direction else ""
        return (f"Bend(angle={self.angle:.6g}, radius={self.radius:.6g}, thickness={self.thickness:.6g}, "
                f"length={self.length:.6g}, allowance={self.allowance:.6g}{extra})")


@dataclass(frozen=True)
class FlatPattern:
    """The unfolded part, laid on the XY plane: its bottom face at z = 0, the top at z = thickness,
    the longest straight outline edge along X and the bounding box starting at the origin.

    ``outline`` is the cut contour (outer boundary and holes) as a sketch at z = 0; ``bends``
    carry the bend lines (at z = 0) with angle, radius, direction and allowance.
    """

    part: Part
    outline: Sketch
    bends: list[Bend]
    thickness: float
    k_factor: float

    @property
    def bend_lines(self) -> ShapeList[Edge]:
        """The bend lines (middle of each bend's strip), at z = 0."""
        return ShapeList(b.line for b in self.bends if b.line is not None)

    @property
    def size(self) -> Vector:
        """Size of the blank: (length along X, width along Y, thickness)."""
        return self.part.bbox().size

    def __repr__(self) -> str:
        s = self.size
        return (f"FlatPattern({s.x:.6g} x {s.y:.6g}, thickness={self.thickness:.6g}, "
                f"{len(self.bends)} bends, k_factor={self.k_factor:g})")


# =============================================================================
# Sheet analysis
# =============================================================================
def _tol(part: Part) -> float:
    return 1e-6 * max(1.0, part._extent())


def _planar_faces(part: Part) -> list[tuple[Face, Vector, Vector]]:
    """(face, a point on it, outward unit normal) of every planar face."""
    out = []
    for f in part.faces():
        if f.geom_type == "plane":
            out.append((f, f.interior_point(), f.normal_at()))
    return out


def _thickness_behind(planes: list[tuple[Face, Vector, Vector]], point: Vector, normal: Vector,
                      tol: float) -> float | None:
    """Distance from a face plane to the nearest face behind it that faces the other way."""
    best = None
    for _, q, m in planes:
        if m.dot(normal) < -1.0 + 1e-9:
            d = (point - q).dot(normal)
            if d > tol and (best is None or d < best):
                best = d
    return best


def _as_line(line: Any, what: str) -> tuple[Vector, Vector, float | None]:
    """Point, unit direction and segment length (None for an Axis) of a bend line."""
    if isinstance(line, Axis):
        return line.origin, line.direction.normalized(), None
    if isinstance(line, Edge):
        if line.geom_type != "line":
            raise ValueError(f"{what}: the bend line must be straight (an Axis or a Line), not a {line.geom_type}")
        p0, p1 = line.start, line.end
        v = p1 - p0
        return p0, v / v.length, v.length
    raise TypeError(f"{what}: the bend line must be an Axis or a straight Edge, not a {type(line).__name__}")


def _point_of(target: Any) -> Vector:
    if isinstance(target, Shape) and not isinstance(target, Vertex):
        return target.center()
    if isinstance(target, Vertex):
        return target.point
    return _vec(target)


def _require_part(part: Any, what: str) -> Part:
    if not isinstance(part, Part):
        raise TypeError(f"{what}: expected a Part (a sheet of material), got {type(part).__name__}")
    part._require_valid(what)
    return part


# =============================================================================
# Bending
# =============================================================================
def _strip_area(part: Part, p_in: Vector, across: Vector, along: Vector, n_in: Vector, width: float,
                lo: float, hi: float, thickness: float) -> float | None:
    """Area of the sheet in the bend strip (the material the bend takes), from the volume of the
    part inside the bend region: ``width`` across the line through ``p_in`` (on the inside face),
    from ``lo`` to ``hi`` along it, through the thickness."""
    from .parts import Box

    margin = 0.1  # the kernel's bend region reaches as far past the sheet
    center = p_in + along * (0.5 * (lo + hi)) - n_in * (0.5 * thickness)
    region = Box(width, hi - lo + 2 * margin, thickness + 2 * margin).moved(
        Plane(center, x_dir=across, z_dir=n_in).location)
    try:
        with kernel_call("bend"):
            common = Part._wrap(k.boolean(part._copy_brep(), region._copy_brep(), operation=k.BooleanOp.INTERSECTION))
        if common._brep.face_count() == 0:
            return 0.0
        return float(common._props(accuracy=1e-9)["volume"]) / thickness
    except KernelError:
        return None


def bend(part: Part, line: Axis | Edge, angle: float, *, radius: float, k_factor: float = K_FACTOR,
         fixed: VectorLike | Shape | None = None, partial: bool = False) -> Part:
    """Fold a sheet along a line.

    Args:
        part: A sheet: a solid of constant thickness (a plate, or a part bent before).
        line: The bend line, an :class:`Axis` or a straight :class:`Edge` lying on the top or
            bottom face of the sheet. It is the middle of the bend: the strip of the bend
            allowance's width centered on it becomes the bend.
        angle: Bend angle in degrees, up to 180. A positive angle folds the sheet towards the
            side the face with the line faces (that face ends up inside the bend); a negative
            angle folds it the other way.
        radius: Inside bend radius.
        k_factor: Position of the neutral fiber, 0 (inside) to 1 (outside).
        fixed: A point (or a face, edge or vertex) on the side of the line that stays in place;
            by default the side that reaches farther from the line stays.
        partial: Bend only along the segment ``line`` (an Edge), not across the whole sheet. The
            strip next to the segment must be cut free from the rest of the sheet (relief cuts).

    Returns:
        The bent part: the bend faces are exact cylinders of ``radius`` and ``radius + thickness``.
    """
    what = "bend"
    _require_part(part, what)
    p0, d, seg = _as_line(line, what)
    if partial and seg is None:
        raise ValueError("bend: partial=True needs the bend line as an Edge (a segment), not an Axis")
    tol = _tol(part)
    planes = _planar_faces(part)
    on = [(f, q, n) for f, q, n in planes if abs((p0 - q).dot(n)) <= tol and abs(d.dot(n)) <= 1e-7]
    if not on:
        raise ModelingError("bend: the bend line does not lie on a planar face of the part; draw it on the top or "
                            "bottom face of the sheet (for a plate on XY at z = 0..t: Axis((x, 0, t), Y))")
    n_face = on[0][2]
    if any(n.dot(n_face) < 0 for _, _, n in on):
        raise ModelingError("bend: the bend line lies on faces that face opposite ways; move it onto one face")
    t = _thickness_behind(planes, p0, n_face, tol)
    if t is None:
        raise ModelingError("bend: no face opposite the face with the bend line; the part is not a sheet")
    a = float(angle)
    if a == 0 or not abs(a) <= 180.0:
        raise ValueError(f"bend: the angle must be between -180 and 180 degrees and not zero (got {angle!r})")
    _check_values(what, abs(a), radius, t, k_factor)
    radius = float(radius)
    k_factor = float(k_factor)

    # The inside of the bend: the face with the line for a positive angle, else the opposite face.
    n_in = n_face if a > 0 else -n_face
    p_in = p0 if a > 0 else p0 - n_face * t
    across = n_face.cross(d).normalized()  # in the sheet, perpendicular to the line

    # The side that stays.
    if fixed is not None:
        side = (_point_of(fixed) - p0).dot(across)
        if abs(side) <= tol:
            raise ValueError("bend: the fixed point lies on the bend line; give a point on the side that stays")
        stay = across if side > 0 else -across
    else:
        reach = [(v.point - p0).dot(across) for v in part.vertices()]
        stay = across if max(reach) >= -min(reach) else -across

    # Kernel frame: the side of cross(direction, axis) stays, direction runs from the axis to the sheet.
    direction = -n_in
    axis_dir = d if direction.cross(d).dot(stay) > 0 else -d
    axis_line_point = p_in + n_in * radius
    if partial:
        assert seg is not None
        s0 = (p0 - axis_line_point).dot(axis_dir)
        s1 = (p0 + d * seg - axis_line_point).dot(axis_dir)
        lo, hi = min(s0, s1), max(s0, s1)
    else:
        box = part.bbox()
        corners = [Vector(x, y, z) for x in (box.min.x, box.max.x) for y in (box.min.y, box.max.y)
                   for z in (box.min.z, box.max.z)]
        proj = [(c - axis_line_point).dot(axis_dir) for c in corners]
        lo, hi = min(proj) - 1.0, max(proj) + 1.0
    allowance = bend_allowance(abs(a), radius=radius, thickness=t, k_factor=k_factor)

    strip = _strip_area(part, p_in, across, axis_dir, n_in, allowance, lo, hi, t)
    h = BrepHandle(part._copy_brep())
    hint = ("the bend zone must lie inside one flat region of the sheet: move the line away from edges, holes and "
            "other bends (at least half the bend allowance, %.4g)" % (allowance / 2))
    with kernel_call("bend", hint):
        counts = k.sheetmetal.bend(h.brep, abs(a), radius, k_factor, t, (axis_line_point + axis_dir * lo).to_tuple(),
                                   axis_dir.to_tuple(), direction.to_tuple(), hi - lo)
    if counts[1] == 0 or counts[2] == 0:
        raise ModelingError(f"bend: the bend zone is not between two parts of the sheet; {hint}")
    result = part._like(h.brep)
    h.brep = None
    _check_bend_result(result, part, what, strip, radius, t, k_factor, axis_dir, partial, hint)
    return result


def _check_bend_result(result: Part, before: Part, what: str, strip: float | None, radius: float, t: float,
                       k_factor: float, axis_dir: Vector, partial: bool, hint: str) -> None:
    relief = (" The sheet next to a partial bend must be cut free (relief cuts) so that only the bent strip "
              "connects the two sides." if partial else "")
    problem = result._solid_problem()
    if problem is not None:
        raise ModelingError(f"{what}: the result is not a valid solid ({problem}); {hint}.{relief}")
    inner = [f for f in result.faces() if f.geom_type == "cylinder" and abs(f.radius - radius) <= 1e-6 * max(1, radius)
             and f.axis.direction.is_parallel(axis_dir, 1e-6)]
    outer = [f for f in result.faces() if f.geom_type == "cylinder"
             and abs(f.radius - radius - t) <= 1e-6 * max(1, radius + t) and f.axis.direction.is_parallel(axis_dir, 1e-6)]
    if not inner or not outer:
        raise ModelingError(f"{what}: the kernel did not build exact bend faces (cylinders of radius {radius:g} and "
                            f"{radius + t:g}); {hint}")
    v0 = before.volume
    v1 = result.volume
    if strip is None:  # no independent measure of the strip: take it from the inside faces
        strip = sum(f.area for f in inner) * (radius + k_factor * t) / radius
    expected = v0 + strip * t * t * (0.5 - k_factor) / (radius + k_factor * t)
    if abs(v1 - expected) > 1e-6 * v0 + 1e-4 * strip:
        raise ModelingError(f"{what}: the result has the volume {v1:.9g}, expected {expected:.9g} for the material in "
                            f"the bend zone; {hint}.{relief}")


# =============================================================================
# Finding bends
# =============================================================================
@dataclass
class _BendGeom:
    """A bend found in a part: its cylinder faces and where they are."""

    inner: list[Face]
    outer: list[Face]
    origin: Vector  # on the axis, at the start of the bend along it
    axis: Vector  # unit
    mid: Vector  # unit, from the axis to the middle of the bend
    radius: float  # inside
    thickness: float
    angle: float  # degrees
    length: float  # along the axis

    def faces(self) -> list[Face]:
        return self.inner + self.outer


def _angles_on(face: Face, origin: Vector, axis: Vector, x: Vector, y: Vector) -> tuple[list[float], list[float]]:
    """Angles (about the axis, from x towards y) and axial positions of points on a face's boundary."""
    angles, along = [], []
    for e in face.edges():
        n = 1 if e.geom_type == "line" else 8
        for i in range(n + 1):
            p = e.point_at(i / n) - origin
            along.append(p.dot(axis))
            angles.append(math.atan2(p.dot(y), p.dot(x)))
    return angles, along


def _arc_span(angles: list[float]) -> tuple[float, float]:
    """(start, span) of the shortest arc covering all angles (radians)."""
    a = sorted(x % (2 * math.pi) for x in angles)
    gaps = [(a[(i + 1) % len(a)] - a[i]) % (2 * math.pi) for i in range(len(a))]
    i = max(range(len(a)), key=lambda j: gaps[j])
    start = a[(i + 1) % len(a)]
    return start, 2 * math.pi - gaps[i] if len(a) > 1 else 0.0


def _find_bends(part: Part) -> tuple[list[_BendGeom], float | None]:
    """The bends of a sheet metal part (pairs of coaxial cylinder faces one thickness apart) and the
    sheet thickness (None when there is no bend)."""
    tol = _tol(part)
    cylinders = [f for f in part.faces() if f.geom_type == "cylinder"]
    groups: list[tuple[Vector, Vector, list[Face]]] = []  # axis point, axis direction, faces
    for f in cylinders:
        ax = f.axis
        z = ax.direction.normalized()
        o = ax.origin
        for g in groups:
            if g[1].is_parallel(z, 1e-7) and (o - g[0]).cross(g[1]).length <= tol:
                g[2].append(f)
                break
        else:
            groups.append((o, z, [f]))
    found: list[_BendGeom] = []
    thickness: float | None = None
    for o, z, faces in groups:
        radii: list[float] = []
        for f in faces:
            if not any(abs(f.radius - r) <= tol for r in radii):
                radii.append(f.radius)
        radii.sort()
        if len(radii) < 2:
            continue  # a hole or a round, not a bend
        if len(radii) > 2:
            raise ModelingError(f"the part has coaxial cylinder faces of {len(radii)} radii "
                                f"({', '.join(f'{r:.6g}' for r in radii)}); it is not a sheet metal part")
        r_in, r_out = radii
        t = r_out - r_in
        if thickness is None:
            thickness = t
        elif abs(t - thickness) > tol:
            raise ModelingError(f"the bends of the part have different thicknesses ({thickness:.6g} and {t:.6g})")
        x = z.any_perpendicular().normalized()
        y = z.cross(x)
        angles: list[float] = []
        along: list[float] = []
        for f in faces:
            a, s = _angles_on(f, o, z, x, y)
            angles += a
            along += s
        start, span = _arc_span(angles)
        if span > math.pi + 1e-6:
            raise ModelingError(f"a bend of the part turns {math.degrees(span):.6g} degrees; bends up to 180 "
                                "degrees can be unfolded")
        mid_angle = start + span / 2
        mid = x * math.cos(mid_angle) + y * math.sin(mid_angle)
        s0, s1 = min(along), max(along)
        inner = [f for f in faces if abs(f.radius - r_in) <= tol]
        outer = [f for f in faces if abs(f.radius - r_out) <= tol]
        found.append(_BendGeom(inner, outer, o + z * s0, z, mid, r_in, t, min(math.degrees(span), 180.0), s1 - s0))
    return found, thickness


def bends(part: Part, *, k_factor: float = K_FACTOR) -> list[Bend]:
    """The bends of a sheet metal part: angle, inside radius, thickness, length and axis of each.

    A bend is a pair of coaxial cylinder faces one sheet thickness apart (as :func:`bend` and
    :func:`flange` make them, or as imported from a sheet metal part). Cylinders without such a
    partner (holes, rounds) are not bends. ``k_factor`` is only used for the allowances.
    """
    if not isinstance(part, Part):
        raise TypeError(f"bends: expected a Part, got {type(part).__name__}")
    found, _ = _find_bends(part)
    return [Bend(g.angle, g.radius, g.thickness, float(k_factor), g.length, Axis(g.origin, g.axis)) for g in found]


# =============================================================================
# Unfolding
# =============================================================================
def _base_face(part: Part, planes: list[tuple[Face, Vector, Vector]]) -> Face:
    """The face that stays in place: the largest planar face; of faces that large, the one the
    part stands on (the rest of the part lies behind it)."""
    if not planes:
        raise ModelingError("unfold: the part has no planar face")
    areas = [f.area for f, _, _ in planes]
    top = max(areas)
    center = part.center()
    candidates = [(f, p, n) for (f, p, n), a in zip(planes, areas) if a >= top * (1 - 1e-6)]
    return min(candidates, key=lambda c: (center - c[1]).dot(c[2]))[0]


def _face_distances(part: Part, start: Any) -> dict[int, int]:
    """Number of face-to-face steps from the face ``start`` (kernel face) to every face (by index)."""
    dump = ext.brep_dump(part._brep, False)
    edge_faces: dict[int, list[int]] = {}
    for i, fd in enumerate(dump["faces"]):
        for use in fd["uses"]:
            if use is None:
                continue
            for loop in use["loops"]:
                for e, _ in loop["edges"]:
                    edge_faces.setdefault(e, []).append(i)
    neighbors: dict[int, set[int]] = {}
    for fs in edge_faces.values():
        for f in fs:
            neighbors.setdefault(f, set()).update(fs)
    first = ext.face_indices(part._brep, [start])[0]
    dist = {first: 0}
    queue = [first]
    while queue:
        nxt = []
        for f in queue:
            for g in neighbors.get(f, ()):
                if g not in dist:
                    dist[g] = dist[f] + 1
                    nxt.append(g)
        queue = nxt
    return dist


@dataclass
class _Unfolded:
    part: Part  # flat, in place
    base: Face  # the face that stayed
    bends: list[tuple[_BendGeom, Vector, Vector, Vector]]  # bend, line start, line direction, inside normal
    thickness: float | None
    k_factor: float


def _unfold(part: Part, k_factor: float, fixed: Face | None, what: str) -> _Unfolded:
    _require_part(part, what)
    if not 0.0 <= float(k_factor) <= 1.0:
        raise ValueError(f"{what}: the K-factor must be between 0 and 1 (got {k_factor!r})")
    k_factor = float(k_factor)
    planes = _planar_faces(part)
    if fixed is not None:
        if not isinstance(fixed, Face) or fixed.owner is not part or fixed.geom_type != "plane":
            raise ValueError(f"{what}: fixed must be a planar face of the part")
        base = fixed
    else:
        base = _base_face(part, planes)
    found, thickness = _find_bends(part)
    copy, mapped, _, _ = ext.copy_with_map(part._brep, [base._f], [], [])
    work = Part._wrap(copy, name=part.name, color=part.color)
    anchor = mapped[0]
    done: list[tuple[_BendGeom, Vector, Vector, Vector]] = []
    volume = part.volume
    expected = volume
    hint = "the part must be a sheet of constant thickness whose bends are separated by flat regions"
    for _ in range(len(found)):
        current, _ = _find_bends(work)
        if not current:
            break
        dist = _face_distances(work, anchor)
        index = {}
        for g in current:
            ids = ext.face_indices(work._brep, [f._f for f in g.faces()])
            index[id(g)] = min((dist.get(i, 1 << 30) for i in ids), default=1 << 30)
        g = min(current, key=lambda c: index[id(c)])
        assert thickness is not None
        nr = g.radius + k_factor * thickness
        strip = sum(f.area for f in g.inner) * nr / g.radius
        expected -= strip * thickness * thickness * (0.5 - k_factor) / nr
        with kernel_call(what, hint):
            stayed = k.sheetmetal.unbend(work._brep, g.angle, g.radius, k_factor, thickness, g.origin.to_tuple(),
                                         g.axis.to_tuple(), g.mid.to_tuple(), g.length, anchor)
        work._h.sound = False
        # Where the bend's strip lies now: from the neutral fiber at the end that stayed, half the
        # allowance into the strip. Later unbends (farther from the fixed face) do not move it.
        half = math.radians(g.angle) / 2
        binormal = g.axis.cross(g.mid)
        if stayed < 0:
            end = g.mid * math.cos(half) - binormal * math.sin(half)
            into = g.axis.cross(end)
        else:
            end = g.mid * math.cos(half) + binormal * math.sin(half)
            into = -g.axis.cross(end)
        allowance = math.radians(g.angle) * nr
        start = g.origin + end * nr + into * (allowance / 2)
        done.append((g, start, g.axis, -end))
    else:
        if _find_bends(work)[0]:
            raise ModelingError(f"{what}: not every bend could be unfolded; {hint}")
    problem = work._solid_problem()
    if problem is not None:
        raise ModelingError(f"{what}: the unfolded part is not a valid solid ({problem}); {hint}")
    curved = [f for f in work.faces() if f.geom_type != "plane"]
    if curved:
        kinds = sorted({f.geom_type for f in curved})
        raise ModelingError(f"{what}: the unfolded part still has {len(curved)} curved faces ({', '.join(kinds)}); "
                            f"only bends (coaxial cylinders one thickness apart) unfold; {hint}")
    v = work.volume
    if abs(v - expected) > 1e-6 * volume + 1e-4 * abs(volume - expected) + 1e-9:
        raise ModelingError(f"{what}: the unfolded part has the volume {v:.9g}, expected {expected:.9g}; {hint}")
    work._h.sound = True
    return _Unfolded(work, Face(work, anchor), done, thickness, k_factor)


def unfold(part: Part, *, k_factor: float = K_FACTOR, fixed: Face | None = None) -> Part:
    """Unfold a sheet metal part: every bend becomes flat again.

    The face ``fixed`` (default: the largest planar face) stays where it is; the rest of the
    sheet unfolds into its plane. With the K-factor the part was bent with, the result is the
    blank it was bent from. For the flat pattern on the XY plane, with outline and bend lines,
    use :func:`flat_pattern`.
    """
    return _unfold(part, k_factor, fixed, "unfold").part


def flat_pattern(part: Part, *, k_factor: float = K_FACTOR, fixed: Face | None = None) -> FlatPattern:
    """The flat pattern of a sheet metal part, laid on the XY plane (see :class:`FlatPattern`).

    The part is unfolded with ``fixed`` (default: the largest planar face) staying in place; that
    face is the bottom of the flat (z = 0) and bends are ``"up"`` when the far side of the sheet
    folds towards +Z. The longest straight outline edge runs along X, and the bounding box starts
    at the origin.
    """
    from .curves import Line

    u = _unfold(part, k_factor, fixed, "flat_pattern")
    flat = u.part
    thickness = u.thickness
    base_plane = u.base.plane
    n_base = base_plane.z_dir
    if thickness is None:  # nothing was bent: measure the plate
        thickness = _thickness_behind(_planar_faces(flat), base_plane.origin, n_base, _tol(flat))
        if thickness is None:
            raise ModelingError("flat_pattern: the part is not a sheet (no face opposite the largest face)")
    tol = _tol(flat)
    # x direction: the longest straight edge in the plane of the fixed face
    best = None
    for e in flat.edges():
        if e.geom_type == "line" and abs(base_plane.distance_to(e.start)) <= tol and \
                abs(base_plane.distance_to(e.end)) <= tol and (best is None or e.length > best.length):
            best = e
    x_dir = best.direction if best is not None else base_plane.x_dir
    frame = Plane(base_plane.origin, x_dir=x_dir, z_dir=-n_base)
    to_xy = frame.location.inverse()
    laid = flat.moved(to_xy)
    shift = Location(-laid.bbox().min)
    laid = laid.moved(shift)
    place = shift * to_xy
    t = float(thickness)
    with kernel_call("flat_pattern", "the flat part could not be cut at mid-thickness"):
        outline = laid.section(Plane((0, 0, t / 2))).translate(0, 0, -t / 2)
    pattern_bends = []
    for g, start, direction, inside in u.bends:
        p0 = place * start
        p1 = place * (start + direction * g.length)
        up = place.rotate_vector(inside).z > 0
        line = Line(Vector(p0.x, p0.y, 0.0), Vector(p1.x, p1.y, 0.0))
        pattern_bends.append(Bend(g.angle, g.radius, t, u.k_factor, g.length, None, line, "up" if up else "down"))
    return FlatPattern(laid, outline, pattern_bends, t, u.k_factor)
