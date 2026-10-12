diff --git a/src/smlibpy/skill/references/parts/generic.md b/src/smlibpy/skill/references/parts/generic.md
new file mode 100644
index 0000000..8ee25e5
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/generic.md
@@ -0,0 +1,82 @@
+# Part
+
+A `Part` is a solid: one or more closed bodies held in one kernel Brep. Primitives, extrusions,
+revolves, lofts, sweeps and Booleans return Parts.
+
+## Making one
+
+You never call `Part()` (it raises `TypeError: create a Part with the constructors`). Use
+`Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge`, `sketch.extrude(...)`,
+`sketch.revolve(...)`, `loft`, `sweep`, or combine parts with `+`, `-`, `&`.
+
+Every operation returns a new Part; the input is unchanged. Reassigning is the normal style:
+`plate -= Cylinder(3, 20)`.
+
+## What a Part knows
+
+| Member | Returns | Notes |
+|---|---|---|
+| `volume`, `area` | float | exact integration, relative accuracy about 1e-7 |
+| `center()` | Vector | center of mass, not the bbox center |
+| `bbox()` | BoundBox | tight; `.min`, `.max`, `.size` |
+| `is_valid()` | bool | closed manifold solid; see the gotchas |
+| `solids()` | ShapeList[Part] | the separate bodies, each with the part's name and color |
+| `info()` | dict | `type`, `faces`, `edges`, `vertices` (kernel counts, seams included), `bbox` |
+| `faces()`, `edges()`, `vertices()` | ShapeList | see `selection/*` |
+| `name`, `color` | None by default | set with `named()` / `colored()` |
+| `repr(part)` | `Part('plate', 10 faces, volume=18295.2)` | |
+
+## Name and color
+
+`part.named("plate")` and `part.colored("steelblue")` return copies with metadata. Exporters
+(STEP, glTF) and the viewer use them. Colors: one of about 60 CSS names (`"red"`,
+`"steelblue"`, `"gold"`, ...), `"#4682b4"`, `"#48b"`, or a tuple `(r, g, b)` in 0..1 (any value
+above 1 switches to 0..255).
+
+Metadata survives `translate`, `rotate`, cuts and `solids()`. A Boolean keeps the left
+operand's name and color: `Cylinder(2, 10).colored("red") + plate` is red and unnamed. Name
+and color the finished part last.
+
+## Several bodies in one Part
+
+Fusing disjoint parts, or a cut that splits a part, gives one Part with several bodies.
+`len(part.solids())` tells you how many. `sum([...])` of parts works. Before delivering a
+part that should be one piece, check `len(part.solids()) == 1`.
+
+## Gotchas
+
+- `info()["edges"]` counts seam edges; `len(part.edges())` does not (a cylinder: 3 vs 2).
+- `repr` computes the volume with accuracy 1e-5 and prints six digits, so the last digit can
+  be off (`Torus(20, 4)`: repr 6316.8, `.volume` 6316.548). Use `.volume` for numbers.
+- `is_valid()` can be True for a broken body: a revolve whose profile crosses the axis gives
+  volume −785 and `is_valid()` True. Check `volume > 0` as well.
+- A fuse where a face only touches a curved face (tangent contact) gives `is_valid()` False
+  without an error. See `booleans`.
+- `solids()` does not separate a body that floats inside a cavity of another body: it reports
+  one solid.
+- `colored()` accepts any value; an unknown color name fails only at export
+  (`ValueError: unknown color 'lightgreen'`).
+- `part.name = "x"` mutates the part in place. Use `named()`.
+- Primitive size errors are `ValueError`, not `ModelingError`. Kernel failures are
+  `KernelError` (a `ModelingError`).
+
+## Example
+
+```python
+plate = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
+plate -= GridLocations(40, 20, 2, 2) * Cylinder(3, 20)
+plate = plate.named("plate").colored("steelblue")
+print(plate)                      # Part('plate', 10 faces, volume=18295.2)
+print(plate.is_valid(), round(plate.volume, 3), len(plate.solids()))
+print(plate.info())
+
+pair = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
+print(len(pair.solids()), [round(s.volume, 3) for s in pair.solids()])   # 2 [1000.0, 1000.0]
+pins = sum(Cylinder(2, 10).translate(i * 10, 0, 0) for i in range(4))    # one Part, 4 bodies
+print(len(pins.solids()))
+```
+
+## Related
+
+`Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge`, `booleans`, `Hole`;
+`analysis/*` for mass properties and distances; `selection/*` for faces and edges.
diff --git a/src/smlibpy/skill/references/parts/Box.md b/src/smlibpy/skill/references/parts/Box.md
new file mode 100644
index 0000000..d4dbc33
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/Box.md
@@ -0,0 +1,58 @@
+# Box
+
+A rectangular block, edges parallel to the world axes.
+
+## Signature
+
+`Box(length, width, height, *, align=Align.CENTER)`
+
+- `length` along X, `width` along Y, `height` along Z. mm.
+- `align`: one `Align` for all axes, or a tuple per axis `(x, y, z)`. See below.
+
+## Returns
+
+A `Part` with 6 planar faces, 12 edges, 8 vertices. Centered on the origin by default:
+`Box(40, 30, 10)` spans x −20..20, y −15..15, z −5..5.
+
+## Align
+
+`align` moves the box by its bounding box, per axis:
+
+| Value | Axis range |
+|---|---|
+| `Align.CENTER` (default), `None` | −size/2..size/2 |
+| `Align.MIN` | 0..size (the box starts at the origin) |
+| `Align.MAX` | −size..0 (the box ends at the origin) |
+
+- Strings work too, case-insensitive: `"min"`, `"center"`, `"MAX"`.
+- `(Align.CENTER, Align.CENTER, Align.MIN)` stands the box on the XY plane: the usual base plate.
+- A tuple with two values aligns X and Y; Z stays centered. Extra values are ignored.
+- `None` in a tuple means "no move" on that axis, which for a box is the same as CENTER.
+- A wrong string raises `ValueError: 'bottom' is not a valid Align`.
+
+## Gotchas
+
+- `Align.MIN` alone moves all three axes: the box sits in the positive octant, not only on XY.
+- Faces of a fresh box: top at z = +height/2 with normal +Z, front at y = −width/2 with normal −Y.
+  Select them with `box.faces().top()`, `.front()`, ... rather than by index.
+- No rotation parameter. Turn it afterwards: `Box(...).rotate(Z, 30)`.
+- A size below the kernel tolerance (1e-7) is not refused: the part is "valid" with volume 0.
+
+## Errors
+
+- Zero or negative size: `ValueError: box dimensions must be positive` (a `ValueError`, not a
+  `ModelingError`).
+- A string size: `TypeError`.
+
+## Example
+
+```python
+block = Box(40, 30, 10)                                                  # x -20..20, y -15..15, z -5..5
+plate = Box(80, 60, 6, align=(Align.CENTER, Align.CENTER, Align.MIN))    # z 0..6, stands on XY
+corner = Box(10, 10, 10, align=Align.MIN)                                # 0..10 on every axis
+print(block.bbox(), plate.bbox(), corner.bbox())
+```
+
+## Related
+
+`Cylinder`, `Wedge`, `generic` (Part), `booleans`, `features/fillet`, `geometry/Align`.
diff --git a/src/smlibpy/skill/references/parts/Cylinder.md b/src/smlibpy/skill/references/parts/Cylinder.md
new file mode 100644
index 0000000..58919dc
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/Cylinder.md
@@ -0,0 +1,55 @@
+# Cylinder
+
+A solid circular cylinder with its axis along Z.
+
+## Signature
+
+`Cylinder(radius, height, *, align=Align.CENTER)`
+
+- `radius`, `height` in mm. There is no `angle` parameter (no partial cylinders) and no
+  direction parameter.
+- `align`: per axis, as for `Box` (bounding-box based).
+
+## Returns
+
+A `Part` with 3 faces (one cylindrical, two planar), 2 circular edges (`edges()`; plus one seam
+with `edges(seams=True)`), 2 vertices. Default: axis on the Z axis, z −height/2..height/2.
+`Cylinder(5, 20)`: bbox (−5, −5, −10)..(5, 5, 10).
+
+The cylindrical face reports `face.radius` (5.0) and `face.axis` (origin at the bottom,
+direction +Z).
+
+## Gotchas
+
+- To stand it on XY keep the axis on Z: `align=(Align.CENTER, Align.CENTER, Align.MIN)` → z 0..20.
+  `align=Align.MIN` also shifts X and Y, so the axis ends up at (radius, radius).
+- A centered cylinder reaches height/2 above and below its center. As a through-hole tool make it
+  longer than the part is thick: `plate - Cylinder(3, 20)` for an 8 mm plate on z 0..8 cuts
+  from z −10 to 10.
+- Along another axis: rotate it. `Cylinder(3, 50).rotate(Y, 90)` lies along X (x −25..25).
+- Partial cylinder: intersect with a box, or revolve a rectangle:
+  `Cylinder(10, 20) & Box(20, 20, 20, align=(Align.CENTER, Align.MIN, Align.CENTER))` is the half
+  with y ≥ 0; `Rectangle(10, 20, align=(Align.MIN, Align.CENTER)).on(Plane.front).revolve(Z, 90)`
+  is the quarter from +X to +Y.
+- A flat box face that only touches the side of a cylinder (tangent) makes an invalid fuse; let
+  the bodies overlap. See `booleans`.
+
+## Errors
+
+- `radius <= 0` or `height <= 0`: `ValueError: radius and height must be positive`.
+- `Cylinder(5, 10, angle=180)`: `TypeError: unexpected keyword argument 'angle'`.
+
+## Example
+
+```python
+pin = Cylinder(5, 20)                                                    # axis = Z, z -10..10
+post = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))    # axis stays on Z, z 0..20
+rod = Cylinder(3, 50).rotate(Y, 90)                                      # along X, x -25..25
+half = Cylinder(10, 20) & Box(20, 20, 20, align=(Align.CENTER, Align.MIN, Align.CENTER))  # y >= 0
+print(pin.bbox(), post.bbox(), rod.bbox(), half.bbox(), round(half.volume, 2))
+```
+
+## Related
+
+`Hole` (a cylinder pointing down from the origin, for drilling), `Cone`, `Box`, `booleans`,
+`sketches/Circle` (`Circle(r).extrude(h)` for a cylinder on any plane).
diff --git a/src/smlibpy/skill/references/parts/Cone.md b/src/smlibpy/skill/references/parts/Cone.md
new file mode 100644
index 0000000..4ee2e6d
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/Cone.md
@@ -0,0 +1,48 @@
+# Cone
+
+A cone or frustum with its axis along Z.
+
+## Signature
+
+`Cone(bottom_radius, top_radius, height, *, align=Align.CENTER)`
+
+- `bottom_radius` at the low end (−Z), `top_radius` at the high end (+Z). One of them may be 0
+  for a pointed cone. Equal radii give a cylinder (the side face is then a `cylinder` face).
+- `align`: per axis, as for `Box` (bounding-box based).
+
+## Returns
+
+A `Part`, centered on its bounding box, not on its center of mass. `Cone(10, 4, 15)`: bottom
+circle r 10 at z −7.5, top circle r 4 at z 7.5; 3 faces (cone + 2 planes).
+`Cone(10, 0, 15)`: 2 faces, apex vertex at (0, 0, 7.5).
+
+Volume matches π·h·(R² + R·r + r²)/3 (2450.442 for 10/4/15).
+
+## Gotchas
+
+- The center of mass is not at the origin: `Cone(10, 4, 15).center().z` is −2.02.
+- To stand it on XY use `align=(Align.CENTER, Align.CENTER, Align.MIN)`; then the apex of
+  `Cone(10, 0, 15)` is at (0, 0, 15).
+- **Apex down and exported alone: build it as `Cone(10, 0, 15).rotate(X, 180)`, not
+  `Cone(0, 10, 15)`.** The second exports a STEP file that reads back with twice the volume (and
+  prints `RuntimeWarning: invalid value encountered in divide`). The geometry is the same. A part
+  with such a cone cut into it (`Box(30, 30, 30) - Cone(0, 5, 10)`) exports correctly.
+- A tiny radius (1e-6) is treated as 0: the cap face disappears.
+
+## Errors
+
+- Both radii 0, height ≤ 0, or a negative radius: `ValueError: invalid cone dimensions`.
+
+## Example
+
+```python
+frustum = Cone(10, 4, 15)                                                # r 10 at z -7.5, r 4 at z 7.5
+tip = Cone(10, 0, 15, align=(Align.CENTER, Align.CENTER, Align.MIN))     # apex at (0, 0, 15)
+apex_down = Cone(10, 0, 15).rotate(X, 180)                               # apex at (0, 0, -7.5)
+print(frustum.bbox(), [v.point for v in tip.vertices()], [v.point for v in apex_down.vertices()])
+```
+
+## Related
+
+`Cylinder`, `CounterSinkHole` (uses a cone for the sink), `booleans`,
+`sketches/Rectangle` + `extrude(taper=...)` for drafted prisms.
diff --git a/src/smlibpy/skill/references/parts/Sphere.md b/src/smlibpy/skill/references/parts/Sphere.md
new file mode 100644
index 0000000..5469a55
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/Sphere.md
@@ -0,0 +1,44 @@
+# Sphere
+
+A full sphere centered on the origin.
+
+## Signature
+
+`Sphere(radius, *, align=Align.CENTER)`
+
+- No angle parameters: there are no partial spheres. Cut one (see below).
+- `align`: per axis, as for `Box` (bounding-box based).
+
+## Returns
+
+A `Part` with one spherical face. `Sphere(8)`: bbox −8..8 on every axis, volume 4/3·π·r³
+(2144.661). `face.radius` is 8.
+
+## Gotchas
+
+- `sphere.edges()` is empty: the only edge is a seam (`edges(seams=True)` has 1). The two
+  vertices are the poles (0, 0, ±r). Do not select sphere edges for fillets.
+- `align=Align.MIN` puts the sphere in the positive octant (center at (r, r, r)). To sit it on
+  XY use `(Align.CENTER, Align.CENTER, Align.MIN)`: center at (0, 0, r).
+- Hemisphere or dome: intersect with a box,
+  `Sphere(8) & Box(16, 16, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))` → z 0..8, volume
+  1072.33. Fused onto a plate whose top is at z = 0 it gives one valid solid.
+- A cap of another height: intersect with a box placed at the cut height.
+  `Sphere(8) & Box(16, 16, 3, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 5)`
+  is the top 3 mm (z 5..8, volume 197.92 = π·h²·(3r − h)/3).
+
+## Errors
+
+- `radius <= 0`: `ValueError: radius must be positive`.
+
+## Example
+
+```python
+ball = Sphere(8)                                                         # -8..8
+dome = Sphere(8) & Box(16, 16, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))  # z 0..8
+print(ball.bbox(), dome.bbox(), round(dome.volume, 2))
+```
+
+## Related
+
+`Torus`, `Cylinder`, `booleans` (`&` to trim), `features/revolve`.
diff --git a/src/smlibpy/skill/references/parts/Torus.md b/src/smlibpy/skill/references/parts/Torus.md
new file mode 100644
index 0000000..203cebf
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/Torus.md
@@ -0,0 +1,43 @@
+# Torus
+
+A ring around the Z axis, centered on the origin.
+
+## Signature
+
+`Torus(major_radius, minor_radius, *, align=Align.CENTER)`
+
+- `major_radius`: from the Z axis to the center of the tube. `minor_radius`: the tube radius.
+  Requires 0 < minor < major (no spindle or horn tori).
+- `align`: per axis, as for `Box` (bounding-box based).
+
+## Returns
+
+A `Part` with one toroidal face. `Torus(20, 4)`: bbox x, y −24..24, z −4..4; volume 2π²·R·r²
+(6316.548); inner hole radius 16. `face.radius` is the minor radius (4), `face.axis` is Z.
+
+## Gotchas
+
+- `torus.edges()` is empty (two seams, `edges(seams=True)`), so there is nothing to fillet.
+- It lies flat in XY. To stand it up rotate it: `Torus(20, 4).rotate(X, 90)` lies in the XZ
+  plane (bbox y −4..4).
+- `align=(Align.CENTER, Align.CENTER, Align.MIN)` sets it on XY (z 0..8).
+- The repr shows the volume less precisely (`volume=6316.8`); use `.volume`.
+
+## Errors
+
+- `minor_radius >= major_radius` or `minor_radius <= 0`:
+  `ValueError: need 0 < minor_radius < major_radius`.
+
+## Example
+
+```python
+ring = Torus(20, 4)                                                      # x, y -24..24, z -4..4
+standing = Torus(20, 4).rotate(X, 90)                                    # in the XZ plane
+print(ring.bbox(), standing.bbox(), round(ring.volume, 3))
+```
+
+## Related
+
+`Sphere`, `Cylinder`, `features/revolve` (partial torus:
+`Circle(4).translate(20, 0, 0).on(Plane.front).revolve(Z, 90)`, the quarter from +X to +Y),
+`features/sweep` (a tube along any path).
diff --git a/src/smlibpy/skill/references/parts/Wedge.md b/src/smlibpy/skill/references/parts/Wedge.md
new file mode 100644
index 0000000..9acf848
--- /dev/null
+++ b/src/smlibpy/skill/references/parts/Wedge.md
@@ -0,0 +1,69 @@
+# Wedge
+
+A ramp: a prism whose cross section (in XZ) is a right triangle, or a right trapezoid with a
+flat top.
+
+## Signature
+
+`Wedge(length, width, height, top_length=0.0, *, align=Align.CENTER)`
+
+- `length` along X (the base), `height` along Z, `width` along Y (**see the first gotcha**).
+- `top_length`: length of a flat top, measured from the −X end. 0 gives a sharp top edge.
+- `align`: per axis, as for `Box` (bounding-box based).
+
+## Returns
+
+A `Part`. The high side is the vertical face at x = −length/2; the slope runs down to the edge
+at x = +length/2, z = −height/2. `Wedge(20, 5, 8)`: bbox (−10, −5, −4)..(10, 5, 4), 5 faces,
+volume 800. With `top_length` the top is flat from x = −length/2 to −length/2 + top_length
+(6 faces).
+
+## Gotchas
+
+- **The width comes out doubled: Y spans −width..width.** `Wedge(20, 10, 8)` is 20 wide, volume
+  1600. Pass half the width you want: `Wedge(20, 5, 8)` is 10 wide.
+- The docstring says the ramp rises "at the back (+Y)". It does not: it rises towards −X. Turn
+  it to face another way: `.mirror(Plane.YZ)` puts the high side at +X, `.rotate(Z, -90)` puts
+  it at +Y (the back).
+- No input checks: a negative length mirrors the ramp, a negative height turns it upside down,
+  a negative width or top_length is ignored; `top_length == length` gives a box and
+  `top_length > length` an overhang.
+- Against a curved face: a face that only touches a cylinder makes an invalid fuse. Let the
+  wedge reach into the other body.
+
+## Errors
+
+- `length == 0` or `height == 0`: `KernelError: sketch failed (SM_ERR)`.
+- `width == 0`: `ValueError: extrude amount must not be zero`.
+
+## Example
+
+```python
+# A ramp 20 long (X), 10 wide (Y), 8 high (Z): pass HALF the width
+ramp = Wedge(20, 5, 8)
+print(ramp.bbox(), round(ramp.volume, 3))           # x -10..10, y -5..5, z -4..4, volume 800
+print(sorted({(round(v.x, 3), round(v.z, 3)) for v in ramp.vertices()}))  # top edge at x = -10
+
+# Flat top 5 long, standing on XY
+step = Wedge(20, 5, 8, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
+print(step.bbox(), round(step.volume, 3))           # (20 + 5) / 2 * 8 * 10 = 1000
+
+# Top edge at +X instead: mirror it
+ramp_right = Wedge(20, 5, 8).mirror(Plane.YZ)
+print(sorted({(round(v.x, 3), round(v.z, 3)) for v in ramp_right.vertices()}))
+# Rising towards +Y (the back): turn it about Z
+ramp_back = Wedge(20, 5, 8).rotate(Z, -90)
+print(ramp_back.bbox(), sorted({(round(v.y, 3), round(v.z, 3)) for v in ramp_back.vertices()}))
+```
+
+A gusset next to a boss (high side against the boss, 1 mm into it):
+
+```python
+rib = Wedge(16, 2, 14, align=(Align.MIN, Align.CENTER, Align.MIN)).mirror(Plane.YZ).translate(-9, 0, 8)
+```
+
+(4 wide, x −25..−9, z 8..22; from scripts/17-realistic-block.py.)
+
+## Related
+
+`Box`, `sketches/Polygon` + `extrude` (any prism profile, exact width), `features/extrude`.
