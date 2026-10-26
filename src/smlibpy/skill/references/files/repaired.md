# repaired / fill_holes

Closes the holes of a mesh, and repairs what scans and STL files from elsewhere get wrong.

## Signatures
`mesh.fill_holes() -> Mesh`
`mesh.repaired() -> tuple[Mesh, RepairReport]`

## fill_holes
Every hole (a border of edges that only one triangle has, closing on itself) is filled with
triangles: the kernel's triangulation of its polygon, flat or not; where that fails (a long hole
that zigzags about its plane), ear clipping seen along the polygon's normal; where that fails
too, a fan around a new point in its middle. Holes that touch at a point are filled one by one.
The mesh's triangles stay as they are, with their normals; the new ones face as the triangles
beside them do and have flat normals.

## repaired
Returns `(mesh, report)`. In this order:

1. Points that lie on each other (to 1e-9 of the largest coordinate) are merged.
2. Triangles left without an area (two corners merged) and repeated triangles are left out.
3. Triangles are turned to face as their neighbours face; a closed piece outward (positive
   volume), an open piece as most of its triangles did.
4. Holes are filled, as `fill_holes`.

The report, a `RepairReport`, counts `merged_vertices`, `removed_triangles`, `flipped_triangles`, `filled_holes`,
`open_holes` (borders that do not close on themselves, left open) and `open_edges` (edges of the
result not shared by two triangles: 0 for a closed mesh). Normals of turned triangles turn too.

## Example
```python
scan = (Box(40, 30, 20) - Cylinder(6, 40)).mesh(0.01)
holed = Mesh(scan.vertices, scan.triangles[1:])         # a triangle missing
print(holed.is_closed(), holed.fill_holes().is_closed()) # False True
fixed, report = holed.repaired()
print(report.filled_holes, report.open_edges)            # 1 0
print(report)   # RepairReport(merged_vertices=0, removed_triangles=0, flipped_triangles=0, filled_holes=1, open_holes=0, open_edges=0)
print(round(fixed.volume, 3), round(scan.volume, 3))     # 21740.176 21740.176
```

## Gotchas
- A filled hole is a patch across the hole, not the surface that was there: a sphere with its
  cap cut off gets a flat lid.
- Meshes that cross themselves stay crossed; `is_closed()` only counts edges.

## Related
`Mesh`, `import_stl`, `to_part`, `decimate`.
