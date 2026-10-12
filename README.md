<p align="center">
  <img src="docs/images/hero.png" alt="Parts modeled with smlibpy" width="100%">
</p>

# smlibpy

**Python CAD on SMLib, the NURBS solid modeling kernel NVIDIA released as open source.**

```python
from smlibpy import *

plate = Box(80, 60, 10)
plate = plate.fillet(plate.edges().parallel_to(Z), 8)
plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)
plate -= Rectangle(30, 20).on(plate.faces().top()).extrude(-4)

plate.export("plate.step")
show(plate)
```

- **Exact.** Parts are boundary representations of NURBS and analytic surfaces. Volumes, areas and
  inertia come from integration over that exact geometry (relative error below 1e-6), and STEP files
  carry it too, with planes, cylinders and cones written as such.
- **One way to model.** Shapes are values. `+`, `-` and `&` combine them; features are methods that
  return new shapes. There are no builder contexts and no hidden state.
- **Selections that read like English.** `part.faces().top()`,
  `part.edges().parallel_to(Z).concave()`, `part.faces().cylinders().largest()`.
- **The whole kernel.** Circular, variable-radius and curvature-continuous (G2/G3) blend fillets,
  drafted extrusions, lofts, sweeps, shells, freeform surfaces, stitching, intersections,
  silhouettes, mesh Booleans and mass properties.
- **Fast.** The plate above builds in about 40 ms.

## Install

```bash
pip install smlibpy
```

Wheels are there for Linux (x86_64, aarch64), macOS (arm64, x86_64) and Windows on Python
3.10 to 3.14, with the kernel compiled in. For agents, `pip install "smlibpy[mcp]"` adds the
MCP server; see [AI agents](docs/mcp.md).

To build from source you need CMake and a C++17 compiler (about a minute on a laptop):

```bash
git clone --recursive https://github.com/awv-informatik/smlibpy
cd smlibpy
pip install .
```

## A short tour

**Sketch, then build.** Sketches are 2D regions; place them on any plane or face, then extrude,
revolve, loft or sweep them.

```python
profile = Polygon((25, 0), (60, 0), (60, 12), (35, 12), (35, 40), (25, 40))
flange = profile.on(Plane.front).revolve(Z)
flange -= PolarLocations(47.5, 8) * Cylinder(5, 30)
```

**Select and finish.** Selectors chain and always return lists; a one-element list works wherever
a single shape is expected.

```python
flange = flange.fillet(flange.edges().concave(), 4)
flange = flange.chamfer(flange.faces().top().edges().circles(), 1)
```

**Smooth blends.** Fillets can be circular, vary in radius, or be curvature continuous.

```python
box = Box(30, 20, 10)
soft = box.fillet(box.edges(), 3, continuity="G2")
ramp = box.fillet(box.edges().parallel_to(Z).first, (1, 4))
```

**Surfaces.** Open curves make surfaces; stitch them, thicken them, or start from a point grid.

```python
import math

grid = [[(x, y, 4 * math.sin(x / 15) * math.cos(y / 15)) for x in range(0, 60, 10)] for y in range(0, 50, 10)]
panel = surface(grid).thicken(2)
```

**Measure.**

```python
mp = flange.mass_properties(density=7.85e-3)   # steel, g/mm³
mp.mass, mp.center, mp.inertia
```

**Exchange.** STEP, STL, glTF/GLB, OBJ and SMLib's exact native format.

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

smlibpy is young. It covers solid and surface modeling, and reads and writes STEP with
the exact geometry. Assemblies with product structure, 2D drawings and text are next.

## License

smlibpy is MIT licensed. It builds and bundles the SMLib kernel from
[NVIDIA-Omniverse/usd-brep](https://github.com/NVIDIA-Omniverse/usd-brep), © NVIDIA, under
the Apache License 2.0; see [NOTICE](NOTICE).
