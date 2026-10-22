# tangent_chain, Edge.tangent_chain, ShapeList.tangent_chain

The run of edges that continue each other tangentially: what `fillet` and `chamfer` round when
one of them is selected.

## Signature
- `edge.tangent_chain()`: this edge (first) and the edges that continue it tangentially, and
  those that continue them, as far as the run goes. A `ShapeList` of edges.
- `sl.tangent_chain()`: the same for every edge of the list, each edge once; other shapes are
  dropped.

## Meaning
An edge continues another at their common vertex when
- it leaves the vertex in the direction the other arrives in, within 10° (the kernel's own
  tangency angle for fillet corners),
- its two faces meet the other edge's faces smoothly there (their normals pair up within 10°),
  as the next edge around a rounded corner does, and
- it can be rounded itself: not smooth, not a seam.

So the top outline of a plate with rounded corners is one run (4 lines and 4 arcs), as is the
outline of a slot; the edges of a box meet at corners and each is its own run, as are the edges
of a polygon whose sides turn by more than 10°. An edge of no part is its own run.

## Use for fillets
- `fillet` and `chamfer` round the run of every selected edge by default (`propagate=True`):
  `plate.fillet(one_top_edge, 1)` rounds the whole outline, like `plate.fillet(one_top_edge.tangent_chain(), 1)`.
- `propagate=False` rounds the selected edges only; `tangent_chain()` then shows which edges the
  kernel would have to run the round into.

## Example
```python
plate = Rectangle(40, 30, fillet=5).extrude(10)
long = plate.edges().filter(lambda e: abs(e.center().z - 10) < 1e-6).sort_by("length")[-1]
print(len(long.tangent_chain()), [e.geom_type for e in long.tangent_chain()][:3])   # 8 ['line', 'circle', 'circle']
print(len(Box(10, 10, 10).edges().parallel_to(Z).tangent_chain()))                # 4: no runs
rounded = plate.fillet(long, 1)                       # the whole top outline
print(round(rounded.volume, 4))                       # 11757.4972
```

## Related
`fillet` and `chamfer` (features domain), `convexity` (`smooth()` edges are never part of a run),
`Edge`.
