"""smlibpy — Python CAD modeling on SMLib, the open-source NURBS solid modeling kernel.

    from smlibpy import *

    plate = Box(80, 60, 10)
    plate = plate.fillet(plate.edges().parallel_to(Z), 8)
    plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)
    plate.export("plate.step")
"""

from .align import Align
from .deform import Lattice, bend, taper, twist
from .curves import (
    Bezier,
    CenterArc,
    EllipticalArc,
    FilletPolyline,
    Helix,
    Line,
    PolarLine,
    Polyline,
    RadiusArc,
    SagittaArc,
    Spline,
    TangentArc,
    ThreePointArc,
    make_compatible,
)
from .geometry import TOLERANCE, Axis, BoundBox, Hit, Location, Nurbs, Plane, Pos, Rot, Vector, X, Y, Z
from .locations import GridLocations, HexLocations, Locations, PolarLocations
from .mesh import Mesh, tessellate
from .operations import (chamfer, extrude, fillet, loft, merge, mirror, offset, revolve, section, shell, split, sweep,
                         thicken)
from .parts import Box, Cone, CounterBoreHole, CounterSinkHole, Cylinder, Hole, Sphere, Torus, Wedge
from .profiles import Profile
from .shapes import Edge, Face, MassProperties, Part, Shape, ShapeList, Shell, Sketch, Vertex, Wire
from .sketches import (ArcSlot, Circle, Ellipse, Hull, Polygon, Rectangle, RegularPolygon, RoundedRectangle, Slot,
                       Stroke, Trapezoid, Triangle, make_face)
from .text import Text
from ._kernel import KernelError, ModelingError
from .exporters import (export, export_glb, export_gltf, export_obj, export_step, export_stl, from_smb, from_smp,
                        from_stl, import_stl, load, save, to_glb, to_gltf, to_obj, to_smb, to_smp, to_step, to_stl)
from .step_import import (StepCurve, StepFrame, StepModel, StepPoint, from_step, from_step_model, import_step,
                          read_step)
from .iges_import import from_iges, import_iges
from .dxf import export_dxf, from_dxf, from_dxf_wires, import_dxf, import_dxf_wires, to_dxf
from .usd import export_usd, from_usd, import_usd, to_usd
from .occt import export_brep, from_brep, import_brep, to_brep
from .render import diff_images, render
from .viewer import show
from .surfaces import ruled, stitch, surface, surface_fillet
from .sheetmetal import (Bend, FlatPattern, bend_allowance, bend_deduction, developed_length, flange,
                         flat_pattern, fold, unfold)

__version__ = "0.4.0"

__all__ = [
    # geometry
    "Vector", "Axis", "Plane", "Location", "Pos", "Rot", "BoundBox", "Hit", "Nurbs", "X", "Y", "Z", "TOLERANCE",
    "Align",
    # shapes
    "Shape", "ShapeList", "Vertex", "Edge", "Wire", "Face", "Shell", "Sketch", "Part", "MassProperties", "Mesh",
    # curves
    "Line", "Polyline", "PolarLine", "CenterArc", "ThreePointArc", "RadiusArc", "SagittaArc", "TangentArc",
    "EllipticalArc", "Spline", "Bezier", "Helix", "FilletPolyline", "make_compatible",
    # sketches
    "Profile", "Rectangle", "RoundedRectangle", "Circle", "Ellipse", "Polygon", "RegularPolygon", "Triangle", "Trapezoid",
    "Slot", "ArcSlot", "Stroke", "Hull", "make_face",
    "Text",
    # parts
    "Box", "Cylinder", "Cone", "Sphere", "Torus", "Wedge", "Hole", "CounterBoreHole", "CounterSinkHole",
    # patterns
    "Locations", "GridLocations", "PolarLocations", "HexLocations",
    # operations
    "extrude", "revolve", "loft", "sweep", "fillet", "chamfer", "shell", "offset", "mirror", "split", "section", "merge",
    "thicken", "tessellate",
    # deformations
    "twist", "taper", "bend", "Lattice",
    # surfaces
    "surface", "ruled", "stitch", "surface_fillet",
    # sheet metal
    "fold", "flange", "unfold", "flat_pattern", "bend_allowance", "bend_deduction", "developed_length", "Bend",
    "FlatPattern",
    # files and viewer
    "export", "export_step", "export_stl", "export_glb", "export_gltf", "export_obj", "save", "load", "import_stl", "import_step",
    "read_step", "StepModel", "StepFrame", "StepCurve", "StepPoint", "import_iges",
    "export_dxf", "import_dxf", "import_dxf_wires", "export_usd", "import_usd", "export_brep", "import_brep",
    # files in memory
    "to_step", "from_step", "from_step_model", "to_stl", "from_stl", "to_obj", "to_glb", "to_gltf", "to_smb", "from_smb",
    "to_smp", "from_smp", "to_dxf", "from_dxf", "from_dxf_wires", "to_usd", "from_usd", "from_iges", "to_brep",
    "from_brep",
    "show", "render", "diff_images",
    # errors
    "ModelingError", "KernelError",
]
