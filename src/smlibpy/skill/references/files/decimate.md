# decimate

Fewer triangles for a mesh: the kernel's quadric decimation, which collapses the edges whose
removal changes the shape least first. For large scans and STL files, web viewers, and before
mesh Booleans or `to_part` (both get slow with many triangles).

## Signature
`mesh.decimate(fraction=None, *, triangles=None, tolerance=None, feature_angle=30.0) -> Mesh`

Give exactly one (`TypeError` otherwise):

- `fraction`: the share of the triangles to remove, between 0 and 1 (`0.9` leaves a tenth).
- `triangles`: about how many triangles to leave (4 or more; more than the mesh has: a copy).
- `tolerance`: how far the result may be from the mesh at most. The mesh is decimated step by
  step while the distance stays within it, measured by smlibpy at the points of both meshes and
  the middles of their triangles. This takes a few decimations: about 6 s for 137 000 triangles.

`feature_angle` (degrees, 0 to 180): edges where the triangles turn by more than it are
features, which the decimation keeps longest and which stay sharp in the result's normals.

## Returns
A new `Mesh`, closed where the mesh was closed, with the border of an open mesh kept. Its
`normals` are its own: at each corner the average of the triangles around it, except across
edges sharper than `feature_angle` (a cylinder's rims stay sharp at 30, and are rounded over at
120).

| `Sphere(10).mesh(0.001)` (136 872 triangles) | triangles | off the sphere | time |
|---|---|---|---|
| `decimate(0.5)` | 68 432 | 0.002 | 1.5 s |
| `decimate(0.9)` | 13 674 | 0.01 | 2 s |
| `decimate(tolerance=0.01)` | about 12 700 | 0.01 | 6 s |

## Gotchas
- The kernel's own "maximum error" is an accumulated quadric value, not a distance (0.05 took a
  sphere of r = 10 to 390 triangles, 5.3 mm off); `tolerance=` is a distance.
- The kernel breaks ties in an order that depends on memory, so counts differ by a few
  triangles from run to run.
- `ModelingError` where the kernel collapses the mesh far below the count asked: it does with
  the long thin triangles of a coarse mesh of a part (a cone at the default tolerance: 4
  triangles at 5 %). Mesh such a part with a larger tolerance instead of decimating it, or
  decimate a finer mesh. With `tolerance=` such steps are not taken.
- `ModelingError` where a closed mesh would come back open or an open mesh with another border
  (a tube of long triangles has all its points on its rims, and cannot keep them).
- The kernel can leave folds: smlibpy removes triangles on the same points back to back,
  unpinches edges of four triangles, turns folded slivers back, collapses what stays folded
  (the point of a sliver pushed through its neighbours, its shortest edge) and decimates again
  in steps where that is not enough. No triangle stays facing against its neighbours (spheres
  of 15 000 to 56 000 triangles taken to a fifth, a tenth and a twentieth).
- For an exact part, mesh it coarser instead: `part.mesh(tolerance=...)` follows the exact
  surface.

## Example
```python
ball = Sphere(10).mesh(0.001)                          # or import_stl("scan.stl")
light = ball.decimate(0.9)
print(len(ball), len(light), light.is_closed())        # 136872 13674 True (about)
print(round(light.volume / ball.volume - 1, 4))        # -0.0004
close = ball.decimate(tolerance=0.01)                  # within 0.01 of the fine mesh
few = ball.decimate(triangles=2000)
print(len(few))                                        # about 2000
```

## Related
`Mesh`, `repaired`, `to_part`, `export_stl`.
