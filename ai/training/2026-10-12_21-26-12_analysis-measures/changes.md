diff --git a/src/smlibpy/skill/references/analysis/generic.md b/src/smlibpy/skill/references/analysis/generic.md
new file mode 100644
index 0000000..1f1982e
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/generic.md
@@ -0,0 +1,75 @@
+# Analysis: accuracy, units, validity
+
+How exact the numbers are that you verify a model with, and what to check after each step.
+
+## Units
+
+Lengths in mm, areas in mm², volumes in mm³. `mass = density * volume`: with `density` in g/mm³
+the mass is in g and the inertia in g·mm². Steel is `7.85e-3` g/mm³, aluminium `2.70e-3`.
+
+## How exact the numbers are
+
+| Measure | Source | Typical relative error |
+|---|---|---|
+| `bbox()` of a body | exact geometry | below 1e-9; tight, not padded |
+| `Edge.length` | integration along the curve | 1e-11 (lines exact) |
+| `volume`, `area`, `center()` of planar bodies | integration | exact (1e-15) |
+| `volume`, `area`, `center()` of curved bodies | integration at `accuracy=1e-7` | 1e-8 to 3e-7 |
+| `volume` of swept, wound, bent bodies (springs, threads, pipes) | same | 2e-6 to 1.5e-5 |
+| `Face.area`, `Sketch.area` | integration at 1e-7 | 1e-8 to 3e-7 |
+| `mesh().volume` | triangles | 1e-5 to 4e-4, depends on `tolerance` |
+
+- Volume, area, center and inertia are integrated over the exact NURBS geometry, never a mesh.
+- The error is about 1 to 3 times the requested `accuracy`, not "far below" it. On swept
+  bodies the kernel controls its steps by the area only, so the volume can be 100 times worse
+  than asked (a triangle swept along a 20-turn helix: 1.4e-5 at the default).
+- Position does not matter: the same body at the origin, rotated, or moved to 1e6 gives the
+  same numbers to 1e-7. Integration runs about the body's bounding-box center.
+- Rotating a body that has B-spline edges changes its geometry slightly: expect the measures
+  of a transformed body to agree with the original to 1e-7 relative, not better.
+- Curve constructions are fits: `Helix` is a NURBS approximation 2e-6 shorter than the
+  formula, and bodies swept along it inherit that.
+- `mass_properties(accuracy=1e-10)` brings curved bodies to 1e-10. It costs 5 to 200 times
+  more time (a 20-turn spring: 0.14 s -> 3.4 s; a bent pipe at 1e-11: 27 s).
+
+Compare against formulas with a relative tolerance: `1e-6` for analytic bodies, `1e-4` for
+sweeps and lofts. Never compare floats with `==`.
+
+## What to check after each modeling step
+
+```python
+plate = Box(80, 60, 10)
+plate = plate.fillet(plate.edges().parallel_to(Z), 8)
+plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)
+
+# after every step: valid, one solid, volume against a formula, outer size
+expected = 80 * 60 * 10 - 4 * (8 * 8 - math.pi * 8 * 8 / 4) * 10 - 4 * math.pi * 4 * 4 * 10
+print(plate.is_valid(), len(plate.solids()))           # True 1
+print(abs(plate.volume - expected) / expected < 1e-6)  # True
+print(plate.bbox().size)                               # Vector(80, 60, 10)
+print(plate.info()["faces"])                           # 14
+```
+
+1. `is_valid()` is `True`. It checks topology only (closed, manifold); see `is_valid`.
+2. `len(part.solids()) == 1` unless you meant several bodies. Disjoint pieces stay one `Part`.
+3. `volume > 0` and close to a formula. This catches what `is_valid()` misses: a self-overlapping
+   sweep counts the overlap twice, a revolve across its axis has volume 0.
+4. `bbox().size` equals the planned outer size; `bbox().min`/`max` show which side a feature
+   went to.
+5. The face count changed by the expected amount (`info()["faces"]`).
+
+## Gotchas
+
+- Every `volume`, `area` and `center()` call integrates the whole body again. When you need
+  several values, call `mass_properties()` once and read its fields.
+- Only `Part` has `volume`, `mass_properties()` and `is_valid()`. `Shell` and `Sketch` have
+  `area` and `center()` only (`AttributeError` otherwise); all bodies have `info()` and `bbox()`.
+- `center()` means different things: the centroid for parts, faces, sketches and shells; the
+  point halfway along the curve for edges; a length-weighted average of edge midpoints for
+  wires; the plain average of the members for a `ShapeList`. See `measures`.
+- The bbox of a standalone curve (not from a body) is sampled at 33 points and can be too
+  small for a wavy spline. Bodies and edges taken from bodies are exact.
+
+## Related
+
+`mass_properties`, `measures`, `is_valid`, `distance_to`, `recipes/verification`
diff --git a/src/smlibpy/skill/references/analysis/mass_properties.md b/src/smlibpy/skill/references/analysis/mass_properties.md
new file mode 100644
index 0000000..3d64374
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/mass_properties.md
@@ -0,0 +1,91 @@
+# mass_properties
+
+Mass, volume, area, center of mass and inertia tensor of a `Part`, in one integration.
+
+## Signature
+
+`part.mass_properties(density=1.0, accuracy=None) -> MassProperties`
+
+- `density`: mass per mm³, uniform. `7.85e-3` (steel, g/mm³) gives grams and g·mm².
+- `accuracy`: relative accuracy of the integration. `None` (and `0`) mean the default 1e-7.
+
+## Returns
+
+A `MassProperties` with plain attributes:
+
+| Field | Meaning |
+|---|---|
+| `mass` | `density * volume` |
+| `volume` | mm³, independent of density |
+| `area` | total surface area in mm², cavities included |
+| `center` | center of mass, a `Vector` in world coordinates |
+| `inertia` | 3x3 numpy array about the center of mass, axes parallel to the world axes |
+| `principal_moments` | the eigenvalues of `inertia`, ascending |
+| `principal_axes` | unit `Vector`s, in the order of `principal_moments` |
+| `density` | the density passed in |
+
+`inertia` is the standard tensor: the diagonal holds Ixx, Iyy, Izz; the off-diagonals hold the
+**negated** products of inertia (`inertia[0][1] = -∫(x-cx)(y-cy) dm`). An L-shaped part with
+its mass in +x/-y and -x/+y gives a positive `inertia[0][1]`.
+
+## Accuracy
+
+Checked against formulas at the default accuracy: box exact; cylinder, cone, sphere, torus
+volume and inertia to 1e-7 to 4e-7; the center lies within about 1e-6 of the exact point
+(3e-6 for a cylinder 100 long). The same body rotated or moved to 1e6 gives the same numbers.
+
+| `accuracy` | sphere volume error | time (sphere) |
+|---|---|---|
+| 1e-4 | 9e-5 | 3 ms |
+| 1e-7 (default) | 2e-7 | 28 ms |
+| 1e-8 | 1.5e-8 | 47 ms |
+| 1e-10 | 3e-10 | 185 ms |
+
+Swept bodies are slower and worse: a 20-turn spring takes 0.14 s at the default and 3.4 s at
+1e-10; a triangle swept along a helix is 1.4e-5 off at the default, 5e-7 at 1e-9 and 1e-7 at
+1e-10. Ask for `accuracy=1e-10` when a swept volume must be exact.
+
+## Gotchas
+
+- `density <= 0` is silently replaced by 1: `mass_properties(density=0).mass` equals the
+  volume. Pass a positive density.
+- Too tight an accuracy fails: 1e-12 on a sphere and 1e-14 on anything raise
+  `KernelError: mass properties failed (SM_ERR): is the part a closed solid?`. The hint is
+  misleading; the part is fine, the accuracy is too small. Stay at 1e-10 or above.
+- `accuracy=1` or `0.5` is accepted and returns a volume 2 % off.
+- A part made of several disjoint solids gives the properties of all of them together.
+- Only `Part` has it. For a `Shell` or `Sketch` use `area` and `center()`.
+- `part.volume`, `part.area` and `part.center()` each run the full integration again at the
+  default accuracy. One `mass_properties()` call is cheaper when you need several.
+
+## Errors
+
+- `KernelError: mass properties failed (SM_ERR): is the part a closed solid?` for an accuracy
+  below about 1e-11 or a negative one. Use 1e-10.
+
+## Example
+
+```python
+shaft = Cylinder(10, 100)
+mp = shaft.mass_properties(density=7.85e-3)     # steel, g/mm^3 -> grams
+m = 7.85e-3 * math.pi * 10**2 * 100
+print(round(mp.mass, 3), round(m, 3))           # 246.615 246.615
+print(mp.center)                                # about (0, 0, 0), off by up to 3e-6
+izz = mp.inertia[2][2]                          # g*mm^2, about the center of mass
+print(abs(izz - m * 10**2 / 2) / izz < 1e-6)    # True
+print(mp.principal_moments)                     # ascending: about (12330.8, 211678, 211678)
+
+precise = shaft.mass_properties(accuracy=1e-10)
+print(precise.volume)                           # 31415.9265...
+```
+
+Inertia about another point `p` (parallel axis theorem, checked on a box corner):
+
+```python
+d = p - np.array(mp.center.to_tuple())
+I_p = mp.inertia + mp.mass * (d.dot(d) * np.eye(3) - np.outer(d, d))
+```
+
+## Related
+
+`measures` (volume, area, center), `generic` (accuracy), `is_valid`
diff --git a/src/smlibpy/skill/references/analysis/measures.md b/src/smlibpy/skill/references/analysis/measures.md
new file mode 100644
index 0000000..02cbd1a
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/measures.md
@@ -0,0 +1,70 @@
+# Measures: volume, area, center, length
+
+The single numbers of each shape type. All are exact-geometry integrations (see `generic`).
+
+## Which shape has what
+
+| Shape | `volume` | `area` | `center()` | `length` | `bbox()` |
+|---|---|---|---|---|---|
+| `Part` | mm³ | total surface, cavities included | center of mass | - | tight |
+| `Shell` | - | sum of face areas | area centroid | - | tight |
+| `Sketch` | - | region area, holes removed | area centroid | - | tight |
+| `Face` | - | area | area centroid (may lie off the face) | - | tight |
+| `Wire` | - | - | length-weighted average of edge midpoints | sum of edges | union of edges |
+| `Edge` | - | - | point halfway along the edge | arc length | tight on bodies |
+| `Vertex` | - | - | the point | - | the point |
+| `ShapeList` | - | - | plain average of the members' centers | - | union |
+
+`volume`, `area` and `length` are properties; `center()` and `bbox()` are methods.
+
+## Accuracy
+
+- `Part.volume`, `Part.area`, `Part.center()`: integration at 1e-7; box exact, curved
+  primitives 1e-8 to 3e-7, swept bodies up to 1.5e-5. For more, use
+  `mass_properties(accuracy=1e-10)`; these properties take no accuracy argument.
+- `Face.area`, `Sketch.area`, `Shell.area`: 1e-7, fixed. Measured: cylinder face 9e-8, sphere
+  1.3e-7, torus 2.4e-7, ring sketch 1.6e-8.
+- `Edge.length`: lines exact, circles and arcs 5e-12, ellipses 8e-11, splines 3e-9.
+
+## Gotchas
+
+- **`Edge.center()` of an arc or circle is a point on the curve**, not the circle's center.
+  Use `edge.arc_center` and `edge.radius`. `part.edges().circles().center()` of a cylinder's
+  two rims is `(-6, 0, 0)`, a point on the rim, not the axis.
+- `Wire.center()` is not the centroid of a curved wire: a semicircle plus its diameter gives
+  y = 6.11 instead of 3.89. It is right for straight segments.
+- `ShapeList.center()` is not weighted: `part.faces().center()` averages the face centers
+  regardless of their size. For a centroid use the body's `center()`.
+- `Face.center()` of a curved face is the area centroid and may lie off the face (a
+  half-cylinder face of radius 10 gives a point 2r/π = 6.366 from the axis). Use
+  `face.interior_point()` for a point on the face.
+- Every call of `Part.volume`, `area` or `center()` integrates again (a sphere: 28 ms each).
+  Store the value or use `mass_properties()`.
+- `Shell` and `Sketch` have no `volume` (`AttributeError`). A cylinder has 3 edges with seams
+  (`part.edges(seams=True)`), 2 without; seams do not change `area` or `volume`.
+- `Sketch.area` stays the same wherever the sketch is placed (`.on(tilted_plane)`); its
+  `center()` moves with it.
+- A standalone spline edge's `bbox()` (made with `Spline`, not taken from a body) is sampled
+  at 33 points and can be too small (0.07 mm on a 35 mm wavy spline). A body's bbox is exact.
+
+## Example
+
+```python
+part = Box(40, 30, 20) - Cylinder(6, 30)
+print(round(part.volume, 4))                    # 21738.0534 = 24000 - pi*36*20
+
+hole = part.faces().filter_by(lambda f: f.geom_type == "cylinder").one()
+print(round(hole.area, 4), hole.radius)         # 753.9823 6.0
+
+rim = part.edges().circles().sort_by(Z)[-1]     # top edge of the hole
+print(rim.arc_center, rim.radius)               # Vector(0, 0, 10) 6.0
+print(rim.center())                             # a point ON the circle, not its center
+print(round(rim.length, 6))                     # 37.699112 = 2*pi*6
+
+ring = Circle(10) - Circle(4)
+print(round(ring.area, 5), ring.center())       # 263.89379 (about 0, 0, 0)
+```
+
+## Related
+
+`mass_properties`, `generic`, `distance_to`, `selection/*` for picking faces and edges
diff --git a/src/smlibpy/skill/references/analysis/is_valid.md b/src/smlibpy/skill/references/analysis/is_valid.md
new file mode 100644
index 0000000..6ba913b
--- /dev/null
+++ b/src/smlibpy/skill/references/analysis/is_valid.md
@@ -0,0 +1,69 @@
+# is_valid, info
+
+`part.is_valid()` tells whether a `Part` is a closed, manifold solid. `body.info()` returns its
+counts and bounding box in one dictionary.
+
+## Signature
+
+`part.is_valid() -> bool` (only on `Part`)
+
+`body.info() -> dict` (on `Part`, `Shell`, `Sketch`)
+
+```python
+{'type': 'Part', 'faces': 6, 'edges': 12, 'vertices': 8,
+ 'bbox': ((-5.0, -10.0, -15.0), (5.0, 10.0, 15.0))}
+```
+
+`bbox` is `(min, max)` as plain tuples. Edge counts include seam edges (a cylinder: 3), so
+`info()["edges"]` can be larger than `len(part.edges())`.
+
+## What valid means
+
+Topology only: every edge has exactly two faces and the faces close up. It does **not**
+check the geometry.
+
+| Body | `is_valid()` | Volume |
+|---|---|---|
+| primitives, Booleans, fillets, shells | True | right |
+| two disjoint boxes in one `Part` | True | sum; `len(part.solids()) == 2` |
+| two boxes touching along an edge, fused | **False** | 2000 |
+| two boxes touching at a corner, fused | True | 2000 |
+| spring whose profile overlaps the next turn | **True** | overlap counted twice |
+| rectangle revolved about an axis through it | **True** | about 0 |
+
+So `is_valid()` is necessary but not enough. Also check:
+
+- `volume > 0` and close to a formula: catches self-overlapping sweeps and revolves across the
+  axis. No Boolean repairs a self-overlapping body (fuse, cut and intersect keep the doubled
+  volume and stay "valid").
+- `len(part.solids()) == 1` when you meant one body.
+- the picture (`snapshot(view="sheet")`): a body with volume 0 still looks like a cylinder.
+
+## Gotchas
+
+- `Shell` and `Sketch` have no `is_valid()` (`AttributeError`). Check `info()` and `area`.
+- Mirrored and negatively scaled parts stay valid with positive volume and outward normals.
+
+## Example
+
+```python
+def check(part, expected_volume, rel=1e-5):
+    assert part.is_valid(), "not a closed manifold solid"
+    assert len(part.solids()) == 1, f"{len(part.solids())} solids"
+    v = part.volume
+    assert v > 0 and abs(v - expected_volume) <= rel * expected_volume, f"volume {v}"
+    return part.info()
+
+print(check(Box(10, 20, 30), 6000))
+# {'type': 'Part', 'faces': 6, 'edges': 12, 'vertices': 8, 'bbox': ((-5.0, -10.0, -15.0), (5.0, 10.0, 15.0))}
+
+bad = Rectangle(10, 10).revolve(Axis((0, 0, 0), (0, 1, 0)))   # profile crosses the axis
+print(bad.is_valid(), bad.volume)                              # True, about 0: is_valid misses it
+
+edge_touch = Box(10, 10, 10) + Box(10, 10, 10).translate(10, 10, 0)
+print(edge_touch.is_valid())                                   # False: the boxes share only an edge
+```
+
+## Related
+
+`generic` (what to check after each step), `mass_properties`, `Part.solids`, `heal`
