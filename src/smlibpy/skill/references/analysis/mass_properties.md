# mass_properties

Mass, volume, area, center of mass and inertia tensor of a `Part`, in one integration.

## Signature

`part.mass_properties(density=1.0, accuracy=None) -> MassProperties`

- `density`: mass per mm³, uniform. `7.85e-3` (steel, g/mm³) gives grams and g·mm².
- `accuracy`: relative accuracy of the integration. `None` (and `0`) mean the default 1e-7.

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

Checked against formulas at the default accuracy: box exact; cylinder, cone, sphere, torus
volume and inertia to 1e-7 to 4e-7; the center lies within about 1e-6 of the exact point
(3e-6 for a cylinder 100 long). The same body rotated or moved to 1e6 gives the same numbers.

| `accuracy` | sphere volume error | time (sphere) |
|---|---|---|
| 1e-4 | 9e-5 | 3 ms |
| 1e-7 (default) | 2e-7 | 28 ms |
| 1e-8 | 1.5e-8 | 47 ms |
| 1e-10 | 3e-10 | 185 ms |

Swept bodies are slower and worse: a 20-turn spring takes 0.14 s at the default and 3.4 s at
1e-10; a triangle swept along a helix is 1.4e-5 off at the default, 5e-7 at 1e-9 and 1e-7 at
1e-10. Ask for `accuracy=1e-10` when a swept volume must be exact.

## Gotchas

- `density <= 0` is silently replaced by 1: `mass_properties(density=0).mass` equals the
  volume. Pass a positive density.
- Too tight an accuracy fails: 1e-12 on a sphere and 1e-14 on anything raise
  `KernelError: mass properties failed (SM_ERR): is the part a closed solid?`. The hint is
  misleading; the part is fine, the accuracy is too small. Stay at 1e-10 or above.
- `accuracy=1` or `0.5` is accepted and returns a volume 2 % off.
- A part made of several disjoint solids gives the properties of all of them together.
- Only `Part` has it. For a `Shell` or `Sketch` use `area` and `center()`.
- `part.volume`, `part.area` and `part.center()` each run the full integration again at the
  default accuracy. One `mass_properties()` call is cheaper when you need several.

## Errors

- `KernelError: mass properties failed (SM_ERR): is the part a closed solid?` for an accuracy
  below about 1e-11 or a negative one. Use 1e-10.

## Example

```python
shaft = Cylinder(10, 100)
mp = shaft.mass_properties(density=7.85e-3)     # steel, g/mm^3 -> grams
m = 7.85e-3 * math.pi * 10**2 * 100
print(round(mp.mass, 3), round(m, 3))           # 246.615 246.615
print(mp.center)                                # about (0, 0, 0), off by up to 3e-6
izz = mp.inertia[2][2]                          # g*mm^2, about the center of mass
print(abs(izz - m * 10**2 / 2) / izz < 1e-6)    # True
print(mp.principal_moments)                     # ascending: about (12330.8, 211678, 211678)

precise = shaft.mass_properties(accuracy=1e-10)
print(precise.volume)                           # 31415.9265...
```

Inertia about another point `p` (parallel axis theorem, checked on a box corner):

```python
d = p - np.array(mp.center.to_tuple())
I_p = mp.inertia + mp.mass * (d.dot(d) * np.eye(3) - np.outer(d, d))
```

## Related

`measures` (volume, area, center), `generic` (accuracy), `is_valid`
