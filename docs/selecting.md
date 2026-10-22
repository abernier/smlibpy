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
| `hit_by(origin, direction)` | the faces (or bodies) a ray meets, nearest first |

Position selectors compare shape centers and return every shape that ties, so
`box.faces().top()` is one face but `box.edges().top()` is the four top edges.

`hit_by` selects with a ray: the faces it meets, each once, in the order it meets them. Only the
faces in the list count, so it chains with the other selectors, and `.first` is what the ray
sees first:

```python
part = Box(40, 30, 20) - Cylinder(5, 30)
part.faces().hit_by((-50, 0, 0), (1, 0, 0))              # the -X face, the hole's wall, the +X face
seen = part.faces().hit_by(Axis((10, 8, 50), (0, 0, -1))).first   # looking down: the top face
part = part.fillet(seen.edges(), 2)
```

## By geometry

| Selector | Picks |
|---|---|
| `of_type("cylinder", ...)` | faces of these surface types / edges of these curve types |
| `lines()`, `circles()` | straight / circular edges |
| `planar()`, `cylinders()` | planar / cylindrical faces |
| `parallel_to(axis)` | straight edges along an axis, planar faces normal to it |
| `perpendicular_to(axis)` | straight edges across an axis, planar faces containing it |
| `facing(direction)` | faces whose outward normal points that way (on a curved face: everywhere) |
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

## Where faces and edges came from

Every face and edge remembers what it came from: smlibpy marks the faces and edges of every body
it makes, and the kernel carries the marks through its operations. A copy keeps them, both halves
of a face a cut split keep their parent's, a face merged from two keeps both; the faces and edges
an operation makes anew (the circle where a boss meets a plate, the rounds of a fillet, the rims
of a shell) are new. `new(since=...)` selects those, `derived_from(...)` the descendants of given
bodies, faces or edges:

```python
plate = Box(60, 40, 8)
boss = Cylinder(8, 20).translate(0, 0, 10)
joined = plate + boss
rim = joined.edges().new(since=[plate, boss])     # the circle where the boss stands on the plate
rounded = joined.fillet(rim, 2)
rounds = rounded.faces().new(since=joined)        # the round

holes = GridLocations(40, 20, 2, 2) * Cylinder(3, 20)
drilled = plate - holes
walls = drilled.faces().derived_from(holes)       # the four hole walls
```

A moved, turned, mirrored or scaled copy is a shape of its own, with new marks (the copies of a
pattern can be told apart); a body read from a file is new everywhere.

A selection taken before an edit can still be used: a face or edge of an earlier version of the
part stands for its descendants, so edges a later cut split are rounded in all their pieces:

```python
top = plate.edges().top()                         # before the slot
slotted = plate - Box(6, 50, 4).translate(0, 0, 3)
print(len(slotted.edges().derived_from(top)))     # 6: the long edges in two pieces each
done = slotted.fillet(top, 1)
```

Where a face or edge has no descendant (it belongs to another body), it is matched by geometry
as before, and `ValueError: ... is not an edge of this part` says that nothing matched.

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
