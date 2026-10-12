# convex, concave, smooth, Edge.convexity, Edge.is_convex

Classify edges by the corner the two faces make there.

## Signature
- `sl.convex()`, `sl.concave()`, `sl.smooth()`: keep edges of that kind; other shapes are dropped.
- `edge.convexity`: property, `"convex"`, `"concave"` or `"smooth"`.
- `edge.is_convex()`: a method (call it), `edge.convexity == "convex"`.

## Meaning
- `convex`: outside corner, the material angle is below 180°. Box edges, the top rim of a boss,
  and also the rims of holes (the material corner at a hole rim is 90°).
- `concave`: inside corner, material angle above 180°. The inner corner of an L, the floor edges
  and vertical corners of a pocket, the base circle where a boss meets a plate, the inner edges of
  a shelled box.
- `smooth`: the two face normals at the edge midpoint differ by less than 0.5°. The borders of a
  fillet; a kink of 0.4° counts as smooth, 0.6° does not.
- Edges with fewer or more than two faces count as `convex`: sketch edges, sheet borders, free
  edges (`Line(...)`).

The test is made at the edge midpoint only.

| Body | convex | concave | smooth |
|---|---|---|---|
| `Box` | 12 | 0 | 0 |
| L of two boxes | 17 | 1 | 0 |
| block with a rectangular pocket | 16 | 8 | 0 |
| block with a through hole | 14 | 0 | 0 |
| plate + cylindrical boss | 13 | 1 (base circle) | 0 |
| block, 4 vertical edges filleted | 16 | 0 | 8 |
| block shelled, top open | 16 | 8 | 0 |

## Use for fillets
- `part.fillet(part.edges().concave(), r)` rounds inside corners and adds material.
- `part.fillet(part.edges().convex(), r)` rounds outside corners and removes material.
- `fillet` and `chamfer` skip smooth edges; a selection of only smooth edges raises
  `ValueError: fillet: the selection holds only seam or smooth edges, nothing to fillet`.
- After a fillet the new borders are smooth, so a second `edges().concave()` does not pick them up.

## Gotchas
- Hole rims are convex, not concave: `edges().concave()` does not find holes.
- Chamfer edges stay convex (a 45° chamfer makes two 135° corners).
- Shallow kinks below 0.5° (e.g. from slightly tilted faces) count as smooth and cannot be
  filleted.

## Example
```python
L = Box(20, 10, 10, align=Align.MIN) + Box(10, 10, 20, align=Align.MIN)
print(len(L.edges().convex()), len(L.edges().concave()))   # 17 1
inner = L.edges().concave().one()
print(inner.convexity, inner.is_convex())                  # concave False
L2 = L.fillet(L.edges().concave(), 2)                      # adds material in the corner
print(round(L2.volume - L.volume, 3), len(L2.edges().smooth()))   # 8.584 2
```

## Related
`Edge`, `types`, `generic`, `fillet` and `chamfer` (features domain).
