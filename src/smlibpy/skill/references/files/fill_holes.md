# fill_holes

`mesh.fill_holes()` closes every hole of a mesh with triangles and keeps its own triangles; see
`repaired` (which also merges points, leaves out triangles without an area and turns triangles
outward, and reports what it did).

## Example
```python
box = Box(10, 10, 10).mesh()
holed = Mesh(box.vertices, box.triangles[1:])
print(holed.is_closed(), holed.fill_holes().is_closed())   # False True
```
