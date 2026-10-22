# import_stl

Reads a binary or ASCII STL file as a `Mesh`. `load("x.stl")` does the same thing.

## Signature
`import_stl(path)`

## Returns
A `Mesh` with shared vertices. Corners at the same position (rounded to 1e-9) are welded into
one vertex. An STL written from a closed part therefore comes back closed, with the same vertex
count as the tessellation. `normals` is `None`. The normals stored in the file are ignored, and
`triangle_normals` is computed from the winding.

Binary or ASCII is decided by the file size (84 + 50 x count). A binary file whose header
starts with `solid` is read correctly.

## What you can do with it
- `volume`, `area`, `bbox()`, `len(m)` (triangles), `triangle_normals`.
- Move it: `m.translate(...)`, `rotate`, `mirror`, `scale`, `moved` (copies), or the arrays in
  place (`m.vertices += ...`).
- Mesh Booleans with other closed meshes: `m - Sphere(5).mesh()` (see `Mesh.md`).
- Measure what it encloses: `m.mass_properties(density)`, `m.centroid` (`mass_properties`).
- Cut it: `m.section(plane)` (wires), `m.slices(step)` (`Mesh-section`, `slices`).
- Thin it out: `m.decimate(0.9)`, `m.decimate(tolerance=0.01)` (`decimate`).
- Close its holes: `m.fill_holes()`, `m.repaired()` (`repaired`).
- Make a faceted part of it, for exact Booleans and STEP: `m.to_part()` (`to_part`).
- Export it again: `export_stl`, `export_glb`, `export_obj`, `render`, `show` all accept a `Mesh`.

## What you cannot do
- It is not a `Part`. There are no faces, no fillets, no exact Booleans, no `export_step`, until
  `to_part()` makes a faceted part of it.
- `name` and `color` do not exist on a `Mesh`.

## Gotchas
- A file that is not an STL, or a truncated one, raises `ValueError: not an STL file, or a
  truncated one: ...`.
- Several parts in one STL come back as one mesh. Where parts touch, their corners are welded
  together, and the mesh becomes non-manifold (two touching boxes: 5 edges used by more than
  two triangles). `volume` is still the sum.
- The coordinates went through float32: expect differences in the 7th digit compared with the
  model.
- `center()` is the bbox center, not the centroid.

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
`export_stl`, `Mesh`, `load`.
