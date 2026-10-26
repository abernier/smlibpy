# section_properties

Area, centroid and second moments of area of a sketch: the section properties of a beam's,
frame's or extrusion's profile.

## Signature

`sketch.section_properties() -> SectionProperties`

## Returns

| Member | Meaning |
|---|---|
| `area`, `centroid` | mm², a `Vector` in world coordinates |
| `plane` | the sketch plane moved to the centroid: the axes the moments are about |
| `ixx`, `iyy`, `ixy` | integral of y², x² and x·y over the area about the centroid, in `plane`'s axes (mm⁴) |
| `polar` | `ixx + iyy` (the torsion constant only of circles and rings) |
| `principal_moments`, `principal_axes` | ascending, with their in-plane directions |
| `radii_of_gyration` | `(sqrt(ixx / area), sqrt(iyy / area))` |
| `section_moduli` | `(ixx / c_y, iyy / c_x)`, `c` from the centroid to the farthest fiber: the smaller modulus of an unsymmetric section |

## Accuracy

Integrated as the mass properties of a thin slab of the region (to 1e-7 of the largest moment,
1e-12 measured on rectangles), less the slab's own thickness term.

## Gotchas

- The axes are the sketch plane's (`plane.x_dir`, `plane.y_dir`): a rectangle `Rectangle(40, 20)`
  has `ixx = 40 * 20**3 / 12` (about the x axis). On another plane, `on(plane)` decides x.
- `ValueError` for an empty sketch.

## Example

```python
sp = Rectangle(40, 20).section_properties()
print(round(sp.ixx, 6), round(sp.iyy, 6))          # 26666.666667 106666.666667
print([round(s, 6) for s in sp.section_moduli])    # [2666.666667, 5333.333333]
angle = Rectangle(30, 5, align=Align.MIN) + Rectangle(5, 40, align=Align.MIN)
sa = angle.section_properties()
print(sa.centroid, [round(m, 1) for m in sa.principal_moments])   # Vector(8.26923, 13.2692, 0) [13276.7, 61442.9]
```

## Related

`mass_properties`, `measures`
