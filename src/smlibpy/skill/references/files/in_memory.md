# Files in memory

Every file format has a pair that works without a file: `to_<format>` gives the file's contents,
`from_<format>` reads them. For web services (FastAPI, Flask), notebooks, cloud functions and
databases that return a STEP or GLB or read an upload without temporary files. The functions that
write and read files (`export_step`, `import_step`, ...) are these with a file around them, and take
the same keywords.

## Functions
| Format | Write | Read | Contents |
|---|---|---|---|
| STEP | `to_step(shapes, *, unit, name, assembly)` | `from_step(data, *, heal, strict)`, `from_step_model(data, ...)` | `str` (ASCII); read from `str` or `bytes` |
| STL | `to_stl(shapes, *, tolerance, angle, ascii)` | `from_stl(data)` | `bytes`; read from `bytes` (or the text of an ASCII file) |
| OBJ | `to_obj(shapes, *, tolerance, angle)` | | `str` |
| glTF | `to_glb(shapes, *, tolerance, angle, edges, edge_color)`, `to_gltf(...)` | | `bytes`, `str` (JSON, buffer as a data URI) |
| DXF | `to_dxf(shapes, *, unit, plane)` | `from_dxf(data, *, layers, unit, tolerance)`, `from_dxf_wires(...)` | `str`; read from `str` or `bytes` |
| USD | `to_usd(shapes, *, mesh, tolerance, angle, materials)` | `from_usd(data, *, ..., resolve)` | `str` (`.usda`); read from `str` or `bytes` |
| IGES | | `from_iges(data, *, heal, strict)` | read from `str` or `bytes` |
| SMLib | `to_smb(shapes, *, ascii)`, `to_smp(shapes, *, ascii)` | `from_smb(data)`, `from_smp(data)` | `bytes` |

- `to_step` names the product `"part"` (a file: after the file) unless `name=` says otherwise.
- `from_usd` reads the layers the text names (subLayers, references, payloads) through
  `resolve(asset, from_)`: `asset` as written, `from_` the name of the layer that names it (`""`
  for the text given); it returns their text or bytes, or None. Without it they are not read (a
  warning names them).
- Fonts too: `Text("Hi", 10, font=data)` and `load_font(data)` take the bytes of a font file.

## Example
```python
part = (Box(40, 20, 8) - Cylinder(4, 8)).named("bracket").colored("steelblue")
step = to_step(part)                       # str: what export_step writes
again = from_step(step)                    # (from an upload: the request's bytes)
print(again.name, abs(again.volume - part.volume) < 1e-6)   # bracket True

glb = to_glb(part)                         # bytes for an HTTP response (model/gltf-binary)
print(glb[:4])                             # b'glTF'
cache = to_smp([part, Sphere(5).named("ball")], ascii=False)
print([s.name for s in from_smp(cache)])   # ['bracket', 'ball']
```

## Related
`export`, `load`, `save_load`, `export_step`, `import_step`, `export_usd`, `import_usd`
