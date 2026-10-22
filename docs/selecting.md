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

### Where two bodies meet

`joining(a, b)` selects the edges that lie on the surfaces of both bodies: where a Boolean joined
them, the edges one rounds or chamfers next. It goes by geometry, not by the marks, so it also
finds the circle where a boss *stands* on a plate: there the boss's bottom face lay on the plate's
top, and the circle is the boss's bottom edge, which `new(since=...)` does not count as new:

```python
plate = Box(60, 40, 8)
boss = Cylinder(8, 10).translate(0, 0, 9)         # standing on the top (z = 4)
joined = plate + boss
print(len(joined.edges().new(since=[plate, boss])))   # 0: the circle is the boss's own edge
rim = joined.edges().joining(plate, boss)         # the circle where they meet
rounded = joined.fillet(rim, 2)

block = Box(40, 40, 10)
hole = Cylinder(5, 40).rotate(X, 30)
rims = (block - hole).edges().joining(block, hole)   # the 4 pieces of the two rims
```

Either side can be a list of bodies (`joining(plate, holes)`). Edges where coplanar faces of the
two bodies merged into one face are not taken: they lie on one surface only.

## Shells, cavities and cells

`part.shells()` gives the closed sheets that bound a part, each a `Shell` of copies of its faces:
first the outside of each solid, then the wall of each cavity. `part.voids()` gives the cavities as
parts, and `info()` counts solids and voids. To select a cavity's faces on the part itself, take
those that descend from its shell:

```python
hollow = Box(20, 20, 20) - Box(6, 6, 6)
print(hollow.info()["solids"], hollow.info()["voids"])          # 1 1
outside, cavity = hollow.shells()
walls = hollow.faces().derived_from(cavity)                     # the 6 faces of the cavity
print(len(walls), round(hollow.voids()[0].volume, 6))           # 6 216.0
```

The faces of a merged part (see `merge`) bound one cell or two: `face.cells` gives the indices of
the cells (into `part.cells()`), and `shared()` selects the faces between two cells, where two
materials meet:

```python
block = merge(Box(40, 40, 20), Cylinder(6, 30))
interfaces = block.faces().shared()               # the insert's wall and two discs
print(len(interfaces), sorted(f.cells for f in interfaces))     # 3 [(0, 1), (1, 2), (1, 3)]
```

## Colors and names of faces

Faces given a color or a name (`colored(color, faces=...)`, `named(name, faces=...)`, or read from
a STEP file) keep it through later operations, so a selection can go by it:
`part.faces().filter_by(lambda f: f.name == "seal")`, `part.faces().filter_by(lambda f: f.color is
not None)`. See Files for how they are written.

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
