"""smlibpy — Python CAD modeling on SMLib, the open-source NURBS solid modeling kernel.

    from smlibpy import *

    plate = Box(80, 60, 10)
    plate = plate.fillet(plate.edges().parallel_to(Z), 8)
    plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)
    plate.export("plate.step")
"""

from .align import Align
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
)
from .geometry import TOLERANCE, Axis, BoundBox, Location, Plane, Pos, Rot, Vector, X, Y, Z
from .locations import GridLocations, HexLocations, Locations, PolarLocations
from .mesh import Mesh, tessellate
from .operations import chamfer, extrude, fillet, loft, mirror, offset, revolve, section, shell, split, sweep, thicken
from .parts import Box, Cone, CounterBoreHole, CounterSinkHole, Cylinder, Hole, Sphere, Torus, Wedge
from .shapes import Edge, Face, MassProperties, Part, Shape, ShapeList, Shell, Sketch, Vertex, Wire
from .sketches import Circle, Ellipse, Polygon, Rectangle, RegularPolygon, RoundedRectangle, Slot, Trapezoid, make_face
from .text import Text
from ._kernel import KernelError, ModelingError
from .exporters import export, export_glb, export_gltf, export_obj, export_step, export_stl, import_stl, load, save
from .step_import import import_step
from .dxf import export_dxf, import_dxf, import_dxf_wires
from .render import render
from .viewer import show
from .surfaces import ruled, stitch, surface

__version__ = "0.1.2"

__all__ = [
    # geometry
    "Vector", "Axis", "Plane", "Location", "Pos", "Rot", "BoundBox", "X", "Y", "Z", "TOLERANCE", "Align",
    # shapes
    "Shape", "ShapeList", "Vertex", "Edge", "Wire", "Face", "Shell", "Sketch", "Part", "MassProperties", "Mesh",
    # curves
    "Line", "Polyline", "PolarLine", "CenterArc", "ThreePointArc", "RadiusArc", "SagittaArc", "TangentArc",
    "EllipticalArc", "Spline", "Bezier", "Helix", "FilletPolyline",
    # sketches
    "Rectangle", "RoundedRectangle", "Circle", "Ellipse", "Polygon", "RegularPolygon", "Slot", "Trapezoid", "make_face",
    "Text",
    # parts
    "Box", "Cylinder", "Cone", "Sphere", "Torus", "Wedge", "Hole", "CounterBoreHole", "CounterSinkHole",
    # patterns
    "Locations", "GridLocations", "PolarLocations", "HexLocations",
    # operations
    "extrude", "revolve", "loft", "sweep", "fillet", "chamfer", "shell", "offset", "mirror", "split", "section",
    "thicken", "tessellate",
    # surfaces
    "surface", "ruled", "stitch",
    # files and viewer
    "export", "export_step", "export_stl", "export_glb", "export_gltf", "export_obj", "save", "load", "import_stl", "import_step",
    "export_dxf", "import_dxf", "import_dxf_wires",
    "show", "render",
    # errors
    "ModelingError", "KernelError",
]
