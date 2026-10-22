# export_step

Writes parts and surfaces to a STEP AP214 file with the exact geometry, and curves, points and
coordinate systems beside them. The format to deliver a CAD model in.

## Signature
`export_step(shapes, path, *, unit="mm", name=None, assembly=False)`

- `shapes`: a `Part`, `Shell`, `Sketch`, `Face`, or a list of them (nested lists are flattened).
  Also wireframe and reference geometry: an `Edge` or `Wire` (a curve), a `Vertex` or `Vector` (a
  point), a `Plane` (a coordinate system), each unnamed; `StepCurve(name, edge_or_wire, color=)`,
  `StepPoint(name, vector, color=)` and `StepFrame(name, plane)` give them names (and colors); a
  `StepModel` from `read_step` is written whole.
- `path`: `str` or `pathlib.Path`. The extension is not checked.
- `unit`: `"mm"` (default), `"cm"`, `"m"`, `"um"`, `"inch"` (or `"in"`). The unit of the file:
  the model (always mm) is converted to it, so a 60 mm box is written as 2.3622 with
  `unit="inch"` and reads back as 60 mm.
- `name`: the STEP product name (of the assembly, with `assembly=True`). Default: the file name
  without its extension.
- `assembly`: write each body as a product of its own, named as the body, in an assembly
  product called `name`. Other CAD systems then list the parts by name and move or replace them
  one by one. Default `False`: one product holding every body.

## Returns
`None`. The file holds one `PRODUCT` and one solid (`MANIFOLD_SOLID_BREP`, or
`BREP_WITH_VOIDS` for a hollow part) per solid, plus one open sheet per surface. Planes,
cylinders, cones, spheres, tori, lines, circles and ellipses are written as analytic entities,
offset surfaces (fillets of `.smb` files, offsets read from STEP) as `OFFSET_SURFACE` of their
basis. Everything else is written as B-splines with the kernel's control points. The file
declares a length uncertainty of 1e-7 mm, in its unit (`1.E-10` in a file in meters).

Curves and points go into one `GEOMETRIC_CURVE_SET` of wireframe geometry: lines, arcs and
ellipses as trimmed analytic curves, B-splines with their control points (other curves
approximated within 1e-7, as `Edge.nurbs` does), a `Wire` as one composite curve. Coordinate
systems are named `AXIS2_PLACEMENT_3D`s of supplemental geometry (CAx-IF's
`CONSTRUCTIVE_GEOMETRY_REPRESENTATION`). `read_step` gives all of them back.

With `assembly=True` the file holds a root `PRODUCT` and one `PRODUCT` per body, each placed
in the root by a `NEXT_ASSEMBLY_USAGE_OCCURRENCE` with its placement (CAx-IF's recommended
practice). The bodies keep their coordinates: each product sits at the root's origin. A body
listed more than once (the same object: `[bolt, bolt]`) is one product placed twice, written
once. An unnamed body's product is called `<name>_<i>`.

## What is kept
- Geometry: reading the file back gives the same face and edge counts, the same face types,
  the same bbox, and the volume to about 1e-8 relative.
- Names: `part.named("bracket")` becomes the label of its solid, and `import_step` gives it
  back. An unnamed body gets the product name when it is alone in the file, otherwise
  `<product>_<i>` (`assembly_3`, counted from 1 over all bodies).
- Colors: `part.colored(...)` is written as a surface color for the whole body. It comes back
  as a float tuple `(r, g, b)` in 0..1, not as the string you gave. Faces with a color or a name
  of their own (`colored(color, faces=...)`, `named(name, faces=...)`) get a `STYLED_ITEM` of the
  face and the name on their `ADVANCED_FACE`; `import_step` reads both back (`face.color`,
  `face.name`), also from other systems' files. See `files/face_colors`.
- Order: bodies come back in the order you wrote them, at their places. (In an assembly, the
  places of a body listed more than once come back together, at its first.)
- Curves, points and coordinate systems: `read_step(path).curves` (`.points`, `.frames`) give them
  back in order with their names, colors and types (a `Wire` as a `Wire`, an arc as an arc). Their
  `product` is the file's product; with `assembly=True` an item whose `product` is a body's name
  belongs to that body's product, the others to the assembly.

## Gotchas
- `unit` converts: do not scale the model yourself. `export_step(part.scale(1 / 25.4), path,
  unit="inch")` writes a part 25.4 times too small.
- A list of parts is not written as an assembly tree unless `assembly=True`. Without it you get
  one product with several solids, and each solid carries its own name (most CAD systems show
  one part with several bodies).
- `assembly=True` shares only bodies that are the same object. Moved copies
  (`bolt.translate(...)`) are bodies of their own, each written in full.
- A `Part` with two disjoint solids (from a fuse of parts that do not touch) is written as two
  solids. It comes back as a `ShapeList` of two `Part`s, both with the same name.
- A `Sketch` or `Face` is written as a surface and comes back as a `Shell`, not as a `Sketch`.
- Names may hold any characters: `"Bügel"` and `"部品"` are written in STEP's `\X2\` encoding,
  which other CAD systems and `import_step` read. Quotes and backslashes are fine.
- `colored()` does not check the color. A bad color fails at export time with
  `ValueError: unknown color 'notacolor'`.
- Meshes cannot be written. Edges, wires and points are written as wireframe geometry, which
  `import_step` does not read (it reads bodies): use `read_step`.
- A body with a face STEP cannot hold as the kernel has it (an offset face reaching past its
  basis, a surface of a kind the writer does not know) is written converted to NURBS, which
  approximates those faces, with a `RuntimeWarning` naming the body.
- OpenCASCADE drops an offset face whose basis is a B-spline with C0 knots (it needs a C1 basis);
  `import_step` reads it.

## Errors
- `ValueError: unknown unit 'MM'; use mm, cm, m, um or inch`: the unit names are case
  sensitive. No file is written.
- `ValueError: nothing to write`: the list is empty.
- `TypeError: cannot write a Mesh to STEP`: use `export_stl`/`export_glb` for meshes.
- `TypeError: cannot write a Location to STEP` (or another type): only bodies, faces, curves,
  points, planes and the `Step*` items can be written.

## Example
```python
bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")
export_step([bracket, cover], "assembly.step", assembly=True)   # products "bracket", "cover"

back = import_step("assembly.step")
print([p.name for p in back], round(back[0].volume, 3), round(bracket.volume, 3))
# ['bracket', 'cover'] 18797.876 18797.876

# an inch file: the coordinates are converted to inches
export_step(bracket, "bracket_inch.step", unit="inch")
print(import_step("bracket_inch.step").bbox().size)   # Vector(60, 40, 8)

# a part with its tool path, a reference point and its mounting system
path = Wire([Line((0, 0, 4), (30, 0, 4)), CenterArc((30, 10), 10, -90, 180)])
export_step([bracket, StepCurve("path", path, color=(1, 0, 0)), StepPoint("CRP", Vector(0, 0, 4)),
             StepFrame("MCS", Plane((0, 0, 4)))], "fixture.step")
model = read_step("fixture.step")
print(model)                                  # StepModel(1 bodies, 1 frames, 1 curves, 1 points)
print(model.curves[0].name, round(model.curves[0].shape.length, 4))   # path 61.4159
```

## Related
`import_step`, `read_step` (bodies, curves, points and coordinate systems), `export` (by extension),
`save` (native, exact, one body), `generic.md`.
