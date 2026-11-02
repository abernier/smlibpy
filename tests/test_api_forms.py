"""The forms of the API (AGENTS.md, "The API"): every operation of a body is a method and a function.

An operation makes a new body, or new geometry, from a body: a feature, a Boolean, an edit, a
deformation, a sweep of a sketch, a section. It is a method of each body class it works on and a
function of the package of the same name and parameters, which takes the body first (``fillet``,
``chamfer`` and ``fillet_preview`` take the edges and find their part, as build123d's ``fillet``
does). Selections, measurements, placing, attributes and conversions stay methods; what makes a
shape from several inputs or reads and writes files stays a function.

Every public method of Part, Shell and Sketch and every function of the package is listed below
under what it is: a new one fails here until it is, so that adding one means deciding its form.
"""

import inspect
import pkgutil

import pytest
from pytest import approx

import smlibpy
from smlibpy import *

BODIES = (Part, Shell, Sketch)

OPERATIONS = {
    "fillet", "chamfer", "fillet_preview", "shell", "offset", "thicken", "draft",
    "fuse", "cut", "intersect", "xor", "merge", "split", "imprint",
    "move_faces", "offset_faces", "remove_faces", "remove_fillets",
    "push", "warp", "flatten", "extend", "trim", "match_edge", "merge_faces",
    "twist", "taper", "bend", "unroll", "deform",
    "fold", "flange", "unfold", "flat_pattern",
    "extrude", "revolve", "sweep", "swing",
    "section", "project", "outline", "silhouette", "intersection_curves", "parting_line", "slices",
    "mirror", "scale",
}
# The function takes the edges (vertices of a sketch: fillet, chamfer) and finds their body.
SELECTION_FIRST = {"fillet", "chamfer", "fillet_preview"}
# Functions over shapes whose methods take different parameters: typed overloads, the keywords
# passed on (``offset`` of a part takes ``corners``, of an edge ``plane``). Each method's keywords
# must reach it.
DISPATCHERS = {"fillet", "chamfer", "offset", "extend", "trim", "project"}
# The function takes the parts as one list of operands: ``merge(a, b, c)`` is ``a.merge(b, c)``.
OPERANDS = {"merge"}
# A function that takes more kinds of shape than have the method: the profile of a sweep may be a
# face, a wire or an edge, a deformation also takes curves and points.
WIDER = {"extrude", "revolve", "sweep", "swing", "twist", "taper", "bend", "unroll", "deform", "thicken", "mirror",
         "scale", "slices", "flat_pattern"}

METHODS_ONLY = {
    "selection and topology": {"faces", "edges", "wires", "vertices", "shells", "solids", "voids", "cells", "cell_at"},
    "measuring and checking": {"bbox", "center", "mass_properties", "section_properties", "info", "is_valid", "check",
                               "distance_to", "closest_point", "closest_points", "classify", "contains", "raycast",
                               "raycast_many", "draft_analysis", "bends"},
    "placing (and Location algebra: Pos(...) * part)": {"moved", "translate", "rotate", "on"},
    "attributes": {"named", "colored"},
    "representation": {"to_nurbs", "mesh", "flipped", "heal", "compact"},
    "files and the viewer, which are functions of their own": {"export", "show"},
    "constructors": {"from_mesh", "from_nurbs"},
}

FUNCTIONS_ONLY = {
    "makers of shapes from several inputs": {"loft", "blend", "fill", "network", "surface", "nurbs_surface", "ruled",
                                             "stitch", "surface_fillet", "fit_curve", "make_compatible", "make_face",
                                             "drawing_views", "machining_setup", "tessellate"},
    "sheet metal numbers": {"bend_allowance", "bend_deduction", "developed_length"},
    "files": {"export", "export_step", "export_stl", "export_glb", "export_gltf", "export_obj", "export_dxf",
              "export_usd", "export_brep", "export_svg", "save", "load", "import_stl", "import_step", "import_iges",
              "import_dxf", "import_dxf_wires", "import_usd", "import_brep", "read_step", "to_step", "from_step",
              "from_step_model", "to_stl", "from_stl", "to_obj", "to_glb", "to_gltf", "to_smb", "from_smb", "to_smp",
              "from_smp", "to_dxf", "from_dxf", "from_dxf_wires", "to_usd", "from_usd", "from_iges", "to_brep",
              "from_brep", "to_svg", "to_file", "from_file"},
    "pictures and the viewer": {"show", "render", "diff_images"},
}


def _public_methods(cls):
    out = {}
    for name in dir(cls):
        if name.startswith("_"):
            continue
        raw = inspect.getattr_static(cls, name)
        if isinstance(raw, property) or not callable(getattr(cls, name)):
            continue
        out[name] = getattr(cls, name)
    return out


def _functions():
    return {n: getattr(smlibpy, n) for n in smlibpy.__all__
            if callable(getattr(smlibpy, n)) and not inspect.isclass(getattr(smlibpy, n)) and not n[0].isupper()}


def _params(fn, skip):
    return [(p.name, p.kind, p.default) for p in list(inspect.signature(fn).parameters.values())[skip:]]


def test_every_method_of_a_body_is_classified():
    listed = OPERATIONS.union(*METHODS_ONLY.values())
    for cls in BODIES:
        unlisted = sorted(set(_public_methods(cls)) - listed)
        assert not unlisted, (f"{cls.__name__} has methods tests/test_api_forms.py does not list: {unlisted}. An "
                              f"operation is also a function (AGENTS.md, 'The API'); list it under OPERATIONS, or "
                              f"say what it is in METHODS_ONLY")


def test_every_function_is_classified():
    listed = OPERATIONS.union(*FUNCTIONS_ONLY.values())
    unlisted = sorted(set(_functions()) - listed)
    assert not unlisted, (f"smlibpy exports functions tests/test_api_forms.py does not list: {unlisted}. An operation "
                          f"of a body is also a method (AGENTS.md, 'The API'); list it under OPERATIONS, or say what "
                          f"it is in FUNCTIONS_ONLY")
    for kind, names in FUNCTIONS_ONLY.items():
        assert not names & OPERATIONS, kind
        missing = sorted(n for n in names if n not in smlibpy.__all__)
        assert not missing, f"{kind}: not exported: {missing}"


@pytest.mark.parametrize("name", sorted(OPERATIONS))
def test_every_operation_is_a_method_and_a_function(name):
    assert name in smlibpy.__all__, f"{name} is an operation of a body but not a function of smlibpy"
    owners = [cls for cls in BODIES if name in _public_methods(cls)]
    assert owners, f"{name} is a function of smlibpy but no method of Part, Shell or Sketch"


@pytest.mark.parametrize("name", sorted(OPERATIONS - DISPATCHERS - OPERANDS))
def test_the_function_takes_the_methods_parameters(name):
    fn = getattr(smlibpy, name)
    skip = 0 if name in SELECTION_FIRST else 1  # (the body, or nothing where the edges come first)
    for cls in BODIES:
        method = _public_methods(cls).get(name)
        if method is None:
            continue
        theirs, its = _params(fn, skip), _params(method, 1)
        if name in WIDER:  # (keywords only the other kinds take may follow: sweep's rails, for an open profile)
            extra = [p for p in theirs if p not in its]
            theirs = [p for p in theirs if p in its]
            assert all(kind is inspect.Parameter.KEYWORD_ONLY for _, kind, _ in extra), (name, extra)
        assert theirs == its, (
            f"{name}{inspect.signature(fn)} and {cls.__name__}.{name}{inspect.signature(method)} take different "
            f"parameters: the function takes the body first, then the method's parameters")


@pytest.mark.parametrize("name", sorted(DISPATCHERS))
def test_a_dispatching_function_passes_every_methods_keywords_on(name):
    fn_params = inspect.signature(getattr(smlibpy, name)).parameters
    passes_on = any(p.kind is p.VAR_KEYWORD for p in fn_params.values())
    for cls in (*BODIES, Face, Edge, Wire):
        method = _public_methods(cls).get(name)
        if method is None:
            continue
        keywords = {p.name for p in inspect.signature(method).parameters.values() if p.kind is p.KEYWORD_ONLY}
        assert passes_on or keywords <= set(fn_params), (name, cls.__name__, keywords - set(fn_params))


def test_merge_takes_its_operands_as_the_method_does():
    a, b, c = Box(10, 10, 10), Box(10, 10, 10).translate(5, 0, 0), Box(10, 10, 10).translate(0, 5, 0)
    assert merge(a, b, c).volume == approx(a.merge(b, c).volume)
    assert merge([a, b, c]).volume == approx(a.merge([b, c]).volume)


def test_no_module_takes_the_name_of_a_public_name():
    # A function and a module of one name are one attribute of the package: `import smlibpy.draft as d`
    # would give the function. The modules' old names (deform, draft, render) stay importable.
    modules = {m.name for m in pkgutil.iter_modules(smlibpy.__path__)}
    assert not modules & set(smlibpy.__all__), sorted(modules & set(smlibpy.__all__))
    from smlibpy.deform import Lattice as old_lattice
    from smlibpy.draft import DraftAnalysis
    from smlibpy.render import Picture

    assert old_lattice is Lattice
    assert DraftAnalysis.__module__ == "smlibpy.molding" and Picture.__module__ == "smlibpy.pictures"
    assert callable(smlibpy.draft) and callable(smlibpy.deform) and callable(smlibpy.render)


# -- the function gives what the method gives ---------------------------------------------------------
def _box():
    return Box(40, 30, 20)


def _sheet():
    """A curved sheet (the guides' parabola)."""
    return surface([[(x, y, 0.02 * (x - 20) ** 2) for y in range(0, 41, 10)] for x in range(0, 41, 10)])


def _dome():
    return surface([[(x, y, 8 - 0.01 * ((x - 20) ** 2 + (y - 20) ** 2)) for y in range(0, 41, 5)]
                    for x in range(0, 41, 5)])


def _measure(shape):
    """A body's volume or area, a curve's length; a list of them for a list."""
    if isinstance(shape, (list, tuple)):
        return [_measure(s) for s in shape]
    return shape.volume if isinstance(shape, Part) else shape.area if isinstance(shape, Shell) else shape.length


def _warp_args():
    sheet = _sheet()
    rim = sheet.project(Rectangle(16, 10).translate(20, 20).on(Plane.XY.offset(30)).faces()[0].outer_wire(), (0, 0, -1))
    return sheet, sheet.faces()[0], Wire(rim), -1.5


def _flatten_args():
    dome = _dome()
    face = dome.faces()[0]
    seat = [face.raycast((x, y, 50), (0, 0, -1))[0].point for x, y in ((15, 15), (25, 15), (25, 25), (15, 25))]
    return dome, face, seat, Plane.XY.offset(7.5)


# name -> (the body and the method's positional arguments, its keywords)
EXAMPLES = {
    "fuse": lambda: ((_box(), Cylinder(5, 40)), {}),
    "cut": lambda: ((_box(), Cylinder(5, 40)), {}),
    "intersect": lambda: ((_box(), Cylinder(5, 40)), {}),
    "xor": lambda: ((Rectangle(20, 10), Circle(6)), {}),
    "imprint": lambda: ((_box(), Cylinder(5, 40)), {}),
    "draft": lambda: ((b := _box(), b.faces().filter(lambda f: abs(f.normal_at().z) < 1e-9), 3, Plane.XY), {}),
    "move_faces": lambda: ((b := _box(), b.faces().sort_by(X)[-1], (5, 0, 0)), {}),
    "offset_faces": lambda: ((b := _box(), b.faces().sort_by(X)[-1], 2), {}),
    "remove_faces": lambda: ((b := _box() - Cylinder(5, 40), b.faces().cylinders()), {}),
    "remove_fillets": lambda: ((_box().fillet(_box().edges().parallel_to(Z), 3),), {}),
    "push": lambda: ((b := Box(60, 40, 6), b.faces().sort_by(Z)[-1], (15, 0, 3)), {"by": -1.5, "radius": 10}),
    "warp": lambda: (_warp_args(), {}),
    "flatten": lambda: (_flatten_args(), {}),
    "extend": lambda: ((_sheet(), 6), {}),
    "trim": lambda: ((Line((0, 0), (10, 0)), 0.2, 0.7), {}),
    "project": lambda: ((_box(), Circle(5).edges()[0].translate(0, 0, 30)), {}),
    "outline": lambda: ((_box(),), {}),
    "silhouette": lambda: ((Sphere(5),), {}),
    "intersection_curves": lambda: ((_box(), Plane.XY), {}),
    "parting_line": lambda: ((Sphere(5), Z), {}),
    "slices": lambda: ((_box(), 5), {}),
    "scale": lambda: ((_box(), 2), {}),
    "deform": lambda: ((b := _box(), Lattice(b.bbox())), {}),
}


@pytest.mark.parametrize("name", sorted(EXAMPLES))
def test_the_function_gives_what_the_method_gives(name):
    (shape, *rest), keywords = EXAMPLES[name]()
    by_function = getattr(smlibpy, name)(shape, *rest, **keywords)
    by_method = getattr(shape, name)(*rest, **keywords)
    assert type(by_function) is type(by_method)
    assert _measure(by_function) == approx(_measure(by_method), rel=1e-9)


def test_fillet_preview_takes_the_edges_as_fillet_does():
    box = _box()
    edges = box.edges().parallel_to(Z)
    assert [s.area for s in fillet_preview(edges, 3)] == approx([s.area for s in box.fillet_preview(edges, 3)])


def test_a_function_says_what_it_takes():
    with pytest.raises(TypeError, match="draft takes a part, not a Sketch"):
        draft(Rectangle(5, 5), [], 3, Plane.XY)
    with pytest.raises(TypeError, match="deform takes a Lattice"):
        deform(_box(), 3)
    with pytest.raises(TypeError, match="xor takes a sketch"):
        xor(_box(), _box())
    with pytest.raises(TypeError, match=r"split takes a part, not a Edge \(an edge or a wire splits with edge.split"):
        split(Line((0, 0), (10, 0)), 0.3)
    with pytest.raises(TypeError, match="mirror takes a shape, not a str"):
        mirror("abc")
    with pytest.raises(TypeError, match="section takes a part or a mesh, not a str"):
        section("abc")
    with pytest.raises(TypeError, match="cannot use tuple as a plane"):
        outline(_box(), (0, 0, 1))


def test_sheets_and_sketches_have_their_booleans_by_name():
    a, b = Rectangle(20, 10), Circle(6)
    assert a.fuse(b).area == approx((a + b).area) and a.cut(b).area == approx((a - b).area)
    assert a.intersect(b).area == approx((a & b).area) and a.xor(b).area == approx((a ^ b).area)
    assert isinstance(a.fuse(b), Sketch) and isinstance(a.xor(b, Circle(3).translate(15, 0, 0)), Sketch)
    sheet = Rectangle(40, 30).extrude(1).faces().top()[0].to_shell()
    tool = Cylinder(5, 40)
    assert sheet.cut(tool).area == approx((sheet - tool).area)
    assert sheet.intersect(tool).area == approx((sheet & tool).area)
    assert sheet.fuse(sheet.translate(0, 30, 0)).area == approx((sheet + sheet.translate(0, 30, 0)).area)


# -- signatures (AGENTS.md, "The API": parameters) ------------------------------------------------
# Functions whose keywords depend on what they are given: a dispatcher over shapes (its overloads
# list each one's), or a writer that picks the format by the file's extension.
TAKES_ANY_KEYWORDS = DISPATCHERS | {"export", "to_file", "Shape.export", "Mesh.export"}
# String parameters that hold text, not one of some choices.
FREE_TEXT = {"name", "title", "path", "text", "font", "label", "product", "color", "edge_color", "background"}
# build123d's sort_by(axis, reverse) takes the flag second, as sorted() its key.
POSITIONAL_FLAGS = {"ShapeList.sort_by(reverse)", "ShapeList.sort_by_distance(reverse)"}


def _api():
    """{name: function} of every public function of smlibpy and method of its classes (by the class
    that defines it: ``Shape.export``, ``_Body.edges``)."""
    out = {n: f for n, f in _functions().items()}
    for n in smlibpy.__all__:
        o = getattr(smlibpy, n)
        if not inspect.isclass(o):
            continue
        for cls in o.__mro__:
            if not cls.__module__.startswith("smlibpy"):
                continue
            for m, v in vars(cls).items():
                v = v.__func__ if isinstance(v, (staticmethod, classmethod)) else v
                if not m.startswith("_") and inspect.isfunction(v):
                    out.setdefault(f"{cls.__name__}.{m}", v)
    return out


def test_every_function_method_and_property_says_what_it_does():
    bare = []
    for n in smlibpy.__all__:
        o = getattr(smlibpy, n)
        members = [(m, getattr(o, m)) for m in dir(o) if not m.startswith("_")] if inspect.isclass(o) else []
        for name, member in [(n, o), *((f"{n}.{m}", v) for m, v in members)]:
            if callable(member) or isinstance(inspect.getattr_static(o, name.rpartition(".")[2], None), property):
                if not (inspect.getdoc(member) or "").strip():
                    bare.append(name)
    assert not bare, f"describe_method and the API docs show the docstring; these have none: {sorted(set(bare))}"


def test_keywords_are_in_the_signature():
    hidden = sorted(k for k, f in _api().items() if k not in TAKES_ANY_KEYWORDS
                    and any(p.kind is p.VAR_KEYWORD for p in inspect.signature(f).parameters.values()))
    assert not hidden, (f"these take **kwargs: name the keywords (the docs, describe_method and smlibwasm's options "
                        f"table read them from the signature): {hidden}")


def test_options_name_their_choices():
    untyped = sorted(f"{k}({p.name})" for k, f in _api().items() for p in inspect.signature(f).parameters.values()
                     if isinstance(p.default, str) and p.name not in FREE_TEXT and "Literal[" not in str(p.annotation))
    assert not untyped, f"type these options as Literal[...] of their choices: {untyped}"


def test_describe_method_shows_the_choices():
    from smlibpy.mcp.discovery import _signature

    assert _signature("Part.offset", Part.offset) == "Part.offset(distance, *, corners: 'sharp' | 'round' = 'sharp')"
    assert _signature("Part.shell", Part.shell).endswith("corners: 'round' | 'sharp' | None = None, walls=None)")
    assert _signature("Vector.is_close", Vector.is_close) == "Vector.is_close(other, tolerance=1e-06)"


def test_flags_are_keywords():
    positional = sorted(f"{k}({p.name})" for k, f in _api().items() for p in inspect.signature(f).parameters.values()
                        if p.kind is p.POSITIONAL_OR_KEYWORD and isinstance(p.default, bool))
    assert set(positional) == POSITIONAL_FLAGS, \
        f"make these keyword-only (after *): {set(positional) - POSITIONAL_FLAGS}"


def test_renamed_keywords_still_work_with_a_warning():
    with pytest.warns(DeprecationWarning, match="tol= is tolerance= since smlibpy 0.6.0"):
        assert Vector(1, 0, 0).is_close((1, 0, 1e-7), tol=1e-6)
    with pytest.warns(DeprecationWarning, match="angle_tol= is angle_tolerance="):
        assert Box(10, 10, 10).edges()[0].continuity(angle_tol=1).level == "G0"
    with pytest.warns(DeprecationWarning, match="round= is corners="):
        assert Rectangle(20, 10).offset(1, round=False).area == approx(22 * 12)
    with pytest.raises(TypeError, match="pass tolerance= alone"):
        Vector(1, 0, 0).is_close((1, 0, 0), tol=1, tolerance=1)
    assert list(inspect.signature(Vector.is_close).parameters) == ["self", "other", "tolerance"]
    assert "round" not in inspect.signature(Sketch.offset).parameters


def test_flags_made_keyword_only_still_work_by_position_with_a_warning():
    pipe = Cylinder(5, 10)
    with_seams = len(pipe.edges(seams=True))
    assert with_seams > len(pipe.edges())  # (the seam of the cylinder)
    with pytest.warns(DeprecationWarning, match=r"pass seams= by name \(seams is keyword-only since smlibpy 0.6.0\)"):
        assert len(pipe.edges(True)) == with_seams
    side = pipe.faces().cylinders().one()
    with pytest.warns(DeprecationWarning, match="pass seams= by name"):
        assert len(side.edges(True)) == len(side.edges(seams=True)) > len(side.edges())
    with pytest.raises(TypeError, match="seams given twice"):
        pipe.edges(True, seams=True)
    with pytest.raises(TypeError, match="positional argument"):
        pipe.edges(True, False)
    params = inspect.signature(Part.edges).parameters  # (the signature shows the new form only)
    assert list(params) == ["self", "seams"] and params["seams"].kind is inspect.Parameter.KEYWORD_ONLY
