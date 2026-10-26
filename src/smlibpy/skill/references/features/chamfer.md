# chamfer

Bevels edges of a part with a flat face.

## Signature
`part.chamfer(edges, length, *, length2=None, angle=None, reference=None, propagate=True, corners="patch")`
`chamfer(edges, length, **same keywords)` (finds the part the edges belong to)

- `edges`: a selection, one `Edge`, or faces (all their edges).
- `length`: the setback, measured along **both** faces from the edge. Equal on both sides,
  also where the faces are not perpendicular (an acute 26.6° edge with length 2: both new
  corners 2.000 from the old edge), and edges of different angles go in one call (all 18
  edges of a hexagonal prism). The faces must meet at the same angle all along the edge
  (within 1°): where a hole or boss meets a tilted or curved face the setback would vary
  with the angle, and `chamfer` raises `ModelingError`; round such an edge with `fillet`.
- `length2`: an unequal bevel: `length` is the setback on the `reference` face of each edge,
  `length2` the one on its other face (OpenCASCADE's `Add(d1, d2, edge, face)`).
- `angle`: instead of `length2`, the angle in degrees between the bevel and the reference face:
  `length2 = length * tan(angle)` where the faces meet at 90°; on other edges the bevel keeps the
  angle (`length2 = length * sin(angle) / sin(wedge + angle)`, wedge = the angle between the
  faces). Give `length2` or `angle`, not both.
- `reference`: the face (a `Face`, a selection, several faces) that each beveled edge lies on;
  `length` is measured on it. `length2` and `angle` need it. An edge on none of them, or on two,
  raises `ValueError`; so does an edge a tangent run adds that is on none (add its face, or
  `propagate=False`).
- `propagate`: as for `fillet`: `True` (default) also bevels the edges that continue a selected
  edge tangentially (`edge.tangent_chain()`): one straight top edge of a slot bevels its whole
  outline. `False` bevels the selected edges only, and the bevel runs on past an end where the
  edge runs on tangentially.
- `corners`: `"patch"` (default) cuts a corner where three bevels meet with a small triangle;
  `"mitre"` runs the bevels on until they meet in a point (all edges of a 40x30x20 box, 2:
  23328.0 against 23322.667). As for `fillet`: corners of three convex edges and no other edge.

## Returns
A new `Part`. Removed volume per straight 90° edge: `length² / 2 * edge length`. Concave edges
add material. Circular edges (hole rims, cylinder ends) work: a hole rim chamfer is a
countersink-like bevel. The bevel of a full circle between faces around one axis (a plane at
right angles to it, a cylinder or a cone, or the straight faces of a revolve: shafts, holes,
turned parts) is an **exact cone** (a `"cone"` face; its edges are circles, on a plane end face
and on a cylinder): `Cylinder(2, 5)` with both rims 1 is
52.3598776, exactly `pi*20 - 2*2*pi*(2 - 1/3)*0.5`. smlibpy cuts it (fills it at a concave rim)
with the solid of revolution of the bevel's line; the kernel bevels the other edges, and a
circle where that solid would take other material (a flange just below the rim).

## Limits
Same rules as `fillet` with the setback = `length`: two chamfered edges `d` apart on one face
allow `length <= d/2` (at exactly `d/2` the kernel may fail: all edges of a 10 cube with 5
raise `KernelError`), one chamfered edge `length <= d` (exactly `d` removes the whole face: one
edge of a 10 cube with 10 leaves a prism of 500). `length <= 0` raises `ValueError`. The
result is checked like a fillet's: a valid solid whose volume changed by no more than the
bevels can remove or add (not bounded where an edge runs on into an edge that is not
chamfered: the kernel extends the bevel past the end). An invalid input part raises
`ModelingError`.

## Gotchas
- Seam and smooth edges in the selection are skipped, like for `fillet`.
- Give all edges that meet at a corner in one call; the corners are then cut cleanly
  (40x30x20 box, all edges, 2: vol 23322.667 = exact polyhedron). Unequal bevels too: the top
  edges of a 40x30x20 box with 2 on the top and 1 down the sides: 23865.333 (OpenCASCADE the
  same).
- Unequal setbacks on faces that meet at an acute angle, less alike than `cos(wedge)` (60°: one
  less than half the other): the kernel's solver offsets one face backwards and takes that only so
  far. A straight edge between planes whose ends lie on planes at right angles to it (a wedge or
  prism cut straight across) is then bevelled by cutting the bevel's prism along it (exact: a 60°
  edge with 4 and 1 takes 0.5 * 4 * 1 * sin 60° * length). Elsewhere (an end on a slanted face,
  another bevelled edge ending there) such setbacks raise `ModelingError`.
- Bevels the kernel makes (straight edges between curved faces, circles on spheres or tori, a
  circle whose bevel would take other material) are fitted B-splines, not exact:
  `Cylinder(10, 10) + Cylinder(12, 0.5).translate(0, 0, 4.05)` (a flange just below the top
  rim), the rim bevelled by 0.6, comes out 5e-7 of its volume short. Circles between coaxial
  faces are exact (above; a cylinder
  rim, 2 and 1: 6224.5422, as OpenCASCADE): their bevels are cones, and their edges circles, also
  where a bevel meets the cylinder.

## Errors
- `ModelingError: chamfer: the length is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)`
- `KernelError: chamfer failed (SM_ERR): the length may be too large for the selected edges`
- `ModelingError: chamfer: the faces of an edge meet at an angle that changes along it (their normals are 60 to 120 degrees apart), and the bevel would reach 1 to 3 from the edge instead of 1; round such an edge with fillet(), whose radius stays the same along it`
- `ValueError: chamfer: corners="mitre" mitres the corners where three rounded convex edges meet and no other edge, and the selection has none (round all three edges of a corner)`
- `ValueError: chamfer: the length must be positive`; `ValueError: chamfer: length2 must be positive`;
  `ValueError: chamfer: give length2 or angle, not both`
- `ValueError: chamfer: length2 and angle need reference=, the face (or faces) of each edge on which length is measured`
- `ValueError: chamfer: the edge from (10, -10, 10) to (10, 10, 10) does not lie on a reference face; give the face of each edge on which length is measured`
- `ValueError: chamfer: a bevel at 130 degrees to the reference face does not meet the other face of the edge from ... to ..., which meets it at 90 degrees; use an angle below 90`
- `ModelingError: chamfer: the faces of the edge from (0, 0, 0) to (0, 0, 7.35822) meet at 60 degrees, and the kernel could not bevel them with setbacks this different (4 and 1); bring them closer (each at least 0.5 times the other always works)`
  (an edge the prism cut cannot take: see Gotchas)
- `KernelError: chamfer failed (SM_ERR): the kernel could not build the corner at (...) (...); the length may be too large for the selected edges`: the corner or edge the kernel could not bevel (see `fillet`).
- `ModelingError: chamfer: the part is not a valid solid (...); check is_valid() after each step and fix the step that broke it`

## Example
```python
box = Box(40, 30, 20)
bevel = box.chamfer(box.edges().parallel_to(Z), 2)      # 2 along both faces
print(round(box.volume - bevel.volume, 3))              # 160.0 = 4 * 2*2/2 * 20

top = box.chamfer(box.faces().top(), 2)                 # all edges of the top face
also = chamfer(box.faces().top().edges(), 2)            # function form: finds the part

plate = Box(40, 40, 10) - Cylinder(5, 20)
rim = plate.edges().circles().filter(lambda e: e.center().z > 0)
plate = plate.chamfer(rim, 1.5)                         # countersink-like bevel on the hole: an exact cone
print(plate.is_valid(), round(plate.volume, 3))         # True 15175.725 = 15214.602 - 2*pi*5.5*1.125

tri = Polygon((0, 0), (40, 0), (0, 20)).extrude(10)
sharp = tri.edges().parallel_to(Z).nearest((40, 0, 0))  # acute 26.6-degree edge
tip = tri.chamfer(sharp, 2)                             # still 2 along each face

face = box.faces().top()                                # unequal: 2 on the top, 1 down the sides
lead = box.chamfer(face.edges(), 2, length2=1, reference=face)
print(round(lead.volume, 3))                            # 23865.333
weld = box.chamfer(face.edges(), 2, angle=30, reference=face)   # 30 degrees to the top
print(round(weld.volume, 3))                            # 23844.5
```

## Related
`fillet`, `CounterSinkHole`, `ShapeList.circles()`, `Edge.tangent_chain()` (`selection/tangent_chain`).
