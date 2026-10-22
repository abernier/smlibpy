# Defects and surprises: surfaces

## HIGH

### 1. `Shell.thicken`: a closed grid surface gives a zero-volume Part that `is_valid()` accepts
- **Fixed:** thicken checks its result and raises ModelingError with a hint.
- **Session:** `2026-10-12_21-26-58_surfaces-surface`, scripts `07-thicken-check.py`, `08-closed-thicken.py`, `10-repro.py`
- **What happens:** `surface()` of rings (first point == last point) is a closed tube. `thicken(±1)`
  returns a Part with volume ~0 (faces: the original face plus three faces of area 0.0) and
  `is_valid()` True. Repeating the same call sometimes raises `KernelError: thicken failed (SM_ERR)`
  instead: the result is not deterministic. A revolved tube (`revolve(Line(...), Z)`) thickens
  correctly (1979.204 vs 1979.203 exact).
- **Expected:** a tube wall of volume π((R+t)²−R²)·H, or an error.
- **Reproduce:**
  ```python
  ring = lambda z: [(10 * math.cos(a), 10 * math.sin(a), z) for a in np.linspace(0, 2 * math.pi, 25)]
  tube = surface([ring(z) for z in (0, 10, 20, 30)])
  p = tube.thicken(-1)
  print(p.volume, p.is_valid())   # -0.000248 True
  ```
- **Workaround:** build closed shapes with `revolve`/`loft`/`extrude` of curves, or from two open
  halves; always check `volume > 0` after `thicken`. smlibpy could check the volume of the result
  (and its sign) and raise.

## MEDIUM

### 2. `Shell.thicken`: a failed offset comes back as an invalid zero-volume Part without an error
- **Fixed:** same check: ModelingError instead of a volume-0 part.
- **Session:** `2026-10-12_21-26-58_surfaces-surface`, scripts `06-dome-thicken.py`, `10-repro.py`
- **What happens:** a dome from `surface()` with a pole (last row all the same point) thickened
  outward returns a Part with volume 0.0 and `is_valid()` False; no exception. Inward it raises
  `KernelError SM_ERR`. A band without a pole (0..80°) does the same outward (volume 0, invalid).
- **Expected:** `KernelError` (as for the other direction), or a correct wall.
- **Reproduce:**
  ```python
  rows = [[(10 * math.cos(b) * math.cos(a), 10 * math.cos(b) * math.sin(a), 10 * math.sin(b))
           for a in np.linspace(0, 2 * math.pi, 13)] for b in np.linspace(0, math.pi / 2, 7)]
  p = surface(rows).thicken(-1)
  print(p.volume, p.is_valid())   # 0.0 False
  ```
- **Workaround:** check `p.is_valid() and p.volume > 0` after `thicken`.

### 3. `surface`: needs at least 4 x 4 points; the docstring says 2 x 2 and the error has no hint
- **Fixed:** the docstring says 4 x 4, smaller grids raise ValueError with a hint to use ruled().
- **Session:** `2026-10-12_21-26-09_surfaces-workflow`, script `03-surface-probe.py`
- **What happens:** 2x2, 3x3 and 4x3 grids (flat or curved) raise `KernelError: surface failed (SM_ERR)`;
  with `interpolate=False` `SM_ERR_INVALID_INPUT`. 4x4 works. The surface is always bicubic.
- **Expected:** the docstring states the real minimum, and smlibpy checks it with a clear
  `ValueError` (or lowers the degree for small grids).
- **Reproduce:** `surface([[(x, y, 0) for x in (0, 1, 2)] for y in (0, 1, 2)])`
- **Workaround:** use at least 4 x 4 points; for a four-sided bilinear patch use `ruled` between
  two lines.

### 9. `stitch`: `tolerance` does not do what the docstring says; with it the result is a sewn Shell, not a Part
- **Session:** `2026-10-12_21-33-28_surfaces-stitch`, scripts `02-gaps.py`, `03-gap-scale.py`, `04-gap-limit.py`, `05-tolerance-workaround.py`
- **What happens:** the first step (`stitch_into_solid`) ignores `tolerance` and closes gaps up to
  about 0.35 % of the bbox diagonal (10 mm cube: 0.06 yes, 0.07 no; 1 mm cube: 0.005 yes, 0.01 no).
  A smaller `tolerance` cannot make it stricter. For larger gaps, `tolerance` ≥ gap sews every edge
  (0 free edges) but the body is not manifold, so `stitch` returns a Shell. `stitch(result)` or
  `stitch(result.heal())` then gives a valid Part.
- **Expected:** `tolerance` is the largest gap closed (docstring: default 1e-4 of the model size),
  and a body sewn shut with it comes back as a Part.
- **Reproduce:**
  ```python
  box = Box(10, 10, 10)
  ps = [f.to_shell() for f in box.faces() if f.normal_at().z < 0.5] + [box.faces().top()[0].to_shell().translate(0, 0, 0.1)]
  r = stitch(ps, tolerance=0.2)
  print(type(r).__name__, sum(1 for e in r.edges() if len(e.faces()) == 1))   # Shell 0
  print(type(stitch(r)).__name__)                                               # Part
  ```
- **Workaround:** `stitch(stitch(pieces, tolerance=t))`.

### 10. `stitch`: gaps are hidden in tolerances; the "valid" Part has faces away from their edges
- **Session:** `2026-10-12_21-33-28_surfaces-stitch`, scripts `05-tolerance-workaround.py`, `06-gap-body.py`
- **What happens:** a cube whose top face floats 0.5 mm above the side faces, stitched with
  `tolerance=1` (and stitched again): `is_valid()` True, volume 1050 (face at z 5.5), but all vertices
  and `bbox()` at z 5.0. STEP export keeps the inconsistent body. Nothing warns.
- **Expected:** stitch reports the largest gap it closed (the kernel returns `max_vertex_gap` and
  `max_edge_gap`), or refuses gaps larger than the modeling tolerance unless asked.
- **Workaround:** build the pieces from shared curves so they meet exactly; compare `volume` with an
  estimate and `bbox()` with the face positions.

### 11. Booleans between a Part and a Shell return invalid "Parts"
- **Session:** `2026-10-12_21-36-40_surfaces-shell`, scripts `05-queries.py`, `06-part-shell-boolean.py`
- **What happens:** `Box(...) & sheet` returns a `Part` holding the piece of the sheet inside the box
  (1 face, volume 0, `is_valid()` False). `Box(...) - sheet` and `Box(...) + sheet` return a `Part`
  with the sheet imprinted (11 faces, volume 3000, invalid). No error.
- **Expected:** `TypeError` for `-`/`+`, and a `Shell` for `&` (trimming a sheet with a solid is
  useful).
- **Reproduce:**
  ```python
  s = surface([[(x, y, 5 + 0.01 * (x - 20) ** 2) for y in range(0, 31, 10)] for x in range(0, 41, 10)])
  r = Box(10, 10, 30).translate(20, 15, 0) & s
  print(type(r).__name__, r.volume, r.is_valid())   # Part 0.0 False
  ```
- **Workaround:** `stitch(part & sheet)` returns the trimmed sheet as a `Shell`.
- **Fixed:** `part & sheet` and `sheet & part` return the piece of the sheet inside the part as a
  `Shell` (the reproduction: a Shell of area 100.17), `sheet - part` the rest; `part + sheet` and
  `part - sheet` raise `TypeError` pointing to `split` (which now takes sheets) and `imprint`
  (kernel plan B12, B14).

### 12. `stitch`: an open result keeps mixed face normals; `thicken` of it silently gives volume 0
- **Session:** `2026-10-12_21-26-09_surfaces-workflow`, scripts `07-cover-normals.py`, `08-cover-oriented.py`, `09-repro-normals.py`
- **What happens:** when the pieces close, the Part has consistent outward normals whatever the
  input. When they do not close, the Shell keeps each face's input normal. `thicken` of such a
  Shell returns a Part with volume 0.000 and `is_valid()` False (one sign) or raises `SM_ERR` (the
  other), with no hint about the normals. Freeform skin + four `ruled` walls from its edges: two walls
  point in, two out; thicken(-1.5) volume 0. With the walls oriented first: 6134.85, equal to
  `Part.shell` of the closed block (difference 0.001).
- **Expected:** stitch makes the normals of an open shell consistent (the kernel has
  `unify_normals`), or `thicken` says that the normals disagree.
- **Reproduce:**
  ```python
  a = ruled(Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 0), (10, 10, 0)))      # floor, normal +Z
  c = ruled(Line((0, 10, 10), (10, 10, 10)), Line((0, 10, 0), (10, 10, 0)))  # wall, normal +Y
  p = stitch(a, c).thicken(1)
  print(p.volume, p.is_valid())   # 0.0 False
  ```
- **Workaround:** orient each piece before stitching (swap the curves of `ruled` when
  `normal_at(p).dot(p - middle) < 0`).

## LOW

### 4. `Shell.thicken`: the `both` argument is ignored
- **Fixed:** both=True thickens by half to each side (total thickness centered).
- **Session:** `2026-10-12_21-26-09_surfaces-workflow`, script `02-thicken-direction.py`; `10-repro.py`
- **What happens:** `thicken(2, both=True)` gives the same body as `thicken(2)` (z -2..0, not -1..1
  or -2..2). The signature accepts `both`, the docstring does not mention it, the code never reads it.
- **Expected:** symmetric thickening, or no `both` parameter.
- **Reproduce:** `s = surface([[(x, y, 0) for x in range(4)] for y in range(4)]); s.thicken(1, both=True).bbox()`
- **Workaround:** move the surface by −t/2 along its normal first (only for flat sheets), or thicken
  both ways and fuse.

### 5. `surface`: a NaN coordinate is accepted and gives an empty face
- **Fixed:** NaN or infinite coordinates raise ValueError.
- **Session:** `2026-10-12_21-26-58_surfaces-surface`, script `09-bad-input.py`; `10-repro.py`
- **What happens:** one NaN z in a 4x4 grid → Shell with area 0.0, no error.
- **Expected:** `ValueError`.
- **Reproduce:** `surface([[(x, y, float('nan') if (x, y) == (1, 1) else 0) for x in range(4)] for y in range(4)]).area`

### 6. `surface`: ragged rows and a flat list give numpy/Python errors without a hint
- **Session:** `2026-10-12_21-26-58_surfaces-surface`, script `09-bad-input.py`
- **What happens:** ragged rows → `ValueError: setting an array element with a sequence. The requested
  array has an inhomogeneous shape...`; a flat list of points → `TypeError: 'int' object is not iterable`.
- **Expected:** "expected rows of points of equal length".

### 7. `Face.is_planar`: flat freeform faces (from `ruled`/`surface`) are not planar
- **Fixed:** faces whose control points lie in one plane are planar (is_planar, planar(), plane, to_sketch).
- **Session:** `2026-10-12_21-30-48_surfaces-ruled`, script `06-is-planar.py`
- **What happens:** `ruled(Line((0,0,0),(20,0,0)), Line((0,10,0),(20,10,0)))` lies exactly in z = 0,
  but `faces()[0].is_planar` is False (kernel `is_planar(1e-7)` False, `is_planar(1e-3)` True), so
  `faces().planar()` drops it and `to_sketch()` raises `ValueError: a bspline face has no plane`.
  Same for a flat `surface()` grid.
- **Expected:** a face that is flat to 1e-10 counts as planar.
- **Reproduce:** `ruled(Line((0,0,0),(20,0,0)), Line((0,10,0),(20,10,0))).faces()[0].is_planar`
- **Workaround:** use `Polyline(..., close=True)` + `make_face` for flat faces.

### 8. `ruled`: identical curves fail as "surface failed"; a Face or tuple gives a misleading error
- **Session:** `2026-10-12_21-30-48_surfaces-ruled`, script `04-closed-and-more.py`
- **What happens:** `ruled(c, c)` → `KernelError: surface failed (SM_ERR)` (the operation is named
  "surface" because the error comes from building the face). A Face as input →
  `ValueError: expected a single curve; join the wire's edges into one spline first`; a tuple →
  `AttributeError: 'tuple' object has no attribute 'edges'`.
- **Expected:** "ruled failed: the curves coincide"; `TypeError: ruled takes edges or wires`.

### 13. `Shell.thicken`: a multi-face shell thickens to slightly different bodies each call
- **Session:** `2026-10-12_21-26-09_surfaces-workflow`, script `12-volume-jitter.py`
- **What happens:** the same stitched 5-face cover, `thicken(-1.5)` three times: volume 6134.84857,
  6134.84786, 6134.84998 (about 2e-7 relative). A single-face skin gives the identical volume every
  time. Harmless in size, but results are not reproducible (tests comparing volumes to 2 decimals flip).
- **Expected:** the same input gives the same body.

