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
from .geometry import (TOLERANCE, Axis, BoundBox, ClosestPoints, Continuity, Curvature, Hit, Location, Nurbs, NurbsSurface,
                       Plane, Pos, Rot, Vector, X, Y, Z)
from .locations import GridLocations, HexLocations, Locations, PolarLocations
from .mesh import Mesh, tessellate
from .operations import (chamfer, extrude, fillet, loft, merge, mirror, offset, revolve, section, shell, split, sweep,
                         thicken)
from .parts import Box, Cone, CounterBoreHole, CounterSinkHole, Cylinder, Hole, Sphere, Torus, Wedge
from .profiles import Profile
from .shapes import Edge, Face, MassProperties, Part, SectionProperties, Shape, ShapeList, Shell, Sketch, Vertex, Wire
from .sketches import (ArcSlot, Circle, Ellipse, Hull, Polygon, Rectangle, RegularPolygon, RoundedRectangle, Slot,
                       Stroke, Trapezoid, Triangle, make_face)
from .text import Text
from ._kernel import KernelError, ModelingError
from .exporters import export, export_glb, export_gltf, export_obj, export_step, export_stl, import_stl, load, save
from .step_import import StepModel, import_step, read_step
from .dxf import export_dxf, import_dxf, import_dxf_wires
from .usd import export_usd, import_usd
from .render import diff_images, render
from .viewer import show
from .surfaces import ruled, stitch, surface, surface_fillet
from .sheetmetal import (Bend, FlatPattern, bend_allowance, bend_deduction, developed_length, flange,
                         flat_pattern, fold, unfold)

__version__ = "0.4.0"

__all__ = [
    # geometry
    "Vector", "Axis", "Plane", "Location", "Pos", "Rot", "BoundBox", "Hit", "Nurbs", "NurbsSurface", "Curvature",
    "Continuity", "ClosestPoints", "X", "Y", "Z", "TOLERANCE",
    "Align",
    # shapes
    "Shape", "ShapeList", "Vertex", "Edge", "Wire", "Face", "Shell", "Sketch", "Part", "MassProperties",
    "SectionProperties", "Mesh",
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
    "read_step", "StepModel",
    "export_dxf", "import_dxf", "import_dxf_wires", "export_usd", "import_usd",
    "show", "render", "diff_images",
    # errors
    "ModelingError", "KernelError",
]
