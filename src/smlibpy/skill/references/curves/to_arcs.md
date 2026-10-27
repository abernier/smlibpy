# to_arcs

An edge or wire as lines and circular arcs within a tolerance: for CNC, laser, plasma and
water-jet software and DXF readers that take only LINE and ARC (G-code G1/G2/G3).

## Signature
`edge.to_arcs(tolerance=0.01) -> Wire` · `wire.to_arcs(tolerance=0.01) -> Wire`

- `tolerance`: the largest distance between the curve and its lines and arcs, both ways
  (mm).

## Returns
A wire end to end along the edge (same start and end). Lines and arcs (`geom_type` `"line"`,
`"circle"`) come back as they are; straight B-splines become a line. Splines and ellipses
become arcs joined tangentially (kinks of about 1e-6 degrees), and lines where they run
straight. Each arc is an exact circle (`ThreePointArc`).
- `Spline((0, 0), (10, 5), (20, -3), (30, 4))`: 26 arcs at 0.01, 52 at 0.001. (The kernel's
  `k.convert_to_lines_and_arcs` gives one rational B-spline 0.0037 off for 0.001.)
- A full ellipse of radii 40 and 20 (`Ellipse(40, 20)`): 48 arcs at 0.01; radii 20 and 10: 38.

## Errors
- `ValueError: to_arcs: the tolerance must be positive, got 0`.
- `ModelingError: to_arcs: the lines and arcs come no closer than ... to the bspline, more than
  the tolerance ...; use a larger tolerance` (when the kernel cannot reach it).

## Example
```python
cut = Spline((0, 0), (10, 5), (20, -3), (30, 4)).to_arcs(0.01)
print(len(cut.edges()), {e.geom_type for e in cut.edges()})     # 26 {'circle'}
export_dxf(Ellipse(40, 20) - Circle(5), "plate.dxf", curves="arcs")   # 48 ARC + 1 CIRCLE
```

## Related
`files/export_dxf` (`curves="arcs"`), `Wire.md`.
