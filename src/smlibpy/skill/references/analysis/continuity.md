# continuity, g1, g2

How two faces meet along an edge, and the edges of a wire at its joints: a crease (G0), tangent
(G1) or with equal curvature too (G2), with the numbers.

## Signature

- `edge.continuity(samples=16, *, angle_tol=0.5, curvature_tol=0.01) -> Continuity` for an edge
  between two faces (a seam compares its face with itself).
- `wire.continuity(*, angle_tol=0.5, curvature_tol=0.01) -> Continuity` at the joints of a wire
  (and where a closed wire closes).
- `edges.g1()`: edges that are at least tangent (G1 or G2); `edges.g2()`: G2 edges.

## Returns

`Continuity`, a named tuple:

| Field | Meaning |
|---|---|
| `level` | `"G2"`, `"G1"`, `"G0"`, or `None` where the sides leave a gap above the edge's tolerance (wires: 1e-6) |
| `gap` | the largest distance between the two sides |
| `angle` | the largest angle between the faces' normals (wires: the edges' tangents), degrees |
| `curvature_jump` | the largest difference of the normal curvatures across the edge (wires: of the curvature vectors), 1/mm; NaN where one side cannot be had (across a crease) |
| `point` | where it is worst for the level: the gap for `None`, the angle for G0, the jump for G1 and G2 |

G1 means `angle <= angle_tol` (0.5 degrees: the kernel's tolerance, and `smooth()`'s); G2 means
`curvature_jump <= curvature_tol * (larger curvature) + 1e-3 / length` as well, so that faces
that are both nearly flat count as G2.

## How

At each of `samples` points along the edge, each face is evaluated at the edge's point: their
distance, the angle between their outward normals, and their normal curvatures in the direction
across the edge (tangent to each face). With equal normals all along, those are what can differ:
the curvature along the edge and the twist follow from the shared curve. smlibpy's own:
the kernel's `SmEdge::GetContinuity` compares a normal with itself and calls the creases of a G2
blend discontinuous.

## Gotchas

- `ValueError` for a free curve ("it is a free curve") and for an edge with one face (a sheet's
  border): `g1()` and `g2()` leave those out.
- The points are spread evenly along the parameter, not at the ends: a kink right at a vertex
  is the next edge's business.
- `smooth()` and `convexity` also look along the whole edge (5 points): an edge tangent only at
  its middle is convex or concave where its faces turn most.

## Example

```python
box = Box(30, 30, 30)
edge = box.edges().filter_by(Z).sort_by(X).last
round_part = box.fillet(edge, 5)
blend = box.fillet(edge, 5, continuity="G2")
c = round_part.edges().g1().first.continuity()
print(c.level, round(c.angle, 9), round(c.curvature_jump, 9))   # G1 0.0 0.2
print(len(round_part.edges().g2()), len(blend.edges().g2()))     # 0 2
print(box.edges().first.continuity().level)                      # G0
w = Wire([Line((0, 0, 0), (10, 0, 0)), CenterArc((10, 5, 0), 5, -90, 90)])
print(w.continuity().level)                                      # G1: tangent, not curvature-continuous
```

## Related

`convexity` (selection domain), `fillet` (features domain), `curvature_at`
