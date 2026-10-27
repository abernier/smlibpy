# Selection: ShapeList

`part.faces()`, `part.edges()`, `part.vertices()`, `part.wires()` and `part.solids()` return a
`ShapeList`: a Python `list` with selector methods. Every selector returns a new ShapeList, so
selectors chain: `part.edges().parallel_to(Z).top()`.

## What a ShapeList is
- A `list` subclass. `len()`, `in`, iteration, `[i]` and slicing work; a slice is a ShapeList.
- A one-element ShapeList is accepted wherever one shape is expected: `sketch.on(part.faces().top())`.
  With zero or several elements this raises `ValueError: expected exactly one shape, got N`.
- Features take a ShapeList, a single shape, a plain list or a tuple: `part.fillet(sel, 2)`.
  A face in an edge selection stands for its edges: `part.fillet(part.faces().top(), 1)`.
- Faces, edges and vertices from two separate calls compare equal, and the order is the same on
  every call of the same part. So `part.edges().top() | part.edges().parallel_to(Z)` works.
- Set operators: `a | b` union without duplicates, `a & b` common, `a - b` difference, `a + b`
  concatenation (may hold duplicates).
- `.faces()`, `.edges()`, `.vertices()` on a ShapeList go down one level and remove duplicates:
  `part.faces().top().edges()` are the edges of the top face.

## Positions are centers
Every positional selector (`top`, `sort_by(Z)`, `group_by`, `nearest`) uses `shape.center()`:
- Face: the area centroid. For a face with holes, a ring or a full cylinder it lies off the face.
- Edge: the point halfway along the edge (`point_at(0.5)`), not the arc center. For a full circle
  it is the point opposite the circle's start.
- Vertex: its point. Part: the center of mass.
Ties are decided with an absolute tolerance of 1e-4 mm and all tied shapes are returned.

## Why geometry beats indices
`faces()` order is the kernel's. It is stable for one part and its translated copies, but every
feature changes it: after a fillet `faces()[0]` of a box with a hole was a cylinder. Select by
geometry (`top()`, `facing(-X)`, `cylinders()`, `filter(...)`) so the script keeps working when an
earlier step changes.

A selection taken from an earlier version of a part can still be passed to a feature of the new
version: it stands for the faces or edges that descend from it (the pieces a cut left of an edge,
see `history`). Where it has none (another body), edges are matched by start, end and midpoint,
faces by an interior point and the area; if nothing matches, it fails with
`ValueError: Edge(...) is not an edge of this part`. Moved copies (`.translate()`) do not match:
they are free shapes somewhere else. `new(since=...)` and `derived_from(...)` select by where
faces and edges came from (`history`); `joining(a, b)` the edges where two bodies meet
(`joining`).

## Empty selections
Selectors never raise on empty input: an empty ShapeList chains through `top()`,
`parallel_to()`, `max_by()` and comes out empty. The failure shows up later:
- `one()`: `ValueError: expected exactly one shape, got 0`.
- `first`, `last`, `largest()`, `smallest()`, `center()`, `bbox()`: `IndexError: empty selection`.
- `[0]`, `nearest()`: `IndexError: list index out of range`.
- `fillet(empty)`, `chamfer(empty)`: `ValueError: ... the selection holds only seam or smooth edges,
  nothing to fillet` (it means: nothing to fillet; check the selector).
- `sketch.on(empty)`: `ValueError: expected exactly one shape, got 0`.
- `shell(t, openings=empty)` does not fail: it makes a closed hollow body.

Print `len(sel)` after every selection that feeds a feature, or use `.one()` where you expect one.

## The idioms that matter most
| Need | Selector |
|---|---|
| top / bottom face of a block | `faces().top()`, `faces().bottom()` |
| all faces pointing up (also lower steps) | `faces().planar().facing(Z)` |
| vertical edges of a block | `edges().parallel_to(Z)` |
| edges around the top face | `faces().top().edges()` or `edges().top()` |
| inside corners to round | `edges().concave()` |
| holes | `faces().cylinders()`, by radius: `.filter(lambda f: abs(f.radius - r) < 1e-6)` |
| hole rims only (not fillet arcs) | `edges().circles().filter(lambda e: e.is_closed)` |
| the face at a known point | `faces().at((x, y, z))` |
| what a ray meets, nearest first | `faces().hit_by(origin, direction)`, `.first` for what it sees |
| exactly one, or fail loudly | `.one()` |

## Gotchas
- `circles()` also returns fillet arcs; `cylinders()` also returns fillet faces.
- After `chamfer`, `loft`, `ruled` or `to_nurbs`, straight edges can be `bspline`: `lines()` and
  `parallel_to()` still find them; `of_type("line")` does not.
- `facing()` takes a curved face only when its normal is within `max_angle` everywhere: the walls
  of holes and bosses never face a direction, so `faces().facing(-X)` of a holed block is its
  flat -X face alone.
- `sort()` and `reverse()` are the in-place list methods and return `None`; use `sort_by`.
- `sl.copy()` and `sorted(sl)` return a plain `list` without selectors; wrap in `ShapeList(...)`.
  `Pos(...) * sl` and the transforms of `list_transforms` keep the ShapeList.

## Example
```python
part = Box(40, 30, 20) - Cylinder(6, 30)

top = part.faces().top()                     # ShapeList with one face
rim = part.edges().circles().top()           # the hole's top rim
walls = part.edges().parallel_to(Z)          # the four vertical box edges
print(len(top), len(rim), len(walls))        # 1 1 4

part = part.fillet(walls, 3)                 # a ShapeList goes straight into a feature
hole = part.faces().cylinders().filter(lambda f: abs(f.radius - 6) < 1e-6).one()
print(round(hole.radius, 3), part.is_valid())   # 6.0 True

sel = part.edges().circles().top()
print(len(sel))                              # 5: the hole rim and 4 fillet arcs
assert len(sel.filter(lambda e: e.is_closed)) == 1
```

## Related
`topology`, `positional`, `filter_by`, `parallel_to`, `types`, `convexity`, `sort_by`,
`extremes`, `spatial`, `list_transforms`, `Face`, `Edge`, `Vertex`.
