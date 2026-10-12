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

`unit` is the unit of the file: `"mm"` (default), `"cm"`, `"m"`, `"um"` or `"inch"`. The
model (in mm) is converted to it, so `bracket_inch.step` above holds a 2.362 x 1.575 x 0.315
inch part, which any CAD system (and `import_step`) reads as 60 x 40 x 8 mm.

### Meshes

`tolerance` is the largest distance between mesh and true surface (default: 0.1 % of the
part's size); `angle` limits the angle between neighbouring triangles on curved faces.

glTF is defined in meters: `export_glb` and `export_gltf` keep the positions in millimeters
and scale the scene's root node by 0.001, so viewers that respect units show the part at its
real size. STL and OBJ have no units and hold the millimeter values.

## Reading files

`load` picks the format from the extension, the same way `export` does:

```python
from smlibpy import *

Box(60, 40, 8).named("bracket").export("bracket.step")

bracket = load("bracket.step")   # exact, from any CAD system
print(bracket.name, bracket.volume)
```

STEP and SMLib's own `.smb` files give exact parts; an STL file gives a `Mesh`
(`import_stl`).

### STEP

`import_step(path)` reads the solids and surfaces of AP203, AP214 and AP242 files. A file
with one body returns a `Part`, or a `Shell` if it is a surface model. A file with several
returns a `ShapeList` with every body at its place in the assembly. Names and colors come
along (an unnamed solid takes the name of its product), and lengths are converted to
millimeters whatever unit the file uses.

Each face is rebuilt on the exact surface from the file and each edge on its exact curve:
a cylinder stays a cylinder, and a NURBS surface keeps its control points and knots. Faces
share their edges as they do in the file, so nothing is stitched together by tolerance.
A body that still comes out invalid goes through the kernel's healer; valid bodies are
left alone, and `heal=False` skips healing.

The importer is checked against OpenCASCADE on more than 400 files written by NX, CATIA,
Creo, SolidWorks, Inventor, Onshape, FreeCAD, KiCad and ClassCAD, the CAx-IF test models
among them. Not read yet: wireframe geometry, references to other files, PMI, and
assembly placements that mirror a part.

## Pictures

`render` draws shapes into a PNG without a browser or a graphics card, which suits
scripts, CI jobs and documentation:

```python
from smlibpy import *

part = Box(40, 30, 10) - Cylinder(6, 20)
render(part, path="part.png")                                 # isometric view
render(part, path="views.png", view="sheet", size=(1000, 760))  # ISO method E: front, left, top, iso
```

`view` takes a name (`"iso"`, `"front"`, `"back"`, `"left"`, `"right"`, `"top"`,
`"bottom"`), a direction from the model towards the camera, or `"sheet"`. Hidden edges stay
hidden, and the seams of round faces are left out. The function returns the PNG bytes, so in
a notebook `IPython.display.Image(render(part))` shows it inline.

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
