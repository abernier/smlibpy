# Selecting

Features need to know which faces and edges to act on. `part.faces()`, `part.edges()`,
`part.vertices()` and `part.wires()` return a `ShapeList`: a Python list with selection
methods. Every method returns a new `ShapeList`, so selections chain:

```python
from smlibpy import *

part = Box(40, 30, 20) - Cylinder(6, 30)

part.edges().parallel_to(Z)                   # the four vertical box edges
part.faces().planar().facing(Z)               # the flat faces pointing up
part.edges().circles().top()                  # the hole's top rim
part.faces().cylinders().one().radius         # 6.0
```

## By position

| Selector | Picks |
|---|---|
| `top()`, `bottom()` | highest / lowest (Z) |
| `right()`, `left()` | furthest along +X / -X |
| `back()`, `front()` | furthest along +Y / -Y |
| `max_by(key)`, `min_by(key)` | largest / smallest key |
| `nearest(point)` | the shape closest to a point |
| `at(point)` | shapes passing through a point |
| `within(bbox)` | shapes inside a box |

Position selectors compare shape centers and return every shape that ties, so
`box.faces().top()` is one face but `box.edges().top()` is the four top edges.

## By geometry

| Selector | Picks |
|---|---|
| `of_type("cylinder", ...)` | faces of these surface types / edges of these curve types |
| `lines()`, `circles()` | straight / circular edges |
| `planar()`, `cylinders()` | planar / cylindrical faces |
| `parallel_to(axis)` | straight edges along an axis, planar faces normal to it |
| `perpendicular_to(axis)` | straight edges across an axis, planar faces containing it |
| `facing(direction)` | faces whose outward normal points that way |
| `convex()`, `concave()`, `smooth()` | edges on outside / inside corners, tangent edges |
| `filter(predicate)` | anything you can test in Python |

Face types are `plane`, `cylinder`, `cone`, `sphere`, `torus`, `revolution`, `extrusion`,
`bspline` and `offset`; edge types are `line`, `circle`, `ellipse` and `bspline`.

## Ordering and grouping

```python
faces = part.faces()
faces.sort_by("area")            # also "length", "volume", "radius", an axis, or a function
faces.sort_by(Z, reverse=True)
faces.group_by(Z)                # list of ShapeLists, lowest first
faces.largest(), faces.smallest()
part.edges().sort_by_distance((0, 0, 0))
```

## Picking one

A selection is always a list. Where an operation needs a single shape, a one-element list
is accepted. To be explicit:

```python
top = part.faces().top().one()    # exactly one, or an error explaining how many there are
first = part.edges().first
last = part.edges().sort_by(X).last
```

## Combining selections

```python
a = part.edges().top()
b = part.edges().parallel_to(Z)
a | b      # union
a & b      # common to both
a - b      # in a but not in b
a + b      # concatenation
```

## Going down the topology

A selection expands to its parts: `part.faces().top().edges()` gives the edges of the top
face, `face.outer_wire()` its boundary, `face.inner_wires()` its holes and `edge.faces()` the
faces meeting at an edge. Single shapes offer the same: `face.edges()`, `edge.vertices()`,
`face.neighbors()`.

## Seams

Closed surfaces such as cylinders have a seam where the surface meets itself. Seams are
not real edges and are left out of `edges()`; `edges(seams=True)` includes them.

## Operators

`filter_by`, `sort_by` and `group_by` take an axis, a type name or a function, and the
operators `>`, `<`, `>>` and `<<` sort, reverse-sort and take the top and bottom groups:

```python
part.faces() >> Z     # same as part.faces().max_by(Z)
part.edges() < X      # same as part.edges().sort_by(X, reverse=True)
```
