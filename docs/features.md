# Features

Features refine a part: rounding and beveling edges, hollowing, splitting, mirroring.
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

Drafted walls come from tapered extrusions:

```python
mold_core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
```

## Repair and conversion

```python
healed = part.heal()          # mend gaps and tolerances, mostly for imported data
nurbs = part.to_nurbs()       # every face and edge as NURBS
```
