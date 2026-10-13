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

**Modeling**
- Primitives: `Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge`
- Holes: `Hole`, `CounterBoreHole`, `CounterSinkHole`, placed with `Locations`, `GridLocations`,
  `PolarLocations`, `HexLocations`
- Booleans: `fuse`, `cut`, `intersect`, which can also be written `+`, `-`, `&`
- Operations: `extrude` (also tapered), `revolve`, `loft`, `sweep` (also along helices), `shell`,
  `offset`, `thicken`, `draft`, `mirror`, `split`, `section`
- Fillets: circular, variable radius, and curvature-continuous (G2/G3); chamfers

**Sheet metal**
- `fold` and `flange` with exact bends (radius and K-factor)
- `unfold`, and `flat_pattern` with bend lines
- `bends()`, `bend_allowance`, `bend_deduction`, `developed_length`

**Deformation**
- `twist`, `taper` and `bend` work on finished parts. A tapered cylinder becomes an exact cone.
- Free-form deformation with a `Lattice`

**Simplifying:** `remove_fillets` and `remove_faces` take out fillets, holes and bosses, also on
imported parts. `faces().fillets()` finds the fillet faces.

**Molding:** `draft_analysis` sorts each face for a pull direction into positive, insufficient,
vertical or undercut. `parting_line` finds the parting line.

**2D**
- `Profile` is a pen: it draws lines and tangent arcs, turns, and adds fillets and chamfers at
  corners as it goes.
- Shapes: `Rectangle`, `RoundedRectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`,
  `Triangle`, `Trapezoid`, `Slot`, `ArcSlot`, `Hull`, and `Stroke` (a band along a path). The
  polygon shapes take `fillet=` and `chamfer=`.
- Exact 2D Booleans, offsets, and corner fillets and chamfers. Sketches can be extruded,
  revolved and swept.
- `Text` with exact font outlines (the Lato font is included)

**Curves and surfaces**
- Curves: `Line`, `Polyline`, `PolarLine`, `CenterArc`, `ThreePointArc`, `RadiusArc`,
  `SagittaArc`, `TangentArc`, `EllipticalArc`, `Spline`, `Bezier`, `Helix`, `FilletPolyline`
- Surfaces: `surface` through a grid of points, `ruled`, `stitch` (faces into a solid),
  `to_nurbs`

**Selection**
- By position (`top()`, `bottom()`, `nearest()`, …), by size (`largest()`, `smallest()`), and
  by geometry (`lines()`, `circles()`, `planar()`, `cylinders()`, `parallel_to()`, `facing()`,
  `convex()`, `concave()`, `fillets()`, …)
- `filter_by`, `sort_by`, `group_by`, set operators between lists, and `neighbors()` of a face

**Measuring and checks**
- `volume`, `area`, `center` and `mass_properties` (inertia, principal axes), computed from the
  exact surfaces to seven significant digits, with an error estimate
- `distance_to`, `closest_point`, `intersection_curves`, `silhouette`, `project`, `outline`,
  edge radius and convexity
- `is_valid` and `heal()`. Every kernel result is checked, and a fillet or shell that can't
  work raises an error that says what would fit.

**Files**
- STEP in and out: exact geometry, assemblies, units, names and colors (`named()`, `colored()`)
- DXF in and out with exact arcs and splines; STL in and out; glTF/GLB and OBJ out
- SMLib's own format (`save`, `load`)

**Pictures**
- `render()` needs no GPU or browser:
  - shaded views, and sheets of 2 or 4 views
  - technical drawings in first-angle (ISO E) or third-angle (ISO A) projection, with dashed
    hidden lines and center lines
  - sections, x-ray, highlights, markers, a measurement overlay, zebra stripes and curvature
    maps
- `diff_images` compares two renders.
- `show()` opens a 3D viewer in the browser or a notebook.

**Agents**
- The MCP server `smlibpy-mcp` has a live viewer, snapshots, function search and a tested guide
  for every function. People who want parametric apps that rebuild from sketches and features
  are sent to the [ClassCAD](https://classcad.ai) MCP.
- A Claude Code plugin, installed from this repository (see below)

## Install

```bash
pip install smlibpy
```

There are wheels for Linux (x86_64, aarch64), macOS (arm64, x86_64) and Windows, for Python
3.10 to 3.14, with the kernel compiled in. They are 5 to 7 MB, and numpy is the only
dependency. For agents, `pip install "smlibpy[mcp]"` adds the MCP server; see
[AI agents](docs/mcp.md).

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

### Text

Lettering is a sketch with the exact outlines of a font; `size` is the height of the capitals.

```python
tag = Box(60, 20, 3)
tag -= Text("SMLIB 01", 8).on(tag.faces().top()).extrude(-0.5)
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

STEP, DXF, STL, glTF/GLB, OBJ and SMLib's own exact format.

```python
export_step([flange, panel.named("panel")], "parts.step")
export_glb(flange, "flange.glb")
export_dxf(flange.section(Plane.XZ), "flange-profile.dxf")
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

smlibpy is new (version 0.2). It covers solid and surface modeling, text, and reads and writes
STEP and DXF with the exact geometry. Assemblies with product structure and dimensioned 2D
drawings are not there yet.

## License

smlibpy is MIT licensed. It builds and bundles the SMLib kernel from
[NVIDIA-Omniverse/usd-brep](https://github.com/NVIDIA-Omniverse/usd-brep), © NVIDIA, under
the Apache License 2.0; see [NOTICE](NOTICE).
