# Features

Features refine a part: rounding and beveling edges, hollowing, splitting, mirroring, drafting,
moving and offsetting faces.
Each one is a method of `Part` that returns a new part.

## Fillets

```python
from smlibpy import *

box = Box(40, 30, 20)
rounded = box.fillet(box.edges().parallel_to(Z), 5)
```

Select the edges, give a radius. Edges can come from the part, from a face
(`box.faces().top()` rounds all its edges) or from an earlier version of the same part:
smlibpy matches them by position.

The free function `fillet(edges, radius)` finds the part the edges belong to, which reads
well when the selection says it all:

```python
rounded = fillet(box.edges().parallel_to(Z), 5)
```

### Tangent runs

An edge that runs on tangentially into the next one, as the edges around a rounded corner do,
is rounded with the whole run: one top edge of a plate with rounded corners rounds its whole
top outline, as in most CAD systems (and as OpenCASCADE does).

```python
plate = Rectangle(40, 30, fillet=5).extrude(10)
edge = plate.edges().filter(lambda e: abs(e.center().z - 10) < 1e-6).sort_by("length")[-1]
outline = plate.fillet(edge, 1)            # all 8 top edges: edge.tangent_chain()
```

`edge.tangent_chain()` (and `part.edges()....tangent_chain()` for a selection) shows the run:
edges that leave a vertex in the direction the previous one arrives in (within 10 degrees),
between faces that meet smoothly there. The added edges take the radius of the selected edge they
continue. `propagate=False` rounds the selected edges only; the kernel then runs a round on past
an end where the edge continues tangentially, and it often cannot round an edge that continues
tangentially at both ends (the `KernelError` says which edge and where). `chamfer` takes the same
`propagate`.

### Variable radius

A `(start, end)` tuple changes the radius linearly along each run of selected edges that meet
tangentially: a single edge, or a chain such as the top run of a plate with rounded corners, which
`propagate` adds. It runs in proportion to the length along the run, the way of the run's first
selected edge (from its start to its end), from the end of the run that way begins:

```python
ramp = box.fillet(box.edges().parallel_to(Z).first, (2, 8))
```

A dict `{position: radius}` sets the radius at positions along each run (0 its start, 1 its end;
a missing 0 or 1 takes the radius given nearest it) and joins them smoothly without overshooting
them (flat at the ends and at each largest and smallest radius):

```python
rim = Cylinder(10, 20).edges().top()
swell = Cylinder(10, 20).fillet(rim, {0: 1, 0.5: 3})     # around the rim: 1, 3 halfway, 1
```

A varying radius makes circular rounds only (with `continuity` it raises `ValueError`). A
`(start, end)` radius cannot run around a closed edge or a closed run (it would jump back to the
start radius); a dict can run around a single closed edge, with one radius at 0 and 1, but not
vary around a closed run of several edges (the kernel builds broken rounds there). Selected edges
of different runs that still meet tangentially are refused (the kernel would bend both laws to one
radius where they meet). Those raise `ValueError`; give a constant radius there.

`fillet_preview(edges, radius)` gives the surfaces of a circular fillet's rounds as sheets, one per
edge, untrimmed, without changing the part: for a look at a fillet before making it.

### Different radii

A list gives each edge its own radius:

```python
edges = box.edges().parallel_to(Z)
stepped = box.fillet(edges, [2, 4, 6, 8])
```

### Smooth blends (G2 and G3)

A circular fillet meets its faces with matching tangents but a jump in curvature; on a
glossy surface that shows as a highlight line. SMLib can blend with matching curvature
(G2) or even matching rate of curvature change (G3), as used for consumer products and car
bodies:

```python
soft = box.fillet(box.edges(), 4, continuity="G2")
softer = box.fillet(box.edges(), 4, continuity="G3", fullness=1.2)
```

`fullness` shapes the blend's cross-section: above 1 is fuller, below 1 flatter.

The rounds along the edges have the continuity asked for. Where three blended edges meet at a
corner, the kernel joins them with a corner patch that is tangent continuous (G1) only, whatever
the continuity: zebra stripes kink there (`render(part, zebra=True)`, see [Files](files.md)). For
Class-A surfaces, keep three-edge corners out of the visible areas.

### Corners

Where three rounded edges meet, `corners="patch"` (the default) joins their rounds with a corner
patch: a ball corner where the radii are equal. `corners="mitre"` runs the rounds on until they
meet each other along mitre lines, without a patch, the look of a machined part:

```python
balls = box.fillet(box.edges(), 3)                    # 23340.8494, 26 faces
mitred = box.fillet(box.edges(), 3, corners="mitre")  # 23354.2820, 18 faces
```

Mitred are the corners where three rounded convex edges meet and no other edge (the kernel has no
mitre for more edges, or for a concave one); a selection without such a corner raises
`ValueError`. `chamfer` takes `corners` too: its bevels then meet in a point instead of a small
triangle (`box.chamfer(box.edges(), 2, corners="mitre")`: 23328.0, 23322.6667 with the triangles).
`"miter"`, the American spelling, is taken as well.

`setback=` sets the corners back: the rounds stop that far from the corner along each of its edges,
and one larger patch joins them there, a softer corner than the ball, as on molded and consumer
parts:

```python
cube = Box(20, 20, 20)
balls = cube.fillet(cube.edges(), 2)               # 7804.6961, 26 faces
soft = cube.fillet(cube.edges(), 2, setback=3)     # 7781.6093, 66 faces: rounds 14 long, 6 patch faces a corner
```

Set back are the corners where three or more rounded edges meet and no other edge (every edge at
the vertex rounded), all convex (the outside corners of a box) or all concave (the floor corners of
a pocket); the other corners keep their usual patch, and a selection without such a corner raises
`ValueError`. The setback must exceed how far the rounds reach along the corner's edges (the radius
at a right-angled corner) and stay below the length of each rounded edge at such a corner (half of
it where both ends are set back). It takes constant radii (also one per edge, and blends), not radius
laws or `corners="mitre"`. Corners between slanted faces (the top corners of a frustum) the kernel
often cannot set back; that raises `KernelError`.

The keyword `corners` names a different choice in each operation that has it:

| Operation | `corners=` | What it chooses |
|---|---|---|
| `fillet`, `chamfer` | `"patch"` (default), `"mitre"` (or `"miter"`) | where three rounded edges meet |
| `offset` | `"sharp"` (default), `"round"` | the convex edges of the offset: faces extended, or rolled round |
| `shell` | `None` (default: either), `"round"`, `"sharp"` | the edges of the cavity, as for `offset` |
| `Sketch.extrude(taper=...)`, `extrude` | `"sharp"` (default), `"round"` | the corners of a tapered profile |
| `Wire.offset`, `Sketch.offset` | `"round"` (default), `"sharp"`, `"chamfer"` | the corners that open up |

### What can't be rounded

Seam edges (where a cylinder closes on itself) and edges between faces that already meet
smoothly are skipped automatically. A radius that cannot fit raises a `ModelingError` that
says how much room there is:

```python
cube = Box(10, 10, 10)
try:
    cube.fillet(cube.edges(), 6)
except ModelingError as e:
    print(e)   # ... the rounds on edges 10 apart would overlap (largest possible setback here: 5)
```

Fillet order matters where rounds meet. Where three rounded edges meet at a corner, round
the larger radii first.

When the kernel fails, the `KernelError` names what it could not build, as the kernel's fillet
code recorded it: the corner (a vertex) or the edge, and why where it says so:

```python
part = Box(30, 30, 10) + Cylinder(5, 20).translate(10, 10, 0)   # the boss touches a side
try:
    part.fillet(part.edges(), 2)
except KernelError as e:
    print(e)   # fillet failed (SM_ERR_INVALID_INPUT): the kernel cannot round the selection as
               # given, at any size: it could not build the corner at (15, 10, 5) (it has no
               # corner for the way the rounded edges meet there); select fewer edges there
```

A message without such a place ("the radius may be too large for the selected edges") means the
kernel recorded none.

## Chamfers

```python
beveled = box.chamfer(box.faces().top().edges(), 2)
```

`length` is the setback along both faces, also on edges where the faces are not
perpendicular, and edges of different angles can be beveled in one call (all edges of a
hexagonal prism). The faces must meet at the same angle all along each edge: where a hole or
boss meets a tilted or curved face the angle changes, the setback would change with it, and
`chamfer` raises a `ModelingError`. Round such an edge with `fillet`.

An asymmetric bevel measures `length` on a `reference` face of each edge and `length2` on its other
face, or tilts the bevel by `angle` degrees against the reference face (a weld preparation, a
lead-in):

```python
top = box.faces().top()
lead_in = box.chamfer(top.edges(), 2, length2=1, reference=top)   # 2 on the top, 1 down the sides: 23865.3333
bevel = box.chamfer(top.edges(), 2, angle=30, reference=top)      # 2 on the top, 30 degrees to it: 23844.5003
```

Where the faces meet at 90 degrees, `angle` gives `length2 = length * tan(angle)`; on other edges
the bevel keeps the angle and `length2` follows. Every beveled edge must lie on a reference face
(give several faces for edges around several). Corners where asymmetric bevels meet come out as
with equal ones: a box's top bevels meet in a mitred corner, exact (OpenCASCADE gives the same
volumes).

The bevel of a full circle between faces around the same axis (the rim of a shaft or of a hole: a
plane at right angles to the axis, a cylinder or a cone, or the faces of a revolve) is an exact
cone, cut (or, at a concave rim, filled in) with the solid of revolution of the bevel's line:

```python
plate = Box(40, 30, 10) - Cylinder(5, 20)
countersunk = plate.chamfer(plate.edges().circles(), 1)   # 11181.0915, exactly the plate less 2 rings
```

The kernel fits other bevels with B-spline faces, which meet their neighbours to about 1e-5 mm.

## Shell

`shell` hollows a part to walls of a given thickness, leaving the chosen faces open:

```python
cup = Cylinder(20, 30).shell(2, Cylinder(20, 30).faces().top())
case = Box(80, 50, 30).shell(2.5)                # closed, hollow inside
lining = Box(80, 50, 30).shell(2.5, outward=True)  # walls grow outside instead
```

An opening whose rim meets its neighbours tangentially, such as the flat top of a box rounded on
all edges, is one the kernel leaves with its rim open. `shell` cuts such openings out of the part
shelled closed instead, when they are planar and the rest of their rim meets walls that stand at
right angles to them:

```python
body = Box(60, 40, 20)
body = body.fillet(body.edges(), 5)
tray = body.shell(2, body.faces().planar().top())   # 11134.3949: the closed shell less the lid
```

The inner rounds then end tangentially at the opening's rim, so the wall runs out to an edge
there. Other openings with such a rim (a curved face, a drafted wall next to it) still raise
`ModelingError`; shell such a part before rounding the rim.

Where the part's faces grow apart as the walls are built (the inside of a concave edge for walls
that grow inward, the outside of the convex edges for walls that grow outward), the kernel can
round the new side of the wall, keeping its thickness all round, or extend the faces until they
meet, so that the wall is thicker in the corner. `corners` picks one; by default `shell` takes
the round one where the kernel builds it and the sharp one where it does not, and `info()` of the
result says which it got:

```python
L = Box(20, 20, 10) - Box(10, 10, 10).translate(5, 5, 0)    # an L-shaped block: one concave edge
cup = L.shell(2, L.faces().top())                      # 1745.1327: a round of radius 2 in the inner corner
print(cup.info()["corners"])                           # round
sharp = L.shell(2, L.faces().top(), corners="sharp")   # 1752.0: the inner faces meet in a corner
box = Box(80, 50, 30)
lining = box.shell(2.5, box.faces().top(), outward=True, corners="sharp")   # 85 x 55 x 32.5, sharp outside
```

With `corners="round"` or `"sharp"` a shell the kernel cannot build that way raises instead of
coming back with the other kind.

`walls` gives faces walls of their own thickness: the face of the shell across such a wall is
moved by the difference, and the faces around it are extended or trimmed to meet it (as
[`offset_faces`](#moving-and-offsetting-faces) does):

```python
box = Box(40, 30, 10)
tray = box.shell(2, box.faces().top(), walls=[(box.faces().bottom(), 5)])   # 7320.0: a 5 mm floor
```

Faces that meet smoothly, such as a wall and the round next to it, need one thickness.

With openings, walls that do not fit into the part (measured across it from each face) raise a
`ModelingError` before the kernel runs; results whose faces do not meet, or that have no cavity
where no wall reaches, raise one too. `shell`, `offset` and `thicken` run the kernel in another
process (a forked copy on Linux and macOS, a helper process on Windows), so a crash of its offset
code raises a `ModelingError` too, and this process goes on. A step that takes longer than
`smlibpy.defeature.GUARD_SECONDS` (20 s) is stopped; raise it for large parts (see
[Steps in another process](kernel.md#steps-in-another-process)).

## Offset

```python
bigger = Box(20, 20, 20).offset(2)       # every face moves out by 2: a 24 mm cube
smaller = Box(20, 20, 20).offset(-2)
```

The faces are extended until they meet again, so edges and corners stay sharp. An edge whose
faces meet at an angle `a` moves out by `distance / sin(a / 2)`: the base edge of a cone, the
edges of a tapered extrusion reach farther than `distance`. Where faces would vanish or cross
(an acute wedge, a hole that closes, a groove narrower than twice the distance) the kernel
cannot extend them; `corners="round"` rolls a ball along the part instead, filling in cylinders
and spheres where faces grow apart. Every point of the result is at `distance` from the part (a
clearance body, the skin of an overmould):

```python
envelope = Box(20, 20, 20).offset(2, corners="round")   # 13587.4926: 26 faces, planes, cylinders, spheres
holed = Box(40, 40, 10) - Cylinder(5, 20)
closed = holed.offset(5, corners="round")               # 47520.5034; the sharp offset raises KernelError
```

Shrinking with `corners="round"` rounds the concave edges (they grow apart inward); the convex
ones stay sharp.

Sheets and faces move along their normals and stay sheets (see [Surfaces](surfaces.md)):

```python
skin = extrude(CenterArc((0, 0), 10, 0, 180), 20)   # a half-cylinder sheet, normals outward
outer = skin.offset(2)                               # radius 12
lid = Box(20, 20, 20).faces().top().one().offset(5)  # a copy of the top face, 5 above it
```

## Split and section

```python
part = Box(40, 30, 20) - Cylinder(8, 30)
upper = part.split(Plane.XY)                       # keeps the side the normal points to
lower = part.split(Plane.XY, keep="below")
left, right = part.split(Plane.YZ, keep="both")

cut = part.section(Plane.XY)                       # the cross-section, as a sketch
print(cut.area)                                    # 40 * 30 - pi * 8^2
```

A sheet splits a part along its surface (a curved parting surface, a surface fitted to a scan);
"above" is the side its normals point to. The sheet must cut through the part; a sheet of one
face whose edges end inside is extended past them until it does (a free-form face tangentially, a
plane, cylinder, cone or sphere as itself). Both
sides are checked to hold the part's volume together:

```python
import math
import numpy as np

wave = surface([[(x, y, 2 + 3 * math.sin(x / 6)) for y in np.linspace(-15, 15, 7)]
                for x in np.linspace(-15, 15, 13)])
upper, lower = Box(20, 20, 20).split(wave, keep="both")
print(round(upper.volume, 3), round(lower.volume, 3))   # 3200.0 4800.0
```

`part + sheet` and `part - sheet` raise `TypeError`: a sheet encloses no volume. `sheet & part`
and `sheet - part` trim the sheet (see [Surfaces](surfaces.md)).

A plane that only touches the part has no section: one that misses it raises `ValueError: the plane
does not cut the part`, and one tangent to it (along the side of a cylinder, through an edge,
around the top of a torus) `ValueError: the plane only touches the part`. A plane tangent to a face
somewhere inside the part (along the wall of a hole) can make the kernel fail: `KernelError`, move
the plane a little.

```python
try:
    Cylinder(5, 20).section(Plane.XZ.offset(5))    # tangent to the side of the cylinder
except ValueError as e:
    print(e)                                       # the plane only touches the part (...)
```

## Imprint

`imprint` splits faces where a tool crosses them and adds or removes nothing: split lines for
drafts and parting lines, patches for the loads and supports of a simulation. The tool is a part,
a sheet, or a sketch lying on a face. The pieces inside a tool part or sketch region descend from
the tool, so `derived_from` selects them:

```python
block = Box(40, 30, 10)
pad = Rectangle(12, 8).on(Plane.XY.offset(5))      # on the top face
marked = block.imprint(pad)
print(len(marked.faces()), marked.volume)          # 7 12000.0: the volume stays
patch = marked.faces().derived_from(pad).one()     # the 12 x 8 patch
```

A fillet across a split line removes it again; imprint after rounding.

The tool can also be curves (edges or wires), which split the faces along them: a region of a
face of its own, to color, draft or select. With a direction the curves are moved along it onto
the part first, and split the faces they meet first (the side facing them); `nearest=False`
splits every face they cross. Without one they must lie on the faces already
(`intersection_curves`, `project`):

```python
plate = Box(60, 40, 10)
label = plate.imprint(Rectangle(30, 10).edges().translate(0, 0, 20), (0, 0, -1))
print(len(plate.faces()), len(label.faces()), label.volume == plate.volume)   # 6 7 True
area = label.faces().filter(lambda f: f.center().z > 4.9).sort_by(lambda f: f.area).first
print(round(area.area, 6))                         # 300.0

through = plate.imprint(Circle(5).edges().translate(0, 0, 20), (0, 0, -1), nearest=False)
print(len(through.faces()))                        # 8: the top and the bottom face split
```

## Cells

`merge` makes one part of several, as for models of several materials whose meshes must match
where they meet: where the parts overlap, the overlap becomes a cell of its own, and cells that
touch share the face between them. `cells()` gives every cell as a solid:

```python
a = Box(20, 20, 20)
b = Box(20, 20, 20).translate(10, 0, 0)
both = a.merge(b)
print(both.volume, len(both.cells()))              # 12000.0 3: a alone, b alone, the overlap

block_with_insert = merge(Box(40, 40, 20), Cylinder(6, 30))
print([round(c.volume, 1) for c in block_with_insert.cells()])   # [29738.1, 2261.9, 565.5, 565.5]
```

Each cell is named and colored after the parts it lies in, its `sources`: a cell where a steel
part and a brass part overlap is "steel&brass", in the color of the last of them that has one. The
kernel keeps no record of where a cell came from; smlibpy classifies a point inside each cell
against the parts given to `merge` (as given: not moved along with the merged part):

```python
steel = Box(40, 40, 20).named("steel").colored("gray")
brass = Cylinder(6, 30).named("brass").colored("gold")
for cell in merge(steel, brass).cells():
    print(cell.name, cell.color, round(cell.volume, 1))
# steel gray 29738.1 / steel&brass gold 2261.9 / brass gold 565.5 / brass gold 565.5
```

The faces between two cells are the merged part's `faces().shared()`; `face.cells` says which
cells a face bounds (see Selecting).

A merged part is no manifold solid (`is_valid()` is False): model the parts first and merge
last, or work on the cells. Its `section()` has a region per cell. STEP writes each cell as a
solid of its own, with the cell's name and color; USD keeps the merged body with its shared
faces. `solids()` keeps cells that touch together (one solid), and separates a body that floats in
a cavity of another (a captive part) from it.

## Mirror

```python
half = Box(20, 10, 10).translate(10, 0, 0)
half = half.fillet(half.edges().right(), 2)
whole = half + half.mirror(Plane.YZ)
```

## Draft

A part that is molded or cast needs draft: walls that lean a little, so that it comes out of
its mold. `draft` tilts faces of a part by an angle about the line where each one meets a
neutral plane, where they keep their size:

```python
box = Box(40, 30, 20)
walls = box.faces().filter(lambda f: abs(f.normal_at().z) < 0.5)
core = box.draft(walls, 3, Plane.XY.offset(-10))   # the bottom keeps 40 x 30, the top narrows
print(round(core.faces().top().one().bbox().size.x, 3))   # 37.904 = 40 - 2 * 20 * tan(3)
```

The normal of the neutral plane is the pull direction, the way the mold moves off the part. A
positive angle turns each face to look more along it: the part narrows, and pockets and holes
widen, along the normal, on both sides of the plane. `draft_analysis` of that direction then
finds the angle on each drafted face. A face as the neutral plane pulls along its outward
normal: with the top face the top keeps its size and the bottom grows, and a pocket drafted
about the face around it opens upwards.

```python
cavity = box.draft(walls, 3, box.faces().top())    # the top keeps 40 x 30, the bottom grows
block = Box(60, 40, 20) - Box(30, 20, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
pocket = block.faces().filter(lambda f: abs(f.normal_at().z) < 0.5 and abs(f.center().x) < 29 and abs(f.center().y) < 19)
opened = block.draft(pocket, 3, block.faces().top())   # the pocket narrows towards its floor
```

Planes can be drafted, and cylinders and cones whose axis runs along the normal: a cylinder
becomes a cone. A face that meets a drafted face tangentially must be drafted with it: the
rounds between walls go with the walls and become cones. Rounds along a top or a floor cannot
be drafted, so draft first and round afterwards:

```python
rounded = box.fillet(box.edges().parallel_to(Z), 5)
sides = rounded.faces().filter(lambda f: abs(f.normal_at(f.interior_point()).z) < 0.5)   # walls and rounds
core = rounded.draft(sides, 3, Plane.XY.offset(-10))
core = core.fillet(core.edges().top(), 2)
```

The kernel rebuilds the part around the drafted faces, and smlibpy checks the result: where
the kernel cannot close the part again (an angle at which faces run into each other, a sphere
next to a drafted face) `draft` raises a `ModelingError` and leaves the part as it was.

Profiles can be drafted as they are extruded, all side walls at once:

```python
mold_core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
```

A part molded in two halves is drafted away from the parting line on both sides. With a planar
parting line, split the part there, draft each half about the plane (the lower half pulls the
other way: `Plane.XY.flipped()`), and fuse the halves again; the result is exact:

```python
box = Box(40, 30, 20)
upper, lower = box.split(Plane.XY, "both")
side = lambda p: p.faces().filter(lambda f: abs(f.normal_at().z) < 0.5)
molded = upper.draft(side(upper), 3, Plane.XY) + lower.draft(side(lower), 3, Plane.XY.flipped())
print(round(molded.volume, 4))     # 23273.6153: 40 x 30 at the parting line, 38.952 x 28.952 at top and bottom
```

`draft_analysis(Z)` of it finds 3 degrees on the upper walls and -3 on the lower ones, which
release towards the lower mold half. A stepped parting line needs a neutral plane per step;
`draft` takes one plane per call.

## Moving and offsetting faces

`move_faces` and `offset_faces` edit a part directly, without rebuilding it: the faces move, and
the faces around them are extended or trimmed until they meet them again. This is how to change
an imported part, which has no history:

```python
block = Box(40, 30, 10) - Cylinder(3, 20)
taller = block.move_faces(block.faces().top(), (0, 0, 5))           # 17575.885: 15 high, the hole too
moved = block.move_faces(block.faces().cylinders(), (8, 0, 0))      # the hole 8 to the right
wider = block.offset_faces(block.faces().cylinders(), -2)           # 11214.6018: the hole r3 -> r5
pushed = block.offset_faces(block.faces().top(), 2)                 # the top out by 2
```

`move_faces` takes a vector or a `Location`, which also turns the faces: to lean a wall in by 10
degrees about its bottom edge,
`wall.move_faces(right, Location.about(Axis((10, 0, -5), (0, -1, 0)), 10))`. `offset_faces` moves
each face along its own normal: out of the part for a positive distance, so the part grows, a hole
narrows and a boss widens. Faces that meet an offset face tangentially go with it, along the whole
tangent chain: offsetting one face of a slot widens the slot:

```python
plate = Box(40, 20, 10) - Slot(16, 6).extrude(20).translate(0, 0, -10)
wider_slot = plate.offset_faces(plate.faces().cylinders()[0], -1)   # 18 x 8; its walls and ends moved
```

`move_faces` asks for those faces instead (`ModelingError: move_faces: the plane face at (0, -3,
0) meets the moved cylinder face at (-6.91, 0, 0) tangentially, so it must be moved with it ...;
add it to the faces`). The results are exact: planes, cylinders, cones, spheres and tori keep
their kind and size, and the edges where a plane meets a cylinder, cone or sphere stay circles.
The kernel cannot change which faces meet: a face pushed past another one, or a face that would
vanish, raises `ModelingError` (use a Boolean there). The kernel drops cavities: a part with
cavities is edited (and drafted) as its outside and the solids inside its cavities' walls, each
with the faces of it that are selected, and the cavities are cut out again; an edit that makes a
cavity reach the outside or another cavity raises `ModelingError`, and so does a part with a body
inside a cavity. Faces around the edited ones that the kernel extends keep their cylinder or cone.

## Removing fillets and faces

Imported parts and parts made for one purpose often carry details another purpose does not
need: rounds and fillets, small holes, bosses. smlibpy takes them out again with the kernel's
defeaturing tools, which extend the faces around a detail until the gap closes.

`faces().fillets()` finds the fillets by their shape, whether they were made here or came in
through STEP: faces that meet two other faces tangentially and are curved across, plus the
corner patches where fillets meet. `max_radius` keeps only the small ones.

```python
box = Box(40, 30, 20)
rounded = box.fillet(box.edges(), 3)
print(len(rounded.faces().fillets()))            # 12 rounds and 8 corner patches: 20

sharp = rounded.remove_fillets()                 # the box again, every edge sharp
print(len(sharp.faces()), round(sharp.volume, 6))   # 6 24000.0
```

`remove_fillets()` takes out every fillet, `remove_fillets(faces)` the ones you select, and
`remove_fillets(max_radius=2)` the small ones. Rounds of outside edges give material back,
fillets of inside edges take it away; each step is checked against that, and the result must
be a valid solid.

`remove_faces` does the same for holes, pockets and bosses. Select the faces of the feature; a
hole's floor or a boss's top goes with its walls on its own:

```python
drilled = Box(40, 30, 20) - Cylinder(5, 40) - Cylinder(3, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(12, 0, 0)
plain = drilled.remove_faces(drilled.faces().cylinders())
print(len(plain.faces()), round(plain.volume, 6))   # 6 24000.0
```

On parts made here the result is exact: the faces are extended, planes stay planes and
cylinders cylinders. On imported parts the kernel cannot take out every detail; both methods
then raise a `ModelingError` that says which, and `partial=True` keeps those and takes out the
rest. The kernel's steps run in another process (a forked copy on Linux and macOS, a helper
process on Windows), so the rare crash or endless loop in its patching code only drops that step,
and Ctrl-C stops it.

## Repair and conversion

```python
healed = part.heal()          # mend gaps and tolerances, mostly for imported data
nurbs = part.to_nurbs()       # every face and edge as NURBS
```

A sheet whose faces close around a volume once healed comes back as a `Part`. What is still
wrong with a body, and where, is `check()` (see [Analysis](analysis.md)).
