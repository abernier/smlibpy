# Defects and surprises: features

## HIGH

### 1. `Sketch.extrude(taper=...)`: holes of the profile are lost
- **Fixed:** the holes of a tapered extrusion are swept like the outline (turned round) and widen where it narrows; ring volume 1943.94.
- **Session:** `2026-10-12_21-26-06_features-extrude-revolve`, scripts `02-taper.py`, `06-taper-holes.py`
- **What happens:** a profile with holes extruded with a taper returns the outer frustum
  without the holes, valid, no error. `_extrude_taper` sweeps each inner loop with
  `k.draft_sweep(curves, amount, -taper)`; the inner loop runs clockwise, so the kernel sweeps
  it to the other side of the sketch (z -10..0) and the cut misses.
- **Expected:** a tapered ring (vol 1943.914 in the example).
- **Reproduce:**
  ```python
  ring = (Circle(10) - Circle(5)).extrude(10, taper=5)
  print(ring.volume)   # 2874.75 = full cone; expected 1943.91
  ```
- **Workaround:** `Circle(10).extrude(10, taper=5) - Circle(5).extrude(10, taper=-5)`.

### 2. `Sketch.revolve`: a region crossing the axis gives a "valid" body with zero or negative volume
- **Fixed:** revolve raises ModelingError "the axis crosses the region" for every angle (checked before the kernel call; the result is checked too).
- **Session:** `2026-10-12_21-26-06_features-extrude-revolve`, scripts `08-revolve-axis.py`, `10-revolve-plane-origin.py`
- **What happens:** with angle 360 the kernel returns a body, `is_valid()` is True, volume is
  -1570.8 or 0. With angle 90 the same input raises `SM_ERR_AXIS_INSIDE_FACE`.
- **Expected:** `ModelingError` "the axis crosses the region" for every angle.
- **Reproduce:**
  ```python
  p = Rectangle(10, 20).on(Plane.front).revolve(Z)
  print(p.is_valid(), p.volume)   # True -1570.796
  ```
- **Workaround:** check `volume > 0`; keep the region on one side of the axis.

### 9. `loft`: holes in sections are dropped silently
- **Fixed:** sections with holes make a hollow loft (holes matched to the nearest hole of the next section); different hole counts raise ValueError.
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, script `03-loft-odd.py`
- **What happens:** `_section_curves` passes only `outer_wire()` to the kernel, so a ring
  section lofts as a full disc. Valid, no error. (`create_skin_primitive` says "Planar profiles
  may contain matching outer and inner loops".)
- **Expected:** a hollow loft, or `ValueError` for sections with holes.
- **Reproduce:** `loft([Circle(10) - Circle(5), Circle(10).translate(0, 0, 20)]).volume  # 6283.19 = full cylinder`
- **Workaround:** loft the outside, subtract a loft of the inside.

### 10. `sweep` along a helix: the profile rolls about the path (~30° per turn)
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, scripts `12-sweep-helix.py`, `14-sweep-helix-roll.py`
- **What happens:** a `Rectangle(2, 1)` swept along `Helix(pitch=5, height=30, radius=10)`:
  the section at 90° of each turn measures (radial × axial) 2.11×1.25, 2.19×2.04, 1.59×2.22,
  1.35×2.15, 1.98×2.21, 2.23×1.87 instead of 2×1.003. Threads and flat springs come out twisted.
  The kernel sweep frame is not tied to the helix axis.
- **Expected:** the profile keeps its orientation relative to the helix axis (as for a thread).
- **Reproduce:**
  ```python
  rect = sweep(Rectangle(2, 1), Helix(pitch=5, height=30, radius=10))
  print([(round(f.bbox().size.y, 2), round(f.bbox().size.z, 2)) for f in rect.section(Plane.YZ).faces() if f.bbox().min.y > 0])
  ```
- **Workaround:** loft through profile copies placed with `Plane(origin=h.point_at(t), x_dir=radial, z_dir=h.tangent_at(t))`, 8 per turn (exact, script 15).

### 11. `sweep` along a single 360° arc: two solids and a negative volume
- **Fixed:** a closed single-edge path is split into two halves before sweeping: one torus, volume 1579.14.
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, scripts `13-sweep-multiedge.py`, `16-sweep-edge-cases.py`
- **What happens:** `sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))` → `is_valid()` True,
  volume -1579.13, `len(solids()) == 2`.
- **Expected:** one torus, volume 1579.14.
- **Workaround:** a path of two half arcs, or `revolve`.

### 20. `fillet`: radius just below the limit returns a broken body that passes all checks
- **Fixed:** fillet/chamfer results must be valid and change the volume by no more than rounds of that size can (not bounded where a rounded edge runs on into one that is not rounded, tangentially or at a kink: the kernel extends the round there); r4.99 on the 10 mm cube raises ModelingError.
- **Session:** `2026-10-12_21-37-11_features-fillet-chamfer`, scripts `04-fillet-limits.py`, `05-fillet-r499.py`
- **What happens:** `Box(10,10,10).fillet(all edges, 4.99)` → `is_valid()` True, volume 11.19
  (exact 525.17), 14 faces instead of 26, rendering fails with `KernelError: tessellate failed`.
  r 4.97 and 4.999 are exact; deterministic. `Box(20,20,20)` with r 9.98: vol 89.5.
  The overlap check allows it (4.99 < 5) and the volume check only tests the direction.
- **Expected:** the correct body, or an error.
- **Reproduce:**
  ```python
  c = Box(10, 10, 10)
  print(c.fillet(c.edges(), 4.99).volume)   # 11.19, expected 525.17
  ```
- **Workaround:** stay a few percent below the limit; compare the volume with a formula.

### 24. `shell`: segmentation fault when the wall equals the depth to the opening
- **Fixed:** shell refuses walls that do not fit along an axis of the bounding box before calling the kernel; ModelingError every time.
- **Session:** `2026-10-12_21-40-40_features-shell-offset-thicken`, scripts `02-shell-limits.py`, `04-shell-crash-repro.py`
- **What happens:** the Python process dies with exit code 139 (SIGSEGV) in 7 of 20 runs; the
  other runs raise `ModelingError: shell: the kernel could not build a valid result`. The
  nondeterminism matches the comment in `Part.shell` (extended offset mode depends on memory order).
- **Reproduce (run it 20 times):**
  ```python
  box = Box(40, 30, 10)
  box.shell(10, box.faces().top())
  ```
- **Expected:** a `ModelingError` every time. smlibpy could reject `thickness >= ` the part's
  smallest bbox dimension before calling the kernel.

### 25. `shell`: a closed shell thicker than half the part returns a wrong "valid" body
- **Fixed:** same check: two walls of 6 in a 10 mm part raise ModelingError.
- **Session:** `2026-10-12_21-40-40_features-shell-offset-thicken`, script `02-shell-limits.py`
- **What happens:** `Box(40, 30, 10).shell(6)` → valid, volume 10992; `shell(10)` → valid,
  volume 10000, 10 faces. No 6 or 10 mm wall fits in a 10 mm part. `_checked` accepts it because
  validity, bbox and "volume smaller" all pass. `shell(5)` raises correctly.
- **Expected:** `ModelingError`.
- **Reproduce:** `print(Box(40, 30, 10).shell(6).volume)   # 10992`

## MEDIUM

### 3. `revolve`: negative angle revolves 360+angle in the positive sense
- **Fixed:** a negative angle turns the other way (axis flipped); 0 and |angle| > 360 raise ValueError.
- **Session:** `2026-10-12_21-26-06_features-extrude-revolve`, script `10-revolve-plane-origin.py`
- **What happens:** `revolve(Z, -90)` makes a 270° body (vol 7068.58 of 9424.78 for the full
  ring) instead of 90° the other way. `angle=0` and `-360` return invalid bodies without error.
- **Expected:** -90 = a quarter the other way round; 0 raises.
- **Reproduce:** `Rectangle(10, 10).translate(15, 0).on(Plane.front).revolve(Z, -90).volume  # 7068.58`
- **Workaround:** flip the axis: `revolve(Axis((0,0,0),(0,0,-1)), 90)`.

### 4. `Sketch.revolve`: default axis follows the moved sketch origin
- **Fixed:** the default axis is unchanged, but an axis through the region now raises and the message names the default axis and its point; docstring and docs say to pass axis.
- **Session:** `2026-10-12_21-26-06_features-extrude-revolve`, script `10-revolve-plane-origin.py`
- **What happens:** the default axis is the local Y axis through `sketch.plane.origin`, and
  `translate`, `Pos * sketch` and `align=` move that origin (Rectangle(10,20, align=(MIN,MIN))
  has its plane origin at (5,10)). Every profile placed off the origin by these means is then
  revolved about its own middle (bug 2 follows). `docs/parts.md` says the default "for a
  profile on Plane.front is the world Z axis", which holds only for sketches never moved.
- **Expected:** either the axis of the plane the sketch was placed on (`.on(...)`), or make
  `axis` required; at least the docstring should say it.
- **Reproduce:** `Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve().volume  # -1570.8`
- **Workaround:** always pass `axis`.

### 5. `extrude(taper=...)`: closing tapers silently shorten the solid; 90° gives an empty invalid body
- **Fixed:** a taper that closes the profile before the end raises ModelingError; |taper| >= 90 raises ValueError.
- **Session:** `2026-10-12_21-26-06_features-extrude-revolve`, script `03-taper-limits.py`
- **What happens:** `Rectangle(20, 20).extrude(10, taper=56)` ends at z 6.745 (a pyramid), no
  error. `taper=90` → `is_valid()` False, volume 0, no error. `taper=100` behaves like 80.
- **Expected:** `ModelingError` when the taper closes the profile before `amount`
  (the hint "the taper may close the profile before the end" exists but is never raised);
  reject `|taper| >= 90`.
- **Reproduce:** `print(Rectangle(20, 20).extrude(10, taper=56).bbox().max.z)  # 6.745`

### 6. `revolve`: axis perpendicular to the sketch plane returns a flat zero-volume body
- **Fixed:** ValueError "the axis must lie in the sketch plane".
- **Session:** `2026-10-12_21-26-06_features-extrude-revolve`, script `08-revolve-axis.py`
- **What happens:** `Circle(3).translate(10, 0).revolve(Z)` (sketch in XY) → valid=True, vol 0,
  bbox flat in x. No error.
- **Expected:** `ValueError: the axis must lie in the sketch plane`.

### 12. `loft`: sections are matched by their start points; mismatched sections twist and pinch
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, scripts `02`, `04`, `05`, `06`
- **What happens:** the user docs example
  `loft([Rectangle(20, 20), RegularPolygon(10, 6).translate(0, 0, 20)], ruled=True)`
  (docs/parts.md "straight") is an hourglass: mid-section area 6.4, volume 2284.7 instead of
  ~6500. Rectangle→Circle, triangle→circle, slot→circle are visibly twisted. All `is_valid()`.
  There is no way to choose the start vertex; `Circle(r).rotate(Z, 45)` fixes rect→circle, a
  closed Polyline fixes polygon sections.
- **Expected:** smlibpy aligns the seams (e.g. rotates loops so the starts are closest in
  angle), or offers a `start`/`seam` option. Fix the docs/parts.md example.

### 13. `sweep`: self-intersecting results pass `is_valid()`
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, scripts `12-sweep-helix.py`, `16-sweep-edge-cases.py`
- **What happens:** `sweep(Circle(3), Helix(pitch=5, height=30, radius=10))` (coils overlap)
  and `sweep(Circle(12), CenterArc((0, 0), 10, 0, 90))` return valid bodies whose volume is
  area × length, i.e. counted twice where they overlap.
- **Expected:** `ModelingError` (profile larger than the bend radius / pitch).

### 14. `sweep`: a Wire of disconnected edges returns an invalid body without an error
- **Fixed:** sweep raises ValueError "the sweep path is not connected".
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, script `16-sweep-edge-cases.py`
- **Reproduce:** `sweep(Circle(1), Wire([Line((0,0,0),(0,0,10)), Line((5,0,20),(5,0,30))])).is_valid()  # False`
- **Expected:** `ValueError: the path is not connected`.

### 15. `shell` of a loft: opening the circular end face fails
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, script `09-loft-duct-shell.py`
- **What happens:** `duct = loft([Rectangle(40, 30), Circle(12).rotate(Z, 45).translate(0, 0, 40)])`;
  `duct.shell(2, duct.faces().top())` and `shell(1, top + bottom)` raise `KernelError: shell
  failed (SM_ERR)`; `shell(2, bottom)` and closed `shell(2)` work.

### 26. `Shell.thicken(both=True)` is ignored
- **Fixed:** Shell.thicken(both=True) is thickness in total, centered on the sheet (two halves fused).
- **Session:** `2026-10-12_21-40-40_features-shell-offset-thicken`, script `06-thicken.py`
- **What happens:** `Rectangle(20, 10).thicken(2, both=True)` → 2 thick, z 0..2, volume 400.
  The parameter is never used in `Shell.thicken`; the `thicken()` function does not offer it.
- **Expected:** 2 to each side (or `t` total centered), volume 800.
- **Workaround:** `sheet.translate(-n * t/2).thicken(t)`.

### 27. `thicken` beyond a concave radius returns an invalid body without an error
- **Fixed:** thicken checks its result (valid, positive volume) and raises ModelingError.
- **Session:** `2026-10-12_21-40-40_features-shell-offset-thicken`, script `06-thicken.py`
- **Reproduce:** `extrude(CenterArc((0, 0), 10, 0, 180), 20).thicken(-12).is_valid()  # False, volume 0`
- **Expected:** `ModelingError` (as `shell`/`offset` do through `_checked`).

### 30. `split`: an empty side returns an empty Part without an error
- **Fixed:** split raises ModelingError "nothing of the part lies above/below the plane".
- **Session:** `2026-10-12_21-44-19_features-mirror-split-section-misc`, script `02-split.py`
- **What happens:** `part.split(Plane.XY.offset(50))` (plane above the part) and
  `part.split(part.faces().top())` return a `Part` with 0 faces, `is_valid()` False, bbox ±1e20.
- **Expected:** `ModelingError: nothing of the part lies on the kept side` (like `section`, which raises).

### 31. `mirror` of a sketch flips its normal; the mirrored sketch extrudes the other way
- **Session:** `2026-10-12_21-44-19_features-mirror-split-section-misc`, script `01-mirror.py`
- **What happens:** `Rectangle(10, 6).translate(10, 0).mirror(Plane.YZ).plane.z_dir == (0, 0, -1)`;
  `.extrude(5)` spans z -5..0. Mathematically a reflection, but a user mirroring a profile in
  its own plane expects the same extrusion direction.
- **Expected:** keep the sketch normal when the mirror plane contains it (mirror in-plane), or document it.

## LOW

### 7. `extrude`: `taper` ignores `direction`, and open curves ignore `taper`
- **Session:** `2026-10-12_21-26-06_features-extrude-revolve`, scripts `02-taper.py`, `05-open-and-errors.py`
- **What happens:** `Rectangle(20,20).extrude(10, taper=5, direction=(1,0,1))` extrudes straight
  along the normal; `extrude(Line(...), 3, taper=5)` returns an untapered Shell. No warning.
- **Expected:** a `ValueError` for unsupported combinations.

### 8. `extrude(taper<0)`: the side faces come out split
- **Session:** `2026-10-12_21-26-06_features-extrude-revolve`, script `02-taper.py`
- **What happens:** `Rectangle(30, 30).extrude(10, taper=-8)` has 14 faces (6 expected);
  valid, volume exact. Face counts used as checks are off.

### 16. `loft(smooth=...)` has no effect with three sections
- **Fixed:** docstring says cubic only with four or more sections.
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, script `01-loft-basic.py`
- **What happens:** degree = `min(3 if smooth else 2, len(sections) - 1)` is 2 either way for
  three sections; the docstring says "With more than two sections". Volumes identical.
- **Expected:** docstring "with four or more sections".

### 17. `loft` of single-edge open curves ignores `ruled`
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, script `07-loft-open-bent.py`
- **What happens:** three lines with `ruled=True` → area 229.56 (smooth skin), ruled would be 223.61.

### 18. `sweep(orient=False)`: misleading error message
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, script `11-sweep-orientation.py`
- **What happens:** `sweep(Rectangle(10, 2), Line((0,0,0),(40,0,0)), orient=False)` →
  "the profile may be too large for the path's curvature" (the path is straight; the profile is
  parallel to it).

### 19. `Shell` has no `is_valid()`
- **Session:** `2026-10-12_21-30-02_features-loft-sweep`, script `03-loft-odd.py`
- **What happens:** `loft([...open curves])` returns a Shell; `shell.is_valid()` →
  `AttributeError`. Results of loft/sweep/extrude/revolve of open curves cannot be checked the
  same way as parts.

### 21. `fillet`/`chamfer`: zero or negative size gives a misleading message
- **Fixed:** ValueError "the radius must be positive" / "the length must be positive".
- **Session:** `2026-10-12_21-37-11_features-fillet-chamfer`, scripts `04`, `08`
- **What happens:** `r=0`, `r=-1`, `length=0` → `KernelError: fillet failed (SM_ERR): the radius may be too large for the selected edges`.
- **Expected:** `ValueError: radius must be positive`.

### 22. `fillet(continuity="G2", fullness>=1.5)` fails with the radius message
- **Session:** `2026-10-12_21-37-11_features-fillet-chamfer`, script `02-fillet-variants.py`
- **What happens:** a box edge r5 G2 with fullness 1.5 or 2.0 → "the radius may be too large"; the
  docstring gives no range. 0.5 to 1.2 work. `fullness` is silently ignored for circular fillets.

### 23. `chamfer`: only one symmetric length
- **Session:** `2026-10-12_21-37-11_features-fillet-chamfer`, script `08-chamfer.py`
- **What happens:** no angle or two-distance chamfer; `chamfer(edge, (2, 3))` → `TypeError: float() argument must be ...`.
  The plan and common CAD usage expect distance-distance and distance-angle forms. Feature gap, not a bug.

### 28. `shell(outward=True)` rounds the outer edges, `offset` keeps them sharp
- **Session:** `2026-10-12_21-40-40_features-shell-offset-thicken`, scripts `01-shell-basic.py`, `05-offset.py`
- **What happens:** `Box(80,50,30).shell(2.5, outward=True)` has rounded outer edges (r 2.5,
  32 faces, vol 42707.04), while `Box.offset(2.5)` is sharp (43625). Neither docstring says
  which. The likely cause: shell tries `extended_offset=False` first.
- **Expected:** consistent behaviour, or the docstring says it.

### 29. `thicken(part, t)` raises `AttributeError`
- **Fixed:** thicken(part) raises TypeError naming the accepted types.
- **Session:** `2026-10-12_21-40-40_features-shell-offset-thicken`, script `06-thicken.py`
- **What happens:** `'Part' object has no attribute 'thicken'`. A `TypeError` naming the accepted types would help.

### 32. `mirror(plane=...)` defaults to `Plane.XZ` and rejects faces
- **Fixed:** mirror accepts planar faces (through _as_plane); other types raise TypeError. The default stays Plane.XZ.
- **Session:** `2026-10-12_21-44-19_features-mirror-split-section-misc`, script `01-mirror.py`
- **What happens:** the default flips Y, which is easy to miss; `part.mirror(face)` raises
  `AttributeError: 'Face' object has no attribute 'z_dir'` while `split`/`section` accept faces
  (through `_as_plane`).
- **Expected:** accept faces via `_as_plane`; consider making `plane` required.

### 33. `Part.draft` is a public method that always raises `NotImplementedError`
- **Session:** `2026-10-12_21-44-19_features-mirror-split-section-misc`, script `04-draft.py`
- **What happens:** it shows up in `dir(Part)`, `describe_method` and the plan; agents will try it.
  docs/features.md "Draft" only shows tapered extrusions.
- **Expected:** hide it until it works, or document that it raises.

### 34. `heal` cannot repair the broken results of smlibpy's own features
- **Session:** `2026-10-12_21-44-19_features-mirror-split-section-misc`, script `06-heal-broken.py`
- **What happens:** negative-volume revolves and sweeps, the r4.99 fillet, disconnected sweeps
  stay broken after `heal()`. Not a defect of heal (kernel docstring: no gap closing), but the
  docstring "Repair gaps, tolerances and topology" promises more than it does.
