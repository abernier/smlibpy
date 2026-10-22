# Files: formats and what they keep

STEP, USD and `.smb` keep the exact 3D geometry, DXF the exact 2D curves of sketches, sections
and text. The other formats are triangle meshes or pictures.

| Format | Write | Read | Geometry | Bodies | Names | Colors | Units in file |
|---|---|---|---|---|---|---|---|
| STEP `.step` `.stp` | `export_step` | `import_step` | exact (analytic + B-spline) | many | yes (solid label) | yes | mm or `unit=` (converted on export), converted to mm on import |
| USD `.usda` `.usd` | `export_usd` | `import_usd` | exact (`BrepArray` prims of usd-brep), meshes as `Mesh` prims; text only | many, merged parts with their cells | yes (prim names) | yes | mm (`metersPerUnit = 0.001`); read in mm by `metersPerUnit`, placed by the prims' transforms |
| SMLib `.smb` | `save` | `load` | exact geometry; B-spline faces that are exactly planes, cylinders, cones, spheres or surfaces of revolution come back as those | **one** | no | no | none (mm) |
| DXF `.dxf` | `export_dxf` | `import_dxf` → `Sketch`, `import_dxf_wires` → `Wire`s | exact 2D curves: LINE, ARC, CIRCLE, ELLIPSE, SPLINE | 2D only, no `Part` | names become layers | no | mm or `unit=` (converted on export), `$INSUNITS` converted to mm on import |
| SVG `.svg` | `export_svg` | no | 2D lines: lines and circular arcs exact, other curves as polylines | 2D only (views of `drawing_views`, edges, sketches) | no | black lines, hidden ones dashed | mm (prints at true size) |
| STL `.stl` | `export_stl` | `import_stl` → `Mesh` | triangles, float32 | merged into one mesh | no | no | none |
| glTF `.glb` `.gltf` | `export_glb`, `export_gltf` | no | triangles + edge lines | one node per shape | yes | yes | meters (a root node scales the mm by 0.001) |
| OBJ `.obj` | `export_obj` | no | triangles, no normals | one object per shape | yes | no | none |
| PNG | `render` | `diff_images` compares two | a picture | | | yes | |
| HTML | `show` | | an interactive viewer | | | yes | |

`export(shapes, path)` and `shape.export(path)` choose the writer by extension. `load(path)`
chooses the reader (`.step`/`.stp`/`.p21`, `.stl`, `.smb`, `.dxf`, `.usda`/`.usd`; any other
extension raises `ValueError: unknown file type ...`).

## Which format
- **Deliver a CAD model: STEP.** Every CAD system reads it. Names, colors and exact surfaces
  survive. Read it back and compare `volume` before you hand it over.
- **USD pipelines, Omniverse: `.usda`** with `export_usd`, the exact bodies; add `mesh=True` for
  viewers that do not read B-reps.
- **Cache an intermediate body between scripts: `.smb`** with `ascii=False` (bit-exact). Set
  the name and color again after `load`.
- **3D printing: STL** with `tolerance=0.01`.
- **Show it to people: `.glb`** (colors, names, edges), or `show(..., path=..., open_browser=False)`
  for a page to open.
- **Check it yourself: `render(..., view="sheet")`**, a technical drawing, then read the PNG.
- **Laser cutting, CNC, 2D CAD, drawings: DXF** with `export_dxf` (a sketch, `part.section(plane)`,
  text). A part is not 2D: write a section of it, or its views.
- **A drawing of a part (front, top and side views, hidden lines dashed): `drawing_views`**,
  written with `export_dxf` (layers VISIBLE and HIDDEN) or `export_svg`.
- **A 2D outline from someone else: DXF** with `import_dxf`, then `extrude` or `revolve`. Pick the
  outline's layers with `layers=`.

## Units
- All modeling is in mm.
- `export_step(unit="inch")` converts the coordinates to inches: a 60 x 40 x 8 box is written as
  2.362 x 1.575 x 0.315 and declared in inches. Do not scale the model yourself.
- `import_step` converts any file unit to mm, so the inch file above reads back as 60 x 40 x 8.
- glTF is defined in meters: `export_glb`/`export_gltf` write the mm positions under a root node
  that scales them by 0.001, so Blender and AR viewers show a 60 mm part as 0.06 m.
- STL and OBJ have no units; they hold the mm values.
- DXF: `export_dxf(unit="inch")` converts and declares `$INSUNITS`; `import_dxf` converts the
  declared unit to mm, reads a file without a unit as mm, and takes `unit=` to override it.

## Assemblies
- `export_step([a, b, c], path)` writes one product with several named solids, not an
  assembly tree. Each solid is placed where it is in the model.
- `import_step` applies assembly placements and returns a `ShapeList` with one `Part` per
  instance. The CAx-IF AS1 assemblies of AutoCAD, OpenCASCADE and others are placed correctly;
  still check foreign assemblies with a picture.

## Shape kinds
| Shape | STEP | USD | `.smb` | STL / OBJ / glTF | DXF | render, show |
|---|---|---|---|---|---|---|
| `Part` | solid (a two-solid part becomes two solids, a merged part one per cell) | one `BrepArray` (a merged part with its cells) | yes | yes | `TypeError`: write `part.section(plane)` | yes |
| `Shell`, `Sketch`, `Face` | surface, comes back as `Shell` | a sheet, comes back as `Shell` | comes back as `Shell` | open mesh | planar ones; comes back as `Sketch` | yes |
| `Mesh` | `TypeError` | a `Mesh` prim (not read back) | `AttributeError` | yes | `TypeError` | yes |
| `Edge`, `Wire` | `TypeError: 'Edge' object is not iterable` | same | same | glTF only (lines) | yes (`import_dxf_wires` reads them back) | yes (lines) |
| `Vertex` | `TypeError: 'float' object is not iterable` | same | same | glTF only (a point) | `TypeError` | render skips it, show draws it |

## Related
`export.md`, `export_step.md`, `import_step.md`, `save_load.md`, `export_stl.md`,
`import_stl.md`, `export_glb.md`, `export_obj.md`, `export_dxf.md`, `import_dxf.md`,
`import_dxf_wires.md`, `export_usd.md`, `import_usd.md`, `render.md`, `diff_images.md`, `show.md`,
`Mesh.md`.
