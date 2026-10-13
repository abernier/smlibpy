# Measuring and analysis

## Measures

```python
from smlibpy import *

part = Box(40, 30, 20) - Cylinder(6, 30)

part.volume              # 24000 - pi * 36 * 20
part.area                # total surface area
part.center()            # center of mass
part.bbox()              # BoundBox: .min, .max, .size, .center
part.is_valid()          # a closed, manifold solid with a positive volume?
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
integration, the first of them pays for it (a few milliseconds for most parts, 0.5 s for the
spring of `examples/spring.py` with its 512 knot spans).

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
takes 0.47 s at 1e-7 and at 1e-10, 0.19 s at 1e-4.

## How exact a body is

The numbers are as exact as the body. Where the kernel fits a surface or an intersection
curve (B-spline chamfers and variable fillets, the offset faces of a shell, the cut ends of a
sweep, two cylinders crossing), neighbouring faces meet only to within about 1e-6 to 2e-5 mm,
and the volume of the body is defined only to that: measured turned by 90 degrees, the flange
of `examples/flange.py` differs by 2.6e-7, two crossing cylinders of the same radius by 3e-7,
the shelled bottle by 3.6e-6. Bodies whose edges are lines and circles close up exactly and
agree with their formulas to 1e-10 and better. Compare against formulas with a relative
tolerance of 1e-6, or 1e-5 for sweeps, shells and offsets of curved faces.

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

Meshes made by `tessellate` also take `+`, `-` and `&`, but the kernel's mesh Booleans only
work where no face of the result gets a hole. The result is checked (closed, a volume the
operation can give) and a wrong one raises `ModelingError`. Do Booleans on the exact parts
and mesh the result:

```python
blob = (Box(10, 10, 10) - Sphere(6)).mesh()
print(blob.is_closed(), round(blob.volume, 1))
```
