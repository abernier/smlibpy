# largest, smallest, min_by, max_by, first, last, one, at

Pick the extreme shapes, one shape, or the shapes at a point.

## Signature
- `sl.largest()`, `sl.smallest()` → one shape, by volume, else area, else length.
- `sl.max_by(key=Z, tol=1e-4)`, `sl.min_by(key=Z, tol=1e-4)` → ShapeList of every shape tying for
  the largest / smallest key. Keys as in `sort_by` (`Z`, `"area"`, `"length"`, `"radius"`, a function).
- `sl.first`, `sl.last` → properties (no parentheses), the first / last element.
- `sl.one()` → the only element; raises unless there is exactly one.
- `sl.at(point, tol=1e-4)` → ShapeList of the shapes passing through `point` (distance ≤ tol).

## Returns and ties
| Call | Returns | On a tie | On an empty list |
|---|---|---|---|
| `largest()` / `smallest()` | one shape | the first in list order | `IndexError: empty selection` |
| `max_by()` / `min_by()` | ShapeList | all tied shapes | empty ShapeList |
| `first` / `last` | one shape | - | `IndexError: empty selection` |
| `one()` | one shape | `ValueError: expected exactly one shape, got 2 - narrow the selection or use [0]` | `ValueError: ... got 0` |
| `at(p)` | ShapeList | all shapes through p | empty ShapeList |

`largest()` on a box with a hole: one of the two equal faces (top and bottom tie, list order
decides). Use `max_by("area")` to see the tie, then narrow (`.top()`).

## at(point)
- Vertices at the point, edges and faces touching it: at a box corner 1 vertex, 3 edges, 3 faces.
- Point on a hole rim: the planar face and the cylinder face.
- `tol` is absolute: 1e-5 off is found, 1e-3 off is not (`tol=0.01` finds it).
- A point in the opening of a hole touches no face.
- On `solids()` the distance is to the boundary: a point inside a solid is not "at" it.

## Gotchas
- `largest()` compares volume, area or length, whichever the shape has: on a mixed list of faces
  and edges it compares areas with lengths. Vertices all measure 0: the first one wins.
- `max_by(key, tol=...)` groups like `group_by`: with a large `tol` more shapes join the top group.
- `first` and `last` depend on list order, which is the kernel's. Sort first (`sort_by(X).last`).
- `one()` is the right tool when a feature needs exactly one face: it fails loudly at the
  selection instead of later.

## Example
```python
part = Box(40, 30, 20) - Cylinder(6, 30)
print(part.faces().largest())                        # Face(plane, area=1086.9, ...) one face
print(len(part.faces().max_by("area")))              # 2: top and bottom tie
print(len(part.edges().min_by("length")))            # 4: the vertical edges (20)
print(part.vertices().at((20, 15, 10)))              # ShapeList([Vertex(20, 15, 10)])
print(len(part.edges().at((20, 15, 10))))            # 3
try:
    part.faces().parallel_to(Z).one()
except ValueError as e:
    print(e)   # expected exactly one shape, got 2 - narrow the selection or use [0]
```

## Related
`positional` (`top`, ... = `max_by`/`min_by` of an axis), `sort_by`, `spatial`, `generic`.
