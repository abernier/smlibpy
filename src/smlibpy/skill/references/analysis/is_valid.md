# is_valid, info

`part.is_valid()` tells whether a `Part` is a closed, manifold solid with a positive volume
whose faces meet.
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

Every edge has exactly two faces, the faces close up, the bounding box is finite, the
enclosed volume is positive, and the faces meet. `is_valid()` integrates the volume coarsely
(or takes the measured one, if the part was measured before): it decides the sign, it is no
measure. The same integration measures the gaps between the faces: it integrates the volume
with three fields, which agree only for faces that meet. Inside-out bodies, bodies without
volume and bodies whose faces leave gaps that make the volume uncertain by 1e-2 of its value
or more (a Boolean result that left a face out: 0.25) are not valid. Faces that the kernel
fitted meet only to within about 1e-6 to 2e-5 mm (fitted chamfers and blends, shells of curved
faces); such a body is valid, and its volume is defined only to 1e-7 to 1e-5 of its value (the
smaller the part, the more; see `generic`).

| Body | `is_valid()` | Volume |
|---|---|---|
| primitives, Booleans, fillets, shells | True | right |
| two disjoint boxes in one `Part` | True | sum; `len(part.solids()) == 2` |
| two boxes touching at a corner, fused | True | 2000 |
| empty Part (a cut that removes everything) | **False** | 0 |
| spring whose profile overlaps the next turn | **True** | overlap counted twice |

Booleans raise `ModelingError` for a result that is not closed, for an empty result the
operands cannot explain (a cut whose tools hold less volume than the part, or do not span its
box) and for an intersection that reaches out of an operand (the kernel can return the whole
part). The volume of a Boolean result costs up to twice the Boolean and is integrated only
when `is_valid()` is called; a chain of Booleans integrates nothing. Revolve, sweep, loft,
extrude with taper and thicken check their result and raise instead of returning an
inside-out or volume-less body; fillet, chamfer, shell and offset refuse an input part that is
inside out or without volume by the kernel's quick integration (and one whose faces leave gaps,
once it was measured: the gap measure costs 3 to 6 times as much on curved parts, so only
`is_valid()` and `volume` pay for it). A fuse of two boxes touching along an edge raises.

So `is_valid()` is necessary but not enough. Also check:

- `volume` close to a formula: catches self-overlapping sweeps. No Boolean repairs a
  self-overlapping body (fuse, cut and intersect keep the doubled volume and stay "valid").
  It also catches a Boolean whose operand's seam line touches the other operand (a pin
  tangent to a bore: material left in the bore, valid).
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
