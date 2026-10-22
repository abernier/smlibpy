# Measuring and analysis

## Measures

```python
from smlibpy import *

part = Box(40, 30, 20) - Cylinder(6, 30)

part.volume              # 24000 - pi * 36 * 20
part.area                # total surface area
part.center()            # center of mass
part.bbox()              # BoundBox: .min, .max, .size, .center
part.is_valid()          # a closed, manifold solid with a positive volume, faces that meet?
part.info()              # counts and bounding box in one dict

face = part.faces().top().one()
face.area, face.center(), face.normal_at(), face.geom_type

edge = part.edges().circles().first
edge.length, edge.radius, edge.arc_center, edge.point_at(0.25), edge.tangent_at(0.25)
```

Areas, volumes, centers and inertia are integrated over the exact geometry, not a mesh, to
seven significant digits (`smlibpy.shapes.ACCURACY`, 1e-7): volumes and areas to 1e-7 of
their value, centers to 1e-7 of the part's size (its bounding box diagonal), the inertia to
1e-7 of its largest principal moment. The integration estimates its error for every one of
these numbers and refines until the estimate is ten times below that; measured against
closed forms and converged references, the results are right to 1e-11 and better. Edge
lengths are integrated to 1e-12, and `point_at` follows the arc length as closely.

A part keeps its measures: `volume`, `area`, `center()` and `mass_properties()` share one
integration, the first of them pays for it: a few milliseconds for most parts, 55 ms for the
spring of `examples/spring.py` with its 512 knot spans, 0.6 s for a surface through 105 x 105
points thickened to a solid (46,000 knot spans on its top face; the kernel's own integration
takes 0.4 s there at 1e-7 and is 2e-8 off).

## Mass properties

```python
mp = part.mass_properties(density=7.85e-3)     # steel in g/mm³ gives grams
mp.mass
mp.center                  # center of mass
mp.inertia                 # 3x3 inertia tensor about the center of mass
mp.principal_moments
mp.principal_axes

precise = part.mass_properties(density=7.85e-3, accuracy=1e-10)
```

`accuracy` (1e-10 to 1e-2) sets the bound above for one call. It costs little: the spring
takes 55 ms at 1e-7 and at 1e-10, 23 ms at 1e-4. A coarse accuracy saves little on dense
free-form faces, though: every knot span gets at least 7 x 7 points, and the thickened surface
above takes 0.6 s at any accuracy.

## How exact a body is

The numbers are as exact as the body. Where the kernel fits a surface or an intersection
curve (B-spline chamfers and variable fillets, the offset faces of a shell, the cut ends of a
sweep, two cylinders crossing), neighbouring faces meet only to within about 1e-6 to 2e-5 mm,
and the volume of the body is defined only to that: measured turned by 90 degrees, the flange
of `examples/flange.py` differs by 2.6e-7, two crossing cylinders of the same radius by 3e-7,
the shelled bottle by 3.6e-6. Bodies whose edges are lines and circles close up exactly and
agree with their formulas to 1e-10 and better. Compare against formulas with a relative
tolerance of 1e-6, or 1e-5 for sweeps, shells and offsets of curved faces.

The integration measures the gaps as well: it integrates the volume with three fields, the
kernel's (0, 0, z) and (x, 0, 0) and (0, y, 0), which give the same volume only for faces that
close up. Where they differ by more than 1e-5 (or the accuracy asked for, if that is coarser),
`volume`, `area`, `center()` and `mass_properties()` say so in a `RuntimeWarning` with the size
of the uncertainty, and give the volume of the faces as they are. A sheet unfolded across a hole
in a bend zone, whose NURBS faces as trimmed do not quite meet their neighbours, gets 8e-5 (its
volume is 6e-5 off). A warning that the integration did not reach the accuracy asked for looks
the same; each comes once per part. From 1e-2 the faces do not bound one solid (a Boolean
result that left a face out: 0.25), and `is_valid()` is False.

## Distances

```python
a = Box(10, 10, 10)
b = Sphere(3).translate(20, 0, 0)
a.distance_to(b)                 # 12.0
a.distance_to((0, 0, 30))        # to a point
a.closest_point((0, 0, 30))      # Vector(0, 0, 5)
```

The distance between bodies is exact, also between faces that are nearly parallel: the closest
points are refined on the faces' own parameters until they settle, and `distance_to` warns if
they do not.

## Rays

`raycast` gives the exact points where a ray meets a body (or a face, or a mesh), nearest
first, each with its distance, the face and the outward normal there. What a line of sight
sees first and wall thicknesses along a direction come from it:

```python
part = Box(40, 30, 20) - Cylinder(5, 30)
hits = part.raycast((-50, 0, 0), (1, 0, 0))
print([round(h.distance, 6) for h in hits])        # [30.0, 45.0, 55.0, 70.0]: in, hole, out of it, out
print(hits[1].face.geom_type, hits[1].normal)      # cylinder Vector(1, 0, 0): into the hole
top = part.raycast(Axis((10, 8, 50), (0, 0, -1)))[0]
print(top.point)                                   # Vector(10, 8, 10)
```

To select faces with a ray instead, and chain on, use `part.faces().hit_by(origin, direction)`
(see [Selecting](selecting.md#by-position)).

Many rays at once (height maps, depth images, visibility, sampling) go through `raycast_many`:
the first hit of each ray, or `None`. It traces the rays through a mesh of the part with the
kernel's ray tracer and moves each hit onto the exact face, 20 to 50 times faster than one
`raycast` per ray on a plate with holes; on a mesh it is the tracer alone:

```python
import numpy as np

xs, ys = np.meshgrid(np.linspace(-20, 20, 41), np.linspace(-15, 15, 31))
origins = np.column_stack([xs.ravel(), ys.ravel(), np.full(xs.size, 50.0)])
hits = part.raycast_many(origins, (0, 0, -1))       # one direction for all rays
print(sum(h is None for h in hits))                 # 69: the rays through the hole
first = part.mesh().raycast_many(origins, (0, 0, -1))  # on the triangles
```

## Inside or outside

`classify` says where a point lies: in the material, outside (a cavity is outside), or on the
surface, with the vertex, edge or face it lies on. `contains` is True inside and on the surface.
They are exact; the parity of `raycast` hits is not where a ray grazes a face or passes through
an edge (a ray tangent to a cylinder hits it once):

```python
part = Box(40, 30, 20) - Cylinder(5, 30)
print(part.classify((10, 8, 0)))                   # ('inside', None)
print(part.classify((20, 0, 0))[0])                # on: the right side
print(part.contains((10, 8, 0)), part.contains((0, 0, 0)))   # True False: in the hole
cells = Box(20, 20, 20).merge(Cylinder(4, 30))
print(round(cells.cell_at((0, 0, 0)).volume, 3))   # 1005.31: the cell of a merged part there
```

## Intersections and projections

```python
box = Box(20, 20, 20)
pipe = Cylinder(4, 40).rotate(X, 30)

box.intersection_curves(pipe)               # where the surfaces cross, as edges
Sphere(10).silhouette((0, 0, 1))            # the contour seen along a direction: one circle
box.project(CenterArc((0, 0, 30), 5, 0, 360), (0, 0, -1))   # curve onto the faces below
box.outline(Plane.XZ)                       # the visible edges projected to a plane
seen, hidden = (box - pipe).outline(Plane.XZ, hidden=True)  # and the hidden ones
Line((0, 0), (10, 10)).intersections(Line((0, 10), (10, 0)))  # [Vector(5, 5, 0)]
```

## Draft and parting lines

A part that is molded or cast must come out of its mold: every face needs draft, a slight
angle towards the direction in which its mold half moves away. `draft_analysis` measures the
draft angle of every face for a pull direction and sorts the faces into four groups:
`positive` (at least `min_angle` everywhere), `insufficient` (some draft, but less),
`vertical` (parallel to the direction) and `undercut` (turned away from it somewhere).

```python
core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
up = core.draft_analysis(Z, min_angle=1)
print(len(up.positive), len(up.vertical), len(up.undercut))   # 9 0 1: the walls, the top; the bottom
print(Box(40, 30, 20).draft_analysis(Z).vertical.__len__())    # 4 walls that need draft
```

The groups are selections of the part's faces, and `up.angles(face)` gives the least and the
greatest angle of a face in degrees. The bottom of the core turns away from Z: in a two-part
mold it belongs to the other half, which `draft_analysis(-Z)` checks. Faces without enough draft
get it with `part.draft(faces, angle, neutral_plane)` (see [Features](features.md#draft)).

`parting_line` finds where the two halves meet: where the surface turns from facing the
direction to facing away from it, through the middle of curved faces where needed. The lines
are closed wires of exact curves, a circle around a sphere's equator:

```python
equator = Sphere(10).parting_line(Z)[0]
print([e.geom_type for e in equator.edges()], round(equator.length, 6))   # ['circle', 'circle'] 62.831853
print(core.parting_line(Z)[0].bbox().max.z)                             # 0.0: the core's bottom rim
```

## Meshes

`tessellate` (or `shape.mesh()`) turns exact shapes into triangles, with a tolerance on the
distance to the true surface:

```python
mesh = part.mesh(tolerance=0.01)
mesh.vertices, mesh.triangles          # numpy arrays
mesh.volume, mesh.area, len(mesh)
```

A part with a face that stays straight across while it twists along (a twisted part, a ruled
loft between different sections, the walls of a thickened free-form sheet) is divided until
all its faces are flat within the tolerance. Its mesh is right, but it takes many more
triangles: 2076 for `Box(20, 20, 100).twist(90)`, where the box has 12.

The points of a mesh are double precision, and its corner normals are those of the exact
surface (at the apex of a cone, where each line of the cone has a normal of its own, the normal
beside the corner).

Closed meshes from anywhere (`tessellate`, `import_stl`, `Mesh(...)`) take `+`, `-` and `&`,
for meshes that have no exact part behind them, such as scans. Every result is checked (closed,
a volume the operation can give), and where the kernel fails, which still happens for some
meshes, it raises `ModelingError`. With exact parts, do the Boolean on the parts and mesh the
result:

```python
corners = Box(20, 20, 20).mesh() - Sphere(12).mesh()       # a mesh Boolean
print(corners.is_closed(), round(corners.volume, 2))       # True 1631.68
blob = (Box(20, 20, 20) - Sphere(12)).mesh(tolerance=0.01) # exact first: closer to 1616.28
print(round(blob.volume, 2))
```

A mesh Boolean's triangles take the normals of the operand triangles they lie on (turned on the
inside of a cut), so its result shades as its operands do; meshes without normals give a result
without.

`max_edge` bounds the length of the triangles' edges, for evenly sized triangles (simulation
meshes, deformation, sampling) where the tolerance alone leaves a flat face two long triangles.
`tessellate`, `mesh` and the mesh exports (`export_stl`, `export_obj`, `export_glb`,
`export_gltf`, `export_usd`) take it:

```python
plate = Box(100, 100, 2) - Cylinder(5, 10)
print(len(plate.mesh(0.1)), len(plate.mesh(0.1, max_edge=10)))   # 144 706: edges of 100, under 13
```

With `max_edge` every face is meshed by the kernel's grid; a part with a twisted face, which the
grid meshes too far off (see above), gets a `RuntimeWarning` saying how far, and a smaller
`max_edge` brings the grid nearer.

### Measuring and cutting meshes

Meshes of scans and STL files have no exact part behind them; they are measured and cut on their
triangles. `mass_properties` gives the mass, center and inertia of what a closed mesh encloses,
exact for its triangles (the same `MassProperties` as a part's); `centroid` is its center of mass
(`center()` is the middle of the bounding box):

```python
scan = (Box(40, 30, 20) - Cylinder(6, 40)).mesh(0.01)
mp = scan.mass_properties(density=7.85e-3)      # steel, g/mm³
print(round(mp.mass, 2), scan.centroid)         # 170.66 Vector(0, 0, 0)
```

`section(plane)` cuts a mesh: the wires where its triangles cross the plane, chained into loops
(outer loops counterclockwise seen from the plane's normal, holes clockwise, as the faces of a
part's section). `slices(step)` cuts it into layers, a section in the middle of each, and
`Part.slices` does the same for exact parts (a `Sketch` per layer):

```python
loops = scan.section(Plane.XY)
print([round(w.length, 3) for w in loops])                      # [140.0, 37.69]
region = make_face(loops[0]) - make_face(loops[1])
print(round(region.area, 2))                                    # 1087.01 (exact: 1086.9)
print(len(scan.slices(5)), len((Box(40, 30, 20) - Cylinder(6, 40)).slices(5)))   # 4 4
```

A plane through a flat part of a mesh (the top face of a box's mesh) cuts it just beside that,
on the side where the cut encloses more.

### Fewer triangles, closed meshes, faceted parts

`decimate` thins a mesh out with the kernel's quadric decimation, which keeps a closed mesh
closed: give the share of the triangles to remove, about how many to leave, or how far the result
may be from the mesh (`tolerance=`, measured by smlibpy at the points of both meshes; the kernel's
own "maximum error" is not a distance). `fill_holes` closes the holes of an open mesh;
`repaired` also merges points that lie on each other, leaves out triangles without an area or
repeated, turns triangles that face the wrong way, and says what it did. `to_part` (or
`Part.from_mesh`) makes a faceted part of a closed mesh, for exact Booleans and STEP files:
neighbouring triangles in one plane become one face, and a mesh that would give more than
`max_faces` faces (5000) raises, since Booleans on many faces get slow:

```python
ball = Sphere(10).mesh(0.001)
print(len(ball), len(ball.decimate(0.9)))           # 136872 13674 (about; the kernel varies a little)
print(len(ball.decimate(tolerance=0.01)) < 15000)   # True: within 0.01 of the fine mesh

holed = Mesh(scan.vertices, scan.triangles[1:])      # a triangle missing
fixed, report = holed.repaired()
print(fixed.is_closed(), report["filled_holes"])    # True 1

block = scan.to_part()                               # faceted: 102 faces, the bore's facets and 6
print(block.is_valid(), round(block.volume, 3))      # True 21740.176 (the mesh's volume)
print(round((block - Box(10, 10, 40).translate(20, 15, 0)).volume, 3))   # 21240.176
```
