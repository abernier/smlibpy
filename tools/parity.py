"""Golden files of smlibpy for smlibwasm's parity test (kernel plan N5).

smlibwasm's tests are ports of smlibpy's, with the same numbers. What they did not compare is the
text of the file writers that the port has its own copy of (STEP, DXF, OBJ, glTF, STL and the USD
of several bodies), which only Python's tests read back with OpenCASCADE. This writes, into
``tests/data/parity``:

- the bodies the writers get (``plate.smb``, ``ball.smb``: exact, and read the same by both
  builds), so that a difference in what they write is one of the writers, not of the kernel's
  arithmetic in the two builds;
- what smlibpy's writers make of them (``parts.step``, ``parts.usda``, ``sketch.dxf``,
  ``box.obj``, ``box.gltf``, ``box.stl``, ``box.usda``);
- ``golden.json``: numbers of some modelling steps (volumes, areas, counts, errors), and the known
  divergences of the builds: what smlibwasm gives there, and why. ``cases`` holds the steps of 0.4
  and the first ones of 0.5, ``capabilities`` one or more steps of each capability that phase 1 of
  the kernel plan added (B11 to X14, their names in :func:`capabilities`), which
  ``js/test/closeout_W.test.ts`` makes with smlibwasm.

``js/test/lane_WN.test.ts`` makes the same with smlibwasm and compares: text token by token
(:func:`same_text`), glTF as JSON, numbers to 1e-7 of their size, counts and errors exactly.
(The native build for arm64 contracts ``a * b + c`` into one instruction, which the WebAssembly
build cannot: the last bits of their results differ, and now and then an operation succeeds in
one and fails in the other; ``KNOWN`` has those.) ``tests/test_lane_WN.py`` checks that the files
are current.

usage: python tools/parity.py [--update]
Without ``--update`` it compares smlibpy's results with the files and exits with 1 on a difference.
"""

from __future__ import annotations

import json
import platform
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = ROOT / "tests" / "data" / "parity"
TEST_FILES = ROOT / "third_party" / "usd-brep" / "TestFiles" / "pt_TestFiles" / "Fillet"


def _beside(relative: str) -> Path:
    """A file outside the repository, in a folder beside it or beside one of its parents (where it is
    checked out next to the ClassCAD data and the model corpus); cases that need one run where it is."""
    return next((p / relative for p in ROOT.parents if (p / relative).is_file()), ROOT / "missing" / relative)


DXF_19 = _beside("classcad/data/Test/Input/BugReporting/CAD-3602/yon002k7.dxf")
VALVE = _beside("models/solid/Ventil.stp")
#: The files the writers make, and how each is compared.
FILES = {"parts.step": "text", "parts.usda": "text", "sketch.dxf": "text", "box.obj": "text", "box.gltf": "json",
         "box.stl": "text", "box.usda": "text"}
#: How close numbers must be: of the modelling steps, and in the files.
REL, ABS = 1e-7, 1e-9
TEXT_ABS = 1e-9
FMA = platform.machine().lower() in ("arm64", "aarch64")

#: Where smlibwasm gives another result than smlibpy (on darwin-arm64, where the golden files are
#: made), what it gives, and why. ``fma``: the cause is the native arm64 build's contraction of
#: ``a * b + c`` (a native build with ``-ffp-contract=off`` gives smlibwasm's result); x86_64
#: builds, which do not contract, are expected to give smlibwasm's result too.
KNOWN: dict[str, dict[str, Any]] = {
    "vase1 fillet": {
        "fma": True,
        "wasm": {"error": "KernelError", "status": "SM_ERR"},
        "why": "W16: the all-edge fillet of usd-brep's vase1.smb. Without the contraction the kernel's drop of a "
               "corner's guess point onto the filleted edge finds not one point (SmFilletStandardSolver.cpp:558, "
               "LoadInitialValues, from CalcCornerVertGeom), and the fillet fails",
    },
    "vase3 fillet": {
        "fma": True,
        "wasm": {"error": "KernelError", "status": "SM_ERR"},
        "why": "W16: as vase1",
    },
    "dxf 19": {
        "fma": False,
        "wasm": {"area": 55817.336, "faces": 2, "holes": [0, 8]},
        "why": "ai/todo/files.md #19: the kernel nests the same 10 B-spline loops differently in the two builds; "
               "both are wrong (one face with 9 holes, about 55732.3)",
    },
}


def _body(b: Any) -> dict[str, Any]:
    box = b.bbox()
    return {"volume": b.volume, "area": b.area, "faces": len(b.faces()), "edges": len(b.edges()),
            "valid": b.is_valid(), "bbox": [*box.min.to_tuple(), *box.max.to_tuple()]}


def _sketch(s: Any) -> dict[str, Any]:
    return {"area": s.area, "faces": len(s.faces())}


def models() -> dict[str, Any]:
    """The bodies and the sketch the writers get, as smlibpy builds them (plate and ball are written
    as .smb files and read back from them)."""
    from smlibpy import Box, Circle, Cylinder, Ellipse, GridLocations, Polygon, Rectangle, Sphere, Text, Z

    plate = Box(80, 60, 10)
    plate = plate.fillet(plate.edges().parallel_to(Z), 8)
    plate = plate - GridLocations(60, 40, 2, 2) * Cylinder(4, 10)
    sketch = (Rectangle(40, 20, fillet=3) - Circle(4) - Polygon((10, -5), (15, -5), (12, 5))
              + Ellipse(6, 3).translate(35, 0) + Text("S", 10).translate(-35, 0))
    return {"plate": plate, "ball": Sphere(5).translate((100, 0, 0)), "sketch": sketch,
            "box": Box(30, 20, 10).named("box").colored("steelblue")}


def write_files(folder: Path, bodies: Path | None = None) -> None:
    """What smlibpy's writers make of the models, into ``folder`` (with the two .smb files). With
    ``bodies``, a folder that has the .smb files already (the golden one), the plate and the ball are
    read from there and not made again, as smlibwasm's test reads them: on a platform other than the
    golden files' the plate comes out a little different (the arm64 build's contraction of
    ``a * b + c``, see KNOWN), and so does the text of the files."""
    from smlibpy import export_dxf, export_gltf, export_obj, export_step, export_stl, export_usd, load, save

    m = models()
    if bodies is None:
        save(m["plate"], folder / "plate.smb", ascii=False)
        save(m["ball"], folder / "ball.smb", ascii=False)
        bodies = folder
    plate = load(bodies / "plate.smb").named("plate").colored((0.8, 0.3, 0.2))
    ball = load(bodies / "ball.smb").named("ball")
    export_step([plate, ball], folder / "parts.step", name="parts")
    export_usd([plate, ball], folder / "parts.usda", mesh=False)
    export_dxf(m["sketch"], folder / "sketch.dxf")
    export_obj(m["box"], folder / "box.obj")
    export_gltf(m["box"], folder / "box.gltf")
    export_stl(m["box"], folder / "box.stl", ascii=True)
    export_usd(m["box"], folder / "box.usda")


def cases() -> dict[str, Callable[[], dict[str, Any]]]:
    """The modelling steps whose numbers both builds must give (js/test/lane_WN.test.ts has the same
    under the same names)."""
    from smlibpy import (X, Y, Z, Box, Circle, Cone, Cylinder, GridLocations, Location, Plane, Polygon, Rectangle,
                         Sphere, Text, import_dxf, import_step, load, loft, split)

    def plate():
        p = Box(80, 60, 10)
        p = p.fillet(p.edges().parallel_to(Z), 8)
        return p - GridLocations(60, 40, 2, 2) * Cylinder(4, 10)

    def xor():
        abc = Circle(5) ^ Circle(5).translate(4, 0) ^ Circle(5).translate(2, 4)
        t = Polygon((-20, -20), (20, -20), (0, 20))
        return {"xor": _sketch(abc ^ t), "and": _sketch(abc & t), "cut": _sketch(abc - t), "txor": _sketch(t ^ abc)}

    def vase(name):
        def run():
            p = load(TEST_FILES / f"{name}.smb")
            return _body(p.fillet(p.edges(), 0.2))
        return run

    def dxf19():
        d = import_dxf(DXF_19)
        return {"area": round(d.area, 4), "faces": len(d.faces()), "holes": sorted(len(f.inner_wires()) for f in d.faces())}

    def valve():
        v = import_step(VALVE)
        return {"convex": len(v.edges().convex()), "concave": len(v.edges().concave()), "smooth": len(v.edges().smooth())}

    rounded = lambda: Box(20, 20, 20).fillet(Box(20, 20, 20).edges().parallel_to(Z), 3)  # noqa: E731
    out: dict[str, Callable[[], dict[str, Any]]] = {
        "plate": lambda: {**_body(plate()), "triangles": len(plate().mesh().triangles),
                          "concave": len(plate().edges().concave()), "top": plate().faces().top()[0].area},
        "rounded box": lambda: _body(Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)),
        "chamfered box": lambda: _body(Box(20, 20, 20).chamfer(Box(20, 20, 20).faces().top()[0].edges(), 2)),
        "cup": lambda: _body(Box(30, 30, 30).shell(2, Box(30, 30, 30).faces().top())),
        "offset": lambda: _body(Box(10, 10, 10).offset(2)),
        "split": lambda: {"volumes": [p.volume for p in split(Box(10, 10, 10).rotate(X, 30), Plane.XY, "both")]},
        "loft": lambda: _body(loft([Circle(5), Rectangle(6, 6).moved(Location((0, 0, 10)))])),
        "twist": lambda: _body(Box(20, 20, 100).twist(90)),
        "cells": lambda: {"volumes": sorted(c.volume for c in Box(10, 10, 10).merge(Sphere(4).translate((0, 0, 5))).cells())},
        "void": lambda: {"volume": (Box(20, 20, 20) - Box(10, 10, 10)).volume,
                         "solids": len((Box(20, 20, 20) - Box(10, 10, 10)).solids()),
                         "apart": sorted(s.volume for s in (Box(5, 5, 5) + Box(5, 5, 5).translate((20, 0, 0))).solids())},
        "remove fillets": lambda: _body(rounded().remove_fillets()),
        "xor": xor,
        "text": lambda: _sketch(Text("Ab", 10)),
        "cone cylinder merge": lambda: {k: v for k, v in _body(Cone(3, 0, 4).rotate(X, 90).merge(
            Cylinder(1.5, 16).rotate(Y, 90).translate((-5, 0, 3)))).items() if k in ("volume", "faces", "valid")},
    }
    if TEST_FILES.is_dir():
        out["vase1 fillet"] = vase("vase1")
        out["vase3 fillet"] = vase("vase3")
    if DXF_19.is_file():
        out["dxf 19"] = dxf19
    if VALVE.is_file():
        out["valve convexity"] = valve
    return out


def capabilities() -> dict[str, Callable[[], Any]]:
    """A step or more of each capability phase 1 of the kernel plan added, by its item (B11 ... D3):
    numbers both builds must give (``js/test/closeout_W.test.ts`` has the same under the same
    names). Mesh decimation to a tolerance is left out: the kernel orders equal choices by memory,
    so its count differs from run to run (608 or 628 triangles here, 686 in smlibwasm)."""
    import math

    from smlibpy import (Z, AnnularSector, Axis, Box, Circle, Cone, ConicArc, Cylinder, Helix, Line, Location, Plane,
                         Polyline, Rectangle, Sphere, Spiral, Spline, Torus, bend_allowance, blend, drawing_views, fill,
                         fit_curve, flat_pattern, network, ruled, stitch, surface, sweep, swing, thicken, unroll)

    def sheet():
        return Rectangle(20, 20).faces()[0].to_shell()

    def pick(record, *keys):
        return {k: record[k] for k in keys}

    def bump():  # (a sheet across a box, for split)
        return surface([[(-15 + 10 * i, -15 + 10 * j, 3 * math.sin(i + j)) for j in range(4)] for i in range(4)])

    def rounded():
        return Box(20, 20, 10).fillet(Box(20, 20, 10).edges().parallel_to(Z), 3)

    def arc():
        return Spline((0, 0, 0), (5, 3, 0), (10, 0, 0))

    def bridge():  # (two strips, for blend)
        a = ruled(Line((0, 0, 0), (10, 0, 0)), Line((0, 5, 0), (10, 5, 0)))
        b = ruled(Line((0, 10, 4), (10, 10, 4)), Line((0, 15, 4), (10, 15, 4)))
        return blend(a.edges().sort_by(lambda e: e.center().y)[-1], b.edges().sort_by(lambda e: e.center().y)[0])

    def fitted():
        return surface([(i, j, math.sin(i / 3) * math.cos(j / 4)) for i in range(10) for j in range(10)], report=True)[1]

    holed = lambda: Box(20, 20, 10) - Cylinder(4, 10)  # noqa: E731
    folded = lambda: Box(100, 50, 2).fold(Axis((0, 0, 1), (0, 1, 0)), 90, radius=2)  # noqa: E731
    return {
        # Booleans, cells and splits (B11, B12, B14, B15)
        "classify": lambda: [Box(10, 10, 10).classify(p)[0] for p in ((0, 0, 0), (5, 0, 0), (5, 5, 0), (5, 5, 5), (9, 0, 0))],
        "split by a sheet": lambda: {"volumes": [p.volume for p in Box(20, 20, 20).split(bump(), "both")]},
        "imprint": lambda: pick(_body(Box(20, 20, 10).imprint(Cylinder(4, 30))), "volume", "faces", "edges"),
        "cell sources": lambda: sorted(["&".join(sorted(s.name for s in c.sources)), round(c.volume, 6)] for c in
                                       Box(10, 10, 10).named("a").merge(Sphere(6).translate((5, 0, 0)).named("b")).cells()),
        # fillets and chamfers (F6, F9, F10, F12)
        "fillet propagate": lambda: _body(rounded().fillet(
            rounded().edges().filter(lambda e: e.center().z > 4.9).sort_by(lambda e: e.center().x)[:1], 1, propagate=True)),
        "chamfer length2": lambda: _body(Box(20, 20, 10).chamfer(Box(20, 20, 10).faces().top()[0].edges(), 2, length2=1,
                                                                 reference=Box(20, 20, 10).faces().top()[0])),
        "fillet mitre": lambda: _body(Box(20, 20, 10).fillet(Box(20, 20, 10).edges(), 2, corners="mitre")),
        "cone chamfer": lambda: _body(Cylinder(5, 10).chamfer(
            Cylinder(5, 10).edges().filter(lambda e: e.geom_type == "circle" and e.center().z > 0), 1)),
        # shells, offsets and direct editing (O7, O9, O10, O12)
        "offset round": lambda: _body(Box(10, 10, 10).offset(2, corners="round")),
        "shell round": lambda: _body(Box(30, 30, 30).shell(-2, Box(30, 30, 30).faces().top(), corners="round")),
        "sheet offset": lambda: {"area": sheet().offset(2).area, "z": sheet().offset(2).bbox().min.z},
        "thicken": lambda: _body(thicken(sheet(), 3, both=True)),
        "move faces": lambda: _body(Box(20, 20, 10).move_faces(Box(20, 20, 10).faces().top(), (0, 0, 5))),
        "offset faces": lambda: _body(holed().offset_faces(holed().faces().filter(lambda f: f.geom_type == "cylinder"), 1)),
        # primitives, sweeps and extrusions (S3, S4, S7, S9, S12, S13)
        "sectors": lambda: [round(x, 9) for x in (Cylinder(5, 10, arc_size=90).volume, Cone(5, 2, 10, arc_size=120).volume,
                                                  Sphere(5, arc_size3=180).volume, Torus(10, 2, major_angle=90).volume,
                                                  AnnularSector(5, 10, 4, 90).volume)],
        "swing": lambda: _body(swing(Rectangle(4, 10).translate((12, 0)).on(Plane.XZ), Rectangle(30, 20, fillet=5))),
        "sweep twist": lambda: _body(sweep(Rectangle(4, 2), Line((0, 0, 0), (0, 0, 30)), twist=90)),
        "sweep scale": lambda: _body(sweep(Circle(2), Line((0, 0, 0), (0, 0, 30)), scale=(1, 0.5))),
        "extrude taper round": lambda: _body(Rectangle(20, 10).extrude(5, taper=10, corners="round")),
        "revolve analytic": lambda: sorted(f.geom_type for f in
                                           Rectangle(4, 6).translate((10, 0)).revolve(Axis((0, 0, 0), (0, 1, 0))).faces()),
        # curves and sketches (C2, C4, C5, C6, C7, C8, C9, C10, C14, C16, A5)
        "edge trim": lambda: {"len": arc().trim(0.2, 0.7).length, "t": arc().param_at_point((5, 2.5, 0))},
        "edge extend": lambda: arc().extend(3).length,
        "intersections": lambda: [list(p.to_tuple()) for p in Circle(5).edges()[0].intersections(Line((-10, 1, 0), (10, 1, 0)))],
        "edge offset": lambda: arc().offset(1).length,
        "wire offset": lambda: Polyline((0, 0, 0), (10, 0, 0), (10, 10, 0)).offset(1).length,
        "fit curve": lambda: fit_curve([(i, math.sin(i / 3), 0) for i in range(20)], tolerance=1e-3).length,
        "curvature": lambda: {"min": arc().min_radius(), "at": arc().curvature_at(0.3)},
        "to arcs": lambda: len(Spline((0, 0, 0), (5, 3, 0), (10, 0, 0), (15, -2, 0)).to_arcs(0.01).edges()),
        "conics": lambda: [ConicArc((0, 0, 0), (5, 5, 0), (10, 0, 0), 0.3).length, Spiral(2, 6, 3, Plane.XY).length],
        "edge through": lambda: Line((0, 0, 0), (10, 0, 0)).through((5, 2, 0)).length,
        "helix long": lambda: Helix(5, 400, 2).length,
        "section properties": lambda: (lambda s: [s.area, *s.centroid.to_tuple(), s.ixx, s.iyy, s.ixy])(
            (Rectangle(20, 10) - Circle(2).translate((5, 0))).section_properties()),
        # surfaces (U2, U4, U5, U6, U7, U8, U15)
        "blend": lambda: bridge().area,
        "fill": lambda: fill(Polyline((0, 0, 0), (10, 0, 0), (10, 10, 3), (0, 10, 0), (0, 0, 0))).area,
        "network": lambda: network([Spline((0, 0, 0), (5, 0, 2), (10, 0, 0)), Spline((0, 10, 0), (5, 10, 2), (10, 10, 0))],
                                   [Spline((0, 0, 0), (0, 5, 1), (0, 10, 0)), Spline((10, 0, 0), (10, 5, 1), (10, 10, 0))]).area,
        "face extend": lambda: Box(10, 10, 10).faces().top()[0].extend(2).area,
        "push": lambda: _body(Box(20, 20, 4).push(Box(20, 20, 4).faces().top()[0], (0, 0, 2), by=1)),
        "warp": lambda: _body(Box(20, 20, 4).warp(Box(20, 20, 4).faces().top()[0], [(-5, -5, 2), (5, -5, 2), (5, 5, 2), (-5, 5, 2)], 1)),
        "surface report": lambda: [fitted().max_distance, fitted().rms_distance],
        "stitch": lambda: len(stitch([f.to_shell() for f in Box(10, 10, 10).faces()]).faces()),
        # measuring (A2, A3, A6, C12, M4, M5)
        "closest points": lambda: (lambda c: [c.distance, *c.point.to_tuple(), *c.other_point.to_tuple()])(
            Box(10, 10, 10).closest_points(Sphere(2).translate((10, 10, 10)))),
        "face curvature": lambda: (lambda c: [c.k1, c.k2])(Sphere(5).faces()[0].curvature_at((5, 0, 0))),
        "inertia": lambda: [float(x) for x in Box(10, 20, 30).mass_properties().inertia_about((5, 5, 5))[0]],
        "project": lambda: sum(e.length for e in Box(10, 10, 10).project(Circle(3).moved(Location((0, 0, 20))).edges()[0])),
        "wrap": lambda: sum(e.length for e in Cylinder(5, 10).faces().filter(lambda f: f.geom_type == "cylinder")[0].wrap(Circle(1))),
        "outline hidden": lambda: (lambda o: [len(o[0]), len(o[1]), sum(e.length for e in o[0]), sum(e.length for e in o[1])])(
            holed().outline(Plane.XZ, hidden=True)),
        "raycast many": lambda: [h.distance if h else None for h in
                                 Sphere(5).raycast_many([(0, 0, -20), (3, 0, -20), (6, 0, -20)], (0, 0, 1))],
        # meshes (M6, M7, M8, M10, M11)
        "mesh decimate": lambda: len(Sphere(5).mesh(0.01).decimate(0.5).triangles),
        "mesh slices": lambda: [round(sum(w.length for w in s), 6) for s in Sphere(5).mesh(0.01).slices(3)],
        "mesh to part": lambda: _body(Box(10, 10, 10).mesh().to_part()),
        "max edge": lambda: len(Box(10, 10, 10).mesh(max_edge=3).triangles),
        "mesh mass": lambda: [Box(10, 10, 10).mesh().mass_properties(1.0).mass, *Box(10, 10, 10).mesh().centroid.to_tuple()],
        "drawing views": lambda: [[v.name, len(v.visible), len(v.hidden)] for v in drawing_views(holed())],
        # sheet metal and deformations (D1, D3)
        "k factor din": lambda: list(flat_pattern(folded(), k_factor="din6935").size.to_tuple()),
        "unroll": lambda: _body(unroll(Cylinder(10, 5, arc_size=180) - Cylinder(9, 6), radius=9.5)),
        "bend allowance 270": lambda: bend_allowance(270, radius=2, thickness=1),
    }


def numbers(steps: Callable[[], dict[str, Callable[[], Any]]] | None = None) -> dict[str, Any]:
    """Each case's record (of ``steps``, by default :func:`cases`), or its error as ``{"error":
    class, "status": ...}``."""
    import warnings

    out = {}
    for name, run in (steps or cases)().items():
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                out[name] = run()
            except Exception as e:  # noqa: BLE001 - the error is the result
                out[name] = {"error": type(e).__name__, "status": getattr(e, "status", None)}
    return out


# ------------------------------------------------------------------------------------- comparing
_NUMBER = re.compile(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?")


def normalized(text: str) -> str:
    """A writer's text without what names the writer or the moment: smlibwasm calls itself
    smlibwasm, and a STEP file's FILE_NAME has the file's name (none for toStep) and the time."""
    text = text.replace("smlibwasm", "smlibpy")
    return re.sub(r"FILE_NAME\('[^']*','[^']*'", "FILE_NAME('','')", text)


def same_text(a: str, b: str, tolerance: float = TEXT_ABS) -> str | None:
    """None when ``a`` and ``b`` are the same text but for numbers within ``tolerance`` (absolute,
    and of their size); else where they differ first."""
    a, b = normalized(a), normalized(b)
    ta, tb = _NUMBER.split(a), _NUMBER.split(b)
    na, nb = _NUMBER.findall(a), _NUMBER.findall(b)
    if ta != tb or len(na) != len(nb):
        i = next((i for i, (x, y) in enumerate(zip(ta, tb)) if x != y), min(len(ta), len(tb)))
        return f"text {ta[i] if i < len(ta) else ''!r} against {tb[i] if i < len(tb) else ''!r} (piece {i})"
    for i, (x, y) in enumerate(zip(na, nb)):
        u, v = float(x), float(y)
        if abs(u - v) > tolerance * max(1.0, abs(u), abs(v)):
            return f"number {i}: {x} against {y}"
    return None


def same_value(a: Any, b: Any, rel: float = REL, at: str = "") -> str | None:
    """None when two JSON values agree (numbers to ``rel`` of their size, at least 1e-9); else where
    they differ."""
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None or isinstance(a, str) or isinstance(b, str):
        return None if a == b else f"{at}: {a!r} against {b!r}"
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if isinstance(a, int) and isinstance(b, int):
            return None if a == b else f"{at}: {a} against {b}"
        return None if abs(a - b) <= ABS + rel * max(abs(a), abs(b)) else f"{at}: {a!r} against {b!r}"
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{at}: {len(a)} items against {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            if (d := same_value(x, y, rel, f"{at}[{i}]")) is not None:
                return d
        return None
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            return f"{at}: keys {sorted(a)} against {sorted(b)}"
        for k in a:
            if (d := same_value(a[k], b[k], rel, f"{at}.{k}")) is not None:
                return d
        return None
    return f"{at}: {a!r} against {b!r}"


def _platform() -> str:
    return f"{sys.platform}-{platform.machine().lower()}"


def golden() -> dict[str, Any]:
    return {"platform": _platform(), "cases": numbers(), "capabilities": numbers(capabilities), "known": KNOWN}


def differences() -> list[str]:
    """Where smlibpy here differs from the golden files (an FMA case may also give smlibwasm's
    result on a platform without the contraction)."""
    out = []
    saved = json.loads((GOLDEN / "golden.json").read_text())
    for key, steps in (("cases", cases), ("capabilities", capabilities)):
        for name, record in numbers(steps).items():
            if name not in saved.get(key, {}):
                out.append(f"{name}: not in golden.json")
                continue
            d = same_value(record, saved[key][name], at=name)
            if d is not None and not (name in KNOWN and KNOWN[name]["fma"] and not FMA
                                      and same_value(record, KNOWN[name]["wasm"], at=name) is None):
                out.append(d)
    with tempfile.TemporaryDirectory() as folder:
        # (elsewhere than on the golden files' platform, the writers get the golden bodies)
        write_files(Path(folder), None if saved["platform"] == _platform() else GOLDEN)
        for name, kind in FILES.items():
            mine, theirs = (Path(folder) / name).read_text(), (GOLDEN / name).read_text()
            d = (same_value(json.loads(normalized(mine)), json.loads(normalized(theirs)), TEXT_ABS) if kind == "json"
                 else same_text(mine, theirs))
            if d is not None:
                out.append(f"{name}: {d}")
    return out


def main(argv: list[str]) -> int:
    if "--update" in argv:
        GOLDEN.mkdir(parents=True, exist_ok=True)
        write_files(GOLDEN)
        (GOLDEN / "golden.json").write_text(json.dumps(golden(), indent=1) + "\n")
        print(f"wrote {GOLDEN}")
        return 0
    found = differences()
    for d in found:
        print(d)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
