# Vector

An immutable 3D point or direction.

## Signature
`Vector(x, y, z)`, `Vector(x, y)` (z = 0), `Vector((x, y, z))`, `Vector([x, y])`,
`Vector(numpy_array)`, `Vector(other_vector)`, `Vector()` (the origin).
Almost every API that takes a point or direction also takes a plain tuple, so you rarely need
to build a `Vector` yourself.

## Operations
| Expression | Result |
|---|---|
| `a + b`, `a - b` | Vector; either side may be a tuple: `(5, 5, 5) - a` |
| `a * 3`, `3 * a`, `a / 2`, `-a` | Vector |
| `a * b` | TypeError: use `a.dot(b)` or `a.cross(b)` |
| `abs(a)`, `a.length` | float |
| `a.dot(b)` | float |
| `a.cross(b)` | Vector, right-handed: `X × Y = Z` |
| `a.normalized()` | unit Vector; zero vector -> ValueError |
| `a.angle_to(b)` | degrees, 0..180, unsigned |
| `a.distance_to(b)` | float |
| `a.is_close(b, tolerance=1e-6)`, `a == b` | bool, absolute distance ≤ 1e-6 |
| `a.is_parallel(b)`, `a.is_perpendicular(b)` | bool; parallel ignores the sense |
| `a.rotate(axis, deg)` | Vector rotated about an `Axis` (through its origin) or a direction tuple (through the world origin) |
| `a.project_to(plane)` | point projected onto a `Plane` |
| `a.any_perpendicular()` | some unit vector perpendicular to `a` |
| `a.x`, `a[0]`, `x, y, z = a`, `a.to_tuple()`, `np.array(a)` | access |

## Gotchas
- `X`, `Y`, `Z` are `Axis` objects: `Vector(1, 2, 3) + X` raises TypeError. Use
  `X.direction` (a unit Vector) for arithmetic.
- `sum(vectors)` fails; use `sum(vectors, Vector())`.
- The repr rounds to 6 significant digits; use `to_tuple()` for full precision.
- Coordinates are read-only (`v.x = 5` raises AttributeError); make a new Vector.
- Vectors equal within 1e-6 can have different hashes; do not rely on sets for deduplication.

## Errors
- `ValueError: expected 2 or 3 coordinates, got 4` for a sequence of another length (`got 1`
  for one coordinate); `ValueError: Vector takes up to three coordinates` for `Vector(1, 2, 3, 4)`.
- `ValueError: cannot normalize a zero-length vector` from `normalized()`, and from
  `Axis`/`Plane` built with a zero direction.

## Example
```python
a = Vector(10, 0, 0)
b = Vector((0, 5))                    # 2D: z = 0
print(a + b, a - (0, 0, 3), 2 * a, a / 4)
print(a.dot(b), a.cross(b), a.length, a.normalized())
print(a.angle_to(b))                  # 90.0, always 0..180
print(Vector(1, 0, 0).rotate(Z, 90))  # Vector(0, 1, 0)

d = Z.direction * 5                   # X, Y, Z are axes; .direction is the vector
part = Box(10, 10, 10).translate(d)
print(part.center())                  # Vector(0, 0, 5)
total = sum([Vector(1, 0, 0), Vector(0, 2, 0)], Vector())
```

## Related
`Axis`, `Plane.to_local`, `Location` (`loc * vector` moves a point), `generic`.
