# Mesh / tessellate

`tessellate` turns an exact shape into an indexed triangle mesh. `Mesh` is that mesh: plain
NumPy arrays, used for STL/OBJ/glTF, render and quick measurements. Meshes from elsewhere (scans,
STL files) are measured, cut, thinned out, repaired and turned into faceted parts with the
methods below.

## Signatures
`tessellate(shape, tolerance=None, angle=15.0, *, max_edge=None)`
`shape.mesh(tolerance=None, angle=15.0, *, max_edge=None)`: the same thing as a method.
`Mesh(vertices, triangles, normals=None)`: build a mesh by hand.

- `shape`: a `Part`, `Shell`, `Sketch`, `Face` or `ShapeList`. A `ShapeList` is merged into one
  mesh. A plain Python `list`, an `Edge` or a `Wire` raises `TypeError`.
- `tolerance`: the largest mesh-to-surface distance in mm. Default: 0.1 % of the bbox diagonal.
- `angle`: the largest angle in degrees between neighbouring triangles on curved faces.
- Both must be positive: `ValueError: tessellate: tolerance and angle must be positive`.
- `max_edge`: the longest edge a triangle may have (default: no limit), for evenly sized
  triangles. `Box(100, 100, 2) - Cylinder(5, 10)` at tolerance 0.1: 144 triangles with edges of
  100; `max_edge=10`: 706, all under 13. With it every face is meshed by the kernel's grid: a
  part with a twisted face (below) gets a `RuntimeWarning` saying how far off the grid is
  (`Box(10, 10, 40).twist(90)` at 0.01 with `max_edge=5`: about 0.13; `max_edge=1` is close
  enough and warns no more).

## Fields
| Field | Type | Meaning |
|---|---|---|
| `vertices` | `(n, 3)` float64 | positions, shared between triangles of one body; double precision also far from the origin |
| `triangles` | `(m, 3)` int64 | vertex indices, counterclockwise seen from outside |
| `normals` | `(m, 3, 3)` float32 or `None` | unit corner normals of the exact surface (at the apex of a cone, the normal of the surface beside the corner). `None` for `import_stl` and hand-built meshes |
| `triangle_normals` | `(m, 3)` | computed from the winding |
| `len(m)` | int | number of triangles |
| `area`, `volume` | float | from the triangles |
| `bbox()`, `center()` | | `center()` is the **bbox center**; an empty mesh raises `ValueError: an empty mesh has no bounding box` |
| `mass_properties(density=1.0)`, `centroid` | `MassProperties`, `Vector` | of what a closed mesh encloses, exact for its triangles (see `mass_properties`) |
| `section(plane)`, `slices(step, axis=Z)` | `ShapeList[Wire]`, list of them | where a plane cuts the triangles, chained into loops (see `Mesh-section`, `slices`) |
| `decimate(fraction)`, `decimate(triangles=n)`, `decimate(tolerance=t)` | `Mesh` | fewer triangles, closed meshes stay closed (see `decimate`) |
| `fill_holes()`, `repaired()` | `Mesh`, `(Mesh, dict)` | holes closed; also merged points, triangles turned outward (see `repaired`) |
| `to_part(max_faces=5000)`, `Part.from_mesh(mesh)` | `Part` | a faceted part, for exact Booleans and STEP (see `to_part`) |
| `is_closed()` | bool | every edge shared by exactly two triangles (watertight) |
| `raycast(origin, direction)` | list of `Hit` | where a ray meets the triangles, nearest first (see `raycast`) |
| `raycast_many(origins, directions)` | list of `Hit` or `None` | the first hit of each of many rays, by the kernel's ray tracer (see `raycast`) |
| `m1 + m2`, `m1 - m2`, `m1 & m2` | `Mesh` | mesh Booleans, see below |
| `translate`, `rotate`, `mirror`, `scale`, `moved` | `Mesh` | a moved copy, as for shapes (normals turn along; a mirrored mesh still faces outward) |

## Tolerance and triangle count
| Shape | tolerance / angle | triangles | volume error |
|---|---|---|---|
| Cylinder(10, 20) | default (0.035) / 15 | 252 (64 segments) | -0.16 % |
| Cylinder(10, 20) | 0.001 / 15 | 1640 (411 segments) | |
| Sphere(10) | default / 15 | 3596 | -0.41 % |
| Sphere(10) | 0.01 / 15 | 15004 | -0.10 % |
| Sphere(10) | 0.001 / 15 | 136872 (0.75 s) | -0.012 % |
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
So are parts with a free-form face whose surface the grid misses by more than twice the
tolerance at one of its control points (a bump inside a face with straight borders falls between
the grid's lines: a sheet with one point raised by 5 was meshed flat). On spheres, tori, cones
and cylinders, edges whose middle is more than the tolerance off the face are split onto it
(the grid's slivers near the poles of a sphere were 68 times the tolerance off). Other parts get
the kernel's triangles unchanged.

## Mesh Booleans
`m1 + m2`, `m1 - m2`, `m1 & m2` work on closed meshes from anywhere: `tessellate`, `import_stl`,
`Mesh(...)`. The result is a closed mesh. For meshes that have no exact part behind them (scans,
STL files from elsewhere); with exact parts, do the Boolean on the parts and mesh the result
(exact, and the mesh then follows the tolerance).

- The result's triangles take the corner normals of the operand triangles they lie on (turned
  on the inside of a cut): it shades as its operands do. Meshes without normals (`import_stl`,
  `Mesh(...)`) give a result without.
- smlibpy checks every result (closed, a volume the operation can give) and raises
  `ModelingError: mesh union: the kernel's mesh Boolean returned a volume of 0, where 8000 to
  9685.51 is possible; ...` where the kernel fails. It still does for some meshes (a slanted
  pin through a box).
- The time grows fast with the triangles: 2000 triangles 0.03 s, 260000 triangles 13 s.
- Open meshes are not checked (they have no volume to compare): check `is_closed()` of both
  first.

## Gotchas
- `volume` only means something for closed meshes. For an open mesh it changes when you move
  the mesh, and reversed winding makes it negative.
- Unlike shapes, a `Mesh` is mutable: `m.vertices += [10, 0, 0]` moves it in place, and mesh
  Booleans, exports and `render` all use the arrays as they are then. `m.translate(10, 0, 0)`
  returns a moved copy instead. It has no `name` or `color`.
- Use the exact shape for measurements (`part.volume`, `part.area`). Mesh values are off by
  the tolerance.

## Example
```python
corners = Box(20, 20, 20).mesh() - Sphere(12).mesh()   # a mesh Boolean
print(corners.is_closed(), round(corners.volume, 2))    # True 1631.68 (exact: 1616.28)

solid = Box(20, 20, 20) - Sphere(12)       # Boolean on exact parts first
m = solid.mesh(tolerance=0.01)             # then mesh
print(m, m.vertices.shape, m.triangles.shape, m.normals.shape)
print(round(m.volume, 2), round(solid.volume, 2), round(m.area, 2), round(solid.area, 2))
# Mesh(3816 vertices, 7648 triangles) (3816, 3) (7648, 3) (7648, 3, 3)
# 1620.01 1616.28 2475.65 2475.4
```

## Related
`export_stl`, `import_stl`, `export_glb`, `export_obj`, `export_usd`, `raycast`, `render`,
`mass_properties`, `Mesh-section`, `slices`, `decimate`, `repaired`, `to_part`.
