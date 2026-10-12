# Analysis: accuracy, units, validity

How exact the numbers are that you verify a model with, and what to check after each step.

## Units

Lengths in mm, areas in mm², volumes in mm³. `mass = density * volume`: with `density` in g/mm³
the mass is in g and the inertia in g·mm². Steel is `7.85e-3` g/mm³, aluminium `2.70e-3`.

## How exact the numbers are

| Measure | Source | Typical relative error |
|---|---|---|
| `bbox()` of a body | exact geometry | below 1e-9; tight, not padded |
| `Edge.length` | integration along the curve | 1e-11 (lines exact) |
| `volume`, `area`, `center()` of planar bodies | integration | exact (1e-15) |
| `volume`, `area`, `center()` of curved bodies | integration at `accuracy=1e-7` | 1e-8 to 3e-7 |
| `volume` of swept, wound, bent bodies (springs, threads, pipes) | same | 2e-6 to 1.5e-5 |
| `Face.area`, `Sketch.area` | integration at 1e-7 | 1e-8 to 3e-7 |
| `mesh().volume` | triangles | 1e-5 to 4e-4, depends on `tolerance` |

- Volume, area, center and inertia are integrated over the exact NURBS geometry, never a mesh.
- The error is about 1 to 3 times the requested `accuracy`, not "far below" it. On swept
  bodies the kernel controls its steps by the area only, so the volume can be 100 times worse
  than asked (a triangle swept along a 20-turn helix: 1.4e-5 at the default).
- Position does not matter: the same body at the origin, rotated, or moved to 1e6 gives the
  same numbers to 1e-7. Integration runs about the body's bounding-box center.
- Rotating a body that has B-spline edges changes its geometry slightly: expect the measures
  of a transformed body to agree with the original to 1e-7 relative, not better.
- Curve constructions are fits: `Helix` is a NURBS approximation 2e-6 shorter than the
  formula, and bodies swept along it inherit that.
- `mass_properties(accuracy=1e-10)` brings curved bodies to 1e-10. It costs 5 to 200 times
  more time (a 20-turn spring: 0.14 s -> 3.4 s; a bent pipe at 1e-11: 27 s).

Compare against formulas with a relative tolerance: `1e-6` for analytic bodies, `1e-4` for
sweeps and lofts. Never compare floats with `==`.

## What to check after each modeling step

```python
plate = Box(80, 60, 10)
plate = plate.fillet(plate.edges().parallel_to(Z), 8)
plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)

# after every step: valid, one solid, volume against a formula, outer size
expected = 80 * 60 * 10 - 4 * (8 * 8 - math.pi * 8 * 8 / 4) * 10 - 4 * math.pi * 4 * 4 * 10
print(plate.is_valid(), len(plate.solids()))           # True 1
print(abs(plate.volume - expected) / expected < 1e-6)  # True
print(plate.bbox().size)                               # Vector(80, 60, 10)
print(plate.info()["faces"])                           # 14
```

1. `is_valid()` is `True`. It checks topology only (closed, manifold); see `is_valid`.
2. `len(part.solids()) == 1` unless you meant several bodies. Disjoint pieces stay one `Part`.
3. `volume > 0` and close to a formula. This catches what `is_valid()` misses: a self-overlapping
   sweep counts the overlap twice, a revolve across its axis has volume 0.
4. `bbox().size` equals the planned outer size; `bbox().min`/`max` show which side a feature
   went to.
5. The face count changed by the expected amount (`info()["faces"]`).

## Gotchas

- Every `volume`, `area` and `center()` call integrates the whole body again. When you need
  several values, call `mass_properties()` once and read its fields.
- Only `Part` has `volume`, `mass_properties()` and `is_valid()`. `Shell` and `Sketch` have
  `area` and `center()` only (`AttributeError` otherwise); all bodies have `info()` and `bbox()`.
- `center()` means different things: the centroid for parts, faces, sketches and shells; the
  point halfway along the curve for edges; a length-weighted average of edge midpoints for
  wires; the plain average of the members for a `ShapeList`. See `measures`.
- The bbox of a standalone curve (not from a body) is sampled at 33 points and can be too
  small for a wavy spline. Bodies and edges taken from bodies are exact.

## Related

`mass_properties`, `measures`, `is_valid`, `distance_to`, `recipes/verification`
