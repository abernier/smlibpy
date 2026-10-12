diff --git a/src/smlibpy/skill/references/features/loft.md b/src/smlibpy/skill/references/features/loft.md
new file mode 100644
index 0000000..cea9883
--- /dev/null
+++ b/src/smlibpy/skill/references/features/loft.md
@@ -0,0 +1,83 @@
+# loft
+
+A solid through a series of cross sections (closed sections), or a surface through open curves.
+
+## Signature
+`loft(sections, *, ruled=False, smooth=True)`
+
+- `sections`: two or more, in order. Closed: sketches, planar faces, closed wires (`Polyline(..., close=True)`).
+  Open: edges or open wires (result is a `Shell`). Do not mix closed and open.
+- `ruled=True`: straight transitions between neighbouring sections (degree 1).
+- `smooth`: only matters with **four or more** sections (cubic instead of quadratic). With three
+  sections the loft is quadratic either way; with two it is always straight.
+- There is no `closed` option (no loft back to the first section).
+
+## Returns
+A `Part` for closed sections, a `Shell` for open curves. Sections are placed where they are:
+move them with `.translate(0, 0, z)` or `.on(plane)`. Sections may be tilted
+(`Circle(10).on(Plane(origin=(0, 0, 20), z_dir=(0, 0.5, 1)))`) and given in descending order.
+
+## How sections are matched
+The kernel joins the outer loops by where they start and how they are parametrized, and that
+depends on how each section was made (`Circle` has its seam at +X, `RegularPolygon(r, 6)` starts
+at -60°, a `Rectangle` at a corner). Do not predict it; measure it. **Sections whose starts do
+not suit each other give a twisted, pinched loft** that `is_valid()` still accepts:
+- `loft([Rectangle(20, 20), RegularPolygon(10, 6).translate(0, 0, 20)], ruled=True)` is an
+  hourglass (mid-section area 6.4 instead of ~320).
+- Fix polygons by drawing them as a closed `Polyline` whose first point lies in the same
+  direction as the other section's start (corner by corner).
+- Fix circles by turning them: `Circle(r).rotate(Z, 45)` suits a centered `Rectangle`. For other
+  shapes measure: try angles and keep the one with the largest middle section (example below).
+- Always check the middle: `part.section(Plane.XY.offset(mid)).area` against the average of the
+  end areas, and look at a snapshot.
+
+## Gotchas
+- **Holes in a section are dropped silently.** A ring section `Circle(10) - Circle(5)` lofted
+  to a `Circle(10)` 20 above gives the full cylinder (6283.19). Loft the outside, then subtract
+  a loft of the inside.
+- A section with two separate regions raises `ValueError: a loft section must be a single region`.
+- Smooth lofts overshoot between sections: a 15/25/10 vase reaches radius 25.047 at the bulge.
+  Use `ruled=True` when a section must stay the widest.
+- Sections out of order (z 0, 20, 10) loop back and overshoot (z max 20.37) without an error.
+- Open curves must run the same way: two lines in opposite directions make a bow-tie surface
+  (area 55.9 instead of 111.8). Single-edge open curves ignore `ruled`.
+- Two sections in the same plane: `KernelError: loft failed (SM_ERR_INVALID_INPUT): sections
+  should be closed, ordered and not intersect each other`.
+
+## Errors
+- `ValueError: loft needs at least two sections`
+- `ValueError: loft sections must be all closed (solid) or all open (surface)`
+- `ValueError: a loft section must be a single region`
+
+## Example
+```python
+vase = loft([Circle(15), Circle(25).translate(0, 0, 30), Circle(10).translate(0, 0, 60)])
+print(vase.is_valid(), vase.bbox().max.x)               # True 25.047: overshoots the 25 section
+
+cone = loft([Circle(10), Circle(5).translate(0, 0, 20)])  # two sections: straight sides
+print(round(cone.volume, 3))                            # 3665.192 = exact frustum
+
+# square to circle: turn the circle so its seam suits the square (45 for a centered Rectangle)
+duct = loft([Rectangle(30, 30), Circle(12).rotate(Z, 45).translate(0, 0, 25)])
+print(round(duct.section(Plane.XY.offset(12.5)).area, 1))  # 660.2 (unturned circle: 565.9)
+
+# square to hexagon: draw the hexagon as a closed Polyline that starts near the square's start
+hexagon = Polyline(*[(10 * math.cos(math.radians(120 + 60 * i)), 10 * math.sin(math.radians(120 + 60 * i)), 20)
+                     for i in range(6)], close=True)
+prism = loft([Rectangle(20, 20), hexagon], ruled=True)
+print(round(prism.volume, 1))                           # 6512.7 (RegularPolygon(10, 6): 2284.7, pinched)
+
+# pick the best seam angle by measuring the middle section
+base = Rectangle(30, 30)
+best = max(range(0, 360, 15), key=lambda a: loft([base, Circle(12).rotate(Z, a).translate(0, 0, 20)]).section(Plane.XY.offset(10)).area)
+print(best)                                             # 45
+
+sheet = loft([Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 5), (10, 10, 5))])  # open curves -> Shell
+print(type(sheet).__name__, round(sheet.area, 3))       # Shell 111.803
+```
+
+Shelling a loft: opening the bottom (planar polygon) face works; opening the circular top
+of the duct above fails (`shell failed`). Subtract an inner loft instead.
+
+## Related
+`sweep` (constant profile along a path), `extrude(taper=...)`, `ruled`, `surface`, `shell`.
diff --git a/src/smlibpy/skill/references/features/sweep.md b/src/smlibpy/skill/references/features/sweep.md
new file mode 100644
index 0000000..66bfe50
--- /dev/null
+++ b/src/smlibpy/skill/references/features/sweep.md
@@ -0,0 +1,87 @@
+# sweep
+
+Moves a profile along a path to make a solid (tubes, rails, springs, frames). An open profile
+makes a surface (`Shell`).
+
+## Signature
+`sweep(profile, path, *, orient=True, translational=False, sharp_corners=None)`
+`sketch.sweep(path, *, sharp_corners=None)` (no `orient`/`translational`)
+
+- `profile`: a sketch (holes allowed), a planar face or a closed wire. Draw it anywhere,
+  usually at the origin in XY.
+- `path`: an `Edge` or a connected `Wire` (`Polyline`, `FilletPolyline`, `Wire([...])`).
+- `orient=True`: turn the profile to stand perpendicular to the path at its start. Leave it on.
+- `translational=True`: keep the profile's orientation fixed (it does not turn with the path).
+  The profile then cuts the path at a slant; on an arc the volume is area × rise, not area ×
+  length. Useless on helices.
+- `sharp_corners`: for paths of several edges. Default: mitered corners for planar paths.
+  `False` sweeps each edge alone and fuses the pieces (notched corners). `True` on a 3D path
+  raises.
+- There is no twist or scale option.
+
+## Placement
+- The **bounding-box center** of the profile goes to the start of the path, wherever the
+  profile was drawn. You cannot offset a profile from its path; move the path instead.
+- The profile is turned by the smallest rotation from its normal to the path tangent. For a
+  path along Z it is unchanged. For a path along X, sketch x becomes Z; along Y, sketch y
+  becomes Z. Check with `bbox()`.
+- On a `Helix` around Z starting at (r, 0, 0) the sketch x axis points radially at the start.
+
+## Gotchas
+- **Profiles roll along a helix.** A `Rectangle(2, 1)` swept along a 6-turn helix turns about
+  the path by roughly 30° per turn (sections measure 2.11×1.25, then 1.59×2.22, ...). Circles
+  do not care; thread and spring-band profiles do. Workaround: loft through copies of the
+  profile placed along the helix with `x_dir` radial (example) — exact to 0.01%.
+- **A single closed 360° arc as path gives two solids and a negative volume**
+  (`sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))`). Use two half arcs or `revolve`.
+- Nothing checks self-intersection: a profile bigger than the path's bend radius, or a spring
+  wire thicker than the pitch, returns `is_valid() == True` with a volume of area × length
+  (too large). Keep profile radius < bend radius and wire diameter < pitch.
+- Non-planar polylines are swept piece by piece: the corners are notched (3D path of three
+  40 mm legs: 3320.9 instead of 3392.9). Round the corners with `FilletPolyline` instead.
+- A `Wire` of disconnected edges returns an invalid body without an error.
+- `orient=False` with a path that is not along the profile normal raises
+  `KernelError: sweep failed (SM_ERR): the profile may be too large for the path's curvature`
+  (the message is misleading).
+- Open profile (surface sweep) needs a single-edge path: `ValueError: surface sweeps need a
+  single-edge path`.
+
+## Checking
+Volume = profile area × path length for a perpendicular sweep that does not self-intersect:
+`math.pi * r**2 * path.length`. A mitered planar corner keeps that formula exactly.
+
+## Errors
+- `TypeError: a sweep path is an edge or a wire, got Part`
+- `TypeError: expected a sketch, face or closed wire, got Part`
+- `ValueError: sharp-cornered sweeps need a planar path`
+
+## Example
+```python
+path = Spline((0, 0, 0), (0, 20, 30), (40, 20, 50))
+tube = sweep(Circle(3) - Circle(2), path)               # profile drawn at the origin in XY
+print(tube.is_valid(), round(tube.volume, 2), round(math.pi * 5 * path.length, 2))  # True 1314.96 1314.96
+
+spring = sweep(Circle(1), Helix(pitch=5, height=30, radius=10))   # wire diameter 2 < pitch 5
+
+frame = sweep(Rectangle(6, 4), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40)))  # planar path: mitered corner
+print(round(frame.volume, 1))                           # 1920.0
+
+bent = sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 40), (40, 0, 40), radius=8))  # rounded corner
+
+ring = sweep(Circle(2), Wire([CenterArc((0, 0), 20, 0, 180), CenterArc((0, 0), 20, 180, 180)]))
+print(len(ring.solids()), round(ring.volume, 2))        # 1 1579.14 (a single 360-degree arc gives 2 solids and a negative volume)
+
+# a square thread profile that does not roll: loft through placed copies (8 per turn)
+h = Helix(pitch=5, height=10, radius=10)
+n = 16
+secs = []
+for i in range(n + 1):
+    p = h.point_at(i / n)
+    radial = Vector(p.x, p.y, 0).normalized()
+    secs.append(Rectangle(2, 1).on(Plane(origin=p, x_dir=radial, z_dir=h.tangent_at(i / n))))
+thread = loft(secs)
+print(thread.is_valid(), round(thread.volume, 2))       # True 252.12 = 2 * 1 * helix length
+```
+
+## Related
+`loft`, `revolve`, `Helix`, `Polyline`, `FilletPolyline`, `Wire`, `extrude`.
