# Features

Features refine a part: rounding and beveling edges, hollowing, splitting, mirroring, drafting.
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

### Variable radius

A `(start, end)` tuple changes the radius linearly along each edge:

```python
ramp = box.fillet(box.edges().parallel_to(Z).first, (2, 8))
```

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

## Chamfers

```python
beveled = box.chamfer(box.faces().top().edges(), 2)
```

`length` is the setback along both faces, also on edges where the faces are not
perpendicular.

## Shell

`shell` hollows a part to walls of a given thickness, leaving the chosen faces open:

Shell before rounding the rim: removing a face that is surrounded by fillets is a case
the kernel cannot do.

```python
cup = Cylinder(20, 30).shell(2, Cylinder(20, 30).faces().top())
case = Box(80, 50, 30).shell(2.5)                # closed, hollow inside
lining = Box(80, 50, 30).shell(2.5, outward=True)  # walls grow outside instead
```

## Offset

```python
bigger = Box(20, 20, 20).offset(2)       # every face moves out by 2
smaller = Box(20, 20, 20).offset(-2)
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
rest. On Linux and macOS the kernel first works in a forked copy of the process, so the rare
crash or endless loop in its patching code only drops that step.

## Repair and conversion

```python
healed = part.heal()          # mend gaps and tolerances, mostly for imported data
nurbs = part.to_nurbs()       # every face and edge as NURBS
```
