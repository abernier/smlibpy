# Plan: files

Files and pictures: getting models in and out.

Docs go to `src/smlibpy/skill/references/files/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | formats | what each format keeps (exact or mesh, names, colors, assemblies), units | [x] generic.md |
| 2 | `export.md` | export, Shape.export | format by extension, lists of shapes, keyword arguments | [x] export.md |
| 3 | `export_step.md` | export_step | unit, name, several parts, names and colors in the file | [x] export_step.md |
| 4 | `import_step.md` | import_step, load (.step) | return types (Part, Shell, ShapeList), units, names, colors, heal | [x] import_step.md |
| 5 | `export_stl.md` | export_stl | tolerance, angle, binary or text | [x] export_stl.md |
| 6 | `import_stl.md` | import_stl | Mesh result, welding | [x] import_stl.md |
| 7 | `export_glb.md` | export_glb, export_gltf | edges, colors, names, units | [x] export_glb.md |
| 8 | `export_obj.md` | export_obj | every parameter, edge cases, errors | [x] export_obj.md |
| 9 | `save_load.md` | save, load (.smb) | the native format: exact, one body | [x] save_load.md |
| 10 | `render.md` | render | views, sheet, size, edges, colors, bytes | [x] render.md |
| 11 | `show.md` | show | browser and notebook behaviour, path, open_browser | [x] show.md |
| 12 | `Mesh.md` | Mesh, tessellate | tessellation parameters, Mesh fields, mesh Booleans, volume/area of meshes | [x] Mesh.md |
| 13 | `import_dxf.md` | import_dxf, load (.dxf) | entities, units, layers, tolerance, nesting (even-odd), open and branching outlines, blocks | [x] import_dxf.md |
| 14 | `import_dxf_wires.md` | import_dxf_wires | open and closed chains, branching, uses as paths | [x] import_dxf_wires.md |
| 15 | `export_dxf.md` | export_dxf, export (.dxf) | entities, sections (arcs from B-splines), units, the drawing plane, layers from names, errors | [x] export_dxf.md |
