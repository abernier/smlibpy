<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/frontispiece.dark.svg"><img width="100%" src="docs/readme/frontispiece.light.svg" alt="Frontispiece and title page. Left: an engineering drawing of the pipe flange of examples/flange.py — a 120 mm plate with a 70 mm neck, bored 50 mm through, eight 10 mm bolt holes on a 95 mm circle — in section A–A, the view from the left and the plan in first-angle projection, dimensioned, with a title block that gives the volume smlibpy measures. Right: smlib·py, or, the Art of Modelling in Python — wherein the SMLib kernel is given to Python: to build exact parts from short scripts, to draw what it has built, and to prove the work in numbers. In four parts: the library, the renderer, the MCP server, the skill. MMXXVI."></picture>

# smlibpy

A Python library for 3D modeling on the [SMLib NURBS kernel](https://github.com/NVIDIA-Omniverse/usd-brep) with an API inspired by [cadquery](https://github.com/cadquery/cadquery) and [build123d](https://github.com/gumyr/build123d).

It comes with an MCP server, so your agent can build parts too.

```python
from smlibpy import *

plate = Box(80, 60, 10)
plate = plate.fillet(plate.edges().parallel_to(Z), 8)
plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)
plate -= Rectangle(30, 20).on(plate.faces().top()).extrude(-4)

plate.export("plate.step")
show(plate)
```

Parts are B-reps with exact surfaces: planes, cylinders, cones, spheres, tori and NURBS.
Volumes, areas and inertia are integrated over those surfaces, and STEP files keep them as they
are. You combine shapes with `+`, `-` and `&`, and every feature returns a new part. Faces and
edges are picked by their geometry, for example `part.faces().top()` or
`part.edges().parallel_to(Z).concave()`. The plate above builds in about 40 ms.

## Features

- Modeling: primitives, holes and patterns, Booleans, extrude (also tapered), revolve, loft,
  sweep (also along helices), shell, offset, draft, mirror, split, thicken
- Fillets: circular, variable-radius and curvature-continuous (G2/G3); chamfers
- Sketches and curves: rectangles, circles, ellipses, polygons, slots, trapezoids; lines, arcs,
  splines, Béziers, helices; 2D fillet and offset
- Surfaces: freeform surfaces from point grids, ruled surfaces, stitching into solids
- Selection by geometry: `top()`, `parallel_to()`, `concave()`, `circles()`, `largest()`,
  filters, sorting and grouping
- Measuring: volume, area, center and inertia from the exact surfaces, exact distances,
  intersections, validity
- Checks: every kernel result is checked; a fillet or shell that cannot work raises an error
  that says what fits
- Files: STEP in and out (exact geometry, assemblies, units, names, colors), STL, glTF/GLB, OBJ,
  SMLib's own format
- Pictures: a software renderer, no GPU or browser needed: shaded views, technical drawings
  (ISO E and A) with hidden lines and center lines, sections, x-ray, highlights, markers,
  zebra stripes, curvature maps, image diffs
- Agents: an MCP server with a live viewer, snapshots and a tested guide for every function,
  and a Claude Code plugin

## Install

```bash
pip install smlibpy
```

There are wheels for Linux (x86_64, aarch64), macOS (arm64, x86_64) and Windows, for Python
3.10 to 3.14, with the kernel compiled in. They are 5 to 7 MB. For agents, `pip install "smlibpy[mcp]"` adds the
MCP server; see [AI agents](docs/mcp.md).

To build from source you need CMake and a C++17 compiler (about a minute on a laptop):

```bash
git clone --recursive https://github.com/awv-informatik/smlibpy
cd smlibpy
pip install .
```

## For agents

The MCP server lets Claude and other agents model with smlibpy. In Claude Code:

```bash
claude plugin marketplace add awv-informatik/smlibpy
claude plugin install smlibpy@smlibpy
```

Other hosts start `uvx --from "smlibpy[mcp]" smlibpy-mcp`; see [AI agents](docs/mcp.md). The
agent works in four steps:

1. A skill tested on the real kernel: every function has a guide, written by agents that ran
   each call and wrote down what they found. The server hands the guides out, and its search
   knows CAD synonyms.
2. One script per step: the agent writes a whole step as a Python script and runs it. The
   session keeps the model between scripts; a kernel crash costs a restart, and the session is
   rebuilt from the scripts that made it.
3. A renderer to look with: `snapshot` draws the model in software, as technical drawings with
   hidden lines, sections, x-ray, highlighted selections, markers, zebra stripes or curvature
   maps.
4. Loops until it is right: after every step the agent checks numbers and pictures, fixes what
   is off, compares before and after on a pinned frame, and goes back to a checkpoint when a
   step fails.

<p align="center"><img src="docs/readme/renderer.png" width="100%" alt="What the snapshot tool draws: an iso view, technical drawings in first- and third-angle projection, hidden lines, a hatched section and section views, a before and after difference, a four-view sheet, highlights and markers, a sketch over a part, size annotations, x-ray, one color per body, a mirrored pair of views, zebra stripes and curvature maps of a circular fillet against a curvature-continuous blend."></p>

## A short tour

### Sketches

Sketches are 2D regions. Place them on a plane or a face, then extrude, revolve, loft or sweep
them.

```python
profile = Polygon((25, 0), (60, 0), (60, 12), (35, 12), (35, 40), (25, 40))
flange = profile.on(Plane.front).revolve(Z)
flange -= PolarLocations(47.5, 8) * Cylinder(5, 30)
```

### Selecting edges and faces

Selectors chain and always return lists. A list with one element works wherever a single shape
is expected.

```python
flange = flange.fillet(flange.edges().concave(), 4)
flange = flange.chamfer(flange.faces().top().edges().circles(), 1)
```

### Fillets

Fillets can be circular, vary in radius, or be curvature continuous.

```python
box = Box(30, 20, 10)
soft = box.fillet(box.edges(), 3, continuity="G2")
ramp = box.fillet(box.edges().parallel_to(Z).first, (1, 4))
```

### Surfaces

Open curves make surfaces. You can stitch them, thicken them, or start from a grid of points.

```python
import math

grid = [[(x, y, 4 * math.sin(x / 15) * math.cos(y / 15)) for x in range(0, 60, 10)] for y in range(0, 50, 10)]
panel = surface(grid).thicken(2)
```

### Measuring

```python
mp = flange.mass_properties(density=7.85e-3)   # steel, g/mm³
mp.mass, mp.center, mp.inertia
```

### Files

STEP, STL, glTF/GLB, OBJ and SMLib's own exact format.

```python
export_step([flange, panel.named("panel")], "parts.step")
export_glb(flange, "flange.glb")
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Concepts](docs/concepts.md): shapes, planes, locations, selections
- [Sketches](docs/sketches.md), [parts](docs/parts.md), [features](docs/features.md), [surfaces](docs/surfaces.md)
- [Measuring and analysis](docs/analysis.md), [files and viewer](docs/files.md)
- [Examples](docs/examples.md)
- [The kernel](docs/kernel.md): how smlibpy uses SMLib, accuracy, limitations
- [AI agents](docs/mcp.md): the MCP server, so Claude and other agents can model with smlibpy

## Status

smlibpy is new (version 0.1). It covers solid and surface modeling, and reads and writes STEP
with the exact geometry. Assemblies with product structure, dimensioned 2D drawings and text are not there
yet.

## License

smlibpy is MIT licensed. It builds and bundles the SMLib kernel from
[NVIDIA-Omniverse/usd-brep](https://github.com/NVIDIA-Omniverse/usd-brep), © NVIDIA, under
the Apache License 2.0; see [NOTICE](NOTICE).
