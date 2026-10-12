# ruled

A ruled surface: straight lines join matching points of two curves. Returns a `Shell` with one face.

## Signature
`ruled(a, b)`

- `a`, `b`: an `Edge` (Line, arc, CenterArc circle, Spline, Bezier, Helix, an edge of a part,
  `Circle(10).edges()[0]`) or a `Wire` of exactly one edge.

## Returns
A `Shell`: one `"bspline"` face with 4 edges (two curves, two rulings at the ends). Two closed
curves give a closed band: 2 edges plus 1 seam. Exact for lines and circles: circle r20 to
circle r5 30 above has area 2634.306 (frustum formula 2634.306); helix to its axis gives a
helicoid of the exact area.

## Which points are joined
Points at the same **normalized curve parameter** (0..1 on each curve), not at the same
fraction of length.

- Lines, circles and arcs: the parameter follows the length, so the rulings are even.
- Splines are parameterized by the chord lengths between their points. A spline with points
  bunched at one end slides its rulings: `Line` 0..20 against a spline through x = 0, 2, 4, 20
  joins line x = 5 to spline x = 2 and line x = 10 to spline x = 4.2. Give both curves points at
  matching places, or use `loft`.
- Both curves must run the **same way**. A reversed curve gives a bow tie (crossing in the
  middle, area halved, normal flipping across the crossing). Fix with `edge.reversed()`.
- Two circles that start at different angles give a twisted band; one clockwise and one
  counterclockwise give a pinched one. Start them at the same angle, same direction.

## Normal direction
normal = (tangent of `a`) × (direction from `a` to `b`).
`ruled(a, b)` and `ruled(b, a)` have opposite normals; reversing both curves flips it too.
Circle → circle above it, both counterclockwise: normal points outward.
`thicken(t)` adds material along the normal for t > 0.

## Gotchas
- A wire of several edges raises `ValueError: expected a single curve; join the wire's edges
  into one spline first`. Use one `Spline` through the corner points, or make one `ruled` per
  edge and `stitch` them.
- A flat ruled face counts as planar (`face.is_planar` True, `faces().planar()` finds it,
  `to_sketch()` works), although its `geom_type` is `"bspline"`.
- Thickening closed ruled bands works (unlike closed `surface` grids); still check
  `volume > 0` and `is_valid()` after `thicken`.

## Errors
- `KernelError: surface failed (SM_ERR)`: the two curves are identical.
- `ValueError: a line needs two distinct points`: a zero-length `Line` (to make a fan towards
  one point, use a tiny segment or a cone).
- `ValueError: expected a single curve ...`: a multi-edge wire, or a Face passed by mistake.
- `AttributeError: 'tuple' object has no attribute 'edges'`: points instead of curves.

## Example
```python
blade = ruled(Line((0, 0, 0), (40, 0, 0)), Line((0, 20, 10), (40, 20, -10)))
print(blade.faces()[0].normal_at())               # tangent of a × (a → b), here mostly +Z
blade_solid = blade.thicken(1.5)
print(blade_solid.is_valid(), round(blade_solid.volume, 2))   # True 1294.39

funnel = ruled(CenterArc((0, 0, 0), 20, 0, 360), CenterArc((0, 0, 30), 5, 0, 360))
print(round(funnel.area, 3))                      # exact frustum: π(20+5)·√(15²+30²) = 2634.3
wall = funnel.thicken(-2)                         # normal points outward; -2 puts the wall inside
print(wall.is_valid(), round(wall.volume, 1), wall.bbox().max.x)   # True 4891.6 20.0
```

## Related
`surface`, `loft` (through more than two curves; `loft(..., ruled=True)` for solids),
`Shell.thicken`, `stitch`, `generic`
