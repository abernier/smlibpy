# Plan: files

Files and pictures: getting models in and out.

Docs go to `src/smlibpy/skill/references/files/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | formats | what each format keeps (exact or mesh, names, colors, assemblies), units | [ ] |
| 2 | `export.md` | export, Shape.export | format by extension, lists of shapes, keyword arguments | [ ] |
| 3 | `export_step.md` | export_step | unit, name, several parts, names and colors in the file | [ ] |
| 4 | `import_step.md` | import_step, load (.step) | return types (Part, Shell, ShapeList), units, names, colors, heal | [ ] |
| 5 | `export_stl.md` | export_stl | tolerance, angle, binary or text | [ ] |
| 6 | `import_stl.md` | import_stl | Mesh result, welding | [ ] |
| 7 | `export_glb.md` | export_glb, export_gltf | edges, colors, names, units | [ ] |
| 8 | `export_obj.md` | export_obj | every parameter, edge cases, errors | [ ] |
| 9 | `save_load.md` | save, load (.smb) | the native format: exact, one body | [ ] |
| 10 | `render.md` | render | views, sheet, size, edges, colors, bytes | [ ] |
| 11 | `show.md` | show | browser and notebook behaviour, path, open_browser | [ ] |
| 12 | `Mesh.md` | Mesh, tessellate | tessellation parameters, Mesh fields, mesh Booleans, volume/area of meshes | [ ] |
