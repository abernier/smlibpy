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

mp.inertia_about((20, 15, 10))             # the tensor about another point (parallel axes)
mp.moment_about(Axis((0, 0, 0), (0, 0, 1)))  # about an axis: a shaft's, a pivot's
mp.radii_of_gyration                       # sqrt(principal moment / mass), per principal axis
```

`accuracy` (1e-10 to 1e-2) sets the bound above for one call. It costs little: the spring
takes 55 ms at 1e-7 and at 1e-10, 23 ms at 1e-4. A coarse accuracy saves little on dense
free-form faces, though: every knot span gets at least 7 x 7 points, and the thickened surface
above takes 0.6 s at any accuracy.

## Section properties

The second moments of area of a profile, for beams, frames and extrusions, come from its
sketch. They are about the centroid, in the axes of the sketch plane (`sp.plane`, the plane
moved to the centroid):

```python
sp = (Rectangle(40, 20) - Circle(5)).section_properties()
sp.area                   # 721.46
sp.ixx, sp.iyy, sp.ixy    # 26175.79, 106175.79, 0: integral of y², x², x y over the area
sp.polar                  # ixx + iyy
sp.section_moduli         # (2617.58, 5308.79): ixx / c_y and iyy / c_x, c to the farthest fiber
sp.radii_of_gyration      # (6.023, 12.131)

angle = Rectangle(30, 5, align=Align.MIN) + Rectangle(5, 40, align=Align.MIN)
sa = angle.section_properties()
sa.centroid               # Vector(8.26923, 13.2692, 0)
sa.principal_moments      # (13276.7, 61442.9): ascending
sa.principal_axes         # their directions, in the plane
```

They are integrated as the mass properties of a thin slab of the region (to the same 1e-7),
less the slab's own thickness term.

## How exact a body is

The numbers are as exact as the body. Where the kernel fits a surface or an intersection
curve (B-spline chamfers and variable fillets, the offset faces of a shell, the cut ends of a
sweep, two cylinders crossing), neighbouring faces meet only to within about 1e-6 to 2e-5 mm,
and the volume of the body is defined only to that: measured turned by 90 degrees, the flange
of `examples/flange.py` differs by 2.6e-7, two crossing cylinders of the same radius by 3e-7,
the shelled bottle by 3.6e-6. Bodies whose edges are lines and circles close up exactly and
agree with their formulas to 1e-10 and better. Compare against formulas with a relative
tolerance of 1e-6, or 1e-5 for sweeps, shells and offsets of curved faces.

A face the integration cannot converge on stops it after a budget of surface points (far more
than a sound face of as many knot spans takes): one that crosses the seam of its own surface, a
broken body that no public operation makes, raises `KernelError` ("face 0 of the body crosses
the seam of its surface ...") in under a second, where it ran for minutes. Any other face that
runs out gives its result with the warning that the accuracy was not reached.

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

cp = a.closest_points(b)         # the nearest points themselves, and the faces they lie on
cp.point, cp.other_point         # Vector(5, 0, 0), Vector(17, 0, 0)
cp.distance, cp.face, cp.other_face

a.distance_to(Line((20, -50, 3), (20, 50, 3)))   # 15.0: to an edge (a wire, a face) as well
```

The distance between bodies is exact, also between faces that are nearly parallel: the closest
points are refined on the faces' own parameters until they settle, and `distance_to` warns if
they do not. Edges and wires go the same way: from the curve's nearest samples, Newton's method
on the curve's parameter and the face's. A face counts as the sheet it is; an edge, a wire or a
face also measures to a body (`edge.distance_to(part)`).

Faces, edges and wires have their closest points, and the parameters there:

```python
top = part.faces().top().one()
top.closest_point((0, 0, 30))    # Vector(6, 0, 10): on the face, not in its hole
u, v = top.uv_at((5, 5, 30))     # its parameters as fractions of the face's parameter box
top.position_at(u, v)            # the point there; position_at(0.5, 0.5) is the box's middle
edge = part.edges().circles().first
edge.closest_point((10, 0, 0))   # Vector(6, 0, -10)
edge.param_at_point((0, 10, 10)) # 0.25: the fraction of the length, as point_at takes it
```

## Curvature

```python
bore = part.faces().cylinders().one()
c = bore.curvature_at()          # at a point inside the face, or the one nearest to a point given
c.k1, c.k2                       # 0, -1/6: principal curvatures, negative where the face is hollow
c.dir1, c.dir2, c.normal         # their directions and the outward normal
c.mean, c.gaussian
Torus(20, 5).faces()[0].min_radius()   # 5: the smallest radius of curvature on the face
edge.curvature_at(0.5)           # 1/6: 1 / radius of a curve
```

Curvatures come from the exact surface, signed by the face's outward normal: a ball is positive,
a bore negative, a plane 0. `min_radius()` is exact for planes (`inf`), cylinders and spheres;
other faces are sampled on a 24 x 24 grid of their parameters and refined from the sharpest
points; points within 1e-2 of a pole (by the ratio of the tangents) are left out, where the
derivatives do not give the curvature to all its digits. Compare it with a wall thickness
(`thicken` inward) or a cutter's radius.

A face's surface itself: its NURBS data (the whole surface, untrimmed; exact for every kind,
rational for circles), and its curves of constant parameter, clipped to the face:

```python
n = Cylinder(5, 20).faces().cylinders()[0].nurbs()
n.degrees, len(n.knots[0]), len(n.points), len(n.points[0])   # (2, 1), 12, 9 x 2 control points
top.isocurve(u=0.5)              # two lines: the hole is in the way
bore.isocurve(v=0.5)[0].length   # 37.699: the circle around the bore
torus_face = Torus(20, 5).faces()[0]
torus_face.major_radius, torus_face.radius   # 20, 5
Cone(10, 4, 20).faces().filter_by(lambda f: f.geom_type == "cone")[0].cone_angle  # 16.7: half the opening
```

## Continuity

How two faces meet along an edge: `"G0"` at a crease, `"G1"` where they meet tangentially (a
circular fillet's border), `"G2"` where their curvature across the edge agrees too (a fillet
with `continuity="G2"`), `None` where they leave a gap. The edge is checked at 16 points (or
`samples=`) for the largest gap, angle between the normals and jump of the curvature across it:

```python
box = Box(30, 30, 30)
edge = box.edges().filter_by(Z).sort_by(X).last
round_part = box.fillet(edge, 5)
blend = box.fillet(edge, 5, continuity="G2")
c = round_part.edges().g1().first.continuity()
c.level, c.angle, c.curvature_jump     # 'G1', 0.0, 0.2: tangent, but 1/5 against 0
len(blend.edges().g2())                # 2: both borders of the G2 blend
Polyline((0, 0), (10, 0), (10, 10)).continuity().level   # 'G0': the joints of a wire
```

`g1()` selects the edges that are at least tangent, `g2()` the curvature-continuous ones. The
defaults: G1 within 0.5 degrees (the kernel's own tolerance, also `smooth()`'s), G2 within 1% of
the larger curvature (or `1e-3 / length`, where both are nearly flat); `angle_tol=` and
`curvature_tol=` take others. `smooth()` and `convexity` look along the whole edge as well: an
edge whose faces meet tangentially only at its middle is not smooth.

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
Sphere(10).silhouette((0, 0, 1))            # outline seen along a direction
box.project(CenterArc((0, 0, 30), 5, 0, 360), (0, 0, -1))   # curve onto the faces below
box.outline(Plane.XZ)                       # edges projected to a plane
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
