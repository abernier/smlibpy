# Analysis: accuracy, units, validity

How exact the numbers are that you verify a model with, and what to check after each step.

## Units

Lengths in mm, areas in mm², volumes in mm³. `mass = density * volume`: with `density` in g/mm³
the mass is in g and the inertia in g·mm². Steel is `7.85e-3` g/mm³, aluminium `2.70e-3`.

## How exact the numbers are

| Measure | Source | Relative error |
|---|---|---|
| `bbox()` of a body | exact geometry | below 1e-9; tight, not padded |
| `Edge.length`, `point_at(t)` | integration along the curve | 1e-12 (lines exact) |
| `volume`, `area`, `center()`, inertia of parts | integration with an error estimate, to `accuracy=1e-7` | at most 1e-7; measured 1e-10 and better |
| `Face.area`, `Sketch.area`, `Shell.area` | the same | the same; lettering exact |
| `mesh().volume` | triangles | 1e-5 to 4e-4, depends on `tolerance` |
| `raycast` points of a body | the ray intersected with the exact faces | 1e-12 |

- Volume, area, center and inertia are integrated over the exact geometry, never a mesh. The
  integration estimates its error for each of them and refines until the estimate is ten
  times below the accuracy: 1e-7 by default, `mass_properties(accuracy=...)` from 1e-10 to
  1e-2. Volumes and areas to that fraction of their value, the center to that fraction of the
  body's bounding-box diagonal, the inertia to that fraction of its largest principal moment.
- Measured: closed forms (box, sphere, cylinder, cone, torus, filleted boxes) agree to 1e-10
  and better; a spring (a circle swept along a helix) agrees with its own integration at
  1e-10 to 1e-15.
- Position does not matter: the same body moved to 1e6 gives the same numbers to 1e-11.
  Integration runs about the body's bounding-box center.
- The body can be less exact than its numbers. Where the kernel fits a surface or an
  intersection curve (fitted chamfers, G2/G3 blends, variable fillets, shells and offsets of
  curved faces, sweeps cut by planes, two cylinders crossing), the faces meet only to about 1e-6
  to 2e-5 mm, and the volume is defined only to that: the same body turned by 90 degrees measures
  3e-7 (two crossing cylinders) to 4e-6 (a shelled bottle; a pin with G2-blended rims 3.4e-6)
  different. Chamfers of full circles between coaxial faces are exact cones, not fitted. Bodies
  whose edges are lines and circles close up exactly.
- Curve constructions are fits: `Helix` is a NURBS approximation 2e-6 shorter than the
  formula, and bodies swept along it inherit that.
- `mass_properties(accuracy=1e-10)` costs about as much as the default (the spring: 0.47 s
  either way); a coarse accuracy saves little (1e-4: 0.19 s).

Compare against formulas with a relative tolerance: `1e-6`, or `1e-5` for sweeps, shells and
offsets of curved faces. Never compare floats with `==`.

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

1. `is_valid()` is `True`: closed, manifold and a positive volume; see `is_valid`.
2. `len(part.solids()) == 1` unless you meant several bodies. Disjoint pieces stay one `Part`.
3. `volume` close to a formula. This catches what `is_valid()` misses: a self-overlapping
   sweep counts the overlap twice.
4. `bbox().size` equals the planned outer size; `bbox().min`/`max` show which side a feature
   went to.
5. The face count changed by the expected amount (`info()["faces"]`).

## Gotchas

- A part keeps its measures: the first of `volume`, `area`, `center()` and
  `mass_properties()` integrates (a few milliseconds for most parts, 55 ms for a spring with
  512 knot spans, 0.6 s for a thickened surface with 46,000 knot spans on a face), the others
  reuse it. A copy (`named()`, `colored()`, a moved part) integrates again.
- A `RuntimeWarning` "mass properties: the faces of this part do not meet exactly ..." means
  the body's faces leave gaps that make its volume uncertain by more than 1e-5 (the warning
  gives how much). The body is at fault, not the measure: see `mass_properties`.
- Only `Part` has `volume`, `mass_properties()` and `is_valid()`. `Shell` and `Sketch` have
  `area` and `center()` only (`AttributeError` otherwise); all bodies have `info()` and `bbox()`.
- `center()` means different things: the centroid for parts, faces, sketches and shells; the
  point halfway along the curve for edges; a length-weighted average of edge midpoints for
  wires; the plain average of the members for a `ShapeList`. See `measures`.
- The bbox of a standalone curve (not from a body) is sampled at 33 points and can be too
  small for a wavy spline. Bodies and edges taken from bodies are exact.

## Related

`mass_properties`, `section_properties`, `measures`, `is_valid`, `distance_to`, `closest_points`,
`curvature_at`, `continuity`, `raycast`, `recipes/verification`
