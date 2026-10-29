"""Finding your way around the API: a method index built from the package itself, the
guides of the skill (``smlibpy/skill``), and a search over both."""

from __future__ import annotations

import inspect
import math
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

SKILL_DIR = Path(__file__).resolve().parent.parent / "skill"

#: Classes whose public methods are listed next to the functions of ``smlibpy.__all__``.
CLASSES = ("Part", "Sketch", "Profile", "Shell", "Face", "Edge", "Wire", "Vertex", "ShapeList", "Vector", "Axis",
           "Plane", "Location", "BoundBox", "Mesh", "MassProperties", "FlatPattern", "Bend",
           "Lattice", "StepModel")

#: The guide folder that documents a class's methods first (``Sketch.fillet`` -> sketches/fillet,
#: not features/fillet). A class in ``CLASS_GUIDES`` has all its methods in its own guide.
CLASS_DOMAINS = {"Part": "features", "Sketch": "sketches", "Profile": "sketches", "Shell": "surfaces",
                 "Face": "selection", "Edge": "curves", "Wire": "curves", "Vertex": "selection",
                 "ShapeList": "selection", "Vector": "geometry", "Axis": "geometry", "Plane": "geometry",
                 "Location": "geometry", "BoundBox": "geometry", "Mesh": "files", "MassProperties": "analysis",
                 "FlatPattern": "sheetmetal", "Bend": "sheetmetal", "Lattice": "deform", "StepModel": "files"}
CLASS_GUIDES = ("Profile",)
#: Methods and functions whose guide has another name: the guide that describes them. ``to_*`` and
#: ``from_*`` without a guide of their own go to files/in_memory (see :func:`guide_for`).
GUIDE_NAMES = {
    "new": "selection/history", "derived_from": "selection/history",
    "shells": "selection/shells", "voids": "selection/shells", "shared": "selection/shells", "Face.cells": "selection/shells",
    "sources": "features/cells", "g1": "analysis/continuity", "g2": "analysis/continuity",
    "from_mesh": "files/to_part", "raycast_many": "analysis/raycast", "Sketch.flipped": "surfaces/Shell",
    "min_radius_at": "curves/min_radius", "param_at_point": "curves/split", "from_nurbs": "curves/from_nurbs",
    # the function split cuts parts; the methods of curves split at a parameter
    "split": "features/split", "Edge.split": "curves/split", "Wire.split": "curves/split", "Face.split": "selection/Face",
    "Edge.trim": "curves/split", "Wire.trim": "curves/split",
    "Sketch.extend": "surfaces/extend", "Sketch.from_nurbs": "surfaces/nurbs_surface",
    "Shell": "surfaces/Shell", "deform": "deform/Lattice", "Part.deform": "deform/Lattice", "Bend": "sheetmetal/bends",
    "Shell.from_nurbs": "surfaces/nurbs_surface", "Face.min_radius": "analysis/curvature_at",
    # the classes the API hands back, and the functions whose guide has another name
    "Part": "parts/generic", "Sketch": "sketches/generic", "ShapeList": "selection/generic",
    "Shape": "selection/topology",
    "Hit": "analysis/raycast", "ClosestPoints": "analysis/closest_points", "Curvature": "analysis/curvature_at",
    "MassProperties": "analysis/mass_properties", "SectionProperties": "analysis/section_properties",
    "Problem": "analysis/check", "NurbsSurface": "surfaces/nurbs_surface", "FitReport": "surfaces/surface",
    "StitchReport": "surfaces/stitch", "RepairReport": "files/repaired", "FlatPattern": "sheetmetal/flat_pattern",
    "StepModel": "files/read_step", "StepFrame": "files/read_step", "StepCurve": "files/read_step",
    "StepPoint": "files/read_step", "DrawingView": "files/drawing_views", "MachiningSetup": "files/machining_setup", "AssemblyAxis": "files/assembly_axes", "FontError": "sketches/Text",
    "ModelingError": "SKILL", "KernelError": "SKILL",
    "fuse": "parts/booleans", "cut": "parts/booleans", "intersect": "parts/booleans", "xor": "sketches/generic",
    "fillet_preview": "features/fillet", "tessellate": "files/Mesh", "export_gltf": "files/export_glb",
    "save": "files/save_load", "load": "files/save_load", "to_svg": "files/export_svg",
    "bend_deduction": "sheetmetal/bend_allowance", "developed_length": "sheetmetal/bend_allowance",
    "Sketch.fuse": "sketches/generic", "Sketch.cut": "sketches/generic", "Sketch.intersect": "sketches/generic",
    "Sketch.xor": "sketches/generic", "Shell.fuse": "surfaces/Shell", "Shell.cut": "surfaces/Shell",
    "Shell.intersect": "surfaces/Shell", "Mesh.dispose": "files/Mesh", "MassProperties.inertia_about":
    "analysis/mass_properties", "MassProperties.moment_about": "analysis/mass_properties", "StepModel.frame":
    "files/read_step",
}
#: What every body (Part, Shell, Sketch) has, and the guide that describes it.
_BODY_GUIDES = {"bbox": "analysis/measures", "center": "analysis/measures", "info": "analysis/generic",
                "closest_point": "analysis/closest_points", "closest_points": "analysis/closest_points",
                "raycast": "analysis/raycast", "compact": "analysis/compact", "contains": "analysis/classify",
                "cell_at": "analysis/classify", "colored": "files/face_colors", "named": "files/face_colors",
                "solids": "selection/shells", "faces": "selection/topology", "edges": "selection/topology",
                "wires": "selection/topology", "vertices": "selection/topology"}
#: A ShapeList's selections, and their guides.
_SELECTION_GUIDES = {"top": "selection/positional", "bottom": "selection/positional", "left": "selection/positional",
                     "right": "selection/positional", "front": "selection/positional", "back": "selection/positional",
                     "at": "selection/generic", "one": "selection/generic", "circles": "selection/types",
                     "lines": "selection/types", "planar": "selection/types", "cylinders": "selection/types",
                     "of_type": "selection/types", "concave": "selection/convexity", "convex": "selection/convexity",
                     "smooth": "selection/convexity", "facing": "selection/spatial", "nearest": "selection/spatial",
                     "within": "selection/spatial", "filter": "selection/filter_by", "group_by": "selection/sort_by",
                     "sort_by_distance": "selection/sort_by", "largest": "selection/extremes",
                     "smallest": "selection/extremes", "max_by": "selection/extremes", "min_by": "selection/extremes",
                     "perpendicular_to": "selection/parallel_to", "bbox": "analysis/measures",
                     "center": "analysis/measures", "faces": "selection/topology", "edges": "selection/topology",
                     "wires": "selection/topology", "vertices": "selection/topology"}
GUIDE_NAMES.update({f"{cls}.{name}": key for cls in ("Part", "Shell", "Sketch") for name, key in _BODY_GUIDES.items()})
GUIDE_NAMES.update({f"{cls}.{name}": "selection/topology" for cls in ("Face", "Edge", "Wire", "Vertex")
                    for name in ("faces", "edges", "wires", "vertices")})
GUIDE_NAMES.update({f"ShapeList.{name}": key for name, key in _SELECTION_GUIDES.items()})

#: Words people use for a thing, and the words the API uses.
SYNONYMS = {
    "round": ["fillet"], "rounded": ["fillet", "Rectangle", "RoundedRectangle"], "radius": ["fillet", "radius"],
    "bevel": ["chamfer"], "hollow": ["shell"], "wall": ["shell", "thicken", "offset"], "thickness": ["shell", "thicken"],
    "union": ["fuse"], "join": ["fuse"], "combine": ["fuse"], "add": ["fuse"], "subtract": ["cut"],
    "difference": ["cut"], "remove": ["cut", "remove_fillets", "remove_faces"], "boolean": ["fuse", "cut", "intersect"], "common": ["intersect"],
    "pad": ["extrude"], "pocket": ["extrude", "cut"], "prism": ["extrude"], "lathe": ["revolve", "Profile"],
    "turn": ["revolve"], "pipe": ["sweep"], "path": ["sweep"], "transition": ["loft"],
    "pattern": ["Locations", "GridLocations", "PolarLocations"], "array": ["GridLocations", "PolarLocations"],
    "circular": ["PolarLocations"], "copy": ["Locations", "moved"], "move": ["translate", "moved"],
    "rotate": ["rotate", "Rot"], "place": ["on", "Location", "Pos"], "position": ["Pos", "Location"],
    "align": ["Align"], "mirror": ["mirror"], "drill": ["Hole"], "bore": ["CounterBoreHole"],
    "countersink": ["CounterSinkHole"], "thread": ["Helix"], "spring": ["Helix", "sweep"],
    "curve": ["Spline", "Line", "CenterArc"], "arc": ["CenterArc", "ThreePointArc", "RadiusArc", "TangentArc"],
    "spline": ["Spline", "Bezier"], "freeform": ["surface", "Spline", "Lattice"], "patch": ["surface", "ruled"],
    "select": ["ShapeList", "filter_by", "faces", "edges"], "pick": ["ShapeList", "filter_by"],
    "find": ["filter_by", "nearest"], "top": ["top"], "highest": ["top", "max_by"], "biggest": ["largest"],
    "measure": ["mass_properties", "volume", "area", "distance_to"], "weight": ["mass_properties"],
    "mass": ["mass_properties"], "inertia": ["mass_properties"], "centroid": ["center", "mass_properties"],
    "size": ["bbox"], "bounds": ["bbox", "BoundBox"], "distance": ["distance_to", "closest_point"],
    "check": ["is_valid", "check", "heal"], "repair": ["heal"], "fix": ["heal"],
    "problem": ["check"], "problems": ["check"], "diagnose": ["check"], "gap": ["check", "tolerance"],
    "history": ["new", "derived_from"], "joint": ["joining"], "joints": ["joining"],
    "cavity": ["voids", "shells"], "cavities": ["voids", "shells"], "interface": ["shared", "cells"],
    "interfaces": ["shared", "cells"], "paint": ["colored", "face_colors"], "label": ["named", "face_colors"], "provenance": ["derived_from", "new"], "descendant": ["derived_from"],
    "imprint": ["imprint"], "trim": ["split", "Shell"], "export": ["export", "export_step", "save"],
    "import": ["load", "import_step", "read_step", "import_iges", "import_stl"], "open": ["load"],
    "file": ["export", "load"],
    "picture": ["render"], "image": ["render"], "png": ["render"], "screenshot": ["render"], "view": ["render", "show"],
    "drawing": ["render"], "technical": ["render"], "projection": ["render"], "highlight": ["render"], "xray": ["render"], "compare": ["diff_images"],
    "diff": ["diff_images"], "before": ["diff_images"],
    "exploded": ["render_exploded", "assembly_axes"], "explode": ["render_exploded"], "balloon": ["render_exploded"],
    "balloons": ["render_exploded"], "assembly": ["render_exploded", "assembly_axes"], "contact": ["assembly_axes"],
    "zebra": ["render", "verification"], "reflection": ["render", "zebra"], "stripes": ["render", "zebra"],
    "curvature": ["render", "verification"], "continuity": ["fillet", "verification", "zebra"],
    "class": ["verification", "zebra", "curvature"], "smooth": ["fillet", "verification", "zebra"],
    "g": ["continuity", "zebra", "verification"],  # G1, G2, G3 split into "g" and the digit
    "blend": ["loft", "fillet", "surface_fillet"], "quality": ["verification", "zebra", "curvature"],
    "mesh": ["tessellate", "Mesh"], "triangles": ["tessellate", "Mesh"], "stl": ["export_stl", "import_stl"],
    "step": ["export_step", "import_step", "read_step"], "iges": ["import_iges", "load"], "igs": ["import_iges", "load"], "csys": ["read_step", "Plane"],
    "coordinate": ["read_step", "Plane"], "wireframe": ["read_step", "import_dxf_wires"], "mcs": ["read_step"], "cut": ["cut", "split", "section"], "slice": ["section", "split"],
    "cross": ["section"], "draft": ["draft", "tilt", "tilts"], "taper": ["taper", "draft", "extrude"], "offset": ["offset"],
    "tilt": ["draft"], "tilted": ["draft"], "tilting": ["draft"], "incline": ["draft"], "inclined": ["draft"],
    "profile": ["Profile", "Sketch", "Rectangle", "Circle"], "2d": ["Sketch", "Profile"],
    "polygon": ["Polygon", "RegularPolygon"], "hexagon": ["RegularPolygon"], "slot": ["Slot", "ArcSlot", "Stroke"],
    "gear": ["Polygon", "PolarLocations"],
    "text": ["Text"], "label": ["Text"], "labels": ["Text"], "lettering": ["Text"], "letters": ["Text"],
    "letter": ["Text"], "font": ["Text"], "fonts": ["Text"], "inscription": ["Text"], "writing": ["Text"],
    "engrave": ["Text", "extrude", "cut"], "engraved": ["Text", "extrude", "cut"],
    "engraving": ["Text", "extrude", "cut"], "emboss": ["Text", "extrude", "fuse"],
    "embossed": ["Text", "extrude", "fuse"], "embossing": ["Text", "extrude", "fuse"],
    "dxf": ["import_dxf", "export_dxf", "import_dxf_wires"],
    "drawings": ["import_dxf", "export_dxf"], "autocad": ["import_dxf", "export_dxf"],
    "dwg": ["import_dxf", "export_dxf"], "laser": ["export_dxf", "section"],
    # 2D outlines
    "tangent": ["Profile", "arc_to", "TangentArc"], "pen": ["Profile"], "draw": ["Profile", "line_to"],
    "outline": ["Profile", "offset", "make_face", "outline"], "contour": ["Profile", "make_face"],
    "turtle": ["Profile"],
    "symmetric": ["mirror", "Profile"], "half": ["mirror", "Profile"], "shaft": ["Profile", "revolve"],
    "bushing": ["Profile", "revolve"], "corner": ["fillet", "chamfer", "vertices", "convex", "concave"],
    "corners": ["fillet", "chamfer", "vertices", "convex", "concave"], "hull": ["Hull"], "convex": ["Hull", "convex"],
    "lever": ["Hull"], "link": ["Hull"], "cam": ["Hull", "Profile"], "gasket": ["offset"], "frame": ["offset"],
    "clearance": ["offset"], "band": ["Stroke", "offset"], "trace": ["Stroke"], "track": ["Stroke"],
    "rib": ["Stroke", "Triangle"], "web": ["Stroke"], "triangle": ["Triangle"], "gusset": ["Triangle"],
    "obround": ["Slot"], "stadium": ["Slot"], "keyhole": ["Profile"], "perimeter": ["perimeter"],
    "deform": ["twist", "taper", "bend", "Lattice"], "deformation": ["twist", "taper", "bend", "Lattice"],
    "twist": ["twist"], "twisted": ["twist"], "tapered": ["taper"],
    "curl": ["bend"], "wrap": ["bend"], "warp": ["Lattice", "bend", "twist"], "free": ["Lattice"],
    "lattice": ["Lattice"], "morph": ["Lattice"], "cage": ["Lattice"], "ffd": ["Lattice"], "sculpt": ["Lattice"],
    "dent": ["push"], "dimple": ["push"], "bump": ["push", "warp"], "bulge": ["push", "warp"], "recess": ["warp"],
    "defeature": ["remove_fillets", "remove_faces"], "defeaturing": ["remove_fillets", "remove_faces"],
    "simplify": ["remove_fillets", "remove_faces"], "suppress": ["remove_faces", "remove_fillets"],
    "fillets": ["fillets", "remove_fillets"], "unfillet": ["remove_fillets"], "sharp": ["remove_fillets"],
    "undercut": ["draft_analysis"], "undercuts": ["draft_analysis"], "mold": ["draft_analysis", "parting_line"],
    "mould": ["draft_analysis", "parting_line"], "molding": ["draft_analysis", "parting_line"],
    "casting": ["draft_analysis", "parting_line"], "cast": ["draft_analysis", "parting_line"],
    "parting": ["parting_line"], "pull": ["draft_analysis", "parting_line"], "demold": ["draft_analysis"],
}

# Rays, clouds of points, cells, curve data, USD.
SYNONYMS.update({
    "ray": ["raycast"], "rays": ["raycast"], "hit": ["raycast", "hit_by"], "hits": ["raycast", "hit_by"],
    "shoot": ["raycast"], "sight": ["raycast", "hit_by"], "inside": ["contains", "classify"], "outside": ["contains", "classify"],
    "pierce": ["raycast", "hit_by"], "sees": ["hit_by"], "visible": ["hit_by"],
    "cloud": ["surface"], "scan": ["surface", "import_stl"], "scanned": ["surface", "import_stl"],
    "scanner": ["surface"], "fit": ["surface"], "fitting": ["surface"], "approximate": ["surface"],
    "cell": ["cells", "merge"], "cells": ["cells", "merge"], "manifold": ["merge", "cells"],
    "materials": ["merge", "cells"], "insert": ["merge", "cells"], "overmold": ["merge", "cells"],
    "regions": ["cells", "merge"],
    "knot": ["remove_knots", "nurbs"], "knots": ["remove_knots", "nurbs"], "compatible": ["make_compatible"],
    "nurbs": ["nurbs", "to_nurbs"], "control": ["nurbs", "Bezier"], "poles": ["nurbs"], "weights": ["nurbs"],
    "degree": ["nurbs"], "morph": ["make_compatible", "Lattice"],
    "usd": ["export_usd", "import_usd"], "usda": ["export_usd", "import_usd"], "openusd": ["export_usd", "import_usd"],
    "omniverse": ["export_usd", "import_usd"], "pixar": ["export_usd"],
    "brep": ["export_brep", "import_brep"], "occt": ["export_brep", "import_brep"],
    "opencascade": ["export_brep", "import_brep", "export_step"], "build123d": ["export_brep", "import_brep"],
    "cadquery": ["export_brep", "import_brep"], "freecad": ["export_brep", "import_brep", "export_step"],
})

# Sheet metal.
SYNONYMS.update({
    "sheet": ["sheetmetal", "fold", "flange", "flat_pattern", "unfold"], "metal": ["sheetmetal", "fold", "flange"],
    "bend": ["bend", "fold", "flange", "bends"], "bending": ["bend", "fold"], "bent": ["bend", "fold", "bends"], "fold": ["fold", "flange"],
    "folded": ["fold", "unfold"], "flange": ["flange"], "hem": ["fold"], "brake": ["fold"], "tab": ["fold"],
    "relief": ["fold"], "unfold": ["unfold", "flat_pattern"], "unbend": ["unfold"],
    "flatten": ["unfold", "flat_pattern"],
    "flat": ["flat_pattern", "unfold"], "development": ["flat_pattern", "developed_length"],
    "developed": ["developed_length"], "blank": ["flat_pattern", "developed_length"], "laser": ["flat_pattern"],
    "cutter": ["flat_pattern"], "nesting": ["flat_pattern"], "allowance": ["bend_allowance"],
    "deduction": ["bend_deduction"], "factor": ["bend_allowance"], "neutral": ["bend_allowance", "draft"],
})

# Direct editing: faces moved and offset.
SYNONYMS.update({
    "resize": ["offset_faces"], "enlarge": ["offset_faces"], "widen": ["offset_faces"],
    "thicker": ["offset_faces", "shell"],
    "push": ["move_faces", "offset_faces"], "pushpull": ["move_faces", "offset_faces"], "relocate": ["move_faces"],
    "reposition": ["move_faces"],
    "direct": ["move_faces", "offset_faces"], "editing": ["move_faces", "offset_faces"],
})

# Fillet laws and previews.
SYNONYMS.update({
    "preview": ["fillet_preview"], "variable": ["fillet"], "law": ["fillet"], "varying": ["fillet"],
    "setback": ["fillet", "chamfer"], "softer": ["fillet"],
})

_CONSTANTS = {
    "X": "the world X axis (an Axis); also a direction in selections such as parallel_to(X)",
    "Y": "the world Y axis (an Axis)",
    "Z": "the world Z axis (an Axis); Z is up",
    "TOLERANCE": "the modeling tolerance in mm: points closer than this count as the same",
}


@dataclass
class Entry:
    key: str  # "Box", "Part.fillet", "features/fillet"
    kind: str  # "function", "class", "method", "property", "constant", "guide"
    line: str  # signature or title
    summary: str
    text: str = field(repr=False, default="")


def _first_line(doc: str | None) -> str:
    if not doc:
        return ""
    for line in inspect.cleandoc(doc).splitlines():
        if line.strip():
            return line.strip()
    return ""


def _default(v: Any) -> str:
    import enum

    if isinstance(v, enum.Enum):
        return f"{type(v).__name__}.{v.name}"
    text = repr(v)
    return text if len(text) <= 40 else type(v).__name__


def _choices(annotation: Any) -> str | None:
    """``'a' | 'b'`` for a parameter typed as a ``Literal`` of strings (or of strings and None)."""
    text = (annotation if isinstance(annotation, str) else repr(annotation)).replace("typing.", "")
    found = re.fullmatch(r"Literal\[([^\]]*)\]( \| None)?", text.strip())
    if not found:
        return None
    values = [v.strip().replace('"', "'") for v in found.group(1).split(",")]
    return " | ".join(values) + (" | None" if found.group(2) else "")


def _signature(name: str, obj: Any) -> str:
    """``name(a, b=1, *, c=None)``: parameters and defaults, without type annotations, but for the
    choices of a parameter that takes one of some strings (``corners: 'round' | 'sharp' = 'round'``)."""
    try:
        sig = inspect.signature(obj)
    except (TypeError, ValueError):
        return name
    parts: list[str] = []
    star = False
    for p in sig.parameters.values():
        if p.name in ("self", "cls"):
            continue
        if p.kind == p.VAR_POSITIONAL:
            parts.append("*" + p.name)
            star = True
        elif p.kind == p.VAR_KEYWORD:
            parts.append("**" + p.name)
        else:
            if p.kind == p.KEYWORD_ONLY and not star:
                parts.append("*")
                star = True
            choices = _choices(p.annotation)
            if choices:
                parts.append(f"{p.name}: {choices}" + ("" if p.default is p.empty else f" = {_default(p.default)}"))
            else:
                parts.append(p.name if p.default is p.empty else f"{p.name}={_default(p.default)}")
    return f"{name}({', '.join(parts)})"


@lru_cache(maxsize=1)
def methods() -> list[Entry]:
    import smlibpy

    out: list[Entry] = []
    for name in smlibpy.__all__:
        obj = getattr(smlibpy, name)
        if inspect.isclass(obj):
            kind = "class"
            line = _signature(name, obj)
        elif callable(obj):
            kind, line = "function", _signature(name, obj)
        else:
            kind, line = "constant", name
        doc = inspect.getdoc(obj) or ""
        if kind == "constant":
            out.append(Entry(name, kind, line, _CONSTANTS.get(name, ""), ""))
        else:
            out.append(Entry(name, kind, line, _first_line(doc), doc))
    for cname in CLASSES:
        cls = getattr(smlibpy, cname, None)
        if cls is None:
            continue
        for mname, member in inspect.getmembers(cls):
            if mname.startswith("_"):
                continue
            if any(mname in base.__dict__ for base in cls.__mro__ if base.__module__ == "builtins") and not any(
                    mname in base.__dict__ for base in cls.__mro__ if base.__module__ != "builtins"):
                continue  # (what ShapeList has from list: append, sort, ...: Python's, not the API's)
            raw = inspect.getattr_static(cls, mname)
            if isinstance(raw, property):
                kind, line = "property", f"{cname}.{mname}"
                doc = inspect.getdoc(raw) or ""
            elif callable(member):
                kind, line = "method", _signature(f"{cname}.{mname}", member)
                doc = inspect.getdoc(member) or ""
            else:
                continue
            out.append(Entry(f"{cname}.{mname}", kind, line, _first_line(doc), doc))
    return out


@lru_cache(maxsize=1)
def guides() -> list[Entry]:
    out: list[Entry] = []
    if not SKILL_DIR.is_dir():
        return out
    for path in sorted(SKILL_DIR.rglob("*.md")):
        rel = path.relative_to(SKILL_DIR).with_suffix("").as_posix()
        key = rel.replace("references/", "", 1)
        text = path.read_text(encoding="utf-8")
        body = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S)
        title = next((line.lstrip("# ").strip() for line in body.splitlines() if line.startswith("#")), key)
        summary = next((line.strip() for line in body.splitlines()
                        if line.strip() and not line.startswith(("#", "```", "|", "-", ">"))), "")
        out.append(Entry(key, "guide", title, summary[:160], text))
    return out


def guide(key: str) -> Entry | None:
    key = key.strip().removesuffix(".md").replace("references/", "", 1)
    for g in guides():
        if g.key == key or g.key.lower() == key.lower():
            return g
    tail = [g for g in guides() if g.key.split("/")[-1].lower() == key.split("/")[-1].lower()]
    return tail[0] if len(tail) == 1 else None


def _tokens(text: str) -> list[str]:
    parts = re.findall(r"[A-Za-z][a-z]+|[A-Z]+(?![a-z])|\d+", text)
    return [p.lower() for p in parts]


def search(query: str | list[str], limit: int = 25) -> list[tuple[float, Entry]]:
    """Entries that match the words of the query, best first."""
    words = [w for q in ([query] if isinstance(query, str) else query) for w in _tokens(q)]
    if not words:
        return []
    wanted: dict[str, float] = {}
    for w in words:
        wanted[w] = max(wanted.get(w, 0.0), 1.0)
        for s in SYNONYMS.get(w, []):
            for t in _tokens(s):
                wanted[t] = max(wanted.get(t, 0.0), 0.8)
    index = methods()
    # (a function that is another form of a body's method, draft of Part.draft, is left to the
    # method, which says more: describe_method finds either)
    of_bodies = {e.key.split(".", 1)[1] for e in index
                 if e.kind == "method" and e.key.split(".")[0] in ("Part", "Shell", "Sketch")}
    entries = [e for e in index if not (e.kind == "function" and e.key in of_bodies)] + guides()
    df: dict[str, int] = {}
    docs_tokens = []
    for e in entries:
        toks = set(_tokens(e.key)) | set(_tokens(e.summary)) | set(_tokens(e.text[:4000]))
        docs_tokens.append(toks)
        for t in toks:
            df[t] = df.get(t, 0) + 1
    n = len(entries)
    scored = []
    for e, toks in zip(entries, docs_tokens):
        key_toks = set(_tokens(e.key))
        sum_toks = set(_tokens(e.summary))
        s = 0.0
        for t, w in wanted.items():
            if t not in toks:
                continue
            idf = math.log(1 + n / (1 + df.get(t, 0)))
            s += w * idf * (4.0 if t in key_toks else 1.5 if t in sum_toks else 0.6)
        if s > 0:
            if e.kind == "guide":
                s *= 1.1
            scored.append((s, e))
    scored.sort(key=lambda x: -x[0])
    return scored[:limit]


def find_method(name: str) -> Entry | None:
    name = name.strip().removeprefix("smlibpy.").rstrip("()")
    by_key = {e.key: e for e in methods()}
    if name in by_key:
        return by_key[name]
    lowered = {k.lower(): e for k, e in by_key.items()}
    if name.lower() in lowered:
        return lowered[name.lower()]
    tail = [e for e in methods() if e.key.split(".")[-1].lower() == name.split(".")[-1].lower()]
    return tail[0] if tail else None


def guide_for(entry: Entry) -> Entry | None:
    """The guide written for a method, if there is one (references/<domain>/<name>.md): the one
    in the domain of the method's class first (``Sketch.fillet`` -> sketches/fillet), then any
    of that name, then the guide of the class itself (``Wire.fillet`` -> curves/Wire)."""
    names = {entry.key.lower(), entry.key.split(".")[-1].lower(), entry.key.replace(".", "-").lower()}
    by_key = {g.key: g for g in guides()}
    for name in (entry.key, entry.key.split(".")[-1]):
        if name in GUIDE_NAMES and GUIDE_NAMES[name] in by_key:
            return by_key[GUIDE_NAMES[name]]
    matches = [g for g in guides() if g.key.split("/")[-1].lower() in names]
    cls = entry.key.split(".", 1)[0] if "." in entry.key else None
    own = [g for g in guides() if cls and g.key.split("/")[-1] == cls]
    if cls in CLASS_GUIDES and own:
        return own[0]
    domain = CLASS_DOMAINS.get(cls or "")
    tail = entry.key.split(".")[-1]
    for g in matches:
        if domain and g.key.startswith(domain + "/"):
            return g
    # The class's guide where it describes the method; else the guide of the method's name, the one
    # of any shape (geometry/mirror for Face.mirror) first.
    for g in own:
        if domain and g.key.startswith(domain + "/") and tail in g.text:
            return g
    for g in matches:
        if g.key.startswith("geometry/"):
            return g
    if matches:
        return matches[0]
    if own:
        return own[0]
    if (tail.startswith("to_") or tail.startswith("from_")) and "files/in_memory" in by_key:
        return by_key["files/in_memory"]  # (the files in memory)
    if cls in GUIDE_NAMES and GUIDE_NAMES[cls] in by_key:
        return by_key[GUIDE_NAMES[cls]]  # (the guide of its class: MassProperties.principal_axes)
    return None


def method_index() -> str:
    lines = []
    for e in methods():
        if e.kind in ("function", "class", "constant"):
            lines.append(f"{e.line}: {e.summary}" if e.summary else e.line)
    members: dict[str, list[str]] = {}
    for e in methods():
        if e.kind in ("method", "property"):
            cname, mname = e.key.split(".", 1)
            members.setdefault(cname, []).append(mname)
    for cname, names in members.items():
        lines.append(f"{cname}: {', '.join(names)}")
    return "\n".join(lines)


def guide_index() -> str:
    return "\n".join(f"{g.key}: {g.line}" for g in guides() if g.key != "SKILL")
