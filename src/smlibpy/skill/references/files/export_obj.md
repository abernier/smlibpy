# export_obj

Writes shapes as Wavefront OBJ: one named object per shape, triangles only.

## Signature
`export_obj(shapes, path, *, tolerance=None, angle=15.0)`

- `shapes`: parts, shells, sketches, faces, meshes, or lists of them.
- `tolerance`, `angle`: as in `tessellate`. For the 60 x 40 x 8 bracket with a hole of r = 4:
  default 144 triangles, `tolerance=0.01` 272, `angle=5` 528.

## Returns
`None`. The file is plain text:
```
# smlibpy
o bracket
v -30 -20 -4          (12 significant digits, mm)
f 1 2 3               (1-based, numbered across the whole file)
```
Unnamed shapes are called `part_<i>` (meshes too), counted from 1 over the list.

## Gotchas
- No normals, no colors or materials (`.mtl`), no units. Use `export_glb` when colors matter.
- Vertices are shared within an object, not between objects.
- An empty list writes a file with only `# smlibpy`, without an error.
- Edges and wires cannot be written (`TypeError: 'Edge' object is not iterable`).
- smlibpy cannot read OBJ back (`load("x.obj")` raises `ValueError: unknown file type
  '.obj'; ...`).

## Example
```python
export_obj([bracket, cover], "assembly.obj", tolerance=0.01)
print([l.strip() for l in open("assembly.obj") if l.startswith("o ")])   # ['o bracket', 'o cover']
```
(`bracket` and `cover` as in `export_glb.md`.)

## Related
`export_stl`, `export_glb`, `tessellate`.
