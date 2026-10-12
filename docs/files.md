# Files and viewer

## Writing files

`shape.export(path)` picks the format from the extension; the functions below give more
control. All of them accept a single shape or a list.

| Format | Function | Contents |
|---|---|---|
| STEP (`.step`, `.stp`) | `export_step` | exact B-rep, names and colors |
| SMLib (`.smb`) | `save` | the kernel's native format, exact and lossless |
| glTF (`.glb`, `.gltf`) | `export_glb`, `export_gltf` | triangles, edges as lines, colors, names |
| STL (`.stl`) | `export_stl` | triangles |
| OBJ (`.obj`) | `export_obj` | triangles |

```python
from smlibpy import *

bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")

export_step([bracket, cover], "assembly.step")
export_step(bracket, "bracket_inch.step", unit="inch")
export_stl(bracket, "bracket.stl", tolerance=0.01)
export_glb([bracket, cover], "assembly.glb")
save(bracket, "bracket.smb")
```

### STEP

The STEP writer produces AP214 files with the exact geometry: planes, cylinders, cones,
spheres, tori, lines, circles and ellipses as analytic entities, everything else as
(rational) B-splines with the kernel's own control points and knots. Solids become
`MANIFOLD_SOLID_BREP`s, hollow solids `BREP_WITH_VOIDS`, sheets open shells. Part names
and colors are kept. The output is checked in the test suite by reading it back with
OpenCASCADE.

`unit` declares the unit of the model: `"mm"` (default), `"cm"`, `"m"`, `"um"` or `"inch"`.
Coordinates are written as they are.

### Meshes

`tolerance` is the largest distance between mesh and true surface (default: 0.1 % of the
part's size); `angle` limits the angle between neighbouring triangles on curved faces.

## Reading files

```python
part = load("bracket.smb")       # exact
mesh = import_stl("bracket.stl")  # a Mesh
```

STEP import is on the roadmap.

## Viewer

```python
show(bracket)
show(bracket, cover, Spline((0, 0, 40), (30, 20, 50), (60, 0, 40)))
```

`show` displays parts, sketches, surfaces, faces, edges, wires and meshes together. In a
Jupyter notebook it renders inline; elsewhere it writes an HTML page and opens it in the
browser. The page is self-contained apart from three.js, which it loads from a CDN:
`show(part, path="part.html", open_browser=False)` keeps a copy to share.

In a notebook, a shape at the end of a cell shows itself.
