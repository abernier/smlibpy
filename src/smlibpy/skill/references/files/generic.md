# Files: formats and what they keep

smlibpy writes six formats and reads three. Only STEP and `.smb` keep the exact geometry.
Everything else is a triangle mesh.

| Format | Write | Read | Geometry | Bodies | Names | Colors | Units in file |
|---|---|---|---|---|---|---|---|
| STEP `.step` `.stp` | `export_step` | `import_step` | exact (analytic + B-spline) | many | yes (solid label) | yes | mm or `unit=` (converted on export), converted to mm on import |
| SMLib `.smb` | `save` | `load` | exact, binary bit-identical | **one** | no | no | none (mm) |
| STL `.stl` | `export_stl` | `import_stl` → `Mesh` | triangles, float32 | merged into one mesh | no | no | none |
| glTF `.glb` `.gltf` | `export_glb`, `export_gltf` | no | triangles + edge lines | one node per shape | yes | yes | meters (a root node scales the mm by 0.001) |
| OBJ `.obj` | `export_obj` | no | triangles, no normals | one object per shape | yes | no | none |
| PNG | `render` | `diff_images` compares two | a picture | | | yes | |
| HTML | `show` | | an interactive viewer | | | yes | |

`export(shapes, path)` and `shape.export(path)` choose the writer by extension. `load(path)`
chooses the reader (`.step`/`.stp`/`.p21`, `.stl`, `.smb`; any other extension raises
`ValueError: unknown file type ...`).

## Which format
- **Deliver a CAD model: STEP.** Every CAD system reads it. Names, colors and exact surfaces
  survive. Read it back and compare `volume` before you hand it over.
- **Cache an intermediate body between scripts: `.smb`** with `ascii=False` (bit-exact). Set
  the name and color again after `load`.
- **3D printing: STL** with `tolerance=0.01`.
- **Show it to people: `.glb`** (colors, names, edges), or `show(..., path=..., open_browser=False)`
  for a page to open.
- **Check it yourself: `render(..., view="sheet")`**, a technical drawing, then read the PNG.

## Units
- All modeling is in mm.
- `export_step(unit="inch")` converts the coordinates to inches: a 60 x 40 x 8 box is written as
  2.362 x 1.575 x 0.315 and declared in inches. Do not scale the model yourself.
- `import_step` converts any file unit to mm, so the inch file above reads back as 60 x 40 x 8.
- glTF is defined in meters: `export_glb`/`export_gltf` write the mm positions under a root node
  that scales them by 0.001, so Blender and AR viewers show a 60 mm part as 0.06 m.
- STL and OBJ have no units; they hold the mm values.

## Assemblies
- `export_step([a, b, c], path)` writes one product with several named solids, not an
  assembly tree. Each solid is placed where it is in the model.
- `import_step` applies assembly placements and returns a `ShapeList` with one `Part` per
  instance. The CAx-IF AS1 assemblies of AutoCAD, OpenCASCADE and others are placed correctly;
  still check foreign assemblies with a picture.

## Shape kinds
| Shape | STEP | `.smb` | STL / OBJ / glTF | render, show |
|---|---|---|---|---|
| `Part` | solid (a two-solid part becomes two solids) | yes | yes | yes |
| `Shell`, `Sketch`, `Face` | surface, comes back as `Shell` | comes back as `Shell` | open mesh | yes |
| `Mesh` | `TypeError` | `AttributeError` | yes | yes |
| `Edge`, `Wire` | `TypeError: 'Edge' object is not iterable` | same | glTF only (lines) | yes (lines) |
| `Vertex` | `TypeError: 'float' object is not iterable` | same | glTF only (a point) | render skips it, show draws it |

## Related
`export.md`, `export_step.md`, `import_step.md`, `save_load.md`, `export_stl.md`,
`import_stl.md`, `export_glb.md`, `export_obj.md`, `render.md`, `diff_images.md`, `show.md`, `Mesh.md`.
