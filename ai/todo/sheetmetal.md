# TODO: sheetmetal

Defects found while building `smlibpy.sheetmetal` on usd-brep 1.0.0. All are worked around in
`src/cpp/sheetmetal.cpp` (it redoes the kernel's bend and unbend drivers with the kernel's own
steps); they belong upstream.

## HIGH

### 1. `SmSpaceBend::DoSpaceBend` bends nothing
- **What happens:** the "workaround to appease Linux gcc" (`SmSpaceBend.cpp` around line 400)
  passes an empty `sTopology` to `SmTopologyTraverser::GetSubTopologies`, which returns at once,
  then empties `sInFaces` and refills it from the empty list. No face is bent; the whole body is
  only turned by the bend angle.
- **Expected:** fill `sTopology` from `sInFaces` (as `SmSpaceUnbend.cpp` does) and keep the face
  list.

### 2. `SmSpaceUnbend::DoSpaceUnbend` maps the bend region twice
- **What happens:** it loads the region's faces into a second list and passes `&sInFaces` as the
  output too, with `bReSetArrays = FALSE`: every face is listed twice and unbent twice (a wrong
  body: volume 7841.49 for a plate of 8000; with other input a crash).
- **Expected:** a separate output list (or the faces once).

### 3. `SmBendVolume::MakeExactBSpline1stOutSurface` puts bend cylinders at the axis point
- **Not used for deformations (kernel plan D2):** `bend`, `taper` and the other deformations
  recognize analytic images by sampling the exact map (src/cpp/deform_analytic.cpp), which has
  neither this defect nor #7.
- **What happens:** it computes `sCylinderOrigin = sBendOrigin + min * sBendAxis` but passes
  `sBendOrigin` to the `SmCylinder` constructor: the cylinder covers [0, length] from the axis
  point instead of the face (a plate bent along an axis point at its middle got faces 20 mm off,
  volume 7826.58 instead of 8015.08).
- **Workaround:** the cylinder is moved along its axis onto the face's edges.

### 4. Lazily built NURBS data crashes `SmPlane::DropCurve`
- **What happens:** the exact lines, arcs and planes made for a bend region build their NURBS
  data only when asked; `SmPlane::DropCurve` copies such a curve with the `SmBSplineCurve` copy
  constructor and `GetCanonical` reads the missing data: segfault when trim curves are built later
  (volume, interior point). Seen for radii below about 0.16 times the thickness and for a bend
  whose zone overlaps another bend.
- **Reproduce (before the workaround):** `unfold(bend(Box(100, 40, 2, align=(...MIN)), Axis((0, 0, 2), (0, 1, 0)), 90, radius=0.3))`.
- **Workaround:** `GetOrCreateGwNurbPointer()` on every new curve and surface of the region.

## MEDIUM

### 5. The unbend region ignores the start of the interval
- `SmSpaceUnbend::GetUnbendDomain` starts the cylindrical box at the axis point, while the bend
  domain uses `interval.Evaluate(0)`. An unbounded interval (`SmExtent1d::Init`) evaluates to
  `SM_BIG_DOUBLE` in both. **Workaround:** axis point at the start, interval [0, length].

### 6. `ApproximateWithBSpline` reports success when it replaces nothing
- `SmFace::ApproximateWithBSpline` and `SmEdge::ApproximateWithBSpline` return `SM_SUCCESS` when
  their constrained approximation fails, leaving `SmSrfInVolume` / `SmCrvInVolume` geometry in the
  body (the bent arc of a hole across a bend). **Workaround:** `SmCurve::ApproximateCurve` keeping
  the parameterization.

### 7. The exact bend surface samples the surface's UV box, not the face
- **Not used for deformations (kernel plan D2):** see #3.
- `MakeExactBSpline1stOutSurface` samples the whole UV box of the (shrunk) surface; for a strip
  cut obliquely by the outline the box reaches outside the bend's primary period and no cylinder
  is made (the face stays a volume surface or a NURBS). **Workaround:** the region's planar faces
  get a plane parameterized along the bend before mapping.

### 8. Volume integration of unbent NURBS faces is unstable
- A plate with a hole across a bend, bent and unfolded: `brep_properties` gives 28600.9 / 10066.6 /
  7868.6 / 7842.06 / 7843.37 for accuracy 1e-3 / 1e-5 / 1e-7 / 1e-9 / 1e-10; a fine mesh gives
  7842.936 (exact 7842.920). `sheetmetal` checks such bodies with a mesh.

## LOW

### 9. The bend region reaches a fixed 0.1 past the sheet
- `dDelta = 0.1` (model units) in both domains: an inside radius of 0.1 or less cannot be
  unfolded (`SM_ERR_INVALID_INPUT`). smlibpy asks for at least 0.11.
