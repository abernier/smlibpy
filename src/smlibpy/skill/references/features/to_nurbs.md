# to_nurbs

Returns a copy whose faces and edges are all NURBS (B-spline): planes, cylinders, cones,
spheres, tori, lines and circles are converted.

## Signature
`body.to_nurbs()` on a `Part`, `Shell` or `Sketch`. No parameters.

## Returns
A body of the same type, the same shape: volume within about 1e-7 relative
(19978.761 → +0.0033), the same bbox size, the same face count, `is_valid()` True. All faces and
edges report `geom_type == "bspline"`. A sketch keeps its plane.

## What you lose
- Selectors and properties that need analytic geometry find nothing: `edges().circles()`,
  `faces().cylinders()` return empty lists; `face.radius` raises
  `ValueError: a bspline face has no radius`. Select before converting, or by position.
  Flat faces and straight edges still count: `planar()`, `lines()`, `parallel_to` and
  `face.plane` work.
- STEP files get larger (11.8 kB → 18.1 kB for a box with a hole and four rounds); they read
  back with the same volume.

## Why you would
- A downstream tool or format that wants only NURBS surfaces.
- To test that a model does not depend on analytic surface types.
Modeling continues to work afterwards: Booleans, fillets and shells on the converted part
are valid (new faces from later features may be analytic again). For normal modeling and
STEP export there is no reason to convert.

## Example
```python
part = Box(40, 30, 20) - Cylinder(8, 30)
n = part.to_nurbs()
print(sorted({f.geom_type for f in n.faces()}), len(n.edges().circles()))   # ['bspline'] 0
print(abs(n.volume / part.volume - 1) < 1e-6, round(n.volume - part.volume, 4))  # True, a few thousandths
```

## Related
`heal`, `export_step`, `Face.geom_type`, `ShapeList.circles()`.
