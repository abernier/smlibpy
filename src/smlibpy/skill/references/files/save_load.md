# save / load

`save` writes SMLib's native files: one body to an `.smb` file, or any number of bodies and curves,
with their names and colors, to an `.smp` part file. `load` reads `.smb`, `.smp`, STEP, IGES, USD,
OpenCASCADE `.brep`, STL and DXF, and picks the format from the extension.

## Signatures
`save(shapes, path, *, ascii=True)`
`load(path)`
`to_smb(shapes, *, ascii=True)` / `from_smb(data)`, `to_smp(shapes, *, ascii=True)` / `from_smp(data)`:
the same in memory (`bytes`).

- `.smb`: `save` takes exactly one body: a `Part`, `Shell`, `Sketch`, `Face`, or a list with one
  of them. No name, no color.
- `.smp` (the kernel's part container, `SmBrepData::WritePartToFile`): any number of parts (with
  their cells), sheets, sketches and faces, each with its name and color, and edges and wires as
  curves. A sheet metal part keeps the K-factors of its bends (`fold`, `flange`), so that it
  unfolds as folded; faces keep their own colors (`colored(..., faces=)`), not their names. Any
  other extension writes `.smb`.
- `ascii=True` (the default) writes a text file. `ascii=False` writes a binary file, about 40 %
  of the size, bit-exact.
- `load` decides by the extension, in any letter case:
  - `.step`, `.stp`, `.p21`: same as `import_step`.
  - `.igs`, `.iges`: same as `import_iges`.
  - `.usda`, `.usd`: same as `import_usd`.
  - `.brep`: same as `import_brep`.
  - `.stl`: same as `import_stl`, gives a `Mesh`.
  - `.dxf`: same as `import_dxf`, gives a `Sketch`.
  - `.smb`, `.smp`: the native formats; any other extension raises `ValueError`.

## Returns
`load` of an `.smb` gives a `Part`. A body that does not enclose a volume (a sketch, face or
surface) comes back as a `Shell`. A merged part comes back with its cells (`cells()`, `volume`),
and a broken solid as a `Part` whose `is_valid()` is False.

`load` of an `.smp` gives its items in the order they were saved (one item: the shape itself,
several: a `ShapeList`): bodies as `Part` or `Shell` with their names and colors, an edge as an
`Edge`, a wire as a `Wire`. Part files of other SMLib programs give their bodies, their curves as
`Edge`s and their loose surfaces as sheets of one face.

## .smb and .smp compared with STEP
| | `.smb` | `.smp` | STEP |
|---|---|---|---|
| Geometry | binary: bit-identical. ASCII: within ~1e-15 | the same | same surface types, volume within ~1e-8 |
| Bodies per file | one (two-solid parts stay one `Part`) | any number, and curves | any number |
| Names, colors | **lost** | kept (ASCII colors to 16 decimals) | kept |
| Other software | SMLib only | SMLib only | every CAD system |

Use `.smp` to cache intermediate results between scripts (`ascii=False`), `.smb` for a single body
SMLib's own tools read. Use STEP to deliver a model.

## Gotchas
- `.smb` stores no name and no color (nor colors of faces, nor K-factors of bends). `load`
  returns `name None`, `color None`. Set them again with `.named()` and `.colored()`, or save to
  `.smp`.
- A list of two parts raises for `.smb`. Fuse them, save each to its own file, or use `.smp`.
- smlibpy cannot read glTF or OBJ: `load("x.glb")` raises `ValueError: unknown file type
  '.glb'; load reads .step, .stp, .igs, .iges, .stl, .smb, .smp, .dxf, .usda and .brep`.
- A `Sketch` comes back as a `Shell`: its plane is lost.
- A body that also holds wire edges, points or faces outside its solid (files of other programs)
  comes back with a `RuntimeWarning` that names them: such a `Part` is not valid.
- `.smp` keeps no assembly placements (the kernel's format has none) and writes no meshes or
  points.

## Errors
- `ValueError: an .smb file holds one body; fuse the parts, save them separately, or save them to
  an .smp file (which holds several, with their names and colors)`.
- `TypeError: an .smb file holds one body, not an Edge: save curves to an .smp file, which holds
  bodies and curves (or write them with export_step or export_dxf)`.
- `TypeError: an .smb file holds an exact body, not a Mesh` (`.smp`: `to_smp: an .smp file holds
  exact bodies and curves, not a Mesh: ...`).
- `FileNotFoundError` for a missing file.
- `ValueError: unknown file type '.glb'; load reads .step, .stp, .igs, .iges, .stl, .smb, .smp,
  .dxf, .usda and .brep`.
- `KernelError: load failed`: an `.smb` file the native reader cannot read; `ValueError: part
  file: this is no SMLib part file (.smp): ...` for an `.smp` that is none.

## Example
```python
bracket = (Box(40, 20, 8) - Cylinder(4, 8)).named("bracket").colored("steelblue")
save(bracket, "bracket.smb")                  # ASCII, exact
save(bracket, "bracket_bin.smb", ascii=False) # binary, bit-exact
again = load("bracket.smb")
print(again.volume == bracket.volume, again.name)   # True None

pin = Cylinder(3, 20).named("pin").colored("orange")
path = Wire([Line((0, 0, 0), (30, 0, 0)), CenterArc((30, 10), 10, -90, 180)])
save([bracket, pin, path], "parts.smp", ascii=False)
b, p, w = load("parts.smp")
print(b.name, p.color, type(w).__name__, len(w.edges()))   # bracket (1.0, 0.6470588235294118, 0.0) Wire 2
```

## Related
`export` (writes `.smb` and `.smp` with `save` by the extension), `in_memory`, `export_step`,
`import_step`, `import_stl`.
