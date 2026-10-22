# export_step

Writes parts and surfaces to a STEP AP214 file with the exact geometry. The format to deliver
a CAD model in.

## Signature
`export_step(shapes, path, *, unit="mm", name=None, assembly=False)`

- `shapes`: a `Part`, `Shell`, `Sketch`, `Face`, or a list of them (nested lists are flattened).
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
cylinders, cones, spheres, tori, lines, circles and ellipses are written as analytic entities.
Everything else is written as B-splines with the kernel's control points.

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
  as a float tuple `(r, g, b)` in 0..1, not as the string you gave.
- Order: bodies come back in the order you wrote them, at their places. (In an assembly, the
  places of a body listed more than once come back together, at its first.)

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
- Edges, wires and meshes cannot be written (no wireframe in STEP export).

## Errors
- `ValueError: unknown unit 'MM'; use mm, cm, m, um or inch`: the unit names are case
  sensitive. No file is written.
- `ValueError: nothing to write`: the list is empty.
- `TypeError: cannot write a Mesh to STEP`: use `export_stl`/`export_glb` for meshes.
- `TypeError: 'Edge' object is not iterable` (or `'Wire'`, or `'float'` for a `Vertex`): you
  passed something that is not a body. Edges, wires and vertices cannot be exported. Make a
  face or a part from them first.

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
```

## Related
`import_step`, `export` (by extension), `save` (native, exact, one body), `generic.md`.
