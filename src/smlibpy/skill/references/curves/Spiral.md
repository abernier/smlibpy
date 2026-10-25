# Spiral

A flat (Archimedean) spiral: spiral springs, scroll grooves, flat coils.

## Signature
`Spiral(start_radius, end_radius, turns, plane=Plane.XY, *, clockwise=False)`

- `start_radius`, `end_radius`: the radius at the start and at the end; it changes evenly with
  the angle. Either may be 0 (from or to the center), not both; they must differ.
- `turns`: the number of turns, > 0; fractions and any number work.
- `plane`: the spiral's plane; it turns around the plane's origin.
- `clockwise=True`: clockwise seen from the plane's normal (default counterclockwise).

## Returns
An `Edge` (`geom_type == "bspline"`) in the plane, starting on the plane's X axis at
`start_radius`. A B-spline within about 1e-4 of the exact spiral (the kernel's helix fit, as for
`Helix`), exactly in the plane. The gap between turns is `(end_radius - start_radius) / turns`.

## Example
```python
spring = Spiral(2, 20, 5)                              # (2, 0, 0) -> (20, 0, 0), 3.6 between turns
print(round(spring.length, 3))                         # 346.231
strip = sweep(Rectangle(0.5, 1), spring)               # a flat spiral spring, valid
inward = Spiral(20, 0, 3, Plane.XZ, clockwise=True)    # ends at the center, in the XZ plane
```

## Errors
- `ValueError: Spiral: start_radius and end_radius must differ ...` (equal radii are a circle
  gone round again and again; use `CenterArc`).
- `ValueError: Spiral: the radii must not be negative`, `ValueError: Spiral: turns must be positive`.

## Related
`Helix` (rising), `features/sweep`.
