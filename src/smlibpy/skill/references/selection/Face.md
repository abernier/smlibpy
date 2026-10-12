# Face

One bounded piece of a surface of a Part, Shell or Sketch. You get faces from `body.faces()`;
there is no public constructor.

## Properties and methods
| Member | Gives |
|---|---|
| `geom_type` | `"plane"`, `"cylinder"`, `"cone"`, `"sphere"`, `"torus"`, `"revolution"`, `"extrusion"`, `"bspline"`, `"offset"`, `"other"` |
| `area` | area in mm² |
| `center()` | area centroid (may lie off the face) |
| `interior_point()` | a point that lies on the face |
| `normal_at(point=None)` | outward unit normal at the face point closest to `point` |
| `plane` | `Plane` at the centroid, normal outward (planar faces only) |
| `is_planar` | True for `"plane"` faces |
| `radius` | cylinder, sphere radius; cone: bottom radius; torus: minor radius |
| `axis` | `Axis` of a cylinder, cone, sphere, torus, revolution face |
| `outer_wire()`, `inner_wires()`, `wires()`, `edges(seams=False)`, `vertices()`, `neighbors()`, `owner` | topology, see `topology` |
| `to_sketch()` | a Sketch with a copy of a planar face, holes included |
| `to_shell()` | a Shell with a copy of any face |
| `extrude(amount)` | a Part from a planar face, `amount` along the outward normal |
| `distance_to(point)`, `bbox()` | true distance, tight bounding box |

## Details
- `normal_at()` points out of the material. On a hole wall it points towards the hole's axis:
  `normal_at((6, 0, 0))` on a hole of radius 6 gives (−1, 0, 0); on a boss (+1, 0, 0).
  A point off the face is projected onto the face first. Planar faces return the plane normal.
- `plane` of a planar face: origin at the centroid, z = outward normal. The x direction for faces of
  a Box: top and bottom (1, 0, 0); +X face (0, 1, 0); −X (0, −1, 0); −Y (1, 0, 0); +Y (−1, 0, 0). On all
  four side faces local Y points up (+Z). Faces of a Sketch keep the sketch's x direction.
- `extrude(5)` grows outward (top face: z 10..15), `extrude(-5)` goes into the part.
- `axis` of a cylinder or cone: the origin is on the axis but not necessarily on the face (a hole
  cut by `Cylinder(6, 30)` in a 20 mm block has its axis origin at z=−15). Sphere and torus: `Axis.Z`
  for the primitives.

## Gotchas
- The centroid is not on the face for faces with holes, rings and full cylinders. `sketch.on(face)`
  places the sketch at the centroid: on the top face of a block with a centered hole, `on(top)`
  puts the sketch in the hole and a pocket cut there removes nothing. Shift in face coordinates
  before placing (`Rectangle(10, 6).translate(12, 0, 0).on(top)`), or build the plane yourself.
- `normal_at()` without a point on a full cylinder, sphere or torus is arbitrary (the centroid
  lies on the axis). Pass a point on the face.
- `plane`, `to_sketch()` and `extrude()` raise `ValueError: a cylinder face has no plane; use
  normal_at() or a planar face` on curved faces.
- Flat faces of type `"bspline"` (`to_nurbs()`, `surface()`, many STEP imports) have
  `is_planar == False` and no `plane`. Workaround: `Plane(face.center(), z_dir=face.normal_at())`.
- `radius` and `axis` raise `ValueError: a plane face has no radius` / `... no axis` on planes.
  Narrow with `cylinders()` first.
- `center()` and `area` are computed by integration: expect noise of about 1e-6 in coordinates.
- A face moved with `translate`/`rotate` is a face of a new Shell, not of the part.

## Example
```python
part = Box(40, 30, 20) - Cylinder(6, 30)
top = part.faces().top().one()
print(top.geom_type, round(top.area, 1))         # plane 1086.9
print(top.normal_at(), top.plane.x_dir)          # Vector(0, 0, 1) Vector(1, 0, 0)
print(len(top.inner_wires()))                    # 1: the hole

hole = part.faces().cylinders().one()
print(hole.radius, hole.axis.direction)          # 6.0 Vector(0, 0, 1)
print(hole.normal_at((6, 0, 0)))                 # Vector(-1, 0, 0): out of the material, into the hole

boss = top.to_sketch().extrude(5)                # same as top.extrude(5): outward, z 10..15
print(round(boss.volume, 3), boss.bbox().min.z)  # 5434.513 10.0
print(round(part.volume, 3))                     # 21738.053
lost = Rectangle(10, 6).on(top).extrude(-4)      # placed at the centroid (0, 0, 10): inside the hole
print(round((part - lost).volume, 3))            # 21738.053: nothing removed
pocket = Rectangle(10, 6).translate(12, 0, 0).on(top).extrude(-4)   # move in face coordinates first
print(round((part - pocket).volume, 3))          # 21498.053: 10 * 6 * 4 removed
```

## Related
`topology`, `types`, `spatial` (`facing`), `Edge`, `Vertex`, `Plane` (geometry domain),
`Sketch.extrude` (features domain).
