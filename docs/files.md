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
| DXF (`.dxf`) | `export_dxf` | 2D drawings: sketches, sections, text, curves, drawing views; exact |
| SVG (`.svg`) | `export_svg` | 2D drawings: drawing views (hidden lines dashed), curves; at true size |
| glTF (`.glb`, `.gltf`) | `export_glb`, `export_gltf` | indexed triangles with normals, edges as lines, colors, names |
| STL (`.stl`) | `export_stl` | triangles |
| OBJ (`.obj`) | `export_obj` | triangles with normals |

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
databases: `to_step`, `to_stl`, `to_obj`, `to_glb`, `to_gltf`, `to_dxf`, `to_svg`, `to_usd`,
`to_brep`, `to_smb` and `to_smp` give the file's contents (text as `str`, binary formats as
`bytes`), `from_step`, `from_step_model`, `from_stl`, `from_dxf`, `from_dxf_wires`, `from_usd`,
`from_brep`, `from_iges`, `from_smb` and `from_smp` read them, with the keywords of the file
functions.
`to_file(shapes, name)` and `from_file(data, name)` pick the format from a file name's
extension, as `export` and `load` do from a path:

```python
step = to_step(bracket)                  # the text export_step writes
print(from_step(step).name)              # bracket
glb = to_glb([bracket, cover])           # bytes, e.g. an HTTP response
print(len(from_smp(to_smp([bracket, cover], ascii=False))))   # 2
print(from_file(to_file(bracket, "b.stp"), "b.stp").name)    # bracket: by the extension
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
warning. A face whose boundary passes a vertex twice (a thin hole that reaches its border there,
as where the pieces of a sweep meet at a corner) is written with the loops between, one bound
each: OpenCASCADE walks such a boundary the wrong way at that vertex. `import_step` joins them
into one loop again, as the kernel has it (and so does `import_brep`, whose files the writer
splits the same way).

All bodies go into one product (named `name`, by default after the file), each body a solid
with its own name. With `assembly=True` each body becomes a product of its own, named as the
body, in an assembly called `name`, so other CAD systems list the parts by name and can move
or replace them one by one (the `assembly.step` above). In an assembly, a body listed more than
once (the same object, `[bolt, bolt]`) is written once and placed as often. The bodies keep their
coordinates: each product is placed at the assembly's origin.

`unit` is the unit of the file: `"mm"` (default), `"cm"`, `"m"`, `"um"` or `"inch"`. The
model (in mm) is converted to it, so `bracket_inch.step` above holds a 2.362 x 1.575 x 0.315
inch part, which any CAD system (and `import_step`) reads as 60 x 40 x 8 mm. The file declares
the same length uncertainty in any unit: 1e-7 mm.

Curves, points and coordinate systems go into the file beside the bodies: an edge or wire is
written as a curve of wireframe geometry (a `GEOMETRIC_CURVE_SET`), a vertex or `Vector` as a
point, a `Plane` as a coordinate system of supplemental geometry, as tool catalogs and NX
write them. `StepCurve`, `StepPoint` and `StepFrame` give them names and colors (a coordinate
system's color as a curve style, as NX writes it), and the
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
would show the body twice. The test suite checks the files with the BrepArray rules of NVIDIA's
validator (usd-brep's `brep_validator`, through `tools/oracles/usd_validator.py`) and with OpenUSD,
and with the validator itself (`validate_file`: the BrepArray rules and the asset validator's
general USD rules) where it is installed: `pip install "usd-validation-nvidia[usd]"` on any
platform, or `usd-brep[validation]`. CI's macOS job, its Linux x86_64 job on Python 3.12 and its
JavaScript job install it and fail without it. Every file passes the BrepArray rules; of the
general rules only `UsdAsciiPerformanceChecker` complains, which asks for large arrays in binary
(crate) files.
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
STEP to keep names and colors). Each edge, vertex and face is written with the tolerance it
needs (what its curve keeps from its curves on faces and its vertices, at least that of the
body's size). The writer was checked with OpenCASCADE 8.0 (`BRepCheck_Analyzer`, `BRepGProp`) on
the 585 bodies of more than 400 STEP files from other CAD systems: all are written, valid for
OpenCASCADE but three that OpenCASCADE takes for invalid in their STEP files too (a sheet that
runs through itself, a solid with 16 cavities, a sheet with gaps of 4 mm), 541 of the 558 it
measures with its volume within 1e-5 of smlibpy's and the rest within 3.4e-4 (as far as smlibpy
and OpenCASCADE measure the STEP file itself apart). The test suite checks the files it writes
for the faults OpenCASCADE's check finds. A face's loop that passes a vertex twice is written as
the wires between, and an edge that a loop runs along and straight back (a strut a fuse can leave)
is left out of the wire: OpenCASCADE takes either for a wire that does not close. A body whose edge lies
farther from its face than 1e-3 of the body's size, or whose face boundary does not close, raises
`KernelError` that names the face; meshes, curves and points raise `TypeError`.

### Meshes

`tolerance` is the largest distance between mesh and true surface (default: 0.1 % of the
part's size); `angle` limits the angle between neighbouring triangles on curved faces;
`max_edge` the length of the triangles' edges (default: no limit).

glTF is defined in meters: `export_glb` and `export_gltf` keep the positions in millimeters
and scale the scene's root node by 0.001, so viewers that respect units show the part at its
real size. STL and OBJ have no units and hold the millimeter values.

Meshes are computed in double precision. STL and glTF store float32 (7 digits): glTF positions
are kept relative to the middle of each shape, whose node moves them there, so a part 1 km from
the origin keeps its shape in glTF (in STL its points are off by up to 0.03 mm there); OBJ writes
12 digits. glTF materials hold colors linear, as the format defines them: the sRGB colors of
`colored("#7c93b5")` are converted, so viewers show the color asked for.

glTF and OBJ keep the mesh's normals, those of the exact surface: edges stay sharp where faces
meet at an angle, and curved faces shade smooth. OBJ names the normal of each corner
(`f 3//7 ...`, each distinct normal written once); glTF writes each distinct pair of a point and
its normal once and the triangles as indices into them (16-bit, 32-bit above 65 535 pairs), about
a third of the corners:

```python
from smlibpy.exporters import gltf_document

doc, _ = gltf_document(Box(60, 40, 8) - Cylinder(4, 10), edges=False)
prim = doc["meshes"][0]["primitives"][0]
print(doc["accessors"][prim["attributes"]["POSITION"]]["count"],
      doc["accessors"][prim["indices"]]["count"])        # 152 432: 152 corners for 144 triangles
```

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
lines and circles. A body that cannot be read is left out, with a warning that names it and says
why (`body 1 of the BrepArray "/World/ball" could not be built`), and the others are read, as
usd-brep's `allow_partial` does and as `import_step`, `import_iges` and `import_brep` do;
`import_usd(path, strict=True)` raises for it instead (`ValueError` for a malformed body or one the
check refuses, `KernelError` for one the kernel cannot build), and a file with no readable body
raises `ModelingError` either way. A body
that is a solid and also holds wire edges, points or faces outside it (the schema allows mixed
dimensions; so do `.smb` files of other programs) comes with a warning that names them: such a
part is not valid, and `stitch(part.faces())` (or, for faces outside it, `part.solids()`) gives
the solid alone.

```python
# not run
parts = import_usd("plant.usda")                 # RuntimeWarning: import_usd: body 3 of ... it is left out
parts = import_usd("plant.usda", strict=True)    # raises for body 3 instead
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

A body that cannot be read (an entity smlibpy does not read yet, such as a `CLOTHOID`,
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
among them. Offset curves (`OFFSET_CURVE_3D`, moved along the reference direction x the
tangent, as ISO 10303-42 defines it and OpenCASCADE reads it: lines and circles stay lines and
circles, others become NURBS within 1e-9 of their size) and edges given only as a curve in a surface's
parameters (`PCURVE`) are read, and so are assembly placements that mirror or scale a part
(`CARTESIAN_TRANSFORMATION_OPERATOR_3D`): the part is built where it is defined and mirrored or
scaled whole, as `mirror` and `scale` do. An offset of a plane, sphere, cylinder, cone or torus
that the kernel cannot close into a solid as an offset (a whole sphere written as an
`OFFSET_SURFACE` of another) is built on the surface it is. Not read yet: wireframe topology
(`EDGE_BASED_WIREFRAME_MODEL`), references to other files, and PMI.

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
writes in both forms, in millimeters and inches, and on the IGES models FreeCAD ships. Offset
curves (130) at one distance are read (the base moved along its tangent x the plane's normal, as
OpenCASCADE reads them: lines and circles stay lines and circles). Not read: binary and compressed
IGES, offset curves whose distance varies, ruled surfaces between circles or conics, wireframe and
annotation entities; IGES is not written (write STEP).

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
broken (the error names the shape). Where the file gives a body one tolerance (the largest of
its edges, as many writers do), each edge, vertex and face gets the tolerance its geometry needs.
The importer is the bridge's: it reads usd-brep's test files, and of the 559 solids written above
it reads 557 back (99 % with the volume they were written with within 7e-6, all within 1e-4); the
check refuses the other two for faults the bodies had as they were read from STEP (an edge of 9e-9
shorter than its tolerance, a vertex moved 0.05 off its edges).

## Drawings

`drawing_views` makes the views of a part (or of several, an assembly, each body hiding what lies
behind it) for a 2D drawing: front, top, side and the others, each with its visible lines and its
hidden lines, laid out next to each other in the XY plane in
first-angle (ISO) or third-angle (ASME) projection. `export_dxf` writes them on the layers
VISIBLE and HIDDEN, the hidden lines dashed; `export_svg` writes an SVG that prints at true size:

```python
part = Box(40, 30, 20) - Cylinder(6, 40)
views = drawing_views(part)                         # front, top below it, left to its right
print([(v.name, len(v.visible), len(v.hidden)) for v in views])
# [('front', 4, 2), ('top', 5, 0), ('left', 4, 2)]: the bore is hidden from the front and the side
export_dxf(views, "part.dxf")
export_svg(views, "part.svg")
seen, hidden = part.outline(Plane.XZ, hidden=True)  # one view, in the plane it looks through
```

The lines come from the kernel's hidden curve removal, exact: edges and the contours of curved
faces, split where they pass behind the part. Each line is drawn once (the back edges of a box
seen from the front lie under its front edges and are left out), edges seen end-on and seams of
round faces are not drawn, and `tangent_edges=True` adds the tangent lines of fillets.

## Machining

`machining_setup` lays a part on a 3-axis router, resting on one face with the tool coming from the
other, and sorts its features into the layers a CNC shop reads from a DXF: `OUTLINE` (the footprint,
the through cut), `THROUGH` (the holes through the part), one `POCKET_D<depth>` layer per pocket
depth from the top face (`POCKET_D15`, `POCKET_D7_5`; islands kept, a stepped pocket on several
layers) and `LABEL` (a text with a grain arrow along x). What the setup cannot cut comes back with
the reason and the direction another setup needs: a pocket of the other face ("opens below"), a
mortise in an edge ("opens at the side"), a void, a face no vertical cutter follows:

```python
board = Box(400, 80, 20, align=(Align.MIN, Align.MIN, Align.MIN))
board -= Box(40, 10, 12, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(100, 40, 20)  # a mortise 12 deep
board -= Cylinder(4, 50).translate(300, 40, 0)  # a hole through
board -= Box(15, 10, 8, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(0, 40, 10)  # a mortise in the end
setup = machining_setup(board, label="RAIL 3")
print([s.name for s in setup.layers])  # ['OUTLINE', 'THROUGH', 'POCKET_D12', 'LABEL']
export_dxf(setup.layers, "rail_3.dxf", curves="arcs")  # one DXF layer a name, lines and arcs only
why, direction, faces = setup.elsewhere[0]  # ('opens at the side', (-1, 0, 0), the end mortise's faces)
towards = setup.plane.x_dir * direction.x + setup.plane.y_dir * direction.y + setup.plane.z_dir * direction.z
end = machining_setup(board, towards)  # the part on its far end: layers OUTLINE and POCKET_D15, 400 thick
```

The footprint is the union of the part's sections between its horizontal faces and the shadows of
its sloping planar faces, exact for anything cut from flat stock; `setup.part` is the part laid flat
(on z = 0, the worked face at z = `setup.thickness`), for `drawing_views`; `setup.plane` is the
setup's frame in the model. The footprint's box and the thickness are the finished sizes of a cut
list. [`examples/compass_armchair_machining.py`](https://github.com/awv-informatik/smlibpy/tree/main/examples)
makes a whole chair's files this way: a DXF for every setup of its sixteen boards, the cut list, STEP
files, drawings and the blanks nested on planks.

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

### Exploded views

`render_exploded` draws an assembly taken apart: each part moved by an offset you give, the
assembly axes dashed, a numbered balloon on each part that shows and a parts list beside the
picture (number, name, how many parts have it):

```python
block = Box(60, 60, 40).cut(Pos(0, 0, 12.5) * Cylinder(5, 15)).named("block")
peg = Pos(0, 0, 20) * Cylinder(5, 30).named("peg")
lid = Pos(0, 0, 22.5) * Box(30, 30, 5).cut(Cylinder(5, 10)).named("lid")
offsets = {"peg": (0, 0, 80), "lid": (0, 0, 40)}           # by name; or a list, one per part
render_exploded([block, peg, lid], offsets, path="exploded.png", order=["block", "lid", "peg"])
for axis in assembly_axes([block, peg, lid], offsets):
    print(axis.first, axis.second, axis.contact, round(axis.area, 1))
```

The parts are given assembled. The axes are not drawn by hand: two parts that touch and move
by different offsets get one, from the centroid of the area where they touch (the peg's bore
and the bottom of its hole: z = 11.43), moved with the one part, to the same point moved with
the other. `assembly_axes` gives them as numbers. A part that touches nothing is refused, and so
is an `order` that misses a name. The picture is drawn by the library alone, in its own
capitals, like the other pictures.

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
