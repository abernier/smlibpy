# Mesh / tessellate

`tessellate` turns an exact shape into an indexed triangle mesh. `Mesh` is that mesh: plain
NumPy arrays, used for STL/OBJ/glTF, render and quick measurements.

## Signatures
`tessellate(shape, tolerance=None, angle=15.0)`
`shape.mesh(tolerance=None, angle=15.0)`: the same thing as a method.
`Mesh(vertices, triangles, normals=None)`: build a mesh by hand.

- `shape`: a `Part`, `Shell`, `Sketch`, `Face` or `ShapeList`. A `ShapeList` is merged into one
  mesh. A plain Python `list`, an `Edge` or a `Wire` raises `TypeError`.
- `tolerance`: the largest mesh-to-surface distance in mm. Default: 0.1 % of the bbox diagonal.
- `angle`: the largest angle in degrees between neighbouring triangles on curved faces.
- Both must be positive: `ValueError: tessellate: tolerance and angle must be positive`.

## Fields
| Field | Type | Meaning |
|---|---|---|
| `vertices` | `(n, 3)` float64 | positions, shared between triangles of one body |
| `triangles` | `(m, 3)` int64 | vertex indices, counterclockwise seen from outside |
| `normals` | `(m, 3, 3)` float32 or `None` | unit corner normals of the exact surface. `None` for `import_stl` and hand-built meshes |
| `triangle_normals` | `(m, 3)` | computed from the winding |
| `len(m)` | int | number of triangles |
| `area`, `volume` | float | from the triangles |
| `bbox()`, `center()` | | `center()` is the **bbox center**, not the centroid |
| `is_closed()` | bool | every edge shared by exactly two triangles (watertight) |

## Tolerance and triangle count
| Shape | tolerance / angle | triangles | volume error |
|---|---|---|---|
| Cylinder(10, 20) | default (0.035) / 15 | 252 (64 segments) | -0.16 % |
| Cylinder(10, 20) | 0.001 / 15 | 1640 (411 segments) | |
| Sphere(10) | default / 15 | 3584 | -0.41 % |
| Sphere(10) | 0.01 / 5 | 16128 | -0.10 % |
| Sphere(10) | 0.001 / 15 | 133984 | -0.013 % |
| Box | anything | 12 | 0 |
| Box(20, 20, 100).twist(90) | default (0.108) / 15 | 2076 | +0.15 % |
| Box(20, 20, 100).twist(90) | 0.001 / 15 | 131596 (0.6 s) | -0.004 % |
| ruled loft, square to circle | default (0.035) / 15 | 2316 | -0.06 % |

The stricter of the two limits wins. A mesh of a closed part is closed and outward, so `volume`
is positive.

Parts with a face that is straight in one direction and twisted along it (twisted parts, a
ruled loft between different sections, the walls of a thickened free-form sheet) are divided
differently: the kernel's usual grid would put one facet across such a face (the twisted box:
68 triangles, 1 mm off, +5.5 %), so all faces of the part are halved until they are flat
within the tolerance. That costs 10 to 30 times the triangles, in proportion to 1 / tolerance.
Other parts get the kernel's triangles unchanged.

## Gotchas
- **Mesh Booleans (`m1 + m2`, `m1 - m2`, `m1 & m2`) mostly fail.** The kernel's mesh Booleans
  only work where no face of the result gets a hole (box minus an offset box). smlibpy checks
  the result (closed, a volume the operation can give) and raises `ModelingError: mesh
  difference: the kernel's mesh Boolean returned an open mesh ...` otherwise. Do the Boolean on
  the exact parts and mesh the result.
- Mesh Booleans also need meshes of one body made by `tessellate`. Meshes from `import_stl`,
  `Mesh(...)` or `tessellate(ShapeList)` raise `TypeError: mesh Booleans need meshes produced
  by tessellate()`.
- The tolerance is not a hard limit near the poles of spheres. `Sphere(10)` with
  `tolerance=0.01` had sliver triangles 0.68 mm off the surface. Add `angle=5`: the largest
  deviation then drops to 0.006.
- `volume` only means something for closed meshes. For an open mesh it changes when you move
  the mesh, and reversed winding makes it negative.
- Unlike shapes, a `Mesh` is mutable: `m.vertices += [10, 0, 0]` moves it in place. It has no
  `name` or `color`.
- Use the exact shape for measurements (`part.volume`, `part.area`). Mesh values are off by
  the tolerance.

## Example
```python
solid = Box(20, 20, 20) - Sphere(12)       # Boolean on exact parts first
m = solid.mesh(tolerance=0.01)             # then mesh
print(m, m.vertices.shape, m.triangles.shape, m.normals.shape)
print(round(m.volume, 2), round(solid.volume, 2), round(m.area, 2), round(solid.area, 2))
# Mesh(3816 vertices, 7648 triangles) (3816, 3) (7648, 3) (7648, 3, 3)
# 1620.01 1616.28 2475.65 2475.4
```

## Related
`export_stl`, `import_stl`, `export_glb`, `export_obj`, `render`.
