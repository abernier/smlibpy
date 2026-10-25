# match_edge

Move an edge of a sheet onto a curve: the edge then runs along the curve exactly, and its face
bends to follow, smoothly, near the edge only. To close a gap between two sheets before `stitch`
(match one sheet's edge to the other's), or to give a sheet a styling line.

## Signature
`sheet.match_edge(edge, target, *, extent=0.25)`

- `edge`: an edge of the sheet that is one whole side of its face.
- `target`: the curve: an `Edge`, or a `Wire` whose edges join end to end (joined into one curve).
  Either way round; its ends are where the edge's ends go.
- `extent`: how far into the face the change reaches, as a part of the face's parameter range
  across from the edge: above 0, below 1 (default 0.25). There the face meets the rest of itself
  with continuous derivatives (up to its degree less one: C2 for the bicubic faces of `surface`).

## Returns
A new `Shell` (a Sketch's comes back as a Shell): the edge on the curve (within 1e-12 in the
measured cases), the face over the rest of its range unchanged (1e-12), its opposite side in
place. The changed faces become B-splines (planes too). 2 to 3 ms.

## Where the ends move
Where the curve's ends are not the edge's ends, the edge's vertices move to them, and the two
edges next to it bend near those ends (the face's sides, within `extent`). The faces on the other
side of those edges follow them the same way (matched to their new curves), and so on, until no
edge moves. Those neighbours meet the matched face at the edge, not tangent there: matching keeps
no tangent across the side edges (a crease of 10 to 20 degrees near the moved corner in the
measured sheets; even with the ends kept, the face's slope along its side edges changes). A sheet
with such a crease may not `thicken`. To keep a sheet smooth, merge its faces first
(`merge_faces`), then match.

## What can be matched
Every face that changes must be bounded by the four sides of its surface: as `surface`, `loft`,
`ruled`, `fill`, `network` and `nurbs_surface` make them, and the halves of a sheet split along a
curve of its surface. Not faces with holes, trimmed borders (a circle cut out of a sheet), a seam
(a cylinder all around) or a pole. A plane's face is matched as its exact bilinear B-spline: a
rectangle's top edge matched to an arc in its plane stays in the plane, its area 200 + the arc's
segment exactly.

## Errors
- `ValueError: match_edge: only faces bounded by the four sides of their surface (no hole, no
  trimmed border, no seam, no pole) can be matched (a face has a hole)` (or `is trimmed`,
  `closes around`, `has no edge along all of it`).
- `ValueError: match_edge: the edge is only a part of a side of its face; a face changes along
  whole sides of its surface` (where two faces meet one side of a third: a T-junction).
- `ValueError: match_edge: the extent is a part of the face across from the edge, above 0 and
  below 1; got 1`.
- `ValueError: match_edge: ... is not an edge of this sheet`, `TypeError: match_edge: the curve is
  an Edge or a Wire, got int`, `ValueError: match_edge: the curve is a closed wire`.
- `ValueError: match_edge: the change runs around the sheet and back into a face it has changed
  already`: a sheet closed around (a ring of faces) whose corner moves.

## Example
```python
panel = surface([[(x, y, 2 * math.sin(x / 10)) for y in range(0, 25, 5)] for x in range(0, 35, 5)])
roof = surface([[(x, y, 2 * math.sin(x / 10) + 0.4) for y in range(21, 41, 5)] for x in range(0, 35, 5)])
edge = panel.edges().sort_by(Axis.Y)[-1]                 # y = 20
target = roof.edges().sort_by(Axis.Y)[0]                 # y = 21, 0.4 higher: a gap
body, r = stitch(panel, roof, tolerance=1e-6, report=True)
print(r.sewn_edges)                                      # 0: the gap stays open
closed = panel.match_edge(edge, target)                  # the panel's edge onto the roof's
body, r = stitch(closed, roof, tolerance=1e-6, report=True)
print(r.sewn_edges, r.max_gap)                           # 1 0.0

crest = Spline(*[edge.point_at(t) + Vector(0, 0, 3 * math.sin(math.pi * t)) for t in np.linspace(0, 1, 21)])
styled = panel.match_edge(edge, crest, extent=0.4)       # same ends: the side edges stay
print(round(styled.area, 4), round(styled.bbox().max.z, 4))   # 621.8176 4.9968 (was 605.6792)
```

## Related
`stitch` (sew the matched sheets), `blend` (a bridge across a gap instead), `merge_faces`,
`Shell.trim`, `Face.extend`, `surface`, `generic`
