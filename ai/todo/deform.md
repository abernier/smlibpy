# Defects and surprises: deform

## HIGH

### 1. Kernel tessellation: twisted faces get one facet across
- **Session:** `2026-10-13_01-21-12_deform-twist-taper-bend-lattice`, script `14-downstream.py`
- **What happens:** `Box(20, 20, 100).twist(90).mesh()` (default tolerance 0.105) has 68
  triangles, triangle centroids up to 0.48 mm off the surface and a volume of 42182 instead of
  40000. At `tolerance=0.01`: 0.11 mm off, volume 40607; at 0.001: 0.027 mm, 40152. The same
  face tessellated alone (`ext.face_from_surface`) is as coarse, for degree (1, 5), (3, 1) and
  (3, 3) representations alike; extra knots in the straight direction do not help. A ruled
  `loft` between a square and a turned square tessellates correctly.
- **Cause:** `SmBrep.cpp` (display tessellation) hard-codes
  `sTess.SetTessellationAlgorithm(SM_TA_FASTER_TESSELLATION)`; once the turning angles are
  small, `SmSurfaceCache` switches to `SubdivideByBlock`, which splits by row chord heights
  and never checks a block's flatness, so a face that is straight across but twisted along
  (its rulings turn) gets one facet across. Same defect as in the commercial SMLib 9
  ("kernel grid never checks its blocks").
- **Expected:** mesh within the chord tolerance.
- **Reproduce:**
  ```python
  bar = Box(20, 20, 100).twist(90)
  print(bar.mesh().volume)   # 42182.4, exact 40000
  ```
- **Workaround:** `k.tessellate(..., max_edge_length=2)` gives 0.007 mm (5060 triangles);
  `max_edge_length=-1` (automatic) 0.013 mm, but turns a plain box from 12 into 2752
  triangles. Fix belongs in the kernel (`SM_TA_FEWER_POLYGONS` or a block check).

## MEDIUM

### 2. Kernel volume integration is off on bent B-spline bodies at the default accuracy
- **Session:** same, scripts `07-bend-basic.py`, `19-doc-generic.py`
- **What happens:** `Box(100, 10, 10).bend(90).volume` is 10003.546 (default accuracy 1e-7),
  10000.000243 at `mass_properties(accuracy=1e-10)`. The face areas are exact (1000, 921.4602,
  1078.5398, 100) and a fine mesh gives 9999.997. The error does not depend on the degree or
  the knot count of the faces (cubic to degree 7, 80 to 540 poles: always 3.5e-4); the
  kernel's procedural composition (`SmSrfInVolume`) integrates 9999.875. Twisted and tapered
  bodies integrate to 1e-9 at 1e-10. Known kernel limitation (usd-brep KNOWN_ISSUES,
  "Area, volume and mass properties ...").
- **Workaround:** `mass_properties(accuracy=1e-10)` (documented in the deform guides).

### 3. `offset()` fails outward on most deformed parts
- **Session:** same, script `14-downstream.py`
- **What happens:** `Box(20, 20, 100).twist(90).offset(1)` raises `ModelingError: offset: the
  kernel could not build a valid result`; same for tapered and bent boxes and a twisted
  cylinder (both ways); a lattice-deformed box offsets fine. A ruled `loft` of a square to a
  turned square fails outward too: a kernel limit of offsetting B-spline bodies, not of the
  deformation. `shell()` works.

### 4. Self-intersection after large bends is not detected
- **Session:** same, script `09-bend-limits.py`
- **What happens:** `Box(200, 10, 10).bend(270, radius=10)` makes the legs cross, passes
  `is_valid()`, volume 20000.007. Documented as a gotcha.

## LOW

### 5. `SmBSplineVolume` is compiled out of the kernel build
- `USE_VOLUMES` is not defined, so `SmBSplineVolume::CreateCanonical` returns `SM_ERR` and its
  evaluation is empty. Lattices and tapers are evaluated in `deform.cpp` instead (the same
  Bezier volume).

### 6. `SmBrep::ApproximateWithBSplines` is not usable for deformations
- After the kernel's own `SmSpaceBend::BendTopology` style mapping (SmSrfInVolume faces), the
  B-spline conversion missed its tolerance (5.4e-4 for 1e-4 asked), produced faces with 4356
  to 8580 poles next to 76-pole twins, left some edges procedural, and on a bent bar replaced
  faces by analytic surfaces with another parameterization, rebuilt the trim curves by
  projection and returned a "valid" body of volume 6012 instead of 10000. `deform.cpp` fits the
  composition itself and keeps the trim curves.
