# sort_by, sort_by_distance, group_by, sort, reverse

Order a selection, or split it into groups of equal key.

## Signature
- `sl.sort_by(key=Z, reverse=False)` → ShapeList, ascending.
- `sl.sort_by_distance(point, reverse=False)` → ShapeList, nearest center first.
- `sl.group_by(key=Z, tolerance=1e-4)` → a plain `list` of ShapeLists, lowest key first.
- Operators: `sl > key` = `sort_by(key)`, `sl < key` = `sort_by(key, reverse=True)`,
  `sl >> key` = `max_by(key)`, `sl << key` = `min_by(key)`.

## Keys
| Key | Sorts by |
|---|---|
| `X`, `Y`, `Z`, `-Z`, any `Axis` | position of `center()` along the axis direction (`-Z`: highest first) |
| `"x"`, `"y"`, `"z"` (any case) | same as the axis |
| `"area"` | faces (and Parts) |
| `"length"` | edges and wires |
| `"volume"` | Parts (`solids()`) |
| `"radius"` | circular edges, cylinder/cone/sphere/torus faces |
| `"size"` / `"measure"` | volume, else area, else length (mixed lists) |
| a function `f(shape) -> number` | anything |

Positions use `center()`: the centroid of a face, the midpoint of an edge (see `positional`).

## Errors
- `sort_by((1, 0, 0))`: `TypeError: cannot sort by (1, 0, 0)`; pass `Axis((0, 0, 0), (1, 0, 0))` or
  a function. Unknown strings: `TypeError: cannot sort by 'foo'`.
- `sort_by("distance")`: `ValueError: use .sort_by_distance(point)`.
- A key that does not apply raises: `"area"` on edges `AttributeError: 'Edge' object has no attribute
  'area'`; `"radius"` on a list with planar faces `ValueError: a plane face has no radius`. Narrow
  first (`circles().sort_by("radius")`).

## group_by
- Groups hold shapes whose key is within `tolerance` of the group's first (smallest) key. Values
  0, 6e-5, 1.2e-4, 1.8e-4 with tolerance 1e-4 make two groups, [0, 6e-5] and [1.2e-4, 1.8e-4].
- `group_by(Z)[-1]` is `max_by(Z)`, `group_by(Z)[0]` is `min_by(Z)`.
- Edges of `Box(10, 20, 30)` by `"length"`: three groups of 4.
- Use it to pick "the second level from the top": `part.faces().planar().group_by(Z)[-2]`.

## Gotchas
- `sort()` and `reverse()` are Python's in-place list methods. They return `None`:
  `faces = part.faces().reverse()` sets `faces` to None. Use `sort_by(..., reverse=True)` or `[::-1]`.
- `sorted(sl)` returns a plain list without selectors.
- Ties keep their input order (the sort is stable). That order is the kernel's; do not rely on it.
- `sort_by_distance` and `nearest` measure to `center()`, not to the nearest point of the shape.

## Example
```python
part = Box(40, 30, 20) - Cylinder(6, 30) - Cylinder(2, 30).translate(14, 0, 0)
faces = part.faces()
print([round(f.area, 1) for f in faces.sort_by("area")][-2:])   # [1074.3, 1074.3]
print(round(faces.sort_by(Z, reverse=True).first.center().z, 3))  # 10.0
groups = part.edges().group_by(Z)
print([(round(g[0].center().z, 3), len(g)) for g in groups])    # [(-10.0, 6), (0.0, 4), (10.0, 6)]
radii = part.edges().circles().group_by("radius")
print([(round(g[0].radius, 1), len(g)) for g in radii])         # [(2.0, 2), (6.0, 2)]
corner = part.vertices().sort_by_distance((20, 15, 10)).first
print(corner)                                                   # Vertex(20, 15, 10)
```

## Related
`extremes` (`max_by`, `min_by`, `largest`), `positional`, `spatial` (`nearest`), `generic`.
