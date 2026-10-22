# Defects and surprises: parts

## HIGH

### 1. `Cone(0, r, h)` exported to STEP comes back with twice the volume
- **Fixed:** the STEP writer takes another point of the cone face where interior_point() is the apex; the round trip keeps the volume.
- **Session:** `2026-10-12_21-26-09_parts-primitives`, scripts `08-cone.py`, `09-cone-step-roundtrip.py`, `10-inverted-cone-step-in-part.py`
- **What happens:** exporting a cone with its apex at the bottom prints
  `RuntimeWarning: invalid value encountered in divide` (step.py:310, `radial /= np.linalg.norm(radial)`).
  `import_step` of that file gives volume 3141.593 instead of 1570.797 (the cone face sense is
  wrong). The cone face's `interior_point()` returns the apex (0, 0, −7.5), where the radial
  direction is zero, so `_same_sense` compares against NaN.
- **Expected:** the round trip keeps the volume, as it does for `Cone(10, 0, 15)` and for
  `Cone(10, 0, 15).rotate(X, 180)` (same geometry).
- **Reproduce:**
  ```python
  p = Cone(0, 10, 15)
  export_step(p, "c.step")
  print(p.volume, import_step("c.step").volume)   # 1570.797 3141.593
  ```
- **Workaround:** `Cone(10, 0, 15).rotate(X, 180)`. A box with a cone cut (`Box − Cone(0, 5, 10)`)
  round-trips correctly.

### 17. Segmentation fault: fillet on the invalid result of a tangent fuse
- **Fixed:** fillet, chamfer, shell and offset refuse an invalid part with ModelingError; the tangent fuse itself now raises too.
- **Session:** `2026-10-12_21-38-20_parts-booleans`, scripts `06-failures.py`, `10-fillet-invalid-segfault.py`
- **What happens:** the Python process dies with exit code 139 (reproduced twice).
- **Expected:** a `ModelingError` (the part is not valid; smlibpy could refuse to fillet an invalid part).
- **Reproduce:**
  ```python
  tangent = Cylinder(5, 20) + Cylinder(5, 20).translate(10, 0, 0)   # is_valid() False, see #7
  tangent.fillet(tangent.edges().circles(), 0.5)                     # segfault
  ```
- **Workaround:** never continue on a part with `is_valid()` False.

### 18. Overlapping parallel through cuts: empty part or KernelError
- **Fixed:** several tools that fail one after the other are combined and applied at once (the hole pattern now gives 23125.2); a single tool overlapping an earlier cut raises KernelError with the hint to combine the tools.
- **Reopened (kernel plan B3, B10):** on curved bodies a single tool still went wrong silently: `(Sphere(20) - Cylinder(6, 60)) - Cylinder(3, 60).translate(8, 0, 0)` gave an empty Part and `&` the whole part (29089.8; right: 929.188). Both raise ModelingError now; the result itself needs the tools combined (28160.6) until the NURBS retry of B10.
- **Session:** `2026-10-12_21-38-20_parts-booleans`, scripts `11-many-tools.py`, `12-overlapping-tools.py`,
  `13-overlap-scope.py`, `14-overlap-workaround.py`, `17-overlapping-holes.py`, `18-overlap-empty-repro.py`, `19-overlap-variants.py`
- **What happens:** cutting a second parallel cylinder that overlaps an existing through hole:
  - tool flush with the top and out of the bottom → **an empty Part (0 faces, volume 0), no error**;
  - tool out of the top and the bottom (a centered `Cylinder`) → `KernelError: cut failed (SM_ERR):
    the operands may only touch in a degenerate way; try moving one slightly`. Moving it does not help.
  Fusing two overlapping parallel bosses that stick out of a box fails the same way. Tools exactly as
  long as the plate is thick, blind tools, crossed holes and a single cylinder minus a parallel one work.
  Reproduced twice.
- **Expected:** a valid part with both holes (volume 23125.2 in the first reproduction).
- **Reproduce:**
  ```python
  part = Box(60, 40, 10)
  print(part - (Locations((0, 0), (5, 0)) * Hole(4, 12)).on(part.faces().top()))   # Part(0 faces, volume=0)
  Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)           # KernelError
  ```
- **Workaround:** fuse the tools first and cut once: `part - (tool1 + tool2)`. smlibpy could do that
  itself for a list of tools.

## MEDIUM

### 3. `Wedge`: the width comes out doubled
- **Fixed:** Wedge extrudes width/2 to each side: Wedge(20, 10, 8) is 10 wide, volume 800.
- **Session:** `2026-10-12_21-26-09_parts-primitives`, scripts `13-wedge.py`, `14-wedge-edge-cases.py`
- **What happens:** `Wedge(20, 10, 8)` has bbox y −10..10 (width 20) and volume 1600; with
  `top_length=5` volume 2000. The code extrudes the profile with `extrude(width, both=True)`,
  which goes `width` to each side.
- **Expected:** width 10, volume 800 (1000 with top_length=5).
- **Reproduce:** `print(Wedge(20, 10, 8).bbox())  # y -10..10`
- **Workaround:** pass half the width: `Wedge(20, 5, 8)`.

### 6. `Part.is_valid()` is True for a self-intersecting body with negative volume
- **Fixed:** is_valid() also requires a positive volume (coarse integration); the revolve raises before that anyway.
- **Session:** `2026-10-12_21-26-09_parts-primitives`, script `16-part-metadata-validity.py`
- **What happens:** `Rectangle(10, 10).on(Plane.front).revolve()` (profile crosses the axis)
  gives `Part(6 faces, volume=-785.404)` and `is_valid()` → True.
- **Expected:** `is_valid()` False (the docstring says "closed, manifold solid"; the recipe tells
  agents to rely on it).
- **Reproduce:** `b = Rectangle(10, 10).on(Plane.front).revolve(); print(b.volume, b.is_valid())`
- **Workaround:** check `part.volume > 0` too.

### 7. Fuse with a face tangent to a cylinder returns an invalid part without an error
- **Fixed:** Booleans between valid parts check the result and raise ModelingError with a hint about degenerate contact.
- **Session:** `2026-10-12_21-26-09_parts-primitives`, scripts `17-realistic-block.py`, `18-tangent-rib.py`
- **What happens:** `Cylinder(10, 20) + Box(10, 4, 20, align=(Align.MAX, Align.CENTER, Align.CENTER)).translate(-10, 0, 0)`
  → `Part(11 faces, ...)`, `is_valid()` False, no exception.
- **Expected:** a valid union, or a `ModelingError` that says the contact is degenerate (the
  boolean already has that hint for kernel failures).
- **Reproduce:** the line above.
- **Also:** two parallel cylinders tangent from outside (fuse) or inside (cut), and two boxes fused
  along one edge (`Box(10, 10, 10) + Box(10, 10, 10).translate(10, 10, 0)`) give `is_valid()` False
  (`booleans/05-curved-contacts.py`, `03-contact-cases.py` in `2026-10-12_21-38-20_parts-booleans`).
- **Workaround:** let the tool overlap (here `translate(-9, 0, 0)`): 7 faces, valid.

### 13. `.on(face)` places at the face centroid, which moves after every cut
- **Session:** `2026-10-12_21-33-25_parts-holes`, script `04-face-center-shift.py`
- **What happens:** `part -= (Pos(20, 0) * Hole(5, 10)).on(part.faces().top())`, then
  `(Pos(-20, 0) * Hole(2, 10)).on(part.faces().top())` cuts the second hole at x = −20.677: the new
  top face's centroid is (−0.677, 0, 5). Nothing warns.
- **Expected:** a stable origin for a face (for example the center of its outer loop's bounding
  box), or a docstring that says the origin is the centroid and moves with every cut.
- **Reproduce:**
  ```python
  part = Box(60, 40, 10)
  part -= (Pos(20, 0) * Hole(5, 10)).on(part.faces().top())
  part -= (Pos(-20, 0) * Hole(2, 10)).on(part.faces().top())
  print(sorted(round(f.axis.origin.x, 3) for f in part.faces().cylinders()))   # [-20.677, 20.0]
  ```
- **Workaround:** select the face once before cutting and reuse it, put all holes in one pattern,
  or place on a fixed plane (`Plane.XY.offset(5)`).

### 19. `part - sketch` (forgotten `.extrude`) returns an invalid part without an error
- **Fixed:** TypeError "cannot cut a Sketch with a Part; extrude it first".
- **Session:** `2026-10-12_21-38-20_parts-booleans`, scripts `01-forms.py`, `02-sketch-operand.py`
- **What happens:** `Sketch` is a subclass of `Shell`, which `_boolean` accepts. `plate - Circle(3).on(top)`
  → `Part(7 faces, volume=24000)`, `is_valid()` False. `plate & sketch` → 1 face, invalid. Same with a `Face`.
- **Expected:** `TypeError: cannot cut a Sketch from a Part; extrude it first` (the code already has
  such a message for other types).
- **Reproduce:** `plate = Box(60, 40, 10); print((plate - Circle(3).on(plate.faces().top())).is_valid())  # False`

## LOW

### 2. `Part.solids()` does not separate a body that sits inside a cavity
- **Session:** `2026-10-12_21-26-09_parts-primitives`, scripts `02-several-bodies.py`, `03-island-in-cavity.py`
- **What happens:** `(Box(20, 20, 20) - Box(10, 10, 10)) + Box(4, 4, 4)` → `solids()` returns 1
  part with volume 7064 and 18 faces; the inner cube is 3 mm from the walls.
- **Expected:** 2 solids (7000 and 64), as when the cube is outside.
- **Reproduce:** `print(len(((Box(20, 20, 20) - Box(10, 10, 10)) + Box(4, 4, 4)).solids()))  # 1`

### 4. `Wedge` docstring: the ramp does not rise "at the back (+Y)"
- **Fixed:** the docstring describes the real orientation (high side at x = -length/2, slope towards +X).
- **Session:** `2026-10-12_21-26-09_parts-primitives`, script `13-wedge.py`
- **What happens:** the profile lies in XZ and is extruded along Y. The high side is the
  vertical face at x = −length/2; the slope goes down towards +X. `top_length` is measured
  from −X.
- **Expected:** the docstring describes the real orientation (or the code matches the docstring).
- **Reproduce:** `[v.point for v in Wedge(20, 10, 8).vertices()]` → the top vertices are at x = −10.

### 5. `Wedge` does not validate its inputs
- **Fixed:** ValueError for non-positive sizes and top_length outside 0..length.
- **Session:** `2026-10-12_21-26-09_parts-primitives`, scripts `13-wedge.py`, `14-wedge-edge-cases.py`, `15-wedge-negative.py`
- **What happens:** negative length mirrors the ramp, negative height turns it upside down,
  negative width and negative top_length are accepted; `top_length >= length` gives a box or
  an overhanging shape. Zero length or height → `KernelError: sketch failed (SM_ERR)`; zero
  width → `ValueError: extrude amount must not be zero`. The other primitives raise
  `ValueError` with a clear message.
- **Expected:** `ValueError` for non-positive sizes and for `top_length` outside 0..length.
- **Reproduce:** `Wedge(-20, 10, 8)`, `Wedge(20, 10, -8)`, `Wedge(0, 10, 8)`.

### 8. Size errors of the primitives are `ValueError`, not `ModelingError`
- **Session:** `2026-10-12_21-26-09_parts-primitives`, scripts `05-box-edge-cases.py`, `06-cylinder.py`, `08-cone.py`
- **What happens:** `Box(0, 1, 1)` → `ValueError: box dimensions must be positive`; same for the
  other primitives. SKILL.md says "Errors are ModelingError ... or KernelError".
- **Expected:** consistent with SKILL.md, or SKILL.md mentions ValueError.

### 9. Sizes below the kernel tolerance give a valid part of volume 0
- **Session:** `2026-10-12_21-26-09_parts-primitives`, script `05-box-edge-cases.py`
- **What happens:** `Box(1e-7, 1, 1)` → `is_valid()` True, `volume` 0.0.
- **Expected:** a `ValueError` for sizes below `TOLERANCE`.

### 10. `colored()` accepts any value; the error comes at export
- **Session:** `2026-10-12_21-26-09_parts-primitives`, script `16-part-metadata-validity.py`
- **What happens:** `Box(1, 1, 1).colored("notacolor")` and `.colored(42)` are accepted;
  `export_step` / `export_gltf` then raise `ValueError: unknown color 'notacolor'`. Only about
  60 CSS names are known (no "lightgreen").
- **Expected:** `colored()` validates with `colors.to_rgb`.

### 11. `name` and `color` can be assigned, which mutates a shape
- **Session:** `2026-10-12_21-26-09_parts-primitives`, script `01-part-basics.py`
- **What happens:** `b.name = "x"` changes `b` in place, against "shapes are immutable".
- **Expected:** read-only attributes, or documented.

### 12. `Part` repr shows six digits of a volume integrated to 1e-5
- **Session:** `2026-10-12_21-26-09_parts-primitives`, scripts `08-cone.py`, `12-torus.py`
- **What happens:** `repr(Torus(20, 4))` → `volume=6316.8`, `Torus(20, 4).volume` → 6316.548
  (formula 6316.547). `Cone(10, 0, 15)` repr 1570.82 vs 1570.796.
- **Expected:** the repr rounds to the digits it can back, or uses the default accuracy.

### 14. `CounterBoreHole` does not check its parameters
- **Session:** `2026-10-12_21-33-25_parts-holes`, script `07-counterbore-edge-cases.py`
- **What happens:** `counter_bore_radius <= radius` gives a plain cylinder of the larger radius;
  `counter_bore_depth >= depth` gives one cylinder `counter_bore_depth` deep. Zero values raise
  `ValueError: radius and height must be positive` (the message of Cylinder, not of the hole).
- **Expected:** `ValueError` naming the hole parameters.
- **Reproduce:** `CounterBoreHole(4, 2, 3, 10).faces().cylinders()` → one face of radius 4.

### 15. `CounterSinkHole` with angle 0 or 180
- **Session:** `2026-10-12_21-33-25_parts-holes`, script `08-countersink.py`
- **What happens:** `angle=0` → `ZeroDivisionError`; `angle=180` → `KernelError: Cone failed
  (SM_ERR_INVALID_INPUT)`; `angle=-82` or `counter_sink_radius < radius` → `ValueError: invalid
  cone dimensions`.
- **Expected:** `ValueError: angle must be between 0 and 180` and a message that names the sink radius.
- **Reproduce:** `CounterSinkHole(2, 4, 10, angle=0)`.

### 16. The cone-to-drill edge of a countersink is a B-spline
- **Session:** `2026-10-12_21-33-25_parts-holes`, script `09-countersink-edges.py`
- **What happens:** the fuse of the drill cylinder and the cone gives a `bspline` edge at the
  bottom of the sink; `part.edges().circles()` does not find it (only the outer circle and the
  bottom circle of the drill).
- **Expected:** a circle edge (it is one geometrically).
- **Reproduce:** `[e.geom_type for e in CounterSinkHole(2, 4, 10).edges()]` → `['circle', 'bspline', 'circle']`.

### 20. Wrong Boolean operands: RecursionError and unhelpful TypeErrors
- **Fixed:** TypeError "cannot cut a body with a str value; use parts (or a list of parts)" for strings, numbers, edges and vertices.
- **Session:** `2026-10-12_21-38-20_parts-booleans`, scripts `01-forms.py`, `20-typeerror.py`
- **What happens:** `_bodies` iterates a string forever (each character is a string) →
  `RecursionError`. `part - 5` → `TypeError: 'int' object is not iterable`; `part - edge` →
  `'Edge' object is not iterable`; `part - vertex` → `'float' object is not iterable`. The friendly
  message `cannot cut a X with a Part` in `_boolean` is never reached for these.
- **Expected:** `TypeError: cannot cut a str with a Part` (and the same for edges, vertices, numbers).
- **Reproduce:** `Box(1, 1, 1) - "x"`.

### 21. Booleans with an empty result return an empty Part silently
- **Fixed:** empty results stay where they are right (tool encloses the part, identical bodies, disjoint intersections); a wrong empty result (overlapping tools) is retried or raises.
- **Reopened (kernel plan B3):** the check confirmed an empty cut with the kernel's intersection of the same pair, which fails the same way on curved bodies and imported pulleys (crescendo parts 19 and 40). An empty cut is accepted now only from tools that hold the part's volume and span its box.
- **Session:** `2026-10-12_21-38-20_parts-booleans`, scripts `03-contact-cases.py`, `07-empty-part-crash.py`
- **What happens:** `a - Box(big)`, `a & disjoint`, `a & [t1, t2]` with disjoint tools: `Part(0 faces,
  volume=0)`, `is_valid()` False, `solids()` empty. `export_step` then raises `ValueError: nothing to write`.
- **Expected:** at least a documented behaviour; possibly a warning, since an empty result is almost
  always a mistake (for example `&` with a list, which intersects with all tools).

### 22. The Boolean hint blames touching operands also when an operand is broken
- **Fixed:** the hint names degenerate contact, overlapping earlier cuts (combine the tools) and broken operands; broken operands get their own message.
- **Session:** `2026-10-12_21-38-20_parts-booleans`, script `09-crash-candidate-1.py`
- **What happens:** `Box(10, 10, 10) + Rectangle(10, 10).on(Plane.front).revolve()` (negative volume,
  see #6) → `fuse failed (SM_ERR): the operands may only touch in a degenerate way; try moving one slightly`.
  The overlapping-cut failure (#18) shows the same hint; moving the tool does not help.
- **Expected:** the hint mentions checking `is_valid()` / `volume` of the operands and fusing tools first.
