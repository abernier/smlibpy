# Lane DA: measuring and analysis, per-bend K-factors (A2, A3, A4, A5, A6, A7, D1)

Everything applies to smlibpy (Python) and smlibwasm (JavaScript, camelCase names) alike.

## Fixed

- A body with a face that crosses the seam of its own surface no longer runs `volume`, `area`,
  `center()`, `mass_properties()` or `Face.area` for minutes (A7): the integration gives each face
  a budget of surface points (2 million plus 4000 per knot span, more for accuracies below 1e-8;
  a sound dense face of 46,000 spans takes 7 million), and a face that runs out and crosses its
  seam raises `KernelError` ("face 0 of the body crosses the seam of its surface ...") in about a
  second. No public operation makes such a face (the review built one through private internals:
  an imported O-ring with its window turned half round ran over 240 s); any other face that runs
  out gives its result with the existing "did not reach the accuracy" warning. `ext.brep_measure`
  and `ext.face_measure` report `exhausted`.
- A fold round trip is lossless (D1): a blank folded at R1 with K 0.33 and at R6 with K 0.45
  unfolded to 199.623 or 200.377 with any single K; `flat_pattern(part)` now gives 200.0.
- `smooth()` and `Edge.convexity` look along the whole edge (A4): an edge whose faces meet
  tangentially only at its middle (an angle running from -14 through 0 to +14 degrees along it)
  was "smooth"; it is now "convex" or "concave" where its faces turn most.

## New

- Closest points (A2): `Part/Shell/Sketch.closest_points(other)` gives a `ClosestPoints` named
  tuple (`point`, `other_point`, `distance`, `face`, `other_face`) for another body, a `Face`, an
  `Edge` or a `Wire`; `distance_to` takes faces, edges and wires, and `Edge/Wire/Face.distance_to`
  takes a body. Curves go through a new `ext.nearest_curve_points` (Newton on the curve's and the
  face's parameters, as `ext.nearest_points`, which now also returns the faces). Also
  `Face.closest_point`, `Face.uv_at` (fractions of the face's parameter box),
  `Face.position_at(u, v)`, `Edge.closest_point`, `Edge.param_at_point` (the fraction `point_at`
  takes), `Wire.closest_point`.
- Curvature and surface access (A3): `Face.curvature_at(point=None)` (`Curvature`: `k1`, `k2`,
  `dir1`, `dir2`, `normal`, `point`, `mean`, `gaussian`; exact, also at a sphere's pole),
  `Face.min_radius()`, `Face.nurbs()` (`NurbsSurface`: degrees, knots, control points in rows by
  u, weights), `Face.isocurve(u=, v=)` (the kernel's iso curve, clipped to the face where its
  boundary crosses it in the parameter plane), `Face.major_radius`, `Face.cone_angle`,
  `Edge.curvature_at(t)`. C++: `ext.face_curvature`, `ext.face_min_radius`, `ext.face_iso_curves`
  (src/cpp/face_analysis.cpp).
- Continuity (A4): `Edge.continuity(samples=16, *, angle_tol=0.5, curvature_tol=0.01)` and
  `Wire.continuity(...)` give a `Continuity` (`level` "G0"/"G1"/"G2"/None, `gap`, `angle`,
  `curvature_jump`, `point`); `ShapeList.g1()` and `g2()` select by it. smlibpy's own measure
  (`ext.edge_continuity`): the kernel's `SmEdge::GetContinuity` compares a normal with itself in its
  G2 test and calls the creases of a G2 blend discontinuous. A circular fillet's border is G1
  (curvature jump 0.2 for r 5), a `continuity="G2"` blend's G2 (7e-9).
- Section properties (A5): `Sketch.section_properties()` gives `SectionProperties` (`area`,
  `centroid`, `plane`, `ixx`, `iyy`, `ixy` about the centroid in the sketch plane's axes,
  `polar`, `principal_moments`, `principal_axes`, `radii_of_gyration`, `section_moduli`), to 1e-9
  of the textbook values for rectangles, plates with holes and angles.
- Mass properties (A6): `MassProperties.inertia_about(point)`, `moment_about(axis)`,
  `radii_of_gyration`.
- K-factors per bend (D1): `fold` and `flange` record their K-factor on the part (kept through
  Booleans, moves and `named()`), and `unfold`, `flat_pattern` and `bends` take it. Their
  `k_factor=` also takes a function `(radius, thickness, angle) -> k`, a mapping from inside
  radius to k, `(r / t, k)` pairs (interpolated) and `"din6935"`
  (`smlibpy.sheetmetal.din6935(r, t)`, the type `KFactor`). `Bend.k_factor` is each bend's own.
- New exports: `ClosestPoints`, `Continuity`, `Curvature`, `NurbsSurface`, `SectionProperties`
  (TypeScript also `type KFactor`).

## Behaviour changes

| Where | Now | Before |
|---|---|---|
| `unfold`, `flat_pattern`, `bends` without `k_factor=` on a part made with `fold`/`flange` and a K-factor other than 0.44 | each bend's own K-factor: the blank folded | 0.44 for every bend |
| `k_factor=` default of `unfold`, `flat_pattern`, `bends`, `Part.unfold/flat_pattern/bends` | `None` (as folded, else 0.44) | `0.44` |
| `FlatPattern.k_factor` | `None` when the bends' K-factors differ; repr `k_factor=per bend` | always the number given |
| `Bend` repr | shows `k_factor=` | did not |
| `part.distance_to(edge)` (also wire, face) | the distance | `TypeError` |
| `smooth()`, `convex()`, `concave()`, `Edge.convexity` on an edge tangent at its middle but not along it | "convex" or "concave" | "smooth" |
| `volume` and the other measures of a body with a face across its seam | `KernelError` after about a second | ran for minutes |

Migration:

```python
# before: the default K (0.44) for every bend, whatever fold used
pattern = flat_pattern(part)
# now the same numbers as before: pass the old default
pattern = flat_pattern(part, k_factor=0.44)

# before: FlatPattern.k_factor was a number
print(f"{pattern.k_factor:g}")
# now: None where the bends differ; take each bend's
print([b.k_factor for b in pattern.bends])

# before: try: part.distance_to(edge) except TypeError: (sample the edge)
d = part.distance_to(edge)   # now exact
```

```javascript
// before: flatPattern(part) used kFactor 0.44 for every bend
flatPattern(part, { kFactor: 0.44 })   // the old numbers
```

## Not done

- `Face.parameters(point)` (A3's name) is `Face.uv_at(point)` (A2's), one method for both.
- C2's `Edge.param_at(point)` is `Edge.param_at_point(point)` here (build123d's name, as A2 has
  it); C9's `Edge.curvature_at` is this lane's, without `radius_at`, `min_radius` or
  inflections of edges (C9's lane). C12's `Face.iso` is `Face.isocurve` here.
- D1: a record is matched by its bend's axis, then by its inside radius; two bends of one radius
  folded with different K-factors, one of which a later fold moved, raise `ModelingError` asking
  for `k_factor=`. The record is not written to files (`.smb`, STEP): a part read back unfolds
  at 0.44.
- A7: the budget stops any face the integration cannot converge on; only the crossed seam has a
  public message, and no public input is known that makes one.
