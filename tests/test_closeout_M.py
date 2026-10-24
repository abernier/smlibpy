"""Close-out of the kernel plan's meshes, drawings and files (area M): rays that graze a curved face
within the mesh's tolerance (M5), folds left by decimation and its feature angle (M6), empty bodies
and empty lists in the writers (X10), STEP offset curves and edges given as PCURVEs (I6), mirrored
and scaled assembly placements (I10), offsets of whole spheres (I11), and .brep tolerances (X14)."""

import collections
import math
import re
import warnings

import numpy as np
import pytest

from smlibpy import (Z, Align, Box, Cylinder, Plane, Sphere, Vector, export_glb, export_gltf, export_obj, export_step,
                     from_brep, from_step, from_step_model, to_brep, to_glb, to_gltf, to_obj, to_step)
from test_lane_IX import _occt_text_check


def same_hit(a, b, tol=1e-7) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a.distance - b.distance) <= tol and (a.point - b.point).length <= tol


def mismatches(part, origins, directions) -> int:
    """How many of the rays raycast_many answers otherwise than raycast."""
    many = part.raycast_many(origins, directions)
    bad = 0
    for o, d, h in zip(origins, directions, many):
        exact = part.raycast(Vector(*o), Vector(*d))
        bad += not same_hit(exact[0] if exact else None, h)
    return bad


# =============================================================================
# M5: rays that graze a curved face within the mesh's tolerance
# =============================================================================
def test_raycast_many_rays_that_graze_a_sphere_agree_with_raycast():
    # The mesh lies inside the sphere by up to its tolerance (1e-4 of the size): rays that pass the
    # mesh just outside it can still touch the sphere. 297 of 2000 such rays came out misses in
    # 0.5.0's first raycast_many.
    sphere = Sphere(10)
    tol = sphere.bbox().diagonal * 1e-4
    rng = np.random.default_rng(1)
    n = 600
    a = rng.uniform(0, 2 * np.pi, n)
    r = 10 + rng.uniform(-3 * tol, 0.3 * tol, n)
    origins = np.stack([np.full(n, -50.0), r * np.cos(a), r * np.sin(a)], 1)
    directions = np.tile([1.0, 0.0, 0.0], (n, 1))
    assert mismatches(sphere, origins, directions) == 0


def test_raycast_many_rays_that_graze_a_boss_then_meet_a_wall():
    # rays along the outline of a boss (just inside it) touch it; those just outside go on to the ring
    # wall behind (50 of 400 were answered with the wall in 0.5.0's first raycast_many)
    tube = Cylinder(35, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) - \
        Cylinder(33, 30, align=(Align.CENTER, Align.CENTER, Align.MIN))
    part = Box(80, 80, 2) + Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate((0, 0, 1)) + tube
    tol = part.bbox().diagonal * 1e-4
    rng = np.random.default_rng(5)
    n = 300
    a = rng.uniform(0, 2 * np.pi, n)
    off = rng.uniform(-2.5 * tol, 0.2 * tol, n)
    radial = np.stack([np.cos(a), np.sin(a), np.zeros(n)], 1)
    tangent = np.stack([-np.sin(a), np.cos(a), np.zeros(n)], 1)
    origins = radial * (5 + off)[:, None] + np.array([0, 0, 6.0]) - tangent * 20
    assert mismatches(part, origins, tangent) == 0
    # a cylinder seen side on, rays across its outline; a boss on a plate before a wall
    cylinder = Cylinder(10, 20)
    tol = cylinder.bbox().diagonal * 1e-4
    ys = np.linspace(10 - 3 * tol, 10 + 0.5 * tol, 40)
    assert mismatches(cylinder, [(-50, y, 0) for y in ys], [(1, 0, 0)] * 40) == 0
    plate = Box(60, 40, 2) + Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate((0, 0, 1)) + \
        Box(2, 40, 20).translate((20, 0, 10))
    tol = plate.bbox().diagonal * 1e-4
    ys = np.linspace(5 - 3 * tol, 5 + 0.5 * tol, 40)
    assert mismatches(plate, [(-25, y, 6) for y in ys], [(1, 0, 0)] * 40) == 0


# =============================================================================
# M6: decimation leaves no folds; its feature angle
# =============================================================================
def folds(mesh) -> int:
    """Triangles that face against the triangles across their edges (slivers folded over)."""
    v, t = mesh.vertices, mesh.triangles
    n = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    by_edge = collections.defaultdict(list)
    for i, tri in enumerate(t):
        for k in range(3):
            a, b = int(tri[k]), int(tri[(k + 1) % 3])
            by_edge[(min(a, b), max(a, b))].append(i)
    out = 0
    for i, tri in enumerate(t):
        around = np.zeros(3)
        for k in range(3):
            a, b = int(tri[k]), int(tri[(k + 1) % 3])
            for u in by_edge[(min(a, b), max(a, b))]:
                if u != i:
                    around += n[u]
        out += int(n[i].dot(around) < 0)
    return out


@pytest.mark.parametrize("tolerance, fraction", [(0.01, 0.8), (0.01, 0.9), (0.005, 0.9)])
def test_decimated_meshes_keep_no_folded_slivers(tolerance, fraction):
    # 0.5.0's first decimation left 3 folded slivers in the first of these (3 to 13 in finer spheres)
    mesh = Sphere(10).mesh(tolerance)
    d = mesh.decimate(fraction)
    assert folds(d) == 0 and d.is_closed()
    assert len(d.triangles) == pytest.approx(len(mesh.triangles) * (1 - fraction), rel=0.05)


def test_decimate_feature_angle():
    mesh = Cylinder(5, 10).mesh(0.01)
    sharp = mesh.decimate(0.5)  # (30 degrees: the rims are features)
    smooth = mesh.decimate(0.5, feature_angle=120)  # (the rims' 90 degrees are not)
    for d in (sharp, smooth):
        assert d.is_closed() and folds(d) == 0

    def cap_tilt(d) -> float:
        # the largest angle between a corner normal of a triangle of the top cap and +Z
        v, t, normals = d.vertices, d.triangles, d.normals
        top = np.all(np.isclose(v[t][:, :, 2], 5.0), axis=1)
        return float(np.degrees(np.arccos(np.clip(normals[top][:, :, 2], -1, 1))).max())

    assert cap_tilt(sharp) < 1e-6
    assert cap_tilt(smooth) > 20
    for bad in (-1, 181, float("nan")):
        with pytest.raises(ValueError, match="feature_angle is 0 to 180 degrees"):
            mesh.decimate(0.5, feature_angle=bad)


# =============================================================================
# X10: nothing to write
# =============================================================================
def test_export_step_of_a_list_with_an_empty_body_raises(tmp_path):
    empty = Box(2, 2, 2) & Box(2, 2, 2).translate((10, 0, 0))
    path = tmp_path / "a.step"
    for kwargs in ({}, {"assembly": True}):
        with pytest.raises(ValueError, match=r"export_step: the Part 'gone' is empty: it has no faces to write"):
            export_step([Box(10, 10, 10), empty.named("gone")], path, **kwargs)
        assert not path.exists()
    with pytest.raises(ValueError, match=r"to_step: the Part is empty: it has no faces to write \(a Boolean"):
        to_step([Box(10, 10, 10), empty])
    with pytest.raises(ValueError, match="to_step: nothing to write"):
        to_step([])


def test_mesh_writers_of_nothing_raise(tmp_path):
    for write, name in ((export_glb, "export_glb"), (export_gltf, "export_gltf"), (export_obj, "export_obj")):
        path = tmp_path / f"a.{name[7:]}"
        with pytest.raises(ValueError, match=f"{name}: nothing to write"):
            write([], path)
        assert not path.exists()  # (0.5.0 wrote an empty file)
    for make, name in ((to_glb, "to_glb"), (to_gltf, "to_gltf"), (to_obj, "to_obj")):
        with pytest.raises(ValueError, match=f"{name}: nothing to write"):
            make([])
    # what there is is written as before
    assert to_obj([Box(1, 1, 1)]).count("\nv ") == 8 and to_glb([Box(1, 1, 1)])[:4] == b"glTF"


# =============================================================================
# I6: OFFSET_CURVE_3D and edges given as PCURVEs
# =============================================================================
def _next_id(text: str) -> int:
    return max(int(x) for x in re.findall(r"#(\d+)=", text)) + 1


def _with(text: str, lines: list) -> str:
    return text.replace("ENDSEC;\nEND-ISO", "".join(f"{x}\n" for x in lines) + "ENDSEC;\nEND-ISO", 1)


def _cylinder_step():
    """A Cylinder(5, 10)'s STEP text and the ids of its parts: the top circle and its placement's axis,
    the seam line, the cylindrical surface and the representation context."""
    text = to_step(Cylinder(5, 10))
    top, place = re.findall(r"#(\d+)=CIRCLE\('',#(\d+),5\.0\);", text)[-1]
    z = re.search(rf"#{place}=AXIS2_PLACEMENT_3D\('',#\d+,#(\d+),#\d+\);", text).group(1)
    seam = re.search(r"#(\d+)=LINE\('',#\d+,#\d+\);", text).group(1)
    surface = re.search(r"#(\d+)=CYLINDRICAL_SURFACE\(", text).group(1)
    context = re.search(r"#(\d+)=\(GEOMETRIC_REPRESENTATION_CONTEXT", text).group(1)
    return text, top, z, seam, surface, context


def _reads_as_the_cylinder(text: str, kinds: list) -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # (nothing left out)
        part = from_step(text)
    assert part.is_valid() and part.volume == pytest.approx(math.pi * 25 * 10, rel=1e-9)
    assert sorted(e.geom_type for e in part.edges()) == sorted(kinds)


def test_step_offset_curves_are_read():
    # 0.5.0 left a body with an OFFSET_CURVE_3D out ("curve type OFFSET_CURVE_3D, which is not supported")
    text, top, z, _, _, _ = _cylinder_step()
    n = _next_id(text)
    # the top circle as the offset of a circle of radius 3 about the axis by 2 (tangent x axis points out)
    radius3 = re.sub(rf"#{top}=CIRCLE\('',(#\d+),5\.0\);",
                     rf"#{n}=CIRCLE('',\1,3.0);\n#{top}=OFFSET_CURVE_3D('',#{n},2.0,.F.,#{z});", text)
    _reads_as_the_cylinder(radius3, ["circle", "circle"])
    # its basis a rational B-spline circle of radius 3: the kernel's offset curve (SmOffsetCurve)
    w = math.sqrt(0.5)
    corners = [(3, 0), (3, 3), (0, 3), (-3, 3), (-3, 0), (-3, -3), (0, -3), (3, -3), (3, 0)]
    lines = [f"#{n + i}=CARTESIAN_POINT('',({x}.,{y}.,5.));" for i, (x, y) in enumerate(corners)]
    refs = ",".join(f"#{n + i}" for i in range(9))
    b = n + 9
    lines.append(f"#{b}=(BOUNDED_CURVE() B_SPLINE_CURVE(2,({refs}),.UNSPECIFIED.,.F.,.F.) B_SPLINE_CURVE_WITH_KNOTS("
                 f"(3,2,2,2,3),(0.,1.,2.,3.,4.),.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() "
                 f"RATIONAL_B_SPLINE_CURVE((1.,{w},1.,{w},1.,{w},1.,{w},1.)) REPRESENTATION_ITEM(''));")
    spline = _with(re.sub(rf"#{top}=CIRCLE\('',#\d+,5\.0\);", f"#{top}=OFFSET_CURVE_3D('',#{b},2.0,.F.,#{z});", text),
                   lines)
    _reads_as_the_cylinder(spline, ["circle", "bspline"])
    assert from_step_model(radius3).bodies[0].volume == pytest.approx(math.pi * 250, rel=1e-9)


def test_step_edges_given_as_pcurves_are_read():
    # 0.5.0 left a body with an edge given only as a PCURVE out
    text, top, _, seam, surface, context = _cylinder_step()

    def pcurve(old: str, rep: list) -> str:
        n = _next_id(text)
        body = [re.sub(r"\$(\d)", lambda m: str(n + int(m.group(1))), x) for x in rep]
        last = n + len(body) - 1
        new = re.sub(rf"#{old}=[A-Z_]+\([^;]*\);", f"#{old}=PCURVE('',#{surface},#{last + 1});", text, count=1)
        return _with(new, body + [f"#{last + 1}=DEFINITIONAL_REPRESENTATION('',(#{last}),#{context});"])

    # the top circle: the line v = 10 in the cylinder's parameters (its placement is at z = -5)
    _reads_as_the_cylinder(pcurve(top, ["#$0=CARTESIAN_POINT('',(0.,10.));", "#$1=DIRECTION('',(1.,0.));",
                                        "#$2=VECTOR('',#$1,1.);", "#$3=LINE('',#$0,#$2);"]), ["circle", "circle"])
    # the seam: the line u = 0 along v
    _reads_as_the_cylinder(pcurve(seam, ["#$0=CARTESIAN_POINT('',(0.,0.));", "#$1=DIRECTION('',(0.,1.));",
                                         "#$2=VECTOR('',#$1,1.);", "#$3=LINE('',#$0,#$2);"]), ["circle", "circle"])
    # the top circle as a B-spline in (u, v) from u = 0 to 2 pi at v = 10: a NURBS through its points
    _reads_as_the_cylinder(pcurve(top, ["#$0=CARTESIAN_POINT('',(0.,10.));",
                                        "#$1=CARTESIAN_POINT('',(3.14159265358979,10.));",
                                        "#$2=CARTESIAN_POINT('',(6.28318530717959,10.));",
                                        "#$3=B_SPLINE_CURVE_WITH_KNOTS('',2,(#$0,#$1,#$2),.UNSPECIFIED.,.F.,.F.,(3,3),"
                                        "(0.,1.),.UNSPECIFIED.);"]), ["circle", "bspline"])


def test_step_pcurves_on_bspline_surfaces_and_planes_are_read():
    # a box's edge as a line in the parameters of one of its faces: a B-spline surface
    text = to_step(Box(10, 10, 10).to_nurbs())
    s, p00, p01, p10, p11 = re.search(r"#(\d+)=B_SPLINE_SURFACE_WITH_KNOTS\('',1,1,\(\(#(\d+),#(\d+)\),\(#(\d+),#(\d+)\)\),"
                                      r"[^;]*\(0\.,10\.0\),\(0\.,10\.0\)", text).groups()
    edge = re.search(rf"#(\d+)=B_SPLINE_CURVE_WITH_KNOTS\('',1,\(#{p00},#{p10}\),[^;]*\(0\.,10\.0\)", text).group(1)
    context = re.search(r"#(\d+)=\(GEOMETRIC_REPRESENTATION_CONTEXT", text).group(1)
    n = _next_id(text)
    lines = [f"#{n}=CARTESIAN_POINT('',(0.,0.));", f"#{n + 1}=CARTESIAN_POINT('',(10.,0.));",
             f"#{n + 2}=B_SPLINE_CURVE_WITH_KNOTS('',1,(#{n},#{n + 1}),.UNSPECIFIED.,.F.,.F.,(2,2),(0.,10.),.UNSPECIFIED.);",
             f"#{n + 3}=DEFINITIONAL_REPRESENTATION('',(#{n + 2}),#{context});"]
    new = _with(re.sub(rf"#{edge}=B_SPLINE_CURVE_WITH_KNOTS\([^;]*\);", f"#{edge}=PCURVE('',#{s},#{n + 3});", text), lines)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        part = from_step(new)
    assert part.is_valid() and part.volume == pytest.approx(1000, rel=1e-9)
    # a plane: the box written with planes, an edge of its first face as a line in the plane's parameters
    text = to_step(Box(10, 10, 10))

    def vec(ref):
        found = re.search(rf"#{ref}=(?:CARTESIAN_POINT|DIRECTION)\('',\(([^)]*)\)\);", text)
        return np.array([float(x) for x in found.group(1).split(",")])

    face, bound, plane = re.search(r"#(\d+)=ADVANCED_FACE\('',\(#(\d+)\),#(\d+),", text).groups()
    place = re.search(rf"#{plane}=PLANE\('',#(\d+)\);", text).group(1)
    o, zd, xd = re.search(rf"#{place}=AXIS2_PLACEMENT_3D\('',#(\d+),#(\d+),#(\d+)\);", text).groups()
    origin, z, x = vec(o), vec(zd), vec(xd)
    y = np.cross(z, x)
    loop = re.search(rf"#{bound}=FACE_OUTER_BOUND\('',#(\d+),", text).group(1)
    first = re.search(rf"#{loop}=EDGE_LOOP\('',\(#(\d+)", text).group(1)
    edge = re.search(rf"#{first}=ORIENTED_EDGE\('',\*,\*,#(\d+),", text).group(1)
    v0, v1, line = re.search(rf"#{edge}=EDGE_CURVE\('',#(\d+),#(\d+),#(\d+),", text).groups()
    p0 = vec(re.search(rf"#{v0}=VERTEX_POINT\('',#(\d+)\);", text).group(1))
    p1 = vec(re.search(rf"#{v1}=VERTEX_POINT\('',#(\d+)\);", text).group(1))
    uv0, uv1 = [(float((p - origin) @ x), float((p - origin) @ y)) for p in (p0, p1)]
    d = [float(c) for c in np.subtract(uv1, uv0) / np.linalg.norm(np.subtract(uv1, uv0))]
    context = re.search(r"#(\d+)=\(GEOMETRIC_REPRESENTATION_CONTEXT", text).group(1)
    n = _next_id(text)
    lines = [f"#{n}=CARTESIAN_POINT('',({uv0[0]!r},{uv0[1]!r}));", f"#{n + 1}=DIRECTION('',({d[0]!r},{d[1]!r}));",
             f"#{n + 2}=VECTOR('',#{n + 1},1.);", f"#{n + 3}=LINE('',#{n},#{n + 2});",
             f"#{n + 4}=DEFINITIONAL_REPRESENTATION('',(#{n + 3}),#{context});"]
    new = _with(re.sub(rf"#{line}=LINE\([^;]*\);", f"#{line}=PCURVE('',#{plane},#{n + 4});", text), lines)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        part = from_step(new)
    assert part.is_valid() and part.volume == pytest.approx(1000, rel=1e-9)
    assert sorted(e.geom_type for e in part.edges()) == ["line"] * 12


# =============================================================================
# I10: placements that mirror or scale
# =============================================================================
def _operator_placement(scale: float, mirror: bool):
    """Two brackets in an assembly, the second placed by a CARTESIAN_TRANSFORMATION_OPERATOR_3D (a
    functionally defined transformation) 30 along x, mirrored in x and scaled as asked."""
    bracket = (Box(10, 4, 2) + Box(2, 4, 6).translate((4, 0, 4))).named("bracket")
    text = to_step([bracket, bracket], assembly=True, name="asm")
    last = re.findall(r"#(\d+)=ITEM_DEFINED_TRANSFORMATION", text)[-1]
    n = _next_id(text)
    extra = [f"#{n}=DIRECTION('',({-1.0 if mirror else 1.0},0.,0.));", f"#{n + 1}=DIRECTION('',(0.,1.,0.));",
             f"#{n + 2}=DIRECTION('',(0.,0.,1.));", f"#{n + 3}=CARTESIAN_POINT('',(30.,0.,0.));"]
    text = re.sub(rf"#{last}=ITEM_DEFINED_TRANSFORMATION\([^;]*\);",
                  f"#{last}=CARTESIAN_TRANSFORMATION_OPERATOR_3D('','',#{n},#{n + 1},#{n + 3},{scale!r},#{n + 2});", text)
    return bracket, _with(text, extra)


def test_step_assembly_placements_that_mirror_or_scale_are_read():
    # 0.5.0 left such instances out ("mirrored assembly placements are not supported yet")
    bracket, text = _operator_placement(1.0, True)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        a, b = from_step(text)
    expected = bracket.mirror(Plane.YZ).translate((30, 0, 0))
    assert b.is_valid() and b.volume == pytest.approx(bracket.volume, rel=1e-12) and b.name == "bracket"
    assert (b.bbox().min - expected.bbox().min).length < 1e-9 and (b.bbox().max - expected.bbox().max).length < 1e-9
    assert (b - expected).volume == pytest.approx(0, abs=1e-6)
    assert a.volume == pytest.approx(bracket.volume, rel=1e-12)
    bracket, text = _operator_placement(2.0, False)
    a, b = from_step(text)
    assert b.is_valid() and b.volume == pytest.approx(8 * bracket.volume, rel=1e-9)
    assert b.bbox().size.to_tuple() == pytest.approx((20, 8, 16))


# =============================================================================
# I11: an offset of a whole sphere
# =============================================================================
@pytest.mark.parametrize("radius, distance", [(8.0, 2.0), (12.0, -2.0)])
def test_step_offset_of_a_whole_sphere_imports(radius, distance):
    # a sphere written as an OFFSET_SURFACE of another sphere (0.5.0: "import STEP failed": the kernel
    # cannot close a solid of an offset face with the sphere's seam and poles); it is the sphere of
    # radius r + d
    text = to_step(Sphere(10))
    ref, place = re.search(r"#(\d+)=SPHERICAL_SURFACE\('',#(\d+),10\.0\);", text).groups()
    n = _next_id(text)
    text = text.replace(f"#{ref}=SPHERICAL_SURFACE('',#{place},10.0);",
                        f"#{n}=SPHERICAL_SURFACE('',#{place},{radius});\n#{ref}=OFFSET_SURFACE('',#{n},{distance},.F.);")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        part = from_step(text)
    assert part.is_valid() and part.volume == pytest.approx(Sphere(10).volume, rel=1e-9)
    assert [f.geom_type for f in part.faces()] == ["sphere"]


# =============================================================================
# X14: .brep tolerances
# =============================================================================
def _tolerances(text: str) -> dict:
    lines = text.split("\n")
    return {kind: sorted({float(lines[i + 1].split()[1 if kind == "Fa" else 0]) for i, x in enumerate(lines) if x == kind})
            for kind in ("Ed", "Ve", "Fa")}


def test_brep_bodies_with_one_tolerance_longer_than_an_edge_read_back():
    # The bridge gave every edge, vertex and face of a body the largest tolerance of the file: an edge
    # shorter than it (a chamfer of 0.007 here, fillet edges of 0.005 in 4 of 557 corpus solids) read
    # back refused ("an edge of length -0.00293 ... its curve does not run from its start to its end").
    part = Box(10, 10, 10)
    part = part.chamfer(part.edges().sort_by(Z)[-1], 0.005)
    lines = to_brep(part).split("\n")
    for i in range(len(lines) - 1):  # (every tolerance 0.02, as such a file has them)
        if lines[i] in ("Ed", "Ve", "Fa"):
            parts = lines[i + 1].split()
            parts[1 if lines[i] == "Fa" else 0] = "0.02"
            lines[i + 1] = " ".join(parts)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        back = from_brep("\n".join(lines))
    assert back.is_valid() and back.volume == pytest.approx(part.volume, rel=1e-9)


def test_brep_writer_gives_each_edge_its_own_tolerance():
    # one corner of a box's STEP file moved 0.004 along x, off two of its edges: only those edges and the
    # vertices there get a tolerance that covers it (0.5.0 wrote the body's largest, 0.016, for every edge, vertex and face)
    text = to_step(Box(10, 10, 10))
    corner = re.search(r"#(\d+)=CARTESIAN_POINT\('',\(5\.0,5\.0,5\.0\)\);", text)
    text = text.replace(corner.group(0), f"#{corner.group(1)}=CARTESIAN_POINT('',(5.004,5.0,5.0));")
    part = from_step(text)
    brep = to_brep(part)
    tol = _tolerances(brep)
    assert tol["Fa"] == [pytest.approx(2e-5)]
    assert min(tol["Ed"]) == pytest.approx(2e-5) and 0.004 < max(tol["Ed"]) < 0.016
    lines = brep.split("\n")
    assert sum(1 for i, x in enumerate(lines) if x == "Ed" and float(lines[i + 1].split()[0]) > 1e-4) == 2
    assert _occt_text_check(brep) == []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # (the corner's gap is reported)
        back = from_brep(brep)
        assert back.is_valid() and back.volume == pytest.approx(part.volume, rel=1e-9)
    # a part of smlibpy's own: every tolerance the one of its size
    assert all(v == [pytest.approx(2e-5)] for v in _tolerances(to_brep(Box(10, 10, 10))).values())
