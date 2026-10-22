# export_glb / export_gltf

Writes shapes as a glTF 2.0 scene: triangle meshes with colors and names, plus the B-rep edges
as lines. Use it for web viewers, presentations and other tools that show meshes.

## Signatures
`export_glb(shapes, path, *, tolerance=None, angle=15.0, edges=True, edge_color="#1f2328")`: one
binary `.glb` file.
`export_gltf(shapes, path, **kwargs)`: one `.gltf` JSON file with the buffer embedded as a
base64 data URI (1.3 times larger). It takes the same keyword arguments.

- `shapes`: parts, shells, sketches, faces, meshes, edges, wires, vertices, or lists of them.
- `tolerance`, `angle`: as in `tessellate`.
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
- Triangles are not indexed (3 vertices each, about 72 bytes per triangle). A sphere of r = 10
  takes 259 kB at the default tolerance, 1 MB at 0.01 and 9.6 MB at 0.001.
- An empty list writes a valid, empty scene without an error.
- smlibpy cannot read glTF back (`load("x.glb")` raises `ValueError: unknown file type
  '.glb'; ...`).

## Example
```python
bracket = part.colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")
export_glb([bracket, cover], "assembly.glb")       # meters, Z up turned to Y up, edges as lines
export_gltf(bracket, "bracket.gltf", edges=True, edge_color="red")
```
(`part` is the bracket from `export_stl.md`.)

## Related
`show` (embeds the same GLB in an HTML page), `export_stl`, `export_obj`, `tessellate`.
