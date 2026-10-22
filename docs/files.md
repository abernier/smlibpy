# Files and viewer

## Writing files

`shape.export(path)` picks the format from the extension; the functions below give more
control. All of them accept a single shape or a list.

| Format | Function | Contents |
|---|---|---|
| STEP (`.step`, `.stp`) | `export_step` | exact B-rep, names and colors |
| USD (`.usda`, `.usd`) | `export_usd` | exact B-rep as usd-brep's `BrepArray` prims and a mesh of each body for viewers, names and colors |
| SMLib (`.smb`) | `save` | the kernel's native format, exact (B-spline faces that are exactly planes, cylinders, cones, spheres or surfaces of revolution come back as those) |
| DXF (`.dxf`) | `export_dxf` | 2D drawings: sketches, sections, text, curves; exact |
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

### Colors and names of faces

Besides the body's own name and color, single faces can have one: `colored(color, faces=...)` and
`named(name, faces=...)` give them to the selected faces (the body keeps its own), `face.color` and
`face.name` read them. They stay with the faces through later operations: both pieces of a face a
cut splits keep them, the walls of a hole keep the color of the tool's faces, a fillet's rounds
have none. STEP files write them on the faces (a `STYLED_ITEM` per `ADVANCED_FACE`, the face's
name), and `import_step` reads them from files of other systems too; glTF files, USD meshes,
pictures and the viewer show the colors.

```python
tool = Cylinder(5, 20)
tool = tool.colored("red", faces=tool.faces())          # every hole it cuts has red walls
plate = (Box(60, 40, 8) - tool).named("plate").colored("steelblue")
plate = plate.colored("gold", faces=plate.faces().top()).named("seal", faces=plate.faces().bottom())
print([f.color for f in plate.faces().cylinders()])     # [(1.0, 0.0, 0.0)]
export_step(plate, "plate.step")
back = import_step("plate.step")
print(back.faces().top()[0].color, back.faces().bottom()[0].name)   # (1.0, 0.843..., 0.0) seal
```

The native format (`.smb`) holds neither, nor the body's name and color.

### USD

`export_usd` writes each body as a `BrepArray` prim, the B-rep of NVIDIA's usd-brep (its
omniSolid schema), with the exact surfaces and curves, its name and its color, under `/World`
in a stage in millimeters with Z up. usd-brep, its usdview plugin and Omniverse read them as
solids. Other USD viewers draw only meshes, so each body also gets a `Mesh` prim
(`<name>_mesh`); `mesh=False` leaves it out, for the tools that draw the B-rep themselves and
would show the body twice. The test suite checks the files with NVIDIA's validator and OpenUSD.

```python
export_usd([bracket, cover], "assembly.usda")              # B-reps, and meshes for viewers
export_usd(bracket, "bracket_exact.usda", mesh=False)     # the exact B-rep alone
```

The files are text (`.usda`). OpenUSD converts them: `usdcat out.usda -o out.usdc` to binary,
`usdzip out.usdz out.usda` to a package (with `pip install usd-core`, in Python:
`Sdf.Layer.FindOrOpen("out.usda").Export("out.usdc")` and
`UsdUtils.CreateNewUsdzPackage("out.usda", "out.usdz")`). Viewers that honour the stage's units
show the parts at their real size, a 60 mm bracket 6 cm long in a scene measured in meters: zoom
to it if the viewer does not.

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

STEP, USD (`.usda`) and SMLib's own `.smb` files give exact parts, a DXF file the sketch of its
outlines; an STL file gives a `Mesh` (`import_stl`). `import_usd` reads the `BrepArray` prims of
a USD text file, from smlibpy, usd-brep or Omniverse, with their names and colors (the meshes
beside them are skipped); a merged part
(see [cells](features.md#cells)) comes back with its cells, from `.usda` and `.smb` alike. The
stage is read as USD composes it (its `subLayers` and the files its prims reference, relative to
the file), each body placed by the transforms of its prims and in millimeters (`metersPerUnit`,
`upAxis` turned to Z up; a stage that says neither is read as it is), and bodies from other
software are checked by the kernel before they are measured.

### STEP

`import_step(path)` reads the solids and surfaces of AP203, AP214 and AP242 files. A file
with one body returns a `Part`, or a `Shell` if it is a surface model. A file with several
returns a `ShapeList` with every body at its place in the assembly. Names and colors come
along (an unnamed solid takes the name of its product), and lengths are converted to
millimeters whatever unit the file uses.

Each face is rebuilt on the exact surface from the file and each edge on its exact curve:
a cylinder stays a cylinder, and a NURBS surface keeps its control points and knots. Faces
share their edges and vertices as they do in the file (a body has exactly the file's vertices),
so nothing is stitched together by tolerance.
A body that still comes out invalid goes through the kernel's healer; valid bodies are
left alone, and `heal=False` skips healing.

Some writers leave out the seams of round faces: NX writes the shank of a drill as the
circle at one end and the outline of its flat at the other, and small roundings as
extruded ellipses bounded by their two ends. The importer gives such faces the seam edge
the kernel needs to mesh and integrate them, and turns a surface's own seam (where its
angle starts, also around the tube of a torus) to where the face has its seam edge, or
out of the face. B-spline surfaces that close on themselves get the same: the seam of the
surface moves off a face that lies across it, and a face that runs all the way around one
without a seam edge (the hub of an impeller) gets one.

Files from tool catalogs bring more: a face whose `same_sense` flag says the opposite of
its loops (the loops decide, as they agree with the neighbouring faces), a loop that runs
up a cut into its face and back (dropped where the rest of the loop does not go around the
surface), and cavities (`BREP_WITH_VOIDS`), which become void regions inside the solid as
the file has them rather than a Boolean difference.

The importer is checked against OpenCASCADE on more than 400 files written by NX, CATIA,
Creo, SolidWorks, Inventor, Onshape, FreeCAD, KiCad and ClassCAD, the CAx-IF test models
among them. Not read yet: wireframe topology (`EDGE_BASED_WIREFRAME_MODEL`), references to
other files, PMI, and assembly placements that mirror a part.

#### Coordinate systems, curves and points

`read_step(path)` reads what `import_step` reads, and also what belongs to no body: the
coordinate systems (the placements of supplemental geometry, and named placements), the
curves (curve sets, trimmed and composite curves) and the points. Tool catalogs and NX
write a cutting tool so, with its mounting and reference systems (`MCS`, `PCS`, `CSW`) and
its cutting edge line. Each comes with its name and the product it belongs to, at its place
in the assembly, in millimeters; items on hidden layers are left out.

```python
# not run
tool = read_step("drill.stp")
print(tool)                      # StepModel(3 bodies, 9 frames, 2 curves, 10 points)
for f in tool.frames:
    print(f.name, f.product, f.plane.origin)
mcs = tool.frame("MCS", product="NOCUT")       # a Plane: origin, x_dir, z_dir
edge = tool.curves[0].shape                    # the cutting edge line, an Edge
holder = holder.moved(mcs.location)            # put something on the tool's MCS
```

`tool.bodies` is always a `ShapeList`. `frame(name)` raises when the name is missing, or when
several products have a coordinate system of that name (each part of an assembly has its own
`MCS`): `product=` picks one by the beginning of its product's name. `render(tool)` and the
live viewer draw the bodies and curves and mark the coordinate systems and named points.

## DXF

DXF is the exchange format of 2D drawings: laser cutters, CNC software and 2D CAD programs read
it. `export_dxf` writes sketches, cross-sections of parts, text, wires and edges with exact
entities: lines, arcs, circles, ellipses, and splines with their control points, knots and
weights.

```python
part = Box(40, 30, 20) - Cylinder(8, 30)
export_dxf(part.section(Plane.XY), "section.dxf")      # four lines and a circle
export_dxf(part.section(Plane.XZ), "side.dxf")         # drawn in the XZ plane: x and z
tag = [RoundedRectangle(40, 12, 2).named("cut"), Text("PART 7", 5).named("engrave")]
export_dxf(tag, "tag.dxf", unit="inch")                # two layers, in inches
```

The kernel returns the edges of a section as B-splines, also where the part is round. The writer
recognizes the circular ones and writes them as arcs and circles, so a drawing program sees the
hole above as a circle of radius 8. Shapes lying in the XY plane are drawn with their X and Y; a
sketch in another plane is drawn in that plane's own coordinates, and `plane=` chooses the plane
explicitly. A shape's name becomes its layer. `unit` converts the millimeters of the model, as
it does for STEP, and the file declares its unit in `$INSUNITS`.

`import_dxf` reads the closed outlines of a drawing as a sketch, in millimeters and at the
drawing's coordinates:

```python
outline = import_dxf("section.dxf")
plate = outline.extrude(6)
cut_only = import_dxf("tag.dxf", layers=["cut"])
print(round(plate.volume, 3), cut_only.bbox().size)    # 5993.628 Vector(40, 12, 0)
```

It reads lines, arcs, circles, ellipses, polylines (their bulges become exact arcs), splines
(as exact NURBS) and inserted blocks, also scaled, mirrored, rotated and nested ones. Text,
hatches and dimensions are left out with a warning. The file's unit is converted to millimeters;
a file without one is read as millimeters, and `unit=` overrides it.

The curves are joined end to end into loops. A loop inside another one is a hole, and a loop
inside a hole is an island again. When curves do not close, the error names the loose ends, their
layers and the size of the gap; `layers=` reads only the outline's layers, and `tolerance=`
joins ends that are a little apart. Lettering drawn inside an outline would turn into holes of
it, so read such layers one at a time. `import_dxf_wires` returns every chain of curves as a
wire, open or closed, for paths and for drawings that are not outlines.

## Pictures

`render` draws shapes into a PNG without a browser or a graphics card, which suits
scripts, CI jobs, documentation, and agents that check what they built:

```python
from smlibpy import *

part = Box(40, 30, 10) - Cylinder(6, 20)
render(part, path="part.png")                                      # isometric view
render(part, path="drawing.png", drawing=True, size=(1000, 750))   # technical drawing
```

The views are orthographic with Z up. `view` takes a name (`"iso"`, `"front"`, `"back"`,
`"left"`, `"right"`, `"top"`, `"bottom"`), turntable angles (`{"azimuth": 30, "elevation":
20}`, azimuth 0 from the front, 90 from +X), the direction a camera looks in (`{"direction":
(0, 1, 0)}`), or a direction from the model towards the camera (`(1, -1, -1)`). `"iso"` is a
true isometric view from (1, -1, 1). `zoom` and `look_at` frame a detail.

`drawing=True` is a technical drawing in ISO projection method E (first angle): the front
view, the view from the left to its right, the top view below it, in line style with hidden
edges dashed and center lines through holes, at one scale, and a shaded iso view.
`drawing="third-angle"` places them by method A (top view above, view from the right).
`view="sheet"` gives the method E drawing as well. `lines=True` draws a single view in line
style; `sheet=True` shows four shaded views at once.

Further options show what a shaded picture hides:

```python
render(part, path="cut.png", section=Plane.XZ)                      # the front half cut away, hatched
render(part, path="top.png", highlight=part.faces().top(), markers=[((0, 0, 5), "bore")])
render(part, path="size.png", annotate=True)                        # size, axes and a scale bar
render(part, path="inside.png", xray=True)                          # translucent
```

Two more modes judge the surfaces themselves, from the exact geometry rather than the
triangles: zebra stripes (the reflection of parallel light lines) and curvature maps. They
tell a circular fillet from a curvature-continuous blend, which a shaded picture cannot:

```python
box = Box(40, 40, 20)
soft = box.fillet(box.edges().parallel_to(Z), 8, continuity="G2")
render(soft, path="zebra.png", zebra=True)         # the stripes bend smoothly into the blends
render(soft, path="curvature.png", curvature="max")  # blue concave, white flat, red convex, in 1/mm
```

At a circular fillet (`continuity=None`) the stripes kink where it meets the next face and its
curvature map is one color; across a G2 blend the stripes run on smoothly and its curvature
rises from zero at the joints. `curvature` takes `"mean"`, `"gaussian"`, `"max"` or `"min"`,
and a legend gives the range.

The result is the PNG file as `bytes` (a notebook shows it with
`IPython.display.Image(render(part))`), with `.pixels` and `.frame`. The frame pins scale and
middle for a later picture of a changed model, and `diff_images` counts what changed:

```python
before = render(part)
after = render(part - Cylinder(3, 20).translate(12, 0, 0), frame=before)
change = diff_images(before, after)
print(change.changed, change.bbox)       # pixels that differ, and where
change.save("change.png")                # the change in red
```

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
