# is_valid, info

`part.is_valid()` tells whether a `Part` is a closed, manifold solid with a positive volume.
`body.info()` returns its counts and bounding box in one dictionary.

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

Every edge has exactly two faces, the faces close up, the bounding box is finite, and the
enclosed volume is positive. The volume is a quick, coarse integration (or the measured one,
if the part was measured before): it decides the sign, it is no measure. Inside-out bodies
and bodies without volume are not valid. It does **not** check the geometry beyond that:
"close up" is the topology. Faces that the kernel fitted meet only to within about 1e-6 to
2e-5 mm (B-spline chamfers, shells of curved faces); such a body is valid, and its volume is
defined only to 1e-7 to 4e-6 of its value (see `generic`).

| Body | `is_valid()` | Volume |
|---|---|---|
| primitives, Booleans, fillets, shells | True | right |
| two disjoint boxes in one `Part` | True | sum; `len(part.solids()) == 2` |
| two boxes touching at a corner, fused | True | 2000 |
| empty Part (a cut that removes everything) | **False** | 0 |
| spring whose profile overlaps the next turn | **True** | overlap counted twice |

Booleans, revolve, sweep, loft, extrude with taper and thicken check their result and raise
`ModelingError` instead of returning an inside-out or volume-less body; fillet, chamfer,
shell and offset refuse an invalid input part. A fuse of two boxes touching along an edge
raises.

So `is_valid()` is necessary but not enough. Also check:

- `volume` close to a formula: catches self-overlapping sweeps. No Boolean repairs a
  self-overlapping body (fuse, cut and intersect keep the doubled volume and stay "valid").
- `len(part.solids()) == 1` when you meant one body.
- the picture (`snapshot(view="sheet")`).

## Gotchas

- `Shell` and `Sketch` have no `is_valid()` (`AttributeError`). Check `info()` and `area`.
- Mirrored and negatively scaled parts stay valid with positive volume and outward normals.

## Example

```python
def check(part, expected_volume, rel=1e-5):
    assert part.is_valid(), "not a valid solid"
    assert len(part.solids()) == 1, f"{len(part.solids())} solids"
    v = part.volume
    assert abs(v - expected_volume) <= rel * expected_volume, f"volume {v}"
    return part.info()

print(check(Box(10, 20, 30), 6000))
# {'type': 'Part', 'faces': 6, 'edges': 12, 'vertices': 8, 'bbox': ((-5.0, -10.0, -15.0), (5.0, 10.0, 15.0))}

empty = Box(10, 10, 10) - Box(20, 20, 20)                      # the tool encloses the part
print(empty.is_valid(), len(empty.faces()))                    # False 0

corner = Box(10, 10, 10) + Box(10, 10, 10).translate(10, 10, 10)
print(corner.is_valid(), corner.volume)                        # True 2000.0: touching at a corner
# Box(10, 10, 10) + Box(10, 10, 10).translate(10, 10, 0) raises ModelingError (only an edge shared)
```

## Related

`generic` (what to check after each step), `mass_properties`, `Part.solids`, `heal`
