# Lane DA: measuring and analysis, per-bend K-factors, analytic deformations, unrolling, flat patterns of holes across bends, deformed curves and points (A2, A3, A4, A5, A6, A7, D1, D2, D3, D4, D5, D6, D7)

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
- Deformations keep analytic faces where the exact image is analytic (D2). `Box(200, 40, 10)
  .bend(90, radius=25)` had 4 B-spline faces and B-spline edges in the bend; it now has 2 exact
  cylinders about the bend axis (r 20 and 30) and 4 circles, so `faces().cylinders()`,
  `Face.radius`/`axis`, `edges().circles()` and sheet metal's `bends()` see the bend
  (`bends()` gave `[]`, `unfold()` raised "the unfolded part is 110.365 deep"). A slanted plane
  across a bend becomes a cone (a chamfered plate's chamfers, 45 degrees). `Cylinder(10, 50)
  .taper(0.5)` is an exact cone with circular rims (was 3 B-spline faces, 2 B-spline edges), a
  tapered box has planes, the turned ends of a twisted bar are planes and their rims circles, a
  rolled ring unrolls into planes and lines, and faces a map leaves in place keep their type (a
  lattice that lifts the middle of a block's top keeps the bottom and the sides planes). Faces
  whose image is not analytic (a twisted side, a hole across a bend, a bent tube with a seam) are
  fitted as before. Measured: the bent plate's volume is 79999.99999999993 (80000), its deviation
  from the exact bend 2e-13; the kernel's deviation check gives the same for every case.
  `src/cpp/deform_analytic.cpp`: the exact map is sampled on the original geometry; a similarity
  on a face or edge moves a copy of the original (same parameters, the trims stay), a cone or
  cylinder like the original about the image of its axis keeps its parameters too (a taper), and
  new planes, cylinders, cones, lines and circles get their trim curves dropped again within
  1e-8 (the kernel's `CreateUVTrimCurves` with tight edge tolerances); if a trim curve cannot be
  built, the fitted body is made instead.
- STEP files write the kernel's `SmCylinder` faces as `CYLINDRICAL_SURFACE` (D2): the cylinders
  `fold`, `flange` and now `bend` make were written as B-spline surfaces (a folded plate:
  6 `B_SPLINE_SURFACE`, 0 cylinders; now 2 `CYLINDRICAL_SURFACE` and no B-splines), and read back
  as B-splines.
- Rolled sheet metal unfolds (D3). A ring segment with no flat (90 degrees: `KernelError`
  "SM_ERR_INVALID_INPUT ... bends are separated by flat regions"), a bend at the free end of a
  sheet (a J shape, a curl; the same error) and bends over 180 degrees (a 270 degree ring:
  `ModelingError` "bends up to 180 degrees can be unfolded"; a 270 degree loop between two flats)
  now unfold at the neutral radius r + k t with the unbend deformation: the 90 degree segment (R50,
  t 2) to 79.9221 x 40, the 270 degree ring to 239.766 x 40, a 30 mm leg with a 90 degree end bend
  to 109.922 with the leg in place, a 100 mm plate with a 270 degree curl (R10, t 2) to 151.271.
  K-factors per bend apply as for other bends. Bends up to 180 degrees with flat sheet on both
  sides still go through the kernel's unbend, unchanged.
- A hole across a bend is one circle in the flat pattern again (D5). `flat_pattern(part).outline`
  of a 100 x 40 x 2 plate folded (R2, 90 degrees) across a hole of r 4 had the hole as 3 arcs and
  2 B-splines, 1.8e-5 off its circle (awkward for DXF and CAM, which treat splines as free
  contours); it is one circle now (4 lines and 1 circle, area 4000 - 16 pi to 1e-12), and an
  oblique cut across a bend is one line. In the outline, pieces that are lines or arcs within
  1e-6 mm become lines and arcs, and arcs of one circle that follow each other become one arc
  (a whole loop one circle); spline cutouts stay splines. The edges of the bend zone are fitted
  within 1e-7 of the exact bend now (`src/cpp/sheetmetal.cpp`: the kernel's exact lines and arcs
  where it has them, else deform.cpp's parameter-keeping fit, quintic, on the original's knots;
  they were the kernel's approximations within 1e-4: 1.2e-6 off a line across a bend):
  the hole's edges after a fold and an unfold are 5e-13 off its circle, with 25 control points
  bent and 11 flat. The faces of the bend zone stay the kernel's 1e-4 fits (see Not done).
- `unfold` and `flat_pattern` of a part with holes wholly inside a bend zone (two holes of r 6 in
  an R20, 120 degree bend of a 200 x 60 x 3 plate) raised `ModelingError: unfold: the unfolded
  part is 3.37494 deep across the fixed face` (a regression of the 0.5.0 work: 0.4.0 unfolded it,
  with the holes as B-splines in the outline): the kernel's tight box of a fitted hole wall reaches
  0.19 mm past its edges. The depth check, the flat pattern's placement and `FlatPattern.size`
  measure the edges now: the outline is 4 lines and 2 circles (r 6 to 4e-9), the flat's bottom
  at z = 0, its size 200 x 60 x 3 (the box said 3.375 deep).
- The deform guides no longer teach `mass_properties(accuracy=1e-10)` for deformed parts (D4):
  `part.volume` is smlibpy's own integration (`measure.cpp`) and exact on them (a bar bent 90
  degrees: 10000.000000000002; the guides said 10003.546). docs/deform.md, the skill references
  (deform/generic, bend, twist, taper, Lattice, recipes/deform) and `ai/todo/deform.md` #2 (fixed).

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
- `unroll(shape, *, radius, axis=Z, start=None, tolerance=None)` and `Part.unroll(...)` (D3): lay a
  part wrapped around an axis out flat, the inverse of `bend`: a point at distance r and angle a
  from `start` goes to distance r and `radius * a` across; the layer at `radius` keeps its length.
  The default `start` is the middle of the part's angle about the axis; parts that reach the
  axis, go all the way around it or reach the half-plane opposite `start` raise `ModelingError`.
  A 270 degree ring (R50 to 52) unrolled at 51: 6 planes, the volume to 1e-12. TypeScript:
  `unroll(shape, { radius, axis, start, tolerance })`, `part.unroll({ radius })`.
- A plate bent with `Part.bend` keeps the K-factor of its neutral layer (D2): where the plane's
  origin lies in the thickness (0.5 for a plate bent about its middle layer), recorded like
  `fold`'s, so `unfold()` gives the plate back (200 x 40 x 10 for the plate above; with the
  default 0.44 it was 199.058).
- `bend_allowance` takes angles up to below 360 degrees (a rolled part's 270).
- `_core.deform`: an `unbend` piece (`SmUnbendVolume`, with an optional rigid `matrix` after it),
  a spec key `faces` (the piece of every face, where the caller decides) and `analytic` (False:
  NURBS everywhere, as before); the report has `faces_analytic` and `edges_analytic`. Docs:
  docs/deform.md (Exact results, Bend, Unroll), docs/sheet-metal.md (rolled parts, curls, bends
  over 180 degrees, limits), skill reference `deform/unroll`, updated `sheetmetal/unfold`, `bends`,
  `bend_allowance`, `generic`.
- Edges, wires and points deform (D6): `twist`, `taper`, `bend`, `unroll` and `Lattice.apply` take
  an `Edge` (result: an `Edge`), a `Wire` (a `Wire`), a point (a `Vector`, or 2 or 3 numbers;
  result: a `Vector`) or a list of points (a list of `Vector`s), and move them exactly as they
  move a part: deform a path and sweep along it, or follow a point of a part through a
  deformation. Every edge is split where it crosses `start` and `end`; a `Wire` gets an edge for
  every piece (`bend(Wire([Line((-50, 0, 0), (50, 0, 0))]), 90, radius=10)`: a line of 42.146,
  an exact arc of r 10 and a line), an `Edge` stays one edge (its pieces joined into one
  B-spline). Pieces whose image is a line or circle are exact lines and arcs (a circle about a
  taper's axis stays a circle, a helix of 0.4 turn unrolls into a line), pieces under lattices
  and tapers exact B-splines, the others (a line off a twist's axis: a helix) within
  `tolerance`. Points have no length along the axis: twist, taper and bend without a radius need
  `start` and `end` for them (`ValueError ... give start and end for points` otherwise); points
  before `start` stay, points beyond `end` move as the part's end does. This is the plan's
  public point map for every deformation (`Lattice.map(point)` was the only one); there is no
  separate `map_point` function. C++: `_core.deform.deform_curve(curve, spec)` ->
  `(curves, report)` (`src/cpp/deform.cpp`; the edges' fitter and analytic images, with the
  curve split where it crosses the ends of the pieces), TypeScript `k.deform.deform_curve`;
  `smlibpy::fit_curve_keeping_parameters` (deform.h), which sheet metal uses for D5. Docs:
  docs/deform.md (Curves and points), skill reference `deform/curves`; `deform/generic`,
  `twist`, `taper`, `bend`, `unroll`, `Lattice`, `recipes/deform` mention it.
- The Lattice docs say what a lattice is (D7): a global map, every point of it pulls the whole
  box (Bernstein weights; a 7 x 7 x 2 lattice's middle top point moved by 5 lifts the middle by
  0.49 and a place 25 mm away by 0.014), more points concentrate the pull but never confine it;
  the tool for overall shape, not for a bump on one face. They said "single points for local
  ones; more points give more local control" (docs/deform.md, `deform/Lattice`, the `Lattice`
  docstrings in both languages). Faces a lattice leaves in place keep their type (done with D2).
- New exports: `ClosestPoints`, `Continuity`, `Curvature`, `NurbsSurface`, `SectionProperties`,
  `unroll` (TypeScript also `type KFactor`, `UnrollOptions`).

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
| `bend`, `taper`, `twist`, lattices: faces and edges whose exact image is analytic | `geom_type` `"plane"`, `"cylinder"`, `"cone"`, `"line"`, `"circle"` (or the original's type where the map moves them like a rigid body or scales them evenly) | `"bspline"` |
| the same faces: their parameters (`Face.position_at`, `uv_at`, `nurbs()`, `isocurve`) | those of the analytic surface (a cylinder's angle and height) | the original face's |
| `bends()` / `unfold()` of a plate bent with `Part.bend` | the bend, unfolded with the K of the neutral layer | `[]` / `ModelingError` |
| `deform` report (`_core.deform.deform_brep`) | analytic faces count as `faces_exact`, plus `faces_analytic`, `edges_analytic` | they were `faces_approximated` |
| `_core.deform.deviation` on analytic faces and edges | the distance of the exact image from the face or curve | the distance at the same parameters |
| STEP export of `fold`/`flange`/`bend` cylinders | `CYLINDRICAL_SURFACE` | `B_SPLINE_SURFACE_WITH_KNOTS` (rational) |
| `bends()` of a ring segment over 180 degrees | `Bend(angle=270, ...)` | `ModelingError` "bends up to 180 degrees can be unfolded" |
| `unfold`/`flat_pattern` of rolled parts, end bends, bends over 180 degrees | the flat part | `KernelError` / `ModelingError` |
| `unfold(part, fixed=...)` of a rolled part (one bend, no flat) | `ValueError` (it unrolls about the bend's middle) | `KernelError` |
| `bend_allowance(angle)` for 180 < angle < 360 | the allowance | `ValueError` |
| `flat_pattern(...).outline` where pieces crossed a bend | lines, arcs and circles (fitted pieces within 1e-6 of a line or arc converted, arcs of one circle merged): a hole across a bend is 1 circle | arcs and B-splines: 3 arcs and 2 B-splines |
| edges of a bend zone (`fold`, `flange`, `unfold`, `flat_pattern`) that cross it | quintic B-splines within 1e-7 of the exact bend (`Edge.nurbs()`: degree 5, 25 control points for a hole's arc), exact lines and arcs where the kernel makes them | the kernel's cubic approximations within 1e-4 (25 to 49 control points) |
| `unfold`/`flat_pattern` of a part with holes inside a bend zone | the flat part and its outline | `ModelingError ... deep across the fixed face` (a regression of the 0.5.0 work only) |
| `FlatPattern.part` placement and `FlatPattern.size` | by its edges: its bottom face at z = 0, `size.z` the thickness | by its box, which fitted faces could make deeper |
| `twist`, `taper`, `bend`, `unroll`, `Lattice.apply` of an `Edge`, a `Wire` or points | the deformed edge, wire or points | `TypeError: expected a Part or a Shell` |
| their `TypeError` for other inputs | `... expected a Part, a Shell, an Edge, a Wire or points, got ...` | `... expected a Part or a Shell, got ...` |
| a lattice that folds the part | `... a point was moved past its neighbours. Move the points less` | `... Move the points less, or use more points for local changes` |

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

Analytic deformation results (D2):

```python
# before: every bent face was a B-spline; scripts selected them by type
bent = Box(200, 40, 10).bend(90, radius=25)
bend_faces = bent.faces().filter(lambda f: f.geom_type == "bspline")   # was 4, now []
# now: the bend's faces are cylinders (and a chamfer's cones)
bend_faces = bent.faces().filter(lambda f: f.geom_type in ("cylinder", "cone", "bspline"))
# or select by place rather than type
bend_faces = bent.faces().filter(lambda f: not f.is_planar)

# before: Face.nurbs()/position_at(u, v) of a bent face used the plate's parameters;
# now those of the cylinder. Use points rather than parameters:
p = bend_faces[0].position_at(0.5, 0.5)   # still a point on the face, at other (u, v)

# the old results, NURBS everywhere (for comparisons with stored data):
from smlibpy import deform as D
from smlibpy._kernel import k
plan = D._plan_bend(Box(200, 40, 10), 90, 25, Plane.XZ, None, None, 1e-6)
brep, report = k.deform.deform_brep(plan.shape._brep, dict(plan.spec, analytic=False))

# before: a Part.bend plate unfolded with 0.44 (199.058 long); now with its own K (200.0)
flat = bent.unfold(k_factor=0.44)   # the old numbers
```

```javascript
// before: the bend's faces were 'bspline'
const bent = Box(200, 40, 10).bend(90, { radius: 25 })
bent.faces().filter((f) => !f.isPlanar)   // select by shape, not by type
bent.unfold({ kFactor: 0.44 })            // the old (0.44) numbers
```

Flat patterns, deformed curves (D5, D6):

```python
# before: a hole across a bend came back as arcs and B-splines; scripts collected both
hole_pieces = [e for e in pattern.outline.edges() if e.geom_type in ("circle", "bspline")]
# now: one circle per hole (and lines for straight cuts); select circles
holes = pattern.outline.edges().circles()

# before: deforming an edge raised TypeError; scripts sampled the part instead
try:
    rail = twist(edge, 90)
except TypeError:
    rail = None
# now it returns the twisted Edge; to keep refusing curves, check first
if isinstance(edge, (Edge, Wire)):
    ...
```

```javascript
// a hole across a bend: one circle in the outline
const holes = flatPattern(part).outline.edges().circles()
// edges, wires and points deform (were TypeError)
const path = bend(new Wire([Line([-50, 0, 0], [50, 0, 0])]), 90, { radius: 10 })
const tip = twist([10, 0, 100], 90, { start: 0, end: 100 })
```

Rolled parts (D3):

```python
# before: bends() raised for a 270 degree ring; unfold raised for rolled parts and curls
try:
    flat = ring.unfold()
except (KernelError, ModelingError):
    flat = None
# now it unfolds; to keep refusing them, check first
if any(b.angle > 180 for b in ring.bends()):
    ...
# before: bend_allowance(270, ...) raised ValueError; now it is the 270 degree strip's width
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
- D2: no torus or sphere images: a bent tube (a cylinder along the bend) is a torus in the bend,
  but its face has a seam, and a face with a seam keeps its fitted surface (a new seam would not
  lie where the old one was); the same for a cylinder twisted about its own axis. Spheres and tori
  stay analytic only where a map moves them like a rigid body or scales them evenly. Edges whose
  image is a line or circle stay fitted when a fitted face uses them (a trim curve dropped onto a
  fitted face would be less exact than the original one). Not done: the kernel's
  `SmBendVolume::MakeExactBSpline1stOutSurface/Curve` (the plan's first idea); smlibpy's own
  recognition by sampling covers its cases (planes to cylinders, radial planes, planes across the
  axis, lines to lines and circles) and more (cones from slanted planes, tapers, twists, lattices,
  unrolls), without its known defects (`ai/todo/sheetmetal.md` #3, #7).
- D3: a bend at a free end, a bend over 180 degrees and a rolled part must run the full width of
  the sheet next to them (no sheet beside the bend along its axis); a part with more than one bend
  needs flat sheet on at least one side of each; a rolled part unrolls about the middle of its
  bend (`fixed=` refused). Faces whose box reaches near the unroll axis fit slowly if their new
  analytic geometry cannot be trimmed (the fallback; not seen in the tests).
- D5: the faces of a bend zone (a hole's wall across a bend) stay the kernel's fits within 1e-4,
  so the round trip keeps the volume to 2e-7 as before (7899.4672 for 7899.4690); its 1e-6 surface
  fits cost up to twenty times as long (7.2 s instead of 0.34 s to unfold the R20 bend above),
  and deform.cpp's surface fitter is not wired into sheet metal (it would have to keep the faces'
  trims through the kernel's bend, as deform.cpp does for whole Breps). The outline's circles are
  exact; the flat part's hole walls are the 1e-4 fits.
- D5: a hole wholly inside a bend zone unfolds into the right flat pattern, but the unfolded
  part's `is_valid()` is False ("open between its faces, so that its volume is uncertain by
  2.0e-02"): the volume integrated with the x and y fields disagrees with the z field, so the
  kernel's unbend probably leaves a hole wall whose trims do not follow its surface (not
  investigated further). The same on the P0 base; origin/next called it valid only because
  `is_valid` had no gap measure.
  `FlatPattern.part.bbox()` of such parts is deeper than the sheet (the kernel's tight box of the
  fitted wall); its edges and the outline are right.
- D6: there is no `map_point` function per deformation; the deformation functions take points
  (and `Lattice.map(point)` stays). Lattices are not checked for folding on curves and points.
  An `Edge` that crosses `start` or `end` comes back as one joined B-spline (pass
  `Wire([edge])` for exact lines and arcs).
- D7: the pointer to a face push (U7's `Part.push`) is not in the docs: U7 is not on this
  branch. The merge stage should add it where the Lattice sections of docs/deform.md and
  `deform/Lattice` (and `recipes/deform`) now say "for a bump on one face, model it directly".
  `SmBSplineSurface::DegreeReduction` (the plan's optional idea) is not used: the exact lattice
  fit already takes the smallest degrees that reproduce the image (`fit_exact_surface` bisects
  them), so a reduction could only approximate.
