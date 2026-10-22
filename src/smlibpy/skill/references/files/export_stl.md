# export_stl

Writes shapes as one triangle mesh to an STL file, for 3D printing and mesh tools.

## Signature
`export_stl(shapes, path, *, tolerance=None, angle=15.0, ascii=False)`

- `shapes`: a `Part`, `Shell`, `Sketch`, `Face`, `Mesh`, or a list of them.
- `tolerance`: the largest distance between the mesh and the exact surface, in mm. The default
  is 0.1 % of each body's bbox diagonal.
- `angle`: the largest angle in degrees between neighbouring triangles on curved faces.
- `ascii`: `False` (default) writes binary STL. `True` writes text that is 4.6 times larger.

## Returns
`None`. Binary file: an 80-byte header (`smlibpy binary STL`), the triangle count, then
50 bytes per triangle. Normals in the file agree with the winding (outward for solids).

## Tolerance and triangle count
Bracket 60 x 40 x 8 with a hole of r = 4 (volume 18797.876):

| tolerance | angle | triangles | mesh volume error |
|---|---|---|---|
| default, 1, 0.1 | 15 | 144 | +1.4e-4 |
| 0.01 | 15 | 272 | +3.5e-5 |
| 0.001 | 15 | 1048 | +2.1e-6 |
| default | 5 | 528 | |
| default | 1 | 2080 | |

Both limits apply and the stricter one wins. Planar faces ignore both: a box is always 12
triangles. On a cylinder of r = 10, tolerance 0.001 gives 411 segments. For 3D printing,
`tolerance=0.01` is plenty.

## Gotchas
- Several parts go into **one** unnamed mesh. STL has no names, no colors, no units. Readers
  assume mm, but nothing in the file says so.
- Coordinates are float32 (about 7 digits). Far from the origin the resolution drops, to about
  0.01 mm at 100 m. ASCII is no more precise: it writes 7 digits too.
- A `Sketch` or face becomes 2 triangles per planar face: an open mesh, useless for printing.
- Do Booleans on the exact parts before you export: exact, and the mesh then follows the
  tolerance. Mesh Booleans (`Mesh.md`) are for meshes without a part behind them.

## Errors
- `ValueError: need at least one array to concatenate`: the list was empty.
- `TypeError: cannot tessellate a Edge`: edges and wires have no triangles.
- `ValueError: tessellate: tolerance and angle must be positive`: `tolerance <= 0` or
  `angle <= 0`.

## Example
```python
part = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket")
export_stl(part, "bracket.stl")                      # binary, default tolerance
export_stl(part, "bracket_fine.stl", tolerance=0.01) # finer: 0.01 mm chord error
m = import_stl("bracket_fine.stl")
print(m, round(m.volume, 3), round(part.volume, 3))
# Mesh(136 vertices, 272 triangles) 18798.526 18797.876
```

## Related
`import_stl`, `Mesh` / `tessellate` (same `tolerance`/`angle`), `export_glb` (keeps names and
colors), `export_step` (exact).
