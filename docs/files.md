# Files and viewer

## Writing files

`shape.export(path)` picks the format from the extension; the functions below give more
control. All of them accept a single shape or a list.

| Format | Function | Contents |
|---|---|---|
| STEP (`.step`, `.stp`) | `export_step` | exact B-rep, names and colors; curves, points and coordinate systems |
| USD (`.usda`, `.usd`) | `export_usd` | exact B-rep as usd-brep's `BrepArray` prims and a mesh of each body for viewers, names and colors |
| OpenCASCADE (`.brep`) | `export_brep` | exact B-rep for OpenCASCADE, build123d, CadQuery and FreeCAD; no names or colors |
| SMLib (`.smb`) | `save` | the kernel's native format, exact (B-spline faces that are exactly planes, cylinders, cones, spheres or surfaces of revolution come back as those), one body |
| SMLib part file (`.smp`) | `save` | the kernel's part container: exact bodies and curves with their names and colors |
| DXF (`.dxf`) | `export_dxf` | 2D drawings: sketches, sections, text, curves; exact |
| glTF (`.glb`, `.gltf`) | `export_glb`, `export_gltf` | triangles, edges as lines, colors, names |
| STL (`.stl`) | `export_stl` | triangles |
| OBJ (`.obj`) | `export_obj` | triangles |

```python
from smlibpy import *

bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")

export_step([bracket, cover], "assembly.step", assembly=True)
export_step(bracket, "bracket_inch.step", unit="inch")
export_stl(bracket, "bracket.stl", tolerance=0.01)
export_glb([bracket, cover], "assembly.glb")
save(bracket, "bracket.smb")
save([bracket, cover], "assembly.smp")   # both, with their names and colors
```

Every writer and reader has a twin that works in memory, for web services, notebooks and
databases: `to_step`, `to_stl`, `to_obj`, `to_glb`, `to_gltf`, `to_dxf`, `to_usd`, `to_brep`,
`to_smb` and `to_smp` give the file's contents (text as `str`, binary formats as `bytes`),
`from_step`, `from_step_model`, `from_stl`, `from_dxf`, `from_dxf_wires`, `from_usd`, `from_brep`,
`from_iges`, `from_smb` and `from_smp` read them, with the keywords of the file functions:

```python
step = to_step(bracket)                  # the text export_step writes
print(from_step(step).name)              # bracket
glb = to_glb([bracket, cover])           # bytes, e.g. an HTTP response
print(len(from_smp(to_smp([bracket, cover], ascii=False))))   # 2
```

### STEP

The STEP writer produces AP214 files with the exact geometry: planes, cylinders, cones,
spheres, tori, lines, circles and ellipses as analytic entities, offset surfaces (the
fillets of SMLib's own `.smb` files, offsets read from STEP) as `OFFSET_SURFACE`s of their
basis, everything else as (rational) B-splines with the kernel's own control points and
knots. Solids become `MANIFOLD_SOLID_BREP`s, hollow solids `BREP_WITH_VOIDS`, sheets open
shells. Part names and colors are kept, in any characters (`"Bügel"`, `"部品"`: as ISO
10303-21's `\X2\` encoding, which other CAD systems read). The output is checked in the test
suite by reading it back with OpenCASCADE. A body with a face STEP cannot hold as the kernel
has it (an offset face that reaches past its basis) is written converted to NURBS, with a
warning.

All bodies go into one product (named `name`, by default after the file), each body a solid
with its own name. With `assembly=True` each body becomes a product of its own, named as the
body, in an assembly called `name`, so other CAD systems list the parts by name and can move
or replace them one by one (the `assembly.step` above). A body listed more than once (the
same object, `[bolt, bolt]`) is written once and placed as often. The bodies keep their
coordinates: each product is placed at the assembly's origin.

`unit` is the unit of the file: `"mm"` (default), `"cm"`, `"m"`, `"um"` or `"inch"`. The
model (in mm) is converted to it, so `bracket_inch.step` above holds a 2.362 x 1.575 x 0.315
inch part, which any CAD system (and `import_step`) reads as 60 x 40 x 8 mm. The file declares
the same length uncertainty in any unit: 1e-7 mm.

Curves, points and coordinate systems go into the file beside the bodies: an edge or wire is
written as a curve of wireframe geometry (a `GEOMETRIC_CURVE_SET`), a vertex or `Vector` as a
point, a `Plane` as a coordinate system of supplemental geometry, as tool catalogs and NX
write them. `StepCurve`, `StepPoint` and `StepFrame` give them names and colors, and the
`StepModel` that `read_step` gives is written whole, so a file read, changed and written
keeps them. `read_step` reads them back (below).

```python
path = Wire([Line((0, 0, 4), (30, 0, 4)), CenterArc((30, 10), 10, -90, 180)])
export_step([bracket, StepCurve("path", path, color=(1, 0, 0)), StepPoint("CRP", Vector(0, 0, 4)),
             StepFrame("MCS", Plane((0, 0, 4)))], "fixture.step")
fixture = read_step("fixture.step")
print(fixture, fixture.frame("MCS").origin)   # StepModel(1 bodies, 1 frames, 1 curves, 1 points) Vector(0, 0, 4)
```

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
A prim's name is the body's name with every character but ASCII letters, digits and `_` as
`_` (`"Größe"` is the prim `Gr__e`); the name itself is the prim's `displayName`, which
viewers show and `import_usd` gives back. Faces and edges keep their types: planes, cylinders,
cones, spheres and tori, and lines, circles and ellipses are written with the schema's own
surfaces and curves (a circle or an ellipse on a face the schema has no surface type for, such
as a surface of revolution, stays a B-spline), so a part read back selects its holes with
`edges().circles()` as the original does.

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

Omniverse and other renderers color parts by the materials bound to them and leave
`displayColor` aside: `materials=True` also writes a `Material` of each color (a
`UsdPreviewSurface`, under `/World/Looks`) and binds it to the prims of that color.
`import_usd` reads such bindings back. Edges, wires and points are not written (a `TypeError`
says which formats write curves), nor is an empty body, the result of a Boolean that left
nothing (a `ValueError`; meshes of it fail alike, where 0.4 said `tessellate failed`).

```python
export_usd([bracket, cover], "assembly_looks.usda", materials=True)
```

### OpenCASCADE

`export_brep` writes an OpenCASCADE `.brep` file (ASCII, as OpenCASCADE's `BRepTools::Write`
writes it): the B-rep format of OpenCASCADE and of the tools built on it, which build123d
(`import_brep`), CadQuery (`importBrep`), FreeCAD (`Part.read`) and OpenCASCADE itself read. It
is written with the bridge of NVIDIA's usd-brep, compiled into smlibpy (OpenCASCADE is not
needed). Faces keep their planes, cylinders, cones, spheres, tori and B-splines, edges their
lines, circles, ellipses and B-splines, and every edge gets the curves in the parameters of its
faces that OpenCASCADE requires, made from the exact geometry; surfaces of revolution and
extrusion are written as the B-splines they are in the kernel.

```python
export_brep(bracket, "bracket.brep")                 # one solid
export_brep([bracket, cover], "assembly.brep")       # a compound of two solids
print(to_brep(bracket).splitlines()[2])              # CASCADE Topology V3, (c) Open Cascade
```

The file holds one shape: the solid (or shell) of a single body, or a compound of the bodies;
a part of several solids gives one solid each, and a hollow one keeps its cavities. The format
has no names, colors or units: OpenCASCADE tools model in millimeters, as smlibpy does (write
STEP to keep names and colors). The writer was checked with OpenCASCADE 8.0
(`BRepCheck_Analyzer`, `BRepGProp`) on the 585 bodies of more than 400 STEP files from other CAD
systems: 583 are written, all valid for OpenCASCADE but one (a sheet that runs through itself
in its STEP file already), 566 with OpenCASCADE's volume within 1e-5 of smlibpy's and the rest
within 3.4e-4 (as far as smlibpy and OpenCASCADE measure the STEP file itself apart). The test
suite checks the files it writes for the faults OpenCASCADE's check finds. A body whose edge lies
farther from its face than 1e-3 of the body's size, or whose face boundary does not close, raises
`KernelError` that names the face; meshes, curves and points raise `TypeError`.

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

STEP, IGES (`.igs`, `.iges`), USD (`.usda`), OpenCASCADE (`.brep`) and SMLib's own `.smb` and
`.smp` files give exact parts (an `.smp` file its bodies with their names and colors, and its curves as edges and
wires), a DXF file the sketch of its outlines; an STL file gives a `Mesh` (`import_stl`).
`import_usd` reads the `BrepArray` prims of a USD text file, from smlibpy, usd-brep or Omniverse,
with their names and colors: the color of the material bound to a body (the `diffuseColor` of
its `UsdPreviewSurface`, through a `GeomSubset` of bodies, its prim or a prim above it), else its
`displayColor` (the meshes beside them are skipped); a merged part
(see [cells](features.md#cells)) comes back with its cells, from `.usda` and `.smb` alike. The
stage is read as USD composes it (its `subLayers` and the files its prims reference, relative to
the file), each body placed by the transforms of its prims and in millimeters (`metersPerUnit`,
`upAxis` turned to Z up; a stage that says neither is read as it is), and bodies from other
software are checked by the kernel before they are measured. usd-brep and Omniverse write every
edge as a B-spline: those that are lines, and circles on faces of analytic surfaces, come back as
lines and circles. A body that cannot be read raises an error that names it (`body 1 of the
BrepArray "/World/ball" could not be built`); `import_usd(path, partial=True)` leaves such bodies
out, with a warning each, and reads the others, as usd-brep's `allow_partial` does. A body
that is a solid and also holds wire edges, points or faces outside it (the schema allows mixed
dimensions; so do `.smb` files of other programs) comes with a warning that names them: such a
part is not valid, and `stitch(part.faces())` (or, for faces outside it, `part.solids()`) gives
the solid alone.

```python
# not run
parts = import_usd("plant.usda", partial=True)   # RuntimeWarning: import_usd: body 3 of ... it is left out
```

### STEP

`import_step(path)` reads the solids and surfaces of AP203, AP214 and AP242 files. A file
with one body returns a `Part`, or a `Shell` if it is a surface model. A file with several
returns a `ShapeList` with every body at its place in the assembly. Names and colors come
along (an unnamed solid takes the name of its product), and lengths are converted to
millimeters whatever unit the file uses.

Each face is rebuilt on the exact surface from the file and each edge on its exact curve:
a cylinder stays a cylinder, and a NURBS surface keeps its control points and knots. Faces
share their edges and vertices as they do in the file (a body has exactly the file's vertices),
so a well-formed file needs nothing stitched together by tolerance.
A body that still comes out invalid goes through the kernel's healer; valid bodies are
left alone, and `heal=False` skips healing. Where the healer cannot repair it because its
faces do not share their edges (writers that give every face edges of its own, or vertices a
little apart), the faces are stitched: by the kernel's stitch, then with tolerances from the
uncertainty the file declares up to 1e-3 of the body's size. The stitched body is kept only
if it is a valid solid, with a warning that names the body and the largest gap closed; a
body nothing repairs comes with a warning that says what is wrong with it. Surface models
whose faces share no edges are sewn the same way.

A body that cannot be read (an entity smlibpy does not read yet, such as `OFFSET_CURVE_3D`,
or one the kernel cannot build) is left out with a warning that names the body, its entity
and the reason, and the rest of the file is read; `strict=True` raises instead, and a file
none of whose bodies can be read raises. `read_step` lists them in `StepModel.skipped`. In
an assembly each product is built once, however often it is placed: its other instances are
copies moved to their places.

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
`MCS`): `product=` picks one by the beginning of its product's name. `export_step(tool, path)`
writes the model back, its curves, points and coordinate systems with it. `render(tool)` and the
live viewer draw the bodies and curves and mark the coordinate systems and named points.

### IGES

`import_iges(path)` (and `load` of `.igs` and `.iges`) reads the solids and surfaces of an IGES
file (IGES 5.3, ASCII), in millimeters whatever unit it declares, named (the name property or
the entity's label) and colored as the file has them. Most CAD systems write a solid as its
trimmed surfaces (entity 144), which share no edges: each becomes a face on its exact surface,
bounded by its exact curves, the faces are stitched where their edges meet, and each set of
faces that closes up becomes a `Part`, the rest `Shell`s. Solids written as B-rep objects
(186) come in as STEP solids do, their faces sharing the file's edges.

```python
# not run
part = import_iges("bracket.igs")      # a Part, or a ShapeList of the bodies the file holds
print(part.volume, part.is_valid())
```

Read: lines, circular and conic arcs, composite curves, linear paths, parametric and rational
B-spline curves; planes, cylinders, cones, spheres, tori, B-spline and parametric spline
surfaces, ruled surfaces, surfaces of revolution, tabulated cylinders and offset surfaces;
trimmed and bounded surfaces (where a boundary is given only in its surface's parameters, on a
B-spline surface it is taken onto the surface), bounded planes, untrimmed B-spline surfaces;
transformation matrices and subfigure instances. A surface of revolution or a tabulated cylinder
that is a plane, cylinder, cone, sphere or torus comes back as one. IGES does not say which way
a boundary runs: a face whose outer loop runs clockwise in its surface's parameters is turned
over, a hole that runs the way its outer loop does is turned round, and a face of no area (a
sliver some writers leave where faces meet) is left out. Something that cannot be read (an
entity smlibpy does not read, one the kernel cannot build) is left out with a warning that names
it; `strict=True` raises instead. The importer is checked against OpenCASCADE on the files it
writes in both forms, in millimeters and inches, and on the IGES models FreeCAD ships. Not read:
binary and compressed IGES, offset curves (130), ruled surfaces between circles or conics,
wireframe and annotation entities; IGES is not written (write STEP).

### OpenCASCADE

`import_brep(path)` (and `load` of `.brep`) reads the files of OpenCASCADE, build123d
(`export_brep`), CadQuery (`exportBrep`) and FreeCAD, ASCII (`BRepTools::Write`) and binary
(`BinTools::Write`) alike. Each solid of the file's shape becomes a `Part` and each shell or face
that belongs to no solid a `Shell`: one shape, or a `ShapeList` in the order of the file's
compound, placed as the file places them. Faces and edges keep their exact geometry: planes,
cylinders, cones, spheres, tori and B-splines come back as those, surfaces of extrusion and
revolution, Bezier surfaces and offset geometry as B-splines. `from_brep(data)` reads the
contents (`str` or `bytes`).

```python
back = import_brep("bracket.brep")
print(round(back.volume, 3), len(back.edges().circles()))   # 18797.876 2
both = load("assembly.brep")
print(len(both), [round(p.volume) for p in both])           # 2 [18798, 4800]
```

Each body is checked by the kernel before anything measures it, as for USD: one whose faces,
edges and vertices leave gaps of more than 1e-3 of its size raises `ValueError`, smaller gaps
give a warning; `check=False` skips the check, `heal=True` runs the kernel's import healer.
Wires, edges and vertices outside faces are not read (a warning says how many), and a file
whose shape holds no faces raises `ValueError`, as does one that is no `.brep` file or is
broken (the error names the shape). The importer is the bridge's: it reads usd-brep's test
files, and of the solids written above it reads 553 of 557 back (99 % with the volume they were
written with within 4e-6, all within 1e-4); the check refuses 4, whose edges the bridge rebuilds
running backwards, and a body whose curves on faces lie far from its edges (a swept spring) can
come back with gaps it refuses.

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

Some cutting software reads only lines and arcs. `curves="arcs"` writes splines and ellipses as
LINE and ARC entities within `tolerance` (0.01 mm by default), joined tangentially
(`Edge.to_arcs`); lines, arcs and circles stay as they are:

```python
export_dxf(Ellipse(40, 20) - Circle(5), "plate.dxf", curves="arcs")   # 48 arcs and a circle
```

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
