# to_part / Part.from_mesh

A faceted part of a closed mesh: a planar face for each triangle, where neighbouring triangles
that lie in one plane make one face. For STL files and scans that need exact Booleans (a pocket
cut into a bought part), STEP export, or measuring as a part.

## Signatures
`mesh.to_part(max_faces=5000) -> Part`
`Part.from_mesh(mesh, max_faces=5000) -> Part`

- `max_faces`: the most faces the part may get; `0` for no limit.

## Returns
A `Part` with flat faces (lines for edges), valid and with the mesh's volume: smlibpy checks both
and raises `ModelingError` where it is not (triangles that cross each other, or face inward:
`repaired()` turns them outward). Triangles in one plane (within 1e-7 of the mesh's size) become
one face, holes in it too: a box with a bore meshed at 0.01 gives 102 faces (the bore's 96 facets
and 6).

## Gotchas
- An open mesh raises `ModelingError: to_part: the mesh is open (3 open edges) ...`: close it
  with `fill_holes()` or `repaired()`.
- Booleans get slow as faces add up: a sphere of 14 080 triangles took 40 s to cut by a box. A
  mesh that would give more than `max_faces` faces raises `ModelingError`; decimate it first
  (`mesh.decimate(triangles=2000).to_part()`) or give a larger `max_faces`.
- The faces stay flat: no fillets of curved faces, and a cylinder stays a prism of facets.
- Converting takes 0.2 s for 3600 triangles.

## Example
```python
scan = (Box(40, 30, 20) - Cylinder(6, 40)).mesh(0.01)   # or import_stl("part.stl")
part = scan.to_part()
print(len(part.faces()), part.is_valid(), round(part.volume, 3))   # 102 True 21740.176
pocket = part - Box(10, 10, 40).translate(20, 15, 0)
print(round(pocket.volume, 3))                                     # 21240.176
export_step(pocket, "pocket.step")
```

## Related
`Mesh`, `decimate`, `repaired`, `import_stl`.
