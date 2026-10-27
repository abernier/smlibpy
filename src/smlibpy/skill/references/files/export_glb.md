# export_glb / export_gltf

Writes shapes as a glTF 2.0 scene: triangle meshes with colors and names, plus the B-rep edges
as lines. Use it for web viewers, presentations and other tools that show meshes.

## Signatures
`export_glb(shapes, path, *, tolerance=None, angle=15.0, edges=True, edge_color="#1f2328", max_edge=None)`:
one binary `.glb` file.
`export_gltf(shapes, path, **kwargs)`: one `.gltf` JSON file with the buffer embedded as a
base64 data URI (1.3 times larger). It takes the same keyword arguments.

- `shapes`: parts, shells, sketches, faces, meshes, edges, wires, vertices, or lists of them.
- `tolerance`, `angle`, `max_edge`: as in `tessellate`.
- `edges`: draw the edges of faces as a line primitive. Seams of round faces are left out.

## Returns
`None`. The file has one node and one mesh per shape, named `shape.name`. Unnamed shapes get
`<type>_<i>`, counted from 1 over the whole list: `part_3`, `sketch_5`, `edge_4`, `mesh_1`.
A root node turns the model -90 degrees about X, so it stands upright in Y-up viewers, and scales
it by 0.001: the positions are the model's mm values, and the scene is in meters, as glTF
defines (a 60 mm part is 0.06 m in Blender). Positions are float32 in glTF: each shape's node
holds them relative to the middle of the shape and moves them there by its `translation`, so a
part 1 km from the origin keeps its shape (float32 positions there are off by 0.03 mm).

## Colors
- A body's own color (`colored(...)`) becomes its material color.
- Bodies without a color get a palette color by their position in the list: `#7c93b5`,
  `#d9925a`, `#79ad73`, `#c97878`, ... Colored bodies count too: an unnamed second part gets
  `#d9925a`, even when the first one has its own color.
- Edge lines are `#1f2328`. Edges and wires you pass as shapes are orange `#d9480f`, and a
  vertex is a point.
- Colors are given in sRGB (as on screens and in CSS); glTF's `baseColorFactor` is linear, so
  they are converted: `#7c93b5` is written as (0.2016, 0.2918, 0.4621). Viewers show the color
  you asked for (before 0.5.0 the sRGB values were written as they were, and looked lighter).

## Gotchas
- **Units:** the scene is in meters (root node scale 0.001). Do not scale the shapes yourself:
  `export_glb([s.scale(0.001) for s in shapes], path)` makes a 60 mm part 0.06 mm.
- Triangles are indexed: each distinct corner (a point with its normal) is written once, about
  a third of the corners (a box with a bore: 152 for 144 triangles), with 16-bit indices, 32-bit
  above 65 535 corners. A sphere of r = 10 takes 66 kB at the default tolerance, 271 kB at 0.01
  and 3.3 MB at 0.001 (before 0.5.0: 259 kB, 1 MB, 9.6 MB, unindexed). Readers that take the
  `POSITION` accessor as triangle corners must go through `indices`.
- An empty list raises `ValueError: export_glb: nothing to write` (`export_gltf: ...`
  likewise; before 0.5.0 it wrote an empty scene), and so does a body without faces
  (`ValueError: tessellate: the Part is empty: ...`).
- smlibpy cannot read glTF back (`load("x.glb")` raises `ValueError: unknown file type
  '.glb'; ...`).

## Example
```python
part = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket")
bracket = part.colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")
export_glb([bracket, cover], "assembly.glb")       # meters, Z up turned to Y up, edges as lines
export_gltf(bracket, "bracket.gltf", edges=True, edge_color="red")
```

## Related
`show` (embeds the same GLB in an HTML page), `export_stl`, `export_obj`, `tessellate`.
