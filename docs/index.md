# smlibpy

![Parts modeled with smlibpy](images/hero.png)

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

smlibpy models solids and surfaces with exact geometry, in a style that keeps scripts
short and readable:

- **Shapes are values.** `+`, `-` and `&` combine them; features return new shapes.
- **Selections read like sentences.** `part.edges().parallel_to(Z).concave()`.
- **The full kernel.** Circular, variable and G2/G3 fillets, shells, lofts, sweeps,
  freeform surfaces, stitching, intersections, mass properties.
- **Exact files.** STEP in and out with the exact geometry; meshes go to glTF and STL.

<div class="grid cards" markdown>

- **[Getting started](getting-started.md)**: install, a first part, the viewer.
- **[Concepts](concepts.md)**: shapes, planes, placement, patterns, selection.
- **[Sketches](sketches.md)** and **[parts](parts.md)**: from 2D profiles to solids.
- **[Features](features.md)**: fillets, chamfers, shells, splits.
- **[Selecting](selecting.md)**: every way to pick faces and edges.
- **[Surfaces](surfaces.md)**: freeform modeling and stitching.
- **[Measuring](analysis.md)** and **[files](files.md)**: mass properties, STEP, glTF.
- **[Examples](examples.md)**: brackets, flanges, gears, a bottle.
- **[The kernel](kernel.md)**: how smlibpy uses SMLib, accuracy and limits.

</div>
