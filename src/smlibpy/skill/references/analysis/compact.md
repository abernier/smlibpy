# compact

Free the memory that queries left on a body. The kernel keeps what it computes for a query on
the body's curves and surfaces (evaluation grids, trimmed-surface data, spatial trees) for as
long as the body lives.

## Signature

`body.compact() -> None` on `Part`, `Shell` and `Sketch`. The body does not change, nor do its
faces and edges; the next query builds what it needs again.

## When

| Query | Left on a holed, filleted box of 129 KB |
|---|---|
| `volume`, `area`, `mass_properties()`, selectors | nothing |
| `bbox()` | 41 KB |
| `mesh()`, `export(...stl/glb/obj)` | 754 KB |
| `distance_to(body)` | 799 KB |

- A query that finds what an earlier one left is about 1.2 times as fast (`closest_point()`
  after `distance_to()`: twice); Booleans, fillets and the other operations gain nothing.
- So compact the bodies that are kept but no longer queried: the copies of a large pattern after
  they were measured, meshed or exported, a library of parts held in a session. A few parts
  need nothing.
- Compacting takes about 0.01 ms a body; compacting one that holds nothing costs the same.

## Example

```python
part = Box(40, 30, 10) - Cylinder(5, 20)
part = part.fillet(part.edges().parallel_to(Z), 2)
copies = [part.translate(i * 50, 0, 0) for i in range(100)]
meshes = [p.mesh() for p in copies]      # each copy now keeps about 750 KB
for p in copies:
    p.compact()                           # and gives it back
print(round(copies[0].volume, 3), copies[0].bbox().max)   # the bodies are unchanged
```

## Related

`measures`, `distance_to`, `raycast`, `generic`
