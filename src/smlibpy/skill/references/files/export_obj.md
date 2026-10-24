# export_obj

Writes shapes as Wavefront OBJ: one named object per shape, triangles with the normal of each
corner.

## Signature
`export_obj(shapes, path, *, tolerance=None, angle=15.0, max_edge=None)`

- `shapes`: parts, shells, sketches, faces, meshes, or lists of them.
- `tolerance`, `angle`, `max_edge`: as in `tessellate`. For the 60 x 40 x 8 bracket with a hole
  of r = 4: default 144 triangles, `tolerance=0.01` 272, `angle=5` 528.

## Returns
`None`. The file is plain text:
```
# smlibpy
o bracket
v -30 -20 -4          (12 significant digits, mm)
vn 0 0 -1             (each distinct normal once, 6 digits)
f 1//1 2//1 3//1      (point//normal, 1-based, numbered across the whole file)
```
Unnamed shapes are called `part_<i>` (meshes too), counted from 1 over the list.

## Gotchas
- The normals are the exact surface's (a mesh's `normals`; a mesh without them, each
  triangle's own): sharp edges stay sharp, curved faces shade smooth (before 0.5.0 OBJ had no
  normals, and readers smoothed them across sharp edges).
- No colors or materials (`.mtl`), no units. Use `export_glb` when colors matter.
- Vertices are shared within an object, not between objects.
- An empty list raises `ValueError: export_obj: nothing to write` (before 0.5.0 it wrote a file
  with only `# smlibpy`), and so does a body without faces (`ValueError: tessellate: the Part is
  empty: ...`).
- Edges and wires cannot be written (`TypeError: export_obj writes parts, sheets, faces and
  meshes, not an Edge: ...`).
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
