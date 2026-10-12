# Training: parts · Part class and primitives

**Date:** 2026-10-12

## Goal

APIs: `Part` (named, colored, name, color, info, is_valid, solids, repr), `Box`, `Cylinder`,
`Cone`, `Sphere`, `Torus`, `Wedge`.

Questions:
- Where does each primitive sit by default? What does `align` change, per axis, with strings,
  with None, with fewer or more than three values?
- What happens with zero, negative, tiny and huge sizes? Which exception?
- Is there a partial cylinder or sphere (angle parameter)?
- Wedge: which way does the ramp face, what does `top_length` do, what are the sizes?
- What is a Part with several bodies; does `solids()` find them all?
- Are `name` and `color` really immutable; what colors are accepted?

Expected from the code (`parts.py`): sizes are checked with `ValueError`, not `ModelingError`.
`align` is applied by translating the bounding box. Wedge is a polygon on `Plane.XZ` extruded
with `both=True`, which suggests the width is doubled.

## Runs

### 01-part-basics.py
Box(20, 10, 4): repr `Part(6 faces, volume=800)`, `info()` = type, faces 6, edges 12, vertices 8,
bbox. `named`/`colored` return copies (original name stays None). Name and color survive
translate and cut; a fuse keeps the left operand's name and color (`Cylinder.colored("red") + c`
→ name None, color red). `Part()` → `TypeError: create a Part with the constructors`.
`b.name = "direct"` works and mutates the part in place.
- 📌 doc: metadata follows the left operand; `Part()` cannot be called; name/color are plain
  attributes and can be assigned (but that mutates; use `named`/`colored`).

### 02-several-bodies.py
Two disjoint boxes fused: one Part, `solids()` = 2, `is_valid()` True, volume 2000, center
(15, 0, 0), info counts both. `sum([...])` of four boxes works (`__radd__` with 0). A cut that
splits a bar gives 2 solids. Solids keep the name and color of the part.
![bar](files/02-several-bodies-bar.png)
- 📌 doc: a Part may hold several bodies; `sum()` works; cut can split a part.

### 03-island-in-cavity.py
Hollow box (Box(20) − Box(10)) plus a Box(4) inside the cavity: `solids()` = 1 with volume
7064 and 18 faces, though the island is 3 mm away from the walls (`distance_to` = 3.0). The
same island outside the box gives 2 solids. **Defect** (todo #2).

### 04-box-align.py
Box(40, 30, 10) default bbox (−20, −15, −5)..(20, 15, 5). `Align.MIN` → 0..size on all axes,
`MAX` → −size..0. Strings work case-insensitively ("min", "MAX"). `None` = no move (stays
centered). `(Align.MIN, Align.MIN)` (two values) aligns X and Y, Z stays centered. A fourth
value is ignored silently. `align="bottom"` → `ValueError: 'bottom' is not a valid Align`.
Faces: top at z=5 normal +Z, front face at y=−15 normal −Y.
- 📌 doc: align semantics with numbers.

### 05-box-edge-cases.py
0 or negative size → `ValueError: box dimensions must be positive` (not a ModelingError).
1e-4 thick: valid, volume 1e-4. 1e-7 thick: `is_valid()` True but volume 0.0 (below the
kernel tolerance; silently degenerate). 1e5 and 1e6 sizes work. String size → TypeError.
numpy floats work.
- 📌 doc: ValueError; no check for sizes below tolerance.

### 06-cylinder.py
Cylinder(5, 20): bbox (−5, −5, −10)..(5, 5, 10); volume 1570.796411 vs πr²h 1570.796327
(relative 5e-8, integration accuracy). 3 faces (cylinder + 2 planes), `edges()` = 2 circles at
z = ±10, `edges(seams=True)` = 3. Cylinder face: radius 5, axis origin (0,0,−10) dir +Z.
`Align.MIN` puts the axis at (5, 5): the whole cylinder in the positive octant.
0/negative → `ValueError: radius and height must be positive`. `angle=` → TypeError (no
partial cylinders). Disk 50×0.5 and needle 0.01×100 are valid.
![cyl](files/06-cylinder-cyl.png)
- 📌 doc: use (C, C, MIN) to stand it on XY; Align.MIN moves the axis off the origin.

### 07-partial-cylinder.py
Half cylinder via `Cylinder(10, 20) & Box(20, 20, 20, align=(C, MIN, C))`: volume 3141.59,
bbox y 0..10. Quarter via `Rectangle(10, 20, align=(MIN, C)).on(Plane.front).revolve(Z, 90)`:
volume 1570.8, bbox x 0..10, y 0..10 (revolves from +X towards +Y).
- 📌 doc: the two workarounds.

### 08-cone.py
Cone(10, 4, 15): bbox z −7.5..7.5, bottom circle r 10 at z −7.5, top r 4 at z 7.5. Volume
2450.4421 vs formula 2450.4423. Centered on the bbox, not on the center of mass (z −2.02).
Cone(10, 0, 15): 2 faces, apex vertex (0, 0, 7.5). Cone(0, 10, 15): apex at the bottom.
Cone(5, 5, 10) makes a cylinder face. 0/0, zero height, negative radii →
`ValueError: invalid cone dimensions`. Top radius 1e-6 → treated as a point cone (2 faces).
STEP export (snapshot) printed `RuntimeWarning: invalid value encountered in divide` from
step.py:310.
![cones](files/08-cone-cones.png)

### 09-cone-step-roundtrip.py
Export + import_step: frustum and Cone(10, 0, 15) round-trip with the same volume.
**Cone(0, 10, 15) comes back with volume 3141.593 instead of 1570.797** and the warning. The
cone face's `interior_point()` is the apex (0, 0, −7.5), so the STEP writer cannot decide the
face sense. **Defect HIGH** (todo #1).

### 10-inverted-cone-step-in-part.py
A box with a drill-tip cut (`Box − Cone(0, 5, 10)`) round-trips fine. `Cone(10, 0, 15).rotate(X, 180)`
(same geometry as the inverted cone) round-trips fine. So only a part whose cone face has
the apex at the start of the parameter range is hit. Box + inverted cone touching in one point
→ `solids()` = 1, but STEP import gives two Parts, 9000 + cone.
- 📌 doc (Cone): build an apex-down cone as `Cone(r, 0, h).rotate(X, 180)` when it is exported alone.

### 11-sphere.py
Sphere(8): bbox ±8, 1 face, `edges()` empty (only a seam, `edges(seams=True)` = 1), 2 vertices
(poles). Volume 2144.661 vs 2144.6606. `Align.MIN` → 0..16. Hemisphere via `& Box(16, 16, 8,
align=(C, C, MIN))` → volume 1072.34 (expected 1072.33), 2 faces, valid; fused on a plate: valid.

### 12-torus.py
Torus(20, 4): bbox (−24, −24, −4)..(24, 24, 4), 1 face (torus), `edges()` empty, 2 seams.
Volume 6316.548 vs 2π²Rr² 6316.5468. `face.radius` = 4 (the minor radius), `face.axis` = Z.
`center()` has 1e-6 noise. Repr shows volume=6316.8 (the repr uses accuracy 1e-5).
minor ≥ major, minor ≤ 0 → `ValueError: need 0 < minor_radius < major_radius`.
`.rotate(X, 90)` stands it up: bbox y ±4.
- 📌 doc: repr volume is approximate; use `.volume`.

### 13-wedge.py
**Wedge(20, 10, 8): bbox y −10..10 (width 20, not 10), volume 1600 (expected 800).** The ramp
runs along X: vertical face at x = −10 (high side), slope down to the edge at x = +10, z = −4;
sloped face normal (0.371, 0, 0.928). Docstring says the top edge is "at the back (+Y)": wrong.
`top_length=5` → flat top from x = −10 to −5, volume 2000 (expected 1000). `top_length=20` → a box;
`top_length=30` → overhang to x = 20, still valid.
![wedge2](files/13-wedge-wedge2.png)
**Defects** (todo #3 width doubled, #4 docstring direction, #5 no validation).

### 14-wedge-edge-cases.py
length 0 → `KernelError: sketch failed (SM_ERR)`; width 0 → `ValueError: extrude amount must not
be zero`; height 0 → KernelError. Negative length, width, height, top_length → accepted silently.
align works like for Box (bbox based). `Wedge(20, 5, 8)` gives the intended 20×10×8 ramp, volume 800.

### 15-wedge-negative.py
Negative length mirrors the ramp (high side at +X); negative height turns it upside down (flat
face on top). Negative width is the same as positive.

### 16-part-metadata-validity.py
`colored()` accepts anything ("notacolor", 42); the error comes only at export:
`ValueError: unknown color 'notacolor'` from export_step and export_gltf. `named(123)` is
accepted. Tuples with a value > 1 are read as 0..255. Names reach the STEP file.
Revolving a rectangle that crosses its axis: volume −785.4 and `is_valid()` True.
**Defect** (todo #6: is_valid misses a self-intersecting body).
- 📌 doc: check `volume > 0` as well as is_valid.

### 17-realistic-block.py
Base plate on XY, boss, cone tip, Wedge gusset. First version with the gusset face only touching
the boss cylinder (x = −10): `is_valid()` False, no error. With 1 mm overlap: valid, one solid,
bbox (−30, −20, 0)..(30, 20, 34).
![block](files/17-realistic-block-block.png)

### 18-tangent-rib.py
A box face tangent to a cylinder, fused: 11 faces, `is_valid()` False, 1 solid, no exception.
With 1 mm overlap: 7 faces, valid. Same for the rib at x −10 (invalid) vs −9.5 / −9 (valid).
**Defect MEDIUM** (todo #7): fuse returns an invalid part silently on line tangency.

## Coverage

- [x] every API ran
- [x] every parameter and align value tried (Box, Cylinder, Cone, Sphere, Torus, Wedge)
- [x] defaults measured
- [x] edge and error cases with messages
- [x] realistic use (17)
- [x] spatial claims backed by bbox/vertex numbers
- [x] every question answered: align (04, 06, 08, 11, 12, 14), sizes (05, 06, 08, 14), partial
  shapes (07, 11), Wedge (13–15), several bodies (02, 03), metadata (01, 16)

### 19-doc-generic.py, 20-doc-primitives.py, 21-doc-wedge.py, 22-doc-checks.py
The examples of the docs, run unchanged. 19: plate with four holes → `Part('plate', 10 faces,
volume=18295.2)`, valid, 1 solid; two boxes → 2 solids; `sum()` of 4 cylinders → 4 solids.
20: all bboxes as commented. 21: `Wedge(20, 5, 8)` bbox (−10, −5, −4)..(10, 5, 4), volume 800;
top vertices at x = −10; mirror → +X; `rotate(Z, -90)` → high side at y = +10. 22: quarter
torus by revolving `Circle(4).translate(20, 0, 0)` on `Plane.front` 90° about Z: volume 1579.17
(formula 1579.137), bbox 0..24 in x and y; `colored("lightgreen")` fails at export with
`ValueError: unknown color 'lightgreen'`; spherical cap 3 mm → volume 197.92 = formula.

Docs written: generic, Box, Cylinder, Cone, Sphere, Torus, Wedge.
