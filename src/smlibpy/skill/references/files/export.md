# export / Shape.export

Writes shapes to a file and picks the format from the extension. It is a thin dispatcher to
the format functions.

## Signatures
`export(shapes, path, **kwargs)`
`shape.export(path, **kwargs)` on any `Part`, `Shell`, `Sketch`, `Face`, and on `Mesh`.

| Extension (any case) | Calls | Useful keyword arguments |
|---|---|---|
| `.step`, `.stp` | `export_step` | `unit`, `name` |
| `.stl` | `export_stl` | `tolerance`, `angle`, `ascii` |
| `.glb` | `export_glb` | `tolerance`, `angle`, `edges`, `edge_color` |
| `.gltf` | `export_gltf` | `tolerance`, `angle`, `edges`, `edge_color` |
| `.obj` | `export_obj` | `tolerance`, `angle` |
| `.smb`, `.smp` | `save` | `ascii` |
| `.dxf` | `export_dxf` | `unit`, `plane` |

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
- `Mesh.export` works for `.stl`, `.obj`, `.glb` and `.gltf`. For `.step`, `.smb` and `.smp` it
  raises `TypeError`.
- No extension, or `.iges`, `.3mf` and other formats, raise `ValueError` before anything is
  written.
- `load` is the reverse for `.step`/`.stp`, `.usda`, `.stl`, `.smb`, `.smp` and `.dxf` (a `Sketch`), and
  reads IGES (`.igs`, `.iges`), which is not written. glTF and OBJ cannot be read back.

## Errors
- `ValueError: unknown file type '.iges'; use .step, .stl, .glb, .gltf, .obj, .smb, .smp, .dxf or .usda`.
- `TypeError: export_step() got an unexpected keyword argument 'tolerance'`: a mesh keyword
  argument used on an exact format, or the other way round.

## Example
```python
bracket.export("bracket.step")                # exact
bracket.export("bracket.stl", tolerance=0.01) # mesh, 0.01 mm chord error
export([bracket, cover], "assembly.glb")      # meshes with names and colors
print(type(load("bracket.step")).__name__, type(load("bracket.stl")).__name__)   # Part Mesh
```

## Related
`export_step`, `export_stl`, `export_glb`, `export_obj`, `export_dxf`, `save_load.md`, `generic.md`.
