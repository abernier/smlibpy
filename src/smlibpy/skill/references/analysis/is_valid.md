# is_valid, info

`part.is_valid()` tells whether a `Part` is a closed, manifold solid. `body.info()` returns its
counts and bounding box in one dictionary.

## Signature

`part.is_valid() -> bool` (only on `Part`)

`body.info() -> dict` (on `Part`, `Shell`, `Sketch`)

```python
{'type': 'Part', 'faces': 6, 'edges': 12, 'vertices': 8,
 'bbox': ((-5.0, -10.0, -15.0), (5.0, 10.0, 15.0))}
```

`bbox` is `(min, max)` as plain tuples. Edge counts include seam edges (a cylinder: 3), so
`info()["edges"]` can be larger than `len(part.edges())`.

## What valid means

Topology only: every edge has exactly two faces and the faces close up. It does **not**
check the geometry.

| Body | `is_valid()` | Volume |
|---|---|---|
| primitives, Booleans, fillets, shells | True | right |
| two disjoint boxes in one `Part` | True | sum; `len(part.solids()) == 2` |
| two boxes touching along an edge, fused | **False** | 2000 |
| two boxes touching at a corner, fused | True | 2000 |
| spring whose profile overlaps the next turn | **True** | overlap counted twice |
| rectangle revolved about an axis through it | **True** | about 0 |

So `is_valid()` is necessary but not enough. Also check:

- `volume > 0` and close to a formula: catches self-overlapping sweeps and revolves across the
  axis. No Boolean repairs a self-overlapping body (fuse, cut and intersect keep the doubled
  volume and stay "valid").
- `len(part.solids()) == 1` when you meant one body.
- the picture (`snapshot(view="sheet")`): a body with volume 0 still looks like a cylinder.

## Gotchas

- `Shell` and `Sketch` have no `is_valid()` (`AttributeError`). Check `info()` and `area`.
- Mirrored and negatively scaled parts stay valid with positive volume and outward normals.

## Example

```python
def check(part, expected_volume, rel=1e-5):
    assert part.is_valid(), "not a closed manifold solid"
    assert len(part.solids()) == 1, f"{len(part.solids())} solids"
    v = part.volume
    assert v > 0 and abs(v - expected_volume) <= rel * expected_volume, f"volume {v}"
    return part.info()

print(check(Box(10, 20, 30), 6000))
# {'type': 'Part', 'faces': 6, 'edges': 12, 'vertices': 8, 'bbox': ((-5.0, -10.0, -15.0), (5.0, 10.0, 15.0))}

bad = Rectangle(10, 10).revolve(Axis((0, 0, 0), (0, 1, 0)))   # profile crosses the axis
print(bad.is_valid(), bad.volume)                              # True, about 0: is_valid misses it

edge_touch = Box(10, 10, 10) + Box(10, 10, 10).translate(10, 10, 0)
print(edge_touch.is_valid())                                   # False: the boxes share only an edge
```

## Related

`generic` (what to check after each step), `mass_properties`, `Part.solids`, `heal`
