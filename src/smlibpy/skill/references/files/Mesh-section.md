# Mesh.section

Where a plane cuts a mesh: polylines through the points where its triangles cross the plane,
chained into loops. For meshes without an exact part behind them (scans, STL files); a part's
own `section` is exact and gives a `Sketch`.

## Signature
`mesh.section(plane=Plane.XY) -> ShapeList[Wire]`

- `plane`: a `Plane` or a planar face (its plane).

## Returns
Wires of straight edges, the longest first. Points where the cut runs straight on are left out
(a box's mesh cut across gives 4 edges, not one per triangle).

- A closed mesh gives closed loops: outer loops counterclockwise seen from the plane's normal,
  holes clockwise, as the faces of `Part.section` run. `make_face(outer) - make_face(hole)` is
  the region (`make_face(loop)` takes one closed wire).
- An open mesh (a sheet, a scan with a hole) can give open polylines (`not wire.is_closed`).
- A plane that misses the mesh gives an empty `ShapeList`.
- A plane through a flat part of the mesh (the top face of a box's mesh) cuts it just beside
  that, on the side where the cut encloses more: the top face's outline.
- Points that lie on each other count as one, so an STL file's triangles (each with its own
  corners, `Mesh(soup, ...)`) chain as well.

## Accuracy
The loops follow the mesh, not the exact surface: a bore of r = 6 meshed at 0.01 gives a
polygon of 37.690 (circle: 37.699).

## Example
```python
scan = (Box(40, 30, 20) - Cylinder(6, 40)).mesh(0.01)   # or import_stl("part.stl")
outer, hole = scan.section(Plane.XY)
print(len(outer.edges()), round(outer.length, 3), round(hole.length, 3))   # 4 140.0 37.69
print(round((make_face(outer) - make_face(hole)).area, 2))          # 1087.01 (exact 1086.9)
print([round(w.length, 3) for w in scan.section(Plane.XY.offset(10))])   # the top face: [140.0, 37.69]
print(len(scan.section(Plane.XY.offset(50))))                       # 0: the plane misses it
```

## Related
`slices` (sections a step apart), `features/section` (exact sections of parts), `Mesh`.
