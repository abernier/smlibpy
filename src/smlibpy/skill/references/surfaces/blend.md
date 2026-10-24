# blend

A smooth bridge between two sheets that do not meet: a sheet that leaves one sheet across one of
its border edges and reaches the other across one of its border edges, tangent to both (G1) or
with the same curvature across the edges too (G2, G3). Rhino's BlendSrf, a bridge surface.
(`surface_fillet` rolls a ball between surfaces that cross; `ruled` joins two curves with
straight lines and ignores the sheets' directions.)

## Signature
`blend(edge_a, edge_b, *, continuity="G2", tension=(1, 1), join=False)`

- `edge_a`, `edge_b`: border edges of sheets: edges one face uses,
  `sheet.edges().filter(lambda e: len(e.faces()) == 1)`. Two sheets, or two edges of one sheet.
- `continuity`: `"G1"` tangent, `"G2"` (default) the same curvature across the edges too,
  `"G3"` also the same change of curvature. `1`, `2`, `3` work as well.
- `tension`: how far the blend runs on in each sheet's direction before it turns: the take-off
  at `edge_a` and at `edge_b` as a part of the gap between the edges (1: as long as the gap).
  One number for both or a pair. Less is tighter, more bulges.
- `join`: `True` sews the blend to both sheets (`stitch`) and returns that one sheet.

## Returns
A `Shell` of one B-spline face: its long edges are the two edges (to 1e-9), its side edges join
the nearest ends of the two edges, whichever way the edges run. Its normal follows `edge_a`'s
sheet, so the sewn sheet thickens. With `join`: the sheets and the blend in one `Shell`.
It takes a few ms.

Two closed edges (the round rims of two tubes, closed loops) are bridged all round: each point of
`edge_a` joins the point of `edge_b` at the same fraction of its length, counted from its point
nearest `edge_a`'s start and running the same way round. The blend is then two faces sewn along
two seams (the kernel offsets no face that closes around), smooth across them (to 1e-5 degrees),
and its rims are the edges to 1e-7 of the size; the sewn sheet thickens. A closed edge and an open
one cannot be bridged.

## Measured
- Two flat sheets 20 wide, 20 apart and 10 up, edges running opposite ways: G1 456.253, G2
  466.054, G3 474.217 (an untwisted S-bridge spans at least 447); the sheets' normals and the
  blend's agree to 1e-6 degrees along both edges; sewn and thickened by 1: 1266.054 (= area).
- Off a quarter cylinder r 20: G2 and G3 have the cylinder's curvature 1/20 across the edge
  (to 1e-6) and 0 at a flat sheet, at any tension; G1 does not (0.031 there).
- Arc edges, freeform sheets from `surface`: tangent to 1e-4 degrees.
- The rims of tubes r 10 and r 6, 20 apart: 1033.631, tangent to 4e-6 degrees, its rims 2.5e-8 off
  the circles; sewn to both tubes (`join=True`) it thickens by 1 and by -1. To an elliptic loft's
  rim: tangent across its two seams to 1e-6 degrees.

## Errors
- `ValueError: blend: edge_a lies between two faces; take an edge on a sheet's border (used by
  one face)`: an edge of a part, or inside a sheet.
- `TypeError: blend: edge_a is a curve, not an edge of a sheet; ...`: a `Line`, `Spline`, ...;
  make a sheet with it first (`extrude`, `ruled`).
- `ValueError: blend: one edge is closed (a full circle, a closed loop) and the other is not;
  bridge two closed edges or two open ones`: the round edge of a tube and an edge with two ends.
  Split the tube (`Part.split` before taking its face) so that its edge has two ends too.
- `KernelError: blend failed (SM_ERR): the edges may touch or cross, or a sheet may not lead
  toward the other edge`: the edges share a point (the gap is 0 there), or a sheet's surface
  is degenerate at its edge.
- `ValueError: blend: continuity must be G1, G2 or G3, got 'G4'`, `ValueError: blend: the
  tension must be positive, got 0`, `ValueError: blend: edge_a and edge_b are the same edge`.

## Example
```python
low = Rectangle(20, 20).translate(-20, 0).faces()[0].to_shell()            # z = 0, x -30..-10
high = Rectangle(20, 20).on(Plane.XY.offset(10)).translate(20, 0, 0).faces()[0].to_shell()  # z = 10
edge_low = low.edges().filter(lambda e: abs(e.center().x + 10) < 1e-9).one()
edge_high = high.edges().filter(lambda e: abs(e.center().x - 10) < 1e-9).one()
bridge = blend(edge_low, edge_high)                     # G2: no curvature where it meets the flat sheets
print(round(bridge.area, 3))                            # 466.054
print(round(blend(edge_low, edge_high, continuity="G1").area, 3))   # 456.253
tight = blend(edge_low, edge_high, tension=(0.5, 2))    # short take-off at the low sheet, long at the high one
step = blend(edge_low, edge_high, join=True)            # one sheet of 3 faces
print(len(step.faces()), round(step.thicken(1).volume, 3))          # 3 1266.054
```

## Related
`surface_fillet` (crossing surfaces), `ruled`, `loft`, `stitch`, `Shell.thicken`, `generic`
