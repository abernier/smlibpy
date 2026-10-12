# Measuring and analysis

## Measures

```python
from smlibpy import *

part = Box(40, 30, 20) - Cylinder(6, 30)

part.volume              # 24000 - pi * 36 * 20
part.area                # total surface area
part.center()            # center of mass
part.bbox()              # BoundBox: .min, .max, .size, .center
part.is_valid()          # a closed, manifold solid?
part.info()              # counts and bounding box in one dict

face = part.faces().top().one()
face.area, face.center(), face.normal_at(), face.geom_type

edge = part.edges().circles().first
edge.length, edge.radius, edge.arc_center, edge.point_at(0.25), edge.tangent_at(0.25)
```

Areas, volumes and centers come from numerical integration over the exact NURBS geometry,
to a relative accuracy of 1e-7 by default (`smlibpy.shapes.ACCURACY`). They do not depend
on a mesh.

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

## Distances

```python
a = Box(10, 10, 10)
b = Sphere(3).translate(20, 0, 0)
a.distance_to(b)                 # 12.0
a.distance_to((0, 0, 30))        # to a point
a.closest_point((0, 0, 30))      # Vector(0, 0, 5)
```

## Intersections and projections

```python
box = Box(20, 20, 20)
pipe = Cylinder(4, 40).rotate(X, 30)

box.intersection_curves(pipe)               # where the surfaces cross, as edges
Sphere(10).silhouette((0, 0, 1))            # outline seen along a direction
box.project(CenterArc((0, 0, 30), 5, 0, 360), (0, 0, -1))   # curve onto the faces below
box.outline(Plane.XZ)                       # edges projected to a plane
Line((0, 0), (10, 10)).intersections(Line((0, 10), (10, 0)))  # [Vector(5, 5, 0)]
```

## Meshes

`tessellate` (or `shape.mesh()`) turns exact shapes into triangles, with a tolerance on the
distance to the true surface:

```python
mesh = part.mesh(tolerance=0.01)
mesh.vertices, mesh.triangles          # numpy arrays
mesh.volume, mesh.area, len(mesh)
```

Meshes support Booleans of their own, which is handy for scanned or STL data:

```python
a, b = Box(10, 10, 10).mesh(), Sphere(6).mesh()
blob = a - b
```
