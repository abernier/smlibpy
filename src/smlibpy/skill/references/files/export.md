# export / Shape.export

Writes shapes to a file and picks the format from the extension. It is a thin dispatcher to
the format functions.

## Signatures
`export(shapes, path, **kwargs)`
`shape.export(path, **kwargs)` on every shape (`Part`, `Shell`, `Sketch`, `Face`, and `Edge`,
`Wire`, `Vertex` for the formats that take them), and on `Mesh`.

| Extension (any case) | Calls | Useful keyword arguments |
|---|---|---|
| `.step`, `.stp` | `export_step` | `unit`, `name`, `assembly` |
| `.stl` | `export_stl` | `tolerance`, `angle`, `ascii`, `max_edge` |
| `.glb` | `export_glb` | `tolerance`, `angle`, `edges`, `edge_color`, `max_edge` |
| `.gltf` | `export_gltf` | `tolerance`, `angle`, `edges`, `edge_color`, `max_edge` |
| `.obj` | `export_obj` | `tolerance`, `angle`, `max_edge` |
| `.smb`, `.smp` | `save` | `ascii` |
| `.dxf` | `export_dxf` | `unit`, `plane`, `curves`, `tolerance` |
| `.usda`, `.usd` | `export_usd` | `mesh`, `tolerance`, `angle`, `materials`, `max_edge` |
| `.svg` | `export_svg` | `margin`, `stroke` |
| `.brep` | `export_brep` | (none) |

- `shapes`: one shape or a list (nested lists are flattened). `path`: `str` or `pathlib.Path`.
- `kwargs` go to the format function unchanged. A keyword argument that the format does not
  take raises `TypeError`.

## Returns
`None`.

## Gotchas
- STEP and `.smb` are exact. STL, glTF and OBJ are triangle meshes. Deliver STEP for CAD, and a
  mesh format for printing or viewing. DXF is exact and 2D: sketches, sections, text, wires and
  edges; a `Part` raises `TypeError` (write `part.section(plane)`).
- `.stp` with `unit="inch"` writes the coordinates in inches (converted from mm, see
  `export_step`).
- `.smb` holds one body. `export([a, b], "x.smb")` raises; `export([a, b], "x.smp")` writes both,
  with their names and colors (an SMLib part file).
- `Mesh.export` works for `.stl`, `.obj`, `.glb`, `.gltf` and `.usda` (a `Mesh` prim). For
  `.step`, `.smb`, `.smp`, `.brep` and `.dxf` it raises `TypeError`.
- No extension, or `.iges`, `.3mf` and other formats, raise `ValueError` before anything is
  written. `.usdc` and `.usdz` go to `export_usd`, which writes text only and raises
  `ValueError` (its message says how to convert a `.usda`).
- `load` is the reverse for `.step`/`.stp`, `.usda`, `.brep`, `.stl`, `.smb`, `.smp` and `.dxf` (a `Sketch`), and
  reads IGES (`.igs`, `.iges`), which is not written. glTF, OBJ and SVG cannot be read back.

## Errors
- `ValueError: unknown file type '.iges'; use .step, .stl, .glb, .gltf, .obj, .smb, .smp, .dxf, .svg, .usda or .brep`.
- `TypeError: export_step() got an unexpected keyword argument 'tolerance'`: a mesh keyword
  argument used on an exact format, or the other way round.

## Example
```python
bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover")
bracket.export("bracket.step")                # exact
bracket.export("bracket.stl", tolerance=0.01) # mesh, 0.01 mm chord error
export([bracket, cover], "assembly.glb")      # meshes with names and colors
print(type(load("bracket.step")).__name__, type(load("bracket.stl")).__name__)   # Part Mesh
```

## Related
`export_step`, `export_stl`, `export_glb`, `export_obj`, `export_dxf`, `save_load.md`, `generic.md`.
