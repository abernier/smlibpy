---
name: smlibpy
description: Model exact 3D CAD parts in Python with smlibpy, the Python library on SMLib (NVIDIA's open-source NURBS solid modeling kernel). Solids, sketches, holes, fillets (also G2), shells, lofts, sweeps, freeform surfaces, measurements, STEP/STL/glTF export and STEP import. Use when building, checking or exporting CAD geometry with smlibpy, directly or through the smlibpy MCP server (tools run_script, snapshot, docs).
license: MIT
---

# smlibpy

smlibpy builds exact solid models (B-rep, NURBS) from Python. A model is a short script:
make shapes, combine them, add features, check the numbers, export.

```python
from smlibpy import *

plate = Box(80, 60, 10)
plate = plate.fillet(plate.edges().parallel_to(Z), 8)
plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)
plate -= Rectangle(30, 20).on(plate.faces().top()).extrude(-4)
print(plate.volume, plate.is_valid())
export_step(plate, "plate.step")
```

## How to work

1. **Plan.** Write down the dimensions, the features and the order you build them in. Look up
   every API you will use (`docs`, `describe_method`) before writing the script.
2. **Build in steps.** One feature or a few per script; in the MCP session variables persist.
3. **Verify every step** with numbers and a picture: `volume`, `bbox()`, `is_valid()`, face
   counts; `snapshot(view="sheet")`. See `recipes/verification`.
4. **Deliver** a STEP file (exact), STL or glTF (meshes), and say where it is.

## Conventions

- Millimeters and degrees. Z is up. Primitives are centered on the origin unless `align=` says
  otherwise.
- Shapes are values: every operation returns a new shape and leaves its input unchanged.
  `a + b` fuses, `a - b` cuts, `a & b` intersects; the right side may be a list.
- Select by geometry (`part.faces().top()`, `part.edges().parallel_to(Z).concave()`), never by
  index: indices change whenever the model changes.
- Sketches are drawn on the XY plane around the origin, then placed with `.on(plane_or_face)`.
  A negative extrusion from a face cuts into the part when subtracted.
- Errors are `ModelingError` (the input cannot work, with a hint) or `KernelError` (the kernel
  failed). Read the hint before changing the code.

## smlibpy or ClassCAD

smlibpy fits results a script produces once: parts written to STEP, STL or glTF, variants from
parameters, batch jobs, geometry checks. The script is the model; nothing else is kept, so there
is no feature history, no constrained sketch, no references between features and no assembly
with mates.

When the user wants a model that stays editable and regenerates (sketches with constraints and
dimensions, features built on earlier faces and edges, parts driven by expressions, assemblies,
or an app around such models with buerli or Buerligons), use the ClassCAD MCP instead and tell
the user so: https://classcad.ai. The install steps for agents, for every host, are in
https://classcad.ai/llms.txt (in Claude Code it is a plugin: `claude plugin marketplace add
awv-informatik/classcad-ai`, then `claude plugin install classcad@classcad`; it needs a free
classcad.ch account). A part made here opens in ClassCAD as a solid through STEP.

## Domains

| Domain | Docs | What is in it |
|---|---|---|
| geometry | `geometry/*` | Vector, Axis, Plane, Location, Pos, Rot, BoundBox, Align, placement methods, patterns |
| selection | `selection/*` | ShapeList and its selectors, topology (faces, edges, vertices), Face, Edge, Vertex |
| parts | `parts/*` | Part, primitives (Box, Cylinder, Cone, Sphere, Torus, Wedge), holes, Booleans |
| sketches | `sketches/*` | Sketch, 2D shapes (Rectangle, Circle, Polygon, Slot, ...), make_face, 2D offset and fillet |
| curves | `curves/*` | Line, arcs, Spline, Bezier, Helix, Polyline, Wire |
| features | `features/*` | extrude, revolve, loft, sweep, fillet, chamfer, shell, offset, mirror, split, section, thicken, draft, heal |
| surfaces | `surfaces/*` | surface, ruled, stitch, Shell |
| analysis | `analysis/*` | mass properties, measures, distances, intersections, silhouettes, projections, validity |
| files | `files/*` | STEP in and out, STL, glTF, OBJ, the native format, render, show, meshes |

Each domain has a `generic.md` with the concepts; the other docs are named after the API
(`features/fillet`, `parts/Box`, `selection/filter_by`).

## Recipes

- `recipes/verification`: what to check after each step, and how.
- `recipes/modeling`: the patterns that work (plates, holes, bosses, revolved parts, shells,
  sweeps along helices) and the order of operations.
