# mass_properties

Mass, volume, area, center of mass and inertia tensor of a `Part`, in one integration.

## Signature

`part.mass_properties(density=1.0, accuracy=None) -> MassProperties`

- `density`: mass per mm³, uniform, positive. `7.85e-3` (steel, g/mm³) gives grams and g·mm².
- `accuracy`: relative accuracy of the results, 1e-10 to 1e-2. `None` means the default 1e-7:
  volume, mass and area to 1e-7 of their value, the center to 1e-7 of the bounding-box
  diagonal, the inertia to 1e-7 of its largest principal moment.

## Returns

A `MassProperties` with plain attributes:

| Field | Meaning |
|---|---|
| `mass` | `density * volume` |
| `volume` | mm³, independent of density |
| `area` | total surface area in mm², cavities included |
| `center` | center of mass, a `Vector` in world coordinates |
| `inertia` | 3x3 numpy array about the center of mass, axes parallel to the world axes |
| `principal_moments` | the eigenvalues of `inertia`, ascending |
| `principal_axes` | unit `Vector`s, in the order of `principal_moments` |
| `density` | the density passed in |

`inertia` is the standard tensor: the diagonal holds Ixx, Iyy, Izz; the off-diagonals hold the
**negated** products of inertia (`inertia[0][1] = -∫(x-cx)(y-cy) dm`). An L-shaped part with
its mass in +x/-y and -x/+y gives a positive `inertia[0][1]`.

## Accuracy

The integration estimates its error for each result and refines until the estimate is ten
times below `accuracy`; the results are usually far better than asked. Checked against
formulas at the default: box, sphere, cylinder, cones, torus and filleted boxes to 1e-10 and
better in volume, area, center and inertia. The same body moved to 1e6 gives the same numbers
to 1e-11.

| part | `accuracy` | volume error | time |
|---|---|---|---|
| `Sphere(10)` | 1e-4 / 1e-7 (default) / 1e-10 | below 1e-15 | 2 / 2 / 4 ms |
| spring of `examples/spring.py` | 1e-4 / 1e-7 / 1e-10 | below 1e-15 (against 1e-10) | 23 / 54 / 55 ms |
| triangle swept along a 20-turn helix | 1e-7 | below 1e-15 (against 1e-10) | 25 ms |
| surface through 105 x 105 points, `thicken(2)` | 1e-4 / 1e-7 / 1e-10 | below 1e-15 (against 1e-10; the kernel at 1e-11: 7e-10) | 0.58 s each |

A coarse `accuracy` saves little on dense free-form faces: every knot span gets at least 7 x 7
points.

A body whose faces the kernel fits (B-spline chamfers, shells and offsets of curved faces,
sweeps cut by planes) is itself defined only to 1e-7 to 4e-6 in volume: its faces meet to
within 1e-6 to 2e-5 mm. Compare it with a formula to 1e-5; see `generic`. Beyond 1e-5 (or a
coarser `accuracy`) the result comes with a `RuntimeWarning`, once per part, which gives the
volume of the faces as they are and how uncertain it is; the integration measures that by
integrating the volume with three fields that agree only on a closed surface:

```
mass properties: the faces of this part do not meet exactly (there are gaps between them), so its
volume is uncertain by about 8e-05 of its value: integrated as the faces are, 7843.403086
```

That one is a sheet unfolded across a hole in a bend zone (true volume 7842.92). A body that
could not be integrated to `accuracy` gets "the integration reached a relative accuracy of
..., not ..." the same way.

## Gotchas

- A part made of several disjoint solids gives the properties of all of them together.
- Only `Part` has it. For a `Shell` or `Sketch` use `area` and `center()`.
- The part keeps the result: `part.volume`, `part.area`, `part.center()` and
  `mass_properties()` share one integration (also with another density, or a coarser
  `accuracy`). A copy (`named()`, a moved part) integrates again.

## Errors

- `ValueError: mass_properties: the density must be positive` for `density <= 0`.
- `ValueError: mass_properties: accuracy must be between 1e-10 and 1e-2` for any other
  accuracy (`0` included).

## Example

```python
shaft = Cylinder(10, 100)
mp = shaft.mass_properties(density=7.85e-3)     # steel, g/mm^3 -> grams
m = 7.85e-3 * math.pi * 10**2 * 100
print(round(mp.mass, 3), round(m, 3))           # 246.615 246.615
print(mp.center)                                # Vector(0, 0, 0)
izz = mp.inertia[2][2]                          # g*mm^2, about the center of mass
print(abs(izz - m * 10**2 / 2) / izz < 1e-7)    # True (3e-15)
print(mp.principal_moments)                     # ascending: about (12330.8, 211678, 211678)

precise = shaft.mass_properties(accuracy=1e-10)
print(precise.volume)                           # 31415.92653589793
```

Inertia about another point `p` (parallel axis theorem, checked on a box corner):

```python
d = p - np.array(mp.center.to_tuple())
I_p = mp.inertia + mp.mass * (d.dot(d) * np.eye(3) - np.outer(d, d))
```

## Related

`measures` (volume, area, center), `generic` (accuracy), `is_valid`
