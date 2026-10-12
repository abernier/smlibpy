# Files: formats and what they keep

smlibpy writes six formats and reads three. Only STEP and `.smb` keep the exact geometry.
Everything else is a triangle mesh.

| Format | Write | Read | Geometry | Bodies | Names | Colors | Units in file |
|---|---|---|---|---|---|---|---|
| STEP `.step` `.stp` | `export_step` | `import_step` | exact (analytic + B-spline) | many | yes (solid label) | yes | declared (`unit=`), converted to mm on import |
| SMLib `.smb` | `save` | `load` | exact, binary bit-identical | **one** | no | no | none (mm) |
| STL `.stl` | `export_stl` | `import_stl` → `Mesh` | triangles, float32 | merged into one mesh | no | no | none |
| glTF `.glb` `.gltf` | `export_glb`, `export_gltf` | no | triangles + edge lines | one node per shape | yes | yes | written in mm, but glTF means meters |
| OBJ `.obj` | `export_obj` | no | triangles, no normals | one object per shape | yes | no | none |
| PNG | `render` | | a picture | | | yes | |
| HTML | `show` | | an interactive viewer | | | yes | |

`export(shapes, path)` and `shape.export(path)` choose the writer by extension. `load(path)`
chooses the reader (`.step`/`.stp`/`.p21`, `.stl`; everything else is read as `.smb`).

## Which format
- **Deliver a CAD model: STEP.** Every CAD system reads it. Names, colors and exact surfaces
  survive. Read it back and compare `volume` before you hand it over.
- **Cache an intermediate body between scripts: `.smb`** with `ascii=False` (bit-exact). Set
  the name and color again after `load`.
- **3D printing: STL** with `tolerance=0.01`.
- **Show it to people: `.glb`** (colors, names, edges), or `show(..., path=..., open_browser=False)`
  for a page to open.
- **Check it yourself: `render(..., view="sheet")`**, then read the PNG.

## Units
- All modeling is in mm. No writer scales the coordinates.
- `export_step(unit="inch")` only writes "inch" into the header. Scale the model first:
  `export_step(part.scale(1 / 25.4), path, unit="inch")`. Otherwise the file is 25.4 times too
  large.
- `import_step` converts any file unit to mm: a file that declares inch with a 60 x 40 x 8 box
  reads back as 1524 x 1016 x 203.2.
- glTF viewers that respect units (Blender, AR) show mm values as meters. Export
  `[s.scale(0.001) for s in shapes]` for them.

## Assemblies
- `export_step([a, b, c], path)` writes one product with several named solids, not an
  assembly tree. Each solid is placed where it is in the model.
- `import_step` applies assembly placements and returns a `ShapeList` with one `Part` per
  instance. Check foreign assemblies with a picture: in the AutoCAD AS1 file every part was
  placed at the inverse of its placement, with no error.

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
`import_stl.md`, `export_glb.md`, `export_obj.md`, `render.md`, `show.md`, `Mesh.md`.
